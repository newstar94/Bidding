# PLAN / PROMPT CHO CODEX — TRIỂN KHAI IMPORT KẾ HOẠCH & GÓI THẦU TỪ MUA SẮM CÔNG THEO TỪNG PHIÊN BẢN

## 0. Repository

- Repository cần nghiên cứu và chỉnh sửa: `https://github.com/newstar94/Bidding`
- Branch mặc định: `main`

> **Yêu cầu bắt buộc trước khi sửa code:** hãy đọc kỹ code mới nhất trên `main`, lần theo đầy đủ luồng frontend → service/model → persistence/sync → backend API → procurement import/reconciliation. Không được chỉ sửa theo tên file trong prompt này nếu code thực tế đã được refactor hoặc đổi vị trí. Mọi quyết định triển khai phải dựa trên code hiện tại.

---

# 1. Mục tiêu tổng thể

Tôi muốn thay đổi luồng **thêm Kế hoạch lựa chọn nhà thầu / Gói thầu bằng dữ liệu lấy từ Mua Sắm Công** theo hướng:

1. Dữ liệu từ Mua Sắm Công chỉ là **nguồn chuẩn bị dữ liệu**.
2. Người dùng vẫn đi qua **workflow nhập/sửa hiện có của Bidding**.
3. Không commit thẳng tất cả dữ liệu ngay khi lấy từ Mua Sắm Công.
4. Đối với dữ liệu có nhiều phiên bản:
   - lấy/prepare toàn bộ lịch sử một lần;
   - nhưng người dùng phải **lưu từng phiên bản theo đúng thứ tự 00 → 01 → 02 → ...**;
   - sau mỗi lần lưu thành công mới hỏi người dùng có muốn tiếp tục phiên bản kế tiếp hay không.
5. Các gói thầu thuộc Kế hoạch phải được đưa vào **draft của modal Phân khai Chi tiết Công việc Kế hoạch**, để người dùng có thể sửa đầy đủ trước khi commit.
6. Chủ đầu tư phải được tự động resolve:
   - có trong Bidding → dùng bản ghi hiện có;
   - chưa có → lấy thông tin từ Mua Sắm Công, chuẩn hóa theo đúng workflow thêm Chủ đầu tư hiện tại, tạo bản ghi mới ngầm.
7. Không được phá cơ chế versioning, rowVersion/CAS, workspace isolation, permission, provenance, sync/outbox, server-side pagination hoặc các luồng CRUD hiện có.

---

# 2. Hành vi nghiệp vụ bắt buộc

## 2.1. Khi thêm Kế hoạch từ Mua Sắm Công

Khi người dùng nhập mã KHLCNT và chọn lấy dữ liệu từ Mua Sắm Công:

### Bước 1 — Prepare toàn bộ lịch sử

- Tìm tất cả revision/version của Kế hoạch.
- Sắp xếp tăng dần theo version nguồn:
  - `00`
  - `01`
  - `02`
  - ...
- Không tự động commit tất cả.
- Chỉ prepare/cache toàn bộ dữ liệu để phục vụ workflow tuần tự.

Khái niệm bắt buộc:

```text
revisionMode = ALL
```

phải được hiểu là:

> **Lấy/chuẩn bị tất cả revision**

và **KHÔNG** được hiểu là:

> **Lưu tất cả revision ngay lập tức**

---

## 2.2. Xử lý Chủ đầu tư

Từ dữ liệu Kế hoạch Mua Sắm Công phải xác định được `investorCode` / mã Chủ đầu tư.

### Trường hợp A — Chủ đầu tư đã tồn tại trong Bidding

Ưu tiên match theo mã Chủ đầu tư chuẩn hóa.

Có thể fallback theo MST nếu nghiệp vụ hiện tại đã hỗ trợ và đủ chắc chắn.

Khi tìm thấy:

- dùng chính record Chủ đầu tư hiện hữu;
- không tạo duplicate;
- gán đúng `chuDauTuId` cho Kế hoạch.

### Trường hợp B — Chủ đầu tư chưa tồn tại

Phải thực hiện ngầm cùng logic với người dùng bấm:

> **Thêm Chủ đầu tư mới**

Quy trình bắt buộc:

```text
mã Chủ đầu tư
    ↓
normalize
    ↓
tra local DB lần cuối
    ↓
nếu chưa có:
    lookup thông tin Chủ đầu tư trên Mua Sắm Công
    ↓
normalize theo model Bidding
    ↓
validate theo rules hiện tại
    ↓
createInitialVersion(...)
    ↓
version 00
    ↓
persist bằng đúng mutation/persistence service chuẩn
```

### Không được làm

Không được có logic kiểu:

```js
model.state.chudautu.push({
  maChuDauTu: ...,
  tenChuDauTu: ...
})
```

rồi bỏ qua validation/versioning/persistence hiện có.

### Refactor mong muốn

Tách logic dùng chung, ví dụ:

```text
InvestorResolver
InvestorService
PartnerResolver
```

hoặc tên phù hợp với kiến trúc hiện tại.

Service dùng chung phải được gọi bởi cả:

- workflow thêm Chủ đầu tư thủ công;
- procurement import.

Mục tiêu là **một nguồn business logic duy nhất**.

---

# 3. Không tạo Chủ đầu tư “mồ côi” khi người dùng hủy

Nếu import Kế hoạch phát hiện Chủ đầu tư chưa có, không nên persist Chủ đầu tư quá sớm rồi để người dùng hủy Kế hoạch.

Ưu tiên thiết kế:

```text
prepare Chủ đầu tư
      ↓
đưa vào draft/import session
      ↓
người dùng tiếp tục chỉnh Kế hoạch
      ↓
Lưu kế hoạch thành công
      ↓
commit Chủ đầu tư + Kế hoạch + Gói thầu
```

Nếu người dùng Hủy trước khi commit:

- không để lại Chủ đầu tư mới không được sử dụng.

Có thể mở rộng draft hiện tại để theo dõi Chủ đầu tư pending.

Ví dụ nếu phù hợp code hiện tại:

```text
PLAN_BREAKDOWN_DRAFT_TABLES
+ chudautu
```

hoặc dùng một pending entity trong Import Session.

**Dù chọn cách nào cũng phải re-check uniqueness phía server ngay trước commit** để tránh hai người dùng đồng thời tạo trùng cùng Chủ đầu tư.

---

# 4. Luồng Kế hoạch revision 00

Giả sử Mua Sắm Công có:

```text
PLxxxxxxxxxx
├── 00
├── 01
└── 02
```

Sau prepare:

```text
ImportSession
currentRevision = 00
```

Phải nạp dữ liệu version `00` vào modal Kế hoạch.

Người dùng vẫn được sửa các trường trước khi bấm:

> **Lưu thông tin**

---

# 5. Ngay khi chuyển sang modal “Phân khai Chi tiết Công việc Kế hoạch”

Đây là yêu cầu rất quan trọng.

Khi người dùng bấm **Lưu thông tin** ở modal Kế hoạch và workflow chuyển sang modal:

> **Phân khai Chi tiết Công việc Kế hoạch**

thì tab:

> **IV. Các gói thầu**

phải **ngay lập tức hiển thị đầy đủ danh sách gói thầu thuộc đúng revision hiện tại của Kế hoạch**.

Ví dụ:

```text
Kế hoạch 00
├── Gói 01
├── Gói 02
├── Gói 03
└── Gói 04
```

Không được yêu cầu người dùng tự thêm lại từng gói.

Không được commit các gói xuống DB trước khi người dùng hoàn tất chỉnh sửa và lưu Kế hoạch.

---

# 6. Materialize package draft trước khi mở modal Phân khai

Luồng mong muốn:

```text
MSC revision 00
      ↓
canonical packages
      ↓
PackageDraftMapper
      ↓
packageDrafts[]
      ↓
handleKeHoachSubmit()
      ↓
generate targetPlanId
      ↓
materializeImportedPackages(
    packageDrafts,
    targetPlanId
)
      ↓
model.state.goithau
      ↓
openPlanBreakdownModal(targetPlanId)
      ↓
tab IV tự render
```

Phải tận dụng cơ chế draft đã có của Bidding.

Nếu code hiện tại đã có:

```js
isPlanBreakdownDraftActive(...)
```

và `handleGoiThauSubmit()` đã biết không persist khi đang ở draft thì **phải tái sử dụng đúng cơ chế này**.

Không tạo một hệ thống draft package mới song song nếu không thực sự cần.

---

# 7. Người dùng được sửa Gói thầu bằng modal Gói thầu hiện tại

Trong tab IV:

- hiển thị danh sách gói;
- mỗi gói có nút Sửa như hiện tại;
- người dùng mở modal Gói thầu hiện có;
- toàn bộ field lấy được từ Mua Sắm Công phải được điền sẵn;
- người dùng được chỉnh sửa trước khi lưu.

Khi bấm Lưu Gói thầu trong lúc Kế hoạch đang là draft:

- chỉ cập nhật state/draft;
- **không persist DB**;
- khi quay lại tab IV phải thấy dữ liệu vừa sửa.

Chỉ khi bấm:

> **Lưu kế hoạch**

ở modal Phân khai thì mới commit chính thức.

---

# 8. Tạo mapper chuẩn từ canonical Mua Sắm Công sang model Bidding

Không rải logic mapping ở nhiều nơi.

Cần tách rõ:

```text
Canonical MSC Plan
    ↓
PlanDraftMapper
    ↓
Bidding Plan Draft
```

và:

```text
Canonical MSC Package
    ↓
PackageDraftMapper
    ↓
Bidding Package Draft
```

Mapper package phải hỗ trợ tối đa dữ liệu source hiện có, gồm tối thiểu các field canonical sau nếu nguồn có dữ liệu:

```text
symbol
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
lots
isMultiLot
isPrequalification
isConcentrateShopping
additionalPurchaseOption
noticeLink
noticeFields
expectedNotice
sourceStatus
```

Đồng thời map sang các field Bidding tương ứng như:

```text
maGoiThau
tenGoiThau
giaGoiThau
linhVuc
hinhThucLuaChon
phuongThucLuaChon
phuongPhapDanhGia
nguonVon
loaiHopDong
thoiGianThucHien
thoiGianToChuc
thoiGianBatDauToChuc
quaMang
trongNuocQuocTe
phanLo
phanLoList
tuyChonMuaThem
...
```

Nếu có field không thể map chắc chắn:

- không được đoán bừa;
- giữ canonical/source metadata để có thể xử lý sau;
- ghi warning rõ ràng;
- không overwrite field nội bộ bằng dữ liệu không chắc chắn.

---

# 9. Không được gửi raw JSON khổng lồ xuống frontend

Thiết kế mong muốn:

```text
MSC raw
   ↓
Raw Snapshot / server cache
   ↓
Canonical
   ↓
Editable Draft DTO
   ↓
Frontend
```

Frontend chỉ cần dữ liệu đang thao tác.

Ví dụ:

```json
{
  "revisionNumber": "00",
  "planDraft": {},
  "packageDrafts": []
}
```

Raw bundle đầy đủ nên giữ server-side để:

- audit;
- debug;
- provenance;
- remap;
- reprocess;
- phục hồi import session.

---

# 10. Tạo Procurement Import Session

Nên xây dựng một abstraction rõ ràng, ví dụ:

```js
{
  sessionId: "...",
  kind: "PLAN",
  familyNo: "PLxxxxxxxxxx",

  revisions: [
    {
      revisionNumber: "00",
      revisionId: "...",
      status: "READY"
    },
    {
      revisionNumber: "01",
      revisionId: "...",
      status: "READY"
    }
  ],

  currentIndex: 0,

  investor: {
    sourceCode: "...",
    localId: null,
    status: "NEW"
  }
}
```

Tên class/schema có thể khác, miễn đảm bảo chức năng.

Import Session phải:

- scoped theo organization/workspace;
- scoped theo user khi phù hợp;
- chống dùng nhầm session của workspace khác;
- có expiry hợp lý;
- có thể resume nếu người dùng thao tác lâu;
- không phụ thuộc hoàn toàn vào process-memory TTL 5 phút;
- không lưu token/cookie Mua Sắm Công vào DB;
- không lộ raw secrets ra frontend.

---

# 11. PreviewStore hiện tại không đủ cho workflow dài

Nếu `PreviewStore` hiện chỉ là process-local cache TTL khoảng vài phút, cần đánh giá và thay đổi.

Workflow thực tế có thể:

```text
00
→ người dùng sửa 10 phút
→ lưu
→ sang 01
→ sửa tiếp
```

Do đó không được để session tự hết hạn giữa quá trình một cách vô lý.

Có thể tạo persistent/shared session:

```text
procurement_import_session

id
organization_id
user_id
workspace_lease
provider
kind
family_no
bundle_digest
current_revision
status
expires_at
created_at
updated_at
...
```

Không bắt buộc đúng schema trên, nhưng phải giải quyết được:

- multi-process;
- server restart;
- long editing session;
- resume;
- cleanup.

Nếu repository đã có Raw Snapshot Repository thì ưu tiên lưu reference/digest thay vì duplicate raw payload lớn.

---

# 12. API lấy từng revision từ dữ liệu đã prepare

Sau khi prepare ALL, cần cho frontend lấy draft theo từng revision mà **không gọi lại Mua Sắm Công**.

Ví dụ API:

```text
GET /api/procurement/imports/plan/sessions/{sessionId}/revisions/00
GET /api/procurement/imports/plan/sessions/{sessionId}/revisions/01
```

hoặc thiết kế REST khác phù hợp.

Response tối thiểu:

```json
{
  "revisionNumber": "00",
  "revisionId": "...",
  "planDraft": {},
  "packageDrafts": [],
  "investorResolution": {},
  "warnings": []
}
```

---

# 13. Không để `PlanImportWizard.apply()` commit thẳng nữa

Hiện hành vi cần thay đổi là:

```text
PlanImportWizard
   ↓
applyPlan()
   ↓
commit plan + packages
```

Sau khi sửa, PlanImportWizard phải có vai trò:

```text
nhập mã
   ↓
prepare/import session
   ↓
load revision đầu tiên
   ↓
đổ dữ liệu vào workflow thêm Kế hoạch hiện có
```

Tức là:

> **Procurement Import Wizard chuẩn bị dữ liệu và khởi động workflow; nó không phải nơi commit toàn bộ Kế hoạch/Gói thầu.**

---

# 14. Luồng hoàn chỉnh khi import Kế hoạch nhiều version

Ví dụ nguồn có `00`, `01`, `02`.

## Revision 00

```text
Prepare ALL
    ↓
load 00
    ↓
resolve/create investor draft
    ↓
điền modal Kế hoạch
    ↓
user chỉnh sửa
    ↓
Lưu thông tin
    ↓
materialize gói của 00 vào draft
    ↓
mở Phân khai
    ↓
tab IV có sẵn các gói
    ↓
user sửa từng gói
    ↓
Lưu kế hoạch
    ↓
commit version 00
```

Chỉ sau khi commit `00` thành công mới:

```text
Có version 01?
```

Nếu không có → complete session.

Nếu có → hiển thị popup.

---

# 15. Popup sau khi lưu từng version

Sau khi revision `00` đã commit thành công:

```text
Đã lưu phiên bản 00.

Kế hoạch trên Mua Sắm Công còn phiên bản 01.
Bạn có muốn tiếp tục nhập phiên bản 01 không?

[Không] [Tiếp tục]
```

### Nếu chọn Không

- kết thúc import session;
- giữ revision 00 đã lưu;
- không rollback;
- không tự lưu 01.

### Nếu chọn Tiếp tục

- tải draft revision 01 từ Import Session;
- không gọi lại Mua Sắm Công;
- mở lại workflow Kế hoạch với revision 01;
- tiếp tục đúng chu trình:
  - Kế hoạch;
  - Phân khai;
  - tab IV;
  - sửa Gói thầu;
  - save;
  - hỏi 02.

Lặp cho đến hết.

---

# 16. Version nguồn Mua Sắm Công là authoritative

Đối với import từ Mua Sắm Công:

```text
source revision 00 → Bidding version 00
source revision 01 → Bidding version 01
source revision 02 → Bidding version 02
```

Không được quyết định version dựa trên heuristic nội bộ như:

```text
thời gian đăng thay đổi?
thời gian đóng thầu thay đổi?
```

Các heuristic đó chỉ tiếp tục dùng cho sửa thủ công nếu hiện tại nghiệp vụ đang dùng.

Cần thêm metadata/directive rõ ràng, ví dụ:

```js
sourceRevision: {
  provider: "MUASAMCONG",
  revisionId: "...",
  revisionNumber: "01"
}
```

Khi lưu từ import session:

- phải nhận biết đây là authoritative source revision;
- tạo đúng local version tương ứng;
- giữ provenance/binding.

---

# 17. Version Kế hoạch 01 phải kế thừa local data của 00 nhưng áp dụng source data của 01

Khi chuyển:

```text
Plan 00 → Plan 01
```

không được tạo một record hoàn toàn tách rời mất dữ liệu nội bộ.

Nguyên tắc:

### Source-owned fields

Các field được Mua Sắm Công quản lý phải ưu tiên dữ liệu source 01.

### Local-owned fields

Các field Bidding quản lý nội bộ phải kế thừa từ local version 00.

Ví dụ:

```text
Người phụ trách
ghi chú nội bộ
assignment
các dữ liệu nghiệp vụ chỉ có ở Bidding
```

phải được giữ.

Sau đó user được chỉnh revision 01 trước khi save.

---

# 18. Gói thầu của Plan revision phải thuộc đúng snapshot Plan revision

Không dùng một danh sách package chung cho toàn bộ plan family.

Phải giữ cấu trúc:

```text
PL...
│
├── Plan 00
│    ├── Package A 00
│    ├── Package B 00
│    └── Package C 00
│
└── Plan 01
     ├── Package A ...
     ├── Package B ...
     └── Package D ...
```

Khi tạo version Kế hoạch mới:

- tận dụng aggregate snapshot/versioning hiện có;
- kế thừa package/local data đúng lineage;
- reconcile source revision mới;
- không làm mất package cũ;
- không reset trạng thái/người phụ trách do lỗi snapshot.

---

# 19. Import một Gói thầu có nhiều version

Yêu cầu tương tự Kế hoạch.

Nếu người dùng lấy dữ liệu trực tiếp trong modal Gói thầu và nguồn có:

```text
IBxxxxxxxxxx-00
IBxxxxxxxxxx-01
IBxxxxxxxxxx-02
```

thì phải:

```text
prepare ALL
    ↓
load 00
    ↓
điền form
    ↓
user chỉnh
    ↓
save 00
    ↓
Có 01?
    ↓
popup Có/Không
    ↓ Có
load 01
    ↓
user chỉnh
    ↓
save 01
...
```

Không được hardcode `revisionMode = LATEST` cho trường hợp này.

---

# 20. SequentialRevisionController dùng chung

Không viết hai workflow lặp logic:

- một cho Plan;
- một cho Package.

Nên có abstraction dùng chung, ví dụ:

```text
SequentialRevisionController
```

với các chức năng:

```text
revisions[]
currentIndex
current()
hasNext()
next()
complete()
cancel()
```

và callback:

```text
loadRevision()
saveRevision()
afterRevisionSaved()
```

Có thể khác tên, nhưng phải tránh duplicate logic popup/state machine.

---

# 21. State machine khuyến nghị

Có thể dùng các trạng thái:

```text
PREPARING
READY
EDITING_REVISION
SAVING_REVISION
REVISION_SAVED
WAITING_NEXT_CONFIRMATION
COMPLETED
CANCELLED
FAILED
```

Không bắt buộc đúng tên, nhưng cần tránh một đống boolean rời rạc gây race condition.

---

# 22. Quy tắc merge package giữa source revision và local revision

Tái sử dụng logic hiện có như:

```text
SOURCE_OWNED_PACKAGE_FIELDS
three_way_merge_field()
```

Không tạo merge engine khác nếu không cần.

Nguyên tắc:

```text
base source 00
local edited 00
source 01
```

### Nếu local không sửa field và source đổi

→ dùng source 01.

### Nếu local sửa field và source không đổi

→ giữ local.

### Nếu local và source đều đổi khác nhau

→ conflict rõ ràng hoặc rule nghiệp vụ đã xác định.

### Nếu là local-owned field

→ giữ local.

---

# 23. Hiệu năng

## Không gọi lại Mua Sắm Công sau mỗi popup

Luồng sai:

```text
fetch 00
save
YES 01
fetch upstream 01
save
YES 02
fetch upstream 02
```

Luồng đúng:

```text
fetch/prepare ALL một lần
       ↓
cache canonical/raw server-side
       ↓
00 từ session
       ↓
01 từ session
       ↓
02 từ session
```

## Có thể tối ưu thêm

Critical path:

```text
version list
+
revision 00
+
packages revision 00
```

để mở UI sớm.

Trong lúc user sửa 00, server có thể bounded-prefetch revision kế tiếp nếu kiến trúc hiện tại chưa lấy ALL ngay.

Không dùng concurrency vô hạn.

---

# 24. Backward compatibility

Các luồng sau không được bị phá:

- thêm Kế hoạch thủ công;
- sửa Kế hoạch thủ công;
- nâng version Kế hoạch do nghiệp vụ hiện tại;
- thêm Gói thầu thủ công;
- sửa Gói thầu thủ công;
- version Gói thầu hiện tại;
- delete version;
- package rebid;
- plan breakdown draft;
- server-side pagination;
- assignment;
- permissions;
- workspace isolation;
- sync/outbox;
- optimistic locking / rowVersion;
- provenance;
- notice import;
- opening import;
- contractor/investor workflows.

Nếu cần thay API, ưu tiên giữ compatibility hoặc migrate frontend/backend đồng bộ trong cùng thay đổi.

---

# 25. Security / permissions / data isolation

Bắt buộc bảo đảm:

1. Không dùng Import Session của organization khác.
2. Không dùng Import Session của workspace khác.
3. Không cho người không có quyền create/edit Kế hoạch tạo/import Kế hoạch.
4. Không cho người không có quyền Gói thầu chỉnh package draft rồi commit.
5. Auto-create Chủ đầu tư phải tuân quyền nghiệp vụ tương ứng.
6. Không lộ token/cookie/session Mua Sắm Công.
7. Không trả raw secret ra frontend.
8. Không cho frontend gửi arbitrary canonical payload rồi backend tin trực tiếp.
9. Backend phải dựa vào preview/session canonical đã lưu server-side.
10. Idempotency phải bảo đảm retry không sinh duplicate Plan/Package/Investor.

---

# 26. Transaction / consistency

Mỗi lần user bấm **Lưu kế hoạch** cho một revision:

- Plan revision;
- package revisions thuộc Plan revision đó;
- Chủ đầu tư mới nếu pending;
- assignment liên quan;
- provenance/binding;

phải có consistency rõ ràng.

Không được xảy ra tình trạng:

```text
Plan đã lưu
Package mới lưu 2/5
request lỗi
```

mà không có khả năng reconcile/resume.

Ưu tiên transaction server-side hoặc mutation aggregate hiện có.

---

# 27. Những file/khu vực cần nghiên cứu kỹ

Không mặc định rằng chỉ các file này mới cần sửa, nhưng tối thiểu phải kiểm tra:

## Frontend procurement

```text
frontend/procurement/PlanImportWizard.js
frontend/procurement/ProcurementImportClient.js
frontend/procurement/ProcurementInlineLookup.js
frontend/procurement/ProcurementLookupPreview.js
frontend/procurement/fieldMapping.js
```

## Frontend plans

```text
frontend/plans/KeHoachWorkflow.js
frontend/plans/planBreakdownDraft.js
```

## Frontend packages

```text
frontend/packages/GoiThauWorkflow.js
frontend/packages/packageLifecycleWorkflow.js
frontend/packages/packageAggregateSnapshot.js
frontend/packages/packageFormState.js
frontend/packages/packagePricing.js
```

## Frontend partners

```text
frontend/partners/ChuDauTuWorkflow.js
frontend/partners/PartnerFormController.js
frontend/partners/partnerTaxLookup.js
```

## Shared frontend services

```text
frontend/shared/MutationService.js
frontend/shared/VersionedEntityService.js
frontend/shared/AggregateVersionClient.js
frontend/shared/idUtils.js
```

## Backend procurement import

```text
backend/procurement_import/service.py
backend/procurement_import/routes.py
backend/procurement_import/domain.py
backend/procurement_import/command.py
backend/procurement_import/repository.py
```

## Backend Mua Sắm Công integration

Kiểm tra toàn bộ:

```text
backend/integrations/muasamcong_browser/
```

đặc biệt:

```text
procurement_source.py
canonical.py
collectors.mjs
integration_runtime.mjs
api_client.mjs
```

## Raw snapshot / provenance

Kiểm tra:

```text
backend/procurement_raw*
procurement_source_binding
procurement evidence/provenance tables
```

---

# 28. Không được bỏ qua code mới về Plan Breakdown Draft

Code hiện tại đã có cơ chế draft quan trọng:

```text
capturePlanBreakdownDraft
restorePlanBreakdownDraft
collectPlanBreakdownDraftChanges
isPlanBreakdownDraftActive
```

Phải tận dụng.

Không được quay về cách:

```text
Lưu Plan DB trước
→ rồi mới thêm Package
```

nếu workflow hiện tại đã được thiết kế để Plan + Packages có thể cùng nằm trong draft.

---

# 29. Không được bỏ qua authoritative aggregate versioning

Nếu code hiện tại có:

```text
createOfficialAggregateVersion
createNextVersion
snapshotPlanAggregate
snapshotPackageAggregate
```

phải phân tích kỹ và tái sử dụng.

Đặc biệt cần tránh các regression từng có dạng:

- Plan version mới bị reset trạng thái;
- người phụ trách bị mất;
- package snapshot thiếu predecessor;
- package thuộc sai plan snapshot;
- chỉnh thời gian tạo version không kế thừa đủ dữ liệu.

---

# 30. UX chi tiết

## Import Plan

Nên hiển thị:

```text
Mã KHLCNT: PL...
Đã tìm thấy: 3 phiên bản
Sẽ bắt đầu từ phiên bản: 00
```

Không cần hỏi user chọn `ALL/LATEST` trong workflow chính nếu yêu cầu sản phẩm là luôn xử lý lịch sử từ 00.

Có thể giữ option nâng cao nếu thật sự cần, nhưng default nghiệp vụ phải phù hợp yêu cầu.

## Sau save

Popup:

```text
Đã lưu phiên bản 00.

Còn phiên bản 01 trên Mua Sắm Công.
Bạn có muốn tiếp tục nhập phiên bản 01 không?

[Không] [Tiếp tục]
```

## Revision cuối

```text
Đã lưu phiên bản 02.
Đã hoàn tất toàn bộ phiên bản của Kế hoạch.
```

---

# 31. Cancel behavior

### Hủy khi đang sửa revision 00 trước commit

- rollback toàn bộ draft của 00;
- không để Plan/Package/Investor mới bị persist ngoài ý muốn.

### Hủy khi 00 đã commit và đang hỏi 01

- giữ 00;
- kết thúc session;
- không tự tạo 01.

### Hủy khi đang sửa 01 trước commit

- giữ 00;
- rollback draft 01;
- không làm thay đổi 00.

---

# 32. Resume behavior

Nếu người dùng:

- refresh browser;
- mất mạng;
- đóng modal;
- mở lại;

thì nếu Import Session còn hợp lệ nên có khả năng resume ở revision hiện tại hoặc ít nhất không mất dữ liệu đã commit.

Không được để server tự tiếp tục lưu các revision còn lại khi user chưa xác nhận.

---

# 33. Idempotency

Mỗi revision phải có idempotency key riêng.

Ví dụ logic:

```text
sessionId
+
entity family
+
revisionId
+
revisionDigest
```

Retry cùng revision:

- không tạo duplicate Plan;
- không tạo duplicate Package;
- không tạo duplicate Investor.

---

# 34. Provenance

Mỗi Plan/Package import từ Mua Sắm Công phải tiếp tục lưu:

```text
provider
familyNo
revisionId
revisionNumber
digest
localRootId
localSnapshotId
source binding
```

Nếu user sửa source-derived draft trước khi save:

- vẫn phải lưu canonical source snapshot;
- đồng thời local record lưu giá trị user đã xác nhận;
- không làm mất khả năng audit “nguồn ban đầu là gì”.

---

# 35. Field ownership

Phải phân biệt:

```text
Canonical source value
User-edited local value
```

Không ghi đè nguồn bằng dữ liệu user.

Không ghi đè user edit vào raw snapshot.

---

# 36. Tests bắt buộc — Unit

Viết unit tests cho tối thiểu:

### InvestorResolver

- tìm được theo org code;
- tìm được theo tax code nếu policy cho phép;
- chưa có → lookup external;
- normalize;
- duplicate race;
- retry idempotent;
- invalid source data;
- local record tồn tại giữa prepare và commit.

### Revision ordering

Input:

```text
02, 00, 01
```

Output:

```text
00, 01, 02
```

### SequentialRevisionController

- current;
- next;
- hasNext;
- cancel;
- complete;
- không skip revision;
- không quay ngược;
- không auto-advance khi save thất bại.

### Draft mapper

Plan canonical → Plan Draft.

Package canonical → Package Draft.

Multi-lot.

Missing optional fields.

Enum mapping.

Unknown enum không đoán bừa.

---

# 37. Tests bắt buộc — Integration backend

Tạo fixture có:

```text
Plan PL...
revision 00
revision 01
```

Revision 00:

```text
Package A
Package B
```

Revision 01:

```text
Package A changed
Package B changed
Package C added
```

Test:

1. prepare ALL chỉ fetch external một lần;
2. session có `00,01`;
3. lấy draft `00`;
4. commit `00`;
5. chưa commit `01`;
6. lấy draft `01`;
7. local fields từ `00` được kế thừa;
8. source fields của `01` được áp dụng;
9. commit `01`;
10. lineage/version đúng;
11. provenance đúng;
12. không duplicate package.

---

# 38. Tests bắt buộc — Investor integration

### Case 1

Investor đã tồn tại.

Expected:

```text
reuse local investor
no new investor
```

### Case 2

Investor chưa có.

Expected:

```text
lookup
normalize
create version 00
attach plan
```

### Case 3

User hủy trước commit.

Expected:

```text
no orphan investor
```

### Case 4

Hai request cùng tạo một investor.

Expected:

```text
1 record authoritative
2nd request resolves/reuses
```

---

# 39. Tests bắt buộc — Frontend workflow Plan

E2E hoặc integration DOM test:

```text
open add Plan
→ nhập mã PL
→ lấy MSC
→ dữ liệu 00 điền form
→ click Lưu thông tin
→ modal Phân khai mở
→ tab IV có package A/B
→ mở sửa package A
→ sửa giá
→ save draft package
→ quay lại tab IV thấy giá mới
→ click Lưu kế hoạch
→ revision 00 persist
→ popup hỏi 01
→ click Có
→ form 01 mở
→ package 01 đúng dữ liệu
→ save
→ hoàn tất
```

---

# 40. Tests bắt buộc — User chọn Không

```text
save 00
→ popup hỏi 01
→ user chọn Không
```

Expected:

```text
00 tồn tại
01 chưa tồn tại
session completed/cancelled cleanly
không có background apply
```

---

# 41. Tests bắt buộc — Hủy revision 01

```text
00 đã lưu
→ load 01
→ user chỉnh
→ user hủy
```

Expected:

```text
00 giữ nguyên
draft 01 rollback
01 chưa persist
```

---

# 42. Tests bắt buộc — Package import nhiều version

Fixture:

```text
IBxxxxxxxxxx
00
01
02
```

Test:

```text
prepare
→ form 00
→ save
→ hỏi 01
→ Có
→ form 01
→ save
→ hỏi 02
→ Có
→ form 02
→ save
```

Expected local versions:

```text
00
01
02
```

---

# 43. Tests regression bắt buộc cho CRUD/version hiện có

Sau thay đổi phải chạy lại:

- create Plan thủ công;
- edit Plan;
- Plan version;
- delete latest Plan version;
- delete full Plan family;
- create Package;
- edit Package;
- Package version;
- delete Package version;
- package rebid;
- package inheritance;
- Plan breakdown add/edit/delete package;
- assignments;
- ChuDauTu create/edit/version/delete;
- server-side pagination;
- workspace switch;
- permission denial.

---

# 44. Performance tests

Đo tối thiểu:

```text
prepare ALL cold
prepare ALL warm
load revision draft from session
switch 00 → 01
commit one revision
```

Mục tiêu:

- chuyển revision sau prepare không gọi upstream;
- không mở browser mới cho mỗi revision;
- không reload raw bundle nhiều lần không cần thiết;
- tránh N+1 query lớn.

---

# 45. Observability

Log/metrics cần phân biệt:

```text
prepareMs
sourceFetchMs
canonicalNormalizeMs
sessionReadMs
investorResolveMs
revisionCommitMs
cacheHit
cacheMiss
revisionNumber
```

Không log:

- token;
- cookie;
- secret;
- raw authentication data.

---

# 46. Error handling

Phân loại lỗi rõ:

```text
PROCUREMENT_NOT_FOUND
PROCUREMENT_REVISION_INVALID
PROCUREMENT_PREVIEW_STALE
PROCUREMENT_SESSION_EXPIRED
PROCUREMENT_INVESTOR_RESOLUTION_FAILED
PROCUREMENT_REQUIRED_FIELDS_MISSING
PROCUREMENT_FIELD_CONFLICT
PROCUREMENT_MATCH_AMBIGUOUS
PROCUREMENT_SOURCE_VERSION_CONFLICT
WORKSPACE_CHANGED
ORGANIZATION_ACCESS_DENIED
```

Có thể dùng code hiện có nếu đã tương đương.

---

# 47. Migration / database

Nếu thêm bảng Import Session:

- migration phải backward-compatible;
- index theo:
  - organization_id;
  - user_id;
  - family_no;
  - status;
  - expires_at;
- cleanup expired sessions;
- không lưu credential MSC.

---

# 48. Không được “giả lập click”

Auto-create Chủ đầu tư không được thực hiện bằng cách:

```text
mở modal
set input
dispatch click
submit form
```

Logic business phải được tách khỏi DOM để backend/frontend service có thể tái sử dụng trực tiếp.

---

# 49. Không duplicate business logic

Sau refactor cần tránh các cặp logic song song như:

```text
createInvestorFromForm()
createInvestorFromProcurement()
```

nếu cả hai có cùng nghiệp vụ.

Thay vào đó:

```text
build/validate/persist investor
```

là một implementation dùng chung.

Tương tự với:

```text
PackageDraftMapper
PlanDraftMapper
version mapping
```

---

# 50. Thứ tự triển khai khuyến nghị

## Phase 1 — Audit

- đọc code mới nhất;
- vẽ luồng hiện tại;
- xác định boundaries;
- liệt kê test hiện có;
- xác định API hiện đang commit thẳng.

## Phase 2 — Import Session

- prepare ALL;
- persistent/shared session;
- revision manifest;
- API revision draft.

## Phase 3 — Investor resolve-or-create

- refactor Partner/Investor business service;
- local lookup;
- external lookup;
- normalize;
- draft/persist;
- race protection.

## Phase 4 — Draft mapping

- PlanDraftMapper;
- PackageDraftMapper;
- source revision metadata.

## Phase 5 — Integrate Plan workflow

- PlanImportWizard chỉ prepare/start;
- load 00 vào Plan form;
- materialize packages vào plan breakdown draft;
- tab IV render sẵn.

## Phase 6 — Sequential revisions

- SequentialRevisionController;
- popup sau save;
- load next revision;
- cancel/complete/resume.

## Phase 7 — Package direct import

- bỏ hardcode `LATEST`;
- áp dụng sequential revision workflow.

## Phase 8 — Tests / hardening

- unit;
- integration;
- E2E;
- concurrency;
- regression;
- performance;
- security.

---

# 51. Acceptance Criteria bắt buộc

Chỉ coi là hoàn thành nếu tất cả điều sau đúng.

## AC-01

Nhập Plan MSC có investor đã có:

```text
reuse đúng investor
```

## AC-02

Investor chưa có:

```text
Bidding tự resolve/create
```

bằng cùng business logic với thêm Chủ đầu tư thủ công.

## AC-03

Không tạo orphan investor nếu user hủy trước commit.

## AC-04

Khi bấm **Lưu thông tin** modal Kế hoạch:

```text
modal Phân khai mở
```

và tab IV đã có gói của đúng revision.

## AC-05

Người dùng mở sửa được từng package draft bằng modal Gói thầu hiện tại.

## AC-06

Sửa package draft chưa ghi DB.

## AC-07

Bấm **Lưu kế hoạch** mới commit Plan + Packages của revision hiện tại.

## AC-08

Plan có nhiều revision:

```text
00 lưu trước
```

sau đó mới hỏi `01`.

## AC-09

Nếu user chọn Không:

```text
không lưu 01
```

## AC-10

Nếu user chọn Có:

```text
load 01 từ session/cache
```

không gọi MSC lại.

## AC-11

Source version:

```text
00 → local 00
01 → local 01
02 → local 02
```

## AC-12

Không dùng heuristic ngày/giờ để quyết định version đối với authoritative import.

## AC-13

Gói thầu direct import nhiều version cũng tuần tự 00 → 01 → ....

## AC-14

Local fields được kế thừa khi lên source revision mới.

## AC-15

Source fields áp dụng đúng dữ liệu revision mới.

## AC-16

Không mất assignment/trạng thái/snapshot lineage do tạo version.

## AC-17

Workspace khác không truy cập được import session.

## AC-18

Retry không sinh duplicate.

## AC-19

Raw payload/credential không bị lộ frontend/log.

## AC-20

Toàn bộ regression tests liên quan Plan/Package/Investor vẫn pass.

---

# 52. Yêu cầu Codex khi thực hiện

1. Không chỉ mô tả — hãy **thực sự chỉnh sửa code**.
2. Trước khi code:
   - nghiên cứu repo mới nhất;
   - ghi lại ngắn gọn luồng hiện tại;
   - chỉ ra nơi sẽ sửa.
3. Không tự ý xóa các tính năng đang hoạt động.
4. Không thay đổi dữ liệu DB production ngoài migration cần thiết.
5. Không hardcode fixture vào production.
6. Không dùng sleep/timeouts để che race condition.
7. Không swallow error.
8. Không bypass permission.
9. Không bypass rowVersion/CAS.
10. Không bypass explicit persistence changes.
11. Không bypass versioned entity service.
12. Ưu tiên reuse code hiện có.
13. Khi buộc phải refactor, giữ phạm vi rõ ràng.
14. Viết test cùng với code.
15. Chạy test sau khi sửa.
16. Sửa test cũ chỉ khi behavior yêu cầu thực sự thay đổi; không sửa test chỉ để làm pass.
17. Không giảm mức kiểm tra bảo mật hiện có.

---

# 53. Deliverables cuối cùng

Sau khi thực hiện xong, Codex phải trả về:

## A. Summary

```text
- Đã thay đổi gì
- Luồng mới hoạt động thế nào
```

## B. Files changed

Danh sách file.

## C. Database changes

Nếu có migration/schema.

## D. API changes

Endpoint/request/response mới hoặc thay đổi.

## E. Frontend workflow

Mô tả:

```text
Plan 00 → packages → save → hỏi 01 → ...
```

## F. Investor workflow

Mô tả resolve-existing / create-new.

## G. Tests

Liệt kê test đã thêm/chạy.

## H. Test results

Pass/fail cụ thể.

## I. Known limitations

Nếu còn.

## J. Manual verification checklist

Các bước click tay để tôi tự kiểm tra trên browser.

---

# 54. Kết quả sản phẩm mong muốn cuối cùng

## Kế hoạch

```text
Nhập PL...
   ↓
Lấy MSC
   ↓
Prepare 00,01,02
   ↓
Resolve Chủ đầu tư
   ↓
Mở Plan 00
   ↓
User sửa
   ↓
Lưu thông tin
   ↓
Phân khai
   ↓
Tab IV đã có packages 00
   ↓
User sửa packages
   ↓
Lưu
   ↓
Commit 00
   ↓
Hỏi 01
   ↓ Có
Plan 01
   ↓
packages 01
   ↓
Lưu
   ↓
Commit 01
   ↓
Hỏi 02
...
```

## Gói thầu trực tiếp

```text
Nhập IB...
   ↓
Prepare ALL
   ↓
Edit 00
   ↓
Save 00
   ↓
Hỏi 01
   ↓ Có
Edit 01
   ↓
Save 01
...
```

Đây là workflow cần đạt được.

---

# 55. Nguyên tắc thiết kế cuối cùng

Hãy bám các nguyên tắc sau:

```text
MSC = authoritative external source
Bidding = authoritative local workflow
```

```text
Prepare ALL ≠ Apply ALL
```

```text
External revision number = authoritative version number
```

```text
Import data phải đi qua workflow chỉnh sửa hiện hữu
```

```text
Không commit package trước khi user lưu Plan
```

```text
Không tạo duplicate Investor
```

```text
Không fetch upstream lại sau mỗi revision
```

```text
Không phá local-only fields khi source có version mới
```

```text
Không bypass versioning / CAS / permission / workspace isolation
```

Hãy triển khai theo hướng này trên code mới nhất của repository.
