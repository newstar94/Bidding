# ADR-023: Dòng biên bản mở thầu theo cặp nhà thầu–phần lô

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu sửa biên bản mở thầu `IB2600212155`

## Bối cảnh

Payload mở thầu của gói phân lô có thể đồng thời chứa:

- danh sách nhà thầu tổng hợp ở cấp gói;
- danh sách dự thầu chi tiết theo từng phần lô.

Nếu materialize cả hai nhóm, một trường hợp có 8 nhà thầu và 12 cặp nhà
thầu–phần lô tạo thành 20 dòng. Các dòng tổng hợp không có mã phần lô cũng làm
ô tên phần lô bị trống và không đại diện cho một dòng biên bản độc lập.

## Quyết định

- Với gói phân lô, đơn vị dòng của biên bản mở thầu là một cặp
  `nhà thầu + phần lô`.
- Khi một pha mở thầu đã có ít nhất một dòng theo phần lô, các dòng nhà thầu tổng
  hợp không có mã phần lô trong cùng pha chỉ là dữ liệu tóm tắt và không được
  materialize thành dòng biên bản.
- Nếu pha đó chưa có dữ liệu chi tiết theo phần lô, dòng tổng hợp vẫn được giữ làm
  fallback để không làm mất toàn bộ dữ liệu khi endpoint phần lô chưa trả kết quả.
- Mỗi bidder canonical theo phần lô mang cả `lotNo` và `lotName`. Mapper frontend
  chuyển thành `maPhanLo` và `tenPhanLo`; khi dựng dòng, dropdown mã phần lô đồng
  bộ ngay tên phần lô mà không đợi người dùng đổi lựa chọn.
- Vì vậy 8 nhà thầu tham dự 12 phần lô tạo 12 dòng dự thầu, không phải 8 hoặc 20
  dòng.
- Preview đếm “nhà thầu” theo định danh nhà thầu/liên danh duy nhất, không theo số
  dòng dự thầu. Với gói phân lô, preview hiển thị riêng số nhà thầu, số phần lô và
  số dòng dự thầu.
- Dropdown mã phần lô tự cấp chiều rộng theo toàn bộ mã đang chọn, gồm phần đệm
  cho nút mở dropdown; không cắt mã bằng dấu ba chấm.

## Tác động tương thích

- Lần lấy dữ liệu mở thầu mới không còn tạo các dòng tổng hợp thừa cho gói phân lô.
- Bản nháp đã tạo trước thay đổi không bị tự động sửa hoặc xóa. Người dùng có thể
  lấy lại dữ liệu và chọn “Ghi đè toàn bộ draft” để thay thế bằng projection mới.
- Raw snapshot vẫn giữ đầy đủ payload nguồn; chỉ projection canonical/UI thay đổi.
- Không thay đổi role, module permission, capability, entitlement, tenant
  isolation, assignment scope, record scope, masking hoặc dữ liệu người dùng được
  phép xem.

## Migration strategy

Không cần migration schema. Không tự động viết lại biên bản đã lưu. Dữ liệu chưa
lưu được làm sạch bằng thao tác lấy lại và ghi đè; dữ liệu đã lưu chỉ thay đổi khi
người dùng chủ động mở chỉnh sửa và lưu theo quy trình hiện hành.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_ib2600212155_opening_keeps_only_lot_bids_and_attaches_lot_names`
- `tests/test_muasamcong_integration_source.py::test_complete_notice_bundle_maps_opening_result_and_contract_sources`
- `tests/js/procurement_import_wizard.test.mjs` kiểm tra ánh xạ đồng thời mã và tên
  phần lô.
- `tests/js/opening_save_regressions.test.mjs` kiểm tra mã phần lô dài nhận đủ
  chiều rộng hiển thị.
