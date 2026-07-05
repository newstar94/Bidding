# Backlog còn lại - BiddingFlow

File này chỉ giữ các việc chưa thực hiện hoặc chưa được manual test đầy đủ. Các mục đã refactor xong như helper format tiền, helper feedback field, inline Excel controls của form gói thầu, modal return state, package validation, JV data store và file upload helper đã được loại khỏi backlog.

## Giai đoạn 0 - Baseline và kiểm chứng hiệu năng

- [ ] Ghi lại dung lượng IndexedDB/localStorage sau khi đăng nhập admin.
- [ ] Đo thời gian F5 tại các màn:
  - Dashboard.
  - Danh sách gói thầu.
  - Chi tiết gói thầu.
  - Hợp đồng.
  - Chuyên gia.
- [ ] Ghi lại số request API khi F5.
- [ ] Ghi lại thời gian loader toàn trang hiển thị.
- [ ] Manual test F5 sau khi đã có local data để xác nhận không mất danh sách.

## Giai đoạn 2 - Local-first và loader

- [ ] Xác nhận F5 khi có local data đạt mục tiêu loader dưới 500ms với dữ liệu vừa.
- [ ] Kiểm tra không còn màn hình placeholder bị nháy sau khi loader biến mất.

## Giai đoạn 3 - Delta sync bằng version/cursor

- [ ] Manual test WebSocket + `sync_version`: server thay đổi thì client nhận event và kéo delta bằng `after_version`.

## Giai đoạn 4 - DB/schema

- [ ] Manual test DB schema sync: fresh install, thêm cột mới, bỏ cột cũ, tạo admin/gói dịch vụ/tổ chức mặc định, index/trigger sync.

## Giai đoạn 5 - Font/encoding

- [ ] Manual test login/logout/change password trả message tiếng Việt đúng trên browser.

## Giai đoạn 6 - Bảo mật

- [ ] Manual test POST/PUT/DELETE thiếu hoặc sai CSRF token bị từ chối.
- [ ] Manual test login/check-session/logout trên browser đã có cookie `username` cũ.
- [ ] Manual test login đúng không tiêu quota, login sai nhiều lần bị throttle theo IP và username.
- [ ] Manual/config production: đặt `APP_SECURE_COOKIES=True`, HTTPS reverse proxy gửi `X-Forwarded-Proto=https`, và kiểm tra CSP/HSTS trên browser.
- [ ] Manual test audit log phát sinh cho login, logout, đổi mật khẩu và thao tác quản trị user/gói dịch vụ.
- [ ] Manual test upload file hợp lệ/không hợp lệ cho Word template, Excel import và ảnh/chứng chỉ/chữ ký.
- [ ] Cân nhắc chuyển password hashing sang Argon2id/bcrypt nếu chấp nhận thêm dependency.

## Giai đoạn 7 - Chuẩn hóa field và mapper dữ liệu

- [ ] Kiểm tra tạo/sửa/xóa một entity không sinh field trùng lặp.
- [ ] Kiểm tra export/import không làm đổi tên field.
- [ ] Kiểm tra sync server-client giữ nguyên dữ liệu.

## Giai đoạn 8 - Render và UX

- [ ] Manual test với DB lớn để xác nhận màn chi tiết kế hoạch cũ hiện đúng snapshot gói thầu.
- [ ] Kiểm tra bảng 5.000 records vẫn scroll/filter mượt.
- [ ] Manual test sync ngầm không làm giật UI sau debounce/queue background sync.
- [ ] Manual test ảnh chỉ load khi mở detail/modal.

## Giai đoạn 9 - Dọn dẹp code và tách module

- [ ] Manual test workflow chính: tạo/sửa/xóa gói thầu, mở thầu, đánh giá, import/export Excel, phát hành HSMT.

## Ưu tiên tiếp theo

1. Manual test F5/local-first và snapshot gói thầu theo phiên bản kế hoạch.
2. Manual test CSRF, login/check-session/logout và WebSocket + `sync_version`.
3. Kiểm tra mapper camelCase/snake_case với tạo/sửa/xóa, export/import và sync.
4. Tối ưu loader/local-first và kiểm chứng render các bảng lớn.
5. Manual test workflow chính còn lại trong Giai đoạn 9.
