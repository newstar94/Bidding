# Hướng dẫn Super Admin — Thương mại & Thanh toán

Mở menu **Thương mại & Thanh toán**. Màn hình gồm sáu khu vực: phát hành,
offer/giá, policy, provider, order/activation và lịch sử.

## Quy trình thay đổi catalog

### Tạo gói trong màn hình Gói dịch vụ

Trong Admin, mở **Gói dịch vụ**. Khi cài mới, hệ thống có sẵn bản nháp tám gói năm: Cá nhân/Bạc/Vàng/Kim cương × Cơ bản/Nâng cao. Mẫu đã có giá, thuế trong giá mẫu, hạn mức, tính năng, quyền xuất và thông tin trình bày để chỉnh sửa. Bản nháp không tự mở bán.

Ở lần khởi chạy đầu, chọn **Chỉnh sửa 8 gói mẫu** để mở ngay bản nháp đã gieo sẵn. Khi chưa có bảng giá, chọn **Tạo bộ 8 gói mẫu** để tạo một bộ mẫu đầy đủ mới, kể cả khi thiếu bản nháp khởi tạo; hoặc **Tạo gói đầu tiên** để nhập gói riêng. Bộ mẫu dùng kỳ năm 365 ngày, mốc gia hạn cuối kỳ hiện tại và xử lý phần danh sách Mua Sắm Công đủ lượt, báo riêng phần chưa xử lý. Cá nhân bật cả ba quyền xuất; quyền của tổ chức lấy cấu hình thực tế hiện có. Giá tháng vẫn nhập độc lập sau trong Admin.

- Chọn Cơ bản/Nâng cao, Cá nhân hoặc một trong ba mức Tổ chức; đặt tên và chọn kỳ năm/tháng.
- Chuyển **Bảng quản lý / Thẻ trực quan** để so sánh. Trong từng thẻ, Hàng tháng/Hàng năm được căn giữa và chọn độc lập.
- Bấm **Sửa**, dùng bốn phần Thông tin gói, Giá & kỳ hạn, Hạn mức & tính năng, Trình bày. Thẻ bên cạnh cập nhật khi nhập. Có thể tính VAT và tổng tiền bằng nút tính; tiền VND được làm tròn đến số nguyên.
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

Các quyết định kỳ năm/gia hạn và batch thiếu lượt đã được chốt cho bộ mẫu mới trong ADR 0071. Bản nháp cũ được giữ nguyên; tạo bộ mẫu mới có thể bổ sung những giá trị này đang thiếu hoặc `BLOCKED_DECISION`. Không ghi đè quyết định nguồn đã cấu hình. Mapping quyền xuất tổ chức bị thiếu vẫn cần cấu hình, không được suy thành quyền bật.

Quyền đọc billing history tổ chức vẫn cần business contract riêng. Các blocker
khác không phải lỗi kỹ thuật để bỏ qua.

Provider payOS ở shadow cho tới khi merchant/legal/webhook/credential readiness
đạt. Refund MVP là quy trình thủ công/off-platform có audit; thao tác cancel
payment link không phải hoàn tiền.

Bộ mẫu đạt kiểm tra và phát hành nội bộ ở chế độ shadow. Mở bán thật vẫn cần
thuế/hóa đơn và reference merchant/legal/webhook/provider live. Bản phát hành mới
có liên kết gói để kích hoạt; lịch gia hạn sớm giữ kỳ hiện tại rồi áp dụng kỳ mới
khi đến hạn. Kiểm tra cục bộ không xác nhận merchant/webhook đang hoạt động thật.

## Cấu hình thuế và payOS

Mở bản nháp, chọn khu vực **Thuế & hóa đơn** và **Thanh toán payOS**:

1. Chọn giá đã/chưa gồm thuế, nhập thuế suất được xác nhận, cách làm tròn VND và tham chiếu quyết định. Điền thông tin bên bán khi có.

   Theo cấu hình chủ sản phẩm đã chốt, mẫu mới đặt **Giá đã gồm VAT** và **Không xuất hóa đơn**. Thuế suất và các thông tin còn lại cấu hình sau; chưa đủ thông tin thì bản nháp vẫn không mở bán chính thức.
2. Đối chiếu subtotal/thuế/tổng của từng gói với chính sách chung. Thay chính sách chung không tự sửa giá đã nhập. Với gói lượt, giá nguồn là tổng nếu đã gồm thuế, hoặc giá trước thuế nếu chưa gồm thuế; hệ thống tính đúng tổng ở cửa hàng và checkout.
3. Chọn **Có xuất hóa đơn** hoặc **Không xuất hóa đơn**. Khi bật, chọn thời điểm tạo yêu cầu: sau khi xác minh thanh toán hoặc khi kích hoạt. Lựa chọn xử lý ngoài luồng tự động; ứng dụng chưa phát hành hóa đơn điện tử qua một nhà cung cấp. Có thể để Không xuất hóa đơn khi bán với tư cách cá nhân và bật lại bằng một bản phát hành mới sau này.
4. Cấu hình profile payOS production, reference kho bí mật, hạn mức và TTL. Chỉ chuyển live/ready sau khi người vận hành có đủ xác nhận thực tế. Không nhập client ID/API key/checksum key vào bản nháp hoặc gửi vào chat.
5. Nhập đủ năm reference thuế/hóa đơn, merchant, credential/webhook, thương mại điện tử/quyền riêng tư, điều khoản/hoàn tiền. Lưu, kiểm tra, rồi phát hành bằng digest mới và tái xác thực như trước.

Khi kiểm tra còn lỗi, thông báo liệt kê từng cấu hình hoặc xác nhận còn thiếu.
Nút **Mở cấu hình** mở phần thuế hoặc payOS tương ứng và giữ nguyên nội dung
bản nháp. Với **Không xuất hóa đơn**, xác nhận thuế/hóa đơn mang nghĩa xác nhận
chính sách thuế đang áp dụng; thời điểm yêu cầu hóa đơn và thông tin bên bán
không bắt buộc. Thuế suất và cách làm tròn vẫn cần được cấu hình. Tham chiếu
bộ khóa payOS chỉ có khoảng trắng không được coi là đã cấu hình.

Khóa payOS nằm trong môi trường theo ADR 0019. Biểu mẫu không đăng ký webhook,
không kiểm chứng credential và không tự bật thanh toán. Thực hiện xác nhận
webhook trên merchant thực theo quy trình vận hành trước khi mở bán.

## Kích hoạt và gia hạn

- Khách chọn **Chọn gói** để mua mới hoặc **Gia hạn gói này** để nối đúng gói đang dùng. Gói khác hoặc chính sách chưa được hỗ trợ sẽ được báo trước khi tạo thanh toán.
- Chỉ kết quả thanh toán được provider xác minh mới có thể kích hoạt; trang chuyển hướng không cấp quyền lợi.
- Gia hạn trước hết hạn: đơn hiển thị **Chờ đến kỳ kích hoạt** cùng ngày bắt đầu. Kỳ hiện tại và số lượt hiện tại giữ nguyên; lượt của kỳ mới được cấp khi worker kích hoạt đến hạn.
- Các đơn gia hạn liên tiếp nối thành các kỳ riêng. Admin thay đổi thuê bao trong thời gian chờ hoặc đơn có hoàn tiền phải được kiểm tra, không tự ghi đè quyền lợi.
- Không có trừ tiền tự động mỗi tháng/năm. Mỗi gia hạn tạo một đơn mới do khách thanh toán.
- Plan đã phát hành trước bản sửa nhưng thiếu mapping không được sửa hồi tố; tạo bản phát hành mới để mở bán đúng luồng.
