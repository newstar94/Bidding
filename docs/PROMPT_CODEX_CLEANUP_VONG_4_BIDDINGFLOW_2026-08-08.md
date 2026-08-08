# PROMPT CODEX — CLEANUP VÒNG 4 BIDDINGFLOW
## SỬA EDGE CASE RECOVERY CUỐI TRƯỚC KHI ĐÓNG GIAI ĐOẠN REFACTOR NỀN TẢNG

Repository: `newstar94/Bidding`  
Nhánh mục tiêu: `main`

Mốc audit gần nhất:

```text
75361acc3b13978f62b3bc4476fb2b9a556f5355
```

> Trước khi sửa, PHẢI fetch/rebase `main` mới nhất. SHA trên chỉ là mốc audit.

---

# 0. PHẠM VI

Đây là cleanup vòng 4 với phạm vi rất nhỏ. Chỉ xử lý:

1. Recovery của table khi table đã hydrate thành công trước đó, sau đó phát sinh IndexedDB read failure, IndexedDB phục hồi và ứng dụng retry local hydration.
2. Regression test cho đúng lifecycle trên.
3. Kiểm tra `_allDataLoadPromise` / hydration cache để failed table thực sự có thể retry.
4. Giữ nguyên toàn bộ fail-safe semantics hiện có.

## KHÔNG LÀM

Không mở cleanup/refactor lớn mới. Không triển khai Version Diff, Conflict Center, Compliance Copilot, Risk/SLA, Contractor 360, Data Quality Center, What-if Simulator, Template Designer nâng cấp, Approval Workflow, Calendar, Bulk Operations hay Integration Hub.

---

# 1. NHỮNG PHẦN ĐÃ ỔN — KHÔNG LÀM LẠI

Phải bảo toàn:

- IndexedDB write resolve tại transaction complete.
- `trackDeletions()` đã fail closed khi IndexedDB read lỗi.
- Storage read failure không bị coi là empty table.
- Failure state theo từng table.
- Failed table bị khóa write.
- Pending outbox không mất.
- Explicit persistence cho synced business table đã được enforce.
- `allowLegacyPersistence=false` mặc định.
- `WorkspaceDataStore.#completed` đã bounded LRU cap 750.
- `serverCapabilities` đã cache theo authenticated session lifecycle.
- Secure production performance gần nhất đã pass.
- Full JS/Python/E2E gần nhất đã pass.

Không rewrite các phần này.

---

# 2. EDGE CASE CẦN XỬ LÝ

`loadStorageKeys()` hiện có logic dạng:

```js
if (!requested.has(key) || this._loadedStorageKeys.has(key)) return;
```

Sau một hydration thành công:

```text
_loadedStorageKeys có GOITHAU
```

Nếu sau đó một read IndexedDB khác thất bại, ví dụ trong `trackDeletions()`, thì `_recordStorageReadFailure(table, error)` ghi failure state nhưng nếu không invalidate trạng thái loaded tương ứng thì có thể xảy ra:

```text
GOITHAU đã từng loaded
↓
IndexedDB read failure
↓
GOITHAU được đánh dấu failed
↓
IndexedDB phục hồi
↓
loadStorageKeys(["GOITHAU"])
↓
skip vì _loadedStorageKeys vẫn chứa GOITHAU
↓
table tiếp tục failed
```

Hệ thống không mất dữ liệu nhưng local retry có thể không hoạt động.

---

# 3. MỤC TIÊU CORRECTNESS

Phải hỗ trợ lifecycle:

```text
hydrate success
↓
table ready
↓
later IndexedDB read failure
↓
table failed + write locked
↓
IndexedDB recovers
↓
explicit retry local hydration
↓
table ready again
↓
write allowed again
```

Không bắt buộc reload page nếu local DB đã hồi phục.

---

# 4. THIẾT KẾ RECOVERY

Codex phải nghiên cứu implementation hiện tại trước khi chọn cách.

## Hướng A — invalidate loaded state khi read failure

Khi `_recordStorageReadFailure(table, error)` chạy, tìm storage key tương ứng và:

```js
this._loadedStorageKeys.delete(storageKey)
```

để lần `loadStorageKeys([storageKey])` sau thực sự đọc lại IndexedDB.

## Hướng B — explicit retry API

Ví dụ:

```js
retryStorageHydration(["goithau"])
```

API này được phép bypass `_loadedStorageKeys` chỉ cho failed table.

## Tiêu chí

Ưu tiên giải pháp:

- đơn giản;
- dễ test;
- không phá lazy hydration;
- không đọc lại table bình thường không cần thiết;
- không tạo duplicate hydration;
- không tạo state machine thứ hai.

Nếu Hướng A đủ sạch thì không tạo API mới.

---

# 5. KIỂM TRA `_allDataLoadPromise`

Hiện có pattern:

```js
ensureAllDataLoaded() {
  if (!this._allDataLoadPromise) {
    this._allDataLoadPromise = this.loadStorageKeys(...);
  }
  return this._allDataLoadPromise;
}
```

Phải xác minh:

```text
all-data promise đã resolve
+
một table sau đó chuyển sang failed
```

thì `ensureAllDataLoaded()` có retry failed table không.

Nếu không, phải:

- reset `_allDataLoadPromise` khi storage failure làm hydration state không còn complete; hoặc
- làm `ensureAllDataLoaded()` kiểm tra failed/pending tables trước khi reuse promise.

Không reset promise liên tục gây duplicate full hydration. Không biến mỗi call thành full DB scan.

---

# 6. WORKSPACE LIFECYCLE

Kiểm tra các state sau reset đúng ở workspace switch/deactivate/purge/logout khi liên quan:

```text
_loadedStorageKeys
_storageReadFailures
_allDataLoadPromise
```

Không leak workspace A sang B.

Nếu code hiện đã đúng thì chỉ thêm characterization test.

---

# 7. CONCURRENCY

Nếu hai nơi cùng retry một failed table:

```text
retry A
retry B
```

không được gây:

- destructive duplicate write;
- mutation staging;
- stale request clear failure sai;
- inconsistent final state.

Nếu existing architecture đã serialize đủ, chỉ test. Không tạo queue phức tạp nếu không cần.

---

# 8. TEST BẮT BUỘC

## Case 1 — success → later failure → retry success

```text
1. loadStorageKeys(["GOITHAU"]) success
2. assert state=ready
3. trigger trackDeletions() read failure
4. assert state=failed
5. assert write locked
6. restore IndexedDB read
7. retry hydration
8. assert state=ready
9. assert write allowed
10. persist succeeds
```

Đây là test quan trọng nhất.

## Case 2 — failed table only retries itself

```text
GOITHAU failed
KEHOACH ready
retry GOITHAU
→ KEHOACH không bị full re-read
```

## Case 3 — retry failure remains failed

```text
failure
→ retry
→ failure again
→ state vẫn failed
→ write vẫn locked
```

## Case 4 — concurrent retry

Nếu relevant:

```text
2 retry calls
→ one consistent final result
→ no duplicate mutation staging
```

## Case 5 — workspace switch

```text
workspace A failed table
→ switch B
→ B không inherit failure/loaded state
```

## Case 6 — pending outbox

```text
pending outbox
→ later storage read failure
→ retry recovery
→ outbox vẫn nguyên
```

---

# 9. GIỮ NGUYÊN FAIL-SAFE SEMANTICS

Vẫn phải giữ:

```text
read failure
→ preserve in-memory state
→ mark failed
→ block dangerous writes
→ không replace state bằng []
→ không stage mass deletion
→ không overwrite IndexedDB
```

Chỉ bổ sung đường recover.

---

# 10. OPTIONAL UI

Chỉ nếu existing UI đã có storage-error state và dễ mở rộng, có thể phản ánh:

```text
Lỗi dữ liệu cục bộ
→ Đang thử khôi phục...
→ Đã khôi phục
```

Không tạo popup mới. Không biến nhiệm vụ này thành UX feature.

---

# 11. TEST/GATE BẮT BUỘC

Chạy tối thiểu:

```text
targeted storage hydration tests
workspace data store tests
mutation service tests
full JavaScript
full Python
critical coverage
frontend debt gate
Python quality
secure build
startup performance
```

Relevant E2E:

```text
auth shell
auth/roles
CRUD
offline/reconnect
full lifecycle
UI quality
```

Nếu touched path ảnh hưởng package/evaluation, chạy thêm JV, bidder goods, package pairwise.

Không skip. Không tăng timeout để che race.

---

# 12. PERFORMANCE

Không làm mỗi mutation trigger full hydration.

Giữ budget:

```text
Cold p95 <= 800 ms
Warm p95 <= 325 ms
Longest task <= 100 ms
```

Success path overhead phải gần như bằng 0.

---

# 13. DEBT INVARIANTS

Không tăng:

```text
direct_state_writes
!important
raw_colors
runtime_styles
BLE001
S608
```

Giữ:

```text
F401 = 0
F841 = 0
S110 = 0
```

Không chỉnh scanner để cho qua.

---

# 14. SECURITY / DATA SAFETY

Không phá:

- tenant isolation;
- workspace isolation;
- RBAC;
- rowVersion;
- outbox durability;
- conflict handling;
- server idempotency;
- CSP;
- Trusted Types.

Không log record data khi IndexedDB error. Chỉ log metadata bounded:

```text
table
operation
error code
```

---

# 15. COMMIT STRATEGY

Gợi ý:

```text
fix(storage): allow retry after post-hydration IndexedDB failure
test(storage): cover success-failure-recovery lifecycle
test(storage): cover retry isolation across workspaces
```

Không gom unrelated cleanup.

---

# 16. PROGRESS REPORT

Tạo/update:

```text
docs/refactor/BIDDINGFLOW_CLEANUP_ROUND_4.md
```

Ghi:

```text
HEAD
Before behavior
Root cause
Fix
Tests
Performance
Debt
Backward compatibility
Remaining risk
```

---

# 17. DEFINITION OF DONE

- [ ] Table đã hydrate thành công rồi lỗi sau đó có thể local-retry.
- [ ] `_loadedStorageKeys` không ngăn failed table recovery.
- [ ] `_allDataLoadPromise` không giữ stale-complete state khi có failure mới.
- [ ] Retry success clear failure.
- [ ] Retry failure giữ failed.
- [ ] Write lock được gỡ chỉ sau successful recovery.
- [ ] Pending outbox không bị thay đổi.
- [ ] Workspace switch không leak hydration state.
- [ ] Không full rehydrate tất cả table không cần thiết.
- [ ] Targeted tests pass.
- [ ] Full JS/Python pass.
- [ ] Relevant E2E pass.
- [ ] Security/build/performance pass.
- [ ] Debt không tăng.

---

# 18. STOP CONDITION

Sau khi sửa edge case này: **DỪNG CLEANUP.**

Không mở cleanup vòng 5 nếu không phát hiện blocker correctness/security/data-loss mới.

Tóm tắt cuối phải trả lời:

1. Root cause chính xác là gì?
2. `_loadedStorageKeys` được xử lý thế nào?
3. `_allDataLoadPromise` được xử lý thế nào?
4. Retry có đọc lại đúng failed table không?
5. Pending outbox có được giữ không?
6. Workspace switch có sạch state không?
7. Test nào đã chạy?
8. Performance trước/sau?
9. Có regression nào phát hiện không?
10. Còn blocker nào trước khi chuyển sang backlog feature không?

Không tuyên bố “hết lỗi”.

Nếu toàn bộ gate pass, kết luận:

```text
Không còn blocker đã biết trong phạm vi storage hydration recovery.
Có thể đóng giai đoạn cleanup nền tảng và chuyển sang lựa chọn feature backlog.
```
