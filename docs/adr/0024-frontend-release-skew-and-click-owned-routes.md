# ADR 0024 — Tương thích release frontend và tải route theo lần bấm

- Status: Accepted
- Date: 2026-08-28
- Amended: 2026-08-29 — retire service-worker asset interception
- Amended: 2026-08-29 — restore non-blocking primary menu module warming

## Bối cảnh

Một máy khách có thể giữ HTML, service worker hoặc module graph của release N trong khi
origin đã chuyển sang release N+1. Trước quyết định này, secure build xóa toàn bộ `dist`
cũ, deployment không giữ các hashed asset của N, và middleware còn gắn cache một năm
`immutable` cho cả response `404` dưới `/dist/assets/`. Máy gặp đúng cửa sổ chuyển release
vì vậy có thể tiếp tục nhận chunk lỗi trong khi máy khác hoặc phiên ẩn danh tải sau cutover
vẫn hoạt động bình thường. Nếu entry production chưa chạy, diagnostics bên trong app cũng
chưa thể tự khôi phục; triệu chứng là Lucide chưa hydrate và mọi handler chưa được gắn.

Điều tra browser sau đó xác nhận service worker cache-first hiện hành tự tạo một failure mode
khác: shell đăng nhập đăng ký worker, lần tải lại sau đăng nhập trở thành controlled page, rồi
worker intercept toàn bộ fan-out chunk JS/CSS của secure module graph. Trên một số máy, renderer
đi vào trạng thái CPU cao và không hoàn tất module graph dù API đăng nhập và dữ liệu đều phản hồi
nhanh. Cùng kịch bản không treo khi chặn service worker hoặc khi navigation chưa có worker điều
khiển. Vì compatibility asset đã được đảm bảo tại HTTP/deployment bằng cache immutable và tập N−1,
service worker không còn cần sở hữu asset cache.

Các primary tab đã được tách thành route chunk, nhưng module vẫn được tải trước lần bấm do
`pointerenter`/`focusin`/`touchstart` và primary-tab warming. Điều này làm mất semantics
“bấm tab mới tải giao diện”, đồng thời che phản hồi điều hướng trong lần mở đầu tiên.

Sau khi service worker đã được xác nhận là nguyên nhân làm treo module graph và bị retire, đo đạc
trên secure artifact cho thấy semantics click-owned lại đặt 20–350 ms tải/parse route module lên
chính lần bấm đầu tiên. Trên máy hoặc mạng chậm, transition vượt 120 ms và hiển thị trạng thái
loading dù exact page data đã được làm ấm và phần data/render chỉ mất 5–10 ms. Chủ sản phẩm yêu cầu
menu Kế hoạch, Gói thầu và các danh sách chính mở ngay; module warming không dùng service-worker
cache nên không tái tạo failure mode đã điều tra.

## Quyết định

1. Chỉ response thành công của content-hashed asset (`200`, `206`, `304`) được dùng cache
   một năm `immutable`. Response không thành công dưới đường dẫn này luôn là `no-store`.
2. Secure build chạy trực tiếp trong repository snapshot graph N trước khi Vite dọn output,
   sau đó phục hồi nguyên tử đúng các asset được manifest N tham chiếu vào output N+1. Chỉ
   giữ N và N−1; asset N−2 bị loại. Journal checksum ghi lại tập tương thích.
3. Artifact deployment luôn giải nén vào release directory mới. Trước migration và cutover,
   công cụ deploy xác minh digest artifact, toàn bộ inventory/checksum của package mới,
   release ID, sandbox và graph frontend; metadata/asset được chọn từ N cũng được xác minh
   trước khi ghép vào N+1. Không build hoặc giải nén đè lên release đang phục vụ. Lần cài đầu
   vẫn chạy helper để loại asset thừa từ build host và ghi journal không có predecessor.
   Kiến trúc symlink/restart hiện hành phải giữ con trỏ cũ và tự khôi phục/restart nó nếu
   live, ready hoặc smoke login/read-only của candidate thất bại.
4. Route shell độc lập với app nhận biết lỗi entry module ở cả source mode và
   `/dist/assets/app-<hash>.js`, làm mới graph hiện hành rồi reload tối đa một lần cho entry
   release đó. Sau khi app đã chạy, stale dynamic import recovery nhận wording của Chromium,
   Firefox, Safari và Vite CSS preload, vẫn có session guard chống vòng lặp.
5. Sau khi shell hiện hành đã tương tác được, module của các primary menu đang hiển thị được tải
   nền ngay, không chặn loader, đăng nhập, current-route render hay authoritative reconciliation.
   Exact page-data warming vẫn phải chờ reconciliation để không giữ projection stale. Nếu người
   dùng điều hướng trước khi module warming hoàn tất, navigation dùng chung in-flight import và
   readiness gate hiện có; `bf-nav-intent` xuất hiện ngay và waiting state chỉ xuất hiện nếu
   transition vượt 120 ms. Workflow module và lazy HTML partial của detail route vẫn click-owned
   và được khởi động song song khi navigation cần chúng. Không dùng service worker để preload,
   đọc hoặc cache bất kỳ module nào.
6. Khi đã từng phát tán response 404 cache dài, operator phải purge cached error tại CDN sau
   khi origin đã phục vụ asset đúng. Xóa cache trên một máy không thay thế bước này.
7. Service worker trở thành retirement worker không có `fetch` listener, manifest precache,
   `respondWith`, cache read hoặc cache write. Install gọi `skipWaiting()`; activate xóa mọi cache
   có namespace `biddingflow-assets-*`, gọi `clients.claim()` để thay worker cũ trên tab hiện tại,
   rồi tự `unregister()`. Claim chỉ tồn tại trong lifecycle chuyển tiếp; worker không còn sau khi
   activate hoàn tất. Browser regression loop xác nhận registration được claim rồi unregister không
   còn treo; điều gây treo là fetch interception/cache-first graph của worker cũ. Immutable HTTP
   caching, exact N−1 retention và bootstrap stale-graph recovery là các cơ chế duy nhất sở hữu
   compatibility asset sau thay đổi này.

## Ảnh hưởng tương thích

- Không thay đổi API nghiệp vụ, schema, dữ liệu hiển thị, masking/redaction, role, module
  permission, assignment scope, record scope, capability, entitlement hoặc authorization.
- URL hashed hiện hành giữ nguyên; namespace service-worker cũ chỉ còn được nhận diện để xóa khi
  retirement worker activate. Release N tab tiếp tục tải lazy chunk từ tập N−1 tại origin trong
  grace window N+1; reload chuyển sang graph N+1 mà không qua service-worker interception.
- Sau cửa sổ warming, lần bấm primary menu không phát sinh route-module request và dùng exact page
  cache đã được reconcile. Click cực sớm có thể dùng chung import đang chạy; readiness gate,
  stale-transition guard và failure feedback của từng dependency vẫn được bảo toàn.
- Production package chỉ chấp nhận asset ngoài manifest hiện hành khi asset đó nằm trong
  journal N−1 hợp lệ và checksum/size khớp; file thừa hoặc tamper vẫn làm package thất bại.

## Chuyển đổi và quay lui

Không có migration schema hay dữ liệu. Cần chạy lại secure build, restart backend để shell
dùng manifest và retirement worker mới, triển khai theo release directory versioned và purge
cached 404 cũ tại Cloudflare nếu có. Worker mới tự kích hoạt, xóa cache `biddingflow-assets-*`,
claim các tab hiện tại rồi tự gỡ registration; không yêu cầu người dùng xóa cache thủ công. Trước rollback
code, release N được chuẩn bị lại với N+1
(đang phục vụ) là previous release, để giữ graph N+1 và loại predecessor cũ hơn;
sau đó symlink mới chuyển atomically về N. Không hạ schema.

Có thể quay lui riêng module warming mà không thay đổi dữ liệu hoặc schema, nhưng việc đó tái tạo
loading ở lần bấm primary menu và cần đo lại browser gate. Không được quay lui `no-store` cho asset
lỗi, deployment N−1 hoặc service-worker retirement. Khôi phục fetch interception cần một ADR mới
cùng browser regression loop chứng minh không tái tạo startup crash.

## Kiểm thử hồi quy

- Middleware: hashed asset `200` vẫn immutable; cùng URL trả `404` phải `no-store`.
- Build/deploy: giữ đúng asset manifest N, phát hiện tamper/collision, loại N−2 và ghi journal.
- Bootstrap: production entry failure làm mới graph và reload đúng một lần; lần sau hiện fatal
  fallback có thể thao tác thay vì để shell chết im lặng.
- Diagnostics: nhận diện wording stale bundle trên các browser và chỉ gửi path asset đã lọc.
- Service worker: install gọi `skipWaiting`; activate xóa toàn bộ cache asset cũ, claim client rồi
  unregister; source không có fetch interception, manifest precache, `respondWith`, `cache.match`
  hay `cache.put`. Browser login loop phải xanh khi service worker được phép hoạt động.
- Primary tab: module của menu đang hiển thị được warm đúng một lần sau shell, không chờ
  reconciliation; page data chỉ warm sau reconciliation. Browser gate phải xác nhận sau cửa sổ
  warming không còn script route nào bắt đầu từ click, không waiting/skeleton, không duplicate
  pagination và tổng transition không vượt 100 ms.
- Detail tab: click vẫn khởi động đúng một lần các dependency còn thiếu, đồng thời khởi động
  view/workflow/partial mà không chờ tuần tự, giữ pane cũ và waiting feedback trong khi dependency
  bị chặn, rồi activate/render và dọn feedback khi tất cả hoàn tất.
