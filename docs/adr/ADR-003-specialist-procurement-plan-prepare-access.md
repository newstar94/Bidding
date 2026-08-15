# ADR-003: Chuyên viên được chuẩn bị kế hoạch từ Mua sắm công

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong hội thoại xử lý lỗi 403 khi chuyên viên dùng “Lấy từ MSC”

## Bối cảnh

Khi chuyên viên mở biểu mẫu thêm mới kế hoạch và chọn “Lấy từ MSC”, endpoint
`POST /api/procurement/imports/plan/prepare` yêu cầu quyền `edit` trên phân hệ kế
hoạch. Chuyên viên có quyền xem phân hệ nhưng chưa được cấu hình quyền sửa vì
vậy nhận lỗi 403 “Không có quyền nhập kế hoạch trong workspace hiện tại” ngay ở
bước tra cứu nguồn.

Bước `prepare` chỉ đọc dữ liệu Mua sắm công, tạo preview và import session gắn
với đúng người dùng, tổ chức và workspace lease. Bước này chưa ghi kế hoạch vào
dữ liệu nghiệp vụ BiddingFlow.

## Quyết định nghiệp vụ

Thành viên đang hoạt động có quyền `view` phân hệ kế hoạch trong workspace được
phép dùng “Lấy từ MSC” để chuẩn bị bản nháp kế hoạch. Tính năng tra cứu này không
có capability riêng và không bị giới hạn cho quản lý tổ chức.

Quyền `view` chỉ cho phép tạo preview/import session. Khi người dùng lưu kế hoạch,
các kiểm tra hiện hành đối với tenant, membership, module write permission,
assignment, record scope, import-session authority và mutation validation vẫn
được áp dụng. Quyết định này không cấp quyền sửa hoặc xóa bản ghi hiện hữu.

## Phạm vi tương thích

- Chuyên viên có quyền xem kế hoạch không còn nhận 403 tại bước “Lấy từ MSC”.
- Người không có quyền xem phân hệ kế hoạch vẫn bị từ chối.
- Manager, personal workspace owner và người có quyền `edit` giữ nguyên hành vi.
- Không thay đổi masking, dữ liệu trả về sau khi đã qua authorization, tenant
  isolation, assignment scope hoặc record-level authorization.
- Luồng nhập TBMT, dữ liệu mở thầu và các phân hệ khác không thay đổi.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Triển khai backend mới là đủ. Có thể
rollback bằng cách trả permission action của route prepare từ `view` về `edit`;
preview/import session đã tạo vẫn bị ràng buộc theo tenant, user và workspace
lease và tự hết hạn theo retention hiện hành.

## Regression tests

- `tests/test_procurement_import_routes.py::test_employee_with_plan_view_access_may_prepare_muasamcong_plan`
- `tests/test_procurement_import_routes.py::test_plan_prepare_still_denies_member_without_plan_view_access`
