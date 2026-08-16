# ADR-008: Gói MSC không phân lô không materialize dòng phần lô kỹ thuật

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu sửa `SYNC_ITEM_INVALID` cho gói không phân lô nhập từ Mua Sắm Công

## Bối cảnh và quyết định

Mua Sắm Công có thể trả `isMultiLot = false` nhưng vẫn chứa một dòng trong
`bidpBidLotList` mang mã, tên và giá của chính gói. Dòng này là cấu trúc kỹ
thuật/tóm tắt của nguồn, không phải một phần lô nghiệp vụ.

BiddingFlow coi cờ phân lô chuẩn hóa là căn cứ xác định phạm vi hàng hóa:

- Chỉ khi `isMultiLot is True` mới materialize `lots` thành `phanLoList`.
- Khi `isMultiLot` là `False` hoặc không xác định, `lots` và
  `danhSachPhanLo` phải rỗng; không tạo phần lô tổng hợp.
- Hàng hóa của gói không phân lô thuộc trực tiếp gói và có `phanLoId = null`.
- Linked notice chỉ được làm giàu danh sách phần lô khi gói được xác định là
  phân lô.
- Sync validator tiếp tục từ chối payload có `phanLo = "Không"` nhưng còn
  `phanLoList`; validator không tự sửa dữ liệu.

## Tác động tương thích

- Gói phân lô thật tiếp tục giữ đầy đủ phần lô và dữ liệu bảo đảm dự thầu theo
  từng phần lô.
- Gói không phân lô không còn hiển thị hoặc đồng bộ dòng phần lô kỹ thuật của
  MSC.
- Không thay đổi role, permission, tenant isolation, assignment scope, record
  scope, entitlement, masking hoặc quyền đọc dữ liệu.
- Các import session cũ có canonical payload mâu thuẫn vẫn an toàn khi
  materialize vì draft mapping và frontend đều áp dụng cùng phòng vệ.

## Migration strategy

Không cần migration schema. Import/resync mới được chuẩn hóa từ canonical.
Import session cũ được chuẩn hóa khi chuyển thành draft. Bản ghi chưa đồng bộ
do lỗi có thể được nhập lại; không nới validator và không tự động sửa bản ghi
đã commit hợp lệ.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_non_lot_notice_normalization_drops_single_package_summary_lot`
- `tests/test_muasamcong_browser_lookup.py::test_non_lot_package_parser_drops_single_source_lot`
- `tests/test_procurement_import_service.py::test_non_lot_plan_ignores_synthetic_single_lot_from_linked_notice`
- `tests/js/plan_breakdown_draft_transaction.test.mjs` — `non-lot procurement package drops a synthetic source lot before sync`

