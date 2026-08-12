# Tích hợp Mua Sắm Công

## Complete Raw Bundle v2

`POST /api/procurement/lookup` giữ tương thích request cũ và nhận thêm các
field được server kiểm tra:

```json
{
  "code": "PL2600244105",
  "detailLevel": "COMPLETE",
  "revisionMode": "ALL",
  "revisionNumbers": []
}
```

- `detailLevel`: `SUMMARY`, `CANONICAL`, hoặc `COMPLETE`; mặc định `CANONICAL`.
- `revisionMode`: `LATEST`, `SELECTED`, hoặc `ALL`; mặc định `LATEST`.
- `revisionNumbers` chỉ được dùng và là bắt buộc với `SELECTED`.
- Caller cũ chỉ gửi `code` vẫn nhận normalized preview như trước và không nhận
  raw JSON.

PLAN `COMPLETE` đi theo endpoint graph
`SEARCH -> PLAN_VERSION_LIST -> PLAN_DETAIL -> PLAN_PACKAGE_DETAIL`. Edge cuối
dùng `idDetail` thuộc revision, fallback sang `id`. Mỗi response nằm trong
source envelope gồm operation, endpoint, request đã sanitize, response nguyên
vẹn, content hash, schema fingerprint, timestamp và success/error metadata.
Các request revision/package độc lập chạy bounded concurrency.

NOTICE/PACKAGE `COMPLETE` đi theo graph có điều kiện:

```text
SEARCH -> NOTICE_VERSION_LIST -> NOTICE_DETAIL
                              -> NOTICE_TENDER_INFO / HSMT / sidecars
                              -> linked PLAN / PLAN_PACKAGE_DETAIL
                              -> OPENING_NOTIFY / ROUND / BID
                                   -> LOT / LOT_DETAIL khi isMultiLot
                                   -> FINANCIAL_DETAIL khi 1_HTHS đã mở tài chính
                              -> TECHNICAL_RESULT / SELECTION_RESULT khi có ID
       -> NOTICE_CONTRACT_LIST
```

`packType=0` dùng cho một túi, `packType=1` cho hồ sơ kỹ thuật và
`packType=2` cho hồ sơ tài chính. API lô không được gọi cho gói không có lô;
nhánh tài chính không được gọi trước khi trạng thái vòng thầu cho phép. Các
sidecar rỗng hợp lệ được ghi nhận là nguồn đã kiểm tra, không làm bundle thành
`FOUND_PARTIAL`.

Canonical NOTICE được map lại hoàn toàn từ raw bundle: thông tin TBMT, giá và
nguồn vốn, bidder/lô và các giai đoạn mở thầu, danh sách đạt kỹ thuật, KQLCNT,
cùng hợp đồng. Mỗi nhóm field có provenance theo operation/revision. Raw response
không được trộn trực tiếp vào canonical và vẫn được giữ nguyên trong source
envelope để có thể remap khi parser thay đổi. Snapshot NOTICE fresh được ráp lại
theo `L1 -> L2 -> RAW_SNAPSHOT -> upstream` giống PLAN.

Bundle complete được lưu server-side thành các row append-only trong
`procurement_raw_snapshot`. Unique `(organization, provider, dedup_key)` tránh
snapshot trùng; response thay đổi tạo snapshot mới. Trigger immutable chặn
update/delete. Canonical v2 chỉ là projection và có thể được tạo lại bằng
`MuaSamCongProcurementSource.map_plan_raw_bundle()` mà không gọi upstream.

Lookup COMPLETE dùng thứ tự `L1 -> L2 -> RAW_SNAPSHOT -> upstream`. Cache key
được namespace theo organization; raw snapshot chỉ được dùng khi còn fresh,
search/version-list chứng minh đủ revision được yêu cầu và mọi package quan sát
được có source package-detail. Snapshot thiếu hoặc stale luôn rơi xuống upstream.

Browser được lazy-load: worker initialization không khởi chạy Playwright
fallback hoặc Puppeteer session bootstrap. Public endpoint không cần session;
protected request đầu tiên acquire session qua single-flight provider hiện có.
Playwright chỉ khởi chạy sau khi protected-API lookup cần fallback.

## Kiến trúc

```text
Frontend
  → Bidding API (auth, workspace, permission, rate limit)
  → ProcurementSource
  → Plan / Notice / Opening collectors
  → MscApiClient
  → MscSessionProvider
  → Mua Sắm Công
```

Worker Node chạy nội bộ bằng stdin/stdout JSONL; không mở cổng HTTP. Một worker
được dùng chung cho lookup, import kế hoạch, import TBMT và biên bản mở thầu.
Token/cookie chỉ tồn tại trong bộ nhớ worker. PostgreSQL, response frontend,
log và diagnostic không chứa token/cookie.

Lookup ưu tiên protected API. Khi đường này không khả dụng, cùng source gọi
browser runtime theo thứ tự
`network JSON → Vue2 → Vue3 → React state → semantic DOM`;
không có adapter lookup song song ở tầng nghiệp vụ.

## Mapping từ `WEB_DAU_THAU`

| Nguồn | Đích | Cách xử lý |
|---|---|---|
| `mscTokenProvider.js` | `session_provider.mjs` | Port browser launch, UA, CSP bypass, network token capture, cookie, TTL, force refresh, `window.stop()` và reCAPTCHA fallback; thêm single-flight |
| `buildMscHeaders()` | `api_client.mjs` | Port header/cookie/referer server-side |
| `callProtectedMscApi()` | `api_client.mjs` | Port token query, 400/401/403 refresh rồi retry; thêm timeout/size/retry bounds |
| endpoint constants | `endpoint_catalog.mjs` | Profile semantic `2026.08` |
| `collectVersionedDetails()` | `collectors.mjs` | Tất cả revision, không chỉ latest |
| `collectPlanCompleteBundle()` | `MscCollectors` + canonical parser | Plan revision và packages |
| `collectTenderCompleteBundle()` | `MscCollectors` | LDT/KHAC/ADB/WB, opening, technical/result endpoints |
| `collectLdtBidOpening()` | `getOpeningBundle()` | notify/round/bid/lot/lot detail; 1G2T tách technical/financial |
| Express/SQLite/UI | Không port | Bidding vẫn là application authority |

## Session lifecycle

`MscSessionProvider.acquire()` trả cache còn hạn hoặc chờ cùng refresh promise.
Refresh dùng Puppeteer/Chromium với cấu hình đã port từ nguồn, đóng browser ở
`finally`, và không trả secret qua JSONL health metadata. Khi protected API trả
400/401/403, client invalidate session, refresh đúng một lần rồi gọi lại.
Khi lookup được bật, startup chỉ khởi tạo worker IPC; không launch Playwright và
không prewarm Puppeteer. Protected request đầu tiên bootstrap session; các
request sau reuse session đó. Provider tiếp tục làm mới ở nền trước khi TTL hết
hạn và coalesce concurrent refresh bằng cùng một promise.

## Endpoint profile và parser

`endpoint_catalog.mjs` là nơi duy nhất chứa path upstream. Business code chỉ gọi
semantic operation như `PLAN_DETAIL`, `NOTICE_LDT_DETAIL`, `OPENING_BID`.

Collector tạo fingerprint `plan:v1:*`, `package-notice:v1:*`, `opening:v1:*`,
`result:v1:*`.
`ImportParserRegistry` chọn parser bất biến theo fingerprint. Khi upstream có
shape mới, thêm fixture mới và parser version mới; không sửa parser cũ. Alias
field tập trung tại `canonical.pick()`.

Parser mới có thể đăng ký bằng `ImportParserRegistry.register_shadow()` và bật
`MUASAMCONG_SHADOW_PARSER_ENABLED=true`. Shadow chỉ so sánh output và ghi
diagnostic `DIFF/ERROR`; kết quả production luôn lấy từ parser active.

Unknown schema trả `PROCUREMENT_SCHEMA_CHANGED`, không giả thành `NOT_FOUND`.
Nếu diagnostics được bật, artifact chỉ chứa JSON shape/type đã sanitize.

## Versioning và import

- Plan `ALL` được sắp xếp cũ → mới và dùng reconciler hiện hữu.
- Package không đổi giữ nguyên version; package đổi tăng version; package mới
  bắt đầu `00`; package bị bỏ không xuất hiện trong snapshot mới nhưng lịch sử
  không bị xóa.
- Source revision và local version độc lập. Backfill được ghi
  `OBSERVED_NOT_APPLIED` và không rollback latest.
- TBMT `ALL` dùng durable operation có cursor/resume/idempotency như plan.
- Mỗi provenance revision lưu liên kết `operation_id` của durable operation;
  resume tiếp tục dùng cùng operation này.
- Package version mới clone aggregate local (assignment, opening, contractor,
  lot và dữ liệu local khác) trước khi áp source-owned fields.
- Opening dùng `Fetch → Preview → Apply draft → Save`. Apply kiểm tra package
  row-version server-side. Technical và financial 1G2T được đưa vào hai màn
  hình riêng, không trộn dữ liệu.

## Cấu hình

Các biến chính nằm trong `.env.example`:

- `PROCUREMENT_LOOKUP_ENABLED=true`
- `PROCUREMENT_RAW_CACHE_TTL_SECONDS` (freshness window before COMPLETE refetches)
- `PROCUREMENT_IMPORT_ENABLED=true`
- `PROCUREMENT_PROVIDER=muasamcong`
- `MUASAMCONG_BROWSER_EXECUTABLE_PATH` (tùy chọn; worker dùng Chromium của
  Playwright khi bỏ trống)
- `MUASAMCONG_BROWSER_HEADLESS`
- `MUASAMCONG_DRIVER_VUE2`, `MUASAMCONG_DRIVER_GENERIC`
- `MUASAMCONG_EXTRACT_NETWORK`, `MUASAMCONG_EXTRACT_VUE`,
  `MUASAMCONG_EXTRACT_VUE3`, `MUASAMCONG_EXTRACT_REACT`,
  `MUASAMCONG_EXTRACT_DOM`
- `MUASAMCONG_ENDPOINT_PROFILE` (profile hiện có: `2026.08`)
- `MUASAMCONG_SESSION_TTL_SECONDS`
- `MUASAMCONG_SESSION_TIMEOUT_SECONDS`
- `MUASAMCONG_API_TIMEOUT_SECONDS`
- `MUASAMCONG_API_RETRIES`
- `MUASAMCONG_CIRCUIT_SECONDS`
- `MUASAMCONG_MAX_CONCURRENCY`
- `MUASAMCONG_API_QUEUE_TIMEOUT_MS`
- `MUASAMCONG_WORKER_TIMEOUT_SECONDS`
- `MUASAMCONG_WORKER_QUEUE_TIMEOUT_MS`
- `MUASAMCONG_REQUEST_TIMEOUT_SECONDS`
- `MUASAMCONG_MAX_RESPONSE_BYTES`
- `MUASAMCONG_DIAGNOSTICS_ENABLED`
- `MUASAMCONG_DIAGNOSTICS_DIR`
- `MUASAMCONG_SHADOW_PARSER_ENABLED`

Node dependency: `puppeteer@24.34.0` và Chromium/Chrome. Production package cần
có browser executable hoặc đặt đường dẫn rõ ràng.

## Health và debug upstream

`GET /api/procurement/health` yêu cầu đăng nhập và trả một trong các trạng thái:
`UP`, `SESSION_DEGRADED`, `API_CHANGED`, `SCHEMA_CHANGED`, `FRONTEND_CHANGED`,
`PARTIAL`, `DOWN`.
Health không trả token/cookie.

Khi schema đổi:

1. bật diagnostics trong môi trường kiểm thử;
2. lấy artifact shape đã sanitize;
3. thêm fixture dưới `tests/fixtures/muasamcong/`;
4. thêm parser version và registry entry;
5. chạy contract/regression tests trước khi đổi parser active.

## Kiểm thử

```powershell
node --test tests/js/muasamcong_session_transport.test.mjs
python -m pytest -q tests/test_muasamcong_integration_source.py
python -m pytest -q tests/test_procurement_import_service.py tests/test_procurement_import_command.py
npm run check:static
npm run test:e2e:smoke
```

Benchmark fixture xác định (không gọi mạng):

```powershell
python scripts/benchmark_muasamcong.py `
  --input tests/fixtures/muasamcong/benchmark_sample.json `
  --fixtures --concurrency 4
```

Benchmark live dùng đúng `MuaSamCongProcurementSource` production và chỉ nhận
50-100 mã do operator cung cấp. Bật lookup trong môi trường non-production rồi
chạy với file input riêng:

```powershell
python scripts/benchmark_muasamcong.py `
  --input .\tmp\muasamcong-live-codes.json `
  --live --concurrency 4 --output .\tmp\muasamcong-live-report.json
```

Report v2 luôn tách các scenario `coldWorkerColdSession`,
`warmWorkerColdSession`, `warmSession`, `l1Hit`, `l2Hit`, `completeLatest`,
`completeAll` và `concurrentX<N>`; mỗi record có cache layer, browser/session
counter, upstream request/network, normalize/mapping duration và partial count.

E2E import fixture cần cấu hình tài khoản test, bật provider `fixture` và đặt
`VNEPS_PROCUREMENT_FIXTURE_PATH`; CI không gọi live reCAPTCHA/WAF. Luồng opening
được kiểm thử tại HTTP boundary và UI module với normal/lot/1G2T fixtures.

Live external protection không chạy trong CI. Session/browser, fallback,
refresh, parser, secret sanitization và import behavior được kiểm thử bằng mock
tại boundary cùng fixture payload thực tế đã sanitize.
