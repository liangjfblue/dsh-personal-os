export const DOCUMENT_KINDS = ["capture", "knowledge", "todo", "project"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type EntityKind = Exclude<DocumentKind, "capture">;
export type TodoState = "open" | "done" | "canceled";
export type ProjectState = "planned" | "active" | "paused" | "completed" | "canceled";
export type CaptureState = "pending" | "processed" | "discarded";
export type Priority = "p0" | "p1" | "p2" | "p3";
export type RelationType = "belongs_to" | "derived_from" | "related_to" | "produced";
export const RELATION_TYPES = ["belongs_to", "derived_from", "related_to", "produced"] as const;

export interface Relation {
  type: RelationType;
  target: string;
}

export interface Provenance {
  kind: "conversation" | "import" | "url" | "manual";
  session_id?: string | undefined;
  seq_from?: number | undefined;
  seq_to?: number | undefined;
  task_id?: string | undefined;
  outcome_id?: string | undefined;
  candidate_id?: string | undefined;
  workspace?: string | undefined;
  original_path?: string | undefined;
  url?: string | undefined;
}

export interface PersonalDocument {
  schema: "dsh-personal-os/v1";
  id: string;
  kind: DocumentKind;
  title: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  relations: Relation[];
  source?: Provenance | undefined;
  sources?: Provenance[] | undefined;
  properties: Record<string, unknown>;
  body: string;
  path: string;
  archived: boolean;
  revision: string;
  state?: TodoState | ProjectState | CaptureState | undefined;
  priority?: Priority | undefined;
  start_date?: string | undefined;
  due_date?: string | undefined;
  completed_at?: string | undefined;
  target_date?: string | undefined;
  processed_at?: string | undefined;
  frontmatter: Record<string, unknown>;
}

export type DiagnosticCode =
  | "invalid-frontmatter"
  | "unknown-schema"
  | "pending-initialization"
  | "duplicate-id"
  | "duplicate-relation"
  | "unresolved-relation"
  | "unsupported-relation"
  | "relation-cardinality"
  | "import-conflict"
  | "kind-directory-mismatch";

export interface ContentDiagnostic {
  path: string;
  code: DiagnosticCode;
  message: string;
  documentId?: string | undefined;
}

export interface TimelineEntry {
  id: string;
  at: string;
  actor: "user" | "agent" | "curator" | "import" | "external";
  summary: string;
  targetId?: string | undefined;
  projectId?: string | undefined;
  workspace?: string | undefined;
  source: "ui" | "agent" | "session" | "import" | "external";
  session?: { sessionId: string; seqFrom: number; seqTo: number } | undefined;
  taskId?: string | undefined;
  outcomeId?: string | undefined;
}

export interface SearchFilter {
  kinds?: DocumentKind[] | undefined;
  tags?: string[] | undefined;
  projectId?: string | undefined;
  states?: string[] | undefined;
  includeArchived?: boolean | undefined;
}

export interface MutationContext {
  actor?: TimelineEntry["actor"] | undefined;
  source?: TimelineEntry["source"] | undefined;
  workspace?: string | undefined;
  summary?: string | undefined;
  audit?: boolean | undefined;
  taskId?: string | undefined;
  outcomeId?: string | undefined;
}

export interface CreateDocumentInput {
  kind: DocumentKind;
  title: string;
  body?: string | undefined;
  tags?: string[] | undefined;
  state?: string | undefined;
  priority?: Priority | undefined;
  start_date?: string | undefined;
  due_date?: string | undefined;
  target_date?: string | undefined;
  source?: Provenance | undefined;
  properties?: Record<string, unknown> | undefined;
  relations?: Relation[] | undefined;
}

export interface UpdateDocumentInput {
  title?: string | undefined;
  body?: string | undefined;
  tags?: string[] | undefined;
  state?: string | undefined;
  priority?: Priority | undefined;
  start_date?: string | undefined;
  due_date?: string | undefined;
  target_date?: string | undefined;
  properties?: Record<string, unknown> | undefined;
}

export interface ProjectProgress {
  projectId: string;
  total: number;
  completed: number;
  percent?: number | undefined;
}

export interface TodayProjection {
  date: string;
  continue?: TimelineEntry | undefined;
  todos: PersonalDocument[];
  projects: Array<{ document: PersonalDocument; progress: ProjectProgress }>;
  inbox: PersonalDocument[];
  knowledge: PersonalDocument[];
  activity: TimelineEntry[];
}

export interface CalendarItem {
  date: string;
  role: "todo-start" | "todo-due" | "project-target";
  document: PersonalDocument;
}

export interface GraphProjection {
  nodes: Array<{ id: string; kind: DocumentKind; title: string; archived: boolean }>;
  edges: Array<{ source: string; target: string; type: RelationType }>;
}
