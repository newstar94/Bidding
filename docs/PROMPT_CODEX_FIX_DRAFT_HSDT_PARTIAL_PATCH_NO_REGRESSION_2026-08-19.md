# PROMPT CODEX — FIX DRAFT HSDT / PARTIAL PATCH / OFFLINE VERSION MÀ KHÔNG REGRESSION

## Repository
https://github.com/newstar94/Bidding

HEAD rà soát gần nhất:
`4627149ad71de147b36a8c4fc57376666eefec75`

Commit:
`feat: enhance workspace synchronization handling to prevent race conditions`

Commit ngay trước có thay đổi lớn về lưu nháp HSDT:
`09f5ccd49ad2aa0705ff546fd22541bc7dfaae14`

---

## 1. Mục tiêu

Sửa triệt để các lỗi/gap còn lại:

1. **P0** — `executeBidEvaluationDraftSave()` mutate state + stage outbox trước authoritative mutation boundary.
2. **P0** — partial draft patch đang có nguy cơ bị sync merge xử lý như full-record replacement, làm mất các field không dirty.
3. **P0/P1** — flow lưu hoàn thành HSDT (`mode="complete"`) vẫn mutate/stage trước authority boundary.
4. **P1** — offline package version có thể snapshot aggregate không đầy đủ nếu child cache chưa hydrate đủ.
5. **P2/P1** — delayed UI/recovery callbacks còn có thể chạy sau workspace switch.

Mục tiêu kiến trúc:

```text
authoritative boundary trước mutation
+ partial patch semantics rõ ràng
+ workspace ownership xuyên suốt async lifecycle
+ offline aggregate completeness
+ không làm hỏng các sync fixes ở 4627149
```

---

## 2. Bắt buộc xác định HEAD thực tế

Trước khi sửa:

```bash
git checkout main
git fetch --all --prune
git pull --ff-only
git rev-parse HEAD
git log -1 --oneline
```

Ghi `START_HEAD`.

Nếu HEAD khác `4627149...`:
- review diff từ `4627149...`;
- chỉ sửa issue còn tồn tại;
- đánh dấu từng issue: `CONFIRMED`, `ALREADY FIXED`, `NOT REPRODUCED`, `RISK ONLY`.

Không patch máy móc.

---

## 3. Không được làm

Tuyệt đối không:
- bỏ deferred startup;
- disable offline;
- bỏ outbox;
- bỏ workspace token/epoch guards;
- revert các hardening ở `4627149`;
- hạ coverage;
- skip test;
- bỏ Firefox/WebKit;
- tăng performance budget để pass;
- dùng magic delay;
- swallow exception;
- biến partial draft thành full-table sync;
- sửa expected test chỉ để xanh;
- rewrite toàn sync architecture nếu không cần.

Ưu tiên:

```text
data integrity
> workspace isolation
> authoritative correctness
> offline durability
> version correctness
> UX
> performance
> refactor
```

---

## 4. P0 — Fix authority ordering của Draft HSDT

Đọc kỹ:

```text
frontend/packages/BidEvaluationDraftWorkflow.js
frontend/packages/BidEvaluationDraftState.js
frontend/packages/BidEvaluationDraftRecovery.js
frontend/shared/MutationService.js
frontend/app/BiddingModel.js
```

### Root cause cần xác nhận

Flow hiện tại gần như:

```text
collect dirty patches
→ build metadata
→ recovery.save()
→ mutate pkg
→ mutate bids
→ stagePartialDraftMutations()
→ persistAndSync()
→ persistAndSync mới await authority boundary
```

Sai vì stale mutation đã được stage trước authoritative reconciliation.

### Yêu cầu sửa

Pattern bắt buộc:

```text
capture workspace token
→ await authoritative mutation boundary
→ verify workspace token
→ re-resolve canonical package/bids
→ rebuild patch từ dirty UI intent + refreshed canonical data
→ save recovery snapshot
→ begin workspace mutation
→ mutate state
→ stage outbox
→ persist
→ autoSync
```

Sau boundary phải:
- resolve lại package từ `model.state.goithau`;
- resolve lại bids từ `model.state.thongtinmothau`;
- dùng rowVersion mới;
- không dùng stale package/bid object;
- nếu package/bid đã bị server xóa hoặc user mất quyền: không resurrect, không stage stale patch;
- recovery local có thể giữ để user không mất nội dung, nhưng không được coi là server-saved.

### Tests bắt buộc

```text
draft_save_waits_for_authority_before_mutating_state_or_outbox
draft_save_rebuilds_patch_after_authoritative_refresh
draft_save_uses_refreshed_row_version
draft_save_does_not_resurrect_package_removed_by_authoritative_refresh
draft_save_does_not_stage_bid_removed_by_authoritative_refresh
workspace_change_while_draft_waits_for_authority_aborts_without_mutation
```

Trong lúc boundary pending phải assert:
- state chưa đổi;
- outbox chưa stage;
- persist chưa chạy;
- sync chưa chạy.

---

## 5. P0 — Định nghĩa đúng partial patch semantics

Đọc:

```text
frontend/app/WorkspaceMutationOutbox.js
frontend/app/mutationQueue.js
frontend/app/syncMergeUtils.js
frontend/shared/MutationService.js
frontend/packages/BidEvaluationDraftWorkflow.js
backend/sync/payload_validation.py
backend/sync/mapper.py
backend/sync/service.py
```

Draft hiện stage patch kiểu:

```js
{
  id,
  rowVersion,
  danhGiaHsdtMetadata
}
```

hoặc:

```js
{
  id,
  rowVersion,
  danhGiaHopLe
}
```

Trong khi sync merge có logic replacement record. Phải tránh trường hợp:

```text
server full record
+ pending partial patch
→ local state chỉ còn partial fields
```

### Không được sửa ngây thơ bằng `{...server, ...pending}` nếu chưa xác định contract

Phải kiểm tra:
- backend upsert là full row hay patch;
- authoritative/server-managed fields;
- explicit null;
- explicit empty string;
- false/0;
- nested object/array semantics;
- deleted field semantics;
- rowVersion semantics;
- validation rejection.

### Contract khuyến nghị

Ưu tiên explicit mutation mode:

```js
{
  mode: "patch" | "replace",
  record: {...}
}
```

Draft dùng `patch`; các workflow full-record giữ `replace`.

Nếu chọn materialize patch thành full record trước enqueue thì phải chứng minh:
- canonical record đã authoritative;
- không mang stale field;
- không overwrite server-managed field;
- không tạo full stale upsert.

### Tests bắt buộc

```text
pending_partial_package_patch_preserves_authoritative_non_dirty_fields_after_full_pull
pending_partial_bid_patch_preserves_authoritative_bid_fields_after_delta_pull
partial_patch_explicit_null_is_preserved
partial_patch_explicit_empty_string_is_preserved
partial_patch_false_and_zero_are_preserved
partial_patch_does_not_restore_server_deleted_record_when_invalidated
validation_rejection_removes_only_rejected_partial_patch
```

Ví dụ bắt buộc:

Server:

```js
{
  id: "pkg-1",
  rowVersion: 5,
  maGoiThau: "G01",
  tenGoiThau: "Gói A",
  giaGoiThau: 1000000,
  trangThai: "Đang chấm thầu",
  danhGiaHsdtMetadata: "old"
}
```

Pending patch:

```js
{
  id: "pkg-1",
  rowVersion: 5,
  danhGiaHsdtMetadata: "draft"
}
```

Expected local vẫn phải giữ toàn bộ server fields và chỉ đổi metadata.

---

## 6. Kiểm tra payload backend

Không được giả định backend hỗ trợ partial row.

Xác nhận thật trong:

```text
backend/sync/payload_validation.py
backend/sync/mapper.py
backend/sync/service.py
backend/sync/ownership.py
```

Nếu backend require full row:
- không gửi raw partial patch;
- materialize payload an toàn trước POST.

Nếu backend hỗ trợ patch:
- contract phải explicit;
- validation phải chỉ validate đúng fields được gửi;
- server-managed fields không được client patch tùy ý.

Không refactor backend lớn nếu không cần.

---

## 7. P0/P1 — Flow `mode="complete"` HSDT cũng phải authority-safe

Đọc:

```text
frontend/packages/bidEvaluationActions.js
```

Hiện completion flow còn pattern:

```text
mutate gt metadata
→ mutate bids
→ stageBidEvaluationMutation()
→ persistAndSync()
```

Authority boundary quá muộn.

### Yêu cầu

Đổi thành:

```text
authority boundary
→ verify workspace
→ refresh canonical package/bids
→ re-evaluate lot scope / rowVersion / valid bid set
→ derive ranking/result
→ mutate
→ stage
→ persist
→ sync
```

Không:
- tính ranking từ stale bidder set;
- giữ bidder bị server xóa;
- dùng stale rowVersion;
- mutate state trước boundary.

### Tests bắt buộc

```text
complete_evaluation_waits_for_authority_before_mutation
complete_evaluation_uses_refreshed_bid_row_versions
complete_evaluation_does_not_resurrect_removed_bid
complete_evaluation_aborts_on_workspace_change_before_commit
```

Giữ khác biệt:
- Draft: `saved=false`, `trangThai=draft`, không official ranking/finalization.
- Complete: `saved=true`, `trangThai=completed`, thực hiện business transitions chính thức.

---

## 8. P1 — Offline package version completeness

Đọc:

```text
frontend/packages/packagePreparation.js
frontend/packages/packageVersionSnapshot.js
frontend/shared/tableDataUtils.js
```

Current behavior đúng ở chỗ:
- offline không gọi aggregate-version API;
- local version được stage durable;
- reconnect có replay.

Nhưng phải xử lý case local child cache chưa đủ.

Ví dụ server có:
- 3 assignments;
- 100 goods;
- 8 bidders.

Local offline cache chỉ có:
- 1 assignment;
- 20 goods;
- 2 bidders.

Không được tạo historical version chính thức từ cache thiếu.

### Yêu cầu

Phải có cách chứng minh aggregate đã hydrate đầy đủ.

Nếu không chứng minh được, ưu tiên:

```text
không tạo version snapshot chính thức
→ giữ local form/draft
→ thông báo cần online để tạo phiên bản
```

Hoặc nếu architecture có deferred-version-intent hợp lệ:
- stage intent;
- tạo authoritative version khi reconnect;
- đảm bảo idempotency;
- không duplicate version.

### Tests

```text
offline_package_version_with_incomplete_child_cache_does_not_create_incomplete_snapshot
offline_package_version_with_known_complete_cache_preserves_all_owned_children
offline_package_version_reconnect_replays_without_duplicate_version
offline_package_version_same_org_new_epoch_cannot_commit_old_snapshot
```

---

## 9. P2/P1 — Delayed callbacks phải workspace-safe

Rà:

```text
setTimeout
requestAnimationFrame
requestIdleCallback
queueMicrotask
```

trong:

```text
SyncPullService.js
SyncPushService.js
SyncCoordinator.js
WorkspaceEventBridge.js
BidEvaluationDraftRecovery.js
BidEvaluationProgressView.js
```

Đặc biệt delayed sync-error banner.

Callback phải capture token/epoch; stale callback phải no-op.

### Draft recovery timer

Test bắt buộc:

```text
draft_recovery_timer_from_workspace_a_cannot_write_workspace_b_storage
```

Nếu current store capture đúng storage A và không thể ghi B thì viết test chứng minh, không sửa thừa.

---

## 10. Không được làm hỏng các fixes ở `4627149`

Bắt buộc giữ xanh:

```text
workspace_change_during_outbox_flush_cannot_start_auto_sync_for_new_workspace
workspace_change_during_outbox_flush_failure_cannot_set_storage_error_on_new_workspace
duplicate_plan_repair_from_workspace_a_cannot_resume_sync_in_workspace_b
workspace_b_does_not_reuse_workspace_a_sync_repair_promise
workspace_b_does_not_reuse_workspace_a_auto_sync_promise
workspace_change_during_successful_push_row_version_commit_cannot_mutate_new_workspace
workspace_change_during_successful_push_render_cannot_mark_new_workspace_server_saved
workspace_change_during_conflict_resolution_cannot_set_conflict_on_new_workspace
workspace_change_during_validation_recovery_cannot_restore_or_delete_new_workspace_records
late_success_response_from_workspace_a_cannot_clear_workspace_b_outbox
same_org_new_epoch_rejects_late_push_completion
same_org_new_epoch_rejects_late_pull_completion
background_render_scheduled_in_workspace_a_does_not_render_after_switch_to_b
```

---

## 11. Không regression package preparation

Giữ xanh:

```text
package_preparation_waits_for_authority_before_version_api
package_preparation_recomputes_version_decision_after_authoritative_refresh
package_preparation_uses_refreshed_row_version_for_aggregate_version_command
package_preparation_does_not_resurrect_a_record_removed_by_authoritative_refresh
package_preparation_does_not_snapshot_incomplete_children_after_hydration_failure
detail_edit_closing_time_preserves_status_assignment_and_owned_children
offline_package_preparation_does_not_call_authoritative_version_api
offline_package_version_is_durable_and_replayed_after_reconnect
```

Giữ:
- status;
- assignment;
- goods;
- opening;
- bidder goods;
- evaluation metadata;
- `isLatest` invariant;
- historical immutability.

---

## 12. Test-first bắt buộc

Với mỗi issue `CONFIRMED`:

```text
1. thêm failing regression test
2. chạy và chứng minh FAIL
3. sửa implementation
4. chạy lại -> PASS
5. chạy neighboring tests
6. chạy full suite
```

Báo cáo:

```text
BEFORE FIX: FAIL
AFTER FIX: PASS
```

Không claim PASS nếu chưa chạy.

---

## 13. Targeted tests

Tối thiểu:

```bash
node --test --test-concurrency=1 tests/js/bid_evaluation_draft_workflow.test.mjs
node --test --test-concurrency=1 tests/js/bid_evaluation_draft_state.test.mjs
node --test --test-concurrency=1 tests/js/draft_recovery_store.test.mjs
node --test --test-concurrency=1 tests/js/sync_push_workspace_races.test.mjs
node --test --test-concurrency=1 tests/js/sync_pull_ordering.test.mjs
node --test --test-concurrency=1 tests/js/sync_status.test.mjs
node --test --test-concurrency=1 tests/js/package_preparation_authority.test.mjs
```

---

## 14. Full gates

```bash
npm run test:js:coverage
npm run check:static
npm run build:secure
npm run test:e2e:smoke
npm run test:performance
```

Python:

```bash
python -m pytest -q   --cov=backend   --cov-branch   --cov-report=term   --cov-report=json:coverage.json   --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
```

Không:
- giảm coverage;
- tăng budget;
- skip Chromium/Firefox/WebKit;
- bỏ secure build verification.

---

## 15. E2E nên có

Nếu test infra hỗ trợ deterministic:

```text
draft survives reload
draft save during startup reconciliation
workspace switch while draft save pending
authoritative pull while partial draft pending
server deleted bidder while local draft exists
offline package version with partial cache
```

---

## 16. Final review chống regression mới

Sau khi code xanh, review lại:

```text
BidEvaluationDraftWorkflow
BidEvaluationDraftRecovery
BidEvaluationDraftState
bidEvaluationActions
MutationService
WorkspaceMutationOutbox
mutationQueue
syncMergeUtils
SyncPushService
SyncPullService
packagePreparation
```

Bắt buộc trả lời:

```text
1. Có mutation nào stage trước authority boundary không?
2. Có partial patch nào bị dùng như full replacement không?
3. Có server-managed field nào bị overwrite từ patch không?
4. Có stale workspace callback nào ghi storage/UI không?
5. Có offline version nào tạo incomplete aggregate không?
6. Có draft nào bị acknowledge khi server save fail không?
7. Có recovery draft nào bị clear nhầm không?
8. Có complete workflow nào dùng stale bidder set/rowVersion không?
9. Có sync race cũ nào quay lại không?
10. Có test/coverage/browser nào bị weaken không?
```

Nếu câu 1–9 còn “có”, task chưa DONE.

---

## 17. Acceptance criteria

- [ ] Draft authority boundary chạy trước mutation/staging.
- [ ] Draft dùng refreshed canonical records và rowVersion.
- [ ] Draft không resurrect package/bid bị xóa.
- [ ] Partial patch không làm mất non-dirty fields.
- [ ] `null`, `""`, `false`, `0` có semantics đúng.
- [ ] Full pull + pending patch giữ full local record.
- [ ] Delta pull + pending patch giữ full local record.
- [ ] Validation reject chỉ bỏ rejected patch.
- [ ] Complete evaluation authority-safe.
- [ ] Workspace switch giữa save không commit side-effect.
- [ ] Offline version không tạo snapshot thiếu child data.
- [ ] Draft recovery timer không cross-workspace.
- [ ] Tất cả race tests ở `4627149` vẫn pass.
- [ ] Package version inheritance vẫn pass.
- [ ] Coverage không giảm.
- [ ] Secure build pass.
- [ ] Chromium pass.
- [ ] Firefox pass.
- [ ] WebKit pass.
- [ ] Performance budget không đổi.

---

## 18. Báo cáo cuối

Trả Markdown:

```text
START_HEAD:
END_HEAD:
```

Issue matrix:

| Issue | Status | Root cause | Fix | Regression test |
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

| Test | Failed before | Passed after | Protected invariant |
|---|---:|---:|---|

Commands:

```text
targeted JS tests               PASS/FAIL
npm run test:js:coverage        PASS/FAIL
pytest                          PASS/FAIL
npm run check:static            PASS/FAIL
npm run build:secure            PASS/FAIL
npm run test:e2e:smoke          PASS/FAIL
npm run test:performance        PASS/FAIL
```

Không ghi PASS nếu chưa chạy thật.

---

## 19. CI

Kiểm tra `END_HEAD`.

Nếu CI status chưa có:

```text
CI STATUS NOT YET AVAILABLE
```

Không đoán.

Không coi task hoàn thành nếu Full CI đỏ do code mới.

---

## 20. Final instruction

Không vá cục bộ chỉ để test hiện tại xanh.

Phải sửa đúng contract:

```text
authoritative boundary trước mutation
+
partial patch semantics rõ ràng
+
workspace capability xuyên suốt async lifecycle
+
offline aggregate completeness
```

Nhưng không rewrite toàn bộ sync system.

Chỉ coi là DONE khi:

```text
không còn stale mutation trước authority
không còn partial-patch data loss
không còn cross-workspace callback
không còn incomplete offline version
và toàn bộ regression suite vẫn xanh
```
