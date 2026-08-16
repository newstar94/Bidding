# ADR-016: Dropdown nở theo nội dung chỉ tại các phạm vi được chỉ định

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu sửa cách hiển thị dropdown ở chi tiết kế hoạch và hai bộ lọc Trạng thái, Hình thức của danh sách gói thầu

## Bối cảnh và quyết định

Dropdown tùy biến trước đây luôn ép danh sách bằng chiều rộng của ô chọn và hiển thị lựa chọn dài trên một dòng với dấu `...`. Điều này làm các lựa chọn trạng thái và hình thức lựa chọn nhà thầu khó đọc.

Quy tắc hiển thị mới:

- Dropdown phiên bản tại chi tiết kế hoạch, bộ lọc `Trạng thái` và bộ lọc `Hình thức` tại danh sách gói thầu được gắn rõ `data-dropdown-fit-content="true"`.
- Với các dropdown này, danh sách có chiều rộng bằng giá trị lớn hơn giữa chiều rộng ô chọn và chiều rộng nội dung dài nhất cộng padding/viền.
- Chiều rộng viewport chỉ là giới hạn tối đa khi nội dung thực sự quá dài; không được dùng viewport làm chiều rộng mục tiêu. Danh sách giữ khoảng cách tối thiểu 8 px với mép màn hình.
- Các dropdown khác giữ chiều rộng của ô chọn; lựa chọn quá dài được xuống dòng, không cắt bằng dấu `...`.
- Ô chọn đóng vẫn giữ kích thước bố cục hiện tại; quy tắc chỉ áp dụng cho danh sách khi mở.

## Tác động tương thích

- Không thay đổi giá trị lựa chọn, sự kiện `change`, khả năng tìm kiếm, điều khiển bàn phím hoặc thuộc tính trợ năng.
- Không thay đổi dữ liệu, API, schema, role, permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.
- Dropdown có nội dung ngắn giữ nguyên kích thước nhìn thấy.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Frontend mới áp dụng quy tắc sau khi build và triển khai.

## Regression tests

- `tests/js/custom_select_label.test.mjs` — xác nhận bộ lọc Trạng thái và Hình thức được gắn chế độ nở theo nội dung.
- `tests/js/custom_select_label.test.mjs` — xác nhận dropdown thông thường xuống dòng trong chiều rộng ô chọn.
- `tests/js/custom_select_label.test.mjs` — xác nhận dropdown được chỉ định nở theo nội dung nhưng không tràn viewport.
- `tests/js/custom_select_accessibility.test.mjs` — xác nhận hành vi bàn phím và nhãn trợ năng không thay đổi.
