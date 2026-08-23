# ADR 0004 — Idempotency procurement operation theo family

- Trạng thái: Chấp nhận
- Ngày: 2026-08-22
- Phạm vi: `procurement_import_operation` và repository tạo operation

## Bối cảnh

Operation ID đã bao gồm procurement family nhưng unique constraint chỉ gồm
`(organization_id, provider, idempotency_key)`. Hai family cùng tenant/provider
dùng cùng client key vì vậy va chạm: insert thứ hai bị `DO NOTHING`, sau đó lookup
theo operation ID mới trả `PROCUREMENT_OPERATION_NOT_FOUND`.

## Quyết định

Identity idempotency là:

`(organization_id, provider, family_key, idempotency_key)`.

Migration append-only v63 kiểm tra duplicate theo identity mới trước DDL, bỏ
constraint ba cột cũ và thêm constraint có tên
`procurement_import_operation_family_idempotency_unique`. Repository dùng
`ON CONFLICT DO NOTHING` không chỉ định arbiter, nên binary mới chạy được trên cả
schema 62 và 63.

## Compatibility impact

- Replay cùng family/key giữ semantics cũ: cùng request hash trả operation đã có;
  request hash khác trả `PROCUREMENT_IDEMPOTENCY_CONFLICT`.
- Hai family khác nhau được phép dùng cùng idempotency key sau v63.
- Không đổi operation ID, response shape, tenant scope, actor ownership hay
  authorization.
- Binary mới tương thích schema 62 để rollout code-first. Binary cũ không tương
  thích schema 63 vì câu `ON CONFLICT` cũ yêu cầu constraint ba cột đã bị bỏ.

## Migration và rollout

V63 triển khai theo expand/contract qua **hai release độc lập**:

1. Release 1 (expand/code-first) deploy binary mới với auto-migrate tắt nhưng giữ
   database ở v62. Runtime của binary này chấp nhận đúng schema 62–63, trong khi
   migrator vẫn target v63.
2. Release 2 (contract/schema) chỉ apply v63 sau khi Release 1 đã ổn định, toàn bộ
   process binary cũ đã dừng, backup/preflight/dry-run và lock budget được duyệt.

Hai release không được gộp trong cùng cửa sổ triển khai. Thực hiện đúng runbook
`deploy/runbooks/database-upgrade-v63.md`, bao gồm smoke và evidence gate riêng
cho từng release.

Migration không rewrite row. Canonical schema 62 vốn có unique constraint chặt
hơn nên không dự kiến duplicate family-scoped; preflight/migration vẫn fail rõ
nếu catalog hoặc dữ liệu đã drift.

## Rollback strategy

Sau v63, không rollback riêng code về binary cũ và không tự thêm lại constraint
ba cột: dữ liệu hợp lệ mới có thể chứa cùng key ở nhiều family. Roll forward là
chiến lược mặc định. Nếu cần rollback toàn release, cô lập write traffic và
restore backup schema 62 đã verify vào database riêng trước khi chuyển traffic.

## Regression seams

- `tests/test_procurement_operation_idempotency.py`: hai family cùng key, replay
  cùng family, binary mới trên schema legacy, duplicate guard và migration DDL.
- `tests/test_database_upgrade_preflight.py`: report v63 read-only.
- `tests/test_startup_database_migration.py`: production không auto-migrate;
  runtime chấp nhận v62/v63, từ chối schema cũ hơn hoặc mới hơn; migrator vẫn
  target v63.
- `tests/test_postgres_migration_chain.py` và
  `tests/test_postgres_schema_contract.py`: fresh/upgrade catalog v63.
