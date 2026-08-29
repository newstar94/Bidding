# ADR 0023 — Thu gọn critical graph của authenticated workspace

- Status: Accepted
- Date: 2026-08-28

## Bối cảnh

HTML của phiên đã đăng nhập preload đệ quy cả graph của `app.js` và
`workspaceBootstrap.js`. Sau khi workspace có thêm các static import, cold load phải xử lý
26 secure chunks, khoảng 1,35 MB, trước khi application bootstrap hoàn tất. Kết quả là trang
đã có shell và dữ liệu route ban đầu nhưng Lucide icon cùng các controller tương tác chưa được
khởi tạo. Hiện tượng dễ thấy hơn trên origin demo vì cache của origin này độc lập với local.

Browser smoke trên chính local origin cũng tái hiện timeout, nên Cloudflare Access/Tunnel không
phải nguyên nhân gốc. Bỏ các transitive preload của workspace giúp thu gọn request ưu tiên ban
đầu, nhưng browser process thật sự lạnh vẫn phải tải và biên dịch graph đó khi thực thi static
import của `PrimaryBusinessView.js`. Vì vậy primary business views cũng phải nằm ngoài critical
graph.

## Quyết định

1. Tiếp tục preload đệ quy graph của entry `frontend/app/app.js`.
2. Với phiên authenticated, chỉ thêm file bundle của entry
   `frontend/app/workspaceBootstrap.js`; không phát `modulepreload` cho graph import bắc cầu của
   entry này.
3. Áp dụng cùng chính sách cho production secure bundle và bundle mode ngoài production.
4. Các tab Kế hoạch, Gói thầu, Chủ đầu tư, Nhà thầu, Chuyên gia và Hợp đồng dùng lazy module riêng
   theo route. Route hiện tại hoặc tác vụ warming sau startup chỉ tải renderer cần thiết.
5. Primary-tab warming chỉ được vào scheduler sau 1.800 ms để việc tải/biên dịch các lazy view
   không tranh main thread với first app frame, Lucide hydration hoặc thao tác đầu tiên.
6. Tách model, view, controller và các prototype module khỏi static graph của
   `workspaceBootstrap.js`. Bootstrap vẫn `await Promise.all` toàn bộ runtime trước khi cài module
   và gọi `controller.init()`, nên thứ tự và semantics khởi tạo không đổi; secure parser xử lý các
   chunk nhỏ hơn thay vì một entry chunk lớn.
7. Source mode giữ preload entry và các direct import hiện hữu, vì mode này không tái hiện nghẽn
   bootstrap và phục vụ vòng lặp phát triển.
8. Không thay đổi CSP, Trusted Types hoặc service worker.

## Ảnh hưởng tương thích

- Không thay đổi API, schema, dữ liệu hiển thị, masking/redaction, role, module permission,
  assignment scope, record scope, capability, entitlement hoặc authorization semantics.
- Workspace và các module con vẫn tải theo module graph chuẩn của browser. Primary business views
  được tải theo route/intent/warming; mỗi route tái sử dụng promise của đúng module tương ứng để
  không tạo duplicate import hoặc kéo renderer của các danh sách khác vào critical path.
- Warm load có thể không còn tải trước mọi workspace chunk; cold load hoàn tất bootstrap trước,
  gắn handler đúng thời điểm, rồi mới dùng idle warming cho các view chưa cần ngay.

## Chuyển đổi và quay lui

Không cần migration schema hay dữ liệu. Artifact secure cần được build lại và tiến trình backend
cần restart để HTML tham chiếu manifest mới. Có thể quay lui bằng cách khôi phục workspace thành
preload root đệ quy; không có chuyển đổi dữ liệu ngược.

## Kiểm thử hồi quy

- Anonymous HTML preload app entry và toàn bộ static dependency graph của app.
- Authenticated HTML giữ nguyên app graph, thêm workspace entry, và loại các transitive workspace
  chunks khỏi preload tags ban đầu.
- Workspace startup graph không static-import primary business views; mỗi tab chỉ tải lazy renderer
  của chính danh sách đó và tái sử dụng đúng một module load.
- Secure browser smoke phải đạt `DOMContentLoaded`, `bf:first-app-frame`, hydrate hết Lucide
  placeholders và cho phép thao tác điều hướng.

## Bổ sung lịch hậu khởi động

Quyết định số 5 ở trên được thay thế bởi lịch tập trung trong `startupTiming.js`. Shell và route hiện
tại vẫn được ưu tiên để có thể tương tác trước. Ngay sau khi shell sẵn sàng, ứng dụng bắt đầu một
authoritative route reconciliation duy nhất, gắn WebSocket/focus/storage listeners và đăng ký file
upload. Phần IndexedDB còn lại được giao cho idle dispatcher ngay sau khi reconciliation cùng bước
persist authoritative hoàn tất, tránh race đọc/ghi startup mà không quay lại timer 14 giây. Các tác
vụ realtime và dữ liệu không còn bị giữ bởi timer 14–36 giây.

Primary-tab warming chỉ prefetch dữ liệu trang đầu và chờ reconciliation hoàn tất, nhưng không cộng
thêm delay 7 giây. Reference data được xếp lịch sau reconciliation với độ trễ 750 ms và kiểm tra exact
workspace token cả lúc xếp lịch lẫn lúc thực thi. Dữ liệu ngày nghỉ vẫn là tác vụ tùy chọn sau 7 giây;
notification center, modal chính và assistant tiếp tục nằm sau interaction grace. Đăng nhập trực tiếp
hoặc Google cũng khởi động reconciliation ở nền và gắn WebSocket ngay, không giữ giao diện đăng nhập
cho đến khi full pull hoàn tất.

Chunk workflow và primary route UI không được preload do idle, hover, focus hay timer. Lần click hoặc
route navigation rõ ràng vẫn sở hữu lần import đầu tiên theo ADR 0024; warming hậu khởi động chỉ làm
ấm dữ liệu được phép đọc, không làm ấm renderer.

Đây là thay đổi timing-only: không đổi API, schema, dữ liệu hiển thị, masking/redaction, role, module
permission, assignment scope, record scope, capability, entitlement hoặc authorization semantics.
Không cần migration dữ liệu. Cần build lại secure artifact và restart backend để shell dùng manifest
mới. Regression tests khóa single-flight reconciliation, workspace-token stale guard, listener sẵn
sàng ngay, cache trang đầu sau reconciliation và việc Google/password login không chờ full pull.

## Bổ sung hiệu chuẩn benchmark startup

Benchmark startup chính thức phải đo artifact secure và tách nhiễu do phần mềm bảo vệ endpoint chèn
vào Chromium khỏi mã ứng dụng. Harness dùng CDP `Network.setBlockedURLs` để chặn exact URL pattern
ngoài origin (mặc định `http://local.adguard.org/*`); không dùng Playwright request routing vì routing
làm vô hiệu HTTP cache và khiến phép đo warm mất ý nghĩa. Kết quả phải ghi release ID nhúng trong app,
phiên bản browser, Node/platform/CPU, pattern đã chặn và trạng thái service worker để một báo cáo không
thể vô tình trộn nhiều release hoặc nhiều môi trường.

Ngưỡng cũ cold/warm `800/325 ms` được tạo trước secure graph hiện hành và thấp hơn cả baseline đã ghi
ngày 27/08 (`2253/810 ms`). So sánh 30/30 cùng host cho thấy release mới cải thiện so với N−1:
cold P95 `1926 → 1704 ms`, warm P95 `352 → 319 ms`; benchmark sạch 30/30 của release mới đạt
`1841/391 ms`, long task `92/66 ms` và không có runtime failure. Vì vậy ngưỡng mặc định được hiệu
chuẩn thành cold/warm P95 `2100/450 ms`, giữ nguyên longest task `100 ms`. Release evidence vẫn phải
ưu tiên so sánh candidate với N−1 trên cùng host; việc nới ngưỡng không được bỏ qua runtime failure,
release-ID mismatch hoặc long task của chính ứng dụng.

Hiệu chuẩn này chỉ thay đổi phép đo và release gate. Nó không thay đổi trình tự đăng nhập, dữ liệu tải,
API, schema, hiển thị dữ liệu hoặc bất kỳ semantics quyền/phạm vi nào.
