# dsh-personal-os V0.1 Product Specification

## Status

Confirmed V0.1 product baseline. The final design grilling session reached an empty decision frontier, and the user accepted all remaining decisions before publishing the implementation specification.

## Product promise

`dsh-personal-os` solves one problem: personal context does not continuously reach the Agent. It is an embedded DeepSeek Harness product surface where the user manages user-owned data with help from the DSH Agent.

It is not a Notion, Obsidian, Todoist, or standalone Agent application replacement. Knowledge, Todo, Project, Timeline, Calendar, Search, and Relation Graph exist to maintain useful personal context across DSH conversations.

## Product boundary

- One user.
- Local-first.
- One global Personal Data Directory shared across DSH Workspaces.
- Data remains readable, editable, portable, and recoverable without DSH.
- Computed views, Agent operations, Session Curation, and native product UI require DSH.
- No Personal OS cloud, account, collaboration, or synchronization service.

## Domain model

### Durable objects

- `Knowledge`: durable understanding the user wants to retain.
- `Todo`: a concrete, completable commitment; it belongs to at most one Project.
- `Project`: an ongoing outcome organizing Knowledge and Todo.
- `Capture`: preserved unclarified input; it is not an Entity.

Knowledge, Todo, and Project are Entity types. Inbox is the pending-Capture state and view, Today and Calendar are date-sensitive projections, Timeline is a chronological projection, and Relation Graph is a projection of explicit Relations.

### V0.1 Relations

```text
Todo      --belongs_to--> Project       0 or 1
Knowledge --belongs_to--> Project       0 to many
Todo      --derived_from--> Knowledge   0 to many
Knowledge --related_to--- Knowledge     symmetric, many to many
Capture   --produced-----> Entity       0 to many
```

V0.1 has no custom Relation types, nested Projects, or inferred graph edges. Relations are stored once on their source object; reverse lookup is derived.

### Project progress

Project progress is the completion ratio of directly related Todo entities. A Project without Todo does not show a percentage. The Agent cannot assign subjective progress.

## Data ownership and storage

Markdown in the Personal Data Directory is the only domain source of truth. The normative format is [Personal OS Markdown Format](./markdown-format.md).

```text
Personal Data Directory/
├── inbox/
├── knowledge/
├── todos/
├── projects/
├── timeline/
├── attachments/
├── templates/
├── archive/
│   ├── captures/
│   ├── knowledge/
│   ├── todos/
│   └── projects/
└── .personal-os/
    └── cache/
```

- Each Entity and Capture has one Markdown file.
- Timeline uses daily Markdown files.
- Stable Frontmatter IDs survive file renames and moves.
- Archive state is expressed by directory location.
- Attachments are ordinary files referenced through relative Markdown paths.
- Indexes and caches may be deleted and rebuilt without losing domain facts.
- SQLite is not authoritative. A future SQLite FTS index may exist only as a disposable projection.

## Indexing and external changes

At startup, the Host scans managed directories, parses Markdown and Frontmatter, validates the domain graph, and builds in-memory identity, type, status, tag, date, Relation, Timeline, and text-search indexes.

During operation, file watching incrementally handles create, modify, rename, move, and delete events. Every accepted change updates the index, increments a revision, and refreshes the Client and Agent-facing reads.

The toolbar Refresh action performs a full rescan, index rebuild, and diagnostic pass. It is a recovery and verification control, not the normal synchronization mechanism.

External content is treated conservatively:

- Unknown fields are preserved.
- Files are never rewritten merely to normalize formatting.
- Invalid files retain their last successfully indexed version when possible.
- Duplicate IDs, invalid Frontmatter, duplicate Relations, and unresolved Relations produce Content Diagnostics.
- Affected rows show a restrained red exclamation mark; module navigation shows an aggregate count.
- The Inspector explains the problem and can prepare an Agent repair instruction.
- No diagnostic authorizes silent content repair.

## Authoring model

The supported authoring paths are:

1. Create or edit Markdown directly.
2. Create a document from an Entity Template in the Inspector.
3. Send content through the DSH composer.
4. Ask the Agent during or after a Session to create, organize, or update documents.

All paths produce the same Markdown contract. Agent-mediated management is primary, but direct files and deterministic UI controls remain first-class.

### Templates

V0.1 ships Capture, Knowledge, Todo, and Project defaults and reserves a user-owned `templates/` directory. Users may duplicate and edit Markdown templates; there is no visual template builder, marketplace, or conditional template language.

Templates may set authored defaults such as headings, tags, priority, and Project state. Personal OS always supplies schema identity, object ID, kind, timestamps, computed data, reverse Relations, and Session-analysis state.

A managed Markdown file without required identity metadata appears as a pending-initialization document with a Content Diagnostic. The user, UI, or Agent may explicitly initialize it; scanning never silently modifies it.

### Inspector editing

The Inspector is the mandatory embedded surface for Markdown creation and editing. It opens a template-generated document in a native-style editor, performs revision-aware explicit save, writes atomically, and refuses silent overwrite when the disk changed externally. “Open file” remains available for external editors.

## DSH-native architecture

Personal OS composes DSH capabilities instead of implementing parallel infrastructure:

| DSH capability | Personal OS use |
|---|---|
| Agent Runtime | interactive Agent and background Curator |
| Session Event Log | real-time Session Evidence |
| Session Query | cold and historical Session Evidence |
| Permission mode | Agent operation confirmation behavior |
| Tool Runtime | Personal OS read and write capabilities |
| Skill Registry | on-demand Personal OS operating rules |
| System Prompt | stable capability declaration and small dynamic pointers |
| Jobs / Agent lifecycle | tracked, cancellable import and curation work |
| Settings | plugin configuration namespace and native card |
| Credentials | any future secrets without readback |
| Client Slots | Sidebar, Shell Overlay, Settings, and native layout integration |
| Typed Remote | Client-to-Host Personal OS boundary |
| Workspace and Sessions | preserved DSH conversation experience |

Personal OS owns the personal domain, Markdown persistence and indexing, projections, and the adapters into DSH. It does not own model providers, conversation persistence, generic permissions, Agent streaming, or a separate job runtime.

## Session Curation

### Main path

When the user explicitly asks to remember, capture, create, update, organize, or generate a document, the current DSH Agent calls Personal OS Tools immediately.

### Background path

The Curator is a dedicated DSH-managed Agent with only the necessary Session Query and Personal OS capabilities. It never calls a provider SDK directly.

Automation levels:

- `off`: no automatic Task detection or proposal; explicit “完成并整理” and manually initiated historical processing remain available.
- `balanced` (default): detect a completed Task and create one Outcome Proposal for review without mutating Domain Facts.
- `proactive`: use the same proposal pipeline and automatically apply only high-confidence candidates; ambiguous candidates remain pending and visible.

The Curator maintains reconstructible Task Spans inside eligible main Sessions. One span may include clarification, approval, retry, implementation, verification, commit, and push turns. Every Task has at most one current Outcome Proposal; repeated observation updates the same proposal by Task/Outcome identity, content hash, source range, candidate identity, and affected revision. Historical processing is explicitly initiated and walks Session evidence by completed turns to reconstruct Task boundaries; no startup backfill runs automatically.

### Curation quality boundary

- Explicit user instructions may directly create or change Entities.
- Explicit commitments, decisions, completed actions, and Project changes may be recorded under DSH permission policy.
- Automatic curation never creates Capture. Unresolved material stays in the Outcome Proposal until the user explicitly chooses “存入收件箱.”
- Meaningful completed work becomes one grouped Task Activity in Timeline without requiring a new Entity.
- Pure questions, casual conversation, retries, raw streaming chunks, model reasoning, and low-value Tool noise are excluded.
- Original transcripts, Tool parameters, and file contents are never copied wholesale into Personal OS.
- Derived facts store only DSH provenance locators such as Session ID, Task/Outcome ID, Workspace, and event-sequence range.

### Learning scope

- The current user-authored main Session participates by default.
- Subagent, automated, and system Sessions are excluded by default.
- Historical backfill requires an explicit first-run choice.
- Users may exclude individual Sessions or Workspaces.
- Cross-Workspace learning is separately configurable; Host-level technical access is not treated as user authorization.

## Agent context and capabilities

Agent integration uses four layers:

1. A small System Prompt section declares that Personal OS exists.
2. A Personal OS Skill contains detailed operating and curation rules.
3. Dynamic Context contributes only current Project, due count, Inbox count, and Continue pointers.
4. Tools retrieve full content and perform mutations on demand.

The current Session is not duplicated into Dynamic Context because DSH already owns it. Cross-Session continuity comes from curated Markdown facts and Session Activities.

V0.1 Tool surface:

```text
personal_search
personal_get
personal_get_today
personal_get_project_context
personal_capture
personal_create
personal_update
personal_link
personal_archive
personal_curate_session
personal_review_task_outcome
personal_history
personal_revert
```

Tools return compact structured results. All mutations pass through the same Domain Service as UI Remote calls and contribute Timeline records. `personal_review_task_outcome` accepts, edits, retries, dismisses, explicitly captures unresolved material, or safely undoes the same Outcome state shown beside the conversation and on Today. `personal_history` and `personal_revert` are available only when Version History is enabled.

## Permission and recoverability

Personal OS does not add a second confirmation system. Under DSH Full access, Agent mutations execute without per-operation Personal OS prompts.

Normal deletion is a move into Archive and remains recoverable. Permanent deletion requires an explicit instruction but no second product-specific confirmation under Full access. Every mutation contributes an operator and summary to Timeline.

## Version History

Initial setup and Settings offer optional local “Version History,” with advanced disclosure that Git provides it.

- Enabling may initialize or reuse a local repository.
- Personal OS never creates a remote, authenticates, pushes, or changes branches on its own.
- One logical UI operation, Agent instruction, accepted Task Outcome, Vault Import, or stable external-edit batch forms one semantic checkpoint.
- A multi-file Agent action forms one checkpoint.
- Restore uses a new revert commit rather than destructive reset.

Timeline is an audit and activity projection, not a full version store. Version diff and restoration depend on Version History.

## Vault Import

Vault Import is an optional restartable DSH background job.

- Default behavior copies content and leaves the source Vault unchanged.
- An advanced in-place option must preview the files that will be modified.
- Preflight reports Markdown count, attachment count, and likely conflicts.
- Progress is visible, cancellable, and retryable.
- Source identity makes retry idempotent.
- Ordinary Markdown becomes Knowledge.
- Unknown Frontmatter, tags, relative attachments, and usable Wiki Links are preserved or translated.
- Checkboxes are not automatically converted into Todo.
- Projects and Knowledge classification are not inferred speculatively.
- Completion produces an import report and one Version History checkpoint when enabled.

## Native UI

Personal OS replaces the complete DSH `sidebar` slot, uses its own Logo, and accepts responsibility for preserving native DSH behavior as closely as possible.

### Sidebar

```text
Personal OS Logo                         Collapse

Conversation / My

Conversation
├── New Session
├── Search
├── Filter
├── New Workspace
├── Workspace list
└── Session list

My
├── Search
├── Refresh
├── Relation Graph
├── New
├── Today
├── Inbox
├── Knowledge
├── Todo
├── Projects
├── Timeline
└── Calendar

Settings
```

Conversation preserves Workspace and Session browsing, creation, switching, search, filtering, collapsed rail behavior, empty states, connection states, and Settings access. My uses the same native spacing, controls, interaction patterns, color variables, and responsive behavior.

The New action is contextual: it directly creates the current page's kind; from Today, Timeline, and Calendar it opens a kind chooser. An alternate chooser remains available from typed pages.

### Overlay and Inspector

Today, list pages, Global Search, Relation Graph, and Entity Inspectors use `shell.overlay` while the DSH Agent remains the conversation surface. On narrow layouts, the Sidebar folds first and the native concession behavior prioritizes a readable Inspector with a way back to Agent; V0.1 has no independent mobile layout.

Complex Agent actions prepare text in the native DSH composer so the user can inspect or extend it before sending. The conversation input dock shows the current Task state, Personal Context actually read through Personal OS Tools, and the documents an Outcome proposes to change. A pending Task Outcome is backed by the same proposal used on Today. Deterministic actions such as completing a Todo, changing a date or state, archiving, restoring, correcting an unapplied Task boundary, and reviewing an Outcome execute directly.

### Page operation matrix

- Today: pending Outcome Reviews under “等待我确认,” active/waiting/blocked Agent Tasks under “继续进行,” task-boundary diagnostics and safe correction, Continue, today's Todo, active Projects, pending Inbox, recent Knowledge, recent Agent outcomes, and today's activity. Continuing an Agent Task opens its originating DSH Session.
- Inbox: Capture list, create, provenance, ask Agent to process, and archive.
- Knowledge: list, tags and filters, create, Inspector edit, Relations, History, Properties, and Agent actions.
- Todo: Today, Upcoming, No date, Completed; complete, date, priority, and Inspector.
- Projects: state groups, derived progress, and Inspector aggregation of Todo, Knowledge, and Timeline.
- Timeline: domain changes and grouped Task Activities filtered by date, Project, Workspace, and source; low-level mutations retain audit data but share one user-facing Outcome row.
- Calendar: month view and daily Agenda for Todo dates and Project target dates.
- Global Search: overlay search across Personal OS text and metadata with Kind, tag, Project, and state filters.
- Relation Graph: global and Entity-focused explicit graphs with type, Project, and tag filters; selecting a node opens Inspector.

## Settings

The native Personal OS Settings card contains:

- Data: directory, Version History, Vault Import, open directory.
- Agent Curation: automation level, Curator model, historical backfill, cross-Workspace learning, exclusions.
- Templates: defaults and open template directory.
- Status and Diagnostics: environment, index, content problems, and full refresh.

Theme, DSH permissions, generic model-provider configuration, and credentials remain owned by DSH.

## Initial setup

Initial setup asks only:

1. Create or select the Personal Data Directory.
2. Enable optional Version History.
3. Allow optional learning from historical DSH Sessions.
4. Optionally import an existing Vault.

The initial scan runs as a background task and opens Today. Templates, model selection, Relation rules, and Git details keep defaults and remain in Settings.

## V0.1 non-goals

- Multi-user or team collaboration.
- Personal OS accounts or cloud synchronization.
- Mobile application.
- Vector semantic search.
- Image OCR or attachment full-text extraction.
- Recurring Todo or Habit systems.
- Reminder notification system.
- Third-party Calendar synchronization.
- Custom Relation types.
- Nested Projects.
- Template marketplace, visual template builder, or conditional template language.
- A complete standalone application or CLI independent of DSH.

## Definition of Done

V0.1 is complete only when:

1. Every page and global surface in the operation matrix completes its core interaction.
2. UI writes are immediately visible to Agent Tools.
3. Agent Tool writes immediately refresh the UI.
4. External Markdown edits incrementally refresh both UI and Agent reads.
5. Restart reconstructs the complete domain from the Personal Data Directory.
6. File rename and archive moves preserve identity and Relations.
7. Invalid files do not damage or block unrelated content.
8. External concurrent edits are never silently overwritten.
9. Archived content can be restored.
10. Session Curation is incremental, idempotent, scoped, and does not feed back on its own Tool events.
11. Version History creates semantic checkpoints and can restore through revert when enabled.
12. Vault Import is preflighted, cancellable, restartable, and idempotent.
13. Conversation mode preserves essential DSH Sidebar capabilities.
14. Narrow-window behavior remains usable through native DSH layout concessions.
15. Core domain, filesystem-watching, Tool/Remote consistency, curation, migration, and UI flows have automated tests.
