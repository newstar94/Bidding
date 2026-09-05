# Bàn giao sửa landing và quản lý gói Super Admin

Ngày: 05/09/2026.

## Đã triển khai

### Landing

- Sửa root cause SVG: các symbol thiếu và SVG không có `fill=none`, `stroke=currentColor`. Sprite được sinh từ Lucide đã pin trong repository, có allowlist, fallback và version SHA-256; secure build kiểm tra đồng bộ.
- Thay headline theo phương án đã duyệt, primary CTA theo session/trial, thêm menu mobile có focus/Escape và FAQ.
- Giảm card lồng nhau, bỏ dashboard thu nhỏ có chữ 4–8px. Hero mô phỏng đầy đủ các vùng của DashboardView bằng HTML/CSS: cảnh báo, hai bảng, quy mô/trạng thái và dải nguồn lực. Section giải pháp chuyển sang giải thích luồng và giá trị, không lặp lại dashboard; không dùng ảnh sản phẩm và không lấy dữ liệu người dùng.
- Refactor stylesheet landing, bỏ override landing cũ trong ui-redesign.css. Không đổi global design tokens, framework hoặc role/permission.
- Giữ API commercial public và mọi state off/error/empty; không phục hồi gói mặc định.

### Super Admin

- Danh sách thu gọn; chỉ mở một gói tại một thời điểm. Chọn inline panel thay cho drawer để không tạo thêm scroll lock/modal và không gây cắt bảng trên mobile.
- Hiển thị công khai đặt đầu form. Tách rõ trạng thái bán và visibility; thao tác chỉ đổi bản nháp, không tự phát hành.
- Tìm kiếm/bộ lọc đối tượng, biến thể, visibility; số lượng gói lấy từ dữ liệu. Không cho sắp xếp toàn danh mục trong lúc đang filter.
- Preview dùng cùng presenter của catalog; tách catalog đọc từ API public và dữ liệu dự kiến của draft.
- Chia các nhóm gói, lượt mua thêm, chính sách, cổng thanh toán, đơn hàng, lịch sử; giữ nguyên chức năng và trường được phép dùng.
- Thanh lưu/kiểm tra/xuất bản; dirty guard, giữ focus và effectiveAt; không kiểm tra hoặc publish bản local chưa lưu.
- Lưu lỗi 409 không tự refresh làm mất nháp; retry không nhân đôi listener. Trở lại cùng controller giữ nháp đang sửa; tải lại trình duyệt có cảnh báo thay đổi chưa lưu.
- Có bảng thay đổi so với lúc mở draft, summary trước publish, reason và revision/digest hiện hành. Backend step-up/audit và các gate không thay đổi.

Không thay giá, quota, chính sách, runtime commercial hay publish bất kỳ cấu hình thật nào. Kiểm thử mutation sử dụng API fixture cô lập.

## Kiểm chứng

| Nhóm | Lệnh / cách chạy | Kết quả |
|---|---|---|
| Static | `npm run check:static` | PASS: schema/migration fixture, Python, encoding, module graph, reachability, debt, E2E discovery |
| Build | `npm run build:secure` | PASS: icon manifest, ESLint/Trusted Types, vendor checks, obfuscation/symbol archive, route CSS |
| JS focused source | `node --test tests/js/landing_icon_contract.test.mjs tests/js/landing_responsive.test.mjs tests/js/commercial_control_center.test.mjs tests/js/commercial_offer_editor.test.mjs tests/js/landing_dynamic_packages.test.mjs tests/js/public_commercial_catalog.test.mjs` | 26 PASS ở vòng tổng hợp |
| Cross-browser source | `UI_QA_BROWSER=firefox` hoặc `webkit`, chạy landing_responsive + commercial_control_center | 9 PASS mỗi engine |
| Cross-browser secure bundle | `UI_QA_BUNDLE=1`, `UI_QA_BROWSER=chromium/firefox/webkit`, chạy hai file trên | 9 PASS mỗi engine ở vòng bundle; fixture cung cấp session bootstrap giống server |
| Python theo thay đổi | `python -m pytest tests/test_landing_seo.py tests/test_commercial_public_catalog.py tests/test_production_view_static_files.py -q` | 13 PASS |
| Nhóm Python có startup | Thêm `tests/test_startup_transport_regressions.py` | 30 PASS, 1 FAIL: test default bundle bị local `.env` nạp `source`; code mặc định vẫn `bundle`. Chưa sửa môi trường/test ngoài phạm vi UI |
| Live guest `/` | Chromium đọc máy chủ localhost:8000 hiện hữu | HTTP 200, headline mới, 53 SVG outline, không tràn ngang, không pageerror; CTA guest đến `/dang-nhap` |

Độ rộng landing đã chạy: 320, 360, 375, 390, 412, 768, 1024, 1280, 1366, 1440, 1920, 2560px. Kiểm tra icon bbox, stroke/fill, menu/Escape, wheel/PageDown và không scroll lock; Axe không phát hiện serious/critical trong landing ở 375 và 1280px.

Một lỗi chỉ xảy ra trong fixture bundle đã được sửa ở fixture: import chunk kéo entry bootstrap chạy lại nhưng fixture không có `bf-session-bootstrap`, khiến CTA được đặt lại thành guest. Fixture nay cung cấp cùng session cho entry và landing; không sửa production auth để làm test xanh.

## Asset/performance

- CSS route landing build trước khoảng 84.9 KB raw; sau khoảng 19.2 KB raw (gzip khoảng 3.8 KB ở lượt build đo). Đây là kích thước asset, không phải số đo LCP/INP.
- Không còn tải PNG minh họa sản phẩm. Một khối Tổng quan đầy đủ được render bằng HTML/CSS semantic; bảng chuyển thành card và các grid chuyển thành một cột theo breakpoint mobile.
- Không thêm thư viện frontend, font network, animation engine hoặc service worker.
- Chưa chạy Lighthouse/CWV đầy đủ; không khẳng định đạt các điểm Lighthouse hay toàn bộ performance gate.

## Screenshots

- Baseline landing: `data/e2e-artifacts/redesign-before/landing-1440.png`, `landing-390.png`.
- Sau sửa/source: `data/e2e-artifacts/redesign-after/landing-1440.png`, `landing-390.png`, `commercial-1440.png`, `commercial-390.png`.
- Bundle/final: thư mục `data/e2e-artifacts/redesign-final/` (landing desktop/mobile, các section pricing/solutions/roles/workflow và commercial desktop/mobile).
- Bản HTML/CSS không dùng ảnh sản phẩm: `data/e2e-artifacts/no-image-dashboard-preview/` (desktop 1440px, mobile 390px và viewport section).
- Bản Tổng quan đầy đủ và section giải pháp không dùng minh họa: `data/e2e-artifacts/full-dashboard-preview/`.
- Live guest hero: `data/e2e-artifacts/redesign-final/landing-live-1440.png`.
- Không còn product screenshot asset hoặc script tạo ảnh; screenshot QA chỉ dùng để kiểm tra trực quan, không được tải trên landing.

## Giới hạn và phần còn lại

- Chưa chạy full-suite/CI hoặc publish end-to-end trên backend/database thật; browser mutation tests dùng fixture. Không xuất bản giá thật chỉ để test.
- Inline panel là phương án triển khai của danh sách–chi tiết; chưa có drawer fullscreen hoặc preview giống pixel-perfect card landing. Preview đồng bộ dữ liệu qua presenter, không chạy checkout thật.
- Change review so với lúc mở draft, chưa phải diff backend đầy đủ giữa release hiệu lực và draft đã có từ phiên trước; nhãn UI ghi đúng phạm vi này.
- Chưa thêm visibility riêng cho landing; giữ nguyên visibility của catalog công khai dùng chung. Ẩn không đồng nghĩa dừng bán hoặc thu hồi quyền lợi cũ.
- Chưa thay cơ chế giữ selected offer qua auth/checkout, không tạo query parameter không được validate.
- Giữ nguyên hai file tài liệu đang bị xóa từ trước, không đưa các thay đổi ngoài phạm vi vào bản sửa.

## Cách sử dụng sau sửa

**Gói dịch vụ → mở gói → Hiển thị trong catalog công khai → Công khai/Ẩn khỏi catalog → Lưu bản nháp → Kiểm tra bản đã lưu → Xuất bản.**

Muốn hiện trên landing phải đồng thời Đang bán và Công khai, release tới thời điểm hiệu lực, runtime không off/trial. Không dùng “Dừng bán toàn bản phát hành” để chỉ ẩn một gói.
