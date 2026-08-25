# Hướng dẫn Super Admin — Thương mại & Thanh toán

Mở menu **Thương mại & Thanh toán**. Màn hình gồm sáu khu vực: phát hành,
offer/giá, policy, provider, order/activation và lịch sử.

## Quy trình thay đổi catalog

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
