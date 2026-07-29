# PROMPT CHO CODEX — HỖ TRỢ NHIỀU NGƯỜI CÙNG PHỤ TRÁCH VÀ NHẬT KÝ TRÁCH NHIỆM

## 1. Vai trò và mục tiêu

Bạn là kỹ sư phần mềm cấp cao đang làm việc trực tiếp trên repository **BiddingFlow**.

Hãy **đọc kỹ code hiện tại, tự lập kế hoạch và triển khai hoàn chỉnh**, không chỉ viết tài liệu đề xuất. Mục tiêu là sửa ứng dụng để:

1. Một **gói thầu** hoặc **hợp đồng** có thể được phân công cho **nhiều người cùng thực hiện**.
2. Mọi lần:
   - tạo mới dữ liệu gói thầu/hợp đồng;
   - chỉnh sửa dữ liệu gói thầu/hợp đồng;
   - tải lên, thay thế hoặc xóa tài liệu;
   - thêm hoặc loại bỏ người được phân công;

   đều phải lưu và hiển thị được tối thiểu:
   - người thực hiện;
   - thời gian thực hiện;
   - hành động đã thực hiện;
   - đối tượng bị tác động;
   - thông tin tóm tắt đủ để người quản lý xác định trách nhiệm.
3. Không làm suy giảm phân quyền, tenant isolation, idempotency, audit chống sửa đổi, hiệu năng hoặc khả năng đồng bộ hiện tại.
4. Có migration dữ liệu, kiểm thử backend/frontend/E2E và báo cáo kết quả đầy đủ.

---

## 2. Nguyên tắc bắt buộc khi làm việc

1. Trước khi sửa:
   - đọc `README.md`, trạng thái Git, cấu trúc repository và các quy ước hiện có;
   - kiểm tra branch hiện tại và các thay đổi chưa commit;
   - không ghi đè hoặc xóa thay đổi của người dùng;
   - không dùng các lệnh Git phá hủy như `git reset --hard`, `git clean -fd`, checkout cưỡng bức hoặc rebase không cần thiết.
2. Không giả định nội dung chỉ dựa trên prompt này. Hãy mở và đối chiếu code thực tế trước khi thay đổi.
3. Tái sử dụng convention, component, service, transaction, authorization, error model, serializer và test utilities hiện có.
4. Không vá tạm bằng cách chỉ đổi dropdown thành multi-select. Phải sửa xuyên suốt:
   - schema/migration;
   - sync writer;
   - business rules;
   - access policy;
   - notifications;
   - assignment history;
   - frontend state/UI;
   - API/read model;
   - activity history;
   - tests.
5. PostgreSQL là database sản xuất. Không thêm nhánh tương thích SQLite nếu repository không còn dùng SQLite.
6. Mọi actor và timestamp phải được xác lập ở backend từ phiên đăng nhập và thời gian của server. Tuyệt đối không tin `actorUserId`, tên người dùng hoặc thời gian do client gửi lên.
7. Tất cả thay đổi có liên quan phải nằm trong cùng transaction để tránh trường hợp dữ liệu nghiệp vụ thành công nhưng nhật ký thất bại, hoặc ngược lại.
8. Giữ backward compatibility hợp lý cho dữ liệu cũ và client cũ trong giai đoạn migration, nhưng không duy trì hành vi chỉ cho phép một người phụ trách.
9. Không tự ý thay đổi phạm vi nghiệp vụ khác ngoài yêu cầu này, trừ refactor nhỏ cần thiết và có test bảo vệ.

---

## 3. Hiện trạng đã xác định — bắt buộc kiểm chứng lại trong code

### 3.1. Cấu trúc phân công hiện tại

Kiểm tra tối thiểu các khu vực sau:

- `backend/db/schema.py`
- `backend/db/postgres_schema.py`
- `backend/db/upgrades.py`
- `backend/sync/record_writer.py`
- `backend/sync/assignment_augmentation.py`
- `backend/shared/access_policy.py`
- `backend/notifications/service.py`
- các route/service/serializer liên quan đến sync và phân công;
- `frontend/packages/packageAssignmentPolicy.js`
- `frontend/packages/GoiThauWorkflow.js`
- `frontend/contracts/HopDongWorkflow.js`
- các màn hình danh sách/chi tiết gói thầu và hợp đồng;
- các test Python, JavaScript và E2E liên quan.

Bảng `phan_cong_nhan_su` hiện có unique constraint dạng:

```text
(organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
```

Về mặt mô hình dữ liệu, constraint này đã cho phép nhiều nhân viên khác nhau cùng được phân công vào một mục tiêu. Không được thay constraint thành chỉ unique theo mục tiêu.

Tuy nhiên, `SyncRecordWriter._replace_singleton_rows()` hiện có hành vi xóa các dòng phân công khác của cùng tổ chức + mục tiêu + loại đối tượng trước khi ghi dòng mới. Đây là một nguyên nhân cốt lõi khiến dữ liệu bị ép còn một người. Hãy loại bỏ riêng hành vi singleton đối với `phan_cong_nhan_su`, nhưng không vô tình phá các bảng khác thực sự cần singleton.

### 3.2. Frontend đang xử lý một người

Các workflow hiện có biểu hiện như:

- dùng `.find()` thay vì `.filter()` để khôi phục người phụ trách;
- dùng một `<select>` đơn;
- state là một `employeeId` thay vì danh sách/set ID;
- khi submit, giữ một dòng đã chọn rồi xóa mọi dòng phân công còn lại;
- khi tạo mới hoặc tạo phiên bản mới chỉ thêm một người.

Phải chuyển toàn bộ sang mô hình nhiều người và đồng bộ theo **delta**, không xóa rồi tạo lại toàn bộ.

### 3.3. Notification đang giả định một người

Kiểm tra `backend/notifications/service.py` và các hàm tương đương, đặc biệt:

- snapshot assignment được key chỉ bằng `(target_type, target_id)`;
- nhiều dòng có thể ghi đè lẫn nhau trong dictionary;
- logic removed/replaced đang giả định một người cũ và một người mới;
- xóa một người có thể bị hiểu nhầm là mục tiêu không còn ai phụ trách.

Phải đổi sang mô hình membership theo một trong hai dạng tương đương:

```text
(target_type, target_id, user_id)
```

hoặc:

```text
(target_type, target_id) -> set[user_id]
```

Thông báo phải được phát theo từng membership được thêm/xóa và không trùng lặp.

### 3.4. Upload tài liệu đã có một phần thông tin người thực hiện

Kiểm tra:

- schema và service của `tai_lieu_goi_thau`;
- route upload/replace/delete tài liệu;
- `frontend/packages/PackageDocumentsPanel.js`;
- `audit_log` và cơ chế hash chain hiện có.

Hiện tài liệu gói thầu đã có khả năng lưu `uploaded_by_id`, `uploaded_at` và serializer có thể trả tên người tải lên. Hãy bảo toàn và chuẩn hóa phần này.

Tuy nhiên, thông tin của **bản hiện tại** không đủ để theo dõi đầy đủ lịch sử thay thế/xóa hoặc lịch sử thay đổi dữ liệu gói thầu/hợp đồng. Vì vậy cần bổ sung một **nhật ký nghiệp vụ phục vụ sản phẩm**, không chỉ dựa vào màn hình audit kỹ thuật.

---

## 4. Yêu cầu nghiệp vụ chi tiết

### 4.1. Nhiều người cùng phụ trách

Áp dụng tối thiểu cho:

- gói thầu (`goithau`);
- hợp đồng (`hopdong`).

Kiểm tra xem kế hoạch lựa chọn nhà thầu hoặc các đối tượng dùng chung bảng phân công có bị ảnh hưởng hay không. Không làm hỏng hành vi hiện tại của các đối tượng ngoài phạm vi. Nếu kiến trúc dùng chung đủ rõ ràng và an toàn, có thể tổng quát hóa component/service nhưng phải có test hồi quy.

Một gói thầu/hợp đồng phải có thể có:

- 1 người phụ trách;
- 2 người phụ trách;
- nhiều người phụ trách;
- không có dòng phân công trùng cho cùng một người và cùng mục tiêu.

### 4.2. Quy tắc số lượng tối thiểu

Đối với gói thầu/hợp đồng đang hoạt động thuộc tổ chức:

- mặc định phải còn ít nhất một người phụ trách;
- người quản lý được thêm/bớt người phụ trách;
- không cho phép thao tác làm đối tượng còn 0 người phụ trách, trừ khi code hiện có có một trạng thái kết thúc/lưu trữ/xóa mềm cụ thể cho phép điều đó;
- nếu có ngoại lệ theo trạng thái, phải mô tả rõ, triển khai nhất quán backend/frontend và có test.

Không dùng quy tắc “bắt buộc chọn đúng một người tiếp quản”. Khi xóa một thành viên, chỉ cần bảo đảm vẫn còn ít nhất một người hợp lệ.

### 4.3. Tạo mới

Khi tạo gói thầu/hợp đồng:

1. Người có quyền có thể chọn nhiều nhân viên đang hoạt động trong cùng tổ chức.
2. Danh sách phân công phải được gửi và ghi trong cùng mutation/transaction với dữ liệu chính nếu kiến trúc hiện tại cho phép.
3. Nếu client gửi danh sách phân công hợp lệ và không rỗng:
   - dùng đúng danh sách đó;
   - không tự động thêm người tạo nếu người tạo không được chọn.
4. Nếu client không gửi phân công hoặc gửi danh sách rỗng trong ngữ cảnh được phép fallback:
   - backend tự phân công người tạo hiện tại theo cơ chế `assignment_augmentation`;
   - kết quả cuối cùng vẫn có ít nhất một người.
5. Không được tạo dòng trùng khi retry mutation hoặc khi client gửi ID trùng trong mảng.

### 4.4. Chỉnh sửa phân công

Frontend phải tính tập hợp:

```text
existingAssigneeIds
selectedAssigneeIds
added = selected - existing
removed = existing - selected
unchanged = intersection
```

Khi ghi:

- giữ nguyên các dòng `unchanged`, gồm ID, version và metadata hiện có;
- chỉ tạo dòng cho `added`;
- chỉ xóa/kết thúc dòng cho `removed`;
- tuyệt đối không xóa toàn bộ rồi tạo lại;
- thao tác retry phải idempotent;
- xung đột version phải dùng cơ chế hiện có của hệ thống, không bỏ optimistic concurrency.

### 4.5. Tạo phiên bản mới

Nếu gói thầu/hợp đồng có cơ chế tạo version mới:

- mặc định copy **toàn bộ tập người phụ trách đang hoạt động** từ version trước sang version mới;
- nếu form cho phép thay đổi đồng thời thì sử dụng tập người được người dùng xác nhận;
- không để version mới chỉ còn người thao tác hoặc một người đầu tiên do code dùng `.find()`;
- kiểm tra quyền truy cập theo lineage/root để các thành viên hợp lệ không bị mất quyền ngoài ý muốn;
- tránh tạo thông báo hoặc lịch sử trùng cho retry.

### 4.6. Quyền truy cập

Duy trì nguyên tắc hiện tại:

- manager/admin có thể xem và quản lý phân công theo quyền hiện hành;
- nhân viên được phân công vào gói thầu/hợp đồng có quyền đọc/ghi theo policy hiện có;
- chỉ cần người dùng thuộc **bất kỳ một dòng phân công đang hoạt động** của mục tiêu là được xem là assignee;
- người không được phân công không được lợi dụng API để đọc/sửa;
- không cho nhân viên tự thêm người khác nếu policy hiện tại chỉ cho manager làm việc đó;
- nếu nhân viên hiện chỉ được tự phân công trong lúc tạo mới thì giữ nguyên ràng buộc này, nhưng áp dụng đúng với danh sách nhiều người;
- tất cả truy vấn phải lọc theo `organization_id`/tenant;
- không được tin `organization_id`, `owner_type` hoặc `user_id` do client giả mạo.

Kiểm tra đầy đủ:

- read filter;
- write authorization;
- child records;
- tài liệu;
- version lineage;
- search/list/detail;
- export nếu có phụ thuộc người phụ trách.

### 4.7. Thông báo phân công

Khi membership thay đổi:

- thêm người A: thông báo cho A đúng một lần;
- thêm A và B: mỗi người nhận đúng một thông báo;
- xóa A nhưng còn B: chỉ xử lý sự kiện A bị gỡ, không coi đối tượng là vô chủ;
- chuyển từ `{A, B}` sang `{B, C}`: phát đúng delta `remove A`, `add C`; không phát lại cho B;
- retry cùng mutation không tạo thông báo trùng;
- transaction rollback không để lại thông báo mồ côi;
- nội dung thông báo dùng tên/loại đối tượng đúng và không lộ dữ liệu giữa tenant.

Nếu hệ thống dùng outbox/queue, giữ nguyên pattern hiện có.

### 4.8. Lịch sử phân công

Bảng `phan_cong_nhan_su_lich_su` hiện có các trường liên quan thời gian phân công, kết thúc, người kết thúc, người tiếp quản và lý do. Hãy điều chỉnh logic để hỗ trợ nhiều thành viên:

- mỗi membership bị gỡ tạo đúng một bản ghi lịch sử;
- `ended_by` lấy từ actor backend;
- `ended_at` lấy từ server;
- `successor` có thể nullable hoặc chỉ dùng khi thật sự có quan hệ bàn giao trực tiếp;
- không ép mọi lần gỡ một thành viên phải chỉ định duy nhất một successor;
- giữ dữ liệu lịch sử cũ tương thích;
- tránh ghi trùng khi retry.

---

## 5. Nhật ký trách nhiệm/nghiệp vụ

### 5.1. Không thay thế audit bảo mật hiện có

`audit_log` hiện tại là audit kỹ thuật/chống sửa đổi. Hãy giữ nguyên vai trò đó và tiếp tục ghi audit bảo mật tại các điểm hiện có.

Không nên mở trực tiếp toàn bộ `audit_log` cho UI nghiệp vụ nếu metadata có thể chứa thông tin kỹ thuật hoặc nhạy cảm.

Hãy bổ sung một mô hình **append-only domain activity log** phục vụ người dùng, ví dụ tên phù hợp convention như:

```text
nhat_ky_thuc_hien
```

Tên cụ thể có thể điều chỉnh sau khi đọc convention, nhưng chức năng phải đầy đủ.

### 5.2. Dữ liệu tối thiểu của activity log

Thiết kế bảng/read model chứa tối thiểu:

- `id`;
- `organization_id`;
- `owner_type` nếu hệ thống dùng trường này;
- `target_type`: tối thiểu `goithau`, `hopdong`;
- `target_id`: bản ghi/version cụ thể bị tác động;
- `target_root_id` hoặc khóa lineage tương đương để lấy lịch sử xuyên các version;
- `action`;
- `actor_user_id`, nullable chỉ cho dữ liệu cũ/system event hợp lệ;
- snapshot tên hiển thị của actor nếu cần bảo toàn lịch sử khi tài khoản đổi tên/xóa, nhưng không thay thế FK actor;
- `occurred_at` kiểu `TIMESTAMPTZ`;
- `related_document_id` nếu liên quan tài liệu;
- `related_assignment_id` nếu liên quan phân công;
- `client_mutation_id`, `request_id` hoặc khóa idempotency tương đương;
- `metadata_json` đã được lọc và giới hạn kích thước;
- `created_at` nếu convention yêu cầu.

Thêm foreign key/index phù hợp nhưng phải cân nhắc lịch sử khi user/document bị xóa. Không để cascade xóa làm mất nhật ký trách nhiệm.

### 5.3. Các action tối thiểu

Chuẩn hóa action ổn định, có test, ví dụ:

```text
goithau.created
goithau.updated
hopdong.created
hopdong.updated
package_document.uploaded
package_document.replaced
package_document.deleted
assignment.added
assignment.removed
```

Nếu hợp đồng có tài liệu riêng, bổ sung các action tài liệu hợp đồng tương ứng.

Không dùng câu tiếng Việt làm khóa action. UI chịu trách nhiệm map action sang nhãn tiếng Việt.

### 5.4. Nội dung metadata

Đối với create/update:

- ghi danh sách tên trường thay đổi;
- có thể ghi `before`/`after` cho các trường nghiệp vụ an toàn và có giá trị kiểm soát;
- không ghi password, token, secret, session, raw authorization header;
- không ghi binary tài liệu, nội dung file đầy đủ hoặc payload rất lớn;
- không ghi dữ liệu vượt tenant;
- không ghi thay đổi giả nếu giá trị sau normalize không đổi.

Đối với tài liệu:

- tên file hiển thị;
- loại tài liệu nếu có;
- kích thước/MIME type nếu an toàn và có sẵn;
- document ID;
- upload/replace/delete;
- không lưu file bytes vào activity metadata.

Đối với phân công:

- ID và tên hiển thị của người được thêm/gỡ;
- actor thực hiện thay đổi;
- lý do nếu workflow hiện có thu thập;
- không nhầm actor với assignee.

### 5.5. Actor và thời gian

Actor và thời gian phải được tạo ở backend:

```text
actor_user_id = authenticated session user
occurred_at = database/server current time
```

Client không được phép tự ghi, sửa hoặc xóa activity row.

Nếu API nhận field actor/time do client gửi, phải bỏ qua hoặc reject theo convention bảo mật hiện tại.

Timestamps phải tuân theo quy ước timezone hiện hành của repository. Database dùng `TIMESTAMPTZ`; API và UI phải hiển thị nhất quán theo timezone ứng dụng/người dùng, không dùng chuỗi giờ giả hoặc local time không timezone.

### 5.6. Transaction và idempotency

Mỗi activity phải được ghi trong cùng transaction với thay đổi nghiệp vụ.

Các tình huống bắt buộc:

- thay đổi nghiệp vụ thất bại -> không có activity;
- ghi activity thất bại -> transaction nghiệp vụ rollback;
- retry cùng `client_mutation_id` -> không tạo activity thứ hai;
- no-op update -> không tạo `*.updated` giả;
- upload replace retry -> không tạo nhiều event cho cùng một mutation;
- concurrent updates -> không làm sai actor hoặc thứ tự version.

Có thể dùng unique constraint phù hợp, ví dụ trên organization + mutation + action + target, nhưng phải thiết kế theo idempotency thực tế của repository, không áp dụng máy móc.

### 5.7. Dữ liệu cũ

Migration không được bịa actor.

Chính sách backfill:

- dữ liệu create/update cũ không có actor: để trống lịch sử hoặc tạo synthetic event với actor `NULL`/system và nhãn UI “Không xác định”, chỉ khi thật sự hữu ích;
- tài liệu hiện có có `uploaded_by_id` và `uploaded_at`: có thể backfill activity từ dữ liệu đó theo cách idempotent;
- phân công hiện có có `created_at` nhưng không chắc ai đã thực hiện: không gán nhầm người được phân công thành actor;
- mô tả rõ quyết định trong migration/report.

---

## 6. API và read model

Bổ sung API hoặc mở rộng service hiện có để màn hình chi tiết lấy lịch sử nghiệp vụ.

Yêu cầu:

1. Chỉ người có quyền xem gói thầu/hợp đồng mới xem được timeline tương ứng.
2. Lọc bắt buộc theo tenant.
3. Hỗ trợ lịch sử xuyên version bằng root/lineage, nhưng mỗi event vẫn chỉ rõ version/bản ghi cụ thể.
4. Phân trang theo cursor hoặc phương pháp chuẩn đang dùng trong repository.
5. Thứ tự ổn định:

```text
occurred_at DESC, id DESC
```

6. Cho phép filter hợp lý:
   - actor;
   - action;
   - khoảng ngày;
   - loại tài liệu nếu có.
7. Không trả metadata nội bộ nhạy cảm.
8. Tuyệt đối không được phát sinh N+1 query khi resolve actor, assignee, document, target hoặc bất kỳ quan hệ liên quan nào. Phải dùng join/eager loading/select-in loading/batch query phù hợp với ORM và kiến trúc hiện có; không được dựa vào lazy loading trong vòng lặp hoặc trong serializer.
9. Actor đã bị vô hiệu hóa/xóa vẫn hiển thị được tên snapshot hoặc nhãn phù hợp.
10. API phải có schema/validation/serializer rõ ràng và test authorization.

Không tạo endpoint cho client tùy ý thêm/sửa/xóa activity.

### 6.1. Yêu cầu bắt buộc về chống N+1

Áp dụng cho toàn bộ API, service, serializer và luồng nghiệp vụ được thêm mới hoặc chỉnh sửa trong phạm vi công việc này, đặc biệt là:

- danh sách và chi tiết gói thầu/hợp đồng có nhiều người phụ trách;
- timeline lịch sử thực hiện;
- thông tin actor, assignee, tài liệu và đối tượng liên quan;
- luồng tạo phiên bản, đồng bộ phân công và phát thông báo;
- mọi màn hình hoặc endpoint render danh sách nhiều bản ghi.

Yêu cầu kỹ thuật bắt buộc:

1. Không thực hiện truy vấn database bên trong vòng lặp theo từng gói thầu, hợp đồng, người phụ trách, tài liệu hoặc activity event.
2. Không để serializer/template/property truy cập lazy relationship và âm thầm phát sinh thêm một query cho mỗi bản ghi.
3. Dữ liệu liên quan phải được tải theo batch bằng join, eager loading, select-in loading, subquery hoặc kỹ thuật tương đương phù hợp với repository.
4. Số lượng query phải bị chặn bằng automated test; không chỉ review thủ công hoặc nhận xét chung chung.
5. Test query count phải so sánh ít nhất hai bộ dữ liệu, ví dụ 1 bản ghi và 50 bản ghi liên quan, sau khi đã loại trừ query setup/fixture và bước khởi tạo connection.
6. Số lượng query của thao tác được kiểm thử phải giữ nguyên hoặc chỉ chênh lệch bởi một số lượng cố định không phụ thuộc số bản ghi. Nếu framework bắt buộc có query count/pagination phụ, mức chênh lệch tối đa cho phép là 2 query và phải giải thích trong test hoặc báo cáo.
7. Test phải thất bại nếu số query tăng tuyến tính theo số assignee, tài liệu hoặc activity event.
8. Không được bỏ qua test chống N+1 chỉ vì môi trường hiện tại chưa có query counter. Khi chưa có helper, phải bổ sung helper/query listener phù hợp cho test suite.
9. Ghi lại số query thực tế của từng test hiệu năng trong báo cáo cuối cùng.

Không chấp nhận cách diễn đạt hoặc kết luận kiểu “không có N+1 đáng kể”. Tiêu chí là **không có N+1 query** trong các luồng được thêm mới hoặc chỉnh sửa.

---

## 7. Yêu cầu frontend/UX

### 7.1. Component chọn nhiều người

Thay select một người bằng component chọn nhiều người có thể tái sử dụng cho gói thầu và hợp đồng:

- tìm kiếm theo tên/email/mã nhân viên nếu dữ liệu có;
- chọn/bỏ chọn nhiều người;
- hiển thị chip/avatar/tên;
- hỗ trợ bàn phím;
- label, focus, error và ARIA hợp lệ;
- không cho chọn nhân viên đã vô hiệu hóa hoặc ngoài tổ chức;
- vẫn hiển thị thành viên cũ đã vô hiệu hóa trong dữ liệu hiện hữu bằng trạng thái phù hợp, không âm thầm xóa họ;
- trạng thái loading/empty/error rõ ràng;
- không làm form quá cao khi có nhiều người, có thể dùng vùng cuộn hoặc “+N người”.

Không đưa thêm thư viện nặng nếu component hiện có có thể mở rộng.

### 7.2. Quyền chỉnh sửa UI

- manager/admin có quyền: multi-select có thể chỉnh sửa;
- nhân viên không có quyền quản lý phân công: hiển thị read-only;
- frontend không phải lớp bảo mật duy nhất; backend vẫn bắt buộc kiểm tra.

### 7.3. Form gói thầu và hợp đồng

Sửa tối thiểu:

- state từ một ID sang array/set ID;
- khôi phục toàn bộ dòng bằng `.filter()` và normalize ID;
- validation danh sách;
- submit assignment delta;
- tránh double submit;
- giữ dữ liệu khi validation field khác thất bại;
- tạo version mới copy toàn bộ assignee;
- xử lý conflict/reload theo UX hiện tại.

### 7.4. Danh sách và chi tiết

Ở danh sách và chi tiết gói thầu/hợp đồng:

- hiển thị tất cả người phụ trách;
- dùng chip/avatar/count phù hợp, tránh tràn layout;
- tooltip/popover có danh sách đầy đủ nếu bị rút gọn;
- filter/search theo người phụ trách phải match nếu **bất kỳ** assignee nào phù hợp;
- không chỉ hiển thị phần tử đầu tiên;
- thêm dòng:

```text
Cập nhật gần nhất bởi {Tên người} lúc {thời gian}
```

nếu có activity phù hợp.

### 7.5. Timeline “Lịch sử thực hiện”

Thêm tab/section trên trang chi tiết gói thầu và hợp đồng:

```text
Lịch sử thực hiện
```

Mỗi item hiển thị:

- avatar/tên người thực hiện;
- hành động tiếng Việt;
- thời gian tuyệt đối;
- thời gian tương đối có thể là bổ sung, không thay thế thời gian tuyệt đối;
- trường đã thay đổi hoặc tên tài liệu;
- phiên bản liên quan nếu có;
- assignee được thêm/gỡ đối với sự kiện phân công.

Có:

- phân trang/lazy load;
- loading skeleton;
- empty state;
- error + retry;
- filter actor/action/date nếu phù hợp;
- timezone nhất quán.

Không tải toàn bộ lịch sử trong request danh sách. Chỉ fetch khi mở detail/tab hoặc theo cơ chế tối ưu tương đương.

### 7.6. Tài liệu

`PackageDocumentsPanel` hiện đã hiển thị uploader/time cho tài liệu hiện tại. Hãy:

- giữ chức năng này;
- chuẩn hóa format tên và thời gian;
- bảo đảm uploader là người thực sự gọi API;
- sau upload/replace/delete, timeline cập nhật đúng mà không cần hard reload nếu kiến trúc cho phép;
- không hiển thị người thay thế cuối cùng như thể là người tải lên mọi version cũ.

---

## 8. Schema, migration và index

### 8.1. Schema chuẩn

Cập nhật đầy đủ các nguồn schema chuẩn theo convention repository, tối thiểu:

- `backend/db/schema.py`;
- `backend/db/postgres_schema.py` nếu được sinh/chuyển đổi từ schema chuẩn;
- `backend/db/upgrades.py`;
- các model/serializer/query liên quan.

Không chỉ sửa migration mà quên fresh-install schema.

### 8.2. Version migration

- Đọc `DB_SCHEMA_VERSION` hiện tại.
- Thêm version kế tiếp liên tục.
- Không sửa nội dung migration đã phát hành trừ khi repository có quy tắc khác được ghi rõ.
- Migration phải idempotent theo framework hiện tại.
- Có rollback strategy hoặc ít nhất giải thích rõ khả năng rollback dữ liệu/schema trong báo cáo.

### 8.3. Phân công

- Giữ unique constraint cho `(organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)` hoặc tên cột thực tế tương đương.
- Không tạo unique constraint khiến một target chỉ có một người.
- Loại bỏ logic singleton trong writer đối với bảng phân công.
- Thêm index nếu các query “all assignees by target” hoặc “all targets by assignee” chưa được phục vụ tốt.

### 8.4. Activity log

Thêm index tối thiểu tương đương:

```text
(organization_id, target_type, target_root_id, occurred_at DESC, id DESC)
(organization_id, actor_user_id, occurred_at DESC)
```

Thêm unique/index cho idempotency nếu cần.

Đánh giá kích thước `metadata_json`, retention và khả năng tăng trưởng. Không thêm cơ chế tự xóa lịch sử trách nhiệm nếu chưa có yêu cầu nghiệp vụ; nếu cần retention thì chỉ đề xuất, không tự động xóa dữ liệu.

---

## 9. Refactor backend mong muốn

Ưu tiên tạo các abstraction nhỏ, rõ ràng thay vì rải logic:

1. Assignment set/delta helper hoặc service:
   - normalize IDs;
   - validate employee/organization/active state;
   - compute add/remove/unchanged;
   - enforce at least one;
   - write history;
   - queue notifications.
2. Domain activity writer:
   - server-owned actor/time;
   - metadata sanitization;
   - idempotent insert;
   - same transaction;
   - helper riêng cho create/update/document/assignment.
3. Change detector:
   - so sánh giá trị đã normalize;
   - bỏ các field kỹ thuật không cần hiển thị;
   - trả danh sách field changed ổn định.
4. Activity query/read service:
   - authorization;
   - tenant filter;
   - pagination;
   - batched actor resolution.

Không tạo “god service”. Tách theo trách nhiệm nhưng tránh kiến trúc quá mức cần thiết.

---

## 10. Các tình huống biên bắt buộc xử lý

1. Chọn cùng một nhân viên hai lần.
2. Client gửi nhân viên thuộc tổ chức khác.
3. Client gửi nhân viên đã vô hiệu hóa.
4. Hai manager chỉnh danh sách phân công đồng thời.
5. Retry cùng mutation sau timeout mạng.
6. Thêm B rồi gỡ B trong cùng một mutation/batch.
7. Gỡ A khỏi `{A, B}`.
8. Gỡ cả A và B làm danh sách rỗng.
9. Tạo mới với danh sách trống.
10. Tạo mới với danh sách `{A, B}` trong đó người tạo là C.
11. Tạo version mới từ đối tượng có `{A, B, C}`.
12. Một assignee bị vô hiệu hóa sau khi đã được phân công.
13. Actor đổi tên hoặc bị vô hiệu hóa sau khi tạo activity.
14. Update payload giống dữ liệu hiện tại.
15. Upload cùng request/mutation bị retry.
16. Replace tài liệu thất bại giữa lúc ghi DB và storage.
17. Xóa tài liệu đã bị xóa trước đó.
18. Target bị archive/xóa mềm.
19. Người được gỡ đang mở màn hình chi tiết.
20. Dataset có hàng nghìn activity items.
21. Tenant A cố truy cập activity/assignee của tenant B.
22. ID kiểu số/chuỗi bị normalize không nhất quán ở frontend.
23. Dữ liệu cũ có nhiều dòng bất thường hoặc actor null.
24. Version lineage thiếu/không hợp lệ.

---

## 11. Kiểm thử bắt buộc

### 11.1. Backend unit/integration tests

Bổ sung test cho ít nhất:

#### Nhiều người phụ trách

- ghi 2–3 assignment cho cùng một gói thầu;
- ghi 2–3 assignment cho cùng một hợp đồng;
- thêm người thứ hai không xóa người thứ nhất;
- unique cùng user/target được reject hoặc idempotent theo đúng API;
- đọc lại trả đủ tập hợp;
- thứ tự trả về ổn định nếu UI phụ thuộc thứ tự.

#### Delta và quyền

- `{A, B} -> {B, C}` chỉ add C/remove A;
- B giữ nguyên row ID/version;
- A mất quyền sau commit;
- B và C có quyền theo policy;
- người ngoài tập hợp không có quyền;
- manager thấy đầy đủ;
- tenant isolation;
- không được xóa người cuối cùng ở trạng thái hoạt động.

#### Tạo mới và fallback

- explicit `{A, B}` không tự thêm creator C;
- không có explicit assignment -> creator được thêm;
- retry không tạo duplicate;
- employee không thể lách policy để gán người khác.

#### Version

- version mới copy toàn bộ `{A, B, C}`;
- thay đổi explicit chỉ áp dụng delta mong muốn;
- quyền theo lineage đúng;
- không tạo assignment/notification/activity trùng khi retry.

#### Notification

- snapshot không collapse nhiều assignment;
- add/remove thông báo đúng từng user;
- unchanged không nhận lại;
- gỡ một người trong khi còn người khác không bị coi là unassigned;
- rollback không để notification/outbox mồ côi.

#### Assignment history

- gỡ từng thành viên tạo đúng một history row;
- `ended_by` và `ended_at` từ server;
- successor nullable/đúng semantics;
- retry không trùng.

#### Activity log

- create/update gói thầu;
- create/update hợp đồng;
- document upload/replace/delete;
- assignment add/remove;
- actor lấy từ authenticated session;
- timestamp lấy từ server/database;
- no-op không tạo update event;
- retry không tạo duplicate;
- failed transaction không có activity;
- metadata được sanitize;
- target/root/version đúng;
- actor đã vô hiệu hóa vẫn đọc được lịch sử;
- tenant/authorization của endpoint timeline;
- pagination order ổn định.

#### Tài liệu

- `uploadedById`, `uploadedByName`, `uploadedAt` vẫn đúng;
- replacement không ghi đè sai lịch sử uploader;
- delete được audit và activity đầy đủ;
- storage failure rollback/cleanup đúng pattern hiện tại.

#### Hiệu năng và chống N+1

Bắt buộc bổ sung automated tests có query counter/query listener cho các luồng sau:

- API timeline lịch sử thực hiện;
- API/list/detail hiển thị nhiều assignee;
- resolve actor, assignee, document và target;
- luồng notification hoặc version inheritance nếu có truy vấn theo danh sách thành viên;
- mọi endpoint mới hoặc endpoint bị sửa có render collection.

Mỗi test phải:

1. Chuẩn bị ít nhất hai quy mô dữ liệu, ví dụ 1 và 50 bản ghi liên quan.
2. Chỉ đếm query của thao tác cần kiểm thử, không tính query tạo fixture/setup.
3. Khẳng định query count không tăng theo số bản ghi.
4. Ưu tiên cùng một query count giữa hai quy mô; chỉ cho phép chênh lệch cố định tối đa 2 query nếu do count/pagination hoặc hành vi framework không phụ thuộc kích thước collection.
5. Thất bại rõ ràng khi xuất hiện truy vấn trong vòng lặp hoặc lazy loading theo từng bản ghi.
6. Không skip chỉ vì chưa có sẵn query counter; phải bổ sung công cụ đo thích hợp trong test suite.

### 11.2. JavaScript tests

Bổ sung/sửa test cho:

- `packageAssignmentPolicy` trả danh sách thay vì một ID;
- normalize/dedupe ID;
- restore form dùng toàn bộ assignment;
- package workflow compute delta đúng;
- contract workflow compute delta đúng;
- không xóa assignment không liên quan;
- component multi-select keyboard/accessibility cơ bản;
- disabled/read-only theo quyền;
- validation ít nhất một người;
- tạo version copy đầy đủ;
- list/detail render nhiều assignee;
- timeline mapping action và format time;
- stale request/race condition khi đổi target/tab nếu code có async fetch.

### 11.3. E2E

Tạo hoặc mở rộng kịch bản với tối thiểu:

- 1 manager;
- 3 nhân viên A, B, C;
- 1 người ngoài tổ chức hoặc tenant khác nếu fixture hỗ trợ.

Luồng:

1. Manager tạo gói thầu và gán A + B.
2. Xác nhận A và B đều nhìn thấy/mở/sửa theo quyền; C không có quyền.
3. A sửa một trường dữ liệu.
4. B tải tài liệu lên.
5. A thay thế tài liệu hoặc manager xóa tài liệu.
6. Mở “Lịch sử thực hiện”, xác nhận đúng actor, action, timestamp và document name.
7. Manager đổi `{A, B}` thành `{B, C}`.
8. Xác nhận A mất quyền, B giữ quyền, C có quyền.
9. Xác nhận notification chỉ phát cho membership thay đổi.
10. Tạo hợp đồng có A + C và lặp lại kiểm tra create/edit/activity.
11. Tạo version mới và xác nhận toàn bộ assignee được kế thừa.
12. Thử gỡ người cuối cùng và xác nhận bị chặn cả UI lẫn API.
13. Thử request cross-tenant và xác nhận 403/404 theo convention.

Không chỉ kiểm tra DOM; phải kiểm tra dữ liệu lưu thực tế qua API/database helper nếu test infrastructure hỗ trợ.

### 11.4. Lệnh kiểm tra

Sau khi triển khai, chạy ít nhất các lệnh phù hợp đang có trong repository:

```bash
pytest -q tests
node --test tests/js/*.test.mjs
npm run lint:security
npm run build:secure
```

Chạy thêm các E2E liên quan, ví dụ script CRUD modules hiện có và kịch bản mới. Đọc `package.json` để dùng đúng tên script thực tế.

Nếu toàn bộ E2E không chạy được do thiếu browser/service/credential, vẫn phải:

- chạy phần có thể chạy;
- ghi rõ lệnh đã thử;
- ghi nguyên nhân chính xác;
- không tuyên bố pass khi chưa chạy.

---

## 12. Tiêu chí nghiệm thu

Công việc chỉ được coi là hoàn thành khi thỏa tất cả:

1. Một gói thầu có thể lưu nhiều người phụ trách.
2. Một hợp đồng có thể lưu nhiều người phụ trách.
3. Thêm người mới không làm mất người cũ.
4. Xóa một người không làm mất các người còn lại.
5. Không còn code singleton vô tình xóa toàn bộ assignment khác.
6. Frontend không còn `.find()`/single-value logic tại các luồng liên quan.
7. Quyền truy cập sử dụng “user thuộc bất kỳ assignment active nào”.
8. Notification hoạt động theo set delta, không collapse dữ liệu.
9. Assignment history ghi riêng từng thành viên bị gỡ.
10. Tạo mới có explicit assignees không bị tự thêm creator ngoài ý muốn.
11. Fallback creator vẫn hoạt động khi không có assignee hợp lệ.
12. Version mới kế thừa đầy đủ assignees.
13. Create/update package/contract có activity đúng actor/time.
14. Upload/replace/delete document có activity đúng actor/time.
15. Assignment add/remove có activity đúng actor/time và assignee liên quan.
16. Actor/time không thể bị client giả mạo.
17. Retry/no-op không tạo activity, notification hoặc assignment trùng.
18. Activity và thay đổi nghiệp vụ atomic trong transaction.
19. UI hiển thị toàn bộ assignees và timeline rõ ràng.
20. Không có tenant data leak.
21. Không phát sinh bất kỳ N+1 query nào trong các API, service, serializer và luồng nghiệp vụ được thêm mới hoặc chỉnh sửa; automated query-count tests chứng minh số query không tăng tuyến tính khi số assignee, tài liệu hoặc activity event tăng từ 1 lên ít nhất 50 bản ghi.
22. Fresh database và upgraded database đều hoạt động.
23. Test mới pass và test cũ không bị phá.
24. Build/lint pass hoặc có báo cáo trung thực về phần không thể chạy.

---

## 13. Yêu cầu về chất lượng code

- Dùng tên biến/hàm phản ánh tập hợp, ví dụ `assigneeIds`, không giữ tên số ít gây hiểu nhầm.
- Không copy-paste cùng business logic giữa package và contract nếu có thể dùng chung an toàn.
- Không tạo helper “generic” quá khó đọc.
- Type/validation rõ ràng ở ranh giới API.
- Query có index hỗ trợ.
- Không gọi database trong vòng lặp theo từng bản ghi.
- Không sử dụng lazy relationship trong serializer hoặc property được gọi khi render collection.
- Các query đọc collection phải dùng batch loading và có test query count bảo vệ regression.
- Error message tiếng Việt/format theo convention hiện có.
- Không log PII hoặc payload nhạy cảm vào console/server log.
- Không để debug code, commented-out code hoặc TODO không có giải thích.
- Cập nhật tài liệu kỹ thuật liên quan nếu hành vi/API/schema thay đổi.

---

## 14. Trình tự triển khai gợi ý

Codex có thể điều chỉnh sau khi đọc code, nhưng nên thực hiện theo thứ tự an toàn:

1. Khảo sát và ghi lại luồng hiện tại.
2. Viết/điều chỉnh test tái hiện lỗi singleton.
3. Sửa assignment writer và set/delta backend.
4. Sửa access policy, history và notifications.
5. Thêm schema/migration activity log.
6. Tích hợp activity writer vào sync create/update và document routes.
7. Thêm API/read service timeline.
8. Refactor frontend assignment state/component/workflows.
9. Cập nhật list/detail/timeline.
10. Bổ sung unit/integration/JS/E2E tests.
11. Chạy migration trên fresh DB và bản DB nâng cấp.
12. Chạy toàn bộ test/lint/build.
13. Chạy và review automated query-count tests để chứng minh không có N+1; đồng thời review bảo mật, concurrency và idempotency.
14. Viết báo cáo cuối cùng.

---

## 15. Báo cáo đầu ra bắt buộc

Sau khi hoàn thành, tạo file:

```text
CODEX_REPORT_MULTI_ASSIGNEE_ACTIVITY_LOG.md
```

Báo cáo phải có:

1. Tóm tắt nguyên nhân gốc.
2. Danh sách file đã thay đổi.
3. Mô tả schema và migration version.
4. Mô tả business rules cuối cùng.
5. Mô tả cách assignment delta hoạt động.
6. Mô tả activity log, idempotency và transaction.
7. Mô tả quyền và tenant isolation.
8. Mô tả UI/UX đã thay đổi.
9. Danh sách test đã thêm/sửa.
10. Bảng lệnh đã chạy và kết quả pass/fail/skip.
11. Các vấn đề phát hiện thêm và cách xử lý.
12. Bảng kết quả kiểm tra N+1: endpoint/luồng, quy mô dữ liệu, số query với 1 bản ghi, số query với ít nhất 50 bản ghi, threshold và kết luận.
13. Rủi ro còn lại hoặc việc chưa thể xác minh.
14. Hướng dẫn migration/deploy/rollback.

Trong phản hồi cuối cùng của Codex, không chỉ nói “đã hoàn thành”. Hãy nêu ngắn gọn:

- nguyên nhân gốc;
- thay đổi chính;
- migration;
- test đã chạy;
- đường dẫn báo cáo;
- mọi giới hạn còn lại.

---

## 16. Nhắc lại các lỗi không được mắc

Không được:

- chỉ đổi UI thành multi-select;
- tiếp tục gọi `_replace_singleton_rows()` theo cách xóa các assignee khác;
- dùng dictionary key thiếu `user_id` làm collapse assignments;
- xóa rồi tạo lại toàn bộ assignment mỗi lần save;
- coi assignee là actor của thay đổi;
- lấy actor/time từ client;
- ghi activity ngoài transaction;
- tạo activity cho no-op/retry;
- dùng `audit_log` kỹ thuật làm API timeline mà không lọc dữ liệu;
- làm mất uploader/time tài liệu hiện có;
- bịa actor cho dữ liệu cũ;
- bỏ qua version lineage;
- bỏ qua cross-tenant authorization;
- thêm bất kỳ N+1 query nào hoặc chấp nhận query count tăng theo số bản ghi;
- truy vấn database trong vòng lặp;
- để lazy loading phát sinh query trong serializer/render collection;
- bỏ qua automated query-count test với lý do test suite chưa có sẵn helper;
- sửa migration cũ đã phát hành;
- tuyên bố test pass khi chưa thực sự chạy.

Hãy triển khai hoàn chỉnh, tự kiểm tra lại diff, chạy test và sửa mọi lỗi phát hiện được trong phạm vi công việc này trước khi kết thúc.
