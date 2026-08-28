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

Quyết định số 5 ở trên được thay thế bởi lịch tập trung trong `startupTiming.js`. Browser được dành
ít nhất 6.000 ms sau startup cho first frame, Lucide hydration và thao tác đầu tiên. Primary-tab
warming bắt đầu từ 7.000 ms; các tác vụ không thiết yếu còn lại được giãn. Chunk workflow lớn nhất
(`BiddingWorkflows`, khoảng 943 KB secure) không còn preload tự động trong phiên hoạt động mà chỉ
được tải theo route hoặc intent thực sự cần nó. Route hoặc intent của người dùng vẫn tải module cần
thiết ngay lập tức và không phải chờ lịch nền.

Performance harness chờ hết cửa sổ warming mới đo first-tab cache. Regression tests khóa ngưỡng
tương tác tối thiểu và secure browser smoke xác nhận icon cùng navigation handler hoạt động trên
cold load. Thay đổi lịch này không tác động dữ liệu hiển thị, masking, role, permission, scope,
capability, entitlement hoặc authorization semantics.
