# KẾ HOẠCH VÀ PROMPT NHẬP KHLCNT, GÓI THẦU VÀ PHIÊN BẢN TỪ MUA SẮM CÔNG

Ngày cập nhật: 10/08/2026
Repository: newstar94/Bidding
Phạm vi: BiddingFlow — nhập KHLCNT theo bundle, gói thầu con, thông báo liên kết và đối chiếu phiên bản
Trạng thái: Đặc tả triển khai; connector production còn phụ thuộc API/quyền truy cập hợp lệ từ Mua Sắm Công

Tài liệu nghiên cứu nguồn bắt buộc:

- [Nghiên cứu KHLCNT, gói thầu liên kết và phiên bản](./research/MUASAMCONG_KHLCNT_GOI_THAU_PHIEN_BAN_2026-08-10.md)
- [Mô hình miền BiddingFlow](../CONTEXT.md)

## 1. Kết quả đã chốt

Khi người dùng nhập mã KHLCNT dạng PL..., BiddingFlow có thể:

1. Tra danh sách phiên bản nguồn của kế hoạch.
2. Tải đúng snapshot của phiên bản được chọn.
3. Lấy toàn bộ gói trong tab **Thông tin gói thầu**.
4. Tạo kế hoạch cùng các gói nền sau một bước preview và xác nhận.
5. Nếu gói có **Số thông báo liên kết**, làm giàu chính gói đó từ thông báo; không tạo gói thứ hai.
6. Nếu chưa có thông báo liên kết, vẫn tạo được gói từ dữ liệu cấp kế hoạch khi đủ trường bắt buộc.
7. Khi nguồn có revision mới, đối chiếu gói giữ nguyên, thay đổi, mới, bị loại và mơ hồ trước khi tạo phiên bản nội bộ.

Tính năng không âm thầm lưu ngay khi người dùng vừa gõ mã. Chuỗi đúng là:

    nhập mã → chuẩn bị dữ liệu → preview → xử lý cảnh báo/xung đột
    → người dùng xác nhận → server commit nguyên tử

### 1.1. Trả lời chính xác tình huống 00 → 01

Quy tắc hiện tại của BiddingFlow không chạy lockstep giữa phiên bản kế hoạch và phiên bản gói:

| Tình huống | Kết quả nội bộ theo rule hiện tại |
|---|---|
| Kế hoạch 00 có gói A phiên bản 00 | A thuộc snapshot kế hoạch 00 |
| Kế hoạch lên 01, A không đổi | Tạo row snapshot mới của A trong kế hoạch 01 nhưng A vẫn mang phiên bản gói 00 |
| Kế hoạch lên 01, A thay đổi thật | Tạo package version 01 cho A bằng package-version rule |
| Kế hoạch 01 có thêm gói B | B là dòng gói mới, bắt đầu ở phiên bản 00 |
| A bị loại khỏi kế hoạch 01 | Không clone A sang snapshot 01; giữ nguyên lịch sử ở kế hoạch 00 |

Bốn bộ đếm sau độc lập:

    planVersion nguồn
    phienBan kế hoạch nội bộ BiddingFlow
    phienBan gói nội bộ BiddingFlow
    notifyVersion nguồn

Không được gán bằng nhau. Nếu lần đầu nhập ngay planVersion nguồn 03, kế hoạch nội bộ đầu tiên vẫn là phiên bản 00 và provenance ghi externalPlanVersion = 03.

Nếu yêu cầu sản phẩm là “mọi gói đang có đều phải tăng 00 → 01 chỉ vì kế hoạch tăng 00 → 01”, đó là thay đổi mô hình miền, trái với code và test hiện tại. Không thực hiện thay đổi này nếu chưa có ADR và xác nhận riêng.

### 1.2. Quy tắc backfill và phiên bản thủ công xen giữa

Chế độ toàn bộ lịch sử chỉ được materialize thành các phiên bản local theo thứ tự cũ → mới khi dòng kế hoạch local chưa tồn tại. Sau khi một source revision đã được áp dụng, không chèn source revision cũ hơn vào trước và không renumber lịch sử local.

Ví dụ source revision 03 đã được nhập thành local plan 00:

- source 00–02 được phép tải và lưu dạng provenance OBSERVED_NOT_APPLIED để tra cứu;
- source 00–02 không được tạo thành local plan version mới hoặc rebuild dòng hiện hữu;
- source 04 về sau tạo phiên bản kế hoạch local kế tiếp theo rule nội bộ.

Nếu có phiên bản local do người dùng tạo xen giữa hai source revision, source revision mới luôn kế thừa từ local latest. Ví dụ source 00 → local 00, người dùng sửa → local 01, source 01 đến sau → local 02. Provenance giữ mapping; không ép số source và local trùng nhau.

## 2. Bằng chứng từ Mua Sắm Công

### 2.1. Danh sách và chi tiết gói

Trang KHLCNT chính thức có hai tab **Thông tin chung** và **Thông tin gói thầu**. Danh sách gói nằm ở:

    detailKhlcntRes.bidpPlanDetailToProjectList

Mỗi dòng có idDetail; click tên gói gọi:

    loadPkgDetail(bpd.idDetail, bpd.bidEstimatePrice)

Các trường quan sát được ở cấp kế hoạch/gói gồm tên gói, số hiệu gói, tóm tắt công việc, giá, dự toán sau phê duyệt kế hoạch, nguồn vốn, lĩnh vực, hình thức, phương thức, thời gian tổ chức, thời điểm bắt đầu, loại hợp đồng, thời gian thực hiện, phần/lô và tùy chọn mua thêm.

Ví dụ first-party:

- [KHLCNT PL2400239107](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=f55c73ab-ed0f-4427-8ce4-15e57d5ed7f5&planNo=PL2400239107&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p)
- [KHLCNT có nhiều phiên bản PL2400213559](https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&id=1005fcf6-c617-462d-8f0c-f50d763ea0f7&planNo=PL2400213559&step=tbmt&stepCode=plan-step-1&type=es-plan-project-p)

### 2.2. Số thông báo liên kết

Nguồn hiển thị số liên kết từ:

    JSON.parse(bpd.linkNotifyInfo).notifyNo

Khi không có linkNotifyInfo, portal có thể hiển thị **Chưa có TBMT**. Khi click mã liên kết, portal tìm loại es-notify-contractor trước rồi fallback es-pre-notify-contractor. Vì vậy một liên kết phải có:

    noticeNo
    noticeKind = TBMT | PRE_NOTIFY | UNKNOWN
    noticeRevisionId = nullable
    noticeVersion = nullable

Chỉ noticeNo được chứng minh trực tiếp khi JSON hợp lệ. noticeKind mặc định UNKNOWN; noticeRevisionId và noticeVersion phải nullable cho đến khi resolve exact loại thông báo và version-list tương ứng. PRE_NOTIFY chưa có version endpoint được nghiên cứu này xác nhận.

Không được mặc định mọi liên kết đều là TBMT hoặc luôn có revision metadata.

### 2.3. Hai dòng phiên bản nguồn riêng

Danh sách phiên bản KHLCNT:

    POST /o/egp-portal-contractor-selection-v2/services/expose/lcnt/
         bid-po-bidp-plan-project-view/get-version-list
    Body: {planNo:PL...}

Response có planNo, planVersion và UUID id. Một mẫu xác nhận endpoint nhận mã cơ sở nhưng trả rỗng với mã có hậu tố. Adapter tách base candidate + requested revision, gọi theo base candidate rồi exact-validate planNo/revision trả về và tự sort số phiên bản. Không coi việc bỏ hậu tố là contract phổ quát cho mọi phân hệ; fallback bằng input nguyên chỉ được dùng khi capability của provider đã được contract-test trên nhiều mẫu.

Danh sách phiên bản thông báo:

    POST /o/egp-portal-contractor-selection-v2/services/expose/lcnt/
         bid-po-bido-notify-contractor-view/get-version-list
    Body: {notifyNo:IB...}

Response có notifyNo, notifyVersion và UUID id.

### 2.4. Giới hạn quan trọng

Các endpoint chi tiết kế hoạch, chi tiết gói, chi tiết thông báo và tìm kiếm notifyNo hiện được frontend chính thức bọc bằng reCAPTCHA. Hai endpoint version-list quan sát được không cần token, nhưng điều đó không tạo thành cam kết API/SLA cho bên thứ ba.

Không bypass, giải hộ, tái sử dụng token hoặc giả lập CAPTCHA. Connector production chỉ được bật khi có API/quyền truy cập hợp lệ hoặc văn bản chấp thuận cách tích hợp.

## 3. Thuật ngữ và định danh

### 3.1. Kế hoạch

- Dòng kế hoạch nguồn: planNo cơ sở, ví dụ PL2600163819.
- Revision kế hoạch nguồn: bộ ba planNo + planVersion + revision UUID.
- Dòng kế hoạch nội bộ: rootId của BiddingFlow.
- Phiên bản kế hoạch nội bộ: phienBan của BiddingFlow.

### 3.2. Gói thầu

- Observation gói nguồn: một dòng gói trong một revision kế hoạch, nhận diện chính xác bằng planRevisionId + idDetail.
- Dòng gói nội bộ: rootId của BiddingFlow.
- Phiên bản gói nội bộ: phienBan trong phạm vi snapshot kế hoạch.
- Số hiệu gói: bidPackageSymbol; không phải mã TBMT và chưa được chứng minh duy nhất xuyên revision.
- STT: chỉ để hiển thị; cấm dùng làm identity.

idDetail là lookup key chắc chắn cho một observation, nhưng chưa có bằng chứng nó ổn định xuyên planVersion. Không dùng idDetail một mình làm khóa dòng gói.

### 3.3. Thông báo liên kết

- Dòng thông báo nguồn: notifyNo.
- Revision thông báo nguồn: notifyNo + notifyVersion + revision UUID.
- Thông báo liên kết là lớp enrichment của dòng gói, không thay thế dòng gói.

## 4. Phạm vi triển khai

### 4.1. Bắt buộc

- Nhận PL... và IB..., không phân biệt hoa/thường.
- Tách mã cơ sở và hậu tố phiên bản, giữ input gốc trong preview.
- PL lookup trả danh sách source revision và cho chọn **mới nhất**, **một revision cụ thể** hoặc **toàn bộ lịch sử**.
- Mặc định chọn revision mới nhất.
- Tải kế hoạch và toàn bộ package observation của revision được chọn.
- Preview kế hoạch, gói, notice link, mapping, cảnh báo, conflict và trường bắt buộc.
- Tạo bundle kế hoạch + gói sau xác nhận.
- Enrich thông báo vào đúng gói.
- Lưu provenance và binding lâu dài.
- Reimport cùng revision/digest là no-op.
- Revision mới đi qua command đối chiếu nguyên tử.
- Mọi thay đổi chỉ dùng field ownership đã định nghĩa; không ghi đè dữ liệu nội bộ.
- Khi chưa có dòng local, import toàn bộ lịch sử xử lý source revision theo thứ tự số tăng dần.
- Khi đã có dòng local, revision nguồn cũ hơn revision đã áp dụng chỉ được backfill provenance; chỉ revision nguồn mới hơn mới được materialize tiếp.
- Mỗi revision được materialize trong chế độ toàn bộ lịch sử là một transaction nguyên tử; operation có cursor, kết quả từng revision và có thể resume bằng idempotency.

### 4.2. Vẫn hỗ trợ lookup một gói theo IB

IB lookup dùng cùng nguồn chuẩn hóa và preview. Nếu notifyNo đã được binding với gói thuộc kế hoạch, enrich gói đó. Nếu chưa có gói:

- resolve planNo và package observation tương ứng nếu nguồn cho phép;
- không tạo gói rời khỏi KHLCNT một cách mơ hồ;
- nếu không resolve chắc chắn, yêu cầu người dùng chọn kế hoạch/gói hoặc dừng.

### 4.3. Ngoài phạm vi

- Tự tạo chủ đầu tư chỉ từ tên gần giống.
- Tự nhập nhà thầu trúng thầu, hợp đồng hoặc kết quả lựa chọn nhà thầu.
- Poll định kỳ không có thao tác người dùng.
- Browser scraping production.
- CAPTCHA bypass.
- Lưu raw upstream payload.
- Fuzzy-match tự động bằng tên/giá/STT.
- Đồng bộ lockstep planVersion = packageVersion = notifyVersion.

## 5. Luồng UX đề xuất

### 5.1. Wizard nhập KHLCNT

1. Người dùng mở form tạo kế hoạch và nhập PL....
2. Sau debounce hoặc Enter/blur, frontend gọi prepare.
3. Hiển thị các revision nguồn; mặc định revision mới nhất.
4. Người dùng chọn:
   - chỉ revision đang chọn;
   - toàn bộ lịch sử từ cũ đến mới.
   - nếu dòng local đã tồn tại, wizard đánh dấu revision cũ là **Chỉ lưu provenance**, không cho chèn vào lịch sử local.
   - nếu dòng local chưa tồn tại nhưng người dùng chọn latest/selected trong khi có revision cũ hơn, wizard cảnh báo rằng các revision cũ chỉ có thể backfill provenance sau lần commit này và đề nghị chọn ALL ngay nếu muốn materialize lịch sử.
5. Wizard hiển thị thông tin kế hoạch và yêu cầu match chủ đầu tư exact.
6. Tab **Các gói thầu** hiển thị toàn bộ gói với trạng thái:
   - NEW;
   - UNCHANGED;
   - CHANGED;
   - REMOVED;
   - AMBIGUOUS;
   - ALREADY_IMPORTED.
7. Mỗi gói hiển thị tên, số hiệu, giá, notice state, notice number, source revision, local target và số field thay đổi.
8. Gói mơ hồ bắt buộc người dùng chọn dòng gói cũ hoặc xác nhận **Đây là gói mới**.
9. Gói thiếu field bắt buộc phải được bổ sung; không dùng giá trị giả.
10. Chuyên viên phụ trách mặc định là người import cho bản ghi mới. Snapshot gói được kế thừa giữ assignment hợp lệ.
11. Preview cuối hiển thị tổng số kế hoạch/gói/phiên bản sẽ tạo, gói bị loại, conflict và warning.
12. Người dùng bấm **Nhập kế hoạch và gói thầu**.
13. Frontend gọi apply với previewId, idempotency key và expected row versions.
14. Với selected/latest, server trả authoritative delta; với ALL, server trả operationId và tiến độ theo revision.
15. Frontend hydrate kết quả đã commit, theo dõi hoặc resume operation rồi mở kế hoạch vừa nhập.

### 5.2. Enrichment thông báo

Prepare cố gắng tải revision thông báo mới nhất cho từng notice link. Nếu nguồn detail không khả dụng:

- bundle kế hoạch và gói nền vẫn có thể được xác nhận;
- lưu noticeNo, noticeKind, revision-list và warning;
- giữ trạng thái gói an toàn;
- cho phép **Làm giàu lại** sau.

Không để lỗi một notice làm mất toàn bộ danh sách package base đã lấy hợp lệ, trừ khi người dùng chọn chế độ bắt buộc enrichment đầy đủ.

### 5.3. Quy tắc ghi đè

Preview dùng merge ba phía:

    last imported canonical value
    current local value
    new source value

- Local không đổi, source đổi: cho phép apply source.
- Local đổi, source không đổi: giữ local.
- Cả local và source đổi khác nhau: conflict, không chọn mặc định.
- Field nội bộ không thuộc ownership của nguồn: luôn giữ local.

## 6. Kiến trúc đề xuất

    Frontend import wizard
      → POST /api/procurement/imports/plan/prepare
      → normalized preview + reconciliation + previewId
      → user decisions
      → POST /api/procurement/imports/plan/apply
      → reconcileProcurementPlanRevision
      → SERIALIZABLE transaction + provenance + authoritative delta

Backend gồm ba module sâu:

1. **ProcurementSource**
   - adapter first-party/official;
   - version-list, plan detail, package detail, notice detail;
   - timeout, schema guard, exact host, cache và error semantics.

2. **ProcurementImportPreparer**
   - normalize DTO;
   - match local bindings;
   - diff source snapshot;
   - three-way field merge;
   - tạo preview bất biến, có TTL và scope user/organization.

3. **ProcurementPlanReconciler**
   - command ghi authoritative;
   - CAS + idempotency + lock theo org/provider/planNo;
   - tạo version, clone aggregate, apply patch và provenance trong cùng transaction.

Route và frontend không biết tên field upstream. Adapter không biết DOM hoặc local workflow.

## 7. Hợp đồng HTTP nội bộ

### 7.1. Prepare plan bundle

    POST /api/procurement/imports/plan/prepare

Request:

    code: PL2600163819-01
    revisionMode: LATEST | SELECTED | ALL
    selectedRevision: 01
    includeLinkedNotices: true
    targetPlanRootId: null

Response rút gọn:

    schemaVersion: biddingflow-procurement-import-preview-v2
    previewId: opaque-id
    expiresAt: ISO-8601
    bundleDigest: sha256
    plan:
      familyNo: PL2600163819
      availableRevisions: []
      selectedRevisions: []
      targetAction: CREATE | VERSION | NOOP | CONFLICT
    revisionPreviews:
      - revisionId: source-uuid
        revisionNumber: 00
        revisionDigest: sha256
        disposition: MATERIALIZE | PROVENANCE_ONLY | NOOP | CONFLICT
    packages: []
    blockingIssues: []
    warnings: []

PreviewId phải random, không đoán được, scope theo organization/user/workspace lease, có TTL ngắn và trỏ tới canonical normalized snapshot trong server-side cache. Không chứa raw upstream payload.

### 7.2. Apply plan bundle

    POST /api/procurement/imports/plan/apply

Request:

    previewId: opaque-id
    idempotencyKey: client-generated-stable-key
    expectedPlanRowVersion: 7
    decisions:
      investorId: local-id
      packageMatches: []
      fieldConflicts: []
      assignees: []

Response:

    ok: true
    operation: APPLIED | NOOP
    created:
      planIds: []
      packageIds: []
    authoritativeDelta: {}
    warnings: []

Apply phải revalidate preview scope, expiry, bundle digest, từng revision digest, expected row versions và authorization. Không tin bất kỳ normalized field nào do browser gửi lại.

Với LATEST/SELECTED, apply có thể trả HTTP 200 cùng authoritative delta. Với ALL, apply trả HTTP 202:

    operationId: import-operation-id
    status: PENDING | RUNNING | PARTIAL | COMPLETED | FAILED
    nextRevisionIndex: 0
    revisionResults: []

Theo dõi và resume:

    GET  /api/procurement/imports/operations/{operationId}
    POST /api/procurement/imports/operations/{operationId}/resume

Mỗi revision có deterministic idempotency key từ operationId + revision UUID + revision digest. Server commit tối đa một revision mỗi transaction, lưu cursor và outcome trước khi chuyển revision tiếp theo. Retry/resume bỏ qua revision đã APPLIED/NOOP và không chạy lại provenance-only observation đã lưu.

### 7.3. Error contract

| HTTP | Code | Ý nghĩa |
|---:|---|---|
| 400 | PROCUREMENT_CODE_INVALID | Mã không hợp lệ |
| 400 | PROCUREMENT_REVISION_INVALID | Revision không tồn tại hoặc không thuộc mã |
| 401/403 | AUTHENTICATION_REQUIRED / ORGANIZATION_ACCESS_DENIED | Auth/workspace không hợp lệ |
| 409 | PROCUREMENT_PREVIEW_STALE | Local row, bundle digest hoặc một revision digest đã đổi |
| 409 | PROCUREMENT_REVISION_CONFLICT | Cùng source revision nhưng digest khác |
| 409 | PROCUREMENT_MATCH_AMBIGUOUS | Còn gói chưa resolve |
| 410 | PROCUREMENT_PREVIEW_EXPIRED | Preview hết TTL |
| 422 | PROCUREMENT_REQUIRED_FIELDS_MISSING | Chưa đủ field để persist |
| 429 | PROCUREMENT_LOOKUP_RATE_LIMITED | Quá rate limit |
| 502 | PROCUREMENT_UPSTREAM_UNAVAILABLE | Nguồn lỗi/từ chối |
| 502 | PROCUREMENT_SCHEMA_CHANGED | Schema guard fail |
| 503 | PROCUREMENT_LOOKUP_DISABLED | Connector chưa được phép bật |
| 503 | PROCUREMENT_LOOKUP_BUSY | Hết bounded slot/circuit open |
| 504 | PROCUREMENT_LOOKUP_TIMEOUT | Hết timeout tổng |

## 8. DTO chuẩn hóa

### 8.1. Plan revision

    familyNo
    revisionId
    revisionNumber
    name
    planType
    projectCode
    projectName
    capitalDetail
    totalAmountVnd
    investorCode
    investorName
    approvalDecisionNo
    approvalDecisionDate
    publishedAt
    publicUrl

### 8.2. Package observation

    planRevisionId
    planDetailRevisionId
    stableExternalId = null unless officially proven
    symbol
    ordinal
    name
    summary
    priceVnd
    estimatePriceVnd
    field
    capitalDetail
    selectionForm
    selectionMode
    evaluationMethod
    selectionDuration
    selectionStart
    contractType
    executionPeriod
    onlineMode
    domesticOrInternational
    lots[]
    additionalPurchaseOption
    noticeLink
    planSnapshot
    noticeSnapshot
    effectiveFields

ordinal chỉ dùng hiển thị. stableExternalId phải nullable cho đến khi có bằng chứng.

### 8.3. Notice observation

    noticeNo
    noticeKind
    revisionId = nullable until exact resolution
    revisionNumber = nullable until exact resolution
    availableRevisions[]
    publishedAt
    bidCloseAt
    bidOpenAt
    financialProposalOpenAt
    bidSecurityValueVnd
    bidValidityDays
    bidSecurityValidityDays
    sourceStatus
    publicUrl

Chỉ tạo notice revision key sau khi resolve exact notice kind và revision. Giữ riêng planSnapshot và noticeSnapshot; effectiveFields chỉ là kết quả precedence có provenance, không được merge phá hủy hai lớp nguồn.

## 9. Ánh xạ vào BiddingFlow

### 9.1. Kế hoạch

| Canonical | Form/model | Chính sách |
|---|---|---|
| familyNo | kh-ma / maKeHoach | Mã cơ sở canonical |
| name | kh-ten / tenKeHoach | Điền khi có |
| planType | kh-loaihinh / loaiHinhMuaSam | Chỉ map enum có contract test |
| projectCode | kh-maduan / maDuan | Chỉ cho loại Dự án |
| projectName | kh-duan / tenDuAnDuToan | Điền tên dự án/dự toán |
| capitalDetail | kh-nguonvon / nguonVon | Text đã chuẩn hóa |
| totalAmountVnd | kh-tongmuc / tongMucDauTu | Integer VND |
| investorCode/name | kh-chudautuid / chuDauTuId | Match exact record hiện hữu; không auto-create |
| approvalDecisionNo | kh-quyetdinh / quyetDinhPheDuyet | Điền khi có |
| approvalDecisionDate | kh-ngaypheduyet / ngayPheDuyet | ISO → local format |
| publishedAt | kh-thoigiandang / thoiGianDangMa | ISO → local datetime |

### 9.2. Gói nền từ kế hoạch

| Canonical | Form/model | Chính sách |
|---|---|---|
| noticeLink.noticeNo | gt-ma / maGoiThau | Trống khi chưa có link; không dùng symbol thay thế |
| name | gt-ten / tenGoiThau | Bắt buộc |
| priceVnd | gt-gia / giaGoiThau | Integer VND |
| executionPeriod | gt-thoigian / thoiGianThucHien | Chuẩn hóa số + đơn vị |
| field | gt-linhvuc / linhVuc | Enum mapping có test |
| selectionForm | gt-hinhthuc / hinhThucLuaChon | Mapping table có test |
| selectionMode | gt-phuongthuc / phuongThucLuaChon | Mapping table có test |
| evaluationMethod | gt-phuongphapdanhgia | Chỉ khi tương thích |
| capitalDetail | gt-nguonvon / nguonVon | Nguồn plan/package rõ ràng |
| contractType | gt-loaihopdong / loaiHopDong | Mapping table có test |
| onlineMode | gt-quatmang / quaMang | Qua mạng/Không qua mạng |
| domesticOrInternational | gt-trongnuocquocte | Enum known only |
| selectionStart | gt-thoigianbatdautochuc | Format hiện hữu |
| selectionDuration | gt-thoigiantochuc | Text chuẩn hóa |
| lots | gt-phanlo và child rows | Chỉ tạo khi schema lot đầy đủ |

Schema hiện tại yêu cầu tên, giá, thời gian thực hiện, nguồn vốn, thời gian tổ chức và thời điểm bắt đầu tổ chức. Gói thiếu một trường bắt buộc phải hiện blocking issue để người dùng bổ sung; không tự bịa mặc định.

### 9.3. Enrichment từ thông báo

| Canonical | Form/model | Chính sách |
|---|---|---|
| noticeNo | gt-ma / maGoiThau | Exact canonical |
| publishedAt | gt-thoigiandangtai | Chỉ từ notice detail |
| bidCloseAt | gt-thoigiandongthau | Phải sau đăng tải |
| bidOpenAt | gt-thoigianmothau | Phải bằng/sau đóng thầu |
| financialProposalOpenAt | gt-thoigianmoehsdxtc | Khi có |
| bidSecurityValueVnd | gt-giatribaomothau | Theo lĩnh vực/lot rule |
| bidValidityDays | gt-hieuluchsdt | Integer dương khi trạng thái yêu cầu |
| bidSecurityValidityDays | gt-hieuluchbaomothau | Mapping rõ đơn vị |

Không tự điền hoặc ghi đè:

- chuyên viên, tổ chuyên gia, tổ thẩm định;
- dữ liệu mở thầu/đánh giá/kết quả/hợp đồng;
- gia hạn, làm rõ hoặc hủy nếu chưa có policy riêng;
- trạng thái chỉ dựa vào việc có noticeNo;
- unknown enum.

## 10. Thuật toán đối chiếu revision

### 10.1. Match identity theo thứ tự

1. Stable package family ID first-party nếu sau này được chứng minh.
2. Binding exact đã lưu giữa source observation và local root.
3. notifyNo exact, duy nhất trong cùng plan family.
4. bidPackageSymbol exact, khác rỗng và duy nhất ở cả hai revision.
5. Binding người dùng đã xác nhận trước đây.
6. Fingerprint tên + chủ đầu tư + lĩnh vực + hình thức + loại hợp đồng chỉ tạo suggestion.
7. Mơ hồ thì bắt buộc người dùng chọn; không auto-merge.

Tên, giá và STT không bao giờ đủ để auto-match.

### 10.2. Ma trận hành động

| Phân loại | Hành động |
|---|---|
| ALREADY_IMPORTED, cùng digest | No-op |
| Cùng revision, khác digest | Conflict; không overwrite |
| UNCHANGED | Clone snapshot sang plan mới; giữ package phienBan |
| CHANGED | Clone và tạo package version kế tiếp trong cùng transaction |
| ADDED | Tạo package root mới, phienBan 00 |
| REMOVED | Không clone sang plan mới; không xóa snapshot cũ |
| AMBIGUOUS | Block apply cho đến khi người dùng resolve |
| Gói ADDED đã có notice link ở lần tạo đầu | Tạo root và package version 00 đã enrichment; không sinh thừa version 01 |
| Gói local đã tồn tại chuyển UNLINKED/UNKNOWN → LINKED exact | Enrich cùng root; coi là material package change |
| notifyVersion mới | Chỉ tăng package version nếu effective source-owned fields đổi |

### 10.3. Command nguyên tử

reconcileProcurementPlanRevision phải:

1. Chạy SERIALIZABLE.
2. Lock theo organization + provider + planNo.
3. Kiểm tra auth, active organization, role và workspace lease.
4. Kiểm tra idempotency key + request hash.
5. Kiểm tra source revision/digest và expected local rowVersion.
6. Tạo initial plan hoặc next plan version.
7. Reconcile chính xác tập package của source revision mới.
8. Dùng snapshotPackageAggregate cho gói kế thừa.
9. Tạo package version cho CHANGED trong cùng transaction.
10. Không clone REMOVED.
11. Overlay chỉ field thuộc ownership của nguồn.
12. Giữ internal state/assignments/children theo policy đã chốt.
13. Lưu provenance append-only.
14. Trả mapping source observation → local IDs và authoritative delta.
15. Rollback toàn bộ revision nếu một invariant persist thất bại.

Không dùng frontend state mutation + generic sync như authority cho bundle import.

## 11. Trạng thái và thông báo liên kết

### 11.1. Không có link

Canonical state:

    noticeLink.state = UNLINKED

Với gói mới, có thể khởi tạo local PREPARING khi:

- nguồn không có linked notice;
- không có bằng chứng hủy/kết quả/trạng thái muộn hơn;
- package process thuộc loại dự kiến sẽ có thông báo;
- các invariant bắt buộc khác hợp lệ.

Với gói đã tồn tại, UNLINKED không được kéo trạng thái local lùi về PREPARING.

JSON link lỗi hoặc thiếu notifyNo là UNKNOWN, không phải UNLINKED.

### 11.2. Có link

LINKED chỉ chứng minh có mã thông báo. Không tự suy ra INVITED, OPENED hoặc AWARDED.

Chỉ map trạng thái khi:

- tải được exact notice detail;
- source status có mapping đã test;
- dữ liệu bắt buộc cho transition đầy đủ;
- lifecycle policy cho phép;
- preview hiển thị thay đổi trạng thái và người dùng xác nhận nếu policy yêu cầu.

Pre-notify không được map thành TBMT.

## 12. Provenance và schema

Bulk/version import bắt buộc có provenance bền vững. Không để provenance ở “giai đoạn sau”.

### 12.1. Thông tin tối thiểu phải lưu

- provider;
- source entity kind: PLAN, PACKAGE, NOTICE;
- source family key;
- source revision UUID;
- source revision number;
- parent plan revision UUID với package observation;
- idDetail;
- symbol và notifyNo alias;
- canonical normalized snapshot hoặc field-level canonical values;
- SHA-256 digest;
- fetchedAt, appliedAt, publicUrl;
- local entity type, local rootId, local snapshotId;
- match method, confidence và người xác nhận;
- import operation/idempotency key.
- bundle digest, từng revision digest, operation status, cursor và per-revision outcome cho ALL-history.

Không lưu raw upstream body, CAPTCHA token, cookie hoặc credential.

### 12.2. Mô hình lưu trữ đề xuất

Tạo các bảng backend-owned, không bắt buộc đồng bộ toàn bộ về client:

- procurement_source_revision;
- procurement_source_binding;
- procurement_import_operation.

Tên cuối có thể điều chỉnh theo convention, nhưng invariant phải có:

- unique organization + provider + source kind + source revision UUID;
- unique applied revision/digest semantics;
- binding không được trỏ cross-tenant;
- provenance append-only;
- normalized snapshot có schemaVersion và size limit;
- lookup index theo planNo, notifyNo, local rootId;
- import operation state machine chỉ tiến tới trước; resume không được chạy lại revision đã kết thúc;
- foreign key hoặc kiểm tra target type an toàn.

Thay đổi cần migration append-only mới, fresh schema parity, PostgreSQL schema contract, upgrade-chain test, backup/restore và tenant-isolation test.

## 13. Khoảng trống phải xử lý trước khi tuyên bố hoàn tất

Audit code hiện tại phát hiện:

1. Plan command clone tất cả package latest của plan nguồn; chưa hỗ trợ include/exclude cho REMOVED.
2. Changed package hiện cần package command thứ hai, không atomic với plan command.
3. Generic sync chưa hard-block mọi sửa đổi vào row lịch sử.
4. Package command chưa xác nhận owning plan là plan latest.
5. Một số frontend resolver tìm package latest chưa scope đầy đủ theo plan.
6. Frontend fallback và backend command chưa hoàn toàn đồng nhất về isLatest.
7. Aggregate clone chưa bao phủ rõ một số lot lifecycle, artifact, document và contract link.
8. Assignment clone cần policy cho user inactive hoặc không còn là member.

Wave 0 phải chốt clone policy và thêm regression test cho các điểm này. Không tuyên bố “kế thừa toàn bộ” nếu chưa có test chứng minh.

## 14. An toàn và độ tin cậy

### 14.1. External adapter

- Backend-only; browser không gọi domain Mua Sắm Công.
- HTTPS exact-host allowlist.
- Verified TLS, controlled redirect.
- Timeout tổng hữu hạn và response-size limit.
- Bounded concurrency và bounded retry cho transient error.
- Circuit breaker riêng cho procurement.
- Positive/negative cache theo provider + kind + canonical key + adapter schema version.
- Conservative parser; schema drift fail closed.
- Không log raw payload/token/full sensitive URL.
- Fixture adapter bị cấm production.

### 14.2. Prepare/apply

- Rate limit theo IP, user và organization.
- Preview TTL và one-user/one-org scope.
- Stale workspace/form/code guard ở frontend.
- Apply re-fetch hoặc revalidate digest theo policy.
- CAS local rowVersion và idempotency cho retry.
- Audit actor, operation, source revision và outcome.
- Không live network trong CI.

### 14.3. Feature gate

    VNEPS_PROCUREMENT_IMPORT_ENABLED=false
    VNEPS_PROCUREMENT_PROVIDER=disabled
    VNEPS_PROCUREMENT_FIXTURE_PATH=
    VNEPS_PROCUREMENT_TIMEOUT_SECONDS=8
    VNEPS_PROCUREMENT_MAX_RESPONSE_BYTES=1048576
    VNEPS_PROCUREMENT_CACHE_TTL_SECONDS=900
    VNEPS_PROCUREMENT_MAX_CONCURRENCY=8

Chỉ bật production khi contract/quyền truy cập detail hợp lệ đã được xác nhận và contract tests pass. Nếu chưa có, trạng thái phải ghi:

    BLOCKED BY EXTERNAL/API AUTHORIZATION

## 15. Kế hoạch thay đổi file

### 15.1. Backend

| File/nhóm | Thay đổi |
|---|---|
| backend/procurement_import/domain.py | DTO, enum, invariants, ownership |
| backend/procurement_import/source.py | ProcurementSource port |
| backend/procurement_import/service.py | prepare, normalize, reconcile preview |
| backend/procurement_import/command.py | reconcileProcurementPlanRevision |
| backend/procurement_import/repository.py | lock, provenance, atomic persistence |
| backend/procurement_import/routes.py | auth, rate, prepare/apply error contract |
| backend/integrations/vneps/procurement_provider.py | production adapter sau external gate |
| backend/integrations/vneps/fake_procurement_provider.py | fixture adapter |
| backend/versioning/aggregate_snapshot.py | primitive include/exclude/overlay có test, nếu cần |
| backend/versioning/command.py | harden owning-plan/latest semantics hoặc reuse primitive |
| backend/db/schema.py | fresh schema provenance |
| backend/db/postgres_schema.py | index, constraint, trigger |
| backend/db/upgrades.py | migration append-only mới |
| backend/sync/read/write policy | hard-block historical mutation nếu thuộc phạm vi |
| backend/app.py | đăng ký route |
| .env.example | feature gate |

### 15.2. Frontend

| File/nhóm | Thay đổi |
|---|---|
| frontend/procurement/ProcurementImportClient.js | prepare/apply client, abort/stale guard |
| frontend/procurement/PlanImportWizard.js | revision selector, package reconciliation, conflict UI |
| frontend/procurement/fieldMapping.js | dependency-aware form preview |
| frontend/plans/KeHoachWorkflow.js | bind wizard tại create flow |
| frontend/packages/GoiThauWorkflow.js | single IB enrichment, không duplicate |
| frontend/shared/versionResolver.js | plan-scoped resolver regression nếu cần |
| views/modals/modal_procurement_import.html | accessible wizard |
| CSS component phù hợp | responsive, focus, state badges; không inline style |
| modal/route registry | lazy-load wizard |

### 15.3. Test và fixture

    tests/fixtures/vneps_plan_00_one_package.json
    tests/fixtures/vneps_plan_01_unchanged_and_new.json
    tests/fixtures/vneps_plan_01_changed_linked_removed.json
    tests/fixtures/vneps_notice_versions.json
    tests/test_procurement_import_service.py
    tests/test_procurement_import_command.py
    tests/test_procurement_import_routes.py
    tests/test_vneps_procurement_provider.py
    tests/js/procurement_import_wizard.test.mjs
    tests/e2e/procurement-plan-import.spec.mjs

Fixture phải là dữ liệu tổng hợp do test tạo để mô phỏng shape upstream hoặc canonical DTO. Không commit captured raw response, token, cookie hay dữ liệu thực không cần thiết.

## 16. Trình tự triển khai

### Wave 0 — Chốt domain và hardening nền

1. Xác nhận semantics bốn bộ đếm phiên bản độc lập.
2. Viết ADR nếu muốn thay sang lockstep; mặc định không thay.
3. Chốt clone policy cho lifecycle/artifact/document/contract link.
4. Chặn sửa lịch sử và package command trên historical plan.
5. Sửa resolver scope theo plan và parity frontend/backend nếu test đỏ.
6. Xác minh external API/quyền truy cập.

### Wave 1 — Provenance và normalized contract

1. Viết migration append-only.
2. Thêm fresh schema và PostgreSQL contract.
3. Viết DTO/schema guard/mapping tests.
4. Viết binding/idempotency/digest repository tests.

### Wave 2 — Prepare

1. Test identifier + version traversal.
2. Test plan/package/notice parser.
3. Test match matrix và three-way merge.
4. Test required fields, unknown enum và ambiguous package.
5. Thêm route prepare với auth/rate/timeout/cache.

### Wave 3 — Apply command

1. Test plan initial/version creation.
2. Test unchanged/changed/added/removed cùng transaction.
3. Test notice enrichment và independent notifyVersion.
4. Test assignments và child aggregate.
5. Test idempotency, CAS, stale digest, rollback.
6. Trả authoritative delta.

### Wave 4 — Frontend wizard

1. Test debounce/abort/stale workspace/form/code.
2. Revision selector và ALL-history mode.
3. Package action/conflict/match UI.
4. Required-field completion và assignee selection.
5. Preview/apply, progress/resume và accessibility.

### Wave 5 — Integration và release gate

1. E2E bằng fixture.
2. Real PostgreSQL integration cho scenario 00 → 01.
3. Security/tenant/backup/upgrade tests.
4. Runbook và feature flag.
5. Chỉ bật provider production khi external gate pass.

## 17. Test matrix bắt buộc

### 17.1. Scenario cốt lõi

- Source plan 00 có A; source plan 01 có A không đổi + B mới.
- Assert local plan 00/01, A cùng root và giữ package version 00, B version 00.
- Source plan 01 có A đổi field: A tạo package version 01 trong plan 01.
- A mới có noticeNo: enrich cùng root, không duplicate.
- Source plan 01 bỏ A: A không xuất hiện trong snapshot 01, lịch sử 00 còn nguyên.
- A mơ hồ: apply bị block đến khi người dùng resolve.
- Reimport cùng revision/digest: no-op.
- Cùng revision/khác digest: conflict.
- Lần đầu import source revision 03: local initial version 00, provenance source 03.
- Sau đó yêu cầu ALL: source 00–02 chỉ OBSERVED_NOT_APPLIED, không chèn hoặc renumber local history.
- Local manual version xen giữa source 00 và source 01: source 01 tạo next local version từ local latest.
- ALL trên dòng mới xử lý 00 → 01 → 02 đúng thứ tự.

### 17.2. Notice/lifecycle

- UNLINKED chỉ map PREPARING khi process thuộc loại dự kiến sẽ có thông báo.
- UNLINKED với process chưa xác nhận trả warning/UNKNOWN, không tự map PREPARING.
- UNLINKED mới → PREPARING khi đủ điều kiện.
- Existing package không bị kéo lùi trạng thái.
- link JSON lỗi → UNKNOWN.
- PRE_NOTIFY không bị coi là TBMT.
- LINKED nhưng detail unavailable không tự thành INVITED.
- notifyVersion 00 → 01 không tự đổi planVersion/packageVersion.
- Notice field material đổi mới gọi package-version rule.

### 17.3. Transaction và lịch sử

- Một package invalid làm rollback toàn revision.
- CAS conflict không sinh row.
- Retry idempotency không nhân đôi.
- ALL operation resume từ cursor và mỗi revision APPLIED/NOOP đúng một lần.
- Bundle digest hoặc revision digest đổi làm preview stale/conflict đúng mức.
- Historical plan/package/child không sửa được qua generic sync.
- Package command bị chặn nếu owning plan không latest.
- Resolver không chọn package snapshot của plan lịch sử.
- Removed package không bị plan clone kéo sang.

### 17.4. Assignment và aggregate

- New record có active importer làm assignee mặc định.
- Matched package clone assignment hợp lệ.
- Inactive/non-member assignee theo policy đã chốt.
- Unique/FK/tenant trigger pass.
- Lot/goods/opening/evaluation/result mapping được remap đúng.
- Các bảng không clone có test chứng minh policy giữ ở lịch sử.

### 17.5. Adapter và frontend

- PL/IB hoa thường, suffix, invalid code.
- Version-list response không theo thứ tự.
- Exact match, schema drift, invalid JSON, response quá lớn.
- Timeout/retry/circuit/cache/concurrency.
- Debounce, abort A→B, close/reopen modal, workspace switch.
- Preview conflict, cancel không thay đổi dữ liệu.
- Apply không gửi canonical payload từ browser.
- Keyboard, screen reader, focus trap và 320 px.
- Không network Mua Sắm Công trong CI.

### 17.6. Lệnh kiểm tra dự kiến

    python -m pytest -q tests/test_procurement_import_service.py tests/test_procurement_import_command.py tests/test_procurement_import_routes.py tests/test_vneps_procurement_provider.py
    node --test tests/js/procurement_import_wizard.test.mjs
    python scripts/check_python_quality.py
    npm run lint:security
    npm run build:secure
    git diff --check

Sau targeted tests, chạy full Python/JS suite và E2E. Không nới quality/security threshold để làm test pass.

## 18. Acceptance criteria

- [ ] Nhập PL hiển thị version-list và mặc định revision mới nhất.
- [ ] Lần nhập đầu chọn latest/selected có revision cũ hơn phải cảnh báo hệ quả provenance-only backfill và đề nghị ALL.
- [ ] Preview có đầy đủ gói của source snapshot đã chọn.
- [ ] Người dùng có thể nhập selected revision hoặc toàn bộ lịch sử.
- [ ] ALL trên dòng mới có operationId, per-revision digest/result, cursor và resume idempotent.
- [ ] ALL sau khi revision mới hơn đã áp dụng chỉ backfill revision cũ dưới dạng provenance; không chèn hoặc renumber local history.
- [ ] Apply tạo kế hoạch và package base qua server command authoritative.
- [ ] Gói có notice link được enrich vào cùng root.
- [ ] Gói không link vẫn được tạo PREPARING khi đủ điều kiện và đủ field.
- [ ] Unknown/pre-notify không bị map sai thành TBMT.
- [ ] Link chỉ resolve được notifyNo giữ kind UNKNOWN và revision nullable; không bịa notice revision key.
- [ ] Gói unchanged giữ package phienBan khi plan tăng version.
- [ ] Gói changed mới tăng package phienBan.
- [ ] Gói new bắt đầu 00; removed không clone sang plan mới.
- [ ] Source planVersion, local plan phienBan, local package phienBan và source notifyVersion không bị đồng nhất.
- [ ] Local plan version do người dùng tạo xen giữa source revisions không làm sai mapping source/local.
- [ ] idDetail/STT/tên không bị dùng sai làm stable package identity.
- [ ] Ambiguous match bắt buộc xác nhận.
- [ ] Reimport cùng revision/digest là no-op.
- [ ] Same revision/different digest tạo conflict.
- [ ] Provenance append-only đủ để three-way merge và audit.
- [ ] Không sửa row lịch sử.
- [ ] Bundle apply atomic theo từng source revision.
- [ ] Browser không gọi Mua Sắm Công.
- [ ] Không CAPTCHA bypass hoặc raw payload/token trong log/database/git.
- [ ] Auth, tenant, CAS, idempotency, rate, timeout, TLS, size guard có test.
- [ ] Manual create/edit/version workflows không regression.
- [ ] Connector không được tuyên bố production-ready khi external gate chưa qua.

## 19. Quyết định còn cần chủ sản phẩm xác nhận

Chỉ còn một quyết định có thể thay đổi mô hình:

**Giữ phiên bản gói độc lập hay đổi sang lockstep với kế hoạch?**

Khuyến nghị: giữ rule hiện tại.

- Plan lên 01, gói không đổi vẫn là package version 00 trong snapshot plan 01.
- Gói thay đổi thật mới lên package version 01.
- Gói mới ở plan 01 bắt đầu package version 00.

Nếu chọn lockstep, phải lập ADR, sửa unique/version resolver/command/UI/test và migration dữ liệu lịch sử. Prompt dưới đây mặc định giữ rule hiện tại.

---

# PROMPT THỰC HIỆN CHO CODEX

Sao chép nguyên khối dưới đây để giao triển khai.

~~~~text
Bạn đang làm việc trong repository BiddingFlow. Hãy triển khai end-to-end tính năng nhập KHLCNT theo bundle, tự thêm các gói thầu trong kế hoạch, làm giàu từ Số thông báo liên kết và đối chiếu nhiều phiên bản Mua Sắm Công.

Tài liệu nguồn bắt buộc:

1. docs/KE_HOACH_VA_PROMPT_TICH_HOP_MUASAMCONG_KHLCNT_GOI_THAU_2026-08-10.md
2. docs/research/MUASAMCONG_KHLCNT_GOI_THAU_PHIEN_BAN_2026-08-10.md
3. CONTEXT.md
4. README.md và coding/security docs liên quan.

Mục tiêu:

- Nhập PL... sẽ prepare kế hoạch và toàn bộ package observation của revision được chọn.
- Preview trước khi persist.
- Sau xác nhận, server commit kế hoạch + gói + provenance atomically theo từng source revision.
- Có Số thông báo liên kết thì enrich đúng gói, không duplicate.
- Không link vẫn tạo package base từ plan detail khi đủ invariant.
- Hỗ trợ revision latest, selected và all-history; ALL chỉ materialize lịch sử cũ → mới trên dòng local mới, còn revision cũ hơn revision đã áp dụng chỉ backfill provenance.
- Reimport idempotent và sync revision mới theo đúng unchanged/changed/added/removed/ambiguous.

Semantics không được thay đổi:

- planVersion nguồn, phienBan kế hoạch nội bộ, phienBan gói nội bộ và notifyVersion nguồn là bốn bộ đếm độc lập.
- Plan version tăng không tự làm mọi package version tăng.
- Unchanged package: clone sang plan mới, giữ phienBan.
- Existing package thay đổi hoặc chuyển từ chưa resolve link sang LINKED exact: tạo package version tiếp theo bằng rule nội bộ.
- New package đã có linked notice ngay lần đầu: tạo initial package version 00 đã enrichment, không tạo thừa version 01.
- New package: root mới, version 00.
- Removed package: không clone sang plan mới, không xóa lịch sử.
- Lần đầu import source revision 03 vẫn tạo local initial version 00 và lưu external revision 03.
- Sau trường hợp đó, source 00–02 chỉ backfill provenance OBSERVED_NOT_APPLIED; không chèn/renumber/rebuild local history.
- Local manual version có thể xen giữa source revisions; source revision mới luôn tạo next local plan version từ local latest.
- Không triển khai lockstep nếu chưa có ADR và yêu cầu mới rõ ràng.

Trước khi sửa:

1. Đọc toàn bộ ba tài liệu bắt buộc.
2. Kiểm tra git status và bảo toàn thay đổi người dùng.
3. Audit lại code/test được trích dẫn; không giả định tài liệu thay thế code.
4. Viết test đỏ cho scenario plan00/A00 → plan01/A unchanged + B new.
5. Viết test đỏ cho A changed, A linked, A removed và ambiguous.
6. Chốt clone policy cho lot lifecycle, artifact, document và contract link.

External gate:

- Không gọi Mua Sắm Công trực tiếp từ browser.
- Không bypass, solve hộ, reuse hoặc giả lập reCAPTCHA.
- Production adapter chỉ triển khai/bật khi API/quyền truy cập hợp lệ đã được xác nhận.
- Nếu chưa qua gate, hoàn thiện domain, fixture adapter, prepare/apply, frontend và tests sau feature flag disabled-by-default.
- Báo BLOCKED BY EXTERNAL/API AUTHORIZATION; không tuyên bố production-ready.
- Fixture provider phải fail startup trong production.

Thiết kế bắt buộc:

1. ProcurementSource port ẩn endpoint và upstream schema.
2. ProcurementImportPreparer tạo normalized preview, reconciliation, three-way merge và opaque previewId.
3. ProcurementPlanReconciler là authoritative backend command.
4. Apply chạy SERIALIZABLE, CAS, idempotency và lock theo organization/provider/planNo.
5. Provenance append-only là bắt buộc; không lưu raw upstream payload.
6. Frontend chỉ gửi previewId + decisions + expected row versions; không gửi lại canonical source payload để server tin.
7. Server trả authoritative delta để hydrate client.
8. ALL-history dùng bundle digest + revision digest, operationId, cursor, per-revision result, status API và resume API; mỗi revision là một transaction có deterministic idempotency key.

Identity:

- Plan revision key: planNo + planVersion + revision UUID.
- Package observation key: planRevisionId + idDetail.
- idDetail chưa được chứng minh ổn định xuyên planVersion.
- Match logical package theo stable first-party ID nếu có, binding đã lưu, exact unique notifyNo, exact unique symbol, hoặc user-confirmed binding.
- Fingerprint chỉ suggestion.
- Tên, giá và STT không được dùng để auto-match.
- Notice revision key chỉ được tạo sau exact resolution: notifyNo + notifyVersion + revision UUID; kind/revision nullable và UNKNOWN trước đó.

Lifecycle:

- UNLINKED package mới chỉ có thể PREPARING khi process thuộc loại dự kiến sẽ có thông báo, không có contrary evidence và đủ required fields.
- Existing package không bị kéo lùi trạng thái.
- LINKED không tự suy ra INVITED/OPENED/AWARDED.
- PRE_NOTIFY không phải TBMT.
- Chỉ map source status khi exact detail, explicit mapping, complete required fields và lifecycle policy đều hợp lệ.

Required-field policy:

- Không invent dữ liệu để thỏa schema.
- Plan phải match chủ đầu tư hiện hữu.
- Package thiếu tên, giá, execution period, capital, selection duration hoặc selection start phải thành blocking issue để người dùng bổ sung.
- New plan/package mặc định assignee là active importer theo rule hiện hữu.
- Inherited assignment phải được kiểm tra active membership.

Provenance/migration:

- Tạo migration append-only mới cho source revision, source binding và import operation.
- Lưu provider, kind, family key, revision UUID/no, parent plan revision, idDetail, aliases, canonical normalized snapshot/field values, bundle/revision digest, timestamps, public URL, local root/snapshot IDs, match method và confirmer.
- Import operation lưu mode, status, cursor, per-revision outcome và deterministic idempotency key để resume đúng một lần.
- Thêm fresh schema, PostgreSQL constraints/indexes, schema contract, upgrade-chain, backup/restore và tenant tests.
- Không sửa migration đã phát hành.

Hardening bắt buộc trước bundle import:

- Plan command hiện clone mọi package; thêm primitive include/exclude hoặc command riêng để REMOVED không bị clone.
- Changed package phải được version trong cùng transaction với plan revision.
- Chặn generic sync sửa historical plan/package/child.
- Chặn package command nếu owning plan không latest.
- Sửa package resolver chưa scope theo plan nếu regression test chứng minh.
- Đảm bảo frontend/backend parity cho isLatest.
- Chốt và test aggregate child clone policy.

Backend:

- Normalization PL/IB tách base candidate/requested revision, exact-validate response và chỉ fallback theo provider capability đã contract-test; version sort không tin thứ tự upstream.
- Immutable canonical DTO, integer VND, ISO date/datetime.
- Conservative parser/schema guard; unknown enum warning/unset.
- Prepare/apply routes với auth, active org, rate limit, run_blocking_io, timeout, bounded concurrency/retry, circuit, cache, TLS allowlist và response-size guard.
- Preview TTL scoped user/org/workspace.
- Stable error contract theo tài liệu.
- Outcome/latency/audit không log raw code/payload/token.

Frontend:

- Debounce 600 ms, AbortController, stale code/form/workspace guard và cleanup.
- Wizard chọn revision latest/selected/all.
- Lần đầu chọn latest/selected khi có revision cũ hơn phải cảnh báo rằng lịch sử cũ về sau chỉ backfill provenance và đề nghị ALL.
- Preview plan, packages, notice, action, conflict, required fields, assignees và summary.
- Ambiguous row bắt buộc resolve.
- Apply chỉ sau user confirmation.
- Progress/resume cho all-history.
- Accessible keyboard/focus/aria-live, responsive 320 px.
- Không inline event/style và không phá Trusted Types/CSP.

Test bắt buộc:

- Real PostgreSQL scenario plan00/A00 → plan01/A unchanged + B new.
- Assert id/rootId/phienBan/isLatest/keHoachId chính xác.
- A changed → package version 01.
- New package initial-linked → version 00, không sinh version 01 thừa.
- Existing package later-linked → same root, next package version, no duplicate.
- Removed → absent target snapshot, historical intact.
- Ambiguous → blocked.
- Same revision/digest → no-op.
- Same revision/different digest → conflict.
- Initial external 03 → local 00 + provenance 03.
- ALL after external 03 → older revisions provenance-only, no local insertion/renumber.
- Manual local plan version between source revisions → next source revision maps to next local latest.
- ALL on new root → chronological operation with bundle/revision digest, cursor and exactly-once resume.
- Notice versions independent.
- Initial-linked package remains version 00; later-linked existing package gets next version.
- UNLINKED only maps PREPARING for an expected-notice process; unknown process remains warning/UNKNOWN.
- Atomic rollback on one invalid package.
- Historical mutation blocked.
- Resolver plan scope.
- Assignment active/inactive/non-member policy.
- Child aggregate remap and excluded-table policy.
- Adapter schema drift/errors/timeout/TLS/size/rate/cache/circuit.
- Frontend abort/stale/modal/workspace/conflict/cancel/accessibility.
- E2E fixture only; no live Mua Sắm Công network in CI.

Chạy tối thiểu:

python -m pytest -q tests/test_procurement_import_service.py tests/test_procurement_import_command.py tests/test_procurement_import_routes.py tests/test_vneps_procurement_provider.py
node --test tests/js/procurement_import_wizard.test.mjs
python scripts/check_python_quality.py
npm run lint:security
npm run build:secure
git diff --check

Sau targeted tests, chạy full Python/JS suite và E2E. Không nới quality/security threshold.

Definition of Done:

- Toàn bộ acceptance criteria mục 18 có evidence test.
- Bundle apply authoritative, atomic theo revision và idempotent.
- Không duplicate gói khi notice xuất hiện hoặc IB được nhập riêng.
- Không clone removed package.
- Không sửa lịch sử.
- Không đồng nhất bốn bộ đếm phiên bản.
- Provenance đủ cho audit và three-way merge.
- Manual create/edit/version flows không regression.
- Không raw payload/token/credential trong response/log/database/fixture/git.
- External gate được báo trung thực.

Kết luận cuối phải báo:

1. Interface/seam/command đã triển khai.
2. Semantics phiên bản và scenario 00 → 01 thực tế.
3. External gate pass hay blocked và bằng chứng contract.
4. Migration/schema/provenance đã thêm.
5. Mapping supported/warning/unset.
6. Clone policy cho từng nhóm child data.
7. Test counts và lệnh đã chạy.
8. Security/tenant/CAS/idempotency evidence.
9. Remaining risks, đặc biệt stable package identity và API detail.

Không được nói hoàn tất production nếu detail connector vẫn cần CAPTCHA, API chưa được cấp quyền hoặc contract chưa được xác minh.
~~~~
