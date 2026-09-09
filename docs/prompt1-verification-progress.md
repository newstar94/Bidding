# Prompt 1 verification progress

This is an interim evidence ledger, not a completion report. Prompt 2 has not
started. Preserve the two scopes separately. Updated 2026-09-08 (Asia/Saigon).

## Verified in the current continuation

Latest verification checkpoint: smoke 18168 completed exit 0, 46 passed / 8
existing fixture/platform skips in 7.7 minutes on the durable upsert-revocation
build. Static 6935 completed exit 0. Coverage 97593 completed exit 0 with
1725 passed, no skips, and all 14 critical modules passing. Subsequent added
tests were verified focused; no further production edits followed that build.
No verification process from this checkpoint remains live.

Next work is the completion audit and required final report, including
explicitly classifying fixture skips, remaining diagnostic instrumentation,
current-patch CodeQL evidence, and the scope of transfer E2E coverage. A green
local smoke run does not itself complete those deliverables or erase earlier
intermittent failures.

| Check | Observed result |
| --- | --- |
| Lifecycle isolated at `127.0.0.2:8010` | Exit 0; run `E2E-1788813874261`; contract liquidation, Excel imports, cancellation/rebid, two-envelope award, two lot batches, inherited snapshot and frozen historical package passed |
| Current artifact lifecycle refresh | Exit 0; run `E2E-1788836441556`; all business phases and cleanup passed. Removed 309 mutable test rows, one test organization/account; retained 105 audit and 50 activity rows. Log `data/logs/prompt1-lifecycle-current.log` |
| Lifecycle cleanup | Deleted one test organization/account and 307 mutable fixture rows; retained 103 audit rows and 48 activity rows |
| Harness tests | `node --test tests/js/e2e_harness_quality.test.mjs`: 39 passed |
| Combined readiness/harness tests | 40 passed after correcting the stale source-shape assertion to require readiness, locator click, and semantic low-price dialog validation; full JS coverage rerun remains pending |
| Cleanup and SBOM regressions | `python -m pytest -q tests/test_lifecycle_e2e_fixture.py tests/test_sbom.py`: 10 passed; Python quality check also passed |
| N+1 regressions | `python -m pytest -q tests/test_n_plus_one_regressions.py`: 25 passed |
| Specialist assignment PostgreSQL suite | `python -m pytest -q tests/test_specialist_default_assignment.py`: 25 passed, zero skips with explicit isolated TEST_DATABASE_URL; includes V00/V01 transfer and two-connection transfer/write serialization |
| Mutation authorization and audit tests | `python -m pytest -q tests/test_sync_conflict_authorization.py tests/test_sync_mutation_contract.py tests/test_immutable_mutation_audit.py tests/test_assignment_business_key_conflict.py`: 34 passed, zero skips |
| CI/package tests | `python -m pytest -q tests/test_test_dependencies.py tests/test_production_package.py`: 34 passed |
| Dependency audit | `npm run audit:dependencies`: exit 0; both npm audits and pip-audit reported no known vulnerabilities |
| Package smoke | `python scripts/package_production.py --check`: passed, 876 runtime files, 4,924,863 bytes |
| Archive reproducibility | Two `build_archive` invocations in a temporary directory produced identical 876-file, 4,924,863-byte ZIPs; SHA-256 `6176d35ce983b5df5eb7619ba34dfa283dea91a908c2a810427ccf1aff1e7b7e`; temporary archives removed, not published |
| Secure artifact verification | `python scripts/verify_secure_build_artifact.py`: passed |
| Fresh secure build | `npm run build:secure`: exit 0; 163 obfuscated bundles and route CSS checks passed; log `data/logs/prompt1-secure-build.log` |
| Full JS coverage rerun | `npm run test:js:coverage`: exit 0, 1705/1705 passed, zero skips; lines 53.40%, branches 64.97%, functions 67.22%; 14 critical modules passed; log `data/logs/prompt1-js-coverage.log` |
| Latest JS coverage after new functional fixes | Exit 0; lines 53.46%, branches 64.92%, functions 67.26%; 14 critical modules passed; log `data/logs/prompt1-js-coverage-final.log` |
| Latest combined smoke | Exit 1: 45 passed, 8 skipped, 1 failed in 6.9 minutes. Sole failure: Firefox specialist stamp navigation `NS_BINDING_ABORTED` after login. All WebKit tests including specialist flows passed. Post-login barrier verification pending |
| Full Python coverage rerun | Exit 0: 2186 passed, 1 skipped, 1 deselected in 595.77 seconds; 63.75% branch-enabled coverage, 16 critical modules passed; log `data/logs/prompt1-python-coverage.log` |
| SBOM generation | Final Python artifact now links all 13 declared direct runtime dependencies; two successive generations produced identical SHA-256. Upstream inventory-stage warning remains visible; root links are added afterward, not suppressed |
| Legal production gate | Exit 1 as expected: 27 unapproved facts and 27 placeholders; do not publish production |
| FK index audit on isolated test DB | 214 foreign keys; no missing indexes |
| Startup performance | Exit 0, 30 cold/30 warm samples; cold p95 1195 ms, warm p95 220 ms; longest tasks 72/0 ms |
| First-tab performance | Exit 0; `data/logs/first-tab-performance.json` reports passed, no runtime failures |
| Static checks | `npm run check:static`: exit 0, including quality, schema runtime, migration fixture and E2E discovery |
| Static refresh after SBOM/cleanup/readiness tests | Exit 0; log `data/logs/prompt1-static.log` |
| Secret history scan | Gitleaks 8.30.1 with repository config/ignore list: exit 0, 788 commits, no leaks found; does not cover uncommitted work |
| Unstaged tracked diff scan | Gitleaks `git --pre-commit`: exit 0, 203,554 bytes scanned, no leaks found; Git emitted CRLF conversion warnings; untracked files still need scanning |
| Untracked snapshot scan | All 8 then-untracked files individually scanned via Gitleaks stdin, exit 0, no leaks; newly added cleanup test and later edits require final refresh |
| SBOM tests | `python -m pytest -q tests/test_sbom.py`: 7 passed, including main-generation-path coverage, root mapping, missing/wrong-version/ambiguous rejection, and vendor inventory |

Performance artifacts identify release
`f4bbb7dd8c0e0655180f4b83a94195f6f5ac41ea39f9ee46d4720bea39f63c79`.
These results do not prove GitHub CI success or cover future edits.

## Refreshed GitHub baseline

`git fetch origin` completed; local HEAD and origin/main both resolve to
`1e06300eb3bb8508b770326e37e55f9d31278dcf` (branch main).
GitHub API confirms CodeQL run
https://github.com/newstar94/Bidding/actions/runs/34095272630 completed
successfully for both Python and JavaScript/TypeScript on that commit.
This does **not** analyze the uncommitted patch.

Full CI baseline https://github.com/newstar94/Bidding/actions/runs/34008073708
failed at Canonical static quality, Build reproducible production archive
candidate, and Cross-browser Playwright matrix. Build, Python coverage, JS
coverage, PostgreSQL/FK audit and performance jobs succeeded; publication was
skipped. Current local passing checks must not be described as a new green
GitHub run.

## Still open

Lifecycle 67083 was confirmed stuck on a Playwright Frame.waitForFunction
callback after renderer disappearance. Stopped only its identified browser
child 29412; Node then surfaced cancellation-render timeout and cleaned its
fixture (70 immutable rows retained), exit 1. Inspector ended with Node.
Diagnostic helper now has a Node-side 5-second bound and nonblocking handle
dispose, preserving original failure instead of waiting forever on renderer.
Added page-crash logging. New lifecycle session 73137 is live, same application
artifact; no timeout/business assertion was relaxed.

2026-09-09 live audit of lifecycle 67083: Node 27512 and browser 29412 remain
alive, but Chromium has only GPU/utility children and no renderer process.
Server traffic remains at cancellation panel load. This does not prove the
workflow is progressing; possible pending page/close protocol operation needs
inspection. Cancellation failure diagnostics were changed for future runs to
use the bounded existing diagnostic helper. Do not restart solely on polling
timeouts or report this run passed; its handle is still live.

Final release lifecycle 92206 failed at second lot approval: no authoritative
finalize response or settled approval state within existing deadline. Cleanup
completed, retaining 108 immutable audit/activity rows. Added bounded failure
state diagnostics to lot synchronization helper; 14 helper tests pass. New
run is live as session 67083, E2E-1788883857109, same application artifact.
Do not call final lifecycle gate passed based on older successful runs.

PostgreSQL recovery completed at 23:03:30; pg_isready and SELECT 1 on test DB
passed. No database reset occurred. Final-artifact lifecycle is now running
with direct output, session 92206, run E2E-1788883494748, past opening save and
into evaluation. The earlier startup failure remains environment evidence,
not a functional test result.

Current environment recovery: PostgreSQL was absent at 127.0.0.1:55432;
existing initialized PG17 cluster was started without reset or env edits.
Startup helper 16353 timed out, but PostgreSQL postmaster 4440/startup 28204
continued crash-recovery fsync with advancing file paths (190 seconds at last
observation), and pg_isready reports rejecting connections, not ready.
Do not restart/kill recovery or count the helper timeout as database death.
Lifecycle on final artifact remains pending DB readiness.

Release-9323 lifecycle refresh session 66909 disappeared without a terminal
result; log ends after tender opening. Read-only checks found no lifecycle
process or port-8010 listener. Do not count that attempt as passing. Restarted
with direct tool output to preserve completion evidence. Source/artifact remain
unchanged. Eight smoke skips have now been explicitly enumerated in the report.

JavaScript CodeQL database re-extraction 54452 completed exit 0, source archive
4.70 MiB. Re-analysis of the official javascript-code-scanning suite is now
running, output `data/logs/prompt1-codeql-javascript-fixed.sarif` and log
`data/logs/prompt1-codeql-js-reanalysis.log`. This verifies four test-server
exception-response fixes; no new result count is available yet.

After CodeQL test-server fixes, coverage 90941 completed exit 0: 1736 pass,
zero skips, 53.64/65.34/67.61% and 14 critical modules. JavaScript re-extraction
54452 remains live (CodeQL PID 7468, Java PIDs 22360/31216 at observation);
do not restart from the unchanged top-level log. All application source stays
unchanged; remaining four-warning removal proof awaits re-analysis.

Latest secret scan: tracked diff (~426 KB) and all 17 untracked files passed.
A generic-key alert in this ledger was verified to be the secure-build content
hash near the word "token"; rephrased the heading, no suppression/ignore added.
JavaScript CodeQL re-extraction 54452 remains live after test-server fixes;
static 35621 passed. No application source changes during extraction.

CodeQL local verification underway: official Windows CLI 2.26.4 archive
421626938 bytes verified against SHA-256
7066f60be9393bdefe2d34676c0b4f071920a79fdbe78caff3c7ea31fb0da808.
CLI resides in temporary biddingflow-codeql-40fd2754d89b4c779f2553f5ebab9863.
Database cluster extraction session 18463 is live for Python/JavaScript from
D:\Bidding; official query packs are downloading. Logs:
`data/logs/prompt1-codeql-create.log`, `data/logs/prompt1-codeql-packs.log`.
No CodeQL analysis result exists yet; source is held unchanged.

Package/runtime smoke 7881 completed exit 0 on release
9323a19f06a0610248dd45cfe69db0975c78407a2a5ce620d5df12bd19fc9150:
876 runtime files, 4,934,458 bytes. Browser smoke 50255 remains live in Firefox.
Current worktree has 98 status entries; no commit/push has been performed.
Final review/report must distinguish accumulated implementation changes from
new test/documentation additions and must not claim GitHub CI ran this patch.

Current artifact is held stable during verification. Smoke 50255 remains live
and has entered Firefox. Package/runtime smoke refresh is live in session
7881 (`data/logs/prompt1-current-artifact-package.log`). Source changes are not
being made while these artifact checks run; only evidence documentation is
updated. Release identity remains 9323a19f06a0610248dd45cfe69db0975c78407a2a5ce620d5df12bd19fc9150.

Current build content SHA-256:
`9323a19f06a0610248dd45cfe69db0975c78407a2a5ce620d5df12bd19fc9150`
from dist/secure-build.json. Build 78239 passed. Smoke session 50255 is live
(`data/logs/prompt1-backup-clean-smoke.log`). Source SHA-256 at this checkpoint:
- SyncPullService.js: 8D56CCB3B18CB9717F95FE4B58627C9E7058BEDB09E97CF98F9AF2C5E4E31884
- syncMergeUtils.js: DE66AA3951BAC15AA131E75F029B692243BAE88BF21E438C23502D225D29D624
- planBreakdownDraft.js: A0ED2A523F3430420671AE1A92E01540C5510B27967FA3334DDAF7C13A68E34D

Focused Firefox conflict verification 75643 completed exit 0, 1 passed in
58.0 seconds, including actual 409 conflict and reload assertions after the
response-wait ordering correction. Building final backup-prune source now:
`data/logs/prompt1-backup-clean-build.log`. No E2E suite is currently live.

Conflict E2E wait-order correction: request A is intentionally held while B
commits. Its 10-second response timer previously started before that hold,
charging B's form/save time against A. Response wait now starts after B commit
and immediately before releasing A; HTTP 409/ROW_VERSION_CONFLICT assertions
unchanged. Forty harness tests pass, including wait ordering. Focused Firefox
verification is live in session 75643 (`data/logs/prompt1-conflict-release-order.log`).

Latest coverage 67563 completed exit 0: 1735 passed, zero skips/failures;
lines 53.64%, branches 65.30%, functions 67.61%, all 14 critical modules pass.
Log `data/logs/prompt1-backup-final-coverage.log`. Smoke 69608 is still live
near final WebKit cases on the tab-token artifact; backup-prune source change
was made after that artifact and still needs build/runtime verification.

Live browser verification 72138 on the successful tab-token build reached
both `revoked-open-package-editor-closed` and
`revoked-dirty-plan-breakdown-closed`: two pages in the old assignee context
automatically close dirty package/plan editors and purge list rows after
manager transfer. Full multi-assignee suite remains running. Prior 45283
handle disappeared with a truncated/NUL log; it has no usable completion
evidence and is not counted. Focused reset tests passed 39/39.

Two-tab transfer failure: plan breakdown closes but dirty package modal stays
open, both tabs report server-saved. Investigating shared cursor advancing
before another tab reconciles its own projection. Source now compares the
tab's prior observed token as well as shared committed token. Extracted helper
keeps complexity within existing limit; lint and 18 ordering tests pass.
Build 43577 failed complexity before extraction; E2E 8962 consequently used
old artifact and failed, not evidence against the new helper. It is terminal.
Correct rebuild is live in session 98226 (`data/logs/prompt1-tab-token-build.log`).

Dirty breakdown E2E setup issue diagnosed: legacy fixture plan classification
does not map to the current form and approval type was empty. Test now enters
valid estimate/combined-approval fields and proposal date before submitting
into breakdown, without modifying production validation. Session 89154 is
live (`data/logs/prompt1-dirty-breakdown-transfer.log`). Prior failed attempt
45069 never reached the manager transfer; do not classify it as a revocation
failure. Diff check passes.

Dirty-editor transfer browser coverage: package-editor-only extension passed
full multi-assignee suite (27418), with automatic modal closure and list purge.
The test now opens a second page in the old assignee's same browser context,
edits a plan and enters breakdown before manager removes the package grant.
It asserts both editors close and the plan list purges. Extended suite is live
in session 28034 (`data/logs/prompt1-dirty-breakdown-transfer.log`).

Coverage 39185 completed successfully: lines 53.55%, branches 65.32%,
functions 67.46%, all 14 critical modules pass. ScopedWorkspaceStorage test
confirms revocation metadata does not cross user/organization namespaces;
20 focused tests pass. Smoke 20088 remains live; static 46032 is live after
test additions. Logs use `prompt1-revocation-metadata-coverage`,
`prompt1-persisted-revocation-smoke`, and `prompt1-scope-storage-static`.

Current live build 79803 (`data/logs/prompt1-revocation-metadata-build.log`)
and coverage 39185 (`data/logs/prompt1-revocation-metadata-coverage.log`).
Latest focused sync tests pass 79/79; ordinary pulls avoid unchanged metadata
writes, while necessary storage failures remain visible. Diff check passes.
Previous smoke/coverage results do not cover this persisted revocation-state
implementation yet. Prompt 2 remains untouched.

Cross-tab revocation metadata now refreshes its cached set when scoped storage
changes. Tests cover already-open second model seeing revocation and subsequent
server regrant from the first model; combined revocation/outbox tests pass
29/29. Build session 77236 is live (`data/logs/prompt1-cross-tab-build.log`).
Need final full regression and review storage-failure recovery/metadata growth;
these tests do not replace real multi-tab browser verification.

Revoked projection follow-up: a pending existing upsert could reappear on a
later unchanged-scope pull. A workspace-scoped revoked-ID set now fences those
overlays; server incoming records/manifest regrants remove IDs from the set.
Metadata persists via ScopedWorkspaceStorage so recreated models keep the
fence. No record contents are added to this metadata, and pending mutations
remain in outbox. Seventeen focused tests pass, including recreation, regrant
and surfaced storage-write failure. Build is live in session 99659,
`data/logs/prompt1-persisted-scope-build.log`. This additional state needs full
regression and cross-tab/purge compatibility review before final sign-off.

Outbox acknowledgement regression passed: projection removal acknowledgement
keeps pending existing-record upserts and fresh inserts; 11 outbox tests pass.
This verifies that specific acknowledgement seam, not future replay after
another sync. Smoke 18168 is live near final WebKit startup tests; diff check
passes. Static refresh log: `data/logs/prompt1-static-outbox-current.log`.

Static 14263 and coverage 97593 completed successfully. Coverage reports
lines 53.53%, branches 65.25%, functions 67.41%, all 14 critical modules pass;
log `data/logs/prompt1-upsert-revocation-coverage.log`. Smoke 18168 is still
live. Two later authorized-upsert test cases were run focused and passed;
do not assume they were discovered by the already-started coverage process.

Thirteen targeted draft/revocation tests now cover authorized pending upserts
in both pagination modes, uncommitted drafts, revoked persisted upserts,
manifest replacement writes and later cancellation. All pass. Coverage 97593
and smoke 18168 remain live; smoke has entered Firefox. Static is refreshing
after test additions (`data/logs/prompt1-scope-static-current.log`).

Current live checks after durable upsert-revocation fix: coverage 97593
(`data/logs/prompt1-upsert-revocation-coverage.log`) and smoke 18168
(`data/logs/prompt1-upsert-revocation-smoke.log`). Focused Firefox 59307 ended
2 passed in 31.9 seconds; observed aborted /api/auth/users request occurred
during route navigation and did not prevent the tested saves. Do not infer
that this explains the earlier missing-login-input failure.

Latest process checkpoint: build 62072 and static 49702 passed. Smoke 29253
ended 45 pass / 8 skip / 1 Firefox login-input timeout before business actions;
this is distinct from prior post-submit timeouts. Added pageerror/requestfailed
diagnostics. Focused Firefox run is live in session 59307,
`data/logs/prompt1-firefox-load-diagnostics.log`. Current revocation/order/status/
reconciliation tests pass 85/85; full coverage predates latest upsert filtering.

Latest revocation changes: pending upserts with committed rowVersion,
expectedVersion or base snapshot no longer confer visibility when absent from
the authoritative scope; pending operations themselves are not erased here.
Both pagination modes tested. Manifest filtering now also updates replacement
writes, since BrowserDB replacement operations take precedence over deletions.
The stale replacement regression failed before the fix and passes afterward;
71 focused sync tests pass. Diff check passes. Coverage 25795 completed on an
earlier revision; smoke 29253 remains live near the final WebKit test. Static
refresh is in progress (`data/logs/prompt1-durable-static.log`).

Current active checks: coverage 25795 (`data/logs/prompt1-final-draft-coverage.log`)
and smoke 29253 (`data/logs/prompt1-final-draft-smoke.log`). Chromium portion
has completed without reported failures; no final browser verdict yet.
Revoked draft snapshot is now tested through later cancellation restoration,
and remains absent. Static refresh running after latest test additions.

Partial-to-full reset bug fixed: compare incoming visibility token against
both observed token and committed workspace cursor, preserving reset semantics
after a partial response has advanced observation. Combined ordering/rebase/
sync-status tests passed 65/65. Coverage session 95811 failed on the new
regression before this fix; current coverage refresh is session 77853,
`data/logs/prompt1-scope-final-coverage.log`. Browser session 54419 is still
running on the prior built artifact, so cannot prove this last source edit.

Active verification after draft-revocation changes: JS coverage session 95811
(`data/logs/prompt1-revocation-coverage.log`) and three-browser smoke session
54419 (`data/logs/prompt1-revocation-smoke.log`). Prior smoke before these
changes completed 46 pass / 8 fixture/platform skips; it is not verification
of this new patch. Static and focused reset/rebase tests have passed.

Combined reset/retry test added to sync_pull_ordering: a dirty plan draft is
present before 409 SYNC_VISIBILITY_RESET_REQUIRED, the real forceSyncData
recursion obtains a full snapshot with a new visibility token, and revoked
plan is absent from both model and draft snapshot afterward. All 18 ordering
tests pass. Static refresh is running (`data/logs/prompt1-revocation-static.log`).

Non-paginated full visibility reset now records removed IDs before replacement
so draft rebase cannot restore revoked edits. Regression covers pending new
insert retained alongside revoked patch projection removal; five targeted
tests pass. This does not yet prove all legacy full-upsert mutation cases or
the complete forceSyncData reset/retry path. Build refreshed in progress with
log `data/logs/prompt1-revocation-build-current.log`.

Revocation patch verification: full paginated manifest removal ->
applyServerSnapshot -> draft rebase now has a regression asserting revoked
IDs stay absent in memory, draft snapshot and durable deletion request.
Three revocation tests pass; broader draft/reconciliation run passed 87 tests
before this additional test. Breakdown modal is included in revoked editor
dismissal. Build for this patch is running (log
`data/logs/prompt1-revocation-build.log`). Still audit non-paginated reset and
pending mutations; the manifest test does not cover those cases.

Section 39 audit finding to reproduce: `SyncPullService` invokes
`reconcilePulledPlanBreakdownState` before `dismissRevokedInteractiveState`.
`rebasePlanBreakdownDraftAfterServerMerge` restores locally modified baseline
rows absent from server state. During an authoritative visibility reset this
may reintroduce revoked records, causing subsequent presence-based dismissal
to miss them. Also `modal-plan-breakdown` is not in the scoped editor list.
Need a regression through the visibility-reset merge/rebase sequence and a
scoped fix preserving unrelated offline drafts/independent grants. Existing
simple editor tests do not prove this case safe. Do not change generic draft
rebase behavior without distinguishing authorization reset from ordinary sync.

Current live browser run: 75889 (`data/logs/prompt1-current-smoke.log`), has
completed Chromium and moved to Firefox without a reported failure so far.
This is not a final verdict. Latest focused checks: 14 route reconciliation
tests pass, including preserving authorized/new-record editors; 24 CI/SBOM/
fixture tests pass; diff check passes. Lifecycle 43532 is terminal and passed.

Current verification: first-tab performance 16698 completed successfully with
no failures/runtime failures. Lifecycle refresh on the current clean artifact
is running in session 43532 (`data/logs/prompt1-lifecycle-current.log`), already
past plan/package/goods creation. Diff check passed. Previous local-phase
sequencing tests intentionally require remote sync to wait for local modal
completion; any proposed change there must preserve that race protection and
be justified by actual failing-request diagnostics, not speculation.

Current artifact performance refreshed: startup session 81933 passed, cold
p95 1259 ms, warm p95 332 ms, longest tasks 95/0 ms, release identity
`2eb27b79f3b34339f3ab444930d893025ff6dfe86ff02ed1f87b546555645272`.
Ten focused frontend regression tests passed. First-tab performance is live
in session 16698 (`data/logs/prompt1-first-tab-current.log`). Earlier artifact
timings are historical evidence, not this build's metrics.

Latest verified state: original-CSS control session 36703 completed with
16 passed / 2 fixture skips in 1.8 minutes. Both original and clip runs passed,
so clip is not established as a fix and its experiment branch was removed.
Diff check passed. Current startup performance refresh is running in session
81933 (`data/logs/prompt1-performance-current.log`). No browser suite should
run concurrently against port 8010.

Clip hypothesis remains unproven: original-CSS control 36703 also passed the
wheel case. Removed test-only E2E_DIAG_CLIP_HERO override; production CSS never
changed. Control suite remains live at this checkpoint. The next diagnostic
should distinguish history scroll restoration from compositor input timing,
not infer a CSS fix merely from the clip run's success.

Controlled clip experiment 91584 completed: 16 Chromium tests passed, 2
fixture skips in 1.8 minutes. Original-CSS control run is now active in
session 36703 (`data/logs/prompt1-hero-original-control.log`), explicitly
E2E_DIAG_CLIP_HERO=0. Production stylesheet remains unchanged. Compare wheel
results before deciding whether the clipping change addresses the defect.

Current controlled scroll experiment: session 91584 applies overflow:clip
only to `.landing-hero` via test-only E2E_DIAG_CLIP_HERO=1, before history-wheel
input. The wheel case passed in this run; the rest of Chromium remains running.
This single success is not sufficient causal proof. No production CSS changed.
Remove the experimental environment branch before final CI verification.

Latest live run: session 70245, full Chromium with contractor sync-request
metadata and UI sync-state diagnostics (`data/logs/prompt1-contractor-sync-traffic.log`).
Previous full three-browser run 40434 ended 45 pass / 8 skip / 1 Chromium
contractor response timeout; submit bubble-phase observer confirmed
preventDefault=true. Therefore missing submit interception is not supported.
Inspect whether local render/close completion delays background remote sync;
`MutationService` currently starts remote sync only after local callback promise
settles. This is an investigation lead, not an established root cause.

Newest process checkpoint: Chromium run 13112 completed successfully, 16
passed / 2 fixture skips in 2.0 minutes. Capture-phase microtask submit
diagnostics reported prevented=false even for successfully intercepted saves;
do not infer missing handlers from those values. Observer now logs at window
bubble phase. Full three-browser verification is running in session 40434,
log `data/logs/prompt1-complete-browser-verification.log`. Intermittent history
wheel and absent-response failures remain risks until adequately resolved.

Newest scroll check: nine-test Chromium prefix (session 82118) passed in
40.9 seconds without reproducing the failure. Full Chromium with ancestor
scroll diagnostics is now running as session 20760, log
`data/logs/prompt1-wheel-full-ancestors.log`. Earlier session 49580 is terminal
and failed. Do not infer a causal preceding test from the passing prefix.

Scroll investigation update: full Chromium sequence (session 49580, still
running at observation) reproduced the history-wheel failure. Diagnostic
records one wheel event with deltaY=500 and prevented=false on SPAN; window
scrollY remains zero with a 6755px document and 900px viewport. This rules out
missing wheel delivery and observed preventDefault, but does not prove the
root cause. Inspect ancestor scroll containers/history restoration next.
Log: `data/logs/prompt1-chromium-wheel-context.log`.

Latest smoke diagnostics run (session 2154) is terminal: 45 passed, 8 skipped,
1 Chromium history-wheel scroll failure in 7.2 minutes. All specialist tests
passed in that combined run. Scroll failure showed scrollY=0, document height
6755, viewport 900, vertical overflow visible/auto; no CSS vertical lock was
observed. Added one passive wheel-event observer for failure diagnostics.
The isolated scroll test passed, so it did not identify the cause. A bounded
Chromium landing/scroll sequence is running as session 26709, log
`data/logs/prompt1-wheel-sequence.log`; do not call the scroll defect fixed.

## Verified root-cause notes for final report

- `AuthFlowController.applySessionUser`: session storage received the server
  user ID but model activeuser did not. On fresh navigation, specialist field
  permission checks used an empty ID. Restoring the authenticated ID fixes
  identity hydration without changing module rights.
- `view_helpers.safeImageSrc`: URL grammar rejected the backend's tenant-hash
  subdirectory. Exact optional `t-<24 hex>` support restores authorized image
  display while preserving origin, extension and signed-query checks.
- `GoiThauWorkflow`: package saves included unchanged existing parent plans,
  causing legitimate view-only creation to be rejected as a plan update.
  Compare against the captured parent baseline; send genuine changes only.
  Automatic total changes still require the existing plan-write permission.
- `SystemUserView.populateNhanVienPhuTrachDropdowns`: profile refresh replaced
  form-owned multi-select options, erasing creator selection. Leave initialized
  multi-assignee controls to their form lifecycle.
- `BiddingController.getWorkflowDataKeys`: selective editor loading omitted
  permissionmatrix; opening a contractor could cache a false permission before
  deferred hydration. Load permissions before dispatching those editors.
- `lifecycle_e2e_fixture`: generic cleanup attempted DELETE against immutable
  audit triggers. Preserve/report immutable rows; rollback each failed table
  savepoint and propagate non-FK errors.
- `generate_sbom`: requirements inventory omitted application-to-direct-package
  edges. Map declared requirements to exact inventory components and reject
  missing/ambiguous matches, retaining existing inventory and hashes.

Latest supporting checks: 46 combined CI/package/SBOM/fixture tests passed.
No backend/db files differ in the current tracked diff. These notes are not
the exhaustive final report or authorization review required by the prompt.

Current authoritative checkpoint: JS coverage session 97727 completed with
1711 passed, zero failures/skips; lines 53.49%, branches 64.93%, functions
67.31%, all 14 critical modules passed. Diff check passed. Smoke 90441 ended
with 44 passed / 8 skipped / 2 failures: Chromium history-wheel scroll stayed
at zero, and Firefox contract response wait failed (its old diagnostic then
failed because the form was absent). Both focused diagnostic reruns passed,
which does not establish a fix. Failure diagnostics now tolerate absent form
and capture scroll state. Full smoke with these diagnostics is running in
session 2154 (`data/logs/prompt1-smoke-diagnostics.log`). No other previous
verification session should be presumed live from older ledger text.

Latest active verification (supersedes older process notes below): clean build
session 92025 completed with exit 0; temporary stamp diagnostics are absent
from frontend/e2e source. Nine focused tests for the latest identity, image,
parent mutation, dropdown and permission-hydration fixes passed. Full smoke
on the clean artifact is active in session 90441, with log
`data/logs/prompt1-smoke-hydration-fix.log`. Do not mark the older smoke
confirmation as passing: it reproduced the permission-hydration race.

Current live checks: combined smoke confirmation session 33975
(`data/logs/prompt1-smoke-confirmation.log`) and updated package/runtime smoke
session 19826 (`data/logs/prompt1-package-latest.log`). JS coverage session
15123 completed successfully (1709 passed, zero skipped). Earlier smoke
session 19956 is terminal, failed with 45 pass / 8 skip / 1 Firefox navigation
failure. Focused Firefox post-login-barrier tests passed 2/2 in 33 seconds.

Full Python rerun has completed successfully; session 55538 is terminal.
The unchanged 55% progress was buffered output while migration tests ran,
not a stalled process.

- Complete requirement-by-requirement audit against all sections of Prompt 1,
  including authorization/concurrency and final diff review.
- Audit section 24 UI coverage explicitly: auth-role E2E includes API-driven
  employee create/update, and multi-assignee E2E checks latest-version access
  after transfer. These alone do not prove all specialist create form paths,
  stamp uploads, self-assignment UI, and pending/rejected toast scenarios.

### Section 24 coverage inventory

Latest specialist progress:
- Permission hydration now has a delayed-promise regression through
  `createFeatureServices(...).partners.editContractor`, proving the workflow
  does not open until permissions finish loading. Four startup dependency
  tests passed. Five fixture tests passed, including unchanged manager default.
  Full JS coverage refresh after this fix is running with log
  `data/logs/prompt1-js-hydration-fix.log`.
- WebKit disabled stamp race diagnosed with form-time evidence: active user
  and role were correct, but in-memory permissionmatrix was empty. Selective
  editor data hydration omitted PERMISSIONMATRIX. Added it to known selective
  editor dependencies; dependency test passes. WebKit reproduction then passed
  in 17.1 seconds. Removed temporary form dataset/console diagnostics; clean
  secure build is running. Combined smoke must be refreshed on this fix.
- Firefox diagnostic rerun passed in 19.9 seconds. Added failure diagnostics
  capture invalid fields, submit state, dialogs, toasts and contractor version;
  they do not establish the cause of the earlier intermittent timeout.
  Full three-browser smoke is now running against the updated artifact;
  log `data/logs/prompt1-smoke-latest.log`.
- Full smoke exposed Firefox `NS_BINDING_ABORTED` during immediate navigation
  after login in the new stamp test. Added an authoritative startup
  reconciliation barrier after login-overlay disappearance, before the next
  navigation. This is pending verification, not yet a proven root-cause fix.
- WebKit full specialist plan/package/contract flow passed separately in
  23.3 seconds (exit 0). Latest static gate passed; full JS coverage refresh
  is running after the identity/image/parent-payload/assignee-refresh fixes.
- Contract creation now passes Chromium with view-only employee, automatic
  selection on opening and after form edits, exact PostgreSQL assignment,
  canonical POST and reload. Root cause was `SystemUserView` background profile
  refresh overwriting form-owned multi-assignee options. Initialized controls
  are now left to their form owner. Focused regression and secure build pass.
  The speculative role-label alias change was removed; no role semantics changed.
  Firefox verification is running; WebKit remains to verify for contract flow.
- Firefox contract flow subsequently passed (17.9 seconds), including the
  added form-validity assertion. Its prior missing-response failure is not
  root-caused by that passing rerun; retain this as a flakiness risk rather than
  claiming the assertion fixed it. WebKit is now being verified separately.
- Contractor stamp creation, reload, image decode and cookie-session identity
  restoration passed Chromium/Firefox/WebKit (3 tests, 35.5 seconds).
- Plan form/finalize-draft creation passed all three browsers (32.4 seconds);
  PostgreSQL exact creator-assignment assertion additionally passed Chromium.
- Package creation initially failed because the outgoing batch redundantly
  upserted an unchanged persisted parent plan, correctly denied to view-only
  specialist. `changedPackageParentPlans` now omits unchanged parents while
  retaining genuinely changed totals. Focused test and secure build pass;
  full three-browser plan/package run is active in session 74821.
- Automatic-total parent changes still require existing authorization; this
  patch does not grant permission to modify an existing plan.
- Plan/package creator E2E after unchanged-parent fix passed Chromium and
  Firefox. WebKit failed before login: server stderr shows asyncio Proactor
  socket accept `WinError 64`, not an assertion in the business flow. Preserve
  `data/logs/prompt1-specialist-plan-package.log` as failure evidence. An
  isolated WebKit run is active (78569); no retries/timeouts/assertions changed.

Specialist stamp E2E initially fails before upload: disabled input despite a
correct view permission row in IndexedDB. Diagnostic shows `bf_user_id` is set
but stored `bf_active_user.id` is empty after API-only login followed by direct
navigation. Actual form login followed by navigation reproduced the same
failure. `AuthFlowController` session hydration now restores `activeuser.id`
from the authenticated server user before applying access context. This
restores identity, not permission semantics. Focused tests pass.

That fix exposed a second bug: submitted image is present and the API returns
a managed `/images/nha_thau/t-<24 hex>/...png` path, but `safeImageSrc` rejected
tenant directories. Its grammar now matches the backend's existing optional
tenant segment; same-origin and signed-query validation remain unchanged.
The regression failed before the patch and passed afterward. Secure build
passed; three-browser specialist stamp verification is running in session
52076. Final coverage/performance/package evidence predating these frontend
fixes must be refreshed as appropriate.

- Rejection toast: `e2e/specs/startup-sync.spec.mjs`, test `local durable save
  never shows final success before server rejection`, uses an actual expert
  form and a gated POST response. It asserts local-pending warning, absence of
  success before/after rejection, error toast, and removal from the table.
  Fresh focused run passed on Chromium, Firefox and WebKit: 3 passed in
  18.8 seconds, exit 0; log `data/logs/prompt1-rejection-browser.log`.
- Specialist plan/package/contract and contractor+stamp form creation now
  has `e2e/specs/specialist-create.spec.mjs`, using employee/view-only fixtures.
  Each browser has passed focused creation checks, including PostgreSQL
  assignments, selected package/contract assignees and reloaded stamp decode.
  Combined smoke exposed a Firefox navigation failure; latest post-login
  reconciliation barrier remains pending verification.
- Transfer: multi-assignee suite verifies latest snapshot denial while
  retaining an independent historical assignment; review UI removal and new
  assignee reception separately from API assertions.
- Consolidate earlier Python/JS coverage and cross-browser evidence; verify
  evidence applies to the final worktree.
- Check uncommitted source changes for secrets; obtain or explicitly classify CodeQL evidence.
- Final review of SBOM fix: direct root links are verified; it deliberately
  does not invent transitive edges absent from the requirements inventory.
- Verify all database/package/reproducibility requirements and safely inventory
  old test fixtures before any further cleanup.
- Produce the specified final report, keeping production legal readiness
  `BLOCKED — external legal facts missing`.
- Only after Prompt 1 is genuinely complete, read and remember Prompt 2 and
  begin the separately tracked Tabler implementation.
