# Runbook: DDoS, bot abuse và Turnstile

## Tín hiệu kích hoạt

- WAF/CDN báo DDoS, Managed Challenge hoặc block tăng mạnh.
- `biddingflow_http_rate_limited_total` tăng bất thường.
- `biddingflow_http_requests_total{status="503"}` hoặc queue-full tăng.
- `biddingflow_turnstile_validations_total` có `invalid`/`unavailable` tăng.
- Origin bandwidth, connection count, CPU hoặc DB pool vượt baseline.

## Kiểm tra ban đầu

1. Xác nhận sự cố từ ít nhất hai nguồn: edge analytics và origin metrics/log.
2. Kiểm tra origin có còn chỉ nhận traffic từ tunnel/proxy tin cậy hay không.
3. Phân loại traffic theo endpoint, method, quốc gia/ASN, bot score và response code; không ghi hoặc xuất session/CAPTCHA token.
4. Kiểm tra người dùng hợp lệ có bị ảnh hưởng trên login, register, forgot password và resend OTP.
5. Kiểm tra `health/ready`, DB queue, document queue và event-loop lag.

## Ứng phó

### Volumetric hoặc HTTP flood

1. Giữ origin khóa kín; không mở port `8000`/`8080` trực tiếp.
2. Bật/chuyển Managed DDoS và WAF rule phù hợp từ log sang challenge/block.
3. Hạ rate limit tại edge cho đúng endpoint bị tấn công; ưu tiên path/method chính xác.
4. Tăng capacity chỉ sau khi xác nhận edge đang lọc; không chỉ tăng DB pool.

### Credential stuffing hoặc OTP abuse

1. Bật Managed Challenge cho request vượt baseline ở endpoint auth bị ảnh hưởng.
2. Giữ application rate limit và adaptive Turnstile; không tắt một lớp để thay bằng lớp khác.
3. Theo dõi response `401/403/429`, email outbox và tỷ lệ Turnstile invalid.
4. Nếu cần, block fingerprint/ASN/IP có bằng chứng tại edge; không thêm allowlist rộng.

### Siteverify gián đoạn

1. Xác nhận `outcome="unavailable"`, latency và trạng thái Cloudflare.
2. Register, forgot password và resend OTP tiếp tục fail closed với thông báo thử lại.
3. Login chỉ fail closed cho request đã đến ngưỡng adaptive challenge.
4. Không chuyển secret xuống frontend và không bỏ server-side validation.

## Rollback false positive

1. Chuyển rule edge mới nhất về log/Managed Challenge trước khi xóa.
2. Thu hẹp rule theo hostname, path và method; kiểm tra verified bots/monitoring allowlist.
3. Nếu cần rollback Turnstile, đặt `TURNSTILE_ENABLED=false` và restart cùng artifact; application rate limit vẫn phải bật.
4. Không mở origin ra Internet trong quá trình rollback.

## Xác nhận phục hồi

- WAF traffic và origin request rate trở về gần baseline.
- `429`, `503`, queue-full và event-loop lag giảm ổn định.
- Smoke test login, register, forgot password, resend OTP và WebSocket đạt.
- Ghi timeline, rule đã thay đổi, phạm vi ảnh hưởng và hành động phòng ngừa tái diễn.

## Diễn tập overload trước rollout

1. Chỉ chạy trên staging cô lập hoặc trong cửa sổ bảo trì đã phê duyệt; thông
   báo owner hạ tầng và giám sát trước khi bắt đầu.
2. Chạy `scripts/check_security_deployment.py` và các native config checks trước.
3. Từ host, gửi burst qua `http://127.0.0.1:8080`, không gọi thẳng Uvicorn
   `127.0.0.1:8000` để NGINX limits nằm trong bài test.
4. Tăng tải theo từng nấc; lưu concurrency, request count, p50/p95/p99, phân bố
   status, CPU/RAM, DB pool, queue depth và event-loop lag ở mỗi nấc.
5. Ở nấc xác nhận cuối, dùng `scripts/verify_overload_recovery.py` với cờ
   `--require-shedding`; yêu cầu thấy `429/503` có kiểm soát và ba readiness
   `2xx` liên tiếp sau burst mà không restart dịch vụ.
6. Dừng ngay nếu readiness không phục hồi, DB pool cạn, queue tăng không giảm
   hoặc error rate tiếp tục tăng sau khi ngừng burst. Giữ artifact/log để điều
   tra rồi hạ ngưỡng/concurrency trước lần chạy lại.
