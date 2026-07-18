# Kế hoạch cải thiện BiddingFlow trước production

- Ngày lập: 18/07/2026
- Phạm vi: backend, frontend, bảo mật, hiệu năng, SQLite, triển khai và vận hành
- Trạng thái: kế hoạch đề xuất sau audit chỉ đọc
- Nguyên tắc phát hành: hoàn thành toàn bộ P0 trước khi mở production công khai

## 1. Tóm tắt

BiddingFlow đã có nền tảng tốt: phân tách workspace theo tổ chức, optimistic locking, SQLite WAL và writer lease, startup fail-fast, CSRF/CSP, giới hạn body, bounded I/O queue, document worker chạy trong subprocess, migration có checksum, backup SQLite có integrity check và bộ kiểm thử tương đối rộng.

Các rủi ro lớn nhất còn lại không nằm ở giao diện mà ở bốn nhóm sau:

1. Một số đường đọc/export chưa áp dụng nhất quán quyền truy cập dữ liệu nhạy cảm.
2. Một mutation nhỏ có thể gây ghi lại dữ liệu trên toàn tenant và chặn event loop duy nhất.
3. Nginx/Uvicorn chưa có đủ lớp chống flood, giới hạn kết nối và load shedding ở ingress.
4. Backup, metrics, cảnh báo và CI chưa tạo thành một quy trình production tự động, có thể kiểm chứng.

## 2. P0 — Bắt buộc hoàn thành trước production

### P0-01 — Đóng các đường đọc dữ liệu nhạy cảm

#### Yêu cầu nghiệp vụ bắt buộc

BiddingFlow **phải tiếp tục hỗ trợ xuất thông tin ngân hàng, CCCD và ảnh nghiệp vụ ra Word**. Mục tiêu của hạng mục này không phải xóa các trường đó, mà là chỉ đưa đúng dữ liệu vào đúng loại tài liệu khi người thực hiện có quyền.

| Nhóm dữ liệu | Được xuất Word | Điều kiện |
|---|---|---|
| Số tài khoản, ngân hàng, mã ngân hàng của nhà thầu | Có | Đúng tổ chức, đúng bản ghi/phạm vi gói thầu và có capability xuất dữ liệu tài chính |
| CCCD của chuyên gia/người có liên quan | Có | Đúng tổ chức, tài liệu thực sự cần trường này và có capability xuất dữ liệu định danh |
| Ảnh chứng chỉ, chữ ký, con dấu và ảnh nghiệp vụ | Có | Đúng bản ghi, đúng mục đích tài liệu và được backend nạp vào document context có kiểm soát |
| Hash mật khẩu, OTP, session token, reset token, privileged re-auth data | Không | Cấm tuyệt đối trong mọi template, export payload và file kết quả |
| Metadata nội bộ như sync/version/cache/debug fields | Không mặc định | Chỉ cho phép trường kỹ thuật được định nghĩa rõ trong schema tài liệu |

Nên tạo capability riêng như `word.export_sensitive` hoặc các capability chi tiết `word.export_financial`, `word.export_identity`, `word.export_signature`. Không nên suy luận quyền xuất dữ liệu nhạy cảm chỉ từ việc người dùng có thể xem một gói thầu.

#### Hiện trạng

- Endpoint `/images/{path}` kiểm tra session và tổ chức nhưng chưa kiểm tra quyền module `chuyengia=edit`. Người chỉ có quyền xem có thể tải chữ ký/chứng chỉ nếu biết URL. Xem [`protected_image_api`](../backend/app.py#L493).
- Full bootstrap có che thông tin ngân hàng nhà thầu, nhưng pagination và single-record chưa áp dụng cùng policy. Xem [pagination](../backend/sync/pagination.py#L101), [single-record read](../backend/sync/read_service.py#L434) và [sensitive-data redaction](../backend/shared/sensitive_data.py#L12).
- Context xuất Word đang lấy toàn bộ hàng tài khoản, nhà thầu và chuyên gia. Vì vậy template nhận lẫn dữ liệu nghiệp vụ cần thiết (ngân hàng, CCCD, ảnh/chữ ký) với bí mật xác thực tuyệt đối không được xuất (hash mật khẩu, OTP và session/internal data). Xem [docx service](../backend/documents/docx_service.py#L266), [account schema](../backend/db/schema.py#L35) và [template upload](../backend/documents/routes_docx.py#L473).

#### Công việc

- [ ] Tạo một serializer/policy trung tâm cho dữ liệu chuyên gia và nhà thầu.
- [ ] Áp dụng policy cho full sync, delta sync, pagination, single-record, WebSocket payload, file endpoint và export.
- [ ] Kiểm tra quyền module trước khi trả chứng chỉ, chữ ký hoặc con dấu.
- [ ] Chuyển URL file nhạy cảm sang object ID ngẫu nhiên hoặc signed URL có thời hạn.
- [ ] Không đưa row database nguyên bản vào document context.
- [ ] Tạo DTO allowlist riêng cho từng loại tài liệu Word; allowlist được phép chứa ngân hàng, CCCD và ảnh khi loại tài liệu cần chúng.
- [ ] Tạo capability xuất dữ liệu nhạy cảm độc lập và kiểm tra capability trước khi build context.
- [ ] Chỉ lấy chuyên gia/nhà thầu thực sự liên quan đến kế hoạch, gói thầu hoặc hợp đồng đang xuất.
- [ ] Nạp ảnh/chữ ký/con dấu ở backend và nhúng vào DOCX; không cần phát lộ URL file dùng lâu dài cho template/client.
- [ ] Cấm template truy cập root/key không nằm trong field manifest cho phép.
- [ ] Loại bỏ tuyệt đối `mat_khau`, `ma_xac_minh`, password-reset data, session data và privileged re-auth data khỏi document worker payload.
- [ ] Ghi audit ai đã xuất, tổ chức, loại tài liệu, ID bản ghi và nhóm dữ liệu nhạy cảm được dùng; không ghi giá trị CCCD/ngân hàng thô vào log.

#### Tiêu chí hoàn thành

- Người có capability xuất nhạy cảm có thể xuất đúng ngân hàng, CCCD và ảnh cần thiết trong DOCX.
- Người không có capability tương ứng nhận dữ liệu đã che/loại bỏ và không thể lấy lại qua URL file hoặc template tùy chỉnh.
- Mọi dữ liệu được xuất chỉ thuộc đúng tổ chức, đúng record scope và đúng phiên bản nghiệp vụ.
- Template tùy chỉnh không thể mở rộng quyền; context do backend cấp vẫn là ranh giới bảo mật.
- Integration test bao phủ full sync, pagination, single-record, image endpoint và DOCX export.
- Test khẳng định document worker payload có các trường ngân hàng/CCCD/ảnh được phép nhưng không chứa password hash, OTP, reset token hoặc session data.

### P0-02 — Xác minh lại khi thay đổi email

#### Hiện trạng

`update_profile_api` cập nhật email trực tiếp nhưng không yêu cầu mật khẩu/OTP và không đặt lại trạng thái xác minh. Một session bị chiếm có thể đổi email rồi dùng luồng quên mật khẩu. Xem [profile update](../backend/auth/auth_routes.py#L349).

#### Công việc

- [ ] Lưu email mới vào `pending_email`, không thay email chính ngay.
- [ ] Yêu cầu password step-up hoặc privileged reauthentication.
- [ ] Gửi OTP/link xác minh đến email mới.
- [ ] Chỉ đổi `email/email_norm` sau khi xác minh thành công.
- [ ] Gửi cảnh báo đến email cũ.
- [ ] Rotate hoặc revoke session theo policy sau khi đổi email.
- [ ] Rate limit theo user, session và IP.

#### Tiêu chí hoàn thành

- Session đơn thuần không thể thay đổi email đã xác minh.
- OTP hết hạn, dùng lại hoặc sai đều bị từ chối.
- Email cũ tiếp tục hoạt động cho đến khi email mới được xác minh.
- Có audit event và test takeover regression.

### P0-03 — Giảm write amplification của sync

#### Hiện trạng

Chỉ cần payload có một item versioned, cả bảng bị đưa vào danh sách tính lại. `recalculate_is_latest` reset `is_latest` trên toàn bộ bản ghi tenant rồi window-scan và update lại. Các update này tiếp tục kích hoạt sync-version và FTS trigger. Tổng mức đầu tư cũng được tính lại cho mọi kế hoạch tự động bằng nhiều truy vấn. Xem [sync dispatch](../backend/sync/service.py#L512), [post-sync recalculation](../backend/sync/service.py#L818) và [database recalculation](../backend/db/db_utils.py#L525).

#### Công việc

- [ ] Thu thập chính xác `affected_root_ids` và `affected_plan_ids`.
- [ ] Chỉ tính lại family/version bị thay đổi.
- [ ] Chỉ update `is_latest` khi giá trị thực sự thay đổi.
- [ ] Không làm FTS rewrite khi chỉ thay đổi field kỹ thuật không được index.
- [ ] Chuyển tính tổng kế hoạch sang aggregate SQL set-based.
- [ ] Đo số row update, WAL frame và sync-version trước/sau.

#### Tiêu chí hoàn thành

- Sửa một bản ghi tạo số lượng write gần O(1), không tăng theo tổng số bản ghi tenant.
- Không phát sinh delta giả cho các row không thay đổi nghiệp vụ.
- Benchmark đạt với dataset 20.000 kế hoạch/100.000 gói và dữ liệu quyền thực tế.
- Có regression test cho WAL, FTS và sync cursor.

### P0-04 — Không chạy transaction SQLite dài trên event loop

#### Hiện trạng

Các route sync/read là `async` nhưng transaction SQLite, validation và mapping vẫn chạy đồng bộ. Production chỉ có một Uvicorn worker; `busy_timeout=15s` có thể làm HTTP, WebSocket và health check cùng đứng. Xem [sync service](../backend/sync/service.py#L89), [sync read service](../backend/sync/read_service.py#L37), [database connection](../backend/db/db_helper.py#L23) và [systemd service](../deploy/biddingflow.service.example#L12).

#### Công việc

- [ ] Tách một serialized write lane cho SQLite.
- [ ] Tạo bounded read pool nhỏ và mở connection bên trong worker thread.
- [ ] Offload toàn bộ transaction sync/read khỏi event loop.
- [ ] Offload PBKDF2, Pillow và file processing còn chạy inline.
- [ ] Đặt deadline riêng cho DB read, DB write và external I/O.
- [ ] Trả `503` có mã lỗi ổn định khi hàng đợi đầy.

#### Tiêu chí hoàn thành

- Khi một DB transaction bị giữ khóa, `/health/live` và WebSocket heartbeat vẫn phản hồi.
- Event-loop lag không vượt SLO đã thống nhất trong load test.
- Queue có giới hạn, có metrics và không tăng RAM vô hạn.
- Không tăng số Uvicorn worker khi vẫn dùng SQLite writer lease.

### P0-05 — Chống quá tải tại Nginx/Uvicorn

#### Hiện trạng

`BodySizeLimitMiddleware` đang giữ toàn bộ ASGI body trong RAM rồi replay. Nginx cho body 64 MB, chưa có `limit_req`/`limit_conn`; Uvicorn chưa có concurrency cap và WebSocket chưa có quota theo IP/user. Xem [body middleware](../backend/http_middleware.py#L148), [Nginx baseline](../deploy/nginx-biddingflow.conf.example#L26) và [WebSocket endpoint](../backend/sync/websocket.py#L51).

#### Công việc

- [ ] Chuyển body limiter thành receive-wrapper đếm byte theo stream, không buffer toàn body.
- [ ] Đặt `client_max_body_size` theo từng route và khớp giới hạn ứng dụng.
- [ ] Thêm `limit_req_zone`, `limit_req`, `limit_conn_zone` và `limit_conn`.
- [ ] Tách quota cho login/OTP, API thường, sync, upload/export và WebSocket.
- [ ] Thêm Uvicorn concurrency/backlog/graceful-shutdown limit phù hợp.
- [ ] Giới hạn WebSocket theo IP/user và frame size.
- [ ] Giữ application rate limit cho logic nghiệp vụ, không dùng nó làm lớp chống flood đầu tiên.

#### Tiêu chí hoàn thành

- Flood bị từ chối tại reverse proxy trước khi tiêu thụ SQLite/Python worker.
- Nhiều upload đồng thời không làm RAM tăng tuyến tính theo tổng body.
- Response phân biệt đúng `429`, `503` và `413`, có `Retry-After` khi phù hợp.
- Load test chứng minh server phục hồi sau burst, không cần restart.

## 3. P1 — Độ tin cậy và vận hành

### P1-01 — Backup toàn bộ trạng thái ứng dụng

Backup hiện tại kiểm tra SQLite khá tốt nhưng chưa bao phủ ảnh và Word template. Xem [database maintenance](../backend/db/maintenance.py#L102), [backup CLI](../scripts/backup_database.py#L13) và [runtime paths](../backend/shared/paths.py#L13).

- [ ] Định nghĩa RPO và RTO.
- [ ] Tạo systemd timer/cron cho backup tự động.
- [ ] Backup nhất quán DB, uploads và Word templates.
- [ ] Tạo manifest/checksum cho toàn bộ snapshot.
- [ ] Replicate sang off-host/object storage bất biến.
- [ ] Cảnh báo backup lỗi hoặc quá hạn.
- [ ] Diễn tập full-app restore hàng tháng và trước release lớn.
- [ ] Bắt buộc backup đã xác minh trước migration.

### P1-02 — Metrics, structured logging và cảnh báo

Runbook yêu cầu theo dõi 5xx/429, latency, event-loop lag, queue, disk/WAL và backup nhưng code hiện chủ yếu có log cùng vài header readiness. Xem [runbook](RUNBOOK.md#L39), [readiness](../backend/app.py#L445) và [runtime logging](../backend/shared/logging_utils.py#L203).

- [ ] Thêm Prometheus/OpenTelemetry hoặc hệ tương đương.
- [ ] Đo request rate, active requests, p50/p95/p99 và status theo route.
- [ ] Đo SQLite busy/wait/transaction duration, WAL size và disk free.
- [ ] Đo blocking-I/O/document-worker queue, reject và timeout.
- [ ] Đo số WebSocket, reconnect và authentication failure.
- [ ] Đo backup age và lần restore drill gần nhất.
- [ ] Chuẩn hóa structured log có request ID, nhưng không ghi PII/secret.
- [ ] Định nghĩa SLO/error budget và alert có người chịu trách nhiệm.

### P1-03 — Làm audit log đáng tin cậy

Audit event hiện có thể bị bỏ qua khi ghi thất bại; chain verification mới chỉ xuất hiện trong test. Xem [audit logger](../backend/shared/logging_utils.py#L139) và [audit chain](../backend/shared/audit_chain.py#L20).

- [ ] Ghi audit event quan trọng trong cùng transaction hoặc transactional outbox.
- [ ] Dùng lock/transaction phù hợp để tránh hai event cùng nối vào một previous hash.
- [ ] Không fail-silent đối với mutation quản trị quan trọng.
- [ ] Chạy verify chain định kỳ và cảnh báo khi không hợp lệ.
- [ ] Export/checkpoint chain ra kho bất biến theo chính sách lưu trữ.

### P1-04 — CI/CD và release gate

Repository có pipeline local trong [`package.json`](../package.json#L7) nhưng chưa có cấu hình CI được commit; `npm run check` cũng chưa chạy E2E.

- [ ] Chạy lint, unit, API và E2E trên mỗi pull request.
- [ ] Chạy dependency audit, secret scan, vendor audit và SBOM.
- [ ] Chạy secure build và production-package smoke test.
- [ ] Chạy migration trên database fixture/bản sao an toàn.
- [ ] Chạy backup/restore smoke test.
- [ ] Không phát hành nếu P0 security test hoặc capacity gate thất bại.

### P1-05 — Load, soak và failure testing

Benchmark hiện tại là microbenchmark trực tiếp trên SQLite, chưa thay thế load test qua mạng. Xem [benchmark note](BENCHMARKS.md#L14).

- [ ] Tạo k6/Locust scenario hỗn hợp: login, pagination, sync, upload, export và WebSocket.
- [ ] Thử backup trong khi có traffic.
- [ ] Thử slow client, upstream timeout, DB busy, disk gần đầy và process restart.
- [ ] Chạy soak test đủ lâu để quan sát RAM, WAL, cache và file descriptor.
- [ ] Ghi capacity envelope: concurrent users, QPS, p95/p99, RAM và error rate.

### P1-06 — Hoàn tất kiểm thử tích hợp production

Theo [kế hoạch kiểm thử còn lại](../KE_HOACH_KIEM_THU_CON_LAI.md#L8):

- [ ] Sửa/cấu hình Google OAuth origin và kiểm thử bằng tài khoản thật.
- [ ] Kiểm thử email OTP thật, resend, expiry, reuse và rate limit.
- [ ] Hoàn tất ma trận quyền `none/view/edit` cho từng phân hệ.
- [ ] Kiểm thử xung đột hai người dùng và mất mạng/reconnect.
- [ ] Diễn tập backup/restore sang máy mới.
- [ ] Chạy migration trên bản sao dữ liệu production và xác minh rollback plan.

## 4. P2 — Frontend, accessibility và maintainability

### P2-01 — Accessibility và mobile

- [ ] Chuyển profile trigger từ `div` click-only sang button có keyboard semantics. Xem [header](../views/components/header.html#L34).
- [ ] Bổ sung `aria-expanded`, `aria-controls`, `inert` và focus management cho sidebar.
- [ ] Đặt accessible name cho mọi icon-only button.
- [ ] Dùng `aria-live`, `aria-invalid` và `aria-describedby` cho lỗi form.
- [ ] Tăng touch target quan trọng lên tối thiểu khoảng 44×44 px.
- [ ] Sửa các cặp màu/chữ nhỏ chưa đạt WCAG AA.
- [ ] Kiểm tra keyboard-only, screen reader, zoom 200% và mobile tables.
- [ ] Tích hợp axe/Playwright thay cho audit token tĩnh hiện tại. Xem [accessibility audit](../scripts/audit_accessibility.mjs#L17).
- [ ] Chạy E2E trên Chromium, Firefox, WebKit và viewport mobile. Hiện mới có Desktop Chrome trong [Playwright config](../playwright.config.js#L20).

### P2-02 — Chia nhỏ frontend và CSS

- [ ] Split `BiddingWorkflows` theo flow/tab thay vì một lazy barrel lớn.
- [ ] Chia các module đang dùng temporary size ceiling. Xem [source-size audit](../scripts/audit_source_size.mjs#L7).
- [ ] Chia CSS theo component/feature và giảm override cuối file.
- [ ] Tiếp tục chuyển màu, spacing, typography sang design tokens.
- [ ] Đặt bundle budget cho authenticated workspace, không chỉ initial entry.

### P2-03 — Production debugging

- [ ] Dùng private source map gửi riêng lên error tracking, không public ra web.
- [ ] Cân nhắc bỏ dead-code injection vì không phải security boundary và làm tăng chi phí parse/debug.
- [ ] Gắn release ID/build hash vào frontend error và backend log.
- [ ] Thêm client error reporting đã redact PII.

## 5. Chính sách SQLite và lộ trình PostgreSQL

### Tiếp tục dùng SQLite khi

- Chỉ cần một application process.
- Lưu lượng ghi đồng thời thấp.
- Chấp nhận một host/process là single point of failure.
- Không yêu cầu rolling deploy không downtime.

### Chuyển PostgreSQL khi

- Cần nhiều Uvicorn worker hoặc nhiều máy.
- Cần high availability và failover.
- Có nhiều concurrent writer.
- Cần rolling deployment hoặc scale ngang.
- Load test vượt capacity envelope của SQLite.

Khi chuyển, cần đồng thời đưa file sang shared object storage và chuyển broker/rate-limit store sang hạ tầng dùng chung. Không tăng `--workers` khi writer lease SQLite vẫn đang bật.

### Việc cần làm ngay trong môi trường hiện tại

- [ ] Chuyển `BIDDING_DB_PATH` development ra ngoài OneDrive.
- [ ] Giữ chính xác một BiddingFlow process trên database đó.
- [ ] Không xóa `.writer.lock`, `-wal` hoặc `-shm` khi process còn chạy.
- [ ] Xác minh production dùng local encrypted persistent volume, không dùng thư mục file-sync.

## 6. Thứ tự triển khai đề xuất

### Giai đoạn 1 — Security blockers

1. File/image authorization.
2. Contractor/expert redaction trên mọi read path.
3. Allowlisted DOCX context.
4. Email-change verification.
5. Regression test theo role/workspace.

### Giai đoạn 2 — Server stability

1. Targeted version/plan recalculation.
2. Serialized SQLite write lane và bounded read pool.
3. Streaming body limiter.
4. Nginx/Uvicorn/WebSocket capacity limits.
5. Mixed load test và capacity envelope.

### Giai đoạn 3 — Operations

1. Full-state backup và scheduler.
2. Metrics, structured logs, SLO và alert.
3. Audit-chain verification.
4. CI/CD release gate.
5. Restore/migration rehearsal.

### Giai đoạn 4 — UX và maintainability

1. Accessibility/mobile fixes.
2. Cross-browser E2E.
3. Split workflow chunks và CSS.
4. Private source maps và error tracking.

## 7. Điều kiện phát hành production

- [ ] Tất cả P0 hoàn thành và có regression test.
- [ ] Không còn lỗi security mức High/Critical.
- [ ] Google Login và email OTP được kiểm thử với dịch vụ thật.
- [ ] Ma trận quyền `none/view/edit` đạt ở cả UI và API.
- [ ] Mixed load test đạt SLO và không làm event loop/SQLite đứng.
- [ ] Rate/connection limits hoạt động tại reverse proxy.
- [ ] Backup toàn trạng thái đã tự động chạy và có cảnh báo.
- [ ] Full restore sang môi trường tách biệt đã thành công.
- [ ] Migration được chạy trên bản sao dữ liệu và có rollback plan.
- [ ] CI chạy lint, unit, API, E2E, audit dependency/secret và package smoke.
- [ ] Dashboard vận hành hiển thị latency, error rate, queue, WAL/disk và backup age.

## 8. Kết quả kiểm chứng tại thời điểm audit

- Lint JavaScript/Python: đạt.
- Secure build và production-package smoke: đạt.
- Frontend unit tests: 262/262 đạt.
- API tests: 280/283 đạt khi temp nằm trong workspace; ba test còn lại bị chặn bởi production safety rule vì đường dẫn chứa OneDrive, không phải assertion nghiệp vụ.
- Source-size audit cảnh báo ba workflow lớn đang dùng temporary ceiling.
- Không có source file nào bị thay đổi trong lượt audit trước khi tạo tài liệu này.
