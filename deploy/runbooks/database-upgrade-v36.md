# Runbook: preflight nâng cấp qua schema v36

Migration lịch sử v36 (persist_canonical_lot_codes) chuẩn hóa mã phần lô cho
toàn bộ goi_thau_phan_lo và thong_tin_mo_thau. Migration này cố ý được giữ
nguyên để bảo toàn lịch sử: không sửa migration v36. Nó đọc toàn bộ hai bảng
vào Python, cập nhật từng hàng và tạo lại hai unique index trong cùng transaction,
vì vậy thời gian chạy, bộ nhớ tiến trình migrator và thời gian giữ lock tăng theo
cardinality.

Runbook này áp dụng khi currentVersion nhỏ hơn 36 và target từ v36 trở lên.

## 1. Chuẩn bị

1. Dùng staging clone có cardinality và kích thước gần production.
2. Xác nhận migrator credential riêng; web/runtime role không có quyền DDL.
3. Tạo backup, chạy verify và ghi lại snapshot/checksum:

   ~~~bash
   python scripts/backup.py create
   python scripts/backup.py verify --snapshot <snapshot>
   ~~~

4. Lên maintenance window và quiesce toàn bộ writer/web/document worker trước
   khi chạy thật. Không để write mới vào hai bảng trong lúc migration.
5. Ghi lại DATABASE_STATEMENT_TIMEOUT_MS và DATABASE_LOCK_TIMEOUT_MS sẽ dùng
   ở production. Giá trị phải được phê duyệt từ thời gian đo trên staging; không
   vô hiệu timeout vô hạn chỉ để ép migration chạy.

## 2. Read-only preflight

Chạy bằng đúng migrator URL:

~~~bash
python scripts/manage_database.py --preflight
~~~

Kết quả không chạy DDL và không sửa dữ liệu. Lưu lại tối thiểu:

- currentVersion và targetVersion;
- lotRows, activeLotRows, openingRows, activeOpeningRows;
- rowsLoadedIntoPython: tổng số object v36 sẽ materialize trong process;
- relationBytes: tổng kích thước PostgreSQL của hai relation;
- requiresTransactionalDryRun.

Không có một row threshold chung an toàn cho mọi máy. So sánh
rowsLoadedIntoPython, relationBytes, RAM khả dụng, timeout và thời gian dry-run
trên staging tương đương. Nếu clone nhỏ hơn production hoặc không đủ headroom,
dừng lịch nâng cấp và mở kế hoạch migration mới append-only; không chỉnh v36.

## 3. Transactional dry-run

Trên staging clone đã restore từ backup production, chạy:

~~~bash
python scripts/manage_database.py --dry-run
~~~

Lệnh này chạy đúng upgrade chain, schema contract và FK validation trong một
PostgreSQL transaction rồi luôn rollback khi thành công. Ghi duration, peak RSS,
lock wait và PostgreSQL temporary-file/I/O metrics. Chỉ lên lịch production khi
dry-run hoàn tất trong budget maintenance đã phê duyệt.

Nếu dry-run báo active-key collisions, giữ nguyên transaction rollback. Xuất
đúng các record trùng, xác minh nghiệp vụ và sửa bằng workflow archive/đổi mã có
audit trail trước khi thử lại. Không xóa hàng hoặc sửa trực tiếp lịch sử chỉ để
unique index tạo được.

## 4. Chạy production

Sau khi maintenance đã bật, writer đã quiesce và backup đã verify:

~~~bash
DATABASE_AUTO_MIGRATE=false python scripts/manage_database.py
~~~

Theo dõi lock wait, statement timeout, RSS của migrator và dung lượng database.
Không chạy đồng thời hai migrator. Advisory transaction lock của ứng dụng là lớp
bảo vệ bổ sung, không thay thế maintenance window.

Sau commit:

~~~bash
python scripts/manage_database.py --preflight
python scripts/audit_fk_indexes.py
~~~

Xác nhận currentVersion bằng target, upgradeRequired=false, ứng dụng
/health/ready pass, rồi mới mở writer/traffic và chạy smoke read/write.

## 5. Failure và rollback

- Lỗi trước commit: migration transaction tự rollback. Giữ maintenance, lưu log
  đã redacted, xử lý nguyên nhân và chạy lại dry-run.
- Lỗi sau commit hoặc dữ liệu không tương thích: cô lập write, tạo forensic
  snapshot, restore backup đã verify sang database mới/cách ly, smoke test rồi
  chuyển traffic. Không hạ tay database_metadata.schema_version, không chạy
  DDL ngược ad-hoc và không sửa migration v36.
