# ADR-011: TBMT liên kết nhiều phiên bản được lưu đủ trên cùng dòng gói thầu

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Phạm vi: Nhập kế hoạch MSC có gói đã liên kết TBMT

## Bối cảnh

Một kế hoạch MSC có thể liên kết tới TBMT đã được sửa nhiều lần. Ví dụ
`PL2600122143` liên kết với `IB2600212155`, trong đó nguồn có phiên bản TBMT
`00` và `01`. Trước thay đổi này, bước làm giàu kế hoạch chỉ chọn phiên bản
mới nhất (`01`), khiến khi tạo kế hoạch mới Bidding chỉ có snapshot gói `01` và
không lưu được lịch sử `00`.

## Quyết định

- Giữ đầy đủ các phiên bản TBMT đã có trong COMPLETE source evidence.
- Khi nhập kế hoạch, mỗi phiên bản TBMT được materialize thành một snapshot
  trên cùng `rootId` của gói; ví dụ `00 → 01`.
- `isLatest` chỉ bật trên snapshot TBMT mới nhất. Người dùng chỉnh sửa bản mới
  nhất trong form; snapshot cũ được lưu như lịch sử bất biến.
- Trục phiên bản kế hoạch và trục phiên bản TBMT vẫn độc lập: một kế hoạch
  `00` không tạo thêm kế hoạch `01` chỉ vì TBMT có `01`.
- Nếu kế hoạch liên kết chính xác tới một phiên bản cũ, chỉ các phiên bản TBMT
  không vượt quá phiên bản đó được materialize; không đưa dữ liệu tương lai vào
  snapshot kế hoạch.
- Raw/canonical evidence vẫn được giữ ở server; danh sách lịch sử truyền vào
  draft session chỉ chứa dữ liệu cần cho materialization.

## Compatibility impact

- Bản ghi mới nhập từ MSC có thể tạo thêm các dòng `goi_thau` lịch sử cùng
  `rootId`; danh sách hiện hành tiếp tục chỉ hiển thị snapshot `isLatest`.
- Không thay đổi role, permission, tenant, assignment, record scope, masking
  hoặc quyền xem dữ liệu.
- Không thay đổi quy tắc khóa trường sau khi phát hành; chỉ phiên bản nguồn
  được xác thực mới được materialize.

## Migration and rollback

Không cần migration schema hoặc ghi lại dữ liệu cũ. Quy tắc áp dụng cho lần
nhập/resync tiếp theo. Rollback bằng cách bỏ phần mở rộng lịch sử trong
prepare/session/materializer; các snapshot đã lưu vẫn phải được xử lý theo
quy tắc bất biến hiện hành.

## Regression tests

- `tests/test_procurement_import_service.py::test_plan_session_keeps_all_linked_notice_revisions_on_one_package_lineage`
- `tests/js/plan_breakdown_draft_transaction.test.mjs::new plan import materializes every prior linked notice revision on one package root`
