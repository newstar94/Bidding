# Danh sách các chỗ cần sửa theo mức độ nghiêm trọng và ảnh hưởng

**Nguồn:** [Báo cáo rà soát toàn bộ hệ thống](./BAO_CAO_RA_SOAT_TOAN_BO_HE_THONG.md)  
**Mục đích:** dùng trực tiếp như backlog sửa code cho clean first-run baseline.  
**Phạm vi:** chỉ liệt kê việc cần sửa; không yêu cầu tương thích dữ liệu cũ nhưng phải giữ migration, API cập nhật và versioning cho các lần nâng cấp sau.

---

## 1. Cách đọc và nguyên tắc ưu tiên

### Mức độ nghiêm trọng

- **P0 – Blocker:** phải sửa trước khi chạy production hoặc nhập dữ liệu thật.
- **P1 – Cao:** phải sửa trước pilot/nghiệm thu với người dùng thật.
- **P2 – Trung bình:** sửa sau khi invariant P0/P1 ổn định, nhưng phải đưa vào kế hoạch phát hành.

### Phạm vi ảnh hưởng

- **S4 – Toàn hệ thống:** ảnh hưởng ranh giới bảo mật, nhiều tổ chức, toàn bộ dữ liệu hoặc khả năng vận hành.
- **S3 – Nhiều module/nghiệp vụ lõi:** ảnh hưởng đồng bộ, dữ liệu tài chính, subscription hoặc nhiều workflow.
- **S2 – Một luồng/module:** ảnh hưởng một nhóm người dùng hoặc tính năng xác định.
- **S1 – Cục bộ/bảo trì:** ít ảnh hưởng trực tiếp tới dữ liệu nhưng làm tăng chi phí và nguy cơ regression.

Trong từng mức P0/P1/P2, các mục dưới đây đã được xếp theo phạm vi và mức ảnh hưởng giảm dần. Thứ tự triển khai kỹ thuật có thể điều chỉnh theo dependency ở mục 6.

### Tổng hợp

| Mức | Số nhóm | Điều kiện |
|---|---:|---|
| P0 | 8 (đã xong 5) | Phải đóng 100% trước production |
| P1 | 13 | Phải đóng trước pilot có dữ liệu thật |
| P2 | 11 | Hoàn thành theo các đợt tối ưu sau baseline |
| **Tổng** | **32** | Mỗi mục cần code, test regression và bằng chứng nghiệm thu |

---

## 2. P0 – Blocker

### [x] P0-01 / R-03 – S4: Sửa phân quyền đa tổ chức

**Ảnh hưởng:** leo thang quyền giữa các tổ chức; manager ở tổ chức A có thể được coi là manager ở tổ chức B.

**Chỗ cần sửa:**

- `backend/db/schema.py`
- `backend/auth/auth_service.py`
- `backend/auth/session_utils.py`
- `backend/shared/access_policy.py`
- `backend/auth/auth_routes.py`
- `backend/api/org_routes.py`
- Các API đang kiểm tra `tai_khoan.vai_tro` trực tiếp

**Việc phải làm:**

- [x] Chỉ giữ quyền nền tảng như `super_admin` ở tài khoản; chuyển `owner/manager/employee/viewer` thành role của membership.
- [x] Dùng `organization_memberships.role` làm nguồn sự thật cho mọi authorization trong tổ chức.
- [x] Request context phải nạp `active_org_id`, membership role và trạng thái organization từ server.
- [x] Policy mặc định deny; loại bỏ bypass “manager toàn cục”.
- [x] Chặn tự nâng quyền, sửa/xóa peer cao hơn, sửa super-admin và xóa owner cuối cùng.
- [x] Thay đổi membership/role phải có transaction và audit event.
- [x] Rà toàn bộ route để không còn kiểm tra role nghiệp vụ từ `tai_khoan.vai_tro`.

**Hoàn thành khi:** manager A/employee B không có quyền quản lý tại B; không thể tạo tổ chức không có owner; ma trận allow/deny có integration test.

**Bằng chứng hoàn thành:** tài khoản chỉ còn hai quyền nền tảng `super_admin/user`; payload phiên tách riêng `platform_role`, `membership_role`, `effective_roles` và danh sách tổ chức theo ID. Toàn bộ route nghiệp vụ dùng membership của tổ chức đang hoạt động; frontend tính lại quyền ngay khi đổi workspace. Các luồng sửa/xóa role chặn tự nâng quyền, peer cao hơn, owner cuối cùng và super-admin cuối cùng; thay đổi được bọc transaction, vô hiệu hóa cache/session liên quan và ghi audit. Đã đạt 11 test API về authorization/access contract, 3 test frontend về access context; toàn bộ 136 unit test, 106 API test, lint, audit module/dead-code và build đều đạt.

### [x] P0-02 / R-02 – S4: Tách hoàn toàn state offline/sync theo tổ chức

**Ảnh hưởng:** mutation, tombstone hoặc snapshot của tổ chức A có thể được gửi/merge vào tổ chức B.

**Chỗ cần sửa:**

- `frontend/app/BiddingModel.js`
- `frontend/app/BiddingControllerSync.js`
- `frontend/app/BiddingController.js`
- `frontend/admin/AdminUserController.js`
- `backend/sync/websocket.py`
- Các key IndexedDB/localStorage liên quan mutation, deletion và sync version

**Việc phải làm:**

- [x] Scope IndexedDB, mutation queue, tombstone, draft, cache và sync cursor bằng `{userId}:{organizationId}`.
- [x] Tạo một state machine duy nhất cho đổi workspace.
- [x] Khi đổi org: khóa ghi, xử lý pending mutation, đóng WS/DB, xóa state memory, đổi active org, hydrate không track mutation, reconnect.
- [x] Tách rõ `applyServerSnapshot()` và `commitLocalMutation()`.
- [x] Không gọi `persistData()` theo hướng tạo mutation cho dữ liệu vừa nhận từ server.
- [x] Không dùng tên tổ chức làm khóa; chỉ dùng organization ID.
- [x] Xử lý hai tab, offline và logout/session expiry.

**Hoàn thành khi:** E2E A → B → A với pending mutation/tombstone/two-tab không gây đọc, ghi hoặc broadcast chéo tổ chức.

**Bằng chứng hoàn thành:** IndexedDB và toàn bộ queue/tombstone/cursor/cache phiên làm việc dùng namespace `{userId}:{organizationId}`; active organization của từng tab được giữ trong `sessionStorage` và chỉ lưu ID. Luồng `switchWorkspaceContext()` khóa ghi, làm mất hiệu lực phản hồi cũ bằng workspace epoch, thử đẩy mutation đang chờ nhưng vẫn bảo toàn queue khi offline, đóng WebSocket/IndexedDB cũ, xóa state memory, hydrate DB mới không tạo mutation và kết nối lại WebSocket đã xác thực membership đúng organization ID. Snapshot server đi qua `applyServerSnapshot()`, mutation cục bộ đi qua `commitLocalMutation()`. E2E Chromium A → B → A với hai tab, offline, pending mutation và tombstone đạt; toàn bộ 140 unit test, 107 API test, lint, audit module/dead-code và build đều đạt.

### [x] P0-03 / R-04 – S4: Viết lại luồng quên/reset mật khẩu

**Ảnh hưởng:** người biết username và email có thể làm đổi mật khẩu nạn nhân; SMTP lỗi có thể khóa tài khoản.

**Chỗ cần sửa:**

- `backend/auth/otp_routes.py`
- Các service gửi email/reset token
- Schema token/session trong `backend/db/schema.py`
- Form reset trong frontend auth

**Việc phải làm:**

- [x] Endpoint yêu cầu reset không đổi password ngay.
- [x] Trả response chung, không tiết lộ username/email có tồn tại.
- [x] Sinh token ngẫu nhiên; DB chỉ lưu hash, `expires_at`, `used_at`, `user_id`.
- [x] Chỉ đổi password khi redeem token hợp lệ trong transaction.
- [x] Không gửi password tạm qua email.
- [x] Sau reset thành công, revoke mọi session và WebSocket.
- [x] Rate limit theo IP + identity hash; chống token reuse/concurrent redeem.
- [x] Không log token/link đầy đủ; URL dùng fragment và mock mail ẩn nội dung nhạy cảm.

**Hoàn thành khi:** SMTP lỗi không làm đổi mật khẩu; token hết hạn/đã dùng bị từ chối; response không hỗ trợ account enumeration.

**Đã nghiệm thu:** thêm `password_reset_tokens`, service token dùng một lần, endpoint redeem, form đặt mật khẩu mới và `APP_PUBLIC_URL`. 5 test reset mới, toàn bộ 79 API test, 133 unit test, lint và secure build đều đạt.

### [ ] P0-04 / R-05 – S4: Sửa trusted proxy, IP allowlist và rate limiter

**Ảnh hưởng:** có thể giả IP để bypass allowlist/rate limit; limiter mất khi restart hoặc chạy nhiều worker.

**Chỗ cần sửa:**

- `backend/auth/auth_service.py`
- `backend/auth/auth_helper.py`
- `backend/app.py`
- Cấu hình reverse proxy và `.env.example`
- Storage/rate-limit service mới

**Việc phải làm:**

- [x] Mặc định dùng socket peer IP.
- [x] Chỉ tin forwarded header khi peer thuộc CIDR proxy tin cậy; duyệt chuỗi proxy từ phải sang trái.
- [ ] Reverse proxy phải xóa/ghi đè header do client gửi.
- [ ] Không dùng IP allowlist như lớp xác thực duy nhất cho super-admin.
- [ ] Bổ sung MFA/re-auth cho quyền cao.
- [x] Thay limiter trỏ tới `sys_config` không tồn tại bằng DB operation nguyên tử có TTL.
- [x] Limiter dùng DB chung qua restart/nhiều worker; lỗi storage fail-closed và có warning log.

**Hoàn thành khi:** tự đặt `X-Forwarded-For` không thay đổi IP tin cậy; test nhiều worker/restart vẫn giữ giới hạn đăng nhập.

**Tiến độ:** phần trusted-proxy và limiter DB đã triển khai, gồm fail-closed khi storage lỗi; 5 test mới và toàn bộ 84 API test đạt. Mục vẫn để mở cho tới khi cấu hình proxy triển khai thực tế và MFA/re-auth quyền cao hoàn thành.

### [ ] P0-05 / R-06 – S4: Sandbox template và chống file nén độc hại

**Ảnh hưởng:** rủi ro SSTI chưa được cô lập, zip bomb và tác vụ parse/render có thể làm cạn CPU/RAM.

**Chỗ cần sửa:**

- `backend/documents/custom_exporter.py`
- `backend/documents/routes_docx.py`
- `backend/documents/routes_excel.py`
- Các helper giải nén/parse DOCX/XLSX
- Hạ tầng job/worker và thư mục tạm

**Việc phải làm:**

- [x] Render bằng `SandboxedEnvironment` + `StrictUndefined` và allowlist tag/filter/test.
- [ ] Nếu chỉ cần placeholder, thay Jinja tổng quát bằng grammar placeholder giới hạn.
- [x] Parse và từ chối template tag ngoài allowlist trước render.
- [x] Giới hạn số ZIP entry, kích thước từng entry, tổng giải nén, compression ratio và XML depth/size.
- [x] Chặn traversal, encrypted entry và file không đúng cấu trúc/MIME.
- [ ] Chạy import/export trong worker quyền thấp, có timeout, memory/concurrency quota và cleanup.
- [x] Bỏ fallback trả template gốc khi render lỗi.
- [x] Viết security test SSTI/zip bomb; không coi rủi ro RCE là đã loại trừ cho tới khi test đạt.

**Hoàn thành khi:** payload ngoài allowlist bị từ chối trước render; file bomb không làm worker web mất đáp ứng; lỗi trả mã an toàn.

**Tiến độ:** đã thêm sandbox Jinja fail-closed, allowlist tag/filter, kiểm tra cấu trúc OOXML và giới hạn ZIP/XML dùng chung cho DOCX/XLSX; đã bỏ fallback trả mẫu gốc. 7 security/regression test đạt. Mục vẫn để mở vì chưa tách tác vụ parse/render sang worker quyền thấp có timeout và quota tài nguyên.

### [x] P0-06 / R-01 – S4: Làm startup fail-fast và có readiness thực

**Ảnh hưởng:** process vẫn phục vụ dù migration/bootstrap admin thất bại hoặc DB chưa sẵn sàng.

**Chỗ cần sửa:**

- `backend/db/db_utils.py`
- `backend/app.py`
- `.env.example`
- `README.md`
- Cấu hình health check/deployment

**Việc phải làm:**

- [x] Validate config bắt buộc trước khi ứng dụng được phép nhận traffic.
- [x] Migration/bootstrap admin lỗi phải làm startup thất bại và process thoát khác 0.
- [x] Tách `/health/live` và `/health/ready`.
- [x] Readiness chỉ đạt sau migration, schema version, admin invariant và DB read/write check.
- [x] Không log secret; thông báo rõ tên cấu hình bị thiếu.
- [x] Cung cấp readiness endpoint và hướng dẫn để orchestrator chỉ đưa instance vào traffic khi đạt.

**Hoàn thành khi:** fresh DB thiếu `ADMIN_PASSWORD` không mở cổng/không ready; cấu hình đúng tạo admin và ready ổn định.

**Đã nghiệm thu:** `backend/startup.py`, fail-closed lifespan và hai health endpoint đã được bổ sung; 5 test startup/readiness mới và toàn bộ 71 API test đều đạt.

### [x] P0-07 / R-08 – S3: Loại bỏ full-state write trong export

**Ảnh hưởng:** tab/client cũ có thể ghi đè dữ liệu mới chỉ vì người dùng bấm export.

**Chỗ cần sửa:**

- `frontend/app/BiddingController.js`
- `frontend/app/BiddingControllerSync.js`
- `frontend/app/BiddingModel.js`
- `backend/sync/service.py`
- API export tài liệu

**Việc phải làm:**

- [x] Export trở thành read-only trên snapshot server đã commit.
- [x] Trước export chỉ flush mutation theo protocol chuẩn; conflict phải được xử lý trước.
- [x] Luồng chuẩn bị export không còn tạo write ngoài protocol có concurrency token/idempotency key.
- [x] Export nhận `snapshotVersion`; stale version hoặc version đổi trong lúc render trả `409`.
- [x] Không cho client gửi full object để chuẩn bị export.

**Hoàn thành khi:** export từ tab stale không phát sinh write; concurrent edit không bị ghi đè và có regression test.

**Đã nghiệm thu:** full-state `/api/sync` đã bị loại khỏi export hợp đồng; export hợp đồng/kết quả flush mutation chuẩn và gửi snapshot version. 3 unit test mới, 3 API snapshot test, toàn bộ 133 unit test và 74 API test đều đạt.

### [ ] P0-08 / R-07 – S3: Đưa quy tắc xóa và bảo vệ tham chiếu xuống server/DB

**Ảnh hưởng:** gọi API trực tiếp có thể xóa lịch sử, null liên kết hoặc cascade cả cây nghiệp vụ.

**Chỗ cần sửa:**

- `frontend/shared/VersionedEntityService.js`
- `backend/sync/service.py`
- `backend/db/schema.py`
- Các API delete/archive và bảng có `CASCADE`/`SET NULL`

**Việc phải làm:**

- [x] Lập ma trận ban đầu cho quan hệ lịch sử `RESTRICT` và aggregate được cascade có chủ đích.
- [x] Guard tham chiếu chạy ở backend trong cùng transaction với delete và trả mã `DELETE_REFERENCED`.
- [ ] Master/version đã xuất hiện trong lịch sử chỉ được archive.
- [x] Dùng `ON DELETE RESTRICT` cho snapshot/chứng từ lịch sử trong clean schema.
- [ ] Endpoint xóa aggregate phải báo impact count, kiểm tra quyền cao và ghi audit.
- [x] Frontend guard chỉ giữ vai trò UX; server/DB đã trở thành security boundary.

**Hoàn thành khi:** direct API không thể xóa record đang được tham chiếu trái policy; mọi cascade còn lại có test và tài liệu.

**Tiến độ:** đã có server delete policy, owner-scoped reference count, cleanup assignment con và FK `RESTRICT`; 3 test mới đạt. Mục vẫn mở cho tới khi master/version chuyển sang archive và endpoint xóa aggregate có re-auth/audit đầy đủ.

---

## 3. P1 – Mức cao

### [ ] P1-01 / R-12 – S4: Thêm khóa ngoại kép để cô lập tenant ở DB

**Ảnh hưởng:** DB vẫn chấp nhận parent org A liên kết với child org B nếu route/import bỏ sót kiểm tra.

**Chỗ cần sửa:**

- `backend/db/schema.py`
- `backend/sync/ownership.py`
- `backend/sync/mapper.py`
- `backend/sync/service.py`
- Tất cả bảng có `owner_id`/`organization_id`

**Việc phải làm:**

- [ ] Chuẩn hóa tên tenant key thành `organization_id`.
- [ ] Parent có `UNIQUE(organization_id, id)`.
- [ ] Child dùng composite FK `(organization_id, parent_id)`.
- [ ] Bật foreign keys trên mọi connection.
- [ ] Chạy `foreign_key_check` sau migration/test.
- [ ] Xử lý assignment đa hình bằng bảng subtype/supertype hoặc trigger + invariant rõ.

**Hoàn thành khi:** quan hệ chéo tenant bị DB từ chối, kể cả khi bypass service.

### [ ] P1-02 / R-21 – S4: Thay migration runtime chắp vá bằng clean baseline có version

**Ảnh hưởng:** schema drift về CHECK/default/FK/unique có thể không được phát hiện; startup rebuild/FTS không đáng tin cậy.

**Chỗ cần sửa:**

- `backend/db/db_utils.py`
- `backend/db/schema.py`
- Cơ chế `DB_SCHEMA_VERSION`
- Test migration/schema contract

**Việc phải làm:**

- [ ] Tạo `schema_migrations(version, name, checksum, applied_at)`.
- [ ] Tạo migration `0001_clean_baseline` hoàn chỉnh.
- [ ] Migration có transaction/precondition/postcondition.
- [ ] Sau migration chạy FK/integrity/invariant checks.
- [ ] FTS chỉ tạo/rebuild trong migration hoặc maintenance job, không mỗi startup.
- [ ] Loại bỏ backfill/alias/field-map phục vụ schema cũ không còn cần.
- [ ] Giữ migration runner cho `0002+` và test nâng cấp giữa các version tương lai.

**Hoàn thành khi:** DB trắng được tạo chỉ từ migration; checksum/version rõ; drift constraint làm CI fail.

### [ ] P1-03 / R-09 – S4: Siết identity, unique constraint và password policy

**Ảnh hưởng:** trùng email/Google identity, login bất định và mật khẩu yếu.

**Chỗ cần sửa:**

- `backend/db/schema.py`
- `backend/auth/auth_routes.py`
- `backend/auth/otp_routes.py`
- `backend/auth/google_auth_routes.py`
- `frontend/auth/AuthController.js`

**Việc phải làm:**

- [ ] Tạo `username_norm`/`email_norm` với unique/case strategy thống nhất.
- [ ] External Google identity unique theo `(issuer, subject)`.
- [ ] Dùng DB constraint chống race; map integrity error thành field error/`409`.
- [ ] Password policy ở server, tối thiểu 12 ký tự/passphrase và giới hạn tối đa hợp lý.
- [ ] Không `.strip()` password.
- [ ] Cân nhắc Argon2id hoặc lưu algorithm/work factor để nâng cấp hash.

**Hoàn thành khi:** concurrent registration không tạo duplicate; email khác hoa/thường xử lý nhất quán; password space được giữ nguyên.

### [ ] P1-04 / R-13 – S4: Chuyển subscription/quota/lock thành dữ liệu tổ chức và cưỡng chế server

**Ảnh hưởng:** tổ chức hết hạn/bị khóa vẫn dùng được; có thể thêm thành viên vượt quota.

**Chỗ cần sửa:**

- `backend/db/schema.py`
- `backend/api/org_routes.py`
- `backend/shared/access_policy.py`
- `frontend/admin/SystemUserView.js`
- `frontend/admin/AdminUserController.js`
- Các action lock/renew và API protected

**Việc phải làm:**

- [ ] Tạo `organization_subscriptions` thay cho package/date trên tài khoản.
- [ ] Lưu trạng thái, package, thời hạn và quota snapshot theo organization.
- [ ] Backend kiểm tra subscription/capability trên API được bảo vệ.
- [ ] Add member kiểm tra quota trong cùng transaction với insert membership.
- [ ] Implement endpoint lock/unlock/renew có permission, audit và idempotency.
- [ ] Xóa nguồn sự thật localStorage và dữ liệu UI suy ra từ manager bất kỳ.

**Hoàn thành khi:** hết hạn/locked/quota full bị server từ chối dù gọi API trực tiếp; UI luôn render từ response server.

### [ ] P1-05 / R-19 – S4: Loại blocking I/O khỏi async và giới hạn tài nguyên request

**Ảnh hưởng:** một số request chậm/file lớn có thể chặn event loop hoặc làm cạn worker.

**Chỗ cần sửa:**

- `backend/partners/address_routes.py`
- `backend/auth/google_auth_routes.py`
- `backend/documents/routes_docx.py`
- `backend/documents/routes_excel.py`
- `backend/app.py`

**Việc phải làm:**

- [ ] Dùng async HTTP client hoặc bounded thread pool với timeout đầy đủ.
- [ ] Cache address lookup và bảo vệ endpoint bằng auth/rate limit phù hợp.
- [ ] Đưa import/export nặng sang worker/job queue.
- [ ] Giới hạn byte stream thật ở proxy/ASGI, không chỉ dựa `Content-Length`.
- [ ] Đặt limit riêng cho JSON, ảnh, DOCX/XLSX, số dòng và sync batch.
- [ ] Theo dõi event-loop lag, queue depth và timeout.

**Hoàn thành khi:** request chậm/upload lớn không làm latency API thường tăng mất kiểm soát; chunked oversized body bị chặn.

### [ ] P1-06 / R-11 – S3: Ràng buộc WebSocket với active organization và revoke tức thời

**Ảnh hưởng:** client có thể nhận sự kiện sai tổ chức; session/socket cũ tồn tại lâu sau revoke.

**Chỗ cần sửa:**

- `backend/sync/websocket.py`
- `frontend/app/BiddingControllerSync.js`
- Luồng đổi workspace/logout/change password
- Event registry/broker

**Việc phải làm:**

- [ ] Auth message gửi `activeOrganizationId`; server verify membership trước subscribe.
- [ ] Không tự chọn tổ chức đầu tiên của user.
- [ ] Đổi org phải unsubscribe/reconnect theo state machine.
- [ ] Origin validation import từ module độc lập và fail-closed.
- [ ] Session revoke/password change phải disconnect socket ngay.
- [ ] Dùng Redis pub/sub/outbox nếu chạy nhiều worker.

**Hoàn thành khi:** socket chỉ nhận event của org đã xác minh; revoke có hiệu lực ngay; multi-worker broadcast đầy đủ.

### [ ] P1-07 / R-16 – S3: Đổi kiểu tiền và bổ sung constraint dữ liệu

**Ảnh hưởng:** sai số giá trị tài chính, boolean/range/ngày không hợp lệ lọt vào DB.

**Chỗ cần sửa:**

- `backend/db/schema.py`
- `backend/sync/mapper.py`
- `frontend/documents/schemaContract.js`
- Formatter/validator tiền và ngày trong frontend

**Việc phải làm:**

- [ ] Lưu VND bằng integer minor unit, không dùng SQLite `REAL`.
- [ ] API truyền decimal string khi giá trị có thể vượt JavaScript safe integer.
- [ ] Backend dùng integer/`Decimal`; frontend dùng formatter BigInt-safe.
- [ ] Boolean có `CHECK IN (0,1)`; phần trăm 0–100; số lượng/số ngày không âm.
- [ ] Bổ sung enum/check cho role/status/permission.
- [ ] Timestamp chuẩn UTC; ngày bắt đầu/kết thúc có invariant.

**Hoàn thành khi:** test tiền rất lớn không sai số; DB từ chối range, enum, boolean và date order không hợp lệ.

### [ ] P1-08 / R-17 – S3: Thay coercion im lặng bằng typed request validation

**Ảnh hưởng:** chuỗi sai có thể thành `NULL`, số thập phân bị cắt thành int mà client vẫn nhận thành công.

**Chỗ cần sửa:**

- `backend/shared/text_utils.py`
- `backend/sync/mapper.py`
- `backend/sync/payload_validation.py`
- Tất cả write endpoint

**Việc phải làm:**

- [ ] Dùng request schema typed cho create/update/sync.
- [ ] Phân biệt field absent, explicit null, empty string và invalid.
- [ ] Từ chối unknown fields ở write nhạy cảm.
- [ ] Giới hạn length/count/nesting/range.
- [ ] `PATCH` dùng field presence, không dùng truthy/default mơ hồ.
- [ ] Trả lỗi theo field với error code ổn định.

**Hoàn thành khi:** invalid input luôn bị `4xx`, không âm thầm chuyển `NULL`/truncate; contract test bao phủ null semantics.

### [ ] P1-09 / R-14 – S3: Loại bỏ DOM XSS/UI injection

**Ảnh hưởng:** dữ liệu lưu trên server có thể được render thành HTML/attribute/action độc hại.

**Chỗ cần sửa:**

- `frontend/admin/SystemUserView.js`
- `frontend/admin/AdminUserController.js`
- `frontend/app/DashboardView.js`
- Các chỗ dùng `innerHTML`, template string và `data-args`
- Validation avatar/name/status ở backend

**Việc phải làm:**

- [ ] Dùng `textContent`, `createElement`, property và event listener.
- [ ] URL ảnh qua allowlist/safe media ID; giới hạn scheme và length.
- [ ] Escape theo đúng context nếu bắt buộc render HTML.
- [ ] Không nhét JSON/raw user data vào `data-*`; dùng opaque key + object map.
- [ ] Validate server cho username, organization name, status/color và IDs.
- [ ] Test payload dấu nháy, tag, SVG, URL scheme, comma và Unicode.

**Hoàn thành khi:** không còn sink nguy hiểm nhận dữ liệu không tin cậy; DOM test xác nhận payload chỉ hiển thị như text.

### [ ] P1-10 / R-18 – S3: Thay global sync version bằng row-level concurrency

**Ảnh hưởng:** sửa hai bản ghi không liên quan vẫn conflict; người dùng phải retry/merge không cần thiết.

**Chỗ cần sửa:**

- `backend/sync/service.py`
- `backend/db/schema.py`
- `frontend/app/BiddingModel.js`
- `frontend/app/BiddingControllerSync.js`

**Việc phải làm:**

- [ ] Mỗi record có `row_version`.
- [ ] Update/delete gửi `expectedVersion`; SQL compare-and-update nguyên tử.
- [ ] Dùng org change sequence chỉ làm delta cursor, không làm khóa ghi toàn tenant.
- [ ] Giữ mutation receipt/idempotency theo org + user + mutation ID.
- [ ] Conflict response chứa đủ dữ liệu để UI so sánh/merge.

**Hoàn thành khi:** edit khác record không conflict; edit cùng record stale trả `409`; retry mutation không ghi hai lần.

### [ ] P1-11 / R-20 – S2: Chuẩn hóa lỗi và không trả exception nội bộ

**Ảnh hưởng:** lộ path, SQL/schema hoặc thông tin thư viện cho client.

**Chỗ cần sửa:**

- `backend/documents/routes_docx.py`
- `backend/documents/routes_excel.py`
- `backend/api/org_routes.py`
- `backend/partners/address_routes.py`
- Global exception handler/logging

**Việc phải làm:**

- [ ] Không trả `str(exception)` cho client.
- [ ] Chuẩn hóa `{code, message, fields, requestId}`.
- [ ] Log chi tiết ở server có redaction cookie/token/email/file content.
- [ ] Có rotation/retention cho `export_error.log`, `sync_error.log`.
- [ ] Không để log runtime trong source/deploy artifact.

**Hoàn thành khi:** response production không lộ stack/path/SQL; request ID tra được log đã redaction.

### [ ] P1-12 / R-10 – S2: Sửa CSRF ở Google set-username

**Ảnh hưởng:** người dùng Google lần đầu có thể nhận `403` và không hoàn tất onboarding.

**Chỗ cần sửa:**

- `frontend/auth/AuthController.js`
- `frontend/shared/apiClient.js`
- `backend/app.py`
- `backend/auth/auth_routes.py`

**Việc phải làm:**

- [ ] Mọi authenticated write đi qua API client có CSRF bootstrap/refresh.
- [ ] Không phụ thuộc monkeypatch fetch được cài sau login.
- [ ] Sửa import `_get_username_setup_state`; không nuốt lỗi logic.
- [ ] Thêm integration test Google first-login → set username → session ready.

**Hoàn thành khi:** onboarding Google lần đầu thành công với CSRF hợp lệ và request thiếu token vẫn bị chặn.

### [ ] P1-13 / R-15 – S2: Sửa contract custom status và organization profile

**Ảnh hưởng:** custom status biến mất sau reload; UI báo đổi tên tổ chức thành công dù server bỏ qua.

**Chỗ cần sửa:**

- `frontend/admin/AdminUserController.js`
- `frontend/admin/SystemUserView.js`
- `frontend/contracts/HopDongWorkflow.js`
- `backend/auth/auth_routes.py`
- Endpoint custom status/profile liên quan

**Việc phải làm:**

- [ ] Bỏ `orgId="1"`; dùng `ownerId`/active organization ID từ server context.
- [ ] Không lọc lại theo org ở client nếu endpoint đã tenant-scope, hoặc dùng đúng ID.
- [ ] Tên tổ chức trong profile phải read-only hoặc đi qua endpoint đổi tên có quyền/audit.
- [ ] Client chỉ cập nhật state từ response server, không tự báo thành công cho field bị bỏ qua.
- [ ] Thêm test create → list → reload → use custom status.

**Hoàn thành khi:** dữ liệu round-trip không mất; đổi tên chỉ thành công khi DB thực sự đổi.

---

## 4. P2 – Mức trung bình

### [ ] P2-01 / R-32 – S4: Đưa SQLite khỏi OneDrive và bổ sung backup/restore

**Ảnh hưởng:** rủi ro xung đột WAL/lock, hỏng dữ liệu và không thể phục hồi khi sự cố.

**Chỗ cần sửa:** `backend/db/db_helper.py`, `.env.example`, tài liệu/deployment scripts.

- [ ] DB production phải nằm trên local persistent volume, không ở thư mục đồng bộ file.
- [ ] Nếu multi-instance/nhiều write, chuyển PostgreSQL; nếu giữ SQLite, formalize single-writer.
- [ ] Thêm backup online, retention, WAL checkpoint, integrity monitoring và restore rehearsal.
- [ ] Tách upload/export/temp/log khỏi DB volume.

**Hoàn thành khi:** restore thử tạo ra DB usable và có runbook xử lý sự cố.

### [ ] P2-02 / R-30 – S4: Tạo manifest/lockfile Python và audit toàn bộ dependency

**Ảnh hưởng:** máy mới không tái tạo được backend; npm audit không bao phủ vendor/Python.

**Chỗ cần sửa:** root project, `README.md`, `package.json`, `views/vendor/` và CI.

- [ ] Tạo `pyproject.toml` và lockfile có Python version/dependency pin/hash.
- [ ] Tách runtime/dev dependency.
- [ ] Audit npm, Python và vendored JS; sinh SBOM.
- [ ] Ghi version/source/license/checksum/quy trình update cho XLSX/Lucide vendor.
- [ ] Thêm secret scan và clean-environment install trong CI.

**Hoàn thành khi:** fresh machine dựng được cùng dependency từ lockfile và audit bao phủ cả ba nguồn.

### [ ] P2-03 / R-31 – S4: Cô lập E2E và lấp các khoảng trống kiểm thử

**Ảnh hưởng:** test xanh nhưng không bắt lỗi tenant/auth/concurrency/upload quan trọng.

**Chỗ cần sửa:** `tests/`, `playwright.config.js`, `pytest.ini`, test bootstrap/fixtures và CI.

- [ ] Mỗi test worker dùng DB, port, temp directory và config riêng.
- [ ] Có guard tuyệt đối không cho test trỏ DB production.
- [ ] Bổ sung test P0/P1 theo acceptance criteria của từng mục.
- [ ] Chạy schema FK/integrity/contract drift trong CI.
- [ ] Thêm bundle budget, API negative tests và security regression.

**Hoàn thành khi:** `npm check` hoặc pipeline chuẩn bao gồm isolated E2E và không cần `.env` thật.

### [ ] P2-04 / R-26 – S3: Hợp nhất mọi request vào API client trung tâm

**Ảnh hưởng:** CSRF, timeout, retry, lỗi và active org không đồng nhất ở khoảng 63 điểm `fetch`.

**Chỗ cần sửa:** `frontend/shared/apiClient.js`, `frontend/app/BiddingController.js` và mọi direct `fetch`.

- [ ] API client quản lý credentials, CSRF, org context, timeout/abort và error envelope.
- [ ] Retry chỉ request idempotent hoặc có idempotency key.
- [ ] Xử lý `401/403/409/429` thống nhất.
- [ ] Loại bỏ monkeypatch `window.fetch`.
- [ ] Chuyển module dần, có test adapter và không tạo global mới.

**Hoàn thành khi:** không còn authenticated write gọi `fetch` trực tiếp; network behavior không phụ thuộc thứ tự controller.

### [ ] P2-05 / R-25 – S3: Chia bundle và giảm chi phí obfuscation

**Ảnh hưởng:** tải/parse chậm; secure bundle khoảng 1,67 MB raw và 316,90 KB gzip.

**Chỗ cần sửa:** `vite.config.js`, imports workflow, `frontend/documents/schemaContract.js`, vendor import.

- [ ] Bật code splitting/lazy load theo role và domain.
- [ ] Chỉ tải XLSX/DOCX/workflow khi dùng.
- [ ] Giảm schema contract runtime xuống DTO/field map cần thiết.
- [ ] Đánh giá lại obfuscation; không coi nó là security control.
- [ ] Thêm initial JS gzip/parse budget trong CI.

**Hoàn thành khi:** đạt budget đã chốt trên thiết bị/network mục tiêu và không tải module admin/export cho user không dùng.

### [ ] P2-06 / R-27 – S3: Sửa service worker và vòng đời dữ liệu offline

**Ảnh hưởng:** cache ít hiệu quả, asset có thể stale và dữ liệu nhạy cảm lưu dai dẳng trên máy dùng chung.

**Chỗ cần sửa:** `views/service-worker.js`, logout/session-expiry flow, IndexedDB/localStorage adapter.

- [ ] Chỉ precache asset có content hash.
- [ ] Không cache personalized shell/API dùng cookie nếu chưa có threat model rõ.
- [ ] Có cache version/migration và dọn cache cũ.
- [ ] Logout/session expiry/shared-device option xử lý local data rõ ràng.
- [ ] Scope/retention dữ liệu local theo user + organization.

**Hoàn thành khi:** deploy version mới không giữ asset sai; logout policy được test online/offline/shared device.

### [ ] P2-07 / R-22 – S3: Hợp nhất các trường mở thầu/bảo đảm trùng nghĩa

**Ảnh hưởng:** hai nguồn sự thật và fallback làm sai dữ liệu đánh giá/mở thầu.

**Chỗ cần sửa:** `backend/db/schema.py`, `backend/sync/mapper.py`, `frontend/packages/BidEvaluationWorkflow.js`, `frontend/packages/BidProcessWorkflow.js`.

- [ ] Chỉ giữ field canonical cho security amount, security validity days và bid validity days.
- [ ] Dùng kiểu integer/amount chuẩn, không trộn TEXT/INTEGER.
- [ ] Tách field đặc thù phương thức vào subtype nếu cần.
- [ ] Xóa alias/fallback cũ trong clean baseline.
- [ ] Thêm unique business key cho opening row theo cardinality được xác nhận.

**Hoàn thành khi:** mỗi khái niệm chỉ có một field và round-trip không cần fallback.

### [ ] P2-08 / R-23 – S3: Chuẩn hóa metadata đánh giá thay cho JSON blob tùy ý

**Ảnh hưởng:** khó query, validate, audit và migration kết quả đánh giá.

**Chỗ cần sửa:** `backend/db/schema.py`, sync mapper/service và các workflow đánh giá.

- [ ] Tách vòng đánh giá, tiêu chí, kết quả nhà thầu, điểm, lý do loại và người chấm thành bảng.
- [ ] Chỉ giữ JSON cho phần mở rộng thực sự linh hoạt.
- [ ] JSON còn lại phải có `schemaVersion`, validator và size limit.
- [ ] Có migration/version strategy cho snapshot JSON tương lai.

**Hoàn thành khi:** dữ liệu ổn định query/audit được bằng cột/FK; JSON invalid bị từ chối.

### [ ] P2-09 / R-24 – S3: Thay chuỗi tổ chức phân tách dấu phẩy bằng DTO có ID

**Ảnh hưởng:** tên tổ chức có dấu phẩy làm vỡ danh sách và active workspace.

**Chỗ cần sửa:** `backend/auth/auth_service.py`, session/auth responses, `frontend/admin/SystemUserView.js`, `frontend/admin/AdminUserController.js`.

- [ ] API trả `organizations: [{id, name, role, status}]`.
- [ ] `activeOrganizationId` là ID duy nhất; không dùng name để định danh.
- [ ] Loại bỏ mọi `split(',')` và logic chấp nhận ID/name lẫn lộn.
- [ ] Quyết định loại bỏ hoặc formalize `to_chuc.quan_ly_id` để tránh hai nguồn owner.

**Hoàn thành khi:** tên chứa dấu phẩy/Unicode hoạt động và toàn bộ request dùng organization ID.

### [ ] P2-10 / R-28 – S2: Nâng UX sync, conflict, form và accessibility

**Ảnh hưởng:** người dùng không biết dữ liệu đang local, đã sync hay đang conflict; lỗi form khó xử lý.

**Chỗ cần sửa:** controller/view/workflow frontend và error response API.

- [ ] Hiển thị trạng thái local/sync/success/conflict/offline và pending count theo workspace.
- [ ] Có retry, diff, resolve conflict và dirty-state guard.
- [ ] Optimistic update có rollback; thao tác nhạy cảm chỉ báo thành công sau response server.
- [ ] Field error focus đúng input; có error summary và `aria-live`.
- [ ] Dialog có focus trap/Escape/restore focus; bảo đảm keyboard/contrast.
- [ ] Pagination/virtualization cho bảng lớn; undo/impact cho thao tác phá hủy.

**Hoàn thành khi:** usability/accessibility test bao phủ keyboard, screen reader state và conflict workflow.

### [ ] P2-11 / R-29 – S1: Chia nhỏ các file lớn và loại logic trùng

**Ảnh hưởng:** khó review/test, tăng regression và làm code splitting khó thực hiện.

**Chỗ cần sửa ưu tiên:**

- `frontend/documents/schemaContract.js`
- `frontend/packages/BidProcessWorkflow.js`
- `frontend/packages/BidEvaluationWorkflow.js`
- `frontend/packages/detail/AwardResultDetailsPanel.js`
- `frontend/auth/AuthController.js`
- `frontend/packages/GoiThauWorkflow.js`
- `frontend/app/BiddingController.js`
- `frontend/app/BiddingModel.js`
- `frontend/documents/WordIntegration.js`

**Việc phải làm:**

- [ ] Tách domain rule thuần khỏi DOM và I/O.
- [ ] Tách IndexedDB adapter, mutation queue, sync cursor và entity store.
- [ ] Tách auth theo login/register/Google/reset/session/profile.
- [ ] Tách workflow theo state machine, validator, calculator và renderer.
- [ ] Loại global singleton/window assignment mới.
- [ ] Chỉ refactor sau khi có regression test cho hành vi hiện tại/đã sửa.

**Hoàn thành khi:** dependency direction rõ, module có trách nhiệm đơn và domain rule được unit test độc lập.

---

## 5. Các thay đổi xuyên suốt phải áp dụng cho mọi mục

- [ ] Mọi API write: authentication, active-org binding, authorization, typed validation, concurrency và idempotency phù hợp.
- [ ] Mọi bảng tenant: `organization_id NOT NULL`, composite FK và index bắt đầu bằng organization ID khi phù hợp query.
- [ ] Mọi thao tác nhạy cảm: audit event có actor, org, action, target, before/after tối thiểu và request ID.
- [ ] Mọi timestamp: UTC; mọi amount: integer minor unit/decimal-safe.
- [ ] Mọi lỗi client-facing: error code ổn định, không có raw exception.
- [ ] Mọi UI render dữ liệu người dùng/server: context-safe output, không nối HTML tùy ý.
- [ ] Mọi thay đổi schema: migration forward có checksum và test; không thêm runtime backfill mơ hồ.
- [ ] Mỗi bug sửa xong phải có regression test tái hiện đúng failure ban đầu.

---

## 6. Thứ tự triển khai tránh làm lại

Danh sách trên được xếp theo mức độ nghiêm trọng/ảnh hưởng. Khi thực hiện, nên chia thành các đợt dependency-aware sau:

### Đợt A – Chốt nền dữ liệu và quyền

1. R-21 clean migration framework và baseline.
2. R-03 role theo membership.
3. R-12 composite tenant foreign key.
4. R-09 identity/password invariant.
5. R-13 subscription theo organization.
6. R-16 money/type/constraint.
7. R-22/R-23/R-24 canonical field và API contract.

### Đợt B – Đóng các đường mất dữ liệu/chiếm quyền

1. R-01 startup fail-fast.
2. R-04 reset password.
3. R-05 trusted proxy/rate/MFA.
4. R-07 server-side delete policy.
5. R-08 bỏ write trong export.
6. R-17 typed validation.

### Đợt C – Viết lại workspace/sync trên invariant mới

1. R-18 row-level concurrency + change log.
2. R-02 org-scoped local state/workspace switch.
3. R-11 WebSocket org subscription/revoke.
4. R-15 custom status/profile contract.
5. R-26 API client trung tâm.

### Đợt D – Hardening, hiệu năng và UX

1. R-06 sandbox upload/template và R-19 job/resource limits.
2. R-14 DOM XSS và R-20 safe error handling.
3. R-32 backup/deployment DB và R-30 dependency reproducibility.
4. R-31 isolated E2E/security tests.
5. R-25/R-27/R-28/R-29 bundle, offline, UX và refactor.

P0 không được trì hoãn vì nằm ở đợt sau: nếu một dependency lớn chưa hoàn tất, cần vá an toàn/fail-closed trước rồi mới thay bằng thiết kế cuối.

---

## 7. Definition of Done chung

Một checkbox chỉ được đánh dấu hoàn thành khi:

- [ ] Code đã sửa ở cả server, client và DB nếu vấn đề đi xuyên tầng.
- [ ] Có test tái hiện lỗi cũ và test đường thành công mới.
- [ ] Authorization được test cả allow lẫn deny, bao gồm gọi API trực tiếp.
- [ ] Test multi-org dùng ít nhất hai user, hai organization và role khác nhau.
- [ ] Migration trên DB trắng thành công; FK/integrity/invariant checks sạch.
- [ ] Không phát sinh raw exception, secret/PII log hoặc regression DOM sink.
- [ ] Unit, API, isolated E2E, lint/type/schema-contract và production build đều đạt.
- [ ] Tài liệu `.env.example`, README/runbook được cập nhật nếu hành vi vận hành thay đổi.
- [ ] Với thay đổi P0/P1, có người review độc lập và ghi bằng chứng nghiệm thu.
