# Runbook: DDoS và bot abuse

## Volumetric

1. Xác nhận spike theo zone, hostname, status code và vùng địa lý.
2. Giữ origin private; kiểm tra Tunnel health và không mở direct-IP fallback.
3. Bật/siết WAF và rate limit theo change ticket, ghi rõ thời điểm bắt đầu.
4. Theo dõi latency, 5xx, queue và database pool; rollback rule khi traffic trở lại baseline.

## Credential stuffing

1. Đối chiếu `biddingflow_http_rate_limited_total` với login failures và Turnstile decisions.
2. Giữ thông báo lỗi không phân biệt sự tồn tại tài khoản.
3. Tạm thời tăng challenge/rate limit cho login, register, forgot-password và resend-code.
4. Thu hồi session đáng ngờ, không ghi password/OTP/token vào log.

## Siteverify

1. Kiểm tra DNS/TLS và timeout tới Cloudflare siteverify.
2. Phân biệt `BOT_CHALLENGE_REQUIRED`, `BOT_CHALLENGE_INVALID` và unavailable.
3. Nếu upstream unavailable, dùng hành vi fail-closed đã được phê duyệt; theo dõi response `status="503"`.
4. Không bypass challenge bằng header tùy ý trong production.

## False positive

1. Thu thập request id, hostname, browser và thời điểm; không thu thập secret.
2. So sánh rule/WAF/Turnstile với baseline và kiểm tra allowlist exact hostname.
3. Nới rule tối thiểu theo thời hạn, ghi owner và điều kiện rollback.
4. Chạy lại smoke login, register, forgot-password và WebSocket sau khi xử lý.

## Kết thúc sự cố

- Lưu timeline, dashboard snapshot, rule change và kết quả rollback.
- Tạo follow-up cho observability, test regression và xác nhận lại budget.
