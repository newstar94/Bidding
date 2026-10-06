# Hướng dẫn Super Admin — Thương mại & Thanh toán

Mở menu **Thương mại & Thanh toán**. Màn hình gồm sáu khu vực: phát hành,
offer/giá, policy, provider, order/activation và lịch sử.

## Quy trình thay đổi catalog

### Tạo gói trong màn hình Gói dịch vụ

Trong Admin, mở **Gói dịch vụ**. Khi chưa có bảng giá, vẫn có thể chọn **Tạo gói đầu tiên** hoặc **Tạo bộ 8 gói mẫu**. Bộ mẫu không có giá; admin nhập cấu hình trước khi mở bán.

- Chọn Cơ bản/Nâng cao, Cá nhân hoặc một trong ba mức Tổ chức; đặt tên và chọn kỳ năm/tháng.
- Chuyển **Bảng quản lý / Thẻ trực quan** để so sánh. Trong từng thẻ, Hàng tháng/Hàng năm được căn giữa và chọn độc lập.
- Bấm **Sửa**, dùng ba phần Thông tin hiển thị, Giá và hạn mức, Quyền và tính năng. Thẻ bên cạnh cập nhật khi nhập. Có thể tính VAT và tổng tiền bằng nút tính; tiền VND được làm tròn đến số nguyên.
- Quyền xuất chưa chốt được giữ nguyên đến khi bấm **Cấu hình quyền xuất** và xác nhận. Chỉ các quyền xuất hiện hữu được chọn.
- Mở **Chính sách chung & kỳ hạn** để nhập số ngày năm/tháng và lựa chọn các chính sách được hỗ trợ. Các cấu hình khác vẫn có trong phần nâng cao.
- Lưu nháp được khi chưa điền hết. Kiểm tra vẫn yêu cầu đủ khung 8 gói năm, giá/thuế/quota, kỳ hạn và điều kiện phát hành. Gói tháng là tùy chọn và có giá riêng.
- Chỉnh gói đã phát hành tạo bản nháp mới. Ngừng bán từng kỳ trong trường Trạng thái bán rồi phát hành; gói đã mua giữ điều kiện cũ.
- Trong bảng **Bản nháp thương mại**, chọn **Bỏ bản nháp** để lưu trữ bản không còn dùng. Hệ thống hỏi xác nhận, kiểm tra revision và ghi audit; thao tác này không xóa release, đơn hàng hay thuê bao.

1. Tạo hoặc chọn bản nháp.
2. Sửa giá/quota/sales state. Các giá trị tiền và quota dùng số nguyên.
3. Lưu bằng đúng revision. Nếu có xung đột, tải lại bản mới trước khi tiếp tục.
4. Chạy **Kiểm tra** để xem lỗi, cảnh báo, impact và tỷ lệ tiết kiệm tính từ draft.
5. Chỉ khi không còn lỗi, chọn thời điểm hiệu lực, bấm **Xuất bản**, xác thực lại
   mật khẩu và nhập lý do.

Release đã publish là bất biến. Muốn quay lui, clone release cũ, kiểm tra rồi
publish một release mới. **Stop sales** chỉ dừng checkout mới; nó không thu hồi
quyền lợi đang dùng và không che dữ liệu.

## Trạng thái chưa được quyết định

Giao diện hiển thị `BLOCKED_DECISION` cho kỳ năm/renewal, batch thiếu quota và
quyền đọc billing history tổ chức. Đây không phải lỗi kỹ thuật để bỏ qua. Cần chủ
sản phẩm chốt business contract trước khi bật production action tương ứng.

Provider payOS ở shadow cho tới khi merchant/legal/webhook/credential readiness
đạt. Refund MVP là quy trình thủ công/off-platform có audit; thao tác cancel
payment link không phải hoàn tiền.
