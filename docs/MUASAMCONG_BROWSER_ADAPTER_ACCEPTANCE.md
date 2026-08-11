# Acceptance audit — Mua Sắm Công browser adapter

Ngày audit: 2026-08-11

Quy ước: **PASS** có bằng chứng current worktree/test; **REVIEW** cần môi trường live; **N/A** là mục tương lai được prompt ghi rõ.

| Yêu cầu | Trạng thái | Bằng chứng |
|---|---|---|
| Nghiên cứu BiddingFlow | PASS | Hai tài liệu đầu vào và contract/workflow hiện hữu đã được đối chiếu trong ADR/research |
| Nghiên cứu WEB_DAU_THAU | PASS | `docs/research/WEB_DAU_THAU_CODE_RESEARCH_2026-08-11.md` |
| Headless Chromium | PASS | launcher/runtime contract tests |
| Browser warm/persistent | PASS | worker reuse test; idle TTL test |
| Standard/Research launcher tách biệt | PASS | factory isolation test; research host gate |
| Research mode configurable | PASS | `.env.example`, startup validation |
| Cấu hình startup/runtime không lệch nhau | PASS | một immutable settings loader; cache/browser bounds sai sẽ fail startup; worker có ≥5 giây headroom trước HTTP timeout |
| Feature flag đồng bộ backend/UI | PASS | session capability chỉ quảng bá khi enabled; lookup buttons ẩn khi disabled |
| Import capability không overclaim | PASS | connector revision-import fail-closed không được quảng bá; nút import cũ ẩn khi source không usable |
| CAPTCHA/token/challenge bypass | PASS (không triển khai) | challenge trả `PROCUREMENT_INTERACTION_REQUIRED`; không có bypass flags |
| Capability detection | PASS Generic live; REVIEW Vue root | live placeholder/category/detail signals; server-side Vue capability vẫn bị egress chặn |
| Vue2 fast path | PASS fixture/mock; REVIEW live | `Vue2Driver`, `DriverRegistry` tests |
| Generic UI fallback | PASS fixture/mock/manual live; REVIEW worker egress | PL/IB category, exact-family search và scoped input/button đã chạy trên live Edge |
| Network-centric extraction | PASS | exact payload collector/classifier tests |
| Vue state fallback | PASS | bounded Vue traversal fixture/test |
| Semantic DOM fallback | PASS fixture + manual live | `.infomation__content` live candidate đã normalize thành stable DTO |
| Exact PL/IB | PASS contract/manual live; REVIEW worker | canonical revision suffix `-NN` được chấp nhận; wrong family/prefix bị loại |
| Classifier/parser dùng cùng artifact invariant | PASS | bounded traversal và exact-family helper dùng chung |
| Payload classifier/schema fingerprint | PASS | renamed wrapper, drift and endpoint-independent tests |
| Driver/Extractor/Parser separation | PASS | `DriverRegistry`, `ExtractorRegistry`, `ParserRegistry` |
| Versioned adapters/parsers | PASS | `2026.1` driver/parser resolution tests |
| Frontend-driven detail navigation | PASS mock/manual live | fixed Liferay params + allowlisted routing fields; IB detail-v2 tải live |
| Plan packages trong một load | PASS | plan fixtures including many packages |
| Stable normalized DTO | PASS | plan/package contract tests |
| Raw portal schema không vào BiddingFlow | PASS | route allowlist + frontend stable DTO client |
| Shared → process → browser cache | PASS | PostgreSQL shared cache and service tests |
| TTL PLAN/open/closed riêng | PASS | TTL classification test/config |
| Same-key coalescing | PASS | concurrent service test |
| Max concurrent browser lookup = 1 | PASS | worker lock + bounded different-key admission test |
| Circuit breaker | PASS | service circuit + Vue2 fast-path circuit tests |
| Không fixed delay/crawl/static token | PASS | source audit và bounded on-demand scripts |
| Network transient retry tối đa 1 | PASS | navigation budget split, timeout/error-page retry contract tests; challenge không retry |
| Instrumentation | PASS | startup/navigation/action/network/extract/normalize/total metrics |
| Timeout/error taxonomy | PASS | route/runtime/worker tests |
| Preview trước Apply | PASS | modal + comparison rows tests |
| Default apply chỉ field trống | PASS | UI mapping tests |
| Không auto-save/version/status/assignee | PASS | apply seam only mutates selected controls; stale draft guard |
| Abort/debounce/stale guards | PASS | client/wizard tests |
| Accessibility/responsive 320px | PASS | Chromium 320×720 verifier: no page overflow, 44px targets, no serious/critical axe violations |
| CI fixtures/contract tests | PASS | required seven fixtures + JS/Python suites |
| Research CLI | PASS | single-code filtered probe/fixture modes |
| Research document | PASS | `docs/MUASAMCONG_BROWSER_RUNTIME_RESEARCH.md` |
| Architecture ADR | PASS | `docs/adr/ADR_MUASAMCONG_BROWSER_LOOKUP.md` |
| Benchmark harness | PASS | cold/warm/cache harness + fixture report |
| Benchmark live 50–100 | REVIEW | target unreachable; 43 canonical operator-provenance codes đã được validate local, còn thiếu 7; không có số liệu giả |
| Production packaging | PASS | Playwright production dependency, `.mjs` allowlist, package tests |
| Startup/deploy validation | PASS | enabled-mode validation and deployment docs |
| Secrets/log sanitation | PASS | URL redaction, bounded structured events, security lint |
| Vue3/React/parser upgrade path | PASS | registry seams và ADR |
| OfficialApiSource | N/A future | ADR định hướng mTLS/workload identity khi endpoint nội bộ được cung cấp |

## Live evidence

- Route cũ `render=index` được thay bằng route công khai hiện hành `/vi/web/guest/contractor-selection?render=search`; search/detail route có contract test.
- `PL2600252503`, `research-stealth`: lookup UI thật tái hiện HTTP 504; direct CLI với navigation 8 giây trả `PROCUREMENT_TIMEOUT` trước driver/parser.
- DNS hệ thống, Google DNS và Cloudflare DNS cùng trả `103.186.152.30`. TCP/443 kết nối được; ba Python TLS handshake liên tiếp timeout 5 giây trong khi cùng runtime bắt tay TLS 1.3 với `www.microsoft.com` trong khoảng 80 ms.
- Một lần target trả `[SSL: DH_KEY_TOO_SMALL]`; khi client chỉ offer ECDHE-AES-GCM mạnh, TLS 1.2 bắt tay thành công trong 26–32 ms. Điều này chỉ ra TLS server/cipher preference không ổn định: upstream cần disable weak DHE và ưu tiên ECDHE, không hạ security level ở client.
- Bundled Chromium cho một trang title `Error` rồi timeout; standalone Edge headless timeout 2/2. Edge extension từng tải được live page trong phiên trước, nhưng hai navigation mới đều timeout ở `about:blank`; bằng chứng cũ là time-bound và không chứng minh server channel, nên `msedge` không được dùng làm workaround.
- Một đường fetch ngoài máy đọc được trang công khai gần đây, nên không có bằng chứng target down toàn cục; blocker vẫn được khoanh ở network path/policy từ máy dev.
- WinHTTP direct, chỉ Wi-Fi up, không có outbound Windows Firewall rule riêng cho Python/Node/Playwright Chromium; evidence hiện tại chỉ ra target-specific TLS/SNI/remote-policy path.
- Retry navigation đúng một lần đã triển khai; direct CLI với tổng budget 8 giây vẫn trả `PROCUREMENT_TIMEOUT`, nên retry không được dùng để overclaim egress.
- Live scripts gồm Vue 2.6.14/Vuelidate và DOM Ant Design Vue; không thấy `#search-home` trong isolated inspection world.
- Generic UI live tìm PL/IB, chuyển đúng category, dùng scoped keyword/search controls và mở IB detail.
- DOM extractor live trả candidate cho `IB2600148033`; classifier/parser trả stable DTO bằng `semantic-dom`.
- Repeated PL queries có lúc trả 0 dù detail tồn tại; không suy diễn not-found và không dùng làm benchmark.
- Không solve/replay/forge challenge; research mode vẫn dùng exact official host allowlist.

## Final report theo mục 64

```text
Current portal framework: Vue 2.6.14 resources + Ant Design Vue DOM observed live; root ownership REVIEW
Vue2 detected: YES ở script resources; runtime root fast-path REVIEW
Vue2 root: #search-home không thấy live; __vue__ không thấy trong isolated inspection world

Vue2Driver: PASS fixture/mock; REVIEW live
GenericUiDriver: PASS fixture/mock/manual live; REVIEW server worker egress
Network extraction: PASS fixture/contract; REVIEW live
Vue fallback: PASS fixture/mock; REVIEW live
DOM fallback: PASS fixture/mock/manual live (IB detail → stable DTO)
PL exact lookup: PASS contract/manual live search; REVIEW full server worker
IB exact lookup: PASS contract/manual live search/detail; REVIEW full server worker

Plan fields: 10/10 contract fields; live completeness REVIEW
Package fields: 20/20 minimum contract fields; live completeness REVIEW
Plan package list in single load: YES fixture/mock; REVIEW live

Browser cold p50: N/A live
Browser cold p95: N/A live
Warm lookup p50: N/A live
Warm lookup p95: N/A live
Cache p95: N/A live

Driver usage: fixture only — Vue2 40%, Generic 60%; live N/A
Extractor usage: fixture only — Network 60%, Vue 20%, DOM 20%; live N/A
Interaction-required rate: live N/A
Schema error rate: live N/A

Upgrade resilience:
- Vue2 variable rename: schema fingerprint/exact identifier không phụ thuộc tên variable
- Vue2 unavailable: GenericUiDriver fallback
- Generic UI fallback: semantic locator registry, versioned driver seam
- Parser version fallback: ParserRegistry + explicit adapter-unsupported failure

Recommended: REVIEW
```

Verification sau timeout hardening: Python `975 passed`, JavaScript `687 passed`, JS coverage ratchet PASS, secure build PASS, UI 320×720 PASS, production package smoke PASS, security/encoding/module/quality gates PASS, npm audit full/production `0 vulnerabilities`, `git diff --check` PASS.

## Kết luận

Implementation/fixture acceptance: **PASS**. Production live acceptance: **REVIEW** cho đến khi target truy cập được từ môi trường dev và benchmark có 50–100 mã thật.
