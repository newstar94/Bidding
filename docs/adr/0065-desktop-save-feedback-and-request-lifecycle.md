# ADR 0065 — Sửa phản hồi lưu và vòng đời yêu cầu trên desktop

- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm “Tiến hành sửa lỗi”, ngày 2026-10-06.
- Phạm vi: 17 lỗi đã xác nhận trong đợt kiểm tra ứng dụng desktop; tối ưu mobile được để giai đoạn sau.

## Business contract

1. Thành công khi lưu phải dựa trên kết quả xác nhận của máy chủ. Kết quả thất bại, xung đột hoặc đang chờ đồng bộ không được đóng chế độ sửa, xóa bản nháp hay hiển thị đã lưu thành công.
2. Khi còn thay đổi chưa lưu, chuyển tab, chuyển bản ghi, tạo bản nháp khác hoặc rời trang phải cho người dùng cơ hội giữ lại nội dung. Hủy thao tác giữ nguyên nội dung đang sửa.
3. Chỉ kết quả yêu cầu hiện hành được cập nhật giao diện. Kết quả của bản nháp/workspace đã rời không được thay thế nội dung mới.
4. Lựa chọn bộ lọc phân tích hiện trên màn hình phải được gửi cùng lựa chọn khoảng thời gian. Khi đang lưu cài đặt, toàn bộ biểu mẫu thể hiện snapshot đang gửi được khóa cho đến khi có kết quả.
5. Không đánh dấu thông báo đã đọc khi máy chủ từ chối hoặc mạng thất bại. Mở bản ghi đích vẫn được thực hiện nếu workspace hiện hành còn hợp lệ; có phản hồi để người dùng thử lại việc đánh dấu đã đọc.
6. Khi trình duyệt chặn cửa sổ thanh toán, lịch sử cung cấp đường dẫn mở lại checkout còn hiệu lực do API có thẩm quyền trả về. Hành động này không tạo quote/order mới hoặc tự xác nhận thanh toán.
7. Bảo toàn toàn bộ vai trò, tenant/module/assignment/record scope, masking, hiển thị trường được phép xem, entitlement xuất tài liệu, session checks, audit và quyền mua. Việc chuyển công việc DB sang worker và tái sử dụng ngữ cảnh quyền trong một request không thay đổi các quyết định quyền hiện hành.

## Compatibility impact

- Giữ nguyên định dạng API, giá/chu kỳ/quota/SKU từ catalog, revision, digest, workflow và trạng thái nghiệp vụ.
- Các luồng trước đây báo thành công sai sẽ hiển thị thất bại hoặc chờ xác nhận và giữ lại bản nháp.
- Yêu cầu quá tải hoặc hết thời gian ở các endpoint được sửa trả lỗi tạm thời có thể thử lại theo cơ chế 503/Retry-After hiện hành, thay vì lỗi 500 chung.
- Timeout bao phủ handshake CSRF; thông báo lưu thành công không trì hoãn điều hướng/render theo thời gian hiển thị toast.
- Drawer quản trị đóng theo vòng đời trang; thao tác Retry bị hủy trở lại trạng thái có thể dùng. Trường cấu hình offer có tên truy cập gắn với nhãn.

## Migration strategy

- Không cần schema migration, không chuyển đổi dữ liệu hoặc thay đổi release thương mại đang có hiệu lực.
- Không tự commit/push/deploy, không chạy giao dịch kinh doanh thật để kiểm tra.
- Quay lui bằng phục hồi phiên bản nguồn trước lần sửa và build lại theo quy trình phát hành hiện có; các order đã có vẫn giữ snapshot và quyền sở hữu hiện hành.
- Fixture hiệu năng được thay bằng catalog hợp lệ có checksum và ma trận minh họa 16 offer; giá minh họa chỉ tồn tại trong script kiểm tra.

## Regression seams

- F01–F03: workflow lưu thất bại, panel giữ bản nháp; timeline giữ dirty và chặn export sau save thất bại; điều hướng có guard.
- F04/F07/F15: heartbeat event loop; số truy vấn membership theo request; phản hồi busy/timeout đúng 503 và Retry-After, giữ các kiểm tra session/quyền.
- F05/F06: hủy/hết thời gian trong handshake CSRF; caller không chờ hết thời gian toast mới render.
- F08–F14: thao tác thật trên Plans/Analytics/Settings/Jobs/Audit và vòng đời Admin shell; label offer có association duy nhất.
- F16: HTTP/network thất bại, read-all thử lại và read thành công được kiểm tra qua NotificationCenter thật trên browser.
- F17: popup bị chặn, lịch sử ban đầu trống, URL có thẩm quyền, giao dịch hết hạn/đã trả không có hành động thanh toán lại.
- Bảng giá trong fixture phải có một thẻ Cá nhân và ba thẻ Tổ chức trước khi ghi nhận trang đã sẵn sàng.

## Giới hạn bằng chứng

Kiểm tra cục bộ và API giả lập không thay thế đo tốc độ hoặc xác minh dữ liệu trên môi trường production có đăng nhập. Các kết quả đạt và phần chưa đo trực tiếp được ghi riêng trong báo cáo sửa lỗi.
