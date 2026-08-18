# PROMPT CODEX — FIX STARTUP/SYNC WORKSPACE RACES TRÊN BIDDINGFLOW

## Repository

```text
https://github.com/newstar94/Bidding
```

HEAD đã được rà soát gần nhất:

```text
c53348953142d96e58df1f803215fab571162bef
```

Commit:

```text
feat: implement deferred startup reconciliation with authoritative mutation boundary
```

## BẮT BUỘC TRƯỚC KHI SỬA

Không được mặc định SHA trên vẫn là HEAD.

1. Checkout `main`.
2. Fetch/pull code mới nhất.
3. Ghi lại HEAD SHA và commit message.
4. Nếu HEAD khác `c533489...`, đọc diff từ commit này đến HEAD mới.
5. Chỉ sửa lỗi còn tồn tại trên HEAD thực tế.
6. Nếu một lỗi đã được sửa, ghi `ALREADY FIXED` và không patch lại.
7. Nếu không reproduce được, ghi `NOT REPRODUCED` kèm cách kiểm tra.

---

# 1. Mục tiêu

Sửa triệt để 4 lỗi/race còn lại:

1. `forceSyncData()` có thể tiếp tục sau khi workspace đổi trong lúc chờ outbox settle.
2. Scheduled startup reconciliation của workspace A có thể bắt đầu sau khi user đã chuyển sang workspace B.
3. `savePackagePreparation()` có thể gọi aggregate-version API hoặc mutate snapshot local trước authority boundary.
4. Late transport error của push workspace A có thể ghi `transportError` vào UI/telemetry của workspace B.

Sau khi sửa phải thêm regression tests thật, không chỉ source/regex tests.

---

# 2. Không được làm

Tuyệt đối không:

- quay lại blocking toàn bộ startup;
- disable offline mode;
- bỏ outbox;
- dùng `setTimeout` như correctness mechanism;
- dùng global flag đơn giản để né race;
- hạ coverage;
- skip test;
- bỏ Firefox/WebKit;
- sửa expected output chỉ để test pass;
- swallow exception;
- dùng server-wins/client-wins mù quáng.

Backend vẫn là authority cuối cho RBAC, rowVersion và workspace isolation.

---

# 3. P0 — `forceSyncData()` workspace race sau outbox settle

Đọc kỹ:

```text
frontend/app/SyncPullService.js
frontend/app/SyncWorkspaceContext.js
frontend/app/workspaceLease.js
frontend/app/BiddingModel.js
frontend/app/WorkspaceMutationOutbox*.js
```

## Root cause cần xác nhận

Flow hiện tại gần tương đương:

```javascript
const workspace = captureWorkspace(this);

const outboxFailure =
    await settleOutboxBeforeAuthoritativePull(this);

if (outboxFailure) return outboxFailure;

const storage = currentWorkspaceStorage(this);
```

Race:

```text
capture org A
→ flush outbox A đang chờ
→ user switch sang org B
→ flush hoàn tất
→ code tiếp tục
→ currentWorkspaceStorage(this) trả storage B
→ request header vẫn mang org A
```

Nếu response A trả `409 FULL_SYNC_REQUIRED`, code còn có thể xóa:

```text
bf_last_sync_version
bf_last_sync_timestamp
bf_visibility_token
```

trên storage B.

## Yêu cầu sửa

Ngay sau async boundary trước khi dùng workspace-scoped resource:

```javascript
if (!workspaceIsCurrent(this, workspace)) {
  return {
    ok: false,
    stale: true,
    superseded: true,
    workspaceChanged: true,
  };
}
```

Rà soát thêm mọi async boundary tương tự trước khi:

- lấy storage;
- đọc/xóa cursor;
- update UI;
- gửi request;
- commit cursor;
- merge snapshot.

Nếu abstraction hiện có hỗ trợ, capture workspace-scoped resources cùng snapshot:

```text
token
organizationId
storage
lease/generation
```

Không tạo abstraction dư thừa nếu `workspaceLease` đã giải quyết được.

## Regression tests bắt buộc

```text
workspace_change_during_outbox_settle_cannot_touch_new_workspace_cursor
```

Scenario:

```text
org A
→ forceSyncData()
→ flushMutationOutbox pending
→ đổi model/storage sang org B
→ resolve flush
```

Assert:

```text
fetchCalls === 0
storageB sync cursor unchanged
storageB visibility token unchanged
UI B unchanged
result.workspaceChanged/stale === true
```

Thêm variant:

```text
workspace_change_before_full_sync_reset_cannot_clear_new_workspace_cursor
```

---

# 4. P0 — Scheduled reconciliation A không được bắt đầu trên B

Đọc:

```text
frontend/app/startupReconciliation.js
frontend/app/BiddingController.js
frontend/app/WorkspaceEventBridge.js
```

## Root cause cần xác nhận

`scheduleInitialRouteReconciliation()` có capture workspace token nhưng callback được schedule vẫn có thể gọi:

```javascript
reconcileRouteDataAtStartup(controller)
```

sau khi user đã đổi workspace.

Flow cần chặn:

```text
A schedule callback
callback chưa bắt đầu
→ switch A → B
→ B initialize reconciliation
→ callback cũ của A bắt đầu
→ đọc current controller = B
→ khởi động thêm reconciliation/pull cho B
```

## Yêu cầu sửa

Scheduled callback phải validate token/generation **trước khi gọi** reconciliation.

Ví dụ:

```javascript
const workspaceToken = currentWorkspaceToken(controller);

scheduleTask(async () => {
  if (!isCurrentWorkspace(controller, workspaceToken)) {
    resolveScheduled?.({
      ok: false,
      stale: true,
      superseded: true,
    });
    return false;
  }

  return reconcileRouteDataAtStartup(controller);
});
```

Nếu phù hợp hơn, dùng:

```text
workspaceToken + startupGeneration
```

Generation cũ phải bị supersede khi:

- workspace switch;
- logout;
- model re-init;
- visibility/permission reset.

Không để stale callback thay `_startupReconciliationPromise` của workspace mới.

## Regression test

```text
scheduled_reconciliation_from_workspace_a_does_not_start_after_switch_to_workspace_b
```

Assert:

```text
autoSyncCalls == 0
forceSyncCalls == 0
startup state B unchanged
startup promise B unchanged
```

---

# 5. P0/P1 — Authority boundary phải nằm trước package version command

Đọc:

```text
frontend/packages/packagePreparation.js
frontend/shared/AggregateVersionClient.js
frontend/shared/MutationService.js
frontend/packages/detail/PreparationDetailsPanel.js
frontend/shared/VersionedEntityService.js
```

## Root cause cần xác nhận

`savePackagePreparation()` hiện có thể:

```text
determine createVersion
→ createOfficialAggregateVersion()
```

trước `persistAndSync()`.

Fallback local còn có thể:

```text
old package isLatest = 0
→ build snapshot
→ push new package
→ push children
→ stageLocalRecords()
→ cuối cùng persistAndSync()
```

Đây liên quan trực tiếp bug lịch sử:

```text
edit closing time từ package detail
→ tạo version mới
→ status/assignment bị reset
```

## Yêu cầu sửa

Authority boundary phải nằm ở đầu business command, trước khi:

- dùng stale rowVersion;
- quyết định createVersion cuối cùng;
- POST `/api/versioning/aggregate`;
- mutate `isLatest`;
- tạo local snapshot;
- stage outbox.

Ví dụ:

```javascript
await controller.awaitAuthoritativeMutationBoundary?.();
```

Sau boundary:

1. verify workspace vẫn current;
2. refresh/revalidate package authoritative;
3. recompute `createVersion`;
4. lấy rowVersion mới nhất;
5. mới gọi aggregate-version API hoặc local fallback.

Nếu sau đó gọi `persistAndSync()`, dùng:

```javascript
authoritativeBoundaryChecked: true
```

để không chờ hai lần nếu đúng contract.

Không dùng stale `pkg` cũ sau authority pull nếu record trên server đã thay đổi.

## Regression tests bắt buộc

### Test 1

```text
package_preparation_waits_for_authority_before_version_api
```

Trong lúc boundary pending:

```text
createAggregateVersionCalls == 0
old isLatest unchanged
new package absent
outbox unstaged
```

### Test 2

```text
package_preparation_recomputes_version_decision_after_authoritative_refresh
```

### Test 3

```text
package_preparation_uses_refreshed_row_version_for_aggregate_version_command
```

### Test 4 — bug lịch sử

```text
detail_edit_closing_time_preserves_status_assignment_and_owned_children
```

Assert inheritance của ít nhất:

```text
trangThai
assignments
goithauhanghoa
thongtinmothau
hanghoaduthaunhathau
evaluation metadata nếu thuộc snapshot contract
```

Không reset về:

```text
Chuẩn bị
Chưa phân công
```

---

# 6. P1 — Late transport error A không được ghi UI B

Đọc:

```text
frontend/app/SyncPushService.js
frontend/app/SyncWorkspaceContext.js
frontend/shared/releaseDiagnostics.js
```

## Root cause cần xác nhận

Success path có check workspace, nhưng `.catch()` transport failure hiện có thể trực tiếp:

```javascript
this.updateSyncState({
  phase: "transportError",
});
```

và diagnostic có thể đọc current workspace sau async completion.

Race:

```text
POST org A pending
→ switch B
→ request A network failure
→ catch()
→ UI B = transportError
→ telemetry bị gắn workspace B
```

## Yêu cầu sửa

Trong `.catch()`:

```javascript
if (!workspaceIsCurrent(this, workspace)) {
  return {
    ok: false,
    stale: true,
    workspaceChanged: true,
    error,
  };
}
```

Telemetry phải dùng workspace snapshot ban đầu, không dùng current `model.workspaceScope` sau khi request đã stale.

Không update:

- sync state;
- toast;
- badge;
- current workspace telemetry;

nếu request thuộc workspace cũ.

## Regression test

```text
late_transport_failure_from_workspace_a_cannot_update_workspace_b
```

Assert:

```text
UI patches == []
diagnostic not attributed to B
result.workspaceChanged === true
```

---

# 7. P1 — FULL_SYNC_REQUIRED / VISIBILITY_RESET

Trong lúc sửa pull, kiểm tra:

```text
409 FULL_SYNC_REQUIRED
409 SYNC_VISIBILITY_RESET_REQUIRED
```

Đảm bảo retry/full pull không:

- clear cursor sai workspace;
- làm mất actionable `transportError`;
- làm mất `conflict`;
- tạo ownership generation sai.

Nếu đã đúng, ghi:

```text
ALREADY FIXED
```

Nếu chưa, thêm test:

```text
full_sync_retry_preserves_actionable_phase_with_pending_outbox
```

---

# 8. Pull single-flight

Hiện `_workspacePullFlights` có thể đang cho nhiều pull chạy rồi supersede bằng generation.

Không bắt buộc rewrite trong task này.

Chỉ sửa nếu chứng minh correctness bug.

Nếu chỉ là performance/complexity:

```text
RISK ONLY
```

P0 correctness ưu tiên hơn refactor.

---

# 9. E2E bắt buộc

Giữ các E2E đã có:

```text
startup_does_not_commit_a_stale_record_before_authoritative_reconciliation
server_deleted_record_is_not_resurrected_from_indexeddb_startup
```

Bổ sung nếu khả thi:

```text
workspace switch while startup callback is only scheduled
workspace switch during outbox settle before pull
package closing-time edit during startup stale window
late transport failure after workspace switch
```

Phải chạy:

```text
Chromium
Firefox
WebKit
```

Không skip browser.

---

# 10. Không regression các phần đã ổn

Không làm hỏng:

```text
include-hidden-files: true
dist/.vite/manifest.json
verify_secure_build_artifact.py
secure release id
startup stale-record E2E
server-deleted-record E2E
evaluation_persistence.py extraction
technical evaluation Excel contract
MuaSamCong source contracts
workspace visibility/role reset
outbox durability
```

---

# 11. Commands bắt buộc

Dùng canonical scripts từ HEAD thực tế.

Tối thiểu:

```bash
npm ci
npm run check:static
npm run test:js:coverage
npm run build:secure
```

Python:

```bash
python -m pytest -q   --cov=backend   --cov-branch   --cov-report=term   --cov-report=json:coverage.json   --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
```

E2E:

```bash
npm run test:e2e:smoke
```

Nếu môi trường PostgreSQL đầy đủ, chạy thêm DB/package/performance gates tương ứng `.github/workflows/ci.yml`.

Không ghi PASS nếu command chưa thực sự chạy.

---

# 12. CI

Kiểm tra Full CI của HEAD cuối cùng.

Không được:

- hạ coverage;
- tăng performance budget;
- skip Firefox;
- skip WebKit;
- bỏ secure build verification;
- bỏ artifact verification;
- sửa test chỉ để hợp code.

Nếu CI đỏ do bug thật:

```text
fix implementation
```

---

# 13. Deliverable cuối cùng

Trả báo cáo Markdown:

## HEAD

```text
start SHA:
end SHA:
```

## Issue status

| Issue | Status | Root cause | Fix |
|---|---|---|---|
| pull after outbox workspace race | FIXED / ALREADY FIXED / NOT REPRODUCED | ... | ... |
| stale scheduled reconciliation | ... | ... | ... |
| package authority boundary | ... | ... | ... |
| late push transport error | ... | ... | ... |

## Files changed

| File | Change | Reason |
|---|---|---|

## Tests added

| Test | Regression protected |
|---|---|

## Commands run

```text
npm run check:static        PASS/FAIL
npm run test:js:coverage    PASS/FAIL
pytest ...                  PASS/FAIL
npm run build:secure        PASS/FAIL
npm run test:e2e:smoke      PASS/FAIL
```

## Remaining risks

Chỉ ghi risk thật.

Không bịa PASS.

---

# 14. Definition of Done

- [ ] Workspace A không thể dùng hoặc clear sync storage của B sau async boundary.
- [ ] Scheduled callback cũ của A không thể khởi động reconciliation trên B.
- [ ] Package version API không chạy trước authority boundary.
- [ ] Local package snapshot không mutate trước authority boundary.
- [ ] Package rowVersion được refresh trước aggregate version command.
- [ ] Detail edit closing time vẫn kế thừa status/assignment/children đúng.
- [ ] Late transport failure A không update UI B.
- [ ] Telemetry async dùng đúng workspace snapshot.
- [ ] `FULL_SYNC_REQUIRED` không clear cursor sai workspace.
- [ ] Existing stale startup E2E vẫn pass.
- [ ] Existing deleted-record E2E vẫn pass.
- [ ] New regression tests pass.
- [ ] JS coverage pass.
- [ ] Python coverage pass.
- [ ] Secure build pass.
- [ ] Chromium pass.
- [ ] Firefox pass.
- [ ] WebKit pass.

---

# 15. Thứ tự thực hiện

```text
1. xác định HEAD
2. reproduce từng lỗi
3. thêm failing regression test
4. fix forceSyncData workspace race
5. fix scheduled reconciliation ownership
6. fix package authority boundary
7. fix stale transport error
8. chạy targeted tests
9. chạy JS/Python/build/E2E
10. kiểm tra Full CI
11. báo cáo exact results
```

Ưu tiên:

```text
data isolation
> workspace correctness
> version correctness
> sync UX correctness
> performance/refactor
```

Không mở rộng sang refactor lớn khi các P0 trên chưa xanh.
