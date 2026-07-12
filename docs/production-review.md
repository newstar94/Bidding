# Rà soát và sẵn sàng production

Ngày cập nhật: 12/07/2026

## Vấn đề chưa xử lý

Các vấn đề đang xử lý được theo dõi tại `docs/issues-to-fix.md`.

Các giới hạn kiểm thử còn lại:

- Chưa kiểm thử tải với lượng dữ liệu lớn tương đương môi trường vận hành thực tế.
- Chưa đo độ ổn định dài hạn của các dịch vụ bên ngoài như Google và Mua Sắm Công.
- Các bài kiểm thử đăng nhập phải chạy tuần tự khi dùng chung một tài khoản vì phiên đăng nhập có thể thay thế nhau.

## Quy tắc nghiệp vụ

- Chủ đầu tư được phép không có mã số thuế.
- Mã số thuế rỗng hoặc `null` được chấp nhận.
- Nếu có nhập mã số thuế thì giá trị vẫn phải đúng định dạng.

## Kết quả kiểm tra hiện tại

- Frontend production build: đạt.
- JavaScript unit tests: 17/17 đạt.
- API tests: 25/25 đạt.
- E2E có đăng nhập: 7/7 đạt.
- `npm audit`: không có lỗ hổng được báo cáo.
- SQLite `integrity_check`: `ok`.
- SQLite `foreign_key_check`: không có lỗi.
- Bundle production không chứa `console.log`, `console.debug`, `console.table` hoặc `debugger`.

## Phạm vi production đã xác nhận

- Log debug và mã không cần thiết không được đưa vào bundle production.
- Log cảnh báo, log lỗi, validation, audit log và logic nghiệp vụ được giữ lại.
- Dữ liệu dropdown trên trình duyệt mới được lấy từ SQLite thông qua dữ liệu tham chiếu tối thiểu.
- Các thao tác lưu chính chờ IndexedDB và đồng bộ hoàn tất trước khi báo thành công.
- Dữ liệu động được escape trước khi đưa vào các vùng HTML đã rà soát.
- Worker giữ nguyên mã số thuế hiện tại nếu nguồn tra cứu trả về rỗng.

## Kiểm thử hiệu năng vai trò Quản lý

Phạm vi: 10 trang của vai trò Quản lý, chạy 3 lượt tuần tự trên Chromium tại máy local.

| Trang | Mở lần đầu (ms) | Mở lại (ms) | F5 trung bình (ms) | F5 cao nhất (ms) |
|---|---:|---:|---:|---:|
| Tổng quan | 23.4 | 29.8 | 386.3 | 397 |
| Kế hoạch LCNT | 31.8 | 25.1 | 821.0 | 1,071 |
| Gói thầu | 24.3 | 34.2 | 1,013.0 | 1,121 |
| Hợp đồng | 24.8 | 38.9 | 425.3 | 439 |
| Chủ đầu tư | 27.5 | 31.7 | 647.0 | 942 |
| Nhà thầu | 27.0 | 30.2 | 448.3 | 476 |
| Chuyên gia | 22.7 | 26.0 | 828.7 | 1,568 |
| Biểu mẫu Word | 165.3 | 54.9 | 940.0 | 986 |
| Nhân sự & Phân quyền | 61.6 | 34.6 | 779.3 | 944 |
| Trạng thái Hồ sơ giấy | 99.7 | 27.2 | 596.3 | 964 |

Kết luận: tất cả trang mở dưới 0.3 giây; toàn bộ F5 dưới 1.6 giây, đạt ngưỡng kiểm thử 5 giây.
