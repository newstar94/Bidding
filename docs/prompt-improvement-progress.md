# Prompt improvement — incomplete verification ledger

This patch is not complete and is not production-ready evidence.

## Latest verification update

The current-source full Python run (session 88709) completed with `2376 passed, 1 failed, 1 skipped, 1 deselected` in 2:01:31 and total coverage `64.82%`. The critical coverage ratchet passed for all 16 modules. The sole failure was the joint-venture member round-trip; the mapper sliced a DB row object that supports integer indexing only. The minimal explicit-index fix is now applied, and the failing test plus the related joint-venture/sync regression group pass (`42 passed`). A complete full-suite rerun after this final fix remains unverified.

Post-fix full verification (session 1577) then completed with `2377 passed,
1 skipped, 1 deselected`, exit code 0, in 1:38:47. Total coverage remained
64.82%, and `scripts/check_critical_coverage.py coverage-final-postfix.json`
passed for all 16 critical modules. This closes the full Python post-fix gate.

Admin initial-load optimization moved non-overview feature modules to dynamic
imports. After a fresh secure build, the budget harness measured a 181,987-byte
JS graph and 8 initial requests. Two subsequent three-run samples passed with
maximum dashboard load of 927ms and 1179.3ms; one intervening sample reached
1854ms. The gate is improved and passed in the latest two samples, but cold-start
variance remains recorded rather than hidden.

A current organization-scope adapter matrix was then run across the active-org,
document, lot, sync, contractor-risk, export-capability, organization mutation,
and admin-directory suites: `46 passed`. Related browser/client classification,
workspace membership, asset-scope, and manager/employee read-scope tests passed
in Node: `15 passed`. This strengthens adapter and client-contract evidence but
does not replace authenticated browser E2E or production scrape/routing proof.

## Contractor violation reload regression — verified narrow fix

The uninstrumented original E2E case completed on Chromium, Firefox and WebKit:
3 passed, exit 0, 1.6 minutes (session 66953), using the isolated smoke runner
with `-Project all -Grep 'confirmed contractor and exact joint-venture'`.
Earlier matrix run: 96 passed, 5 skipped, 1 WebKit failure. That failed matrix
is not superseded by this narrow run; the full matrix must still be rerun.

Two fixes have separate evidence: unchanged member persistence retains server
verdict/check rows (four PostgreSQL tests), and reload resumes pending member
verification without overwriting existing member verdicts or blocking save.
The modal awaits that row's refresh and ignores detached rows. Navigation had
cancelled background member requests; temporary request diagnostics were removed
before the three-browser passing run. Client verdicts remain untrusted.

## Member persistence verification update

The replacement mapper now updates unchanged member identities in place.
Three PostgreSQL temporary-table regressions prove retained verdict/check rows
for unchanged identity and no verdict transfer to changed contractor/code.
However isolated WebKit session 8674 still failed the original member-color
assertion (exit 1). This fix is not sufficient for the E2E workflow. New member
lookups can be issued before member persistence; the client generates child
IDs when collecting the opening save. Assess how those new member verdicts
are authoritatively bound, rather than accepting client verdicts or attributing
the entire E2E failure to replacement of existing members.

## Rejected mapper attempt

The attempted read/delete/reinsert verdict restoration was removed after
inspection: it produced 24 values with 28 placeholders, inserted risk columns
into the contractor-master member table that does not own those columns, and
still cascaded deletion of verification history. Its untyped ID/code lookup
could also transfer a verdict when identity changes. Earlier focused green
tests did not exercise this SQL path and do not prove the attempt correct.
The mapper is back to its original implementation; the reproduced persistence
defect remains unresolved. A replacement must preserve unchanged child rows
in place and server-owned checks, and test identity changes/removal/reorder
and ordinary contractor-master writes on PostgreSQL.

## Correction to the earlier member-persistence diagnosis

Fresh schema and migration v41 already define the member violation columns.
A new migration is not justified by the observed failure. These columns are
server-authoritative (see contractor_risk/repository.py and sync/record_serializer.py).
Do not accept client verdicts to make E2E pass. The mapper deletes/reinserts
members; investigate preservation of verified server snapshots, cascade effects,
and assessment of newly created members. Earlier statements below claiming a
missing-column migration is required are superseded by this correction.

## Full Python run with configured test URLs

Session 8615 completed with exit 0: 2339 passed, 1 skipped, 1 deselected in
4312.39 seconds. Command: `python -m pytest -v -m "not browser_e2e"
--cov=backend --cov-branch --cov-report=json:coverage-configured-current.json
--cov-fail-under=45 --junitxml=pytest-configured-current.xml`.
TEST_DATABASE_URL and API_TEST_DATABASE_URL were loaded from existing local
configuration without printing credentials. Total coverage: 64.61%; running
`python scripts/check_critical_coverage.py coverage-configured-current.json`
returned exit 0 for all 16 modules. The sole skip was the symlink escape test:
Windows denied symlink creation (WinError 1314). Browser test excluded by marker.
This is a full local non-browser Python result, not remote CI or E2E evidence.
It does not prove the requested before/after critical coverage improvements.

## Evidence corrections

Audit monitor test expansion: 29 focused/snapshot tests passed; measured
line coverage 93.67%, branch coverage 84.48% using pytest-cov with branches.
The audit monitor ratchet is now 93% line / 84% branch, up from 10% / 0%.
All other critical module thresholds remain unchanged. This requires a fresh
full-suite report after test additions; the previous full report cannot pass
this newly raised audit threshold and must not be presented as current proof.

- `coverage.json` predates this patch (2026-09-11). Running the critical gate
  against it does **not** verify current-source coverage or coverage improvement.
- Interrupted Python runs without a new report and terminal exit code are
  inconclusive, not successful. Missing remote logs do not imply a transient CI bug.
- Discovery of Playwright specs is not browser execution evidence.
- YAML parsing and metric-name assertions are not PromQL lint or alert behavior tests.
- Focused authorization tests do not prove all HTTP adapters return 409:
  adapters catching `OrgPermissionError` can still map its scope-required subtype
  to a generic 403. This must be audited and resolved before completion.

## Current scope still required

### Confirmed WebKit persistence defect

The isolated WebKit repro remains failing after the frontend-only attempt.
The sync payload contains `violationStatus=VIOLATION_CONFIRMED` for the member,
but the subsequent read response returns `NOT_CHECKED`. Read-only inspection
identified the persistence seam: `_save_member_children` in
`backend/sync/mapper.py` does not insert `violation_status` (or its checked
metadata) into `thong_tin_mo_thau_lien_danh_thanh_vien`, while
`format_member_child` only projects columns that are persisted. Therefore the
member verdict is lost at write/read projection. This requires an additive
schema migration, mapper insert/update, fresh-schema contract, and regression
coverage before retrying the E2E. No frontend workaround or assertion weakening
is accepted as the fix.

### Confirmed HTTP error mapping gap

Read-only inspection confirmed that all three handlers in
`backend/lot_lifecycle_routes.py`, all four organization exception handlers in
`backend/documents/package_document_routes.py`, and the push exception boundary
in `backend/sync/service.py` catch `OrgPermissionError` and hard-code 403.
The new subtype is therefore caught before the application exception handler
can map it to `ORG_SCOPE_REQUIRED`/409. The central handler change alone does
not satisfy the HTTP acceptance requirement. Preserve rollback and the existing
403 payload for ordinary permission denial when adding subtype-specific tests
and mapping. Other adapters remain to inventory.

These eight mappings are now patched. Direct handler tests cover all three
lifecycle handlers, all four document handlers (including upload), and sync
mutation: `python -m pytest -q tests/test_document_scope_http_error.py
tests/test_lot_scope_http_error.py tests/test_sync_scope_http_error.py` completed
with 16 passed, exit 0. Tests inject each scope/permission exception at the
resolver seam and assert 409/403 and response codes. They do not replace real
PostgreSQL membership/revoke tests or prove rollback after a later transaction
failure. Existing rollback blocks remain unchanged.

The long-running coverage process started before these HTTP patches and did
not collect the new test files. Its report cannot be described as final-source
coverage, even if it terminates successfully.

After stopping that inconclusive process, a current-source focused run completed
successfully: `112 passed`, with `coverage-focused-current.json`. In the tested
scope, AI redaction is 100%, session scope 84%, sync service 17%, and WebSocket
29% (combined focused scope 30%). This is useful regression evidence only; it
is not a replacement for the repository-wide CI command or its 45% gate.

1. Complete organization HTTP/WebSocket/offline/AI scenario matrix and ADR,
   preserving existing personal-workspace and record-read contracts.
2. Finish current-source full Python coverage and record module baseline/after
   values; raise meaningful critical coverage with regression tests and ratchets.
3. Audit document storage/transaction/worker races, lifecycle concurrency,
   billing, authentication, IDOR, SQL, and database/query invariants.
4. Assess bounded refactors, frontend debt reduction and incremental types.
5. Finish operations metrics/alerts with actual PromQL validation, dependency
   and security gates, isolated E2E and final exact-source verification.
6. Deliver the requested eleven-section report with explicit limitations.

## Long-running Python investigation

The isolated migration test subsequently completed successfully:
`python -m pytest -vv -s tests/test_postgres_migration_chain.py::test_real_postgres_v1_chain_reaches_latest_catalog_and_preserves_data -o faulthandler_timeout=30`
returned exit 0, 1 passed in 189.45 seconds (session 62431). Its 30-second
faulthandler dump was diagnostic output, not a test timeout/failure. This proves
that one migration path, not the full matrix or full coverage gate.

Seven sync paging integration skips were traced to missing process-environment
`TEST_DATABASE_URL`; unlike the migration fixture, that fixture does not read
the local `.env` fallback. Rerun with the explicitly configured test URL rather
than treating those skips as successful integration coverage.

## Current continuation evidence (2026-09-12)

The Firefox row-conflict test was rerun in isolation after the prior full-matrix
failure. The first attempt stopped during cold navigation to `/tong-quan`
(20-second `page.goto` timeout), before the business flow ran. A second run of
the same test on a fresh isolated server passed: `1 passed`, Firefox, 1.3 min.
This is not evidence of a production defect or a reason to increase modal
timeouts; the startup failure remains classified as `not reproducible` for the
business step and should be monitored in a later full matrix.

The platform subscription-plan console was materially reorganized without
changing API payloads, authorization, entitlements, or serialized fields. The
page now presents a three-step workflow, separates live/scheduled/draft
release states, groups each offer editor into display, commercial limits, and
entitlement sections, and keeps advanced JSON explicitly progressive. Targeted
JavaScript tests pass (`13 passed`), ESLint passes for `AdminPlans.js`, and the
secure frontend build passes (361 modules, secure artifact verification and
route-CSS checks). Authenticated visual browser QA then completed locally with
the supplied admin account: the matrix covered 320/375/414/768/1280 px and
dashboard, package list, long-package modal and protected-media denial. No
responsive overflow, serious/critical axe violation, missing focus outline or
raw internal ID was reported; the runner exited 0. A focused `/admin/plans`
check then found and fixed a 4.41:1 table-header contrast issue; the rerun
confirmed three workflow steps, no overflow and no serious/critical axe issue.
This remains local evidence, not production deployment proof.

The mocked authenticated platform-admin budget harness was rerun twice. Both
runs failed the existing dashboard budget: `dashboardLoadMs=2817.6ms` and
`3589.9ms` against the 1500ms limit. This is a reproducible performance-gate
failure under the harness, not visual QA success; no threshold was weakened and
no production claim is made. It remains a follow-up for admin initial-load
optimization/measurement.

Prometheus rule validation is now available through a temporary standalone
Prometheus 3.14.0 Windows binary (the repository does not vendor `promtool`).
`promtool check rules deploy/monitoring/security-alerts.yml.example` reports 12
rules, and `promtool test rules deploy/monitoring/security-alerts.test.yml`
passes after adding sustained HTTP 5xx-ratio and AI-provider failure cases.
This proves syntax and the modeled alert timing/labels in the fixture; it does
not prove production metric scrape availability or alert routing.

The version-comparison HTTP adapter was audited against the explicit
organization-scope contract. Its `OrgPermissionError` catch previously mapped
the `OrgScopeRequiredError` subtype to a generic 403; it now returns
`ORG_SCOPE_REQUIRED` with status 409 while preserving ordinary permission
denial as 403. A regression test exercises that adapter seam. The combined
version-comparison and deployment-template tests pass: `39 passed, 1 skipped`.

The organization-management adapter (`backend/api/org_routes.py`) had the same
subtype shadowing in five handlers (membership lookup, add/remove member, and
document-export capability read/write). Each now preserves `ORG_SCOPE_REQUIRED`
as HTTP 409 and keeps ordinary `ORG_ACCESS_DENIED` at HTTP 403. Existing
organization-directory and security regression tests pass (`13 passed`). A
dedicated end-to-end membership ambiguity matrix across all five handlers is
still required before calling the adapter inventory complete.

The approved fixture-backed procurement-plan import E2E was enabled explicitly
with `VNEPS_PROCUREMENT_IMPORT_ENABLED=true`, provider `fixture`, and
`tests/fixtures/vneps_plan_history.json`. The draft-only-until-final-confirmation
scenario passed across all installed browsers: Chromium, Firefox, and WebKit
(`3 passed`, 2.0 min). This closes the previously skipped procurement import
scenario for the tested workflow; it does not cover every procurement provider
or every plan lifecycle path.

The conflict-resolution adapter was audited next. Its five `OrgPermissionError`
boundaries now preserve the scope-required subtype as `ORG_SCOPE_REQUIRED`/409
through the conflict error envelope, while ordinary denial remains
`ORG_ACCESS_DENIED`/403. Conflict-resolution, version-comparison, and admin
directory tests pass together: `42 passed, 1 skipped`.

The contractor-risk route now also distinguishes an ambiguous organization
scope (`ORG_SCOPE_REQUIRED`/409) from ordinary organization denial (403).
Contractor-risk route, service, and repository tests pass: `14 passed`.

The same subtype mapping was added to partner lookup, platform user-directory,
role-update, and protected-image adapters. Existing focused regression suites
for partner/admin/session behavior pass (`16 passed` across the exercised
commands). A complete route-by-route ambiguity test matrix is still pending;
these changes are source-level fixes plus adjacent regression evidence, not a
claim that every endpoint has been exercised end to end.

Static inventory then found five shared error adapters still hard-coding 403:
legal versioning, Word template catalog, procurement import, Excel document
routes, and award-result Excel/DOCX helpers. All now preserve the explicit
scope-required subtype as 409 while retaining ordinary denial as 403. Focused
document/procurement tests pass: `119 passed, 7 skipped, 1 deselected`. The
remaining static 403 occurrence in lot lifecycle is intentionally preceded by
an explicit `OrgScopeRequiredError` catch, so it is the ordinary-denial branch.

The current run uses session 71603 and outputs `coverage-final.json` only when
pytest finishes. Revalidate the handle; never infer liveness from this file.
During a read-only PostgreSQL snapshot, the test connection had no blocking
PIDs and was executing `SAVEPOINT bf_historical_schema_object`. That savepoint
comes from `_HistoricalSchemaCursor` in `backend/db/postgres_schema.py`.
Migration-chain tests repeatedly build isolated historical schemas and replay
upgrades. This locates observed work; it does not establish the reason for its
elapsed time or prove the run is healthy. Do not change published migrations
or weaken the test matrix to speed up verification.
does not replace authenticated browser E2E or production scrape/routing proof.

The complete platform-admin JavaScript suite was also run after the plans UI
changes: `110 passed` across analytics, API/security, billing, directories,
navigation, operations, plans, router, security and theme tests. This is
strong component/contract evidence; authenticated visual browser QA is now
verified locally as recorded above.
