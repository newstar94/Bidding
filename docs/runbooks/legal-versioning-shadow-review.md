# Runbook shadow review và cutover Legal Versioning

Trạng thái áp dụng: ADR 0009. Quy trình này chỉ bổ sung catalog/binding provenance; không thay đổi quyền đọc, field visibility, tenant/module/assignment/record scope hay Word entitlement.

## 1. Điều kiện trước shadow

- Database đã nâng cấp tới schema có legal catalog/profile/policy và typed binding tables; backup/restore drill còn hiệu lực.
- Chỉ Super Admin hiện hữu quản trị catalog SYSTEM. Không tạo organization override, role hay capability mới.
- Văn bản nguồn đã được đối chiếu URL chính thức, ngày hiệu lực và nội dung trước khi publish; published version là bất biến.
- `LEGAL_VERSIONING_ENABLED=false` trong production cho tới khi shadow report và review hoàn tất.

## 2. Inventory chỉ-đọc

Chạy cho từng tenant để tạo bằng chứng review, không ghi binding và không auto-backfill legacy:

```powershell
python scripts/legal_versioning_inventory.py `
  --organization-id <organization-id> --verify-hashes `
  --output artifacts/legal-versioning-<organization-id>.json
```

Report phải luôn có `mode=READ_ONLY_RECONCILIATION` và `legacyAutoBackfill=false`. `legacyUnboundTargets` là hàng đợi review, không phải lỗi để tự gán luật hiện hành. Mọi hash mismatch là blocker; giữ report nguyên bản làm release evidence.

## 3. Shadow review

1. Super Admin tạo draft văn bản, kiểm tra nội dung/quan hệ/ngày hiệu lực rồi publish bằng CAS.
2. Tạo profile từ danh sách exact instrument version IDs theo đúng thứ tự; kiểm tra khoảng hiệu lực, priority và cờ manual review trước publish.
3. Với danh sách target đã được chủ sản phẩm chọn để shadow, mở đúng version Kế hoạch/Gói thầu và chạy Resolve. Không dùng bulk backfill.
4. Kết quả thiếu anchor phải là `UNRESOLVED`; overlap cùng priority là `AMBIGUOUS`; transition cần review là `MANUAL_REVIEW_REQUIRED`; chỉ exact interval là `RESOLVED`.
5. Chạy lại inventory. Đối với tập target shadow đã duyệt: không có status ngoài catalog, không có binding stale so với target rowVersion và mỗi `RESOLVED` trỏ exact profile/source hash đã review.
6. So sánh hai version: `LEGAL_RULES` chỉ `CONFIRMED` khi cả hai binding đã resolved và exact profile/policy khác nhau; mọi trường hợp thiếu authority là `NOT_EVALUATED`.

## 4. Cutover

1. Đóng cửa sổ publish catalog trong lúc chụp report cuối.
2. Chạy inventory SYSTEM-wide bằng tài khoản vận hành được phê duyệt và lưu artifact; không dùng report này để cấp quyền đọc target.
3. Bật `LEGAL_VERSIONING_ENABLED=true`, restart toàn bộ ASGI workers và kiểm tra readiness.
4. Smoke test danh mục Super Admin, binding Kế hoạch/Gói thầu, exact source/hash và comparison provider.
5. Mở lại publish catalog sau khi audit event, CAS conflict và 404/fresh-session boundary đều đạt.

Không yêu cầu `legacyUnboundTargets=0`: legacy chỉ được bind sau review theo danh sách được phê duyệt. Không được sửa expected test hoặc tạo fallback “latest” để làm report xanh.

## 5. Rollback

Đặt `LEGAL_VERSIONING_ENABLED=false` và restart workers. UI/API legal bị ẩn, comparison trả `LEGAL_VERSIONING_DISABLED/NOT_EVALUATED`; không xóa catalog, published sources, profile, policy hoặc append-only binding history. Sau rollback lưu report, audit chain và incident evidence trước khi thử cutover lại.
