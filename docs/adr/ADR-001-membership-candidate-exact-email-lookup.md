# ADR-001: Tra cứu ứng viên thành viên bằng email chính xác

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong hội thoại triển khai lỗi thêm nhân sự

## Bối cảnh

Quản lý tổ chức cần thêm một tài khoản đã đăng ký nhưng chưa thuộc tổ chức. API danh sách người dùng hiện chỉ trả các thành viên đã thuộc tổ chức, nên không thể dùng API đó để tìm ứng viên thêm mới.

## Quyết định nghiệp vụ

Quản lý đang hoạt động của một workspace tổ chức được phép tra cứu đúng một tài khoản bằng email khớp tuyệt đối để phục vụ thao tác thêm nhân sự. Endpoint chỉ trả `id`, `name`, `email` của tài khoản đang hoạt động và đã xác minh. Không hỗ trợ tìm gần đúng, prefix, wildcard hoặc liệt kê toàn cục.

Tra cứu bị giới hạn 20 lần/phút theo tài khoản thực hiện và được ghi audit bằng digest email; audit không lưu email tra cứu dạng rõ. Quản lý thông thường không nhận diện tài khoản nền tảng `super_admin` qua endpoint này.

## Phạm vi tương thích

- Không thay đổi `/api/auth/users`, danh sách thành viên hiện tại hoặc semantics role/module/record scope.
- Không cấp quyền đọc bản ghi nghiệp vụ hay trường dữ liệu nhạy cảm.
- Chỉ mở seam nhận diện tài khoản tối thiểu, khớp email tuyệt đối, cho quản lý workspace tổ chức.
- Luồng thêm thành viên tiếp tục được kiểm tra quota, subscription, tenant, vai trò và audit tại `/api/auth/users/add-to-org`.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Frontend chuyển từ lọc `/api/auth/users?email=...` sang `/api/organizations/membership-candidate?email=...`. Có thể rollback bằng cách trả frontend về endpoint cũ và gỡ route mới; dữ liệu membership đã tạo vẫn hợp lệ.

## Regression tests

- `tests/test_membership_candidate_lookup.py`
- `tests/js/admin_employee_lookup.test.mjs`

