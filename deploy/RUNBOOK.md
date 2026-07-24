# Sổ tay xử lý cảnh báo BiddingFlow

Tài liệu này đi cùng gói triển khai. Trước khi xử lý, xác nhận đúng môi trường,
ghi lại thời điểm cảnh báo và không chạy lệnh thay đổi dữ liệu khi chưa có bản
sao lưu hợp lệ.

## Metrics, SLO và cảnh báo

1. Kiểm tra trạng thái `biddingflow.service`, Nginx và endpoint `/metrics`.
2. Đối chiếu tỷ lệ HTTP 5xx, 429, độ trễ p95, CPU, bộ nhớ và số lượng file
   descriptor trong cùng khoảng thời gian.
3. Kiểm tra log ứng dụng theo mã yêu cầu; không ghi hoặc gửi giá trị bí mật từ
   biến môi trường.
4. Nếu một worker bị treo, dừng nhận lưu lượng trước khi khởi động lại. Xác
   nhận hàng đợi bền vững không bị mất sau khi dịch vụ hoạt động trở lại.
5. Chỉ kết thúc sự cố khi các chỉ số trở về ngưỡng bình thường ít nhất 15 phút.

## PostgreSQL pool và lock

1. Kiểm tra PostgreSQL còn nhận kết nối và dung lượng ổ đĩa còn đủ.
2. Xem số kết nối đang dùng, yêu cầu đang chờ, truy vấn chạy lâu, lock chờ và
   deadlock. Không tăng kích thước pool trước khi xác định nguyên nhân.
3. Tìm transaction mở lâu hoặc worker giữ kết nối nhưng không làm việc.
4. Chỉ hủy truy vấn hoặc phiên khi đã xác định chủ sở hữu và ảnh hưởng nghiệp
   vụ. Không hủy tiến trình migration hay backup đang hợp lệ.
5. Sau xử lý, xác nhận hàng đợi kết nối bằng 0 và chạy kiểm tra đọc có xác thực.

## Job nền bền vững

1. Phân loại job đang `pending`, `retry`, `processing` và `failed`.
2. Kiểm tra worker email, tra cứu đối tác và tạo tài liệu còn heartbeat.
3. Đọc lỗi cuối cùng của job và xử lý nguyên nhân gốc trước khi cho chạy lại.
4. Không sửa trực tiếp payload hoặc xóa job thất bại. Chỉ chạy lại bằng công
   cụ vận hành có kiểm tra idempotency.
5. Xác nhận tuổi job cũ nhất và số job thất bại trở về ngưỡng bình thường.

## Tra cứu đối tác bị gián đoạn

1. Xác định upstream đang timeout, trả lỗi hay bị circuit breaker ngắt.
2. Kiểm tra DNS, TLS, proxy và giới hạn kết nối ra ngoài của worker.
3. Không tắt circuit breaker hoặc tăng concurrency khi upstream vẫn suy giảm.
4. Ứng dụng phải tiếp tục cho phép nhập dữ liệu thủ công trong thời gian lỗi.
5. Theo dõi đến khi circuit đóng và tỷ lệ tra cứu thành công ổn định.

## Audit chain không hợp lệ

1. Coi đây là sự cố an toàn thông tin; hạn chế ngay quyền thay đổi dữ liệu.
2. Không sửa hoặc xóa `audit_log` và các checkpoint.
3. Sao lưu PostgreSQL cùng checkpoint hiện tại sang nơi lưu trữ bất biến.
4. Kiểm tra khóa HMAC, checkpoint gần nhất và phạm vi tổ chức bị ảnh hưởng.
5. Chỉ mở lại thao tác ghi sau khi xác minh chuỗi từ một bản sao độc lập và
   lưu đầy đủ biên bản xử lý.

## WebSocket outbox tồn đọng

1. Kiểm tra listener WebSocket và kết nối PostgreSQL của từng worker.
2. So sánh sự kiện cũ nhất với cursor đã xử lý; không xóa hàng đợi để giảm số.
3. Khởi động lại listener lỗi sau khi bảo đảm cơ chế nhận lại không tạo mất
   hoặc phát trùng sự kiện có hại.
4. Xác nhận client nhận được thay đổi mới và tuổi sự kiện cũ nhất giảm đều.

## Backup và restore diễn tập

1. Xác minh snapshot gần nhất có manifest và checksum hợp lệ.
2. Kiểm tra cả PostgreSQL dump, ảnh tải lên, biểu mẫu Word và checkpoint audit.
3. Chạy restore drill chỉ trên cơ sở dữ liệu thử nghiệm có danh tính khác cơ sở
   dữ liệu thật.
4. Không dùng URL bí danh trỏ về cùng database và không bỏ qua lỗi
   `pg_restore`.
5. Sau diễn tập, chạy kiểm tra schema, đọc có xác thực, xuất tài liệu mẫu và
   ghi lại thời gian phục hồi.

