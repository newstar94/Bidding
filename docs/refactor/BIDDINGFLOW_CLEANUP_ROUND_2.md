# BiddingFlow cleanup round 2

Ngày thực hiện: 2026-08-08  
Nhánh: `main`  
HEAD sau `git fetch origin && git rebase origin/main`: `a1a54bc702856bef95de1299cfc83a09cf75bf27`

Tài liệu này là bằng chứng thực thi cho cleanup vòng 2. Các số liệu “Before” được đo trên HEAD ở trên trước khi sửa; các số “After” chỉ được cập nhật sau khi gate tương ứng đã chạy lại.

## Phase 0 — inventory và baseline

### Before

| Gate | Baseline đo được |
|---|---|
| Python | 615/615 pass; coverage lines 44.86%, branches 34.87% |
| JavaScript | 480/480 pass |
| Critical coverage | pass, 15 modules |
| Frontend debt | `direct_state_writes=85`, `important=422`, `raw_colors=842`, `runtime_styles=541`, `inferred_actions=6` |
| Python debt | `BLE001=147`, `F401=0`, `F841=0`, `S110=14`, `S608=129` |
| Startup performance | fail: cold p95 585/800 ms; warm p95 336/325 ms; longest task 0/100 ms |

`lint:debt` đã đỏ sẵn trên HEAD vì code có 422 `!important` nhưng ratchet còn là 421. Dòng tăng gần nhất nằm ở `views/css/views.css` (`input#edit-pkg-price`). Không nâng ceiling để hợp thức hóa regression này.

### E2E baseline

| Gate | Kết quả trước sửa | Ghi chú |
|---|---:|---|
| Auth shell | pass | shell, profile menu, owner create modal |
| Auth/roles matrix | fail | đăng ký local trả 403 `BOT_CHALLENGE_REQUIRED`; fixture đã cleanup |
| CRUD modules | pass | investor/contractor/expert/plan/package/contract và history |
| Multi-assignee | pass | assignment, document activity, access revocation |
| Joint venture | fail | multi-lot approval hiển thị bidder của lô khác; correctness regression; fixture đã cleanup |
| Bidder goods | pass | 1G1T/1G2T, có/không phân lô |
| Low-price conflict | pass | stale `rowVersion` trả 409 |
| Offline/reconnect | pass | reload/retry/interrupted retry |
| Package pairwise | pass | 15 pairwise cases |
| Full lifecycle | fail | nghiệp vụ chạy tới historical snapshot, nhưng console ghi 405 từ `POST /api/versioning/aggregate`; test coi HTTP fallback signal là lỗi |
| UI quality | pass | 320/375/414/768/1280, focus và network error copy |

### Legacy persistence callers

| Caller/nhóm | Bảng | Synced? | Mutation biết trước? | Phân loại ban đầu |
|---|---|---:|---:|---|
| `BiddingModel.persistData/trackDeletions` | mọi bảng | mixed | không | compatibility core; giữ tạm, chặn caller mới |
| `SyncPullService`, `SyncPushService`, `syncMergeUtils` | changed server tables | yes | server-owned | keep; reconciliation dùng `trackMutation:false` |
| `MutationService.persistAndSync` fallback | caller-supplied | mixed | partial | isolate; explicit `changes` ưu tiên `persistChanges` |
| `BiddingControllerUI` | `kehoach`, `goithau` | yes | biết | migrate |
| `BiddingController` startup | `employees`, `systempackages` | mixed | server snapshot | keep as hydration/local-only; không suy diễn business deletion |
| `AdminUserController` (9 calls) | permission/assignment/employee/package/status | mixed | phần lớn biết | migrate synced mutations; giữ local-only hydration |
| `excelSaveAdapters` (14 calls) | plan/package/investor/contractor/expert/contract/opening | yes | biết từ import | migrate theo change-set |
| `BidEvaluationPanelController` | `goithau` | yes | biết | migrate |
| `BidProcessWorkflow` (7 calls) | package/opening | yes | biết | migrate |
| `bidProcessOpeningData` (8 calls) | contractor | yes | biết | migrate |
| `PackageTimelineView` | package | yes | biết | migrate |

Production call count theo file trước sửa: `excelSaveAdapters=14`, `AdminUserController=9`, `bidProcessOpeningData=8`, `BidProcessWorkflow=7`, `BiddingModel=5`, `BiddingController=2`, `BiddingControllerUI=2`, và 1 caller ở mỗi file `MutationService`, `BidEvaluationPanelController`, `SyncPullService`, `SyncPushService`, `syncMergeUtils`, `PackageTimelineView`. `trackDeletions()` chỉ có một caller production: `BiddingModel.persistData()`.

### Direct state writes

Scanner chính thức báo 85. Danh sách theo file (số match):

| Nhóm | File: count | Phân loại |
|---|---|---|
| Hydration/sync/store | `BiddingController:11`, `syncMergeUtils:5`, `SyncPullService:1`, `SyncPushService:1`, `tableDataUtils:1` | intentional internal; cần allowlist/comment |
| Auth/UI/session | `SystemUserView:5`, `AuthFlowController:5`, `BiddingControllerUI:4`, `AuthSessionController:3`, `GoogleAuthController:2`, `DashboardView:1`, `KeHoachView:1` | chủ yếu UI/session; audit từng write |
| Plan/package business | `KeHoachWorkflow:4`, `BidderGoodsWorkflow:6`, `BidProcessWorkflow:2`, `GoiThauWorkflow:2`, `packageDeleteHelpers:4`, `PackageTimelineView:2`, `DetailedEvaluationSaveWorkflow:1`, `GoiThauTable:1`, `AwardResultApprovalWorkflow:1`, `PackageGoodsWorkflow:1` | migrate khi mutation business |
| Partner/expert/contract | `HopDongWorkflow:6`, `ChuyenGiaWorkflow:2`, `NhaThauWorkflow:1`, `ChuDauTuWorkflow:1`, bốn component tương ứng mỗi file 1 | migrate workflow writes; component selection state có thể giữ |
| Other | `AdminUserController:5`, `WordIntegration:2` | audit theo ownership/persistence |

Không sửa regex scanner. Mục tiêu là giảm business writes, không ép hydration/reducer write qua API giả tạo.

### Prototype/service inventory

- `workspaceBootstrap` cài bridge `auth/admin/main-ui/main-forms/main-sync/integration-bridges` trước khi tạo controller.
- `BiddingController.getWorkflowModuleLoader()` lazy-install workflow modules qua `installPrototypeModules`.
- `ensureWorkflowReady()` kết hợp lazy module requirement và hydration requirement.
- `FeatureServices` hiện cung cấp `plans`, `packages`, `evaluation`, `contracts`, `partners`; UI/shared caller vẫn còn gọi method trực tiếp trên controller.
- `moduleRegistry` có collision guard; `WorkflowModuleLoader` có ready/promise cache. Đây là compatibility infrastructure được giữ trong migration tăng dần, không xóa big-bang.

### Python exception debt inventory

`BLE001=147` theo file:

```text
api/org_routes 5; app 13; auth/admin_user_routes 3; auth/auth_helper 2;
auth/auth_routes 15; auth/auth_service 1; auth/email_delivery_service 2;
auth/google_auth_routes 2; auth/otp_routes 5; db/db_helper 1;
documents/custom_exporter 6; document_worker 2; document_worker_entry 2;
docx_bid_context_service 1; docx_formula_service 2; package_document_routes 8;
routes_docx 9; routes_excel 8; lifecycle 3; lot_lifecycle_routes 3;
notifications/routes 3; observability/metrics 2; partners/address_parser 1;
partners/address_routes 3; partners/partner_lookup_service 4;
shared/access_policy 1; shared/audit_monitor 2; shared/logging_utils 4;
shared/text_utils 2; sync/mapper 2; sync/pagination 1;
sync/payload_validation 1; sync/read_service 2; sync/service 6;
sync/version_api 1; sync/websocket 11; scripts/backup 7;
scripts/run_document_worker 1.
```

`S110=14`: `app:3`, `db_helper:1`, `package_document_routes:2`, `observability/metrics:1`, `partner_lookup_service:1`, `logging_utils:4`, `sync/websocket:1`, `scripts/backup:1`.

### S608 classification baseline

Ruff báo 129 vị trí trong 36 file. Audit ban đầu cho thấy bốn dạng trong prompt đều tồn tại:

- A — value interpolation nguy hiểm: chưa được giả định; từng vị trí phải chứng minh nguồn value trước khi đổi/suppress.
- B — dynamic identifier: tập trung ở `shared/access_policy` (20), `sync/dashboard_summary` (16), `sync/ownership` (9), `api/org_routes` (7), `sync/mapper` (6), `sync/read_service` (6), `sync/pagination` (5), `sync/record_writer` (5), `sync/bidder_goods` (5). Nhiều identifier đến từ schema/registry nhưng chưa có suppression có lý do.
- C — placeholder list theo count: xuất hiện ở access policy, assignment/bidder goods, record validation/writer, fixtures và tests.
- D — static schema/migration metadata: `db/postgres_schema`, `db/db_utils`, `setup_local_postgres` và một phần fixture/test.

Các suppression S608 đã có từ trước chủ yếu ghi rõ “placeholders only” hoặc “fixed/validated identifiers”. Không thêm suppression hàng loạt; mọi ceiling chỉ hạ sau audit thật.

### CSS debt ở touched path dự kiến

- `views/css/views.css`: có `!important` mới ở `input#edit-pkg-price`; selector đã đủ cụ thể để thử bỏ mà không thay layout.
- Các path correctness/storage hiện tại là JavaScript thuần; không dự kiến thêm raw color/runtime style.
- Mọi CSS thay đổi sẽ được xác nhận lại ở 320/375/414/768/1280 bằng UI quality gate.

### Finding và root cause trước sửa

1. `BiddingModel.loadStorageKeys()` gộp read error với empty result, ghi `state=[]`, đánh dấu key đã load và có thể tự ghi `[]` trở lại IndexedDB. Root cause: hydration chỉ có boolean “loaded”, không có trạng thái failed/recoverable theo table.
2. Legacy persistence vẫn suy diễn changed/deleted row bằng full-table read và `JSON.stringify`. Root cause: compatibility API vẫn là fallback mặc định của nhiều import/workflow caller dù mutation đã biết trước.
3. Joint-venture multi-lot approval không scope bidder rows theo lot. Root cause cần characterization test trước khi sửa.
4. Aggregate version client dùng HTTP 405 như capability signal; fallback hoạt động nhưng tạo error response mà lifecycle gate coi là runtime failure. Root cause: thiếu capability/version contract rõ ràng trước request.
5. Debt gate CSS đỏ trên clean `main`. Root cause: commit mới thêm một `!important` nhưng ratchet không tăng (đúng nguyên tắc); code phải giảm về ceiling.

### Files changed

- `docs/refactor/BIDDINGFLOW_CLEANUP_ROUND_2.md` (Phase 0 only).

### Why this approach

Baseline được đo sau rebase, inventory tách business mutation khỏi hydration/server projection, và failure E2E được ghi trước khi sửa để tránh nhận công cho regression có sẵn.

### Tests

Các lệnh baseline: `npm test`, `npm run lint:python`, `npm run lint:debt`, `npm run test:performance` và toàn bộ E2E trong bảng trên.

### Performance

Cold pass; warm vượt budget 11 ms. Final comparison phải chạy trong điều kiện tương đương và không được nới `STARTUP_WARM_P95_MS`.

### Debt before/after

Before đã ghi ở bảng đầu; After chưa có ở Phase 0.

### Backward compatibility

Chưa thay runtime behavior trong Phase 0.

### Remaining risk

Ba baseline gate đang đỏ độc lập: auth/roles local challenge, JV lot scoping, aggregate fallback 405; performance warm và CSS debt cũng đỏ. Tất cả phải được phân biệt với regression do cleanup.

## Phase 1 — IndexedDB fail-safe và mutation correctness

| Mục | Kết quả |
|---|---|
| Before | `loadStorageKeys()` coi exception đọc IndexedDB như table rỗng, có thể thay memory bằng `[]` và mở đường cho write/sync nguy hiểm. |
| Finding | Read failure và successful empty read là hai trạng thái khác nhau. Cold start còn cần chặn mutation cho từng table failed; workspace đang có memory/outbox phải giữ nguyên dữ liệu đó. |
| Root cause | Hydration trước đây chỉ có loaded/not-loaded; không có trạng thái `ready/failed`, error code, retry/recovery và write guard theo table. |
| Files changed | `frontend/app/BiddingModel.js`, `frontend/app/WorkspaceDataStore.js`, `frontend/app/workspaceBootstrap.js`, `frontend/app/syncStatus.js`, `frontend/app/SyncCoordinator.js`, `frontend/app/startupReconciliation.js`, `frontend/shared/releaseDiagnostics.js`, `tests/js/bidding_model_storage_hydration.test.mjs`, `tests/js/sync_status.test.mjs`. |
| Why this approach | Mở rộng boundary hiện có thay vì tạo error subsystem mới: giữ memory/outbox, công bố hydration status có mã `BrowserDBError`, chặn write chỉ trên table lỗi, cho phép retry hoặc authoritative server recovery. Diagnostic chỉ dùng label bounded. |
| Tests | Empty store; request/permission/corruption error; một table lỗi không chặn table khác; retry thành công; không enqueue deletion; không write `[]`; offline + read failure; pending outbox qua reload; transaction dừng trước mutation. |
| Performance | Không thêm full-table read/write. Failure path chỉ cập nhật map trạng thái và một diagnostic bounded. |
| Debt before/after | Không tăng scanner; state write mới nằm trong hydration/store boundary có chủ đích. |
| Backward compatibility | Successful read vẫn hydrate như cũ. Server pull authoritative có thể đánh dấu table recovered. Existing outbox envelope không đổi schema. |
| Remaining risk | Trình duyệt bị hỏng IndexedDB vật lý vẫn cần người dùng reload/recover hoặc server pull; hệ thống nay fail-safe nhưng không tự sửa corruption. |

## Phase 2 — explicit persistence, state boundary và feature services

| Mục | Kết quả |
|---|---|
| Before | Business hot paths còn dùng `persistData()` → full-table `trackDeletions()`/`JSON.stringify`; `direct_state_writes=85`; UI/shared caller biết tên prototype workflow trực tiếp. |
| Finding | Mutation ở plan/package/evaluation/contract/admin/import/opening đã biết trước upsert/deletion nhưng vẫn trả chi phí và semantics cho compatibility diff. Một số deletion sau migrate chỉ truyền ID sau khi projection đã xóa record, làm mất `rowVersion`. |
| Root cause | `persistAndSync()` từng ưu tiên compatibility fallback khi caller không đưa change-set; feature workflow tự sửa array; `markDeleted(id)` chỉ có thể khôi phục version nếu record còn trong state. |
| Files changed | `frontend/shared/MutationService.js`, `frontend/app/BiddingModel.js`, `frontend/admin/AdminUserController.js`, `frontend/app/BiddingControllerUI.js`, `frontend/app/BiddingControllerForms.js`, `frontend/documents/excelSaveAdapters.js`, các workflow trong `frontend/plans`, `frontend/packages`, `frontend/contracts`, `frontend/partners`, `frontend/experts`; `scripts/check_frontend_debt.py`; `tests/js/mutation_service_staging.test.mjs`, `tests/js/version_delete_scope.test.mjs` và các regression test workflow liên quan. |
| Why this approach | Dùng explicit `{upserts,deletions}` qua `persistChanges()`; `replaceTableState()`/`replaceTableProjection()` chỉ là reducer boundary và không tự suy diễn mutation. Deletion luôn stage full removed record để giữ expected version. Feature caller gọi `plans/packages/evaluation/contracts/partners`; prototype loader vẫn là compatibility bridge. |
| Tests | Regression đỏ→xanh chứng minh xóa hợp đồng sau khi bỏ local projection vẫn gửi `expectedVersion=12`; CRUD E2E xác nhận xóa contract/plan/expert/contractor/investor trên PostgreSQL; unit tests xác nhận explicit path không gọi full-table fallback. |
| Performance | Benchmark explicit persistence so với legacy full diff: median nhanh hơn khoảng 622× ở 1k records và 5.894× ở 10k records. |
| Debt before/after | `direct_state_writes: 85 → 59`; feature-service call sites hiện có 37 lời gọi qua service; module graph 256 modules, 0 static cycle. |
| Backward compatibility | `persistData/trackDeletions/markTableDirty` chưa bị xóa. Server pull/push/hydration tiếp tục gọi `persistData(...,{trackMutation:false})`; local-only `employees/systempackages` và compatibility fallback được giữ. Guard cấm business code mới thêm `persistData("synced_table")`. |
| Remaining risk | Compatibility API còn tồn tại nên cần tiếp tục ratchet caller. `MutationService.persistAndSync()` vẫn có fallback cho caller chưa migrate; chỉ được bỏ khi inventory về 0 cho synced business tables. |

### Legacy persistence sau cleanup

Đã loại khỏi business hot path:

- plan/package create-update-delete và version workflows;
- evaluation, opening, bidder goods, package goods, timeline và award result;
- contract, contractor, investor, expert;
- Excel import/save adapters;
- synced admin assignment/permission mutations có change-set xác định.

Được giữ có chủ đích:

- `BiddingModel.persistData()`, `trackDeletions()` và `markTableDirty()` làm compatibility core;
- `SyncPullService`, `SyncPushService`, `syncMergeUtils` cho server-owned projection với `trackMutation:false`;
- startup/local-only `employees`, `systempackages`;
- `permissionmatrix` hydration không track mutation;
- fallback trong `MutationService` cho caller compatibility chưa có explicit change-set.

Final production search còn 13 call sites `persistData(` ngoài declaration: 3 hydration/admin-local, 2 startup-local, 3 sync reconciliation, 4 internal compatibility helpers và 1 fallback. Không còn caller business workflow đã migrate dùng full-table diff.

## Phase 3 — Python, SQL và CSS debt

| Mục | Kết quả |
|---|---|
| Before | `BLE001=147`, `S110=14`, `S608=129`, `F401=0`, `F841=0`; frontend `important=422` trong code dù ceiling là 421. |
| Finding | Nhiều broad exception là boundary hợp lệ, nhưng nhóm parsing/logging/database cụ thể có thể narrow. Silent `pass` che observability. S608 chủ yếu là identifier/schema/placeholder-count, không phải request-value interpolation. |
| Root cause | Error handling lịch sử dùng catch-all để cô lập request/worker; scanner chưa buộc phân loại từng boundary. Một CSS rule mới dùng `!important` dù specificity đã đủ. |
| Files changed | Các module Python trong `backend/auth`, `backend/db`, `backend/documents`, `backend/observability`, `backend/partners`, `backend/shared`, `backend/sync`; `scripts/backup.py`, `scripts/setup_local_postgres.py`, `scripts/check_python_quality.py`; `views/css/views.css`; tests quality/safety tương ứng. |
| Why this approach | Narrow exception khi biết loại; giữ broad chỉ ở isolation boundary và log context. Thay silent pass bằng debug/metric hoặc explicit ignore. Không mass `noqa`. `setup_local_postgres.py` dùng psql variable binding cho database name. Chỉ bỏ đúng một `!important` ở touched selector. |
| Tests | Python quality scanner, setup PostgreSQL safety regression, full pytest, UI quality responsive matrix. Dependency audits: npm audit 0 vulnerability; `pip-audit` không tìm thấy vulnerability đã biết. |
| Performance | Không thay query shape của hot path. Exception/metric changes chỉ chạy trên error boundary. |
| Debt before/after | Python: `BLE001 147→118`, `S110 14→0`, `S608 129→128`, `F401/F841=0`. Frontend: `important 422→421`, `raw_colors 842→842`, `runtime_styles 541→541`. |
| Backward compatibility | Retained broad exceptions ở top-level request, telemetry, cleanup/finalizer và external parser boundary để không phá isolation. CSS visual behavior không đổi qua 5 viewport. |
| Remaining risk | 118 BLE001 retained cần giảm dần khi có typed exception contract. 128 S608 cần duy trì audit khi query mới xuất hiện; scanner count không đồng nghĩa 128 injection. CSS debt còn lớn nhưng không phù hợp mass replace. |

### S608 audit cuối

- A — user/request value interpolation: không phát hiện vị trí production nào ghép trực tiếp value không tin cậy vào SQL trong tập audit; database name ở local setup đã chuyển sang psql variable binding.
- B — dynamic identifier: table/column đến từ registry/schema constant hoặc allowlist ở access policy, sync mapper/read/write/pagination.
- C — placeholder list: chuỗi placeholder sinh chỉ từ số phần tử, value vẫn truyền parameter riêng.
- D — static schema metadata: migration, index/constraint và introspection SQL cố định.

Ceiling chỉ giảm 1 nhờ thay đổi thật; không thêm suppress hàng loạt.

## Phase 4 — versioning compatibility, critical coverage và observability

| Mục | Kết quả |
|---|---|
| Before | Aggregate endpoint fallback dựa vào POST 404/405/501; backend cũ gây một HTTP error trước khi fallback. Coverage thiếu tenant×version×children, offline reload rejection và multi-user field conflict. Diagnostics chưa bao phủ đủ IndexedDB/worker/WebSocket/outbox/version fallback. |
| Finding | 404 resource-not-found không phải capability signal đáng tin; frontend/backend có thể lệch version khi rollout. Pending-count callback còn có thể ghi đè `transportError` thành `localPending`. JV bidder scope theo package thay vì lot. Auth E2E dùng local Turnstile policy không có test credential. |
| Root cause | Không có explicit deployment capability; sync status update thiếu phase priority; rare-case tests chưa kết hợp các trục. E2E fixture chưa dùng Cloudflare always-pass test key/token theo local-only contract. |
| Files changed | `backend/runtime_capabilities.py`, `backend/app.py`, `backend/auth/auth_routes.py`, `backend/observability/metrics.py`; `frontend/shared/AggregateVersionClient.js`, `frontend/shared/releaseDiagnostics.js`, sync/WebSocket/Excel/IndexedDB modules; E2E scripts auth/JV/offline/low-price; aggregate/version/sync/lot tests Python và JavaScript. |
| Why this approach | Client preflight `POST /api/auth/check-session`; chỉ fallback trước aggregate POST nếu thiếu `aggregate-version-v1`. Backend capable trả 404/405 thì lỗi được giữ, không nuốt. Diagnostics gửi bounded event names/buckets, không ID/payload nhạy cảm. |
| Tests | Tenant A/B isolation; concurrent expected rowVersion/idempotency/409; aggregate child clone/remap và historical frozen; offline outbox qua reload; reconnect conflict/validation rejection; hai browser cùng row khác field, một offline/một online; evaluation compatibility; lifecycle cold-browser/server pagination; JV lot scope. |
| Performance | Capability check dùng session bootstrap đã cần cho auth; không thêm aggregate fallback POST trên capable backend. Polling duration chỉ bucket hóa khi fallback xảy ra. |
| Debt before/after | JS tests tăng `480→497`; Python tests tăng `615→630`. Module graph vẫn 0 cycle. |
| Backward compatibility | Hướng B được chọn: frontend mới vẫn hỗ trợ backend cũ thiếu capability. Fallback có diagnostic. Deprecation chỉ khi telemetry qua ít nhất một rollout window không còn event fallback và minimum backend contract đã được enforce. |
| Remaining risk | Mixed-version deployment vẫn cần theo dõi fallback rate. Capability preflight phụ thuộc check-session response không bị proxy cache sai. Diagnostics là best-effort và không thay monitoring backend chuyên dụng. |

### Observability được bổ sung

- sync conflict count và aggregate 409;
- offline queued mutation, outbox retry/failure;
- IndexedDB read failure theo bounded error code;
- Excel worker failure/fallback;
- WebSocket reconnect và polling fallback duration bucket;
- legacy aggregate-version fallback usage;
- HTTP request-log sink failure metric.

Không log full package/contractor/document payload và không dùng record ID làm metric label.

## Phase 5 — final validation, E2E và performance

| Mục | Kết quả |
|---|---|
| Before | Baseline có auth challenge, JV cross-lot, lifecycle aggregate 405, CSS gate và warm performance đỏ. |
| Finding | Trong final CRUD phát hiện deletion mutation mất expected version sau khi local projection đã xóa record. Trong JV harness phát hiện race: scope panel/ranking update qua synchronous rerender + `requestAnimationFrame`, nhưng script submit trước readiness boundary. |
| Root cause | Deletion caller truyền ID thay vì full removed record. JV helper chống duplicate ID đã bỏ condition wait; ranking/conclusion controller còn batch qua animation frame. |
| Files changed | Deletion workflows plan/contract/partner/expert; `tests/js/version_delete_scope.test.mjs`; `scripts/verify_joint_venture_e2e.mjs`; tài liệu này. |
| Why this approach | TDD cho deletion: test đỏ xác nhận thiếu `expectedVersion`, rồi sửa caller tối thiểu. JV harness chờ active panel/store và hai animation frames, kiểm tra conclusion/low-price/button handler; không sleep, không tăng timeout. |
| Tests | `npm run check` pass: Python 630/630, JS 497/497, critical coverage, scanners, secure build, Trusted Types, vendor/FK/package/SBOM. Tất cả E2E bắt buộc pass; chi tiết bên dưới. |
| Performance | Explicit persistence benchmark pass. Clean fresh-source run pass: cold 603/800 ms, warm 254/325 ms, longest task 0/100 ms. Các lần đo stale/noisy sau đó được giữ ở mục Performance evidence; không nới budget. |
| Debt before/after | Final ratchet: frontend `59/421/842/541/6`; Python `118/0/0/0/128`. |
| Backward compatibility | Không thêm feature, không đổi API business hiện hữu; capability fallback và prototype/persistence bridges được giữ có tiêu chí bỏ rõ ràng. |
| Remaining risk | Production cần theo dõi IndexedDB recovery, fallback rate, conflict/retry metrics và startup long-task trên bundle secure ở máy chậm. Không tuyên bố hết lỗi chỉ vì gate xanh. |

### E2E cuối

| Gate | Kết quả cuối | Evidence chính |
|---|---:|---|
| Auth shell | pass | loader/profile/menu/owner modal |
| Auth/roles | pass | 14 chặng: RBAC, workspace, CSRF, XSS, revocation, reset/consent |
| CRUD | pass | 17 chặng; contract và toàn bộ versioned entity delete; PostgreSQL clean |
| Multi-assignee | pass | assignment/activity/access/organization removal |
| JV | pass | low price, Word/Excel, contract, multi-lot, 1G2T; no cross-lot bidder |
| Bidder goods | pass | 1G1T/1G2T, lot/no-lot, import, DB và second browser |
| Low-price conflict | pass | 409, offline-online conflict, reconnect validation rejection |
| Offline/reconnect | pass | pending outbox sống qua reload và commit sau reconnect |
| Package pairwise | pass | 15 cases |
| Full lifecycle | pass | 1G1T, 1G2T, lot, nhiều đợt, hủy/đấu lại, contract, COW/frozen history |
| UI quality | pass | 320/375/414/768/1280, no horizontal overflow, keyboard/focus/validation |

### Performance evidence

- Baseline source server: cold p95 585/800 ms, warm p95 336/325 ms, longest task 0/100 ms — fail warm.
- Explicit mutation median so với legacy full diff: khoảng 622× nhanh hơn ở 1k và 5.894× ở 10k.
- Clean fresh-source final: cold p95 603/800 ms, warm p95 254/325 ms, longest task 0/100 ms — pass. Baseline-SHA differential trên cùng protocol là 513/254 ms.
- Final validation phải phân biệt process cổng 8000 stale từ 2026-08-07 với fresh isolated process. Stale process cho 766/386/0 và không được dùng làm kết luận code.
- Secure production bundle trên fresh process cho p95 tốt (516/198 và 509/196 ms), nhưng max long task dao động 121 và 106 ms. Đây là risk theo dõi, không nới gate.
- Các source rerun khi host đang tải cho 703/327/0 rồi 811/416/0; một production rerun có cold p95 outlier 2.350 ms nhưng warm 205 ms, không runtime failure. Độ dao động ngược chiều này cùng CPU nền 17–21% chứng minh host contention. Tất cả failure được ghi nhận thay vì chọn lọc bỏ đi.
- Sau clean pass không có thay đổi startup path: chỉ correction payload deletion ở workflow đã lazy-load và readiness logic trong E2E harness. `npm run check` sau các correction vẫn pass.

## Definition of Done

- [x] IndexedDB read failure khác empty store; không stage deletion/write `[]`; outbox được giữ.
- [x] Synced business hot paths dùng explicit mutations; compatibility caller được inventory/guard.
- [x] Direct business writes giảm thực chất, scanner không nới.
- [x] FeatureServices usage tăng; lazy compatibility bridge giữ hoạt động; 0 static cycle.
- [x] Python/CSS debt giảm hoặc giữ nguyên; không mass suppress/replace.
- [x] Rare-case critical coverage đã bổ sung.
- [x] Aggregate capability/fallback contract và deprecation criteria đã ghi.
- [x] Security, dependency, package và toàn bộ E2E gate pass.
- [x] Startup performance fresh final pass với budget nguyên trạng; noisy secure-bundle long-task được giữ là risk production.

## Trả lời 10 câu hỏi kết thúc

1. **Legacy path đã loại bỏ:** full-table `persistData()/trackDeletions()` khỏi mọi synced business hot path được liệt kê ở Phase 2; UI/shared caller rõ domain chuyển qua FeatureServices; aggregate capable backend không còn bị probe bằng POST lỗi.
2. **Legacy path còn giữ:** persistence compatibility core, sync/hydration `trackMutation:false`, local-only startup tables, prototype lazy bridge và aggregate fallback cho mixed-version deployment. Chúng còn caller hợp lệ và có tiêu chí deprecate, nên chưa xóa big-bang.
3. **Direct state writes:** `85 → 59`.
4. **Python debt:** `BLE001 147→118`, `S110 14→0`, `S608 129→128`, `F401=0`, `F841=0`; S608 đã phân loại, không mass `noqa`.
5. **CSS debt:** `!important 422→421`; raw colors giữ 842; runtime styles giữ 541; cả ba không tăng và responsive gate pass.
6. **Bug mới phát hiện:** IndexedDB empty/error conflation; JV bidder cross-lot; sync phase bị pending-count ghi đè; local Turnstile fixture lệch policy; aggregate 405 capability probe; versioned deletion mất `expectedVersion`; JV E2E readiness/ranking-frame race.
7. **Test/E2E đã chạy:** full Python/JS/critical coverage; quality/security/build/package/dependency; 11 E2E gate trong bảng cuối; performance/explicit persistence benchmark.
8. **Performance trước/sau:** baseline 585/336/0 (warm fail); clean fresh final 603/254/0 (pass); explicit persistence cải thiện 622×/5.894×. Production secure bundle đạt 509/196 nhưng có isolated long-task outlier 106–121 ms cần theo dõi.
9. **Production risk:** IndexedDB corruption recovery UX, mixed-version fallback rate, sync conflict/outbox retry, WS polling duration, Excel worker fallback, request-log sink failure và secure-bundle long tasks trên thiết bị chậm.
10. **Đủ ổn để chuyển backlog feature mới chưa:** có, nền tảng đã đạt các gate correctness, persistence, state, architecture, security, E2E và clean startup performance để chuyển sang backlog tính năng. Vẫn phải rollout có theo dõi các risk ở câu 9; kết luận này không đồng nghĩa hệ thống hết lỗi.
