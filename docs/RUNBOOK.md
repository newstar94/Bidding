# BiddingFlow production runbook

## Metrics, SLO và cảnh báo

1. Kiểm tra `/health/live`, `/health/ready` và mục tiêu Prometheus trước.
2. Đối chiếu tỷ lệ 5xx, p95/p99, event-loop lag, worker queue và PostgreSQL pool trong cùng cửa sổ 15 phút.
3. Không restart hàng loạt. Loại từng instance khỏi load balancer, lưu log/request ID rồi restart tuần tự.
4. Nếu rollback ứng dụng, không hạ schema. Chỉ dùng release cũ khi `database_metadata.schema_version` nằm trong dải release đó hỗ trợ.
5. Prometheus/agent, Node Exporter và PostgreSQL Exporter chỉ nghe loopback/private
   network. Import `deploy/grafana/biddingflow-overview.json` và nạp
   `deploy/prometheus/biddingflow-alerts.yml`; kiểm tra mọi alert có receiver
   thực tế bằng một cảnh báo thử trước khi public.
6. Theo dõi CPU/RAM/descriptor theo từng worker, còn disk/WAL/lock/queue dùng
   giá trị toàn cụm (`max`, không `sum`) để tránh đếm lặp khi scrape nhiều
   worker cùng đọc một PostgreSQL.

## PostgreSQL pool và lock

1. Xác nhận `biddingflow_postgres_pool_value{stat="requests_waiting"}`, `pool_available`, timeout theo lane và số worker đang chạy.
2. Trên PostgreSQL, kiểm tra `pg_stat_activity`, `pg_locks`, transaction `idle in transaction`, query chậm và connection theo `application_name`.
3. Hủy query gây nghẽn trước; chỉ terminate session khi đã xác định tác động transaction. Không tăng pool mù quáng vì tổng `instances × workers × pool_max` phải nhỏ hơn ngân sách kết nối.
4. Nếu pool cạn do tải hợp lệ, giảm concurrency ở proxy/worker queue, sau đó điều chỉnh index/query dựa trên `EXPLAIN (ANALYZE, BUFFERS)` ở staging.
5. Nếu database không phản hồi, ngừng nhận mutation mới bằng cách loại instance khỏi load balancer; giữ bằng chứng và chuyển sang quy trình failover của nhà cung cấp PostgreSQL.

## Ngân sách connection và thời điểm dùng PgBouncer

Ứng dụng tự đọc `SHOW max_connections` khi production khởi động và fail closed
nếu cấu hình vượt ngân sách:

```text
application = APP_INSTANCE_COUNT × UVICORN_WORKERS
              × (DATABASE_POOL_MAX_SIZE + DATABASE_DEDICATED_CONNECTIONS_PER_WORKER)
cluster total = application + DATABASE_RESERVED_CONNECTIONS
```

Với cấu hình mẫu `1 × 4 × (8 + 1) + 20 = 56`, PostgreSQL phải có
`max_connections > 56`. Phần dự phòng 20 connection dành cho migrator,
monitoring, backup và xử lý sự cố; không được dùng để tăng pool web.

Một instance chưa cần PgBouncer. Khi scale khiến tổng pool tiến gần 70–80%
`max_connections`, đặt PgBouncer ở transaction-pooling cho lưu lượng CRUD,
tắt prepared statement phía client nếu cấu hình proxy không hỗ trợ và chạy lại
bài test multiworker trước khi chuyển traffic. Kết nối `LISTEN/NOTIFY` của
WebSocket broker cần session affinity nên phải dùng URL PostgreSQL trực tiếp
riêng, không đi qua transaction pooling. Migrator, backup và monitoring cũng
dùng URL trực tiếp, credential tách biệt.

Mỗi thay đổi số instance, Uvicorn worker hoặc pool phải cập nhật đồng thời
`APP_INSTANCE_COUNT`, `UVICORN_WORKERS` và chạy lại load rehearsal. Không cho
production khởi động nếu phép tính startup báo không an toàn.

## Job nền bền vững

- Email nhạy cảm được mã hóa bằng `EMAIL_OUTBOX_ENCRYPTION_KEY`, lưu trong
  `email_delivery_status`, claim bằng `FOR UPDATE SKIP LOCKED`, retry hữu hạn
  rồi chuyển `failed`. Không log hoặc lưu plaintext mật khẩu tạm.
- Tra cứu nhà thầu dùng `partner_enrichment_jobs` với cùng nguyên tắc claim,
  retry/dead-letter; không giữ connection trong lúc gọi upstream.
- Công việc tài liệu ghi manifest và sidecar đã băm vào thư mục job riêng,
  lưu trạng thái trong `document_jobs`, phục hồi claim bị bỏ dở và chỉ giữ kết
  quả trong thời hạn cấu hình. Khi có nhiều instance, mount một volume riêng,
  mã hóa và dùng chung tại `DOCUMENT_WORKER_TEMP_DIR`, sau đó đặt
  `DOCUMENT_WORKER_SHARED_STORAGE_CONFIRMED=true`; volume này không được chứa
  source, `.env`, backup hoặc PostgreSQL socket.
- Quota WebSocket dùng lease PostgreSQL có TTL nên được tính trên toàn cụm và
  tự thu hồi sau khi worker chết.
- Retention, email cleanup và xuất audit checkpoint dùng advisory lock. Cache
  cleanup trong RAM vẫn chạy ở từng process vì cache là process-local.

Khi `biddingflow_background_jobs{status="failed"}` tăng, lọc theo nhãn `queue`:
email cần kiểm tra SMTP và cấu hình người gửi; partner cần kiểm tra circuit
breaker/upstream; document cần kiểm tra sandbox, storage và manifest. Không sửa
trực tiếp payload đã mã hóa hoặc đổi trạng thái DB. Sau khi khắc phục nguyên
nhân, dùng quy trình retry có kiểm soát của service hoặc tạo lại yêu cầu nghiệp
vụ; giữ bản ghi failed để điều tra trong thời hạn retention.

## Nén, cache và CDN cho frontend

1. Áp dụng `deploy/nginx-biddingflow.conf.example` và chạy `nginx -t` trên host
   đích. Nginx nén JS/CSS/JSON/SVG bằng gzip, trả `Vary: Accept-Encoding` và
   chỉ đặt immutable một năm cho `/dist/assets/`.
2. Trước mỗi release, chạy `python scripts/package_production.py --check`.
   Packager từ chối asset không có content hash, asset thừa ngoài Vite
   manifest, file `.map` và cả chỉ dẫn `sourceMappingURL`.
3. Kiểm tra header trên staging:

   ```bash
   curl --compressed -I https://bidding.example.com/dist/assets/<asset-hash>.js
   curl -I https://bidding.example.com/api/sync-version
   ```

   Asset phải có `Content-Encoding: gzip` khi đủ lớn và
   `Cache-Control: public, max-age=31536000, immutable`; API phải có
   `Cache-Control: no-store`.
4. Ứng dụng hiện phục vụ tại Việt Nam/một vùng nên CDN chưa bắt buộc. Khi mở
   nhiều vùng, chỉ đưa `/dist/assets/` qua CDN, giữ nguyên cache key có
   `Accept-Encoding`, bắt buộc TLS tới origin. Không cache `/api/**`, `/ws/**`,
   HTML, cookie hoặc response theo người dùng ở shared CDN.

## PostgreSQL query, autovacuum và WAL

1. Áp dụng `deploy/postgresql-production.conf.example` qua parameter group hoặc
   `postgresql.conf`, restart PostgreSQL, rồi dùng credential quản trị chỉ trong
   job vận hành:

   ```bash
   export PERFORMANCE_DATABASE_URL='postgresql://...'
   python scripts/postgres_performance_audit.py \
     --enable-extension --require-pg-stat-statements
   ```

   Không đưa `PERFORMANCE_DATABASE_URL`, admin URL hoặc monitoring credential
   vào environment của web service.
2. Thu số liệu sau một cửa sổ tải đại diện:

   ```bash
   python scripts/postgres_performance_audit.py \
     --require-pg-stat-statements --top 30 --explain \
     --output /var/lib/biddingflow/diagnostics/postgres-performance.json
   ```

   So sánh `total_exec_ms`, `mean_exec_ms`, calls, rows, cache hit/read,
   temporary blocks và WAL bytes; không tối ưu chỉ từ một lần chạy development.
3. Chạy `EXPLAIN (ANALYZE, BUFFERS, WAL)` trên staging có dữ liệu gần production.
   Script `seed_performance_data.py` chỉ được dùng với database có tên chứa
   `test`, `load`, `perf` hoặc `dev` và bắt buộc `--confirm-disposable`.
4. Điều tra khi dead tuple tăng liên tục, autovacuum không chạy, temp bytes/WAL
   tăng bất thường hoặc transaction `idle in transaction` kéo dài. Không
   `VACUUM FULL`, reset `pg_stat_statements` hay xóa index trên production trong
   giờ cao điểm mà chưa có kế hoạch lock/dung lượng/rollback.

## PostgreSQL runtime role và tenant isolation

1. Chạy migration/configure role trong job riêng có secret riêng; không mount
   secret admin/migrator vào web worker. Sau job, kiểm tra runtime role bằng chính
   `DATABASE_URL` sẽ dùng để chạy ứng dụng.
2. Runtime role phải không có role membership, ownership database/schema/bảng/
   sequence/function, `SUPERUSER`, `CREATEDB`, `CREATEROLE`, replication,
   `BYPASSRLS`, database `CREATE/TEMP` hoặc schema `CREATE`. `search_path` chỉ là
   `public`; quyền bảng chỉ gồm `SELECT/INSERT/UPDATE/DELETE`.
3. PostgreSQL chỉ lắng nghe private network và bắt buộc TLS
   `sslmode=verify-full`. Không đặt `DATABASE_PRIVATE_NETWORK_CONFIRMED=true`
   trước khi firewall/security group và `pg_hba.conf` đã được kiểm chứng.
4. BiddingFlow hiện giữ tenant context tường minh ở API/repository và dùng khóa/
   ràng buộc ghép `organization_id`; chưa bật RLS vì connection pool chưa đặt
   transaction-local tenant context trên mọi giao dịch. Không bật RLS từng phần:
   việc đó tạo cảm giác an toàn giả và có thể rò context giữa request. Mọi đường
   đọc/ghi mới phải qua kiểm thử thiếu `X-Active-Org` và truy cập ID tenant khác.
5. Khi ACL startup thất bại, không hạ kiểm tra. Chạy lại
   `scripts/configure_database_roles.py` bằng credential quản trị trong job cô
   lập, thu hồi membership/ownership thừa, rồi khởi động lại từng worker.

## Host header và reverse proxy

1. `ALLOWED_HOSTS` production chỉ chứa hostname của `APP_PUBLIC_URL`, không có
   scheme, port hay wildcard. Request dùng Host khác phải bị ứng dụng trả 400.
2. Nginx default server phải trả 444 cho hostname lạ; virtual host hợp lệ chuyển
   Host cố định bằng `$server_name`, ghi đè `X-Forwarded-For/Proto` và xóa header
   `Forwarded` do client gửi.
3. Uvicorn chạy `--no-proxy-headers`. Ứng dụng chỉ giữ `X-Forwarded-For`,
   `X-Real-IP` và `X-Forwarded-Proto` khi socket peer nằm trong
   `TRUSTED_PROXY_CIDRS`; `X-Forwarded-Host` luôn bị loại.
4. Link reset/OTP lấy origin duy nhất từ `APP_PUBLIC_URL`. Không chuyển sang dùng
   `request.url`, Host hoặc forwarded host khi thêm email/OAuth flow mới.

## Audit chain không hợp lệ

1. Đặt readiness về fail-closed và ngừng mutation; không xóa/sửa `audit_log` hay `audit_chain_heads`.
2. Lưu checkpoint v2 gần nhất, log bảo mật và snapshot database để điều tra.
3. Chạy verifier trên bản sao cô lập. So sánh từng `chain_id`, `sequence`, `previous_hash`, `entry_hash` và head materialized.
4. Chỉ mở lại traffic sau khi nguyên nhân, phạm vi tenant và quyết định phục hồi được phê duyệt; không “sửa hash cho khớp”.

## Backup và restore diễn tập

```bash
python scripts/backup.py verify --snapshot <snapshot>
python scripts/backup.py drill --snapshot <snapshot>
python scripts/backup.py drill-latest
```

`RESTORE_DRILL_DATABASE_URL` phải là database cô lập. Drill thành công tạo marker
được ký Ed25519; web/metrics chỉ giữ `BIDDING_RESTORE_DRILL_PUBLIC_KEY` để xác
thực, còn `BIDDING_RESTORE_DRILL_PRIVATE_KEY` chỉ nằm trong secret scope của
service restore drill. Marker mặc định đặt tại
`/var/lib/biddingflow/observability/last-restore-drill.json`.

Tách tối thiểu ba file môi trường, quyền `0600`, chủ sở hữu đúng service:

- `biddingflow.env`: chỉ runtime DSN và public key; không có admin, migrator,
  backup DSN hoặc private signing key.
- `biddingflow-backup.env`: `BACKUP_DATABASE_URL` của role chỉ đọc,
  `BIDDING_BACKUP_DIR`, media path và retention.
- `biddingflow-restore-drill.env`: primary DSN chỉ để so sánh đích,
  `RESTORE_DRILL_DATABASE_URL`, private signing key, RPO/RTO và state path.

Sao chép snapshot sang object storage/off-site đã mã hóa, bật immutability/object
lock và retention độc lập với máy ứng dụng. `BIDDING_BACKUP_RETENTION_COUNT` chỉ
dọn snapshot cục bộ có tên hợp lệ; không thay thế retention off-site. Kích hoạt
`biddingflow-restore-drill.timer` để diễn tập hàng tháng. Kiểm tra RPO bằng tuổi
backup, RTO bằng thời gian từ lúc bắt đầu restore đến khi schema/FK xanh. Không
chạy `restore` trực tiếp vào production khi chưa đóng traffic và chưa có phê
duyệt sự cố.

## WebSocket outbox tồn đọng

1. Kiểm tra `biddingflow_websocket_outbox_rows` và tuổi event cũ nhất.
2. Xác minh các worker giữ kết nối LISTEN/NOTIFY, database connectivity và log broker.
3. Restart tuần tự một worker để xác nhận replay theo event id; không xóa outbox thủ công khi client chưa bắt kịp.

## Tra cứu đối tác bị gián đoạn

1. Đối chiếu `biddingflow_partner_upstream_requests_total` theo `upstream`/`outcome` và `biddingflow_partner_lookup_requests_total{outcome="busy"}` trong cùng cửa sổ.
2. Lọc sự kiện `partner.lookup_request` theo `organizationId` để xác định tenant bị ảnh hưởng; không đưa mã số thuế hoặc tên doanh nghiệp vào metric/log vận hành.
3. Nếu circuit đang mở, không tăng retry hoặc concurrency ngay. Kiểm tra DNS, TLS và trạng thái nhà cung cấp; chờ half-open probe hoặc khôi phục upstream rồi xác nhận counter `found|not_found`.
4. Nếu `busy` tăng nhưng upstream khỏe, kiểm tra số instance/worker và cấu hình `PARTNER_LOOKUP_MAX_CONCURRENCY`; tổng outbound thực tế bằng số process nhân giới hạn mỗi process.
5. Không xóa cache dương khi upstream lỗi. Chỉ xóa cache bằng công cụ quản trị sau khi xác nhận dữ liệu sai; cache âm tự hết hạn nhanh hơn.

## Dung lượng thấp

1. Xác định volume media, backup hay runtime bị đầy.
2. Dọn artifact đã hết retention bằng công cụ vận hành; không xóa PostgreSQL data/WAL thủ công.
3. Mở rộng volume trước khi VACUUM/backup lớn nếu free space dưới ngưỡng an toàn.
