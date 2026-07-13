# Global bridge còn giữ tạm thời

Ngày rà soát: 13/07/2026

Chỉ còn các bridge nền tảng sau được phép tồn tại trong production:

- `window.lucide`: tương thích thư viện icon và các module giao diện cũ. Mục tiêu loại bỏ: Giai đoạn 9, sau khi có icon adapter dùng chung.
- `window.fetch`: interceptor tập trung bổ sung workspace, CSRF và hàng xóa chờ đồng bộ cho các lời gọi API cũ. Mục tiêu loại bỏ: Giai đoạn 9, sau khi mọi lời gọi đã chuyển sang `apiClient`.

Command nghiệp vụ, cache ngày nghỉ, dữ liệu liên danh, trạng thái modal, tạo ID, auth state và controller reference không còn lưu trực tiếp trên `window`.

