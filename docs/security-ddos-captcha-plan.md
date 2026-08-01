# Kế hoạch tăng cường bảo vệ DDoS và CAPTCHA

## 1. Mục tiêu

- Giảm khả năng origin, Uvicorn, PostgreSQL và document worker bị cạn tài nguyên khi có lưu lượng bất thường.
- Ngăn bot lạm dụng đăng ký, đăng nhập, quên mật khẩu và gửi OTP.
- Không làm CAPTCHA xuất hiện với mọi người dùng hoặc thay thế các rate limit hiện có.
- Có số liệu, cảnh báo và phương án rollback trước khi chuyển rule sang chế độ chặn.

## 2. Phạm vi và giả định

Kế hoạch áp dụng cho bản production public trên Internet. Cloudflare được chọn làm
cấu hình tham chiếu cho CDN/WAF, Tunnel và Turnstile. Mục tiêu là chuẩn bị theo
mô hình **domain-last**: cùng một artifact đã kiểm thử được dùng từ local đến
production; khi có hạ tầng thật chỉ điền định danh triển khai và secret, không
sửa logic ứng dụng.

### Cấu hình domain-last

Phần có thể chuẩn bị trước được lưu trong repository dưới dạng code và template.
Phần không được hard-code hoặc commit là domain thật, credential và ngưỡng rút ra
từ traffic production.

| Môi trường | Dùng ngay | Giá trị cần cung cấp |
| --- | --- | --- |
| Local | Test key Turnstile chính thức và hostname local | Không cần domain public |
| Staging | Cùng artifact và cùng code path production | Domain staging, widget/key riêng và tunnel credential |
| Production | Cùng artifact, NGINX/systemd/WAF/monitoring template | Domain production, Turnstile site/secret key, tunnel UUID/credential và ngưỡng theo baseline |

Các placeholder production phải giữ nguyên cho đến lúc có dữ liệu thật:

- `REPLACE_WITH_PRODUCTION_DOMAIN` trong cấu hình Cloudflare Tunnel.
- `REPLACE_WITH_TUNNEL_UUID` và file credential do Cloudflare cấp.
- `APP_PUBLIC_URL=https://<domain>` và allowed host/proxy tương ứng.
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` và
  `TURNSTILE_ALLOWED_HOSTNAMES=<domain>`.
- Ngưỡng WAF/rate-limit, số Uvicorn worker và connection budget sau baseline/load
  test.

Vì site/secret key và tunnel credential do tài khoản Cloudflare cấp, bước đưa
lên production không thể chỉ nhập mỗi domain theo nghĩa đen. Tuy nhiên, đây chỉ
là bước cấu hình environment/secret; không cần commit hoặc sửa code.

Ứng dụng hiện đã có:

- `BodySizeLimitMiddleware` giới hạn JSON, tài liệu và payload đồng bộ.
- Rate limit lưu trong PostgreSQL cho đăng nhập, OTP và một số API tốn tài nguyên.
- Hàng đợi hữu hạn cho database I/O, CPU I/O và document worker.
- Giới hạn WebSocket theo IP/người dùng cùng timeout xác thực.
- Kiểm soát trusted proxy, allowed host, CORS, CSRF và security headers.
- Uvicorn mặc định bind `127.0.0.1` và được thiết kế chạy sau reverse proxy.

Các biện pháp trên giúp chống lạm dụng và DoS ở tầng ứng dụng nhưng không thay thế lớp hấp thụ DDoS tại edge.

## 3. Kiến trúc mục tiêu

```text
Internet
   │
   ▼
CDN / Managed DDoS / WAF / Bot challenge
   │  Chỉ traffic đã lọc
   ▼
Firewall hoặc outbound-only tunnel
   │
   ▼
Reverse proxy: timeout, buffering, rate/connection limits
   │
   ▼
Uvicorn: concurrency/backlog/keep-alive limits
   │
   ├── Starlette: body limits, auth, CSRF, application rate limits
   ├── PostgreSQL: pool và statement timeout
   └── Document worker: queue và concurrency hữu hạn
```

## 4. Giai đoạn triển khai

### Giai đoạn 0 — Đo baseline và chốt hạ tầng

- [ ] Xác định CDN/WAF, reverse proxy, số instance và số Uvicorn worker production.
- [ ] Ghi nhận baseline tối thiểu 7 ngày: request/giây, burst p95/p99, tỷ lệ `401`, `403`, `429`, `503`, `5xx`, số kết nối WebSocket và băng thông download.
- [ ] Lập danh sách DNS có thể làm lộ origin IP, gồm cả bản ghi cũ, mail và subdomain.
- [ ] Xác nhận `/metrics`, health check và admin endpoint chỉ truy cập từ mạng riêng/VPN hoặc allowlist giám sát.
- [ ] Chọn owner vận hành rule, kênh cảnh báo và quy trình xử lý false positive.

**Tiêu chí hoàn thành:** có sơ đồ traffic production, baseline đã lưu và danh sách origin/proxy CIDR được phê duyệt.

### Giai đoạn 1 — Bảo vệ tại edge và khóa origin

- [ ] Bật proxy CDN và Managed DDoS Protection cho hostname public.
- [ ] Bật managed WAF rules ở chế độ log trước, sau đó chuyển sang block/challenge sau khi xử lý false positive.
- [ ] Chỉ cho phép CDN/reverse proxy kết nối đến origin bằng firewall, Authenticated Origin Pull hoặc outbound-only tunnel.
- [ ] Nếu origin IP từng công khai, đổi IP sau khi edge đã hoạt động.
- [ ] Đặt `TRUSTED_PROXY_CIDRS` đúng với peer trực tiếp; không dùng `0.0.0.0/0`, `::/0` hoặc `*`.
- [ ] Bật cache cho asset tĩnh; không cache API, session hoặc nội dung riêng tư.
- [ ] Tạo rate-limit rule tại edge cho các nhóm sau:
  - `/api/auth/login`, `/api/auth/register`.
  - `/api/auth/forgot-password`, `/api/auth/resend-code`, các endpoint verify/OTP.
  - API public, tra cứu mã số thuế và địa chỉ.
  - Export, download, ảnh được bảo vệ và upload tài liệu.
  - WebSocket handshake `/ws/sync`.
  - Burst tổng thể cho `/api/*`.
- [ ] Chạy rule theo thứ tự `log → managed challenge → block`; ngưỡng lấy từ baseline thay vì hard-code tùy ý.

**Tiêu chí hoàn thành:** truy cập trực tiếp origin bị từ chối; request hợp lệ qua CDN hoạt động; WAF event và rate-limit event xuất hiện trong dashboard/log.

### Giai đoạn 2 — Giới hạn reverse proxy và Uvicorn

- [x] Thêm cấu hình reverse proxy vào version control hoặc kho cấu hình hạ tầng.
- [x] Cấu hình timeout đọc header/body, send timeout, request buffering và giới hạn header/body.
- [x] Giới hạn request và kết nối theo client IP đã được khôi phục từ proxy tin cậy; không giới hạn nhầm theo IP của CDN.
- [x] Đặt giới hạn riêng cho upload/download, auth, public API và WebSocket.
- [ ] Khởi chạy Uvicorn bằng process manager với các giá trị đã load test:
  - `--workers`
  - `--limit-concurrency`
  - `--backlog`
  - `--timeout-keep-alive`
  - `--ws-max-size`
  - `--ws-max-queue`
- [ ] Đồng bộ `APP_INSTANCE_COUNT`, `UVICORN_WORKERS` và connection budget PostgreSQL với cấu hình chạy thực tế.
- [ ] Load test đến điểm bắt đầu trả `429/503` có kiểm soát; xác nhận máy chủ phục hồi mà không cần restart thủ công.

**Tiêu chí hoàn thành:** overload bị từ chối tại edge/proxy trước khi pool DB cạn; readiness vẫn phản hồi và hệ thống tự phục hồi sau bài test.

### Giai đoạn 3 — Tích hợp Cloudflare Turnstile

#### Nguyên tắc triển khai local-ready

- [x] Hoàn thiện toàn bộ backend, frontend, CSP, feature flag và test từ local; không để logic Turnstile phụ thuộc vào domain được hard-code.
- [x] Mọi môi trường dùng cùng một code path; chỉ khác giá trị cấu hình và credential.
- [x] Khi đưa lên production không sửa code: auto mode tự bật khi có widget,
  hostname và key production hợp lệ; thiếu cấu hình thì CAPTCHA giữ trạng thái tắt.
- [x] Tách riêng cấu hình local/test, staging và production để key hoặc hostname không bị dùng chéo.

#### Chính sách áp dụng

- [x] Khi Turnstile active, luôn yêu cầu Managed challenge cho:
  - `POST /api/auth/register`
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/resend-code`
- [x] Với `POST /api/auth/login`, chỉ yêu cầu sau 3–5 lần thất bại trong cửa sổ rate limit hoặc khi edge đánh dấu request đáng ngờ.
- [x] Có thể yêu cầu lại khi verify/OTP thất bại liên tiếp.
- [x] Không thêm CAPTCHA vào CRUD, export hoặc thao tác bình thường của phiên đã xác thực.

#### Backend

- [x] Tạo module xác minh Turnstile độc lập với timeout ngắn và response contract rõ ràng.
- [x] Thêm biến môi trường:
  - `TURNSTILE_ENABLED`
  - `TURNSTILE_SITE_KEY`
  - `TURNSTILE_SECRET_KEY`
  - `TURNSTILE_ALLOWED_HOSTNAMES`
  - `TURNSTILE_VERIFY_TIMEOUT_SECONDS`
  - `TURNSTILE_EDGE_CHALLENGE_HEADER`
  - `TURNSTILE_EDGE_CHALLENGE_VALUE`
- [x] Thêm toàn bộ tên biến và mô tả vào `.env.example`; không commit secret hoặc key production vào repository.
- [x] Cấu hình mặc định an toàn:
  - Local/test: dùng test key chính thức, `TURNSTILE_ALLOWED_HOSTNAMES=localhost,127.0.0.1`.
  - Staging: dùng widget/key riêng và chỉ allow hostname staging.
  - Production: `auto` giữ CAPTCHA tắt khi thiếu cấu hình; `true` từ chối
    khởi động nếu thiếu site key, secret key hoặc hostname hợp lệ.
- [x] Hỗ trợ `TURNSTILE_ENABLED=false`, `auto` và `true`: auto là tùy chọn,
  true là fail-closed; test bảo mật bao phủ cả ba chế độ.
- [x] Gửi token đến Siteverify từ backend; không đưa secret key xuống client.
- [x] Kiểm tra đồng thời `success`, `hostname` và `action` tương ứng như `register`, `login`, `forgot_password`, `resend_code`.
- [x] Giới hạn token tối đa 2.048 ký tự; không ghi token hoặc secret vào log.
- [x] Không tái sử dụng token: token Turnstile chỉ dùng một lần và hết hạn sau 5 phút.
- [x] Rate limit cả request xác minh để tránh biến Siteverify thành điểm bị flood.
- [x] Quy định fallback khi Siteverify lỗi:
  - Fail closed đối với đăng ký, quên mật khẩu và gửi OTP.
  - Với login, chỉ fail closed nếu request đã bị đánh dấu bắt buộc challenge; trả thông báo thử lại thân thiện.
- [x] Trả mã lỗi ổn định, ví dụ `BOT_CHALLENGE_REQUIRED`, `BOT_CHALLENGE_INVALID`, `BOT_CHALLENGE_UNAVAILABLE`.

#### Frontend và CSP

- [x] Dùng Turnstile chế độ `Managed`, ưu tiên render explicit để kiểm soát lifecycle trong SPA.
- [x] Chỉ tải script Turnstile khi feature flag bật và form hiện tại cần challenge.
- [x] Reset widget sau mỗi lần submit vì token chỉ dùng một lần.
- [x] Chỉ hiện challenge ở đúng form và khi backend/edge yêu cầu; giữ keyboard focus và thông báo accessible.
- [x] Cập nhật CSP tối thiểu cho domain Turnstile cần thiết, không nới lỏng bằng `unsafe-inline` hoặc wildcard.
- [x] Dùng sitekey riêng cho development/staging/production; production không allow `localhost`.
- [x] Cập nhật privacy notice nếu chính sách hoặc chế độ widget yêu cầu.

#### Kiểm thử

- [x] Unit test cho success, invalid token, sai hostname/action, timeout, duplicate và upstream lỗi.
- [x] Integration test xác nhận endpoint được bảo vệ không thể bypass bằng cách bỏ trường token.
- [x] E2E dùng test sitekey/secret chính thức: always-pass, always-fail và force-interactive.
- [x] E2E local không gọi widget/key production và không phụ thuộc domain public.
- [x] Kiểm tra CAPTCHA không xuất hiện ở lần login hợp lệ đầu tiên.
- [x] Kiểm tra người dùng dùng bàn phím, screen reader, mạng chậm và khi JavaScript challenge tải lỗi.

#### Checklist kích hoạt Turnstile production (tùy chọn) — không sửa code

- [ ] Sao chép template production và thay các placeholder domain/tunnel; không sửa artifact ứng dụng.
- [ ] Tạo Turnstile Managed widget production trong Cloudflare.
- [ ] Thêm chính xác domain production vào Hostname Management; không thêm `localhost`, wildcard hoặc hostname staging.
- [ ] Đưa `TURNSTILE_SITE_KEY` và `TURNSTILE_SECRET_KEY` production vào secret manager/environment của dịch vụ.
- [ ] Đặt `APP_PUBLIC_URL=https://<domain>`, allowed host/proxy,
  `TURNSTILE_ALLOWED_HOSTNAMES=<domain>` và cấp key; auto mode sẽ kích hoạt.
- [ ] Tạo Cloudflare Tunnel, thay tunnel UUID/credential, tạo DNS route và xác nhận origin chỉ lắng nghe trên loopback.
- [ ] Deploy/restart theo quy trình chuẩn, chạy smoke test register, forgot password, resend OTP và adaptive login.
- [ ] Xác nhận Siteverify success/failure và cảnh báo hoạt động trước khi mở toàn bộ traffic.

**Tiêu chí hoàn thành:** bot không thể gọi trực tiếp endpoint được bảo vệ bằng token giả/thiếu; người dùng hợp lệ không gặp challenge không cần thiết; rate limit cũ vẫn hoạt động; production được kích hoạt chỉ bằng domain, key và feature flag, không có commit sửa logic.

### Giai đoạn 4 — Quan sát, cảnh báo và diễn tập

- [ ] Dashboard cho request rate, WAF actions, Turnstile pass/fail, `429`, `503`, `5xx`, DB busy, queue full và WebSocket rejection.
- [ ] Cảnh báo khi lưu lượng vượt baseline, origin bandwidth tăng bất thường hoặc Turnstile failure tăng đột biến.
- [x] Log request ID và rule/action nhưng không log cookie, CAPTCHA token, session token hay secret.
- [x] Viết runbook cho các tình huống: volumetric DDoS, credential stuffing, OTP abuse, false positive và Siteverify outage.
- [ ] Diễn tập bật chế độ chống tấn công, hạ ngưỡng tạm thời, rollback rule và khôi phục traffic hợp lệ.

**Tiêu chí hoàn thành:** đội vận hành phát hiện được sự cố, xác định lớp đang chặn và rollback rule mà không deploy lại ứng dụng.

## 5. Thứ tự ưu tiên

1. **P0:** CDN/Managed DDoS, khóa origin và trusted proxy chính xác.
2. **P0:** WAF/rate limit cho auth, OTP, public API và endpoint tốn tài nguyên.
3. **P1:** Reverse proxy/Uvicorn resource limits và load test.
4. **P1:** Turnstile cho đăng ký, quên mật khẩu, resend OTP; adaptive challenge cho login.
5. **P1:** Dashboard, cảnh báo và runbook.
6. **P2:** Tinh chỉnh bot score, rate limit theo session/fingerprint và complexity budget nếu gói dịch vụ hỗ trợ.

## 6. Rollout và rollback

### Rollout

1. Hoàn thành code và test Turnstile trên local bằng test key chính thức.
2. Xác nhận cùng artifact hoạt động trên staging bằng widget/key/hostname staging.
3. Deploy quan sát và metrics trước.
4. Tạo widget production, thêm domain/key bằng secret/environment và bật feature flag; không sửa artifact.
5. Bật rule ở chế độ log/dry-run.
6. Bật Managed Challenge cho tỷ lệ traffic nhỏ hoặc endpoint ít rủi ro.
7. Mở rộng dần sau khi theo dõi false positive ít nhất 24–72 giờ.
8. Chỉ bật block cứng khi đã có allowlist cần thiết và runbook rollback.

### Rollback

- Chuyển WAF/rate-limit rule về log thay vì xóa rule.
- Đặt Turnstile về `auto` và bỏ key, hoặc đặt `false`; application rate limit
  vẫn hoạt động.
- Không mở firewall trực tiếp ra Internet để xử lý sự cố CAPTCHA.
- Nếu CDN/WAF gặp sự cố, dùng tuyến dự phòng đã chuẩn bị; không công khai origin IP chưa được bảo vệ.

## 7. Definition of Done

- [ ] Origin không thể truy cập trực tiếp từ Internet.
- [ ] Managed DDoS và WAF đang bật, có log và cảnh báo.
- [ ] Endpoint auth/OTP/public/expensive có edge rate limit phù hợp baseline.
- [ ] Reverse proxy và Uvicorn có giới hạn tài nguyên đã load test.
- [x] Turnstile được xác minh server-side, kiểm tra hostname/action và không thể bypass.
- [ ] Một artifact đã kiểm thử được dùng xuyên suốt staging/production; kích hoạt production không yêu cầu sửa code.
- [x] CAPTCHA chỉ xuất hiện ở luồng rủi ro hoặc sau hành vi bất thường.
- [ ] Test tự động, runbook, dashboard và rollback đã được xác nhận.

## 8. Trạng thái thực hiện trong repository

Đã hoàn thành phần có thể kiểm chứng trước khi có domain production:

- Backend Turnstile hỗ trợ optional auto-mode và strict fail-closed mode,
  action/hostname binding, test-key isolation và startup validation.
- Bảo vệ register, forgot password, resend OTP; adaptive challenge cho login và
  verify email sau số lần thử cấu hình được.
- Login nhận marker rủi ro escalation-only từ edge để yêu cầu challenge ngay;
  marker không thể tắt Turnstile hoặc bỏ qua application rate limit.
- Frontend Managed widget render explicit, CSP/Trusted Types tối thiểu, reset
  token, trạng thái accessible và không hiển thị CAPTCHA login trước ngưỡng.
- Cloudflare Tunnel, NGINX, systemd/Uvicorn, WAF rule, Prometheus alert,
  Grafana dashboard và runbook dạng template version-control.
- Local browser matrix với always-pass, always-fail và force-interactive.
- Production security preflight kiểm tra domain/origin binding, Turnstile key,
  loopback topology, resource limit và PostgreSQL connection budget mà không
  ghi secret ra output.
- Overload/recovery harness có guard loopback/remote, thống kê status và
  p50/p95/p99, kiểm tra shedding `429/503` và yêu cầu readiness phục hồi ba lần
  liên tiếp mà không restart.
- Phiếu `docs/production-security-information.md` liệt kê domain, topology,
  Cloudflare, PostgreSQL, baseline, owner và vị trí secret còn phải cung cấp.

Khi chốt production, các file cần điền giá trị triển khai là:

- `deploy/cloudflared/config.yml.example`: domain, tunnel UUID và đường dẫn
  credential.
- `deploy/turnstile/production.env.example`: overlay domain/origin/trusted proxy
  và placeholder key; key thật chỉ nằm trong secret manager.
- `deploy/turnstile/staging.env.example`: domain và widget riêng để kiểm tra cùng
  artifact trước production.
- `deploy/cloudflare/security-rules.md`: domain và ngưỡng lấy từ baseline.
- `deploy/systemd/biddingflow.service.example`: số worker/resource budget đã load
  test.

Không tạo thêm nhánh code riêng cho production. Quy trình kích hoạt là
`điền cấu hình → kiểm tra cấu hình → restart/deploy → smoke test → mở traffic`.

Lệnh kiểm chứng:

```bash
npm test
npm run build:secure
npm run test:security-deploy
```

Kết quả kiểm chứng local gần nhất ngày 2026-08-01:

- `npm test`: 303 Python tests và 256 JavaScript tests đạt.
- `npm run build:secure`: secure build và 41 bundle checks đạt.
- `npm run test:security-deploy`: 72 contract tests cùng 5 kịch bản browser
  Turnstile đạt.
- Python quality, security lint và frontend debt gate đạt.

Các checkbox còn mở cần dữ liệu hoặc quyền trên môi trường thật: domain,
Cloudflare zone/tunnel, firewall, secret manager, baseline tối thiểu 7 ngày,
staging/production rollout, load test hạ tầng và diễn tập vận hành. Không đánh
dấu hoàn thành các mục này chỉ dựa trên template hoặc test local.

## 9. Tài liệu tham khảo

- [Cloudflare — Proactive DDoS defense](https://developers.cloudflare.com/ddos-protection/best-practices/proactive-defense/)
- [Cloudflare — Protect your origin server](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/)
- [Cloudflare — Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)
- [Cloudflare Turnstile — Server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Uvicorn — Settings and resource limits](https://github.com/encode/uvicorn/blob/master/docs/settings.md)
- [NGINX — Limiting connections](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html)
