# Báo cáo triển khai nhiều người phụ trách và nhật ký thực hiện

Ngày hoàn tất kiểm tra: 2026-07-29

Repository: BiddingFlow

Schema PostgreSQL sau triển khai: **26**

## 1. Kết quả

Đã triển khai xuyên suốt backend, PostgreSQL, sync, phân quyền, notification,
lịch sử phân công, tài liệu, frontend và E2E để một gói thầu/hợp đồng có nhiều
người cùng phụ trách.

Quy tắc bổ sung về xóa thành viên đã được áp dụng:

- nếu công việc vẫn còn ít nhất một assignee đang hoạt động, thành viên được gỡ
  khỏi tổ chức mà không phải chọn người tiếp quản;
- chỉ những gói thầu/hợp đồng mà thành viên là assignee hợp lệ cuối cùng mới yêu
  cầu successor;
- E2E xác minh xóa A khỏi hợp đồng `{A, C}` trả 200, lịch sử của A có
  `successor_user_id = NULL`; tiếp tục thử xóa C trả 409 `SUCCESSOR_REQUIRED`.

## 2. Nguyên nhân gốc

1. `SyncRecordWriter._replace_singleton_rows()` xóa các assignment cùng target
   trước khi ghi assignment mới.
2. PostgreSQL có `idx_phan_cong_owner_target` dạng unique theo target, trái với
   unique membership đã có trong mô hình dữ liệu.
3. Frontend dùng state một ID, `.find()`, `<select>` đơn và chiến lược xóa rồi
   tạo lại assignment.
4. Snapshot notification dùng key thiếu `user_id`, làm nhiều membership của
   một target ghi đè nhau.
5. Luồng tạo version từ kế hoạch cũng dùng `.find()` nên chỉ copy assignee đầu.
6. Chưa có domain activity log dành cho UI; dữ liệu hiện tại của tài liệu và
   technical audit không đủ mô tả toàn bộ lịch sử nghiệp vụ.
7. Trong quá trình E2E phát hiện thêm `recalculate_is_latest()` có thể vi phạm
   unique index do PostgreSQL nâng winner trước khi hạ version cũ trong cùng một
   câu `UPDATE`.

## 3. File thay đổi

### Backend và schema

- `backend/activity/__init__.py`
- `backend/activity/routes.py`
- `backend/activity/service.py`
- `backend/api/org_routes.py`
- `backend/app.py`
- `backend/auth/email_delivery_service.py`
- `backend/db/db_utils.py`
- `backend/db/postgres_schema.py`
- `backend/db/schema.py`
- `backend/db/upgrades.py`
- `backend/documents/package_document_routes.py`
- `backend/notifications/service.py`
- `backend/sync/assignment_augmentation.py`
- `backend/sync/mutation_tracker.py`
- `backend/sync/ownership.py`
- `backend/sync/pagination.py`
- `backend/sync/record_writer.py`
- `backend/sync/service.py`

### Frontend

- `frontend/admin/AdminUserController.js`
- `frontend/contracts/HopDongComponent.js`
- `frontend/contracts/HopDongWorkflow.js`
- `frontend/packages/GoiThauDetail.js`
- `frontend/packages/GoiThauTable.js`
- `frontend/packages/GoiThauWorkflow.js`
- `frontend/packages/detail/PackageDocumentsPanel.js`
- `frontend/packages/detail/PackageTabs.js`
- `frontend/packages/detail/PreparationDetailsPanel.js`
- `frontend/packages/packageAssignmentPolicy.js`
- `frontend/plans/KeHoachWorkflow.js`
- `frontend/shared/ActivityTimeline.js`
- `frontend/shared/MultiAssigneeSelect.js`
- `views/css/views.css`
- `views/modals/modal_goithau.html`
- `views/modals/modal_hopdong.html`

### Test, fixture và cấu hình lệnh

- `tests/test_multi_assignee_activity.py`
- `tests/test_package_documents.py`
- `tests/test_bidder_goods.py`
- `tests/test_package_goods.py`
- `tests/js/multi_assignee_activity.test.mjs`
- `scripts/multi_assignee_activity_fixture.py`
- `scripts/verify_multi_assignee_activity_e2e.mjs`
- `package.json`

Hai file đã bị xóa từ trước trong worktree,
`CODEX_BIDDER_GOODS_IMPLEMENTATION_REPORT.md` và `CONTEXT.md`, không thuộc thay
đổi của công việc này và không bị phục hồi/ghi đè.

## 4. Schema và migration

### Version 25 — `add_multi_assignee_activity_log`

- bỏ unique index singleton `idx_phan_cong_owner_target`;
- tạo lại index non-unique theo
  `(organization_id, id_muc_tieu, loai_doi_tuong, id_nhan_vien)`;
- thêm index reverse lookup theo assignee;
- tạo bảng append-only `nhat_ky_thuc_hien`;
- thêm index timeline theo target/root, actor và unique partial index để dedupe
  activity theo mutation;
- tạo trigger cấm `UPDATE`/`DELETE` activity.

Unique membership hiện có theo organization + user + target + type tiếp tục
ngăn assignment trùng một người trên cùng công việc.

### Version 26 — `preserve_activity_actor_snapshot`

FK từ `nhat_ky_thuc_hien.actor_user_id` được bỏ có chủ đích. Activity giữ
`actor_name_snapshot`, vì vậy xóa tài khoản không thể kích hoạt cascade hoặc
`SET NULL` làm xung đột với trigger append-only và lịch sử vẫn đọc được.

Fresh schema và database nâng cấp đều đã được kiểm tra ở version 26. Fresh
schema có 67 bảng, index target assignment là non-unique và trigger immutable
tồn tại. Trên database nâng cấp, thử `UPDATE nhat_ky_thuc_hien` bị PostgreSQL
từ chối với SQLSTATE `23514`.

## 5. Business rules cuối cùng

- Gói thầu và hợp đồng nhận 1..n assignee đang hoạt động trong cùng tenant.
- Explicit assignee list được giữ nguyên; creator không bị tự thêm ngoài ý
  muốn.
- Nếu tạo mới không gửi assignee hợp lệ, backend fallback về creator.
- ID trùng trong payload được normalize/dedupe.
- Update assignment dùng set delta; row unchanged giữ nguyên ID, `row_version`
  và metadata.
- Không cho xóa toàn bộ assignee của công việc đang hoạt động.
- Khi gỡ thành viên tổ chức, chỉ target không còn assignee active nào mới yêu
  cầu successor; target còn người khác chỉ xóa membership của người rời đi.
- Mỗi assignment bị gỡ tạo một history row riêng; actor/time lấy từ backend,
  successor nullable.
- Version mới kế thừa toàn bộ assignee của version latest chưa archive. Luồng
  tạo version từ kế hoạch và luồng package/contract trực tiếp đều dùng tập hợp.
- Recalculation `is_latest` chạy hai pha demote/promote trong cùng transaction,
  tránh vi phạm unique index và vẫn giữ query count cố định.

## 6. Assignment delta

Frontend chuẩn hóa ID và tính:

```text
added     = selected - existing
removed   = existing - selected
unchanged = selected ∩ existing
```

Chỉ `added` gọi add, chỉ `removed` gọi delete, `unchanged` không bị chạm tới.
E2E xác minh `{A, B} -> {B, C}` giữ nguyên ID và `row_version = 1` của B; chỉ A
mất quyền và C nhận quyền.

Backend đã bỏ hoàn toàn singleton replacement cho `phan_cong_nhan_su`, nhưng
giữ nguyên singleton behavior của bảng permission matrix.

## 7. Activity log, transaction và idempotency

API mới:

```text
GET /api/activities/{target_type}/{target_id}
```

Endpoint hỗ trợ limit tối đa 100, filter action/actor và keyset cursor
`(occurred_at, id)`. Timeline đọc theo `target_root_id`, vì vậy lịch sử xuyên
version vẫn đầy đủ.

Activity được ghi cho:

- create/update gói thầu;
- create/update hợp đồng;
- add/remove assignment;
- upload/replace/delete tài liệu gói thầu.

Actor lấy từ authenticated session, timestamp lấy từ server/database. Metadata
được allowlist theo loại event, giới hạn depth/size và loại bỏ password, token,
cookie, authorization, storage key, checksum và secret.

Sync mutation, assignment/history, notification/outbox và activity nằm trong
cùng transaction. `clientMutationId` cùng unique partial index ngăn activity
trùng khi retry. No-op update không tạo activity.

Upload/delete tài liệu sử dụng `Idempotency-Key`, advisory transaction lock và
`api_idempotency` để replay đúng response/status. Retry upload cùng key không
tạo document/activity mới và file tạm của request replay được dọn. E2E gửi hai
lần cùng key cho upload và delete, nhưng PostgreSQL chỉ có đúng hai event:
`package_document.uploaded` và `package_document.deleted`.

## 8. Authorization và tenant isolation

- Manager/admin giữ quyền quản lý theo policy hiện hành.
- Employee được coi là assignee nếu thuộc bất kỳ membership active nào của
  target/lineage.
- Validation chỉ nhận thành viên active cùng organization.
- API activity kiểm tra active organization, target tồn tại trong tenant và
  `can_read_record()` trước khi đọc timeline.
- Employee không được tự gán người khác qua sync policy.
- Search/list package và contract match tất cả assignee bằng correlated
  `EXISTS` tenant-scoped trong chính query chính.
- E2E xác minh A/B có quyền ban đầu, C nhận 403, sau delta A nhận 403, B/C nhận
  200, và người thuộc tenant khác nhận 404.

## 9. Notification và history

Snapshot assignment dùng key `(target_type, target_id, user_id)` nên không còn
collapse nhiều assignee. Notification được tạo đúng set delta; unchanged B
không nhận lại notification trong `{A,B}->{B,C}`.

Luồng notification đã được batch hóa:

- một query lấy organization;
- một batch insert in-app notification;
- một query prefetch toàn bộ account;
- một batch insert encrypted email outbox.

Không còn database call theo từng recipient trong vòng lặp ứng dụng.

## 10. UI/UX

- Dùng native `<select multiple>` hỗ trợ bàn phím, required validation, search
  và chip có nút bỏ với accessible label.
- Employee/read-only state khóa control nhất quán.
- Danh sách và chi tiết package/contract hiển thị toàn bộ assignee.
- Package có tab “Lịch sử thực hiện”; contract có section timeline.
- Timeline có loading, empty, retry/error, actor, absolute timestamp, action và
  document/assignee/changed-field detail.
- Có stale-request guard khi chuyển target/tab.
- Dialog gỡ nhân viên giải thích rõ: công việc còn assignee khác không cần
  successor; chỉ target cuối cùng mới mở UI chuyển giao.

## 11. Test bổ sung

### Python

`tests/test_multi_assignee_activity.py` bao phủ:

- snapshot nhiều membership không collapse;
- quy tắc successor chỉ cho assignee cuối;
- delta activity `{A,B}->{B,C}`;
- sanitize/no-op activity;
- writer không xóa sibling assignment;
- explicit create/fallback và kế thừa toàn bộ assignee version;
- demote/promote `is_latest` hai pha;
- query count timeline, snapshot, version inheritance và notification ở 1/50;
- authorization/pagination timeline.

`tests/test_package_documents.py` bổ sung replay idempotency response/status.

### JavaScript

`tests/js/multi_assignee_activity.test.mjs` bao phủ normalize/dedupe, explicit
assignee, restore toàn bộ selection, delta giữ row identity, version mới stage
đầy đủ assignee và timeline mapping/time.

### E2E

`scripts/verify_multi_assignee_activity_e2e.mjs` xác minh thực tế qua browser,
HTTP API và PostgreSQL:

- manager + A/B/C + outsider tenant;
- package `{A,B}`, quyền A/B/C;
- A update package, B upload PDF, manager delete PDF;
- upload/delete retry cùng idempotency key không tạo duplicate;
- timeline đúng actor/action/time/document name;
- delta `{A,B}->{B,C}`, B giữ row ID/version;
- contract `{A,C}` và update contract;
- notification đúng delta;
- gỡ A không successor khi C vẫn còn;
- chặn gỡ C khi C là assignee cuối của contract;
- version package mới kế thừa B+C và retry sync không duplicate;
- tenant khác nhận 404;
- UI mở tab timeline và thấy actor.

## 12. Kết quả kiểm tra N+1

Các số dưới đây được đo bởi automated query/operation counters, chỉ tính thao
tác cần kiểm tra, không tính fixture setup.

| Endpoint/luồng | Quy mô 1 | Quy mô 50 | Threshold | Kết luận |
|---|---:|---:|---:|---|
| Timeline activity | 2 query | 2 query | chênh lệch ≤ 2 | Pass |
| Snapshot assignee + target + account | 1 query | 1 query | chênh lệch 0 | Pass |
| Kế thừa assignee sang version mới | 2 query | 2 query | chênh lệch 0 | Pass |
| Notification + account + encrypted outbox | 4 DB operation | 4 DB operation | chênh lệch 0 | Pass |
| Kiểm tra assignment theo lineage | 2 query | 2 query | chênh lệch ≤ 1 | Pass |
| Search assignee package/contract | 0 query bổ sung | 0 query bổ sung | chênh lệch 0 | Pass — `EXISTS` nằm trong count/item query |

Chunk size được giới hạn 200/500 tùy luồng. Qua ranh giới chunk chỉ phát sinh
số query cố định theo chunk, không có lazy load/serializer query theo từng row.

## 13. Lệnh đã chạy

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `python -m pytest -q tests` | Pass — 117 passed |
| `node --test tests/js/*.test.mjs` | Pass — 105 passed |
| `npm run lint:security` | Pass |
| `npm run build:secure` | Pass |
| `npm run test:crud-modules-e2e` với server port 8015 | Pass |
| `npm run test:multi-assignee-e2e` với server port 8015 | Pass |
| Fresh PostgreSQL schema tạm, `search_path=<temp>,public` | Pass — v26, 67 bảng |
| Database hiện tại nâng cấp | Pass — v26 |
| Thử sửa activity trực tiếp | Pass — bị chặn, SQLSTATE 23514 |
| `git diff --check` | Pass |

Secure build chỉ phát cảnh báo hai font URL được giữ để resolve lúc runtime và
plugin obfuscator tốn thời gian; không có lỗi build hay security audit.

## 14. Vấn đề phát hiện thêm và cách xử lý

- Fixture E2E so sánh mã gói thầu phân biệt hoa/thường trong khi backend chuẩn
  hóa chữ hoa: chuyển assertion sang ID ổn định.
- Request E2E ban đầu vào personal workspace: thêm `X-Active-Org` cho sync và
  activity.
- Notification còn query/account insert từng recipient: chuyển sang prefetch
  và batch insert.
- Document chỉ dedupe activity nhưng chưa replay toàn mutation: tích hợp
  `api_idempotency` và advisory lock.
- Tạo version từ kế hoạch chỉ copy assignment đầu: dùng complete set delta.
- Recalculate latest có unique race: tách demote/promote trong cùng transaction.
- FK actor xung đột append-only khi xóa account: migration v26 bỏ FK và giữ
  immutable name snapshot.

## 15. Rủi ro/giới hạn còn lại

- Không backfill activity lịch sử cũ vì không có actor/time đáng tin cậy; UI chỉ
  hiển thị event phát sinh sau migration. Đây là chủ đích để không bịa actor.
- Actor account có thể không còn tồn tại; UI dùng `actor_name_snapshot` và giữ
  actor ID như tham chiếu lịch sử không cưỡng chế FK.
- Build giữ nguyên hai đường dẫn font để resolve tại runtime; đây là warning đã
  có, không ảnh hưởng artifact secure.
- Fixture E2E không xóa activity đã tạo vì trigger append-only hoạt động đúng;
  các row test được giữ trong database kiểm thử và có run ID riêng.
- Client cũ chỉ gửi một assignee vẫn tương thích, nhưng cần deploy frontend mới
  cùng backend để có UI nhiều lựa chọn và delta đầy đủ.

## 16. Deploy, migration và rollback

### Deploy

1. Backup PostgreSQL và document storage.
2. Đặt `MIGRATOR_DATABASE_URL` bằng role có DDL; runtime role nên không có DDL.
3. Chạy `python scripts/manage_database.py` trước khi khởi động application mới.
4. Xác minh log báo `PostgreSQL schema ready (version 26)`.
5. Deploy backend và secure frontend artifact cùng release.
6. Smoke test create package `{A,B}`, delta `{B,C}`, timeline và document retry.

Production nên giữ `DATABASE_AUTO_MIGRATE=false` và chạy migration bằng bước
deploy chuyên biệt.

### Rollback

Không có down-migration tự động, vì rollback unique index singleton sẽ làm mất
khả năng biểu diễn dữ liệu nhiều assignee và activity là append-only.

Nếu cần rollback release:

1. dừng write traffic;
2. ưu tiên forward-fix ứng dụng trong khi giữ schema v26;
3. nếu bắt buộc quay về code/schema cũ, restore toàn bộ backup PostgreSQL và
   storage chụp trước migration;
4. không tự tạo lại unique singleton index khi đã có target nhiều assignee;
5. không xóa/sửa activity thủ công để tránh phá tính bất biến.
