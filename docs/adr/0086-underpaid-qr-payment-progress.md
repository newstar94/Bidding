# ADR 0086: Hiển thị tiến độ thanh toán QR thiếu tiền

Trạng thái: chấp nhận theo yêu cầu xử lý chuyển thiếu tiền và sửa lỗi thanh toán QR
của chủ sản phẩm. Không mở rộng sang chính sách hoàn tiền hoặc phân bổ tiền tự động.

## Quyết định

Kết quả đối soát có `status=UNDERPAID` và `0 < amountPaid < totalAmount` được
lưu như một quan sát tiến độ có giới hạn gồm số đã nhận và số còn thiếu. Order
vẫn giữ `payment_state=unverified`; không tạo payment fact, subscription, quota
hoặc entitlement cho đến khi provider xác minh trạng thái hoàn tất với đúng toàn
bộ số tiền bất biến của order.

API order chỉ chiếu `paymentProgress={status, amountPaid, amountRemaining}` cho
người đã có quyền đọc order. Cửa sổ QR cảnh báo số đã nhận, số còn thiếu, chưa
kích hoạt gói và không hướng dẫn chuyển bổ sung trên QR cũ. Hệ thống tiếp tục đối
soát theo vòng đời hiện hành; việc hoàn tiền hoặc xử lý ngoại lệ vẫn là nghiệp vụ
vận hành, không được tự động suy ra.

Một kết quả terminal (`PAID`, `SUCCESS`, `COMPLETED`, `SETTLED`) sai số tiền vẫn
chuyển `PAYMENT_AMOUNT_MISMATCH` để kiểm tra thủ công. Webhook `UNDERPAID` không
bị gắn nhầm lỗi này.

`amountPaid=0` là số thực nhận bằng không, không được fallback sang tổng tiền
`amount`; chỉ response cũ thiếu/null `amountPaid` mới dùng `amount`. Tiến độ đã
ghi nhận không giảm khi nhận response cũ và không bị xóa khi tạo QR hoàn tất
muộn. QR đầu tiên đã lưu vẫn bất biến.

Khi QR hết hạn hoặc hủy, cửa sổ và lịch sử vẫn cảnh báo số đã nhận/còn thiếu,
không hướng dẫn trả lại toàn bộ bằng giao dịch mới; người dùng chờ đối soát
hoặc liên hệ hỗ trợ. Không suy ra cam kết hoàn tiền. Sau giới hạn 40 lần theo
dõi (kể cả lỗi mạng), cửa sổ có nút **Kiểm tra lại trạng thái** để bắt đầu một
đợt theo dõi hữu hạn mới; giữ nguyên hành vi đóng/Escape/hủy hiện hành.

## Tương thích và migration

Không đổi schema, role, entitlement, phạm vi đọc hoặc điều kiện kích hoạt. Tiến
độ được bổ sung vào `checkout_payment_json` hiện hữu và giữ nguyên metadata QR;
order chưa có quan sát hợp lệ trả `paymentProgress=null`. Response không có
`amountPaid` giữ nguyên tiến độ đã lưu, nếu có. Không backfill dữ liệu lịch sử.

## Kiểm thử hồi quy

- Provider query thiếu tiền giữ QR, chiếu đúng số đã nhận/còn thiếu và giữ order
  `unverified`.
- Webhook thiếu tiền không tạo payment transaction hoặc subscription.
- Terminal payment sai số tiền vẫn yêu cầu review.
- Storefront hiển thị cảnh báo thiếu tiền nhưng vẫn giữ QR và không báo kích hoạt.
- Tạo QR hoàn tất muộn giữ tiến độ đã có và không thay QR đầu tiên.
- Cả webhook và query từ chối terminal payment với `amountPaid=0` dù `amount`
  bằng tổng đơn, không tạo payment fact hoặc subscription.
- Chromium xác nhận cảnh báo thiếu tiền khi hết hạn/hủy, lịch sử và nút kiểm
  tra lại sau giới hạn theo dõi hoặc mất kết nối.
- Fixture hủy đơn tổ chức dùng cột metadata hiện hữu; không đổi kỳ vọng quyền.
