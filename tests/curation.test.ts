import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { balancedCurationCandidate, CurationStateStore, SessionCurator, compactEvidence, eligibleSession, type CurationDecision } from "../src/curation.ts";
import { PersonalOsDomainService } from "../src/domain/service.ts";
import { backfillHistoricalSessions } from "../src/sessionIntegration.ts";
import { emptyPersonalOsSettings } from "../src/settingsStore.ts";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "personal-curation-")); roots.push(root);
  const domain = new PersonalOsDomainService(join(root, "vault")); await domain.initialize({ watch: false });
  return { root, domain, state: new CurationStateStore(join(root, "data")) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Session curation", () => {
  it("compacts only user-authored evidence and excludes Personal OS feedback tools", () => {
    const compact = compactEvidence({ sessionId: "s1", events: [
      { seq: 1, type: "user/message", source: { kind: "plugin" }, content: [{ type: "text", text: "injected" }] },
      { seq: 2, type: "user/message", source: { kind: "user" }, content: [{ type: "text", text: "记住这个决定" }] },
      { seq: 3, type: "assistant/message", content: [{ type: "text", text: "好的" }] },
      { seq: 4, type: "tool/call", toolName: "personal_create" },
      { seq: 5, type: "tool/call", toolName: "read_file" },
    ] });
    expect(compact).toMatchObject({ userText: "记住这个决定", assistantText: "好的", toolNames: ["read_file"], seqFrom: 1, seqTo: 5 });
  });

  it("persists a derived fact once and advances the per-session watermark", async () => {
    const { domain, state } = await setup();
    const analyze = vi.fn(async (): Promise<CurationDecision> => ({ action: "knowledge", title: "架构决定", summary: "Markdown 是唯一真源。" }));
    const curator = new SessionCurator(domain, state, { analyze });
    const settings = { ...emptyPersonalOsSettings(), personalDataDirectory: domain.root };
    const evidence = { sessionId: "s1", workspace: "/work", sessionKind: "main" as const, events: [{ seq: 1, type: "user/message", source: { kind: "user" }, content: "决定用 Markdown" }] };
    await curator.curate(evidence, settings, "/work");
    await curator.curate(evidence, settings, "/work");
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(domain.list({ kind: "knowledge" })).toHaveLength(1);
    expect((await state.load()).watermarks.s1).toBe(1);
    expect(domain.list({ kind: "knowledge" })[0]?.source).toMatchObject({ session_id: "s1", seq_from: 1, seq_to: 1 });
  });

  it("recovers a crash-window retry from provenance without duplicating the fact", async () => {
    const { domain, state } = await setup();
    const analyze = vi.fn(async (): Promise<CurationDecision> => ({ action: "knowledge", title: "Durable", summary: "Already written" }));
    const curator = new SessionCurator(domain, state, { analyze });
    const settings = { ...emptyPersonalOsSettings(), personalDataDirectory: domain.root };
    const evidence = { sessionId: "crash", sessionKind: "main" as const, events: [{ seq: 7, type: "user/message", source: { kind: "user" }, content: "记住这个决定" }] };
    const save = state.save.bind(state); let attempts = 0;
    vi.spyOn(state, "save").mockImplementation(async (value) => { attempts += 1; if (attempts <= 2) throw new Error("simulated crash"); await save(value); });
    await expect(curator.curate(evidence, settings)).rejects.toThrow("simulated crash");
    await curator.curate(evidence, settings);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(domain.list({ kind: "knowledge" })).toHaveLength(1);
    expect((await state.load()).watermarks.crash).toBe(7);
  });

  it("uses durable-signal gating in balanced mode while proactive remains broader", () => {
    expect(balancedCurationCandidate("帮我解释一下这个概念")).toBe(false);
    expect(balancedCurationCandidate("我们决定下周完成这个 Todo")).toBe(true);
  });

  it("respects disabled, excluded, subagent, and workspace scopes", () => {
    const base = { ...emptyPersonalOsSettings(), personalDataDirectory: "/vault" };
    expect(eligibleSession({ sessionId: "s", events: [] }, { ...base, curationLevel: "off" })).toBe(false);
    expect(eligibleSession({ sessionId: "s", sessionKind: "subagent", events: [] }, base)).toBe(false);
    expect(eligibleSession({ sessionId: "s", sessionKind: "automation", events: [] }, base)).toBe(false);
    expect(eligibleSession({ sessionId: "s", sessionKind: "system", events: [] }, base)).toBe(false);
    expect(eligibleSession({ sessionId: "s", workspace: "/a", events: [] }, { ...base, excludedSessions: ["s"] })).toBe(false);
    expect(eligibleSession({ sessionId: "s", workspace: "/a", events: [] }, base, "/b")).toBe(false);
    expect(eligibleSession({ sessionId: "s", workspace: "/a", events: [] }, { ...base, crossWorkspaceLearning: true }, "/b")).toBe(true);
  });

  it("backfills cold sessions with progress, cancellation, and per-session failure isolation", async () => {
    const settings = { ...emptyPersonalOsSettings(), personalDataDirectory: "/vault", historicalLearning: true, crossWorkspaceLearning: true };
    const curate = vi.fn(async (evidence: { sessionId: string }) => { if (evidence.sessionId === "bad") throw new Error("bad log"); return { action: "ignore", reason: "test" } as const; });
    const progress = vi.fn();
    const result = await backfillHistoricalSessions({
      query: { listSessions: async () => [{ id: "good" }, { id: "bad" }], listEvents: async () => [{ seq: 1, type: "user/message", source: { kind: "user" }, content: "x" }] },
      curator: { curate } as never, settings, onProgress: progress,
    });
    expect(result).toEqual({ completed: 1, failed: ["bad"], canceled: false });
    expect(progress).toHaveBeenCalledTimes(2);
  });
});
