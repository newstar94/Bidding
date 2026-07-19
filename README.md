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

Chỉ chuyển traffic khi cả `/health/live` và `/health/ready` trả 200.

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
   Password: lấy từ DATABASE_URL trong file .env
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

`drill` bắt buộc dùng `RESTORE_DRILL_DATABASE_URL` khác database chính và tạo marker HMAC để metrics vận hành xác minh. Công cụ truyền credential qua biến môi trường PostgreSQL, không đưa mật khẩu lên command line.

## Tạo gói production

```bash
npm run package:production
```

Artifact mặc định là `release/biddingflow-production.zip`. Allowlist loại `.env`, dữ liệu runtime, test, source frontend và công cụ SQLite cũ. Mẫu systemd, Nginx, Prometheus và Grafana nằm trong `deploy/`.

## Quy ước dữ liệu ngày giờ

- Cột ngày dùng PostgreSQL `DATE`, hợp đồng API giữ chuỗi `YYYY-MM-DD`.
- Cột thời điểm dùng `TIMESTAMPTZ`; database và mọi session SQL mặc định `Asia/Ho_Chi_Minh`, nên truy vấn/API hiển thị giờ Việt Nam theo chuỗi `YYYY-MM-DD HH:mm:ss`.
- Việc hiển thị do frontend hiện có đảm nhiệm và không thay đổi trong quá trình chuyển database.
