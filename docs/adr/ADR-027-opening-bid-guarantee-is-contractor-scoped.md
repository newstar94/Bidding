# ADR-027: Bảo đảm dự thầu trong biên bản mở thầu thuộc nhà thầu

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Phạm vi: Nhập biên bản mở thầu từ Mua Sắm Công, gồm gói phân lô và hai túi hồ sơ

## Bối cảnh

Mua Sắm Công trả danh sách dòng mở thầu theo nhiều hình dạng. Với gói phân
lô, cùng một nhà thầu có thể xuất hiện ở nhiều dòng lô; `lotOpenDetail` có thể
trả `bidGuarantee = null`, còn giá trị thực tế của nhà thầu nằm ở `bid-open`.
Nếu lập chỉ mục theo `(nhà thầu, lô, phase)`, một dòng lô có giá trị sẽ không
được dùng cho các dòng lô khác của cùng nhà thầu.

## Quyết định nghiệp vụ

- `bid-open` là nguồn có thẩm quyền cho `bidGuarantee` và thời hạn bảo đảm của
  nhà thầu trong biên bản mở thầu.
- Khóa mapping là `(định danh nhà thầu, phase mở thầu)`, không bao gồm mã lô.
  Mọi dòng lô của cùng nhà thầu trong cùng phase nhận cùng giá trị bảo đảm.
- `lotOpenDetail` chỉ cung cấp phạm vi lô/tên lô và dữ liệu mở thầu khác; giá
  trị bảo đảm `null` ở đó không được ghi đè giá trị đã lấy từ `bid-open`.
- Giá trị `bidGuarantee` trong danh sách lô của thông báo mời thầu vẫn là dữ
  liệu bảo đảm theo lô cho form kế hoạch; nó không được dùng làm fallback cho
  bảo đảm của nhà thầu trong biên bản mở thầu.

## Tác động tương thích

- Khi nhập hoặc lấy lại biên bản mở thầu, các dòng lô của cùng nhà thầu được
  điền nhất quán cùng giá trị/hiệu lực bảo đảm.
- Dữ liệu lịch sử và các trường khác của dòng mở thầu không bị thay đổi; không
  thay đổi role, module permission, tenant isolation, assignment scope,
  record scope, masking hoặc entitlement.
- Gói không phân lô và các phase mở thầu khác tiếp tục dùng cùng nguồn
  `bid-open`, nhưng được tách khóa theo phase để không trộn dữ liệu kỹ thuật và
  tài chính.

## Contract thu thập, validation và cache

- Với LDT online, `OPENING_BID` chỉ thành công khi payload có
  `bidSubmissionByContractorViewResponse.bidSubmissionDTOList` dạng danh sách.
  Danh sách rỗng là một payload hợp lệ; field thiếu, container `null`, object rỗng
  hoặc payload scalar là `PROCUREMENT_SCHEMA_CHANGED` và làm opening `partial`.
- Collector lưu `requiredOpeningSources` theo từng `packType` vào revision raw
  snapshot. Gói `1_MTHS` dùng pack `0`; gói `1_HTHS` dùng pack kỹ thuật `1` và chỉ
  thêm pack tài chính `2` khi trạng thái nguồn cho phép mở tài chính.
- Khi notice hoặc response opening khai báo phân lô, `OPENING_LOT` và
  `OPENING_LOT_DETAIL` là nguồn bắt buộc của pack tương ứng. Cache chỉ được reuse
  khi mọi nguồn bắt buộc thành công và response `OPENING_BID` vẫn đạt schema
  contract; envelope thiếu response không phải bằng chứng hợp lệ.
- Snapshot tham chiếu `WEB_DAU_THAU` tại commit
  `0ccebd94a7819413730778ee9dec517a016cfbd0` gọi `notify`, `roundmng`,
  `bid-open`, `lot-open` và `lotOpenDetail`. Endpoint `/submission` chỉ được khai
  báo nhưng không có call site trong luồng opening đã xác minh, vì vậy
  `OPENING_SUBMISSION` không được thêm vào required set nếu chưa có live trace
  hoặc bằng chứng phiên bản mới chứng minh nó tham gia luồng.
- Raw response tiếp tục chỉ lưu server-side; patch không đưa token, cookie hoặc
  raw upstream payload ra public opening response.

## Migration strategy

Không cần migration schema. Quy tắc áp dụng ở lần nhập/resync mở thầu kế tiếp.
Bản ghi đã lưu không bị rewrite tự động; người dùng có thể lấy lại dữ liệu
`bid-open` để backfill các dòng còn thiếu. Rollback chỉ cần khôi phục logic
chọn theo khóa cũ, không xóa dữ liệu nguồn hay lịch sử.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_lot_opening_bid_guarantee_comes_from_bid_open_not_lot_open_detail`
- `tests/test_muasamcong_integration_source.py::test_lot_opening_bid_guarantee_is_reused_for_each_lot_of_the_bidder`
- `tests/test_muasamcong_integration_source.py::test_bidder_level_opening_fields_are_reused_for_every_lot`
- `tests/test_muasamcong_integration_source.py::test_bidder_level_opening_fields_do_not_cross_map_between_bidders`
- `tests/test_muasamcong_integration_source.py::test_bidder_level_opening_security_stays_with_its_two_envelope_phase`
- `tests/test_muasamcong_integration_source.py::test_opening_source_marks_invalid_required_bid_open_as_partial`
- `tests/test_procurement_import_routes.py::test_opening_cached_projection_matches_fresh_bidder_level_fields`
- `tests/test_procurement_import_routes.py::test_opening_prepare_rejects_cached_invalid_bid_open_schema`
- `tests/js/muasamcong_session_transport.test.mjs` kiểm tra schema `OPENING_BID`,
  required-source metadata, gói phân lô do notice khai báo và valid empty list.
