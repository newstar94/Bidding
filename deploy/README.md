# Production deployment and rollback

Public production packaging is blocked until every fact in
`docs/legal-fact-sheet.md` is approved and the corresponding placeholder in
`views/legal/` is replaced with reviewed copy. Verify this explicitly with
`npm run check:legal:production`; local development uses the warning-only
`npm run check:legal` command.

Production builds also require `APP_RELEASE_ID` to be the immutable full Git
commit SHA (40 hexadecimal characters) or a 64-character content hash. The
packager rejects `development`, `unknown`, empty, shortened and semantic-version
values, and verifies the secure-build marker against `APP_RELEASE_ID` (or
`GITHUB_SHA` in CI) before selecting any runtime files.

Phiếu thông tin cần thu thập trước khi điền production nằm tại
`deploy/production-security-information.md`. Không ghi secret thật vào phiếu;
chỉ ghi tên và nơi lưu secret.

Đây là checklist trung lập với nhà cung cấp. Secret và file environment thật phải nằm ngoài release artifact, owner `root`, mode `0600`.

Nếu `APP_INSTANCE_COUNT` lớn hơn 1, mount private shared storage cho
`DOCUMENT_WORKER_TEMP_DIR/award-result-validations` trước khi đặt
`AWARD_RESULT_ARTIFACT_SHARED_STORAGE_CONFIRMED=true`. Không dùng sticky session
để che local artifact store; readiness cố ý fail nếu thiếu xác nhận này.

## Preflight

1. Xác nhận artifact SHA-256/`PRODUCTION_MANIFEST.json` và release ID.
2. Chạy dependency/secret scan, full test, fresh DB, upgrade và restore drill.
3. Verify `APP_PUBLIC_URL` HTTPS exact-origin, trusted proxy/host allowlist và cookie secure.
4. Verify PostgreSQL backup có thể restore; ghi checkpoint migration.
   Database cũ đi qua schema v36 phải làm theo
   deploy/runbooks/database-upgrade-v36.md, gồm cardinality preflight và
   transactional dry-run trước maintenance window.
   Database đi qua schema v45 phải làm theo
   deploy/runbooks/database-upgrade-v45.md để benchmark `EXPLAIN`, kiểm tra
   cardinality/index build và cấu hình retention batch trước maintenance.
   Historical database replay và schema v46 phải làm theo
   deploy/runbooks/database-upgrade-v46.md, gồm v1/v35 PostgreSQL rehearsal,
   catalog/FK assertion và rollback rehearsal.
5. Verify document worker service account, DB role và Linux sandbox.
6. Nếu dùng Turnstile, tạo widget `Managed`, allow đúng hostname production và
   lưu site/secret key trong secret manager. `TURNSTILE_ENABLED=auto` tự bật khi
   đủ cấu hình; dùng `true` chỉ khi muốn fail closed.
7. Verify Cloudflare Tunnel là đường public duy nhất đến origin; firewall không
   mở các cổng loopback `8000`/`8080` ra Internet.

## Local Turnstile verification

Toàn bộ logic Turnstile chạy được trước khi có domain production. Merge các
giá trị trong `deploy/turnstile/local.env.example` vào environment local rồi
khởi động ứng dụng như bình thường. Đây là test key always-pass chính thức;
test tự động còn bao phủ always-fail, token thiếu, token quá hạn/duplicate,
sai hostname/action và upstream timeout bằng mock contract.

Chạy browser matrix local với ba test key chính thức (always-pass,
always-fail, force-interactive), mạng chậm, lỗi tải script và kiểm tra
accessibility nghiêm trọng/critical:

```bash
npm run test:security-deploy
```

Lệnh này chạy cả unit/integration contract cho Turnstile, resource limits,
template Cloudflare/NGINX/systemd/monitoring và browser matrix local.

Không sao chép test key sang production. Production startup từ chối test key,
hostname local, hostname không khớp `APP_PUBLIC_URL`, hoặc cấu hình thiếu.

Ba environment overlay được tách riêng tại `deploy/turnstile/`:

- `local.env.example`: test key chính thức, chỉ dành cho `localhost` và
  `127.0.0.1`.
- `staging.env.example`: domain và Managed widget riêng của staging.
- `production.env.example`: domain production, cùng origin cho HTTP/WebSocket,
  trusted proxy loopback và placeholder key lưu bằng secret manager.

Các file này là phần bổ sung cho environment đầy đủ, không thay thế
`.env.example`. Khi điền production, thay mọi
`REPLACE_WITH_PRODUCTION_DOMAIN` bằng cùng một hostname chính xác; không thêm
scheme vào `ALLOWED_HOSTS`/`TURNSTILE_ALLOWED_HOSTNAMES` và không ghi key thật
vào bản copy nằm trong repository.

Staging/production overlay để trống edge marker theo mặc định. Chỉ điền
`TURNSTILE_EDGE_CHALLENGE_HEADER=X-BiddingFlow-Edge-Risk` và
`TURNSTILE_EDGE_CHALLENGE_VALUE=challenge` sau khi Cloudflare Transform Rule đã
overwrite header đúng trên `POST /api/auth/login`. Marker chỉ tăng mức bảo vệ,
không phải credential và không thể giảm/bỏ challenge.

## Edge and process configuration

Các mẫu production được version-control tại:

- `deploy/cloudflared/config.yml.example`: tunnel outbound-only; khi kích hoạt
  thay UUID và domain.
- `deploy/cloudflare/security-rules.md`: biểu thức WAF/rate-limit và checklist
  khóa origin; thay domain sau khi có baseline.
- `deploy/nginx/biddingflow-tunnel.conf.example`: reverse proxy loopback,
  timeout, buffering, connection/request limits và private health/metrics.
- `deploy/nginx/biddingflow-proxy-params.conf.example`: copy thành
  `/etc/nginx/snippets/biddingflow-proxy-params.conf`.
- `deploy/systemd/biddingflow.service.example`: Uvicorn worker, concurrency,
  backlog, keep-alive, request recycling và WebSocket limits.
- `deploy/monitoring/security-alerts.yml.example`: Prometheus alert mẫu cho
  Turnstile, `429` và overload `503`.
- `deploy/monitoring/security-dashboard.json`: Grafana dashboard mẫu để đối
  chiếu origin metrics với Cloudflare Security Events.

Trước khi reload NGINX, chạy `nginx -t`. Trước khi restart service, chạy
`systemd-analyze verify` với unit đã cài đặt. Các ngưỡng ban đầu phải được
điều chỉnh từ baseline thực tế theo trình tự log/dry-run → challenge → block.
Runbook xử lý sự cố nằm tại `deploy/runbooks/ddos-bot-abuse.md`.

## Production security preflight

Sau khi tạo file thật từ template nhưng trước khi restart/mở traffic, chạy trên
máy chủ production:

```bash
python scripts/check_security_deployment.py \
  --environment-file /etc/biddingflow/web.env \
  --cloudflared-config /etc/cloudflared/config.yml \
  --nginx-config /etc/nginx/conf.d/biddingflow.conf \
  --systemd-unit /etc/systemd/system/biddingflow.service \
  --postgres-max-connections "$POSTGRES_MAX_CONNECTIONS"
```

Đặt `POSTGRES_MAX_CONNECTIONS` bằng giá trị đã đọc trực tiếp từ `SHOW
max_connections` trên đúng PostgreSQL cluster production.

Preflight fail closed nếu còn placeholder cốt lõi, domain/origin không đồng
nhất, trusted proxy không chỉ là loopback, Cloudflare Tunnel bỏ qua NGINX,
NGINX/Uvicorn lắng nghe public, thiếu resource limit hoặc tổng connection
budget chạm giới hạn PostgreSQL. Turnstile `auto` chưa đủ key không làm
preflight thất bại; output báo `TURNSTILE_AUTO_INCOMPLETE`. Nếu Turnstile đã
active, preflight vẫn từ chối test key/hostname sai. Output không in key/secret.

Preflight này kiểm tra cấu hình tĩnh. Nó không thay thế `cloudflared tunnel
ingress validate`, `nginx -t`, `systemd-analyze verify`, firewall/DNS audit,
smoke test và load test trên hạ tầng thật.

Sau preflight và smoke test, chạy burst có kiểm soát từ chính host qua NGINX
loopback. Bắt đầu thấp, tăng dần `--concurrency`/`--requests`, và chỉ dùng
`--require-shedding` ở bước xác nhận điểm `429/503`:

```bash
python scripts/verify_overload_recovery.py \
  --base-url http://127.0.0.1:8080 \
  --burst-path /health/live \
  --recovery-path /health/ready \
  --concurrency 64 \
  --requests 1000 \
  --require-shedding
```

Harness yêu cầu ba response readiness `2xx` liên tiếp sau burst. Mặc định nó
từ chối mọi target không phải loopback; test staging từ máy khác cần cờ
`--allow-remote-target`, có giới hạn tối đa thấp hơn và chỉ được chạy trong cửa
sổ load-test đã phê duyệt. Không chạy công cụ này trong lúc production đang
phục vụ người dùng thật.

## Deploy

```bash
python scripts/backup.py create
python scripts/backup.py verify --snapshot <snapshot>
DATABASE_AUTO_MIGRATE=false python scripts/manage_database.py
unzip biddingflow-production.zip -d /opt/biddingflow/releases/<release-id>
python scripts/verify_document_sandbox.py
systemctl restart biddingflow-document-worker
systemctl restart biddingflow
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
```

Reverse proxy chỉ chuyển traffic sau khi live/ready và smoke login/read-only đạt. Uvicorn dùng `--no-proxy-headers`; middleware chỉ nhận proxy metadata từ peer đã allowlist.

Sau khi tạo widget production, không sửa artifact: chỉ đặt
`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`,
`TURNSTILE_ALLOWED_HOSTNAMES=<domain>` và `TURNSTILE_ENABLED=auto`, sau đó
restart và smoke test đăng ký, quên mật khẩu, resend OTP và adaptive login.

## Rollback

Nếu code mới lỗi nhưng schema còn tương thích, chuyển traffic/symlink về release trước và restart worker/web. Không tự giảm `database_metadata.schema_version` và không chạy DDL ngược ad-hoc.

Nếu migration làm thay đổi dữ liệu không tương thích:

1. Cô lập write traffic.
2. Lưu forensic snapshot hiện tại.
3. Restore backup đã verify vào database mới/cách ly.
4. Chuyển credential/traffic sang database restore sau smoke test.
5. Giữ database lỗi để điều tra; không overwrite backup.

Migration v28 chỉ drop `nguoi_cham_id` ở ba bảng đánh giá sau preflight `IS NOT NULL = 0`; rollback dữ liệu là restore backup, còn rollback code có thể dùng release trước nếu không ghi schema cũ.

## Account deletion retention

Luồng xóa tài khoản phải tuân theo
`deploy/runbooks/account-deletion-retention.md`. Khi chưa có quyết định
retention/legal được phê duyệt, blocker tombstone bắt buộc fail closed; không
purge hoặc anonymize audit evidence bằng SQL ad-hoc.

## Runtime boundaries

- Web role: CRUD cần thiết, không DDL/role management.
- Migrator role: chỉ dùng trong deploy step, không có trong web environment.
- Document worker role: chỉ queue/document objects cần thiết.
- PostgreSQL, metrics và admin endpoints: private network/VPN.
- User upload, media, log, cache và temp: volume ngoài release package.
