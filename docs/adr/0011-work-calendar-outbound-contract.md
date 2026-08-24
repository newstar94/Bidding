# ADR 0011 — Projection và connector lịch công việc

- Trạng thái: Chấp nhận
- Ngày: 2026-08-24
- Phạm vi: Mục 19A/19B

Work calendar chỉ project applicable rows có ngày từ effective timeline; case deadlines được thêm qua cùng interface sau mục 20/21. Summary dùng mã gói và nhãn mốc, description dùng tên kế hoạch/gói cùng link nội bộ, location trống; CCCD, tài khoản, ngân hàng, chữ ký và con dấu không thuộc outbound calendar projection nhưng vẫn hiển thị đầy đủ trong record API/UI đã authorize. Timed event dùng UTC, date-only dùng all-day exclusive end. UID pin lineage/milestone/instance; event-head tăng sequence khi semantic date/title/cancellation đổi và dùng server revision time làm DTSTAMP. Snapshot `.ics` tối đa 500 events/1 MiB, explicit authorized selection và fail toàn bộ nếu có denied item. Connector là opt-in one-way tới calendar Google/Microsoft đã chọn; remote edit không ghi ngược record và revoke dừng send mới, mặc định không xóa event remote đã tạo.

Connector chỉ gửi thủ công sau khi user chọn source và bấm gửi. Google dùng scope exact `https://www.googleapis.com/auth/calendar.events`; Microsoft dùng delegated `Calendars.ReadWrite` cùng `offline_access` để worker refresh token. OAuth authorization-code bắt buộc state một lần/10 phút và PKCE S256. Credential calendar dùng client/key riêng, không dùng Google sign-in ID token. Token/verifier được mã hóa bằng Fernet key riêng. Google event ID là SHA-256 dẫn xuất base32hex từ canonical UID; Microsoft create pin `transactionId`. Retry, refresh và ETag recovery giữ idempotency; mỗi enqueue/send/retry reauthorize source theo quyền hiện hành. Provider kill switch chặn connect/enqueue/send của provider đó nhưng vẫn giữ metadata reconciliation; revoke local vô hiệu hóa pending delivery và xóa credential khả dụng, không gọi xóa event remote.

## Compatibility impact

Thêm user-initiated outbound action, không thay record visibility hoặc timeline facts. Google login ID token không được dùng làm Calendar credential. Snapshot không có METHOD; connector cancellation là flow riêng.

## Migration và rollback

Thêm event-head và connector consent/token/reference/outbox tables theo tenant/user. Route/UI và từng provider có feature flag/kill switch. Rollback dừng enqueue/send, giữ reconciliation metadata và không xóa business milestones hoặc remote event ngầm.

## Regression seams

RFC/parser/timezone/all-day, stable UID/sequence/DTSTAMP, projection allowlist, denied selection no-leak, limits, consent/OAuth state/PKCE, token encryption, reauth before enqueue/send/retry, idempotent create/update/cancel, revoke và provider recovery.
