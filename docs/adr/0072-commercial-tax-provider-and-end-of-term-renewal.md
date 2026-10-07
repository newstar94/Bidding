# ADR 0072 — Cấu hình thuế, payOS và gia hạn từ cuối kỳ

- Trạng thái: triển khai theo yêu cầu chủ sản phẩm ngày 2026-10-07; giá trị thuế/hóa đơn thực tế còn chờ chủ sản phẩm cung cấp.
- Tiếp nối ADR 0018, 0019 và 0071.

## Business contract

- Gói phát hành mới có projection tương thích riêng theo từng plan version, lấy đúng giá, hạn mức và ba quyền xuất đã ghim. Không sửa các hàng Bạc/Vàng/Kim cương legacy hoặc quyền của thuê bao cũ. Ngừng bán không làm projection của kỳ đã mua ngừng hoạt động. API sửa gói legacy không được sửa projection bất biến này.
- Gia hạn giữ đúng gói logic, owner, tier và biến thể. Chuyển gói/kỳ có mã SKU khác tiếp tục cần chính sách chuyển gói; không suy upgrade/downgrade từ thao tác gia hạn. Kiểm tra trước khi tạo thanh toán.
- Với `renewalAnchor.end_of_term` đã được duyệt, kỳ mới bắt đầu từ cuối kỳ hiện tại còn hiệu lực; chủ sản phẩm xác nhận kỳ đã hết hạn bắt đầu từ thời điểm giao dịch thanh toán do provider xác minh, không phải thời điểm worker xử lý muộn hơn. Thời lượng lấy từ snapshot: năm dùng `baseTerm`, tháng dùng `monthlyBaseTerm`, không tự tính giá/thời lượng tháng từ năm.
- Gia hạn sớm được ghi lịch bền vững trong activation pending. Giữ thuê bao và lượt hiện tại đến hết kỳ. Worker chỉ áp dụng lịch đến hạn, cấp lượt của kỳ mới đúng một lần và ghim đúng snapshot đã trả tiền. Nhiều đơn gia hạn xếp nối tiếp; mỗi lịch ghim plan/source order của kỳ đứng trước và revision dự kiến. Admin thay đổi thuê bao trong thời gian chờ phải được đối soát, không tự ghi đè.
- Hoàn tiền đang chờ hoặc đã ghi nhận ngăn kích hoạt kỳ chờ. Callback lặp không đổi trạng thái hoàn tiền hoặc mở lại activation đã reversed. Không thêm cơ chế trừ tiền tự động; mỗi gia hạn vẫn là đơn thanh toán được khách xác nhận.
- Quote ghim profile provider thực tế từ runtime và cấu hình release. Checkout dùng đúng ID/ref/mode đã ghim; giới hạn tiền đáp ứng cả merchant profile và release, TTL lấy từ snapshot. Đơn cũ giữ profile cũ; quote legacy chưa có ID giữ đường tương thích.
- Super Admin cấu hình thuế/hóa đơn/payOS bằng trường biểu mẫu. `invoiceEnabled=false` là trạng thái bán với tư cách cá nhân hiện tại: không tạo yêu cầu hóa đơn tự động. Có thể bật lại trong bản phát hành sau khi thành lập hộ kinh doanh/doanh nghiệp; lúc đó chọn thời điểm yêu cầu và điền thông tin bên bán/reference. Secret vẫn chỉ nằm trong môi trường/kho bí mật; form chỉ lưu reference. Không tự chọn VAT, thông tin bên bán, tài liệu phê duyệt, trạng thái readiness hoặc bật các cờ môi trường.
- Chủ sản phẩm xác nhận giá đã gồm VAT; mẫu mới dùng `taxInclusive=true`, `invoiceEnabled=false`. Thuế suất, thông tin bên bán và cách làm tròn cấu hình sau trong Admin. Không đặt thuế suất bằng 0 từ quyết định không xuất hóa đơn. Thuế hỗ trợ giá đã/chưa gồm thuế, thuế suất integer basis points và cách làm tròn `half_up`, `floor`, `ceil`; từng giá gói phải khớp subtotal/tax/total. Gói lượt dùng cùng phép tính ở catalog, quote và projection. Đây là các lựa chọn có thể cấu hình, không phải xác nhận thuế suất áp dụng.
- `invoiceTrigger` có ba lựa chọn: `verified_payment` tạo yêu cầu khi xác minh thanh toán; `activation_applied` tạo khi kích hoạt kể cả retry; `manual` xử lý hóa đơn ngoài luồng tự động. Yêu cầu hóa đơn và outbox chỉ có một lần mỗi đơn; chưa tích hợp nhà phát hành hóa đơn điện tử. Order legacy thiếu trigger giữ hành vi tạo yêu cầu như trước.
- Pilot/production yêu cầu đủ năm reference hiện hữu, quyết định thuế và profile payOS production live/ready hợp lệ. Metadata Admin không thay thế bằng chứng vận hành/kiểm tra runtime.
- Không thay role, thẩm quyền mua, quyền đọc billing tổ chức, tenant/module/assignment/record scope, masking hoặc dữ liệu mà người dùng được phép đọc.

## Compatibility impact

Đây là bổ sung runtime của quyết định đã ghi trong ADR 0071. Release/order cũ bất biến và không được tính lại thuế, sửa mapping hoặc reseed. Các plan đã phát hành trước thay đổi nhưng thiếu mapping cần phát hành bản mới; không sửa lịch sử để hợp thức hóa. Các SKU hoặc policy chưa có quyết định vẫn giữ review.

## Migration strategy và rollback

Không thêm schema hoặc reseed. Lịch dùng `billing_subscription_activations.state=pending`, `after_json` và `expected_revision` hiện hữu. Triển khai backend trước frontend có metadata lịch. Backend, worker và checkout phải cùng phiên bản; không hạ worker về bản không hiểu lịch pending vì worker cũ sẽ xử lý lịch trước hạn.

Nếu cần dừng mở bán, tắt checkout mới theo quy trình hiện hữu; giữ worker hỗ trợ lịch và đối soát các đơn đã trả. Không xóa đơn, invoice request, lịch activation hoặc ledger. Chưa gọi giao dịch thật, confirm-webhook hoặc phát hành production trong nhiệm vụ này.

## Regression seams

- Publish thật → checkout → provider paid → activation của tám tổ hợp; release sau/ngừng bán không thay quyền cũ.
- Thuế inclusive/exclusive và rounding VND; quote/projection/công khai gói lượt đồng nhất.
- Provider ghim cùng ID/ref/mode, không fallback sang routing mới; config JSON sai dạng/unsupported bị báo lỗi validation.
- Gia hạn sớm Cá nhân/Tổ chức giữ kỳ hiện tại, worker đến hạn, callback lặp không cấp trùng; lịch nối tiếp ghim predecessor, thay đổi Admin bị giữ review.
- Refund intent pending qua phương thức thật chặn lịch; callback không mở lại refunded/reversed.
- Invoice trigger payment/activation/manual, activation retry tạo đúng một request/outbox.
- UI lưu cấu hình không tự điền quyết định, làm hết hiệu lực digest; UI gia hạn hiển thị ngày bắt đầu và dừng polling lịch tương lai.

## Giới hạn bằng chứng

Kiểm tra PostgreSQL dùng dữ liệu kiểm thử/schema riêng được hoàn tác. Chưa chứng minh merchant/webhook hoặc hóa đơn hoạt động bên ngoài. Cấu hình secret/cờ có sẵn chỉ xác nhận hiện diện; không chứng minh credential còn hợp lệ.
