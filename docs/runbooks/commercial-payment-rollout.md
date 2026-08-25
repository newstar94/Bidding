# Runbook — rollout thương mại và thanh toán

## Trạng thái mặc định

Mọi cờ mới mặc định tắt. Migration v79 chỉ tạo dữ liệu tương thích bất biến,
backfill exact subscription dates/entitlements và một draft để review; nó không
tự publish offer sellable, không mở checkout, không kích hoạt payment và không
enforce quota.

## Trình tự bật

1. `COMMERCIAL_POLICY_ENABLED=true`, `COMMERCIAL_POLICY_MODE=shadow`.
2. Super Admin kiểm tra draft, simulation, mapping entitlement xuất và ba
   `BLOCKED_DECISION`; chưa publish production khi còn blocker.
3. Chạy regression quyền đọc/full-record, schema clean/upgrade/idempotency và
   Fake Provider E2E. So catalog mới với legacy trong shadow.
4. Chuyển `COMMERCIAL_POLICY_MODE=enforce` chỉ sau source-of-truth cutover.
5. Bật `PAYMENT_CHECKOUT_ENABLED` sau legal/tax/invoice, merchant, credential và
   webhook readiness. Production startup yêu cầu payOS cùng mọi confirmation.
6. Bật `PAYMENT_ACTIVATION_ENABLED` sau reconciliation/activation evidence.
7. Bật `PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED` cuối cùng, sau khi policy batch
   thiếu quota đã được chủ sản phẩm chốt.

## Incident controls

- Ngừng checkout mới: `PAYMENT_CHECKOUT_ENABLED=false`. Có thể giữ
  `PAYMENT_ACTIVATION_ENABLED=true` để xử lý order đã tạo/đã trả.
- Dừng bán release/SKU: dùng stop-sales có reason/audit. Không sửa/xóa release.
- Provider lỗi: pause routing mới, vẫn nhận webhook và reconcile order đã pin.
- Resolver lỗi: dừng giao dịch mới. Không thay đổi quyền đọc dữ liệu hay thuê bao
  đã áp dụng.
- Rollback catalog: clone release cũ thành draft, validate và publish release mới.
  Không mutate lịch sử.

## Blocker trước live

- Chọn semantics kỳ năm, 29/02, inclusive/exclusive và renewal anchor.
- Chọn `reject_all` hoặc `process_affordable_in_stable_order` cho batch thiếu
  quota.
- Chốt ai được đọc billing/invoice history của organization.
- Phê duyệt thuế/hóa đơn, điều khoản/refund/privacy, payOS merchant và webhook.
- Sinh lại `backend/db/postgres_schema_contract.json` bằng PostgreSQL 17 fresh
  schema qua `python scripts/generate_postgres_schema_contract.py --write`.

## Không được làm

- Không dùng redirect query để kích hoạt quyền lợi.
- Không retry create payOS bằng order code mới sau timeout mơ hồ; query cùng mã.
- Không dùng payOS cancel như refund hoặc map refund sang Payout.
- Không hiển thị credential/reference bí mật trên UI/log.
- Không dùng entitlement xuất tài liệu để che/mở dữ liệu bản ghi.
