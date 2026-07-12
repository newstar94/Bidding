# Các vấn đề cần xử lý

Ngày cập nhật: 12/07/2026

## 1. Tra cứu thông tin nhà thầu tại sự kiện mở thầu

Trạng thái: Chưa xử lý

Hiện trạng:

- Worker tra cứu đối tác khởi động cùng backend và kiểm tra SQLite mỗi 30 giây.
- Khi nhập mã nhà thầu, luồng tra cứu có thể nhận toàn bộ thông tin doanh nghiệp thay vì tách phần cần hiển thị ngay và phần bổ sung nền.

Yêu cầu:

- Khi người dùng nhập mã nhà thầu, tra cứu và điền tên nhà thầu ngay trên dòng mở thầu.
- Không bắt người dùng chờ tra cứu địa chỉ, tên viết tắt, mã số thuế và thông tin liên hệ.
- Nhà thầu mới vẫn phải được lưu cùng dữ liệu mở thầu.
- Sau khi lưu thành công, backend mới kích hoạt tiến trình nền để bổ sung các trường còn thiếu.
- Worker không được quét SQLite định kỳ mỗi 30 giây khi không có công việc.
- Tránh chạy trùng nhiều worker cho cùng một nhà thầu.
- Giữ cơ chế giới hạn hoặc trì hoãn việc thử lại khi nguồn tra cứu thất bại.

Tiêu chí hoàn thành:

- Nhập mã hợp lệ sẽ tự điền tên trước khi lưu.
- Lưu sự kiện mở thầu tạo hoặc cập nhật đúng nhà thầu trong SQLite.
- Thông tin bổ sung được cập nhật nền và đồng bộ lại giao diện.
- Khi không phát sinh nhà thầu cần tra cứu, không có truy vấn kiểm tra định kỳ.
- Các bài kiểm thử API, JavaScript và build production đều đạt.

## 2. Gói thầu vẫn bị từ chối khi đồng bộ

Trạng thái: Đang xử lý

- `thoiGianBatDauToChuc` vẫn bị một nhánh kiểm tra coi là ngày/giờ dù trường này phải nhận văn bản như `Quý II, 2026`.
- Gói thầu có `keHoachId` không thuộc owner hiện tại làm phát sinh lỗi tham chiếu khi đồng bộ.
- Cần xác định dữ liệu kế hoạch hợp lệ theo owner, xử lý bản ghi tham chiếu cũ an toàn và bổ sung kiểm thử hồi quy.
