# ADR 0007 — Phạm vi đọc operation procurement và metadata phiên bản

- Trạng thái: Chấp nhận
- Ngày: 2026-08-23
- Phạm vi: Procurement operation GET; `allVersions` trong list/detail API

## Bối cảnh và quyết định

Chủ sản phẩm xác nhận ngày 2026-08-23 rằng việc đọc operation procurement phải
dùng tenant, module view, active persona, assignment scope và record scope hiện
hành. Operation không thuộc riêng người tạo: một người khác có quyền đọc bản ghi
đích được phép xem trạng thái operation. Plan operation dùng phạm vi kế hoạch;
notice operation dùng phạm vi gói thầu đích. Nếu operation chưa có bản ghi đích
để đánh giá, module view là ranh giới khả dụng sau tenant/session check.

Metadata `allVersions` không có policy family-wide riêng. Mỗi phiên bản chỉ xuất
hiện khi chính phiên bản đó thỏa cùng authoritative `VisibilityScope` mà detail
API áp dụng tại thời điểm yêu cầu. Quyền đọc một phiên bản không tự làm lộ ID,
số phiên bản hoặc metadata của phiên bản khác. Khi một phiên bản được phép đọc,
dữ liệu bản ghi vẫn đầy đủ theo business contract; quyết định này không thêm
masking, capability nhạy cảm hoặc liên hệ với Word entitlement.

## Compatibility impact

- Operation GET trước đây tenant-scoped; người cùng tenant nhưng thiếu module
  view hoặc ngoài record/assignment scope giờ nhận lỗi authorization hiện hành.
- Người không tạo operation nhưng có quyền đọc bản ghi đích vẫn được xem.
- `allVersions` có thể chứa ít phần tử hơn nếu các phiên bản trong cùng lineage
  có assignment/record scope khác nhau.
- Role, permission, assignment inheritance, field visibility và response fields
  của từng bản ghi được phép đọc không thay đổi.

## Migration và rollout

Không có schema/data migration. Deploy backend cùng regression suite trước khi
mở traffic. Client phải tiếp tục hoạt động khi `allVersions` chỉ chứa tập con có
thẩm quyền; không được tự tải một version không được server công bố.

## Regression seams

- HTTP `GET /api/procurement/imports/operations/{operation_id}`: đúng tenant,
  module view, active Manager/Employee, assigned/unassigned plan và notice target,
  non-actor in-scope, permission/assignment revocation và operation chưa có target.
- HTTP list và detail API: cùng session/persona phải trả cùng tập ID trong
  `allVersions`; từng version bị loại bởi `VisibilityScope` không được xuất hiện,
  còn version được phép đọc vẫn giữ đầy đủ trường theo business contract.
