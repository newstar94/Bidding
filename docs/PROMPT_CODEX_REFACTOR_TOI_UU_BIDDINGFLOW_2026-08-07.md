# PROMPT CHO CODEX — REFACTOR, TỐI ƯU VÀ NÂNG CẤP BIDDINGFLOW TOÀN DIỆN

## Vai trò

Bạn là senior/staff software engineer chịu trách nhiệm refactor một hệ thống procurement/bidding production-grade có:

- frontend JavaScript/Vite;
- backend Starlette/Python;
- PostgreSQL;
- IndexedDB;
- offline mutation outbox;
- delta sync;
- WebSocket;
- multi-user;
- multi-organization;
- multi-role/RBAC;
- kế hoạch/gói thầu/versioning;
- mở thầu;
- phân lô;
- liên danh;
- đánh giá HSDT;
- hợp đồng;
- Excel/Word;
- document worker;
- AI assistant;
- CI/E2E/security/performance gates.

Repository:

```text
newstar94/Bidding
```

Làm việc trên **code mới nhất của nhánh `main`**.

---

# 1. Yêu cầu quan trọng nhất

KHÔNG được sửa theo kiểu đối phó.

KHÔNG:

- skip test;
- disable E2E;
- tăng timeout để che race condition;
- tắt validation;
- tắt secret scanner;
- tắt CSP/Trusted Types;
- bỏ rowVersion;
- bỏ conflict detection;
- force overwrite dữ liệu server;
- bỏ mutation outbox;
- xóa historical version;
- phá multi-org/multi-role;
- thay đổi nghiệp vụ ngoài phạm vi;
- rewrite toàn hệ thống trong một lần.

Phải:

```text
inspect
→ characterize
→ test
→ refactor incrementally
→ verify
```

Mọi thay đổi phải có test thích hợp.

---

# 2. Trước khi sửa code

Hãy nghiên cứu thật kỹ code mới nhất.

Bắt buộc đọc và lập dependency map tối thiểu cho:

```text
frontend/app/BiddingModel.js
frontend/app/BrowserDB.js
frontend/app/WorkspaceDataStore.js
frontend/app/WorkspaceMutationOutbox.js
frontend/app/WorkspaceMutationOutboxStore.js
frontend/app/BiddingControllerSync.js
frontend/app/BiddingController.js
frontend/app/WorkflowModuleLoader.js
frontend/app/moduleRegistry.js

frontend/shared/MutationService.js
frontend/shared/BiddingCalculations.js
frontend/shared/apiClient.js

frontend/packages/evaluationMethodRules.js
frontend/packages/technicalEvaluationMethod.js
frontend/packages/evaluationMetadata.js
frontend/packages/bidEvaluationActions.js
frontend/packages/BidEvaluationPanelController.js
frontend/packages/BidEvaluationTablePresentation.js
frontend/packages/packageAggregateSnapshot.js

frontend/plans/planAggregateSnapshot.js

backend/sync/service.py
backend/sync/bid_evaluation_rules.py
backend/sync/*
backend/shared/database_io.py

tests/
scripts/
.github/workflows/
vite.config.js
eslint.config.js
```

Đồng thời tìm tất cả:

```text
model.state
persistData(
commitLocalMutation(
parseTechnicalScore
requiresTechnicalScore
phuongPhapDanhGia
danhGiaHsdtMetadata
snapshotPackageAggregate
snapshotPlanAggregate
setRuntimeStyle
JSON.stringify(
```

Không được giả định chỉ những file liệt kê trên mới liên quan.

---

# 3. Mục tiêu kiến trúc

Sau refactor, luồng mutation nên tiến về:

```text
UI
↓
Feature command/action
↓
Domain validation
↓
Workspace Store
↓
State change + Mutation Outbox
↓
IndexedDB durability
↓
Server Sync
↓
Server authority / conflict handling
↓
UI commit status
```

Không để mỗi feature tự quyết định cách:

- sửa state;
- persist;
- sync;
- rollback.

---

# 4. PHASE 0 — Characterization và baseline

Trước khi sửa P0:

1. Chạy toàn bộ test hiện tại.
2. Ghi nhận:
   - Python tests;
   - JS tests;
   - E2E;
   - lint;
   - debt gate;
   - secure build;
   - startup performance.
3. Không sửa test để làm xanh một bug thực tế.
4. Tạo characterization tests cho các semantics đang phụ thuộc.

Nếu CI đang có lỗi không liên quan đến thay đổi, ghi rõ.

---

# 5. PHASE 1 — P0: Chuẩn hóa IndexedDB durability

## Vấn đề

`BrowserDB` hiện có write method resolve tại các thời điểm khác nhau.

Một số method dùng:

```text
request.onsuccess
```

một số dùng:

```text
transaction.oncomplete
```

Điều này làm abstraction không có durability contract thống nhất.

## Yêu cầu sửa

Tất cả write API phải:

```text
resolve only on transaction.oncomplete
reject on transaction.onerror
reject on transaction.onabort
```

Áp dụng tối thiểu cho:

```text
set
putRecord
deleteRecord
putTableData
putRecords
deleteRecords
applySyncChanges
```

Không double resolve/reject.

## Test bắt buộc

Tạo test cho:

- request success nhưng transaction abort;
- transaction complete;
- transaction error;
- quota error;
- version/migration blocked nếu mock phù hợp;
- write ordering của outbox.

## Acceptance

```text
await BrowserDB.write(...)
```

phải có nghĩa:

> transaction đã commit durable hoặc đã reject.

---

# 6. PHASE 2 — P0: Sửa consistency WorkspaceDataStore ↔ Outbox ↔ Offline

## Vấn đề

Không được có trạng thái:

```text
UI rollback
IndexedDB rollback
Outbox vẫn chứa mutation
```

mà người dùng không biết.

## Xây dựng state machine rõ ràng

Phân loại outcome:

### A. committed

Server đã commit.

```text
state giữ thay đổi
outbox ack
status = committed
```

### B. offlineQueued / network unavailable

```text
state GIỮ thay đổi
IndexedDB GIỮ thay đổi
outbox GIỮ mutation
status = offlineQueued
```

Không rollback local edit.

### C. validation rejected

```text
rollback/recover đúng affected records
remove đúng rejected mutation
show validation
```

### D. rowVersion conflict

```text
không silently overwrite
conflict resolution
```

### E. unexpected persistence failure trước durable local commit

```text
rollback
không tạo ghost outbox
```

## Yêu cầu

Refactor `WorkspaceDataStore.transaction()` và `persistAndSync()` nếu cần.

Không dùng:

```text
syncResult.ok === false
```

cho mọi loại failure như cùng một semantics.

Tạo explicit result:

```js
{
  status:
    "committed"
    | "offlineQueued"
    | "validationRejected"
    | "conflict"
    | "persistenceFailed"
    | "transportFailed"
}
```

hoặc tương đương rõ ràng.

## Test bắt buộc

- offline edit;
- transport exception;
- 503;
- validation 400;
- conflict 409;
- successful retry;
- outbox hydration sau reload;
- state sau reconnect;
- idempotent retry;
- mutation phát sinh trong lúc request cũ đang chạy.

---

# 7. PHASE 3 — P0: Hợp nhất Business Rule Registry

## Mục tiêu

Không còn nhiều module tự nhận diện cùng một business rule.

Đặc biệt:

```text
Kết hợp giữa kỹ thuật và giá
Kết hợp kỹ thuật và giá
```

phải là cùng một canonical method.

## Frontend

Tạo một canonical domain module, ví dụ:

```text
frontend/packages/evaluationDomain.js
```

hoặc cấu trúc phù hợp với repo.

Nó phải là nguồn sự thật cho:

```text
evaluation method codes
legacy aliases
normalize method
isCombined
requiresTechnicalScore
parseTechnicalScore
validateTechnicalScore
display labels
```

Không để:

```text
evaluationMethodRules.js
technicalEvaluationMethod.js
BiddingCalculations.js
BidEvaluationTablePresentation.js
bidEvaluationActions.js
```

mỗi file tự diễn giải khác nhau.

## Canonical enum

Persist/logical code:

```text
LOWEST_PRICE
EVALUATED_PRICE
FIXED_PRICE
COMBINED_TECHNICAL_PRICE
TECHNICAL_BASED
```

Nếu chưa thể migration DB ngay, tạo canonical runtime layer nhưng phải có roadmap/migration.

## Legacy compatibility

Nhận ít nhất:

```text
Kết hợp giữa kỹ thuật và giá
Kết hợp kỹ thuật và giá
```

và các label cũ hiện có.

Không làm mất dữ liệu lịch sử.

## Backend

Tạo canonical equivalent.

Không chỉ:

```python
method == "Kết hợp giữa kỹ thuật và giá"
```

Phải normalize alias hoặc canonical code.

## Cross-layer contract tests

Cùng một fixture method phải cho kết quả giống nhau:

```text
frontend recognizes combined
backend recognizes combined
technical score required
ranking uses combined formula
UI shows combined score
import validates combined
```

---

# 8. PHASE 4 — P0: Một technical score parser duy nhất

Không giữ nhiều implementation khác nhau.

Rule yêu cầu:

- trim;
- cho phép decimal;
- hỗ trợ dấu phẩy nếu nghiệp vụ hiện cho phép;
- không NaN;
- không Infinity;
- không âm;
- reject `Đạt`;
- reject `Không đạt`;
- backward compatibility chỉ dành cho historical snapshot đã được xác minh, không dùng cho đánh giá mới.

Phải dùng chung trong:

- UI;
- validation;
- ranking;
- Excel import;
- backend sync validation;
- snapshot compatibility;
- detailed evaluation projection.

---

# 9. PHASE 5 — P0/P1: Hợp nhất Evaluation Metadata Codec

## Vấn đề

Không để module A throw metadata lỗi nhưng module B silent `{}`.

## Tạo API rõ ràng

Ví dụ:

```text
parseEvaluationMetadataStrict
parseEvaluationMetadataForDisplay
serializeEvaluationMetadata
migrateEvaluationMetadata
```

## Quy tắc

Save path:

```text
strict
```

Read-only display:

```text
safe + report invalid metadata
```

Không:

```text
catch → {}
→ save {}
```

làm mất metadata cũ.

## Test

- malformed JSON;
- array thay object;
- unknown schemaVersion;
- size > limit;
- migration old schema;
- round technical/financial;
- 1G2T metadata.

---

# 10. PHASE 6 — P1: Tạo State Mutation Boundary

## Mục tiêu

Feature code không direct-write `model.state` tùy ý.

## API mục tiêu

```text
WorkspaceStore.query
WorkspaceStore.upsert
WorkspaceStore.delete
WorkspaceStore.patch
WorkspaceStore.transaction
WorkspaceStore.subscribe
```

Có thể tái sử dụng `WorkspaceDataStore`.

## Migration incremental

Không rewrite một lượt.

Ưu tiên migrate:

1. evaluation;
2. package;
3. plan;
4. contracts;
5. assignments;
6. partners.

## Enforcement

Thêm scanner/ESLint rule:

```text
model.state.* =
model.state.*.push
...
```

Allowlist chỉ cho:

- store internals;
- sync merge/hydration;
- reviewed compatibility layer.

## Debt ratchet

Giảm baseline `direct_state_writes` sau mỗi phase.

Không chỉ giữ nguyên baseline.

---

# 11. PHASE 7 — P1: Loại full-table diff khỏi hot path

## Vấn đề

`trackDeletions()` đọc toàn bảng và stringify record.

## Đích

Mutation luôn biết:

```text
upserts
deletes
```

ngay khi user action xảy ra.

## Yêu cầu

- migrate caller sang explicit mutation;
- chỉ giữ `trackDeletions` compatibility tạm thời;
- log/dev assertion nếu feature mới dùng implicit full-table diff;
- cuối cùng loại khỏi hot path.

## Benchmark

Tạo test/benchmark với:

```text
100
1,000
10,000
```

records.

Đo:

- CPU;
- IndexedDB ops;
- serialized bytes;
- mutation queue size.

---

# 12. PHASE 8 — P1: Patch-based Workspace transaction

Không clone toàn bộ table nếu chỉ sửa 1–2 record.

## Thiết kế

Transaction giữ:

```text
affected IDs
before affected records
upserts
deletes
```

Rollback chỉ affected records.

## Subscription

Không dùng `JSON.stringify` toàn selector lớn nếu tránh được.

Có thể dùng:

- revision;
- immutable reference;
- shallow compare;
- selector version.

## Test

- multi-table;
- rollback;
- offline;
- conflict;
- 10k-record table;
- no unrelated records cloned nếu có thể instrument.

---

# 13. PHASE 9 — P1: Đưa version/snapshot plan/package về backend transaction

Đây là phase lớn, làm sau P0.

## API đề xuất

```text
POST /api/plans/{id}/versions
POST /api/packages/{id}/versions
```

Hoặc thiết kế REST/command phù hợp.

## Server phải tự load full aggregate

Không tin browser đã hydrate đủ.

Clone:

- package;
- goods;
- lots;
- openings;
- JV members;
- bidder goods;
- assignments;
- evaluation metadata;
- detailed evaluation;
- timeline;
- E-HSMT adjustments;
- các child owned khác.

## Invariant

- rootId ổn định;
- version monotonic;
- một latest đúng scope;
- history không mất;
- plan/package scope đúng;
- assignment được kế thừa;
- child relationship remap đúng;
- rebid relationship đúng;
- no cross-org;
- rowVersion correct;
- audit created.

## Transaction

```text
BEGIN
SELECT ... FOR UPDATE
validate expected version
clone
recalculate latest
COMMIT
```

Một child lỗi → rollback toàn bộ.

## Migration

Không xóa client snapshot ngay.

Giai đoạn đầu:

```text
server path primary
client path behind compatibility fallback/dev assertion
```

Sau khi full test mới loại client authority.

## Test bắt buộc

- cold cache;
- no local aggregate;
- multi-version;
- delete latest;
- plan version inheritance;
- lot package;
- JV;
- 1G2T;
- evaluation metadata;
- goods;
- assignments;
- concurrent version creation.

---

# 14. PHASE 10 — P1/P2: Tách BiddingControllerSync

Refactor theo trách nhiệm.

Đề xuất module:

```text
SyncCoordinator
SyncPushService
SyncPullService
ConflictResolver
WebSocketSyncClient
WorkspaceEventBridge
SyncStatusPresenter
SyncRenderCoordinator
```

Không cần đúng tên nếu kiến trúc tương đương.

## Không thay đổi behavior

Phải giữ:

- WebSocket reconnect;
- route sync;
- storage event;
- BroadcastChannel;
- background sync;
- notification refresh;
- dashboard invalidation;
- stale workspace guard.

---

# 15. PHASE 11 — P2: Giảm dynamic prototype injection

Không rewrite ngay.

## Mục tiêu

Dần có:

```text
controller.plans
controller.packages
controller.evaluation
controller.contracts
controller.partners
```

Lazy-load service object.

## Lợi ích bắt buộc đạt

- IDE trace tốt hơn;
- dependency explicit;
- ít wildcard export;
- dễ test;
- dễ detect dead export;
- không collision prototype.

## Compatibility

Old controller methods có thể delegate sang service trong transition.

---

# 16. PHASE 12 — P1/P2: Cleanup code chết / legacy debt

## Python

Dùng Ruff report thật.

Ưu tiên:

```text
F401
F841
BLE001
S110
```

Không xóa blind.

Mỗi cleanup phải xác minh import/function không được dynamic-load.

Giảm `DEBT_LIMITS` sau khi sửa.

## Frontend

Thêm hoặc chạy tool để tìm:

- unused exports;
- circular dependencies;
- duplicate modules;
- unreachable branch;
- wildcard export không cần thiết.

Dynamic workflow architecture phải được tính đến để tránh false positive.

---

# 17. PHASE 13 — P2: CSS/UI debt repayment

Giảm:

```text
!important
raw colors
setRuntimeStyle
```

## Hướng refactor

Thay:

```js
setRuntimeStyle(node, "display", "none")
```

bằng:

```js
node.classList.add("is-hidden")
```

CSS:

```css
.is-hidden { ... }
```

Dùng design tokens.

## Không thay đổi UI ngoài ý muốn

Phải có:

- UI E2E;
- screenshot nếu test infra cho phép;
- accessibility test.

Giảm frontend debt baseline sau mỗi batch.

---

# 18. PHASE 14 — P1: Fix encoding/mojibake

Sửa tất cả chuỗi source bị mojibake kiểu:

```text
CÃ³
Ä‘
á»...
```

Thêm script CI detect pattern tiếng Việt bị encoding sai.

Không scan vendor/dist.

---

# 19. PHASE 15 — Test coverage ratchet

Không chỉ dựa vào overall 28%.

Tăng dần critical coverage cho:

```text
backend/sync/service.py
backend/sync/websocket.py
backend/shared/audit_monitor.py
backend/lot_lifecycle_routes.py
backend/documents/package_document_routes.py
backend/sync/delta_paging.py
```

Thêm module mới:

```text
versioning service
conflict resolver
outbox semantics
```

Không giảm threshold hiện tại.

---

# 20. PHASE 16 — Performance: normalized indexes

Tạo selector/index layer cho các truy vấn lặp:

```text
byId
byRootId
byPlanId
byPackageId
byOpeningId
byLotId
byContractorId
```

Không duplicate source of truth.

Index phải được invalidated/update khi mutation.

Benchmark trước/sau.

---

# 21. PHASE 17 — Performance: table virtualization

Profiling các bảng:

- package goods;
- bidder goods;
- contractor list;
- evaluation;
- timeline.

Nếu row lớn, implement virtualization/windowing.

Yêu cầu:

- keyboard accessibility;
- focus không mất;
- selection không mất;
- sticky header;
- screen reader fallback phù hợp.

---

# 22. PHASE 18 — Excel processing / Web Worker

Loading UX hiện có là tốt nhưng không đủ nếu main thread bị block.

Profile workbook:

```text
1 MB
5 MB
10 MB
```

Nếu parse/validate gây long task:

```text
Web Worker
```

Phải giữ:

- existing validation;
- same preview;
- same row ordering;
- same business mapping;
- cancel stale import;
- import loading stages.

Không chuyển worker chỉ vì “nghe nhanh hơn”; phải dựa trên profiling.

---

# 23. PHASE 19 — Notification WebSocket-first

Nếu WebSocket authenticated/healthy:

```text
event-driven refresh
```

Polling chỉ fallback khi:

- socket disconnected;
- page resumed;
- periodic safety refresh với cadence hợp lý.

Không để mỗi `db_changed` gây request storm.

Debounce/coalesce event.

---

# 24. PHASE 20 — Obfuscation benchmark

Đừng loại bảo mật khác.

A/B:

```text
deadCodeInjection ON
deadCodeInjection OFF
```

Đo:

- output bytes;
- gzip/brotli nếu có;
- secure build duration;
- cold startup p95;
- warm startup p95;
- long tasks.

Nếu chi phí đáng kể, đề xuất cấu hình tối ưu.

Không coi obfuscation là authorization/security boundary.

---

# 25. PHASE 21 — UX: Save / Sync State

Xây một component trạng thái rõ ràng:

```text
Đã lưu trên máy chủ
Đang đồng bộ N thay đổi
Offline · N thay đổi chờ gửi
Có N xung đột
Đồng bộ thất bại
```

Phải dựa trên state machine thật, không suy đoán bằng timeout.

---

# 26. PHASE 22 — UX: Autosave Draft

Cho form dài:

- evaluation;
- reports;
- package setup;
- contract;
- result.

Hiển thị:

```text
Bản nháp đã lưu cục bộ lúc HH:mm
```

Phân biệt:

```text
draft
completed/final
```

Final action vẫn phải validate đầy đủ.

Draft không được biến thành official state.

---

# 27. PHASE 23 — UX: Validation Summary

Tạo summary:

```text
Còn N nội dung cần hoàn thành
```

Mỗi item:

- entity;
- lot;
- field;
- message.

Click:

```text
scrollIntoView
focus
```

Giữ inline field highlight.

Không bắt mọi validation bằng popup.

---

# 28. PHASE 24 — UX: Sticky Context

Evaluation/table dài phải luôn giữ được context:

- package;
- lot;
- contractor;
- round;
- method;
- status.

Responsive trên màn hình nhỏ.

---

# 29. PHASE 25 — Feature: Version Diff + Change Impact Analysis

Ưu tiên sản phẩm số 1 sau nền tảng.

## Version Diff

So sánh:

```text
plan version
package version
```

Field diff:

```text
before
after
```

Collection diff:

```text
added
removed
modified
```

## Impact

Xác định object phụ thuộc:

- timeline;
- deadline;
- assignment;
- document;
- evaluation;
- contract;
- notification.

Không tự động sửa dữ liệu official nếu không có rule chắc chắn.

---

# 30. PHASE 26 — Feature: Conflict Resolution Center

Xây UI conflict.

Hiển thị từng field:

```text
Local
Server
```

Action:

```text
Use server
Keep mine
Per-field merge
```

Phải kiểm tra permission.

Merge phải sinh mutation mới dựa trên latest server rowVersion.

Không bypass concurrency.

---

# 31. PHASE 27 — Feature: Procurement Compliance Copilot

AI phải permission-aware.

Không cho AI đọc dữ liệu user không có quyền.

## Kiến trúc

```text
User query / current workflow
↓
Permission-filtered facts
↓
Rule engine results
↓
AI explanation
```

Rule engine là deterministic.

AI:

- giải thích;
- tổng hợp;
- đề xuất.

AI không tự quyết định record hợp lệ nếu backend rule nói không.

## Ví dụ

- combined method nhưng technical score chưa numeric;
- deadline contradiction;
- missing assignment;
- stale document after version change;
- missing evaluation field;
- data inconsistency.

---

# 32. PHASE 28 — Feature: Risk / Deadline Radar

Tạo central risk service.

Risk:

- overdue;
- due soon;
- blocked;
- missing prerequisite;
- contract expiry;
- assignment overdue.

Dashboard có severity.

Không spam notification.

---

# 33. PHASE 29 — Feature: Contractor 360

Trang tổng hợp contractor:

- bid count;
- win count;
- loss count;
- contract value;
- active contracts;
- JV history;
- pricing history;
- clarification;
- low-price event;
- completion history.

Luôn organization-scoped.

---

# 34. PHASE 30 — Feature: Data Quality Center

Scanner phát hiện:

- duplicate;
- orphan;
- broken root/latest;
- invalid metadata;
- legacy alias;
- missing rowVersion;
- child mismatch;
- assignment anomalies.

Có:

```text
Detected
Reviewed
Fixed
Ignored with reason
```

Automatic fix chỉ cho case deterministic và audit được.

---

# 35. PHASE 31 — Feature: What-if Evaluation Simulator

Simulation không sửa official data.

Cho thay:

- technical weight;
- financial weight;
- relevant scenario params.

Hiển thị:

```text
SIMULATION
NOT OFFICIAL RESULT
```

Ranking official không bị overwrite.

---

# 36. PHASE 32 — Feature: Template Designer

Hỗ trợ:

- upload;
- placeholder mapping;
- preview;
- version;
- publish;
- rollback;
- validation.

Document worker isolation vẫn giữ nguyên.

Không cho template arbitrary code execution.

---

# 37. PHASE 33 — Feature: Multi-level Approval Workflow

Workflow configurable:

```text
draft
review
approval
signature
final
```

Có:

- permission;
- immutable audit;
- reject reason;
- delegated approval nếu nghiệp vụ cho phép;
- SLA.

Không cho người tạo tự approve nếu policy cấm.

---

# 38. PHASE 34 — Feature: Calendar/SLA

Tạo:

- ICS export;
- connector-ready abstraction cho Google/Outlook.

Event:

- publish;
- bid close;
- bid open;
- evaluation;
- approval;
- contract milestone;
- expiry.

Không expose confidential title/data ra external calendar nếu user không chọn.

---

# 39. PHASE 35 — Feature: Bulk Operations

Cho:

- assign;
- reassign;
- export;
- archive;
- status operation nếu hợp lệ.

Luôn có:

```text
preview affected records
permission check
validation
confirmation
audit
```

Không bulk force-update invalid workflow transitions.

---

# 40. PHASE 36 — Feature: Integration Hub

Thiết kế connector boundary:

```text
source
mapping
validation
idempotency
retry
dead letter
audit
observability
```

Hướng tới:

- muasamcong/e-GP;
- ERP;
- accounting;
- DMS;
- HR;
- digital signature;
- email/SMS;
- BI.

Không hard-code connector logic vào domain core.

---

# 41. Bắt buộc nâng Debt Gate thành Debt Repayment Gate

Hiện gate chủ yếu ngăn debt tăng.

Mỗi phase hoàn thành phải:

- đo baseline mới;
- hạ baseline nếu metric đã giảm;
- commit baseline mới.

Metric:

```text
important
raw_colors
runtime_styles
inferred_actions
direct_state_writes
```

Python:

```text
BLE001
F401
F841
S110
```

Không được sửa script để tăng limit cho qua CI.

---

# 42. E2E bắt buộc giữ

Ít nhất phải chạy:

```text
auth shell
role E2E
bidder goods
CRUD modules
multi-assignee
joint venture
low-price conflict
offline sync
package pairwise
full lifecycle
UI quality
```

Nếu thay evaluation:

- 1G1T;
- 1G2T;
- lot;
- no-lot;
- consulting;
- goods;
- JV;
- independent;
- combined technical/price;
- lowest price;
- evaluated price;
- technical based.

---

# 43. Test mới bắt buộc cho P0

## IndexedDB

```text
request success + transaction abort
```

## Outbox

```text
network failure
→ state retained
→ outbox retained
```

## Validation

```text
server rejects record
→ rejected mutation removed
→ server record restored
```

## Conflict

```text
rowVersion conflict
→ no silent overwrite
```

## Legacy evaluation alias

```text
"Kết hợp kỹ thuật và giá"
"Kết hợp giữa kỹ thuật và giá"
```

phải cùng semantics.

## Metadata

Malformed metadata không bị silent overwrite.

---

# 44. Performance regression gate

Không được làm xấu hiện tại.

Theo dõi ít nhất:

```text
cold startup p95
warm startup p95
longest task
startup API request p95
startup transfer bytes
```

Sau refactor lớn, thêm benchmark:

```text
10k goods mutation
10k bidder goods render
evaluation 100 bidders
sync 1000 mutations
```

---

# 45. Security invariants

Không được phá:

- tenant organization isolation;
- ownership checks;
- manager-only sensitive assets;
- CSRF;
- same-origin auth;
- CSP;
- Trusted Types;
- no eval;
- audit log;
- secret handling;
- document sandbox;
- dependency audit;
- SBOM.

AI feature phải dùng permission-filtered data.

---

# 46. Migration/backward compatibility

Phải giữ dữ liệu cũ.

Đặc biệt:

- package version;
- plan version;
- rootId;
- legacy method label;
- legacy technical result;
- metadata schema;
- old IndexedDB;
- old outbox;
- old workspace storage.

Nếu cần schema migration:

- idempotent;
- forward-only;
- backup-aware;
- tests fresh install;
- tests upgrade existing DB.

---

# 47. Commit strategy

Không dồn tất cả vào một commit.

Đề xuất:

```text
test(...)
fix(indexeddb)...
fix(sync)...
refactor(evaluation)...
refactor(metadata)...
refactor(state)...
perf(...)
refactor(versioning)...
refactor(sync)...
refactor(ui)...
feat(version-diff)...
feat(conflict-center)...
...
```

Mỗi commit phải build/test độc lập nếu khả thi.

---

# 48. Báo cáo sau mỗi phase

Codex phải tạo/update một file:

```text
docs/refactor/BIDDINGFLOW_REFACTOR_PROGRESS.md
```

Ghi:

- đã làm;
- file thay đổi;
- test thêm;
- test chạy;
- metric trước/sau;
- debt giảm;
- issue còn lại;
- migration concern.

Không báo “done” nếu test chưa chạy.

---

# 49. Definition of Done

Không được coi task hoàn thành chỉ vì code compile.

Hoàn thành khi:

```text
lint pass
unit pass
integration pass
E2E pass
secure build pass
debt gate pass
performance gate pass
production package check pass
```

Với thay đổi database/versioning phải có migration tests.

---

# 50. Thứ tự bắt buộc

Thực hiện theo thứ tự:

```text
P0 Correctness
↓
State/Persistence architecture
↓
Server-side versioning
↓
Sync decomposition
↓
Debt cleanup
↓
Performance
↓
UX
↓
New features
```

Không implement nhiều feature mới trước khi P0 ổn định.

---

# 51. Những vấn đề tuyệt đối không được bỏ sót

Checklist cuối cùng phải có toàn bộ:

- [ ] IndexedDB request success vs transaction complete.
- [ ] WorkspaceDataStore/outbox rollback inconsistency.
- [ ] Offline semantics.
- [ ] Evaluation method duplication.
- [ ] Canonical business code.
- [ ] Technical score parser duplication.
- [ ] Frontend/backend alias consistency.
- [ ] Evaluation metadata parser duplication.
- [ ] Direct state writes.
- [ ] Full-table `trackDeletions`.
- [ ] Full-table WorkspaceDataStore clone.
- [ ] Client-side aggregate snapshot dependency on hydration.
- [ ] Server-side transactional versioning.
- [ ] Oversized `BiddingControllerSync`.
- [ ] Dynamic prototype injection.
- [ ] Python unused/legacy debt.
- [ ] Frontend dead export analysis.
- [ ] CSS `!important`.
- [ ] raw colors.
- [ ] runtime styles.
- [ ] mojibake.
- [ ] low critical coverage.
- [ ] normalized entity indexes.
- [ ] virtualization.
- [ ] Excel Web Worker profiling.
- [ ] WebSocket-first notification.
- [ ] obfuscation benchmark.
- [ ] save/sync UX.
- [ ] autosave draft.
- [ ] validation summary.
- [ ] sticky context.
- [ ] version diff.
- [ ] safe undo.
- [ ] Version Diff + Impact Analysis.
- [ ] Conflict Resolution Center.
- [ ] Compliance Copilot.
- [ ] Risk/Deadline Radar.
- [ ] Contractor 360.
- [ ] Data Quality Center.
- [ ] What-if Simulator.
- [ ] Template Designer.
- [ ] Approval Workflow.
- [ ] Calendar/SLA.
- [ ] Bulk Operations.
- [ ] Integration Hub.
- [ ] debt gate phải giảm baseline, không chỉ giữ.
- [ ] multi-org/multi-role security.
- [ ] E2E đầy đủ.
- [ ] performance regression gate.

---

# 52. Kết quả cuối cùng mong muốn

BiddingFlow sau roadmap này phải đạt:

### Correctness

- transaction semantics rõ;
- state/outbox nhất quán;
- business rule nhất quán frontend/backend;
- versioning atomic.

### Maintainability

- ít duplicate rule;
- ít direct state write;
- feature boundary rõ;
- sync logic tách module;
- dead debt giảm.

### Performance

- không regression startup;
- mutation lớn nhanh hơn;
- table lớn mượt hơn;
- Excel lớn không freeze UI nếu cần Worker.

### UX

Người dùng luôn hiểu:

```text
đã lưu chưa
đang sync không
offline không
còn lỗi gì
có conflict gì
version thay đổi gì
```

### Product

Có nền tảng để phát triển:

```text
Version Intelligence
Conflict Intelligence
Compliance Intelligence
Risk Intelligence
Contractor Intelligence
```

---

# 53. Chỉ dẫn cuối cùng cho Codex

Hãy bắt đầu bằng việc **nghiên cứu code mới nhất**, không sửa ngay dựa trên prompt này một cách máy móc.

Nếu code hiện tại đã giải quyết một phần vấn đề:

- xác minh bằng test;
- ghi rõ đã giải quyết;
- không viết lại vô ích.

Nếu phát hiện thiết kế tốt hơn nhưng cùng mục tiêu:

- có thể dùng;
- phải giải thích;
- phải giữ các invariant.

Nếu phát hiện vấn đề mới trong quá trình refactor:

- thêm vào progress report;
- viết test;
- xử lý theo mức độ ưu tiên.

Mục tiêu là:

> **làm BiddingFlow đúng hơn, nhất quán hơn, nhanh hơn và dễ phát triển hơn — không phải chỉ làm code “đẹp hơn”.**
