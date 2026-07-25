# KẾ HOẠCH TRIỂN KHAI
## Báo cáo đánh giá chi tiết theo từng nhà thầu

### 1. Bối cảnh

Hệ thống hiện có trang **Báo cáo đánh giá E-HSDT/E-HSĐXKT/E-HSĐXTC** theo dạng bảng tổng hợp nhiều nhà thầu.

Trang hiện tại cho phép nhập:

- Số và ngày báo cáo.
- Kết quả tính hợp lệ.
- Kết quả năng lực và kinh nghiệm.
- Kết quả kỹ thuật.
- Kết quả tài chính.
- Kết luận và lý do không đạt.
- Dữ liệu làm rõ.
- Nhập hoặc xuất Excel.

Cần bổ sung một chức năng **Báo cáo đánh giá chi tiết**, trong đó người dùng chọn một hồ sơ dự thầu/nhà thầu và đánh giá chi tiết từng nhóm tiêu chí.

Không thay thế báo cáo tổng quát hiện tại. Báo cáo tổng quát tiếp tục đóng vai trò bảng tổng hợp kết quả của tất cả nhà thầu.

---

# 2. Mục tiêu chức năng

Bổ sung nút:

> Báo cáo đánh giá chi tiết

Khi bấm nút, mở một trang con trong màn hình đánh giá hiện tại.

Trang mới phải có:

1. Dropdown chọn nhà thầu/hồ sơ dự thầu.
2. Thông tin nhận diện nhà thầu, liên danh và phần lô.
3. Các tab:
   - Tính hợp lệ.
   - Năng lực và kinh nghiệm.
   - Kỹ thuật.
   - Tài chính.
4. Danh sách tiêu chí trong từng tab.
5. Trường nhập kết quả, điểm, nhận xét, lý do và nội dung làm rõ.
6. Trạng thái bản nháp hoặc hoàn thành.
7. Nút lưu từng tab.
8. Nút hoàn thành đánh giá nhà thầu.
9. Nút quay lại báo cáo tổng quát.
10. Kết quả sau khi hoàn thành phải được tổng hợp trở lại bảng báo cáo tổng quát.

Thiết kế phải sẵn sàng để sau này cấu hình khác nhau theo:

- Một giai đoạn một túi hồ sơ – 1G1T.
- Một giai đoạn hai túi hồ sơ – 1G2T.
- Hình thức lựa chọn nhà thầu.
- Lĩnh vực gói thầu.
- Phương pháp đánh giá.
- Có hoặc không có phần lô.
- Nhà thầu độc lập hoặc liên danh.

---

# 3. Quyết định kiến trúc

## 3.1. Báo cáo chi tiết là trang con, không phải tab nghiệp vụ cấp gói thầu

Không thêm một tab mới vào `PackageTabs.js`.

Luồng giao diện:

```text
Báo cáo đánh giá tổng quát
        |
        |-- Bấm "Báo cáo đánh giá chi tiết"
        v
Báo cáo chi tiết theo nhà thầu
        |
        |-- Quay lại
        v
Báo cáo đánh giá tổng quát
```

Lý do:

- Người dùng yêu cầu mở từ một nút.
- Báo cáo chi tiết thuộc vòng đánh giá đang được xem.
- Không làm danh sách tab gói thầu trở nên quá dài.
- Có thể giữ nguyên `eval_tech` và `eval_fin` trong quy trình 1G2T.

Dùng state nội bộ:

```javascript
currentEvaluationView = "summary" | "contractor-detail";
selectedEvaluationBidId = null;
selectedDetailedEvaluationTab = "validity";
```

Không dùng URL router mới trong MVP nếu ứng dụng hiện tại chưa có routing cho các trang con.

---

## 3.2. Dropdown phải chọn hồ sơ dự thầu, không chọn trực tiếp contractor ID

Giá trị của dropdown phải là:

```text
thongTinMoThauId
```

Không dùng `nhaThauId` làm khóa chính của lựa chọn.

Nguyên nhân:

- Một nhà thầu có thể dự nhiều phần lô.
- Một nhà thầu có thể có nhiều hồ sơ trong những tình huống khác nhau.
- Hồ sơ liên danh có nhiều thành viên.
- Kết quả đánh giá đang gắn với dữ liệu mở thầu.

Nhãn dropdown đề xuất:

```text
[PL01] Công ty ABC
Liên danh Công ty A – Công ty B
Công ty ABC – MST 0123456789
```

Khi có phần lô, bắt buộc hiển thị mã và tên phần lô.

---

# 4. Luồng giao diện MVP

## 4.1. Bổ sung nút trên báo cáo tổng quát

Sửa:

```text
frontend/packages/detail/EvaluationPanel.js
```

Đặt nút trong `compact-action-group`, cùng khu vực với nút tải và nhập Excel:

```text
[Báo cáo đánh giá chi tiết] [Tải Excel mẫu] [Nhập từ Excel]
```

ID đề xuất:

```text
btn-danhgiahsdt-detail
```

Điều kiện hiển thị:

- Đã có gói thầu đang được chọn.
- Gói thầu có ít nhất một bản ghi `thongtinmothau`.
- Người dùng có quyền xem đánh giá.

Nút vẫn được hiển thị trong chế độ chỉ đọc để người dùng xem báo cáo chi tiết.

---

## 4.2. Bố cục trang báo cáo chi tiết

Header:

```text
< Quay lại báo cáo tổng quát

BÁO CÁO ĐÁNH GIÁ CHI TIẾT

Gói thầu: ...
Phương thức: 1G1T / 1G2T
Vòng đánh giá: Kỹ thuật / Tài chính / Tổng hợp
Lĩnh vực: ...
Phần lô: ...
```

Khu vực lựa chọn:

```text
Nhà thầu/Hồ sơ dự thầu: [Dropdown]
Trạng thái: Chưa đánh giá / Bản nháp / Hoàn thành
Tiến độ: 8/12 tiêu chí
```

Các nút tiện ích:

```text
[Nhà thầu trước] [Nhà thầu tiếp theo]
```

Các tab:

```text
[Tính hợp lệ] [Năng lực và kinh nghiệm] [Kỹ thuật] [Tài chính]
```

Footer:

```text
[Lưu bản nháp] [Hoàn thành tab] [Hoàn thành đánh giá nhà thầu]
```

---

## 4.3. Nội dung mỗi tab

Hiển thị bảng tiêu chí:

| Mã | Tiêu chí/Yêu cầu | Nội dung trong HSDT | Kết quả | Điểm | Nhận xét đánh giá | Làm rõ |
|---|---|---|---|---|---|---|

Các kiểu kết quả phải được hỗ trợ từ đầu:

```text
pass_fail:
- Chưa đánh giá
- Đạt
- Không đạt
- Không áp dụng

score:
- Điểm đạt được
- Điểm tối đa

text:
- Nội dung đánh giá tự do

number:
- Giá trị số
```

Các trường tối thiểu của một kết quả tiêu chí:

```javascript
{
  criterionId,
  result: "pending" | "pass" | "fail" | "not_applicable",
  score: null,
  bidderResponse: "",
  comment: "",
  failureReason: "",
  clarificationRequest: "",
  clarificationResponse: "",
  referenceDocument: ""
}
```

Quy tắc:

- Kết quả `Không đạt` bắt buộc nhập lý do.
- Tiêu chí kiểu điểm phải có điểm không âm và không vượt quá điểm tối đa.
- Tiêu chí bắt buộc không được để `Chưa đánh giá` khi hoàn thành tab.
- `Không áp dụng` nên yêu cầu ghi chú ngắn.
- Chỉ lưu dữ liệu khi người dùng chủ động bấm lưu.
- Không tự tạo bản ghi database chỉ vì người dùng mở trang.

---

# 5. Ma trận hiển thị tab

Tạo module riêng:

```text
frontend/packages/detailedEvaluationRules.js
```

Không rải điều kiện 1G1T/1G2T vào các component.

API đề xuất:

```javascript
export function resolveDetailedEvaluationContext(pkg, roundType) {
  return {
    methodKey,
    roundType,
    visibleGroups: [],
    editableGroups: [],
    contractorFilter,
    scoringModeByGroup: {},
    allowComplete: true
  };
}
```

## 5.1. Một giai đoạn một túi hồ sơ

Vòng:

```text
single
```

Hiển thị và cho phép sửa:

```text
validity
capacity
technical
financial
```

## 5.2. Một giai đoạn hai túi hồ sơ – vòng kỹ thuật

Vòng:

```text
technical
```

Hiển thị và cho phép sửa:

```text
validity
capacity
technical
```

Tab tài chính:

- Không cho sửa.
- MVP có thể ẩn hoàn toàn.
- Ưu tiên ẩn để tránh nhầm vòng đánh giá.

## 5.3. Một giai đoạn hai túi hồ sơ – vòng tài chính

Vòng:

```text
financial
```

Cho phép sửa:

```text
financial
```

Ba nhóm trước có thể hiển thị dưới dạng chỉ đọc để tham khảo:

```text
validity
capacity
technical
```

Dropdown chỉ hiển thị các hồ sơ đã đạt vòng kỹ thuật theo logic hiện tại.

## 5.4. Chỉ định thầu rút gọn và trường hợp đặc biệt

Không hardcode chi tiết nghiệp vụ pháp lý trong giai đoạn này.

Tạo cấu hình riêng để sau này bổ sung:

```javascript
const DETAILED_EVALUATION_RULES = {
  default: {},
  oneStageOneEnvelope: {},
  oneStageTwoEnvelopeTechnical: {},
  oneStageTwoEnvelopeFinancial: {},
  directAppointmentSimplified: {},
  specialSelection: {},
  consulting: {}
};
```

MVP có thể dùng cấu hình `default`, nhưng toàn bộ component phải đọc cấu hình qua resolver.

---

# 6. Mô hình dữ liệu

Repo đã có:

```text
vong_danh_gia
tieu_chi_danh_gia
ket_qua_danh_gia_nha_thau
```

Không lưu toàn bộ báo cáo chi tiết vào `danhGiaHsdtMetadata`.

Không nhét một JSON lớn vào bản ghi gói thầu.

Tạo thêm hai bảng chuẩn hóa.

## 6.1. Bảng báo cáo chi tiết của một nhà thầu

Tên đề xuất:

```text
bao_cao_danh_gia_nha_thau
```

Các cột:

```text
id
organization_id
owner_type
vong_danh_gia_id
thong_tin_mo_thau_id
trang_thai
ket_luan
nguoi_cham_id
hoan_thanh_luc
extension_json
sync_version
created_at
updated_at
```

Ràng buộc:

```text
trang_thai IN ('draft', 'completed')
UNIQUE(
    organization_id,
    vong_danh_gia_id,
    thong_tin_mo_thau_id
)
```

Foreign key:

```text
vong_danh_gia_id -> vong_danh_gia.id
thong_tin_mo_thau_id -> thong_tin_mo_thau.id
nguoi_cham_id -> tai_khoan.id
```

`extension_json` chỉ dùng cho các thuộc tính phụ, có `schemaVersion`.

Không dùng `extension_json` để lưu toàn bộ danh sách tiêu chí.

---

## 6.2. Bảng kết quả chi tiết từng tiêu chí

Tên đề xuất:

```text
chi_tiet_danh_gia_nha_thau
```

Các cột:

```text
id
organization_id
owner_type
bao_cao_danh_gia_nha_thau_id
tieu_chi_danh_gia_id
ket_qua
diem
noi_dung_hsdt
nhan_xet
ly_do_khong_dat
yeu_cau_lam_ro
ket_qua_lam_ro
tai_lieu_tham_chieu
extension_json
sync_version
created_at
updated_at
```

Ràng buộc:

```text
ket_qua IN (
    'pending',
    'pass',
    'fail',
    'not_applicable'
)

UNIQUE(
    organization_id,
    bao_cao_danh_gia_nha_thau_id,
    tieu_chi_danh_gia_id
)
```

`diem` có thể null.

Khi có điểm:

```text
diem >= 0
```

Việc kiểm tra điểm không vượt quá điểm tối đa thực hiện ở service/mapper và frontend.

---

## 6.3. Mở rộng bảng tiêu chí

Bổ sung vào:

```text
tieu_chi_danh_gia
```

Các cột:

```text
nhom_danh_gia
loai_ket_qua
bat_buoc
tieu_chi_cha_id
```

Giá trị:

```text
nhom_danh_gia:
- validity
- capacity
- technical
- financial

loai_ket_qua:
- pass_fail
- score
- text
- number

bat_buoc:
- 0
- 1
```

`tieu_chi_cha_id` để hỗ trợ cấu trúc cha–con trong tương lai.

MVP chưa nhất thiết phải hiển thị cây nhiều cấp, nhưng schema cần sẵn sàng.

---

# 7. Migration database

Sửa:

```text
backend/db/schema.py
backend/db/upgrades.py
```

Tạo migration version 3:

```text
DatabaseUpgrade(
    3,
    "add_detailed_bid_evaluations",
    _upgrade_to_v3_add_detailed_bid_evaluations
)
```

Migration phải:

1. Thêm các cột mới vào `tieu_chi_danh_gia`.
2. Tạo `bao_cao_danh_gia_nha_thau`.
3. Tạo `chi_tiet_danh_gia_nha_thau`.
4. Tạo index theo:
   - `organization_id`.
   - `vong_danh_gia_id`.
   - `thong_tin_mo_thau_id`.
   - `bao_cao_danh_gia_nha_thau_id`.
5. Tạo đầy đủ foreign key và tenant constraint theo pattern hiện có.
6. Không thay đổi hay xóa dữ liệu đánh giá cũ.
7. Cho phép database cũ nâng từ version 2 lên version 3.
8. Fresh installation phải tạo trực tiếp schema mới nhất.

Repo yêu cầu version migration liên tục và migration đã phát hành không được sửa lại, vì vậy phải thêm v3 thay vì sửa migration v2.

---

# 8. Data contract giữa frontend và backend

Trong MVP, không đưa hai bảng mới thành top-level store của frontend.

Gắn báo cáo chi tiết dưới bản ghi `thongtinmothau`, tương tự cách mapper hiện đang gắn kết quả tổng hợp.

Tên property đề xuất:

```javascript
baoCaoDanhGiaChiTietList
```

Cấu trúc:

```javascript
{
  id: "detail-report-id",
  vongDanhGiaId: "evaluation-round:package-id:technical",
  loaiVong: "technical",
  trangThai: "draft",
  ketLuan: "",
  nguoiChamId: null,
  hoanThanhLuc: null,

  chiTietList: [
    {
      id: "detail-row-id",
      tieuChiDanhGiaId: "criterion-id",
      ketQua: "pending",
      diem: null,
      noiDungHsdt: "",
      nhanXet: "",
      lyDoKhongDat: "",
      yeuCauLamRo: "",
      ketQuaLamRo: "",
      taiLieuThamChieu: ""
    }
  ]
}
```

Một hồ sơ trong 1G2T có thể có:

```text
01 report technical
01 report financial
```

Một hồ sơ trong 1G1T có:

```text
01 report single
```

---

# 9. Mở rộng backend sync mapper

Sửa:

```text
backend/sync/mapper.py
```

Hiện mapper đã:

- Lưu vòng đánh giá từ metadata của gói thầu.
- Lưu tiêu chí của từng vòng.
- Lưu kết quả đánh giá tổng hợp theo bản ghi mở thầu.
- Gắn các kết quả trở lại payload frontend.

Bổ sung:

```python
_save_bid_detailed_evaluation_reports(...)
_attach_bid_detailed_evaluation_reports(...)
```

Trong `save_child_payloads`, sau `_save_bid_evaluation_result`:

```python
_save_bid_detailed_evaluation_reports(
    cursor,
    opening_id,
    item,
    organization_id,
    owner_type,
    sync_version,
    updated_at,
    actor_user_id,
)
```

Yêu cầu mapper:

1. Nếu property `baoCaoDanhGiaChiTietList` không xuất hiện:
   - Không xóa dữ liệu cũ.
   - Không thay đổi báo cáo chi tiết.

2. Nếu property xuất hiện và là mảng rỗng:
   - Xóa báo cáo chi tiết của hồ sơ đó theo cơ chế đồng bộ hiện có.

3. Upsert report theo:
   ```text
   organization + evaluation round + opening bid
   ```

4. Upsert các dòng theo:
   ```text
   report + criterion
   ```

5. Kiểm tra:
   - Round thuộc đúng gói thầu.
   - Opening bid thuộc đúng gói thầu.
   - Criterion thuộc đúng round.
   - Tất cả bản ghi thuộc cùng organization.

6. Khi attach dữ liệu:
   - Luôn trả `baoCaoDanhGiaChiTietList: []` nếu chưa có dữ liệu.
   - Sắp xếp report theo loại vòng.
   - Sắp xếp chi tiết theo `tieu_chi_danh_gia.thu_tu`.

7. Giữ tương thích payload cũ.

---

# 10. Frontend modules

Không tiếp tục nhồi toàn bộ logic vào `BidEvaluationWorkflow.js`, vì file này đã xử lý nhiều nhánh 1G1T, 1G2T, tư vấn, phần lô và quy trình đánh giá.

Tạo các module:

```text
frontend/packages/detail/DetailedEvaluationPanel.js
frontend/packages/DetailedEvaluationWorkflow.js
frontend/packages/detailedEvaluationRules.js
frontend/packages/detailedEvaluationSelectors.js
frontend/packages/detailedEvaluationValidation.js
frontend/packages/detailedEvaluationAggregation.js
frontend/packages/detailedEvaluationTemplates.js
```

## 10.1. DetailedEvaluationPanel.js

Chỉ chịu trách nhiệm render:

- Header.
- Nút quay lại.
- Dropdown.
- Tab headers.
- Bảng tiêu chí.
- Trạng thái và tiến độ.
- Các nút hành động.

Không truy cập database hoặc tự persist.

## 10.2. DetailedEvaluationWorkflow.js

Chịu trách nhiệm:

- Mở/đóng trang chi tiết.
- Lấy gói thầu hiện tại.
- Xác định vòng `single`, `technical` hoặc `financial`.
- Lấy danh sách hồ sơ phù hợp.
- Chuyển nhà thầu.
- Chuyển tab.
- Load report.
- Tạo draft trong memory.
- Save.
- Complete tab/report.
- Áp dụng read-only.
- Render lại.

## 10.3. detailedEvaluationSelectors.js

Các selector đề xuất:

```javascript
getEvaluationRoundType(pkg, currentGeneralTab)
getPackageEvaluationBids(model, pkg)
getEligibleFinancialEvaluationBids(model, pkg)
getDetailedReportForRound(bid, roundType)
getCriteriaForGroup(pkg, roundType, group)
getDetailedEvaluationProgress(report, criteria)
```

## 10.4. detailedEvaluationValidation.js

Các hàm:

```javascript
validateDetailedEvaluationRow(row, criterion)
validateDetailedEvaluationGroup(rows, criteria)
validateDetailedEvaluationReport(report, context)
```

Trả lỗi theo cấu trúc, không gọi alert trực tiếp:

```javascript
{
  valid: false,
  errors: [
    {
      criterionId,
      field,
      message
    }
  ]
}
```

## 10.5. detailedEvaluationAggregation.js

Chịu trách nhiệm chuyển kết quả chi tiết thành kết quả tổng hợp hiện tại.

API:

```javascript
aggregateDetailedEvaluation({
  report,
  criteria,
  group
});
```

Kết quả:

```javascript
{
  status: "Đạt" | "Không đạt" | "",
  score: null,
  failureReason: "",
  clarification: ""
}
```

Không đặt logic tổng hợp trực tiếp trong component.

---

# 11. Bộ tiêu chí mặc định

Trong giai đoạn này chưa xây đầy đủ tiêu chí pháp lý cho mọi loại gói thầu.

Tạo:

```text
frontend/packages/detailedEvaluationTemplates.js
```

MVP tạo bốn tiêu chí tổng hợp mặc định:

```javascript
[
  {
    code: "VALIDITY_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về tính hợp lệ",
    group: "validity",
    resultType: "pass_fail",
    required: true
  },
  {
    code: "CAPACITY_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về năng lực và kinh nghiệm",
    group: "capacity",
    resultType: "pass_fail",
    required: true
  },
  {
    code: "TECHNICAL_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về kỹ thuật",
    group: "technical",
    resultType: "pass_fail",
    required: true
  },
  {
    code: "FINANCIAL_SUMMARY",
    name: "Kết quả đánh giá tổng hợp về tài chính",
    group: "financial",
    resultType: "pass_fail",
    required: true
  }
]
```

Quan trọng:

- Template chỉ được khởi tạo khi vòng đánh giá chưa có tiêu chí.
- Không ghi vào database chỉ vì người dùng mở trang.
- Chỉ persist khi người dùng lưu lần đầu.
- Kiến trúc phải cho phép thay các tiêu chí tổng hợp bằng danh sách chi tiết sau này mà không sửa component.

---

# 12. Tổng hợp ngược về báo cáo tổng quát

Bảng `ket_qua_danh_gia_nha_thau` hiện là nguồn dữ liệu của báo cáo tổng quát và các điều kiện xác định nhà thầu đạt kỹ thuật. Bảng này chỉ có một kết quả tổng hợp cho mỗi bản ghi mở thầu, chưa lưu từng tiêu chí hoặc từng vòng.

Trong MVP:

- Giữ nguyên bảng này.
- Xem đây là bảng projection/tổng hợp.
- Báo cáo chi tiết là nguồn dữ liệu chính khi đã hoàn thành.

Khi người dùng bấm:

```text
Hoàn thành đánh giá nhà thầu
```

Thực hiện:

```text
validity  -> danhGiaHopLe
capacity  -> danhGiaNangLuc
technical -> danhGiaKyThuat
financial -> danhGiaTaiChinh
overall   -> danhGiaKetLuan
```

Quy tắc tổng hợp ban đầu:

1. Có tiêu chí bắt buộc `fail`:
   - Nhóm tương ứng = `Không đạt`.

2. Tất cả tiêu chí bắt buộc được đánh giá và không có `fail`:
   - Nhóm tương ứng = `Đạt`.

3. Còn tiêu chí bắt buộc `pending`:
   - Nhóm chưa hoàn thành.

4. Với nhóm chấm điểm:
   - Tổng điểm bằng tổng điểm của các tiêu chí.
   - Kết luận dựa trên ngưỡng trong cấu hình criteria/round.

5. Kết luận nhà thầu:
   - Có nhóm bắt buộc không đạt → `Không đạt`.
   - Tất cả nhóm áp dụng đều đạt → `Đạt`.
   - Còn nhóm chưa hoàn thành → chưa kết luận.

6. Lý do loại:
   - Tổng hợp các lý do không đạt.
   - Không nối chuỗi quá dài trong UI; có thể hiển thị bản rút gọn và liên kết sang báo cáo chi tiết.

---

# 13. Chính sách tránh hai nguồn dữ liệu

Cần tránh việc báo cáo tổng quát và chi tiết chứa hai kết quả khác nhau.

Quy tắc:

## Chưa có báo cáo chi tiết hoàn thành

- Báo cáo tổng quát hoạt động như hiện tại.
- Người dùng vẫn có thể nhập trực tiếp.

## Đã có báo cáo chi tiết hoàn thành

- Các ô tổng hợp tương ứng của nhà thầu chuyển sang read-only.
- Hiển thị badge:
  ```text
  Tổng hợp từ báo cáo chi tiết
  ```
- Muốn thay đổi phải mở báo cáo chi tiết.

## Chỉnh sửa lại báo cáo chi tiết đã hoàn thành

- Chuyển report về trạng thái `draft`.
- Không cập nhật projection tổng quát cho đến khi hoàn thành lại.
- Có thể giữ kết quả projection cũ và hiển thị cảnh báo:
  ```text
  Báo cáo chi tiết đang được chỉnh sửa.
  Kết quả tổng hợp chưa được cập nhật.
  ```

---

# 14. Read-only và khóa nghiệp vụ

Dùng lại các điều kiện hiện có của báo cáo tổng quát:

- Gói thầu `Đã có kết quả`.
- Gói thầu `Hủy thầu`.
- Vòng đánh giá đã hoàn thành/phê duyệt.
- Danh sách nhà thầu đạt kỹ thuật đã được lưu.
- Người dùng chỉ có quyền xem.

Quy tắc 1G2T:

- Sau khi danh sách đạt kỹ thuật đã được lưu, báo cáo kỹ thuật chi tiết ở chế độ chỉ đọc.
- Báo cáo tài chính chỉ mở cho các hồ sơ đạt kỹ thuật.
- Không cho sửa vòng tài chính trước khi hoàn thành các bước mở hồ sơ tài chính hiện tại.

Không tạo một hệ thống quyền mới trong MVP. Dùng quyền `goithau` và `thongtinmothau` hiện có.

---

# 15. File cần sửa

Frontend:

```text
frontend/packages/detail/EvaluationPanel.js
frontend/packages/BidEvaluationWorkflow.js
frontend/packages/bidEvaluationActions.js
frontend/packages/detail/PackageTabs.js
```

`PackageTabs.js` chỉ sửa nếu cần tái sử dụng helper hoặc export thêm workflow state. Không thêm tab mới.

Tạo mới:

```text
frontend/packages/detail/DetailedEvaluationPanel.js
frontend/packages/DetailedEvaluationWorkflow.js
frontend/packages/detailedEvaluationRules.js
frontend/packages/detailedEvaluationSelectors.js
frontend/packages/detailedEvaluationValidation.js
frontend/packages/detailedEvaluationAggregation.js
frontend/packages/detailedEvaluationTemplates.js
```

Backend:

```text
backend/db/schema.py
backend/db/upgrades.py
backend/sync/mapper.py
```

Có thể cần sửa thêm schema/runtime mapping nếu generator hoặc kiểm tra schema của repo yêu cầu.

---

# 16. Kế hoạch triển khai theo PR

## PR 1 – Domain và database

Phạm vi:

- Migration v3.
- Hai bảng mới.
- Mở rộng tiêu chí.
- Schema constraints.
- Mapper save/attach.
- Unit test round-trip.
- Chưa làm UI.

Tiêu chí hoàn thành:

- Database cũ nâng cấp thành công.
- Có thể sync một report cùng các dòng chi tiết.
- Load lại trả đúng payload.
- Không ảnh hưởng dữ liệu cũ.

## PR 2 – Navigation và giao diện khung

Phạm vi:

- Nút báo cáo chi tiết.
- Trang con.
- Nút quay lại.
- Dropdown hồ sơ.
- Tab visibility resolver.
- Hiển thị trạng thái trống.
- Chưa hoàn thiện aggregate.

Tiêu chí hoàn thành:

- Mở/đóng trang không làm mất trạng thái báo cáo tổng quát.
- Chọn đúng hồ sơ theo gói thầu.
- 1G1T và 1G2T hiển thị đúng nhóm tab.

## PR 3 – Nhập liệu và lưu báo cáo

Phạm vi:

- Render tiêu chí.
- Lưu draft.
- Validation.
- Hoàn thành tab/report.
- Read-only.
- Chuyển nhà thầu trước/sau.
- Dirty-state warning.

Tiêu chí hoàn thành:

- Dữ liệu tồn tại sau reload.
- Không ghi nhầm nhà thầu hoặc phần lô.
- Không hoàn thành khi còn tiêu chí bắt buộc chưa đánh giá.

## PR 4 – Tổng hợp và tương thích báo cáo cũ

Phạm vi:

- Aggregation.
- Update projection tổng quát.
- Badge nguồn dữ liệu.
- Khóa sửa trực tiếp khi có báo cáo chi tiết.
- 1G2T technical/financial gating.
- E2E test.

Tiêu chí hoàn thành:

- Hoàn thành báo cáo chi tiết cập nhật đúng bảng tổng quát.
- Danh sách đạt kỹ thuật tiếp tục hoạt động.
- Luồng kết quả lựa chọn nhà thầu không bị ảnh hưởng.

---

# 17. Test cases bắt buộc

## Backend

1. Migration từ schema version 2 lên version 3.
2. Fresh database tạo đúng bảng mới.
3. Lưu report `single`.
4. Lưu riêng report `technical` và `financial`.
5. Upsert report không tạo bản ghi trùng.
6. Upsert chi tiết không tạo tiêu chí trùng.
7. Payload không có key thì không xóa dữ liệu con.
8. Payload có danh sách rỗng thì xử lý xóa đúng quy ước.
9. Criterion của round khác bị từ chối.
10. Opening bid của package khác bị từ chối.
11. Không truy cập chéo organization.
12. Xóa gói thầu cascade đúng.
13. Dữ liệu đánh giá tổng quát cũ vẫn load bình thường.

## Frontend unit test

1. Resolve context 1G1T.
2. Resolve context 1G2T technical.
3. Resolve context 1G2T financial.
4. Lọc nhà thầu đạt kỹ thuật.
5. Cùng nhà thầu nhưng hai phần lô tạo hai lựa chọn khác nhau.
6. Nhà thầu liên danh hiển thị đúng tên.
7. Fail bắt buộc nhập lý do.
8. Điểm không vượt quá điểm tối đa.
9. Tính tiến độ đúng.
10. Tổng hợp nhóm đạt.
11. Tổng hợp nhóm không đạt.
12. Tổng hợp toàn bộ report.
13. Read-only khi package đã có kết quả.
14. Draft không ghi đè projection tổng quát.
15. Completed report cập nhật projection.

## E2E

### 1G1T

```text
Mở báo cáo tổng quát
→ Mở báo cáo chi tiết
→ Chọn nhà thầu
→ Nhập bốn tab
→ Hoàn thành
→ Quay lại
→ Kết quả tổng quát đã được cập nhật
→ Reload
→ Dữ liệu vẫn còn
```

### 1G2T

```text
Mở vòng kỹ thuật
→ Chỉ thấy hợp lệ, năng lực, kỹ thuật
→ Hoàn thành nhà thầu
→ Lưu danh sách đạt kỹ thuật
→ Vòng kỹ thuật chuyển read-only
→ Mở vòng tài chính
→ Dropdown chỉ có nhà thầu đạt kỹ thuật
→ Hoàn thành tài chính
→ Tổng hợp kết quả
```

### Phần lô

```text
Một nhà thầu dự PL01 và PL02
→ Dropdown có hai mục riêng
→ Nhập PL01 không làm thay đổi PL02
```

---

# 18. Tiêu chí nghiệm thu MVP

Chức năng được coi là hoàn thành khi:

- Có nút `Báo cáo đánh giá chi tiết` trên báo cáo tổng quát.
- Nút mở trang con, không tạo package tab mới.
- Dropdown chọn theo `thongTinMoThauId`.
- Hỗ trợ nhà thầu độc lập, liên danh và phần lô.
- Có bốn nhóm đánh giá.
- Tab được hiển thị theo vòng 1G1T/1G2T.
- Có lưu draft và hoàn thành.
- Có validation tiêu chí bắt buộc.
- Dữ liệu được lưu chuẩn hóa trong database.
- Reload không mất dữ liệu.
- Hoàn thành report cập nhật báo cáo tổng quát.
- Không phá dữ liệu đánh giá cũ.
- Không truy cập chéo organization.
- Các trạng thái khóa hiện tại tiếp tục có hiệu lực.
- Test backend, frontend và E2E chính đều pass.

---

# 19. Ngoài phạm vi MVP

Chưa triển khai trong đợt này:

- Bộ tiêu chí pháp lý đầy đủ cho từng loại gói thầu.
- Trình thiết kế template tiêu chí.
- Import tiêu chí từ E-HSMT.
- Import/export Excel báo cáo chi tiết.
- Đính kèm nhiều file cho từng tiêu chí.
- Phân công nhiều chuyên gia chấm cùng một tiêu chí.
- Chấm độc lập rồi hợp nhất kết quả.
- Phê duyệt nhiều cấp.
- Lịch sử so sánh các phiên bản báo cáo.
- Chữ ký số.
- Sinh báo cáo Word/PDF.
- Quy tắc đầy đủ cho từng hình thức lựa chọn nhà thầu.

Tuy nhiên data model và rule resolver không được cản trở việc bổ sung các chức năng này sau này.

---

# 20. Yêu cầu kỹ thuật dành cho Codex

1. Trước khi sửa code, đọc đầy đủ:
   ```text
   frontend/packages/BidEvaluationWorkflow.js
   frontend/packages/bidEvaluationActions.js
   frontend/packages/detail/EvaluationPanel.js
   frontend/packages/detail/PackageTabs.js
   backend/db/schema.py
   backend/db/upgrades.py
   backend/sync/mapper.py
   ```

2. Tìm các test hiện có liên quan đến:
   ```text
   evaluation
   sync mapper
   schema migration
   package workflow
   tenant isolation
   ```

3. Giữ coding style, naming convention và trusted HTML pattern hiện tại.

4. Không refactor toàn bộ module đánh giá trong cùng PR.

5. Không đổi tên field cũ.

6. Không thay đổi hành vi báo cáo tổng quát đối với dữ liệu legacy.

7. Tách rule nghiệp vụ khỏi component.

8. Tách aggregation khỏi render và event handler.

9. Mọi dữ liệu mới phải có tenant constraint.

10. Mọi thao tác upsert phải idempotent.

11. Không lưu danh sách chi tiết vào một JSON lớn của gói thầu.

12. Sau mỗi PR:
    - Chạy test.
    - Chạy frontend build.
    - Chạy lint/check hiện có.
    - Ghi lại các file đã sửa.
    - Nêu rõ migration và khả năng rollback.

---

# 21. Nguyên tắc thiết kế cốt lõi

Giữ **báo cáo tổng quát làm projection**, còn **báo cáo chi tiết trở thành nguồn dữ liệu chính theo từng nhà thầu và từng vòng đánh giá**.

Cách này giúp:

- Không phải viết lại toàn bộ luồng 1G1T/1G2T hiện tại.
- Tránh hai nguồn dữ liệu không đồng nhất.
- Dễ bổ sung bộ tiêu chí đánh giá chi tiết theo từng hình thức lựa chọn nhà thầu.
- Dễ mở rộng sang phân công chuyên gia, phê duyệt nhiều cấp, xuất Word/PDF và lưu lịch sử phiên bản.
# ĐẶC BIỆT LƯU Ý
- Giữ nguyên tất cả luồng, logic hiện tại, chỉ bổ sung thêm chức năng
- Tuyệt đối không tự ý thay đổi hiển thị css frontend
