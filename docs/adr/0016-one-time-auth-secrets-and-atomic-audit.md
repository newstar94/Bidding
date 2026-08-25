# ADR 0016 — Bí mật xác thực một lần và audit nguyên tử

- Trạng thái: Chấp nhận
- Ngày: 2026-08-25
- Phạm vi: đăng ký OTP, tạo tài khoản Google, đặt/reset mật khẩu và audit bảo mật

## Quyết định

1. Tài khoản tạo bằng Google lưu credential `!google-external-only!`, không tạo hoặc
   gửi mật khẩu rõ. Hệ thống tạo token ngẫu nhiên trong `password_reset_tokens`, chỉ
   lưu SHA-256, hết hạn sau 2 giờ và dùng một lần. Email outbox được mã hóa gửi link
   `/reset-password#token=...`. Người dùng vẫn đăng nhập Google nếu link hết hạn và
   có thể yêu cầu link reset mới sau khi đã đặt username.
2. OTP đăng ký chỉ được gửi qua email; DB lưu `HMAC-SHA256` gắn với user ID bằng
   `OTP_HMAC_KEY` độc lập. Production bắt buộc khóa tối thiểu 32 byte và cấm dùng
   trùng với secret khác. OTP rõ đã phát hành trước deploy bị vô hiệu; người dùng
   dùng “gửi lại mã” để nhận mã mới.
3. Reset mật khẩu ghi audit `required=True` bằng cùng connection trước commit. Nếu
   audit chain không khả dụng, việc dùng token, đổi mật khẩu và revoke session cùng
   rollback. Google link/auto-register/login success cũng audit trong transaction
   tạo identity/session trước commit. Email delivery vẫn chạy sau commit từ durable
   encrypted outbox.

## Business contract

- Không thay đổi role, module permission, membership, assignment, record scope,
  entitlement, masking hoặc dữ liệu người dùng được xem.
- Token đặt mật khẩu chỉ cấp quyền đặt credential cho đúng tài khoản sở hữu token;
  không cấp quyền đọc dữ liệu hay đổi workspace.
- Link hết hạn không khóa tài khoản và không vô hiệu đăng nhập Google.

## Compatibility impact

- Response Google giữ `temporary_password_sent=false` và
  `temporary_password_queued=false`, đồng thời thêm `password_setup_queued`.
- Email mới không còn chứa mật khẩu tạm. Token reset hiện hữu vẫn giữ TTL 30 phút;
  riêng token setup Google có TTL 2 giờ và dùng cùng endpoint redemption.
- OTP plaintext đang còn hạn không được chấp nhận sau deploy.

## Migration và rollback

- Migration v78 mở rộng check constraint `email_delivery_status.purpose` với
  `google_password_setup`; giữ `google_temporary_password` để đọc lịch sử outbox.
- Deploy migration v78 trước web workers. Cấu hình `OTP_HMAC_KEY` bằng secret manager
  trước khi khởi động production.
- Rollback ứng dụng về bản v77 vẫn đọc được bảng, nhưng không tạo được purpose mới;
  không được rollback khi còn web worker mới đang ghi outbox.

## Regression seams

- OTP DB không chứa mã rõ, đúng/sai user và đúng/sai mã;
- setup token hết hạn 2 giờ, one-time và replay bị từ chối;
- email Google chứa link, không chứa mật khẩu tạm;
- audit failure rollback token/password/session;
- Google required audit đứng trước commit;
- migration v1→v78, fresh schema và normalized schema contract.
