# ADR 0001: Ngừng hoạt động thay cho xóa tài khoản và tổ chức

- Status: Accepted
- Date: 2026-08-10

## Context

Tài khoản và tổ chức là chủ thể của membership, phân công, dữ liệu nghiệp vụ,
tombstone và audit evidence. Xóa vật lý khi chưa có retention/legal-hold policy
có thể làm mất lịch sử hoặc để lại dữ liệu mồ côi. Sản phẩm cần một lifecycle
vận hành ngay nhưng chưa phê duyệt erasure/anonymization workflow.

## Decision

- Lifecycle hiện tại dùng trạng thái **Ngừng hoạt động** và bảo toàn lịch sử.
- Tài khoản inactive bị khóa mọi phương thức đăng nhập, session cũ và write mới;
  tài khoản không xuất hiện trong danh sách active.
- Tổ chức suspended bị ẩn khỏi workspace list thường và không thể nhận write;
  Super Admin vẫn có thể quản lý để mở khóa.
- Endpoint `DELETE` tài khoản được giữ để tương thích client nhưng chỉ thực hiện
  deactivation idempotent; không chứa root delete.
- Xóa vật lý, purge và anonymization tiếp tục không được hỗ trợ cho tới khi có
  quyết định authoritative về retention, legal hold và erasure.
- Migration lịch sử, gồm v36, là bất biến; account status được thêm bằng
  migration append-only mới.

## Consequences

Lịch sử và quan hệ tham chiếu được giữ nguyên, stale session/write bị chặn và
thao tác vận hành có thể đảo ngược. Dung lượng retained data không giảm; một
reactivation workflow và một erasure workflow hợp lệ có thể được thiết kế riêng
sau này mà không thay đổi ý nghĩa của deactivation.
