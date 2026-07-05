# Backlog còn lại - BiddingFlow

File này chỉ giữ các việc chưa thực hiện hoặc chưa được manual test đầy đủ.

Ghi chú mới nhất: đã triển khai hướng app shell + local-first + sync nền. Startup hiện đọc dữ liệu ưu tiên theo route, kiểm tra nhanh IndexedDB bằng `count()` để tránh hiểu nhầm là không có cache, tắt loader sau khi render dữ liệu local, sau đó chạy delta sync nền và cập nhật UI nếu có thay đổi. Cần build production và đo lại trên Chrome với dữ liệu thực tế trước khi đóng mục hiệu năng.

## Giai đoạn 0 - Baseline và kiểm chứng hiệu năng

- [ ] Ghi lại dung lượng IndexedDB/localStorage sau khi đăng nhập admin.
- [ ] Ghi lại số request API khi F5 bằng Chrome DevTools hoặc script đo có quyền truy cập `performance`.

## Giai đoạn 2 - Local-first và loader

- [ ] Build production rồi đo lại F5 trên Chrome sau thay đổi local-first.
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

1. Build production và đo lại F5 bằng Chrome sau triển khai local-first.
2. Ghi lại request count/dung lượng local storage.
3. Manual test snapshot gói thầu theo phiên bản kế hoạch.
4. Manual test login/check-session/logout, throttle và cấu hình security production.
5. Manual test tạo/sửa/xóa, export/import và sync end-to-end.
