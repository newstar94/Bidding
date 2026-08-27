# ADR 0020 — Lịch sử mua cá nhân trong thông tin tài khoản

- Status: Accepted
- Date: 2026-08-27

## Quyết định

Loại bỏ mục “Gói dịch vụ & thanh toán” khỏi thanh điều hướng của người dùng và
hiển thị “Lịch sử mua cá nhân” trong trang “Thông tin tài khoản”. Danh sách dùng
endpoint `/api/billing/orders` hiện có và luôn được giới hạn bằng đồng thời hai
điều kiện `owner_kind = 'account'` và `account_user_id = actor.user_id`.

Người dùng được xem lịch sử mua của chính tài khoản mình ngay cả khi đang làm
việc dưới vai trò gắn với một tổ chức. Ngữ cảnh tổ chức không được dùng để đổi
chủ sở hữu của truy vấn và endpoint này không trả về đơn hàng của tổ chức.

## Ảnh hưởng tương thích

- URL storefront cũ, luồng checkout và API billing vẫn được giữ để tương thích
  với liên kết đã phát hành và đơn hàng đang xử lý. Callback thanh toán đưa
  người dùng về lịch sử mua trong trang thông tin tài khoản.
- Không thay đổi role, module permission, tenant isolation, assignment scope,
  record scope, entitlement hoặc dữ liệu của bản ghi nghiệp vụ.
- Không cấp quyền đọc lịch sử thanh toán của tổ chức. Chi tiết và thao tác trên
  đơn hàng tiếp tục tuân theo các kiểm tra hiện có.

## Chuyển đổi và quay lui

Không cần migration dữ liệu hoặc schema. Khi triển khai, frontend mới sẽ tải tối
đa 100 giao dịch cá nhân gần nhất từ API hiện có. Có thể quay lui bằng cách khôi
phục mục điều hướng và bỏ card lịch sử; không có dữ liệu nào bị biến đổi.

## Kiểm thử hồi quy

- Thanh điều hướng người dùng không còn mục storefront.
- Trang thông tin tài khoản tải và Việt hóa lịch sử mua cá nhân.
- Truy vấn backend giữ nguyên bộ lọc chủ sở hữu tài khoản và mã người dùng, kể
  cả khi phiên đang mang ngữ cảnh tổ chức.
- Không có truy vấn hoặc quyền mới cho lịch sử thanh toán của tổ chức.
