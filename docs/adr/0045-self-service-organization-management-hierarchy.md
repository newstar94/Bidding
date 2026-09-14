# Tổ chức tự tạo và quản lý tối cao

- Trạng thái: Accepted
- Ngày: 2026-09-14

Người dùng đã đăng nhập có thể tạo một tổ chức bằng mã số thuế và tên viết tắt; mã số thuế duy nhất ở cấp hệ thống được bảo vệ bằng unique index và transaction. Người tạo được ghi nhận là quản lý tối cao, khác với Super Admin nền tảng; chỉ quản lý tối cao được bổ nhiệm hoặc thu hồi quản lý. Thu hồi chuyển người được bổ nhiệm về `employee`, không xóa thành viên hay thay đổi nhiệm vụ hiện có. Mọi kiểm tra tenant, session, module, assignment và audit hiện hành vẫn được giữ nguyên.

## Compatibility impact

Hai trường nhận diện tổ chức được bổ sung nullable để tương thích dữ liệu cũ. Tổ chức cũ không có quản lý tối cao được xử lý theo cơ chế manager hiện hành cho đến khi được xác định bổ sung; không tự gán chủ sở hữu hồi tố.

## Regression

Kiểm tra tạo tổ chức nguyên tử, mã số thuế trùng và cạnh tranh, người tạo là quản lý tối cao, phân quyền quản lý chỉ bởi chủ thể này, thu hồi về employee giữ nhiệm vụ, và cấm quản lý được bổ nhiệm giao việc cho quản lý ngang hàng hoặc tối cao.
