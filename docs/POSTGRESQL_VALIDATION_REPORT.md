# Báo cáo triển khai và kiểm chứng PostgreSQL

> Ngày kiểm chứng: 19/07/2026  
> Phạm vi: fresh install; không nhập, giữ, đối soát hay chuyển đổi dữ liệu SQLite cũ  
> Ràng buộc UI: không thay đổi `frontend/**`, `views/**`, CSS, Vite hoặc hợp đồng hiển thị

## 1. Kết luận

Backend BiddingFlow đã chuyển sang PostgreSQL-only. Fresh schema, transaction, audit chain, sync version, websocket outbox, session đa worker, backup/restore, metrics, readiness và quyền database runtime đã được kiểm chứng cục bộ. Gói production không chứa `.env`, dữ liệu runtime, test, source frontend hoặc công cụ SQLite cũ.

Hai release gate còn phụ thuộc môi trường thật, không thể xác nhận trung thực trên máy phát triển:

1. Xác minh TLS `verify-full`, secret manager, reverse proxy, cookie/CORS và chứng thư của nhà cung cấp trên staging production-equivalent.
2. Import Prometheus/Grafana vào hạ tầng thật và tổ chức diễn tập cảnh báo với on-call.

## 2. Kiến trúc đã triển khai

- `psycopg` connection pool với giới hạn min/max, timeout, lifetime và application name cấu hình bằng biến môi trường.
- Một canonical fresh schema PostgreSQL, khóa advisory cho khởi tạo đồng thời, baseline schema version duy nhất và startup verify-only cho runtime production.
- 48 bảng, 634 cột và 79 khóa ngoại; trigger tenant/workspace, row version, timestamp, audit immutability và index quan trọng.
- Runtime role tách khỏi migration role. Runtime có DML cần thiết nhưng không có DDL, superuser hoặc quyền tạo schema.
- Read/write work queue có giới hạn để tạo backpressure thay vì tăng thread và kết nối vô hạn.
- Audit chain theo tenant, khóa hàng và checkpoint ký HMAC; ghi đồng thời không tạo fork.
- Websocket outbox bền vững kết hợp PostgreSQL `NOTIFY/LISTEN`, replay sau reconnect và delivery giữa process/instance.
- Readiness kiểm tra kết nối và schema; khi database dừng, ứng dụng trả 503 và tự hồi phục sau khi PostgreSQL hoạt động lại.
- Backup dùng `pg_dump`, manifest/hash ký, kiểm tra toàn vẹn, retention và restore drill bằng `pg_restore`.
- Metrics cho HTTP, queue, event-loop lag, PostgreSQL pool/size/timeout, audit, websocket outbox, backup và restore drill.

## 3. Bằng chứng kiểm thử tự động

Lệnh cuối:

```powershell
python -m pytest -q tests
```

Kết quả cuối sau chuẩn hóa múi giờ: **17 passed** trong 17,45 giây.

Phạm vi được kiểm tra:

- Fresh schema contract và khởi tạo lặp lại an toàn.
- Chuyển placeholder qmark mà không làm hỏng literal/comment SQL.
- Transaction rollback.
- Trigger workspace từ chối personal owner không hợp lệ.
- Sync version duy nhất dưới tải ghi đồng thời.
- Audit chain không fork dưới tải đồng thời và audit row bất biến.
- Runtime role không có DDL.
- Database default, app connection, API serializer và Word context đều dùng `Asia/Ho_Chi_Minh`; `09:00+07` được kiểm tra tương ứng đúng với cùng một Unix instant.
- Runtime startup với `DATABASE_AUTO_MIGRATE=false` vẫn phục vụ đọc có xác thực.
- Empty schema + auto-migrate tắt làm startup fail-closed.
- CSRF, payload limit, authentication và API contract.
- Vòng đời personal/organization membership và dashboard summary PostgreSQL.
- Hai instance, mỗi instance hai Uvicorn worker, dùng chung session/database.
- PostgreSQL broker chuyển websocket event giữa worker/instance.

Kiểm tra build và gói phát hành:

```powershell
npm run build:secure
python scripts/package_production.py --check
python -m compileall -q backend scripts tests
git diff --check
```

Kết quả: build thành công; 154 module frontend được đóng gói; production allowlist hợp lệ với 226 file runtime; Python compile sạch; diff không có whitespace error. Kiểm tra `git diff -- frontend views vite.config.js package.json package-lock.json` không có đầu ra.

## 4. Hiệu năng và chịu tải

Cấu hình rehearsal: PostgreSQL local, 4 Uvicorn worker, 64 client đồng thời, pool/queue hữu hạn.

### Chạy 30 giây

| Chỉ số | Kết quả |
|---|---:|
| Tổng request | 13.683 |
| Throughput | 453,35 req/s |
| HTTP lỗi | 0 |
| p50 tổng | 71,02 ms |
| p95 tổng | 203,93 ms |
| p99 tổng | 570,55 ms |
| `initial_data` p95 | 251,42 ms |
| `sync_version` p95 | 156,15 ms |
| `sync_write` p95 | 1.384,81 ms |
| `sync_write` p99 | 1.921,02 ms |

### Soak cục bộ 60 giây

| Chỉ số | Kết quả |
|---|---:|
| Tổng request | 24.498 |
| Throughput | 406,36 req/s |
| HTTP lỗi | 0 |
| p50 | 87,46 ms |
| p95 | 299,18 ms |
| p99 | 882,39 ms |

Hot-tenant sync write được tuần tự hóa có chủ đích để bảo toàn version/audit. Kết quả p95/p99 vẫn thấp hơn SLO tương ứng 2/4 giây. Không còn process worker mồ côi sau các lần rehearsal.

Các con số local chỉ là release gate kỹ thuật, không thay thế benchmark trên kích thước dữ liệu, network, CPU, storage IOPS và connection proxy production thực tế.

## 5. Backup, phục hồi và lỗi hạ tầng

- Backup gần nhất được xác minh: `biddingflow-backup-20260718T210319Z`.
- `pg_dump`: 286.989 byte; manifest/hash hợp lệ.
- Restore drill sang database rỗng thành công và marker ký được xác minh.
- Bản sao backup bị sửa kích thước bị verifier từ chối đúng với exit code 1.
- Khi PostgreSQL dừng, `/health/ready` trả 503; khi PostgreSQL khởi động lại, readiness trở về 200 mà không cần khởi động lại ứng dụng.
- Runtime role đọc/ghi nghiệp vụ được nhưng DDL bị PostgreSQL từ chối với `InsufficientPrivilege`.

## 6. Kiểm thử trình duyệt và tính bất biến UI

Đã dùng cùng frontend hiện có để kiểm thử trực tiếp backend PostgreSQL:

- Đăng nhập Super Admin, Manager, nhân viên tổ chức và người dùng personal-only.
- Các route desktop: tổng quan, kế hoạch, gói thầu, timeline, hợp đồng, chủ đầu tư, nhà thầu, chuyên gia và biểu mẫu.
- Route Super Admin: tổng quan admin, quản lý tài khoản và modal thiết lập.
- Route Manager: nhân sự và trạng thái hồ sơ.
- CRUD trạng thái có tiếng Việt: thêm, sửa, xóa thành công.
- Workspace: người vừa có cá nhân vừa thuộc tổ chức chọn được `Cá nhân`/tổ chức; xuất Word bị khóa ở gói cá nhân miễn phí và bật theo quyền tổ chức.
- Người chỉ có personal workspace không thấy workspace selector dư thừa.
- Responsive 390 × 844 trên toàn bộ 9 route chính: không có horizontal overflow (`scrollWidth = 390`).
- Sau khi sửa dashboard summary SQL, phiên trình duyệt sạch không còn console error/warning liên quan request dashboard.

Không có file frontend/view/CSS/Vite nào bị chỉnh sửa trong công việc PostgreSQL. Vì ràng buộc này, mọi nhãn giao diện hard-code có chữ “SQLite” từ trước vẫn được giữ nguyên; việc đổi nội dung đó cần một yêu cầu UI riêng.

## 7. Bảo mật và vận hành

- `.env` bị loại khỏi Git/package; tài liệu và báo cáo không ghi giá trị bí mật.
- Production yêu cầu `sslmode=verify-full`; startup từ chối cấu hình production không an toàn.
- Secret/checkpoint key, cookie secure, origin allowlist, trusted proxy, re-auth, rate limit, request size và websocket limit đều có cấu hình explicit.
- Structured log mặc định không lộ exception detail; application name giúp truy vết session PostgreSQL.
- Prometheus alerts bao phủ target down, 5xx/429, latency, event-loop lag, queue pressure, PostgreSQL lock/pool wait, audit verifier, disk, backup và restore drill.
- Runbook: `docs/RUNBOOK.md`; systemd migration/runtime/backup và dashboard/alert mẫu nằm trong `deploy/`.

## 8. Quyết định rollback cho fresh install

Trước khi nhận dữ liệu khách hàng, rollback là dừng candidate, sửa lỗi và tạo lại PostgreSQL database rỗng. Không quay về SQLite, không dual-write và không reverse-migrate. Sau khi có dữ liệu production, mọi thay đổi schema tiếp theo phải dùng expand/contract và rollback ứng dụng tương thích ngược; đây là point-of-no-return của fresh install.

## 9. Việc bắt buộc trước khi mở traffic production

1. Dựng staging cùng nhà cung cấp PostgreSQL, TLS certificate, region và class storage dự kiến dùng thật.
2. Chạy load/soak ít nhất 2 giờ với dataset đại diện, đo CPU/IOPS/WAL/lock/pool và chỉnh pool theo tổng số instance × worker.
3. Xác minh backup/PITR của nhà cung cấp và diễn tập restore sang instance độc lập.
4. Import dashboard/alert, kiểm tra route đến on-call và thực hiện một buổi game day database unavailable.
5. Chạy security review có bằng chứng cho secret manager, proxy headers, CORS, cookie, network ACL và quyền role.
6. Chỉ mở traffic khi hai release gate phụ thuộc hạ tầng ở mục 1 được ký duyệt.
