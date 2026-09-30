# Phiếu tham chiếu pháp lý và vận hành

File này từng là danh sách 27 thông tin pháp lý (`LEGAL-01` đến `LEGAL-27`)
dùng làm điều kiện chặn khi tạo artifact production. Theo quyết định của chủ
sản phẩm ngày 29/09/2026, danh sách đó đã được **ngừng sử dụng làm release
blocker**. Dải mã lịch sử được ghi lại ở đây để truy vết quyết định;
không cần điền trạng thái `approved` để chạy CI hoặc tạo artifact.

Việc bỏ blocker kỹ thuật này không phải là xác nhận tuân thủ pháp luật, không
thay thế việc đánh giá pháp lý của đơn vị vận hành và không làm thay đổi các
nghĩa vụ bảo mật, quyền riêng tư, lưu trữ, thông báo sự cố hoặc kiểm soát truy
cập áp dụng cho môi trường production.

## Hợp đồng của các trang legal tối giản

Ba trang công khai tại `views/legal/terms.html`, `views/legal/privacy.html` và
`views/legal/security.html` phải:

1. tồn tại trong source và trong production artifact, với nội dung công khai
   không rỗng;
2. có nội dung tối giản, trung thực với hành vi hiện tại của ứng dụng;
3. không còn placeholder công khai dạng `[TODO: ...]` hoặc phần tử
   `legal-placeholder` trong phần người dùng nhìn thấy;
4. không đưa secret, credential, token hoặc dữ liệu cá nhân không cần thiết vào
   repository.

`npm run check:legal` và `npm run check:legal:production` chỉ kiểm tra hợp đồng
kỹ thuật của các trang trên (tồn tại, có nội dung nhìn thấy và không còn
placeholder công khai).
Hai lệnh này không kết luận rằng nội dung đã được luật sư duyệt hoặc
đơn vị vận hành đã đáp ứng mọi yêu cầu pháp lý.

Các kiểm tra bảo mật triển khai, secret, TLS, tenant isolation, phân quyền,
backup/restore, monitoring, database migration và rollback vẫn là gate độc lập
và không được bỏ qua vì quyết định retire 27 mục.

## Danh sách lịch sử đã retire

Các mã sau đây chỉ còn là tham chiếu lịch sử, không có trạng thái phê duyệt bắt
buộc cho release:

`LEGAL-01`–`LEGAL-27` (privacy, security và terms).

Không dùng việc đổi trạng thái trong danh sách lịch sử để suy ra legal readiness.
Nếu đơn vị vận hành cần hồ sơ pháp lý riêng, hồ sơ đó phải được quản lý ngoài
release gate và có owner/phê duyệt theo quy trình của đơn vị.

## Ghi nhận thay đổi

- Quyết định: bỏ blocker 27 mục, giữ trang legal tối giản.
- Phạm vi: release checker, CI và hướng dẫn đóng gói; không thay đổi role,
  permission, tenant/assignment scope hoặc dữ liệu mà người dùng được phép xem.
- ADR: xem `docs/adr/0047-retire-27-fact-production-legal-blocker.md`.
