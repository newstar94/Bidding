# Uncovered and blocked cases

The following cases are intentionally not marked as pass.

## Blocked by environment or external integration

- Auth registration in the first run is blocked by Turnstile `BOT_CHALLENGE_REQUIRED` when the running server uses `TURNSTILE_ENABLED=auto` and local test keys.
- Google OAuth was not completed against a real provider; local UI reports an origin/client-id mismatch.
- SMTP delivery, email inbox/OTP retrieval and provider outage recovery were not exercised through a real external mailbox.
- Document worker timeout, retry, sandbox and multi-replica shared-storage paths were not exercised in this Windows local run.

## Not executed as required full coverage

- 624 generated valid business tuples and 7 generated negative boundary tuples were created, but no exact-tuple shard runner has executed all of them. Existing 15-case pairwise output is representative only.
- Owner as a distinct active role and every module permission value across every organization are not fully browser-executed.
- Full cross-organization file artifact, export, notification/activity and WebSocket leakage matrix remains incomplete.
- Full multi-tab matrix: create/update/delete races, workspace switch while dirty, logout in another tab and duplicate rendering.
- Complete two-user concurrency matrix beyond the low-price row-version conflict fixture.
- 1440×900 viewport and 200% zoom requirements.
- Bidder-goods Excel import/export flow; fixture setup fails before UI import due duplicate active opening key.
- Full lifecycle after award: contract, cancellation, re-bid and final lot completion did not complete in the failing run.
- Large dataset targets (1,000 plans, 5,000 packages, large Excel file), long stability loop, memory/object URL/WebSocket/IndexedDB leak measurements.
- Full smoke/regression on Firefox and WebKit; only the canonical smoke and authenticated UI matrix were run there.

## Test debt / red baselines

- `test:auth-roles-e2e` has a stale unknown-forgot-password success assertion after the environment challenge is disabled.
- `tests/test_password_reset_feedback.py` has two stale copy expectations.
- `test:ui-quality-e2e` treats the Google GSI local-origin message as an error.
- `test:lifecycle` has a hidden-node locator ambiguity after reload.

## Required next run before release

1. Fix or explicitly classify the A11Y/CSP findings; rerun Chromium/Firefox/WebKit smoke and retain artifacts.
2. Repair fixture uniqueness and execute bidder-goods UI import/export.
3. Add a full-matrix sharded Playwright runner that consumes `test-results/business-matrix.json` and fails on unexecuted valid IDs.
4. Complete the owner/employee permission and multi-tab/concurrency matrix on isolated worker-scoped fixtures.
5. Resolve the two password-reset test expectations and rerun `npm test`.
6. Run 1440×900, 200% zoom, large-data and document-worker scenarios in a supported isolated environment.
