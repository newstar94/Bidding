# PROMPT CHO CODEX: MỞ RỘNG NGHIỆP VỤ HÀNG HÓA CHO GÓI THẦU HỖN HỢP VÀ XUẤT DANH SÁCH HÀNG HÓA TRÚNG THẦU

## 1. Vai trò và yêu cầu thực hiện

Bạn đang làm việc trực tiếp trên repository **BiddingFlow**. Hãy **nghiên cứu mã nguồn hiện tại trước khi sửa**, sau đó triển khai hoàn chỉnh, chạy kiểm thử và báo cáo kết quả.

Không dừng ở việc phân tích hoặc viết kế hoạch. Phải sửa code thật, bổ sung kiểm thử, chạy các lệnh kiểm tra phù hợp và xử lý các lỗi hồi quy phát sinh.

Trước khi bắt đầu:

1. Đọc `README.md`, các file hướng dẫn dành cho agent như `AGENTS.md`, `CONTEXT.md` nếu tồn tại.
2. Kiểm tra trạng thái Git, nhánh hiện tại và các thay đổi chưa commit. Không ghi đè hoặc xóa thay đổi không thuộc phạm vi công việc.
3. Đọc kỹ toàn bộ luồng hiện có liên quan đến:
   - danh mục hàng hóa của gói thầu;
   - hàng hóa dự thầu của từng nhà thầu;
   - ưu đãi hàng hóa và xếp hạng;
   - chốt kết quả lựa chọn nhà thầu;
   - kết quả theo phần lô;
   - xuất Excel;
   - sync frontend/backend, phân quyền, trạng thái khóa dữ liệu và dữ liệu offline.
4. Tìm **toàn bộ** điều kiện đang giới hạn nghiệp vụ hàng hóa ở `linhVuc === "Hàng hóa"`, không chỉ sửa các file được nêu trong prompt này.

---

## 2. Bối cảnh mã nguồn hiện tại cần lưu ý

Mã hiện tại đã có các cấu phần chính sau; hãy tái sử dụng và mở rộng thay vì tạo luồng song song:

- Danh mục hàng hóa yêu cầu của gói thầu: `goi_thau_hang_hoa` / `model.state.goithauhanghoa`.
- Hàng hóa dự thầu của nhà thầu: `hang_hoa_du_thau_nha_thau` / `model.state.hanghoaduthaunhathau`.
- Liên kết quan trọng của hàng hóa dự thầu:
  - `goiThauId`;
  - `thongTinMoThauId`;
  - `phanLoId`;
  - `goiThauHangHoaId`;
  - `isDraft`;
  - `sortOrder`.
- Giá gốc của từng dòng:
  - `donGiaDuThau`;
  - `thanhTienDuThau`.
- Giá trị sau giảm giá nhưng **trước ưu đãi** đã được hệ thống phân bổ theo dòng ở trường:
  - `giaTriCoSoSauGiamGia`.
- Các trường liên quan ưu đãi/xếp hạng, **không được dùng làm giá trúng thầu để xuất**:
  - `giaTriCongUuDai`;
  - `giaDuThauSauUuDai`;
  - `thanhTienSauUuDai`;
  - `giaSoSanhSauUuDai`;
  - `giaDanhGiaSauUuDai`;
  - `giaXepHang`.
- Nhà thầu trúng thầu toàn gói hiện được lưu tại `goi_thau.nhaThauTrungThauId`.
- Với gói phân lô, nguồn sự thật của từng phần lô là `phanLoList[].nhaThauTrungThauId`; không được chỉ dựa vào nhà thầu trúng thầu cấp gói.

Các file cần đọc kỹ, nhưng không giới hạn ở:

### Frontend

- `frontend/packages/PackageGoodsWorkflow.js`
- `frontend/packages/PackageGoodsExcel.js`
- `frontend/packages/packageGoodsValidation.js`
- `frontend/packages/packageGoodsVersioning.js`
- `frontend/packages/BidderGoodsWorkflow.js`
- `frontend/packages/BidderGoodsExcel.js`
- `frontend/packages/bidderGoodsSelectors.js`
- `frontend/packages/bidderGoodsValidation.js`
- `frontend/packages/bidderGoodsMapping.js`
- `frontend/packages/bidderGoodsPreference.js`
- `frontend/packages/detailedEvaluationRules.js`
- `frontend/packages/DetailedEvaluationSaveWorkflow.js`
- `frontend/shared/BiddingCalculations.js`
- `frontend/packages/bidProcessAwardResult.js`
- `frontend/packages/lotAwardResultScope.js`
- `frontend/packages/lotEvaluationScope.js`
- `frontend/packages/openingContractorLookup.js`
- `frontend/partners/contractorVersionBinding.js`
- `frontend/packages/detail/PackageTabs.js`
- `frontend/packages/detail/AwardResultDetailsPanel.js`
- `frontend/packages/detail/AwardResultPanel.js`
- `frontend/packages/detail/AwardResultViewModel.js`
- `frontend/packages/detail/AwardResultSummaryPresentation.js`
- `frontend/packages/GoiThauDetail.js`

### Backend

- `backend/sync/package_goods.py`
- `backend/sync/bidder_goods.py`
- `backend/sync/payload_validation.py`
- `backend/sync/ownership.py`
- `backend/shared/access_policy.py`
- schema, migration, query mapping và các validator liên quan nếu có.

### Kiểm thử hiện có

- `tests/js/package_goods.test.mjs`
- `tests/js/bidder_goods.test.mjs`
- `tests/js/package_tabs_partial_result.test.mjs`
- `tests/test_package_goods.py`
- `tests/test_bidder_goods.py`
- các test Excel/document worker và test lifecycle liên quan.

---

# PHẦN A — MỞ RỘNG TOÀN BỘ NGHIỆP VỤ HÀNG HÓA CHO GÓI THẦU HỖN HỢP

## 3. Quy tắc lĩnh vực dùng chung

Hiện nhiều nơi đang kiểm tra trực tiếp:

```js
pkg.linhVuc === "Hàng hóa"
```

hoặc tương đương ở Python:

```python
linh_vuc == "Hàng hóa"
```

Phải mở rộng để **cả hai lĩnh vực sau đều có nghiệp vụ hàng hóa**:

- `Hàng hóa`
- `Hỗn hợp`

Nên tạo hoặc sử dụng một helper dùng chung, có tên tường minh, ví dụ:

```js
supportsGoodsWorkflow(pkg)
```

và phía backend nếu cần:

```python
supports_goods_workflow(linh_vuc)
```

Helper phải:

- chuẩn hóa chuỗi bằng `trim`;
- trả về `true` cho `Hàng hóa` và `Hỗn hợp`;
- trả về `false` cho các lĩnh vực khác;
- được dùng thống nhất thay cho việc lặp lại điều kiện rải rác.

Không được vô tình bật nghiệp vụ hàng hóa cho `Tư vấn`, `Phi tư vấn`, `Xây lắp` hoặc lĩnh vực không phù hợp.

## 4. Các luồng bắt buộc phải hỗ trợ `Hỗn hợp`

Rà soát và mở rộng tối thiểu các nhóm sau:

### 4.1. Danh mục hàng hóa của gói thầu

Gói `Hỗn hợp` phải có đầy đủ chức năng như gói `Hàng hóa`:

- hiển thị tab/danh mục hàng hóa;
- thêm, sửa, xóa hàng hóa khi gói còn ở trạng thái cho phép;
- nhập Excel;
- xem trước dữ liệu nhập;
- xuất Excel;
- phân lô và ánh xạ hàng hóa vào phần lô;
- sao chép hàng hóa khi tạo phiên bản/snapshot mới của gói thầu;
- kiểm tra trùng mã hàng hóa theo đúng phạm vi;
- khóa chỉnh sửa theo trạng thái gói;
- đồng bộ frontend/backend;
- phân quyền và ownership giống gói hàng hóa.

Cập nhật `isPackageGoodsEditable` và mọi điều kiện hiển thị tab `goods`.

### 4.2. Hàng hóa dự thầu của nhà thầu

Gói `Hỗn hợp` phải có tab/nhóm `bidder_goods` trong đúng các vòng đánh giá như gói `Hàng hóa`:

- một giai đoạn một túi hồ sơ: trong luồng đánh giá chi tiết trước phần tài chính;
- một giai đoạn hai túi hồ sơ: trong vòng tài chính, không hiển thị ở vòng kỹ thuật;
- giữ nguyên quy tắc chỉ được chốt danh mục hàng hóa sau khi phần kỹ thuật đã hoàn thành và đạt;
- giữ nguyên kiểm tra đủ hàng hóa yêu cầu, mapping, tổng tiền, trạng thái bản nháp và ưu đãi.

Phải cập nhật tối thiểu:

- `shouldShowBidderGoodsTab`;
- `resolveDetailedEvaluationContext`;
- `shouldValidateBidderGoodsOnCompletion`;
- các điều kiện khóa/mở nhóm đánh giá;
- backend `validate_bidder_goods_batch`.

### 4.3. Ưu đãi hàng hóa và xếp hạng

Đối với phần hàng hóa của gói `Hỗn hợp`, giữ nguyên cơ chế ưu đãi hiện tại như gói `Hàng hóa`:

- dữ liệu ưu đãi chỉ phục vụ so sánh/xếp hạng;
- trạng thái ưu đãi chưa sẵn sàng phải tiếp tục chặn xếp hạng khi phương pháp đánh giá yêu cầu;
- `goodsPreferenceRankingBlockReason` và `calculateRankings` phải nhận diện `Hỗn hợp` là lĩnh vực có nghiệp vụ hàng hóa;
- không thay đổi công thức ưu đãi hiện có ngoài phạm vi cần thiết;
- frontend và backend phải tiếp tục cho kết quả nhất quán.

### 4.4. Backend và thay đổi cấu hình gói

Sửa các validator backend đang chỉ chấp nhận `Hàng hóa`.

Đặc biệt, với gói đã có danh mục hàng hóa:

- cho phép đổi lĩnh vực qua lại giữa `Hàng hóa` và `Hỗn hợp` mà không bắt người dùng xóa danh mục hàng hóa;
- chỉ chặn khi đổi từ một lĩnh vực hỗ trợ hàng hóa (`Hàng hóa`/`Hỗn hợp`) sang lĩnh vực không hỗ trợ hàng hóa trong khi vẫn còn dữ liệu hàng hóa;
- thông báo lỗi phải nhắc đúng rằng dữ liệu hàng hóa chỉ áp dụng cho gói `Hàng hóa` hoặc `Hỗn hợp`;
- không làm lỏng kiểm tra organization, package, lot, opening, requirement hoặc quyền chỉnh sửa.

## 5. Không được phá vỡ hành vi hiện có

- Gói `Hàng hóa` phải hoạt động y như trước.
- Gói không liên quan hàng hóa không xuất hiện tab/nút/validator hàng hóa.
- Không tạo schema mới nếu các trường hiện tại đã đủ.
- Không nhân đôi dữ liệu hàng hóa cho gói hỗn hợp.
- Không tạo một bảng riêng cho hàng hóa của gói hỗn hợp.
- Không làm sai luồng một giai đoạn một túi/hai túi.
- Không bỏ qua server-side validation.

---

# PHẦN B — XUẤT DANH SÁCH HÀNG HÓA TRÚNG THẦU

## 6. Vị trí và điều kiện hiển thị chức năng

Thêm nút:

> **Xuất danh sách hàng hóa trúng thầu**

Vị trí ưu tiên: khu vực **Kết quả lựa chọn nhà thầu** đã được phê duyệt/chốt chính thức, đặt cùng nhóm thao tác xuất kết quả nhưng là một thao tác Excel riêng.

Nút chỉ hiển thị hoặc chỉ được phép dùng khi:

- gói thuộc lĩnh vực `Hàng hóa` hoặc `Hỗn hợp`;
- đã có ít nhất một kết quả trúng thầu chính thức;
- dữ liệu cần thiết để xác định nhà thầu/phần lô trúng thầu tồn tại.

Không phụ thuộc vào quyền xuất Word trả phí. Đây là chức năng Excel của dữ liệu nghiệp vụ hiện có.

Khi dữ liệu chưa đủ, không xuất file rỗng hoặc file sai. Hiển thị cảnh báo tường minh nêu rõ nhà thầu/phần lô nào còn thiếu dữ liệu hàng hóa chính thức.

## 7. Nguồn dữ liệu và nguyên tắc chọn đúng hàng hóa trúng thầu

Phải viết selector/builder thuần, có thể unit test độc lập, để tạo cấu trúc dữ liệu xuất.

### 7.1. Gói không phân lô

1. Lấy nhà thầu trúng thầu từ kết quả chính thức của gói, ưu tiên `pkg.nhaThauTrungThauId` và các helper/result view model hiện có.
2. Tìm đúng bản ghi `thongtinmothau`:
   - cùng `goiThauId`;
   - cùng `nhaThauId` với nhà thầu trúng thầu;
   - không phải bản ghi đã archive/xóa nếu mô hình có trạng thái đó.
3. Lấy các dòng `hanghoaduthaunhathau`:
   - cùng `goiThauId`;
   - cùng `thongTinMoThauId`;
   - `isDraft === false`;
   - đúng phạm vi không phân lô.
4. Không lấy hàng hóa của nhà thầu trượt thầu.

### 7.2. Gói phân lô

Nguồn sự thật cho từng lô là:

```text
pkg.phanLoList[].nhaThauTrungThauId
```

Với từng phần lô đã có kết quả:

1. Xác định nhà thầu trúng lô từ `nhaThauTrungThauId` của chính phần lô.
2. Tìm đúng hồ sơ mở thầu của nhà thầu trong lô đó bằng ID bất biến:
   - `goiThauId`;
   - `nhaThauId`;
   - `phanLoId` nếu có;
   - nếu dữ liệu mở thầu chỉ lưu mã lô thì dùng `maPhanLo` đã chuẩn hóa làm fallback.
3. Lấy hàng hóa dự thầu chính thức của đúng `thongTinMoThauId` và `phanLoId`.
4. Không lấy:
   - hàng hóa cùng nhà thầu nhưng thuộc lô khác;
   - hàng hóa của nhà thầu trượt lô;
   - hàng hóa bản nháp;
   - lô chưa có kết quả chính thức.

Không dùng tên nhà thầu hoặc tên phần lô làm khóa chính nếu đã có ID.

### 7.3. Liên danh

- Hỗ trợ nhà thầu liên danh như dữ liệu kết quả hiện có.
- Tên hiển thị phải dùng helper chuẩn đang có như `resolveBidContractorName` hoặc builder liên danh hiện tại.
- Không tự ghép tên bằng logic mới nếu mã nguồn đã có nguồn tên chuẩn.

### 7.4. Trùng lặp và thứ tự

- Loại bỏ trùng lặp theo ID dòng; nếu cần fallback thì dùng khóa ổn định gồm `thongTinMoThauId + goiThauHangHoaId`.
- Sắp xếp phần lô theo thứ tự trong `pkg.phanLoList`, không sắp xếp tùy tiện theo tên.
- Trong mỗi phần lô, sắp xếp theo `sortOrder`, sau đó theo `sttNguon`/ID để ổn định.
- Ưu tiên giữ nguyên `sttNguon` nếu có, kể cả dạng `1.1`, `1.2`.
- Nếu dòng không có `sttNguon`, sinh STT tuần tự trong phạm vi phần lô hoặc toàn gói không phân lô.

## 8. Quy tắc “Đơn giá trúng thầu” — bắt buộc hiểu đúng

Cột cuối phải là **đơn giá thực tế sau giảm giá nhưng trước ưu đãi**.

Ưu đãi chỉ phục vụ xếp hạng, vì vậy tuyệt đối không được dùng:

- `giaDuThauSauUuDai`;
- `thanhTienSauUuDai`;
- `giaTriCongUuDai`;
- `giaSoSanhSauUuDai`;
- `giaDanhGiaSauUuDai`;
- `giaXepHang`.

Quy tắc tính:

1. Nếu dòng có `giaTriCoSoSauGiamGia` hợp lệ, tính đơn giá trúng thầu bằng:

```text
Đơn giá trúng thầu = giaTriCoSoSauGiamGia / khoiLuong
```

2. Việc chia và làm tròn phải tái sử dụng hoặc tách helper từ logic hiện có trong `bidderGoodsPreference.js`, bảo đảm:
   - không mất chính xác với số VND lớn;
   - không dùng phép tính `Number` gây sai số ngoài miền an toàn;
   - kết quả ổn định;
   - tối đa số chữ số thập phân hợp lý cho đơn giá, đồng nhất với helper hiện có.
3. Nếu không có giảm giá và giá trị sau giảm giá không được lưu, fallback về `donGiaDuThau`.
4. Không tự lấy `giaTrungThau` cấp gói/lô rồi chia đều hoặc phân bổ lại một lần nữa.
5. Nếu `giaTriCoSoSauGiamGia` đã được cơ chế hiện tại phân bổ theo dòng, dùng chính giá trị đó làm nguồn chuẩn trước ưu đãi.
6. Nếu dữ liệu không đủ để xác định đơn giá đúng, chặn xuất và thông báo; không âm thầm xuất `0`.

Phải có test chứng minh một dòng có ưu đãi vẫn xuất giá trước ưu đãi, không phải giá dùng để xếp hạng.

## 9. Cấu trúc file Excel

Xuất **một file `.xlsx` duy nhất cho toàn bộ gói thầu**.

Đặc biệt với gói phân lô có nhiều nhà thầu trúng các lô khác nhau:

- vẫn chỉ xuất **một workbook/file**;
- không tạo mỗi nhà thầu một file;
- không tạo ZIP;
- ưu tiên một sheet tổng hợp để đúng cấu trúc trình bày tuần tự dưới đây.

Tên file gợi ý:

```text
Danh_sach_hang_hoa_trung_thau_<maGoiThau>.xlsx
```

Tên sheet gợi ý:

```text
HangHoaTrungThau
```

### 9.1. Các cột bắt buộc, đúng thứ tự

Chỉ xuất các cột nghiệp vụ sau:

1. `STT`
2. `Danh mục hàng hóa`
3. `Kỹ mã hiệu`
4. `Nhãn hiệu`
5. `Năm sản xuất`
6. `Xuất xứ`
7. `Hãng sản xuất`
8. `Cấu hình, tính năng kỹ thuật cơ bản`
9. `Đơn vị tính`
10. `Khối lượng`
11. `Mã HS`
12. `Đơn giá trúng thầu`

Lưu ý:

- Dùng đúng nhãn **`Kỹ mã hiệu`** theo yêu cầu này.
- Không thêm các cột ưu đãi.
- Không thêm `Thành tiền` nếu không có yêu cầu khác.
- Không thay `Đơn giá trúng thầu` bằng `Đơn giá dự thầu`.

### 9.2. Trình bày gói không phân lô

Cấu trúc tối thiểu:

1. Dòng tiêu đề tài liệu, merge toàn bộ 12 cột.
2. Dòng thông tin gói thầu nếu phù hợp.
3. Dòng tên nhà thầu trúng thầu, merge toàn bộ 12 cột.
4. Dòng header 12 cột.
5. Danh sách hàng hóa.

### 9.3. Trình bày gói phân lô

Phải nhóm **theo nhà thầu trước**, sau đó theo các phần lô nhà thầu đó trúng.

Cấu trúc bắt buộc:

```text
NHÀ THẦU: Nhà thầu A
PHẦN (LÔ): L01 - Tên phần lô 1
<header 12 cột>
<danh sách hàng hóa lô 1>

PHẦN (LÔ): L03 - Tên phần lô 3
<header 12 cột>
<danh sách hàng hóa lô 3>

NHÀ THẦU: Nhà thầu B
PHẦN (LÔ): L02 - Tên phần lô 2
<header 12 cột>
<danh sách hàng hóa lô 2>
```

Yêu cầu chính xác:

- Dòng tên nhà thầu merge toàn bộ 12 cột.
- Dòng tên phần lô merge toàn bộ 12 cột.
- Nếu một nhà thầu trúng nhiều phần lô:
  - chỉ in dòng tên nhà thầu một lần cho nhóm liên tiếp của nhà thầu đó;
  - sau đó lần lượt in tên phần lô 1 → danh sách hàng hóa → tên phần lô 2 → danh sách hàng hóa.
- Nếu nhiều nhà thầu khác nhau trúng các lô khác nhau, tất cả vẫn nằm trong cùng file.
- Thứ tự nhóm nhà thầu được xác định theo lần xuất hiện đầu tiên của phần lô trúng trong `phanLoList`.
- Thứ tự phần lô trong nhóm vẫn theo `phanLoList`.

## 10. Định dạng và an toàn Excel

Tái sử dụng `ensureXlsxLoaded`, SheetJS và các helper hiện có.

Yêu cầu tối thiểu:

- header rõ ràng, in đậm;
- wrap text cho cột dài;
- chiều rộng cột hợp lý;
- freeze pane nếu thư viện/luồng hiện tại hỗ trợ an toàn;
- định dạng tiền cho `Đơn giá trúng thầu`;
- giữ `Mã HS`, `Năm sản xuất`, `STT`, ký mã hiệu dưới dạng text khi cần để không mất số 0 đầu hoặc bị Excel đổi định dạng;
- merge chính xác các dòng tiêu đề nhà thầu/phần lô;
- không bật autofilter xuyên qua các dòng merge nếu gây lỗi; chỉ áp dụng theo từng bảng hoặc bỏ autofilter nếu cấu trúc nhóm không phù hợp;
- chống formula injection bằng helper `escapeSpreadsheetFormula` hoặc helper tương đương cho mọi ô text do người dùng nhập;
- tên file/sheet phải được sanitize;
- không tải thư viện từ CDN mới;
- không phá chính sách Trusted Types/CSP và quy trình build secure.

Nên tách chức năng mới thành module rõ trách nhiệm, ví dụ:

- `winningGoodsSelectors.js` — xác định winner, opening, lot và các dòng chính thức;
- `WinningGoodsExcel.js` — tạo cấu trúc workbook và tải file;

Tên file thực tế có thể khác nhưng phải giữ module nhỏ, thuần và dễ kiểm thử. Không nhồi toàn bộ logic vào `AwardResultDetailsPanel.js`.

## 11. Xử lý lỗi dữ liệu

Không được âm thầm bỏ qua dữ liệu bất thường.

Phải phát hiện và báo lỗi có ngữ cảnh trong các trường hợp tối thiểu:

- có nhà thầu trúng thầu nhưng không tìm thấy hồ sơ mở thầu tương ứng;
- phần lô có winner nhưng không tìm thấy opening của winner trong lô;
- không có dòng hàng hóa chính thức (`isDraft === false`);
- còn toàn bộ hoặc một phần dữ liệu ở trạng thái bản nháp;
- không xác định được đơn giá trúng thầu trước ưu đãi;
- một lô ánh xạ ra nhiều hồ sơ winner không thể phân biệt;
- dữ liệu winner cấp gói và winner cấp lô mâu thuẫn.

Thông báo phải cho người dùng biết tối thiểu:

- tên/mã nhà thầu;
- mã/tên phần lô nếu có;
- nội dung thiếu hoặc mâu thuẫn;
- hành động cần thực hiện, ví dụ “hãy lưu chính thức danh mục hàng hóa dự thầu trước khi xuất”.

---

# PHẦN C — KIỂM THỬ BẮT BUỘC

## 12. Unit test frontend

Bổ sung test vào file phù hợp hoặc tạo file test mới. Tối thiểu phải có các ca sau:

### 12.1. Hỗ trợ gói hỗn hợp

1. Tab danh mục hàng hóa hiển thị cho `Hàng hóa`.
2. Tab danh mục hàng hóa hiển thị cho `Hỗn hợp`.
3. Tab không hiển thị cho `Tư vấn`/`Xây lắp`.
4. `isPackageGoodsEditable` trả về đúng cho gói `Hỗn hợp` ở trạng thái `Chuẩn bị`.
5. `shouldShowBidderGoodsTab` hỗ trợ `Hỗn hợp` ở vòng `single` và `financial`.
6. Không hiển thị bidder goods ở vòng `technical` của 1G2T.
7. `resolveDetailedEvaluationContext` chèn `bidder_goods` đúng vị trí cho `Hỗn hợp`.
8. `shouldValidateBidderGoodsOnCompletion` áp dụng cho `Hỗn hợp`.
9. `goodsPreferenceRankingBlockReason` và `calculateRankings` áp dụng cùng quy tắc ưu đãi cho `Hỗn hợp`.

### 12.2. Xác định dữ liệu trúng thầu

10. Gói không phân lô chỉ chọn hàng hóa chính thức của nhà thầu trúng thầu.
11. Loại bỏ hàng hóa của nhà thầu trượt.
12. Loại bỏ dòng `isDraft !== false`.
13. Gói phân lô với hai lô, hai nhà thầu khác nhau vẫn tạo một mô hình xuất duy nhất.
14. Một nhà thầu trúng hai lô được nhóm một lần theo cấu trúc:
    - tên nhà thầu;
    - lô 1;
    - hàng hóa lô 1;
    - lô 2;
    - hàng hóa lô 2.
15. Cùng một nhà thầu dự nhiều lô nhưng chỉ lấy hàng hóa của các lô mà nhà thầu đó trúng.
16. Không nhầm opening khi cùng nhà thầu có nhiều bản ghi `thongtinmothau` ở các lô khác nhau.
17. Giữ đúng thứ tự `phanLoList` và `sortOrder`.
18. Liên danh hiển thị đúng tên chuẩn.
19. Thiếu hàng hóa chính thức trả về lỗi tường minh, không tạo danh sách rỗng.

### 12.3. Giá trúng thầu

20. Không giảm giá: `Đơn giá trúng thầu = donGiaDuThau`.
21. Có giảm giá: đơn giá được tính từ `giaTriCoSoSauGiamGia / khoiLuong`.
22. Có ưu đãi: giá xuất vẫn là giá trước ưu đãi, không phải `giaDuThauSauUuDai`.
23. Số VND lớn không bị sai số `Number.MAX_SAFE_INTEGER`.
24. Khối lượng thập phân được xử lý ổn định.
25. Thiếu/không hợp lệ dữ liệu giá phải chặn xuất, không xuất `0`.

### 12.4. Workbook

26. Workbook chỉ có một file cho gói nhiều lô/nhiều winner.
27. Có đúng 12 cột và đúng thứ tự.
28. Nhãn cột đúng, gồm `Kỹ mã hiệu` và `Đơn giá trúng thầu`.
29. Không có cột ưu đãi hoặc giá xếp hạng.
30. Dòng nhà thầu và phần lô được merge đủ 12 cột.
31. Formula injection được vô hiệu hóa.
32. `Mã HS` có số 0 đầu không bị mất.

Có thể dùng SheetJS vendor hiện có để đọc ngược workbook buffer trong test, tương tự các test Excel đang có.

## 13. Test backend

Bổ sung tối thiểu các test:

1. `validate_bidder_goods_batch` chấp nhận gói `Hỗn hợp` hợp lệ.
2. Vẫn từ chối lĩnh vực không hỗ trợ hàng hóa.
3. Cho phép đổi `Hàng hóa` ↔ `Hỗn hợp` khi đang có danh mục hàng hóa.
4. Chặn đổi từ `Hàng hóa`/`Hỗn hợp` sang lĩnh vực khác khi còn danh mục hàng hóa.
5. Các kiểm tra cross-package, wrong-lot, duplicate mapping, incomplete mapping, total mismatch và technical prerequisite vẫn hoạt động với `Hỗn hợp`.
6. Không làm suy yếu phân quyền hoặc organization scoping.

## 14. Kiểm thử tích hợp/E2E

Nếu dự án đã có Playwright/lifecycle test phù hợp, bổ sung hoặc mở rộng ít nhất hai kịch bản:

### Kịch bản 1 — Gói hỗn hợp không phân lô

- tạo gói `Hỗn hợp`;
- nhập danh mục hàng hóa;
- thêm hai nhà thầu;
- nhập/chốt hàng hóa dự thầu;
- đánh giá và xếp hạng;
- chốt một nhà thầu trúng;
- xuất danh sách hàng hóa trúng thầu;
- kiểm tra file chỉ có hàng hóa của winner và không dùng giá sau ưu đãi.

### Kịch bản 2 — Gói hỗn hợp phân lô

- có ít nhất ba phần lô;
- nhà thầu A trúng lô 1 và lô 3;
- nhà thầu B trúng lô 2;
- mỗi nhà thầu có hàng hóa dự thầu riêng theo lô;
- xuất đúng một file;
- thứ tự trong file:
  - Nhà thầu A;
  - Lô 1 + hàng hóa;
  - Lô 3 + hàng hóa;
  - Nhà thầu B;
  - Lô 2 + hàng hóa;
- không chứa hàng hóa của nhà thầu trượt tại bất kỳ lô nào.

---

# PHẦN D — TIÊU CHÍ CHẤP NHẬN

## 15. Definition of Done

Công việc chỉ được coi là hoàn thành khi đáp ứng tất cả:

- [ ] Mọi nghiệp vụ hàng hóa hiện có hỗ trợ cả `Hàng hóa` và `Hỗn hợp`.
- [ ] Không còn điều kiện hard-code `=== "Hàng hóa"` trong các luồng cần hỗ trợ gói hỗn hợp, trừ nơi thật sự có lý do nghiệp vụ riêng và được giải thích.
- [ ] Backend chấp nhận và kiểm tra chặt dữ liệu hàng hóa của gói hỗn hợp.
- [ ] Gói phân lô nhiều nhà thầu trúng thầu xuất đúng một file Excel.
- [ ] Cấu trúc nhóm đúng: nhà thầu → phần lô → danh sách hàng hóa.
- [ ] Một nhà thầu trúng nhiều lô chỉ có một heading nhà thầu cho nhóm đó.
- [ ] File có đúng 12 cột theo yêu cầu.
- [ ] `Đơn giá trúng thầu` là giá sau giảm giá nhưng trước ưu đãi.
- [ ] Không dùng giá ưu đãi/xếp hạng trong file xuất.
- [ ] Không lấy dữ liệu của nhà thầu/lô trượt thầu hoặc bản nháp.
- [ ] Có cảnh báo rõ ràng khi dữ liệu không đủ.
- [ ] Không có schema/migration thừa.
- [ ] Không phá luồng offline-first, outbox, sync, quyền truy cập hoặc snapshot/versioning.
- [ ] Unit test frontend và backend mới đều chạy qua.
- [ ] Build secure chạy qua.
- [ ] `git diff --check` không có lỗi.

---

# PHẦN E — LỆNH KIỂM TRA VÀ BÁO CÁO

## 16. Lệnh cần chạy

Dùng đúng môi trường và lệnh của repository. Tối thiểu chạy:

```bash
pytest -q tests
node --test tests/js/*.test.mjs
npm run build:secure
git diff --check
```

Nếu toàn bộ test quá nặng, trong quá trình phát triển có thể chạy test mục tiêu trước, nhưng trước khi kết thúc phải chạy bộ kiểm tra rộng nhất có thể. Nếu một test phụ thuộc hạ tầng không có sẵn, ghi rõ:

- lệnh đã chạy;
- lỗi chính xác;
- lý do môi trường;
- phần nào đã được xác minh bằng test khác.

Không được bỏ qua test lỗi do code mới gây ra.

## 17. Báo cáo cuối cùng của Codex

Sau khi hoàn thành, tạo file báo cáo Markdown, ví dụ:

```text
CODEX_MIXED_PACKAGE_WINNING_GOODS_EXPORT_REPORT.md
```

Báo cáo phải gồm:

1. Tóm tắt thay đổi.
2. Danh sách file đã thêm/sửa.
3. Cách xác định nhà thầu và hàng hóa trúng thầu.
4. Cách xử lý gói phân lô nhiều winner trong một file.
5. Công thức xác định `Đơn giá trúng thầu` và lý do không dùng giá sau ưu đãi.
6. Các thay đổi để hỗ trợ `Hỗn hợp` ở frontend/backend/xếp hạng.
7. Các test đã bổ sung.
8. Kết quả từng lệnh kiểm tra.
9. Các giới hạn hoặc rủi ro còn lại, nếu có.

Trong phản hồi cuối cùng, trình bày ngắn gọn:

- đã hoàn thành gì;
- test/build nào đã chạy;
- file báo cáo nằm ở đâu;
- không tuyên bố hoàn thành nếu còn lỗi chưa xử lý.
