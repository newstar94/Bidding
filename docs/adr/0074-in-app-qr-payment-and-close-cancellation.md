# ADR 0074 — QR thanh toán trong popup và hủy khi đóng

- Ngày: 2026-10-07.
- Trạng thái: Accepted theo yêu cầu chủ sản phẩm trong cuộc trao đổi hiện tại.
- Tiếp nối ADR 0019, 0020, 0072 và 0073.

## Business contract

Chủ sản phẩm yêu cầu: bấm chọn gói mở QR thanh toán trong popup; bấm Hủy hoặc đóng popup thì hủy giao dịch chưa thanh toán.

- Khi người dùng chọn gói hoặc gia hạn, giao diện mở popup trong ứng dụng ngay và hiển thị trạng thái tạo thanh toán. QR và số tiền xuất hiện khi máy chủ trả kết quả tạo checkout. Không tạo một cửa sổ trình duyệt riêng cho luồng mặc định.
- QR, thông tin chuyển khoản, số tiền và thời hạn phải thuộc đúng đơn đã ghim báo giá, gói, kỳ hạn và provider. Giao diện không tự tính lại giá, tự ghép thông tin chuyển khoản hoặc lấy QR từ đơn khác.
- Nút Hủy, dấu đóng, phím Escape và thao tác đóng bằng vùng nền có cùng ý nghĩa: yêu cầu máy chủ hủy checkout đang chờ thanh toán. Đóng popup không tự chứng minh rằng provider đã hủy.
- Nếu đóng trong lúc tạo báo giá, dừng trước khi tạo checkout khi còn có thể. Nếu yêu cầu tạo checkout đã gửi, giữ ý định hủy và gửi yêu cầu hủy đúng đơn ngay khi nhận được định danh đơn. Kết quả tạo muộn không được tự mở lại popup hoặc bỏ ý định hủy.
- Một lần chọn gói dùng một định danh yêu cầu checkout ổn định; thao tác lặp khi đang tạo/hủy không sinh thêm đơn ngoài ý muốn. Khi đã hủy, lần chọn gói mới là một giao dịch mới theo luồng báo giá hiện có.
- Máy chủ ghi yêu cầu hủy qua command bền vững và dùng provider đã ghim của đơn. Nếu tạo checkout và hủy chạy đồng thời, yêu cầu hủy phải được giữ đến khi xác định được kết quả tạo; kết quả tạo muộn không được mở lại checkout đã được xác nhận hủy hoặc hết hạn.
- Chỉ hiển thị hủy thành công sau khi trạng thái có thẩm quyền xác nhận checkout đã hủy hoặc hết hạn. Nếu lỗi mạng, provider đang xử lý hoặc kết quả chưa rõ, hiển thị trạng thái đang hủy/chưa xác nhận và theo dõi lại đơn; không ghi nhận thành công chỉ vì popup đã đóng hoặc API trả HTTP 200.
- Khi người dùng thử hủy lại sau khi lệnh hủy đã hết số lần thử tự động, tiếp tục dùng chính lệnh của đơn chưa thanh toán còn mở. Giữ nội dung yêu cầu và số lần thử để đối chiếu provider trước khi gửi lại; không tạo lệnh trùng, không kích hoạt lại đơn đã hủy/hết hạn.
- Nếu tiền đã được provider xác nhận trước hoặc trong lúc hủy, giữ sự kiện thanh toán và luồng kích hoạt/gia hạn hiện có. Thông báo cho người dùng rằng đơn đã thanh toán, không thể hủy checkout. Đóng popup không hoàn tiền, đảo kích hoạt hoặc làm mất bằng chứng thanh toán. Chính sách không hoàn tiền đã được duyệt tiếp tục áp dụng.
- QR, callback và thao tác đóng popup không xác minh thanh toán. Chỉ kết quả provider đã xác thực qua các seam hiện hữu được kích hoạt quyền lợi đúng một lần.
- Giữ nguyên thẩm quyền mua, đọc/thao tác đơn, kiểm tra phiên, tenant/module/assignment/record scope, role, entitlement, audit và cách hiển thị dữ liệu được phép đọc. Popup sử dụng API của đơn trong phạm vi đã được cấp quyền; contract này không mở thêm quyền đọc hoặc hủy billing của tổ chức đang có trạng thái `BLOCKED_DECISION`.

## Compatibility impact

Luồng chọn gói mặc định chuyển từ cửa sổ payOS bên ngoài sang popup QR trong ứng dụng. QR được vẽ trực tiếp trong dialog từ dữ liệu provider đã xác thực, không dùng iframe, SDK hoặc CDN. API checkout/order giữ các trường hiện hữu và bổ sung `paymentDetails`, gồm chuỗi QR gốc và `qrCodeImage` được dựng từ cùng chuỗi đó cùng các thông tin chuyển khoản đã xác thực của đúng đơn. Các đơn đang mở vẫn được tiếp tục theo dõi hoặc mở lại bằng thao tác rõ ràng của người dùng; đóng popup mới áp dụng yêu cầu hủy mới.

Release, báo giá, order cũ, provider profile, lịch gia hạn và ledger bất biến. Không sửa giá, thuế, quyền lợi hoặc trạng thái lịch sử để phù hợp giao diện. Trạng thái thanh toán đã xác minh thắng ý định đóng popup; thao tác hủy không được dùng thay cho refund.

## Migration strategy và rollback

Migration v100 bổ sung cột nullable `billing_orders.checkout_payment_json` để lưu dữ liệu thanh toán của đúng đơn sau khi adapter kiểm tra chữ ký và đối chiếu provider result. Đơn cũ giữ giá trị NULL; không reseed, truy hồi hoặc tự sửa dữ liệu lịch sử. Projection `paymentDetails` là bổ sung tùy chọn; không đưa credential, chữ ký nội bộ hoặc response provider đầy đủ xuống trình duyệt. Ý định hủy tiếp tục dùng `billing_provider_commands.cancel_checkout` hiện hữu.

Triển khai backend xử lý cuộc đua tạo/hủy và projection QR trước frontend popup. Giữ worker xử lý các command hủy đang chờ và đối soát các đơn đã tạo. Khi rollback giao diện, không xóa order, command hủy, webhook, payment fact, activation hoặc audit; backend phải tiếp tục hoàn tất các yêu cầu hủy đã tiếp nhận.

## Regression seams

- Bấm chọn gói mở popup đồng bộ; nhận checkout đúng đơn rồi hiển thị QR/số tiền/thời hạn, không phụ thuộc popup trình duyệt.
- Hủy/dấu đóng/Escape/vùng nền đều yêu cầu hủy cùng một đơn; bấm lặp không tạo thêm checkout hoặc command hủy.
- Đóng trước quote hoàn tất không tạo checkout; đóng sau khi gửi tạo checkout vẫn hủy đơn đến muộn và không tự mở lại popup.
- Tạo và hủy chạy đồng thời: provider chưa có checkout, create hoàn tất muộn, hủy đã xác nhận, retry sau kết quả chưa rõ; terminal state không bị mở lại bởi response cũ.
- Mạng lỗi/API bận/HTTP 200 nhưng chưa hủy: giao diện giữ trạng thái chưa xác nhận, có thể thử lại theo đúng đơn; không báo hủy thành công sai.
- Provider xác nhận đã thanh toán trước hoặc trong khi hủy: lưu payment fact, kích hoạt/gia hạn đúng một lần; không đảo hoặc hoàn tiền do popup đóng.
- Callback không có thẩm quyền thanh toán, đúng owner/session/provider binding, quyền hiện hữu và các đơn legacy tiếp tục được bảo toàn.

## Giới hạn bằng chứng

ADR ghi quyết định nghiệp vụ và các seam cần kiểm chứng. Kiểm thử tự động dùng provider giả hoặc transport kiểm soát được. Ở bước triển khai popup ban đầu, kiểm thử thực tế trên máy này chỉ tạo và hủy liên kết chưa thanh toán của tài khoản cá nhân kiểm thử; không chuyển tiền thật hoặc thao tác đơn của khách hàng.

Ngày 2026-10-08, luồng giao diện thực tế đã mở dialog ngay, tải ảnh QR của đơn 2.000đ, không mở tab trình duyệt mới và hủy đơn sau thao tác dấu X. API trả trạng thái `cancelled`, thanh toán vẫn `unverified`; trình duyệt không ghi nhận lỗi JavaScript. Schema cục bộ đã nâng từ 99 lên 100 sau dry-run có rollback. Đây là bằng chứng trên máy thử nghiệm, chưa phải xác nhận thanh toán đã chuyển tiền hoặc triển khai production.

Luồng này tiếp tục đạt sau khi khởi động bản bundle mới: popup căn giữa ở viewport 1440×1000, QR tải thành công, dấu X hủy đơn `order-6589b421f06f4d9b9ee6bbc145361aa5`. Đối chiếu trực tiếp payOS với một đơn kiểm thử trước đó cho kết quả `CANCELLED`, số tiền đã nhận 0đ. Các tài khoản kiểm thử được ngừng hoạt động sau khi thử, giữ lịch sử thanh toán đã hủy. Cơ sở dữ liệu ứng dụng và cơ sở dữ liệu kiểm thử riêng đều đạt contract schema 100.

## Khắc phục giao dịch đã thanh toán ngày 2026-10-08

Chủ sản phẩm đã thanh toán 2.000đ nhưng popup vẫn chờ thanh toán và sau thao tác Hủy vẫn chờ xác nhận hủy. Đối chiếu GET thực tế từ payOS xác nhận `PAID` và đủ tiền; webhook đã được tiếp nhận. Nguyên nhân xác định bằng replay phản hồi thật:

- Bộ chuẩn hóa chữ ký đổi `null` bên trong `transactions` thành chuỗi rỗng, khác quy tắc ký của SDK payOS. Adapter giữ nguyên các giá trị lồng bên trong trước khi xác minh chữ ký.
- GET đặt thời điểm thanh toán và mã giao dịch trong `transactions`. Adapter chỉ chiếu bằng chứng sau khi xác minh chữ ký, khi đúng một giao dịch có đủ số tiền và có mã/thời điểm rõ ràng. Không dùng thời điểm tạo link hay thời điểm nhận xác nhận để thay thế thời điểm trả tiền; dữ liệu mơ hồ tiếp tục vào luồng đối soát hiện hữu.
- Khi thanh toán đã được xác minh, luồng hủy chuyển sang thông báo đã thanh toán và theo dõi kích hoạt. Khi kích hoạt hoàn tất, giao diện tải lại phiên có thẩm quyền qua bộ kiểm tra phiên hiện hữu và cập nhật gói/quyền lợi, kể cả khi popup đã đóng.
- Bắt đầu hủy vô hiệu hóa phản hồi polling từ trước thao tác hủy; kết quả unpaid cũ không được ghi đè kết quả paid mới. Các phản hồi hủy chỉ cập nhật đúng phiên/workspace ban đầu. Nếu bộ kiểm tra phiên gặp lỗi mạng, giao diện vẫn giữ kết quả kích hoạt có thẩm quyền và báo quyền lợi trong phiên đang chờ cập nhật.

Đơn `order-852ac7ad37f042dcbd38ab93d7f19a6e` được phục hồi bằng API đối soát Admin hiện hữu, có xác thực lại và audit. PayOS xác nhận thời điểm trả tiền trước hạn QR; xác nhận đến muộn vẫn là thanh toán đúng hạn. Sau hai lần đối soát, cơ sở dữ liệu có đúng một payment fact đã xác minh 2.000đ, một activation `applied`, subscription `active` với revision 1 và một grant 1.000 lượt theo snapshot của đơn. Không ghi trạng thái thanh toán thủ công, không tạo thêm giao dịch hay hoàn tiền.

Thay đổi giữ nguyên contract giá, thời hạn, quyền, scope và chính sách thanh toán muộn. Không cần migration cho hai lỗi xác minh này. Các regression gồm vector chữ ký độc lập của SDK với nested null, adapter đến activation đúng một lần, trường hợp bằng chứng giao dịch mơ hồ, kích hoạt sau hủy và cập nhật phiên sau thanh toán. Đây là bằng chứng thanh toán thật trên máy thử nghiệm hiện tại, chưa phải triển khai production.

Kiểm thử tập trung cuối cùng đạt 133 bài Python (10 bài bỏ qua theo điều kiện môi trường) và 34 bài JavaScript. ESLint phạm vi storefront và diff check đạt. `/health/ready` trên máy này trả 200; nội dung module storefront do máy chủ cục bộ phục vụ khớp byte với bản sửa. Trình duyệt đang mở của chủ sản phẩm chưa được kiểm chứng trực tiếp trong lần phục hồi này vì plugin không cung cấp phiên kết nối; tải lại trang một lần để nạp code giao diện mới. Truy cập nguồn từ bên ngoài không có phiên Cloudflare Access chuyển tới trang đăng nhập, nên không coi HTTP 200 đó là bằng chứng frontend công khai đã được xác minh.
