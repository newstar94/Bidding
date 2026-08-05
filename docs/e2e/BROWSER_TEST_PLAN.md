# BiddingFlow browser test plan

## Scope and baseline

- Repository: `D:\Bidding`.
- Branch/commit tested: `main` / `8b935359f40ce2841014f8f40dff5b1c91fcc032`.
- Prompt reference commit: `e2196fb1e9e116fa11fa6de62843c361c3497cf2`.
- Base URL: `http://127.0.0.1:8000`.
- Data: local PostgreSQL/E2E fixtures only; no production data.
- UI browser exploration: Codex In-app Browser, headed, login performed through the visible form.
- Automated browser runner: Playwright 1.62.0 with Chromium, Firefox and WebKit.

## Test strategy

1. Inventory source routes, views, domain enums, validation and permission policy.
2. Run existing E2E scripts without changing product behavior.
3. Exercise high-risk flows through UI: auth, workspace, CRUD, assignment, package lifecycle, evaluation, award, contracts, documents, offline sync and conflicts.
4. Run the generated business matrix. The current generator produces 624 valid package-form/evaluation tuples and 7 negative boundary tuples; exact tuple execution remains explicitly tracked.
5. Run the canonical Playwright smoke on all three browsers with HTML, JUnit, JSON, screenshot, video and trace reporters.
6. Record every failure with a reproducible step and artifact path; keep environment blockers separate from product defects.

## Required coverage matrix

| Area | Critical scenarios | Primary evidence/test IDs | Status |
|---|---|---|---|
| Auth/session | login, invalid login, logout, expiry, revoke, reset, registration | `AUTH-*`, `scripts/verify_auth_roles_e2e.mjs` | Partial; reset assertion mismatch and Turnstile environment block |
| Workspace | personal/org, workspace switch, reload, back/forward, cross-org | `WS-*`, auth roles, CRUD | Partial; fixture suite reached these flows before later failure |
| RBAC | super admin, manager, employee, view/edit/deny, deep link, cross-org | `RBAC-*`, auth roles, multi-assignee | Partial; owner role and full matrix remain uncovered |
| Assignment | one/many assignees, add/remove, successor requirement, audit | `ASSIGN-*`, `test:multi-assignee-e2e` | Pass for executed fixture |
| Plans | create/read/update/delete, project/budget approval variants, reload | `PLAN-*`, CRUD/lifecycle | Partial; CRUD pass, exact plan combinations not exhaustive |
| Packages | forms, procedures, methods, medicine, lots, 1G1T/1G2T, cancel/rebid | `PKG-*`, pairwise, JV, lifecycle | Partial; 624 generated tuples are not all executed |
| Opening/evaluation | opening, technical/financial, detailed evaluation, low-price, result | `EVAL-*`, JV, low-price, lifecycle | Partial; lifecycle failed after award reload assertion |
| Contracts | CRUD, status transitions, JV contract, permissions | `CONTRACT-*`, CRUD/JV | Partial; lifecycle contract step not reached |
| Documents | PDF validation, upload/download/delete, Word/Excel export, import | `DOC-*`, CRUD/JV | Partial; bidder-goods fixture blocked |
| Offline/sync | offline create/update/delete, retry, conflict, multi-tab | `SYNC-*`, offline, low-price, multi-assignee | Partial; multi-tab browser matrix not complete |
| Accessibility | axe serious/critical, keyboard, focus, labels, table headers, live regions | `A11Y-*`, smoke, authenticated UI matrix | Fail: `.content-viewport` serious axe finding |
| Responsive | 320, 375, 414, 768, 1280, 1440, zoom 200% | `A11Y-*`, UI quality, authenticated UI matrix | Partial; 1440 and 200% not run |
| Performance | cold/warm shell, API count/size, long tasks, stability | `PERF-*`, `test:performance` | Pass for current baseline; large dataset not run |

## Browser and viewport matrix

| Browser | 320×800 | 375×812 | 414×896 | 768×1024 | 1280×800 | 1440×900 |
|---|---|---|---|---|---|---|
| Chromium | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | Not run |
| Firefox | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | Not run |
| WebKit | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | smoke/authenticated matrix | Not run |

The existing authenticated matrix uses 320, 375, 414, 768 and 1280 dimensions; its output passed. The canonical smoke uses the configured desktop device per browser. The 1440×900 and zoom-200% requirements remain uncovered.

## Evidence policy

- Failure artifacts are retained under `test-results/` and the HTML report is `playwright-report/`.
- The canonical Playwright runner writes `test-results/e2e-junit.xml`, `test-results/e2e-results.json`, screenshots, videos and traces on failure.
- Console/page/network failures are collected by the smoke spec and existing suites.
- Never record password, OTP, token, cookie or secret values.
- API/database shortcuts are used only by existing fixture/reset helpers and post-UI verification; the primary behavior is exercised via UI.

## Test ID convention

`AUTH`, `WS`, `RBAC`, `PLAN`, `PKG`, `LOT`, `MED`, `JV`, `EVAL`, `AWARD`, `CONTRACT`, `DOC`, `SYNC`, `A11Y`, and `PERF` prefixes are required for new scenarios. Page objects must contain UI actions only; business assertions belong in specs/helpers.
