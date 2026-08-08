# PROMPT CODEX — CLEANUP VÒNG 2 BIDDINGFLOW
## SỬA LỖI CÒN LẠI, GIẢM LEGACY PATH, GIẢM TECHNICAL DEBT VÀ TĂNG ĐỘ TIN CẬY

Repository:

```text
newstar94/Bidding
```

Nhánh mục tiêu:

```text
main
```

Head được rà soát khi lập prompt:

```text
9513842cb27af3f474edda36d01818a75403469b
feat: implement package inheritance tracking and related tests
```

> **QUAN TRỌNG:** trước khi sửa, phải fetch/rebase với `main` mới nhất. SHA trên chỉ là mốc audit, không được giả định vẫn là HEAD khi Codex bắt đầu làm.

---

# 0. PHẠM VI NHIỆM VỤ

Đây là **cleanup/refactor vòng 2** sau khi đợt refactor lớn trước đã xử lý phần lớn P0/P1.

Nhiệm vụ này chỉ gồm:

```text
correctness còn sót
legacy persistence cleanup
state mutation cleanup
service architecture migration
technical debt repayment
critical coverage
performance safety
observability
```

## KHÔNG TRIỂN KHAI PRODUCT FEATURE MỚI

Không làm:

- Version Diff UI;
- Conflict Resolution Center mới;
- Compliance Copilot;
- Risk/SLA product feature mới;
- Contractor 360;
- Data Quality Center UI;
- What-if Simulator;
- Template Designer feature mới;
- Approval Workflow mới;
- Calendar integration;
- Bulk Operation Center mới;
- Integration Hub mới.

Không biến cleanup này thành một dự án feature.

---

# 1. NHỮNG THỨ ĐÃ ĐƯỢC KHẮC PHỤC — KHÔNG LÀM LẠI

Phải bảo toàn các cải tiến hiện có:

- IndexedDB write chỉ resolve khi transaction complete.
- `transaction.onerror/onabort` đã được xử lý.
- Workspace/outbox/offline state machine đã phân biệt:
  - `committed`
  - `offlineQueued`
  - `validationRejected`
  - `conflict`
  - `persistenceFailed`
  - `transportFailed`
- Offline/transport failure giữ local state + IndexedDB + outbox.
- Canonical evaluation domain đã có.
- Technical score parser đã được gom.
- Evaluation metadata codec đã có strict/display/migrate semantics.
- Mojibake scanner đã có.
- Official plan/package version creation đã chuyển sang backend transaction.
- Server version snapshot đã load aggregate từ DB, không phụ thuộc browser hydration.
- Tổ chuyên gia/Tổ thẩm định đã được hydrate trong version repository.
- `BiddingControllerSync` đã được tách thành các service.
- Entity indexes đã có.
- Excel Web Worker đã có cho file lớn.
- WebSocket-first + polling fallback đã có.
- Save/sync state UX đã có.
- Detailed evaluation autosave draft đã có.
- Validation summary và sticky context đã có.
- `FeatureServices.js` đã tồn tại.

**CẤM viết lại các phần này từ đầu.**

---

# 2. BASELINE HIỆN TẠI

Theo đợt refactor gần nhất:

```text
Python tests:      615/615 pass
JavaScript tests:  475/475 pass
Critical modules:  15 module có coverage ratchet
```

Performance gần nhất:

```text
Cold p95:     365 ms / limit 800 ms
Warm p95:     130 ms / limit 325 ms
Longest task: 71 ms  / limit 100 ms
```

Debt gần nhất:

| Metric | Hiện tại gần nhất |
|---|---:|
| `direct_state_writes` | 85 |
| `important` | 421 |
| `raw_colors` | 842 |
| `runtime_styles` | 541 |
| Python `BLE001` | 147 |
| Python `F401` | 0 |
| Python `F841` | 0 |
| Python `S110` | 14 |
| Python `S608` | 129 |

**Không tin tuyệt đối các số này.**
Codex phải chạy scanner/gate trên HEAD mới nhất và ghi số thực tế trước khi sửa.

---

# 3. PHASE 0 — INVENTORY TRƯỚC KHI SỬA

Tạo/update:

```text
docs/refactor/BIDDINGFLOW_CLEANUP_ROUND_2.md
```

Ghi:

- HEAD SHA;
- test baseline;
- debt baseline;
- performance baseline;
- E2E baseline;
- danh sách legacy persistence callers;
- danh sách direct state writes;
- danh sách prototype/service callers;
- danh sách broad exceptions Python;
- danh sách S110;
- phân loại S608;
- danh sách CSS debt ở các file sẽ chạm.

Tìm toàn repo:

```text
persistData(
trackDeletions(
markTableDirty(
commitLocalMutation(
persistChanges(
mutatePersistAndSync(
WorkspaceDataStore.transaction(
WorkspaceDataStore.patch(
model.state
this.model.state
this.state[
.prototype
installPrototypeModules
ensureWorkflowReady
except Exception
except:
pass
setRuntimeStyle
!important
```

Không được sửa mù theo số lượng.

---

# 4. P0/P1 — KHÔNG ĐƯỢC COI “ĐỌC INDEXEDDB LỖI” LÀ “TABLE RỖNG”

## Vấn đề mới cần xử lý

Trong `frontend/app/BiddingModel.js`, `loadStorageKeys()` hiện có pattern tương đương:

```js
try {
  // read IndexedDB
} catch {
  this.state[lowKey] = [];
}
```

Đây là semantics nguy hiểm.

Hai trạng thái sau là khác nhau:

```text
Store đọc thành công và không có record
```

và:

```text
Store không đọc được vì IndexedDB error
```

Không được biến cả hai thành `[]`.

## Rủi ro

Nếu local DB lỗi:

```text
read failed
↓
state = []
↓
UI tưởng workspace rỗng
```

sau đó một write/sync path có thể vô tình suy diễn table rỗng là dữ liệu thật.

## Yêu cầu

Thiết kế fail-safe behavior.

Ví dụ:

```text
successful empty read
→ state = []

read failure
→ preserve previous in-memory state nếu có
→ mark local storage/data state unavailable
→ surface recoverable error
→ KHÔNG stage mass deletion
→ KHÔNG persist [] để "repair"
→ KHÔNG auto-sync empty projection
```

Nếu workspace đang cold start và không có previous state:

- không giả vờ table rỗng;
- có explicit hydration failure state;
- chặn các action có nguy cơ overwrite/delete cho table đó cho tới khi recover/reload/pull server thành công.

Tận dụng `BrowserDBError.code` hiện có:

```text
QUOTA_EXCEEDED
TRANSACTION_ABORTED
PERMISSION_DENIED
CORRUPTED_OR_INCOMPATIBLE
OPERATION_FAILED
```

Không tạo một hệ thống error hoàn toàn mới nếu existing sync/persistence status có thể mở rộng.

## Test bắt buộc

- successful empty store;
- read request error;
- security/read permission error;
- corrupted/incompatible case;
- one table fails while others load;
- retry succeeds;
- failure does not enqueue deletion;
- failure does not overwrite IDB with `[]`;
- offline + local read failure;
- pending outbox vẫn được giữ.

---

# 5. P1 — MIGRATE LEGACY `persistData()/trackDeletions()` KHỎI BUSINESS HOT PATH

## Hiện trạng

`BiddingModel` vẫn giữ compatibility API:

```text
persistData()
trackDeletions()
markTableDirty()
full-table transaction()
```

Trong đó `trackDeletions()` vẫn:

- đọc full table;
- build map;
- `JSON.stringify()` record để tìm changed rows;
- suy diễn deletions.

Hot path mới đã có:

```text
explicit change-set
persistChanges()
WorkspaceDataStore.patch()
mutatePersistAndSync()
commitLocalMutation()
```

## Mục tiêu

Đối với **synced business tables**, mutation mới phải explicit.

Không tiếp tục dùng:

```text
sửa state
→ persistData
→ full-table diff
→ đoán mutation
```

mà dùng:

```text
domain action
→ explicit upserts/deletions
→ patch/persistChanges
→ outbox
→ sync
```

## Bắt buộc inventory

Lập bảng:

| Caller | Table | Synced? | Mutation biết trước? | Hướng |
|---|---|---:|---:|---|
| ... | goithau | yes | yes | migrate |
| ... | local-only | no | n/a | keep |
| ... | legacy compatibility | yes | partial | isolate |

## Ưu tiên migrate

Theo thứ tự:

1. package;
2. plan;
3. evaluation;
4. contract;
5. assignments;
6. contractor/expert/investor;
7. opening/bidder goods;
8. các synced table còn lại.

Không migrate path đã dùng explicit patch nếu nó đã đúng.

## Guard

Thêm scanner/lint hoặc allowlist để:

> code business mới không được thêm `persistData()` cho synced table.

Compatibility API có thể tồn tại tạm thời nhưng caller phải giảm.

## Không được

Không xóa `persistData()` ngay nếu còn legitimate legacy caller.

Không thay full-table diff bằng một full-table `markTableDirty()` khác rồi gọi là refactor.

---

# 6. P1 — GIẢM DIRECT STATE WRITES, NHƯNG KHÔNG CHẠY THEO CON SỐ MÙ QUÁNG

Baseline gần nhất:

```text
direct_state_writes = 85
```

## Quan trọng

Không phải mọi `this.state[...] = ...` đều sai.

Các loại có thể hợp lệ:

- hydration;
- server pull projection;
- workspace reset;
- rowVersion apply;
- initialization;
- internal store reducer.

Các loại cần migrate:

- feature/business workflow tự sửa record;
- UI handler sửa state rồi gọi persist;
- direct push/splice/assignment ngoài store/mutation boundary;
- mutation không tạo explicit persistence/outbox semantics.

## Bắt buộc phân loại

Tạo allowlist/comment cho intentional internal writes.

Từng direct business write phải chuyển sang:

```text
entityStore
WorkspaceDataStore.patch
mutatePersistAndSync
feature/domain service
```

tùy trường hợp.

## Mục tiêu

Giảm **thực chất** số direct business writes.

Không đặt target cứng nếu phải đánh đổi correctness, nhưng kỳ vọng giảm đáng kể từ baseline 85.

Gate chỉ được hạ khi code thật sự giảm.

**CẤM đổi scanner để làm số đẹp.**

---

# 7. P1/P2 — TIẾP TỤC MIGRATE PROTOTYPE COMPATIBILITY BRIDGE SANG FEATURE SERVICES

Hiện đã có:

```text
frontend/app/FeatureServices.js
```

với:

```text
controller.plans
controller.packages
controller.evaluation
controller.contracts
controller.partners
```

Nhưng legacy runtime prototype registry vẫn còn.

## Mục tiêu

Không xóa big-bang.

Làm incremental:

1. inventory caller đang gọi workflow method trực tiếp trên controller;
2. migrate các caller rõ domain sang feature service;
3. giữ compatibility bridge cho caller chưa migrate;
4. giảm method-name knowledge ở UI/shared modules;
5. không tạo service wrapper chỉ để đổi tên mà vẫn hidden dependency y như cũ.

## Điều cần kiểm tra

- `ensureWorkflowReady()`;
- `WorkflowModuleLoader`;
- `moduleRegistry`;
- wildcard workflow exports;
- method collision;
- circular dependency;
- stale method names.

## Test

- lazy load vẫn chỉ load khi cần;
- missing implementation fail rõ;
- no static import cycles;
- no duplicate module install;
- route navigation không regression;
- feature service có đúng `this` context.

---

# 8. P1/P2 — PYTHON DEBT CLEANUP

Baseline gần nhất:

```text
BLE001 = 147
S110   = 14
S608   = 129
F401   = 0
F841   = 0
```

## 8.1. BLE001

Audit từng broad:

```python
except Exception:
```

Phân loại:

```text
expected domain exceptions
database exceptions
network exceptions
serialization exceptions
observability-only exceptions
true last-resort boundary
```

Narrow exception khi biết loại lỗi.

Chỉ giữ broad exception ở boundary thật sự cần isolation, ví dụ:

- request top-level error boundary;
- telemetry/observability phải không phá business request;
- cleanup/finalizer đặc biệt.

Nếu giữ broad exception, phải:

- log có context;
- không nuốt lỗi business;
- comment lý do nếu không hiển nhiên.

## 8.2. S110 silent except

Không để:

```python
except X:
    pass
```

nếu lỗi đáng quan sát.

Thay bằng:

- explicit ignored exception với comment;
- debug log;
- structured metric;
- hoặc propagate.

Không spam production log cho expected benign condition.

## 8.3. S608 dynamic SQL

**Không coi mọi S608 là SQL injection.**

Phân loại:

```text
A. value interpolation nguy hiểm
B. dynamic identifier đã allowlist
C. placeholder list generated only from count
D. static schema metadata
```

### Với A

Phải sửa ngay.

### Với B/C/D

Tái sử dụng helper/allowlist chung nếu hợp lý.

Không thêm hàng loạt:

```python
# noqa: S608
```

chỉ để số giảm.

Mọi suppress mới phải có lý do cụ thể.

## Regression

F401/F841 phải tiếp tục bằng 0.

---

# 9. P2 — CSS / RUNTIME STYLE DEBT

Baseline gần nhất:

```text
!important     = 421
raw_colors     = 842
runtime_styles = 541
```

Đây là debt lớn nhưng **không được mass-replace**.

## Cách làm

Chỉ cleanup:

- file đang chạm;
- component có specificity conflict;
- duplicated inline style;
- runtime style có thể thay bằng semantic class;
- raw color có token tương đương rõ ràng.

Hướng:

```text
JS → state/class
CSS → presentation
```

Ví dụ:

```text
is-loading
is-hidden
is-error
is-disabled
is-selected
```

Dùng design token hiện có trước khi tạo token mới.

## Guard

- không tăng 3 metric trên;
- nếu giảm được thì hạ ratchet;
- responsive regression test 320/375/414/768/1280;
- keyboard/focus/contrast không regression.

Không thay 842 màu một lượt.

---

# 10. P1 — CRITICAL COVERAGE CHO CASE HIẾM

Coverage hiện đã tốt hơn nhưng cần tập trung vào **combinatorial correctness**, không chạy theo coverage % chung.

Bổ sung test cho các giao điểm dễ lỗi.

## 10.1. Versioning × tenant × concurrency

Test:

```text
plan/package version
× organization A/B
× expected rowVersion
× concurrent create
```

Đảm bảo:

- không cross-tenant;
- chỉ một latest;
- idempotent mutation id;
- conflict trả 409;
- historical frozen.

## 10.2. Versioning × aggregate children

Plan/package version phải giữ đúng:

- lots;
- goods;
- bidder goods;
- opening;
- JV members;
- assignments;
- Tổ chuyên gia;
- Tổ thẩm định;
- detailed evaluation;
- evaluation metadata;
- timeline;
- clarification;
- extensions;
- document-related owned children phù hợp.

Test cả:

```text
cold browser
server pagination
no local child hydration
```

## 10.3. Offline × pending outbox × reload

Test:

```text
edit
→ offline
→ reload
→ pending outbox
→ reconnect
→ server commit
```

Thêm:

```text
validation reject after reconnect
conflict after reconnect
```

## 10.4. Evaluation compatibility

Test:

- canonical codes;
- both Vietnamese combined labels;
- legacy technical result;
- numeric score;
- metadata version-0;
- malformed metadata;
- 1G1T;
- 1G2T;
- lot;
- no lot.

## 10.5. Multi-user

Hai browser contexts cùng sửa:

- same package;
- different fields;
- same row;
- one offline;
- one online.

Không cần xây Conflict Center UI; chỉ chứng minh sync semantics.

---

# 11. P1/P2 — LEGACY CLIENT VERSION SNAPSHOT FALLBACK

Hiện client vẫn có compatibility fallback sang snapshot cũ nếu backend aggregate-version endpoint trả:

```text
404
405
501
```

Đây là hợp lý trong giai đoạn rollout, nhưng duy trì vô hạn sẽ giữ lại kiến trúc cũ.

## Nhiệm vụ

Không xóa ngay.

Trước hết xác minh deployment contract.

Tạo một trong hai hướng:

### Hướng A — nếu production luôn deploy frontend/backend cùng version

- document minimum backend capability;
- thêm explicit capability/version check;
- deprecate fallback;
- chỉ remove sau khi test upgrade path.

### Hướng B — nếu phải hỗ trợ frontend mới + backend cũ

- giữ fallback;
- thêm metric/log khi fallback thực sự được dùng;
- warning trong diagnostics;
- đảm bảo cold-cache fallback có characterization tests;
- đặt deprecation criteria rõ.

Không dùng `404` chung chung làm tín hiệu nếu có thể phân biệt endpoint unsupported với resource-not-found.

Mục tiêu dài hạn:

> official version creation chỉ có một authority.

---

# 12. P1 — OBSERVABILITY SAU REFACTOR

Tận dụng metrics/logging hiện có.

Không thêm external monitoring vendor.

Theo dõi tối thiểu:

```text
sync conflict count
offline queued mutation count
outbox retry/failure
IndexedDB read failure by code
Excel worker failure
Excel worker fallback
WebSocket reconnect
WebSocket polling fallback duration
aggregate version 409
legacy version fallback usage
```

Không log dữ liệu nhạy cảm.

Không log full payload của package/contractor/document.

Metric label phải bounded, tránh high-cardinality ID.

---

# 13. PERFORMANCE SAFETY

Sau cleanup chạy lại:

```text
npm run test:performance
```

Không regression vượt budget.

Đặc biệt benchmark:

- explicit mutation vs legacy full diff;
- 1k/10k record table;
- package/plan version aggregate;
- Excel;
- startup.

Nếu một cleanup làm code “đẹp hơn” nhưng hot path chậm đáng kể, phải điều tra trước khi merge.

---

# 14. E2E BẮT BUỘC

Giữ toàn bộ gate đang pass:

- Auth shell;
- auth/roles matrix;
- CRUD;
- multi-assignee;
- JV;
- bidder goods;
- low-price;
- offline/reconnect;
- package pairwise;
- full lifecycle;
- UI quality.

Full lifecycle phải còn:

- 1G1T;
- 1G2T;
- phân lô;
- nhiều đợt;
- hủy;
- đấu lại;
- hợp đồng;
- version copy-on-write.

Không skip test.

Không tăng timeout để che race.

---

# 15. SECURITY INVARIANTS

Không làm yếu:

- tenant isolation;
- RBAC;
- ownership;
- CSRF;
- CSP;
- Trusted Types;
- secure worker policy;
- audit;
- document sandbox;
- secret management;
- rowVersion;
- conflict detection;
- idempotency.

Không dùng cleanup để bypass security gate.

---

# 16. DEBT GATE — NGUYÊN TẮC

Không tăng debt ceiling.

Nếu code giảm:

```text
direct_state_writes
runtime_styles
BLE001
S110
```

thì hạ ceiling tương ứng.

`important` và `raw_colors` không bắt buộc phải giảm mạnh trong vòng này nếu có nguy cơ visual regression, nhưng tuyệt đối không tăng.

`S608` chỉ hạ sau khi audit thực sự; không hạ bằng suppress giả.

---

# 17. COMMIT STRATEGY

Không gom tất cả thành một commit khổng lồ.

Gợi ý:

```text
fix(storage): distinguish IndexedDB read failure from empty state

refactor(persistence): migrate package/plan legacy full-table writes

refactor(persistence): migrate evaluation/contract legacy writes

refactor(state): move business direct writes behind mutation boundary

refactor(controller): expand feature service usage

refactor(python): narrow exception handling

refactor(sql): classify and harden dynamic SQL construction

refactor(ui): reduce touched-path runtime style debt

test(sync): cover offline reload and multi-user conflicts

test(versioning): expand aggregate inheritance matrix

chore(quality): tighten debt ratchets
```

Mỗi commit phải reviewable.

---

# 18. PROGRESS REPORT

Cập nhật:

```text
docs/refactor/BIDDINGFLOW_CLEANUP_ROUND_2.md
```

Mỗi phase ghi:

```text
Before
Finding
Root cause
Files changed
Why this approach
Tests
Performance
Debt before/after
Backward compatibility
Remaining risk
```

Không chỉ ghi “done”.

---

# 19. DEFINITION OF DONE

Không báo hoàn thành nếu chưa có bằng chứng.

## Correctness

- [ ] IndexedDB read failure không còn bị coi là empty table
- [ ] read failure không stage deletion
- [ ] pending outbox không mất
- [ ] no silent local data overwrite

## Persistence

- [ ] inventory tất cả `persistData/trackDeletions`
- [ ] synced hot paths dùng explicit mutations
- [ ] compatibility callers được document/allowlist
- [ ] full-table diff usage giảm thực chất

## State

- [ ] direct business state writes giảm
- [ ] internal/hydration writes được phân loại
- [ ] scanner không bị nới để làm đẹp số

## Architecture

- [ ] FeatureServices usage tăng
- [ ] prototype bridge callers giảm
- [ ] no static import cycle
- [ ] lazy loading vẫn hoạt động

## Python

- [ ] F401 = 0
- [ ] F841 = 0
- [ ] BLE001 giảm hoặc từng retained boundary có justification
- [ ] S110 giảm
- [ ] S608 được audit/classify
- [ ] không mass `noqa`

## CSS

- [ ] không tăng `!important`
- [ ] không tăng raw colors
- [ ] runtime styles không tăng
- [ ] responsive UI pass

## Tests

- [ ] full JS pass
- [ ] full Python pass
- [ ] critical coverage pass
- [ ] offline E2E pass
- [ ] versioning E2E pass
- [ ] bidder goods pass
- [ ] lifecycle pass
- [ ] UI quality pass

## Performance/security

- [ ] startup performance pass
- [ ] secure build pass
- [ ] CSP/Trusted Types pass
- [ ] security audit pass
- [ ] production package pass

---

# 20. STOP CONDITION

Sau khi hoàn thành cleanup vòng 2:

**DỪNG.**

Không tự động triển khai product feature mới.

Tóm tắt cuối cùng phải trả lời rõ:

1. Những legacy path nào đã loại bỏ?
2. Những legacy path nào còn giữ và vì sao?
3. `direct_state_writes` từ bao nhiêu xuống bao nhiêu?
4. Python debt thay đổi thế nào?
5. CSS debt thay đổi thế nào?
6. Có phát hiện bug mới nào trong quá trình refactor không?
7. Test/E2E nào đã chạy?
8. Performance trước/sau?
9. Còn risk nào cần theo dõi production?
10. Nền tảng đã đủ ổn để chuyển sang backlog tính năng mới chưa?

Không được tuyên bố “hết lỗi” chỉ vì test xanh.
