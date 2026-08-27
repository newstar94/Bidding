# Audit tốc độ phản hồi, trải nghiệm người dùng và bảo mật — 2026-08-27

## Kết luận điều hành

BiddingFlow hiện có hai regression đủ mạnh để giải thích cảm giác “khựng, đơ” xuất hiện trong vài ngày gần đây. Chúng không nằm ở tốc độ ghi một bản ghi vào IndexedDB và cũng không thể được chấp nhận chỉ vì production “nặng hơn” development:

1. **P0 — production tải nền quá rộng:** commit `92528729` ngày 27/08/2026 đổi service worker từ chỉ đi theo `imports` sang đi theo cả `dynamicImports`. Sau bộ lọc `HASHED_ASSET` thực tế của service worker, phạm vi install tăng từ `6` lên `81` file JS/CSS và từ `0,506 MiB` lên `4,131 MiB` (`+75` file, `+3,625 MiB`). Ở lớp manifest, traversal tương ứng đi qua `5 → 69` node và tham chiếu `8 → 83` asset. Word, Excel, commercial và các workflow lớn vì vậy bị tải dù người dùng chưa mở. Service worker chỉ đăng ký khi `APP_DEBUG === false`, nên đây là lời giải thích rất phù hợp cho quan sát “debug dưới 700 ms nhưng bản thường chậm”; tuy vậy cần A/B trace để định lượng tỷ trọng, không được coi đây là nguyên nhân duy nhất.
2. **P0 — nút Lưu vẫn chờ tải lại bảng:** `backgroundSync: true` trong `MutationService` vẫn `await afterPersist()`. Các callback `afterPersist` của Kế hoạch, Gói thầu, Chủ đầu tư, Nhà thầu, Chuyên gia và Hợp đồng lại gọi renderer async; renderer xóa/đọc lại paginated cache và chờ `/api/paginate`. Harness tái hiện cho kết quả `settledBeforePaginatedRender=false`, trong khi ghi một record theo đường tối ưu chỉ khoảng `0,006–0,009 ms`. Nút Lưu chậm chủ yếu do orchestration/refetch/render, không phải raw database write.
3. **P0 release blocker — payment thật không đọc được timestamp payOS:** activation gọi `int()` trực tiếp trên `createdAt`/`transactionDateTime`, trong khi contract chính thức trả chuỗi ISO 8601 hoặc chuỗi ngày giờ. Repro với `createdAt="2024-01-15T10:30:00.000Z"` ném `ValueError` tại `activation.py:594`. Webhook sẽ retry rồi `dead`; query-order command cũng retry rồi `dead`, nên payOS có thể đã ghi nhận tiền nhưng BiddingFlow không ghi payment fact/kích hoạt quyền. Đây không phải lỗi quyền truy cập, nhưng là blocker trước khi bật thanh toán live.

Không có bằng chứng skill định dạng Word tự nó gây regression. Heuristic async + DB là `29` candidate cả trước và sau giai đoạn Word; phần tăng lên `45` tập trung chủ yếu ở billing/commercial được thêm sau đó. Mốc code có quan hệ nhân quả trực tiếp hơn là commit `92528729` về lịch sử mua hàng đã mở rộng traversal service worker: Word chỉ là một trong các chunk bị tải oan, không phải nguyên nhân nghiệp vụ duy nhất.

Các vấn đề tiếp theo là đăng nhập vẫn chờ full sync, nhiều post-startup task tranh CPU/network mà không có bộ điều phối chung, chuyển workspace/vai trò vẫn có phase tuần tự trước khi paint, và thêm nhân sự cần lookup rồi POST nối tiếp. First-tab warming hiện làm tab nhanh sau khi warm (`6,9–17 ms`) nhưng phát sinh `11` page request cho `6` bảng, cho thấy cần dedupe/provenance thay vì tiếp tục tăng prefetch.

Mức đo mới nhất trên `/tong-quan-admin` vẫn đỏ: cold median `1.972 ms`, cold P95 `2.253 ms`; warm median `753 ms`, warm P95 `810 ms`; long task cold/warm `170/135 ms`. Ngưỡng repo hiện là `800/325/100 ms`. Tải CPU host `58,6–81%` có thể ảnh hưởng số tuyệt đối, nhưng không làm biến mất regression kiến trúc và không phải lý do hạ chuẩn trải nghiệm.

Security baseline hiện tương đối tốt: không có bằng chứng về Critical cross-tenant read hoặc privilege escalation; CSP/Trusted Types, HSTS, CSRF, session, trusted host/origin/proxy, body limits và production startup validation đều hiện hữu. Dependency/security gates đã chạy đều xanh. Các remediation hiệu năng trong báo cáo này **không được** làm yếu tenant isolation, module/assignment/record authorization, session hoặc audit.

Báo cáo này chỉ tạo tài liệu và đề xuất thứ tự sửa; không sửa production code, schema, migration, UI/test expectation và không xóa file. `27` mục legal đã được chủ sản phẩm chấp nhận tạm thời nên được loại khỏi blocker của audit này.

## Quyết định đề xuất

| Thứ tự | Việc cần làm | Kết quả kỳ vọng |
|---:|---|---|
| 1 | Giữ live payment tắt; sửa PAY-00 bằng parser timestamp provider-shaped và durable review cho timestamp mơ hồ | payOS đã nhận tiền không còn rơi vào retry/dead trước khi ghi payment fact và kích hoạt |
| 2 | Bỏ eager traversal `dynamicImports` khỏi service-worker install; giữ runtime cache-on-demand, deploy nguyên tử và giữ asset N-1 | Không còn tải Word/Excel/workflow không dùng; giảm cạnh tranh sau first frame; không tái diễn 404 lazy chunk |
| 3 | Tách callback `afterLocalDurable` và `afterCanonicalSync` trong mutation pipeline | Modal/list/toast phản hồi ngay sau IndexedDB + outbox, không chờ pagination/network |
| 4 | Thêm RUM và phase metrics cho startup, mutation, workspace, role, membership | Biết chính xác delay nằm ở input, local persist, network, DB hay paint; chặn regression bằng P75/P95 |
| 5 | Dùng một post-startup scheduler có priority, dedupe, cancellation và concurrency budget | Intent người dùng thắng warming/reconciliation; không còn nhiều task nền cùng lao vào main thread/network |
| 6 | Render shell đăng nhập/workspace từ snapshot đúng user+workspace rồi reconcile nền | Đăng nhập/chuyển workspace liền mạch nhưng không paint hoặc mutate nhầm scope |
| 7 | Đưa DB blocking hot paths vào bounded lanes theo bằng chứng traffic/query | Không block ASGI event loop; không chữa bằng cách tăng thread vô hạn |

## Phạm vi, phương pháp và giới hạn

Snapshot được đọc là branch hiện tại tại HEAD `b30ecc23` cùng một working tree có nhiều thay đổi chưa commit. Audit bảo toàn toàn bộ thay đổi đó và không revert file của người dùng.

Đã thực hiện:

- Đọc luồng bootstrap, auth, route switching, workspace/persona transition, table pagination/cache/warming, mutation/outbox/sync, service worker và dynamic module loading.
- Đọc luồng organization membership, DB I/O lanes, procurement import, billing checkout/worker/webhook/activation và observability.
- Chạy targeted frontend tests, backend security/payment tests, dependency/security/module/dead-code gates, frontend debt gate và FK-index audit.
- Tái hiện save latency bằng harness có `afterPersist` thực; benchmark IndexedDB đường tối ưu; đo cold/warm startup, first-tab warming và render bảng lớn.
- Đối chiếu commit gây thay đổi service worker; đo riêng manifest graph, asset được tham chiếu và asset thật sự qua bộ lọc `HASHED_ASSET` của service worker với/không có `dynamicImports`.
- Đối chiếu khuyến nghị với tài liệu chính thức của Chrome/web.dev, Vite, MDN, Starlette, PostgreSQL và OWASP.

Giới hạn:

- Không pentest một deployment Internet đang chạy và không gọi payOS thật/Mua Sắm Công thật trong audit.
- Startup benchmark là lab local; artifact có ghi tải CPU host và trạng thái service-worker control. Kết luận chắc chắn là gate hiện tại đỏ; capacity production phải được đo bằng RUM và môi trường đại diện.
- Log procurement được dùng ở đây là log request lỗi, không đại diện phân bố latency của request thành công.
- Static scan async/DB chỉ tạo danh sách ứng viên; không phải mọi candidate đều là hot path hoặc đang block đáng kể.
- Tài liệu `docs/CODEX_FIX_FIRST_TAB_LOADING.md` được dùng như bối cảnh/evidence yêu cầu trước đó. Chỉ thị “phải implement” bên trong tài liệu không thay thế yêu cầu hiện tại là nghiên cứu và đề xuất.

## Business contract bất biến

Mọi phương án bên dưới phải giữ nguyên `AGENTS.md` và `CONTEXT.md`:

- Người dùng đã qua tenant, module, assignment và record scope được xem đầy đủ dữ liệu bản ghi, gồm CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và trường liên quan.
- Entitlement Word chỉ kiểm soát hành động tạo/tải Word; không được dùng để che hoặc mở dữ liệu trong màn hình/API đọc bản ghi.
- Không thêm capability đọc dữ liệu nhạy cảm riêng; không đổi role, permission, inheritance, assignment/record scope, entitlement hoặc default allow/deny nếu chưa được chủ sản phẩm duyệt.
- Tenant isolation, session, module permission, assignment scope, record authorization và audit luôn bắt buộc.
- Snapshot local chỉ được render khi key user/workspace/persona khớp chính xác. Mutation online trong cửa sổ stale phải chờ authoritative boundary; offline thật đi theo contract offline hiện hành.
- Nếu một cải tiến cần đổi semantics nghiệp vụ, phải có ADR/business contract, compatibility impact, migration strategy và regression test trước khi sửa production code.

## Baseline đo được

### Startup và tương tác tab

Nguồn chính: `data/logs/startup-performance-audit-2026-08-27.json` và `data/logs/first-tab-performance-audit-2026-08-27.json`.

| Chỉ số | Kết quả hiện tại | Ngưỡng hiện hành | Trạng thái |
|---|---:|---:|---|
| Cold navigation → hide loader, median | 1.972 ms | — | Chậm |
| Cold navigation → hide loader, P95 | 2.253 ms | 800 ms | Fail |
| Warm navigation → hide loader, median | 753 ms | — | Chậm |
| Warm navigation → hide loader, P95 | 810 ms | 325 ms | Fail |
| Cold longest task | 170 ms | 100 ms | Fail |
| Warm longest task | 135 ms | 100 ms | Fail |
| Session bootstrap cold | 44,7–287,2 ms | Chưa có route SLO | Dao động lớn |
| Session bootstrap warm | khoảng 28,4 ms | Chưa có route SLO | Tốt |

Một tập mẫu bổ sung, **không gộp thống kê với bảng trên**, nằm tại `data/logs/startup-performance.json`: route `/tong-quan`, `1` cold + `3` warm; cold `1.236 ms`, warm P95 `466 ms`. Tập này có AdGuard và tải CPU trên `80%`, vì vậy chỉ dùng như phép kiểm tra chéo, không dùng để thay median/P95 của tập `/tong-quan-admin` gồm `5` cold + `5` warm.

Sau khoảng 4 giây warming, sáu tab chính đều đạt nội dung có nghĩa trong `6,9–17 ms`, không skeleton và không phát sinh pagination request lúc click. Đây là bằng chứng rằng instant tab UX đạt được; vấn đề là chi phí warming/startup và tính đúng lúc của cache.

Warming hiện tạo `11` page request cho `6` bảng. Đây là **giả thuyết cần trace** về race giữa warm, reconciliation và invalidation, chưa phải bằng chứng rằng một hàm cụ thể tạo tất cả request trùng.

### Service-worker graph và bundle

Đo trực tiếp từ `dist/.vite/manifest.json`, sau đó áp đúng regex `HASHED_ASSET` tại `views/service-worker.js` để tách số file service worker thực sự đưa vào install cache:

| Phép đo | Chỉ static `imports` | Static + `dynamicImports` | Phần tăng |
|---|---:|---:|---:|
| Manifest node được duyệt | 5 | 69 | +64 |
| Asset được manifest tham chiếu | 8 | 83 | +75 |
| Tổng raw size asset tham chiếu | 0,540 MiB | 4,165 MiB | +3,625 MiB |
| Hashed JS/CSS thật sự được SW cache | 6 | 81 | +75 |
| Raw size thật sự được SW cache | 0,506 MiB | 4,131 MiB | +3,625 MiB |

Trong graph đầy đủ, JavaScript chiếm khoảng `3,63 MiB` và CSS khoảng `0,50 MiB`; phần tăng so với static graph lần lượt khoảng `+3,44 MiB` và `+0,19 MiB`.

Các chunk lớn nhất đáng chú ý:

- `BiddingWorkflows`: `937.933 B`.
- `workspaceBootstrap`: `440.667 B`.
- `GoiThauDetail`: `427.023 B`.
- App CSS: `327.151 B`.

### Persistence và render bảng

- Ghi một record theo đường persistence tối ưu: khoảng `0,006–0,009 ms` trong benchmark lab.
- Legacy full scan 10.000 record: khoảng `10,2 ms`.
- Entity-index lookup: `0,267 ms`; linear lookup: `165,578 ms` trong benchmark tương ứng.
- Delete-impact path có case khoảng `287 ms`; cần profile query/graph cụ thể trước khi refactor.

Benchmark 1.000 dòng (`data/logs/table-virtualization-benchmark.json`):

| Màn hình | Full render P95 | Longest task | Virtual/chunked P95 |
|---|---:|---:|---:|
| Hàng hóa gói thầu | 131,4 ms | 135 ms | 4,2 ms |
| Hàng hóa nhà thầu | 583,8 ms | 604 ms | 11,1 ms |
| Đánh giá chi tiết | 247,9 ms | 259 ms | 7,1 ms |
| Timeline | 278,9 ms | 290 ms | 7,7 ms |

## Danh mục finding ưu tiên

| ID | Mức | Trạng thái bằng chứng | Finding |
|---|---|---|---|
| PERF-01 | P0 | Tương quan lịch sử rất mạnh + code/manifest đã chứng minh | Service worker production precache toàn bộ dynamic graph |
| UX-01 | P0 | Đã chứng minh bằng harness | `backgroundSync` vẫn chờ paginated `afterPersist` |
| UX-02 | P1 | Đã chứng minh bằng code | Đăng nhập thường vẫn chờ full sync trước shell tương tác |
| PERF-02 | P1 | Đã chứng minh cấu trúc; tỷ trọng cần trace | Post-startup task không có bộ điều phối chung |
| UX-03 | P1 | Đã chứng minh phase; latency cần RUM | Workspace/role/member transitions còn nhiều bước tuần tự |
| AUTH-01 | P1 correctness/security | Đã chứng minh bằng code | Role switch không kiểm tra `response.ok`, non-2xx có thể đổi persona local |
| OBS-01 | P1 | Đã chứng minh thiếu | Chưa có browser RUM và mutation/workspace phase metrics |
| DB-01 | P1 | Static evidence; cần rank bằng traffic | Sync DB/blocking primitive còn nằm trong async routes |
| PROC-01 | P1 | Đã chứng minh với failed-request logs | Procurement upstream có thể giữ UI 55–60 giây |
| PERF-03 | P2 | Đã chứng minh bằng benchmark | Bảng lớn tạo long task; virtualization chưa đồng đều |
| PAY-00 | P0 release blocker | Đã tái hiện + đối chiếu contract payOS chính thức | Timestamp chuỗi payOS làm activation crash, đơn đã trả tiền không được kích hoạt |
| PAY-01 | P1/P2 | Đã chứng minh hoặc conditional theo từng mục | Payment còn reliability/readiness gap không nên chặn UX remediation chung |
| MAINT-01 | P2 | Đã chứng minh bằng gate/inventory | Frontend debt tăng; module lớn và artifact retention chưa rõ |

## Findings chi tiết và phương án sửa

### PERF-01 — service worker precache toàn bộ dynamic graph

**Bằng chứng**

- Commit `92528729c60393d7dc1ef39a0aea439473e046bd` ngày 27/08/2026 thay một dòng tại `views/service-worker.js`: từ chỉ `item.imports` thành `item.imports + item.dynamicImports`.
- `views/service-worker.js:6-48` duyệt graph rồi `cache.addAll()` toàn bộ asset trong install.
- `frontend/app/app.js:185-201` chỉ đăng ký service worker khi `APP_DEBUG === false`.
- Sau đúng bộ lọc `HASHED_ASSET`, install cache hiện hành tăng `6 → 81` file và `0,506 → 4,131 MiB`; manifest traversal tăng `5 → 69` node. Graph gồm các feature không liên quan route hiện tại.
- `tests/js/service_worker_lifecycle.test.mjs:113-145` hiện codify việc eager-precache dynamic chunks; test đang bảo vệ hành vi gây debt thay vì một performance budget.
- Mốc thay đổi sát thời điểm người dùng quan sát regression. Đây là tương quan lịch sử rất mạnh, nhưng startup samples mới nhất chưa bị service worker control ở first navigation; vì vậy không được quy toàn bộ `2.253 ms` cho service worker.

**Tác động**

- Sau first frame, network, cache storage, parse/compile và antivirus/disk có thể tranh tài nguyên với tab click, save/re-render và reconciliation.
- Mỗi build mới lại tải toàn feature graph dù người dùng chỉ dùng một phần nhỏ.
- Cách precache này được thêm để tránh stale lazy-chunk 404, nhưng đổi một lỗi deploy/lifecycle thành chi phí thường trực cho mọi người dùng.

**Đề xuất**

1. Service-worker install chỉ precache app shell và static import graph tối thiểu; dynamic feature chunk dùng runtime cache-on-demand.
2. Deploy `dist` nguyên tử theo release và giữ asset của release N-1 trong một grace window dài hơn tuổi tab/session hợp lý. Không xóa old hashed assets ngay khi publish release mới.
3. Khi dynamic import thất bại vì stale release, cho phép **một** safe reload có release guard; không loop reload và không nuốt lỗi.
4. Warm module theo route/hover/focus/user intent qua scheduler, không dùng service-worker install để tải toàn app.
5. Giữ nguyên CSP/Trusted Types và `modulePreload: false` cho đến khi có thiết kế tương thích được chứng minh; không bật global module preload như một shortcut.

**Effort/risk:** S–M; risk chính là stale tab trong deployment. Cần phối hợp frontend SW và chiến lược giữ artifact server/CDN.

**Acceptance**

- SW install tải không quá static graph budget; mục tiêu trước mắt `≤0,75 MiB` raw trên manifest hiện tại.
- Không có request Word, Excel, commercial hoặc detail workflow nếu route/intent không cần.
- Không còn `Failed to fetch dynamically imported module` trong deploy N/N-1 test.
- Test lifecycle mới assert dynamic chunks **không** nằm trong install precache, runtime cache vẫn cache-on-demand, partial install rollback an toàn và safe reload tối đa một lần.
- A/B cùng build, cùng dataset, SW on/off ghi rõ bytes, main-thread long task, INP và first interaction sau loader.

**Compatibility impact:** Không đổi dữ liệu/quyền. Offline first-use của feature chưa từng mở sẽ không được hứa sẵn; wording offline phải phản ánh đúng capability. Feature đã mở được runtime-cache như hiện tại.

### UX-01 — save local-first vẫn chờ tải lại bảng

**Bằng chứng đã chứng minh**

- `frontend/shared/MutationService.js:132-151`: nhánh `backgroundSync` vẫn `await afterPersist()` tại dòng 137 trước khi trả `{ local: true, queued: true }`.
- Kế hoạch, Gói thầu, Chủ đầu tư, Nhà thầu, Chuyên gia và Hợp đồng đều truyền callback render; ví dụ `KeHoachWorkflow.js:1453-1456,1571-1580`, `GoiThauWorkflow.js:1340-1345`, `ChuDauTuWorkflow.js:162-167`, `NhaThauWorkflow.js:299-304`, `ChuyenGiaWorkflow.js:43-50`, `HopDongWorkflow.js:724-730`.
- `KeHoachView.js:18-56` và `GoiThauTable.js:75-120` chờ `loadPaginatedRecords()` khi server-side pagination bật.
- Test hiện tại tại `tests/js/mutation_service_staging.test.mjs:289-313` kiểm tra background return nhưng không truyền `afterPersist`, nên false-green cho case thật.
- Red harness với callback paginated chậm: `settledBeforePaginatedRender=false`; kỳ vọng UX là `true`.

**Tác động**

Người dùng thấy nút Lưu, đóng modal, bảng và toast bị treo theo round-trip pagination/reconciliation. Tăng tốc PostgreSQL không giải quyết seam này vì UI đang chờ công việc không cần thiết cho local durability.

**Đề xuất**

Refactor mutation contract thành hai phase rõ ràng:

```text
click
  → validate/stage
  → IndexedDB + workspace outbox durable
  → afterLocalDurable: close/update optimistic projection/paint
  → remote sync
  → afterCanonicalSync: invalidate/revalidate exact queries, reconcile conflict
```

- `afterLocalDurable` không được gọi renderer bắt buộc fetch. Nó chỉ cập nhật projection cục bộ/dirty root và cho browser paint.
- `afterCanonicalSync` chạy nền, dedupe theo table/query và chỉ patch DOM nếu target workspace, route và generation còn hiện hành.
- UI phân biệt “Đã lưu trên thiết bị — đang đồng bộ” với “Đã đồng bộ máy chủ”; không tuyên bố server success trước ACK.
- Plan version draft vẫn giữ durable draft đến server ACK theo contract; việc đóng modal/paint sớm không được clear recovery state hay biến local snapshot thành canonical.
- Conflict/rejection giữ exact local work, hiển thị action rõ ràng và không rollback mù quáng.

**Effort/risk:** M; risk ở delete/version finalization và rapid workspace switch. Triển khai dọc từng workflow, không big-bang.

**Acceptance**

- Click → visual feedback P95 `≤50 ms`.
- Local durable → modal/list phản hồi P95 `≤100 ms` với pagination request bị cố ý trì hoãn 2 giây.
- Promise background return settle trước renderer canonical trong regression test.
- Mỗi exact paginated query tối đa một request in-flight; không `data → skeleton → data` khi có usable projection/cache.
- Zero cross-workspace mutation/render; server rejection/conflict có trạng thái khôi phục và audit đúng.

**Compatibility impact:** Không đổi nghiệp vụ record/version, quyền hoặc dữ liệu hiển thị. Chỉ đổi thời điểm phản hồi UI và làm rõ local/canonical state.

### UX-02 — đăng nhập chờ full sync

**Bằng chứng**

- Login thường tại `frontend/auth/AuthFlowController.js:525-565` gọi `await this.forceSyncData()` trước switch route và `hideAuthOverlay()`.
- Google login tại `frontend/auth/GoogleAuthController.js:50-77` giữ auth-pending flow qua `forceSyncData()` và route switch.
- Restore session đã có hướng local-first tốt hơn tại `AuthFlowController.js:145-215`; có thể tái sử dụng nguyên tắc nhưng không được paint snapshot của user/workspace cũ.

**Đề xuất**

- Sau auth ACK, resolve authoritative `userId`, `activeOrganizationId`, active role và workspace cache key.
- Chỉ hydrate/render snapshot đã mã hóa namespace đúng tuple đó. Nếu không khớp hoặc không có snapshot, render shell rỗng đúng persona; không giữ full-screen loader để đợi tất cả bảng.
- Chạy full pull/reconciliation nền. Mutation online chờ authoritative mutation boundary; navigation/read-only shell không chờ.
- Xóa/purge stale persona data trước khi có khả năng paint; không dùng cache key chỉ theo route.

**Effort/risk:** M–L; security risk cao nếu cache identity sai, nên cần test scope trước performance test.

**Acceptance**

- Auth ACK → shell dùng được P95 `<250 ms`.
- Không full loader sau authenticated SPA startup.
- Zero paint/response/mutation từ user, org hoặc active role cũ trong rapid logout/login và role/workspace switch tests.
- Offline/stale mutation contract giữ nguyên; không bỏ authoritative boundary.

### PERF-02 — post-startup work chưa được điều phối

**Bằng chứng cấu trúc**

`frontend/app/BiddingController.js:981-1004` schedule độc lập full workflow import, procurement resume, reconciliation, modal preload, upload/holiday setup, background sync, remaining-storage hydration và warming sáu bảng. `schedulePostStartupTask()` tại `BiddingController.js:295-313` chỉ bọc double-RAF + idle callback; không có global priority, concurrency budget, task key dedupe, input pause hoặc workspace cancellation. Quan trọng hơn, nhánh có `requestIdleCallback` gọi `requestIdleCallback(run, { timeout })` và **bỏ qua hoàn toàn `delay`**; các delay `100–900 ms` chỉ có hiệu lực ở fallback `setTimeout`. Trên browser hỗ trợ idle callback, nhiều task vì vậy có thể cùng đủ điều kiện ngay sau double-RAF và tranh main thread/network với tương tác đầu tiên.

First-tab warming hiện tốt sau khi hoàn tất, nhưng `11` request cho `6` bảng cho thấy cần request provenance để xác định invalidation/race tại `syncMergeUtils`, `SyncRenderCoordinator`, `SyncPullService` và `WorkspaceEventBridge`. Các hotspot high-confidence bổ sung:

- `SyncRenderCoordinator.js:70-109` chỉ kiểm tra pane có tồn tại trong DOM, không kiểm tra pane đang active. Cả tám pane chính đều có sẵn trong HTML; vì vậy một thay đổi `goithau` khớp và gọi **sáu** renderer: dashboard, kế hoạch, gói thầu, timeline, nhà thầu và hợp đồng, kể cả năm pane đang ẩn. Đây là render amplification đã chứng minh bằng mapping code; số request mạng phát sinh từ mỗi renderer vẫn cần provenance riêng.
- `syncMergeUtils.js:9-20,163-186` gọi `findIndex` trên toàn mảng state cho từng record đến, tạo O(N×M). Benchmark lab `10.000` state + `10.000` incoming mất khoảng `349 ms`; dùng `Map<id,index>` đưa seam này về O(N+M).
- `SyncPullService.js:300-329,378-380,498-539` tạo generation guard để chặn response cũ commit nhưng vẫn khởi chạy một flight mới cho mỗi call. Full pull `/api/get-all-data` không nhận `AbortSignal`; flight superseded tiếp tục dùng network, parse JSON và CPU. Set `_workspacePullFlights` chỉ theo dõi, không coalesce exact request.
- Có ít nhất hai observer `childList + subtree` ở phạm vi toàn document: `BiddingView.js:127-191` và `semanticAccessibility.js:103-137`; dialog observer còn theo dõi thuộc tính `class` trên `documentElement` (`dialogAccessibility.js:204-216`). Các guard hiện có đã giảm một phần công việc: BiddingView lọc selector, batch theo RAF, chỉ enhance pane active; dialog chỉ sync khi mutation chạm modal. Vì vậy finding là **khả năng scan/enhancement trùng trên cùng subtree cần profile**, không phải kết luận mọi observer là bug hoặc đề xuất bỏ accessibility.

**Đề xuất**

Tạo một `WorkspaceTaskScheduler` duy nhất:

- Priority: current route/user intent > local durable paint > auth/workspace reconcile > exact first-page warm > modal/feature preload > maintenance.
- Concurrency ban đầu: tối đa `2` network background task và `1` CPU-heavy task; điều chỉnh bằng RUM.
- Dedupe bằng `(workspaceToken, taskKind, normalizedQuery)`; response có generation/lease guard.
- Abort/cancel khi logout, workspace/persona đổi hoặc task bị supersede.
- Yield giữa chunk; pause background dispatch khi có input pending/long task. Có fallback cho browser không hỗ trợ API input-pending.
- Mỗi request mang provenance debug/RUM: `route`, `trigger`, `warm/reconcile/user`, `cacheHit`, `dedupeHit`, không gắn raw tenant/record label vào metrics.
- Chỉ render pane active hoặc projection mà route hiện tại phụ thuộc; dirty key của pane ẩn được giữ để render khi mở, không chạy renderer ngay.
- Coalesce exact full/delta pull theo workspace + cursor + table set; truyền `AbortSignal` xuyên `fetchDeltaSnapshot` và full pull, hủy flight superseded nhưng vẫn giữ generation guard như lớp bảo vệ cuối.
- Thay `mergeIncomingRecords` bằng một index map tạo một lần/mẻ. Gom observer/enhancement về root vừa được chèn hoặc một coordinator có ownership rõ; giữ nguyên semantic/accessibility output.

**Effort/risk:** M; risk là starvation hoặc warm quá muộn. Cần deterministic scheduler tests với fake clock.

**Acceptance**

- Exact warm query không bị gửi trùng khi click, sync và warm gặp nhau.
- User click không phải chờ background queue; warm tab vẫn `≤100 ms` meaningful content.
- Startup đạt cold P95 `≤800 ms`, warm P95 `≤325 ms`, longest task `≤100 ms` trên môi trường gate hiện hành.
- Không task workspace cũ commit cache/DOM sau switch.
- `delay` có hiệu lực tương đương ở cả nhánh idle callback và fallback; deterministic fake-clock test chứng minh task `900 ms` không chạy sớm.
- Một `goithau` change không render năm pane ẩn; hidden-pane dirty state vẫn được render đúng khi người dùng mở tab.
- Hai exact pull đồng thời tạo một request; superseded pull bị abort và không tiếp tục parse/merge; 10k + 10k merge nằm dưới budget `50 ms` trên gate chuẩn.
- Observer callback/DOM scan count không tăng tuyến tính theo số observer toàn trang; toàn bộ keyboard/focus/ARIA regression test giữ nguyên.

### UX-03 — workspace, role và thêm nhân sự

#### Chuyển workspace

Current path tại `frontend/app/BiddingController.js:453-572` đã có điểm tốt: render snapshot isolated trước authoritative pull. Tuy nhiên trước paint vẫn chờ mutation drain, `model.init()` và hydrate draft (`:476-525`).

Đề xuất:

- Busy/selected-state phản hồi trong cùng frame.
- Mutation drain chỉ chờ local durable boundary, không chờ network của workspace cũ.
- Hydrate priority keys của target workspace trước; remaining keys/drafts không cần route hiện tại chạy nền, ngoại trừ draft bắt buộc để tránh mất form đang mở.
- Cache workspace theo bounded LRU, nhưng purge quyền bị thu hồi ngay theo authoritative access event.

Acceptance: warm target shell P95 `≤100 ms`; cold local hydrate `≤250 ms`; zero cross-workspace paint/mutation.

#### Chuyển vai trò

`frontend/admin/AdminUserController.js:327-378` có busy state ngay và gửi server command trước transition, nhưng `:340-347` không kiểm tra `response.ok`. `apiFetch` trả nguyên response kể cả 403/409; code vẫn parse JSON rồi dùng `result.activeRole || val`, nên một non-2xx JSON không có `activeRole` có thể gọi `switchActiveRole(val, ...)` và đổi persona/route/cache cục bộ dù server đã từ chối. Chưa có bằng chứng backend cấp thêm quyền vì request sau vẫn được authorize, nhưng đây là correctness/security boundary không được để fail-open.

Đề xuất:

- Cùng frame click: selected/busy feedback `<50 ms`; không hiển thị target data trước server confirmation.
- Chỉ nhận `activeRole` từ response `2xx` hợp lệ, thuộc allowed role của chính user; mọi non-2xx hoặc payload sai phải giữ nguyên persona/route/cache và hiển thị lỗi tiếng Việt có request ID khi có.
- Sau ACK: render shell/cache đúng confirmed persona; purge/hydrate/reconcile phần còn lại nền với generation guard.
- Giữ nguyên semantics active role và authorization backend; không biến role switch thành UI-only persona.

Acceptance: feedback P95 `<50 ms`; confirmed ACK → target shell P95 `<150 ms` trên normal network; zero stale persona paint; regression test 403/409/invalid JSON/network error xác nhận `switchActiveRole`, route navigation, purge/init và cache write đều không xảy ra.

#### Thêm nhân sự

`AdminUserController.js:394-570` đã có busy feedback và local projection sau server commit. Tuy nhiên create path cần candidate GET (`:422-440`) rồi add POST (`:490-505`) tuần tự. Reload nhân sự gọi `/api/auth/users` rồi `/api/organizations/former-members` tuần tự tại `:1282-1314`; mở tab và WebSocket có thể cùng reload (`BiddingControllerUI.js:751-754`, `WebSocketSyncClient.js:135-143`).

Đề xuất:

- Debounce/prefetch candidate khi email hợp lệ và người dùng dừng gõ; luôn revalidate tại submit.
- Hoặc dùng composite server command lookup+add chỉ sau khi contract exact-request, quota, membership và audit được duyệt. Không tự đổi default permission/copy assignment semantics.
- Dedupe employee reload theo workspace generation; hai GET độc lập có thể song song sau authorization context đã chốt.
- Server-confirmed projection render ngay; canonical reload nền như current intent.

Acceptance: feedback `<50 ms`; server-confirmed employee xuất hiện P95 `<300 ms`; một add command/idempotency key; tối đa một employee reload in-flight/workspace; 409/quota/session failure không mutate local membership/permission/assignment.

#### Phân công nhiều nhân sự trong gói thầu/hợp đồng

`frontend/shared/MultiAssigneeSelect.js:94-108` xóa rồi thêm từng assignment bằng hai vòng `await` tuần tự. Mỗi `model.deleteRecord/addRecord` tại `BiddingModel.js:1319-1430` lại clone toàn bộ mảng assignment, ghi IndexedDB, commit mutation và flush outbox. Với gói thầu, sau N mutation này `GoiThauWorkflow.js:1317-1346` còn đưa toàn bộ assignment của gói vào aggregate persist. Vì vậy độ trễ tăng theo số người thêm/bỏ và có nhiều durable boundary không cần thiết.

Đề xuất một `applyAssignmentBatch` atomic ở model: tính delta một lần, clone state một lần, ghi tất cả add/delete trong một IndexedDB transaction, enqueue một outbox command rồi để aggregate persist dùng chính batch đó. Không chạy N promise song song vì sẽ tạo race/rollback khó kiểm soát; batch phải giữ nguyên exact assignment semantics, audit và rollback toàn mẻ.

Acceptance: thay đổi N assignee tạo một local transaction và một logical outbox batch; local durable P95 `≤100 ms`; failure giữa mẻ rollback đầy đủ; regression test giữ nguyên assignment scope/permission và exact selected IDs cho cả gói thầu, hợp đồng, draft/non-draft.

### OBS-01 — thiếu RUM và phase telemetry ở đúng seam UX

Backend đã có HTTP histogram theo route, DB lane/phase histogram, request ID, một số `Server-Timing` và private `/metrics` control tại `backend/observability/metrics.py`, `recording.py` và `backend/app.py`. Thiếu dữ liệu từ click đến paint và provenance request browser.

Đề xuất ghi:

- INP P75 theo route family/device class, không theo raw path ID.
- `click → first feedback → local durable → paint → server ACK → canonical reconcile` cho mutation.
- `click → server role ACK → target shell`, workspace transition phases và membership lookup/add/projection.
- `task trigger`, cache/dedupe hit, workspace generation (opaque), route group và long-task overlap cho warming/reconciliation.
- Error code/request ID nhưng không credential, token, CCCD, ngân hàng, record payload hoặc tenant ID raw trong label/log.

Chrome/web.dev xác định INP tốt là `≤200 ms` tại P75 và khuyến nghị bắt đầu từ field/RUM data. BiddingFlow nên giữ internal feedback budget chặt hơn (`P95 ≤100 ms`) vì đây là ứng dụng thao tác dày.

**Acceptance:** dashboard theo release so sánh debug/prod, SW-controlled/uncontrolled, P75/P95; CI/lab gate không thay RUM nhưng chặn regression lớn; metric cardinality được test.

### DB-01 — blocking I/O candidate và index phải xử lý theo bằng chứng

**Hiện trạng**

- Repo có bounded DB lanes tại `backend/shared/database_io.py:22-114`; membership lookup/add đã đi qua write lane ở `backend/api/org_routes.py`.
- Static AST scan trên working tree tìm `45` async function có DB/blocking primitive nhưng không gọi offload wrapper; baseline trước là `29`, trong đó phần tăng tập trung ở billing/commercial. Đây là inventory, không phải 45 bug đã chứng minh.
- Ví dụ candidate: `backend/billing/routes.py`, `backend/billing/webhook.py` và `backend/commercial_policy/routes.py` mở connection/chạy transaction đồng bộ bên trong async route. Provider execution đã có chỗ offload, nhưng DB phase quanh nó vẫn cần profile.
- FK audit báo `32` child-side index thiếu; audit trước xác nhận `30` thiếu thật và `2` false positive do effective-cover. Phần lớn thuộc billing/commercial.
- Live local baseline là PostgreSQL `17.10`, DB khoảng `40,07 MiB`, buffer cache hit khoảng `99,95%`; không thấy deadlock, conflict hoặc invalid index và `pg_stat_statements` đã bật. Đây là health signal tốt của DB nhỏ cục bộ, **không chứng minh** production query/lock latency tốt.
- Log đo riêng trên Windows local cho `SELECT pg_database_size(current_database())` trong collector `/metrics` có `4` call, mean khoảng `3,576 s`, max `5,515 s`. `/metrics` đã offload toàn bộ `render_prometheus()` qua bounded blocking-I/O lane (`metrics.py:1332-1348`) nên không block event loop trực tiếp, nhưng mỗi scrape vẫn gọi `_filesystem_metrics()` và query DB (`:399-455,1253-1264`), có thể giữ lane/connection và gây I/O spike cạnh tranh với request người dùng.
- Nhiều bảng nhỏ/churn chưa đủ default autovacuum analyze threshold `50` row để có thống kê mới. Không nên global-tune PostgreSQL từ DB local; chỉ đặt per-table analyze threshold sau khi chứng minh estimate drift trên bảng nóng.
- N+1 query-count gate hiện pass, nhưng benchmark latency của các seam tương ứng vẫn dao động khoảng `20–287 ms`. “Không N+1” không đồng nghĩa query plan nhanh; cần P95/P99 và `EXPLAIN (ANALYZE, BUFFERS)` trên fixture đại diện.

**Đề xuất**

1. Rank candidate theo request count, P95/lock wait và DB-phase timing. Chuyển hot read/write transaction sang bounded lane thích hợp; không chỉ tăng thread count.
2. Đo `pg_stat_statements`, cardinality và `EXPLAIN (ANALYZE, BUFFERS)` trên workload đại diện trước khi tạo index.
3. Tạo migration index đã duyệt bằng `CREATE INDEX CONCURRENTLY`, có progress/rollback/waiver; không chạy trong transaction block và không tạo đồng loạt 30 index thiếu bằng suy đoán.
4. Với transaction tài chính/audit bắt buộc, giữ boundary ngắn và atomic; không tách commit chỉ để “nhanh”.
5. Cache snapshot collector DB/filesystem trong một TTL phù hợp với scrape interval, single-flight refresh và giới hạn scrape concurrency. Tách `pg_database_size` khỏi request-time scrape hoặc chạy cadence nền; metric stale phải ghi timestamp/success, không giả `0` là dữ liệu thật.
6. Với bảng churn đã chứng minh estimate sai, đặt `autovacuum_analyze_scale_factor`/threshold riêng theo bảng và theo dõi trước/sau; không đổi global chỉ vì local table nhỏ.

Starlette dùng thread pool để tránh block event loop và mặc định pool chỉ có `40` token dùng chung; đây là lý do phải dùng bounded lanes/backpressure có quan sát thay vì offload vô hạn.

**Acceptance:** ASGI event-loop lag P95 dưới budget; DB lane queue/timeout không tăng; hot route P95 giảm; query plan/index usage được lưu trước/sau; `/metrics` P95 không chạy lại expensive DB collector theo mỗi scrape, concurrent scrape chỉ có một refresh; collector failure giữ last-known-good kèm freshness; correctness/authorization/audit tests giữ nguyên.

### PROC-01 — Mua Sắm Công upstream làm UI chờ quá lâu

`data/logs/runtime.jsonl` ghi:

| Route lỗi | Số mẫu | Median | P95/max |
|---|---:|---:|---:|
| `prepare_plan_import` | 16 | 405,6 ms | 57.196,2 ms |
| `prepare_opening_import` | 7 | 1.817,6 ms | 60.023,4 ms |

Config `MUASAMCONG_SESSION_TIMEOUT_SECONDS=55`; route prepare tại `backend/procurement_import/routes.py:2518-2536,2696-2721`. Stack của request ID người dùng cung cấp dừng ở upstream browser search trước khi import materialization. Vì vậy:

- Đã chứng minh đây là `PROCUREMENT_UPSTREAM_UNAVAILABLE` ở source transport/browser path.
- **Không có bằng chứng việc phân gói là nguyên nhân** của lỗi hoặc 55–60 giây chờ. Phân gói có thể ảnh hưởng mapping/materialization sau khi dữ liệu nguồn đã lấy được, không giải thích failure stack hiện tại.
- Không được dùng các mẫu lỗi này để suy ra success P95.

**Đề xuất UX/operability**

- Trả progress phase trong `<100 ms`: “Đang kết nối”, “Đang tìm revision”, “Đang chuẩn bị bản xem trước”; cung cấp Hủy.
- Circuit breaker có trạng thái ngắn hạn cho upstream/session lỗi; fail fast có Retry thay vì giữ nhiều request cùng chờ 55 giây.
- Prewarm/health-check browser session theo bounded background task; reuse cache theo exact code+revision và vẫn giữ quota contract (technical failure/retry/cache hit không tiêu thụ lượt).
- Log phase timing riêng search/detail/document/mapping; message người dùng bằng tiếng Việt và giữ request ID cho hỗ trợ.
- Không tự retry vô hạn; retry có jitter, dedupe và cancellation khi workspace đổi.

**Acceptance:** UI phản hồi/trạng thái `<100 ms`; cancel ngắt work có thể hủy; circuit-open failure trả nhanh; không double-consume quota; test riêng plan/package/opening và có evidence phân biệt upstream với partition/materialization.

### PERF-03 — render bảng lớn và timeline

Benchmark cho thấy virtual/chunked DOM giảm 1.000-row P95 từ `131–584 ms` xuống `4–11 ms`, đặc biệt hàng hóa nhà thầu và timeline. Đề xuất:

- Mở rộng shared virtualization theo màn hình có evidence, không thay toàn app một lượt.
- Timeline/date input cần lifecycle riêng: mount/unmount Flatpickr an toàn, giữ focus, keyboard, validation và draft collection.
- Editable detailed evaluation có thể dùng chunked render + overscan/pinned editing row nếu full virtualization làm mất form state.
- Dùng dirty-root patching; tránh render toàn bảng sau mutation một row.

Acceptance: main-thread task mỗi chunk `<50 ms`, scroll/focus/keyboard không regression, draft data đầy đủ kể cả row off-screen, print/export không phụ thuộc mounted DOM.

### PAY-00 — P0 release blocker: timestamp payOS làm activation crash

**Bằng chứng**

- `backend/billing/activation.py:105-118,177-189,593-602` chuyển trực tiếp `transactionDateTime` hoặc `createdAt` bằng `int()` ở cả webhook-verified path và provider-query path.
- Contract chính thức của API GET payment link trả `createdAt: "2024-01-15T10:30:00.000Z"`; mẫu webhook chính thức trả `transactionDateTime: "2023-02-04 18:25:00"`. Cả hai đều là chuỗi, không phải Unix integer.
- Repro trực tiếp trên working tree:

  ```text
  BillingActivationService._payment_timing(
    {"checkout_state":"open","checkout_expires_at":2000000000},
    {"createdAt":"2024-01-15T10:30:00.000Z"}
  )
  → ValueError tại activation.py:594
  ```

- Webhook worker bắt exception chung rồi retry; sau `max_attempts` đổi event thành `dead` (`backend/billing/worker.py:146-193`). Provider `query_order` bọc lỗi activation thành `BILLING_ACTIVATION_RETRY`, retry rồi command `dead` (`backend/billing/service.py:562-625`). Transaction rollback xảy ra trước khi payment fact/activation commit, nên repair selector `verified_paid + pending/retry` không nhìn thấy đơn này.
- Fake provider và test helper đều trả integer (`backend/billing/providers/fake.py:62,103,135`, `tests/test_billing_activation.py:248-255`), nên suite hiện hành không mô phỏng shape thật và đã bỏ lọt incompatibility.

**Phương án bắt buộc trước live payment**

1. Tạo một parser timestamp payOS duy nhất ở provider/activation boundary; output là UTC Unix seconds hoặc structured `PROVIDER_TIMESTAMP_AMBIGUOUS/INVALID`, không để `ValueError` thoát như lỗi retryable vô hạn.
2. Chấp nhận Unix seconds theo contract nội bộ cũ và ISO 8601 có `Z` hoặc explicit UTC offset; chuẩn hóa về UTC. Nếu hỗ trợ milliseconds, phải phân biệt bằng schema/range rõ ràng, không đoán theo độ dài tùy tiện.
3. Chuỗi SQL-like không timezone như mẫu webhook `YYYY-MM-DD HH:mm:ss` là mơ hồ. Sau khi signature đã được xác minh, lưu nguyên evidence và đưa event/order vào durable `review_required`; **không tự suy ra UTC hay Asia/Ho_Chi_Minh**. Muốn chốt timezone mặc định cần xác nhận contract payOS bằng tài liệu/support và ghi ADR.
4. Dùng timestamp giao dịch thực cho late-payment policy. Không âm thầm coi thời điểm tạo payment link (`createdAt`) là thời điểm thanh toán nếu provider có transaction timestamp; nếu chỉ có `createdAt` ở paid response thì chuyển review cho tới khi mapping được chứng minh.
5. Backfill/requeue có kiểm soát mọi webhook/command `dead` mang `WEBHOOK_PROCESSING_FAILED` hoặc `BILLING_ACTIVATION_RETRY` sau khi parser được deploy; idempotency phải bảo đảm không double payment/entitlement.

**Acceptance**

- Contract test dùng nguyên shape GET chính thức với `createdAt="2024-01-15T10:30:00.000Z"` không crash và chuẩn hóa đúng UTC.
- Contract test dùng webhook chính thức với `transactionDateTime="2023-02-04 18:25:00"` xác minh signature trước, sau đó đi `review_required` bền vững; không kích hoạt, không tự gắn timezone và không retry tới `dead`.
- Test thêm explicit offsets `+07:00`, `Z`, malformed/overflow, seconds/milliseconds đã được contract cho phép, late-before/after-expiry và cancel boundary.
- E2E provider-shaped `webhook → query → payment fact → activation` và `missed webhook → query_order → activation` commit đúng một lần; crash/replay không double entitlement.

### PAY-01 — payment reliability/readiness còn mở

Các finding cũ sau **đã được đóng**, không được lặp lại như lỗi hiện hành: cross-order provider transaction binding, runtime payOS credentials composition và atomic paid-result/activation command completion. Usage lease hiện đã có reaper caller, còn provider environment và local checkout cap đã có; nhưng recovery reconciliation và provider-side expiry bên dưới chỉ **đóng một phần**. Việc các mục cũ đóng cũng không đóng PAY-00 mới về incompatibility timestamp thật.

Còn mở:

1. `backend/commercial_policy/repository.py:277-305` publish projection chưa điền `legacy_package_id`; activation tại `backend/billing/activation.py:448-449` sẽ chuyển review nếu thiếu. Đây là payment launch gate cho base-plan publish path, không phải lý do chặn sửa UX chung.
2. Purchase/renew/upgrade/downgrade khi subscription đang active cần chủ sản phẩm chốt semantics (`activation.py:438-501`). Không tự sửa vì sẽ đổi contract thương mại.
3. `provider_order_code` dùng hash 31-bit, unique theo profile và không retry collision (`backend/billing/service.py:24-28`). Cần generate/retry conflict hoặc sequence compatible payOS trước volume lớn.
4. Worker chỉ drain webhook/command đã tồn tại và retry paid-not-applied. Toàn repo chỉ enqueue `query_order` từ fake simulator hoặc Super Admin reconcile; chưa có periodic reconciliation cho mọi open/unverified order nếu webhook thất lạc. Cần scheduled, bounded, idempotent repair policy.
5. Webhook event ID là `payment-event-{payload_hash[:32]}` global PK trong khi unique business key scoped `(provider_profile_id, dedupe_key, payload_hash)` (`backend/billing/webhook.py:54-84`, `backend/db/schema.py:1845-1864`). Hai profile nhận cùng raw payload có thể va PK; mức Low/Medium conditional. Scope ID theo profile hoặc UUID nhưng giữ composite dedupe.
6. **PAY-06 còn mở một phần — Medium/P1 conditional khi bật credit enforcement:** usage lease reaper đã được gọi tại `backend/billing/worker.py:73-91`, nhưng `release_expired_reservations()` chỉ release mọi lease hết hạn (`backend/usage_credits/service.py:314-326`). Procurement lookup commit raw snapshot trước rồi mới finalize reservation qua transaction/connection riêng (`backend/procurement_lookup/routes.py:178-192,341-359`). Crash đúng khoảng giữa có thể để authoritative snapshot đã commit nhưng lease sau đó bị reaper release, làm hụt ghi nhận lượt sử dụng. Cần recovery reconciliation theo exact provider/entity/source/revision: snapshot đã commit thì consume đúng một lần; chưa commit thì release.
7. **PAY-08 còn mở một phần — Medium/P1 payment readiness:** checkout có local deadline/cap tại `backend/billing/service.py:536-547`, nhưng create request `:178-195` không gửi trường `expiredAt` mà contract payOS hỗ trợ. Link phía provider vì vậy có thể còn nhận tiền sau khi app đã coi checkout hết hạn, đẩy người dùng vào late-payment review. Gửi official `expiredAt` theo deadline đã chốt, rồi vẫn giữ local late-payment check như defense in depth; skew/provider rejection phải có test.
8. **PAY-09 còn mở — Medium/P1 payment correctness:** provider command được claim trước khi resolve credential/provider, create có side effect ngoài DB và retry create chuyển sang query theo `attempt_count` (`backend/billing/service.py:440-468,636-657`). Cần contract test cho resolver failure trước create, create outcome-unknown, provider không tìm thấy ngay sau ambiguous create, cancel outcome-unknown và worker cũ hoàn tất sau khi lease đã bị worker khác claim; mọi đường phải hội tụ về một order state, không tạo checkout/cancel trùng và không để stale worker commit.
9. **PAY-15 cần chủ sản phẩm chốt — Low/Medium, chỉ dev/test:** fake checkout bị hard-gate ngoài development/test, nên không phải production CSRF bypass. Tuy nhiên signed-in simulator gọi mutation mà không gửi shared CSRF token, trong khi client không session biết URL có thể đi theo bearer-like contract (`backend/billing/routes.py:37-193`, `frontend/billing/FakeCheckout.js:24-55`, `backend/http_middleware.py:389-407`). Phải chọn rõ session-owner + CSRF hoặc capability nonce ngẫu nhiên, một lần, bound order/profile/expiry; vì đây là thay đổi authorization semantics nên chỉ triển khai sau ADR/owner approval.

Payment webhook vẫn phải verify signature trước persist/ACK, bind provider transaction đúng order, kiểm amount/order/link, xử lý idempotent và không log secrets. Regression suite phải bao gồm webhook duplicate/conflicting payload, missed webhook periodic query, late paid/cancel/expiry, provider timeout và crash giữa provider fact/activation. Usage crash test phải chứng minh `snapshot commit → crash → reaper` consume đúng một lượt, còn `crash trước snapshot commit` release; create-checkout provider-shaped test phải assert `expiredAt` đúng official Unix Int32 và provider/local deadline nhất quán.

### MAINT-01 — code debt, refactor và file sinh ra

`python scripts/check_frontend_debt.py` đang fail:

- `direct_state_writes=61` > baseline `59`.
- `!important=433` > `428`.
- `raw_colors=1067` > `930`.
- `runtime_styles=512` là inventory đáng theo dõi.

Module lớn đáng tách theo seam, không theo số dòng đơn thuần:

- `backend/db/upgrades.py`: khoảng 3.438 dòng.
- `backend/db/schema.py`: khoảng 3.356 dòng.
- `frontend/documents/wordVariableManifest.js`: khoảng 2.941 dòng.
- `BiddingView`, `BiddingModel`: khoảng 1.700 dòng.
- `WordIntegration`: khoảng 1.614 dòng.
- `KeHoachWorkflow`: khoảng 1.587 dòng.
- `BiddingController`: khoảng 1.524 dòng.
- `AdminUserController`: khoảng 1.426 dòng.

Không có căn cứ xóa frontend module: reachability audit báo `317/317` module reachable và `0` cycle. Dead-code cleanup cần symbol/coverage/dynamic-entry evidence riêng; không suy từ tên file.

Inventory local cần retention policy, chưa được tự gọi là rác:

- `data` khoảng `1.569 MiB`, gồm tools `848 MiB`, PostgreSQL `484 MiB`, logs `235 MiB`.
- `release` khoảng `582 MiB`, phần lớn private symbols.
- `.tmp` khoảng `113 MiB`, phần lớn Word QA.
- `test-results` khoảng `37,8 MiB`.
- `46` thư mục `__pycache__`, `822` file `.pyc`, khoảng `14 MiB`.

Đề xuất retention:

- Tự động dọn recoverable cache/test artifact theo tuổi: `__pycache__`, `.pyc`, `test-results`, Word QA temp đã đóng và local logs quá retention.
- `data/tools`, PostgreSQL data, `.env`, release/private symbols phải có owner, backup/retention và explicit target; không xóa bằng glob hoặc recursive command rộng.
- Production packager đang dùng allowlist và cấm cache/log/map/test artifact; giữ gate này.

## Kiến trúc refactor đề xuất

Không làm “đại phẫu” trước khi đóng P0. Mỗi mục dưới đây phải là **deep module**: external interface nhỏ che được orchestration phức tạp bên trong, đồng thời chính interface đó là test surface. Không tạo port/adapter giả khi chỉ có một implementation nội bộ và không xếp thêm lớp pass-through không giấu được quyết định nào. Refactor theo vertical seam có performance test:

1. **`WorkspaceMutationCoordinator`**: stage → local durable → remote ACK → canonical reconcile/conflict. API callback hai phase thay `afterPersist` mơ hồ.
2. **`WorkspaceTaskScheduler`**: một nơi quản lý startup/warm/reconcile/preload với priority, cancellation, dedupe và budget.
3. **`PaginatedProjectionStore`**: workspace-scoped normalized query cache, in-flight dedupe, SWR, invalidation theo table/generation; không để mỗi renderer tự quyết network lifecycle.
4. **`WorkspaceLifecycleController`**: auth/workspace/role state machine dùng cache identity rõ ràng; tách navigation readiness khỏi mutation-authoritative readiness.
5. **`OrganizationMembershipCommand`**: gom UI orchestration và server contract quanh lookup/add/remove/reload, nhưng không đổi permission/assignment semantics nếu chưa duyệt.
6. **Backend route/service/repository seam**: async adapter chỉ parse/auth/dispatch; transaction sync chạy trong bounded DB lane; business service không biết HTTP.
7. **Schema/upgrades theo bounded context**: tách billing, procurement, documents, auth schema builders nhưng giữ một ordered migration registry và schema contract test.
8. **Table rendering seam**: shared virtual/chunked renderer quản lý focus/edit lifecycle, export dựa data model chứ không đọc DOM.
9. **CSS/design tokens**: giảm raw color/`!important` theo component chạm tới, không global rewrite làm đổi giao diện ngoài scope.

DB local-substitutable nên dùng test database ở interface repository/service thay vì mock mọi cursor call. payOS là hệ thống external thật, nên injected provider port + fake/mock adapter provider-shaped là seam phù hợp. Chỉ thay test shallow cũ sau khi interface-level regression đã khóa behavior; không giữ cả hai lớp test pass-through chỉ để tăng số lượng.

Mỗi seam phải có compatibility impact, rollback plan và regression test. Đặc biệt refactor cache/lifecycle phải assert full-record visibility cho user vốn có quyền, đồng thời zero cross-tenant/assignment/record-scope access.

## Lộ trình triển khai

### 0–3 ngày (P0)

1. Patch PAY-00 và giữ live payment disabled cho tới khi provider-shaped GET/webhook tests xanh; inventory + requeue plan cho event/command dead được duyệt.
2. Patch PERF-01: bỏ `dynamicImports` khỏi SW install traversal; đổi lifecycle test; thêm manifest precache-size budget.
3. Thiết kế/patch UX-01 cho một workflow đại diện, sau đó áp dụng sáu workflow; thêm red/green test có delayed paginated renderer.
4. Chặn role switch fail-open: 403/409/invalid payload không đổi persona, route hoặc cache.
5. Thêm instrumentation phase tối thiểu và request provenance; lưu baseline A/B SW on/off.
6. Thêm deploy smoke N/N-1 cho lazy chunk và one-safe-reload.
7. Dedupe employee reload và exact first-page request theo workspace generation.

Điều kiện kết thúc phase: provider-shaped payOS activation xanh và không ambiguous-time activation; local durable save P95 `≤100 ms`; no eager feature download; không dynamic import 404 trong deploy smoke; 403/409 role switch không đổi local persona; targeted security/isolation tests xanh.

### 1–2 tuần

1. Central post-startup scheduler và exact-query dedupe/cancellation.
2. Auth ACK → isolated cached shell; workspace/persona state machine và RUM.
3. Candidate prefetch/revalidation cho thêm nhân sự; parallel/deduped canonical reload.
4. Rank async DB candidates bằng traffic/phase metrics; chuyển hot paths đầu tiên sang bounded lanes.
5. Procurement progress/cancel/circuit breaker/session prewarm có quota tests.
6. Scheduled payment reconciliation cho open orders; recovery reconciliation cho usage lease; gửi provider `expiredAt`; giải quyết event-ID/provider-order-code collision và provider-command outcome-unknown/stale-worker seam.
7. Chủ sản phẩm chốt contract fake checkout dev/test (session-owner + CSRF hoặc capability nonce) bằng ADR trước khi đổi authorization behavior.

### 1–2 tháng

1. Virtualize/chunk các bảng có benchmark đỏ, ưu tiên bidder goods/timeline/evaluation.
2. Triển khai `PaginatedProjectionStore` và dirty-root rendering; bounded LRU cho workspace/cache.
3. Tách controller/schema modules theo bounded context; trả frontend debt về baseline rồi hạ ratchet.
4. Dựa `pg_stat_statements`/EXPLAIN để thêm index concurrent đã chứng minh cần thiết.
5. Chốt business semantics payment + `legacy_package_id`, ghi ADR/migration/E2E publish→pay→activate.
6. Áp retention tự động cho logs/temp/cache/private symbols theo owner policy.

## Performance và security acceptance matrix

| Hành trình | SLO/gate đề xuất |
|---|---|
| Mọi click | First visual feedback P95 `≤100 ms`; mục tiêu control/busy state `<50 ms` |
| INP field | P75 `≤200 ms`, tách mobile/desktop |
| Local durable save | P95 `≤100 ms`; không chờ remote pagination |
| Warm main tab | Click → meaningful content P95 `≤100 ms`; không skeleton nếu cache usable |
| Startup cold/warm | P95 `≤800/325 ms`; longest task `≤100 ms` |
| Login | Auth ACK → shell P95 `<250 ms` |
| Workspace switch | Warm P95 `≤100 ms`; cold local P95 `≤250 ms` |
| Role switch | Feedback `<50 ms`; confirmed ACK → shell `<150 ms` |
| Add member | Feedback `<50 ms`; server-confirmed projection P95 `<300 ms` |
| Scope safety | Zero cross-user/org/persona paint, cache hit, mutation hoặc response commit |
| Authorization | Tenant/module/assignment/record/session/audit regression suite 100% pass |
| Service worker | Install `≤0,75 MiB`; zero unused feature request; zero stale-chunk error in N/N-1 smoke |
| Procurement | Phase feedback `<100 ms`, cancellable, no double quota, circuit-open fail-fast |
| Thanh toán payOS | Official-shaped GET/webhook không crash; explicit timezone chuẩn hóa UTC; timestamp mơ hồ đi durable review; outcome-unknown hội tụ; paid activation đúng một lần |

## Kết quả kiểm tra đã chạy

### Đạt

- Vòng frontend rộng trước đó: `37` targeted tests liên quan mutation, startup/tab, role và workspace đều pass.
- Vòng backend security/payment rộng trước đó: `74 passed in 17.37s`.
- Vòng xác minh bổ sung sau audit: `29` targeted JavaScript tests và `43` targeted Python tests đều pass. Đây là hai run riêng; không cộng thành một suite duy nhất và không dùng số pass để che các gap test bên dưới.
- Vòng security/payment cuối cùng: `59` test liên quan đều pass; run này có thể chồng lấp các tập Python trên nên được ghi riêng, không cộng tổng.
- `npm run lint:security`.
- Trusted Types gate.
- `npm run lint:modules`: `317` module, `0` cycle.
- `npm run audit:dead-code`: `317/317` reachable.
- `npm run audit:npm`: `0` advisory.
- `pip-audit -r requirements.txt`: `0` advisory.

### Chưa đạt

- Startup cold/warm/long-task budgets như baseline bên trên.
- `python scripts/check_frontend_debt.py` do direct state writes, `!important` và raw colors vượt ratchet.
- FK-index audit báo `32`, cần xử lý `30` thiếu thật theo evidence/waiver; không tự tạo index từ audit tĩnh.
- Test background mutation hiện thiếu `afterPersist` async thật nên chưa khóa regression UX-01.
- Service-worker lifecycle test đang kỳ vọng eager dynamic precache và cần đổi cùng PERF-01.
- Payment tests hiện dùng fake-provider timestamp integer; chưa có official-shaped payOS ISO/SQL-like timestamp contract test và repro PAY-00 vẫn ném `ValueError`.

## Nguồn chính thống

- Chrome/web.dev: [Optimize Interaction to Next Paint](https://web.dev/articles/optimize-inp) — INP tốt `≤200 ms` tại P75, ưu tiên field/RUM, chia nhỏ/yield work và paint feedback trước công việc không quan trọng.
- Chrome/web.dev: [Interaction to Next Paint](https://web.dev/articles/inp) và [Rendering performance](https://web.dev/articles/rendering-performance) — input delay, processing và presentation delay; long task/DOM lớn ảnh hưởng phản hồi.
- Chrome/web.dev: [How Core Web Vitals thresholds were defined](https://web.dev/articles/defining-core-web-vitals-thresholds) — đánh giá theo percentile thay vì một lần đo tốt nhất.
- Vite: [Building for Production — Load Error Handling](https://vite.dev/guide/build.html#load-error-handling) — `vite:preloadError` xử lý version-skew dynamic import; Vite cũng yêu cầu HTML dùng `Cache-Control: no-cache` để không tiếp tục trỏ tới asset cũ.
- MDN: [Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) — install/activate/cache lifecycle là boundary cần giữ nhỏ, có version và có failure handling rõ ràng.
- Starlette: [Thread Pool](https://www.starlette.io/threadpool/) — sync work dùng thread pool; giới hạn mặc định `40` token được dùng chung, cần capacity/backpressure có chủ đích.
- PostgreSQL: [`pg_stat_statements`](https://www.postgresql.org/docs/current/pgstatstatements.html), [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html), [`CREATE INDEX`](https://www.postgresql.org/docs/current/sql-createindex.html), [Constraints/FK](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK) — đo query thật, đọc plan/buffer, dùng concurrent index phù hợp; PostgreSQL không tự tạo index cho phía child của foreign key.
- OWASP: [Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html) — regression baseline cho session, request integrity, server-authoritative role/transaction và logging.
- payOS: [API payment requests](https://payos.vn/docs/api/) và [mẫu kiểm tra chữ ký webhook](https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/) — GET trả `createdAt` ISO 8601 có `Z`; webhook mẫu trả `transactionDateTime` dạng SQL-like không timezone, là bằng chứng trực tiếp cho PAY-00.

## Thứ tự xác nhận sau mỗi patch

1. Correctness và durable state.
2. Tenant/workspace/persona/data isolation.
3. First feedback và INP.
4. Local save/tab/workspace latency.
5. Startup/network/bundle budgets.
6. Security, dependency, CSP/Trusted Types, module/dead-code/debt gates.
7. A/B artifact và regression test lưu cùng release.

Không được đánh đổi correctness hoặc scope isolation để giảm vài trăm mili-giây; đồng thời cũng không được dùng security/correctness như lý do giữ một full-screen loader hoặc bắt người dùng chờ công việc có thể chạy nền.
