# ADR-025: Mở thầu không chặn nhà thầu trước ngày hiệu lực đầu tiên

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu không khóa mở thầu vì phiên bản nhà thầu chưa hiệu lực

## Bối cảnh

Luồng mở thầu từ chối lưu khi ngày mở thầu đứng trước ngày áp dụng đầu tiên của
phiên bản nhà thầu. Lỗi này chặn hoàn toàn việc nhập biên bản mở thầu và yêu cầu
người dùng điều chỉnh ngày hoặc phiên bản nhà thầu.

## Quyết định

- Mở thầu không chặn khi không tìm được phiên bản nhà thầu hiệu lực tại ngày mở
  thầu.
- Khi có phiên bản lịch sử phù hợp tại ngày mở thầu, vẫn dùng chính phiên bản đó.
- Khi không có phiên bản phù hợp, dùng phiên bản nhà thầu đã liên kết hoặc phiên
  bản hiện có; quy tắc này áp dụng cả nhà thầu độc lập và thành viên liên danh.
- Giữ nguyên kiểm tra tenant, quyền, phạm vi bản ghi, validation dữ liệu mở thầu
  và kiểm tra vi phạm nhà thầu.

## Tác động tương thích

- Bản nháp mở thầu trước đây bị chặn vì ngày hiệu lực có thể lưu được mà không cần
  chỉnh ngày mở thầu hoặc phiên bản nhà thầu.
- Không có migration tự động và không viết lại biên bản đã lưu.
- Không thay đổi role, module permission, entitlement, tenant isolation,
  assignment scope, record scope, masking hoặc dữ liệu người dùng được phép xem.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Sau khi triển khai, người dùng có thể
lưu lại bản nháp mở thầu bị chặn trước đó theo quy tắc resolver mới.

## Regression tests

- `tests/js/contractor_opening_snapshot.test.mjs` kiểm tra mở thầu trước phiên
  bản đầu tiên vẫn giữ nhà thầu đã liên kết.
- `tests/js/opening_save_regressions.test.mjs` kiểm tra không còn mã lỗi hay modal
  chặn theo ngày hiệu lực phiên bản nhà thầu.
