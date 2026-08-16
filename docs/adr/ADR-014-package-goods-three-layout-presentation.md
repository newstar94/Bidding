# ADR-014: Danh mục hàng hóa có ba cách trình bày theo cấu trúc phần lô

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu phân biệt cách trình bày hàng hóa không phân lô, một lô một mặt hàng và một lô nhiều mặt hàng

## Bối cảnh và quyết định

Danh mục hàng hóa phải phản ánh đúng cấu trúc nghiệp vụ đã được chuẩn hóa, không trình bày mọi gói có phân lô theo cùng một kiểu phân cấp:

- Gói không phân lô: mỗi mặt hàng là một dòng phẳng, đánh số `1`, `2`, ... và không có cột dữ liệu phần lô.
- Một lô có đúng một mặt hàng: hiển thị một dòng kết hợp gồm số thứ tự lô, mã phần lô, tên phần lô, tên hàng hóa, đơn vị tính, khối lượng và thao tác. Không tạo thêm dòng tiêu đề lô hoặc dòng con `x.1`.
- Một lô có nhiều mặt hàng: hiển thị dòng tiêu đề lô, sau đó là các dòng hàng hóa con đánh số `x.1`, `x.2`, ...

Việc xác định lô có một hay nhiều mặt hàng dựa trên toàn bộ danh mục hàng hóa của gói, không dựa riêng vào tập dòng còn nhìn thấy sau khi tìm kiếm, lọc hoặc phân trang.

Quyết định này chỉ thay đổi mô hình trình bày. `phanLoId`, danh sách phần lô, danh sách hàng hóa và dữ liệu canonical từ Mua Sắm Công được giữ nguyên.

## Tác động tương thích

- Gói một lô một mặt hàng trở nên gọn hơn và không còn bị trình bày giống một lô nhiều mặt hàng.
- Gói không phân lô và lô nhiều mặt hàng giữ nguyên semantics hiện hành.
- Chức năng thêm, sửa, xóa, lọc, tìm kiếm, phân trang, nhập và xuất Excel tiếp tục dùng cùng bản ghi hàng hóa và phần lô.
- Không thay đổi role, permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Giao diện tự chọn cách trình bày từ danh sách hàng hóa hiện có khi render lại.

## Regression tests

- `tests/js/package_goods.test.mjs` — `goods display keeps one-lot-many nested and collapses one-lot-one into one row`
- `tests/js/package_goods.test.mjs` — `goods display uses the complete lot size when a multi-item lot is filtered`
- `tests/js/package_goods.test.mjs` — `goods sequence is generated from row order instead of the editable goods code`
