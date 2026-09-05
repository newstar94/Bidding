# Quản lý cấu hình PostgreSQL cục bộ

## Cách sử dụng

`.env` giữ `DATABASE_URL` làm kết nối chính và dòng
`BIDDING_DATABASE_PROFILE=.env.database.json`. File profile là thông tin bí mật,
không đưa vào Git, không gửi lên frontend và không dùng làm mẫu production.

- `values`: tên role, mật khẩu riêng từng dịch vụ và URL không thể suy ra chính xác.
- `connections`: database đích (`path`), tài khoản (`username`) và tham chiếu tới
  mật khẩu (`passwordRef`). Host, cổng và tùy chọn kết nối kế thừa `DATABASE_URL`.
- URL dịch vụ khác máy chủ hoặc khác tùy chọn TLS được giữ nguyên, không ép dùng chung.
- Không đổi mật khẩu khi ứng dụng khởi động. Công cụ setup đọc lại các mật khẩu
  đã lưu và giữ nguyên cách tạo/cập nhật role trước đây.
- `TEST_DATABASE_URL` và `API_TEST_DATABASE_URL` vẫn ở `.env` để giữ tương thích
  các test/PowerShell đang đọc trực tiếp; không gộp database test với dữ liệu chính.

Khi đổi máy chủ PostgreSQL, kiểm tra toàn bộ dịch vụ/database đích ở máy chủ mới
trước khi đổi URL chính. URL sinh tự động không tự tạo database hoặc cấp quyền.

## Thứ tự ưu tiên và môi trường

Biến môi trường tiến trình > biến khai báo trong `.env` > giá trị từ profile.
Web và các công cụ dùng `scripts.env_utils.load_env` nạp profile sau `.env`.
`setup_local_postgres.py` mở rộng profile trước logic setup, rồi ghi phần DB trở
lại profile để `.env` không dài ra sau mỗi lần setup.

Profile chỉ dành cho development/test cục bộ. Production vẫn phải cấp các biến
kết nối riêng cho từng dịch vụ, không chia sẻ file chứa toàn bộ credential.
File production có `BIDDING_DATABASE_PROFILE` sẽ bị từ chối. Các lệnh bên ngoài
repo đọc `.env` thủ công muốn dùng URL dịch vụ đã chuyển phải dùng bộ nạp chung
hoặc cấp URL trực tiếp; profile không phải tính năng có sẵn của python-dotenv.

Production có bước chuẩn bị riêng bằng
`scripts/prepare_production_database_env.py`. Secret manager materialize một
file tổng hợp tạm thời theo mẫu `deploy/production-database-secret.json.example`;
công cụ kiểm tra TLS `verify-full`, tài khoản và mật khẩu tách biệt, rồi sinh bốn
file `database-web.env`, `database-migrator.env`, `database-backup.env` và
`database-document-worker.env` với quyền `0600`. Đây là bước deploy, không phải
logic startup: file tổng hợp không được đặt trong release, không được cấp cho
web/worker và nên được secret manager thu hồi sau khi sinh file.

Mỗi file đầu ra chỉ chứa URL đúng phạm vi tiến trình. Host, cổng, database mặc
định và tham số TLS được suy ra từ `databaseUrl`; có thể đặt `database` riêng
cho một role khi hạ tầng thực sự dùng database khác. Tên ba role dịch vụ dùng
chuẩn có sẵn của ứng dụng nên file nguồn tối thiểu chỉ cần URL runtime và ba
mật khẩu riêng; trường `username` chỉ cần thêm khi hạ tầng cũ dùng tên khác.
Công cụ không tạo role,
không cấp quyền và không đổi mật khẩu PostgreSQL; các đối tượng đó phải được
provision trước qua quy trình quản trị database.

Worker production tiếp tục chạy bằng `DOCUMENT_WORKER_DATABASE_URL` được cấp
riêng; không cấp cho worker quyền đọc toàn bộ profile quản trị.

## Chuyển đổi và khôi phục

- Kiểm tra không ghi: `python scripts/compact_database_env.py`.
- Áp dụng: `python scripts/compact_database_env.py --apply`.
- Công cụ so sánh giá trị mở rộng với cấu hình trước, không in bí mật và không
  chạy SQL, đổi mật khẩu hoặc khởi động lại dịch vụ.
- Bản `.env` trước chuyển đổi lưu tại `.env.database.json.backup`, được loại khỏi
  Git và giới hạn quyền đọc. Khôi phục bằng cách chép bản này trở lại `.env`
  trong cửa sổ bảo trì sau khi đối chiếu các chỉnh sửa mới phát sinh.
- Không tự xóa profile hoặc bản sao khôi phục. Chỉ dọn sau khi xác nhận không cần.
- File mới được bảo vệ trước khi ghi, rồi thay thế nguyên tử. Windows cấp quyền
  cho tài khoản chạy công cụ, SYSTEM và Administrators; Unix dùng quyền 0600.

## Kết quả chuyển đổi trên máy hiện tại

18 biến được chuyển khỏi `.env`, thêm một biến đường dẫn profile: 94 xuống 77.
9 URL được suy ra, vẫn giữ đủ tài khoản và database đích. Toàn bộ 94 giá trị gốc
khớp sau mở rộng. 11 kết nối chính/dịch vụ/test đã kiểm tra bằng SELECT 1 trong
transaction chỉ đọc và rollback. Không chạy setup/reset, migration, restore,
đổi password hoặc restart dịch vụ để kiểm tra.

Kiểm thử tự động bảo vệ: thứ tự ưu tiên, host/query kế thừa, password có ký tự
đặc biệt, URL khác máy chủ, database restore riêng, từ chối profile production,
file thiếu và roundtrip bộ đọc/ghi setup. Đây không phải bằng chứng full-suite
hoặc kiểm tra toàn bộ UI sau restart.
