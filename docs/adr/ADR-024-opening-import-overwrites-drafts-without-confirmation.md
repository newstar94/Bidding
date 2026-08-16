# ADR-024: Nhập mở thầu từ Mua sắm công luôn ghi đè bản nháp

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu bỏ modal xác nhận khi lấy dữ liệu mở thầu từ Mua sắm công

## Bối cảnh

Lấy dữ liệu mở thầu từ Mua sắm công từng hiển thị modal để người dùng chọn gộp
hoặc ghi đè bản nháp, kể cả khi bản nháp chưa có dữ liệu. Thao tác này là một lần
làm mới dữ liệu nguồn, nên modal tạo thêm bước không cần thiết.

## Quyết định

- Cả luồng nhập biên bản mở thầu và luồng nhập mở E-HSĐXTC từ Mua sắm công luôn
  áp dụng dữ liệu nguồn với chế độ `OVERWRITE`.
- Không hiển thị modal hỏi gộp/ghi đè hoặc modal xác nhận áp dụng bản nháp.
- Không hiển thị chú thích cạnh nút nhập; các nút thao tác mở thầu luôn nằm trên
  một hàng và cuộn ngang trong nhóm khi không đủ không gian.
- Vẫn giữ kiểm tra preview, phiên bản gói, workspace và xử lý lỗi hiện có trước
  khi ghi đè dữ liệu trên màn hình.
- Thao tác chỉ thay thế bản nháp đang hiển thị; không tự động lưu dữ liệu vào bản
  ghi chính thức.

## Tác động tương thích

- Mọi giá trị chưa lưu của bản nháp mở thầu, gồm giá dự thầu, tỷ lệ giảm và thời
  gian mở thầu, bị thay bằng dữ liệu nguồn khi người dùng bấm lấy dữ liệu.
- Không thay đổi role, module permission, entitlement, tenant isolation,
  assignment scope, record scope, masking hoặc dữ liệu mà người dùng được phép xem.

## Migration strategy

Không cần migration schema hay dữ liệu. Sau khi triển khai, lần lấy dữ liệu mở
thầu tiếp theo sẽ áp dụng quy tắc ghi đè mới; dữ liệu đã lưu không bị viết lại.

## Regression tests

- `tests/js/procurement_import_wizard.test.mjs` kiểm tra không còn gọi modal xác
  nhận và luồng nhập mở thầu truyền chế độ `OVERWRITE`.
- `tests/js/opening_save_regressions.test.mjs` kiểm tra các quy tắc lưu biên bản
  mở thầu hiện có vẫn hoạt động.
