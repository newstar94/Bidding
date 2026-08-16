# ADR-010: Cho phép cờ tùy chọn mua thêm từ kế hoạch MSC trước khi có chi tiết

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, qua yêu cầu sửa lỗi lưu revision `00` của `PL2600150284`

## Bối cảnh

Revision `00` của `PL2600150284` có 19 gói mang `additionalChoise = 1`. Snapshot `PLAN_PACKAGE_DETAIL` giữ đầy đủ danh sách phần/lô nhưng các trường chi tiết tùy chọn như `quantityAdd`, `percentageAdd`, `valueAdd`, đơn vị và số lượng đều chưa được MSC công bố. Các gói cũng chưa liên kết TBMT nên không có HSMT để bổ sung chi tiết.

BiddingFlow đang yêu cầu mọi gói có `tuyChonMuaThem = "Có"` phải có ít nhất một dòng `tuyChonMuaThemList`. Vì parser giữ đúng cờ nguồn nhưng không bịa dòng chi tiết, toàn bộ 19 gói bị từ chối khi commit revision nhập liệu.

## Quyết định nghiệp vụ

Trong transaction của một phiên nhập Mua Sắm Công đã được máy chủ xác thực, gói được phép giữ `tuyChonMuaThem = "Có"` với danh sách hạng mục rỗng khi nguồn chưa công bố chi tiết. Không tạo placeholder và không suy diễn hạng mục từ tên hoặc phần/lô.

Ngoại lệ chỉ áp dụng cho ID gói nằm trong `packageIds` của import session mà máy chủ đã khóa và xác thực. Gói nhập tay hoặc payload không có import authority hợp lệ vẫn bắt buộc khai báo ít nhất một hạng mục khi chọn “Có”. Quy tắc ngược vẫn giữ nguyên: gói chọn “Không” không được chứa danh sách tùy chọn.

Sau khi bản ghi nguồn đã được lưu, một thao tác chỉnh sửa thủ công tiếp theo không mang import authority phải bổ sung chi tiết nếu muốn tiếp tục lưu gói với cờ “Có”. Lần nhập hoặc đối chiếu nguồn có thẩm quyền sau này có thể bổ sung danh sách khi MSC công bố dữ liệu.

## Tác động tương thích

- `PL2600150284` và kế hoạch MSC cùng shape có thể commit mà vẫn giữ đúng cờ nguồn.
- Không thay đổi validator của gói nhập tay và không làm yếu quy tắc danh sách khi người dùng chủ động chỉnh sửa.
- Không thay đổi role, module permission, tenant, assignment, record scope, entitlement, masking hoặc dữ liệu người dùng được phép xem.
- Không thay đổi dữ liệu lịch sử và không tự động ghi đè danh sách tùy chọn đã có.

## Migration strategy

Không cần migration schema hoặc rewrite dữ liệu. Revision đang lỗi cần được lấy lại từ MSC hoặc lưu lại bằng import session còn hiệu lực sau khi backend reload. Rollback bằng cách bỏ cờ `allow_source_option_without_items` khỏi validator; raw snapshot và dữ liệu đã lưu không thay đổi.

## Regression tests

- `tests/test_sync_mutation_contract.py::test_trusted_msc_plan_option_flag_can_wait_for_unpublished_item_details`
- Replay snapshot thật `PL2600150284` revision `00`: 19 gói cờ “Có”, 0 lỗi thiếu hạng mục trong trusted import, trong khi cùng payload không có authority vẫn tạo 19 lỗi.
