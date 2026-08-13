# PROMPT CHO CODEX — SỬA LỖI, REFACTOR VÀ CỦNG CỐ BIDDINGFLOW TRONG MỘT LẦN THỰC HIỆN

## 0. Mục tiêu tối cao

Repository:

- `https://github.com/newstar94/Bidding`
- Làm việc trên code mới nhất của nhánh `main`.
- Mốc đã được rà soát gần nhất: commit `2bd3e018fb0ca5cc4dcfd349207ca5c252c66606` ngày 13/08/2026.

Hãy **nghiên cứu thật kỹ toàn bộ ứng dụng và thực hiện tất cả các sửa lỗi + refactor + cải thiện hiệu suất + củng cố bảo mật trong MỘT LẦN triển khai hoàn chỉnh**.

Yêu cầu đặc biệt:

> Phải làm thật chặt chẽ, cẩn thận, ưu tiên tính đúng đắn và an toàn dữ liệu. Không được vì refactor mà làm phát sinh thêm lỗi mới.

Không được sửa theo kiểu “thấy đâu sửa đó”. Phải hiểu toàn bộ luồng, xác định invariant, viết/điều chỉnh test, rồi mới sửa.

---

# 1. Cách thực hiện bắt buộc

Đây là một lần triển khai duy nhất, nhưng bắt buộc chia thành các **cổng kiểm soát nội bộ**.

## Gate 1 — Khảo sát trước khi sửa

Trước khi thay đổi bất kỳ code production nào:

1. Đọc cấu trúc toàn repo.
2. Xác định các module liên quan:
   - auth/session;
   - workspace;
   - RBAC;
   - permission matrix;
   - assignment;
   - sync;
   - pagination;
   - versioning;
   - plan/package/contract;
   - opening/evaluation/goods;
   - procurement import/Mua Sắm Công;
   - AI;
   - PostgreSQL;
   - frontend state;
   - IndexedDB/outbox;
   - WebSocket;
   - audit;
   - notification;
   - document/export.
3. Tìm toàn bộ test hiện có của các khu vực trên.
4. Tìm caller/callee của các function sẽ sửa.
5. Tìm các business rule đang bị duplicate.
6. Tìm schema, indexes, constraints liên quan.
7. Tìm mọi API có thể ghi cùng một loại dữ liệu.
8. Tìm mọi nơi có thể bypass UI bằng gọi API trực tiếp.
9. Xác định migration/compatibility requirements.
10. Lập danh sách file dự kiến sửa trước khi bắt đầu.

Không được dựa duy nhất vào danh sách lỗi trong prompt này. Nếu trong quá trình đọc code phát hiện thêm lỗi có cùng nguyên nhân gốc hoặc mức độ tương đương, phải xử lý luôn.

---

## Gate 2 — Chốt invariant trước khi sửa

Hãy ghi lại trong ghi chú làm việc các invariant bắt buộc, tối thiểu gồm:

### Workspace / Tenant

- User không được đọc/ghi dữ liệu organization mà họ không có quyền.
- Personal workspace không được lẫn dữ liệu organization.
- Organization ID không được lấy từ payload client nếu server có thể tự xác định.
- Mọi read/write quan trọng phải scope bằng `organization_id`.

### Permission

- Backend là nguồn sự thật.
- UI ẩn nút không được coi là security control.
- Module permission phải resolve từ registry server-owned.
- Assignment scope phải được enforce ở backend.
- Manager/employee/super_admin behavior phải nhất quán giữa tất cả endpoint.

### Versioning

- Historical version là immutable.
- Snapshot mới không được giữ internal reference sang snapshot nguồn, trừ quan hệ nào được định nghĩa rõ là cross-version.
- Mọi child của aggregate mới phải thuộc aggregate mới.
- Không tồn tại orphan internal IDs.
- Nếu mapping không đầy đủ thì fail transaction.

### Sync

- Cùng một business operation qua API trực tiếp và `/api/sync` phải cho cùng kết quả.
- Row version conflict phải fail có cấu trúc.
- Partial failure không được tạo state nửa vời.
- Offline outbox không được làm sai business rule backend.

### PostgreSQL

- Không swallow database exception rồi tiếp tục dùng transaction đã aborted.
- Không tạo SQL identifier từ client-controlled string.
- Transaction phải commit/rollback rõ ràng.
- Không giữ connection lâu hơn cần thiết.

### AI

- AI không được vượt quyền user.
- Tool phải read-only nếu contract hiện tại là read-only.
- Tool phải revalidate session/workspace ngay trước execute.
- Không cung cấp raw data vượt scope.
- Cancellation/resource usage phải bounded.

Chỉ chuyển sang sửa khi invariant rõ ràng.

---

## Gate 3 — Sửa theo cụm và test ngay

Sau mỗi cụm dưới đây:

1. Chạy unit test liên quan.
2. Chạy integration test liên quan.
3. Chạy lint/type/static checks hiện có.
4. Nếu fail:
   - sửa ngay;
   - không chuyển sang cụm tiếp theo khi chưa ổn.

---

## Gate 4 — Full regression cuối cùng

Sau khi tất cả cụm pass riêng:

- chạy toàn bộ test suite;
- chạy security tests;
- chạy frontend tests;
- chạy backend tests;
- chạy DB/integration tests;
- chạy E2E nếu repo có;
- chạy build production;
- chạy lint;
- chạy dependency/security checks hiện có;
- kiểm tra migration/schema;
- kiểm tra browser console;
- kiểm tra API error contract;
- kiểm tra backward compatibility.

Không được kết thúc nhiệm vụ khi test suite còn lỗi do thay đổi của mình.

---

# 2. Nguyên tắc sửa code

## 2.1. Không rewrite toàn bộ ứng dụng

Không được:

- đổi framework chỉ để “code đẹp”;
- rewrite frontend sang React/Vue;
- rewrite backend;
- thay database;
- thay auth architecture nếu không cần;
- đổi API contract hàng loạt không có compatibility layer.

Ưu tiên refactor từng lớp, giữ behavior hợp lệ hiện tại.

---

## 2.2. Giữ các cơ chế đang tốt

Không làm yếu hoặc loại bỏ:

- server-side session;
- password hashing;
- CSRF;
- Origin/Referer validation;
- CSP;
- Trusted Types;
- DOMPurify;
- request body limits;
- tenant scoping;
- optimistic concurrency;
- `row_version`;
- idempotency;
- audit log;
- DB worker pool;
- PostgreSQL transaction;
- sensitive-data filtering;
- WebSocket isolation;
- AI tool allowlist;
- AI permission recheck;
- delete authorization backend.

Nếu refactor các khu vực này, mức an toàn sau thay đổi phải >= hiện tại.

---

# 3. CỤM A — UNIFIED AUTHORIZATION / RBAC

Đây là khu vực ưu tiên cao nhất.

Hiện code có nhiều lớp quyền:

```text
platform role
organization membership role
active role
permission matrix
assignment scope
workspace type
record-level scope
```

Logic hiện phân tán ở nhiều module.

## 3.1. Sửa lỗi import thông tin mở thầu

### Vấn đề

`thong_tin_mo_thau` là child của gói thầu và phải kế thừa module:

```text
goithau
```

Nhưng procurement import có chỗ gọi permission với:

```text
thongtinmothau
```

### Yêu cầu

Không chỉ sửa string.

Hãy tạo abstraction trung tâm dạng:

```python
resolve_table_module(table_name)
require_table_permission(...)
```

hoặc thiết kế tốt hơn phù hợp codebase.

Endpoint không được tự hardcode module nếu module đã có mapping trung tâm.

### Acceptance

- `thong_tin_mo_thau -> goithau`.
- `goi_thau_hang_hoa -> goithau`.
- `hang_hoa_du_thau_nha_thau -> goithau`.
- Không query permission column không tồn tại.
- Employee `goithau=edit` + đúng assignment được phép.
- Employee chỉ `view` không được ghi.
- Không assignment thì bị deny nếu record-scope rule yêu cầu.
- Manager đúng quyền.
- Personal owner đúng quyền.

---

## 3.2. Loại dynamic permission column không an toàn/giòn

Hiện có pattern tương đương:

```python
SELECT {module_name}
FROM ma_tran_phan_quyen
```

### Yêu cầu

Module name phải đến từ allowlist/registry cố định.

Không để arbitrary string đi vào SQL identifier.

Ưu tiên một trong:

- static map;
- psycopg SQL identifier với allowlist;
- query full permission row rồi lookup field;
- normalized permission table nếu refactor schema là an toàn và migration hợp lý.

Không migration lớn nếu không thật sự cần.

### Acceptance

- Invalid module không làm transaction aborted.
- Invalid module fail closed.
- Không SQL injection identifier.
- Không silent fallback làm user có quyền ngoài ý muốn.

---

## 3.3. Unified AuthorizationContext

Refactor dần về một context server-owned, ví dụ:

```python
AuthorizationContext
```

Có tối thiểu:

```text
user_id
organization_id
scope_type
platform_role
membership_role
active_role
module_permissions
```

Và API logic cấp cao:

```python
can_view(...)
can_edit(...)
can_delete(...)
can_manage_members(...)
can_export(...)
visibility_scope(...)
```

Không nhất thiết phải rewrite mọi file ngay nếu quá rủi ro, nhưng trong lần thực hiện này phải:

1. tạo source-of-truth chung;
2. chuyển các luồng quan trọng sang dùng source-of-truth đó:
   - sync;
   - pagination;
   - procurement import;
   - AI query scope;
   - CRUD business records.

Không tạo thêm layer duplicate.

---

## 3.4. Active role / inherited specialist access

Hiện manager/super_admin có thể hoạt động ở `active_role=employee` nhưng vẫn có inherited access.

Hãy đọc kỹ:

- UI wording;
- auth roles;
- session behavior;
- tests;
- permission helpers;
- business expectation.

Sau đó xác định contract chính xác.

### Nếu active_role chỉ là persona/UI

Giữ effective privileges nhưng:

- đổi naming/comment cho rõ;
- UI không được gây hiểu nhầm rằng user đang impersonate least-privilege employee;
- thêm tests.

### Nếu active_role phải giới hạn quyền thật

Sửa policy để khi employee mode thì quyền thực bị hạ đúng mức.

Không được tự suy đoán. Phải dựa trên toàn codebase.

Báo cáo cuối phải nói rõ lựa chọn và lý do.

---

## 3.5. Record visibility source-of-truth

Hiện:

```text
sync -> access_policy
pagination -> SQL riêng
AI -> query_scope
```

Hãy giảm duplication.

Tạo hoặc mở rộng một `VisibilityScopeBuilder` / abstraction tương đương để cùng một rule assignment/tenant được sử dụng ở:

- pagination;
- full/delta sync;
- AI aggregation/list;
- record fetch.

Không để 3 implementation từ từ lệch nhau.

---

# 4. CỤM B — ASSIGNMENT / OFFBOARDING BUSINESS RULE

## 4.1. Rule successor không đồng nhất

Business rule mới thể hiện:

> Assignment là tùy chọn. Offboarding không bắt buộc successor.

Nhưng có thể còn logic cũ trong sync hoặc validation.

### Yêu cầu

Tìm toàn repo:

```text
SUCCESSOR_REQUIRED
ASSIGNMENT_SUCCESSOR_REQUIRED
successor
replacement
transfer assignment
offboarding
remove assignment
member left
```

Xóa hoặc chỉnh mọi rule cũ không còn đúng.

### Rule yêu cầu

Nếu không chuyển giao:

- assignment cũ được xóa theo behavior business hiện tại;
- không xóa business record;
- record có thể trở thành unassigned;
- không tự gán manager;
- không tạo popup/backend requirement giả.

Nếu có chuyển giao:

- validate successor là active member đúng organization;
- không chuyển cho chính user bị remove;
- chống duplicate assignment;
- audit đầy đủ.

### Acceptance

Cùng thao tác qua:

- member API;
- sync;
- offline outbox;
- UI direct save

phải có kết quả nhất quán.

---

## 4.2. Central AssignmentDomainService

Nếu logic hiện phân tán nhiều nơi, tạo service/domain helper chung cho:

- create assignment;
- remove assignment;
- transfer assignment;
- offboard assignments;
- validate assignment target;
- deduplicate assignment;
- audit/notification hooks.

Không duplicate SQL/business rule ở nhiều endpoint.

---

# 5. CỤM C — VERSIONING / SNAPSHOT DATA INTEGRITY

Đây là khu vực cực kỳ nhạy cảm. Không được sửa nửa vời.

## 5.1. Không tạo orphan award lot

Nếu award không map được sang target lot:

- không `create_id()` để tiếp tục;
- fail có cấu trúc;
- rollback toàn transaction.

Ví dụ error:

```text
SNAPSHOT_LOT_MAPPING_FAILED
```

Tên thực tế theo convention của repo.

---

## 5.2. Không fallback internal reference sang source version

Cấm các pattern logic kiểu:

```python
mapping.get(old_id, old_id)
```

đối với **internal target graph IDs**.

Áp dụng cho:

- lot;
- goods;
- opening;
- bidder goods;
- evaluation round;
- evaluation criterion;
- package children;
- assignment targets;
- joint venture child;
- detailed evaluation child;
- timeline source ID nếu internal;
- các child relation khác tìm được trong repo.

Nếu mapping thiếu:

```text
FAIL CLOSED
```

---

## 5.3. Snapshot graph clone pipeline

Refactor theo pipeline an toàn:

```text
Load source graph
        ↓
Validate source graph
        ↓
Allocate ALL target IDs
        ↓
Clone nodes
        ↓
Remap edges
        ↓
Validate target graph
        ↓
Persist atomically
```

Tách mapping ra khỏi việc mutate object tùy hứng.

Có thể tạo các structure:

```python
SnapshotIdMap
SnapshotGraph
SnapshotValidationError
```

nếu phù hợp.

---

## 5.4. Snapshot validator

Tạo validator bắt buộc trước persist.

### Package

- target package ID đúng.
- target plan ID đúng.
- `rootId` đúng lineage.
- version number đúng.
- `isLatest` đúng.
- historical row không bị mutate.

### Lots

- target lot IDs unique.
- award lot ID tồn tại.
- không source lot ID còn sót.

### Goods

- child `goiThauId` đúng target.
- `phanLoId` nếu có phải tồn tại.

### Opening

- `goiThauId` đúng target.
- lot ref hợp lệ.
- opening IDs unique.

### Bidder goods

- target package đúng.
- target opening tồn tại.
- target goods tồn tại.
- target lot tồn tại.

### Evaluation

- round refs thuộc target metadata.
- criterion refs thuộc target metadata.
- parent criterion refs được remap.
- không source criterion ID.

### Assignment

- target đúng package mới.
- không duplicate assignment sau clone.

### Timeline / child metadata

- internal source IDs phải được remap.

### Cross-version leakage

Tạo helper có khả năng phát hiện source-owned IDs còn tồn tại trong target aggregate ở các field được định nghĩa là internal references.

Nếu fail:

- không persist;
- rollback transaction;
- error structured.

---

## 5.5. Regression bug khi tăng phiên bản

Kiểm tra kỹ các luồng:

- sửa gói thầu từ trang chi tiết;
- sửa từ modal danh sách;
- đổi thời gian đóng/mở thầu;
- tăng phiên bản;
- import revision từ Mua Sắm Công;
- plan version snapshot.

Đảm bảo khi nâng phiên bản:

- kế thừa trạng thái hợp lệ;
- kế thừa phân công;
- kế thừa dữ liệu child;
- không reset về `PREPARING` nếu business rule không yêu cầu;
- không biến người phụ trách thành “chưa phân công”;
- hai entry point chỉnh sửa phải cùng behavior.

Nếu hiện tại lỗi cũ đã được sửa, vẫn phải bổ sung regression tests để khóa behavior.

---

# 6. CỤM D — SYNC READ/WRITE

## 6.1. Full/delta sync phải push permission xuống SQL

Hiện full/delta sync có xu hướng:

```text
load org data
map
attach child
filter permission
```

Trong khi pagination đã filter trong SQL.

### Yêu cầu

Refactor sync read để:

```text
AuthorizationContext
        ↓
Visibility SQL
        ↓
SELECT only authorized rows
        ↓
attach children
        ↓
serialize
```

Không fetch dữ liệu user chắc chắn không được xem.

---

## 6.2. Không tạo giant IN(...)

Các helper filter theo nhiều record IDs phải chunk.

Dùng constant chung, ví dụ:

```python
QUERY_CHUNK_SIZE = 500
```

hoặc phù hợp PostgreSQL.

Không tạo SQL chứa hàng chục nghìn placeholders.

---

## 6.3. Tombstone deletion privacy

Hiện deleted-record/tombstone có nguy cơ chỉ filter theo table permission.

### Yêu cầu

Employee chỉ nhận deletion event nếu event đó thuộc record scope mà họ hợp lệ được biết.

Thiết kế cần xử lý trường hợp record đã xóa, nên không thể đơn giản gọi current `can_read_record()` nếu record không còn.

Có thể cần persisted deletion visibility metadata hoặc secure rule dựa trên prior assignment/lineage.

Mục tiêu:

- không leak ID của record mà user chưa từng có scope;
- vẫn cho client xóa stale IndexedDB records khi cần;
- manager vẫn nhận đúng;
- personal workspace đúng.

Hãy chọn giải pháp an toàn và thực tế, có test.

---

## 6.4. PostgreSQL aborted transaction

Tìm các pattern:

```python
try:
    cursor.execute(...)
except DatabaseError:
    log...
    continue
```

trong cùng transaction.

Với PostgreSQL, sau statement error transaction có thể aborted.

### Yêu cầu

Mỗi nơi cần recovery phải:

- dùng SAVEPOINT;
- rollback savepoint;
- hoặc fail transaction.

Không swallow rồi tiếp tục.

Đặc biệt kiểm tra permission matrix read và các compatibility paths.

---

## 6.5. Sync business rule consistency

So sánh `/api/sync` với direct CRUD APIs.

Các rule sau phải cùng source:

- permission;
- assignment;
- status transitions;
- versioning;
- child parent invariants;
- delete restrictions;
- row version;
- archived behavior.

Không duplicate business validation.

---

# 7. CỤM E — POSTGRESQL / DATABASE

## 7.1. Qmark compatibility scanner

Hiện app có compatibility layer đổi:

```text
? -> %s
```

### Rủi ro

Có thể va chạm với PostgreSQL syntax về sau như:

```text
JSONB ?
JSONB ?|
JSONB ?&
dollar-quoted SQL
```

### Yêu cầu

Rà soát toàn repo.

Nếu khả thi an toàn trong một lần:

- chuyển production SQL dần/hoàn toàn sang psycopg-native placeholders;
- bỏ hoặc thu hẹp qmark scanner.

Nếu bỏ hoàn toàn tạo rủi ro quá lớn:

- cải thiện scanner đủ đúng với PostgreSQL syntax;
- thêm unit tests cho:
  - quoted strings;
  - double quoted identifiers;
  - line comment;
  - block comment;
  - dollar-quoted strings;
  - JSONB operators;
  - normal qmark placeholders.

Không được làm hỏng SQL hiện có.

---

## 7.2. Index review

Dựa trên actual queries, kiểm tra indexes cho tối thiểu:

```text
organization_id
organization_id + id
organization_id + is_latest
organization_id + archived_at
organization_id + sync_version
assignment:
  organization_id + id_nhan_vien + loai_doi_tuong + id_muc_tieu
version lineage:
  organization_id + id_goc
package:
  organization_id + ke_hoach_id
deleted_records:
  organization_id + delete_version
permission matrix:
  organization_id + emp_id
```

Chỉ thêm index nếu query plan/use case chứng minh hữu ích.

Không tạo index dư thừa.

---

## 7.3. N+1 / repeated queries

Rà soát:

- sync;
- pagination;
- AI tools;
- versioning;
- procurement;
- dashboard.

Batch/prefetch khi hợp lý.

---

# 8. CỤM F — AI

## 8.1. Giữ AI read-only

Không biến AI thành write-agent trong nhiệm vụ này.

Giữ:

- allowlisted tool;
- fresh permission context;
- organization scope;
- record assignment visibility;
- tool argument validation;
- source link validation.

---

## 8.2. Resource/cancellation

Hiện streaming provider có thể dùng thread + queue.

### Yêu cầu

Kiểm tra:

- client disconnect;
- provider timeout;
- worker thread lifetime;
- unbounded queue;
- SSE cancellation;
- active stream counter;
- exception cleanup.

Nếu có rủi ro:

- dùng bounded queue;
- cancellation event;
- stop worker khi client disconnect nếu provider hỗ trợ;
- không để daemon thread tiếp tục sinh dữ liệu vô hạn;
- đảm bảo metric decrement trong mọi path.

---

## 8.3. AI permission parity

AI phải dùng cùng visibility source-of-truth với API thông thường.

Test:

- employee chỉ thấy assigned packages/contracts/plans theo rule.
- manager thấy org scope.
- personal owner chỉ personal.
- đổi workspace giữa tool call phải fail.
- bị revoke membership giữa conversation phải fail tool tiếp theo.
- không dùng model output để quyết định authorization.

---

## 8.4. Dead/unfinished condition

Rà soát các code smell như:

```python
if "is_latest" in {"is_latest"}:
```

Thay bằng semantic registry rõ ràng hoặc logic trực tiếp.

Không giữ fake condition.

---

# 9. CỤM G — FRONTEND ARCHITECTURE / PERFORMANCE

Không rewrite framework.

## 9.1. Giảm BiddingModel God Object

Hiện model kiêm quá nhiều trách nhiệm.

Tách dần thành:

```text
WorkspaceStore
EntityStore
IndexedDbRepository
MutationOutbox
SyncClient
VersionSelectionStore
```

Tên có thể khác.

### Điều kiện

- Không đổi public behavior một cách không cần thiết.
- Có compatibility façade nếu controller đang phụ thuộc API cũ.
- Không refactor cả frontend trong một commit khổng lồ nếu không cần.
- Tập trung tách responsibility có lợi rõ nhất và có test.

---

## 9.2. MutationObserver / DOM enhancement

Rà soát observer trên toàn `document.body`.

Mục tiêu:

- tránh repeated full DOM scans;
- enhance đúng vùng vừa render;
- cleanup observer/listener;
- không làm hỏng modal;
- không làm hỏng custom select;
- không làm hỏng Flatpickr;
- không làm giảm accessibility.

---

## 9.3. Lazy loading

Giữ và mở rộng code-splitting nếu có lợi.

Không eagerly import feature nặng nếu user không dùng.

Nhưng không hy sinh tính ổn định bootstrap.

---

## 9.4. Event listener cleanup

Rà soát:

- modal open/close;
- workspace switching;
- dynamic tables;
- assistant;
- notification center.

Không để listener duplicate qua nhiều lần render/chuyển workspace.

---

# 10. CỤM H — SECURITY REVIEW BỔ SUNG

Sau khi sửa các vấn đề trên, rà soát lại toàn repo cho:

## Authentication

- session fixation;
- session revocation;
- remember me;
- idle expiry;
- absolute expiry;
- password reset;
- OTP;
- email change;
- Google OAuth;
- rate limiting;
- Turnstile.

## Authorization

- IDOR;
- cross-tenant read;
- cross-tenant write;
- manager/employee boundary;
- personal/org boundary;
- export permissions;
- media access;
- WebSocket.

## Input

- SQL injection;
- path traversal;
- unsafe file upload;
- formula injection Excel;
- stored XSS;
- DOM XSS;
- URL injection;
- SSRF trong integration/provider;
- oversized payload;
- malformed JSON.

## Data

- secrets in logs;
- sensitive PII;
- audit leak;
- AI prompt/tool leak;
- file/media URL access.

Nếu phát hiện lỗi thật, sửa luôn và thêm test.

Không tạo finding giả chỉ để “đủ số lượng”.

---

# 11. CỤM I — PROCUREMENT IMPORT / MUA SẮM CÔNG

Rà soát toàn bộ flow:

```text
prepare
preview
session
revision
apply
resume
cancel
opening import
plan import
package import
```

## Yêu cầu

- Permission dùng unified policy.
- Scope preview theo user + organization + workspace lease.
- Không apply preview của user khác.
- Không apply preview org khác.
- Revision order đúng.
- Multiple revisions đầy đủ.
- Idempotency đúng.
- Row version conflict đúng.
- Source-owned fields rõ ràng.
- Không overwrite local-owned fields ngoài policy.
- Transaction atomic.
- Import session TTL đúng.
- Cancel/resume đúng.
- Mọi child mapping đúng version target.
- Không gọi external provider giữ DB transaction mở.
- Rate limit vẫn đúng.

Thêm regression test cho các điểm này.

---

# 12. CỤM J — UI/UX CONSISTENCY

Rà soát các màn hình chính:

```text
Dashboard
Kế hoạch
Chi tiết kế hoạch
Gói thầu
Chi tiết gói thầu
Mở thầu
Đánh giá
Hợp đồng
Chủ đầu tư
Nhà thầu
Chuyên gia
Quản trị
Phân quyền
Phân công
Mua Sắm Công import
AI assistant
```

Kiểm tra:

- cùng action ở danh sách và chi tiết có cùng behavior;
- disabled/read-only theo quyền đúng;
- không nút nào “cho bấm rồi backend 403” nếu frontend biết trước quyền;
- frontend không ẩn dữ liệu mà backend vẫn gửi thừa;
- error message có ý nghĩa;
- loading state;
- duplicate submit;
- stale modal data;
- pagination/search/filter;
- F5;
- back/forward navigation;
- workspace switch;
- role switch.

Đặc biệt kiểm tra regression:

> chỉnh thời gian đóng thầu ở màn hình chi tiết và chỉnh từ modal danh sách phải dùng cùng domain update path.

---

# 13. TEST BẮT BUỘC PHẢI THÊM

Ít nhất phải có regression tests cho các case sau.

## RBAC

1. Employee `goithau=edit` + assigned package:
   - edit package thành công;
   - edit opening thành công;
   - edit goods phù hợp status thành công.

2. Employee `goithau=view`:
   - read được scope hợp lệ;
   - edit bị deny.

3. Employee không assigned:
   - không đọc record assignment-scoped nếu rule yêu cầu;
   - không edit.

4. Manager:
   - đúng full org scope.

5. Personal owner:
   - đúng personal scope.

6. Cross organization:
   - fail.

---

## Assignment

7. Remove assignment không successor:
   - direct API thành công.
   - sync thành công.
   - không xóa business record.

8. Offboard employee không successor:
   - thành công theo business rule.
   - assignment cleanup đúng.

9. Transfer successor:
   - successor invalid bị reject.
   - duplicate assignment không sinh.

---

## Versioning

10. Tăng package version:
    - status được kế thừa đúng.
    - assignment được kế thừa.
    - opening/goods/bidder goods được clone đúng.

11. Award lot không map:
    - fail.
    - không partial persist.

12. Opening reference không map:
    - fail.

13. Criterion reference không map:
    - fail.

14. Target graph không chứa source internal IDs.

15. Update từ detail và modal:
    - same business result.

---

## Sync

16. Employee full sync:
    - server không query/serialize unauthorized rows nếu có thể assert.

17. Delta sync:
    - visibility đúng.

18. Tombstone:
    - không leak unauthorized IDs.

19. Row version conflict:
    - structured 409/conflict theo contract.

20. PostgreSQL statement failure trong optional path:
    - transaction không tiếp tục ở aborted state.

---

## Procurement

21. Opening import với `goithau=edit` hoạt động.

22. Preview user A không apply được bởi user B.

23. Org A preview không apply vào org B.

24. Revision import không mất dữ liệu local-owned.

25. Idempotency replay đúng.

---

## AI

26. Employee AI query chỉ thấy assigned records.

27. Membership bị revoke giữa các tool call:
    - tool tiếp theo fail permission.

28. Workspace đổi giữa tool calls:
    - fail scope validation.

29. SSE client disconnect:
    - không leak active worker/thread/resource.

---

## Frontend

30. Workspace switch:
    - không dữ liệu workspace cũ.

31. Role switch:
    - UI đúng capability.

32. Modal/list/detail:
    - không diverge update behavior.

33. Listener không duplicate sau nhiều lần mở/đóng/chuyển workspace.

---

# 14. PERFORMANCE TEST

Tạo benchmark/test dataset hoặc script không ảnh hưởng production với quy mô mục tiêu:

```text
10.000 plans
50.000 packages
100.000 assignments
100.000+ opening/goods/child rows
```

Đo tối thiểu:

```text
DB query count
DB execution time
connection checkout time
JSON serialization
response size
peak memory nếu công cụ hỗ trợ
full sync TTFB
pagination latency
AI aggregate latency
```

Mục tiêu chính:

- employee không fetch cả organization rồi mới lọc;
- không giant `IN`;
- không N+1 rõ ràng;
- pagination giữ keyset/cursor tốt;
- không regression performance nghiêm trọng.

Không tối ưu vi mô nếu làm code khó hiểu mà không có số liệu.

---

# 15. DATABASE MIGRATION SAFETY

Nếu cần schema/index migration:

1. Migration phải idempotent theo convention repo.
2. Không mất dữ liệu.
3. Không reset production table.
4. Không drop column/table nếu không migration dữ liệu đầy đủ.
5. Có rollback strategy hoặc migration forward-safe.
6. Index lớn cần cân nhắc lock.
7. Test từ database schema cũ lên schema mới.
8. Test database mới hoàn toàn.

---

# 16. ERROR CONTRACT

Không trả stack trace ra client.

Các lỗi business quan trọng phải structured:

```json
{
  "code": "...",
  "message": "...",
  "fields": {}
}
```

theo convention hiện có.

Phân biệt:

```text
400 validation
401 authentication nếu convention hỗ trợ
403 permission
404 record scope/not found phù hợp policy chống enumeration
409 row/version/business conflict
413 body too large
429 rate limit
503 infrastructure busy/timeout
```

Không đổi hàng loạt status code nếu frontend đang phụ thuộc; phải giữ compatibility.

---

# 17. OBSERVABILITY

Sau refactor giữ hoặc cải thiện:

- audit;
- structured log;
- DB timing;
- sync timing;
- AI metrics;
- permission denial metrics;
- error code.

Không log:

- password;
- OTP;
- raw session token;
- raw auth cookie;
- sensitive document contents;
- secrets/API keys.

---

# 18. CÁCH COMMIT / THAY ĐỔI

Dù đây là một lần triển khai, nên chia commit logic nếu môi trường cho phép:

```text
1. tests/invariants
2. authorization fixes
3. assignment domain fix
4. versioning integrity
5. sync visibility/performance
6. PostgreSQL cleanup
7. AI resource safety
8. frontend refactor/performance
9. final regression fixes
```

Mỗi commit phải build/test được nếu có thể.

Không trộn formatting toàn repo vào commit functional.

Không đổi tên hàng trăm file không cần thiết.

---

# 19. NHỮNG ĐIỀU TUYỆT ĐỐI KHÔNG ĐƯỢC LÀM

- Không bỏ test để test pass.
- Không `skip` test lỗi do code mới.
- Không catch `Exception` rồi bỏ qua lỗi dữ liệu quan trọng.
- Không trả `True` mặc định khi permission lookup lỗi.
- Không fail-open authorization.
- Không dùng frontend permission thay backend.
- Không reset database để giải quyết migration.
- Không hardcode user/org cụ thể.
- Không xóa audit.
- Không tắt CSP/CSRF/Trusted Types.
- Không tắt optimistic concurrency.
- Không bỏ row version.
- Không biến historical version thành mutable.
- Không giữ orphan child/reference.
- Không fallback internal reference sang source version để “cho chạy”.
- Không thêm sleep/retry vô hạn để che race condition.
- Không tăng timeout vô tội vạ thay vì sửa performance.
- Không đổi API shape mà không cập nhật toàn bộ caller/test.
- Không làm ứng dụng compile được nhưng logic sai.

---

# 20. DEFINITION OF DONE

Chỉ coi là hoàn thành khi:

## Functional

- Tất cả vấn đề xác nhận trong prompt đã được sửa.
- Những vấn đề mới phát hiện trong cùng nguyên nhân gốc cũng được xử lý.
- Không regression các chức năng cũ.

## Security

- Không cross-tenant access.
- Không permission bypass.
- Không IDOR đã xác nhận.
- Không dynamic unsafe permission identifier.
- AI không vượt quyền.
- Xóa dữ liệu vẫn backend-controlled.

## Data integrity

- Snapshot graph hợp lệ.
- Không orphan.
- Không cross-version internal reference.
- Sync/direct API nhất quán.
- Row version hoạt động.

## Performance

- Permission filter được push xuống SQL ở read path chính.
- Không giant `IN`.
- Không N+1 nghiêm trọng được phát hiện trong luồng đã sửa.

## Quality

- Full test suite pass.
- Lint pass.
- Build pass.
- Migration/schema check pass.
- Không browser console error mới.
- Không test bị disable.

---

# 21. BÁO CÁO CUỐI CÙNG CODEx PHẢI TRẢ VỀ

Sau khi hoàn tất, tạo một file Markdown trong repo, ví dụ:

```text
BAO_CAO_REFACTOR_FIX_TOAN_DIEN_BIDDINGFLOW_2026-08-13.md
```

Báo cáo phải có:

## A. Snapshot

- branch;
- commit trước;
- commit sau;
- thời điểm.

## B. Findings

Mỗi finding:

```text
ID
Severity
File/function
Root cause
Impact
Fix
Tests
```

## C. Files changed

Danh sách file và lý do.

## D. Authorization model sau refactor

Mô tả rõ:

```text
platform role
membership role
active role
permission matrix
assignment
workspace scope
```

và precedence.

## E. Versioning model sau refactor

Giải thích:

- lineage;
- immutable history;
- graph cloning;
- ID remapping;
- invariant validation.

## F. Sync model

Giải thích:

- visibility;
- full sync;
- delta sync;
- tombstones;
- optimistic concurrency.

## G. Tests

Ghi chính xác:

```text
command
passed
failed
skipped
```

Nếu có skipped test từ trước phải ghi rõ.

## H. Performance

Before/after nếu đo được.

## I. Security

Các kiểm tra đã thực hiện.

## J. Remaining risks

Không được nói “không còn lỗi”.

Phải ghi những vùng chưa thể chứng minh hoàn toàn nếu có.

---

# 22. YÊU CẦU TỰ KIỂM TRA CUỐI CÙNG

Trước khi kết thúc, tự trả lời từng câu:

```text
[ ] Có API nào vẫn tự hardcode module permission dễ lệch registry không?
[ ] Có write path nào không dùng backend authorization không?
[ ] Direct API và sync còn business rule khác nhau không?
[ ] Có snapshot child nào còn source internal ID không?
[ ] Có mapping nào dùng .get(old_id, old_id) cho internal graph không?
[ ] Có query nào lấy cả org rồi mới lọc employee scope không?
[ ] Có giant IN(...) không chunk không?
[ ] Có PostgreSQL error nào bị catch rồi tiếp tục transaction không?
[ ] AI tool có revalidate scope không?
[ ] Client disconnect có cleanup AI stream không?
[ ] Workspace switch có thể giữ state cũ không?
[ ] Modal và detail page có update logic khác nhau không?
[ ] Có test nào bị skip/xóa để pass không?
[ ] Full test suite đã pass chưa?
[ ] Production build đã pass chưa?
```

Nếu bất kỳ mục quan trọng nào chưa đạt, tiếp tục sửa trong cùng phiên làm việc.

---

# 23. Ưu tiên khi phải lựa chọn

Thứ tự ưu tiên tuyệt đối:

```text
1. Không mất/sai dữ liệu
2. Không vượt quyền
3. Không phá business logic
4. Không regression
5. Transaction correctness
6. Test coverage
7. Performance
8. Maintainability
9. Code elegance
```

Nếu một refactor “đẹp hơn” nhưng tăng rủi ro regression mà không mang lợi ích rõ ràng, **không thực hiện refactor đó**.

---

# 24. Kết quả mong muốn

Sau lần thực hiện này, BiddingFlow cần đạt trạng thái:

- permission có source-of-truth rõ hơn;
- procurement import không lệch module permission;
- assignment/offboarding nhất quán;
- version snapshot fail-safe và không orphan/cross-version leak;
- sync read hiệu quả hơn và đúng quyền từ SQL;
- PostgreSQL transaction recovery đúng;
- AI stream/resource an toàn hơn;
- frontend giảm coupling ở những điểm rủi ro cao;
- test regression bao phủ các lỗi đã phát hiện;
- không làm hỏng các cơ chế bảo mật hiện có;
- toàn bộ ứng dụng vẫn hoạt động đầy đủ sau refactor.

**Hãy thực hiện toàn bộ nhiệm vụ trong một lần, nhưng tuân thủ các gate kiểm soát ở đầu prompt. Không dừng ở việc đưa ra kế hoạch hoặc báo cáo; phải thực sự sửa code, thêm test, chạy test và hoàn thiện codebase.**
