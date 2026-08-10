# KẾ HOẠCH VÀ PROMPT TÍCH HỢP TRA CỨU KHLCNT/GÓI THẦU TỪ MUA SẮM CÔNG

Ngày lập: 10/08/2026  
Repository: `newstar94/Bidding`  
Phạm vi: BiddingFlow — form Kế hoạch LCNT và Gói thầu  
Trạng thái: Kế hoạch triển khai; kết nối production còn phụ thuộc quyền truy cập/API chính thức của Mua Sắm Công

## 1. Kết quả mong muốn

Khi người dùng nhập:

- mã KHLCNT dạng `PL...` tại trường **Mã kế hoạch**; hoặc
- mã thông báo mời thầu dạng `IB...` tại trường **Mã thông báo mời thầu**,

BiddingFlow tự tra cứu nguồn Mua Sắm Công, chuẩn hóa dữ liệu về hợp đồng nội bộ ổn định, hiển thị bản xem trước các thay đổi và chỉ điền các trường được người dùng xác nhận vào form hiện tại.

Tính năng không tự bấm **Lưu thông tin**, không âm thầm ghi đè dữ liệu đã nhập và không tự tạo dòng phiên bản mới. Toàn bộ validation, uniqueness, persistence, đồng bộ và quy tắc dòng phiên bản tiếp tục đi qua workflow đang có.

## 2. Làm rõ thuật ngữ

- `PL...`: mã KHLCNT trên Hệ thống mạng đấu thầu quốc gia.
- `IB...`: mã TBMT/E-TBMT. Trong model hiện tại mã này được lưu ở thuộc tính `maGoiThau`, nhưng giao diện phải tiếp tục gọi đúng là **Mã thông báo mời thầu**.
- “Mã gói thầu” dạng số thứ tự/tên viết tắt nằm trong KHLCNT không phải lúc nào cũng là mã tra cứu công khai độc lập. MVP chỉ nhận `PL...` và `IB...`.
- **Bản xem trước tra cứu**: dữ liệu chuẩn hóa, chưa phải bản ghi nghiệp vụ và không phải snapshot kế hoạch/gói thầu.
- Chỉ khi người dùng xác nhận và sau đó bấm lưu thì workflow hiện hữu mới tạo/cập nhật phiên bản mới nhất theo quy tắc của dòng phiên bản.

## 3. Hiện trạng và bằng chứng

### 3.1. Trong BiddingFlow

- Form KHLCNT đã có trường `kh-ma` và toàn bộ logic tạo/sửa tại `views/modals/modal_kehoach.html` và `frontend/plans/KeHoachWorkflow.js`.
- Form gói thầu đã có trường `gt-ma`, nhãn “Mã thông báo mời thầu”, và logic tạo/sửa tại `views/modals/modal_goithau.html` và `frontend/packages/GoiThauWorkflow.js`.
- Backend đã tích hợp Mua Sắm Công cho thông tin đối tác và vi phạm nhà thầu, gồm:
  - TLS được xác minh tại `backend/shared/muasamcong_tls.py`;
  - allowlist HTTPS, giới hạn kích thước phản hồi và timeout;
  - cache, bounded concurrency, retry/circuit breaker;
  - production adapter và fixture adapter;
  - route có xác thực, giới hạn tần suất và chạy blocking I/O ngoài event loop.
- Frontend đã có mẫu debounce + `AbortController` + bỏ phản hồi cũ tại `frontend/partners/partnerTaxLookup.js`.

Các mẫu trên phải được tái sử dụng về nguyên tắc, nhưng không ghép logic KHLCNT/TBMT vào module tra cứu đối tác.

### 3.2. Nguồn Mua Sắm Công

Trang chi tiết công khai hiện thể hiện được các trường như mã TBMT, mã KHLCNT, tên dự án/dự toán, tên gói thầu, chủ đầu tư, bên mời thầu, nguồn vốn, lĩnh vực, hình thức/phương thức lựa chọn, thời gian đóng/mở thầu và quyết định phê duyệt.

Tham chiếu chính thức:

- [Cổng Mua Sắm Công](https://muasamcong.mpi.gov.vn/)
- [Ví dụ trang chi tiết TBMT có mã IB và PL](https://muasamcong.mpi.gov.vn/vi/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&bidMode=1_MTHS&id=952e9129-fc52-476d-86a9-c6b326a1fdf8&notifyId=952e9129-fc52-476d-86a9-c6b326a1fdf8&notifyNo=IB2400211941&planNo=PL2400121395&type=es-notify-contractor)

Kiểm tra ngày 10/08/2026 cho thấy endpoint tìm kiếm nội bộ của frontend Mua Sắm Công dùng reCAPTCHA; request không có token hợp lệ bị từ chối. Đây không phải hợp đồng API công khai ổn định để BiddingFlow tự động gọi tùy ý.

## 4. Nguyên tắc bắt buộc

1. Không gọi Mua Sắm Công trực tiếp từ trình duyệt BiddingFlow.
2. Không vượt, giải hộ, tái sử dụng trái mục đích hoặc vô hiệu hóa CAPTCHA.
3. Không coi endpoint nội bộ của frontend là API production nếu chưa có quyền/tài liệu chính thức.
4. Không trả raw payload của upstream về frontend và không để tên field upstream lan ra workflow form.
5. Không tự ghi đè trường đã có dữ liệu.
6. Không tự lưu, tự tạo chủ đầu tư, tự tạo KHLCNT liên quan hoặc tự chuyển trạng thái gói thầu.
7. Unknown enum/category phải để trống kèm cảnh báo; không đoán mapping.
8. Không test live network trong CI; mọi test dùng fixture đã khử dữ liệu không cần thiết.
9. Fixture adapter bị cấm khi `APP_ENV=production`.
10. Mọi thay đổi schema, nếu phát sinh ngoài MVP, phải dùng migration append-only mới; không sửa migration đã phát hành.

## 5. Phạm vi

### 5.1. MVP bắt buộc

- Nhận mã `PL...` và `IB...`, không phân biệt chữ hoa/thường; chuẩn hóa về chữ hoa.
- Cho phép hậu tố phiên bản `-00`, `-01` ở đầu vào nhưng tách về mã gốc để exact lookup; giữ lại input gốc trong bản xem trước.
- Chỉ gọi lookup khi mã đã đúng định dạng đầy đủ.
- Debounce tự động sau khi nhập xong, lookup ngay khi blur/Enter và có nút **Tra cứu lại**.
- Backend xác thực session/workspace, rate limit, timeout, bounded concurrency và exact match.
- Trả DTO chuẩn hóa phiên bản `biddingflow-procurement-preview-v1`.
- Hiện modal xem trước theo từng trường: giá trị hiện tại, giá trị từ Mua Sắm Công, trạng thái áp dụng.
- Mặc định chọn các trường đích đang rỗng; trường đã có dữ liệu mặc định không được chọn.
- Chỉ áp dụng vào form tạo mới. Form read-only, phiên bản lịch sử hoặc trường đã khóa không được lookup/apply.
- `PL...` điền form KHLCNT; `IB...` điền form gói thầu.
- Nếu `IB...` tham chiếu một `PL...` đã có trong BiddingFlow, liên kết với phiên bản mới nhất của đúng dòng phiên bản.
- Nếu chưa có KHLCNT liên quan hoặc chưa khớp được chủ đầu tư, hiển thị cảnh báo và để người dùng xử lý thủ công.
- Không tự động thay đổi `trangThai`, phân công chuyên viên, tổ chuyên gia, tổ thẩm định hoặc dữ liệu kết quả lựa chọn nhà thầu.

### 5.2. Giai đoạn sau, không nằm trong MVP

- Nhập hàng loạt nhiều gói thầu từ một KHLCNT.
- Tự tạo KHLCNT trước rồi tiếp tục tạo gói thầu theo một transaction/wizard.
- Đồng bộ lại định kỳ và tạo diff với bản đã lưu.
- Tự tạo/chỉnh sửa chủ đầu tư từ dữ liệu ngoài.
- Nhập kết quả lựa chọn nhà thầu, nhà thầu trúng thầu hoặc hợp đồng.
- Lưu raw payload upstream.
- Lưu provenance lâu dài vào aggregate; việc này cần quyết định domain và migration riêng.

## 6. Kiến trúc đề xuất

Mua Sắm Công là phụ thuộc **true external**. Đặt seam tại một Interface tra cứu nhỏ; production HTTP Adapter và fixture Adapter cùng thỏa Interface này.

```text
┌──────────────────────── Frontend ────────────────────────┐
│ kh-ma / gt-ma                                            │
│   → ProcurementLookup binding                            │
│   → GET /api/procurement/lookup?code=...                 │
│   → Preview modal → field patch → draft form only        │
└──────────────────────────────┬────────────────────────────┘
                               │ DTO ổn định v1
┌──────────────────────── Backend ─────────────────────────┐
│ Route: auth + org + rate limit + error mapping           │
│   → ProcurementLookup Module                             │
│ Interface: lookup(code, expected_kind) → Preview | none  │
│      ẩn classifier, cache, mapping, schema guard, URL     │
│      → ProcurementSource seam                            │
│         ├─ Official HTTP Adapter (production)             │
│         └─ Fixture Adapter (test/dev only)                │
└──────────────────────────────┬────────────────────────────┘
                               │ HTTPS allowlist
                       Mua Sắm Công/VNEPS
```

### 6.1. Interface backend

Interface công khai của Module chỉ cần một entry point:

```python
lookup(
    *,
    code: str,
    expected_kind: Literal[plan, package],
) -> ProcurementLookupPreview | None
```

Interface bao gồm các invariant sau:

- chỉ nhận mã PL/IB hợp lệ sau normalization và prefix phải khớp `expected_kind`;
- exact identity match giữa mã yêu cầu và mã upstream trả về;
- không trả raw payload;
- money là integer VND hoặc `None`, không dùng float;
- date/datetime là ISO 8601 hoặc `None`;
- category chưa map được không được tự suy diễn;
- danh sách warning có code ổn định, không chứa exception/raw body;
- một lookup bị giới hạn timeout, kích thước phản hồi và số lần retry;
- `None` chỉ có nghĩa là upstream hoàn tất và không tìm thấy; unavailable/schema error phải là lỗi riêng.

Port nội bộ tại seam ngoài:

```python
fetch(identifier: ProcurementIdentifier) -> Mapping[str, object]
```

Caller và route không được biết endpoint, CAPTCHA, field alias hoặc cấu trúc payload của Adapter.

### 6.2. Hợp đồng HTTP nội bộ

Endpoint đề xuất:

```text
GET /api/procurement/lookup?kind=plan&code=PL2600146586
GET /api/procurement/lookup?kind=package&code=IB2600240902
```

Response thành công:

```json
{
  "schemaVersion": "biddingflow-procurement-preview-v1",
  "found": true,
  "kind": "PLAN",
  "inputCode": "pl2600146586-00",
  "canonicalCode": "PL2600146586",
  "source": {
    "provider": "MuaSamCong",
    "fetchedAt": "2026-08-10T08:30:00Z",
    "publicUrl": "https://muasamcong.mpi.gov.vn/..."
  },
  "plan": {},
  "packages": [],
  "warnings": []
}
```

Không tìm thấy trả HTTP 200 với `found: false` để phân biệt rõ với upstream hỏng. Các lỗi ổn định:

| HTTP | Code | Ý nghĩa |
|---:|---|---|
| 400 | `PROCUREMENT_CODE_INVALID` | Mã không đúng định dạng PL/IB |
| 400 | `PROCUREMENT_KIND_MISMATCH` | Prefix mã không đúng loại form yêu cầu |
| 401 | `AUTHENTICATION_REQUIRED` / `INVALID_SESSION` | Chưa đăng nhập/session hết hạn |
| 403 | `ORGANIZATION_ACCESS_DENIED` | Không còn quyền workspace |
| 429 | `PROCUREMENT_LOOKUP_RATE_LIMITED` | Quá giới hạn |
| 502 | `PROCUREMENT_UPSTREAM_UNAVAILABLE` | Nguồn ngoài lỗi/từ chối |
| 502 | `PROCUREMENT_SCHEMA_CHANGED` | Payload không còn đáp ứng schema guard |
| 503 | `PROCUREMENT_LOOKUP_DISABLED` | Chưa cấu hình connector production |
| 503 | `PROCUREMENT_LOOKUP_BUSY` | Hết bounded slot/circuit open |
| 504 | `PROCUREMENT_LOOKUP_TIMEOUT` | Quá timeout tổng |

### 6.3. Ba phương án Interface đã so sánh

**Phương án A — lookup ngữ nghĩa tối thiểu.** Backend có một Interface `lookup(code, expected_kind)`; kết quả là draft chuẩn hóa. Depth cao vì validation, exact match, resilience, schema guard và mapping đều nằm sau một thao tác. Hạn chế: chưa biểu diễn bulk import/capability phức tạp.

**Phương án B — preview theo capability/field patch.** Interface `prepare(request, context)` có target, revision, merge policy, capability, phân trang và patch theo field. Linh hoạt nhất cho nhiều nguồn và bulk import, nhưng bề mặt lớn hơn nhu cầu MVP, làm caller phải học nhiều khái niệm chưa dùng và dễ trộn local-state resolution vào Module nguồn ngoài.

**Phương án C — caller-first frontend binding.** Caller chỉ `attach/reset/dispose` theo loại form. Implementation ẩn debounce, abort, stale guard, preview, conflict và apply order. Đây là Interface phù hợp nhất ở seam frontend vì modal được lazy-load và có thể mở/đóng nhiều lần.

**Khuyến nghị hybrid đã chọn:**

- Backend dùng phương án A để giữ Locality của schema drift và Leverage cho cả PL/IB.
- Frontend dùng phương án C để workflow kế hoạch/gói thầu chỉ attach và dispose, không biết schema/transport.
- Các phần của phương án B như capability, pagination, plan bundle và persisted provenance chỉ được thêm khi làm giai đoạn bulk import. Không làm rộng Interface MVP từ trước.

Interface frontend dự kiến:

```javascript
const binding = procurementLookup.attach({
  kind: plan, // hoặc package
  form,
  codeInput,
  controller: this,
});

binding.reset({ recordId: id || ", readOnly: Boolean(id) });
binding.dispose();
```

Đây là binding vòng đời UI, không phải Interface lưu nghiệp vụ. Nút **Lưu thông tin** và workflow hiện tại vẫn là nơi duy nhất tạo/cập nhật bản ghi.

## 7. DTO chuẩn hóa

### 7.1. Plan preview

```text
code
name
planType
projectCode
projectName
capitalDetail
totalAmountVnd
investorCode
investorName
approvalType
approvalDecisionNo
approvalDecisionDate
publishedAt
projectApprovalDecisionNo
projectApprovalDecisionDate
projectApprovalAgency
projectDuration
projectLocationScale
```

### 7.2. Package preview

```text
noticeCode
planCode
name
priceVnd
executionDuration
field
selectionForm
selectionMode
evaluationMethod
technicalWeight
capitalDetail
contractType
onlineMode
domesticOrInternational
hasAdditionalPurchaseOption
isMultiLot
lots[]
selectionStartTime
selectionDuration
approvalDecisionNo
approvalDecisionDate
publishedAt
bidCloseAt
bidOpenAt
financialProposalOpenAt
bidSecurityValueVnd
bidValidityDays
bidSecurityValidityDays
```

DTO chỉ chứa field BiddingFlow hiểu. Adapter được phép hỗ trợ nhiều alias upstream nhưng phải quy tụ về đúng DTO này.

## 8. Ánh xạ KHLCNT

| Dữ liệu chuẩn hóa | Trường form/model | Chính sách MVP |
|---|---|---|
| `code` | `kh-ma` / `maKeHoach` | Điền exact canonical code |
| `name` | `kh-ten` / `tenKeHoach` | Điền khi có |
| `planType` | `kh-loaihinh` / `loaiHinhMuaSam` | Chỉ map enum đã có fixture/test |
| `projectCode` | `kh-maduan` / `maDuan` | Chỉ khi loại hình là Dự án |
| `projectName` | `kh-duan` / `tenDuAnDuToan` | Điền tên dự án hoặc dự toán |
| `capitalDetail` | `kh-nguonvon` / `nguonVon` | Giữ text công khai đã trim |
| `totalAmountVnd` | `kh-tongmuc` / `tongMucDauTu` | Integer VND, không float |
| `investorCode`, `investorName` | `kh-chudautuid` / `chuDauTuId` | Match record hiện hữu; ưu tiên mã định danh exact, tên chỉ dùng để gợi ý |
| `approvalType` | `kh-pheduyet` / `pheDuyet` | Chỉ map nếu upstream thể hiện rõ; không suy diễn |
| `approvalDecisionNo` | `kh-quyetdinh` / `quyetDinhPheDuyet` | Điền khi có |
| `approvalDecisionDate` | `kh-ngaypheduyet` / `ngayPheDuyet` | Đổi ISO → `dd/MM/yyyy` qua helper hiện có |
| `publishedAt` | `kh-thoigiandang` / `thoiGianDangMa` | Đổi ISO → `dd/MM/yyyy HH:mm` |
| nhóm `projectApproval*` | các trường QĐ phê duyệt dự án | Chỉ áp dụng cho Dự án và field có nguồn rõ |
| `projectDuration` | `kh-thoigian-duan` / `thoiGianDuAn` | Text chuẩn hóa |
| `projectLocationScale` | `kh-diadiem-quymo` / `diaDiemQuyMo` | Text chuẩn hóa |

Không tự điền số/ngày tờ trình dự toán, số/ngày tờ trình kế hoạch hoặc thông tin nội bộ khác nếu nguồn công khai không có field tương ứng rõ ràng.

## 9. Ánh xạ gói thầu

| Dữ liệu chuẩn hóa | Trường form/model | Chính sách MVP |
|---|---|---|
| `noticeCode` | `gt-ma` / `maGoiThau` | Lưu mã TBMT canonical |
| `planCode` | `gt-kehoachid` / `keHoachId` | Chọn phiên bản mới nhất của dòng KHLCNT khớp mã gốc |
| `name` | `gt-ten` / `tenGoiThau` | Điền khi có |
| `priceVnd` | `gt-gia` / `giaGoiThau` | Integer VND |
| `executionDuration` | `gt-thoigian` / `thoiGianThucHien` | Ghép số + đơn vị đã chuẩn hóa |
| `field` | `gt-linhvuc` / `linhVuc` | Chỉ map enum BiddingFlow đã biết |
| `selectionForm` | `gt-hinhthuc` / `hinhThucLuaChon` | Mapping table có test |
| `selectionMode` | `gt-phuongthuc` / `phuongThucLuaChon` | Mapping table có test |
| `evaluationMethod` | `gt-phuongphapdanhgia` / `phuongPhapDanhGia` | Chỉ điền nếu tương thích lĩnh vực/hình thức |
| `technicalWeight` | `gt-trongsokythuat` / `trongSoKyThuat` | Chỉ khi phương pháp yêu cầu trọng số |
| `capitalDetail` | `gt-nguonvon` / `nguonVon` | Tôn trọng trạng thái readonly kế thừa từ KHLCNT |
| `contractType` | `gt-loaihopdong` / `loaiHopDong` | Mapping table có test |
| `onlineMode` | `gt-quatmang` / `quaMang` | Chỉ `Qua mạng`/`Không qua mạng` |
| `domesticOrInternational` | `gt-trongnuocquocte` | Chỉ `Trong nước`/`Quốc tế` |
| `hasAdditionalPurchaseOption` | `gt-tuychonmuathem` | Chỉ điền Có/Không; không bịa danh sách chi tiết |
| `isMultiLot`, `lots[]` | `gt-phanlo`, bảng phần lô | Chỉ áp dụng nếu lot schema đầy đủ và tổng tiền hợp lệ; nếu không chỉ cảnh báo |
| `selectionStartTime` | `gt-thoigianbatdautochuc` | Đúng format form hiện tại |
| `selectionDuration` | `gt-thoigiantochuc` | Text chuẩn hóa |
| `approvalDecisionNo` | `gt-soquyetdinh` | Điền khi có |
| `approvalDecisionDate` | `gt-ngayquyetdinh` | ISO → `dd/MM/yyyy` |
| `publishedAt` | `gt-thoigiandangtai` | ISO → local display format |
| `bidCloseAt` | `gt-thoigiandongthau` | Phải sau thời gian đăng tải |
| `bidOpenAt` | `gt-thoigianmothau` | Phải bằng/sau thời gian đóng thầu |
| `financialProposalOpenAt` | `gt-thoigianmoehsdxtc` | Điền nếu có |
| `bidSecurityValueVnd` | `gt-giatribaomothau` | Không áp dụng cho lĩnh vực Tư vấn |
| `bidValidityDays` | `gt-hieuluchsdt` | Integer không âm |
| `bidSecurityValidityDays` | `gt-hieuluchbaomothau` | Nếu upstream có thì áp sau event của `hieuLucHsdt`; nếu không có thì giữ quy tắc suy ra hiện hữu |

Không tự điền:

- `trangThai`;
- chuyên viên phụ trách;
- tổ chuyên gia/tổ thẩm định;
- gia hạn, yêu cầu/trả lời làm rõ;
- nhà thầu/giá trúng thầu;
- kết quả từng phần lô;
- tỷ lệ bảo đảm hợp đồng nếu nguồn không thể hiện rõ cùng đơn vị.

## 10. Luồng UX

1. Người dùng mở modal tạo mới KHLCNT hoặc gói thầu.
2. Khi input trở thành mã PL/IB hoàn chỉnh, frontend đợi 600 ms rồi lookup. Blur/Enter lookup ngay; request trước bị abort.
3. Input hiển thị trạng thái `Đang tra cứu…`; vùng trạng thái dùng `aria-live="polite"`.
4. Phản hồi chỉ được dùng nếu:
   - workspace lease vẫn còn hiệu lực;
   - modal/form instance vẫn là instance đã phát request;
   - code hiện tại vẫn bằng canonical code của request.
5. Nếu tìm thấy, mở preview modal:

   | Áp dụng | Trường | Hiện tại | Mua Sắm Công | Ghi chú |
   |---|---|---|---|---|

6. Trường đích rỗng được chọn mặc định. Trường có giá trị khác không được chọn mặc định và được đánh dấu “Sẽ ghi đè”.
7. Người dùng bấm **Điền các trường đã chọn**.
8. Frontend áp dụng field theo đúng thứ tự dependency rồi phát các event đang được workflow sử dụng.
9. Người dùng rà soát, bổ sung trường nội bộ và bấm **Lưu thông tin** theo luồng hiện hữu.

Thứ tự áp dụng KHLCNT:

```text
loại hình → toggle field → mã/tên dự án → chủ đầu tư → approval mode
→ toggle approval field → tiền/text → date/datetime → refresh custom controls
```

Thứ tự áp dụng gói thầu:

```text
KHLCNT liên kết → lĩnh vực → hình thức → phương thức → phương pháp đánh giá
→ qua mạng/phân lô/tùy chọn → toggle field → tiền/text → date/datetime
→ refresh custom select/Flatpickr → validation hiển thị
```

Không gán `.value` đơn thuần cho Flatpickr/custom select mà bỏ qua API/event đồng bộ của control.

## 11. Kết nối production và feature flag

### 11.1. Cổng bắt buộc trước production

Chỉ bật production Adapter khi có ít nhất một trong các điều kiện:

- tài liệu/API chính thức cho phép tra cứu theo mã; hoặc
- credential/quyền truy cập do đơn vị vận hành cấp; hoặc
- văn bản/quyết định nội bộ xác nhận cách sử dụng endpoint công khai là hợp lệ và đã qua kiểm thử contract.

Nếu không có, vẫn có thể hoàn thiện Module, route, frontend, fixture và test nhưng `VNEPS_PROCUREMENT_LOOKUP_ENABLED=false`; trạng thái release của connector là **BLOCKED BY EXTERNAL/API AUTHORIZATION**.

Không được đổi blocker này thành giải pháp scraping hoặc CAPTCHA bypass.

### 11.2. Cấu hình đề xuất

```text
VNEPS_PROCUREMENT_LOOKUP_ENABLED=false
VNEPS_PROCUREMENT_LOOKUP_PROVIDER=disabled
VNEPS_PROCUREMENT_LOOKUP_TIMEOUT_SECONDS=8
VNEPS_PROCUREMENT_LOOKUP_RETRIES=1
VNEPS_PROCUREMENT_LOOKUP_MAX_CONCURRENCY=4
VNEPS_PROCUREMENT_LOOKUP_SLOT_TIMEOUT_SECONDS=0.25
VNEPS_PROCUREMENT_LOOKUP_POSITIVE_CACHE_SECONDS=900
VNEPS_PROCUREMENT_LOOKUP_NEGATIVE_CACHE_SECONDS=300
VNEPS_PROCUREMENT_LOOKUP_FIXTURE_PATH=
```

Chỉ thêm base URL/credential sau khi có hợp đồng API thật. Base URL phải là HTTPS và exact-host `muasamcong.mpi.gov.vn`; không cho cấu hình tùy ý dẫn đến SSRF. Redirect phải được kiểm soát bởi helper allowlist hiện có.

## 12. An toàn, độ tin cậy và quan sát vận hành

### 12.1. Backend

- Xác thực session và active organization trước lookup.
- Rate limit theo IP và user; cân nhắc thêm organization để tránh một workspace chiếm toàn bộ quota.
- Chạy outbound blocking I/O bằng `run_blocking_io` với timeout tổng hữu hạn.
- Bounded semaphore; không tạo thread pool con cho mỗi request.
- Circuit breaker tách riêng cho capability procurement lookup để lỗi tìm KHLCNT không làm ngắt tra cứu đối tác.
- Positive/negative cache theo hash của `kind + canonicalCode + adapterSchemaVersion`.
- Giới hạn phản hồi tối đa 1 MiB trước decode JSON.
- Exact-host allowlist, verified TLS, không tắt hostname/certificate verification.
- Parser fail closed khi schema quan trọng đổi.
- Không log raw payload, token, credential hoặc URL chứa secret.

### 12.2. Observability

Metric/log outcome tối thiểu:

```text
found
not_found
invalid
rate_limited
busy
timeout
upstream_error
schema_error
cache_hit
disabled
```

Ghi latency, kind (`PLAN`/`NOTICE`), provider, request ID và organization ID. Không cần ghi full code; nếu cần correlation thì ghi hash rút gọn có salt/process policy phù hợp.

### 12.3. Frontend

- Debounce + abort request cũ.
- Workspace lease/form instance guard trước mọi DOM side effect sau `await`.
- Cleanup timer/listener/controller khi modal đóng hoặc được bind lại.
- Không swallow tất cả lỗi thành “không tìm thấy”; phân biệt unavailable, busy, disabled và not found.
- Thông báo thân thiện, không lộ stack/endpoint/raw response.

## 13. Kế hoạch thay đổi file

Tên file có thể điều chỉnh theo convention thực tế, nhưng seam và trách nhiệm không được phân tán thành các pass-through module.

### 13.1. Backend

| File | Thay đổi |
|---|---|
| `backend/procurement_lookup/service.py` | Module sâu: normalize identifier, interface `lookup`, DTO, mapping, schema guard, cache/error semantics |
| `backend/procurement_lookup/routes.py` | Auth/org/rate limit, `run_blocking_io`, response/error mapping, route factory |
| `backend/integrations/vneps/procurement_provider.py` | Production HTTP Adapter; chỉ triển khai transport khi contract chính thức được xác nhận |
| `backend/integrations/vneps/fake_procurement_provider.py` | Fixture Adapter cho unit/integration/E2E; cấm production |
| `backend/integrations/vneps/__init__.py` | Export adapter cần thiết |
| `backend/app.py` | Đăng ký route factory |
| `.env.example` | Cấu hình, mô tả blocker và cấm fixture production |
| `backend/observability/recording.py` | Outcome/latency metric nếu registry hiện tại phù hợp |

Không thêm migration trong MVP nếu không lưu cache/provenance bền vững. Nếu implementation chọn cache DB hoặc provenance thì phải dừng, ghi rõ lý do và thực hiện đầy đủ migration append-only + fresh schema + serializer/schema runtime + upgrade-chain tests.

### 13.2. Frontend/UI

| File | Thay đổi |
|---|---|
| `frontend/procurement/procurementLookup.js` | Module sâu: client, debounce/abort/stale guard, build field patch, preview và apply draft |
| `frontend/plans/KeHoachWorkflow.js` | Bind/unbind lookup trong modal create; expose context cần thiết, không nhúng schema upstream |
| `frontend/packages/GoiThauWorkflow.js` | Bind/unbind lookup trong modal create; resolve latest plan, apply đúng dependency order |
| `views/modals/modal_kehoach.html` | Nút/trạng thái lookup cạnh `kh-ma` |
| `views/modals/modal_goithau.html` | Nút/trạng thái lookup cạnh `gt-ma` |
| `views/modals/modal_procurement_lookup_preview.html` | Preview chọn field, warning và source link |
| `views/css/components.css` hoặc CSS feature phù hợp | Loading/preview/conflict/a11y/responsive; không inline style |
| loader/modal registry hiện hữu | Đăng ký lazy modal nếu cần |

### 13.3. Test/fixture

```text
tests/fixtures/vneps_procurement_plan.json
tests/fixtures/vneps_procurement_notice.json
tests/fixtures/vneps_procurement_schema_changed.json
tests/test_procurement_lookup_service.py
tests/test_procurement_lookup_routes.py
tests/test_vneps_procurement_provider.py
tests/js/procurement_lookup.test.mjs
e2e/specs/procurement-lookup.spec.mjs
```

Fixture phải bao phủ Dự án, Dự toán mua sắm, một gói thường, gói nhiều phần lô, category không biết và payload bị thay schema.

## 14. Trình tự triển khai

### Wave 0 — Contract và external gate

1. Xác minh tài liệu/quyền truy cập chính thức.
2. Ghi lại endpoint, auth, rate policy, schema/version và điều khoản sử dụng được phép.
3. Thu fixture tối thiểu đã làm sạch; không commit token/cookie/CAPTCHA/raw dữ liệu nhạy cảm.
4. Nếu không qua gate, giữ feature disabled nhưng tiếp tục các wave có thể kiểm thử bằng fixture.

### Wave 1 — Backend đỏ → xanh

1. Viết test identifier normalization, exact match và DTO trước.
2. Viết fixture Adapter và test Module qua Interface.
3. Viết schema guard/mapping table; unknown mapping sinh warning.
4. Viết route test auth, org, rate limit, not-found, busy, timeout, schema error.
5. Thêm production Adapter chỉ khi Wave 0 hợp lệ.

### Wave 2 — Frontend đỏ → xanh

1. Viết test request lifecycle: debounce, abort, stale code, modal đóng, workspace đổi.
2. Viết test field patch: empty/nonempty/readonly/unknown enum/date/money.
3. Thêm UI input status + preview modal.
4. Bind vào modal create KHLCNT và gói thầu.
5. Apply theo dependency order, dispatch event và đồng bộ Flatpickr/custom select.

### Wave 3 — Integration và hardening

1. E2E fixture cho PL và IB.
2. Accessibility/keyboard/mobile preview.
3. Security/quality/build gates.
4. Runbook cấu hình và trạng thái external blocker.

## 15. Test matrix bắt buộc

### 15.1. Backend

- PL/IB hợp lệ; lowercase; có/không hậu tố phiên bản.
- Mã thiếu/thừa/ký tự lạ: 400 và không gọi Adapter.
- Upstream trả mã khác: không match.
- Found, not found, ambiguous, empty response.
- Money integer/string hợp lệ; decimal/overflow/âm bị từ chối hoặc warning theo field.
- Date timezone/invalid date.
- Category biết/không biết.
- Payload thiếu key bắt buộc/schema đổi.
- Response quá lớn, invalid JSON, timeout, HTTP 4xx/5xx, TLS/network error.
- Retry chỉ cho lỗi transient và không vượt budget tổng.
- Circuit/bounded slot/cache hit/negative cache.
- Unauthenticated, stale session, no active org, rate limited.
- Fixture provider bị từ chối ở production.
- Base URL sai scheme/host/path bị từ chối khi startup.

### 15.2. Frontend

- Không request khi mã chưa hoàn chỉnh.
- Debounce chỉ tạo một request cho một mã.
- Nhập mã B trước khi A hoàn tất: A không được sửa DOM.
- Đóng/reopen modal và workspace A→B: response cũ không được áp dụng.
- Not found khác upstream unavailable/disabled.
- Preview chọn mặc định chỉ field rỗng.
- Ghi đè cần lựa chọn rõ ràng.
- Bấm Hủy không đổi bất kỳ field nào.
- Bấm Áp dụng không tự submit/persist/outbox.
- PL apply đúng toggle loại hình/approval và Flatpickr.
- IB resolve KHLCNT phiên bản mới nhất; thiếu KHLCNT có warning.
- Unknown enum không làm select nhận giá trị không tồn tại.
- Multi-lot không đầy đủ không tạo row rác.
- Form edit/read-only/historical không cho apply.
- Cleanup listener không bị nhân đôi sau nhiều lần mở modal.
- Keyboard focus trap, Escape, label/checkbox, `aria-live` và màn hình 320 px.

### 15.3. Lệnh kiểm tra

```powershell
python -m pytest -q tests/test_procurement_lookup_service.py tests/test_procurement_lookup_routes.py tests/test_vneps_procurement_provider.py
node --test tests/js/procurement_lookup.test.mjs
python scripts/check_python_quality.py
npm run lint:security
npm run build:secure
git diff --check
```

Sau targeted tests, chạy full Python/JS suite và E2E mới. CI không phụ thuộc network Mua Sắm Công.

## 16. Acceptance criteria

- [ ] Nhập mã PL hoàn chỉnh trên form tạo KHLCNT sẽ tự tra cứu và hiện preview.
- [ ] Nhập mã IB hoàn chỉnh trên form tạo gói thầu sẽ tự tra cứu và hiện preview.
- [ ] Không có request với input chưa hợp lệ.
- [ ] Browser chỉ gọi backend BiddingFlow, không gọi domain Mua Sắm Công.
- [ ] Dữ liệu upstream không đi thẳng vào DOM/model; luôn qua DTO + mapping + preview.
- [ ] Không field đã có dữ liệu nào bị ghi đè mặc định.
- [ ] Không lookup/apply nào tự lưu hoặc tạo dòng phiên bản.
- [ ] Response cũ không thể ghi vào modal/workspace mới.
- [ ] Unknown mapping để trống và có warning.
- [ ] IB liên kết đúng phiên bản mới nhất của KHLCNT hiện hữu.
- [ ] Missing KHLCNT/chủ đầu tư không gây auto-create.
- [ ] Auth, tenant, rate limit, timeout, bounded concurrency, allowlist TLS và response-size guard có test.
- [ ] Fixture bị cấm production.
- [ ] Không bypass CAPTCHA và không tuyên bố production-ready nếu external gate chưa qua.
- [ ] Targeted tests, full tests, security lint, secure build và `git diff --check` pass.

## 17. Quyết định cần xác nhận sau MVP

1. Có nhập toàn bộ gói thầu khi tra một mã PL hay chỉ dùng PL để điền kế hoạch?
2. Có lưu provenance (`provider`, `fetchedAt`, `publicUrl`, payload hash) cùng aggregate hay trong audit table riêng?
3. Có cho phép tạo chủ đầu tư mới từ preview hay bắt buộc tạo trước?
4. Khi lookup lại một bản ghi đã lưu, có tạo phiên bản mới từ diff hay chỉ hiển thị cảnh báo?
5. Nguồn API/quyền truy cập production do đơn vị nào cấp và SLA/rate limit là gì?

Khuyến nghị hiện tại: MVP chỉ điền draft create form; chưa bulk import, chưa auto-create quan hệ và chưa persisted provenance.

Trước khi triển khai bulk import phải xử lý một điểm cần audit riêng: các lớp validation frontend/backend hiện coi mã TBMT duy nhất rộng hơn phạm vi index PostgreSQL theo kế hoạch. MVP không thay đổi uniqueness contract; mọi duplicate check tiếp tục đi qua workflow hiện hữu.

---

# PROMPT THỰC HIỆN CHO CODEX

Sao chép nguyên khối dưới đây để giao triển khai.

````text
Bạn đang làm việc trong repository BiddingFlow. Hãy triển khai end-to-end tính năng tra cứu KHLCNT/TBMT từ Mua Sắm Công theo tài liệu nguồn bắt buộc:

docs/KE_HOACH_VA_PROMPT_TICH_HOP_MUASAMCONG_KHLCNT_GOI_THAU_2026-08-10.md

Mục tiêu:

- Khi người dùng nhập mã PL... trong modal tạo KHLCNT hoặc IB... trong modal tạo gói thầu, tự tra cứu sau khi mã hoàn chỉnh.
- Luôn hiển thị preview từng field trước khi áp dụng.
- Chỉ điền draft form; không tự submit, persist, stage outbox hoặc tạo phiên bản.
- Không ghi đè field có dữ liệu theo mặc định.
- Không gọi Mua Sắm Công trực tiếp từ browser.

Yêu cầu làm việc:

1. Đọc toàn bộ tài liệu nguồn, CONTEXT.md, README.md và các file hiện tại liên quan trước khi sửa.
2. Kiểm tra git status và bảo toàn mọi thay đổi của người dùng.
3. Dùng test-first cho Module backend, route và lifecycle frontend.
4. Không big-bang refactor workflow kế hoạch/gói thầu.
5. Giữ nguyên mô hình dòng phiên bản, snapshot, validation, uniqueness, persistence và offline sync hiện hữu.
6. Không sửa migration đã phát hành. MVP không cần migration nếu không lưu cache/provenance bền vững.

Thiết kế bắt buộc:

- Tạo một ProcurementLookup Module sâu với Interface công khai nhỏ:
  lookup(code, expected_kind) -> normalized preview | not found
- Đặt seam true-external ở ProcurementSource.
- Có production HTTP Adapter và fixture Adapter; route/caller không biết schema upstream.
- DTO response ổn định: biddingflow-procurement-preview-v1.
- Không trả hoặc log raw upstream payload.
- Exact match canonical PL/IB; unknown enum không được đoán.

External/API gate:

- Trước khi viết production transport, xác minh API/quyền truy cập chính thức và contract thực tế.
- Tuyệt đối không bypass, solve hộ hoặc lách reCAPTCHA; không dùng browser scraping làm production connector.
- Nếu chưa có API/quyền hợp lệ, vẫn hoàn thiện Module, route, fixture, frontend và toàn bộ test phía BiddingFlow sau feature flag disabled-by-default.
- Khi bị external gate, ghi rõ BLOCKED BY EXTERNAL/API AUTHORIZATION và không tuyên bố connector production-ready.
- Fixture provider phải fail startup trong production.

Backend cần có:

- Identifier normalization cho PL/IB, hỗ trợ hậu tố version nhưng exact lookup mã gốc.
- Immutable normalized DTO cho plan/package/source/warnings.
- Conservative parser/schema guard và mapping table có test.
- Auth session + active organization + IP/user rate limit.
- run_blocking_io, timeout tổng, bounded concurrency, bounded retry, circuit breaker tách capability, cache TTL và response-size <= 1 MiB.
- HTTPS exact-host allowlist muasamcong.mpi.gov.vn, verified TLS, controlled redirects.
- Stable error codes đúng tài liệu.
- Feature config trong .env.example, không secret mẫu.
- Outcome/latency observability không log raw code/payload/token.

Frontend cần có:

- Module frontend tập trung client + debounce/AbortController + stale workspace/form/code guard + preview + field patch.
- Tự lookup chỉ khi mã đầy đủ; 600 ms debounce, blur/Enter lookup ngay, có nút retry.
- Cleanup listener/timer/controller khi modal đóng hoặc bind lại.
- Preview hiển thị current/source/warning/checkbox.
- Default select field rỗng; conflict không select mặc định.
- Áp dụng đúng dependency order và dispatch event cho conditional UI, custom select và Flatpickr.
- Chỉ hoạt động ở create mode; disabled ở edit/read-only/historical/locked mode.
- IB resolve KHLCNT theo mã gốc và chọn phiên bản mới nhất của cùng dòng phiên bản.
- Nếu chưa có KHLCNT/chủ đầu tư thì cảnh báo, không auto-create.
- Không tự đổi trạng thái, phân công, chuyên gia/thẩm định hoặc kết quả thầu.
- UI accessible, keyboard usable và responsive 320 px; không inline event/style và không vi phạm Trusted Types/CSP hiện có.

Mapping:

- Thực hiện đúng bảng mapping và chính sách ở mục 8–9 của tài liệu.
- Money dùng integer VND; date/datetime dùng helper hiện có.
- Enum mapping chỉ dựa trên fixture/contract có bằng chứng.
- Lot chỉ apply khi schema đầy đủ và invariant giá/tên hợp lệ; nếu không warning và không tạo row.

Test bắt buộc:

- Python unit/integration: identifier, DTO, parser, exact match, schema drift, money/date, category, not found, errors, retry/circuit/cache/concurrency, auth/tenant/rate, fixture production guard, URL/TLS/size guard.
- JS: debounce, abort, stale A->B, close/reopen modal, workspace switch, preview defaults/conflicts/cancel/apply, no autosave, dependency order, Flatpickr/custom select, latest plan, missing relations, unknown enum, cleanup, read-only.
- E2E bằng fixture cho một PL và một IB; không live network trong CI.
- Regression chứng minh existing manual create/edit/save vẫn hoạt động.

Chạy tối thiểu:

python -m pytest -q tests/test_procurement_lookup_service.py tests/test_procurement_lookup_routes.py tests/test_vneps_procurement_provider.py
node --test tests/js/procurement_lookup.test.mjs
python scripts/check_python_quality.py
npm run lint:security
npm run build:secure
git diff --check

Sau targeted tests, chạy full Python/JS suite và E2E mới. Không nới quality/security threshold để làm test pass.

Definition of Done:

- Toàn bộ acceptance criteria mục 16 có evidence test.
- Không browser call đến Mua Sắm Công.
- Không stale response cross-workspace/form.
- Không auto-overwrite, auto-save, auto-version hoặc auto-create relation.
- Không raw payload/token/credential trong log, response, fixture hoặc git diff.
- Manual workflows không regression.
- External gate được ghi trung thực: enabled và contract-tested, hoặc disabled + blocker rõ ràng.

Kết luận cuối phải báo:

1. Interface và seam đã triển khai.
2. Production Adapter dùng contract nào; external gate pass hay blocked.
3. File/migration đã thay đổi (nếu có migration phải giải thích vì sao lệch MVP).
4. Mapping nào supported, mapping nào warning/unset.
5. Test counts và lệnh đã chạy.
6. Security/tenant/stale-response evidence.
7. Remaining risks và việc còn lại cho bulk import/provenance.

Không được nói “hoàn tất production” nếu connector vẫn cần CAPTCHA, API chưa được cấp quyền hoặc contract chưa được xác minh.
````
