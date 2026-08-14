# BiddingFlow — Remaining Audit Fixes (2026-08-14)

## A. Baseline

- Branch: `main`
- HEAD before: `decdc52` (`feat: Enhance SQL parameter conversion and add chunked record filtering for improved performance`)
- HEAD after: `decdc52` (no commit was created in this worktree; fixes remain as reviewed working-tree changes)
- The supplied continuation prompt was treated as the task specification. The business contract in `AGENTS.md` remained authoritative for data visibility and permissions.

## B. Findings and fixes

### A — Tombstone/deletion privacy parity

- Severity: High (record-scope metadata leakage and stale local-record risk).
- Root cause: `/api/get-all-data` selected every organization tombstone and only applied table-level filtering; delta used a different call site for deletion predicates. Assignment dependents could also be removed before the parent tombstone was read.
- Files: `backend/sync/read_service.py`, `backend/sync/delta_paging.py`, `backend/sync/visibility_scope.py`, `backend/db/postgres_schema.py`.
- Fix: both paths use `VisibilityScope.deletion_predicate()` through `scoped_deletion_branches()`. Full reads use a scoped `UNION ALL` query, respect partial payload keys, and preserve deterministic ordering. PostgreSQL delete triggers now store `to_jsonb(OLD)` in `record_snapshot_json`; deletion policy accepts current assignment evidence or historical assignment-tombstone evidence. No new permission or sensitive-field capability was introduced.
- Tests: `tests/test_sync_delta_paging.py` covers predicate parity, employee assignment scope, package-child scope, historical assignment evidence, manager/unrestricted behavior through the existing integration fixtures, and cross-scope rejection.

### B — AI streaming resource safety

- Severity: High (unbounded queue and disconnect-driven provider/thread retention).
- Root cause: provider events used an unbounded `queue.Queue`, blocking `get()`, and had no cancellation signal or producer backpressure.
- Files: `backend/ai/service.py`, `backend/ai/routes.py`.
- Fix: queue capacity is 64 events and provider workers have a process-wide hard cap of 32; producer enqueue uses timeout/backpressure and observes a `threading.Event`; consumer handles cancellation and bounded waits; provider/iterator cleanup is attempted through `cancel`/`abort`/`close` when available; SSE polling checks disconnects at 250ms and closes the async stream; `ai_active_streams` increments only when consumption starts and always decrements in `finally`.
- Provider limitation: the repository's HTTP provider adapters expose no native abort method. Cancellation stops enqueueing and closes the iterator; an in-flight blocking HTTP read can remain until the provider's configured network timeout.
- Tests: `tests/ai/test_ai_core.py` covers normal completion, provider exception forwarding, bounded cancellation, repeated disconnect worker cleanup, route disconnect cleanup, queue bound, and read-only behavior (existing AI authorization tests remain unchanged).

### C — Versioning internal-reference invariant

- Severity: High (silent graph corruption if a source relation becomes target `None`).
- Root cause: optional-looking `mapping.get(...)` calls silently detached non-null lot, opening, requirement, bidder-goods, or evaluation-round relations.
- Files: `backend/versioning/aggregate_snapshot.py` and `tests/test_aggregate_version_snapshot.py`.
- Fix: `_mapped_optional_reference()` preserves a source null but delegates every non-null reference to `_required_mapping()`. Added fail-closed codes for goods lot, opening lot, bidder-goods requirement/lot, and evaluation round. Existing required mappings for opening, criterion, parent criterion, and timeline remain intact. Historical source state is never mutated by the pure snapshot functions.
- Tests: unmapped source relations fail with the specific code; source-null relations remain null; existing transaction/graph validator tests cover rollback, immutable history, assignment inheritance, and outbox behavior.

### D — Analytics dead condition

- Severity: Medium (maintenance defect; latest semantics were obscured by an always-true condition).
- Root cause: `if "is_latest" in {"is_latest"}` was always true.
- File: `backend/analytics/aggregation_engine.py`.
- Fix: latest-only predicate is explicit in the aggregate query, matching list semantics.
- Tests: `tests/ai/test_ai_core.py` verifies packages, plans, and contracts all use `is_latest = 1` for both list and aggregate paths; existing versioned aggregation tests remain passing.

## C. Tombstone parity

`/api/get-all-data` now calls `_load_visible_deletions()`, which builds branches from `scoped_deletion_branches()`. `/api/sync/delta` builds its deletion branches from the same helper. Both therefore consume the same `VisibilityScope.deletion_predicate()` semantics for tenant, module, assignment, package-parent and personal-workspace scope. Full reads additionally filter branches to requested payload keys for partial responses.

## D. AI cancellation model

- Queue size: 64 events.
- Provider worker limit: 32 concurrent worker threads; saturation fails explicitly without spawning another thread.
- Producer: bounded timed enqueue, cancellation check before/while enqueueing, terminal sentinel attempted without unbounded blocking.
- Consumer: timed queue waits, exits if worker dies, propagates provider errors, sets cancellation in `finally`.
- Route: disconnect probe every 250ms while waiting for the next event; closes the async stream and decrements the active-stream gauge in `finally`.
- Provider abort limitation: no adapter currently implements `cancel`, `abort`, or `close`; iterator close/backpressure still prevents queued-event and consumer leaks, while a blocking provider read is bounded by its HTTP timeout.

## E. Version invariant coverage

Required remaps now cover:

- `goi_thau_hang_hoa.phanLoId`;
- `thong_tin_mo_thau.phanLoId`;
- bidder goods `thongTinMoThauId`, `goiThauHangHoaId`, `phanLoId`;
- detailed evaluation `vongDanhGiaId`, `tieuChiDanhGiaId`, and parent criterion;
- timeline `sourceEntityId`;
- package/plan target and assignment inheritance through the existing aggregate command/validator.

`keHoachId` is assigned to the target plan by construction. `rebidFromPackageId` is remapped in plan snapshots; the existing validator intentionally allows the external ancestor only for a package-only command where no target plan graph is present.

## F. Test evidence

| Command | Result | Exit |
|---|---:|---:|
| `python -m pytest -q` (with `TEST_DATABASE_URL` from `.env`) | 1201 passed, 0 failed | 0 |
| `npm run test:js` | 803 passed, 0 failed | 0 |
| `npm run check:static` | static/schema/quality/module/debt gates passed | 0 |
| `npm run build:secure` | 281 modules transformed; 52 secure bundles verified | 0 |
| `python -m pytest -q tests/test_sync_delta_paging.py` | 10 passed | 0 |
| `python -m pytest -q tests/ai/test_ai_core.py tests/test_aggregate_version_snapshot.py` | 82 passed | 0 |
| `npm run lint:security -- --no-fix` | Trusted Types and ESLint passed | 0 |
| `scripts/run_isolated_audit_e2e.ps1 -Suite auth-roles` | 14 authorization/session/workspace scenarios passed | 0 |
| `scripts/run_isolated_audit_e2e.ps1 -Suite offline` | reconnect and interrupted outbox retries passed | 0 |
| `scripts/run_isolated_audit_e2e.ps1 -Suite smoke` | Chromium, Firefox and WebKit: 3 passed | 0 |
| `git diff --check` | no content errors (only existing Windows line-ending warnings) | 0 |

No tests were removed, skipped, or weakened. The PostgreSQL integration cases run with the repository test database; when that URL is not loaded in a process, those existing tests self-skip by design.

## G. Remaining risks / intentionally deferred work

- `BiddingModel` remains a large god object.
- The global `MutationObserver` remains in the frontend.
- Provider adapters do not expose a native socket abort API; cancellation is bounded by their network timeout as documented above.
- Provider-specific live-network E2E was not run; all provider behavior was tested with bounded mocks as required, while authenticated role, offline sync and three-browser smoke E2E passed.

These are intentionally deferred because the prompt explicitly prohibits a broad frontend/model or architecture rewrite in this iteration.
