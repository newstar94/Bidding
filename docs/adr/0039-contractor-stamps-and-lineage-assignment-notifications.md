# ADR 0039 — Ảnh dấu Nhà thầu và thông báo phân công theo dòng phiên bản

- Trạng thái: Chấp nhận theo xác nhận chủ sản phẩm ngày 2026-09-06.

## Quyết định

Chuyên viên được tải ảnh dấu khi tạo Nhà thầu mới và tải/thay/xóa ảnh dấu khi
có quyền sửa Nhà thầu hiện hữu. Không cấp đặc quyền theo người tạo. Nhà thầu
vẫn dùng chung; quyền phân hệ, tenant, session, version, row-version và audit
không thay đổi. Không mở quyền ảnh chữ ký/chứng chỉ chuyên gia, biểu mẫu Word
hay toàn bộ workspace assets. Upload mới vẫn đi qua kiểm tra ảnh hiện hữu;
không cho phép gán đường dẫn file tùy ý hoặc lấy ảnh từ tổ chức khác.

Thông báo phân công được so sánh trên bộ (loại, gốc dòng, người được phân công)
trước/sau transaction. Nhiều snapshot trong cùng lần lưu chỉ tạo một thông báo
thêm/gỡ cho mỗi bộ; thêm snapshot cho người đã được phân công không báo lại.
Gỡ hết rồi phân công lại trong lần thay đổi sau vẫn gửi thông báo mới.
Liên kết ưu tiên snapshot mới nhất trong tập phân công. Assignment và activity
audit của từng snapshot được bảo toàn, chỉ projection thông báo được gộp.

## Compatibility impact và migration

Ảnh dấu không còn bị chặn chỉ vì vai trò Chuyên viên, nhưng vẫn cần quyền
ghi bản ghi. Thông báo mới không bị nhân lên theo số phiên bản. Không có schema
migration; không xóa thông báo/email cũ, không backfill hoặc sửa phân công cũ.
Cần nạp backend và frontend mới khi triển khai. Rollback code khôi phục chính
sách upload cũ và cách phát thông báo cũ, không thay dữ liệu đã lưu.

## Kiểm thử

- `test_workspace_asset_permissions.py`: upload mới/thay ảnh và quyền tạo/sửa,
  bảo toàn chặn file tổ chức khác và ảnh chuyên gia.
- `contractor_stamp_policy.test.mjs`: UI theo quyền tạo/sửa, chế độ chỉ đọc,
  thu hồi quyền; không mở quyền workspace assets.
- `test_multi_assignee_activity.py`: cùng transaction nhiều snapshot chỉ báo
  một lần, kế thừa không báo lại, gỡ một snapshot không báo mất phân công.
