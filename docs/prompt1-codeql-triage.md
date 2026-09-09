# CodeQL local triage — Prompt 1

Final JavaScript analysis session 28006 completed **exit 0**, 89 queries,
686/686 JS/TS and 5/5 Actions files. SARIF `data/logs/prompt1-codeql-js-final.sarif`.
Five rule/path/line keys match the prior pull-flight analysis exactly, with no
new result locations. Production tableDataUtils, SyncPushService and SyncPullService
were compared to the source archive and match current contents. Python production
app/frontend_assets/access_policy likewise match its final source archive.
Retain the five contextual findings per language; neither run is zero-warning.

Python final analysis session 97557 completed **exit 0**, 45 queries,
647/647 Python and 5/5 Actions files. SARIF:
`data/logs/prompt1-codeql-python-final.sarif`. Five rule/path/line keys exactly
match the earlier Python SARIF: two CSP substring assertions, database URL path
logging, common-password denylist SHA256 and random reset-token SHA256. Existing
contextual triage remains applicable; no new result locations or suppressions.
JavaScript final refresh is running separately as `javascript-projection-final`.

Python final database creation is confirmed complete by terminal success log and
`finalised: true` metadata (old exec handle expired; no exit code invented).
Official Python code-scanning suite analysis started on `python-font-final`,
output target `data/logs/prompt1-codeql-python-final.sarif`; no verdict yet.

Latest source/archive comparison: 931 JS-snapshot entries and 750 Python-snapshot
entries compared as text. Relevant production deltas since those snapshots:
JS `frontend/shared/tableDataUtils.js`; Python `backend/app.py` and
`backend/frontend_assets.py`. Fixture/harness/tests also changed. Generated
manifest/report files differ as expected and are not treated as application
source evidence. Python final database refresh is now running; no current-source
analysis success is claimed until its result is available.

## Refresh completed 2026-09-09

JavaScript database `javascript-pull-flight-final` creation and analysis both
completed exit 0. Official default suite evaluated 89 queries; coverage reports
681/681 JavaScript/TypeScript and 5/5 Actions files. Output:
`data/logs/prompt1-codeql-pull-flight.sarif`; execution log:
`data/logs/prompt1-codeql-pull-flight-analyze.log`.
All five results have identical rule/path/line keys to
`prompt1-codeql-javascript-fixed.sarif`: three Turnstile substring assertions,
one version-comparison negative tag assertion, one trusted benchmark rewrite.
No new result location was reported. Existing contextual triage below still
applies; this is not a zero-warning claim. Python remains on its earlier snapshot
and package diagnostic edits require separate scope qualification.

Current-source qualification (2026-09-09): the later pull-flight promise fix in
`frontend/app/SyncPushService.js`, its ordering regression, and diagnostic harness
changes postdate these database snapshots. These results remain valid evidence
for the analyzed snapshot, not an exact final-worktree CodeQL claim. Final review
must reconcile/re-analyze changed JavaScript before declaring final-source
coverage. No finding has been suppressed by this qualification.

CLI 2.26.4; official packs python-queries 1.8.9 and javascript-queries 2.4.4;
default code-scanning suites. Both commands completed exit 0. Coverage reported
646/646 Python and 678/678 JavaScript/TypeScript files, plus Actions metadata.
SARIF files are `data/logs/prompt1-codeql-python.sarif` and
`data/logs/prompt1-codeql-javascript.sarif`.

The initial run has **14 findings**, not zero. At that checkpoint none had a
primary location in a modified tracked file; four test-server locations have
since been repaired. That observation alone does not prove a finding pre-existed:
interprocedural paths can change. No suppressions or baseline exclusions added.

| Findings | Location | Evidence / classification |
| --- | --- | --- |
| 2 Python URL-substring | tests/test_http_resource_limits.py:168,180 | Assertions inspect a CSP header, not a URL sanitizer. Test-strength concern, not a production URL allowlist |
| 1 clear-text logging | scripts/setup_local_postgres.py:361 | Prints only urlparse(database_url).path, the database name; credentials reside in URL userinfo and are passed to child environment, not printed at this location. Validate full SARIF path before final dismissal |
| 1 weak password hash | backend/auth/password_policy.py:41 | SHA-256 is used for in-memory common-password denylist membership, not credential persistence. New credentials use Argon2id in auth_helper.hash_password |
| 1 weak password hash | backend/auth/password_reset_service.py:23 | SHA-256 digests secrets.token_urlsafe(32) reset tokens. New password storage separately calls hash_password. Not a human-password storage hash |
| 3 JS URL-substring | scripts/verify_turnstile_local_e2e.mjs:41,165,171 | CSP assertion and browser-frame presence probes. Substring probes could accept misleading URLs, but do not authorize runtime network access |
| 4 XSS-through-exception | tests/js/package_timeline_cached_plan_selection.test.mjs:66; package_timeline_restore_race.test.mjs:190; package_timeline_plan_selection.test.mjs:276,399 | Local loopback fixture servers write exception messages to responses without explicit text/plain. Test-server hardening issue; not deployed application routing |
| 1 tag-filter | tests/js/version_comparison_panel.test.mjs:71 | Negative test assertion on generated markup; it is not the sanitizer. Case-insensitive assertion could strengthen the test |
| 1 multi-character sanitization | scripts/benchmark_obfuscation.mjs:131 | Regex rewrites trusted repository index.html for a benchmark variant, not arbitrary user HTML; variant limited to on/off and entry read from build manifest |

## Status

JavaScript re-analysis completed exit 0 on the re-extracted database:
678/678 JS/TS files, 89 queries, **5 remaining findings**. All four
`js/xss-through-exception` findings are absent. Remaining rules are three URL
substring probes, one negative tag assertion, and one trusted-template
benchmark rewrite, at the same locations described above. Output:
`data/logs/prompt1-codeql-javascript-fixed.sarif`.

Runtime path review completed for the three Python runtime/tool findings:
logging flow ends in `urlparse(database_url).path.lstrip('/')`, not userinfo;
password-policy SHA-256 is denylist lookup only; reset-token SHA-256 receives
the 32-byte random token generated by `secrets.token_urlsafe(32)`, including
the test path highlighted by SARIF. Human password replacement calls Argon2id
via `hash_password`. No suppression added and no runtime change made for these
contextually inapplicable findings.

Analysis executed on the current worktree snapshot; not a GitHub Actions run.
Production findings above have reviewed context, but final audit should inspect
SARIF flow paths and verify source identity before classifying this gate complete.
The four test-server exception-output paths were confirmed from request.url
through caught filesystem exceptions to response.end. Those handlers now emit
a fixed `Not Found` response with explicit text/plain when headers are unsent;
they never reflect exception text. Seven affected browser-backed unit tests
passed. The existing SARIF predates this test-only fix; re-extraction/analysis
is required to prove disappearance. Weak assertion matching remains documented,
not silently suppressed.

Source identity check before the test-server fix: Python source archive matched
750 compared files exactly. JavaScript archive matched 1091 compared files
except UTF-8 BOM removal in three files; their remaining bytes were identical.

Verification in progress after the four test-server fixes: JavaScript database
re-extraction session 54452; static checks session 35621 completed exit 0 and
diff check passed. Python production source did not change, so its existing
analysis remains applicable. The JavaScript rerun must complete before its new
finding count is stated.
