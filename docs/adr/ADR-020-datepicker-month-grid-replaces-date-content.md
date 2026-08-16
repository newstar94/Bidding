# ADR-020: Bảng chọn tháng thay thế vùng ngày trong datepicker

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu bảng tháng thay thế phần ngày và tự trả lại lịch ngày sau khi chọn

## Bối cảnh và quyết định

Datepicker tùy biến có bảng chọn tháng được chèn sau vùng ngày và giờ. Việc ẩn các vùng cũ phụ thuộc vào lớp CSS sinh ở runtime với độ ưu tiên thông thường. Khi trạng thái hiển thị hoặc stylesheet không đồng bộ, bảng tháng có thể nối xuống cuối popup, làm popup cao bất thường.

Quy tắc mới:

- Bảng chọn tháng được đặt ngay trước vùng lịch ngày trong cấu trúc popup.
- Khi mở chọn tháng hoặc năm, popup có trạng thái `flatpickr-grid-open`; vùng ngày và vùng giờ bị ẩn với mức ưu tiên đủ để không bị CSS Flatpickr ghi đè.
- Header tháng/năm và footer Hủy/Xác nhận vẫn giữ nguyên; chỉ nội dung trung tâm được thay thế.
- Sau khi chọn tháng hoặc năm, bảng lựa chọn đóng, vùng ngày và giờ được khôi phục và lịch hiển thị đúng tháng/năm vừa chọn.
- Đóng datepicker cũng luôn xóa trạng thái bảng lựa chọn.

## Tác động tương thích

- Áp dụng thống nhất cho trường ngày và trường ngày giờ đang dùng Flatpickr.
- Không thay đổi định dạng ngày, giá trị biểu mẫu, sự kiện xác nhận hoặc luồng lưu dữ liệu.
- Không thay đổi API, schema, role, permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Thay đổi có hiệu lực sau khi frontend mới được build và triển khai.

## Regression tests

- `tests/js/flatpickr_footer_layout.test.mjs` chạy Flatpickr và `BiddingView` thật trong trình duyệt headless.
- Test xác nhận vùng ngày và giờ bị ẩn, bảng tháng nằm tại vị trí vùng ngày, chọn tháng tự khôi phục lịch ngày và header chuyển sang đúng tháng đã chọn.
- Test footer hiện có tiếp tục xác nhận hai nút Hủy/Xác nhận giữ kích thước cân bằng.
