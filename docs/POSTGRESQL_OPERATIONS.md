# PostgreSQL production operations

Tài liệu này áp dụng cho lần cài mới BiddingFlow. Application runtime không được
nhận admin URL hoặc mật khẩu role quản trị PostgreSQL.

## Role và ranh giới quyền

| Role | Dùng cho | Quyền chính | Không được có |
|---|---|---|---|
| `bidding_migrator` | Startup migration có kiểm soát | `CONNECT`, `CREATE` database/schema, DDL và toàn quyền trên object ứng dụng | superuser, createdb, createrole, bypass RLS |
| `bidding_app` | HTTP/WebSocket/document runtime | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, dùng sequence | tạo schema/table, role hoặc database |
| `bidding_backup_monitor` | backup logical và monitoring | `pg_read_all_data`, `pg_monitor` | ghi dữ liệu hay DDL |
| operator/admin | chỉ trong secret store của pipeline vận hành | tạo/rotate ba role trên | không đưa vào `.env` của app |

Tổng connection limit mặc định của ba role là `2 + 50 + 5`. Phải đặt
`POSTGRES_POOL_MAX_SIZE × số application instance` thấp hơn giới hạn role app và
chừa headroom cho health check, rolling deploy và tác vụ khẩn cấp.

Connection budget chuẩn nằm tại
[`load/postgresql-connection-budget.json`](../load/postgresql-connection-budget.json).
Baseline dùng 2 application instance thường trực, 1 rolling-surge instance và
pool tối đa 10 connection/instance. Peak app dùng 30/45 connection khả dụng của
role app; tổng nhu cầu app + migration + monitoring + operator là 42, cộng 10
connection dự phòng vẫn còn 45/97 connection server. CI bắt buộc chạy:

```powershell
python scripts/validate_postgresql_connection_budget.py
```

Trước khi đổi số instance, pool, external DB worker, role `CONNECTION LIMIT` hoặc
`max_connections`, phải sửa file budget và để validator đạt. Không tăng pool để
che slow query; pool size chỉ được chốt sau mixed-load test. Số liệu nhà cung cấp
thật phải bằng hoặc lớn hơn baseline đã kiểm chứng trước khi mở traffic.

## Provision hoặc rotate credential

Chạy từ máy quản trị tin cậy. Dùng biến môi trường/secret injection để password
không xuất hiện trong command history; công cụ không in password. URL mặc định bắt
buộc hostname verification và CA verification bằng `sslmode=verify-full`.

```powershell
$env:BIDDING_POSTGRES_ADMIN_URL = 'postgresql://operator@db.example.internal/bidding?sslmode=verify-full&sslrootcert=C:/secure/postgresql-ca.pem'
$env:BIDDING_POSTGRES_MIGRATION_PASSWORD = '<secret mới>'
$env:BIDDING_POSTGRES_APP_PASSWORD = '<secret mới>'
$env:BIDDING_POSTGRES_MONITOR_PASSWORD = '<secret mới>'
python scripts/provision_postgresql_roles.py
```

Có thể đổi tên role bằng `BIDDING_POSTGRES_MIGRATION_ROLE`,
`BIDDING_POSTGRES_APPLICATION_ROLE` và `BIDDING_POSTGRES_MONITOR_ROLE`. Tên phải là
identifier lowercase an toàn và ba role phải khác nhau. Chạy lại cùng lệnh là
idempotent và sẽ rotate password.

Quy trình rotation không gián đoạn:

1. Chạy provision để đặt secret mới trên PostgreSQL.
2. Cập nhật secret version của migration/app/monitor trong secret manager.
3. Rolling restart application instance; theo dõi lỗi authentication và pool.
4. Chạy readiness, một mutation idempotent, pagination và export smoke.
5. Thu hồi secret version cũ khỏi secret manager và ghi audit vận hành.

Nếu nhà cung cấp hỗ trợ hai credential song song, ưu tiên tạo role app thế hệ mới,
grant cùng quyền, rolling restart rồi xóa role cũ sau cửa sổ rollback. Không log DSN
đầy đủ và không commit CA private material hoặc password.

## Runtime connection strings

Application process chỉ nhận hai URL:

```dotenv
BIDDING_DATABASE_URL=postgresql://bidding_app@db.example.internal/bidding?sslmode=verify-full&sslrootcert=/run/secrets/postgresql-ca.pem
BIDDING_MIGRATION_DATABASE_URL=postgresql://bidding_migrator@db.example.internal/bidding?sslmode=verify-full&sslrootcert=/run/secrets/postgresql-ca.pem
```

Production startup từ chối URL không phải `verify-full`, hai URL dùng cùng
host/port/database hoặc cùng username. Kết nối migration chỉ tồn tại trong lúc áp
schema; pool runtime tiếp tục dùng role app.

## Kiểm tra sau provision

```sql
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolconnlimit
FROM pg_roles
WHERE rolname IN ('bidding_migrator', 'bidding_app', 'bidding_backup_monitor');

SELECT has_schema_privilege('bidding_app', 'public', 'CREATE');
SELECT has_table_privilege('bidding_app', 'goi_thau', 'SELECT,INSERT,UPDATE,DELETE');
SELECT has_table_privilege('bidding_backup_monitor', 'goi_thau', 'SELECT');
SELECT has_table_privilege('bidding_backup_monitor', 'goi_thau', 'INSERT');
```

Kết quả bắt buộc: mọi cờ đặc quyền là false; app không có `CREATE` nhưng có DML;
monitor có `SELECT` và không có `INSERT`. CI integration tạo role tên ngẫu nhiên,
provision hai lần, kiểm tra ma trận trên PostgreSQL thật rồi xóa role.
