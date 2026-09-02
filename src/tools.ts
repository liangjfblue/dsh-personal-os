import { defineTool, type ToolDefinition, type ToolRunContext } from "@deepseek-ai/dsh-tools";

import type { DocumentKind, RelationType } from "./domain/types.ts";
import type { PersonalOsService } from "./service.ts";

interface ToolsContext {
  tools: { register: (tool: ToolDefinition) => void };
}

const JSON_VALUE = { type: "json" } as const;
const context = { actor: "agent" as const, source: "agent" as const };

function mainSessionId(exec: ToolRunContext): string | undefined {
  const agent = exec.agent;
  if (!agent) return undefined;
  const origin = agent.session.header.origin;
  if (origin === "subagent" || origin === "automation" || origin === "system") return undefined;
  return String(agent.id);
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as never;
}

function present(title: string, rawInput: unknown) {
  return { card: "generic" as const, title, kind: "other" as const, rawInput };
}

function text(title: string, value: unknown) {
  const record = value as { id?: string; title?: string; available?: boolean };
  return [{ type: "text" as const, text: `${title}: ${record.title ?? record.id ?? (record.available === false ? "unavailable" : "done")}` }];
}

export function registerPersonalOsTools(ctx: ToolsContext, service: PersonalOsService): void {
  ctx.tools.register(defineTool({
    name: "personal_search",
    description: "Search the user's Personal OS Markdown only. Use before claiming what the user knows, intends, or is working on.",
    parameters: {
      query: { type: "string", required: true },
      kinds: { type: "array", items: { type: "string", enum: ["capture", "knowledge", "todo", "project"] } },
      tags: { type: "array", items: { type: "string" } },
      projectId: { type: "string" },
      states: { type: "array", items: { type: "string" } },
      includeArchived: { type: "boolean" },
    },
    output: { schema: JSON_VALUE, render: (_args, value) => [{ type: "text", text: `${(value as unknown[]).length} result(s)` }] },
    presentCall: (args) => present("Search Personal OS", args),
    async execute(args, exec) {
      const result = await service.searchDocuments({ query: args.query, filter: { kinds: args.kinds as DocumentKind[] | undefined, tags: args.tags, projectId: args.projectId, states: args.states, includeArchived: args.includeArchived } }, exec.signal);
      await service.recordSessionContextUsage(mainSessionId(exec), result.map((item) => item.document.id), "search");
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_get",
    description: "Read one Personal OS document by stable ID, including its Markdown body and explicit Relations.",
    parameters: { id: { type: "string", required: true } },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Personal document", value) },
    presentCall: (args) => present("Read Personal OS document", args),
    async execute(args, exec) {
      const result = await service.getDocument({ id: args.id }, exec.signal);
      if (result) await service.recordSessionContextUsage(mainSessionId(exec), [result.id], "document");
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_get_today",
    description: "Get compact Today context: Continue, due Todo, active Projects, Inbox count, recent Knowledge, and activity.",
    parameters: { date: { type: "string", description: "Optional local YYYY-MM-DD date." } },
    output: { schema: JSON_VALUE, render: () => [{ type: "text", text: "Today context loaded" }] },
    presentCall: (args) => present("Read Today", args),
    execute: (args, exec) => service.getToday({ date: args.date }, exec.signal).then(asJson),
  }));

  ctx.tools.register(defineTool({
    name: "personal_get_project_context",
    description: "Read a Project with directly related Todo, Knowledge, objective progress, and recent activity.",
    parameters: { id: { type: "string", required: true } },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Project context", (value as { project?: unknown }).project) },
    presentCall: (args) => present("Read Project context", args),
    async execute(args, exec) {
      const result = await service.getProjectContext({ id: args.id }, exec.signal);
      await service.recordSessionContextUsage(mainSessionId(exec), [result.project.id, ...result.todos.map((item) => item.id), ...result.knowledge.map((item) => item.id)], "project-context");
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_capture",
    description: "Save uncertain or not-yet-classified user input as a pending Capture. Do not promote speculation directly to Knowledge.",
    parameters: { title: { type: "string", required: true }, body: { type: "string", required: true }, tags: { type: "array", items: { type: "string" } } },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Captured", value) },
    presentCall: (args) => present("Capture for Inbox", args),
    async execute(args, exec) {
      const result = await service.createDocument({ input: { kind: "capture", title: args.title, body: args.body, tags: args.tags }, context }, exec.signal);
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_create",
    description: "Create a durable Knowledge, Todo, Project, or Capture after the user clearly asks to remember or create it.",
    parameters: {
      kind: { type: "string", required: true, enum: ["capture", "knowledge", "todo", "project"] },
      title: { type: "string", required: true }, body: { type: "string" },
      tags: { type: "array", items: { type: "string" } }, state: { type: "string" }, priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
      startDate: { type: "string" }, dueDate: { type: "string" }, targetDate: { type: "string" },
    },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Created", value) },
    presentCall: (args) => present("Create Personal OS document", args),
    async execute(args, exec) {
      const result = await service.createDocument({ input: { kind: args.kind as DocumentKind, title: args.title, body: args.body, tags: args.tags, state: args.state, priority: args.priority as never, start_date: args.startDate, due_date: args.dueDate, target_date: args.targetDate }, context }, exec.signal);
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_update",
    description: "Update one Personal OS document by stable ID. Supply expectedRevision when editing content previously read.",
    parameters: {
      id: { type: "string", required: true }, expectedRevision: { type: "string" }, title: { type: "string" }, body: { type: "string" },
      tags: { type: "array", items: { type: "string" } }, state: { type: "string" }, priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
      startDate: { type: "string" }, dueDate: { type: "string" }, targetDate: { type: "string" },
    },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Updated", value) },
    presentCall: (args) => present("Update Personal OS document", args),
    async execute(args, exec) {
      const result = await service.updateDocument({ id: args.id, expectedRevision: args.expectedRevision, patch: { title: args.title, body: args.body, tags: args.tags, state: args.state, priority: args.priority as never, start_date: args.startDate, due_date: args.dueDate, target_date: args.targetDate }, context }, exec.signal);
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_link",
    description: "Add or remove an allowed explicit Relation. Never infer or fabricate graph edges.",
    parameters: { sourceId: { type: "string", required: true }, targetId: { type: "string", required: true }, type: { type: "string", required: true, enum: ["belongs_to", "derived_from", "related_to", "produced"] }, remove: { type: "boolean" } },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Relation updated", value) },
    presentCall: (args) => present("Update Relation", args),
    async execute(args, exec) {
      const result = await service.linkDocuments({ sourceId: args.sourceId, relation: { type: args.type as RelationType, target: args.targetId }, remove: args.remove, context }, exec.signal);
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_archive",
    description: "Archive or restore a document. Permanent deletion is accepted only when permanent=true is explicitly requested by the user.",
    parameters: { id: { type: "string", required: true }, restore: { type: "boolean" }, permanent: { type: "boolean" } },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Lifecycle updated", value) },
    presentCall: (args) => present("Archive or restore", args),
    async execute(args, exec) {
      if (args.permanent) {
        const domain = await service.domain();
        await domain.permanentDelete(args.id, true, context);
        await service.checkpoint(`Permanently delete ${args.id}`);
        return asJson({ id: args.id, deleted: true });
      }
      const result = await service.archiveDocument({ id: args.id, restore: args.restore, context }, exec.signal);
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_curate_session",
    description: "Explicitly preserve a completed Session outcome as Activity, Capture, or a durable document using provenance locators only—not transcript copies.",
    parameters: {
      mode: { type: "string", required: true, enum: ["activity", "capture", "knowledge", "todo", "project"] },
      title: { type: "string", required: true }, summary: { type: "string", required: true }, sessionId: { type: "string", required: true },
      seqFrom: { type: "number", required: true }, seqTo: { type: "number", required: true }, workspace: { type: "string" },
    },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Curated", value) },
    presentCall: (args) => present("Curate Session outcome", args),
    async execute(args, exec) {
      const domain = await service.domain();
      if (args.mode === "activity") {
        const activity = await domain.recordSessionActivity({ actor: "curator", summary: args.summary, workspace: args.workspace, session: { sessionId: args.sessionId, seqFrom: args.seqFrom, seqTo: args.seqTo } });
        await service.checkpoint(`Curate Session activity: ${args.title}`);
        return asJson(activity);
      }
      const result = await service.createDocument({ input: { kind: args.mode as DocumentKind, title: args.title, body: args.summary, source: { kind: "conversation", session_id: args.sessionId, seq_from: args.seqFrom, seq_to: args.seqTo, workspace: args.workspace } }, context: { actor: "curator", source: "session" } }, exec.signal);
      return asJson(result);
    },
  }));

  ctx.tools.register(defineTool({
    name: "personal_review_task_outcome",
    description: "Review a completed Task Outcome. Accept selected results, dismiss a proposal, explicitly save unresolved text to Inbox, or undo an applied outcome. Task Outcomes never create Inbox captures automatically.",
    parameters: {
      outcomeId: { type: "string", required: true },
      action: { type: "string", required: true, enum: ["accept-all", "accept", "edit", "retry", "dismiss", "dismiss-proposal", "dismiss-unresolved", "capture-unresolved", "undo"] },
      candidateId: { type: "string" },
      text: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      patch: { type: "json" },
    },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Task Outcome", value) },
    presentCall: (args) => present("Review Task Outcome", args),
    execute: (args, exec) => service.reviewTaskOutcome({
      outcomeId: args.outcomeId,
      action: args.action as import("./service.ts").TaskOutcomeReviewAction,
      ...(args.candidateId ? { candidateId: args.candidateId } : {}),
      ...(args.text ? { text: args.text } : {}),
      ...(args.title ? { title: args.title } : {}),
      ...(args.summary ? { summary: args.summary } : {}),
      ...(args.patch ? { patch: args.patch as never } : {}),
    }, exec.signal).then(asJson),
  }));

  ctx.tools.register(defineTool({
    name: "personal_history",
    description: "List semantic local Version History checkpoints when enabled.",
    parameters: { limit: { type: "number" } },
    output: { schema: JSON_VALUE, render: () => [{ type: "text", text: "Version History" }] },
    presentCall: (args) => present("Read Version History", args),
    execute: (args, exec) => service.getHistory({ limit: args.limit }, exec.signal).then(asJson),
  }));

  ctx.tools.register(defineTool({
    name: "personal_revert",
    description: "Restore a semantic checkpoint by creating a new revert commit. Never resets or rewrites Git history.",
    parameters: { commit: { type: "string", required: true }, summary: { type: "string" } },
    output: { schema: JSON_VALUE, render: (_args, value) => text("Restored", value) },
    presentCall: (args) => present("Restore Version History", args),
    execute: (args, exec) => service.revertHistory({ commit: args.commit, summary: args.summary }, exec.signal).then(asJson),
  }));
}
