# BiddingFlow procurement import workflow boundary — 2026-08-15

## Baseline

- Repository: `https://github.com/newstar94/Bidding`
- Branch: `main`
- HEAD before: `a6daeb115a2b56d6d2d90f7662c6214888eac7b8`
- `origin/main` after `git fetch --prune`: `a6daeb115a2b56d6d2d90f7662c6214888eac7b8`
- HEAD after: `a6daeb115a2b56d6d2d90f7662c6214888eac7b8` (implementation remains in the working tree; no commit was requested)
- Existing dirty-worktree changes were preserved; no reset or checkout was used.

## Root cause

The import path used one lifecycle value for two different meanings:

1. the lifecycle observed at Mua Sắm Công; and
2. the workflow stage that Bidding had actually materialized.

`derive_import_lifecycle_status()` correctly recognized opening/evaluation/result evidence, but the plan reconciler, notice reconciler, draft mapper, frontend materializers and PostgreSQL repository could use that observed value directly as the local package status. The repository also projected opening timestamps into `goi_thau`, while linked-plan enrichment fetched only invitation detail and discarded the true downstream source status by replacing it with `PUBLISHED`.

## Business contract implemented

Mua Sắm Công supplies evidence; Bidding controls workflow.

- `derive_import_lifecycle_status()` retains source truth such as `OPENED`, `EVALUATING`, `AWARDED` and `CANCELLED`.
- `project_source_lifecycle_to_bidding()` is the centralized backend local projection policy.
- New source-driven package snapshots never start beyond `INVITED`.
- Existing `INVITED` packages are not source-advanced.
- Existing `OPENED`, `EVALUATING`, `PARTIALLY_AWARDED`, `AWARDED` or `CANCELLED` workflow state is preserved during resync.
- A trusted MSC sync session may reconcile an old local `UNKNOWN` package to `INVITED`; an untrusted/manual transition remains rejected.
- No role, module permission, tenant scope, assignment scope, record scope, entitlement or field-visibility contract changed.

## Complete source retention

Exact linked TBMT enrichment now requests `COMPLETE`, deduplicated per notice number within a prepare operation. The connector keeps bounded concurrency, and `ProcurementRawSnapshotRepository` deduplicates immutable source envelopes by organization/provider/content context.

The complete canonical notice continues to contain opening bidders, lots, technical/result evidence and contracts. Package preview/effective fields receive only bounded source-owned invitation fields plus lifecycle evidence; giant raw JSON and downstream business objects are not stored in `goi_thau` or frontend package state.

True `status`, `statusForNotify`, `actualOpeningAt` and `financialActualOpeningAt` remain in source evidence. They are no longer replaced with a fabricated `PUBLISHED` observation.

## Local materialization

- Initial package draft does not expose `thoiGianMoThau` or `thoiGianMoEhsdxtc` from source opening evidence.
- PostgreSQL package insert/enrichment does not write source opening timestamps into local opening fields.
- New imported packages default to:
  - `yeuCauThamDinhHsmt = "Không"`
  - `yeuCauThamDinhHsmtCode = "NOT_REQUIRED"`
- Existing appraisal choices are inherited/preserved during resync.
- Source opening/result evidence does not create `thong_tin_mo_thau`, bidder, evaluation, award or contract business rows.

## Opening cache and workflow boundary

`prepareOpening` now follows this order:

1. validate session, organization, `goithau` edit permission, package binding and exact notice/revision;
2. load a fresh COMPLETE raw snapshot for the same organization/provider/notice/revision;
3. reuse it only when the bundle is complete and contains a canonical bidder list;
4. otherwise call `get_opening_bundle()` upstream;
5. persist the returned standardized raw evidence without sending it to the client;
6. keep preview scope, expiry, workspace lease and row-version CAS checks unchanged.

Opening import remains draft-only:

`Đang mời thầu → preview MSC → MERGE/OVERWRITE draft → user verifies → Save opening → thong_tin_mo_thau + Đang chấm thầu`.

Clicking or cancelling “Lấy dữ liệu MSC” does not mutate package status and does not persist opening rows.

## Multi-revision compatibility

The policy is applied by both plan and notice reconcilers and by all frontend materialization branches. Existing source revision axes remain unchanged: plan revision, notice revision, package revision, local version, root lineage, snapshot IDs and `isLatest` are still handled by their existing versioning paths.

## Verification

| Command | Exit | Result |
|---|---:|---|
| `python -m pytest -q tests/test_procurement_import_service.py` | 0 | 69 passed |
| `python -m pytest -q tests/test_muasamcong_integration_source.py` | 0 | 59 passed |
| `python -m pytest -q` | 0 | 1266 passed |
| Targeted procurement/opening JS tests | 0 | 72 passed |
| Targeted Ruff check for changed Python seams/tests | 0 | All checks passed |
| `npm run test:js` | 1 | 831 passed, 2 unrelated baseline failures |
| `npm run check:static` | 1 | Existing Python debt baseline mismatch: BLE001 118 vs 117; `backend/api/org_routes.py` 6 vs 5 |
| `npm run build:secure` | 0 | Secure build and verification passed |
| `git diff --check` | 0 | Passed |

The two full-JS baseline failures are outside this workflow boundary:

- `tests/js/audit_ui_boundaries.test.mjs` expects `views/css/app.css` to use cascade layers, while baseline HEAD imports unlayered stylesheets. Changing cascade semantics was explicitly outside scope.
- `tests/js/package_script_paths.test.mjs` expects a missing `docs/performance/BENCHMARKS.md` baseline artifact.

No expected value was weakened to hide either failure. The stale raw-snapshot migration assertion was corrected from schema version 61 to the actual append-only HEAD version 62.

## Remaining risks

- COMPLETE linked-notice retrieval costs more than invitation-only retrieval on a cold cache. Per-operation notice deduplication, raw snapshot TTL reuse, repository deduplication and connector concurrency bounds limit the cost; production metrics should still be watched for upstream latency/partial-rate changes.
- A partial raw snapshot is deliberately not reused for opening bidder projection. The route falls back upstream rather than fabricating bidders.
- The full JS/static gates remain red because of the three baseline debt items documented above. They should be resolved in separate UI architecture/performance documentation/debt-baseline work so this scoped change does not alter unrelated cascade or lint contracts.
- Existing stored packages are not rewritten automatically. Users must explicitly reimport/resync to apply the new local projection.

