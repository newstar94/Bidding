# BÁO CÁO RÀ SOÁT TOÀN DIỆN BIDDINGFLOW
**Ngày rà soát:** 2026-08-07  
**Repository:** `newstar94/Bidding`  
**Nhánh tham chiếu:** `main`  
**Mốc code được rà soát:** đến commit `55cf666707bf1c800467f3ddd84aa92ec8dd9e58` và các commit liên quan gần nhất trên `main`.

---

# 1. Mục tiêu rà soát

Báo cáo này tổng hợp toàn bộ nhận xét kỹ thuật và sản phẩm sau khi rà soát kiến trúc, code và các chức năng chính của BiddingFlow, bao gồm:

- Frontend JavaScript/Vite.
- Backend Starlette/Python.
- PostgreSQL và migration.
- IndexedDB/local state.
- Offline-first / mutation outbox.
- Delta sync / WebSocket sync.
- Workspace, nhiều tổ chức, nhiều vai trò.
- Kế hoạch lựa chọn nhà thầu.
- Gói thầu và versioning.
- Hàng hóa, phân lô, 1G1T, 1G2T.
- Nhà thầu độc lập/liên danh.
- Mở thầu.
- Đánh giá E-HSDT/E-HSĐXKT/E-HSĐXTC.
- Phương pháp đánh giá và xếp hạng.
- Hợp đồng.
- Phân công.
- Excel/Word/document worker.
- Notification.
- AI assistant.
- Security, audit, CSP/Trusted Types.
- Test, E2E, CI/CD.
- Hiệu năng khởi động và runtime.
- Code quality / technical debt.

Mục tiêu không phải chỉ tìm lỗi cú pháp, mà tìm các vấn đề kiến trúc có thể gây:

- dữ liệu frontend/backend không đồng nhất;
- state local và outbox khác nhau;
- cùng một rule nghiệp vụ được hiểu khác nhau ở nhiều module;
- lỗi chỉ xuất hiện ở một luồng UI;
- lỗi version/snapshot;
- race condition;
- chi phí CPU/IndexedDB tăng khi dữ liệu lớn;
- code khó bảo trì, khó mở rộng;
- trải nghiệm người dùng chưa đủ rõ ràng;
- nguy cơ phát sinh regression khi tiếp tục thêm nghiệp vụ.

---

# 2. Đánh giá tổng thể

BiddingFlow hiện **không phải một codebase kém chất lượng**. Ngược lại, hệ thống đã có nhiều cơ chế kỹ thuật tốt:

- scoped workspace;
- IndexedDB;
- offline mutation outbox;
- sync version;
- row version / optimistic concurrency;
- conflict handling;
- WebSocket;
- delta sync;
- server-side pagination;
- backend database I/O lane để tránh block event loop;
- security lint;
- Trusted Types;
- CSP-oriented build;
- SBOM;
- dependency audit;
- immutable mutation audit;
- document worker;
- E2E theo vai trò và nghiệp vụ;
- startup performance budget;
- frontend debt gate;
- Python legacy debt ratchet;
- production packaging;
- backup/restore;
- health live/ready;
- CI khá đầy đủ.

Điểm mạnh này cho thấy codebase đã vượt khỏi mức ứng dụng CRUD thông thường.

Tuy nhiên, BiddingFlow đang bước vào giai đoạn mà:

> **Độ phức tạp nghiệp vụ đang tăng nhanh hơn tốc độ chuẩn hóa kiến trúc.**

Các lỗi nguy hiểm nhất về sau sẽ không còn là lỗi “function không tồn tại”, mà là:

- module A hiểu rule một cách;
- module B hiểu rule theo alias khác;
- backend chỉ nhận một label;
- UI nghĩ đã lưu;
- IndexedDB chưa chắc đã commit;
- outbox vẫn còn mutation;
- state lại rollback;
- hoặc một aggregate snapshot thiếu dữ liệu do browser chưa hydrate đủ.

Nếu không refactor có chủ đích, chi phí sửa bug sẽ tăng nhanh theo số lượng nghiệp vụ.

---

# 3. Các vấn đề kỹ thuật đang tồn tại

## 3.1. P0 — IndexedDB Promise semantics không nhất quán

### Hiện trạng

Trong `frontend/app/BrowserDB.js`, các write API không thống nhất về thời điểm Promise được resolve.

Một số hàm chờ:

```text
transaction.oncomplete
```

Ví dụ:

- `putTableData()`
- `putRecords()`
- `deleteRecords()`
- `applySyncChanges()`

Nhưng một số hàm khác lại resolve tại:

```text
request.onsuccess
```

Ví dụ:

- `set()`
- `putRecord()`
- `deleteRecord()`

### Vấn đề

Trong IndexedDB:

> `request.onsuccess` không đảm bảo toàn bộ transaction đã commit thành công.

Transaction vẫn có khả năng abort sau khi request riêng lẻ success.

Điều này làm contract của adapter bị không nhất quán:

```text
await db.putRecord(...)
```

có lúc có nghĩa “request đã thành công”, có lúc lại có nghĩa “transaction đã commit”.

### Tác động

Đặc biệt nguy hiểm với:

- mutation outbox;
- local persistence;
- rowVersion;
- rollback;
- thao tác xóa;
- sync immediately sau persist.

`WorkspaceMutationOutboxStore.flush()` đang được sử dụng với ý nghĩa dữ liệu đã được durable, nhưng `database.set()` bên dưới hiện chưa đảm bảo semantics đó.

### Đề xuất

Tất cả write method phải thống nhất:

```text
Promise resolve
    ⇔ transaction.oncomplete

Promise reject
    ⇔ transaction.onerror / transaction.onabort
```

Không resolve write Promise chỉ bằng `request.onsuccess`.

### Mức độ

**P0 / Cao.**

---

## 3.2. P0 — Có nguy cơ mâu thuẫn giữa WorkspaceDataStore, state và mutation outbox

### Luồng hiện tại

`WorkspaceDataStore.transaction()` có logic tương tự:

```text
clone state
→ mutate draft
→ apply draft vào model.state
→ persistAndSync()
→ autoSync()
```

Nếu sync thất bại, store rollback:

```text
model.state
IndexedDB
```

về snapshot cũ.

### Vấn đề

Với lỗi mạng/server thông thường:

```text
autoSync() → { ok: false, error }
```

mutation trong durable outbox có thể vẫn còn.

Khi đó có thể xuất hiện trạng thái:

```text
UI state      = dữ liệu cũ
IndexedDB     = dữ liệu cũ
MutationQueue = dữ liệu mới
```

Một lần sync sau có thể gửi lại thay đổi mà UI vừa thể hiện là đã rollback.

### Semantics đúng cho offline-first

Cần phân biệt rõ:

#### Validation/business reject

```text
rollback local state
+
remove/reject đúng mutation
```

#### Row version conflict

```text
conflict resolution workflow
```

#### Network/server unavailable/offline

```text
KHÔNG rollback thay đổi của người dùng
giữ outbox
trạng thái = offlineQueued / pending
```

Đây mới đúng với offline-first architecture.

### Test còn thiếu

Test hiện tại kiểm tra rollback state, nhưng cần thêm contract test chứng minh:

- outbox cũng đúng sau rollback;
- network failure không làm mất/ẩn mutation;
- reconnect gửi đúng mutation;
- sync success mới đánh dấu committed.

### Mức độ

**P0 / Cao.**

---

# 4. P0 — Rule nghiệp vụ đang bị định nghĩa trùng ở nhiều nơi

Đây là vấn đề nguy hiểm nhất về khả năng phát sinh regression nghiệp vụ.

## 4.1. Ví dụ điển hình: “Kết hợp kỹ thuật và giá”

Hiện rule này tồn tại ở nhiều nơi.

### `technicalEvaluationMethod.js`

Nhận diện alias đã normalize:

```text
Kết hợp giữa kỹ thuật và giá
Kết hợp kỹ thuật và giá
```

### `evaluationMethodRules.js`

Lại có:

```text
EVALUATION_METHODS.COMBINED
= "Kết hợp giữa kỹ thuật và giá"
```

và `requiresTechnicalScoreInput()` so sánh label trực tiếp.

### Backend `bid_evaluation_rules.py`

Lại có:

```python
COMBINED_EVALUATION_METHOD = "Kết hợp giữa kỹ thuật và giá"
```

và cũng so sánh label trực tiếp.

### `BiddingCalculations.js`

Hiện còn sử dụng đồng thời:

```text
requiresTechnicalScoreInput()
isCombinedTechnicalPriceMethod()
```

Hai hàm có thể trả kết quả khác nhau cho cùng một dữ liệu legacy/import.

Ví dụ:

```text
"Kết hợp kỹ thuật và giá"
```

có thể xảy ra:

```text
isCombinedMethod       = true
technicalScoreRequired = false
```

Nếu vậy:

- giao diện có thể hiển thị “Điểm tổng hợp”;
- công thức combined có thể chạy;
- nhưng validation không bắt buộc điểm kỹ thuật.

Đây là lỗi logic rất khó phát hiện bằng mắt.

---

## 4.2. Cùng một parser technical score đang tồn tại nhiều implementation

Có nhiều hàm kiểu:

```text
parseTechnicalScore()
```

ở nhiều module.

Dù hiện logic tương tự, về lâu dài rất dễ lệch:

- chỗ nhận `12,5`;
- chỗ chỉ nhận `12.5`;
- chỗ chấp nhận số âm;
- chỗ không;
- chỗ nhận `" 85 "`;
- chỗ khác reject.

### Đề xuất

Frontend phải có **một nguồn sự thật duy nhất** cho:

- evaluation method;
- normalized method code;
- alias handling;
- technical score validation;
- score parsing;
- phương thức/phương pháp lựa chọn;
- các condition dùng trong rendering/ranking.

Backend cũng cần một canonical implementation tương ứng.

---

# 5. P0 — Không nên dùng label tiếng Việt làm business identifier

Hiện nhiều logic so sánh:

```text
"Kết hợp giữa kỹ thuật và giá"
"Giá thấp nhất"
"Giá đánh giá"
"Dựa trên kỹ thuật"
...
```

### Vấn đề

Business logic phụ thuộc trực tiếp vào:

- chính tả;
- khoảng trắng;
- từ “giữa”;
- dấu câu;
- localization;
- dữ liệu legacy;
- import từ hệ thống ngoài.

### Đề xuất

Dữ liệu persisted/canonical nên dùng code:

```text
LOWEST_PRICE
EVALUATED_PRICE
FIXED_PRICE
COMBINED_TECHNICAL_PRICE
TECHNICAL_BASED
```

UI map code → nhãn tiếng Việt.

Ví dụ:

```text
COMBINED_TECHNICAL_PRICE
→ "Kết hợp giữa kỹ thuật và giá"
```

### Tương thích legacy

Không được phá dữ liệu cũ.

Cần:

```text
legacy label
→ normalization
→ canonical code
```

Có migration hoặc serializer compatibility.

---

# 6. P0/P1 — Metadata đánh giá có nhiều parser với behavior khác nhau

Bạn đã có:

```text
frontend/packages/evaluationMetadata.js
```

với các protection tốt:

- JSON hợp lệ;
- phải là object;
- schemaVersion;
- giới hạn kích thước;
- lỗi thì throw.

Nhưng ở một số workflow lại tồn tại parser riêng:

```text
try JSON.parse
catch → {}
```

### Vấn đề

Cùng một metadata lỗi:

```text
module A → báo lỗi
module B → coi như {}
module C → coi như {}
```

Sau đó module B/C có thể ghi `{}` trở lại và làm mất dữ liệu metadata cũ.

### Đề xuất

Tạo một codec dùng chung:

```text
parseEvaluationMetadataStrict()
parseEvaluationMetadataSafe()
serializeEvaluationMetadata()
migrateEvaluationMetadata()
```

Trong đó:

- save path phải strict;
- read-only display có thể safe nhưng phải expose lỗi;
- không tự động ghi `{}` thay metadata lỗi;
- schema migration phải explicit.

---

# 7. P1 — State management chưa có một “cổng ghi” duy nhất

Codebase đã đi theo hướng đúng với:

- `MutationService`;
- `WorkspaceDataStore`;
- `commitLocalMutation`;
- `WorkspaceMutationOutbox`.

Nhưng vẫn còn nhiều direct state write:

```js
model.state.xxx = ...
model.state.xxx.push(...)
record.xxx = ...
```

Frontend debt gate hiện còn baseline `direct_state_writes`.

Điều đó nghĩa là dự án đang:

> ngăn nợ tăng thêm, nhưng chưa loại bỏ nợ hiện có.

### Rủi ro

Một code path có thể:

```text
sửa state
nhưng quên outbox
```

hoặc:

```text
sửa state
nhưng quên persist
```

hoặc:

```text
persist
nhưng UI cache chưa invalidated
```

### Kiến trúc nên hướng tới

```text
UI
↓
Command / Action
↓
Domain Mutation
↓
Workspace Store
↓
State + Outbox
↓
IndexedDB
↓
Sync
```

Các module feature không được trực tiếp ghi state trừ vùng được cho phép.

---

# 8. P1 — `trackDeletions()` diff toàn bảng gây chi phí không cần thiết

Hiện `persistData()` có thể dùng:

```text
trackDeletions()
```

và thực hiện:

1. đọc toàn bộ bảng từ IndexedDB;
2. build map;
3. duyệt toàn bộ state;
4. `JSON.stringify()` record để so sánh;
5. tìm record bị xóa.

### Khi dữ liệu lớn

Các bảng có thể rất lớn:

- `goithauhanghoa`;
- `hanghoaduthaunhathau`;
- `thongtinmothau`;
- assignments;
- contractor data.

Mỗi save lại làm O(N) diff là không cần thiết.

### Trong khi đó

Outbox đã có explicit command:

```text
upsert
delete
replace-table
```

### Đề xuất

Hot path nên chuyển hoàn toàn sang explicit mutation.

`trackDeletions()` chỉ giữ:

- compatibility layer;
- migration phase;
- emergency fallback.

Sau đó loại bỏ.

---

# 9. P1 — `WorkspaceDataStore.transaction()` clone toàn bộ bảng

Transaction hiện clone:

```text
state table
→ snapshots
→ draft
```

Subscription cũng dùng clone + `JSON.stringify()` để detect change.

### Vấn đề

Nếu bảng hàng hóa có hàng nghìn dòng:

```text
state
+
snapshot
+
draft
```

cùng tồn tại trong memory.

### Đề xuất

Chuyển sang patch/change-set transaction:

```text
affectedRecordIds
before
upserts
deletes
after
```

Rollback chỉ rollback record bị tác động.

Subscription dùng:

- revision;
- selector key;
- reference equality;
- normalized entity map;
- hoặc shallow compare.

Không stringify cả tập dữ liệu lớn.

---

# 10. P1 — Version/snapshot aggregate đang đặt quá nhiều trách nhiệm ở browser

`planAggregateSnapshot.js` và `packageAggregateSnapshot.js` đang làm rất nhiều việc:

- chọn version source;
- clone package;
- remap ID;
- clone lots;
- clone goods;
- clone bidder goods;
- clone opening;
- clone JV members;
- clone evaluation reports;
- clone evaluation criteria;
- clone assignment;
- clone timeline;
- clone E-HSMT adjustments;
- clone metadata;
- giữ technical score;
- remap relation.

### Vấn đề kiến trúc

Snapshot correctness phụ thuộc vào:

> browser đã hydrate đủ dữ liệu aggregate hay chưa.

Trong môi trường:

- server-side pagination;
- cold cache;
- partial sync;
- offline;
- route-only hydration;

đây là nguồn bug.

Các lỗi version inheritance trước đây là ví dụ rõ ràng.

### Kiến trúc đích

Client gửi command:

```text
POST /api/plans/{planId}/versions
POST /api/packages/{packageId}/versions
```

Payload:

```text
sourceId
expectedRowVersion
requestedChanges
reason
```

Backend transaction:

```text
BEGIN
lock aggregate
load full source from PostgreSQL
validate
clone aggregate
remap children
apply changes
recalculate latest
audit
COMMIT
```

Client nhận aggregate mới.

### Lợi ích

- atomic;
- không phụ thuộc hydration;
- không cần browser biết mọi child table;
- version invariant tập trung backend;
- dễ test hơn;
- dễ audit hơn.

---

# 11. P1/P2 — `BiddingControllerSync` đang có quá nhiều trách nhiệm

Module sync hiện xử lý cùng lúc:

- sync UI;
- online/offline;
- push mutation;
- pull snapshot;
- delta sync;
- conflict;
- route refresh;
- dashboard invalidation;
- IndexedDB merge;
- WebSocket;
- BroadcastChannel;
- storage event;
- notification refresh;
- error presentation;
- sync status;
- background sync scheduling.

### Vấn đề

Một thay đổi nhỏ về:

```text
WebSocket reconnect
```

có thể tác động:

```text
background sync
```

hoặc:

```text
render route
```

### Đề xuất tách

```text
SyncCoordinator
SyncPushService
SyncPullService
ConflictResolver
WebSocketSyncClient
WorkspaceChannel
SyncPresenter
SyncRenderCoordinator
```

Controller chỉ gọi các service.

---

# 12. P2 — Dynamic prototype injection khó static analysis

Hiện workflow module được lazy import rồi gắn function runtime vào:

```text
BiddingController.prototype
```

Ưu điểm:

- lazy load;
- startup nhẹ;
- không load tất cả workflow ngay.

Nhược điểm:

- dependency ẩn;
- IDE khó trace;
- rename method dễ lệch registry;
- dead code khó xác định;
- call graph khó đọc;
- wildcard export tăng coupling.

### Đề xuất trung hạn

Chuyển dần sang explicit service:

```text
controller.packages.edit()
controller.packages.delete()
controller.plans.createVersion()
controller.evaluation.save()
controller.contracts.update()
```

Không cần rewrite một lần.

Có thể giữ lazy import nhưng trả về service object thay vì mutate prototype.

---

# 13. Code chết / code rác / code thừa

## 13.1. Python legacy debt

Quality gate hiện theo dõi các rule như:

- BLE001;
- F401;
- F841;
- S110;
- S608.

`F401` và `F841` cho thấy có khả năng còn:

- unused import;
- unused local;
- code path đã lỗi thời.

Gate hiện mới là ratchet:

> không cho debt tăng thêm.

Không có nghĩa debt đã được xử lý hết.

### Đề xuất

Mỗi sprint giảm baseline:

```text
F401
F841
BLE001
S110
```

cho đến 0 hoặc mức rất thấp có review.

---

## 13.2. Frontend dead code

Frontend tốt hơn vì ESLint đã có:

```text
no-unused-vars
no-unreachable
no-undef
```

Tuy nhiên dynamic prototype injection/wildcard export làm dead-code analysis khó hơn.

### Đề xuất

Thêm:

- dependency graph;
- unused export scanner;
- duplicate code scanner;
- module cycle checker;
- bundle visualization.

---

## 13.3. Production deadCodeInjection

Secure build đang có:

```text
deadCodeInjection: true
```

Đây là intentional obfuscation, không phải source code rác.

Nhưng nó:

- làm bundle lớn hơn;
- làm parse/compile phức tạp hơn;
- tăng build time;
- có thể ảnh hưởng startup.

### Đề xuất

Benchmark A/B:

```text
deadCodeInjection ON
vs
deadCodeInjection OFF
```

Đo:

- JS bytes;
- compressed bytes;
- cold p95;
- warm p95;
- long task;
- build duration.

Không xem obfuscation là security boundary chính.

---

# 14. P1/P2 — CSS/UI debt còn lớn

Frontend debt gate theo dõi:

- `!important`;
- raw colors;
- `setRuntimeStyle()`;
- inferred button actions;
- direct state writes.

### Vấn đề với runtime style

Nhiều:

```js
setRuntimeStyle(element, "display", ...)
```

làm presentation nằm trong JavaScript.

Khó:

- theme;
- responsive;
- maintain CSS;
- debug specificity;
- reduce style recalculation.

### Đề xuất

Chuyển dần sang semantic class:

```js
element.classList.toggle("is-hidden", hidden)
element.classList.toggle("is-disabled", disabled)
element.classList.toggle("is-loading", loading)
```

CSS quyết định style.

### Design tokens

Thay raw colors bằng token:

```text
--color-danger
--color-warning
--surface-1
--surface-2
--text-muted
```

Mỗi sprint hạ frontend debt baseline.

---

# 15. P1 — Có lỗi encoding/mojibake thực tế

Trong sync UX có chuỗi bị lỗi encoding dạng:

```text
CÃ³ thay Ä‘á»•i chÆ°a Ä‘á»“ng bá»™
```

Đúng ra phải là:

```text
Có thay đổi chưa đồng bộ
```

### Đề xuất

- sửa trực tiếp;
- thêm test hoặc static scan tìm mojibake phổ biến;
- toàn repo UTF-8;
- editorconfig;
- CI detect chuỗi `Ã`, `Ä‘`, `á»` bất thường trong source tiếng Việt.

---

# 16. Test suite tốt nhưng critical coverage còn thấp

Điểm mạnh:

- Python tests;
- JS tests;
- E2E;
- role matrix;
- offline sync;
- joint venture;
- low-price;
- lifecycle;
- startup performance;
- security deployment;
- production packaging;
- dependency audit;
- SBOM.

Tuy nhiên overall backend coverage gate còn thấp và một số critical module có minimum rất thấp.

### Vùng cần tăng coverage

- sync service;
- WebSocket;
- audit monitor;
- lot lifecycle;
- package documents;
- delta paging;
- snapshot/version flow;
- conflict resolver;
- outbox persistence;
- IndexedDB error/abort;
- workspace switching;
- multi-tab workspace event;
- recovery from network failure.

### Mục tiêu

Không cần tăng ồ ạt.

Dùng ratchet:

```text
mỗi PR không được giảm
mỗi sprint tăng critical threshold
```

---

# 17. Đề xuất refactor theo thứ tự

## Giai đoạn 1 — Correctness Foundation

### P0.1 IndexedDB durability

- sửa Promise semantics;
- test transaction abort;
- test quota error;
- test migration blocked;
- test multi-tab versionchange.

### P0.2 WorkspaceDataStore/outbox

- định nghĩa state machine rõ ràng;
- validation reject;
- conflict;
- network failure;
- offline queued;
- retry;
- success commit.

### P0.3 Business rule registry

Hợp nhất:

- evaluation method;
- package method;
- technical score requirement;
- score parser;
- method alias;
- canonical code.

### P0.4 Metadata codec

Một parser/serializer/migration path duy nhất.

### P0.5 Encoding

Sửa mojibake và thêm guard.

---

# 18. Giai đoạn 2 — State Architecture

## Mục tiêu

Không cho feature module chỉnh `model.state` tùy ý.

### API đích

```text
WorkspaceStore.query()
WorkspaceStore.upsert()
WorkspaceStore.delete()
WorkspaceStore.transaction()
WorkspaceStore.subscribe()
```

### Enforcement

Thêm ESLint/custom scanner để cấm direct write ngoài allowlist.

### Debt ratchet

Ví dụ:

```text
92
→ 75
→ 50
→ 25
→ 0
```

Không tăng lại.

---

# 19. Giai đoạn 3 — Mutation-level persistence

Thay full-table diff bằng explicit change set.

### Cấu trúc

```text
mutationId
table
upserts
deletes
baseSyncVersion
expectedRowVersions
```

### Lợi ích

- giảm CPU;
- giảm IndexedDB I/O;
- giảm JSON.stringify;
- giảm race;
- dễ audit;
- dễ test.

---

# 20. Giai đoạn 4 — Server-side versioning/snapshot

Đưa nghiệp vụ version plan/package về PostgreSQL transaction.

### Backend là authority

Client không tự clone aggregate đầy đủ nữa.

### Yêu cầu

- backward compatible;
- không mất historical version;
- latest invariant;
- root invariant;
- assignments được kế thừa;
- package children được kế thừa;
- evaluation state được kế thừa;
- rollback transaction nếu một child clone lỗi;
- audit log đầy đủ.

---

# 21. Giai đoạn 5 — Sync decomposition

Tách `BiddingControllerSync`.

### Module đề xuất

```text
SyncCoordinator
MutationSyncClient
DeltaSyncClient
ConflictResolver
WebSocketSyncClient
WorkspaceEventBridge
SyncStatusPresenter
SyncRenderCoordinator
```

### Mục tiêu

Mỗi module có một trách nhiệm.

---

# 22. Giai đoạn 6 — Controller/module architecture

Dần thay prototype injection bằng explicit feature service.

Ví dụ:

```text
controller.plans
controller.packages
controller.evaluation
controller.contracts
controller.partners
controller.documents
```

Vẫn có thể lazy import.

---

# 23. Tối ưu hiệu năng

## 23.1. Normalized entity indexes

Hiện nhiều workflow dùng:

```text
.find()
.filter()
```

lặp trên array.

Tạo index:

```text
byId
byRootId
byPlanId
byPackageId
byContractorId
byOpeningId
byLotId
```

Không cần thay toàn bộ state ngay; có thể thêm selector/cache layer.

---

## 23.2. Virtualization

Áp dụng cho:

- hàng hóa;
- hàng hóa dự thầu;
- contractor list lớn;
- timeline lớn;
- bảng đánh giá nhiều nhà thầu/lô.

Chỉ render row trong viewport.

---

## 23.3. Excel processing bằng Web Worker khi cần

Loading overlay mới cải thiện UX nhưng computation vẫn có thể block main thread.

Đối với workbook lớn:

```text
read
parse
validate
```

nên profiling.

Nếu long task lớn:

```text
XLSX parse → Web Worker
```

UI chỉ nhận progress/result.

---

## 23.4. WebSocket-first notification

Hiện notification vừa:

- được refresh bởi WebSocket;
- vừa polling định kỳ.

Đề xuất:

```text
WS healthy
→ event-driven refresh

WS disconnected
→ polling fallback
```

Giảm API request không cần thiết.

---

## 23.5. Tiếp tục giữ performance budget

Hiện hệ thống có startup budget.

Nên mở rộng thêm:

- route navigation p95;
- package detail render;
- evaluation table render;
- Excel preview time;
- sync duration;
- IndexedDB commit duration;
- long task count;
- memory peak.

---

## 23.6. Benchmark obfuscation

Đo secure build với/không dead code injection.

Nếu chi phí lớn mà giá trị thấp, cân nhắc giảm.

---

# 24. Nâng cao trải nghiệm người dùng

## 24.1. Một trạng thái lưu/sync rõ ràng

Người dùng không nên phải đoán icon.

Đề xuất hiển thị:

```text
✓ Đã lưu trên máy chủ

↻ Đang đồng bộ 3 thay đổi

☁ Đang làm việc offline · 5 thay đổi chờ gửi

⚠ Có 2 thay đổi bị xung đột
```

---

## 24.2. Autosave bản nháp cho form dài

Áp dụng cho:

- đánh giá HSDT;
- biên bản;
- cấu hình tiêu chí;
- kết quả lựa chọn nhà thầu;
- hợp đồng.

Hiển thị:

```text
Bản nháp đã lưu cục bộ lúc 23:08
```

Phân biệt:

```text
Lưu nháp
Hoàn thành đánh giá
```

---

## 24.3. Validation Summary

Không chỉ tô đỏ field.

Hiển thị:

```text
Còn 4 nội dung cần hoàn thành

• Nhà thầu A — chưa nhập điểm kỹ thuật
• Nhà thầu B — chưa nhập giá xếp hạng
• Lô 02 — thiếu kết luận
...
```

Click item → scroll/focus field.

---

## 24.4. Sticky context

Khi bảng dài, luôn hiển thị:

- tên gói;
- mã gói;
- mã lô;
- nhà thầu;
- vòng đánh giá;
- trạng thái;
- phương pháp đánh giá.

---

## 24.5. Version Diff

Khi xem:

```text
-00
-01
-02
```

phải biết thay đổi gì.

Ví dụ:

```text
Thời gian đóng thầu
10/08 09:00 → 12/08 09:00

Giá gói thầu
Không đổi

Phân công
Nguyễn A → Nguyễn A, Trần B

Hàng hóa
+2 dòng
~1 dòng thay đổi
```

---

## 24.6. Undo cho thao tác destructive phù hợp

Ví dụ:

- xóa assignment;
- xóa row hàng hóa;
- xóa một ghi chú.

Toast:

```text
Đã xóa · Hoàn tác
```

Không áp dụng mù quáng cho thao tác có yêu cầu pháp lý/transaction đã final.

---

# 25. Các tính năng mới đề xuất

## 25.1. Version Diff + Change Impact Analysis — Ưu tiên rất cao

Không chỉ diff field.

Hệ thống có thể trả lời:

```text
Phiên bản mới thay đổi gì?
```

và:

```text
Thay đổi đó ảnh hưởng tới tài liệu, deadline, assignment, evaluation nào?
```

Ví dụ:

> Thời gian đóng thầu đổi từ 10/08 sang 12/08.  
> Các đối tượng có thể cần cập nhật:
> - lịch mở thầu;
> - thông báo;
> - timeline;
> - tài liệu đã xuất;
> - assignment deadline.

---

## 25.2. Conflict Resolution Center — Ưu tiên rất cao

Hiện architecture đã có conflict/outbox.

Nên có UI:

```text
                 Dữ liệu của bạn     Máy chủ
Thời gian đóng   10:00 12/08         09:00 12/08
Người phụ trách  Nguyễn A             Trần B
Giá gói thầu     1,2 tỷ               1,2 tỷ
```

Action:

```text
Dùng dữ liệu máy chủ
Giữ thay đổi của tôi
Chọn từng trường
```

Chỉ cho phép tùy quyền.

---

## 25.3. Procurement Compliance Copilot — Ưu tiên rất cao

AI không chỉ chat.

Kết hợp:

```text
Rule Engine
+
permission-aware data access
+
AI explanation
```

Ví dụ:

> Gói GT-023 chưa đủ điều kiện hoàn thành đánh giá vì Nhà thầu A chưa nhập điểm kỹ thuật.

> Phương pháp đánh giá là Kết hợp kỹ thuật và giá nhưng 2 nhà thầu đang có giá trị “Đạt/Không đạt”.

> Ngày mở thầu đang trước thời gian đóng thầu.

> Phiên bản -02 đã thay đổi thời gian đóng thầu nhưng tài liệu X vẫn chứa thời gian phiên bản cũ.

AI chỉ:

- giải thích;
- tổng hợp;
- đề xuất.

Backend rule engine vẫn là authority.

---

## 25.4. Risk Radar / Deadline Center

Tự xác định:

- gói sắp đóng thầu;
- gói chậm mở thầu;
- đánh giá quá hạn;
- hợp đồng sắp hết hạn;
- assignment chậm;
- bước workflow đang block.

Có dashboard:

```text
Critical
Warning
Upcoming
```

---

## 25.5. What-if Simulator cho đánh giá thầu

Cho phép mô phỏng mà **không sửa dữ liệu chính thức**.

Ví dụ:

```text
Trọng số kỹ thuật 30% → 40%
```

và xem ranking thay đổi thế nào.

Phải đánh dấu:

```text
Mô phỏng
Không phải kết quả chính thức
```

---

## 25.6. Contractor 360

Trang nhà thầu tổng hợp:

- số lần dự thầu;
- số lần trúng;
- số lần trượt;
- tổng giá trị hợp đồng;
- hợp đồng đang thực hiện;
- tỷ lệ đúng hạn;
- lịch sử liên danh;
- lịch sử giá;
- cảnh báo trùng thông tin;
- low-price history;
- clarification history.

---

## 25.7. Data Quality Center

Phát hiện:

- duplicate;
- orphan;
- missing relationship;
- version latest anomaly;
- legacy method labels;
- invalid metadata;
- missing rowVersion;
- package child mismatch;
- stale assignment;
- contractor duplicate tax code;
- broken document reference.

Có nút:

```text
Xem
Sửa
Tự động sửa an toàn
```

---

## 25.8. Template Designer

Cho phép quản trị:

- upload Word/Excel template;
- map placeholder;
- preview;
- version template;
- test dữ liệu mẫu;
- publish template;
- rollback template.

Giảm việc phải sửa code cho mỗi mẫu biểu mới.

---

## 25.9. Approval Workflow nhiều cấp

Ví dụ:

```text
Chuyên viên
→ Trưởng nhóm
→ Quản lý
→ Người phê duyệt
→ Ký
```

Có:

- audit;
- comment;
- reject reason;
- delegated approval;
- SLA;
- immutable final record.

---

## 25.10. Calendar/SLA Integration

Có thể:

- ICS export;
- Google Calendar;
- Outlook;
- reminder.

Các mốc:

- đăng tải;
- đóng thầu;
- mở thầu;
- đánh giá;
- phê duyệt;
- ký hợp đồng;
- hết hạn hợp đồng.

---

## 25.11. Bulk Operation Center

Ví dụ:

- giao việc hàng loạt;
- đổi người phụ trách;
- export nhiều gói;
- cập nhật trạng thái có kiểm soát;
- archive nhiều bản ghi;
- download nhiều tài liệu.

Cần permission + preview + confirmation.

---

## 25.12. API Integration Hub

Hướng dài hạn:

- muasamcong/e-GP;
- ERP;
- kế toán;
- DMS;
- HR;
- digital signature;
- email/SMS;
- BI.

Cần:

```text
connector
mapping
retry
dead-letter
audit
idempotency
```

---

# 26. Thứ tự ưu tiên tính năng sản phẩm

Đề xuất:

```text
1. Version Diff + Impact Analysis
2. Conflict Resolution Center
3. Compliance Copilot
4. Risk / Deadline Radar
5. Contractor 360
6. Data Quality Center
7. What-if Simulator
8. Approval Workflow
9. Template Designer
10. Integration Hub
```

---

# 27. Roadmap kỹ thuật đề xuất

## P0 — Phải làm trước khi mở rộng lớn

1. IndexedDB durability semantics.
2. WorkspaceDataStore/outbox consistency.
3. Business rule canonicalization.
4. Evaluation metadata codec.
5. Fix encoding/mojibake.
6. Contract tests frontend/backend.

## P1 — Refactor nền

7. State write boundary.
8. Mutation-level persistence.
9. Patch transaction.
10. Server-side versioning/snapshot.
11. Split sync module.
12. Tăng critical test coverage.

## P2 — Maintainability/performance

13. Explicit feature service thay dynamic prototype.
14. Normalized indexes/selectors.
15. CSS debt repayment.
16. Dead/unused code cleanup.
17. Virtualized tables.
18. Excel Web Worker khi profiling xác nhận cần.
19. WebSocket-first notifications.
20. Obfuscation A/B benchmark.

## Product

21. Save/sync UX.
22. Draft autosave.
23. Validation summary.
24. Sticky context.
25. Version diff.
26. Safe undo.
27. Conflict Center.
28. Compliance Copilot.
29. Risk Radar.
30. Contractor 360.
31. Data Quality Center.
32. Simulator.
33. Template Designer.
34. Approval Workflow.
35. Calendar/SLA.
36. Bulk Operations.
37. Integration Hub.

---

# 28. Nguyên tắc thực hiện refactor

Không nên rewrite toàn bộ BiddingFlow.

Phải dùng:

```text
Strangler / Incremental Refactor
```

Mỗi thay đổi:

1. viết characterization test;
2. sửa abstraction;
3. migrate một số caller;
4. chạy full test;
5. giảm debt baseline;
6. tiếp tục module kế tiếp.

Không thay đổi cùng lúc:

```text
state architecture
+
backend schema
+
UI lớn
+
business rule
```

trong một commit duy nhất.

---

# 29. Guardrail bắt buộc

Mọi refactor phải giữ nguyên:

- multi-user;
- multi-organization;
- multi-role;
- permission;
- workspace scoping;
- organization isolation;
- offline capability;
- mutation outbox;
- audit;
- row version;
- conflict detection;
- historical version;
- plan/package root relationship;
- existing Excel/Word workflows;
- document worker isolation;
- CSP/Trusted Types;
- E2E behavior;
- production packaging;
- security checks.

Không được chữa lỗi bằng cách:

- skip test;
- tăng timeout vô lý;
- tắt validation;
- tắt secret scan;
- tắt CSP;
- tắt row version;
- bỏ conflict check;
- force overwrite server data;
- xóa historical data;
- bỏ offline outbox.

---

# 30. Tiêu chí đánh giá thành công

Refactor thành công khi:

### Correctness

- không còn inconsistency IndexedDB transaction;
- offline/network failure semantics rõ ràng;
- frontend/backend cùng hiểu business enum;
- alias legacy vẫn hoạt động;
- version inheritance không phụ thuộc partial hydration;
- không mất assignment/child data khi versioning.

### Maintainability

- direct state writes giảm dần;
- duplicate rule giảm mạnh;
- duplicate parser giảm;
- `BiddingControllerSync` nhỏ hơn;
- unused Python code giảm;
- runtime style giảm.

### Performance

Không được regression:

```text
startup cold p95
startup warm p95
long task
API request count
transfer bytes
```

Và nên thêm budget runtime.

### UX

Người dùng luôn biết:

```text
đang lưu
đã lưu
offline
đang chờ sync
sync lỗi
conflict
```

### Test

- P0 có unit/integration tests;
- versioning có transactional backend tests;
- offline có E2E;
- multi-tab có test;
- multi-org không leak;
- permissions không regression.

---

# 31. Đánh giá cuối cùng

BiddingFlow hiện có nền tảng kỹ thuật khoảng **7.5/10**.

### Điểm mạnh

- kiến trúc đã có nhiều lớp bảo vệ;
- CI tốt;
- security tốt;
- offline/outbox tương đối trưởng thành;
- E2E rộng;
- feature set mạnh;
- versioning có tư duy aggregate;
- performance được đo thực tế;
- production concern được chú ý.

### Điểm cần cải thiện nhất

1. State/outbox/persistence consistency.
2. IndexedDB transaction semantics.
3. Business rule bị phân tán.
4. Canonical business identifiers.
5. Client-side aggregate snapshot quá phức tạp.
6. Direct state mutation.
7. Full-table diff.
8. Sync controller quá nhiều trách nhiệm.
9. Legacy debt mới chỉ được ratchet, chưa repayment.
10. Critical coverage còn thấp.

Nếu giải quyết tốt các mục này, BiddingFlow có thể tiến từ:

```text
ứng dụng nghiệp vụ nhiều tính năng
```

sang:

```text
nền tảng quản lý đấu thầu có kiến trúc bền vững
```

mà **không cần viết lại từ đầu**.
