# Báo cáo triển khai danh mục hàng hóa dự thầu của nhà thầu

Ngày kiểm tra cuối: 29/07/2026  
Nhánh: `main`  
Commit nền: `516f9d9`

## 1. Kiến trúc đã khảo sát

Các nhóm file chính đã được khảo sát:

- Schema và migration: `backend/db/schema.py`, `backend/db/postgres_schema.py`, `backend/db/upgrades.py`.
- Hợp đồng dữ liệu và sync: `backend/documents/schema_contract.py`, `backend/sync/queries.py`, `backend/sync/read_service.py`, `backend/sync/record_validator.py`, `backend/sync/payload_validation.py`, `backend/sync/ownership.py`.
- Phân quyền: `backend/shared/access_policy.py` và cơ chế kế thừa quyền từ phân công gói thầu.
- Local state, IndexedDB và mutation outbox: `frontend/app/BiddingModel.js`, `frontend/app/BrowserDB.js`, `frontend/app/BiddingControllerSync.js`, `frontend/shared/MutationService.js`.
- Đánh giá tổng quát/chi tiết: `DetailedEvaluationWorkflow`, `DetailedEvaluationPanel`, controller và save workflow liên quan.
- Excel: runtime SheetJS được vendored, `frontend/documents/excelFileReader.js`, cơ chế bảo vệ archive và export hiện có.
- Hàng hóa yêu cầu của gói: `goi_thau_hang_hoa` và các module package-goods hiện có.

Kiến trúc được tái sử dụng:

- Tab mới nằm trong báo cáo đánh giá chi tiết, không tạo luồng điều hướng mới và không thêm cột/nút/badge vào bảng đánh giá tổng quát.
- Dùng IndexedDB theo workspace, mutation outbox, sync version và row version hiện có.
- Dùng button, table, badge, modal, empty state, spacing và design token hiện có.
- Dùng SheetJS đã được ghim phiên bản và các kiểm tra an toàn workbook sẵn có.
- 1G1T dùng nhóm đánh giá `single`; 1G2T chỉ dùng tab mới trong nhóm `financial`, không xuất hiện ở `technical`.

## 2. Thiết kế đã triển khai

### Mô hình dữ liệu

Tạo bảng `hang_hoa_du_thau_nha_thau`, tách biệt hoàn toàn với danh mục yêu cầu `goi_thau_hang_hoa`.

Các quan hệ chính:

- `goi_thau_id`: phiên bản gói thầu đang đánh giá.
- `thong_tin_mo_thau_id`: hồ sơ/nhà thầu và phạm vi lô đang đánh giá.
- `phan_lo_id`: lô của dòng chào, hoặc `NULL` với gói không phân lô.
- `goi_thau_hang_hoa_id`: hàng hóa yêu cầu được ghép.
- Unique `(organization_id, thong_tin_mo_thau_id, goi_thau_hang_hoa_id)` ngăn ghép trùng.
- Có `is_draft`, `import_batch_id`, `row_version`, `sync_version`, thời gian tạo/cập nhật và các index phục vụ đọc/đối chiếu.

Schema PostgreSQL được nâng lên phiên bản 23. IndexedDB được nâng từ phiên bản 4 lên 5 và thêm store `hanghoaduthaunhathau` mà không tạo lại các store cũ.

### Parser Sheet 12.1

Parser mới:

- Tìm sheet theo tên chuẩn, `12.1B`, hoặc tổ hợp `12.1` + “Bảng giá dự thầu”.
- Tìm dòng header động, không hard-code dòng 4.
- Hỗ trợ `Ký mã hiệu` và lỗi mẫu `Kỹ mã hiệu` cùng các alias bắt buộc khác.
- Giữ STT, năm sản xuất và mã HS dưới dạng text.
- Bỏ hoàn toàn `Mặt hàng dự thầu`, `Mã hàng hóa`, `Phân nhóm`.
- Bỏ dòng tổng, số tiền bằng chữ, dự phòng, ghi chú, dòng rỗng và dòng cha của lô.
- Hỗ trợ cả lô nằm trên cùng dòng hàng hóa và cấu trúc dòng cha `1` / dòng con `1.1`…
- Không chạy macro hay nội dung ngoài workbook; export trung hòa chuỗi bắt đầu bằng `=`, `+`, `-`, `@`.

### Mapping và kiểm tra tài chính

- Ghép tự động theo phạm vi gói/lô, tên chuẩn hóa, đơn vị tính và thứ tự.
- Cho phép ghép thủ công; phát hiện unmatched, duplicate, wrong lot và lot not found.
- Bản nháp cho phép dữ liệu chưa hoàn thiện; bản chính thức yêu cầu ghép đủ và duy nhất.
- Kiểm tra `khối lượng × đơn giá = thành tiền` với sai số tối đa 1 VND.
- Đối chiếu tổng dòng với giá dự thầu của hồ sơ.
- Chặn hoàn tất báo cáo chi tiết khi hàng hóa chưa được lưu chính thức hoặc còn lỗi.
- Backend xác minh lại workspace, gói, hồ sơ mở thầu, lô, hàng hóa yêu cầu và tổng tiền; không tin quan hệ do client gửi.

### UI/UX

Tab `Danh mục hàng hóa dự thầu` được đặt sau tab `Tài chính` trong báo cáo đánh giá chi tiết.

Tab có:

- Tải file mẫu điền sẵn phần lô, danh mục yêu cầu, đơn vị tính và khối lượng.
- Chọn file Excel, thêm thủ công, gộp hoặc thay thế phạm vi.
- Preview trước khi áp dụng.
- Tìm kiếm, phân trang, bảng chỉnh sửa, mapping thủ công và xóa dòng.
- Thẻ tổng hợp số dòng, tổng thành tiền, chênh lệch và số lỗi.
- Lưu nháp, lưu chính thức, export Excel, empty state và read-only state.
- CSS được giới hạn bằng namespace `bidder-goods-*`; cache-buster của `views.css` đã được cập nhật để style mới không bị cache cũ che mất.

## 3. File đã thay đổi

### File thêm mới

- `backend/sync/bidder_goods.py`
- `frontend/packages/BidderGoodsExcel.js`
- `frontend/packages/BidderGoodsWorkflow.js`
- `frontend/packages/bidderGoodsMapping.js`
- `frontend/packages/bidderGoodsSelectors.js`
- `frontend/packages/bidderGoodsValidation.js`
- `scripts/generate_schema_runtime.py`
- `scripts/bidder_goods_e2e_fixture.py`
- `scripts/verify_bidder_goods_e2e.cjs`
- `tests/test_bidder_goods.py`
- `tests/js/bidder_goods.test.mjs`

### Backend sửa đổi

- `backend/db/schema.py`
- `backend/db/postgres_schema.py`
- `backend/db/upgrades.py`
- `backend/documents/schema_contract.py`
- `backend/shared/access_policy.py`
- `backend/sync/ownership.py`
- `backend/sync/payload_validation.py`
- `backend/sync/queries.py`
- `backend/sync/read_service.py`
- `backend/sync/record_validator.py`

### Frontend sửa đổi

- `frontend/app/BiddingController.js`
- `frontend/app/BiddingControllerSync.js`
- `frontend/app/BiddingModel.js`
- `frontend/app/BrowserDB.js`
- `frontend/documents/excelFileReader.js`
- `frontend/packages/DetailedEvaluationPanelController.js`
- `frontend/packages/DetailedEvaluationSaveWorkflow.js`
- `frontend/packages/DetailedEvaluationWorkflow.js`
- `frontend/packages/detail/DetailedEvaluationPanel.js`
- `frontend/packages/detailedEvaluationRules.js`
- `frontend/shared/idUtils.js`
- `package.json`
- `views/css/views.css`
- `views/index.html`

### Generated/migration/test liên quan

- `frontend/documents/schemaRuntime.js` được sinh lại bằng `scripts/generate_schema_runtime.py`, không sửa tay.
- `tests/test_package_goods.py` và `tests/js/package_goods.test.mjs` được cập nhật cho schema/IndexedDB version mới.

## 4. Kết quả đọc trực tiếp ba file mẫu

Ba file được đọc bằng đúng runtime SheetJS vendored và parser triển khai trong ứng dụng. Header vật lý của cả ba file hiện nằm ở dòng 4, nhưng parser vẫn tìm động.

| File | Sheet | Dòng đọc được | Dòng lưu chính thức | Dòng bỏ qua | Lỗi parser/E2E | Tổng thành tiền | Kết quả |
|---|---|---:|---:|---:|---:|---:|---|
| `Dự thầu không phân lô.xlsx` | Mẫu số 12.1B | 11 | 11 | 3 | 0 | 1.878.883.230 | Pass UI import, preview, lưu chính thức, reload và PostgreSQL |
| `Dự thầu 1 phân lô 1 mặt hàng.xlsx` | Mẫu số 12.1B | 20 | 20 | 3 | 0 | 3.574.400.000 | Pass 20/20 phạm vi lô của cùng nhà thầu |
| `Dự thầu 1 phân lô nhiều mặt hàng.xlsx` | Mẫu số 12.1B | 5 | 5 | 4 | 0 | 224.890.260 | Pass UI import, preview, lưu chính thức, reload và PostgreSQL |

Ba file được chạy bằng SheetJS vendored và parser thật của ứng dụng. E2E dùng `setInputFiles` trên input file thật, xác minh preview không có cảnh báo, lưu từng phạm vi nhà thầu/lô, tải lại UI và truy vấn PostgreSQL để đối chiếu số dòng, tổng tiền, mapping duy nhất và `is_draft = 0`.

## 5. Kết quả test

| Lệnh | Kết quả |
|---|---|
| `python -m pytest -q` | 85 passed |
| `node --test tests/js/*.test.mjs` | 59 passed |
| `python scripts/generate_schema_runtime.py` | Sinh lại idempotent |
| `npm run test:bidder-goods-e2e` | Pass 5 gói UI-to-PostgreSQL, second browser context và tự xóa fixture |
| `git diff --check` | Pass |
| `npm run build` | Pass |

Build bao gồm ESLint frontend, Trusted Types check, audit asset vendored, SheetJS security smoke test, Excel archive guard và Vite secure build. Vite báo hai URL WOFF2 tuyệt đối được giữ để resolve lúc runtime; cả font Latin và Vietnamese đã được xác minh HTTP 200 với đúng kích thước asset vendored.

E2E cuối (`runId = bg-e2e-1785276809212`) xác minh:

| Kịch bản | Dòng chính thức | Tổng tiền | Phạm vi mở thầu |
|---|---:|---:|---:|
| 1G1T không phân lô | 11 | 1.878.883.230 | 1 |
| 1G1T phân lô, một mặt hàng/lô | 20 | 3.574.400.000 | 20 |
| 1G1T một lô, nhiều mặt hàng | 5 | 224.890.260 | 1 |
| 1G2T tài chính, không phân lô | 11 | 1.878.883.230 | 1 |
| 1G2T tài chính, có phân lô | 5 | 224.890.260 | 1 |

Trong cả hai gói 1G2T, tab bị ẩn ở bước kỹ thuật và xuất hiện ở bước tài chính. Một browser context độc lập đăng nhập lại đã tải đủ 11 dòng chính thức từ server, chứng minh dữ liệu không chỉ tồn tại trong IndexedDB của phiên nhập.

Các test mới bao phủ schema/sync contract, draft/official validation, cross-package mapping, access policy, trạng thái `EVALUATING`, parser/header/alias/lô, mapping duy nhất, đối chiếu tài chính, điều kiện hiển thị 1G1T/1G2T, formula injection, file mẫu Excel và race condition khi enqueue mutation.

## 6. Lỗi phát hiện và đã sửa

### 6.1 Trạng thái backend dùng mã nhưng access policy so sánh nhãn

- Tái hiện: lưu một dòng từ tab mới khi gói có `trang_thai = EVALUATING`.
- Hiện tượng: backend trả “Hàng hóa dự thầu chỉ được sửa trong giai đoạn đánh giá”.
- Nguyên nhân: policy chỉ chấp nhận nhãn hiển thị tiếng Việt.
- Sửa: chấp nhận cả `OPENED`, `EVALUATING`, `PARTIALLY_AWARDED` và các nhãn tương ứng trong cả batch/scalar authorization.
- Regression: `test_employee_write_accepts_persisted_evaluating_status_code`.

### 6.2 UI báo lưu nhưng mutation chưa chắc đã vào outbox

- Tái hiện: thêm thủ công, nhấn lưu nháp, UI báo thành công nhưng truy vấn database chưa có bản ghi.
- Nguyên nhân: `trackDeletions()` gọi enqueue upsert/delete nhưng không `await`; `autoSync()` có thể chạy trước khi outbox có mutation.
- Sửa: chờ hoàn tất `markRecordDirty()` và `markDeleted()` trước khi tiếp tục persist/sync.
- Regression: `persistence waits for bidder-goods mutations to enter the outbox`.

### 6.3 CSS mới bị cache cũ che mất

- Tái hiện: HTML tab mới xuất hiện nhưng toolbar và summary không nhận grid/card style.
- Nguyên nhân: URL `views.css` vẫn dùng revision cũ.
- Sửa: cập nhật cache-buster trong `views/index.html`.
- Xác minh: reload trình duyệt cho thấy context bar, toolbar, summary cards và bảng dùng đúng design system.

### 6.4 Chữ tiếng Việt của fixture trình duyệt bị thành dấu hỏi

- Đây không phải lỗi font của ứng dụng. Nhãn UI tĩnh vẫn hiển thị đúng.
- Nguyên nhân là dữ liệu test chèn qua PowerShell stdin bị chuyển mã.
- Fixture được chèn lại bằng Unicode escape; ảnh kiểm tra sau đó hiển thị đúng. Fixture và file Excel tạm đã được xóa sau kiểm tra.

### 6.5 Bước kỹ thuật 1G2T bị kiểm tra nhầm hàng hóa tài chính

- Tái hiện bằng audit luồng `completeReport` của gói hàng hóa 1G2T.
- Nguyên nhân: điều kiện chặn hoàn thành báo cáo theo hàng hóa áp dụng cho mọi vòng, kể cả kỹ thuật nơi tab hàng hóa bị ẩn.
- Sửa: chỉ chạy cổng kiểm tra hàng hóa khi hoàn thành 1G1T hoặc vòng tài chính 1G2T.
- Regression: `bidder goods gate applies to 1G1T and 1G2T financial completion only`.

### 6.6 Thiếu trạng thái loading/error inline khi đọc Excel

- Bổ sung trạng thái `aria-busy`, spinner dùng design token hiện có, vô hiệu hóa control trong lúc đọc và thông báo lỗi inline có `role="alert"`.
- Khi sync thất bại, state trước khi lưu được khôi phục và tab hiển thị lý do rõ ràng.
- Regression kiểm tra loading/error/read-only markup và control chỉnh sửa bị ẩn/disabled.

## 7. Kiểm thử trình duyệt và vấn đề còn lại

Đã xác minh trực tiếp bằng Chromium/Playwright trên ứng dụng local và tài khoản thật:

- Đăng nhập, chọn workspace E2E cô lập và quyền Manager qua UI/API phiên đăng nhập thật.
- Bảng đánh giá tổng quát 1G1T/1G2T không có control hàng hóa dự thầu.
- Import trực tiếp cả ba file bằng file input thật, xem preview, xác nhận nhập và lưu chính thức.
- 1G1T không phân lô, 20 lô một mặt hàng và một lô nhiều mặt hàng đều lưu đúng.
- 1G2T không phân lô và có phân lô đều ẩn tab ở kỹ thuật, hiển thị/lưu được ở tài chính.
- Reload giữ nguyên dữ liệu; PostgreSQL khớp số dòng, tổng tiền, số phạm vi, mapping duy nhất và không còn bản nháp.
- Browser context thứ hai, không dùng IndexedDB/cookie của context nhập, đăng nhập lại và tải đủ dữ liệu từ server.
- Mỗi lần chạy tạo organization riêng và kết thúc bằng `fixture-removed`; không để lại dữ liệu thử.

Vấn đề còn lại: không có giới hạn chức năng đã biết trong phạm vi yêu cầu. Secure build vẫn in cảnh báo Vite về hai URL font tuyệt đối, nhưng cả hai asset WOFF2 tồn tại trong `views/vendor/fonts` và giao diện trình duyệt hiển thị tiếng Việt đúng; đây không phải lỗi font hay lỗi mã hóa của ứng dụng.
