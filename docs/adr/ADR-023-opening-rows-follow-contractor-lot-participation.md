# ADR-023: Dòng biên bản mở thầu theo cặp nhà thầu–phần lô

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu sửa biên bản mở thầu `IB2600212155`

## Bối cảnh

Payload mở thầu của gói phân lô có thể đồng thời chứa:

- danh sách nhà thầu tổng hợp ở cấp gói;
- danh sách dự thầu chi tiết theo từng phần lô.

Nếu materialize cả hai nhóm, một trường hợp có 8 nhà thầu và 12 cặp nhà
thầu–phần lô tạo thành 20 dòng. Các dòng tổng hợp không có mã phần lô cũng làm
ô tên phần lô bị trống và không đại diện cho một dòng biên bản độc lập.

## Quyết định

- Với gói phân lô, đơn vị dòng của biên bản mở thầu là một cặp
  `nhà thầu + phần lô`.
- Khi một pha mở thầu đã có ít nhất một dòng theo phần lô, các dòng nhà thầu tổng
  hợp không có mã phần lô trong cùng pha chỉ là dữ liệu tóm tắt và không được
  materialize thành dòng biên bản.
- Nếu pha đó chưa có dữ liệu chi tiết theo phần lô, dòng tổng hợp vẫn được giữ làm
  fallback để không làm mất toàn bộ dữ liệu khi endpoint phần lô chưa trả kết quả.
- Mỗi bidder canonical theo phần lô mang cả `lotNo` và `lotName`. Mapper frontend
  chuyển thành `maPhanLo` và `tenPhanLo`; khi dựng dòng, dropdown mã phần lô đồng
  bộ ngay tên phần lô mà không đợi người dùng đổi lựa chọn.
- Giá trị bảo đảm dự thầu trên mỗi dòng nhà thầu lấy duy nhất từ trường canonical
  `bidGuarantee` của chính bidder và được ánh xạ thành `giaTriDamBao`. Trường
  `phanLoList[].baoDamDuThau` là yêu cầu bảo đảm của phần lô trong hồ sơ mời thầu;
  không được dùng làm fallback hoặc ghi đè giá trị bảo đảm mà nhà thầu đã nộp.
- Với gói phân lô, nguồn có thẩm quyền của `bidGuarantee` và hiệu lực bảo đảm là
  operation `OPENING_BID` (`/bid-open`). `OPENING_LOT_DETAIL` (`/lotOpenDetail`)
  chỉ cung cấp phạm vi nhà thầu–phần lô và có thể trả `null` cho bảo đảm; giá trị
  `null` này không được ghi đè dữ liệu từ `bid-open`. Kết quả không phụ thuộc thứ
  tự hai response vì các endpoint được gọi song song.
- Vì vậy 8 nhà thầu tham dự 12 phần lô tạo 12 dòng dự thầu, không phải 8 hoặc 20
  dòng.
- Preview đếm “nhà thầu” theo định danh nhà thầu/liên danh duy nhất, không theo số
  dòng dự thầu. Với gói phân lô, preview hiển thị riêng số nhà thầu, số phần lô và
  số dòng dự thầu.
- Trạng thái trong modal “Chọn thời gian mở thầu” dùng cùng phép đếm nhà thầu
  duy nhất; không được dùng độ dài danh sách dòng nhà thầu–phần lô.
- Khi người dùng chọn “Lấy dữ liệu mở thầu từ Mua sắm công” ngay trong thao tác tiến hành
  mở thầu, projection nguồn ghi đè draft vừa khởi tạo. Dòng nhập thủ công rỗng ban đầu không
  được giữ lại bên cạnh các dòng nguồn; nếu không chọn lấy dữ liệu nguồn thì dòng nhập thủ công
  ban đầu vẫn được giữ nguyên.
- Cột và dropdown mã phần lô dùng chiều rộng cố định `14rem`, đủ hiển thị mã phần
  lô chuẩn cùng nút mở dropdown mà không cắt bằng dấu ba chấm.

## Tác động tương thích

- Lần lấy dữ liệu mở thầu mới không còn tạo các dòng tổng hợp thừa cho gói phân lô.
- Bản nháp đã tạo trước thay đổi không bị tự động sửa hoặc xóa. Người dùng có thể
  lấy lại dữ liệu và chọn “Ghi đè toàn bộ draft” để thay thế bằng projection mới.
- Raw snapshot vẫn giữ đầy đủ payload nguồn; chỉ projection canonical/UI thay đổi.
- Không thay đổi role, module permission, capability, entitlement, tenant
  isolation, assignment scope, record scope, masking hoặc dữ liệu người dùng được
  phép xem.
- Chỉ số hiển thị trong modal được sửa; toàn bộ dòng dự thầu theo phần lô tiếp tục
  được giữ để áp dụng vào bản nháp và lưu theo luồng hiện hành.
- Luồng tiến hành mở thầu có chọn dữ liệu Mua sắm công không còn giữ dòng placeholder rỗng.
  Các draft có dữ liệu do người dùng nhập thủ công không bị tự động thay đổi ngoài thao tác
  import nguồn mà người dùng đã chủ động chọn.
- Với gói phân lô, bidder không có `bidGuarantee` sẽ để trống giá trị bảo đảm để người dùng
  kiểm tra/nhập; không còn tự điền bằng giá trị yêu cầu bảo đảm của phần lô. Biên bản đã lưu
  không bị viết lại tự động; thay đổi chỉ áp dụng khi dựng hoặc nhập lại draft.
- Draft lấy mới hoặc lấy lại từ Mua sắm công sẽ nhận bảo đảm theo `bid-open`; biên bản đã
  lưu không được tự động sửa và chỉ thay đổi khi người dùng chủ động nhập lại rồi lưu.

## Migration strategy

Không cần migration schema. Không tự động viết lại biên bản đã lưu. Dữ liệu chưa
lưu được làm sạch bằng thao tác lấy lại và ghi đè; dữ liệu đã lưu chỉ thay đổi khi
người dùng chủ động mở chỉnh sửa và lưu theo quy trình hiện hành.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_ib2600212155_opening_keeps_only_lot_bids_and_attaches_lot_names`
- `tests/test_muasamcong_integration_source.py::test_complete_notice_bundle_maps_opening_result_and_contract_sources`
- `tests/js/procurement_import_wizard.test.mjs` kiểm tra ánh xạ đồng thời mã và tên
  phần lô.
- `tests/js/opening_save_regressions.test.mjs` kiểm tra mã phần lô dài nhận đủ
  chiều rộng hiển thị.
- `tests/js/bid_process_tender_lifecycle_conflict.test.mjs` kiểm tra modal đếm hai
  nhà thầu duy nhất từ ba dòng dự thầu thuộc ba phần lô, trong khi vẫn áp dụng đủ
  ba dòng vào bản nháp và dùng chế độ ghi đè để loại dòng placeholder khởi tạo.
- `tests/js/procurement_import_wizard.test.mjs` kiểm tra ghi đè draft loại dòng rỗng ban đầu
  trước khi thêm các nhà thầu lấy từ Mua sắm công.
- `tests/js/procurement_import_wizard.test.mjs` kiểm tra `bidGuarantee` và hiệu lực bảo đảm
  của bidder được giữ khi ánh xạ vào draft.
- `tests/js/opening_save_regressions.test.mjs` kiểm tra renderer gói phân lô không fallback
  hoặc ghi đè giá trị bidder bằng `baoDamDuThau` của phần lô.
- `tests/test_muasamcong_integration_source.py::test_lot_opening_bid_guarantee_comes_from_bid_open_not_lot_open_detail`
  kiểm tra `bid-open` thắng `lotOpenDetail` ở cả hai thứ tự response.
