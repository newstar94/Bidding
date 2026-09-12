# Báo cáo rà soát và cải thiện BiddingFlow

Ngày xác minh: 2026-09-13  
Branch: `main`  
HEAD nền kiểm tra: `18ed3324495d0dcf1fda4082cc2531862474bc01`

## 1. Executive summary

Phạm vi được gom thành 9 nhóm finding chính. Có 8 finding được xác nhận và sửa:
organization-scope ambiguity, HTTP subtype mapping, AI free-text redaction,
joint-venture member persistence, contractor-verdict reload recovery, monitoring
alerts, subscription-plan administration UX, và platform-admin initial loading.
Một failure Firefox ở bước mở modal không tái hiện ở lần chạy cô lập thứ hai và
được phân loại `not reproducible`, không dùng làm lý do tăng timeout.

Full Python post-fix đạt 2377 passed, 1 skipped, 1 deselected; coverage tổng
64.82% và critical ratchet đạt 16/16 module. Secure frontend build, platform
admin tests, organization-scope matrix và Prometheus rule tests đều đạt.

Không tuyên bố production-ready: production Nginx/Prometheus scrape và alert
routing chưa thể xác minh từ máy local.

## 2. Changes

| Priority | Issue | Root cause | Files changed | Fix | Tests |
|---|---|---|---|---|---|
| P0 | Ambiguous active organization could be collapsed into ordinary denial | Scope-required subtype was shadowed by broad `OrgPermissionError` handlers | org/auth/document/sync/version/partner/risk route adapters | Preserve `ORG_SCOPE_REQUIRED`/409; ordinary denial remains 403 | 46 backend scope tests; 15 client tests; full Python |
| P0 | Joint-venture member round-trip failed and could remove server-owned verdict history | Delete/reinsert behavior plus DB-row slicing unsupported by compatibility row | `backend/sync/mapper.py` and regression tests | Retain unchanged identities in place; compare explicit row indices | 84 sync/JV tests; full Python |
| P0 | Embedded credentials/PII could survive AI free-text redaction | Redaction focused on structured keys and incomplete inline patterns | `backend/ai/redaction.py`, AI tests | Add bounded inline credential/secret patterns and boundary tests | AI focused tests; full Python |
| P1 | Contractor verdict disappeared after reload/navigation | Pending lookup was cancelled and not safely resumed | opening lookup/workflow frontend | Resume pending verification, ignore detached rows, preserve existing verdict | 3-browser narrow E2E; JS regressions |
| P1 | Security monitoring lacked sustained 5xx/AI-provider behavior tests | Alert inventory and PromQL fixtures were incomplete | monitoring rules and tests | Add alerts and promtool fixtures | 12 rules linted; promtool tests pass |
| P1 | Subscription-plan admin was dense and difficult to follow | Live/draft/publish states and form concerns were visually mixed | `AdminPlans.js`, `admin.css` | Three-step workflow, separated states, grouped fields, progressive advanced JSON; corrected table-header contrast after authenticated QA | 110 platform-admin tests; secure build; `/admin/plans` overflow pass and no serious/critical axe violations |
| P1 | Platform admin initial graph loaded route modules eagerly | Static route imports expanded initial bundle | `AdminApp.js` | Dynamic route modules with route-bound abort controller | budget PASS 811.6/905.8ms samples; reachability/security gates |
| P2 | Critical audit-monitor coverage was below reviewed target | Missing failure/availability branches | audit monitor tests and ratchet | Add meaningful branch tests; raise only its ratchet | audit monitor 93.7% line/84.5% branch |
| N/R | Firefox modal-opening failure | Cold navigation instability preceded the business step | no timeout change | Isolated rerun passed | 1 passed; classified not reproducible |

## 3. Security

- Organization isolation: explicit missing/ambiguous organization scope is 409;
  ordinary unauthorized access remains 403. Tenant, module, assignment and record
  authorization were not broadened.
- Authorization: server-side super-admin and organization membership checks remain
  authoritative. Revocation and active-scope tests are included in the full suite.
- AI: tool scope is revalidated; embedded secrets in free text are redacted.
- Secrets: no credentials were printed or added; admin APIs keep same-origin and
  CSRF/idempotency contracts.
- Billing: existing activation, amount, identity, replay and reconciliation tests
  pass in the full suite.
- Documents: record authorization is reused; Word entitlement controls export,
  not record field visibility. Worker and tenant-media tests pass.

## 4. Coverage

Same-scope baseline is `coverage-configured-current.json`; post-fix is
`coverage-final-postfix.json`.

| Critical module | Before line/branch | After line/branch |
|---|---:|---:|
| access_policy | 81.7 / 70.8 | 81.7 / 70.8 |
| sync service | 65.1 / 53.5 | 65.1 / 53.5 |
| sync restore | 67.2 / 45.7 | 67.2 / 45.7 |
| audit monitor | 27.2 / 10.3 | 93.7 / 84.5 |
| sync websocket | 33.5 / 23.7 | 33.5 / 23.7 |
| lot lifecycle routes | 74.7 / 48.5 | 74.7 / 48.5 |
| document worker | 60.9 / 33.5 | 60.9 / 33.5 |
| package document routes | 46.2 / 25.4 | 46.2 / 25.4 |
| media helper | 53.2 / 37.9 | 53.2 / 37.9 |
| conflict projection | 100 / 100 | 100 / 100 |
| delta paging | 68.8 / 52.9 | 68.8 / 52.9 |
| evaluation persistence | 93.5 / 79.2 | 93.5 / 79.2 |
| aggregate snapshot | 82.9 / 69.8 | 82.9 / 69.8 |
| versioning command | 88.9 / 73.4 | 88.9 / 73.4 |
| versioning repository | 93.5 / 76.7 | 93.5 / 76.7 |
| versioning service | 66.7 / 50.0 | 66.7 / 50.0 |

Coverage gate stayed at 45%; no threshold was reduced. Overall post-fix coverage
is 64.82%.

## 5. Refactor

The platform-admin shell now lazy-loads directories, billing, operations,
security, system, plans and legal route modules. Each load captures the route's
own abort controller so a stale promise cannot render into a newer route.
Behavior is held by 110 platform-admin tests, 0 static import cycles, 0 orphan
modules, secure build verification and frontend budget checks.

No risky backend mega-refactor was attempted. Backend fixes remain at policy,
adapter and persistence seams with regression coverage.

## 6. Database changes

No new schema migration, index or constraint was required. Inspection confirmed
that the joint-venture verdict columns already exist in fresh schema and migration
history. The fix preserves rows in place rather than altering schema or accepting
client-owned verdicts. PostgreSQL migration-chain and schema-contract tests pass
in the full suite. Rollback is source-level reversal of the mapper/adapter changes;
no data migration rollback is needed.

## 7. CI verification

| Command/scope | Result |
|---|---|
| Full Python non-browser, branch coverage | 2377 passed, 1 skipped, 1 deselected; exit 0; 1:38:47 |
| Critical coverage checker | PASS, 16 modules |
| Sync and joint venture focused matrix | 84 passed |
| Organization scope backend matrix | 46 passed |
| Organization/client scope JS matrix | 15 passed |
| Platform-admin JS suite | 110 passed |
| Procurement fixture E2E, Chromium/Firefox/WebKit | 3 passed |
| Contractor verdict narrow E2E, three browsers | 3 passed |
| Secure frontend build and artifact verification | PASS |
| Frontend module graph | 355 modules, 0 static cycles |
| Reachability audit | 354 reachable, 0 orphan, 0 unresolved |
| Frontend debt/security lint | PASS |
| Platform-admin budget latest sample | PASS; 811.6ms, 8 requests, 227154 JS bytes |
| Prometheus rule syntax/behavior | PASS; 12 rules |
| Deployment template tests | 12 passed |
| `git diff --check` | PASS |

Remote GitHub CI was not triggered and no commit/push was made.

## 8. Remaining issues

1. `verified locally`: authenticated visual QA against the supplied admin
   account completed after the local backend became responsive. The matrix
   covered viewports 320, 375, 414, 768 and 1280 px and dashboard, package list,
   long-package modal and protected-media denial. Responsive overflow checks,
   serious/critical axe checks, focus-outline checks and raw-ID checks passed;
   the runner exited 0. A focused `/admin/plans` pass additionally confirmed
   three workflow steps, no viewport overflow and no serious/critical axe
   violations after correcting table-header contrast. This is local browser
   evidence, not production proof.
2. `unverified`: production Nginx routing, Prometheus scrape availability and
   Alertmanager delivery. Nginx is not installed locally and no production
   monitoring endpoint was supplied.
3. `unverified`: remote CI status for the exact dirty working tree, because
   no commit/push was authorized.
4. Admin cold-start showed one 1854ms outlier although later samples passed below
   1500ms. Keep monitoring the gate; do not weaken the threshold.

## 9. Commit plan

No commit was created. Suggested boundaries:

1. `fix(auth): preserve explicit organization scope errors`
2. `fix(ai): redact embedded credentials in free text`
3. `fix(sync): retain joint venture verdict history`
4. `fix(opening): resume contractor verification after reload`
5. `refactor(admin): clarify plans workflow and lazy load routes`
6. `test(core): expand critical authorization and coverage gates`
7. `chore(observability): validate security alerts`
8. `docs(audit): record contracts evidence and limitations`

## 10. Evidence and limitations

Branch and HEAD were checked before final reporting. The working tree remains
dirty by design: 65 modified/untracked paths include source, tests and generated
local evidence. No reset, clean, checkout, commit or push was performed.

The single Python skip is the Windows symlink escape test; symlink creation was
denied by the OS privilege policy. Browser E2E evidence is limited to the named
scenarios and must not be generalized to every production workflow. Build success
does not prove deployed production health. Coverage reports and JUnit evidence
are local artifacts.

## 11. Business-contract verification

- Tenant isolation is preserved: no cross-tenant fallback was introduced.
- Module permission, assignment scope and record-level authorization remain
  server-authoritative.
- Role/capability/entitlement semantics were not added, removed, merged or
  repurposed.
- Authorized record readers still receive the complete record projection,
  including sensitive fields permitted by the confirmed business contract.
- Word export entitlement controls document creation/download only; it does not
  mask read APIs or UI record fields.
- Ordinary API success shapes were preserved. Only the already-approved ambiguous
  organization failure subtype is surfaced as `ORG_SCOPE_REQUIRED`/409.
- AI redaction applies to outbound AI/audit-safe payloads; it does not alter the
  authorized record-read projection.
- Production behavior outside the tested local scope remains unverified as listed
  above.
