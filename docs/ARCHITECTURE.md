# Kiến trúc BiddingFlow 1.0

## Ranh giới hệ thống

- Frontend là ES module, lưu hàng đợi mutation theo workspace trong IndexedDB và chỉ giao tiếp qua API dùng cookie phiên HttpOnly cùng CSRF token.
- Backend Starlette là nơi quyết định authorization, field-lock, transition trạng thái, tính tổng tiền và transaction đồng bộ.
- SQLite là nguồn dữ liệu chuẩn. Mỗi kết nối bật foreign key, WAL/busy timeout; production chỉ cho một tiến trình ghi.
- Worker tài liệu chạy trong subprocess có timeout, quota đồng thời, giới hạn CPU/memory/output và thư mục tạm riêng.

## Mô hình dữ liệu

- `organization_id` là khóa workspace vật lý. Mọi FK nghiệp vụ giữa bảng có tenant đều là FK ghép với `organization_id`.
- Thực thể có phiên bản dùng `id_goc`, `phien_ban`, `is_latest`; FK pháp lý giữ ID phiên bản cụ thể, không tự động đổi sang bản mới nhất.
- `row_version` dùng cho optimistic locking; `sync_version` là cursor thay đổi cấp workspace; `client_mutation_id` đảm bảo replay idempotent.
- Ngày nghiệp vụ lưu `YYYY-MM-DD`. Timestamp kỹ thuật lưu UTC `YYYY-MM-DD HH:mm:ss`. Giờ đóng/mở thầu là wall-clock nghiệp vụ và không tự dịch múi giờ.
- Tiền lưu INTEGER VND và trả ra JSON dạng chuỗi thập phân để không mất chính xác trong JavaScript.
- Dữ liệu đánh giá chuẩn nằm ở `vong_danh_gia`, `tieu_chi_danh_gia`, `ket_qua_danh_gia_nha_thau`.
- Registry `nha_thau_tham_du_mo_thau` cưỡng chế một nhà thầu logic trong một `(gói, phạm vi lô)` kể cả khi dùng phiên bản hoặc liên danh khác.

## API và lỗi

- Payload dùng camelCase; database dùng snake_case. Schema contract sinh/kiểm tra mapping và backend từ chối trường lạ.
- Lỗi chuẩn có `code`, `message`, `fields`, `requestId`; header phản hồi có `X-Request-ID`.
- Update child-list chỉ mang ý nghĩa thay toàn bộ khi contract của trường child tương ứng có mặt trong payload.

## Quy tắc versioning

- Thay đổi thông tin pháp lý sau khi gói đã phát hành phải tạo phiên bản mới.
- Quan hệ lịch sử (hồ sơ mở thầu, hợp đồng, kết quả) giữ ID phiên bản đã dùng tại thời điểm nghiệp vụ.
- Danh sách hiện hành resolve theo `id_goc` và `is_latest`; không sửa FK lịch sử khi có phiên bản mới.
- Migration `m0001_clean_baseline` là baseline 1.0. Sau khi phát hành, mọi đổi schema phải là migration tăng dần, không sửa migration đã chạy production.

