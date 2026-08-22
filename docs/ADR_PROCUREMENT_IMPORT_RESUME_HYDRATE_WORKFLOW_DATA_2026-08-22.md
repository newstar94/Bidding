# ADR: Hydrate dữ liệu workflow trước khi tiếp tục phiên nhập Mua Sắm Công

Ngày: 2026-08-22
Trạng thái: Đã chấp thuận bởi chủ sản phẩm

## Quyết định

Sau khi reload, trước khi materialize một phiên nhập Mua Sắm Công đang dở, ứng dụng
phải chờ boundary dữ liệu của form chỉnh sửa tương ứng:

- Kế hoạch: `ensureWorkflowReady("editKeHoach")`.
- Gói thầu: `ensureWorkflowReady("editGoiThau")`.

Việc hydrate phải hoàn tất trước khi hiển thị xác nhận tiếp tục và trước khi gọi
materialization. Nhờ đó resolver có đủ danh mục chủ đầu tư/nhà thầu và các bản ghi
liên quan để mở lại form sau F5. Thay đổi này không tự chọn lại định danh, không đổi
quyền, record scope hoặc dữ liệu được phép xem.

## Compatibility impact

- Hộp thoại tiếp tục nhập sau F5 có thể xuất hiện muộn hơn một chút trong lúc dữ liệu
  workflow được tải.
- Xác nhận tiếp tục không còn bị lỗi ngầm trước bước mở form do catalog chưa hydrate.
- Các phiên hết hạn hoặc bị từ chối vẫn giữ nguyên quy tắc hủy/clear hiện hành.

## Migration strategy

Không cần migration dữ liệu hoặc schema. Thay đổi chỉ điều chỉnh thứ tự khởi tạo client
cho các phiên resume mới.

## Regression coverage

- `tests/js/procurement_import_wizard.test.mjs`: resume kế hoạch phải gọi
  `ensureWorkflowReady("editKeHoach")` trước materialization và mở lại form thành công.

