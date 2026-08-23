# ADR 0003 — Procurement write authorization và active persona nhất quán

- Trạng thái: Chấp nhận
- Ngày: 2026-08-22
- Phạm vi: Procurement import apply/reconcile/resume; AI search, analytics và sync

## Bối cảnh

Prepare procurement import là thao tác xem trước và được phép dùng quyền view.
Các đường apply/reconcile/notice apply/resume trước đây có thể tiếp tục dùng ngữ
cảnh từ prepare mà không tính lại đầy đủ quyền edit, assignment/record scope và
actor operation trong transaction ghi. Quyền hoặc active persona bị thay đổi
giữa prepare và apply vì vậy có thể tạo TOCTOU.

Ở chiều đọc, AI search và analytics có nhánh dựa vào membership Manager nên bỏ
assignment filter dù session đang chủ động chọn persona Employee. Sync lại tự
tính module permission khác authoritative access policy, làm mất inherited view
hợp lệ của Manager đang dùng persona Employee.

Business contract hiện hành xác nhận:

- Persona Employee luôn chịu assignment và record scope, kể cả membership là
  Manager.
- Manager dùng persona Employee được kế thừa module view nhưng không kế thừa
  edit.
- Khi một record đã được phép đọc, toàn bộ field hiện hành vẫn được trả về;
  không thêm masking/capability nhạy cảm và không dùng Word entitlement để che
  dữ liệu.

## Quyết định

1. Prepare tiếp tục dùng module view và không persist business mutation.
2. Mọi apply/reconcile/notice apply/resume reload và lock operation/record cần
   thiết trong cùng transaction `SERIALIZABLE` dùng để ghi.
3. Trong transaction đó, server tính lại session, tenant, active persona,
   module edit, assignment scope, record scope và quyền tiếp tục operation.
   Row session/account, membership/organization và permission matrix hiện hành
   được đọc có khóa trước authorization; snapshot `SessionRole` từ đầu request
   không được dùng làm authority ghi.
4. Plan apply kiểm tra plan hiện hữu và mọi package hiện hành thuộc family;
   notice apply kiểm tra target package. Một record bị từ chối làm rollback toàn
   bộ phần mutation còn lại của operation.
5. Actor của operation được kiểm tra lại sau khi row operation đã lock. Permission
   bị thu hồi trước resume có hiệu lực cả với replay operation đã completed.
   Resume reload manifest sau khi khóa operation và giữ cùng transaction
   `SERIALIZABLE` đó xuyên suốt các revision còn lại.
6. Các revision còn lại của một multi-revision apply dùng một transaction business
   chung. Failure ở revision sau rollback toàn bộ các revision còn lại; progress
   chỉ cập nhật sau commit hoặc đánh dấu failed sau rollback.
7. `is_assignment_scoped_active_role()` là seam chuẩn để quyết định persona hiện
   hành có chịu assignment scope hay không.
8. AI workspace search và analytics dùng active persona thay vì membership role
   để quyết định assignment filter.
9. Sync lấy module view qua `has_module_permission()` để giữ inherited view hợp
   lệ, đồng thời vẫn áp assignment scope khi active persona là Employee.

Quyết định này không thay đổi field visibility, role, module permission,
entitlement, inheritance hay default allow/deny. Nó thực thi contract đã có tại
đúng write/read seam.

## Compatibility impact

- Request prepare hợp lệ trước đây vẫn hợp lệ.
- Apply/resume dùng permission snapshot cũ hoặc operation của actor khác giờ trả
  lỗi authorization hiện hành và không ghi; đây là sửa TOCTOU theo contract.
- Manager đang dùng persona Manager giữ phạm vi hiện hành.
- Manager đang dùng persona Employee chỉ thấy record assigned/in-scope nhưng vẫn
  có inherited module view; edit không được kế thừa.
- Response record không bị lọc/rút gọn; CCCD, ngân hàng, tài khoản, chữ ký, con
  dấu và field liên quan vẫn đầy đủ sau khi record authorization cho phép đọc.
- Procurement operation GET và `allVersions` metadata không nằm trong quyết định
  này vì contract của hai đường đọc đó chưa được chủ sản phẩm xác nhận.

## Migration và rollout

- Không có schema/data migration cho ADR này.
- Deploy backend và chạy P0 regression suite trước khi mở write traffic.
- Không cần client migration; error/response shape hiện hành được giữ nguyên.
- Audit và tenant/session/module/assignment/record gates không được tắt trong
  rollout.

## Rollback strategy

Code có thể rollback về release trước mà không đổi schema, nhưng rollback sẽ mở
lại TOCTOU và semantics active-persona không nhất quán. Chỉ rollback khi release
failure khác ngăn hệ thống vận hành, cô lập write traffic trước, rồi roll-forward
fix sớm nhất có thể.

## Regression seams

- `tests/test_procurement_import_routes.py`: reauthorization trong transaction,
  session/persona reload, từng record scope, actor/operation lock, permission
  revocation, notice scope, cross-tenant denial, resume và atomic multi-revision
  rollback.
- `tests/ai/test_ai_permission_context.py` và
  `tests/ai/test_ai_workspace_search.py`: active persona và assignment scope.
- `tests/test_sync_delta_paging.py`: inherited module view cùng assignment scope.
- `tests/test_record_access_projection.py`: record projection/field visibility
  contract hiện hành và ma trận cùng tập ID qua list/detail/sync/AI/analytics.
