# PROMPT CODEX — FIX TRIỆT ĐỂ MSC REVISION CHAIN / PREDECESSOR / WORKSPACE RACE / RETRY STATE — KHÔNG PHÁT SINH LỖI MỚI

## Repository

```text
https://github.com/newstar94/Bidding
```

HEAD đã được rà soát gần nhất:

```text
52026231465682fd827cc49fcfae11c64a30555e
```

Commit:

```text
fix(plans): sequence MSC revision saves
```

Parent:

```text
2f936f5d00666a76812e19a1bc0df2eb67829c4a
```

Commit hiện tại đã làm tốt một số phần:
- không replay prefix revision MSC đã imported;
- không cho finalize trước revision cuối;
- programmatic guard `PROCUREMENT_REVISIONS_REMAINING`;
- giữ package edit trong plan draft, không đẩy `/api/sync` sớm;
- plan draft finalization đã workspace-safe;
- intermediate draft save đã có rollback durability;
- multi-tab draft envelope đã có revision/tombstone;
- shared reference reapply đã được siết;
- exact outbox receipt/ACK vẫn được giữ.

**Không được làm hỏng bất kỳ fix nào ở trên.**

---

# 0. MỤC TIÊU

Sửa triệt để 4 vấn đề mới được phát hiện trong chuỗi revision từ MuaSamCong (MSC):

```text
P0-1  predecessor rowVersion/token không advance đúng qua 00 → 01 → 02 → ...
P0-2  completeProcurementPlanImportRevision()/next() chưa workspace-safe
P1-3  predecessor validation chỉ so rowVersion, chưa so identity/root
P1-4  durable save thành công nhưng load revision tiếp theo fail gây rollback/state divergence
```

Mục tiêu cuối:

```text
MSC revision chain phải:
- tuần tự;
- đúng predecessor;
- chống concurrent stale write;
- workspace-isolated;
- retry-safe;
- reload-safe;
- không duplicate;
- không rollback dữ liệu đã durable;
- không phát sinh regression ở sync/version/draft/outbox.
```

---

# 1. NGUYÊN TẮC CAO NHẤT — KHÔNG ĐƯỢC SINH LỖI MỚI

Đây là yêu cầu bắt buộc.

Không sửa theo kiểu:

```text
thêm test mới
→ sửa cho test xanh
→ bỏ qua side effect
```

Mỗi thay đổi phải bảo toàn:

```text
1. tenant/workspace isolation
2. authoritative predecessor correctness
3. idempotency
4. plan version immutability
5. draft durability
6. import provenance
7. outbox exact ACK
8. startup reconciliation
9. offline/local-first semantics
10. package/version inheritance
11. performance
12. UX
```

Với mỗi patch phải tự hỏi:

```text
- response/request của workspace A có thể mutate B không?
- same-org new epoch có bị lọt không?
- predecessor có thể đổi nhưng rowVersion vô tình bằng nhau không?
- revision 02 có thể dùng token của 00 không?
- retry có tạo duplicate plan/package không?
- network failure sau durable save có làm rollback mất dữ liệu đã lưu không?
- controller.currentIndex có lệch durable session không?
- reload có resume đúng revision chưa hoàn tất không?
- finalization có chạy khi còn revision chưa áp dụng không?
- package edits có lọt vào /api/sync trước finalization không?
- fix mới có phá outbox/sync/conflict recovery không?
```

Nếu có khả năng xảy ra, chưa được coi là DONE.

---

# 2. XÁC ĐỊNH HEAD THỰC TẾ TRƯỚC KHI SỬA

Bắt buộc chạy:

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

Không được giả định:

```text
52026231465682fd827cc49fcfae11c64a30555e
```

vẫn là HEAD hiện tại.

Nếu HEAD mới hơn:

1. compare từ `5202623...` đến HEAD;
2. re-check từng issue;
3. issue đã sửa thì đánh dấu `ALREADY FIXED`;
4. không patch máy móc;
5. chỉ sửa issue còn tồn tại.

Status cho từng issue:

```text
CONFIRMED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
```

---

# 3. CẤM TUYỆT ĐỐI

Không được:

- hạ coverage;
- `test.skip()`;
- bỏ Chromium/Firefox/WebKit;
- tăng performance budget;
- disable offline;
- disable IndexedDB durability;
- bỏ plan draft;
- bỏ sequential revision workflow;
- bỏ optimistic concurrency;
- bỏ rowVersion;
- bypass provenance validation;
- tin hoàn toàn client `expectedRowVersion`;
- chỉ so organizationId mà bỏ workspace epoch;
- dùng magic delay;
- full-sync toàn DB trước mỗi revision;
- global lock toàn app;
- clear draft khi request fail;
- rollback durable draft về state cũ;
- tạo duplicate revision khi retry;
- mutate historical plan/package;
- cho revision 02 ghi đè khi predecessor 01 đã bị actor khác thay;
- dùng `catch {}` để nuốt lỗi;
- sửa expected test để hợp với bug;
- rewrite cả procurement import subsystem nếu không cần.

---

# 4. FILES CẦN ĐỌC KỸ TRƯỚC KHI PATCH

Bắt buộc review tối thiểu:

```text
backend/procurement_import/session.py
backend/procurement_import/sync_binding.py
backend/procurement_import/service.py
backend/procurement_import/repository.py
backend/plan_drafts/finalize.py
backend/sync/service.py

frontend/procurement/PlanImportWizard.js
frontend/procurement/SequentialRevisionController.js
frontend/procurement/ProcurementImportResume.js
frontend/procurement/ProcurementDraftWorkflow.js
frontend/plans/KeHoachWorkflow.js
frontend/plans/PlanVersionDraftSession.js
frontend/app/workspaceLease.js
frontend/app/SyncPullService.js
frontend/app/SyncCoordinator.js

tests/js/plan_breakdown_draft_transaction.test.mjs
tests/js/plan_version_draft_session.test.mjs
tests/js/procurement_import_wizard.test.mjs
tests/js/sync_pull_ordering.test.mjs
tests/js/sync_conflict_recovery.test.mjs

tests/test_procurement_import_service.py
tests/test_procurement_import_sync_binding.py
tests/test_plan_draft_finalize.py
```

---

# 5. P0-1 — PREDECESSOR TOKEN KHÔNG ADVANCE ĐÚNG QUA CHUỖI REVISION

## Root cause đã phát hiện

Session hiện capture một lần:

```text
canonicalBundle.plan.expectedRowVersion
```

từ latest plan tại thời điểm preview/session được tạo.

Ví dụ:

```text
server:
plan-00
rowVersion = 4

MSC pending:
01
02
```

Session giữ:

```text
expectedRowVersion = 4
```

Sau khi revision 01 commit:

```text
plan-01
rowVersion = 1
isLatest = 1
```

Nhưng session chỉ update:

```text
revisions_json
current_revision_index
status
```

không update predecessor concurrency token.

Revision 02 tiếp tục gọi:

```text
_validate_plan_target_row_version(...)
```

với:

```text
expectedRowVersion = 4
```

trong khi latest hiện tại là:

```text
plan-01 rowVersion = 1
```

=> conflict sai.

---

# 6. PREDECESSOR INVARIANT BẮT BUỘC

Mỗi revision phải có predecessor của **ngay trước nó**.

Ví dụ:

```text
00 already persisted
rowVersion=4

revision 01:
expected predecessor:
  id = plan-00
  rootId = plan-root
  rowVersion = 4

01 commit success
server returns:
  plan-01
  rowVersion = 1

revision 02:
expected predecessor:
  id = plan-01
  rootId = plan-root
  rowVersion = 1

02 commit success
server returns:
  plan-02
  rowVersion = 1

revision 03:
expected predecessor:
  id = plan-02
  rootId = plan-root
  rowVersion = 1
```

Không dùng một token tĩnh của plan ban đầu cho toàn session.

---

# 7. KHÔNG CHỈ `expectedRowVersion`

Thiết kế predecessor token nên có semantics tương đương:

```json
{
  "id": "plan-01",
  "rootId": "plan-root",
  "rowVersion": 1,
  "localVersion": 1,
  "sourceRevisionNumber": "01"
}
```

Không bắt buộc client gửi toàn bộ nếu server có thể derive từ provenance.

Ưu tiên:

```text
server authoritative predecessor
> client hint
```

---

# 8. SERVER NÊN DERIVE PREDECESSOR TỪ PROVENANCE ĐÃ COMMIT

Nếu có thể, dùng:

```text
procurement_source_revision
procurement import session progress
local_snapshot_id
local_root_id
```

để xác định snapshot vừa commit của revision trước.

Ví dụ:

```text
session revision 01 COMMITTED
→ provenance localSnapshotId = plan-01
→ load plan-01 rowVersion FOR UPDATE
→ revision 02 must target exactly plan-01
```

Không dựa duy nhất vào:

```text
canonicalBundle.plan.expectedRowVersion
```

đã capture từ đầu session.

---

# 9. CẬP NHẬT SESSION STATE SAU MỖI COMMIT NẾU CẦN

Nếu architecture vẫn muốn lưu predecessor token trong session, sau revision commit phải atomic update:

```text
revisions_json
current_revision_index
status
predecessor plan id
predecessor root id
predecessor rowVersion
predecessor source revision
```

trong cùng transaction.

Không để:

```text
DB entity commit success
→ session progress updated
→ predecessor token stale
```

---

# 10. P0-1 TESTS BẮT BUỘC

Backend integration tests:

```text
persisted_00_then_pending_01_02_commits_in_sequence
```

Scenario:

```text
existing plan-00 rowVersion=4
session pending revisions [01,02]

commit 01
assert plan-01 is latest

commit 02
assert success
assert predecessor is plan-01, not plan-00
```

Thêm:

```text
persisted_00_then_01_02_03_advances_predecessor_each_step
revision_02_does_not_reuse_initial_00_expected_row_version
retry_after_revision_01_commit_uses_committed_01_as_predecessor
reload_session_after_revision_01_commit_resumes_revision_02_with_correct_predecessor
```

---

# 11. P1-3 — PREDECESSOR VALIDATION PHẢI SO IDENTITY, KHÔNG CHỈ ROWVERSION

Current problematic pattern:

```python
SELECT id, row_version
...
if int(current[1]) != expected:
    conflict
```

`rowVersion` là per-record version, không phải global sequence.

Hai record khác nhau có thể cùng:

```text
rowVersion = 1
```

---

# 12. CONCURRENT SCENARIO BẮT BUỘC CHẶN

Scenario:

```text
session created:
latest plan = plan-00
rowVersion = 1

actor B creates plan-01
plan-01 rowVersion = 1

old session continues
```

Nếu chỉ check rowVersion:

```text
1 == 1
→ false PASS
```

Sai.

Expected:

```text
expected predecessor id = plan-00
actual latest id = plan-01
→ PROCUREMENT_SOURCE_VERSION_CONFLICT
```

---

# 13. PREDECESSOR MATCH CONTRACT

Validate tối thiểu:

```text
expected predecessor id == actual latest id
expected rootId == actual rootId
expected rowVersion == actual rowVersion
```

Nếu revision chain/provenance cho phép derive source revision:

```text
expected previous source revision == actual bound previous source revision
```

Càng tốt.

---

# 14. KHÔNG TIN CLIENT ID MÙ QUÁNG

Client predecessor ID chỉ là hint.

Server phải:
- scope organization;
- verify row exists;
- verify latest;
- verify same family;
- verify root;
- verify provenance/session relation;
- lock row.

---

# 15. SQL/LOCK INVARIANT

Validation và commit phải cùng transaction.

Use:

```sql
... FOR UPDATE
```

hoặc equivalent existing transaction lock.

Không:

```text
SELECT predecessor
→ release
→ later commit
```

vì TOCTOU.

---

# 16. TESTS PREDECESSOR IDENTITY

```text
same_row_version_but_different_latest_plan_is_rejected
same_root_but_wrong_snapshot_id_is_rejected
wrong_root_with_matching_row_version_is_rejected
stale_session_cannot_append_revision_after_concurrent_new_latest
correct_id_root_row_version_predecessor_is_accepted
```

---

# 17. P0-2 — REVISION TRANSITION `NEXT()` PHẢI WORKSPACE-SAFE

Đọc:

```text
frontend/procurement/PlanImportWizard.js
frontend/procurement/SequentialRevisionController.js
frontend/procurement/ProcurementImportResume.js
frontend/plans/KeHoachWorkflow.js
frontend/app/workspaceLease.js
```

Current flow gần:

```js
await flow.controller.saveCurrent(savedPlanId);

const nextDraft = await flow.controller.next();

await materializePlanImportRevision(
  this,
  flow,
  nextDraft,
  savedPlanId,
);
```

Không được để live `this.model` của workspace hiện tại được dùng sau await nếu request thuộc workspace cũ.

---

# 18. WORKSPACE CAPABILITY CHO TOÀN IMPORT FLOW

Khi start plan import, flow nên capture:

```text
workspaceToken
workspace lease/epoch
workspaceStorage
state/db resources nếu cần
```

Flow A phải luôn mang identity A.

Không chỉ wizard object.

---

# 19. `completeProcurementPlanImportRevision()` CONTRACT

Flow:

```text
capture/check import workspace A
→ save current local step
→ check A current
→ request next revision A
→ await
→ check A current
→ materialize into A only
→ check A current
→ update resume pointer A
```

Nếu workspace đổi:

```text
return/throw WORKSPACE_CHANGED
```

Không materialize.

---

# 20. SAME-ORG NEW EPOCH BẮT BUỘC

Không chỉ:

```text
organizationId
```

Phải check exact token kiểu:

```text
user:org-a@1
```

vs:

```text
user:org-a@2
```

A@1 completion không được tác động A@2.

---

# 21. `SequentialRevisionController.next()` KHÔNG NÊN TỰ HIỂU WORKSPACE

Workspace guard thuộc orchestration layer.

Controller có thể giữ state machine thuần.

Nhưng caller phải:
- capture token;
- verify before/after `next()`.

Không nhét global model vào `SequentialRevisionController` nếu không cần.

---

# 22. LATE RESPONSE TESTS BẮT BUỘC

```text
workspace_change_during_next_procurement_revision_load_cannot_materialize_into_b
late_revision_response_from_a_cannot_modify_b_plan_rows
late_revision_response_from_a_cannot_modify_b_package_rows
late_revision_response_from_a_cannot_create_b_plan_draft_session
same_org_new_epoch_rejects_late_procurement_revision_load
workspace_b_resume_pointer_is_not_changed_by_a_revision_transition
```

---

# 23. MATERIALIZATION PHẢI DÙNG ĐÚNG WORKSPACE

Nếu architecture chỉ giữ one active model state:

```text
late A response
→ do not materialize at all
```

Không cố mutate hidden captured A state nếu app không hỗ trợ.

User quay lại A:
- resume session;
- fetch revision lại;
- materialize lại an toàn/idempotent.

---

# 24. P1-4 — DURABLE SAVE SUCCESS NHƯNG `NEXT()` FAIL KHÔNG ĐƯỢC ROLLBACK DURABLE STEP

Current flow trong intermediate MSC gần:

```text
checkpoint RAM
→ update current plan/draft
→ savePlanVersionDraftSession()
    durable success
→ completeProcurementPlanImportRevision()
    → controller.saveCurrent()
    → controller.next()
    → network load next revision
→ if error:
    restore RAM checkpoint
```

Sai vì durable draft đã advance.

---

# 25. DURABILITY COMMIT POINT PHẢI RÕ

Sau:

```text
await savePlanVersionDraftSession(...)
```

thành công, current revision local draft đã durable.

Từ điểm đó:

```text
DO NOT rollback durable draft snapshot
```

chỉ vì next revision fetch thất bại.

---

# 26. TÁCH 2 PHASE

## Phase A — commit current revision locally

```text
collect current form
→ update draft aggregate
→ durable save
→ success
```

## Phase B — advance/load next revision

```text
advance controller
→ fetch next source revision
→ materialize next editor state
```

Phase B fail không được undo Phase A.

---

# 27. STATE SAU `NEXT()` FAILURE

Nếu next load fail:

Expected:

```text
durable draft = current revision đã save
controller index = current revision
controller state = WAITING_NEXT_CONFIRMATION or NEXT_LOAD_FAILED
UI = current revision still valid / show retry next
```

Retry:

```text
retry next load
```

Không re-save/duplicate current revision nếu không cần.

---

# 28. `SequentialRevisionController.next()` PHẢI TRANSACTIONAL

Current:

```js
this.currentIndex += 1;
return this.loadCurrent();
```

Nếu load fail:
- index đã advance;
- state có thể `EDITING_REVISION`;
- actual draft chưa load.

Fix tương đương:

```js
const previousIndex = this.currentIndex;

this.currentIndex += 1;

try {
  return await this.loadCurrent();
} catch (error) {
  this.currentIndex = previousIndex;
  this.state = "WAITING_NEXT_CONFIRMATION";
  throw error;
}
```

Hoặc state machine tốt hơn, nhưng semantics phải giữ.

---

# 29. `saveCurrent()` VÀ `afterRevisionSaved` CŨNG PHẢI AUDIT

Current:

```text
saveRevision()
→ state WAITING_NEXT_CONFIRMATION/COMPLETED
→ afterRevisionSaved()
```

Nếu `afterRevisionSaved()` fail:
- current revision thực tế đã save?
- state có rollback về EDITING_REVISION?

Phải phân biệt:
- pre-commit callback;
- post-commit notification.

Không để post-commit failure làm app tưởng current revision chưa save.

---

# 30. RECOMMENDED STATE MACHINE

Có thể dùng:

```text
READY
EDITING_REVISION
SAVING_REVISION
REVISION_SAVED
WAITING_NEXT_CONFIRMATION
LOADING_NEXT_REVISION
COMPLETED
CANCELLED
```

Không bắt buộc tên exact.

Điều quan trọng:

```text
durable commit point
```

phải có trạng thái riêng.

---

# 31. TESTS NEXT FAILURE / RETRY

```text
next_revision_network_failure_does_not_rollback_durable_current_revision
next_revision_network_failure_restores_controller_index
retry_next_after_network_failure_loads_same_next_revision_once
retry_next_does_not_duplicate_current_plan_version
retry_next_does_not_duplicate_package_snapshots
reload_after_next_load_failure_recovers_current_durable_revision
```

---

# 32. DURABLE SESSION REVISION KHÔNG ĐƯỢC LỆCH RAM

Test:

```text
durable_plan_draft_revision_and_memory_revision_remain_consistent_after_next_failure
```

Nếu durable envelope có:

```text
session.revision = 7
```

RAM không được rollback về `6`.

---

# 33. IMPORT RESUME POINTER

`ProcurementImportResumeStore` cần semantics:

```text
pointer = revision user should resume
```

Sau durable current save nhưng next fetch fail:

- pointer không được trỏ sai revision đã hoàn tất nếu resume logic sẽ duplicate;
- hoặc phải có explicit state.

Audit kỹ:

```text
rememberProcurementImportSession()
forgetProcurementImportSession()
resumeProcurementImportSession()
```

---

# 34. RESUME TESTS

```text
resume_after_current_revision_saved_but_next_load_failed_starts_at_next_unapplied_revision
resume_does_not_reapply_already_durable_current_revision
resume_pointer_is_workspace_scoped
```

---

# 35. NEW SESSION AFTER EARLIER REVISIONS IMPORTED

Commit `5202623...` đã lọc:

```text
ALREADY_IMPORTED
PROVENANCE_ONLY
```

khỏi `pending_revisions`.

Giữ behavior này.

Tests phải tiếp tục pass:

```text
plan_session_starts_at_new_revision_after_earlier_revision_was_imported
```

và thêm:

```text
persisted_00_then_new_session_with_01_02_starts_at_01
```

---

# 36. ĐỪNG NHẦM PLAN REVISION VỚI TBMT PACKAGE REVISION

Recent commit đã cố giữ:

```text
plan revision independent from linked TBMT revision
```

Phải tiếp tục giữ.

Ví dụ:

```text
plan revision 02
package linked TBMT version 00
```

không được tự đổi package `phienBan` thành `02`.

---

# 37. PACKAGE PROVENANCE INVARIANT

Package source revision nên có:
- plan source revision;
- package/TBMT source revision;
- stable package identity.

Không overwrite một loại bằng loại kia.

Test:

```text
plan_revision_02_with_tbmt_00_keeps_package_version_00
```

---

# 38. FINALIZE CHỈ Ở SOURCE REVISION CUỐI

Giữ:

```text
btn final save hidden khi hasNext()
```

và programmatic guard:

```text
PROCUREMENT_REVISIONS_REMAINING
```

Không chỉ dựa UI.

Test:

```text
programmatic_finalize_cannot_run_before_last_revision
```

---

# 39. PACKAGE EDITS PHẢI Ở DRAFT LANE

Giữ:

```text
isPackageDraftSaveActive(...)
```

Package edits trong active durable plan-version draft:
- memory/draft only;
- không `/api/sync`;
- chỉ final atomic endpoint ở cuối.

Tests cũ phải xanh.

---

# 40. SERVER FINALIZATION ATOMICITY KHÔNG ĐƯỢC PHÁ

Giữ transaction:

```text
SERIALIZABLE
```

và invariant:

```text
one invalid row
→ entire graph rollback
```

Không đổi lại per-record partial commit.

---

# 41. IMPORT PROVENANCE PHẢI CÙNG TRANSACTION

Plan/package records và:

```text
procurement_source_revision
source binding
session progress
```

phải commit nguyên tử.

Không:

```text
plan commit success
provenance fail
```

mà transaction vẫn thành công.

---

# 42. SESSION PROGRESS PHẢI PHẢN ÁNH COMMIT THẬT

Không mark revision `COMMITTED` trước entity transaction success.

Không advance `currentIndex` nếu transaction rollback.

---

# 43. IDEMPOTENCY

Giữ stable idempotency.

Scenario:

```text
server commit revision 01
response lost
client retry
```

Expected:

```text
no duplicate plan-01
no duplicate packages
same provenance
safe response
```

---

# 44. TEST LOST RESPONSE

```text
lost_response_after_revision_commit_retry_does_not_duplicate_revision
lost_response_after_final_atomic_commit_reload_does_not_duplicate_graph
```

---

# 45. CONCURRENT ACTOR TEST

Actor A:
- session based on plan-00.

Actor B:
- creates plan-01.

Actor A:
- tries old revision append.

Expected:

```text
PROCUREMENT_SOURCE_VERSION_CONFLICT
```

even if:

```text
rowVersion(plan-00) == rowVersion(plan-01)
```

---

# 46. IMPORT SESSION STATUS

Audit statuses:

```text
READY
EDITING_REVISION
WAITING_NEXT_CONFIRMATION
COMPLETED
PARTIAL
FAILED
CANCELLED
```

Backend/frontend naming may differ.

Không để:
- frontend complete nhưng backend still READY;
- backend currentIndex N+1 nhưng client currentIndex N;
- reload resume wrong revision.

---

# 47. CANCELLATION

Nếu user cancel giữa revision chain:
- durable draft policy giữ hiện tại;
- không accidentally finalize;
- không mutate another workspace;
- cancellation request workspace-scoped.

Không thay business behavior trừ khi cần fix correctness.

---

# 48. CLOSE MODAL / DISCARD

Recent logic discard imported plan draft khi close import without preserve.

Không được làm:
- remove wrong draft session;
- restore wrong workspace;
- resurrect discarded draft via stale multi-tab write.

Giữ revision/tombstone semantics.

---

# 49. SAME-ORG EPOCH TEST CHO CLOSE/CANCEL NẾU ĐỤNG CODE

Nếu sửa close/import orchestration, thêm test:

```text
same_org_new_epoch_cannot_discard_previous_epoch_import_draft
```

nếu cần.

---

# 50. KHÔNG REGRESSION PLAN DRAFT FINALIZATION

Giữ xanh:

```text
workspace_change_during_plan_draft_finalize_cannot_mutate_new_workspace
```

và các equivalent:
- rowVersions;
- sync cursor;
- draft cleanup;
- force pull.

---

# 51. KHÔNG REGRESSION MULTI-TAB PLAN DRAFT

Giữ:

```text
concurrent_tabs_preserve_distinct_drafts_and_reject_stale_same_draft_writes
concurrent_remove_and_stale_save_cannot_resurrect_a_draft_after_reload
```

---

# 52. KHÔNG REGRESSION INTERMEDIATE DURABILITY

Giữ:

```text
initial_plan_draft_storage_failure_rolls_back_ephemeral_plan
intermediate_version_storage_failure_rolls_back_all_in_memory_changes
```

và các equivalent hiện có.

---

# 53. KHÔNG REGRESSION SHARED REFERENCES

Giữ:
- server-backed clean investor/expert/contractor không được resend;
- stale draft shared ref không overwrite authoritative pull;
- local new shared ref vẫn recover được.

---

# 54. KHÔNG REGRESSION EXACT OUTBOX ACK

Bắt buộc giữ:

```text
unsendable_patch_is_not_in_receipt
mixed_batch_success_does_not_ack_patch_missing_canonical_record
patch_missing_canonical_survives_multiple_successful_unrelated_syncs
patch_becomes_sendable_after_canonical_hydration_and_is_then_acknowledged
newer_patch_generation_is_not_acked_by_older_materialized_receipt
```

---

# 55. KHÔNG REGRESSION RAW PENDING VS SENDABLE

Giữ:

```text
pending durable patch
!=
sendable mutation
```

UI không báo settled khi durable mutation còn pending.

---

# 56. KHÔNG REGRESSION STARTUP CONFLICT

Giữ recent fix:

```text
manual retry cannot resubmit a batch after startup entered conflict
```

F5 boundary phải còn đúng.

---

# 57. KHÔNG REGRESSION WORKSPACE PUSH/PULL

Giữ tất cả race tests hiện có, tối thiểu:

```text
workspace_change_during_outbox_flush_cannot_start_auto_sync_for_new_workspace
workspace_change_during_outbox_flush_failure_cannot_set_storage_error_on_new_workspace
late_success_response_from_workspace_a_cannot_clear_workspace_b_outbox
same_org_new_epoch_rejects_late_push_completion
same_org_new_epoch_rejects_late_pull_completion
background_render_scheduled_in_workspace_a_does_not_render_after_switch_to_b
workspace_change_during_pull_persistence_cannot_reapply_new_workspace_plan_drafts
```

---

# 58. KHÔNG REGRESSION DRAFT HSDT

Giữ:
- authority boundary before mutation;
- re-resolve latest package;
- no historical write;
- same-org epoch safe;
- partial patch semantics.

---

# 59. KHÔNG REGRESSION PACKAGE VERSION

Giữ:
- status;
- assignment;
- children;
- historical immutability;
- offline completeness;
- reconnect idempotency.

---

# 60. TEST-FIRST BẮT BUỘC

Với mỗi issue `CONFIRMED`:

```text
1. tạo failing test deterministic
2. chạy test
3. ghi BEFORE FIX = FAIL
4. implement minimal safe fix
5. chạy lại
6. AFTER FIX = PASS
7. chạy neighboring suites
8. chạy full suites
9. regression review lần 2
```

Không implementation-first.

---

# 61. TARGETED JS TESTS

Chạy tối thiểu:

```bash
node --test --test-concurrency=1 tests/js/procurement_import_wizard.test.mjs
node --test --test-concurrency=1 tests/js/plan_breakdown_draft_transaction.test.mjs
node --test --test-concurrency=1 tests/js/plan_version_draft_session.test.mjs
node --test --test-concurrency=1 tests/js/sync_conflict_recovery.test.mjs
node --test --test-concurrency=1 tests/js/sync_pull_ordering.test.mjs
node --test --test-concurrency=1 tests/js/sync_status.test.mjs
node --test --test-concurrency=1 tests/js/outbox_durability.test.mjs
node --test --test-concurrency=1 tests/js/package_preparation_authority.test.mjs
```

Nếu filename thay đổi, dùng canonical equivalent.

---

# 62. TARGETED PYTHON TESTS

```bash
python -m pytest -q tests/test_procurement_import_service.py
python -m pytest -q tests/test_procurement_import_sync_binding.py
python -m pytest -q tests/test_plan_draft_finalize.py
```

Nếu có file riêng cho repository/session, chạy thêm.

---

# 63. NEW TEST MATRIX TỐI THIỂU

## Predecessor progression

```text
persisted_00_then_pending_01_02_commits_in_sequence
persisted_00_then_01_02_03_advances_predecessor_each_step
revision_02_does_not_reuse_initial_00_expected_row_version
reload_after_revision_01_uses_plan_01_predecessor
```

## Identity conflict

```text
same_row_version_but_different_latest_plan_is_rejected
wrong_root_with_matching_row_version_is_rejected
stale_session_cannot_append_after_concurrent_new_latest
```

## Workspace

```text
workspace_change_during_next_revision_load_cannot_materialize_into_b
same_org_new_epoch_rejects_late_procurement_revision_load
late_a_revision_response_cannot_change_b_resume_pointer
```

## Failure/retry

```text
next_revision_network_failure_does_not_rollback_durable_current_revision
next_revision_network_failure_restores_controller_index
retry_next_loads_same_revision_once
retry_next_does_not_duplicate_current_version
reload_after_next_load_failure_resumes_next_unapplied_revision
```

---

# 64. FULL JS COVERAGE

```bash
npm run test:js:coverage
```

Không hạ threshold.

---

# 65. FULL PYTHON

```bash
python -m pytest -q \
  --cov=backend \
  --cov-branch \
  --cov-report=term \
  --cov-report=json:coverage.json \
  --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
```

---

# 66. STATIC / SECURE BUILD

```bash
npm run check:static
npm run build:secure
```

---

# 67. E2E

```bash
npm run test:e2e:smoke
```

Giữ:
- Chromium;
- Firefox;
- WebKit.

Không skip browser.

---

# 68. E2E NÊN BỔ SUNG

Nếu infra cho phép:

```text
existing server 00
→ MSC import 01
→ save
→ MSC 02
→ save
→ success
```

```text
switch workspace while next revision request pending
→ B unchanged
```

```text
network fail loading 02 after 01 durable save
→ retry
→ 02 loads exactly once
```

---

# 69. PERFORMANCE

```bash
npm run test:performance
```

Không fix bằng:
- full DB hydrate;
- full source lookup lại sau mỗi local step nếu không cần;
- global serialization;
- expensive deep clone toàn app sau mỗi input.

---

# 70. SERVER PREDECESSOR LOOKUP NÊN BOUNDED

Query theo:
- organization;
- family;
- expected predecessor/provenance;

và lock đúng record.

Không scan toàn history không index.

---

# 71. PREVIEW/SESSION SOURCE OF TRUTH

Audit:

```text
preview
import session
canonicalBundle
revision manifest
provenance table
local latest plan
```

Xác định field nào authoritative ở từng phase.

Document trong code/test để tránh lại dùng stale `canonicalBundle.plan.expectedRowVersion`.

---

# 72. RECOMMENDED AUTHORITATIVE MODEL

Ví dụ:

```text
Initial:
session.basePredecessor = existing latest plan

After each committed revision:
provenance gives exact local snapshot created for that source revision

Next revision predecessor:
previous committed source revision's local snapshot
```

Không cần mutate `canonicalBundle` nếu provenance đủ.

---

# 73. FINAL ATOMIC NEW-PLAN CHAIN

Đối với case hoàn toàn new plan:

```text
server has no 00
draft contains 00,01,02
finalize once atomically
```

không áp dụng predecessor persisted chain logic sai cách.

Phân biệt rõ:

```text
NEW PLAN ATOMIC DRAFT
vs
EXTEND EXISTING PERSISTED PLAN
```

---

# 74. TEST HAI MODE RIÊNG

```text
new_plan_00_01_02_finalizes_atomically
existing_00_then_01_02_uses_predecessor_chain
```

Không dùng một validation branch cho hai semantics nếu khác bản chất.

---

# 75. EXISTING 00 + NEW 01 KHÔNG ĐƯỢC TẠO NEW-PLAN DRAFT

Giữ recent invariant:

```text
persisted 00 + new 01
→ normal optimistic aggregate-version save
```

nếu đó là intended architecture hiện tại.

Nhưng nếu sequence có 01,02 cùng session:
- phải bảo đảm 01 commit;
- 02 dùng predecessor 01.

---

# 76. ĐỪNG FINALIZE TOÀN CHUỖI EXISTING-PLAN NHƯ NEW-PLAN

Backend `validate_plan_draft_finalize()` hiện reject already persisted rows.

Giữ distinction đúng.

Không nhét persisted 00 vào new-plan atomic graph để né predecessor bug.

---

# 77. PACKAGE VERSION INHERITANCE TRONG EXISTING-PLAN CHAIN

Revision plan mới không tự động tạo package version nếu TBMT revision không đổi.

Giữ recent tests.

---

# 78. PROVENANCE COMMIT ORDER

Nếu revision chain server-side commit từng revision:

```text
01 entity commit
→ 01 provenance commit
→ session progress 01 committed
→ predecessor for 02 becomes 01
```

Tất cả trong transaction phù hợp.

---

# 79. FAILED REVISION 02

Nếu 02 conflict:
- 01 vẫn committed;
- session resume at 02;
- không rollback 01;
- no duplicate 01 on retry.

Test:

```text
revision_02_conflict_does_not_rollback_committed_01
```

---

# 80. PREDECESSOR CONFLICT UX

Frontend nên surface canonical conflict.

Không loop retry tự động vô hạn.

Không silently refresh và overwrite user edits.

---

# 81. STARTUP/RELOAD SAU CONFLICT

Nếu import session còn active:
- resume correctly;
- no stale cross-workspace materialization;
- existing normal sync conflict recovery vẫn giữ F5 semantics riêng.

Không trộn hai conflict mechanisms nếu không cần.

---

# 82. `currentIndex` BACKEND VS FRONTEND

Sau mỗi boundary test:

```text
backend session.currentIndex
frontend SequentialRevisionController.currentIndex
resume pointer revisionNumber
durable plan draft currentVersionId
```

phải nhất quán.

---

# 83. FAILURE MATRIX

Bắt buộc review:

```text
save current draft fails
save current draft succeeds, next network fails
next response succeeds, materialization fails
materialization succeeds, UI render fails
workspace switches before next request
workspace switches during next request
workspace switches after response before materialization
server commit succeeds, response lost
server conflict due concurrent actor
IndexedDB write fails
```

Không chỉ happy-path.

---

# 84. UI RENDER FAILURE

Nếu materialization/durable state đã thành công nhưng render fail:
- không rollback durable data;
- allow re-render/reopen.

Không coi UI exception là persistence rollback reason.

---

# 85. OUTBOX LANE

MSC plan draft/package draft edits không được vô tình stage outbox trước finalization nếu current intended architecture dùng plan draft lane.

Audit `persistPackageFormChanges`.

---

# 86. NO DUPLICATE IDS

Retry/resume không tạo:
- duplicate plan root;
- duplicate plan version;
- duplicate package snapshot;
- duplicate assignment;
- duplicate goods child.

---

# 87. STABLE ID / SOURCE IDENTITY

Nếu local IDs được generate lại khi retry, provenance/idempotency phải ngăn duplicate server rows.

Tốt hơn reuse durable local IDs khi resume.

Test nếu chưa có.

---

# 88. REGRESSION REVIEW LẦN 2 — BẮT BUỘC

Sau khi toàn bộ tests xanh, review lại:

```text
backend/procurement_import/session.py
backend/procurement_import/sync_binding.py
backend/procurement_import/service.py
backend/procurement_import/repository.py
backend/plan_drafts/finalize.py
backend/sync/service.py

frontend/procurement/PlanImportWizard.js
frontend/procurement/SequentialRevisionController.js
frontend/procurement/ProcurementImportResume.js
frontend/procurement/ProcurementDraftWorkflow.js
frontend/plans/KeHoachWorkflow.js
frontend/plans/PlanVersionDraftSession.js
frontend/app/workspaceLease.js
frontend/app/SyncCoordinator.js
frontend/app/SyncPullService.js
```

Câu hỏi:

```text
Patch vừa thêm có tạo race/data-loss/duplicate/version regression mới không?
```

---

# 89. ACCEPTANCE — PREDECESSOR

- [ ] revision 01 targets persisted 00;
- [ ] revision 02 targets committed 01;
- [ ] revision 03 targets committed 02;
- [ ] no stale initial rowVersion reuse;
- [ ] predecessor ID checked;
- [ ] predecessor root checked;
- [ ] predecessor rowVersion checked;
- [ ] same rowVersion/different record rejected;
- [ ] concurrent latest creation rejected safely.

---

# 90. ACCEPTANCE — WORKSPACE

- [ ] next revision request bound to original workspace;
- [ ] late A response cannot mutate B;
- [ ] same-org new epoch protected;
- [ ] B resume pointer unchanged;
- [ ] B draft session unchanged;
- [ ] B plan/package tables unchanged.

---

# 91. ACCEPTANCE — RETRY STATE

- [ ] durable current revision not rolled back because next load fails;
- [ ] controller index restored on next-load failure;
- [ ] retry loads same next revision;
- [ ] current revision not duplicated;
- [ ] package snapshots not duplicated;
- [ ] reload resumes correct next unapplied revision.

---

# 92. ACCEPTANCE — NO NEW REGRESSION

- [ ] plan draft finalization workspace tests pass;
- [ ] intermediate durability tests pass;
- [ ] multi-tab draft tests pass;
- [ ] shared reference tests pass;
- [ ] outbox exact receipt tests pass;
- [ ] sync workspace race tests pass;
- [ ] startup conflict tests pass;
- [ ] Draft HSDT tests pass;
- [ ] package version tests pass;
- [ ] JS coverage pass;
- [ ] Python coverage pass;
- [ ] static checks pass;
- [ ] secure build pass;
- [ ] Chromium pass;
- [ ] Firefox pass;
- [ ] WebKit pass;
- [ ] performance budget unchanged;
- [ ] second regression review finds no new correctness issue.

---

# 93. KHÔNG GHI PASS NẾU CHƯA CHẠY

Final report chỉ dùng:

```text
PASS
FAIL
NOT RUN
BLOCKED BY ENVIRONMENT
```

Không:

```text
should pass
likely pass
looks good
```

---

# 94. COMMAND RESULTS BẮT BUỘC

Report:

```text
procurement_import_wizard targeted          PASS/FAIL
plan_breakdown_draft_transaction targeted  PASS/FAIL
plan_version_draft_session targeted        PASS/FAIL
procurement_import_service targeted        PASS/FAIL
procurement_import_sync_binding targeted   PASS/FAIL
plan_draft_finalize targeted               PASS/FAIL

npm run test:js:coverage                    PASS/FAIL
pytest full                                 PASS/FAIL
npm run check:static                        PASS/FAIL
npm run build:secure                        PASS/FAIL
npm run test:e2e:smoke                     PASS/FAIL
npm run test:performance                    PASS/FAIL
```

---

# 95. CI

Sau commit cuối:

```text
END_HEAD=
```

Kiểm tra CI.

Nếu không có result:

```text
CI STATUS NOT YET AVAILABLE
```

Không đoán.

---

# 96. BRANCH PROTECTION

Không cần tự bật nếu user chưa yêu cầu.

Nhưng không coi local green = protected release.

---

# 97. COMMIT STRATEGY

Ưu tiên patch nhỏ:

```text
fix(procurement): advance authoritative plan predecessor per revision
fix(procurement): validate predecessor identity, root and row version
fix(procurement): guard revision transitions by workspace lease
fix(procurement): make next-revision load retry-safe after durable save
test(procurement): add revision-chain concurrency and workspace regressions
```

Không gom thành refactor lớn.

---

# 98. FINAL REPORT FORMAT

```text
START_HEAD:
END_HEAD:
```

Issue matrix:

| Issue | Before | Status | Root cause | Fix | Test |
|---|---|---|---|---|---|

Status:

```text
FIXED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
BLOCKED BY ENVIRONMENT
```

Files:

| File | Change | Why |
|---|---|---|

Tests:

| Test | Before | After | Protected invariant |
|---|---:|---:|---|

---

# 99. QUESTIONS BẮT BUỘC TRƯỚC KHI DONE

Trả lời bằng code/test evidence:

```text
1. Revision 02 còn có thể dùng expectedRowVersion của 00 không?
2. Predecessor khác ID nhưng cùng rowVersion có lọt không?
3. Predecessor khác root nhưng cùng rowVersion có lọt không?
4. Concurrent actor tạo latest mới có bị phát hiện không?
5. A→B trong lúc next() pending có thể materialize vào B không?
6. Same-org A@1→A@2 có reject late response không?
7. Durable revision hiện tại có bị rollback khi next fetch fail không?
8. currentIndex có quay lại đúng revision sau next failure không?
9. Retry có duplicate current version/package không?
10. Reload có resume đúng next unapplied revision không?
11. Existing 00 + 01 + 02 có chạy hết không?
12. New-plan 00→01→02 atomic flow có còn chạy không?
13. Linked TBMT package version có bị đồng nhất sai theo plan revision không?
14. Package edit có lọt vào /api/sync sớm không?
15. Outbox exact ACK có regress không?
16. Startup conflict/F5 boundary có regress không?
17. Có test/coverage/performance/security nào bị weaken không?
```

Nếu 1–12 chưa an toàn thì chưa DONE.

---

# 100. INVARIANTS CUỐI

```text
EVERY MSC PLAN REVISION MUST TARGET
THE EXACT IMMEDIATELY-PREVIOUS AUTHORITATIVE PLAN SNAPSHOT.
```

```text
ROWVERSION ALONE IS NOT A PREDECESSOR IDENTITY.
```

```text
NO LATE REVISION RESPONSE MAY MATERIALIZE INTO
A DIFFERENT WORKSPACE OR WORKSPACE EPOCH.
```

```text
ONCE THE CURRENT REVISION IS DURABLY SAVED,
FAILURE TO LOAD THE NEXT REVISION MUST NOT ROLLBACK THAT DURABLE SAVE.
```

```text
RETRY/RELOAD MUST NEVER DUPLICATE A COMMITTED OR DURABLE REVISION.
```

---

# 101. FINAL INSTRUCTION — NHẤN MẠNH

**Trong quá trình sửa, tuyệt đối không được làm phát sinh lỗi mới.**

Không chỉ sửa 4 bug hiện tại.

Phải thực hiện:

```text
fetch latest HEAD
→ compare
→ reproduce
→ failing tests
→ minimal safe fix
→ targeted tests
→ neighboring regressions
→ full suites
→ E2E 3 browsers
→ performance
→ regression review lần 2
→ CI status
```

Chỉ coi DONE khi:
- predecessor progression đúng;
- predecessor identity đúng;
- workspace isolation đúng;
- retry/reload state đúng;
- không duplicate;
- không rollback durable data;
- toàn bộ regression cũ vẫn xanh;
- không hạ bất kỳ quality gate nào;
- exact START_HEAD / END_HEAD / commands / results được báo cáo.
