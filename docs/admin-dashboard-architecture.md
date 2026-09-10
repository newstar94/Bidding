# BiddingFlow Platform Admin Architecture

## Boundary

The online-only platform console is rooted at `/admin`, with a dedicated HTML shell and vanilla ES-module entry. It never uses the workspace offline store. Every HTML and API request is server-authorized as platform `super_admin`; organization-manager scope is not a substitute. Existing data visibility, tenant, module, assignment, record, entitlement, session, CSRF and audit contracts remain unchanged.

## Legacy inventory and migration map

| Legacy feature | Old entry | Existing API | New destination | Status |
| --- | --- | --- | --- | --- |
| Overview KPIs and organizations | `/tong-quan-admin` | `/api/auth/users`, `/api/system-packages` | `/admin` | Pending bounded aggregate API |
| User and organization administration | `/quan-ly-tai-khoan` | `/api/auth/users`, `/api/organizations/*` | `/admin/users`, `/admin/organizations` | Pending server pagination |
| Usage and product analytics | `/phan-tich-su-dung` | `/api/admin/usage-analytics/summary`, `/api/admin/product-analytics/dashboard` | `/admin/analytics` | API reusable |
| Plans, orders and payments | `/thuong-mai-thanh-toan` | `/api/commercial/admin/*`, `/api/billing/admin/*` | `/admin/plans`, `/admin/payments` | API partially reusable |
| Invoice management | None | No authoritative invoice model | `/admin/invoices` | N/A until an approved model exists |
| Settings and safe environment status | None | None | `/admin/settings`, `/admin/environment` | Pending allowlisted status API |
| Audit and security | None | Audit/session tables only | `/admin/audit`, `/admin/security` | Pending bounded APIs |
| Health, jobs, sync and version | Hard-coded overview labels | Public health and internal metrics | `/admin/health`, `/admin/system/*` | Pending sanitized APIs |

## Migration rule

Legacy pages remain reachable until real-data behavior, error states, authorization, accessibility and browser parity are covered. After parity, legacy routes become compatibility redirects and the legacy templates/modules are removed in a separate reviewed patch.

## Asset and license

The console bundles pinned `@tabler/core` 1.4.0 through Vite. Runtime assets are same-origin and content-hashed. Tabler is MIT licensed; dependency metadata is retained in the lockfile and generated SBOM.
