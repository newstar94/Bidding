# Chính sách kiểm kê retention — 27/08/2026

Tool `scripts/inventory_retention_candidates.py` chỉ kiểm kê literal scope trong repository. Tool không có lệnh xóa, không di chuyển file, không đọc nội dung file và từ chối root/output nằm ngoài `D:\Bidding`.

| Scope | Owner kỹ thuật | Trạng thái | Điều kiện trước khi dọn |
|---|---|---|---|
| `data/logs` | Operations | `BLOCKED_DECISION` | Chốt thời gian giữ log/backup và loại log được phép rotate |
| `release` | Release engineering | `BLOCKED_DECISION` | Chốt N/N-1/N-2, private symbols và provenance |
| `test-results` | QA | `BLOCKED_DECISION` | Chốt failure trace/screenshot gần nhất cần giữ |
| `test-artifacts` | QA | `BLOCKED_DECISION` | Chốt artifact nào là bằng chứng release |
| `dist` | Release engineering | Review rebuildable | Xác nhận không có server/tab đang phục vụ build này |

Lệnh dry-run:

```powershell
python scripts/inventory_retention_candidates.py
```

Không có quyền thực thi deletion trong remediation này. Sau khi owner duyệt retention, cần một thay đổi riêng có allowlist literal path, quarantine manifest, xác minh absolute target và rollback plan.
