# Personal OS

Personal OS is a personal context layer for DeepSeek Harness. It lets one person maintain durable personal information and use an Agent to organize and act on that information across conversations.

## Core language

**Personal OS**:
An embedded DeepSeek Harness product context that keeps a person's durable knowledge, commitments, and ongoing work available to both the person and the DSH Agent.
_Avoid_: Personal knowledge base, productivity suite, Notion replacement

**Personal Context**:
Curated, durable understanding of what the user knows, intends, and is working on. It is distilled into Domain Facts rather than equated with raw conversation history.
_Avoid_: Chat history, prompt dump, memory database

**Session Evidence**:
Relevant DSH Session Event Log material from which the Agent may derive Personal Context. Session Evidence remains owned by DSH and is referenced by identity and event range rather than copied wholesale into Personal OS.
_Avoid_: Personal Context, imported transcript

**Agent-Mediated Management**:
The primary Personal OS workflow in which the user expresses intent through DSH conversation and the Agent reads or changes Domain Facts through Personal OS capabilities. Direct Markdown authoring and small UI edits remain supported first-class alternatives.
_Avoid_: Agent-only authoring, form-first management

**Session Curation**:
The cautious process that derives reviewable Task Outcomes from eligible Session Evidence. It operates at complete Task boundaries, not completed-turn boundaries, and never creates Capture automatically.
_Avoid_: Transcript import, automatic memory dump

**Task Span**:
A reconstructible operational boundary inside one eligible main Session that joins an objective with its clarifications, approvals, retries, Tool evidence, and terminal result. It is not a Domain Fact or Document Kind.
_Avoid_: Turn, Todo, Session transcript

**Task Boundary Diagnostic**:
Compact, reconstructible reasons explaining why a Task Span started, continued, waited, blocked, or became a completion candidate. A user may correct an unapplied boundary by splitting the latest objective or merging it into the previous Task without rewriting accepted Domain Facts.
_Avoid_: Hidden classifier trace, copied reasoning, transcript

**Session Context Usage**:
A compact record of Personal Context documents actually returned to a main Agent through Personal OS read Tools during the current Task. It is shown separately from proposed or applied Outcome changes.
_Avoid_: Inferred relevance, full Tool log, automatic Relation

**Outcome Proposal**:
Reconstructible review state for one completed Task Span, containing a result summary, typed candidates, unresolved items, confidence, provenance, and application state. Accepting it changes Domain Facts through the shared Domain Service; deleting it does not delete accepted facts.
_Avoid_: Capture, Entity, summary note

**Task Outcome**:
The coherent result of one complete piece of Agent-assisted work, represented by one Outcome Proposal and, when accepted, one grouped Timeline Activity plus justified updates to Personal Context.
_Avoid_: Completed turn, Inbox record, transcript summary

**Curator**:
The DSH-managed Agent responsible for analyzing a complete Task Span and proposing conservative Task Outcome candidates under the user's configured scope and automation level.
_Avoid_: Background LLM, memory daemon

**Session Activity**:
A meaningful completed-work, decision, project-movement, or unfinished-action summary derived from Session Evidence and projected into Timeline without requiring a new Entity.
_Avoid_: Session transcript, every completed turn

**Entity Template**:
A canonical starting structure for one durable object kind that produces files conforming to the same domain contract whether invoked by the UI, the Agent, or the user. Templates may supply authored defaults but never system identity, timestamps, computed values, or analysis state.
_Avoid_: Schema, document theme

**Document Kind**:
The category declared by a managed Markdown file: Capture, Knowledge, Todo, or Project. Knowledge, Todo, and Project are Entity types; Capture is not.
_Avoid_: Entity Type when referring to Capture, file type

**Personal Data Directory**:
The single user-owned directory containing all durable Personal OS domain facts. It belongs to the user across DSH Workspaces, and copying it is sufficient to recover those facts without DeepSeek Harness.
_Avoid_: Database, workspace

**Entity**:
A durable personal object with a stable identity and lifecycle. In the first release, the Entity types are Knowledge, Todo, and Project.
_Avoid_: Item, record, document

**Knowledge**:
A durable piece of understanding the user wants to retain and recover later. Knowledge may belong to multiple Projects and may be related to other Knowledge.
_Avoid_: Note, page

**Todo**:
A concrete, completable commitment belonging to the user. A Todo may belong to at most one Project and may be derived from Knowledge.
_Avoid_: Task item, reminder

**Project**:
An ongoing outcome that organizes related Knowledge and Todo entities.
_Avoid_: Folder, category

**Capture**:
Unclarified input saved for later understanding and classification. Processing preserves the original Capture and records the Entities it produced.
_Avoid_: Inbox item, temporary Entity

**Inbox**:
The processing state and view containing Captures that have not yet been clarified. Inbox is not an Entity type.
_Avoid_: Inbox Entity, folder

**Today**:
A date-sensitive view of the personal context that deserves the user's attention now. Today is not an Entity.
_Avoid_: Dashboard, homepage Entity

**Continue**:
A Today pointer to recent unfinished work that the user can naturally resume with the Agent.
_Avoid_: Recent item, session history

**Timeline**:
A chronological projection of recorded domain changes and meaningful DSH Session outcomes. It may preserve completed work, decisions, project movement, and unfinished actions without turning every Session into Knowledge; Timeline is not an Entity.
_Avoid_: Activity Entity, audit database

**Calendar**:
A date-based projection of planned work, including Todo scheduling and Project target dates. Past changes and editing activity belong to Timeline instead.
_Avoid_: Activity calendar, event log

**Global Search**:
Search across the Personal Data Directory's Entities and Captures. Global refers to the Personal OS context, not DSH conversations, other workspaces, or the user's computer.
_Avoid_: Computer search, conversation search

**Relation Graph**:
A global or Entity-focused projection of explicit Relations recorded in the Personal Data Directory. Suggested or inferred associations are not graph edges until recorded as Relations.
_Avoid_: Semantic graph, inferred graph

**Relation**:
A typed association between two durable objects. The first release recognizes belongs-to, derived-from, related-to, and produced relations.
_Avoid_: Link, reference, arbitrary edge

**Project Progress**:
The completion ratio derived from the Project's directly related Todo entities. It is not a manually or subjectively assigned value.
_Avoid_: Health score, Agent estimate

**Archive**:
The recoverable state for domain objects removed from active views without destroying their facts.
_Avoid_: Delete, trash database

**Version History**:
Optional local history of changes to the Personal Data Directory, backed by Git without requiring the user to manage Git concepts during ordinary use.
_Avoid_: Cloud backup, synchronization

**Vault Import**:
A one-time, restartable initialization that brings an existing Markdown vault into the Personal Data Directory. Ordinary imported Markdown becomes Knowledge unless the user or Agent classifies it further.
_Avoid_: Vault synchronization, automatic classification

**Content Diagnostic**:
A non-blocking problem attached to a managed file, such as invalid Frontmatter, a duplicate identity, or an unresolved Relation. Diagnostics never authorize silent repair of user content.
_Avoid_: Import failure, fatal error

**Domain Fact**:
Any durable information needed to reconstruct Personal OS, including Entity state, relations, Captures, and recorded changes.
_Avoid_: Cache, index

**Derived View**:
A reconstructible presentation computed from Domain Facts, such as Today, Timeline, project progress, or search results.
_Avoid_: Source data
