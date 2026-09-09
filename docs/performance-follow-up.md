# Startup performance follow-up

## Implemented and measured

Bundle HTML now preloads the existing Latin/Vietnamese WOFF2 files using their
validated manifest paths rather than merely stripping the source preloads.
No font or layout design change. Asset/HTML regression suite: 38 passed.
Plain production-app measurement `prompt1-font-uninstrumented-check.log` passed
with cold/warm p95 1325/236 ms and no >50-ms tasks recorded. Earlier 101-ms
failure remains historical evidence; do not present all measurements as passing.
The active requirement is still **100 ms**, as reconfirmed below.

## Superseding decision — 2026-09-09

The owner reconsidered the temporary 150 ms acceptance and requested following
the assistant's original recommendation. Restore **100 ms** in measurement,
workflow and profiler fallback and resume evidence-led optimization. The earlier
pause/150 ms decision below is historical and no longer current. Other thresholds
and business contracts remain unchanged. Existing >100 ms failures remain open.

## Decision — 2026-09-09

The product owner explicitly accepts a temporary **150 ms maximum startup long
task** and requests deferring further investigation/optimization. The previous
100 ms limit remains the optimization target, not the current acceptance gate.
Default measurement and the dedicated performance workflow use 150 ms. Explicit
environment overrides remain supported. Cold/warm p95 limits, sample counts,
authorization, data visibility, and all other gates are unchanged.

This is an approved temporary acceptance change, not a claim that the original
100 ms failures were fixed. Historical results retain their original verdicts.
Further performance optimization is paused; no recurring task was scheduled.

## Resume later

- Investigate whole-document Layout: 418 dirty/total objects, root #document;
  observed Layout about 82–94 ms inside startup tasks of 103–125 ms.
- CPU samples reported `(program)`; timeline confirmed Layout rather than
  background script parsing as the dominant work in the observed task.
- Browser-only min-width experiment still reached 111 ms; do not ship it.
- System-font experiment reached 91 ms but does not prove causation or authorize
  changing the product font.
- Bundle HTML strips source font preloads. Hashed-font preload experiment was
  running when the owner requested the pause; its browser was stopped, so it
  has no final acceptance verdict. No font/layout production optimization shipped.
- Evidence: `data/logs/prompt1-startup-*.log`,
  `data/logs/prompt1-font-preload-experiment.log`; opt-in probes under
  `scripts/diagnostics/`. Disable probe NODE_OPTIONS for normal verification.
- On resumption, compare exact-build baseline/variant traces and visual behavior,
  then verify without instrumentation. Restore 100 ms only when supported by
  evidence and agreed acceptance requirements.
