# Nghiên cứu runtime trình duyệt Mua Sắm Công

Ngày cập nhật: 2026-08-11

## Phạm vi và mức độ bằng chứng

Nghiên cứu này kết hợp ba nguồn trong workspace:

- tài liệu nghiệp vụ và kế hoạch tích hợp tại `docs/research/` và `docs/`;
- code mẫu trong `WEB_DAU_THAU.zip`, đã được tổng hợp tại `docs/research/WEB_DAU_THAU_CODE_RESEARCH_2026-08-11.md`;
- contract tests và mock browser của adapter mới.

Workspace có Chromium Playwright và ngày 2026-08-11 đã chạy probe on-demand với `PL2600163819`. Nghiên cứu phát hiện route cũ `/web/guest/contractor-selection?render=index` không còn là search route hiện hành; runtime và detail builder đã chuyển sang route công khai `/vi/web/guest/contractor-selection?render=search`. Contract test khóa cả tiền tố locale `/vi` và `render=search`.

Sau khi sửa route và bật profile `research-stealth` trong `.env`, probe server-side vẫn trả `PROCUREMENT_TIMEOUT` trước khi nhận capability DOM. Kiểm tra mạng tách lớp cho thấy DNS phân giải `muasamcong.mpi.gov.vn` thành `103.186.152.30` và TCP/443 mở. Target có lúc timeout, có lúc trả HTTP 200/title `Error`, và một lần OpenSSL policy báo `DH_KEY_TOO_SMALL`; ECDHE-RSA-AES-GCM mạnh vẫn bắt tay TLS 1.2 thành công trong 26–32 ms. Bundled Chromium/installed Edge headless không ổn định, vì vậy không cấu hình `msedge` hoặc hạ security level làm workaround. Runtime chỉ retry navigation transient đúng một lần trong cùng budget.

Một phiên Edge đã kết nối qua browser extension lại tải được portal đầy đủ. Phiên này chỉ được dùng read-only/manual research, không đọc cookie/storage/token. Live DOM xác nhận route, selector, kết quả PL/IB và detail page; nó không thay thế bằng chứng cho server-side worker vì Edge extension có egress khác process Playwright.

Trong phiên live thành công trước đó, page tải `vue-v2.6.14.js`, Vue CDN, Vuelidate và dùng Ant Design Vue DOM. Không thấy `#search-home`, `__vue__` hoặc `__vue_app__` trong isolated inspection world; do đó kết luận chính xác là **Vue 2.6.14 resources từng được quan sát, Vue2 root fast path vẫn REVIEW**. Hai navigation Edge mới sau đó timeout ở `about:blank`, nên evidence cũ không được nâng thành egress guarantee. Generic UI không phụ thuộc root này.

Generic UI live dùng combobox category “Kế hoạch lựa chọn nhà thầu”/“Thông báo mời thầu”, keyword placeholder riêng cho PL/IB và nút search nằm trong `.content`. PL `PL2600163819` và IB `IB2600148033` đều từng trả một exact-family result; portal hiển thị revision suffix `-01`/`-00`. Repeated PL queries sau đó trả 0 dù detail vẫn tồn tại, nên không dùng các lượt này làm benchmark hoặc not-found evidence.

IB detail live xác nhận Liferay routing params `p_p_id`, lifecycle/state/mode, `step`, `stepCode` và allowlisted business routing fields. DOM field rows dùng class source typo `.infomation__content`; extractor đã fixture hóa class này và live-extract thành stable package candidate gồm IB/PL, tên gói, chủ đầu tư, nguồn vốn, lĩnh vực, hình thức/phương thức, loại hợp đồng, thời gian thực hiện, đóng/mở thầu. Candidate live đã đi qua classifier/parser và trả `biddingflow-procurement-preview-v1` bằng strategy `semantic-dom`.

## Trả lời các câu hỏi nghiên cứu

1. **Framework hiện tại?** Vue 2.6.14 resources + Ant Design Vue structure được quan sát live; root/runtime ownership vẫn REVIEW.
2. **Vue2 còn hoạt động?** Vue 2.6.14 script được tải live. `Vue2Driver` hoạt động trong mock; root fast path live chưa xác minh.
3. **`#search-home` còn tồn tại?** Không thấy trên live DOM hiện hành; có trong code mẫu/fixture cũ, vì vậy không được coi là required root.
4. **`__vue__` có dùng được?** REVIEW. Không thấy trong isolated live inspection world; capability detector vẫn giữ bounded probe cho server-side main world.
5. **Search runtime/config nằm ở đâu?** Generic path dùng semantic UI hiện hành. Vue runtime discovery từ `axiosSearch` chỉ còn là optional fast-path clue.
6. **Search JSON schema?** Adapter không khóa vào endpoint/tên wrapper. Classifier tìm candidate theo schema fingerprint và exact `planNo`/`notifyNo` trong JSON bounded.
7. **Detail navigation flow?** Search result live cung cấp Liferay/routing fields; `DetailUrlBuilder` cố định safe portlet params, chỉ nhận allowlist business field, mở detail-v2 và để frontend tự load.
8. **Detail JSON schema?** Parser v1 nhận plan/package shape đã fixture hóa. Tên wrapper có thể đổi; exact identifier và known fields mới quyết định candidate.
9. **KHLCNT có `packages[]` ngay không?** Có trong fixture/code mẫu. Adapter parse danh sách trong một plan load và không mở từng package.
10. **Vue state fallback có dùng được?** PASS trên mock/fixture với bounded traversal (`WeakSet`, depth/object/array/byte limit); REVIEW trên live.
11. **Generic UI fallback có dùng được?** PASS mock/fixture và PASS manual live qua Edge extension cho category/input/search/detail/DOM. Server-side worker vẫn REVIEW do egress.

## Kiến trúc đã kiểm chứng bằng test

- Browser headless và worker Chromium warm/persistent.
- `standard` và `research-stealth` là hai launcher riêng; profile research không có bypass flag.
- Network JSON → Vue state → semantic DOM.
- Exact PL/IB bắt buộc; substring/fuzzy không quyết định.
- Vue2 lỗi liên tiếp sẽ mở circuit trong worker và chuyển sang Generic UI.
- Worker response có deadline; worker treo bị terminate và launcher sẽ tạo runtime mới.
- Different-key lookup có bounded queue admission; same-key vẫn coalesce thành một browser lookup.
- Idle TTL, driver/extractor flags và response size đều do server cấu hình.
- Challenge chỉ trả `PROCUREMENT_INTERACTION_REQUIRED`; không solve, forge hay replay.

## Cách chạy probe dev

Fixture, không cần browser:

```powershell
python scripts/research_muasamcong.py IB2600000002 --fixture tests/fixtures/muasamcong/package_normal.json
```

Một lookup live được cấp phép:

```powershell
python scripts/research_muasamcong.py IB2600000002 --live
```

CLI tự nạp `.env` bằng cùng quy tắc process-environment precedence của các script vận hành khác. Profile local hiện tại là `research-stealth`, worker/overall ceiling 60 giây, navigation 20 giây và action 15 giây.

CLI chỉ xuất capability, count, driver/extractor và latency. Nó không xuất raw response, URL query, cookie, token, browser storage hoặc secret.

## Benchmark

Harness và kết quả fixture được ghi tại `docs/MUASAMCONG_BROWSER_BENCHMARK.md`. Chưa có số liệu cold/warm/cache live. Target trong prompt không được coi là kết quả. Trước GO cần chạy 50–100 mã thật do chủ hệ thống cung cấp, gồm PL thường, PL nhiều gói, IB mới/đóng, not-found và interaction-required; không sinh/enumerate mã tự động.

## Kết luận hiện tại

**REVIEW** cho production live. Core contract, route hiện hành, Generic UI và semantic DOM fallback đã có bằng chứng fixture/mock/manual live. DNS và TCP tới target hoạt động nhưng TLS handshake từ Python/bundled Chromium/Edge headless timeout; TLS tới host chuẩn khác vẫn thành công. Vue2 root, network extraction, server-side worker egress, plan packages-in-one-live-payload và p50/p95 trên 50–100 mã vẫn cần xác minh từ dev/staging có network policy hoàn tất được TLS handshake tới portal.
