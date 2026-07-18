# Kế hoạch chuyển BiddingFlow sang PostgreSQL và chuẩn bị phát hành production

> Ngày lập: 19/07/2026  
> Phạm vi rà soát: mã nguồn hiện có trong `D:\Bidding`  
> Mục tiêu ưu tiên: hiệu năng, khả năng chịu tải, tính đúng đắn dữ liệu và khả năng vận hành sản phẩm thương mại  
> Trạng thái: kế hoạch triển khai; tài liệu này chưa thực hiện chuyển đổi mã nguồn

## 1. Mục tiêu và ràng buộc không được vi phạm

### 1.1. Mục tiêu chính

1. Thay SQLite bằng PostgreSQL làm hệ cơ sở dữ liệu duy nhất của runtime production.
2. Gỡ giới hạn một tiến trình ghi hiện tại để có thể chạy nhiều worker và nhiều instance ứng dụng.
3. Giữ nguyên hành vi nghiệp vụ, quyền truy cập, đồng bộ dữ liệu, audit, đăng nhập, xuất tài liệu và websocket.
4. Tối ưu đường đọc/ghi có tải lớn, loại bỏ điểm nghẽn ghi tuần tự và chuẩn bị cho việc mở rộng ngang.
5. Có backup, phục hồi, quan sát, cảnh báo, bảo mật và quy trình phát hành đủ tin cậy để bán sản phẩm.

### 1.2. Ràng buộc tuyệt đối về giao diện

Trong toàn bộ dự án chuyển đổi:

- **Không sửa bất kỳ dòng nào** trong `frontend/**`, `views/**`, các tệp HTML, CSS hoặc mã JavaScript phục vụ hiển thị.
- Không đổi màu sắc, kích thước, khoảng cách, font, biểu tượng, nội dung chữ, cấu trúc DOM hoặc hành vi tương tác.
- Không đổi tên trường JSON, kiểu biểu diễn JSON, mã lỗi, HTTP status, thứ tự mặc định, quy tắc phân trang, định dạng ngày giờ hoặc payload websocket mà frontend đang sử dụng.
- Nếu PostgreSQL trả kiểu dữ liệu khác SQLite, backend phải chuyển đổi về đúng hợp đồng cũ trước khi trả cho frontend.
- Ảnh chụp giao diện trước và sau chuyển đổi phải giống nhau trong ngưỡng pixel đã quy định tại mục 12.

Các đường dẫn bị cấm thay đổi trong nhánh chuyển đổi PostgreSQL:

```text
frontend/**
views/**
**/*.css
vite.config.js
```

Ngoại lệ chỉ được phép khi có một yêu cầu UI riêng, được phê duyệt tách biệt và không nằm trong đợt chuyển cơ sở dữ liệu này.

### 1.3. Quyết định về dữ liệu

- Production PostgreSQL sẽ được **fresh install từ database rỗng**.
- Không chuyển, nhập, làm sạch, đối soát hoặc bảo toàn dữ liệu SQLite cũ.
- Không xây công cụ SQLite → PostgreSQL và không dual-write hai hệ cơ sở dữ liệu.
- SQLite chỉ được dùng tạm trong môi trường kiểm thử để ghi lại hành vi API/giao diện hiện tại bằng dữ liệu fixture mới tạo; SQLite không nằm trong runtime hoặc gói phát hành production cuối cùng.

## 2. Tóm tắt kết quả rà soát hiện trạng

### 2.1. Quy mô mô hình dữ liệu

Phân tích `backend/db/schema.py` cho thấy:

| Hạng mục | Hiện trạng |
|---|---:|
| Bảng dữ liệu | 47 |
| Cột | 627 |
| Khóa ngoại được khai báo | 78 |
| Ràng buộc duy nhất trong schema | 52 |
| Cột khai báo `TEXT` | 501 |
| Cột khai báo `INTEGER` | 119 |
| Cột khai báo `REAL` | 7 |
| Cột tiền được nhận diện riêng | 14 |

Hệ thống không chỉ là CRUD đơn giản. Schema chứa dữ liệu đa tenant, không gian cá nhân, phiên bản bản ghi, tombstone đồng bộ, idempotency, phân quyền, gói dịch vụ, lịch sử nhân viên, phiên đăng nhập, audit chain và websocket outbox.

### 2.2. Mức độ phụ thuộc SQLite trong mã nguồn

Kết quả quét tĩnh hiện tại:

| Dấu hiệu phụ thuộc | Số tệp Python |
|---|---:|
| Import trực tiếp `sqlite3` | 18 |
| Sử dụng `BEGIN IMMEDIATE` | 13 |
| Sử dụng `INSERT OR ...` | 8 |
| Sử dụng `sqlite_master` hoặc `PRAGMA` | 10 |
| Sử dụng placeholder `?` | 50 |

Ngoài ra còn có:

- FTS5 và trigger đồng bộ bảng tìm kiếm.
- `datetime('now')`, `strftime`, `substr` trên cột ngày.
- `INTEGER PRIMARY KEY AUTOINCREMENT`, `rowid`, `typeof(...)`.
- So sánh DDL trực tiếp với chuỗi trong `sqlite_master`.
- Kiểm tra `PRAGMA quick_check`, `foreign_key_check`, `user_version`.
- Nhiều transaction ghi dựa vào giả định SQLite chỉ có một writer.

Kết luận: **không thể chỉ đổi driver và `DATABASE_URL`**. Cần thay lớp kết nối, chuyển DDL, chuyển SQL, thiết kế lại transaction cạnh tranh và kiểm chứng hợp đồng API.

### 2.3. Điểm nghẽn chịu tải hiện tại

1. `backend/db/db_helper.py` tạo kết nối file SQLite và giữ writer lease toàn tiến trình. Một ASGI instance thứ hai bị từ chối khởi động.
2. `backend/shared/database_io.py` cố định write lane ở đúng một worker. Mọi ghi dữ liệu, dù thuộc các tổ chức khác nhau, phải xếp hàng chung.
3. `backend/sync/service.py` có batch đồng bộ lớn trong một transaction, nhiều lần kiểm tra/đọc theo từng bản ghi và thao tác file trong phạm vi transaction.
4. `backend/sync/websocket.py` polling bảng `websocket_events` mỗi 250 ms ở mỗi worker. Khi tăng số instance, tải polling tăng tuyến tính.
5. `backend/sync/pagination.py` chạy `COUNT(*)` cho mỗi lần phân trang, có tìm kiếm `%từ_khóa%`, FTS fallback và lọc tháng bằng biểu thức trên cột.
6. Audit hiện dùng một chuỗi hash toàn cục, đọc phần tử cuối rồi chèn phần tử kế tiếp. Nếu chuyển nguyên trạng sang PostgreSQL, đây sẽ là điểm tranh chấp và có nguy cơ race.
7. Cache phiên và tổ chức nằm trong bộ nhớ từng process; tăng worker sẽ tạo nhiều bản cache không đồng nhất.
8. Tác vụ dọn dẹp chạy bằng daemon thread trong mỗi worker; khi scale ngang, cùng một công việc có thể chạy lặp nhiều lần.
9. Email và một số công việc nền chưa có hàng đợi bền vững; process chết có thể làm mất việc đã nhận.
10. File upload, ảnh dẫn xuất, template và tài liệu tạo ra còn gắn với ổ đĩa cục bộ, cản trở mở rộng ngang.

### 2.4. Trạng thái chuẩn bị PostgreSQL đang không đồng nhất

Kho mã đã có `scripts/backup.py` dùng `pg_dump`/`pg_restore`, đồng thời `backend/db/full_state_backup.py` và `backend/db/maintenance.py` tuyên bố SQLite backup đã bị bỏ. Tuy nhiên runtime, startup, schema, metrics, cảnh báo và nhiều script đóng gói vẫn dùng SQLite.

Đây là rủi ro P0: vận hành có thể tin rằng backup PostgreSQL đã hoạt động trong khi ứng dụng thực tế vẫn dùng file SQLite; một số script SQLite cũ còn import các hàm đã bị loại bỏ.

### 2.5. Khoảng trống kiểm thử

Không tìm thấy bộ test/spec tự động trong kho mã. Với khoảng 108 khai báo route/mount/websocket và 47 bảng dữ liệu, việc chuyển DB khi chưa có test hợp đồng là rủi ro phát hành rất cao. Xây dựng “lưới an toàn” kiểm thử là bước bắt buộc trước khi thay SQL hàng loạt.

## 3. Kiến trúc đích đề xuất

```text
Trình duyệt hiện tại (không thay đổi)
          |
          | HTTP/JSON + WebSocket contract giữ nguyên
          v
Nhiều instance Starlette/Uvicorn
          |
          +-- DB adapter + Psycopg 3 connection pool
          |             |
          |             v
          |     PostgreSQL primary (Multi-AZ)
          |             |
          |             +-- PITR/WAL backup
          |             +-- read replica (chỉ bật sau khi có chiến lược lag)
          |
          +-- LISTEN/NOTIFY + durable outbox
          |
          +-- Worker nền bền vững
          |
          +-- Object storage cho upload/tài liệu
          |
          +-- Redis tùy chọn cho rate limit/cache/pubsub tải cao
```

### 3.1. Quyết định kỹ thuật chính

| Chủ đề | Quyết định đề xuất | Lý do |
|---|---|---|
| Driver | Psycopg 3 + `psycopg_pool` | Driver chính thống, hỗ trợ pool tốt, phù hợp PostgreSQL hiện đại |
| Sync hay async | Giữ DB API đồng bộ ở giai đoạn chuyển đổi | Mã hiện tại đã đưa I/O DB ra thread pool; tránh viết lại toàn bộ cùng lúc |
| ORM | Không đưa ORM vào đường chuyển đổi ban đầu | Giảm phạm vi và nguy cơ đổi hành vi SQL/API |
| Schema upgrade | Tiếp tục registry một tệp, không bắt buộc thư mục `migrations` | Phù hợp quyết định fresh install trước đó; vẫn có version cho nâng cấp tương lai |
| ID nghiệp vụ | Giữ `TEXT` và prefix hiện tại | Tránh đổi JSON, URL, quan hệ và frontend |
| Tiền VND | `BIGINT` | Giữ số nguyên, không có sai số dấu phẩy động |
| Boolean hiện là 0/1 | Dùng `SMALLINT CHECK (value IN (0,1))` ở đợt đầu | Giảm sửa SQL và giữ nguyên JSON; có thể đổi nội bộ sau |
| JSON đang lưu text | Giữ `TEXT` ở đợt đầu | Không vô tình chuẩn hóa lại whitespace/thứ tự/`null`; chuyển JSONB sau khi có test |
| Enum | Giữ `TEXT CHECK` | PostgreSQL enum khó thay đổi zero-downtime và không tạo lợi ích ngay |
| Tìm kiếm | `pg_trgm` + chuẩn hóa dấu; cân nhắc `tsvector` theo use case | Gần với tìm kiếm substring hiện tại hơn FTS ngôn ngữ thuần túy |
| Websocket broker | PostgreSQL outbox + `LISTEN/NOTIFY` gửi ID sự kiện | Bỏ polling 250 ms, vẫn giữ sự kiện bền vững |
| Scale rate limit | Redis khi public traffic lớn | Tránh bảng rate-limit trở thành hot row/write amplification |

### 3.2. Phiên bản PostgreSQL

- Chọn PostgreSQL phiên bản còn được nhà cung cấp managed hỗ trợ dài hạn tại thời điểm triển khai; khuyến nghị PostgreSQL 17 hoặc 18 sau khi kiểm tra tương thích extension/driver.
- Không tự vận hành primary đơn lẻ cho production thương mại. Ưu tiên dịch vụ managed có Multi-AZ, snapshot, PITR, TLS và giám sát.
- Môi trường dev/staging/production phải cùng major version và cùng extension.

## 4. Hợp đồng bất biến giữa backend và giao diện

Trước khi sửa DB, tạo một “contract manifest” từ ứng dụng SQLite hiện tại.

### 4.1. Nội dung cần khóa

- Tất cả endpoint, method, path, query parameter và HTTP status.
- Tên trường JSON, chữ hoa/thường, trường bắt buộc/tùy chọn.
- Phân biệt `null`, chuỗi rỗng, mảng rỗng, object rỗng và trường không xuất hiện.
- Kiểu JSON: số, chuỗi, boolean 0/1, object, mảng.
- Thứ tự mặc định của danh sách và quy tắc hòa khi hai giá trị sort bằng nhau.
- Cấu trúc cursor phân trang, `total`, page size và lỗi cursor.
- Mã lỗi nghiệp vụ và nội dung mà UI dựa vào.
- Chuỗi ngày giờ hiện tại, timezone và quy tắc ngày-only.
- Cấu trúc message websocket và thứ tự sự kiện quan sát được.
- Cookie/session behavior, redirect của Google login và logout.
- File Word/Excel tải về: tên file, MIME type và nội dung nghiệp vụ.

### 4.2. Lớp tương thích backend

Lớp DB mới phải cung cấp:

1. `Database.get_connection()` lấy/trả kết nối từ pool.
2. Row object hỗ trợ cả `row[0]`, `row["column"]` và `dict(row)` như `sqlite3.Row`, hoặc sửa backend có hệ thống để chỉ dùng một kiểu truy cập.
3. Transaction context rõ ràng: commit khi thành công, rollback khi lỗi, luôn trả kết nối về pool.
4. Chuyển placeholder `?` sang `%s` bằng việc port SQL rõ ràng. Không dùng `str.replace("?", "%s")` vì sẽ làm hỏng literal/comment.
5. Chuẩn hóa `date`, `datetime`, `Decimal`, `UUID` và `memoryview` về đúng kiểu JSON cũ tại ranh giới repository/serializer.
6. Chuẩn hóa timestamp UTC về đúng chuỗi backend cũ trước khi tạo `JSONResponse`.
7. Ánh xạ lỗi PostgreSQL theo SQLSTATE sang lỗi nghiệp vụ hiện tại; không để tên bảng/constraint hoặc nội dung SQL lọt ra client.

### 4.3. Cơ chế chặn thay đổi frontend trong CI

Thêm job chỉ kiểm tra diff của nhánh PostgreSQL:

```powershell
$forbidden = git diff --name-only origin/main...HEAD |
  Select-String '^(frontend/|views/)|\.css$|^vite\.config\.js$'
if ($forbidden) { throw "PostgreSQL migration must not modify UI/frontend files." }
```

Job này là release gate bắt buộc, không phải cảnh báo.

## 5. Thiết kế schema PostgreSQL

### 5.1. Lập manifest chuyển kiểu cho từng cột

Không chuyển 501 cột `TEXT` một cách máy móc. Tạo manifest có một dòng cho mọi cột với: bảng, cột, kiểu SQLite tham chiếu, kiểu PostgreSQL, nullable, default, check, FK, index, serializer và giá trị seed/default trong fresh install.

| Kiểu/ý nghĩa hiện tại | PostgreSQL đợt đầu | Quy tắc tương thích |
|---|---|---|
| ID nghiệp vụ `TEXT` | `TEXT` | Giữ nguyên giá trị và prefix |
| Email/username normalized | `TEXT` + unique index | Giữ hàm normalize hiện tại, không dựa vào collation mặc định |
| Tiền VND `INTEGER` | `BIGINT` + `CHECK >= 0` | Trả JSON number như cũ |
| Counter/version | `BIGINT` | Tránh tràn khi vận hành lâu dài |
| 0/1 | `SMALLINT CHECK IN (0,1)` | Trả đúng 0/1 như hiện tại |
| Epoch seconds | `BIGINT` | Giữ hợp đồng session/token hiện tại |
| Ngày thuần | `DATE` | Serializer trả `YYYY-MM-DD` như backend cũ |
| Thời điểm tuyệt đối | `TIMESTAMPTZ` | Lưu UTC, serializer trả format cũ |
| Thời gian địa phương nghiệp vụ | Xem xét `TIMESTAMP WITHOUT TIME ZONE` | Quyết định theo ý nghĩa từng cột, không đoán chung |
| `REAL` | `DOUBLE PRECISION` ở đợt đầu | Xác nhận sai số; đổi `NUMERIC(p,s)` nếu là tỷ lệ cần chính xác |
| JSON text | `TEXT` ở đợt đầu | Chuyển `JSONB` ở release sau có migration riêng |
| Autoincrement audit/event | `BIGINT GENERATED BY DEFAULT AS IDENTITY` | Serializer vẫn trả số như cũ |

### 5.2. Collation và tiếng Việt

- Không phụ thuộc collation mặc định của máy chủ cho email, username hoặc business key.
- Duy trì các cột `_norm` hiện có và unique index trên giá trị đã normalize.
- Chọn collation xác định cho thứ tự trả về; ghi lại kết quả SQLite baseline và thêm `id` làm tie-breaker ở backend để thứ tự ổn định.
- Bật `pg_trgm`; chỉ bật `unaccent` khi đã kiểm tra semantics tìm kiếm có dấu/không dấu.
- Với index tìm kiếm không dấu, dùng cột normalized được cập nhật có kiểm soát hoặc hàm immutable do ứng dụng sở hữu; không tạo functional index trên biểu thức không immutable.

### 5.3. Ràng buộc và trigger

Rà toàn bộ trigger trong `backend/db/db_utils.py`, phân loại:

1. Chuyển thành `CHECK`, `UNIQUE`, `FOREIGN KEY` nếu một constraint chuẩn diễn đạt được.
2. Dùng trigger PL/pgSQL cho bất biến liên bảng như workspace owner, assignment tenant, evaluation actor và quan hệ hợp đồng–gói thầu.
3. Không dùng trigger chỉ để cập nhật `updated_at` nếu repository có thể làm rõ trong cùng câu `UPDATE`; nếu vẫn dùng trigger, phải có một hàm dùng chung và test.
4. Trigger tombstone/sync version phải được xem xét cùng transaction ứng dụng để tránh tăng version hai lần.
5. Trigger phải có test cho INSERT, UPDATE, DELETE, bulk import và race giữa hai transaction.

### 5.4. Index ban đầu

Port các index hiện có nhưng không sao chép mù quáng. Mỗi index cần liên kết với query thực tế và `EXPLAIN (ANALYZE, BUFFERS)`.

Ưu tiên:

- `(organization_id, sync_version)` cho delta sync.
- Partial index `WHERE is_latest = 1 AND archived_at IS NULL` cho dữ liệu phiên bản mới nhất.
- `(organization_id, updated_at, id)` cho keyset pagination.
- Index FK phía con cho 78 quan hệ; PostgreSQL không tự tạo index cho FK phía con.
- Unique partial index cho business key mới nhất.
- `(user_id, revoked_at, idle_expires_at, absolute_expires_at)` cho session.
- `(organization_id, created_at)` và `(organization_id, delete_version)` cho tombstone/audit.
- `(status, expires_at)` cho subscription/token/job cleanup.
- GIN/GiST trigram cho các cột thực sự được tìm kiếm substring.

Không tạo index trùng tiền tố hoặc index có write cost cao nhưng không được dùng. Sau staging load test, dùng `pg_stat_user_indexes` để loại index không có giá trị.

### 5.5. Schema version không cần thư mục migrations

Giữ `backend/db/upgrades.py` là registry tuần tự một tệp:

- Fresh install tạo thẳng canonical PostgreSQL schema ở version hiện tại.
- Upgrade tương lai thêm hàm version mới và không sửa lại version đã phát hành.
- `database_metadata` là nguồn version duy nhất; bỏ `PRAGMA user_version`.
- Khi startup upgrade, giữ PostgreSQL advisory lock toàn cụm để chỉ một instance chạy DDL.
- Runtime role không có quyền DDL; migration dùng role riêng trong deploy job trước khi rollout app.
- Mỗi upgrade cần `precheck`, `apply`, `postcheck`; DDL không thể rollback an toàn phải dùng expand/contract.

## 6. Chuyển SQL và transaction

### 6.1. Ma trận cú pháp

| SQLite | PostgreSQL |
|---|---|
| `?` | `%s` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT ... DO NOTHING` |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT (...) DO UPDATE SET ...` với danh sách cột rõ ràng |
| `datetime('now')` | `CURRENT_TIMESTAMP` hoặc giá trị UTC do backend truyền |
| `date('now')` | `CURRENT_DATE` |
| `strftime(...)` | `to_char`, `extract`, hoặc tính range ở backend |
| `substr(date_col, 6, 2)` | Range ngày sargable; tránh bọc cột bằng hàm |
| `MAX(a,b)` scalar | `GREATEST(a,b)` |
| `PRAGMA ...` | Catalog/health query PostgreSQL tương ứng |
| `sqlite_master` | `pg_catalog`/`information_schema`, hoặc bỏ runtime introspection |
| FTS5 `MATCH` | trigram/`to_tsvector` query |
| `AUTOINCREMENT` | identity column |
| `rowid` | khóa chính/identity rõ ràng |

Mọi `ON CONFLICT` phải khai báo conflict target hoặc constraint cụ thể. `INSERT OR REPLACE` không được dịch thành delete+insert vì có thể kích hoạt cascade, đổi ID và làm sai audit.

### 6.2. Isolation, lock và retry

- Mặc định dùng `READ COMMITTED` cho request thông thường.
- Dùng row lock/advisory lock có phạm vi nhỏ cho cấp sync version, version family và audit chain head.
- Chuẩn hóa thứ tự khóa giữa các bảng để giảm deadlock.
- Dùng `UPDATE ... WHERE row_version = %s RETURNING ...` cho optimistic concurrency; không tách `SELECT` kiểm tra và `UPDATE` nếu có thể race.
- Retry có jitter, tối đa 2–3 lần cho SQLSTATE `40001` và `40P01`, chỉ khi thao tác có idempotency key hoặc chắc chắn lặp an toàn.
- Không retry constraint violation, lỗi quyền, validation hoặc câu lệnh có side effect ngoài DB chưa được bù trừ.
- Đặt `lock_timeout` và `statement_timeout`; không để request chờ khóa vô hạn.

### 6.3. Cấp `sync_version`

Thay chuỗi insert/update/select hiện tại bằng thao tác atomic:

```sql
INSERT INTO sync_metadata (organization_id, current_version)
VALUES (%s, 0)
ON CONFLICT (organization_id) DO NOTHING;

UPDATE sync_metadata
SET current_version = current_version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE organization_id = %s
RETURNING current_version;
```

Một organization là một điểm tuần tự hợp lý; các organization khác nhau phải ghi song song được.

### 6.4. Version family và `is_latest`

- Khóa theo `(organization_id, table_name, id_goc[, ke_hoach_id])` bằng advisory lock hoặc row lock trước khi tính latest.
- Duy trì unique partial index đảm bảo chỉ có một latest trong family.
- Cập nhật bản cũ về `is_latest = 0` và bản mới về `1` trong cùng transaction.
- Test hai request đồng thời tạo version mới cho cùng family; đúng một request thành công hoặc cả hai được serialize đúng.

### 6.5. Side effect file trong transaction

Không ghi/xóa file cuối cùng trong khi DB transaction còn mở. Thay bằng:

1. Ghi file vào vùng staging với tên bất biến/checksum.
2. Ghi metadata + outbox trong transaction DB.
3. Commit DB.
4. Worker hoàn tất move/upload; retry idempotent.
5. Garbage collector dọn staging mồ côi.

Cách này rút ngắn thời gian giữ lock và tránh trạng thái DB rollback nhưng file đã thay đổi.

## 7. Tối ưu các luồng tải lớn

### 7.1. Sync batch

Hiện batch có thể lên tới 2.000 bản ghi và có nhiều truy vấn theo từng item. Kế hoạch:

- Đo số query/batch trước khi tối ưu.
- Preload các ID, owner, version family và permission cần thiết bằng query tập hợp.
- Dùng `executemany`/pipeline hoặc staging table + `COPY` cho import lớn.
- Dùng `INSERT ... ON CONFLICT ... RETURNING` theo nhóm cùng bảng.
- Chia transaction theo giới hạn thời gian/record nếu hợp đồng atomic hiện tại cho phép; nếu không, giữ atomic và giảm round-trip.
- Giữ nguyên request/response sync và conflict payload.
- Đặt giới hạn payload byte, không chỉ số bản ghi, để chống request chiếm RAM.

### 7.2. Pagination và tìm kiếm

- Giữ `total` chính xác ở đợt đầu vì UI có thể phụ thuộc.
- Thêm tie-breaker `id` vào mọi `ORDER BY` để kết quả ổn định giữa hai DB.
- Dùng keyset pagination cho tập lớn khi API hiện đã yêu cầu cursor; không tự đổi offset response.
- Thay lọc tháng bằng khoảng `[đầu tháng, đầu tháng kế tiếp)` để dùng B-tree.
- Thay `%search%` bằng trigram index trên đúng cột tìm kiếm.
- So sánh tập kết quả SQLite/PostgreSQL cho có dấu, không dấu, chữ hoa/thường, ký tự đặc biệt và chuỗi rỗng.
- Đo `COUNT(*)`; chỉ đưa approximate count/cache vào release sau nếu hợp đồng UI được giữ nguyên bằng cơ chế làm mới phù hợp.

### 7.3. Dashboard

- Ghi nhận query plan và latency từng truy vấn trong `dashboard_summary.py`.
- Loại correlated subquery/N+1 bằng CTE hoặc aggregate một lượt khi hiệu quả hơn.
- Tạo index partial theo trạng thái/ngày/organization dựa trên query thật.
- Chỉ dùng materialized view hoặc cache khi có cơ chế invalidation và SLA độ mới rõ ràng.

### 7.4. Audit chain

Chuỗi audit toàn cục hiện tại sẽ serialize mọi mutation có audit. Đề xuất:

- Thêm bảng `audit_chain_heads(chain_id, last_id, last_hash, updated_at)`.
- `chain_id` theo organization; sự kiện không thuộc tổ chức dùng chain `global`.
- Append khóa đúng một head row bằng `SELECT ... FOR UPDATE`, tính hash và insert trong cùng transaction nghiệp vụ.
- Unique `(chain_id, sequence)` và `(chain_id, previous_hash)` để chặn fork.
- Checkpoint chứa head của từng chain và một Merkle/root digest tổng hợp để phát hiện rollback.
- Verifier chạy incremental từ checkpoint, không quét toàn bộ lịch sử mỗi lần startup.
- Nếu quyết định giữ một global chain, phải đo throughput và chấp nhận nó là giới hạn ghi toàn hệ thống.

### 7.5. Websocket broker

- Duy trì bảng outbox để không mất sự kiện.
- Sau commit, gọi `pg_notify(channel, event_id)`; payload chỉ chứa ID nhỏ, không gửi toàn bộ JSON.
- Mỗi process giữ một connection LISTEN riêng, lấy event theo ID và broadcast local.
- Khi reconnect, đọc lại outbox từ cursor cuối để bù sự kiện bỏ lỡ.
- Cleanup outbox theo batch và index `created_at/id`.
- Bỏ vòng polling 250 ms sau khi LISTEN/NOTIFY đã được soak test.
- Với lưu lượng websocket rất lớn, chuyển fan-out sang Redis/NATS nhưng vẫn có transactional outbox làm nguồn bền vững.

### 7.6. Tác vụ nền và cache

- Không để daemon cleanup thread tự chạy ở mọi worker. Dùng scheduler riêng hoặc PostgreSQL advisory lock để chỉ một leader chạy một job.
- Email, tạo tài liệu và xử lý ảnh cần durable job record, retry, dead-letter và idempotency.
- Cache phiên/tổ chức phải có version/invalidation giữa các instance. Có thể dùng Redis hoặc NOTIFY để xóa cache.
- Không đặt dữ liệu quyền nhạy cảm trong cache quá lâu; revocation phải có hiệu lực giữa mọi worker.
- Đưa upload, ảnh và tài liệu sang object storage có versioning; URL/API trả về cho frontend vẫn giữ nguyên bằng backend proxy hoặc compatibility URL.

## 8. Connection pool và cấu hình PostgreSQL

### 8.1. Công thức pool

```text
Tổng connection ứng dụng tối đa
= số instance × số Uvicorn worker/instance × pool.max_size
+ connection LISTEN
+ migration/maintenance/monitoring
```

Luôn chừa ít nhất 30% `max_connections` cho migration, quản trị, autovacuum/monitoring và sự cố. Không tăng pool chỉ để che query chậm.

Baseline để bắt đầu load test, không phải giá trị production cố định:

- `pool.min_size = 2` mỗi process.
- `pool.max_size = 8` mỗi process.
- Acquire timeout: 2 giây.
- Connect timeout: 3–5 giây.
- `statement_timeout`: 5 giây cho query UI thông thường; route export/report có timeout riêng.
- `lock_timeout`: 1–2 giây.
- `idle_in_transaction_session_timeout`: 15–30 giây.
- `application_name`: chứa service, environment, release và worker.
- `timezone = UTC`.
- `search_path` cố định, không nhận từ request.

Điều chỉnh dựa trên p95 pool wait, DB CPU, IOPS, active connections và query latency.

### 8.2. PgBouncer

- Dùng PgBouncer transaction pooling nếu số instance/process làm số connection vượt khả năng DB.
- Kiểm tra prepared statement behavior của Psycopg/PgBouncer; cấu hình rõ thay vì dựa mặc định.
- Connection LISTEN/NOTIFY không đi qua transaction pool; dùng direct PostgreSQL connection riêng.
- Reset mọi session setting/tenant context trước khi trả connection về pool.

### 8.3. Read replica

Không đưa request người dùng sang replica trong lần phát hành đầu. Chỉ bật cho báo cáo nặng sau khi:

- Có đo replication lag.
- Route chấp nhận eventual consistency.
- Read-after-write vẫn đi primary.
- Có fallback primary khi replica lỗi/lag quá ngưỡng.

## 9. Bảo mật và cô lập tenant

### 9.1. DB roles

Tách tối thiểu:

- `bidding_owner`: sở hữu schema, không dùng bởi app.
- `bidding_migrator`: DDL trong deploy job.
- `bidding_runtime`: SELECT/INSERT/UPDATE/DELETE cần thiết, không DDL.
- `bidding_readonly`: hỗ trợ/BI có giới hạn.
- `bidding_backup`: quyền cần cho backup.

Yêu cầu TLS `verify-full`, secret trong secret manager, rotation và không log `DATABASE_URL`.

### 9.2. Tenant isolation

- Audit mọi query theo `organization_id` và `owner_type`; đặc biệt là query động, join và subquery.
- Tạo test bắt buộc cho cross-tenant read/write/delete và personal workspace.
- Có thể bổ sung Row Level Security sau khi adapter/pool ổn định. Nếu dùng RLS, set tenant bằng `SET LOCAL` bên trong transaction và reset chắc chắn khi trả connection.
- RLS là lớp phòng vệ, không thay validation/permission hiện tại.

### 9.3. SQL injection và lỗi

- Table/column động chỉ lấy từ allowlist `SCHEMA_DINH_NGHIA`/mapping cố định.
- Dùng `psycopg.sql.Identifier` cho identifier; không dùng parameter placeholder cho identifier.
- Không nối search/filter do người dùng nhập vào SQL.
- Log SQLSTATE, query name và request ID; không log parameter nhạy cảm.
- Response lỗi giữ nguyên contract và không lộ schema/constraint/internal SQL.

## 10. Backup, phục hồi và tính liên tục kinh doanh

### 10.1. Chiến lược production

- Managed snapshot + continuous WAL archiving/PITR.
- `pg_dump --format=custom` cho backup logic định kỳ và trước release lớn.
- Object storage versioning cho upload/template/tài liệu.
- Manifest liên kết DB backup và file snapshot bằng timestamp/release/checksum.
- Mã hóa khi truyền và khi lưu; backup ở tài khoản/vùng tách biệt.

Mục tiêu đề xuất ban đầu cần chủ sản phẩm xác nhận:

- RPO ≤ 5 phút.
- RTO ≤ 30 phút.
- Giữ PITR 14–35 ngày tùy yêu cầu thương mại/pháp lý.
- Audit retention mặc định hiện là 10 năm cần được xác nhận theo chính sách dữ liệu.

### 10.2. Restore drill

Mỗi tháng:

1. Restore vào PostgreSQL cô lập.
2. Chạy migration/readiness.
3. Kiểm checksum/số hàng/FK/audit checkpoint.
4. Chạy smoke API và mở tài liệu mẫu.
5. Đo thời gian thực tế, ghi nhận RPO/RTO.
6. Hủy môi trường diễn tập an toàn.

Backup chưa từng restore thành công không được coi là backup hợp lệ.

### 10.3. Dọn trạng thái lai hiện tại

- Đồng bộ `scripts/backup.py`, `backend/db/maintenance.py`, metrics, alert, runbook và packaging với PostgreSQL.
- Xóa hoặc chuyển các script `backup_database.py`, `restore_database.py`, `check_database.py`, `full_state_backup.py` cũ thành wrapper báo lỗi rõ nếu không còn hỗ trợ.
- Thay metric/alert `sqlite_busy`, WAL file size và SQLite file size bằng pool wait, locks, deadlocks, replication lag, DB size, bloat và backup/PITR age.
- Production package smoke test phải dùng PostgreSQL tạm/ephemeral, không tạo `smoke.db`.

## 11. Observability và vận hành

### 11.1. Metrics bắt buộc

- Request rate/error/latency theo route template.
- Pool size, checked-out, acquire wait, timeout, rejected.
- Query latency theo tên query; không label bằng raw SQL/ID để tránh cardinality cao.
- Transaction duration, rollback, serialization retry, deadlock.
- PostgreSQL CPU, memory, IOPS, connections, cache hit, temp files.
- Lock wait, long transaction, idle-in-transaction.
- Autovacuum age, dead tuples, table/index bloat.
- `pg_stat_statements`: total time, mean/p95 gần đúng, calls, rows, shared blocks.
- Replication lag/PITR/backup age/restore drill age.
- Sync batch size, duration, conflicts, rows/query count.
- Websocket outbox backlog/oldest age/notify reconnect.
- Job queue depth, oldest job, retry/dead-letter.
- Audit append/checkpoint/verifier status theo chain.

Metrics in-process hiện tại không cộng gộp đúng khi chạy nhiều worker. Chuyển sang Prometheus multiprocess-compatible collector hoặc exporter/OTel phù hợp.

### 11.2. Logging và tracing

- Correlation ID xuyên HTTP → DB query → background job → websocket event.
- Structured JSON log có release ID, instance, worker và tenant hash an toàn.
- Slow query log ở PostgreSQL và application query timing.
- OpenTelemetry trace cho sync, export Word, login Google, offboarding/rejoin và dashboard.
- Sampling không được làm mất toàn bộ trace lỗi/slow request.

### 11.3. Health endpoint

- Liveness chỉ chứng minh process/event loop sống; không phụ thuộc DB.
- Readiness kiểm `SELECT 1`, pool acquire, schema version tương thích và audit subsystem sẵn sàng.
- Startup không quét toàn bộ audit chain khi lịch sử lớn; dùng checkpoint incremental.
- Instance mất DB phải rời load balancer nhưng không restart loop vô hạn gây bão kết nối.

## 12. Chiến lược kiểm thử bắt buộc

### 12.1. Test pyramid cần xây trước khi port SQL diện rộng

1. Unit test: normalize, mapping, date, permission, subscription, query builder.
2. Repository integration test trên PostgreSQL thật; không mock DB cho SQL behavior.
3. API contract test chạy cùng fixture trên SQLite baseline và PostgreSQL candidate.
4. Concurrency test cho sync version, row version, audit, idempotency, version latest và membership.
5. End-to-end test các hành trình chính.
6. Load/soak/failure test.
7. Visual regression test để chứng minh giao diện không đổi.

Test PostgreSQL nên dùng database/container cô lập theo run, chạy schema fresh, và dọn bằng drop database/schema thay vì xóa từng bảng.

### 12.2. Golden API comparison

Với cùng seed và request sequence:

- Thu response SQLite và PostgreSQL.
- Loại duy nhất các giá trị nondeterministic đã khai báo như token ngẫu nhiên/request ID.
- So sánh status, header quan trọng, JSON deep equality, kiểu dữ liệu và thứ tự mảng.
- So sánh websocket event sequence.
- So sánh file export bằng nội dung XML/worksheet semantic và render, không chỉ hash ZIP.

Không được cập nhật golden snapshot chỉ để test xanh nếu chưa giải thích khác biệt.

### 12.3. Visual regression không sửa frontend

- Chạy cùng bản build frontend duy nhất lần lượt với backend SQLite baseline và backend PostgreSQL.
- Dùng cùng viewport, font, timezone, locale, seed và tài khoản.
- Chụp các màn hình: đăng nhập, Google login, header workspace, danh sách nhân viên, modal phân quyền, dashboard, mọi bảng CRUD, tìm kiếm, phân trang, trạng thái lỗi/rỗng/loading và export.
- Pixel diff ngưỡng đề xuất ≤ 0,1% chỉ để bỏ anti-aliasing; mọi thay đổi text/layout phải là 0.
- So sánh thêm DOM text và accessibility tree để tránh ảnh giống nhưng dữ liệu khác.
- Không đặt test vào `frontend/**`; đặt trong `tests/e2e` hoặc tooling độc lập.

### 12.4. Kịch bản nghiệp vụ tối thiểu

- Tài khoản cá nhân không có organization record giả.
- Người dùng có cả dữ liệu cá nhân và tổ chức, đổi workspace đúng quyền.
- Super admin đổi role, gói và quyền tùy chỉnh.
- Thành viên dùng entitlement của tổ chức; rời tổ chức mất quyền tổ chức nhưng giữ dữ liệu cá nhân.
- Xóa nhân viên, lịch sử “Đã rời”, thêm lại nhân viên.
- Đổi email A → B cập nhật đúng các màn hình/quan hệ.
- Google login tài khoản mới/cũ, mật khẩu tạm và email thất bại/retry.
- CRUD và conflict đồng bộ ở hai client.
- Export bị chặn/cho phép đúng gói.
- Audit fail-closed và checkpoint restore.
- Session revoke/logout có hiệu lực trên mọi instance.

### 12.5. Load test và SLO đề xuất

SLO phải được đo từ phía client ở staging có cấu hình gần production. Baseline ban đầu:

| Luồng | Mục tiêu p95 | Mục tiêu p99 | Lỗi ứng dụng |
|---|---:|---:|---:|
| Read CRUD/pagination phổ biến | ≤ 300 ms | ≤ 800 ms | < 0,1% |
| Write CRUD đơn | ≤ 500 ms | ≤ 1.000 ms | < 0,1% |
| Dashboard | ≤ 800 ms | ≤ 1.500 ms | < 0,5% |
| Sync 100 bản ghi | ≤ 2 giây | ≤ 4 giây | < 0,5% |
| Login/session | ≤ 500 ms, không tính Google/SMTP | ≤ 1.000 ms | < 0,1% |
| Websocket event sau commit | ≤ 500 ms | ≤ 1 giây | mất sự kiện = 0 |

Kịch bản tải:

1. Ramp 1 → 50 → 100 → 250 → 500 virtual users; giữ mỗi nấc 15 phút.
2. Tỷ lệ 80% read, 15% write, 5% sync/export; thêm profile theo traffic dự kiến thật.
3. Hot tenant: nhiều người cùng organization.
4. Multi-tenant: nhiều organization ghi song song.
5. Sync burst sau khi client mất mạng.
6. Search substring và pagination ở bảng hàng triệu row.
7. 24 giờ soak test để phát hiện leak/pool starvation/bloat.
8. Kill một app instance, failover DB, mất LISTEN connection, SMTP/object storage chậm.
9. Long-running export tách khỏi request DB để không chiếm connection.

Release chỉ được chấp nhận khi không có pool starvation, transaction chờ lâu, deadlock chưa xử lý, duplicate version, audit fork hoặc cross-tenant leak.

## 13. Lộ trình thực hiện theo phase

### Phase 0 — Khóa baseline và phạm vi (2–3 ngày)

**Công việc**

- Tạo nhánh riêng cho PostgreSQL.
- Bật CI guard cấm thay đổi frontend/CSS/views.
- Chụp schema, route, response và visual baseline từ SQLite.
- Lập danh sách query theo module và định danh query name.
- Chốt SLO, tải dự kiến, RPO/RTO, provider và ngân sách DB.
- Dừng thay đổi schema nghiệp vụ trong thời gian port hoặc yêu cầu mọi thay đổi cập nhật cả hai manifest.

**Đầu ra/điều kiện hoàn thành**

- Contract manifest và golden data đã version control.
- Baseline performance report.
- Danh sách owner cho từng workstream.
- Không có tệp frontend bị thay đổi.

### Phase 1 — Dựng lưới test (5–8 ngày)

**Công việc**

- Tạo test infrastructure backend và PostgreSQL ephemeral.
- Seed đủ personal/organization/superadmin/subscription/sync/audit.
- Viết contract test cho các route quan trọng trước.
- Viết concurrency test cho các bất biến dữ liệu.
- Tạo visual comparison runner bên ngoài frontend.

**Gate**

- Toàn bộ smoke/contract test chạy xanh trên SQLite baseline.
- Test thất bại khi cố ý đổi kiểu JSON, sort hoặc quyền.

### Phase 2 — DB abstraction và pool (4–6 ngày)

**Công việc**

- Thêm Psycopg 3/pool vào dependency lock sau khi xác nhận wheel cho Python production.
- Tạo backend-neutral Database/Connection/Transaction interface.
- Tạo row compatibility và error mapping.
- Thêm `DATABASE_URL`, TLS/pool/timeouts; loại `BIDDING_DB_PATH` khỏi runtime PostgreSQL.
- Thay read/write lane một-writer bằng concurrency có giới hạn theo pool.
- Giữ feature flag chỉ trong backend để chọn SQLite baseline hoặc PostgreSQL trong thời gian test; production cuối cùng chỉ cho PostgreSQL.

**Gate**

- Health/readiness và một repository mẫu chạy qua adapter.
- Không có connection leak khi test lỗi/cancel/timeout.

### Phase 3 — Canonical PostgreSQL schema (5–8 ngày)

**Công việc**

- Hoàn thành manifest 627 cột.
- Port 47 bảng, 78 FK, unique/check và identity.
- Port index/trigger theo thiết kế PostgreSQL.
- Port schema version registry, advisory migration lock và readiness.
- Tạo extensions bằng migrator role.
- Viết schema drift test dựa catalog, không so chuỗi DDL.

**Gate**

- Fresh install từ database rỗng thành công, idempotent ở startup/deploy phù hợp.
- Constraint/concurrency tests xanh.
- Runtime role không thể chạy DDL.

### Phase 4 — Port query theo lát dọc (10–15 ngày)

Thứ tự để giảm rủi ro:

1. Auth/session/Google/OTP/password reset/rate limit.
2. Organization, membership, role, subscription, entitlement.
3. CRUD read/pagination/search.
4. CRUD write, delete/archive/version family.
5. Sync mutation/read/delta/tombstone/idempotency.
6. Dashboard/report/export/document context.
7. Audit, websocket, maintenance và background jobs.

Mỗi lát dọc chỉ hoàn thành khi golden contract và concurrency test xanh; không chờ port xong toàn bộ mới test.

### Phase 5 — Loại bỏ điểm nghẽn scale (5–8 ngày)

- Audit head locking/sharding.
- LISTEN/NOTIFY outbox.
- Leader-elected cleanup jobs.
- Shared cache invalidation/rate limit strategy.
- Object storage/durable job queue cho tài liệu và email.
- Multi-worker metrics.

**Gate**

- Chạy tối thiểu 2 app instance × 2 worker, dữ liệu và websocket nhất quán.
- Logout/revoke/role change có hiệu lực trên mọi instance.

### Phase 6 — Diễn tập fresh install và seed (2–3 ngày)

- Tạo PostgreSQL hoàn toàn rỗng bằng hạ tầng giống production.
- Chạy canonical schema và toàn bộ upgrade registry từ đầu.
- Seed duy nhất dữ liệu hệ thống bắt buộc: cấu hình mặc định, gói dịch vụ mặc định nếu nghiệp vụ yêu cầu và tài khoản super admin bootstrap.
- Không đọc hoặc nhập bất kỳ hàng dữ liệu nào từ SQLite.
- Kiểm tra seed idempotent: chạy lại không tạo bản ghi trùng và không ghi đè cấu hình do quản trị viên thay đổi.
- Chạy readiness, constraint, contract, permission, audit và backup/restore smoke test trên database fresh install.

### Phase 7 — Hiệu năng và độ bền (7–10 ngày)

- Chạy load profile ở mục 12.5.
- `EXPLAIN ANALYZE BUFFERS` top query.
- Tối ưu query/index/batch/pool, sau mỗi thay đổi chạy lại contract test.
- Soak 24 giờ và fault injection.
- Capacity report: throughput tối đa, DB sizing, pool sizing, bottleneck kế tiếp và chi phí.

### Phase 8 — Staging rehearsal và cutover (4–6 ngày)

- Deploy như production, chạy backup/restore drill.
- Chạy security/tenant isolation checklist.
- Chạy full visual regression.
- Canary nội bộ, sau đó tăng traffic theo nấc.
- Theo dõi error, latency, locks, pool, audit, websocket, jobs.

### Phase 9 — Dọn SQLite và đóng dự án (2–4 ngày)

- Gỡ SQLite driver/runtime flag/writer lease/PRAGMA/FTS5.
- Gỡ cảnh báo, metrics, script và tài liệu SQLite không còn dùng.
- Không đóng gói hoặc duy trì importer SQLite.
- Cập nhật runbook, sơ đồ, on-call, disaster recovery và capacity plan.
- Chạy lại CI guard để chứng minh frontend không đổi.

### Ước lượng tổng

- Khoảng 40–60 ngày công kỹ thuật, chưa tính sửa lỗi phát hiện trong load/security test.
- Một kỹ sư backend: khoảng 8–12 tuần lịch.
- Hai đến ba kỹ sư backend/QA/DevOps làm song song: khoảng 5–7 tuần lịch.
- Không nên rút ngắn bằng cách bỏ contract, concurrency, restore hoặc tenant-isolation test.

## 14. Chiến lược phát hành fresh install và rollback

### 14.1. Phát hành fresh install

1. Provision PostgreSQL production.
2. Chạy canonical schema bằng migrator role.
3. Seed gói/cấu hình/superadmin cần thiết.
4. Deploy candidate với traffic đóng.
5. Chạy readiness, smoke, contract và backup.
6. Mở canary traffic.
7. Tăng traffic khi SLO ổn định.

Không có bước copy SQLite, giảm đáng kể rủi ro và thời gian downtime.

### 14.2. Rollback trong mô hình fresh install

- Trước khi mở traffic: rollback bằng cách hủy candidate deployment, sửa lỗi và tạo lại một PostgreSQL database rỗng; không quay về SQLite production.
- Sau khi mở traffic nhưng chưa có dữ liệu khách hàng cần giữ: đóng traffic, hủy database candidate và triển khai lại fresh install đã sửa.
- Sau khi đã có dữ liệu khách hàng production: từ thời điểm đó, mọi rollback phải giữ PostgreSQL và rollback phiên bản ứng dụng/schema theo chiến lược expand/contract; vẫn không chuyển ngược về SQLite.
- Mỗi release schema phải khai báo rõ phiên bản ứng dụng tương thích và điểm không thể rollback.
- Không tồn tại quy trình dual-write hoặc reverse migration sang SQLite.

## 15. Work package theo khu vực mã nguồn

| Khu vực | Công việc chính | Ưu tiên |
|---|---|---:|
| `backend/db/db_helper.py` | Psycopg pool, transaction, health, bỏ file lease | P0 |
| `backend/db/schema.py` | PostgreSQL DDL/manifest kiểu dữ liệu | P0 |
| `backend/db/db_utils.py` | Catalog, index, trigger, FTS, fresh install | P0 |
| `backend/db/upgrades.py` | Bỏ PRAGMA, advisory lock, metadata version | P0 |
| `backend/shared/database_io.py` | Bounded concurrent reads/writes, SQLSTATE metrics | P0 |
| `backend/startup.py` | PostgreSQL config/readiness, bỏ SQLite path/quick_check | P0 |
| `backend/lifecycle.py` | Leader jobs, PostgreSQL retention SQL, multi-instance | P0 |
| `backend/sync/service.py` | Transaction, batch, N+1, side effects, conflicts | P0 |
| `backend/sync/repository.py` | Atomic version, PostgreSQL upsert | P0 |
| `backend/sync/pagination.py` | Search, collation, count, range date, stable sort | P0 |
| `backend/shared/audit_chain.py` | Concurrent append, chain head/checkpoint | P0 |
| `backend/sync/websocket.py` | LISTEN/NOTIFY + outbox | P0 |
| `backend/auth/**` | Session/rate limit/idempotent Google/auth transactions | P0 |
| `backend/api/**` | Placeholder/datetime/upsert/tenant checks | P0 |
| `backend/documents/**` | DB queries, durable jobs, storage side effects | P1 |
| `backend/observability/**` | PG/pool/multi-worker metrics và alerts | P0 |
| `scripts/**` | PG backup/restore/check/package/fresh seed | P0 |
| `deploy/**`, `docs/**`, `.env.example` | Runbook, secrets, alerts, provision | P0 |
| `frontend/**`, `views/**`, CSS | **Không được chỉnh sửa** | Cấm |

## 16. Các thiếu sót/nguy cơ cần xử lý trước khi bán sản phẩm

### P0 — Chặn phát hành

1. Không có test tự động/contract/concurrency đáng kể.
2. Runtime chỉ chạy một process do SQLite writer lease.
3. Backup code đang ở trạng thái lai SQLite/PostgreSQL.
4. Audit chain toàn cục và startup verification có nguy cơ tranh chấp/quét dài; từng có lỗi checkpoint head khi startup.
5. Background task/cache/websocket chưa được thiết kế đầy đủ cho nhiều instance.
6. Local file storage và side effect file trong transaction cản trở scale/khôi phục nhất quán.
7. Chưa có bằng chứng tenant isolation khi chạy query/join động.
8. Chưa có restore drill PostgreSQL hoàn chỉnh và alert tương ứng.
9. Metrics in-process không đáng tin khi nhiều worker.
10. Chưa có capacity/load/soak report.

### P1 — Hoàn thành trước hoặc ngay sau limited availability

1. Durable queue cho email/document và dead-letter/retry.
2. Redis hoặc cơ chế phân tán cho rate limit/cache invalidation.
3. Object storage/versioning cho file.
4. Query tracing/`pg_stat_statements`/slow query workflow.
5. Data retention/privacy/export/delete policy được pháp lý xác nhận.
6. Dependency/SBOM/vulnerability/container scan và secret scan.
7. Python hiện pin `>=3.14,<3.15`; cần xác minh toàn bộ driver/tooling production có wheel và hỗ trợ ổn định. Nếu chưa, chọn phiên bản Python được ecosystem hỗ trợ tốt hơn trong một thay đổi backend/infra riêng.

### P2 — Tối ưu sau khi có số liệu thật

1. Read replica cho báo cáo.
2. JSONB cho field cần query/index.
3. RLS defense-in-depth.
4. Partition audit/tombstone/event theo thời gian nếu kích thước/retention yêu cầu.
5. Async DB end-to-end nếu profiling chứng minh thread/pool là điểm nghẽn.
6. Materialized view/cached count cho dashboard hoặc bảng rất lớn.

## 17. Release gates cuối cùng

Không phát hành nếu bất kỳ mục nào sau đây chưa đạt:

- [ ] `git diff` không có thay đổi ở frontend/views/CSS/Vite.
- [ ] Fresh PostgreSQL install từ database rỗng thành công.
- [ ] Tất cả 47 bảng, FK, unique/check và index quan trọng đã được xác minh.
- [ ] Golden API/websocket contract giống SQLite baseline.
- [ ] Visual regression không có thay đổi hiển thị đáng kể.
- [ ] Cross-tenant và personal/organization permission tests xanh.
- [ ] Concurrency tests không tạo lost update, duplicate latest, duplicate sync version hoặc audit fork.
- [ ] Chạy ≥ 2 instance và ≥ 2 worker/instance ổn định.
- [ ] Load/soak đạt SLO và không pool starvation/deadlock bất thường.
- [ ] Backup và restore drill đạt RPO/RTO.
- [ ] Failover/restart không làm mất job/websocket event hoặc làm hỏng audit.
- [ ] Runtime DB role không có DDL/superuser.
- [ ] TLS, secrets, cookie, CORS, proxy, rate limit và logging đã security review.
- [ ] Dashboard/alert/runbook PostgreSQL hoạt động và on-call đã diễn tập.
- [ ] SQLite runtime/script/metrics không còn nằm trong production package.
- [ ] Có rollback decision tree và point-of-no-return được phê duyệt.

## 18. Thứ tự ưu tiên thực tế để đạt tốc độ cao nhất

1. Khóa UI/API contract và dựng test trước; đây là cách giảm thời gian sửa regression về sau.
2. Chỉ hỗ trợ fresh install PostgreSQL; loại toàn bộ import/dual-write SQLite khỏi phạm vi.
3. Dùng Psycopg sync pool và adapter, không viết lại ORM/async trong cùng dự án.
4. Port theo lát dọc nghiệp vụ, hoàn thành và đo từng lát.
5. Xử lý audit, sync version, websocket và background leader trước khi tăng worker.
6. Dùng query plan và load data để chọn index; không tối ưu theo phỏng đoán.
7. Dựng managed PostgreSQL/backup/monitoring sớm để staging giống production.
8. Chỉ gỡ SQLite sau khi PostgreSQL qua soak và restore drill; không duy trì dual runtime lâu dài.

## 19. Các quyết định cần xác nhận trước Phase 0

Những câu hỏi này không chặn việc chuẩn bị test, nhưng phải được chốt trước khi sizing/cutover:

1. Nhà cung cấp/vùng triển khai PostgreSQL và yêu cầu lưu dữ liệu tại Việt Nam hay khu vực cụ thể.
2. Số người dùng đồng thời, số tổ chức, tốc độ tăng trưởng và kích thước dữ liệu 12/36 tháng.
3. RPO/RTO thương mại cam kết với khách hàng.
4. Chính sách retention audit, dữ liệu người dùng và tài liệu.
5. Có chấp nhận thêm managed Redis/object storage/job worker ngay lần phát hành đầu không.
6. Mức tải export Word/Excel và giới hạn kích thước file.
7. SLO chính thức và ngân sách hạ tầng.

## 20. Kết luận

Chuyển PostgreSQL là cần thiết để BiddingFlow vượt giới hạn một writer/một instance hiện tại. Đường đi nhanh và ít rủi ro nhất là fresh install PostgreSQL, giữ backend đồng bộ với Psycopg pool, khóa chặt hợp đồng API/UI, port SQL theo lát dọc và chỉ tăng concurrency sau khi các bất biến audit/sync/version đã có test.

Việc chuyển đổi chỉ được coi là hoàn tất khi giao diện không thay đổi, contract dữ liệu giống baseline, ứng dụng chạy nhiều instance ổn định, tải đạt SLO và quy trình backup–restore đã được diễn tập thành công.
