# Database upgrade v63 — family-scoped procurement idempotency

## Impact

V63 thay unique constraint của `procurement_import_operation` từ tenant/provider/key
sang tenant/provider/family/key. Migration chỉ đổi catalog, không rewrite business
row. Việc tạo unique constraint cần lock budget và phải chạy bằng migrator role
sau khi toàn bộ web worker đã chạy binary mới trên schema v62.

V63 là contract migration: schema v63 không còn arbiter ba cột mà binary cũ chỉ
định trong `ON CONFLICT`. Không chạy migration nếu chưa có phê duyệt rollout và
chưa chứng minh toàn bộ process binary cũ đã dừng; sau migration không rollback
riêng binary về bản cũ.

## Compatibility sequence

1. Tạo và verify backup theo runbook hiện hành.
2. Đặt `DATABASE_AUTO_MIGRATE=false`.
3. Deploy và roll **toàn bộ** worker sang binary mới khi database vẫn ở v62.
   Repository dùng `ON CONFLICT DO NOTHING`, nên create/replay hiện hữu tiếp tục
   chạy trong pha code-first.
4. Chứng minh không còn process binary cũ, rồi smoke prepare/apply/replay trên một
   family. Chưa kỳ vọng hai family cùng key hoạt động trước migration.
5. Chạy preflight và dry-run v63.
6. Apply v63 bằng migrator credential.
7. Smoke hai family cùng key và replay trong một family trên các worker mới.

Không đảo thứ tự bằng cách migrate v63 rồi chạy binary cũ.

## Commands

```bash
python scripts/backup.py create
python scripts/manage_database.py --preflight
python scripts/manage_database.py --dry-run
DATABASE_AUTO_MIGRATE=false python scripts/manage_database.py
pytest -q tests/test_procurement_operation_idempotency.py \
  tests/test_database_upgrade_preflight.py \
  tests/test_postgres_schema_contract.py
```

Preflight phải báo:

```json
{
  "v63ProcurementOperationIdempotency": {
    "applies": true,
    "duplicateFamilyScopedGroups": 0,
    "requiresDataRepair": false,
    "requiresLockBudget": true
  }
}
```

Nếu `requiresDataRepair=true`, dừng rollout. Không xóa/gộp operation tự động;
giữ forensic snapshot và điều tra catalog/data drift.

## Verification

Sau apply:

- `database_metadata.schema_version = 63`.
- Constraint
  `procurement_import_operation_family_idempotency_unique` tồn tại với đúng bốn
  cột.
- Constraint ba cột cũ không còn.
- Same key ở hai family tạo hai operation.
- Replay cùng family trả operation đã commit; hash khác vẫn conflict.

## Rollback

Không chạy DDL ngược ad-hoc và không rollback riêng binary cũ. Sau khi v63 tiếp
nhận hai family cùng key, constraint ba cột không thể thêm lại mà không làm mất
semantics/dữ liệu hợp lệ. Cô lập write traffic, giữ forensic snapshot và restore
backup v62 đã verify vào database riêng nếu bắt buộc rollback toàn release.
