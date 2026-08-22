# ADR 0002 — Ranh giới remediation migration v61

- Trạng thái: Chấp nhận
- Ngày: 2026-08-22

## Quyết định

Migration v61 đã phát hành được giữ bất biến. Hệ thống chỉ bổ sung preflight
read-only đếm organization có tên chính xác `HTD`; không in tenant ID, không đổi
dữ liệu và luôn trả `automaticRemediationAllowed=false`.

Nếu có candidate, rollout qua v61 hoặc remediation database đã chạy phải dừng
cho tới khi chủ sản phẩm cung cấp mapping tenant và backup đã verify. Không suy
luận identity từ tên hiển thị, không đổi hàng loạt `HCP ↔ HTD`.

## Compatibility impact

Không thay đổi schema, migration lịch sử, tenant ID, role, permission, masking
hoặc API nghiệp vụ. Chỉ JSON của `--preflight` có thêm báo cáo v49–v62.

## Migration/rollback strategy

Không có migration mới cho quyết định này. Rollout dùng transactional dry-run và
runbook `deploy/runbooks/database-upgrade-v49-v62.md`. Nếu v61 đã tác động sai dữ
liệu, remediation chỉ được lập sau mapping được duyệt; rollback là restore backup
đã verify vào database cách ly, không chạy rename SQL theo suy đoán.

## Regression seam

`tests/test_database_upgrade_preflight.py` chứng minh query v61 chỉ là `SELECT`,
không chứa `UPDATE`, và runbook chứa gate mapping bắt buộc.
