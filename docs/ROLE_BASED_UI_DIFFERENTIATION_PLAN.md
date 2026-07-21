# Kế hoạch phân biệt giao diện theo vai trò

## 1. Mục tiêu

Phân biệt rõ ba chế độ làm việc `Super Admin`, `Quản lý` và `Chuyên viên` mà vẫn giữ một hệ thiết kế thống nhất cho BiddingFlow. Người dùng phải nhận biết được vai trò hiện tại, phạm vi dữ liệu và quyền thao tác ngay khi nhìn vào giao diện.

## 2. Hiện trạng

- Quản lý và Chuyên viên cùng mở trang `dashboard` với tiêu đề “Tổng quan hệ thống”.
- Phần lớn sidebar dùng chung; các mục quản trị đơn vị nằm cuối danh sách nên vai trò Quản lý chưa có thứ bậc điều hướng riêng.
- Vai trò hiện tại chủ yếu xuất hiện ở dòng chữ nhỏ trong menu tài khoản.
- Màu avatar theo vai trò không phải dấu hiệu đáng tin cậy vì avatar ảnh không mang màu vai trò và kiểu nền chung có thể ghi đè kiểu riêng.
- Dashboard chưa dùng ngôn ngữ khác nhau giữa “toàn đơn vị” và “công việc được phân công”.

## 3. Nguyên tắc thiết kế

- Giữ phong cách doanh nghiệp `Trust & Authority`, nền sáng, typography và component hiện có.
- Không tạo ba theme hoàn toàn khác nhau; chỉ dùng màu vai trò tại badge, thanh nhấn, trạng thái active và vùng ngữ cảnh.
- Không truyền đạt vai trò chỉ bằng màu sắc: luôn có icon, tên vai trò và mô tả quyền.
- Duy trì tương phản tối thiểu WCAG AA, focus rõ ràng và vùng bấm tối thiểu 44px.
- Chuyển động chỉ dùng `opacity`/`transform`, thời lượng 150–300ms và tôn trọng `prefers-reduced-motion`.

## 4. Hệ thống nhận diện vai trò

| Vai trò | Màu chính | Icon | Ngữ cảnh |
|---|---|---|---|
| Super Admin | `#6D28D9` | `shield-alert` | Quản trị nền tảng, đơn vị và tài khoản |
| Quản lý | `#1D4ED8` | `shield-check` | Điều hành đơn vị, phân công và kiểm soát nghiệp vụ |
| Chuyên viên | `#0F766E` | `user-check` | Xử lý công việc được phân công; được thêm/sửa, không được xóa |

## 5. Phạm vi triển khai

### 5.1 Header

- Không hiển thị role pill riêng vì trùng với thông tin chế độ trong khu vực tài khoản.
- Vai trò hiện tại tiếp tục được thể hiện tại tên chế độ và menu chuyển vai trò của tài khoản.
- Giữ menu chuyển vai trò hiện tại trong menu tài khoản.

### 5.2 Sidebar

- Không thêm khối ngữ cảnh vai trò riêng dưới thương hiệu để tránh lặp thông tin và chiếm diện tích điều hướng.
- Đưa nhóm “Điều hành đơn vị” lên trước nhóm nghiệp vụ khi ở vai trò Quản lý.
- Đổi tên mục đầu theo vai trò:
  - Quản lý: “Tổng quan đơn vị”.
  - Chuyên viên: “Công việc của tôi”.
- Dùng màu vai trò cho mục đang chọn nhưng vẫn giữ cấu trúc component thống nhất.

### 5.3 Dashboard

- Không hiển thị hero giới thiệu vai trò hoặc dãy nhãn quyền ở đầu dashboard.
- Quản lý dùng ngôn ngữ “toàn đơn vị”, “điều hành”, “phân công”.
- Chuyên viên dùng ngôn ngữ “của tôi”, “được phân công”, “cần xử lý”.
- Không thay đổi quy tắc lọc dữ liệu hiện có; giao diện chỉ mô tả đúng phạm vi mà backend đã cấp.

### 5.4 Quyền thao tác

- Thể hiện quyền bằng trạng thái thực tế của nút thao tác; không lặp lại thành dãy nhãn cố định trên dashboard.
- Không mở lại quyền xóa ở frontend; chính sách backend tiếp tục là nguồn kiểm soát cuối cùng.

## 6. Tệp dự kiến thay đổi

- `views/components/header.html`
- `views/components/sidebar.html`
- `views/tabs/tab_dashboard.html`
- `views/vendor/initial-route.js`
- `views/css/variables.css`
- `views/css/ui-redesign.css`
- `frontend/admin/SystemUserView.js`
- `frontend/app/BiddingControllerUI.js`
- `frontend/app/DashboardView.js`
- Các kiểm thử chính sách frontend liên quan.

## 7. Tiêu chí nghiệm thu

- [x] Vai trò hiện tại được nhận biết tại khu vực tài khoản, nhãn dashboard và cấu trúc menu theo vai trò.
- [x] Quản lý và Chuyên viên có tiêu đề dashboard khác nhau.
- [x] Sidebar Quản lý ưu tiên nhóm điều hành; sidebar Chuyên viên ưu tiên công việc cá nhân.
- [x] Chuyên viên được phép thêm/chỉnh sửa và các thao tác xóa bị khóa theo chính sách quyền.
- [x] Màu vai trò đi kèm icon và nhãn văn bản.
- [x] Giao diện có quy tắc responsive tại 375px, 768px, 1024px và desktop; kiểm tra trình duyệt desktop không có tràn ngang.
- [x] Focus keyboard, `aria-live`, label và trạng thái active vẫn hoạt động.
- [x] ESLint, kiểm thử tự động và kiểm tra đóng gói production đạt yêu cầu.
- [x] Đã loại bỏ các khối vai trò lặp ở header, sidebar và đầu dashboard cho mọi vai trò.

## 8. Trạng thái triển khai

- [x] Phân tích hiện trạng và xác định hệ thống nhận diện.
- [x] Triển khai header và sidebar theo vai trò.
- [x] Triển khai nội dung dashboard theo vai trò.
- [x] Bổ sung kiểm thử và kiểm tra giao diện thực tế.
- [x] Hoàn tất xác minh production.

## 9. Kết quả xác minh

- Kiểm tra trình duyệt ở cả `Super Admin`, `Quản lý` và `Chuyên viên`: đạt.
- Kiểm tra role label, mô tả quyền, menu theo vai trò và `aria-current`: đạt.
- Kiểm tra chiều cao vùng bấm dashboard tối thiểu 44px: đạt.
- Kiểm tra tràn ngang trên viewport desktop: không phát hiện.
- Kiểm thử tự động: `811 passed`, `1 skipped` do Bubblewrap/seccomp chỉ chạy trên Linux.
- ESLint và Trusted Types: đạt.
- Kiểm tra đóng gói production: đạt với 239 tệp runtime.
- Quét secret trong tệp được Git theo dõi: đạt.
