# ADR 0085: Lưu cấu hình gói và tự áp dụng

## Quyết định được chủ sản phẩm chấp thuận

Luồng quản trị: Tạo hoặc chỉnh sửa gói → chọn chế độ phát hành và trạng thái bán → Lưu.
Không yêu cầu thao tác Kiểm tra, Rà soát mở bán, xác nhận xuất bản hoặc nhập tham chiếu
quyết định thuế, tài khoản merchant, bộ khóa/webhook, hóa đơn, quyền riêng tư và hoàn tiền.
Các tham chiếu cũ là metadata tùy chọn và tiếp tục được bảo toàn trong JSON.

## Kiểm tra khi lưu

Lưu tự kiểm tra dữ liệu, giá, thuế, điều kiện gói và cấu hình thanh toán thực tế.
Khi chọn production/pilot, lấy profile payOS live/ready từ máy chủ và resolve đúng
credential reference bằng registry hiện hữu. Đây là kiểm tra cấu hình local,
không phải bằng chứng merchant hoặc webhook đã hoạt động trên mạng.
Không tự tạo khóa, giả lập xác nhận hay bỏ kiểm tra chữ ký thanh toán.

Save, validation, publication, audit và outbox cùng một giao dịch.
Lỗi ở bất kỳ bước nào rollback toàn bộ; nội dung nhập được giữ trên UI để sửa/thử lại.
CAS, session, Super Admin, CSRF, step-up và idempotency giữ nguyên.
Bản phát hành bất biến và snapshot của đơn hàng/quyền lợi đã mua giữ nguyên.
Không thay đổi quyền đọc, scope, entitlement hoặc hiển thị dữ liệu bản ghi.

## Compatibility và migration

PATCH draft thêm cờ publish:true để tự áp dụng và trả receipt của release.
PATCH không có cờ vẫn chỉ lưu draft; các API validate/publish cũ tiếp tục hỗ trợ.
Không có migration schema, không reseed hay sửa release/draft lịch sử.
Áp dụng quyết định này cho những lần lưu mới; ADR 0073/0077/0079 chỉ được thay thế
ở các bước tham chiếu và xác nhận thủ công nêu trên.

## Regression seams

Kiểm tra credential matching, profile malformed, bảo toàn metadata, CAS, rollback
audit/outbox/validation/publication, input types và authorization trước khi đọc profile.
Chromium kiểm tra một lần Lưu, không có xác nhận xuất bản, step-up retry dùng cùng key,
giữ form khi bị từ chối và chỉ báo thành công sau receipt có thẩm quyền.
