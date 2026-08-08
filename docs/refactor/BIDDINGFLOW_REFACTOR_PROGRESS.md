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

### A2. WorkspaceDataStore/outbox/offline state machine — đang audit

Chưa được coi là hoàn thành. Test hiện có mới phân biệt `committed`, `offlineQueued`, `conflict` và `rejected`, nhưng chưa chứng minh đầy đủ 400/409/503/transport/reload/idempotent semantics theo prompt.

### A3–A6 — chưa hoàn thành audit

- Canonical evaluation domain codes.
- One technical score parser frontend/backend/import/ranking parity.
- Authoritative evaluation metadata codec.
- Mojibake CI guard.

## Phase B–D

Chưa đánh dấu hoàn thành. Mỗi mục chỉ được cập nhật sau khi có bằng chứng code + test + benchmark/gate phù hợp.

