# ADR 0084 — Lượt năm bằng lượt tháng ×15

Ngày: 2026-10-10

Trạng thái: đã được chủ sản phẩm xác nhận: “Lượt năm bằng lượt tháng x15”. Thay thế phần chờ quyết định quota của ADR 0082 và ADR 0083.

## Business contract

Lượt lấy dữ liệu tự động của kỳ tháng là cấu hình gốc. Lượt năm bằng lượt tháng ×15; giá năm vẫn bằng giá tháng ×10. Chu kỳ giữ 30/365 ngày. Cơ bản không có lấy dữ liệu tự động nên cả hai kỳ có 0 lượt. Bốn gói lượt mua thêm tiếp tục cấu hình giá và số lượt độc lập, không áp dụng hệ số kỳ hạn này.

Admin nhập lượt tháng một lần trong trình tạo hoặc chỉnh gói. Hạn mức trong kỳ hiển thị tự tính và không nhập riêng. Việc cấu hình được ghi vào bản nháp; vẫn cần lưu, kiểm tra và xác nhận phát hành. Chỉnh quota không tự mở bán hoặc đổi quyền xuất, số thành viên, trạng thái bán, giá và metadata không liên quan.

Bộ mẫu khởi tạo mới có cấu hình Nâng cao tường minh, có thể chỉnh:

| Mức | Lượt tháng | Lượt năm |
| --- | ---: | ---: |
| Cá nhân | 100 | 1.500 |
| Bạc | 200 | 3.000 |
| Vàng | 600 | 9.000 |
| Kim cương | 1.500 | 22.500 |

Các giá trị mẫu đáp ứng cả công thức ×15 và điều kiện lợi ích Nâng cao hiện hành với giá, gói lượt mẫu. Không sửa ngưỡng lợi ích để hợp thức hóa mẫu. Quyền xuất tổ chức tiếp tục lấy từ ánh xạ thực tế; các xác nhận payOS và điều kiện mở bán công khai vẫn cần hoàn tất.

## Compatibility impact

Document sử dụng metadata `offer.monthlyBaseProcurementQuota` để ghi cấu hình lượt gốc. Máy chủ kiểm tra kiểu số nguyên, hệ số của mỗi kỳ và tính nhất quán của các SKU cùng tier/variant/ownerKind. Giới hạn lượt mỗi SKU hiện hữu là 100.000, do đó lượt tháng dùng công thức ×15 tối đa 6.666.

Document lịch sử không có metadata này vẫn giữ hạn mức độc lập đã phát hành. Không tự chia, làm tròn hoặc đổi quota lịch sử để ép công thức mới. Giá trị năm chia hết cho 15 hoặc hạn mức tháng đã có chỉ được đưa vào ô gợi ý; quota cũ đổi khi Admin nhập cấu hình mới. Thay đổi giá đơn thuần không tính lại quota của hai kỳ đã có.

Nếu cấu hình quota làm phát sinh kỳ còn thiếu, sao chép các quyền và metadata theo luồng hiện hành; kỳ mới chưa mở bán. Chỉ cấu hình giá từ giá gốc tháng đã ghi tường minh; khi chưa có giá gốc, kỳ mới để trống giá để Admin hoàn tất.

Tạo bộ mẫu mới từ cấu hình có sẵn sử dụng lượt tháng đã cấu hình làm gốc cho bản nháp mẫu mới. Nhân bản snapshot thông thường giữ nguyên toàn bộ dữ liệu nguồn. Giá/quyền lợi trong báo giá, đơn và thuê bao đã mua vẫn lấy từ snapshot lịch sử.

## Migration và rollback

Không migration DB, không cập nhật release hoặc seed draft hiện hữu khi khởi động lại. Seed mới và nút Tạo bộ 20 gói mẫu dùng cấu hình trên. Bản nháp cũ được chỉnh lượt tháng trong Admin và phát hành phiên bản mới khi đủ điều kiện. Rollback bằng code cũ hoặc phát hành lại document đã duyệt; không sửa grant hoặc thuê bao đã kích hoạt.

## Regression seams

- Tính 120 lượt tháng thành 1.800 lượt năm; từ chối số âm, lẻ, trống và vượt giới hạn.
- Sửa đúng một nhóm gói; giữ giá, quyền, trạng thái và gói không liên quan.
- Máy chủ từ chối sửa tay lệch lượt tháng/năm của document có metadata; document lịch sử không có metadata vẫn hợp lệ.
- Bộ 20 mẫu hoàn chỉnh qua kiểm tra nội bộ với ánh xạ quyền tổ chức thực tế, hai kỳ có lượt và giá đúng hệ số.
- Trình duyệt cập nhật hai kỳ và thẻ xem trước, vô hiệu kết quả kiểm tra cũ, giữ nội dung khi lưu thất bại.
- Thanh toán và kích hoạt trên PostgreSQL cấp đúng lượt cho tháng/năm, đúng hạn 30/365 ngày cho Cá nhân và Tổ chức; xử lý lại kết quả thanh toán không cấp thêm lượt.
