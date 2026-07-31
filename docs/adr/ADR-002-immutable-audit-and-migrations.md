# ADR-002: Immutable audit và forward-only migrations

- Status: accepted
- Date: 2026-07-30

## Decision

Business mutation vật chất ghi immutable audit bằng cùng transaction. Event chứa actor/org/request-mutation IDs/action/target/root aggregate/field names/before-after SHA-256/redaction class, không chứa password, token, secret, raw signature binary hoặc PII không cần thiết. Activity feed là projection riêng và liên kết bằng event identity; không thay thế evidence.

Schema migration là forward-only. Không sửa migration đã phát hành; v30 thêm restore evidence, v31 thêm asset journal và document-job owner scope, v32 thêm WebSocket retry/dead-letter state. Deploy chạy migrator role trước runtime role; rollback ứng dụng phải tương thích additive columns/tables, không drop schema.

Audit-chain invalid hoặc verifier exception làm readiness fail closed. Retention audit cần signed checkpoint/partition archival riêng, không bị cleanup loop xóa mù.
