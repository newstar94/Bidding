# Decision packet mục 7 — Trung tâm xử lý xung đột

**Trạng thái:** đã được chủ sản phẩm duyệt ngày 2026-08-24; contract tại ADR 0008  
**Production wiring:** không có  
**Contract hiện hành:** discard conflict marker khi F5 trước authoritative pull;
không replay conflict draft; unrelated outbox được bảo toàn.

## 1. Bằng chứng đã khóa

- CAS và HTTP 409 vẫn thuộc server writer/validator hiện hữu.
- `project_conflict_record()` giữ business fields và loại credential/internal
  secret; không có masking business field mới.
- `WorkspaceConflictRecoveryStore` đang giữ checkpoint marker version 1 nhưng
  startup chủ động xóa marker trước pull; marker không phải durable center.
- Regression hiện hành chứng minh F5 discard, no dialog/no retry, local outbox
  không bị bỏ và record bị từ chối không lộ server data khi authorization fail.
  Characterization seams cụ thể: `tests/js/conflict_recovery_store.test.mjs`
  khóa marker/quarantine theo workspace; `tests/js/sync_conflict_recovery.test.mjs`
  khóa startup clear trước authoritative pull và bảo toàn unrelated outbox;
  `tests/test_sync_conflict_authorization.py` khóa authorization/no-leak phía server.
- Prototype logic chạy bằng:

  ```powershell
  python -m backend.sync.conflict_resolution.prototype_merge_cli
  ```

  Kết quả: scalar chỉ có thể tự phân loại khi field được allowlist; unknown,
  delete/missing và nested relation phải dừng. `NEEDS_DECISION` không phải lệnh
  mutation.

## 2. Giá trị cần chủ sản phẩm điền

| Gate | Câu trả lời bắt buộc | Không có câu trả lời thì giữ |
|---|---|---|
| DG-07-01A | `session-only`, `device-local` hay `server/cross-device` | Session-only + discard-on-F5 |
| DG-07-01B | Reload: discard, retain-no-replay hay workflow khác | Discard-on-F5 |
| DG-07-01C | Retention duration/quota; logout, forced logout, revocation, deactivation, purge | Không thêm durable payload |
| DG-07-02A | Exact table/field allowlist + normalization cho scalar | Default deny |
| DG-07-02B | Delete-vs-update, null-vs-missing, nested object/list, duplicate identity, order | Unsupported/manual edit |
| DG-07-02C | Whole-record choice nào được phép và ở lifecycle nào | Không resolve production |
| DG-07-03A | Base capture fields/value/hash; encryption/storage boundary | Không capture thêm |
| DG-07-03B | Audit metadata/full-value policy + size/privacy/retention | Giữ audit hiện hữu |
| DG-07-03C | Authority: signed/MAC token hay persisted preview; TTL, actor/workspace binding | Không có resolution API |

## 3. Compatibility cần chấp nhận nếu đổi semantics

- Retain qua F5 làm thay đổi contract `CONTEXT.md`; client upgrade/downgrade phải
  biết cách bỏ envelope không đọc được và không auto replay.
- Logout/revocation không được mặc định purge hoặc retain: forced logout hiện
  deactivate và bảo toàn pending workspace, nên cần quyết định riêng.
- “Giữ của tôi” phải tạo mutation mới với exact pinned server rowVersion; không
  phải force write. Writer thứ hai vẫn sinh conflict mới.
- Quyền bị thu hồi sau 409 phải từ chối không trả latest server data; retention
  của local/base values phải theo quyết định đã duyệt.
- Không thêm role/module/capability/entitlement/masking/redaction. Authorized
  record vẫn đầy đủ theo `AGENTS.md`.

## 4. Migration/rollback shape sau khi được duyệt

- Device-local: versioned envelope migration một chiều, corruption fallback,
  quota/cleanup và exact logout/revocation behavior.
- Server-side: append-only tenant-scoped tables, encrypted payload/retention job,
  typed tenant keys, actor/workspace authorization và preview authority.
- Rollout: capture-base flag → observe size/corruption → allowlist một table →
  resolution flag. Kill switch quay về discard-on-F5; không replay envelope cũ.
- Regression seams: F5, unrelated outbox, second race, revocation/no-leak,
  idempotency, token expiry/tamper/actor binding, full authorized values.

## 5. Phạm vi chưa thực hiện có chủ ý

Không có production envelope store mới, base snapshot, signed token, resolution
route/service, UI center, retention job, migration hoặc thay đổi test expectation.
Các phần đó bị chặn cho tới khi toàn bộ giá trị trên được ghi trong ADR/business
contract được chủ sản phẩm chấp nhận.
