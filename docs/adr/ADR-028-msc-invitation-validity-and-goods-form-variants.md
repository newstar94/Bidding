# ADR-028: Biến thể hiệu lực HSDT và biểu mẫu hàng hóa MSC được chuẩn hóa

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu xử lý lỗi nhập `PL2600029845` và `PL2600100697`

## Bối cảnh và quyết định

Payload TBMT của Mua Sắm Công không dùng một tên trường hoặc một mã biểu mẫu duy nhất
cho cùng dữ liệu nghiệp vụ:

- `IB2600079201` và `IB2600079204` trả hiệu lực HSDT bằng
  `bidValidityPeriod`, không có bản sao `effectTimeHSDT` trong biểu mẫu E-HSMT.
- `IB2600206192` trả 11 mặt hàng hợp lệ trong biểu mẫu `BD.CG.02.0090`.
  Cùng danh sách có thể xuất hiện trong cả nguồn chi tiết thông báo và nguồn HSMT.

BiddingFlow chuẩn hóa `bidValidityPeriod` thành `bidValidityDays` giống các alias hiệu
lực theo ngày đã được hỗ trợ. Biểu mẫu `BD.CG.02.0090` được công nhận là nguồn danh mục
hàng hóa phạm vi gói, dùng cùng điều kiện materialize hiện hành: dòng phải có định danh
nguồn, tên, đơn vị tính và số lượng dương. Các bản sao cùng định danh nguồn được khử trùng
lặp; không tạo lô giả và không suy đoán dữ liệu còn thiếu.

## Tác động tương thích

- Gói đã mời thầu dùng `bidValidityPeriod` không còn bị đồng bộ với
  `hieuLucHsdt = null` khi nguồn đã trả số ngày hợp lệ.
- Gói không phân lô dùng `BD.CG.02.0090` có thể materialize thêm các dòng
  `goi_thau_hang_hoa` mà trước đây chỉ nằm trong raw evidence.
- Không ghi đè danh mục hàng hóa người dùng đã lưu; quy tắc backfill hiện hành của
  ADR-006 giữ nguyên.
- Không thay đổi role, module permission, tenant isolation, assignment scope,
  record scope, masking, entitlement hay dữ liệu người dùng được phép xem.

## Migration strategy

Không cần migration schema hoặc rewrite dữ liệu. Người dùng lấy lại dữ liệu từ Mua Sắm
Công để remap raw snapshot và backfill gói chưa có danh mục. Gói đã có danh mục tiếp tục
được bảo toàn. Rollback bằng cách bỏ alias và mã biểu mẫu khỏi mapper; dữ liệu đã
materialize vẫn là dữ liệu nguồn hợp lệ và không cần xóa.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_notice_bid_validity_period_maps_without_embedded_form_fallback`
- `tests/test_muasamcong_integration_source.py::test_goods_form_0090_maps_real_non_lot_rows_once_across_notice_sources`

