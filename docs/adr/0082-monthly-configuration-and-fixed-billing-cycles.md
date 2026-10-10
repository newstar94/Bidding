# ADR 0082: Cấu hình giá tháng và tự tạo hai kỳ thanh toán

- Trạng thái: Giá và chu kỳ đã được chủ sản phẩm chấp thuận; phần quy đổi hạn mức Nâng cao đã được thay thế bằng ADR 0084: lượt năm = lượt tháng ×15.
- Ngày: 2026-10-10
- Thay thế phần yêu cầu tạo kỳ tháng riêng tại ADR 0076.

## Business contract

Admin nhập một giá gốc tháng. Giá năm được tính bằng giá tháng × 10, tính lại VAT theo từng kỳ và chính sách làm tròn hiện có. Kỳ tháng là 30 ngày; kỳ năm là 365 ngày.

Trình tạo gói cung cấp cả hai kỳ mà không yêu cầu bật từng kỳ riêng. Khi cấu hình giá của gói hiện hữu, bổ sung kỳ còn thiếu trong bản nháp. Gói đã lưu giá gốc tháng nhưng thiếu kỳ được hoàn thiện khi đọc/lưu cấu hình, không cần nhập lại giá.

Không tự phát hành hoặc sửa bản phát hành đang có hiệu lực. Lưu bản nháp, kiểm tra và xuất bản vẫn đi qua revision, digest, xác thực lại và audit hiện hành.

Hạn mức và quyền của hai kỳ đã tồn tại được bảo toàn. Gói Cơ bản vẫn có hạn mức lấy dữ liệu tự động bằng 0. Với kỳ Nâng cao còn thiếu, giữ contract cấu hình quota tường minh: hạn mức chưa xác định và chưa mở bán; không tự suy hạn mức từ giá. Quy tắc quy đổi quota năm từ tháng đang chờ chủ sản phẩm xác nhận. Trình tạo vẫn giữ hành vi hiện hữu áp dụng giá trị hạn mức mà Admin nhập cho cả hai kỳ.

## Compatibility impact

Không đổi SKU hiện hữu, API, role, tenant, module, assignment, record scope, masking hoặc quyền xuất. SKU kỳ còn thiếu được thêm theo định danh tier.variant.period hiện hành. Metadata không liên quan được bảo toàn; nhãn kỳ của SKU nguồn không được sao chép sai sang kỳ mới.

Báo giá, đơn và thuê bao đã ghim snapshot giữ nguyên giá, thời hạn, hạn mức và quyền đã mua. Không tính lại lịch sử từ cấu hình mới.

## Migration và rollback

Không migration DB. Cấu hình mới áp dụng vào document của bản nháp; phát hành phiên bản mới sau khi đủ điều kiện. Bảng giá công khai chỉ dùng các kỳ thực sự đã phát hành, không dựng giá giả trên frontend. Rollback code và phát hành lại chính sách trước đó; giữ toàn bộ lịch sử.

## Regression seams

- Tái hiện gói chỉ có năm: nhập giá tháng tạo kỳ tháng, nút chọn tháng không còn bị khóa trong Admin, giá hai kỳ đúng ×10.
- Lưu và chuyển kỳ không làm mất nội dung đang sửa hoặc nhân đôi SKU.
- Cấu hình giá gốc đã lưu được hoàn thiện, tạo năm từ gói tháng, kiểm tra trùng mã và giữ gói không liên quan.
- VAT được tính riêng từng kỳ; giữ hạn mức, quyền và metadata hiện hữu.
- Chu kỳ lưu là 30/365 ngày; máy chủ kích hoạt đúng thời hạn và hạn grant cho Cá nhân/Tổ chức. Snapshot tháng cũ 31 ngày vẫn hoạt động đúng 31 ngày.
