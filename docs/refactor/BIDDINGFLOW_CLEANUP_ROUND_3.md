# BiddingFlow cleanup round 3

Ngày thực hiện: 2026-08-08  
Nhánh: `main`  
HEAD sau `git fetch origin && git rebase origin/main`: `f558c18984aed1c32b28c9915a6b5383dcc461a0`

Tài liệu này là bằng chứng thực thi cho cleanup vòng 3. Số liệu “Before” được đo trên HEAD ở trên trước khi sửa; số “After” chỉ được cập nhật sau khi gate tương ứng chạy lại.

## Phase 0 — inventory và baseline

### Before

| Gate | Baseline đo được |
|---|---|
| Python | 630/630 pass |
| JavaScript | 497/497 pass |
| Critical coverage | pass |
| Frontend debt | `direct_state_writes=59`, `important=421`, `raw_colors=842`, `runtime_styles=541`, `inferred_actions=6` |
| Python debt | `BLE001=118`, `F401=0`, `F841=0`, `S110=0`, `S608=128` |
| Startup source | cold p95 585 ms, warm p95 336 ms, longest task 0 ms; một fresh-source run khác 603/254/0 ms |
| Secure production | fresh runs 516/198/121 ms và 509/196/106 ms; noisy run 2350/205/109 ms |

Artifact `data/logs/startup-performance.json` trước sửa đang ghi `passed=false`, cold p95 2350 ms, warm p95 205 ms, cold longest task 109 ms, warm longest task 54 ms. Host từng có CPU nền khoảng 17–21%; vòng profiling cuối phải giữ tất cả outlier và phân biệt contention với regression.

### E2E baseline

Cùng HEAD đã có bằng chứng round 2 rằng cả 11 gate pass: auth shell, auth/roles, CRUD, multi-assignee, joint venture, bidder goods, low-price conflict, offline/reconnect, package pairwise, full lifecycle và UI quality. Round 3 vẫn chạy lại toàn bộ trước khi kết luận.

### Persistence inventory

- `persistData(`: 14 match gồm declaration, internal helper và caller.
- `trackDeletions(`: 2 match; một declaration và một call từ `persistData()`.
- `persistAndSync(`: 31 match; 10 call có explicit `changes`, 19 actual caller còn đi implicit fallback sau khi loại declaration/helper.
- Chưa có caller nào dùng `allowLegacyPersistence` vì API chưa tồn tại.

| Caller/nhóm | Table | Synced? | Vì sao cần legacy? | Giữ/Migrate |
|---|---|---:|---|---|
| `WorkspaceDataStore.transaction()` | caller-supplied | mixed | generic compatibility transaction chỉ biết snapshot sau callback | audit; chỉ giữ nếu explicit allowlist |
| Admin/workflow/package/plan callers còn lại | business tables | yes | mutation có thể biểu diễn rõ | migrate sang explicit change-set |
| local-only caller | local-only table | no | không có server mutation | giữ local persistence, không cần opt-in |

Danh sách caller chi tiết và quyết định cuối sẽ được bổ sung trong Phase 2 sau characterization test.

### Cache/session inventory

- `WorkspaceDataStore.#completed` là `Map` không cap/TTL, sống theo controller trong `WeakMap`; cùng controller có thể đổi workspace mà cache không reset.
- Aggregate-version hiện gọi `POST /api/auth/check-session` một lần trên mỗi version action. Hai action liên tiếp tạo hai request capability.

### Finding

1. `trackDeletions()` bắt mọi lỗi đọc IndexedDB rồi chỉ log, cho phép `persistData()` tiếp tục full-table write và mutation staging.
2. `persistAndSync()` mặc định fallback sang `persistData()` khi synced caller không đưa `changes`; chưa có opt-in hay quality gate allowlist.
3. Completed mutation cache tăng theo controller lifetime và có thể reuse ID qua workspace.
4. Capability discovery chưa gắn với authenticated-session lifecycle.
5. Secure production long-task 106–121 ms từng xuất hiện nhưng chưa đủ evidence để quy cho module cụ thể; noisy host còn tạo cold outlier 2350 ms.

### Root cause

Các compatibility seam còn dùng default permissive behavior: read failure bị hạ thành log, full-table persistence được suy diễn, idempotency cache không có lifecycle boundary và capability được phát hiện tại action boundary thay vì session boundary.

### Files changed

- `docs/refactor/BIDDINGFLOW_CLEANUP_ROUND_3.md` (Phase 0 only).

### Behavior change

Chưa thay runtime behavior trong Phase 0.

### Tests

Baseline `npm test` pass 630 Python + 497 JavaScript; critical coverage pass. E2E baseline lấy từ full gate trên cùng HEAD ở report round 2 và sẽ được chạy lại.

### Performance

Budget giữ nguyên: cold p95 ≤ 800 ms, warm p95 ≤ 325 ms, longest task ≤ 100 ms. Không dùng secure-off build để thay cho secure-production measurement.

### Debt before/after

Before đã ghi ở bảng trên; After chưa có trong Phase 0.

### Backward compatibility

Chưa đổi compatibility contract. Các phase sau phải giữ local-only persistence, mixed-version backend fallback, outbox và server-side idempotency.

### Remaining risk

Long-task chưa tái hiện ổn định và capability identity seam chưa được chốt bằng session lifecycle test. Không tối ưu subscription comparison nếu profiler không chứng minh đây là hot path.

## Phase 1 — fail-closed `trackDeletions()`

| Mục | Kết quả |
|---|---|
| Before | `trackDeletions()` bắt toàn bộ exception rồi chỉ `console.error`, nên `persistData()` vẫn có thể ghi full table sau một read failure. |
| Finding | Successful empty read là dữ liệu hợp lệ; request error, transaction abort, corruption/version mismatch và security error đều phải dừng compatibility persistence. |
| Root cause | `getTableData()` và phần diff/staging nằm chung một `try/catch` permissive. |
| Files changed | `frontend/app/BiddingModel.js`, `tests/js/bidding_model_storage_hydration.test.mjs`. |
| Behavior change | Read failure được `_recordStorageReadFailure()` chuẩn hóa thành `BrowserDBError`, phát hydration failure event rồi throw. Không chạy diff, `putTableData`, upsert/deletion staging. |
| Tests | Empty read; bốn error class; no-write/no-stage; pending outbox giữ nguyên; compatibility caller nhận rejection; recovery read rồi retry thành công. 83 targeted storage/browser/bidder-goods tests pass. |
| Performance | Success path không thêm read; failure path chỉ cập nhật bounded failure state và log metadata không nhạy cảm. |
| Debt before/after | Không đổi debt counter. |
| Backward compatibility | Empty IndexedDB table và successful legacy diff giữ semantics cũ. Retry yêu cầu hydration/server recovery rõ ràng thay vì tự ghi đè. |
| Remaining risk | Corruption vật lý vẫn cần browser/server recovery; thay đổi này fail-safe chứ không tự sửa IndexedDB. |

## Phase 2 — explicit legacy persistence

| Mục | Kết quả |
|---|---|
| Before | 19 actual business caller gọi `persistAndSync()` cho synced table mà không đưa `changes`; fallback sang `persistData()` là mặc định. |
| Finding | Tất cả 19 caller đều đã có record/package scope hoặc snapshot trước/sau đủ để biểu diễn upsert/deletion. Generic `WorkspaceDataStore.transaction()` cũng có thể diff draft với snapshot tại boundary. |
| Root cause | API coi thiếu change-set là yêu cầu full-table diff, và quality scanner mới chỉ chặn literal `persistData("synced")`. |
| Files changed | `frontend/shared/persistencePolicy.js`, `frontend/shared/MutationService.js`, `frontend/app/WorkspaceDataStore.js`, các caller trong admin/experts/contracts/plans/packages; `scripts/check_frontend_debt.py`; unit tests storage/mutation/debt/workflow liên quan. |
| Behavior change | `allowLegacyPersistence=false` mặc định. Synced + no changes throw `EXPLICIT_CHANGES_REQUIRED`; explicit changes dùng record persistence; local-only vẫn dùng compatibility persistence. Production legacy opt-in allowlist hiện rỗng. |
| Tests | Synced reject, synced explicit path, local-only path, explicit projection opt-in API, workflow regressions, direct-award contractor persistence và scanner tests. Full JS cuối: 514/514 pass. |
| Performance | Loại 19 đường full-table read/`JSON.stringify` khỏi business workflow; không thêm sync request. |
| Debt before/after | `direct_state_writes=59`, `important=421`, `raw_colors=842`, `runtime_styles=541`, `inferred_actions=6` — không đổi. Scanner mới pass. |
| Backward compatibility | `persistData()` core và local-only tables còn hoạt động. Projection/hydration có thể opt-in tường minh nhưng production chưa có caller nào được allowlist. |
| Remaining risk | Compatibility API vẫn tồn tại; mọi opt-in production mới phải được thêm chính xác theo file qua review/scanner, không có wildcard. |

### Inventory quyết định cuối

| Caller | Table | Synced? | Vì sao cần legacy? | Giữ/Migrate |
|---|---|---:|---|---|
| `AdminUserController.deleteHoSoGiayStatus` | `customcontractstatuses` | yes | Không cần; record xóa đã được refresh | Migrate deletion change-set |
| `WorkspaceDataStore.transaction` | dynamic | mixed | Không cần; boundary có before/draft snapshot | Migrate record diff change-set |
| `HopDongWorkflow` save | `hopdong`, `assignments` | yes | Không cần; contract family và assignment delta đã biết | Migrate scoped upserts; assignment delta tự persist |
| `ChuyenGiaWorkflow` save | `chuyengia` | yes | Không cần; version family đã biết | Migrate scoped upserts |
| `BidderGoodsWorkflow` save | goods/opening | yes | Không cần; active scope IDs đã biết | Migrate scoped upserts |
| `bidEvaluationActions` | package/opening | yes | Không cần; evaluated rows đã biết | Migrate scoped upserts |
| `bidProcessTenderLifecycle` (2) | `goithau` | yes | Không cần; một package record | Migrate scoped upsert |
| `GoiThauWorkflow` save | package aggregate/plan | yes | Không cần; final aggregate IDs đã biết | Migrate aggregate-scoped upserts |
| `packageEvaluationProgress` (4) | package/contractor/opening | yes | Không cần; package, referenced contractors và package bids đã biết | Migrate scoped upserts |
| `packageFinancialOpening` | package/opening | yes | Không cần; changed bid IDs đã biết | Migrate scoped upserts |
| `packageInvitation` | `goithau` | yes | Không cần; một package record | Migrate scoped upsert |
| `packageLifecycleWorkflow` (2) | package/opening/plan | yes | Không cần; delete helper trả exact records | Migrate upsert/deletion change-set |
| `packagePreparation` | package aggregate | yes | Không cần; snapshot records đã biết | Migrate aggregate-scoped upserts |
| `packageRebidWorkflow` | `goithau` | yes | Không cần; một package record | Migrate scoped upsert |
| `KeHoachWorkflow` save | plan aggregate | yes | Không cần; target plan/package aggregate đã biết | Migrate aggregate-scoped upserts |

Kết quả: 19/19 implicit business caller được migrate; 0 production caller được phép `allowLegacyPersistence:true`.

## Phase 3 — bounded completed-mutation cache

| Mục | Kết quả |
|---|---|
| Before | `#completed = new Map()` tăng theo controller lifetime và không nhận biết workspace switch. |
| Finding | Production hiện chỉ có một public `patch()` hot caller; 750 ID tạo khoảng đệm retry lớn mà vẫn có hard bound. Server idempotency vẫn là nguồn đảm bảo cuối sau client eviction. |
| Root cause | Cache dedupe không có eviction policy hoặc workspace identity. |
| Files changed | `frontend/app/WorkspaceDataStore.js`, `tests/js/workspace_data_store.test.mjs`. |
| Behavior change | LRU hard cap 750 (`COMPLETED_MUTATION_CACHE_LIMIT`); cache hit refreshes recency; workspace token/epoch đổi sẽ clear trước lookup. |
| Tests | Duplicate dedupe, LRU eviction, cap behavior, evicted ID executes safely, A→B→A workspace isolation. 13/13 store tests pass. |
| Performance | O(1) Map lookup/update; eviction chỉ xóa oldest key khi vượt 750. |
| Debt before/after | Không đổi. |
| Backward compatibility | Outcome/idempotency semantics giữ nguyên cho IDs còn trong cache; ID đã eviction dựa vào server-side idempotency như trước. |
| Remaining risk | Client cache không thay thế server retention window; mutation ID phải tiếp tục unique. |

## Phase 4 — session-scoped server capabilities

| Mục | Kết quả |
|---|---|
| Before | Mỗi aggregate-version action gọi `POST /api/auth/check-session`; hai action tạo hai capability request. |
| Finding | Bootstrap và background session refresh đã mang `user.id` cùng `serverCapabilities`; logout/session-invalid boundaries đã có central hooks. |
| Root cause | Capability discovery nằm trong action client, không có session-owned cache/promise. |
| Files changed | `frontend/auth/serverCapabilities.js`, `frontend/shared/AggregateVersionClient.js`, `frontend/app/app.js`, `frontend/app/workspaceBootstrap.js`, `frontend/auth/AuthSessionController.js`, `frontend/auth/AuthFlowController.js`, `frontend/auth/authRuntimeState.js`, aggregate tests. |
| Behavior change | Cache theo authenticated `user.id`; bootstrap/refresh cập nhật; unresolved discovery fetch-once; logout, idle expiry, invalid session và user change invalidate/replace. Không lưu cookie/token/session secret. |
| Tests | Hai action: `check-session 2→1`; bootstrap primed: `1/action→0/action`; legacy missing capability fallback; refresh update; logout/user change; capable 404 và 409 vẫn propagate đúng. 7/7 aggregate tests pass. |
| Performance | Bỏ request session lặp trên version action; aggregate POST count không đổi. |
| Debt before/after | Không đổi. |
| Backward compatibility | Legacy server thiếu field được cache thành unsupported cho session và dùng snapshot fallback; endpoint-capable 404/409 không bị hiểu nhầm là thiếu capability. |
| Remaining risk | Backend chưa quảng bá opaque session ID; cache dùng user identity cộng explicit lifecycle invalidation. Nếu tương lai có session ID không nhạy cảm, có thể dùng làm key mạnh hơn. |

## Phase 5 — secure-production profiling

| Mục | Kết quả |
|---|---|
| Before | Secure fresh samples từng có longest task 106–121 ms; một host-noise run cold p95 2350 ms. Chưa có phase/CPU evidence. |
| Finding | 15 cold + 15 warm secure runs trên fresh port 8023: cold p95 473 ms, warm p95 188 ms, longest 84/0 ms, tất cả runtime failure rỗng. 15 cold long tasks dài 74–84 ms đều ở `document-bootstrap`; attribution API trả `unknown/window`, chỉ overlap font fetch. Không task nào ở controller init/hydration; warm không có long task. CPU busy cold 27.8–59.0% (median 37.5%), warm 20.8–41.6% (median 32.1%). |
| Root cause | Outlier >100 ms cũ không tái hiện trong 30 sample mới nên chưa có culprit reproducible. Font overlap không chứng minh causal module. |
| Files changed | `scripts/measure_startup.mjs`; evidence `data/logs/startup-performance-round3-profile.json`. Không sửa product startup code. |
| Behavior change | Profiler nay ghi phase, Long Tasks attribution/resource overlap và host CPU busy mỗi sample. Threshold vẫn 800/325/100, secure build vẫn bật. |
| Tests | `node --check`, performance benchmark harness 3/3, secure build pass, isolated secure profile pass. |
| Performance | Before secure 516/198/121 và 509/196/106 ms (plus noisy 2350/205/109); profile 15+15 là 473/188/84 ms; final gate 30+30 là 466/179/94 ms. Đây là distribution/environment evidence, không nhận là code optimization. |
| Debt before/after | Không đổi. |
| Backward compatibility | Chỉ mở rộng JSON profiler fields; existing summary/threshold fields giữ nguyên. |
| Remaining risk | Long Task API không map `unknown/window` tới module JS cụ thể. Vì outlier không tái hiện ổn định, subscription comparison được defer; không tối ưu mù. |

## Phase 6 — final gates và completion audit

| Mục | Kết quả |
|---|---|
| Before | Baseline 630 Python, 497 JS; secure performance có >100 ms outlier; 19 implicit business persistence caller. |
| Finding | Tất cả gate bắt buộc pass sau code cuối. Completion audit còn phát hiện và sửa một direct-award seam: contractor mới phải nằm trong explicit award change-set. |
| Root cause | Test cũ chỉ kiểm tra package approval; direct-award helper có thể tạo `nhathau` trước commit dependencies nhưng inventory ban đầu chỉ nhìn tên caller. |
| Files changed | Regression trong `tests/js/qualified_approval_persistence.test.mjs`; scoped contractor upsert trong `frontend/packages/packageEvaluationProgress.js`; toàn bộ report này. |
| Behavior change | Direct/special award persist chính xác contractor được bid tham chiếu, không full-table `nhathau`. Không thay product feature. |
| Tests | `npm run check` pass: Python 633/633, JS 514/514, critical coverage 15 modules, lint/security/module/debt, secure build, FK audit, production package, SBOM. `npm run audit:dependencies`: npm 0 vulnerability, pip-audit 0 known vulnerability. |
| Performance | Final secure production 30 cold + 30 warm: cold min/median/p95/max 372/399/466/490 ms; warm 140/152/179/216 ms; longest 94/0 ms; pass 800/325/100. |
| Debt before/after | Frontend giữ `59/421/842/541/6`; Python giữ `BLE001=118`, `F401=0`, `F841=0`, `S110=0`, `S608=128`. Không ratchet nào tăng. |
| Backward compatibility | Legacy server fallback, local-only persistence, server idempotency, rowVersion/conflict và workspace isolation đều được giữ qua unit/E2E. |
| Remaining risk | Suite phụ `authenticated-ui-matrix` (không nằm trong 11 gate prompt) phát hiện contrast 3.86:1 ở disabled custom-select tại 320 px. Không sửa vì ngoài cleanup scope; UI-quality bắt buộc vẫn pass. Long Task attribution vẫn `unknown/window`. |

### E2E cuối

| Gate bắt buộc | Kết quả |
|---|---:|
| Auth shell | pass |
| Auth/roles | pass |
| CRUD | pass |
| Multi-assignee | pass |
| Joint venture | pass |
| Bidder goods | pass |
| Low-price conflict | pass |
| Offline/reconnect | pass |
| Package pairwise | pass |
| Full lifecycle | pass; chạy lại sau direct-award completion fix |
| UI quality | pass |

### STOP condition trả lời

1. `trackDeletions()` không còn nuốt read failure; nó record rồi throw `BrowserDBError`.
2. Synced business code không còn implicit legacy persistence; runtime guard và scanner cùng chặn.
3. Còn 0 production legacy opt-in caller; allowlist hiện rỗng. Local-only persistence không được tính là synced legacy opt-in.
4. `#completed` dùng LRU hard cap 750 và clear khi workspace token/epoch đổi.
5. Hai aggregate action giảm capability request từ 2 xuống 1 khi cần discovery, hoặc xuống 0 nếu session bootstrap/refresh đã prime cache.
6. Secure >100 ms long-task không tái hiện ổn định: profile 15+15 dài nhất 84 ms; final 30+30 dài nhất 94 ms. Không tối ưu product code, subscription comparison defer.
7. Đã chạy full Python/JS/critical coverage/lint/debt/security/build/dependency/package/performance và đủ 11 E2E trong bảng.
8. Performance trước: 516/198/121, 509/196/106 và noisy 2350/205/109 ms; final: 466/179/94 ms. Không quy chênh lệch thành code optimization.
9. Debt trước/sau không đổi: frontend `59/421/842/541/6`; Python `118/0/0/0/128` theo thứ tự BLE001/F401/F841/S110/S608.
10. Không còn blocker đã biết trong phạm vi cleanup nếu xét toàn bộ gate bắt buộc đã pass. Remaining risk ngoài scope được ghi ở trên; không tuyên bố “hết lỗi”.
