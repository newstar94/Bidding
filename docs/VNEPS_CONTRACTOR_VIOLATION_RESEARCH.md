# Research note: tra cứu hồ sơ và vi phạm nhà thầu từ VNEPS

Ngày kiểm tra: **2026-08-06** (Asia/Saigon)

## Phạm vi và mức độ tin cậy

Note này phục vụ yêu cầu tại [`CODEX_PROMPT_TRA_CUU_VI_PHAM_NHA_THAU_BIEN_BAN_MO_THAU.md`](./CODEX_PROMPT_TRA_CUU_VI_PHAM_NHA_THAU_BIEN_BAN_MO_THAU.md). Chỉ ba nhóm nội bộ được xem xét:

- `BIDDING_BAN`;
- `CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT`;
- `UNRELIABLE_BID_PARTICIPATION`.

Nguồn dùng trong nghiên cứu chỉ gồm source code hiện có của BiddingFlow và các trang/service endpoint do Hệ thống mạng đấu thầu quốc gia vận hành. Không vượt CAPTCHA, không đăng nhập, không dò dữ liệu hàng loạt. Kiểm tra live chỉ dùng các request đơn lẻ, `pageSize = 1`, nhằm xác nhận endpoint và schema.

VNEPS hiện công khai một trang “Tổ chức, cá nhân vi phạm”, trong đó có đúng các danh sách cần thiết: tổ chức/cá nhân bị cấm, nhà thầu bị chấm dứt hợp đồng, nhà thầu không bảo đảm uy tín và quyết định đã hủy/thu hồi. Trang cũng cảnh báo rằng với quyết định đăng trước 16/09/2022 phải tải file đính kèm để xác định thời gian cấm, ngày hiệu lực và ngày kết thúc hiệu lực. Vì vậy dữ liệu thiếu ngày ở giai đoạn cũ không được suy đoán thành “không vi phạm”. [Nguồn chính thức: trang tra cứu vi phạm VNEPS](https://muasamcong.mpi.gov.vn/vi/web/guest/organizations-violators).

Không tìm thấy tài liệu API công khai/versioned cho các service endpoint bên dưới. Chúng là endpoint mà chính frontend công khai của VNEPS đang gọi, do đó có thể dùng qua một adapter phòng thủ, nhưng **không được xem là API contract ổn định**. Schema phải được runtime-validate, version hóa fixture và coi thay đổi/HTTP lỗi/schema lạ là `LOOKUP_FAILED` hoặc `REVIEW_REQUIRED`, không phải `NO_ACTIVE_VIOLATION`. [Nguồn chính thức: HTML/JavaScript của trang tra cứu VNEPS](https://muasamcong.mpi.gov.vn/vi/web/guest/organizations-violators).

## 1. Cơ chế tra cứu hồ sơ nhà thầu đã có trong repo

BiddingFlow đã có provider hồ sơ đối tác, không cần tạo cơ chế thứ hai:

- Base URL nhà thầu: `https://muasamcong.mpi.gov.vn/o/egp-portal-contractors-approved/services`.
- `POST /get-detail-approve-bidder` với JSON `{ "orgCode": "vn...", "roleName": "NT" }`.
- `POST /get-area-by-code` với JSON `{ "queryParams": { "code": { "equals": "..." } } }` để giải tên địa bàn.
- Mã định danh được repo chấp nhận theo dạng `vn|vnp|vnz` + 9–14 chữ số sau khi bỏ khoảng trắng, dấu chấm, gạch dưới và gạch ngang.
- Provider hiện ánh xạ các field: `orgFullName`, `orgShortName`, `orgEnName`, `orgCode`, `taxCode`, `repName`, `repPosition`, `officePhone`, `businessType`, `businesses`, `officeAdd`, `officePro`, `officeDis`, `officeWar`.

Trang “Nhà thầu được phê duyệt” còn dùng một endpoint search công khai:

```http
POST /o/egp-portal-contractors-approved/services/get-list

{
  "pageSize": 5,
  "pageNumber": 0,
  "queryParams": {
    "roleType": { "in": ["NT", "NTPER"] },
    "orgNameOrOrgCode": { "contains": "<mã hoặc tên>" },
    "taxCode": { "contains": "<MST>" }
  }
}
```

Live response có `orgCode`, `status`, `orgFullname`, `taxCode`, `officeAdd`, `effRoleDate`, `parentName`, `startPendingDate`, `lockRoleDate`. Search này cũng là `contains`, nên chỉ phù hợp để tìm candidate rồi exact-match; resolve theo mã đầy đủ vẫn nên dùng `get-detail-approve-bidder`. [Nguồn chính thức: danh sách nhà thầu được phê duyệt](https://muasamcong.mpi.gov.vn/web/guest/approved-contractors-list), [service search](https://muasamcong.mpi.gov.vn/o/egp-portal-contractors-approved/services/get-list).

Nguồn repo: [`partner_lookup_service.py`](../backend/partners/partner_lookup_service.py#L271-L455).

Endpoint nội bộ đã có là `GET /api/lookup-tax-code?orgCode=...&role=NT` (hoặc `code=<tax-code>`), yêu cầu session hợp lệ và organization hợp lệ, giới hạn 12 request/phút/IP và 8 request/phút/user. Nó trả `{ found: true, ...normalized fields }`, `{ found: false, code: "PARTNER_NOT_FOUND" }`, hoặc lỗi có phân loại khi upstream/busy. Nguồn repo: [`address_routes.py`](../backend/partners/address_routes.py#L151-L329), [`app.py`](../backend/app.py#L898).

Client hiện đã debounce 400 ms, hủy request cũ bằng `AbortController`, ưu tiên dữ liệu local và chỉ tra khi mã định danh/MST hợp lệ. Luồng mở thầu cũng có lookup có timeout 3 giây trước khi lưu, nhưng lỗi lookup không chặn nghiệp vụ. Nguồn repo: [`partnerTaxLookup.js`](../frontend/partners/partnerTaxLookup.js#L1-L190), [`openingContractorLookup.js`](../frontend/packages/openingContractorLookup.js#L1-L105).

Kiểm tra live ngày 2026-08-06: `POST get-detail-approve-bidder` với một mã nhà thầu công khai hợp lệ trả HTTP 200 và có các field `orgFullName`, `orgEnName`, `orgCode`, `taxCode`, `idTypes`, `taxNation`, `officePro`, `officeDis`, `officeWar`, `officeAdd`, `repName`, `repPosition`, `businesses`, `roleContractorHis`. Đây là xác nhận live cho endpoint/schema; không nên persist/log toàn bộ `procurement_data` vì chứa dữ liệu không cần thiết cho chức năng vi phạm. [Nguồn service chính thức](https://muasamcong.mpi.gov.vn/o/egp-portal-contractors-approved/services/get-detail-approve-bidder).

## 2. Endpoint vi phạm quan sát được từ frontend chính thức

Tất cả URL dưới đây có base:

```text
https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services
```

### 2.1 `BIDDING_BAN`

Search:

```http
POST /get-list-violate
Content-Type: application/json

{
  "orgNameVioOrOrgCode": { "contains": "<mã định danh hoặc tên>" },
  "idNo": { "contains": "<MST/số chứng thực>" },
  "penType": { "contains": "CT" },
  "status": { "in": ["PUBLISH"] },
  "cqctqCreate": { "notEquals": 1, "specified": true },
  "pageSize": 5,
  "pageNumber": 0
}
```

Frontend chính thức dùng `penType = CT` cho tab cấm và cùng endpoint với `status = CANCEL` cho danh sách quyết định hủy/thu hồi. Search theo mã là `contains`, nên provider bắt buộc post-filter exact trên `orgCode` hoặc `idNo`; không được kết luận chỉ vì tên giống hoặc chuỗi con giống. [Nguồn chính thức: trang tra cứu và JavaScript nhúng](https://muasamcong.mpi.gov.vn/vi/web/guest/organizations-violators), [service search](https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services/get-list-violate).

Các field list đã xác minh live:

```text
id, idType, idNo, idNationality, orgNameViolate, address,
penType, penUnit, effDate, expDate, des, penTypeName, penUnitName,
role, orgCode, bidNo, contractNo, shoppingMethod,
decisionNo, decisionId, status, orgNameDec, issuedDate,
officePro, officeDis, updatedDate, createdBy, createdDate,
methodType, cqctqCreate, effSearchDate, approveCancelDate
```

Một record live có `penType = "CD,CT"`; do đó `penType` không phải enum đơn. Parser phải split/normalize token và không so sánh toàn chuỗi bằng `== "CT"` hoặc `== "CD"`.

Probe live trả timestamp không có offset, ví dụ dạng `YYYY-MM-DDTHH:mm:ss`. Chưa có tài liệu chính thức xác nhận timezone của field; adapter phải giữ raw value và dùng một cấu hình timezone upstream được xác nhận vận hành, không tự mặc định UTC.

Detail:

```http
POST /get-detail-violation
{ "idViolateDec": "<decisionId>" }
```

Top-level đã xác minh: `decisionNo`, `issuedDate`, `orgCode`, `status`, `id`, `orgName`, `repDecisionNo`, `violates`. Bản ghi trong `violates` có các field hủy/thu hồi như `status`, `decNoCancel`, `approveCancelDate`, cùng `decisionNo`, `issuedDate`, `orgCode`. [Nguồn service chính thức](https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services/get-detail-violation).

Trong detail, `userViolates` còn có `idType`, `idNo`, `name`, `penType`, `effDate`, `expDate`, `orgCode`, `bidNo`, `contractNumber`, `bannedTime`, `bannedTimeUnit`, `methodType`, `penScope`. Đây là vị trí tốt hơn list để chuẩn hóa từng đối tượng bị xử lý, nhưng vẫn cần exact-match identity.

`activeStatus` xuất hiện trên giao diện không phải field của API. Frontend VNEPS tự tính nó theo ngày hiện tại bằng `moment()` và có nhánh coi thiếu `expDate` là còn hiệu lực. Không được dùng giá trị/logic đó để trả lời câu hỏi lịch sử tại `bid_closing_at`; thiếu `expDate` phải theo rule của BiddingFlow là `REVIEW_REQUIRED`.

Ánh xạ tối thiểu đề xuất:

```text
contractor_identifier <- orgCode
tax_code              <- idNo (chỉ khi idType xác nhận là MST)
effective_from        <- effDate
effective_to          <- expDate
issued_date           <- issuedDate
decision_number       <- decisionNo
source_status         <- status
is_revoked            <- CANCEL hoặc detail có quyết định hủy/thu hồi hợp lệ
```

Nếu thiếu `effDate`/`expDate`, timezone chưa xác định, hoặc trạng thái hủy không đối chiếu được thì `REVIEW_REQUIRED`; đặc biệt áp dụng cảnh báo của VNEPS với quyết định trước 16/09/2022.

### 2.2 `UNRELIABLE_BID_PARTICIPATION`

Search:

```http
POST /econsign/contractor-reputation-eval/searchContractorPo

{
  "orgCode": { "equals": "<mã định danh>" },
  "taxCode": "<MST>",
  "status": { "equals": null },
  "pageSize": 5,
  "pageNumber": 0
}
```

Các filter khác frontend hỗ trợ: `orgName.contains`, `documentNo.contains`, `publicByName.contains`. List đã xác minh live có `id`, `orgCode`, `orgName`, `evaluateId`, `evaluateNo`, `evaluateVersion`, `documentNo`, `status`, `publicDate`, `publicByName`, `createdDate`, `updatedDate`. [Nguồn chính thức: trang tra cứu](https://muasamcong.mpi.gov.vn/vi/web/guest/organizations-violators), [service search](https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services/econsign/contractor-reputation-eval/searchContractorPo).

`behaviorDate` không có ở list; phải gọi detail cho từng kết quả đã khớp identity:

```http
POST /econsign/contractor-reputation-eval/getContractorDetailPo
{ "id": "<list.id>" }
```

Detail đã xác minh live:

- `contractorInfo`: `orgCode`, `orgName`, `behavior`, `behaviorDate`, `conclude`, `evaluateId`, `evaluateNo`, `versions`;
- `evalInfo`: `idNo`, `status`, `publicDate`, `documentNo`, `cancelReason`, `cancelDecisionNo`, `cancelDecisionDate`, `cancelDate`, `cancelFileAttachId`, `versions`, cùng metadata gói thầu/chủ đầu tư.

Frontend chính thức ánh xạ status reputation `01` là đã đăng tải và `02` là đã hủy. Probe một record hủy xác nhận record vẫn có `behaviorDate`, nên `behaviorDate` tồn tại không đủ để kết luận: phải kiểm tra đồng thời status và các field hủy. Frontend cũng có nhiều `behavior` code hiện hành/cũ (quan sát được các code 1–15); provider nên lưu raw array, không hard-code một hành vi duy nhất.

[Nguồn service detail chính thức](https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services/econsign/contractor-reputation-eval/getContractorDetailPo).

Ánh xạ tối thiểu đề xuất:

```text
contractor_identifier <- contractorInfo.orgCode
tax_code              <- evalInfo.idNo, chỉ sau khi xác nhận loại định danh
behavior_date         <- contractorInfo.behaviorDate
source_status         <- evalInfo.status
is_revoked            <- trạng thái hủy hoặc cancelDecision*/cancelDate có căn cứ
source_record_id      <- list.id
```

Không được thay `behaviorDate` bằng `publicDate`, `createdDate` hay `updatedDate`. Nếu detail lỗi, `behaviorDate` null hoặc trạng thái hủy mâu thuẫn thì `REVIEW_REQUIRED`/`LOOKUP_FAILED`.

### 2.3 `CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT`

Frontend hiện có **hai schema/luồng dữ liệu**, phải tách adapter:

1. Dữ liệu quyết định/legacy qua `POST /get-list-violate`, `penType.contains = "CD"`, các `methodType` được frontend dùng gồm `NTHD_140`, `NTHD_131`, `NTHD`, `NTOTHER`. Luồng tìm kiếm tổng hợp hỗ trợ `orgNameVioOrOrgCode.contains` và `idNo.contains`, nên phù hợp tra cứu theo identifier nhưng vẫn phải exact post-filter. Các field có ích là `orgCode`, `idNo`, `decisionNo`, `decisionId`, `issuedDate`, `effDate`, `expDate`, `status`, `methodType`, `contractNo`. [Nguồn chính thức: JavaScript nhúng của trang tra cứu](https://muasamcong.mpi.gov.vn/vi/web/guest/organizations-violators), [service](https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services/get-list-violate).
2. Dữ liệu thực hiện hợp đồng/current qua `POST /result-perform-contract/searchPo`. Frontend chỉ cung cấp filter `contractorName.contains`, `contractNo.contains`, `investorName.contains`, `contractEndType.equals` và **không có filter mã nhà thầu/MST trong payload search đã quan sát**. Không được quét danh sách để tự tìm mã. [Nguồn service search chính thức](https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services/result-perform-contract/searchPo).

List của luồng current đã xác minh live có:

```text
id, idNo, contractCode, contractNo, contractName, contractPublicDate,
projectName, bidName, investorCode, investorName,
contractorCode, contractorName, roleName, status, publicDate,
contractEndDate, contractEndType, performType,
contractorPassList, contractorPassName, isSystem
```

Detail:

```http
POST /result-perform-contract/detail
{ "resultPerformContract": { "id": "<list.id>" } }
```

Detail live có `contractorCode`, `taxCode`, `ventureCode`, `ventureName`, `contractEnd`, `contractEndDate`, `contractEndType`, `contractEndReason`, `contractorError`, `contractViolate`, `contractViolations`, `status`, `publicDate`. [Nguồn service detail chính thức](https://muasamcong.mpi.gov.vn/o/egp-portal-org-ind-violating/services/result-perform-contract/detail).

Chưa xác minh được tài liệu chính thức diễn giải đầy đủ ý nghĩa của các mã `contractEndType`, `methodType` và `status`. Không được coi mọi record “chấm dứt” là do lỗi nhà thầu. Chỉ normalize khi payload/detail có căn cứ rõ ràng cho lỗi nhà thầu; nếu `contractorError`/lý do/mã loại chưa được map bằng fixture đã duyệt thì `REVIEW_REQUIRED`.

Probe legacy xác nhận record `methodType = NTHD_140` có thể có `expDate = null` trong khi `issuedDate`/`effDate` có giá trị. Nếu dùng rule sản phẩm 5 năm thì mốc nguồn khả dụng là `issuedDate`; không được hiểu `expDate = null` là vô thời hạn hoặc đang vi phạm.

Yêu cầu nội bộ hiện dùng `issued_date + 5 năm lịch`, nhưng schema current chỉ chắc chắn có `contractEndDate` và `publicDate`; hai field này không được tự đổi tên thành `issued_date`. Schema legacy có `issuedDate`, song cần kiểm tra rằng nó thực sự là ngày quyết định cho từng `methodType`. Cho đến khi fixture nghiệp vụ xác nhận, record current thiếu ngày quyết định phải là `REVIEW_REQUIRED`. Nguồn quy tắc sản phẩm: [`CODEX_PROMPT_TRA_CUU_VI_PHAM_NHA_THAU_BIEN_BAN_MO_THAU.md`](./CODEX_PROMPT_TRA_CUU_VI_PHAM_NHA_THAU_BIEN_BAN_MO_THAU.md#L257-L290).

## 3. Trạng thái xác minh live

| Thành phần | Kết quả 2026-08-06 | Có thể dùng ngay | Chưa xác minh/giới hạn |
|---|---|---|---|
| Hồ sơ nhà thầu `get-detail-approve-bidder` | HTTP 200, schema thực có `orgCode`, `taxCode`, tên, địa chỉ, đại diện | Có; repo đã tích hợp | API không có contract/version công khai |
| Cấm thầu `get-list-violate` | HTTP 200; list có `orgCode`, `idNo`, `effDate`, `expDate`, `issuedDate`, `status`, `decisionId` | Có thể dựng adapter phòng thủ | Timezone; record cũ thiếu ngày; liên kết hủy/thu hồi cần fixture |
| Cấm thầu detail | HTTP 200; có `violates[].status`, `decNoCancel`, `approveCancelDate` | Có để đối chiếu quyết định | Semantics/versioning chưa được tài liệu hóa |
| Không bảo đảm uy tín search | HTTP 200; lọc được `orgCode.equals`/`taxCode` | Có; post-filter identity exact | List không có `behaviorDate` |
| Không bảo đảm uy tín detail | HTTP 200; có `behaviorDate` và field hủy | Có; bắt buộc gọi detail cho record match | Semantics mã status chưa có tài liệu công khai |
| Chấm dứt hợp đồng legacy | HTTP 200 qua `get-list-violate`; có lookup theo mã/MST | Có thể dùng với fixture theo từng `methodType` | Chưa chứng minh tất cả `methodType` tương ứng “do lỗi nhà thầu” |
| Chấm dứt hợp đồng current | HTTP 200; detail giàu dữ liệu, có mã/MST và `contractEndDate` | Dùng để xác nhận record đã tìm thấy | Search không có filter mã/MST; không được crawl; thiếu `issued_date` rõ nghĩa |
| CAPTCHA/anti-bot | Không xuất hiện trong các request public đã kiểm tra | Không cần bypass | Nếu upstream bổ sung challenge thì dừng và trả `LOOKUP_FAILED` |

Ngoài timezone chưa có contract, encoding ngày còn khác nhau giữa list và detail: probe thấy list trả timestamp không offset, còn một số detail trả offset `+0000` với giờ chênh 7 tiếng. Parser phải hỗ trợ cả hai dạng, chuẩn hóa thành instant có timezone bằng fixture đã xác nhận và tuyệt đối không so sánh chuỗi ngày.

## 4. Kiến nghị implementation từ findings

1. Tái sử dụng `backend/partners/partner_lookup_service.py` để resolve hồ sơ; bổ sung provider vi phạm riêng, không gọi VNEPS từ frontend/controller rải rác.
2. Provider chỉ nhận `contractor_identifier`/`tax_code`, query page nhỏ và post-filter exact. Không dùng tên làm khóa duy nhất.
3. Với một mã, chạy tối đa các query category cần thiết; không phân trang vô hạn. Nếu upstream báo còn nhiều trang bất thường sau khi đã exact-filter, dừng và `REVIEW_REQUIRED` thay vì crawl.
4. Với reputation, search trước rồi gọi detail chỉ cho ID đã exact-match để lấy `behaviorDate`.
5. Với termination, ưu tiên đường `get-list-violate` có filter identifier; không dùng current search theo tên để thay thế exact identity. Chỉ dùng current detail khi có ID/link xác định từ nguồn phù hợp.
6. Lưu raw normalized record và raw source timestamps, không chỉ boolean. Đánh giá lại theo `bid_closing_at` và rule version. Ba công thức thời gian là yêu cầu sản phẩm trong prompt, không phải kết luận được suy ra từ trạng thái “đang hiệu lực hôm nay”. Nguồn: [`prompt`, mục 5–6](./CODEX_PROMPT_TRA_CUU_VI_PHAM_NHA_THAU_BIEN_BAN_MO_THAU.md#L195-L331).
7. Chỉ `VIOLATION_CONFIRMED` mới tô đỏ. Missing date, identity conflict, timezone chưa rõ, schema drift, HTTP timeout/429/5xx, CAPTCHA/challenge, hoặc trạng thái hủy không rõ đều không tô đỏ.
8. Không gọi live source trong CI; dùng fixture đã redaction, tách fixture theo `source_schema_version` và ba nhóm dữ liệu.

## 5. Căn cứ pháp lý và điểm cần chủ sản phẩm xác nhận

Nghị định 214/2025/NĐ-CP có hiệu lực từ 04/08/2025 theo Cổng Thông tin điện tử Chính phủ. Tại thời điểm nghiên cứu, nguồn chính thức tìm thấy một **dự thảo** sửa đổi công bố tháng 06/2026, chưa tìm thấy văn bản sửa đổi đã ban hành; cần rà soát lại trước khi chốt `rule_version` production. [Nguồn văn bản chính thức](https://vanban.chinhphu.vn/?classid=1&docid=214821&orggroupid=2&pageid=27160), [nguồn dự thảo chính thức](https://vanban.chinhphu.vn/?pageid=30187&title=du-thao-nghi-dinh-sua-doi-bo-sung-mot-so-dieu-cua-nghi-dinh-so-214-2025-nd-cp-ngay-04-thang-8-na&vbid=7851).

Điều 20 khoản 1 Nghị định 214/2025 liệt kê các hành vi không bảo đảm uy tín khi tham dự thầu. Khoản 2 yêu cầu thông tin đăng tải nêu cụ thể ngày thực hiện hành vi và quy định thời hạn 02 năm kể từ lần cuối thực hiện hành vi đối với hệ quả được nêu tại điều này. Vì vậy `behaviorDate` và mốc 2 năm có căn cứ trực tiếp; ký hiệu biên half-open `[behavior_date, behavior_date + 2 calendar years)` vẫn là cách triển khai cụ thể do rule sản phẩm lựa chọn. Khoản 3(c) cũng xác nhận dữ liệu kết quả thực hiện hợp đồng có nội dung vi phạm hợp đồng, chấm dứt hợp đồng và lý do. [PDF ký chính thức Nghị định 214/2025, Điều 20, trang hiển thị 25–26](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/8/214nd.signed.pdf).

Nguồn Chính phủ về Nghị định 24/2024 xác nhận cơ sở dữ liệu nhà thầu bao gồm thông tin uy tín khi tham dự thầu và kết quả thực hiện hợp đồng; Thông tư 22/2024 quy định trách nhiệm cung cấp/đăng tải các thông tin này lên Hệ thống. Đây là căn cứ cho việc tra cứu từ VNEPS, không phải căn cứ để thay `behaviorDate` bằng `publicDate` hay suy diễn mã trạng thái. [Toàn văn Nghị định 24/2024 trên Cổng Chính phủ](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-quy-dinh-chi-tiet-mot-so-dieu-va-bien-phap-thi-hanh-luat-dau-thau-ve-lua-chon-nha-thau-119240310121301858.htm), [Toàn văn Thông tư 22/2024 trên Cổng Chính phủ](https://xaydungchinhsach.chinhphu.vn/toan-van-thong-tu-huong-dan-cung-cap-dang-tai-thong-tin-lua-chon-nha-thau-va-mau-ho-so-dau-thau-119240506113601282.htm).

Mốc `2 năm` từ ngày thực hiện hành vi có căn cứ tại Điều 20 Nghị định 214/2025 như trên; boundary chính xác ở thời điểm đủ 2 năm vẫn theo rule sản phẩm. Riêng mốc cố định `5 năm lịch` tính từ `issued_date` cho mọi record chấm dứt hợp đồng chưa được nghiên cứu này xác minh trực tiếp từ văn bản pháp luật, nên vẫn phải xem là rule do prompt quy định cho tới khi legal/business owner duyệt. Đồng thời cần duyệt bảng mapping `methodType`, `contractEndType`, status hủy và mốc ngày; trước đó provider phải fail closed về mặt hiển thị (`REVIEW_REQUIRED`, không tô đỏ), không fail open thành “không vi phạm”.

## Nguồn chính

- [Trang chính thức “Tổ chức, cá nhân vi phạm” của VNEPS](https://muasamcong.mpi.gov.vn/vi/web/guest/organizations-violators)
- [Trang chủ Hệ thống mạng đấu thầu quốc gia](https://muasamcong.mpi.gov.vn/vi/web/guest)
- [Nghị định 214/2025/NĐ-CP trên Cổng TTĐT Chính phủ](https://vanban.chinhphu.vn/?classid=1&docid=214821&orggroupid=2&pageid=27160)
- [Luật Đấu thầu 22/2023/QH15 trên Cổng Chính phủ](https://xaydungchinhsach.chinhphu.vn/toan-van-luat-dau-thau-119230728060101267.htm)
- [Nghị định 24/2024/NĐ-CP trên Cổng Chính phủ](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-quy-dinh-chi-tiet-mot-so-dieu-va-bien-phap-thi-hanh-luat-dau-thau-ve-lua-chon-nha-thau-119240310121301858.htm)
- [`backend/partners/partner_lookup_service.py`](../backend/partners/partner_lookup_service.py)
- [`backend/partners/address_routes.py`](../backend/partners/address_routes.py)
- [`frontend/partners/partnerTaxLookup.js`](../frontend/partners/partnerTaxLookup.js)
- [`frontend/packages/openingContractorLookup.js`](../frontend/packages/openingContractorLookup.js)
