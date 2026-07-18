# Manifest schema PostgreSQL

Tài liệu này mô tả baseline PostgreSQL dành cho kịch bản cài mới hoàn toàn. Nguồn chuẩn vẫn là `backend/db/schema.py` cùng bốn bảng cuối của migration SQLite; `compile_postgresql_baseline()` tạo DDL và checksum riêng cho PostgreSQL.

## Phạm vi đối chiếu tự động

- 44/44 bảng nghiệp vụ và 100% tên cột được đưa vào manifest máy đọc được.
- Primary key, unique/check constraint và foreign key được biên dịch từ cùng schema nguồn; foreign key PostgreSQL có tên ổn định, tối đa 63 ký tự.
- 115/115 index đặt tên của SQLite tồn tại ở PostgreSQL. PostgreSQL có thêm 5 GIN expression index cho tìm kiếm tiếng Việt và 1 index hết hạn cho lease document-worker dùng chung.
- 56/56 trigger SQLite được ánh xạ sang 31 trigger PostgreSQL hoặc expression index tương đương. Test khởi tạo một SQLite sạch và từ chối schema PostgreSQL nếu thiếu bất kỳ source artifact nào.
- Baseline PostgreSQL đã chạy thật trên PostgreSQL 17.10, gồm bootstrap lần đầu, chạy lại idempotent và startup/readiness.

## Ánh xạ kiểu

| Dữ liệu nghiệp vụ | PostgreSQL | Ghi chú |
|---|---|---|
| ID, mã và text | `TEXT` | Giữ nguyên API contract |
| Tiền VND | `BIGINT` | Không dùng floating point |
| Tỷ lệ, số lượng và điểm | `NUMERIC(20,4)` | Chính xác bốn chữ số thập phân |
| Cờ 0/1 | `BOOLEAN` | Adapter giữ payload 0/1 tương thích SQLite |
| Ngày nghiệp vụ | `DATE` | Adapter trả chuỗi `YYYY-MM-DD` |
| `created_at`, `updated_at`, `archived_at`, `deleted_at` | `TIMESTAMPTZ` | Connection dùng UTC; adapter trả contract UTC đến giây |
| Epoch hết hạn/session/rate-limit/subscription | `BIGINT` | Giữ contract 64-bit của SQLite, không gặp giới hạn năm 2038 |
| JSON payload hiện tại | `TEXT` | Chưa có truy vấn theo thuộc tính JSON, nên chưa đổi hàng loạt sang `JSONB` |

## Trigger và invariant

- Hai trigger lineage `fill/immutable` của mỗi bảng version được hợp nhất thành một `BEFORE` trigger.
- Delta sync dùng `UPDATE ... RETURNING` trên `sync_metadata`, nhờ row lock của PostgreSQL để cấp version nguyên tử; delete tạo/upsert tombstone bằng `GREATEST`.
- Trigger kiểm tra tenant cho phân công, người chấm, liên kết hợp đồng–gói thầu và đổi email đã xác minh được giữ nguyên semantics.
- Audit head dùng transaction advisory lock trước khi đọc head, bao phủ cả trường hợp bảng rỗng và ngăn chain phân nhánh giữa nhiều writer.
- FTS5 cùng 15 trigger duy trì bảng ảo được thay bằng 5 GIN `pg_trgm` index trên biểu thức lowercase + immutable `unaccent`; route tìm kiếm dùng đúng cùng biểu thức.
- Corpus [`vietnamese_search_corpus.json`](../tests/fixtures/vietnamese_search_corpus.json) khóa contract tìm kiếm phiên bản 1: có dấu/không dấu, `đ/d`, nhiều token AND, prefix theo ranh giới từ và chống false-positive substring; 12/12 ca trả cùng ID trên SQLite FTS5 và PostgreSQL thật.

## Bằng chứng test

Các test chính: `test_postgresql_schema.py`, `test_postgresql_migrations.py`, `test_postgresql_integration.py` và toàn bộ `tests/api` chạy dưới cả SQLite lẫn PostgreSQL. CI có job `PostgreSQL API and integration contracts` dùng service PostgreSQL 17.
