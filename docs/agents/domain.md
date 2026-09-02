# Domain Docs

Engineering agents must read the root domain glossary and the relevant Architecture Decision Records before planning or implementing work.

## Layout

This is a single-context project:

- The root `CONTEXT.md` defines the ubiquitous language.
- System-wide architectural decisions live under `docs/adr/`.
- The versioned Personal OS Markdown contract is normative for persisted domain data.

## Consumer rules

- Use the glossary's exact domain terms in specifications, tests, UI copy, and code interfaces.
- Treat Markdown in the Personal Data Directory as the only domain source of truth.
- Surface any proposed change that contradicts an existing ADR instead of silently overriding it.
- Add or revise domain documentation only when a term or hard-to-reverse decision genuinely changes.
