# ADR 0028 — Cho phép để trống thông tin quyết định phê duyệt dự án khi lưu kế hoạch

- Trạng thái: Chấp nhận
- Ngày: 2026-08-30
- Phạm vi: Lập mới và lưu kế hoạch lựa chọn nhà thầu loại Dự án

## Bối cảnh

Form kế hoạch loại Dự án từng đánh dấu và bắt buộc nhập Số QĐ phê duyệt dự án, Ngày QĐ
phê duyệt dự án và Cơ quan phê duyệt dự án. Backend cũng từ chối payload nếu một trong ba
trường này để trống. Chủ sản phẩm xác nhận các thông tin đó chưa bắt buộc tại thời điểm lập
mới hoặc lưu kế hoạch lựa chọn nhà thầu.

## Quyết định

1. `soQdPheDuyetDuAn`, `ngayQdPheDuyetDuAn` và `coQuanPheDuyetDuAn` là các trường không
   bắt buộc khi tạo hoặc lưu kế hoạch loại Dự án.
2. Form không hiển thị dấu bắt buộc và không dùng thuộc tính HTML `required` cho ba trường.
3. Backend không sinh lỗi thiếu trường đối với ba trường này. Các validation không liên quan
   giữ nguyên. Yêu cầu cũ đối với Mã dự án sau đó được ADR 0035 thay thế.
4. Nếu người dùng nhập giá trị, frontend vẫn gửi và backend vẫn lưu như trước; dữ liệu tiếp tục
   được hiển thị và cung cấp cho luồng xuất tài liệu hiện hữu.
5. Không thay đổi role, module permission, assignment scope, record scope, entitlement,
   tenant isolation hoặc phạm vi dữ liệu người dùng được phép xem.

## Compatibility impact

- Payload kế hoạch loại Dự án trước đây bị từ chối chỉ vì thiếu một trong ba thông tin quyết định
  phê duyệt nay được chấp nhận.
- Payload đã có đủ ba giá trị không đổi cấu trúc hoặc semantics; dữ liệu tiếp tục được lưu, đọc và
  xuất tài liệu bình thường.
- Các trường bắt buộc khác của kế hoạch không bị thay đổi.

## Migration và rollout

- Không thay đổi schema và không cần migration dữ liệu.
- Không xóa, điền mặc định hoặc biến đổi dữ liệu quyết định phê duyệt dự án hiện hữu.
- Frontend và backend nên được rollout đồng bộ để giao diện và validation máy chủ có cùng contract.

## Rollback strategy

- Rollback đồng bộ form và backend để khôi phục contract bắt buộc cũ; không cần rollback schema.
- Kế hoạch được lưu với ba trường trống trong thời gian áp dụng vẫn giữ nguyên dữ liệu. Nếu quay về
  contract cũ, người dùng phải bổ sung các giá trị trước lần lưu kế tiếp.

## Regression seams

- `tests/test_sync_mutation_contract.py`: backend chấp nhận kế hoạch loại Dự án có cả ba trường
  quyết định phê duyệt để trống.
- `tests/js/optional_plan_project_approval_fields.test.mjs`: form không còn dấu bắt buộc hoặc
  thuộc tính `required` cho đúng ba trường.
- Luồng gán dữ liệu khi mở form, tạo payload khi lưu, màn hình chi tiết và mapping Word tiếp tục giữ
  nguyên để bảo toàn các giá trị được cung cấp.
