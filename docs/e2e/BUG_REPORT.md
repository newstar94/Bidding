# Browser and baseline bug report

All entries use commit `8b935359f40ce2841014f8f40dff5b1c91fcc032`. Evidence paths are relative to the repository and contain no secrets.

| ID | Severity | Module | Persona | Combination | Description | Evidence | Test |
|---|---|---|---|---|---|---|---|
| BUG-A11Y-001 | S3 | Dashboard accessibility | Super Admin | Chromium/Firefox/WebKit, desktop | axe reports serious `scrollable-region-focusable` for `.content-viewport`; the scrollable region has no keyboard-focusable content. | `test-results/auth-auth.smoke-AUTH-SMOKE-907e4-alidation-and-accessibility-{chromium,firefox,webkit}/error-context.md` and screenshots | `AUTH-SMOKE-001` |
| BUG-WEBKIT-001 | S3 | Cross-browser/CSP | Super Admin | WebKit desktop | WebKit smoke records two CSP stylesheet refusals and a 403 resource; Chromium/Firefox reach dashboard. | `...-webkit/error-context.md`, `trace.zip`, screenshot/video | `AUTH-SMOKE-001` |
| BUG-UI-001 | S3 | Google login / UI quality | Public login | desktop-1280 | `GSI_LOGGER: The given origin is not allowed for the given client ID` remains an unfiltered console error, causing UI-quality suite failure. | Command output in execution report; local origin `127.0.0.1:8000` | `npm run test:ui-quality-e2e` |
| BUG-LIFECYCLE-001 | S3 | Lifecycle result persistence test | Manager | 1G1T award then reload | After award, lifecycle test reloads the result tab; after tightening the test locator to require exactly one visible result, no visible matching contractor result is rendered, so persistence cannot be proved and contract/cancel/rebid assertions do not run. | Command output and failed assertion at `scripts/verify_full_lifecycle.mjs:318` | `npm run test:lifecycle` |
| BUG-TEST-001 | S3 | Auth test contract | Registered user | forgot-password known/unknown | With Turnstile disabled in isolated E2E, existing auth suite reaches forgot-password and asserts both responses are `ok()`, while the route intentionally returns HTTP 400 for an unknown identity. | Command output: `Forgot-password response failed`; route `backend/auth/otp_routes.py` returns mismatch 400 | `test:auth-roles-e2e` |
| BUG-FIXTURE-001 | S3 | Bidder-goods fixture | Manager | 1G1T lot-one-item | Fixture setup inserts duplicate active opening business keys with an empty normalized lot code and fails before browser import begins. | Command output contains `idx_thong_tin_mo_thau_active_business_key` and `bidder_goods_e2e_fixture.py:177` | `npm run test:bidder-goods-e2e` |
| BUG-TEST-002 | S3 | Password reset unit expectations | N/A | mismatched identity / successful reset | Two Python tests expect older copy. Current production constants append “Vui lòng kiểm tra lại.” and use “hoặc thư rác.”; the behavior is deterministic but the suite is red. | `tests/test_password_reset_feedback.py:38,56`, `backend/auth/otp_routes.py:50,54` | `npm test` |

## Reproduction details

### BUG-A11Y-001

1. Start local app at `http://127.0.0.1:8000`.
2. Open `/dang-nhap` in Chromium, Firefox or WebKit.
3. Log in as the configured local admin through the form.
4. Run `npm run test:e2e:smoke`.
5. Inspect axe output: `scrollable-region-focusable`, target `.content-viewport`, impact `serious`.

### BUG-FIXTURE-001

1. Ensure the configured bidder-goods workbooks exist.
2. Run `npm run test:bidder-goods-e2e`.
3. Fixture setup fails before `fixture-created` with the duplicate unique key reported above.

## Severity rationale and recommendations

- S3 A11Y/CSP/UI issues should become release-gated regression cases after the owning module confirms the expected behavior.
- Test/fixture failures should be fixed in the test harness without weakening assertions or changing product validation.
- Lifecycle failure should be reproduced with a visible, scoped locator before deciding whether the product result panel or only the test is wrong.
