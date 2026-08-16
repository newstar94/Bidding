# Luồng dữ liệu biên bản mở thầu MSC trong `WEB_DAU_THAU`

- Ngày kiểm tra: 2026-08-16
- Phạm vi: nghiên cứu read-only repository tham chiếu; không sửa production code, schema hoặc test.
- Repository nguồn: [`newstar94/WEB_DAU_THAU`](https://github.com/newstar94/WEB_DAU_THAU)
- Commit được khóa để đối chiếu: [`0ccebd94a7819413730778ee9dec517a016cfbd0`](https://github.com/newstar94/WEB_DAU_THAU/tree/0ccebd94a7819413730778ee9dec517a016cfbd0), commit ngày 2026-08-11.
- Nguồn quan trọng nhất: artifact Vue của trang chi tiết Mua sắm công tại [`code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue). Đây là code giao diện MSC được lưu trong repo tham chiếu; `src/server.js` và `src/public/index.html` là phần collector/render do `WEB_DAU_THAU` xây dựng quanh luồng đó.

## Kết luận đã xác minh

1. Đối với luồng LDT online, artifact giao diện MSC lấy bidder summary từ `bid-open`, lấy quan hệ nhà thầu → lô từ `lot-open`, và lấy các dòng mở thầu theo lô từ `lotOpenDetail`. `notify` và `roundmng` cung cấp metadata/thông tin vòng mở thầu.
2. `bidSubmissionByContractorViewResponse.bidSubmissionDTOList` của `bid-open` là nguồn bidder-level cho `bidValidityNum`, `bidGuarantee`, `totalGuaranteeValue`, `bidGuaranteeValidity`, `ventureName` và `ventureCode`.
3. Khi gói phân lô, UI join bidder summary với từng dòng `lotOpenDetail` bằng `contractorCode`, rồi sao chép các field bidder-level xuống từng dòng lô. Vì vậy một bidder tham gia nhiều lô phải nhận cùng hiệu lực HSDT và bảo đảm dự thầu trên các dòng lô của bidder đó.
4. `lot-open` không đồng nghĩa với `/submission`: biến `urlLotOpenSubmissionKqmtLdt` trỏ tới `/lot-open`. Endpoint `/submission` chỉ được khai báo trong artifact nhưng không có call site; collector hiện tại của `WEB_DAU_THAU` cũng không gọi nó. Không có bằng chứng từ repository này để coi `submission` là required opening source.
5. Với `1_MTHS`, pack mở thầu ban đầu là `0`; với `1_HTHS`, pack kỹ thuật là `1`; pack tài chính là `2` và chỉ có ý nghĩa khi trạng thái đã tới `OPEN_DXTC` hoặc `PUB_KQLCNT`.
6. Liên danh vẫn join bằng `contractorCode`. `ventureName`/`ventureCode` được copy từ bidder summary sang dòng lô để hiển thị, không được dùng thay cho khóa join. Không tìm thấy `memberList`, `ventureMembers`, `jointVentureMembers` hoặc một member-level join trong luồng opening này.

## 1. Endpoint graph thực tế

Artifact MSC khai báo các endpoint opening tại [dòng 482–489](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L482-L489):

| Vai trò | Endpoint |
|---|---|
| metadata thông báo | `/exposeldtkqmt/bid-notification-p/notify` |
| trạng thái vòng mở thầu | `/expose/ldtkqmt/bid-notification-p/roundmng` |
| bidder summary | `/expose/ldtkqmt/bid-notification-p/bid-open` |
| dữ liệu lô theo nhà thầu | `/expose/ldtkqmt/bid-notification-p/lot-open` |
| dòng mở thầu theo lô | `/expose/ldtkqmt/bid-notification-p/lotOpenDetail` |
| khai báo nhưng không được gọi trong file | `/expose/ldtkqmt/bid-notification-p/submission` |

`loadDetailKqmtLdt()` tạo payload chung gồm `notifyNo`, `notifyId`, `type: "TBMT"` và `packType` ([dòng 3803–3810](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3803-L3810)). Hàm này được gọi cho các bước đã mở thầu, danh sách đạt kỹ thuật và kết quả lựa chọn nhà thầu ([dòng 2653–2704](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L2653-L2704)).

Search record mẫu lưu riêng `notifyId` và `bidOpenId` ([`Bien_ban_mo_thau.json` dòng 2–7](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/warehouse/data_example_by_type/Bien_ban_mo_thau/Bien_ban_mo_thau.json#L2-L7)), nhưng payload opening ở trên dùng `notifyId`, không dùng `bidOpenId`. Vì vậy không nên thay ID trong payload chỉ vì search result có `bidOpenId`.

Luồng request quan sát được:

```text
notify ───────────────┐
roundmng ─────────────┼── chạy bằng các callback độc lập
bid-open ─────────────┤
  └─ lot-open         │   (gọi sau khi bid-open trả về)
lotOpenDetail ────────┘   (chạy độc lập với nhánh bid-open → lot-open)
```

- `notify` và `roundmng` được gọi độc lập tại [dòng 3855–3889](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3855-L3889).
- `bid-open` được gọi tại [dòng 3891–3908](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3891-L3908), rồi `lot-open` được gọi trong callback của nó tại [dòng 3911–3925](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3911-L3925).
- `lotOpenDetail` được gọi ở nhánh độc lập tại [dòng 3972–3984](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3972-L3984).

Collector của chính `WEB_DAU_THAU` phản ánh cùng graph: catalog có `openingNotify`, `openingRound`, `openingBid`, `openingLot`, `openingLotDetail`, không có `openingSubmission` ([`src/server.js` dòng 23–38](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L23-L38)); `collectLdtBidOpening()` fetch đồng thời đúng năm nguồn đó ([dòng 268–284](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L268-L284)). UI của repo cũng mô tả rõ dữ liệu được ghép từ `roundmng`, `bid-open`, `lot-open`, `lotOpenDetail` ([`src/public/index.html` dòng 1244–1258](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/public/index.html#L1244-L1258)).

## 2. `bid-open` là nguồn bidder-level

Response `bid-open` được đọc theo đường dẫn:

```text
response.data
└─ bidSubmissionByContractorViewResponse
   └─ bidSubmissionDTOList[]
```

Giao diện gán trực tiếp danh sách này vào state tại [dòng 3896–3908](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3896-L3908). Renderer của `WEB_DAU_THAU` cũng lấy bidder từ chính path đó và hiển thị `bidValidityNum`, `bidGuarantee`, `bidGuaranteeValidity` trực tiếp trên bidder row ([`src/public/index.html` dòng 1261–1285](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/public/index.html#L1261-L1285)).

Các field đã xác minh trong bidder-level object và cách UI dùng chúng:

| Field upstream | Cách dùng đã thấy |
|---|---|
| `contractorCode` | khóa join bidder ↔ `lot-open` và bidder ↔ `lotOpenDetail` |
| `contractorName` | tên thường |
| `ventureName` | tên hiển thị ưu tiên nếu là liên danh |
| `ventureCode` | metadata liên danh được copy sang lot row |
| `bidValidityNum` | hiệu lực E-HSDT |
| `bidGuarantee` | giá trị bảo đảm dự thầu được ưu tiên |
| `totalGuaranteeValue` | fallback hiển thị nếu `bidGuarantee` không có |
| `bidGuaranteeValidity` | hiệu lực bảo đảm dự thầu |
| `lotNoValueDTOList[].bidOpenView[]` | metadata theo lô như `bidContractPeriod`, `estimateDateMedical` |

Trong bảng phân lô, UI hiển thị `bidValidityNum`, ưu tiên `bidGuarantee` rồi fallback `totalGuaranteeValue`, và hiển thị `bidGuaranteeValidity` trên mỗi lot row ([dòng 5894–5920](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L5894-L5920)). Trong view theo bidder, logic fallback tương tự nằm tại [dòng 6015–6033](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L6015-L6033).

Điểm cần phân biệt: nested `bidOpenView` còn có field `bidGuaranteed`, được hiển thị trên dòng chi tiết lô ([dòng 6048–6060](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L6048-L6060)). Repository thể hiện `bidGuaranteed` và bidder-level `bidGuarantee`/`totalGuaranteeValue` là các field khác nhau; không có căn cứ để gộp chúng thành một alias tuyệt đối. Hành vi UI chỉ chứng minh rằng ở summary bidder/lot, `bidGuarantee` được ưu tiên và `totalGuaranteeValue` là fallback.

## 3. Quan hệ nhà thầu ↔ lô và phép join

### `lot-open`

Response `/lot-open` là một array. UI lọc array theo bidder và gắn vào `bidSubmissionDTOList[].lotNoValueDTOList`:

```javascript
it.lotNoValueDTOList = res.data?.filter(
    lot => lot.contractorCode == it.contractorCode
)
```

Đoạn này nằm tại [dòng 3916–3925](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3916-L3925). Vì vậy repository này cho thấy quan hệ bidder → danh sách lô đến từ `lot-open`, không phải `/submission`.

### `lotOpenDetail`

Response `/lotOpenDetail` cũng là array và được lưu thành `bidoLotOpenDetailDTOS` ([dòng 3975–3984](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3975-L3984)). Với mỗi detail row, UI tìm bidder summary bằng so sánh chính xác `e.contractorCode === itemLot.contractorCode`, sau đó propagate:

- `ventureName`, `ventureCode`, `fileId`;
- `bidValidityNum`;
- `bidGuarantee`;
- `totalGuaranteeValue`;
- `bidGuaranteeValidity`;
- `bidContractPeriod`, `estimateDateMedical`, `techScore`.

Đây là code đang chạy tại [dòng 3983–3999](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3983-L3999). Sau đó rows được group theo `lotNo` và sort trong từng lô ([dòng 4000–4010](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L4000-L4010)).

Nhánh callback của `lot-open` thực hiện cùng phép propagate nếu `lotOpenDetail` đã về trước ([dòng 3926–3954](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3926-L3954)); nhánh callback `lotOpenDetail` thực hiện nếu `lot-open` đã gắn `lotNoValueDTOList` trước. Đây là cách artifact MSC xử lý hai thứ tự response có thể xảy ra.

Hệ quả cho canonical flat rows:

```text
bid-open bidder A: validity/security
          +
lotOpenDetail: A/L1, A/L2, A/L3
          ↓ join contractorCode
A/L1, A/L2, A/L3 đều nhận cùng bidder-level validity/security
```

Không được lấy một guarantee từ lot row trống để ghi đè bidder-level value. Không được cross-map theo tên. Repository cũng không normalize `contractorCode`; code hiện dùng `==`/`===` trực tiếp. Nếu Bidding cần hỗ trợ khác biệt chữ hoa/thường hoặc prefix `vn`, đó phải là normalization rule có test và vẫn giữ nguyên code hiển thị, không thể dẫn ngược từ UI này rằng được phép strip prefix mù quáng.

## 4. `packType`, `1_MTHS` và `1_HTHS`

| Trường hợp | `packType` | Hành vi được xác minh |
|---|---:|---|
| `1_MTHS` | `0` | một giai đoạn một túi; dùng bảng “Thông tin nhà thầu” |
| `1_HTHS`, pha kỹ thuật | `1` | mở hồ sơ đề xuất kỹ thuật |
| `1_HTHS`, pha tài chính | `2` | mở hồ sơ đề xuất tài chính khi trạng thái `OPEN_DXTC` hoặc `PUB_KQLCNT` |

Catalog của repo định nghĩa `1_MTHS` là “Một giai đoạn một túi hồ sơ” và `1_HTHS` là “Một giai đoạn hai túi hồ sơ” ([`catalog_vue_search.json` dòng 458–470](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/warehouse/catalog_search/catalog_vue_search.json#L458-L470)).

Payload ban đầu chọn `0` nếu `bidMode == '1_MTHS'`, ngược lại chọn `1` ([dòng 3803–3810](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3803-L3810)). Hàm dựng pha tài chính dùng `packType: 2` ([dòng 1476–1506](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L1476-L1506)). Phần render phân biệt kỹ thuật, tài chính và một túi tại [dòng 5514–5541](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L5514-L5541).

Collector `WEB_DAU_THAU` mã hóa cùng rule rõ hơn: `technicalPackType = 0` cho `1_MTHS`, còn lại `1`; chỉ fetch financial prefix với `packType = 2` khi `bidMode === '1_HTHS'` và `bidStatus` thuộc `OPEN_DXTC`, `PUB_KQLCNT` ([`src/server.js` dòng 362–384](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L362-L384)).

Một khác biệt nhỏ cần lưu ý: nhánh initial/technical copy cả `totalGuaranteeValue` xuống lot detail ([dòng 3931–3940](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3931-L3940)), còn nhánh `reRenderDXTC()` copy `bidGuarantee` và `bidGuaranteeValidity` nhưng không copy `totalGuaranteeValue` ([dòng 1619–1627](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L1619-L1627)). Bidding không nên sao chép bất nhất này; source authority vẫn là bidder summary của đúng pack/phase.

## 5. `/submission`: khai báo không phải bằng chứng sử dụng

`urlSubmissionKqmtLdt` xuất hiện ở khai báo endpoint tại [dòng 485](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L485), nhưng không có lần tham chiếu thứ hai trong file 9.593 dòng. Trái lại, `urlLotOpenSubmissionKqmtLdt` được gọi và biến đó trỏ tới `/lot-open`, không phải `/submission` ([dòng 487](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L487), [dòng 3916–3925](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3916-L3925)).

Kết luận giới hạn:

- Có thể xác nhận `/submission` tồn tại trong endpoint catalog của artifact.
- Không thể xác nhận `/submission` tham gia luồng opening đang chạy từ repository này.
- Không nên đưa `OPENING_SUBMISSION` vào required source set chỉ dựa trên tên endpoint.
- Nếu live trace của MSC ở phiên bản khác chứng minh `/submission` được gọi, có thể thu thập optional và dùng theo schema thực tế; nhưng đó sẽ là bằng chứng mới ngoài commit đang kiểm tra.

## 6. Liên danh

Trong opening join, UI tìm bidder bằng `contractorCode`, rồi copy `ventureName` và `ventureCode` sang lot row ([dòng 3926–3937](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L3926-L3937)). Khi hiển thị, UI dùng `ventureName` nếu có, nếu không dùng `contractorName` ([dòng 5903–5912](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L5903-L5912)).

Ở các phần khác của artifact, danh sách liên danh có thể được group bằng `ventureCode` ([dòng 2884–2905](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L2884-L2905)) hoặc `ventureName` ([dòng 2400–2428](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue#L2400-L2428)), nhưng các helper đó không phải khóa join security trong opening flow.

Không có bằng chứng trong source đã kiểm tra cho member arrays như `memberList`, `ventureMembers` hay `jointVentureMembers`. Do đó test/fix nên ưu tiên stable bidder `contractorCode` từ `bid-open`; `ventureName`/`ventureCode` chỉ bổ sung identity/hiển thị theo dữ liệu thực tế, không được phân bổ guarantee cho từng thành viên bằng suy đoán theo tên.

## 7. Hàm ý trực tiếp cho patch Bidding

Pipeline tương thích với hành vi MSC đã xác minh là:

```text
OPENING_BID
  → bidSubmissionByContractorViewResponse.bidSubmissionDTOList[]
  → bidder security index theo contractorCode + phase

OPENING_LOT
  → contractorCode ↔ lotNo / lotNoValueDTOList

OPENING_LOT_DETAIL
  → contractorCode + lotNo rows

join
  → propagate bidValidityNum, bidGuarantee/totalGuaranteeValue,
    bidGuaranteeValidity, venture metadata
  → opening.bidders[] flat rows
```

Các regression seam nên chứng minh:

1. `bid-open` missing/invalid không được coi opening complete khi bidder-level security là required.
2. Một bidder nhiều lô nhận cùng bidder-level fields trên tất cả lô.
3. Nhiều bidder không cross-map; join theo identity ổn định, không theo tên.
4. Kết quả không phụ thuộc thứ tự `OPENING_BID` và `OPENING_LOT_DETAIL` đến trước.
5. `bidGuarantee` có authority cao hơn lot detail rỗng/xung đột; `totalGuaranteeValue` chỉ là fallback theo hành vi UI đã quan sát, không phải alias bắt buộc.
6. `1_MTHS` dùng pack `0`; `1_HTHS` technical `1`, financial `2`; không trộn dữ liệu hai phase.
7. `OPENING_SUBMISSION` không phải mandatory theo commit tham chiếu này.
8. Với liên danh, security bám bidder identity của `bid-open`, không bám member name.

## Giới hạn bằng chứng

- Repository chỉ có một commit tại thời điểm kiểm tra; kết luận được khóa ở SHA trên.
- Artifact Vue là snapshot code giao diện MSC được lưu trong repo tham chiếu, không phải tài liệu API chính thức có versioned schema.
- Không có raw response live của `IB2600270477` trong repository này để xác minh thêm biến thể contractor code hoặc member list của liên danh.
- Không có call site `/submission` trong snapshot; điều đó chứng minh “không dùng trong snapshot này”, không chứng minh endpoint không bao giờ được dùng ở mọi phiên bản MSC.
- Việc UI dùng `totalGuaranteeValue` làm fallback là bằng chứng hành vi, chưa phải định nghĩa domain chính thức rằng nó luôn cùng semantic với `bidGuarantee`.

## Tài liệu nguồn

- [Artifact Vue chi tiết lựa chọn nhà thầu](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/code_test/template_vue/Thong_tin_lua_chon_nha_thau.vue)
- [`WEB_DAU_THAU` collector server](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js)
- [`WEB_DAU_THAU` opening renderer](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/public/index.html#L1244-L1288)
