# Database upgrade v48: account lifecycle status

V48 `add_account_status` là migration append-only; không sửa v36 hoặc migration
lịch sử nào. Migration thêm `tai_khoan.trang_thai` với default `active`, thêm và
validate check constraint chỉ cho `active|inactive`, sau đó refresh canonical
triggers để inactive personal workspace và suspended organization không nhận
write mới.

## Trước khi chạy

1. Backup và kiểm tra restore theo runbook database hiện hành.
2. Chạy dry-run/preflight của migration chain trên bản sao staging tương đương.
3. Xác nhận application version mới được deploy đồng bộ với schema v48; binary
   cũ không hiểu lifecycle inactive.
4. Ghi lại số account và active session trước maintenance window.

Constant default trên PostgreSQL 17 không cần data backfill riêng. Constraint
được thêm `NOT VALID` rồi validate trong transaction migration.

## Xác nhận sau migration

- `database_metadata.schema_version = 48`;
- mọi `tai_khoan.trang_thai = 'active'` ngay sau nâng cấp;
- constraint `tai_khoan_trang_thai_check` đã validated;
- fresh/upgrade catalog khớp `postgres_schema_contract.json`;
- login, session revocation, deactivation và organization suspension tests pass.

## Rollback

Không drop column/constraint sau khi application đã ghi trạng thái `inactive`,
vì binary cũ có thể cho tài khoản đã khóa đăng nhập lại. Khi sự cố xảy ra, giữ
schema v48, rollback application chỉ tới bản đã hiểu `trang_thai`, hoặc sửa bằng
roll-forward có audit. Khôi phục backup chỉ khi toàn release được rollback trong
change window và đã đối soát dữ liệu phát sinh.
