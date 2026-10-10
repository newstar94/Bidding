# ADR 0083 — Bộ 20 gói mẫu và cấu hình phát hành từ danh sách

Ngày: 2026-10-10

Trạng thái: cấu trúc, giá, kỳ hạn và điều khiển danh sách đã được yêu cầu. Phần chờ xác nhận lượt bên dưới đã được thay thế bằng ADR 0084: lượt năm = lượt tháng ×15.

## Business contract

Khởi tạo lần đầu tạo một bản nháp gồm 16 cấu hình dịch vụ: bốn mức Cá nhân/Bạc/Vàng/Kim cương, hai nhóm Cơ bản/Nâng cao, hai kỳ tháng/năm. Bốn gói lượt mẫu vẫn nằm trong cùng bản nháp; Admin chỉnh giá và số lượt bằng biểu mẫu ngay tại danh sách.

Giá tháng là gốc, giá năm bằng tháng ×10. Giá tháng mẫu được ghi tường minh; giá năm mẫu trước đây được giữ nguyên. Kỳ tháng 30 ngày, năm 365 ngày. Giữ chính sách thuế 0%, đã gồm VAT, làm tròn lên, không xuất hóa đơn cùng các cấu hình thanh toán và pháp lý đã chốt.

Quyền xuất lấy từ ánh xạ gói thực tế; thiếu ánh xạ tổ chức vẫn là điều kiện cần cấu hình. Cơ bản có lượt tự động bằng 0. Giữ các hạn mức Nâng cao năm đã có. Không suy hạn mức tháng từ giá hoặc thời hạn: bốn cấu hình Nâng cao tháng để hạn mức chưa xác định, chưa mở bán cho đến khi Admin cấu hình hoặc chủ sản phẩm chốt quy đổi. Kiểm tra máy chủ hiện hành vẫn yêu cầu cấu hình hoàn chỉnh trước khi phát hành.

Các giá và số lượt của bốn gói lượt hiện có được giữ làm giá trị mẫu có thể sửa. Mã gói là định danh SKU ổn định; sửa số lượt không đổi mã và không sửa lịch sử mua.

Chế độ phát hành chung (Thử nội bộ/Thí điểm/Công khai) và trạng thái bán từng kỳ (Mở bán/Chưa mở bán/Dừng bán) được thao tác trực tiếp trong màn hình danh sách. Đổi cấu hình trên danh mục hiện hành tạo bản nháp từ đúng release nguồn rồi hiển thị danh sách để tiếp tục. Không tự xuất bản sau khi chọn. Admin lưu, kiểm tra và xác nhận phát hành bằng luồng hiện hành.

## Compatibility impact

Không thêm chế độ phát hành riêng cho mỗi gói. Chế độ chung vẫn là `rollout.mode`; trạng thái bán từng kỳ vẫn là `offer.salesState`. Không đổi role, tenant/module/assignment/record scope, masking, điều kiện thanh toán hoặc quyền của thuê bao đã mua.

Giữ thứ tự tám cấu hình năm cũ, bổ sung tám cấu hình tháng. Bản nháp trắng xóa cả giá gốc tháng để không còn metadata giá của mẫu. Khi tạo bộ mẫu từ cấu hình có sẵn, ánh xạ quyền cùng kỳ được ưu tiên và hạn mức tháng đã cấu hình được bảo toàn.

Các điều khiển danh sách dùng cùng revision, digest, xác thực lại, audit và xác nhận xuất bản hiện hành. Lỗi tạo bản nháp trả lại danh sách hiện hành. Lỗi lưu giữ nội dung vừa nhập và không cho xuất bản bằng kết quả kiểm tra cũ.

## Migration và rollback

Không migration hoặc ghi đè dữ liệu hiện hữu. Seed tiếp tục dùng insert idempotent `commercial-draft-initial-v1`; khởi động lại không thay bản nháp cũ hoặc release đã phát hành. Cài đặt đang có dùng nút **Tạo bộ 20 gói mẫu** để tạo bản nháp mới. Bản nháp và bản phát hành cũ vẫn có thể mở theo luồng hiện hành.

Rollback bằng code phiên bản trước hoặc phát hành lại cấu hình đã duyệt; đơn và thuê bao giữ snapshot lịch sử.

## Regression seams

- Seed đủ 16 SKU riêng biệt, bốn ở mỗi nhóm/kỳ và bốn gói lượt; năm = tháng ×10, chu kỳ 30/365.
- Chưa chốt hạn mức tháng không được suy thành quyền mới; validator chỉ rõ các trường còn thiếu. Cấu hình lượt tường minh hoàn tất kiểm tra.
- Snapshot năm lịch sử vẫn hợp lệ; giá/quyền/đơn cũ không bị đổi theo seed.
- Tạo mẫu, nhân bản và mở bản nháp giữ ánh xạ quyền cùng kỳ, metadata và cấu hình thanh toán.
- Trình duyệt desktop đổi chế độ từ danh sách, sửa trạng thái tháng/năm độc lập và sửa gói lượt; lưu thất bại giữ nội dung, không gửi yêu cầu xuất bản.
