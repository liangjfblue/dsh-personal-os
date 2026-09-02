import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import type { PersonalOsDomainService } from "./domain/service.ts";
import type { PersonalDocument } from "./domain/types.ts";

export interface ImportPreflight {
  source: string;
  markdown: number;
  attachments: number;
  conflicts: number;
  mode: "copy" | "in-place";
  plannedChanges: string[];
}

export interface ImportProgress {
  completed: number;
  total: number;
  current: string;
}

export interface ImportReport extends ImportPreflight {
  imported: number;
  skipped: number;
  canceled: boolean;
  errors: Array<{ path: string; message: string }>;
  reportPath: string;
}

async function files(root: string): Promise<string[]> {
  const output: string[] = [];
  const walk = async (path: string): Promise<void> => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) output.push(child);
    }
  };
  await walk(root);
  return output;
}

function sourceKey(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function assertSeparateRoots(source: string, target: string): void {
  if (isInside(source, target) || isInside(target, source)) throw new Error("Import Vault and Personal Data Directory must not overlap");
}

function rewriteAttachmentLinks(body: string, markdownPath: string, sourceRoot: string, namespace: string, attachments: Map<string, string>): string {
  const targetFor = (reference: string): string | undefined => {
    if (/^(?:[a-z]+:|#|\/)/i.test(reference)) return undefined;
    const match = reference.match(/^([^?#]*)([?#].*)?$/);
    const path = match?.[1] ?? reference;
    const suffix = match?.[2] ?? "";
    let decoded: string;
    try { decoded = decodeURIComponent(path!); } catch { decoded = path!; }
    const sourceRelative = relative(sourceRoot, resolve(dirname(markdownPath), decoded)).split(sep).join("/");
    if (!attachments.has(sourceRelative)) return undefined;
    return `../attachments/imported/${namespace}/${sourceRelative}${suffix}`;
  };
  let rewritten = body.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (match, open: string, target: string, close: string) => {
    const next = targetFor(target); return next ? `${open}${next}${close}` : match;
  });
  rewritten = rewritten.replace(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, (match, target: string) => {
    const exact = targetFor(target);
    if (exact) return `![${basename(target)}](${exact})`;
    const candidates = [...attachments.keys()].filter((path) => basename(path) === basename(target));
    if (candidates.length !== 1) return match;
    return `![${basename(target)}](../attachments/imported/${namespace}/${candidates[0]})`;
  });
  return rewritten;
}

function rewriteWikiLinks(body: string, sourcePath: string, documents: Map<string, PersonalDocument>): string {
  const normalize = (value: string): string => posix.normalize(value.replace(/^\.\//, ""));
  return body.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (match, reference: string) => {
    const [targetWithAnchor, alias] = reference.split("|", 2);
    const [target, anchor] = (targetWithAnchor ?? "").split("#", 2);
    if (!target) return match;
    const decoded = (() => { try { return decodeURIComponent(target); } catch { return target; } })();
    const withExtension = extname(decoded).toLowerCase() === ".md" ? decoded : `${decoded}.md`;
    const candidates = [
      normalize(posix.join(posix.dirname(sourcePath), withExtension)),
      normalize(withExtension),
    ];
    let document = candidates.map((candidate) => documents.get(candidate)).find(Boolean);
    if (!document) {
      const targetBase = basename(withExtension).toLocaleLowerCase();
      const matches = [...documents.entries()].filter(([path]) => basename(path).toLocaleLowerCase() === targetBase);
      if (matches.length === 1) document = matches[0]![1];
    }
    if (!document) return match;
    const label = alias?.trim() || basename(target, extname(target));
    return `[${label}](./${basename(document.path)}${anchor ? `#${anchor}` : ""})`;
  });
}

export class VaultImporter {
  constructor(readonly domain: PersonalOsDomainService) {}

  async preflight(source: string, mode: "copy" | "in-place" = "copy"): Promise<ImportPreflight> {
    const absolute = resolve(source);
    assertSeparateRoots(absolute, resolve(this.domain.root));
    const all = await files(absolute);
    const markdown = all.filter((path) => extname(path).toLowerCase() === ".md");
    const attachments = all.filter((path) => extname(path).toLowerCase() !== ".md");
    const known = new Map(this.domain.list().flatMap((document) => typeof document.properties.import_source_key === "string" ? [[document.properties.import_source_key, document.properties.import_source_hash] as const] : []));
    const conflicts = (await Promise.all(markdown.map(async (path) => {
      const key = sourceKey(`${absolute}:${relative(absolute, path).split(sep).join("/")}`);
      const previousHash = known.get(key);
      return known.has(key) && previousHash !== sourceKey(await readFile(path, "utf8"));
    }))).filter(Boolean).length;
    const plannedChanges = mode === "in-place"
      ? markdown.map((path) => `initialize ${relative(absolute, path)} in place and index a managed copy`)
      : markdown.map((path) => `copy ${relative(absolute, path)}`);
    return { source: absolute, markdown: markdown.length, attachments: attachments.length, conflicts, mode, plannedChanges };
  }

  async run(
    source: string,
    options: { mode?: "copy" | "in-place" | undefined; signal?: AbortSignal | undefined; onProgress?: ((progress: ImportProgress) => void) | undefined } = {},
  ): Promise<ImportReport> {
    const mode = options.mode ?? "copy";
    const preflight = await this.preflight(source, mode);
    const all = await files(preflight.source);
    const markdown = all.filter((path) => extname(path).toLowerCase() === ".md");
    const attachments = all.filter((path) => extname(path).toLowerCase() !== ".md");
    const known = new Map(this.domain.list().flatMap((document) => typeof document.properties.import_source_key === "string" ? [[document.properties.import_source_key, document] as const] : []));
    const namespace = sourceKey(preflight.source);
    const attachmentMap = new Map(attachments.map((path) => [relative(preflight.source, path).split(sep).join("/"), path]));
    let imported = 0; let skipped = 0; let canceled = false;
    const errors: ImportReport["errors"] = [];
    for (const [index, path] of markdown.entries()) {
      if (options.signal?.aborted) { canceled = true; break; }
      const originalPath = relative(preflight.source, path).split(sep).join("/");
      options.onProgress?.({ completed: index, total: markdown.length, current: originalPath });
      const key = sourceKey(`${preflight.source}:${originalPath}`);
      const sourceHash = sourceKey(await readFile(path, "utf8"));
      const existing = known.get(key);
      if (existing) {
        skipped += 1;
        const properties = { ...existing.properties };
        if (existing.properties.import_source_hash !== sourceHash) properties.import_conflict_source_hash = sourceHash;
        else delete properties.import_conflict_source_hash;
        if (JSON.stringify(properties) !== JSON.stringify(existing.properties)) {
          await this.domain.update(existing.id, { properties }, existing.revision, { actor: "import", source: "import", audit: false });
        }
        continue;
      }
      try {
        let created = await this.domain.importPlainMarkdown(path, originalPath, { import_source_key: key, import_source_hash: sourceHash }, mode === "copy" ? (body) => rewriteAttachmentLinks(body, path, preflight.source, namespace, attachmentMap) : undefined);
        if (mode === "in-place") {
          const initializedSource = await readFile(created.path, "utf8");
          await writeFile(path, initializedSource, "utf8");
          created = await this.domain.update(created.id, { properties: { ...created.properties, import_source_hash: sourceKey(initializedSource) } }, created.revision, { actor: "import", source: "import", audit: false });
        }
        known.set(key, created);
        imported += 1;
      } catch (error) {
        errors.push({ path: originalPath, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const importedByPath = new Map<string, PersonalDocument>();
    for (const path of markdown) {
      const originalPath = relative(preflight.source, path).split(sep).join("/");
      const document = known.get(sourceKey(`${preflight.source}:${originalPath}`));
      if (document) importedByPath.set(originalPath, document);
    }
    for (const [originalPath, document] of importedByPath) {
      const rewritten = rewriteWikiLinks(document.body, originalPath, importedByPath);
      if (rewritten !== document.body) {
        const updated = await this.domain.update(document.id, { body: rewritten }, document.revision, { actor: "import", source: "import", audit: false });
        importedByPath.set(originalPath, updated);
        const key = updated.properties.import_source_key;
        if (typeof key === "string") known.set(key, updated);
      }
    }
    if (!canceled && mode === "copy") {
      for (const path of attachments) {
        if (options.signal?.aborted) { canceled = true; break; }
        const target = join(this.domain.root, "attachments", "imported", namespace, relative(preflight.source, path));
        await mkdir(dirname(target), { recursive: true });
        try { await copyFile(path, target); }
        catch (error) { errors.push({ path: relative(preflight.source, path).split(sep).join("/"), message: error instanceof Error ? error.message : String(error) }); }
      }
    }
    await this.domain.refresh();
    const reportPath = join(this.domain.root, `import-report-${Date.now()}.md`);
    const report: ImportReport = { ...preflight, imported, skipped, canceled, errors, reportPath };
    await writeFile(reportPath, `# Vault Import Report\n\n- Source: ${preflight.source}\n- Mode: ${mode}\n- Imported: ${imported}\n- Skipped: ${skipped}\n- Attachments: ${preflight.attachments}\n- Canceled: ${canceled}\n- Errors: ${errors.length}\n`, "utf8");
    return report;
  }
}
