# Chuẩn hóa tìm kiếm tên gói thầu

Status: accepted for the package-list search repair.

## Decision

Tìm kiếm cục bộ trong danh sách gói thầu chuẩn hóa Unicode tiếng Việt trước khi
so sánh: tách dấu, quy đổi `đ/Đ` thành `d/D`, rồi so sánh không phân biệt hoa
thường. Mã gói thầu, tên gói thầu và nhãn người phụ trách dùng cùng quy tắc;
giá trị thiếu được coi là chuỗi rỗng.

Tìm kiếm vẫn chỉ xét các bản ghi đã được chọn bởi luồng dữ liệu và quyền hiện
hành. Với phân trang máy chủ, biểu thức tìm kiếm giữ phép bỏ dấu hiện hành
nhưng dùng `ILIKE` sau khi chuẩn hóa để xử lý đúng các chữ hoa tiếng Việt mà
locale PostgreSQL không hạ được (ví dụ `Đ` trong `Điều tra`). Thay đổi này
không thêm bộ lọc, không thay đổi tenant, assignment, record scope hay dữ liệu
được trả về.

## Compatibility and verification

Các truy vấn cục bộ có dấu hoặc không dấu giờ tìm thấy cùng một gói thầu và
không còn lỗi khi mã/tên gói thầu bị thiếu. Regression coverage kiểm tra tên
`Điều tra` qua biểu thức PostgreSQL của phân trang máy chủ, cùng với tên có dấu,
truy vấn không dấu và giá trị null trong local renderer.

Không cần migration dữ liệu. Nếu phát hiện khác biệt giữa local và server
pagination, sửa tại bộ lọc tương ứng sau khi tái hiện bằng cùng một query; không
đổi semantics quyền hoặc phạm vi dữ liệu để làm cho kết quả khớp.
