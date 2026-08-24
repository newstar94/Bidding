# Runbook cutover WordTemplateCatalog

Trạng thái áp dụng: ADR 0010. Runbook này không thay đổi quyền đọc dữ liệu; Word entitlement tiếp tục chỉ kiểm soát hành động tạo/tải Word.

## 1. Điều kiện trước inventory

- Database đã ở schema runtime được hỗ trợ và backup/restore drill còn hiệu lực.
- `WORD_TEMPLATE_CATALOG_ENABLED=true`, `WORD_TEMPLATE_CATALOG_MODE=shadow`.
- `BIDDING_WORD_TEMPLATE_CATALOG_DIR` là đường dẫn tuyệt đối, persistent, chỉ service account được ghi.
- Actor chạy inventory tồn tại trong `tai_khoan`; audit chain ở trạng thái hợp lệ.
- Không đổi file/config Word legacy trong cửa sổ inventory và parity.

## 2. Inspect và inventory

Inspect không ghi database:

```powershell
python scripts/word_template_catalog_inventory.py `
  --organization-id <scope-id> --owner-type organization --owner-id <org-id> `
  --output artifacts/word-template-inventory-before.json
```

Apply chỉ chạy trong shadow mode. Transaction sẽ rollback nếu bất kỳ template hoặc ordered assignment set nào không đạt parity:

```powershell
python scripts/word_template_catalog_inventory.py --apply `
  --organization-id <scope-id> --owner-type organization --owner-id <org-id> `
  --actor-user-id <operator-user-id> `
  --output artifacts/word-template-inventory-applied.json
```

Giữ report làm release evidence. `parity=true` và `committed=true` là điều kiện bắt buộc; không sửa report bằng tay và không đoán mapping cho alias thiếu/không rõ.

## 3. Shadow verification

1. Chạy preflight cho mọi version dự kiến publish.
2. Kiểm tra mỗi legacy alias có cùng SHA-256 với catalog published version.
3. Kiểm tra từng `documentType` giữ nguyên số lượng, thứ tự và alias; không có active-template fallback.
4. Chạy regression Word CRUD, publication assignment, render và record authorization.
5. Xác nhận lifecycle UI trả 200 trong shadow nhưng exporter vẫn dùng legacy authority.

## 4. Cutover

Chỉ đổi một write authority trong một release window:

1. Tạm dừng mutation cấu hình Word.
2. Chạy lại inspect; nếu config revision/hash khác report áp dụng thì quay lại bước inventory.
3. Đặt `WORD_TEMPLATE_CATALOG_MODE=cutover`, restart toàn bộ ASGI workers.
4. Kiểm tra readiness; background projection worker phải chuyển outbox `PENDING/RETRY` sang `COMPLETED`.
5. Xuất một Word theo từng document type đã gán; đối chiếu exact `templateVersionId`, template checksum và artifact checksum trong provenance/audit.
6. Mở lại mutation cấu hình Word sau khi parity smoke test đạt.

## 5. Rollback ứng dụng

Nếu cutover lỗi, đặt mode về `shadow` và restart. Legacy adapter trở lại authority; không xóa catalog version, publication event, preflight report, assignment v2 hay generated-document provenance. Các alias đã projection là bản sao checksum-verified của published bytes và được giữ để reconciliation.

Rollback không được sửa published bytes, đổi assignment semantics, tạo fallback ngầm hoặc thay đổi field visibility/permission. Sau rollback phải lưu incident evidence, config revision, outbox status và checksum report trước khi thử cutover lại.
