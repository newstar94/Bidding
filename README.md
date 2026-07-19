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
