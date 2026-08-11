# Tích hợp Mua Sắm Công

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
Khi lookup được bật, startup khởi tạo worker và bắt đầu prewarm phiên ở nền trước
khi nhận traffic; provider tiếp tục làm mới ở nền trước khi TTL hết hạn để
request người dùng không phải chờ Puppeteer bootstrap.

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

E2E import fixture cần cấu hình tài khoản test, bật provider `fixture` và đặt
`VNEPS_PROCUREMENT_FIXTURE_PATH`; CI không gọi live reCAPTCHA/WAF. Luồng opening
được kiểm thử tại HTTP boundary và UI module với normal/lot/1G2T fixtures.

Live external protection không chạy trong CI. Session/browser, fallback,
refresh, parser, secret sanitization và import behavior được kiểm thử bằng mock
tại boundary cùng fixture payload thực tế đã sanitize.
