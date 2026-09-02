import { randomUUID } from "node:crypto";

import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import { SessionId } from "@deepseek-ai/dsh-session";

import {
  type CurationDecision,
  type CuratorAgent,
  type SessionEvidence,
  type SessionEvidenceEvent,
} from "./curation.ts";
import type { Provenance } from "./domain/types.ts";
import { explicitTaskFinalizationRequested, type CandidateConfidence, type TaskCuratorAgent, type TaskOutcomeAnalysis } from "./taskOutcome.ts";
import type { PersonalOsService } from "./service.ts";

const CURATOR_PROMPT = `You are the cautious Personal OS Curator. Analyze exactly one completed user turn.
Return one JSON object and no markdown:
{"action":"ignore","reason":"..."}
or {"action":"activity","summary":"...","projectId":"optional"}
or {"action":"capture|knowledge|todo|project","title":"...","summary":"...","projectId":"optional"}.
Keep only clear commitments, decisions, completed outcomes, project movement, or useful unfinished work. Uncertain value becomes capture. Pure questions, casual conversation, retries, reasoning, raw file content, and tool noise are ignored. Do not copy transcripts. The summary must be a concise derived fact.`;

const TASK_CURATOR_PROMPT = `You are the cautious Personal OS Task Outcome Curator. Analyze one coherent completed Task Span, which may contain multiple user turns including clarification, approval, implementation, verification, commit, and push.
Return one JSON object and no markdown:
{"summary":"concise completed-work result","candidates":[{"kind":"update|activity|todo|knowledge|project|unresolved","title":"...","summary":"...","confidence":"high|medium|low","targetId":"optional existing Personal OS document id","projectId":"optional","patch":{"state":"optional"}}],"unresolved":["optional unresolved items"]}.
Prefer updating an existing Project, Todo, or Knowledge found through personal_search over creating a duplicate. Record one activity for completed work. Create Todo only for an explicit unfinished commitment. Create Knowledge only for a stable reusable conclusion. Never return a capture candidate: unresolved material stays in the proposal until the user explicitly sends it to Inbox. Ignore questions, casual conversation, retries without a result, reasoning, raw file contents, and tool noise. Do not copy transcripts or tool parameters. Every candidate must be a concise derived fact.`;

function blockText(content: readonly unknown[]): string {
  return content.map((block) => typeof block === "object" && block !== null && "type" in block && (block as { type: string }).type === "text"
    ? String((block as { text?: unknown }).text ?? "") : "").join("\n");
}

function parseDecision(text: string): CurationDecision {
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { action: "ignore", reason: "curator returned no decision" };
  const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  if (value.action === "ignore") return { action: "ignore", reason: String(value.reason ?? "not durable") };
  if (value.action === "activity" && typeof value.summary === "string") return { action: "activity", summary: value.summary, ...(typeof value.projectId === "string" ? { projectId: value.projectId } : {}) };
  if (["capture", "knowledge", "todo", "project"].includes(String(value.action)) && typeof value.title === "string" && typeof value.summary === "string") {
    return { action: value.action as "capture", title: value.title, summary: value.summary, ...(typeof value.projectId === "string" ? { projectId: value.projectId } : {}) };
  }
  return { action: "ignore", reason: "curator decision failed validation" };
}

function parseTaskAnalysis(text: string): TaskOutcomeAnalysis {
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { summary: "任务已完成。", candidates: [], unresolved: [] };
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const candidates = Array.isArray(value.candidates) ? value.candidates.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const kind = String(record.kind);
      if (!["update", "activity", "todo", "knowledge", "project", "unresolved", "capture"].includes(kind)) return [];
      if (typeof record.summary !== "string") return [];
      const patch = typeof record.patch === "object" && record.patch !== null && !Array.isArray(record.patch) ? record.patch as TaskOutcomeAnalysis["candidates"][number]["patch"] : undefined;
      return [{
        kind: kind as TaskOutcomeAnalysis["candidates"][number]["kind"],
        title: typeof record.title === "string" ? record.title : "任务结果",
        summary: record.summary,
        confidence: (record.confidence === "high" || record.confidence === "low" ? record.confidence : "medium") as CandidateConfidence,
        ...(typeof record.targetId === "string" ? { targetId: record.targetId } : {}),
        ...(typeof record.projectId === "string" ? { projectId: record.projectId } : {}),
        ...(patch ? { patch } : {}),
      }];
    }) : [];
    return {
      summary: typeof value.summary === "string" ? value.summary : "任务已完成。",
      candidates,
      unresolved: Array.isArray(value.unresolved) ? value.unresolved.filter((item): item is string => typeof item === "string") : [],
    };
  } catch {
    return { summary: "任务已完成。", candidates: [], unresolved: [] };
  }
}

export class DshManagedCuratorAgent implements CuratorAgent, TaskCuratorAgent {
  constructor(readonly ctx: Context, readonly fallbackSessionId?: string | undefined) {}

  async analyze(input: { userText: string; assistantText: string; toolNames: string[]; provenance: Provenance }): Promise<CurationDecision> {
    const parentId = input.provenance.session_id ? SessionId(input.provenance.session_id) : undefined;
    const parent = (parentId ? this.ctx.agents.get(parentId) : undefined)
      ?? (this.fallbackSessionId ? this.ctx.agents.get(SessionId(this.fallbackSessionId)) : undefined)
      ?? this.ctx.agents.currentInitiator();
    if (!parent) return { action: "ignore", reason: "originating DSH Agent is no longer live" };
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`personal-curator-${randomUUID()}`),
      meta: {
        parentSession: parent.id,
        origin: "subagent",
        delegationDepth: (parent.session.header.delegationDepth ?? 0) + 1,
        ...(input.provenance.workspace ? { cwd: input.provenance.workspace } : {}),
      },
      agentOptions: { ...parent.options, maxTokens: Math.min(parent.options.maxTokens ?? 1200, 1200) },
      setup: (agentCtx) => {
        agentCtx.tools.restrict({ allow: ["personal_search", "personal_get", "personal_get_project_context"] });
        agentCtx.systemPrompt.section({ name: "personal-os:curator", order: 1000, text: CURATOR_PROMPT });
      },
    });
    try {
      handle.agent.followup(createUserMessage({
        source: { kind: "plugin", plugin: "dsh-personal-os" },
        content: [{ type: "text", text: JSON.stringify({ user: input.userText, assistant: input.assistantText, tools: input.toolNames, provenance: input.provenance }) }],
      }));
      await handle.agent.whenIdle();
      const message = [...handle.agent.session.events].reverse().find((event) => event.type === "assistant/message");
      return message?.type === "assistant/message" ? parseDecision(blockText(message.data.message.content)) : { action: "ignore", reason: "curator produced no response" };
    } finally {
      await handle.dispose();
    }
  }

  async analyzeTask(input: Parameters<NonNullable<TaskCuratorAgent["analyzeTask"]>>[0]): Promise<TaskOutcomeAnalysis> {
    const parentId = input.provenance.session_id ? SessionId(input.provenance.session_id) : undefined;
    const parent = (parentId ? this.ctx.agents.get(parentId) : undefined)
      ?? (this.fallbackSessionId ? this.ctx.agents.get(SessionId(this.fallbackSessionId)) : undefined)
      ?? this.ctx.agents.currentInitiator();
    if (!parent) return { summary: "任务已完成。", candidates: [], unresolved: [] };
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(`personal-task-curator-${randomUUID()}`),
      meta: {
        parentSession: parent.id,
        origin: "subagent",
        delegationDepth: (parent.session.header.delegationDepth ?? 0) + 1,
        ...(input.provenance.workspace ? { cwd: input.provenance.workspace } : {}),
      },
      agentOptions: { ...parent.options, maxTokens: Math.min(parent.options.maxTokens ?? 1400, 1400) },
      setup: (agentCtx) => {
        agentCtx.tools.restrict({ allow: ["personal_search", "personal_get", "personal_get_project_context"] });
        agentCtx.systemPrompt.section({ name: "personal-os:task-outcome-curator", order: 1000, text: TASK_CURATOR_PROMPT });
      },
    });
    try {
      handle.agent.followup(createUserMessage({
        source: { kind: "plugin", plugin: "dsh-personal-os" },
        content: [{ type: "text", text: JSON.stringify(input) }],
      }));
      await handle.agent.whenIdle();
      const message = [...handle.agent.session.events].reverse().find((event) => event.type === "assistant/message");
      return message?.type === "assistant/message" ? parseTaskAnalysis(blockText(message.data.message.content)) : { summary: "任务已完成。", candidates: [], unresolved: [] };
    } finally {
      await handle.dispose();
    }
  }
}

export function sessionEventEvidence(event: SessionEvent): SessionEvidenceEvent | undefined {
  switch (event.type) {
    case "turn/start": return { seq: event.seq, time: event.time, type: event.type, turn: event.data.turn };
    case "turn/end": return { seq: event.seq, time: event.time, type: event.type, turn: event.data.turn, reason: event.data.reason };
    case "user/message": return { seq: event.seq, time: event.time, type: event.type, content: event.data.content, source: event.data.source };
    case "assistant/message": return { seq: event.seq, time: event.time, type: event.type, content: event.data.message.content, turn: event.data.turn };
    case "tool/call": return { seq: event.seq, time: event.time, type: event.type, toolName: event.data.name, callId: String(event.data.callId), turn: event.data.turn };
    case "tool/result": {
      const block = event.data.message.content[0];
      return { seq: event.seq, time: event.time, type: event.type, callId: String(block.toolCallId), error: event.data.error ?? (block.isError ? { name: "ToolError", code: "tool-result-error" } : undefined), turn: event.data.turn };
    }
    default: return undefined;
  }
}

export function sessionKindFromOrigin(origin?: string): NonNullable<SessionEvidence["sessionKind"]> {
  if (origin === "subagent") return "subagent";
  if (origin === "automation" || origin?.startsWith("automation:")) return "automation";
  if (origin === "system" || origin?.startsWith("system:")) return "system";
  return "main";
}

export function sessionEvidence(session: Session): SessionEvidence {
  return {
    sessionId: session.id,
    workspace: session.header.cwd,
    sessionKind: sessionKindFromOrigin(session.header.origin),
    events: session.events.map(sessionEventEvidence).filter((event): event is SessionEvidenceEvent => event !== undefined),
  };
}

export function registerTaskOutcomeCuration(ctx: Context, service: PersonalOsService): () => void {
  return ctx.on("session/event", (session, event) => {
    if (event.type !== "turn/end" || sessionKindFromOrigin(session.header.origin) !== "main") return;
    const agent = new DshManagedCuratorAgent(ctx, String(session.id));
    const evidence = sessionEvidence(session);
    void service.observeTaskOutcome({ evidence, currentWorkspace: session.header.cwd, force: explicitTaskFinalizationRequested(evidence.events) }, new AbortController().signal, agent).catch(() => undefined);
  });
}

export interface SessionQueryReader {
  listSessions(): Promise<Array<{ id: string; cwd?: string; origin?: string }>>;
  listEvents(id: string): Promise<SessionEvidenceEvent[]>;
}

export async function backfillHistoricalSessions(options: {
  query: SessionQueryReader;
  curator: { curate: (evidence: SessionEvidence, settings: import("./settingsStore.ts").PersonalOsSettings, currentWorkspace?: string) => Promise<unknown> };
  settings: import("./settingsStore.ts").PersonalOsSettings;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, current: string) => void;
  currentWorkspace?: string | undefined;
}): Promise<{ completed: number; failed: string[]; canceled: boolean }> {
  if (!options.settings.historicalLearning) return { completed: 0, failed: [], canceled: false };
  const sessions = await options.query.listSessions();
  let completed = 0; const failed: string[] = [];
  for (const session of sessions) {
    if (options.signal?.aborted) return { completed, failed, canceled: true };
    options.onProgress?.(completed, sessions.length, session.id);
    try {
      await options.curator.curate({ sessionId: session.id, workspace: session.cwd, sessionKind: sessionKindFromOrigin(session.origin), events: await options.query.listEvents(session.id) }, options.settings, options.currentWorkspace);
      completed += 1;
    } catch { failed.push(session.id); }
  }
  return { completed, failed, canceled: false };
}
