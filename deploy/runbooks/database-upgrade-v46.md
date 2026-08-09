# Runbook: replay migration chain và reconcile schema v46

BF-P2-29 đóng khoảng trống kiểm thử upgrade lịch sử. V46 là migration
append-only `reconcile_historical_chain`; không sửa migration v1–v45. Nó chỉ
reconcile khi normalized catalog còn drift: tạo bảng thiếu, chuẩn hóa type/default
column, dựng lại constraint/index canonical và fail closed nếu catalog chưa khớp.

## 1. Fixture và preflight

Fixture baseline phải được sinh từ PostgreSQL schema commit `1fe7dd42`:
`tests/fixtures/postgres_schema_v1.json`, SHA-256 nguồn được test khóa. Không tự
viết lại fixture để né một migration thất bại. Fixture gồm đủ table, FK, 133
index statements và 68 function/trigger statements của installation v1; CI
đối chiếu cả `schema.py` và `postgres_schema.py` với commit nguồn.

Thân các migration đã phát hành v1–v45 vẫn bất biến. Runner chỉ cung cấp các
prerequisite theo version mà chain cũ từng giả định đã có (`email_delivery_status`,
`document_jobs`, `partner_enrichment_jobs`), phục hồi transient
`bao_cao_danh_gia_nha_thau.nguoi_cham_id` đúng riêng v17 và bỏ qua bằng savepoint
những latest index/trigger chưa thể tạo trên partial schema. V46 sau cùng phải
reconcile exact catalog hoặc rollback toàn bộ; không được coi việc skip trung gian
là thành công cuối.

Trên staging PostgreSQL 17 có dữ liệu đại diện, chạy:

~~~bash
python scripts/generate_postgres_migration_fixture.py --check
python scripts/manage_database.py --preflight
~~~

Output phải có `v46HistoricalChain` với `requiresCatalogReconciliation=true` khi
database < v46. Lưu catalog drift, row counts, lock wait và conversion errors.

## 2. Chain rehearsal

Khởi tạo một database clone rỗng, chạy toàn bộ v1 → latest với fixture; sau đó
chạy lại từ checkpoint v35 → latest trong một database khác. Hai rehearsal phải
đạt tất cả điều kiện:

- schema version 46 và baseline/installation metadata không bị mất;
- normalized catalog exact, gồm table/column/type/default/CHECK/UNIQUE/PK/FK,
  index và trigger;
- toàn bộ foreign key (FK) validated, index valid/ready/live;
- dữ liệu đại diện sống sót và backfill đúng: session dedupe, contract status,
  technical weight, lot-code normalized, document-export defaults;
- không có tenant ID hoặc raw business data trong preflight log.

Chạy transaction dry-run trên database nâng cấp thực tế:

~~~bash
python scripts/manage_database.py --dry-run
~~~

Dry-run phải rollback và vẫn chạy catalog/FK assertion. CI bắt buộc thực hiện
rehearsal thật bằng PostgreSQL 17; fake cursor chỉ dùng cho các nhánh lỗi nhỏ.

## 3. Production rollout

1. Tạo và verify backup; quiesce writer/document worker trong maintenance window.
2. Chạy dry-run trên clone có cardinality tương đương và lưu thời gian/lock/WAL.
3. Chạy migrator với `DATABASE_AUTO_MIGRATE=false`, rồi kiểm tra `/health/ready`,
   schema contract và FK audit trước khi mở traffic.
4. Theo dõi constraint validation, index build và query error sau rollout.

## 4. Failure và rollback

- Lỗi trước commit tự rollback toàn bộ v46; không sửa `database_metadata` bằng tay.
- Nếu catalog/data incompatibility xuất hiện sau commit, giữ traffic ở chế độ
  quiesced, tạo forensic backup và ưu tiên forward migration append-only đã được
  review để sửa/revert object.
- Rollback binary phải nhận biết schema v46; không chạy binary v45 trên DB v46 và
  không drop table/column hay sửa nội dung migration v1–v45.
- Restore backup sang database mới, chạy lại chain + catalog/FK rehearsal, rồi mới
  chuyển traffic; mọi thay đổi constraint/index phải có migration và rollback
  plan riêng.
