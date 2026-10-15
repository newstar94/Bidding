# BiddingFlow — production

Ứng dụng quản lý quy trình lựa chọn nhà thầu: backend Starlette/Python, PostgreSQL, frontend JavaScript/Vite và worker xử lý tài liệu.

## Yêu cầu

- Python theo `.python-version`; PostgreSQL 17 hoặc phiên bản đã được kiểm chứng.
- Node.js 24 để build frontend và chạy các tích hợp trình duyệt.
- Document worker production trên Linux sử dụng Bubblewrap/seccomp theo [hướng dẫn triển khai](deploy/README.md).

## Tạo gói production

```powershell
python -m pip install --require-hashes -r requirements.txt
npm ci
npm run package:production
```

Kết quả: `release/biddingflow-production.zip`. Công cụ đóng gói kiểm tra release ID và chỉ lấy các file runtime được cho phép. Cấu hình thật, dữ liệu, skill, mã nguồn frontend, tài liệu Markdown và private symbols được lưu ngoài ZIP.

`frontend/`, `vite.config.js` và các công cụ build được giữ để tái tạo gói production. Các bộ kiểm thử phát triển, E2E, báo cáo và file tạm đã được dọn khỏi bản làm việc này; có thể khôi phục từ lịch sử Git hoặc bản sao dọn dẹp.

## Triển khai và vận hành

Thực hiện theo [deploy/README.md](deploy/README.md) để cấu hình PostgreSQL, môi trường production, dịch vụ web, document worker, backup, smoke và rollback. Cài các phụ thuộc Node runtime bằng `npm ci --omit=dev` trong thư mục release theo hướng dẫn triển khai.

- [Cấu hình mẫu](deploy/production.env.example).
- [Thông số môi trường](deploy/environment-variables.reference).
- [Quy trình vận hành](deploy/runbooks/).
- [Tích hợp thanh toán production](docs/runbooks/payos-production-integration.md).
- [Các quyết định nghiệp vụ và kiến trúc](docs/adr/).
- [Quy tắc bảo toàn quyền và dữ liệu](AGENTS.md).

Dữ liệu vận hành trong `data/` và cấu hình `.env`, `.env.database.json` hiện có được giữ nguyên. Logo, mã nguồn, skill và các công cụ migration/backup/build cần thiết được giữ trong dự án.
