# Hướng dẫn public BiddingFlow production lên VPS

Cập nhật: 01/10/2026. Hướng dẫn dùng mã nguồn và script hiện có trong BiddingFlow. Các lệnh Linux bên dưới là quy trình triển khai; chưa được chạy trên VPS trong lần rà soát này. Chỉ công nhận triển khai hoàn tất khi các bước kiểm chứng trên máy chủ và qua domain thật đều đạt.

## 1. Kiến trúc và đầu vào

Phương án: **Ubuntu 24.04 LTS amd64**, Python theo `.python-version` của artifact (hiện tại **3.14.5**), **Node.js 24 LTS**, **PostgreSQL 17**. PostgreSQL đặt cùng VPS hoặc trên mạng riêng, bắt buộc TLS `verify-full`. Document worker là dịch vụ Linux riêng.

```text
Trình duyệt -- HTTPS --> Cloudflare -- Tunnel outbound --> nginx 127.0.0.1:8080
                                                              |
                                                    Uvicorn 127.0.0.1:8000
                                                              |
                                    PostgreSQL TLS trên mạng riêng + document worker
```

Chuẩn bị domain có DNS trên Cloudflare, quyền quản trị VPS qua SSH, CA/chứng chỉ PostgreSQL đúng hostname, SMTP thật, secret manager, nơi lưu backup/audit ngoài VPS và tài khoản smoke có quyền đọc `/api/admin/system/version`. Tài khoản smoke phải có bản ghi kiểm tra đã tồn tại và được phép đọc. RPO/RTO, dung lượng và số worker cần được xác nhận bằng tải staging; cấu hình mẫu chưa phải kết quả đo capacity.

Giữ nguyên hợp đồng nghiệp vụ: người có quyền đọc bản ghi vẫn xem đầy đủ dữ liệu; quyền xuất Word chỉ điều khiển tạo/tải Word. Không đổi role, tenant/module/assignment/record scope, entitlement hoặc masking để làm deployment check đạt.

Các giá trị `REPLACE_*`, hostname, IP và secret phải được điền cho môi trường thật. Không ghi mật khẩu vào command line, Git, log hoặc tài liệu bàn giao. File secret/env thật nằm ngoài release, `root:root`, `0600`.

## 2. Build và đóng gói trên máy phát triển

Chạy PowerShell tại `D:\Bidding`, với Python 3.14 và Node 24 đã cài. Cấp URL **database kiểm thử riêng** vào `PACKAGE_SMOKE_DATABASE_URL`; không dùng database production hoặc database có dữ liệu cần giữ. Các bài kiểm thử PostgreSQL cũng cần database test riêng theo cấu hình test của repository.

```powershell
Set-Location D:\Bidding
python --version
node --version
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run check:static
if ($LASTEXITCODE -ne 0) { throw 'Static checks failed' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
npm run audit:dependencies
if ($LASTEXITCODE -ne 0) { throw 'Dependency audit failed' }
npm run check:legal:production
if ($LASTEXITCODE -ne 0) { throw 'Legal page check failed' }
# Content hash thích hợp khi đang có thay đổi chưa commit; không tự commit/push.
$env:APP_RELEASE_ID = python -c "from scripts.package_production import _source_derived_release_id; print(_source_derived_release_id())"
if ($LASTEXITCODE -ne 0) { throw 'Release identity failed' }
npm run build:secure
if ($LASTEXITCODE -ne 0) { throw 'Secure build failed' }
python scripts/package_production.py --check
if ($LASTEXITCODE -ne 0) { throw 'Extracted package smoke failed' }
python scripts/package_production.py --output release/biddingflow-production.zip
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
$digest = (Get-FileHash release/biddingflow-production.zip -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText('D:\Bidding\release\biddingflow-production.zip.sha256', "$digest  biddingflow-production.zip`n", [Text.UTF8Encoding]::new($false))
Write-Output "Release ID: $env:APP_RELEASE_ID"
Write-Output "Artifact SHA-256: $digest"
```

Lưu log exit code của từng gate và kết quả browser/E2E cho đúng bản phát hành. Check legal chỉ kiểm tra ba trang pháp lý tối thiểu, không xác nhận tuân thủ pháp luật. Không thay source sau khi đã build/đóng gói; nếu sửa runtime thì build lại và lấy checksum mới.

Chuyển ZIP và checksum qua SSH/SCP. Gửi tài liệu này riêng cho người vận hành. Artifact production loại toàn bộ Markdown, `.env` thật, dữ liệu local, tests, source frontend, Git và thư mục skill/agent; các file skill/agent vẫn được giữ trong workspace phát triển.

## 3. Chuẩn bị VPS

Các block Bash tiếp theo chạy trong phiên root (`sudo -i`), theo thứ tự. Mỗi bước lỗi phải được xử lý trước khi tiếp tục; không chạy nguyên tài liệu như một script duy nhất.

```bash
set -euo pipefail
umask 077
test "$(uname -m)" = x86_64
. /etc/os-release
test "$ID" = ubuntu && test "$VERSION_ID" = 24.04
apt-get update
apt-get install -y ca-certificates curl unzip xz-utils nginx python3 \
  bubblewrap libseccomp2 apparmor apparmor-utils fonts-liberation ripgrep
timedatectl set-timezone Asia/Ho_Chi_Minh
timedatectl status
install -d -o root -g root -m 0755 /opt/biddingflow/releases /opt/biddingflow/python
install -d -o root -g root -m 0755 /etc/biddingflow
install -d -o root -g root -m 0700 /run/secrets
```

Firewall/security group chỉ cho SSH từ mạng quản trị. Không mở `8000`, `8080` hoặc PostgreSQL ra Internet; public HTTP/HTTPS đi qua Tunnel. Nếu PostgreSQL ở host khác, chỉ cho IP mạng riêng của web/worker và job quản trị. Giữ SSH đang dùng khi đổi firewall. Cho Tunnel egress theo [yêu cầu kết nối Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).

Tạo tài khoản và nhóm trao đổi tài liệu. `987` chỉ là GID mẫu; chọn GID trống và ghi cùng giá trị vào cả hai env.

```bash
DOC_GID=987
if getent group biddingflow-documents >/dev/null; then
  test "$(getent group biddingflow-documents | cut -d: -f3)" = "$DOC_GID"
else
  ! getent group "$DOC_GID" >/dev/null
  groupadd --system --gid "$DOC_GID" biddingflow-documents
fi
id biddingflow >/dev/null 2>&1 || useradd --system --user-group \
  --home-dir /nonexistent --shell /usr/sbin/nologin biddingflow
id biddingflow-document-worker >/dev/null 2>&1 || useradd --system \
  --gid biddingflow-documents --home-dir /nonexistent \
  --shell /usr/sbin/nologin biddingflow-document-worker
usermod -a -G biddingflow-documents biddingflow
test "$(id -g biddingflow-document-worker)" = "$DOC_GID"
install -d -o biddingflow -g biddingflow -m 0750 /var/lib/biddingflow
install -d -o biddingflow -g biddingflow-documents -m 0770 /var/lib/biddingflow-document-jobs
install -d -o biddingflow -g biddingflow -m 0750 \
  /var/lib/biddingflow/templates/images /var/lib/biddingflow/templates/words \
  /var/lib/biddingflow/templates/word-catalog /var/lib/biddingflow/backups \
  /var/lib/biddingflow/observability /var/lib/biddingflow/audit-checkpoints
```

Mount volume mã hóa trước khi dùng các thư mục dữ liệu, PostgreSQL, exchange, backup và browser profile. Kiểm tra mount bằng `findmnt -T <đường-dẫn>` và bằng chứng mã hóa từ nhà cung cấp/LUKS. Trên một VPS, web và worker dùng cùng thư mục exchange; nếu có nhiều instance phải dùng private shared storage, kể cả `award-result-validations`. Chỉ bật cờ xác nhận sau khi đã kiểm chứng.

## 4. Nhận và kiểm tra artifact

Nhập release ID và checksum từ thông tin bàn giao đã xác minh; không tự lấy checksum của file vừa nhận làm giá trị kỳ vọng.

```bash
cd /root
read -r -p 'Release ID đã được duyệt: ' RELEASE_ID
read -r -p 'SHA-256 đã được duyệt: ' ARTIFACT_SHA256
[[ "$RELEASE_ID" =~ ^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$ ]]
[[ "$ARTIFACT_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]
printf '%s  %s\n' "$ARTIFACT_SHA256" biddingflow-production.zip | sha256sum -c -
NEW_RELEASE="/opt/biddingflow/releases/$RELEASE_ID"
test ! -e "$NEW_RELEASE" && test ! -L "$NEW_RELEASE"
install -d -o root -g root -m 0755 "$NEW_RELEASE/code"
unzip -q biddingflow-production.zip -d "$NEW_RELEASE/code"
CODE="$NEW_RELEASE/code"
PYTHON_VERSION="$(cat "$CODE/.python-version")"
```

Mỗi release là một thư mục chứa `code/`, `venv/`, `node_modules/` và bản sao package/lock. `code/` là ZIP đã kiểm tra; dependencies và secret nằm ngoài nó. Một symlink `current` chọn đồng thời code và venv, tránh nâng dependencies của bản đang chạy. Script kiểm kê artifact từ chối file ngoài manifest và symlink, vì vậy không cài dependencies vào `code/`.

## 5. Cài Python, Node và dependencies

uv hỗ trợ cài đúng Python và đặt nơi cài qua `UV_PYTHON_INSTALL_DIR`. Đặt Python dưới `/opt`, vì systemd bật `ProtectHome=true` sẽ chặn interpreter nằm trong `/root` hoặc `/home`. [Cài uv](https://docs.astral.sh/uv/getting-started/installation/), [cài Python](https://docs.astral.sh/uv/guides/install-python/), [biến nơi cài Python](https://docs.astral.sh/uv/reference/environment/#uv_python_install_dir).

```bash
curl --fail --show-error --location https://astral.sh/uv/install.sh -o /root/install-uv.sh
UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh /root/install-uv.sh
export UV_PYTHON_INSTALL_DIR=/opt/biddingflow/python
export UV_PYTHON_BIN_DIR=/opt/biddingflow/python-bin
uv python install "$PYTHON_VERSION"
uv venv --python "$PYTHON_VERSION" "$NEW_RELEASE/venv"
PYTHON="$NEW_RELEASE/venv/bin/python"
uv pip install --python "$PYTHON" --require-hashes -r "$CODE/requirements.txt"
uv pip check --python "$PYTHON"
"$PYTHON" -B --version
```

Cài bản Node 24 đã được duyệt từ [Node.js chính thức](https://nodejs.org/en/download); ví dụ dưới đây pin `v24.21.0`, được tra cứu ngày 01/10/2026. Nếu đổi patch, kiểm chứng lại trên staging và ghi phiên bản mới trong biên bản release.

```bash
NODE_VERSION=v24.21.0
cd /root
curl --fail --show-error --location "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" -O
curl --fail --show-error --location "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -O
awk -v f="node-$NODE_VERSION-linux-x64.tar.xz" '$2==f' SHASUMS256.txt | sha256sum -c -
test ! -e "/opt/biddingflow/node-$NODE_VERSION-linux-x64"
tar -xJf "node-$NODE_VERSION-linux-x64.tar.xz" -C /opt/biddingflow
ln -sfnT "/opt/biddingflow/node-$NODE_VERSION-linux-x64" /opt/biddingflow/node
export PATH=/opt/biddingflow/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
node --version
cp "$CODE/package.json" "$CODE/package-lock.json" "$NEW_RELEASE/"
install -d -o root -g root -m 0755 "$NEW_RELEASE/browsers/playwright" "$NEW_RELEASE/browsers/puppeteer"
export PLAYWRIGHT_BROWSERS_PATH="$NEW_RELEASE/browsers/playwright"
export PUPPETEER_CACHE_DIR="$NEW_RELEASE/browsers/puppeteer"
cd "$NEW_RELEASE"
npm ci --omit=dev
node node_modules/playwright/cli.js install --with-deps chromium
node node_modules/puppeteer/lib/puppeteer/node/cli.js browsers install chrome --install-deps
node --input-type=module -e "await import('playwright'); await import('puppeteer'); console.log('Runtime browser modules loaded')"
chmod -R a+rX,go-w /opt/biddingflow/python "$NEW_RELEASE"
```

CLI ở `node_modules` dùng đúng package trong lock, không tải một package CLI mới qua `npx`. Playwright và Puppeteer cần browser tương ứng; cache phải đọc được bởi `biddingflow`, nằm ngoài home, và được truyền vào unit. [Playwright browser installation](https://playwright.dev/docs/browsers), [Puppeteer browser installation](https://pptr.dev/browsers-api), [Puppeteer cache directory](https://pptr.dev/troubleshooting#could-not-find-expected-browser-locally).

## 6. Kiểm tra inventory và giữ asset cho tab cũ

Chạy helper **trước mọi import/backend startup**, khi `code/` còn nguyên artifact. `-B` và `PYTHONDONTWRITEBYTECODE=1` ngăn tạo cache Python trong code. Helper kiểm tra toàn bộ manifest/checksum, release ID và graph frontend; sau đó ghi journal/copy asset của release trước để tab đang mở vẫn tải được chunk.

```bash
PREVIOUS_RELEASE=''
if [ -L /opt/biddingflow/current ]; then
  PREVIOUS_RELEASE="$(readlink -f /opt/biddingflow/current)"
  test -d "$PREVIOUS_RELEASE/code"
elif [ -e /opt/biddingflow/current ]; then
  echo 'current phải là symlink' >&2; exit 1
fi
ASSET_ARGS=(--current-release "$CODE" --expected-current-release-id "$RELEASE_ID")
if [ -n "$PREVIOUS_RELEASE" ]; then
  ASSET_ARGS+=(--previous-release "$PREVIOUS_RELEASE/code")
fi
"$PYTHON" -B "$CODE/scripts/prepare_frontend_asset_compatibility.py" "${ASSET_ARGS[@]}"
```

Không xóa asset/journal do helper tạo. Khi rollback phải giải nén lại ZIP cũ vào một thư mục mới rồi chạy helper, vì bản đã chạy có journal/asset tương thích ngoài manifest ban đầu.

## 7. PostgreSQL 17, TLS và credential riêng

Nếu dùng PostgreSQL managed trên mạng riêng, yêu cầu phiên bản 17, CA server, hostname chứng chỉ, quyền DBA để provision role/extensions và database drill riêng. Nếu đặt PostgreSQL trên VPS, cài PGDG đúng Ubuntu `noble`; không dùng package mặc định để đoán major. [Hướng dẫn PostgreSQL Ubuntu](https://www.postgresql.org/download/linux/ubuntu/).

```bash
apt-get install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
apt-get update
apt-get install -y postgresql-17 postgresql-client-17
/usr/lib/postgresql/17/bin/psql --version
```

Trên DB host, cấu hình `listen_addresses` chỉ là loopback/IP private; `ssl=on`, `ssl_cert_file` và `ssl_key_file` trỏ đến chứng chỉ server/khóa thật. Chứng chỉ có SAN khớp hostname trong URL. Khóa server do user `postgres` đọc, mode `0600`; CA đặt `/etc/biddingflow/postgres-ca.crt`, `root:root`, `0644`, trên VPS ứng dụng. [PostgreSQL server TLS](https://www.postgresql.org/docs/17/ssl-tcp.html).

`pg_hba.conf` giữ local peer cho DBA và chỉ cho phép `hostssl` + `scram-sha-256` từ mạng riêng cần thiết. Ví dụ cùng host: database `biddingflow`, các role `biddingflow_app,biddingflow_migrator,biddingflow_backup,biddingflow_document_worker`, địa chỉ `127.0.0.1/32`. Role admin/drill có rule riêng đúng database; loại các rule rộng có thể khớp trước. Reload/restart DB sau `pg_hba_file_rules` không có lỗi. Không dùng `sslmode=require`, `verify-ca`, TLS bỏ kiểm chứng hoặc public DB để vượt gate.

Secret manager cung cấp các file sau. Env dùng một dòng `KEY=value` hoặc `KEY='value'`, không `export`, không nội suy shell, không multiline. Giá trị chứa dấu nháy/backslash cần được kiểm tra đồng nhất với parser và systemd trước khi sử dụng.

| File ngoài release | Nội dung/đối tượng dùng |
| --- | --- |
| `/run/secrets/biddingflow-database.json` | Theo `deploy/production-database-secret.json.example`; runtime URL có `sslmode=verify-full&sslrootcert=/etc/biddingflow/postgres-ca.crt`, ba mật khẩu độc lập cho migrator/backup/worker |
| `/etc/biddingflow/postgres-admin.service` | File libpq service `biddingflow-admin`, host private, port, user DBA, password, `dbname=postgres`, `sslmode=verify-full`, `sslrootcert` |
| `/etc/biddingflow/provision.env` | `DATABASE_ADMIN_URL` đến database `biddingflow`; `DATABASE_RUNTIME_ROLE=biddingflow_app`, `DATABASE_MIGRATOR_ROLE=biddingflow_migrator`, `DATABASE_BACKUP_ROLE=biddingflow_backup`, `DATABASE_DOCUMENT_WORKER_ROLE=biddingflow_document_worker`; bốn `DATABASE_*_PASSWORD` khớp JSON |
| `/etc/biddingflow/bootstrap.env` | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_EMAIL`, `DEFAULT_ORG_NAME` cho database mới; mật khẩu đạt policy ứng dụng |

Cụ thể bốn tên secret provision là `DATABASE_RUNTIME_PASSWORD`, `DATABASE_MIGRATOR_PASSWORD`, `DATABASE_BACKUP_PASSWORD`, `DATABASE_DOCUMENT_WORKER_PASSWORD`. Mỗi mật khẩu tối thiểu 16 ký tự, riêng biệt; URL phải percent-encode ký tự đặc biệt trong username/password. Không truyền credential provisioning cho web hoặc worker.

Tạo database mới bằng service DBA; nếu database đã tồn tại, đi theo quy trình upgrade ở mục 12, không tạo/reset nó. Ví dụ dùng `psql` tương tác để mật khẩu drill không nằm trong lịch sử shell:

```bash
PGSERVICEFILE=/etc/biddingflow/postgres-admin.service \
  /usr/lib/postgresql/17/bin/psql 'service=biddingflow-admin' -v ON_ERROR_STOP=1
```

```sql
CREATE DATABASE biddingflow ENCODING 'UTF8';
CREATE ROLE biddingflow_drill LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password biddingflow_drill
CREATE DATABASE biddingflow_restore_drill OWNER biddingflow_drill ENCODING 'UTF8';
\q
```

Role drill/database drill chỉ dùng kiểm chứng restore. Đặt credential drill trong env job riêng ở mục 9. Với DB managed, DBA thực hiện thao tác tương đương theo khả năng của nhà cung cấp.

Tạo công cụ nạp env riêng trên host để tránh `source` secret thành mã shell. Nó xóa môi trường kế thừa, chỉ nạp file đã chọn, kiểm tra `root:root 0600` và gọi lệnh được chỉ định. Không nạp `web.env` cho worker/migrator/backup.

```bash
cat > /usr/local/sbin/biddingflow-env-exec <<'PY'
import os, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
from scripts.verify_document_worker_deployment import parse_environment_file
args = sys.argv[2:]
separator = args.index('--')
values = {}
for filename in args[:separator]:
    for name, value in parse_environment_file(Path(filename)).items():
        if name in values and values[name] != value:
            raise SystemExit('Conflicting environment setting: ' + name)
        values[name] = value
command = args[separator + 1:]
if not command:
    raise SystemExit('Missing command')
environment = {'PATH': '/opt/biddingflow/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
               'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
environment.update(values)
os.chdir(root)
os.execvpe(command[0], command, environment)
PY
chmod 0750 /usr/local/sbin/biddingflow-env-exec
run_scoped() { "$PYTHON" -B /usr/local/sbin/biddingflow-env-exec "$CODE" "$@"; }
"$PYTHON" -B "$CODE/scripts/prepare_production_database_env.py" \
  --source /run/secrets/biddingflow-database.json --output-dir /etc/biddingflow
run_scoped /etc/biddingflow/provision.env -- "$PYTHON" -B "$CODE/scripts/configure_database_roles.py"
run_scoped /etc/biddingflow/database-migrator.env /etc/biddingflow/bootstrap.env -- \
  "$PYTHON" -B "$CODE/scripts/manage_database.py" --preflight
run_scoped /etc/biddingflow/database-migrator.env /etc/biddingflow/bootstrap.env -- \
  "$PYTHON" -B "$CODE/scripts/manage_database.py" --dry-run
run_scoped /etc/biddingflow/database-migrator.env /etc/biddingflow/bootstrap.env -- \
  "$PYTHON" -B "$CODE/scripts/manage_database.py"
# Chạy lại sau khi bảng đã tồn tại, đặc biệt grant document_jobs cho worker.
run_scoped /etc/biddingflow/provision.env -- "$PYTHON" -B "$CODE/scripts/configure_database_roles.py"
```

Migration tạo schema, admin và organization đầu tiên. Sau khi kiểm tra đăng nhập admin, gỡ `ADMIN_PASSWORD` khỏi env thường trực và thu hồi secret bootstrap/provision tạm theo quy trình secret manager; giữ credential migrator/backup trong scope job riêng. Bản phát hành không tự chạy migration trong web: `DATABASE_AUTO_MIGRATE=false`.

## 8. Điền cấu hình web/worker và kiểm chứng sandbox

```bash
install -o root -g root -m 0600 "$CODE/deploy/production.env.example" /etc/biddingflow/web.env
install -o root -g root -m 0600 "$CODE/deploy/document-worker.env.example" /etc/biddingflow/document-worker.env
# Sửa các bản copy ngoài release bằng editor/secret manager.
editor /etc/biddingflow/web.env
editor /etc/biddingflow/document-worker.env
```

Web: đặt `APP_RELEASE_ID` đúng release ID; `APP_PUBLIC_URL`, `CORS_ORIGINS`, `ALLOWED_WS_ORIGINS` cùng HTTPS origin; `ALLOWED_HOSTS` chỉ hostname. Giữ trusted proxy loopback, debug false, secure cookie true, execution mode external. `DATABASE_URL` để trống trong `web.env`; fragment `database-web.env` nạp sau cung cấp runtime URL.

Điền SMTP thật; kiểm tra gửi/nhận email, OTP và reset mật khẩu trên staging. Sinh các key độc lập trong secret manager: `EMAIL_OUTBOX_ENCRYPTION_KEY` là Fernet; `OTP_HMAC_KEY`, `AUDIT_CHECKPOINT_HMAC_KEY`, `SYNC_CURSOR_SIGNING_KEY` tối thiểu 32 byte; `BIDDING_RESTORE_DRILL_PUBLIC_KEY` là base64url raw Ed25519 public key 32 byte. Private key chỉ nằm trong job restore. Không tự xoay khóa mã hóa/HMAC mà chưa có kế hoạch tương thích dữ liệu cũ.

Nếu bật Conflict Center theo cấu hình nghiệp vụ đã duyệt, đặt thêm hai key độc lập: `CONFLICT_DRAFT_ENCRYPTION_KEY` là Fernet hợp lệ, `CONFLICT_RESOLUTION_SIGNING_KEY` tối thiểu 32 byte. Lưu và khôi phục khóa cùng dữ liệu draft; thay khóa cần kế hoạch tương thích các draft/token còn hiệu lực.

Thêm vào `web.env`: `BIDDING_BACKUP_DIR=/var/lib/biddingflow/backups`, `BIDDING_RESTORE_DRILL_STATE_FILE=/var/lib/biddingflow/observability/last-restore-drill.json`, `PLAYWRIGHT_BROWSERS_PATH=/opt/biddingflow/current/browsers/playwright`, `PUPPETEER_CACHE_DIR=/opt/biddingflow/current/browsers/puppeteer`.

Sau bằng chứng thật, đặt `DATABASE_PRIVATE_NETWORK_CONFIRMED=true`, `DATA_AT_REST_ENCRYPTION_CONFIRMED=true`, `AUDIT_CHECKPOINT_OFFHOST_CONFIRMED=true`, ngày rotation `SECRET_ROTATION_CONFIRMED_AT=YYYY-MM-DD` trong 90 ngày gần nhất; xác nhận dedicated account/shared volume và đặt hai cờ worker tương ứng ở cả web và worker. Shared GID phải là GID thực tế. Với nhiều instance, xác nhận thêm artifact shared storage. Sao chép checkpoint ra nơi ngoài VPS có retention/immutability và kiểm tra đọc lại trước khi xác nhận off-host.

Không bật hàng loạt feature/commerce/trial/payment/AI để vượt startup. Giữ lựa chọn nghiệp vụ đã được chủ sản phẩm duyệt. Nếu dùng Turnstile, tạo widget Managed đúng hostname, dùng production key; không dùng test key. `auto` chỉ active khi đủ cấu hình. Payment thật cần profile/provider và authorization đã duyệt.

AppArmor phải đang bật và có profile **enforce cho `/usr/bin/bwrap`**; libseccomp và user/mount namespace phải hoạt động. Ubuntu có hạn chế user namespace, cần profile phù hợp bản distro. Không tắt AppArmor toàn hệ thống, không chạy worker root hoặc bỏ sandbox để vượt lỗi. [Quản lý AppArmor Ubuntu](https://ubuntu.com/server/docs/how-to/security/apparmor/). Đường dẫn CA phải traverse được bởi web/worker: directory `/etc/biddingflow` mode `0755`, CA `0644`, secret/env vẫn `0600`.

```bash
systemctl enable --now apparmor
aa-status
dpkg -L apparmor | rg 'bwrap' || true
# Nếu có profile distro, nạp đúng file đã kiểm tra; nếu thiếu, quản trị host
# phải provision policy phù hợp và kiểm chứng trước bước start.
# apparmor_parser -r /etc/apparmor.d/<profile-bwrap-da-xac-minh>
cat /sys/module/apparmor/parameters/enabled
rg '^[[:space:]]*(/usr/bin/bwrap|bwrap) \(enforce\)[[:space:]]*$' /sys/kernel/security/apparmor/profiles
chmod -R a+rX,go-w /opt/biddingflow/python "$NEW_RELEASE"
runuser --user biddingflow-document-worker --group biddingflow-documents -- \
  env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin APP_ENV=production \
  PYTHONDONTWRITEBYTECODE=1 DOCUMENT_WORKER_TEMP_DIR=/var/lib/biddingflow-document-jobs \
  DOCUMENT_WORKER_SANDBOX=bwrap DOCUMENT_WORKER_SANDBOX_EXECUTABLE=/usr/bin/bwrap \
  DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP=true DOCUMENT_WORKER_SANDBOX_UID=65534 \
  DOCUMENT_WORKER_SANDBOX_GID=65534 "$PYTHON" -B "$CODE/scripts/verify_document_sandbox.py"
```

Profile inventory cần có đúng dòng `/usr/bin/bwrap (enforce)` hoặc `bwrap (enforce)`. Tên profile có thể khác attachment path; kiểm tra profile host gắn vào `/usr/bin/bwrap`, không nhận `enforce` của một profile khác. [Tên profile và attachment expression trong AppArmor](https://manpages.ubuntu.com/manpages/noble/man5/apparmor.d.5.html). Probe phải báo `Document sandbox probe passed:` dưới identity worker; chạy probe bằng root không đủ.

## 9. Backup và restore drill trước khi public

Tạo `/etc/biddingflow/backup-job.env` và `/etc/biddingflow/restore-job.env`, `root:root 0600`. Backup env có `BIDDING_DATA_DIR=/var/lib/biddingflow`, `BIDDING_BACKUP_DIR=/var/lib/biddingflow/backups`, các path upload/Word nếu override. Restore env có các path đó, `DATABASE_URL` trỏ primary chỉ để so sánh isolation, `RESTORE_DRILL_DATABASE_URL` trỏ database drill độc lập, `BIDDING_RESTORE_DRILL_PRIVATE_KEY`, `BIDDING_RESTORE_DRILL_PUBLIC_KEY`, `BIDDING_RESTORE_DRILL_STATE_FILE=/var/lib/biddingflow/observability/last-restore-drill.json` và `RESTORE_MAX_RTO_SECONDS`, `BACKUP_MAX_RPO_SECONDS` đã duyệt. Web chỉ có public key.

Job root tạo snapshot/state với quyền riêng tư; web cần đọc bằng chứng để kiểm tra hash/chữ ký. Cài helper sau job, chỉ cho group `biddingflow` đọc các snapshot hoàn tất và state, không cấp group quyền ghi:

```bash
cat > /usr/local/sbin/biddingflow-readable-evidence <<'PY'
import grp, os, re
from pathlib import Path
group = grp.getgrnam('biddingflow').gr_gid
root = Path('/var/lib/biddingflow/backups').resolve(strict=True)
for snapshot in root.iterdir():
    if snapshot.is_symlink() or not snapshot.is_dir() or not re.fullmatch(r'biddingflow-backup-\d{8}T\d{6}Z', snapshot.name):
        continue
    for directory, subdirs, files in os.walk(snapshot, followlinks=False):
        for path in [Path(directory), *(Path(directory) / name for name in files)]:
            if path.is_symlink():
                raise SystemExit('Unexpected backup symlink')
            os.chown(path, 0, group)
            os.chmod(path, 0o750 if path.is_dir() else 0o640)
state = Path('/var/lib/biddingflow/observability/last-restore-drill.json')
if state.exists():
    if state.is_symlink() or not state.is_file():
        raise SystemExit('Unexpected restore state path')
    os.chown(state, 0, group)
    os.chmod(state, 0o640)
PY
chmod 0750 /usr/local/sbin/biddingflow-readable-evidence
```

```bash
run_scoped /etc/biddingflow/backup-job.env /etc/biddingflow/database-backup.env -- \
  "$PYTHON" -B "$CODE/scripts/backup.py" create
read -r -p 'Đường dẫn snapshot vừa tạo: ' SNAPSHOT
test -d "$SNAPSHOT"
run_scoped /etc/biddingflow/backup-job.env -- \
  "$PYTHON" -B "$CODE/scripts/backup.py" verify --snapshot "$SNAPSHOT"
run_scoped /etc/biddingflow/restore-job.env -- \
  "$PYTHON" -B "$CODE/scripts/backup.py" drill --snapshot "$SNAPSHOT"
"$PYTHON" -B /usr/local/sbin/biddingflow-readable-evidence
```

Backup gồm PostgreSQL dump, uploads và mutable Word templates. Nếu dùng Word catalog/asset riêng ngoài hai path đó, snapshot đồng bộ thêm các volume này trong maintenance window; `backup.py` không tự thu tất cả volume tùy biến. Bản backup/checkpoint phải được copy ra nơi khác có mã hóa/retention; đọc lại, verify checksum và restore từ bản off-host trong staging. Private key và secret cấu hình được backup trong secret manager riêng.

Sau lần deploy đầu, lên lịch `backup.py create` hằng ngày và `drill-latest` theo chu kỳ phù hợp RPO/RTO, chạy root qua loader trên. Ví dụ dòng cron root (`crontab -e`); helper quyền phải chạy sau mỗi job thành công, vì job drill thay thế file state:

```cron
15 1 * * * /opt/biddingflow/venv/bin/python -B /usr/local/sbin/biddingflow-env-exec /opt/biddingflow/current/code /etc/biddingflow/backup-job.env /etc/biddingflow/database-backup.env -- /opt/biddingflow/venv/bin/python -B /opt/biddingflow/current/code/scripts/backup.py create && /opt/biddingflow/venv/bin/python -B /usr/local/sbin/biddingflow-readable-evidence
30 2 * * 0 /opt/biddingflow/venv/bin/python -B /usr/local/sbin/biddingflow-env-exec /opt/biddingflow/current/code /etc/biddingflow/restore-job.env -- /opt/biddingflow/venv/bin/python -B /opt/biddingflow/current/code/scripts/backup.py drill-latest && /opt/biddingflow/venv/bin/python -B /usr/local/sbin/biddingflow-readable-evidence
```

Theo dõi exit code, tuổi backup/drill và off-host replication; cron không có cơ chế tự xác nhận việc upload ngoài VPS. Không để log/email job chứa URL/password. Giới hạn default hiện tại là RPO 93.600 giây và RTO 3.600 giây; phê duyệt ngưỡng theo yêu cầu vận hành thật.

## 10. nginx, cloudflared và systemd

Cài `cloudflared` từ [Cloudflare chính thức](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). Tạo named tunnel bằng máy quản trị, chuyển đúng credentials JSON vào `/etc/cloudflared/<UUID>.json` mode `0600`; không copy account certificate rộng hơn vào runtime nếu không cần. Route DNS domain đến tunnel theo [CLI setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/local-management/).

```bash
install -d -o root -g root -m 0755 /etc/nginx/snippets /etc/cloudflared
install -o root -g root -m 0644 "$CODE/deploy/nginx/biddingflow-proxy-params.conf.example" /etc/nginx/snippets/biddingflow-proxy-params.conf
install -o root -g root -m 0644 "$CODE/deploy/nginx/biddingflow-tunnel.conf.example" /etc/nginx/conf.d/biddingflow.conf
install -o root -g root -m 0600 "$CODE/deploy/cloudflared/config.yml.example" /etc/cloudflared/config.yml
editor /etc/cloudflared/config.yml
cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
nginx -t
```

Config Tunnel dùng `http://127.0.0.1:8080`, `httpHostHeader` đúng domain, cuối ingress là 404. Loại site nginx mặc định mở port public trên VPS mới bằng `unlink /etc/nginx/sites-enabled/default` sau khi xác nhận đây chỉ là site mặc định; không xóa site ứng dụng khác. Lưu config Tunnel trước, chưa start public traffic.

Copy unit, điều chỉnh **bản cài trên host** cho layout có `code/`. Giữ các giới hạn/identity/coupling của template. Venv stable symlink sẽ trỏ qua cùng `current` với code.

```bash
install -o root -g root -m 0644 "$CODE/deploy/systemd/biddingflow.service.example" /etc/systemd/system/biddingflow.service
install -o root -g root -m 0644 "$CODE/deploy/systemd/biddingflow-document-worker.service.example" /etc/systemd/system/biddingflow-document-worker.service
sed -i 's|WorkingDirectory=/opt/biddingflow/current$|WorkingDirectory=/opt/biddingflow/current/code|' /etc/systemd/system/biddingflow*.service
sed -i 's|/opt/biddingflow/current/scripts/run_document_worker.py|/opt/biddingflow/current/code/scripts/run_document_worker.py|' /etc/systemd/system/biddingflow-document-worker.service
install -d -m 0755 /etc/systemd/system/biddingflow.service.d /etc/systemd/system/biddingflow-document-worker.service.d
cat > /etc/systemd/system/biddingflow.service.d/paths.conf <<'UNIT'
[Service]
Environment=PATH=/opt/biddingflow/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PYTHONDONTWRITEBYTECODE=1
UNIT
cat > /etc/systemd/system/biddingflow-document-worker.service.d/paths.conf <<'UNIT'
[Service]
Environment=PYTHONDONTWRITEBYTECODE=1
UNIT
ln -sfnT /opt/biddingflow/current/venv /opt/biddingflow/venv
if [ -L /opt/biddingflow/current ]; then
  systemd-analyze verify /etc/systemd/system/biddingflow.service \
    /etc/systemd/system/biddingflow-document-worker.service
fi
systemctl daemon-reload
```

Lần cài đầu chạy `systemd-analyze verify` sau khi tạo `current` ở mục 11; không bỏ qua lỗi của lần verify đó. Template web có `MemoryDenyWriteExecute=true` và `RestrictNamespaces=true`; phải kiểm chứng Node/Chromium dưới **unit thực tế** cho Mua Sắm Công. Probe ngoài systemd không chứng minh tương thích với các giới hạn này. Nếu unit chặn JIT/namespace, thu log/cause và sửa cấu hình host có phạm vi trước khi công nhận chức năng đó hoạt động.

## 11. Preflight, start và public smoke

Đọc `SHOW max_connections` trực tiếp từ đúng DB production bằng service DBA. Điền số trả về; không giả định 100. Budget phải bao gồm tất cả web/worker/replica và reserve.

```bash
PGSERVICEFILE=/etc/biddingflow/postgres-admin.service \
  /usr/lib/postgresql/17/bin/psql 'service=biddingflow-admin' -Atc 'SHOW max_connections'
read -r -p 'max_connections vừa đọc: ' POSTGRES_MAX_CONNECTIONS
cd "$CODE"
"$PYTHON" -B -m scripts.check_security_deployment \
  --environment-file /etc/biddingflow/web.env \
  --cloudflared-config /etc/cloudflared/config.yml \
  --nginx-config /etc/nginx/conf.d/biddingflow.conf \
  --systemd-unit /etc/systemd/system/biddingflow.service \
  --postgres-max-connections "$POSTGRES_MAX_CONNECTIONS"
chown -R root:root "$NEW_RELEASE"
chmod -R a+rX,go-w "$NEW_RELEASE"
ln -sfnT "$NEW_RELEASE" /opt/biddingflow/current.next
mv -Tf /opt/biddingflow/current.next /opt/biddingflow/current
systemd-analyze verify /etc/systemd/system/biddingflow.service \
  /etc/systemd/system/biddingflow-document-worker.service
systemctl enable biddingflow-document-worker.service biddingflow.service nginx.service
systemctl restart biddingflow-document-worker.service
systemctl restart biddingflow.service nginx.service
systemctl is-active biddingflow-document-worker.service biddingflow.service nginx.service
read -r -p 'Hostname production không có scheme: ' PUBLIC_HOST
curl --fail --show-error -H "Host: $PUBLIC_HOST" http://127.0.0.1:8080/health/live
curl --fail --show-error -H "Host: $PUBLIC_HOST" http://127.0.0.1:8080/health/ready
"$PYTHON" -B "$CODE/scripts/verify_document_worker_deployment.py" \
  --release-root /opt/biddingflow/current/code --python /opt/biddingflow/current/venv/bin/python \
  --evidence /var/lib/biddingflow/document-worker-deployment-evidence.json
ss -lntp
```

Nếu lỗi, giữ Tunnel dừng, xem `journalctl -u biddingflow -u biddingflow-document-worker -n 150 --no-pager` và sửa nguyên nhân; không tự bật các cờ xác nhận thiếu bằng chứng. Worker verifier phải đạt và ghi evidence `0600`: active units, identity khác nhau, secret riêng, ownership exchange, AppArmor, private PostgreSQL/TLS/role và sandbox.

Health/metrics private qua nginx; health cần `Host` production do `ALLOWED_HOSTS`. Public health có thể trả 403 theo thiết kế. Không dùng `curl -k`. Cài/start cloudflared sau private readiness, theo [Cloudflare Linux service](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/):

```bash
cloudflared --config /etc/cloudflared/config.yml service install
systemctl enable --now cloudflared
systemctl is-active cloudflared
```

Tạo `/etc/biddingflow/smoke.env` `0600`: `SMOKE_BASE_URL=https://<domain>`, `SMOKE_HEALTH_BASE_URL=http://127.0.0.1:8080`, `SMOKE_EXPECTED_RELEASE_ID=<release-id>`, `SMOKE_READ_PATH=<GET-bản-ghi-được-phép>`, `SMOKE_LOG_FILE=/var/lib/biddingflow/observability/deploy-smoke.jsonl`. Chọn **một** cơ chế: username/password của tài khoản smoke có quyền quản trị version, hoặc `SMOKE_COOKIE_FILE` root `0600` chứa Cookie header phiên ngắn hạn. Dùng session cookie sau login tương tác nếu Turnstile yêu cầu challenge; không bypass challenge.

```bash
run_scoped /etc/biddingflow/smoke.env -- \
  "$PYTHON" -B "$CODE/deploy/scripts/production_smoke.py" --mode deploy
```

Smoke dùng local health không gửi credential; login/session/version/authorized read/sync GET đi qua public HTTPS. Nó không tạo tài khoản/bản ghi hay enqueue Word/Excel. `SMOKE_WORD_PATH`/`SMOKE_EXCEL_PATH` chỉ là đường dẫn GET tới file **đã có** và được phép tải. Script đạt không thay thế kiểm thử tương tác.

Trên staging rồi xác nhận trên production bằng dữ liệu kiểm tra được duyệt: đăng nhập/reset OTP, CRUD và canonical save/reload, offline rồi sync, phân quyền/tenant/assignment, xuất Word/Excel qua queue, Mua Sắm Công, WebSocket reconnect và các feature đã bật. Xác minh nguồn dữ liệu/entitlement hiện hành, không sửa expected để hợp thức hóa thay đổi quyền.

Khi một bước sau start thất bại: dừng `cloudflared`; lần cài đầu giữ web/worker dừng tới khi sửa xong. Upgrade dùng rollback đã diễn tập ở mục 12. Chỉ công bố URL sau khi smoke, chứng chỉ, chức năng cần thiết và vận hành đạt.

## 12. Cập nhật và rollback

Nâng cấp trong maintenance window: chuẩn bị wrapper mới qua mục 4–6; giữ ZIP/checksum cũ; backup và verify; tránh job cron backup/drill trùng cửa sổ migration; dừng Tunnel/web/worker; chạy migrator `--preflight`, `--dry-run`, rồi migration thật; chạy provision roles lại. Với database lịch sử, staging rehearsal phải đi qua các schema migration liên quan trước production. Đổi `APP_RELEASE_ID` trong `web.env` và smoke env đúng candidate, lưu bản env cũ `0600` để phục hồi.

Chỉ cho phép rollback code sau migration khi staging đã chứng minh release cũ chạy được schema mới. Nếu schema không tương thích hoặc chưa chứng minh, giữ traffic dừng và dùng restore vào database mới; không tự giảm `database_metadata.schema_version` hay chạy DDL ngược.

Mẫu cutover sau khi đã qua migration và lưu config cũ. Trước block này tạo `/etc/biddingflow/web.env.before-cutover` và `smoke.env.before-cutover` bằng copy bảo toàn `0600`; sau đó điền config candidate. `PREVIOUS_RELEASE`/`NEW_RELEASE` phải là wrapper đã kiểm chứng. Chỉ đặt `CODE_ROLLBACK_CONFIRMED=true` sau rehearsal tương thích schema.

```bash
CODE_ROLLBACK_CONFIRMED=false
cutover_failed() {
  status=$?
  trap - ERR
  set +e
  systemctl stop cloudflared biddingflow biddingflow-document-worker
  if [ "$CODE_ROLLBACK_CONFIRMED" = true ] && [ -n "$PREVIOUS_RELEASE" ]; then
    cp -p /etc/biddingflow/web.env.before-cutover /etc/biddingflow/web.env
    cp -p /etc/biddingflow/smoke.env.before-cutover /etc/biddingflow/smoke.env
    ln -sfnT "$PREVIOUS_RELEASE" /opt/biddingflow/current.rollback
    mv -Tf /opt/biddingflow/current.rollback /opt/biddingflow/current
    systemctl restart biddingflow-document-worker biddingflow nginx
    # Traffic chỉ mở lại sau private readiness và rollback smoke có log.
  fi
  exit "$status"
}
trap cutover_failed ERR
ln -sfnT "$NEW_RELEASE" /opt/biddingflow/current.next
mv -Tf /opt/biddingflow/current.next /opt/biddingflow/current
systemctl restart biddingflow-document-worker biddingflow nginx
curl --fail --show-error -H "Host: $PUBLIC_HOST" http://127.0.0.1:8080/health/ready
systemctl restart cloudflared
run_scoped /etc/biddingflow/smoke.env -- "$PYTHON" -B "$CODE/deploy/scripts/production_smoke.py" --mode deploy
trap - ERR
```

Rollback chủ động cần cả asset tương thích cho các tab đã tải candidate:

1. Dừng Tunnel và write traffic; chọn ZIP/checksum cũ đã kiểm chứng, release ID cũ và backup/env tương ứng.
2. Giải nén ZIP cũ vào `/opt/biddingflow/releases/<old-id>-rollback-<UTC>/code`; verify checksum và helper inventory trước import. Tạo venv/npm/browser cho wrapper này như mục 5 hoặc liên kết đến runtime cũ **bên ngoài `code/`** còn nguyên, đã kiểm chứng.
3. Chạy `prepare_frontend_asset_compatibility.py --current-release <rollback-wrapper>/code --expected-current-release-id <old-id> --previous-release <candidate-wrapper>/code` bằng `python -B`.
4. Khôi phục web/smoke env phù hợp release ID cũ; đổi một symlink `current` đến rollback wrapper rồi restart worker/web/nginx; chạy private live/ready và verifier.
5. Start Tunnel, chạy `production_smoke.py --mode rollback` với expected release ID cũ và public HTTPS; nếu thất bại, dừng traffic và giữ log. Không gọi rollback thành công chỉ vì symlink đã đổi.

Nếu cần rollback dữ liệu: lưu forensic snapshot hiện tại, restore bản backup đã verify sang **database mới/cách ly** bằng `backup.py restore --snapshot <path>` với `DATABASE_URL` của DB đích và các asset path đích riêng; thực hiện bằng role owner/migrator được DBA cấp. Verify schema/FK/files, provision role lại, đổi scoped credential fragments sang DB restore, smoke staging rồi cutover có kiểm soát. Job `restore` xóa/thay dữ liệu tại DB đích; không dùng URL primary. Giữ DB lỗi để điều tra, không ghi đè backup.

## 13. Bàn giao vận hành và bằng chứng cuối

Chưa có VPS/domain/credential production trong lần rà soát này; không coi local test hoặc tài liệu là bằng chứng Linux/staging/production đã đạt. Người triển khai ghi vào biên bản riêng các mục sau, không ghi secret:

### Kết quả xác minh tại workspace ngày 01/10/2026

Gói bàn giao tại `release/biddingflow-production.zip`, checksum tại `release/biddingflow-production.zip.sha256`:

- Release ID: `4307491c3ea0ac34c88b1f182a5c1a51132cd9814fc88db322a4714de5732574`.
- SHA-256 ZIP: `da7f0ebb1293451162cec8d4302baeb52f206c5ee79d843d21d15eac1d5f41d5`.
- ZIP: **882 file runtime, 5.197.816 byte**; đã đối chiếu từng size/hash với manifest. Không có `.md`, `.map`, `.pyc`, `.log` hoặc `.env` thật trong ZIP. Release ID nhận diện nguồn frontend; checksum ZIP và manifest nhận diện toàn bộ gói. Working tree có thay đổi chưa commit.

| Kiểm chứng local | Kết quả |
| --- | --- |
| `npm run check:static` | Exit 0; 364 module, không cycle/unresolved/orphan |
| Python full coverage | Exit 0; **2.519 pass, 1 skip**; skip do Windows không cấp quyền tạo symlink (`WinError 1314`) |
| Python regression sau sửa cuối | Exit 0; **55 pass, 0 skip**; coverage kết hợp **65,11%**, 16 critical module đạt ratchet. Full run đã bắt đầu trước sửa conflict capture; 55 ca này kiểm chứng bản sửa cuối |
| Guard database concurrency test | Exit 0; **7 pass** gồm 5 ca từ chối URL không phải DB test và 2 ca concurrency trên PostgreSQL thật |
| `npm run test:js:coverage` | Exit 0; **2.067 pass, 0 fail/skip**; lines 57,09%, branches 66,86%, functions 70,05%; 14 critical module đạt ratchet |
| JS regression race/session/workspace | Exit 0; **74 pass** |
| Regression deployment/packaging | Exit 0; 65 ca focused, thêm 31 ca worker/preflight; có ca trùng giữa các lượt, không cộng thành tổng độc lập |
| E2E Chromium/Firefox/WebKit full | **100 pass, 2 skip, 0 fail/flaky**, 661,39 giây; hai skip là gesture dùng CDP chỉ hỗ trợ Chromium. JSON/JUnit full được lưu tại `D:\Bidding-audit-20261001\e2e-after-harness-fixes\test-results` |
| PowerShell E2E runner | Full browser run trên có exit wrapper 1 do cảnh báo Node bị PowerShell 5 coi là exception. Đã sửa runner kiểm tra npm exit code; rerun WebKit analytics với cảnh báo cưỡng bức đạt **1 pass, exit 0**. Trường hợp không tìm được test vẫn exit 1; không chạy lại full 102 ca sau sửa runner |
| Dependency audit | `npm audit`, `npm audit --omit=dev`, `pip-audit -r requirements.txt` đạt, không phát hiện vulnerability đã biết tại thời điểm chạy |
| Secure build/package | Exit 0; 168 bundle obfuscated; `python scripts/package_production.py --check` đạt với 882 file / 5.197.816 byte và smoke runtime sau giải nén |
| Database disposable | Fresh init, preflight, dry-run rollback đạt schema 98; 145 table / 655 index / 104 trigger, 216 FK không thiếu index |
| Guide syntax | 19 Bash block đạt `bash -n`; Python nhúng parse AST đạt. Chỉ là kiểm tra cú pháp |
| Linux/systemd/domain/host sandbox/public smoke/production restore và rollback | **Chưa chạy trên VPS** |

Các lỗi đã sửa: phản hồi session cũ và forced cleanup ghi/xóa session mới; confirmation mutation hoặc refresh cũ tác động workspace mới; query đồng bộ của Word job chặn ASGI event loop; conflict draft capture đồng thời vượt cap hoặc lỗi unique. Đã sửa thêm tính nguyên tử của ZIP, dependency Node của browser worker, standalone import của preflight, kiểm tra AppArmor và private health/Host trong deployment smoke. Giữ nguyên quyền, scope và dữ liệu bản ghi đã được phép đọc.

Hai lỗi harness E2E đã được điều chỉnh: không đọc response body không cần thiết sau HTTP save thành công khi Chromium có thể đã chuyển document; phép đo dropdown sau resize đưa mục tiêu vào viewport bằng cuộn tức thời và đọc hai rectangle cùng frame. Giữ nguyên kiểm tra lưu/reload/assignment, click thật, giới hạn vị trí và timeout. WebKit admin 16/16, WebKit analytics lặp 3/3, Chromium/Firefox analytics 2/2, Chromium specialist lặp 3/3 đạt trước lượt full cuối.

Runner PowerShell giữ cảnh báo stderr của npm hiển thị, quyết định thành công theo exit code và phục hồi `ErrorActionPreference` sau lệnh; lỗi npm thực vẫn kết thúc suite. Thay đổi này chỉ thuộc công cụ audit, không nằm trong ZIP runtime.

Bằng chứng được lưu ngoài repo tại `D:\Bidding-audit-20261001`. Sau khi khôi phục root `favicon.png` theo phản hồi của chủ sản phẩm, còn **1.384 file dư/cache, 3.291.341.558 byte (khoảng 3,29 GB)** được chuyển khỏi ứng dụng vào `D:\Bidding-cleanup-archive-20261001`; `moved-files-manifest.json` có đường dẫn gốc, size, SHA-256 và trạng thái khôi phục. Giữ cả favicon nguồn ở thư mục gốc và favicon đang được phục vụ, skill/agent (`.agents`: 23 file; `.codex`: 302 file), dữ liệu vận hành, backup, template, release rollback, test và tài liệu sản phẩm; hai symbol map đang được ZIP hiện tại/rollback tham chiếu vẫn được giữ. Kết quả này không chứng minh ứng dụng hoàn toàn không còn bug; các bước host và workflow trên domain thật vẫn phải hoàn tất theo hướng dẫn.

| Bằng chứng | Giá trị cần ghi |
| --- | --- |
| Release | Release ID, SHA-256 ZIP, manifest, thời điểm và người duyệt |
| Kiểm tra local | Lệnh, exit code, số pass/fail/skip của full tests/static/audit/build/package extracted smoke |
| Host | Ubuntu/kernel, Python/Node/PostgreSQL actual, đơn vị systemd, private listener/firewall/TLS |
| Document worker | Evidence JSON, sandbox dưới account thật, một job Word và một job Excel hoàn tất |
| Dữ liệu | Fresh/upgrade rehearsal, backup off-host verified, restore drill và RPO/RTO thực đo |
| Public | DNS/HTTPS, deploy/rollback smoke JSONL đúng release, browser workflows và tính năng đã bật |
| Vận hành | Cảnh báo service/503/429, dung lượng, tuổi backup/drill, queue, email outbox, rotation và off-host audit |

Theo dõi log lỗi đã redaction, quyền đọc record vẫn theo business contract. Không thu CCCD, tài khoản ngân hàng, cookie/token hoặc toàn bộ response vào telemetry để chẩn đoán. Không xóa release cũ/backup khi chưa qua thời gian lưu và rollback rehearsal. Sau đổi release, nếu edge từng cache lỗi hashed asset thì purge cached error sau khi origin phục hồi; không yêu cầu mọi người xóa cache trình duyệt để che deployment lỗi.

**Tiêu chí hoàn tất:** artifact đúng checksum; host verifier và private readiness đạt; public login/version/read/sync smoke đạt; chức năng cần thiết kiểm chứng; backup/restore/rollback và giám sát hoạt động. Các phần chưa chạy phải ghi rõ “chưa kiểm chứng”, không ghi “production-ready”.
