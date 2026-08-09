# Phiếu thông tin và xác nhận vận hành production

Tài liệu này là biểu mẫu bàn giao. Không điền giá trị secret, token, cookie,
mật khẩu hoặc OTP vào repository; dùng secret manager và ghi lại tên tham chiếu.

## Domain và môi trường

- Domain production:
- APP_PUBLIC_URL:
- ALLOWED_HOSTS / CORS_ORIGINS / ALLOWED_WS_ORIGINS:
- APP_ENV và thời điểm chuyển traffic:
- Không dùng raw IP làm public origin.

## Hạ tầng máy chủ

- OS, kernel, region và hostname release:
- Tunnel UUID:
- APP_INSTANCE_COUNT:
- Reverse proxy, health check và phương án rollback:
- Giới hạn Uvicorn/HTTP được xác nhận theo `.env.example`.

## PostgreSQL

- Host private network, database và role runtime/migrator/worker:
- SSL mode và CA bundle:
- Kết quả backup + restore drill:
- Lệnh kiểm tra tài nguyên: `SHOW max_connections` và `SHOW shared_buffers`.
- Không điền giá trị connection string hoặc password vào biểu mẫu commit.

## Cloudflare zone và Tunnel

- Zone/domain:
- Tunnel UUID:
- Ingress hostname và origin service:
- Direct-IP requests fail; chỉ nhận traffic qua hostname được phép.
- WAF/rate limit/change ticket:

## Cloudflare Turnstile

- TURNSTILE_ENABLED:
- TURNSTILE_SITE_KEY: Không điền giá trị; lưu trong secret/config manager.
- TURNSTILE_SECRET_KEY: Không điền giá trị; lưu trong secret/config manager.
- TURNSTILE_ALLOWED_HOSTNAMES:
- Siteverify timeout và hành vi khi upstream unavailable:

## Baseline, WAF và cảnh báo

- Baseline request rate, latency và error budget:
- Rules cho login/register/forgot-password/import/upload/WebSocket:
- Alert route, người trực và thời gian phản hồi:
- Xác nhận log không chứa password, OTP, token, cookie hay raw file.

## Ứng dụng, email và tài khoản khởi tạo

- Commit/release SHA:
- SMTP provider, sender và secret reference:
- ADMIN_USERNAME/ADMIN_EMAIL: chỉ ghi secret reference, không ghi password.
- Super Admin bootstrap đã đổi mật khẩu sau khởi tạo: chưa xác nhận / đã xác nhận.
- Privileged reauthentication và session revocation đã kiểm tra.

## Lưu trữ, audit, restore và document worker

- Media/temp/log storage và quota:
- Audit checkpoint off-host:
- Restore drill database cách ly:
- Document worker service account và sandbox:
- Document worker shared storage khi APP_INSTANCE_COUNT > 1:
- Object URL/download cache và TTL artifact:

## Secret và xác nhận vận hành

- Secret manager / rotation owner:
- SECRET_ROTATION_CONFIRMED_AT:
- DATABASE_PRIVATE_NETWORK_CONFIRMED: false / true
- DATA_AT_REST_ENCRYPTION_CONFIRMED: false / true
- AUDIT_CHECKPOINT_OFFHOST_CONFIRMED: false / true
- DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED: false / true
- DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED: false / true
- Không điền giá trị: mọi trường mật khẩu, private key, OTP, cookie và token.

Mọi trường chưa được xác nhận phải được ghi vào release checklist và chặn
production deployment cho tới khi owner ký xác nhận.
