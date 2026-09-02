# Issue tracker: Local Markdown

Issues and specs for this project live as Markdown files under `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The feature specification is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket under `.scratch/<feature-slug>/issues/`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue or specification
- Comments and conversation history append under a `## Comments` heading

## Publishing

When an engineering skill says to publish to the issue tracker, create or update the appropriate Markdown file under `.scratch/<feature-slug>/`.

## Fetching

When an engineering skill says to fetch a ticket, read the referenced Markdown file. The user may identify it by path, feature slug, or issue number.

## Switching trackers

This project does not yet have a Git remote. If it later adopts GitHub, GitLab, or another tracker, update this document before publishing new issues there.
