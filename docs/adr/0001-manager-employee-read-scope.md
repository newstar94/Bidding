---
status: accepted
---

# Quản lý ở chế độ Chuyên viên kế thừa quyền xem

Khi thành viên có vai trò quản lý trong tổ chức chủ động chọn chế độ Chuyên viên, hệ thống kế thừa quyền xem các phân hệ để tài khoản có thể đọc bản ghi được phân công. Quyền quản lý và quyền sửa không được kế thừa; tenant isolation, module boundary, assignment scope, record scope, session checks và audit tiếp tục áp dụng.

## Compatibility impact

Trước quyết định này, backend yêu cầu permission matrix riêng nên quản lý ở chế độ Chuyên viên có thể nhận assignment nhưng API vẫn trả rỗng. Sau thay đổi, họ đọc được bản ghi được phân công và dữ liệu tham chiếu thuộc các phân hệ có quyền xem kế thừa; bản ghi không được phân công vẫn bị từ chối và mọi thao tác sửa vẫn cần quyền `edit` rõ ràng.

## Migration strategy

Không cần đổi schema hoặc backfill permission matrix. Policy được tính từ membership quản lý và vai trò hoạt động trên mỗi request; lần chuyển vai trò phải tải lại snapshot authoritative để loại dữ liệu cache của scope cũ. `VISIBILITY_POLICY_VERSION` được tăng từ 4 lên 5 để client đã triển khai tự vô hiệu projection hiển thị cũ và đồng bộ lại theo policy mới.

## Regression seams

Kiểm thử bắt buộc bao phủ quyền xem kế thừa, từ chối quyền sửa kế thừa, vẫn tôn trọng quyền `edit` được cấp rõ ràng, cho phép đọc bản ghi được phân công và từ chối bản ghi không được phân công ở cả policy backend lẫn model frontend.
