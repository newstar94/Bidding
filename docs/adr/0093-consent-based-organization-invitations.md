# ADR 0093: Vào tổ chức bằng lời mời có chấp nhận, bỏ tra cứu tài khoản theo email

- Ngày: 2026-10-22
- Trạng thái: Chủ sản phẩm chọn phương án D sau rà soát 2026-10
- Thay thế: luồng tra cứu `GET /api/organizations/membership-candidate`

## Bối cảnh

API tra cứu trả về họ tên của mọi tài khoản đã xác minh theo email cho người quản lý tổ chức. Vì ai cũng có thể tạo tổ chức và trở thành quản lý, API này cho phép dò email → họ tên → "có dùng BiddingFlow".

## Quyết định

1. Gỡ API tra cứu. Người quản lý mời bằng email, kèm tên hiển thị và số điện thoại do chính họ nhập. Phản hồi luôn như nhau, dù email có tài khoản hay không.
2. Lời mời có hiệu lực `ORGANIZATION_INVITATION_TTL_HOURS` (mặc định 168 giờ). Mỗi tổ chức gửi tối đa `ORGANIZATION_INVITATIONS_PER_DAY` (mặc định 50) lời mời/ngày. Gửi lại cùng email sẽ làm mới lời mời đang chờ.
3. Chỉ chủ email đã xác minh, đăng nhập bằng đúng email đó, mới thấy và chấp nhận/từ chối được lời mời. Khi chấp nhận, hệ thống chạy đúng luồng kích hoạt thành viên hiện có (hạn mức, audit, thông báo, broadcast). Thành viên được tạo với vai trò `employee` và dòng ma trận quyền mặc định giống trình duyệt của quản lý đã tạo trước đây: xem 6 module, `thongtinmothau` để trống.
4. Lời mời mất hiệu lực khi người mời không còn là quản lý tổ chức. Tài khoản quản trị nền tảng không vào tổ chức qua lời mời.
5. `POST /api/auth/users/add-to-org` vẫn dùng để sửa tên hiển thị/điện thoại của thành viên hiện tại và để thêm lại thành viên cũ. Thêm người chưa từng là thành viên trả `409 MEMBERSHIP_INVITATION_REQUIRED`, trừ quản trị nền tảng.
6. Tên hiển thị trong tổ chức (`thanh_vien_to_chuc.ten_nhan_su`) giữ nguyên ngữ nghĩa: do tổ chức đặt, sửa được bất cứ lúc nào, không đổi họ tên tài khoản.

## Không thay đổi

Quyền đọc bản ghi, module permission, assignment/record scope và dữ liệu thành viên mà quản lý đang xem sau khi người đó đã vào tổ chức đều không thay đổi.

## Tương thích và chuyển đổi

Schema v102 thêm bảng `organization_invitations` cùng chỉ mục. `DB_RUNTIME_MIN_SCHEMA_VERSION` = 102, nên cần chạy `scripts/manage_database.py` trước khi khởi động. Client cũ gọi API tra cứu sẽ nhận 404 và cần tải lại ứng dụng. Rollback: dừng ứng dụng, khôi phục bản trước; bảng mới không được bản cũ dùng tới.

## Regression seams

`tests/test_organization_invitations_postgres.py`, `tests/js/admin_employee_lookup.test.mjs`.
