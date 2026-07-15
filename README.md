# BiddingFlow

BiddingFlow là ứng dụng quản lý kế hoạch lựa chọn nhà thầu, gói thầu, đối tác, chuyên gia và hợp đồng. Backend dùng Starlette/SQLite; frontend là JavaScript module được đóng gói bằng Vite.

## Chạy lần đầu

Yêu cầu Node.js và phiên bản Python ghi trong `.python-version`.

```bash
npm ci
python -m pip install --require-hashes -r requirements/dev.lock.txt
```

Sao chép `.env.example` thành `.env`. Ở môi trường phát triển có thể đặt:

```env
APP_ENV=development
APP_DEBUG=True
APP_HOST=127.0.0.1
APP_PORT=8000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=mat_khau_khoi_tao_toi_thieu_8_ky_tu
ADMIN_NAME=Administrator
ADMIN_EMAIL=admin@example.com
DEFAULT_ORG_NAME=HTD
```

`ADMIN_PASSWORD` bắt buộc khi khởi tạo database rỗng. Baseline hiện tại dành cho hệ thống chạy lần đầu; sau khi production hoạt động, mọi thay đổi schema phải được thêm bằng migration mới, không sửa migration đã áp dụng.

Khởi động development:

```bash
python backend/app.py
```

Health check:

```text
GET /health/live
GET /health/ready
```

## Phạm vi sở hữu dữ liệu

- Thành viên thuộc tổ chức tạo và chỉnh sửa dữ liệu trong tổ chức đang chọn.
- Tài khoản không thuộc tổ chức nghiệp vụ nào dùng workspace cá nhân riêng.
- API xác định workspace bằng ID trong `X-Active-Org`; tên tổ chức chỉ dùng để hiển thị.
- Quản trị viên/quản lý có thể giao người phụ trách. Nếu bản ghi mới chưa có phân công, backend tự giao cho người tạo trong cùng transaction.
- Backend là nguồn chuẩn cho phân quyền, quan hệ cùng tenant và quy tắc nghiệp vụ.

## Quy ước thời gian

- Timestamp kỹ thuật lưu trong SQLite dùng UTC, định dạng `YYYY-MM-DD HH:MM:SS`; mọi lệnh ghi của ứng dụng dùng chung `utc_now_sql()`.
- Thời điểm hết hạn/thu hồi dùng Unix epoch giây vì chỉ phục vụ so sánh thời hạn.
- Ngày nghiệp vụ lưu `YYYY-MM-DD`; ngày giờ nghiệp vụ được chuẩn hóa thành `YYYY-MM-DD HH:MM:SS` trước khi ghi. Frontend chỉ đổi định dạng khi hiển thị.
- Timestamp trong log hoặc JSON mô tả thiết bị có thể dùng ISO 8601 kèm múi giờ; không dùng các giá trị này làm khóa sắp xếp DB.

## Build production

```bash
npm ci
npm run build
```

Vite tạo các bundle có tên kèm hash trong `dist/assets/` và tự code-split theo module. `dist/` là artifact sinh tự động, không chỉnh sửa trực tiếp và không commit. Minification/obfuscation chỉ làm mã khó đọc hơn, không phải ranh giới bảo mật; mọi bí mật và kiểm soát quyền phải nằm ở backend.

Production phải cấu hình tối thiểu:

```env
APP_ENV=production
APP_DEBUG=False
APP_SECURE_COOKIES=True
APP_PUBLIC_URL=https://bidding.example.com
BIDDING_SQLITE_SINGLE_WRITER=true
DATA_AT_REST_ENCRYPTION_CONFIRMED=true
```

Các đường dẫn DB, backup, upload, Word template, temp và log phải là đường dẫn tuyệt đối trên các volume runtime riêng theo `.env.example`. Không đặt SQLite trong OneDrive/Dropbox/Google Drive/iCloud.

DB, upload, Word template và backup phải nằm trên volume mã hóa ở tầng hệ điều hành hoặc nhà cung cấp block storage. Chỉ đặt `DATA_AT_REST_ENCRYPTION_CONFIRMED=true` sau khi đã kiểm tra mount/volume thực tế; production sẽ từ chối khởi động nếu chưa có xác nhận này. Mã hóa volume được chọn làm lớp bảo vệ dữ liệu-at-rest chính để SQLite vẫn giữ được unique index, tìm kiếm và khôi phục nhất quán. Không mã hóa riêng CCCD/chữ ký ở tầng ứng dụng trong baseline hiện tại; nếu threat model sau này yêu cầu tách khóa khỏi máy chủ DB, phải thiết kế thêm key management, rotation và blind index trước khi bật.

Dùng [cấu hình Nginx mẫu](deploy/nginx-biddingflow.conf.example) và [systemd unit mẫu](deploy/biddingflow.service.example). Chỉ Nginx được truy cập cổng backend `127.0.0.1:8000`; Uvicorn chạy đúng một worker và tắt tiếp nhận proxy header trực tiếp.

## Backup và phục hồi

Không sao chép file `.db` khi server đang ghi. Dùng SQLite online backup:

```bash
python scripts/backup_database.py
python scripts/restore_database.py --backup /path/backup.db --destination /path/rehearsal.db
python scripts/check_database.py --database /path/rehearsal.db
```

Backup phải được kiểm tra hash/integrity, sao chép sang nơi lưu mã hóa ngoài máy chủ và diễn tập restore trước khi mở traffic.

## Kiểm tra chất lượng

```bash
npm run lint
npm run test:unit
npm run test:api
npm run audit:modules
npm run audit:dead
npm run audit:vendor
npm run audit:secrets
npm run build
npm run audit:bundle
```

Hoặc chạy toàn bộ bằng `npm run check`. Test được giữ trong repository để xác minh thay đổi nhưng không được sao chép vào image/gói triển khai production.

Dependency production được khóa hash trong `requirements/runtime.lock.txt`; dependency phát triển nằm trong `requirements/dev.lock.txt` và `package-lock.json`. Không commit `.env`, database, log, upload người dùng, `node_modules/` hoặc `dist/`.
