# PROMPT CODEX — KHẮC PHỤC LỖI KHÔNG LẤY / KHÔNG MAPPING ĐẦY ĐỦ DỮ LIỆU BIÊN BẢN MỞ THẦU TỪ MUASAMCONG

## 1. Bối cảnh

Repository cần sửa:

- Main app: `https://github.com/newstar94/Bidding`
- Repo tham chiếu logic giao diện Mua sắm công: `https://github.com/newstar94/WEB_DAU_THAU`

Lỗi thực tế đang xảy ra khi nhập biên bản mở thầu từ Mua sắm công, đặc biệt với **gói thầu phân lô**.

Ví dụ gói dùng để kiểm tra regression:

```text
IB2600270477
```

Không được hardcode mã gói này trong logic sản phẩm. Chỉ dùng nó như một case kiểm thử thực tế nếu môi trường cho phép truy cập Mua sắm công.

JSON từ API nội bộ:

```text
opening/prepare
```

đang trả về các dòng nhà thầu + lô có dữ liệu như:

```json
{
  "contractorCode": "vn0314745451",
  "bidPrice": 530000000,
  "bidValidityDays": null,
  "bidGuarantee": null,
  "bidGuaranteeValidityDays": null,
  "lotNo": "PP2600224576"
}
```

Trong khi trên Mua sắm công, các dữ liệu:

- hiệu lực E-HSDT;
- giá trị bảo đảm dự thầu;
- tổng giá trị bảo đảm dự thầu;
- hiệu lực bảo đảm dự thầu;

được lấy ở dữ liệu cấp **nhà thầu**, không phải cấp lô.

---

# 2. Mục tiêu

Hãy nghiên cứu thật kỹ code hiện tại trước khi sửa.

Mục tiêu cuối cùng:

1. BiddingFlow phải lấy **đầy đủ các nguồn dữ liệu opening mà Mua sắm công thực tế sử dụng**.
2. Phải lấy đúng dữ liệu từ endpoint `bid-open`.
3. Phải lấy thêm endpoint `submission` nếu đây là một phần của luồng dữ liệu mà frontend Mua sắm công đang sử dụng.
4. Phải validate response của từng endpoint, không được coi HTTP 200 là đồng nghĩa với dữ liệu hợp lệ.
5. Phải mapping chính xác dữ liệu cấp nhà thầu từ `bid-open` xuống các dòng nhà thầu + lô.
6. Phải giữ đúng nguyên tắc:
   - `bidGuarantee` thuộc về **nhà thầu**;
   - không thuộc về từng lô;
   - với model hiện tại đang flatten thành từng row nhà thầu + lô thì được phép duplicate giá trị cấp nhà thầu xuống từng row tương ứng để tương thích frontend.
7. Không được làm hỏng các luồng:
   - gói không phân lô;
   - 1 giai đoạn 1 túi hồ sơ;
   - 1 giai đoạn 2 túi hồ sơ;
   - technical opening;
   - financial opening;
   - liên danh;
   - các gói đã import trước đây.
8. `opening/prepare` không được báo `partial: false` / complete nếu các nguồn opening bắt buộc bị thiếu hoặc schema không hợp lệ.
9. Bổ sung test regression thực tế và có ý nghĩa.

---

# 3. Những file bắt buộc phải nghiên cứu trước khi sửa

Ít nhất phải đọc kỹ:

```text
backend/integrations/muasamcong_browser/collectors.mjs
backend/integrations/muasamcong_browser/endpoint_catalog.mjs
backend/integrations/muasamcong_browser/api_client.mjs
backend/integrations/muasamcong_browser/canonical.py
backend/integrations/muasamcong_browser/procurement_source.py
backend/procurement_import/routes.py
frontend/procurement/OpeningImportWizard.js
frontend/bid/BidProcessWorkflow.js
tests/test_muasamcong_integration_source.py
tests/test_procurement_import_routes.py
```

Ngoài ra hãy tìm toàn repo các từ khóa:

```text
OPENING_BID
OPENING_SUBMISSION
OPENING_LOT
OPENING_LOT_DETAIL
bidGuarantee
totalGuaranteeValue
bidGuaranteeValidity
bidValidityNum
bidSubmissionDTOList
bidoLotOpenDetailDTOS
lotNoValueDTOList
opening/prepare
getOpeningBundle
normalize_opening_bundle
```

---

# 4. Hiện trạng đã xác định

## 4.1. Endpoint catalog đã khai báo `OPENING_BID`

Hiện tại có:

```javascript
OPENING_BID: {
    path: "/expose/ldtkqmt/bid-notification-p/bid-open",
    protected: true,
}
```

Đây là nguồn chứa dữ liệu cấp nhà thầu.

---

## 4.2. Endpoint catalog cũng đã khai báo `OPENING_SUBMISSION`

Hiện tại có:

```javascript
OPENING_SUBMISSION: {
    path: "/expose/ldtkqmt/bid-notification-p/submission",
    protected: true,
}
```

Nhưng hãy kiểm tra kỹ `getOpeningBundle()`.

Theo code hiện tại, base operations chủ yếu là:

```javascript
[
    "OPENING_NOTIFY",
    "OPENING_ROUND",
    "OPENING_BID"
]
```

Với gói phân lô thì tiếp tục gọi:

```javascript
OPENING_LOT
OPENING_LOT_DETAIL
```

Có dấu hiệu `OPENING_SUBMISSION` đã được khai báo nhưng chưa được gọi trong collector opening.

Hãy xác minh lại trên code mới nhất trước khi sửa.

---

# 5. Bằng chứng từ logic của Mua sắm công

Trong repo:

```text
https://github.com/newstar94/WEB_DAU_THAU
```

hãy nghiên cứu file Vue hiển thị chi tiết kết quả mở thầu.

Frontend Mua sắm công thực tế gọi:

```javascript
axios.post(
    this.urlBidOpenKqmtLdt + "?token=" + token,
    payload
)
```

sau đó lấy:

```javascript
response.data
    ?.bidSubmissionByContractorViewResponse
    ?.bidSubmissionDTOList
```

Đây là dữ liệu cấp **nhà thầu**.

Sau đó Mua sắm công tiếp tục lấy submission theo lô:

```javascript
axios.post(
    this.urlLotOpenSubmissionKqmtLdt + "?token=" + token,
    payload
)
```

và ghép:

```javascript
it.lotNoValueDTOList =
    res.data?.filter(
        lot => lot.contractorCode == it.contractorCode
    )
```

Sau đó dữ liệu cấp nhà thầu được copy xuống từng dòng lô:

```javascript
const bidSub = bidoBidSubmissionsV1
    ?.filter(e => e?.contractorCode === itemLot?.contractorCode)[0];

itemLot.ventureName = bidSub?.ventureName;
itemLot.ventureCode = bidSub?.ventureCode;
itemLot.fileId = bidSub?.fileId;

itemLot.bidValidityNum = bidSub?.bidValidityNum;

itemLot.bidGuarantee = bidSub?.bidGuarantee;
itemLot.totalGuaranteeValue = bidSub?.totalGuaranteeValue;
itemLot.bidGuaranteeValidity = bidSub?.bidGuaranteeValidity;

itemLot.techScore = bidSub?.techScore;
```

Đây là hành vi tham chiếu rất quan trọng.

Không được suy luận rằng:

```text
bidGuarantee thuộc về từng lot
```

Đúng phải là:

```text
bidGuarantee thuộc về bidder
```

---

# 6. Kiến trúc mapping đúng cần đạt

Luồng mong muốn:

```text
Mua sắm công

OPENING_NOTIFY
      |
OPENING_ROUND
      |
OPENING_BID
      |
      +--> bidder-level data
      |       contractorCode
      |       contractorName
      |       ventureCode
      |       ventureName
      |       bidValidityNum
      |       bidGuarantee
      |       totalGuaranteeValue
      |       bidGuaranteeValidity
      |       techScore
      |
OPENING_SUBMISSION
      |
      +--> bidder <-> lot association / lot submission details
      |
OPENING_LOT
      |
OPENING_LOT_DETAIL
      |
      +--> contractorCode + lotNo
              lotFinalPrice
              discount
              execution / delivery info
              ...

              |
              JOIN BY BIDDER IDENTITY
              |
              v

Canonical flat bidder-lot rows

A / Lot 1
    bidGuarantee = guarantee(A)

A / Lot 2
    bidGuarantee = guarantee(A)

A / Lot 3
    bidGuarantee = guarantee(A)

B / Lot 2
    bidGuarantee = guarantee(B)
```

---

# 7. Việc 1 — Audit collector opening

Hãy nghiên cứu:

```text
backend/integrations/muasamcong_browser/collectors.mjs
```

đặc biệt:

```text
getOpeningBundle()
collectPackType()
```

Phải lập bảng endpoint opening hiện tại:

| Operation | Endpoint | Đang gọi? | Bắt buộc? | Dữ liệu chính |
|---|---|---:|---:|---|
| OPENING_NOTIFY | notify | ? | ? | thông tin notify |
| OPENING_ROUND | roundmng | ? | ? | trạng thái / thời điểm |
| OPENING_BID | bid-open | ? | YES với LDT online | bidder-level |
| OPENING_SUBMISSION | submission | ? | cần xác minh và bổ sung | bidder-lot |
| OPENING_LOT | lot-open | ? | multi-lot | lot |
| OPENING_LOT_DETAIL | lotOpenDetail | ? | multi-lot | bidder-lot |
| OPENING_FINANCIAL_AVAILABLE | is-opened | ? | 1_HTHS | trạng thái |
| OPENING_FINANCIAL_DETAIL | get-by-id-v2 | ? | 1_HTHS | tài chính |

Sau khi nghiên cứu, sửa collector sao cho lấy đủ graph dữ liệu cần thiết tương đương luồng Mua sắm công.

---

# 8. Việc 2 — Bổ sung `OPENING_SUBMISSION`

Nếu code mới nhất vẫn chưa gọi `OPENING_SUBMISSION`, hãy thêm.

Với cùng payload:

```javascript
{
    notifyNo,
    notifyId,
    type: "TBMT",
    packType
}
```

hãy gọi:

```text
OPENING_SUBMISSION
```

Không hardcode đường dẫn ở collector nếu đã có endpoint catalog.

Key raw nên theo convention rõ ràng, ví dụ:

```text
opening_submission_0
opening_submission_1
opening_submission_2
```

tùy packType.

Phải đảm bảo operation được persist vào raw snapshot.

---

# 9. Việc 3 — Validate schema `OPENING_BID`

Hiện tại API client có thể chỉ cần:

```text
HTTP 200
+
JSON parse thành công
```

là coi request thành công.

Điều này là chưa đủ.

Mua sắm công có logic kiểm tra:

```javascript
if (typeof response.data == "number") {
    // không coi đây là payload opening hợp lệ
}
```

Do đó cần bổ sung validation semantic.

Đối với `OPENING_BID`, response hợp lệ phải chứa cấu trúc tương ứng:

```text
bidSubmissionByContractorViewResponse
    .bidSubmissionDTOList
```

Không nhất thiết hardcode một schema duy nhất nếu Mua sắm công có variation, nhưng phải có validator đủ chặt để phát hiện:

```json
123
```

```json
{}
```

```json
{
  "bidSubmissionByContractorViewResponse": null
}
```

hoặc response không có danh sách bidder trong trường hợp opening đáng lẽ phải có bidder.

---

# 10. Không đặt validation generic trong `api_client.mjs` nếu không phù hợp

Không nên biến generic HTTP client thành nơi hiểu toàn bộ business schema.

Ưu tiên một trong các cách:

### Phương án A — validator theo operation ở collector

Ví dụ:

```javascript
function validateOpeningBidPayload(data) {
    ...
}
```

sau khi:

```javascript
const response = await this.client.request("OPENING_BID", payload)
```

### Phương án B — registry validator theo operation

Nếu repo đã có architecture tương tự thì dùng architecture hiện tại.

Không thêm abstraction lớn nếu không cần thiết.

---

# 11. Việc 4 — Khi `OPENING_BID` invalid phải đánh dấu failure

Không được có tình trạng:

```text
OPENING_BID response invalid
↓
source.success = true
↓
failures = []
↓
partial = false
```

Nếu upstream trả schema không hợp lệ:

```text
OPENING_BID
```

phải được thể hiện rõ là failure, ví dụ:

```text
PROCUREMENT_SCHEMA_CHANGED
```

và cuối cùng:

```text
partial = true
```

hoặc request opening bị từ chối nếu đó là nguồn bắt buộc.

Hãy tuân thủ pattern lỗi hiện tại của repo.

---

# 12. Việc 5 — Phân biệt endpoint bắt buộc và optional

Không phải mọi endpoint đều bắt buộc cho mọi loại gói.

Hãy xác định theo:

```text
processApply
bidMode
isMultiLot
bidStatus
packType
```

Ví dụ:

### `1_MTHS`

Technical pack type:

```text
0
```

Cần kiểm tra tối thiểu:

```text
OPENING_ROUND
OPENING_BID
```

Nếu multi-lot:

```text
OPENING_SUBMISSION
OPENING_LOT
OPENING_LOT_DETAIL
```

### `1_HTHS`

Technical pack type:

```text
1
```

Financial pack type:

```text
2
```

Phải giữ đúng logic hiện có cho việc chỉ lấy tài chính khi đã mở tài chính.

Không gọi bừa endpoint tài chính trước thời điểm.

---

# 13. Việc 6 — Lưu đầy đủ raw evidence

Hiện tại:

```text
get_opening_bundle()
```

tạo:

```text
rawBundle
```

sau đó `routes.py` có:

```python
captured_bundle = opening.pop("rawBundle", None)
```

và lưu vào raw repository.

Đây là hành vi hợp lý cho production response, nhưng phải đảm bảo raw snapshot thực sự chứa:

```text
opening_bid_*
opening_submission_*
opening_lot_*
opening_lot_detail_*
```

nếu các endpoint tương ứng đã được gọi.

Không cần trả toàn bộ raw payload ra frontend production.

---

# 14. Việc 7 — Bổ sung diagnostic an toàn cho `opening/prepare`

Mục tiêu: khi debug không cần đoán xem endpoint nào đã lấy thành công.

Không trả raw sensitive / raw upstream payload ra frontend.

Nhưng có thể bổ sung metadata an toàn, ví dụ:

```json
{
  "diagnostics": {
    "sources": {
      "OPENING_BID": {
        "success": true,
        "recordCount": 4
      },
      "OPENING_SUBMISSION": {
        "success": true,
        "recordCount": 12
      },
      "OPENING_LOT_DETAIL": {
        "success": true,
        "recordCount": 12
      }
    }
  }
}
```

Chỉ làm nếu phù hợp architecture và security policy.

Nếu không muốn thay đổi public response contract, ít nhất phải có server-side structured logging / diagnostics testable.

Không log:

- token;
- cookie;
- captcha;
- credentials;
- session secret.

---

# 15. Việc 8 — Sửa canonical mapping bidder-level

Nghiên cứu:

```text
backend/integrations/muasamcong_browser/canonical.py
```

đặc biệt:

```python
normalize_opening_bundle()
```

Hiện tại code đã có ý tưởng đúng:

```python
bid_open_security = {}
```

và comment rằng:

```text
bid-open is authoritative
```

Phải giữ nguyên nguyên tắc đó.

---

# 16. Bid security phải index theo bidder identity, không theo lot

Không được dùng:

```text
contractor + lot + phase
```

để đại diện cho ownership của bảo đảm dự thầu.

Đúng hơn là:

```text
contractor + phase
```

hoặc nếu business xác nhận security giống nhau giữa phase và phase không tạo duplicate thì có thể xem xét contractor-only.

Tuy nhiên ưu tiên giữ `phase` để tránh regression với 1_HTHS.

Ví dụ:

```python
key = (
    contractor_identity,
    phase,
)
```

Không đưa:

```text
lotNo
```

vào key của bidder security.

---

# 17. Mapping bidder-level nên mở rộng hơn chỉ `bidGuarantee`

Từ `OPENING_BID`, hãy audit và map các field có ích:

```text
bidValidityNum
bidValidity
bidValidityDays

bidGuarantee
bidGuaranteed
bidGuaranteeValue

totalGuaranteeValue

bidGuaranteeValidity
bidGuaranteeValidityDays

ventureCode
ventureName

techScore
fileId
```

Không phải tất cả field đều cần đưa ra canonical nếu frontend chưa dùng.

Nhưng ít nhất phải hỗ trợ đầy đủ các field đang cần cho biên bản mở thầu:

```text
bidValidityDays
bidGuarantee
bidGuaranteeValidityDays
```

---

# 18. Quy tắc source authority

Nếu cùng một field xuất hiện ở nhiều endpoint:

## `bidGuarantee`

Ưu tiên:

```text
OPENING_BID
```

vì đây là bidder-level authoritative source.

Nếu:

```text
lotOpenDetail.bidGuarantee = null
```

nhưng:

```text
bid-open.bidGuarantee = 100000000
```

thì canonical phải là:

```text
100000000
```

Nếu hai endpoint khác nhau:

```text
bid-open = 100000000
lotOpenDetail = 90000000
```

ưu tiên `bid-open`.

Có thể ghi diagnostic conflict nếu repo có pattern hỗ trợ.

---

# 19. Việc 9 — Join bidder với bidder-lot row

Sau khi có:

```text
bid_open_by_contractor
```

hãy propagate xuống bidder-lot rows.

Ví dụ input:

```json
{
  "bid-open": [
    {
      "contractorCode": "vn0100000001",
      "bidGuarantee": 12000000,
      "bidValidityNum": 90,
      "bidGuaranteeValidity": 120
    }
  ],
  "lotOpenDetail": [
    {
      "contractorCode": "vn0100000001",
      "lotNo": "L01",
      "lotFinalPrice": 500000000
    },
    {
      "contractorCode": "vn0100000001",
      "lotNo": "L02",
      "lotFinalPrice": 600000000
    }
  ]
}
```

Expected canonical:

```json
[
  {
    "contractorCode": "vn0100000001",
    "lotNo": "L01",
    "bidPrice": 500000000,
    "bidGuarantee": 12000000,
    "bidValidityDays": 90,
    "bidGuaranteeValidityDays": 120
  },
  {
    "contractorCode": "vn0100000001",
    "lotNo": "L02",
    "bidPrice": 600000000,
    "bidGuarantee": 12000000,
    "bidValidityDays": 90,
    "bidGuaranteeValidityDays": 120
  }
]
```

---

# 20. Không duplicate bidder summary thành một dòng mở thầu riêng

Nếu phase đã có bidder-lot rows:

```text
A / L01
A / L02
```

thì package-level bidder:

```text
A / no lot
```

chỉ là summary.

Không được biến thành dòng thứ ba trong biên bản.

Hãy giữ behavior hiện tại loại summary unscoped nếu đã có lot-scoped rows.

Nhưng phải propagate bidder-level fields xuống các row lot **trước hoặc độc lập với việc loại summary**.

---

# 21. Việc 10 — Chuẩn hóa bidder identity để join an toàn

Hiện tại có khả năng endpoint trả code khác format:

```text
vn0314745451
VN0314745451
0314745451
```

Hãy audit dữ liệu thực tế trước.

Không được sửa giá trị persisted/display code chỉ để join.

Hãy tạo comparison key riêng, ví dụ:

```python
def opening_bidder_match_key(...):
    ...
```

Yêu cầu:

1. trim whitespace;
2. case-insensitive;
3. không mutate original contractor code;
4. không strip prefix `vn` một cách mù quáng nếu có nguy cơ collision;
5. nếu muốn normalize `vn` prefix phải có rule rõ ràng + test;
6. ưu tiên stable contractor ID/code hơn name;
7. chỉ fallback name khi không có code.

---

# 22. Liên danh

Phải audit riêng case liên danh.

Các field có thể có:

```text
ventureCode
ventureName
jointVentureCode
jointVentureName
memberList
ventureMembers
jointVentureMembers
```

Không được join security vào sai thành viên liên danh.

Nếu upstream bidder row có một code đại diện cho liên danh, hãy sử dụng identity đó.

Nếu chỉ có member codes, nghiên cứu chính xác cấu trúc upstream và bổ sung test.

Không được suy đoán bằng tên nếu đã có stable identifier.

---

# 23. Việc 11 — `OPENING_SUBMISSION` phải tham gia canonical khi cần

Nếu `submission` cung cấp:

```text
contractorCode
lotNo
lotNoValueDTOList
bidOpenView
```

hãy dùng nó để:

- xác định quan hệ contractor ↔ lot;
- bổ sung lot metadata bị thiếu;
- bổ sung execution period / delivery-related fields nếu đúng source;
- hỗ trợ join giữa bidder summary và lot rows.

Không dùng `submission` để override bidder-level `bidGuarantee` nếu `bid-open` đã có giá trị authoritative.

---

# 24. Việc 12 — Kiểm tra `opening/prepare` dùng raw snapshot cache

Hiện tại route có thể:

1. reuse raw snapshot đã lưu;
2. hoặc gọi mới `source.get_opening_bundle()`.

Phải test cả hai đường.

Không được xảy ra tình trạng:

```text
fresh upstream path = đúng
cached raw snapshot path = mất OPENING_BID
```

hoặc ngược lại.

---

# 25. Kiểm tra helper `_raw_snapshot_has_complete_opening_sources`

Hiện helper có thể chỉ kiểm tra:

```text
có ít nhất một operation OPENING*
và không có failure OPENING*
```

Đây có thể chưa đủ.

Ví dụ snapshot chỉ có:

```text
OPENING_LOT_DETAIL
```

nhưng thiếu:

```text
OPENING_BID
```

thì không nên coi là complete đối với loại gói yêu cầu bidder-level data.

Hãy sửa logic theo required opening source set.

Ví dụ conceptual:

```python
required = required_opening_operations(
    process_apply=...,
    bid_mode=...,
    is_multi_lot=...,
    bid_status=...,
)
```

Sau đó chỉ reuse snapshot khi mọi required source:

```text
success == true
```

và schema hợp lệ.

Nếu thiếu thông tin để xác định required set trong raw snapshot, hãy thiết kế metadata cần thiết thay vì dùng heuristic yếu.

---

# 26. Không được coi `OPENING_SUBMISSION` là mandatory cho mọi case nếu upstream không cần

Hãy đối chiếu code Mua sắm công.

Chỉ bắt buộc khi logic upstream tương ứng thực sự cần.

Ví dụ multi-lot có khả năng cần.

Gói không phân lô có thể không cần.

Tránh làm regression do bắt buộc endpoint không tồn tại ở một số loại gói.

---

# 27. Test bắt buộc — một bidder nhiều lô

Fixture:

```text
bid-open:
A → guarantee 100m
A → validity 90
A → guaranteeValidity 120

lotOpenDetail:
A → Lot 1
A → Lot 2
A → Lot 3
```

Expected:

```text
A/Lot1 → guarantee 100m
A/Lot2 → guarantee 100m
A/Lot3 → guarantee 100m
```

và:

```text
bidValidityDays = 90
bidGuaranteeValidityDays = 120
```

cho cả ba dòng.

---

# 28. Test bắt buộc — nhiều bidder nhiều lô

Input:

```text
A guarantee = 100m
B guarantee = 250m

A → Lot 1
A → Lot 3

B → Lot 2
B → Lot 3
```

Expected:

```text
A/Lot1 = 100m
A/Lot3 = 100m

B/Lot2 = 250m
B/Lot3 = 250m
```

Không cross-map.

---

# 29. Test bắt buộc — source authority

Input:

```text
OPENING_BID:
bidGuarantee = 100m

OPENING_LOT_DETAIL:
bidGuarantee = null
```

Expected:

```text
100m
```

Input:

```text
OPENING_BID:
100m

OPENING_LOT_DETAIL:
90m
```

Expected:

```text
100m
```

---

# 30. Test bắt buộc — bid validity

Input:

```text
OPENING_BID:
bidValidityNum = 90
```

Expected:

```text
bidValidityDays = 90
```

Đây là regression quan trọng vì JSON thực tế hiện đang trả:

```text
bidValidityDays = null
```

---

# 31. Test bắt buộc — guarantee aliases

Test tối thiểu:

```text
bidGuarantee
bidGuaranteed
bidGuaranteeValue
totalGuaranteeValue
bidSecurity
bidSecurityValue
guaranteeValue
```

Không nhất thiết mọi alias đều là cùng semantic nếu nghiên cứu upstream cho thấy khác nhau.

Nếu `totalGuaranteeValue` khác semantic với `bidGuarantee`, hãy giữ đúng nghiệp vụ upstream và ghi rõ trong report.

---

# 32. Test bắt buộc — invalid `OPENING_BID`

Case:

```json
123
```

Expected:

```text
không được coi OPENING_BID success
```

Case:

```json
{}
```

Expected tương tự nếu opening đáng lẽ phải có bidder list.

Case:

```json
{
  "bidSubmissionByContractorViewResponse": null
}
```

Expected failure / partial phù hợp.

---

# 33. Test bắt buộc — valid empty opening

Nếu upstream có trường hợp hợp lệ thực sự không có bidder:

```text
bidSubmissionDTOList = []
```

hãy xác định business rule.

Không được tự động coi mọi empty list là schema failure nếu đây có thể là trạng thái hợp lệ.

Phải phân biệt:

```text
field missing
```

với:

```text
field exists and empty
```

và:

```text
payload invalid
```

---

# 34. Test bắt buộc — source arrival order

Collector có thể fetch concurrent.

Test cả:

```text
bid-open trước lotOpenDetail
```

và:

```text
lotOpenDetail trước bid-open
```

Canonical output phải giống nhau.

---

# 35. Test bắt buộc — contractor code variants

Ví dụ:

```text
bid-open:
vn0314745451

lotOpenDetail:
VN0314745451
```

Expected join thành công.

Nếu thực tế upstream có:

```text
0314745451
```

ở một endpoint và:

```text
vn0314745451
```

ở endpoint khác, bổ sung test theo normalization rule đã nghiên cứu.

Không mutate code hiển thị.

---

# 36. Test bắt buộc — joint venture

Tạo fixture có:

```text
ventureCode
ventureName
memberList
```

Đảm bảo:

- security thuộc đúng bidder/joint venture;
- không duplicate sai;
- không join sang bidder khác.

---

# 37. Test bắt buộc — non-lot regression

Input gói không phân lô.

Expected:

- vẫn có bidder;
- bidGuarantee mapping đúng;
- không cần tạo lot giả;
- không có duplicate rows.

---

# 38. Test bắt buộc — 1_HTHS

Test technical phase:

```text
packType = 1
```

Test financial phase khi đủ điều kiện:

```text
packType = 2
```

Không map bidder security của phase sai sang phase khác nếu upstream có khác biệt.

---

# 39. Test bắt buộc — cache/raw snapshot

Test:

```text
opening/prepare
→ upstream fetch
→ raw snapshot saved
```

Sau đó gọi lại:

```text
opening/prepare
→ raw snapshot reuse
```

Expected canonical output phải giống nhau, bao gồm:

```text
bidGuarantee
bidValidityDays
bidGuaranteeValidityDays
```

---

# 40. Test bắt buộc — missing required opening source

Snapshot có:

```text
OPENING_LOT_DETAIL = success
```

nhưng không có:

```text
OPENING_BID
```

với gói LDT online có bidder-level data cần thiết.

Expected:

```text
không reuse snapshot như một opening complete
```

Phải fallback fetch upstream hoặc trả partial/error theo architecture.

---

# 41. Test bắt buộc — `OPENING_SUBMISSION`

Nếu multi-lot:

- collector phải gọi đúng operation;
- đúng payload;
- raw bundle phải chứa response;
- canonical có thể sử dụng để xác định contractor-lot relation.

Mock phải assert operation đã được gọi.

---

# 42. Không chỉ test synthetic quá đơn giản

Test cũ dạng:

```text
1 bidder
1 lot
contractorCode giống tuyệt đối
```

không đủ.

Phải có fixture realistic:

```text
2–4 bidders
3+ lots
bidder tham gia nhiều lot
bidder không tham gia tất cả lot
```

Ví dụ:

```text
A → L1, L3
B → L2, L3
C → L1
```

---

# 43. Case thực tế `IB2600270477`

Nếu môi trường có thể kết nối Mua sắm công, hãy dùng:

```text
IB2600270477
```

để kiểm tra.

Không hardcode expected contractor code hay giá trị nếu dữ liệu live có thể thay đổi.

Điều cần kiểm tra:

1. raw opening bundle có key:

```text
opening_bid_0
```

2. nếu multi-lot, có:

```text
opening_submission_0
opening_lot_0
opening_lot_detail_0
```

3. `opening_bid_0` thực sự chứa:

```text
bidSubmissionByContractorViewResponse
bidSubmissionDTOList
```

4. bidder có:

```text
bidGuarantee
hoặc totalGuaranteeValue
bidValidityNum
bidGuaranteeValidity
```

nếu upstream trả.

5. canonical `opening.bidders` không còn null nếu upstream có dữ liệu.

---

# 44. Không hardcode giá trị thật của case live

Không viết kiểu:

```python
if notice_no == "IB2600270477":
    ...
```

Không viết:

```python
if contractor_code == "vn0314745451":
    ...
```

Case này chỉ để regression/debug.

---

# 45. Frontend mapping

Nghiên cứu:

```text
frontend/procurement/OpeningImportWizard.js
```

Hiện mapping có dạng:

```javascript
giaTriDamBao: bidder?.bidGuarantee ?? null,
hieuLucHsdt: bidder?.bidValidityDays ?? null,
hieuLucBaoDamNgay:
    bidder?.bidGuaranteeValidityDays ?? null,
```

Nếu đúng như trên thì frontend không phải root cause.

Không sửa frontend nếu backend canonical đã đủ field.

Chỉ sửa frontend khi audit chứng minh frontend drop field.

---

# 46. UI biên bản mở thầu

Nghiên cứu:

```text
frontend/bid/BidProcessWorkflow.js
```

Đảm bảo multi-lot row hiển thị:

```text
giaTriDamBao
```

được lấy từ imported bidder row.

Không đổi business UI ngoài phạm vi bug này.

---

# 47. Yêu cầu về backward compatibility

Không thay đổi tùy tiện canonical response contract:

```text
opening.bidders[]
```

Frontend hiện đang dùng flat rows.

Nếu muốn thiết kế model mới dạng:

```text
bidders[]
lots[]
bidderLotRows[]
```

thì không làm trong patch này trừ khi tuyệt đối cần thiết.

Patch ưu tiên:

```text
giữ flat rows
+
propagate bidder-level fields
```

để giảm regression.

---

# 48. Không redesign quá mức

Không:

- rewrite toàn integration layer;
- thêm dependency lớn;
- đổi toàn schema database;
- đổi public API không cần thiết;
- refactor hàng loạt code ngoài bug.

Ưu tiên patch nhỏ, rõ, test được.

---

# 49. Security

Không được:

- expose captcha token;
- expose session token;
- expose cookie MSC;
- log Authorization/session secrets;
- trả raw upstream payload ra browser chỉ để debug.

Nếu thêm diagnostics phải sanitize.

---

# 50. Performance

Opening endpoints hiện có thể gọi concurrent.

Khi thêm `OPENING_SUBMISSION`:

- không serialize mọi call nếu không cần;
- giữ concurrency hợp lý;
- không duplicate cùng operation + payload;
- tận dụng `inFlight` de-duplication hiện có của API client nếu phù hợp.

Không làm tăng request nhiều lần không cần thiết.

---

# 51. Error handling

Phân biệt:

```text
HTTP failure
schema invalid
endpoint absent hợp lệ
empty data hợp lệ
partial data
```

Không gom tất cả thành:

```text
PROCUREMENT_UPSTREAM_UNAVAILABLE
```

Nếu schema đổi:

```text
PROCUREMENT_SCHEMA_CHANGED
```

Nếu endpoint optional không tồn tại:

hãy theo pattern optional hiện có.

---

# 52. Yêu cầu test suite

Sau khi sửa, chạy ít nhất:

```bash
pytest tests/test_muasamcong_integration_source.py -q
pytest tests/test_procurement_import_routes.py -q
```

Tìm thêm các test liên quan:

```bash
pytest -q -k "opening or muasamcong or procurement_import"
```

Nếu thời gian cho phép và project test không quá nặng:

```bash
pytest -q
```

Ngoài ra chạy test JS/Node tương ứng nếu collector có test Node riêng.

---

# 53. Nếu repo có lint / formatter

Chạy các command hiện có trong repository.

Không tự đưa formatter mới vào project.

---

# 54. Kết quả Codex phải báo cáo

Sau khi hoàn thành, hãy trả report gồm:

## A. Root cause

Nêu chính xác:

```text
vì sao opening/prepare hiện có:
bidGuarantee = null
bidValidityDays = null
```

Phân biệt:

```text
fetch problem
schema validation problem
canonical join problem
cache reuse problem
```

---

## B. Endpoint graph trước và sau

Ví dụ:

```text
BEFORE
OPENING_NOTIFY
OPENING_ROUND
OPENING_BID
OPENING_LOT
OPENING_LOT_DETAIL

AFTER
OPENING_NOTIFY
OPENING_ROUND
OPENING_BID
OPENING_SUBMISSION
OPENING_LOT
OPENING_LOT_DETAIL
```

Nhưng chỉ báo cáo đúng những gì thực tế đã sửa.

---

## C. Files changed

Liệt kê từng file và mục đích.

Ví dụ:

```text
collectors.mjs
- fetch OPENING_SUBMISSION
- validate OPENING_BID

canonical.py
- bidder-level mapping
- propagate to lot rows

routes.py
- validate raw snapshot completeness

tests/...
- multi-lot regression
```

---

## D. Mapping path

Mô tả đầy đủ:

```text
/bid-open
→ bidSubmissionDTOList
→ contractor identity
→ bidder-level security index
→ contractor + lot rows
→ opening.bidders[]
→ OpeningImportWizard
→ giaTriDamBao
→ BidProcessWorkflow
```

---

## E. Tests run

Liệt kê command + kết quả.

Không nói "tests passed" nếu chưa chạy.

---

## F. Remaining risks

Nêu rõ nếu còn:

- joint venture chưa có fixture live;
- upstream MSC có schema variant;
- contractor code normalization chưa chắc chắn;
- financial phase cần thêm live verification.

---

# 55. Acceptance criteria bắt buộc

Patch chỉ được coi là hoàn thành khi đáp ứng tất cả:

- [ ] `OPENING_BID` thực sự được fetch và raw response được persist.
- [ ] Multi-lot lấy đủ source cần thiết.
- [ ] Nếu `OPENING_SUBMISSION` là một phần của luồng MSC, collector đã gọi nó.
- [ ] Invalid `OPENING_BID` không còn bị coi là success.
- [ ] `partial:false` không còn xuất hiện khi required opening source bị thiếu/invalid.
- [ ] `bidGuarantee` được lấy từ bidder-level `bid-open`.
- [ ] Một bidder tham gia nhiều lot có cùng bidder-level guarantee trên từng flat row.
- [ ] `bidValidityNum` được mapping về `bidValidityDays`.
- [ ] `bidGuaranteeValidity` được mapping về `bidGuaranteeValidityDays`.
- [ ] Không cross-map giữa hai bidder.
- [ ] Không tạo duplicate package-summary row khi đã có lot rows.
- [ ] Non-lot không regression.
- [ ] 1_HTHS không regression.
- [ ] Raw snapshot reuse cho kết quả giống fresh upstream fetch.
- [ ] Có test cho missing `OPENING_BID`.
- [ ] Có test cho invalid schema.
- [ ] Có test multi-bidder / multi-lot.
- [ ] Không hardcode `IB2600270477`.
- [ ] Không expose secrets.
- [ ] Các test liên quan pass.

---

# 56. Nguyên tắc quan trọng nhất

Không được chỉ sửa symptom:

```text
bidGuarantee == null
```

bằng fallback từ giá trị khác không rõ nguồn.

Phải sửa đúng pipeline:

```text
COLLECT
    ↓
VALIDATE
    ↓
PERSIST RAW EVIDENCE
    ↓
NORMALIZE
    ↓
JOIN BIDDER ↔ LOT
    ↓
OPENING PREVIEW
    ↓
IMPORT
    ↓
UI
```

Nếu upstream `bid-open` không trả dữ liệu, hệ thống phải phản ánh đúng là thiếu/partial/schema changed thay vì âm thầm trả:

```text
bidGuarantee = null
partial = false
```

---

# 57. Không giả định nhận định ban đầu luôn đúng

Trước khi code:

1. đọc code mới nhất;
2. xác minh `OPENING_SUBMISSION` hiện có được gọi hay chưa;
3. xác minh schema thực tế của `bid-open`;
4. xác minh raw snapshot hiện tại lưu những source nào;
5. xác minh route cache reuse;
6. xác minh mapper frontend.

Nếu code đã thay đổi so với mô tả trên, hãy thích ứng với code mới nhất nhưng vẫn phải đạt acceptance criteria.

---

# 58. Deliverable cuối cùng

Thực hiện code fix trực tiếp trong repository.

Không chỉ phân tích.

Không chỉ viết đề xuất.

Sau khi sửa:

1. show diff;
2. chạy tests;
3. báo root cause;
4. báo files changed;
5. báo endpoint graph;
6. báo test evidence;
7. báo remaining risks.

Nếu có thể truy cập live Mua sắm công, kiểm tra thêm `IB2600270477`.

Nếu không thể truy cập live upstream, phải nói rõ và dùng fixture/mock realistic để chứng minh fix.
