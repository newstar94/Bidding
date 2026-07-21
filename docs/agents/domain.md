# Domain Docs

This repository uses a single-context domain documentation layout.

## Before exploring

Read these resources when they exist:

- `CONTEXT.md` at the repository root.
- Relevant ADRs under `docs/adr/`.

If these resources do not exist, proceed silently. Skills such as `domain-modeling`, `grill-with-docs` and `improve-codebase-architecture` create them when domain terms or architectural decisions are resolved.

## Expected layout

```text
/
├── CONTEXT.md
├── docs/
│   ├── agents/
│   └── adr/
├── backend/
├── frontend/
└── views/
```

## Vocabulary

Use domain terms defined in `CONTEXT.md`. Avoid introducing synonyms for concepts that already have an established name.

If a required concept is missing, record it for the `domain-modeling` workflow.

## ADR conflicts

If proposed work contradicts an existing ADR, identify the conflict explicitly instead of silently overriding the decision.
