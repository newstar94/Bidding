# ADR 0013 — BulkOperation pilot EXPORT_RECORD_DATA

- Trạng thái: Chấp nhận
- Ngày: 2026-08-24
- Phạm vi: Mục 30

BulkOperation v1 đăng ký duy nhất `EXPORT_RECORD_DATA` cho `kehoach` và `goithau`, tái sử dụng canonical record-read authorization và không mutation. Selection chỉ `EXPLICIT_IDS`, tối đa 100 records. Prepare tạo opaque preview TTL 10 phút pin tenant/actor/action/selection/schema; confirm fresh-authorize/revalidate toàn bộ và một denied/stale item làm cả operation fail không lộ metadata item. Execution `STAGED_FINALIZE` tạo temporary ZIP chứa JSON UTF-8 của full authorized business projection, giữ 24 giờ. Idempotency không tạo hai artifact/audit, cancel chỉ queued/unstarted. Audit giữ operation, exact authorized IDs/digest, artifact checksum/expiry; UI chỉ hiển thị code/title/reason của record đã authorize.

## Compatibility impact

Pilot không tạo permission shortcut, không dùng Word entitlement và không đổi API/UI đọc bản ghi. Không có select-all-by-filter hoặc arbitrary action/table/field patch.

## Migration và rollback

Thêm operation/preview/item/lease/artifact metadata tenant-scoped, temporary artifact cleanup và registry flag. Rollback tắt action/worker, giữ audit metadata và xóa artifact theo expiry; không có business mutation cần undo.

## Regression seams

Strict registry/schema, explicit limit, prepare/confirm actor binding, tenant/record auth, denied/stale no-leak, full authorized projection, checksum/ZIP safety, idempotency, crash before/during/after finalize, retry/cancel, cleanup và audit result parity.
