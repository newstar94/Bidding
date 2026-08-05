# Role and permission matrix

## Roles derived from code

`frontend/app/BiddingModel.js` defines the hierarchy `super_admin → owner → manager → employee`. `backend/shared/access_policy.py` treats `super_admin` as platform admin and `manager` as organization manager; personal workspace owners and inherited manager access are separate policy paths.

| Persona / active role | Personal workspace | Organization manager | Organization employee | View | Create/update/delete | Assign / permission matrix | Cross-org |
|---|---|---|---|---|---|---|---|
| Super Admin (`super_admin`) | allowed by platform policy | platform-wide admin path | can switch active role when supported | all scoped data | platform/admin actions | platform admin; org matrix restrictions apply | must be denied outside selected scope |
| Owner (`owner`) | owner scope | manager-like effective access where membership allows | inherited specialist access | organization data | manager-like when active membership permits | manager/owner policy | denied for other organizations |
| Manager (`manager`) | owner path if personal | full organization module access | can act as employee when switched | organization data | CRUD for organization modules | assignment and permission matrix | denied for other organizations |
| Employee (`employee`) | own personal data | inherited specialist access only when source role grants it | requires active membership, module grant and assignment | view/edit according to matrix | assigned/owned records only; `edit` required for mutation | cannot assign others or edit permission matrix | denied for other organizations |
| Unauthenticated | public routes only | no | no | public landing/legal | no | no | no |

## Module policy mapping

| Backend table / child | Module grant | Manager | Employee with `view` | Employee with `edit` | Assignment-sensitive |
|---|---|---:|---:|---:|---:|
| `chu_dau_tu` | `chudautu` | Yes | Yes (shared reference) | Yes (policy) | No |
| `nha_thau` | `nhathau` | Yes | Yes (shared reference) | Yes (policy) | No |
| `ke_hoach_lcnt` | `kehoach` | Yes | Yes | Yes | Yes |
| `goi_thau` | `goithau` | Yes | Yes | Yes | Yes |
| `thong_tin_mo_thau` | `goithau` | Yes | inherited package scope | inherited package scope | Yes |
| `goi_thau_hang_hoa` | `goithau` | Yes, editable only in allowed status | No mutation | Yes in allowed status | Yes |
| `hang_hoa_du_thau_nha_thau` | `goithau` | Yes, evaluation scope | No mutation | Yes in evaluation scope | Yes |
| `chuyen_gia` | `chuyengia` | Yes | Yes | Yes | No |
| `hop_dong` | `hopdong` | Yes | Yes | Yes | Yes |
| `permissionmatrix` | protected key | Organization manager only; Super Admin cannot configure organization matrix | No | No | N/A |
| `assignments` | protected key | Manager/platform policy | No | No | N/A |
| `organizations`, `employees`, `systempackages` | protected keys | platform/org administration | No | No | N/A |

## Execution status

- Manager and employee flows, workspace switching, membership removal, suspension, permission revocation, deep-link/API denial and multi-assignee behavior were exercised by the existing auth/multi-assignee suites before the auth suite's later password-reset assertion failure.
- `owner` as a distinct active persona, every permission value for every module, and every cross-org file/WebSocket/export path are not fully executed; see `UNCOVERED_OR_BLOCKED_CASES.md`.
- UI checks are not a substitute for backend authorization checks; the auth roles suite includes both UI and request-level checks for its fixture.
