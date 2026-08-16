# ADR-027: Bảo đảm dự thầu trong biên bản mở thầu thuộc nhà thầu

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Phạm vi: Nhập biên bản mở thầu từ Mua Sắm Công cho gói thầu phân lô

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

## Migration strategy

Không cần migration schema. Quy tắc áp dụng ở lần nhập/resync mở thầu kế tiếp.
Bản ghi đã lưu không bị rewrite tự động; người dùng có thể lấy lại dữ liệu
`bid-open` để backfill các dòng còn thiếu. Rollback chỉ cần khôi phục logic
chọn theo khóa cũ, không xóa dữ liệu nguồn hay lịch sử.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_lot_opening_bid_guarantee_comes_from_bid_open_not_lot_open_detail`
- `tests/test_muasamcong_integration_source.py::test_lot_opening_bid_guarantee_is_reused_for_each_lot_of_the_bidder`
