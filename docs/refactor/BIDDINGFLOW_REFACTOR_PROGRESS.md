# BiddingFlow refactor progress

Ngày bắt đầu đối chiếu: 2026-08-08  
Nguồn yêu cầu:

- `docs/01_BAO_CAO_RA_SOAT_CAI_THIEN_BIDDINGFLOW_2026-08-08.md`
- `docs/02_PROMPT_CODEX_SUA_LOI_REFACTOR_TOI_UU_BIDDINGFLOW_2026-08-08.md`

Phạm vi chỉ gồm sửa lỗi, refactor, giảm nợ kỹ thuật, tối ưu hiệu năng và UX nền tảng. Không triển khai feature sản phẩm mới.

## Baseline

### Quality/security/package gates

Lệnh: `npm run check`

Kết quả cuối ngày 2026-08-08: đạt.

- Python tests: 615/615 đạt; combined line/branch coverage 45%, ngưỡng repository 28%.
- Critical coverage ratchet: đạt cho 15 module sync/WebSocket/delta/document/versioning/conflict trọng yếu.
- JavaScript tests: 475/475 đạt.
- Trusted Types/CSP-related lint: đạt.
- Vendor/SheetJS/archive security audit: đạt.
- Secure Vite build: đạt, 46 bundle đã được kiểm tra.
- Foreign-key audit: 104 khóa ngoại, không thiếu index.
- Production package smoke check: đạt, 383 runtime files.
- SBOM: đã sinh thành công.

Debt baseline:

| Nhóm | Baseline |
|---|---:|
| `direct_state_writes` | 91 |
| `important` | 421 |
| `inferred_actions` | 6 |
| `raw_colors` | 842 |
| `runtime_styles` | 545 |
| Python `BLE001` | 151 |
| Python `F401` | 60 |
| Python `F841` | 13 |
| Python `S110` | 16 |
| Python `S608` | 129 |

### Startup performance

Lệnh: `npm run test:performance`

Kết quả: đạt.

| Chỉ số | Kết quả cuối | Giới hạn |
|---|---:|---:|
| Cold median | 320 ms | — |
| Cold p95 | 365 ms | 800 ms |
| Warm median | 118 ms | — |
| Warm p95 | 130 ms | 325 ms |
| Longest task | 71 ms | 100 ms |

Artifact: `data/logs/startup-performance.json`.

### E2E verification

| Gate | Trạng thái | Ghi chú |
|---|---|---|
| Auth shell | Đạt | Loader, profile menu và modal owner hoạt động. |
| Auth/roles matrix | Đạt | Chạy trong server E2E riêng, không thay đổi cấu hình Turnstile production. |
| CRUD/multi-assignee/JV/low-price/offline/pairwise | Đạt | Domain matrix chạy cô lập trên PostgreSQL. |
| Full lifecycle | Đạt | Gồm 1G1T, 1G2T, phân lô nhiều đợt, hủy/đấu lại, hợp đồng và version copy-on-write. |
| Bidder goods | Đạt | 1G1T/1G2T, có/không phân lô, reload, PostgreSQL và browser context thứ hai. |
| UI quality | Đạt | 320/375/414/768/1280 px, không horizontal overflow, keyboard/validation/accessibility shell đạt. |

## Dependency map tối thiểu

### Persistence và sync

```text
BiddingController / feature workflows
  -> MutationService.persistAndSync
  -> BiddingModel.commitLocalMutation / persistData
  -> WorkspaceMutationOutbox
  -> WorkspaceMutationOutboxStore
  -> BrowserDB
  -> BiddingControllerSync.autoSync
  -> apiClient -> backend/sync/service.py
```

- `BrowserDB.js`: adapter IndexedDB; không sở hữu business policy.
- `WorkspaceMutationOutbox.js`: mutation generation, acknowledgement/rejection và local deletion projection.
- `WorkspaceMutationOutboxStore.js`: envelope/revision, ghi local storage + IndexedDB theo thứ tự.
- `WorkspaceDataStore.js`: transaction/state notification, hiện gọi `MutationService.persistAndSync`.
- `BiddingControllerSync.js`: facade tương thích; push/pull/delta/conflict/WebSocket/UI refresh đã được chuyển sang các service chuyên trách ở Phase B5.
- `backend/sync/service.py`: orchestration sync phía server, dùng validator/writer/repository/deletion/audit/notification.

### Evaluation

```text
package method/metadata
  -> evaluationMethodRules + technicalEvaluationMethod
  -> DetailedEvaluationWorkflow / DetailedEvaluationSaveWorkflow
  -> bidEvaluationActions / BiddingCalculations / table presentation
  -> MutationService + sync
  -> backend/sync/bid_evaluation_rules.py
```

### Version snapshots

```text
planAggregateSnapshot
  -> packageAggregateSnapshot
  -> lots/goods/openings/JV/evaluation/assignments/timeline child records
```

Official plan/package version creation nay đi qua backend transaction. Client snapshot chỉ còn là compatibility fallback cho server legacy không có endpoint; cold-cache correctness không còn phụ thuộc browser hydrate.

## Phase A — Correctness

### A1. IndexedDB durability semantics — hoàn thành

Vấn đề xác nhận:

- `set`, `putRecord`, `deleteRecord` resolve tại `request.onsuccess`.
- `putTableData`, `putRecords`, `deleteRecords` thiếu `transaction.onabort`.
- chỉ `applySyncChanges` đã có đủ complete/error/abort semantics.

Thay đổi:

- Tạo một transaction settlement boundary dùng chung trong `frontend/app/BrowserDB.js`.
- Mọi write API chỉ resolve tại `transaction.oncomplete`.
- `transaction.onerror` và `transaction.onabort` đều reject bằng `BrowserDBError` ổn định.
- `AbortError` được chuẩn hóa thành `TRANSACTION_ABORTED`.
- Có settlement guard để request error và transaction error/abort không double-settle.
- `putTableData` xử lý lỗi của `getAllKeys` thay vì có thể treo.

Regression tests: `tests/js/browser_db_errors.test.mjs`.

- request success + transaction abort: đủ 7 write API;
- pending cho tới transaction complete: đủ 7 write API;
- transaction error: đủ 7 write API;
- quota/request error;
- outbox write ordering chờ commit thực.

Lệnh nhanh: `node --test tests/js/browser_db_errors.test.mjs`  
Kết quả: 28/28 đạt.

Migration/backward compatibility:

- Không đổi IndexedDB schema/version/store.
- Không đổi payload hoặc public method signatures.
- Caller có semantics mạnh hơn: `await` nay đồng nghĩa transaction đã commit.

Xác minh cuối: full unit/integration/E2E đạt; abort/error semantics vẫn được giữ bằng regression test riêng cho mọi write API.

### A2. WorkspaceDataStore/outbox/offline state machine — hoàn thành

Nguyên nhân xác nhận:

- `WorkspaceDataStore.transaction()` rollback toàn bảng cho mọi `ok: false`, kể cả 409, 503 và lỗi transport.
- `BiddingModel.persistData()` log rồi nuốt lỗi IndexedDB, khiến caller có thể báo `committed` dù local persistence thất bại.
- rollback state/IndexedDB không có cơ chế đưa outbox về đúng trạng thái trước transaction.

Thay đổi:

- Chuẩn hóa outcome thành `committed`, `offlineQueued`, `validationRejected`, `conflict`, `persistenceFailed`, `transportFailed`.
- Offline/503/transport/conflict giữ state, IndexedDB và outbox; validation/persistence failure rollback.
- `MutationService.persistAndSync()` cô lập transport exception khỏi local persistence exception.
- `persistData(..., { throwOnError: true })` được dùng tại persistence boundary để lỗi IndexedDB truyền đến transaction; caller legacy không đổi behavior mặc định.
- Bổ sung checkpoint/restore ngay trong `WorkspaceMutationOutbox`; rollback khôi phục chính xác queue/deletions trước transaction, không xóa mutation cũ.
- Bidder-goods draft coi `transportFailed` là đã lưu cục bộ và đang chờ sync.

Regression/integration tests: `tests/js/workspace_data_store.test.mjs`.

- 400 validation: rollback state + IndexedDB + exact outbox checkpoint;
- 409 conflict: giữ local state/outbox, không overwrite im lặng;
- offline, 503 và transport exception: giữ local state/outbox;
- lỗi IndexedDB thật qua `BiddingModel`: trả `persistenceFailed`;
- reload sau checkpoint restore: pending mutation cũ còn nguyên, mutation bị reject không quay lại;
- retry cùng mutation id không áp dụng mutation lần hai.

Lệnh: `node --test tests/js/workspace_data_store.test.mjs tests/js/browser_db_errors.test.mjs tests/js/bidder_goods.test.mjs tests/js/sync_conflict_recovery.test.mjs`  
Kết quả: 81/81 đạt; riêng state-machine suite 10/10 đạt sau khi thêm reload test.

Migration/backward compatibility:

- Không đổi schema IndexedDB hay payload sync.
- Checkpoint dùng envelope/outbox hiện có và hydrate tương thích queue cũ.
- `throwOnError` là opt-in tại orchestration boundary để không làm gãy caller legacy đang fire-and-forget.

Rủi ro còn lại:

- Full-table transaction vẫn được giữ cho legacy callers; hot paths đã chuyển sang patch-based ở Phase B.
- Offline/reconnect E2E cuối đã đạt, gồm reload với pending outbox.

### A3. Canonical evaluation domain — hoàn thành

Nguyên nhân xác nhận:

- Frontend summary rule chỉ nhận `Kết hợp giữa kỹ thuật và giá`, trong khi detailed evaluation có alias riêng cho `Kết hợp kỹ thuật và giá`.
- Ranking vẫn so sánh trực tiếp label tiếng Việt.
- Backend `requires_technical_score()` và validation trọng số chỉ nhận đúng một label.

Thay đổi:

- Bổ sung canonical codes: `LOWEST_PRICE`, `EVALUATED_PRICE`, `FIXED_PRICE`, `COMBINED_TECHNICAL_PRICE`, `TECHNICAL_BASED`.
- `evaluationMethodRules.js` là authority frontend cho normalize, label mapping, combined/score semantics và display.
- `technicalEvaluationMethod.js`, ranking, package form, evaluation panels và package summaries dùng canonical helper thay vì so sánh label.
- Backend `bid_evaluation_rules.py` normalize cùng codes/aliases; payload validation và legacy snapshot query chấp nhận code cùng hai combined labels.
- Migration v9 không xóa nhầm trọng số của alias/code combined.

Backward compatibility: UI tiếp tục ghi label hiện hữu; business logic chấp nhận cả canonical code và legacy labels. Không rewrite dữ liệu lịch sử.

### A4. One technical score parser — hoàn thành

- Xóa parser trùng trong `technicalEvaluationMethod.js`; frontend editor/import/ranking cùng dùng parser strict từ `evaluationMethodRules.js`.
- Parser chỉ nhận string/number decimal không âm hữu hạn, hỗ trợ dấu phẩy; reject boolean, object/array, exponent, hex, text và `Đạt/Không đạt`.
- Backend giữ implementation Decimal tương đương và historical pass/fail compatibility tách tại `is_inherited_legacy_technical_result()`.
- Fixture parity chung: `tests/fixtures/evaluation_domain_cases.json`.

Tests:

- Full JavaScript suite: 436/436 đạt.
- Evaluation JS targeted: 25/25 đạt.
- Backend evaluation targeted: 15/15 đạt.
- ESLint các file Phase A đã chạm: đạt.
- Python quality gate: đạt, không tăng baseline.

### A5. Authoritative evaluation metadata codec — hoàn thành

- Frontend codec có `parseStrict`, `parseForDisplay`, `serialize`, `migrate` (cùng các export tên đầy đủ); backend có semantics tương ứng.
- Missing/version-0 metadata migrate idempotent sang schema 1; unknown schema, array, malformed JSON và payload >64 KiB fail closed.
- `parseForDisplay` trả `{ metadata, error, canPersist, raw }`; fallback hiển thị không được coi là persistable.
- Evaluation, detailed evaluation, award, cancellation, qualified approval, financial opening và lot-scope save paths đều dùng strict codec/serializer.
- Read-only panels/selectors dùng display codec; package snapshot authority dùng strict codec.
- Không còn direct `JSON.parse(danhGiaHsdtMetadata)` hoặc `danhGiaHsdtMetadata = JSON.stringify(...)` trong frontend.

Tests:

- Codec frontend: 5/5 đạt, gồm regression chứng minh malformed metadata không bị lưu đè thành `{}`.
- Codec/backend sync targeted: 13 đạt, 2 environment-dependent tests skip.
- Metadata-related JS regression: 39/39 đạt.

Migration: không rewrite hàng loạt; metadata legacy được nâng schema khi đi qua save path hợp lệ. Migration giữ nguyên nested 1G2T/criteria/result blocks.

### A6. Mojibake guard — hoàn thành

- Sửa các thông báo lỗi/UX mojibake trong sync, package preparation, contractor-risk, AI tool validation và test fixtures.
- Loại embedded BOM giữa file khỏi các module frontend; UTF-8 BOM hợp lệ ở byte đầu file vẫn được chấp nhận.
- Thêm `scripts/check_mojibake.py`, scan source UTF-8 và exclude `dist`, `vendor`, `generated`, binary/non-text, cache và artifacts.
- Scanner dùng signature double-decoding cụ thể để không false-positive từ tiếng Việt hợp lệ như `MÃ XÁC THỰC`.
- Thêm `npm run lint:encoding` vào `check:quality`, do đó CI `npm run check` tự động enforce.

Tests/gates:

- Mojibake guard unit: 2/2 đạt.
- Repository encoding scan: đạt.
- Backend AI/contractor-risk regression: 28/28 đạt.
- JS fixtures/sync/version regression: 71/71 đạt.

## Phase B — Architecture

### B1–B3. Mutation boundary, explicit persistence, patch transaction — hoàn thành

- `persistAndSync()` nhận explicit change-set; `BiddingModel.persistChanges()` ghi record-level bằng `putRecords/deleteRecords` và không chạy full-table diff.
- `mutatePersistAndSync()` chuyển change-set đã biết thẳng tới persistence boundary.
- `WorkspaceDataStore.patch()` lưu `affected ids + before + upserts + deletes`; validation/persistence rollback đúng affected records và khôi phục exact outbox checkpoint.
- Full-table `transaction()` được giữ làm compatibility path; bidder-goods Excel import đã chuyển khỏi path này sang patch API.
- Partner create/update/version flows chuẩn bị version family trên bản sao rồi commit qua mutation boundary; version cũ đổi `isLatest` được stage cùng version mới.

Tests:

- Mutation/Workspace targeted: 14/14 đạt.
- Bidder-goods + patch regression: 51/51 đạt.
- ESLint touched files: đạt.

Debt ratchet:

| Metric | Gate cũ | Gate mới |
|---|---:|---:|
| `direct_state_writes` | 92 | 87 |
| `runtime_styles` | 565 | 545 |
| `important` | 425 | 421 |

Không tăng limit; baseline được hạ đúng theo metric thực tế.

Microbenchmark `node scripts/benchmark_explicit_persistence.mjs` (adapter CPU, không gồm IndexedDB I/O):

| Records | Full-table diff median | Explicit one-record median |
|---:|---:|---:|
| 100 | 0.232 ms | 0.002 ms |
| 1,000 | 0.719 ms | 0.001 ms |
| 10,000 | 9.416 ms | 0.002 ms |

Rủi ro còn lại: các feature legacy chưa migrate vẫn dùng `persistData/trackDeletions`; compatibility path chưa xóa trong phase này.

### B4. Server-authoritative plan/package version transaction — hoàn thành

- Thêm endpoint `/api/versioning/aggregate` và các module `backend/versioning/{service,command,repository,aggregate_snapshot}.py`.
- Client gửi `sourceId`, `expectedRowVersion`, thay đổi được phép và `clientMutationId`; server kiểm tra tenant/RBAC, khóa aggregate bằng `FOR UPDATE`, kiểm tra optimistic version, clone/remap children, ghi audit/sync và commit trong một transaction.
- Plan snapshot tải package, lots, goods, bidder goods, opening/JV, assignments, evaluation metadata và owned children trực tiếp từ server; không phụ thuộc pagination/cold browser cache.
- Version command idempotent theo mutation id; conflict không force overwrite; historical records và `rootId` được giữ nguyên.
- Alias plan legacy `diadiemQuymo`/`thongtinKhac` được migrate idempotent sang `diaDiemQuyMo`/`thongTinKhac`; command chỉ phát canonical payload.
- Sửa regression cuối: repository versioning hydrate và khóa `goi_thau_chuyen_gia`, nhờ đó plan snapshot giữ nguyên Tổ chuyên gia/Tổ thẩm định. Sửa thêm race tạo gói đấu thầu lại để submit chờ inheritance hoàn tất và không bị completion cũ xóa pending selection mới.

Tests:

- 11/11 targeted backend aggregate version tests đạt.
- Package/plan version JS regressions đạt, gồm cold cache, child remap, date canonicalization, rebid ancestry và field aliases.
- PostgreSQL full lifecycle đạt tới `plan-version-snapshot-inherited` và `historical-plan-package-frozen`.

Migration/backward compatibility:

- Client chỉ fallback snapshot cũ khi endpoint trả đúng nhóm status legacy `404/405/501`.
- Legacy versions, labels, metadata và root lineage không bị rewrite hàng loạt.
- Canonical field thắng nếu record đồng thời chứa alias và canonical key.

### B5. Decompose `BiddingControllerSync` — hoàn thành incremental

`BiddingControllerSync.js` được thu gọn thành facade điều phối; trách nhiệm đã tách thành:

```text
SyncCoordinator
SyncPushService
SyncPullService
ConflictResolver
WebSocketSyncClient
WorkspaceEventBridge
SyncPresenter
SyncRenderCoordinator
SyncWorkspaceContext
```

- Push/pull, delta paging, conflict projection, WebSocket lifecycle, workspace event, UI status và render invalidation có seam riêng.
- `db_changed` được coalesce; WebSocket healthy dùng event-driven, chỉ polling khi channel unavailable.
- BFCache đóng/reconnect WebSocket đúng lifecycle; polling dừng khi realtime khỏe.
- Startup không replay mutation rỗng/trùng và không báo synced khi outbox còn pending.

Tests gồm sync conflict recovery, startup reconciliation, delta paging, sync status và WebSocket polling fallback; full JS suite đạt.

### B6. Feature service migration — hoàn thành incremental

- Thêm `FeatureServices.js`; controller có các namespace lazy `plans`, `packages`, `evaluation`, `contracts`, `partners`.
- Registry/prototype legacy vẫn được giữ làm compatibility bridge, nhưng feature mới trong phạm vi refactor dùng service seam rõ ràng.
- Module graph guard kiểm tra static imports/exports; kết quả 256 modules, 0 static import cycle.

## Phase C — Technical debt, CSS và coverage

### C1. Debt repayment — hoàn thành theo ratchet

| Metric | Baseline đầu việc | Kết quả cuối |
|---|---:|---:|
| `direct_state_writes` | 91 | 85 |
| `important` | 421 | 421 |
| `inferred_actions` | 6 | 6 |
| `raw_colors` | 842 | 842 |
| `runtime_styles` | 545 | 541 |
| Python `BLE001` | 151 | 147 |
| Python `F401` | 60 | 0 |
| Python `F841` | 13 | 0 |
| Python `S110` | 16 | 14 |
| Python `S608` | 129 | 129 |

- Không tăng limit để làm gate xanh.
- Runtime style/CSS touched paths dùng semantic class/token; `!important` và raw colors không tăng.
- Mojibake scanner, frontend module guard và Python debt scanner đều nằm trong `check:quality`.

### C2. Coverage ratchet — hoàn thành

- Thêm threshold cho aggregate version snapshot/command/repository/service bên cạnh sync, WebSocket, delta, conflict và document worker.
- Full gate: 615 Python tests và 475 JavaScript tests đạt.
- Combined coverage 44.86%; statement coverage 48.56%; branch coverage 34.87%; repository floor giữ nguyên 28%.
- 15 critical modules đều đạt line/branch threshold riêng, không hạ threshold cũ.

## Phase D — Performance và UX nền tảng

### D1. Entity indexes — hoàn thành

- `EntityIndexes` cung cấp index `byId`, `byRootId`, `byPlanId`, `byPackageId`, `byOpeningId`, `byContractorId`, `byLotId` trên source arrays, không tạo source of truth thứ hai.
- Paginated replacement invalidates index đúng lúc; sửa regression stale package làm mất metadata đánh giá sau reload.
- Benchmark 10.000 records/2.000 lookups: linear median 94.632 ms, indexed median 0.190 ms, nhanh hơn 499.1 lần.

### D2. Existing virtualization — đã profile và giữ kiến trúc phù hợp

- Không thêm framework mới. Profile dùng utility `virtualTable` hiện có trên package goods, bidder goods, detailed evaluation, timeline và contractors.
- 1.000 rows: virtual render median 2.6–7.2 ms, chỉ mount 22–24 rows; full render median 87.7–279.9 ms.
- Bidder goods đã có pagination và detailed evaluation đã có incremental chunking nên không thay bằng virtualization gây mất mounted editable state; contractors tiếp tục dùng shared virtual table. Kết quả được ghi tại `data/logs/table-virtualization-benchmark.json`.

### D3. Excel worker — hoàn thành theo kết quả profiling

| File | Main-thread median | Main-thread longest task | Worker median | Worker longest task |
|---:|---:|---:|---:|---:|
| 1 MB | 38.8 ms | 76 ms | 133.2 ms | 0 ms |
| 5 MB | 226.9 ms | 229 ms | 313.6 ms | 0 ms |
| 10 MB | 518.9 ms | 524 ms | 647.6 ms | 0 ms |

- 5/10 MB tạo long task rõ ràng nên parsing/validation nặng được chuyển sang Web Worker; giữ nguyên reader/business mapping, row order và stale-job cancellation.
- Worker URL và `importScripts` SheetJS đều đi qua Trusted Types policy hẹp, chỉ chấp nhận first-party hashed asset hoặc đúng vendored SheetJS URL.
- Vite bắt buộc emit worker thành same-origin `/dist/assets/excelParseWorker-*.js`; secure artifact guard từ chối mọi `data:text/javascript` worker bị CSP chặn.
- Bidder-goods E2E xác minh worker trong browser với CSP thật, reload, PostgreSQL và context thứ hai.

Artifact: `data/logs/excel-parse-benchmark.json`.

### D4. WebSocket-first notification — hoàn thành

- Realtime healthy: event-driven và coalesce render/pull.
- Realtime unavailable: polling fallback có backoff; tự dừng khi socket phục hồi.
- Không tạo notification system mới.

### D5. Obfuscation A/B — hoàn thành

| Variant | Effective build | JS bytes | Gzip bytes | Cold median | Warm median |
|---|---:|---:|---:|---:|---:|
| Dead-code injection ON | 14.419 s | 2,984,523 | 784,619 | 61.1 ms | 62.9 ms |
| OFF | 11.152 s | 2,940,278 | 769,762 | 59.8 ms | 60.1 ms |

Dead-code injection tăng build khoảng 29%, JS khoảng 1.5% và gzip khoảng 1.9%; startup chênh nhỏ. Secure build hiện tại vẫn giữ cấu hình đã review; benchmark không thay thế CSP/RBAC/secrets. Artifact: `data/logs/obfuscation-benchmark.json`.

### D6. UX nền tảng — hoàn thành

- Save/sync status dùng state machine thật: server saved, local pending, syncing, offline, conflict, validation rejected và transport error.
- Detailed evaluation draft autosave có debounce, dirty state, timestamp, stale cancellation, restore và pending sync; không autosave thành completed.
- Validation summary hiển thị số lỗi, click/focus field và giữ inline validation.
- Detailed evaluation giữ sticky context package/lot/contractor/round/method/status trên bảng dài.

## Regression fixes phát hiện trong E2E cuối

- Invalidate entity index sau paginated replacement để không đọc stale package/metadata.
- Tách identity thành viên liên danh khỏi contractor identity; backend migrate legacy collision sang UUID5 ổn định theo parent + contractor.
- Coalesce lot-scope rerender qua microtask sau khi commit scope để không thay DOM giữa native checkbox activation.
- Plan aggregate chỉ phát canonical field names.
- Server plan snapshot giữ expert/appraisal relations trong transaction.
- Package rebid submit chờ inheritance async hoàn tất.
- Excel worker và dependency `importScripts` tương thích CSP Trusted Types.
- Lifecycle ranking assertion chờ frame tính toán thực thay vì kiểm tra đồng bộ trước `requestAnimationFrame`.

## Final verification

### E2E

| Suite | Kết quả |
|---|---|
| Auth/roles | Đạt |
| Offline/reconnect/outbox | Đạt |
| Multi-assignee/activity | Đạt |
| Joint venture + low-price + export + multi-lot | Đạt |
| Low-price conflict | Đạt |
| CRUD modules | Đạt |
| Package pairwise (15 cases) | Đạt |
| Full lifecycle | Đạt |
| Bidder goods | Đạt |
| UI quality responsive/accessibility | Đạt |
| Startup performance | Đạt |

### Quality, security và package

- `npm run check`: đạt.
- `npm run test:security-deploy`: 73/73 đạt; Turnstile pass/fail/interactive/slow/script-failure/auto-pending đều đạt.
- `npm audit --omit=dev`: 0 vulnerability.
- `pip-audit -r requirements.txt --no-deps --disable-pip`: không có vulnerability đã biết trên lock file pin/hash.
- Trusted Types, DOMPurify, CSP, vendor SheetJS và Excel archive guard: đạt.
- Secure Vite build: 260 modules transformed, 46 obfuscated JS bundles và worker asset same-origin được xác minh.
- Foreign-key index audit: 104 foreign keys, không thiếu index.
- Production package extracted-runtime smoke: 383 files, đạt.
- CycloneDX SBOM: đã sinh trong `release/`.

## Migration và rủi ro còn lại

- IndexedDB schema, outbox envelope, historical versions, rootId và template config không đổi; migration alias/metadata/JV idempotent.
- Full-table `persistData/transaction` và prototype registry vẫn tồn tại cho legacy callers, nhưng hot paths đã có explicit mutation/service seams. Nên tiếp tục giảm theo ratchet ở sprint sau, không xóa big-bang.
- CSS debt tuyệt đối còn cao; gate ngăn tăng và phase này chỉ giảm các path có bằng chứng, tránh visual regression diện rộng.
- Benchmark phụ thuộc máy/chromium hiện tại; giữ artifacts để so sánh cùng môi trường CI về sau.
- Theo dõi production metrics cho sync conflict, worker failure/fallback và WebSocket reconnect sau rollout.

Không có product feature mới nào được triển khai trong nhiệm vụ này.

## Kết luận

Nền tảng đã sẵn sàng cho giai đoạn chọn tính năng mới.
