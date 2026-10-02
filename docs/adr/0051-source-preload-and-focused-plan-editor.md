# ADR 0051 — Tải nguồn và mở biểu mẫu Kế hoạch

- Status: Accepted
- Date: 2026-10-02
- Authorization: Chủ sản phẩm yêu cầu sửa hiệu năng sau phép đo tại `http://127.0.0.1:8000`.

## Bằng chứng và quyết định

Phiên source có nhiều request revalidation và nhiều lượt khám phá dependency trước khi
hiển thị giao diện. Lần mở Kế hoạch đầu tiên còn tải cả graph workflow đấu thầu theo
thứ tự, dù form thủ công không cần nhập dữ liệu MSC hoặc đánh giá hồ sơ.

1. Source HTML tải trước dependency tĩnh của đúng shell hiện hành. Helper giới hạn
   512 đường dẫn, 2 MiB mỗi file, cache kết quả parse theo mtime/size, kiểm tra lại chữ
   ký và đường dẫn từng lần. Không duyệt dynamic import. Bundle giữ chính sách hiện có.
2. Riêng `/tong-quan` authenticated tải trước DashboardView và CSS dạng fetch-only;
   view vẫn sở hữu việc gắn stylesheet. Thử nghiệm hint KeHoachView không cải thiện
   nên đã bỏ. Các workflow vẫn do route/action yêu cầu.
3. ETag HTML bao gồm representation preload để trình duyệt không giữ HTML cũ bằng 304
   khi graph preload thay đổi. Giữ `private, no-cache`, `Vary: Cookie` và kiểm tra phiên.
4. Nhóm `plan-editor` chỉ tải KeHoachWorkflow và makeSearchableSelect song song. Form
   HTML được fetch song song với code và dữ liệu theo phạm vi; dispatch vẫn chờ đủ.
5. MSC lookup tải graph đầy đủ khi được gọi. Sau await, kiểm tra workspace, storage,
   import flow, binding, mã, checkbox và đúng modal còn mở. Lỗi tải báo tại status
   hiện hữu, cho phép thao tác sau thử lại. Pending resume đã lưu vẫn được tiếp tục;
   lỗi import cho phép lần yêu cầu sau thử lại, không tự phát lại mutation.
6. Create route mở form sau render, thay timer 100 ms; completion cũ bị loại.
   Alias `tao-moi` chỉ được đọc ngược ở sáu list route hỗ trợ tạo mới; ID detail và
   action khác giữ nguyên. Loader stylesheet chỉ tái dùng link `rel=stylesheet`.

## Tương thích và chuyển đổi

Không đổi API, schema, dữ liệu được phép xem, masking, role, permission, tenant,
assignment/record scope, capability, entitlement, authorization hoặc reconciliation.
Prototype chung giữ đúng implementation; nhóm đầy đủ đáp ứng readiness của nhóm nhỏ.
Không có migration dữ liệu. Backend nguồn cần restart, frontend nguồn áp dụng qua F5;
artifact bundle cần build lại theo quy trình hiện hành. Không đổi `.env`.

## Kiểm chứng và giới hạn

Plugin trình duyệt của Codex, cùng origin/source mode, admin ở chế độ manager,
workspace rỗng, cache và phần mềm bảo vệ giữ nguyên. Năm lần F5 mỗi trang:

| Đến `bf:first-app-frame` | Trung vị trước | Trung vị sau | Khoảng sau |
| --- | ---: | ---: | ---: |
| Tổng quan | 716.9 ms | 436.6 ms | 425.4–514.0 ms |
| Kế hoạch | 756.4 ms | 497.1 ms | 451.7–676.9 ms |

Kế hoạch: click đầu sau F5 đến cơ hội vẽ khi opacity >0.01 giảm từ trung vị
483.1 xuống 117.7 ms (112.7–129.4 ms); `.active` từ 437.4 xuống 71.7 ms.
Đến opacity >=0.99: trung vị 269.8 ms. Đây là rAF sau ngưỡng opacity,
không phải timestamp của compositor. Lần mở lại: 44.6–63.7 ms đến cơ hội vẽ.

Trung vị dưới 500 ms, chưa đạt mọi lần F5 dưới 500 ms. Không phải phép đo cache
rỗng, cold browser, production bundle, workspace lớn hoặc mọi trình duyệt. Native
long task vẫn có 119–158 ms trong tập sau; không kết luận vượt gate 100 ms đã được
khắc phục hoặc quy toàn bộ cho phần mềm bảo vệ. Lượt Kế hoạch 676.9 ms vẫn có module
revalidation xếp hàng lâu, TTFB HTML 57.5 ms, model init 14.7 ms, route render 56.4 ms.

Evidence: `data/logs/browser-ui-timing-20261001-2112.json` và
`data/logs/browser-ui-timing-after-20261002.json`. Probe frontend và hook app đã gỡ;
bản dùng lại nằm ở `scripts/diagnostics/browser_ui_timing_probe.mjs`.

Regression: graph/readiness, retry, workspace stale, prototype coexistence, create
URL/render/stale transition, HTML/ETag/cache, stylesheet preload, và browser fixture
cho modal paint, authoritative record refresh, MSC action/retry/stale completion.

Các kiểm tra cuối: 51 Node tests đạt; browser fixture sau sửa failure/close guard đạt;
56 Python tests đạt, 1 bỏ qua vì host Windows không cho tạo symlink (kiểm tra resolve
ra ngoài root độc lập vẫn đạt). `npm run build:secure` đạt, gồm ESLint, Trusted Types,
vendor/archive checks, xác minh 168 obfuscated bundles và route CSS. Plugin smoke sau
gỡ probe mở Tổng quan/Kế hoạch/form bình thường, không có console error mới hoặc
event đo mới. Chưa triển khai production, chưa commit/push.

## Sửa lỗi đóng form sau F5 — 2026-10-02

Tái hiện Kế hoạch → Thêm mới → F5 → X/Hủy: form đóng rồi mở lại vì return state
đã lưu chính action `taomoi` của trang đang mở. Khi consume điểm quay về cùng
list Kế hoạch/Gói thầu/Hợp đồng, action tạo mới được đưa về `null`. Điểm quay về
khác tab, detail ID, action chỉnh sửa, modal lồng và draft giữ nguyên.

Regression thực thi editor, action listeners, switchTab và closeModal thật:
trước sửa cả X/Hủy mở form lần thứ hai và giữ `/ke-hoach/tao-moi`; sau sửa cả hai
đóng form, về `/ke-hoach`, action null. Suite liên quan gồm 99 tests đạt. Plugin
trên origin thực xác minh cùng chuỗi với cả hai nút, không có console error.
