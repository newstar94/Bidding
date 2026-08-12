# Mua Sam Cong Complete Raw Bundle v2 - Completion Audit

Date: 2026-08-11

This document is the acceptance audit for the Complete Raw Bundle prompt. It
records implementation evidence, tests, measurements, and the remaining
operational constraint (a 50-100-code live benchmark requires an operator input
file and was not fabricated).

## A. Before-change analysis

- Raw was normalized at the source boundary and the lookup DTO retained only a
  small allowlist. Unknown upstream fields therefore disappeared before import.
- PLAN lookup selected one maximum revision and did not collect the
  package-detail edge.
- Complete collection was sequential, did not preserve every request/response
  envelope, and a failed child could discard successful siblings.
- The fallback browser and session bootstrap were initialized eagerly.
- Shared L2 was queried before process L1, and raw/source cache reuse did not
  exist.
- The benchmark used the legacy browser source rather than the production
  protected-API source and only measured cold/warm/cache.

The Phase 1 evidence is recorded in
[MUASAMCONG_COMPLETE_RAW_BUNDLE_PHASE1_RESEARCH_2026-08-11.md](research/MUASAMCONG_COMPLETE_RAW_BUNDLE_PHASE1_RESEARCH_2026-08-11.md).

## B. Implementation map

- [collectors.mjs](../backend/integrations/muasamcong_browser/collectors.mjs:183)
  implements the PLAN graph, bounded revision/package concurrency, source
  envelopes, raw response sanitization, partial failures, manifest, hashes and
  reusable raw-bundle manifest helpers.
- [endpoint_catalog.mjs](../backend/integrations/muasamcong_browser/endpoint_catalog.mjs)
  declares `PLAN_PACKAGE_DETAIL` and its revision-scoped identifier edge.
- [procurement_source.py](../backend/integrations/muasamcong_browser/procurement_source.py:599)
  separates raw collection from canonical mapping; `lookup_from_raw_bundle()`
  reprojects a stored bundle without upstream calls.
- [procurement_raw.py](../backend/procurement_raw.py:149) persists immutable,
  append-only source snapshots, sanitizes request/response/error data, hashes
  content, deduplicates captures, and reassembles fresh PLAN bundles safely.
- [service.py](../backend/procurement_lookup/service.py:260) enforces
  `L1 -> L2 -> RAW_SNAPSHOT -> upstream`, same-key coalescing and organization
  cache namespaces; lookup telemetry carries request correlation and timing
  dimensions.
- [routes.py](../backend/procurement_lookup/routes.py:122) keeps auth,
  workspace, organization and rate-limit checks, wires raw loading/persistence,
  and never exposes raw by default.
- [schema.py](../backend/db/schema.py:1955) and migration v53 add the raw
  snapshot table, content/dedup hashes, size limits and immutable trigger.
- [benchmark_muasamcong.py](../scripts/benchmark_muasamcong.py) now uses the
  production source in live mode and measures all required scenarios; fixture
  mode is deterministic and network-free.

## C. API contract

`POST /api/procurement/lookup` accepts the backward-compatible `code` and
optional server-validated:

```json
{
  "code": "PL2600244105",
  "detailLevel": "COMPLETE",
  "revisionMode": "ALL",
  "revisionNumbers": []
}
```

Defaults remain `detailLevel=CANONICAL` and `revisionMode=LATEST`. `SUMMARY`
does not fetch the graph, `CANONICAL` fetches the normal domain projection, and
`COMPLETE` collects and returns the raw bundle. `SELECTED` requires the requested
revision numbers. The frontend forwards only these allowlisted fields.

## D. Data model and acceptance matrix

| Requirement | Evidence | Result |
|---|---|---|
| Preserve raw JSON and unknown fields | Source envelopes keep sanitized response objects; Python and JS fixtures assert future fields and all package field names | PASS |
| Collect SEARCH -> version list -> every revision detail -> package detail | PLAN collector and live smoke for PL2600244105 | PASS |
| Keep package ownership per revision | `revisions[revision].packages`; JS test asserts `00` and `01` independently | PASS |
| Preserve successful sources on partial failure | Failed-envelope JS test and `FOUND_PARTIAL` classification | PASS |
| Immutable raw storage and deduplication | v53 schema, immutable trigger, content/dedup hash tests, live PostgreSQL round trip | PASS |
| Canonical is a projection, not source of truth | `map_plan_raw_bundle()` and `lookup_from_raw_bundle()`; remap test performs zero upstream calls | PASS |
| Fresh raw reuse without refetch | Repository loader tests for freshness, ALL/LATEST/SELECTED and incomplete-package fallback; route wiring test | PASS |
| Alias mapping and schema-versioned canonical/mapping | `canonical.pick()`, canonical v2 and mapping v2 | PASS |
| L1 before L2; cache hit avoids upstream | Service tests for L1/L2 order, raw hit and organization scope | PASS |
| Bounded parallel detail requests | `mapConcurrent` capped at configured concurrency; JS graph tests | PASS |
| Lazy fallback and reusable single-flight session | Worker/runtime/session tests; live `browserFallback.launched=false` | PASS |
| No default raw payload | Route/client regression tests; raw only appears for COMPLETE | PASS |
| Auth/workspace/org/rate-limit boundaries remain | Existing route tests plus raw-loader organization isolation | PASS |
| Secrets absent from raw DB/log/API | Collector and repository response sanitization, redaction tests, source/lookup request IDs | PASS |
| Structured telemetry | Provider, kind, code, request ID, cache layer, detail/revision, session/upstream/collection/mapping timings and partial count | PASS |
| Extensible collector pattern | Shared `rawBundleSourceEnvelopes()`/`buildRawSourceManifest()` helpers and revision/child container convention | PASS |

## E. Test report

- `npm test`: PASS, exit 0. This includes the complete Python suite with
  coverage/critical-coverage gates and the complete JS coverage suite.
- Targeted raw/lookup/source/route/benchmark tests: 51 passed.
- PLAN/session/collector JS transport tests: 25 passed.
- `npm run check:static`: PASS (schema runtime, migration fixture, Python
  quality, mojibake, module graph and frontend debt checks).
- `npm run lint:security`: PASS.
- Live PostgreSQL raw snapshot round trip: PASS (dedup, reassembly, immutable
  update rejection; skipped only when `TEST_DATABASE_URL` is absent).
- Live `PL2600244105` COMPLETE/ALL smoke: `FOUND_COMPLETE`, revisions `00` and
  `01`, 8 packages, 12/12 source success, package-detail operation present,
  browser fallback not launched.

## F. Performance report

The earlier implementation measurements and the new production measurements
are retained below. Network conditions and portal content can change, so these
are dated observations, not promises.

| Scenario | Before | After |
|---|---:|---:|
| First canonical lookup | 9414.906 ms | 6071.886 ms |
| Warm-session canonical | not separately measured | 172.656 ms |
| L1 hit | L2 was queried first | 0.039 ms |
| L2 hit | unavailable | 1.789 ms (test PostgreSQL cache adapter) |
| COMPLETE latest | old complete path did not complete | 7481.592 ms |
| COMPLETE all revisions | failed after about 22300 ms, no bundle | 9060.797 ms, revisions 00/01, 12/12 sources |
| Concurrent x4 | not measured | 602.380 ms total using four isolated cache scopes for the supplied code |
| Browser fallback launches on protected happy path | eager | 0 in live smoke |

The live full 50-100-code benchmark is available with:

```powershell
python scripts/benchmark_muasamcong.py --input .\tmp\muasamcong-live-codes.json --live --concurrency 4 --output .\tmp\muasamcong-live-report.json
```

It was not run here because no operator-supplied 50-100 code file was provided;
the implementation does not enumerate codes or invent missing measurements.
Fixture mode covers the same scenario matrix deterministically.

## G. Remaining risks

- The Node worker IPC exchange is still lock-step. The bounded concurrent smoke
  does not prove that IPC multiplexing is worth its complexity; this remains a
  P2 optimization candidate.
- Immutable dedup intentionally does not rewrite an existing snapshot's
  timestamp. Once the freshness window expires, an identical refetch creates no
  duplicate row and the request remains the authoritative new observation for
  the normal L1/L2 path; a future observation index could extend raw reuse if
  that policy becomes necessary.
- Live upstream schemas can add fields or change fingerprints. Unknown fields
  are retained, while parser mismatches fail closed as `PROCUREMENT_SCHEMA_CHANGED`.

Conclusion: all code-level acceptance criteria have executable evidence and the
production PLAN smoke is complete. The only deferred artifact is the statistical
50-100-code live benchmark, which requires operator-provided input by design.
