# ADR-018: Backspace xóa nhanh nhãn hiện tại của dropdown có tìm kiếm

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu bổ sung thao tác click rồi nhấn Backspace để tìm kiếm mới

## Bối cảnh và quyết định

Dropdown có tìm kiếm hiển thị nhãn của lựa chọn hiện tại trong ô nhập. Sau khi click, con trỏ có thể nằm cuối nhãn nên Backspace mặc định chỉ xóa một ký tự, khiến người dùng phải xóa thủ công toàn bộ trước khi nhập từ khóa mới.

Quy tắc mới:

- Khi dropdown có `searchable = true` đang hiển thị đúng nhãn lựa chọn hiện tại, thao tác click/focus sẽ chuẩn bị chế độ xóa nhanh.
- Lần nhấn `Backspace` đầu tiên xóa toàn bộ nhãn tìm kiếm, hiển thị lại đầy đủ lựa chọn và gọi truy vấn tìm kiếm với chuỗi rỗng.
- Việc xóa ô tìm kiếm không tự thay đổi giá trị của thẻ `select`; giá trị chỉ đổi khi người dùng chọn một lựa chọn mới.
- Sau khi người dùng bắt đầu nhập truy vấn mới, Backspace trở lại hành vi chuẩn và chỉ xóa từng ký tự.
- Dropdown không có tìm kiếm không bị ảnh hưởng.

## Tác động tương thích

- Giữ nguyên sự kiện `change`, điều khiển phím mũi tên, Enter, Escape, trạng thái disabled và thuộc tính trợ năng combobox/listbox.
- Không thay đổi dữ liệu, API, schema, role, permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Hành vi có hiệu lực sau khi frontend mới được build và triển khai.

## Regression tests

- `tests/js/custom_select_accessibility.test.mjs` — click rồi Backspace xóa toàn bộ nhãn đã chọn và hiển thị lại toàn bộ lựa chọn.
- Cùng test xác nhận giá trị native select chưa đổi cho đến khi chọn mới.
- Cùng test xác nhận Backspace chỉ xóa một ký tự sau khi người dùng bắt đầu nhập truy vấn mới.
