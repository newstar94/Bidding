# PROMPT CODEX — CHỈ SỬA LỖI, REFACTOR VÀ TỐI ƯU BIDDINGFLOW
## KHÔNG TRIỂN KHAI TÍNH NĂNG MỚI TRONG NHIỆM VỤ NÀY
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

Branch:

```text
main
```

---

# 0. Mục tiêu

Nhiệm vụ này CHỈ gồm:

```text
sửa lỗi
refactor
chuẩn hóa kiến trúc
giảm technical debt
tối ưu hiệu năng
cải thiện UX nền tảng
tăng test/coverage
```

## TUYỆT ĐỐI KHÔNG

Không triển khai:

- Version Diff mới;
- Conflict Center UI mới;
- Compliance Copilot;
- Risk/SLA feature mới;
- Contractor 360;
- Data Quality Center;
- What-if Simulator;
- Word Template version/publish/rollback;
- Approval Workflow mới;
- Calendar integration;
- Bulk Operation Center mới;
- Integration Hub mới;
- hoặc bất kỳ product feature mới nào.

Các ý tưởng đó đã được tách sang tài liệu riêng và sẽ được quyết định sau.

---

# 1. Trước khi sửa

Đọc code mới nhất trên `main`.

Lập dependency map tối thiểu cho:

```text
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
frontend/packages/DetailedEvaluationWorkflow.js
frontend/packages/DetailedEvaluationSaveWorkflow.js
frontend/packages/packageAggregateSnapshot.js

frontend/plans/planAggregateSnapshot.js

backend/sync/service.py
backend/sync/bid_evaluation_rules.py
backend/sync/*
backend/shared/database_io.py

tests/
scripts/
.github/workflows/
```

Tìm toàn repo:

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

---

# 2. Baseline

Trước sửa:

- chạy JS tests;
- chạy Python tests;
- lint;
- security checks;
- debt gate;
- secure build;
- relevant E2E;
- startup performance.

Tạo/update:

```text
docs/refactor/BIDDINGFLOW_REFACTOR_PROGRESS.md
```

Ghi baseline thực tế.

---

# 3. P0 — IndexedDB durability semantics

## Vấn đề

Write method không thống nhất:

```text
request.onsuccess
vs
transaction.oncomplete
```

## Sửa

Mọi write API:

```text
resolve only on transaction.oncomplete
reject on transaction.onerror
reject on transaction.onabort
```

Áp dụng tối thiểu:

```text
set
putRecord
deleteRecord
putTableData
putRecords
deleteRecords
applySyncChanges
```

Không double settle.

## Test bắt buộc

- request success nhưng transaction abort;
- transaction complete;
- transaction error;
- quota error;
- outbox ordering.

---

# 4. P0 — WorkspaceDataStore / Outbox / Offline state machine

Phân loại outcome rõ:

```text
committed
offlineQueued
validationRejected
conflict
persistenceFailed
transportFailed
```

## Network/offline

```text
KEEP state
KEEP IndexedDB
KEEP outbox
```

Không rollback edit chỉ vì transport failure.

## Validation rejected

```text
rollback/recover affected records
reject exact mutation
```

## Conflict

```text
no silent overwrite
```

## Test

- offline;
- reconnect;
- 503;
- transport exception;
- 400 validation;
- 409 conflict;
- reload with pending outbox;
- idempotent retry.

---

# 5. P0 — Canonical Evaluation Domain

Đọc:

```text
evaluationMethodRules.js
technicalEvaluationMethod.js
BiddingCalculations.js
BidEvaluationTablePresentation.js
bidEvaluationActions.js
backend/sync/bid_evaluation_rules.py
```

Không để cùng business rule được định nghĩa khác nhau.

## Hướng

Canonical code:

```text
LOWEST_PRICE
EVALUATED_PRICE
FIXED_PRICE
COMBINED_TECHNICAL_PRICE
TECHNICAL_BASED
```

UI label không phải identifier logic.

Legacy alias phải tương thích.

Ít nhất:

```text
Kết hợp giữa kỹ thuật và giá
Kết hợp kỹ thuật và giá
```

phải cùng semantics.

---

# 6. P0 — One Technical Score Parser

Một parser semantics duy nhất.

Rule:

- trim;
- decimal;
- comma normalization nếu support;
- finite;
- >= 0;
- reject bool;
- reject text;
- reject `Đạt/Không đạt` cho evaluation mới.

Historical compatibility tách riêng.

Frontend/backend/import/ranking phải parity.

---

# 7. P0/P1 — Evaluation Metadata Codec

Không:

```text
catch → {}
→ save {}
```

Tạo authoritative codec:

```text
parseStrict
parseForDisplay
serialize
migrate
```

Test:

- malformed JSON;
- array;
- unknown schema;
- old schema;
- 1G2T;
- oversized metadata.

---

# 8. P1 — State Mutation Boundary

Dùng/mở rộng:

```text
WorkspaceDataStore
MutationService
commitLocalMutation
```

Feature code không direct-write state tùy ý.

Ưu tiên migrate:

```text
evaluation
package
plan
contract
assignment
partner
```

Thêm lint/scanner.

Giảm `direct_state_writes` baseline.

---

# 9. P1 — Explicit Mutation Persistence

Giảm full-table diff.

Mutation phải biết:

```text
upserts
deletions
```

`trackDeletions()` thành compatibility path rồi loại khỏi hot path.

Benchmark:

```text
100
1000
10000
```

records.

---

# 10. P1 — Patch-based Workspace Transaction

Không clone full table nếu chỉ sửa vài record.

Transaction giữ:

```text
affected ids
before
upserts
deletes
```

Rollback đúng affected records.

Không stringify selector lớn nếu không cần.

---

# 11. P1 — Server-side Version Transaction

Không xây version feature mới.

Chỉ chuyển authority của official plan/package version creation về backend.

Server:

```text
BEGIN
lock source aggregate
validate expected rowVersion
load full children
clone/remap
recalculate latest
audit
COMMIT
```

Test:

- cold cache;
- no hydration;
- lot;
- JV;
- bidder goods;
- evaluation;
- assignments;
- concurrent version creation;
- delete latest.

Giữ backward compatibility trong giai đoạn migration.

---

# 12. P1 — Decompose BiddingControllerSync

Tách incremental:

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

Không thay đổi product behavior.

---

# 13. P2 — Giảm runtime prototype injection

Không big-bang rewrite.

Dần chuyển sang feature service:

```text
controller.plans
controller.packages
controller.evaluation
controller.contracts
controller.partners
```

Vẫn lazy-load.

---

# 14. Technical Debt Repayment

## Python

Giảm:

```text
F401
F841
BLE001
S110
```

Không tăng debt limit.

## Frontend

Audit:

- unused exports;
- duplicate code;
- cycles;
- runtime styles;
- direct writes.

---

# 15. CSS/UI Debt

Giảm:

```text
!important
raw colors
inline styles
setRuntimeStyle
```

Dùng:

```text
semantic class
design token
```

Không visual regression.

---

# 16. Mojibake

Sửa source tiếng Việt lỗi encoding.

Thêm CI scanner.

Exclude:

- dist;
- vendor;
- binary;
- generated artifacts nếu cần.

---

# 17. Critical Coverage Ratchet

Tăng dần cho:

- sync;
- WebSocket;
- delta;
- lifecycle;
- document routes;
- versioning;
- conflict;
- outbox;
- BrowserDB.

Không giảm threshold hiện tại.

---

# 18. Performance — Entity Indexes

Tạo/reuse:

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

Benchmark trước/sau.

---

# 19. Performance — Reuse Existing Virtualization

Bắt buộc kiểm tra utility hiện có trước.

Không import framework mới.

Profile:

- goods;
- bidder goods;
- evaluation;
- timeline;
- contractors;
- tables lớn khác.

Chỉ mở rộng nơi có measurable benefit.

---

# 20. Performance — Excel Web Worker chỉ khi cần

Profile browser parsing:

```text
1 MB
5 MB
10 MB
```

Nếu có long task rõ:

- move expensive parse/validate sang Web Worker;
- preserve existing reader/business rules;
- preserve row order;
- cancel stale jobs.

Nếu không có vấn đề, không rewrite.

---

# 21. Notification / WebSocket Optimization

Không tạo notification system mới.

Dùng hệ thống hiện tại:

```text
WebSocket healthy → event-driven
WebSocket unavailable → polling fallback
```

Debounce/coalesce `db_changed`.

---

# 22. Obfuscation Benchmark

A/B:

```text
deadCodeInjection ON
OFF
```

Đo:

- build duration;
- JS bytes;
- compressed bytes;
- cold startup;
- warm startup;
- long task.

Không tắt security controls khác.

---

# 23. UX nền tảng — Save/Sync Status

Chuẩn hóa existing sync UX.

State:

```text
server saved
local saved / pending sync
syncing
offline
conflict
validation rejected
transport error
```

Không fake bằng timeout.

---

# 24. UX nền tảng — Autosave Existing Draft

Detailed evaluation đã có draft.

Chỉ nâng cơ chế:

- debounce;
- dirty state;
- local save time;
- pending server sync;
- stale request cancellation;
- restore.

Không tạo product feature mới.

Không autosave thành completed.

---

# 25. UX nền tảng — Validation Summary

Reuse validators hiện có.

Thêm summary:

```text
N lỗi cần xử lý
```

Click → field.

Giữ inline validation.

---

# 26. UX nền tảng — Sticky Context

Chỉ là cải thiện usability cho bảng dài.

Không tạo workflow mới.

Giữ context:

- package;
- lot;
- contractor;
- round;
- method;
- status.

---

# 27. E2E bắt buộc

Giữ ít nhất:

- auth;
- roles;
- CRUD;
- multi-assignee;
- JV;
- bidder goods;
- low-price;
- offline;
- package pairwise;
- full lifecycle;
- UI quality.

Evaluation matrix:

- 1G1T;
- 1G2T;
- lot;
- no lot;
- consulting;
- goods;
- independent;
- JV;
- combined;
- lowest;
- evaluated;
- technical.

---

# 28. Security invariants

Không phá:

- tenant isolation;
- RBAC;
- ownership;
- CSRF;
- CSP;
- Trusted Types;
- audit;
- document sandbox;
- secrets;
- rowVersion;
- conflict;
- permission scope.

---

# 29. Migration / Backward Compatibility

Giữ:

- legacy method labels;
- legacy technical values;
- metadata;
- IndexedDB;
- outbox;
- versions;
- rootId;
- template config hiện tại;
- workspace storage.

Migration phải idempotent.

---

# 30. Debt Gate

Refactor xong phải giảm baseline thật nếu metric đã giảm.

Không sửa gate để tăng limit.

Frontend:

```text
important
raw_colors
runtime_styles
inferred_actions
direct_state_writes
```

Python:

```text
F401
F841
BLE001
S110
```

---

# 31. Progress Report

Mỗi phase cập nhật:

```text
docs/refactor/BIDDINGFLOW_REFACTOR_PROGRESS.md
```

Ghi:

- vấn đề;
- nguyên nhân;
- file thay đổi;
- tests;
- benchmark;
- debt before/after;
- migration;
- unresolved risk.

---

# 32. Definition of Done

Không báo done chỉ vì compile.

Phải xác minh phù hợp:

```text
lint
unit
integration
E2E
security
secure build
debt gate
performance gate
production package
```

---

# 33. STOP CONDITION

Sau khi hoàn thành các phase sửa lỗi/refactor/tối ưu:

**DỪNG.**

Không tự động tiếp tục implement các product feature mới.

Tạo summary:

```text
Nền tảng đã sẵn sàng cho giai đoạn chọn tính năng mới.
```

Chờ người dùng quyết định feature nào sẽ làm tiếp.
