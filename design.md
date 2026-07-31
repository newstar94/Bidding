# BiddingFlow design source

## Ownership and layers

`views/css/tokens.css` is the canonical token source. It follows three layers: primitive values, semantic purpose aliases, then component tokens. `variables.css` is a compatibility alias layer for legacy call sites and must not become a second source of design decisions.

The cascade order is fixed as `tokens → base → components → features → utilities → legacy`. New feature CSS belongs in `features`; compatibility overrides and generated/runtime rules belong in `legacy`. Migration is component-by-component, never a bulk rewrite.

## Visual contract

- Typography: Plus Jakarta Sans for UI/body; the documented monospace stack only for identifiers and code-like values.
- Spacing: 4 px base (`--space-1`) with the existing 4/8/12/16/20/24/32/40/48 scale.
- Radius: input 8 px, card 12 px, dialog 16 px, pill only for compact statuses.
- Shadows: surface shadow for local elevation; dialog shadow only for overlays.
- Focus: solid 2 px `--color-focus`, offset 2 px, contrast at least 3:1. Focus never changes border width.
- Z-index: use `--z-base`, `--z-sticky`, `--z-dropdown`, `--z-overlay`, `--z-modal`, `--z-toast`; new arbitrary high values are not allowed.

## Semantic colors

Use purpose aliases: paper/surface/ink/rule/accent/focus/success/warning/danger. Raw values are allowed only in `tokens.css` primitives or the legacy compatibility layer. Status labels are presentation from `LifecyclePolicy`; labels are not state codes.

## Component state contract

Buttons, Tabs, Select/Combobox, fields, dialogs, status feedback and table frames must define default, hover, focus-visible, active/loading, disabled and error states. Icon-only actions require an accessible name. Loading actions are disabled against double submit. Tabs use roving tabindex and Arrow/Home/End behavior.

## Accessibility and responsive behavior

Touch targets are at least 44 px where space permits. Keyboard interaction is equivalent to pointer interaction. Reduced-motion preferences are honored. Mobile summaries collapse repeated assignee names to the first label plus `+N`; internal IDs are never presentation fallback.

## Legacy compatibility policy

`initCustomSelect`, inferred button enhancers, direct `model.state` writes and runtime style mutation are compatibility-only. Migrated call sites use native/accessible primitives, explicit actions and `WorkspaceDataStore`. `scripts/check_frontend_debt.py` is a no-new-debt ratchet; baseline reductions should be committed when a migration removes debt.
