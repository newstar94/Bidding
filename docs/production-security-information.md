# Biểu mẫu thông tin bảo mật triển khai production

Tài liệu này dùng để thu thập các thông tin cần thiết trước khi cấu hình môi trường production cho BiddingFlow. Chỉ ghi tên tài nguyên, định danh, phạm vi mạng và trạng thái xác nhận.

> **Không điền giá trị** mật khẩu, private key, API token, connection string đầy đủ hoặc secret vào tài liệu này. Secret phải được chuyển qua secret manager hoặc kênh bảo mật đã được phê duyệt.

## Domain và môi trường

- Domain production:
- Domain dự phòng hoặc maintenance:
- Tên môi trường và mã hệ thống:
- URL public dự kiến cho `APP_PUBLIC_URL`:
- Host được phép cho `ALLOWED_HOSTS`:
- Origin được phép cho CORS và WebSocket:
- Múi giờ vận hành:
- Người xác nhận DNS và thời điểm xác nhận:

## Hạ tầng máy chủ

- Nhà cung cấp, region và availability zone:
- Hệ điều hành và phiên bản:
- CPU, RAM và dung lượng đĩa:
- Số tiến trình ứng dụng `APP_INSTANCE_COUNT`:
- Số Uvicorn worker cho mỗi instance:
- Reverse proxy/load balancer và địa chỉ private:
- CIDR của proxy tin cậy:
- Cổng firewall được mở và nguồn được phép:
- Cơ chế cập nhật bản vá, EDR và giám sát máy chủ:

## PostgreSQL

- Dịch vụ PostgreSQL, phiên bản và region:
- Host private, port và tên database (không ghi credential):
- Runtime role, migrator role, backup role và document-worker role:
- Kết quả `SHOW max_connections`:
- Giới hạn pool dự kiến của mỗi instance:
- Cơ chế TLS và xác minh chứng thư:
- Chính sách backup, PITR, retention và mã hóa:
- Cửa sổ migration và người phê duyệt:

## Cloudflare zone và Tunnel

- Cloudflare account và zone:
- Zone ID:
- Tunnel UUID:
- Tên Tunnel và connector host:
- Public hostname và origin service:
- Chính sách Access hoặc service token nếu có:
- Trạng thái DNS proxy và TLS mode:
- Người quản lý Cloudflare và kênh liên hệ sự cố:

## Cloudflare Turnstile

- Widget name và hostname được phép:
- Chế độ widget:
- Biến public `TURNSTILE_SITE_KEY`: lưu trong cấu hình public của môi trường, không ghi giá trị tại đây.
- Biến secret `TURNSTILE_SECRET_KEY`: lưu trong secret manager, không ghi giá trị tại đây.
- Ngưỡng kích hoạt cho đăng nhập, đăng ký và quên mật khẩu:
- Quy trình xoay vòng key và người chịu trách nhiệm:

## Baseline, WAF và cảnh báo

- Bộ managed rules và custom WAF rules được bật:
- Rate limit theo đường dẫn nhạy cảm:
- Bot/challenge policy:
- Baseline lưu lượng bình thường:
- Ngưỡng cảnh báo 4xx, 5xx, latency và saturation:
- Kênh cảnh báo, lịch trực và escalation path:
- Dashboard/log source phục vụ điều tra:

## Ứng dụng, email và tài khoản khởi tạo

- Mã phiên bản/release được triển khai:
- SMTP host, port và security mode (không ghi credential):
- Địa chỉ người gửi và domain đã xác minh:
- Google OAuth client ID public; client secret lưu trong secret manager:
- Username Super Admin khởi tạo:
- Email và người sở hữu Super Admin:
- IP allowlist áp dụng cho Super Admin:
- Quy trình bàn giao và đổi mật khẩu ngay sau bootstrap:

## Lưu trữ, audit, restore và document worker

- Vị trí object/shared storage và region:
- Mã hóa dữ liệu at rest và key owner:
- Vị trí audit checkpoint ngoài máy chủ ứng dụng:
- Retention và quyền truy cập audit log:
- Lịch restore drill và RPO/RTO mục tiêu:
- Service account của document worker:
- Shared storage giữa web và document worker:
- Sandbox/container policy của document worker:
- Người xác nhận restore gần nhất và bằng chứng:

## Secret và xác nhận vận hành

- Secret manager được sử dụng:
- Danh sách tên secret cần cấp, không ghi giá trị:
- Chủ sở hữu và lịch xoay vòng từng nhóm secret:
- Thời điểm xác nhận xoay vòng gần nhất:
- Xác nhận database chỉ đi qua private network:
- Xác nhận mã hóa dữ liệu at rest:
- Xác nhận audit checkpoint được lưu off-host:
- Xác nhận document worker dùng service account riêng:
- Xác nhận document worker và web dùng shared storage đã kiểm soát:
- Người phê duyệt production readiness:
- Ngày phê duyệt và liên kết ticket/change request:
