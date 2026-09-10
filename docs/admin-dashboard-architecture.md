# BiddingFlow Platform Admin Architecture

## Boundary

The online-only platform console is rooted at `/admin`, with a dedicated HTML shell and vanilla ES-module entry. It never uses the workspace offline store. Every HTML and API request is server-authorized as platform `super_admin`; organization-manager scope is not a substitute. Existing data visibility, tenant, module, assignment, record, entitlement, session, CSRF and audit contracts remain unchanged.

## Legacy inventory and migration map

| Legacy feature | Old entry | Existing API | New destination | Status |
| --- | --- | --- | --- | --- |
| Overview KPIs and organizations | `/tong-quan-admin` | `/api/admin/overview` | `/admin` | Migrated, bounded aggregate |
| User and organization directory | `/quan-ly-tai-khoan` | `/api/admin/users`, `/api/admin/organizations` | `/admin/users`, `/admin/organizations` | Migrated, server paginated |
| User and organization mutations | `/quan-ly-tai-khoan` | `/api/auth/users/*`, `/api/organizations/*` | `/admin/users`, `/admin/organizations` | Migrated with detail drawers, confirmation and step-up reauthentication |
| Usage and product analytics | `/phan-tich-su-dung` | `/api/admin/usage-analytics/summary`, `/api/admin/product-analytics/dashboard` | `/admin/analytics` | Migrated, aggregate APIs reused |
| Plans, orders and payments | `/thuong-mai-thanh-toan` | `/api/commercial/admin/*`, `/api/admin/payments` | `/admin/plans`, `/admin/payments` | Migrated with versioned draft and payment actions |
| Invoice management | None | No authoritative invoice model | `/admin/invoices` | N/A until an approved model exists |
| Settings and safe environment configuration | None | `GET/POST /api/admin/environment` | `/admin/settings`, `/admin/environment` | Migrated; allowlisted local changes and deployment-managed read-only state |
| Audit and security | None | `/api/admin/audit`, `/api/admin/security/sessions` | `/admin/audit`, `/admin/security` | Migrated with server pagination and sanitized detail views |
| Legal source catalog | Legacy workspace admin card | Existing immutable legal catalog APIs | `/admin/legal` | Migrated by reusing the approved immutable workflow |
| Health, storage, backup and database | Hard-coded overview labels | `/api/admin/health` | `/admin/health` | Migrated, sanitized real status |
| Jobs and sync | None | `/api/admin/system/jobs`, `/api/admin/system/sync` | `/admin/system/jobs`, `/admin/system/sync` | Migrated, server paginated |
| Build and schema version | None | `/api/admin/system/version` | `/admin/system/version` | Migrated, sanitized real status |

## Migration rule

The Tabler console is the only active platform-admin UI. The four legacy URLs are server-authorized compatibility redirects into `/admin`; their workspace tabs, templates and legacy-only view modules have been removed. Replacement and removal tests keep those paths from becoming reachable again.

## Asset and license

The console bundles pinned `@tabler/core` 1.4.0 through Vite. Runtime assets are same-origin and content-hashed. Tabler is MIT licensed; dependency metadata is retained in the lockfile and generated SBOM.

## API boundary

Platform list APIs use fixed page-size limits, request-field allowlists, bound query parameters, stable secondary sorting and `private, no-store` responses. Browser requests use same-origin session credentials and never attach workspace organization headers. The server remains authoritative for the platform role on every request; sensitive writes additionally recheck authority inside their database transaction.

No admin payload contains raw environment values, secret values, database URLs, filesystem paths, session tokens, device fingerprints, privileged reauthentication state or raw audit metadata. Missing domain models are returned as unavailable rather than synthesized.

## Configuration and secret management

`GET /api/admin/environment` exposes only allowlisted runtime values, feature states, and secret presence/source metadata. Development and test deployments may update the four existing feature flags or replace an allowlisted secret through `POST /api/admin/environment`. Production and staging remain deployment-managed and read-only.

Every write requires the existing Super Admin network boundary, recent privileged reauthentication, CSRF validation, and a transactional authority recheck. The local `.env` replacement is serialized and atomic; a failed required audit write restores the prior file. Audit metadata contains only key names, configured/enabled state transitions, and restart status. Raw secret values are never returned, read back into the form, stored in browser persistence, logged, or written to audit metadata. The UI reports server persistence separately from activation and always marks these changes as requiring an application restart.

## Theme and responsive policy

The console maps Tabler variables to the shared BiddingFlow blue and cool-neutral palette, keeps navy navigation, and reserves green, amber and red for semantic states. Plus Jakarta Sans remains the product font. The current application has no shared dark-mode architecture, so this migration keeps a single light theme with semantic variables that can be extended later without a second theme rewrite. Directory tables collapse into labelled rows on narrow screens; operational tables remain scroll-safe.
