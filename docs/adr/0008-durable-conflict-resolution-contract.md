# ADR 0008 — Bản nháp giải quyết xung đột bền vững

- Trạng thái: Chấp nhận
- Ngày: 2026-08-24
- Phạm vi: Mục 7, conflict recovery và resolution

Chủ sản phẩm duyệt lưu bản nháp conflict phía server theo exact tenant/workspace/actor trong 30 ngày, tối đa 20 draft; draft giữ qua F5 nhưng không tự replay. Mỗi lần đọc hoặc resolve phải fresh-authorize record. Allowlist v1 chỉ gồm scalar business field hiện được canonical validator cho sửa trên `kehoach`/`goithau`; identity, tenant/version, permission/assignment, lifecycle/status, object/list/delete không được merge. Field đã authorize vẫn hiển thị đầy đủ, nhưng hệ thống không tự chọn field tài chính/định danh. Resolution dùng server-issued authority TTL 15 phút, pin exact base/server rowVersion và policy version; race mới vẫn trả 409. Audit giữ metadata/decision/digest, còn payload snapshot được mã hóa và purge theo retention.

## Compatibility impact

Conflict không còn tự biến mất khi F5, nhưng vẫn không quay lại active outbox hoặc tự áp mutation. Logout không xóa draft; revocation chặn đọc/resolve mà không lộ latest server data. Không đổi role, module permission, assignment/record scope hay field visibility.

## Migration và rollback

Thêm storage tenant-scoped append-only/head cho draft và authority; rollout theo capture flag rồi resolution flag. Không migrate marker client cũ. Rollback tắt route/UI và quay về discard-on-F5; server draft cũ không replay và được purge theo retention.

## Regression seams

F5/no replay, actor/workspace/tenant isolation, revocation no-leak, exact allowlist, null-vs-missing, unsupported relation/delete, token tamper/expiry, second race 409, audit atomicity và retention purge.
