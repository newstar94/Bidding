# ADR 0024 — Tương thích release frontend và tải route theo lần bấm

- Status: Accepted
- Date: 2026-08-28

## Bối cảnh

Một máy khách có thể giữ HTML, service worker hoặc module graph của release N trong khi
origin đã chuyển sang release N+1. Trước quyết định này, secure build xóa toàn bộ `dist`
cũ, deployment không giữ các hashed asset của N, và middleware còn gắn cache một năm
`immutable` cho cả response `404` dưới `/dist/assets/`. Máy gặp đúng cửa sổ chuyển release
vì vậy có thể tiếp tục nhận chunk lỗi trong khi máy khác hoặc phiên ẩn danh tải sau cutover
vẫn hoạt động bình thường. Nếu entry production chưa chạy, diagnostics bên trong app cũng
chưa thể tự khôi phục; triệu chứng là Lucide chưa hydrate và mọi handler chưa được gắn.

Các primary tab đã được tách thành route chunk, nhưng module vẫn được tải trước lần bấm do
`pointerenter`/`focusin`/`touchstart` và primary-tab warming. Điều này làm mất semantics
“bấm tab mới tải giao diện”, đồng thời che phản hồi điều hướng trong lần mở đầu tiên.

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
5. Primary route module không được import bởi idle warming, hover, focus hay touch. Cú click
   hoặc route navigation rõ ràng sở hữu lần import đầu tiên. Background warming chỉ được
   prefetch page data hiện hành; phản hồi `bf-nav-intent` xuất hiện ngay và waiting state xuất
   hiện nếu transition vượt ngưỡng 120 ms. View module, workflow module và lazy HTML partial
   mà route còn thiếu được khởi động song song trong cùng thao tác navigation; route chỉ
   activate/render sau khi toàn bộ dependency đã hoàn tất thành công.
6. Khi đã từng phát tán response 404 cache dài, operator phải purge cached error tại CDN sau
   khi origin đã phục vụ asset đúng. Xóa cache trên một máy không thay thế bước này.

## Ảnh hưởng tương thích

- Không thay đổi API nghiệp vụ, schema, dữ liệu hiển thị, masking/redaction, role, module
  permission, assignment scope, record scope, capability, entitlement hoặc authorization.
- URL hashed hiện hành và service-worker cache namespace giữ nguyên. Release N tab có thể
  tiếp tục tải lazy chunk trong grace window N+1; reload chuyển sang graph N+1.
- Lần bấm tab đầu tiên có thể thực sự chờ route chunk thay vì được hover/idle tải trước. Dữ
  liệu trang vẫn có thể là cache hit, nên không bắt buộc hiển thị spinner trên transition nhanh.
  Tải song song chỉ thay đổi timing; readiness gate, stale-transition guard và failure feedback
  của từng loại dependency vẫn được bảo toàn.
- Production package chỉ chấp nhận asset ngoài manifest hiện hành khi asset đó nằm trong
  journal N−1 hợp lệ và checksum/size khớp; file thừa hoặc tamper vẫn làm package thất bại.

## Chuyển đổi và quay lui

Không có migration schema hay dữ liệu. Cần chạy lại secure build, restart backend để shell
dùng manifest mới, triển khai theo release directory versioned và purge cached 404 cũ tại
Cloudflare nếu có. Trước rollback code, release N được chuẩn bị lại với N+1
(đang phục vụ) là previous release, để giữ graph N+1 và loại predecessor cũ hơn;
sau đó symlink mới chuyển atomically về N. Không hạ schema.

Có thể quay lui riêng semantics tab bằng cách khôi phục intent/module warming, nhưng không
được quay lui `no-store` cho asset lỗi hoặc deployment N−1 nếu còn client mở tab cũ.

## Kiểm thử hồi quy

- Middleware: hashed asset `200` vẫn immutable; cùng URL trả `404` phải `no-store`.
- Build/deploy: giữ đúng asset manifest N, phát hiện tamper/collision, loại N−2 và ghi journal.
- Bootstrap: production entry failure làm mới graph và reload đúng một lần; lần sau hiện fatal
  fallback có thể thao tác thay vì để shell chết im lặng.
- Diagnostics: nhận diện wording stale bundle trên các browser và chỉ gửi path asset đã lọc.
- Tab: không request route UI trước navigation; click bắt đầu đúng một lần cho mỗi dependency
  còn thiếu, đồng thời khởi động view/workflow/partial mà không chờ tuần tự, giữ pane cũ và
  waiting feedback trong khi dependency bị chặn, rồi activate/render và dọn feedback khi tất
  cả hoàn tất.
