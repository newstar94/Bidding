# Kế hoạch cải thiện BiddingFlow trước production

## 0. Dọn cây mã nguồn production tối giản — 18/07/2026

- [x] Build lại frontend ở chế độ secure và giữ bundle trong `dist`.
- [x] Xóa test, load test, GitHub Actions, SBOM sinh sẵn, metadata agent và các công cụ audit/benchmark/release-evidence khỏi cây triển khai.
- [x] Thu gọn dependency Node về Vite, esbuild và JavaScript obfuscator; xóa dependency Playwright, axe, CycloneDX và RetireJS.
- [x] Chỉ giữ `requirements.txt` tại thư mục gốc; xóa dependency Python dành riêng cho test/audit.
- [x] Giữ toàn bộ `docs`, mã nguồn backend/frontend/views, migration, template Word hệ thống, cấu hình `deploy`, `.env` và các script backup/restore/check DB.
- [x] Xác minh gói production sau khi dọn bằng extracted-runtime smoke test: 239 tệp runtime, khởi tạo database tạm mới và chạy thành công.
- [x] Thư mục `data` không chứa database/log/backup cũ; chỉ còn ba template Word hệ thống cho lần cài đầu.

Các tham chiếu CI/test/load/SBOM ở phần lịch sử bên dưới là bằng chứng của giai đoạn
phát triển trước khi dọn cây triển khai; các công cụ đó không còn nằm trong bản
production tối giản này và phải được duy trì ở repository phát triển riêng nếu cần chạy lại.

- Ngày lập: 18/07/2026
- Phạm vi: backend, frontend, bảo mật, hiệu năng, SQLite, triển khai và vận hành
- Trạng thái: đang triển khai; chỉ đánh dấu `[x]` sau khi mã và regression test tương ứng đã đạt
- Nguyên tắc phát hành: hoàn thành toàn bộ P0 trước khi mở production công khai
- Giả định triển khai hiện tại: **cài mới hoàn toàn**, chưa có database và không có dữ liệu/snapshot cũ cần chuyển đổi. Bootstrap được kiểm thử từ file DB không tồn tại lên schema version 7; full-state snapshot chỉ hỗ trợ format v2 mới.

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

#### Hiện trạng và tiến độ

- `/images/{path}` hiện yêu cầu đồng thời quyền `edit` đúng phân hệ và capability `signature`, kiểm tra session/active workspace/DB reference/signed URL hết hạn/chống path traversal, rồi trả `private, no-store`. Payload đọc không còn phát hành URL ảnh nếu thiếu capability. Xem [`protected_image_api`](../backend/app.py) và [sensitive-data policy](../backend/shared/sensitive_data.py).
- Redaction chuyên gia/nhà thầu được áp dụng thống nhất cho full sync, delta sync, pagination, single-record và WebSocket payload allowlist. Người thiếu quyền tương ứng nhận CCCD/số tài khoản đã che hoặc trường ảnh bị loại.
- Context Word được chiếu qua DTO allowlist theo từng loại tài liệu, capability `financial`/`identity`/`signature`, field manifest chính xác và document worker riêng. Chỉ dữ liệu liên quan đúng tenant/record được đưa vào context; password/OTP/session/reset data không đi qua worker. Ảnh được backend nạp từ managed path và nhúng trực tiếp vào DOCX.

#### Công việc

- [x] Tạo một serializer/policy trung tâm cho dữ liệu chuyên gia và nhà thầu.
- [x] Áp dụng policy cho full sync, delta sync, pagination và single-record được hỗ trợ.
- [x] Áp dụng policy còn lại cho WebSocket payload, document context/export và các đường đọc phát sinh thêm.
- [x] Kiểm tra quyền module trước khi trả chứng chỉ, chữ ký hoặc con dấu.
- [x] Đặt `Cache-Control: private, no-store` cho response ảnh nhạy cảm đã được phép tải.
- [x] Bổ sung regression test cho redaction pagination/single-record và authorization image endpoint theo quyền/workspace.
- [x] Chuyển URL file nhạy cảm sang object ID ngẫu nhiên hoặc signed URL có thời hạn.
- [x] Không đưa row database nguyên bản vào document context.
- [x] Tạo DTO allowlist riêng cho từng loại tài liệu Word; allowlist được phép chứa ngân hàng, CCCD và ảnh khi loại tài liệu cần chúng.
- [x] Tạo capability xuất dữ liệu nhạy cảm độc lập và kiểm tra capability trước khi build context.
- [x] Chỉ lấy chuyên gia/nhà thầu thực sự liên quan đến kế hoạch, gói thầu hoặc hợp đồng đang xuất.
- [x] Nạp ảnh/chữ ký/con dấu ở backend và nhúng vào DOCX; không cần phát lộ URL file dùng lâu dài cho template/client.
- [x] Cấm template truy cập root/key không nằm trong field manifest cho phép.
- [x] Loại bỏ tuyệt đối `mat_khau`, `ma_xac_minh`, password-reset data, session data và privileged re-auth data khỏi document worker payload.
- [x] Ghi audit ai đã xuất, tổ chức, loại tài liệu, ID bản ghi và nhóm dữ liệu nhạy cảm được dùng; không ghi giá trị CCCD/ngân hàng thô vào log.

#### Tiêu chí hoàn thành

- Người có capability xuất nhạy cảm có thể xuất đúng ngân hàng, CCCD và ảnh cần thiết trong DOCX.
- Người không có capability tương ứng nhận dữ liệu đã che/loại bỏ và không thể lấy lại qua URL file hoặc template tùy chỉnh.
- Mọi dữ liệu được xuất chỉ thuộc đúng tổ chức, đúng record scope và đúng phiên bản nghiệp vụ.
- Template tùy chỉnh không thể mở rộng quyền; context do backend cấp vẫn là ranh giới bảo mật.
- Integration test bao phủ full sync, pagination, single-record, image endpoint và DOCX export.
- Test khẳng định document worker payload có các trường ngân hàng/CCCD/ảnh được phép nhưng không chứa password hash, OTP, reset token hoặc session data.

### P0-02 — Xác minh lại khi thay đổi email

#### Hiện trạng

Luồng mới lưu `pending_email`, yêu cầu mật khẩu hiện tại, gửi OTP đã băm có TTL, chỉ đổi email sau xác minh, cảnh báo email cũ, thu hồi session và rate-limit theo IP/user/session. Database trigger chặn đường cập nhật email trực tiếp chưa được xác minh; frontend có bước nhập OTP và xử lý mã lỗi ổn định.

#### Công việc

- [x] Lưu email mới vào `pending_email`, không thay email chính ngay.
- [x] Yêu cầu password step-up hoặc privileged reauthentication.
- [x] Gửi OTP/link xác minh đến email mới.
- [x] Chỉ đổi `email/email_norm` sau khi xác minh thành công.
- [x] Gửi cảnh báo đến email cũ.
- [x] Rotate hoặc revoke session theo policy sau khi đổi email.
- [x] Rate limit theo user, session và IP.

#### Tiêu chí hoàn thành

- Session đơn thuần không thể thay đổi email đã xác minh.
- OTP hết hạn, dùng lại hoặc sai đều bị từ chối.
- Email cũ tiếp tục hoạt động cho đến khi email mới được xác minh.
- Có audit event và test takeover regression.

### P0-03 — Giảm write amplification của sync

#### Hiện trạng

Chỉ cần payload có một item versioned, cả bảng bị đưa vào danh sách tính lại. `recalculate_is_latest` reset `is_latest` trên toàn bộ bản ghi tenant rồi window-scan và update lại. Các update này tiếp tục kích hoạt sync-version và FTS trigger. Tổng mức đầu tư cũng được tính lại cho mọi kế hoạch tự động bằng nhiều truy vấn. Xem [sync dispatch](../backend/sync/service.py#L512), [post-sync recalculation](../backend/sync/service.py#L818) và [database recalculation](../backend/db/db_utils.py#L525).

#### Công việc

- [x] Thu thập chính xác `affected_root_ids` và `affected_plan_ids`.
- [x] Chỉ tính lại family/version bị thay đổi.
- [x] Chỉ update `is_latest` khi giá trị thực sự thay đổi.
- [x] Không làm FTS rewrite khi chỉ thay đổi field kỹ thuật không được index.
- [x] Chuyển tính tổng kế hoạch sang aggregate SQL set-based.
- [x] Đo số row update, WAL frame và sync-version trước/sau.

#### Tiêu chí hoàn thành

- Sửa một bản ghi tạo số lượng write gần O(1), không tăng theo tổng số bản ghi tenant.
- Không phát sinh delta giả cho các row không thay đổi nghiệp vụ.
- Benchmark đạt với dataset 20.000 kế hoạch/100.000 gói và dữ liệu quyền thực tế.
- Có regression test cho WAL, FTS và sync cursor.

### P0-04 — Không chạy transaction SQLite dài trên event loop

#### Hiện trạng

Các route sync/read là `async` nhưng transaction SQLite, validation và mapping vẫn chạy đồng bộ. Production chỉ có một Uvicorn worker; `busy_timeout=15s` có thể làm HTTP, WebSocket và health check cùng đứng. Xem [sync service](../backend/sync/service.py#L89), [sync read service](../backend/sync/read_service.py#L37), [database connection](../backend/db/db_helper.py#L23) và [systemd service](../deploy/biddingflow.service.example#L12).

#### Công việc

- [x] Tách một serialized write lane cho SQLite.
- [x] Tạo bounded read pool nhỏ và mở connection bên trong worker thread.
- [x] Offload toàn bộ transaction sync/read khỏi event loop.
- [x] Offload PBKDF2, Pillow và file processing còn chạy inline.
- [ ] Đặt deadline riêng cho DB read, DB write và external I/O. DB read/external I/O đã có deadline; mutation đã nhận vào write lane được phép chạy đến hết để tránh trả timeout trong khi transaction vẫn có thể commit, nên cần idempotency/cancellation contract trước khi đặt execution deadline cho DB write.
- [x] Trả `503` có mã lỗi ổn định khi hàng đợi đầy.

#### Tiêu chí hoàn thành

- Khi một DB transaction bị giữ khóa, `/health/live` và WebSocket heartbeat vẫn phản hồi.
- Event-loop lag không vượt SLO đã thống nhất trong load test.
- Queue có giới hạn, có metrics và không tăng RAM vô hạn.
- Không tăng số Uvicorn worker khi vẫn dùng SQLite writer lease.

### P0-05 — Chống quá tải tại Nginx/Uvicorn

#### Hiện trạng

`BodySizeLimitMiddleware` đang giữ toàn bộ ASGI body trong RAM rồi replay. Nginx cho body 64 MB, chưa có `limit_req`/`limit_conn`; Uvicorn chưa có concurrency cap và WebSocket chưa có quota theo IP/user. Xem [body middleware](../backend/http_middleware.py#L148), [Nginx baseline](../deploy/nginx-biddingflow.conf.example#L26) và [WebSocket endpoint](../backend/sync/websocket.py#L51).

#### Công việc

- [x] Chuyển body limiter thành receive-wrapper đếm byte theo stream, không buffer toàn body.
- [x] Đặt `client_max_body_size` theo từng route và khớp giới hạn ứng dụng.
- [x] Thêm `limit_req_zone`, `limit_req`, `limit_conn_zone` và `limit_conn`.
- [x] Tách quota cho login/OTP, API thường, sync, upload/export và WebSocket.
- [x] Thêm Uvicorn concurrency/backlog/graceful-shutdown limit phù hợp.
- [x] Giới hạn WebSocket theo IP/user và frame size.
- [x] Giữ application rate limit cho logic nghiệp vụ, không dùng nó làm lớp chống flood đầu tiên.

#### Tiêu chí hoàn thành

- Flood bị từ chối tại reverse proxy trước khi tiêu thụ SQLite/Python worker.
- Nhiều upload đồng thời không làm RAM tăng tuyến tính theo tổng body.
- Response phân biệt đúng `429`, `503` và `413`, có `Retry-After` khi phù hợp.
- Load test chứng minh server phục hồi sau burst, không cần restart.

## 3. P1 — Độ tin cậy và vận hành

### P1-01 — Backup toàn bộ trạng thái ứng dụng

Backup hiện tại kiểm tra SQLite khá tốt nhưng chưa bao phủ ảnh và Word template. Xem [database maintenance](../backend/db/maintenance.py#L102), [backup CLI](../scripts/backup_database.py#L13) và [runtime paths](../backend/shared/paths.py#L13).

Đã có CLI full-state v2 `create/verify/restore`, manifest SHA-256, chống path traversal/symlink và restore bắt buộc vào thư mục mới. Snapshot v2 chỉ được tạo khi ứng dụng đã quiesce và công cụ giữ writer lease độc quyền trong toàn bộ khoảng chụp DB, uploads và Word templates; timer mẫu dừng service trước backup và khởi động lại sau đó. Việc enable timer, off-host replication và diễn tập thật vẫn là công việc vận hành.

- [ ] Định nghĩa RPO và RTO.
- [x] Tạo systemd timer/cron cho backup tự động ở mức cấu hình deploy mẫu; release gate vẫn yêu cầu xác nhận timer thực sự được enable và chạy thành công trên máy production.
- [x] Backup nhất quán DB, uploads và Word templates trong cửa sổ quiesce bắt buộc; snapshot v2 fail-closed nếu writer lease đang do process BiddingFlow khác giữ.
- [x] Tạo manifest/checksum cho toàn bộ snapshot.
- [ ] Replicate sang off-host/object storage bất biến.
- [x] Cảnh báo backup lỗi hoặc quá hạn ở mức metric/Prometheus rule; vẫn phải kết nối Alertmanager và kênh trực trên hạ tầng thật.
- [ ] Diễn tập full-app restore hàng tháng và trước release lớn.
- [ ] Bắt buộc backup đã xác minh trước migration.

### P1-02 — Metrics, structured logging và cảnh báo

Runbook yêu cầu theo dõi 5xx/429, latency, event-loop lag, queue, disk/WAL và backup nhưng code hiện chủ yếu có log cùng vài header readiness. Xem [runbook](RUNBOOK.md#L39), [readiness](../backend/app.py#L445) và [runtime logging](../backend/shared/logging_utils.py#L203).

Đã thêm `/metrics` Prometheus được bảo vệ bằng CIDR/token, histogram HTTP/DB, queue/document/WebSocket/WAL/disk/backup/restore metrics, structured JSON log redacted, scrape/rule/dashboard mẫu và SLO/owner trong runbook. Thu thập filesystem chạy qua bounded I/O pool; hạ tầng Prometheus/Grafana/Alertmanager và lịch trực thật vẫn phải được triển khai riêng.

- [x] Thêm Prometheus/OpenTelemetry hoặc hệ tương đương.
- [x] Đo request rate, active requests, histogram để tính p50/p95/p99 và status theo route code-owned.
- [x] Đo SQLite busy/wait/transaction duration, WAL size và disk free.
- [x] Đo blocking-I/O/document-worker queue, reject và timeout.
- [x] Đo số WebSocket, reconnect và authentication failure.
- [x] Đo backup age và lần restore drill gần nhất.
- [x] Chuẩn hóa structured log có request ID và opaque user/org ID, nhưng không ghi PII/secret.
- [x] Định nghĩa SLO/error budget và alert có người chịu trách nhiệm mẫu; lịch trực production vẫn cần thay owner mẫu.

### P1-03 — Làm audit log đáng tin cậy

Audit event quản trị/nhạy cảm bắt buộc được nối hash trong cùng transaction nghiệp vụ. Migration tạo ràng buộc single-successor; startup xác minh chain trước readiness, monitor tiếp tục xác minh định kỳ và chuyển ứng dụng sang fail-closed cho required mutation khi chain invalid/error. Checkpoint local được HMAC và production bắt buộc cấu hình thư mục/key cùng xác nhận replication off-host.

- [x] Ghi audit event quan trọng trong cùng transaction hoặc transactional outbox.
- [x] Dùng lock/transaction phù hợp để tránh hai event cùng nối vào một previous hash.
- [x] Không fail-silent đối với mutation quản trị quan trọng.
- [x] Chạy verify chain trước readiness, định kỳ và cảnh báo khi không hợp lệ.
- [ ] Export/checkpoint chain ra kho bất biến theo chính sách lưu trữ. Code đã tạo checkpoint HMAC tên duy nhất và production fail-fast nếu thiếu cấu hình; kho WORM/off-host thật và retention lock vẫn phải được triển khai, không thể tự chứng minh chỉ từ repository.

### P1-04 — CI/CD và release gate

Repository có pipeline local trong [`package.json`](../package.json#L7) nhưng chưa có cấu hình CI được commit; `npm run check` cũng chưa chạy E2E.

- [x] Chạy lint, unit, API và E2E Chromium trên mỗi pull request qua workflow đã commit.
- [x] Chạy dependency audit, secret scan, vendor audit và SBOM.
- [x] Chạy secure build và production-package smoke test.
- [x] Chạy migration trên database fixture/bản sao an toàn.
- [x] Chạy backup/restore smoke test.
- [x] Không phát hành nếu P0 security test hoặc capacity gate thất bại; release-candidate workflow fail-closed, chỉ tải evidence từ một `Production CI` run thành công của đúng repository/commit và tự tính SHA-256 thay vì tin URL/SHA nhập tay.

Branch protection bắt buộc job `release-gate` và reviewer của GitHub `production` environment vẫn phải được bật trên repository hosting; workflow không tự coi các thiết lập bên ngoài này là đã hoàn tất.

### P1-05 — Load, soak và failure testing

Benchmark hiện tại là microbenchmark trực tiếp trên SQLite, chưa thay thế load test qua mạng. Xem [benchmark note](BENCHMARKS.md#L14).

- [x] Tạo k6 scenario hỗn hợp: login, pagination, sync, upload, export Word, WebSocket, burst/recovery và soak; có safety interlock, dry-run và SLO exit gate.
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

- [x] Chuyển profile trigger từ `div` click-only sang button có keyboard semantics. Xem [header](../views/components/header.html#L34).
- [x] Bổ sung `aria-expanded`, `aria-controls`, `inert` và focus management cho sidebar.
- [x] Đặt accessible name cho mọi icon-only button trong các template/luồng đã audit, kèm runtime fallback và audit chống tái phát.
- [x] Dùng `aria-live`, `aria-invalid` và `aria-describedby` cho lỗi form.
- [x] Tăng touch target quan trọng lên tối thiểu khoảng 44×44 px.
- [x] Sửa các cặp màu/chữ nhỏ bị axe phát hiện trên landing/auth/dashboard; automated WCAG A/AA hiện đạt trên landing, auth và toàn bộ 10 tab quản lý.
- [ ] Kiểm tra keyboard-only, screen reader, zoom 200% và mobile tables.
- [x] Tích hợp `@axe-core/playwright` chạy WCAG A/AA trên DOM thật; vẫn giữ audit token tĩnh như lớp kiểm tra nhanh bổ sung. Xem [accessibility E2E](../tests/e2e/accessibility.spec.js).
- [x] Chạy bộ Chromium đầy đủ và core smoke trên Desktop Chromium, Firefox, WebKit cùng Pixel 7 mobile; CI cài đủ ba browser engine. Xem [Playwright config](../playwright.config.js).

### P2-02 — Chia nhỏ frontend và CSS

- [ ] Split `BiddingWorkflows` theo flow/tab thay vì một lazy barrel lớn.
- [x] Chia các module từng dùng temporary size ceiling; source-size audit hiện đạt mà không còn ceiling tạm.
- [ ] Chia CSS theo component/feature và giảm override cuối file.
- [ ] Tiếp tục chuyển màu, spacing, typography sang design tokens.
- [x] Đặt bundle budget cho toàn bộ dependency graph của authenticated workspace: tối đa 780 KiB raw/185 KiB gzip; secure build hiện đạt ngân sách.

### P2-03 — Production debugging

- [ ] Dùng private source map gửi riêng lên error tracking, không public ra web.
- [x] Đã đánh giá và tắt dead-code injection mặc định cho production vì không phải security boundary và làm tăng chi phí parse/debug; vẫn giữ opt-in cho bản phân phối đặc biệt có chủ đích.
- [x] Gắn release ID/build hash vào frontend diagnostic, secure-build marker và mọi backend structured log; production fail-fast nếu `APP_RELEASE_ID` thiếu hoặc còn là placeholder.
- [x] Thêm client error reporting xác thực session, CSRF, rate limit hai lớp và allowlist sáu trường; không gửi message/stack thô, email, CCCD, tài khoản ngân hàng hay URL query. Backend ghi `client.error` vào structured log kèm release ID.

## 5. Chính sách SQLite và lộ trình PostgreSQL

### Quyết định kiến trúc mục tiêu

PostgreSQL là cơ sở dữ liệu mục tiêu cho BiddingFlow khi production cần **nhiều application instance** hoặc có mục tiêu tải từ **100 người dùng hoạt động đồng thời trở lên**. Con số 100 là ngưỡng lập kế hoạch để bắt đầu capacity gate, không phải tuyên bố hệ thống hiện đã chịu được mức tải đó. Chỉ được mở chế độ vận hành tương ứng sau khi mixed load test với dữ liệu, quyền, export và WebSocket gần thực tế đạt SLO đã thống nhất.

| Kịch bản | Quyết định cơ sở dữ liệu | Điều kiện |
|---|---|---|
| Development, demo hoặc một instance với tải ghi thấp | Giữ SQLite tạm thời | Một process, local persistent volume, backup/restore đã kiểm chứng và nằm trong capacity envelope |
| Production giới hạn ở một instance | Có thể dùng SQLite trong giai đoạn chuyển tiếp | Hoàn thành P0, load/soak test đạt SLO, chấp nhận single point of failure và có quyết định rủi ro bằng văn bản |
| Production multi-instance, rolling deploy, HA hoặc mục tiêu từ 100 concurrent active users | Chọn PostgreSQL | Hoàn thành toàn bộ acceptance gate PostgreSQL bên dưới trước khi tăng instance hoặc nhận tải mục tiêu |

PostgreSQL phù hợp với mô hình hiện tại vì hỗ trợ transaction nhiều writer, composite foreign key, partial/expression unique index, window function, row-level locking và cơ chế HA/PITR trưởng thành. MySQL/MariaDB hoặc SQL Server vẫn có thể triển khai nhưng không tạo lợi thế rõ ràng cho workload này và làm tăng phần viết lại partial index, trigger, FTS tiếng Việt hoặc vận hành. NoSQL không phải lựa chọn thay thế trực tiếp cho mô hình quan hệ và transaction hiện có.

Không chuyển cơ sở dữ liệu chỉ để kỳ vọng một truy vấn đơn lẻ nhanh hơn. Quyết định migration phải dựa trên yêu cầu multi-instance/HA hoặc bằng chứng capacity cho thấy SQLite không còn đáp ứng an toàn.

### Chi phí giấy phép và hạ tầng

PostgreSQL Community có chi phí bản quyền phần mềm bằng **0**. Tuy nhiên, production không miễn phí: vẫn phải trả cho compute, RAM, SSD/IOPS, dung lượng backup, object storage, replica/standby, lưu lượng mạng, monitoring, secrets/KMS và công vận hành hoặc phí dịch vụ managed.

- [ ] So sánh tổng chi phí sở hữu giữa PostgreSQL managed và tự vận hành trong cùng RPO/RTO, HA và mức tải mục tiêu.
- [ ] Dự toán riêng chi phí primary, standby, backup/PITR, môi trường staging/rehearsal và tăng trưởng dữ liệu tối thiểu 12 tháng.
- [ ] Không chọn cấu hình rẻ nhất nếu cấu hình đó loại bỏ PITR, failover hoặc IOPS cần thiết để đạt SLO.

### SQLite trong giai đoạn chuyển tiếp

- [x] Chuyển toàn bộ đường dẫn runtime development ra ngoài thư mục mã nguồn/file-sync (`D:/BiddingRuntime` trên máy hiện tại); giữ database ở trạng thái chưa khởi tạo cho lần chạy đầu tiên.
- [ ] Giữ chính xác một BiddingFlow process trên database đó.
- [ ] Không xóa `.writer.lock`, `-wal` hoặc `-shm` khi process còn chạy.
- [ ] Xác minh production SQLite dùng local encrypted persistent volume, không dùng thư mục file-sync.
- [x] Giữ serialized write lane, bounded read pool, backup/restore và metrics SQLite cho đến thời điểm cutover.
- [ ] Không tăng `--workers`, không chạy hai máy cùng ghi và không đặt SQLite trên network filesystem khi writer lease còn được sử dụng.
- [ ] Không phát triển thêm phụ thuộc SQLite-specific nếu có thể đặt sau database adapter chung.

### PG-0 — Capacity evidence và quyết định migration

#### Công việc

- [ ] Hoàn thành P0 security, giảm write amplification và tách transaction SQLite khỏi event loop trước khi dùng benchmark để so sánh database.
- [ ] Định nghĩa workload mục tiêu: concurrent active users, request mix, QPS, kích thước sync batch, số WebSocket, upload/export đồng thời và tốc độ tăng dữ liệu.
- [ ] Chạy load/soak test trên SQLite đã tối ưu, gồm mốc 100 concurrent active users nếu đây là mục tiêu business.
- [ ] Ghi p50/p95/p99, error rate, event-loop lag, DB wait, queue depth, CPU, RAM, WAL/IO và thời gian phục hồi sau burst.
- [ ] Chốt RPO, RTO, yêu cầu rolling deploy, số instance, vùng triển khai và lựa chọn PostgreSQL managed hoặc self-hosted.
- [ ] Lập decision record nêu rõ bằng chứng, chủ sở hữu, ngân sách và điều kiện rollback.

#### Acceptance gate

- [ ] Không còn P0 chưa hoàn thành làm sai lệch kết quả capacity test.
- [ ] Có capacity envelope SQLite tái lập được và báo cáo tải mục tiêu đã được phê duyệt.
- [ ] Quyết định PostgreSQL dựa trên yêu cầu multi-instance/HA hoặc dữ liệu đo, không dựa trên giả định tốc độ.

### PG-1 — Database abstraction, driver và connection pool

#### Công việc

- [ ] Tạo interface chung cho connection, cursor/row mapping, transaction, savepoint, lỗi unique/FK/retry và health check.
- [ ] Giữ SQLite adapter để chạy giai đoạn chuyển tiếp và thêm PostgreSQL adapter độc lập.
- [ ] Chọn driver PostgreSQL được duy trì tốt; cấu hình pool có giới hạn, acquire timeout, statement timeout, idle/lifetime policy và shutdown sạch.
- [ ] Chuyển placeholder, `sqlite3.Row`, `sqlite3.Error`, `BEGIN IMMEDIATE`, `PRAGMA`, `sqlite_master` và `user_version` ra khỏi service nghiệp vụ.
- [ ] Dùng TLS, secret rotation và role riêng cho migration, application read/write và backup/monitoring.
- [ ] Thêm metrics pool: open/in-use/waiting connection, acquire latency, timeout và transaction duration.

#### Acceptance gate

- [ ] Cùng service contract có thể chạy bằng SQLite adapter và PostgreSQL adapter mà route không import trực tiếp `sqlite3`.
- [ ] Pool bị giới hạn, timeout có mã lỗi ổn định và không làm event loop đứng khi database chậm.
- [ ] Không có connection/transaction leak trong unit, integration và soak test.

### PG-2 — Schema, kiểu dữ liệu, trigger và tìm kiếm

#### Công việc

- [ ] Lập mapping cho toàn bộ bảng/cột/index/constraint: ID text, tiền VND sang `BIGINT`, boolean, `DATE`, timestamp kỹ thuật UTC, JSON và enum/check constraint.
- [ ] Giữ composite foreign key theo `organization_id`, partial/expression unique index, optimistic `row_version`, idempotency key và tenant business key.
- [ ] Port trigger lineage, invariant liên bảng, delta sync, tombstone và audit chain; phần nào có thể biểu diễn bằng constraint thì ưu tiên constraint.
- [ ] Chuyển cấp `sync_version` sang thao tác atomic có row lock hoặc `UPDATE ... RETURNING`, kiểm thử nhiều writer cùng tenant.
- [ ] Thay FTS5 bằng thiết kế PostgreSQL đã chọn, ví dụ `tsvector` kết hợp `unaccent`/`pg_trgm`, nhưng phải giữ contract tìm tiếng Việt có dấu, không dấu và prefix cần thiết.
- [ ] Chỉ chuyển trường JSON thực sự cần truy vấn sang `JSONB`; không đổi kiểu hàng loạt nếu không có lợi ích đo được.
- [ ] Tạo migration PostgreSQL có version/checksum riêng; không sửa migration SQLite đã phát hành.

#### Acceptance gate

- [ ] Có manifest đối chiếu 100% bảng, cột, default, index, FK, unique/check constraint và trigger giữa schema nguồn với schema đích.
- [ ] Constraint test chứng minh không thể tạo liên kết chéo tenant, hai bản `is_latest`, business key trùng hoặc sync cursor lùi.
- [ ] Bộ corpus tìm kiếm tiếng Việt cho kết quả nghiệp vụ tương đương FTS5 đã được phê duyệt.
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` của dashboard, pagination, delta sync và export không có regression vượt ngân sách đã thống nhất.

### PG-3 — Contract test và kiểm thử đồng thời hai dialect

#### Công việc

- [ ] Chạy cùng bộ API/service contract test trên SQLite và PostgreSQL trong CI.
- [ ] Bổ sung test transaction isolation, lost update, deadlock/retry, idempotency replay, concurrent sync writer và concurrent audit append.
- [ ] Kiểm thử full bootstrap, delta sync, pagination/cursor, FTS, archive/delete/tombstone, export Word/Excel và WebSocket outbox.
- [ ] Kiểm thử dữ liệu nhạy cảm, role/workspace và RLS nếu sử dụng; kết quả PostgreSQL không được mở rộng quyền so với policy ứng dụng.
- [ ] Chạy benchmark và mixed load test với pool size khác nhau; không dùng pool lớn để che truy vấn hoặc transaction chậm.

#### Acceptance gate

- [ ] Không có sai khác không chủ ý về API payload, thứ tự, null, số tiền, ngày giờ, lỗi conflict hoặc quyền truy cập giữa hai database.
- [ ] Concurrency test không tạo duplicate version, mất mutation, sync cursor sai hoặc audit chain phân nhánh.
- [ ] PostgreSQL đạt SLO tại workload mục tiêu với pool và tài nguyên đã ghi thành cấu hình capacity.

### PG-4 — Rehearsal, backfill, cutover và rollback

#### Công việc

- [ ] Chọn chiến lược cutover rõ ràng. Với lần chuyển đầu, ưu tiên maintenance window và khóa ghi có kiểm soát; không dùng dual-write nếu chưa có reconciler và cơ chế xử lý partial failure.
- [ ] Tạo backup SQLite đã xác minh, giữ bản nguồn bất biến và xuất dữ liệu theo thứ tự foreign key.
- [ ] Backfill PostgreSQL bằng công cụ có checkpoint/idempotency; ghi row count, checksum, min/max ID/version và lỗi theo từng bảng mà không log PII thô.
- [ ] Đối chiếu FK, unique constraint, tổng tiền, số bản latest, sync cursor, tombstone, subscription, session/audit cần giữ và mẫu DOCX/Excel.
- [ ] Di chuyển uploads/ảnh/template sang shared object storage hoặc volume dùng chung có manifest/checksum; database migration không được coi là đã bao phủ file.
- [ ] Chạy rehearsal trên bản sao gần kích thước production, đo thời gian freeze/backfill/validate/smoke và PITR/restore.
- [ ] Cutover bằng cấu hình/secret có kiểm soát, chạy smoke test rồi mới mở ghi và tăng instance.
- [ ] Định nghĩa rollback deadline, trigger rollback và người quyết định; giữ SQLite read-only cùng backup cho đến khi hết cửa sổ rollback.

#### Acceptance gate

- [ ] Ít nhất một full rehearsal và một rollback drill thành công trong RTO đã cam kết.
- [ ] Row count/checksum, tenant invariants, sync cursor, audit và mẫu export khớp theo tiêu chí đã duyệt.
- [ ] Không còn background worker, cron hoặc instance cũ ghi vào SQLite tại thời điểm cutover.
- [ ] Go/no-go checklist, owner, timeline, kênh liên lạc và bằng chứng backup được phê duyệt trước khi thay production connection string.

### PG-5 — Vận hành PostgreSQL, HA và PITR

#### Công việc

- [ ] Triển khai primary cùng standby/replica theo yêu cầu HA; cấu hình failover, fencing và DNS/connection endpoint phù hợp.
- [ ] Bật backup tự động, WAL archiving/PITR, retention và mã hóa; backup file/upload/template vẫn là luồng riêng nhưng cùng manifest phục hồi ứng dụng.
- [ ] Cấu hình connection budget cho tổng số app instance, worker, migration và tác vụ vận hành; cân nhắc pooler khi có bằng chứng cần thiết.
- [ ] Theo dõi connection, lock wait, deadlock, long transaction, slow query, replication lag, bloat, vacuum/analyze, disk/IOPS và backup age.
- [ ] Tạo runbook failover, PITR, credential rotation, schema migration, connection exhaustion và disk pressure.
- [ ] Chuyển WebSocket broker, rate-limit và job coordination sang store dùng chung đã chọn; không để state cần chia sẻ nằm trong memory của từng instance.
- [ ] Diễn tập rolling deploy với tối thiểu hai application instance và kiểm tra idempotency/compatibility trong thời gian schema chuyển tiếp.

#### Acceptance gate

- [ ] Failover drill giữ dữ liệu trong RPO và phục hồi dịch vụ trong RTO.
- [ ] PITR restore sang môi trường tách biệt thành công và được đối chiếu cả database lẫn file nghiệp vụ.
- [ ] Dashboard/alert có ngưỡng và người trực cho pool exhaustion, lock/deadlock, replication lag, storage và backup/PITR failure.
- [ ] Hai application instance hoạt động đồng thời qua load/soak test mà không mất sync, trùng event hoặc mở rộng quyền tenant.

## 6. Thứ tự triển khai đề xuất

### Giai đoạn 1 — Security blockers

1. File/image authorization.
2. Contractor/expert redaction trên mọi read path.
3. Allowlisted DOCX context.
4. Email-change verification.
5. Regression test theo role/workspace.

### Giai đoạn 2 — Server stability và capacity evidence

1. Targeted version/plan recalculation.
2. Serialized SQLite write lane và bounded read pool.
3. Streaming body limiter.
4. Nginx/Uvicorn/WebSocket capacity limits.
5. Mixed load/soak test, capacity envelope và PostgreSQL decision record PG-0.

### Giai đoạn 3 — Migration PostgreSQL

Giai đoạn này bắt đầu sau P0, server stability và capacity evidence. Đây là gate bắt buộc trước khi chạy nhiều application instance hoặc nhận mục tiêu từ 100 concurrent active users; nếu tiếp tục production giới hạn một SQLite instance thì các việc chưa làm vẫn giữ `[ ]`, không được coi là đã hoàn thành.

1. Database abstraction, PostgreSQL driver và bounded connection pool.
2. Port schema, type, constraint, trigger, sync counter và FTS tiếng Việt.
3. Dual-dialect contract, concurrency và performance test.
4. Rehearsal, backfill, validation, cutover và rollback drill.

### Giai đoạn 4 — Operations

1. Full-state backup và scheduler.
2. Metrics, structured logs, SLO và alert.
3. Audit-chain verification.
4. CI/CD release gate.
5. PostgreSQL HA, PITR, failover/restore drill và multi-instance soak test.

### Giai đoạn 5 — UX và maintainability

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
- [ ] Nếu tiếp tục SQLite tạm thời, capacity envelope và quyết định chấp nhận single-instance/single point of failure đã được phê duyệt.
- [ ] Nếu release dùng multi-instance hoặc đặt mục tiêu từ 100 concurrent active users, toàn bộ gate PG-1 đến PG-5 đã đạt; không dùng SQLite writer lease cho nhiều instance.
- [ ] Rate/connection limits hoạt động tại reverse proxy.
- [ ] Backup toàn trạng thái đã tự động chạy và có cảnh báo.
- [ ] Full restore sang môi trường tách biệt đã thành công.
- [ ] Migration được chạy trên bản sao dữ liệu và có rollback plan.
- [x] CI chạy lint, unit, API, E2E, audit dependency/secret và package smoke. Local `release_preflight.py all` đã đạt; `Production CI` run #4 của commit `1a8cd8fdcd812a51a347470a7b4638bebe6ae8e5` đạt toàn bộ sáu job và tạo artifact evidence gắn đúng revision.
- [ ] Dashboard vận hành hiển thị latency, error rate, queue, WAL/disk và backup age.

## 8. Kết quả kiểm chứng

### Baseline tại thời điểm audit

- Lint JavaScript/Python: đạt.
- Secure build và production-package smoke: đạt.
- Frontend unit tests: 262/262 đạt.
- API tests: 280/283 đạt khi temp nằm trong workspace; ba test còn lại bị chặn bởi production safety rule vì đường dẫn chứa OneDrive, không phải assertion nghiệp vụ.
- Source-size audit cảnh báo ba workflow lớn đang dùng temporary ceiling.
- Không có source file nào bị thay đổi trong lượt audit trước khi tạo tài liệu này.

### Tiến độ triển khai ngày 18/07/2026

- Kịch bản cài mới: đạt. Test khởi động từ đường dẫn DB chưa tồn tại, chạy migration `0 → 7`, tạo schema/admin/workspace ban đầu và chạy migration lần hai idempotent; validation production không tự tạo DB trước startup.
- Quality preflight: đạt; lint JavaScript/Python, bytecode compile, 285/285 frontend unit test, module/source-size/dead-code/accessibility/inline-style audit đều đạt.
- Migration + backup/restore smoke: 23/23 đạt trên temp ngoài OneDrive.
- Toàn bộ API regression suite: 414/414 đạt trên temp ngoài OneDrive; không còn ba test bị chặn bởi production path guard.
- Cross-browser E2E: 18/18 đạt; gồm 15 bài Chromium đầy đủ và core smoke trên Firefox, WebKit, Pixel 7 mobile, cùng workspace isolation, privileged reauthentication, Word/Excel, axe WCAG A/AA và startup/navigation performance probes.
- Package: secure build và extracted-runtime smoke đạt; archive có 241 runtime file. Bundle authenticated workspace nằm trong budget đã commit.
- Supply chain: `npm audit`, `pip-audit`, vendor integrity/RetireJS, secret scan và SBOM npm/Python/vendor đều đạt gate.
- Full release preflight: `python scripts/release_preflight.py all --artifact release/biddingflow-release.zip` trả mã `0` trong 133,3 giây trên mã hiện tại; archive có 241 runtime file và cross-browser E2E đạt 18/18 trong cùng lượt.
- Test runtime isolation: pytest và từng Playwright worker đặt DB, log, backup, upload, Word template, document temp và restore state trong runtime tạm; không còn kế thừa audit checkpoint từ `.env`/`D:/BiddingRuntime`. Race modal Excel, route refresh nền, timer mở modal cũ và thời điểm controller khởi tạo đều có regression test; accessibility E2E gây race đã đạt thêm 10/10 lượt lặp.
- Kiểm thử mục tiêu cuối cho observability, document-worker admission, endpoint sync-version read-only và release evidence: 49/49 đạt; regression xác thực/rate-limit: 52/52 đạt.
- Các gate **chưa thể đánh dấu hoàn thành chỉ bằng local test**: load/soak thật với 100 session trên staging, Google/OTP thật, reverse-proxy thật, off-host WORM checkpoint/backup, restore drill sang máy khác, Alertmanager/Grafana production, branch protection/environment reviewers và PostgreSQL PG-1…PG-5.
- Security High còn giữ release gate đóng: document worker chưa được đặt trong principal/container + network/filesystem sandbox ở cấp OS; một số route auth/admin cũ ngoài login/rate-limit chính vẫn cần tiếp tục chuyển toàn bộ SQLite/audit standalone sang bounded DB lane hoặc transaction bắt buộc.
