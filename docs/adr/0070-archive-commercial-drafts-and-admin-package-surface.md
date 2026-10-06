# ADR 0070 — Lưu trữ bản nháp thương mại và bề mặt quản lý gói

- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm ngày 2026-10-06.
- Phạm vi: danh sách bản nháp thương mại và trải nghiệm quản lý gói trên desktop admin.

## Business contract

1. “Bỏ bản nháp” là lưu trữ mềm (`status = 'archived'`), không xóa vật lý. Bản nháp đã lưu trữ không xuất hiện trong danh sách đang mở và không thể được xuất bản.
2. Thao tác yêu cầu phiên `super_admin`, kiểm tra revision, CSRF, idempotency key, audit bắt buộc và outbox trong cùng transaction. Bản phát hành, snapshot, đơn hàng và thuê bao không bị thay đổi.
3. Admin phải xác nhận trước khi bỏ bản nháp. Nếu bản nháp đang mở có thay đổi chưa lưu, thông báo phải nêu rõ các thay đổi đó sẽ không được tiếp tục; hủy xác nhận giữ nguyên biểu mẫu.
4. Bề mặt chính hiển thị nhóm Cơ bản/Nâng cao, chuyển Bảng quản lý/Thẻ trực quan và giá Hàng tháng/Hàng năm ở vị trí dễ so sánh, căn giữa trong thẻ. Không thay đổi cơ cấu tier, quyền hoặc dữ liệu được phép xem.

## Compatibility impact

- Thêm `DELETE /api/commercial/drafts/{draft_id}` với `expectedRevision`; dữ liệu cũ vẫn đọc được và không cần migration schema.
- `commercial_drafts` giữ toàn bộ document và lịch sử revision; `list_drafts` tiếp tục loại bản ghi `archived`.
- UI chỉ thay đổi cách điều hướng và hành động của admin; catalog công khai, các release bất biến và quyền đọc hiện hữu giữ nguyên.

## Migration and rollback

Không có migration DB. Backend có thể triển khai trước frontend; nếu rollback UI, các bản nháp đã lưu trữ vẫn còn trong kho lịch sử và không bị khôi phục tự động.

## Regression seams

- Session không đủ quyền bị từ chối và không ghi mutation.
- Missing draft trả `404`; revision cũ trả `409`; lỗi audit/outbox rollback transaction.
- Hủy xác nhận không gửi `DELETE`; xác nhận làm mới overview và loại dòng đã lưu trữ.
- Bảng/thẻ dùng cùng offer data; kỳ tháng/năm độc lập và không suy giá.
