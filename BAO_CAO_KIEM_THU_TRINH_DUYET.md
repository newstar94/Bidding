# Báo cáo kiểm thử trình duyệt BiddingFlow

- Ngày kiểm thử: 16/07/2026 (Asia/Saigon)
- Môi trường: `http://127.0.0.1:8000`
- Công cụ: plugin trình duyệt trong Codex
- Vai trò đã kiểm tra: Super Admin, Quản lý, Chuyên viên
- Tài khoản quản trị: `admin` (không ghi mật khẩu vào báo cáo)
- Nguyên tắc báo cáo: chỉ giữ lỗi chưa được khắc phục

## Tóm tắt lỗi còn mở

Không còn lỗi đã xác nhận đang mở sau lượt kiểm thử lại gần nhất.

## Chi tiết lỗi chưa được khắc phục

Không có.

## Phạm vi đã kiểm tra và đạt

### Xác thực và vai trò

- Đăng nhập Admin; đăng nhập sai; đăng xuất có xác nhận.
- Đăng ký tài khoản Chuyên viên, sinh và xác minh OTP trong môi trường cục bộ.
- Đăng nhập bằng tài khoản Chuyên viên thật.
- Chuyển vai trò Super Admin, Quản lý và Chuyên viên.
- Menu quản trị không hiển thị cho Chuyên viên.
- Hồ sơ cá nhân và đổi mật khẩu mở đúng route.
- Thao tác quản trị nhạy cảm yêu cầu xác thực lại mật khẩu.

### Dữ liệu và phân quyền

- Chuyên viên tạo dữ liệu trong tổ chức và không gian cá nhân.
- Dữ liệu mới thuộc đúng tổ chức hoặc chủ sở hữu cá nhân theo workspace hiện hành.
- Máy chủ chặn Chuyên viên sửa dữ liệu không do mình tạo và không được phân công.
- Danh sách và trang chi tiết không hiển thị **Sửa/Xóa** đối với Chủ đầu tư/Nhà thầu không thuộc quyền Chuyên viên.
- Chuyên viên tự tạo Nhà thầu, sửa thành phiên bản mới và xóa các phiên bản; quyền sở hữu được giữ đúng sau tải lại.
- CRUD Chủ đầu tư, Nhà thầu, Chuyên gia và Biểu mẫu Word.
- Quản lý nhân sự, ma trận quyền và danh mục Trạng thái Hồ sơ giấy.
- Điều hướng đóng/hủy modal trở về đúng URL danh sách.

### Nghiệp vụ đấu thầu

- Tạo và sửa Kế hoạch LCNT.
- Tạo Gói thầu; chuẩn bị; phê duyệt/đăng tải HSMT; gia hạn; yêu cầu và trả lời làm rõ.
- Mở thầu; nhập nhà thầu và giá dự thầu; đánh giá; phê duyệt kết quả lựa chọn nhà thầu.
- Sửa kết quả và phê duyệt lại.
- Hủy thầu, lưu quyết định hủy và xác nhận trạng thái sau tải lại.
- Khôi phục hủy thầu từ danh sách; trạng thái trở về **Đã có kết quả**.
- Tạo, xem chi tiết, sửa và xóa toàn bộ Hợp đồng có nhiều phiên bản.

### Ổn định kỹ thuật

- Tuyến **Chi tiết gói thầu** chờ tải mô-đun Mở thầu/Đánh giá trước khi dựng nội dung; kiểm thử E2E xác nhận `renderMoThauPanel` và `renderDanhGiaHsdtPanel` luôn sẵn sàng sau tải lại.
- Modal đặt tên đăng nhập Google đặt lại trạng thái nút khi tái sử dụng sau đăng xuất, đồng thời chặn gửi trùng bằng nút hoặc phím Enter; kiểm thử đơn vị hồi quy đã đạt.
- Tải lại nhiều route với tài nguyên trả `304 Not Modified`.
- Hai thẻ cùng workspace không còn kích hoạt vòng lặp gọi `/api/get-all-data` qua lại; quan sát 4 giây sau ổn định không phát sinh request đồng bộ mới.
- Banner ngoại tuyến được ẩn đúng khi API/WebSocket kết nối thành công; không còn thông báo mất kết nối giả trong giao diện.
- KPI **Tổng quan SA** và **Quản lý Người dùng** cùng hiển thị `75.000.000 ₫`, `1` đơn vị hoạt động và `2` người dùng/nhân sự; tỷ lệ kích hoạt gói là `100%`.
- Log máy chủ sau lượt kiểm thử cuối không còn `Response content longer than Content-Length`, traceback ASGI hoặc lỗi HTTP 500.
- Tên Nhà thầu hợp lệ bắt đầu bằng `Nhà thầu ...` không còn bị tác vụ nền coi là tên giữ chỗ chỉ vì tiền tố.

## Kết quả kiểm thử tự động

| Bộ kiểm thử | Kết quả |
|---|---:|
| Frontend unit tests | 221/221 đạt |
| API tests | 258/258 đạt |
| E2E Chromium | 10/10 đạt |
| Lint JavaScript/Python | Đạt |
| Build secure và kiểm tra gói production | Đạt |

## Phạm vi chưa xác nhận bằng hệ thống bên ngoài

- Đăng nhập Google với tài khoản Google thực tế.
- Đăng ký tuần tự hai tài khoản Google thực tế trong cùng một phiên trình duyệt sau khi đăng xuất; lỗi nút bị giữ ở trạng thái **Đang khởi tạo thiết lập...** đã được sửa và có unit test, nhưng cần xác nhận lại một lần với hai tài khoản Google thật.
- Email OTP có đến hộp thư thật; luồng cục bộ đã được kiểm tra bằng mã OTP sinh trong môi trường thử nghiệm.
- Độ ổn định của dịch vụ tra cứu mã số thuế bên ngoài khi nhà cung cấp timeout hoặc trả 404.
- Toàn bộ biến thể tệp Excel thực tế ngoài các luồng và bộ kiểm thử hiện có.

## Dữ liệu kiểm thử còn lại

- Tài khoản `qa_employee_0716` được giữ lại để kiểm tra RBAC thực tế; vai trò hiện tại là Chuyên viên.
- Gói thầu `QA-GT-FLOW-0716` được giữ ở trạng thái **Đã có kết quả** sau khi kiểm thử hủy và khôi phục.
- Hợp đồng `QA-HD-FLOW-0716` đã được lưu trữ/xóa toàn bộ khỏi danh sách hiện hành sau kiểm thử.
- Nhà thầu tạm `QA-NT-EMP-0716B` đã được xóa toàn bộ sau khi hoàn tất kiểm thử CRUD và quyền sở hữu.
