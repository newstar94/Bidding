# PROMPT CODEX — SỬA TRIỆT ĐỂ STARTUP/SYNC/WORKSPACE RACES MÀ KHÔNG PHÁT SINH REGRESSION

## Repository

```text
https://github.com/newstar94/Bidding
```

HEAD đã được rà soát gần nhất:

```text
bd5e1d29b333d09b5a07dc1e9e77d82b1a098366
```

Commit:

```text
feat-ok: add regression tests for package preparation authority boundary and version handling
```

# 0. Nguyên tắc cao nhất

Không chỉ “sửa cho test xanh”.

Ưu tiên:

```text
correctness
> workspace isolation
> data integrity
> version integrity
> offline durability
> UX correctness
> performance
> refactor
```

Mỗi lỗi phải theo chu trình:

```text
reproduce/failing test
→ implementation fix
→ targeted regression
→ neighboring regression
→ full JS/Python/build/E2E
→ code review chống regression mới
```

Không được sửa một bug bằng cách tạo bug mới ở flow khác.

---

# 1. Xác định HEAD thực tế

Trước khi sửa:

```bash
git checkout main
git fetch --all --prune
git pull --ff-only
git rev-parse HEAD
git log -1 --oneline
```

Ghi:

```text
START_HEAD=
```

Nếu HEAD khác `bd5e1d29...`:

- review diff;
- kiểm từng issue đã được sửa chưa;
- chỉ patch issue còn tồn tại;
- dùng trạng thái:
  - `ALREADY FIXED`
  - `CONFIRMED`
  - `NOT REPRODUCED`
  - `RISK ONLY`

---

# 2. Không được làm

Cấm:

- blocking toàn bộ startup;
- disable offline;
- bỏ outbox;
- bỏ deferred reconciliation;
- bỏ workspace lease;
- dùng `setTimeout`/magic delay để né race;
- global boolean đơn giản để giả synchronization;
- hạ coverage;
- skip test/browser;
- bỏ Firefox/WebKit;
- tăng performance budget;
- swallow exception;
- weaken version inheritance;
- sửa expected output chỉ để test pass;
- rewrite toàn bộ sync architecture nếu không cần.

---

# 3. Contract bắt buộc cho mọi async workspace operation

Mọi async operation phải theo:

```text
capture workspace capability
→ await async work
→ verify captured workspace still current
→ only then perform side-effects
```

Side-effects gồm:

```text
model state
IndexedDB
workspace storage
outbox
sync cursor
sync UX state
toast
render
telemetry attribution
conflict state
```

Không chấp nhận pattern:

```javascript
const workspace = captureWorkspace(...);
await something();
this.model...
```

mà không workspace-check sau `await`.

---

# 4. P0 — Harden `autoSync()` preflight

Đọc:

```text
frontend/app/SyncPushService.js
frontend/app/SyncWorkspaceContext.js
frontend/app/workspaceLease.js
frontend/app/BiddingModel.js
frontend/app/WorkspaceMutationOutbox*.js
frontend/app/SyncCoordinator.js
```

## 4.1 Outbox flush race

Cần sửa flow:

```text
A capture
→ flush outbox A pending
→ switch B
→ A flush resolve/reject
→ code hiện tại có thể đọc model B / gọi autoSync B / set storageError B
```

Sau `flushMutationOutbox()` phải check:

```javascript
if (!workspaceIsCurrent(this, workspace)) {
  return {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  };
}
```

Không được gọi `this.autoSync()`, `updateSyncState()`, hay đọc current model sau stale completion.

## 4.2 Duplicate-plan repair race

Sửa flow:

```text
repair A pending
→ switch B
→ repair A resolve
→ autoSync B bị gọi bởi A completion
```

`_syncRepairPromise` không được global cross-workspace.

Dùng owner tương đương:

```javascript
{
  workspaceToken,
  promise
}
```

B không được reuse repair promise A.

## 4.3 `_autoSyncPromise`

Rà tương tự.

Nếu push A pending:
- B không được reuse A promise;
- A completion không clear ownership của B;
- queued flag A không được tự kích hoạt push B.

---

# 5. Regression tests P0 preflight

Bắt buộc:

```text
workspace_change_during_outbox_flush_cannot_start_auto_sync_for_new_workspace
workspace_change_during_outbox_flush_failure_cannot_set_storage_error_on_new_workspace
duplicate_plan_repair_from_workspace_a_cannot_resume_sync_in_workspace_b
workspace_b_does_not_reuse_workspace_a_sync_repair_promise
workspace_b_does_not_reuse_workspace_a_auto_sync_promise
```

---

# 6. P0 — Harden `applySuccessfulPush()`

Hiện check workspace trước khi gọi handler là chưa đủ vì handler có nhiều `await`.

Truyền captured workspace vào handler:

```javascript
applySuccessfulPush(controller, {
  ...,
  workspace
})
```

Sau từng async boundary phải recheck.

Các side-effect cần bảo vệ:

```text
applyCommittedRowVersions
clearCommittedMutationBatch
orphan cleanup
persistData
dashboardSummary
currentPage
renderChangedState
toast
_syncConflict
serverSaved
```

Không dùng `currentWorkspaceStorage(controller)` cho response A; dùng captured `workspace.storage`.

Nếu stale, return:

```javascript
{
  ok: false,
  stale: true,
  workspaceChanged: true
}
```

---

# 7. P0 — Harden `applyFailedPush()`

Bảo vệ sau từng async boundary:

```text
resolveRowVersionConflicts
flushMutationOutbox
restoreRejectedRecords
fetchRecordByLookup
deleteRecord
renderChangedState
```

Response conflict/validation của A không được:

```text
set conflict B
write conflict cursor B
restore/delete records B
show toast B
set validationRejected B
set error B
```

---

# 8. Regression tests push handlers

Bắt buộc:

```text
workspace_change_during_successful_push_row_version_commit_cannot_mutate_new_workspace
workspace_change_during_successful_push_render_cannot_mark_new_workspace_server_saved
workspace_change_during_conflict_resolution_cannot_set_conflict_on_new_workspace
workspace_change_during_validation_recovery_cannot_restore_or_delete_new_workspace_records
late_success_response_from_workspace_a_cannot_clear_workspace_b_outbox
```

---

# 9. P0/P1 — Fix nốt pull outbox settle helper

Đọc:

```text
frontend/app/SyncPullService.js
```

`settleOutboxBeforeAuthoritativePull()` phải nhận workspace snapshot:

```javascript
settleOutboxBeforeAuthoritativePull(controller, workspace)
```

Sau `await flushMutationOutbox()`:

```javascript
if (!workspaceIsCurrent(controller, workspace)) {
  return {
    ok: false,
    stale: true,
    superseded: true,
    workspaceChanged: true,
  };
}
```

Chỉ sau đó mới đọc durability status.

Không được để A operation set `storageError` cho B.

Regression test:

```text
workspace_change_during_pull_outbox_flush_with_new_workspace_storage_failure_does_not_update_new_workspace
```

Scenario:

```text
A flush pending
→ switch B
→ B outbox trusted=false
→ resolve A flush
```

Assert:

```text
B sync state unchanged
B storage untouched
fetch not called
workspaceChanged == true
```

---

# 10. Audit toàn bộ async boundaries

Search trong:

```text
SyncPullService.js
SyncPushService.js
SyncCoordinator.js
startupReconciliation.js
SyncRenderCoordinator.js
BiddingController.js
BiddingControllerSync.js
MutationService.js
AggregateVersionClient.js
tableDataUtils.js
```

Search:

```text
await
.then
.catch
.finally
Promise.all
Promise.allSettled
requestAnimationFrame
requestIdleCallback
queueMicrotask
setTimeout
```

Lập bảng review:

| Boundary | Captured workspace? | Recheck after await? | Side-effect safe? |
|---|---:|---:|---:|

Chỉ patch nơi có correctness risk.

---

# 11. P1 — Offline package-version semantics

Hiện boundary có thể trả:

```javascript
{ authoritative: false, offline: true }
```

nhưng `savePackagePreparation()` vẫn có khả năng gọi aggregate-version API.

Phải làm semantics nhất quán.

Nếu app cho phép offline version edit:

```text
offline
→ không gọi authoritative version API
→ tạo durable local version
→ stage outbox
→ localPending/offline
→ reconcile đúng khi reconnect
```

Nếu version creation bắt buộc online:

```text
offline
→ reject trước mọi local mutation
→ thông báo rõ
→ không partial mutation
```

Không được:

```text
boundary says offline allowed
→ server API called
→ network error
```

Tests:

```text
offline_package_preparation_does_not_call_authoritative_version_api
```

và tùy policy:

```text
offline_package_version_is_durable_and_replayed_after_reconnect
```

hoặc:

```text
offline_package_version_fails_before_local_snapshot_mutation
```

---

# 12. P1 — Background render stale callback

Trong `SyncRenderCoordinator.js`, background `requestAnimationFrame()` phải workspace-safe.

Capture token trước schedule, check trong callback.

Test:

```text
background_render_scheduled_in_workspace_a_does_not_render_after_switch_to_b
```

---

# 13. Giữ nguyên các package-version invariants đã sửa

Không được làm hỏng:

```text
package_preparation_waits_for_authority_before_version_api
package_preparation_recomputes_version_decision_after_authoritative_refresh
package_preparation_uses_refreshed_row_version_for_aggregate_version_command
package_preparation_does_not_resurrect_a_record_removed_by_authoritative_refresh
package_preparation_does_not_snapshot_incomplete_children_after_hydration_failure
detail_edit_closing_time_preserves_status_assignment_and_owned_children
```

Business invariants:

```text
status preserved
assignment preserved
goods preserved
opening preserved
bidder goods preserved
evaluation metadata preserved/remapped
<=1 isLatest per family + plan snapshot
historical parent immutable
```

---

# 14. Không regression startup

Giữ:

```text
LOCAL_READY
RECONCILING
RECONCILED
OFFLINE_LOCAL
SYNC_ERROR
CONFLICT
```

Giữ deferred rendering:

```text
route:rendered
loader:hidden
```

không bị full sync chặn lại.

---

# 15. Không regression outbox

Giữ:

```text
durable before push
no duplicate mutation
reload retains pending mutation
conflict retains actionable state
transport failure retains actionable state
validation rejection only discards rejected scope
```

Stale workspace completion không được clear outbox.

---

# 16. Không regression FULL_SYNC / visibility reset

Giữ:

```text
FULL_SYNC_REQUIRED
SYNC_VISIBILITY_RESET_REQUIRED
```

Invariants:

```text
cursor clear đúng workspace
pending actionable phase preserved
recursive pull owns correct generation
visibility reset không purge unsynced mutations
```

---

# 17. Không regression RBAC / tenant

Giữ:

```text
tenant isolation
workspace isolation
active-role least privilege
assignment scope
record scope
manager employee view-only inheritance
```

Frontend guard không thay backend RBAC.

---

# 18. Không regression performance

Không dùng global lock toàn app.

Coordination phải workspace-scoped.

Không:

```text
serialize mọi request toàn cục
disable background sync
full sync trước render
```

---

# 19. Test-first bắt buộc

Với mỗi issue CONFIRMED:

```text
1. add failing test
2. run -> FAIL
3. fix implementation
4. rerun -> PASS
5. run neighboring tests
6. run full suite
```

Trong report ghi:

```text
BEFORE FIX: FAIL
AFTER FIX: PASS
```

---

# 20. Targeted tests

Tối thiểu:

```bash
node --test --test-concurrency=1 tests/js/sync_status.test.mjs
node --test --test-concurrency=1 tests/js/sync_pull_ordering.test.mjs
node --test --test-concurrency=1 tests/js/sync_conflict_recovery.test.mjs
node --test --test-concurrency=1 tests/js/package_preparation_authority.test.mjs
```

---

# 21. Full JS

```bash
npm run test:js:coverage
```

Không hạ coverage.

---

# 22. Python

```bash
python -m pytest -q   --cov=backend   --cov-branch   --cov-report=term   --cov-report=json:coverage.json   --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
```

---

# 23. Static/security/build

```bash
npm run check:static
npm run build:secure
```

Giữ:

```text
dist/.vite/manifest.json
include-hidden-files: true
verify_secure_build_artifact.py
secure release marker
production fail-fast
```

---

# 24. E2E

```bash
npm run test:e2e:smoke
```

Phải giữ:

```text
Chromium
Firefox
WebKit
```

Không skip browser.

---

# 25. Performance

Chạy canonical:

```bash
npm run test:performance
```

Không tăng budget.

---

# 26. Package/database gates nếu môi trường hỗ trợ

```bash
python scripts/manage_database.py
python scripts/audit_fk_indexes.py
python scripts/package_production.py --check
npm run sbom
```

---

# 27. Rà `.finally()` và recursive calls

Đặc biệt kiểm:

```text
_autoSyncPromise
_syncRepairPromise
_startupReconciliationPromise
_workspacePullFlights
_backgroundSync*
_pendingDetailRecordLoads
```

Cleanup chỉ được clear promise nếu đúng promise/owner.

Rà recursion:

```text
autoSync()
forceSyncData()
reconcileRouteDataAtStartup()
manual retry
```

Không để completion A tự gọi operation B.

---

# 28. Same-org new epoch

Bắt buộc test:

```text
org-a@1
→ workspace re-init
→ org-a@2
```

Request `@1` phải stale dù organizationId giống nhau.

Test ít nhất một push và một pull path.

---

# 29. Acceptance criteria P0

- [ ] outbox flush A không resume B;
- [ ] repair A không resume B;
- [ ] B không reuse A repair promise;
- [ ] B không reuse A push promise;
- [ ] successful push A không resume side-effects trên B;
- [ ] failed push A không resume recovery trên B;
- [ ] A không clear outbox B;
- [ ] A không ghi cursor B;
- [ ] A không set conflict B;
- [ ] A không show toast B;
- [ ] A không render B từ stale completion;
- [ ] pull settle helper không update B;
- [ ] same-org new epoch invalidates old request.

---

# 30. Acceptance criteria no-regression

- [ ] startup vẫn deferred;
- [ ] offline non-version edits vẫn hoạt động;
- [ ] outbox durability vẫn đúng;
- [ ] manual retry vẫn đúng;
- [ ] background sync vẫn đúng;
- [ ] workspace switch vẫn đúng;
- [ ] package detail/list modal vẫn đúng;
- [ ] version inheritance vẫn đúng;
- [ ] secure build vẫn đúng;
- [ ] coverage không giảm;
- [ ] performance budget không đổi;
- [ ] Chromium pass;
- [ ] Firefox pass;
- [ ] WebKit pass.

---

# 31. Không refactor lớn trong task này

Không mở rộng sang:

```text
procurement_import/routes.py
sync/mapper.py
payload_validation.py
```

trừ khi trực tiếp cần cho bug.

Task này là correctness hardening.

---

# 32. Final review chống phát sinh lỗi mới

Sau khi toàn bộ test xanh, review lại code mới và trả lời:

```text
1. Có async callback nào từ A còn chạm B không?
2. Có promise global cross-workspace không?
3. Có stale completion update UI/toast không?
4. Có stale completion clear outbox/cursor không?
5. Có stale completion render route không?
6. Có stale telemetry gắn workspace mới không?
7. Có offline path vô tình gọi server không?
8. Có version flow mất status/assignment/children không?
9. Có startup performance regression không?
10. Có test/coverage/browser nào bị weaken không?
```

Nếu 1–8 còn “có” thì chưa DONE.

---

# 33. Báo cáo cuối cùng

Trả Markdown gồm:

```text
START_HEAD:
END_HEAD:
```

Issue matrix:

| Issue | Before | Status | Fix | Test |
|---|---|---|---|---|

Status chỉ dùng:

```text
FIXED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
BLOCKED BY ENVIRONMENT
```

Files changed:

| File | Change | Reason |
|---|---|---|

Tests:

| Test | Failed before | Passed after | Invariant |
|---|---:|---:|---|

Commands:

```text
node targeted tests            PASS/FAIL
npm run test:js:coverage       PASS/FAIL
pytest                         PASS/FAIL
npm run check:static           PASS/FAIL
npm run build:secure           PASS/FAIL
npm run test:e2e:smoke         PASS/FAIL
npm run test:performance       PASS/FAIL
```

Không ghi PASS nếu chưa chạy.

---

# 34. CI cuối cùng

Kiểm tra END_HEAD.

Required jobs:

```text
quality
unit-python
unit-js
build
database
e2e
performance
package
release
```

Nếu status chưa có:

```text
CI STATUS NOT YET AVAILABLE
```

Không đoán.

---

# 35. Final instruction

Mục tiêu cuối cùng:

```text
Mọi async operation chỉ được commit side-effect
nếu workspace capability đã capture vẫn còn current.
```

Đồng thời:

```text
không làm mất offline support
không làm chậm startup
không làm hỏng package version inheritance
không làm mất outbox
không tạo regression mới
```

Chỉ coi là DONE khi:

```text
targeted tests xanh
+ full JS/Python/build/E2E xanh
+ no-regression review hoàn tất
+ exact HEAD/results được báo cáo
```
