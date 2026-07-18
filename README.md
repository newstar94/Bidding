# BiddingFlow

Ứng dụng quản lý quy trình lựa chọn nhà thầu, gồm backend Starlette, SQLite và frontend ES modules được build bằng Vite.

## Yêu cầu hệ thống

- Python theo phiên bản trong `.python-version`.
- Node.js 24 khi phát triển hoặc tạo gói phát hành.
- HTTPS reverse proxy khi chạy production.
- Volume bền vững và được mã hóa cho database, media và backup.

## Phát triển và kiểm thử

```bash
python -m pip install --require-hashes -r requirements/dev.lock.txt
npm ci
npm run check
npm run test:e2e
```

API test luôn tạo database tạm riêng và không sử dụng database phát triển.

## Tạo gói production

```bash
npm run package:production
```

Artifact mặc định được tạo tại `release/biddingflow-production.zip`. Archive sử dụng allowlist, không chứa `.env`, database, test, source frontend, cache hoặc dependency phát triển.

## Cấu hình production

1. Giải nén archive vào thư mục ứng dụng chỉ đọc.
2. Cài dependency runtime:

   ```bash
   python -m pip install --require-hashes -r requirements.txt
   ```

3. Tạo `.env` từ `.env.example` ở bên ngoài source control.
4. Cấu hình tối thiểu:

   - `APP_ENV=production`
   - `APP_DEBUG=False`
   - `APP_SECURE_COOKIES=True`
   - `APP_PUBLIC_URL=https://<ten-mien>`
   - `CORS_ORIGINS` và `ALLOWED_WS_ORIGINS` đúng bằng public URL
   - `BIDDING_DB_PATH` trỏ tới volume dữ liệu bền vững
   - Hoặc `BIDDING_DATABASE_URL` trỏ tới PostgreSQL qua TLS; URL này được ưu tiên hơn SQLite
   - `DATA_AT_REST_ENCRYPTION_CONFIRMED=true` sau khi xác minh mã hóa volume
   - `SUPER_ADMIN_IP_ALLOWLIST` và `TRUSTED_PROXY_CIDRS` theo hạ tầng thực tế

5. Với database mới, cấu hình `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_EMAIL` và `DEFAULT_ORG_NAME` để bootstrap lần đầu.
6. Khởi động qua Uvicorn/systemd theo mẫu trong `deploy/`.
7. Chỉ chuyển traffic khi `/health/ready` trả thành công.

## Backup và kiểm tra database

```bash
python scripts/check_database.py --database <duong-dan-db>
python scripts/backup_database.py --help
python scripts/restore_database.py --help
```

Luôn diễn tập restore trên môi trường tách biệt trước khi phát hành. Không sao chép database phát triển để khởi tạo production.

## Quy ước ngày giờ

- Ngày lưu trong database: `YYYY-MM-DD`.
- Thời điểm lưu trong database: `YYYY-MM-DD HH:mm:ss`.
- Hiển thị tiếng Việt: ngày có hai chữ số; tháng `01`, `02` có số 0, tháng `3`–`12` không thêm số 0.
- Thời điểm hiển thị: `HH:mm ngày dd/M/yyyy` theo quy tắc tháng trên.
