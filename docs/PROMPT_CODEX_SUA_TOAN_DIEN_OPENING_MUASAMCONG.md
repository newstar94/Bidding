# PROMPT CODEX — RÀ SOÁT VÀ SỬA TOÀN DIỆN LUỒNG IMPORT BIÊN BẢN MỞ THẦU TỪ MUA SẮM CÔNG

## 0. Vai trò và mục tiêu

Bạn đang làm việc trên repository:

```text
https://github.com/newstar94/Bidding
```

Ngoài ra có repository tham chiếu để đối chiếu hành vi giao diện/collector Mua sắm công:

```text
https://github.com/newstar94/WEB_DAU_THAU
```

Nhiệm vụ của bạn là **nghiên cứu lại code mới nhất trên branch hiện tại trước khi sửa**, sau đó sửa toàn diện các vấn đề còn tồn tại trong pipeline import **biên bản mở thầu / opening data từ Mua sắm công (MSC)**.

Không được chỉ sửa cho qua test hiện có. Hãy coi đây là một bugfix production cho dữ liệu đấu thầu thực tế, yêu cầu:

- đúng nghiệp vụ;
- đúng ownership của từng field;
- không trộn dữ liệu giữa nhà thầu / lô / phase;
- không tự suy đoán dữ liệu khi upstream thiếu;
- không làm mất dữ liệu người dùng;
- không phá các luồng hiện có;
- có regression test đủ mạnh;
- có diagnostics đủ để debug production;
- vẫn tương thích với current frontend/domain model.

---

# 1. Bối cảnh nghiệp vụ bắt buộc phải hiểu đúng

## 1.1. Hai loại “bảo đảm dự thầu” khác nhau

Trong hệ thống hiện có hai khái niệm tuyệt đối không được trộn:

### A. Bảo đảm dự thầu yêu cầu trong E-HSMT / TBMT

Đây là mức bảo đảm do bên mời thầu yêu cầu.

Có thể xuất hiện ở:

```text
notice
E-HSMT form
BD_DATA_TABLE
lotDTOList
detailLotList
```

Ví dụ canonical/domain:

```text
bidGuaranteeVnd
lot.bidGuarantee
giaTriDamBaoDuThau
```

Đây là dữ liệu **mức yêu cầu của gói/lô**.

### B. Bảo đảm dự thầu thực tế của nhà thầu trong biên bản mở thầu

Đây là thông tin nhà thầu thực tế nộp khi dự thầu.

Nguồn authority đã được xác minh là:

```text
OPENING_BID
→ bidSubmissionByContractorViewResponse
→ bidSubmissionDTOList[]
```

Các field bidder-level quan trọng:

```text
contractorCode
contractorName
ventureCode
ventureName
bidValidityNum
bidGuarantee
totalGuaranteeValue
bidGuaranteeValidity
```

Đây là dữ liệu **thuộc nhà thầu trong một opening phase**, không thuộc từng lô.

Khi một nhà thầu tham gia nhiều lô:

```text
Nhà thầu A → L01
Nhà thầu A → L02
Nhà thầu A → L03
```

thì bidder-level security/validity phải được propagate xuống từng flat bidder-lot row:

```text
A/L01
A/L02
A/L03
```

nhưng ownership gốc vẫn là bidder-level.

### Cấm tuyệt đối

Không được lấy:

```text
notice.lot.bidGuarantee
```

hoặc:

```text
E-HSMT guaranteedAmount
```

để điền vào:

```text
opening bidder.bidGuarantee
```

chỉ vì opening source thiếu giá trị.

Nếu upstream opening không có dữ liệu, phải để null/partial/warning theo rule phù hợp, không được “lấp chỗ trống” bằng dữ liệu E-HSMT có semantic khác.

---

# 2. Kết luận nghiên cứu về endpoint graph của MSC

Repository tham chiếu `WEB_DAU_THAU` đã được nghiên cứu.

Đối với LDT online, opening flow đã xác minh sử dụng:

```text
OPENING_NOTIFY
OPENING_ROUND
OPENING_BID
OPENING_LOT
OPENING_LOT_DETAIL
```

Tương ứng về vai trò:

```text
notify
  → metadata của thông báo

roundmng
  → metadata/trạng thái/thời gian vòng mở thầu

bid-open
  → bidder summary / bidder-level data

lot-open
  → quan hệ bidder ↔ lot

lotOpenDetail
  → các dòng chi tiết mở thầu theo lô
```

## 2.1. Không được bắt buộc OPENING_SUBMISSION

Endpoint `/submission` có thể tồn tại trong catalog/artifact, nhưng repository tham chiếu không chứng minh nó tham gia opening flow đang chạy.

Do đó:

```text
OPENING_SUBMISSION
```

**KHÔNG được thêm vào requiredOpeningSources chỉ dựa trên tên endpoint.**

Nếu sau này có live trace chứng minh một version MSC khác sử dụng `/submission`, có thể thu thập optional theo schema đã xác minh, nhưng không được coi là mandatory trong patch này.

---

# 3. Trạng thái code hiện tại

Trước khi sửa, hãy đọc lại code mới nhất và xác nhận các điểm dưới đây còn đúng hay đã thay đổi.

Các file trọng tâm dự kiến gồm:

```text
backend/integrations/muasamcong_browser/canonical.py
backend/integrations/muasamcong_browser/collectors.mjs
backend/integrations/muasamcong_browser/operations.json
backend/integrations/muasamcong_browser/procurement_source.py

backend/procurement_import/routes.py
backend/procurement_import/raw_snapshot.py
backend/procurement_import/service.py

frontend/procurement/OpeningImportWizard.js
frontend/bid/BidProcessWorkflow.js

tests/test_muasamcong_integration_source.py
tests/test_procurement_import_routes.py
tests/test_muasamcong_browser_lookup.py
tests/js/...
```

Có thể file/function đã đổi tên. Không được sửa mù theo line number cũ. Phải locate theo semantic/function.

Code hiện tại đã có một số fix đúng và **phải giữ lại**:

1. Bidder-level security không còn key theo lot.
2. Security đang được join theo bidder identity + opening phase.
3. Một bidder nhiều lô được propagate cùng bidder-level fields.
4. Có test chống cross-map giữa nhiều bidder.
5. Có tách TECHNICAL / FINANCIAL cho 1G2T.
6. `OPENING_BID` đã có schema validation cơ bản.
7. Raw snapshot completeness đã yêu cầu `OPENING_BID`.
8. Cache 1G2T đã reject trường hợp thiếu financial bid-open.
9. `bidValidityNum`, guarantee validity và venture metadata đã được propagate xuống flat lot rows.
10. `requiredOpeningSources` đã được lưu.

Không được undo các phần đúng này.

---

# 4. Mục tiêu sửa lần này

Hãy sửa các vấn đề sau theo đúng thứ tự ưu tiên:

```text
P0-1  Sửa semantic alias của bidder-level bid guarantee
P0-2  Thêm cross-source consistency validation
P0-3  Validate semantic shape của các nguồn opening quan trọng
P0-4  Sửa thời gian mở tài chính 1G2T trên frontend
P1-1  Cải thiện bidder identity matching an toàn
P1-2  Cải thiện request provenance trong raw snapshot
P1-3  Thêm safe diagnostics / observability
P1-4  Thu hẹp source authority, không mapping bằng alias tùy tiện
P2    Cleanup / test / docs / no-regression
```

---

# 5. P0-1 — Sửa semantic của `bidGuaranteed`

## 5.1. Vấn đề

Code hiện tại có khả năng đang coi nhiều field sau là alias của bidder-level guarantee:

```text
bidGuarantee
bidGuaranteed
bidGuaranteeValue
totalGuaranteeValue
bidSecurity
bidSecurityValue
guaranteeValue
```

Điều này quá rộng.

Theo behavior đã xác minh trong giao diện MSC:

```text
bidGuarantee
```

là bidder-level guarantee chính.

```text
totalGuaranteeValue
```

được UI dùng như fallback khi `bidGuarantee` không có.

Nhưng:

```text
bidGuaranteed
```

được nhìn thấy ở nested `bidOpenView` / lot detail context và **không có bằng chứng đáng tin cậy rằng nó luôn cùng semantic với bidder-level `bidGuarantee`**.

Nếu canonical recurse sâu toàn object và lấy `bidGuaranteed` như alias bidder-level thì có nguy cơ:

```text
nested lot field
→ bị hiểu sai thành bidder-level security
→ propagate sai xuống tất cả lô của bidder
```

## 5.2. Yêu cầu sửa

Trong logic xây bidder-level security index từ `OPENING_BID`:

### Source priority mặc định phải là

```text
1. bidGuarantee
2. totalGuaranteeValue
```

Nếu project đã có raw evidence chắc chắn cho một alias khác thì phải:

- ghi rõ bằng test;
- ghi rõ source shape;
- chỉ cho alias đó ở đúng context;
- không sử dụng generic deep `pick()` trên mọi nested object một cách mù quáng.

### Không được dùng `bidGuaranteed` như alias bidder-level mặc định

Tách nó khỏi bidder-level guarantee resolution.

Nếu `bidGuaranteed` cần giữ lại cho lot/detail domain trong tương lai thì:

- normalize vào field khác;
- hoặc giữ nguyên ở raw;
- không được đẩy vào `opening.bidders[].bidGuarantee` trừ khi có rule contextual đã được chứng minh.

## 5.3. Nên refactor

Tạo helper rõ semantic, ví dụ:

```python
def opening_bidder_guarantee(item):
    primary = _money(item.get("bidGuarantee"))
    if primary is not None:
        return primary

    fallback = _money(item.get("totalGuaranteeValue"))
    if fallback is not None:
        return fallback

    return None
```

Tên helper có thể khác.

Điểm quan trọng:

- đọc đúng object bidder summary;
- không deep walk tùy tiện để nhặt một field trùng tên ở child object;
- priority rõ ràng;
- preserve zero;
- null không overwrite value hợp lệ.

## 5.4. Test bắt buộc

Thêm ít nhất:

### Test A

```text
bidGuarantee = 100_000_000
totalGuaranteeValue = 120_000_000
```

Expected:

```text
bidGuarantee canonical = 100_000_000
```

### Test B

```text
bidGuarantee = null
totalGuaranteeValue = 120_000_000
```

Expected:

```text
bidGuarantee canonical = 120_000_000
```

### Test C

Bidder summary không có guarantee nhưng nested lot/detail có:

```text
bidGuaranteed = 20_000_000
```

Expected:

```text
opening bidder.bidGuarantee is None
```

Không được lấy 20 triệu làm bidder-level.

### Test D

Bidder summary:

```text
bidGuarantee = 100_000_000
```

nested lot:

```text
bidGuaranteed = 20_000_000
```

Expected:

```text
mọi flat lot row của bidder vẫn có bidGuarantee = 100_000_000
```

---

# 6. P0-2 — Thêm cross-source consistency validation

## 6.1. Vấn đề

Schema hợp lệ không đồng nghĩa dữ liệu opening đầy đủ.

Ví dụ:

```json
OPENING_BID:
{
  "bidSubmissionByContractorViewResponse": {
    "bidSubmissionDTOList": []
  }
}
```

vẫn structurally hợp lệ.

Trong khi:

```text
OPENING_LOT_DETAIL
```

có:

```text
A/L01
A/L02
B/L01
```

Nếu hệ thống chỉ nhìn:

```text
operation success == true
```

thì có thể trả:

```text
partial = false
failedOperations = []
```

nhưng bidder-level fields của A/B đều null.

Đây là failure mode nguy hiểm vì UI hiển thị dữ liệu thiếu nhưng pipeline lại tuyên bố complete.

## 6.2. Yêu cầu thiết kế validator

Sau khi collector có đủ opening sources của một phase, cần kiểm tra **tính nhất quán giữa các nguồn**.

Tạo logic kiểu:

```text
OPENING_BID bidder identities
vs
OPENING_LOT bidder identities
vs
OPENING_LOT_DETAIL bidder identities
```

### Với package multi-lot

Nếu `OPENING_LOT_DETAIL` chứa contractor identity nhưng `OPENING_BID` không có identity tương ứng:

Không được âm thầm coi opening complete.

Có thể chọn một trong hai policy sau, ưu tiên fail-safe:

#### Policy đề nghị

Mark:

```text
partial = true
```

và thêm diagnostic/warning:

```text
PROCUREMENT_OPENING_BIDDER_SUMMARY_MISSING
```

hoặc một error code tương đương có naming thống nhất với project.

Nếu missing bidder summary làm mất các field nghiệp vụ bắt buộc cho import, có thể fail prepare bằng typed error.

Hãy xem behavior hiện tại của import route để chọn policy ít phá UX nhất, nhưng tuyệt đối không được trả complete giả.

### Trường hợp empty thực sự

Nếu:

```text
bid-open bidders = []
lot-open = []
lotOpenDetail = []
```

thì có thể xem là empty opening hợp lệ tùy trạng thái, không được tự động coi là schema error.

### Trường hợp source chưa phát sinh vì lifecycle

Không được coi thiếu financial rows là lỗi nếu package chưa tới phase tài chính.

Rule phải dựa trên:

```text
bidMode
bidStatus
requiredOpeningSources
packType
```

## 6.3. Matching phải theo stable identity

Không join theo contractor name nếu có contractorCode.

Ưu tiên:

```text
contractorCode
```

Tên chỉ được dùng fallback khi thật sự không có code và phải cực kỳ thận trọng.

### Không cross-map

Nếu:

```text
A participates L01, L03
B participates L02, L03
```

không được để security của A sang B.

## 6.4. Test bắt buộc

### Test A — bid-open empty, lot detail có bidder

Expected:

```text
không được complete silently
```

### Test B — bid-open có A, lot detail có A

Expected:

```text
complete
A lots enriched
```

### Test C — bid-open có A, lot detail có A + B

Expected:

```text
B bị phát hiện missing bidder summary
không cross-map A → B
partial/warning/error theo policy
```

### Test D — bid-open có A/B, lot detail nhiều lô overlap

Expected:

```text
A chỉ nhận A
B chỉ nhận B
```

### Test E — sources đến khác thứ tự

Build raw_bundle với thứ tự dictionary khác nhau.

Expected canonical giống nhau.

---

# 7. P0-3 — Validate semantic shape của opening sources

## 7.1. OPENING_BID

Giữ schema validation hiện có nhưng rà lại để:

- không reject zero;
- không reject empty list hợp lệ;
- reject `{}` nếu path bắt buộc không tồn tại;
- reject wrong type;
- classify thành `PROCUREMENT_SCHEMA_CHANGED` hoặc code hiện tại phù hợp.

## 7.2. OPENING_LOT

Nếu package multi-lot và source này required:

Validator phải kiểm tra response thuộc một trong các shape đã được raw fixture/live evidence hỗ trợ.

Ví dụ expected có thể là:

```text
array
```

hoặc object chứa:

```text
lotNoValueDTOList
```

Không giả định một shape duy nhất nếu fixture hiện có chứng minh nhiều variant.

Mục tiêu là:

```text
HTTP 200 + {}
```

không tự động được xem như dữ liệu multi-lot đầy đủ nếu không có semantic content cần thiết.

## 7.3. OPENING_LOT_DETAIL

Tương tự.

Nếu required cho multi-lot:

- response phải parse được thành collection row;
- row meaningful phải có ít nhất lot identity và bidder identity theo schema hỗ trợ;
- wrong root type phải reject;
- empty list chỉ hợp lệ nếu các nguồn khác cũng nhất quán với opening empty.

## 7.4. OPENING_ROUND

Validator tối thiểu:

- root/object shape;
- không cần bắt mọi optional field;
- nhưng không được coi hoàn toàn random JSON là round data.

## 7.5. Không overfit

Không được hard-code đúng một gói thầu.

Không validate bằng:

```text
field X bắt buộc vì fixture A có X
```

nếu MSC có nhiều variant.

Validator nên xác nhận **structural contract tối thiểu**, không bắt các optional field nghiệp vụ.

## 7.6. Required vs optional

Dùng `requiredOpeningSources` làm nguồn sự thật.

Không reject source optional chỉ vì không có.

Không thêm `OPENING_SUBMISSION` mandatory.

## 7.7. Test

Thêm matrix:

```text
valid
empty-valid
wrong-root
missing-container
wrong-container-type
partial-multilot
valid-multilot
1G2T technical
1G2T financial
```

---

# 8. P0-4 — Sửa thời gian mở tài chính 1G2T

## 8.1. Bug

Canonical đang có:

```text
openingAt
financialOpeningAt
```

Với 1G2T:

```text
openingAt
```

thường là thời gian phase kỹ thuật/general opening.

```text
financialOpeningAt
```

là thời gian mở tài chính.

Frontend import tài chính hiện có khả năng điền:

```javascript
applied.opening?.openingAt
```

vào input thời gian mở E-HSĐXTC.

Đây là sai.

## 8.2. Sửa

Trong:

```text
frontend/procurement/OpeningImportWizard.js
```

tìm function dạng:

```text
importFinancialOpeningFromMuasamcong
```

và sửa để dùng:

```javascript
applied.opening?.financialOpeningAt
```

làm source chính.

### Fallback

Chỉ fallback sang `openingAt` nếu business rule hiện tại thực sự cần backward compatibility với canonical cũ.

Nếu fallback, code nên rõ:

```javascript
const financialOpeningAt =
  applied.opening?.financialOpeningAt
  ?? applied.opening?.openingAt
  ?? null;
```

Nhưng nếu package là 1G2T và canonical đã có phase financial thì ưu tiên tuyệt đối `financialOpeningAt`.

## 8.3. Test JS bắt buộc

Fixture:

```text
openingAt = 2026-08-01T08:00
financialOpeningAt = 2026-08-10T09:00
```

Expected input:

```text
2026-08-10T09:00
```

Không phải ngày 01/08.

Ngoài ra test:

```text
financialOpeningAt = null
openingAt != null
```

theo fallback policy đã chọn.

---

# 9. P1-1 — Bidder identity normalization an toàn

## 9.1. Hiện trạng

Backend có thể đang dùng:

```python
code.casefold()
```

Frontend dùng kiểu:

```javascript
replace(/\s+/g, "").toUpperCase()
```

Điều này giải quyết case:

```text
vn0101234567
VN0101234567
```

nhưng không giải quyết:

```text
vn0101234567
0101234567
```

## 9.2. Không được strip `vn` mù quáng

Hiện chưa có đủ bằng chứng để khẳng định mọi `vn` prefix đều có thể bỏ.

Vì vậy:

- giữ nguyên original `contractorCode` trong canonical/display/persist;
- tạo match key riêng;
- chỉ thêm normalization prefix nếu fixture/live evidence trong repo chứng minh cần.

## 9.3. Đề nghị helper

Ví dụ:

```python
def opening_bidder_match_key(item):
    code = ...
    if code:
        normalized = re.sub(r"\s+", "", code).casefold()
        return ("code", normalized)
    ...
```

Nếu sau khi kiểm tra raw fixture thấy `vn` prefix mismatch thực sự, có thể thêm:

```text
comparison key variant
```

nhưng không mutate source code.

## 9.4. Không fallback tên bừa bãi

Nếu có code ở một source và source kia chỉ có name:

Không được join chỉ vì name “gần giống”.

Nếu bắt buộc fallback name:

- normalize whitespace/case;
- exact normalized name only;
- không fuzzy matching;
- nếu ambiguous thì không join.

## 9.5. Test

Có ít nhất:

```text
same code different case
same code spaces
name fallback when both missing code
two identical names with different codes → no cross-map
```

Case strip `vn` chỉ thêm test nếu có evidence.

---

# 10. P1-2 — Raw snapshot phải lưu request provenance chính xác hơn

## 10.1. Vấn đề

Raw snapshot hiện có thể reconstruct request metadata sau khi collector trả về.

Ví dụ lưu:

```json
{
  "noticeNo": "...",
  "revisionId": "...",
  "packType": 1
}
```

trong khi request thật gửi MSC có thể dùng:

```json
{
  "notifyNo": "...",
  "notifyId": "...",
  "type": "TBMT",
  "packType": 1
}
```

Điều này làm forensic/debug kém chính xác.

## 10.2. Yêu cầu

Collector nên attach sanitized request metadata thực sự đã sử dụng cho từng source.

Ví dụ:

```javascript
{
  operation: "OPENING_BID",
  request: {
    notifyNo,
    notifyId,
    type: "TBMT",
    packType,
  },
  response: ...
}
```

hoặc transport-compatible shape hiện có.

### Không được lưu secret

Không ghi:

```text
authorization
token
cookie
captcha token
session token
CSRF secret
```

Nếu generic sanitizer đã có thì reuse.

## 10.3. Backward compatibility

Raw snapshot schema hiện có không được phá.

Nếu thêm field:

- optional;
- old snapshot vẫn load được;
- migration không cần nếu JSON document.

## 10.4. Test

Assert raw snapshot request metadata có:

```text
notifyNo
notifyId
packType
```

theo source thực tế.

Assert không có:

```text
token
cookie
authorization
```

---

# 11. P1-3 — Thêm safe diagnostics / observability

## 11.1. Mục tiêu

Khi production gặp lỗi, cần nhìn preview/diagnostic và biết:

```text
OPENING_BID:0 success? recordCount?
OPENING_LOT:0 success? recordCount?
OPENING_LOT_DETAIL:0 success? recordCount?
OPENING_BID:1?
OPENING_BID:2?
cross-source mismatches?
```

mà không cần trả raw payload cho browser.

## 11.2. Đề nghị output

Có thể bổ sung vào opening preview:

```json
{
  "sourceDiagnostics": {
    "OPENING_BID:0": {
      "success": true,
      "recordCount": 4,
      "schemaValid": true
    },
    "OPENING_LOT:0": {
      "success": true,
      "recordCount": 12,
      "schemaValid": true
    },
    "OPENING_LOT_DETAIL:0": {
      "success": true,
      "recordCount": 18,
      "schemaValid": true
    }
  }
}
```

Nếu mismatch:

```json
{
  "consistency": {
    "missingBidderSummaries": 1
  }
}
```

Không bắt buộc exact schema trên; hãy phù hợp project.

## 11.3. Privacy/security

Không gửi:

```text
raw response
full contractor payload
token
cookie
secret
```

Diagnostics chỉ nên chứa:

```text
operation
packType
success
schemaValid
recordCount
errorCode
aggregate mismatch count
```

Nếu cần bidder identity để debug server log, phải sanitize/hash hoặc chỉ log khi diagnostic config cho phép.

## 11.4. Frontend

Không bắt buộc phải hiển thị toàn bộ diagnostics cho user.

Có thể giữ trong preview response/dev diagnostics.

Không tạo popup mới gây rối UX nếu không cần.

## 11.5. Test

Assert diagnostics:

- không leak secret;
- record count đúng;
- partial source có code phù hợp;
- complete source báo đúng.

---

# 12. P1-4 — Thu hẹp source authority

Rà lại toàn bộ `normalize_opening_bundle()`.

Mục tiêu:

```text
field nào đến từ source nào
```

phải rõ.

## 12.1. Bidder-level authority

Ưu tiên `OPENING_BID` cho:

```text
contractorCode
contractorName
ventureCode
ventureName
bidValidityDays
bidGuarantee
bidGuaranteeValidityDays
```

Lot/detail rows không được overwrite bidder-level value bằng null/xung đột.

## 12.2. Lot/detail authority

`OPENING_LOT` / `OPENING_LOT_DETAIL` dùng cho:

```text
bidder ↔ lot relation
lotNo
lotName
lot bid price/detail
execution-related lot fields nếu đúng schema
```

Không lấy một lot field có tên gần giống để overwrite bidder-level security.

## 12.3. Null precedence

Rule khuyến nghị:

```text
non-null authoritative bidder-level value
>
lot/detail fallback nếu field đó thật sự cùng semantic
>
null
```

Nhưng với `bidGuarantee` trong opening:

Không dùng E-HSMT lot guarantee làm fallback.

## 12.4. Preserve zero

Các trường tiền:

```text
0
```

là giá trị hợp lệ.

Không dùng:

```python
value or fallback
```

nếu điều đó khiến `0` bị mất.

---

# 13. 1G2T / phase rules phải giữ đúng

Đã xác minh:

```text
1_MTHS → packType 0

1_HTHS:
  technical → packType 1
  financial → packType 2
```

Financial chỉ meaningful khi lifecycle/status MSC đã tới phase phù hợp.

Không được:

```text
TECHNICAL security → tự copy sang FINANCIAL
```

nếu MSC trả bidder-level values khác nhau theo phase.

Current test đã có case:

```text
TECHNICAL guarantee = 100m
FINANCIAL guarantee = 250m
```

phải giữ.

Do đó security key theo:

```text
bidder identity + phase
```

hiện có lý do hợp lệ và không được bỏ phase chỉ vì security “thuộc bidder”.

Ownership nghiệp vụ là bidder-level **trong context opening phase**.

---

# 14. Liên danh

## 14.1. Join key

Opening flow đã xác minh join bằng:

```text
contractorCode
```

`ventureCode`/`ventureName` là metadata.

Không dùng:

```text
ventureName
```

làm security join key nếu contractorCode có.

## 14.2. Propagate

Giữ logic:

```text
bid-open bidder summary
→ lot rows
```

cho:

```text
ventureCode
ventureName
```

## 14.3. Thành viên liên danh

Không tự fabricate:

```text
jointVentureMembers
```

nếu opening source không chứng minh member list.

Frontend hiện có thể để thành viên liên danh người dùng xác nhận thủ công.

Không coi đó là bug trong patch này.

Nếu raw bidder summary thực sự chứa member array ở một variant đã có fixture, có thể preserve canonical metadata nhưng không được phân bổ security theo từng member.

---

# 15. Cache / raw snapshot completeness

Rà lại:

```text
_raw_snapshot_has_complete_opening_sources
```

hoặc helper tương đương.

## Yêu cầu

### 15.1. Phải dùng `requiredOpeningSources`

Nếu snapshot có list required source cụ thể:

```text
operation + packType
```

thì cache chỉ reusable nếu tất cả required source:

- tồn tại;
- success;
- response/schema valid;
- cross-source consistency hợp lệ theo policy.

### 15.2. Legacy snapshot

Nếu old snapshot không có `requiredOpeningSources`, có thể có fallback rule backward-compatible.

Nhưng fallback không được quá lỏng.

### 15.3. Multi-lot

Không reuse chỉ có:

```text
OPENING_LOT_DETAIL
```

mà thiếu:

```text
OPENING_BID
```

Current test này phải tiếp tục pass.

### 15.4. 1G2T

Không reuse cache technical-only khi lifecycle yêu cầu financial.

Current test thiếu financial bid-open phải tiếp tục pass.

### 15.5. Schema invalid

`success: true` nhưng response wrong shape:

Không reusable.

---

# 16. Frontend mapping

Rà lại:

```text
mapOpeningBidder()
openingBidIdentity()
reconcileOpeningDrafts()
applyOpeningImportToDraft()
importFinancialOpeningFromMuasamcong()
```

## 16.1. Không đổi domain key ngoài nhu cầu

Current mapping:

```text
bidder.bidGuarantee
→ giaTriDamBao

bidder.bidGuaranteeValidityDays
→ hieuLucBaoDamNgay

bidder.bidValidityDays
→ hieuLucHsdt
```

giữ nếu đúng.

## 16.2. OVERWRITE/MERGE

Không được làm patch này phá merge behavior.

Đảm bảo một bidder nhiều lô vẫn có unique identity theo:

```text
contractor + lot
```

ở flat UI.

## 16.3. Financial import

Sửa time field như mục P0-4.

## 16.4. No popup noise

Không thêm popup mới chỉ để diagnostics.

Giữ current error UX trừ khi cần typed error mapping.

---

# 17. Error taxonomy

Rà lại current error taxonomy:

```text
PROCUREMENT_SCHEMA_CHANGED
PROCUREMENT_PARTIAL_DATA
PROCUREMENT_NOT_FOUND
PROCUREMENT_ENDPOINT_CHANGED
PROCUREMENT_UPSTREAM_UNAVAILABLE
...
```

Nếu thêm code:

```text
PROCUREMENT_OPENING_BIDDER_SUMMARY_MISSING
PROCUREMENT_OPENING_SOURCE_INCONSISTENT
```

hãy:

- đặt naming nhất quán;
- map đúng public error;
- không expose raw upstream text;
- có test classification.

Nếu không muốn tăng error surface, có thể dùng:

```text
PROCUREMENT_PARTIAL_DATA
```

kèm structured diagnostics.

Ưu tiên consistency với architecture hiện có hơn là tạo code mới tùy tiện.

---

# 18. Test matrix bắt buộc

Không chỉ chạy test có sẵn. Hãy thêm regression tests cho ít nhất toàn bộ matrix sau.

## 18.1. Non-lot, 1G1T

```text
1 bidder
2 bidders
bidGuarantee present
fallback totalGuaranteeValue
bidGuarantee = 0
missing optional guarantee
```

## 18.2. Multi-lot, 1G1T

```text
1 bidder → 3 lots
2 bidders → overlapping lots
one bidder security must not cross to another
bid-open bidder summary + lot detail null guarantee
lot detail conflicting guarantee
nested bidGuaranteed must not override bidder-level
```

## 18.3. 1G2T no lots

```text
technical bidder values
financial bidder values
different guarantee between phases
different bid validity between phases
different openingAt vs financialOpeningAt
```

## 18.4. 1G2T with lots

```text
A/L01, A/L02 in technical
A/L01, A/L02 in financial
phase values isolated
financial time isolated
```

## 18.5. Cross-source mismatch

```text
bid-open empty + lot detail non-empty
bid-open A + lot detail A/B
lot-open A + lot detail A
lot-open A + lot detail B
wrong contractor code case
```

## 18.6. Schema validation

```text
OPENING_BID {}
OPENING_BID wrong list type
OPENING_LOT wrong root
OPENING_LOT_DETAIL wrong root
valid empty opening
```

## 18.7. Cache

```text
complete exact snapshot
partial notice snapshot with complete opening evidence
cached lot detail without bid-open
1G2T missing financial bid
invalid bid-open schema
cross-source inconsistent snapshot
```

## 18.8. Identity

```text
case difference
whitespace difference
name fallback exact
same name, different contractor code
```

## 18.9. Joint venture

```text
ventureCode/name arrives only in bid-open
lot detail lacks venture info
metadata propagated to every lot
independent bidder remains independent
```

## 18.10. Order independence

Dùng cùng data nhưng raw source order khác nhau.

Canonical output phải tương đương.

---

# 19. Kiểm thử bằng fixture production-like

Ngoài synthetic unit tests, hãy tìm trong repo các fixture opening thực tế hoặc production-like:

```text
tests/fixtures/muasamcong/opening/
```

và mở rộng nếu cần.

Nếu repository có raw example liên quan các mã đã nghiên cứu như:

```text
IB2600212155
IB2600270477
IB2600082707
```

hãy tận dụng.

Không hard-code business behavior chỉ cho một mã.

Nếu raw live không có trong repo:

- không bịa response;
- test synthetic phải phản ánh documented shape;
- ghi rõ limitation trong final report.

---

# 20. Yêu cầu chạy test

Sau khi sửa:

## 20.1. Chạy targeted tests trước

Ví dụ:

```bash
pytest -q tests/test_muasamcong_integration_source.py
pytest -q tests/test_procurement_import_routes.py
pytest -q tests/test_muasamcong_browser_lookup.py
```

Chạy JS tests liên quan opening:

```bash
node --test <relevant test files>
```

hoặc command hiện có trong package.json.

## 20.2. Chạy broader suite

Nếu runtime cho phép:

```bash
pytest -q
```

và frontend JS suite.

## 20.3. Lint / format / static checks

Chạy đúng tooling của repo.

Không introduce:

```text
syntax error
unused imports
lint regression
format regression
```

## 20.4. Không bỏ qua failing test

Không được:

- xóa test cũ;
- skip test;
- loosen assertion;
- thay expected để phù hợp bug mới.

Nếu test cũ phản ánh business rule sai và bắt buộc phải đổi:

- giải thích rõ;
- chứng minh bằng code/reference;
- cập nhật test semantic chứ không chỉ “cho xanh”.

---

# 21. Không được làm

## 21.1.

Không thêm `OPENING_SUBMISSION` vào required opening source chỉ vì endpoint tồn tại.

## 21.2.

Không dùng E-HSMT lot guarantee để lấp opening bidder guarantee.

## 21.3.

Không coi `bidGuaranteed` là bidder-level alias mặc định.

## 21.4.

Không join security bằng contractor name khi contractorCode có.

## 21.5.

Không strip `vn` prefix mù quáng khỏi persisted contractor code.

## 21.6.

Không bỏ phase khỏi security identity nếu chưa chứng minh semantic cho phép.

## 21.7.

Không overwrite non-null authoritative bidder-level value bằng null lot/detail value.

## 21.8.

Không leak raw MSC payload/token/cookie ra frontend diagnostics.

## 21.9.

Không đổi row order ở các module unrelated.

## 21.10.

Không refactor diện rộng các phần không liên quan nếu không cần.

Ưu tiên patch nhỏ, rõ semantic, dễ review.

---

# 22. Tiêu chí nghiệm thu

Patch chỉ được coi là hoàn tất khi thỏa tất cả:

### AC-01

Một bidder tham gia nhiều lô nhận đúng cùng bidder-level:

```text
bidGuarantee
bidValidityDays
bidGuaranteeValidityDays
venture metadata
```

trong cùng phase.

### AC-02

Hai bidder không bao giờ nhận nhầm security của nhau.

### AC-03

`bidGuarantee` ưu tiên hơn `totalGuaranteeValue`.

### AC-04

`totalGuaranteeValue` chỉ fallback khi `bidGuarantee` thiếu/null.

### AC-05

Nested `bidGuaranteed` không được tự động trở thành bidder-level `bidGuarantee`.

### AC-06

Opening multi-lot có lot detail bidder mà bid-open thiếu bidder summary không được silently đánh dấu complete.

### AC-07

`success: true` nhưng schema source sai không được cache reuse như complete.

### AC-08

1G2T technical và financial không trộn dữ liệu.

### AC-09

Frontend financial opening dùng đúng:

```text
financialOpeningAt
```

thay vì technical/general `openingAt`.

### AC-10

Không thêm mandatory `OPENING_SUBMISSION`.

### AC-11

Không dùng invitation guarantee để fill opening guarantee.

### AC-12

Original contractor code vẫn được giữ để hiển thị/persist.

### AC-13

Diagnostics mới không leak secret/raw sensitive payload.

### AC-14

Existing opening/import tests pass.

### AC-15

New regression tests pass.

### AC-16

Không regression các flow:

```text
plan import
notice import
lot import
goods import
result import
1G1T
1G2T
joint venture
raw snapshot cache
preview/apply stale protection
workspace permission
```

---

# 23. Yêu cầu kiến trúc

Nếu thấy `normalize_opening_bundle()` đang quá lớn, chỉ refactor vừa đủ.

Có thể tách helper:

```text
opening_bidder_identity()
opening_bidder_match_key()
opening_bidder_guarantee()
collect_bidder_level_opening_metadata()
validate_opening_bid_payload()
validate_opening_lot_payload()
validate_opening_lot_detail_payload()
validate_opening_source_consistency()
opening_source_diagnostics()
```

Không bắt buộc đúng tên.

Mục tiêu là:

- source authority rõ;
- test riêng được;
- không có generic magic alias khó kiểm soát.

---

# 24. Rà lại raw cache behavior sau patch

Đặc biệt kiểm tra case sau:

```text
T0:
complete notice lookup đã lưu partial/complete raw snapshot.

T1:
user vào bước mở thầu và bấm import.

T2:
route thử reuse snapshot.
```

Route chỉ được reuse nếu opening evidence phù hợp current selected revision:

```text
noticeNo
revisionId
revisionNumber
required operations
packType
schema validity
cross-source consistency
TTL
```

Không được lấy opening của revision khác.

Không được lấy technical phase của revision cũ cho financial phase mới.

---

# 25. Concurrency / preview stale

Không phá current protection:

```text
previewId
expectedPackageRowVersion
workspaceLease
```

Sau patch:

- prepare vẫn read-only với local business entity;
- apply vẫn kiểm tra row version;
- switching workspace phải invalidate/deny stale operation;
- diagnostics không bypass permission.

---

# 26. Permission/security

Không mở rộng quyền.

Opening import vẫn phải kiểm tra:

```text
organization scope
workspace scope
module permission
package edit permission
latest/non-archived package
source binding
```

Không chuyển validation từ backend sang frontend.

Backend là source of truth.

---

# 27. Performance

Không thực hiện O(n³) join nếu có thể tránh.

Cho opening:

```text
bidders = N
lot rows = M
```

nên index bằng map/dict:

```text
bidderKey → metadata
bidderKey+lot → row
```

Mục tiêu gần:

```text
O(N + M)
```

Không repeated deep walk raw bundle cho từng bidder nếu có thể pre-index một lần.

---

# 28. Logging

Nếu có logging mismatch:

Không log toàn contractor payload.

Có thể log:

```text
noticeNo
revisionNumber
operation
packType
count
errorCode
```

Contractor identity nếu cần thì mask/hash theo standard hiện có.

---

# 29. Documentation

Cập nhật ADR/research doc nếu patch thay đổi documented behavior.

Ít nhất ghi rõ:

```text
- bid-open là bidder-level authority
- bidGuarantee > totalGuaranteeValue fallback
- bidGuaranteed không phải bidder-level alias mặc định
- multi-lot requires bidder summary consistency
- financialOpeningAt dùng cho 1G2T financial import
- OPENING_SUBMISSION không mandatory
```

Không viết doc trái code.

---

# 30. Final report bắt buộc Codex trả về

Sau khi hoàn tất, hãy trả report có các phần:

## A. Root cause

Liệt kê từng root cause thực tế tìm thấy trong code.

## B. Files changed

Ví dụ:

```text
backend/.../canonical.py
backend/.../collectors.mjs
backend/.../routes.py
frontend/.../OpeningImportWizard.js
tests/...
```

## C. Behavior before / after

Ví dụ:

```text
Before:
nested bidGuaranteed có thể bị hiểu như bidder-level guarantee

After:
bidGuarantee primary
totalGuaranteeValue fallback
nested bidGuaranteed ignored for bidder-level
```

## D. Test added

Liệt kê tên test cụ thể.

## E. Test results

Ghi command + số test pass/fail.

Không nói “all tests passed” nếu chưa chạy.

## F. Remaining risks

Nếu chưa có raw live evidence về:

```text
vn prefix
rare MSC schema variants
ADB/WB/KHAC
```

hãy nói rõ.

## G. No-regression confirmation

Xác nhận rõ:

```text
không thêm OPENING_SUBMISSION mandatory
không trộn E-HSMT guarantee với opening guarantee
không đổi persisted contractorCode
không bỏ phase separation
```

---

# 31. Trình tự thực hiện bắt buộc

Thực hiện theo thứ tự:

```text
1. Đọc code hiện tại.
2. Đọc tests hiện tại.
3. Đọc docs/research liên quan opening.
4. Xác định exact current behavior.
5. Viết/điều chỉnh failing regression tests cho các bug còn lại.
6. Sửa canonical source authority.
7. Sửa collector/source validators.
8. Sửa cache consistency.
9. Sửa frontend financialOpeningAt.
10. Thêm diagnostics.
11. Chạy targeted tests.
12. Chạy broader tests.
13. Review diff để loại thay đổi ngoài scope.
14. Trả final report.
```

Không làm bước 6 trước khi hiểu bước 1–4.

---

# 32. Case mẫu phải dùng để tự kiểm tra logic

## Case 1 — bidder guarantee đúng

Raw:

```json
{
  "opening_bid_0": {
    "bidSubmissionByContractorViewResponse": {
      "bidSubmissionDTOList": [{
        "contractorCode": "vn0100000001",
        "bidGuarantee": 100000000,
        "totalGuaranteeValue": 120000000,
        "bidValidityNum": 90,
        "bidGuaranteeValidity": 120
      }]
    }
  },
  "opening_lot_detail_0": [
    {
      "contractorCode": "VN0100000001",
      "lotNo": "L01",
      "bidGuaranteed": 20000000
    },
    {
      "contractorCode": "VN0100000001",
      "lotNo": "L02",
      "bidGuaranteed": 30000000
    }
  ]
}
```

Expected:

```text
A/L01 bidGuarantee = 100,000,000
A/L02 bidGuarantee = 100,000,000
```

Không phải 20m/30m.

---

## Case 2 — totalGuaranteeValue fallback

Raw:

```json
{
  "opening_bid_0": {
    "bidSubmissionByContractorViewResponse": {
      "bidSubmissionDTOList": [{
        "contractorCode": "vn0100000001",
        "bidGuarantee": null,
        "totalGuaranteeValue": 120000000
      }]
    }
  }
}
```

Expected:

```text
bidGuarantee = 120,000,000
```

---

## Case 3 — nested bidGuaranteed only

Raw bidder summary không có guarantee:

```text
bidGuarantee = null
totalGuaranteeValue = null
```

Lot detail:

```text
bidGuaranteed = 20,000,000
```

Expected bidder-level:

```text
bidGuarantee = null
```

Không suy diễn.

---

## Case 4 — missing bidder summary

```text
OPENING_BID = []

OPENING_LOT_DETAIL:
A/L01
A/L02
```

Expected:

```text
not silently complete
```

Phải partial/warning/error theo architecture đã chọn.

---

## Case 5 — 1G2T

```text
TECHNICAL:
opening time = 01/08 08:00
guarantee = 100m

FINANCIAL:
opening time = 10/08 09:00
guarantee = 250m
```

Expected:

```text
technical rows → 100m
financial rows → 250m

openingAt/general → technical according current canonical contract
financialOpeningAt → 10/08 09:00

frontend financial input → 10/08 09:00
```

---

# 33. Kết luận nhiệm vụ

Không coi task này là “sửa một field null”.

Đây là task làm cứng toàn bộ boundary:

```text
MSC opening source
→ collector
→ raw evidence
→ schema validation
→ cross-source consistency
→ canonical
→ cache
→ preview/apply
→ frontend opening UI
```

Ưu tiên lớn nhất là **đúng dữ liệu và fail-safe**.

Nếu upstream thiếu/khác schema:

```text
phát hiện
→ classify
→ partial/error
```

thay vì:

```text
đoán
→ fill nhầm
→ báo complete
```

Sau khi sửa, hãy đảm bảo rằng việc import biên bản mở thầu có thể trả lời được rõ ràng:

```text
Giá trị này đến từ endpoint nào?
Thuộc bidder hay lot?
Thuộc phase nào?
Join bằng identity nào?
Nếu source thiếu thì hệ thống phản ứng thế nào?
Cache có đủ evidence không?
Frontend đang hiển thị đúng phase không?
```

Chỉ khi tất cả các câu trên có câu trả lời rõ ràng trong code + test thì task mới được coi là hoàn tất.
