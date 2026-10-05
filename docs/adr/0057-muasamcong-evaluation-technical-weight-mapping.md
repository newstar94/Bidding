# ADR-0057: Ánh xạ trọng số kỹ thuật từ Mua Sắm Công

## Quyết định

Khi biểu mẫu E-HSMT của Mua Sắm Công có `formValue.method = "3"`, đọc
`formValue.txtK` và chuẩn hóa thành `technicalWeight` trong canonical. Giá trị
hợp lệ là số nguyên từ 0 đến 100; chuỗi số như `"80"` được chuẩn hóa thành
`80`. Nếu có nhiều biểu mẫu cùng phương pháp nhưng có trọng số khác nhau, từ
chối bundle với `PROCUREMENT_SCHEMA_CHANGED` để không nhập dữ liệu mâu thuẫn.

Canonical `technicalWeight` được ánh xạ vào trường hiện hành
`trongSoKyThuat` của gói thầu. Trọng số giá (`txtG`) không được lưu thêm; khi
cần tính điểm, hệ thống hiện hành suy ra từ `100 - trongSoKyThuat` theo
contract tính điểm.

Phương pháp `method = "2"` (Giá đánh giá hoặc Giá cố định tùy lĩnh vực) không
được suy diễn thành trọng số kỹ thuật. Các trường `giaThapNhat`, `giaCoDinh`,
`maxValue` và `txtG` vẫn được giữ trong raw bundle để có thể bổ sung mapping
khi có contract nghiệp vụ riêng.

## Tác động tương thích và chuyển đổi

- Bổ sung field nguồn `technicalWeight` vào merge, enrich từ TBMT, preview và
  reconciler; cột `goi_thau.trong_so_ky_thuat` đã tồn tại nên không cần
  migration phá dữ liệu.
- Bản ghi cũ không bị sửa hàng loạt. Nhập hoặc đồng bộ lại từ nguồn sẽ cập
  nhật trường theo quy tắc source-owned hiện hành.
- Tăng `mappingSchemaVersion` lên `biddingflow-muasamcong-mapping-v8` để
  bundle đã lưu có thể được nhận diện và tái xử lý.

## Kiểm thử hồi quy

- `method=3, txtK=80` cho canonical `technicalWeight=80` và draft
  `trongSoKyThuat=80`.
- Chấp nhận chuỗi số, từ chối giá trị ngoài khoảng/không nguyên và xử lý
  `null`/rỗng.
- Bảo toàn hành vi của `method=2`, phát hiện xung đột nhiều nguồn và kiểm tra
  đường lưu PostgreSQL, kế thừa snapshot, enrich kế hoạch và hiển thị form.
