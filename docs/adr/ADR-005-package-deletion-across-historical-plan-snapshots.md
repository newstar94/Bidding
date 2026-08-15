# ADR-005: Xóa gói thầu xuyên mọi snapshot kế hoạch

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong hội thoại xử lý `HISTORICAL_PARENT_IMMUTABLE` khi xóa gói thầu

## Bối cảnh

Snapshot gói thầu thuộc phiên bản kế hoạch lịch sử là bất biến đối với thao tác cập nhật. Policy xóa cũ chỉ miễn `HISTORICAL_PARENT_IMMUTABLE` khi một batch chứa đầy đủ một package family theo cùng `rootId` và có đại diện thuộc kế hoạch mới nhất.

Dữ liệu kế hoạch nhập trước đây có thể tạo snapshot của cùng gói với `rootId` khác nhau giữa các phiên bản kế hoạch. Khi người dùng yêu cầu xóa gói thầu, frontend có gửi hoặc cố tìm snapshot lịch sử nhưng backend vẫn xem đó là sửa dữ liệu lịch sử và từ chối.

## Quyết định nghiệp vụ

Delete là ngoại lệ có chủ đích đối với quy tắc đóng băng parent lịch sử:

- Bản ghi `goi_thau` được nêu đích danh trong delete batch được phép xóa dù parent plan là phiên bản lịch sử.
- Child/assignment của gói chỉ nhận ngoại lệ khi chính package parent cũng có trong cùng delete batch.
- Upsert, cập nhật, tạo phiên bản, xóa child độc lập và mọi mutation khác dưới kế hoạch lịch sử tiếp tục bị chặn như trước.

Frontend xóa tất cả snapshot có cùng `rootId`. Với dữ liệu legacy bị tách `rootId`, frontend đối chiếu trong cùng family kế hoạch bằng tên gói đã chuẩn hóa, nhưng chỉ khi tên đó là duy nhất trong từng snapshot kế hoạch; trường hợp mơ hồ không tự xóa nhầm gói khác.

## Phạm vi tương thích

- Không thay đổi role, module permission, tenant, assignment scope, record scope hoặc quyền đọc dữ liệu.
- Record-level write authorization, row-version conflict và kiểm tra tham chiếu xóa vẫn được áp dụng.
- Không mở quyền sửa dữ liệu lịch sử; ngoại lệ chỉ tồn tại bên trong use case delete.

## Migration strategy

Không cần migration schema. Bản ghi legacy không bị viết lại `rootId`; resolver xóa hỗ trợ chúng tại thời điểm thao tác. Dữ liệu tạo mới tiếp tục dùng lineage hiện hành.

Rollback bằng cách khôi phục guard complete-family cũ và bỏ fallback nhận diện split-root; không có dữ liệu mới cần rollback.

## Regression tests

- `tests/test_sync_mutation_contract.py::test_package_deletion_may_remove_historical_snapshots`
- `tests/test_sync_mutation_contract.py::test_historical_child_delete_exception_requires_parent_package_in_batch`
- `tests/js/package_delete_repairs_missing_plan_snapshot.test.mjs::legacy plan snapshots with split package roots are deleted as one package`
