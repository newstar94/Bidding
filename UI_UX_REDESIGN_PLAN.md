# Kế hoạch thiết kế lại UI/UX BiddingFlow

## Mục tiêu

Thiết kế lại lớp giao diện theo hướng **Operational Editorial** với bảng màu **Electric Blue + Aqua**: sáng, hiện đại, rõ ràng, giàu bản sắc nghiệp vụ và tránh cảm giác template/AI đại trà.

## Giới hạn bắt buộc

- Chỉ thay đổi UI/UX và lớp trình bày.
- Không thay đổi API, dữ liệu, quy tắc nghiệp vụ hoặc luồng xử lý.
- Không đổi/xóa các `id`, `name`, `data-*` và hook JavaScript hiện có.
- Không thay đổi điều kiện phân quyền, đồng bộ, kiểm tra hợp lệ hay hành vi lưu/xóa.
- Mọi thay đổi phải vượt qua lint, audit accessibility và unit tests liên quan.

## Hạng mục triển khai

- [x] 1. Khảo sát cấu trúc giao diện và chốt hệ thống thiết kế
  - [x] Kiểm kê design token, component, dashboard, bảng, form, modal và responsive.
  - [x] Chốt palette Electric Blue + Aqua và nguyên tắc phân bổ màu.
  - [x] Chốt typography, spacing, radius, shadow, motion và focus state.

- [x] 2. Xây dựng lại design tokens nền tảng
  - [x] Bổ sung token semantic cho canvas, surface, text, border, primary, aqua và trạng thái.
  - [x] Chuẩn hóa thang spacing, radius, elevation và motion.
  - [x] Giữ tương thích với toàn bộ biến CSS cũ.

- [x] 3. Tinh chỉnh application shell và điều hướng
  - [x] Sidebar gọn, sáng và có active state đặc trưng.
  - [x] Header rõ thứ bậc, giảm pill/trang trí không cần thiết.
  - [x] Content viewport có gutter và mật độ thích ứng theo breakpoint.

- [x] 4. Chuẩn hóa component dùng chung
  - [x] Button, input, select, search, badge và trạng thái tương tác.
  - [x] Bảng dữ liệu dễ quét: căn lề, header, row hover và overflow.
  - [x] Modal/form rõ nhóm, footer ổn định và hỗ trợ màn hình nhỏ.
  - [x] Empty/loading/focus/reduced-motion nhất quán.

- [x] 5. Thiết kế lại dashboard theo ưu tiên công việc
  - [x] Giảm cạnh tranh thị giác giữa alert, KPI, bảng và resource links.
  - [x] Chỉ dùng màu nóng cho deadline/cảnh báo thực sự.
  - [x] Tăng kích thước chữ nhỏ và khả năng quét số liệu.
  - [x] Tối ưu bố cục tại 1440, 1024, 768 và 375px.

- [x] 6. Tinh chỉnh màn hình danh sách và form nghiệp vụ
  - [x] Toolbar tìm kiếm/lọc/hành động có thứ bậc rõ.
  - [x] Bảng giữ mật độ vận hành nhưng tăng khả năng đọc.
  - [x] Form dài có phân nhóm thị giác tốt hơn mà không đổi cấu trúc dữ liệu.

- [x] 7. Đồng bộ landing page với nhận diện mới
  - [x] Giảm hiệu ứng SaaS-template, gradient và card trang trí dư thừa.
  - [x] Làm nổi bật luồng nghiệp vụ và product preview.
  - [x] Đồng bộ palette, typography, radius và motion với ứng dụng.

- [x] 8. Kiểm thử và nghiệm thu
  - [x] Chạy audit accessibility và audit inline styles.
  - [x] Chạy lint CSS/JS và unit tests.
  - [x] Build production để phát hiện lỗi tích hợp.
  - [x] Rà soát diff, xác nhận không thay đổi logic/nghiệp vụ.

## Tiêu chí hoàn thành

- Giao diện sáng, hiện đại và không phụ thuộc hiệu ứng gradient/card đại trà.
- Màu primary/aqua dùng có chủ đích; warning/danger chỉ biểu đạt nghiệp vụ.
- Nội dung dashboard và bảng dễ đọc hơn, không dùng body text quá nhỏ.
- Các control chính có focus, hover, active và disabled state rõ ràng.
- Responsive không tạo cuộn ngang ngoài vùng bảng được phép.
- Không có thay đổi hành vi chức năng hoặc contract JavaScript.

## Nhật ký tiến độ

- 2026-07-16: Tạo kế hoạch; chưa thực hiện thay đổi giao diện.
- 2026-07-16: Hoàn tất khảo sát và design tokens; thêm stylesheet giao diện mới theo cách tương thích ngược.
- 2026-07-16: Hoàn tất shell, component, dashboard, màn hình dữ liệu/form và nhận diện landing page; không thay đổi hook hoặc logic.
- 2026-07-16: Nghiệm thu thành công: lint, audits, secure build, 244 unit tests và 9 E2E giao diện chính đều đạt.
- 2026-07-17: Tăng độ nhận diện sidebar active state: nền xanh primary với chữ/icon trắng; riêng Super Admin dùng nền tím đồng bộ màu vai trò khi được chọn.
- 2026-07-17: Đổi thanh chỉ báo active từ trắng sang aqua sáng để không hòa vào nền sidebar và vẫn nổi trên cả nền xanh lẫn tím.
- 2026-07-17: Bỏ thanh chỉ báo active theo phản hồi; nền đặc và chữ/icon trắng đã đủ thể hiện trạng thái được chọn.
- 2026-07-17: Tăng khả năng đọc badge “Được chọn nhiều” của Gói Vàng: nền xanh đậm, chữ trắng 11px và icon vàng sáng.
- 2026-07-17: Đồng bộ badge “Được chọn nhiều” với nhận diện Gói Vàng bằng nền vàng nâu đậm, chữ trắng kem và icon vàng sáng.
- 2026-07-17: Đồng bộ emblem Gói Vàng sang vàng kem/vàng nâu và căn tâm dọc nhãn gói, badge, emblem trên cùng một hàng.
- 2026-07-17: Tăng phân tách bề mặt dashboard: card trắng, border rõ, header bảng đậm hơn và shadow theo thứ bậc; hai bảng công việc được nhấn mạnh hơn KPI/alert.
- 2026-07-17: Căn đồng nhất header hai bảng dashboard; bỏ giới hạn trình bày 8 công việc, hiển thị toàn bộ trong vùng cuộn dọc với table header sticky.
- 2026-07-17: Chia đều chiều rộng hai card công việc dashboard theo tỷ lệ 1:1; giữ bố cục một cột dưới 1180px.
