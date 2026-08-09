# Runbook: loại bỏ duplicate audit index ở schema v47

Migration v47 `drop_duplicate_audit_successor_index` là migration append-only;
không sửa migration v1–v46. Thay đổi chỉ loại bỏ explicit unique index
`idx_audit_log_single_successor`. Unique constraint
`audit_log_chain_id_previous_hash_key` vẫn giữ nguyên và tiếp tục bảo đảm mỗi
`(chain_id, previous_hash)` chỉ có một successor.

## Preflight và dry-run

1. Tạo và kiểm tra backup theo quy trình phục hồi hiện hành.
2. Dừng hoặc quiesce writer audit trong maintenance window ngắn.
3. Chạy preflight và dry-run bằng đúng migrator credentials:

   ```powershell
   python scripts/manage_database.py --preflight
   python scripts/manage_database.py --dry-run
   ```

4. Xác nhận catalog trước nâng cấp chỉ có đúng hai unique btree index cùng khóa:

   ```sql
   SELECT indexname, indexdef
     FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'audit_log'
      AND indexdef LIKE '%(chain_id, previous_hash)%'
    ORDER BY indexname;
   ```

   Kết quả phải gồm `audit_log_chain_id_previous_hash_key` và
   `idx_audit_log_single_successor`. Nếu definition khác nhau, dừng nâng cấp và
   điều tra catalog drift; không drop thủ công.

## Thực thi và hậu kiểm

Migration chạy trong transaction nâng cấp hiện hữu và thực hiện duy nhất:

```sql
DROP INDEX IF EXISTS idx_audit_log_single_successor;
```

Sau commit, chạy lại truy vấn catalog ở trên. Chỉ
`audit_log_chain_id_previous_hash_key` được tồn tại. Tiếp tục chạy schema
contract, FK audit và migration-chain tests. Fresh schema v47 không tạo explicit
index đã loại bỏ.

## Backward compatibility

Không có table, column, constraint hoặc dữ liệu nào bị xóa. Việc bỏ index thứ
hai không thay đổi tính duy nhất hay API; constraint-backed index vẫn phục vụ
đọc/ghi. Binary cũ có schema-version contract thấp hơn không được dùng để chạy
migration hoặc ghi vào database v47.

## Rollback

Lỗi trước commit tự rollback transaction. Nếu rollback release sau khi v47 đã
commit và operator đã xác nhận cần khôi phục đúng catalog v46, dùng maintenance
window và chạy:

```sql
CREATE UNIQUE INDEX idx_audit_log_single_successor
    ON audit_log (chain_id, previous_hash);
```

Sau đó khôi phục `database_metadata` chỉ qua quy trình rollback được phê duyệt,
chạy schema/catalog validation và ghi lại bằng chứng. Không drop hoặc đổi tên
`audit_log_chain_id_previous_hash_key`; nếu lệnh CREATE thất bại vì uniqueness,
dừng rollback và phục hồi từ backup thay vì sửa audit evidence.
