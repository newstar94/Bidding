# PROMPT CODEX — FIX TRIỆT ĐỂ PLAN SEQUENTIAL IMPORT DECISION SEMANTICS + HANDOFF RECOVERY
## SYSTEM-WIDE AUDIT · NO REGRESSION · KHÔNG ĐƯỢC CHỈ LÀM CHO TEST HIỆN TẠI PASS

Repository:

```text
https://github.com/newstar94/Bidding
```

Mốc audit gần nhất trước khi tạo prompt:

```text
42c956ae2d7093a8a8604c71199b4fad766aa264
```

Commit:

```text
refactor(procurement): remove dead code and enhance flow handoff capabilities
```

Ngày audit:

```text
2026-08-21
```

---

# 0. MỤC TIÊU

Sửa **triệt để** cụm lỗi logic trong workflow nhập dữ liệu Mua Sắm Công theo phiên bản tuần tự:

```text
Plan preview decisions
→ sequential import session
→ revision draft
→ local materialization
→ form editing
→ save/finalize
```

Các lỗi đã CONFIRMED:

```text
1. packageMatches / fieldConflicts / fieldValues được UI thu thập
   nhưng sequential import không sử dụng.

2. Backend preview đã tính three-way merge/effectiveFields,
   nhưng get_revision_draft() map trực tiếp từ canonical revision gốc,
   bỏ qua reconciliation/effectiveFields.

3. KEEP_LOCAL có thể bị source overwrite trong:
   Object.assign(existing, sourcePackage, ...)
   hoặc Object.assign(packageRecord, source, ...).

4. AMBIGUOUS package có UI cho user chọn candidate,
   nhưng canStartSequentialImport() không đọc decisions,
   nên user resolve xong vẫn không thể tiếp tục.

5. ALL mode hiện chỉ gate theo preview.packages của revision cuối,
   nên ambiguity/conflict ở revision trước có thể bị bỏ qua.

6. Chủ đầu tư user chọn trong wizard vẫn được lưu vào draftStore,
   nhưng sequential apply() không đọc investorId;
   materializer tự resolve investor từ source.

7. InlineLookup có post-durable handoff failure path:
   flow đã được cài + durable draft đã tồn tại,
   nhưng flowHandoffCompleted chưa được set,
   catch/finally có thể không reset loading/status.

8. Cleanup vừa rồi xóa test của canApplyPreview().
   Function đó có thể đúng là dead,
   nhưng test đã chứa business contract còn sống.
   Cần thay bằng integration/regression tests của sequential path,
   KHÔNG được chỉ khôi phục dead helper để làm test PASS.
```

Mục tiêu cuối:

```text
MỌI LỰA CHỌN MÀ UI CHO NGƯỜI DÙNG THỰC HIỆN
PHẢI CÓ TÁC DỤNG THẬT TRONG DỮ LIỆU ĐƯỢC MATERIALIZE.

PREVIEW / DECISION / SESSION / DRAFT
PHẢI DÙNG CÙNG MỘT BUSINESS SEMANTICS.

KHÔNG ĐƯỢC MẤT LOCAL CHANGE.
KHÔNG ĐƯỢC TỰ ĐỘNG GHI ĐÈ KEEP_LOCAL.
KHÔNG ĐƯỢC BỎ QUA AMBIGUITY Ở REVISION CŨ.
KHÔNG ĐƯỢC BỎ QUA INVESTOR USER ĐÃ CHỌN.
```

---

# 1. KHÔNG ĐƯỢC HIỂU TASK NÀY THEO KIỂU “SỬA 8 BUG ĐÃ LIỆT KÊ”

Đây là:

```text
AUDIT
→ FIND ALL SAME-CLASS BUGS
→ ADD FAILING TESTS
→ FIX ROOT CAUSES
→ AUDIT AGAIN
→ CONTINUE UNTIL STOP CONDITION
```

Không được:

```text
sửa đúng từng dòng đã mô tả
→ test đã biết PASS
→ tuyên bố DONE
```

Bắt buộc audit toàn bộ subsystem liên quan:

```text
frontend/procurement/
backend/procurement_import/
frontend/plans/
frontend/packages/
resume/session logic
draft materialization
preview reconciliation
decision validation
workspace/flow capability
UI loading/catch/finally
```

---

# 2. FETCH HEAD THỰC TẾ TRƯỚC KHI LÀM

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

Không giả định `42c956ae2d7093a8a8604c71199b4fad766aa264` vẫn là HEAD.

Nếu HEAD mới hơn:

```bash
git diff 42c956ae2d7093a8a8604c71199b4fad766aa264..HEAD -- \
  frontend/procurement \
  frontend/plans \
  frontend/packages \
  backend/procurement_import \
  tests \
  views \
  package.json
```

Audit commit mới trước.

Nếu HEAD mới đã sửa một phần finding:

```text
KHÔNG REVERT.
RE-AUDIT IMPLEMENTATION MỚI.
CHỈ SỬA PHẦN CÒN SAI.
```

---

# 3. FILES BẮT BUỘC PHẢI ĐỌC

Ít nhất:

```text
frontend/procurement/PlanImportWizard.js
frontend/procurement/ProcurementInlineLookup.js
frontend/procurement/SequentialRevisionController.js
frontend/procurement/ProcurementImportClient.js
frontend/procurement/ProcurementImportResume.js
frontend/procurement/ProcurementDraftWorkflow.js
frontend/procurement/InvestorResolver.js

frontend/plans/KeHoachWorkflow.js
frontend/plans/PlanVersionDraftSession.js
frontend/plans/planBreakdownDraft.js
frontend/plans/planAggregateSnapshot.js

frontend/packages/GoiThauWorkflow.js
frontend/packages/packageLifecycleWorkflow.js

backend/procurement_import/service.py
backend/procurement_import/session.py
backend/procurement_import/routes.py
backend/procurement_import/domain.py
backend/procurement_import/draft_mapping.py
backend/procurement_import/command.py
backend/procurement_import/repository.py

views/modals/modal_procurement_import.html

tests/js/procurement_import_wizard.test.mjs
tests/js/procurement_lookup_wizard.test.mjs
tests/js/package_version_inheritance.test.mjs
tests/js/plan_version_draft_session.test.mjs
```

Tìm thêm toàn repo:

```bash
rg -n "packageMatches|fieldConflicts|fieldValues|investorId|effectiveFields|AMBIGUOUS|KEEP_LOCAL|APPLY_SOURCE"
rg -n "canStartSequentialImport|canApplyPreview"
rg -n "get_revision_draft|reconciliationByRevision|three_way_merge_field"
rg -n "startProcurementPlanImport|completeProcurementPlanImportRevision"
rg -n "startProcurementPackageImport|completeProcurementPackageImportRevision"
rg -n "procurementMaterializationDurable|pendingNextUiRecovery|flowHandoffCompleted"
rg -n "Object\.assign\(existing|Object\.assign\(packageRecord"
```

---

# 4. ROOT CAUSE CẦN HIỂU ĐÚNG

Backend preview hiện đã có business semantics:

```text
canonical source
+
base/local state
↓
three_way_merge_field()
↓
reconciliationByRevision
↓
effectiveFields
fieldConflicts
AMBIGUOUS candidates
blockingIssues
```

Backend direct `/plan/apply` vẫn có `_resolve_revision_decisions()` cho:

```text
packageMatches
fieldConflicts
fieldValues
investorId
```

Nhưng sequential path hiện là:

```text
prepare
→ create persistent import session
→ getPlanRevisionDraft()
→ map raw canonical revision
→ materialize locally
```

Root cause:

```text
DECISION RESOLUTION + THREE-WAY MERGE SEMANTICS
KHÔNG ĐƯỢC PORT ĐẦY ĐỦ
SANG SEQUENTIAL SESSION PATH.
```

---

# 5. KIẾN TRÚC FIX BẮT BUỘC

Cần đạt:

```text
PREVIEW AUTHORITY
+
USER DECISIONS
+
SESSION AUTHORITY
↓
SERVER-VALIDATED RESOLVED REVISION DRAFT
↓
CLIENT MATERIALIZATION
```

Không được:

```text
client tự merge source/local bằng dữ liệu không authoritative
```

Không được:

```text
client gửi canonical source object đã chỉnh sửa
```

Không được:

```text
map raw canonical revision
rồi dùng Object.assign hy vọng merge đúng
```

Không được:

```text
trust localRootId / investorId / field name
nếu backend chưa validate cùng workspace/session/preview authority.
```

---

# 6. KIẾN TRÚC ƯU TIÊN

Ưu tiên server-authoritative decision binding.

Ví dụ hợp lệ:

```text
PREPARE
→ server stores canonical + reconciliation authority

USER RESOLVES PREVIEW
→ client sends bounded decisions + selected investor

SERVER BINDS/VALIDATES DECISIONS TO SESSION
→ immutable/CAS decision authority

GET REVISION DRAFT
→ backend returns resolved effective revision draft

FRONTEND MATERIALIZES
→ no ad-hoc decision merge
```

Có thể thêm endpoint tương đương:

```text
POST /api/procurement/imports/plan/sessions/{sessionId}/decisions
```

hoặc seam khác nếu phù hợp.

Body chỉ được chứa bounded authority:

```text
session/preview id or digest
workspace lease
expected authority/CAS
investorId
packageMatches
fieldConflicts
fieldValues
```

Backend phải:
- validate session scope;
- validate preview/session digest;
- validate decisions với `reconciliationByRevision`;
- resolve selected revisions;
- bind selected investor;
- persist atomically hoặc tạo immutable resolved authority;
- reject stale/mismatched authority.

Khuyến nghị extract/reuse **một** authoritative resolver thay vì copy `_resolve_revision_decisions()`:

```text
direct apply
+
sequential session
→ same resolver
```

---

# 7. KHÔNG ĐƯỢC QUAY LẠI DIRECT APPLY NẾU PHÁ WORKFLOW DRAFT

Không đơn giản:

```text
sequential → bỏ
→ gọi /plan/apply commit tất cả
```

nếu làm mất:

```text
per-revision editing
local draft chain
intermediate save
finalize boundary
resume
version inheritance
workspace isolation
```

Giữ semantics:

### New plan

```text
00 → 01 → 02
```

là local PlanVersionDraftSession cho tới final save.

### Existing plan

Revision mới phải extend exact authoritative predecessor.

---

# 8. P1-HIGH — EFFECTIVE FIELDS / THREE-WAY MERGE

Required invariant:

```text
LOCAL-ONLY CHANGE MUST SURVIVE IMPORT.
```

Case:

```text
base=100
local=120
source=100
```

Expected draft:

```text
120
```

Source-only:

```text
base=100
local=100
source=130
```

Expected:

```text
130
```

Conflict:

```text
base=100
local=120
source=130
```

`KEEP_LOCAL`:

```text
120
```

`APPLY_SOURCE`:

```text
130
```

Không được silently default conflict.

`get_revision_draft()` hoặc resolved equivalent phải sử dụng đúng:

```text
effectiveFields
+
validated overrides
+
validated conflict resolutions
+
validated package matching
```

---

# 9. P1-HIGH — AMBIGUOUS PACKAGE

Current anti-pattern:

```text
user chọn root-a
→ decisions updated
→ row.action vẫn AMBIGUOUS
→ canStartSequentialImport() vẫn false
```

Behavior bắt buộc:

```text
unresolved ambiguity
→ BLOCK

valid selected candidate
→ RESOLVED

invalid/foreign candidate
→ BLOCK / backend reject

selected NEW when allowed
→ RESOLVED
```

Backend phải validate selected root/snapshot là candidate được preview authorize.

Không tin arbitrary `localRootId`.

---

# 10. ALL MODE

Không được chỉ check `preview.packages` của revision cuối.

Invariant:

```text
NO SELECTED REVISION MAY ENTER MATERIALIZATION
WITH UNRESOLVED REQUIRED DECISIONS.
```

Required test:

```text
revision 00 = AMBIGUOUS
revision 01 = clean
```

Expected:

```text
ALL import cannot start
until revision 00 authority is resolved
```

Hoặc architecture khác phải chứng minh deterministic resolution đúng.

---

# 11. INVESTOR SEMANTICS

Modal hiện cho user chọn:

```text
Chủ đầu tư BiddingFlow *
```

Mặc định preserve user-facing contract:

```text
USER SELECTED EXISTING INVESTOR
IS AUTHORITATIVE
IF STILL VALID IN CURRENT WORKSPACE.
```

Server/session phải validate:
- investor tồn tại;
- cùng org/workspace;
- user có quyền;
- không stale/deleted.

Materialized plan:

```text
chuDauTuId === selectedInvestorId
```

Không được:

```text
user chọn B
→ resolver tự chọn A
```

Nếu product thực sự muốn auto-resolve:
- phải thay UI/contract có chủ đích;
- không giữ required select giả.

Trong task này ưu tiên preserve contract hiện tại.

---

# 12. REQUIRED FIELD OVERRIDES

Nếu UI render `fieldValues` cho blocking issue:

```text
packageObservationId
field
value
```

Backend phải validate:
- observation thuộc exact session/revision;
- field thuộc server-authorized issue;
- field allowed;
- type/domain hợp lệ;
- payload bounded.

Không dùng field name tùy ý từ client.

---

# 13. FRONTEND MATERIALIZATION

Audit kỹ:

```text
materializeProcurementRevisionIntoExisting()
materializeProcurementRevisionFromPrevious()
```

Current patterns:

```js
Object.assign(existing, sourcePackage, ...)
Object.assign(packageRecord, source, ...)
```

Nếu server trả **resolved draft**, overlay có thể hợp lệ cho source-owned fields.

Nhưng phải test:
- app-only/local metadata không mất;
- assignments không mất;
- historical snapshot không mutate;
- appraisal/status rules giữ nguyên;
- child tables không bị duplicate;
- package source ownership đúng.

Không fix bằng hàng chục hardcode field exceptions nếu root cause là field ownership.

---

# 14. POST-DURABLE INLINE HANDOFF

Current Plan InlineLookup:

```js
await start(...)
flowHandoffCompleted = true
```

Nhưng `startProcurementPlanImport()` có thể:

```text
durable draft persisted
→ flow installed
→ resume pointer installed
→ plans.edit throws
```

và giữ:

```text
pendingNextUiRecovery
procurementPlanImport = nextFlow
```

Phải sửa completion capability để nhận ra:

```text
handoff thực tế đã thành authoritative
dù start() reject sau durable point
```

Không dựa duy nhất vào bool set sau successful await.

Có thể dùng:
- exact active flow identity;
- workspace capability;
- session identity;
- durable marker;
- `pendingNextUiRecovery`.

Nhưng old flow không được reset new flow UI.

Audit cùng class ở package path vì `startProcurementPackageImport()` cài active flow trước `remember/fill`.

---

# 15. UI LOADING INVARIANT

```text
AN OPERATION MAY FAIL,
BUT ITS LOADING STATE MUST NOT REMAIN PERMANENTLY STUCK
WHEN THE CURRENT FLOW IS STILL THE FLOW THAT CAUSED THE FAILURE.
```

Đồng thời:

```text
OLD FLOW MAY NEVER RESET NEW FLOW UI.
```

Success:
- loading off;
- status success.

Recoverable post-durable failure:
- loading off;
- status error/recovery;
- durable flow retained;
- retry does not duplicate.

Stale flow/workspace:
- do not touch newer UI.

---

# 16. ASYNC CAPABILITY

Giữ invariant:

```text
CAPTURE CAPABILITY BEFORE AWAIT
→ AWAIT
→ VERIFY SAME CAPABILITY
→ SIDE EFFECT
```

Capability gồm khi applicable:

```text
workspace token + epoch
workspaceStorage identity
state/db identity
flow identity
session identity
request generation
form/modal identity
target entity identity
```

Không regress các fixes:
- PlanImportWizard A→B;
- InlineLookup A→B;
- package next A→B;
- notice apply stale completion;
- opening stale catch/finally;
- same-workspace old flow replacement.

---

# 17. SAME WORKSPACE != SAME FLOW

```text
A1 old flow
A2 replacement flow
```

A1 không được:
- mutate A2;
- clear A2;
- close A2 modal;
- reset A2 button;
- fill A2 form;
- overwrite A2 resume pointer.

Kể cả workspace token giống nhau.

---

# 18. DECISION AUTHORITY / STALE PREVIEW

Reject deterministic nếu:
- source/preview digest đổi;
- session đổi;
- workspace epoch đổi;
- local rowVersion đổi;
- selected candidate không còn valid;
- investor deleted/inaccessible;
- target changed.

Không silent fallback.

---

# 19. SECURITY / TENANT ISOLATION

Test:
- `localRootId` org khác;
- `investorId` org khác;
- fake observation id;
- fake field;
- session user khác;
- preview workspace khác.

Expected:

```text
reject without leaking foreign data
```

Giữ RBAC/module permission.

---

# 20. IDEMPOTENCY / RESUME

Nếu thêm decision binding:
- same decisions + same authority → idempotent;
- changed decisions after materialization started → deterministic reject/CAS;
- browser reload → resume exact same bound decisions;
- không lưu full canonical bundle vào localStorage.

---

# 21. HISTORICAL / VERSION INVARIANTS

Giữ:

```text
historical snapshots immutable
```

```text
every MSC revision targets exact immediate predecessor
```

Predecessor identity:

```text
id
rootId
rowVersion
localVersion
```

```text
rowVersion alone is not identity
```

Package source revision, plan source revision và local version vẫn là domain độc lập.

---

# 22. REQUIRED FAILING TESTS — TỐI THIỂU

## Decision semantics

```text
sequential_plan_keep_local_conflict_preserves_local_value
sequential_plan_apply_source_conflict_uses_source_value
sequential_plan_local_only_change_survives_materialization
sequential_plan_source_only_change_applies
sequential_plan_required_field_override_reaches_revision_draft
sequential_plan_unresolved_conflict_cannot_start
```

## Ambiguous

```text
sequential_plan_ambiguous_match_uses_selected_local_root
sequential_plan_ambiguous_selection_enables_start
sequential_plan_invalid_ambiguous_target_is_rejected
all_mode_earlier_revision_ambiguity_cannot_be_bypassed_by_clean_latest_revision
```

## Investor

```text
sequential_plan_selected_investor_is_exactly_used
sequential_plan_invalid_selected_investor_is_rejected
sequential_plan_foreign_workspace_investor_is_rejected
```

## Session authority

```text
session_revision_draft_uses_reconciliation_effective_fields
session_decisions_are_bound_to_exact_bundle_digest
session_rejects_decision_mutation_after_materialization_started
resume_preserves_bound_decision_authority
```

## Handoff

```text
inline_plan_post_durable_handoff_failure_preserves_recovery_flow_and_resets_loading
inline_package_post_install_failure_resets_loading_only_for_same_flow
old_inline_flow_failure_cannot_reset_new_flow_loading
```

## Workspace

```text
workspace_change_during_decision_binding_cannot_publish_old_resolved_draft
same_org_new_epoch_during_decision_binding_aborts
flow_replacement_during_decision_binding_cannot_mutate_new_flow
```

## Historical

```text
decision_resolution_does_not_mutate_historical_plan_snapshot
decision_resolution_does_not_mutate_historical_package_snapshot
resolved_revision_targets_exact_immediate_predecessor
```

---

# 23. BUSINESS MATRIX BẮT BUỘC

Tạo test table:

| Scenario | Base | Local | Source | Decision | Expected |
|---|---:|---:|---:|---|---:|
| Local only | 100 | 120 | 100 | none | 120 |
| Source only | 100 | 100 | 130 | none | 130 |
| Conflict keep | 100 | 120 | 130 | KEEP_LOCAL | 120 |
| Conflict source | 100 | 120 | 130 | APPLY_SOURCE | 130 |

Và:

| Scenario | Expected |
|---|---|
| AMBIGUOUS unresolved | blocked |
| AMBIGUOUS root-b selected | root-b |
| invalid root | reject |
| required field missing | blocked |
| required field supplied | resolved |
| investor B selected | B |

Test cả:
- backend resolved draft;
- frontend materialized state;
- local draft aggregate;
- form value khi phù hợp.

---

# 24. KHÔNG KHÔI PHỤC `canApplyPreview()` CHỈ ĐỂ PASS TEST

`canApplyPreview()` đã bị remove vì production-dead.

Không:

```text
restore helper
→ restore old unit tests
→ DONE
```

Đúng:

```text
restore BUSINESS CONTRACT
as sequential integration tests
```

Contract:
- AMBIGUOUS + valid decision → resolvable;
- conflict + valid KEEP/APPLY → resolvable;
- required issue + valid field value → resolvable.

---

# 25. AUDIT ROUND 1 — DATAFLOW MAP

Trước khi sửa, trace:

```text
DOM
→ this.decisions
→ PlanImportDraftStore
→ prepare/session
→ backend validation
→ persistent session
→ get revision draft
→ frontend materialization
→ form
→ local draft
→ final persistence
```

Cho từng:
- packageMatches;
- fieldConflicts;
- fieldValues;
- investorId.

Mark exact point bị drop.

---

# 26. FIX ROOT CAUSE

Sau khi có failing tests:
- implement one authoritative decision seam;
- không sửa tests theo bug;
- không duplicated decision resolver;
- không bypass server authority.

---

# 27. AUDIT ROUND 2

Sau fix:

```bash
rg -n "decisions|effectiveFields|localFields|sourceFields|baseFields"
rg -n "Object\.assign\(.*source"
rg -n "flowHandoffCompleted|pendingNextUiRecovery"
rg -n "investorId"
```

Tìm same-class:
- UI input captured but unused;
- preview metadata dropped at session;
- validated backend data not reaching draft;
- source overlay bypassing field ownership;
- loading ownership set only after await;
- old flow completion touching new flow.

Nếu finding mới:

```text
ADD TEST
FIX
REPEAT
```

---

# 28. PACKAGE/NOTICE/OPENING REGRESSION

Audit và run:
- direct package sequential import;
- NoticeImportWizard;
- OpeningImportWizard;
- financial opening;
- linked notice package histories.

Không đổi behavior ngoài finding confirmed.

---

# 29. DRAFT / TOMBSTONE / REV0 REGRESSION

Run:
- PlanVersionDraftSession;
- exact tombstones;
- anti-resurrection;
- rev0 first-save capability;
- workspace isolation.

Không regress.

---

# 30. TARGETED TESTS

Ít nhất:

```bash
node --test tests/js/procurement_import_wizard.test.mjs
node --test tests/js/procurement_lookup_wizard.test.mjs
node --test tests/js/plan_version_draft_session.test.mjs
node --test tests/js/package_version_inheritance.test.mjs
```

Backend: tìm đúng file tests hiện có rồi chạy procurement/session tests.

Ví dụ nếu tồn tại:

```bash
python -m pytest -q tests/test_procurement_import*.py
```

Không ghi command giả nếu file không tồn tại.

---

# 31. FULL REGRESSION

Bắt buộc chạy các scripts thực sự tồn tại:

```bash
npm run check:static
npm test
npm run build:secure
npm run audit:dead-code
npm run audit:controller-commands
```

Nếu `npm run check` là full gate hợp lệ:

```bash
npm run check
```

Run.

Python:

```bash
python -m compileall -q backend scripts tests
```

và quality/pytest suites hiện có.

Nếu environment block:
- ghi `NOT RUN` hoặc `BLOCKED`;
- không ghi PASS.

---

# 32. E2E

Nếu E2E hiện có, cover ít nhất:

```text
new plan import
existing plan import
ALL
LATEST
SELECTED
KEEP_LOCAL
APPLY_SOURCE
AMBIGUOUS resolution
required field override
selected investor
cancel next
resume
workspace switch
same-workspace flow replacement
post-durable UI recovery
```

Không phụ thuộc live MSC cho deterministic regression.

---

# 33. NO DUPLICATE ON RETRY

Post-durable UI failure:

```text
retry UI/recovery
```

không được tạo:
- second plan id;
- duplicate revision;
- duplicate draft session;
- duplicate package history.

Giữ hoặc cải thiện `pendingNextUiRecovery`.

---

# 34. DEAD-CODE TOOLING

`audit_frontend_reachability.mjs` chỉ chứng minh module reachable, không chứng minh symbol live.

Không dùng:

```text
294/294 reachable
```

để kết luận decision path đúng.

Nếu an toàn, có thể thêm ratchet cho **new** controller exports thiếu runtime evidence, nhưng:
- không auto-delete;
- không làm phân tán task chính.

---

# 35. DOCUMENTATION

Nếu session state/decision binding thay đổi, update/create canonical doc:

```text
docs/MSC_PLAN_VERSIONING_STATE_MACHINE.md
```

Document:
- preview authority;
- decision binding;
- resolved session;
- revision draft;
- local materialization;
- save/resume/cancel;
- workspace/flow capability;
- post-durable recovery.

---

# 36. STOP CONDITION

Chỉ DONE khi:

```text
1. No known actionable decision-semantics bug remains.

2. Every user-visible conflict/match/required-field/investor control
   has proven effect or is intentionally removed.

3. Sequential revision drafts use authoritative resolved semantics.

4. Local-only changes survive.

5. KEEP_LOCAL is honored.

6. APPLY_SOURCE is honored.

7. Ambiguity cannot bypass validation.

8. ALL mode cannot hide unresolved earlier revisions.

9. Selected investor behavior is deterministic and tested.

10. Post-durable handoff failure cannot strand loading UI.

11. Old flow cannot mutate/reset new flow.

12. Workspace/epoch isolation remains intact.

13. Historical snapshots remain immutable.

14. No duplicate durable revision on retry.

15. Targeted + full regression that can run have actually passed.

16. Post-fix audit finds no same-class architectural violation.
```

---

# 37. TEST PASS KHÔNG ĐỦ

```text
EXPLICIT TESTS PASSING
IS NOT SUFFICIENT EVIDENCE OF COMPLETENESS.
```

DONE =

```text
tests pass
+
post-fix audit
+
business matrix
+
full regression
+
no same-class finding remains
```

---

# 38. CI

Mốc audit hiện tại:

```text
42c956ae2d7093a8a8604c71199b4fad766aa264
combined statuses = []
workflow runs = []
```

Tức:

```text
CI STATUS NOT YET AVAILABLE
```

Fetch status mới ở END_HEAD.

Không gọi local tests là GitHub CI PASS.

---

# 39. INVARIANTS PHẢI GIỮ

```text
EVERY ASYNC SIDE EFFECT BELONGS TO
THE CAPABILITY THAT INITIATED IT.
```

```text
ROLLBACK IS A MUTATION
AND MUST BE CAPABILITY-GUARDED.
```

```text
NO LIVE MATERIALIZATION BEFORE
DURABLE COMMIT POINT.
```

```text
NO RETRY/RELOAD MAY DUPLICATE
A DURABLE OR COMMITTED REVISION.
```

```text
NO ACTIVE LOCAL DRAFT MAY REFERENCE
INVALID SERVER AUTHORITY.
```

```text
NO OLD FLOW COMPLETION MAY MUTATE
A NEW FLOW, EVEN IN THE SAME WORKSPACE.
```

```text
EVERY MSC REVISION TARGETS
THE EXACT IMMEDIATE AUTHORITATIVE PREDECESSOR.
```

```text
ROWVERSION ALONE IS NOT IDENTITY.
```

```text
HISTORICAL SNAPSHOTS ARE IMMUTABLE.
```

New invariants:

```text
EVERY USER DECISION PRESENTED BY THE PREVIEW UI
MUST BE REFLECTED IN THE AUTHORITATIVE RESOLVED DRAFT
OR THE UI MUST NOT PRESENT THAT DECISION.
```

```text
SEQUENTIAL IMPORT MUST NOT BYPASS
THREE-WAY MERGE SEMANTICS.
```

```text
KEEP_LOCAL MEANS KEEP_LOCAL.
```

```text
A CLEAN LATEST REVISION MUST NOT HIDE
AN UNRESOLVED EARLIER REVISION IN ALL MODE.
```

```text
A POST-DURABLE UI FAILURE
MUST PRESERVE DURABILITY
WITHOUT STRANDING THE UI.
```

---

# 40. REPORT CUỐI — BẮT BUỘC

```text
START_HEAD=
END_HEAD=

FILES_CHANGED:
...

ROOT CAUSES:
1.
2.
...

CONFIRMED FINDINGS FIXED:
...

NEW FINDINGS FOUND DURING AUDIT:
...

DECISION DATAFLOW BEFORE:
...

DECISION DATAFLOW AFTER:
...

BUSINESS MATRIX:
...

TESTS ADDED:
...

TARGETED TEST RESULTS:
...

FULL REGRESSION:
...

E2E:
...

CI:
...

REMAINING RISKS:
...
```

Ghi exact commands/results.

Không ghi chung chung:

```text
tests passed
```

Phải ghi kiểu:

```text
node --test tests/js/procurement_import_wizard.test.mjs
PASS 84/84
```

Nếu fail thì ghi FAIL.

---

# 41. FINAL QUALITY BAR

Chỉ kết thúc khi câu này đúng:

```text
PLAN PREVIEW, USER DECISIONS, SEQUENTIAL SESSION,
REVISION DRAFT, LOCAL MATERIALIZATION, SAVE/RESUME
ALL AGREE ON THE SAME AUTHORITATIVE SEMANTICS.
```

Và:

```text
NO KNOWN ACTIONABLE BUG REMAINS
IN THIS AUDITED SUBSYSTEM.
```
