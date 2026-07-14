# Hướng dẫn Quản lý Code & Đóng gói Bảo mật Frontend (BiddingFlow)

Tài liệu này hướng dẫn cách quản lý dự án, phát triển tính năng mới (ví dụ Phiên bản 2) và cách đóng gói xáo trộn (obfuscate) mã nguồn Frontend để bảo mật trước người dùng cuối.

---

## 1. Cấu trúc thư mục phát triển
Dự án được phân chia rõ ràng thành:
*   **Thư mục phát triển (Source Code)**:
    *   `/frontend/`: To?n b? JavaScript ?ng d?ng, t? ch?c theo mi?n nghi?p v?.
    *   `/views/`: HTML, CSS, vendor v? t?i nguy?n t?nh c?ng khai.
    *   `/backend/`: API, x?c th?c, ??ng b?, t?i li?u, ??i t?c, DB v? helper d?ng chung.
    *   *Bạn luôn làm việc và chỉnh sửa code trực tiếp trên các thư mục này.*
*   **Thư mục phân phối (Distribution)**:
    *   `/dist/`: Chứa file mã nguồn Frontend đã được đóng gói, nén và xáo trộn (được tự động sinh ra bởi Vite khi chạy lệnh build).
    *   *Không chỉnh sửa trực tiếp các file trong thư mục này.*

---

## 2. Chuẩn bị môi trường trước lần chạy đầu tiên
Cần cài đặt Node.js trên máy tính của bạn, sau đó di chuyển vào thư mục dự án và cài đặt trình đóng gói:
```bash
# Cài đặt thư viện phát triển (Vite)
npm install
```

Backend dùng Python đúng phiên bản trong `.python-version`. Trên máy mới, cài dependency đã khóa hash bằng `python -m pip install --require-hashes -r requirements/dev.lock.txt`; production dùng `requirements/runtime.lock.txt`. Quy trình update, audit ba nguồn dependency, secret scan và SBOM xem tại [DEPENDENCIES.md](./DEPENDENCIES.md).

### Cau hinh `.env` bat buoc cho lan chay dau

Truoc khi khoi dong server lan dau, tao `.env` tu `.env.example` va dat toi thieu:

```env
ADMIN_PASSWORD=mat_khau_manh_cua_ban
ADMIN_NAME=Administrator
ADMIN_EMAIL=admin@localhost
DEFAULT_ORG_NAME=HTD
```

Neu `ADMIN_PASSWORD` bi bo trong, server se dung co che fail-fast va khong tao DB mac dinh. Dieu nay tranh viec vo tinh khoi tao he thong voi mat khau rong hoac yeu.

Sau khi khoi dong, he thong cung cap hai health check cho reverse proxy/orchestrator:

```text
GET /health/live   # process dang chay, khong phu thuoc DB
GET /health/ready  # chi san sang nhan traffic sau migration va DB checks
```

Neu migration, schema version, tai khoan quan tri hoac DB readiness khong hop le, startup se that bai va process khong duoc dua vao traffic.

### SQLite production, backup va phuc hoi

Production phai dat `BIDDING_DB_PATH` tai duong dan tuyet doi tren local persistent volume, ben ngoai source va moi thu muc dong bo file. Ung dung chi ho tro mot ASGI process khi dung SQLite va giu process lock de chan khoi dong nham instance thu hai. Upload, Word template, temp, log va backup dung cac thu muc/mount rieng theo `.env.example`.

Tao backup online va kiem tra restore bang:

```bash
python scripts/backup_database.py
python scripts/restore_database.py --backup /path/backup.db --destination /path/rehearsal.db
python scripts/check_database.py --database /path/rehearsal.db
```

Khong copy rieng file `.db` khi server dang chay. Quy trinh lap lich, retention, sao chep off-host va xu ly su co nam tai [QUY_TRINH_SAO_LUU_PHUC_HOI_DB.md](./QUY_TRINH_SAO_LUU_PHUC_HOI_DB.md).

Database mới được tạo duy nhất bởi migration `0001_clean_baseline`. Mỗi migration có `version`, `name`, SHA-256 `checksum` và `applied_at`; ứng dụng sẽ dừng nếu checksum, thứ tự version, table constraint hoặc foreign key bị drift. Migration đã áp dụng không được sửa: mọi thay đổi schema sau này phải thêm module `backend/db/migrations/mNNNN_*.py` kế tiếp. Baseline này cố ý không nâng cấp database legacy; khi thử nghiệm clean first-run, hãy dùng một file SQLite mới.

### Phạm vi sở hữu dữ liệu

- Tài khoản có membership tổ chức tạo và chỉnh sửa dữ liệu trong tổ chức đang hoạt động; client và API chỉ truyền ID workspace qua `X-Active-Org`, không dùng tên để định danh.
- Tài khoản chưa thuộc tổ chức nghiệp vụ nào tự động dùng một `personal` workspace riêng. Mọi bản ghi vẫn có `organization_id` để dùng chung FK, sync và cache, nhưng `owner_type = personal` và DB ràng buộc workspace đó với đúng `personal_owner_user_id`.
- Khi tài khoản được thêm vào ít nhất một tổ chức nghiệp vụ, workspace cá nhân bị ẩn và không thể chọn bằng header trực tiếp. Nếu mọi membership tổ chức bị gỡ, workspace cá nhân lại trở thành phạm vi mặc định.
- Workspace cá nhân không hỗ trợ thêm, xóa hoặc đổi vai trò thành viên. API `organizations` luôn trả DTO có `id`, `name`, `scope_type`, `role`, `status`; tên chỉ phục vụ hiển thị.

### Reverse proxy va IP tin cay

Khi production dat sau Nginx, dung mau `deploy/nginx-biddingflow.conf.example` va dat:

```env
TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
SUPER_ADMIN_IP_ALLOWLIST=203.0.113.10/32
PRIVILEGED_REAUTH_TTL_SECONDS=600
```

Nginx phai ghi de `X-Forwarded-For` bang socket client, xoa `Forwarded`/`X-Real-IP`, va ung dung phai khoi dong voi proxy header cua Uvicorn bi tat. Khong cong khai cong `8000`; chi reverse proxy duoc ket noi den cong nay. IP allowlist chi la lop phong thu phu: session super-admin va xac thuc lai mat khau van bat buoc cho moi mutation nhay cam.

### Worker xu ly Word/Excel

Import va export DOCX/XLSX duoc thuc hien trong subprocess tam, co timeout, gioi han bo nho/CPU, quota dong thoi va don dep thu muc sau moi tac vu. Sao chep nhom bien `DOCUMENT_WORKER_*` tu `.env.example` khi trien khai.

- Linux: chay dich vu bang tai khoan non-root. Neu process chinh buoc phai khoi dong bang root, dat `DOCUMENT_WORKER_UID`, `DOCUMENT_WORKER_GID` ve mot tai khoan rieng va bat `DOCUMENT_WORKER_REQUIRE_PRIVILEGE_DROP=true`.
- Windows: chay toan bo dich vu bang mot tai khoan service rieng khong nam trong nhom Administrators. Ung dung production se fail-fast neu phat hien tai khoan dang co quyen Administrator.
- Khong dat thu muc tam worker trong `views/`, `dist/` hoac mot thu muc public cua web server. Mac dinh he thong dung thu muc temp cua OS.

---

### Nhật ký runtime

Ứng dụng ghi `sync_error.log` và `export_error.log` vào `BIDDING_LOG_DIR` (mặc định `data/logs`), không ghi vào thư mục mã nguồn. Mỗi lỗi API có `requestId` trong response và header `X-Request-ID`; dùng giá trị này để đối chiếu log phía server. Cookie, token, email và nội dung tệp nhúng được che trước khi ghi.

Thiết lập `LOG_MAX_BYTES` và `LOG_BACKUP_COUNT` để giới hạn dung lượng và số bản log luân chuyển. Trong production, nên đặt `BIDDING_LOG_DIR` thành đường dẫn tuyệt đối trên runtime volume, chỉ cấp quyền đọc/ghi cho tài khoản chạy dịch vụ và áp dụng retention/thu thập log của hạ tầng.

### Giới hạn tài nguyên request

Ứng dụng kiểm tra số byte thực nhận từ ASGI stream, kể cả request chunked không có `Content-Length`. Các giới hạn JSON, sync và multipart tài liệu được cấu hình riêng bằng `REQUEST_MAX_JSON_BYTES`, `REQUEST_MAX_SYNC_BYTES` và `REQUEST_MAX_DOCUMENT_BYTES`; Nginx cũng phải giữ `client_max_body_size` và `client_body_timeout` như file mẫu trong `deploy/`.

Các lệnh gọi HTTP đồng bộ cũ chạy trong pool có giới hạn `BLOCKING_IO_MAX_WORKERS`/`BLOCKING_IO_MAX_QUEUE`. `/health/ready` trả thêm header về event-loop lag, số tác vụ I/O đang chạy, queue depth và tổng timeout để hệ thống giám sát thu thập.

## 3. Chạy thử local trong quá trình phát triển (Development Mode)
Trong quá trình code (ví dụ nâng cấp lên Phiên bản 2):
1.  Đảm bảo trong file cấu hình `.env` có thiết lập chế độ Debug:
    ```env
    APP_DEBUG=True
    ```
2.  Chạy server Python của bạn bình thường (`python backend/app.py`).
3.  Ở chế độ này, server Python sẽ load trực tiếp các file gốc `/frontend/app/app.js` để bạn dễ dàng chỉnh sửa và debug trên DevTools trình duyệt (không bị nén hay xáo trộn).

---

## 4. Đóng gói cho môi trường thực tế (Production Mode)
Khi các tính năng phiên bản mới đã chạy ổn định và bạn muốn đưa lên chạy chính thức (Product):

1.  **Chạy lệnh đóng gói mã nguồn**:
    ```bash
    npm run build
    ```
    *Vite sẽ tự động quét file `frontend/app/app.js`, gom tất cả mã nguồn liên quan và tạo ra file bundle nén tại `/dist/assets/appbundle.js`.*

2.  **Cấu hình môi trường Production**:
    Chuyển biến môi trường trong `.env` sang chế độ Production để server Python tự động nhận diện bản nén bảo mật:
    ```env
    APP_DEBUG=False
    ```
3.  **Kết quả**: Server Python sẽ tự động thay thế liên kết script module gốc thành file đóng gói `/dist/assets/appbundle.js`. Người dùng truy cập ngoài internet sẽ chỉ thấy một file JS duy nhất đã được thu gọn và xáo trộn tên biến.

---

## 5. Quy trình quản lý phiên bản chuyên nghiệp (V1, V2...)
*   **Sử dụng Git**:
    *   Nhánh `main` dùng cho phiên bản đang chạy ổn định (V1).
    *   Tạo một nhánh mới `git checkout -b version-2` để viết code tính năng mới cho V2.
    *   Sau khi test V2 thành công, merge nhánh `version-2` vào nhánh `main`.
*   **Lưu trữ**: 
    Thư mục `/dist/` và `node_modules/` đã được cấu hình trong `.gitignore` để không bị đẩy lên Git. Chỉ lưu mã nguồn gốc sạch do bạn viết để đảm bảo dung lượng gọn nhẹ.
