# PROMPT CODEX — FIX TRIỆT ĐỂ MSC PLAN-DRAFT STORAGE / NEXT MATERIALIZATION / DECLINE-NEXT / CANCEL WORKSPACE RACES — KHÔNG PHÁT SINH LỖI MỚI

## Repository

```text
https://github.com/newstar94/Bidding
```

HEAD đã được rà soát gần nhất:

```text
78202320b805c136e72e0417445041b91fcfe6f0
```

Lưu ý:
- `78202320...` chỉ thêm prompt Markdown.
- Code fix thực tế mới nhất nằm ở parent:

```text
66eaf16cd7d822ba83cd916a07966ef51791f57f
```

Commit `66eaf16...` đã sửa đúng:
- predecessor progression theo revision;
- predecessor identity/root/rowVersion/localVersion;
- `next()` rollback index khi load revision kế tiếp lỗi;
- workspace guard ở orchestration chính của plan import;
- resume pointer cho durable current revision;
- retry pending-next không save current revision hai lần.

**Không được làm regress bất kỳ fix nào ở trên.**

---

# 0. MỤC TIÊU

Sửa triệt để các vấn đề còn lại trong MSC plan import / plan-version draft subsystem:

```text
P0-1  PlanVersionDraft storage APIs vẫn có cross-workspace race nội tại
P1-2  Next revision materialization có thể mutate RAM rồi fail, retry sinh duplicate
P1-3  User chọn "không tiếp tục revision tiếp" tạo orphan draft không finalizable
P1-4  cancelActiveProcurementImportSession() chưa workspace-safe
```

Ngoài ra phải audit toàn bộ lifecycle:

```text
prepare
→ start import
→ edit current revision
→ durable save
→ ask continue
→ load next
→ materialize next
→ save next
→ retry/reload
→ cancel/decline
→ finalization
```

Mục tiêu cuối:

```text
NO cross-workspace side effect
NO orphan plan draft
NO duplicate revision
NO duplicate package snapshot
NO stale resume pointer
NO invalid cancelled-session provenance
NO rollback of already-durable revision
NO regression in predecessor/outbox/sync/versioning
```

---

# 1. QUY TẮC CAO NHẤT

**Trong quá trình sửa, tuyệt đối không được làm phát sinh lỗi mới.**

Không sửa theo kiểu:

```text
fix một test
→ thêm guard ở caller
→ bỏ qua side effect bên trong callee
```

Phải sửa theo invariant ở đúng tầng sở hữu side effect.

Ví dụ `savePlanVersionDraftSession()` tự nó phải workspace-safe. Không được dựa vào caller check workspace sau `await`, vì side effect có thể đã xảy ra trong callee.

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

Không giả định `78202320...` vẫn là HEAD.

Nếu có commit mới hơn, re-check từng issue và phân loại:

```text
CONFIRMED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
```

Không patch issue đã được sửa.

---

# 3. FILES PHẢI REVIEW

Tối thiểu:

```text
frontend/plans/PlanVersionDraftSession.js
frontend/plans/KeHoachWorkflow.js
frontend/plans/planAggregateSnapshot.js
frontend/plans/planBreakdownDraft.js

frontend/procurement/PlanImportWizard.js
frontend/procurement/ProcurementImportResume.js
frontend/procurement/SequentialRevisionController.js
frontend/procurement/ProcurementDraftWorkflow.js
frontend/procurement/ProcurementImportClient.js

frontend/app/workspaceLease.js
frontend/app/BiddingModel.js
frontend/app/BrowserDB.js
frontend/app/SyncPullService.js
frontend/app/SyncPushService.js
frontend/app/SyncCoordinator.js

backend/procurement_import/repository.py
backend/procurement_import/session.py
backend/procurement_import/sync_binding.py
backend/procurement_import/routes.py
backend/procurement_import/service.py
backend/plan_drafts/finalize.py
backend/sync/service.py

tests/js/plan_version_draft_session.test.mjs
tests/js/procurement_import_wizard.test.mjs
tests/js/plan_breakdown_draft_transaction.test.mjs
tests/js/sync_pull_ordering.test.mjs
tests/js/sync_conflict_recovery.test.mjs

tests/test_procurement_import_sync_binding.py
tests/test_procurement_import_service.py
tests/test_plan_draft_finalize.py
```

---

# 4. P0 — PLAN VERSION DRAFT STORAGE APIs PHẢI TỰ WORKSPACE-SAFE

## Current confirmed race

Current pattern:

```js
const envelope = await updateDraftEnvelope(model, updater);
publishDurableSessions(model, envelope);
session.revision = persistedSession.revision;
```

Trong khi:

```js
function publishDurableSessions(model, envelope) {
  model.planVersionDraftSessions = normalizeStoredEnvelope(envelope).sessions;
}
```

Scenario:

```text
workspace A

savePlanVersionDraftSession(A)
→ A.db.update pending

switch A → B

A.db.update resolves
→ function resumes
→ publishDurableSessions(model, A-envelope)

model hiện là B

=> B.planVersionDraftSessions = A.sessions
```

Caller check workspace sau await là quá muộn.

## Storage invariant

Mọi function có async storage + live-model side effect phải tuân:

```text
capture workspace capability/resources
→ await storage operation
→ verify capability/resources still current
→ only then publish memory/state side effects
```

Hoặc operate entirely on captured resource object.

Không được:

```text
await
→ mutate live model
```

nếu live model có thể đã chuyển workspace.

## Functions bắt buộc audit

```text
hydratePlanVersionDraftSessions()
savePlanVersionDraftSession()
removePlanVersionDraftSession()
discardPlanVersionDraftSession()
discardPlanVersionDraftForImportSession()
persistActivePlanVersionDraftSession()
markPlanVersionDraftRecordsDirty()
reapplyPlanVersionDraftSessions()
finalizePlanVersionDraft()
```

Không chỉ fix `savePlanVersionDraftSession()`.

## Capture resource

Reuse canonical helpers nếu có:

```text
captureWorkspaceLease()
isWorkspaceLeaseCurrent()
beginWorkspaceMutation()
workspaceMutationUsesCurrentResources()
```

Capture tối thiểu:

```text
workspace token/epoch
db
workspaceStorage
state reference
```

Ví dụ semantics:

```js
const lease = captureWorkspaceLease(model);
const resources = {
  db: model.db,
  storage: model.workspaceStorage,
  state: model.state,
};

const envelope = await resources.db.update(...);

if (!isWorkspaceLeaseCurrent(model, lease)) {
  throw workspaceChangedError();
}
if (
  model.db !== resources.db
  || model.workspaceStorage !== resources.storage
  || model.state !== resources.state
) {
  throw workspaceChangedError();
}

publish...
```

Không bắt buộc exact syntax nhưng semantics phải tương đương.

## Important behavior

Nếu DB A write thành công nhưng UI đã ở B:

```text
A durable storage may contain the valid write
BUT B memory MUST NOT receive A envelope.
```

Khi quay lại A, hydrate A từ A DB.

Tương tự cho remove/hydrate/discard.

## Tests bắt buộc

```text
workspace_change_during_plan_draft_save_cannot_publish_a_sessions_into_b
same_org_new_epoch_rejects_late_plan_draft_save_completion
workspace_change_during_plan_draft_remove_cannot_publish_a_envelope_into_b
workspace_change_during_plan_draft_hydration_cannot_replace_b_sessions
workspace_change_during_plan_draft_hydration_cannot_reapply_a_rows_into_b
workspace_change_during_plan_draft_discard_cannot_delete_b_rows
workspace_change_between_two_dirty_record_draft_saves_cannot_mutate_b
```

---

# 5. P1-HIGH — NEXT MATERIALIZATION FAILURE SAU KHI RAM ĐÃ MUTATE

Current tests đã cover network/pre-materialization failure nhưng chưa đủ.

Danger flow:

```text
next revision fetched
→ materializeProcurementRevisionFromPrevious()
   mutates state
→ maybe add investor
→ create/refresh draft session
→ savePlanVersionDraftSession()
→ remember resume pointer
→ plans.edit()
```

Nếu failure xảy ra sau state mutation nhưng trước durable commit:

```text
controller index có thể rollback
BUT plan/package state vẫn còn
```

Retry có thể tạo duplicate.

## Required transaction model

Tách rõ:

```text
A. fetch next source revision
B. build candidate next aggregate
C. durable persist candidate
D. publish candidate into live UI
```

Ưu tiên:

```text
build off-state candidate
→ persist
→ publish
```

Nếu không khả thi:
- capture bounded checkpoint trước mutation;
- rollback nếu failure trước durable commit point.

## Checkpoint tối thiểu

```text
kehoach
goithau
goithauhanghoa
thongtinmothau
hanghoaduthaunhathau
assignments
chudautu if newly materialized
selectedPlanVersion
selectedPackageVersion
selectedPackageVersionIntent
planVersionDraftSessions
planBreakdownDraft
tempPlanData
tempPlanAction
resume pointer
```

## Commit point

Next revision chỉ được coi là materialized khi:

```text
state aggregate prepared
durable plan draft persisted
controller/currentDraft updated
resume pointer consistent
```

Before commit point:
- failure => rollback candidate.

After commit point:
- UI/render failure => **không rollback durable data**.

## Failure classes

### Pre-materialization
- source fetch fail;
- investor lookup fail before state mutation.

Expected:

```text
controller index restored
no state changes
```

### Mid-materialization
- state mutated;
- draft persistence fails.

Expected:

```text
failed next revision fully rolled back
controller = WAITING_NEXT_CONFIRMATION
retry safe
```

### Post-durable UI failure
- durable save succeeded;
- `plans.edit()`/render fails.

Expected:

```text
DO NOT rollback durable next revision
DO NOT duplicate on retry
reopen existing durable revision
```

## Tests bắt buộc

```text
next_revision_draft_persistence_failure_rolls_back_failed_next_plan
next_revision_draft_persistence_failure_rolls_back_failed_next_packages
next_revision_draft_persistence_failure_restores_latest_flags
next_revision_draft_persistence_failure_restores_assignments_and_children
retry_after_mid_materialization_failure_creates_exactly_one_next_plan_version
retry_after_mid_materialization_failure_creates_no_duplicate_package_snapshot
plans_edit_failure_after_durable_next_revision_does_not_duplicate_on_retry
post_durable_ui_failure_reopens_existing_next_revision
```

Do not use only fault injection before actual materialization.

---

# 6. P1-HIGH — DECLINE NEXT REVISION MUST NOT CREATE ORPHAN DRAFT

Current behavior conceptually:

```text
current revision durable
→ prompt asks continue next revision?
→ user says No
→ cancel server import session
→ clear flow/resume pointer
→ KEEP local plan-version draft
```

Local draft still references:

```text
sourceRevision.sessionId = cancelled session
```

Backend validators reject inactive/cancelled session.

=> orphan draft nhìn hợp lệ nhưng không finalizable.

## Must choose one explicit business semantics

### MODEL A — No means cancel entire import

Then:

```text
cancel server session
+ discard local plan draft from this session
+ restore pre-import state
+ clear resume pointer
+ close flow
```

No orphan.

### MODEL B — No means stop at current revision and keep it

Then:
- current durable prefix must remain legally finalizable;
- do not invalidate its authority;
- server must support explicit prefix-complete/truncate semantics;
- remaining revisions become skipped/cancelled separately.

Do **not** solve this by simply allowing all `CANCELLED` sessions in validators.

That would weaken authority/security.

## UX must match data effect

If No destroys all imported draft work, wording must say so explicitly.

If No means keep current version, server lifecycle must support finalization of that prefix.

## Invariant

```text
ACTIVE LOCAL DRAFT MUST NOT REFERENCE
A SERVER AUTHORITY SESSION THAT FINALIZATION WILL REJECT.
```

## Tests

If cancel-all semantics:

```text
declining_next_revision_discards_local_import_draft
declining_next_revision_restores_pre_import_state
declining_next_revision_clears_resume_pointer
declining_next_revision_cannot_leave_finalizable_looking_orphan
```

If keep-current semantics:

```text
declining_next_revision_keeps_current_durable_prefix_finalizable
declining_next_revision_marks_remaining_source_revisions_skipped_without_invalidating_current_provenance
declining_next_revision_reload_keeps_current_prefix
declining_next_revision_finalizes_without_source_version_conflict
```

---

# 7. P1-HIGH — cancelActiveProcurementImportSession() MUST BE WORKSPACE-SAFE

Current pattern:

```js
const flow = this.procurementPlanImport || this.procurementPackageImport;

try {
  await cancelImportSession(...);
} finally {
  flow.controller.cancel();
  this.procurementPlanImport = null;
  forgetProcurementImportSession(this);
}
```

Race:

```text
cancel A pending
→ switch A→B
→ response A
→ finally runs against live B controller/storage
```

Can clear:
- B import flow;
- B resume pointer.

## Required fix

Before await capture:

```text
original flow reference
sessionId
workspace lease/epoch
workspaceStorage
flow generation/identity
```

After await:

```text
if stale workspace OR flow replaced:
  do not mutate current local state/storage
```

Remote A cancel may still succeed.

Do not blindly mutate live controller in `finally`.

## Same-workspace replaced-flow race

Workspace token alone is insufficient.

Scenario:

```text
cancel A1 pending
→ user starts new import A2 in same workspace
→ A1 response returns
```

If only workspace token checked, old completion can clear A2.

Need flow identity/generation check.

At minimum verify:

```text
same workspace lease
same sessionId
same flow reference/generation
```

## Tests

```text
workspace_change_during_cancel_import_cannot_clear_b_plan_import_flow
workspace_change_during_cancel_import_cannot_clear_b_package_import_flow
workspace_change_during_cancel_import_cannot_clear_b_resume_pointer
same_org_new_epoch_rejects_late_cancel_import_completion
late_cancel_a_may_cancel_server_a_but_must_not_mutate_local_b
late_cancel_of_old_flow_cannot_clear_new_import_flow_in_same_workspace
```

---

# 8. AUDIT REMEMBER/FORGET RESUME POINTER

`forgetProcurementImportSession()` currently uses live `controller.model.workspaceStorage`.

Async stale callers must not clear current workspace pointer.

Allow explicit captured storage if needed.

Likewise audit `rememberProcurementImportSession()`.

Any sequence:

```text
await
→ remember/forget using live controller
```

must verify origin workspace + flow identity first.

---

# 9. AUDIT RESUME FLOW

`resumeProcurementImportSession()` already has workspace guards, but re-audit:

```text
discardPlanVersionDraftForImportSession()
renderKeHoachTable()
renderGoiThauTable()
cancelImportSession()
store.clear()
startProcurementPlanImport()
```

If workspace changes mid-decline:
- no B state rows deleted;
- no B pointer cleared;
- no A flow materialized into B.

---

# 10. FLOW GENERATION FOR NEXT TRANSITION TOO

Same-workspace replacement race also applies to `next()`.

Scenario:

```text
old flow A1 next request pending
→ new flow A2 replaces it in same workspace
→ A1 response returns
```

Late A1 must not materialize into A2 state.

Add test:

```text
late_next_from_replaced_flow_cannot_materialize_into_new_flow_same_workspace
```

Use existing `requestGeneration`, flow ID, session ID, or dedicated flow generation.

---

# 11. DO NOT REGRESS PREDECESSOR FIX

Keep authoritative predecessor chain:

```text
existing 00
→ commit 01
→ revision 02 uses committed 01 token
→ revision 03 uses committed 02 token
```

Validation must continue to compare:

```text
id
rootId
rowVersion
localVersion
```

Do not revert to rowVersion-only.

---

# 12. NEW PLAN VS EXISTING PLAN DISTINCTION

Preserve:

```text
NEW PLAN:
00→01→02 local draft
→ final atomic commit
```

```text
EXISTING PLAN:
server 00
→ 01 commit
→ 02 uses committed 01 predecessor
```

Do not mix these semantics to fix decline-next.

---

# 13. PACKAGE/TBMT REVISION INDEPENDENCE

Preserve:

```text
plan revision 02
does NOT imply
package/TBMT revision 02
```

Package source version must continue to follow linked TBMT revision.

---

# 14. NO REGRESSION — PLAN DRAFT FINALIZATION

Keep:
- workspace capability capture;
- no A response mutating B;
- no A sync cursor into B;
- no B draft cleanup from A;
- server SERIALIZABLE atomic finalization;
- idempotent retry.

---

# 15. NO REGRESSION — MULTI-TAB

Keep atomic `db.update`, revision, tombstones.

Tests:

```text
concurrent_tabs_preserve_distinct_drafts
stale_same_draft_revision_cannot_overwrite_newer
concurrent_remove_and_stale_save_cannot_resurrect
```

---

# 16. NO REGRESSION — EXACT OUTBOX ACK

Keep:

```text
unsendable_patch_is_not_in_receipt
mixed_batch_success_does_not_ack_patch_missing_canonical_record
patch_missing_canonical_survives_multiple_successful_unrelated_syncs
patch_becomes_sendable_after_canonical_hydration_and_is_then_acknowledged
newer_patch_generation_is_not_acked_by_older_materialized_receipt
```

---

# 17. NO REGRESSION — WORKSPACE PUSH/PULL

Keep all existing A→B and same-org epoch tests.

At minimum:

```text
late_success_response_from_workspace_a_cannot_clear_workspace_b_outbox
same_org_new_epoch_rejects_late_push_completion
same_org_new_epoch_rejects_late_pull_completion
workspace_change_during_pull_persistence_cannot_reapply_new_workspace_plan_drafts
background_render_scheduled_in_workspace_a_does_not_render_after_switch_to_b
```

---

# 18. NO REGRESSION — STARTUP CONFLICT

Do not reintroduce repeated 409 retry after startup conflict/F5 boundary.

---

# 19. NO REGRESSION — DRAFT HSDT

Keep:
- authority before mutation;
- re-resolve latest package;
- no historical package mutation;
- immutable recovery snapshot;
- same-org epoch safety;
- partial patch semantics.

---

# 20. NO REGRESSION — PACKAGE VERSION

Keep:
- status inheritance;
- assignment inheritance;
- child inheritance;
- historical immutability;
- offline completeness;
- reconnect idempotency.

---

# 21. TEST-FIRST BẮT BUỘC

For every confirmed issue:

```text
1. create deterministic failing test
2. run it
3. record BEFORE FIX = FAIL
4. implement minimal architecture-safe fix
5. rerun targeted test
6. run neighboring regressions
7. run full gates
8. perform second regression review
```

Do not implementation-first.

---

# 22. REQUIRED TARGETED JS TESTS

```bash
node --test --test-concurrency=1 tests/js/plan_version_draft_session.test.mjs
node --test --test-concurrency=1 tests/js/procurement_import_wizard.test.mjs
node --test --test-concurrency=1 tests/js/plan_breakdown_draft_transaction.test.mjs
node --test --test-concurrency=1 tests/js/sync_pull_ordering.test.mjs
node --test --test-concurrency=1 tests/js/sync_conflict_recovery.test.mjs
node --test --test-concurrency=1 tests/js/sync_pending_overlay.test.mjs
node --test --test-concurrency=1 tests/js/outbox_durability.test.mjs
```

Nếu filename thay đổi, dùng canonical equivalent.

---

# 23. REQUIRED PYTHON TESTS

```bash
python -m pytest -q tests/test_procurement_import_sync_binding.py
python -m pytest -q tests/test_procurement_import_service.py
python -m pytest -q tests/test_plan_draft_finalize.py
```

Nếu decline-next thay đổi server session lifecycle, thêm route/session tests tương ứng.

---

# 24. FULL QUALITY GATES

```bash
npm run test:js:coverage
```

```bash
python -m pytest -q \
  --cov=backend \
  --cov-branch \
  --cov-report=term \
  --cov-report=json:coverage.json \
  --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
```

```bash
npm run check:static
npm run build:secure
npm run test:e2e:smoke
npm run test:performance
```

Không hạ threshold.
Không skip Chromium/Firefox/WebKit.
Không tăng performance budget.

---

# 25. E2E NÊN BỔ SUNG

Nếu infra cho phép:

```text
A starts MSC flow
→ save current revision durable
→ switch B while draft DB write pending
→ B remains unchanged
```

```text
00 saved
→ load 01
→ materialize 01
→ force IndexedDB failure
→ retry
→ exactly one 01
```

```text
00 saved
→ decline 01
→ chosen business semantics completes cleanly
→ reload
→ no orphan
```

```text
cancel A pending
→ switch B
→ A response returns
→ B flow and pointer remain
```

---

# 26. FAILURE MATRIX BẮT BUỘC

Review/test:

```text
A. DB save pending → workspace switch
B. DB remove pending → workspace switch
C. hydrate pending → workspace switch
D. discard pending → workspace switch
E. next fetch fail before materialization
F. investor lookup fail before materialization
G. state mutation succeeds → draft persistence fails
H. durable next save succeeds → UI edit/render fails
I. resume pointer write fails
J. user declines next
K. cancel API pending → workspace switch
L. same-org new epoch
M. old flow replaced by new flow in same workspace
N. server commits, response lost
O. retry after partial UI failure
```

---

# 27. UI ERROR != STORAGE ERROR

Never rollback committed durable data because:
- modal open failed;
- render failed;
- UI helper failed.

Only rollback before durable commit point.

---

# 28. CANCEL SERVER SCOPE

Keep cancellation scoped by:
- authenticated user;
- organization;
- session ID;
- workspace lease as currently enforced.

Do not weaken backend auth or RBAC.

---

# 29. SERVER SESSION STATUS

Audit validators against statuses:

```text
READY
WAITING_NEXT_CONFIRMATION
COMPLETED
CANCELLED
```

If keep-current prefix is supported after decline-next, create explicit legal lifecycle semantics.

Do not blanket accept `CANCELLED` just to make old draft finalizable.

---

# 30. PERFORMANCE

Do not solve safety by:
- cloning all app state on every input;
- full DB hydrate;
- full server sync before each revision;
- global locks.

Use bounded aggregate checkpoints/captured resources.

---

# 31. ACCEPTANCE — STORAGE WORKSPACE SAFETY

- [ ] save draft A cannot publish into B
- [ ] remove A cannot publish into B
- [ ] hydrate A cannot publish/reapply into B
- [ ] discard A cannot delete B rows
- [ ] same-org epoch protected
- [ ] A DB write may persist without B side effect
- [ ] returning to A hydrates A correctly

---

# 32. ACCEPTANCE — NEXT MATERIALIZATION

- [ ] pre-materialization failure leaves state unchanged
- [ ] mid-materialization persistence failure rolls back failed next revision
- [ ] latest flags restored
- [ ] packages/children/assignments restored
- [ ] retry creates exactly one next revision
- [ ] post-durable UI failure does not rollback
- [ ] retry/reload uses existing durable revision

---

# 33. ACCEPTANCE — DECLINE NEXT

- [ ] behavior explicit/documented
- [ ] no active local draft references invalid cancelled session
- [ ] no orphan unfinalizable draft
- [ ] reload correct
- [ ] UI copy matches data effect
- [ ] predecessor security not weakened

---

# 34. ACCEPTANCE — CANCEL

- [ ] A cancel cannot clear B flow
- [ ] A cancel cannot clear B pointer
- [ ] same-org epoch protected
- [ ] old flow A1 cancel cannot clear newer flow A2 in same workspace
- [ ] server A cancellation may succeed independently
- [ ] local cleanup only affects correct flow/storage

---

# 35. ACCEPTANCE — REGRESSION

- [ ] predecessor progression tests pass
- [ ] predecessor identity tests pass
- [ ] next network retry tests pass
- [ ] plan-draft finalization workspace tests pass
- [ ] multi-tab draft tests pass
- [ ] shared-reference tests pass
- [ ] exact outbox receipt tests pass
- [ ] sync workspace race tests pass
- [ ] startup conflict tests pass
- [ ] Draft HSDT tests pass
- [ ] package version tests pass
- [ ] JS coverage pass
- [ ] Python coverage pass
- [ ] static checks pass
- [ ] secure build pass
- [ ] Chromium pass
- [ ] Firefox pass
- [ ] WebKit pass
- [ ] performance budget unchanged

---

# 36. REQUIRED QUESTIONS BEFORE DONE

Answer with code/test evidence:

```text
1. Can A.db.update completion still set B.planVersionDraftSessions?
2. Can A hydrate completion still reapply A rows into B?
3. Can A discard completion delete B rows?
4. Can same-org A@1 completion mutate A@2?
5. Can next revision state mutate before durable save and remain after failure?
6. Can retry produce duplicate plan/package/assignment?
7. Can plans.edit failure after durable save cause duplicate retry?
8. Can decline-next leave an active draft tied to CANCELLED session?
9. What exactly does decline-next now mean?
10. Can cancel A clear B resume pointer?
11. Can old cancel A1 clear new flow A2 in same workspace?
12. Can old next A1 materialize into new flow A2 same workspace?
13. Are predecessor id/root/rowVersion/localVersion still enforced?
14. Are exact outbox ACK semantics unchanged?
15. Are startup conflict/F5 semantics unchanged?
16. Are all quality gates unchanged?
```

If any of 1–12 is unsafe, task is not DONE.

---

# 37. COMMIT STRATEGY

Prefer small commits:

```text
fix(plans): make plan draft storage workspace-capability safe
fix(procurement): rollback failed next materialization before durable commit
fix(procurement): define decline-next lifecycle without orphan drafts
fix(procurement): guard cancel flow by workspace and flow identity
test(procurement): add storage materialization cancel race regressions
```

Do not bundle into giant refactor unless architecture requires it.

---

# 38. FINAL REPORT FORMAT

```text
START_HEAD:
END_HEAD:
```

Issue matrix:

| Issue | Before | Status | Root cause | Fix | Test |
|---|---|---|---|---|---|

Allowed status:

```text
FIXED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
BLOCKED BY ENVIRONMENT
```

Command matrix:

| Command | Result |
|---|---|
| targeted JS | PASS/FAIL |
| targeted Python | PASS/FAIL |
| npm run test:js:coverage | PASS/FAIL |
| full pytest | PASS/FAIL |
| npm run check:static | PASS/FAIL |
| npm run build:secure | PASS/FAIL |
| npm run test:e2e:smoke | PASS/FAIL |
| npm run test:performance | PASS/FAIL |

Do not write PASS if command was not actually run.
Use:

```text
PASS
FAIL
NOT RUN
BLOCKED BY ENVIRONMENT
```

---

# 39. CI

After changes:

```text
END_HEAD=
```

Check combined status/workflow runs.

If unavailable:

```text
CI STATUS NOT YET AVAILABLE
```

Do not guess CI PASS.

---

# 40. SECOND REGRESSION REVIEW — BẮT BUỘC

After all tests pass, reread:

```text
frontend/plans/PlanVersionDraftSession.js
frontend/plans/KeHoachWorkflow.js
frontend/procurement/PlanImportWizard.js
frontend/procurement/ProcurementImportResume.js
frontend/procurement/SequentialRevisionController.js
frontend/procurement/ProcurementDraftWorkflow.js
frontend/app/workspaceLease.js
backend/procurement_import/sync_binding.py
backend/procurement_import/session.py
backend/procurement_import/repository.py
backend/procurement_import/routes.py
backend/plan_drafts/finalize.py
```

Ask:

```text
"Patch vừa thêm có tự tạo race, data loss, orphan, duplicate,
stale-workspace side effect hoặc flow replacement race mới ở đâu?"
```

---

# 41. CORE INVARIANTS

```text
NO PLAN-DRAFT STORAGE COMPLETION MAY PUBLISH INTO
A WORKSPACE CAPABILITY THAT DID NOT INITIATE IT.
```

```text
NO FAILED NEXT-REVISION MATERIALIZATION MAY LEAVE
A PARTIAL PLAN/PACKAGE SNAPSHOT IN LIVE STATE.
```

```text
NO ACTIVE LOCAL IMPORT DRAFT MAY REFERENCE
A SERVER SESSION THAT FINALIZATION WILL REJECT.
```

```text
NO LATE CANCEL OR NEXT COMPLETION MAY CLEAR OR MUTATE
A DIFFERENT IMPORT FLOW, EVEN IN THE SAME WORKSPACE.
```

```text
NO RETRY OR RELOAD MAY DUPLICATE A DURABLE OR COMMITTED REVISION.
```

---

# 42. FINAL INSTRUCTION

**Sửa triệt để, không chỉ vá đúng test hiện tại.**

Bắt buộc:

```text
fetch latest HEAD
→ compare
→ reproduce
→ failing tests
→ fix storage-layer invariant
→ fix next-materialization transaction
→ fix decline-next lifecycle
→ fix cancel workspace + flow identity
→ targeted regressions
→ full regressions
→ E2E 3 browsers
→ performance
→ regression review lần 2
→ CI status
```

Chỉ coi DONE khi:
- không còn cross-workspace plan-draft storage race;
- không duplicate next revision sau mid-materialization failure;
- decline-next không tạo orphan;
- cancel không clear nhầm flow/storage;
- same-workspace replaced-flow race được khóa;
- predecessor hardening vẫn nguyên;
- toàn bộ regression cũ vẫn xanh;
- không hạ quality gate;
- final report có exact START_HEAD / END_HEAD / command results.
