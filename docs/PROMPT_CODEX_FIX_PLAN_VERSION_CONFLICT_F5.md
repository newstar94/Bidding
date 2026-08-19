# PROMPT CHO CODEX — SỬA TRIỆT ĐỂ LỖI VERSION PLAN / PACKAGE / CONFLICT / F5 RECOVERY

## Bối cảnh

Repository cần sửa:

```text
https://github.com/newstar94/Bidding
```

Hãy nghiên cứu kỹ code hiện tại của repository trước khi thay đổi. Không được sửa theo suy đoán hoặc chỉ vá UI. Phải hiểu đầy đủ luồng:

- Kế hoạch lựa chọn nhà thầu có nhiều phiên bản, ví dụ `00`, `01`, `02`.
- Gói thầu thuộc kế hoạch cũng có snapshot/version tương ứng.
- Người dùng có thể chỉnh sửa kế hoạch hiện tại, chỉnh sửa gói thầu trong màn hình chi tiết/phân rã kế hoạch, thêm/chỉnh sửa chuyên gia và các phân công liên quan.
- Ứng dụng có local state, local persistence, mutation outbox, auto sync, delta sync/WebSocket, optimistic locking bằng `rowVersion`, conflict recovery draft và version selection state.

Mục tiêu là sửa **triệt để nguyên nhân gốc**, không chỉ che lỗi.

---

# 1. LỖI NGHIÊM TRỌNG: EDIT KẾ HOẠCH VERSION 01 GÂY SELF-CONFLICT 409

## Hiện tượng thực tế

Ví dụ:

1. Kế hoạch có phiên bản `00`.
2. Người dùng tạo/nâng lên phiên bản `01`.
3. Tại kế hoạch `01`, người dùng mở màn hình phân rã/chi tiết kế hoạch.
4. Người dùng chỉnh sửa một gói thầu.
5. Người dùng thêm/chỉnh sửa chuyên gia hoặc phân công trong gói thầu.
6. Người dùng lưu gói thầu.
7. Sau đó người dùng bấm **Lưu kế hoạch**.
8. Ứng dụng báo conflict.
9. Console có request:

```text
POST /api/sync
409 Conflict
```

Stack thực tế đã quan sát:

```text
apiFetch
autoSync
persistAndSync
mutatePersistAndSync
savePlanBreakdown
btnSave.onclick
```

Đây không phải lỗi quyền của chuyên gia.

Đây là lỗi đồng bộ/version/optimistic locking do chính client tạo ra xung đột với dữ liệu mà client vừa lưu trước đó.

---

# 2. NGUYÊN NHÂN GỐC CẦN XỬ LÝ

Hãy đặc biệt kiểm tra các file sau:

```text
frontend/plans/KeHoachWorkflow.js
frontend/plans/planBreakdownDraft.js
frontend/packages/GoiThauWorkflow.js
frontend/app/SyncPushService.js
frontend/app/ConflictResolver.js
frontend/app/SyncPullService.js
frontend/app/syncMergeUtils.js
frontend/app/BiddingModel.js
frontend/packages/GoiThauTable.js
frontend/shared/VersionedEntityService.js
frontend/shared/versionResolver.js
frontend/shared/AggregateVersionClient.js
frontend/app/WorkspaceConflictRecoveryStore.js
frontend/app/SyncCoordinator.js
backend/sync/record_writer.py
backend/sync/aggregate_mutability.py
backend/versioning/aggregate_snapshot.py
backend/versioning/command.py
```

Tên file có thể đã thay đổi ở code mới nhất. Nếu đã refactor thì tìm implementation tương đương.

---

# 3. LỖI DRAFT CHỈ ÁP DỤNG CHO CREATE, KHÔNG ÁP DỤNG CHO EDIT

Trong logic hiện tại, `planBreakdownDraft` chủ yếu chỉ được kích hoạt khi tạo mới kế hoạch.

Logic dạng hiện tại có xu hướng như:

```js
this.planBreakdownDraft = id
  ? null
  : capturePlanBreakdownDraft(...)
```

và:

```js
draft.action === "create"
```

Điều này khiến:

- Tạo kế hoạch mới: các thay đổi trong breakdown có thể được stage local.
- Sửa kế hoạch đã tồn tại, ví dụ version `01`: `planBreakdownDraft` không active.

Hệ quả:

Khi người dùng đang chỉnh sửa kế hoạch `01`, sau đó vào gói thầu và thêm chuyên gia:

```text
Save package/expert
→ sync ngay lên server
```

Sau đó:

```text
Save plan breakdown
→ sync lần nữa
```

Payload thứ hai có thể sử dụng `rowVersion` cũ và gây:

```text
ROW_VERSION_CONFLICT
409 Conflict
```

## Yêu cầu sửa

Phải mở rộng cơ chế `planBreakdownDraft` để hỗ trợ **edit existing plan**, không chỉ `create`.

Mong muốn:

```text
Mở sửa kế hoạch version hiện tại
→ tạo edit draft/snapshot
→ chỉnh package
→ thêm chuyên gia
→ chỉnh assignment
→ chỉnh child records
→ chỉ stage local
→ KHÔNG gọi /api/sync riêng trong từng bước
→ bấm "Lưu kế hoạch"
→ commit toàn bộ thay đổi một lần
```

Thiết kế draft cần phân biệt ít nhất:

```text
action = "create"
action = "edit"
```

hoặc thiết kế tương đương.

Không được dùng điều kiện cứng:

```js
draft.action === "create"
```

nếu điều này làm edit plan bị loại khỏi draft workflow.

---

# 4. PACKAGE SAVE TRONG PLAN BREAKDOWN KHÔNG ĐƯỢC SYNC NGAY

Trong `GoiThauWorkflow` hiện có logic tương tự:

```js
const draftPackageSave = isPlanBreakdownDraftActive(...)

if (draftPackageSave) {
  // stage local
} else {
  // persist/sync
}
```

Vì edit plan không được coi là draft nên package save thực hiện sync thực tế.

## Yêu cầu sửa

Khi package form được mở trong context của plan breakdown đang edit:

```text
Save package
```

chỉ được:

- cập nhật local model;
- cập nhật IndexedDB/local persistence nếu kiến trúc yêu cầu;
- cập nhật mutation draft in-memory/local staging;
- cập nhật assignment draft;
- cập nhật package children;
- render lại modal/table;

nhưng **không được push `/api/sync`** cho đến khi user bấm **Lưu kế hoạch**.

Ngoại lệ:

Nếu package được sửa từ màn hình độc lập ngoài plan breakdown, có thể giữ hành vi lưu/sync bình thường theo thiết kế hiện tại.

Cần xác định context rõ ràng, không được dựa trên heuristic mong manh.

---

# 5. SAVE PLAN BREAKDOWN ĐANG UPSERT QUÁ RỘNG CẢ PLAN FAMILY

Kiểm tra `savePlanBreakdown()`.

Logic hiện tại có đoạn tương tự:

```js
explicitChanges.upserts.kehoach = state.kehoach.filter(
  plan => String(plan.rootId || plan.id) === targetPlanRootId
);
```

Điều này có thể gửi lại toàn bộ family:

```text
00
01
02
...
```

trong khi user chỉ chỉnh sửa version hiện tại.

Đây là phạm vi mutation quá rộng và làm tăng nguy cơ:

- stale rowVersion;
- ghi đè dữ liệu lịch sử;
- conflict không cần thiết;
- thay đổi `isLatest`;
- conflict do dữ liệu đồng bộ từ WebSocket;
- historical snapshot bị gửi lại ngoài ý muốn.

## Yêu cầu sửa

`savePlanBreakdown()` chỉ được gửi:

- plan version đang thực sự thay đổi;
- package version đang thực sự thay đổi;
- assignment thay đổi;
- child records thay đổi;
- deletion thực tế;
- các entity bắt buộc liên quan trực tiếp.

Không gửi toàn bộ version family nếu không cần.

Historical versions phải được coi là immutable trừ khi nghiệp vụ có command riêng.

---

# 6. COMMIT PLAN BREAKDOWN PHẢI LÀ MỘT TRANSACTION LOGICAL

Khi user bấm:

```text
Lưu kế hoạch
```

các thay đổi dưới đây phải được commit nhất quán:

```text
kehoach
goithau
goithau children
assignments
thongtinmothau
hanghoaduthaunhathau
các bảng con liên quan khác
```

Không được có tình trạng:

```text
package save thành công
assignment save thành công
plan save conflict
```

và để hệ thống rơi vào trạng thái nửa cũ/nửa mới.

Nếu backend `/api/sync` đã có transaction DB thì dùng đúng transaction đó.

Nếu payload có nhiều entity liên quan, đảm bảo:

- atomic ở mức nghiệp vụ;
- rollback nếu có conflict;
- không commit một phần nếu các phần phụ thuộc nhau.

---

# 7. ROWVERSION PHẢI LUÔN ĐƯỢC CẬP NHẬT SAU PUSH THÀNH CÔNG

Backend đang optimistic-lock kiểu:

```text
UPDATE ...
WHERE id = ?
AND organization_id = ?
AND row_version = expectedVersion
```

Nếu update thành công thì server tăng row version.

Client phải cập nhật rowVersion mới ngay sau push thành công.

## Yêu cầu kiểm tra

Sau `POST /api/sync` thành công:

- mọi entity server trả `rowVersions` phải được cập nhật vào state;
- IndexedDB/local store phải chứa rowVersion mới;
- mutation outbox tiếp theo phải sử dụng rowVersion mới;
- không được giữ stale clone trong modal/draft.

Nếu state và draft tồn tại song song, cần có chiến lược rebase/canonical update rõ ràng.

---

# 8. KHÔNG ĐƯỢC CHO HISTORICAL PLAN/PACKAGE BỊ GHI ĐÈ

Backend đã có logic historical immutability.

Hãy đảm bảo frontend không gửi mutation update cho:

- plan version cũ;
- package snapshot thuộc plan version cũ;
- package child records thuộc historical plan;
- historical assignments;

trừ khi API/versioning command chính thức cho phép.

Nếu client vô tình gửi, phải sửa client thay vì dựa vào backend reject.

---

# 9. LỖI SAU CONFLICT: MẤT NÚT SỬA/XÓA, CHỈ CÒN NÚT XEM

## Hiện tượng

Sau conflict / refresh / reload data:

- package trước đó có nút **Sửa**
- có nút **Xóa**

nhưng sau đó:

- hai nút biến mất;
- chỉ còn nút **Xem**.

Logic UI hiện tại có dạng:

```js
if (displayedGt.id !== gt.id) {
  // show only View
} else {
  // Edit/Delete
}
```

Đây là hành vi đúng đối với historical version.

Nhưng lỗi là state:

```js
selectedPackageVersion[root]
```

có thể vẫn trỏ tới physical package ID thuộc snapshot/version cũ sau conflict/recovery/full sync.

Do đó UI hiểu nhầm rằng user đang xem historical package.

## Yêu cầu sửa

Sau các sự kiện:

```text
force sync
full sync
conflict cleanup
aggregate version creation
plan version switching
F5 startup after conflict
```

phải normalize/reset `selectedPackageVersion`.

Nếu user KHÔNG chủ động chọn historical version thì mặc định phải trỏ đến:

```text
package snapshot thuộc latest plan version
```

Không được giữ stale physical ID chỉ vì ID đó vẫn tồn tại trong historical records.

### Nguyên tắc

Historical package:

```text
user chủ động chọn version cũ
→ chỉ Xem
```

Latest package:

```text
mặc định sau refresh/sync
→ Sửa/Xóa nếu quyền/trạng thái cho phép
```

---

# 10. F5 SAU CONFLICT: KHÔNG HỎI GIỮ LẠI ĐỂ XỬ LÝ SAU

Đây là yêu cầu nghiệp vụ mới và bắt buộc.

Hiện tại ứng dụng có flow kiểu:

```text
Không thể tự động xử lý xung đột

[Bỏ thay đổi cục bộ]
[Giữ lại để xử lý sau]
```

hoặc conflict recovery draft:

```text
Áp lại
Bỏ
Xử lý sau
```

Không muốn hành vi này nữa đối với conflict.

---

# 11. HÀNH VI MONG MUỐN KHI CONFLICT

Khi server trả:

```text
409
ROW_VERSION_CONFLICT
```

trong phiên hiện tại:

- không tự động xóa ngay dữ liệu user đang nhìn;
- không popup hỏi "Giữ lại để xử lý sau";
- có thể hiển thị toast/banner đơn giản:

```text
Dữ liệu đã thay đổi trên máy chủ.
Nhấn F5 để tải lại dữ liệu mới nhất.
```

Không cần yêu cầu user quyết định giữ recovery draft.

---

# 12. KHI USER F5 SAU CONFLICT

F5 phải được hiểu là:

```text
BỎ THAY ĐỔI LOCAL ĐÃ CONFLICT
+
TẢI LẠI SERVER STATE
```

Startup flow phải:

1. phát hiện workspace đang có conflict;
2. xóa mutation batch/outbox thuộc conflict;
3. xóa conflict recovery draft tương ứng;
4. xóa conflict marker;
5. không restore/apply conflict draft;
6. không hỏi user;
7. full sync/reconcile từ server;
8. normalize version selection;
9. render latest server state;
10. user nhập lại dữ liệu nếu muốn.

---

# 13. CHỈ XÓA DATA BỊ CONFLICT — KHÔNG XÓA TOÀN BỘ LOCAL DATA

Đây là yêu cầu rất quan trọng.

Không được làm kiểu:

```js
localStorage.clear();
indexedDB.deleteDatabase(...);
```

hoặc clear toàn bộ mutation system.

Phải phân biệt:

```text
conflicting mutation
```

với:

```text
các local mutation khác không liên quan
```

Nếu user có một thay đổi local khác hoàn toàn không liên quan và không bị conflict thì không được xóa nhầm.

Nếu kiến trúc hiện tại mutation outbox chỉ hỗ trợ batch nguyên khối, hãy refactor đủ để có khả năng xác định batch conflict và discard đúng batch đó.

---

# 14. CONFLICT RECOVERY STORE CẦN ĐƯỢC THAY ĐỔI

Kiểm tra:

```text
frontend/app/WorkspaceConflictRecoveryStore.js
```

Hiện store có thể lưu các recovery draft.

Đối với yêu cầu mới:

- không cần hỏi user có muốn apply/later khi F5;
- conflict draft có thể chỉ được giữ tạm trong cùng session để xác định dữ liệu cần discard;
- khi reload sau conflict phải tự động clear draft tương ứng.

Có thể bổ sung API:

```js
clear()
```

hoặc:

```js
removeByFingerprint(...)
removeByMutationId(...)
removeForWorkspace(...)
```

Ưu tiên API có scope chính xác.

Không được xóa draft của workspace khác.

---

# 15. SYNC COORDINATOR KHÔNG ĐƯỢC HIỂN THỊ DIALOG "GIỮ LẠI"

Kiểm tra:

```text
frontend/app/SyncCoordinator.js
```

Loại bỏ flow conflict hỏi:

```text
Giữ lại để xử lý sau
```

và flow startup hỏi:

```text
Áp lại / Bỏ / Xử lý sau
```

đối với `ROW_VERSION_CONFLICT`.

Nếu recovery draft được dùng cho loại lỗi khác thì không được xóa bừa chức năng đó.

Phân loại conflict rõ ràng theo `code`.

---

# 16. KHÔNG ĐƯỢC CHE CONFLICT BẰNG FORCE OVERWRITE

Không được sửa bằng cách:

```text
bỏ expectedVersion
```

hoặc:

```text
force update server record dù rowVersion lệch
```

hoặc:

```text
retry vô hạn
```

Optimistic locking phải được giữ nguyên.

Mục tiêu là:

```text
ngăn client tạo stale mutation
+
xử lý conflict đúng UX
```

không phải tắt concurrency protection.

---

# 17. KHÔNG ĐƯỢC TỰ ĐỘNG MERGE DỮ LIỆU NGHIỆP VỤ NHẠY CẢM

Nếu cùng một record bị thay đổi cả local và server:

- không tự động merge field-by-field nếu chưa có rule nghiệp vụ;
- không overwrite server bằng local;
- theo yêu cầu mới, F5 sau conflict phải bỏ local conflict và lấy server.

---

# 18. WEBSOCKET / DELTA SYNC PHẢI KHÔNG GÂY SELF-CONFLICT

Cần test trường hợp:

```text
User A đang edit plan 01
→ local draft tồn tại
→ WebSocket báo database changed
→ delta sync chạy
→ user tiếp tục edit
→ save
```

Draft không được bị phá.

Cần thiết kế merge/rebase phù hợp:

- server delta không được overwrite unsaved draft đang edit;
- draft không được chứa stale rowVersion không thể commit;
- khi commit, dùng canonical latest rowVersion nếu server record không có business field conflict;
- nếu thực sự có concurrent edit cùng record thì trả conflict đúng.

---

# 19. CREATE NEW PLAN VERSION PHẢI GIỮ ĐÚNG SNAPSHOT

Backend aggregate versioning đang clone:

```text
plan
package
package children
assignments
```

và tạo physical ID mới cho package snapshot.

Phải đảm bảo sau khi tạo version mới:

```text
selectedPackageVersion
```

được trỏ tới package ID mới trong latest plan.

Không được tiếp tục trỏ tới package ID của plan version trước.

---

# 20. KHÔNG ĐƯỢC LÀM HỎNG CÁC LUỒNG ĐANG ĐÚNG

Phải regression test các trường hợp:

- tạo kế hoạch mới;
- sửa kế hoạch chưa từng version;
- tạo version mới;
- sửa version mới nhất;
- xem version lịch sử;
- sửa gói thầu từ danh sách độc lập;
- sửa gói thầu từ plan breakdown;
- thêm/xóa chuyên gia;
- assignment;
- xóa package;
- tạo package;
- package phân lô;
- package không phân lô;
- các loại child records hiện có;
- nhiều organization/workspace;
- user nhiều role;
- permission hiện tại.

Không được vì sửa conflict mà phá autosync chung.

---

# 21. TEST CASE BẮT BUỘC — CASE GỐC

Viết automated test cho case:

```text
Given:
Plan root A có version 00

When:
Tạo version 01

And:
Mở edit plan 01

And:
Mở package thuộc plan 01

And:
Thêm 1 chuyên gia

And:
Save package

Then:
KHÔNG có POST /api/sync riêng nếu đang nằm trong plan breakdown edit draft

When:
Save plan

Then:
chỉ có một logical commit cho thay đổi của plan breakdown

And:
không có 409

And:
expert assignment thuộc đúng physical package của plan 01

And:
rowVersion local được cập nhật

When:
F5

Then:
plan 01 vẫn là latest

And:
package latest hiển thị nút Edit/Delete

And:
không tự động chuyển sang historical package
```

---

# 22. TEST CASE CONFLICT THỰC SỰ

Tạo test hai client/session:

```text
Client A tải plan version 01
Client B tải plan version 01

Client B sửa record X và lưu thành công

Client A sửa cùng record X bằng rowVersion cũ
```

Expected:

```text
409 ROW_VERSION_CONFLICT
```

Sau đó:

- không hỏi "Giữ lại để xử lý sau";
- không tự overwrite;
- UI thông báo cần F5.

Khi Client A F5:

- local conflicting mutation của X bị discard;
- conflict recovery draft của X bị clear;
- server record mới nhất được load;
- không hiện recovery dialog;
- không restore local X;
- unrelated local mutation không bị xóa nhầm.

---

# 23. TEST CASE F5 KHI KHÔNG CÓ CONFLICT

Nếu user F5 trong trạng thái bình thường:

- không được tự động discard legitimate pending data theo rule conflict;
- startup behavior hiện tại phải được giữ theo đúng thiết kế;
- chỉ conflict-marked batch mới sử dụng policy discard-on-reload.

---

# 24. TEST CASE SELECTED PACKAGE VERSION

Case:

```text
Plan 00
Package physical ID = GT-A

Create Plan 01
Package snapshot physical ID = GT-B
rootId giống nhau
```

Expected latest state:

```text
selectedPackageVersion[root] = GT-B
```

Nếu user chủ động chọn version 00:

```text
selectedPackageVersion[root] = GT-A
```

→ View only.

Sau:

```text
F5
force sync
conflict cleanup
new version creation
```

nếu user không ở historical mode:

```text
selection phải normalize về GT-B/latest
```

---

# 25. TEST CASE SAVE PAYLOAD SCOPE

Khi chỉ sửa:

```text
Plan version 01
Package P1
Assignment A1
```

assert payload không chứa:

```text
Plan version 00
unmodified Package P2
unmodified historical records
```

trừ record thật sự bắt buộc theo schema.

---

# 26. TEST CASE WEBSOCKET

Automated test:

```text
open edit plan 01
modify package locally but chưa Save Plan
server emits delta sync for unrelated record
continue editing
save plan
```

Expected:

- local draft còn nguyên;
- no lost update;
- no stale package selection;
- no unnecessary conflict.

Thêm case delta cùng record để đảm bảo conflict thật vẫn được phát hiện đúng.

---

# 27. TEST BACKEND

Thêm/điều chỉnh unit/integration tests cho:

```text
backend/sync/record_writer.py
backend/versioning/*
backend/sync/aggregate_mutability.py
```

Phải chứng minh:

- stale expectedVersion → 409;
- correct expectedVersion → success + increment rowVersion;
- historical parent mutation → reject;
- aggregate snapshot IDs đúng;
- assignment clone đúng package mới;
- server không cho stale browser snapshot đổi `isLatest`.

---

# 28. TEST FRONTEND

Ưu tiên test các module:

```text
planBreakdownDraft
KeHoachWorkflow
GoiThauWorkflow
SyncPushService
SyncCoordinator
SyncPullService
syncMergeUtils
GoiThauTable
versionResolver
WorkspaceConflictRecoveryStore
```

Nếu repository đã có Vitest/Jest/test runner thì dùng framework hiện tại.

Không tạo framework test mới nếu không cần.

---

# 29. E2E BROWSER TEST

Nếu repo có Playwright/Cypress hoặc browser automation hiện tại, chạy ít nhất:

### Flow A — normal edit

```text
login
open plan
create version 01
edit package
add expert
save package
save plan
refresh
verify
```

### Flow B — real conflict

```text
two contexts
edit same record
trigger 409
F5 conflict client
verify server state wins
verify no recovery prompt
```

### Flow C — historical view

```text
select version 00
verify View only
select latest 01
verify Edit/Delete
```

---

# 30. LOGGING / DIAGNOSTICS

Giữ log hữu ích cho conflict, nhưng không spam console.

Khi `ROW_VERSION_CONFLICT`, log structured:

```json
{
  "table": "...",
  "id": "...",
  "expectedVersion": 1,
  "currentVersion": 2,
  "mutationId": "...",
  "workspace": "..."
}
```

Không log token, credential hoặc dữ liệu nhạy cảm.

---

# 31. UI/UX SAU KHI SỬA

## Khi conflict xảy ra trong session

Thông báo đơn giản:

```text
Dữ liệu đã thay đổi trên máy chủ.
Nhấn F5 để tải lại dữ liệu mới nhất.
```

Không hiện modal bắt người dùng chọn:

```text
Giữ lại để xử lý sau
```

## Khi F5

Không hiện:

```text
Khôi phục bản nháp?
Áp lại?
Bỏ?
Xử lý sau?
```

Phải tự động:

```text
discard conflicting local mutation
→ fetch server state
→ render
```

Có thể hiện toast sau load:

```text
Đã tải lại dữ liệu mới nhất từ máy chủ.
Các thay đổi bị xung đột trước đó đã được loại bỏ.
```

Toast này không bắt buộc nếu làm UX rườm rà.

---

# 32. KHÔNG DÙNG F5 NHƯ CÁCH SỬA ROOT CAUSE

Rất quan trọng:

Policy:

```text
F5 discard conflict
```

chỉ là behavior phục hồi khi **conflict thật** xảy ra.

Nó không thay thế việc sửa bug self-conflict.

Case:

```text
edit plan 01
add expert
save
```

trong single-user bình thường phải **không còn 409**.

Nếu vẫn còn 409 rồi dựa vào F5 để xóa thì coi như chưa hoàn thành yêu cầu.

---

# 33. REFACTOR NẾU CẦN

Nếu cần, tạo abstraction rõ ràng như:

```text
PlanBreakdownEditSession
PlanBreakdownDraft
MutationBatch
ConflictBatch
VersionSelectionNormalizer
```

Không bắt buộc tên này.

Mục tiêu:

- rõ transaction boundary;
- tránh sync lồng nhau;
- tránh duplicate sync;
- dễ test;
- không để UI workflow trực tiếp điều khiển rowVersion thủ công.

---

# 34. KIỂM TRA NESTED SAVE

Tìm toàn bộ code path có dạng:

```text
save child
→ persistAndSync

save parent
→ persistAndSync lần nữa
```

trong cùng một modal/workflow.

Rà soát không chỉ chuyên gia mà cả:

- package metadata;
- opening info;
- assignment;
- lots;
- contractor data;
- goods;
- appraisal team;
- expert team;
- các child entities khác.

Nếu cùng thuộc một plan breakdown edit session thì phải stage chung.

---

# 35. KIỂM TRA MUTATION OUTBOX

Đảm bảo:

- không enqueue trùng cùng entity nhiều lần không cần thiết;
- newer mutation phải supersede stale mutation hợp lý;
- conflict batch phải có identity;
- discard conflict không xóa unrelated batch;
- flush không resurrect batch đã discard;
- reload không restore conflict batch theo policy mới.

---

# 36. KIỂM TRA STARTUP RECONCILIATION

Startup cần phân biệt:

```text
normal pending mutation
conflict pending mutation
storage failure
offline state
validation rejected
```

Không dùng cùng một recovery behavior cho tất cả.

Rule mới chỉ áp cho:

```text
confirmed sync conflict
```

đặc biệt:

```text
ROW_VERSION_CONFLICT
```

Không được tự discard data vì network timeout hoặc HTTP 500.

---

# 37. ĐIỀU KIỆN ACCEPTANCE CHÍNH

Chỉ coi task hoàn thành nếu toàn bộ các điều kiện sau pass:

- [ ] Edit plan version hiện tại có draft/session đúng.
- [ ] Save package trong plan breakdown không sync riêng.
- [ ] Save expert/assignment trong plan breakdown không sync riêng.
- [ ] Save plan commit thay đổi một lần.
- [ ] Không upsert toàn bộ plan version family vô lý.
- [ ] Không còn self-conflict trong single-user flow.
- [ ] Backend optimistic locking vẫn hoạt động.
- [ ] Real concurrent edit vẫn tạo 409 đúng.
- [ ] Conflict không còn popup "Giữ lại để xử lý sau".
- [ ] F5 sau conflict tự discard đúng conflicting mutation.
- [ ] F5 không xóa unrelated local mutation.
- [ ] Conflict recovery draft không được restore sau F5.
- [ ] selectedPackageVersion được normalize.
- [ ] Latest package sau refresh có Edit/Delete.
- [ ] Historical package vẫn View only.
- [ ] Assignment gắn đúng physical package snapshot của latest plan.
- [ ] WebSocket delta không tạo duplicate/self-conflict.
- [ ] Tests backend pass.
- [ ] Tests frontend pass.
- [ ] E2E flow pass.
- [ ] Không regression các chức năng plan/package/version hiện có.

---

# 38. CÁCH TRIỂN KHAI MONG MUỐN

Thực hiện theo thứ tự:

1. Đọc code hiện tại và vẽ lại actual call flow.
2. Xác định root cause bằng code, không phỏng đoán.
3. Viết test tái hiện lỗi hiện tại trước.
4. Sửa transaction/draft boundary.
5. Thu hẹp mutation payload.
6. Sửa version selection.
7. Sửa conflict UX.
8. Sửa F5 startup cleanup.
9. Thêm test real concurrency.
10. Chạy toàn bộ test.
11. Review diff để tìm regression.
12. Chỉ kết luận hoàn thành khi acceptance criteria pass.

---

# 39. YÊU CẦU OUTPUT CỦA CODEX

Sau khi sửa xong, trả về báo cáo gồm:

## A. Root cause

Nêu chính xác:

- file;
- function;
- call chain;
- vì sao xảy ra 409;
- entity/table nào stale;
- vì sao stale;
- vì sao package chuyển sang View only.

Không được chỉ nói chung chung "race condition".

## B. Files changed

Liệt kê từng file và mục đích thay đổi.

## C. Behavior before/after

Ví dụ:

```text
Before:
save package → sync
save plan → sync lại → 409

After:
save package → stage
save plan → one commit → success
```

## D. Conflict behavior

```text
Before:
409 → recovery draft → ask Keep/Later

After:
409 → mark conflict
F5 → discard conflicted batch → fetch server
```

## E. Tests

Liệt kê:

- test mới;
- test sửa;
- command đã chạy;
- pass/fail.

## F. Remaining risks

Nếu còn case chưa test được, ghi rõ.

---

# 40. RÀNG BUỘC CUỐI CÙNG

Không được:

```text
- tắt rowVersion
- force overwrite server
- clear toàn bộ IndexedDB
- clear toàn bộ localStorage
- xóa toàn bộ outbox vô điều kiện
- biến historical version thành editable
- chỉ sửa nút UI để hiện Edit/Delete
- dùng timeout để né race
- retry sync vô hạn
- nuốt lỗi 409
- coi mọi HTTP error là conflict
```

Phải sửa đúng kiến trúc dữ liệu và transaction boundary.

Mục tiêu cuối cùng là:

```text
1. Single-user edit không tự conflict với chính mình.
2. Concurrent-user edit vẫn được optimistic locking bảo vệ.
3. Historical version vẫn bất biến.
4. Latest version luôn được chọn đúng sau sync/refresh.
5. Conflict thật: F5 bỏ phần local bị conflict và lấy server mới nhất.
6. Không còn hỏi "Giữ lại để xử lý sau".
7. Không làm mất unrelated local data.
```
