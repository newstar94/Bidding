# Báo cáo audit dead code — 2026-08-21

## Kết luận

Audit hoàn tất ở chế độ zero-regression.

- `START_HEAD=845de9434c6459e78c74faafba21a0e029df3739`
- Chỉ một symbol đạt chuẩn `A. CONFIRMED DEAD`: `canApplyPreview()`.
- Không xóa ứng viên chưa chắc chắn.
- Không thay đổi business logic, data semantics, schema, migration, RBAC, record scope, assignment scope, tenant isolation, session, audit, masking hoặc khả năng xem dữ liệu.
- Không thay đổi `deadCodeInjection` của secure build.

## Phạm vi và entrypoint

Frontend production bắt đầu tại `frontend/app/app.js`. Graph audit theo cả:

- static `import`/`export`;
- literal dynamic `import()`;
- worker/module URL qua `new URL(..., import.meta.url)`;
- các lazy loader cho workspace, workflow, admin, Assistant, Notification, Excel và Word.

Kết quả sau cleanup:

```text
modules=294
reachable=294
orphans=0
unresolved literal edges=0
static import cycles=0
```

Backend startup thực tế tạo 169 route với tổng cộng 260 method registrations. Document worker được tham chiếu bởi runtime, production packager, deployment verification và runbook; không có worker/route entrypoint nào bị xóa.

## Controller command inventory

`npm run audit:controller-commands -- --markdown` sinh bảng đầy đủ theo schema:

| Command/export | Kind | Declared in | Installed? | Static caller | Dynamic/string caller | HTML caller | Test-only | Action |
|---|---|---|---:|---|---|---|---:|---|

Inventory trước cleanup có 112 function/class exports; sau cleanup còn 111. Audit vẫn tìm thấy năm class bị installer xem như prototype command:

```text
NoticeImportWizard
PlanImportDraftStore
PlanImportWizard
ProcurementImportResumeStore
ProcurementInlineLookup
```

Các class này đang sống qua constructor/runtime nội bộ. Việc giới hạn installer cần refactor manifest toàn cục và parity proof rộng hơn; vì vậy không thay đổi registry trong task này.

Năm export sau chỉ có test reference trực tiếp nhưng vẫn được `export *` cài lên prototype; chưa đủ bằng chứng về compatibility/public intent nên được giữ:

| Export | Classification | Action |
|---|---|---|
| `openProcurementImportWizard` | F. UNKNOWN | KEEP |
| `openProcurementNoticeImportWizard` | F. UNKNOWN | KEEP |
| `originatePackageImportFlow` | F. UNKNOWN | KEEP |
| `originatePlanImportFlow` | F. UNKNOWN | KEEP |
| `reconcileOpeningDrafts` | F. UNKNOWN | KEEP |

## Dead-code matrix

| ID | Candidate | Evidence | Classification | Action | Regression evidence |
|---|---|---|---|---|---|
| DC-001 | `canApplyPreview()` | Không có runtime/static/dynamic/string/HTML/route/worker/E2E caller; chỉ test và `export *`. Git history `b6f2bdbf` cho thấy production Apply đã chuyển sang `canStartSequentialImport()` ngày 2026-08-13. | A. CONFIRMED DEAD | REMOVED | Targeted 69/69 PASS; full JS/Python/static/build/E2E/performance PASS |
| DC-002 | Năm test-only exports liệt kê ở trên | Inventory không tìm runtime caller, nhưng installer làm chúng thành surface tương thích và không có quyết định kết thúc compatibility. | F. UNKNOWN | KEEP | Inventory tái chạy sau cleanup |
| DC-003 | Năm class bị cài lên controller prototype | Class được runtime khởi tạo; chỉ phần prototype exposure có vẻ thừa. Refactor registry chưa có parity proof toàn bộ. | C. LIVE INDIRECTLY | KEEP | Full command inventory; 12/12 E2E PASS |
| DC-004 | `export *` + prototype installation | 111 function/class exports được cài động bằng `Object.entries(module)`. Đây là architectural debt, không phải bằng chứng từng symbol chết. | F. UNKNOWN | KEEP architecture | Module registry tests, static graph và E2E PASS |
| DC-005 | Frontend orphan modules | Graph hiểu static/dynamic/worker edge cho kết quả 294/294 reachable. | Không có candidate | NONE | Guard chạy trong `npm run check:static` |
| DC-006 | 59 direct state writes | Debt ratchet xác nhận không tăng; chưa có proof rằng MutationService thay thế chính xác side effect/outbox/workspace behavior của từng path. | C/E. LIVE OR COMPATIBILITY | KEEP | JS regression và sync/workspace E2E PASS |
| DC-007 | Backend functions/routes/workers | Ruff baseline F401=0, F841=0; app registration có 169 routes/260 methods; decorator/route list, DI, import side effect và worker entrypoints đều được bảo toàn. | C. LIVE INDIRECTLY | KEEP | 1.429 Python tests PASS; critical coverage PASS |
| DC-008 | Script không được package script gọi trực tiếp | Scan 82 scripts chỉ nêu ba standalone theo basename; cả ba là benchmark/generator có test, generated artifact hoặc operational invocation. | D/E. TEST/OPERATIONAL | KEEP | Static checks và related tests PASS |
| DC-009 | JS/Python direct dependencies | Mọi JS direct dependency có runtime/build/test reference. Python direct dependencies có import/framework/deployment consumer; `python-multipart` phục vụ form/upload và Uvicorn là deployment entrypoint. | C. LIVE | KEEP | `npm ls --depth=0` sạch; build/test PASS |
| DC-010 | Migration/schema/legacy readers | Không có bằng chứng kết thúc migration window hay production-data compatibility. | E. COMPATIBILITY/MIGRATION | KEEP | Migration fixture/schema checks và Python suite PASS |

## Removal log

```text
symbol/file:
  frontend/procurement/PlanImportWizard.js :: canApplyPreview

why confirmed dead:
  Production refreshApplyGate(), prepare status và apply() đều dùng
  canStartSequentialImport(). Git history chứng minh đường cũ bị thay thế khi
  chuyển sang sequential import. Không có caller nào ngoài test cũ; export vào
  BiddingWorkflows chỉ làm phát sinh prototype method ngoài ý muốn.

all known reference checks:
  static import/call: none outside obsolete test
  dynamic import/access: none
  controller/string/data-fn/HTML: none
  routes/workers/scripts/E2E: none
  docs/public compatibility contract: none ngoài prompt audit
  production graph: module vẫn reachable; symbol không còn trong inventory

tests before:
  targeted procurement_import_wizard: 70/70 PASS
  full JS coverage: PASS, 51.94%, critical ratchet PASS
  Python: 1429 PASS, 56.99%, critical ratchet PASS
  static and secure build: PASS

tests after:
  targeted procurement_import_wizard: 69/69 PASS
  full JS coverage: PASS, 51.89%, critical ratchet PASS
  Python: 1429 PASS, 56.99%, critical ratchet PASS
  static and secure build: PASS
  E2E: 12/12 PASS on Chromium, Firefox and WebKit
  performance: PASS

test rationale:
  Một test chỉ kiểm tra API chết và ba assertion của API chết trong test summary
  đã được bỏ. Assertion của summarizePreview được giữ và đổi tên đúng phạm vi.
  Tests của canStartSequentialImport và flow production vẫn giữ nguyên. Không
  skip, không hạ assertion production, không hạ threshold/ratchet.

bundle impact:
  production JS total: -579 raw bytes, -143 gzip bytes
  BiddingWorkflows chunk: -523 raw bytes, -132 gzip bytes
  JS chunk count: 56 -> 56

behavior impact: NONE
```

CSS total trong detached-worktree comparison khác do checkout line-ending normalization; không có CSS source nào được sửa và secure route-CSS guard PASS. Kết luận bundle cleanup dựa trên JS total và chunk đích.

## Tooling/guard được thêm

- `scripts/audit_frontend_reachability.mjs`: graph production static + dynamic + worker, fail khi entrypoint thiếu, literal edge unresolved hoặc module frontend unreachable.
- `tests/js/frontend_reachability_guard.test.mjs`: regression cho static/dynamic/worker parsing và traversal.
- `scripts/audit_controller_commands.mjs`: inventory tái lập cho toàn bộ `BiddingWorkflows` exports, declaration, runtime/string/HTML/test evidence.
- `npm run audit:dead-code` được nối vào `npm run check:static`, nên orphan frontend mới làm CI fail.

## Full regression evidence

| Check | Result |
|---|---|
| `npm run test:js:coverage` | PASS; critical JS ratchet 14 modules |
| Python pytest + branch coverage | 1429 PASS; 56.99% ≥ 45% |
| `python scripts/check_critical_coverage.py coverage.json` | PASS; 16 modules |
| `npm run check:static` | PASS; includes reachability guard |
| `npm run build:secure` | PASS; 55 obfuscated bundles; `deadCodeInjection=true` unchanged |
| `npm run test:e2e:smoke` | 12/12 PASS; Chromium + Firefox + WebKit |
| `npm run test:performance` | PASS; cold p95 481 ms ≤ 800; warm p95 261 ms ≤ 325; longest task 0 ms |

Lần chạy E2E đầu bị `CONNECTION_REFUSED` sau khi Uvicorn trên Windows gặp socket accept error; các case trước đó đã PASS và các case sau fail đồng loạt ở navigation. Server được khởi động lại với access log tắt, sau đó toàn bộ ma trận 12/12 PASS. Đây được ghi là hạ tầng lần chạy đầu, không được tính là PASS giả.

Business regression matrix trong prompt được bao phủ bởi full JS/Python suite và các seam E2E cho startup reconciliation, deleted-record recovery, plan version conflict, historical read-only behavior, browser matrix, auth shell và lazy workflow loading. Không có code business nào trong các seam đó bị sửa.

## Stop audit round 1

- Reachability rerun: 294/294, 0 orphan, 0 unresolved.
- Static graph rerun: 294 modules, 0 cycle.
- Controller inventory rerun: 111 exports; chỉ `canApplyPreview` biến mất.
- Dynamic import/worker edges vẫn reachable.
- Không xuất hiện production file mới bị unreachable.

## Stop audit round 2

Review toàn bộ diff:

| Câu hỏi | Kết quả |
|---|---|
| Có xóa side effect? | Không; helper thuần không có side effect và không được gọi production. |
| Có xóa runtime registration? | Chỉ bỏ accidental prototype exposure của helper chết; không bỏ command có caller. |
| Có đổi timing/order/import side effect? | Không. |
| Có đổi workspace capability/outbox/sync? | Không. |
| Có đổi prototype command availability? | Chỉ `canApplyPreview`, có chủ đích và không có runtime/string/HTML caller. |
| Có đổi public/test compatibility? | Chỉ xóa test API cũ đã bị production thay thế; rationale và Git history được ghi ở trên. |

## Trả lời 12 câu hỏi cuối

1. Production feature behavior thay đổi? **Không.**
2. Controller command biến mất? **Không có command chức năng; chỉ accidental dead helper `canApplyPreview`.**
3. Dynamic/lazy module unreachable? **Không; 294/294 reachable.**
4. Route/worker/script entrypoint biến mất? **Không.**
5. Test bị làm yếu? **Không; chỉ test API chết bị bỏ, production replacement tests giữ nguyên.**
6. Coverage threshold giảm? **Không.**
7. Secure build behavior đổi? **Không.**
8. Workspace/versioning/sync/RBAC semantics đổi? **Không.**
9. E2E regress? **Không; rerun 12/12 PASS trên ba browser.**
10. Performance regress? **Không; performance gate PASS.**
11. Mọi candidate bị xóa đều proven CONFIRMED DEAD? **Có; chỉ một candidate bị xóa.**
12. Uncertain candidates được giữ? **Có.**
