# PROMPT CODEX — FIX TRIỆT ĐỂ OUTBOX RECEIPT / DRAFT VERSION / RECOVERY / LEGACY MIGRATION MÀ KHÔNG PHÁT SINH LỖI MỚI

## Repository

`https://github.com/newstar94/Bidding`

HEAD đã rà soát gần nhất:

`3327a16cad161b9815b0a91d4c0e728681edfe69`

Commit:

`feat: enhance bid evaluation draft workflow to ensure authoritative boundary before mutations and improve partial patch handling`

Commit này đã sửa tốt authority ordering Draft HSDT, partial-patch overlay, complete evaluation authority boundary, offline package aggregate completeness và delayed pull callback. **Không được làm hỏng các fix đó.**

---

## 1. Mục tiêu

Sửa triệt để:

1. **P0 — silent data loss:** patch không materialize được vì canonical record chưa hydrate có thể không nằm trong payload nhưng vẫn nằm trong receipt và bị ACK sau khi mutation khác thành công.
2. **P1 cao — version safety:** Draft HSDT sau authority refresh vẫn có thể target package ID cũ/historical thay vì re-resolve latest package.
3. **P1 — recovery contamination:** timer A giữ storage/key A nhưng callback có thể đọc form/controller hiện tại của B rồi lưu dữ liệu B vào recovery A.
4. **P1 — legacy migration:** outbox cũ không có `patches` có thể hydrate với `patches === undefined`.
5. **P1 — hidden pending mutation:** durable patch còn pending nhưng canonical chưa hydrate làm payload null, khiến sync activity có thể báo settled.

Mục tiêu kiến trúc:

```text
NO SILENT MUTATION LOSS
+ exact ACK semantics
+ latest-version correctness
+ workspace-isolated recovery
+ backward-compatible durable outbox
+ pending != sendable
```

---

## 2. Nguyên tắc bắt buộc: KHÔNG SINH LỖI MỚI

Không sửa theo kiểu “test mới xanh là xong”.

Ưu tiên:

```text
data integrity
> no silent mutation loss
> workspace isolation
> version integrity
> authoritative correctness
> outbox durability
> offline behavior
> UX correctness
> performance
> refactor
```

Với mỗi patch phải tự kiểm:

```text
Có thể ACK nhầm mutation không?
Có thể làm mất mutation durable không?
Có thể clear generation mới bằng response cũ không?
Có thể write historical package không?
Có thể cross workspace không?
Có làm recovery mất/nhầm dữ liệu không?
Có phá outbox legacy không?
Có làm UI báo synced khi vẫn pending không?
Có regress offline/startup/version inheritance không?
```

Nếu có khả năng tạo regression, phải thiết kế lại hoặc thêm guard/test.

---

## 3. Xác định HEAD thực tế trước khi sửa

Chạy:

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

Nếu HEAD khác `3327a16...`:
- review diff;
- re-check từng issue;
- chỉ patch issue còn tồn tại;
- đánh dấu `CONFIRMED / ALREADY FIXED / NOT REPRODUCED / RISK ONLY`.

Không patch máy móc.

---

## 4. Cấm tuyệt đối

Không được:

- hạ coverage;
- `test.skip()`;
- bỏ Firefox/WebKit;
- tăng performance budget;
- disable offline;
- bỏ outbox;
- ACK toàn queue khi chỉ gửi một phần;
- clear mutation để né conflict;
- biến mọi patch thành full-table replace;
- dùng magic delay;
- swallow error;
- dùng global mutex cho mọi workspace;
- blocking toàn startup;
- mutate historical package;
- weaken rowVersion;
- xóa recovery draft khi server save fail;
- sửa test expectation để phù hợp bug;
- rewrite toàn sync architecture nếu không cần.

---

# P0 — RECEIPT CHỈ ĐƯỢC ACK OPERATION THỰC SỰ ĐÃ GỬI

Đọc:

```text
frontend/app/WorkspaceMutationOutbox.js
frontend/app/mutationQueue.js
frontend/app/SyncPushService.js
frontend/app/BiddingModel.js
```

## 5. Root cause

Hiện flow gần:

```javascript
const receipt = this._createReceipt();

return buildMutationPayload({
  queue: this.queue,
  state,
  snapshot: receipt,
});
```

Trong payload builder, patch chỉ materialize khi canonical record tồn tại.

Nếu canonical thiếu:

```text
patch A -> omitted from payload
```

nhưng receipt vẫn chứa A.

Nếu cùng batch có upsert B:

```text
payload sends B
server success
ack(receipt)
A may be deleted although A was never transmitted
```

=> **P0 silent data loss.**

---

## 6. Contract mới bắt buộc

Invariant:

```text
receipt operations == exactly the mutation generations represented in transmitted payload
```

Không được:

```text
receipt = entire queue
```

Thiết kế tương đương:

```text
build payload
→ identify exactly-sent operations
→ build receipt only from sent generations
```

Ví dụ receipt:

```javascript
{
  upserts: onlySentUpserts,
  patches: onlyMaterializedPatches,
  deletes: onlySentDeletes,
  dirtyTables: onlySentDirtyTables
}
```

---

## 7. Unsendable patch phải giữ durable

Nếu canonical chưa hydrate:

```text
pending patch MUST remain in durable outbox
```

cho đến khi:
1. canonical hydrate và patch thực sự được gửi;
2. authoritative deletion invalidate patch;
3. server validation/rejection loại đúng patch;
4. user explicit discard.

Không được bỏ patch chỉ vì hiện tại chưa sendable.

---

## 8. Mixed batch semantics

Scenario bắt buộc:

```text
Queue:
  patch A -> canonical missing
  upsert B -> sendable
```

Expected:

```text
Payload: B only
Receipt: B only
Success: clear B, KEEP A
```

Sau hydrate A:

```text
next sync sends A
then ACK A
```

---

## 9. Tests bắt buộc cho P0

```text
unsendable_patch_is_not_in_receipt
mixed_batch_success_does_not_ack_patch_missing_canonical_record
patch_missing_canonical_survives_multiple_successful_unrelated_syncs
patch_becomes_sendable_after_canonical_hydration_and_is_then_acknowledged
server_deleted_record_invalidates_unsendable_patch_without_resurrection
newer_patch_generation_is_not_acked_by_older_materialized_receipt
```

Test generation:

```text
gen1 sent
→ user edits same record => gen2
→ gen1 response success
→ gen2 MUST remain
```

---

## 10. Audit ACK / reject / rowVersion

Rà:

```text
ack()
reject()
_applyServerRowVersions()
acknowledgeServerDeletions()
restore/checkpoint
```

cho:

```text
upsert
patch
delete
replace-table
```

Bảo đảm:
- patch mới không bị receipt cũ clear;
- rowVersion update đúng queued generation;
- validation reject chỉ bỏ operation được gửi;
- unrelated pending mutation không bị ảnh hưởng.

---

# P1 — DRAFT PHẢI RE-RESOLVE LATEST PACKAGE SAU AUTHORITY

Đọc:

```text
frontend/packages/BidEvaluationDraftWorkflow.js
frontend/packages/bidEvaluationActions.js
frontend/packages/detail/PackageDetailState.js
frontend/shared/versionResolver.js
```

## 11. Root cause

Scenario:

```text
UI đang ở v01
→ Save Draft
→ authority refresh
→ server có v02 latest
→ v01 vẫn tồn tại isLatest=0
→ draft lookup bằng old ID
→ metadata/bid evaluation có thể write v01 historical
```

Không được mutate historical version.

---

## 12. Version invariant

Sau authority:

```text
target package = latest package trong đúng logical family / plan snapshot
```

Dùng helper có sẵn:

```text
resolveLatestPackage
resolveLatestVersion
getLatestPackage
```

Không tạo duplicate version resolution logic.

Nếu latest ID đổi:
- re-evaluate lot scope;
- re-evaluate bidder set;
- re-evaluate rowVersions;
- re-evaluate evaluation metadata.

Nếu dirty UI intent vẫn hợp lệ:
- retarget latest.

Nếu scope/bids thay đổi không còn an toàn:
- abort server save;
- giữ recovery local;
- báo user review.

Không silently write historical version.

---

## 13. Tests version safety

```text
draft_save_re_resolves_latest_package_after_authoritative_refresh
draft_save_never_mutates_historical_package_when_new_latest_version_exists
draft_save_retargets_valid_dirty_intent_to_new_latest_version
draft_save_aborts_and_preserves_recovery_when_latest_version_changes_scope
draft_save_uses_latest_package_row_version_and_latest_bid_set
complete_evaluation_never_commits_to_historical_package_after_refresh
```

Nếu complete flow đã đúng, thêm test chứng minh, không sửa thừa.

---

# P1 — RECOVERY TIMER KHÔNG ĐƯỢC ĐỌC FORM WORKSPACE MỚI

Đọc:

```text
frontend/packages/BidEvaluationDraftRecovery.js
frontend/shared/DraftRecoveryStore.js
```

## 14. Root cause

Current pattern:

```text
event A
→ schedule callback
→ callback later calls reportSnapshot(controller)
```

Nếu A→B trước callback:

```text
storage = A
key = A
controller/view/model = B
```

=> có thể ghi dữ liệu B vào recovery A.

Đây vẫn là cross-workspace contamination dù storage B không bị ghi.

---

## 15. Recovery contract

Tại thời điểm event A xảy ra phải capture:

```text
workspace token A
recovery key A
recovery store A
immutable report snapshot A
immutable bidder patch snapshot A
```

Timer chỉ ghi captured snapshot.

Không đọc lại current:

```text
controller.view
controller.model
workspaceScope
```

để tạo payload A.

Ưu tiên:

```text
capture immutable snapshot immediately
→ debounce only the durable write
```

nhằm vừa tránh contamination vừa không làm mất draft A.

---

## 16. Recovery tests

```text
draft_recovery_timer_from_a_cannot_capture_report_fields_from_b
draft_recovery_timer_from_a_cannot_capture_bid_fields_from_b
draft_recovery_scheduled_in_a_still_saves_a_snapshot_after_switch_to_b
same_org_new_epoch_recovery_timer_does_not_use_new_epoch_view
recovery_debounce_keeps_latest_snapshot_within_same_workspace
```

---

# P1 — LEGACY OUTBOX MIGRATION

Đọc:

```text
frontend/app/mutationQueue.js
frontend/app/WorkspaceMutationOutboxStore.js
frontend/app/WorkspaceMutationOutbox.js
```

## 17. Required canonical shape

`normalizeMutationQueue()` luôn phải trả:

```javascript
{
  dirtyTables: {},
  upserts: {},
  patches: {},
  deletes: [],
  ...
}
```

Dù legacy input hoàn toàn không có field `patches`.

Không chỉ normalize khi `patches !== undefined`.

---

## 18. Migration invariants

Không được:
- mất pending upserts;
- mất deletes;
- reset baseSyncVersion;
- đổi clientMutationId vô lý;
- giảm revision;
- coi valid legacy queue là corrupt;
- duplicate mutations.

Tests:

```text
legacy_outbox_without_patches_hydrates_with_empty_patch_map
legacy_outbox_without_patches_can_replace_table_after_upgrade
legacy_outbox_without_patches_can_enqueue_patch_after_upgrade
legacy_outbox_pending_upserts_survive_patch_schema_upgrade
legacy_dual_backend_outbox_merge_preserves_existing_mutations_and_initializes_patches
```

---

# P1 — PENDING != SENDABLE

Đọc:

```text
frontend/app/SyncCoordinator.js
frontend/app/BiddingModel.js
frontend/app/WorkspaceMutationOutbox.js
```

## 19. Phân biệt rõ

```text
hasPendingMutations
```

khác:

```text
hasSendableMutations
```

Case:

```text
durable patch exists
canonical missing
```

Expected:

```text
hasPendingMutations = true
hasSendableMutations = false
```

UI/activity không được coi đã settled chỉ vì payload builder trả null.

---

## 20. Model API nên có raw queue status

Có thể bổ sung API nhỏ:

```javascript
hasPendingMutationOutboxChanges()
```

dựa trên raw queue:

```text
mutationQueueHasChanges(queue)
```

Không lấy `buildMutationSyncPayload()` làm nguồn truth cho pending-state vì đó là sendability.

Tests:

```text
hydrated_patch_without_loaded_canonical_record_is_still_reported_pending
unsendable_patch_does_not_make_sync_activity_settled
after_canonical_hydration_patch_becomes_sendable_without_duplicate_queue_entry
after_patch_ack_sync_activity_can_become_settled
```

---

# 21. Pagination / cold-cache test bắt buộc

Test realistic flow:

```text
reload
→ hydrate outbox trước
→ target record chưa load vì server-side pagination
→ patch vẫn pending
→ unrelated mutation có thể sync
→ patch vẫn durable
→ later canonical page hydrates
→ patch becomes sendable
→ sync
→ ACK đúng patch
```

Không fix bằng cách eager-load toàn database.

---

# 22. Không regression các fix ở HEAD hiện tại

Bắt buộc giữ xanh:

```text
draft_save_waits_for_authority_before_mutating_state_or_outbox
draft_save_rebuilds_patch_after_authoritative_refresh
draft_save_uses_refreshed_row_version
draft_save_does_not_resurrect_package_removed_by_authoritative_refresh
draft_save_does_not_stage_bid_removed_by_authoritative_refresh
workspace_change_while_draft_waits_for_authority_aborts_without_mutation

pending_partial_package_patch_preserves_authoritative_non_dirty_fields_after_full_pull
pending_partial_bid_patch_preserves_authoritative_bid_fields_after_delta_pull
partial_patch_explicit_null_is_preserved
partial_patch_explicit_empty_string_is_preserved
partial_patch_false_and_zero_are_preserved
partial_patch_does_not_restore_server_deleted_record_when_invalidated
validation_rejection_removes_only_rejected_partial_patch

complete_evaluation_waits_for_authority_before_mutation
complete_evaluation_uses_refreshed_bid_row_versions
complete_evaluation_does_not_resurrect_removed_bid
complete_evaluation_aborts_on_workspace_change_before_commit

offline_package_version_with_incomplete_child_cache_does_not_create_incomplete_snapshot
offline_package_version_with_known_complete_cache_preserves_all_owned_children
offline_package_version_reconnect_replays_without_duplicate_version
offline_package_version_same_org_new_epoch_cannot_commit_old_snapshot
```

---

# 23. Không regression sync/workspace hardening trước đó

Giữ xanh:

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

# 24. Không regression package version

Giữ:

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

Business invariants:

```text
status preserved
assignment preserved
owned children preserved
historical parent immutable
<=1 latest per family + plan snapshot
```

---

# 25. Test-first bắt buộc

Mỗi issue `CONFIRMED`:

```text
1. add failing regression test
2. run -> BEFORE FIX: FAIL
3. implement minimal safe fix
4. rerun -> AFTER FIX: PASS
5. run neighboring tests
6. run full suite
7. perform second regression review
```

Không implementation-first rồi thêm happy-path test.

---

# 26. Targeted tests tối thiểu

```bash
node --test --test-concurrency=1 tests/js/sync_pending_overlay.test.mjs
node --test --test-concurrency=1 tests/js/outbox_durability.test.mjs
node --test --test-concurrency=1 tests/js/bid_evaluation_draft_workflow.test.mjs
node --test --test-concurrency=1 tests/js/bid_evaluation_transition.test.mjs
node --test --test-concurrency=1 tests/js/draft_recovery_store.test.mjs
node --test --test-concurrency=1 tests/js/sync_push_workspace_races.test.mjs
node --test --test-concurrency=1 tests/js/sync_pull_ordering.test.mjs
node --test --test-concurrency=1 tests/js/sync_status.test.mjs
node --test --test-concurrency=1 tests/js/package_preparation_authority.test.mjs
```

Nếu tên file thực tế khác, dùng canonical equivalent.

---

# 27. Full gates

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
- tăng performance budget;
- skip browser;
- bỏ secure-build checks.

Playwright phải giữ:
- Chromium;
- Firefox;
- WebKit.

---

# 28. Performance invariant

Không sửa missing canonical bằng:

```text
full sync toàn bộ trước mỗi push
eager hydrate toàn DB
disable pagination
global serialization mọi workspace
```

Mục tiêu:

```text
unsendable mutation remains durable
without forcing unrelated expensive hydration
```

---

# 29. Audit cross-type mutation transitions

Bắt buộc test/review:

```text
patch + patch
patch + upsert
upsert + patch
patch + delete
delete + upsert
```

Expected:
- no stale generation entries;
- correct winner semantics;
- old receipt cannot clear new operation;
- no duplicate payload row.

---

# 30. Audit `.finally()` / cleanup

Rà:

```text
snapshotForSync
_createReceipt
ack
reject
clearCommittedMutationBatch
applySuccessfulPush
autoSync finally
WorkspaceMutationOutboxStore merge/persist
```

Cleanup chỉ được clear đúng owned generation/promise/mutation.

---

# 31. Sau khi toàn bộ tests xanh — bắt buộc REVIEW REGRESSION LẦN 2

Không kết thúc ngay.

Review lại:

```text
mutationQueue.js
WorkspaceMutationOutbox.js
WorkspaceMutationOutboxStore.js
SyncPushService.js
SyncPullService.js
SyncCoordinator.js
BiddingModel.js
BidEvaluationDraftWorkflow.js
BidEvaluationDraftRecovery.js
bidEvaluationActions.js
packagePreparation.js
versionResolver.js
```

Tìm lỗi **do chính patch mới sinh ra**.

---

# 32. Câu hỏi bắt buộc trước khi DONE

Phải trả lời bằng test/evidence:

```text
1. Có operation nào trong receipt nhưng không có trong transmitted payload không?
2. Có mutation chưa gửi nào bị ACK không?
3. Có generation mới nào bị response cũ clear không?
4. Có durable pending mutation nhưng sync activity nói settled không?
5. Có draft nào target historical package không?
6. Có recovery timer A nào đọc UI B không?
7. Legacy queue cũ có hydrate an toàn không?
8. Cross-type mutation transitions có đúng không?
9. Các sync/workspace races cũ có regress không?
10. Package version inheritance có regress không?
11. Có test nào bị weaken/skip không?
12. Có coverage/performance/security gate nào bị nới không?
```

Nếu 1–10 còn vấn đề thì chưa DONE.

---

# 33. Acceptance Criteria — P0 data loss

- [ ] receipt chỉ chứa operation thực sự gửi;
- [ ] unsendable patch không bị ACK;
- [ ] mixed batch chỉ clear sent mutation;
- [ ] newer generation survives older ACK;
- [ ] pending patch survives reload/cold cache;
- [ ] patch becomes sendable after hydration;
- [ ] server deletion invalidates safely;
- [ ] no silent mutation loss.

---

# 34. Acceptance Criteria — Version / Recovery / Migration

- [ ] Draft re-resolve latest package after authority.
- [ ] Historical package không bị mutate.
- [ ] Latest lot/bid scope được revalidate.
- [ ] Recovery timer A không đọc form B.
- [ ] Same-org new epoch cũng safe.
- [ ] Recovery debounce vẫn đúng.
- [ ] Legacy queue thiếu `patches` normalize thành `{}`.
- [ ] Legacy upserts/deletes không mất.
- [ ] Raw pending != sendable được phân biệt.
- [ ] UI/activity không báo settled khi outbox còn mutation.

---

# 35. Acceptance Criteria — Không phát sinh lỗi mới

- [ ] all previous sync-race tests pass;
- [ ] all current draft authority tests pass;
- [ ] all partial-patch overlay tests pass;
- [ ] all complete evaluation tests pass;
- [ ] all offline package-version tests pass;
- [ ] package detail closing-time inheritance still passes;
- [ ] startup remains deferred;
- [ ] offline remains supported;
- [ ] coverage unchanged or improved;
- [ ] performance budget unchanged;
- [ ] secure build pass;
- [ ] Chromium pass;
- [ ] Firefox pass;
- [ ] WebKit pass;
- [ ] second regression review finds no new correctness bug.

---

# 36. Commit strategy

Ưu tiên patch nhỏ, reviewable:

```text
fix(sync): acknowledge only transmitted mutation generations
fix(sync): preserve unsendable pending patches
fix(evaluation): retarget draft to authoritative latest package
fix(evaluation): capture recovery snapshot before debounce
fix(sync): normalize legacy outbox patch schema
test(sync): add no-data-loss receipt regressions
```

Không gom thành refactor lớn khó audit.

---

# 37. Báo cáo cuối

Trả Markdown:

```text
START_HEAD:
END_HEAD:
```

Issue matrix:

| Issue | Before | Status | Root cause | Fix | Test |
|---|---|---|---|---|---|

Status chỉ dùng:

```text
FIXED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
BLOCKED BY ENVIRONMENT
```

Files changed:

| File | Change | Why |
|---|---|---|

Tests:

| Test | Before | After | Protected invariant |
|---|---:|---:|---|

Commands:

```text
targeted outbox tests             PASS/FAIL
targeted draft tests              PASS/FAIL
targeted recovery tests           PASS/FAIL
targeted package tests            PASS/FAIL
npm run test:js:coverage          PASS/FAIL
pytest                            PASS/FAIL
npm run check:static              PASS/FAIL
npm run build:secure              PASS/FAIL
npm run test:e2e:smoke            PASS/FAIL
npm run test:performance          PASS/FAIL
```

Không ghi PASS nếu chưa chạy thật.

---

# 38. CI

Kiểm tra `END_HEAD`.

Nếu chưa có kết quả:

```text
CI STATUS NOT YET AVAILABLE
```

Không đoán.

Không coi task hoàn thành nếu Full CI đỏ do code mới.

---

# 39. FINAL INSTRUCTION

Invariant trung tâm:

```text
NO MUTATION IS EVER ACKNOWLEDGED
UNLESS THAT EXACT GENERATION WAS ACTUALLY TRANSMITTED AND COMMITTED.
```

Đồng thời:

```text
NO DRAFT MAY WRITE TO A HISTORICAL PACKAGE VERSION.

NO DELAYED RECOVERY CALLBACK MAY READ DATA FROM ANOTHER WORKSPACE.

NO LEGACY DURABLE OUTBOX MAY BREAK AFTER SCHEMA UPGRADE.

NO DURABLE PENDING MUTATION MAY BECOME INVISIBLE JUST BECAUSE IT IS TEMPORARILY UNSENDABLE.
```

Và quan trọng nhất:

> **Trong quá trình sửa, tuyệt đối không được làm phát sinh lỗi mới.**

Chỉ coi là DONE khi:
- failing tests chứng minh bug;
- fixes pass targeted tests;
- toàn bộ regression cũ vẫn xanh;
- full JS/Python/build/E2E/performance pass;
- regression-review lần 2 không phát hiện side-effect mới;
- exact START_HEAD / END_HEAD / commands / results được báo cáo.
