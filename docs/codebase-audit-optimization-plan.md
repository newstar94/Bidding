# Backlog còn lại - BiddingFlow

File này chỉ giữ các việc chưa thực hiện hoặc chưa được manual test đầy đủ. Các unit test JS/Python hiện có cho validation, mapper, delta merge, schema constraint và Excel preview đã chạy pass nên không liệt kê lại ở đây.

Ghi chú mới nhất: với `APP_DEBUG=False`, server đã phục vụ `dist/controllers/app.bundle.js`. F5 production trên dữ liệu hiện tại không mất dữ liệu và phần loader sau khi reload còn khoảng 0.10-0.40 giây; tổng thời gian reload trang khoảng 0.62-0.68 giây. Cần kiểm tra lại với bộ dữ liệu vừa/lớn trước khi đóng hẳn mục hiệu năng tải nặng.

## Giai đoạn 0 - Baseline và kiểm chứng hiệu năng

- [ ] Ghi lại dung lượng IndexedDB/localStorage sau khi đăng nhập admin.
- [ ] Ghi lại số request API khi F5.

## Giai đoạn 2 - Local-first và loader

- [ ] Xác nhận F5 khi có local data đạt mục tiêu loader dưới 500ms với dữ liệu vừa/lớn.
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

1. Ghi lại request count/dung lượng local storage và kiểm tra F5 với dữ liệu vừa/lớn.
2. Manual test snapshot gói thầu theo phiên bản kế hoạch.
3. Manual test login/check-session/logout, throttle và cấu hình security production.
4. Manual test tạo/sửa/xóa, export/import và sync end-to-end.
5. Manual test workflow chính còn lại trong Giai đoạn 9.
