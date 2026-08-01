# Thông tin cần bổ sung trước khi triển khai production

File này là phiếu thu thập thông tin cho cấu hình DDoS, Cloudflare Turnstile,
reverse proxy và giới hạn tài nguyên. Không ghi secret thật vào file này hoặc
commit secret vào repository. Với secret, chỉ ghi tên secret và nơi lưu.

Turnstile, edge-risk signal và các rule Cloudflare nâng cao là lớp tùy chọn:
chưa điền thì ứng dụng vẫn chạy với rate limit hiện có. Các phụ thuộc cốt lõi
như PostgreSQL, origin/allowed host đúng với môi trường đang chạy và tài khoản
admin khi khởi tạo database mới không thể tự động bỏ qua vì thiếu chúng ứng
dụng sẽ không thực hiện đúng chức năng.

## 1. Domain và môi trường

- [ ] Domain production: `________________________________`
- [ ] Domain staging, nếu có: `________________________________`
- [ ] Có sử dụng thêm hostname `www`: `có / không`
- [ ] Ngày dự kiến mở production: `____-__-__`
- [ ] Múi giờ vận hành: `________________________________`

Các biến phải dùng cùng một production domain:

```dotenv
APP_PUBLIC_URL=https://REPLACE_WITH_PRODUCTION_DOMAIN
ALLOWED_HOSTS=REPLACE_WITH_PRODUCTION_DOMAIN
CORS_ORIGINS=https://REPLACE_WITH_PRODUCTION_DOMAIN
ALLOWED_WS_ORIGINS=https://REPLACE_WITH_PRODUCTION_DOMAIN
TURNSTILE_ALLOWED_HOSTNAMES=REPLACE_WITH_PRODUCTION_DOMAIN
```

Không nhập scheme vào `ALLOWED_HOSTS` hoặc
`TURNSTILE_ALLOWED_HOSTNAMES`. Không dùng wildcard.

## 2. Hạ tầng máy chủ

- [ ] Nhà cung cấp/VPS/cloud: `________________________________`
- [ ] Hệ điều hành và phiên bản: `________________________________`
- [ ] Có dùng Linux + systemd: `có / không`
- [ ] Có dùng NGINX trên cùng máy: `có / không`
- [ ] Số application instance: `________________________________`
- [ ] Số Uvicorn worker mỗi instance: `________________________________`
- [ ] CPU/RAM mỗi instance: `________________________________`
- [ ] Owner triển khai: `________________________________`
- [ ] Cửa sổ bảo trì/load-test: `________________________________`

Giá trị cần điền hoặc xác nhận trong environment:

```dotenv
APP_INSTANCE_COUNT=REPLACE_WITH_INSTANCE_COUNT
UVICORN_WORKERS=REPLACE_WITH_WORKERS_PER_INSTANCE
UVICORN_LIMIT_CONCURRENCY=REPLACE_WITH_LOAD_TESTED_VALUE
UVICORN_BACKLOG=REPLACE_WITH_LOAD_TESTED_VALUE
```

## 3. PostgreSQL

- [ ] PostgreSQL host/cluster: `________________________________`
- [ ] Kết quả `SHOW max_connections`: `________________________________`
- [ ] `DATABASE_POOL_MAX_SIZE` dự kiến: `________________________________`
- [ ] Connection dành riêng mỗi worker: `________________________________`
- [ ] Connection dự phòng cho admin/job khác: `________________________________`
- [ ] Đã xác nhận PostgreSQL chỉ ở private network: `có / không`
- [ ] Owner backup/restore: `________________________________`

Không ghi `DATABASE_URL` hoặc mật khẩu database vào file này. Preflight sẽ
đối chiếu công thức:

```text
APP_INSTANCE_COUNT × UVICORN_WORKERS
× (DATABASE_POOL_MAX_SIZE + DATABASE_DEDICATED_CONNECTIONS_PER_WORKER)
+ DATABASE_RESERVED_CONNECTIONS
< PostgreSQL max_connections
```

## 4. Cloudflare zone và Tunnel

- [ ] Cloudflare account/zone đã tạo: `có / không`
- [ ] Zone ID: `________________________________`
- [ ] Tunnel đã tạo: `có / không`
- [ ] Tunnel UUID: `________________________________`
- [ ] Tên secret chứa tunnel credential: `________________________________`
- [ ] DNS route đến tunnel đã tạo: `có / không`
- [ ] Origin cũ từng lộ IP public: `có / không / chưa biết`
- [ ] Firewall xác nhận không mở cổng `8000`/`8080`: `có / không`

Tunnel credential là secret. Chỉ đặt file thật ở máy chủ, ví dụ
`/etc/cloudflared/<tunnel-uuid>.json`, owner `root`, permission phù hợp.

## 5. Cloudflare Turnstile

- [ ] Managed widget production đã tạo: `có / không`
- [ ] Widget chỉ allow đúng domain production: `có / không`
- [ ] Tên secret chứa site key: `________________________________`
- [ ] Tên secret chứa secret key: `________________________________`
- [ ] Widget staging riêng đã tạo: `có / không / không dùng staging`

Các giá trị production cần điền trực tiếp trong secret manager/environment:

```dotenv
TURNSTILE_ENABLED=auto
TURNSTILE_SITE_KEY=REPLACE_IN_SECRET_MANAGER
TURNSTILE_SECRET_KEY=REPLACE_IN_SECRET_MANAGER
TURNSTILE_ALLOWED_HOSTNAMES=REPLACE_WITH_PRODUCTION_DOMAIN
TURNSTILE_VERIFY_TIMEOUT_SECONDS=5
TURNSTILE_LOGIN_AFTER_ATTEMPTS=3
TURNSTILE_VERIFY_AFTER_ATTEMPTS=3
```

Không dùng test key local trên staging/production.

Chế độ `auto` là tùy chọn: thiếu hoặc sai cấu hình thì CAPTCHA tắt và ứng dụng
vẫn chạy với application rate limit. Khi đủ key và hostname hợp lệ, CAPTCHA tự
bật. Đổi sang `true` nếu muốn bắt buộc CAPTCHA và dừng startup khi cấu hình sai.

## 6. Edge-risk signal cho adaptive login

- [ ] Cloudflare plan hỗ trợ Origin Request Header Transform: `có / không`
- [ ] Rule chỉ áp dụng cho `POST /api/auth/login`: `có / không`
- [ ] Rule overwrite header visitor gửi lên: `có / không`

Nếu bật:

```dotenv
TURNSTILE_EDGE_CHALLENGE_HEADER=X-BiddingFlow-Edge-Risk
TURNSTILE_EDGE_CHALLENGE_VALUE=challenge
```

Nếu không có Transform Rule đáng tin cậy, để trống cả hai biến. Marker chỉ có
thể yêu cầu thêm CAPTCHA; không thể tắt CAPTCHA hoặc bỏ qua rate limit.

## 7. Baseline, WAF và cảnh báo

- [ ] Đã thu thập tối thiểu 7 ngày baseline: `có / không`
- [ ] Request/giây p95: `________________________________`
- [ ] Request/giây p99 hoặc burst lớn nhất: `________________________________`
- [ ] Tỷ lệ `401/403/429/503/5xx`: `________________________________`
- [ ] WebSocket concurrent cao nhất: `________________________________`
- [ ] Băng thông download cao nhất: `________________________________`
- [ ] Kênh cảnh báo: `________________________________`
- [ ] Owner xử lý false positive: `________________________________`
- [ ] Grafana/Prometheus endpoint hoặc workspace: `________________________________`

WAF/rate-limit phải rollout theo thứ tự `log → challenge → block`; không điền
ngưỡng tùy ý trước khi có baseline.

## 8. Ứng dụng, email và tài khoản khởi tạo

- [ ] Immutable release ID/commit SHA: `________________________________`
- [ ] SMTP host và port: `________________________________`
- [ ] SMTP security (`starttls`/`ssl`): `________________________________`
- [ ] SMTP username: `________________________________`
- [ ] SMTP sender: `________________________________`
- [ ] Tên secret chứa SMTP password: `________________________________`
- [ ] Admin username ban đầu: `________________________________`
- [ ] Admin display name: `________________________________`
- [ ] Admin email production: `________________________________`
- [ ] Tên secret chứa admin password: `________________________________`
- [ ] Tên tổ chức mặc định: `________________________________`
- [ ] Super-admin IP/CIDR allowlist: `________________________________`
- [ ] Google OAuth Client ID, nếu sử dụng: `________________________________`
- [ ] Google Authorized JavaScript Origin đã thêm đúng domain: `có / không`
- [ ] Nội dung pháp lý production đã được duyệt: `có / không`

Các biến tương ứng:

```dotenv
APP_RELEASE_ID=REPLACE_WITH_IMMUTABLE_RELEASE_ID
SMTP_HOST=REPLACE_WITH_SMTP_HOST
SMTP_PORT=587
SMTP_SECURITY=starttls
SMTP_USER=REPLACE_WITH_SMTP_USER
SMTP_PASSWORD=REPLACE_IN_SECRET_MANAGER
SMTP_SENDER=REPLACE_WITH_SMTP_SENDER
ADMIN_USERNAME=REPLACE_WITH_INITIAL_ADMIN_USERNAME
ADMIN_PASSWORD=REPLACE_IN_SECRET_MANAGER
ADMIN_NAME=REPLACE_WITH_INITIAL_ADMIN_NAME
ADMIN_EMAIL=REPLACE_WITH_PRODUCTION_ADMIN_EMAIL
DEFAULT_ORG_NAME=REPLACE_WITH_DEFAULT_ORGANIZATION
SUPER_ADMIN_IP_ALLOWLIST=REPLACE_WITH_EXACT_ADMIN_CIDRS
GOOGLE_CLIENT_ID=REPLACE_IF_GOOGLE_LOGIN_IS_ENABLED
```

## 9. Lưu trữ, audit, restore và document worker

- [ ] Persistent data directory/volume: `________________________________`
- [ ] Runtime và backup volume đã mã hóa: `có / không`
- [ ] Tên secret chứa email-outbox encryption key: `________________________________`
- [ ] Tên secret chứa audit-checkpoint HMAC key: `________________________________`
- [ ] Audit checkpoint immutable/off-host đã bật: `có / không`
- [ ] Restore-drill public key: `đã cấp / chưa`
- [ ] Nơi giữ restore-drill private key ngoài web worker: `________________`
- [ ] File trạng thái restore drill gần nhất: `________________________________`
- [ ] Document-worker service account đã tạo: `có / không`
- [ ] Shared encrypted storage giữa web/worker đã mount: `có / không`
- [ ] Shared document-worker GID: `________________________________`
- [ ] Bubblewrap đã cài và verify: `có / không`
- [ ] Metrics CIDR allowlist: `________________________________`
- [ ] Tên secret chứa metrics bearer token: `________________________________`

Chỉ đặt các cờ xác nhận thành `true` sau khi đã kiểm chứng:

```dotenv
DATABASE_PRIVATE_NETWORK_CONFIRMED=false
DATA_AT_REST_ENCRYPTION_CONFIRMED=false
AUDIT_CHECKPOINT_OFFHOST_CONFIRMED=false
DOCUMENT_WORKER_SERVICE_ACCOUNT_CONFIRMED=false
DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED=false
SECRET_ROTATION_CONFIRMED_AT=REPLACE_WITH_RECENT_ISO_DATE
```

## 10. Secret và xác nhận vận hành

- [ ] Secret manager sử dụng: `________________________________`
- [ ] Tên secret cho Turnstile: `________________________________`
- [ ] Tên secret cho Tunnel credential: `________________________________`
- [ ] Tên secret cho metrics bearer token: `________________________________`
- [ ] Ngày rotation gần nhất: `____-__-__`
- [ ] Người phê duyệt production: `________________________________`
- [ ] Người có quyền rollback Cloudflare rule: `________________________________`

Không điền giá trị của các secret sau vào Markdown:

- `TURNSTILE_SECRET_KEY`
- Tunnel credential JSON
- `DATABASE_URL` hoặc mật khẩu PostgreSQL
- `SMTP_PASSWORD`
- `ADMIN_PASSWORD`
- Session/OAuth/encryption/HMAC key

## 11. Lệnh kiểm tra sau khi điền

Local:

```bash
npm run test:security-deploy
```

Production host, trước khi restart hoặc mở traffic:

```bash
python scripts/check_security_deployment.py \
  --environment-file /etc/biddingflow/web.env \
  --cloudflared-config /etc/cloudflared/config.yml \
  --nginx-config /etc/nginx/conf.d/biddingflow.conf \
  --systemd-unit /etc/systemd/system/biddingflow.service \
  --postgres-max-connections "$POSTGRES_MAX_CONNECTIONS"
```

Chỉ chạy overload test trên staging cô lập hoặc cửa sổ bảo trì đã phê duyệt.

## 12. Trạng thái file cấu hình trong repository

- `.env`: đã cấu hình local với `127.0.0.1`, Turnstile official always-pass
  test key và edge signal tắt.
- `.env.example`: mẫu production với Turnstile tùy chọn ở chế độ `auto`; các
  phụ thuộc vận hành cốt lõi vẫn cần được điền.
- `deploy/turnstile/staging.env.example`: overlay staging riêng.
- `deploy/turnstile/production.env.example`: overlay production domain-last.
