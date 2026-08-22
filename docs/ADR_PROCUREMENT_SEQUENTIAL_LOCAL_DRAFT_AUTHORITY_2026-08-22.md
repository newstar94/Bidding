# ADR: Authority của draft cục bộ trong chuỗi revision Mua Sắm Công

Ngày: 2026-08-22
Trạng thái: Đã chấp thuận bởi chủ sản phẩm

## Quyết định

Khi một revision Mua Sắm Công đã được materialize hợp lệ vào plan-version draft, flow
phải lưu fingerprint authority chính xác của kế hoạch và các gói thầu vừa materialize.
Revision kế tiếp được phép tiếp tục trên fingerprint đó, kể cả khi người dùng đã thực
hiện các chỉnh sửa cục bộ hợp lệ trong draft như chọn chuyên gia, assignment hoặc sửa
trường nghiệp vụ của gói thầu.

Fingerprint chỉ gồm identity và version authority (`id`, `rootId`, `localVersion`,
`rowVersion`) và phải thuộc đúng import session. Nếu bản ghi plan/package không còn
khớp fingerprint, CAS tiếp tục báo `PROCUREMENT_PREVIEW_STALE`.

Khi resume sau F5, fingerprint được phục hồi từ aggregate của plan-version draft thuộc
đúng import session trước khi materialize revision hiện tại hoặc revision kế tiếp.

Quyết định này không tự thay đổi chuyên gia, chủ đầu tư, nhà thầu hay quyền truy cập;
không thay đổi masking, record scope hoặc dữ liệu người dùng được phép xem.

## Compatibility impact

- Chỉnh chuyên gia gói thầu ở revision 00 không còn làm revision 01 bị coi là preview
  cũ chỉ vì revision 00 do chính flow vừa tạo.
- Assignment chuyên gia hợp lệ được kế thừa qua seam tạo revision kế tiếp theo cơ chế
  draft hiện hành.
- Thay đổi thật về `rowVersion`, identity hoặc latest snapshot sau materialization vẫn
  bị chặn bằng `PROCUREMENT_PREVIEW_STALE`.

## Migration strategy

Không cần migration dữ liệu hoặc schema. Fingerprint chỉ tồn tại trong lifecycle của
flow import client và được tạo lại từ draft khi resume/materialize.

## Regression coverage

- `tests/js/plan_breakdown_draft_transaction.test.mjs`: chuỗi revision 00 → đổi chuyên
  gia gói → lưu trung gian → revision 01 tiếp tục và kế thừa assignment.
- `tests/js/procurement_import_wizard.test.mjs`: thay đổi `rowVersion` của plan hoặc
  package sau fingerprint vẫn bị từ chối; resume sau một revision durable phục hồi đúng
  fingerprint plan/package.
