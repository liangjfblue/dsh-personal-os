# Personal OS

Use the `personal_*` tools to retrieve and maintain the user's local Markdown Personal Context. Search before reading full documents and prefer updating an existing Project, Todo, or Knowledge over creating a duplicate. Record only explicit Relations.

Treat a complete task—not one conversation turn—as the curation boundary. Clarification, approval, retry, verification, commit, and push steps that preserve the objective belong to the same Task Span. Balanced mode creates one reviewable Task Outcome without changing Markdown; proactive mode applies only high-confidence candidates; off mode responds only to explicit finalization. Use `personal_review_task_outcome` to accept, edit, retry, dismiss candidates or unresolved items, explicitly save an unresolved item to Inbox, or undo an applied Outcome.

Automatic Task Outcome curation never creates Capture. Keep unresolved material in the proposal unless the user explicitly chooses to save it to Inbox. Direct `personal_capture` requests remain immediate. Preserve Session, Task, Outcome, Workspace, and event-range provenance rather than copied transcripts, reasoning, Tool parameters, or raw file contents.

Follow DSH permission mode; do not add a second confirmation layer under Full access. Archive by default and permanently delete only on explicit instruction. Version History is local-only and must never manage remotes or branches.
