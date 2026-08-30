# ADR 0029 — Hợp đồng hồi tố sử dụng phiên bản đầu tiên của đối tác

- Trạng thái: Chấp nhận
- Ngày: 2026-08-30
- Phạm vi: Chọn phiên bản Chủ đầu tư/Nhà thầu cho hợp đồng và tài liệu liên quan

## Bối cảnh

Ngày áp dụng của phiên bản đầu tiên hiện thường được điền bằng ngày nhập dữ liệu. Khi nhập
một hợp đồng có ngày ký sớm hơn ngày áp dụng đó, bộ chọn phiên bản không tìm thấy bản ghi có
`ngày áp dụng <= ngày ký` và chặn lưu, dù thông tin phiên bản đầu tiên chính là thông tin cần
dùng cho hợp đồng hồi tố.

## Quyết định

1. Nếu ngày nghiệp vụ của hợp đồng trước ngày áp dụng sớm nhất trong họ phiên bản, hệ thống dùng
   phiên bản đầu tiên của họ làm phiên bản nền.
2. “Phiên bản đầu tiên” được xác định theo số phiên bản tăng dần (V00/V01 thấp nhất); ngày áp dụng
   chỉ dùng để sắp xếp phụ khi dữ liệu có cùng số phiên bản.
3. Nếu ngày nghiệp vụ từ ngày áp dụng đầu tiên trở đi, giữ nguyên quy tắc chọn phiên bản mới nhất
   có `ngày áp dụng <= ngày nghiệp vụ`.
4. Nếu người dùng chọn rõ một phiên bản, không tự động thay thế lựa chọn đó.
5. Hợp đồng vẫn lưu ID phiên bản đã chọn; không sửa `ngayApDung`, `createdAt` hoặc dữ liệu lịch sử.
6. Quy tắc áp dụng cho cả Chủ đầu tư và Nhà thầu, ngày ký hợp đồng và ngày thanh lý khi có ngày
   thanh lý. Các luồng xuất Word dùng cùng nguyên tắc.

## Compatibility impact

- Hợp đồng có ngày ký trước phiên bản đầu tiên không còn bị chặn chỉ vì thiếu phiên bản có hiệu lực
  theo phép so sánh ngày; hệ thống sẽ gắn với phiên bản đầu tiên.
- Hợp đồng hiện có và các trường hợp ngày nằm trong/sau khoảng phiên bản không thay đổi.
- Không thay đổi role, permission, scope, entitlement hoặc dữ liệu được phép hiển thị.

## Migration và rollout

- Không thay đổi schema và không cần migration dữ liệu.
- Rollout resolver frontend và backend tài liệu đồng bộ để tránh khác nhau giữa lưu hợp đồng và xuất
  Word.

## Rollback strategy

- Rollback các resolver về hành vi chặn trước đây; không cần rollback dữ liệu hay schema.
- Các hợp đồng đã lưu theo phiên bản đầu tiên vẫn giữ ID phiên bản, không bị tự động đổi.

## Regression seams

- `tests/js/contractor_version_effective_date.test.mjs`: ngày trước phiên bản đầu tiên chọn bản
  ghi đầu tiên.
- `tests/test_docx_partner_version_policy.py`: xuất tài liệu hồi tố chọn cùng phiên bản đầu tiên.
- `frontend/contracts/HopDongWorkflow.js`: không còn nhận trạng thái `no_effective_version` trong
  trường hợp hồi tố.
