# BiddingFlow Platform Admin Architecture

## Boundary

The online-only platform console is rooted at `/admin`, with a dedicated HTML shell and vanilla ES-module entry. It never uses the workspace offline store. Every HTML and API request is server-authorized as platform `super_admin`; organization-manager scope is not a substitute. Existing data visibility, tenant, module, assignment, record, entitlement, session, CSRF and audit contracts remain unchanged.

The current schema exposes only the platform roles `super_admin` and `user`. This migration reuses that contract; it does not invent `billing_admin`, `support_admin`, `operations_admin`, or `read_only_admin` semantics.

## Legacy inventory and migration map

The baseline for this inventory is commit `c0d8ebfc699258c28662f7d03e7bbadd507a9305`, immediately before the isolated Tabler shell was introduced. “Current UI” below names the legacy workspace UI at that baseline. “Permission” records the existing authority reused by the replacement; it does not define new role or record-visibility semantics.

| Legacy feature | Current UI | Frontend entry | API | Backend service | DB tables | Permission | New dashboard destination | Migration status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Platform overview KPIs and recent organizations | `views/tabs/tab_superadmin_dashboard.html` | Workspace dashboard/controller wiring | `/api/admin/overview` (new aggregate over existing facts) | `backend/admin/service.py`, `backend/admin/repository.py` | `tai_khoan`, `to_chuc`, `thanh_vien_to_chuc`, `account_subscriptions`, `organization_subscriptions`, `billing_orders`, `payment_transactions` | Server session + `super_admin` | `/admin` → `AdminOverview.js` | Migrated; authoritative values, explicit unavailable states, activity and alerts |
| Platform user directory and account administration | `views/tabs/tab_superadmin.html` and shared account modal | `frontend/admin/AdminUserController.js`, legacy system-user view | Reads: `/api/auth/users`; writes: `/api/auth/users/*`, `/api/organizations/*` | Existing auth/organization services; bounded reads in `backend/admin/platform_directory_routes.py` | `tai_khoan`, `thanh_vien_to_chuc`, `to_chuc`, subscription, session, usage and audit tables | Existing server-side `super_admin`; sensitive writes retain CSRF, reauthentication and transactional checks | `/admin/users` → `AdminDirectories.js` | Migrated; paginated list, detail drawer, supported existing actions and explicit confirmation |
| Organization overview and lifecycle actions | `views/tabs/tab_superadmin_dashboard.html` plus shared account modal | Legacy workspace admin controller/view | Existing `/api/organizations/*`; new bounded reads `/api/admin/organizations[/{id}]` | Existing organization commands; `backend/admin/platform_directory_routes.py` for reads | `to_chuc`, `thanh_vien_to_chuc`, `tai_khoan`, subscriptions, sessions, usage, `audit_log` | Existing server-side `super_admin`; no new access to bidding-domain records | `/admin/organizations` → `AdminDirectories.js` | Migrated; search/filter/sort/page, details and supported lifecycle commands |
| Usage analytics | `views/tabs/tab_usage_analytics.html` | `frontend/admin/UsageAnalyticsView.js` | `/api/admin/usage-analytics/summary` | `backend/usage_analytics/service.py` | `product_usage_hourly`, `nhat_ky_thuc_hien` | Server-side `super_admin` | `/admin/analytics` → `AdminAnalytics.js` | Migrated; bounded date filters, responsive charts and text/table fallbacks |
| Product/commercial analytics | Commercial panel inside `tab_usage_analytics.html` | `frontend/admin/ProductAnalyticsView.js` | `/api/admin/product-analytics/dashboard` | `backend/product_analytics/query_service.py` | Existing aggregate tables including `workspace_usage_daily`, `subscription_snapshot_daily`, `revenue_daily`, `cost_usage_daily`, funnel/retention/feature aggregates | Server-side `super_admin` | `/admin/analytics` → `AdminAnalytics.js` | Migrated; supported views/filters preserved, absent/suppressed facts are not invented |
| Versioned plans, offers, policies and credit packs | `views/tabs/tab_commercial_admin.html` | `frontend/commercial-policy/CommercialControlCenter.js`, `CommercialOfferEditor.js` | `/api/commercial/admin/overview`, `/api/public/commercial/offers`, `/api/commercial/drafts/*`, `/api/commercial/releases/*` | `backend/commercial_policy/routes.py`, service and repository | `commercial_drafts`, `commercial_releases`, `commercial_release_timeline`, `billing_plan_versions`, `billing_prices`, `billing_skus` and related catalog tables | Existing server-side `super_admin`; mutations retain revision/validation/audit rules | `/admin/plans` → `AdminPlans.js` | Migrated; real catalog plus structured versioned-draft editing, validation, publish/clone/stop-sales workflows |
| Payment/order operations | Order panel in `tab_commercial_admin.html` | `CommercialControlCenter.js` | `/api/billing/admin/orders/{id}/{review,reconcile,refund}`; new bounded list `/api/admin/payments` | `backend/billing/routes.py`, `backend/billing/service.py`, `backend/admin/platform_billing_routes.py` | `billing_orders`, `payment_transactions`, `payment_provider_profiles`, provider-command/refund tables | Existing server-side `super_admin`; mutation confirmation, CSRF, idempotency and privileged reauthentication | `/admin/payments` → `AdminBilling.js` | Migrated; server-authoritative minor-unit amounts and transaction history |
| Subscription visibility | Embedded in legacy user/organization and commercial screens | Legacy account/commercial views | New bounded read `/api/admin/subscriptions` over existing subscription facts | `backend/admin/platform_billing_routes.py` | `account_subscriptions`, `organization_subscriptions`, `tai_khoan`, `to_chuc` | Server-side `super_admin` | `/admin/subscriptions` → `AdminBilling.js` | Migrated and expanded; no unsupported lifecycle mutations were invented |
| Legal source catalog | Legal card in `tab_superadmin_dashboard.html` | `frontend/legal-versioning/LegalCatalogAdmin.js` | Existing `/api/legal-versioning/*` | `backend/legal_versioning/routes.py`, service and repository | `legal_instrument*`, `legal_source_profile*`, applicability/binding tables | Existing read rules; catalog writes require `super_admin` | `/admin/legal` → `AdminLegalCatalog.js` | Migrated by mounting the approved immutable/versioned workflow |
| Legacy hard-coded operational labels | Status cards in `tab_superadmin_dashboard.html` | Static legacy markup | New `/api/admin/health`, `/api/admin/environment`, `/api/admin/system/version` | `backend/admin/operational.py` | Live DB/config/process probes; schema migration metadata | Server-side `super_admin` | `/admin/health`, `/admin/environment`, `/admin/settings`, `/admin/system/version` | Replaced with sanitized authoritative status and guarded configuration controls |

## New platform operations inventory

These functions did not have a complete legacy UI. They are newly added platform-operations capabilities, not disguised parity claims.

| Page / capability | Frontend module | API | Backend service | DB tables / source | Permission |
| --- | --- | --- | --- | --- | --- |
| Bounded user and organization detail drawers | `AdminDirectories.js`, shared `AdminDirectory.js` | `/api/admin/users[/{id}]`, `/api/admin/organizations[/{id}]` | `backend/admin/platform_directory_routes.py` | `tai_khoan`, `to_chuc`, `thanh_vien_to_chuc`, subscriptions, `auth_sessions`, `product_usage_hourly`, `audit_log` | `super_admin` on every request |
| Invoice-request operations | `AdminBilling.js` | `/api/admin/invoices[/{invoice_request_id}]` | `backend/admin/platform_billing_routes.py` | `billing_invoice_requests`, `billing_orders`, `payment_transactions`, `payment_provider_profiles`, owner tables | `super_admin`, read-only |
| Audit and security center | `AdminSecurity.js` | `/api/admin/audit`, `/api/admin/security/summary`, `/api/admin/security/sessions` | `backend/admin/security_routes.py` | `audit_log`, `auth_sessions`, `tai_khoan` | `super_admin`, read-only and sanitized |
| Document jobs and guarded retry | `AdminSystem.js` | `/api/admin/system/jobs[/{id}]`, `/api/admin/system/jobs/{id}/retry` | `backend/admin/platform_system_routes.py` plus existing document-job policy | `document_jobs`, immutable mutation audit | `super_admin`; retry also requires CSRF, privileged reauthentication, transactional authority recheck and eligibility |
| Sync/WebSocket operations | `AdminSystem.js` | `/api/admin/system/sync` | `backend/admin/platform_system_routes.py` | `websocket_events` | `super_admin`, read-only |
| Runtime feature settings and secret status/replacement | `AdminOperations.js` | `GET/POST /api/admin/environment` | `backend/admin/operational.py` | Server allowlist, process environment/local deployment file, `audit_log` | `super_admin`; writes additionally require CSRF, recent privileged reauthentication and transactional authority recheck |
| Health, DB, storage, backup, build and schema status | `AdminOperations.js` | `/api/admin/health`, `/api/admin/system/version` | `backend/admin/operational.py` | Sanitized live probes and build metadata | `super_admin`, read-only |

## Invoice-request boundary

`/admin/invoices` is operational and real, but its authoritative resource is `billing_invoice_requests`, not an accounting invoice ledger or a generated invoice document. It shows a request tied to an existing billing order and verified payment transaction, with provider reference, status (`requested`, `issued`, or `failed`), attempt count and timeline. The server response labels the resource `invoice_request` and reports `documentAvailable: false` because no authoritative invoice-document model exists.

Consequently, the console does not invent invoice numbers, tax/fee line items, due/overdue/refund totals or a downloadable invoice. Those fields remain explicitly unavailable until the product approves and implements an authoritative invoice model. This is the required honest equivalent for the repository’s current billing model, while the supported request-management workflow remains usable and tested.

## Migration and legacy-route rule

The Tabler console is the only active platform-admin UI. The four old bookmarks are retained solely as server-authorized compatibility redirects:

| Legacy URL | Destination | Rationale |
| --- | --- | --- |
| `/tong-quan-admin` | `/admin` | Preserve saved platform-overview bookmarks without keeping legacy HTML reachable |
| `/phan-tich-su-dung` | `/admin/analytics` | Preserve analytics deep entry |
| `/quan-ly-tai-khoan` | `/admin/users` | Preserve account-management deep entry |
| `/thuong-mai-thanh-toan` | `/admin/plans` | Preserve commercial-control deep entry |

The redirect handler authenticates and authorizes the platform role before redirecting. Legacy workspace tabs, templates and legacy-only analytics/commercial view modules were removed in commit `fb450f14`; replacement and reachability tests prevent them from returning as active production entry points. Reusable organization/account business commands remain because the new console still delegates to those authoritative services.

## Frontend structure

`views/admin/index.html` provides the isolated document. `frontend/admin-platform/AdminEntry.js` is the Vite entry and loads the pinned Tabler stylesheet plus `admin.css`; `AdminApp.js` owns the shell, navigation, route cancellation and session-expiry behavior. `AdminRouter.js` recognizes only the 17 declared routes and preserves deep links/back-forward state. Feature modules are split into overview, analytics, directories, plans, billing, operations, security, jobs/sync and legal catalog; shared API, data-table, state and icon modules centralize common behavior.

The frontend calls only allowlisted same-origin platform endpoints with session credentials. It does not attach workspace organization headers, replicate platform data to the offline store, or perform authoritative billing calculations.

## Asset and license

The console bundles pinned `@tabler/core` 1.4.0 through Vite. Runtime assets are same-origin and content-hashed. Tabler is MIT licensed; dependency metadata is retained in the lockfile and generated SBOM. The console ships Tabler CSS but omits the unused demo JavaScript bundle.

## API boundary

Platform list APIs use fixed maximum page sizes, request-field allowlists, bound query parameters, stable secondary sorting and `private, no-store` responses. Browser requests use same-origin session credentials and never attach workspace organization headers. The server remains authoritative for the platform role on every request; sensitive writes additionally recheck authority inside their database transaction.

No admin payload contains raw secret values, database URLs, filesystem paths, session tokens, device fingerprints, privileged reauthentication state or raw audit metadata. Unknown fields are not rendered. User-provided names and metadata are escaped before reaching Trusted Types-approved HTML seams.

## Configuration and secret management

`GET /api/admin/environment` exposes only allowlisted runtime values, feature states, and secret presence/source metadata. Development and test deployments may update the four existing feature flags or replace an allowlisted secret through `POST /api/admin/environment`. Production and staging remain deployment-managed and read-only.

Every write requires the existing Super Admin network boundary, recent privileged reauthentication, CSRF validation, and a transactional authority recheck. The local `.env` replacement is serialized and atomic; a failed required audit write restores the prior file. Audit metadata contains only key names, configured/enabled state transitions, and restart status. Raw secret values are never returned, read back into the form, stored in browser persistence, logged, or written to audit metadata. The UI reports server persistence separately from activation and always marks these changes as requiring an application restart.

## Performance and large-data evidence

The overview is a bounded aggregate endpoint. List screens perform server pagination, allowlisted filtering/sorting and latest-request-wins cancellation. Detail drawers use dedicated aggregate endpoints rather than one request per row. Python N+1 regression tests assert fixed query counts for the relevant list/detail paths.

`python scripts/benchmark_platform_admin.py` uses only `TEST_DATABASE_URL` (including the local `.env` value) and deliberately refuses to fall back to `DATABASE_URL`. It creates transaction-local temporary PostgreSQL tables, seeds 10,000 users, 1,000 organizations, 50,000 audit rows, and 25,000 authoritative invoice-request rows with their order and payment facts, calls the production Platform Admin list handlers, then rolls back in all outcomes.

The executable contract requires page size 100, response bodies no larger than 256 KB, and fixed query counts of three for users, three for organizations, two for audit, and two for invoice requests. Timings are reported as environment evidence but are not disguised as a portable latency guarantee. The invoice fixture models only the existing invoice-request resource described above; it does not invent accounting invoices or documents.

`npm run benchmark:platform-admin-frontend` measures the secure manifest's reachable admin JavaScript and CSS bytes, actual initial browser requests, and navigation-to-rendered-overview time against an isolated loopback harness. The committed limits and reproducible method are documented in `docs/performance/platform-admin-budget.md`.

## Theme, responsive and accessibility policy

The console maps Tabler variables to the shared BiddingFlow blue and cool-neutral palette, keeps navy navigation, and reserves green, amber and red for semantic states. Plus Jakarta Sans remains the product font. The current application has no shared dark-mode architecture, so this migration keeps a single light theme with semantic variables that can be extended later without a second theme rewrite.

Directory and billing tables collapse into labelled rows on narrow screens; operational tables remain scroll-safe. The shell, forms, tables, filters, dialogs/offcanvas drawers and state views retain semantic labels, keyboard focus and live status regions. Analytics charts include accessible labels and tabular/text fallbacks and remain safe for empty series.
