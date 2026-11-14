# BiddingFlow interface design system

This document records the design system that is already implemented in the
repository. It is provenance for `views/css/tokens.css` and
`views/css/ui-redesign.css`; it does not introduce a new visual direction.

## Source of truth and load order

- `views/css/variables.css` is the compatibility/runtime token layer used by
  the existing application styles. It defines aliases such as `--canvas`,
  `--surface`, `--ink`, `--line`, `--primary`, role accents, the legacy type
  scale, radii, shadows, and the 44px minimum touch target.
- `views/css/tokens.css` records the newer primitive and component layer
  (hex and OKLCH values), including spacing, typography, motion, component,
  shell, and overlay tokens.
- `views/css/ui-redesign.css` consumes both layers as presentation overrides.
  It must not change DOM hooks, business state, authorization, or field
  visibility.
- Route/component CSS may add local custom properties, but should reuse the
  shared tokens when the meaning is already represented.

The application currently has two compatible generations of tokens. They are
documented as implemented; consolidating them is a separate migration and is
not implied by this file.

## Visual direction

Since 2026-11-14 the workspace follows a Minimal UI direction, approved by the
product owner from the mockups in `artifacts/minimals-preview/`. It is a
presentation-only re-skin: DOM hooks, data visibility, roles, permissions and
entitlements are unchanged. The visual language is re-implemented in plain
CSS; no Minimal UI (minimals.cc) source code, React components, illustrations
or icons are bundled.

- Product character: operational workbench with restrained editorial hierarchy.
- Main surface: white canvas with white cards that carry soft elevation instead
  of borders (`--card-shadow`); table rows are separated by dashed rules and
  table headers sit on the `#f4f6f8` subtle surface.
- Anchor accent: green. The vivid `#00a76f` (`--color-accent`) is for marks,
  tints and focus; text and links use the text-safe `#007867` (`--brand`).
- Primary actions: contained ink buttons (`--button-bg`), outlined secondary
  buttons and borderless circular icon buttons in table rows.
- Status colors: success, warning, danger and info families. Vivid mains
  (`--color-*-main`) are only for tints and data marks; text tones keep at
  least 4.5:1 on their 16% soft tint. Status labels are soft, borderless and
  use the 6px `--radius-label`.
- Active-role accents: violet for Super Admin, green for Manager, cyan for
  Employee, shown as a soft tint with a strong label on the selected sidebar
  item. These colors communicate the already-selected persona; they do not
  grant or imply permissions.
- Typography: Public Sans (`--font-workspace`) inside the signed-in workspace
  (`body[data-active-role]`); public pages (landing, legal, not found) and the
  platform-admin console keep Plus Jakarta Sans. System monospace remains for
  technical values.
- Elevation: the card shadow for normal content; the larger dialog shadow is
  reserved for overlays.
- Page layouts: the dashboard opens with a welcome banner and a "next 7 days"
  card (`frontend/app/DashboardHero.js`), and the package "Thông tin gói thầu"
  step shows a progress/assignee/documents rail
  (`frontend/packages/detail/PackageOverviewRail.js`). Both only re-present
  data the page already loads for the current scope; they add no data source,
  alert rule, permission or export path.

## Token architecture as implemented

### Primitive values

`views/css/tokens.css` owns the explicit primitive scales:

- Color: `--color-paper*`, `--color-surface*`, `--color-ink`,
  `--color-muted`, `--color-rule*`, `--color-accent*`, status colors and
  their vivid `--color-*-main` tints, `--color-focus`, and `--color-scrim`.
- Font: `--font-display`, `--font-body`, `--font-mono` and the workspace
  `--font-workspace`.
- Space: `--space-1` through `--space-12` on a 4px base.
- Type: `--text-xs` through `--text-2xl`.
- Motion: `--ease-*` and `--dur-*`.
- Shape/elevation: `--radius-*` and `--shadow-*`.
- Overlay order: `--z-base`, `--z-sticky`, `--z-dropdown`, `--z-overlay`,
  `--z-modal`, and `--z-toast`.

### Semantic/runtime aliases

`views/css/variables.css` exposes the names used throughout the mature UI:

- Surface and content: `--canvas`, `--surface`, `--surface-subtle`, `--ink`,
  `--ink-muted`, `--ink-subtle`, `--line`, and `--line-strong`.
- Action and feedback: `--primary`, `--primary-hover`, `--primary-soft`,
  `--success`, `--warning`, and `--danger`.
- Persona presentation: `--role-super-admin*`, `--role-manager*`, and
  `--role-employee*`.
- Accessibility/layout: `--touch-target-min`, shared focus styling, shell
  dimensions, type, radius, and shadow aliases.

### Component tokens

The component tokens in `views/css/tokens.css` cover the stable shared seams:

- Button: `--button-bg`, `--button-fg`, `--button-hover-bg`,
  `--button-radius`.
- Input: `--input-bg`, `--input-border`, `--input-focus-ring`.
- Card: `--card-bg`, `--card-border`, `--card-radius`, `--card-shadow`.
- Table: `--row-hover`; labels use `--radius-label`.
- Shell: `--shell-sidebar-width`, `--shell-header-height`,
  `--control-height`.

## Interaction and accessibility contract

- Interactive controls must be keyboard reachable and keep a visible
  `:focus-visible` indicator.
- Touch targets use the existing 44px minimum where applicable.
- Modal focus is trapped in the topmost active dialog; lower dialogs and the
  page background are inert. Escape affects only the topmost dialog, and focus
  returns through the trigger chain when nested dialogs close.
- Dynamic fatal/error states use an alert or live region and expose an
  actionable Retry/Close path.
- Reduced-motion preferences must disable nonessential transitions/animations.
- Color is not the only carrier of business state; labels or icons remain.

## Responsive contract

- Preserve complete content and functionality at narrow widths.
- Auth switches from a two-panel card to one stacked column at 820px and below.
- Route layouts may collapse navigation and grids without changing data or
  action availability.
- Check boundary widths at 320, 640, 768, 820, and 1024px, including keyboard
  focus and 200% zoom.

## Change discipline

- Do not raise CSS/debt ratchets to accommodate a change.
- Do not add `!important`, raw colors, runtime styles, or direct state writes
  when an existing token or state seam covers the need.
- A visual change must preserve current field visibility, role/persona,
  permissions, assignment scope, record scope, and entitlement semantics.
- Update this document only when the implemented token/component contract
  changes; do not use it to claim decisions that are not present in code.
