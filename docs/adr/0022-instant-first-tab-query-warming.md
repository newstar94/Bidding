# ADR 0022 — Làm ấm truy vấn để mở tab dữ liệu tức thì

- Status: Accepted
- Date: 2026-08-27
- Amended by ADR 0024: primary route-module warming được khôi phục sau khi retire service worker;
  page-data prefetch, exact-query cache và in-flight deduplication trong ADR này vẫn có hiệu lực.

## Bối cảnh

Các bảng Kế hoạch, Gói thầu, Chủ đầu tư, Nhà thầu, Chuyên gia và Hợp đồng dùng
server-side pagination. Ở lần mở đầu tiên, renderer luôn dựng skeleton rồi chờ
`GET /api/paginate`; lần mở sau nhanh hơn vì dữ liệu đã được nạp vào state. Kế hoạch
và Gói thầu dùng chung view module `plan`, vì vậy dynamic import không giải thích
được việc cả hai tab lần đầu đều chờ.

History cho thấy server-side pagination và skeleton đã tồn tại trước khoảng điều tra
20–27/08/2026; không có commit nào trong khoảng này trực tiếp chuyển các bảng sang
pagination hoặc xóa query cache. Commit `bd095798` ngày 18/08/2026 chuyển initial
reconciliation ra khỏi critical startup path. Thay đổi timing này giúp loader ẩn sớm
hơn nhưng làm các request đầu tiên dễ trùng thời gian với reconciliation/background
sync, khiến độ trễ kiến trúc có sẵn trở nên dễ thấy. Nguyên nhân trực tiếp vẫn là
blocking `/api/paginate` không có page cache, in-flight deduplication hoặc warming.

## Quyết định

1. Giữ nguyên server-side pagination và `vite.build.modulePreload = false`.
2. Dùng paginated query cache trong bộ nhớ với TTL 30 giây. Cache key gồm workspace
   token/epoch, vai trò hoạt động, table và toàn bộ query đã chuẩn hóa (page,
   pageSize, search, filter, sort và các scope parameter liên quan).
3. Các caller cùng exact query dùng chung một in-flight promise. Query khác page,
   search, filter hoặc sort không dùng chung kết quả.
4. Sau khi initial route đã render và loader đã ẩn, module của primary menu đang hiển thị được
   tải nền ngay mà không chặn current route. Hydrate IndexedDB còn lại và prefetch page hiện tại
   của sáu bảng chính chỉ bắt đầu sau authoritative reconciliation, với concurrency tối đa 2.
   Module warming và page-data warming dùng lifecycle riêng để route code không phải chờ pull,
   còn projection cache không thể được làm ấm từ dữ liệu stale.
5. Primary module warming không activate tab, đổi URL hoặc render pane ẩn. Pointer intent không
   cần sở hữu import riêng vì background warming và click cùng dùng in-flight module registry.
6. Khi exact cache đã có, renderer giữ nội dung hiện có và không thay bằng skeleton.
   Entry quá TTL được hiển thị theo stale-while-revalidate và đồng thời gọi lại server;
   lỗi mạng có thể tiếp tục dùng entry cũ nhưng lỗi authorization không được fallback.
   Server vẫn là nguồn authoritative; cache chỉ giữ response pagination đã được
   authorize cho đúng workspace/vai trò.
7. Mutation/sync invalidation đi qua `EntityIndexes.invalidate`. Workspace reset,
   logout và đổi vai trò xóa cache; đổi vai trò còn abort request pagination đang chạy.
   Workspace lease ngăn response cũ ghi vào state, IndexedDB hoặc cache mới.
8. Instrumentation chỉ phát log khi `APP_DEBUG=True`,
   `localStorage.bf_perf_debug = "true"` hoặc `?bf_perf_debug=true`. Log tách thời gian
   view module, workflow, lazy partial, data/API, DOM render/enhancement và tổng thời
   gian; không ghi dữ liệu bản ghi.

## Ảnh hưởng tương thích

- Không thay đổi response API, schema, dữ liệu hiển thị, masking/redaction, role,
  module permission, assignment scope, record scope, capability hoặc entitlement.
- Người dùng đã có quyền đọc bản ghi vẫn nhận đầy đủ trường như trước; cache không mở
  quyền đọc bản ghi mới và không dùng entitlement xuất Word để quyết định dữ liệu đọc.
- Search, filter, sort, tổng số bản ghi và pagination vẫn do server quyết định khi
  `useServerSidePagination` được bật.
- Local snapshot/offline giữ hành vi hiện hữu: trước authoritative sync,
  `useServerSidePagination` mặc định `false` nên renderer dùng dữ liệu workspace đã
  hydrate; prefetch lỗi chỉ được báo ở diagnostics và không làm hỏng ứng dụng.
- CSP, Trusted Types, dynamic import và code splitting không thay đổi.

## Chuyển đổi và quay lui

Không cần migration schema hoặc dữ liệu. Cache chỉ tồn tại trong bộ nhớ của phiên và
tự hết hạn. Có thể quay lui page-data prefetch và paginated cache mà không cần chuyển
đổi dữ liệu bền vững. Module warming không còn thuộc quyết định đang có hiệu lực của
ADR này; mọi thay đổi semantics tải primary route module phải tuân theo ADR 0024.

## Kiểm thử hồi quy

- Primary route module được request nền đúng một lần sau shell; click sau warming không phát sinh
  import và module registry vẫn deduplicate click cực sớm với background in-flight import.
- Page-data warming chạy sau loader, giới hạn concurrency 2 và lỗi task không phá startup.
- Prefetch và click exact query chỉ tạo một request; page/search/filter/sort có key riêng.
- TTL và mutation invalidation buộc revalidation đúng lúc.
- Workspace token/epoch và active role không dùng nhầm cache; request vai trò cũ bị abort.
- Workspace đổi trong lúc warming không nhận response cũ và không khởi chạy batch sau.
- Chuyển nhanh Kế hoạch → Gói thầu → Nhà thầu chỉ route/render tab cuối.
- Sáu renderer không dựng skeleton khi exact query cache đã có.
- Stale workspace response không ghi state hoặc IndexedDB.
- `npm run test:first-tab-performance` đo browser thật sau warming với ngưỡng tổng mặc định
  100 ms. Lượt đầu phải không còn click-owned route module; mọi lượt phải không dựng skeleton,
  không duplicate `/api/paginate` và không có lỗi runtime.
