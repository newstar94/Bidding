# ADR-019: Cố định hành động điều hướng ở đầu chi tiết gói thầu

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu giữ nút “Quay lại danh sách” không bị tên gói thầu dài đẩy xuống dưới

## Bối cảnh và quyết định

Header màn hình chi tiết gói thầu trước đây dùng flex có xuống dòng cho cả khối tiêu đề và khối hành động. Khi tên gói thầu dài, khối hành động bị chuyển sang hàng mới và xuất hiện ở phía dưới bên trái.

Quy tắc hiển thị mới chỉ áp dụng cho `#detail-workflow-card`:

- Header có hai cột: cột trái co giãn cho mã, phiên bản, trạng thái và tên gói thầu; cột phải vừa đủ cho các hành động.
- Nút “Quay lại danh sách” luôn nằm ở cột phải và được căn giữa theo chiều dọc của vùng header.
- Tên gói thầu dài chỉ xuống dòng trong cột trái và không làm thay đổi vị trí dọc của nút.
- Quy tắc flex dùng chung của các màn hình chi tiết khác được giữ nguyên.

## Tác động tương thích

- Không thay đổi nội dung dữ liệu, API, schema hay luồng điều hướng.
- Không thay đổi role, permission, tenant isolation, assignment scope, record scope, entitlement, masking hoặc quyền đọc dữ liệu.
- Các màn hình chi tiết kế hoạch, nhà đầu tư, nhà thầu và hợp đồng không bị ảnh hưởng vì CSS được giới hạn theo ID của thẻ chi tiết gói thầu.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Thay đổi có hiệu lực sau khi frontend mới được build và trình duyệt tải bản CSS có cache key mới.

## Regression tests

- `tests/js/package_detail_version_selector.test.mjs` kiểm tra với tên gói thầu dài rằng nút quay lại vẫn thẳng hàng ở đầu header, nằm trong cột phải và không tràn ngang.
- Cùng test xác nhận tên dài thực sự xuống nhiều dòng trong cột trái.
