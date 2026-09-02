import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile, copyFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { watch, type FSWatcher } from "chokidar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  attachmentNames,
  createDocumentId,
  kindFromPath,
  parseDocument,
  readableSlug,
  revisionOf,
  serializeDocument,
  splitMarkdown,
} from "./markdown.ts";
import type {
  CalendarItem,
  CaptureState,
  ContentDiagnostic,
  CreateDocumentInput,
  DocumentKind,
  GraphProjection,
  MutationContext,
  PersonalDocument,
  ProjectProgress,
  ProjectState,
  Relation,
  SearchFilter,
  TimelineEntry,
  TodayProjection,
  TodoState,
  UpdateDocumentInput,
} from "./types.ts";

const ACTIVE_DIRECTORY: Record<DocumentKind, string> = {
  capture: "inbox",
  knowledge: "knowledge",
  todo: "todos",
  project: "projects",
};
const MANAGED_DIRECTORIES = [
  "inbox", "knowledge", "todos", "projects", "timeline", "attachments", "templates",
  "archive/captures", "archive/knowledge", "archive/todos", "archive/projects",
] as const;
const SESSION_ACTIVITY_COALESCE_MS = 30 * 60 * 1000;

export class RevisionConflictError extends Error {
  constructor(readonly latest: PersonalDocument) {
    super("Document changed on disk; reload before saving");
    this.name = "RevisionConflictError";
  }
}

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function localDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDate(value: string | undefined): boolean {
  if (value === undefined) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}

function archiveDirectory(kind: DocumentKind): string {
  return `archive/${kind === "capture" ? "captures" : kind === "todo" ? "todos" : kind}`;
}

function cloneDocument(document: PersonalDocument): PersonalDocument {
  return structuredClone(document);
}

function isAllowedRelation(source: PersonalDocument, relation: Relation, target: PersonalDocument): boolean {
  return source.kind === "knowledge" && relation.type === "belongs_to" && target.kind === "project"
    || source.kind === "knowledge" && relation.type === "related_to" && target.kind === "knowledge" && target.id !== source.id
    || source.kind === "todo" && relation.type === "belongs_to" && target.kind === "project"
    || source.kind === "todo" && relation.type === "derived_from" && target.kind === "knowledge"
    || source.kind === "capture" && relation.type === "produced" && target.kind !== "capture";
}

async function markdownFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  const walk = async (path: string): Promise<void> => {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") output.push(child);
    }
  };
  await walk(directory);
  return output;
}

async function atomicWrite(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, source, "utf8");
  await rename(temporary, path);
}

async function collisionSafeTarget(directory: string, filename: string, id: string): Promise<string> {
  const extension = extname(filename); const stem = basename(filename, extension);
  for (let attempt = 0; ; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${id.slice(-6)}${attempt === 1 ? "" : `-${attempt}`}`;
    const candidate = join(directory, `${stem}${suffix}${extension}`);
    try {
      await stat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
    }
  }
}

export interface DomainSnapshot {
  revision: number;
  documents: PersonalDocument[];
  diagnostics: ContentDiagnostic[];
  indexing?: boolean | undefined;
}

// chokidar reports paths with forward slashes on every platform, and
// fs.watch on locked files under .git throws EPERM on Windows.
export const WATCH_IGNORE_PATTERN = /[\\/]\.git([\\/]|$)/;

export class PersonalOsDomainService {
  private readonly documents = new Map<string, PersonalDocument>();
  private readonly documentsByPath = new Map<string, PersonalDocument>();
  private diagnostics: ContentDiagnostic[] = [];
  private timeline: TimelineEntry[] = [];
  private revision = 0;
  private watcher: FSWatcher | undefined;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(snapshot: DomainSnapshot) => void>();

  constructor(readonly root: string) {}

  async initialize(options: { watch?: boolean; scan?: boolean } = {}): Promise<DomainSnapshot> {
    for (const directory of MANAGED_DIRECTORIES) await mkdir(join(this.root, directory), { recursive: true });
    await this.ensureTemplates();
    if (options.scan !== false) await this.refresh();
    if (options.watch !== false) this.startWatcher();
    return this.snapshot();
  }

  async close(): Promise<void> {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    await this.watcher?.close();
    this.watcher = undefined;
  }

  subscribe(listener: (snapshot: DomainSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): DomainSnapshot {
    return {
      revision: this.revision,
      documents: [...this.documents.values()].map(cloneDocument),
      diagnostics: structuredClone(this.diagnostics),
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private startWatcher(): void {
    if (this.watcher) return;
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      ignored: (path) => WATCH_IGNORE_PATTERN.test(path),
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    });
    const schedule = () => {
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => { void this.refresh("external"); }, 100);
    };
    this.watcher.on("error", () => undefined);
    this.watcher.on("add", schedule).on("change", schedule).on("unlink", schedule)
      .on("addDir", schedule).on("unlinkDir", schedule);
  }

  async refresh(source?: "external"): Promise<DomainSnapshot> {
    const previousByPath = new Map(this.documentsByPath);
    const next = new Map<string, PersonalDocument>();
    const nextByPath = new Map<string, PersonalDocument>();
    const diagnostics: ContentDiagnostic[] = [];
    const paths = (await Promise.all([
      markdownFiles(join(this.root, "inbox")),
      markdownFiles(join(this.root, "knowledge")),
      markdownFiles(join(this.root, "todos")),
      markdownFiles(join(this.root, "projects")),
      markdownFiles(join(this.root, "archive")),
    ])).flat();

    for (const path of paths) {
      let raw: string;
      try { raw = await readFile(path, "utf8"); } catch { continue; }
      try {
        const document = parseDocument(this.root, path, raw);
        const expectedKind = kindFromPath(this.root, path);
        if (expectedKind !== document.kind) {
          diagnostics.push({ path, documentId: document.id, code: "kind-directory-mismatch", message: `Expected ${expectedKind}, found ${document.kind}` });
        }
        if (next.has(document.id)) {
          diagnostics.push({ path, documentId: document.id, code: "duplicate-id", message: `Duplicate ID ${document.id}` });
          const first = next.get(document.id)!;
          diagnostics.push({ path: first.path, documentId: first.id, code: "duplicate-id", message: `Duplicate ID ${document.id}` });
          const previous = this.documents.get(document.id);
          if (previous?.path === path) {
            nextByPath.delete(first.path);
            next.set(document.id, document);
            nextByPath.set(path, document);
          }
          for (const duplicatePath of [first.path, path]) {
            const lastValid = previousByPath.get(duplicatePath);
            if (lastValid && lastValid.id !== document.id && !next.has(lastValid.id)) {
              next.set(lastValid.id, lastValid);
              nextByPath.set(lastValid.path, lastValid);
            }
          }
          continue;
        }
        next.set(document.id, document);
        nextByPath.set(path, document);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.includes("unsupported schema") ? "unknown-schema"
          : message.includes("required identity") || message.includes("missing YAML") ? "pending-initialization"
          : "invalid-frontmatter";
        diagnostics.push({ path, code, message });
        const lastValid = previousByPath.get(path);
        if (lastValid) {
          next.set(lastValid.id, lastValid);
          nextByPath.set(path, lastValid);
        }
      }
    }

    for (const document of [...next.values()]) {
      let invalid = false;
      let projectCount = 0;
      const seen = new Set<string>();
      for (const relation of document.relations) {
        const key = `${relation.type}:${relation.target}`;
        if (seen.has(key)) {
          diagnostics.push({ path: document.path, documentId: document.id, code: "duplicate-relation", message: `Duplicate relation ${key}` });
          invalid = true;
        }
        seen.add(key);
        const target = next.get(relation.target);
        if (!target) {
          diagnostics.push({ path: document.path, documentId: document.id, code: "unresolved-relation", message: `Missing target ${relation.target}` });
          invalid = true;
        } else if (!isAllowedRelation(document, relation, target)) {
          diagnostics.push({ path: document.path, documentId: document.id, code: "unsupported-relation", message: `Unsupported ${document.kind} ${relation.type} ${target.kind} relation` });
          invalid = true;
        }
        if (document.kind === "todo" && relation.type === "belongs_to") projectCount += 1;
      }
      if (projectCount > 1) {
        diagnostics.push({ path: document.path, documentId: document.id, code: "relation-cardinality", message: "Todo may belong to at most one Project" });
        invalid = true;
      }
      if (invalid) {
        next.delete(document.id);
        nextByPath.delete(document.path);
        const lastValid = previousByPath.get(document.path);
        if (lastValid && !next.has(lastValid.id)) {
          next.set(lastValid.id, lastValid);
          nextByPath.set(lastValid.path, lastValid);
        }
      }
    }

    for (const document of next.values()) {
      if (typeof document.properties.import_conflict_source_hash === "string") {
        diagnostics.push({ path: document.path, documentId: document.id, code: "import-conflict", message: "The imported source changed after this managed copy was created; review and merge it before accepting the new source hash" });
      }
    }

    this.documents.clear();
    this.documentsByPath.clear();
    for (const [id, document] of next) this.documents.set(id, document);
    for (const [path, document] of nextByPath) this.documentsByPath.set(path, document);
    this.diagnostics = diagnostics;
    this.timeline = await this.readTimeline();
    this.revision += 1;
    this.emit();
    return this.snapshot();
  }

  list(options: { kind?: DocumentKind; archived?: boolean; state?: string; tag?: string } = {}): PersonalDocument[] {
    return [...this.documents.values()]
      .filter((document) => options.kind === undefined || document.kind === options.kind)
      .filter((document) => options.archived === undefined || document.archived === options.archived)
      .filter((document) => options.state === undefined || document.state === options.state)
      .filter((document) => options.tag === undefined || document.tags.includes(options.tag))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(cloneDocument);
  }

  get(id: string): PersonalDocument | undefined {
    const document = this.documents.get(id);
    return document ? cloneDocument(document) : undefined;
  }

  async create(input: CreateDocumentInput, context: MutationContext = {}): Promise<PersonalDocument> {
    const template = await this.createFromTemplate(input.kind, input.title);
    const authoredInput: CreateDocumentInput = {
      ...template.draft,
      ...input,
      tags: input.tags ?? template.draft.tags,
      properties: input.properties ?? template.draft.properties,
      priority: input.priority ?? template.draft.priority,
      body: input.body === undefined || input.body === "" ? template.draft.body : input.body,
    };
    this.validateKindFields(authoredInput.kind, authoredInput);
    const timestamp = nowIso();
    const id = createDocumentId(input.kind);
    const directory = join(this.root, ACTIVE_DIRECTORY[input.kind]);
    let path = join(directory, `${readableSlug(input.title)}.md`);
    try {
      await stat(path);
      path = join(directory, `${readableSlug(input.title)}-${id.slice(-6)}.md`);
    } catch {}
    const frontmatter: Record<string, unknown> = {};
    const document: PersonalDocument = {
      schema: "dsh-personal-os/v1", id, kind: input.kind, title: input.title.trim(),
      created_at: timestamp, updated_at: timestamp, tags: [...new Set(authoredInput.tags ?? [])],
      relations: authoredInput.relations ?? [], source: authoredInput.source, properties: authoredInput.properties ?? {},
      body: authoredInput.body ?? "", path, archived: false, revision: "", frontmatter,
      state: this.initialState(authoredInput.kind, authoredInput.state), priority: authoredInput.kind === "todo" ? authoredInput.priority ?? "p2" : undefined,
      start_date: authoredInput.start_date, due_date: authoredInput.due_date, target_date: authoredInput.target_date,
    };
    this.validateRelations(document, document.relations);
    const source = serializeDocument(document);
    await atomicWrite(path, source);
    const parsed = parseDocument(this.root, path, source);
    this.documents.set(id, parsed); this.documentsByPath.set(path, parsed); this.revision += 1;
    await this.audit(`${input.kind} created: ${input.title}`, id, context);
    this.emit();
    return cloneDocument(parsed);
  }

  async update(id: string, patch: UpdateDocumentInput, expectedRevision?: string, context: MutationContext = {}): Promise<PersonalDocument> {
    const indexed = this.documents.get(id);
    if (!indexed) throw new DomainValidationError(`Unknown document ${id}`);
    const raw = await readFile(indexed.path, "utf8");
    const latest = parseDocument(this.root, indexed.path, raw);
    if (expectedRevision !== undefined && latest.revision !== expectedRevision) throw new RevisionConflictError(latest);
    const next = cloneDocument(latest);
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.body !== undefined) next.body = patch.body;
    if (patch.tags !== undefined) next.tags = [...new Set(patch.tags)];
    if (patch.properties !== undefined) next.properties = patch.properties;
    if (patch.priority !== undefined) next.priority = patch.priority;
    if (patch.start_date !== undefined) next.start_date = patch.start_date || undefined;
    if (patch.due_date !== undefined) next.due_date = patch.due_date || undefined;
    if (patch.target_date !== undefined) next.target_date = patch.target_date || undefined;
    if (patch.state !== undefined) this.applyState(next, patch.state);
    this.validateKindFields(next.kind, next);
    next.updated_at = nowIso();
    const source = serializeDocument(next);
    if (revisionOf(raw) === revisionOf(source)) return cloneDocument(latest);
    await atomicWrite(next.path, source);
    const parsed = parseDocument(this.root, next.path, source);
    this.documents.set(id, parsed); this.documentsByPath.set(next.path, parsed); this.revision += 1;
    await this.audit(context.summary ?? `${next.kind} updated: ${next.title}`, id, context);
    this.emit();
    return cloneDocument(parsed);
  }

  async archive(id: string, context: MutationContext = {}): Promise<PersonalDocument> {
    return this.moveLifecycle(id, true, context);
  }

  async restore(id: string, context: MutationContext = {}): Promise<PersonalDocument> {
    return this.moveLifecycle(id, false, context);
  }

  private async moveLifecycle(id: string, archived: boolean, context: MutationContext): Promise<PersonalDocument> {
    const document = this.documents.get(id);
    if (!document) throw new DomainValidationError(`Unknown document ${id}`);
    if (document.archived === archived) return cloneDocument(document);
    const directory = join(this.root, archived ? archiveDirectory(document.kind) : ACTIVE_DIRECTORY[document.kind]);
    await mkdir(directory, { recursive: true });
    const target = await collisionSafeTarget(directory, basename(document.path), document.id);
    await rename(document.path, target);
    const next = { ...document, path: target, archived };
    this.documents.set(id, next); this.documentsByPath.delete(document.path); this.documentsByPath.set(target, next); this.revision += 1;
    await this.audit(`${document.kind} ${archived ? "archived" : "restored"}: ${document.title}`, id, context);
    this.emit();
    return cloneDocument(next);
  }

  async permanentDelete(id: string, explicit: boolean, context: MutationContext = {}): Promise<void> {
    if (!explicit) throw new DomainValidationError("Permanent deletion requires explicit intent");
    const document = this.documents.get(id);
    if (!document) return;
    await unlink(document.path);
    this.documents.delete(id); this.documentsByPath.delete(document.path); this.revision += 1;
    await this.audit(`Permanently deleted ${document.kind}: ${document.title}`, id, context);
    this.emit();
  }

  async link(sourceId: string, relation: Relation, context: MutationContext = {}): Promise<PersonalDocument> {
    const source = this.documents.get(sourceId);
    if (!source) throw new DomainValidationError(`Unknown source ${sourceId}`);
    if (source.relations.some((item) => item.type === relation.type && item.target === relation.target)) return cloneDocument(source);
    if (relation.type === "related_to" && this.documents.get(relation.target)?.relations.some((item) => item.type === "related_to" && item.target === sourceId)) return cloneDocument(source);
    const nextRelations = [...source.relations, relation];
    this.validateRelations(source, nextRelations);
    const next = cloneDocument(source); next.relations = nextRelations; next.updated_at = nowIso();
    return this.writeWhole(next, context.summary ?? `Linked ${source.title}` , context);
  }

  async unlinkRelation(sourceId: string, relation: Relation, context: MutationContext = {}): Promise<PersonalDocument> {
    const source = this.documents.get(sourceId);
    if (!source) throw new DomainValidationError(`Unknown source ${sourceId}`);
    const next = cloneDocument(source);
    next.relations = next.relations.filter((item) => item.type !== relation.type || item.target !== relation.target);
    next.updated_at = nowIso();
    return this.writeWhole(next, context.summary ?? `Unlinked ${source.title}`, context);
  }

  private async writeWhole(next: PersonalDocument, summary: string, context: MutationContext): Promise<PersonalDocument> {
    const source = serializeDocument(next);
    await atomicWrite(next.path, source);
    const parsed = parseDocument(this.root, next.path, source);
    this.documents.set(next.id, parsed); this.documentsByPath.set(next.path, parsed); this.revision += 1;
    await this.audit(summary, next.id, context); this.emit();
    return cloneDocument(parsed);
  }

  reverseRelations(targetId: string): Array<{ source: PersonalDocument; relation: Relation }> {
    return [...this.documents.values()].flatMap((document) => document.relations
      .filter((relation) => relation.target === targetId)
      .map((relation) => ({ source: cloneDocument(document), relation })));
  }

  projectProgress(projectId: string): ProjectProgress {
    const todos = [...this.documents.values()].filter((document) => document.kind === "todo" && !document.archived
      && document.relations.some((relation) => relation.type === "belongs_to" && relation.target === projectId));
    const completed = todos.filter((todo) => todo.state === "done").length;
    return { projectId, total: todos.length, completed, ...(todos.length > 0 ? { percent: Math.round(completed / todos.length * 100) } : {}) };
  }

  projectContext(projectId: string) {
    const project = this.get(projectId);
    if (!project || project.kind !== "project") throw new DomainValidationError(`Unknown project ${projectId}`);
    const related = this.reverseRelations(projectId).map((item) => item.source);
    return { project, todos: related.filter((item) => item.kind === "todo"), knowledge: related.filter((item) => item.kind === "knowledge"), progress: this.projectProgress(projectId), activity: this.timeline.filter((item) => item.projectId === projectId).slice(0, 20) };
  }

  async processCapture(id: string, outputs: CreateDocumentInput[], context: MutationContext = {}): Promise<{ capture: PersonalDocument; produced: PersonalDocument[] }> {
    const capture = this.documents.get(id);
    if (!capture || capture.kind !== "capture") throw new DomainValidationError(`Unknown capture ${id}`);
    const existing = capture.relations.filter((relation) => relation.type === "produced").map((relation) => this.get(relation.target)).filter(Boolean) as PersonalDocument[];
    if (capture.state === "processed" && existing.length > 0) return { capture: cloneDocument(capture), produced: existing };
    const produced: PersonalDocument[] = [...existing];
    let next = this.documents.get(id)!;
    for (const output of outputs.slice(existing.length)) {
      const document = await this.create(output, { ...context, audit: false });
      produced.push(document);
      next = await this.link(next.id, { type: "produced", target: document.id }, { ...context, audit: false });
    }
    next = await this.update(next.id, { state: "processed" }, undefined, { ...context, audit: false });
    next = await this.archive(next.id, { ...context, audit: false });
    await this.audit(`Capture processed: ${next.title}`, next.id, context);
    return { capture: next, produced };
  }

  search(query: string, filter: SearchFilter = {}): Array<{ document: PersonalDocument; score: number; context: string }> {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return [...this.documents.values()].flatMap((document) => {
      if (!filter.includeArchived && document.archived) return [];
      if (filter.kinds && !filter.kinds.includes(document.kind)) return [];
      if (filter.tags && !filter.tags.every((tag) => document.tags.includes(tag))) return [];
      if (filter.states && !filter.states.includes(String(document.state))) return [];
      if (filter.projectId && !document.relations.some((relation) => relation.type === "belongs_to" && relation.target === filter.projectId)) return [];
      const attributes = [document.title, document.body, document.tags.join(" "), String(document.state ?? ""), String(document.priority ?? ""), JSON.stringify(document.properties), attachmentNames(document.body).join(" ")];
      const haystack = attributes.join("\n").toLocaleLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return [];
      const score = terms.reduce((sum, term) => sum + (document.title.toLocaleLowerCase().includes(term) ? 4 : 1), 0);
      const body = document.body.replace(/\s+/g, " ").trim();
      return [{ document: cloneDocument(document), score, context: body.slice(0, 180) }];
    }).sort((a, b) => b.score - a.score || b.document.updated_at.localeCompare(a.document.updated_at));
  }

  graph(options: { focusId?: string; types?: Relation["type"][]; projectId?: string; tag?: string } = {}): GraphProjection {
    let documents = [...this.documents.values()].filter((document) => !document.archived);
    if (options.tag) documents = documents.filter((document) => document.tags.includes(options.tag!));
    if (options.projectId) documents = documents.filter((document) => document.id === options.projectId || document.relations.some((relation) => relation.target === options.projectId));
    const ids = new Set(documents.map((document) => document.id));
    let edges = documents.flatMap((document) => document.relations
      .filter((relation) => ids.has(relation.target) && (!options.types || options.types.includes(relation.type)))
      .map((relation) => ({ source: document.id, target: relation.target, type: relation.type })));
    if (options.focusId) {
      edges = edges.filter((edge) => edge.source === options.focusId || edge.target === options.focusId);
      const focusedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
      focusedIds.add(options.focusId);
      documents = documents.filter((document) => focusedIds.has(document.id));
    }
    return { nodes: documents.map((document) => ({ id: document.id, kind: document.kind, title: document.title, archived: document.archived })), edges };
  }

  calendar(month?: string): CalendarItem[] {
    const items: CalendarItem[] = [];
    for (const document of this.documents.values()) {
      if (document.archived) continue;
      if (document.kind === "todo") {
        if (document.start_date) items.push({ date: document.start_date, role: "todo-start", document: cloneDocument(document) });
        if (document.due_date) items.push({ date: document.due_date, role: "todo-due", document: cloneDocument(document) });
      }
      if (document.kind === "project" && document.target_date) items.push({ date: document.target_date, role: "project-target", document: cloneDocument(document) });
    }
    return items.filter((item) => !month || item.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
  }

  today(date = localDate()): TodayProjection {
    const activeProjects = this.list({ kind: "project", archived: false }).filter((project) => project.state === "active");
    const activity = this.timeline.filter((entry) => entry.at.startsWith(date)).sort((a, b) => b.at.localeCompare(a.at));
    const continueEntry = this.timeline.find((entry) => {
      const target = entry.targetId ? this.documents.get(entry.targetId) : entry.projectId ? this.documents.get(entry.projectId) : undefined;
      if (target && !target.archived && (target.state === "open" || target.state === "pending" || target.state === "active" || target.state === "planned" || target.state === "paused")) return true;
      return entry.summary.toLocaleLowerCase().includes("unfinished") || entry.summary.includes("继续") || entry.summary.includes("未完成");
    });
    return {
      date,
      continue: continueEntry,
      todos: this.list({ kind: "todo", archived: false }).filter((todo) => todo.state === "open" && (todo.start_date === date || todo.due_date === date || (todo.due_date !== undefined && todo.due_date < date))),
      projects: activeProjects.map((document) => ({ document, progress: this.projectProgress(document.id) })),
      inbox: this.list({ kind: "capture", archived: false }).filter((capture) => capture.state === "pending"),
      knowledge: this.list({ kind: "knowledge", archived: false }).slice(0, 5),
      activity,
    };
  }

  timelineEntries(filter: { date?: string; projectId?: string; workspace?: string; source?: TimelineEntry["source"] } = {}): TimelineEntry[] {
    return this.timeline.filter((entry) => !filter.date || entry.at.startsWith(filter.date))
      .filter((entry) => !filter.projectId || entry.projectId === filter.projectId)
      .filter((entry) => !filter.workspace || entry.workspace === filter.workspace)
      .filter((entry) => !filter.source || entry.source === filter.source)
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  async recordSessionActivity(entry: Omit<TimelineEntry, "id" | "at" | "source"> & { at?: string }): Promise<TimelineEntry> {
    const at = entry.at ?? nowIso();
    const topicId = entry.projectId ?? entry.targetId;
    const previous = this.timeline
      .filter((item) => item.source === "session"
        && item.actor === "curator"
        && (entry.outcomeId ? item.outcomeId === entry.outcomeId : !item.outcomeId)
        && item.session?.sessionId === entry.session?.sessionId
        && (item.projectId ?? item.targetId) === topicId
        && (entry.outcomeId || (item.at.slice(0, 10) === at.slice(0, 10)
          && Date.parse(at) - Date.parse(item.at) >= 0
          && Date.parse(at) - Date.parse(item.at) <= SESSION_ACTIVITY_COALESCE_MS)))
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!previous) return this.appendTimeline({ ...entry, at, source: "session" });

    const merged: TimelineEntry = {
      ...previous,
      ...entry,
      id: previous.id,
      at,
      source: "session",
      session: entry.session && previous.session
        ? { sessionId: entry.session.sessionId, seqFrom: previous.session.seqFrom, seqTo: entry.session.seqTo }
        : entry.session ?? previous.session,
    };
    const path = join(this.root, "timeline", `${at.slice(0, 10)}.md`);
    const { data } = splitMarkdown(await readFile(path, "utf8"));
    const entries = Array.isArray(data.entries) ? data.entries as TimelineEntry[] : [];
    const index = entries.findIndex((item) => item.id === previous.id);
    if (index < 0) return this.appendTimeline({ ...entry, at, source: "session" });
    entries[index] = merged;
    await atomicWrite(path, `---\n${stringifyYaml({ schema: "dsh-personal-os/v1", kind: "timeline", date: at.slice(0, 10), entries }, { lineWidth: 0 }).trimEnd()}\n---\n# Timeline ${at.slice(0, 10)}\n`);
    const memoryIndex = this.timeline.findIndex((item) => item.id === previous.id);
    if (memoryIndex >= 0) this.timeline[memoryIndex] = merged;
    return merged;
  }

  private async audit(summary: string, targetId: string, context: MutationContext): Promise<void> {
    if (context.audit === false) return;
    const document = this.documents.get(targetId);
    const projectId = document?.kind === "project" ? document.id : document?.relations.find((relation) => relation.type === "belongs_to")?.target;
    await this.appendTimeline({ actor: context.actor ?? "user", summary, targetId, projectId, workspace: context.workspace, source: context.source ?? "ui", taskId: context.taskId, outcomeId: context.outcomeId });
  }

  private async appendTimeline(input: Omit<TimelineEntry, "id" | "at"> & { at?: string }): Promise<TimelineEntry> {
    const entry: TimelineEntry = { id: `evt_${randomUUID()}`, at: input.at ?? nowIso(), ...input };
    const date = entry.at.slice(0, 10);
    const path = join(this.root, "timeline", `${date}.md`);
    let entries: TimelineEntry[] = [];
    try {
      const { data } = splitMarkdown(await readFile(path, "utf8"));
      if (Array.isArray(data.entries)) entries = data.entries as TimelineEntry[];
    } catch {}
    entries.push(entry);
    const data = { schema: "dsh-personal-os/v1", kind: "timeline", date, entries };
    await atomicWrite(path, `---\n${stringifyYaml(data, { lineWidth: 0 }).trimEnd()}\n---\n# Timeline ${date}\n`);
    this.timeline.push(entry);
    return entry;
  }

  private async readTimeline(): Promise<TimelineEntry[]> {
    const entries: TimelineEntry[] = [];
    for (const path of await markdownFiles(join(this.root, "timeline"))) {
      try {
        const { data } = splitMarkdown(await readFile(path, "utf8"));
        if (Array.isArray(data.entries)) entries.push(...data.entries as TimelineEntry[]);
      } catch {}
    }
    return entries.sort((a, b) => b.at.localeCompare(a.at));
  }

  private initialState(kind: DocumentKind, requested?: string): PersonalDocument["state"] {
    if (kind === "capture") return (requested ?? "pending") as CaptureState;
    if (kind === "todo") return (requested ?? "open") as TodoState;
    if (kind === "project") return (requested ?? "active") as ProjectState;
    return undefined;
  }

  private applyState(document: PersonalDocument, state: string): void {
    document.state = state as PersonalDocument["state"];
    if (document.kind === "todo") document.completed_at = state === "done" ? document.completed_at ?? nowIso() : undefined;
    if (document.kind === "capture") document.processed_at = state === "processed" || state === "discarded" ? document.processed_at ?? nowIso() : undefined;
  }

  private validateKindFields(kind: DocumentKind, input: { title?: unknown; state?: unknown; start_date?: unknown; due_date?: unknown; target_date?: unknown }): void {
    if (typeof input.title !== "string" || input.title.trim() === "") throw new DomainValidationError("title is required");
    if (!isDate(input.start_date as string | undefined) || !isDate(input.due_date as string | undefined) || !isDate(input.target_date as string | undefined)) throw new DomainValidationError("Dates must use YYYY-MM-DD");
    if (kind === "todo" && input.state !== undefined && !["open", "done", "canceled"].includes(String(input.state))) throw new DomainValidationError("Invalid Todo state");
    if (kind === "project" && input.state !== undefined && !["planned", "active", "paused", "completed", "canceled"].includes(String(input.state))) throw new DomainValidationError("Invalid Project state");
    if (kind === "capture" && input.state !== undefined && !["pending", "processed", "discarded"].includes(String(input.state))) throw new DomainValidationError("Invalid Capture state");
  }

  private validateRelations(source: PersonalDocument, relations: Relation[]): void {
    const seen = new Set<string>();
    let projectCount = 0;
    for (const relation of relations) {
      const key = `${relation.type}:${relation.target}`;
      if (seen.has(key)) throw new DomainValidationError(`Duplicate relation ${key}`);
      seen.add(key);
      const target = this.documents.get(relation.target);
      if (!target) throw new DomainValidationError(`Unknown relation target ${relation.target}`);
      if (!isAllowedRelation(source, relation, target)) throw new DomainValidationError(`Unsupported ${source.kind} ${relation.type} ${target.kind} relation`);
      if (source.kind === "todo" && relation.type === "belongs_to") projectCount += 1;
    }
    if (projectCount > 1) throw new DomainValidationError("Todo may belong to at most one Project");
  }

  private async ensureTemplates(): Promise<void> {
    const defaults: Record<DocumentKind, string> = {
      capture: "# Capture\n\n",
      knowledge: "# Knowledge\n\n## Notes\n\n",
      todo: "# Todo\n\n## Outcome\n\n",
      project: "# Project\n\n## Outcome\n\n## Notes\n\n",
    };
    for (const [kind, body] of Object.entries(defaults)) {
      const path = join(this.root, "templates", `${kind}.md`);
      try { await stat(path); } catch { await writeFile(path, body, "utf8"); }
    }
  }

  async createFromTemplate(kind: DocumentKind, title: string): Promise<{ draft: CreateDocumentInput; templatePath: string }> {
    const templatePath = join(this.root, "templates", `${kind}.md`);
    const source = await readFile(templatePath, "utf8");
    let body = source;
    const draft: CreateDocumentInput = { kind, title, body };
    if (source.startsWith("---")) {
      const parsed = splitMarkdown(source); body = parsed.body;
      const authored = parsed.data;
      draft.body = body;
      draft.tags = Array.isArray(authored.tags) ? authored.tags.filter((value): value is string => typeof value === "string") : undefined;
      draft.priority = typeof authored.priority === "string" ? authored.priority as CreateDocumentInput["priority"] : undefined;
      draft.properties = typeof authored.properties === "object" && authored.properties !== null ? authored.properties as Record<string, unknown> : undefined;
    }
    return { draft, templatePath };
  }

  async importPlainMarkdown(sourcePath: string, originalPath: string, extraProperties: Record<string, unknown> = {}, transformBody?: (body: string) => string): Promise<PersonalDocument> {
    const raw = await readFile(sourcePath, "utf8");
    let title = basename(sourcePath, extname(sourcePath));
    let body = raw;
    let tags: string[] = [];
    let properties: Record<string, unknown> = {};
    if (raw.startsWith("---")) {
      try {
        const parsed = splitMarkdown(raw); body = parsed.body;
        if (typeof parsed.data.title === "string") title = parsed.data.title;
        if (Array.isArray(parsed.data.tags)) tags = parsed.data.tags.filter((item): item is string => typeof item === "string");
        properties = { imported_frontmatter: parsed.data };
      } catch {}
    }
    if (transformBody) body = transformBody(body);
    return this.create({ kind: "knowledge", title, body, tags, properties: { ...properties, ...extraProperties }, source: { kind: "import", original_path: originalPath } }, { actor: "import", source: "import" });
  }
}
