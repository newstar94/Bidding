# Runbook: nâng cấp schema v45 cho retention cleanup

Migration v45 (`add_retention_cleanup_indexes`) thêm ba index phục vụ các đợt
cleanup toàn cục theo cutoff:

- `idx_deleted_records_retention_cutoff` trên
  `(deleted_at, organization_id, delete_version)`;
- `idx_sync_mutations_retention_cutoff` trên `(created_at)`;
- partial index `idx_partner_enrichment_terminal_cleanup` trên `(updated_at)`
  chỉ cho trạng thái `completed`/`failed`.

Đây là DDL append-only, không đổi dữ liệu và backward compatible ở mức SQL/data
với binary cũ. Tuy nhiên schema-version guard của BiddingFlow không cho binary
v44 khởi động trên database v45; rollback binary phải là bản tương thích v45,
không được hạ tay `database_metadata.schema_version`.

## 1. Preflight và backup

1. Restore một staging clone có cardinality gần production.
2. Dùng đúng migrator credential và chạy read-only preflight:

   ~~~bash
   python scripts/manage_database.py --preflight
   ~~~

3. Lưu các trường `deletedRecordsRows`, `syncMutationsRows`,
   `terminalPartnerJobRows`, `relationBytes` và
   `requiresTransactionalDryRun` trong change record.
4. Tạo và verify backup trước maintenance window:

   ~~~bash
   python scripts/backup.py create
   python scripts/backup.py verify --snapshot <snapshot>
   ~~~

5. Đo lock/DDL duration trên staging. V45 dùng `CREATE INDEX` trong cùng
   transaction của upgrade để rollback nguyên tử; nó không dùng
   `CREATE INDEX CONCURRENTLY`, vì lệnh đó không được phép trong transaction.
   Quiesce writer trong maintenance window đã được duyệt.

## 2. Transactional dry-run và EXPLAIN

Chạy đúng upgrade chain rồi rollback tự động:

~~~bash
python scripts/manage_database.py --dry-run
~~~

Ghi duration, lock wait, WAL/temp I/O và dung lượng index. Trong cùng staging
clone, chạy `EXPLAIN (FORMAT JSON)` cho ba candidate query với cutoff và
`LIMIT 500 FOR UPDATE SKIP LOCKED`. Kế hoạch phải dùng đúng ba index nêu trên;
không phê duyệt production chỉ dựa trên việc DDL tạo thành công.

## 3. Triển khai

Sau khi backup đã verify và writer đã dừng:

~~~bash
DATABASE_AUTO_MIGRATE=false python scripts/manage_database.py
python scripts/manage_database.py --preflight
python scripts/audit_fk_indexes.py
~~~

Xác nhận schema v45, normalized catalog, FK audit và `/health/ready`. Sau đó mở
traffic và theo dõi query duration, lock wait, WAL cùng số row cleanup mỗi đợt.

Cleanup commit theo batch. Giá trị mặc định:

~~~text
RETENTION_CLEANUP_BATCH_SIZE=1000
~~~

Chỉ điều chỉnh trong khoảng ứng dụng cho phép (1–10000), dựa trên staging và
telemetry. Batch nhỏ giảm lock/WAL mỗi transaction nhưng tăng số transaction;
không tăng mù để rút ngắn sweep.

## 4. Failure và rollback

- Lỗi trước commit: PostgreSQL rollback toàn bộ migration; giữ maintenance và
  xử lý nguyên nhân trước khi chạy lại `--dry-run`.
- Lỗi sau commit nhưng chưa mở traffic: ưu tiên forward migration append-only
  v46 cập nhật schema contract rồi `DROP INDEX` ba index dưới đây.
- Emergency rollback chỉ được thực hiện sau khi deploy binary tương thích v45
  có catalog đã phê duyệt không yêu cầu các index, trong maintenance window:

  ~~~sql
  DROP INDEX IF EXISTS idx_deleted_records_retention_cutoff;
  DROP INDEX IF EXISTS idx_sync_mutations_retention_cutoff;
  DROP INDEX IF EXISTS idx_partner_enrichment_terminal_cleanup;
  ~~~

Ba lệnh không xóa row, nhưng bỏ chúng khi binary hiện tại vẫn yêu cầu normalized
catalog sẽ làm readiness fail. Không hạ schema version, không sửa migration v45,
không xóa các owner-leading index cũ và không purge audit history.
