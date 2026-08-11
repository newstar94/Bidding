# Audit chênh lệch capability Mua Sắm Công so với `WEB_DAU_THAU`

Ngày audit: 2026-08-11  
Phạm vi: chỉ đọc mã nguồn, không gọi mutation API, không sửa production code.

## Kết luận ngắn

Nhận định “Bidding chưa lấy được hết dữ liệu giống `WEB_DAU_THAU`” là **đúng**.

Phần session/token/cookie, transport protected/public và phần lớn endpoint catalog đã được port tương đương hoặc mạnh hơn. Tuy nhiên capability end-to-end vẫn nhỏ hơn source ở các điểm có thể làm mất dữ liệu thực tế:

1. `collectCompleteBundle()` không có current-record fallback cho plan/project/tender, nên có thể bỏ mất chính phiên bản người dùng chọn khi version-list rỗng, lỗi hoặc chưa chứa current ID.
2. Một lỗi detail của plan/project/tender có thể làm hỏng toàn bộ complete bundle; source gốc cô lập lỗi theo từng nguồn và vẫn trả phần đã lấy được.
3. Complete bundle không bảo toàn contract của source (`record`, `index`, per-source `endpoint/payload/success/data/error`, `summary`), và gộp opening/result thành bundle lồng nhau với key khác.
4. Search tích hợp chỉ hỗ trợ exact `PLAN`/`PACKAGE`; không còn keyword search, paging, contract, project và `all` như source.
5. Tender current-version thiếu nhánh eligibility `stepCode + isInternet`, nên có trường hợp source gốc lấy opening nhưng Bidding bỏ qua.
6. Result collector có nhận `hints`, nhưng đường gọi production `get_result_bundle()` không truyền search-record hints; nếu notice detail không chứa `inputResultId`/`techReqId`, nó trả bundle chỉ có notice detail.
7. Endpoint GET detail TBMT độc lập của source chưa có trong endpoint catalog/worker Bidding.

Vì các mục 1–5, chưa đủ bằng chứng để đánh dấu các tiêu chí “port nguyên complete collector”, “không lấy ít loại dữ liệu hơn source”, và “không giảm behavior” là hoàn thành.

## Nguồn chuẩn và cách đối chiếu

Nguồn chuẩn là `main` của repository tác giả, khóa tại commit:

```text
0ccebd94a7819413730778ee9dec517a016cfbd0
```

SHA được xác minh bằng:

```powershell
git ls-remote https://github.com/newstar94/WEB_DAU_THAU.git refs/heads/main
```

Các primary source được đọc:

- [`src/server.js` tại commit đã khóa](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js)
- [`src/services/mscTokenProvider.js` tại commit đã khóa](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/services/mscTokenProvider.js)
- [`src/public/index.html` tại commit đã khóa](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/public/index.html)
- Bidding local: [`endpoint_catalog.mjs`](../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs), [`collectors.mjs`](../../backend/integrations/muasamcong_browser/collectors.mjs), [`integration_runtime.mjs`](../../backend/integrations/muasamcong_browser/integration_runtime.mjs), [`browser_worker.mjs`](../../backend/integrations/muasamcong_browser/browser_worker.mjs), [`procurement_source.py`](../../backend/integrations/muasamcong_browser/procurement_source.py).

Yêu cầu gốc bắt buộc port nguyên complete collector tại `docs/PROMPT_CODEX_TICH_HOP_MUASAMCONG_WEB_DAU_THAU_VAO_BIDDING.md:L246-L270`, function mapping tại `L1570-L1592`, và coi task chưa hoàn thành nếu Bidding lấy ít loại dữ liệu hơn hoặc chỉ lấy latest tại `L1596-L1607`.

## Ma trận function-by-function

| Source function/capability | Bidding target | Trạng thái | Kết luận |
|---|---|---:|---|
| `buildMscHeaders()` | `buildHeaders()` | Đạt | Header, cookie mặc định, referer, user-agent tương đương. Source [`server.js:L66-L73`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L66-L73); target [`api_client.mjs:L5-L12`](../../backend/integrations/muasamcong_browser/api_client.mjs#L5). |
| `callProtectedMscApi()` | `MscApiClient._request()` | Đạt/cải thiện | Token query, cookie và refresh-once 400/401/403 được giữ; target thêm timeout/retry/size/concurrency. Source [`server.js:L94-L115`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L94-L115); target [`api_client.mjs:L168-L260`](../../backend/integrations/muasamcong_browser/api_client.mjs#L168). |
| `callPublicMscApi()` | public endpoint flag trong catalog/client | Đạt | Public endpoints không acquire session. Source [`server.js:L118-L125`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L118-L125); target [`api_client.mjs:L169-L177`](../../backend/integrations/muasamcong_browser/api_client.mjs#L169). |
| `mscTokenProvider` | `MscSessionProvider` | Đạt/cải thiện | Launch args, UA, CSP, network token, click-search, direct reCAPTCHA, cookie, 30-minute TTL và cleanup đều hiện diện; target sửa single-flight thật. Source [`mscTokenProvider.js:L31-L235`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/services/mscTokenProvider.js#L31-L235); target [`session_provider.mjs:L19-L253`](../../backend/integrations/muasamcong_browser/session_provider.mjs#L19). |
| `fetchPlanVersions()` / `fetchPlanDetail()` | `listPlanRevisions()` / `getPlanRevision()` | Đạt ở API đơn lẻ | Hai endpoint đúng, nhưng complete collector không bảo toàn current fallback và partial behavior. Source [`server.js:L132-L148`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L132-L148); target [`collectors.mjs:L165-L189`](../../backend/integrations/muasamcong_browser/collectors.mjs#L165). |
| `createCompleteBundle()` | object trả từ `collectCompleteBundle()` | **Không đạt** | Target bỏ `record`, `index`, source envelopes và `summary`. Source [`server.js:L150-L164`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L150-L164); target [`collectors.mjs:L499-L505`](../../backend/integrations/muasamcong_browser/collectors.mjs#L499). |
| `captureBundleSource()` | local `capture()` và direct calls | **Không đạt** | Source luôn tạo entry trước request, lưu endpoint/payload/success/data/error, bắt lỗi và tiếp tục. Target `capture()` chỉ lưu data khi thành công; plan/project/tender detail còn gọi ngoài `capture()`. Source [`server.js:L167-L187`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L167-L187); target [`collectors.mjs:L379-L387`](../../backend/integrations/muasamcong_browser/collectors.mjs#L379). |
| `finalizeCompleteBundle()` | `failures` + `partial` | **Không tương đương** | Target có classification/failed operations nhưng không có `totalSources`, `completeSources`, `failedSources`, cũng không giữ failed entry trong `sources`. Source [`server.js:L189-L196`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L189-L196); target [`procurement_source.py:L505-L516`](../../backend/integrations/muasamcong_browser/procurement_source.py#L505). |
| `collectVersionedDetails()` | các loop riêng theo type | **Không đạt** | Shared fallback `currentId` và per-version error isolation bị mất. Source [`server.js:L199-L235`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L199-L235); target [`collectors.mjs:L389-L406`](../../backend/integrations/muasamcong_browser/collectors.mjs#L389). |
| `collectPlanCompleteBundle()` | plan branch | Một phần | Lấy các revisions do version-list trả, nhưng không thêm `record.id` nếu thiếu và không lưu version-list source/index. Source [`server.js:L238-L250`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L238-L250); target [`collectors.mjs:L389-L395`](../../backend/integrations/muasamcong_browser/collectors.mjs#L389). |
| `collectProjectCompleteBundle()` | project branch | Một phần | Endpoint/version loop có, nhưng cùng thiếu current fallback, version-list source/index và isolation. Source [`server.js:L253-L265`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L253-L265); target [`collectors.mjs:L396-L406`](../../backend/integrations/muasamcong_browser/collectors.mjs#L396). |
| `collectLdtBidOpening()` | `getOpeningBundle()`/`collectPackType()` | Gần đạt | Đủ 5 endpoint và financial packType 2 gate. Còn gap eligibility ở caller complete bundle và structure bị lồng/đổi key. Source [`server.js:L268-L284`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L268-L284); target [`collectors.mjs:L256-L307`](../../backend/integrations/muasamcong_browser/collectors.mjs#L256). |
| `collectTenderCompleteBundle()` | tender branch | **Một phần, có mất dữ liệu** | Details nhiều revisions có, nhưng thiếu current fallback, thiếu `stepCode + isInternet` gate, có thể abort khi detail lỗi, opening/result bị gộp và index/provenance mất. Source [`server.js:L287-L417`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L287-L417); target [`collectors.mjs:L407-L453`](../../backend/integrations/muasamcong_browser/collectors.mjs#L407). |
| `collectContractCompleteBundle()` | contract branch | Dữ liệu đạt, envelope không đạt | Điều kiện linked tender/HSMT/offline result tương đương, nhưng key `contractLinkedData` đổi thành `contractLinked` và mất per-source envelope. Source [`server.js:L419-L456`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L419-L456); target [`collectors.mjs:L454-L491`](../../backend/integrations/muasamcong_browser/collectors.mjs#L454). |
| `collectGenericCompleteBundle()` | generic branch | Dữ liệu đạt, envelope không đạt | 12 type/endpoint được port; output metadata không tương đương. Source [`server.js:L47-L60`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L47-L60), [`server.js:L458-L463`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L458-L463); target [`collectors.mjs:L121-L134`](../../backend/integrations/muasamcong_browser/collectors.mjs#L121), [`collectors.mjs:L492-L495`](../../backend/integrations/muasamcong_browser/collectors.mjs#L492). |
| `/api/search` | `search()` + worker lookup | **Không đạt breadth** | Source keyword/paging: tender/plan/contract/all (all gồm project). Target page 0, exact code, chỉ PLAN/PACKAGE. Source [`server.js:L471-L529`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L471-L529); target [`collectors.mjs:L90-L106`](../../backend/integrations/muasamcong_browser/collectors.mjs#L90), [`collectors.mjs:L156-L162`](../../backend/integrations/muasamcong_browser/collectors.mjs#L156), [`browser_worker.mjs:L56-L68`](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L56). |
| `/api/detail/tbmt` GET | Không có operation tương ứng | **Thiếu** | Source có route tới `/expose/lcnt/bid-notify-contractor/get-by-id` với `id`, optional `notifyId`, `stepCode`, token/cookie. Source [`server.js:L575-L590`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L575-L590); target catalog [`endpoint_catalog.mjs:L7-L143`](../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs#L7) không có endpoint này và client hiện chỉ POST [`api_client.mjs:L188-L193`](../../backend/integrations/muasamcong_browser/api_client.mjs#L188). |
| `/api/detail/khlcnt/versions` | list/get plan revisions | Đạt về data | Bidding tách list và detail; source route dedupe và trả per-version success/error, target consumer chịu trách nhiệm orchestration. Source [`server.js:L594-L647`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L594-L647). |

## Các gap gây thiếu dữ liệu cụ thể

### P0 — Complete bundle không còn current fallback

Source shared collector thêm `currentId` vào version list khi upstream version-list chưa chứa nó, rồi vẫn gọi detail cho current record. Với tender, source làm tương tự bằng `notifyId`. Đây không chỉ là metadata: nó quyết định có lấy được JSON của bản người dùng vừa chọn hay không.

- Plan/project source: [`server.js:L212-L218`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L212-L218).
- Tender source: [`server.js:L315-L325`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L315-L325).
- Target plan/project chỉ duyệt rows từ list response: [`collectors.mjs:L389-L406`](../../backend/integrations/muasamcong_browser/collectors.mjs#L389).
- Target tender chỉ duyệt `listNoticeRevisions()`: [`collectors.mjs:L407-L412`](../../backend/integrations/muasamcong_browser/collectors.mjs#L407).

Hệ quả chắc chắn theo control flow:

```text
version-list = [] hoặc không có current ID
WEB_DAU_THAU  -> append current ID -> fetch current detail
Bidding       -> loop 0 lần         -> không có current detail
```

Đây là gap P0 vì vi phạm trực tiếp mục tiêu “một mã → toàn bộ version → detail từng version”, đồng thời có thể trả bundle gần như chỉ chứa search record.

### P0 — Một detail lỗi có thể làm mất toàn bộ bundle

Source gọi mọi detail qua `captureBundleSource()`, bắt exception tại từng source và trả `null`; `finalizeCompleteBundle()` vẫn trả các nguồn thành công cùng failed count ([`server.js:L167-L196`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L167-L196)).

Target chỉ dùng helper bắt lỗi cho contract/generic. Các nhánh sau gọi hàm có thể throw trực tiếp ngoài `capture()`:

- plan: [`collectors.mjs:L390-L395`](../../backend/integrations/muasamcong_browser/collectors.mjs#L390);
- project: [`collectors.mjs:L397-L405`](../../backend/integrations/muasamcong_browser/collectors.mjs#L397);
- tender: [`collectors.mjs:L408-L412`](../../backend/integrations/muasamcong_browser/collectors.mjs#L408).

Hệ quả: nếu revision 02 thành công nhưng revision 01 lỗi, source gốc trả partial bundle; target có thể throw và caller không nhận revision 02 đã tải. Đây là mất dữ liệu do orchestration, không phải chỉ khác DTO.

### P0 — Complete bundle structure/provenance không được bảo toàn

Contract thực tế của source gồm:

```json
{
  "type": "...",
  "fetchedAt": "...",
  "record": {},
  "index": { "versions": [] },
  "sources": {
    "sourceKey": {
      "endpoint": "...",
      "payload": {},
      "success": true,
      "data": {},
      "error": "..."
    }
  },
  "summary": {
    "totalSources": 0,
    "completeSources": 0,
    "failedSources": 0
  }
}
```

Source tạo shape tại [`server.js:L150-L196`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L150-L196), ghi version linkage vào `index.versions` tại [`server.js:L223-L234`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L223-L234) và tender linkage tại [`server.js:L330-L415`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L330-L415). Frontend source thực sự dereference `index`, `source.success`, `source.data`, `source.error`, `summary` tại [`index.html:L926-L993`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/public/index.html#L926-L993).

Target Node trả `{type, fetchedAt, sources, failures, fingerprint}` và Python trả `{schemaVersion, type, fetchedAt, ..., sources}`; không có `record`, `index`, `summary`, endpoint/payload/success envelope ([`collectors.mjs:L375-L505`](../../backend/integrations/muasamcong_browser/collectors.mjs#L375), [`procurement_source.py:L498-L518`](../../backend/integrations/muasamcong_browser/procurement_source.py#L498)).

Payload JSON thành công phần lớn vẫn còn, nhưng:

- failed source biến mất khỏi `sources`;
- không thể map version → exact source/opening/result bằng `index`;
- không biết endpoint/payload nào tạo payload;
- không thể tính completeness giống source;
- key bị đổi (`contractLinkedData` → `contractLinked`) hoặc bị lồng (`tenderOpening_*...` → `noticeOpening_*` chứa một raw opening bundle).

Vì vậy tuy tên method là `collectCompleteBundle`, nó chưa bảo toàn “complete-bundle structure” của source.

### P1 — Search nhỏ hơn source và làm các collector không tự khởi phát được

Source nhận keyword, page number, page size và type filters:

- `tbmt` → tender;
- `khlcnt` → plan;
- `hopdong` → contract;
- `all` → tender + plan + contract + project.

Xem [`server.js:L471-L529`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L471-L529).

Target collector hard-code page `0`, size `20`, một type và exact-match record; mọi kind khác PLAN được xem như tender ([`collectors.mjs:L90-L106`](../../backend/integrations/muasamcong_browser/collectors.mjs#L90), [`collectors.mjs:L156-L162`](../../backend/integrations/muasamcong_browser/collectors.mjs#L156)). Worker còn reject mọi kind ngoài `PLAN`/`PACKAGE` và chỉ nhận mã `PL##########`/`IB##########` ([`browser_worker.mjs:L56-L68`](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L56)). Python lookup cũng chỉ có hai branch ([`procurement_source.py:L523-L602`](../../backend/integrations/muasamcong_browser/procurement_source.py#L523)).

Contract/project/generic complete branches tồn tại nhưng cần caller đã có sẵn raw search record. Repo-wide search ngày audit không thấy production caller cho `collect_complete_bundle()`; chỉ có wrapper và tests. Do đó chúng là internal dormant capability, không thay thế breadth của source search.

Lệnh bằng chứng âm:

```powershell
rg -n "collect_complete_bundle\(" backend frontend views scripts
```

chỉ trả declaration/wrapper trong `launchers.py`, `procurement_source.py`, protocol `procurement_import/source.py`; không có route/service consumer. `get_result_bundle()` cũng không có production caller. Opening là ngoại lệ: route gọi tại `backend/procurement_import/routes.py:L351`.

### P1 — Thiếu nhánh opening eligibility của current tender

Source cho phép load opening khi một trong các điều kiện đúng:

1. detail có `successBidOpenDate`;
2. detail status thuộc `OPEN_BID`, `OPEN_DXKT`, `OPEN_DXTC`, `PUB_KQLCNT`;
3. current record có `bidOpenId`;
4. current record có `stepCode` thuộc ba opening/result steps **và** `isInternet === 1`.

Xem [`server.js:L302-L307`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L302-L307), [`server.js:L362-L365`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L362-L365).

Target complete branch chỉ có điều kiện 1/2 và current `bidOpenId`; không có điều kiện 4 ([`collectors.mjs:L413-L419`](../../backend/integrations/muasamcong_browser/collectors.mjs#L413)). Vì vậy current TBMT ở đúng workflow step nhưng chưa có `bidOpenId` trong search record sẽ được source thử lấy opening, còn target bỏ qua hoàn toàn.

Ngoài ra source đọc status từ object `bidoBidStatus` cụ thể ([`server.js:L338-L343`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L338-L343)); target dùng `findFirstValue(detail.raw, "status")` trên toàn cây ([`collectors.mjs:L413-L415`](../../backend/integrations/muasamcong_browser/collectors.mjs#L413)). Nếu payload có nhiều field `status`, target có thể lấy status không thuộc bid-opening object. Đây là simplification làm tăng nguy cơ false negative/positive.

### P1 — Result path có thể không lấy result IDs từ search record

Source complete collector dùng trực tiếp `record.inputResultId` và `record.techReqId`, tức IDs từ search result, rồi chỉ tải result cho current record ([`server.js:L395-L413`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L395-L413)).

Target collector cũng hỗ trợ `hints` và complete path có truyền `record` ([`collectors.mjs:L327-L360`](../../backend/integrations/muasamcong_browser/collectors.mjs#L327), [`collectors.mjs:L433-L444`](../../backend/integrations/muasamcong_browser/collectors.mjs#L433)); nhánh này tương đương.

Nhưng direct production source gọi runtime chỉ với `(notice_no, revision_id)` ([`procurement_source.py:L465-L480`](../../backend/integrations/muasamcong_browser/procurement_source.py#L465)), launcher/worker không có hints, và runtime gọi collector không có hints ([`integration_runtime.mjs:L78-L81`](../../backend/integrations/muasamcong_browser/integration_runtime.mjs#L78), [`browser_worker.mjs:L123-L132`](../../backend/integrations/muasamcong_browser/browser_worker.mjs#L123)). Do đó direct `get_result_bundle()` chỉ lấy selection/technical result nếu `_noticeDetail()` tình cờ chứa hai IDs. Nếu IDs chỉ có trên search record — chính shape mà source code đã dự phòng — target trả thành công nhưng `hasSelectionResult=false`, `hasTechnicalResult=false` mà không hề thử endpoint kết quả.

Test hiện tại không bắt gap này vì mock notice detail chủ động nhét cả hai ID tại `tests/js/muasamcong_session_transport.test.mjs:L366-L400`.

### P2 — Thiếu standalone TBMT GET detail endpoint

Source có một capability riêng, khác endpoint POST dùng trong complete collector:

```text
GET /expose/lcnt/bid-notify-contractor/get-by-id
query: id, notifyId?, stepCode?, token?
headers: cookie, referer
```

Xem [`server.js:L575-L590`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L575-L590). Catalog Bidding không có operation này ([`endpoint_catalog.mjs:L7-L143`](../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs#L7)), và API client hiện luôn POST JSON ([`api_client.mjs:L188-L193`](../../backend/integrations/muasamcong_browser/api_client.mjs#L188)).

Frontend source hiện dùng complete endpoint để mở detail ([`index.html:L896-L923`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/public/index.html#L896-L923)), nên thiếu này không chặn main complete flow. Tuy vậy nó vẫn là một exported source API capability chưa port, nên không thể tuyên bố endpoint parity tuyệt đối.

## Những phần không thiếu

Để tránh kết luận quá rộng, audit xác nhận các phần sau đã tương đương:

- Toàn bộ endpoint đang dùng bởi plan/project/tender opening/results/contracts/generic complete collectors đã có trong catalog, ngoại trừ standalone GET TBMT vừa nêu. So sánh source [`server.js:L18-L60`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/server.js#L18-L60) với target [`endpoint_catalog.mjs:L7-L143`](../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs#L7).
- LDT opening gọi đủ notify/round/bid/lot/lot-detail.
- `1_MTHS` dùng technical `packType=0`; mode khác dùng `1`.
- Financial `packType=2` chỉ được gọi cho `1_HTHS` sau `OPEN_DXTC`/`PUB_KQLCNT`.
- KHAC/ADB/WB có detail và opening riêng.
- Contract condition cho online linked tender/HSMT và offline selection result được giữ.
- 12 generic detail mappings khớp source.
- Session provider không phải nguyên nhân chính của thiếu data trong code hiện tại; behavior gốc đã được giữ và single-flight được cải thiện.

## Vì sao người dùng nhìn thấy ít dữ liệu hơn dù raw collector tồn tại

Public/business methods cho plan, notice, opening và result đi qua parser canonical rồi chỉ trả stable DTO. Ví dụ `get_plan_revision()` lấy `result.raw` nhưng trả `canonical` tại [`procurement_source.py:L334-L354`](../../backend/integrations/muasamcong_browser/procurement_source.py#L334); notice tương tự tại [`procurement_source.py:L395-L415`](../../backend/integrations/muasamcong_browser/procurement_source.py#L395). Đây là chủ đích đúng với canonical-contract requirement, không tự nó là bug.

Tuy nhiên source gốc có “Toàn bộ bundle JSON” và dùng exact per-source envelopes/index trong UI ([`index.html:L950-L1019`](https://github.com/newstar94/WEB_DAU_THAU/blob/0ccebd94a7819413730778ee9dec517a016cfbd0/src/public/index.html#L950-L1019)). Prompt cũng nói không port nguyên frontend source, nên Bidding không bắt buộc sao chép inspector đó. Vấn đề là raw complete capability nội bộ hiện vừa không được production flow gọi, vừa không bảo toàn structure/resilience của source. Vì vậy cảm nhận “không thấy hết dữ liệu” có cả hai nguyên nhân:

1. **Khác presentation có chủ đích:** canonical DTO chỉ surfacing field nghiệp vụ cần thiết.
2. **Gap retrieval thật:** current fallback, fault isolation, opening eligibility và search breadth bị giảm.

## Mức độ nghiêm trọng và thứ tự sửa đề xuất

| Mức | Gap | Ảnh hưởng |
|---|---|---|
| P0 | Khôi phục shared `collectVersionedDetails` semantics: current fallback + capture per source | Ngăn bỏ current revision và ngăn một revision lỗi làm mất toàn bundle. |
| P0 | Khôi phục normalized complete-bundle contract hoặc định nghĩa contract mới có mapping tương đương | Giữ đầy đủ raw/provenance/index/completeness; test được parity. |
| P1 | Khôi phục search breadth hoặc cung cấp semantic equivalents cho contract/project/all/paging | Bidding không còn lấy ít record types hơn source. |
| P1 | Port exact current `stepCode + isInternet` opening gate và đọc exact bid-status object | Tránh bỏ biên bản mở thầu đủ điều kiện. |
| P1 | Truyền result hints/search record xuyên Python → launcher → worker → runtime → collector | Selection/technical results không phụ thuộc detail có lặp ID. |
| P2 | Thêm standalone GET TBMT operation nếu vẫn coi mọi exported source route là capability phải port | Đạt endpoint parity đầy đủ. |
| P2 | Thêm contract tests từ source behavior, không chỉ kiểm tra endpoint tồn tại | Ngăn regression “code có branch nhưng semantics khác source”. |

## Test parity còn thiếu

Các test nên chứng minh trực tiếp bốn tình huống mà code hiện tại chưa bảo đảm:

1. version-list không chứa current ID → current detail vẫn được fetch;
2. một revision detail lỗi → bundle vẫn trả các revisions thành công và failed envelope;
3. current tender chỉ có eligible `stepCode`, `isInternet=1`, không có `bidOpenId` → opening vẫn được fetch;
4. notice detail không có result IDs, search record có IDs → selection và technical endpoint vẫn được fetch.

Test hiện có “complete tender bundle” tại `tests/js/muasamcong_session_transport.test.mjs:L440-L475` mock list revisions đã đầy đủ và mọi detail đều thành công, nên không phát hiện ba gap đầu. Test result tại `L366-L400` nhét IDs vào detail, nên không phát hiện gap thứ tư.

## Phán quyết audit

```text
Session/token/cookie parity                 PASS
Protected/public transport parity           PASS
Main collector endpoint coverage            PASS (trừ standalone GET TBMT)
Plan/project/tender complete semantics       FAIL
Complete-bundle structure/provenance         FAIL
Search record-type breadth                   FAIL
Opening main endpoint set                    PASS
Opening eligibility parity                   FAIL (một nhánh current record)
Result complete-path with search hints       PASS
Direct result-path hint propagation          FAIL
Contract/generic endpoint logic              PASS, nhưng dormant/khác envelope
```

Kết luận cuối: implementation hiện tại là một nền retrieval tốt cho Plan/Package import và Opening, nhưng **chưa đạt capability tối thiểu bằng `WEB_DAU_THAU` function-by-function**. Đây không phải chỉ là cảm giác do UI hiển thị canonical fields; có các control-flow gap cụ thể làm bỏ request hoặc làm mất partial bundle.
