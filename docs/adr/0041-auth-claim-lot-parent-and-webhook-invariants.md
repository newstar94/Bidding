# Khắc phục chiếm thông tin đăng nhập, phạm vi lô và webhook giả lập

Ngày: 2026-10-03. Trạng thái: chủ sản phẩm yêu cầu khắc phục các lỗi đã phát hiện.

## Hợp đồng

- Khi Google chứng minh quyền sở hữu email của tài khoản chưa xác minh, mật khẩu đã được đặt trước khi chứng minh email không trở thành thông tin đăng nhập của tài khoản đã xác minh. Trong cùng giao dịch, đổi sang giá trị external-only hiện hữu, vô hiệu các token đặt mật khẩu trước đó và tạo email đặt mật khẩu cho chủ email. Tài khoản đã xác minh giữ mật khẩu và luồng liên kết hiện hành.
- ID phần lô chỉ được cập nhật dưới đúng gói cha và tổ chức đã lưu. Xung đột ID thuộc gói khác phải làm thất bại và hoàn tác toàn bộ giao dịch đồng bộ. Các phiên bản gói tiếp tục tạo ID lô riêng theo cơ chế clone hiện hành.
- Webhook HTTP công khai không nhận provider giả lập không xác thực chữ ký. Checkout giả lập trong môi trường được phép tiếp tục tự đưa sự kiện vào hàng đợi nội bộ. Webhook payOS đã xác minh chữ ký vẫn được tiếp nhận, kể cả khi ngừng tạo checkout mới, để xử lý thông báo thanh toán đến muộn.
- Đổi mật khẩu tiêu thụ giới hạn thử hiện hữu theo tài khoản và IP trước khi kiểm tra mật khẩu cũ. Lượt thử được lưu bền vững; lỗi mật khẩu/CPU/giao dịch không xóa lượt thử. Thành công xóa bucket trong cùng giao dịch đổi mật khẩu, giữ compare-and-swap, thu hồi phiên cũ, tạo phiên mới và audit.

## Tương thích

Không thay role, module permission, assignment, phạm vi bản ghi/tổ chức, capability, entitlement, mặc định cho phép/từ chối hoặc nội dung dữ liệu được phép đọc. Entitlement Word chỉ kiểm soát xuất Word. Mật khẩu sai tiếp tục trả lỗi 400, hết giới hạn thử trả 429 theo helper hiện hữu. Va chạm ID phần lô tiếp tục đi qua xử lý rollback lỗi đồng bộ hiện hữu.

Webhook giả lập HTTP trước đây trả 202; nay trả 400 `PROVIDER_EVENT_UNVERIFIED` và không ghi sự kiện. Không có caller ứng dụng hợp lệ của ingress này; simulator nội bộ giữ nguyên. Kiểm thử dedupe chuyển sang webhook có chữ ký payOS để giữ đúng invariant xác thực.

## Triển khai và dữ liệu cũ

Không đổi schema, không cần migration dữ liệu. Cập nhật backend cùng bản vá; frontend hiện tại tiếp tục dùng các API hiện hữu. Không tự đặt lại mật khẩu hay phân loại tài khoản đã được xác minh trước khi triển khai; việc điều tra và xử lý tài khoản có thể bị khai thác trong quá khứ cần bằng chứng riêng. Bản vá ngăn promotion chưa xác minh giữ credential đã được đặt trước.

## Kiểm thử hồi quy

`test_auth_account_claim_and_password_attempts.py` kiểm chứng Google promotion/linking, token/email/session, rollback audit, bucket tài khoản/IP, lỗi storage và CAS. `test_lot_parent_scope.py` kiểm chứng va chạm qua phân lô/kết quả trúng thầu, rollback batch, cập nhật hợp lệ, archived revival, tenant khác và clone phiên bản; hỗ trợ PostgreSQL tách biệt. `test_payment_webhook_ingress.py` kiểm chứng từ chối fake ở các môi trường và giữ chữ ký/dedupe payOS; hỗ trợ PostgreSQL tách biệt. Các bài kiểm thử cùng gói tiếp tục được chạy.
