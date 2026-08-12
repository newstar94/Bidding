# Phase 1 — Research luồng Mua Sắm Công cho Complete Raw Bundle

Ngày nghiên cứu: **2026-08-11**, múi giờ Asia/Saigon.  
Phạm vi: đọc tĩnh source code mới nhất của `Bidding` và `WEB_DAU_THAU`; không gọi upstream, không chạy crawler, không sửa implementation.

## 1. Nguồn chuẩn và phương pháp

Hai working tree sạch và cùng commit với `origin/main` tại thời điểm nghiên cứu:

| Repository | Commit được khóa |
|---|---|
| `newstar94/Bidding` | `2b9db8524f59b20956832467e247022b7e38a531` |
| `newstar94/WEB_DAU_THAU` | `0ccebd94a7819413730778ee9dec517a016cfbd0` |

Chỉ dùng các nguồn sơ cấp sau:

- source code production và test/benchmark nằm trong hai repository;
- endpoint catalog của Bidding;
- server collector, token provider, bản chụp Vue template và JSON response do `WEB_DAU_THAU` lưu trong repository.

Trong tài liệu này:

- **FACT**: khẳng định trực tiếp được bằng code;
- **INFERENCE**: suy luận kiến trúc từ nhiều bằng chứng code, được ghi rõ;
- **UNKNOWN**: chưa thể kết luận nếu không quan sát network/live response.

Mọi citation local Bidding áp dụng cho commit Bidding đã khóa ở trên. Citation GitHub của `WEB_DAU_THAU` được pin trực tiếp vào commit của repository đó.

## 2. Kết luận ngắn

1. **FACT — production có hai flow khác nhau.** `/api/procurement/lookup` chỉ phục vụ preview mỏng, luôn chọn revision mới nhất. Flow import `/api/procurement/imports/plan/prepare` đã có domain semantics `LATEST | SELECTED | ALL`, nhưng fetch canonical từng revision tuần tự. Hai flow dùng chung process-wide `MuaSamCongProcurementSource` ([lookup route](../../backend/procurement_lookup/routes.py#L54), [import route](../../backend/procurement_import/routes.py#L117), [registry](../../backend/integrations/muasamcong_browser/registry.py#L58)).
2. **FACT — raw bị mất trước khi tới lookup/import.** `get_plan_revision()` nhận `result.raw`, gọi canonical mapper rồi chỉ trả canonical; lookup tiếp tục rút canonical thành DTO ít field hơn. Database hiện chỉ lưu `canonical_snapshot_json`, không có procurement raw snapshot ([source](../../backend/integrations/muasamcong_browser/procurement_source.py#L335), [thin lookup mapping](../../backend/integrations/muasamcong_browser/procurement_source.py#L524), [schema](../../backend/db/schema.py#L1872)).
3. **FACT — PLAN graph hiện thiếu package-detail.** Bidding chỉ có `PLAN_VERSION_LIST` và `PLAN_DETAIL`. Portal Vue snapshot khai báo thêm `get-bidp-plan-detail-by-id` và gọi protected endpoint với `{id: pkgId}`; operation này không tồn tại trong endpoint catalog Bidding ([catalog](../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs#L7), [Vue endpoint](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L497-L500), [Vue call](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L2052-L2074)).
4. **FACT — browser fallback đang eager-init.** App startup tạo source; constructor spawn Node và gửi `initialize`; worker launch Playwright fallback ngay, đồng thời integration prewarm session qua Puppeteer. Happy path protected API vì vậy vẫn trả chi phí hai browser lifecycle ([lifecycle](../../backend/lifecycle.py#L368), [launcher](../../backend/integrations/muasamcong_browser/launchers.py#L49), [worker](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L45), [Playwright launch](../../backend/integrations/muasamcong_browser/browser_runtime.mjs#L76), [session prewarm](../../backend/integrations/muasamcong_browser/integration_runtime.mjs#L18)).
5. **FACT — cache đang L2-first.** `_get_cached()` query PostgreSQL trước rồi mới đọc process memory. L2 chỉ lưu normalized lookup DTO; import/raw/complete không dùng cache này ([service](../../backend/procurement_lookup/service.py#L171), [PostgreSQL cache](../../backend/procurement_lookup/cache.py#L15)).
6. **FACT — IPC là persistent nhưng không multiplex.** Python giữ một `RLock` từ lúc ghi JSONL đến khi đọc response, nên chỉ có một operation in-flight trên worker. Worker JS có async line handler và `requestId`, nhưng client chưa có reader loop/demultiplexer ([Python exchange](../../backend/integrations/muasamcong_browser/launchers.py#L66), [worker input](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L208)).
7. **FACT — Complete Bundle hiện là dormant capability trong Bidding.** Có method xuyên runtime/worker/source, nhưng không route/service production nào gọi nó. PLAN collector còn fetch tuần tự, không giữ raw version-list, không tạo source envelope có endpoint/request, không traverse package-detail, và một plan-detail lỗi sẽ làm hỏng cả call thay vì trả partial ([collector](../../backend/integrations/muasamcong_browser/collectors.mjs#L375), [source wrapper](../../backend/integrations/muasamcong_browser/procurement_source.py#L499)).

## 3. Flow production chính xác

### 3.1 Lookup mỏng dùng bởi form nghiệp vụ

```text
KeHoachWorkflow / package workflow
  → ProcurementInlineLookup
  → ProcurementLookupClient.lookup({code, workspaceLease})
  → POST /api/procurement/lookup
  → authentication + active organization + rate limit
  → ProcurementLookupService
      → PostgreSQL L2 (hiện chạy trước)
      → process-memory L1
      → in-flight coalescing
  → process singleton MuaSamCongProcurementSource
  → NodeBrowserRuntime JSONL IPC
  → browser_worker.mjs
  → MscIntegrationRuntime
  → MscCollectors
  → MscApiClient
  → MscSessionProvider nếu endpoint protected
  → muasamcong.mpi.gov.vn
```

**Frontend → route.** Client chỉ allow `code` và `workspaceLease`; không thể gửi `kind`, `detailLevel` hoặc `revisionMode`. Inline lookup validate prefix `PL`/`IB`, abort request cũ, gọi client rồi điền dữ liệu vào biểu mẫu đang mở mà không tự lưu ([client](../../frontend/procurement/ProcurementLookupClient.js#L4), [inline lookup](../../frontend/procurement/ProcurementInlineLookup.js#L29)). Backend cũng chỉ allow đúng hai field, xác thực session, active organization/workspace và rate-limit theo IP/user/org trước khi gọi service ([route fields/context](../../backend/procurement_lookup/routes.py#L31), [rate limit](../../backend/procurement_lookup/routes.py#L98), [handler](../../backend/procurement_lookup/routes.py#L228)).

**Route → service → source.** `build_lookup_service()` giữ singleton service theo config fingerprint và inject singleton source cùng PostgreSQL cache ([route factory](../../backend/procurement_lookup/routes.py#L54)). Service normalize code thành PLAN/PACKAGE, tạo cache key `(provider, kind, code, parserVersion)`, coalesce miss, rồi gọi `source.lookup()` ([service](../../backend/procurement_lookup/service.py#L163), [lookup](../../backend/procurement_lookup/service.py#L219)).

**Source → runtime.** Registry tạo `MuaSamCongProcurementSource.from_environ()`. Source này tạo trực tiếp persistent `NodeBrowserRuntime`; nó không đi qua lazy `BrowserLauncherFactory` ([registry](../../backend/integrations/muasamcong_browser/registry.py#L58), [factory construction](../../backend/integrations/muasamcong_browser/procurement_source.py#L91)).

**Runtime → collector → client → session.** Worker dispatch `listPlanRevisions`/`getPlanRevision` sang `MscIntegrationRuntime`, runtime forward sang `MscCollectors`, collector gọi `MscApiClient`, client chỉ acquire session cho endpoint có `protected: true` ([worker dispatch](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L74), [integration runtime](../../backend/integrations/muasamcong_browser/integration_runtime.mjs#L55), [API session branch](../../backend/integrations/muasamcong_browser/api_client.mjs#L168)).

**PLAN lookup hiện tại.** Source gọi version-list, chọn `max(revisionNumber)`, fetch đúng một detail, rồi dựng DTO gồm một nhóm field plan/package ([lookup PLAN](../../backend/integrations/muasamcong_browser/procurement_source.py#L531)). Không có bước search, không có revision mode, không có package-detail. Khi protected API path ném `ProcurementSourceError`, source mới gọi browser fallback `MuaSamCongBrowserSource.lookup()` ([fallback](../../backend/integrations/muasamcong_browser/procurement_source.py#L615)).

### 3.2 Import/reconcile PLAN

```text
PlanImportWizard
  → ProcurementImportClient.preparePlan()
  → POST /api/procurement/imports/plan/prepare
  → auth/org/workspace/rate-limit
  → ProcurementImportPreparer.prepare_plan()
  → source.list_plan_revisions(planNo)
  → select LATEST | SELECTED | ALL
  → source.get_plan_revision(planNo, revisionId), tuần tự
  → optional linked-notice enrichment, tuần tự theo package
  → preview store
  → apply/reconcile
  → procurement_source_revision.canonical_snapshot_json + domain tables
```

Frontend đã gửi `revisionMode`, `selectedRevision` và mặc định `LATEST`; UI hỗ trợ code có hậu tố `-00`, `-01`, ... ([import client](../../frontend/procurement/ProcurementImportClient.js#L28), [wizard](../../frontend/procurement/PlanImportWizard.js#L255)). Route reuse cùng source khi provider là `muasamcong` hoặc alias `web_dau_thau` ([source selection](../../backend/procurement_import/routes.py#L117)).

`ProcurementImportPreparer._select_revisions()` là implementation domain hiện có cần tái sử dụng: `ALL` trả toàn bộ ordered revisions, `SELECTED` trả đúng revision, mặc định `LATEST` trả phần tử cuối ([selection](../../backend/procurement_import/service.py#L82)). Tuy nhiên `prepare_plan()` fetch các revision bằng list comprehension đồng bộ và enrich linked notice trong nested loop đồng bộ ([prepare](../../backend/procurement_import/service.py#L248)).

Persistence đã có revision identity, parent/binding, digest, disposition, idempotency, operation và canonical snapshot; đây là provenance/domain storage có thể reuse. Nó **không phải raw storage** vì column và repository đều ghi `normalizedSnapshot` vào `canonical_snapshot_json` ([schema](../../backend/db/schema.py#L1872), [repository](../../backend/procurement_import/repository.py#L609)).

## 4. Endpoint graph PLAN và identifiers

### 4.1 Graph production hiện có

```text
planNo: "PLxxxxxxxxxx"
  │
  ├─ POST PLAN_VERSION_LIST (public)
  │    request:  { planNo }
  │    response: versionList[]
  │                ├─ id             → revisionId
  │                ├─ planVersion    → revisionNumber
  │                ├─ planNo         → familyNo
  │                └─ processApply
  │
  └─ for selected revision(s)
       POST PLAN_DETAIL (protected)
         request:  { id: revisionId }
         response:
           ├─ bidPoBidpPlanProjectDetailView
           │    ├─ id
           │    ├─ planNo
           │    └─ planVersion
           └─ bidpPlanDetailToProjectList[]
                ├─ id / idDetail     → package observation/detail id
                ├─ idPlan            → parent plan revision id
                ├─ bidNo             → stable external package candidate
                ├─ planNo
                └─ linkNotifyInfo / notifyNo → notice graph
```

Endpoint paths và protection flag được định nghĩa ở catalog: version-list là `/expose/lcnt/bid-po-bidp-plan-project-view/get-version-list`, public; plan detail là `/expose/lcnt/bid-po-bidp-plan-project-view/get-by-id`, protected ([endpoint catalog](../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs#L7)). Collector map `versionList[].id` thành `revisionId`, `planVersion` thành `revisionNumber`, rồi gọi detail với `{id: revisionId}` ([collector](../../backend/integrations/muasamcong_browser/collectors.mjs#L42), [plan methods](../../backend/integrations/muasamcong_browser/collectors.mjs#L165)).

Response sample trong `WEB_DAU_THAU` xác nhận main plan có `id`, `planVersion`, `planNo`, và package row có đồng thời `id`, `idDetail`, `idPlan`, `bidNo`, `planNo` ([sample plan](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/warehouse/data_example_by_type/Ke_hoach_lua_chon_nha_thau_plan_project/Ke_hoach_lua_chon_nha_thau_plan_project_detail.json#L1-L49)). Canonical mapper hiện ưu tiên `bidNo` làm `stablePackageId`, và `idDetail|id` làm `planDetailRevisionId`, nhưng bỏ `idPlan` ([canonical package mapping](../../backend/integrations/muasamcong_browser/canonical.py#L178)).

### 4.2 Nhánh package-detail còn thiếu

```text
PLAN_DETAIL response của từng revision
  → bidpPlanDetailToProjectList[].idDetail (fallback id)
  → POST /services/lcnt/bid-po-bidp-plan-project-view/
         get-bidp-plan-detail-by-id?token=...
       request: { id: packageDetailId }
       response: raw package-detail JSON
```

**FACT.** Vue snapshot khai báo endpoint này và `loadPkgDetail(pkgId, ...)` POST `{id: pkgId}` kèm token; response chứa ít nhất các nhánh mà code đọc như `resultDTO`, `bidPriceDetail`, `bidpBidLotList` ([endpoint definition](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L497-L500), [request/response use](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L2052-L2088)).

**INFERENCE.** Với sample hiện có, package detail key nên lấy `idDetail`, fallback `id`, vì hai field bằng nhau trong observed response và mapper hiện cũng dùng chúng như package observation ID. Stable storage key phải bao gồm revision context, ví dụ `(revisionId, idDetail)`, không chỉ `bidNo`, để không trộn package giữa revision ([sample](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/warehouse/data_example_by_type/Ke_hoach_lua_chon_nha_thau_plan_project/Ke_hoach_lua_chon_nha_thau_plan_project_detail.json#L43-L49)).

**UNKNOWN.** Không có captured raw response riêng của endpoint package-detail trong hai repo để chứng minh toàn bộ shape hoặc xác nhận endpoint có chấp nhận mọi `idDetail`. Phase implementation cần capture qua client hợp lệ/test fixture tổng hợp, không hardcode schema trước khi lưu raw.

### 4.3 Graph PLAN cần triển khai cho `COMPLETE`

```text
SEARCH exact planNo (protected)
  request payload + raw response
  → exact search record (planNo, type, current id/version)

PLAN_VERSION_LIST (public)
  request {planNo} + raw response
  → all versionList rows

bounded parallel per revision
  PLAN_DETAIL (protected) request {id: revisionId}
  → raw response scoped to revision
  → package rows

bounded parallel per package within revision
  PLAN_PACKAGE_DETAIL (protected) request {id: idDetail || id}
  → raw response scoped to (revisionId, packageDetailId)
```

Search payload/record matching đã có trong collector (`type=es-plan-project-p`, exact `planNo`) nhưng production worker không expose operation `search`; `collect_complete_bundle()` lại yêu cầu caller truyền sẵn một record ([search collector](../../backend/integrations/muasamcong_browser/collectors.mjs#L90), [search method](../../backend/integrations/muasamcong_browser/collectors.mjs#L156), [worker switch](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L41)). Vì vậy cần nối search thành node đầu graph thay vì tin record do frontend gửi.

## 5. Root cause mất dữ liệu

### 5.1 Normalize sớm và drop unknown fields

`MscCollectors.getPlanRevision()` còn trả nguyên `response.data` ở field `raw` ([collector](../../backend/integrations/muasamcong_browser/collectors.mjs#L174)). Ngay tại Python boundary, `get_plan_revision()` lấy raw này, chạy mapper và chỉ trả canonical ([source](../../backend/integrations/muasamcong_browser/procurement_source.py#L335)). `normalize_plan_revision()` chủ động dựng object allowlist và package allowlist; return không chứa raw ([mapper](../../backend/integrations/muasamcong_browser/canonical.py#L157)).

Lookup path lại dựng một DTO mỏng hơn từ canonical, chỉ giữ một số field plan/package ([thin preview](../../backend/integrations/muasamcong_browser/procurement_source.py#L551)). Browser fallback có parser allowlist độc lập với `PACKAGE_FIELDS`, nên unknown upstream field cũng bị bỏ ở fallback ([fallback parser](../../backend/integrations/muasamcong_browser/parsers.py#L16), [plan parser](../../backend/integrations/muasamcong_browser/parsers.py#L123)).

Kết luận: unknown field không làm collector JSON parse lỗi, nhưng bị mất khi vượt source boundary; canonical đang bị dùng như source of truth thực tế.

### 5.2 Complete collector chưa phải Complete Raw Bundle

PLAN branch hiện:

- gọi normalized `listPlanRevisions()` nên không giữ raw version-list;
- fetch từng plan detail trong `for ... await`, tuần tự;
- lưu raw detail dưới flat key `planDetail_XX`, không source envelope;
- không lưu endpoint, request payload, timestamps/hash từng source;
- không gọi package-detail;
- plan version-list/detail không đi qua helper `capture()`, nên lỗi một detail ném ra ngoài và làm mất partial result ([complete collector](../../backend/integrations/muasamcong_browser/collectors.mjs#L375)).

Python wrapper tiếp tục chỉ expose `type`, `fetchedAt`, fingerprint, partial/failures và `sources`; nó không bổ sung entity/revision/package graph hoặc manifest ([wrapper](../../backend/integrations/muasamcong_browser/procurement_source.py#L499)).

### 5.3 Chưa có raw persistence/reprocessing boundary

`procurement_source_revision` có uniqueness, digest và canonical snapshot tốt cho import provenance, nhưng payload ghi là `normalizedSnapshot`; giới hạn column cũng dành cho canonical, không phải source JSON bất định ([schema](../../backend/db/schema.py#L1872), [persist](../../backend/procurement_import/repository.py#L609)). Không có table/abstraction procurement raw snapshot nào trong source hiện tại.

## 6. Root cause chậm

### 6.1 Eager double-browser startup

Chuỗi thực thi xác nhận được:

```text
app lifespan khi PROCUREMENT_LOOKUP_ENABLED=true
  → _initialize_procurement_source()
  → registry.get_muasamcong_source()
  → MuaSamCongProcurementSource.from_environ()
  → NodeBrowserRuntime.__init__()
  → spawn node + initialize
  → worker:
       BrowserLookupRuntime.initialize()
         → Playwright chromium.launch() + giữ context fallback
       MscIntegrationRuntime.initialize()
         → sessionProvider.acquire() prewarm
         → Puppeteer launch để lấy token/cookie, rồi close
```

Nguồn: [lifecycle](../../backend/lifecycle.py#L368), [registry](../../backend/integrations/muasamcong_browser/registry.py#L58), [source factory](../../backend/integrations/muasamcong_browser/procurement_source.py#L91), [Node init](../../backend/integrations/muasamcong_browser/launchers.py#L19), [worker init](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L45), [Playwright init](../../backend/integrations/muasamcong_browser/browser_runtime.mjs#L76), [integration prewarm](../../backend/integrations/muasamcong_browser/integration_runtime.mjs#L18), [Puppeteer refresh](../../backend/integrations/muasamcong_browser/session_provider.mjs#L170).

Fallback đúng là chỉ **được gọi** sau protected API error, nhưng browser fallback đã **được launch** trước đó. Đây là root cause trực tiếp trái yêu cầu protected-API-first/lazy fallback.

### 6.2 L2 chạy trước L1

`_get_cached()` gọi `shared_cache.get()` trước, và chỉ khi L2 miss mới gọi `_get_process_cache()` ([service](../../backend/procurement_lookup/service.py#L181)). `PostgresProcurementLookupCache.get()` mở connection và query `partner_lookup_cache` mỗi lần ([cache](../../backend/procurement_lookup/cache.py#L47)). Do đó một L1 hit hợp lệ vẫn phải chịu DB connection/query nếu shared cache bật.

L2 chỉ nhận stable lookup DTO tối đa 512 KiB, không có cache riêng cho search/version-list/detail/package-detail/raw/complete ([cache contract](../../backend/procurement_lookup/cache.py#L15)). Import gọi source trực tiếp nên không reuse lookup service cache ([import route](../../backend/procurement_import/routes.py#L191)).

### 6.3 IPC serialization và fetch tuần tự

`NodeBrowserRuntime._exchange()` giữ `_lock` xuyên write, flush, blocking read và validate response; toàn process chỉ có một IPC operation in-flight ([launcher](../../backend/integrations/muasamcong_browser/launchers.py#L66)). Worker có `requestId` và async `line` callback, nhưng current Python client không có pending-map/reader-loop để nhận response ngoài thứ tự ([worker](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L208)).

Bên trong một operation, `MscApiClient` có semaphore-like max concurrency và in-flight dedup theo `(profile, operation, payload, forceRefresh)` ([client](../../backend/integrations/muasamcong_browser/api_client.mjs#L19), [concurrency](../../backend/integrations/muasamcong_browser/api_client.mjs#L122)). Tuy vậy PLAN complete và import ALL đều dùng loop/list comprehension tuần tự, nên năng lực đó chưa được sử dụng cho revision/package graph ([collector](../../backend/integrations/muasamcong_browser/collectors.mjs#L389), [import](../../backend/procurement_import/service.py#L270)).

### 6.4 Benchmark không chạy production stack

Live benchmark hiện tạo `BrowserLauncherFactory` + `MuaSamCongBrowserSource`, tức browser extraction path. Production registry lại tạo `MuaSamCongProcurementSource` + protected API runtime trực tiếp. Benchmark cũng chỉ có `cold/warm/cache`, chưa đo L1/L2/session/COMPLETE/concurrency/upstream count theo flow production ([benchmark imports/live stack](../../scripts/benchmark_muasamcong.py#L14), [scenarios](../../scripts/benchmark_muasamcong.py#L82)).

## 7. Session, cache và IPC audit

### 7.1 Session

Điểm có thể reuse:

- token/cookie được cache process-level theo TTL;
- `refreshPromise` coalesce callers đang cùng chờ một refresh;
- có refresh-ahead timer, health metadata và browser cleanup;
- protected request refresh một lần khi gặp 400/401/403 ([session acquire](../../backend/integrations/muasamcong_browser/session_provider.mjs#L99), [refresh schedule](../../backend/integrations/muasamcong_browser/session_provider.mjs#L133), [client refresh](../../backend/integrations/muasamcong_browser/api_client.mjs#L206)).

Các race cần sửa:

- **INFERENCE — timeout không cancel `_refresh()`.** `Promise.race` có thể reject và clear `refreshPromise`, trong khi browser refresh gốc vẫn chạy/mutate cache; caller sau có thể launch refresh thứ hai ([timeout/acquire](../../backend/integrations/muasamcong_browser/session_provider.mjs#L35), [refresh](../../backend/integrations/muasamcong_browser/session_provider.mjs#L170)).
- **INFERENCE — stale response có thể invalidate fresh session.** Nhiều protected request dùng token cũ; một response 401 đến muộn sau refresh đầu có thể gọi `invalidate()` lên session mới rồi khởi động refresh tiếp, vì client không so session generation ([client invalidation](../../backend/integrations/muasamcong_browser/api_client.mjs#L206)).
- `invalidate()` clear cache/timer nhưng không có cancellation/generation guard cho refresh đang chạy ([invalidate](../../backend/integrations/muasamcong_browser/session_provider.mjs#L125)).

### 7.2 Cache

| Layer hiện tại | Dữ liệu | Thứ tự/thực trạng |
|---|---|---|
| Lookup L1 | canonical preview DTO | Có TTL, nhưng bị đọc sau L2 |
| Lookup L2 PostgreSQL | canonical preview DTO | Đọc trước L1; max payload 512 KiB |
| API in-flight | exact operation/payload Promise | Chỉ tồn tại khi request đang chạy |
| Source revision hints | revision ID → normalized hint | Không phải response cache |
| Raw source / complete bundle | Không có | Luôn upstream nếu caller trực tiếp gọi source |

Nguồn: [lookup service](../../backend/procurement_lookup/service.py#L163), [L2](../../backend/procurement_lookup/cache.py#L15), [API in-flight](../../backend/integrations/muasamcong_browser/api_client.mjs#L78), [revision hints](../../backend/integrations/muasamcong_browser/procurement_source.py#L77).

### 7.3 IPC

Process registry và persistent Node worker là nền tảng có thể reuse. Tuy nhiên current protocol là lock-step request/response; nó không thể tận dụng nhiều caller đồng thời và một timeout sẽ invalidate cả process ([registry](../../backend/integrations/muasamcong_browser/registry.py#L58), [process lifecycle](../../backend/integrations/muasamcong_browser/launchers.py#L19)). `stderr=DEVNULL` cũng làm mất diagnostics Node ở process boundary ([spawn](../../backend/integrations/muasamcong_browser/launchers.py#L49)).

## 8. Production, fallback, legacy, dormant và duplicate

| Thành phần | Phân loại | Bằng chứng / ghi chú |
|---|---|---|
| `MuaSamCongProcurementSource` + `MscIntegrationRuntime` + collectors/client/session | **Production happy path** | Registry luôn tạo source này; PLAN lookup/import đi protected API ([registry](../../backend/integrations/muasamcong_browser/registry.py#L58), [source](../../backend/integrations/muasamcong_browser/procurement_source.py#L60)). |
| `MuaSamCongBrowserSource` + `BrowserLookupRuntime` | **Production fallback active** | Chỉ được gọi sau `ProcurementSourceError`, nhưng runtime Playwright bị eager-launch ([fallback](../../backend/integrations/muasamcong_browser/procurement_source.py#L615)). |
| `collect_complete_bundle()` stack trong Bidding | **Dormant/unreachable từ production HTTP flow** | Có source/runtime/worker method nhưng không có route/service caller; cần được nối vào contract mới ([source method](../../backend/integrations/muasamcong_browser/procurement_source.py#L499), [routes](../../backend/procurement_lookup/routes.py#L295)). |
| `MscCollectors.search()` / `MscIntegrationRuntime.search()` | **Dormant trong worker protocol** | Runtime có method nhưng worker switch không expose `search`; lookup production bỏ bước search ([runtime](../../backend/integrations/muasamcong_browser/integration_runtime.mjs#L90), [worker switch](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L41)). |
| `StandardBrowserLauncher`, `ResearchBrowserLauncher`, `BrowserLauncherFactory` | **Script/test/legacy path, không phải registry production** | Production source tạo thẳng `NodeBrowserRuntime`; factory được benchmark/research scripts dùng ([source factory](../../backend/integrations/muasamcong_browser/procurement_source.py#L170), [benchmark](../../scripts/benchmark_muasamcong.py#L141)). |
| `VnepsProcurementSource` | **Configurable legacy/alternate provider, không dead** | Import route vẫn chọn nó khi `PROCUREMENT_PROVIDER=vneps` ([route](../../backend/procurement_import/routes.py#L117)). |
| Provider name `web_dau_thau` | **Config alias duplicate** | Alias trỏ cùng `get_muasamcong_source()`, không phải implementation riêng ([route](../../backend/procurement_import/routes.py#L143)). |
| `canonical.py` và `parsers.py` | **Duplicate mapping active** | Protected API path dùng `ImportParserRegistry`/`canonical.py`; fallback dùng `ParserRegistry`/`parsers.py` ([source init](../../backend/integrations/muasamcong_browser/procurement_source.py#L67), [fallback source](../../backend/integrations/muasamcong_browser/source.py#L20)). |
| Thin DTO mapping trong `procurement_source.py` và fallback `source.py` | **Duplicate presentation mapping** | Hai path tự dựng lookup response riêng, dễ drift field/metrics ([protected DTO](../../backend/integrations/muasamcong_browser/procurement_source.py#L645), [fallback DTO](../../backend/integrations/muasamcong_browser/source.py#L80)). |
| `WEB_DAU_THAU /api/detail/complete` | **Research/reference implementation, không production Bidding** | Nó nhận client-supplied record và dispatch collector; giữ source envelope tốt hơn nhưng PLAN vẫn chỉ version-list + plan detail, chưa package-detail ([route](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L536-L570), [PLAN collector](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L199-L250)). |

## 9. Đối chiếu `WEB_DAU_THAU`

Những capability nên mang sang:

- `createCompleteBundle()` giữ `record`, `index` và `sources` ([server](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L150-L164));
- `captureBundleSource()` lưu endpoint, payload, success/data/error và giữ partial source ([server](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L167-L187));
- `collectVersionedDetails()` giữ raw version-list và current-record fallback nếu list chưa có current ID ([server](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L199-L235));
- endpoint/network clues trong Vue snapshot, đặc biệt package-detail protected call.

Những phần không nên copy nguyên:

- PLAN details vẫn fetch tuần tự và chưa traverse package-detail;
- complete route tin `record` do browser gửi;
- không có auth/org/rate-limit Bidding, storage immutability/dedup, typed errors, bounded concurrency hay cache;
- source envelope chưa redact/separate secret metadata theo policy Bidding;
- token provider của repo nghiên cứu không mạnh hơn session provider Bidding về single-flight.

## 10. Code có thể reuse

1. **Revision domain model.** Reuse `ProcurementImportPreparer._select_revisions()` và `revision_sort_key`; không tạo bộ enum/selector thứ hai ([service](../../backend/procurement_import/service.py#L82), [domain](../../backend/procurement_import/domain.py#L86)).
2. **Source registry/process lifecycle.** Reuse process singleton và config fingerprint, nhưng làm runtime/browser lazy và health-aware ([registry](../../backend/integrations/muasamcong_browser/registry.py#L46)).
3. **Endpoint profile + transport policy.** Reuse `resolveEndpoint`, profile versioning, timeout, response-size limit, retry, circuit, in-flight dedup và bounded concurrency ([catalog](../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs#L146), [client](../../backend/integrations/muasamcong_browser/api_client.mjs#L36)).
4. **Session provider base.** Reuse TTL, cookie/token metadata, refresh-ahead và `refreshPromise`; bổ sung cancellation/generation semantics và bỏ prewarm eager ([session](../../backend/integrations/muasamcong_browser/session_provider.mjs#L47)).
5. **Canonical/domain mappers.** Reuse alias/pick/money/period/package-link logic trong `canonical.py`, nhưng chỉ chạy sau raw capture; hợp nhất mapper fallback để tránh hai implementation ([canonical](../../backend/integrations/muasamcong_browser/canonical.py#L157)).
6. **Lookup service safeguards.** Reuse TTL-by-kind, circuit breaker và in-flight coalescing; sửa cache order và mở rộng cache key bằng detail/revision semantics ([service](../../backend/procurement_lookup/service.py#L144)).
7. **Import provenance/domain persistence.** Reuse `procurement_source_revision`, `procurement_source_binding`, import operation/idempotency và reconcile logic cho canonical/domain output. Raw source cần abstraction riêng, không ghi đè canonical table ([schema](../../backend/db/schema.py#L1872), [command](../../backend/procurement_import/command.py#L261)).
8. **HTTP security boundary.** Reuse auth, workspace/org verification và per-scope rate limits của lookup/import routes ([lookup route](../../backend/procurement_lookup/routes.py#L81), [import route](../../backend/procurement_import/routes.py#L154)).
9. **Observability hooks.** Reuse structured observer ở lookup/source và transport metrics hiện có; mở rộng operation/revision/detail/cache/session fields ([route observer](../../backend/procurement_lookup/routes.py#L46), [source observer](../../backend/integrations/muasamcong_browser/registry.py#L50), [API metadata](../../backend/integrations/muasamcong_browser/api_client.mjs#L245)).

## 11. Code phải sửa/được nối lại

| Khu vực | Thay đổi cần thiết ở phase sau | Lý do từ research |
|---|---|---|
| Frontend lookup/import contracts | Thêm server-owned `detailLevel` và shared `revisionMode`; giữ lookup default tương thích `CANONICAL/LATEST`, import complete có thể dùng `ALL` | Lookup hiện reject mọi field ngoài code/workspace; import đã có revision semantics. |
| Lookup/import routes/services | Tạo một request model chung; route COMPLETE vẫn giữ auth/org/rate-limit; không trả raw lớn mặc định | Hai flow hiện rời nhau và lookup không có revision/detail semantics. |
| `lifecycle.py`, registry, launcher, worker | Không spawn/launch Playwright fallback ở startup; Node/API runtime có thể lazy; session chỉ bootstrap khi protected request thật sự cần | Eager Playwright + Puppeteer đã được xác nhận. |
| `endpoint_catalog.mjs` | Thêm `PLAN_PACKAGE_DETAIL` protected và khai báo graph relation/identifier extractor | Endpoint tồn tại trong portal snapshot nhưng catalog chưa có. |
| `collectors.mjs` | Collector workflow-driven: giữ raw search/version-list/detail/package-detail, source envelope, revision/package scope, manifest, partial error; bounded parallel + deterministic output | Current complete collector flat, sequential, thiếu package graph và partial PLAN. |
| `procurement_source.py` + mapper boundary | Trả/persist raw bundle trước, canonical map sau; không drop unknown field; dùng một mapper path cho protected/fallback | Raw hiện mất tại source boundary và mapper bị duplicate. |
| Database/repository | Thêm immutable raw-source snapshot abstraction với endpoint/request đã redact, raw response, content hash, schema fingerprint, timestamps, revision/package IDs và dedup | Existing table chỉ phù hợp canonical provenance. |
| Cache | Đảo thành L1 → L2 → raw snapshot/source cache → upstream; phân cache theo summary/canonical/raw/complete; import reuse source cache | Current L2-first và chỉ cache preview. |
| Session | Bỏ eager prewarm; giữ single-flight nhưng thêm abort/generation guard, tránh stale-response invalidate session mới | Current timeout/late-response races. |
| IPC | Trước hết đo; nếu concurrency cần, thêm reader loop + pending map theo `requestId` hoặc bounded worker pool; không giữ lock xuyên network operation | Current persistent worker bị serialize toàn bộ. |
| Benchmark | Chạy đúng route/service/`MuaSamCongProcurementSource` production; đo cold/warm session, L1/L2, COMPLETE latest/all, concurrent, upstream/browser/session counters | Script hiện benchmark fallback browser stack khác production. |
| Tests | Thêm fixture `PL2600244105` revisions `00/01`, unknown field preservation, per-revision package isolation, package-detail graph, partial failure, dedup, L1-before-L2, lazy fallback, session single-flight | Không có regression exact code này trong test suite hiện tại. |

## 12. Điểm quyết định kiến trúc cho Phase 2/3

1. `Complete Raw Bundle` phải là output của collector và input của mapper; canonical không được thay thế `sources[*].response`.
2. Source envelope tối thiểu cần: `operation`, endpoint profile/path, request payload đã redact, raw response, `retrievedAt`, content hash, schema fingerprint, success/error classification, revision/package scope.
3. PLAN package identity trong bundle phải revision-scoped. `bidNo` có thể là stable external candidate, nhưng observation key an toàn là `(revisionId, idDetail)` cho tới khi live evidence chứng minh invariant mạnh hơn.
4. `SUMMARY`, `CANONICAL`, `COMPLETE` phải quyết định graph depth trước khi fetch. Lookup mặc định không được chạy full graph.
5. `LATEST | SELECTED | ALL` phải reuse import selector hiện tại và được truyền đến collector; tầng thấp không được tự `max()` rồi bỏ revision khác.
6. Partial failure phải được thu tại từng graph node; source thành công vẫn được persist/return cùng manifest `FOUND_PARTIAL`.
7. Raw snapshot và cache là hai lifecycle khác nhau: snapshot immutable/dedup cho audit/reprocess; cache có TTL/invalidation cho tốc độ.
8. Tối ưu đầu tiên nên là bỏ eager fallback, L1-first, raw/source cache và bounded parallel trong một complete operation. IPC multiplex chỉ triển khai nếu benchmark cho thấy lock-step worker còn là bottleneck.

## 13. Rủi ro và câu hỏi còn mở

- **UNKNOWN:** raw shape đầy đủ của `get-bidp-plan-detail-by-id`, error codes và invariant giữa `id`, `idDetail`, `idPlan` chưa có fixture riêng.
- **UNKNOWN:** live record `PL2600244105` và hai revision `00/01` chưa nằm trong test fixture; không được tuyên bố regression pass ở Phase 1.
- **RISK:** `maxResponseBytes` hiện tối đa 8 MiB trong API client; complete raw storage/IPC có thể cần per-source size policy thay vì tăng vô hạn ([client](../../backend/integrations/muasamcong_browser/api_client.mjs#L53)).
- **RISK:** Node timeout làm runtime chết nhưng registry chỉ fingerprint config, không tự thay runtime dựa trên health; cần recovery policy trước khi tăng concurrency ([launcher invalidation](../../backend/integrations/muasamcong_browser/launchers.py#L121), [registry reuse](../../backend/integrations/muasamcong_browser/registry.py#L58)).
- **RISK:** raw request metadata có token query/cookie nếu lưu nguyên transport request. Bundle phải chỉ lưu logical endpoint/payload và redact header/query secrets.
- **RISK:** complete bundle từ source/research app không phải bằng chứng rằng gọi càng nhiều endpoint càng tốt; package-detail chỉ nên gọi cho package nodes phát hiện từ từng revision.

## 14. Kết luận Phase 1

Production happy path đã có những nền tảng tốt để mở rộng: endpoint profiles, bounded API client, process session reuse, import revision model, reconciliation/idempotency, auth/org/rate-limit và canonical mapper. Không cần rewrite toàn integration.

Điểm cần thay đổi tại gốc là boundary: hiện raw bị normalize rồi bỏ ngay ở `MuaSamCongProcurementSource`, trong khi collector COMPLETE chưa được nối vào production và chưa đi hết PLAN package graph. Đồng thời startup đang trả chi phí browser fallback trước khi cần, cache sai thứ tự L1/L2, và IPC/fetch revisions còn tuần tự. Thiết kế tiếp theo nên mở rộng chính các abstraction hiện có theo hướng:

```text
collect graph lazily
  → preserve immutable raw sources
  → map canonical many times
  → reconcile using existing revision model
  → cache L1-first and reuse source snapshots
```
