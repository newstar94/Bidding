# PROMPT CHO CODEX — CHỈ COMMIT KẾ HOẠCH NHIỀU PHIÊN BẢN KHI LƯU PHIÊN BẢN CUỐI

## Repository

```text
https://github.com/newstar94/Bidding
```

Hãy nghiên cứu kỹ code hiện tại trước khi sửa. Đây là một yêu cầu nghiệp vụ **riêng biệt**, không cần thực hiện lại các yêu cầu sửa conflict/version-selection khác nếu chúng đã được triển khai.

---

# 1. MỤC TIÊU NGHIỆP VỤ

Đối với một kế hoạch có nhiều phiên bản, ví dụ:

```text
00 → 01 → 02 → 03
```

tôi muốn:

- các lần lưu ở phiên bản trung gian chỉ được coi là **lưu nháp**;
- các phiên bản trung gian **không được ghi vào database**;
- chỉ khi người dùng lưu/hoàn tất **phiên bản cuối cùng** thì toàn bộ kế hoạch mới thật sự được lưu vào DB;
- khi final save thành công, phải ghi **toàn bộ chuỗi phiên bản và toàn bộ dữ liệu liên quan**;
- nếu final save thất bại thì DB không được chứa một phần dữ liệu của kế hoạch đó.

Nói cách khác:

```text
Lưu 00
→ draft local
→ DB chưa có kế hoạch

Lưu 01
→ draft local
→ DB vẫn chưa có kế hoạch

Lưu 02
→ draft local
→ DB vẫn chưa có kế hoạch

Lưu phiên bản cuối
→ validate toàn bộ
→ commit toàn bộ chuỗi
→ DB mới có kế hoạch
```

---

# 2. PHẠM VI DỮ LIỆU PHẢI ĐƯỢC COI LÀ MỘT AGGREGATE

Không chỉ bản ghi `kehoach`.

Toàn bộ dữ liệu liên quan đến kế hoạch trong quá trình tạo nhiều phiên bản phải được giữ trong cùng một draft session, bao gồm ít nhất:

```text
kehoach
goithau
goithau children
assignments
thongtinmothau
hanghoaduthaunhathau
thông tin phân lô
hàng hóa
nhà thầu
tổ chuyên gia
tổ thẩm định
các bảng con/liên kết khác đang thuộc aggregate của kế hoạch/gói thầu
```

Hãy rà soát code để xác định đầy đủ các bảng thực tế.

---

# 3. KHÔNG ĐƯỢC GHI DB Ở CÁC PHIÊN BẢN TRUNG GIAN

Trong quá trình người dùng tạo/chỉnh:

```text
00 → 01 → 02 → ...
```

không được thực hiện các thao tác làm xuất hiện dữ liệu nghiệp vụ thật trên server như:

```text
POST /api/sync
POST /api/versioning/aggregate
INSERT kế hoạch
INSERT gói thầu
UPDATE isLatest
```

cho các lần "lưu" trung gian.

Các lần lưu này chỉ được:

- cập nhật state local;
- cập nhật IndexedDB/local persistence nếu cần;
- lưu draft session;
- tạo snapshot/version local;
- render UI;
- cho phép người dùng tiếp tục sang version tiếp theo.

---

# 4. CẦN CÓ KHÁI NIỆM DRAFT SESSION CHO TOÀN BỘ CHUỖI VERSION

Thiết kế một abstraction phù hợp, ví dụ:

```text
PlanVersionDraftSession
```

hoặc tên khác phù hợp với kiến trúc hiện tại.

Draft session phải có khả năng giữ:

```text
Plan root
├── version 00
│   ├── plan data
│   ├── packages
│   ├── assignments
│   └── children
│
├── version 01
│   ├── plan data
│   ├── package snapshots
│   ├── assignments
│   └── children
│
└── version 02
    ├── plan data
    ├── package snapshots
    ├── assignments
    └── children
```

Tất cả dữ liệu trên chưa được coi là persisted business data cho tới final commit.

---

# 5. PHÂN BIỆT "LƯU PHIÊN BẢN" VÀ "LƯU HOÀN TẤT"

Cần làm rõ semantic trong code.

## Lưu phiên bản trung gian

Ví dụ user đang ở `01` và muốn tiếp tục tạo `02`.

Hành động này phải có nghĩa:

```text
save current draft version
→ validate dữ liệu version hiện tại ở mức cần thiết
→ snapshot local
→ tạo version kế tiếp local
→ không sync server
```

## Lưu hoàn tất

Khi user xác nhận hoàn tất toàn bộ chuỗi version:

```text
final save
```

mới:

```text
validate toàn bộ aggregate
→ build full payload
→ gửi server
→ transaction
→ commit toàn bộ
```

Nếu UI hiện chưa có cách phân biệt hai hành động này, hãy refactor UX/workflow tối thiểu cần thiết để code có thể xác định rõ:

```text
intermediate version save
final save
```

Không được dựa vào heuristic không chắc chắn.

---

# 6. FINAL COMMIT PHẢI LÀ MỘT TRANSACTION NGUYÊN TỬ

Backend phải xử lý final commit theo nguyên tắc:

```text
BEGIN TRANSACTION

insert plan version 00
insert package snapshots version 00
insert assignments version 00
insert children version 00

insert plan version 01
insert package snapshots version 01
insert assignments version 01
insert children version 01

...

insert final plan version
insert final package snapshots
insert final assignments
insert final children

set latest flags correctly

COMMIT
```

Nếu bất kỳ bước nào lỗi:

```text
ROLLBACK
```

Không chấp nhận trạng thái:

```text
00 đã lưu
01 đã lưu
02 lỗi
```

hoặc:

```text
plan đã lưu
package chưa lưu
```

hoặc:

```text
package đã lưu
assignment lỗi
```

Toàn bộ aggregate phải:

```text
all-or-nothing
```

---

# 7. KHÔNG ĐƯỢC DÙNG API VERSIONING HIỆN TẠI THEO CÁCH TẠO TỪNG VERSION THẬT TRÊN SERVER

Nếu code hiện tại đang dùng:

```text
/api/versioning/aggregate
```

để tạo lần lượt:

```text
00 server
→ 01 server
→ 02 server
```

thì không phù hợp với yêu cầu mới.

Cần refactor sao cho các version trung gian chỉ tồn tại local.

Backend chỉ nhận toàn bộ version chain khi final save.

Có thể:

- tạo endpoint mới;
- mở rộng endpoint hiện tại;
- tạo transaction service riêng;

nhưng phải giữ code rõ ràng, testable và không phá các flow khác.

---

# 8. ID VÀ ROOTID TRONG DRAFT

Trong draft, không được giả định rằng record đã tồn tại trong DB.

Có thể dùng:

```text
client-generated UUID
```

hoặc:

```text
temporary draft IDs
```

nhưng phải đảm bảo khi final commit:

- mọi quan hệ được remap đúng;
- `rootId` đúng;
- `keHoachId` đúng;
- `goiThauId` đúng;
- `parentId` đúng;
- assignment target đúng;
- package children đúng;
- version lineage đúng.

Ví dụ:

```text
Plan 00
  Package A

Plan 01
  Package B
  rootId = root package family

Plan 02
  Package C
  rootId = cùng package family
```

A/B/C có thể có physical ID khác nhau nhưng đều chỉ tồn tại trong draft trước final save.

---

# 9. SNAPSHOT PACKAGE GIỮA CÁC VERSION

Khi tạo version mới trong draft:

```text
Plan 00
→ create Plan 01
```

phải snapshot:

- package;
- package children;
- assignments;
- dữ liệu liên quan khác;

theo đúng logic versioning hiện tại.

Nhưng snapshot chỉ nằm local.

Không được gửi server.

Nếu user chỉnh package ở version 01:

```text
version 00 snapshot
```

phải giữ nguyên.

Không được mutate ngược version cũ trong draft.

---

# 10. ISLATEST CHỈ ĐƯỢC QUYẾT ĐỊNH KHI FINAL COMMIT

Ví dụ:

```text
00
01
02
```

sau final commit:

```text
00 → isLatest = false
01 → isLatest = false
02 → isLatest = true
```

Trong draft không cần cập nhật `isLatest` trên server.

Nếu local state cần cờ tương tự để render UI thì dùng local-only state hoặc tính từ version order.

Không được để mỗi lần tạo version trung gian lại gọi server để:

```text
demote old version
promote new version
```

---

# 11. KHÔNG ĐƯỢC LƯU "NỬA KẾ HOẠCH"

Một kế hoạch nhiều phiên bản chỉ được coi là persisted khi toàn bộ các thành phần bắt buộc đã commit thành công.

Phải bảo đảm:

```text
plan chain
+
package chain
+
assignments
+
children
+
relations
```

đều thành công.

Nếu validation của một version bất kỳ lỗi:

```text
final commit phải fail trước khi ghi DB
```

hoặc rollback toàn bộ.

---

# 12. VALIDATION TRƯỚC FINAL COMMIT

Trước khi gửi final payload, validate toàn bộ version chain.

Bao gồm:

- dữ liệu bắt buộc của từng plan version;
- package bắt buộc;
- quan hệ package-plan;
- assignment;
- version ordering;
- duplicate version;
- rootId consistency;
- snapshot integrity;
- dangling reference;
- historical immutability trong chính draft;
- các business rules hiện có.

Nếu bất kỳ version nào chưa hợp lệ:

```text
không gửi final commit
```

và hiển thị lỗi phù hợp.

---

# 13. DRAFT LOCAL PHẢI CÓ KHẢ NĂNG KHÔI PHỤC

Vì các version trung gian chưa lưu DB nên cần đảm bảo người dùng không mất công việc chỉ vì:

- đóng modal;
- chuyển màn hình;
- reload bình thường;
- browser crash;

nếu hệ thống hiện tại đã có cơ chế local persistence.

Nên lưu draft trong IndexedDB/local persistence theo workspace.

Draft phải scope theo:

```text
organization/workspace
user nếu cần
plan draft root
```

Không để draft của workspace này xuất hiện ở workspace khác.

---

# 14. CẦN CÓ TRẠNG THÁI DRAFT RÕ RÀNG

Mỗi draft session nên có metadata tương đương:

```json
{
  "draftId": "...",
  "rootId": "...",
  "status": "editing",
  "versions": ["00", "01", "02"],
  "currentVersion": "02",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Tên field có thể khác.

Mục tiêu là code phải biết rõ:

```text
đây là draft chưa commit
```

không nhầm với:

```text
plan đã tồn tại trên server
```

---

# 15. FINAL COMMIT RESPONSE

Sau khi final commit thành công, backend nên trả đủ mapping/canonical records cần thiết.

Ít nhất cần giúp frontend biết:

- persisted plan IDs;
- package IDs;
- rowVersions;
- rootIds;
- latest version;
- sync version nếu hệ thống dùng;
- ID mapping nếu draft IDs được thay bằng server IDs.

Frontend sau đó phải:

1. thay draft state bằng canonical server state;
2. clear draft session;
3. clear temporary IDs nếu có;
4. render dữ liệu persisted;
5. không để duplicate draft + server record.

---

# 16. SAU FINAL COMMIT THÀNH CÔNG

Expected:

```text
draft session = cleared
DB = có toàn bộ version chain
latest = đúng version cuối
UI = hiển thị dữ liệu server canonical
```

Nếu refresh:

```text
toàn bộ chain vẫn tồn tại đúng
```

---

# 17. NẾU FINAL COMMIT THẤT BẠI

Nếu server trả:

```text
validation error
409
500
network error
```

thì:

- DB không được chứa partial aggregate;
- draft local phải còn nguyên trừ khi policy khác đã được triển khai;
- không đánh dấu plan là đã persisted;
- user vẫn có thể sửa draft rồi final save lại.

Không được clear draft trước khi server xác nhận commit thành công.

---

# 18. KHÔNG ẢNH HƯỞNG KẾ HOẠCH ĐÃ TỒN TẠI

Phải phân biệt:

## A. Tạo một kế hoạch mới có nhiều version chưa commit

Áp dụng rule:

```text
all versions local
→ final save mới ghi DB
```

## B. Kế hoạch đã tồn tại trong DB và user chỉnh sửa sau này

Không được tự động biến toàn bộ kế hoạch persisted thành draft mới nếu nghiệp vụ hiện tại không yêu cầu.

Hãy nghiên cứu actual workflow và áp dụng rule đúng context.

Nếu user đang tạo một chuỗi version mới dựa trên plan persisted thì cần xác định transaction boundary rõ ràng.

---

# 19. KHÔNG ĐƯỢC PHÁ CÁC KẾ HOẠCH CHỈ CÓ 1 VERSION

Nếu kế hoạch chỉ có:

```text
00
```

và người dùng hoàn tất ngay ở version 00:

```text
final save version 00
→ commit ngay
```

Không cần bắt buộc phải tạo version 01.

Rule là:

```text
chỉ commit khi user xác nhận đây là phiên bản cuối của draft session
```

không phải:

```text
phải có từ 2 version trở lên
```

---

# 20. CẦN THIẾT KẾ CÁCH XÁC ĐỊNH "PHIÊN BẢN CUỐI"

Không được đoán bằng:

```text
version number lớn nhất hiện tại = final
```

vì user có thể còn muốn tạo version tiếp theo.

Phải có một action/state rõ ràng, ví dụ:

```text
"Lưu & hoàn tất"
```

hoặc:

```text
finalizeDraft()
```

hoặc trạng thái nghiệp vụ tương đương.

Nếu UI hiện chỉ có một nút "Lưu", hãy nghiên cứu workflow hiện tại để bổ sung cách phân biệt rõ:

```text
save intermediate
finalize plan
```

Ưu tiên thay đổi UX tối thiểu.

---

# 21. API BACKEND ĐỀ XUẤT

Có thể triển khai endpoint mới như:

```text
POST /api/plans/finalize-draft
```

hoặc command tương đương.

Payload conceptual:

```json
{
  "draftId": "...",
  "planRootId": "...",
  "versions": [
    {
      "plan": {},
      "packages": [],
      "assignments": [],
      "children": {}
    }
  ]
}
```

Không bắt buộc đúng schema này.

Hãy thiết kế theo codebase hiện tại.

Backend phải:

```text
validate
→ normalize
→ create IDs/remap
→ write all records
→ set version relationships
→ set latest
→ commit
```

trong một transaction.

---

# 22. IDEMPOTENCY

Final save có thể bị double-click hoặc retry do network.

Phải bảo vệ khỏi duplicate insert.

Nếu codebase đã có idempotency key, hãy sử dụng.

Expected:

```text
same finalize request retried
→ không tạo duplicate plan/version/package
```

---

# 23. SECURITY / PERMISSION

Final commit vẫn phải kiểm tra:

- organization/workspace;
- role;
- permission;
- ownership/access;
- foreign key scope.

Không tin vào `organizationId` hoặc ownership từ client nếu backend đã có context xác thực.

Draft local không được cho phép bypass permission khi final commit.

---

# 24. TEST CASE BẮT BUỘC — 3 VERSION

Automated test:

```text
Create Plan draft version 00
Save intermediate
```

Assert:

```text
DB plan count for this root = 0
```

Tiếp tục:

```text
Create version 01
Save intermediate
```

Assert:

```text
DB plan count for this root = 0
```

Tiếp tục:

```text
Create version 02
Save final
```

Assert:

```text
DB contains 00, 01, 02
```

và:

```text
00 isLatest false
01 isLatest false
02 isLatest true
```

---

# 25. TEST PACKAGE SNAPSHOTS

Case:

```text
Version 00
Package name = A

Version 01
Change package name = B

Version 02
Change package name = C
```

Final save.

Expected DB:

```text
V00 package snapshot = A
V01 package snapshot = B
V02 package snapshot = C
```

Không được:

```text
A → bị mutate thành C
B → bị mutate thành C
```

---

# 26. TEST ASSIGNMENTS / CHILDREN

Tạo:

```text
V00: expert E1
V01: expert E1 + E2
V02: expert E2
```

Final save.

Kiểm tra assignment ở từng physical package snapshot đúng theo từng version.

Tương tự với child records khác.

---

# 27. TEST FINAL COMMIT ROLLBACK

Cố tình tạo lỗi ở version cuối hoặc child record.

Expected:

```text
transaction rollback
```

DB:

```text
0 plan version của draft đó
0 package snapshot của draft đó
0 assignment
0 orphan record
```

Draft local vẫn còn.

---

# 28. TEST DOUBLE FINAL SAVE

Gửi cùng final request 2 lần.

Expected:

```text
1 aggregate duy nhất
```

không duplicate:

```text
plan
package
assignment
child
```

---

# 29. TEST 1 VERSION

Case:

```text
Create version 00
Final save ngay
```

Expected:

```text
DB có đúng 1 version
00 isLatest = true
```

---

# 30. TEST RELOAD TRƯỚC FINAL SAVE

Case:

```text
Create 00
Create 01
save intermediate
reload
```

Expected:

- DB chưa có plan;
- draft local được recover;
- user tiếp tục được từ version 01;
- không biến draft thành persisted record.

---

# 31. TEST WORKSPACE ISOLATION

Draft của:

```text
Organization A
```

không được xuất hiện khi switch sang:

```text
Organization B
```

Final commit phải ghi đúng organization.

---

# 32. TEST ID MAPPING

Nếu dùng temporary IDs:

```text
draft-plan-1
draft-package-1
draft-assignment-1
```

sau final commit kiểm tra:

- assignment trỏ đúng persisted package ID;
- package trỏ đúng persisted plan version ID;
- child records trỏ đúng parent;
- rootId lineage đúng;
- không còn dangling temporary ID trong DB.

---

# 33. TEST KHÔNG CÓ SERVER WRITE Ở INTERMEDIATE SAVE

Mock/spyon API.

Khi:

```text
save version 00 intermediate
save version 01 intermediate
```

assert không gọi endpoint ghi business data:

```text
/api/sync
/api/versioning/aggregate
/finalize endpoint
```

Chỉ final save mới gọi server write.

---

# 34. TEST FINAL PAYLOAD ĐỦ TOÀN BỘ VERSION CHAIN

Khi final save, assert payload chứa:

```text
00
01
02
```

và toàn bộ package snapshots/children cần thiết.

Không chỉ gửi version cuối.

---

# 35. RÀ SOÁT CODE CẦN THỰC HIỆN

Tìm toàn bộ code liên quan đến:

```text
create plan
save plan
edit plan
create next version
aggregate version
plan breakdown
package save
assignment save
persistAndSync
mutatePersistAndSync
autoSync
IndexedDB persistence
local draft
rowVersion
isLatest
rootId
version resolver
```

Xác định chính xác chỗ nào hiện tại đang ghi server quá sớm.

---

# 36. KHÔNG ĐƯỢC SỬA THEO KIỂU CHỈ CHẶN API Ở UI

Không được chỉ thêm:

```js
if (!final) return;
```

ở một chỗ rồi để các workflow con vẫn tự sync.

Phải kiểm tra toàn bộ nested workflows:

```text
package save
assignment save
child save
version create
plan save
```

Trong draft session, tất cả phải tôn trọng cùng transaction boundary.

---

# 37. KHÔNG ĐƯỢC CLEAR DRAFT TRƯỚC SERVER ACK

Sai:

```text
click final save
→ clear local
→ call server
→ server fail
→ mất dữ liệu
```

Đúng:

```text
click final save
→ freeze/capture draft snapshot
→ call server
→ server success
→ replace with canonical state
→ clear draft
```

---

# 38. CONCURRENCY TRONG FINAL SAVE

Nếu draft được tạo dựa trên một persisted source plan/version, final commit phải validate source version nếu cần.

Không force overwrite dữ liệu server mới hơn.

Nếu source đã thay đổi bởi người khác, final commit có thể fail conflict theo optimistic locking hiện tại.

Nhưng DB vẫn phải atomic.

---

# 39. PERFORMANCE

Final payload có thể lớn.

Cần:

- tránh serialize duplicate historical records không cần thiết;
- tránh O(n²) khi remap package/child IDs;
- batch insert/update phù hợp;
- transaction vẫn phải an toàn;
- không gửi cùng record lặp nhiều lần.

Nếu payload lớn, có thể normalize theo table.

---

# 40. ACCEPTANCE CRITERIA

Chỉ coi hoàn thành khi toàn bộ điều kiện sau pass:

- [ ] Intermediate save không ghi plan vào DB.
- [ ] Intermediate save không ghi package vào DB.
- [ ] Intermediate save không ghi assignment/children vào DB.
- [ ] Nhiều version được giữ đầy đủ trong local draft.
- [ ] Snapshot từng version không bị mutate ngược.
- [ ] Final save gửi toàn bộ version chain.
- [ ] Final save commit toàn bộ trong một transaction.
- [ ] Một lỗi bất kỳ rollback toàn bộ.
- [ ] Không có partial plan trong DB.
- [ ] Version cuối `isLatest = true`.
- [ ] Các version trước `isLatest = false`.
- [ ] Temporary ID được remap đúng.
- [ ] Package/assignment/children quan hệ đúng.
- [ ] Single-version plan vẫn hoạt động.
- [ ] Reload trước final save không làm plan xuất hiện trong DB.
- [ ] Draft được scope đúng workspace.
- [ ] Double final save không tạo duplicate.
- [ ] Existing persisted workflows không bị regression.
- [ ] Automated tests pass.

---

# 41. OUTPUT BẮT BUỘC SAU KHI CODEX SỬA

Sau khi hoàn thành, báo cáo:

## A. Current behavior

Giải thích chính xác hiện tại code đang persist ở đâu và tại sao.

## B. New architecture

Mô tả:

```text
draft session
intermediate save
version snapshot
finalize
transaction
canonical state replacement
```

## C. Files changed

Liệt kê từng file và lý do.

## D. API changes

Nếu tạo endpoint/service mới, mô tả request/response.

## E. Database transaction

Nêu transaction boundary và rollback behavior.

## F. ID mapping

Giải thích temporary IDs → persisted IDs.

## G. Tests

Liệt kê test mới và command đã chạy.

## H. Verification

Chứng minh bằng test rằng:

```text
save 00
→ DB 0

save 01
→ DB 0

final save 02
→ DB có 00,01,02
```

---

# 42. RÀNG BUỘC CUỐI CÙNG

Không được:

```text
- ghi từng version thật lên DB rồi gọi đó là draft;
- ghi plan trước rồi package sau ngoài transaction;
- xóa draft trước server success;
- mutate historical snapshot;
- set isLatest trên server ở intermediate save;
- tạo duplicate khi retry;
- clear toàn bộ IndexedDB để đơn giản hóa;
- dùng frontend-only flag mà backend vẫn nhận intermediate writes;
- chỉ sửa UI mà không sửa persistence boundary;
- bỏ validation để final save dễ pass.
```

Mục tiêu cuối cùng:

```text
Một kế hoạch nhiều phiên bản là một aggregate draft hoàn chỉnh.

Các phiên bản 00, 01, 02... chỉ tồn tại local trong quá trình soạn thảo.

Chỉ khi người dùng xác nhận lưu phiên bản cuối cùng thì toàn bộ chuỗi version
và toàn bộ dữ liệu liên quan mới được ghi vào DB trong một transaction nguyên tử.

Nếu chưa đến final save:
DB phải coi như kế hoạch đó chưa tồn tại.
```
