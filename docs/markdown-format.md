# Personal OS Markdown Format

This document defines the normative `dsh-personal-os/v1` format. Markdown files are the source of truth; indexes, reverse relations, progress, search data, and version-history metadata are derived.

## Managed directories

```text
inbox/
knowledge/
todos/
projects/
timeline/
attachments/
templates/
archive/captures/
archive/knowledge/
archive/todos/
archive/projects/
```

Files outside the managed directories are ignored. Moving an Entity between its active and archive directories archives or restores it. Pending Captures live in `inbox/`; processed and discarded Captures live in `archive/captures/`.

## Common Frontmatter

```yaml
---
schema: dsh-personal-os/v1
id: kn_01K00000000000000000000000
kind: knowledge
title: DeepSeek Harness 插件机制
created_at: 2026-08-20T14:20:00+08:00
updated_at: 2026-08-20T16:45:00+08:00
tags:
  - DSH
relations: []
source:
  kind: conversation
properties: {}
---
```

`kind` is one of `capture`, `knowledge`, `todo`, or `project`. IDs are ULIDs prefixed with `cap_`, `kn_`, `todo_`, or `prj_` respectively. Filenames remain human-readable and do not establish identity; a collision appends a short identity suffix.

The keys shown above are reserved. Templates may supply authored defaults such as tags, sections, priority, or Project state, but the system owns `schema`, `id`, `kind`, timestamps, computed values, reverse Relations, and Session-analysis state. Imported unknown Frontmatter is preserved without being interpreted; new custom data belongs under `properties`.

## Kind-specific fields

Capture:

```yaml
state: pending # pending | processed | discarded
processed_at:
```

Todo:

```yaml
state: open # open | done | canceled
priority: p2 # p0 | p1 | p2 | p3
start_date:
due_date:
completed_at:
```

Project:

```yaml
state: active # planned | active | paused | completed | canceled
target_date:
```

Knowledge adds no v1 state field. Project progress is derived from the completion ratio of directly related Todo entities and is never stored.

## Relations

Relations are stored once on their source document:

```yaml
relations:
  - type: belongs_to
    target: prj_01K00000000000000000000000
  - type: derived_from
    target: kn_01K00000000000000000000000
```

V1 recognizes `belongs_to`, `derived_from`, `related_to`, and `produced`. Reverse lookup is derived. `related_to` is semantically symmetric even though only one edge is stored. Titles and paths are never copied into Relation entries.

## Provenance

Conversation-derived content stores only DSH locators, not copied messages or Tool logs:

```yaml
source:
  kind: conversation
  session_id: ses_...
  seq_from: 120
  seq_to: 148
  workspace: /path/to/project
```

Imported and URL-derived content may use:

```yaml
source:
  kind: import
  original_path: Notes/example.md
```

```yaml
source:
  kind: url
  url: https://example.com
```

When more than one source applies, the singular `source` becomes a `sources` array containing the same shapes.

## Dates and timestamps

`created_at`, `updated_at`, `completed_at`, and `processed_at` are ISO 8601 timestamps with an explicit offset. `start_date`, `due_date`, and `target_date` are local calendar dates in `YYYY-MM-DD` form.

## Validation and migration

Unknown fields are preserved. Invalid Frontmatter, duplicate IDs, duplicate Relations, and unresolved Relation targets produce non-blocking Content Diagnostics; scanning never silently repairs or normalizes a file. A managed Markdown file without required identity metadata is a pending-initialization document until the user, UI, or Agent explicitly initializes it.

Older schema versions remain readable where supported. Migration is an explicit operation preceded by a Version History checkpoint and followed by one semantic commit; ordinary startup and refresh scans never rewrite files to migrate them.
