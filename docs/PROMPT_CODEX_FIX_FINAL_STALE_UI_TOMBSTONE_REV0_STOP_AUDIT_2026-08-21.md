# PROMPT CODEX — FIX FINAL STALE UI + TOMBSTONE REVISION-0 RESURRECTION
## STOP-AUDIT TOÀN PROCUREMENT ORCHESTRATION — KHÔNG PHÁT SINH REGRESSION

Repository:
`https://github.com/newstar94/Bidding`

Mốc audit gần nhất:
`1742dc9538fcc7c1603186030c7319205faa9566`

Commit:
`fix(procurement): guard stale orchestration flows`

Commit này đã sửa đúng phần lớn P0 trước:
- PlanImportWizard stale `loadCurrent()` A→B;
- stale flow rebind vào workspace hiện tại;
- InlineLookup Plan/Package A→B;
- package start/next/cancel flow identity;
- Notice apply A→B;
- Opening A→B;
- async employee callback;
- bucket tombstone false-positive;
- state-machine documentation.

**Không được regress bất kỳ fix nào ở trên.**

---

# 1. MỤC TIÊU

Đóng các finding còn lại:

```text
P1-HIGH  removed exact draft revision=0 có thể resurrect sau tombstone compaction
P1       ProcurementInlineLookup stale finally vẫn reset UI
P1       Opening stale target trong same workspace vẫn reset UI ở finally
P1/P2    prepare/catch/finally còn mutate current UI sau khi operation đã stale
```

Sau sửa:

```text
search same-class patterns
→ add deterministic tests
→ fix all confirmed variants
→ full regression
→ stop audit
→ only then DONE
```

---

# 2. FETCH HEAD THỰC TẾ

```bash
git checkout main
git fetch --all --prune
git pull --ff-only
git rev-parse HEAD
git log -1 --oneline
```

Ghi:
`START_HEAD=`

Nếu HEAD mới hơn `1742dc9538fcc7c1603186030c7319205faa9566`:

```bash
git diff 1742dc9538fcc7c1603186030c7319205faa9566..HEAD --   frontend/plans frontend/procurement frontend/packages frontend/app frontend/shared tests docs
```

Reclassify mỗi finding:

```text
CONFIRMED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
```

---

# 3. STOP CONDITION

Chỉ DONE khi:

```text
1. Removed exact draft không resurrect sau compaction, kể cả stale revision=0 clone.
2. Fresh unrelated draft vẫn first-save được.
3. Tombstone/retirement metadata vẫn bounded.
4. Malformed tombstone không poison unrelated future draft.
5. InlineLookup stale completion không reset status/button/loading UI.
6. Opening stale target/package/form không reset current UI kể cả same workspace.
7. Stale prepare/catch/finally không mutate newer flow/wizard/modal.
8. Không còn same-class stale UI side effect trong frontend/procurement.
9. Không còn P0/P1 CONFIRMED trong stop audit.
10. Full quality gates thực sự PASS/BLOCKED có lý do rõ ràng.
```

Nếu thiếu bất kỳ điều nào:
`TASK IS NOT DONE`

---

# 4. CORE INVARIANT

Mọi async continuation phải thuộc đúng capability:

```text
workspace capability
+ flow identity
+ session identity
+ form/modal/target identity
+ request generation
```

Không chỉ data mutation. Các UI side effects sau cũng phải guard:

```text
setStatus
refreshApplyGate
button.disabled
button.innerHTML
setButtonLoading
setLookupLoading
showToast
customAlert
render
openModal
closeModal
DOM mutation
clear preview
clear pointer
cleanup
finally reset
```

---

# 5. P1-HIGH — STALE REVISION=0 RESURRECTION SAU TOMBSTONE COMPACTION

Current model:
- envelope v4;
- exact tombstones;
- max 256 tombstones;
- compaction xóa oldest tombstone.

Current save logic đại ý:

```js
if (current.tombstones[draftId]) throw stale;

const index = current.sessions.findIndex(...);

if (index < 0 && expectedRevision !== 0) {
  throw stale;
}
```

Sau khi exact tombstone của X bị compact:

```text
tombstone absent
index = -1
expectedRevision = 0
```

stale pre-first-save clone có thể bị coi là fresh draft.

## Required failing test first

```text
stale_revision_zero_clone_cannot_resurrect_after_exact_tombstone_compaction
```

Scenario:

```text
1. Create draft X revision=0.
2. Keep stale clone S0 của X trước first durable save.
3. Save X -> durable revision=1.
4. Remove X -> exact tombstone.
5. Create/remove enough unrelated drafts để X tombstone bị compact.
6. save(S0), same draftId X, revision=0.
7. MUST reject.
```

Phải prove FAIL trước fix.

---

# 6. EXACT + BOUNDED ANTI-RESURRECTION REQUIREMENT

Thiết kế phải đồng thời đạt:

```text
A. exact removed draft cannot resurrect
B. stale revision=0 clone cannot resurrect
C. fresh unrelated draft always can first-save
D. malformed legacy metadata cannot poison unrelated draft
E. durable metadata remains bounded
F. multi-tab CAS remains correct
```

Không được:
- chỉ tăng tombstone limit;
- giữ tombstone mãi mãi;
- quay lại 64 hash buckets;
- dùng Bloom filter nếu false positive làm reject user data;
- reject tất cả revision=0 theo thời gian;
- giả định stale revision=0 không tồn tại.

Có thể chọn:
- durable generation/nonce authority;
- exact retired identity digest + generation namespace;
- monotonic namespace/epoch;
- kiến trúc exact bounded khác có proof.

---

# 7. TOMBSTONE TEST MATRIX

Bắt buộc:

```text
stale_revision_zero_clone_cannot_resurrect_after_exact_tombstone_compaction
stale_revision_one_clone_cannot_resurrect_after_compaction
unrelated_fresh_draft_can_first_save_after_many_compactions
fresh_draft_created_before_unrelated_retirements_can_first_save_later
malformed_tombstone_cannot_poison_unrelated_future_draft
removed_exact_draft_cannot_resurrect_after_reload
multi_tab_stale_save_cannot_recreate_removed_draft
retirement_metadata_stays_bounded
legacy_v2_v3_v4_envelope_migrates_without_weakening_anti_resurrection
```

---

# 8. UPDATE TOMBSTONE DOCUMENTATION

Update:
`docs/MSC_PLAN_VERSIONING_STATE_MACHINE.md`

Contract phải là:

```text
A removed durable draft cannot be recreated by any stale snapshot,
including a pre-first-save revision=0 clone,
even after bounded retirement metadata compaction.
```

Document:
- stale rev0 bị chặn thế nào;
- fresh unrelated draft vẫn accepted thế nào;
- boundedness;
- migration semantics.

---

# 9. P1 — PROCUREMENTINLINELOOKUP STALE FINALLY

Current pattern:

```js
catch (error) {
  if (error?.name === "AbortError") return null;
  ...
} finally {
  if (generation === this.requestGeneration) {
    setButtonLoading(button, false);
    setLookupLoading(loadingScreen, form, false);
  }
}
```

`workspaceChangedError()` có:

```text
name = AbortError
code = WORKSPACE_CHANGED
```

Nên catch return nhưng finally vẫn chạy.

Nếu context đã đổi mà generation chưa đổi:

```text
stale A completion
→ finally
→ reset captured UI controls
```

## Required fix

Finally phải verify exact UI capability, không chỉ generation.

Use/extend:

```text
inlineImportCapabilityIsCurrent(...)
```

Before reset require:

```text
generation current
workspace lease current
storage identity current
form identity current
code identity current
target identity if applicable
```

Stale => no status/button/loading mutation.

Catch cũng phải guard trước `setStatus()` nếu context đã đổi.

---

# 10. INLINELOOKUP TESTS

```text
inline_workspace_change_finally_does_not_reset_new_workspace_button
inline_form_change_finally_does_not_reset_new_form_loading_state
inline_old_generation_error_does_not_overwrite_new_status
inline_stale_abort_does_not_clear_new_loading_ui
inline_package_target_change_during_error_path_does_not_touch_new_form
```

---

# 11. P1 — OPENING SAME-WORKSPACE TARGET CHANGE IN FINALLY

Current `assertCurrentWorkspace()` đã check:
- workspace;
- storage;
- selected package;
- package root.

Nhưng finally hiện chủ yếu check:
- workspace lease;
- storage.

Scenario:

```text
same workspace
package A opening pending
→ select package B
→ A becomes stale
→ assert detects target change
→ catch returns
→ finally sees same workspace
→ resets shared button using A operation state
```

## Required fix

Capture:
- workspace lease;
- storage;
- button identity;
- select identity/value;
- package id;
- package root;
- contentWrapper identity for financial opening.

Finally reset chỉ khi **all current**.

---

# 12. OPENING TESTS

```text
opening_same_workspace_target_change_does_not_reset_button
opening_same_workspace_target_change_does_not_restore_old_label
financial_opening_wrapper_replaced_does_not_touch_new_wrapper
opening_stale_error_path_does_not_alert_current_target
opening_old_operation_cannot_clear_new_operation_loading_state
```

Giữ existing A→B tests.

---

# 13. P1/P2 — STALE PREPARE/CATCH STATUS SIDE EFFECTS

Audit patterns:

```js
if (workspace/target changed) {
  this.preview = null;
  this.setStatus(...)
  this.refreshApplyGate()
  return;
}
```

Nếu wizard/modal đã được flow mới reuse, old completion có thể overwrite new UI.

Rule:

```text
If stale because newer context replaced it:
return silently.
```

Chỉ mutate status nếu exact operation capability vẫn current.

---

# 14. FILES PHẢI AUDIT

Tối thiểu:

```text
frontend/procurement/PlanImportWizard.js
frontend/procurement/NoticeImportWizard.js
frontend/procurement/ProcurementInlineLookup.js
frontend/procurement/OpeningImportWizard.js
frontend/procurement/ProcurementImportResume.js
frontend/procurement/ProcurementAutoLookup.js
frontend/procurement/ProcurementLookupPreview.js
frontend/procurement/InvestorResolver.js
frontend/plans/PlanVersionDraftSession.js
```

Search:
- prepare;
- apply;
- monitor;
- catch;
- finally;
- cleanup;
- onProgress;
- setStatus;
- showToast;
- customAlert;
- openModal;
- closeModal.

---

# 15. MECHANICAL STOP-AUDIT SEARCH

Run:

```bash
rg -n "finally" frontend/procurement
rg -n "catch \(" frontend/procurement
rg -n "setStatus|showToast|customAlert|openModal|closeModal|refreshApplyGate" frontend/procurement
rg -n "button\.disabled|button\.innerHTML|aria-busy|dataset\.loading" frontend/procurement
rg -n "await " frontend/procurement
```

For every async continuation answer:

```text
What exact UI/context owns this?
Can newer A2 replace A1?
Does it check generation only?
Does it check workspace only?
Does it check target/form identity?
What happens in catch/finally?
```

---

# 16. SAME-WORKSPACE REPLACEMENT IS MANDATORY

Không chỉ test A→B.

Must test:

```text
same workspace
A1 pending
A2 replaces same UI/context
A1 returns
A1 must no-op
```

Cover:
- Plan prepare;
- Notice prepare;
- Inline lookup;
- Opening;
- financial opening.

---

# 17. STALE ERROR SEMANTICS

Stale conditions:
- WORKSPACE_CHANGED
- FLOW_CHANGED
- FORM_CHANGED
- TARGET_CHANGED
- REQUEST_REPLACED

Không bắt buộc tạo đủ error classes nếu guard đơn giản hơn.

Nhưng:
- stale != network/business failure;
- stale generally no-op current UI;
- do not show stale A error in A2/B.

---

# 18. PRESERVE SERVER-COMMIT RECONCILIATION

Nếu server có thể đã commit:
- stale client completion không được blind retry;
- preserve idempotency;
- do not mutate current workspace.

Especially:
- Notice apply;
- Opening apply;
- cancel/finalize.

---

# 19. PRESERVE PREVIOUS FIXES

Không regress:

```text
Plan loadCurrent(A) cannot start B
origin capability required
Plan same-org epoch safe
Package start/next/cancel flow-safe
Notice apply A cannot load/render/close B
Opening A→B no alert/no reset
employee late callback safe
PlanVersionDraftSession workspace-safe save/remove/hydrate/discard
checkpoint rollback exact capability
off-state candidate materialization
post-durable UI retry no duplicate
predecessor id/rootId/rowVersion/localVersion
exact outbox ACK
F5 conflict boundary
Draft HSDT authority/historical immutability
package version inheritance
```

---

# 20. TEST-FIRST REQUIRED

For every CONFIRMED issue:

```text
add deterministic failing test
run -> prove FAIL
fix root cause
run -> prove PASS
```

No “should fail”.

---

# 21. TARGETED TESTS

At minimum:

```bash
node --test --test-concurrency=1 tests/js/plan_version_draft_session.test.mjs
node --test --test-concurrency=1 tests/js/procurement_import_wizard.test.mjs
node --test --test-concurrency=1 tests/js/procurement_lookup_wizard.test.mjs
```

Add dedicated files if cleaner.

---

# 22. FULL QUALITY GATES

```bash
npm run test:js:coverage

python -m pytest -q   --cov=backend   --cov-branch   --cov-report=term   --cov-report=json:coverage.json   --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json

npm run check:static
npm run build:secure
npm run test:e2e:smoke
npm run test:performance
```

E2E:
- Chromium;
- Firefox;
- WebKit.

Không:
- giảm coverage;
- skip tests;
- arbitrary sleeps;
- disable browsers;
- suppress errors.

Nếu blocked:
report exact BLOCKED reason.

---

# 23. STOP AUDIT ROUND 1

Sau patch, reread all modified files.

Questions:

```text
Did we stop stale data mutation but leave stale UI mutation in catch/finally?
Did we guard workspace but forget target/form identity?
Did we guard generation but forget same-workspace replacement?
Did tombstone fix remove false positive but introduce false negative?
```

Nếu có => continue.

---

# 24. STOP AUDIT ROUND 2

Repeat:

```bash
rg -n "finally" frontend/procurement
rg -n "catch \(" frontend/procurement
rg -n "await " frontend/procurement
rg -n "setStatus|showToast|customAlert|openModal|closeModal" frontend/procurement
```

Không còn P0/P1 actionable.

---

# 25. FINAL TOMBSTONE PROOF

Final report phải giải thích:

```text
How stale revision=0 is rejected after compaction.
How fresh unrelated draft is accepted.
Why exact removed identity remains protected.
Why storage is bounded.
Why malformed metadata cannot poison unrelated IDs.
Why multi-tab CAS remains correct.
```

Tests alone chưa đủ.

---

# 26. FINAL ISSUE MATRIX

| ID | Severity | Finding | Before | Fix | Test | Final |
|---|---|---|---|---|---|---|

Statuses:
`FIXED / ALREADY FIXED / NOT REPRODUCED / RISK ONLY / BLOCKED`

---

# 27. FINAL COMMAND MATRIX

| Command | Result |
|---|---|
| targeted JS | PASS/FAIL |
| JS coverage | PASS/FAIL |
| Python coverage | PASS/FAIL |
| static | PASS/FAIL |
| secure build | PASS/FAIL |
| Chromium | PASS/FAIL/BLOCKED |
| Firefox | PASS/FAIL/BLOCKED |
| WebKit | PASS/FAIL/BLOCKED |
| performance | PASS/FAIL |

No “likely”.

---

# 28. GIT / CI

Record:

```text
START_HEAD=
END_HEAD=
```

Check combined status + workflow runs.

If empty:

```text
CI STATUS NOT YET AVAILABLE
```

Do not claim CI green without evidence.

---

# 29. FINAL QUESTIONS — ANSWER WITH EVIDENCE

```text
1. Can stale revision=0 resurrect after tombstone compaction?
2. Can removed exact draft resurrect after reload?
3. Can fresh unrelated draft be rejected because another draft retired?
4. Can malformed tombstone poison unrelated draft?
5. Can InlineLookup stale finally reset current/new UI?
6. Can InlineLookup stale error overwrite newer status?
7. Can Opening A finalizer reset package B button in same workspace?
8. Can financial opening old wrapper mutate new wrapper?
9. Can old Plan/Notice prepare overwrite newer wizard status?
10. Can same-workspace A1 completion mutate A2 UI anywhere in frontend/procurement?
11. Are all previous Plan/Package/Notice/Opening P0 guards still intact?
12. Did stop audit find any P0/P1 actionable issue?
```

Unsafe answer to 1–10 or 12:
`TASK IS NOT DONE`

---

# 30. FINAL INVARIANTS

```text
REMOVED EXACT DRAFT IDENTITY MUST NEVER RESURRECT,
INCLUDING STALE REVISION=0 CLONES.
```

```text
BOUNDED RETIREMENT METADATA MUST NOT
FALSE-REJECT UNRELATED FRESH DRAFTS.
```

```text
STALE COMPLETION MUST NOT MUTATE CURRENT UI,
INCLUDING CATCH AND FINALLY.
```

```text
WORKSPACE SAFETY IS NOT ENOUGH:
TARGET, FORM, FLOW, MODAL AND REQUEST GENERATION
MUST ALSO REMAIN CURRENT.
```

```text
OLD A1 COMPLETION MUST NEVER TOUCH A2,
EVEN IN THE SAME WORKSPACE.
```

---

# 31. FINAL EXECUTION ORDER

```text
FETCH LATEST
→ RECLASSIFY
→ ADD STALE REV0 FAILING TEST
→ REDESIGN EXACT BOUNDED ANTI-RESURRECTION
→ FIX INLINELOOKUP CATCH/FINALLY
→ FIX OPENING FULL TARGET FINALLY
→ AUDIT PLAN/NOTICE PREPARE STALE STATUS
→ SEARCH ALL PROCUREMENT CATCH/FINALLY
→ FIX SAME-CLASS FINDINGS
→ TARGETED TESTS
→ FULL JS/PYTHON
→ STATIC/BUILD
→ E2E 3 BROWSERS
→ PERFORMANCE
→ STOP AUDIT ROUND 1
→ STOP AUDIT ROUND 2
→ ONLY THEN DONE
```

DONE only when:
- tombstone exact + bounded;
- stale UI side effects gone;
- same-workspace replacement safe;
- previous P0 fixes intact;
- no P0/P1 actionable finding remains.
