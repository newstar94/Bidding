# ADR 0075 — Gói cá nhân và thanh toán trong thông tin tài khoản

- Ngày: 2026-10-08.
- Trạng thái: Accepted theo yêu cầu chủ sản phẩm trong cuộc trao đổi hiện tại.
- Tiếp nối ADR 0020, 0072 và 0074.

## Business contract

Chủ sản phẩm yêu cầu bổ sung thông tin gói, thanh toán và lịch sử mua cá nhân trong “Thông tin tài khoản”, đồng thời bấm logo BiddingFlow để về landing page.

- Thông tin gói và số dư lượt trong tài khoản luôn thuộc chính người đăng nhập, kể cả khi đang làm việc trong một tổ chức. Ngữ cảnh tổ chức không được dùng để thay chủ sở hữu của phần thông tin cá nhân này.
- Endpoint đọc `/api/billing/account-summary` lấy `actor.user_id` từ phiên đã xác thực, đọc subscription cá nhân và sử dụng `UsageOwner("account", actor.user_id)` để lấy số dư. Endpoint không nhận mã tài khoản hoặc mã tổ chức do trình duyệt cung cấp.
- Trạng thái, ngày hiệu lực và quyền lợi của subscription sử dụng chính bộ chuẩn hóa subscription hiện hữu. Phần trình bày tài khoản không tự cấp hoặc đổi entitlement. Tên gói và kỳ hạn lấy từ phiên bản đã mua cùng snapshot của đơn; không thay bằng giá hay cấu hình catalog đang bán. Gói cấp thủ công/legacy chưa có kỳ hạn đã ghim sẽ không được tự suy diễn là gói tháng/năm.
- Lịch sử tiếp tục tuân theo ADR 0020: đồng thời `owner_kind = 'account'` và `account_user_id = actor.user_id`. Người dùng không được xem thêm đơn của người khác hoặc tổ chức qua phần lịch sử cá nhân này.
- Lịch sử bổ sung tên phiên bản gói đã mua, loại sản phẩm, kỳ hạn, số lượt và thời điểm thanh toán từ payment fact đã được xác minh. Không dùng thời điểm tạo checkout hoặc thời điểm giao diện nhận kết quả để thay thời điểm trả tiền.
- Hiệu lực gói mua thêm lượt lấy từ `benefits.expiryPolicy` đã ghim, hoặc `policySnapshot.creditPackExpiry` của chính đơn khi chưa có projection quyền lợi; không dùng `baseTerm` của gói thuê bao. Chính sách không có kỳ hạn số ngày rõ ràng không được tự gán kỳ năm.
- Phân trang lịch sử không làm thay đổi quyền đọc, trạng thái đơn, callback, quyền mua, hủy hoặc đối soát. Các endpoint chi tiết và thao tác đơn tiếp tục giữ kiểm tra phiên/ngữ cảnh hiện có.
- Bấm logo về landing page không đăng xuất, đổi workspace hoặc tạo giao dịch.

## Compatibility impact

`GET /api/billing/account-summary` là endpoint đọc mới. `/api/billing/orders` giữ nguyên các trường hiện có và bổ sung `item`, `paymentConfirmedAt`. Nếu không gửi tham số phân trang, API vẫn trả tối đa 100 giao dịch gần nhất theo thứ tự hiện hữu. Khi gửi `page` hoặc `pageSize`, API trả thêm `pagination` gồm `page`, `pageSize`, `total`, `totalPages`; tối đa 100 giao dịch mỗi trang. Các trang tiếp theo cho phép xem lịch sử cũ mà không tải toàn bộ một lần.

Không thay đổi tenant isolation, role, module permission, assignment/record scope, quyền xuất tài liệu hoặc dữ liệu nghiệp vụ đã được phép đọc. Không mở thêm quyền đọc hoặc thao tác billing của tổ chức đang ở trạng thái `BLOCKED_DECISION`.

## Migration strategy và rollback

Không cần migration schema hoặc dữ liệu. Không tạo lại subscription, giá, payment fact, quota grant hoặc lịch gia hạn. Triển khai endpoint đọc trước giao diện tài khoản mới. Có thể quay lui giao diện hoặc bỏ endpoint mới mà không thay đổi dữ liệu đã lưu; các caller lịch sử không phân trang tiếp tục tương thích.

## Regression seams và bằng chứng

- Phiên tổ chức vẫn trả subscription, số dư và lịch sử của chính tài khoản; loại trừ đơn người khác và đơn tổ chức.
- Tên/kỳ hạn phản ánh phiên bản đã mua; payment time lấy từ payment fact loại payment đã xác minh, không lấy thời điểm refund.
- Gói thuê bao 365 ngày và gói lượt 90 ngày vẫn giữ hai kỳ hạn riêng; expiryPolicy trong quyền lợi đã mua được ưu tiên hơn chính sách chung của snapshot.
- Tài khoản chưa có gói và gói legacy/cấp thủ công được trình bày đúng dữ liệu hiện có, không suy diễn kỳ hạn.
- Phân trang có tổng số chính xác, thứ tự ổn định, truy cập được giao dịch ngoài 100 dòng gần nhất; caller cũ giữ giới hạn 100 dòng.
- Phiên không hợp lệ và tham số phân trang sai bị từ chối trước truy vấn dữ liệu.
- Kiểm thử đọc SQL với fixture cô lập đạt cùng kiểm thử lịch sử và event-loop hiện hữu. Hai endpoint đọc đã chạy trên PostgreSQL kiểm thử riêng và trả HTTP 200, giữ owner cá nhân; không phát sinh mutation thanh toán. Bằng chứng này là kiểm thử cục bộ, không phải triển khai production.
