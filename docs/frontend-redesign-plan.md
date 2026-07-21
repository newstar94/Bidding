# Kế hoạch redesign frontend BiddingFlow

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */

Tài liệu này là lộ trình triển khai giao diện mới theo Hallmark. Mục tiêu là
giữ nguyên route, dữ liệu, quyền và các hook JavaScript; chỉ thay đổi lớp
trình bày, tương tác và khả năng đáp ứng.

## Định hướng đã chốt

- **Genre:** modern-minimal, utilitarian — giao diện điều hành hồ sơ, ưu tiên
  đọc nhanh và xử lý công việc.
- **Theme:** Operational Editorial — nền xanh xám rất nhạt, bề mặt trắng,
  một xanh hành động BiddingFlow; màu vai trò chỉ dùng cho ngữ cảnh.
- **Macrostructure:** Workbench cho app pages; Marquee Hero tối giản cho
  landing; Long Document cho các biểu mẫu dài.
- **Typography:** mục tiêu là display face hỗ trợ tiếng Việt + Plus Jakarta Sans
  cho body; phase đầu giữ Plus Jakarta Sans cho cả hai để không làm thay đổi
  metrics, phase 4 sẽ self-host và visual-compare candidate display face.
- **Motion:** chỉ transform/opacity, easing có tên, hỗ trợ reduced motion.
- **Thông tin ưu tiên:** Dashboard luôn mở đầu bằng khối **Cần xử lý hôm nay**;
  số liệu tổng quan chỉ đứng sau các việc cần hành động.
- **Không làm:** không xoá route/component, không dựng lại fake browser chrome,
  không đưa số liệu marketing không có nguồn.

## Information architecture bắt buộc

1. **Dashboard:** Cần xử lý hôm nay → tổng quan → dữ liệu liên quan.
2. **Nghiệp vụ chính:** Kế hoạch → Gói thầu → Timeline → Hợp đồng.
3. **Đối tác:** Chủ đầu tư → Nhà thầu → Chuyên gia.
4. **Điều hành:** Nhân sự → Phân quyền → Hồ sơ giấy.
5. **Thông báo:** một timeline duy nhất; severity và icon phân biệt hoạt động,
   cảnh báo và lỗi, không tách thành các khung viền nặng.

## Phạm vi file

### Phase 1 — nền token và responsive (đang triển khai)

- Tạo `design.md` làm nguồn sự thật cho toàn app.
- Tạo `views/css/tokens.css`, nối vào `views/index.html`.
- Chuẩn hoá root width/overflow, focus-visible và modal/form ở màn hình nhỏ.
- Biến sidebar mobile thành drawer có backdrop, không để nội dung bị cắt.

### Phase 2 — shell và data surfaces

- Hợp nhất các override trong `ui-redesign.css` và giảm dần `!important`.
- Chuẩn hoá header/sidebar, bảng dữ liệu, empty/loading/error states.
- Bảng dùng một data surface, sticky header và ba mức density thấp/vừa/cao;
  không lồng table-container trong nhiều card.
- Một containment layer cho dashboard và trang quản lý nhân sự; tránh
  card-in-card.

### Phase 3 — forms, permissions và notifications

- Modal chỉ dành cho xác nhận, đổi trạng thái, gán người và xem chi tiết;
  form dài như **Thêm Gói thầu** chuyển thành page hoặc drawer rộng.
- Permission matrix và transfer work có density nhất quán.
- Notification dùng một feed theo thời gian, phân biệt severity bằng icon/màu,
  không chia khối viền nặng; lỗi/quá hạn đỏ, sắp hạn amber, hoàn tất xanh.

### Phase 4 — landing và polish

- Bỏ fake browser chrome trong preview sản phẩm; dùng figure/screenshot thật
  hoặc data canvas không có thanh URL giả.
- Rút gọn pricing thành bảng so sánh hoặc stack trên mobile.
- Giảm reveal-on-scroll để nội dung quan trọng hiển thị ngay.
- Rà lại màu raw/gradient và animation ở các stylesheet legacy.

## Tiêu chí nghiệm thu mỗi phase

- Không có horizontal scroll ở 320, 375, 414, 768 và 1280 px.
- CTA, nút, nav link và breadcrumb không bị wrap thành hai dòng.
- Ở mobile, bảng nghiệp vụ có row-card/detail rõ ràng; chỉ dùng scroll nội bộ
  khi dữ liệu thực sự cần so sánh nhiều cột.
- Bàn phím thấy rõ `:focus-visible`; reduced motion không gây trượt layout.
- Có đủ trạng thái loading, empty, error, success cho màn hình đã chạm.
- `npm run build:plain` chạy thành công.

## Nhật ký triển khai

- [x] Phase 1: token bridge, root overflow, focus-visible, mobile drawer,
  modal/form mobile.
- [x] Phase 2: shell và data surfaces — đã làm Dashboard priority order,
  sticky header, density token, row-card/detail mobile, bỏ containment viền
  lồng và thay toàn bộ `transition: all` trong stylesheet/runtime đã chạm.
- [x] Phase 3: forms, permissions, notifications — đã thêm drawer rộng cho
  form Gói thầu và trạng thái retry khi API thông báo không khả dụng; permission
  density và kiểm tra quyền API giữ nguyên, không thay đổi contract dữ liệu.
- [x] Phase 4: landing và polish — đã bỏ fake browser bar, bỏ reveal làm nội dung
  bị trống lúc tải, giữ pricing dạng stack trên mobile và hoàn tất motion cleanup.
  Theo `design.md`, app tiếp tục dùng Plus Jakarta Sans cho cả display/body để
  không đổi metrics; đánh giá font display self-hosted là deliverable độc lập.

### Kết quả kiểm tra phase 1 — 21/07/2026

- `npm run build:plain` ✅ Vite build thành công (159 modules).
- `GET /css/tokens.css` ✅ trả về HTTP 200 từ runtime backend.
- Không có file production nào bị xoá; route và JavaScript hooks được giữ nguyên.

### Kết quả kiểm tra phase 2 — 21/07/2026

- `npm run build:plain` ✅ sau khi đổi Dashboard copy, sticky header và density.
- `npm run lint:security` ✅ ESLint và Trusted Types checks đều đạt.
- Chưa đánh dấu hoàn tất Phase 2: row-card/detail mobile và dọn toàn bộ
  `transition: all` legacy còn lại cần một lượt riêng.

### Kết quả triển khai tiếp — 21/07/2026

- Bảng nghiệp vụ có `data-mobile-layout="cards"`; `BiddingView` tự gắn
  `data-label` từ header để giữ semantic table và hiển thị row-card trên mobile.
- Notification dùng một timeline không viền đen; lỗi tải API hiển thị trạng thái
  rõ ràng và nút **Thử lại** thay vì im lặng như empty state.
- Modal Gói thầu dùng layout `modal-wide-form`, full-height sheet trên mobile.
- Landing không còn dựng thanh URL/traffic-light giả và không giấu toàn bộ nội
  dung bằng reveal-on-scroll.

### QA responsive cuối — 21/07/2026

- Browser QA tại 320, 375, 414 và 768 px: document/body không vượt viewport,
  `overflow-x: clip`, không có control bị tràn ngang và không còn reveal opacity 0.
- Desktop QA 1280×800: CTA và điểm nhấn của product stage đều nằm trong fold;
  document không tràn ngang.
- `npm run build:plain` ✅; `npm run lint:security` ✅; `git diff --check` ✅
  (chỉ còn cảnh báo line-ending của Git trên Windows).

### Đính chính nghiệm thu thị giác và bản v1.2 — 21/07/2026

- Các dấu `[x]` trước đây chủ yếu phản ánh hạ tầng CSS và build, chưa chứng minh
  desktop đã thay đổi đủ rõ. Phản hồi thực tế cho thấy tiêu chí thị giác chưa đạt.
- Bản `v1.2.1` bổ sung pass Workbench nhìn thấy rõ: sidebar 248px, header 64px,
  active nav dạng role marker thay cho mảng màu đầy, page-title marker, toolbar và
  data surface phẳng, bỏ shadow trang trí.
- Năm modal Gói thầu, Kế hoạch, Chủ đầu tư, Nhà thầu và Hợp đồng dùng chung
  `modal-wide-form`, đo thực tế ở desktop 1280×800 là `1120×736`; ở mobile
  375×812 là `375×812`, không tràn ngang.
- Nghiệm thu từ bản này luôn cần ba tín hiệu: build/test đạt, computed style đúng
  token và ảnh chụp trình duyệt ở breakpoint mục tiêu.
