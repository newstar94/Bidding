# E2E test data matrix

All data below is synthetic and scoped to local/E2E databases. Passwords and tokens are intentionally omitted.

| Fixture / run | Source | Main entities | Roles / workspaces | Operations | Cleanup / evidence |
|---|---|---|---|---|---|
| `auth-e2e-*` | `scripts/auth_roles_e2e_fixture.py` | manager, employee, registered user; active/other/suspended orgs | manager + employee, multiple organizations | login, deny, switch, revoke, expiry, member CRUD, reset, registration | fixture cleanup executed; suite blocked/fails at password-reset expectation depending Turnstile mode |
| `crud-e2e-*` | `scripts/verify_crud_modules_e2e.mjs` | investor, contractor, expert, plan, package, PDF, contract | isolated manager workspace | create/update/reload/delete/search/pagination/responsive/keyboard | cleanup verified in PostgreSQL; exit 0 |
| `multi-assignee-*` | `scripts/multi_assignee_activity_fixture.py` | package/contract assignments, activity, notifications, document | manager + employees + outsider | add/remove/inherit/successor/access | cleanup verified; exit 0 |
| `jv-e2e-*` | `scripts/joint_venture_e2e_fixture.py` | JV with 3 members, lots, opening, evaluation, Word/Excel results, contract | isolated manager workspace | duplicate guard, low-price, result, exports, contract, 1G2T | fixture cleanup executed; artifacts under `test-results/e2e-artifacts/`; exit 0 |
| `lp25-*` | `scripts/low_price_conflict_fixture.py` | two concurrent low-price updates | two contexts | row-version conflict, server-wins | cleanup verified; 409 `ROW_VERSION_CONFLICT`; exit 0 |
| `offline-e2e-*` | `scripts/verify_offline_sync_e2e.mjs` | package mutation/outbox | isolated user context | offline retry, reconnect, interrupted retry | cleanup verified; exit 0 |
| `pairwise-*` | `scripts/package_pairwise_fixture.py` | 15 generated package cases | manager | package field/form/procedure/method/lot combinations | cleanup verified; 15 representative cases pass |
| `E2E-*` lifecycle | `scripts/verify_full_lifecycle.mjs` | investor, contractor, 2 experts, plan, package, goods, opening, evaluation, award | admin | full lifecycle, cancellation, rebid, 1G2T, lots, imports | suite failed after award reload; current script does not run fixture cleanup in `finally`, so synthetic records require cleanup follow-up |
| `bg-e2e-*` | `scripts/bidder_goods_e2e_fixture.py` | 1G1T/1G2T packages, lot goods, opening/evaluation | admin | workbook import, detailed goods evaluation | setup failed before fixture-created marker due duplicate active opening key; cleanup status requires audit |
| `BC-0001..BC-0624` | `e2e/generators/generate_business_matrix.mjs` | generated tuple metadata only | manager/org manager representative | validity boundary generation | machine JSON in `test-results/business-matrix.json`; exact execution not claimed |

## File fixtures

- Existing PDF fixture is used by CRUD/JV flows and was uploaded, downloaded and deleted through UI.
- Existing Word template fixture was uploaded/activated/exported by JV flow.
- Bidder-goods Excel fixtures exist in the configured local OneDrive directory, but the fixture setup failed before UI import because of a duplicate opening business key.

## Data safety

No production URL, production database, real customer records or secrets were used as test data. Local `.env` was read only by test processes and was not copied into reports.
