import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PersonalDocument, Priority, UpdateDocumentInput } from "./domain/types.ts";
import type { PersonalOsSettings } from "./settingsStore.ts";
import { eligibleSession, type CurationDecision, type SessionEvidence, type SessionEvidenceEvent } from "./curation.ts";

export type TaskSpanStatus = "active" | "waiting_for_user" | "blocked" | "completion_candidate" | "completed";
export type TaskOutcomeStatus = "draft" | "ready_for_review" | "applying" | "applied" | "dismissed" | "failed" | "undone";
export type TaskCandidateKind = "update" | "activity" | "todo" | "knowledge" | "project" | "unresolved";
export type TaskCandidateStatus = "pending" | "accepted" | "dismissed" | "applied" | "failed";
export type CandidateConfidence = "high" | "medium" | "low";

export interface TaskSpan {
  id: string;
  sessionId: string;
  workspace?: string | undefined;
  objective: string;
  seqFrom: number;
  seqTo: number;
  status: TaskSpanStatus;
  completionEvidence: string[];
  contentHash: string;
  relatedProjectId?: string | undefined;
  updatedAt: string;
  analyzedSeqTo?: number | undefined;
  outcomeId?: string | undefined;
  latestUserMessage?: string | undefined;
  latestUserSeq?: number | undefined;
  latestUserAt?: number | undefined;
  boundaryReasons?: string[] | undefined;
  transitionReason?: string | undefined;
  startedAt?: number | undefined;
}

export type TaskContextUsageSource = "search" | "document" | "project-context";

export interface TaskContextUsage {
  documentId: string;
  source: TaskContextUsageSource;
  usedAt: string;
}

export interface TaskSpanView extends TaskSpan {
  canSplit: boolean;
  canMerge: boolean;
  previousTaskId?: string | undefined;
}

export interface TaskCandidateBefore {
  title?: string | undefined;
  body?: string | undefined;
  tags?: string[] | undefined;
  state?: string | undefined;
  priority?: Priority | undefined;
  start_date?: string | undefined;
  due_date?: string | undefined;
  target_date?: string | undefined;
}

export interface TaskOutcomeCandidate {
  id: string;
  kind: TaskCandidateKind;
  title: string;
  summary: string;
  confidence: CandidateConfidence;
  status: TaskCandidateStatus;
  targetId?: string | undefined;
  projectId?: string | undefined;
  targetRevision?: string | undefined;
  patch?: UpdateDocumentInput | undefined;
  before?: TaskCandidateBefore | undefined;
  appliedDocumentId?: string | undefined;
  appliedRevision?: string | undefined;
  error?: string | undefined;
}

export interface TaskOutcomeProposal {
  id: string;
  taskId: string;
  sessionId: string;
  workspace?: string | undefined;
  objective: string;
  summary: string;
  seqFrom: number;
  seqTo: number;
  completionEvidence: string[];
  candidates: TaskOutcomeCandidate[];
  unresolved: string[];
  status: TaskOutcomeStatus;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string | undefined;
  autoAppliedAt?: string | undefined;
  checkpointId?: string | undefined;
  checkpointIds?: string[] | undefined;
  error?: string | undefined;
}

export interface TaskOutcomeState {
  tasks: Record<string, TaskSpan>;
  outcomes: Record<string, TaskOutcomeProposal>;
  taskHistory: Record<string, TaskSpan>;
  contextUsage: Record<string, TaskContextUsage[]>;
}

const emptyState = (): TaskOutcomeState => ({ tasks: {}, outcomes: {}, taskHistory: {}, contextUsage: {} });
const taskOutcomeTails = new Map<string, Promise<void>>();

async function serializeTaskOutcome<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = taskOutcomeTails.get(key) ?? Promise.resolve();
  const current = previous.then(work, work);
  taskOutcomeTails.set(key, current.then(() => undefined, () => undefined));
  return current;
}

export class TaskOutcomeStateStore {
  readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, "task-outcomes.json");
  }

  async load(): Promise<TaskOutcomeState> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as Partial<TaskOutcomeState>;
      return {
        tasks: value.tasks ?? {},
        outcomes: value.outcomes ?? {},
        taskHistory: value.taskHistory ?? {},
        contextUsage: value.contextUsage ?? {},
      };
    } catch {
      return emptyState();
    }
  }

  async save(state: TaskOutcomeState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

export interface TaskCuratorAgent {
  analyzeTask?: (input: {
    objective: string;
    userText: string;
    assistantText: string;
    toolNames: string[];
    provenance: { session_id: string; seq_from: number; seq_to: number; workspace?: string | undefined };
    completionEvidence: string[];
  }) => Promise<TaskOutcomeAnalysis>;
  analyze?: (input: { userText: string; assistantText: string; toolNames: string[]; provenance: { kind: "conversation"; session_id: string; seq_from: number; seq_to: number; workspace?: string | undefined } }) => Promise<CurationDecision>;
}

export interface TaskOutcomeAnalysis {
  summary: string;
  candidates: Array<{
    kind: TaskCandidateKind | "capture";
    title: string;
    summary: string;
    confidence?: CandidateConfidence | undefined;
    targetId?: string | undefined;
    projectId?: string | undefined;
    patch?: UpdateDocumentInput | undefined;
  }>;
  unresolved?: string[] | undefined;
}

export interface TaskOutcomeObservation {
  proposal?: TaskOutcomeProposal | undefined;
  task?: TaskSpan | undefined;
  changed: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : typeof item === "object" && item !== null && "text" in item ? String((item as { text: unknown }).text) : "").join("\n");
  if (typeof content === "object" && content !== null && "text" in content) return String((content as { text: unknown }).text);
  return "";
}

function userMessages(events: SessionEvidenceEvent[]): Array<{ seq: number; text: string; time?: number | undefined }> {
  return events
    .filter((event) => event.type === "user/message" && event.source?.kind !== "plugin")
    .map((event) => ({ seq: event.seq, text: textOf(event.content).trim(), ...(event.time !== undefined ? { time: event.time } : {}) }))
    .filter((event) => event.text !== "");
}

function assistantMessages(events: SessionEvidenceEvent[]): Array<{ seq: number; text: string }> {
  return events
    .filter((event) => event.type === "assistant/message")
    .map((event) => ({ seq: event.seq, text: textOf(event.content).trim() }))
    .filter((event) => event.text !== "");
}

function toolNames(events: SessionEvidenceEvent[]): string[] {
  return events
    .filter((event) => event.type === "tool/call" && event.toolName && !event.toolName.startsWith("personal_"))
    .map((event) => event.toolName!);
}

function endReason(events: SessionEvidenceEvent[]): string | undefined {
  const event = [...events].reverse().find((item) => item.type === "turn/end");
  if (typeof event?.reason === "string") return event.reason;
  if (!event || typeof event.reason !== "object" || event.reason === null || !("kind" in event.reason)) return undefined;
  return String((event.reason as { kind: unknown }).kind);
}

export function isApprovalOrContinuation(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase();
  return normalized.length <= 80 && /^(好的?|好吧|可以|确认|继续|执行|做吧|提交吧|推送吧|发布吧|发吧|yes|ok|okay|go ahead|continue|do it|ship it|push it|sounds good)[\s!！。,.，]*$/i.test(normalized)
    || /^(这个|它|按这个|那就|然后|再|继续|现在|修复|改一下|补上|合并|推送|提交)/i.test(normalized);
}

function explicitlyStartsNewObjective(text: string): boolean {
  return /^(另外(?:请|帮我)?|另一个|换个|换一个|新任务|接下来(?:请|帮我)?|还有一件事|开始一个新任务|new task|another task)(?:[:：,，\s]|$)/i.test(text.trim());
}

function assistantAwaitsUser(events: SessionEvidenceEvent[]): boolean {
  const text = assistantMessages(events).at(-1)?.text.trim() ?? "";
  return /[?？]\s*$/.test(text) || /(?:请确认|请提供|需要你|告诉我|你希望|是否要|要不要)/i.test(text);
}

function hasOnlyFailedToolResults(events: SessionEvidenceEvent[]): boolean {
  const calls = new Map(events.filter((event) => event.type === "tool/call" && event.callId).map((event) => [event.callId!, event.toolName ?? ""]));
  const results = events.filter((event) => event.type === "tool/result" && (!event.callId || !calls.get(event.callId)?.startsWith("personal_")));
  return results.length > 0 && results.every((event) => event.error !== undefined);
}

export function explicitTaskFinalizationRequested(events: SessionEvidenceEvent[]): boolean {
  const text = userMessages(events).at(-1)?.text ?? "";
  return /完成并整理|整理本次任务|整理这次任务|记住这个结果|总结本次工作/i.test(text);
}

function hasCompletionLanguage(text: string): boolean {
  return /(?:完成|已完成|搞定|成功|已实现|已修复|已提交|已推送|通过|passed|complete(?:d)?|done|success(?:ful)?|shipped|deployed|merged|pushed)/i.test(text);
}

export function isTaskCompletionCandidate(events: SessionEvidenceEvent[], force = false): { eligible: boolean; evidence: string[]; blocked: boolean } {
  if (force) return { eligible: true, evidence: ["用户明确要求完成并整理"], blocked: false };
  const reason = endReason(events);
  const blocked = reason === "blocked" || reason === "error" || reason === "aborted" || reason === "interrupted" || reason === "max-tokens" || hasOnlyFailedToolResults(events);
  if (blocked || reason !== "completed") return { eligible: false, evidence: [], blocked };
  const assistants = assistantMessages(events);
  const tools = toolNames(events);
  const calls = new Map(events.filter((event) => event.type === "tool/call" && event.callId).map((event) => [event.callId!, event.toolName ?? ""]));
  const successfulResults = events.filter((event) => event.type === "tool/result" && event.error === undefined && (!event.callId || !calls.get(event.callId)?.startsWith("personal_"))).length;
  const evidence: string[] = [];
  const terminalResult = hasCompletionLanguage(assistants.at(-1)?.text ?? "");
  const explicit = explicitTaskFinalizationRequested(events);
  if (tools.length > 0 && successfulResults > 0) evidence.push(`完成 ${successfulResults} 个已确认工具操作`);
  if (terminalResult) evidence.push("Agent 给出完成结果");
  if (explicit) evidence.push("用户明确要求整理任务");
  return { eligible: explicit || (tools.length > 0 && successfulResults > 0 && terminalResult), evidence, blocked: false };
}

function evidenceHash(events: SessionEvidenceEvent[], seqFrom: number, seqTo: number): string {
  const compact = events.filter((event) => event.seq >= seqFrom && event.seq <= seqTo).map((event) => ({
    seq: event.seq,
    type: event.type,
    ...(event.type === "user/message" || event.type === "assistant/message" ? { text: textOf(event.content) } : {}),
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.callId ? { callId: event.callId } : {}),
    ...(event.type === "turn/end" ? { reason: endReason([event]) } : {}),
    ...(event.type === "tool/result" ? { failed: event.error !== undefined } : {}),
  }));
  return createHash("sha256").update(JSON.stringify(compact)).digest("hex");
}

function fallbackAnalysis(decision: CurationDecision): TaskOutcomeAnalysis {
  if (decision.action === "ignore") return { summary: "本次任务没有需要沉淀的明确结果。", candidates: [], unresolved: [] };
  if (decision.action === "activity") return { summary: decision.summary, candidates: [{ kind: "activity", title: "完成的任务", summary: decision.summary, confidence: "high", projectId: decision.projectId }], unresolved: [] };
  return {
    summary: decision.summary,
    candidates: [{ kind: decision.action, title: decision.title, summary: decision.summary, confidence: decision.action === "capture" ? "low" : "medium", projectId: decision.projectId }],
    unresolved: decision.action === "capture" ? [decision.summary] : [],
  };
}

function candidateId(outcomeId: string, candidate: Pick<TaskOutcomeAnalysis["candidates"][number], "kind" | "title" | "targetId" | "projectId">, occurrence = 0): string {
  if (candidate.kind === "activity") return `${outcomeId}:candidate:activity`;
  const semantic = createHash("sha256").update(JSON.stringify({
    kind: candidate.kind,
    title: candidate.title.trim().toLocaleLowerCase(),
    targetId: candidate.targetId ?? "",
    projectId: candidate.projectId ?? "",
  })).digest("hex").slice(0, 16);
  return `${outcomeId}:candidate:${semantic}${occurrence > 0 ? `:${occurrence + 1}` : ""}`;
}

function normalizeCandidate(candidate: TaskOutcomeAnalysis["candidates"][number], id: string): TaskOutcomeCandidate | undefined {
  if (candidate.kind === "capture" || candidate.kind === "unresolved") return undefined;
  if (candidate.kind === "update" && !candidate.targetId) return undefined;
  if (!["update", "activity", "todo", "knowledge", "project", "unresolved"].includes(candidate.kind)) return undefined;
  return {
    id,
    kind: candidate.kind,
    title: candidate.title.trim() || "任务结果",
    summary: candidate.summary.trim(),
    confidence: candidate.confidence ?? (candidate.kind === "activity" ? "high" : "medium"),
    status: "pending",
    ...(candidate.targetId ? { targetId: candidate.targetId } : {}),
    ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
    ...(candidate.patch ? { patch: candidate.patch } : {}),
  };
}

export function taskOutcomeForSession(state: TaskOutcomeState, sessionId: string): TaskOutcomeProposal | undefined {
  const task = state.tasks[sessionId];
  return task?.outcomeId ? state.outcomes[task.outcomeId] : undefined;
}

export class TaskOutcomeManager {
  constructor(readonly store: TaskOutcomeStateStore, readonly agent: TaskCuratorAgent) {}

  async observe(evidence: SessionEvidence, settings: PersonalOsSettings, options: { currentWorkspace?: string; force?: boolean; allowWhenOff?: boolean } = {}): Promise<TaskOutcomeObservation> {
    return serializeTaskOutcome(this.store.path, () => this.observeUnlocked(evidence, settings, options));
  }

  private async observeUnlocked(evidence: SessionEvidence, settings: PersonalOsSettings, options: { currentWorkspace?: string; force?: boolean; allowWhenOff?: boolean }): Promise<TaskOutcomeObservation> {
    const scopeSettings = (options.force || options.allowWhenOff) && settings.curationLevel === "off" ? { ...settings, curationLevel: "balanced" as const } : settings;
    if (!eligibleSession(evidence, scopeSettings, options.currentWorkspace)) return { changed: false };
    const state = await this.store.load();
    const events = [...evidence.events].sort((a, b) => a.seq - b.seq);
    const messages = userMessages(events);
    if (messages.length === 0) return { changed: false, task: state.tasks[evidence.sessionId], proposal: taskOutcomeForSession(state, evidence.sessionId) };

    const existing = state.tasks[evidence.sessionId];
    const latestMessage = messages.at(-1)!;
    const startsNewTask = existing === undefined
      || ((existing.status === "completed" || existing.status === "completion_candidate")
        && !isApprovalOrContinuation(latestMessage.text)
        && latestMessage.seq > existing.seqTo)
      || (existing !== undefined && latestMessage.seq > existing.seqTo && explicitlyStartsNewObjective(latestMessage.text));
    if (startsNewTask && existing) state.taskHistory[existing.id] = existing;
    const startReason = existing === undefined
      ? "Session 中出现首个用户目标"
      : explicitlyStartsNewObjective(latestMessage.text)
        ? "用户明确开始了新目标"
        : "上一任务已经完成，后续消息建立了新目标";
    let task = startsNewTask ? {
      id: `task_${evidence.sessionId}_${latestMessage.seq}`,
      sessionId: evidence.sessionId,
      objective: latestMessage.text,
      seqFrom: latestMessage.seq,
      seqTo: latestMessage.seq,
      status: "active" as const,
      completionEvidence: [],
      contentHash: "",
      updatedAt: nowIso(),
      latestUserMessage: latestMessage.text,
      latestUserSeq: latestMessage.seq,
      ...(latestMessage.time !== undefined ? { latestUserAt: latestMessage.time } : {}),
      boundaryReasons: [startReason],
      transitionReason: startReason,
      ...(latestMessage.time !== undefined ? { startedAt: latestMessage.time } : {}),
    } : { ...existing! };
    const newEvents = events.filter((event) => event.seq > task.seqTo);
    if (newEvents.length === 0 && !options.force) return { changed: false, task, proposal: taskOutcomeForSession(state, evidence.sessionId) };
    task.seqTo = Math.max(task.seqTo, ...events.map((event) => event.seq));
    task.updatedAt = nowIso();
    task.workspace = evidence.workspace;
    task.contentHash = evidenceHash(events, task.seqFrom, task.seqTo);
    task.latestUserMessage = latestMessage.text;
    task.latestUserSeq = latestMessage.seq;
    if (latestMessage.time !== undefined) task.latestUserAt = latestMessage.time;
    if (startsNewTask) task.objective = latestMessage.text;
    const completion = isTaskCompletionCandidate(events, options.force);
    const reason = endReason(events);
    if (completion.blocked) {
      task.status = reason === "blocked" || hasOnlyFailedToolResults(events) ? "blocked" : "waiting_for_user";
      task.transitionReason = hasOnlyFailedToolResults(events) ? "工具执行没有成功结果" : `任务以 ${reason ?? "异常"} 状态结束`;
    }
    else if (completion.eligible) {
      task.status = "completion_candidate";
      task.completionEvidence = [...new Set([...task.completionEvidence, ...completion.evidence])];
      task.transitionReason = completion.evidence.join("；");
    } else if (reason === "blocked") {
      task.status = "blocked";
      task.transitionReason = "任务当前被阻塞";
    } else if (assistantAwaitsUser(events)) {
      task.status = "waiting_for_user";
      task.transitionReason = "Agent 正在等待用户回答";
    } else {
      task.status = "active";
      task.transitionReason = isApprovalOrContinuation(latestMessage.text) ? "确认或继续指令并入当前目标" : "尚未出现可信的完成证据";
    }
    task.boundaryReasons = [...new Set([...(task.boundaryReasons ?? []), task.transitionReason])].slice(-6);

    let proposal = taskOutcomeForSession(state, evidence.sessionId);
    const shouldAnalyze = completion.eligible && task.analyzedSeqTo !== task.seqTo;
    if (shouldAnalyze) {
      const assistants = assistantMessages(events.filter((event) => event.seq >= task.seqFrom && event.seq <= task.seqTo));
      const tools = toolNames(events.filter((event) => event.seq >= task.seqFrom && event.seq <= task.seqTo));
      const provenance = { kind: "conversation" as const, session_id: evidence.sessionId, seq_from: task.seqFrom, seq_to: task.seqTo, ...(evidence.workspace ? { workspace: evidence.workspace } : {}) };
      let analysis: TaskOutcomeAnalysis;
      if (this.agent.analyzeTask) {
        analysis = await this.agent.analyzeTask({ objective: task.objective, userText: messages.filter((item) => item.seq >= task.seqFrom).map((item) => item.text).join("\n"), assistantText: assistants.map((item) => item.text).join("\n"), toolNames: tools, provenance, completionEvidence: task.completionEvidence });
      } else if (this.agent.analyze) {
        analysis = fallbackAnalysis(await this.agent.analyze({ userText: messages.filter((item) => item.seq >= task.seqFrom).map((item) => item.text).join("\n"), assistantText: assistants.map((item) => item.text).join("\n"), toolNames: tools, provenance }));
      } else {
        analysis = { summary: "任务已完成。", candidates: [] };
      }
      const outcomeId = task.outcomeId ?? `outcome_${task.id}`;
      const occurrences = new Map<string, number>();
      const candidates = analysis.candidates.map((candidate) => {
        const baseId = candidateId(outcomeId, candidate);
        const occurrence = occurrences.get(baseId) ?? 0;
        occurrences.set(baseId, occurrence + 1);
        return normalizeCandidate(candidate, candidateId(outcomeId, candidate, occurrence));
      }).filter((candidate): candidate is TaskOutcomeCandidate => candidate !== undefined);
      const unresolved = [...new Set([
        ...(analysis.unresolved ?? []),
        ...analysis.candidates.filter((candidate) => candidate.kind === "capture" || candidate.kind === "unresolved").map((candidate) => candidate.summary),
      ].map((item) => item.trim()).filter(Boolean))];
      if (!candidates.some((candidate) => candidate.kind === "activity")) {
        candidates.unshift({
          id: candidateId(outcomeId, { kind: "activity", title: "完成的任务" }),
          kind: "activity",
          title: "完成的任务",
          summary: analysis.summary.trim() || "任务已完成。",
          confidence: "high",
          status: "pending",
        });
      }
      const previousById = new Map(proposal?.candidates.map((candidate) => [candidate.id, candidate]) ?? []);
      for (const [index, candidate] of candidates.entries()) {
        const previous = previousById.get(candidate.id);
        if (!previous) continue;
        candidates[index] = previous.status === "applied"
          ? previous
          : { ...candidate, status: previous.status, ...(previous.targetRevision ? { targetRevision: previous.targetRevision } : {}), ...(previous.error ? { error: previous.error } : {}) };
      }
      for (const previous of proposal?.candidates ?? []) {
        if (previous.status === "applied" && !candidates.some((candidate) => candidate.id === previous.id)) candidates.push(previous);
      }
      proposal = {
        id: outcomeId,
        taskId: task.id,
        sessionId: evidence.sessionId,
        ...(evidence.workspace ? { workspace: evidence.workspace } : {}),
        objective: task.objective,
        summary: analysis.summary.trim() || "任务已完成。",
        seqFrom: task.seqFrom,
        seqTo: task.seqTo,
        completionEvidence: task.completionEvidence,
        candidates,
        unresolved,
        status: settings.curationLevel === "proactive" && candidates.every((candidate) => candidate.confidence === "high" && candidate.kind !== "unresolved") ? "ready_for_review" : "ready_for_review",
        createdAt: proposal?.createdAt ?? nowIso(),
        ...(proposal?.autoAppliedAt ? { autoAppliedAt: proposal.autoAppliedAt } : {}),
        ...(proposal?.checkpointId ? { checkpointId: proposal.checkpointId } : {}),
        ...(proposal?.checkpointIds ? { checkpointIds: proposal.checkpointIds } : {}),
        updatedAt: nowIso(),
      };
      task.relatedProjectId = candidates.find((candidate) => candidate.projectId)?.projectId;
      task.outcomeId = outcomeId;
      task.analyzedSeqTo = task.seqTo;
      state.outcomes[outcomeId] = proposal;
    } else if (proposal && task.status === "completion_candidate" && proposal.seqTo < task.seqTo) {
      proposal = { ...proposal, seqTo: task.seqTo, updatedAt: nowIso() };
      state.outcomes[proposal.id] = proposal;
    }
    state.tasks[evidence.sessionId] = task;
    state.taskHistory[task.id] = task;
    await this.store.save(state);
    return { changed: true, task, proposal };
  }

  async list(status?: TaskOutcomeStatus): Promise<TaskOutcomeProposal[]> {
    const state = await this.store.load();
    return Object.values(state.outcomes)
      .filter((proposal) => !status || proposal.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((proposal) => structuredClone(proposal));
  }

  async listTasks(): Promise<TaskSpanView[]> {
    const state = await this.store.load();
    return Object.values(state.tasks).map((task) => {
      const previous = Object.values(state.taskHistory)
        .filter((item) => item.sessionId === task.sessionId && item.id !== task.id && item.seqFrom < task.seqFrom)
        .sort((a, b) => b.seqFrom - a.seqFrom)[0];
      const proposal = task.outcomeId ? state.outcomes[task.outcomeId] : undefined;
      const hasApplied = proposal?.candidates.some((candidate) => candidate.status === "applied") ?? false;
      return {
        ...structuredClone(task),
        canSplit: !hasApplied && (task.latestUserSeq ?? task.seqFrom) > task.seqFrom,
        canMerge: !hasApplied && previous !== undefined,
        ...(previous ? { previousTaskId: previous.id } : {}),
      };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async recordContextUsage(sessionId: string, documentIds: string[], source: TaskContextUsageSource): Promise<void> {
    if (documentIds.length === 0) return;
    await serializeTaskOutcome(this.store.path, async () => {
      const state = await this.store.load();
      const current = state.contextUsage[sessionId] ?? [];
      const timestamp = nowIso();
      for (const documentId of [...new Set(documentIds)]) {
        const existing = current.find((item) => item.documentId === documentId);
        if (existing) {
          existing.source = source;
          existing.usedAt = timestamp;
        } else current.push({ documentId, source, usedAt: timestamp });
      }
      state.contextUsage[sessionId] = current.sort((a, b) => b.usedAt.localeCompare(a.usedAt)).slice(0, 24);
      await this.store.save(state);
    });
  }

  async correctBoundary(sessionId: string, action: "split-latest" | "merge-previous"): Promise<TaskSpanView> {
    return serializeTaskOutcome(this.store.path, async () => {
      const state = await this.store.load();
      const task = state.tasks[sessionId];
      if (!task) throw new Error("找不到当前 Session 的任务");
      const proposal = task.outcomeId ? state.outcomes[task.outcomeId] : undefined;
      if (proposal?.candidates.some((candidate) => candidate.status === "applied")) throw new Error("任务结果已经应用；请先撤回 Outcome 再调整边界");
      if (action === "split-latest") {
        const splitSeq = task.latestUserSeq ?? task.seqFrom;
        if (splitSeq <= task.seqFrom || !task.latestUserMessage) throw new Error("当前任务没有可拆分的后续目标");
        if (proposal) delete state.outcomes[proposal.id];
        const previous = { ...task, seqTo: splitSeq - 1, status: "completed" as const, outcomeId: undefined, analyzedSeqTo: undefined, updatedAt: nowIso(), transitionReason: "用户手动将最近目标拆为新任务" };
        state.taskHistory[previous.id] = previous;
        const next: TaskSpan = {
          id: `task_${sessionId}_${splitSeq}`,
          sessionId,
          ...(task.workspace ? { workspace: task.workspace } : {}),
          objective: task.latestUserMessage,
          seqFrom: splitSeq,
          seqTo: task.seqTo,
          status: "active",
          completionEvidence: [],
          contentHash: task.contentHash,
          latestUserMessage: task.latestUserMessage,
          latestUserSeq: splitSeq,
          ...(task.latestUserAt !== undefined ? { latestUserAt: task.latestUserAt } : {}),
          boundaryReasons: ["用户手动将最近目标拆为新任务"],
          transitionReason: "等待新任务产生新的完成证据",
          updatedAt: nowIso(),
          ...(task.latestUserAt !== undefined ? { startedAt: task.latestUserAt } : {}),
        };
        state.tasks[sessionId] = next;
        state.taskHistory[next.id] = next;
      } else {
        const previous = Object.values(state.taskHistory)
          .filter((item) => item.sessionId === sessionId && item.id !== task.id && item.seqFrom < task.seqFrom)
          .sort((a, b) => b.seqFrom - a.seqFrom)[0];
        if (!previous) throw new Error("没有可合并的上一任务");
        if (proposal) delete state.outcomes[proposal.id];
        const merged: TaskSpan = {
          ...previous,
          seqTo: task.seqTo,
          status: "active",
          contentHash: task.contentHash,
          completionEvidence: [...new Set([...previous.completionEvidence, ...task.completionEvidence])],
          latestUserMessage: task.latestUserMessage,
          latestUserSeq: task.latestUserSeq,
          analyzedSeqTo: previous.analyzedSeqTo,
          boundaryReasons: [...new Set([...(previous.boundaryReasons ?? []), "用户手动并入上一任务"])].slice(-6),
          transitionReason: "等待合并后的任务产生新的完成证据",
          updatedAt: nowIso(),
        };
        state.tasks[sessionId] = merged;
        state.taskHistory[merged.id] = merged;
        delete state.taskHistory[task.id];
      }
      await this.store.save(state);
      return (await this.listTasks()).find((item) => item.sessionId === sessionId)!;
    });
  }

  async get(id: string): Promise<TaskOutcomeProposal | undefined> {
    const state = await this.store.load();
    const proposal = state.outcomes[id];
    return proposal ? structuredClone(proposal) : undefined;
  }

  async update(id: string, update: (proposal: TaskOutcomeProposal, state: TaskOutcomeState) => TaskOutcomeProposal): Promise<TaskOutcomeProposal> {
    return serializeTaskOutcome(this.store.path, async () => {
      const state = await this.store.load();
      const proposal = state.outcomes[id];
      if (!proposal) throw new Error(`Unknown Task Outcome ${id}`);
      const next = update(structuredClone(proposal), state);
      state.outcomes[id] = next;
      await this.store.save(state);
      return structuredClone(next);
    });
  }

  async state(): Promise<TaskOutcomeState> {
    return this.store.load();
  }

  async saveState(state: TaskOutcomeState): Promise<void> {
    await this.store.save(state);
  }
}

export function captureCandidateFromUnresolved(proposal: TaskOutcomeProposal, text: string): TaskOutcomeCandidate {
  return {
    id: `${proposal.id}:capture:${Date.now()}`,
    kind: "unresolved",
    title: "待澄清内容",
    summary: text,
    confidence: "low",
    status: "pending",
  };
}

export function beforePatch(document: PersonalDocument, patch: UpdateDocumentInput): TaskCandidateBefore {
  const before: TaskCandidateBefore = {};
  if (patch.title !== undefined) before.title = document.title;
  if (patch.body !== undefined) before.body = document.body;
  if (patch.tags !== undefined) before.tags = [...document.tags];
  if (patch.state !== undefined) before.state = document.state;
  if (patch.priority !== undefined) before.priority = document.priority;
  if (patch.start_date !== undefined) before.start_date = document.start_date;
  if (patch.due_date !== undefined) before.due_date = document.due_date;
  if (patch.target_date !== undefined) before.target_date = document.target_date;
  return before;
}
