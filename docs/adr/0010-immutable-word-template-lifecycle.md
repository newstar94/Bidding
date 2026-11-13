# ADR 0010 — Lifecycle bất biến của biểu mẫu Word

- Trạng thái: Chấp nhận
- Ngày: 2026-08-24
- Phạm vi: Mục 15 và provenance dùng bởi mục 6/30

Mỗi biểu mẫu Word logic có lifecycle `DRAFT → PUBLISHED → RETIRED`, tối đa một published version hiện hành trong một scope; published bytes/mapping/manifest bất biến. Restore luôn tạo draft mới. Action authority tái sử dụng authorization của template CRUD/publication assignment hiện hữu, không thêm role/capability; mọi preview tạo/tải Word vẫn giữ Word entitlement hiện hữu. Published/retired/provenance giữ vô thời hạn, abandoned draft 90 ngày, preflight 30 ngày và temporary preview artifact 24 giờ. Assignment dùng `FOLLOW_PUBLISHED` theo logical identity để tương thích hiện hành, nhưng artifact luôn pin exact version/checksum. Rename chỉ đổi display/alias. Usage authoritative gồm explicit assignment và generated artifact provenance.

## Compatibility impact

Legacy replace không còn mutate published bytes sau cutover; filename không còn là identity. Explicit assignments ADR 0005 vẫn bắt buộc và không có active-template fallback. API/UI đọc record không thay đổi hoặc bị Word entitlement che field.

## Migration và rollback

Inventory file/hash/config hiện hữu thành initial logical template/version trong shadow phase, giữ exact assignments và legacy alias. Chỉ một write authority tại một thời điểm; parity trước cutover. Rollback dùng compatibility adapter cũ nhưng không xóa version/provenance mới.

## Regression seams

Immutable published bytes, stale CAS, one published head, restore-as-draft, preflight pinning, assignment follow/rename/no-orphan, legacy parity, retention, audit rollback, exact artifact provenance, record authorization và Word action-only entitlement.

## Cập nhật 2026-11-12: gỡ API và giao diện vòng đời

- Ngày 2026-09-19 (commit `5c603f7a`), chủ sản phẩm đã gỡ giao diện "Vòng đời biểu mẫu Word" (`WordTemplateCatalog.js/.css`) và thôi mount các route `/api/word-template-catalog/*`.
- Ngày 2026-11-12, chủ sản phẩm duyệt xóa phần còn sót: `backend/documents/template_catalog/routes.py`, khối HTML ẩn `#word-template-catalog-card` trong `views/tabs/tab_bieumau.html` và các test chỉ kiểm tra các route đó.
- Không đổi hành vi: các route đã không còn truy cập được từ 2026-09-19. Phần còn dùng khi xuất Word vẫn giữ nguyên, cùng test của chúng:
  - `service`, `repository`, `storage`, `preflight`;
  - `compatibility` (`catalog_enabled`, chế độ cutover, alias projection, janitor retention).
- Khi chưa có API, không có cách tạo hay phát hành phiên bản catalog mới từ ứng dụng. Muốn bật lại tính năng thì khôi phục từ lịch sử git và mount lại route.
