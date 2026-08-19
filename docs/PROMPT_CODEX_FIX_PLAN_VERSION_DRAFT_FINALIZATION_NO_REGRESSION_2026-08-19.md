# PROMPT CODEX — FIX TRIỆT ĐỂ PLAN VERSION DRAFT FINALIZATION, WORKSPACE ISOLATION & DURABILITY — KHÔNG PHÁT SINH LỖI MỚI

## Repository

```text
https://github.com/newstar94/Bidding
```

HEAD đã được rà soát gần nhất:

```text
b89c60041e8913499e3d8cff56c54909537de5b4
```

Commit:

```text
Add tests for plan version draft session finalization
```

Parent:

```text
d1750f8724e03eb155c0b744c5f4ad4f2ea0c5d3
```

Các commit sau `3327a16...` đã cải thiện đáng kể:
- exact outbox receipt/ACK;
- unsendable partial patches;
- legacy outbox `patches={}`;
- raw pending vs sendable sync state;
- Draft HSDT re-resolve latest package;
- delayed recovery snapshot workspace isolation;
- row-version conflict quarantine;
- plan version draft session;
- atomic server finalization bằng `SERIALIZABLE`.

**Không được làm regress bất kỳ fix nào trong các phần trên.**

---

# 0. MỤC TIÊU

Sửa triệt để các vấn đề còn lại trong subsystem:

```text
Plan Version Draft Session
→ intermediate local versions
→ durable draft persistence
→ authoritative pull/reapply
→ final atomic POST
→ canonical response apply
→ cleanup
```

Các lỗi/rủi ro cần xử lý:

## P0-1 — WORKSPACE CROSS-CONTAMINATION TRONG FINALIZATION

`finalizePlanVersionDraft()` chưa capture và verify workspace capability qua `await send(...)`.

Race:

```text
Finalize plan draft ở workspace A
→ request đang pending
→ switch A → B
→ response A về
→ apply rowVersions vào model/state B
→ ghi bf_last_sync_version vào storage B
→ remove draft session trong B
```

Đây là lỗi workspace isolation nghiêm trọng.

## P1-2 — INTERMEDIATE VERSION KHÔNG TRANSACTIONAL VỚI DURABLE DRAFT

`saveIntermediatePlanVersion()` mutate:
- `state.kehoach`;
- `isLatest`;
- package snapshots;
- child rows;
- assignments;
- selected version;

rồi mới:

```text
await savePlanVersionDraftSession(...)
```

Nếu IndexedDB write fail thì UI đã ở version mới nhưng draft durable không tồn tại. F5 có thể làm mất dữ liệu người dùng.

## P1-3 — REAPPLY DRAFT CÓ THỂ GHI ĐÈ SHARED SERVER REFERENCES

`reapplyPlanVersionDraftSessions()` hiện overlay mọi table trong:

```text
chudautu
chuyengia
nhathau
kehoach
goithau
goithauhanghoa
thongtinmothau
hanghoaduthaunhathau
assignments
```

Sau authoritative pull, draft snapshot cũ của `chudautu/chuyengia/nhathau` có thể overwrite record server mới trong local state.

Phải tách:

```text
draft-owned aggregate rows
vs
shared server-owned/reference rows
```

## P1-4 — PULL REAPPLY DRAFT CHƯA WORKSPACE-SAFE

Trong `SyncPullService.js` hiện flow gần:

```text
await persistencePromise
→ await reapplyPlanVersionDraftSessions(this.model)
→ if (!pullIsCurrent()) stale
```

Workspace guard nằm sau reapply. A pull có thể resume sau switch A→B và tác động plan draft session của B.

## P1-5 — MULTI-TAB LOST UPDATE

Plan draft persistence hiện dùng:

```text
db.set(PLAN_VERSION_DRAFT_STORAGE_KEY, fullEnvelope)
```

Hai tab cùng workspace có thể overwrite nhau:

```text
A writes [draft A]
B writes [draft B]
→ draft A lost
```

`BrowserDB.update()` đã tồn tại và nên được tận dụng cho atomic read-modify-write.

## P2/P1-6 — FRONTEND/BACKEND VALIDATION DRIFT

Frontend và backend không hoàn toàn cùng contract với:
- malformed `phienBan`;
- assignment type;
- root/identity;
- already persisted checks;
- version continuity.

Không được để frontend báo valid rồi server từ chối vì validator drift có thể tránh được.

---

# 1. NGUYÊN TẮC CAO NHẤT — KHÔNG ĐƯỢC SINH LỖI MỚI

Đây là yêu cầu bắt buộc.

Không sửa theo kiểu:

```text
fix test mới
→ commit
→ mặc kệ regression
```

Mọi thay đổi phải bảo toàn:

```text
1. data integrity
2. workspace/tenant isolation
3. draft durability
4. server atomicity
5. version immutability
6. outbox correctness
7. startup reconciliation
8. offline behavior
9. performance
10. UX
```

Với mỗi patch, Codex phải tự audit:

```text
Fix này có thể:
- ghi dữ liệu A vào B không?
- clear draft B do response A không?
- update cursor B từ response A không?
- mất local draft khi IndexedDB fail không?
- resurrect stale shared reference không?
- overwrite server truth sau pull không?
- mất draft ở multi-tab không?
- duplicate version khi retry không?
- mutate historical version không?
- phá idempotency không?
- phá exact outbox ACK không?
- phá offline package version không?
- làm startup blocking không?
```

Nếu có khả năng, chưa được coi là DONE.

---

# 2. XÁC ĐỊNH HEAD THỰC TẾ TRƯỚC KHI LÀM

Bắt buộc:

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

Không mặc định `b89c60041e8913499e3d8cff56c54909537de5b4` vẫn là HEAD.

Nếu HEAD mới hơn:
1. compare từ `b89c600...` đến HEAD;
2. re-evaluate toàn bộ issue;
3. không patch issue đã được sửa;
4. phân loại `CONFIRMED / ALREADY FIXED / NOT REPRODUCED / RISK ONLY`.

---

# 3. CẤM TUYỆT ĐỐI

Không được:
- hạ coverage;
- tăng performance budget;
- `test.skip()`;
- bỏ Chromium/Firefox/WebKit;
- disable offline;
- disable IndexedDB durability;
- remove plan draft persistence;
- bắt user online để né lỗi local durability;
- clear draft trước server ACK;
- clear draft khi workspace đã đổi;
- apply response vào current model nếu request thuộc workspace khác;
- dùng `organizationId` duy nhất để nhận diện workspace;
- bỏ workspace epoch;
- dùng magic timeout/delay để né race;
- global lock toàn app;
- full-sync toàn DB trước mọi action;
- mutate historical version;
- weaken RBAC;
- weaken rowVersion;
- bypass idempotency;
- giảm validation;
- dùng `catch {}` để nuốt durability error;
- sửa test expectation để hợp với bug;
- rewrite toàn architecture nếu không cần.

---

# 4. P0 — FINALIZE PLAN DRAFT PHẢI DÙNG WORKSPACE CAPABILITY

Đọc kỹ:

```text
frontend/plans/PlanVersionDraftSession.js
frontend/plans/KeHoachWorkflow.js
frontend/app/SyncWorkspaceContext.js
frontend/app/workspaceLease.js
frontend/app/BiddingModel.js
frontend/app/SyncPushService.js
frontend/app/SyncPullService.js
```

Tham khảo pattern workspace-safe hiện đã tồn tại trong repo.

## Contract bắt buộc

```text
capture workspace capability
→ capture exact model resources
→ persist draft A
→ verify A still current
→ build payload from captured A resources
→ send request A
→ await response
→ verify A still current
→ apply response only to A resources
→ verify A still current
→ remove draft A only
→ finish
```

Invariant:

```text
A response MUST NEVER mutate B.
```

Capture tối thiểu:

```text
workspace token
organizationId
workspace key
workspaceStorage
db
state reference
planVersionDraftSessions/draft-store capability
```

Nếu repo có canonical helper như `captureWorkspace()`, `beginWorkspaceRequest()`, `beginWorkspaceMutation()`, workspace lease thì reuse. Không tạo cơ chế song song.

## Recheck sau mọi await

Các boundary:

```text
savePlanVersionDraftSession()
send(...)
applyCommittedRowVersions(...)
removePlanVersionDraftSession()
```

Nếu workspace đổi, trả structured stale result hoặc canonical abort error:

```javascript
{
  ok: false,
  stale: true,
  workspaceChanged: true,
  code: "WORKSPACE_CHANGED"
}
```

Không:
- alert success ở B;
- close modal B;
- forceSync B vì A vừa commit;
- remove B draft.

## Server đã commit nhưng client chuyển workspace

Nếu A server commit thành công nhưng UI đã ở B:
- không apply A response lên B;
- không update cursor B;
- không xóa B draft;
- khi quay lại A, authoritative pull phải tự phát hiện rows đã commit và cleanup draft A an toàn;
- không duplicate finalize.

## Tests P0 bắt buộc

```text
workspace_change_during_plan_draft_finalize_cannot_apply_row_versions_to_new_workspace
workspace_change_during_plan_draft_finalize_cannot_update_new_workspace_sync_cursor
workspace_change_during_plan_draft_finalize_cannot_remove_new_workspace_draft_session
workspace_change_after_server_commit_returns_stale_without_mutating_new_workspace
same_org_new_epoch_rejects_late_plan_draft_finalize_response
workspace_b_does_not_reuse_workspace_a_finalize_promise_or_session
late_finalize_success_from_a_cannot_close_or_show_success_in_workspace_b
workspace_change_after_finalize_before_force_pull_does_not_pull_new_workspace
stale_finalize_result_does_not_clear_new_workspace_plan_edit_state
```

---

# 5. P1 — INTERMEDIATE SAVE PHẢI TRANSACTIONAL Ở CLIENT

Đọc:

```text
frontend/plans/KeHoachWorkflow.js
frontend/plans/PlanVersionDraftSession.js
frontend/plans/planAggregateSnapshot.js
frontend/plans/planBreakdownDraft.js
```

Current risk:

```text
mutate state
→ then persist draft
```

Nếu persistence fail:

```text
RAM != durable state
```

## Invariant

Khi user bấm `Lưu phiên bản nháp`:

```text
Promise success => RAM state == durable draft snapshot
```

Nếu durable write fail:

```text
RAM MUST rollback
```

Không được để half-created:
- plan version;
- package snapshots;
- child rows;
- assignments;
- selected version;
- tempPlanData;
- planBreakdownDraft.planId.

## Checkpoint trước mutation

Capture targeted state:

```text
kehoach
goithau
goithauhanghoa
thongtinmothau
hanghoaduthaunhathau
assignments
selectedPlanVersion
selectedPackageVersion
selectedPackageVersionIntent
planVersionDraftSessions
tempPlanData
tempPlanAction
planBreakdownDraft relevant state
```

Nếu draft persist fail:
- restore checkpoint;
- invalidate entity indexes;
- render lại UI;
- giữ original session intact.

## `savePlanVersionDraftSession()` cũng phải transactional

Không publish memory state trước durability success.

Ưu tiên:

```text
prepare next envelope
→ durable write
→ publish memory state only after success
```

Hoặc checkpoint + rollback.

## Initial plan 00

Plan `00` cũng không được tồn tại như saved draft nếu persistence fail.

Retry không được tạo duplicate root.

## Tests durability

```text
intermediate_version_storage_failure_rolls_back_all_in_memory_changes
failed_intermediate_save_restores_latest_flags
failed_intermediate_save_restores_package_and_child_counts
failed_intermediate_save_restores_assignments
failed_intermediate_save_restores_selected_version
failed_intermediate_save_does_not_advance_currentVersionId
initial_plan_draft_storage_failure_does_not_leave_ephemeral_plan
retry_after_storage_recovery_creates_exactly_one_new_version
successful_intermediate_save_is_recoverable_after_reload
offline_finalization_keeps_entire_draft_chain_durable
```

---

# 6. P1 — DRAFT-OWNED VS SHARED REFERENCE DATA

`PLAN_VERSION_DRAFT_TABLES` chứa shared references:

```text
chudautu
chuyengia
nhathau
```

Phải xác định ownership rõ.

Draft-owned thường là:

```text
kehoach
goithau
goithauhanghoa
thongtinmothau
hanghoaduthaunhathau
draft-created assignments
```

Shared references thường là:

```text
chudautu
chuyengia
nhathau
```

Shared server-backed records không được bị stale draft snapshot overwrite sau pull.

Nếu `rowVersion > 0` và record không dirty:

```text
SERVER TRUTH WINS
```

Draft chỉ reapply shared row khi:
- record local mới chưa persist;
- hoặc dirty rõ ràng và business rules cho phép.

## Final payload shared rows

Audit `changedRelatedRows()`:

```text
rowVersion > 0 && not dirty -> do not send
rowVersion <= 0 -> new local entity may send
rowVersion > 0 && dirty -> normal RBAC + expected rowVersion
```

## Tests

```text
authoritative_pull_newer_expert_is_not_overwritten_by_plan_draft_reapply
authoritative_pull_newer_investor_is_not_overwritten_by_plan_draft_reapply
authoritative_pull_newer_contractor_is_not_overwritten_by_plan_draft_reapply
new_local_shared_reference_created_by_draft_is_reapplied_after_reload
unchanged_server_backed_shared_reference_is_not_sent_in_finalize_payload
explicitly_dirty_shared_reference_preserves_expected_row_version
```

---

# 7. P1 — PULL REAPPLY PHẢI WORKSPACE-SAFE

Current sequence cần sửa:

```text
await persistencePromise
await reapplyPlanVersionDraftSessions(this.model)
if (!pullIsCurrent()) return stale
```

Tối thiểu:

```text
await persistencePromise
if (!pullIsCurrent()) return stale
await reapplyPlanVersionDraftSessions(...captured workspace resources...)
if (!pullIsCurrent()) return stale
```

Tốt hơn: reapply trực tiếp trên captured state/db capability, không đọc live resources của workspace mới.

Tests:

```text
workspace_change_during_pull_persistence_cannot_reapply_new_workspace_plan_drafts
workspace_change_before_plan_draft_cleanup_cannot_remove_new_workspace_session
same_org_new_epoch_pull_cannot_reapply_old_epoch_plan_drafts
late_pull_from_a_cannot_overlay_plan_draft_rows_into_b
```

---

# 8. P1 — MULTI-TAB ATOMIC PERSISTENCE

Đọc:

```text
frontend/app/BrowserDB.js
frontend/plans/PlanVersionDraftSession.js
```

`BrowserDB.update(key, updater)` đã có atomic read-modify-write.

Không dùng stale full-envelope `set()` cho save/remove session.

## Contract

```text
save session X
→ db.update(key, current => merge X)

remove session X
→ db.update(key, current => remove X)
```

Envelope nên có:
- schema version;
- sessions;
- per-session revision hoặc equivalent deterministic concurrency metadata.

## Same draft concurrent edit

Phải có semantics rõ:
- monotonic revision;
- stale revision không overwrite newer revision;
- remove/save race không resurrect stale session.

Tests:

```text
concurrent_tabs_preserve_two_distinct_plan_draft_sessions
concurrent_save_of_different_drafts_does_not_lose_session
newer_same_draft_revision_wins_deterministically
stale_same_draft_revision_cannot_overwrite_newer_snapshot
concurrent_remove_and_save_does_not_resurrect_stale_session
reload_after_concurrent_updates_recovers_complete_envelope
```

---

# 9. P2/P1 — ALIGN FRONTEND/BACKEND VALIDATION

Đọc:

```text
frontend/plans/PlanVersionDraftSession.js
backend/plan_drafts/finalize.py
backend/sync/record_validator.py
```

Rule phải thống nhất:

```text
draftId required
clientMutationId required
rootId required
version >= 0
version contiguous from 00
unique versions
unique IDs
new plan rowVersion must be 0/unset
new package rowVersion must be 0/unset
package belongs to draft plan chain
child belongs to package graph
assignment type recognized
assignment target valid
deletions forbidden
already-persisted graph forbidden
```

Malformed version như `"abc"`, negative, invalid null không được frontend coerce thành `0` rồi cho qua.

Nếu display cần tolerant parser, tách display parser khỏi strict validator.

Allowed assignment type:

```text
kehoach
goithau
```

Unknown type phải reject.

Tests:

```text
frontend_rejects_non_numeric_plan_version
frontend_rejects_negative_plan_version
frontend_rejects_unknown_assignment_type
frontend_and_backend_accept_same_valid_graph
frontend_and_backend_reject_same_invalid_graph_cases
```

---

# 10. SERVER ATOMICITY / IDEMPOTENCY KHÔNG ĐƯỢC PHÁ

Giữ:

```text
BEGIN ISOLATION LEVEL SERIALIZABLE
```

cho `finalize_draft_command`.

Invariant:

```text
one invalid row -> zero rows committed from graph
```

Không đưa per-record savepoint vào atomic finalization.

`finalizeMutationId` phải ổn định cho retry cùng payload.

Tests:

```text
network_timeout_after_server_commit_retry_is_idempotent
retry_same_payload_returns_same_finalize_result
mutated_draft_after_failed_precommit_attempt_uses_correct_idempotency_semantics
reload_after_server_commit_but_before_client_ack_does_not_duplicate_finalize
two_concurrent_finalize_requests_for_same_draft_do_not_duplicate_graph
```

---

# 11. BACKEND HISTORICAL IMMUTABILITY / RBAC

`allow_new_historical_parents=finalize_draft_command` chỉ được cho phép với NEW rows trong cùng graph.

Không được cho phép sửa historical row đã persist.

Tests:

```text
finalize_draft_cannot_modify_existing_historical_plan
finalize_draft_cannot_modify_existing_historical_package
```

Giữ:
- tenant isolation;
- record write authorization;
- assignment authorization;
- protected-media rules;
- rowVersion validation.

---

# 12. KHÔNG REGRESSION EXACT OUTBOX RECEIPT

Bắt buộc giữ xanh:

```text
unsendable_patch_is_not_in_receipt
mixed_batch_success_does_not_ack_patch_missing_canonical_record
patch_missing_canonical_survives_multiple_successful_unrelated_syncs
patch_becomes_sendable_after_canonical_hydration_and_is_then_acknowledged
newer_patch_generation_is_not_acked_by_older_materialized_receipt
```

Giữ invariant:

```text
NO MUTATION IS ACKNOWLEDGED UNLESS THAT EXACT GENERATION WAS TRANSMITTED AND COMMITTED.
```

---

# 13. KHÔNG REGRESSION RAW PENDING VS SENDABLE

Giữ:

```text
hasPendingMutations != hasSendableMutations
```

Unsendable durable patch vẫn phải:
- pending;
- not settled;
- survive unrelated sync.

---

# 14. KHÔNG REGRESSION DRAFT HSDT / RECOVERY

Giữ tối thiểu:

```text
draft_save_waits_for_authority_before_mutating_state_or_outbox
draft_save_rebuilds_patch_after_authoritative_refresh
draft_save_uses_refreshed_row_version
draft_save_does_not_resurrect_package_removed_by_authoritative_refresh
draft_save_does_not_stage_bid_removed_by_authoritative_refresh
workspace_change_while_draft_waits_for_authority_aborts_without_mutation
draft_save_re_resolves_latest_package_after_authoritative_refresh
draft_save_never_mutates_historical_package_when_new_latest_version_exists
draft_recovery_timer_from_a_cannot_capture_report_fields_from_b
draft_recovery_timer_from_a_cannot_capture_bid_fields_from_b
same_org_new_epoch_recovery_timer_does_not_use_new_epoch_view
recovery_debounce_keeps_latest_snapshot_within_same_workspace
```

---

# 15. KHÔNG REGRESSION WORKSPACE PUSH/PULL

Giữ tối thiểu:

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

# 16. KHÔNG REGRESSION PACKAGE VERSION

Giữ:

```text
package_preparation_waits_for_authority_before_version_api
package_preparation_recomputes_version_decision_after_authoritative_refresh
package_preparation_uses_refreshed_row_version_for_aggregate_version_command
package_preparation_does_not_resurrect_a_record_removed_by_authoritative_refresh
package_preparation_does_not_snapshot_incomplete_children_after_hydration_failure
detail_edit_closing_time_preserves_status_assignment_and_owned_children
offline_package_version_with_incomplete_child_cache_does_not_create_incomplete_snapshot
offline_package_version_with_known_complete_cache_preserves_all_owned_children
offline_package_version_reconnect_replays_without_duplicate_version
offline_package_version_same_org_new_epoch_cannot_commit_old_snapshot
```

---

# 17. PLAN VERSION BUSINESS INVARIANTS

Plan draft chain:

```text
00 → 01 → 02 → ...
```

phải giữ:
- continuous versions;
- one logical root;
- historical versions immutable;
- exactly one latest;
- mỗi plan version owns frozen package snapshot;
- child rows preserved;
- assignment chain đúng;
- intermediate save never hits server;
- final save chỉ hit finalize endpoint;
- final save commit entire graph atomically.

---

# 18. TEST-FIRST BẮT BUỘC

Với mỗi issue `CONFIRMED`:

```text
1. Write deterministic failing regression test.
2. Run it -> BEFORE FIX: FAIL.
3. Implement smallest safe fix.
4. Re-run -> AFTER FIX: PASS.
5. Run neighboring tests.
6. Run full JS/Python/build/E2E/performance.
7. Perform second code review for regressions caused by the patch.
```

Không implementation-first rồi thêm happy-path test.

---

# 19. TARGETED JS TESTS TỐI THIỂU

```bash
node --test --test-concurrency=1 tests/js/plan_version_draft_session.test.mjs
node --test --test-concurrency=1 tests/js/plan_breakdown_draft_transaction.test.mjs
node --test --test-concurrency=1 tests/js/sync_pending_overlay.test.mjs
node --test --test-concurrency=1 tests/js/sync_status.test.mjs
node --test --test-concurrency=1 tests/js/sync_pull_ordering.test.mjs
node --test --test-concurrency=1 tests/js/sync_conflict_recovery.test.mjs
node --test --test-concurrency=1 tests/js/outbox_durability.test.mjs
node --test --test-concurrency=1 tests/js/bid_evaluation_draft_workflow.test.mjs
node --test --test-concurrency=1 tests/js/draft_recovery_store.test.mjs
node --test --test-concurrency=1 tests/js/package_preparation_authority.test.mjs
node --test --test-concurrency=1 tests/js/package_version_selection.test.mjs
node --test --test-concurrency=1 tests/js/version_resolver.test.mjs
```

Nếu filename đổi, dùng canonical equivalent.

---

# 20. PYTHON TARGETED

```bash
python -m pytest -q tests/test_plan_draft_finalize.py
python -m pytest -q tests/test_aggregate_version_http.py
python -m pytest -q tests/test_backend_route_composition.py
```

---

# 21. FULL GATES

```bash
npm run test:js:coverage

python -m pytest -q \
  --cov=backend \
  --cov-branch \
  --cov-report=term \
  --cov-report=json:coverage.json \
  --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
npm run check:static
npm run build:secure
npm run test:e2e:smoke
npm run test:performance
```

Không giảm threshold/budget.

Playwright phải giữ:
- Chromium;
- Firefox;
- WebKit.

---

# 22. PERFORMANCE

Không fix bằng:
- hydrate toàn DB;
- clone toàn app state mỗi keystroke;
- full sync trước mọi intermediate save;
- serialize huge reference tables không cần thiết;
- global serialization mọi workspace.

Checkpoint phải targeted/bounded.

---

# 23. STARTUP / OFFLINE

`hydratePlanVersionDraftSessions()` đang chạy trong init/workspace switch.

Không làm startup regress bằng network request synchronous hoặc deep scans không cần thiết.

Intermediate plan draft phải vẫn local-first/offline:
- create;
- intermediate save;
- reload recovery.

Finalization offline:
- fail safely;
- retain entire draft chain;
- no cleanup;
- no success message.

---

# 24. DURABILITY FAILURE UX

Nếu IndexedDB degraded/unavailable:

Không được báo:

```text
Đã lưu phiên bản nháp
```

khi write chưa durable.

Phải:
- explicit failure;
- rollback state;
- cho retry.

---

# 25. FINAL SUCCESS UX

Chỉ success khi:
- response thuộc current workspace;
- canonical apply đúng workspace;
- draft cleanup đúng workspace.

Nếu A committed nhưng user đang ở B:
- B không được show success của A.

---

# 26. SECOND REGRESSION REVIEW BẮT BUỘC

Sau khi tất cả tests xanh, không kết thúc ngay.

Review lại:

```text
frontend/plans/PlanVersionDraftSession.js
frontend/plans/KeHoachWorkflow.js
frontend/plans/planAggregateSnapshot.js
frontend/plans/planBreakdownDraft.js
frontend/app/SyncPullService.js
frontend/app/SyncPushService.js
frontend/app/SyncCoordinator.js
frontend/app/BiddingModel.js
frontend/app/BrowserDB.js
frontend/app/SyncWorkspaceContext.js
frontend/shared/MutationService.js
frontend/shared/versionResolver.js
backend/plan_drafts/finalize.py
backend/plan_drafts/service.py
backend/sync/service.py
backend/sync/record_validator.py
```

Câu hỏi:

```text
Patch vừa thêm có tự tạo race/data-loss/regression mới ở đâu?
```

---

# 27. ACCEPTANCE CRITERIA — P0

- [ ] finalization captures workspace capability before async work;
- [ ] response A cannot mutate state B;
- [ ] response A cannot update cursor/storage B;
- [ ] response A cannot remove draft session B;
- [ ] same-org new epoch protected;
- [ ] late server success becomes stale locally;
- [ ] B modal/UX unaffected by A completion;
- [ ] force pull after finalize workspace-safe.

# 28. ACCEPTANCE CRITERIA — DURABILITY

- [ ] intermediate save success means durable write succeeded;
- [ ] IndexedDB failure fully rolls back RAM;
- [ ] no half-created plan version;
- [ ] no half-created package children;
- [ ] no assignment leak;
- [ ] no selected-version drift;
- [ ] retry produces exactly one version;
- [ ] reload restores successful draft.

# 29. ACCEPTANCE CRITERIA — REAPPLY

- [ ] draft-owned rows reapply;
- [ ] stale shared refs do not overwrite server truth;
- [ ] new local shared refs recover when valid;
- [ ] pull A cannot reapply into B;
- [ ] same-org epoch protected.

# 30. ACCEPTANCE CRITERIA — MULTI-TAB

- [ ] distinct drafts survive concurrent saves;
- [ ] stale same-draft revision cannot overwrite newer;
- [ ] remove/save race does not resurrect stale draft;
- [ ] atomic `db.update()` or equivalent used;
- [ ] no full-envelope lost update.

# 31. ACCEPTANCE CRITERIA — VALIDATION

- [ ] frontend/backend agree on version sequence;
- [ ] malformed version rejected client-side;
- [ ] unknown assignment type rejected;
- [ ] persisted historical rows remain immutable;
- [ ] valid graph accepted both sides.

# 32. ACCEPTANCE CRITERIA — KHÔNG PHÁT SINH LỖI MỚI

- [ ] all previous outbox receipt tests pass;
- [ ] all workspace race tests pass;
- [ ] Draft HSDT tests pass;
- [ ] recovery tests pass;
- [ ] package version tests pass;
- [ ] conflict recovery tests pass;
- [ ] startup reconciliation tests pass;
- [ ] full JS coverage pass;
- [ ] full Python pass;
- [ ] static checks pass;
- [ ] secure build pass;
- [ ] Chromium pass;
- [ ] Firefox pass;
- [ ] WebKit pass;
- [ ] performance budget unchanged;
- [ ] second regression review finds no new correctness bug.

---

# 33. KHÔNG ĐƯỢC GHI PASS NẾU CHƯA CHẠY

Final report chỉ dùng:

```text
PASS
FAIL
NOT RUN
BLOCKED BY ENVIRONMENT
```

Không ghi “should pass”.

---

# 34. COMMAND RESULTS BẮT BUỘC

```text
plan_version_draft_session targeted      PASS/FAIL
plan_breakdown targeted                  PASS/FAIL
sync workspace targeted                  PASS/FAIL
outbox targeted                          PASS/FAIL
draft HSDT targeted                      PASS/FAIL
package version targeted                 PASS/FAIL
test_plan_draft_finalize.py              PASS/FAIL
npm run test:js:coverage                 PASS/FAIL
pytest full                              PASS/FAIL
npm run check:static                     PASS/FAIL
npm run build:secure                     PASS/FAIL
npm run test:e2e:smoke                   PASS/FAIL
npm run test:performance                 PASS/FAIL
```

---

# 35. CI

Kiểm tra `END_HEAD`.

Nếu CI chưa trả status:

```text
CI STATUS NOT YET AVAILABLE
```

Không đoán.

---

# 36. COMMIT STRATEGY

Ưu tiên commits nhỏ:

```text
fix(plans): make draft finalization workspace-safe
fix(plans): rollback intermediate draft mutation on storage failure
fix(plans): preserve authoritative shared references during draft reapply
fix(sync): guard plan draft reapply across workspace pulls
fix(plans): persist draft sessions with atomic multi-tab merge
fix(plans): align draft validation with backend
test(plans): add finalization workspace and durability regressions
```

Không gom thành refactor lớn khó audit.

---

# 37. FINAL REPORT FORMAT

```text
START_HEAD:
END_HEAD:
```

Issue matrix:

| Issue | Before | Status | Root cause | Fix | Regression test |
|---|---|---|---|---|---|

Status chỉ dùng:

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

# 38. CÂU HỎI BẮT BUỘC TRƯỚC KHI DONE

Trả lời bằng evidence/test:

```text
1. Response finalize của A có đường nào mutate B không?
2. Cursor A có đường nào ghi vào storage B không?
3. Draft A có thể remove draft B không?
4. Same org new epoch có reject old completion không?
5. IndexedDB failure có để RAM ở version mới không?
6. Successful draft save có thật sự durable không?
7. Shared expert/investor/contractor server update có bị stale draft overwrite không?
8. Pull A có thể reapply session B không?
9. Hai tab có thể làm mất draft của nhau không?
10. Retry finalize có duplicate graph không?
11. Lost response after commit có duplicate graph khi reload không?
12. Historical persisted parent có bị finalization sửa không?
13. Exact outbox receipt tests có còn pass không?
14. Startup/offline/package version có regress không?
15. Có test/coverage/performance/security nào bị weaken không?
```

Nếu câu 1–12 có câu trả lời không an toàn thì chưa DONE.

---

# 39. INVARIANTS CUỐI CÙNG

```text
NO FINALIZATION RESPONSE MAY COMMIT CLIENT SIDE-EFFECTS
AFTER ITS WORKSPACE CAPABILITY BECOMES STALE.
```

```text
NO INTERMEDIATE VERSION IS "SAVED"
UNTIL ITS DRAFT SNAPSHOT IS DURABLY PERSISTED.
```

```text
NO DRAFT REAPPLY MAY OVERWRITE NEWER AUTHORITATIVE SHARED DATA
UNLESS THAT RECORD IS EXPLICITLY DRAFT-OWNED AND DIRTY.
```

```text
NO TAB MAY ERASE ANOTHER TAB'S PLAN DRAFT THROUGH A STALE FULL-ENVELOPE WRITE.
```

```text
NO SERVER-COMMITTED DRAFT MAY BE DUPLICATED AFTER LOST RESPONSE OR RELOAD.
```

---

# 40. FINAL INSTRUCTION — NHẤN MẠNH

**Trong quá trình sửa, tuyệt đối không được làm phát sinh lỗi mới.**

Không chỉ chạy test của bug hiện tại.

Phải:

```text
test-first
→ minimal safe fix
→ targeted regressions
→ neighboring regressions
→ full gates
→ second code review
→ CI status
```

Chỉ coi task là DONE khi:
- các lỗi confirmed đã được sửa;
- không có cross-workspace side-effect;
- không có draft data loss;
- không có multi-tab lost update;
- không overwrite server truth;
- không duplicate versions;
- các regression cũ vẫn xanh;
- full gates thực sự đã chạy;
- final report ghi exact START_HEAD / END_HEAD / commands / results.
