# ADR 0026: Hiển thị trung tính cho chức năng lấy dữ liệu tự động

- Trạng thái: Chấp thuận
- Ngày: 2026-08-30

## Bối cảnh

Chủ sản phẩm yêu cầu mọi nội dung người dùng nhìn thấy liên quan đến chức năng lấy dữ
liệu từ Mua Sắm Công chỉ mô tả chung là lấy dữ liệu tự động, không nêu tên nguồn dữ
liệu cụ thể.

## Quyết định và business contract

- Nút thao tác, trạng thái tải, modal, thông báo thành công/lỗi, hộp xác nhận phiên bản,
  quota và nội dung trợ giúp/pháp lý dùng cách gọi trung tính “lấy dữ liệu tự động”.
- Thông báo lỗi upstream được chuẩn hóa tại lớp presentation trước khi đưa lên giao diện
  để tên hoặc hostname của nguồn không xuất hiện ngoài ý muốn.
- Tên module, hàm, biến, selector, provider, provenance, API, route và cấu hình tích hợp
  nội bộ tiếp tục giữ nguyên để bảo toàn tương thích và khả năng audit.
- Không thay đổi backend, thuật toán lấy/ánh xạ dữ liệu, entitlement, role, module
  permission, tenant isolation, assignment scope hoặc record-level authorization.

## Compatibility impact

Chỉ copy và định dạng thông báo trên giao diện thay đổi. Request/response contract,
dữ liệu lưu, source provenance, luồng import/export và quyền người dùng không thay đổi.

## Migration và rollback

Không có schema hay data migration. Rollback bằng cách hoàn nguyên copy giao diện và
lớp presentation; không cần thay đổi dữ liệu hoặc cấu hình backend.

## Regression seams

- Kiểm tra các action và trạng thái nhập kế hoạch, gói thầu, mở thầu dùng nhãn trung tính.
- Kiểm tra lớp presentation thay tên/hostname upstream nhưng giữ phần thông tin lỗi hữu ích.
- Chạy toàn bộ JavaScript tests, static checks và secure production build.
