import { createHash, randomBytes } from "node:crypto";
import { basename, relative, sep } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  DOCUMENT_KINDS,
  RELATION_TYPES,
  type DocumentKind,
  type PersonalDocument,
  type Relation,
} from "./types.ts";

const PREFIX: Record<DocumentKind, string> = {
  capture: "cap",
  knowledge: "kn",
  todo: "todo",
  project: "prj",
};
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: bigint, length: number): string {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

export function createDocumentId(kind: DocumentKind, now = Date.now()): string {
  const time = encodeBase32(BigInt(now), 10);
  const randomness = BigInt(`0x${randomBytes(10).toString("hex")}`);
  return `${PREFIX[kind]}_${time}${encodeBase32(randomness, 16)}`;
}

export function revisionOf(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

export function readableSlug(title: string): string {
  const slug = title
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#\[\]]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

export function splitMarkdown(source: string): { data: Record<string, unknown>; body: string } {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    throw new Error("missing YAML Frontmatter");
  }
  const normalized = source.replaceAll("\r\n", "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("unterminated YAML Frontmatter");
  const parsed = parseYaml(normalized.slice(4, end));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Frontmatter must be an object");
  }
  return { data: parsed as Record<string, unknown>, body: normalized.slice(end + 5) };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function relations(value: unknown): Relation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("relations must be an array");
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) throw new Error("relation must be an object");
    const record = item as Record<string, unknown>;
    if (typeof record.type !== "string" || !RELATION_TYPES.includes(record.type as Relation["type"]) || typeof record.target !== "string" || record.target === "") throw new Error("unsupported relation");
    return [{ type: record.type as Relation["type"], target: record.target }];
  });
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === "string" ? data[key] : undefined;
}

function validLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function parseDocument(
  root: string,
  path: string,
  source: string,
): PersonalDocument {
  const { data, body } = splitMarkdown(source);
  if (data.schema !== "dsh-personal-os/v1") {
    throw new Error(`unsupported schema: ${String(data.schema ?? "missing")}`);
  }
  if (typeof data.id !== "string" || typeof data.kind !== "string" || typeof data.title !== "string") {
    throw new Error("missing required identity metadata");
  }
  if (!DOCUMENT_KINDS.includes(data.kind as DocumentKind)) throw new Error("unknown document kind");
  if (data.title.trim() === "") throw new Error("title is required");
  if (!new RegExp(`^${PREFIX[data.kind as DocumentKind]}_[0-9A-HJKMNP-TV-Z]{26}$`).test(data.id)) throw new Error("invalid document ID");
  if (typeof data.created_at !== "string" || typeof data.updated_at !== "string") {
    throw new Error("missing timestamps");
  }
  if (!validTimestamp(data.created_at) || !validTimestamp(data.updated_at)) throw new Error("invalid timestamps");
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((item) => typeof item !== "string"))) throw new Error("tags must be strings");
  if (data.properties !== undefined && (typeof data.properties !== "object" || data.properties === null || Array.isArray(data.properties))) throw new Error("properties must be an object");
  const state = stringField(data, "state");
  const validState = data.kind === "knowledge" ? state === undefined
    : data.kind === "capture" ? state !== undefined && ["pending", "processed", "discarded"].includes(state)
    : data.kind === "todo" ? state !== undefined && ["open", "done", "canceled"].includes(state)
    : state !== undefined && ["planned", "active", "paused", "completed", "canceled"].includes(state);
  if (!validState) throw new Error("invalid document state");
  const priority = stringField(data, "priority");
  if (data.kind === "todo" && (priority === undefined || !["p0", "p1", "p2", "p3"].includes(priority))) throw new Error("invalid Todo priority");
  for (const key of ["start_date", "due_date", "target_date"] as const) {
    const value = stringField(data, key);
    if (value !== undefined && !validLocalDate(value)) throw new Error(`invalid ${key}`);
  }
  for (const key of ["completed_at", "processed_at"] as const) {
    const value = stringField(data, key);
    if (value !== undefined && !validTimestamp(value)) throw new Error(`invalid ${key}`);
  }
  const rel = relative(root, path).split(sep).join("/");
  const archived = rel.startsWith("archive/");
  return {
    ...(data as Omit<PersonalDocument, "body" | "path" | "archived" | "revision" | "frontmatter">),
    schema: "dsh-personal-os/v1",
    id: data.id,
    kind: data.kind as DocumentKind,
    title: data.title,
    created_at: data.created_at,
    updated_at: data.updated_at,
    tags: strings(data.tags),
    relations: relations(data.relations),
    properties: typeof data.properties === "object" && data.properties !== null && !Array.isArray(data.properties)
      ? data.properties as Record<string, unknown>
      : {},
    body,
    path,
    archived,
    revision: revisionOf(source),
    state: state as PersonalDocument["state"],
    priority: priority as PersonalDocument["priority"],
    start_date: stringField(data, "start_date"),
    due_date: stringField(data, "due_date"),
    completed_at: stringField(data, "completed_at"),
    target_date: stringField(data, "target_date"),
    processed_at: stringField(data, "processed_at"),
    frontmatter: data,
  };
}

export function serializeDocument(document: PersonalDocument): string {
  const data: Record<string, unknown> = {
    ...document.frontmatter,
    schema: document.schema,
    id: document.id,
    kind: document.kind,
    title: document.title,
    created_at: document.created_at,
    updated_at: document.updated_at,
    tags: document.tags,
    relations: document.relations,
    source: document.source,
    sources: document.sources,
    properties: document.properties,
  };
  for (const key of ["state", "priority", "start_date", "due_date", "completed_at", "target_date", "processed_at"] as const) {
    if (document[key] === undefined || document[key] === "") delete data[key];
    else data[key] = document[key];
  }
  if (data.source === undefined) delete data.source;
  if (data.sources === undefined) delete data.sources;
  const yaml = stringifyYaml(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${document.body.replace(/^\n+/, "")}`;
}

export function kindFromPath(root: string, path: string): DocumentKind | undefined {
  const parts = relative(root, path).split(sep);
  const top = parts[0] === "archive" ? parts[1] : parts[0];
  return ({ inbox: "capture", captures: "capture", knowledge: "knowledge", todos: "todo", projects: "project" } as const)[top as "inbox"];
}

export function attachmentNames(body: string): string[] {
  const names: string[] = [];
  for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]?.split(/[?#]/, 1)[0];
    if (target) names.push(basename(target));
  }
  return names;
}
