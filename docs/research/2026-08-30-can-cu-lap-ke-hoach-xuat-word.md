# Nghiên cứu và kế hoạch: căn cứ lập Kế hoạch LCNT khi xuất Word

**Ngày khảo sát:** 2026-08-30  
**Trạng thái:** phương án nghiệp vụ đã được chủ sản phẩm chấp thuận; tài liệu này
là kế hoạch triển khai, chưa sửa production code, schema, migration, template hay
test
**Phạm vi:** Kế hoạch lựa chọn nhà thầu (Kế hoạch LCNT) và Word của kế hoạch

## 1. Kết luận

Khuyến nghị triển khai theo ba lớp tách biệt:

1. Lưu danh sách căn cứ có thứ tự trong child table version-owned
   `ke_hoach_can_cu`; mỗi dòng giữ câu người dùng nhập trong `noi_dung_goc`.
2. Người dùng chỉ nhập một câu tự nhiên. Backend dùng parser xác định, có phiên bản,
   để tách tên văn bản, số/ký hiệu, ngày ban hành, đơn vị ban hành và trích yếu khi
   tạo hoặc sửa căn cứ; kết quả phân tích được lưu cùng snapshot. Không phân tích
   lại khi xuất Word hoặc retry job. Read/Word projection dẫn xuất thêm `tenCanCu`
   từ `tenVanBan` và `trichYeu`; không persist hoặc nhận field dẫn xuất này từ client.
3. Mỗi lần xuất Word, client chỉ gửi các `id` được chọn. Server tải nội dung từ đúng
   kế hoạch đã authorize, lọc theo thứ tự authoritative rồi chỉ đưa tập đã chọn vào
   Word context.

`noi_dung_goc` là dữ liệu có thẩm quyền để hiển thị và xuất câu viện dẫn. Bốn trường
người dùng nêu, cùng trường `trich_yeu` đã được chấp thuận cho phần “về việc”, là
dữ liệu dẫn xuất: trường không chắc chắn phải để trống và đánh dấu
`PARTIAL`/`UNPARSED`, không được đoán hoặc làm mất câu gốc. Vì vậy việc parser không
nhận diện đủ không chặn lưu hay xuất Word; UI trả kết quả nhận diện để người dùng có
thể sửa lại chính câu nhập nếu muốn.

Lựa chọn xuất Word không ghi ngược vào kế hoạch. Direct export và background job
phải dùng chung selection resolver. Background job phải niêm phong danh sách ID đã
resolve trong job policy. Worker render/retry dùng context bất biến đã xếp hàng,
nhưng bước kiểm tra source authority khi hoàn tất dựng lại context từ dữ liệu hiện
hành; nếu policy không mang cùng selection, bước này có thể dựng tập compat-all và
báo sai `DOCUMENT_EXPORT_SOURCE_CHANGED`.

Không chọn JSON-in-column làm phương án chính. Child table tạo được identity/FK,
tenant-scoped lookup, validation ownership, delete policy, version comparison và
stable selection rõ ràng hơn. JSON `TEXT` làm các invariant đó phụ thuộc vào parser
và application validation, trong khi selection của Word tham chiếu trực tiếp từng
item.

Các quyết định MVP đã xác nhận và những mở rộng bị hoãn được tách riêng ở mục 12.
Phần đã xác nhận được ghi trong ADR 0030, kèm compatibility impact, migration strategy
và regression tests theo `AGENTS.md`; mở rộng bị hoãn không được tự đưa vào implementation.

## 2. Business contract phải giữ nguyên

- Người dùng đã có quyền đọc Kế hoạch LCNT được xem đầy đủ danh sách căn cứ trên
  màn hình/API; không thêm masking, redaction hay capability đọc riêng.
- Chỉ actor có quyền sửa kế hoạch theo authorization hiện hữu mới được thay đổi
  danh sách. Không suy diễn quyền sửa từ quyền đọc hoặc Word entitlement.
- Word entitlement chỉ gate hành động tạo/tải Word; không dùng để mở hoặc che dữ
  liệu trên API/màn hình kế hoạch.
- Không thay đổi role, module permission, record scope, assignment scope,
  entitlement, inheritance hay default allow/deny.
- Vẫn giữ tenant isolation, module permission, assignment scope, record-level
  authorization, session checks và audit hiện hành.
- ID client gửi khi xuất chỉ là tham chiếu lựa chọn. Server không nhận nội dung căn
  cứ từ request xuất Word và không tra cứu ngoài kế hoạch đã authorize.
- Selection là input của một lần xuất; không cập nhật danh sách đã lưu.

## 3. Inventory các seam hiện hữu

| Seam | Authority hiện hữu | Việc cần làm khi triển khai |
|---|---|---|
| Schema kế hoạch/child | `backend/db/schema.py:502-577` | Thêm `ke_hoach_can_cu` theo mẫu tenant-owned child gần `ke_hoach_cong_viec`, không thêm JSON column vào row kế hoạch. |
| Child persistence/attach | `backend/sync/mapper.py:59-63,143-201,766-862` | Đăng ký key mới, save có missing/present semantics, tenant/parent validation và attach rows có thứ tự. |
| Child projection | `backend/sync/child_projection.py:17-48` | Thêm formatter cho câu gốc, năm trường parser, `tenCanCu` dẫn xuất, trạng thái và phiên bản parser. |
| Payload validation | `backend/sync/payload_validation.py:72-87,102-140,607-651` | Write payload chỉ nhận `{id?, noiDungGoc}`; validator riêng cho shape, ID, nội dung, duplicate và limits. Các trường phân tích là server-owned. |
| Parser căn cứ | Chưa có seam tương đương | Tạo parser nghiệp vụ riêng, xác định và có phiên bản. Có thể tái dùng utility ngày/text sau bước extract; không dùng Word standardizer, AI/legal search hay knowledge ingestion làm parser persistence. |
| Outbound frontend | `frontend/app/outboundSerializer.js:20-36,75-91` | Thêm `canCuLapKeHoachList` vào `CHILD_FIELDS_BY_TABLE.ke_hoach_lcnt`; giữ phân biệt field bị thiếu và `[]`. |
| ID convention | `backend/db/id_utils.py:5-45`; `frontend/shared/idUtils.js:1-24` | Đăng ký prefix/type cho global PK của `ke_hoach_can_cu`; không dùng array index làm ID. |
| Read APIs | `backend/sync/read_service.py:238-245,715-723`; `backend/sync/pagination.py:563-570` | Attach đầy đủ child list cho authorized plan ở full read và pagination. Word entitlement không tham gia. |
| Backend plan version | `backend/versioning/repository.py:171-226`; `backend/versioning/command.py:334-360`; `backend/versioning/aggregate_snapshot.py` | State loader phải attach child trước khi deep-clone sang plan version mới; giữ nội dung/thứ tự nhưng cấp global PK mới. Không copy physical child ID. |
| Frontend draft/version | `frontend/plans/PlanVersionDraftSession.js:91-152,470-520`; `frontend/shared/VersionedEntityService.js:9-15,112-124`; `frontend/plans/planAggregateSnapshot.js:11-75`; `frontend/plans/KeHoachWorkflow.js:1367-1407` | Kiểm tra cả durable draft và legacy aggregate clone đều đưa child list vào version command đúng một lần. |
| Version comparison | `backend/version_comparison/read_repository.py:18-20,41-45,316-325`; `backend/version_comparison/relation_policies.py:14-48` | Đăng ký attachment/relation và business comparison policy; không dùng physical child ID giữa hai plan version. |
| Delete/archive policy | `backend/sync/delete_policy.py:38-42,67-70` | Đăng ký `ke_hoach_can_cu` bên cạnh plan children để blocking/cascade-impact report không bỏ sót row. Exact delete semantics phải theo policy hiện hữu. |
| Form/detail kế hoạch | `views/modals/modal_kehoach.html:25-233`; `frontend/plans/KeHoachWorkflow.js:296-580,646-790`; `frontend/plans/KeHoachView.js:139-484` | Thêm repeatable editor một ô text/căn cứ, hiển thị projection/status từ server sau save/read và full read-only display; giữ ID khi edit/reorder trong cùng version. |
| Import/source revision | `frontend/procurement/ProcurementDraftWorkflow.js:551-579,716-754`; `frontend/procurement/PlanImportWizard.js:1360-1460` | Clone/merge thực tế nằm ở `ProcurementDraftWorkflow`; wizard chủ yếu điều phối. Áp dụng cùng update contract: thiếu field thì preserve, có `[]` mới clear; không silently overwrite dữ liệu nhập tay. |
| Dialog Word | `views/tabs/tab_xuatban_word.html:77-120`; `frontend/documents/WordPublication.js:303-395` | Hiện mới chọn template; thêm checkbox chỉ cho plan publication scope. |
| Request Word | `frontend/documents/WordPublication.js:403-517`; `frontend/documents/WordPublicationState.js:65-75` | Thêm selection IDs và phân biệt field thiếu với explicit `[]`. |
| Document policy | `frontend/documents/WordPublicationPolicy.js:27-37` | `procurement_plan` là plan document; package documents giữ nguyên nếu chưa được duyệt. |
| Direct/background routes | `backend/documents/routes_docx.py:1335-1419`; `backend/documents/document_job_routes.py:385-439`; `backend/app.py:1032` | Hai route phải gọi cùng authoritative selection resolver; thêm POST direct-export trên path hiện hữu và giữ GET cũ cần cập nhật route registry. |
| Plan render context | `backend/documents/docx_service.py:332-422`; `backend/documents/routes_docx.py:1038-1101` | Chỉ inject selected projection vào template-visible context. |
| Context/mapping/manifest | `backend/documents/docx_context_policy.py:187-196,362-372,431-500,625-682,710-750,824-883`; `backend/documents/docx_mapping_service.py:38-260`; `backend/documents/word_defaults.py:11,384-430,445-505` | Thêm selected internal source + custom list alias, không thêm alias vào reserved `PLAN_ROOT_SPECS`; tăng `WORD_DEFAULT_MAPPINGS_VERSION` từ 15 lên 16 và regenerate frontend manifest. |
| Job digest/source authority | `backend/documents/document_job_policy.py:16,48-54`; `backend/documents/document_source_authority.py:13-57` | Policy hiện v2 và worker rebuild chưa biết selection; cần policy v3 nhưng vẫn đọc queued v1/v2. |
| Audit | `backend/documents/document_job_routes.py:259-275,487-529`; `backend/documents/routes_docx.py:1270-1333` | Audit IDs/count/hash/mode, không cần nhân bản free-text. |
| Migration/contracts | `backend/db/upgrades.py:3339-3753`; `scripts/generate_postgres_schema_contract.py:1-20,102-201` | Schema hiện v81; migration đề xuất v82 và regenerate SQLite/frontend/PostgreSQL contracts. |
| Template lifecycle | `docs/adr/0010-immutable-word-template-lifecycle.md` | Template có loop mới phải publish thành version mới; không mutate published bytes. |

Hai seam dễ bỏ sót nhất:

- Child field chỉ được xóa khi payload có key với giá trị `[]`. Nếu mapper mặc định
  missing thành `[]`, một update cũ/partial sẽ làm mất toàn bộ căn cứ.
- `document_source_digest` hash exact context/manifest. Payload render đã xếp hàng
  là bất biến, nhưng nếu selection chỉ tồn tại lúc enqueue mà không nằm trong job
  policy thì bước source-authority ở completion không thể dựng lại đúng selected
  source để đối chiếu digest.

## 4. Mô hình dữ liệu và update contract

### 4.1 Child table đề xuất

```text
ke_hoach_can_cu
  id               TEXT PRIMARY KEY
  id_goc           TEXT NOT NULL
  organization_id  TEXT NOT NULL
  owner_type        TEXT NOT NULL
  ke_hoach_id       TEXT NOT NULL
  noi_dung_goc      TEXT NOT NULL
  ten_van_ban       TEXT
  so_van_ban        TEXT
  ngay_ban_hanh     TEXT
  don_vi_ban_hanh   TEXT
  trich_yeu         TEXT
  parse_status      TEXT NOT NULL
  parse_version     TEXT NOT NULL
  sort_order        INTEGER NOT NULL
  sync_version      INTEGER NOT NULL DEFAULT 0
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL
```

`trich_yeu` là thành phần nguồn đã được duyệt. Không thêm cột `ten_can_cu`:
`tenCanCu`/`ten_can_cu` là projection dẫn xuất từ `ten_van_ban` và `trich_yeu`, nên
không tạo thêm persistence authority có thể lệch hai thành phần nguồn.

Constraints/index cần có:

- FK đến `ke_hoach_lcnt`, `ON DELETE RESTRICT`, theo convention plan child hiện
  hữu;
- invariant parent và child cùng `organization_id`; ưu tiên composite FK nếu hai DB
  contract hỗ trợ, nếu không dùng FK hiện hữu cộng authoritative parent lookup và
  regression test bắt buộc;
- check `owner_type`, `sort_order >= 0`, `trim(noi_dung_goc) != ''`,
  `parse_status IN ('PARSED', 'PARTIAL', 'UNPARSED')`, ngày nullable nhưng nếu có
  phải là ngày lịch hợp lệ, và limits đã chốt;
- index `(organization_id, ke_hoach_id, sort_order, id)`;
- unique `(organization_id, ke_hoach_id, id_goc)` để một logical căn cứ chỉ xuất
  hiện một lần trong một snapshot kế hoạch;
- ID từ global record-ID convention, không ghép từ index/order.

API/read model:

```json
{
  "canCuLapKeHoachList": [
    {
      "id": "khcc-...",
      "rootId": "khcc-...",
      "noiDungGoc": "Luật Đấu thầu số 22/2023/QH15 ngày 23/6/2023 của Quốc hội",
      "tenVanBan": "Luật Đấu thầu",
      "soVanBan": "22/2023/QH15",
      "ngayBanHanh": "2023-06-23",
      "donViBanHanh": "Quốc hội",
      "trichYeu": null,
      "tenCanCu": "Luật Đấu thầu",
      "parseStatus": "PARSED",
      "parseVersion": "can-cu-citation-v1"
    }
  ]
}
```

Thứ tự mảng là business order; `sort_order` là persistence detail. ID ổn định khi
sửa nội dung hoặc reorder trong cùng plan version. `id_goc` là logical lineage ID và
được API ánh xạ thành `rootId` theo convention hiện hữu tại
`backend/sync/payload_mapping.py:25-37`. Item đầu tiên có `id_goc = id`; khi clone sang plan version mới, server deep-clone
câu gốc, kết quả parse, trạng thái, phiên bản parser và thứ tự, giữ `id_goc` nhưng
cấp physical `id` mới theo global PK convention. Nhờ vậy mỗi child chỉ thuộc một
version, FK không trỏ chéo snapshot, còn version comparison vẫn nhận diện được cùng
một căn cứ. Xóa rồi thêm lại tạo lineage mới.

### 4.2 Contract nhập text và parser backend

Contract field canonical đã chốt phải dùng nhất quán:

| Ý nghĩa | Persistence | API/read model | Word item |
|---|---|---|---|
| Câu người dùng nhập | `noi_dung_goc` | `noiDungGoc` | `noi_dung_goc` |
| Tên/loại văn bản | `ten_van_ban` | `tenVanBan` | `ten_van_ban` |
| Số/ký hiệu văn bản | `so_van_ban` | `soVanBan` | `so_van_ban` |
| Ngày ban hành | `ngay_ban_hanh` | `ngayBanHanh` | `ngay_ban_hanh` |
| Đơn vị ban hành | `don_vi_ban_hanh` | `donViBanHanh` | `don_vi_ban_hanh` |
| Trích yếu | `trich_yeu` | `trichYeu` | `trich_yeu` |
| Tên căn cứ dẫn xuất | Không persist | `tenCanCu` | `ten_can_cu` |

`ngay_ban_hanh` là date-only nullable, lưu canonical `YYYY-MM-DD`; API ghi không
nhận định dạng ngày linh hoạt. PostgreSQL schema generator hiện suy kiểu các cột có
prefix `ngay_` sang date tại `backend/db/postgres_schema.py:164-188`, nên migration
SQLite và generated PostgreSQL contract phải có test đồng nhất kiểu/validation.

Write payload của một item chỉ chứa dữ liệu người dùng làm chủ:

```json
{
  "id": "khcc-...",
  "noiDungGoc": "Luật Đấu thầu số 22/2023/QH15 ngày 23/6/2023 của Quốc hội"
}
```

Backend không tin hoặc persist các trường `tenVanBan`, `soVanBan`, `ngayBanHanh`,
`donViBanHanh`, `trichYeu`, `tenCanCu`, `parseStatus`, `parseVersion` do client gửi
trong flow lưu kế hoạch.
`rootId` của item mới và lineage khi clone cũng do server kiểm soát; normal write
payload không nhận field này từ client.
Khi `noiDungGoc` thay đổi, server chạy parser hiện hành đúng một lần trong cùng
transaction lưu, rồi persist cả câu gốc và projection đã tách. Khi chỉ reorder hoặc
clone version, giữ nguyên kết quả và `parseVersion`; không tự reparse bằng rule mới.

Ví dụ:

```text
Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC về việc phê duyệt dự toán
```

được tách thành:

```json
{
  "noiDungGoc": "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC về việc phê duyệt dự toán",
  "tenVanBan": "Quyết định",
  "soVanBan": "123/QĐ",
  "ngayBanHanh": "2025-11-11",
  "donViBanHanh": "UBND xã ABC",
  "trichYeu": "phê duyệt dự toán",
  "tenCanCu": "Quyết định về việc phê duyệt dự toán",
  "parseStatus": "PARSED",
  "parseVersion": "can-cu-citation-v1"
}
```

`soVanBan` bắt buộc là text vì số/ký hiệu thường chứa chữ, dấu gạch và dấu `/`.
`tenVanBan` là loại hoặc tên văn bản (`Quyết định`), còn `trichYeu` là nội dung sau
mốc “về việc” (`phê duyệt dự toán`). `tenCanCu` là giá trị dẫn xuất thuận tiện cho
API/Word, không phải parser field: khi có cả hai thành phần, ghép
`<tenVanBan> về việc <trichYeu>`; khi chỉ có một thành phần, dùng thành phần đó; khi
cả hai vắng, trả chuỗi rỗng. Không ghi ngược `tenCanCu` vào persistence và không dùng
nó để dựng lại câu viện dẫn, vì số/ngày/đơn vị nằm giữa tên văn bản và trích yếu trong
câu gốc. `ngayBanHanh`
là ngày ban hành hoặc ngày ký được viện dẫn, không phải ngày hiệu lực. Nếu nghiệp vụ
muốn một loại ngày khác thì phải đổi tên field trước khi triển khai, không để parser
tự suy đoán giữa nhiều mốc ngày.
Parser dùng bản sao đã normalize Unicode/whitespace chỉ để so khớp; không rewrite
case, dấu câu hoặc nội dung của `noiDungGoc`. Grammar v1 nên nhận ít nhất:

- tiền tố `Căn cứ` tùy chọn;
- mốc `số ...`, `ngày d/m/yyyy` và `ngày d tháng m năm yyyy`;
- đơn vị sau `của ...` hoặc dạng `do ... ban hành`;
- trích yếu tùy chọn sau mốc `về việc ...`;
- dấu chấm/chấm phẩy cuối câu tùy chọn.

Trong câu mẫu, `Căn cứ`, `số`, `ngày`, `của` và `về việc` là từ nối trình bày,
không nằm trong giá trị của năm trường dẫn xuất. Parser v1 dùng các mốc theo thứ tự:

```text
[Căn cứ]? <tên văn bản> số <số/ký hiệu> ngày <ngày>
(của <đơn vị> | do <đơn vị> ban hành) [về việc <trích yếu>]
```

Một item/textbox chỉ đại diện cho một căn cứ. Nếu một câu chứa nhiều văn bản, parser
trả `PARTIAL` với cảnh báo `MULTIPLE_BASES_DETECTED`; backend không tự tách child
rows theo dấu chấm, dấu `;` hoặc từ “và”, vì các dấu này cũng có thể nằm trong tên
và trích yếu. Người dùng chủ động tách thành nhiều dòng để mỗi dòng có identity và
checkbox Word ổn định.

Định nghĩa trạng thái:

| Trạng thái | Semantics |
|---|---|
| `PARSED` | Các trường bắt buộc được nhận diện duy nhất, ngày hợp lệ; `trich_yeu` có thể vắng nếu câu không có mốc “về việc”. |
| `PARTIAL` | Nhận diện an toàn được một phần; trường thiếu, sai ngày hoặc có nhiều ứng viên để `null`. |
| `UNPARSED` | Không tách được trường nào một cách an toàn; vẫn giữ và dùng câu gốc. |

Các ambiguity code tối thiểu nên có `MULTIPLE_BASES_DETECTED`, `MULTIPLE_DATES`,
`INVALID_DATE` và `MISSING_*`. Parser không chọn ứng viên đầu tiên khi có nhiều kết
quả. `parseStatus` mô tả kết quả máy; nếu sau này cho phép sửa năm trường riêng thì
thêm `reviewStatus` (`PENDING`, `CONFIRMED`, `CORRECTED`) thay vì trộn xác nhận của
người dùng vào `parseStatus`.

Không dùng LLM hay tra cứu mạng để điền phần thiếu; không tự liên kết sang
`legal_instrument_version`. Audit source code xác nhận repo chưa có parser
deterministic tách đủ năm phần:

- `backend/shared/date_utils.py:25-72` có `parse_datetime_value` và
  `normalize_date_value`; chỉ tái dùng sau khi parser đã extract ứng viên, không dùng
  làm validator API linh hoạt cho `ngayBanHanh`.
- `backend/shared/text_utils.py:17-25,48-85` có utility Unicode/whitespace/identifier;
  parser chỉ dùng trên bản sao để so khớp, không rewrite `noi_dung_goc`.
- `backend/documents/custom_exporter.py:274-360,420-493` có regex/format ngày tiếng
  Việt phục vụ render Word, không phải persistence authority.
- Word standardizer chỉ nhận diện toàn đoạn “Căn cứ”
  (`backend/documents/word_standardizer/engine.py:987-996` và
  `backend/documents/word_standardizer/rules/semantic_fields.json:7-16`); contract
  của module là giữ business text, không tách năm field.
- Legal search chỉ trích ngày gần từ “ban hành/issued”
  (`backend/ai/providers/legal_search.py:79-107,139-176`), còn knowledge ingestion
  và legal catalog nhận metadata đã tách sẵn
  (`backend/ai/knowledge/ingestion.py:56-105`,
  `backend/legal_versioning/routes.py:172-185`,
  `backend/legal_versioning/service.py:82-97`). Không seam nào trong số này được dùng
  làm parser nghiệp vụ mới.

Vì vậy cần một pure domain parser riêng, version cố định như
`can-cu-citation-v1`. Parser chạy sau authorization và trước persistence, đúng một
lần khi tạo item hoặc khi `noiDungGoc` thay đổi. Nó không chạy khi read, render Word,
retry job, reorder hay clone plan version. Derived fields, `parseStatus` và
`parseVersion` là server-owned; parser không gọi network/LLM và không đoán khi có
nhiều ứng viên.

Nếu mục tiêu duy nhất là in nguyên câu vào Word thì năm trường dẫn xuất không phải
điều kiện bắt buộc của MVP. Trong phạm vi đã được yêu cầu, chúng vẫn phải trở thành
Word variables độc lập để người thiết kế biểu mẫu tùy chọn thành phần; field `null`
render rỗng, tuyệt đối không dựng lại bằng suy đoán.

### 4.3 Semantics create/update/import

| Payload kế hoạch | Semantics |
|---|---|
| Không có `canCuLapKeHoachList` | Preserve collection đang lưu. |
| `canCuLapKeHoachList: []` | Explicit clear: xóa toàn bộ child rows của plan đó theo delete policy. |
| Mảng có item | Atomic replace/reconcile theo đúng thứ tự mảng. |

Với mảng có item, retained ID phải thuộc đúng plan và organization; ID trùng, ID
của plan/tenant khác hoặc shape sai làm fail toàn request. Item mới nhận ID theo
record-ID convention. Không silently drop item, không nhận `organizationId`,
`ownerType`, `keHoachId` hay `sortOrder` từ child payload làm authority; server lấy
các giá trị này từ parent và vị trí đã validate.

Import/source revision dùng cùng contract: source không có field thì preserve; chỉ
field hiện diện với `[]` mới clear. Nếu source có list, flow phải hiển thị/confirm
việc replace theo UX hiện hữu, không tự merge theo nội dung.

### 4.4 Validation

- Root phải là array; write item chỉ nhận shape được duyệt `{id?, noiDungGoc}`.
- `noiDungGoc` bắt buộc sau trim; giữ Unicode, case, dấu câu và xuống dòng có chủ đích.
- ID có mặt phải đúng convention và duy nhất trong request; server kiểm tra tenant,
  parent ownership trước mutation.
- Parse thiếu không phải validation error. Chỉ blank/oversize/wrong shape làm request
  thất bại; `PARTIAL`/`UNPARSED` vẫn được lưu để không làm mất dữ liệu người dùng.
- Dùng contract đồng bộ hiện hữu: tối đa `MAX_SYNC_CHILD_ITEMS = 500` căn cứ và
  `MAX_SYNC_TEXT_LENGTH = 100_000` ký tự cho mỗi `noiDungGoc`; UI phản ánh cùng giới
  hạn nhưng server vẫn là authority. Không thêm giới hạn tổng riêng, không cắt ngầm
  nội dung; request vẫn chịu body/request limits dùng chung của hệ thống.
- Error chỉ đúng item/index; không parse object/string lẫn lộn và không bỏ qua row.

### 4.5 Alternative bị loại: JSON column

`can_cu_lap_ke_hoach_list TEXT` có lợi thế ít DDL, và hậu tố `_list` được mapping
hiện hữu nhận diện. Tuy nhiên strict validator hiện xử lý `TEXT` như string trước
generic JSON seam (`backend/sync/payload_validation.py:421-434,500-682,876-896`).
Quan trọng hơn, JSON không có child FK/tenant column, khó validate retained ID thuộc
đúng plan, khó gắn delete/version-comparison policy và làm stable selection hoàn
toàn phụ thuộc application parser. Vì selection Word dùng item ID như provenance,
child table là mô hình chính phù hợp hơn.

Không dùng `plan_legal_binding` cho free-text. Mô hình tại
`backend/db/schema.py:2714-2934` và ADR
`docs/adr/0009-legal-binding-and-deterministic-compliance.md` pin exact legal
policy/instrument version, có semantics khác. Nếu product yêu cầu exact legal link,
đó là một thiết kế quan hệ khác cần chốt riêng.

## 5. UX kế hoạch và dialog xuất Word

Form Kế hoạch LCNT thêm repeatable rows nhưng mỗi dòng chỉ có một ô text tự nhiên:
thêm, sửa, xóa, reorder; validation gắn đúng dòng; thao tác edit/reorder giữ ID trong
cùng version. Sau khi backend lưu và trả read model, UI hiển thị tóm tắt năm phần đã nhận diện
và cảnh báo không chặn với `PARTIAL`/`UNPARSED`. Người dùng sửa chính câu gốc rồi
parse lại; MVP không bắt nhập năm ô riêng và không cho client ghi đè projection của
server. Detail view hiển thị đầy đủ câu gốc và metadata đã tách theo thứ tự cho mọi
actor đã có quyền đọc plan, không kiểm tra Word entitlement.

MVP không thêm endpoint parse-preview riêng và không chạy parser thứ hai ở frontend.
Parser authoritative chạy trong create/update; UI dùng projection trong response/read
model sau khi lưu. Preview trước khi lưu hoặc manual override từng field là phạm vi
sau, cần contract endpoint và authorization riêng nếu được yêu cầu.

Khi publication type là plan/`procurement_plan`, dialog xuất Word hiển thị checkbox
căn cứ, “Chọn tất cả” và “Bỏ chọn tất cả”. Contract MVP:

- mở dialog chọn tất cả;
- list rỗng có empty state và vẫn cho xuất;
- explicit chọn zero được biểu diễn bằng `[]`;
- đóng/mở lại dialog dựng selection mới từ plan, không persist vào plan;
- mỗi checkbox dùng `noiDungGoc` làm nhãn chính; metadata đã tách chỉ là dòng phụ,
  nên parser thiếu vẫn không làm căn cứ biến mất;
- package documents và điều kiện chọn package hiện hữu không đổi;
- hỗ trợ keyboard, focus, screen reader, loading/error và màn hình hẹp.

Phân biệt hai lựa chọn: dialog của **mỗi lần xuất** chọn những căn cứ (row IDs) được
đưa vào Word; checklist trong **Từ điển/thiết kế biểu mẫu** chọn những trường cấu
trúc tạo thành snippet. MVP không cho đổi bố cục trường ở mỗi lần xuất, vì template
đã xác định vị trí và câu chữ. Nếu sản phẩm muốn chọn field lại trong từng lần xuất
thì đó là input publication riêng, phải chốt thêm contract và job replay thay vì
ngầm dùng cùng selection IDs.

## 6. Contract selection khi xuất

Tên transport đề xuất: `selectedCanCuLapKeHoachIds`.

| Input xuất Word | Contract MVP |
|---|---|
| Field không có | Client cũ: resolve tất cả child IDs hiện hữu tại thời điểm request. |
| `[]` | Người dùng chủ động không đưa căn cứ nào vào Word. |
| `[id1, id2, ...]` | Chỉ đưa các child rows có ID này vào Word. |

Đây là contract khác với update plan: missing selection nghĩa là compatibility-all,
còn missing `canCuLapKeHoachList` trong update plan nghĩa là preserve.

Pipeline dùng chung:

```text
request + session
  -> authorize tenant/module/assignment/record + Word action
  -> tải plan và child rows trong đúng tenant
  -> validate selection shape/duplicate/unknown/foreign IDs
  -> lọc theo sort_order, id từ server
  -> tạo selected projection
  -> direct render hoặc seal selection vào durable job policy
  -> render template chỉ với selected projection
```

Client chỉ gửi IDs, không gửi nội dung. Unknown/duplicate/foreign ID làm reject cả
request; error không được tiết lộ bản ghi ngoài scope. Server order thắng client
order. Selection không mutation plan.

Direct route hiện là GET. Với nhiều global IDs, query string có thể vượt giới hạn
proxy/browser. Thêm POST trên cùng `/api/export-plan/{plan_id}` nhận JSON body và giữ
GET cũ với semantics missing-selection/compat-all. Background route POST nhận cùng
field JSON; hai route dùng chung resolver và validation.

## 7. Word context, mappings và template

Selected projection đề xuất:

```json
{
  "ds_can_cu_lap_ke_hoach": [
    {
      "id": "khcc-...",
      "stt": 1,
      "noi_dung_goc": "Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC về việc phê duyệt dự toán",
      "ten_van_ban": "Quyết định",
      "so_van_ban": "123/QĐ",
      "ngay_ban_hanh": "2025-11-11",
      "S_ngay_ban_hanh": "11/11/2025",
      "don_vi_ban_hanh": "UBND xã ABC",
      "trich_yeu": "phê duyệt dự toán",
      "ten_can_cu": "Quyết định về việc phê duyệt dự toán",
      "cum_so_van_ban": " số 123/QĐ",
      "cum_ngay_ban_hanh": " ngày 11/11/2025",
      "cum_don_vi_ban_hanh": " của UBND xã ABC",
      "cum_trich_yeu": " về việc phê duyệt dự toán",
      "parse_status": "PARSED"
    }
  ]
}
```

Chỉ có **một** list root được phép nhìn thấy từ template:
`ds_can_cu_lap_ke_hoach`. Đây là selected-only list. Không tạo hai list mappings
“nguyên văn” và “tách trường” cùng nguồn vì registry hiện cấm trùng
`(source_table, source_column)`; hai collection cũng có nguy cơ lệch selection và
thứ tự. Hai loại ánh xạ là hai nhóm/recipe UI trên cùng list root.

Nhóm **Căn cứ — nguyên văn** cung cấp nút sao chép cả khối:

```text
{#ds_can_cu_lap_ke_hoach}
{noi_dung_goc}
{/ds_can_cu_lap_ke_hoach}
```

Nhóm **Căn cứ — tách trường** cung cấp từng biến item:

| Biến | Giá trị của câu mẫu |
|---|---|
| `{stt}` | `1`, `2`, ... theo thứ tự các căn cứ đã chọn |
| `{ten_can_cu}` | `Quyết định về việc phê duyệt dự toán` |
| `{ten_van_ban}` | `Quyết định` |
| `{so_van_ban}` | `123/QĐ` |
| `{ngay_ban_hanh}` | Ngày theo format dài của renderer |
| `{S_ngay_ban_hanh}` | `11/11/2025` theo quy tắc ngày ngắn hiện hữu |
| `{don_vi_ban_hanh}` | `UBND xã ABC` |
| `{trich_yeu}` | `phê duyệt dự toán` |

Đây là **item variables**, chỉ có contract bên trong loop. Cách đặt tên trực tiếp
theo field tuân theo convention danh sách hiện hữu; sample Word đang dùng
`{#ds_to_chuyen_gia}{ho_ten}...` và `{#ds_mo_thau}{ten_nha_thau}...`, còn alias biến
đơn không được coi là field của từng item. Vì vậy chỉ cần registry mapping
`list:ke_hoach_can_cu`; các item fields được dictionary mô tả như metadata của loop,
không tạo các scalar mappings `field:ke_hoach_can_cu.*` vốn có thể biến alias thành
giá trị của item cuối.

Trong UI, `{ten_can_cu}` là lựa chọn chính, thuận tiện cho ô/bảng chỉ cần một tên
căn cứ. `{ten_van_ban}` và `{trich_yeu}` vẫn nằm trong nhóm nâng cao để người thiết
kế biểu mẫu tách riêng khi cần. Không dùng `{ten_can_cu}` trong recipe dựng lại câu
viện dẫn chuẩn; dùng `{noi_dung_goc}` hoặc recipe component bên dưới để giữ đúng vị
trí số, ngày và đơn vị ban hành.

Để người dùng chọn subset trường mà không sinh từ nối treo khi parser thiếu dữ liệu,
Word DTO còn cung cấp các helper presentation-only: `{cum_so_van_ban}`,
`{cum_ngay_ban_hanh}`, `{cum_don_vi_ban_hanh}` và
`{cum_trich_yeu}`. Mỗi helper đã gồm từ nối đầu câu và trả chuỗi rỗng nếu giá trị
nguồn vắng. UI builder có checklist, preview và nút sao chép cả khối. Khi người dùng
chỉ chọn một phần trường, builder vẫn giữ thứ tự ngữ nghĩa cố định (tên → số → ngày
→ đơn vị → trích yếu), không theo thứ tự click. Ví dụ đầy đủ:

```text
{#ds_can_cu_lap_ke_hoach}
Căn cứ {ten_van_ban}{cum_so_van_ban}{cum_ngay_ban_hanh}{cum_don_vi_ban_hanh}{cum_trich_yeu}
{/ds_can_cu_lap_ke_hoach}
```

Các `cum_*` không persist và không phải parser authority. Các biến raw theo từng
trường vẫn có sẵn để làm bảng hoặc bố cục nâng cao. Không yêu cầu người dùng tự viết
Jinja `if`, vì cú pháp đó khó thao tác và có seam preflight riêng.

`noi_dung_goc` luôn lấy trực tiếp từ persisted `noi_dung_goc`, không dựng lại từ
năm trường và không chạy parser lúc render. Trước render, DTO phải materialize **đủ
mọi key** trên mọi selected item và đổi derived `null` thành `""`; nếu không mapper
hiện hữu có thể gặp StrictUndefined hoặc Word in ra literal `None`. Nhờ vậy
output nguyên văn vẫn đúng ngay cả khi parser `PARTIAL`/`UNPARSED`, còn output cấu
trúc không lỗi và không có từ nối thừa.

Không đưa full persisted collection vào template-visible context bên cạnh selected
projection; nếu không template có thể bỏ qua lựa chọn. Đây chỉ là giới hạn Word
context, không phải masking API/read model.

`ds_can_cu_lap_ke_hoach` phải là **custom list mapping alias**, không phải fixed root
trong `PLAN_ROOT_SPECS`: validator hiện từ chối mapping có tên trùng một reserved
system root. Render context giữ selected DTO dưới source key nội bộ
`ke_hoach_can_cu`; đăng ký EntitySpec, `_SOURCE_FIELDS`, `_PLAN_MAPPING_SOURCES`,
`_LIST_ONLY_SOURCES`, `_MAPPING_LIST_ENTITY_BY_SOURCE` và source-to-context của
mapping service để mapping sinh alias template-visible `ds_can_cu_lap_ke_hoach`.
Không thêm child collection vào `_PLAN_FIELDS` hoặc
`ke_hoach.can_cu_lap_ke_hoach`, vì đường dẫn đó sẽ đưa toàn bộ collection vào
template và vô hiệu hóa lựa chọn trước khi xuất. List mapper phải hoạt động trên bản
sao selected DTO để `seal_docx_context` giữ đủ item keys/helper trong custom root.

Cần cập nhật allowlist/root/list mapping; metadata UI phải scope item fields theo loop,
từ điển hiển thị hai nhóm trên nhưng chỉ một loop. Ngoài manifest, source options và
column catalog hard-code trong HTML/JS cũng phải cập nhật; sample context của template
catalog phải có rows căn cứ để preview loop thật. Tăng
`WORD_DEFAULT_MAPPINGS_VERSION` 15 -> 16 và regenerate
`frontend/documents/wordVariableManifest.js`. Template cũ không có loop phải render
như cũ. Template mới được publish thành immutable version theo ADR 0010.

Preflight chỉ cần nhận list root; các item fields không trở thành external/global
roots. Trước bước dịch shorthand, mọi selected item phải đã có đủ canonical/helper
keys để `{#ds_can_cu_lap_ke_hoach}{ten_van_ban}{/...}` được dịch thành truy cập
`item.ten_van_ban`. Không quảng bá cú pháp item ngoài loop.

## 8. Durable job và source authority

Đề xuất policy v3 lưu canonical input:

```json
{
  "selectedCanCuLapKeHoachIds": ["khcc-..."],
  "selectionMode": "explicit|compat_all"
}
```

Ngay cả khi client thiếu field, enqueue phải resolve “tất cả” thành exact IDs rồi
seal. Worker tiếp tục render/retry từ immutable queued context; khi completion chạy
source-authority check, policy truyền exact selection cho cùng plan render pipeline
để dựng lại context/digest có thể so sánh đúng.

Không thay đổi current source-authority semantics ngoài việc thêm selection input.
Policy hiện đã lưu `recordRevision`; một update plan có thể invalidate job theo
row-version authority hiện hữu, kể cả update chỉ thêm căn cứ không được chọn. Kế
hoạch này không nới lỏng hoặc tái định nghĩa behavior đó. Các case selected row bị
sửa/xóa/reorder vẫn phải fail theo source authority hiện hành.

Worker sau deploy phải tiếp tục hiểu queued policy v1/v2 và dựng legacy context y
như trước; source-authority verification của v1/v2 không tự đưa selected internal
source/custom alias mới vào context digest. Chỉ v3 thêm selected projection và
selection input khi rebuild. Cần fixture enqueue trước deploy và complete sau deploy
cho cả v1/v2/v3.

Audit direct/enqueue ghi plan/document/template provenance, IDs, count, canonical
hash và `selectionMode`; không cần ghi free-text. Download audit tham chiếu đúng
job/artifact provenance hiện hữu.

## 9. Versioning, comparison và deletion

- Plan version mới kế thừa câu gốc, projection parse, `parseStatus`, `parseVersion`
  và thứ tự nhưng deep-clone `ke_hoach_can_cu`, cấp child physical IDs mới. Version
  cũ không bị mutate và clone không tự chạy parser hiện hành.
- Mapper outbound/version command phải giữ list khi field thiếu và chỉ clear khi có
  `[]`; frontend không được vô tình serialize local default `[]` vào partial update.
- Version-comparison repository phải attach `ke_hoach_can_cu` và đưa nó ra relation
  riêng, dùng `rootId` làm business identity và `ordered=True`; không dùng physical
  `id`, nội dung hoặc vị trí để ghép hai snapshot. Cùng root đổi câu/metadata hiện
  `MODIFIED`; đổi vị trí hiện order change; thiếu root hiện `REMOVED`; root mới hiện
  `ADDED`. Hai căn cứ trùng câu vẫn là hai lineage độc lập, không ambiguous.
- Thay đổi projection chỉ do parser version mới không được phát sinh ngầm; clone
  nguyên câu phải giữ nguyên projection và `parseVersion`.
- Delete/archive impact registry phải tính `ke_hoach_can_cu`; không thêm implicit
  cascade ngoài semantics đã có của plan children.

## 10. Migration và rollout

Migration forward-only v82:

1. Tạo `ke_hoach_can_cu`, constraints và tenant/order index.
2. Plan hiện hữu có zero child rows; không backfill/suy diễn từ template hay field
   khác.
3. Cập nhật canonical schema, upgrade path và ID registries.
4. Regenerate `frontend/documents/schemaRuntime.js` và PostgreSQL contract bằng
   `python scripts/generate_postgres_schema_contract.py --write`.
5. Sau khi Word contract chốt, tăng mapping version 15 -> 16 và regenerate
   `frontend/documents/wordVariableManifest.js`.

Rollout theo hướng expand-compatible:

1. Backend/migration hiểu child table, client cũ thiếu list/selection và job v1/v2.
2. Frontend editor + export selection.
3. Publish immutable template version mới có loop.
4. Theo dõi validation, source mismatch, retry và audit trước khi đóng compatibility
   window.

Runtime hiện nhận tối đa schema v81; rollback binary sau DB v82 phải dùng release đã
backport khả năng nhận v82 hoặc runbook bảo đảm binary cũ không chạy trên DB đã
migrate. Rollback thường không xóa table/dữ liệu.

## 11. Kế hoạch triển khai và test matrix

### Trình tự triển khai

1. Đọc và kiểm chứng ADR 0030/business contract trên working tree trước khi sửa code.
2. Chốt grammar/parser v1 và bộ corpus căn cứ thực tế; thêm parser xác định với
   golden tests trước khi nối vào persistence.
3. Thêm child schema/migration, mapper/projection/validation/outbound, read attach,
   ID/delete/version-comparison registries.
4. Deep-clone child rows trong mọi plan-version path; khóa missing/preserve và
   explicit-empty/clear semantics.
5. Thêm editor một ô text; hiển thị parse projection/status từ response sau khi lưu
   và detail UI; chưa thêm preview endpoint riêng.
6. Thêm dialog selection và một server resolver dùng chung direct/job.
7. Thêm job policy v3/source-authority/audit.
8. Thêm selected Word context, một loop mapping, hai nhóm recipe/biến item,
   presentation fragments, mapping version 16, generated manifest và immutable
   template version.
9. Chạy regression suite và rollout tương thích.

### Test matrix bắt buộc

| Nhóm | Trường hợp cần khóa |
|---|---|
| Migration/schema | v81 -> v82 tạo table rỗng cho plan cũ; fresh schema; same-tenant FK/invariant; index; SQLite/PostgreSQL/generated contract đồng nhất. |
| Parser | Câu chuẩn có `về việc`; tiền tố `Căn cứ`; không có trích yếu; ngày `d/m/yyyy` và `d tháng m năm yyyy`; `của`/`do ... ban hành`; Unicode; số/ký hiệu có `/` và `-`; trích yếu chứa từ “số/ngày/của”; thiếu trường; nhiều số/ngày/đơn vị; nhiều văn bản trong một dòng; ngày không tồn tại; punctuation; parser v1 golden corpus. |
| Mapper/update | Missing field preserve; `[]` clear; list replace atomic; retained/new IDs; reject duplicate/foreign/cross-tenant IDs; server owns parent/org/order và toàn bộ parse projection. |
| Validation/outbound | Root/item/type/blank/oversize errors; client không ghi derived fields; `PARTIAL`/`UNPARSED` vẫn lưu; no silent drop; outbound serializer giữ phân biệt missing với explicit empty. |
| Read/permissions | Authorized reader thấy full list ở API/detail/pagination; edit chỉ theo quyền hiện hữu; Word entitlement không đổi read response; không capability mới. |
| Form | Add/edit/delete/reorder bằng một ô text; hiển thị parse status sau save/read; sửa câu rồi backend reparse; không parser frontend/preview endpoint; ID ổn định trong cùng version; cancel không lưu; Unicode/multiline; accessibility/mobile. |
| Versioning | Backend command, durable draft và legacy path deep-clone đúng original/projection/parser version/order, giữ `rootId`, cấp physical IDs mới, không reparse, không alias mảng và không mutate version cũ. |
| Version comparison | Child row budget/attachment; match bằng `rootId`; clone unchanged không false diff; reorder; content edit = modified; add/remove; duplicate text vẫn là hai lineage riêng. |
| Delete policy | Blocking/cascade impact có child counts đúng; không orphan và không implicit cascade mới. |
| Import/revision | Source thiếu field preserve; explicit `[]` clear; replace có confirmation theo contract. |
| Selection | Missing = compat-all; explicit `[]`; subset/all; malformed/duplicate/unknown/foreign IDs; server order; không mutation plan. |
| Authorization | Tenant/module/assignment/record/session và Word action entitlement giữ nguyên ở direct/job/download; lỗi không lộ dữ liệu ngoài scope. |
| Direct/job parity | Cùng plan/template/selection tạo cùng selected context/output; package documents không đổi. |
| Durable jobs | v3 retry/completion dùng sealed IDs; plan/selected-row changes theo current source authority; queued v1/v2 vẫn hoàn tất. Không đặt expectation mới rằng unselected update phải được bỏ qua. |
| Word/mappings | Một selected-only loop; hai recipe nguyên văn/tách trường; item variables không được quảng bá global; `noi_dung_goc` luôn là original; mọi item có đủ key; derived null render `""`, không in `None`; fragments không có từ nối treo; không parse khi render; `stt` đúng; mixed `PARSED`/`PARTIAL`/`UNPARSED`; empty loop; mapping 15 -> 16; manifests/UI hard-code/sample preview đồng bộ; old template unchanged; new published bytes immutable. |
| Audit | Direct/enqueue có IDs/count/hash/mode, không log free-text; download liên kết đúng provenance. |

## 12. Yêu cầu đã nêu và các quyết định triển khai

### 12.1 Yêu cầu sản phẩm đã nêu

| ID | Quyết định |
|---|---|
| D-CC-01 | Thêm danh sách căn cứ vào Kế hoạch LCNT; đây là free-text có cấu trúc dẫn xuất, không tự liên kết `legal_instrument_version`. |
| D-CC-02 | Người dùng nhập một câu tự nhiên cho mỗi căn cứ; backend tách tên, số/ký hiệu, ngày của căn cứ, đơn vị ban hành và `trich_yeu`, đồng thời giữ nguyên câu gốc. |
| D-CC-03 | Trước mỗi lần xuất Word của kế hoạch, người dùng được chọn những căn cứ sẽ đưa vào tài liệu; selection không ghi ngược vào kế hoạch. |
| D-CC-04 | Không thay đổi quyền hoặc hiển thị dữ liệu hiện hữu; Word entitlement chỉ kiểm soát hành động xuất Word. |
| D-CC-05 | Word phải hỗ trợ hai cách dùng căn cứ: sao chép nguyên văn và chọn các trường đã tách; hai cách dùng chung đúng selected list và thứ tự. |
| D-CC-06 | `tenCanCu` là projection dẫn xuất, ghép `tenVanBan` và `trichYeu` bằng “về việc” khi cả hai có giá trị; không có cột lưu riêng và không nhận override từ client. |

### 12.2 Quyết định đã chốt và mặc định triển khai

| ID | Câu hỏi | Quyết định MVP |
|---|---|---|
| DG-CC-01 | Parse thiếu có chặn lưu/xuất không? | Không; giữ câu gốc và đánh dấu `PARTIAL`/`UNPARSED`. |
| DG-CC-02 | Khi nào parse? | Khi tạo/sửa câu ở backend; lưu `parseVersion`; không parse khi đọc, export, retry, reorder hoặc clone. |
| DG-CC-03 | Người dùng sửa kết quả parse thế nào? | MVP chỉ sửa câu gốc rồi parse lại; chưa cho client override derived fields. |
| DG-CC-04 | Dialog mặc định chọn gì? | Chọn tất cả. |
| DG-CC-05 | Có cho phép xuất với zero căn cứ? | Có; explicit zero dùng `[]`, list kế hoạch rỗng vẫn xuất được. |
| DG-CC-06 | Client cũ không gửi selection nghĩa là gì? | Compat-all; server resolve và seal exact IDs khi enqueue. |
| DG-CC-07 | Giới hạn số item, độ dài mỗi câu, số dòng và tổng payload? | Dùng giới hạn sync hiện hữu: 500 child items và 100.000 ký tự/item; không tự cắt dữ liệu hoặc thêm total-limit riêng ngoài request limits dùng chung. |
| DG-CC-08 | Direct export GET hay POST? | Thêm POST JSON trên path hiện hữu cho selection, giữ GET cũ với semantics compat-all. |
| DG-CC-09 | Import/source revision có list thì replace hay merge? | Preserve khi field thiếu; explicit list là replace có confirmation; không merge theo nội dung. |
| DG-CC-10 | Một textbox có được chứa nhiều văn bản không? | Một textbox = một căn cứ; phát hiện nhiều văn bản thì cảnh báo không chặn và yêu cầu người dùng chủ động tách dòng. |
| DG-CC-11 | Có bắt buộc xác nhận kết quả parse trước khi lưu? | Không. MVP parse khi save và hiển thị projection/status từ server sau save/read; `PARTIAL`/`UNPARSED` cảnh báo nhưng không chặn. Preview trước save/manual override để phạm vi sau. |
| DG-CC-12 | “Ngày của căn cứ” là ngày nào? | Đã chốt: `ngay_ban_hanh` là ngày ban hành/ký được viện dẫn, không phải ngày hiệu lực. |
| DG-CC-13 | Tên canonical của năm field? | Đã chốt: `ten_van_ban`, `so_van_ban`, `ngay_ban_hanh`, `don_vi_ban_hanh`, `trich_yeu`; API dùng camelCase tương ứng. |
| DG-CC-14 | Có dùng trường `trich_yeu` không? | Đã chốt: có; không gộp phần “về việc …” vào tên hoặc đơn vị. |
| DG-CC-15 | Biến item Word dùng tên nào? | Dùng canonical field names bên trong loop `ds_can_cu_lap_ke_hoach`; không tạo prefix alias `cc_*` vì convention list hiện hữu không dùng scalar aliases làm item fields. |
| DG-CC-16 | Builder có dùng fragments chứa từ nối không? | Có `cum_*` presentation-only để subset/missing field không tạo `số ngày của`; vẫn expose raw field variables. |
| DG-CC-17 | Chọn trường cấu trúc lúc thiết kế mẫu hay mỗi lần xuất? | Checklist ở Từ điển/recipe khi thiết kế mẫu; dialog mỗi lần xuất chỉ chọn các căn cứ. Field subset theo từng lần xuất bị hoãn và không thuộc MVP. |
| DG-CC-18 | `ten_van_ban` có bao gồm loại/tên gọi văn bản không? | Đã chốt: là loại hoặc tên gọi văn bản; với câu mẫu là `Quyết định`. `phê duyệt dự toán` luôn là `trich_yeu`, không gộp vào field này. |

Các quyết định kiến trúc về child table, physical `id` + lineage `rootId`, parser có
phiên bản, selected-only Word context/custom list alias và job policy v3 đã được ghi
trong ADR 0030; implementation không được đổi sang phương án khác nếu chưa cập nhật
business contract.

## 13. Acceptance criteria

1. Actor có quyền sửa plan hiện hữu thêm/sửa/xóa/reorder được; authorized reader
   xem đầy đủ list. Không đổi quyền hay data visibility.
2. Người dùng chỉ cần nhập `noiDungGoc`; backend persist nguyên câu và projection
   parser có version. Parse thiếu không làm mất dữ liệu hoặc chặn Word; không parse
   lại khi read/export/retry/clone.
3. Update thiếu list preserve, explicit `[]` clear; tenant/parent invariants và
   stable physical ID trong cùng version được enforce; derived fields là server-owned.
4. Plan version mới deep-clone original/projection/order, giữ `rootId`, cấp physical
   IDs mới; version cũ bất biến và comparison dùng lineage thay vì physical ID.
5. Mỗi lần xuất, actor có Word action entitlement chọn subset độc lập; selection
   không ghi vào plan.
6. Server chỉ dùng authoritative rows từ đúng plan/tenant, reject ID sai và render
   theo server order.
7. Direct export, job completion và retry dùng cùng selected projection; current
   source-authority behavior không bị nới lỏng.
8. Queued job v1/v2 vẫn chạy; v3 seal exact IDs và audit provenance.
9. Word chỉ chứa căn cứ đã chọn; từ điển có một loop với hai recipe nguyên văn/tách
   trường; dùng câu gốc ngay cả khi parse thiếu; mọi derived key thiếu render `""`,
   không in `None` hay từ nối treo; template cũ/package documents không đổi; mapping
   version 16, manifests, UI catalogs và sample preview đồng bộ.
10. Tenant/record/module/assignment/session authorization, Word entitlement, delete
   policy, version comparison và audit có regression tests.
11. ADR/business contract, migration/rollback runbook và immutable template version
    được duyệt trước production rollout.
