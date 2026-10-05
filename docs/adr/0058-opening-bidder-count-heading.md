# ADR-0058: Số lượng nhà thầu trong tiêu đề biên bản mở thầu

## Quyết định

Theo yêu cầu của chủ sản phẩm, tiêu đề danh sách trong biên bản mở thầu hiển
thị `Danh sách N Nhà thầu tham dự & Nộp hồ sơ`, với `N` là số nhà thầu của
gói thầu đang được chọn. Đối với chỉ định thầu rút gọn và lựa chọn nhà thầu
trong trường hợp đặc biệt, giữ cách gọi hiện hành và bổ sung số lượng thành
`Danh sách N Nhà thầu`.

Số lượng được tính trên toàn bộ dữ liệu mở thầu đã lưu của gói đang chọn,
không phụ thuộc trang bảng hiện tại. Dùng quy tắc nhận diện nhà thầu đã có
trong phần nhập biên bản mở thầu: mã liên danh hoặc mã nhà thầu, sau đó mới
dùng tên nếu thiếu mã; bỏ khoảng trắng và so sánh không phân biệt chữ hoa,
chữ thường. Cùng một nhà thầu dự nhiều phần lô chỉ được đếm một lần; liên
danh có mã nhận diện riêng được đếm như một nhà thầu tham dự.

Tiêu đề được tính lại khi render hoặc mở lại biên bản, bao gồm sau khi lưu.
Khi chưa có nhà thầu đã lưu, số lượng là `0`; dòng nhập trống mặc định không
được tính. Thao tác đang sửa bản nháp không thay đổi số lượng đã lưu.

## Tác động tương thích và chuyển đổi

- Bổ sung số lượng vào tiêu đề, giữ nguyên các dòng dữ liệu và phân trang.
- Không đổi quyền, tenant, assignment scope hoặc dữ liệu nhà thầu hiện có.
- Không thay đổi số lượng trong tài liệu Word hoặc các màn hình khác.
- Không có schema hay dữ liệu cần chuyển đổi. Dữ liệu cũ được tính lại khi
  người dùng mở biên bản.

## Kiểm thử hồi quy

- Fixture trình duyệt nhập một nhà thầu, lưu và mở lại biên bản phải có tiêu
  đề `Danh sách 1 Nhà thầu tham dự & Nộp hồ sơ` cho cả hai thứ tự mount tab.
- Kiểm thử helper hiện hành xác nhận hai dòng của cùng nhà thầu ở các phần
  lô khác nhau và một nhà thầu khác cho kết quả `2`.
