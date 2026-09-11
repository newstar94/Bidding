# Prompt 1 — completion audit

Status: **complete for Prompt 1 engineering scope on committed HEAD `6caa6651`**.
Subsequent Prompt 2 production-source commit `98ad2688` and later evidence-only
branch commits have also passed fresh remote CI; they do not change the exact
Prompt 1 implementation identity. Production publication is
still **BLOCKED — external legal facts missing** under the explicit section-49
exception. Exact Prompt 1 implementation SHA
`6caa66512207a35a2c274df450f8f23edfb8d57d` has terminal-success Full CI,
CodeQL, N+1 and Supply-chain workflows. Older
in-progress and local-only statements below are chronological evidence, not the
current verdict.
Evidence details and historical failures are in `prompt1-verification-progress.md`.

## Latest verification checkpoint — 2026-09-11

Current Prompt 1 evidence remains the exact Prompt 1 source SHA `6caa6651`.
Full CI `34586538439`, CodeQL `34586538448`, N+1
`34586538419` and Supply-chain `34586538443` are terminal `success`. Full CI
includes all eight engineering
jobs and the cross-browser/full workflow stages. The final regression covers a
tab whose shared visibility cursor was advanced by another tab while its own
in-memory projection remained stale; it escalates an empty delta to a complete
authoritative snapshot before editor reconciliation. Current local static,
1,842-test JavaScript suite, secure build and Platform Admin scale/frontend
budgets pass. The cross-browser prompt is tracked separately. Later integrated
Prompt 2 commits have their own exact-SHA successful workflow evidence in
`admin-dashboard-completion-report.md`.

The remaining entries retain the diagnostic sequence and superseded checkpoints.

2026-09-10: authenticated-socket revocation session 40509 completed exit 0.
Both sockets authenticate before manager transfer; both receive db_changed at
+5 ms, then delta reset/full snapshots and editor dismissal complete. Real
aggregate replay, direct-read/list denial, membership removal and plan clone
assertions also pass. Log `data/logs/prompt1-authenticated-socket-revocation.log`.
This test now explicitly exercises hint-driven revocation; polling with a missed
hint has separate evidence. The earlier failure lacked socket readiness evidence,
so its exact cause is not retrospectively proven by this readiness improvement.

Timed revocation observation session 98575 completed exit 0. Transfer response
at 1788986971356; both page IDs received db_changed at 1788986971359 (+3 ms).
Page 2/1 delta responses were 409 SYNC_VISIBILITY_RESET_REQUIRED at +352/+386 ms;
full snapshots arrived at +514/+660 ms, syncVersion 13, partial=false, no packages.
Both editors closed. Log `data/logs/prompt1-revocation-timed-observation.log`.
This establishes the successful hint→delta reset→full purge path, but cannot
retroactively explain the earlier failed run without its missing event history.

2026-09-10 read-parity run session 94984 completed exit 0: exact version
inheritance/replay, latest-only revocation, direct record denial and pagination
absence, membership-removal pagination 403, and plan inheritance all passed.
Log `data/logs/prompt1-revocation-tab-traffic.log`. Earlier run 41958 failed at
dirty package editor dismissal while the other tab closed; no production change
intervened. This intermittency remains unproven: 20-second editor wait may precede
the existing 30-second polling fallback if a hint is missed, but traffic from a
failing run is needed to establish that cause. Do not increase timeout or call
the intermittent failure resolved based on this passing run alone.

2026-09-10: session 86917 completed exit 0 with real plan aggregate creation and
database-confirmed inheritance of the source plan's explicit manager assignment,
in addition to package aggregate replay/transfer checks. Log:
`data/logs/prompt1-official-plan-version.log`; 15 harness tests pass. This proves
plan assignment cloning through the server command; specialist plan transfer
remains covered separately by PostgreSQL exact-snapshot regressions and must not
be misrepresented as the same end-to-end actor scenario.

2026-09-10: official aggregate version/replay/transfer run session 89499 completed
exit 0 (`data/logs/prompt1-version-replay-isolated-audit.log`), 15 focused harness
tests passed. Replay acknowledges the same generated package ID; inherited
assignees and subsequent latest-only revocation checks pass; activity retained.
Earlier readiness failures were caused by Windows PowerShell 5 removing an
empty AUDIT_CHECKPOINT_DIR variable, exposing default developer checkpoints.
Runner now passes whitespace, which survives child creation and is stripped to
the intended explicit-empty test setting. DB audit-chain verification remains
enabled; no checkpoint was deleted and no structural limit changed.

Real aggregate-version transfer browser run session 79389 completed **exit 0**,
log `data/logs/prompt1-official-version-transfer.log`. New package version is
created by POST /api/versioning/aggregate without caller-supplied assignments;
database fixture verifies exact inherited assignee set. Subsequent removal of C
from only the latest version denies its access while retaining explicit historical
access; later membership checks and dirty-editor revocation pass. Cleanup retained
activity. This closes the package server-generated inheritance evidence gap;
plan/contract scope and test-harness cleanup still need final reconciliation.

Final production-source archive comparison: 380 backend/frontend entries in the
Python snapshot and 350 in the JavaScript snapshot compared to current filesystem
text, **no differences**. Process inventory shows no remaining test Python,
browser, Java or CodeQL process at this checkpoint. This supplements, but does
not extend, the scanners' own 647-Python/686-JS extracted-file coverage reports.

Missed-WebSocket-hint browser verification session 50773 completed **exit 0**:
one hint dropped, syncVersion 0→4, polling active, record converged in 29,914 ms
within the existing test budget. Log `data/logs/prompt1-final-missed-hint.log`.
This verifies polling fallback independently of successful WebSocket delivery.

Final full Python coverage session 83557 completed **exit 0** with persisted
`PYTEST_EXIT_CODE=0`: **2198 passed, 1 skipped, 1 deselected**, 1073.34s,
coverage **63.77%** against 45% gate; new coverage.json written 21:35:35.
Log `data/logs/prompt1-python-final-verbose.log`. The skip is host symlink
creation availability; the deselected browser journey has its separate passing
run. Critical-module gate output is in
`data/logs/prompt1-final-critical-coverage.log`; use it with this fresh coverage,
not the prior 2026-09-08 file.

Verbose final Python coverage session 83557 is active and has passed the prior
55% interruption point, now processing PostgreSQL migration-chain tests. The
observed skip is `test_compile_html_rejects_symlink_resolved_outside_root`, whose
existing guard skips only when creating the symlink raises OSError on the host;
no expected security result or skip condition was changed. Final summary and
critical coverage remain pending; old coverage.json must not be used for them.

Final Python coverage session 30786 disappeared with no Python process remaining,
log stopped at 55%, and coverage.json still dated 2026-09-08. This run is
incomplete, not passing. A fresh full invocation uses verbose test names and a
persisted exit-code footer (`data/logs/prompt1-python-final-verbose.log`) to
identify any repeat interruption. Coverage thresholds/selection remain unchanged;
only reporter verbosity differs. Do not reuse old coverage as final-source proof.

Final Python coverage refresh remains live under session 30786, log
`data/logs/prompt1-final-python-coverage.log`, last displayed progress 55%.
Read-only pg_stat_activity inspection showed no blocking PIDs; an active
database query had zero-second age and the Python process CPU/read counters
increased since the preceding observation. This is not evidence of a dead
test run; do not restart or kill transactions based on buffered pytest output.

Current-source reproducibility verified: two independent `build_archive` calls
produced identical bytes, each 876 files / 4,942,547 bytes, SHA256
`ee1aa85a6cd2ecc9f83b2b844cf731452f82c77d5d5497d0b099d9b41753734a`.
Command exited 0; log `data/logs/prompt1-final-reproducibility.log`.
Candidates remain local in a named temporary directory, no production publication.

Latest gate refresh: legal production check exits 1 by design with 27 unapproved
facts and 27 placeholders (`data/logs/prompt1-final-legal-gate.log`). This is the
prompt's permitted external-facts exception, not authorization to publish.
Package/workflow/frontend-asset contract tests: 54 passed, exit 0
(`data/logs/prompt1-final-package-contracts.log`). Final Python and JS CodeQL
analyses completed exit 0, with five contextual findings each, unchanged result
locations; see final SARIFs and `prompt1-codeql-triage.md`. These final analyses
supersede earlier in-progress notes, not the requirement for full diff review.

CRUD exact-acknowledgment rerun log `data/logs/prompt1-crud-canonical-final.log`
contains all completed CRUD markers, postgres-crud-clean, full result JSON and
fixture-removed, with no error/failure entry. Session 82234 is no longer available;
live inventory confirms no test browser/Python process. Wrapper exit was not
recovered, so do not invent an exit code. Browser assertions include the new
exact package ID/rowVersion acknowledgment before edit; prior local-only barrier
failure remains historical evidence rather than silently discarded.

Integrated smoke after violation route-readiness correction, session 8823,
completed **exit 0: 49 passed / 5 skipped (9.3m)** across all three browsers.
Log `data/logs/prompt1-smoke-route-final.log`. Three procurement fixture skips
have separate 3/3 execution evidence; two touch tests are Chromium-specific.
Violation now executes and passes in the full matrix, including Firefox.
CRUD rerun with exact package acknowledgment barrier starts next, log
`data/logs/prompt1-crud-canonical-final.log`; do not claim that change verified yet.

CRUD create→edit readiness was reviewed: package workflow closes on local
durability, while the CRUD harness immediately clicked edit. Harness now arms
the matching package-create sync response before submit, checks HTTP success,
requires acknowledgment of the exact package ID/rowVersion, and waits for the
existing server-saved UI state before editing. This strengthens the canonical
boundary without altering production save semantics. Syntax and 41 harness
tests pass; browser rerun awaits completion of smoke session 8823. Do not yet
claim the prior intermittent CRUD failure resolved.

Analytics browser journey session 55476 completed **exit 0, 1 passed (48.97s)**
at explicit loopback 127.0.0.2:8010, log `data/logs/prompt1-final-analytics.log`.
Python 3.14 emitted unraisable ResourceWarnings for closing Proactor socket
transports during teardown; do not suppress or describe the run as warning-free.
No remaining test Python/browser process or port-8010 listener observed afterward.

Joint-venture refresh session 97471 completed **exit 0**, fixture removed, log
`data/logs/prompt1-final-joint-venture.log`; includes inspected Word report,
contract, multi-lot and two-envelope branches. Analytics browser journey starts
next with explicit loopback host/port overrides 127.0.0.2:8010. Test defaults
remain ephemeral loopback for CI; production code unchanged.

Low-price/conflict refresh session 1037 completed **exit 0**. Evidence includes
real 409 ROW_VERSION_CONFLICT, rowVersion 1→2, stale offline field not committed,
and server validation rejection. Cleanup reports zero remaining mutable fixture
rows and five retained audit rows. Log `data/logs/prompt1-final-low-price.log`.
Joint-venture browser workflow starts next separately, log
`data/logs/prompt1-final-joint-venture.log`.

Pairwise package refresh session 91474 completed **exit 0**, fixture organization
and account deleted. Log `data/logs/prompt1-final-pairwise.log`; low-price conflict
workflow starts next separately in `data/logs/prompt1-final-low-price.log`.

Auth roles session 93763 and dedicated auth-shell invocation both completed
exit 0. Logs `data/logs/prompt1-final-auth-roles.log` and
`data/logs/prompt1-final-auth-shell.log`; role fixture removed. Runner now supports
selecting auth-shell alone without repeating smoke/UI. Pairwise package workflow
refresh starts next, `data/logs/prompt1-final-pairwise.log`, one browser suite only.

UI-quality refresh session 28009 completed **exit 0**, including configured
mobile/tablet/desktop auth surfaces, keyboard focus and validation/network error
feedback. Log `data/logs/prompt1-final-ui-quality.log`. Auth-role browser refresh
started next separately, log `data/logs/prompt1-final-auth-roles.log`.

Bidder-goods refresh session 65647 completed **exit 0**; generated workbook
fixtures persisted in single-envelope and financial-opening paths, technical
two-envelope paths kept the expected goods UI unavailable; fixture removed.
Log `data/logs/prompt1-final-bidder-goods.log`. UI-quality browser refresh starts
separately next, log `data/logs/prompt1-final-ui-quality.log`.

CRUD refresh initially failed opening a newly created package editor (session
86681). Added failure-only state/HTTP diagnostics; rerun session 37827 completed
exit 0 through all CRUD, invalid PDF/upload/download/delete, all-version deletion
and PostgreSQL clean checks; fixture removed. Log
`data/logs/prompt1-crud-package-edit-diagnostic.log`. No production fix intervened,
so the earlier navigation failure is not proven resolved; retain diagnostics and
review canonical save/readiness boundaries. Bidder-goods workflow refresh starts
next in `data/logs/prompt1-final-bidder-goods.log`.

Integrated smoke session 4246 ended exit 1: 48 passed, 5 skipped, one Firefox
violation-test navigation failure. Screenshot remained on package list before
opening details; no opening tab existed. Test now awaits route reconciliation
after its second navigation and asserts the active detail pane before clicking
opening. Focused Firefox session 57650 passed exit 0 (21.3s test), log
`data/logs/prompt1-violation-firefox-route-ready.log`; do not claim the preceding
full smoke was green. Final CRUD workflow refresh started separately next, log
`data/logs/prompt1-final-crud.log`.

Final review verified delta paging calls `_prepare_upsert_items` once on the
candidate batch and supplies that mapping to every `_project_candidate` call;
package expert relations are resolved on the batch, not the fallback per-row
path in this production caller. Existing direct relation regression checks full
expert projection. N+1 regression refresh is recorded in
`data/logs/prompt1-final-nplusone.log`. This caller review does not stand in for
the remaining full authorization/diff audit.

Uninstrumented integrated-font measurement session 41806 completed **exit 0**,
passed true, release 903acc6… with current backend font-preload integration:
cold p95 1325 ms, warm p95 236 ms, no >50-ms task reported. Log:
`data/logs/prompt1-font-uninstrumented-check.log`. Threshold remains 100 ms.
Previous 101-ms run is retained; do not imply every observed run passed.
Final static refresh is running in `data/logs/prompt1-font-final-static.log`.
CodeQL/source review and package evidence must include the backend preload change.

Integrated font timeline session 47452 completed exit 1: cold p95 1645 ms,
longest task 75 ms, warm p95 652 ms. Trace starts before each navigation, so
instrumented warm timing is not final performance evidence. Combined font/HTML
regressions now **38 passed**, log `data/logs/prompt1-font-complete-regressions.log`.
Plain production-app measurement is running with NODE_OPTIONS cleared, unchanged
30 cold/30 warm samples and 100-ms long-task gate; log
`data/logs/prompt1-font-uninstrumented-check.log`. Prior 101-ms failure remains
recorded and must be considered when assessing reliability, not erased by reruns.

Official integrated font-preload performance session 15414 finished **exit 1**:
cold p95 1929 ms, warm p95 216 ms pass, maximum long task 101 ms fails the
restored 100-ms limit. The over-budget sample is cold run 1, task begins at
1201 ms during workspace-module-import, with no overlapping resources reported.
Do not claim the preload fix fully resolves performance; 19 frontend asset tests
pass, but trace the current integrated variant before further optimization.
Log `data/logs/prompt1-font-official-performance.log`; current-code timeline
diagnostic started next in `data/logs/prompt1-font-integrated-timeline.log`.

Font preload integration is now in `backend.app.compile_html`, resolving only
validated hashed WOFF2 assets via `resolve_font_preloads`. Original product font
files and CSS are unchanged. Combined asset/transport tests: **34 passed, exit
0**, log `data/logs/prompt1-font-final-tests.log`; Python quality passed earlier.
The uninstrumented performance attempt has no terminal report and its process
handle is missing, so it is not verification evidence. At 14:55 +07 PostgreSQL
recovery PID 23036 is progressing through fsync (200 seconds); do not restart
or reset it. Repeat official performance only after readiness is confirmed.

Hashed-font preload experiment session 73947 completed exit 1: cold p95 1610 ms,
cold longest task 97 ms, warm p95 1458 ms. Log
`data/logs/prompt1-font-preload-resumed.log`. The diagnostic intercepts page
navigation with Playwright routing, which changes cache behavior; warm numbers
cannot isolate the effect of font preloading. No production preload change is
justified by this experiment alone. Use a server-rendered experimental variant
or another cache-preserving comparison before promoting the candidate. Original
font and production CSS remain unchanged, and 100-ms acceptance remains active.

Current-release package check session 4907 completed **exit 0**: 876 runtime
files, 4,942,223 bytes, extracted-runtime smoke passed. Log:
`data/logs/prompt1-projection-final-package.log`. After owner restored 100 ms,
hashed-font preload experiment resumed with original product fonts and unchanged
thresholds, log `data/logs/prompt1-font-preload-resumed.log`. It is diagnostic,
not a production change or final performance verdict.

Superseding owner instruction: restore the recommended **100 ms** startup long
task threshold and resume investigation/optimization. Temporary 150 ms acceptance
and pause are no longer current. Measurement, workflow and profiler fallback
restored consistently; existing performance failures remain unresolved. Do not
reinterpret them as passes under the withdrawn temporary threshold.

Product owner explicitly accepted temporary maximum startup long task **150 ms**
and requested deferring optimization. See `performance-follow-up.md`. Measurement
default, dedicated workflow and profiler fallback now agree on 150 ms; reports
with explicit historical 100-ms thresholds retain their original interpretation.
Two profiler tests pass, including historical-threshold precedence. The active
font-preload experiment was stopped at request; do not use it as final evidence.
Further optimization toward 100 ms is paused, not an unresolved requirement for
the new temporary acceptance. Other Prompt 1 gates and final review remain.

Flex-sizing experiment session 37113 ended exit 1: cold p95 1499 ms,
longest task 111 ms. Browser-only `.main-content { min-width: 0 }` injection did
not bring the maximum task below the unchanged 100-ms limit. Log:
`data/logs/prompt1-startup-flex-experiment.log`. Do not promote this experimental
CSS to production or claim a sizing fix; the experiment does not support it.
Application styles remain unchanged. Layout cost investigation remains open.

Layout-scope diagnostic session 80003 is no longer available; live process and
port inventory confirms no test renderer/server remains. Log contains only 15
cold samples, no final verdict: this run is incomplete, not a pass. Sample 9
records 107-ms long task containing Layout 94.166 ms with dirtyObjects=418,
totalObjects=418, partialLayout=false, root #document. Other observed slow
layouts use the same 418-object whole-document root. This establishes layout
scope but not the invalidation trigger or suitable optimization. Do not restart
based solely on missing output; process absence was verified at 10:57 +07.

Timeline diagnostic session 26242 is live at last poll (28 samples). Cold run 9
has a 103-ms Long Task, matching a RunTask 103.277 ms containing Layout 92.881 ms
on the same renderer thread 2296. Longer script parsing events are on background
threads and are not evidence of main-thread blocking. This narrows the observed
failure to layout cost, not a named application JS hot function. Log:
`data/logs/prompt1-startup-timeline-profile.log`. No production CSS or logic
change selected yet; identify layout scope/trigger before optimizing.

Task-correlated CPU profiling reproduces >100-ms cold tasks (104, 102, 125,
108 ms among the observed 30 cold samples). Within each corresponding interval
the sampling profiler reports only `(program)`, not an attributable JS function.
Log `data/logs/prompt1-startup-cpu-task-profile.log`, session 80514. Do not infer
specific JS hot functions, GPU fault or host contention from this alone. Next
use browser timeline tracing to distinguish script compilation, layout/paint
and other renderer work; profiler instrumentation remains diagnostic only.

Startup CPU diagnostic session 6011 completed exit 0 with 61 profiles
(warmup plus 30 cold/30 warm). Longest instrumented task 94 ms; the 107-ms
failure did not recur. Log `data/logs/prompt1-startup-cpu-profile.log`.
Whole-navigation top samples include idle/program and hydrateStableShell, but
they do not identify the hot function specifically inside the long task. Do not
infer an AdminUserController defect from resource overlap or optimize unrelated
startup behavior based on aggregate samples. This instrumented pass does not
replace the failed uninstrumented gate. Next diagnostic must correlate samples
to the task interval before choosing an optimization.

Performance refresh on release 903acc6… session 85971 ended **exit 1**:
cold p95 1474 ms and warm p95 205 ms pass their limits, but maximum cold
long task is 107 ms against 100 ms. Failing sample at startTime 743 ms is
classified workspace-module-import; overlap includes AdminUserController chunk
and two font resources, attribution unknown/window, host CPU busy 42.2%.
Overlap is not proof of causation. Warm longest task is 0 ms. Log:
`data/logs/prompt1-pending-projection-performance.log`. Do not report the older
93-ms result as current or relax the threshold. Profile the import-stage task
before choosing any production optimization; this is an open verification gate.

Offline soak after pending-projection fix, session 9694, completed **exit 0**:
`{"ok":true,"runs":5,"completed":5}`. Log:
`data/logs/prompt1-pending-projection-offline.log`. Checks include reconnect
without duplicate server rows and an interrupted retry retaining pending work
across reload. No concurrent browser suite was started.

New-release multi-assignee verification session 71881 completed **exit 0**.
Both revoked open package editor and dirty plan breakdown close automatically.
Final API access: removed A 403, retained B 200, added C 200, outsider 404;
fixture cleanup confirms activity retained. Log:
`data/logs/prompt1-pending-projection-transfer.log`. This checks the new
pending-projection preservation against real browser revocation, not only units.

Pending-projection JS coverage refresh session 15959 completed **exit 0**;
coverage lines 53.63%, branches 65.32%, functions 67.63%, critical ratchet
passed 14 modules. Exact totals are in
`data/logs/prompt1-pending-projection-js-coverage.log`.
After completion, multi-assignee transfer browser verification started on the
new release (no concurrent browser suite), logging to
`data/logs/prompt1-pending-projection-transfer.log`. This is required to check
the pending-state preservation change against dirty-editor revocation.

Full lifecycle after pending-projection fix: `E2E-1788923825487`, observer
session 75933, **exit 0**, release `903acc6beb91d9f4c1a431b6d1b8dfc7dda79992b16cac7d568c636ed1e7ebfe`.
All original branches completed including two lot batches, final result,
plan snapshot inheritance and historical copy-on-write freeze. Cleanup removed
309 fixture rows, retained 105 audit and 50 activity rows. Log prefix:
`data/logs/prompt1-memory-20260909-101656`.
Together with the failing-before unit repro and passing browser prefix, this
supports the stale pending-state overwrite fix; final shared-seam regressions
remain required. Full JS coverage refresh started next, log
`data/logs/prompt1-pending-projection-js-coverage.log`; do not overlap browser
suites with its browser-backed test files.

Pending-projection fix browser prefix session 2358 completed **exit 0** on
release `903acc6beb91d9f4c1a431b6d1b8dfc7dda79992b16cac7d568c636ed1e7ebfe`.
Log `data/logs/prompt1-memory-20260909-101521.*` confirms server Đang chấm thầu/v4,
evaluation visible after save/reload and fixture cleanup (52 removed, 20 immutable
rows retained). Unlike earlier unexplained passes, this follows a specific
red-before/green-after shared-state regression fix. Full workflow rerun without
the diagnostic loader is now required and started next; not yet complete.

Pending-projection secure build session 85031 completed exit 0, new release
`903acc6beb91d9f4c1a431b6d1b8dfc7dda79992b16cac7d568c636ed1e7ebfe`.
All prior `83c910ff…` artifact tests remain historical evidence. The same
opening-transition diagnostic prefix is being rerun on the new artifact; do not
claim browser confirmation of the pending-projection fix before its result.

Pagination pending-projection root-cause regression now fails before the fix and
passes afterward: canonical page data previously replaced shared detail state
before the returned table-only pending overlay. An acknowledgment could then
stamp the old fields with a newer rowVersion. `cachePaginatedRecords` now applies
same-ID pending upserts/patches to shared state and local DB writes, while keeping
the returned canonical page cache clean and not adding IDs absent from the page.
Tests also check persistence, untouched server fields, absent IDs and authoritative
replacement after pending queue clears. 55 pagination/revocation/sync-order tests
pass; log `data/logs/prompt1-pending-projection-regressions.log`.
Secure rebuild is active under session 85031, output
`data/logs/prompt1-pending-projection-build.log`. Browser verification remains
required; previous release-specific lifecycle/performance evidence is not final
proof for this newer application change.

Visibility-history reproduction `E2E-1788923293668`, session 64071, exit 1:
server pagination twice returns Đang chấm thầu/v4, but converged render dataset
reports Đã mở thầu/v4 and preparation tab, render generation 6. History shows
opening/Đã mở thầu → preparation/Đã mở thầu; detail pane remains active. No
eval_tech element exists at capture. This rules out CSS-hidden evaluation tab
for this reproduction and establishes stale business fields paired with a newer
rowVersion in rendered state. Inspect acknowledgment, pagination merge and
entity indexes next; no production fix yet. Logs:
`data/logs/prompt1-memory-20260909-100805.*`; failure artifacts include
`test-results/lifecycle/E2E-1788923293668-opening-visibility.json` and PNG.

Contractor violation matrix session 35466 completed **exit 0, 3 passed / 0
skipped** across Chromium/Firefox/WebKit, 1.2m. Log:
`data/logs/prompt1-violation-fixture-matrix.log`. Independent bidder and exact
JV-member violation styling is verified after save/reload without broadening
record display or permissions. All six fixture-gated generic-smoke executions
now have separate three-browser passing evidence (procurement and violation).
Only the two platform-specific Chromium-touch exclusions remain intrinsically
non-executed on Firefox/WebKit. Discovery and Python quality checks passed after
fixture changes. These results do not close intermittent lifecycle visibility
or final diff/source-snapshot review items.

Contractor-violation browser fixture now uses the existing joint-venture seeder
with an isolated manager/org, fixed closing date within fixture validity and
audit-preserving lifecycle cleanup. Previously skipped test exposed two harness
issues: dereferencing removed auth-overlay; and a lowercase direct-SQL seeded
package code conflicting with API canonical uppercase normalization on a locked
issued package. The fixture now seeds uppercase; production lock semantics are
unchanged. Server response assertion retains errors rather than waiting only
for a tab. Chromium rerun session 49361 completed **exit 0, 1 passed** including
independent/JV member violation persistence after reload. Log:
`data/logs/prompt1-violation-canonical-fixture.log`. Three-browser run is next;
do not count Firefox/WebKit as passed yet.

Previously skipped procurement plan fixture test now executes with a fresh
manager/workspace and seeded investor per browser; cleanup uses immutable-audit
preserving fixture cleanup. First matrix exposed WebKit reading options before
modal hydration. Production code intentionally paints modal before filling the
select; test now waits for the exact seeded investor option and selects/asserts
its ID, preserving default timeout and all draft/canonical assertions.
Rerun session 47094 completed **exit 0, 3 passed / 0 skipped** on Chromium,
Firefox and WebKit (51.8s). Log:
`data/logs/prompt1-procurement-fixture-ready-matrix.log`.
Seven fixture-helper tests also pass. Three procurement skips from generic smoke
now have separate execution evidence; contractor-violation fixture coverage still
needs execution. New test/helper changes postdate the last CodeQL snapshot.

CodeQL JS refresh completed exit 0 (session 67169), 89 queries, 681/681 JS/TS
and 5/5 Actions files. Five findings match prior fixed-snapshot rule/path/line
keys exactly; no new reported location. See refreshed triage and SARIF, not a
zero-warning claim. Dependency refresh session 52598 also completed exit 0:
full npm and production npm each report zero vulnerabilities, pip-audit reports
no known vulnerabilities. Log `data/logs/prompt1-final-dependency-audit.log`.

Secret scan refresh: Gitleaks stdin scan of tracked diff completed exit 0
(440,222 bytes), and a separate stdin scan of all 22 untracked non-ignored files
completed exit 0 (237,594 bytes), both reporting no leaks. Reports:
`data/logs/prompt1-current-diff-secrets.log` and
`data/logs/prompt1-new-files-secrets.log`. Redaction enabled; no file contents
printed to tool output. These are checkpoint scans, not proof for later edits.
CodeQL JS database creation remains live as session 14885; no analysis result
has been obtained from the new database yet.

First-tab rerun session 9195 completed **exit 0**, `passed: true`, no runtime
failures. Log `data/logs/prompt1-first-tab-after-recovery.log`; observed first
visits 63, 65.1, 16.6, 18, 22.8 and 19.8 ms (100-ms threshold), loader hidden
1172 ms. No build occurred between the identified release and this run. The
pre-recovery startup failure remains separately recorded; no threshold changed.

PostgreSQL recovery completed at 06:36:00.827 +07; log reports ready to accept
connections and pg_isready confirmed accepting connections. No reset or second
startup was issued during recovery. First-tab performance is now running again
after that external-state change, logging to
`data/logs/prompt1-first-tab-after-recovery.log`; the failed pre-recovery attempt
remains an environment startup failure, not a performance verdict.

First-tab refresh session 76160 ended **exit 1 before browser execution**:
isolated application startup failed because PostgreSQL port 55432 was down.
The repository startup helper was invoked once; its 60-second wait timed out,
but live postmaster PID 21384 and recovery PID 9288 continued fsync recovery.
At 06:35:28 +07 recovery logged 140 seconds and a changing data-file path;
pg_isready returns rejecting connections (starting up), not a dead process.
Do not restart it or reset the data directory. Wait for authoritative readiness
before repeating first-tab verification. No test failure was converted to a pass.

Current-artifact smoke log `data/logs/prompt1-pull-flight-smoke.log` has terminal
Playwright summary **46 passed / 8 skipped (9.5m)**, all three browser projects
completed. Session 8420 is no longer available; process inventory shows no
remaining test browsers. The wrapper exit code was not recovered in this poll;
do not invent it. Skips remain six fixture-gated executions and two Chromium-only
touch exclusions, not successful executions. First-tab performance refresh is
being run separately next, log `data/logs/prompt1-pull-flight-first-tab.log`.

Performance refresh session 99981 completed **exit 0**, `passed: true`, on
release `83c910ff1606485041e598dc07c2703b4a583290178033430c1a7b0b8f50e196`:
cold p95 1343 ms, longest task 93 ms. Log:
`data/logs/prompt1-pull-flight-performance.log`. Cross-browser smoke refresh
started afterward (not overlapping), session 8420, log
`data/logs/prompt1-pull-flight-smoke.log`; inspect the final result and classify
skips before claiming current-artifact cross-browser verification.

Full lifecycle `E2E-1788907053985` completed all workflow assertions and fixture
cleanup on release `83c910ff1606485041e598dc07c2703b4a583290178033430c1a7b0b8f50e196`.
Log prefix `data/logs/prompt1-memory-20260909-053727`; session 12888.
Final checks include two lot award rounds with final status Đã có kết quả,
plan snapshot inheritance preserving goods/openings/result, and historical
plan package freeze/copy-on-write. Cleanup removed 309 fixture rows, retaining
105 audit and 50 activity rows. This is genuine full-workflow passing evidence,
but the earlier intermittent opening visibility failures remain unexplained;
one passing run must not be used to erase them or declare all requirements done.

Full lifecycle (no opt-in loader) session 12888 is live at last poll, log prefix
`data/logs/prompt1-memory-20260909-053727`. It has passed opening, evaluation,
award approval and contract create/complete/liquidate/persistence. This expands
current-artifact evidence but is not a final verdict and does not resolve the
intermittent opening visibility failure by itself. Revalidate the handle before
starting any other browser suite; later workflow branches are still running.

Opening visibility probe `E2E-1788906928057` completed its shortened prefix:
server pagination confirms Đang chấm thầu/v4 and evaluation became visible,
followed by fixture cleanup (52 rows, retaining 15 audit and 5 activity).
Log prefix `data/logs/prompt1-memory-20260909-053505`, observer session 44020.
No production fix intervened between failed and successful opening probes;
therefore the transition is intermittent and is NOT resolved by this passing
sample. Failure-only ancestor visibility/screenshot probes were added to the
harness and 55 harness tests passed, but no failure artifact was produced in
this successful sample. Full lifecycle remains unverified; retain the probes
for the next full run rather than interpret a reduced pass as completion.

Opening telemetry prefix `E2E-1788906615466` (session 21747) reported exit 1.
Server pagination independently confirms status progression: Chuẩn bị/v1 →
Đang mời thầu/v2 → Đã mở thầu/v3 → Đang chấm thầu/v4, and the v4 pagination
response is observed twice after save. Failure diagnostics now include eval_tech
in DOM tab attributes, yet `button[data-workflow-tab="eval_tech"]` visibility
wait times out. No HTTP/page errors. Next inspect actual tab element type and
visibility/layout, not alter backend status or tab business rules. Evidence:
`data/logs/prompt1-memory-20260909-052955.*`. Reduced run remains a failure,
not full lifecycle evidence.

Lifecycle with catalog canonical barriers (`E2E-1788906349310`, session 11839)
finished **exit 1** at opening → eval_tech, independently of coverage. There
were **no HTTP errors and no page errors**. Traffic shows POST /api/sync sending
package status `Đang chấm thầu` with expectedVersion 3, then HTTP 200; subsequent
pagination/delta responses are also 200, but UI tabs remain preparation/goods/
opening/documents/activity. This reproduces the transition problem without the
expert conflict; HTTP 200 alone does not prove complete canonical state. Inspect
response payload/canonical package and detail projection/render ownership next.
Log prefix: `data/logs/prompt1-memory-20260909-052529`. Prior session notes are
historical; this run has ended, so no browser suite remains active from it.

Initial catalog creates in lifecycle now arm the existing canonical response
observer before submission and await its existing acceptance/status checks before
marking investor/contractor/expert creation. Previously these paths asserted only
local modal closure and visible rows, unlike the already guarded contract create.
Harness structure regression failed before the change; 55 harness/lot tests
passed after. This strengthens verification, does not fix or suppress the observed
expert conflict, and does not change application code/timeouts. Full browser
verification is required. Also note `globalThis.app` is absent from production
controllerRef exports; optional app-based diagnostics must not alone prove an
empty outbox. The response and rendered sync-state checks remain independent
evidence, with exact record receipt matching a remaining harness review concern.

Package isolated rerun session 9800 completed **exit 0**: 876 runtime files,
4,937,287 bytes, extracted application smoke passed. Exact command:
`python scripts/package_production.py --check`; log:
`data/logs/prompt1-package-isolated-diagnostics.log`. The unchanged 60-second
child limit passed with no concurrent test suite. This verifies the current
archive/runtime path but does not establish why the prior overlapping run timed
out. No legal publication was performed or approved.

Reduced expert probe `E2E-1788906044782`, session 37409, completed **exit 0**.
Both distinct expert inserts received HTTP 200 with rowVersion 1, without a
duplicate expert request in the observed prefix. Logs:
`data/logs/prompt1-memory-20260909-052024.*`; cleanup removed 27 fixture rows,
retaining 5 audit rows. This prefix does not reproduce the conflict and therefore
does not establish an expert production fix. The observer logs also show create
and browser-renewal markers preceding some response-body receipts; the harness
`submitModal` waits for modal closure only, and `renewBrowserSession` captures
storage without an explicit canonical barrier. Inspect/reproduce that boundary
before attributing stale inserts to expert form logic. Visible rows/local closure
must not be treated as canonical completion. No production change made here.

Independent lifecycle `E2E-1788905782014` (session 43184) finished **exit 1**.
It failed before opening at tender-publication readiness, with captured HTTP 409
`ROW_VERSION_CONFLICT` for the first expert: expectedVersion null, currentVersion
1. No page errors were recorded. This is concrete evidence of an unexpected
existing-record mutation/version conflict, not merely a missing DOM button.
Next diagnosis must trace expert mutation staging/acknowledgement and whether
session renewal or later aggregate saves retain/recreate an insert. Do not
assume it proves the preceding opening failure has the same cause. Cleanup
removed 38 fixture rows and retained 10 audit plus 3 activity rows. Log prefix:
`data/logs/prompt1-memory-20260909-051554`. No browser suite is active from this run.

Final JS coverage refresh session 99101 completed **exit 0**: **1737/1737**,
zero failures/skips, lines 53.64%, branches 65.31%, functions 67.62%; critical
ratchet passed 14 modules. Log: `data/logs/prompt1-pull-flight-js-coverage.log`.
After confirming completion, full lifecycle restarted without diagnostic loader
or concurrent coverage: session 43184, log prefix
`data/logs/prompt1-memory-20260909-051554`. Await its actual result; package
runtime timeout remains unresolved and is not being rerun concurrently.

Package refresh session 88228 ended **exit 1**: extracted TestClient runtime
exceeded the existing 60-second subprocess limit. Archive construction completed,
but runtime verification did not; old package passes do not prove this artifact.
`data/logs/prompt1-pull-flight-package-check.log` records the failure. The packager
now emits fixed, data-free phase markers and includes only those markers in its
timeout diagnostic, retaining the same timeout and assertions. Focused production
package tests completed exit 0 (`data/logs/prompt1-package-diagnostics-tests.log`).
Next package reproduction should run after coverage to remove competing workload
as a timing variable; no root cause or successful runtime is claimed yet.

Latest read-only check: `python scripts/verify_secure_build_artifact.py` passed
exit 0 against release `83c910ff1606485041e598dc07c2703b4a583290178033430c1a7b0b8f50e196`.
Coverage session 99101 is progressing through distinct test-file child processes
(custom select → detailed evaluation scrolling → Excel import loading), so it
must not be restarted or classified as hung based on buffered stdout alone.
Browser OOM comments in the lifecycle harness now point to the proven application
promise-loop cause rather than claiming an unproven GPU/transport defect; launch
flags and test assertions are unchanged. CodeQL snapshot qualification is now
explicit in the triage ledger because the sync fix postdates that analysis.

Update: full run `E2E-1788904666442` finished **exit 1**, no renderer OOM.
It reached tender opening, then timed out waiting for `eval_tech` after opening
save (lifecycle line 975). Available UI tabs remained preparation/goods/opening/
documents/activity. Cleanup completed: 52 fixture rows removed, 15 audit plus
5 activity rows preserved. This is a remaining transition failure, not a
passing lifecycle. Static refresh completed **exit 0** in
`data/logs/prompt1-pull-flight-static.log`; JS coverage session 99101 was still
live at last poll. Opening failure reporting now includes recent API/error
context without weakening the transition assertion. Earlier active-process
notes below are historical.

Follow-up: 54 harness/lot synchronization tests passed after adding opening
failure traffic context. The opening-transition renderer probe now uses the
existing bounded diagnostic helper. A new lifecycle launch was refused before
starting because the active JS coverage suite was running a browser-backed test
(`custom_select_accessibility.test.mjs`, child PID 29168 at last observation).
Do not overlap a new browser suite with coverage; poll session 99101 until its
actual completion and inspect its exit result first. This also means the prior
overlapping coverage/lifecycle observation is not clean isolated timing evidence.

An actual renderer OOM was traced by a paused browser stack to the automatic
push waiting on Map entries rather than pull promises. The minimal promise
extraction fix has a red-before/green-after regression and 61 passing sync tests.
Secure build passed with release ID
`83c910ff1606485041e598dc07c2703b4a583290178033430c1a7b0b8f50e196`.
The reduced contractor-create/search reproduction passed on that artifact.
Full lifecycle run `E2E-1788904666442` is active under observation session 96579;
its log prefix is `data/logs/prompt1-memory-20260909-045728`.
It has passed contractor and expert creation at this checkpoint, but has no
final verdict yet. JS coverage refresh is active under session 99101, logging to
`data/logs/prompt1-pull-flight-js-coverage.log`. Revalidate these process handles
before relying on them. Old artifact-specific evidence below is historical and
does not prove final verification of the new sync fix. Details are in
`prompt1-renderer-crash-evidence.md`; Prompt 2 remains untouched.

## Requirement map

Exact functional evidence anchors in the final Python log:
`test_postgres_create_assignment_then_transfer_revokes_creator` and
`test_postgres_latest_version_transfer_does_not_leave_historical_lineage_grant`
passed for plan, package and contract; `test_postgres_missing_root_descendant_blocks_successor_self_claim`
and `test_postgres_assignment_transfer_serializes_with_write_authorization`
also passed. These are executed PostgreSQL regressions, not collection-only
evidence. Dependent contractor canonical selection and unchanged-parent filtering
have focused JS tests included in the passing full JavaScript coverage run.

| Prompt sections | Required proof | Current assessment |
| --- | --- | --- |
| 0–3 | Current source, contracts, specialist create and contractor stamp without widening expert media rights | Fetched HEAD equals origin/main `1e06300eb3bb8508b770326e37e55f9d31278dcf`; ADRs read; specialist stamp browser tests and protected-media backend tests passed |
| 4–7, 16, 36–38 | Exact-version transfer, read/write agreement, anti-self-claim, independent grants | PostgreSQL assignment tests passed; ADR 0041 records semantics; final review must verify all production call sites and test matrix, not only helper tests |
| 8–10 | Real transfer/save concurrency and transaction locking | Two-connection test observes PostgreSQL blocking and actual row write; passed in specialist suite |
| 11–14, 17–18 | Canonical save feedback, rejected-insert rollback, error classification | Focused unit tests and three-browser rejection test passed; creator form tests exposed and fixed identity hydration, image-path and permission hydration defects |
| 15, 24, 37 | Specialist plan/package/contract/stamp forms, self-assignment UI and persistence | New specialist browser suite passed all browsers; assignments checked in PostgreSQL; current combined smoke passed |
| 19–23, 25, 28–35, 48 | CI-equivalent quality, coverage, browsers, workflows, performance, package and security | Current evidence: Python 2198 pass/63.77% plus 16 critical modules; JS 1740 pass plus 14 critical modules; smoke 49 pass/5 classified skips; both fixture groups separately 3/3; full lifecycle, workflow refreshes, performance, package/runtime/reproducibility and final CodeQL recorded. Remote CI not run on uncommitted patch |
| 26–27, 49 | Legal facts remain external; publication blocked | Legal gate reports 27 unapproved facts/27 placeholders; ADR 0042 and workflow tests keep publication gated |
| 39–40 | Scope purge, dirty drafts, modal state, offline/outbox, polling | Reset/rebase/regrant/cross-tab tests passed; new-release browser transfer closes dirty package and breakdown editors, old A 403, B/C 200, outsider 404; offline soak 5/5. Backup pruning and pending projection seams reviewed; retain original failure logs |
| 41–43 | Separate old CI debt from regressions; diagnose rather than mask | Baseline GitHub failures identified; no retry/timeout increases used to make failures pass. Intermittent wheel and missing-response failures remain documented, not proven eliminated |
| 44–46 | Ordered, scoped patches and genuine regression tests | Prompt 2 untouched; worktree remains uncommitted and contains broad accumulated changes; final diff review required |
| 47, 50–52 | Complete functional audit, self-review, prescribed final report | Complete; `prompt1-handoff-report.md` contains every section-51 heading, exact observed commands, limitations and no more than five next steps |

## Resolved deliverables and retained evidence limitations

Current actionable list (older detailed notes below retain history):

- Integrated smoke completed in replacement session 8823: 49 passed/5 skipped,
  exit 0; procurement fixture separately passed 3/3. No smoke process remains.
- Final-source CodeQL refresh completed: Python 647/647 and JS 686/686 files,
  both exit 0 with unchanged contextual findings. Critical changed production
  files match their source archives. GitHub CI still refers only to committed
  source; do not describe local results as a remote CI run.
- Accumulated diff review and the section-51 report are complete. Exact command
  scope, artifact identity, local-only status and historical failures are
  retained; Prompt 2 may now start as a separate scope.
- Required supplemental workflows now have refreshed results: role/auth-shell,
  bidder-goods, UI-quality, pairwise, low-price, joint-venture and analytics exit
  0. CRUD exact-ack run has complete terminal success/cleanup markers but expired
  process handle; report that evidentiary distinction. Analytics teardown warning
  remains documented. Map these exact logs into the final report.
- Diagnostic scaffolding is isolated under scripts/diagnostics with explicit
  usage/limitations README; runtime package inventory excludes all those files.
  User-provided prompts and historical evidence remain intact.

Resolved evidence gaps: dirty package/breakdown transfer on the new pagination
build passed (removed A denied, B/C allowed); offline soak 5/5; full lifecycle
after the identified shared-state bug passed; both fixture-backed browser groups
executed 3/3. Font HTML/asset tests, static and extracted runtime passed; latest
plain performance gate passed at 100 ms with prior failures retained.

1. Finish section 39 review: legacy backup arrays and real browser transfer with
   dirty breakdown remain to verify. Unit coverage now includes reset/retry,
   later pulls, recreated models, pending upserts, regrant, scoped storage,
   cross-tab metadata refresh and purge; 21 focused tests passed. These do not
   replace an end-to-end manager transfer while another session edits a draft.
   Extended multi-assignee browser run 72138 completed exit 0: dirty package
   editor and dirty plan breakdown in two pages close automatically and lists
   purge after manager transfer. Final access checks: old A 403, retained B
   200, added C 200, outsider 404; cleanup retains activity. Final-source
   regression remains required. Legacy backup arrays now prune only revoked
   committed IDs, preserving unrelated rows and uncommitted drafts; focused
   tests pass. The prune helper is called with authoritative removed IDs by
   the same reset/rebase path.
2. The final diff was reviewed and mapped to reproduced defects or required
   gates. Temporary submit/navigation logging has been removed from the
   specialist suite; bounded runtime diagnostics attach only on failure. Landing
   wheel observation remains a test diagnostic, not a production workaround.
3. Record exact final file/build identity against test results; current-patch
   local CodeQL has analyzed the worktree (646 Python / 678 JS/TS files), with
   14 findings triaged in `prompt1-codeql-triage.md`. Four test-server findings
   were fixed; JavaScript re-analysis confirmed all four are gone (5 remaining
   test/benchmark findings). GitHub success still covers
   only the baseline commit, not the uncommitted patch.
4. Explicitly account for eight smoke skips: fixture-backed procurement/violation
   scenarios and Chromium-only touch tests. Discovery is not execution evidence.
5. The section-51 report now includes baseline, call flow, root causes, changes,
   authorization matrix, concurrency, sync states, CI before/after, exact commands,
   legal release status, risks, diff-review notes and five next steps.

## Final diff review notes

- Contract version creation is intentionally the existing form/sync path, not
  the plan/package aggregate endpoint: HopDongWorkflow increments the family
  version, preserves historical records, calls applyAssignmentDelta for the new
  physical ID, then persists the changed family. Do not invent an aggregate
  contract command to satisfy a test. CRUD browser coverage exercises the form;
  parameterized PostgreSQL contract transfer regression covers exact V01 denial
  despite V00 assignment. Distinguish these complementary scopes in the report.

- Python quality module ratchets decreased (app BLE001 7→6; access policy
  19→14), not increased. Dedicated startup threshold is restored to its original
  100 ms; no remaining workflow threshold diff.
- Removed lineage-helper N+1 tests referenced the retired authorization helper.
  Replacement tests cover exact target/tenant/employee filtering and lock clauses;
  batch authorization query-count coverage remains and the 25-test N+1 suite
  passed. Changes do not preserve the superseded lineage-wide grant semantics.

- Visibility reconciliation compares incoming token against both committed
  storage and the tab's prior observation before fencing, so a partial response
  or another tab cannot conceal a required full reset. Partial scope changes
  escalate to full workspace reconciliation before mutation state is reused.
- Revocation metadata is ID-only and scoped through workspace storage; the
  WeakMap cache refreshes when serialized storage changes. Authoritative incoming
  rows clear the matching revoked ID for regrant. Pending outbox operations are
  retained separately and do not themselves restore revoked readable projections.

- Revoked-editor dismissal is called by SyncPullService only after a visibility
  scope change; it uses the post-reconciliation record collections, not Word
  entitlement or per-field masking. Backup pruning targets revoked IDs with a
  committed rowVersion; genuinely new draft rows remain. Three-way rebase removes
  revoked committed rows from base/local sides so they cannot resurrect on merge.
  New-release browser transfer and focused revocation tests provide behavior proof.

- Admin permission-matrix and contract-status saves retain their existing
  mutation/sync paths; only pending versus committed feedback changed. Final
  success requires the shared canonical-result classifier.
- Plan version detail disables/unbinds edit while family hydration is pending,
  restores the handler only for the latest snapshot, and retains the existing
  historical edit restriction. Hydration failures propagate, not convert to ready.

- WorkflowModuleLoader's focused package editor group retains plan calculation,
  form subtables and partner helpers; full bidding readiness satisfies the focused
  group. It does not remove the full workflow import path or change permissions.
- Lot-scope additions publish existing selected lot codes/mode as DOM metadata
  for deterministic browser observation; selection, validation and disabled
  semantics are unchanged. Metadata is not an authorization source.

- Both production callers of `existing_lineage_identifiers` iterate
  `ASSIGNED_TABLE_TYPES`, not request-provided table names. IDs and organization
  are bound parameters; matching covers physical ID and root ID. Exact-assignment
  lock queries sort target types/IDs and row IDs and include organization scope.
- Font preload paths pass existing hashed-asset/path/file checks, are WOFF2-only,
  and use the same product font files; no record payload, session or entitlement
  participates in selecting font URLs. Missing legacy font manifest entries
  preserve prior behavior; unsafe entries are rejected.

- CI release split keeps production publication behind manual dispatch, all
  engineering jobs and explicit legal readiness. Ordinary package job retains
  structural/extracted-runtime validation, SBOM and dependency audit; it no
  longer uploads a production-public candidate. This does not make legal facts
  approved or current GitHub CI green.

- WorkspaceMutationOutbox rejection classification derives new-insert status
  from the sent receipt's version/base snapshot, not a client UI flag.
- Package assignment defaults apply only to a new physical create in the
  frontend; server logical-lineage checks remain authoritative.
- Package editor lazy graph retains KeHoachWorkflow recalculation dependency;
  this preserves total updates while reducing unrelated editor loading.
- Pagination invalidation now has a separate cancellation reason; final review
  confirms aborted responses throw before cache writes and still pass through
  workspace lease validation. Cancellation is not converted to success.

## Release and next scope

Production release: **BLOCKED — external legal facts missing**.
Do not invent approvals or publish a production-public artifact.
Prompt 1 is complete under its legal-gate exception. The subsequent Tabler
Platform Admin migration is implemented and audited separately in
`admin-dashboard-completion-report.md`; its code and evidence remain a distinct
scope even though the final integrated CI verifies both together.
