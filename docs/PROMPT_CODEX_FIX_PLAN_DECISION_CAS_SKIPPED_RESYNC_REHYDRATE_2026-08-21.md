# PROMPT CODEX — FIX FINAL PLAN DECISION AUTHORITY GAPS
## PREDECESSOR CAS + SKIPPED REVISION SCOPE + RESYNC REQUIRED FIELDS + DECISION UI REHYDRATION
## NO REGRESSION · POST-FIX STOP AUDIT REQUIRED

Repository:

```text
https://github.com/newstar94/Bidding
```

Mốc audit gần nhất:

```text
58f41960be02a6b5148b1ebdba5de4eed77c79fd
```

Commit:

```text
feat(procurement): introduce authoritative sequential state machine for MSC plan import
```

Ngày audit:

```text
2026-08-21
```

---

# 0. MỤC TIÊU

Commit `58f41960...` đã sửa đúng phần lớn decision semantics của sequential plan import:

```text
Preview
→ user decisions
→ server bind/validate
→ decisionAuthority
→ resolved revisions
→ sequential revision draft
→ frontend materialization
```

Các phần đã đúng và **KHÔNG ĐƯỢC REGRESS**:

```text
KEEP_LOCAL
APPLY_SOURCE
effectiveFields
three-way merge
selected investor authority
server validation of package target
decisionAuthority persistence
decisionsDigest locking
post-durable inline handoff loading recovery
ALL-mode decisionPackages concept
workspace/flow guards
```

Nhưng audit sau commit xác nhận còn 4 finding:

```text
P1-HIGH  Missing exact plan/predecessor CAS at decision binding
P1-HIGH  Skipped revision can create frontend/server decision deadlock
P1       RESYNC required-field issue may be enforced server-side but not surfaced in UI
P1       Restored decisions may be submitted while rendered controls look blank
```

Task này phải sửa **root cause** của cả 4 finding và tìm toàn bộ same-class variants.

---

# 1. KHÔNG ĐƯỢC CHỈ SỬA 4 TEST CASE

Workflow bắt buộc:

```text
FETCH LATEST
→ RECLASSIFY
→ MAP AUTHORITY
→ ADD FAILING TESTS
→ FIX ROOT CAUSE
→ TARGETED TESTS
→ FULL REGRESSION
→ AUDIT SAME-CLASS
→ STOP AUDIT
→ ONLY THEN DONE
```

Không được:

```text
patch named line
→ existing tests pass
→ DONE
```

---

# 2. FETCH HEAD THỰC TẾ

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

Không giả định `58f41960...` vẫn là HEAD.

Nếu HEAD mới hơn:

```bash
git diff 58f41960be02a6b5148b1ebdba5de4eed77c79fd..HEAD -- \
  backend/procurement_import \
  frontend/procurement \
  frontend/plans \
  frontend/packages \
  tests \
  docs
```

Reclassify mỗi finding:

```text
CONFIRMED
ALREADY FIXED
NOT REPRODUCED
RISK ONLY
```

---

# 3. FILES BẮT BUỘC AUDIT

Ít nhất:

```text
backend/procurement_import/decisions.py
backend/procurement_import/session.py
backend/procurement_import/routes.py
backend/procurement_import/service.py
backend/procurement_import/repository.py
backend/procurement_import/domain.py
backend/procurement_import/draft_mapping.py

frontend/procurement/PlanImportWizard.js
frontend/procurement/ProcurementImportClient.js
frontend/procurement/ProcurementInlineLookup.js
frontend/procurement/SequentialRevisionController.js
frontend/procurement/ProcurementDraftWorkflow.js
frontend/procurement/ProcurementImportResume.js

frontend/plans/PlanVersionDraftSession.js
frontend/plans/KeHoachWorkflow.js

tests/js/procurement_import_wizard.test.mjs
tests/js/procurement_lookup_wizard.test.mjs
tests/test_procurement_import_service.py
tests/test_procurement_import_routes.py

docs/MSC_PLAN_VERSIONING_STATE_MACHINE.md
```

---

# 4. AUTHORITY MAP PHẢI ĐƯỢC VIẾT RA TRƯỚC KHI SỬA

Trace:

```text
prepare local state
→ preview.expectedRowVersion
→ preview.expectedPredecessor
→ import session
→ bundleDigest
→ decision binding
→ decisionAuthority
→ revision draft
→ local materialization
→ local draft
→ final persistence
```

Authority phải bao gồm khi existing plan:

```text
plan id
plan rootId
plan localVersion
plan rowVersion
plan latest identity
workspace lease / epoch
session id
bundle digest
```

Không chỉ package target CAS.

---

# 5. P1-HIGH — MISSING PLAN/PREDECESSOR CAS

Current preview đã có:

```text
expectedRowVersion
expectedPredecessor:
  id
  rootId
  localVersion
  rowVersion
```

Nhưng decision binding hiện chủ yếu nhận:

```text
bundleDigest
decisions
workspaceLease
```

và validate:
- investor;
- package targets.

Không đủ để phát hiện:

```text
prepare on plan P rowVersion=5
→ another tab/user edits plan
→ rowVersion=6
→ old session binds decisions
```

---

# 6. REQUIRED INVARIANT — PLAN AUTHORITY

Before binding decisions OR before first resolved revision can be materialized:

```text
CURRENT AUTHORITATIVE PLAN PREDECESSOR
MUST EXACTLY MATCH
THE PREDECESSOR CAPABILITY CAPTURED AT PREVIEW/SESSION CREATION.
```

Identity must include at least:

```text
id
rootId
localVersion
rowVersion
```

If plan is new:

```text
expected predecessor = none
```

and server must ensure no conflicting authoritative plan unexpectedly appeared if that matters to same family/import semantics.

---

# 7. DO NOT TRUST CLIENT CAS AS SOURCE OF TRUTH

Preferred:

```text
session stores expectedPredecessor server-side at creation
```

Then bind endpoint can validate:

```text
stored expectedPredecessor
vs current DB
```

Do not require client to resend entire predecessor object if server already owns it.

If client sends only opaque expected authority/digest:

```text
server must validate against session-stored authority.
```

Client CAS metadata is not authority by itself.

---

# 8. REQUIRED SERVER VALIDATION

For existing plan:

Query exact current latest plan for:

```text
organizationId
familyNo
rootId
```

Validate:

```text
current.id == expected.id
current.rootId == expected.rootId
current.localVersion == expected.localVersion
current.rowVersion == expected.rowVersion
current is still latest
```

If mismatch:

```text
PROCUREMENT_PREVIEW_STALE
```

or equivalent canonical stale-authority error.

Do not silently recompute against new plan.

---

# 9. PACKAGE CAS STILL REQUIRED

Keep existing target validation:

```text
localRootId
snapshotId
localVersion
rowVersion
isLatest
organization scope
```

Plan CAS and package CAS are both needed.

Do not replace one with the other.

---

# 10. REQUIRED TESTS — PLAN CAS

Add failing tests first:

```text
plan_changed_after_preview_before_decision_binding_is_rejected
same_root_new_rowversion_cannot_bind_stale_session
same_root_new_local_version_cannot_bind_stale_session
predecessor_snapshot_id_changed_before_binding_is_rejected
new_plan_session_rejects_unexpected_authoritative_family_conflict_if_applicable
```

Also test:

```text
package unchanged
but plan changed
→ still reject
```

---

# 11. P1-HIGH — SKIPPED REVISION DECISION DEADLOCK

Current session creation can drop:

```text
ALREADY_IMPORTED
PROVENANCE_ONLY
```

when newer pending revisions exist.

That behavior is correct.

Problem:

```text
preview.decisionPackages
```

can still contain ambiguity/conflicts from revisions that are NOT in:

```text
importSession.revisions
```

Frontend then requires decisions for skipped revision.

Server decision authority scopes to session revisions and rejects skipped-revision decisions.

Result:

```text
not selected → frontend blocks
selected → server rejects
```

Deadlock.

---

# 12. REQUIRED INVARIANT — DECISION SURFACE == SESSION SURFACE

The public decision surface shown to user must satisfy:

```text
EVERY RENDERED REQUIRED DECISION
BELONGS TO A REVISION
THAT THE ACTIVE IMPORT SESSION WILL ACTUALLY PROCESS.
```

And:

```text
EVERY SESSION REVISION THAT REQUIRES A DECISION
MUST BE REPRESENTED IN THE PUBLIC DECISION SURFACE.
```

No extra.
No missing.

---

# 13. PREFERRED FIX FOR SKIPPED REVISION SCOPE

Preferred server-owned approach:

At session creation determine:

```text
activeRevisionIds
```

Then public preview/import session should expose decision UI derived only from:

```text
activeRevisionIds
```

Possible designs:

### Option A

Return:

```text
importSession.decisionPackages
importSession.blockingIssues
```

already scoped.

### Option B

Return active revision IDs and frontend filters:

```text
preview.decisionPackages
preview.blockingIssues
```

to exact active session revisions.

Server-side scoping is preferred to avoid divergent rules.

---

# 14. DO NOT FILTER ONLY BY REVISION NUMBER STRING IF ID EXISTS

Use exact revision identity:

```text
revisionId
```

not only:

```text
revisionNumber
```

unless domain guarantees uniqueness and tests prove it.

---

# 15. REQUIRED TESTS — SKIPPED REVISION

```text
already_imported_ambiguous_revision_does_not_block_new_pending_revision
provenance_only_conflict_does_not_render_or_submit_decision
decisions_for_skipped_revision_are_not_submitted
server_rejects_unknown_decision_but_accepts_exact_active_revision_decisions
active_earlier_revision_ambiguity_still_blocks_all_mode
```

Important distinction:

```text
SKIPPED earlier revision
→ must NOT block

ACTIVE earlier revision
→ MUST block
```

---

# 16. P1 — RESYNC REQUIRED FIELD GAP

Current logic may create public `blockingIssues` only for:

```text
MATERIALIZE
```

while active session can also include:

```text
RESYNC
```

Decision resolver still enforces required fields.

Thus:

```text
RESYNC revision
→ server requires missing field
→ frontend rendered no input
→ user cannot resolve
```

---

# 17. REQUIRED INVARIANT — REQUIRED ISSUES

For every active session revision:

```text
IF SERVER WILL ENFORCE A REQUIRED FIELD
THEN THE USER MUST HAVE A VALID WAY TO RESOLVE IT
BEFORE BINDING.
```

No hidden server-only blocker.

---

# 18. DO NOT SIMPLY DISABLE REQUIRED VALIDATION FOR RESYNC

Unless business rule explicitly says RESYNC can persist incomplete data.

Default:

```text
KEEP VALIDATION.
SURFACE THE ISSUE.
```

---

# 19. DETERMINE ACTIVE MATERIALIZING DISPOSITIONS

Audit actual disposition state machine:

```text
MATERIALIZE
RESYNC
ALREADY_IMPORTED
PROVENANCE_ONLY
...
```

Define one canonical helper such as:

```text
revision_requires_materialization(disposition)
```

or equivalent.

Use it consistently for:

```text
session inclusion
blockingIssues
decisionPackages
required field validation
```

Do not duplicate disposition sets in three files.

---

# 20. REQUIRED TESTS — RESYNC

```text
resync_missing_required_field_is_exposed_to_ui
resync_required_field_value_is_accepted_and_reaches_resolved_draft
resync_without_required_value_cannot_bind
already_imported_missing_required_field_does_not_block_if_revision_is_skipped
provenance_only_missing_required_field_does_not_block_if_revision_is_skipped
```

---

# 21. P1 — RESTORED DECISIONS HIDDEN FROM UI

Current draft store persists:

```text
packageMatches
fieldConflicts
fieldValues
investorId
bundleDigest
```

On matching `bundleDigest`, wizard restores `this.decisions`.

But rendered controls may remain blank.

Danger:

```text
UI shows no decision
but hidden restored state is submitted
```

Now decisions actually affect authoritative resolved data, so this is not cosmetic.

---

# 22. REQUIRED INVARIANT — UI STATE == SUBMITTED DECISION STATE

At any moment user can press Apply:

```text
EVERY DECISION THAT WILL BE SUBMITTED
MUST BE VISIBLE IN THE CURRENT UI.
```

And:

```text
EVERY VISIBLE DECISION
MUST MATCH THE SUBMITTED VALUE.
```

No hidden remembered decision.

---

# 23. PREFERRED FIX — REHYDRATE CONTROLS

After:

```text
renderPackages()
renderIssues()
render investor control
```

apply restored decisions:

```text
package match select.value
conflict select.value
required field input.value
investor select.value
```

Use exact:

```text
packageObservationId
field
```

If restored decision no longer exists in current public decision surface:

```text
DROP IT.
```

Do not submit stale hidden decision.

---

# 24. RESTORE MUST BE AUTHORITY-SAFE

Matching only:

```text
bundleDigest
```

may be acceptable if digest covers exact decision surface.

Audit that assumption.

If background enrichment changes digest:

```text
restored old decisions must not survive unless still valid.
```

If session authority changed:

```text
drop or revalidate.
```

---

# 25. REQUIRED TESTS — REHYDRATION

```text
restored_package_match_is_visible_in_rendered_control
restored_conflict_decision_is_visible_in_rendered_control
restored_required_field_value_is_visible_in_rendered_input
restored_investor_is_visible_in_investor_select
stale_restored_decision_for_removed_issue_is_dropped
bundle_digest_change_clears_restored_decisions
rehydrated_decision_payload_exactly_matches_visible_controls
```

---

# 26. DECISION KEY IDENTITY AUDIT

Audit whether:

```text
packageObservationId
```

is globally unique across selected plan revisions.

If the same observation ID can appear in multiple revisions:

Current keys like:

```text
packageObservationId
packageObservationId:field
```

may collide.

If collision is possible, upgrade decision identity to include:

```text
revisionId
+
packageObservationId
+
field
```

or canonical observation authority.

Do not assume uniqueness without proof/tests.

Required audit test if relevant:

```text
same_observation_id_across_two_revisions_does_not_cross_apply_decisions
```

---

# 27. BACKGROUND ENRICHMENT AUTHORITY

Audit carefully:

```text
draftStore decisions created before enrichment
```

must not silently submit against enriched session if decision surface changed.

Required:

```text
pre_enrichment_decisions_are_invalidated_or_revalidated_after_digest_change
```

Do not let enrichment change server authority while UI keeps stale hidden decisions.

---

# 28. IMPLICIT DECISION AUTHORITY FALLBACK

Audit every caller of:

```text
get_revision_draft()
```

For PLAN session with user-decision surface:

Preferred invariant:

```text
IF ACTIVE PLAN SESSION REQUIRES DECISIONS OR INVESTOR CONFIRMATION,
REVISION DRAFT MUST NOT BE MATERIALIZED
BEFORE DECISION AUTHORITY IS BOUND.
```

Inline auto lookup may intentionally bind empty decisions + selected investor.

Verify this is safe only if:

```text
no ambiguity
no conflicts
no required overrides
```

If required decisions exist:

```text
empty binding must reject
```

No implicit bypass.

---

# 29. INLINE LOOKUP

Plan InlineLookup now binds empty decision lists before load.

Test:

```text
inline_plan_with_ambiguous_package_cannot_auto_bind_empty_decisions
inline_plan_with_conflict_cannot_auto_bind_empty_decisions
inline_plan_with_required_field_cannot_auto_bind_empty_decisions
```

UI should show useful error/recovery path rather than materialize silently.

---

# 30. PREDECESSOR CHANGE AFTER BIND BUT BEFORE MATERIALIZATION

Even with CAS at bind:

```text
bind succeeds
→ another tab changes plan
→ then revision draft/materialization starts
```

Audit this TOCTOU window.

Possible protection:

```text
resolved draft authority includes predecessor capability
```

Frontend materialization compares current live predecessor before applying.

Or server revision draft request revalidates predecessor.

Need at least one defense.

Required test:

```text
plan_changes_after_decision_bind_before_first_materialization_is_rejected
```

This is separate from change before bind.

---

# 31. PREDECESSOR CHANGE BETWEEN REVISION 00 AND 01

For existing persisted chain:

```text
revision 00
→ revision 01
```

The exact predecessor for 01 must remain the session/local-draft expected predecessor.

Do not silently attach to another latest plan.

Required:

```text
revision_01_cannot_rebind_to_unrelated_new_latest_plan
```

---

# 32. DO NOT BREAK CURRENT DECISION RESOLVER

Preserve:

```text
KEEP_LOCAL = localValue
APPLY_SOURCE = sourceValue
local-only merge survives
source-only merge applies
required field overrides bounded
invalid candidate rejected
foreign target rejected
selected investor validated
decisionsDigest idempotency
```

Run all tests added in `58f41960...`.

---

# 33. DO NOT BREAK POST-DURABLE HANDOFF

Preserve:

```text
flowHandoffAttempted before await start
exact importFlowIdentity
same-flow loading reset
old-flow no-op
pendingNextUiRecovery
```

Required existing regression stays green:

```text
inline_plan_post_durable_handoff_failure_preserves_recovery_flow_and_resets_loading
```

---

# 34. DO NOT BREAK WORKSPACE ISOLATION

Keep:

```text
workspace token + epoch
workspaceStorage identity
flow identity
form identity
session identity
```

No stale A→B materialization.

---

# 35. DO NOT BREAK TOMBSTONE / REV0

Keep all PlanVersionDraftSession fixes:

```text
exact bounded retirement
stale revision=0 anti-resurrection
fresh unrelated draft accepted
multi-tab stale save rejected
```

---

# 36. DO NOT BREAK HISTORICAL IMMUTABILITY

Decision/predecessor validation must not mutate historical snapshots.

Only target current/new revision.

---

# 37. SINGLE SOURCE OF TRUTH FOR ACTIVE REVISION SCOPE

Strongly prefer one helper/domain concept used by:

```text
session creation
decisionPackages
blockingIssues
decision authority resolver
frontend public surface
```

Avoid divergent disposition sets across files.

---

# 38. TEST-FIRST REQUIRED

For each confirmed finding:

```text
ADD FAILING TEST
→ prove FAIL
→ implement
→ prove PASS
```

Do not claim hypothetical failure.

---

# 39. BACKEND TEST MATRIX

At minimum:

```text
plan CAS before bind
plan CAS after bind/before materialization
skipped revision scoping
active revision decision scoping
RESYNC required fields
foreign target
invalid investor
digest mismatch
decision lock after first materialization
same decisions idempotent
changed decisions locked
```

---

# 40. FRONTEND TEST MATRIX

At minimum:

```text
skipped decision row not rendered
active earlier ambiguity rendered
restored match rehydrated
restored conflict rehydrated
restored field value rehydrated
restored investor rehydrated
stale restored decision removed
Apply payload equals visible controls
digest change clears stale decisions
```

---

# 41. END-TO-END BUSINESS CASE 1

```text
Plan rowVersion=5
preview
another tab edit → rowVersion=6
old preview Apply
```

Expected:

```text
PROCUREMENT_PREVIEW_STALE
no local materialization
no session progression
no flow installed
no form overwrite
```

---

# 42. END-TO-END BUSINESS CASE 2

```text
00 ALREADY_IMPORTED + AMBIGUOUS
01 MATERIALIZE + CLEAN
```

Expected:

```text
00 does not block UI
no 00 decision submitted
01 materializes
```

---

# 43. END-TO-END BUSINESS CASE 3

```text
00 active RESYNC
missing capitalDetail
```

Expected:

```text
UI shows field input
user enters value
server binds
resolved draft contains value
```

---

# 44. END-TO-END BUSINESS CASE 4

```text
same bundle digest
saved KEEP_LOCAL
close/reopen modal
```

Expected:

```text
select visibly shows KEEP_LOCAL
submitted payload = KEEP_LOCAL
```

---

# 45. END-TO-END BUSINESS CASE 5

```text
saved decision
background enrichment changes bundle digest
```

Expected:

```text
old decision invalidated or explicitly revalidated
```

No hidden stale submit.

---

# 46. RESUME

If server session decision authority is already BOUND:

```text
reload/resume
```

must use server authority.

Do not reconstruct server authority from local wizard draft.

---

# 47. DRAFT STORE RESPONSIBILITY

Document:

```text
PlanImportDraftStore
= transient UI recovery

server decisionAuthority
= authoritative bound decisions
```

Never reverse them.

---

# 48. ERROR SEMANTICS

Reuse deterministic codes where possible:

```text
PROCUREMENT_PREVIEW_STALE
PROCUREMENT_DECISIONS_LOCKED
PROCUREMENT_MATCH_DECISION_INVALID
PROCUREMENT_DECISION_INVALID
PROCUREMENT_REQUIRED_FIELDS_MISSING
```

No raw SQL/internal leakage.

---

# 49. TRANSACTION / LOCKING

Plan/predecessor CAS validation + decision authority bind must occur in same transaction/locking boundary.

Preferred:

```text
BEGIN SERIALIZABLE
→ lock session
→ lock current plan predecessor
→ lock selected package targets
→ validate
→ persist decisionAuthority
→ COMMIT
```

No read/commit gap.

---

# 50. BUNDLE DIGEST

Audit:

```text
prepare
quick enrichment
background enrichment
session update
decision binding
```

The digest used to bind must represent exact canonical bundle whose decision surface is rendered.

If enrichment changes decision surface:

```text
UI/decisions must refresh too.
```

---

# 51. ROUTE SECURITY

Keep:

```text
authentication
active org
kehoach edit permission
session user
session org
workspace lease
tenant-scoped investor/package roots
```

No cross-org enumeration.

---

# 52. PAYLOAD BOUNDS

Keep bounded:

```text
packageMatches
fieldConflicts
fieldValues
string lengths
numeric coercion
```

No unbounded payload.

---

# 53. TARGETED COMMANDS

At minimum:

```bash
node --test tests/js/procurement_import_wizard.test.mjs
node --test tests/js/procurement_lookup_wizard.test.mjs

python -m pytest -q tests/test_procurement_import_service.py
python -m pytest -q tests/test_procurement_import_routes.py
```

If filenames changed, discover and run exact equivalents.

---

# 54. REGRESSION SUITES

Also:

```bash
node --test tests/js/plan_version_draft_session.test.mjs
node --test tests/js/package_version_inheritance.test.mjs
```

and related procurement tests.

---

# 55. FULL QUALITY GATES

Run scripts that actually exist:

```bash
npm run test:js:coverage
npm run check:static
npm run build:secure
npm run audit:dead-code
npm run audit:controller-commands
npm run test:e2e:smoke
npm run test:performance
```

Python:

```bash
python -m pytest -q   --cov=backend   --cov-branch   --cov-report=term   --cov-report=json:coverage.json   --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
```

If exact scripts changed, use current equivalents and report exact commands.

---

# 56. E2E BROWSERS

If supported:

```text
Chromium
Firefox
WebKit
```

If unavailable:

```text
BLOCKED / NOT RUN
```

Do not claim PASS.

---

# 57. STOP AUDIT ROUND 1 — ACTIVE REVISION SCOPE

Search:

```bash
rg -n "ALREADY_IMPORTED|PROVENANCE_ONLY|RESYNC|MATERIALIZE" backend/procurement_import
rg -n "decisionPackages|blockingIssues|revisionPreviews|revisions" backend/procurement_import frontend/procurement
```

Question:

```text
Are active revision sets identical across all layers?
```

If not:

```text
TASK NOT DONE.
```

---

# 58. STOP AUDIT ROUND 2 — CAS / AUTHORITY

Search:

```bash
rg -n "expectedPredecessor|expectedRowVersion|rowVersion|localVersion|rootId" backend/procurement_import frontend/procurement
```

For every transition:

```text
prepare
bind decisions
get revision draft
start materialization
next revision
```

ask:

```text
What exact predecessor capability is assumed here?
Can it have changed since prior await/request?
```

Fix same-class gaps.

---

# 59. STOP AUDIT ROUND 3 — RESTORED UI STATE

Search:

```bash
rg -n "draftStore|restoreDraft|this.decisions|renderPackages|renderIssues|captureDecision" frontend/procurement/PlanImportWizard.js
```

Ensure:

```text
stored decision
rendered control
submitted payload
```

remain identical.

---

# 60. STOP CONDITION

Only DONE when:

```text
1. Plan/predecessor CAS exists and is transactionally enforced.
2. Plan changed before decision bind is rejected.
3. Plan changed after bind but before first materialization is safely rejected or proven impossible.
4. Skipped revisions do not contribute decision UI or payload.
5. Active earlier revisions still contribute required decisions.
6. RESYNC required fields are visible and resolvable.
7. Restored decisions are visibly rehydrated.
8. Stale restored decisions are dropped.
9. Decision payload equals current visible UI state.
10. Background enrichment cannot leave stale hidden decisions.
11. All previous KEEP_LOCAL/APPLY_SOURCE/effectiveFields/investor fixes remain correct.
12. Post-durable handoff remains correct.
13. Workspace/flow guards remain correct.
14. No P0/P1 actionable finding remains in post-fix audit.
15. Full tests/build/static/quality gates are reported truthfully.
```

---

# 61. REQUIRED FINAL ISSUE MATRIX

| ID | Severity | Finding | Root cause | Fix | Test | Final |
|---|---|---|---|---|---|---|

Include at minimum:

```text
PLAN-CAS
SKIPPED-REVISION-SCOPE
RESYNC-REQUIRED
DECISION-REHYDRATION
```

plus any new finding.

---

# 62. REQUIRED COMMAND MATRIX

| Command | Result |
|---|---|
| targeted JS | PASS/FAIL |
| targeted Python | PASS/FAIL |
| full JS coverage | PASS/FAIL |
| full Python coverage | PASS/FAIL |
| static | PASS/FAIL |
| secure build | PASS/FAIL |
| dead-code audit | PASS/FAIL |
| controller audit | PASS/FAIL |
| Chromium | PASS/FAIL/BLOCKED |
| Firefox | PASS/FAIL/BLOCKED |
| WebKit | PASS/FAIL/BLOCKED |
| performance | PASS/FAIL |

No “likely”.

---

# 63. CI STATUS

At end:

```text
END_HEAD=
```

Check combined status + workflow runs.

If empty:

```text
CI STATUS NOT YET AVAILABLE
```

Do not call local tests CI.

---

# 64. FINAL QUESTIONS — CODE + TEST EVIDENCE

```text
1. Can an old preview bind after plan predecessor changed?
2. Can predecessor change after bind and before materialization without detection?
3. Can a skipped ALREADY_IMPORTED revision block UI?
4. Can a skipped revision decision be submitted?
5. Can an active earlier ambiguity be bypassed?
6. Can a RESYNC required field be enforced without being shown?
7. Can a restored hidden KEEP_LOCAL be submitted while UI is blank?
8. Can enrichment change digest while stale decisions remain active?
9. Does submitted decision payload exactly match visible controls?
10. Are previous KEEP_LOCAL/APPLY_SOURCE/investor/effectiveFields semantics intact?
11. Can old flow mutate new flow?
12. Does stop audit find any remaining P0/P1 issue?
```

Unsafe answer to 1–9, 11, or 12:

```text
TASK IS NOT DONE.
```

---

# 65. FINAL INVARIANTS

```text
PREVIEW AUTHORITY IS NOT JUST A BUNDLE DIGEST.
IT ALSO INCLUDES THE EXACT LOCAL PREDECESSOR CAPABILITY.
```

```text
THE DECISION SURFACE MUST EXACTLY MATCH
THE ACTIVE SESSION REVISION SURFACE.
```

```text
IF THE SERVER REQUIRES A USER DECISION,
THE UI MUST EXPOSE THAT DECISION.
```

```text
NO HIDDEN RESTORED DECISION MAY BE SUBMITTED
WITHOUT BEING VISIBLE TO THE USER.
```

```text
KEEP_LOCAL MEANS KEEP_LOCAL.
```

```text
A SKIPPED REVISION MUST NOT BLOCK
AN ACTIVE LATER REVISION.
```

```text
AN ACTIVE EARLIER REVISION MUST NOT BE BYPASSED.
```

```text
THE EXACT PLAN/PACKAGE PREDECESSOR MUST REMAIN CURRENT
AT THE POINT WHERE ITS DECISION AUTHORITY IS BOUND/MATERIALIZED.
```

---

# 66. FINAL EXECUTION ORDER

```text
FETCH LATEST
→ MAP PLAN/PACKAGE/SESSION AUTHORITY
→ ADD PLAN CAS FAILING TESTS
→ ADD SKIPPED REVISION DEADLOCK TESTS
→ ADD RESYNC REQUIRED-FIELD TESTS
→ ADD DECISION REHYDRATION TESTS
→ FIX SERVER ACTIVE-REVISION SCOPE
→ FIX PLAN PREDECESSOR CAS
→ FIX RESYNC ISSUE SURFACE
→ FIX UI REHYDRATION
→ AUDIT DIGEST/ENRICHMENT
→ AUDIT IMPLICIT AUTHORITY
→ TARGETED TESTS
→ FULL REGRESSION
→ STOP AUDIT ROUND 1
→ STOP AUDIT ROUND 2
→ STOP AUDIT ROUND 3
→ ONLY THEN DONE
```

Do not conclude DONE merely because named tests pass.

DONE only when:

```text
NO KNOWN ACTIONABLE P0/P1 REMAINS
IN THIS AUTHORITY / DECISION / MATERIALIZATION SUBSYSTEM.
```
