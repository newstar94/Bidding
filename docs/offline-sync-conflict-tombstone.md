# Offline sync, conflict và tombstone

## Push

Mọi mutation bắt buộc có `clientMutationId`. Idempotency key được bind vào actor + organization + request hash; dùng lại key với payload khác trả `IDEMPOTENCY_KEY_REUSED`. Batch không commit một phần khi có validation/conflict ngoài semantics đã công bố.

Write authorization chạy trước conflict projection. Caller không có quyền nhận bounded `RECORD_ACCESS_DENIED`, không nhận record/current version. Caller có read access nhận bounded business DTO đã loại secret.

## Delete và restore

Delete ghi `deleted_records` gồm delete version, snapshot phục hồi, actor và mutation ID. Stale update trên tombstone trả `RECORD_DELETED`; nếu cursor/tombstone quá retention trả `FULL_SYNC_REQUIRED`; không được rơi xuống insert. Restore chỉ qua `POST /api/sync/restore`, yêu cầu manager/personal owner, reason, expected delete version và mutation ID; business row + audit + WebSocket event commit cùng transaction.

## Pull paging

`GET /api/sync/delta` pin `throughVersion` ở page đầu. Cursor HMAC chứa after/through/marker/expiry và bind hash của organization + user + session; replay cross-tenant/user hoặc tamper bị từ chối. Ordering là `(version, kind, table, id)`, giới hạn mặc định 250 record và 512 KiB. Live rows và tombstones dùng cùng ordering.

Frontend gom toàn bộ page trong memory rồi mới apply/persist và advance `bf_last_sync_version`. Mất mạng giữa page không làm advance durable cursor; GET retry hoặc lần sync kế tiếp bắt đầu lại an toàn từ version cũ.

## WebSocket outbox

`websocket_events` được insert bằng chính cursor business trước commit; `pg_notify` chỉ wake broker sau commit. Event payload qua allowlist và chỉ chứa invalidation metadata. Consumer/client xử lý `db_changed` idempotently bằng pull; duplicate delivery an toàn, còn process crash sau commit không làm mất durable event.

