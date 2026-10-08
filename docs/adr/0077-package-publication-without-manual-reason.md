# ADR 0077 — Xuất bản gói dịch vụ không yêu cầu nhập lý do

- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm ngày 2026-10-08.
- Phạm vi: hộp xác nhận xuất bản bản nháp gói dịch vụ trong Admin.

## Business contract

Admin xem tóm tắt các gói và xác nhận **Xuất bản** mà không nhập lý do. Khi
xác nhận, giao diện gửi nội dung tự động `Xuất bản gói dịch vụ` để ghi vào
bản phát hành và nhật ký quản trị. Bấm **Hủy** hoặc Escape không xuất bản.

Các điều kiện kiểm tra bản nháp, revision, digest, thời điểm hiệu lực,
phiên Super Admin, tái xác thực, CSRF, idempotency và audit nguyên tử tiếp
tục áp dụng. Quyền lợi và điều kiện của các gói đã mua được bảo toàn.

## Compatibility impact

API vẫn nhận trường `reason` hợp lệ theo hợp đồng hiện có. Chỉ bỏ ô nhập
và hướng dẫn nhập lý do trong hộp xác nhận xuất bản; lý do dừng bán và các
thao tác quản trị khác tiếp tục theo quy trình hiện hành.

## Migration strategy

Không cần migration dữ liệu hoặc thay đổi backend. Triển khai frontend
mới với backend hiện có; các lý do lịch sử được giữ nguyên. Rollback frontend
khôi phục ô nhập mà không ảnh hưởng bản phát hành hoặc nhật ký đã ghi.

## Regression seams

- Hộp xác nhận không có ô nhập và giữ tóm tắt các gói.
- Hủy hoặc Escape không gửi yêu cầu xuất bản.
- Xác nhận gửi đúng revision/digest cùng nội dung nhật ký tự động hợp lệ.
- Các điều kiện vô hiệu hóa xuất bản khi bản nháp chưa đủ điều kiện tiếp tục áp dụng.
