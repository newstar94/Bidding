# Feature inventory derived from the current code

Sources inspected: `views/index.html`, `views/components/sidebar.html`, `views/tabs/`, `frontend/app/`, feature modules under `frontend/{plans,packages,contracts,partners,experts,documents,auth}/`, `backend/app.py`, `backend/shared/access_policy.py`, and existing `scripts/*e2e*`.

| Module / route surface | Features and entities | UI operations | Permission / data boundary | Existing evidence |
|---|---|---|---|---|
| Landing `/` | product overview, solution, workflow, roles, plans | navigate sections, follow login/legal links | public | headed exploration, UI smoke |
| Auth `/dang-nhap` | login, registration, Google, password reset, remember-me, Turnstile | fill, submit, keyboard validation, toggle password | unauthenticated/authenticated session | headed login, auth shell, auth roles, Turnstile matrix |
| Dashboard `/tong-quan` | work today, warnings, plans/contracts/packages summaries, partner counts | open widget/list, reload, role-aware view | active workspace and role scope | headed dashboard, authenticated UI matrix, performance |
| Super admin | user/org administration, platform dashboard | list/filter, user/org management | `super_admin` only | auth shell / auth roles partial |
| Workspace and members | personal/org workspace, membership, manager/employee role, assignments | switch workspace, add/update/remove members, assign one/many | cross-organization isolation | auth roles, multi-assignee |
| Plans `/ke-hoach` | plan versions, project/budget type, approval type, investor | create/read/update/delete, search, pagination, reload | manager/permission/assignment | CRUD pass; lifecycle partial |
| Packages `/goi-thau` | tender package, field/form/procedure/method, medicine, lots, purchase option | create/read/update/delete, search/filter/pagination, detail | package module grant and assignment | CRUD, pairwise, JV, lifecycle partial |
| Package detail | preparation, HSMT release, extensions, opening, evaluation, result, documents, goods, timeline | tabs, modals, dates, file upload, save/transition/cancel/rebid | package lifecycle and role grants | JV, low-price, lifecycle partial |
| Opening `/mothau` | bidders, prices, discounts, bid security, lot scope | add/edit/save, reload | package scope and permission | JV, lifecycle partial |
| Evaluation `/danhgiahsdt` | technical/financial evaluation, detailed criteria, low-price | select/fill/save, detailed subflows, Excel import/export | status lock and evaluator scope | 306 JS tests, JV, low-price, authenticated matrix |
| Award/result | bidder outcome, award price, approval, partial lot results | approve, reload, export Word/Excel | transition and package status | JV pass; lifecycle blocked after reload assertion |
| Contracts `/hop-dong` | contract, type, status, assignment, package links | create/read/update/delete, status, reload | contract grant/assignment | CRUD, JV |
| Partners | investors `/chu-dau-tu`, contractors `/nha-thau`, experts `/chuyen-gia` | create/read/update/delete, search, pagination | shared references / organization scope | CRUD pass |
| Documents / Word | package files, Word templates, variables, reports | upload, validate, download, delete, export, template CRUD | organization/personal asset policy | CRUD PDF pass, JV Word pass, JS tests |
| Excel | package goods, bidder goods, evaluation/award exports | import, preview, reconcile, export, formula safety | scoped package/lot and document worker | JS tests, JV exports; bidder-goods fixture blocked |
| Offline/sync | BrowserDB, outbox, delta, retry, WebSocket | offline mutation, reconnect, conflict recovery | row version, workspace, session | offline, low-price conflict, multi-assignee, JS tests |
| Notifications/profile/legal | notifications, profile, terms/privacy/security | open center, profile actions, legal navigation | session and role | auth shell/UI matrix; legal tests |

## Inventory limitations

The application has no single route registry document; lazy tabs are assembled from HTML partials and JavaScript controllers. The inventory therefore cites source surfaces and execution scripts rather than assuming that an old file list is exhaustive.
