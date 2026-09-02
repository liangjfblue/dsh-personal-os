import type { PersonalOsSettings } from "../settingsStore.ts";
import type { CurationJobStatus, ImportJobStatus, SessionTaskContext, TaskOutcomeReviewRequest } from "../service.ts";
import type { TaskOutcomeProposal, TaskOutcomeStatus, TaskSpanView } from "../taskOutcome.ts";
import type {
  CalendarItem,
  CreateDocumentInput,
  DocumentKind,
  GraphProjection,
  PersonalDocument,
  SearchFilter,
  TimelineEntry,
  TodayProjection,
  UpdateDocumentInput,
  Relation,
} from "../domain/types.ts";
import type { DomainSnapshot } from "../domain/service.ts";
import type { HistoryEntry } from "../versionHistory.ts";
import type { ImportPreflight, ImportReport } from "../vaultImport.ts";

export interface PersonalOsViewFace {
  ready: () => boolean;
  getSettings: () => Promise<PersonalOsSettings>;
  choosePersonalDataDirectory: () => Promise<boolean>;
  chooseImportDirectory: () => Promise<string | undefined>;
  pickDirectory: () => Promise<string | undefined>;
  listSessions: () => Promise<Array<{ id: string; title?: string; cwd?: string }>>;
  openPersonalDataDirectory: (path: string) => Promise<void>;
  updatePreferences: (patch: Partial<Omit<PersonalOsSettings, "schemaVersion" | "personalDataDirectory">>) => Promise<PersonalOsSettings>;
  getSnapshot: () => Promise<DomainSnapshot>;
  listDocuments: (request: { kind?: CreateDocumentInput["kind"]; archived?: boolean; state?: string; tag?: string }) => Promise<PersonalDocument[]>;
  getDocument: (id: string) => Promise<PersonalDocument | null>;
  getTemplateDraft: (kind: DocumentKind) => Promise<{ draft: CreateDocumentInput; templatePath: string }>;
  createDocument: (input: CreateDocumentInput) => Promise<PersonalDocument>;
  updateDocument: (id: string, patch: UpdateDocumentInput, expectedRevision?: string) => Promise<PersonalDocument>;
  archiveDocument: (id: string, restore?: boolean) => Promise<PersonalDocument>;
  linkDocuments: (sourceId: string, relation: Relation, remove?: boolean) => Promise<PersonalDocument>;
  searchDocuments: (query: string, filter?: SearchFilter) => Promise<Array<{ document: PersonalDocument; score: number; context: string }>>;
  getToday: (date?: string) => Promise<TodayProjection>;
  getTimeline: () => Promise<TimelineEntry[]>;
  getCalendar: (month?: string) => Promise<CalendarItem[]>;
  getGraph: () => Promise<GraphProjection>;
  refreshDomain: () => Promise<DomainSnapshot>;
  getHistory: () => Promise<{ available: boolean; entries: HistoryEntry[] }>;
  revertHistory: (commit: string) => Promise<HistoryEntry>;
  preflightImport: (source: string, mode?: "copy" | "in-place") => Promise<ImportPreflight>;
  runImport: (source: string, mode?: "copy" | "in-place") => Promise<ImportReport>;
  startImport: (source: string, mode?: "copy" | "in-place") => Promise<ImportJobStatus>;
  getImportJob: (id: string) => Promise<ImportJobStatus | null>;
  getLatestImportJob: () => Promise<ImportJobStatus | null>;
  cancelImport: (id: string) => Promise<ImportJobStatus | null>;
  runHistoricalCuration: () => Promise<CurationJobStatus>;
  getCurationStatus: () => Promise<{ processedSessions: number; failures: Record<string, string>; job?: CurationJobStatus | undefined }>;
  cancelHistoricalCuration: () => Promise<CurationJobStatus | null>;
  listTaskOutcomes: (status?: TaskOutcomeStatus) => Promise<TaskOutcomeProposal[]>;
  getTaskOutcome: (id: string) => Promise<TaskOutcomeProposal | null>;
  reviewTaskOutcome: (request: TaskOutcomeReviewRequest) => Promise<TaskOutcomeProposal>;
  listTaskSpans: () => Promise<TaskSpanView[]>;
  correctTaskBoundary: (sessionId: string, action: "split-latest" | "merge-previous") => Promise<TaskSpanView>;
  getSessionTaskContext: (sessionId: string) => Promise<SessionTaskContext>;
  openSession: (sessionId: string, instruction?: string) => Promise<void>;
  prepareAgentInstruction: (instruction: string) => Promise<void>;
}
