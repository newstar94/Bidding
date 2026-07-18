# Kế hoạch cải thiện BiddingFlow trước production

Ngày cập nhật: 18/07/2026

Phạm vi triển khai: cài mới hoàn toàn, không chuyển dữ liệu SQLite cũ.

Database production mục tiêu: PostgreSQL.

File này chỉ giữ các công việc **chưa hoàn thành**. Mỗi mục chỉ được xóa sau khi có
bằng chứng kiểm thử đạt; các phần code và test local đã hoàn tất đã được loại khỏi
kế hoạch theo yêu cầu.

## 1. Cổng bảo mật và ingress còn lại

- [ ] Chạy document worker bằng principal/container riêng ở cấp hệ điều hành; chỉ
  mount job directory và template cần thiết, chặn network bằng firewall/network
  namespace, và không cấp quyền đọc database, source hoặc uploads ngoài job.
- [ ] Kiểm chứng `limit_req`, `limit_conn`, body limit, concurrency cap và
  WebSocket quota trên reverse proxy thật; xác nhận đúng `413`, `429`, `503` và
  `Retry-After`, đồng thời server phục hồi sau burst.

## 2. Backup, audit, monitoring và release gate

- [ ] Replicate full-state backup và audit checkpoint sang object storage off-host
  bất biến/WORM, bật retention lock và cảnh báo backup quá hạn.
- [ ] Bắt buộc một backup đã verify trước migration hoặc phát hành có thay đổi
  schema.
- [ ] Diễn tập restore toàn ứng dụng sang máy/môi trường tách biệt hàng tháng và
  trước release lớn; ghi RPO/RTO thực tế bằng `scripts/record_restore_drill.py`.
- [ ] Triển khai Prometheus, Grafana và Alertmanager thật; kiểm chứng dashboard,
  alert delivery và người trực cho latency, 5xx/429, event-loop lag, DB pool/lock,
  queue, disk, backup và audit-chain failure.
- [ ] Bật branch protection cho job `release-gate` và reviewer bắt buộc của GitHub
  `production` environment.

## 3. Capacity và tích hợp production

- [ ] Chạy mixed load/soak đủ lâu trên staging/performance cô lập, gồm mốc 100
  concurrent active users nếu đó là mục tiêu business.
- [ ] Ghi và phê duyệt capacity envelope gồm concurrent users, QPS, p50/p95/p99,
  error rate, event-loop lag, DB wait/lock, pool/queue depth, CPU, RAM, disk/IO và
  thời gian phục hồi sau burst.
- [ ] Cấu hình Google OAuth origin/redirect URI production và kiểm thử bằng tài
  khoản thật.
- [ ] Kiểm thử email OTP qua nhà cung cấp thật: gửi, resend, expiry, reuse, rate
  limit và cảnh báo email cũ.
- [ ] Kiểm tra thủ công keyboard-only, screen reader, zoom 200% và bảng trên thiết
  bị mobile thật.
- [ ] Upload private source map theo đúng release lên error-tracking provider và
  xác minh stack trace; source map không được xuất hiện trong web/package public.

Hướng dẫn tải và tiêu chí SLO nằm tại [LOAD_TESTING.md](LOAD_TESTING.md). Pipeline
source-map và vận hành nằm tại [RUNBOOK.md](RUNBOOK.md).

## 4. PostgreSQL production

### PG-0 — Quyết định hạ tầng và chi phí

- [ ] Chốt vùng triển khai, rolling-deploy topology và lựa chọn PostgreSQL managed
  hoặc self-hosted; gắn owner và ngân sách.
- [ ] So sánh TCO trong cùng RPO/RTO và tải mục tiêu, gồm primary, standby,
  backup/PITR, IOPS, monitoring, secret/KMS, staging và tăng trưởng dữ liệu 12 tháng.
- [ ] Phê duyệt ADR capacity và rollback condition sau khi có kết quả staging.

Không chọn cấu hình làm mất PITR, failover hoặc IOPS cần thiết chỉ để giảm giá.
Quyết định hiện tại và các trường dữ liệu cần điền nằm tại
[ADR_PG0_DATABASE_CAPACITY_DECISION.md](ADR_PG0_DATABASE_CAPACITY_DECISION.md).

### PG-1 — Kết nối production

- [ ] Bật TLS với CA validation, secret rotation và role riêng cho migrator,
  application read/write, backup và monitoring trên dịch vụ PostgreSQL thật.
- [ ] Xác nhận connection budget với giới hạn của nhà cung cấp cho hai application
  instance thường trực và một rolling-surge instance.

### PG-3 — SLO trên workload mục tiêu

- [ ] PostgreSQL đạt SLO mixed workload với pool, ingress và tài nguyên đã chốt;
  lưu raw results và revision-bound evidence.

### PG-4 — Rehearsal cài mới, phát hành và rollback

- [ ] Chạy fresh-install rehearsal trên staging cùng PostgreSQL provider, TLS/CA,
  secret manager và network policy sẽ dùng thật.
- [ ] Provision file/object storage rỗng cho uploads, ảnh và Word template; xác
  minh ACL, mã hóa, backup và restore trước file đầu tiên.
- [ ] Chạy smoke login/read/write/pagination/WebSocket/DOCX/Excel bằng application
  role trước khi mở traffic hoặc tăng instance.
- [ ] Chốt rollback deadline, trigger, owner và thao tác quay về release trước;
  rollback không được xóa database/file storage sau mutation thật đầu tiên.
- [ ] Thực hiện một full rehearsal và một rollback drill trong RTO; xác nhận không
  còn SQLite runtime, worker hoặc cron legacy trong deployment PostgreSQL.
- [ ] Phê duyệt go/no-go checklist, owner, timeline, kênh liên lạc, secret version
  và bằng chứng backup.

### PG-5 — HA, PITR và multi-instance

- [ ] Triển khai primary/standby theo yêu cầu HA, cùng failover, fencing và
  DNS/connection endpoint phù hợp.
- [ ] Bật backup tự động, WAL archiving/PITR, retention và mã hóa; đồng bộ manifest
  phục hồi với uploads/templates.
- [ ] Theo dõi connection, lock wait, deadlock, long transaction, slow query,
  replication lag, bloat, vacuum/analyze, disk/IOPS và backup age.
- [ ] Diễn tập failover và PITR restore sang môi trường tách biệt; kết quả phải nằm
  trong RPO/RTO và đối chiếu cả database lẫn file nghiệp vụ.
- [ ] Chạy rolling deploy và load/soak với tối thiểu hai application instance;
  không mất sync, không trùng event và không mở rộng quyền tenant.

Runbook provision/rehearsal/backup/rollback chi tiết nằm tại
[POSTGRESQL_OPERATIONS.md](POSTGRESQL_OPERATIONS.md).

## 5. Điều kiện mở production

- [ ] Không còn lỗi security High/Critical.
- [ ] Google Login và email OTP đạt với dịch vụ thật.
- [ ] Mixed load/soak đạt SLO và capacity envelope đã được phê duyệt.
- [ ] Reverse proxy rate/connection/body limits hoạt động đúng.
- [ ] Backup database + file + audit tự động, off-host và có cảnh báo.
- [ ] Full restore, rollback, failover và PITR drill đạt RPO/RTO áp dụng.
- [ ] Dashboard/alert production hoạt động và có người trực.
- [ ] Toàn bộ PG-0, PG-1, PG-3, PG-4 và PG-5 ở trên đã được kiểm chứng.

## 6. Bằng chứng local đã đạt

Các mục tương ứng đã được xóa khỏi danh sách công việc:

- Fresh install PostgreSQL 17 từ database rỗng: migration, schema, admin/workspace,
  application-role DML/readiness, teardown và lặp lại đều đạt.
- Database abstraction, bounded pool, dual-dialect schema/trigger/search, transaction
  retry, connection budget và contract test đã có CI gate.
- Tất cả coroutine route thuộc auth/OTP/Google/organization đã được kiểm tra không
  mở database connection trực tiếp; DB và password hashing chạy qua bounded lane.
- Hồi quy ngày 18/07/2026: PostgreSQL 17 thật `509/509` đạt; quality gate
  `npm run check` đạt với `293/293` frontend unit và `493 passed, 16 skipped` API
  ở job mặc định không cấp PostgreSQL integration URL;
  secure build/package smoke đạt.
- Cross-browser E2E: `19/19` đạt trên Chromium, Firefox, WebKit và mobile Chromium,
  gồm accessibility tự động, workspace isolation, privileged re-authentication,
  Word/Excel và performance probes.
- Release preflight `all` đạt trong 124,2 giây; archive production gồm 266 runtime
  file và không chứa test/tool/source-map public. Permission-matrix race trong
  harness đã được cô lập và đạt 10/10 lượt lặp trước preflight cuối.
- Private source-map artifact, SHA-256 manifest và production package không chứa
  `.map` đã đạt local; chỉ còn provider upload/stack-trace verification ở mục 3.
- Dependency/security gate đạt: npm, Python, vendor integrity/RetireJS và secret
  scan không phát hiện High/Critical hoặc secret candidate trong mã được quản lý.

Các kết quả local không thay thế staging/provider/HA drill. Không xóa một checkbox
còn lại chỉ vì cấu hình mẫu hoặc mock test đã tồn tại trong repository.
