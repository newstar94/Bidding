# Work Calendar 19A/19B

Áp dụng ADR 0011. Đây là outbound calendar profile, không phải masking hoặc quyền đọc record. User đã có quyền đọc vẫn xem đầy đủ record; Word entitlement không tham gia.

## 19A — preview và `.ics`

Bật `WORK_CALENDAR_ICS_ENABLED=true`.

- Preview: `POST /api/work-calendar/preview`.
- Download chủ động: `POST /api/work-calendar/download`.
- Chỉ nhận lựa chọn source tường minh, fresh-authorize toàn bộ và fail-all không lộ metadata nếu có item denied.
- Tối đa 500 events/1 MiB; response private/no-store.
- `calendar_event_head` và immutable revision giữ opaque UID, significant hash, `SEQUENCE` và server `DTSTAMP`; tải cùng payload không tăng sequence.

## 19B — Google/Microsoft one-way connector

Connector mặc định tắt và không auto-push. Bật master rồi bật từng provider canary:

```dotenv
WORK_CALENDAR_CONNECTORS_ENABLED=true
WORK_CALENDAR_GOOGLE_ENABLED=true
WORK_CALENDAR_MICROSOFT_ENABLED=false
WORK_CALENDAR_TOKEN_ENCRYPTION_KEY=<independent-fernet-key>
WORK_CALENDAR_GOOGLE_CLIENT_ID=<calendar-oauth-client>
WORK_CALENDAR_GOOGLE_CLIENT_SECRET=<secret-manager-reference>
WORK_CALENDAR_GOOGLE_REDIRECT_URI=https://app.example/api/work-calendar/connections/google/callback
WORK_CALENDAR_MICROSOFT_CLIENT_ID=<calendar-oauth-client>
WORK_CALENDAR_MICROSOFT_CLIENT_SECRET=<secret-manager-reference>
WORK_CALENDAR_MICROSOFT_REDIRECT_URI=https://app.example/api/work-calendar/connections/microsoft/callback
WORK_CALENDAR_MICROSOFT_TENANT=common
```

Production redirect origin phải khớp `APP_PUBLIC_URL`. Local development chỉ cho HTTPS hoặc HTTP loopback. Không dùng `GOOGLE_CLIENT_ID` của sign-in làm Calendar credential. Fernet key phải khác email/conflict keys.

Scope cố định:

- Google: `https://www.googleapis.com/auth/calendar.events`, offline access.
- Microsoft delegated: `Calendars.ReadWrite` + `offline_access`.

API:

- `GET /api/work-calendar/connections`
- `POST /api/work-calendar/connections/start`
- `GET /api/work-calendar/connections/{provider}/callback`
- `POST /api/work-calendar/connections/{connection_id}/revoke`
- `POST /api/work-calendar/deliveries/enqueue`
- `GET /api/work-calendar/deliveries`
- `POST /api/work-calendar/deliveries/{delivery_id}/retry`

State chỉ lưu SHA-256, dùng một lần và hết hạn sau 10 phút; PKCE dùng S256. Token/verifier chỉ lưu ciphertext. UI luôn hiển thị scope/outbound profile trước connect và chỉ enqueue khi user bấm “Gửi các mốc đã chọn”. Worker fresh-authorize source trước mỗi send/retry, refresh token khi gần hết hạn, retry tối đa 5 lần với backoff, dùng Google base32hex ID hoặc Microsoft `transactionId` để chống duplicate. ETag conflict chỉ refresh ETag rồi ghi lại đúng outbound allowlist; remote content không đi ngược vào domain.

Revoke đặt connection `REVOKED`, fail pending/retry rows và xóa credential khả dụng. Google revocation endpoint được gọi best-effort; Microsoft local revoke là ranh giới dừng của ứng dụng. Cả hai không xóa remote event mặc định.

## Rollout, rotation và rollback

1. Migrate schema v75 (connector tables v74 + supporting FK indexes v75) và chạy schema-contract/FK-index checks.
2. Đăng ký exact callback, lưu client secrets/Fernet key trong secret manager.
3. Bật master + một provider cho canary; kiểm tra create/update/retry/revoke và audit không chứa token/payload.
4. Theo dõi `calendar_delivery_outbox.status`, `attempt_count`, `last_error_code` và connection `REAUTH_REQUIRED`; chỉ log error code/opaque IDs.
5. Khi rotate client secret, thay secret và restart. Khi rotate Fernet key, tắt hai provider, revoke/reconnect các connection rồi thay key; không đổi key trực tiếp khi còn ciphertext active.

Kill switch provider dừng connect/enqueue/send mới cho provider đó. Master switch dừng worker. Rollback giữ event head, binding, outbox và audit để reconciliation; không xóa business milestone hoặc remote event ngầm.
