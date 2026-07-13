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

### Cau hinh `.env` bat buoc cho lan chay dau

Truoc khi khoi dong server lan dau, tao `.env` tu `.env.example` va dat toi thieu:

```env
ADMIN_PASSWORD=mat_khau_manh_cua_ban
ADMIN_NAME=Administrator
ADMIN_EMAIL=admin@localhost
DEFAULT_ORG_NAME=HTD
```

Neu `ADMIN_PASSWORD` bi bo trong, server se dung co che fail-fast va khong tao DB mac dinh. Dieu nay tranh viec vo tinh khoi tao he thong voi mat khau rong hoac yeu.

---

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
