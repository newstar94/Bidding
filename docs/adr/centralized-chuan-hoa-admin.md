# ADR: Quản trị Chuẩn Hóa tập trung tại Bidding

## Quyết định

Người quản trị chỉ dùng dashboard và tên miền Bidding. Chuẩn Hóa giữ tài khoản,
database, billing và entitlement riêng; Bidding gọi backend Chuẩn Hóa qua kết nối
server-to-server đã ký. Không còn bước ánh xạ Super Admin hoặc nút “Kết nối” thủ công.

Mỗi request quản trị vẫn bắt buộc xác thực session `super_admin` tại Bidding và
được audit. Chuẩn Hóa vẫn xác thực client, timestamp, nonce và chữ ký HMAC.

## Tương thích

Các biến mapping cũ được bỏ khỏi luồng thực thi; dữ liệu mapping cũ không bị xóa.
Local Development tự dùng loopback và bootstrap secret dùng chung. Production vẫn
bắt HTTPS và secret được cấp qua secret store/KMS/HSM.

## Điều hướng

Các route quản trị của Chuẩn Hóa chuyển hướng đến `ChuanHoa__AdminDashboardUrl`,
mặc định là dashboard Bidding production. Người dùng không cần biết cổng nội bộ.

## Kiểm thử hồi quy

- Super Admin Bidding được gọi capabilities mà không cần mapping.
- Workspace/user không phải Super Admin vẫn bị từ chối.
- Mutation vẫn re-check session trước khi dispatch và giữ idempotency.
