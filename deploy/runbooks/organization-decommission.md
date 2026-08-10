# Runbook: ngừng hoạt động tổ chức

Luồng được hỗ trợ là khóa/ngừng hoạt động có thể đảo ngược. Super Admin dùng
action `lock` để chuyển `to_chuc.trang_thai` và subscription sang `suspended`.
Tổ chức suspended bị ẩn khỏi danh sách workspace thường, không thể được chọn làm
`X-Active-Org` và không nhận write hoặc thành viên mới. Dữ liệu, membership,
audit và artifact vẫn được giữ nguyên; Super Admin vẫn quản lý được trạng thái
để dùng action `unlock` khi đủ điều kiện gói dịch vụ.

## Quy trình vận hành

1. Gọi cập nhật subscription với action `lock` và `Idempotency-Key` hợp lệ.
2. Xác nhận cả organization và subscription có trạng thái `suspended`.
3. Xác nhận audit `organization.subscription_lock` và sự kiện thu hồi kết nối
   đã được enqueue cho thành viên.
4. Xác nhận người dùng thường không thấy tổ chức trong workspace list và request
   chỉ định tổ chức bị từ chối.
5. Không xóa bất kỳ owner row nào.

## Xóa vật lý tiếp tục bị chặn

Organization decommission theo nghĩa xóa vật lý không phải feature đang được hỗ trợ.
Backend không có `DELETE FROM to_chuc`; không xóa bằng console,
migration ad-hoc hoặc fixture production. Không thêm cascade FK hàng loạt.

`backend.shared.organization_decommission` giữ ownership dry-run count-only và
postcondition fail-closed cho một workflow xóa vật lý tương lai. Registry sinh
từ canonical schema, bao phủ 62 bảng `organization_id`, gồm 39 bảng có
`owner_type`. Các primitive này không cấp quyền và không thay thế lifecycle
khóa/ngừng hoạt động hiện tại.

Mọi feature xóa vật lý tương lai vẫn phải có retention/legal và legal-hold
policy, export/erasure order, writer quiescence, transaction hoặc resumable state
machine, artifact cleanup, recovery test PostgreSQL và postcondition rõ ràng.

## Sự cố

Nếu phát hiện root tổ chức bị xóa nhưng còn owner rows, dừng cleanup, cô lập
writer, giữ forensic backup và mở incident. Dùng ownership dry-run để xác định
phạm vi; không sửa bằng cascade hoặc SQL xóa hàng loạt.
