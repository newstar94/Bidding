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

## Release 1 — expand/code-first trên schema v62

1. Tạo và verify backup theo runbook hiện hành.
2. Đặt `DATABASE_AUTO_MIGRATE=false`.
3. Deploy và roll **toàn bộ** worker sang binary mới khi database vẫn ở v62.
   Repository dùng `ON CONFLICT DO NOTHING`, nên create/replay hiện hữu tiếp tục
   chạy trong pha code-first.
4. Kiểm tra `/health/ready` trên từng worker khi metadata vẫn là schema v62.
5. Chứng minh không còn process binary cũ, rồi smoke prepare/apply/replay trên một
   family. Chưa kỳ vọng hai family cùng key hoạt động trước migration.
6. Giữ Release 1 chạy ổn định hết cửa sổ quan sát đã được change owner phê duyệt.

Evidence đóng Release 1:

- release SHA và danh sách worker;
- `database_metadata.schema_version = 62`;
- `DATABASE_AUTO_MIGRATE=false`;
- readiness và smoke create/replay thành công;
- bằng chứng không còn process binary cũ.

Không apply v63 trong Release 1.

## Release 2 — contract/schema v63

Release 2 là change record và cửa sổ triển khai riêng, chỉ mở sau khi Release 1
được chấp thuận:

1. Xác minh lại backup v62 và toàn bộ evidence của Release 1.
2. Cô lập hoặc đóng băng write traffic theo change plan.
3. Chạy preflight và dry-run v63 bằng migrator credential.
4. Dừng nếu data repair, catalog drift hoặc lock budget chưa được duyệt.
5. Apply v63 bằng migrator credential.
6. Mở lại traffic và smoke hai family cùng key, replay trong một family trên các
   worker mới.
7. Xác minh readiness trên v63 và lưu catalog/evidence sau migration.

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

Binary Release 1 phải từ chối schema dưới 62 và trên 63; production startup không
được tự migrate. Migrator vẫn có target chính xác là v63.

Sau Release 2 apply:

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
