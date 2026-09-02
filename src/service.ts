import { isAbsolute } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import type { JobId, JobRegistry } from "@deepseek-ai/dsh-jobs";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { resolvePluginDataDir, type Config } from "./config.ts";
import { CurationStateStore, type SessionEvidence } from "./curation.ts";
import { PersonalOsDomainService, RevisionConflictError } from "./domain/service.ts";
import type { CreateDocumentInput, MutationContext, Relation, SearchFilter, TimelineEntry, UpdateDocumentInput } from "./domain/types.ts";
import { PersonalOsSettingsStore, type PersonalOsSettings } from "./settingsStore.ts";
import { VersionHistory } from "./versionHistory.ts";
import { VaultImporter, type ImportProgress, type ImportReport } from "./vaultImport.ts";
import {
  beforePatch,
  TaskOutcomeManager,
  TaskOutcomeStateStore,
  type TaskCandidateStatus,
  type TaskOutcomeCandidate,
  type TaskOutcomeProposal,
  type TaskOutcomeStatus,
  type TaskCuratorAgent,
  type TaskOutcomeObservation,
  type TaskContextUsageSource,
  type TaskSpanView,
} from "./taskOutcome.ts";

export const PERSONAL_OS_SERVICE = "personalOs";

export interface ImportJobStatus {
  id: string;
  source: string;
  mode: "copy" | "in-place";
  state: "running" | "stopping" | "completed" | "canceled" | "failed";
  progress: ImportProgress;
  report?: ImportReport | undefined;
  error?: string | undefined;
}

export interface CurationJobStatus {
  id: string;
  state: "running" | "stopping" | "completed" | "canceled" | "failed";
  progress: { completed: number; total: number; current: string };
  result?: unknown;
  error?: string | undefined;
}

export type TaskOutcomeReviewAction = "accept-all" | "accept" | "edit" | "retry" | "dismiss" | "dismiss-proposal" | "dismiss-unresolved" | "capture-unresolved" | "undo";

export interface TaskOutcomeReviewRequest {
  outcomeId: string;
  action: TaskOutcomeReviewAction;
  candidateId?: string | undefined;
  text?: string | undefined;
  title?: string | undefined;
  summary?: string | undefined;
  patch?: import("./domain/types.ts").UpdateDocumentInput | undefined;
}

export interface SessionTaskContext {
  task?: TaskSpanView | undefined;
  outcome?: TaskOutcomeProposal | undefined;
  used: Array<{ document: import("./domain/types.ts").PersonalDocument; source: TaskContextUsageSource; usedAt: string }>;
  proposed: Array<{ candidate: TaskOutcomeCandidate; document?: import("./domain/types.ts").PersonalDocument | undefined }>;
}

function groupTimelineOutcomes(entries: TimelineEntry[]): TimelineEntry[] {
  const plain: TimelineEntry[] = [];
  const grouped = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    if (!entry.outcomeId) plain.push(entry);
    else grouped.set(entry.outcomeId, [...(grouped.get(entry.outcomeId) ?? []), entry]);
  }
  const outcomes = [...grouped.values()].map((items) => {
    const activity = items.find((entry) => entry.source === "session" && entry.actor === "curator" && !entry.targetId) ?? items[0]!;
    return items.length > 1 ? { ...activity, summary: `${activity.summary} · ${items.length - 1} 项上下文更新` } : activity;
  });
  return [...plain, ...outcomes].sort((a, b) => b.at.localeCompare(a.at));
}

function attachOutcomeCheckpoint(proposal: TaskOutcomeProposal, id: string): void {
  proposal.checkpointId = id;
  proposal.checkpointIds = [...new Set([...(proposal.checkpointIds ?? []), id])];
}

type HistoricalBackfillRunner = (
  workspace?: string,
  fallbackSessionId?: string,
  options?: { signal?: AbortSignal; onProgress?: (completed: number, total: number, current: string) => void },
) => Promise<unknown>;

export type DshJobRegistryLike = Pick<JobRegistry, "start" | "get" | "kill" | "wait" | "attachController">;

export class PersonalOsService extends TypertRemoteService {
  readonly settings: PersonalOsSettingsStore;
  private domainService: PersonalOsDomainService | undefined;
  private domainRoot = "";
  private historicalBackfill: HistoricalBackfillRunner | undefined;
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  private initialScan: Promise<void> | undefined;
  private indexing = false;
  private readonly importJobs = new Map<string, ImportJobStatus>();
  private curationJob: CurationJobStatus | undefined;
  private jobs: DshJobRegistryLike | undefined;

  constructor(ctx: Context, config: Config) {
    super(ctx, PERSONAL_OS_SERVICE);
    this.settings = new PersonalOsSettingsStore(resolvePluginDataDir(config));
  }

  async getSettings(
    _request: Record<string, never>,
    signal: AbortSignal,
  ): Promise<PersonalOsSettings> {
    signal.throwIfAborted();
    return this.settings.load();
  }

  async setPersonalDataDirectory(
    request: { path: string },
    signal: AbortSignal,
  ): Promise<PersonalOsSettings> {
    signal.throwIfAborted();
    const root = request.path.trim();
    if (!isAbsolute(root)) throw new Error("Personal Data Directory must be an absolute path");
    const candidate = new PersonalOsDomainService(root);
    await candidate.initialize({ scan: false });
    let settings: PersonalOsSettings;
    try { settings = await this.settings.setPersonalDataDirectory(root); }
    catch (error) { await candidate.close(); throw error; }
    if (settings.versionHistory) {
      const history = new VersionHistory(root);
      await history.initialize();
      await history.checkpoint("Initialize Personal OS Version History");
    }
    await this.stopImportJobs("Personal Data Directory changed");
    await this.stopCurationJob("Personal Data Directory changed");
    await this.activateDomain(candidate, root, true);
    return settings;
  }

  async updatePreferences(
    request: Partial<Omit<PersonalOsSettings, "schemaVersion" | "personalDataDirectory">>,
    signal: AbortSignal,
  ): Promise<PersonalOsSettings> {
    signal.throwIfAborted();
    const previous = await this.settings.load();
    const settings = await this.settings.update(request);
    if (settings.versionHistory && settings.personalDataDirectory !== "") {
      const history = new VersionHistory(settings.personalDataDirectory);
      await history.initialize();
      if (!previous.versionHistory) await history.checkpoint("Initialize Personal OS Version History");
    }
    return settings;
  }

  async close(): Promise<void> {
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
    await this.stopImportJobs("Personal OS is stopping");
    await this.stopCurationJob("Personal OS is stopping");
    await this.initialScan?.catch(() => undefined);
    await this.domainService?.close();
    this.domainService = undefined;
  }

  setJobs(jobs?: DshJobRegistryLike): void {
    this.jobs = jobs;
  }

  private async stopImportJobs(reason: string): Promise<void> {
    const jobs = this.jobs;
    if (!jobs) return;
    const running = [...this.importJobs.values()].filter((job) => job.state === "running" || job.state === "stopping");
    for (const job of running) {
      try { jobs.kill(job.id as JobId, undefined, reason); } catch {}
    }
    await Promise.all(running.map(async (job) => {
      try {
        for (;;) {
          const snapshot = await jobs.wait(job.id as JobId, 5_000);
          if (snapshot.status === "completed" || snapshot.status === "killed" || snapshot.status === "failed") return;
        }
      } catch {
        // Unknown means the registry already released a terminal record.
      }
    }));
  }

  private async stopCurationJob(reason: string): Promise<void> {
    const jobs = this.jobs; const job = this.curationJob;
    if (!jobs || !job || (job.state !== "running" && job.state !== "stopping")) return;
    try { jobs.kill(job.id as JobId, undefined, reason); } catch {}
    try {
      for (;;) {
        const snapshot = await jobs.wait(job.id as JobId, 5_000);
        if (snapshot.status === "completed" || snapshot.status === "killed" || snapshot.status === "failed") return;
      }
    } catch {}
  }

  async releaseJobs(): Promise<void> {
    await this.stopImportJobs("Personal OS job controller is stopping");
    await this.stopCurationJob("Personal OS job controller is stopping");
    this.jobs = undefined;
  }

  dynamicContext(): string {
    if (!this.domainService) return "Personal OS is configured but not indexed yet.";
    if (this.indexing) return "Personal OS is building its Markdown index. Use personal_* tools after indexing completes.";
    const today = this.domainService.today();
    return `Personal OS index: ${today.todos.length} due Todo, ${today.inbox.length} pending Inbox, ${today.projects.length} active Project${today.continue ? `; Continue: ${today.continue.summary}` : ""}. Retrieve details with personal_* tools.`;
  }

  setHistoricalBackfill(runner?: HistoricalBackfillRunner | undefined): void {
    this.historicalBackfill = runner;
  }

  async runHistoricalCuration(request: { workspace?: string | undefined }, signal: AbortSignal): Promise<CurationJobStatus> {
    signal.throwIfAborted();
    return this.startHistoricalBackfill(request.workspace);
  }

  async startHistoricalBackfill(workspace?: string, fallbackSessionId?: string): Promise<CurationJobStatus> {
    if (!this.historicalBackfill) throw new Error("Session Query is not ready");
    if (!this.jobs) throw new Error("DSH background jobs are not ready");
    if (this.curationJob && (this.curationJob.state === "running" || this.curationJob.state === "stopping")) return structuredClone(this.curationJob);
    const controller = new AbortController();
    const status: CurationJobStatus = { id: "pending", state: "running", progress: { completed: 0, total: 0, current: "准备会话补扫" } };
    const id = String(this.jobs.start({
      kind: "personal-curation" as never,
      label: "Backfill Personal OS from Session history",
      run: () => ({
        cancel: (reason?: string) => { controller.abort(reason); },
        done: (async () => {
          try {
            status.result = await this.historicalBackfill!(workspace, fallbackSessionId, {
              signal: controller.signal,
              onProgress: (completed, total, current) => { status.progress = { completed, total, current }; },
            });
            const canceled = controller.signal.aborted || (typeof status.result === "object" && status.result !== null && "canceled" in status.result && status.result.canceled === true);
            status.state = canceled ? "canceled" : "completed";
            return { status: canceled ? "killed" as const : "completed" as const, detail: `${status.progress.completed}/${status.progress.total} sessions`, output: JSON.stringify(status.result) };
          } catch (error) {
            status.state = controller.signal.aborted ? "canceled" : "failed";
            status.error = error instanceof Error ? error.message : String(error);
            return { status: controller.signal.aborted ? "killed" as const : "failed" as const, detail: status.error };
          }
        })(),
      }),
    }));
    status.id = id; this.curationJob = status;
    return structuredClone(status);
  }

  async waitForHistoricalCuration(id: string): Promise<CurationJobStatus | null> {
    if (!this.jobs || !this.curationJob || this.curationJob.id !== id) return null;
    for (;;) {
      const snapshot = await this.jobs.wait(id as JobId, 5_000);
      if (snapshot.status === "completed" || snapshot.status === "killed" || snapshot.status === "failed") {
        await this.getCurationStatus({}, new AbortController().signal);
        return this.curationJob ? structuredClone(this.curationJob) : null;
      }
    }
  }

  async getCurationStatus(_request: Record<string, never>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const state = await new CurationStateStore(this.settings.dataDir).load();
    const taskState = await new TaskOutcomeStateStore(this.settings.dataDir).load();
    if (this.curationJob && this.jobs) {
      const lifecycle = this.jobs.get(this.curationJob.id as JobId).status;
      if (lifecycle === "stopping") this.curationJob.state = "stopping";
      else if (lifecycle === "killed") this.curationJob.state = "canceled";
      else if (lifecycle === "failed") this.curationJob.state = "failed";
      else if (lifecycle === "completed") this.curationJob.state = "completed";
    }
    return { processedSessions: new Set([...Object.keys(state.watermarks), ...Object.keys(taskState.tasks)]).size, failures: state.failedSessions, job: this.curationJob ? structuredClone(this.curationJob) : undefined };
  }

  private taskOutcomeManager(agent?: TaskCuratorAgent): TaskOutcomeManager {
    return new TaskOutcomeManager(new TaskOutcomeStateStore(this.settings.dataDir), agent ?? {});
  }

  private async enrichOutcomeRevisions(proposal: TaskOutcomeProposal): Promise<TaskOutcomeProposal> {
    const domain = await this.domain(false);
    const manager = this.taskOutcomeManager();
    const state = await manager.state();
    const stored = state.outcomes[proposal.id];
    if (!stored) return proposal;
    let changed = false;
    for (const candidate of stored.candidates) {
      if (candidate.kind !== "update" || !candidate.targetId || candidate.targetRevision !== undefined) continue;
      const target = domain.get(candidate.targetId);
      if (target) {
        candidate.targetRevision = target.revision;
        changed = true;
      }
    }
    if (changed) {
      stored.updatedAt = new Date().toISOString();
      state.outcomes[proposal.id] = stored;
      await manager.saveState(state);
      return structuredClone(stored);
    }
    return structuredClone(stored);
  }

  async observeTaskOutcome(
    request: { evidence: SessionEvidence; force?: boolean; allowWhenOff?: boolean; currentWorkspace?: string | undefined },
    signal: AbortSignal,
    agent: TaskCuratorAgent,
  ): Promise<TaskOutcomeObservation> {
    signal.throwIfAborted();
    const settings = await this.settings.load();
    if (settings.personalDataDirectory === "") return { changed: false };
    const observed = await this.taskOutcomeManager(agent).observe(request.evidence, settings, {
      ...(request.currentWorkspace !== undefined ? { currentWorkspace: request.currentWorkspace } : {}),
      ...(request.force !== undefined ? { force: request.force } : {}),
      ...(request.allowWhenOff !== undefined ? { allowWhenOff: request.allowWhenOff } : {}),
    });
    if (!observed.proposal) return observed;
    let proposal = await this.enrichOutcomeRevisions(observed.proposal);
    if (settings.curationLevel === "proactive"
      && proposal.status === "ready_for_review"
      && !proposal.autoAppliedAt) {
      const automatic = proposal.candidates.filter((candidate) => candidate.status === "pending" && candidate.confidence === "high" && candidate.kind !== "unresolved");
      for (const candidate of automatic) proposal = await this.reviewTaskOutcome({ outcomeId: proposal.id, action: "accept", candidateId: candidate.id }, signal);
      if (automatic.length > 0) {
        const timestamp = new Date().toISOString();
        const checkpoint = await this.checkpoint(`Auto-apply Task Outcome: ${proposal.objective}`) as { checkpoint?: { id?: string } };
        proposal = await this.taskOutcomeManager().update(proposal.id, (stored) => {
          stored.autoAppliedAt = timestamp;
          if (checkpoint.checkpoint?.id) attachOutcomeCheckpoint(stored, checkpoint.checkpoint.id);
          return stored;
        });
      }
    }
    return { ...observed, proposal };
  }

  async listTaskOutcomes(request: { status?: TaskOutcomeStatus | undefined }, signal: AbortSignal): Promise<TaskOutcomeProposal[]> {
    signal.throwIfAborted();
    return this.taskOutcomeManager().list(request.status);
  }

  async listTaskSpans(_request: Record<string, never>, signal: AbortSignal): Promise<TaskSpanView[]> {
    signal.throwIfAborted();
    return this.taskOutcomeManager().listTasks();
  }

  async correctTaskBoundary(request: { sessionId: string; action: "split-latest" | "merge-previous" }, signal: AbortSignal): Promise<TaskSpanView> {
    signal.throwIfAborted();
    return this.taskOutcomeManager().correctBoundary(request.sessionId, request.action);
  }

  async recordSessionContextUsage(sessionId: string | undefined, documentIds: string[], source: TaskContextUsageSource): Promise<void> {
    if (!sessionId) return;
    await this.taskOutcomeManager().recordContextUsage(sessionId, documentIds, source);
  }

  async getSessionTaskContext(request: { sessionId: string }, signal: AbortSignal): Promise<SessionTaskContext> {
    signal.throwIfAborted();
    const manager = this.taskOutcomeManager();
    const [state, tasks] = await Promise.all([manager.state(), manager.listTasks()]);
    const task = tasks.find((item) => item.sessionId === request.sessionId);
    const outcome = task?.outcomeId ? state.outcomes[task.outcomeId] : Object.values(state.outcomes).filter((item) => item.sessionId === request.sessionId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const domain = await this.domain(false);
    const used = (state.contextUsage[request.sessionId] ?? []).filter((usage) => !task?.startedAt || new Date(usage.usedAt).getTime() >= task.startedAt).flatMap((usage) => {
      const document = domain.get(usage.documentId);
      return document ? [{ document, source: usage.source, usedAt: usage.usedAt }] : [];
    });
    const proposed = (outcome?.candidates ?? []).filter((candidate) => candidate.status === "pending" || candidate.status === "failed").map((candidate) => {
      const document = candidate.targetId ? domain.get(candidate.targetId) : undefined;
      return { candidate, ...(document ? { document } : {}) };
    });
    return {
      ...(task ? { task } : {}),
      ...(outcome ? { outcome } : {}),
      used,
      proposed,
    };
  }

  async getTaskOutcome(request: { id: string }, signal: AbortSignal): Promise<TaskOutcomeProposal | null> {
    signal.throwIfAborted();
    return (await this.taskOutcomeManager().get(request.id)) ?? null;
  }

  private candidateContext(proposal: TaskOutcomeProposal, candidate: TaskOutcomeCandidate) {
    return {
      actor: "curator" as const,
      source: "session" as const,
      workspace: proposal.workspace,
      taskId: proposal.taskId,
      outcomeId: proposal.id,
      summary: `Task Outcome: ${candidate.title}`,
    };
  }

  private createInputForCandidate(proposal: TaskOutcomeProposal, candidate: TaskOutcomeCandidate): import("./domain/types.ts").CreateDocumentInput {
    const source = {
      kind: "conversation" as const,
      session_id: proposal.sessionId,
      seq_from: proposal.seqFrom,
      seq_to: proposal.seqTo,
      task_id: proposal.taskId,
      outcome_id: proposal.id,
      candidate_id: candidate.id,
      ...(proposal.workspace ? { workspace: proposal.workspace } : {}),
    };
    const relation = candidate.projectId && (candidate.kind === "todo" || candidate.kind === "knowledge")
      ? [{ type: "belongs_to" as const, target: candidate.projectId }]
      : undefined;
    return {
      kind: candidate.kind as import("./domain/types.ts").DocumentKind,
      title: candidate.title,
      body: candidate.summary,
      source,
      ...(relation ? { relations: relation } : {}),
    };
  }

  private async applyOutcomeCandidate(domain: PersonalOsDomainService, proposal: TaskOutcomeProposal, candidate: TaskOutcomeCandidate): Promise<void> {
    const context = this.candidateContext(proposal, candidate);
    if (candidate.kind === "activity") {
      await domain.recordSessionActivity({
        actor: "curator",
        summary: candidate.summary,
        projectId: candidate.projectId,
        workspace: proposal.workspace,
        session: { sessionId: proposal.sessionId, seqFrom: proposal.seqFrom, seqTo: proposal.seqTo },
        taskId: proposal.taskId,
        outcomeId: proposal.id,
      });
      return;
    }
    if (candidate.kind === "update") {
      if (!candidate.targetId || !candidate.patch) throw new Error("更新候选缺少目标或变更内容");
      const target = domain.get(candidate.targetId);
      if (!target) throw new Error(`找不到要更新的 Personal OS 文档 ${candidate.targetId}`);
      if (candidate.targetRevision !== undefined && target.revision !== candidate.targetRevision) throw new RevisionConflictError(target);
      candidate.before = beforePatch(target, candidate.patch);
      const updated = await domain.update(candidate.targetId, candidate.patch, candidate.targetRevision, context);
      candidate.appliedDocumentId = updated.id;
      candidate.appliedRevision = updated.revision;
      return;
    }
    if (candidate.kind === "todo" || candidate.kind === "knowledge" || candidate.kind === "project") {
      const existing = domain.list().find((document) => document.source?.kind === "conversation"
        && document.source.outcome_id === proposal.id
        && document.source.candidate_id === candidate.id);
      if (existing) {
        candidate.appliedDocumentId = existing.id;
        candidate.appliedRevision = existing.revision;
        return;
      }
      const created = await domain.create(this.createInputForCandidate(proposal, candidate), context);
      candidate.appliedDocumentId = created.id;
      candidate.appliedRevision = created.revision;
    }
  }

  private async undoOutcome(proposal: TaskOutcomeProposal, signal: AbortSignal): Promise<TaskOutcomeProposal> {
    signal.throwIfAborted();
    const domain = await this.domain();
    const manager = this.taskOutcomeManager();
    const state = await manager.state();
    const stored = state.outcomes[proposal.id];
    if (!stored) throw new Error(`Unknown Task Outcome ${proposal.id}`);
    if (stored.status === "undone") return structuredClone(stored);
    const settings = await this.settings.load();
    const checkpointIds = stored.checkpointIds ?? (stored.checkpointId ? [stored.checkpointId] : []);
    if (settings.versionHistory && settings.personalDataDirectory !== "" && checkpointIds.length > 0) {
      const history = new VersionHistory(settings.personalDataDirectory);
      for (const checkpointId of [...checkpointIds].reverse()) await history.revert(checkpointId, `Undo Task Outcome: ${stored.objective}`);
      await domain.refresh();
      for (const candidate of stored.candidates) if (candidate.status === "applied") candidate.status = "dismissed";
      stored.status = "undone";
      stored.updatedAt = new Date().toISOString();
      await domain.recordSessionActivity({
        actor: "curator",
        summary: `撤回任务结果：${stored.summary}`,
        workspace: stored.workspace,
        session: { sessionId: stored.sessionId, seqFrom: stored.seqFrom, seqTo: stored.seqTo },
        taskId: stored.taskId,
        outcomeId: stored.id,
      });
      await manager.saveState(state);
      await this.checkpoint(`Record Task Outcome correction: ${stored.objective}`);
      return structuredClone(stored);
    }
    let changed = false;
    for (const candidate of stored.candidates) {
      if (candidate.status !== "applied") continue;
      try {
        if (candidate.kind === "activity") {
          await domain.recordSessionActivity({
            actor: "curator",
            summary: `撤回任务结果：${candidate.summary}`,
            workspace: stored.workspace,
            session: { sessionId: stored.sessionId, seqFrom: stored.seqFrom, seqTo: stored.seqTo },
            taskId: stored.taskId,
            outcomeId: stored.id,
          });
        } else if (candidate.appliedDocumentId && ["todo", "knowledge", "project"].includes(candidate.kind)) {
          const created = domain.get(candidate.appliedDocumentId);
          if (created && (!candidate.appliedRevision || created.revision === candidate.appliedRevision)) await domain.archive(created.id, this.candidateContext(stored, candidate));
        } else if (candidate.kind === "update" && candidate.targetId && candidate.before) {
          const target = domain.get(candidate.targetId);
          if (!target || (candidate.appliedRevision && target.revision !== candidate.appliedRevision)) throw new Error("文档在应用后已发生变化，无法安全撤回");
          await domain.update(candidate.targetId, candidate.before, candidate.appliedRevision, this.candidateContext(stored, candidate));
        }
        candidate.status = "dismissed";
        changed = true;
      } catch (error) {
        candidate.status = "failed";
        candidate.error = error instanceof Error ? error.message : String(error);
        changed = true;
      }
    }
    stored.status = stored.candidates.some((candidate) => candidate.status === "failed") ? "failed" : "undone";
    stored.updatedAt = new Date().toISOString();
    await manager.saveState(state);
    if (changed) await this.checkpoint(`Undo Task Outcome: ${stored.objective}`);
    return structuredClone(stored);
  }

  async reviewTaskOutcome(request: TaskOutcomeReviewRequest, signal: AbortSignal): Promise<TaskOutcomeProposal> {
    signal.throwIfAborted();
    if (request.action === "undo") {
      const outcome = await this.getTaskOutcome({ id: request.outcomeId }, signal);
      if (!outcome) throw new Error(`Unknown Task Outcome ${request.outcomeId}`);
      return this.undoOutcome(outcome, signal);
    }
    const manager = this.taskOutcomeManager();
    const state = await manager.state();
    const proposal = state.outcomes[request.outcomeId];
    if (!proposal) throw new Error(`Unknown Task Outcome ${request.outcomeId}`);
    if (["accept", "accept-all", "retry", "capture-unresolved"].includes(request.action)) {
      const settings = await this.settings.load();
      if (settings.excludedSessions.includes(proposal.sessionId) || (proposal.workspace && settings.excludedWorkspaces.includes(proposal.workspace))) {
        throw new Error("这个 Task Outcome 已被当前隐私排除范围阻止");
      }
    }
    if (request.action === "edit") {
      const candidate = proposal.candidates.find((item) => item.id === request.candidateId);
      if (!candidate) throw new Error("Unknown Task Outcome candidate");
      if (candidate.status === "applied") throw new Error("已应用的候选需要先撤回再编辑");
      if (request.title?.trim()) candidate.title = request.title.trim();
      if (request.summary?.trim()) candidate.summary = request.summary.trim();
      if (request.patch) candidate.patch = request.patch;
      candidate.status = "pending";
      candidate.error = undefined;
      proposal.status = "ready_for_review";
      proposal.updatedAt = new Date().toISOString();
      await manager.saveState(state);
      return structuredClone(proposal);
    }
    if (request.action === "dismiss" || request.action === "dismiss-proposal") {
      if (request.action === "dismiss") {
        const candidate = proposal.candidates.find((item) => item.id === request.candidateId);
        if (!candidate) throw new Error("Unknown Task Outcome candidate");
        candidate.status = "dismissed";
        if (!proposal.candidates.some((item) => item.status === "pending" || item.status === "failed")) proposal.status = proposal.candidates.some((item) => item.status === "applied") ? "applied" : "dismissed";
      } else {
        for (const candidate of proposal.candidates) if (candidate.status === "pending" || candidate.status === "failed") candidate.status = "dismissed";
        proposal.unresolved = [];
        proposal.status = proposal.candidates.some((candidate) => candidate.status === "applied") ? "applied" : "dismissed";
        if (proposal.status === "applied") proposal.appliedAt = proposal.appliedAt ?? new Date().toISOString();
        const task = state.tasks[proposal.sessionId];
        if (task?.id === proposal.taskId) {
          task.status = "completed";
          task.updatedAt = new Date().toISOString();
        }
      }
      if (proposal.status === "dismissed" || proposal.status === "applied") {
        const task = state.tasks[proposal.sessionId];
        if (task?.id === proposal.taskId) {
          task.status = "completed";
          task.updatedAt = new Date().toISOString();
        }
      }
      proposal.updatedAt = new Date().toISOString();
      await manager.saveState(state);
      if (proposal.status === "applied") {
        const checkpoint = await this.checkpoint(`Apply Task Outcome: ${proposal.objective}`) as { checkpoint?: { id?: string } };
        if (checkpoint.checkpoint?.id) {
          attachOutcomeCheckpoint(proposal, checkpoint.checkpoint.id);
          await manager.saveState(state);
        }
      }
      return structuredClone(proposal);
    }
    if (request.action === "dismiss-unresolved") {
      const text = request.text?.trim();
      if (!text || !proposal.unresolved.includes(text)) throw new Error("Unknown unresolved Task Outcome item");
      proposal.unresolved = proposal.unresolved.filter((item) => item !== text);
      proposal.updatedAt = new Date().toISOString();
      if (proposal.unresolved.length === 0 && !proposal.candidates.some((candidate) => candidate.status === "pending" || candidate.status === "failed")) {
        proposal.status = "applied";
        proposal.appliedAt = proposal.appliedAt ?? proposal.updatedAt;
        const task = state.tasks[proposal.sessionId];
        if (task?.id === proposal.taskId) {
          task.status = "completed";
          task.updatedAt = proposal.updatedAt;
        }
      }
      await manager.saveState(state);
      if (proposal.status === "applied") {
        const checkpoint = await this.checkpoint(`Apply Task Outcome: ${proposal.objective}`) as { checkpoint?: { id?: string } };
        if (checkpoint.checkpoint?.id) {
          attachOutcomeCheckpoint(proposal, checkpoint.checkpoint.id);
          await manager.saveState(state);
        }
      }
      return structuredClone(proposal);
    }
    if (request.action === "capture-unresolved") {
      const text = request.text?.trim() || proposal.unresolved[0]?.trim();
      if (!text) throw new Error("没有可保存到收件箱的待澄清内容");
      const domain = await this.domain();
      const capture = await domain.create({
        kind: "capture",
        title: "任务待澄清内容",
        body: text,
        source: { kind: "conversation", session_id: proposal.sessionId, seq_from: proposal.seqFrom, seq_to: proposal.seqTo, task_id: proposal.taskId, outcome_id: proposal.id, ...(proposal.workspace ? { workspace: proposal.workspace } : {}) },
      }, { actor: "user", source: "session", workspace: proposal.workspace, taskId: proposal.taskId, outcomeId: proposal.id, summary: "从 Task Outcome 明确保存到 Inbox" });
      proposal.unresolved = proposal.unresolved.filter((item) => item !== text);
      proposal.updatedAt = new Date().toISOString();
      if (proposal.unresolved.length === 0 && !proposal.candidates.some((candidate) => candidate.status === "pending" || candidate.status === "failed")) {
        proposal.status = "applied";
        proposal.appliedAt = proposal.appliedAt ?? proposal.updatedAt;
        const task = state.tasks[proposal.sessionId];
        if (task?.id === proposal.taskId) {
          task.status = "completed";
          task.updatedAt = proposal.updatedAt;
        }
      }
      await manager.saveState(state);
      const checkpoint = await this.checkpoint(`${proposal.status === "applied" ? "Apply" : "Capture unresolved"} Task Outcome: ${capture.title}`) as { checkpoint?: { id?: string } };
      if (proposal.status === "applied" && checkpoint.checkpoint?.id) {
        attachOutcomeCheckpoint(proposal, checkpoint.checkpoint.id);
        await manager.saveState(state);
      }
      return structuredClone(proposal);
    }
    const selected = request.action === "accept" || request.action === "retry"
      ? proposal.candidates.filter((candidate) => candidate.id === request.candidateId && (request.action === "retry" ? candidate.status === "failed" : candidate.status === "pending"))
      : proposal.candidates.filter((candidate) => candidate.status === "pending");
    if (selected.length === 0) return structuredClone(proposal);
    if (request.action === "accept" && request.patch) {
      const candidate = selected[0]!;
      candidate.patch = request.patch;
    }
    if (request.action === "retry") {
      selected[0]!.status = "pending";
      selected[0]!.error = undefined;
    }
    proposal.status = "applying";
    proposal.error = undefined;
    await manager.saveState(state);
    const domain = await this.domain();
    for (const candidate of selected) {
      if (candidate.kind === "unresolved") continue;
      try {
        await this.applyOutcomeCandidate(domain, proposal, candidate);
        candidate.status = "applied";
        candidate.error = undefined;
        await manager.saveState(state);
      } catch (error) {
        candidate.status = "failed";
        candidate.error = error instanceof Error ? error.message : String(error);
        await manager.saveState(state);
      }
    }
    const pending = proposal.candidates.some((candidate) => candidate.status === "pending" && candidate.kind !== "unresolved");
    const failed = proposal.candidates.some((candidate) => candidate.status === "failed");
    proposal.status = failed ? "failed" : pending || proposal.unresolved.length > 0 ? "ready_for_review" : "applied";
    proposal.appliedAt = proposal.status === "applied" ? new Date().toISOString() : proposal.appliedAt;
    proposal.updatedAt = new Date().toISOString();
    if (proposal.status === "applied") {
      const task = state.tasks[proposal.sessionId];
      if (task?.id === proposal.taskId) {
        task.status = "completed";
        task.updatedAt = proposal.updatedAt;
      }
    }
    await manager.saveState(state);
    if (proposal.status === "applied") {
      const result = await this.checkpoint(`Apply Task Outcome: ${proposal.objective}`) as { checkpoint?: { id?: string } };
      if (result.checkpoint?.id) {
        attachOutcomeCheckpoint(proposal, result.checkpoint.id);
        await manager.saveState(state);
      }
    }
    return structuredClone(proposal);
  }

  async cancelHistoricalCuration(_request: Record<string, never>, signal: AbortSignal): Promise<CurationJobStatus | null> {
    signal.throwIfAborted();
    if (!this.curationJob || !this.jobs) return null;
    if (this.curationJob.state === "running") {
      this.jobs.kill(this.curationJob.id as JobId, undefined, "Canceled by user");
      this.curationJob.state = "stopping";
    }
    return structuredClone(this.curationJob);
  }

  async domain(waitForIndex = true): Promise<PersonalOsDomainService> {
    const settings = await this.settings.load();
    if (settings.personalDataDirectory === "") throw new Error("Personal Data Directory is not configured");
    if (!this.domainService || this.domainRoot !== settings.personalDataDirectory) {
      await this.switchDomain(settings.personalDataDirectory);
    }
    if (waitForIndex) await this.initialScan;
    return this.domainService!;
  }

  private async switchDomain(root: string): Promise<void> {
    if (this.domainService && this.domainRoot === root) return;
    const domain = new PersonalOsDomainService(root);
    await domain.initialize({ scan: false });
    await this.activateDomain(domain, root, true);
  }

  private async activateDomain(domain: PersonalOsDomainService, root: string, backgroundScan = false): Promise<void> {
    await this.initialScan?.catch(() => undefined);
    await this.domainService?.close();
    domain.subscribe(() => {
      if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
      this.checkpointTimer = setTimeout(() => { void this.checkpoint("Synchronize external Markdown changes"); }, 650);
    });
    this.domainService = domain;
    this.domainRoot = root;
    if (backgroundScan) {
      this.indexing = true;
      this.initialScan = domain.refresh().then(() => undefined).finally(() => {
        if (this.domainService === domain) this.indexing = false;
        if (this.initialScan) this.initialScan = undefined;
      });
    }
  }

  async getSnapshot(_request: Record<string, never>, signal: AbortSignal) {
    signal.throwIfAborted();
    return { ...(await this.domain(false)).snapshot(), indexing: this.indexing };
  }

  async listDocuments(request: { kind?: CreateDocumentInput["kind"]; archived?: boolean; state?: string; tag?: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain(false)).list(request);
  }

  async getDocument(request: { id: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain(false)).get(request.id) ?? null;
  }

  async createDocument(request: { input: CreateDocumentInput; context?: MutationContext }, signal: AbortSignal) {
    signal.throwIfAborted();
    const document = await (await this.domain()).create(request.input, request.context);
    await this.checkpoint(`Create ${document.kind} [${document.id}]: ${document.title}`);
    return document;
  }

  async getTemplateDraft(request: { kind: CreateDocumentInput["kind"]; title?: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain()).createFromTemplate(request.kind, request.title ?? "");
  }

  async updateDocument(request: { id: string; patch: UpdateDocumentInput; expectedRevision?: string | undefined; context?: MutationContext | undefined }, signal: AbortSignal) {
    signal.throwIfAborted();
    const document = await (await this.domain()).update(request.id, request.patch, request.expectedRevision, request.context);
    await this.checkpoint(`Update ${document.kind} [${document.id}]: ${document.title}`);
    return document;
  }

  async archiveDocument(request: { id: string; restore?: boolean | undefined; context?: MutationContext | undefined }, signal: AbortSignal) {
    signal.throwIfAborted();
    const domain = await this.domain();
    const document = request.restore ? await domain.restore(request.id, request.context) : await domain.archive(request.id, request.context);
    await this.checkpoint(`${request.restore ? "Restore" : "Archive"} ${document.kind} [${document.id}]: ${document.title}`);
    return document;
  }

  async linkDocuments(request: { sourceId: string; relation: Relation; remove?: boolean | undefined; context?: MutationContext | undefined }, signal: AbortSignal) {
    signal.throwIfAborted();
    const domain = await this.domain();
    const document = request.remove
      ? await domain.unlinkRelation(request.sourceId, request.relation, request.context)
      : await domain.link(request.sourceId, request.relation, request.context);
    await this.checkpoint(`${request.remove ? "Remove" : "Add"} relation [${document.id}]: ${document.title}`);
    return document;
  }

  async searchDocuments(request: { query: string; filter?: SearchFilter }, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain(false)).search(request.query, request.filter);
  }

  async getToday(request: { date?: string | undefined }, signal: AbortSignal) {
    signal.throwIfAborted();
    const today = (await this.domain(false)).today(request.date);
    return { ...today, activity: groupTimelineOutcomes(today.activity) };
  }

  async getProjectContext(request: { id: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain(false)).projectContext(request.id);
  }

  async getTimeline(request: { date?: string; projectId?: string; workspace?: string; source?: "ui" | "agent" | "session" | "import" | "external" }, signal: AbortSignal) {
    signal.throwIfAborted();
    return groupTimelineOutcomes((await this.domain(false)).timelineEntries(request));
  }

  async getCalendar(request: { month?: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain(false)).calendar(request.month);
  }

  async getGraph(request: { focusId?: string; types?: Relation["type"][]; projectId?: string; tag?: string }, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain(false)).graph(request);
  }

  async refreshDomain(_request: Record<string, never>, signal: AbortSignal) {
    signal.throwIfAborted();
    return (await this.domain()).refresh();
  }

  async processCapture(request: { id: string; outputs: CreateDocumentInput[]; context?: MutationContext }, signal: AbortSignal) {
    signal.throwIfAborted();
    const result = await (await this.domain()).processCapture(request.id, request.outputs, request.context);
    await this.checkpoint(`Process Capture [${result.capture.id}]: ${result.capture.title}`);
    return result;
  }

  async checkpoint(summary: string): Promise<unknown> {
    const settings = await this.settings.load();
    if (!settings.versionHistory || settings.personalDataDirectory === "") return { available: false };
    return { available: true, checkpoint: await new VersionHistory(settings.personalDataDirectory).checkpoint(summary) };
  }

  async getHistory(request: { limit?: number | undefined }, signal: AbortSignal) {
    signal.throwIfAborted();
    const settings = await this.settings.load();
    if (!settings.versionHistory || settings.personalDataDirectory === "") return { available: false, entries: [] };
    return { available: true, entries: await new VersionHistory(settings.personalDataDirectory).list(request.limit) };
  }

  async revertHistory(request: { commit: string; summary?: string | undefined }, signal: AbortSignal) {
    signal.throwIfAborted();
    const settings = await this.settings.load();
    if (!settings.versionHistory || settings.personalDataDirectory === "") throw new Error("Version History is disabled");
    const entry = await new VersionHistory(settings.personalDataDirectory).revert(request.commit, request.summary);
    await (await this.domain()).refresh();
    return entry;
  }

  async preflightImport(request: { source: string; mode?: "copy" | "in-place" }, signal: AbortSignal) {
    signal.throwIfAborted();
    return new VaultImporter(await this.domain()).preflight(request.source, request.mode);
  }

  async runImport(request: { source: string; mode?: "copy" | "in-place" }, signal: AbortSignal) {
    signal.throwIfAborted();
    const report = await new VaultImporter(await this.domain()).run(request.source, { mode: request.mode, signal });
    await this.checkpoint(`Import Markdown Vault: ${report.imported} document(s)`);
    return report;
  }

  async startImport(request: { source: string; mode?: "copy" | "in-place" }, signal: AbortSignal): Promise<ImportJobStatus> {
    signal.throwIfAborted();
    const jobs = this.jobs;
    if (!jobs) throw new Error("DSH background jobs are not ready");
    const mode = request.mode ?? "copy";
    const controller = new AbortController();
    const status: ImportJobStatus = { id: "pending", source: request.source, mode, state: "running", progress: { completed: 0, total: 0, current: "准备导入" } };
    const id = String(jobs.start({
      kind: "personal-import" as never,
      label: `Import Markdown Vault: ${request.source}`,
      run: () => {
        const done = (async () => {
          try {
            const report = await new VaultImporter(await this.domain()).run(request.source, {
              mode,
              signal: controller.signal,
              onProgress: (progress) => { status.progress = progress; },
            });
            status.report = report;
            status.progress = { completed: report.imported + report.skipped, total: report.markdown, current: report.reportPath };
            status.state = report.canceled ? "canceled" : "completed";
            if (!report.canceled) await this.checkpoint(`Import Markdown Vault: ${report.imported} document(s)`);
            return { status: report.canceled ? "killed" as const : "completed" as const, detail: `${report.imported} imported, ${report.skipped} skipped`, output: JSON.stringify(report) };
          } catch (error) {
            status.state = controller.signal.aborted ? "canceled" : "failed";
            status.error = error instanceof Error ? error.message : String(error);
            return { status: controller.signal.aborted ? "killed" as const : "failed" as const, detail: status.error };
          }
        })();
        return { cancel: (reason?: string) => { controller.abort(reason); }, done };
      },
    }));
    status.id = id;
    this.importJobs.set(id, status);
    return structuredClone(status);
  }

  async getImportJob(request: { id: string }, signal: AbortSignal): Promise<ImportJobStatus | null> {
    signal.throwIfAborted();
    const job = this.importJobs.get(request.id);
    if (!job || !this.jobs) return null;
    const lifecycle = this.jobs.get(request.id as JobId).status;
    if (lifecycle === "stopping") job.state = "stopping";
    else if (lifecycle === "killed") job.state = "canceled";
    else if (lifecycle === "failed") job.state = "failed";
    else if (lifecycle === "completed") job.state = "completed";
    return structuredClone(job);
  }

  async getLatestImportJob(_request: Record<string, never>, signal: AbortSignal): Promise<ImportJobStatus | null> {
    signal.throwIfAborted();
    const latest = [...this.importJobs.values()].at(-1);
    return latest ? this.getImportJob({ id: latest.id }, signal) : null;
  }

  async cancelImport(request: { id: string }, signal: AbortSignal): Promise<ImportJobStatus | null> {
    signal.throwIfAborted();
    const job = this.importJobs.get(request.id);
    if (!job || !this.jobs) return null;
    this.jobs.kill(request.id as JobId, undefined, "Canceled by user");
    job.state = "stopping";
    return structuredClone(job);
  }
}
