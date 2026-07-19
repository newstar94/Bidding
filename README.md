# BiddingFlow

Ứng dụng quản lý quy trình lựa chọn nhà thầu, gồm backend Starlette, PostgreSQL và frontend ES modules được build bằng Vite.

## Yêu cầu

- Python theo `.python-version`.
- PostgreSQL 17+.
- Node.js 24 khi build frontend hoặc đóng gói phát hành.
- HTTPS reverse proxy và volume mã hóa cho media/backup ở production.

## Cài đặt fresh

```bash
python -m pip install --require-hashes -r requirements.txt
npm ci
npm run build:secure
```

Tạo `.env` từ `.env.example`, cấu hình `DATABASE_URL` và tài khoản quản trị ban đầu. BiddingFlow chỉ hỗ trợ PostgreSQL; không có luồng nhập hay tương thích dữ liệu SQLite cũ.

Khởi tạo schema bằng credential migrator:

```bash
python scripts/manage_database.py
```

Sau đó khởi động ứng dụng bằng runtime role không có quyền DDL:

```bash
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --workers 4
```

Ở production, web worker chỉ được nhận `DATABASE_URL` của runtime role. Không đưa
`MIGRATOR_DATABASE_URL`, `DATABASE_ADMIN_URL` hay mật khẩu migrator/admin vào
environment của dịch vụ web. `DATABASE_AUTO_MIGRATE=false`,
`DATABASE_RUNTIME_ROLE` phải khớp username trong URL và
`DATABASE_PRIVATE_NETWORK_CONFIRMED=true` chỉ được đặt sau khi PostgreSQL đã bị
giới hạn vào private network. Startup sẽ truy vấn `pg_roles`, ownership và ACL;
dịch vụ từ chối chạy nếu role có `SUPERUSER`, `CREATEDB`, `CREATEROLE`,
replication, `BYPASSRLS`, role membership, quyền `CREATE/TEMP`, ownership DDL
hoặc quyền bảng ngoài CRUD.

Chỉ chuyển traffic khi cả `/health/live` và `/health/ready` trả 200.

## Mật khẩu và MFA

- Mật khẩu mới dùng Argon2id, tối thiểu 8 và tối đa 256 ký tự; mật khẩu PBKDF2 cũ chỉ được giữ để nâng cấp tự động ở lần đăng nhập thành công tiếp theo.
- `MFA_ENCRYPTION_KEY` là khóa Fernet 32 byte dùng mã hóa bí mật TOTP. Lưu khóa trong secret manager; không commit và không đổi khóa nếu chưa có quy trình giải mã/mã hóa lại các bí mật đang tồn tại.
- Super Admin bắt buộc thiết lập MFA ở lần đăng nhập đầu tiên. Tài khoản quản lý được khuyến nghị bật MFA trong trang **Thông tin tài khoản cá nhân**. Mã khôi phục chỉ hiển thị một lần và mỗi mã chỉ dùng một lần.
- Tài khoản đã bật MFA phải dùng luồng mật khẩu + TOTP/mã khôi phục; Google Sign-In không được dùng để bỏ qua yếu tố thứ hai.

Trước khi triển khai lên một loại máy chủ mới, chạy benchmark với đúng cấu hình production:

```bash
python scripts/benchmark_password_hash.py
```

Mốc kiểm tra mặc định yêu cầu p50 không thấp hơn 30 ms và p95 không vượt 1.000 ms. Trên máy phát triển dùng để triển khai thay đổi này, Argon2id 64 MiB, 3 vòng, parallelism 2 đo 5 mẫu với p50 khoảng 87 ms/hash và 81 ms/verify.

## Sandbox tài liệu trên Linux production

Mọi tác vụ DOCX/XLSX chạy trong Bubblewrap với mount root rỗng, namespace user/PID/network riêng, UID/GID sandbox không phải root và policy seccomp chặn socket, child process, `exec`, mount, tracing. Cài `bubblewrap` và `libseccomp` từ kho gói của hệ điều hành, sau đó cấu hình:

```text
APP_ENV=production
DOCUMENT_WORKER_SANDBOX=bwrap
DOCUMENT_WORKER_SANDBOX_EXECUTABLE=/usr/bin/bwrap
DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP=true
DOCUMENT_WORKER_SANDBOX_UID=65534
DOCUMENT_WORKER_SANDBOX_GID=65534
DOCUMENT_WORKER_TEMP_DIR=/var/tmp/biddingflow-document-worker
```

Tài khoản chạy web service phải là tài khoản không có quyền quản trị. Trước khi khởi động hoặc nhận traffic, bắt buộc chạy probe thật trên chính host:

```bash
python scripts/verify_document_sandbox.py
```

Probe phải xác nhận không mở được socket mạng/Unix, không tạo được child process, không thấy `.env`/`DATABASE_URL`, không còn capability và đang dùng UID sandbox. Mẫu [systemd](deploy/biddingflow.service.example) đã đặt probe ở `ExecStartPre`; probe thất bại thì dịch vụ không được khởi động.

## Phát triển cục bộ trên Windows

Script sau dùng PostgreSQL 17 portable đã giải nén tại `data/tools/postgresql17/pgsql`, tạo các database dev/test riêng và không in credential:

```powershell
python scripts/setup_local_postgres.py
python scripts/manage_database.py
pytest -q tests
```

`--reset` chỉ dùng cho các database cục bộ dùng một lần:

```powershell
python scripts/setup_local_postgres.py --reset
```

Khi reset, script giữ hai bí mật tách biệt trong `.env` bị Git ignore:
`ADMIN_PASSWORD` cho tài khoản Super Admin của ứng dụng và
`POSTGRES_LOCAL_ADMIN_PASSWORD` cho superuser PostgreSQL local. Secret không đạt
policy sẽ được xoay tự động nhưng không được in ra console.

## Xem dữ liệu PostgreSQL bằng DBeaver

PostgreSQL không lưu toàn bộ database trong một file `.db`. Để xem bảng, lọc dữ liệu và quan sát quan hệ trực quan, có thể dùng [DBeaver Community](https://dbeaver.io/download/) (miễn phí).

Môi trường PostgreSQL portable local cũng đã kèm pgAdmin. Có thể mở trực tiếp mà không cần cài thêm:

```powershell
& "D:\Bidding\data\tools\postgresql17\pgsql\pgAdmin 4\runtime\pgAdmin4.exe"
```

Các thông số kết nối bên dưới dùng được cho cả DBeaver và pgAdmin.

Sau khi cài DBeaver:

1. Chọn **New Database Connection** → **PostgreSQL**.
2. Nhập thông tin kết nối local mặc định:

   ```text
   Host:     127.0.0.1
   Port:     55432
   Database: biddingflow_dev
   Username: postgres
   Password: lấy từ POSTGRES_LOCAL_ADMIN_PASSWORD trong file .env
   ```

3. Chọn **Test Connection** rồi **Finish**. DBeaver có thể đề nghị tải PostgreSQL JDBC driver trong lần kết nối đầu tiên.
4. Mở cây dữ liệu:

   ```text
   biddingflow_dev
   └── Schemas
       └── public
           └── Tables
   ```

5. Nhấp phải vào một bảng → **View Data** → **All Rows**.

Các bảng thường dùng:

| Bảng | Nội dung |
|---|---|
| `tai_khoan` | Tài khoản người dùng |
| `to_chuc` | Tổ chức |
| `thanh_vien_to_chuc` | Thành viên và trạng thái làm việc trong tổ chức |
| `ke_hoach_lcnt` | Kế hoạch lựa chọn nhà thầu |
| `goi_thau` | Gói thầu |
| `hop_dong` | Hợp đồng |
| `audit_log` | Nhật ký audit chống sửa đổi |
| `database_metadata` | Phiên bản schema và định danh fresh installation |

Nếu chỉ cần quan sát, bật chế độ **Read-only** cho connection để tránh sửa hoặc xóa dữ liệu ngoài ý muốn. Không chỉnh sửa trực tiếp các bảng audit, metadata hoặc sync. PostgreSQL phải đang chạy, nhưng backend không bắt buộc phải chạy để DBeaver kết nối.

Thông tin trong bảng trên là mặc định của môi trường local do `scripts/setup_local_postgres.py` tạo. Nếu đã thay `DATABASE_URL`, hãy dùng host, port, database và username tương ứng trong `.env`. Không commit hoặc chia sẻ mật khẩu từ `.env`.

Tham khảo: [hướng dẫn tạo kết nối của DBeaver](https://dbeaver.com/docs/dbeaver/Create-Connection/).

## Backup và restore drill

```bash
python scripts/backup.py create
python scripts/backup.py verify --snapshot <thu-muc-backup>
python scripts/backup.py restore --snapshot <thu-muc-backup>
python scripts/backup.py drill --snapshot <thu-muc-backup>
```

`drill` bắt buộc dùng `RESTORE_DRILL_DATABASE_URL` khác database chính và tạo
marker ký Ed25519 để metrics vận hành xác minh. Web chỉ giữ public key; private
key chỉ thuộc service restore drill. Công cụ truyền credential qua biến môi
trường PostgreSQL, không đưa mật khẩu lên command line. Có thể dùng
`python scripts/backup.py drill-latest` cho lịch diễn tập tự động.

## Tạo gói production

```bash
npm run package:production
```

Artifact mặc định là `release/biddingflow-production.zip`. Allowlist loại `.env`, dữ liệu runtime, test, source frontend và công cụ SQLite cũ. Mẫu systemd, Nginx, Prometheus và Grafana nằm trong `deploy/`.

## Quy ước dữ liệu ngày giờ

- Cột ngày dùng PostgreSQL `DATE`, hợp đồng API giữ chuỗi `YYYY-MM-DD`.
- Cột thời điểm dùng `TIMESTAMPTZ`; database và mọi session SQL mặc định `Asia/Ho_Chi_Minh`, nên truy vấn/API hiển thị giờ Việt Nam theo chuỗi `YYYY-MM-DD HH:mm:ss`.
- Việc hiển thị do frontend hiện có đảm nhiệm và không thay đổi trong quá trình chuyển database.
