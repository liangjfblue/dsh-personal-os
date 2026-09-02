import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionEvidence } from "../src/curation.ts";
import { PersonalOsService } from "../src/service.ts";
import type { TaskCuratorAgent } from "../src/taskOutcome.ts";

const roots: string[] = [];
const signal = () => new AbortController().signal;

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "personal-os-task-service-"));
  roots.push(root);
  const dataDir = join(root, "plugin-data");
  const vault = join(root, "vault");
  const service = new PersonalOsService(new Context(), { dataDir });
  await service.setPersonalDataDirectory({ path: vault }, signal());
  await service.updatePreferences({ curationLevel: "balanced" }, signal());
  await service.domain();
  return { service, dataDir, vault };
}

function completedEvidence(sessionId = "task-session"): SessionEvidence {
  return {
    sessionId,
    workspace: "/workspace",
    sessionKind: "main",
    events: [
      { seq: 1, type: "user/message", content: "完成任务级结果整理" },
      { seq: 2, type: "tool/call", toolName: "apply_patch" },
      { seq: 3, type: "tool/result" },
      { seq: 4, type: "assistant/message", content: "实现已完成，检查通过。" },
      { seq: 5, type: "turn/end", reason: { kind: "completed" } },
    ],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Task Outcome service seam", () => {
  it("reviews one completed task into grouped durable context, stays idempotent, persists, and undoes safely", async () => {
    const { service, dataDir, vault } = await harness();
    const agent: TaskCuratorAgent = { analyzeTask: async () => ({
      summary: "任务级结果整理已经完成。",
      candidates: [
        { kind: "activity", title: "完成任务级整理", summary: "完成任务级结果整理。", confidence: "high" },
        { kind: "knowledge", title: "Task Outcome 规则", summary: "完整任务完成后再沉淀结果，不能按单轮写入 Inbox。", confidence: "medium" },
      ],
    }) };

    const observed = await service.observeTaskOutcome({ evidence: completedEvidence(), currentWorkspace: "/workspace" }, signal(), agent);
    expect(observed.proposal?.status).toBe("ready_for_review");
    expect((await service.listDocuments({ kind: "capture" }, signal()))).toHaveLength(0);
    expect((await service.listDocuments({ kind: "knowledge" }, signal()))).toHaveLength(0);

    const applied = await service.reviewTaskOutcome({ outcomeId: observed.proposal!.id, action: "accept-all" }, signal());
    expect(applied.status).toBe("applied");
    const knowledge = await service.listDocuments({ kind: "knowledge" }, signal());
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]?.source).toMatchObject({ task_id: applied.taskId, outcome_id: applied.id });
    expect(await service.listDocuments({ kind: "capture" }, signal())).toHaveLength(0);
    expect((await service.getTimeline({}, signal())).filter((entry) => entry.outcomeId === applied.id)).toHaveLength(1);

    await service.reviewTaskOutcome({ outcomeId: applied.id, action: "accept-all" }, signal());
    expect(await service.listDocuments({ kind: "knowledge" }, signal())).toHaveLength(1);

    await service.close();
    const restarted = new PersonalOsService(new Context(), { dataDir });
    expect((await restarted.getTaskOutcome({ id: applied.id }, signal()))?.status).toBe("applied");
    await restarted.setPersonalDataDirectory({ path: vault }, signal());
    await restarted.domain();
    const undone = await restarted.reviewTaskOutcome({ outcomeId: applied.id, action: "undo" }, signal());
    expect(undone.status).toBe("undone");
    expect((await restarted.listDocuments({ kind: "knowledge", archived: true }, signal()))[0]?.archived).toBe(true);
    await restarted.close();
  });

  it("reports a revision conflict per candidate and preserves the newer document", async () => {
    const { service } = await harness();
    const existing = await service.createDocument({ input: { kind: "knowledge", title: "Curation policy", body: "old" } }, signal());
    const observed = await service.observeTaskOutcome({ evidence: completedEvidence("conflict-session"), currentWorkspace: "/workspace" }, signal(), {
      analyzeTask: async () => ({
        summary: "更新现有策略。",
        candidates: [{ kind: "update", title: "更新策略", summary: "把策略改成任务级。", confidence: "high", targetId: existing.id, patch: { body: "task-level" } }],
      }),
    });
    await service.updateDocument({ id: existing.id, patch: { body: "newer external decision" }, expectedRevision: existing.revision }, signal());

    const failed = await service.reviewTaskOutcome({ outcomeId: observed.proposal!.id, action: "accept-all" }, signal());
    expect(failed.status).toBe("failed");
    expect(failed.candidates.find((candidate) => candidate.kind === "update")?.status).toBe("failed");
    expect((await service.getDocument({ id: existing.id }, signal()))?.body).toBe("newer external decision");
    await service.close();
  });

  it("auto-applies only high-confidence candidates in proactive mode", async () => {
    const { service } = await harness();
    await service.updatePreferences({ curationLevel: "proactive" }, signal());
    const observed = await service.observeTaskOutcome({ evidence: completedEvidence("proactive-session"), currentWorkspace: "/workspace" }, signal(), {
      analyzeTask: async () => ({
        summary: "完成主动模式验证。",
        candidates: [
          { kind: "knowledge", title: "已验证规则", summary: "高置信度规则。", confidence: "high" },
          { kind: "knowledge", title: "需要确认的推断", summary: "中置信度推断。", confidence: "medium" },
        ],
      }),
    });

    expect(observed.proposal?.autoAppliedAt).toBeTruthy();
    expect(observed.proposal?.status).toBe("ready_for_review");
    expect(observed.proposal?.candidates.filter((candidate) => candidate.status === "applied").map((candidate) => candidate.confidence)).toEqual(["high", "high"]);
    expect(observed.proposal?.candidates.filter((candidate) => candidate.status === "pending").map((candidate) => candidate.confidence)).toEqual(["medium"]);
    expect((await service.listDocuments({ kind: "knowledge" }, signal())).map((document) => document.title)).toEqual(["已验证规则"]);

    const continued = completedEvidence("proactive-session");
    continued.events.push(
      { seq: 6, type: "user/message", content: "推送吧" },
      { seq: 7, type: "tool/call", toolName: "git_push" },
      { seq: 8, type: "tool/result" },
      { seq: 9, type: "assistant/message", content: "已推送，任务完成。" },
      { seq: 10, type: "turn/end", reason: { kind: "completed" } },
    );
    const afterPush = await service.observeTaskOutcome({ evidence: continued, currentWorkspace: "/workspace" }, signal(), {
      analyzeTask: async () => ({
        summary: "完成主动模式验证并推送。",
        candidates: [
          { kind: "knowledge", title: "已验证规则", summary: "高置信度规则。", confidence: "high" },
          { kind: "knowledge", title: "需要确认的推断", summary: "中置信度推断。", confidence: "medium" },
        ],
      }),
    });
    expect(afterPush.proposal?.id).toBe(observed.proposal?.id);
    expect(afterPush.proposal?.candidates.find((candidate) => candidate.title === "已验证规则")?.status).toBe("applied");
    expect((await service.listDocuments({ kind: "knowledge" }, signal())).map((document) => document.title)).toEqual(["已验证规则"]);
    await service.close();
  });

  it("sends unresolved material to Inbox only after an explicit review action", async () => {
    const { service } = await harness();
    const observed = await service.observeTaskOutcome({ evidence: completedEvidence("explicit-capture"), currentWorkspace: "/workspace" }, signal(), {
      analyzeTask: async () => ({ summary: "完成工作。", candidates: [{ kind: "capture", title: "待确认", summary: "要不要继续做移动端适配", confidence: "low" }] }),
    });
    expect(await service.listDocuments({ kind: "capture" }, signal())).toHaveLength(0);

    await service.reviewTaskOutcome({ outcomeId: observed.proposal!.id, action: "capture-unresolved", text: "要不要继续做移动端适配" }, signal());
    expect((await service.listDocuments({ kind: "capture" }, signal())).map((document) => document.body)).toEqual(["要不要继续做移动端适配"]);
    await service.close();
  });

  it("uses a semantic Version History revert for an applied outcome", async () => {
    const { service } = await harness();
    await service.updatePreferences({ versionHistory: true }, signal());
    const observed = await service.observeTaskOutcome({ evidence: completedEvidence("history-session"), currentWorkspace: "/workspace" }, signal(), {
      analyzeTask: async () => ({ summary: "完成历史验证。", candidates: [{ kind: "knowledge", title: "可撤回知识", summary: "会被语义撤回。", confidence: "high" }] }),
    });
    const applied = await service.reviewTaskOutcome({ outcomeId: observed.proposal!.id, action: "accept-all" }, signal());
    expect(applied.checkpointId).toMatch(/^[0-9a-f]{40}$/);

    const undone = await service.reviewTaskOutcome({ outcomeId: applied.id, action: "undo" }, signal());
    expect(undone.status).toBe("undone");
    expect(await service.listDocuments({ kind: "knowledge" }, signal())).toHaveLength(0);
    expect((await service.getHistory({}, signal())).entries[0]?.summary).toContain("Record Task Outcome correction");
    await service.close();
  });

  it("projects actual Personal Context usage and proposed updates for one session", async () => {
    const { service } = await harness();
    const knowledge = await service.createDocument({ input: { kind: "knowledge", title: "Today 规则", body: "Today 优先展示可继续任务。" } }, signal());
    const observed = await service.observeTaskOutcome({ evidence: completedEvidence("context-session"), currentWorkspace: "/workspace" }, signal(), {
      analyzeTask: async () => ({
        summary: "完成上下文可见性。",
        candidates: [{ kind: "update", title: "更新 Today 规则", summary: "补充任务上下文。", confidence: "medium", targetId: knowledge.id, patch: { body: "Today 展示任务和上下文。" } }],
      }),
    });
    await service.recordSessionContextUsage("context-session", [knowledge.id], "document");

    const context = await service.getSessionTaskContext({ sessionId: "context-session" }, signal());
    expect(context.task?.id).toBe(observed.task?.id);
    expect(context.used).toMatchObject([{ document: { id: knowledge.id, title: "Today 规则" }, source: "document" }]);
    expect(context.proposed.find((item) => item.candidate.kind === "update")).toMatchObject({ candidate: { kind: "update", targetId: knowledge.id }, document: { id: knowledge.id } });
    await service.close();
  });
});
