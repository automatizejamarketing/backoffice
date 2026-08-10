# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## This repo's layout

Single-context, with the canonical contract living in the sibling repo:

- Root `CONTEXT.md` — this backoffice's responsibilities in the digital-products domain. It explicitly defers to the sibling repo's `../automatize-frontend/CONTEXT.md` as the canonical domain contract (both apps share the same Postgres database).
- This repo has **no `docs/adr/` of its own**. System-wide ADRs live in `../automatize-frontend/docs/adr/` — read the relevant ones before working on shared domains (DB schema, Meta marketing, billing).
- `../automatize-frontend/docs/CONTEXT.md` — the marketing / Meta Ads domain glossary. This repo's marketing pages and `lib/meta-business/` operate on that same domain vocabulary.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
