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

## 2. Ngày áp dụng và khóa phiên bản đối tác theo giai đoạn

Trạng thái: Đang xử lý

### 2.1. Ngày áp dụng của phiên bản

- Mọi phiên bản Nhà thầu và Chủ đầu tư, kể cả phiên bản `00`, phải có `Ngày áp dụng`.
- Mặc định tự điền bằng ngày tạo phiên bản và cho phép người dùng chỉnh sửa.
- Phiên bản áp dụng cho một ngày nghiệp vụ là phiên bản có `Ngày áp dụng` gần nhất nhưng không vượt quá ngày nghiệp vụ.
- Nếu ngày nghiệp vụ sớm hơn `Ngày áp dụng` của phiên bản `00`, vẫn dùng phiên bản `00`.
- Cần cập nhật schema, migration, form thêm/sửa, chi tiết, danh sách, Excel và Word mapping liên quan.

### 2.2. Khóa phiên bản Nhà thầu theo giai đoạn gói thầu

- Mở thầu khóa ID phiên bản Nhà thầu độc lập và từng thành viên liên danh tại ngày mở thầu.
- Đánh giá E-HSDT tiếp tục dùng phiên bản đã khóa ở mở thầu.
- Kết quả LCNT khóa riêng phiên bản tại ngày phê duyệt kết quả; không làm thay đổi dữ liệu mở thầu/đánh giá.
- Tên liên danh giữ nguyên theo gói thầu; tên và thông tin từng thành viên lấy từ đúng phiên bản trong DB.
- Không được tự lấy phiên bản mới nhất theo `rootId` khi hiển thị dữ liệu lịch sử.

### 2.3. Khóa phiên bản đối tác theo giai đoạn hợp đồng

- Hợp đồng khóa phiên bản Nhà thầu và Chủ đầu tư tại ngày ký.
- Thanh lý hợp đồng khóa riêng phiên bản đối tác tại ngày thanh lý, không làm thay đổi thông tin của tài liệu hợp đồng đã ký.
- Giao diện tự chọn phiên bản theo ngày, chỉ hiển thị nhãn phiên bản và cho phép đổi trong trường hợp ngoại lệ; không bắt người dùng chọn ở luồng thông thường.

### 2.4. Xuất Word đúng phiên bản

- Biên bản mở thầu và báo cáo đánh giá dùng liên kết phiên bản mở thầu.
- Báo cáo kết quả dùng liên kết phiên bản kết quả.
- Hợp đồng dùng liên kết phiên bản ngày ký.
- Biên bản thanh lý dùng liên kết phiên bản ngày thanh lý.
- Word không được truy vấn phiên bản mới nhất thay cho phiên bản đã khóa.

### 2.5. Dữ liệu cũ và kiểm thử

- Backfill `Ngày áp dụng` từ ngày tạo phiên bản.
- Backfill liên kết thành viên liên danh theo phiên bản tồn tại tại ngày nghiệp vụ gần nhất.
- Kiểm thử độc lập/liên danh, phiên bản `00 → 01`, ngày trước phiên bản `00`, kết quả khác mở thầu, thanh lý khác hợp đồng, Word, Excel, API và build production.
