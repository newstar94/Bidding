# ADR 0076 — Giá tháng làm gốc, giá năm bằng giá tháng × 10

- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm ngày 2026-10-08.

## Business contract

1. Trong trình tạo/chỉnh sửa gói, admin nhập một giá gốc tháng. Giá năm bằng giá gốc tháng × 10, không nhập giá năm riêng. Hai kỳ vẫn có thời hạn tháng/năm hiện hữu; hệ số giá không đổi thời hạn năm 365 ngày.
2. Giá gốc theo chính sách VAT của bản nháp: khi giá đã gồm VAT, giá tháng/năm là tổng thanh toán; khi chưa gồm VAT, là giá trước thuế. Thuế của từng kỳ được tính lại theo thuế suất và làm tròn đã cấu hình, không nhân khoản thuế tháng đã làm tròn. Cấu hình đã được duyệt hiện tại là giá gồm VAT, thuế 0%, làm tròn lên.
3. Giá gốc được lưu trong `price.monthlyBaseAmount`. Backend kiểm tra giá của từng kỳ, quan hệ giữa hai kỳ nếu cùng có trong bản nháp và phép tính thuế trước khi phát hành. Không suy hạn mức lượt tháng từ năm hoặc đổi quyền lợi giữa các kỳ.
4. Giá tháng làm gốc không tự mở bán kỳ tháng: việc tạo offer tháng, nhập kỳ hạn và quota vẫn theo thao tác cấu hình hiện hữu. Thay đổi được lưu vào bản nháp, kiểm tra và phát hành qua revision/digest/tái xác thực/audit hiện hành.

## Compatibility impact

Release, báo giá, đơn và thuê bao đã ghim snapshot không bị tính lại. Giá cũ trong draft không tự sửa khi chỉ mở màn hình; khi admin nhập lại giá tháng, các offer tháng/năm cùng nhóm/mức/đối tượng trong draft được cập nhật, giữ nguyên metadata, SKU, quota và quyền. Giá năm cũ chia hết cho 10 có thể hiển thị giá tham chiếu tháng để chỉnh; nếu không chia hết thì yêu cầu nhập giá tháng. Các tài liệu cũ không có `monthlyBaseAmount` giữ hợp đồng cũ.

Không thay đổi role, tenant/module/assignment/record scope, masking, quyền đọc hoặc quyền xuất; không nhân bản hoặc phát hành dữ liệu tự động.

## Migration strategy

Không migration DB: giá gốc bổ sung trong document JSON và các snapshot mới. Để áp dụng vào bảng giá hiện hành, chỉnh bản nháp, kiểm tra rồi phát hành phiên bản mới. Khi triển khai artifact, backend hỗ trợ kiểm tra mới trước frontend. Quay lui bằng release mới; giữ nguyên lịch sử đã mua.

## Regression seams

- Integer VND, ×10, overflow, giá trống/âm/phân số.
- VAT gồm/chưa gồm, làm tròn từng kỳ, giá năm/tổng thuế khớp validator.
- Tạo gói, chỉnh gói, chuyển kỳ, xem trước, lưu thất bại/retry, dữ liệu nhập không mất.
- Giữ quota từng kỳ, quyền xuất, unknown fields, gói khác và release legacy.
- Validator từ chối giá năm bị sửa hoặc giá tháng không khớp gốc.
