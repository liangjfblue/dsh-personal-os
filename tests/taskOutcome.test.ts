import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SessionEvidence } from "../src/curation.ts";
import { emptyPersonalOsSettings } from "../src/settingsStore.ts";
import { isTaskCompletionCandidate, TaskOutcomeManager, TaskOutcomeStateStore } from "../src/taskOutcome.ts";

const settings = { ...emptyPersonalOsSettings(), personalDataDirectory: "/vault", curationLevel: "balanced" as const };

function evidence(events: SessionEvidence["events"]): SessionEvidence {
  return { sessionId: "session-1", workspace: "/workspace", sessionKind: "main", events };
}

describe("Task Outcome curation", () => {
  it("groups clarification, approval, commit, and push into one outcome without an automatic Inbox capture", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const analyzeTask = vi.fn(async () => ({
      summary: "已将会话提炼改为完整任务级整理，并完成提交与推送。",
      candidates: [
        { kind: "activity" as const, title: "完成任务级整理", summary: "任务级 Outcome 链路已完成。", confidence: "high" as const },
        { kind: "capture" as const, title: "可能的后续", summary: "是否继续优化通知样式", confidence: "low" as const },
      ],
    }));
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), { analyzeTask });
    const first = evidence([
      { seq: 1, type: "user/message", content: "修改手动提炼策略" },
      { seq: 2, type: "assistant/message", content: "我先修改策略并验证。" },
      { seq: 3, type: "tool/call", toolName: "apply_patch" },
      { seq: 4, type: "tool/result", toolName: "apply_patch" },
      { seq: 5, type: "assistant/message", content: "修改已完成，测试通过。" },
      { seq: 6, type: "turn/end", reason: { kind: "completed" } },
    ]);
    const firstObservation = await manager.observe(first, settings, { currentWorkspace: "/workspace" });

    expect(firstObservation.proposal?.candidates.map((candidate) => candidate.kind)).toEqual(["activity"]);
    expect(firstObservation.proposal?.unresolved).toEqual(["是否继续优化通知样式"]);

    const continued = evidence([
      ...first.events,
      { seq: 7, type: "user/message", content: "提交吧" },
      { seq: 8, type: "tool/call", toolName: "git_commit" },
      { seq: 9, type: "tool/result" },
      { seq: 10, type: "assistant/message", content: "已提交。" },
      { seq: 11, type: "turn/end", reason: { kind: "completed" } },
      { seq: 12, type: "user/message", content: "推送吧" },
      { seq: 13, type: "tool/call", toolName: "git_push" },
      { seq: 14, type: "tool/result" },
      { seq: 15, type: "assistant/message", content: "已推送，整个任务完成。" },
      { seq: 16, type: "turn/end", reason: { kind: "completed" } },
    ]);
    const secondObservation = await manager.observe(continued, settings, { currentWorkspace: "/workspace" });
    const state = await manager.state();

    expect(secondObservation.task?.id).toBe(firstObservation.task?.id);
    expect(secondObservation.proposal?.id).toBe(firstObservation.proposal?.id);
    expect(secondObservation.proposal?.seqTo).toBe(16);
    expect(Object.keys(state.tasks)).toEqual(["session-1"]);
    expect(Object.keys(state.outcomes)).toHaveLength(1);
    expect(Object.values(state.outcomes)[0]?.candidates.some((candidate) => candidate.kind === "unresolved")).toBe(false);
    expect(analyzeTask).toHaveBeenCalledTimes(2);
  });

  it("does not create an outcome when a turn is waiting or blocked", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const analyzeTask = vi.fn();
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), { analyzeTask });
    const waiting = evidence([
      { seq: 1, type: "user/message", content: "帮我改 README" },
      { seq: 2, type: "assistant/message", content: "你希望改成哪个方向？" },
      { seq: 3, type: "turn/end", reason: { kind: "blocked" } },
    ]);

    expect(isTaskCompletionCandidate(waiting.events)).toMatchObject({ eligible: false, blocked: true });
    const observation = await manager.observe(waiting, settings, { currentWorkspace: "/workspace" });
    expect(observation.task?.status).toBe("blocked");
    expect(observation.proposal).toBeUndefined();
    expect(analyzeTask).not.toHaveBeenCalled();
  });

  it("keeps a normal clarification turn waiting for the user", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), {});
    const observation = await manager.observe(evidence([
      { seq: 1, type: "user/message", content: "优化工作台" },
      { seq: 2, type: "assistant/message", content: "你希望先优化 Today 还是项目页？" },
      { seq: 3, type: "turn/end", reason: { kind: "completed" } },
    ]), settings, { currentWorkspace: "/workspace" });
    expect(observation.task?.status).toBe("waiting_for_user");
    expect(observation.proposal).toBeUndefined();
  });

  it("does not treat completion language without confirmed work evidence as a completed task", () => {
    const result = isTaskCompletionCandidate([
      { seq: 1, type: "user/message", content: "解释一下这个概念" },
      { seq: 2, type: "assistant/message", content: "已经完成。" },
      { seq: 3, type: "turn/end", reason: { kind: "completed" } },
    ]);
    expect(result.eligible).toBe(false);
  });

  it("allows an explicit task-finalization request even when automatic observation is off", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), {
      analyzeTask: async () => ({ summary: "显式整理完成。", candidates: [] }),
    });
    const manual = evidence([
      { seq: 1, type: "user/message", content: "整理本次任务" },
      { seq: 2, type: "assistant/message", content: "正在整理。" },
    ]);

    const observation = await manager.observe(manual, { ...settings, curationLevel: "off" }, { force: true, currentWorkspace: "/workspace" });
    expect(observation.proposal?.status).toBe("ready_for_review");
    expect(observation.proposal?.candidates.map((candidate) => candidate.kind)).toEqual(["activity"]);
  });

  it("creates nothing automatically when task curation is off", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const analyzeTask = vi.fn();
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), { analyzeTask });
    const automatic = evidence([
      { seq: 1, type: "user/message", content: "完成设置改造" },
      { seq: 2, type: "tool/call", toolName: "apply_patch" },
      { seq: 3, type: "tool/result" },
      { seq: 4, type: "assistant/message", content: "设置改造已完成。" },
      { seq: 5, type: "turn/end", reason: { kind: "completed" } },
    ]);
    expect(await manager.observe(automatic, { ...settings, curationLevel: "off" }, { currentWorkspace: "/workspace" })).toEqual({ changed: false });
    expect(analyzeTask).not.toHaveBeenCalled();
  });

  it("starts a distinct outcome for a materially new objective in the same session", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), {
      analyzeTask: async ({ objective }) => ({ summary: `完成：${objective}`, candidates: [] }),
    });
    const first = evidence([
      { seq: 1, type: "user/message", content: "修复任务整理" },
      { seq: 2, type: "tool/call", toolName: "apply_patch" },
      { seq: 3, type: "tool/result" },
      { seq: 4, type: "assistant/message", content: "修复完成。" },
      { seq: 5, type: "turn/end", reason: { kind: "completed" } },
    ]);
    const one = await manager.observe(first, settings, { currentWorkspace: "/workspace" });
    const two = await manager.observe(evidence([
      ...first.events,
      { seq: 6, type: "user/message", content: "重新设计日历页面" },
      { seq: 7, type: "tool/call", toolName: "apply_patch" },
      { seq: 8, type: "tool/result" },
      { seq: 9, type: "assistant/message", content: "日历重新设计完成。" },
      { seq: 10, type: "turn/end", reason: { kind: "completed" } },
    ]), settings, { currentWorkspace: "/workspace" });

    expect(two.task?.id).not.toBe(one.task?.id);
    expect(two.proposal?.objective).toBe("重新设计日历页面");
    expect(Object.keys((await manager.state()).outcomes)).toHaveLength(2);
  });

  it("explains an active task and lets the user split the latest objective", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), {});
    const first = evidence([
      { seq: 1, type: "user/message", content: "优化 Today" },
      { seq: 2, type: "assistant/message", content: "我先检查布局。" },
      { seq: 3, type: "turn/end", reason: { kind: "completed" } },
    ]);
    await manager.observe(first, settings, { currentWorkspace: "/workspace" });
    await manager.observe(evidence([...first.events,
      { seq: 4, type: "user/message", content: "优化通知样式" },
      { seq: 5, type: "assistant/message", content: "我继续检查。" },
      { seq: 6, type: "turn/end", reason: { kind: "completed" } },
    ]), settings, { currentWorkspace: "/workspace" });

    const before = (await manager.listTasks())[0]!;
    expect(before.canSplit).toBe(true);
    expect(before.boundaryReasons).toContain("尚未出现可信的完成证据");
    const after = await manager.correctBoundary("session-1", "split-latest");
    expect(after.objective).toBe("优化通知样式");
    expect(after.seqFrom).toBe(4);
    expect(after.transitionReason).toContain("等待新任务");
  });

  it("lets a conservatively separated objective merge back into the previous task", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "personal-os-task-outcome-"));
    const manager = new TaskOutcomeManager(new TaskOutcomeStateStore(dataDir), { analyzeTask: async () => ({ summary: "完成。", candidates: [] }) });
    const first = evidence([
      { seq: 1, type: "user/message", content: "优化 Today" },
      { seq: 2, type: "tool/call", toolName: "apply_patch" },
      { seq: 3, type: "tool/result" },
      { seq: 4, type: "assistant/message", content: "优化已完成。" },
      { seq: 5, type: "turn/end", reason: { kind: "completed" } },
    ]);
    const original = await manager.observe(first, settings, { currentWorkspace: "/workspace" });
    await manager.observe(evidence([...first.events,
      { seq: 6, type: "user/message", content: "另外，检查窄窗口" },
      { seq: 7, type: "assistant/message", content: "正在检查。" },
      { seq: 8, type: "turn/end", reason: { kind: "completed" } },
    ]), settings, { currentWorkspace: "/workspace" });

    expect((await manager.listTasks())[0]?.canMerge).toBe(true);
    const merged = await manager.correctBoundary("session-1", "merge-previous");
    expect(merged.id).toBe(original.task?.id);
    expect(merged.seqTo).toBe(8);
    expect(merged.boundaryReasons).toContain("用户手动并入上一任务");
  });
});
