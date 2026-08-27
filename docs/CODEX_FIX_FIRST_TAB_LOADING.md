# Codex Task: Khắc phục regression loading lần đầu khi chuyển tab sau đăng nhập

## Bối cảnh

Repository:

- https://github.com/newstar94/Bidding
- Nhánh mục tiêu: nhánh hiện tại của repository (ưu tiên `main` nếu không có chỉ định khác).
- Khoảng commit cần điều tra kỹ: **20/08/2026 đến 27/08/2026**.

Hiện tượng thực tế được ghi lại bằng video ngày **27/08/2026**:

1. Sau khi đăng nhập/mở ứng dụng lần đầu, chuyển sang các tab dữ liệu như **Kế hoạch**, **Gói thầu**, v.v. thì bảng xuất hiện skeleton/loading trong một khoảng thời gian trước khi dữ liệu hiện ra.
2. Sau khi tab đó đã được mở ít nhất một lần, chuyển đi rồi quay lại thì dữ liệu hiển thị gần như ngay lập tức.
3. Trước các thay đổi gần đây, hành vi mong muốn là chuyển qua lại giữa các tab dữ liệu gần như tức thì ngay cả ở lần mở tab đầu tiên sau đăng nhập.

Quan sát từ video:

- Kế hoạch lần đầu: khoảng 0,5–0,6 giây mới có dữ liệu.
- Gói thầu lần đầu: khoảng 0,4 giây.
- Gói thầu lần sau: gần như tức thì.
- Kế hoạch lần sau: gần như tức thì.

Mục tiêu là **khôi phục trải nghiệm chuyển tab tức thì sau đăng nhập mà không làm tăng đáng kể thời gian startup/login**.

---

# 1. Yêu cầu bắt buộc trước khi sửa

Không được sửa theo phỏng đoán.

Trước tiên hãy:

```bash
git status
git log --since="2026-08-20" --until="2026-08-28" --oneline --decorate --stat
```

Sau đó điều tra history/diff/blame của ít nhất các file:

```text
frontend/app/BiddingController.js
frontend/app/BiddingControllerUI.js
frontend/app/BiddingView.js
frontend/app/BiddingModel.js
frontend/app/WorkflowModuleLoader.js

frontend/shared/tableDataUtils.js
frontend/shared/EntityTable.js
frontend/shared/virtualTable.js

frontend/plans/KeHoachView.js
frontend/packages/GoiThauView.js
frontend/packages/GoiThauTable.js

frontend/partners/PartnerView.js

vite.config.js
```

Dùng các lệnh phù hợp như:

```bash
git log -p -- <file>
git blame <file>
git log -S"useServerSidePagination" --all --oneline
git log -S"loadPaginatedRecords" --all --oneline
git log -S"renderTableLoading" --all --oneline
git log -S"hydrateRemainingStorageKeysIdle" --all --oneline
git log -S"ensureViewModules" --all --oneline
git log -S"modulePreload" --all --oneline
```

Đặc biệt kiểm tra các commit gần đây nếu tồn tại trong history:

```text
ee48d6d
54aa4de
8ed4510
f95e150
b30ecc2
```

**Không được mặc định các commit trên là nguyên nhân.** Chúng chỉ là manh mối. Phải dùng diff/blame để xác nhận.

---

# 2. Các fact đã xác định trong code hiện tại

Hãy kiểm tra lại các fact dưới đây trên working tree hiện tại trước khi sửa.

## 2.1. `switchTab()` có nhiều gate trước khi render

Trong `frontend/app/BiddingControllerUI.js`, `switchTab()` hiện kiểm tra theo thứ tự gần như:

```text
areViewModulesReady(tab)
    ↓ chưa
ensureViewModules(tab)
    ↓
workflowRequirementForRoute(...)
    ↓ chưa
ensureWorkflowRequirement(...)
    ↓
lazy tab partial tồn tại?
    ↓ chưa có DOM
ensureLazyTab(...)
    ↓
renderTabData(...)
```

Cần đo thời gian thực tế của từng gate thay vì kết luận gate nào chậm.

## 2.2. Kế hoạch và Gói thầu dùng chung view module

Trong `frontend/app/BiddingView.js`:

```js
kehoach -> ["plan"]
goithau -> ["plan"]
```

và module `plan` được dynamic import từ:

```js
import("./PlanView.js")
```

Điều này rất quan trọng:

**Video cho thấy sau khi Kế hoạch đã được mở, Gói thầu lần đầu vẫn còn loading.**

Do đó **dynamic import `PlanView.js` không thể là nguyên nhân duy nhất**.

Không được giải quyết bằng cách chỉ preload `PlanView`.

## 2.3. Kế hoạch/Gói thầu danh sách không phải lazy HTML partial

Kiểm tra `lazyTabPartials`.

Các tab detail/timeline/admin có thể dùng lazy partial, nhưng danh sách chính `kehoach` và `goithau` không nhất thiết đi qua `ensureLazyTab()`.

Do đó skeleton của danh sách Kế hoạch/Gói thầu phải được điều tra sâu hơn ở data/render layer.

## 2.4. Hai renderer đang hỗ trợ server-side pagination

`renderKeHoachTable()` và `renderGoiThauTable()` hiện có logic tương tự:

```js
if (this.model.useServerSidePagination) {
    renderTableLoading(...);

    const data = await loadPaginatedRecords(...);

    // render result
}
```

Đây là dấu hiệu rất quan trọng.

Trong `frontend/shared/tableDataUtils.js`, `loadPaginatedRecords()` hiện gọi:

```text
GET /api/paginate?... 
```

và cần kiểm tra xem có:

- response/query cache hay không,
- in-flight dedupe hay không,
- stale-while-revalidate hay không,
- prefetch first-page query hay không.

Nếu mỗi lần tab lần đầu phải chờ `/api/paginate`, đây có thể là nguyên nhân trực tiếp của skeleton trong video.

## 2.5. Model đã có IndexedDB hydration

`BiddingModel` đã có:

```js
hydrateRemainingStorageKeysIdle(...)
```

nhưng cần kiểm tra xem startup hiện tại có gọi nó sau first paint hay không.

`getStartupPriorityKeys()` cũng đã load nhiều key cần thiết cho Dashboard, gồm các nhóm dữ liệu như:

```text
KEHOACH
GOITHAU
HOPDONG
CHUDAUTU
NHATHAU
ASSIGNMENTS
```

Nếu dữ liệu đã tồn tại trong `model.state`/IndexedDB nhưng table renderer vẫn bắt buộc hiển thị skeleton rồi gọi `/api/paginate`, hãy đánh giá xem đây có phải regression kiến trúc gần đây không.

## 2.6. Không bật `modulePreload` toàn cục một cách mù quáng

`vite.config.js` hiện có:

```js
modulePreload: false
```

và comment liên quan CSP / Trusted Types.

Không được đơn giản đổi thành `true` nếu chưa chứng minh an toàn.

Không được phá CSP/Trusted Types để đổi lấy tốc độ.

---

# 3. Mục tiêu điều tra nguyên nhân gốc

Phải trả lời rõ các câu hỏi sau trước hoặc trong quá trình sửa:

1. Commit nào trong khoảng 20–27/08/2026 làm hành vi first-tab trở nên chậm thấy rõ?
2. Có phải hệ thống mới chuyển các bảng sang server-side pagination không?
3. `useServerSidePagination` được bật ở đâu, khi nào và vì sao?
4. Trước regression, lần đầu mở Kế hoạch/Gói thầu render từ local state/IndexedDB hay đã dùng API?
5. Có cache query/page trước đây nhưng bị xóa không?
6. Có post-startup prefetch/prewarm trước đây nhưng bị bỏ không?
7. Thời gian cold switch nằm chủ yếu ở:
   - dynamic JS import,
   - IndexedDB hydration,
   - `/api/paginate`,
   - DOM render,
   - icon/custom-select enhancement,
   - workflow import,
   - lazy partial,
   - hay background sync contention?
8. Có request nào sau login đang tranh tài nguyên/network/main-thread với lần click tab đầu không?

---

# 4. Bắt buộc thêm instrumentation để đo

Không dựa vào cảm giác.

Trong development hoặc khi bật:

```text
localStorage.bf_perf_debug = "true"
```

hoặc query:

```text
?bf_perf_debug=true
```

hãy bổ sung instrumentation nhẹ, có thể bỏ hoặc giữ ở chế độ debug sau khi hoàn tất.

Đo riêng:

```text
tab click
→ ensureViewModules
→ ensureWorkflowRequirement
→ ensureLazyTab
→ renderTabData start
→ loadPaginatedRecords start
→ response received
→ DOM table rendered
→ enhancement/icons completed
```

Mỗi measurement cần chứa tối thiểu:

```text
tabName
query/table
cold/warm
duration
cacheHit nếu có
prefetched nếu có
```

Ví dụ output mong muốn:

```text
[bf-perf] tab=goithau
viewModule=0ms
workflow=0ms
lazyPartial=0ms
data=312ms
render=18ms
total=336ms
cacheHit=false
```

Không spam console khi debug flag tắt.

---

# 5. Hướng sửa ưu tiên

Sau khi xác nhận root cause, ưu tiên kiến trúc sau.

## 5.1. Không block startup

Không preload đồng bộ tất cả module và tất cả dữ liệu trước khi ẩn loader.

Màn hình đầu tiên vẫn phải render nhanh.

Mọi prewarm bổ sung phải chạy:

- sau first route render,
- sau khi loader được ẩn hoặc không ảnh hưởng critical path,
- qua `schedulePostStartupTask()` / `requestIdleCallback`,
- có timeout/fallback hợp lý.

---

## 5.2. Hydrate local data còn lại sau startup

Nếu hiện tại `hydrateRemainingStorageKeysIdle()` chưa được gọi, tích hợp nó vào post-startup lifecycle.

Ví dụ ý tưởng, không copy máy móc:

```js
this.schedulePostStartupTask(() => {
    this.model.hydrateRemainingStorageKeysIdle(...);
});
```

Lưu ý tránh double scheduling vì method này tự có state `_remainingHydrationScheduled`.

Phải bảo toàn workspace isolation.

---

## 5.3. Prewarm các view module chính sau first paint

Có thể prewarm có kiểm soát:

```text
plan
partner
timeline
```

thông qua public API hiện có như `ensureViewModules(tabName)`.

Không import lại nếu module đã installed/pending.

Không làm startup chờ các promise này.

Ví dụ nhóm ưu tiên:

```text
kehoach        -> plan
goithau        -> plan (đã chung module)
chudautu       -> partner
nhathau        -> partner
chuyengia      -> partner
hopdong        -> partner
goithau-timeline -> timeline
```

Chỉ preload các module phù hợp quyền của user nếu hệ thống có RBAC.

---

# 6. Ưu tiên đặc biệt: loại bỏ blocking first-page API khi có thể

Đây là phần quan trọng nhất cần điều tra.

Nếu xác nhận skeleton chủ yếu đến từ:

```js
renderTableLoading()
await loadPaginatedRecords(...)
```

thì hãy thiết kế cache/prefetch đúng cách.

## Phương án ưu tiên: workspace-scoped paginated query cache + prefetch

Tạo query cache theo workspace và theo full normalized query.

Ví dụ key:

```text
table + page + pageSize + search + filters + sort + cursor + relevant scope fields
```

Không dùng key thiếu filter/sort vì sẽ trả sai dữ liệu.

Cache entry nên chứa tương đương:

```js
{
  items,
  totalItems,
  nextCursor,
  hasMore,
  fetchedAt
}
```

Cần hỗ trợ:

1. **cache hit trả ngay**;
2. **in-flight deduplication** cho cùng query;
3. cache nằm trong workspace scope hoặc bị clear khi workspace đổi;
4. không để response workspace cũ ghi vào workspace mới;
5. invalidation sau mutation/sync phù hợp;
6. có TTL hoặc stale policy rõ ràng;
7. filter/search/sort khác nhau không dùng nhầm cache.

Nếu phù hợp kiến trúc, thêm function riêng kiểu:

```js
prefetchPaginatedRecords(model, table, params)
```

để preload mà không render UI.

---

# 7. Preload first page các tab phổ biến sau login

Sau khi initial route đã render, có thể prefetch first-page query của các bảng chính:

```text
kehoach
goithau
chudautu
nhathau
chuyengia
hopdong
```

Nhưng:

- không làm tất cả request đồng thời vô hạn;
- dùng concurrency nhỏ, ví dụ 2;
- ưu tiên tab gần/quan trọng;
- dừng hoặc bỏ qua nếu workspace đổi/logout;
- không retry hung hăng;
- không cạnh tranh với critical startup/sync;
- nếu offline thì dùng local state/cache;
- không tải detail data hàng loạt.

Nếu app có nhiều dữ liệu, chỉ prefetch **page hiện tại/default first page**, không hydrate toàn bộ server database.

---

# 8. Render local/cached data ngay nếu đã có

Nếu model/IndexedDB đã có dữ liệu đủ để dựng first page, hãy đánh giá mô hình **stale-while-revalidate**:

```text
local/query-cache data
      ↓
render ngay
      ↓
background API revalidate
      ↓
chỉ update UI nếu response mới thực sự khác
```

Không được làm UI nhấp nháy:

```text
data → skeleton → data
```

Nếu đã có usable cached data thì **không được thay nó bằng skeleton chỉ để chờ refresh server**.

Tuy nhiên phải đảm bảo:

- sorting/filtering chính xác;
- quyền dữ liệu đúng workspace;
- server vẫn là nguồn authoritative;
- không hiển thị record từ organization/user khác;
- không phá pagination totals.

Nếu local state không đủ tin cậy cho query cụ thể, dùng prefetched query cache thay vì giả dữ liệu.

---

# 9. Hover/focus prefetch

Sau khi giải quyết data layer, thêm prefetch nhẹ khi người dùng có intent.

Trong `setupTabs()` hoặc sidebar lifecycle, khi:

```text
pointerenter
focus
touchstart phù hợp
```

trên nav button, có thể:

1. `ensureViewModules(targetTab)`;
2. preload lazy tab partial nếu tab đó thực sự dùng lazy partial;
3. prefetch first page data của tab nếu có mapping an toàn.

Không activate tab.

Không thay đổi URL.

Không render tab ẩn.

Không bind event trùng lặp.

Phải dedupe promise.

---

# 10. Không được làm các cách sau

Không chấp nhận giải pháp:

1. `setTimeout` giả để che loading.
2. Xóa skeleton nhưng vẫn block UI không phản hồi.
3. Preload toàn bộ application trước login.
4. Đổi tất cả dynamic import thành static import.
5. Bật `modulePreload: true` mà không xử lý CSP/Trusted Types.
6. Tắt server-side pagination toàn cục chỉ để hết loading nếu dữ liệu lớn cần pagination.
7. Cache không phân biệt workspace.
8. Cache không phân biệt query/filter/sort.
9. Dùng stale data vĩnh viễn và bỏ revalidation.
10. Catch lỗi rồi im lặng.
11. Thay đổi behavior của detail/create workflows không liên quan.
12. Rollback cả commit lớn nếu có thể sửa regression nhỏ và an toàn hơn.

---

# 11. Kiểm tra riêng `useServerSidePagination`

Tìm toàn bộ assignment/read:

```bash
rg -n "useServerSidePagination" .
```

Xác định:

- giá trị default;
- nơi bật `true`;
- lifecycle khi login;
- lifecycle sau initial sync;
- lifecycle khi workspace đổi;
- commit đã thay đổi behavior này.

Nếu regression bắt nguồn từ việc chuyển table list từ local render sang blocking server pagination, hãy giữ lợi ích của server pagination nhưng khôi phục UX bằng cache/prefetch/SWR thay vì rollback kiến trúc một cách mù quáng.

---

# 12. Invalidation sau mutation

Nếu thêm paginated cache, mọi mutation liên quan phải invalid cache đúng scope.

Tối thiểu xem xét:

```text
create/update/delete kế hoạch
create/update/delete gói thầu
chủ đầu tư
nhà thầu
chuyên gia
hợp đồng
background sync
workspace switch
logout
organization switch
conflict resolution
restore/cancel package
version changes
```

Có thể invalidate theo table thay vì clear toàn bộ cache.

Sau mutation:

- UI hiện tại phải phản ánh thay đổi ngay;
- lần quay lại tab không được hiện dữ liệu cũ sai;
- revalidation có thể chạy background.

---

# 13. Race condition khi chuyển tab nhanh

Code hiện có `_tabTransitionVersion`.

Phải giữ nguyên hoặc cải thiện guard này.

Test tình huống:

```text
click Kế hoạch
ngay lập tức click Gói thầu
ngay lập tức click Nhà thầu
```

Response chậm của tab cũ không được:

- activate tab cũ,
- overwrite DOM của tab hiện tại,
- đổi title,
- làm sai URL,
- ghi data vào workspace sai.

---

# 14. Test bắt buộc

Tìm test framework hiện có và bổ sung test đúng style repo.

Ít nhất cần có coverage cho:

## A. View module cache

- cùng module không import 2 lần;
- `kehoach` rồi `goithau` không tải `plan` lần thứ hai.

## B. Paginated query cache nếu triển khai

- same query → cache hit;
- same in-flight query → một network request;
- khác page → cache khác;
- khác search → cache khác;
- khác filter → cache khác;
- khác sort → cache khác;
- workspace đổi → không dùng cache workspace cũ;
- TTL/invalidation hoạt động.

## C. Post-startup warming

- warming không block initial route;
- task lỗi không phá app;
- user chuyển tab trong lúc prefetch đang chạy vẫn dùng cùng promise;
- logout/workspace switch không gây stale update.

## D. Navigation

Cold session:

```text
login
→ initial screen rendered
→ post-startup warm finishes
→ click Kế hoạch
→ click Gói thầu
→ click Chủ đầu tư
→ click Nhà thầu
```

Mục tiêu:

- không xuất hiện skeleton kéo dài do blocking fetch nếu dữ liệu đã prefetched/cached;
- chuyển tab cảm nhận tức thì;
- không phát sinh duplicate blocking request cho query đã prefetch.

## E. Filters

Sau khi tab đã instant:

```text
search
filter
sort
page 2
```

vẫn phải tải đúng dữ liệu.

Không được vì cache mà trả page/filter sai.

## F. Offline

Nếu có local workspace snapshot:

- tab vẫn mở được với local data;
- không crash vì prefetch fail;
- banner offline vẫn hoạt động.

---

# 15. Performance acceptance criteria

Đo trên development/prod-like build với cùng dataset.

Sau login, khi background warm đã có cơ hội chạy:

### Main tabs đã warm

Mục tiêu:

```text
click → meaningful table content <= 100 ms
```

trên máy/network test bình thường.

Lý tưởng là trong 1–2 animation frames nếu cache đã sẵn sàng.

### Cold click trước khi prewarm hoàn thành

Không yêu cầu phép màu, nhưng:

- tận dụng in-flight prefetch;
- không duplicate request;
- giữ UI responsive;
- nếu local cache có dữ liệu thì render nó ngay thay vì skeleton.

### Startup

Không được làm `loader:hidden` chậm đáng kể.

So sánh startup metrics trước/sau.

Nếu time-to-hide-loader tăng > 5–10% cần giải thích và tối ưu lại.

---

# 16. Build và quality gate

Chạy các command repo cung cấp, tối thiểu tương đương:

```bash
npm test
npm run lint
npm run build
```

Nếu project có test riêng cho frontend/e2e/security, chạy thêm.

Build production/secure nếu repo hỗ trợ và kiểm tra:

- CSP;
- Trusted Types;
- dynamic imports;
- code splitting;
- no console errors;
- no unhandled promise rejection.

Không sửa `vite.config.js` chỉ để pass tạm.

---

# 17. Deliverables cuối cùng

Sau khi sửa, hãy trả về báo cáo gồm:

## Root cause

Viết rõ:

```text
Nguyên nhân gốc:
Commit gây/thúc đẩy regression:
Đường code gây delay:
Thời gian đo trước sửa:
```

Nếu có nhiều nguyên nhân, phân tỷ trọng dựa trên measurement.

## Files changed

Liệt kê từng file và lý do.

## Solution

Giải thích:

- module warming;
- data hydration;
- query cache/prefetch;
- stale-while-revalidate nếu có;
- cache invalidation;
- race protection.

## Tests

Liệt kê command và kết quả.

## Performance

Bảng trước/sau:

| Case | Before | After |
|---|---:|---:|
| First Kế hoạch | ... ms | ... ms |
| First Gói thầu | ... ms | ... ms |
| First Chủ đầu tư | ... ms | ... ms |
| Repeat tab | ... ms | ... ms |
| Startup loader hidden | ... ms | ... ms |

## Regression risk

Nêu các rủi ro còn lại, nếu có.

---

# 18. Definition of Done

Chỉ xem là hoàn tất khi đồng thời thỏa:

- [ ] Đã truy history 20–27/08/2026 và xác định nguyên nhân bằng evidence.
- [ ] Không còn coi `PlanView` dynamic import là nguyên nhân duy nhất.
- [ ] Đã đo riêng data/API/render/module time.
- [ ] First visit các main tab sau startup warm gần như tức thì.
- [ ] Repeat visit vẫn tức thì.
- [ ] Startup/login không bị chậm đáng kể.
- [ ] Không phá server-side pagination.
- [ ] Không phá CSP/Trusted Types.
- [ ] Không leak cache giữa workspace/user/organization.
- [ ] Không duplicate request khi prefetch và click xảy ra đồng thời.
- [ ] Search/filter/sort/pagination vẫn đúng.
- [ ] Mutation invalidates cache đúng.
- [ ] Rapid tab switching không gây stale render.
- [ ] Offline/local snapshot vẫn hoạt động.
- [ ] Tests/lint/build pass.

---

# 19. Ưu tiên ra quyết định

Thứ tự ưu tiên:

```text
Correctness
→ workspace/data isolation
→ instant tab UX
→ startup performance
→ network efficiency
→ bundle optimization
```

Không đánh đổi correctness hoặc tenant/workspace isolation chỉ để giảm vài trăm mili-giây.

---

# 20. Gợi ý giả thuyết cần xác nhận

Giả thuyết hiện tại mạnh nhất là:

```text
Sau các thay đổi gần đây, các list view sử dụng server-side pagination
và renderTableLoading() trước khi await /api/paginate.

Startup có local IndexedDB/priority data nhưng list renderer không tận dụng
dữ liệu đó để first-render hoặc chưa prefetch exact paginated query.

Vì vậy:
first visit = blocking network/data initialization → skeleton
later visit = module/data/connection/cache đã warm → cảm giác instant.
```

Đồng thời dynamic JS import vẫn có thể cộng thêm delay cho **tab đầu tiên của từng module group**, nhưng video chứng minh nó không giải thích toàn bộ vấn đề vì `kehoach` và `goithau` dùng chung `plan` module.

**Hãy chứng minh hoặc bác bỏ giả thuyết này bằng instrumentation + git history trước khi chốt patch.**

---

# 21. Yêu cầu thực thi

Bạn có quyền chỉnh sửa code trực tiếp.

Không dừng ở phân tích hoặc đề xuất.

Hãy:

1. điều tra;
2. đo;
3. xác định root cause;
4. implement fix tối thiểu nhưng đúng kiến trúc;
5. thêm tests;
6. chạy quality gates;
7. tự review diff;
8. báo cáo kết quả cuối cùng.

Nếu trong lúc điều tra phát hiện nguyên nhân khác với giả thuyết trên, **ưu tiên evidence từ code/runtime và sửa nguyên nhân thật**.
