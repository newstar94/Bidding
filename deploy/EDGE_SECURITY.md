# Chính sách lớp biên BiddingFlow

## Luồng bắt buộc

```text
Internet → CDN/WAF/DDoS protection → Nginx :443 → Uvicorn 127.0.0.1:8000
                                      └────→ static /dist/assets/
PostgreSQL, Prometheus, SSH/admin → private network hoặc VPN
```

Origin không được nhận traffic Internet trực tiếp. Chỉ cho phép TCP 443 từ dải
IP của nhà cung cấp WAF/CDN (hoặc dùng authenticated origin pull/mTLS), SSH từ
VPN/bastion và traffic loopback. Không mở 8000, 5432, 9090 hay endpoint quản
trị ra public. Port 80 chỉ phục vụ redirect HTTPS qua Nginx.

## Managed rules

Bật ở chế độ log trên staging, xử lý false positive, sau đó chuyển sang block:

1. OWASP Core Rule Set ở mức bảo vệ tiêu chuẩn, gồm SQLi, XSS, path traversal,
   protocol anomaly, request smuggling và file inclusion.
2. Managed bot protection và challenge cho automation không xác thực.
3. Credential-stuffing/leaked-credential protection cho
   `/api/auth/login` và `/api/auth/google-login`.
4. DDoS L3/L4/L7 tự động; không đặt bypass theo User-Agent.
5. Chặn method ngoài allowlist và request có Host/SNI không đúng hostname
   production.

Không tắt rule toàn site để sửa false positive. Exception phải giới hạn đúng
path, method, content type và có ngày hết hạn. Với upload OOXML, WAF chỉ kiểm
tra kích thước/content type; archive validation vẫn do document sandbox thực
hiện.

## Rate và giới hạn

Nginx mẫu đã tách zone theo login, OTP/reset, Google, lookup, sync, upload,
export, WebSocket và API chung. WAF áp dụng lớp ngoài với ngưỡng không thấp hơn
Nginx để hấp thụ bot trước origin. Khóa theo IP, và với login/OTP bổ sung rule
theo account identifier đã chuẩn hóa nếu nhà cung cấp hỗ trợ mà không ghi log
plaintext.

- Header tối đa: 4 buffer × 8 KiB; header timeout 15 giây.
- Body mặc định: 1 MiB; sync 10 MiB; upload/import 11 MiB.
- WebSocket: chỉ `/ws/`, kiểm tra Origin, giới hạn handshake và connection/IP.
- Không cache `/api/**`, `/ws/**`, cookie hoặc HTML cá nhân hóa.

## Kiểm tra trước mở traffic

1. `nginx -t` đạt và Nginx chạy với `--no-proxy-headers` ở Uvicorn.
2. IP origin không truy cập được từ Internet khi bỏ qua CDN/WAF.
3. Host giả, HTTP trực tiếp tới default vhost và SNI sai bị 444.
4. Rule SQLi/XSS thử nghiệm bị WAF chặn; request hợp lệ và upload mẫu vẫn đạt.
5. Burst login/OTP/sync/export nhận 429 có kiểm soát, không làm tăng 5xx.
6. `/metrics`, PostgreSQL và SSH chỉ truy cập được từ allowlist private/VPN.
7. Log WAF không lưu password, OTP, token, Google credential, cookie hoặc body
   upload.

Lưu export cấu hình WAF, firewall rule set, ảnh chụp kiểm thử và người phê
duyệt vào hồ sơ release. Đây là bằng chứng bắt buộc cho release gate; file mẫu
trong repository không thay thế việc xác nhận trên hạ tầng thật.
