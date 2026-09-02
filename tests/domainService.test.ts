import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { serializeDocument } from "../src/domain/markdown.ts";
import {
  DomainValidationError,
  PersonalOsDomainService,
  WATCH_IGNORE_PATTERN,
  RevisionConflictError,
} from "../src/domain/service.ts";

const roots: string[] = [];

async function harness(): Promise<PersonalOsDomainService> {
  const root = await mkdtemp(join(tmpdir(), "personal-os-domain-"));
  roots.push(root);
  const service = new PersonalOsDomainService(root);
  await service.initialize({ watch: false });
  return service;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Markdown Domain Service", () => {
  it("round-trips Knowledge through Markdown, startup rebuild, rename, archive and restore", async () => {
    const service = await harness();
    const created = await service.create({
      kind: "knowledge",
      title: "Harness 插件机制",
      body: "Remote 和 Slot 是关键。",
      tags: ["DSH", "Plugin"],
      properties: { custom: "preserve-me" },
    });
    expect(created.id).toMatch(/^kn_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await readFile(created.path, "utf8")).toContain("schema: dsh-personal-os/v1");

    const renamed = join(service.root, "knowledge", `重命名-${basename(created.path)}`);
    await rename(created.path, renamed);
    await service.refresh();
    expect(service.get(created.id)?.path).toBe(renamed);
    expect(service.get(created.id)?.properties).toEqual({ custom: "preserve-me" });

    await service.archive(created.id);
    expect(service.get(created.id)?.archived).toBe(true);
    await service.restore(created.id);
    expect(service.get(created.id)?.archived).toBe(false);

    const rebuilt = new PersonalOsDomainService(service.root);
    await rebuilt.initialize({ watch: false });
    expect(rebuilt.get(created.id)?.body).toContain("Remote");
  });

  it("rejects stale Inspector saves and preserves an externally edited version", async () => {
    const service = await harness();
    const created = await service.create({ kind: "knowledge", title: "Concurrent", body: "one" });
    const external = { ...created, body: "external", updated_at: new Date().toISOString() };
    await writeFile(created.path, serializeDocument(external), "utf8");

    await expect(service.update(created.id, { body: "inspector" }, created.revision))
      .rejects.toBeInstanceOf(RevisionConflictError);
    expect(await readFile(created.path, "utf8")).toContain("external");
  });

  it("manages Todo dates and state while deriving objective Project progress", async () => {
    const service = await harness();
    const project = await service.create({ kind: "project", title: "Ship OS", target_date: "2026-09-30" });
    const first = await service.create({ kind: "todo", title: "Build", due_date: "2026-08-21", priority: "p0" });
    const second = await service.create({ kind: "todo", title: "Test", start_date: "2026-08-22" });
    await service.link(first.id, { type: "belongs_to", target: project.id });
    await service.link(second.id, { type: "belongs_to", target: project.id });
    await service.update(first.id, { state: "done" });

    expect(service.projectProgress(project.id)).toEqual({ projectId: project.id, total: 2, completed: 1, percent: 50 });
    expect(service.get(first.id)?.completed_at).toBeTruthy();
    expect(service.calendar("2026-08").map((item) => item.role)).toEqual(["todo-due", "todo-start"]);

    const otherProject = await service.create({ kind: "project", title: "Other" });
    await expect(service.link(first.id, { type: "belongs_to", target: otherProject.id }))
      .rejects.toThrow("at most one Project");
    expect(service.projectProgress(otherProject.id).percent).toBeUndefined();
  });

  it("validates explicit Relations and builds reverse/project/graph projections", async () => {
    const service = await harness();
    const project = await service.create({ kind: "project", title: "Relations" });
    const a = await service.create({ kind: "knowledge", title: "A" });
    const b = await service.create({ kind: "knowledge", title: "B" });
    const todo = await service.create({ kind: "todo", title: "Act" });
    await service.link(a.id, { type: "belongs_to", target: project.id });
    await service.link(a.id, { type: "related_to", target: b.id });
    await service.link(b.id, { type: "related_to", target: a.id });
    await service.link(todo.id, { type: "derived_from", target: a.id });

    expect(service.projectContext(project.id).knowledge.map((item) => item.id)).toContain(a.id);
    expect(service.reverseRelations(b.id)[0]?.source.id).toBe(a.id);
    expect(service.graph({ focusId: b.id }).edges).toEqual([{ source: a.id, target: b.id, type: "related_to" }]);
    expect(service.get(b.id)?.relations).toEqual([]);
    await expect(service.link(project.id, { type: "related_to", target: a.id }))
      .rejects.toBeInstanceOf(DomainValidationError);
  });

  it("processes Capture idempotently and preserves the archived original", async () => {
    const service = await harness();
    const capture = await service.create({ kind: "capture", title: "Remember", body: "A useful fact" });
    const first = await service.processCapture(capture.id, [{ kind: "knowledge", title: "Useful fact", body: capture.body }]);
    const second = await service.processCapture(capture.id, [{ kind: "knowledge", title: "Duplicate" }]);

    expect(first.capture.archived).toBe(true);
    expect(first.capture.state).toBe("processed");
    expect(second.produced.map((item) => item.id)).toEqual(first.produced.map((item) => item.id));
    expect(service.list({ kind: "knowledge" })).toHaveLength(1);
  });

  it("archives a Capture under archive/captures without a kind-directory-mismatch diagnostic", async () => {
    const service = await harness();
    const capture = await service.create({ kind: "capture", title: "Archive me", body: "fact" });
    await service.archive(capture.id);

    const archived = service.get(capture.id);
    expect(archived?.archived).toBe(true);
    expect(archived?.path).toContain(join("archive", "captures"));

    const snapshot = await service.refresh();
    expect(snapshot.diagnostics.filter(
      (entry) => entry.code === "kind-directory-mismatch" && entry.documentId === capture.id,
    )).toHaveLength(0);
  });

  it("resumes a partially processed Capture without duplicating already linked outputs", async () => {
    const service = await harness();
    const capture = await service.create({ kind: "capture", title: "Partial capture", body: "source" });
    const firstOutput = { kind: "knowledge" as const, title: "Recovered knowledge", body: "fact" };
    await expect(service.processCapture(capture.id, [firstOutput, { kind: "todo", title: "Broken todo", due_date: "2026-02-30" }])).rejects.toThrow("Dates must use YYYY-MM-DD");
    expect(service.get(capture.id)?.relations.filter((relation) => relation.type === "produced")).toHaveLength(1);

    const result = await service.processCapture(capture.id, [firstOutput, { kind: "todo", title: "Recovered todo", due_date: "2026-08-22" }]);

    expect(result.produced).toHaveLength(2);
    expect(service.list({ kind: "knowledge" }).filter((item) => item.title === firstOutput.title)).toHaveLength(1);
    expect(service.list({ kind: "todo" }).filter((item) => item.title === "Recovered todo")).toHaveLength(1);
    expect(result.capture.archived).toBe(true);
  });

  it("searches multilingual content, tags, state and attachment filenames", async () => {
    const service = await harness();
    const project = await service.create({ kind: "project", title: "内容系统" });
    const knowledge = await service.create({
      kind: "knowledge",
      title: "Agent Runtime",
      body: "学习 DSH 架构。![图](../attachments/runtime-map.png)",
      tags: ["架构"],
    });
    await service.link(knowledge.id, { type: "belongs_to", target: project.id });

    expect(service.search("DSH 架构", { tags: ["架构"], projectId: project.id })[0]?.document.id).toBe(knowledge.id);
    expect(service.search("runtime-map.png")[0]?.document.id).toBe(knowledge.id);
    expect(service.search("", { kinds: ["project"] })[0]?.document.id).toBe(project.id);
  });

  it("composes Today, Timeline and Calendar without persisting derived progress", async () => {
    const service = await harness();
    const date = "2026-08-21";
    const project = await service.create({ kind: "project", title: "Today project" });
    await service.create({ kind: "todo", title: "Due", due_date: date });
    await service.create({ kind: "capture", title: "Inbox" });
    await service.create({ kind: "knowledge", title: "Recent" });
    await service.recordSessionActivity({ actor: "curator", summary: "unfinished implementation — 继续", targetId: project.id, projectId: project.id, at: `${date}T10:00:00.000Z` });

    const today = service.today(date);
    expect(today.todos).toHaveLength(1);
    expect(today.projects[0]?.progress.percent).toBeUndefined();
    expect(today.inbox).toHaveLength(1);
    expect(today.knowledge).toHaveLength(1);
    expect(today.continue?.projectId).toBe(project.id);
    expect(service.timelineEntries({ date, source: "session" })).toHaveLength(1);
    expect(await readFile(project.path, "utf8")).not.toContain("percent");
  });

  it("coalesces nearby curator activity from the same session and topic", async () => {
    const service = await harness();
    await service.recordSessionActivity({
      actor: "curator",
      summary: "完成第一轮调研",
      projectId: "project_aiup",
      at: "2026-08-21T10:00:00.000Z",
      session: { sessionId: "session-1", seqFrom: 1, seqTo: 4 },
    });
    const merged = await service.recordSessionActivity({
      actor: "curator",
      summary: "完成三方调研并形成结论",
      projectId: "project_aiup",
      at: "2026-08-21T10:08:00.000Z",
      session: { sessionId: "session-1", seqFrom: 5, seqTo: 9 },
    });

    expect(service.timelineEntries({ source: "session" })).toEqual([merged]);
    expect(merged).toMatchObject({
      summary: "完成三方调研并形成结论",
      at: "2026-08-21T10:08:00.000Z",
      session: { sessionId: "session-1", seqFrom: 1, seqTo: 9 },
    });

    const reloaded = new PersonalOsDomainService(service.root);
    await reloaded.initialize({ watch: false });
    expect(reloaded.timelineEntries({ source: "session" })).toEqual([merged]);
  });

  it("keeps curator activity separate across topics or longer intervals", async () => {
    const service = await harness();
    await service.recordSessionActivity({ actor: "curator", summary: "A", projectId: "a", at: "2026-08-21T10:00:00.000Z", session: { sessionId: "session-1", seqFrom: 1, seqTo: 2 } });
    await service.recordSessionActivity({ actor: "curator", summary: "B", projectId: "b", at: "2026-08-21T10:05:00.000Z", session: { sessionId: "session-1", seqFrom: 3, seqTo: 4 } });
    await service.recordSessionActivity({ actor: "curator", summary: "A later", projectId: "a", at: "2026-08-21T10:31:00.000Z", session: { sessionId: "session-1", seqFrom: 5, seqTo: 6 } });

    expect(service.timelineEntries({ source: "session" })).toHaveLength(3);
  });

  it("isolates invalid files and reports duplicate IDs and unresolved Relations", async () => {
    const service = await harness();
    const good = await service.create({ kind: "knowledge", title: "Good" });
    await writeFile(join(service.root, "knowledge", "broken.md"), "# no frontmatter", "utf8");
    await writeFile(join(service.root, "knowledge", "duplicate.md"), await readFile(good.path, "utf8"), "utf8");
    await service.refresh();

    expect(service.get(good.id)).toBeTruthy();
    expect(service.snapshot().diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "pending-initialization", "duplicate-id",
    ]));
  });

  it("retains both last-valid documents when one file is externally changed to the other's ID", async () => {
    const service = await harness();
    const first = await service.create({ kind: "knowledge", title: "First" });
    const second = await service.create({ kind: "knowledge", title: "Second" });
    const collided = (await readFile(second.path, "utf8")).replace(second.id, first.id);
    await writeFile(second.path, collided, "utf8");

    await service.refresh();

    expect(service.get(first.id)?.title).toBe("First");
    expect(service.get(second.id)?.title).toBe("Second");
    expect(service.snapshot().diagnostics.filter((item) => item.code === "duplicate-id")).toHaveLength(2);
  });

  it("keeps the last valid index entry when external Frontmatter or Relations become invalid", async () => {
    const service = await harness();
    const todo = await service.create({ kind: "todo", title: "Valid Todo", body: "last valid" });
    const knowledgeA = await service.create({ kind: "knowledge", title: "Knowledge A" });
    const knowledgeB = await service.create({ kind: "knowledge", title: "Knowledge B" });

    await writeFile(todo.path, serializeDocument({ ...todo, state: "invalid" as never, body: "must not enter the index" }), "utf8");
    await writeFile(knowledgeA.path, serializeDocument({ ...knowledgeA, relations: [{ type: "belongs_to", target: knowledgeB.id }] }), "utf8");
    await service.refresh();

    expect(service.get(todo.id)?.body).toBe("last valid");
    expect(service.get(todo.id)?.state).toBe("open");
    expect(service.get(knowledgeA.id)?.relations).toEqual([]);
    expect(service.snapshot().diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "invalid-frontmatter", "unsupported-relation",
    ]));
  });

  it("keeps last-valid Relations when an external edit adds duplicates or missing targets", async () => {
    const service = await harness();
    const target = await service.create({ kind: "knowledge", title: "Target" });
    const source = await service.create({ kind: "knowledge", title: "Source", relations: [{ type: "related_to", target: target.id }] });
    await writeFile(source.path, serializeDocument({ ...source, body: "duplicate must stay out", relations: [
      { type: "related_to", target: target.id },
      { type: "related_to", target: target.id },
    ] }), "utf8");
    await service.refresh();
    expect(service.get(source.id)?.body).toBe(source.body);
    expect(service.snapshot().diagnostics.map((item) => item.code)).toContain("duplicate-relation");

    await writeFile(source.path, serializeDocument({ ...source, body: "missing must stay out", relations: [{ type: "related_to", target: "knowledge_missing" }] }), "utf8");
    await service.refresh();
    expect(service.get(source.id)?.body).toBe(source.body);
    expect(service.snapshot().diagnostics.map((item) => item.code)).toContain("unresolved-relation");
  });

  it("rejects impossible local dates and timestamps without an explicit offset", async () => {
    const service = await harness();
    const impossibleDate = await service.create({ kind: "todo", title: "Impossible date", due_date: "2026-08-21" });
    const ambiguousTimestamp = await service.create({ kind: "knowledge", title: "Ambiguous timestamp" });
    await writeFile(impossibleDate.path, serializeDocument({ ...impossibleDate, due_date: "2026-02-30" }), "utf8");
    await writeFile(ambiguousTimestamp.path, serializeDocument({ ...ambiguousTimestamp, updated_at: "2026-08-21T09:30:00" }), "utf8");

    await service.refresh();

    expect(service.get(impossibleDate.id)?.due_date).toBe("2026-08-21");
    expect(service.get(ambiguousTimestamp.id)?.updated_at).toBe(ambiguousTimestamp.updated_at);
    expect(service.snapshot().diagnostics.filter((item) => item.code === "invalid-frontmatter")).toHaveLength(2);
  });

  it("keeps user templates authored-only and generates system fields on save", async () => {
    const service = await harness();
    await writeFile(join(service.root, "templates", "todo.md"), "---\ntags: [from-template]\npriority: p1\nproperties:\n  ritual: weekly\n---\n# My Todo Template\n\n## Outcome\n", "utf8");
    const template = await service.createFromTemplate("todo", "Template todo");
    expect(template.draft.kind).toBe("todo");
    expect(template.draft).not.toHaveProperty("id");
    const created = await service.create(template.draft);
    expect(created.id).toMatch(/^todo_/);
    expect(created.schema).toBe("dsh-personal-os/v1");
    const defaulted = await service.create({ kind: "todo", title: "Uses template" });
    expect(defaulted.body).toContain("My Todo Template");
    expect(defaulted.tags).toEqual(["from-template"]);
    expect(defaulted.priority).toBe("p1");
    expect(defaulted.properties).toMatchObject({ ritual: "weekly" });
  });

  it("watches external edits and renames while keeping the stable identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "personal-os-watch-")); roots.push(root);
    const service = new PersonalOsDomainService(root); await service.initialize();
    const created = await service.create({ kind: "knowledge", title: "Before", body: "original" });
    await new Promise((resolve) => setTimeout(resolve, 220));
    const source = (await readFile(created.path, "utf8")).replace("title: Before", "title: After").replace("original", "externally edited");
    const renamed = join(root, "knowledge", "renamed-by-user.md");
    await writeFile(created.path, source, "utf8"); await rename(created.path, renamed);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(service.get(created.id)).toMatchObject({ id: created.id, title: "After", body: "externally edited", path: renamed });
    await service.close();
  });

  it("ignores the hidden version-history repository in every path style", () => {
    expect(WATCH_IGNORE_PATTERN.test("C:/Users/u/data/.git/index.lock")).toBe(true);
    expect(WATCH_IGNORE_PATTERN.test("C:\\Users\\u\\data\\.git\\index.lock")).toBe(true);
    expect(WATCH_IGNORE_PATTERN.test("/home/u/data/.git")).toBe(true);
    expect(WATCH_IGNORE_PATTERN.test("/home/u/data/knowledge/note.md")).toBe(false);
    expect(WATCH_IGNORE_PATTERN.test("/home/u/data/knowledge/.github.md")).toBe(false);
  });

  it("never overwrites another document when archive or restore filenames collide", async () => {
    const service = await harness();
    const archivedFirst = await service.create({ kind: "knowledge", title: "Same name", body: "first" });
    await service.archive(archivedFirst.id);
    const activeSecond = await service.create({ kind: "knowledge", title: "Same name", body: "second" });
    const restoredFirst = await service.restore(archivedFirst.id);
    expect(restoredFirst.path).not.toBe(activeSecond.path);
    expect((await readFile(restoredFirst.path, "utf8"))).toContain("first");
    expect((await readFile(activeSecond.path, "utf8"))).toContain("second");

    await service.archive(restoredFirst.id);
    const archivedSecond = await service.archive(activeSecond.id);
    expect(archivedSecond.path).not.toBe(service.get(restoredFirst.id)?.path);
    expect(service.get(restoredFirst.id)?.body).toBe("first");
    expect(service.get(activeSecond.id)?.body).toBe("second");

    const activeThird = await service.create({ kind: "knowledge", title: "Duplicate identity", body: "current" });
    const staleArchivePath = join(service.root, "archive", "knowledge", basename(activeThird.path));
    await writeFile(staleArchivePath, serializeDocument({ ...activeThird, body: "stale duplicate", path: staleArchivePath, archived: true }), "utf8");
    const archivedThird = await service.archive(activeThird.id);
    expect(archivedThird.path).not.toBe(staleArchivePath);
    expect(await readFile(staleArchivePath, "utf8")).toContain("stale duplicate");
    expect(await readFile(archivedThird.path, "utf8")).toContain("current");
  });
});
