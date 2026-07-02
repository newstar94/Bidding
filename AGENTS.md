# Workspace Guidelines

## Quy tắc bắt buộc khi thực hiện bất kỳ thay đổi nào (Code Modification Guidelines)

Mỗi khi người dùng có yêu cầu chỉnh sửa, cập nhật tính năng, sửa lỗi hoặc thêm trường dữ liệu mới vào bất kỳ thực thể nào trong hệ thống, Agent bắt buộc phải thực hiện đầy đủ các bước dưới đây một cách chuẩn chỉ:

### 1. Đồng bộ hóa toàn diện giữa các lớp (Full Stack Synchronization)
* **Frontend (IndexedDB & UI)**: Cập nhật đồng bộ các views, workflow controllers, state local và cơ chế lưu trữ IndexedDB (`BiddingModel.js`).
* **Backend Schema (`schema.py`)**: Khai báo và điều chỉnh các cột trong `columns` của bảng tương ứng, đăng ký đầy đủ ánh xạ camelCase sang snake_case trong `field_map`.
* **Database Migration & Helpers (`db_helper.py`)**: Đảm bảo các câu lệnh di trú tự động (như `ALTER TABLE`) hoạt động chuẩn xác và không làm sai lệch thứ tự cột hay sao chép nhầm dữ liệu.

### 2. Xác thực và Kiểm thử Dữ liệu thực tế (Validation & Verification)
* **Tuyệt đối không bịa đặt trạng thái**: Không tự ý giả định dữ liệu đã lưu thành công hoặc tính năng đã chạy đúng nếu chưa kiểm tra file logs (`backend/logs`) hoặc chạy truy vấn kiểm thử thực tế.
* **Truy vấn trực tiếp trong Database**: Sau khi thực hiện bất kỳ chỉnh sửa nào liên quan đến dữ liệu, Agent phải sử dụng các lệnh Python/SQLite truy vấn trực tiếp vào file database (`models/bidding.db`) để kiểm chứng xem các thay đổi đã được áp dụng đúng đắn và chính xác hay chưa.
* **Xử lý lỗi ngay lập tức**: Nếu phát hiện giá trị bị lệch, sai logic hoặc không đồng bộ, phải lần theo luồng đồng bộ (`sync_routes.py`) hoặc luồng nghiệp vụ (`db_utils.py`) để sửa đổi ngay lập tức.
