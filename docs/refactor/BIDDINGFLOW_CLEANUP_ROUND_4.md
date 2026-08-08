# BiddingFlow cleanup round 4

Ngày thực hiện: 2026-08-08  
Nhánh: `main`  
HEAD sau `git fetch origin`: `75361acc3b13978f62b3bc4476fb2b9a556f5355`  
`origin/main`: `75361acc3b13978f62b3bc4476fb2b9a556f5355`

`git rebase origin/main` đã được gọi nhưng Git từ chối vì worktree đang có bốn deletion tài liệu từ người dùng. Vì HEAD và `origin/main` trùng SHA, không có commit upstream cần rebase; các deletion đó được giữ nguyên và không thuộc cleanup vòng 4.

## Baseline

| Mục | Before |
|---|---|
| Python | 633/633 pass |
| JavaScript | 514/514 pass |
| Critical coverage | pass, 15 modules |
| Frontend debt | `direct_state_writes=59`, `important=421`, `raw_colors=842`, `runtime_styles=541`, `inferred_actions=6` |
| Python debt | `BLE001=118`, `F401=0`, `F841=0`, `S110=0`, `S608=128` |
| Secure startup | pass; cold p95 466 ms, warm p95 179 ms, longest task 94/0 ms |

## Before behavior

`loadStorageKeys()` bỏ qua mọi key đã có trong `_loadedStorageKeys`. Sau hydrate thành công, một lỗi đọc muộn từ `trackDeletions()` ghi `_storageReadFailures` nhưng không invalidate loaded key hoặc `_allDataLoadPromise`. Vì vậy local retry có thể không gọi IndexedDB và table tiếp tục bị write-lock.

Workspace reset hiện đã tạo mới `_loadedStorageKeys`, `_storageReadFailures` và đặt `_allDataLoadPromise=null`; cần characterization test để bảo toàn.

## Root cause

Ba cache/lifecycle seam không được invalidated hoặc scoped cùng nhau:

1. Transition ready → failed chỉ cập nhật `_storageReadFailures`; storage key vẫn nằm trong `_loadedStorageKeys`, nên targeted retry bị skip.
2. `_allDataLoadPromise` vẫn trỏ tới full-load promise đã resolve, nên `ensureAllDataLoaded()` không gọi lại `loadStorageKeys()` sau failure mới.
3. Concurrent retry chưa có per-key in-flight dedupe; ngoài duplicate read, một completion từ workspace epoch cũ có thể ghi state vào workspace mới.

## Fix

- `_recordStorageReadFailure()` tìm đúng storage key, xóa riêng key đó khỏi `_loadedStorageKeys` và đặt `_allDataLoadPromise=null`.
- `loadStorageKeys()` dùng `_storageLoadPromises` để hai caller chia sẻ một read in-flight theo key; entry tự xóa ở `finally`.
- Mỗi hydration capture `_workspaceEpoch`; success/error từ epoch cũ trở thành no-op.
- `_resetWorkspaceMemory()` tạo mới loaded/failure/in-flight caches và reset all-data promise như trước.

Không tạo retry API hoặc state machine thứ hai. Targeted `loadStorageKeys([key])` tiếp tục là public recovery seam.

## Tests

Baseline `npm test`, critical coverage, frontend debt và Python quality pass.

Red/green evidence:

- success → later `trackDeletions()` failure → local retry: đỏ `2 !== 3` reads, sau fix xanh;
- stale `_allDataLoadPromise`: đỏ `goithau=2` thay vì `3`, trong khi `kehoach=1`; sau fix chỉ failed table được đọc lại;
- concurrent retry: đỏ `4 !== 3` reads; sau per-key in-flight cache xanh;
- stale workspace-A completion: đỏ vì state B bị thay bằng `package-a-stale`; sau epoch guard xanh.

Targeted cuối: storage/browser/bidder-goods 89/89, `WorkspaceDataStore` 13/13, mutation service 7/7.

Full gate:

- `npm run check`: pass; Python 633/633, JavaScript 520/520, critical coverage 15 modules;
- lint encoding/security/modules/debt: pass;
- secure build: 46 obfuscated bundles verified;
- FK audit, production-package smoke và SBOM: pass.

Relevant E2E trên fresh isolated servers:

| Gate | Kết quả |
|---|---:|
| Auth shell | pass |
| Auth/roles | pass |
| CRUD | pass |
| Offline/reconnect | pass |
| Full lifecycle | pass |
| UI quality | pass |

JV không nằm trong relevant list vì production change không chạm package/evaluation. Vẫn chạy thêm hai lần và giữ evidence: lần đầu harness gọi `getComputedStyle` khi element chưa tồn tại trong re-login; lần hai đi xa hơn rồi timeout tại lot-result transition. Hai failure khác vị trí, không xuất hiện trong sáu required gate và không được sửa ngoài scope.

## Performance

Before: cold p95 466 ms, warm p95 179 ms, longest 94/0 ms.  
After secure 30+30: cold p95 485 ms, warm p95 209 ms, longest 94/76 ms; pass budget 800/325/100. Chênh lệch nằm trong host/run variance; không nhận là optimization hoặc regression. Success mutation path không thêm hydration/read; chỉ hydration call mới lookup Map O(1).

## Debt

Không đổi:

- frontend `direct_state_writes=59`, `important=421`, `raw_colors=842`, `runtime_styles=541`, `inferred_actions=6`;
- Python `BLE001=118`, `F401=0`, `F841=0`, `S110=0`, `S608=128`.

## Backward compatibility

Fail-closed read semantics, preserved memory, pending outbox, workspace isolation và authoritative server recovery giữ nguyên. Successful table không bị đọc lại khi table khác retry.

## Remaining risk

Long Task vẫn mang attribution `unknown/window` như vòng 3 nhưng ở dưới budget. JV harness có hai failure không ổn định ngoài required scope như đã ghi; không có evidence liên hệ với recovery change vì các run đó không inject IndexedDB failure.

## Completion audit

1. Root cause: transition ready → failed không invalidate loaded key/all-data promise; concurrent hydration chưa dedupe và completion cũ chưa scoped theo workspace epoch.
2. `_loadedStorageKeys`: chỉ xóa storage key của table vừa read-failed; key khỏe giữ nguyên.
3. `_allDataLoadPromise`: đặt `null` khi có read failure mới; lần ensure kế tiếp chạy loader nhưng các key khỏe được skip/share in-flight.
4. Retry chỉ đọc lại failed table; test chứng minh `goithau` tăng read còn `kehoach` giữ nguyên.
5. Pending outbox giữ byte-for-byte equivalent snapshot qua failure, retry và concurrent retry.
6. Workspace reset tạo mới loaded/failure/in-flight caches và all-data promise; epoch guard chặn completion A ghi sang B.
7. Đã chạy targeted suites, full Python/JS, critical coverage, lint/debt/security, secure build, production package, performance và sáu relevant E2E.
8. Performance trước 466/179/94 ms; sau 485/209/94 ms theo cold/warm/longest, đều pass budget.
9. Regression phát hiện: retry bị loaded-key skip, stale all-data promise, duplicate concurrent read và stale workspace completion. Cả bốn có regression test.
10. Không còn blocker đã biết trong phạm vi storage hydration recovery. Không tuyên bố “hết lỗi”; JV harness risk ngoài scope được giữ ở report.

Không còn blocker đã biết trong phạm vi storage hydration recovery.  
Có thể đóng giai đoạn cleanup nền tảng và chuyển sang lựa chọn feature backlog.
