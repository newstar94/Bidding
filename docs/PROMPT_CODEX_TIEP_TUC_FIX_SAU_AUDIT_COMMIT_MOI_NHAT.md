# PROMPT CHO CODEX — TIẾP TỤC KHẮC PHỤC CÁC VẤN ĐỀ CÒN LẠI SAU AUDIT COMMIT MỚI NHẤT

## 0. Bối cảnh

Repository:

```text
https://github.com/newstar94/Bidding
```

Commit `main` mới nhất đã được audit:

```text
decdc52d27a8ed8b61bffc183236beb63705eb41
```

Message:

```text
feat: Enhance SQL parameter conversion and add chunked record filtering for improved performance
```

So với mốc audit cũ `2bd3e018fb0ca5cc4dcfd349207ca5c252c66606`, codebase đã được cải thiện đáng kể.

Các vấn đề nghiêm trọng sau đã được xử lý tương đối tốt và **KHÔNG được tự ý refactor lại nếu không thật sự cần thiết cho các lỗi còn lại**:

- canonical module registry;
- mapping `thong_tin_mo_thau -> goithau`;
- procurement opening permission;
- active role employee là least-privilege boundary;
- dynamic permission module đã có allowlist;
- assignment successor conflict đã được loại bỏ;
- snapshot awarded lot fail-closed;
- evaluation criterion/opening mapping fail-closed;
- aggregate graph validator;
- sync visibility đã được push phần lớn xuống SQL;
- giant `IN (...)` đã được chunk;
- qmark scanner đã hỗ trợ PostgreSQL JSONB/dollar quote;
- nhiều regression tests, E2E, migration và benchmark đã được bổ sung.

Mục tiêu của lượt này:

> Chỉ sửa các vấn đề còn lại đã được xác nhận hoặc cần khóa invariant, với thay đổi nhỏ nhất có thể, không mở thêm một đợt refactor toàn diện.

Ưu tiên:

```text
1. Data privacy
2. Data integrity
3. Resource safety
4. Regression prevention
5. Code clarity
```

---

# 1. PHẠM VI BẮT BUỘC

Cần xử lý 4 nhóm chính:

1. Tombstone/deletion privacy trên legacy/full sync path.
2. AI streaming queue/thread cancellation và resource safety.
3. Versioning internal-reference invariant khi source có relation nhưng target mapping biến mất.
4. Loại bỏ dead condition `if "is_latest" in {"is_latest"}`.

Ngoài ra:

- chỉ sửa thêm lỗi mới nếu nó trực tiếp cùng nguyên nhân gốc;
- không mở refactor lớn frontend/model trong lượt này;
- không rewrite `BiddingModel`;
- không redesign toàn sync architecture;
- không thay framework;
- không đổi business contract đã chốt trong ADR nếu không có bằng chứng code/test yêu cầu.

---

# 2. ISSUE A — TOMBSTONE / DELETION PRIVACY CHƯA ĐỒNG NHẤT

## 2.1. Vấn đề

`/api/sync/delta` đã có cơ chế tốt hơn:

```text
VisibilityScope.deletion_predicate(...)
```

và có thể dùng:

```text
deleted_records.record_snapshot_json
```

để lọc deletion event theo record scope.

Nhưng legacy/full sync path trong:

```text
backend/sync/read_service.py
```

vẫn có logic tương đương:

```sql
SELECT table_name, record_id
FROM deleted_records
WHERE organization_id = ?
```

sau đó non-manager chủ yếu lọc bằng:

```text
can_read_table(...)
```

Điều này chưa đủ vì user có thể:

- có quyền module `goithau=view`;
- chỉ được assignment Package A;
- nhưng vẫn nhận tombstone ID của Package B.

Đây là metadata leakage ngoài record scope.

## 2.2. Yêu cầu sửa

Không tạo thêm một permission rule mới.

Phải tái sử dụng source-of-truth hiện có:

```text
VisibilityScope
VisibilityScope.deletion_predicate(...)
```

cho tất cả read path có trả deletion/tombstone.

Mục tiêu:

```text
/api/get-all-data
/api/sync/delta
```

phải dùng cùng semantics.

Ở `read_service.py`:

- không fetch toàn bộ tombstone của organization rồi filter bằng table permission;
- build deletion query từ `VisibilityScope.deletion_predicate(...)`;
- mỗi table/payload key phải được scope trước khi serialize;
- có thể dùng `UNION ALL` theo pattern từ `delta_paging.py` nếu phù hợp;
- hoặc tạo helper dùng chung giữa delta/full read;
- không duplicate policy SQL giữa 2 module.

## 2.3. Business rules bắt buộc

### Manager
Nhận tất cả deletion event hợp lệ của organization.

### Employee

Ví dụ:

```text
Employee E assigned Package A
Employee E NOT assigned Package B
```

Nếu B bị xóa:

```text
E không được nhận {table: "goithau", id: B}
```

Nếu A bị xóa:

```text
E được nhận tombstone A
```

### Package child

Tombstone của:

```text
thong_tin_mo_thau
goi_thau_hang_hoa
hang_hoa_du_thau_nha_thau
```

phải scope theo parent package.

### Assignment/permissionmatrix

Chỉ trả đúng self-scoped row theo policy hiện tại.

### Personal workspace

Không lẫn tombstone organization khác.

## 2.4. Regression tests bắt buộc

Thêm tests cho cả:

```text
/api/get-all-data
/api/sync/delta
```

Cases:

1. Employee có module view + assigned Package A.
2. Xóa Package A → nhận tombstone.
3. Xóa Package B không assigned → không nhận tombstone.
4. Xóa opening child của Package A → nhận.
5. Xóa opening child của Package B → không nhận.
6. Manager nhận cả A và B.
7. Cross-org tombstone tuyệt đối không xuất hiện.
8. Visibility token/role switch không làm stale tombstone tiếp tục hợp lệ.

---

# 3. ISSUE B — AI STREAMING RESOURCE SAFETY CHƯA HOÀN THÀNH

## 3.1. Vấn đề hiện tại

Trong:

```text
backend/ai/service.py
```

hiện có pattern:

```python
event_queue: queue.Queue = queue.Queue()
```

=> queue không bounded.

Worker:

```python
threading.Thread(
    target=worker,
    daemon=True,
    name="bidding-ai-provider"
).start()
```

Provider thread tiếp tục đọc stream và `put()` event.

Consumer async:

```python
await asyncio.to_thread(event_queue.get)
```

không có cancellation coordination rõ ràng với producer.

Nếu client đóng tab/refresh/mất mạng/hủy SSE, HTTP consumer có thể kết thúc nhưng provider thread vẫn còn chạy.

Rủi ro:

```text
thread leak
provider connection leak
memory growth
unbounded queued events
resource exhaustion under repeated disconnects
```

## 3.2. Yêu cầu thiết kế

Không rewrite toàn AI architecture.

Hãy sửa `_provider_event_stream()` hoặc abstraction tương đương thành **bounded + cancellable**.

Tối thiểu cần:

```python
queue.Queue(maxsize=N)
threading.Event()
```

hoặc giải pháp tương đương.

### Producer

Phải:

- kiểm tra cancellation event;
- không block vô hạn khi queue full;
- dùng bounded `put`;
- có timeout khi `put`;
- thoát nếu consumer đã cancel;
- đảm bảo `"done"` không làm deadlock khi queue full;
- cleanup provider nếu API/provider có `close`, `cancel`, `abort` hoặc equivalent.

### Consumer

Phải:

- `finally: cancel_event.set()`;
- không chờ vô hạn nếu producer chết bất thường;
- xử lý `CancelledError`;
- xử lý disconnect;
- không nuốt lỗi provider.

### Route SSE

Trong:

```text
backend/ai/routes.py
```

event stream phải đảm bảo `ai_active_streams` luôn decrement đúng.

Nếu Starlette request hỗ trợ `await request.is_disconnected()` thì có thể dùng phù hợp, nhưng không polling quá dày và không tạo busy loop.

## 3.3. Queue policy

Chọn một giới hạn hợp lý, ví dụ:

```text
32 / 64 / 128 events
```

Không chọn quá lớn để che vấn đề.

Nếu consumer chậm:

- backpressure producer;
- không được tích vô hạn.

Nếu provider library không hỗ trợ abort thực sự:

- vẫn phải set cancellation;
- worker phải dừng enqueue;
- ghi rõ limitation trong report.

## 3.4. Regression tests bắt buộc

1. Normal provider stream hoàn tất.
2. Provider exception được forward.
3. Consumer cancel sớm.
4. Queue không vượt maxsize.
5. Worker dừng sau cancellation.
6. Client disconnect không để active stream metric bị giữ.
7. Repeated disconnect không tăng thread count không giới hạn.
8. `done` sentinel không deadlock khi queue gần/full.
9. Tool-call stream vẫn hoạt động bình thường.
10. Không làm thay đổi AI authorization/read-only behavior.

Có thể mock provider. Không cần gọi provider thật.

---

# 4. ISSUE C — VERSIONING: KHÔNG ĐƯỢC SILENT DETACH INTERNAL RELATION

## 4.1. Vấn đề cần khóa invariant

Các lỗi nguy hiểm cũ dạng:

```text
mapping.get(old_id, old_id)
```

đã được loại bỏ ở nhiều nơi.

Tuy nhiên còn một edge case:

```text
Goods A -> Lot 1
```

Trong target version, `Lot 1` bị loại khỏi selected lots.

Một số mapping kiểu:

```python
lot_ids.get(old_lot_id)
```

có thể trả `None`, sau đó target child trở thành:

```text
phanLoId = None
```

Validator có thể chỉ kiểm tra “nếu reference có giá trị thì phải tồn tại”, dẫn tới source có relation nhưng target relation bị mất mà không fail.

## 4.2. Business invariant

Mặc định:

> Nếu source child có internal relation thì khi clone target relation đó phải được remap đầy đủ. Nếu target không có mapping, phải fail closed.

Không được tự biến:

```text
source relation != null
```

thành:

```text
target relation = null
```

trừ khi business operation **explicitly** cho phép detach relation đó.

Nếu không có business contract rõ ràng cho explicit detach, hãy **FAIL CLOSED**.

## 4.3. Áp dụng cho internal relation

Kiểm tra ít nhất:

### Goods
`goiThauHangHoa.phanLoId`

### Opening
`thongTinMoThau.phanLoId`

### Bidder goods
`thongTinMoThauId`, `goiThauHangHoaId`, `phanLoId`

### Evaluation
`vongDanhGiaId`, `tieuChiDanhGiaId`, `parentCriterionId`

### Timeline
`sourceEntityId`

### Assignment
`targetId`

### Package/plan
`keHoachId`, `rebidFromPackageId`

và mọi internal relation registry khác trong:

```text
backend/versioning/aggregate_policy.py
backend/versioning/relation_policy.py
```

## 4.4. Cách sửa mong muốn

Tạo helper rõ nghĩa kiểu:

```python
def _mapped_optional_reference(mapping, source_id, code, message):
    if not source_id:
        return None
    return _required_mapping(mapping, source_id, code, message)
```

Semantics:

```text
source_id rỗng -> target None hợp lệ
source_id có giá trị -> mapping bắt buộc tồn tại
```

Không viết `mapping.get(...)` rải rác cho internal refs.

## 4.5. Error code

Có thể dùng:

```text
AGGREGATE_GOODS_LOT_UNMAPPED
AGGREGATE_OPENING_LOT_UNMAPPED
AGGREGATE_BIDDER_GOODS_GOODS_UNMAPPED
AGGREGATE_BIDDER_GOODS_LOT_UNMAPPED
```

hoặc convention hiện có.

Quan trọng nhất:

```text
fail closed + rollback
```

## 4.6. Regression tests bắt buộc

1. Source goods có lot nhưng target lot bị loại → fail.
2. Source opening có lot nhưng target lot bị loại → fail.
3. Bidder goods có goods reference nhưng goods không clone → fail.
4. Bidder goods có lot reference nhưng lot không clone → fail.
5. Source reference vốn `None` → target `None` hợp lệ.
6. Valid mapping → clone thành công.
7. Failure không partial persist.
8. Historical source không bị mutate.
9. `row_version`/sync cursor không advance khi transaction rollback.
10. Audit/WebSocket outbox không ghi success event nếu snapshot fail.

---

# 5. ISSUE D — DEAD CONDITION `is_latest`

Trong:

```text
backend/analytics/aggregation_engine.py
```

hiện còn:

```python
if "is_latest" in {"is_latest"}:
    where.append(f"{table_name}.is_latest = 1")
```

Điều kiện này luôn đúng.

## 5.1. Yêu cầu sửa

Nếu tất cả entity được hỗ trợ đều cần latest-only:

```python
where.append(f"{table_name}.is_latest = 1")
```

Nếu semantics khác nhau theo entity, đưa `latest_only` vào semantic registry.

Không giữ fake condition.

## 5.2. Tests

- aggregate packages chỉ latest;
- aggregate plans chỉ latest;
- aggregate contracts chỉ latest;
- historical version không bị double count;
- list và aggregate có parity.

---

# 6. KHÔNG REFACTOR LỚN FRONTEND TRONG LƯỢT NÀY

Hai technical debt vẫn tồn tại:

```text
BiddingModel God Object
global MutationObserver on document.body
```

Nhưng **không sửa lớn trong lượt này**.

Lý do:

- không phải security/data-integrity blocker;
- refactor lớn dễ gây regression;
- phạm vi hiện tại cần nhỏ và kiểm chứng được.

Chỉ sửa frontend nếu thật sự cần cho:

```text
tombstone handling
AI cancellation
version error handling
```

Không tách BiddingModel thành hàng loạt class trong lượt này.
Không rewrite view architecture.

---

# 7. ĐỐI CHIẾU PHẦN ĐÃ SỬA — KHÔNG ĐƯỢC LÀM HỎNG

Sau khi sửa 4 issue trên, phải regression lại:

## Authorization
- `thongtinmothau -> goithau`;
- canonical module registry;
- unknown module fail closed;
- active role employee least-privilege;
- manager organization scope;
- employee assignment scope;
- personal workspace.

## Procurement
- opening import yêu cầu `goithau=edit`;
- preview scoped theo user/org/workspace;
- revision behavior không regression.

## Assignment
- remove/offboard không bắt successor nếu business rule hiện tại là optional;
- sync/direct API parity.

## Versioning
- awarded lot fail closed;
- detailed evaluation criterion fail closed;
- bidder goods opening fail closed;
- timeline source fail closed;
- target graph validator;
- immutable historical version;
- assignment inheritance.

## Sync
- SQL visibility pushdown;
- chunk size 500;
- visibility token reset;
- delta cursor;
- full sync;
- pagination;
- offline outbox.

## PostgreSQL
- qmark scanner;
- JSONB operators;
- dollar quotes;
- migration chain.

## AI
- read-only;
- permission context refresh trước tool;
- workspace switch fail;
- membership revoke fail;
- no cross-tenant query.

---

# 8. TEST GATE BẮT BUỘC

Sau từng issue:

```text
targeted unit tests
targeted integration tests
```

Sau tất cả:

```text
python -m pytest -q
npm run test:js
npm run check:static
npm run build:secure
```

Nếu environment hỗ trợ:

```text
npm run test:e2e:smoke
scripts/run_isolated_audit_e2e.ps1 -Suite auth-roles
scripts/run_isolated_audit_e2e.ps1 -Suite offline
```

và E2E liên quan sync/AI nếu có.

Không được:

- skip test mới để pass;
- xóa test cũ;
- weaken assertion;
- đổi business contract để phù hợp code lỗi.

---

# 9. YÊU CẦU VỀ GIT / COMMIT

Trước sửa:

```text
git status
git log -1
```

Đảm bảo HEAD đúng hoặc mới hơn:

```text
decdc52d27a8ed8b61bffc183236beb63705eb41
```

Nếu HEAD đã thay đổi:

- đọc lại changed files;
- revalidate findings;
- không patch mù theo line cũ.

Nên chia commit logic:

```text
fix(sync): enforce record-scoped tombstone visibility
fix(ai): bound and cancel provider streaming
fix(versioning): reject missing internal reference remaps
refactor(ai): remove dead latest-only condition
test: add remaining audit regressions
```

Không commit formatting toàn repo.

---

# 10. DEFINITION OF DONE

## Tombstone

```text
[ ] /api/get-all-data dùng record-scoped deletion visibility
[ ] /api/sync/delta vẫn đúng
[ ] employee không thấy tombstone record ngoài scope
[ ] package-child tombstone theo parent package
```

## AI resource safety

```text
[ ] queue bounded
[ ] producer cancellable
[ ] consumer cancel signal
[ ] disconnect cleanup
[ ] no unbounded thread/resource accumulation
[ ] active stream metric luôn cleanup
```

## Versioning

```text
[ ] source non-null internal ref không thể tự thành target null
[ ] missing map fail closed
[ ] transaction rollback sạch
[ ] historical source immutable
```

## Analytics

```text
[ ] fake is_latest condition bị loại bỏ
[ ] latest-only semantics có test
```

## Regression

```text
[ ] full Python test pass
[ ] full JS test pass
[ ] static pass
[ ] secure build pass
[ ] migration tests pass
[ ] không test nào bị xóa/skip do code mới
```

---

# 11. BÁO CÁO CUỐI

Tạo file:

```text
docs/reports/BIDDINGFLOW_REMAINING_AUDIT_FIXES_2026-08-14.md
```

Nội dung gồm:

## A. Baseline
- HEAD before;
- HEAD after;
- branch.

## B. Findings
Mỗi issue gồm:
- ID;
- severity;
- root cause;
- files;
- fix;
- tests.

## C. Tombstone parity
So sánh:
- `/api/get-all-data`;
- `/api/sync/delta`;
- chứng minh cùng visibility semantics.

## D. AI cancellation model
Mô tả:
- queue size;
- cancel signal;
- producer lifecycle;
- consumer lifecycle;
- disconnect behavior;
- provider abort limitation.

## E. Version invariant
Liệt kê internal relation nào giờ dùng required mapping.

## F. Test evidence
Ghi chính xác:
- command;
- passed;
- failed;
- skipped;
- exit code.

## G. Remaining risks
Không được ghi “không còn lỗi”.

Nếu còn technical debt như:
- BiddingModel God Object;
- global MutationObserver;

ghi rõ là intentionally deferred.

---

# 12. CHỈ THỊ CUỐI CÙNG

Đây là **lượt sửa tiếp nối nhỏ, chính xác và an toàn**, không phải một đợt tái kiến trúc mới.

Hãy:

1. đọc code mới nhất;
2. xác nhận từng finding vẫn tồn tại;
3. sửa 4 nhóm issue trên;
4. thêm regression tests trước/đồng thời với fix;
5. chạy toàn bộ test/build;
6. không làm regression các phần đã ổn;
7. tạo báo cáo cuối.

Không dừng ở việc đưa plan.

Phải thực sự sửa code và chứng minh bằng test.

Ưu tiên lớn nhất:

> Không làm phát sinh lỗi mới chỉ để “hoàn tất refactor”.
