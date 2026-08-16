# ADR-007: Đối chiếu MSC có thẩm quyền được làm mới trường gói đã khóa

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu xử lý `PACKAGE_FIELD_LOCKED` cho dữ liệu nhập từ Mua Sắm Công

## Bối cảnh và quyết định

Từ trạng thái “Đang mời thầu”, các trường nền như phương pháp đánh giá bị khóa để ngăn sửa thủ công dữ liệu đã phát hành. Tuy nhiên, chính luồng import/resync Mua Sắm Công cũng đi qua sync validator này nên dữ liệu nguồn hợp lệ không thể bổ sung hoặc sửa sai khác còn thiếu.

BiddingFlow cho phép đối chiếu nguồn có thẩm quyền cập nhật các trường thuộc `lockedAfterInvitation` trên snapshot gói hiện hành. Ngoại lệ chỉ áp dụng cho ID gói nằm trong import session Mua Sắm Công đã được máy chủ khóa và xác thực revision/digest trong cùng transaction. `sourceRevision` do client tự khai, sync thông thường và thao tác sửa tay tiếp tục bị khóa. Quyết định này bổ sung ngoại lệ nguồn cho ADR-004; không thay đổi tính bất biến của phiên bản lịch sử.

## Tác động tương thích

- Import/resync MSC có thể làm mới `phuongPhapDanhGia` và các trường nền bị khóa khác mà canonical draft gửi lên.
- Sửa thủ công cùng các trường này từ “Đang mời thầu” trở đi vẫn trả `PACKAGE_FIELD_LOCKED`.
- Không thay đổi role, module permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.
- Không cho phép sửa phiên bản gói hay kế hoạch lịch sử; các guard `HISTORICAL_RECORD_IMMUTABLE` và `HISTORICAL_PARENT_IMMUTABLE` giữ nguyên.

## Migration strategy

Không cần migration schema hoặc rewrite dữ liệu. Quy tắc áp dụng ở lần người dùng nhập mới hoặc chủ động lấy lại dữ liệu từ Mua Sắm Công. Rollback bằng cách bỏ cờ đối chiếu nguồn khỏi validator trường khóa; dữ liệu đã được nguồn cập nhật vẫn là dữ liệu nghiệp vụ hợp lệ và không cần xóa.

## Regression tests

- `tests/test_sync_mutation_contract.py::test_invited_package_scheduling_fields_are_server_locked`
- `tests/test_sync_mutation_contract.py::test_manual_invited_package_evaluation_method_remains_server_locked`
- `tests/test_sync_mutation_contract.py::test_trusted_procurement_reconciliation_can_refresh_invited_locked_fields`
- `tests/test_procurement_import_sync_binding.py::test_preflight_returns_only_validated_import_package_ids`
