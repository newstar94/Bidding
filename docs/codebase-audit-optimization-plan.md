# Backlog còn lại - BiddingFlow

File này chỉ giữ các việc chưa thực hiện hoặc chưa được manual test đầy đủ.

Ghi chú mới nhất:
- Đã triển khai hướng app shell + local-first + sync nền: startup đọc dữ liệu ưu tiên theo route, kiểm tra nhanh IndexedDB bằng `count()`, tắt loader sau khi render dữ liệu local, sau đó chạy delta sync nền và cập nhật UI nếu có thay đổi.
- Đã tối ưu bước khởi tạo UI sau reload: chỉ enhance table/select/datepicker/icon trong tab hoặc modal đang mở, không quét toàn bộ DOM ẩn ở startup.
- Đã đo lại trên Chrome với bundle `app.bundle.js?v=1783229863`: F5 không phát sinh API request và không có console error, nhưng first content vẫn khoảng 1.0-1.8 giây; route chi tiết kế hoạch ổn định khoảng 1.1-1.8 giây. Mục tiêu dưới 500ms chưa đạt.
- Đã sửa startup local-first theo route: auth restore chỉ render sớm khi cache đủ dữ liệu cho route hiện tại, route chi tiết thiếu dữ liệu đích sẽ chờ sync thay vì render dashboard tạm.

## Giai đoạn 0 - Baseline và kiểm chứng hiệu năng

- [ ] Ghi lại dung lượng IndexedDB/localStorage sau khi đăng nhập admin.
- [ ] Ghi lại số request API khi F5 bằng Chrome DevTools hoặc script đo có quyền truy cập `performance`.

## Giai đoạn 2 - Local-first và loader

- [ ] Tối ưu tiếp để F5 khi có local data đạt mục tiêu loader/first content dưới 500ms với dữ liệu vừa/lớn.
- [ ] Build production rồi đo lại F5 sau sửa route-specific local-first, xác nhận không còn dashboard tạm trước detail route.
- [ ] Kiểm tra không còn màn hình placeholder bị nháy sau khi loader biến mất.

## Giai đoạn 4 - DB/schema

- [ ] Manual test DB schema sync: fresh install, thêm cột mới, bỏ cột cũ, tạo admin/gói dịch vụ/tổ chức mặc định, index/trigger sync.

## Giai đoạn 5 - Font/encoding

- [ ] Manual test login/logout/change password trả message tiếng Việt đúng trên browser.

## Giai đoạn 6 - Bảo mật

- [ ] Manual test login/check-session/logout trên browser đã có cookie `username` cũ.
- [ ] Manual test login đúng không tiêu quota, login sai nhiều lần bị throttle theo IP và username.
- [ ] Manual/config production: đặt `APP_SECURE_COOKIES=True`, HTTPS reverse proxy gửi `X-Forwarded-Proto=https`, và kiểm tra CSP/HSTS trên browser.
- [ ] Manual test audit log phát sinh cho login, logout, đổi mật khẩu và thao tác quản trị user/gói dịch vụ.
- [ ] Manual test upload file hợp lệ/không hợp lệ cho Word template, Excel import và ảnh/chứng chỉ/chữ ký.

## Giai đoạn 7 - Chuẩn hóa field và mapper dữ liệu

- [ ] Manual test tạo/sửa/xóa một entity không sinh field trùng lặp trên UI và DB.
- [ ] Manual test export/import không làm đổi tên field trên file Excel thật.
- [ ] Manual test sync server-client end-to-end giữ nguyên dữ liệu giữa hai phiên đăng nhập.

## Giai đoạn 8 - Render và UX

- [ ] Manual test với DB lớn để xác nhận màn chi tiết kế hoạch cũ hiện đúng snapshot gói thầu.
- [ ] Kiểm tra bảng 5.000 records vẫn scroll/filter mượt.
- [ ] Manual test sync ngầm không làm giật UI sau debounce/queue background sync.
- [ ] Manual test ảnh chỉ load khi mở detail/modal.

## Giai đoạn 9 - Dọn dẹp code và tách module

- [ ] Manual test workflow chính: tạo/sửa/xóa gói thầu, mở thầu, đánh giá, import/export Excel, phát hành HSMT.

## Ưu tiên tiếp theo

1. Build production và đo lại F5 sau sửa route-specific local-first.
2. Ghi lại dung lượng local storage.
3. Manual test snapshot gói thầu theo phiên bản kế hoạch.
4. Manual test login/check-session/logout, throttle và cấu hình security production.
5. Manual test tạo/sửa/xóa, export/import và sync end-to-end.
