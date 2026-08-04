# BiddingFlow

BiddingFlow là ứng dụng quản lý quy trình lựa chọn nhà thầu. Hệ thống gồm frontend JavaScript/Vite, backend Starlette/Python, PostgreSQL, đồng bộ offline/outbox và worker xử lý tài liệu.

## Yêu cầu

- Python đúng phiên bản trong `.python-version` (hiện là Python 3.14).
- Node.js 24 và `npm` tương thích `package-lock.json`.
- PostgreSQL 17 hoặc phiên bản production đã được kiểm chứng.
- Linux có Bubblewrap/seccomp cho document worker production.

## Cấu trúc chính

- `backend/`: HTTP adapters, auth, sync, PostgreSQL, policy và document jobs.
- `frontend/`: ES modules theo feature; entrypoint tại `frontend/app/app.js`.
- `views/`: HTML partials, CSS và vendor assets được phục vụ tại runtime.
- `scripts/`: migration, backup/restore, benchmark, security và packaging.
- `tests/`: Python integration/unit và Node test suite.
- `deploy/`: checklist triển khai/rollback; secret thật không nằm trong repo.

## Fresh install cục bộ

```powershell
git clone https://github.com/newstar94/Bidding.git
cd Bidding
Copy-Item .env.example .env
python -m pip install -e '.[test]'
npm ci
python scripts/setup_local_postgres.py
python scripts/manage_database.py
npm run build:secure
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-proxy-headers
```

`setup_local_postgres.py` chỉ cần chạy một lần để tạo cụm PostgreSQL cục bộ. Ở các lần mở ứng dụng sau, lifecycle development tự khởi động cụm `data/postgresql17-data` trước khi kết nối và migration; không cần chạy lại lệnh setup. Có thể tắt bằng `DATABASE_AUTO_START_LOCAL=false`. Production và database từ xa không bao giờ được tự khởi động theo cơ chế này.

Không dùng secret mẫu ở production. Điền `APP_PUBLIC_URL`, `ALLOWED_HOSTS`, `CORS_ORIGINS`, `ALLOWED_WS_ORIGINS`, SMTP/OAuth và các URL PostgreSQL bằng secret manager. `DATABASE_AUTO_MIGRATE=false` là bắt buộc ở production; migration chạy bằng credential migrator trước khi chuyển traffic.

Tạo Super Admin bằng cơ chế bootstrap do `scripts/manage_database.py` thực hiện từ `ADMIN_PASSWORD`; không commit `.env` hoặc in password ra log.

## PostgreSQL và migration

Fresh install tạo schema chuẩn mới nhất trực tiếp. Hệ thống đang nâng cấp dùng registry bất biến trong `backend/db/upgrades.py`; không sửa migration đã phát hành.

```powershell
python scripts/manage_database.py
```

Trước migration production: tạo và verify backup, dừng write traffic nếu migration yêu cầu, chạy bằng `MIGRATOR_DATABASE_URL`, kiểm tra `/health/ready`, rồi mới cập nhật web/worker. Migration v28 sẽ dừng nếu các cột reviewer nghỉ hưu còn dữ liệu; export/backup và xử lý dữ liệu đó có chủ đích trước khi retry.

## Kiểm tra

```powershell
python -m compileall -q backend scripts tests
python -m pytest -q
node --test tests/js/*.test.mjs
npm run lint:security
npm run audit:vendor
npm run build:secure
npm run package:production
```

Các E2E cần PostgreSQL riêng, server đang chạy và credential trong `.env`:

```powershell
npm run test:auth-shell
npm run test:auth-roles-e2e
npm run test:offline-sync-e2e
npm run test:multi-assignee-e2e
npm run test:joint-venture-e2e
npm run test:lifecycle
```

## Document worker

Production đặt `DOCUMENT_WORKER_EXECUTION_MODE=external`. Web và worker dùng hai PostgreSQL role khác nhau; worker chạy dưới service account riêng, queue hữu hạn, timeout và sandbox Bubblewrap/seccomp. Chạy probe Linux trước khi mở traffic:

```bash
python scripts/verify_document_sandbox.py
sudo python scripts/verify_document_worker_deployment.py
```

Không truyền SMTP/OAuth, web runtime credential hay secret người dùng vào môi trường parser.

Validation artifact của luồng Excel kết quả được lưu dưới
`DOCUMENT_WORKER_TEMP_DIR/award-result-validations`, có TTL, quota và janitor.
Khi chạy nhiều máy web (`APP_INSTANCE_COUNT > 1`), thư mục này phải là private
shared storage có atomic rename/file locking và phải đặt
`AWARD_RESULT_ARTIFACT_SHARED_STORAGE_CONFIRMED=true`; startup production sẽ từ
chối cấu hình nhiều replica dùng local disk. Nhiều worker trên cùng một máy dùng
chung filesystem vẫn được hỗ trợ.

## Backup và restore

```powershell
python scripts/backup.py create
python scripts/backup.py verify --snapshot <snapshot>
python scripts/backup.py drill --snapshot <snapshot>
```

`drill` chỉ được trỏ tới `RESTORE_DRILL_DATABASE_URL` cách ly. Không restore đè production trong bước kiểm tra.

## Production package

```powershell
npm run package:production
```

Artifact `release/biddingflow-production.zip` dùng allowlist, có manifest SHA-256 và loại `.env`, source frontend, test, cache, upload, log, DB dump và source map. Giải nén package vào release directory chỉ đọc; mount media/temp/log bên ngoài artifact.

## Deploy và rollback

Xem [deploy/README.md](deploy/README.md). Tóm tắt:

1. Backup + verify, chạy migration bằng migrator role.
2. Giải nén artifact mới vào release directory versioned.
3. Khởi động document worker rồi web; kiểm tra live/ready và smoke test.
4. Chuyển traffic atomically.
5. Nếu lỗi ứng dụng, chuyển symlink/traffic về artifact trước. Không hạ schema tự động; dùng migration restore guidance và backup đã verify.

## Troubleshooting

- `CSRF_ORIGIN_REQUIRED`: browser/client phải gửi Origin hoặc Referer khớp exact `APP_PUBLIC_URL`; không sửa bằng cách tin header `Host`.
- `FULL_SYNC_REQUIRED`: xóa cursor local của workspace và chạy full pull; không xóa outbox chưa commit.
- `DATABASE_*_TIMEOUT`: kiểm tra pool wait, lock và statement timeout trước khi tăng pool.
- Package báo thiếu file: chạy `npm run build:secure` và xác nhận `README.md`, `deploy/`, `dist/.vite/manifest.json` tồn tại.
- Document job lỗi: kiểm tra queue, worker role, temp ownership và sandbox probe; không chạy parser trực tiếp trong ASGI để chữa cháy.
