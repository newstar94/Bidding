# Rà soát lỗi và sẵn sàng production

Ngày rà soát: 12/07/2026

## Lỗi cần xử lý

### P1 — Dropdown có thể rỗng trên trình duyệt mới

Full sync không tải dữ liệu chi tiết của các bảng phân trang (`chu_dau_tu`, `ke_hoach_lcnt`, `goi_thau`, `nha_thau`, `chuyen_gia`, `hop_dong`). `recordManifest` chỉ chứa ID nên không thể tạo option cho dropdown khi IndexedDB chưa có cache.

Hướng xử lý: cung cấp API dữ liệu tối thiểu cho dropdown hoặc cache các trang phân trang sau khi tải.

### P1 — Nguy cơ stored XSS

Một số workflow ghép trực tiếp tên, địa chỉ, người đại diện và thành viên liên danh vào `innerHTML`.

Hướng xử lý: dùng `textContent`, DOM API hoặc escape toàn bộ giá trị trước khi chèn vào HTML.

### P1 — Giao diện có thể báo thành công trước DB

Hợp đồng, Chuyên gia, Mở thầu, Đánh giá và một số luồng Excel chưa chờ `persistData`/`autoSync` hoàn tất trước khi đóng form hoặc báo thành công.

Hướng xử lý: chờ kết quả đồng bộ và chỉ xác nhận khi `syncResult.ok === true`.

### P2 — Worker có thể ghi rỗng mã số thuế

Khi nguồn tra cứu không trả `tax_code`, worker có thể ghi chuỗi rỗng đè lên mã số thuế hiện tại.

Hướng xử lý: chỉ cập nhật khi giá trị trả về không rỗng.

### P2 — Test không được lưu trong repository

`.gitignore` đang bỏ qua `tests/`, `playwright.config.js` và `pytest.ini`, trong khi `package.json` vẫn tham chiếu các tệp này.

Hướng xử lý: theo dõi mã test và cấu hình test trong Git; chỉ bỏ qua report, cache và kết quả chạy.

## Kết quả kiểm tra hiện tại

- Frontend production build: đạt.
- JavaScript unit tests: 13/13 đạt.
- API tests: 18/18 đạt.
- E2E công khai: 2/2 đạt; 4 bài cần tài khoản đã bị skip.
- `npm audit`: không có lỗ hổng được báo cáo.
- SQLite `integrity_check`: `ok`.
- SQLite `foreign_key_check`: không có lỗi.

## Phạm vi dọn production

- Loại bỏ các phép gán trùng lặp không có tác dụng.
- Loại bỏ biến không được sử dụng.
- Không đưa `console.log`, `console.debug`, `console.table` và `debugger` vào bundle production.
- Ẩn log hoạt động bình thường của background worker; vẫn giữ log cảnh báo và lỗi.
- Giữ nguyên validation, error handling, audit log và logic nghiệp vụ.
