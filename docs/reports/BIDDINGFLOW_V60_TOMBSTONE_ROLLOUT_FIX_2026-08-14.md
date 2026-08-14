# BiddingFlow v60 tombstone rollout fix

Ngày hoàn thành: 2026-08-14

## A. Baseline

- HEAD trước: `557976189d2ca8936e3d654e2b930ee303115664` (`feat(tests): enhance AI event streaming tests for resource safety and cancellation handling`).
- HEAD sau: commit chứa báo cáo này, tiêu đề `fix(db): deploy tombstone snapshot migration`. Git object ID chính xác được ghi trong bàn giao cuối vì commit không thể tự chứa object ID của chính nó.
- Schema version trước: 59.
- Schema version sau: 60.
- Visibility policy version trước: 3.
- Visibility policy version sau: 4.

Business contract về quyền và hiển thị dữ liệu được bảo toàn. Patch không thêm masking/redaction, không đổi role, module permission, assignment scope, record scope, capability hay entitlement. Người dùng đã được phép đọc bản ghi vẫn nhận đầy đủ CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và các trường liên quan; quyền xuất Word chỉ kiểm soát hành động xuất tài liệu.

## B. Root cause

Source của `bf_log_synced_delete()` đã được đổi để ghi `record_snapshot_json = to_jsonb(OLD)::text`, nhưng upgrade registry vẫn dừng ở v59. Vì vậy database production đã ở v59 không có migration nào để cài body function mới: source Python mới nhưng PostgreSQL function đang chạy có thể vẫn là body cũ. Schema contract không so sánh function body nên startup có thể không phát hiện drift này.

Visibility semantics của tombstone cũng đã thay đổi nhưng `VISIBILITY_POLICY_VERSION` vẫn là 3. Client giữ token v3 và projection IndexedDB cũ vì thế không bị buộc làm authoritative full refresh.

## C. Migration

- Migration: v60 `capture_synced_delete_snapshots`.
- Migration được append sau v59; không sửa hoặc viết lại migration lịch sử.
- DDL scope chỉ chạy `CREATE OR REPLACE FUNCTION bf_log_synced_delete()` qua helper `_create_synced_delete_trigger_function()` dùng chung cho fresh install và historical upgrade.
- Không drop/recreate trigger và không rebuild các trigger function khác.
- Trigger hiện hữu tiếp tục trỏ đến cùng function name. Chạy lại ở schema v60 không tạo duplicate trigger và không chạy lại migration.
- Test PostgreSQL thật dựng schema đến v59, cài lại body v59 không có snapshot, chạy 59→60, đọc `pg_get_functiondef()`, hard-delete assignment thật và xác minh JSON snapshot chứa `id`, `organization_id`, `id_nhan_vien`, `id_muc_tieu`, `loai_doi_tuong`.

## D. Visibility rollout

`VISIBILITY_POLICY_VERSION` được bump deterministic từ 3 lên 4. Token sinh từ cùng principal và dữ liệu ở policy v3 ổn định, nhưng khác token v4. Delta request mang token v3 nhận HTTP 409:

```json
{
  "code": "SYNC_VISIBILITY_RESET_REQUIRED",
  "requiresFullSync": true
}
```

Client hiện hữu xóa sync cursor/token và gọi full refresh. Regression tests xác minh full projection chỉ giữ Package A được assignment và child của A, loại Package B không được assignment cùng child của B; pending local upsert vẫn được overlay lên authoritative server snapshot và được persist.

## E. Tests

Các kết quả cuối cùng:

| Lệnh | Kết quả | Exit code |
| --- | --- | ---: |
| `python -m pytest -q tests/test_postgres_migration_chain.py tests/test_postgres_schema_contract.py tests/test_account_deactivation.py tests/test_procurement_raw_snapshot.py tests/test_sync_delta_paging.py` với `TEST_DATABASE_URL` từ `.env` | 63 passed, 0 failed, 0 skipped | 0 |
| `python -m pytest -q tests/test_sync_delta_paging.py -k "visibility_policy or full_refresh_projection"` với `TEST_DATABASE_URL` từ `.env` | 2 passed, 10 deselected, 0 failed, 0 skipped | 0 |
| `node --test tests/js/sync_pull_ordering.test.mjs tests/js/sync_pending_overlay.test.mjs` | 16 passed, 0 failed, 0 skipped | 0 |
| `python -m pytest -q` với `TEST_DATABASE_URL` từ `.env` | 1204 passed, 0 failed, 0 skipped | 0 |
| `npm run test:js` | 804 passed, 0 failed, 0 skipped | 0 |
| `npm run check:static` | compile/schema fixture/quality/encoding/module/debt checks passed; 277 frontend modules, 0 static import cycles; Python debt stayed at baseline | 0 |
| `npm run build:secure` | secure Vite build passed; 281 modules transformed, 52 obfuscated bundles verified | 0 |
| `git diff --check` | no whitespace errors | 0 |

Test database dùng cho integration gate đã được nâng bằng chính `scripts/manage_database.py` từ v59 lên v60 trước khi chạy live schema-contract checks.

## F. Remaining risks

- Tombstone lịch sử được tạo trước rollout có thể thiếu snapshot. Patch không fake-backfill và không suy đoán assignment evidence đã mất.
- Authoritative full sync sau visibility policy mismatch là recovery mechanism cho local projection cũ.
- Provider-native socket abort, nếu provider chưa hỗ trợ hủy socket trực tiếp, vẫn là deferred limitation ngoài phạm vi patch này.
- Frontend technical debt hiện hữu vẫn intentionally deferred; patch chỉ thêm regression coverage cho reset/full-refresh flow.
- Schema contract hiện chưa fingerprint PostgreSQL function body. Regression migration test dùng `pg_get_functiondef()` khóa lỗi cụ thể, nhưng mở rộng catalog contract cho function definitions là công việc riêng nếu sau này cần.
