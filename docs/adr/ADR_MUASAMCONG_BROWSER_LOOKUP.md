# ADR: Mua Sắm Công browser lookup qua stable procurement contract

- Trạng thái: Accepted for PoC, production remains REVIEW
- Ngày: 2026-08-11

## Bối cảnh

BiddingFlow cần tra cứu on-demand một mã PL/IB và đưa dữ liệu vào preview trước khi người dùng chọn field áp dụng vào draft. Frontend nguồn có thể thay framework hoặc đổi tên biến/runtime. Hệ thống không được bulk crawl, enumerate mã, phụ thuộc static token/cookie hay để raw schema nguồn lan vào workflow nội bộ.

## Quyết định

Public seam là `ProcurementLookupService.lookup(code)`. Nguồn browser trả contract `biddingflow-procurement-preview-v1`; form BiddingFlow chỉ biết contract này.

Adapter được tách theo trách nhiệm:

```text
BrowserLauncher → CapabilityDetector → Driver
              → Network/Vue/DOM Extractor
              → PayloadClassifier → Versioned Parser → Stable DTO
```

Các implementation được resolve qua `DriverRegistry`, `ExtractorRegistry` và
`ParserRegistry`; key registry luôn kèm version adapter/parser.

### Vì sao browser-hosted runtime

Browser cho frontend nguồn tự thực hiện search/detail bằng runtime và cấu hình hiện hành. Adapter quan sát structured JSON thay vì sao chép static token/cookie hoặc reverse-engineer toàn bộ protocol.

### Vì sao Vue2 chỉ là fast path

`__vue__`, `axiosSearch` và `#search-home` là clue từ code mẫu, không phải contract. Chỉ `Vue2Driver` biết các chi tiết này. Khi Vue2 không usable hoặc lỗi lặp lại, circuit tạm bỏ fast path và dùng `GenericUiDriver`.

### Vì sao network-centric

JSON có cấu trúc ổn định hơn text trình bày. Candidate được chấm theo exact identifier và schema fingerprint, không theo một endpoint name duy nhất. Vue state và semantic DOM là fallback có giới hạn.

### Vì sao Driver/Extractor/Parser tách rời

Driver trả lời cách khiến frontend lookup; Extractor trả lời dữ liệu đã tải nằm ở đâu; Parser chuyển schema nguồn sang contract ổn định. Việc đổi UI, đổi wrapper hoặc thêm parser version không buộc sửa form/workflow.

Các invariant dùng chung không bị lặp giữa các lớp: `procurement_lookup/config.py` là nguồn cấu hình đã validate duy nhất cho startup/HTTP/browser; `muasamcong_browser/artifacts.py` giữ traversal bounded và exact PL/IB family matching cho cả classifier lẫn parser. Vì vậy đổi giới hạn, mặc định hoặc quy tắc canonical không tạo hai hành vi lệch nhau.

### Launcher modes

`StandardBrowserLauncher` và `ResearchBrowserLauncher` tách riêng qua factory/config. `research-stealth` được giữ như profile tương thích nghiên cứu, nhưng không chứa CAPTCHA solver, token forging/replay, challenge bypass, `--disable-web-security` hay `--no-sandbox`.

Nếu challenge xuất hiện, adapter fail closed với `PROCUREMENT_INTERACTION_REQUIRED` để người vận hành xử lý qua kênh được cấp phép.

### Hướng tích hợp ưu tiên khi hai hệ thống cùng sở hữu

Khi Mua Sắm Công và BiddingFlow cùng miền quản trị, hướng production ưu tiên là thêm `OfficialApiSource` dùng endpoint nội bộ allowlist và workload identity/mTLS hoặc service account có scope read-only. Source này phải trả cùng DTO, dùng cùng cache/preview/apply seam và không cấp frontend quyền điều khiển credential. Browser source giữ vai trò fallback/PoC cho đến khi API được cung cấp.

## Bất biến an toàn

- Chỉ lookup một mã do user nhập; không pagination crawler hay loop vô hạn.
- Exact PL/IB bắt buộc.
- Không log raw body, cookie, Authorization, token, browser storage hay URL query.
- Request frontend chỉ nhận `code` và `workspaceLease`; mode/driver/raw data do server sở hữu.
- Apply chỉ dispatch input/change cho field được chọn; không submit, save, version, status, assignee hoặc permissions.
- Worker có timeout, response-size limit, idle TTL, same-key coalescing và circuit breaker. Worker timeout phải thấp hơn HTTP lookup timeout ít nhất 5 giây để error taxonomy được trả về trước khi HTTP boundary cắt request.
- Navigation timeout hoặc upstream error page được retry đúng một lần, không fixed delay và không mở rộng tổng navigation budget. Challenge không retry và vẫn fail closed.
- Cache lookup theo thứ tự PostgreSQL shared cache → process cache → browser; key
  gồm provider/kind/canonical code/parser version và TTL tách PLAN/open/closed package.

## Nâng cấp

- Vue2 variable rename: runtime discovery + schema fingerprint; không sửa business workflow.
- Vue2 mất: Generic UI fallback; có thể thêm `Vue3Driver`/`ReactDriver`.
- UI đổi nhưng JSON giữ: thay Driver/selector.
- JSON đổi: thêm `PlanParserV2`/`PackageParserV2`, giữ parser cũ và fixture regression.
- API nội bộ có sẵn: thêm `OfficialApiSource`, không sửa form/cache/DTO.

## Hệ quả

PoC có nhiều module nhỏ và cần fixture/contract tests, nhưng giảm coupling với frontend nguồn. Production cần cài Node production dependencies và Chromium binary, chạy live probe/benchmark được cấp phép, rồi mới chuyển khuyến nghị từ REVIEW sang GO.
