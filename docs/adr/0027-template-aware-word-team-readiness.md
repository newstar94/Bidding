# ADR 0027 — Chỉ kiểm tra tổ chuyên gia, tổ thẩm định khi xuất mẫu Word có sử dụng

- Trạng thái: Chấp nhận
- Ngày: 2026-08-30
- Phạm vi: Lưu gói thầu, vòng đời chỉnh sửa tổ và Xuất bản Word

## Bối cảnh

Luồng tạo/lưu gói thầu từng buộc tổ đang hiển thị phải có một Tổ trưởng; backend
cũng từ chối danh sách tổ đã chọn nhưng không có đúng một Tổ trưởng. Giao diện còn
khóa hai tổ từ bước đã mở thầu. Điều này buộc khai báo nhân sự quá sớm, kể cả khi
người dùng chưa xuất văn bản nào có trường tổ chuyên gia hoặc tổ thẩm định.

Chủ sản phẩm xác nhận tổ chuyên gia và tổ thẩm định là thông tin có thể bổ sung,
thay đổi đến bước Kết quả lựa chọn nhà thầu. Yêu cầu về tính sẵn sàng của tổ chỉ
được cảnh báo lúc xuất file Word thực sự sử dụng trường tương ứng.

## Quyết định

1. Tạo và lưu gói thầu không yêu cầu chọn thành viên, không yêu cầu danh sách tổ
   phải có đúng một Tổ trưởng.
2. Hai tổ được chỉnh sửa ở mọi trạng thái từ Chuẩn bị đến Đã có kết quả, gồm cả
   Đã có kết quả một phần. Gói Hủy thầu và màn hình chỉ đọc vẫn không cho sửa.
3. Khi Xuất bản Word có `publicationType`, backend đọc chính các root Jinja trong
   những file được người dùng chọn. Chỉ file tham chiếu `to_chuyen_gia`,
   `to_tham_dinh` hoặc alias mapping có source table tương ứng mới kích hoạt kiểm
   tra tổ đó.
4. Tổ được file tham chiếu phải có ít nhất một thành viên và đúng một Tổ trưởng.
   Nếu chưa sẵn sàng, lượt xuất không được tạo và UI hiển thị cảnh báo chỉ rõ tổ
   còn thiếu. File không dùng trường tổ tiếp tục xuất bình thường.
5. Kiểm tra này không áp dụng cho endpoint Word legacy không truyền
   `publicationType`.
6. Không thay đổi role, module permission, assignment scope, record scope,
   entitlement xuất Word hoặc dữ liệu người dùng được phép xem.

## Compatibility impact

- Payload gói thầu trước đây bị từ chối vì tổ không có Tổ trưởng nay được lưu.
- Gói đã mở thầu/đang chấm thầu/đã có kết quả cho phép cập nhật riêng dữ liệu hai
  tổ trong form; các trường đã khóa theo lifecycle vẫn giữ nguyên.
- Một lượt Xuất bản Word có thể nhận HTTP 422 mới nếu file đã chọn dùng trường tổ
  nhưng tổ tương ứng chưa sẵn sàng. Mẫu không dùng trường tổ không bị ảnh hưởng.
- Việc phát hiện theo nội dung từng file giữ đúng hành vi khi một chức năng được
  gán nhiều mẫu hoặc người dùng chỉ chọn một phần số mẫu đó.

## Migration và rollout

- Không có thay đổi schema hoặc migration dữ liệu.
- Không tự sinh thành viên, Tổ trưởng hoặc sửa dữ liệu tổ hiện hữu.
- Frontend và backend nên được rollout đồng bộ để mã cảnh báo HTTP 422 được trình
  bày bằng hộp cảnh báo chuyên biệt thay vì lỗi xuất chung.

## Rollback strategy

- Rollback đồng bộ frontend/backend để khôi phục validation lúc lưu và mốc khóa
  cũ. Không cần rollback dữ liệu hoặc schema.
- Dữ liệu tổ trống đã lưu trong thời gian áp dụng vẫn là payload hợp lệ về cấu
  trúc; nếu quay lại contract cũ, người dùng phải bổ sung tổ trước lần lưu kế tiếp.

## Regression seams

- `tests/test_sync_mutation_contract.py`: lưu gói không đòi Tổ trưởng.
- `tests/js/package_team_policy.test.mjs`: hai tổ sửa được đến Đã có kết quả,
  nhưng không sửa ở gói hủy/màn hình chỉ đọc.
- `tests/test_word_publication_team_policy.py`: chỉ root/alias thực sự được mẫu
  chọn tham chiếu mới yêu cầu tổ, và mỗi tổ được yêu cầu phải có đúng một Tổ trưởng.
- `tests/js/word_publication_job.test.mjs`: mã cảnh báo từ API được giữ lại để UI
  phân biệt với lỗi xuất Word thông thường.
