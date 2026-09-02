import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PersonalOsDomainService } from "./domain/service.ts";
import type { DocumentKind, Provenance } from "./domain/types.ts";
import type { PersonalOsSettings } from "./settingsStore.ts";

export interface SessionEvidenceEvent {
  seq: number;
  time?: number | undefined;
  type: string;
  turn?: number | undefined;
  content?: unknown;
  source?: { kind?: string };
  toolName?: string;
  callId?: string;
  reason?: unknown;
  error?: unknown;
}

export interface SessionEvidence {
  sessionId: string;
  workspace?: string | undefined;
  sessionKind?: "main" | "subagent" | "automation" | "system" | undefined;
  events: SessionEvidenceEvent[];
}

export type CurationDecision =
  | { action: "ignore"; reason: string }
  | { action: "activity"; summary: string; projectId?: string | undefined }
  | { action: "capture" | DocumentKind; title: string; summary: string; projectId?: string | undefined };

export interface CuratorAgent {
  analyze(evidence: { userText: string; assistantText: string; toolNames: string[]; provenance: Provenance }): Promise<CurationDecision>;
}

interface CurationState {
  watermarks: Record<string, number>;
  failedSessions: Record<string, string>;
}

const emptyState = (): CurationState => ({ watermarks: {}, failedSessions: {} });

export class CurationStateStore {
  readonly path: string;
  constructor(dataDir: string) { this.path = join(dataDir, "curation.json"); }
  async load(): Promise<CurationState> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as CurationState;
      return { watermarks: value.watermarks ?? {}, failedSessions: value.failedSessions ?? {} };
    } catch { return emptyState(); }
  }
  async save(state: CurationState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temp, this.path);
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : typeof item === "object" && item !== null && "text" in item ? String((item as { text: unknown }).text) : "").join("\n");
  if (typeof content === "object" && content !== null && "text" in content) return String((content as { text: unknown }).text);
  return "";
}

export function eligibleSession(evidence: SessionEvidence, settings: PersonalOsSettings, currentWorkspace?: string): boolean {
  if (settings.curationLevel === "off") return false;
  if (evidence.sessionKind && evidence.sessionKind !== "main") return false;
  if (settings.excludedSessions.includes(evidence.sessionId)) return false;
  if (evidence.workspace && settings.excludedWorkspaces.includes(evidence.workspace)) return false;
  if (!settings.crossWorkspaceLearning && currentWorkspace && evidence.workspace && evidence.workspace !== currentWorkspace) return false;
  return true;
}

export function compactEvidence(evidence: SessionEvidence, watermark = 0) {
  const events = evidence.events.filter((event) => event.seq > watermark);
  const userText = events.filter((event) => event.type === "user/message" && event.source?.kind !== "plugin")
    .map((event) => textOf(event.content)).filter(Boolean).join("\n");
  const assistantText = events.filter((event) => event.type === "assistant/message")
    .map((event) => textOf(event.content)).filter(Boolean).join("\n");
  const toolNames = events.filter((event) => event.type === "tool/call" && event.toolName && !event.toolName.startsWith("personal_"))
    .map((event) => event.toolName!);
  const seqs = events.map((event) => event.seq);
  return {
    userText, assistantText, toolNames,
    seqFrom: seqs.length ? Math.min(...seqs) : watermark,
    seqTo: seqs.length ? Math.max(...seqs) : watermark,
  };
}

export function balancedCurationCandidate(text: string): boolean {
  return /(?:记住|决定|决策|约定|承诺|完成|已做|已实现|下一步|待办|计划|需要|必须|不要忘|remember|decid(?:e|ed)|commit(?:ment|ted)?|complete(?:d)?|next step|todo|plan(?:ned)?|must|will\b)/i.test(text);
}

export class SessionCurator {
  constructor(
    readonly domain: PersonalOsDomainService,
    readonly state: CurationStateStore,
    readonly agent: CuratorAgent,
  ) {}

  async curate(evidence: SessionEvidence, settings: PersonalOsSettings, currentWorkspace?: string): Promise<CurationDecision> {
    if (!eligibleSession(evidence, settings, currentWorkspace)) return { action: "ignore", reason: "outside configured learning scope" };
    const state = await this.state.load();
    const watermark = state.watermarks[evidence.sessionId] ?? 0;
    const compact = compactEvidence(evidence, watermark);
    if (compact.seqTo <= watermark || compact.userText.trim() === "") return { action: "ignore", reason: "no new user-authored turn" };
    const provenance: Provenance = { kind: "conversation", session_id: evidence.sessionId, seq_from: compact.seqFrom, seq_to: compact.seqTo, workspace: evidence.workspace };
    try {
      if (settings.curationLevel === "balanced" && !balancedCurationCandidate(compact.userText)) {
        state.watermarks[evidence.sessionId] = compact.seqTo;
        delete state.failedSessions[evidence.sessionId];
        await this.state.save(state);
        return { action: "ignore", reason: "balanced mode found no durable signal" };
      }
      const alreadyMaterialized = this.domain.list().some((document) => document.source?.kind === "conversation"
        && document.source.session_id === evidence.sessionId
        && document.source.seq_from === compact.seqFrom
        && document.source.seq_to === compact.seqTo)
        || this.domain.timelineEntries({ source: "session" }).some((entry) => entry.session?.sessionId === evidence.sessionId
          && entry.session.seqFrom === compact.seqFrom
          && entry.session.seqTo === compact.seqTo);
      if (alreadyMaterialized) {
        state.watermarks[evidence.sessionId] = compact.seqTo;
        delete state.failedSessions[evidence.sessionId];
        await this.state.save(state);
        return { action: "ignore", reason: "source range was already materialized" };
      }
      const decision = await this.agent.analyze({ userText: compact.userText, assistantText: compact.assistantText, toolNames: compact.toolNames, provenance });
      if (decision.action === "activity") {
        await this.domain.recordSessionActivity({ actor: "curator", summary: decision.summary, projectId: decision.projectId, workspace: evidence.workspace, session: { sessionId: evidence.sessionId, seqFrom: compact.seqFrom, seqTo: compact.seqTo } });
      } else if (decision.action !== "ignore") {
        await this.domain.create({ kind: decision.action, title: decision.title, body: decision.summary, source: provenance }, { actor: "curator", source: "session" });
      }
      state.watermarks[evidence.sessionId] = compact.seqTo;
      delete state.failedSessions[evidence.sessionId];
      await this.state.save(state);
      return decision;
    } catch (error) {
      state.failedSessions[evidence.sessionId] = error instanceof Error ? error.message : String(error);
      await this.state.save(state);
      throw error;
    }
  }
}
