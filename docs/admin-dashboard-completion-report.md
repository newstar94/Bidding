# BiddingFlow Tabler Admin Migration — Completion Report

This report audits the production implementation state through `98ad2688`. Later commits may update this evidence document without changing production code; the exact branch head remains authoritative in Git history and GitHub Actions. Earlier migration evidence is retained where noted; evidence from older SHAs is historical. The latest UI correction adds visible overview charts, invoice-request KPI placeholders, canonical settings destinations, and updated analytics documentation.

## 1. Baseline

| Item | Value |
| --- | --- |
| Migration baseline | `c0d8ebfc699258c28662f7d03e7bbadd507a9305` (parent of first Tabler-shell commit) |
| Implementation SHA audited | `98ad2688` |
| Branch | `main` |
| `origin/main` at implementation audit | `98ad2688` |
| Baseline CI | No single terminal baseline run was reconstructed for this report; historical prompt evidence recorded failures before the migration |
| Latest implementation remote CI | Full CI `34610312708`, CodeQL `34610312684`, N+1 `34610312703`, Supply-chain `34610312701`: success on `98ad2688` |
| Legal production release | Blocked by 27 external legal facts; no approval or production-public artifact is claimed |

## 2. Legacy Dashboard Inventory

| Legacy feature | Old file / entry | Old API | New destination |
| --- | --- | --- | --- |
| Platform overview | `views/tabs/tab_superadmin_dashboard.html` | Existing account/organization/subscription facts, now aggregated by `/api/admin/overview` | `/admin` |
| Account administration | `views/tabs/tab_superadmin.html`, `frontend/admin/AdminUserController.js` | `/api/auth/users*`, `/api/organizations/*` | `/admin/users`, `/admin/organizations` |
| Usage analytics | `views/tabs/tab_usage_analytics.html`, `frontend/admin/UsageAnalyticsView.js` | `/api/admin/usage-analytics/summary` | `/admin/analytics` |
| Product analytics | `frontend/admin/ProductAnalyticsView.js` | `/api/admin/product-analytics/dashboard` | `/admin/analytics` |
| Commercial plans/policies | `views/tabs/tab_commercial_admin.html`, `frontend/commercial-policy/CommercialControlCenter.js` | `/api/commercial/admin/overview`, draft/release APIs | `/admin/plans` |
| Payment/order actions | `CommercialControlCenter.js` | `/api/billing/admin/orders/{id}/{review,reconcile,refund}` | `/admin/payments` |
| Legal catalog | Card in `tab_superadmin_dashboard.html` | `/api/legal-versioning/*` | `/admin/legal` |

The full codebase map, including frontend entry, backend service, DB tables and permission, is maintained in `docs/admin-dashboard-architecture.md`.

## 3. New Admin Architecture

- Entry: server-authorized `/admin` HTML shell in `views/admin/index.html`.
- Frontend: vanilla ES modules under `frontend/admin-platform/`; `AdminApp.js` composes the shell and 17 declared routes.
- Assets: locally bundled, pinned Tabler 1.4.0 CSS plus BiddingFlow theme CSS; no production CDN or demo application.
- Backend: focused modules under `backend/admin/` for overview, authoritative activity, directories, billing reads, security, operational/process metrics and jobs/sync. Existing commercial, billing, analytics, legal and organization services are reused.
- Authorization: every shell/API request is checked server-side for existing platform `super_admin`; organization-manager scope is not accepted as platform authority.
- Data: dedicated online-only admin APIs; platform users, billing, invoice requests and secrets are not inserted into workspace offline sync/IndexedDB.
- Database: existing normalized tables and aggregate facts are queried with bound parameters, allowlisted sort/filter mappings and bounded pagination.

## 4. Screens / Features Added

| Route | Working scope |
| --- | --- |
| `/admin` | Authoritative KPI slots, prominent organization/account status charts with table fallback, mixed-source recent activity and operational alerts; unsupported billing facts show unavailable |
| `/admin/analytics` | Usage, product/commercial and operational analytics with date presets/custom range, filters, charts, table fallback and explicit `N/A` for unavailable time series |
| `/admin/organizations` | Server-paginated directory, filters, details, subscription/usage/activity links and supported lifecycle actions |
| `/admin/users` | Server-paginated directory, filters, details, memberships/sessions/usage/audit and supported account actions |
| `/admin/plans` | Authoritative public offers, releases, prices, benefits/capabilities, credit packs and structured versioned draft workflow |
| `/admin/subscriptions` | Existing account/organization subscriptions, statuses, source and timeline |
| `/admin/invoices` | Real invoice-request records, direct `/admin/invoices/{id}` links and back/forward-safe details; explicitly not a fabricated invoice ledger/document store |
| `/admin/payments` | Billing orders, verified transaction history and supported reconcile/review/refund actions |
| `/admin/settings` | Writable allowlisted feature switches and their descriptions in development/test; no duplicated runtime/environment inventory |
| `/admin/environment` | Allowlisted runtime/deployment metadata and configured/missing secret replacement; no duplicated feature-status card and no secret readback |
| `/admin/legal` | Existing immutable/versioned legal catalog workflow |
| `/admin/audit` | Bounded audit search/filter/sort/page and sanitized detail |
| `/admin/security` | Failed-login, session, suspicious/authorization/admin-action summaries and sanitized session detail |
| `/admin/health` | Application, PostgreSQL, storage, backup, sync/jobs, process/API/DB latency, 4xx/5xx, DB failure and worker/queue metrics in sanitized form |
| `/admin/system/jobs` | Bounded job list/detail and eligible document-job retry |
| `/admin/system/sync` | Bounded WebSocket/sync-event operations view |
| `/admin/system/version` | Application, release, SHA/build, environment, schema and frontend asset identity |

## 5. Feature Parity Matrix

| Feature | Old | New | Test | Status |
| --- | --- | --- | --- | --- |
| Platform-admin landing and navigation | Workspace tabs | Isolated `/admin` Tabler shell | `test_admin_platform_shell.py`, `admin_platform_router.test.mjs`, `admin-shell.spec.mjs` | Migrated |
| Platform authorization | Workspace role/UI gating | Server-authorized shell and each API | Backend route tests and browser unauthorized-access case | Migrated without role-semantics change |
| Overview KPIs | Static cards populated by legacy flow | Bounded aggregate endpoint; real/missing states | `test_admin_overview.py`, `admin_platform_overview.test.mjs` | Migrated |
| Overview charts | No equivalent operational visualization | Real organization/account status distributions with accessible table fallback | `admin_platform_overview.test.mjs`, `admin-shell.spec.mjs` | Newly added and verified |
| Recent organizations | Legacy overview table | `/admin/organizations`, overview activity | Directory/overview backend and JS tests | Migrated |
| User search/list/detail | Legacy system-user table/modal | Paginated user page and detail drawer | Directory route/JS/E2E tests | Migrated |
| Account status and metadata actions | Legacy modal/controller | Detail-drawer forms using existing mutation endpoints | Directory JS tests plus existing auth/organization suites | Migrated where backend already supports action |
| Organization detail/lifecycle | Legacy dashboard/modal | Paginated organization page and detail drawer | Directory route/JS/E2E tests | Migrated |
| Usage analytics | Legacy usage tab | Unified analytics center | Usage/product analytics tests and admin analytics tests | Migrated |
| Product analytics views and filters | Legacy commercial-intelligence panel | Unified analytics center | `admin_platform_analytics.test.mjs`, existing product analytics tests | Migrated |
| Operational analytics | Hard-coded or scattered status | Authoritative process/API/database/error/worker metrics with explicit unavailable states | Operational backend, analytics JS and browser tests | Newly added and verified |
| Commercial catalog and versions | Legacy commercial control center | Plans page and structured draft editor | `admin_platform_plans.test.mjs`, commercial-policy backend tests | Migrated |
| Draft validate/publish/clone/stop sales | Legacy commercial editor | Existing APIs from plans page | Plan/API JS tests and commercial-policy tests | Migrated |
| Payment review/reconcile/refund | Legacy recent-order controls | Payment directory/detail/actions | Billing backend/JS tests | Migrated |
| Invoice direct navigation | No dedicated route contract | `/admin/invoices/{id}` with reload and browser-history support | Router, operations and admin browser tests | Newly added and verified |
| Legal catalog | Legacy overview card | Dedicated `/admin/legal` route | `admin_platform_legal.test.mjs` and legal versioning tests | Migrated |
| Loading/empty/error/retry behavior | Per-view legacy behavior | Shared states and latest-request cancellation | State, directory, analytics and operations JS tests | Migrated and standardized |
| Drawer keyboard behavior | Inconsistent legacy modals | Focus trap, Escape close and trigger-focus restoration | Admin accessibility/browser tests | Standardized and verified |
| Settings/environment separation | Feature state appeared in both views | Settings owns editable flags; Environment owns runtime/deployment metadata and secrets | Operations JS and admin browser tests | De-duplicated and verified |
| Legacy production entry points | Four workspace routes/tabs | Authorized redirects to Tabler destinations | `admin_legacy_removal.test.mjs`, `test_admin_platform_shell.py` | Legacy UI removed; redirects retained for compatibility |

No legacy invoice ledger, invoice PDF download, arbitrary SQL console or admin impersonation existed. These are therefore not reported as silently migrated features.

### Migrated versus newly added matrix

| Classification | Functionality | Source / reason | Verification status |
| --- | --- | --- | --- |
| Migrated legacy | Overview, user/account administration, organization visibility/actions, usage analytics, product analytics, versioned commercial plans, payment actions and legal catalog | Replaces the four legacy platform tabs and their legacy-only view modules | Focused migration gates pass; exact implementation-SHA GitHub CI is terminal `success` |
| Newly added | Dedicated organization/user aggregate details and consistent server pagination | Required for the standalone operations console and large-data behavior | Focused directory and N+1 tests pass |
| Newly added | Subscription directory | Makes existing account/organization subscription facts directly operable without changing lifecycle policy | Focused billing tests pass |
| Newly added | Invoice-request directory/detail and deep link | Exposes the existing `billing_invoice_requests` workflow; explicitly not a fabricated invoice ledger | Focused billing plus router/browser deep-link tests pass |
| Newly added | Settings/environment controls | Provides safe allowlisted development/test feature configuration separately from runtime/deployment metadata and secrets | Focused operational, JS and browser tests pass |
| Newly added | Audit/security center | Operational visibility over existing sanitized audit/session facts | Focused security tests pass |
| Newly added | Health/database/storage/backup/version pages | Replaces hard-coded labels with sanitized live status where measurable | Focused operational tests pass |
| Newly added | Jobs/sync views and guarded document-job retry | Uses existing job and WebSocket event models; no outbox or document-content mutation | Focused system tests pass |
| Quality gates | Large-data and frontend budgets | Enforces fixed query counts, bounded response sizes, asset/request budgets and maximum dashboard load | Exact-HEAD benchmark and frontend-budget gates pass |
| Intentionally not added | Impersonation, arbitrary SQL, destructive entity deletion, fake invoice document, unsupported subscription mutation | Explicitly prohibited or unsupported by current authoritative services | Absence/security contracts covered by source review and focused tests |

## 6. Security Model

- Admin auth: `/admin` and all dedicated platform APIs require the existing server-side `super_admin` role. Ordinary organization users cannot use organization scope as a substitute.
- Secrets: only configured/missing, source and restart metadata are returned. Secret values are never prefilled, read back, placed in browser persistence, audit metadata or normal responses.
- Mutations: supported dangerous actions require contextual explicit confirmation. Secret replacement and document-job retry require identifier confirmation, CSRF, privileged reauthentication and server-side authority recheck; billing actions retain their existing idempotency/step-up contracts.
- Audit: important existing mutations keep the repository’s audit contracts; configuration audit records state transition and key, never value. Required audit failure rolls back local secret replacement.
- SQL: filter and search values are bound; sort columns and filters map through server allowlists. No arbitrary SQL endpoint exists.
- XSS: record content is escaped at rendering seams; raw audit metadata and unrecognized fields are not rendered; existing Trusted Types/CSP seams are retained.
- Sessions: same-origin credentials are used; 401 aborts privileged calls and redirects once through the existing login flow.
- Business contract: no masking, record-visibility, entitlement or tenant/assignment/record-scope semantics were changed by this UI migration.

## 7. Environment Model

| Class | UI behavior | Write model |
| --- | --- | --- |
| Runtime-safe configuration | Allowlisted values/status only | Only schema-declared options; server validation |
| Runtime feature flags | Current state and description | Development/test only; explicit confirmation and restart-required result |
| Secrets | Key plus configured/missing/source/restart state | Replacement only in development/test; exact-key confirmation; value never returned |
| Deployment-managed environment | Sanitized read-only status | Production/staging reject writes and direct operators to deployment tooling |

There is no raw environment-dump API and the client cannot submit arbitrary keys. Local replacement is serialized and atomic, with restoration when required audit persistence fails.

## 8. Backend/API Changes

| Route | Permission | Service | Authoritative tables/source |
| --- | --- | --- | --- |
| `GET /api/admin/overview` | `super_admin` | `AdminOverviewService` / repository | Accounts, organizations, subscriptions, orders, transactions and mixed organization/payment/audit activity facts |
| `GET /api/admin/users[/{id}]` | `super_admin` | `platform_directory_routes.py` | Accounts, memberships, organizations, subscriptions, sessions, usage, audit |
| `GET /api/admin/organizations[/{id}]` | `super_admin` | `platform_directory_routes.py` | Organizations, memberships, accounts, subscriptions, sessions, usage, audit |
| `GET /api/admin/subscriptions` | `super_admin` | `platform_billing_routes.py` | Account and organization subscriptions plus owners |
| `GET /api/admin/payments` | `super_admin` | `platform_billing_routes.py` | Orders, payment transactions, providers and owners |
| `GET /api/admin/invoices[/{id}]` | `super_admin` | `platform_billing_routes.py` | Invoice requests joined to orders, verified transactions, providers and owners |
| `GET /api/admin/audit` | `super_admin` | `security_routes.py` | `audit_log` |
| `GET /api/admin/security/summary` | `super_admin` | `security_routes.py` | Sanitized aggregate over `audit_log` |
| `GET /api/admin/security/sessions` | `super_admin` | `security_routes.py` | Sessions joined to accounts |
| `GET /api/admin/system/jobs[/{id}]` | `super_admin` | `platform_system_routes.py` | `document_jobs` |
| `POST /api/admin/system/jobs/{id}/retry` | `super_admin` + CSRF + step-up + transactional recheck | `platform_system_routes.py` and existing job policy | `document_jobs`, audit |
| `GET /api/admin/system/sync` | `super_admin` | `platform_system_routes.py` | `websocket_events` |
| `GET /api/admin/health` | `super_admin` | `operational.py` and observability metrics | Sanitized live probes plus process, API/DB latency, response/error, worker and queue aggregates |
| `GET/POST /api/admin/environment` | `super_admin`; POST also CSRF + step-up + transactional recheck | `operational.py` | Server allowlist/deployment config and audit |
| `GET /api/admin/system/version` | `super_admin` | `operational.py` | Sanitized build/schema metadata |
| `GET /api/admin/usage-analytics/summary` | `super_admin` | `usage_analytics/routes.py` / service | Aggregated usage facts |
| `GET/POST /api/admin/product-analytics/{dashboard,refresh}` | `super_admin`; refresh retains mutation guards | `product_analytics/routes.py` / service | Aggregated product, commercial and operational analytics facts |
| `GET /api/commercial/admin/overview`; draft/release mutations | Existing platform-commercial admin authority; mutations retain CSRF/audit contracts | `commercial_policy/routes.py` / service | Versioned commercial drafts, releases, SKUs, prices and benefits |
| `POST /api/billing/admin/orders/{id}/{review,reconcile,refund}` | `super_admin` plus each existing billing mutation's step-up/idempotency/audit contract | `billing/routes.py` / service | Orders, transactions, provider state and audit |
| `GET/POST /api/legal-versioning/*` used by the catalog | Existing legal platform authority; mutations retain CSRF/audit contracts | `legal_versioning/routes.py` / service | Immutable instruments, drafts, profiles, sources and bindings |
| Existing account/organization mutation routes invoked from admin details | Their existing server-side platform/record authorization; no client-only grant | Auth and organization route services | Accounts, memberships, organizations, subscriptions and audit |

The standalone admin read APIs are new focused seams; existing commercial, billing, analytics, legal and account/organization mutation routes are reused rather than duplicated. The route-to-table inventory is also maintained in `docs/admin-dashboard-architecture.md`.

## 9. Database Changes

No schema migration was required specifically for the Tabler UI replacement. The console reads existing normalized operational, commercial, billing, subscription, audit, session, document-job and aggregate analytics tables. It does not create an invoice ledger merely to satisfy presentation requirements.

The invoice page’s resource is the existing `billing_invoice_requests` table. Any future accounting invoice/document model would require an independently approved business contract, additive migration and dedicated regression coverage.

## 10. Tests

The exhaustive migration verification below began on `d8fd08cb`; those rows are retained as historical evidence. On final production-source SHA `98ad2688`, the focused Platform Admin JavaScript/Python suites, `check:static`, `build:secure`, the three-browser Admin matrix and both Platform Admin budgets were rerun successfully. GitHub Full CI, CodeQL, N+1 and Supply-chain workflows all completed successfully on that exact SHA.

| Exact command | Exit / result |
| --- | --- |
| `npm run check:static` | Exit 0 |
| `npm run build:secure` | Exit 0 |
| `python -m pytest -q --cov=backend --cov-branch --cov-report=term --cov-report=json:coverage.json --cov-fail-under=45` | Exit 0; 2281 passed, 1 skipped; backend coverage 64.34% |
| `python scripts/check_critical_coverage.py coverage.json` | Exit 0; all 16 critical modules passed |
| `npm run test:js:coverage` | Exit 0; lines 54.45%, branches 65.91%, functions 68.46%; all 14 critical modules passed |
| Current-SHA focused Python Admin suite | Exit 0; `81 passed` |
| Current-SHA focused JavaScript Admin suite | Exit 0; `110 passed` |
| Current-SHA admin browser matrix | Exit 0; `48 passed` across Chromium, Firefox and WebKit |
| Current-SHA frontend budget | Exit 0; admin JS 373,031 bytes, CSS 540,077 bytes, 8 initial requests, 1,379.1 ms maximum |
| Current-SHA PostgreSQL Admin benchmark | Exit 0; fixed query budgets passed for 10k users, 1k organizations, 25k invoice requests and 50k audit rows |
| `npx playwright test e2e/specs/admin-shell.spec.mjs --config=playwright.config.mjs` | Exit 0; Chromium 16/16, Firefox 16/16, WebKit 16/16 |
| `npm run test:e2e:smoke` through the isolated audit runner | Exit 0; 97 passed, 5 conditionally skipped across Chromium, Firefox and WebKit |
| `npm run test:ui-quality-e2e` | Exit 0; 5/5 viewports passed overflow, accessible-name, keyboard, validation and network-state checks |
| `python -m pytest -q -m browser_e2e tests/test_product_analytics_e2e.py` | Exit 0; 1 passed |
| `npm run test:lifecycle` through the isolated audit runner with Google auth disabled as in CI | Exit 0; full lifecycle completed through historical-plan-package-frozen with no HTTP/console/page error |
| `npm run test:performance` through the isolated audit runner | Exit 0; cold p95 1,015/2,100 ms, warm p95 129/450 ms, longest task 100/100 ms |
| `python scripts/benchmark_platform_admin.py` | Exit 0; 10k users, 1k organizations, 25k invoice requests and 50k audit rows passed fixed-query and response-size budgets |
| `npm run benchmark:platform-admin-frontend` | Exit 0; asset, initial-request and dashboard-load budgets passed |
| `python scripts/audit_fk_indexes.py` | Exit 0; 214 foreign keys, none missing a usable child index |
| `python scripts/package_production.py --check` | Exit 0; 870 files, 5,142,098 bytes; runtime smoke passed |
| `npm audit && npm audit --omit=dev && pip-audit -r requirements.txt` | Exit 0; no known vulnerabilities reported |

The existing workflow suite passed locally for auth shell/roles, bidder goods, CRUD modules, multi-assignee activity, joint venture, low-price conflict, five-run offline-sync soak and all 15 package pairs. Full lifecycle and startup performance passed in isolated CI-like runs. Exact implementation-SHA GitHub Full CI subsequently passed all eight engineering jobs, including the cross-browser and full role/workflow stages.

## 11. CI Before / After

| Check | Before | After / current evidence |
| --- | --- | --- |
| Static/quality | Historical Prompt 1 baseline had failures | Local current-SHA rerun and Full CI job both pass |
| Python and critical coverage | Historical baseline incomplete | Exhaustive local migration suite passed; exact-SHA Full CI Python coverage job passes |
| JS coverage | Historical baseline incomplete | Exhaustive local migration coverage passed; exact-SHA Full CI JS coverage job passes; current-SHA `test:js` passes 1,842/1,842 |
| Secure build / CSP / vendor | No migration-final evidence | Local current-SHA secure build and exact-SHA Full CI secure-build job pass |
| Admin E2E | Legacy workspace UI | Migration evidence: 48/48 across Chromium, Firefox and WebKit plus five responsive viewports; exact-SHA cross-browser matrix passes |
| Existing workflow E2E | Historical failures | Exact-SHA Full CI role/workflow stage passes |
| N+1 / large data | No dedicated Tabler evidence | Exact-SHA N+1 workflow passes; current-SHA large-data benchmark passes fixed query counts and 256,000-byte response cap |
| DB/FK/schema | No migration-specific change | Exact-SHA PostgreSQL schema/FK job passes |
| Dependency/security | No Tabler-final evidence | Exact-SHA package/dependency, Supply-chain and CodeQL workflows pass |
| GitHub exact-final-source-SHA | Historical implementation checkpoints | Full CI `34610312708`, CodeQL `34610312684`, N+1 `34610312703` and Supply-chain `34610312701` all succeeded on `98ad2688` |
| Production legal release | Blocked | Still blocked by 27 external facts; correctly not bypassed |

## 12. Performance

- Bundle: pinned Tabler CSS is included through the secure build; unused Tabler demo JavaScript was removed from the entry graph in `ec3d17fe`.
- Overview: a bounded aggregate endpoint avoids serial page startup calls.
- Queries: directory, billing, audit, jobs and sync screens use server-side pagination, bounded page size, allowlisted filters/sorts and stable ordering.
- N+1: list/detail regressions assert constant query counts; focused backend tests passed in the current audit.
- Large data on `dcb788b5`: the isolated PostgreSQL benchmark passed with 100 rows/page and a 256,000-byte response cap. Users (10,000) used 3 queries, median 23.82 ms, max 28.67 ms, max 45,843 bytes; organizations (1,000) used 3 queries, median 14.86 ms, max 44.65 ms, max 33,873 bytes; invoice requests (25,000) used 2 queries, median 144.28 ms, max 203.41 ms, max 67,891 bytes; audit rows (50,000) used 2 queries, median 9.27 ms, max 11.66 ms, max 28,867 bytes.
- Frontend budget on `dcb788b5`: admin JavaScript 381,180/425,000 bytes, admin CSS 538,298/575,000 bytes, 10/12 initial requests and 626.2/1,500 ms maximum dashboard load; all limits passed.
- Startup: the isolated 30-run gate passed with cold p95 1,015/2,100 ms, warm p95 129/450 ms and longest task 100/100 ms; no runtime failures were recorded.
- Request races: shared directory, system, invoice and detail loaders abort stale requests so older responses cannot overwrite newer results.
- Limitation: no numeric pre-migration performance capture was available, so this report does not invent a before/after delta.

## 13. Legacy Removal

Commit `fb450f14` removed the legacy-only presentation layer, including:

- `views/tabs/tab_superadmin.html`
- `views/tabs/tab_superadmin_dashboard.html`
- `views/tabs/tab_usage_analytics.html`
- `views/tabs/tab_commercial_admin.html`
- `frontend/admin/ProductAnalyticsView.js`
- `frontend/admin/UsageAnalyticsView.js` and its CSS
- `frontend/commercial-policy/CommercialControlCenter.js` and related editor/CSS

The generic organization/account controller remains because it serves workspace business workflows and existing authoritative mutations; it is not a second platform dashboard. The four legacy URLs are server-authorized 307 compatibility redirects to new pages, not hidden legacy shells. `admin_legacy_removal.test.mjs`, route tests and frontend reachability/static checks provide the corresponding guardrails.

## 14. Remaining Risks

1. Final production UI/CI implementation is `98ad2688`; exact-SHA remote CI is successful. Older historical measurements remain labeled with their original SHA.
2. The repository has an invoice-request workflow, not an authoritative accounting invoice ledger or invoice-document store. Totals such as open/overdue and downloadable invoice documents therefore remain unavailable by design, not fabricated.
3. The current schema has only `super_admin` and `user`; finer platform roles require separate product authorization design and approval.
4. No reproducible numeric pre-migration performance capture exists, so only current bounded performance evidence is claimed.
5. Production publication remains blocked by 27 external legal facts; engineering completion cannot approve them.

## 15. Recommended Next Steps

1. Retain the exact implementation-SHA GitHub run links and current-SHA benchmark outputs as release evidence.
2. Re-run the full matrix after any later production-source change; do not extend historical benchmark measurements to changed production code.
3. If product requires fiscal invoice documents rather than invoice requests, approve an invoice-domain contract before designing schema, provider workflow or mutation UI.
4. Decide whether finer platform roles are commercially required; do not alias organization roles into platform authority.
5. Resolve the 27 external legal facts independently before any production-public release.
