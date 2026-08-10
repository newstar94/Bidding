# Runbook: ngừng hoạt động tài khoản và retention

Luồng được hỗ trợ cho BF-P2-30 là **Ngừng hoạt động**, không phải xóa vật lý.
Endpoint tương thích `DELETE /api/auth/users/{user_id}` chỉ chuyển
`tai_khoan.trang_thai` từ `active` sang `inactive`, thu hồi session và phát sự
kiện ngắt kết nối. Tài khoản inactive bị chặn đăng nhập, không được trả về trong
danh sách tài khoản đang hoạt động và không thể ghi mới vào workspace.

Mọi dữ liệu lịch sử được giữ nguyên, gồm membership, phân công, quyền, audit,
workspace cá nhân, tombstone và `record_snapshot_json`. Thao tác lặp lại là
idempotent và trả `changed: false`; ứng dụng không tự purge hoặc anonymize.

## Quy trình vận hành

1. Xác nhận mục tiêu không phải tài khoản đang dùng để thực hiện thao tác.
2. Xác nhận tài khoản không phải Super Admin cuối cùng hoặc Quản lý đang hoạt
   động cuối cùng của bất kỳ tổ chức nào.
3. Gọi endpoint qua giao diện “Ngừng hoạt động tài khoản”. Thành công trả mã
   `ACCOUNT_DEACTIVATED`.
4. Kiểm tra audit event `admin.user_deactivated`, trạng thái `inactive` và mọi
   `auth_sessions` của tài khoản đã có `revoked_at`.
5. Không chạy SQL xóa hoặc cleanup dữ liệu liên quan. Tài khoản inactive được ẩn
   khỏi danh sách thường theo đúng lifecycle sản phẩm.

Transaction dùng cùng advisory lock với sync/restore/bootstrap workspace cá
nhân. Vì vậy một write đã chờ lock phải reauthorize sau deactivation và không
được tiếp tục ghi.

## Xóa vật lý chưa được hỗ trợ

Xóa vật lý, erasure và anonymization vẫn cần product owner, privacy/legal owner
và security owner phê duyệt bằng văn bản về thời hạn retention, lawful basis,
legal hold, export/erasure ordering, trường được anonymize và exception owner.

Cho đến khi có workflow riêng được phê duyệt:

- không tự purge account, tombstone, audit evidence hoặc artifact;
- không thêm `ON DELETE CASCADE` để làm cho thao tác xóa thành công;
- không sửa hoặc xóa `record_snapshot_json`;
- không dùng console/SQL ad-hoc để vượt qua lifecycle “Ngừng hoạt động”.

## Rollback và khôi phục

Deactivation bảo toàn dữ liệu nên có thể khôi phục bằng một workflow
reactivation có kiểm soát trong tương lai. Hiện chưa có reactivation surface
cho người dùng cuối; nếu cần khôi phục khẩn cấp, phải có change ticket và audit
riêng. Không rollback binary về hành vi xóa vật lý cũ.
