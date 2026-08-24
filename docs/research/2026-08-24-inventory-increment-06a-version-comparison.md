# Inventory triển khai increment 6A — So sánh phiên bản

## Phạm vi đã đủ contract

- Read-only compare cho hai snapshot `kehoach` hoặc `goithau` trong cùng tenant,
  entity type và dòng phiên bản.
- Hai version phải được authorize độc lập bằng `VisibilityScope`; version bị từ
  chối không được lộ metadata hay dữ liệu.
- Sau authorization, giá trị nghiệp vụ được trả đầy đủ. Chỉ metadata kỹ thuật
  của sync/version và secret nội bộ không thuộc aggregate bị loại khỏi diff.
- Không migration, không write lock, không mutation, không liên hệ quyền đọc với
  Word entitlement.

## Seam tái sử dụng

- `backend/sync/visibility_scope.py`: SQL predicate chuẩn cho tenant, module,
  assignment và record scope.
- `backend/sync/version_metadata.py`: contract authorize riêng từng version và
  nhận diện dòng phiên bản bằng `id_goc`.
- `backend/sync/payload_mapping.py` + `backend/sync/mapper.py`: projection DB →
  JSON và aggregate child projection hiện hữu.
- `backend/versioning/aggregate_policy.py`: catalog relation thuộc snapshot.
- `backend/timeline/effective_timeline.py`: projection timeline deterministic.
- `frontend/shared/VersionSelector.js`, `VersionFamilyLoader.js` và package detail
  view model: chỉ cung cấp tập version server đã công bố.

## Seam public sẽ thêm và test

1. Pure `compare_snapshots(left, right, ...)` cho scalar/object/relation.
2. `VersionComparisonService.compare(...)` orchestration + authorization boundary.
3. `POST /api/version-comparisons/query` với strict body và error code ổn định.
4. `VersionComparisonPanel` dùng hai version selector, tabs, filter và request
   cancellation; backend vẫn là authority.

## Giới hạn increment

- Timeline và assignment có provider authoritative trong 6A.
- Progress/workflow, document, evaluation, contract, notification, compliance,
  generated Word và legal rules luôn hiện với `POTENTIAL` hoặc
  `NOT_EVALUATED`; không kết luận file lỗi thời hay luật áp dụng.
- Relation phân trang theo cursor gắn exact entity/version/rowVersion/content;
  aggregate snapshot có tổng budget 5.000 relation rows. Identity mơ hồ được báo
  `ambiguousMatches` kèm đầy đủ old/new values đã authorize, không ghép theo
  physical child ID/index hay mutable name/content fallback.
- Các mục 7/8/12/15/19/20/21/30 vẫn bị chặn tại decision gate tương ứng trong
  kế hoạch; inventory này không chọn default thay cho chủ sản phẩm.

## Handoff sau triển khai

Increment 6A đã được triển khai sau inventory này:

- API: `POST /api/version-comparisons/query`, strict body, hỗ trợ `kehoach` và
  `goithau`; transaction `REPEATABLE READ READ ONLY`, authorize hai version trước
  khi load aggregate, từ chối khác tenant/dòng phiên bản.
- Diff: scalar/object/nested relation; type-aware decimal/date/time normalization;
  loại metadata sync/version kỹ thuật; giữ đầy đủ business values; relation chỉ
  dùng policy/business identity khai báo, báo ambiguity thay vì đoán theo physical
  ID/index/content; ordered criteria có order change; cursor tối đa 500 item/trang
  và aggregate hard cap 5.000 relation rows.
- Impact: timeline và assignment providers; mọi nhóm chưa có authority vẫn trả
  `NOT_EVALUATED`. Không có legal/generated-Word conclusion.
- UI: Kế hoạch và Gói thầu, dùng hai `VersionSelector` hiện hữu trên tập version
  server đã scope; bốn tab Tổng quan/Field/Relation/Tác động; filter change type,
  tải relation page tiếp theo, loading/error/empty, stale-request cancellation,
  keyboard/focus/axe contract.
- Rollout: `VERSION_COMPARISON_ENABLED`; development mặc định bật, production
  mặc định tắt. Rollback chỉ tắt flag; không có schema, cache hay dữ liệu mới.

Compatibility impact: thêm read-only route và nút UI sau flag; không đổi role,
module permission, assignment/record scope, capability, entitlement, masking,
redaction, field visibility, version data hay mutation semantics.

Quality gate ngày 2026-08-24: `npm run check:quality` pass với 1.698 backend tests,
61,89% backend coverage, critical backend coverage pass, full JS coverage suite
và critical JS coverage pass. Targeted Playwright + axe cho comparison dialog pass.
