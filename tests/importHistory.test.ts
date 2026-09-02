import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PersonalOsDomainService } from "../src/domain/service.ts";
import { VaultImporter } from "../src/vaultImport.ts";
import { VersionHistory } from "../src/versionHistory.ts";

const roots: string[] = [];
async function temp(prefix: string) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("recoverable vault import", () => {
  it("preflights then copies Markdown and attachments without changing the source", async () => {
    const root = await temp("personal-import-"); const source = join(root, "source"); const target = join(root, "target");
    await mkdir(join(source, "nested"), { recursive: true });
    const original = "---\ntitle: 旧知识\ncustom: keep-me\ntags: [原有]\n---\n# 内容\n\n- [ ] 保留任务\n\n[[另一篇]]\n\n![[pic.png]]\n";
    await writeFile(join(source, "nested", "note.md"), original); await writeFile(join(source, "nested", "pic.png"), "image");
    const domain = new PersonalOsDomainService(target); await domain.initialize({ watch: false }); const importer = new VaultImporter(domain);
    await expect(importer.preflight(source)).resolves.toMatchObject({ markdown: 1, attachments: 1, conflicts: 0, mode: "copy" });
    const report = await importer.run(source);
    expect(report).toMatchObject({ imported: 1, skipped: 0, canceled: false });
    expect(await readFile(join(source, "nested", "note.md"), "utf8")).toBe(original);
    const document = domain.list({ kind: "knowledge" })[0]!;
    expect(document.body).toContain("[[另一篇]]"); expect(document.body).toContain("- [ ] 保留任务");
    expect(document.body).toContain("../attachments/imported/");
    const namespace = (await readdir(join(target, "attachments", "imported")))[0]!;
    expect(await readFile(join(target, "attachments", "imported", namespace, "nested", "pic.png"), "utf8")).toBe("image");
    expect(document.properties).toMatchObject({ imported_frontmatter: { custom: "keep-me" } });
    expect(document.properties.import_source_key).toMatch(/^[0-9a-f]{16}$/);
    expect(document.properties.import_source_hash).toMatch(/^[0-9a-f]{16}$/);
    await expect(importer.run(source)).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(domain.snapshot().diagnostics.map((item) => item.code)).not.toContain("import-conflict");
    await writeFile(join(source, "nested", "note.md"), `${original}\n外部新增内容\n`);
    await expect(importer.run(source)).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(domain.snapshot().diagnostics.map((item) => item.code)).toContain("import-conflict");
    await domain.refresh();
    expect(domain.snapshot().diagnostics.map((item) => item.code)).toContain("import-conflict");
    await domain.archive(document.id);
    await expect(importer.run(source)).resolves.toMatchObject({ imported: 0, skipped: 1 });
  });

  it("honors cancellation before touching imported content", async () => {
    const root = await temp("personal-import-cancel-"); const source = join(root, "source"); await mkdir(source); await writeFile(join(source, "a.md"), "# A");
    const domain = new PersonalOsDomainService(join(root, "target")); await domain.initialize({ watch: false });
    const controller = new AbortController(); controller.abort();
    await expect(new VaultImporter(domain).run(source, { signal: controller.signal })).resolves.toMatchObject({ imported: 0, canceled: true });
  });

  it("previews and performs the explicitly selected in-place initialization", async () => {
    const root = await temp("personal-import-in-place-"); const source = join(root, "source"); await mkdir(source);
    const note = join(source, "note.md"); await writeFile(note, "---\ncustom: keep\n---\n# Existing note");
    const domain = new PersonalOsDomainService(join(root, "target")); await domain.initialize({ watch: false });
    const importer = new VaultImporter(domain);
    const preview = await importer.preflight(source, "in-place");
    expect(preview).toMatchObject({ mode: "in-place", markdown: 1 });
    expect(preview.plannedChanges[0]).toContain("initialize note.md in place");
    await expect(importer.run(source, { mode: "in-place" })).resolves.toMatchObject({ mode: "in-place", imported: 1, canceled: false });
    const initialized = await readFile(note, "utf8");
    expect(initialized).toContain("schema: dsh-personal-os/v1");
    expect(initialized).toContain("custom: keep");
    await expect(importer.preflight(source, "in-place")).resolves.toMatchObject({ conflicts: 0 });
    await expect(importer.run(source, { mode: "in-place" })).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(domain.snapshot().diagnostics.map((item) => item.code)).not.toContain("import-conflict");
  });

  it("rewrites resolvable Wiki Links after flattening imported directories", async () => {
    const root = await temp("personal-import-wiki-"); const source = join(root, "source");
    await mkdir(join(source, "notes"), { recursive: true });
    await writeFile(join(source, "index.md"), "# Index\n\n[[notes/Detail|详情]]");
    await writeFile(join(source, "notes", "Detail.md"), "# Detail");
    const domain = new PersonalOsDomainService(join(root, "target")); await domain.initialize({ watch: false });
    await expect(new VaultImporter(domain).run(source)).resolves.toMatchObject({ imported: 2 });
    const index = domain.list({ kind: "knowledge" }).find((item) => item.title === "index")!;
    const detail = domain.list({ kind: "knowledge" }).find((item) => item.title === "Detail")!;
    expect(index.body).toContain(`[详情](./${detail.path.split(/[\\/]/).at(-1)})`);
  });

  it("does not confuse identical relative paths imported from different Vaults", async () => {
    const root = await temp("personal-import-origins-"); const first = join(root, "first"); const second = join(root, "second");
    await mkdir(first); await mkdir(second);
    await writeFile(join(first, "note.md"), "# First"); await writeFile(join(second, "note.md"), "# Second");
    const domain = new PersonalOsDomainService(join(root, "target")); await domain.initialize({ watch: false });
    const importer = new VaultImporter(domain);
    await expect(importer.run(first)).resolves.toMatchObject({ imported: 1, skipped: 0 });
    await expect(importer.run(second)).resolves.toMatchObject({ imported: 1, skipped: 0 });
    expect(domain.list({ kind: "knowledge" })).toHaveLength(2);
    expect(domain.list({ kind: "knowledge" }).map((item) => item.body).sort()).toEqual(["# First", "# Second"]);
  });

  it("rejects source and target directories that overlap", async () => {
    const root = await temp("personal-import-overlap-"); const target = join(root, "target");
    const domain = new PersonalOsDomainService(target); await domain.initialize({ watch: false });
    await expect(new VaultImporter(domain).preflight(root)).rejects.toThrow("must not overlap");
    await expect(new VaultImporter(domain).preflight(target)).rejects.toThrow("must not overlap");
  });
});

describe("optional local version history", () => {
  it("creates semantic checkpoints and restores by making a new commit", async () => {
    const root = await temp("personal-history-"); const history = new VersionHistory(root); const file = join(root, "knowledge.md");
    await writeFile(file, "one\n"); const first = await history.checkpoint("Create knowledge");
    await writeFile(file, "two\n"); const second = await history.checkpoint("Update knowledge");
    expect(first?.id).toMatch(/^[0-9a-f]{40}$/); expect(second?.summary).toBe("Update knowledge"); expect(await history.remotes()).toEqual([]);
    const restored = await history.revert(second!.id, "Restore previous content");
    expect(restored.summary).toBe("Restore previous content"); expect(await readFile(file, "utf8")).toBe("one\n");
    expect((await history.list(3)).map((entry) => entry.summary)).toEqual(["Restore previous content", "Update knowledge", "Create knowledge"]);
  });
});
