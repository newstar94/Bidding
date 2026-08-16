# ADR-015: Bộ chọn phiên bản gói thầu phải tồn tại qua mọi lần render chi tiết

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu sửa lỗi dropdown phiên bản biến mất khi chuyển qua lại giữa `01` và `00`

## Bối cảnh và quyết định

Màn hình chi tiết gói thầu được render lại khi người dùng đổi phiên bản hoặc đổi tab. Bộ chọn phiên bản dùng component combobox thay thế cho thẻ `select` gốc.

Khi kết thúc một lần render, màn hình phải hủy combobox qua API vòng đời của component trước khi khởi tạo lần tiếp theo. Không được chỉ xóa phần tử HTML thay thế trong khi vẫn giữ đối tượng combobox cũ trên thẻ `select`, vì lần render sau sẽ refresh một component đã rời khỏi DOM và làm dropdown biến mất.

Bộ chọn phiên bản phải tiếp tục hiển thị sau mọi chuỗi chuyển phiên bản, bao gồm `01 → 00 → 01`, đồng thời giữ đúng phiên bản được chọn và toàn bộ tùy chọn do view model cung cấp.

## Tác động tương thích

- Không thay đổi cách xác định dòng phiên bản, snapshot kế hoạch hoặc phiên bản gói thầu được phép xem.
- Không thay đổi dữ liệu, API, schema, role, permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.
- Các dropdown dùng chung khác tiếp tục sử dụng cùng component và API hiện hành.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Bản sửa có hiệu lực khi frontend mới được build và triển khai.

## Regression tests

- `tests/js/package_detail_version_selector.test.mjs` — `package detail version selector survives switching from version 01 to 00`
- Test thực hiện hai lần bind/dispose liên tiếp bằng trình duyệt thật, kiểm tra dropdown vẫn có mặt, chọn `00` và giữ đủ hai tùy chọn.
