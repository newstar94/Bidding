# BiddingFlow Platform Admin Architecture

## Boundary

The online-only platform console is rooted at `/admin`, with a dedicated HTML shell and vanilla ES-module entry. It never uses the workspace offline store. Every HTML and API request is server-authorized as platform `super_admin`; organization-manager scope is not a substitute. Existing data visibility, tenant, module, assignment, record, entitlement, session, CSRF and audit contracts remain unchanged.

## Legacy inventory and migration map

| Legacy feature | Old entry | Existing API | New destination | Status |
| --- | --- | --- | --- | --- |
| Overview KPIs and organizations | `/tong-quan-admin` | `/api/admin/overview` | `/admin` | Migrated, bounded aggregate |
| User and organization directory | `/quan-ly-tai-khoan` | `/api/admin/users`, `/api/admin/organizations` | `/admin/users`, `/admin/organizations` | Migrated, server paginated |
| User and organization mutations | `/quan-ly-tai-khoan` | `/api/auth/users/*`, `/api/organizations/*` | `/admin/users`, `/admin/organizations` | Pending interaction parity |
| Usage and product analytics | `/phan-tich-su-dung` | `/api/admin/usage-analytics/summary`, `/api/admin/product-analytics/dashboard` | `/admin/analytics` | Migrated, aggregate APIs reused |
| Plans, orders and payments | `/thuong-mai-thanh-toan` | `/api/commercial/admin/*`, `/api/admin/payments` | `/admin/plans`, `/admin/payments` | Read parity complete; mutation parity in progress |
| Invoice management | None | No authoritative invoice model | `/admin/invoices` | N/A until an approved model exists |
| Settings and safe environment status | None | `/api/admin/environment` | `/admin/settings`, `/admin/environment` | Migrated as safe deployment-managed status |
| Audit and security | None | `/api/admin/audit`, `/api/admin/security/sessions` | `/admin/audit`, `/admin/security` | Migrated, server paginated |
| Health, storage, backup and database | Hard-coded overview labels | `/api/admin/health` | `/admin/health` | Migrated, sanitized real status |
| Jobs and sync | None | `/api/admin/system/jobs`, `/api/admin/system/sync` | `/admin/system/jobs`, `/admin/system/sync` | Migrated, server paginated |
| Build and schema version | None | `/api/admin/system/version` | `/admin/system/version` | Migrated, sanitized real status |

## Migration rule

Legacy pages remain reachable until real-data behavior, error states, authorization, accessibility and browser parity are covered. After parity, legacy routes become compatibility redirects and the legacy templates/modules are removed in a separate reviewed patch.

## Asset and license

The console bundles pinned `@tabler/core` 1.4.0 through Vite. Runtime assets are same-origin and content-hashed. Tabler is MIT licensed; dependency metadata is retained in the lockfile and generated SBOM.

## API boundary

Platform list APIs use fixed page-size limits, request-field allowlists, bound query parameters, stable secondary sorting and `private, no-store` responses. Browser requests use same-origin session credentials and never attach workspace organization headers. The server remains authoritative for the platform role on every request; sensitive writes additionally recheck authority inside their database transaction.

No admin payload contains raw environment values, secret values, database URLs, filesystem paths, session tokens, device fingerprints, privileged reauthentication state or raw audit metadata. Missing domain models are returned as unavailable rather than synthesized.
