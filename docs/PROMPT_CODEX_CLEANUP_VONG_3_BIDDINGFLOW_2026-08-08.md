# PROMPT CODEX — CLEANUP VÒNG 3 BIDDINGFLOW
## Hoàn thiện các seam còn lại trước khi chuyển sang backlog tính năng

Repository: `newstar94/Bidding`  
Nhánh mục tiêu: `main`

Mốc audit khi lập prompt:

```text
f558c18984aed1c32b28c9915a6b5383dcc461a0
```

Trước khi sửa, phải fetch/rebase `main` mới nhất. Không giả định SHA trên vẫn là HEAD.

---

# 0. Phạm vi

Đây là cleanup vòng 3, quy mô nhỏ. Chỉ xử lý:

1. `trackDeletions()` không được nuốt lỗi đọc IndexedDB.
2. Khóa legacy persistence fallback bằng explicit opt-in.
3. Giới hạn cache mutation đã hoàn thành trong `WorkspaceDataStore`.
4. Cache `serverCapabilities` theo session.
5. Profile long-task của secure production bundle và chỉ tối ưu khi có bằng chứng.

**Không triển khai product feature mới.**

Không làm Version Diff, Conflict Center, Compliance Copilot, Risk/SLA feature, Contractor 360, Data Quality Center, What-if Simulator, Template Designer nâng cấp, Approval Workflow, Calendar, Bulk Operations hay Integration Hub.

---

# 1. Những phần đã ổn — không làm lại

Phải bảo toàn:

- IndexedDB write resolve khi transaction complete.
- Hydration error khác empty table.
- Per-table storage failure state.
- Offline/outbox state machine.
- Explicit mutation cho synced business hot path.
- Direct state writes đã giảm đáng kể.
- Canonical evaluation rules.
- Technical score parser thống nhất.
- Evaluation metadata codec.
- Backend-authoritative aggregate versioning.
- FeatureServices.
- WebSocket-first sync/notification.
- Excel Worker.
- Autosave draft, validation summary, sticky context.
- Python `S110=0`, `F401=0`, `F841=0`.

Không rewrite các phần này.

---

# 2. Baseline

Tạo/update:

```text
docs/refactor/BIDDINGFLOW_CLEANUP_ROUND_3.md
```

Ghi trước khi sửa:

- HEAD SHA;
- Python/JS test counts;
- critical coverage;
- frontend/Python debt;
- startup performance;
- secure production performance;
- E2E baseline;
- số caller `persistData`;
- số caller `trackDeletions`;
- số path dùng legacy fallback;
- lifetime/kích thước `WorkspaceDataStore.#completed`;
- số lần aggregate-version flow gọi `check-session`.

---

# 3. P1 — `trackDeletions()` phải fail closed khi IndexedDB read lỗi

Hiện compatibility path có dạng:

```js
async trackDeletions(type) {
  this.assertStorageTablesWritable?.(type);
  try {
    const oldData = await this.db.getTableData(type);
    ...
  } catch (e) {
    console.error(...);
  }
}
```

sau đó `persistData()` có thể tiếp tục:

```js
await this.trackDeletions(type);
await this.db.putTableData(type, this.state[type]);
```

Đây là seam correctness còn lại.

## Yêu cầu

Nếu `getTableData()` lỗi:

```text
record storage failure
→ throw BrowserDBError
→ abort persistData
→ không putTableData
→ không stage mutation
→ không stage deletion
```

Tái sử dụng `BrowserDBError`, `_recordStorageReadFailure()` và `assertStorageTablesWritable()`.

Phân biệt rõ:

```text
successful empty read = hợp lệ
read error = không hợp lệ
```

## Test bắt buộc

- empty read thành công;
- request error;
- abort;
- corrupted/incompatible;
- security/permission error;
- không `putTableData()` sau read failure;
- không enqueue mutation/deletion;
- pending outbox không mất;
- retry sau recovery thành công;
- compatibility caller nhận đúng failure semantics.

---

# 4. P1 — Khóa implicit legacy persistence

Hiện `persistAndSync()` vẫn có thể fallback từ no-explicit-change sang `persistData()`.

Không cho synced business table tự động đi vào full-table legacy path.

## API mong muốn

Ví dụ:

```js
persistAndSync(controller, tableKeys, {
  changes,
  allowLegacyPersistence: false
})
```

Mặc định:

```text
allowLegacyPersistence = false
```

Với synced table:

```text
không có explicit changes
→ throw developer/runtime error rõ
```

Chỉ projection/hydration/compatibility caller được explicit opt-in.

## Inventory bắt buộc

| Caller | Table | Synced? | Vì sao cần legacy? | Giữ/Migrate |
|---|---|---:|---|---|

Không cho broad/wildcard opt-in.

## Quality gate

Cập nhật scanner/test để chặn:

- synced business caller dùng `persistAndSync()` mà không có explicit changes;
- legacy opt-in ngoài allowlist.

## Test

- synced + no changes → reject;
- synced + changes → explicit path;
- local-only table vẫn hoạt động;
- sync projection/hydration explicit opt-in hoạt động;
- business workflows không implicit fallback.

---

# 5. P2 — Bound `WorkspaceDataStore.#completed`

`#completed = new Map()` không được tăng vô hạn theo controller lifetime.

Chọn LRU hoặc TTL + hard cap.

Ví dụ hợp lý:

```text
500–1000 mutation IDs
```

Codex phải chọn dựa trên usage thực tế.

Yêu cầu:

- vẫn dedupe same mutation id;
- bounded memory;
- reset/clear khi workspace thay đổi;
- không leak workspace A sang B;
- không thay server-side idempotency.

Test:

- duplicate dedupe;
- eviction oldest;
- cap không vượt giới hạn;
- workspace switch reset;
- semantics an toàn với mutation đã eviction.

---

# 6. P2 — Cache `serverCapabilities` theo session

Hiện aggregate version flow có thể:

```text
POST /api/auth/check-session
→ đọc serverCapabilities
→ POST /api/versioning/aggregate
```

mỗi lần tạo version.

Tận dụng session/bootstrap hiện có.

## Yêu cầu

- cache capabilities theo authenticated session;
- nếu cache chưa có thì fetch một lần;
- không fetch lại mỗi version action;
- logout invalidates;
- session refresh cập nhật;
- user/session change không dùng cache cũ;
- backend legacy thiếu capability vẫn fallback;
- capable backend trả 404/409 không bị hiểu là thiếu capability.

Đo số request trước/sau.

---

# 7. P2 — Profile secure production long task

Secure production bundle từng có outlier khoảng `106–121 ms`, budget `100 ms`.

Không tối ưu mù.

## Yêu cầu

Chạy profiling reproducible:

- 10–20 cold runs;
- 10–20 warm runs;
- ghi task duration;
- startup phase;
- route/chunk/module nếu xác định được;
- CPU contention;
- giữ mọi outlier, không cherry-pick.

Nếu không tái hiện ổn định: ghi rõ environment/noise risk và không sửa code.

Nếu tái hiện ổn định: tìm culprit, ví dụ obfuscation, hydration, module install, DOM render, JSON parse, startup reconciliation. Chỉ tối ưu đúng culprit.

Không nới budget. Không tắt security để lấy performance.

---

# 8. Optional — subscription comparison chỉ khi profiling chứng minh hot

`WorkspaceDataStore` còn dùng `structuredClone + JSON.stringify` để so selector result.

Chỉ refactor nếu profiler chứng minh đây là hot path.

Nếu cần, cân nhắc:

- selector-specific equality;
- shallow compare;
- revision-based compare;
- reference equality.

Nếu không nóng, ghi `defer`.

---

# 9. Debt rules

Không mở đợt mass cleanup mới.

Bắt buộc:

```text
F401 = 0
F841 = 0
S110 = 0
BLE001 không tăng
S608 không tăng
!important không tăng
raw colors không tăng
runtime styles không tăng
direct_state_writes không tăng
```

Nếu touched code giảm được thì hạ ratchet.

Không mass `noqa`.

---

# 10. Security invariants

Không làm yếu:

- tenant isolation;
- RBAC;
- ownership;
- CSRF;
- CSP;
- Trusted Types;
- worker policy;
- audit;
- rowVersion;
- conflict detection;
- idempotency;
- workspace isolation.

Không log dữ liệu nhạy cảm/full payload/token/session secret.

---

# 11. Test/E2E bắt buộc

Chạy:

```text
full Python
full JavaScript
critical coverage
lint
frontend debt
Python quality
secure build
dependency audit
production package
startup performance
```

E2E:

```text
auth shell
auth/roles
CRUD
multi-assignee
JV
bidder goods
low-price conflict
offline/reconnect
package pairwise
full lifecycle
UI quality
```

Không skip test. Không tăng timeout để che race.

---

# 12. Performance acceptance

Giữ nguyên budget:

```text
Cold p95 <= 800 ms
Warm p95 <= 325 ms
Longest task <= 100 ms
```

Phân biệt fresh/stale process và host contention. Không cherry-pick.

---

# 13. Commit strategy

Gợi ý:

```text
fix(storage): propagate trackDeletions read failures
refactor(persistence): require explicit legacy fallback opt-in
refactor(store): bound completed mutation cache
perf(versioning): cache server capabilities per session
perf(startup): profile secure bundle long tasks
test(storage): cover compatibility read failure safety
test(persistence): reject implicit synced full-table fallback
test(store): cover mutation cache eviction
test(versioning): cover capability cache lifecycle
chore(quality): tighten round 3 ratchets
```

Commit nhỏ, reviewable.

---

# 14. Progress report

Update:

```text
docs/refactor/BIDDINGFLOW_CLEANUP_ROUND_3.md
```

Mỗi phase ghi:

```text
Before
Finding
Root cause
Files changed
Behavior change
Tests
Performance
Debt before/after
Backward compatibility
Remaining risk
```

---

# 15. Definition of Done

## Storage

- [ ] `trackDeletions()` không nuốt IndexedDB read failure
- [ ] read failure abort full-table persist
- [ ] không stage deletion/mutation khi read lỗi
- [ ] pending outbox được giữ
- [ ] recovery retry pass

## Persistence

- [ ] synced business code không implicit fallback
- [ ] legacy fallback phải explicit opt-in
- [ ] allowlist được document
- [ ] quality gate chặn caller mới

## Mutation cache

- [ ] `#completed` bounded
- [ ] dedupe vẫn đúng
- [ ] workspace switch không leak
- [ ] eviction tests pass

## Capabilities

- [ ] capabilities cached theo session
- [ ] không `check-session` mỗi version action
- [ ] logout/session refresh invalidate/update
- [ ] mixed-version fallback pass

## Performance

- [ ] secure bundle profiling có evidence
- [ ] không nới threshold
- [ ] culprit reproducible thì đã xử lý
- [ ] không reproducible thì document rõ

## Quality

- [ ] full Python pass
- [ ] full JS pass
- [ ] relevant E2E pass
- [ ] secure build pass
- [ ] performance pass
- [ ] debt gate pass
- [ ] security pass

---

# 16. STOP CONDITION

Sau cleanup vòng 3: **DỪNG.**

Không triển khai feature mới.

Kết luận cuối phải trả lời:

1. `trackDeletions()` còn nuốt read failure không?
2. Synced business code còn có thể implicit legacy persistence không?
3. Bao nhiêu legacy caller còn được phép và vì sao?
4. `#completed` cap/TTL là bao nhiêu?
5. Capability request giảm từ bao nhiêu xuống bao nhiêu?
6. Secure bundle long-task có tái hiện ổn định không?
7. Test/E2E nào đã chạy?
8. Performance trước/sau?
9. Debt trước/sau?
10. Còn blocker nào trước backlog feature mới không?

Không tuyên bố “hết lỗi”.

Chỉ được kết luận:

```text
Không còn blocker đã biết trong phạm vi cleanup nếu toàn bộ gate trên pass.
```
