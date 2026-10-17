# ADR 0088: Thông tin nguồn chỉ lưu phía server

- Trạng thái: Chấp thuận bởi chủ sản phẩm ngày 2026-10-17.
- Thay thế giới hạn presentation-only của ADR 0026.

## Business contract

Không gửi tên/URL/metadata nhận diện nhà cung cấp dữ liệu tự động xuống mã frontend
hoặc API người dùng. Giữ nguồn gốc đầy đủ trong database, cache nội bộ, connector và
audit. Không thay đổi tenant, role, assignment, entitlement, quyền đọc/xuất Word,
CCCD, ngân hàng, chữ ký, con dấu hoặc nội dung nghiệp vụ của bản ghi.

Tên nguồn xuất hiện trong nội dung nghiệp vụ do người dùng nhập (ví dụ tên công ty,
tên gói thầu) không được tìm/thay toàn cục. Không cam kết ngăn suy luận từ dữ liệu,
hoặc thu hồi mã/dữ liệu đã tải xuống trước khi triển khai.

## Wire compatibility

API JSON được chiếu sang nhãn nguồn trung tính tại ranh giới HTTP, sau khi kiểm tra
quyền và xử lý nghiệp vụ. Không chỉnh trực tiếp cache, response idempotency hoặc
đối tượng dùng để lưu. Metadata URL trỏ tới nguồn và endpoint của raw envelope không
được phát hành; payload nghiệp vụ trong raw response vẫn giữ nguyên.

- `MUASAMCONG` -> `AUTOMATIC_DATA`; `MUASAMCONG_BROWSER` -> `AUTOMATIC_BROWSER`.
- `muasamcong`/`MuaSamCong` -> `automatic`.
- `VNEPS` -> `EXTERNAL_DATA`; fixture dùng alias riêng.
- Mã tiêu chí `MSC_*` và ID `evaluation-criterion:*:MSC_*` dùng `AUTO_*` trên wire.
- Backend giải mã alias trước validation hiện hữu; client cũ vẫn gửi được mã cũ.
- Hàm/selector frontend đổi đồng bộ; không duy trì alias có tên nhà cung cấp trong JS.
- Mã trạng thái, số phiên bản, ID phiên nhập, phân quyền và trạng thái commit giữ nguyên.

## Migration và rollout

Không migration database. Triển khai backend và frontend cùng bản phát hành; backend
vẫn nhận wire cũ. Trước nâng cấp client có dữ liệu offline, hoàn tất đồng bộ và lấy
lại snapshot từ server; không tự xóa IndexedDB/outbox/draft. Bundle/cache đã tải từ
bản cũ không thể bị thu hồi chỉ bằng thay đổi server. Build không phát hành lại bundle
tương thích cũ còn chứa tên nguồn; tab đang dùng những bundle này cần tải lại sau
khi bảo toàn draft/outbox. Các bundle tương thích không lộ nguồn vẫn được giữ.

Rollback bằng cách triển khai lại đồng bộ backend/frontend trước đó. Dữ liệu nội bộ
vẫn dùng provider và mã tiêu chí cũ nên không cần sửa dữ liệu.

## Regression seams

- Quét frontend/template và bundle build để bắt tên nguồn còn sót.
- API thành công/lỗi, catalog, raw envelope và response JSON phân mảnh.
- Alias public -> internal cho tiêu chí/ID/provider; không biến đổi business data.
- Import kế hoạch/gói thầu/mở thầu, đánh giá chi tiết và validation request hiện hữu.
- HTTP framing, HEAD/204/304, binary/SSE và metadata lưu nội bộ không thay đổi.
