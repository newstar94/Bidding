# Browser matrix policy

The required canonical Playwright gate runs on all three pinned projects:

- Chromium (`Desktop Chrome`)
- Firefox (`Desktop Firefox`)
- WebKit (`Desktop Safari`)

Run it with:

```text
npm run test:e2e:smoke
```

CI installs all three browser binaries and runs this command against the isolated E2E application. The required `browser-matrix.spec.mjs` covers the public landing and legal routes, login, authenticated initialization, dashboard navigation and profile-menu interaction. A default run must report three passes and no skipped required tests.

`contractor-violation.spec.mjs` is an optional recorded-provider scenario. Playwright includes it only when all of these are configured:

```text
E2E_PASSWORD or ADMIN_PASSWORD
E2E_CONTRACTOR_VIOLATION_PACKAGE_ID
VNEPS_VIOLATION_FIXTURE_PATH
```

Live VNEPS access is not allowed in CI. Missing optional fixture configuration excludes that spec at discovery time instead of reporting a misleading skip.

The large fixture-driven business scripts under `scripts/` remain Chromium-only. They cover deeper workflows but do not establish Firefox or WebKit support for every business screen. Cross-browser support claims are limited to the required canonical smoke until those suites are migrated explicitly.
