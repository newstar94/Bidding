# Bảng mã Mua Sắm Công cần mapping sang Bidding

Ngày nghiên cứu: **2026-08-12**, múi giờ Asia/Saigon.  
Phạm vi: chỉ đọc source code và gọi read-only API danh mục first-party của `muasamcong.mpi.gov.vn`; không sửa implementation.

## 1. Nguồn và mức tin cậy

Nguồn chuẩn chính là endpoint danh mục mà chính frontend Mua Sắm Công gọi:

```text
POST https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/get/category
{"categoryTypeCodeLst":[...]}
```

Frontend portal yêu cầu các nhóm `DM_LVLCNT`, `DM_HTLCNT`, `DM_PTLCNT`, `DM_LHDLCNT`, `BID_CONTRACT_TYPE`, `BIDO_BID_STATUS`, `BID_NOTIFY_STATUS`, `BID_PLAN_STATUS`, `DM_TRANG_THAI`, `DM_QT`, rồi lấy `res.data.categories.*` để hiển thị. Nguồn first-party snapshot: [`SearchHome.vue:L4691-L4752`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/SearchHome.vue#L4691-L4752). Endpoint được gọi lại thành công ngày 2026-08-12.

Liên kết endpoint first-party: [`/services/get/category`](https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/get/category). Đây là POST endpoint; mở bằng GET trong trình duyệt không đại diện response category.

Đối chiếu Bidding khóa tại commit `282bab5182495580056e105796597c79564ead99`.

- **CHẮC CHẮN**: API category hoặc frontend first-party tự gắn code với nhãn.
- **SUY LUẬN**: mapping domain Bidding dựa trên ngữ nghĩa/workflow, chưa phải phép tương đương 1-1 do upstream công bố.
- **CHƯA XÁC MINH**: không có bằng chứng đủ mạnh hoặc Bidding không có giá trị đích tương ứng.

## 2. Mapping chắc chắn

### 2.1 Lĩnh vực: `bidField` / `investField` → `linhVuc`

Nhóm upstream: `DM_LVLCNT`.

| Mua Sắm Công | Nhãn first-party | Bidding `linhVuc` | Trạng thái |
|---|---|---|---|
| `HH` | Hàng hóa | `Hàng hóa` | CHẮC CHẮN |
| `XL` | Xây lắp | `Xây lắp` | CHẮC CHẮN |
| `PTV` | Phi tư vấn | `Phi tư vấn` | CHẮC CHẮN |
| `TV` | Tư vấn | `Tư vấn` | CHẮC CHẮN |
| `HON_HOP` | Hỗn hợp | `Hỗn hợp` | CHẮC CHẮN |

API category trả đúng năm dòng này. Bản snapshot cùng response nằm tại [`catalog_search.json:L81-L121`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/warehouse/catalog_search/catalog_search.json#L81-L121). Bidding hiện có đúng năm option ở [`modal_goithau.html:L49-L56`](../../views/modals/modal_goithau.html#L49) và lookup mapper hiện đã khai báo cùng mapping tại [`ProcurementLookupPreview.js:L27-L34`](../../frontend/procurement/ProcurementLookupPreview.js#L27).

Canonical upstream field hiện được lấy theo alias `bidField`, `investField`, `field` ([`canonical.py:L205`](../../backend/integrations/muasamcong_browser/canonical.py#L205)).

### 2.2 Phương thức lựa chọn: `bidMode` → `phuongThucLuaChon`

Nhóm upstream: `DM_PTLCNT`.

| Mua Sắm Công | Nhãn first-party / Bidding | Trạng thái |
|---|---|---|
| `1_MTHS` | Một giai đoạn một túi hồ sơ | CHẮC CHẮN |
| `1_HTHS` | Một giai đoạn hai túi hồ sơ | CHẮC CHẮN |
| `2_MTHS` | Hai giai đoạn một túi hồ sơ | CHẮC CHẮN |
| `2_HTHS` | Hai giai đoạn hai túi hồ sơ | CHẮC CHẮN |

API category trả đúng bốn giá trị. Portal cũng dùng trực tiếp `bidMode == '1_MTHS'` và `bidMode == '1_HTHS'` để quyết định workflow mở thầu ([`Thong_tin_lua_chon_nha_thau.vue:L1521-L1526`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L1521-L1526)). Bidding có bốn option nhãn tương ứng, cộng option local `Không có` ([`modal_goithau.html:L84-L92`](../../views/modals/modal_goithau.html#L84)); mapper hiện có bốn code đúng tại [`ProcurementLookupPreview.js:L43-L48`](../../frontend/procurement/ProcurementLookupPreview.js#L43).

`NONE → Không có` là alias **nội bộ Bidding**, không phải member do API `DM_PTLCNT` trả về ngày kiểm tra.

### 2.3 Hình thức lựa chọn: `bidForm` → `hinhThucLuaChon`

Nhóm upstream: `DM_HTLCNT`. Sáu giá trị hiện có đích trực tiếp trong Bidding:

| Mua Sắm Công | Nhãn first-party / Bidding | Trạng thái |
|---|---|---|
| `DTRR` | Đấu thầu rộng rãi | CHẮC CHẮN |
| `DTHC` | Đấu thầu hạn chế | CHẮC CHẮN |
| `CDT` | Chỉ định thầu | CHẮC CHẮN |
| `CDTRG` | Chỉ định thầu rút gọn | CHẮC CHẮN |
| `CHCT` | Chào hàng cạnh tranh | CHẮC CHẮN |
| `LCNT_DB` | Lựa chọn nhà thầu trong trường hợp đặc biệt | CHẮC CHẮN |

API first-party trả các code/nhãn trên; Bidding đích chứa đúng sáu nhãn tại [`modal_goithau.html:L72-L82`](../../views/modals/modal_goithau.html#L72).

**Lỗi mapping hiện hữu cần lưu ý:** Bidding hiện map code `DB` sang “Lựa chọn nhà thầu trong trường hợp đặc biệt”, nhưng API category trả code `LCNT_DB`, không trả `DB` ([`ProcurementLookupPreview.js:L35-L42`](../../frontend/procurement/ProcurementLookupPreview.js#L35)). Vì `enumValue()` fail closed với code không có trong bảng, record `LCNT_DB` hiện sẽ bị cảnh báo “không nhận diện” thay vì map ([`ProcurementLookupPreview.js:L83-L91`](../../frontend/procurement/ProcurementLookupPreview.js#L83)).

Các code upstream khác được API `DM_HTLCNT` xác nhận nhưng **Bidding hiện không có option đích**:

| Code | Nhãn first-party |
|---|---|
| `CGTT` | Chào giá trực tuyến |
| `CGTTRG` | Chào giá trực tuyến theo quy trình rút gọn |
| `DH_GNV` | Đặt hàng, giao nhiệm vụ |
| `ESHOP` | Mua sắm trực tuyến |
| `DH` | Đặt hàng |
| `GNV` | Giao nhiệm vụ |
| `CHCTRG` | Chào hàng cạnh tranh rút gọn |
| `MSTT` | Mua sắm trực tiếp |
| `TTH` | Tự thực hiện |
| `TVCN` | Tư vấn cá nhân |
| `TCTVCN` | Tuyển chọn tư vấn cá nhân |
| `DPCT` | Đàm phán cạnh tranh |
| `QCBS` | Tuyển chọn trên cơ sở Chất lượng và Chi phí |
| `DPG` | Đàm phán giá |
| `QBS`, `FBS`, `LCS`, `CQS`, `SSS` | Các hình thức tuyển chọn tư vấn tương ứng |
| `TGTC`, `NHBD`, `TVCT` | Các hình thức tư vấn chuyên biệt theo nhãn API |
| `TGTHCD` | Tham gia thực hiện cộng đồng |
| `TVCNRG` | Tư vấn cá nhân rút gọn |
| `KHAC` | Khác |

Đây là **code chắc chắn nhưng mapping sang Bidding chưa có**; không được ép chúng vào sáu nhãn gần nhất.

### 2.4 Qua mạng và trong nước/quốc tế

| Upstream | Ý nghĩa first-party | Canonical nên dùng | Bidding đích | Trạng thái |
|---|---|---|---|---|
| `isInternet = 1` | Qua mạng | `ONLINE` | `Qua mạng` | CHẮC CHẮN |
| `isInternet = 0` | Không qua mạng | `OFFLINE` | `Không qua mạng` | CHẮC CHẮN |
| `isDomestic = 1` | Trong nước; với FTA portal hiển thị “Nội khối” | `DOMESTIC` | `Trong nước` | CHẮC CHẮN cho flow LDT thường |
| `isDomestic = 0` | Quốc tế | `INTERNATIONAL` | `Quốc tế` | CHẮC CHẮN |

Frontend first-party tự render `isInternet == 1 ? 'Qua mạng' : 'Không qua mạng'` và `isDomestic == 1 ? 'Trong nước' : 'Quốc tế'`; riêng `CPTPP/UKFTA/EVFTA` nhãn `1` đổi thành “Nội khối” ([`Thong_tin_lua_chon_nha_thau.vue:L1031-L1050`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L1031-L1050)). Bidding có option `Qua mạng/Không qua mạng`, `Trong nước/Quốc tế` tại [`modal_goithau.html:L105-L117`](../../views/modals/modal_goithau.html#L105).

Canonical mapper hiện tạo `ONLINE/OFFLINE` và `DOMESTIC/INTERNATIONAL` đúng hướng ([`canonical.py:L215-L218`](../../backend/integrations/muasamcong_browser/canonical.py#L215)), nhưng repository ghi trực tiếp các field canonical vào cột text Bidding ([`repository.py:L555-L581`](../../backend/procurement_import/repository.py#L555)). Vì vậy **FACT:** nếu không có projection khác ở giữa, import sẽ lưu `ONLINE` thay vì option UI `Qua mạng`, và `DOMESTIC` thay vì `Trong nước`; default chỉ áp dụng khi field rỗng. Đây là mismatch cần sửa ở mapping boundary.

### 2.5 Trạng thái upstream

Các nhóm trạng thái khác nhau không được gộp thành một enum duy nhất.

**Kế hoạch — `BID_PLAN_STATUS` / `DM_TRANG_THAI`:**

| Code | Nhãn first-party |
|---|---|
| `00` | Đang soạn thảo |
| `01` | Đã đăng tải |
| `02` | Chưa đăng tải |
| `03` | Đã hủy |

**Thông báo — `BID_NOTIFY_STATUS`:** `01` Đã đăng tải, `02` Chưa đăng tải, `03` Đã hủy; `04` là pseudo-option “Tất cả”, không phải lifecycle state của một entity.

**Gói/quy trình mời thầu — `BIDO_BID_STATUS`:**

| Code | Nhãn first-party |
|---|---|
| `INIT_MT` | Chưa phát hành HSMT |
| `PUB_MT` | Đã phát hành HSMT |
| `OPEN_DXKT` | Mở HSĐXKT |
| `PUB_DSNTKT` | Công khai DS NT KT |
| `OPEN_DXTC` | Mở HSĐXTC |
| `OPEN_BID` | Đã mở thầu |
| `PUB_KQLCNT` | Công khai KQLCNT |
| `CANCEL_BID` | Hủy thầu |
| `PUB_DSN` | Công khai DSN |
| `PUB_CLG`, `OPEN_CLG` | Đăng tải/mở thầu chào lại giá |
| `NEW` | Mới |
| `INIT_MST`, `PUB_MST`, `OPEN_MST`, `RESULT_MST` | Chuỗi sơ tuyển |

Portal dùng các status này trực tiếp để quyết định gọi opening/result ([`Thong_tin_lua_chon_nha_thau.vue:L2617-L2624`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L2617-L2624)). Bidding có domain status khác: `UNKNOWN`, `PREPARING`, `INVITED`, `OPENED`, `EVALUATING`, `PARTIALLY_AWARDED`, `AWARDED`, `CANCELLED` ([`schema.py:L668`](../../backend/db/schema.py#L668)).

Portal còn dựng `statusForNotify` theo context với các code `DHTBMT`, `KCNTTT`, `CNTTT`, `DHT`, `DHKQLCNT`, `DXT`, `VHH`, `KCN`, `DC`. Đây là status hiển thị/search được suy ra, không phải member của `BIDO_BID_STATUS` và không được gộp với raw `status` ([`SearchHome.vue:L1862-L1902`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/SearchHome.vue#L1862-L1902)). `IS_PUBLISH` xuất hiện trong captured search samples nhưng không tìm thấy category/logic first-party giải nghĩa chắc chắn; phải giữ raw ở mức **CHƯA XÁC MINH**, không tự đổi thành publication code `01`.

## 3. Mapping suy luận cần policy nghiệp vụ

Các mapping sau hợp lý nhưng **không phải** ánh xạ 1-1 do upstream công bố:

| Upstream evidence | Bidding status đề xuất | Mức |
|---|---|---|
| Không có linked notice, plan package đủ field | `PREPARING` | SUY LUẬN hiện đã dùng |
| Notice status `01` / `PUB_TBMT` / `PUBLISHED`, có exact linked TBMT | `INVITED` | SUY LUẬN hiện đã dùng |
| `OPEN_BID`, `OPEN_DXKT` hoặc `OPEN_DXTC` | ít nhất `OPENED` | SUY LUẬN; có thể đã sang evaluation tùy evidence khác |
| Có opening + evaluation chưa có kết quả | `EVALUATING` | SUY LUẬN; cần graph evidence, không chỉ status string |
| Có kết quả một số lô nhưng chưa toàn bộ | `PARTIALLY_AWARDED` | SUY LUẬN; phải tính theo lot result |
| `PUB_KQLCNT` và kết quả đầy đủ | `AWARDED` | SUY LUẬN; cần kiểm tra outcome/hủy từng lô |
| `CANCEL_BID`, hoặc plan/notice status `03` đúng entity | `CANCELLED` | SUY LUẬN mạnh, nhưng phải giữ entity scope |

Mapper hiện chỉ chuẩn hóa linked package status `01|PUBLISHED|PUB_TBMT` thành `PUBLISHED` ([`canonical.py:L185-L188`](../../backend/integrations/muasamcong_browser/canonical.py#L185)), rồi import domain chỉ suy ra `INVITED` hoặc `PREPARING`; các trạng thái muộn hơn cố ý trả `UNKNOWN` nếu chưa đủ evidence ([`domain.py:L128-L162`](../../backend/procurement_import/domain.py#L128)). Cách bảo thủ này an toàn hơn map chỉ dựa vào một code.

## 4. Loại hợp đồng: chắc chắn một phần, chưa thể thu gọn toàn bộ

Portal có **hai catalog khác nhau**:

1. `DM_LHDLCNT` — code text dùng ở plan/package `ctype`. API ngày kiểm tra trả **128 giá trị**, gồm các loại cơ bản và mọi tổ hợp.
2. `BID_CONTRACT_TYPE` — code số, chỉ 8 giá trị trong response hiện tại.

Các primitive `DM_LHDLCNT` chắc chắn:

| Code | Nhãn first-party | Bidding hiện có |
|---|---|---|
| `TG` | Trọn gói | `Trọn gói` |
| `DGCD` | Đơn giá cố định | `Theo đơn giá cố định` |
| `DGDC` | Đơn giá điều chỉnh | `Theo đơn giá điều chỉnh` |
| `TTG` | Theo thời gian | `Theo thời gian` |
| `CPCP` | Theo chi phí cộng phí | không có option |
| `KQDR` | Theo kết quả đầu ra | không có option |
| `TLPT` | Theo tỷ lệ phần trăm | không có trong modal hiện tại |
| `KHAC` | Khác | không có option |

Tổ hợp được encode bằng code ghép, ví dụ `TG_DGCD`, `TG_DGDC`, và nhiều tổ hợp dài hơn. Bidding modal chỉ có năm nhãn: Trọn gói, Theo đơn giá cố định, Theo đơn giá điều chỉnh, Theo thời gian, Hỗn hợp ([`modal_goithau.html:L248-L256`](../../views/modals/modal_goithau.html#L248)).

Do đó:

- `TG → Trọn gói` là **CHẮC CHẮN**.
- `DGCD → Theo đơn giá cố định`, `DGDC → Theo đơn giá điều chỉnh`, `TTG → Theo thời gian` là **CHẮC CHẮN về ngữ nghĩa**, chỉ khác tiền tố “Theo” trong nhãn Bidding.
- Mọi code tổ hợp `A_B... → Hỗn hợp` chỉ là **SUY LUẬN mất chi tiết**. Không nên dùng cho raw/canonical; nếu cần projection Bidding legacy thì phải đồng thời giữ upstream code/nhãn nguyên vẹn.
- Các alias hiện có `TRON_GOI`, `DON_GIA_CO_DINH`, `DON_GIA_DIEU_CHINH`, `THEO_THOI_GIAN`, `HON_HOP` trong lookup mapper không phải code `DM_LHDLCNT` mà API category hiện trả; chúng có thể là fixture/legacy aliases ([`ProcurementLookupPreview.js:L50-L57`](../../frontend/procurement/ProcurementLookupPreview.js#L50)).

`BID_CONTRACT_TYPE` trả `1` Trọn gói, `3` Theo thời gian, `11` Theo đơn giá cố định, `12` Theo đơn giá điều chỉnh, cùng các code tổ hợp `13`, `14`, `16`, `19`. Chưa có bằng chứng một field cụ thể trong PLAN production dùng catalog số thay vì `ctype`; vì vậy không trộn hai namespace.

## 5. Code liên quan khác

### `processApply` / `DM_QT`

API xác nhận:

| Code | Ý nghĩa tóm tắt |
|---|---|
| `LDT` | Áp dụng Luật Đấu thầu |
| `ADB` | ADB qua mạng |
| `WB` | WB qua mạng |
| `CPTPP` | CPTPP |
| `EVFTA` | EVFTA/UKVFTA |
| `UKFTA` | CPTPP/EVFTA/UKVFTA |
| `KHAC` | Khác, gồm một số ADB/WB không qua mạng hoặc điều khoản đặc thù |

Đây là discriminator workflow, không phải hình thức/phương thức lựa chọn. Nó ảnh hưởng ý nghĩa nhãn `isDomestic=1` (“Nội khối” với FTA), endpoint notice và opening, nên raw/canonical phải giữ riêng.

### Boolean/package flags

Các response observed và portal code dùng `isMultiLot`, `isPrequalification`, `isConcentrateShopping` dưới dạng `0/1`. Mapping hiển nhiên `1=true`, `0=false`, nhưng Bidding hiện chỉ có `phanLo` “Có/Không” cho multi-lot; hai flag còn lại chưa có domain field đích trực tiếp. Không nên bỏ khỏi raw.

## 6. Gap trong Bidding hiện tại

1. `bidField` và bốn `bidMode` chính đang đúng.
2. `bidForm`: thiếu `LCNT_DB`, đang dùng alias sai/không được API xác nhận là `DB`; thiếu phần lớn catalog chính thức.
3. `contractType`: chỉ `TG` khớp trực tiếp catalog `ctype`; các alias English-style hiện tại không đại diện catalog 128 code.
4. `ONLINE/OFFLINE` và `DOMESTIC/INTERNATIONAL` không khớp chuỗi option/persistence Bidding; cần mapper canonical → domain label rõ ràng.
5. Excel options và modal còn drift: Excel dùng `Trực tiếp` cho đối cực của “Qua mạng”, modal dùng `Không qua mạng` ([`excel_handler.py:L82-L85`](../../backend/documents/excel_handler.py#L82), [`modal_goithau.html:L105-L110`](../../views/modals/modal_goithau.html#L105)). Nên chọn một canonical domain value.
6. Status upstream gồm nhiều namespace; không được map chung code `01` mà bỏ entity kind/category group.
7. Unknown code hiện fail closed ở lookup preview là đúng nguyên tắc, nhưng catalog mapping cần đủ hơn và có diagnostics để phân biệt “upstream code mới” với “Bidding không hỗ trợ nghiệp vụ”.

## 7. Khuyến nghị mapping boundary

Không lưu nhãn tiếng Việt thay cho raw code trong raw bundle. Canonical nên giữ cả:

```json
{
  "field": {"code": "HH", "label": "Hàng hóa", "catalog": "DM_LVLCNT"},
  "selectionForm": {"code": "DTRR", "label": "Đấu thầu rộng rãi", "catalog": "DM_HTLCNT"},
  "selectionMode": {"code": "1_MTHS", "label": "Một giai đoạn một túi hồ sơ", "catalog": "DM_PTLCNT"},
  "contractType": {"code": "TG", "label": "Trọn gói", "catalog": "DM_LHDLCNT"},
  "isInternet": 1,
  "isDomestic": 1
}
```

Projection sang Bidding mới tạo `Hàng hóa`, `Đấu thầu rộng rãi`, `Một giai đoạn một túi hồ sơ`, `Trọn gói`, `Qua mạng`, `Trong nước`. Unknown code phải giữ nguyên trong canonical/raw và tạo warning; không silently map thành `Hỗn hợp`, `Khác` hoặc default.

## 8. Điểm chưa xác minh

- Không xác nhận `DB` là alias chính thức của `LCNT_DB`; endpoint hiện chỉ trả `LCNT_DB`.
- Không xác nhận `TRON_GOI`, `DON_GIA_CO_DINH`, `DON_GIA_DIEU_CHINH`, `THEO_THOI_GIAN`, `HON_HOP` là code production của `DM_LHDLCNT`; endpoint hiện trả `TG`, `DGCD`, `DGDC`, `TTG` và code tổ hợp.
- Chưa xác định đầy đủ khi nào response dùng `BID_CONTRACT_TYPE` numeric thay cho `DM_LHDLCNT` text; phải giữ namespace theo source field/operation.
- Chưa có mapping nghiệp vụ Bidding cho toàn bộ hình thức mới như chào giá trực tuyến, đặt hàng/giao nhiệm vụ, mua sắm trực tuyến và các phương thức tư vấn quốc tế.
- Mapping portal `isDomestic=1 → Nội khối` trong FTA không có giá trị đích tương ứng ở Bidding; map thành `Trong nước` sẽ mất sắc thái pháp lý. Cần policy riêng nếu Bidding hỗ trợ các process này.
- Upstream có thể thay đổi catalog động; mapping nên version/cache category response có TTL và cảnh báo code mới, không hardcode như schema bất biến.
