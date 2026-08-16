# Nghiên cứu mapping danh mục hàng hóa từ Mua Sắm Công

- Ngày kiểm tra: 2026-08-15
- Phạm vi: `IB2600291864`, `IB2600271822`, `IB2600320117`
- Mục tiêu: xác định một contract canonical chung cho gói có nhiều hàng hóa trong một lô, một hàng hóa trong một lô và gói không phân lô.
- Trạng thái tài liệu: đề xuất kỹ thuật dựa trên bằng chứng hiện có; chưa phải ADR và chưa thay đổi production code.

## Kết luận ngắn

Không nên có ba parser nghiệp vụ riêng. Ba cách trình bày đều có thể chuẩn hóa thành hai thực thể độc lập:

1. `lots[]`: danh sách phần/lô của gói, có thể rỗng.
2. `goodsItems[]`: danh sách hàng hóa; mỗi hàng chỉ mang `lotNo` khi nguồn chỉ ra một lô hợp lệ.

Cardinality “một hàng hóa/lô” hay “nhiều hàng hóa/lô” không làm thay đổi quy tắc mapping. Nó chỉ làm thay đổi số phần tử `goodsItems` cùng tham chiếu tới một `lotNo`.

- Gói phân lô: tạo lô trước, sau đó ghép hàng hóa vào lô bằng mã nguồn chính xác.
- Gói không phân lô: không tạo lô giả; mọi hàng hóa có `lotNo = null` và khi materialize có `phanLoId = null`.
- Dòng tiêu đề lô không phải hàng hóa.
- Không ghép bằng tên, vị trí hoặc suy đoán từ số thứ tự nếu đã có quan hệ cha/mã lô chính xác.

Lỗi của `IB2600291864` không phải do cấu trúc “một lô nhiều hàng hóa”. Raw snapshot chứa đủ 180 hàng hóa, nhưng parser chỉ đọc `BD.MT.02.1224`, trong khi gói thực tế dùng `BD.MT.02.1281`.

## Nguồn và mức độ tin cậy

### Nguồn sơ cấp đã kiểm tra

1. Snapshot bất biến trong PostgreSQL, bảng `procurement_raw_snapshot`, operation `NOTICE_HSMT`, canonical code `IB2600291864`, lấy lúc `2026-08-15T15:22:14.568Z`. Snapshot ghi endpoint `/lcnt_tbmt_hsmt`; endpoint đầy đủ được định nghĩa tại `backend/integrations/muasamcong_browser/endpoint_catalog.mjs:1,118`.
2. [Trang chi tiết chính thức `IB2600271822`](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&type=es-notify-contractor&stepCode=notify-contractor-step-4-kqlcnt&id=4b69573c-39ec-4af5-8c83-f7e426089845&notifyId=4b69573c-39ec-4af5-8c83-f7e426089845&processApply=LDT&bidMode=1_MTHS&notifyNo=IB2600271822&planNo=PL2600150284&step=tbmt&isInternet=1&bidForm=DTRR) hiển thị tên “Gói thầu số 30: Sinh phẩm gồm 27 mặt hàng tương đương 27 phần”, kế hoạch `PL2600150284`, “Gói có nhiều phần/lô = Có” và 27 lô.
3. [Trang chi tiết chính thức `IB2600320117`](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&type=es-notify-contractor&stepCode=notify-contractor-step-4-kqlcnt&id=8938d059-3ff6-4c37-800f-22f9a83085d0&notifyId=8938d059-3ff6-4c37-800f-22f9a83085d0&processApply=LDT&bidMode=1_MTHS&notifyNo=IB2600320117&planNo=PL2600185915&step=tbmt&isInternet=1&bidForm=DTRR) hiển thị lĩnh vực “Hàng hóa”, kế hoạch `PL2600185915` và “Gói có nhiều phần/lô = Không”.
4. Parser canonical hiện hành tại `backend/integrations/muasamcong_browser/canonical.py:192-319`.
5. Mapping canonical sang draft tại `backend/procurement_import/draft_mapping.py:90-164`.
6. Materialization draft sang `goi_thau_hang_hoa` tại `frontend/procurement/ProcurementDraftWorkflow.js:41-115`.
7. Schema và unique identity của hàng hóa tại `backend/db/schema.py:771-806` và `backend/db/postgres_schema.py:471-474`.
8. Contract đã được chấp thuận trước đây tại `docs/adr/ADR-006-materialize-msc-invitation-goods-and-lot-guarantees.md:9-31`.

### Giới hạn thu thập

- DB hiện chỉ có raw snapshot của `IB2600291864`; không có snapshot cho `IB2600271822` và `IB2600320117` tại thời điểm kiểm tra.
- Hai trang chính thức xác minh metadata và trạng thái phân lô, nhưng không cung cấp raw `NOTICE_HSMT` cho báo cáo này. Vì vậy chưa xác minh được mã form và shape dòng hàng hóa của hai gói qua JSON nguồn.
- Lookup trực tiếp `IB2600271822` qua connector đã chạy đến đúng luồng thật nhưng kết thúc bằng `PROCUREMENT_SESSION_FAILED`; không có dữ liệu được ghi vào DB.
- Gọi endpoint version-list công khai trực tiếp cũng không tạo được một phiên hợp lệ. Vì vậy tài liệu không khẳng định mã form hay tên field cụ thể của hai gói còn lại khi chưa có raw payload.
- `IB2600271822` được xác minh chính thức là gói phân lô với 27 lô; tên gói và mô tả của chủ sản phẩm cho biết 27 mặt hàng tương đương 27 phần. Quan hệ một-một từng dòng hàng vẫn cần raw fixture để khóa bằng test. `IB2600320117` được xác minh chính thức là gói không phân lô. Các tiêu chí mapping bên dưới dựa trên cấu trúc payload, không hard-code ba mã gói.

## Bằng chứng thực tế: `IB2600291864`

### Ba layout theo bằng chứng hiện có

| Gói | Bằng chứng phân lô | Cardinality cần hỗ trợ | Mức xác minh hàng hóa |
|---|---|---|---|
| `IB2600291864` / `PL2600164871` | Raw `NOTICE_HSMT`: 21 lô | hỗn hợp: 3 lô có 1 hàng; các lô còn lại có 2–29 hàng | raw đầy đủ: 180 hàng |
| `IB2600271822` / `PL2600150284` | Trang MSC chính thức: Có, 27 lô | tên gói/mô tả nghiệp vụ: 27 mặt hàng tương đương 27 phần | metadata chính thức; chưa có raw hàng hóa |
| `IB2600320117` / `PL2600185915` | Trang MSC chính thức: Không | tất cả hàng thuộc trực tiếp gói | metadata chính thức; chưa có raw hàng hóa |

### Các form liên quan trong `NOTICE_HSMT`

| Form | Số dòng | Vai trò quan sát được |
|---|---:|---|
| `BD.MT.02.1270` | 21 | Danh sách lô/tổng hợp giá và bảo đảm; không có dòng hàng hóa hợp lệ |
| `BD.MT.02.1281` | 201 | Bảng hỗn hợp gồm 21 dòng lô và 180 dòng hàng hóa |
| `BD.MT.02.1224` | 0/không xuất hiện | Form duy nhất parser hiện hỗ trợ, nên kết quả hiện tại là rỗng |

Trong `BD.MT.02.1281`:

- 21 dòng lô có `id`, `lotNo`, `lotName`, nhưng `name`, `uom`, `qty`, `currentItemIndex` đều rỗng.
- 180 dòng hàng hóa có `id`, `currentItemIndex`, `name`, `uom`, `qty`; `lotNo` và `lotName` trên chính dòng hàng hóa lại rỗng.
- Mỗi dòng hàng hóa mang `parent` và `tempParent`, trỏ chính xác tới `id` của dòng lô.
- Cả 201 dòng đều có `isParent = false`; vì vậy không thể dùng riêng flag này để nhận diện heading.
- Cả 180 `id` và 180 `currentItemIndex` đều duy nhất.
- Ghép bằng `parent` cho kết quả 180/180 hàng hóa thuộc đúng 21 lô, không có orphan.
- Phân bố số hàng hóa theo 21 lô là: `1, 1, 29, 8, 4, 2, 4, 12, 1, 11, 2, 6, 7, 8, 20, 13, 11, 7, 26, 5, 2`. Chính một payload này đã bao phủ cả lô một hàng hóa và lô nhiều hàng hóa.

Trạng thái materialize trong DB tại thời điểm kiểm tra:

- `goi_thau.ma_goi_thau = IB2600291864`
- `phan_lo = Có`
- 21 bản ghi `goi_thau_phan_lo`
- 0 bản ghi `goi_thau_hang_hoa`

### Tại sao parser trả rỗng

Parser khóa whitelist tại:

```python
_GOODS_FORM_CODES = {"BD.MT.02.1224"}
```

Nguồn: `backend/integrations/muasamcong_browser/canonical.py:192`. `_form_values()` chỉ decode form nằm trong whitelist (`:206-221`) và `normalize_goods_items()` chỉ lặp trên whitelist đó (`:249-261`). Do `IB2600291864` dùng `BD.MT.02.1281`, không có dòng nào đi vào bộ chuẩn hóa.

Parser hiện cũng chỉ kế thừa lô theo thứ tự dòng: gặp dòng có `lotNo` thì cập nhật `inherited_lot_no`, sau đó gán lô này cho các dòng kế tiếp (`canonical.py:259-290`). Cách này chạy được với bảng interleaved đã quan sát, nhưng bỏ phí quan hệ `parent`/`tempParent` chính xác và dễ sai nếu upstream đổi thứ tự.

## Contract canonical đề xuất

### `lots[]`

```json
{
  "sourceLotId": "2600239575",
  "lotNo": "PP2600239575",
  "lotName": "Tên phần/lô",
  "lotPrice": 411200000,
  "bidGuarantee": null,
  "executionPeriod": "24 tháng",
  "sourceFormCode": "BD.MT.02.1281",
  "sourceOrder": 0
}
```

Quy tắc:

- `lotNo` là khóa liên kết nguồn; trim và case-fold chỉ để so sánh, vẫn giữ nguyên giá trị gốc để hiển thị/audit.
- `sourceLotId` giữ `id` của dòng lô nếu nguồn có.
- Không dùng `lotName` làm khóa.
- Có một lô vẫn là một phần/lô hợp lệ nếu payload cung cấp danh sách/heading lô; không yêu cầu `len(lots) > 1` mới xem là có phân lô.

### `goodsItems[]`

```json
{
  "sourceItemId": "10798901912845764",
  "sourceIndex": "1.1",
  "lotNo": "PP2600239575",
  "lotName": "Tên phần/lô",
  "code": "1.1",
  "name": "Tên hàng hóa",
  "unit": "tấm",
  "quantity": 20000,
  "technicalRequirement": "Theo quy định tại Chương V.",
  "referenceCode": null,
  "requiredOrigin": null,
  "deliveryLocation": null,
  "deliveryTime": null,
  "note": null,
  "sourceFormCode": "BD.MT.02.1281",
  "sourceOrder": 1
}
```

Quy tắc tạo `code`, theo thứ tự ưu tiên:

1. mã hàng hóa tường minh (`code`, `itemCode`, `goodsCode`, `maHangHoa`);
2. `currentItemIndex`/`itemIndex`/`stt`/`sequence`;
3. `sourceItemId` nếu nguồn không có mã nghiệp vụ hoặc chỉ mục.

Không tạo mã từ tên hàng hóa. `sourceItemId` và `sourceIndex` phải được giữ riêng, không coi mã fallback là bằng chứng rằng nguồn có mã nghiệp vụ.

### Điều kiện một dòng là hàng hóa

Một dòng chỉ được materialize khi có:

- định danh ổn định: ít nhất một trong `sourceItemId`, `sourceIndex`, mã hàng hóa tường minh;
- tên hàng hóa khác rỗng;
- đơn vị tính khác rỗng;
- số lượng là số hữu hạn và lớn hơn 0.

Điều này giữ nguyên contract hiện hành trong ADR-006 và các CHECK của bảng `goi_thau_hang_hoa`. Dòng không hợp lệ vẫn nằm trong raw snapshot, không được biến thành bản ghi nghiệp vụ giả.

## Thuật toán mapping đề xuất

### Bước 1 — Chọn đúng form hàng hóa

Chỉ đọc các contract đã được xác minh, trước mắt gồm:

- `BD.MT.02.0812`: contract không phân lô được xác minh từ raw snapshot thật của `IB2600082707`; `parent` trỏ tới nhóm biểu mẫu, không phải phần lô.
- `BD.MT.02.1224`: contract cũ đã có fixture và regression test tại `tests/test_muasamcong_integration_source.py:1068-1101,1271-1311`.
- `BD.MT.02.1281`: contract được xác minh từ raw snapshot thật của `IB2600291864` và `IB2600271822`.

Không coi `BD.MT.02.1270` là form hàng hóa: 21 dòng của nó là dòng lô/tổng hợp và không thỏa điều kiện hàng hóa.

Nếu một payload chứa nhiều form hàng hóa được hỗ trợ:

1. normalize từng form riêng;
2. bỏ candidate không có dòng hợp lệ;
3. nếu các candidate có cùng identity, chọn candidate giàu trường hơn;
4. nếu các candidate khác nhau về identity/cardinality, trả issue `PROCUREMENT_GOODS_SCHEMA_AMBIGUOUS` và giữ raw evidence, không âm thầm nối hai bảng có thể trùng dữ liệu.

### Bước 2 — Lập chỉ mục lô

Tạo hai map:

- `lotBySourceId`: `id` dòng lô → canonical lot;
- `lotByCode`: mã lô đã trim/case-fold → canonical lot.

Dòng có `lotNo`/`lotCode`/`maPhanLo` nhưng không đủ tên, đơn vị, số lượng dương là dòng cấu trúc lô, không phải hàng hóa.

### Bước 3 — Ghép lô cho từng hàng hóa

Ưu tiên từ mạnh đến yếu:

1. `lotNo` tường minh trên dòng hàng hóa, khớp chính xác `lotByCode`;
2. `parent` hoặc `tempParent`, khớp chính xác `lotBySourceId`;
3. lô hợp lệ gần nhất phía trước chỉ dành cho contract interleaved cũ không có quan hệ cha.

Fallback theo vị trí chỉ được dùng khi không có `parent`/`tempParent` và không có mâu thuẫn. Không ghép bằng tên lô. Với `IB2600291864`, ưu tiên số 2 ghép đủ 180/180 hàng hóa và ổn định hơn kế thừa theo thứ tự hiện tại.

### Bước 4 — Xác định phân lô

| Tình huống nguồn | `isMultiLot` canonical | `lots[]` | `goodsItems[].lotNo` | Bidding `phanLo`/`phanLoId` |
|---|---|---|---|---|
| Có heading/danh sách lô hợp lệ; mỗi lô có nhiều hàng | `true` | giữ đủ lô | mã lô đã ghép | `Có` / ID lô tương ứng |
| Có heading/danh sách lô hợp lệ; mỗi lô có một hàng | `true` | giữ đủ lô | mã lô đã ghép | `Có` / ID lô tương ứng |
| Không có lô và upstream xác nhận không phân lô | `false` | `[]` hoặc `null` | `null` | `Không` / `null` |
| Có tham chiếu lô nhưng không tìm được lô chính xác | không suy đoán | giữ lô xác minh được | không materialize dòng lỗi | issue mapping rõ ràng |
| Flag và cấu trúc lô mâu thuẫn | không âm thầm chọn | giữ raw | chưa materialize | issue `PROCUREMENT_LOT_STRUCTURE_CONFLICT` |

Tên `isMultiLot` của upstream không được dùng theo nghĩa “chỉ true khi có hơn một lô” ở seam Bidding. Bằng chứng cấu trúc lô là điều quyết định việc có tạo `goi_thau_phan_lo`; cardinality của hàng hóa không quyết định `phanLo`.

### Bước 5 — Materialize

Materialization hiện có đã gần đúng:

- tạo lô trước;
- `lotByCode` ghép `maPhanLo` chính xác;
- gói phân lô bỏ qua hàng không ghép được lô;
- gói không phân lô dùng `phanLoId = null`;
- unique identity là `(organization, package, normalized goods code)` khi không phân lô và thêm `phanLoId` khi có phân lô (`backend/db/postgres_schema.py:473-474`).

Vì vậy mapping canonical nên cung cấp ổn định `code` và `lotNo`; không cần tạo schema bảng mới để hỗ trợ ba layout.

Hành vi bảo toàn dữ liệu người dùng hiện tại phải giữ nguyên: `seedProcurementGoods()` không backfill nếu gói đã có ít nhất một hàng hóa (`frontend/procurement/ProcurementDraftWorkflow.js:98-115`; ADR-006 dòng 17,31). Sau khi parser được mở rộng, `IB2600291864` hiện có 0 hàng hóa nên có thể lấy lại từ MSC để seed đủ danh mục. Không được dùng việc sửa parser để ghi đè danh mục người dùng đã chỉnh.

## Mapping trường nguồn → canonical → Bidding

| Nguồn MSC | Canonical | Bidding draft / DB | Ghi chú |
|---|---|---|---|
| `id` dòng hàng | `sourceItemId` | chưa cần cột riêng | giữ trong preview/provenance; dùng fallback identity |
| `currentItemIndex` / `itemIndex` / `stt` / `sequence` | `sourceIndex` | fallback `maHangHoa` | ví dụ `1.1`; giữ nguyên text |
| `code` / `itemCode` / `goodsCode` / `maHangHoa` | `code` | `maHangHoa` / `ma_hang_hoa` | fallback theo quy tắc trên |
| `name` / `goodsName` / `itemName` / `tenHangHoa` | `name` | `tenHangHoa` / `ten_hang_hoa` | bắt buộc |
| `uom` / `unit` / `unitName` / `donViTinh` | `unit` | `donViTinh` / `don_vi_tinh` | bắt buộc |
| `qty` / `quantity` / `amount` / `soLuong` | `quantity` | `soLuong` / `so_luong` | số hữu hạn > 0 |
| heading `id` | `sourceLotId` | chỉ dùng để ghép | không phải hàng hóa |
| `lotNo` / `lotCode` / `maPhanLo` | `lotNo` | `maPhanLo`, sau đó `phanLoId` | khớp mã chính xác |
| `lotName` / `tenPhanLo` | `lotName` | `tenPhanLo` | hiển thị, không làm khóa |
| `parent` / `tempParent` | quan hệ tới `sourceLotId` | không lưu trực tiếp | ưu tiên hơn kế thừa vị trí |
| `description` / `technicalRequirement` / `technicalSpecifications` / `specification` / `yeuCauKyThuat` | `technicalRequirement` | `yeuCauKyThuat` | để trống nếu thiếu |
| `referenceCode` / `modelNo` / `model` / `kyMaHieuThamChieu` | `referenceCode` | `kyMaHieuThamChieu` | không suy đoán |
| `requiredOrigin` / `origin` / `xuatXuYeuCau` | `requiredOrigin` | `xuatXuYeuCau` | không suy đoán |
| `deliveryLocation` / `deliveryPlace` / `diaDiemGiaoHang` | `deliveryLocation` | `diaDiemGiaoHang` | không lấy `place` của heading nếu chưa xác nhận semantics |
| `deliveryTime` / `deliveryPeriod` / `thoiGianGiaoHang` | `deliveryTime` | `thoiGianGiaoHang` | không lấy `proccessing` của heading nếu chưa xác nhận semantics |
| `note` / `notes` / `ghiChu` | `note` | `ghiChu` | để trống nếu thiếu |

Hai field `place` và `proccessing` xuất hiện trên heading `BD.MT.02.1281` của `IB2600291864`, nhưng chưa nên tự động phát tán xuống từng hàng cho đến khi có contract nguồn xác nhận chúng là địa điểm/thời gian giao hàng của toàn lô. Đây là điểm cần thêm fixture raw trước khi mapping.

## Edge cases và cách xử lý

1. **Một lô có đúng một hàng:** vẫn tạo một lô và một hàng gắn lô; không collapse thành gói không phân lô.
2. **Một gói có cả lô một hàng và lô nhiều hàng:** cùng thuật toán; `IB2600291864` đã chứng minh tình huống này.
3. **Không phân lô:** không tạo lô “mặc định”, “Lô 1” hay lấy mã gói làm mã lô.
4. **Hàng có `parent` nhưng parent không tồn tại:** giữ raw, không ghép vào lô gần nhất; phát issue orphan.
5. **Heading lặp cùng `lotNo`:** chỉ gộp khi nội dung tương thích; khác tên/giá phải báo xung đột.
6. **Hàng trùng `code` trong cùng lô:** không âm thầm bỏ dòng. Nếu cùng `sourceItemId` là duplicate transport thì dedupe; nếu khác source ID phải báo conflict vì DB không thể chứa hai mã giống nhau trong cùng lô.
7. **Cùng `code` ở hai lô khác nhau:** hợp lệ; unique index hiện cho phép vì identity có `phanLoId`.
8. **Số lượng dùng dấu phẩy thập phân:** `_number()` hiện hỗ trợ chuỗi kiểu `2,5`; giữ số thực.
9. **Số lượng 0, âm, NaN/Infinity, thiếu đơn vị hoặc thiếu tên:** không materialize.
10. **Form vừa có `parent` vừa có lô kế thừa nhưng hai kết quả khác nhau:** coi là schema/data conflict; không chọn tùy tiện.
11. **Nhiều revision TBMT:** parse theo từng revision, không trộn hàng giữa revision; source identity phải nằm trong revision provenance.
12. **Gói đã có hàng người dùng chỉnh:** không overwrite theo ADR-006. Nếu cần reconcile một phần trong tương lai, đó là thay đổi nghiệp vụ riêng cần ADR mới.

## Feedback loop/regression matrix đề xuất cho bước triển khai

Một test parameterized nên chạy cùng seam `normalize_notice_revision()` → `map_package_canonical_to_draft()` → `mapProcurementGoods()`:

| Fixture | Kỳ vọng lô | Kỳ vọng hàng | Kỳ vọng liên kết |
|---|---:|---:|---|
| Raw tối giản từ `IB2600291864` / `BD.MT.02.1281` | 21 | 180 | 180/180 đúng lô; 0 heading thành hàng |
| `BD.MT.02.1224` legacy hiện có | 2 | 2 | kế thừa heading đúng; không regression |
| Một hàng mỗi lô (raw fixture cần thu từ `IB2600271822`) | theo raw | bằng số lô | mỗi lô đúng 1 hàng |
| Không phân lô (raw fixture cần thu từ `IB2600320117`) | 0 | theo raw | mọi `lotNo` và `phanLoId` là `null` |
| Orphan parent | giữ lô hợp lệ | bỏ orphan | có issue rõ ràng |
| Hai form cùng identity | không nhân đôi | đúng unique count | chọn candidate giàu dữ liệu |
| Hai form divergent | không materialize mơ hồ | 0 ở nhánh lỗi | `PROCUREMENT_GOODS_SCHEMA_AMBIGUOUS` |

Lệnh feedback loop tối thiểu khi triển khai nên là một test Python tập trung ở `tests/test_muasamcong_integration_source.py`, cộng test JS của `mapProcurementGoods()`. Không nên sửa expected value của fixture cũ để hợp thức hóa parser mới; phải thêm fixture layout mới và giữ test `BD.MT.02.1224` xanh.

## Khuyến nghị triển khai theo thứ tự

1. Giữ `BD.MT.02.0812`, `BD.MT.02.1224` và `BD.MT.02.1281` trong registry contract đã xác minh, kèm regression fixture riêng cho từng layout.
2. Giữ ưu tiên ghép lô `explicit lotNo → parent/tempParent → legacy preceding heading`; với gói không phân lô, `parent` nhóm của `0812` không được hiểu là lô.
3. Giữ một canonical shape duy nhất cho mọi cardinality; không thêm nhánh hard-code theo mã gói.
4. Thu raw snapshot `IB2600320117` khi connector có dữ liệu để đối chiếu thêm layout không phân lô; hiện contract không phân lô đã được khóa bằng snapshot thật `IB2600082707`.
5. Re-import `IB2600291864` sau khi restart backend để backfill gói hiện có 0 hàng hóa; không rewrite các gói đã có danh mục người dùng.

## Truy vấn kiểm chứng đã dùng

Các truy vấn dưới đây chỉ đọc và không in `request_json` chứa thông tin xác thực:

```sql
SELECT canonical_code, operation, success, retrieved_at
FROM procurement_raw_snapshot
WHERE canonical_code IN ('IB2600291864', 'IB2600271822', 'IB2600320117')
ORDER BY canonical_code, operation;

SELECT endpoint, response_json, retrieved_at
FROM procurement_raw_snapshot
WHERE canonical_code = 'IB2600291864'
  AND operation = 'NOTICE_HSMT'
  AND success = 1
ORDER BY retrieved_at DESC
LIMIT 1;
```

Việc decode `formValue` dùng chính helper `_decoded_form_value()` và `_walk()` của production parser để tránh tạo một cách hiểu JSON khác với ứng dụng. Kết quả hiện hành `normalize_goods_items(raw) = 0`; khi thử cùng thuật toán trên form `BD.MT.02.1281`, có 201 dòng cấu trúc, gồm 21 heading và 180 hàng hóa hợp lệ.
