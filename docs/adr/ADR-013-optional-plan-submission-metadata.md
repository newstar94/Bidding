# ADR-013: Thông tin tờ trình kế hoạch là không bắt buộc

## Trạng thái

Đã chấp thuận và triển khai.

## Quyết định

Các trường số và ngày tờ trình trong biểu mẫu kế hoạch được xem là thông tin bổ sung, không dùng làm điều kiện chặn lưu hoặc đồng bộ:

- tờ trình dự toán;
- tờ trình kế hoạch;
- tờ trình dự toán và kế hoạch.

Các trường quyết định phê duyệt và ngày phê duyệt vẫn giữ quy tắc bắt buộc hiện hành.

## Tương thích và di chuyển

- Bản ghi cũ có dữ liệu tờ trình tiếp tục hiển thị và được giữ nguyên khi chỉnh sửa.
- Không đổi schema, role, permission, tenant isolation hoặc phạm vi dữ liệu.
- Không cần migration; payload thiếu các trường tờ trình vẫn hợp lệ từ phiên bản này.

## Kiểm thử hồi quy

- Backend xác nhận hai chế độ phê duyệt có thể đồng bộ khi bỏ trống số/ngày tờ trình.
- Modal xác nhận các input tờ trình không còn thuộc tính `required`.
- Các trường quyết định phê duyệt vẫn được kiểm tra bắt buộc.
