# Startup performance follow-up

## Superseding implementation — 2026-10-01

The public landing startup regression is reproduced on the corrected secure
bundle fixture: a 231 ms task includes 221 ms forced style/layout; a repeated
baseline still reaches 136 ms. Removing only the immediate scrollY read still
reaches 121 ms. The bounded repair uses viewport-driven layout for below-hero
sections/footer, without changing fonts, content, design or authorization.
Native anchor clicks/reloads materialize real section heights; pagehide stores
a canonical history coordinate so Back does not restore against estimates.
See [ADR 0050](adr/0050-landing-startup-viewport-layout.md).

Final runtime build `9ba7082517f82a60f48cd27bb436a7a82259c1a3e772f349aaa5e18c8fa3747d`
(`app-ChxRBdez.js`) passes the first uninstrumented acceptance run:
30 cold + 30 warm, 100 ms maximum startup long task, no recorded tasks at or
above the browser's 50 ms reporting threshold. Cold/warm median readiness is
140.3/45.4 ms; p95 is 421.9/114.4 ms. These readiness durations are **not** a
claim that total startup finishes within 100 ms. Native hashed-asset requests
are 300 cold / 0 warm. Evidence: `data/logs/landing-startup-final-gate-1.log`.

The fixture includes backend-like HTML/preloads/cache, waits for successful
bootstrap and initial font/render, validates both performance collectors and
each required resource, and fails on runtime/network errors. Only the target
Document is fulfilled; subresources use ordinary same-origin HTTP/native cache.
Normal browser security remains enabled. No build, browser suite or other
runtime suite runs alongside the acceptance measurement. The final repeat on
the same build also passes 30 cold + 30 warm with no recorded tasks >=50 ms:
cold/warm median readiness 141.1/46.8 ms, p95 440.0/98.5 ms, native hashed-asset
requests 300/0. Evidence: `data/logs/landing-startup-final-gate-2.log`.
Full JavaScript coverage passes 2,049 tests, no failures/skips, and all 14
critical ratchets; the final focused browser/landing suite passes 26/26,
including all 9 deferred-layout tests and primary text/style/vector negative
controls. Source/build/package verification passes; the repair report records
the exact artifact identity and staging limits.

Historical failures below retain their original verdicts. The 100 ms gate and
30+30 samples have not been relaxed. This verifies the local public-landing
fixture, not authenticated startup on the actual Edge/staging/production origin.
No deployment or production restart is performed.

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
