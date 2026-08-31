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
`docs/production-security-information.md`. Không ghi secret thật vào phiếu;
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
   Việc loại bỏ duplicate audit index ở schema v47 phải làm theo
   deploy/runbooks/database-upgrade-v47.md, gồm preflight, dry-run, hậu kiểm
   constraint-backed uniqueness và rollback có kiểm soát.
   Database đi qua schema v49–v62 phải làm theo
   deploy/runbooks/database-upgrade-v49-v62.md, gồm duplicate/cardinality/lock
   preflight, transactional dry-run và gate mapping bắt buộc trước v61.
5. Verify document worker service account, DB role và Linux sandbox.
6. Nếu dùng Turnstile, tạo widget `Managed`, allow đúng hostname production và
   lưu site/secret key trong secret manager. `TURNSTILE_ENABLED=auto` tự bật khi
   đủ cấu hình; dùng `true` chỉ khi muốn fail closed.
7. Verify Cloudflare Tunnel là đường public duy nhất đến origin; firewall không
   mở các cổng loopback `8000`/`8080` ra Internet.
8. Nếu bật Mua Sắm Công browser lookup, chạy `npm ci --omit=dev`, cài đúng Chromium
   bằng `npx playwright install chromium`, xác minh service account không đặc quyền,
   hostname allowlist và các flag trong `deploy/production.env.example` hoặc
   `deploy/environment-variables.reference`. Challenge phải trả
   `PROCUREMENT_INTERACTION_REQUIRED`; không triển khai solver/token replay/bypass.
   Kiểm tra TLS bằng chính service account/process chạy Uvicorn; Edge extension tải
   được trang không phải bằng chứng worker có cùng egress. Network policy phải cho
   phép TLS theo SNI `muasamcong.mpi.gov.vn`. Giữ
   `PROCUREMENT_BROWSER_WORKER_TIMEOUT_SECONDS` thấp hơn
   `PROCUREMENT_LOOKUP_TIMEOUT_SECONDS` ít nhất 5 giây (startup sẽ fail nếu sai), rồi
   chạy một mã thật bằng `python scripts/research_muasamcong.py --live PL...` trước
   benchmark 50–100 mã.
   TLS terminator phía Mua Sắm Công phải disable DHE parameter yếu (tối thiểu 2048-bit
   nếu còn dùng DHE) và ưu tiên ECDHE-AES-GCM. Không hạ OpenSSL/Chromium security
   level ở BiddingFlow để chấp nhận `DH_KEY_TOO_SMALL`.

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

Các file này là overlay cho `deploy/production.env.example`, không thay thế
profile local gọn `.env.example` vốn vẫn giữ các control nghiệp vụ và bảo mật.
Khi điền production, thay mọi
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

Không giải nén hoặc build đè vào `/opt/biddingflow/current`. Thư mục này là
con trỏ release đang phục vụ; thay đổi `dist` tại chỗ tạo một cửa sổ trong đó
HTML/manifest và các chunk thuộc hai release khác nhau. Mỗi artifact phải được
giải nén vào một thư mục versioned mới. Trước khi đổi con trỏ, công cụ
`scripts/prepare_frontend_asset_compatibility.py` xác minh toàn bộ inventory của
artifact mới và các metadata/asset được chọn từ release đang phục vụ, rồi chép
đúng tập asset mà Vite manifest của release N tham chiếu vào release N+1. Các
file thừa không có trong manifest N không được chép. Journal
`dist/frontend-compat-assets.json` ghi checksum của tập giữ lại.

```bash
set -euo pipefail

RELEASE_ID="${RELEASE_ID:?export RELEASE_ID with the 40- or 64-character hexadecimal release ID}"
ARTIFACT_SHA256="${ARTIFACT_SHA256:?export the trusted SHA-256 of biddingflow-production.zip}"
DEPLOY_SMOKE_SCRIPT="${DEPLOY_SMOKE_SCRIPT:?export an executable approved login/read-only smoke script}"
if [[ ! "$RELEASE_ID" =~ ^([0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$ ]]; then
  echo "RELEASE_ID must be a full immutable hexadecimal release ID" >&2
  exit 1
fi
if [[ ! "$ARTIFACT_SHA256" =~ ^[0-9A-Fa-f]{64}$ ]] || [ ! -x "$DEPLOY_SMOKE_SCRIPT" ]; then
  echo "A trusted artifact digest and executable smoke script are required" >&2
  exit 1
fi
printf '%s  %s\n' "$ARTIFACT_SHA256" biddingflow-production.zip | sha256sum -c -

NEW_RELEASE="/opt/biddingflow/releases/$RELEASE_ID"
PREVIOUS_RELEASE=""
if [ -L /opt/biddingflow/current ]; then
  PREVIOUS_RELEASE="$(readlink -f /opt/biddingflow/current)"
  if [ ! -d "$PREVIOUS_RELEASE" ]; then
    echo "/opt/biddingflow/current points to a missing release" >&2
    exit 1
  fi
elif [ -e /opt/biddingflow/current ]; then
  echo "/opt/biddingflow/current must be a symlink" >&2
  exit 1
fi
if [ -e "$NEW_RELEASE" ] || [ -L "$NEW_RELEASE" ]; then
  echo "Refusing to overwrite existing release: $NEW_RELEASE" >&2
  exit 1
fi
unzip biddingflow-production.zip -d "$NEW_RELEASE"

PREPARE_FRONTEND_ARGS=(
  --current-release "$NEW_RELEASE"
  --expected-current-release-id "$RELEASE_ID"
)
if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
  test "$NEW_RELEASE" != "$PREVIOUS_RELEASE"
  PREPARE_FRONTEND_ARGS+=(--previous-release "$PREVIOUS_RELEASE")
fi
python "$NEW_RELEASE/scripts/prepare_frontend_asset_compatibility.py" \
  "${PREPARE_FRONTEND_ARGS[@]}"

python "$NEW_RELEASE/scripts/verify_document_sandbox.py"

# No database mutation is allowed until extraction, the full package inventory,
# release identity, frontend graph and static sandbox have all passed.
python "$NEW_RELEASE/scripts/backup.py" create
python "$NEW_RELEASE/scripts/backup.py" verify --snapshot <snapshot>
DATABASE_AUTO_MIGRATE=false python "$NEW_RELEASE/scripts/manage_database.py"

CUTOVER_STARTED=0
rollback_failed_cutover() {
  failure_status=$?
  trap - ERR
  set +e
  if [ "$CUTOVER_STARTED" -eq 1 ]; then
    if [ -n "$PREVIOUS_RELEASE" ]; then
      ln -sfnT "$PREVIOUS_RELEASE" /opt/biddingflow/current.rollback
      mv -Tf /opt/biddingflow/current.rollback /opt/biddingflow/current
      systemctl restart biddingflow-document-worker
      systemctl restart biddingflow
    else
      systemctl stop biddingflow biddingflow-document-worker
      if [ "$(readlink -f /opt/biddingflow/current 2>/dev/null || true)" = "$NEW_RELEASE" ]; then
        unlink /opt/biddingflow/current
      fi
    fi
  fi
  exit "$failure_status"
}
trap rollback_failed_cutover ERR

ln -sfnT "$NEW_RELEASE" /opt/biddingflow/current.next
CUTOVER_STARTED=1
mv -Tf /opt/biddingflow/current.next /opt/biddingflow/current
systemctl restart biddingflow-document-worker
systemctl restart biddingflow
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
"$DEPLOY_SMOKE_SCRIPT" http://127.0.0.1:8000
CUTOVER_STARTED=0
trap - ERR
```

Lần cài đầu tiên chưa có `PREVIOUS_RELEASE`, nhưng vẫn phải chạy helper để xác
minh release ID, manifest/checksum hiện hành, loại mọi asset từ build host không
thuộc manifest hiện hành và ghi journal rỗng (`previousReleaseId: null`).
Sau smoke test, không xóa asset được ghi trong
`dist/frontend-compat-assets.json`; bản build kế tiếp tự lấy đúng manifest của
release hiện hành nên không kéo theo N−2. Nếu Cloudflare từng nhận `404` cho
hashed asset trong lúc deploy lỗi, purge các cached error đó sau khi origin đã
trả `200`; việc xóa cache trình duyệt trên một máy không sửa cache edge hoặc các
máy khác.

Với kiến trúc symlink/restart hiện tại, traffic có thể chạm candidate trong lúc
health/smoke chạy. `ERR` trap bắt buộc tự khôi phục symlink và restart release
trước nếu live/ready hoặc smoke login/read-only lỗi; không được coi deploy hoàn
tất trước khi trap đã được gỡ. Muốn hoàn toàn không có cửa sổ này, chạy candidate
trên port loopback riêng và chỉ đổi upstream sau smoke. Uvicorn dùng
`--no-proxy-headers`; middleware chỉ nhận proxy metadata từ peer đã allowlist.

Sau khi tạo widget production, không sửa artifact: chỉ đặt
`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`,
`TURNSTILE_ALLOWED_HOSTNAMES=<domain>` và `TURNSTILE_ENABLED=auto`, sau đó
restart và smoke test đăng ký, quên mật khẩu, resend OTP và adaptive login.

## Rollback

Nếu code mới lỗi nhưng schema còn tương thích, chuyển traffic/symlink về release trước và restart worker/web. Không tự giảm `database_metadata.schema_version` và không chạy DDL ngược ad-hoc.

Trước khi đổi symlink, ghép asset của release đang phục vụ vào release
rollback. Như vậy các tab đã nhận graph N+1 vẫn tải được chunk trong khi
backend quay về N. Helper đồng thời loại asset tiền nhiệm cũ không còn thuộc
tập N ∪ N+1.

```bash
set -euo pipefail

ROLLBACK_RELEASE="${ROLLBACK_RELEASE:?export ROLLBACK_RELEASE as an existing versioned release directory}"
ROLLBACK_SMOKE_SCRIPT="${ROLLBACK_SMOKE_SCRIPT:?export an executable approved login/read-only smoke script}"
CURRENT_RELEASE="$(readlink -f /opt/biddingflow/current)"
if [ ! -x "$ROLLBACK_SMOKE_SCRIPT" ]; then
  echo "ROLLBACK_SMOKE_SCRIPT must be executable" >&2
  exit 1
fi
if [ ! -d "$ROLLBACK_RELEASE" ] || [ "$ROLLBACK_RELEASE" = "$CURRENT_RELEASE" ]; then
  echo "ROLLBACK_RELEASE must be a distinct existing release directory" >&2
  exit 1
fi
ROLLBACK_RELEASE="$(readlink -f "$ROLLBACK_RELEASE")"
ROLLBACK_RELEASE_ID="$(basename "$ROLLBACK_RELEASE")"
if [[ ! "$ROLLBACK_RELEASE_ID" =~ ^([0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$ ]]; then
  echo "ROLLBACK_RELEASE directory name must be its immutable release ID" >&2
  exit 1
fi

python "$ROLLBACK_RELEASE/scripts/prepare_frontend_asset_compatibility.py" \
  --current-release "$ROLLBACK_RELEASE" \
  --expected-current-release-id "$ROLLBACK_RELEASE_ID" \
  --previous-release "$CURRENT_RELEASE"
python "$ROLLBACK_RELEASE/scripts/verify_document_sandbox.py"

ROLLBACK_CUTOVER_STARTED=0
restore_failed_rollback() {
  failure_status=$?
  trap - ERR
  set +e
  if [ "$ROLLBACK_CUTOVER_STARTED" -eq 1 ]; then
    ln -sfnT "$CURRENT_RELEASE" /opt/biddingflow/current.restore
    mv -Tf /opt/biddingflow/current.restore /opt/biddingflow/current
    systemctl restart biddingflow-document-worker
    systemctl restart biddingflow
  fi
  exit "$failure_status"
}
trap restore_failed_rollback ERR

ln -sfnT "$ROLLBACK_RELEASE" /opt/biddingflow/current.next
ROLLBACK_CUTOVER_STARTED=1
mv -Tf /opt/biddingflow/current.next /opt/biddingflow/current
systemctl restart biddingflow-document-worker
systemctl restart biddingflow
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
"$ROLLBACK_SMOKE_SCRIPT" http://127.0.0.1:8000
ROLLBACK_CUTOVER_STARTED=0
trap - ERR
```

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

Organization decommission chưa phải feature được hỗ trợ. Không xóa trực tiếp
`to_chuc`; ownership dry-run và postcondition contract được mô tả tại
`deploy/runbooks/organization-decommission.md`.

## Runtime boundaries

- Web role: CRUD cần thiết, không DDL/role management.
- Migrator role: chỉ dùng trong deploy step, không có trong web environment.
- Document worker role: chỉ queue/document objects cần thiết.
- PostgreSQL, metrics và admin endpoints: private network/VPN.
- User upload, media, log, cache và temp: volume ngoài release package.
