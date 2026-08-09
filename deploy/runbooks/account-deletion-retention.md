# Runbook: xóa tài khoản và retention dữ liệu cá nhân

BF-P2-30 đang **fail closed**. Endpoint xóa tài khoản trả HTTP `409` với mã
`ACCOUNT_DELETION_RETENTION_REVIEW_REQUIRED` nếu không gian
`personal:<user_id>` còn tombstone trong `deleted_records`. Response chỉ công
bố số lượng `personalTombstones`; không trả `record_snapshot_json` hoặc dữ liệu
nghiệp vụ đã xóa.

Ứng dụng không tự purge, anonymize hoặc sửa audit evidence khi xóa tài khoản.
Sync, restore, bootstrap metadata và account deletion dùng cùng transaction
advisory lock cho workspace cá nhân để không tạo dữ liệu mới sau bước kiểm tra
xóa. Quy tắc này là biện pháp kỹ thuật phòng xóa/lộ ngoài ý muốn, không phải là
quyết định pháp lý về quyền xóa dữ liệu.

## Quyết định bắt buộc trước khi mở luồng xử lý blocker

Product owner, privacy/legal owner và security owner phải phê duyệt bằng văn
bản tối thiểu các nội dung sau:

1. Thời hạn retention theo từng loại evidence/tombstone và căn cứ xử lý dữ liệu.
2. Điều kiện legal hold, người có quyền đặt/gỡ hold và audit trail tương ứng.
3. Trường nào được anonymize, tiêu chuẩn không thể tái định danh và cách xử lý
   quan hệ với hồ sơ tổ chức còn hiệu lực.
4. Thứ tự export, erasure/anonymization và account deletion; định dạng, người
   nhận và thời hạn tải bản export.
5. Trách nhiệm phê duyệt ngoại lệ, SLA xử lý yêu cầu và bằng chứng hoàn tất.

Không thay `409` bằng purge tự động, không thêm `ON DELETE CASCADE` vào
`deleted_records`, và không xóa `record_snapshot_json` chỉ để cho account
deletion thành công khi các quyết định trên chưa có nguồn authoritative.

## Quy trình vận hành hiện tại

1. Gọi xóa tài khoản và ghi lại request ID, HTTP status, error code cùng aggregate
   blocker count; không chép snapshot vào ticket/log.
2. Nếu nhận `PERSONAL_WORKSPACE_NOT_EMPTY`, yêu cầu chủ tài khoản xử lý dữ liệu
   nghiệp vụ đang hoạt động theo luồng sản phẩm hiện có.
3. Nếu nhận `ACCOUNT_DELETION_RETENTION_REVIEW_REQUIRED`, dừng thao tác. Chuyển
   yêu cầu tới privacy/legal owner; không chạy SQL ad-hoc.
4. Nếu cần điều tra, dùng truy vấn chỉ đếm theo `organization_id`; quyền đọc raw
   snapshot phải theo quy trình restricted-data riêng.
5. Chỉ retry xóa sau khi blocker được xử lý bởi workflow đã phê duyệt và audit,
   rồi xác nhận tài khoản, session và personal workspace không còn residue ngoài
   retention policy.

## Rollback và sự cố

Thay đổi hiện tại không có migration và không xóa tombstone. Rollback binary có
thể khôi phục hành vi cũ nhưng sẽ mở lại nguy cơ bỏ sót snapshot, vì vậy chỉ thực
hiện trong change window đã được privacy/security owner phê duyệt. Nếu phát hiện
tài khoản đã bị xóa nhưng còn dữ liệu `personal:<user_id>`, cô lập write traffic
liên quan, giữ nguyên evidence, tạo incident và không tự động purge/anonymize.
