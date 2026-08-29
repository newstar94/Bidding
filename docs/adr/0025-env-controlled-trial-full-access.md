# ADR 0025: Chế độ trial toàn tính năng điều khiển bằng môi trường

- Trạng thái: Chấp thuận
- Ngày: 2026-08-30

## Bối cảnh

BiddingFlow cần một bản thử nghiệm để người dùng trải nghiệm mọi tính năng mà
không thấy bảng giá, gói dịch vụ, hạn mức, lời mời nâng cấp, lịch sử mua hay màn
hình thanh toán. Việc bật/tắt phải là cấu hình triển khai, không phải thay đổi dữ
liệu thuê bao hoặc quyền nghiệp vụ của từng tài khoản.

## Quyết định và business contract

Biến môi trường `TRIAL_FULL_ACCESS_ENABLED=true` bật chế độ trial cho toàn bộ
process. Giá trị mặc định là `false`.

Khi trial bật:

- Word, Excel và Excel kết quả lựa chọn nhà thầu được cấp trong từng workspace
  mà người dùng vốn đã có quyền truy cập; các nhóm trường Word tài chính, định
  danh, chữ ký và con dấu cũng được cấp trong chính phạm vi đó.
- Không enforce gói/hạn mức khi thêm thành viên tổ chức và không trừ/enforce lượt
  tra cứu Mua Sắm Công.
- Commercial policy có hiệu lực ở trạng thái `off`; checkout, payment activation
  và các worker thương mại không được bật bởi cờ trial.
- Landing page, cửa hàng, Commercial Control Center, cấu hình gói, doanh thu,
  quota, lời mời nâng cấp và lịch sử mua được ẩn. Route thương mại cũ được đưa về
  dashboard và frontend không chủ động tải catalog/lịch sử mua.
- Khi chỉnh sửa vai trò trong lúc trial, các trường thương mại đang bị ẩn không được
  làm thay đổi hoặc xóa account subscription, organization subscription hay document-export
  capability đã lưu.

Trial không cấp membership, role, module permission, assignment/record scope hay
quyền đọc bản ghi mới. Tenant isolation, session checks, audit, authorization
theo workspace và các kiểm tra record-level vẫn giữ nguyên. Cờ trial cũng không
tự bật Google, AI, Mua Sắm Công hoặc provider ngoài; các tích hợp này tiếp tục
phụ thuộc vào cờ và credential riêng.

## Compatibility impact

`TRIAL_FULL_ACCESS_ENABLED` vắng mặt hoặc khác `true` giữ nguyên toàn bộ hành vi
commercial/subscription hiện hữu. Không có thay đổi schema, migration dữ liệu,
subscription row hay commercial release. Session payload chỉ đổi entitlement
projection khi trial đang bật.

## Triển khai, migration và rollback

Không có migration dữ liệu. Đặt `TRIAL_FULL_ACCESS_ENABLED=true` trong `.env` của
deployment rồi restart toàn bộ web process và worker để bật. Không bật đồng thời
các provider bên ngoài nếu môi trường thử nghiệm không có credential hợp lệ.

Rollback bằng cách đặt `TRIAL_FULL_ACCESS_ENABLED=false` (hoặc xóa biến) và
restart. Subscription, quota, catalog và payment configuration trước đó không bị
ghi đè nên hành vi trả phí được khôi phục theo cấu hình hiện hành.

## Regression seams bắt buộc

- Runtime config: trial thắng các commercial/payment/enforcement flag mâu thuẫn.
- Export: đủ định dạng và nhóm trường trong scope hợp lệ; outsider và personal
  workspace của người khác vẫn bị từ chối.
- Session: mọi workspace active đã được trả về có entitlement trial, không phát
  sinh workspace/membership mới.
- Member quota và procurement credits: bypass thương mại nhưng giữ authorization.
- Public catalog/presentation: không đọc giá ở trial, paid nodes bị ẩn, route
  commercial đổi về dashboard và profile không tải lịch sử mua.
