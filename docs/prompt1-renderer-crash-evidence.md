# Lifecycle renderer crash evidence

Windows Application events 1000/1001 identify two chrome-headless-shell
crashes matching stalled lifecycle runs:

- 2026-09-08 23:16:30 +07, PID 25804, report e61ea230-2820-48f3-b126-2a5f58080b7a.
- 2026-09-09 04:20:01 +07, PID 6848, report b2677451-3f21-4ef8-b0e4-c53c3dcf3700.

Both report exception 0xe0000008 in KERNELBASE.dll. Chromium defines this as
its out-of-memory exception, not an application validation exception:
https://codereview.chromium.org/2130293003/patch/160001/170001

Local minidump exception-stream inspection (no upload) confirms the same code:

| Dump PID | Exception thread | Raw exception parameters |
| --- | --- | --- |
| 6848 | 29572 | 0, 40933339136, 15809576960 |
| 25804 | 29472 | 0, 40933339136, 8146206720 |

Parameter meanings verified against Chromium 151.0.7922.34, matching the
installed Playwright browser manifest:
https://raw.githubusercontent.com/chromium/chromium/151.0.7922.34/base/allocator/partition_allocator/src/partition_alloc/oom.cc

The parameters are attempted allocation size, total commit limit and available
commit amount from GlobalMemoryStatusEx. Both dumps report allocation size 0
(not proof of an actual zero-byte allocation request), total limit about 38.1
GiB, available commit about 14.7 GiB and 7.6 GiB respectively. Chromium warns
these values are sampled after OOM and may differ from the failure instant.
Thus these dumps do not establish exhaustion of system commit; process-local
allocator/virtual address failure or transient pressure remains possible.
No Windows System event 2004 was returned in the checked interval. This does
not rule out process-local allocation failure or transient system pressure.
Current available memory is not evidence of memory availability at crash time.

Dump files remain local under C:/Users/newst/AppData/Local/CrashDumps and may
contain session data. Do not upload them. Both orphaned test browsers were
terminated only after renderer absence and pending Playwright protocol calls
were confirmed; Node then returned real test failures and completed fixture
cleanup, preserving audit rows. Those runs are failures, not passes.

Next: inspect exact-build exception implementation / allocation context or
instrument bounded process-memory samples during a controlled reproduction.
Do not increase timeouts, disable coverage, or infer a production memory leak
solely from these two crash codes.

## Continuation verification (2026-09-09)

- Live process inventory contains no `chrome-headless-shell.exe`; the failed
  browser runs are not still running. Unrelated Node processes were left alone.
- PostgreSQL readiness on 127.0.0.1:55432 returns `accepting connections`.
- Read-only parsing of both dump directories finds SystemInfo architecture 9
  (AMD64), not a 32-bit renderer. Neither dump contains stream type 16
  (`MemoryInfoListStream`). Therefore these artifacts cannot provide the virtual
  memory region map needed to establish address-space exhaustion or fragmentation.
- Both contain a 1364-byte MiscInfo stream with flags 1015. No session memory or
  dump bytes were printed or uploaded. The allocation caller still needs stack
  inspection with matching symbols, or bounded memory telemetry during reproduction.
- This rules out treating a 32-bit renderer address-space ceiling as the current
  explanation; it does not establish the actual OOM cause or a lifecycle pass.

## Bounded memory reproduction (2026-09-09 04:41-04:47 +07)

Command: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnostics/measure_lifecycle_memory.ps1`.
This diagnostic wrapper invokes the unchanged isolated lifecycle suite on
127.0.0.2:8010 and samples descendant process numeric memory counters plus system
commit/available bytes. It does not persist command lines or session contents.

- Run `E2E-1788903735390`, Node PID 19948, second browser PID 29636,
  renderer PID 13600. Logs: `data/logs/prompt1-memory-20260909-044156.*`.
- Renderer private memory rose from 198.1 MiB at 04:42:54 to 4322.1 MiB at
  04:45:08; sampled peak pagefile usage reached 4357.7 MiB. System commit
  headroom at 04:45:08 was 11.2 GiB; post-crash samples are not crash-instant
  proof. Application event 1000 reports the same 0xe0000008 at 04:45:38,
  report ID `33232eff-98e3-4475-911c-8c60dd25b265`.
- Loopback Node inspector confirmed a pending `waitForFunction`. A read-only
  CDP heap/DOM counter request did not return within the 8-second observation
  bound; no heap counter result was obtained, so JS heap versus native memory
  is still unresolved.
- After renderer disappearance was verified, only its owning browser was
  stopped. Node surfaced the actual failing location: `waitForVisibleRowText`
  at lifecycle line 795, **after submitting the contractor and filling its
  search box**, not before opening/creating the contractor as the last progress
  marker alone suggested. Next minimization target is contractor search/list
  rendering following canonical create and session renewal.
- The lifecycle command failed with exit 1 and cleanup removed 15 fixture rows,
  one organization and one account, retaining two immutable audit rows.
- The initial diagnostic wrapper incorrectly returned 0 because Windows gave
  a null exit status; this is NOT a passing suite result. The wrapper now retains
  the process handle and fails explicitly on unavailable exit status. This
  correction has not yet been exercised with another lifecycle run.

No application fix is inferred from the memory growth alone. No test deadline,
assertion, retry, browser matrix or business permission was changed in this run.

## Root cause isolated and regression fixed (2026-09-09)

Reduced reproduction uses opt-in `NODE_OPTIONS=--import=./scripts/diagnostics/contractor_search_probe.mjs`
with the memory wrapper. It retains the lifecycle prefix through contractor
search and cleanup, explicitly never reports full lifecycle success. Run
`E2E-1788904196096` failed and cleaned its fixture; wrapper correctly returned 1.
Logs: `data/logs/prompt1-memory-20260909-044940.*`.

A single debugger interrupt during the stuck search captured two frames in the
secure bundle. Read-only `Debugger.getScriptSource` inspection mapped the frames
to `autoSync` and its `Promise.allSettled(activePulls).then(...)` retry. No business
record values were inspected. The pull producer in `SyncPullService.forceSyncData`
stores a Map of request keys to `{controller, promise}`. `SyncPushService.autoSync`
spread this Map directly, passing `[key, flight]` arrays to `allSettled`, which
settles immediately instead of waiting for the pending network pull. Its recursive
retry therefore starves the event loop and allocates an unbounded promise chain.

Regression: `push waits on real pull promises without recursively starving the event loop`
uses the real pull producer and push entry point, bounds the recursive retry seam,
and asserts no re-entry before the pull resolves across an event-loop turn.
Before fix: focused invocation failed `1 !== 0` (exit 1). After mapping Map values
to `flight.promise`, both sync ordering/status files passed: 61/61, exit 0.
Existing tests resolved the held response after one microtask, which did not
detect starvation while waiting for an actual network event.

Production patch is limited to promise extraction, preserving pull-before-push,
workspace checks and error/authorization semantics. Secure rebuild started with
output in `data/logs/prompt1-pull-flight-build.log`; browser verification on the
new artifact remains required. Earlier artifact evidence is not final evidence
for this fix. Diagnostic loader remains opt-in and must not be enabled for full CI.

### Post-fix browser reproduction

Secure build completed exit 0, release ID
`83c910ff1606485041e598dc07c2703b4a583290178033430c1a7b0b8f50e196`.
The same opt-in reduced reproduction completed exit 0 on that artifact:
`E2E-1788904580091`, logs `data/logs/prompt1-memory-20260909-045605.*`.
Contractor submission and visible search result both completed; cleanup removed
15 fixture rows and retained two audit rows. No debugger pause was needed in the
successful search. This proves the reduced browser path, not all workflows.
The full lifecycle is being run next with NODE_OPTIONS removed (no loader,
no shortened workflow, no debugger), retaining numeric OS memory sampling only.
