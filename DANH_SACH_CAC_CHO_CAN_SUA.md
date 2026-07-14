# Danh sách các chỗ cần sửa theo mức độ nghiêm trọng và ảnh hưởng

**Nguồn:** [Báo cáo rà soát toàn bộ hệ thống](./BAO_CAO_RA_SOAT_TOAN_BO_HE_THONG.md)  
**Mục đích:** dùng trực tiếp như backlog sửa code cho clean first-run baseline.  
**Phạm vi:** chỉ liệt kê việc cần sửa; không yêu cầu tương thích dữ liệu cũ nhưng phải giữ migration, API cập nhật và versioning cho các lần nâng cấp sau.

---

## 1. Cách đọc và nguyên tắc ưu tiên

### Mức độ nghiêm trọng

- **P1 – Cao:** phải sửa trước pilot/nghiệm thu với người dùng thật.
- **P2 – Trung bình:** sửa sau khi invariant P0/P1 ổn định, nhưng phải đưa vào kế hoạch phát hành.

### Phạm vi ảnh hưởng

- **S4 – Toàn hệ thống:** ảnh hưởng ranh giới bảo mật, nhiều tổ chức, toàn bộ dữ liệu hoặc khả năng vận hành.
- **S3 – Nhiều module/nghiệp vụ lõi:** ảnh hưởng đồng bộ, dữ liệu tài chính, subscription hoặc nhiều workflow.
- **S2 – Một luồng/module:** ảnh hưởng một nhóm người dùng hoặc tính năng xác định.
- **S1 – Cục bộ/bảo trì:** ít ảnh hưởng trực tiếp tới dữ liệu nhưng làm tăng chi phí và nguy cơ regression.

Trong từng mức P1/P2, các mục dưới đây đã được xếp theo phạm vi và mức ảnh hưởng giảm dần. Thứ tự triển khai kỹ thuật có thể điều chỉnh theo dependency ở mục 5.

### Tổng hợp

| Mức | Số nhóm còn lại | Điều kiện |
|---|---:|---|
| P1 | 8 | Phải đóng trước pilot có dữ liệu thật |
| P2 | 11 | Hoàn thành theo các đợt tối ưu sau baseline |
| **Tổng** | **19** | Mỗi mục cần code, test regression và bằng chứng nghiệm thu |

---

## 2. P1 – Mức cao

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

## 3. P2 – Mức trung bình

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

## 4. Các thay đổi xuyên suốt phải áp dụng cho mọi mục

- [ ] Mọi API write: authentication, active-org binding, authorization, typed validation, concurrency và idempotency phù hợp.
- [ ] Mọi bảng tenant: `organization_id NOT NULL`, composite FK và index bắt đầu bằng organization ID khi phù hợp query.
- [ ] Mọi thao tác nhạy cảm: audit event có actor, org, action, target, before/after tối thiểu và request ID.
- [ ] Mọi timestamp: UTC; mọi amount: integer minor unit/decimal-safe.
- [ ] Mọi lỗi client-facing: error code ổn định, không có raw exception.
- [ ] Mọi UI render dữ liệu người dùng/server: context-safe output, không nối HTML tùy ý.
- [ ] Mọi thay đổi schema: migration forward có checksum và test; không thêm runtime backfill mơ hồ.
- [ ] Mỗi bug sửa xong phải có regression test tái hiện đúng failure ban đầu.

---

## 5. Thứ tự triển khai tránh làm lại

Danh sách còn lại nên được triển khai theo dependency để hạn chế sửa đi sửa lại:

### Đợt A – Chốt nền dữ liệu và quyền

1. R-21 clean migration framework và baseline.
2. R-09 identity/password invariant.
3. R-13 subscription theo organization.
4. R-16 money/type/constraint.
5. R-22/R-23/R-24 canonical field và API contract.

### Đợt B – Đóng các đường lỗi dữ liệu còn lại

1. R-17 typed validation.

### Đợt C – Hoàn thiện workspace/sync

1. R-18 row-level concurrency + change log.
2. R-11 WebSocket org subscription/revoke.
3. R-26 API client trung tâm.

### Đợt D – Hardening, vận hành, hiệu năng và UX

1. R-14 DOM XSS.
2. R-32 backup/deployment DB và R-30 dependency reproducibility.
3. R-31 isolated E2E/security tests.
4. R-25/R-27/R-28/R-29 bundle, offline, UX và refactor.

Các mục P1 phải được ưu tiên trước pilot; nếu dependency lớn chưa hoàn tất, cần vá an toàn/fail-closed trước rồi mới thay bằng thiết kế cuối.

---

## 6. Definition of Done chung

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
