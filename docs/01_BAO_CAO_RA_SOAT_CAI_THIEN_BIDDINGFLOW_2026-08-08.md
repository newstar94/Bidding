# BÁO CÁO RÀ SOÁT VÀ CẢI THIỆN BIDDINGFLOW
**Ngày:** 2026-08-08  
**Repository:** `newstar94/Bidding`  
**Nhánh:** `main`

> Tài liệu này **chỉ tập trung vào sửa lỗi, refactor, tính đúng đắn, hiệu năng, technical debt và UX nền tảng**.
>
> Toàn bộ đề xuất về **tính năng mới / nâng cấp sản phẩm** đã được chuyển sang tài liệu riêng:
> `03_DE_XUAT_TINH_NANG_MOI_VA_NANG_CAP_BIDDINGFLOW_2026-08-08.md`.

---

# 1. Mục tiêu

Rà soát BiddingFlow theo các lớp:

- frontend architecture;
- backend architecture;
- local state;
- IndexedDB;
- offline/outbox;
- sync;
- WebSocket;
- rowVersion/conflict;
- multi-organization;
- RBAC;
- plan/package versioning;
- opening/evaluation;
- contractor/JV;
- contract;
- Excel/Word/document;
- CI;
- security;
- performance;
- code quality;
- technical debt.

Mục tiêu trước mắt:

```text
SỬA ĐÚNG
↓
ỔN ĐỊNH
↓
GIẢM NỢ KỸ THUẬT
↓
TỐI ƯU
↓
SAU ĐÓ MỚI CÂN NHẮC FEATURE MỚI
```

---

# 2. Đánh giá tổng thể

BiddingFlow không phải codebase yếu.

Hệ thống đã có nhiều nền tảng tốt:

- multi-organization;
- multi-role/RBAC;
- IndexedDB;
- offline mutation outbox;
- row version;
- conflict handling;
- delta sync;
- WebSocket;
- server-side pagination;
- virtualization utility;
- document worker;
- security guardrails;
- CSP/Trusted Types;
- CI/E2E;
- startup performance budget;
- dependency/security audit;
- technical debt ratchet.

Điểm cần cải thiện lớn nhất hiện nay là:

> **Cùng lúc đang tồn tại nhiều thế hệ kiến trúc và nhiều đường xử lý cho cùng một nghiệp vụ.**

Điều đó gây ra các lỗi khó phát hiện:

- module A hiểu rule khác module B;
- UI state khác IndexedDB;
- IndexedDB khác outbox;
- outbox khác server;
- snapshot/version phụ thuộc dữ liệu đã hydrate;
- code mới dùng abstraction mới nhưng code cũ vẫn direct-write state;
- validation ở UI và backend không hoàn toàn cùng semantics.

---

# 3. P0 — IndexedDB write semantics không nhất quán

## Hiện trạng

Trong `BrowserDB.js`, có write method resolve ở:

```text
request.onsuccess
```

trong khi một số write method khác chỉ resolve ở:

```text
transaction.oncomplete
```

Các method kiểu:

```text
set()
putRecord()
deleteRecord()
```

có semantics khác với:

```text
putTableData()
putRecords()
deleteRecords()
applySyncChanges()
```

## Vấn đề

IndexedDB:

```text
request success
!=
transaction commit
```

Một request có thể success nhưng transaction vẫn abort.

Caller có thể tưởng:

```text
await db.putRecord(...)
```

nghĩa là dữ liệu đã durable, trong khi thực tế transaction chưa chắc commit.

## Tác động

Nguy hiểm với:

- mutation outbox;
- sync ngay sau persist;
- delete;
- rowVersion;
- rollback;
- recovery.

## Đề xuất

Tất cả write API phải có contract:

```text
resolve ⇔ transaction.oncomplete
reject  ⇔ transaction.onerror / transaction.onabort
```

Không resolve write Promise ở `request.onsuccess`.

## Mức độ

**P0 / Cao.**

---

# 4. P0 — WorkspaceDataStore / Outbox / Offline có nguy cơ lệch trạng thái

## Luồng rủi ro

Có thể xảy ra:

```text
UI state rollback
IndexedDB rollback
Mutation outbox vẫn giữ thay đổi mới
```

Sau đó lần sync tiếp theo có thể gửi mutation mà người dùng tưởng đã bị rollback.

## Semantics offline-first nên là

### Validation/business reject

```text
rollback đúng affected records
+
remove/reject đúng mutation
```

### Conflict

```text
không overwrite im lặng
→ conflict resolution
```

### Network/server unavailable

```text
GIỮ local state
GIỮ IndexedDB
GIỮ outbox
status = offlineQueued
```

Không nên rollback edit của người dùng chỉ vì mạng tạm thời lỗi.

## Cần sửa

`WorkspaceDataStore.transaction()` và lớp `persistAndSync()` cần phân loại outcome rõ ràng.

Gợi ý:

```text
committed
offlineQueued
validationRejected
conflict
persistenceFailed
transportFailed
```

## Mức độ

**P0 / Cao.**

---

# 5. P0 — Business rule đánh giá đang bị định nghĩa trùng

Các module đang cùng diễn giải phương pháp đánh giá:

```text
evaluationMethodRules.js
technicalEvaluationMethod.js
BiddingCalculations.js
BidEvaluationTablePresentation.js
bidEvaluationActions.js
backend/sync/bid_evaluation_rules.py
```

## Ví dụ

Các biến thể:

```text
Kết hợp giữa kỹ thuật và giá
Kết hợp kỹ thuật và giá
```

không phải mọi nơi đều normalize giống nhau.

Một module có thể nhận là combined method, module khác lại không.

## Hậu quả

Có thể xuất hiện tình trạng:

```text
UI hiển thị Điểm tổng hợp
nhưng validation không bắt điểm kỹ thuật
```

hoặc:

```text
frontend accept
backend reject
```

## Đề xuất

Tạo một canonical evaluation domain rule.

---

# 6. P0 — Không nên dùng label tiếng Việt làm business identifier

Hiện logic còn phụ thuộc trực tiếp vào label:

```text
"Giá thấp nhất"
"Giá đánh giá"
"Kết hợp giữa kỹ thuật và giá"
"Dựa trên kỹ thuật"
```

## Rủi ro

Logic bị ảnh hưởng bởi:

- chính tả;
- dấu;
- khoảng trắng;
- từ “giữa”;
- legacy data;
- import ngoài hệ thống.

## Đích

Dùng canonical code:

```text
LOWEST_PRICE
EVALUATED_PRICE
FIXED_PRICE
COMBINED_TECHNICAL_PRICE
TECHNICAL_BASED
```

UI map code → nhãn.

Legacy label vẫn phải normalize tương thích.

---

# 7. P0 — Technical score parser đang có nhiều implementation

Cần chỉ có một semantics.

## Rule đề xuất

- trim;
- hỗ trợ decimal;
- normalize dấu phẩy nếu nghiệp vụ cho phép;
- finite;
- >= 0;
- không boolean;
- reject text;
- reject `Đạt`;
- reject `Không đạt` với dữ liệu đánh giá mới.

Historical compatibility phải tách riêng.

Không để parser UI/backend/import/ranking khác nhau.

---

# 8. P0/P1 — Evaluation metadata parser chưa thống nhất

Có module strict.

Có module:

```text
try JSON.parse
catch → {}
```

## Nguy cơ

Metadata lỗi có thể bị biến thành `{}`.

Sau đó save lại có thể mất dữ liệu cũ.

## Đề xuất

Một codec authoritative:

```text
parseStrict()
parseForDisplay()
serialize()
migrate()
```

Save path phải strict.

Read-only display có thể tolerant nhưng không được silent overwrite.

---

# 9. P1 — State mutation chưa có một cổng ghi duy nhất

Code đã có:

- `MutationService`;
- `WorkspaceDataStore`;
- `commitLocalMutation`;
- outbox.

Nhưng vẫn còn nhiều:

```text
model.state.xxx = ...
model.state.xxx.push(...)
record.field = ...
```

## Rủi ro

Một code path có thể:

```text
update state
nhưng quên persist
```

hoặc:

```text
persist
nhưng quên mutation queue
```

hoặc:

```text
mutation queue đúng
nhưng UI cache cũ
```

## Đích

```text
UI
↓
Action/Command
↓
Domain validation
↓
Store
↓
State + Mutation
↓
IndexedDB
↓
Sync
```

Feature module không direct-write state tùy ý.

---

# 10. P1 — Full-table diff trong persistence là nợ kỹ thuật

Nếu mỗi save phải:

1. đọc full table;
2. build map;
3. stringify record;
4. suy ra upsert/delete;

thì chi phí tăng theo dữ liệu.

## Đích

Mutation explicit:

```text
upserts
deletions
```

ngay từ thời điểm action.

`trackDeletions()` chỉ nên là compatibility layer tạm thời.

---

# 11. P1 — WorkspaceDataStore transaction clone toàn table

Nếu sửa một record trong bảng 10.000 dòng mà vẫn clone toàn table:

```text
state
+
snapshot
+
draft
```

thì memory/CPU không tối ưu.

## Đề xuất

Patch/change-set transaction:

```text
affected ids
before
upserts
deletes
```

Rollback chỉ affected records.

---

# 12. P1 — Version snapshot còn phụ thuộc nhiều vào dữ liệu browser đã hydrate

Plan/package versioning hiện có aggregate snapshot phía frontend.

Snapshot package có thể phải clone:

- package;
- lots;
- goods;
- bidder goods;
- opening;
- JV;
- assignment;
- evaluation;
- timeline;
- metadata;
- các child table khác.

## Vấn đề

Correctness phụ thuộc:

```text
browser đã hydrate đủ chưa?
```

Server-side pagination/cold cache/offline làm điều này rủi ro.

## Đích dài hạn

Official version creation nên là backend transaction.

Client gửi:

```text
source id
expected rowVersion
requested changes
```

Server:

```text
BEGIN
lock full aggregate
validate
clone/remap
recalculate latest
audit
COMMIT
```

---

# 13. P1 — BiddingControllerSync có quá nhiều trách nhiệm

Hiện sync module đang gánh nhiều concern:

- push mutations;
- pull data;
- delta;
- conflict;
- WebSocket;
- online/offline;
- route refresh;
- notification refresh;
- dashboard invalidation;
- workspace events;
- sync UI;
- error display.

## Đề xuất tách

```text
SyncCoordinator
SyncPushService
SyncPullService
ConflictResolver
WebSocketSyncClient
WorkspaceEventBridge
SyncPresenter
SyncRenderCoordinator
```

Refactor incremental, không rewrite lớn một lần.

---

# 14. P2 — Runtime prototype injection làm dependency khó trace

Lazy loading là điểm tốt.

Nhưng gắn function runtime lên:

```text
BiddingController.prototype
```

gây:

- dependency ẩn;
- IDE trace kém;
- rename khó;
- dead export khó xác định;
- registry dễ lệch.

## Đích trung hạn

```text
controller.plans
controller.packages
controller.evaluation
controller.contracts
controller.partners
```

Vẫn lazy-load được.

---

# 15. Code chết / code thừa / legacy debt

## Python

Các debt group như:

```text
F401
F841
BLE001
S110
```

cho thấy vẫn còn vùng cần cleanup.

Không được tăng baseline để cho qua CI.

Mỗi sprint nên giảm baseline.

## Frontend

ESLint đã bắt được nhiều lỗi cơ bản, nhưng dynamic export/prototype injection làm dead-code analysis khó.

Nên thêm:

- unused export audit;
- cycle detection;
- duplicate code scan;
- bundle graph.

Không xóa file mù quáng.

---

# 16. CSS/UI technical debt

Vẫn còn:

- inline style;
- `setRuntimeStyle`;
- raw color;
- `!important`.

## Hướng

```text
JS quyết định state
CSS quyết định presentation
```

Ví dụ:

```text
is-hidden
is-disabled
is-loading
is-error
```

Dùng design tokens.

Giảm debt baseline dần.

---

# 17. Encoding/mojibake

Nên scan source tiếng Việt lỗi encoding.

Pattern cần cảnh giác:

```text
Ã
Ä‘
á»
```

Thêm CI guard, loại vendor/dist/binary.

---

# 18. Test coverage

Test breadth hiện khá tốt.

Nhưng critical coverage nên tăng ở:

- sync service;
- WebSocket;
- delta paging;
- lifecycle;
- document routes;
- versioning;
- conflict resolver;
- outbox;
- IndexedDB abort/error.

## Cách làm

Không ép tăng lớn một lần.

Dùng ratchet:

```text
không giảm
+
tăng dần từng sprint
```

---

# 19. Hiệu năng — hướng ưu tiên

## 19.1. Entity indexes / selectors

Nhiều `.find()`/`.filter()` lặp trên array.

Có thể tạo:

```text
byId
byRootId
byPlanId
byPackageId
byOpeningId
byContractorId
byLotId
```

Không duplicate source of truth.

---

## 19.2. Tái sử dụng virtualization hiện có

BiddingFlow đã có utility virtual table ở một số bảng.

Không xây framework mới.

Chỉ:

1. profile;
2. xác định bảng lớn;
3. reuse utility hiện có;
4. benchmark trước/sau.

---

## 19.3. Excel browser parsing

Chỉ cân nhắc Web Worker nếu profiling chứng minh main thread bị block.

Không rewrite chỉ vì lý thuyết.

Đo:

```text
1 MB
5 MB
10 MB
```

---

## 19.4. Notification / WebSocket

Đã có WebSocket + Notification Center + polling.

Tối ưu:

```text
WS healthy → event-driven
WS unavailable → polling fallback
```

Debounce/coalesce event.

---

## 19.5. Obfuscation benchmark

Benchmark:

```text
deadCodeInjection ON
vs
OFF
```

Đo:

- bundle bytes;
- build time;
- cold startup;
- warm startup;
- long tasks.

Không thay thế security thật bằng obfuscation.

---

# 20. UX nền tảng cần cải thiện — KHÔNG phải feature lớn

## 20.1. Chuẩn hóa Save/Sync status

Người dùng phải hiểu rõ:

```text
Đã lưu trên máy chủ
Đã lưu cục bộ, đang chờ đồng bộ
Đang đồng bộ N thay đổi
Offline
Conflict
Validation rejected
```

Trạng thái phải dựa trên state machine thật.

---

## 20.2. Autosave cho draft hiện có

Detailed evaluation đã có draft.

Chỉ bổ sung:

- debounce;
- dirty indicator;
- timestamp;
- stale request cancellation;
- local/server status;
- restore.

Không tạo draft model mới.

---

## 20.3. Validation summary

Giữ inline validation.

Bổ sung summary:

```text
Còn N lỗi cần xử lý
```

Click → scroll/focus field.

---

## 20.4. Sticky context

Bảng dài giữ context:

- package;
- lot;
- contractor;
- round;
- method;
- status.

Tận dụng sticky UI hiện có.

---

# 21. Thứ tự refactor đề xuất

## Phase A — Correctness

1. IndexedDB durability semantics.
2. WorkspaceDataStore/outbox/offline state machine.
3. Canonical evaluation rules.
4. Technical score parser.
5. Metadata codec.
6. Encoding guard.

## Phase B — Architecture

7. State mutation boundary.
8. Explicit mutation persistence.
9. Patch-based transaction.
10. Server-side plan/package version transaction.
11. Sync decomposition.
12. Prototype/service architecture migration.

## Phase C — Technical debt

13. Python unused/debt cleanup.
14. Frontend unused export/cycle audit.
15. CSS/runtime style debt repayment.
16. Coverage ratchet.

## Phase D — Performance & UX nền

17. Entity indexes.
18. Extend existing virtualization where justified.
19. Excel worker only if needed.
20. WebSocket-first notification.
21. Obfuscation benchmark.
22. Save/sync UX.
23. Autosave existing draft.
24. Validation summary.
25. Sticky context.

---

# 22. Guardrails bắt buộc

Không được sửa lỗi bằng cách:

- skip test;
- tăng timeout để che race condition;
- disable validation;
- disable secret scan;
- disable CSP;
- disable Trusted Types;
- bỏ rowVersion;
- force overwrite conflict;
- bỏ outbox;
- xóa historical version;
- phá org isolation;
- phá permission;
- rollback về full reload như cách che lỗi;
- tạo abstraction trùng abstraction hiện có.

---

# 23. Definition of Done

Một phase hoàn thành khi:

- code đúng;
- test đúng;
- lint pass;
- security pass;
- debt gate pass;
- build pass;
- relevant E2E pass;
- performance không regression;
- migration/backward compatibility được kiểm tra;
- progress report được cập nhật.

---

# 24. Kết luận

Trong giai đoạn hiện tại, không nên ưu tiên mở rộng sản phẩm.

Trọng tâm nên là:

```text
Correctness
↓
Consistency
↓
State/Persistence
↓
Versioning
↓
Sync
↓
Debt
↓
Performance
↓
UX nền tảng
```

Sau khi nền tảng ổn định, mới xem tài liệu đề xuất tính năng riêng để chọn feature cần triển khai.
