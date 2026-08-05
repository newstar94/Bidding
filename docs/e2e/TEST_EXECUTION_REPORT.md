# Browser test execution report

## A. Code and environment

- Branch: `main`
- Commit: `8b935359f40ce2841014f8f40dff5b1c91fcc032`
- Prompt reference commit: `e2196fb1e9e116fa11fa6de62843c361c3497cf2`; current code is newer.
- OS: Windows (PowerShell), timezone `Asia/Saigon`.
- Python: 3.14.5
- Node/npm: v24.18.0 / 12.0.2
- Playwright: 1.62.0
- Browsers: Chromium 1234, Firefox 153.0 (build 1538), WebKit 26.5 (build 2336)
- Database: local PostgreSQL configured by `.env`; E2E scripts use local synthetic fixtures.
- Base URL: `http://127.0.0.1:8000`; `/health/ready` returned `{"status":"ready"}`.
- Browser plugin: Codex In-app Browser used for headed exploration; Playwright used for automation.

## B. Commands and real exit codes

| Command | Exit | Result |
|---|---:|---|
| `npm run test:auth-shell` | 0 | Pass; auth shell, profile menu, owner modal |
| `npm run test:auth-roles-e2e` | 1 | Blocked at registration by local `BOT_CHALLENGE_REQUIRED` with Turnstile auto/test-key config |
| `$env:TURNSTILE_ENABLED='false'; .\scripts\run_isolated_audit_e2e.ps1 -Suite domain -Port 8010` | 1 | Auth roles advanced through RBAC/session flows, then failed on stale forgot-password response assertion |
| `npm run test:crud-modules-e2e` | 0 | Pass; CRUD, search/pagination, responsive/keyboard, PDF upload/download/delete |
| `npm run test:multi-assignee-e2e` | 0 | Pass; assignment/audit/notification/access cleanup |
| `npm run test:joint-venture-e2e` | 0 | Pass; JV, low-price, lots, 1G2T, Word/Excel, contract |
| `npm run test:low-price-conflict-e2e` | 0 | Pass; 409 row-version conflict/server-wins |
| `npm run test:offline-sync-e2e` | 0 | Pass; reconnect/interrupted retry |
| `npm run test:package-pairwise-e2e` | 0 | Pass; 15 representative package cases |
| `npm run test:lifecycle` | 1 | Fail after award; tightened locator found no single visible contractor result after reload (test harness change only) |
| `npm run test:performance` | 0 | Pass; 30 cold + 30 warm samples, thresholds asserted |
| `npm run test:ui-quality-e2e` | 1 | Fail; Google Identity origin console error on desktop-1280 |
| `npm run test:authenticated-ui-matrix` | 0 | Pass; 5 viewports × 7 authenticated screens |
| `npm run test:bidder-goods-e2e` | 1 | Fail during fixture setup: duplicate active opening business key |
| `npm run test:e2e:business-matrix` | 0 | Pass; generated 624 valid + 7 negative tuples |
| `npm run test:e2e:smoke` | 1 | 6 Playwright tests: 3 pass, 3 fail; all three browsers executed |
| `npm run test:turnstile-local-matrix` | 0 | Pass; six local Turnstile behavior cases |
| `npm run test:security-deploy` | 0 | Pass; 72 Python checks + Turnstile matrix |
| `npm run lint:security` | 0 | Pass; ESLint + Trusted Types checks |
| `npm run test:js` | 0 | Pass; 306/306 JavaScript tests |
| `npm test` | 1 | 426 passed, 2 failed; both password-reset feedback expectations disagree with current constants |

## C. Machine-readable artifacts

- [Playwright HTML report](../../playwright-report/index.html)
- [Playwright JUnit XML](../../test-results/e2e-junit.xml)
- [Playwright JSON](../../test-results/e2e-results.json)
- [Business matrix JSON](../../test-results/business-matrix.json)
- Failure screenshots/videos/traces: `../../test-results/auth-auth.smoke-AUTH-SMOKE-907e4-alidation-and-accessibility-{chromium,firefox,webkit}/`
- JV Word/Excel evidence: `../../test-results/e2e-artifacts/`

## D. Enumerated totals

For runners that emit machine-readable test-case counts:

```text
Canonical Playwright smoke total: 6
Passed: 3
Failed: 3
Blocked: 0
Skipped: 0
Flaky: 0

Python + JavaScript baseline total: 734
Passed: 732 (426 Python + 306 JavaScript)
Failed: 2 Python
Blocked: 0
Skipped: not counted by npm test summary
Flaky: 0 observed

Combined enumerated total: 740
Passed: 735
Failed: 5
Blocked: 0
Skipped: 0 reported by these runners
Flaky: 0 observed
```

Existing E2E scripts are listed separately because they emit named business steps rather than a standardized test-case count; they must not be silently added to the totals above.

## E. Coverage summary

| Module | Features | Operations | Roles | Valid combinations | Executed | Pass | Fail | Blocked | Coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Auth/session | 12 | 20 | 4 | 4 | high-risk partial | partial | 2 assertions | 1 Turnstile | Partial |
| Workspace/RBAC | 9 | 18 | 4 | 12 | auth fixture + multi-assignee | pass for fixture | 0 | owner/full matrix | Partial |
| Plans | 2 | 5 | 3 | generated | CRUD/lifecycle partial | pass CRUD | lifecycle later failure | 624 tuple exactness | Partial |
| Packages | 8 | 12 | 3 | 624 valid + 7 negative | 15 pairwise + JV/lifecycle | pass representative | lifecycle/fixture follow-on | full matrix | Partial |
| Evaluation/award | 7 | 14 | 3 | low-price/JV/lot variants | JV + low-price + lifecycle partial | pass executed | lifecycle reload assertion | bidder-goods exact flow | Partial |
| Contracts | 2 | 5 | 3 | status/type variants | CRUD + JV | pass executed | 0 | lifecycle contract path | Partial |
| Documents | 4 | 8 | 3 | file/type/worker variants | PDF + Word/Excel JV | pass executed | 0 | bidder-goods/worker failures | Partial |
| Offline/sync | 4 | 10 | 3 | conflict/retry variants | offline + conflict + assignment | pass executed | 0 | full multi-tab | Partial |
| A11Y/responsive | 8 | 12 | 3 browsers | 6 viewports | 5 viewport matrix + smoke | landing/authenticated partial | serious axe + WebKit CSP | 1440/200% | Partial |
| Performance | 6 | 10 | admin | baseline | 60 startup samples | pass | 0 | large dataset/leak loop | Baseline only |

## F. Product requirement results

| Requirement | Result |
|---|---|
| Workspace | Personal/org policy covered by code and auth fixtures; complete browser matrix remains partial |
| One person, multiple organizations | Exercised in auth roles fixture; later suite assertion failure prevents full clean run |
| One person, multiple roles | Code hierarchy and role switching exercised for manager/employee; owner not separately executed |
| Assignment one/many | Pass in multi-assignee suite |
| Plans / budget plans | CRUD pass; project/budget approval fields present; exact matrix not complete |
| Packages / CRUD | CRUD pass; pairwise 15 pass; full generated matrix not executed |
| Contracts | CRUD and JV contract pass; full lifecycle contract path blocked |
| Permissions / cross-org | Auth and multi-assignee fixture checks pass for executed cases; full artifact/export/WebSocket cross-org matrix incomplete |
| Medicine / consulting / 1G2T / lots | Rules covered by JS/JV/pairwise/lifecycle partial; bidder-goods fixture blocked |
| Independent/JV bidders | JV pass; independent covered by CRUD/lifecycle partial |
| Offline/sync/conflict | Offline and row-version conflict pass; complete multi-tab/person matrix incomplete |
| Files/documents | PDF and JV Word/Excel pass; bidder-goods import blocked |

## G. Conclusions

The application is not certified as fully tested. The mandatory full business tuple execution, all viewport requirements, owner-role matrix, bidder-goods import path, lifecycle completion, and several security/integration cases remain uncovered or blocked.
