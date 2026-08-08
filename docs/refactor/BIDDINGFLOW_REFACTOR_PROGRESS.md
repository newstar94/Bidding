# BiddingFlow refactor progress

Ngày bắt đầu đối chiếu: 2026-08-08  
Nguồn yêu cầu:

- `docs/01_BAO_CAO_RA_SOAT_CAI_THIEN_BIDDINGFLOW_2026-08-08.md`
- `docs/02_PROMPT_CODEX_SUA_LOI_REFACTOR_TOI_UU_BIDDINGFLOW_2026-08-08.md`

Phạm vi chỉ gồm sửa lỗi, refactor, giảm nợ kỹ thuật, tối ưu hiệu năng và UX nền tảng. Không triển khai feature sản phẩm mới.

## Baseline

### Quality/security/package gates

Lệnh: `npm run check`

Kết quả ngày 2026-08-08: đạt.

- Python tests: đạt; tổng coverage 55%, ngưỡng repository 28%.
- JavaScript tests: 399/399 đạt.
- Trusted Types/CSP-related lint: đạt.
- Vendor/SheetJS/archive security audit: đạt.
- Secure Vite build: đạt, 46 bundle đã được kiểm tra.
- Foreign-key audit: 104 khóa ngoại, không thiếu index.
- Production package smoke check: đạt, 377 runtime files.
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

| Chỉ số | Baseline | Giới hạn |
|---|---:|---:|
| Cold median | 348 ms | — |
| Cold p95 | 405 ms | 800 ms |
| Warm median | 186 ms | — |
| Warm p95 | 201 ms | 325 ms |
| Longest task | 0 ms | 100 ms |

Artifact: `data/logs/startup-performance.json`.

### E2E baseline

| Gate | Trạng thái | Ghi chú |
|---|---|---|
| Auth shell | Đạt | Loader, profile menu và modal owner hoạt động. |
| Auth/roles matrix | Chưa xác minh | Server dev hiện tại bật Turnstile; bước đăng ký bị chặn đúng với `BOT_CHALLENGE_REQUIRED`. Cần chạy lại trên process E2E riêng với Turnstile test/disabled, không thay đổi security production. |
| CRUD/multi-assignee/JV/bidder goods/low-price/offline/pairwise/lifecycle/UI quality | Chờ chạy | Không coi baseline tổng thể là hoàn tất cho đến khi các gate này có kết quả. |

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
- `BiddingControllerSync.js`: push/pull/delta/conflict/WebSocket/UI refresh; đang mang nhiều trách nhiệm.
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

Hiện authority tạo snapshot chính thức vẫn có phần nằm phía client và phải tiếp tục audit cold-cache/full-hydration trước khi chuyển dần về backend transaction.

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

Rủi ro còn lại:

- Cần chạy lại full suite/E2E sau khi hoàn tất nhóm Phase A.

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

- Transaction vẫn clone full các bảng liên quan; chuyển sang patch-based thuộc Phase B.
- Cần chạy full suite/E2E offline sau khi hoàn tất toàn Phase A.

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

## Phase B–D

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

### B4–B6 — đang thực hiện

- Server-side official plan/package version transaction.
- Incremental sync decomposition.
- Runtime prototype/service migration.
