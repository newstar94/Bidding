# Kế hoạch và prompt triển khai chi tiết 9 tính năng BiddingFlow

**Ngày lập:** 2026-08-23

**Phạm vi:** mục 6, 7, 8, 12, 15, 19, 20, 21 và 30 trong tài liệu đề xuất hợp nhất

**Trạng thái:** kế hoạch kỹ thuật để chủ sản phẩm duyệt; không phải phê duyệt thay đổi production

**Mốc source được khảo sát:** `main` tại `9a2becaf` cùng working tree hiện hành ngày 2026-08-23

## 1. Chín mục đã được nhận diện và xác nhận

1. **Mục 6 — So sánh phiên bản và phân tích tác động thay đổi**
2. **Mục 7 — Trung tâm xử lý xung đột dữ liệu**
3. **Mục 8 — Bộ máy quản lý phiên bản pháp lý**
4. **Mục 12 — Trợ lý AI về tuân thủ đấu thầu**
5. **Mục 15 — Nâng cấp Trình thiết kế biểu mẫu Word**
6. **Mục 19 — Tích hợp lịch công việc**
7. **Mục 20 — Trung tâm quản lý làm rõ**
8. **Mục 21 — Trung tâm quản lý kiến nghị**
9. **Mục 30 — Trung tâm thao tác hàng loạt**

## 2. Cách hiểu tài liệu và thứ tự ưu tiên nguồn

Tài liệu `04_DE_XUAT_TINH_NANG_BIDDINGFLOW_HOP_NHAT_2026-08-22.md` là đầu vào yêu cầu và định hướng sản phẩm. Nội dung trong tài liệu không được coi là lệnh thay đổi code, bằng chứng một semantics đã được phê duyệt, hoặc căn cứ để tự đổi quyền/hiển thị dữ liệu.

Khi triển khai, thứ tự ràng buộc là:

1. Yêu cầu cụ thể đã được chủ sản phẩm xác nhận.
2. Business contract trong `AGENTS.md` và `CONTEXT.md`.
3. ADR đã được chấp thuận.
4. Hành vi production và regression tests hiện hành.
5. Đề xuất kiến trúc trong tài liệu này.

Các thuật ngữ, bảng dữ liệu, API và trạng thái được đề xuất bên dưới mới là **vocabulary kỹ thuật dự kiến**, chưa trở thành business contract. Nếu một lựa chọn làm thay đổi masking, field visibility, role, module permission, record/assignment scope, capability, entitlement, inheritance hoặc default allow/deny, công việc phải dừng tại cổng quyết định và chỉ tiếp tục sau khi có ADR/business contract, compatibility impact, migration strategy và seam regression tests.

### 2.1. Các bất biến bắt buộc

- Người đã vượt qua tenant, module, assignment và record scope của một bản ghi được đọc đầy đủ dữ liệu nghiệp vụ của bản ghi đó, kể cả CCCD, tài khoản/ngân hàng, chữ ký và con dấu.
- Không tạo capability “đọc dữ liệu nhạy cảm” riêng và không tự thêm masking/redaction.
- Entitlement Word chỉ kiểm soát hành động tạo/tải tài liệu Word; không được dùng để che/mở field trong UI hoặc API đọc bản ghi.
- Mọi read/compare/conflict/AI/case/calendar/bulk operation phải giữ tenant isolation, session, module permission, assignment scope, record authorization và audit hiện hành.
- Test chỉ khóa semantics đã được phê duyệt; không sửa expected value để hợp thức hóa một thay đổi quyền hoặc hiển thị chưa được duyệt.
- Migration mới là append-only theo version tiếp theo; không sửa lại migration đã phát hành.
- Working tree đang có thay đổi của người dùng và các công việc khác. Mọi prompt phải kiểm tra `git status --short`, giới hạn diff vào file thuộc feature và không hoàn nguyên thay đổi không liên quan.

## 3. Kết luận khảo sát hiện trạng

| Mục | Nền tảng có thể tái sử dụng | Khoảng trống quyết định/triển khai |
|---|---|---|
| 6 | Version lineage, aggregate snapshot, `allVersions`, selector, activity field names, timeline catalog | Chưa có authorized diff API, identity policy cho relation, impact-provider registry, provenance file đã sinh |
| 7 | CAS `rowVersion`, HTTP 409, conflict projection, offline outbox/quarantine, merge ba chiều của procurement import | Chưa có base business snapshot chung, resolution API/UI; semantics hiện hành bỏ conflict marker khi F5 |
| 8 | AI knowledge document/version/chunk, effective dates, rule-version pattern | Chưa có legal instrument/profile bất biến và binding chính xác vào từng version Kế hoạch/Gói thầu |
| 12 | Một AI gateway có scoped conversations, fresh authorization, RAG/citation, quota/audit | `procurement_advice` chưa có data tool; chưa có deterministic compliance snapshot từ mục 8/9/11 |
| 15 | Upload/list/view/replace/rename/delete/validate/mapping/render, filesystem CAS, audit, publication assignment | `revision` chưa phải immutable template version; thiếu draft/publish/history/restore/usage/rendered preview |
| 19 | Effective timeline, dynamic milestones, notification/deadline facts | Chưa có canonical calendar projection, `.ics`, stable UID/sequence hoặc external connector |
| 20 | Legacy `goi_thau_lam_ro`, form subtables, timeline milestones, activity, notification, private file primitives | Chưa có case aggregate, workflow, SLA, owner, attachments, response revisions, approval/issue commands |
| 21 | Raw Mua sắm công petition sidecar và toàn bộ seam có thể dùng chung với mục 20 | Chưa có operational petition domain/API/UI/import reconciliation |
| 30 | Bounded sync batch, batch auth prefetch, idempotency, audit, delete impact, procurement preview/apply, document jobs | Chưa có allowlisted command registry, authoritative preview token, drift check, job/per-record result và selection UX |

Bằng chứng chi tiết theo `file:dòng` được lưu tại `docs/research/2026-08-23-evidence-ledger-tinh-nang-06-07-08-12-15-19-20-21-30.md`.

## 4. Kiến trúc liên mục

```text
Authorized structured snapshot + diff vocabulary
├── Mục 6: so sánh hai version + impact providers
└── Mục 7: trình bày conflict + three-way merge
    └── thêm base snapshot; không dùng version diff làm merge engine

Legal source catalog/profile/binding bất biến
└── Mục 8 (source-only; rule/form = NOT_AVAILABLE)
    └── Mục 9 + 11 tạo real rule/checklist versions + compliance bundle
        └── Mục 12: AI chỉ giải thích qua assistant hiện có

WordTemplateCatalog + publication + provenance seam
└── Mục 15
    ├── cung cấp template version cho phát hiện tài liệu lỗi thời
    └── là impact provider của mục 6 khi provenance đầy đủ

ProcurementCase platform
├── Mục 20: case type CLARIFICATION
└── Mục 21: case type PETITION
    ├── deadline projection → mục 19
    └── domain commands hợp lệ → mục 30

WorkCalendar projection
└── Mục 19: .ics trước; Google/Outlook qua connector sau

BulkOperation prepare/apply orchestrator
└── Mục 30: chỉ gọi command nghiệp vụ đã tồn tại và được allowlist
```

### 4.1. Nguyên tắc “deep module”

Mỗi khối nghiệp vụ phải có một interface nhỏ, che giấu schema/query/normalization phía sau. Route, worker và UI chỉ là adapter. Không tạo generic abstraction chỉ vì hai đoạn code trông giống nhau; chỉ tạo adapter khi có biến thiên thực sự như loại relation khi diff, nhà cung cấp calendar hoặc policy workflow case.

Các interface đích dự kiến:

```text
VersionComparison.compare(request, actorContext) -> ComparisonResult
ConflictResolution.prepare/resolve(request, actorContext) -> ResolutionResult
LegalApplicability.resolve/bind/getBinding(...) -> LegalBinding
ComplianceContext.getSnapshot(...) -> DeterministicComplianceSnapshot
WordTemplateCatalog.draft/publish/restore/preview/getUsage(...)
ProcurementCase.execute(command, actorContext) -> CaseResult
WorkCalendar.project/exportIcs/syncConnector(...)
BulkOperation.prepare/execute/status(...)
```

Không expose repository trực tiếp qua HTTP và không cho client gửi arbitrary table/field/status để module tự ghi.

## 5. Cổng quyết định sản phẩm

| ID | Quyết định cần chủ sản phẩm chốt | Mục bị chặn | Kết quả cần ghi |
|---|---|---|---|
| DG-07-01 | Conflict có còn tự bỏ khi F5 hay được giữ bền vững; giữ ở thiết bị hay server; retention/purge | 7 | ADR thay semantics hiện hành, compatibility và regression |
| DG-07-02 | Bảng/field/list nào cho merge từng trường; delete-vs-update; tự merge được phép tới đâu | 7 | Allowlist + merge policy version |
| DG-07-03 | Audit payload và privacy/size policy cho base snapshot cục bộ | 7 | Storage envelope/retention contract |
| DG-08-01 | Sự kiện/ngày neo xác định luật áp dụng cho từng loại hồ sơ | 8, 12, 20, 21 | Applicability policy có version |
| DG-08-02 | Điều khoản chuyển tiếp, sửa đổi/bãi bỏ/tạm ngưng/chồng lấn và cách kế thừa | 8, 12 | Resolution policy + test fixtures |
| DG-08-03 | Legal catalog là toàn hệ thống hay theo tổ chức; ai được publish/override và ánh xạ vào quyền hiện có | 8 | ADR quyền/phạm vi nếu có thay đổi |
| DG-08-04 | Legacy backfill; version mới clone binding hay resolve lại; offline khi chưa resolve | 8 | Migration/compatibility contract |
| DG-12-01 | Bộ deterministic rule/finding của mục 9/11 đã được duyệt và version hóa | 12 | Prerequisite acceptance, không giao AI tự quyết |
| DG-15-01 | Semantics draft/published/retired/restore; một hay nhiều published version theo scope | 15 | Template lifecycle policy |
| DG-15-02 | Quyền cho draft/publish/restore và phân loại một preview không tạo Word artifact; mọi preview tạo/tải Word vẫn giữ Word entitlement hiện hữu | 15 | ADR nếu đổi semantics action/quyền |
| DG-15-03 | Retention file/version; mẫu dữ liệu preview; loại usage nào là authoritative | 15, 6 | Retention + preview + provenance contract |
| DG-15-04 | Assignment v2 trỏ logical template/follow-published hay pin exact version; rename/legacy filename alias được serialize thế nào | 15 | Assignment compatibility/cutover contract giữ ADR 0005 |
| DG-19-01 | Field nào được đưa ra `.ics`; title/description/location; timezone và all-day semantics | 19 | Calendar export contract/test vectors |
| DG-19-02 | Với external connector: explicit consent, calendar đích, hướng sync, update/delete/revoke và dữ liệu cho phép gửi | 19 | Integration/security ADR |
| DG-20-01 | Làm rõ gắn exact package version hay lineage; legacy request/response được pair/migrate ra sao | 20, 6 | Migration và version ownership policy |
| DG-20-02 | State machine, SLA, approval/issue authority và trách nhiệm có cấp quyền truy cập hay chỉ là metadata | 20 | Case workflow + permission contract |
| DG-21-01 | Petition taxonomy/workflow/SLA/legal basis và quy tắc nhập sidecar Mua sắm công | 21 | Case policy + reconciliation contract |
| DG-21-02 | Case dùng module/permission riêng hay kế thừa parent; party bên ngoài có hay không có truy cập | 20, 21 | ADR quyền/phạm vi; mặc định không cấp quyền |
| DG-30-01 | Pilot bulk action; canonical auth/command seam; DB-only atomic, itemized partial hay staged-finalize; side-effect boundary; batch/retry/cancel | 30 | Action contract + operational limits |
| DG-30-02 | Explicit-ID hay “select all by filter”; snapshot/filter drift; dữ liệu preview được hiển thị | 30 | Selection/preview authority contract |

Không có câu trả lời cho một gate không đồng nghĩa chọn default. Prompt tương ứng phải dừng phần bị ảnh hưởng, báo blocker và vẫn có thể hoàn thành phần độc lập nếu không làm thay đổi semantics.

## 6. Lộ trình đề xuất

| Wave | Phạm vi | Điều kiện vào | Exit gate |
|---|---|---|---|
| 0 | Chốt DG, ADR/business contracts, test characterization | Kế hoạch được duyệt | Mỗi semantics có owner, fixtures và compatibility |
| 1 | Mục 6: authorized comparison kernel/API/UI; impact provider cơ bản | Version read scope ổn định | Compare đúng scalar/relation, auth từng version, bounded payload |
| 2 | Mục 7 sau DG-07; hoặc chỉ làm characterization/base-capture không bật UI | DG-07-01..03 | Không force overwrite; race thứ hai vẫn 409; revocation không lộ data |
| 3 | Mục 15 lifecycle/template version/preview/usage | DG-15 | Adapter tương thích template hiện có; publish/restore audited |
| 4 | Mục 8 legal source catalog/profile/binding; rule/form components để `NOT_AVAILABLE` | DG-08 | Historical source binding bất biến; unresolved không bị gán “latest” |
| 5 | Mục 9/11 tạo real rule/checklist entities + compliance bundle, rồi mục 12 | Rule/findings deterministic đã sẵn sàng | AI chỉ giải thích source-backed snapshot; fresh auth mỗi call |
| 6 | Shared `ProcurementCase`, sau đó mục 20 | DG-20/21 về quyền và version ownership | Legacy hiển thị đủ; clarification workflow/audit/SLA hoạt động |
| 7 | Mục 21 trên cùng case platform | Shared case đã ổn định, DG-21 | Petition workflow + source reconciliation không overwrite local |
| 8 | Mục 19A `.ics`; 19B connector sau ADR tích hợp | DG-19 | Export chuẩn, stable UID; connector chỉ chạy sau consent |
| 9 | Mục 30 framework + một pilot; mở rộng từng adapter | DG-30 và command đích ổn định | Prepare/re-authorize/execute/audit; không force invalid transition |

Wave là thứ tự phụ thuộc, không nhất thiết là sprint. Mục 19A có thể chạy song song sớm hơn nếu chỉ lấy milestone hiện hữu; deadline của case chỉ được bổ sung sau wave 6–7.

## 7. Chuẩn chung cho mọi increment

### 7.1. API và command

- Schema request strict, reject unknown fields; idempotency key cho mọi command có side effect.
- Authorize trên server bằng policy hiện hành; client hints không phải authority.
- Mọi read theo family/target phải authorize từng record/version cần trả.
- CAS bằng `rowVersion`/expected version; không có force-write hoặc last-write-wins ngầm.
- Error code ổn định, không đưa dữ liệu bản ghi bị từ chối vào error/preview/audit.
- Audit ghi actor, tenant, action, target/digest/outcome; không nhân bản full sensitive snapshot nếu contract audit hiện tại không yêu cầu.

### 7.2. Data/migration

- Chỉ thêm migration version kế tiếp trong `backend/db/upgrades.py` và tài liệu runbook tương ứng.
- Bảng mới có tenant key/phù hợp phạm vi, khóa ngoại/index/uniqueness/CAS rõ ràng.
- Immutable history được append, không update/rewrite; trạng thái hiện hành là projection/pointer riêng.
- Legacy backfill không suy đoán. Hàng chưa xác định giữ trạng thái `UNRESOLVED`/`LEGACY_UNMAPPED` và có report đối soát.
- Rollout dùng expand → backfill/adapter → verify → switch read/write → retire sau; rollback app không yêu cầu xóa dữ liệu mới.

### 7.3. UI/accessibility/offline

- Loading/empty/error/stale/denied/retry states đầy đủ; keyboard/focus/label cho dialog, table và diff.
- Không quyết định permission hoặc lifecycle trên UI; UI render capability/action server trả về theo semantics đã duyệt.
- Feature flag theo increment. Offline chỉ hỗ trợ khi command contract nêu rõ; không tự tổng hợp hàng nghìn local patches cho bulk/case/calendar connector.

### 7.4. Verification tối thiểu

Mỗi increment chạy test mục tiêu trước, sau đó suite liên quan và quality gate phù hợp:

```powershell
git status --short
git diff --check
python scripts/check_mojibake.py
npm run check:quality
```

Nếu repo dùng tên script khác ở thời điểm thực hiện, đọc `package.json`/CI và dùng command authoritative hiện hành. Báo rõ test đã chạy, test chưa chạy và lý do; không nói “pass” nếu chỉ inspect code.

## 8. Mục 6 — So sánh phiên bản và phân tích tác động thay đổi

### 8.1. Kết quả cần đạt và ranh giới

Xây một module đọc để so sánh hai snapshot đã tồn tại trong cùng dòng phiên bản. Không xây version engine mới, không sửa snapshot lịch sử và không dùng activity/audit hash làm nguồn old/new value. Kết quả phải:

- phân loại scalar và relation thành `ADDED`, `REMOVED`, `MODIFIED`, `UNCHANGED`;
- trả giá trị cũ/mới đầy đủ sau khi cả hai version được authorize;
- phát hiện relation thêm/xóa/sửa mà không ghép theo physical child ID hoặc vị trí khi identity không ổn định;
- tách tác động thành `CONFIRMED`, `POTENTIAL`, `NOT_EVALUATED`, không biến phân tích thành tự động thay đổi nghiệp vụ;
- dùng chung cho UI compare và về sau cho “Xem thay đổi” của tài liệu lỗi thời.

Ngoài phạm vi increment đầu: tự sửa deadline/workflow, tự thu hồi file, tự đổi luật áp dụng, generic three-way merge và kết luận file Word lỗi thời khi chưa có provenance.

### 8.2. Seam hiện có phải tái sử dụng

- Lineage và aggregate snapshot: `backend/versioning/command.py`, `aggregate_snapshot.py`, `aggregate_policy.py`.
- Visibility từng version: `backend/sync/version_metadata.py`, `backend/sync/read_service.py`, ADR 0007.
- Client version family: `frontend/shared/VersionFamilyLoader.js`, `versionResolver.js`, `VersionSelector.js`.
- Normalization field kỹ thuật/nghiệp vụ: `backend/activity/service.py`.
- Dependency timeline: `shared/timeline_rules.json`, `backend/timeline/effective_timeline.py`.
- Regression: `tests/test_aggregate_version_snapshot.py`, `test_sync_record_version_metadata.py`, `test_read_scope_contract.py`, JS version selector tests.

Không expose `AggregateVersionRepository` hiện hữu trực tiếp qua route vì command repository có lock/write concerns. Tạo read repository/query riêng, không dùng `FOR UPDATE`.

### 8.3. Thiết kế module

Đề xuất package `backend/version_comparison/`:

```text
service.py                 # orchestration + authorization boundary
read_repository.py         # load immutable aggregate snapshots, bounded queries
diff_kernel.py             # pure scalar/object/relation comparison
field_registry.py          # stable path, label key, data type, technical exclusions
relation_policies.py       # identity/order/normalization per relation
impact_registry.py         # calls independent impact providers
providers/
  timeline.py
  assignment.py
  documents.py
  legal.py
  workflow.py
```

Interface nhỏ:

```text
compare(
  actor_context,
  entity_type,
  left_version_id,
  right_version_id,
  include_unchanged,
  relation_page_request
) -> ComparisonResult
```

Luồng bắt buộc:

1. Resolve hai ID phía server.
2. Authorize **từng version độc lập** bằng canonical read scope.
3. Xác nhận cùng tenant, entity type và lineage root; nếu không, trả lỗi xác định.
4. Load canonical aggregate snapshot bằng read repository.
5. Normalize qua registry; chỉ bỏ technical sync/internal credential fields, không mask business fields.
6. Chạy pure diff.
7. Chạy từng impact provider độc lập; timeout/lỗi một provider tạo `NOT_EVALUATED`, không làm sai diff.
8. Trả summary trước, relation lớn phân trang theo stable cursor.

### 8.4. Contract kết quả đề xuất

```json
{
  "entityType": "goithau",
  "familyId": "...",
  "left": {"id": "...", "version": 1, "rowVersion": 4},
  "right": {"id": "...", "version": 2, "rowVersion": 1},
  "summary": {"added": 2, "removed": 1, "modified": 4, "unchanged": 18},
  "fields": [
    {
      "path": "thoi_diem_dong_thau",
      "labelKey": "package.bidClosingTime",
      "kind": "SCALAR",
      "change": "MODIFIED",
      "oldValue": "...",
      "newValue": "..."
    }
  ],
  "relations": [
    {
      "path": "hang_hoa",
      "summary": {"added": 2, "removed": 1, "modified": 3},
      "ambiguousMatches": [],
      "nextCursor": null
    }
  ],
  "impacts": [
    {
      "category": "TIMELINE",
      "assessment": "CONFIRMED",
      "reasonCode": "SOURCE_FIELD_CHANGED",
      "references": []
    }
  ]
}
```

`oldValue/newValue` không bị redaction nếu actor được phép đọc version. API không trả secrets kỹ thuật, credential, local sync marker hoặc filesystem path. Label là presentation metadata, còn `path` là contract ổn định cho automation/test.

### 8.5. Identity và diff relation

Mỗi relation phải khai báo policy, không có generic “match by id/index”:

- scalar/object: canonical normalization theo type; `null`, chuỗi rỗng, timezone và decimal có test vector rõ;
- set-like relation: order không tạo diff;
- ordered relation: order change là thay đổi nếu business contract nói order có nghĩa;
- child cloned với ID mới: match bằng business identity đã được duyệt và kiểm tra uniqueness;
- duplicate/thiếu identity: ghi `ambiguousMatches`, không đoán ghép;
- assignment: so sánh membership/role semantics hiện hành, không suy ra permission mới.

Field registry phải version hóa hoặc có contract test để đổi label không làm đổi stable path. Không ghi cứng dependency impact trong UI.

### 8.6. Impact provider theo lát

**6A:** timeline/deadline từ rule catalog và assignment membership.

**6B:** progress/workflow, evaluation, contract, document và notification providers khi các module có query đáng tin.

**6C:** compliance/legal impact sau mục 8/9/11; generated Word impact sau mục 14/15 có provenance.

Registry phải luôn có coverage cho đủ nhóm proposal: deadline, progress, assignment, document, evaluation, contract, notification, compliance, generated Word và legal rules. Nhóm chưa có authoritative provider vẫn xuất hiện dưới dạng `NOT_EVALUATED`, không bị bỏ khỏi response khiến người dùng hiểu nhầm là “không ảnh hưởng”.

Trong lúc dependency chưa có:

- “có thể bị ảnh hưởng” dùng `POTENTIAL` cùng reason code;
- “chưa đủ dữ liệu để đánh giá” dùng `NOT_EVALUATED`;
- tuyệt đối không gọi một file cụ thể là “lỗi thời” chỉ từ timestamp hoặc template name.

### 8.7. API/UI

- Route read-only dạng `POST /api/version-comparisons/query` với strict body; CSRF/session theo chuẩn repo dù không mutate.
- UI dùng hai `VersionSelector` đã có; chỉ cho chọn version mà loader scoped đã trả.
- Tabs: Tổng quan, Chi tiết field, Relation, Tác động; filter theo loại change; mặc định có thể ẩn `UNCHANGED` ở presentation nhưng API tùy chọn vẫn trả được.
- Deep link từ màn hình lịch sử/tài liệu phải truyền ID, backend vẫn tự authorize.
- Hiển thị rõ `POTENTIAL` và `NOT_EVALUATED`; không dùng màu/nhãn khiến người dùng hiểu là vi phạm hoặc hệ thống đã tự cập nhật.

### 8.8. Migration, rollout và rollback

Core 6A không cần schema migration. Feature flag route/UI, không cache result ở phase đầu. Rollback chỉ tắt route/UI; version data không đổi. Nếu về sau thêm cache, cache key phải gồm tenant, actor scope fingerprint, hai version/content hash và registry version; cache không được trở thành authority.

### 8.9. Test và nghiệm thu

- Unit diff cho scalar/date/decimal/null/Unicode/set/order/nested list/duplicate identity.
- Integration authorize cả hai version; được đọc bên trái nhưng không được đọc bên phải phải fail mà không lộ metadata/data bên phải.
- Cross-tenant/different-family/different-entity bị từ chối.
- Authorized actor nhận đầy đủ business fields, gồm fixture CCCD/ngân hàng/chữ ký/con dấu khi aggregate có các field đó.
- Historical snapshot bất biến; compare không phát sinh write/lock.
- Provider failure tạo `NOT_EVALUATED`; không làm mất diff.
- Relation lớn bounded query, pagination ổn định và không N+1.
- UI keyboard, loading/error/empty, đổi cặp version, filter và stale request cancellation.
- Word/legal chưa đủ provenance phải không sinh kết luận xác định.

### 8.10. Prompt thực thi mục 6

```text
Bạn đang triển khai mục 6 “So sánh phiên bản và phân tích tác động thay đổi”
trong repo BiddingFlow.

Trước khi sửa:
1. Đọc AGENTS.md, CONTEXT.md, mục 6 và mục 14 của
   docs/04_DE_XUAT_TINH_NANG_BIDDINGFLOW_HOP_NHAT_2026-08-22.md,
   docs/adr/0007-procurement-operation-and-version-metadata-read-scope.md,
   cùng docs/research/2026-08-23-evidence-ledger-tinh-nang-06-07-08-12-15-19-20-21-30.md.
2. Chạy git status --short; bảo toàn mọi thay đổi không thuộc task.
3. Khảo sát versioning command/snapshot, version_metadata/read_service,
   access_policy, effective_timeline, VersionFamilyLoader và VersionSelector.
4. Viết inventory ngắn và test characterization trước khi production edit.

Ràng buộc không được vi phạm:
- Không đổi role/module/assignment/record scope, permission, capability,
  entitlement, masking, redaction hoặc field visibility.
- Authorize left và right version độc lập bằng canonical read scope.
- Sau authorization, trả đầy đủ business values; chỉ loại technical sync/internal
  secret fields. Word entitlement không liên quan quyền đọc compare.
- Không xây version engine mới, không sửa historical snapshot, không dùng
  repository có FOR UPDATE làm read API.
- Không ghép child relation theo physical ID hoặc index khi clone làm đổi ID.
- Không kết luận legal/document impact khi thiếu legal binding/provenance.

Triển khai increment 6A:
1. Tạo deep module version_comparison với service, read repository, pure diff
   kernel, field registry, relation-specific policies và impact provider port.
2. Contract có stable path/labelKey/kind, ADDED/REMOVED/MODIFIED/UNCHANGED,
   oldValue/newValue, summary, ambiguousMatches và bounded pagination.
3. Reject khác tenant/entity/lineage; không lộ dữ liệu target bị từ chối.
4. Thêm timeline provider dùng shared timeline_rules/effective_timeline và
   assignment provider dùng semantics hiện hành. Khai báo đủ impact categories
   của proposal; notification và mọi provider chưa authoritative phải trả
   NOT_EVALUATED/POTENTIAL rõ ràng, không bị bỏ khỏi response.
5. Provider trả CONFIRMED/POTENTIAL/NOT_EVALUATED; lỗi provider không đổi diff.
6. Thêm strict read-only API adapter và UI dùng VersionSelector hiện có.
7. Feature flag UI/API; không thêm schema/cache ở lát đầu.

Tests bắt buộc:
- pure diff type matrix, semantic list/order, ambiguous duplicate;
- per-version authorization, cross-tenant/family/entity;
- full authorized business data, không masking mới;
- history immutability/no write lock;
- provider degradation, bounded query/N+1;
- API schema/errors và JS UI states/accessibility.
Giữ pass các test version metadata/read scope/aggregate snapshot hiện hữu.

Chạy test mục tiêu, git diff --check, mojibake check và quality gate phù hợp.
Bàn giao: file thay đổi, contract API, test/result, performance bound,
compatibility impact và các provider còn NOT_EVALUATED. Không triển khai mục 7
hoặc tự động mutation từ impact trong prompt này.
```

## 9. Mục 7 — Trung tâm xử lý xung đột dữ liệu

### 9.1. Cảnh báo compatibility bắt buộc

Contract hiện hành trong `CONTEXT.md` định nghĩa conflict batch bị cách ly, marker chỉ giữ trong phiên và **tự bỏ khi tải lại trang trước authoritative pull**; conflict draft không được áp lại sau F5. Vì vậy “trung tâm” giữ conflict qua reload là thay đổi semantics, không phải nâng cấp UI thuần túy.

Không được triển khai durable conflict center ở production trước khi `DG-07-01..03` được chủ sản phẩm chốt và ghi ADR. Nếu chưa chốt, chỉ được:

- bổ sung characterization tests/telemetry không chứa full record;
- thiết kế envelope/schema/pure merge prototype sau feature flag không phát hành;
- cải thiện message hiện hành mà không giữ hoặc replay draft sau F5.

### 9.2. Mục tiêu sau khi được duyệt

- Cho xem base/local/server theo dữ liệu mà actor hiện vẫn được phép truy cập.
- Chọn server, local hoặc từng field trên allowlist.
- Resolution luôn là command mới dựa trên latest `rowVersion`, validation và authorization mới nhất.
- “Giữ của tôi” không phải force overwrite; race lần hai phải trả conflict lần hai.
- Không tự merge delete, nested list hoặc field mơ hồ.
- Mutation không liên quan conflict vẫn tiếp tục được bảo toàn/đồng bộ như hiện nay.

### 9.3. Tái sử dụng và thiết kế

Giữ server CAS tại `backend/sync/record_writer.py`, validator/authorization và `project_conflict_record()`; không mở rộng projection thành masking business data. Trích vocabulary/pure three-way merge từ procurement import nhưng không dùng allowlist source-owned của import làm policy chung.

Đề xuất:

```text
frontend/app/conflicts/
  ConflictEnvelopeStore.js
  ConflictCenter.js
  ConflictResolutionClient.js
backend/sync/conflict_resolution/
  service.py
  merge_kernel.py
  policy_registry.py
  resolution_contract.py
```

Envelope version hóa tối thiểu cần có `workspaceFingerprint`, tenant/actor binding phù hợp contract, batch/mutation ID, table/record ID, expected/current rowVersion, base snapshot hoặc field hash/value theo policy, local intent, authorized server projection tại thời điểm 409, timestamps, retention version và corruption/dedupe checksum. Không lưu auth/session secrets. Plain client checksum **không phải authority hoặc tamper proof**; toàn bộ envelope/base/local/server values từ client vẫn là untrusted input. Nếu resolution cần pin server state, server phải phát signed/MACed opaque token hoặc persist preview authority theo tenant/actor/record/version/policy/expiry.

Base phải được chụp tại form edit/outbox enqueue boundary; nếu không có base business value thì generic three-way merge không an toàn. Mỗi table/field chỉ được merge khi `ConflictPolicyRegistry` allowlist và khai báo normalization/identity. Unknown field/table mặc định chỉ cho bỏ local hoặc tạo lại edit thủ công, không đoán merge.

### 9.4. Resolution transaction

1. Khi nhận 409, server phát opaque signed resolution token (hoặc persisted preview ID) pin tenant/actor/record, exact `serverRowVersion`, authorized projection digest, policy version và expiry; envelope giữ token cùng projection người dùng sẽ xem.
2. Client chọn conflict envelope và gửi resolution decisions + new idempotency key; không gửi authority token tự tạo.
3. Server xác thực session/tenant/workspace, re-authorize tenant/module/assignment/record/lifecycle và lock/load current record trong transaction.
4. Nếu bị thu hồi quyền: từ chối và không trả current server data; áp dụng đúng deactivation/retention/purge policy đã được DG-07 phê duyệt. Không mặc định purge: forced-session/logout seam hiện hành chủ ý deactivate và bảo toàn pending workspace.
5. Verify server-issued token/preview authority rồi so sánh current rowVersion/projection digest với exact server version/digest đã pin. Nếu token sai/hết hạn hoặc record đã đổi, trả conflict/stale-resolution mới và bắt người dùng xem/xác nhận lại; không áp decisions cũ lên snapshot chưa từng được xem.
6. Validate decisions theo exact envelope/policy schema; reject unknown/missing/ambiguous field.
7. Dựng normal mutation trên **exact pinned server snapshot** với `expectedRowVersion = pinnedServerRowVersion`.
8. Chạy canonical validators/writer/audit trong transaction. CAS/race xảy ra sau bước kiểm tra vẫn trả 409 mới; không retry force ngầm.
9. Chỉ xóa envelope sau server acknowledgement; giữ audit/reference theo retention contract.

### 9.5. UI

- Center nhóm theo workspace/record, hiện thời điểm và trạng thái; không tự load latest data cho record đã mất quyền.
- So sánh ba cột Base / Của tôi / Máy chủ khi base khả dụng; hai cột chỉ dùng cho whole-record choice theo policy.
- Mỗi field hiển thị choice rõ, conflict/auto-merge/unsupported; destructive/delete có confirmation riêng.
- Nút “Dùng máy chủ” bỏ local intent; “Giữ của tôi” tạo normal mutation; “Hợp nhất” chỉ enabled khi mọi conflict bắt buộc được chọn.
- Offline cho xem draft theo retention contract nhưng resolve chỉ khi online/re-authorize.

### 9.6. Migration/rollout/rollback

- Nếu chọn device-local: nâng `WorkspaceConflictRecoveryStore` bằng versioned envelope, migration một chiều có fallback bỏ envelope không đọc được; tích hợp exact approved logout/revocation policy. Characterize forced logout hiện deactivate/preserve pending workspace, không đổi thành purge ngầm.
- Nếu chọn server/cross-device: cần bảng tenant-scoped, encryption/retention/cleanup và read authorization riêng; không suy ra từ proposal.
- Rollout capture base trước, theo dõi size/error, rồi mới bật center cho allowlisted table; không bật generic all-table.
- Feature flag kill switch quay về contract F5 hiện hành. Không tự replay envelope cũ khi rollback.

### 9.7. Test và nghiệm thu

- Characterize CAS/409/quarantine/F5 hiện hành trước khi đổi expected.
- Base/local/server merge matrix: same value, one-side change, both same, both different, null/delete/list ambiguity.
- “Keep mine” dùng exact server CAS mà người dùng đã xem; concurrent second writer tạo 409 mới.
- Resolution từ server snapshot đã cũ phải bị từ chối trước mutation; decisions không được rebase ngầm lên snapshot người dùng chưa xem.
- Revocation sau conflict không lộ latest server record và không commit.
- Full business data authorized không bị masking thêm; technical/auth secrets vẫn bị loại như projection hiện tại.
- Envelope tenant/workspace isolation, retention, quota và approved logout/revocation behavior; forced logout preservation regression; client checksum chỉ phát hiện corruption/dedupe, còn token MAC/persisted authority chịu tamper/expiry/actor-binding tests.
- Unresolved draft không auto replay; unrelated outbox vẫn chạy.
- Idempotent resolve không nhân đôi write/audit.
- Unsupported table/field/list không auto merge.

### 9.8. Prompt thực thi mục 7 có gate bắt buộc

```text
Bạn đang xử lý mục 7 “Trung tâm xử lý xung đột dữ liệu” của BiddingFlow.

Các giá trị PHẢI được chủ sản phẩm điền từ ADR đã duyệt trước production code:
APPROVED_CONFLICT_RETENTION = <session-only | device-local | server/cross-device>
APPROVED_RELOAD_BEHAVIOR = <discard-on-F5 | retain-without-replay | ...>
APPROVED_RETENTION_PURGE = <duration, quota, logout/revocation rules>
APPROVED_MERGE_ALLOWLIST = <tables/fields/relation policies>
APPROVED_DELETE_NESTED_POLICY = <exact policy>
APPROVED_AUDIT_PAYLOAD = <metadata/full-value rules>

Đọc AGENTS.md, CONTEXT.md phần “Xung đột đồng bộ chưa giải quyết”, mục 7
trong tài liệu đề xuất, conflict authorization/projection, SyncPushService,
SyncCoordinator, WorkspaceConflictRecoveryStore, mutationQueue và procurement
import three-way merge. Chạy git status --short và giữ nguyên diff không liên quan.

Nếu bất kỳ placeholder nào chưa được điền hoặc chưa có ADR/business contract:
- KHÔNG đổi hành vi F5, retention, replay, permission, projection hay production UI;
- chỉ viết characterization tests, inventory, ADR draft và blocker report;
- không sửa expected tests để coi retention mới là đúng.

Khi và chỉ khi gate đã đủ:
1. Capture base business snapshot ở edit/enqueue seam theo allowlist; không lưu
   credential/session secret.
2. Nâng recovery store thành versioned envelope đúng retention/purge đã duyệt.
3. Tạo pure three-way merge kernel và per-table/field policy registry; unknown,
   duplicate identity, delete và nested list phải dừng theo approved policy.
4. Server phát signed/MACed opaque resolution token hoặc persisted preview ID pin
   tenant/actor/record, exact serverRowVersion + authorized projection digest,
   policy version và expiry. Plain hash/localStorage không phải authority.
   ConflictResolution phải verify authority, lock/load current, reauthorize và so
   current với pin. Nếu khác, trả conflict mới để user xem/xác nhận lại; không
   rebase decisions cũ lên unseen snapshot.
5. Mutation dùng exact pinned serverRowVersion làm expectedRowVersion, canonical
   writer/audit/idempotency. “Giữ của tôi” không force overwrite; mọi race mới
   vẫn trả 409 mới.
6. Khi quyền bị thu hồi, không trả current server record; áp dụng exact approved
   deactivation/retention/purge policy. Giữ regression forced logout hiện
   deactivate/preserve pending workspace, không tự đổi thành purge.
7. Không thêm masking/redaction/capability; authorized business record vẫn đầy đủ.
8. UI có Base/Của tôi/Máy chủ, choice từng field chỉ trên allowlist, states
   offline/stale/denied/second-conflict; không auto replay unresolved draft.
9. Rollout từng table bằng feature flag và có kill switch quay về semantics cũ.

Tests bắt buộc: current behavior characterization; merge matrix; second race;
authorization/revocation/no-leak; full authorized business projection;
workspace/tenant envelope isolation; tamper/quota/approved retention; forced-
logout preservation; no auto replay;
unrelated outbox preservation; idempotent resolution; unsupported relation.

Bàn giao ADR link, exact approved values, migration/rollback, test results và
danh sách table/field còn unsupported. Nếu chưa có approval, bàn giao blocker
report thay vì production implementation.
Chạy targeted backend/JS/E2E tests, git diff --check,
python scripts/check_mojibake.py và quality gate authoritative trong package/CI.
Báo exact commands/results, test chưa chạy + lý do, files/diff scope và compatibility.
```

## 10. Mục 8 — Bộ máy quản lý phiên bản pháp lý

### 10.1. Mục tiêu và phân ranh domain

Mỗi version Kế hoạch/Gói thầu phải trỏ tới một legal source profile version chính xác hoặc mang trạng thái chưa xác định; read không được tự tra “luật mới nhất”. Phải tách:

- **Legal source registry:** văn bản/source/chunk phục vụ tra cứu và citation; tái sử dụng AI knowledge assets.
- **Legal instrument/version:** định danh văn bản và các version bất biến, quan hệ sửa đổi/bãi bỏ/tạm ngưng sau khi được duyệt.
- **Legal source profile version (mục 8):** manifest bất biến chỉ gồm exact legal instrument/source versions và applicability metadata đã tồn tại.
- **Compliance bundle version (sau mục 9/11):** extension riêng tham chiếu exact legal source profile + `RulePackVersion` + checklist/form-set versions **sau khi** các entity đó thật sự tồn tại và được duyệt. Mục 8 không tạo placeholder FK/ID cho dependency chưa có.
- **Applicability policy:** quy tắc xác định profile từ một anchor event/date và transition facts.
- **Legal binding:** kết quả bất biến gắn exact profile version vào exact record/version, kèm provenance.
- **Executable compliance rules:** thuộc mục 9, không được AI hoặc mục 8 tự phát minh.

AI knowledge ingestion hiện “retire” version cũ và retrieval chỉ phục vụ active/current; không dùng cơ chế đó làm authority cho hồ sơ lịch sử. Có thể liên kết exact knowledge document/version để citation, nhưng binding vẫn là domain riêng. Vì current retrieval loại retired source và knowledge rows/chunks chưa có contract bất biến/xóa-bảo-vệ, mục 8 phải bổ sung exact-ID historical source path cùng content hash/artifact protection trước khi hứa truy xuất citation lịch sử.

### 10.2. Vocabulary và data model đề xuất

Tên cuối cùng cần được xác nhận trong domain review; cấu trúc tối thiểu:

```text
legal_instrument
  owner_scope_type + owner_scope_id, stable identity,
  number, type, issuer, jurisdiction/scope

legal_instrument_draft (mutable CAS working aggregate)
  instrument owner/id, draft payload/source refs,
  draft_revision, updated_by/at

legal_instrument_version (immutable)
  owner scope + instrument_id, version_no, issue/effective interval,
  content/source hash, source URI, published_by/at,
  immutable source artifact reference,
  optional ai_knowledge_document_id, supersession relation

legal_source_profile
  owner_scope_type + owner_scope_id, stable profile code/name

legal_source_profile_draft + draft_member (mutable CAS working aggregate)
  profile owner/id, draft_revision, candidate source members, updated_by/at

legal_source_profile_version (immutable)
  owner scope + profile_id, version_no, applicability_policy_version,
  exact source manifest_hash, published_at/by

legal_source_profile_member
  profile owner + profile_version_id,
  instrument owner + exact instrument_version_id, role/order

plan_legal_binding / package_legal_binding (append-only, typed target tables)
  organization_id + exact target aggregate version composite FK,
  profile owner scope + legal_source_profile_version_id nullable when unresolved,
  binding_status, anchor_type/value, policy_version,
  evidence/provenance, bound_at/by, supersedes_binding_id if correction allowed

plan_legal_binding_head / package_legal_binding_head
  organization_id + exact target composite PK/FK,
  current_binding_id, binding_revision, updated_by/at

# added only by later item 9/11 migration, not item 8:
compliance_bundle_version (immutable)
  exact legal_source_profile_version_id,
  exact rule_pack/checklist/form-set version IDs, manifest_hash
```

Không đặt `current_legal_profile_id` mutable đơn thuần lên row lịch sử rồi resolve lại khi read. Nếu cần pointer để query nhanh, pointer chỉ là projection có foreign key tới binding bất biến và phải được kiểm tra consistency.

Mọi catalog row có scope key rõ (`SYSTEM` hoặc exact organization theo DG-08-03) và composite uniqueness/FK. Profile/member constraints chỉ cho tham chiếu source cùng tổ chức hoặc source `SYSTEM` theo policy đã duyệt; tuyệt đối chặn org A → org B. Binding luôn mang `organization_id` và dùng typed plan/package target table với composite tenant FK; không dùng cặp polymorphic `target_type,target_id` không thể enforce tenant ở DB. Nếu sau này thêm target type, thêm typed target relation/migration tương ứng sau review.

Append-only binding history cần một CAS head riêng. Mỗi exact target có đúng một typed `*_legal_binding_head`; `bind/override` lock/CAS `binding_revision`, append history row rồi advance `current_binding_id` trong cùng transaction. Target `rowVersion` chỉ xác minh target facts/provenance, không serialize concurrent binding commands. `getExact()` đọc head, nên hai concurrent bind không thể cùng trở thành current hoặc tạo kết quả mơ hồ.

Cho tới khi mục 9/11 tạo rule/checklist entities, source profile/binding vẫn hợp lệ để biết văn bản nào áp dụng nhưng `rulePack`, `formSet` và executable compliance đều trả `NOT_AVAILABLE/NOT_EVALUATED`. Không được gọi source-only profile là executable rules bundle.

Status văn bản như “sắp hiệu lực/hết hiệu lực” nên được suy ra theo effective interval và reference date. `DRAFT` là working aggregate riêng, còn publish là append event/snapshot chứ không phải mutable state trên version. Không trộn “retired khỏi RAG current retrieval” với “không còn là nguồn hợp lệ cho historical binding”.

Không đặt mutable lifecycle state vào immutable version rows. Draft instrument/profile là working aggregate riêng có `draftRevision` CAS. `publish` validate/lock draft rồi trong một transaction **append** immutable version + immutable member snapshot + publication event; prior published version/member rows không bao giờ UPDATE. Chỉnh sửa sau publish tạo/advance draft cho version kế tiếp, không “unpublish and edit” history.

### 10.3. Interface và command

```text
LegalCatalog.create/updateInstrumentDraft(expectedDraftRevision, ...)
LegalCatalog.publishInstrumentDraft(expectedDraftRevision, ...)
LegalCatalog.createProfileDraft(...)
LegalCatalog.updateProfileDraft(expectedDraftRevision, ...)
LegalCatalog.publishProfileDraft(expectedDraftRevision, ...)
LegalApplicability.resolve(targetFacts, policyVersion) -> Resolution
LegalBinding.bind(targetVersion, resolution,
                  expectedBindingRevision, expectedTargetRowVersion?, ...)
LegalBinding.getExact(targetVersion) -> Bound|Unresolved
LegalCitation.getSources(profileVersion, sourceIds) -> ExactSources
```

Publish/bind/override là audited server commands, idempotent và CAS-protected. Draft CAS dùng `draftRevision`; publish appends immutable snapshots/events. Binding CAS dùng typed head `bindingRevision`; target rowVersion không thay thế nó. Read legal source profile không cấp quyền đọc target; target read trước, sau đó mới trả binding/source phù hợp. Legal engine không phải permission engine và không làm thay đổi field visibility.

Resolution phải trả một trong:

- `RESOLVED`: một profile exact cùng evidence;
- `AMBIGUOUS`: nhiều candidate/transition facts thiếu;
- `UNRESOLVED`: không đủ anchor/data/catalog;
- `MANUAL_REVIEW_REQUIRED`: policy yêu cầu người có thẩm quyền xác nhận.

Không có nhánh fallback “latest”. Override chỉ tồn tại nếu DG-08 cho phép, phải giữ binding cũ, lý do, actor, time và audit.

### 10.4. Increments

**8A — Catalog và lịch sử bất biến**

- Pin immutable source artifact/content hash; adapter liên kết exact AI knowledge document/chunks để citation nhưng không phụ thuộc current retrieval. Exact-ID historical lookup chỉ chạy sau target authorization; FK/protection không cho update/delete artifact đang được binding/profile tham chiếu.
- Mutable CAS draft aggregate + publish command append immutable version/source/member snapshot and event; no UPDATE of prior published rows.
- UI timeline/filter theo type/status/effective period; hiển thị exact version/hash/source.

**8B — Legal source profile manifest**

- Source-profile draft/member working aggregate có CAS; publish append exact immutable legal instrument member snapshot và manifest hash.
- Validate missing/duplicate/overlap theo policy đã duyệt; không tự coi overlap là sai nếu transition contract chưa chốt.
- Không tạo `rule_pack_version_id`/`form_set_version_id` placeholder. Mục 9/11 về sau thêm `ComplianceBundleVersion`; cho tới đó các component này là `NOT_AVAILABLE/NOT_EVALUATED`.

**8C — Applicability resolver và record binding**

- Pure resolver version hóa với table-driven fixtures cho anchor/transition.
- Bind exact plan/package version trong transaction nghiệp vụ đã được xác định.
- CAS typed binding head bằng `expectedBindingRevision`; append history + advance head cùng transaction. Concurrent stale bind/override trả 409.
- Version creation clone hoặc re-resolve đúng DG-08-04, không dùng current time.

**8D — Legacy reconciliation**

- Inventory records, chạy report candidates/evidence.
- Auto-bind chỉ khi policy chứng minh duy nhất và product cho phép; còn lại `UNRESOLVED/NEEDS_REVIEW`.
- UI queue/manual confirmation chỉ dành cho actor/action đã được phê duyệt; không tự tạo role/capability.

### 10.5. API/UI

- Catalog/profile APIs riêng với strict schema, optimistic revision và audit.
- Target detail trả `legalBinding` qua authorized read composition, không thay field response hiện hành bằng filtered variant.
- UI target hiển thị profile/version, anchor, trạng thái resolution, exact sources và “Cần xác nhận”; không tự gắn nhãn vi phạm.
- Compare mục 6 dùng binding ID/version để báo legal change. AI mục 12 chỉ lấy exact binding sau authorization.

### 10.6. Migration/compatibility/rollback

- Append tables/indexes/constraints, composite owner/tenant FKs, typed plan/package binding history + one-head-per-target CAS rows; không mở rộng status/uniqueness của `ai_knowledge_documents` nếu adapter/link table đủ dùng.
- Seed/import source links có hash. AI knowledge version có thể được retire khỏi current retrieval, nhưng immutable source artifact/exact citation mà published legal profile tham chiếu không được update/delete; dùng FK `RESTRICT`/equivalent domain guard và reconciliation.
- Không backfill current law vào historical rows. Report số resolved/ambiguous/unresolved và sample kiểm tra.
- Expand/read shadow trước; binding chưa bật enforcement cho đến khi rule pack và coverage được nghiệm thu.
- Rollback app bỏ đọc projection mới nhưng giữ append-only catalog/bindings; không rewrite lịch sử.

### 10.7. Test và nghiệm thu

- Immutable published instrument/profile; stale publish 409; manifest/hash deterministic.
- Draft edits use draftRevision; publish/new draft never UPDATE prior immutable instrument/profile/member rows.
- Effective boundary ngay trước/đúng/sau mốc, timezone/date-only và open-ended interval.
- Transition, amend/repeal/suspend/overlap theo fixtures đã được owner duyệt.
- Historical target vẫn giữ exact binding khi profile mới publish.
- Concurrent bind/override cùng expected binding revision: đúng một command advance head, command còn lại 409; `getExact()` không ambiguous.
- Version mới clone/re-resolve đúng policy; không phụ thuộc “hôm nay”.
- Legacy thiếu evidence là unresolved, không latest.
- Cross-tenant/owner scope và command authorization đúng contract; legal relation không cấp record access.
- Exact-ID citation path lấy được retired historical source cho authorized target, xác minh content hash; generic current RAG retrieval vẫn không dùng cho việc này.
- Fresh DB, upgrade từ version trước, schema drift/PostgreSQL contract, rollback application.

### 10.8. Prompt thực thi mục 8

```text
Triển khai mục 8 “Bộ máy quản lý phiên bản pháp lý” cho BiddingFlow theo các
increment 8A→8D; không triển khai executable compliance rules của mục 9.

Đọc trước: AGENTS.md, CONTEXT.md, mục 8 trong tài liệu đề xuất, AI knowledge
schema/ingestion/retrieval, versioning aggregate command/snapshot, timeline rule
catalog pattern và evidence ledger. Chạy git status --short; giữ diff không liên quan.

Gate bắt buộc phải có ADR/product approval:
- applicability anchor theo từng target/workflow;
- transition/amend/repeal/suspend/overlap;
- global hay organization scope;
- actor/action được publish và override, ánh xạ vào permission hiện hữu;
- legacy auto/manual backfill;
- version mới clone binding hay resolve lại;
- offline/unresolved behavior.
Nếu thiếu gate, chỉ làm inventory, domain model/ADR draft, schema prototype không
được wire production và blocker report. Không chọn “latest” làm default.

Thiết kế một deep module tách:
1. LegalInstrumentDraft (mutable CAS) + immutable published LegalInstrumentVersion;
2. LegalSourceProfileDraft/member (mutable CAS) + immutable published
   LegalSourceProfileVersion/member snapshot chỉ chứa exact instrument/source IDs;
3. versioned deterministic ApplicabilityPolicy;
4. append-only LegalBinding vào exact plan/package version + typed CAS binding head;
5. immutable source artifact/content hash + optional link tới exact AI knowledge
   document/chunks để citation.

Ràng buộc:
- Không dùng ai_knowledge active/retired/current retrieval làm legal authority.
- Current RAG retrieval loại retired source; bổ sung exact-ID historical lookup
  sau target authorization. Pin immutable artifact/hash và bảo vệ update/delete
  (FK RESTRICT hoặc domain guard) cho source đã được profile/binding tham chiếu.
- Published version/history không update hoặc xóa.
- Draft rows dùng expectedDraftRevision. Publish atomically appends immutable
  version/member snapshot + event; không mutate draft thành published row và
  không UPDATE prior published version/members.
- Status hiệu lực được tính theo reference date; không dùng thời điểm mở app.
- Resolution trả RESOLVED/AMBIGUOUS/UNRESOLVED/MANUAL_REVIEW_REQUIRED;
  không fallback latest và không hồi tố.
- Legal binding không cấp quyền đọc, không che field, không tạo sensitive-read
  capability và không liên hệ Word entitlement.
- Publish/bind/approved override là strict, idempotent, CAS-protected, audited.
- Bind/override nhận expectedBindingRevision, lock/CAS typed target head, append
  history + advance head cùng transaction; target rowVersion chỉ validate facts.
- Aggregate version creation chỉ clone/re-resolve đúng approved policy.
- Không tạo placeholder rule/form IDs. Cho tới khi item 9/11 có real immutable
  entities, rulePack/formSet/compliance result là NOT_AVAILABLE/NOT_EVALUATED;
  later migration tạo ComplianceBundleVersion tham chiếu source profile.

Thực hiện:
A. Migration append-only + schema/index/FK/uniqueness, explicit SYSTEM/org owner
   scope, composite tenant FKs, typed plan/package target bindings, immutable
   source artifact, protected link, typed binding history/head revision CAS và
   exact-ID historical citation seam. Chặn
   org A→org B ở DB/service; không dùng unguarded polymorphic target_type/id.
B. Catalog/profile domain, repository, service, API adapters, UI và audit.
C. Pure applicability resolver với approved table-driven fixtures.
D. Transactional exact binding và authorized read composition.
E. Legacy reconciliation report; chỉ auto-bind evidence chắc chắn theo approval,
   còn lại giữ UNRESOLVED/NEEDS_REVIEW.
F. Feature flag/shadow read; chưa dùng binding để block workflow trong mục này.

Tests: draft CAS; publish appends snapshot/event and never updates prior published
instrument/profile/member rows; immutable/hash; concurrent binding-head CAS/getExact determinism;
temporal boundaries; approved transition fixtures;
historical no-rebind; version clone/re-resolve; unresolved legacy; cross-tenant
and command auth; exact historical citation; idempotency/audit; fresh/upgrade/
PostgreSQL schema contract. Giữ pass AI knowledge và aggregate version tests.

Bàn giao ADR, vocabulary, ERD, migration/rollback, reconciliation counts,
API/UI, test commands/results và mọi unresolved record/gate. Không cho AI tự
chọn profile hoặc tự kết luận compliance.
Chạy targeted backend/JS tests, git diff --check,
python scripts/check_mojibake.py và quality gate authoritative trong package/CI;
báo test chưa chạy + lý do, files/diff scope và compatibility.
```

## 11. Mục 12 — Trợ lý AI về tuân thủ đấu thầu

### 11.1. Điều kiện tiên quyết không được bỏ qua

Không xây chatbot mới. Mở rộng mode `procurement_advice` của assistant hiện tại chỉ sau khi có:

1. exact legal binding từ mục 8;
2. deterministic rule/finding model được duyệt từ mục 9 và checklist/context mục 11;
3. authorized record/version read seam;
4. document/workflow/timeline facts có provenance đủ cho câu hỏi tương ứng.

Nếu thiếu (1) hoặc (2), không được để model tự suy luật, chọn luật mới nhất hoặc tạo finding. Có thể chỉ trả thông báo có cấu trúc “chưa đủ hạ tầng kiểm tra xác định” và tiếp tục RAG tư vấn chung như hiện tại.

### 11.2. Thiết kế đích

Thêm target hint không đáng tin vào mỗi message:

```json
{"targetType": "goithau", "targetId": "...", "versionId": "..."}
```

Backend resolve lại target/version và fresh authorization. Tool read-only duy nhất cho lát đầu:

```text
get_compliance_context({targetType, targetId, versionId?})
  -> DeterministicComplianceSnapshot
```

Snapshot bounded, versioned:

```json
{
  "target": {"type": "goithau", "id": "...", "exactVersionId": "..."},
  "snapshotVersion": "...",
  "legalBinding": {"sourceProfileVersionId": "...", "sources": []},
  "complianceBundle": {"bundleVersionId": "..."},
  "findings": [
    {
      "ruleId": "...",
      "ruleVersion": "...",
      "severity": "NEEDS_REVIEW",
      "result": "...",
      "evidencePaths": [],
      "legalSourceIds": []
    }
  ],
  "workflow": {},
  "timeline": {},
  "documents": {},
  "versionContext": {},
  "notEvaluated": []
}
```

Tool output là dữ liệu không tin cậy đối với model prompt injection, nhưng là nguồn xác định cho rule result. AI chỉ:

- giải thích finding/evidence/source;
- tổng hợp các phần thiếu hoặc chưa đánh giá;
- đề xuất bước tiếp theo dưới dạng gợi ý;
- nói rõ giới hạn và không biến `NEEDS_REVIEW` thành “vi phạm pháp luật”.

AI không write/approve/publish/sign/change state, không quyết định permission, không tính lại rule bằng prompt và không dùng web result để ghi đè exact historical binding.

### 11.3. Source/citation policy

Ưu tiên nguồn theo câu hỏi về exact record:

1. deterministic finding và exact bound legal source/version;
2. source document/chunk đã phê duyệt gắn binding;
3. dữ liệu workflow/document/timeline có provenance;
4. official web search chỉ để bổ sung thông tin chung khi policy hiện hành cho phép.

Không gửi workspace record data/query/identifier nhạy cảm sang external web-search adapter. Web result không chứng minh luật áp dụng cho historical target. Mỗi claim compliance phải trace được `ruleId → evidence path → legal source/version`; nếu thiếu, trả “chưa đủ căn cứ”.

### 11.4. Authorization, quota và audit

- Giữ `permission_context.py` và fresh re-derivation trong `tool_executor.py` cho mỗi tool call.
- `procurement_advice` chỉ nhận strict allowlisted tool, không raw SQL/filter hoặc arbitrary entity query.
- Conversation/workspace/target mismatch bị từ chối.
- Authorized record data vẫn đầy đủ; không tạo sensitive-read capability. Word entitlement không giới hạn context record.
- Quota/cancellation/SSE/source events/audit metadata dùng pipeline hiện có; không log raw prompt/tool snapshot nếu security model hiện tại không cho phép.

### 11.5. UI

- Dùng `AssistantController` hiện hữu; khi mở từ record, gửi target hint và hiện chip target/version.
- Hiển thị source exact version, rule ID, mức cảnh báo, evidence và `notEvaluated`.
- Khi target đổi hoặc mất quyền, clear context chip/result stale; server vẫn là authority.
- CTA điều hướng tới màn hình xử lý chỉ là link; không cho model thực thi action.

### 11.6. Test/eval và nghiệm thu

- Advice mode có đúng tool schema read-only; unknown field/tool bị reject.
- Fresh auth mỗi call, workspace/target mismatch, revoked assignment, cross-tenant no-leak.
- Full authorized context không bị masking mới; Word entitlement không ảnh hưởng read.
- Exact historical legal source thắng current web result.
- Missing binding/rule/provenance tạo `notEvaluated`, không hallucinated finding.
- Eval fixtures cho grounded explanation, citations, temporal selection, “không kết luận vi phạm”, prompt injection trong record/source, Vietnamese clarity.
- Model timeout/failure không ảnh hưởng deterministic finding; rule engine hoạt động độc lập AI.
- Không có write tool/action side effect; audit/quota/SSE tests hiện hữu tiếp tục pass.

### 11.7. Prompt thực thi mục 12 có prerequisite gate

```text
Nâng cấp Trợ lý AI hiện có cho mục 12 “Trợ lý AI về tuân thủ đấu thầu”.
KHÔNG xây chatbot/controller/conversation store thứ hai.

Đọc AGENTS.md, CONTEXT.md, mục 8/9/11/12 trong tài liệu đề xuất,
docs/ai/AI_API_CONTRACT.md, AI_SECURITY_MODEL.md, permission_context.py,
tool_executor.py, tools registry, service/prompt policy, knowledge retrieval và
evidence ledger. Chạy git status --short; không chạm diff ngoài scope.

PREREQUISITE GATE:
- Có exact immutable LegalBinding từ mục 8?
- Có deterministic compliance rules/findings đã được product duyệt, version hóa,
  có rule ID, severity/result, evidence paths và exact legal source IDs từ mục 9/11?
- Có authorized read seam cho target/version và provenance của facts được hỏi?
Nếu câu trả lời cho hai điều đầu là không, DỪNG implementation compliance tool,
không bịa schema/rule và không để model suy quyết định. Bàn giao blocker report;
có thể giữ nguyên RAG advice chung hiện hành.

Khi prerequisite đạt:
1. Thêm optional untrusted target hint {targetType,targetId,versionId} vào message
   contract; backend tự resolve và authorize.
2. Tạo ComplianceContext deep module deterministic, bounded, versioned; output
   exact target snapshot, LegalBinding, findings, workflow/timeline/documents/
   version facts và notEvaluated.
3. Cho procurement_advice đúng một strict read-only tool
   get_compliance_context; không raw SQL/filter và không write tools.
4. Re-derive session/workspace/active role/module/assignment/record scope ở mỗi
   call bằng seams hiện hữu. Target mismatch/revocation không lộ data.
5. Không masking/redaction business fields đã được phép đọc; không tạo
   sensitive-read capability; Word entitlement không gate record context.
6. Prompt/orchestrator yêu cầu AI chỉ giải thích deterministic result, citation,
   evidence và next-step suggestion. AI không quyết định rule, permission,
   blocking, approval/publish/sign hoặc “vi phạm pháp luật” từ cảnh báo.
7. Exact bound historical sources ưu tiên current web. Không gửi workspace data
   sang external web search và không cho web result đổi legal binding.
8. Dùng AssistantController, conversation, SSE, citation, quota và audit hiện có.
   UI có target/version chip, source/rule/evidence/not-evaluated states.

Tests/evals bắt buộc: strict/read-only schema; fresh authorization/revocation;
cross-tenant/workspace mismatch; full authorized fields; Word-entitlement
independence; exact historical citation; missing prerequisites/no hallucination;
prompt injection resistance; no write side effects; timeout degradation;
Vietnamese grounded explanations và không-kết-luận-vi-phạm.

Chạy targeted AI/backend/JS tests, security checks và quality gate. Bàn giao
context schema/version, source precedence, eval results, files/test commands,
compatibility và mọi fact còn notEvaluated.
```

## 12. Mục 15 — Nâng cấp Trình thiết kế biểu mẫu Word

### 12.1. Kết quả cần đạt

Deepen nền tảng hiện có thành `WordTemplateCatalog` với logical template identity, immutable content versions, draft/publish, restore, rendered preview, usage query và preflight compatibility. Không xây lại upload/render/mapping/sanitizer/assignment.

Cần phân biệt rõ:

- `revision` hiện tại trong filesystem config là CAS/config revision, **không phải** lịch sử content version;
- logical template là identity ổn định;
- template version là immutable bytes + manifest/checksum;
- publication là pointer/assignment có CAS tới exact template version;
- generated artifact provenance thuộc mục 14; mục 15 chỉ chuẩn bị exact `template_version_id` và hook để exporter ghi provenance sau này.

### 12.2. Seam hiện hữu

- Scope/CAS/locking/atomic replace/compensation: `backend/documents/custom_exporter.py`.
- CRUD, resolver, assignments, render/export/audit: `backend/documents/routes_docx.py`.
- Mapping hiện có là default registry trong `backend/documents/word_mapping_registry.py` cộng sparse per-owner overrides ở bảng `word_mapping_overrides` (`backend/db/schema.py`); không có bảng `word_template_mappings` và override hiện không phải template-content version.
- UI: `views/tabs/tab_bieumau.html`, `frontend/documents/WordTemplateAssignments.js`, `WordPublicationTemplateConfig.js`, `WordIntegration.js`.
- Contract: ADR 0001 và ADR 0005; các test concurrency, CRUD, assignment, sanitizer, cross-context và mapping hiện hữu.

### 12.3. Data model và storage

Tên dự kiến:

```text
word_template
  id, organization/scope owner, stable code, display name,
  draft pointer, published pointer, row_version, timestamps

word_template_version (immutable)
  template_id, monotonically assigned version_no,
  storage_key, sha256, byte_size, original filename,
  immutable creation/content manifest + sanitizer version,
  created_by/at

word_template_preflight_run (append-only)
  template_version_id, parser/mapping-base/mapping-snapshot/
  required-registry/context-policy versions,
  report_json + report_hash, result, run_by/at

word_template_publication_event (append-only)
  template_id, from/to version, action PUBLISH/RESTORE/RETIRE,
  accepted_preflight_run_id, actor/time/reason,
  config revision/audit reference

word_template_projection_outbox
  template/version/publication/assignment event,
  desired legacy alias/config serialization/checksum,
  status/attempt/lease/error metadata

word_publication_assignment_v2 (nếu DG-15-04 duyệt)
  owner scope + stable document type/context,
  logical template_id, resolution_mode FOLLOW_PUBLISHED|PIN_VERSION,
  pinned_version_id nullable, row_version
```

Không trả raw filesystem path qua API. Upload đi qua temp → sanitizer/size/type/manifest validation → content-addressed immutable storage; DB insert tham chiếu checksum/storage key. File upload trước DB có thể tạo orphan nhưng không tạo published state; cleanup/reconciliation xử lý orphan an toàn.

Template version row không chứa mutable preflight/lifecycle state. Draft/published/retired được suy từ CAS pointers + append-only publication events. Mỗi lần preflight tạo immutable run (hoặc immutable cache row keyed bởi toàn bộ input versions); parser/mapping override/required registry/context policy đổi thì tạo run mới. Publish pin exact accepted `preflight_run_id` và không UPDATE old version/run rows. `restoreAsDraft` tạo version mới; normal preflight và publish sau đó tạo run/event mới.

Không tuyên bố transaction nguyên tử xuyên DB và filesystem. Sau cutover, **DB published pointer là authority**: một DB transaction ghi pointer + publication event + required audit + durable projection outbox. Resolver mới đọc exact version từ DB/immutable storage. Worker (hoặc best-effort post-commit fast path) dùng existing scope lock + atomic replace để chiếu legacy alias; job idempotent theo desired checksum và reconciler sửa alias stale sau crash. Lỗi alias projection không rollback giả DB commit và không làm pointer mất authority.

Assignment compatibility phải explicit. ADR 0005 vẫn yêu cầu stable document type + explicit assignment và cấm fallback ngầm. Trong shadow phase, filename mapping trong `config.json` tiếp tục authoritative. Trước cutover, DG-15-04 phải chọn v2 assignment trỏ logical template theo `FOLLOW_PUBLISHED` hay pin exact version; generated artifact luôn ghi exact resolved version. Legacy filename/alias trở thành derived serialization có stable alias key, không phải identity. Rename logical display name không được làm orphan assignment; legacy rename/alias update phải đi qua cùng DB command + projection outbox hoặc bị deprecate sau cutover.

Khuyến nghị restore tạo một **draft version mới** từ bytes/creation manifest của version cũ, chạy normal preflight mới rồi publish pin accepted run, thay vì di chuyển pointer lặng lẽ; DG-15-01 phải xác nhận. Version đã publish không được mutate/delete bởi replace; retention/purge chỉ theo policy đã duyệt và không phá artifact provenance.

### 12.4. Compatibility adapter và rollout

1. Mỗi template hiện hữu được inventory bằng scope/code/path/checksum/assignment.
2. Migration tạo logical identity + version ban đầu, không đổi explicit publication assignments.
3. Trong shadow phase, legacy config/path vẫn là authority và catalog chỉ đối chiếu; không cho hai write authorities chạy đồng thời.
4. Shadow compare checksum/resolution, drain/reconcile alias và verify parity trước cutover.
5. Cutover đồng thời command + resolver: DB pointer trở thành authority; resolver đọc exact version và không fallback “một active template bất kỳ” trái ADR 0005. Legacy alias chỉ là durable derived projection cho compatibility.
6. Assignment v2/API serialization theo DG-15-04 được cutover cùng resolver; stable document type/explicit assignment giữ nguyên, rename không đổi identity hoặc làm orphan relation.
7. Sau cutover, replace trở thành create version/draft + explicit publish; route legacy chỉ là adapter vào same command hoặc bị disable/deprecate có telemetry.
8. Rollback về app cũ phải quiesce publish/assignment changes, drain projection outbox, verify every legacy alias/config checksum equals DB pointers/assignments, rồi mới deploy; không mặc định projection luôn đồng bộ sau crash.

Không sửa file template hiện có tại chỗ để “backfill”. Migration fresh DB và upgrade DB phải cùng invariant.

Mapping mutation phải đi qua service có CAS/transaction và required audit cho mọi thay đổi mapping, dù mapping vẫn template-scoped hay sau này được pin theo version. Audit tối thiểu bao phủ upload/replace/create-version, publish, restore và mapping-change; lỗi required audit phải có rollback/compensation phù hợp, không để file/config/DB lệch nhau.

### 12.5. Preflight/preview

Preflight tái dùng parser, variable dictionary, mapping, formula/list expansion và sanitizer. Báo cáo version hóa gồm:

- placeholder thiếu/không biết;
- variable required theo registry đã được duyệt, không suy từ template text;
- loop nesting/closing và expression unsupported;
- mapping/type/context mismatch;
- warnings đa-context theo ADR 0005, không tự nâng thành blocker;
- manifest/checksum/parser version.

Mỗi report là append-only `word_template_preflight_run`, pin exact template content hash cùng parser, default mapping base version, effective override snapshot/hash, required-variable registry và context-policy versions. `runPreflight(versionId)` không update `word_template_version`. Publish chỉ chấp nhận/pin một run phù hợp policy/freshness đã duyệt; re-preflight tạo run khác và giữ report cũ để audit/reproduce.

Preview modes:

- `SAMPLE`: fixture/sample dataset được version hóa và ghi rõ không phải hồ sơ thật.
- `RECORD`: load committed server snapshot của exact authorized record/version; authorization record không phụ thuộc Word entitlement.

Load exact record và dựng preflight context chỉ dùng canonical record authorization, trả đầy đủ business fields. Bất kỳ preview nào **tạo hoặc tải rendered Word artifact** phải giữ Word create/download entitlement hiện hành; đây đã là business contract, không phải gate mở. DG-15-02 chỉ cần cho draft/publish/restore và một non-Word/sample visualization không tạo Word artifact, hoặc nếu product muốn thay đổi action semantics. Trong mọi trường hợp entitlement không được thay đổi field của API record. Preview chạy qua sandbox/temp cleanup/timeout/size limits; PDF derived từ Word mặc định giữ action gate hiện hữu cho tới khi có contract khác được phê duyệt.

### 12.6. Usage và provenance seam

`getUsage(templateVersionId|templateId)` tổng hợp từ provider có provenance:

- current document-type/publication assignment;
- workflow/rule reference nếu có relation authoritative;
- generated artifact reference sau mục 14;
- package use chỉ khi artifact/assignment chứng minh, không suy từ tên file hoặc lần mở UI.

Response phân biệt current/historical/unknown. Không cho usage query mở record ngoài canonical read scope; aggregate counts cũng dùng visibility predicate. Không dùng Word entitlement để che package details mà actor được quyền đọc.

### 12.7. API/UI

Command/query dự kiến:

```text
listTemplates/listVersions/getVersion
createDraftVersion(expectedRowVersion, file, metadata)
runPreflight(versionId)
publish(versionId, acceptedPreflightRunId, expectedRowVersion, reason)
restoreAsDraft(sourceVersionId, expectedRowVersion, reason)
preview(versionId, SAMPLE|RECORD, target?)
getUsage(templateId|versionId)
```

UI thêm version timeline, badges Draft/Published/Retired theo policy, checksum/actor/time, side-by-side preflight, publish confirmation, restore confirmation, preview và usage drawer. Mọi stale CAS trả 409 + reload state; không silent retry publish.

### 12.8. Test và nghiệm thu

- Immutable bytes/version; checksum deterministic; concurrent upload/publish/restore và stale CAS.
- Re-preflight/parser/mapping/policy change chỉ append run; publish/restore/retire không UPDATE old version/run rows và publication event pin exact accepted run.
- Crash-boundary/reconciliation: DB pointer/event/audit/outbox atomic; alias projection idempotent, crash-recoverable và không làm mất file cũ trước atomic replace.
- Restore semantics đúng DG, tạo audit và không sửa source version.
- Personal/organization tenant isolation, filename/path traversal, macro/external relationship sanitizer, size/zip bomb nếu applicable.
- Existing explicit assignments/resolver/cross-context warning giữ nguyên.
- Assignment follow/pin/rename/legacy serialization đúng DG-15-04; không orphan và không fallback active template.
- Real preview fresh record authorization; full authorized data; Word entitlement chỉ gate action đúng contract.
- Preflight parser/mapping/loop/expression/required registry; warning không thành blocker ngầm.
- Audit regression cho upload/replace/create-version, publish, restore và mọi mapping-change; required-audit failure không để state/file lệch.
- Usage scope/no-leak, current/history provenance.
- Migration inventory/parity, fresh/upgrade/PostgreSQL schema contract và app rollback.

### 12.9. Prompt 15A — Catalog, migration và compatibility

```text
Triển khai increment 15A của “Nâng cấp Trình thiết kế biểu mẫu Word”:
WordTemplateCatalog + immutable versions + draft/publish compatibility.

Đọc AGENTS.md, CONTEXT.md, mục 14/15 trong tài liệu đề xuất, ADR 0001,
ADR 0005, custom_exporter.py, routes_docx.py, mapping schema và toàn bộ Word
concurrency/CRUD/assignment/sanitizer tests. Chạy git status --short; giữ diff khác.

Trước code phải có quyết định được duyệt về logical identity, numbering,
draft/publish/retire, restore, retention, mapping pinning, assignment v2
follow-published-vs-exact-version, legacy filename/rename serialization và quyền action.
Nếu thiếu, dừng phần phụ thuộc, viết ADR/questions; không tự đổi permission,
entitlement, assignment, masking hay expected tests.

Thực hiện:
1. Tạo WordTemplateCatalog deep module với logical template và immutable
   content version: exact bytes/storage key, SHA-256, manifest/version,
   actor/time, monotonically allocated version number.
2. Tạo publication pointer/event có rowVersion/CAS. Published content không mutate.
3. Upload: temp → existing sanitizer/validation → content-addressed immutable
   storage → DB reference; orphan cleanup/reconciliation rõ ràng.
4. Không giả định DB+filesystem atomic. Sau cutover, một DB transaction ghi
   published pointer + event + required audit + durable projection outbox. New
   resolver dùng DB pointer; worker idempotent dùng existing scope lock/atomic
   replace để chiếu legacy alias và reconciles crash/stale checksum.
5. Template version không chứa mutable preflight/lifecycle marker. Lifecycle từ
   pointers/events; preflight là append-only run pin all input versions. Publish
   event pin accepted run. Restore đúng approved contract, khuyến nghị tạo version mới từ source bytes,
   không rewrite history.
6. Append-only migration: inventory template hiện có thành initial version,
   giữ nguyên explicit assignments/legacy paths. Shadow phase chỉ có legacy write
   authority; parity rồi cutover command+resolver sang DB authority. Không chạy
   hai authorities, không fallback active template ngầm. Rollback app cũ phải
   quiesce/drain/reconcile/verify alias checksum trước deploy.
7. Implement assignment v2 chỉ theo approved DG-15-04: preserve stable document
   types/explicit assignments; FOLLOW_PUBLISHED hoặc PIN_VERSION exact; legacy
   config/filename là derived serialization. Rename không orphan assignment.
8. Không trả raw filesystem path. Không xây lại renderer/mapping semantics.
9. Tách mapping mutations qua service có transaction/CAS và required audit cho
   mọi mapping-change, không phụ thuộc việc mapping có được version hóa. Chỉ pin
   mapping theo template version khi ADR chốt và có migration rõ.

Tests: immutable/hash; re-preflight/publish/restore never update old version/run;
accepted-run pin; two-process CAS; stale publish 409; crash tại blob/DB/
audit/outbox/alias boundaries; idempotent projection/reconciliation/rollback parity;
restore/audit; personal/org isolation; legacy resolver/assignment parity;
sanitizer/cross-context; audit upload/replace/publish/restore/mapping-change và
required-audit failure; assignment follow/pin/rename/legacy serialization;
fresh/upgrade/schema contract/rollback.

Bàn giao ADR, ERD/migration/runbook, parity report, files/tests/results và kill
switch. Không triển khai preview PDF hoặc generated-document staleness ở 15A.
Chạy targeted Word/backend/JS tests, git diff --check,
python scripts/check_mojibake.py và quality gate authoritative trong package/CI;
báo test chưa chạy + lý do và compatibility impact.
```

### 12.10. Prompt 15B — Preflight và rendered preview

```text
Triển khai increment 15B trên WordTemplateCatalog đã nghiệm thu. Xem đây là một
task độc lập về review/diff nhưng có prerequisite chức năng là 15A.

Đọc AGENTS.md, CONTEXT.md, mục 15 trong tài liệu đề xuất, evidence ledger,
ADR 0001/0005, implementation/tests của 15A và approved DG-15 về non-artifact
preview, required-variable registry, warning-vs-blocker và PDF scope.
Chạy git status --short; bảo toàn mọi dirty diff không thuộc 15B. Không đổi role,
module/assignment/record scope, masking/field visibility/capability/entitlement;
Word entitlement chỉ gate action đúng contract, không lọc dữ liệu record.
Record load/preflight context luôn dùng canonical record authorization và full
business fields. Nếu preview tạo/tải rendered Word, bắt buộc giữ existing Word
create/download entitlement. Nếu non-Word/PDF action semantics chưa rõ, chỉ làm
SAMPLE preflight không tạo artifact; dừng phần đó và báo blocker.

1. Tách pure TemplatePreflight service, tái sử dụng manifest/parser/mapping/
   formulas/list expansion/sanitizer hiện có.
2. Báo unknown/missing approved-required variable, invalid loop/expression,
   context/type/mapping issue; report có schema/tool version và severity.
3. Mỗi run append immutable row pin template hash, parser, mapping base/effective
   override snapshot, required registry và context policy versions + report hash.
   runPreflight không UPDATE template version; publish pin exact accepted run.
4. Không tự biến cross-context warning của ADR 0005 thành publish blocker.
5. SAMPLE preview dùng versioned sample fixture, gắn nhãn rõ.
6. RECORD preview load exact committed server record/version qua canonical read
   authorization; không dùng Word entitlement để lọc field. Gate action render/
   download đúng approved contract, không tạo sensitive-read capability.
7. Pin exact template version; render sandbox/temp cleanup/timeout/size bound;
   không trả filesystem path. PDF chỉ thêm khi converter/ops contract được duyệt.
8. Preview không publish, không đổi assignment và không ghi business record.

Tests: preflight matrix; append-only run/input-version pin/report determinism;
publish pins accepted run; re-preflight never mutates version/old run; sample/record separation; tenant/
record authorization; full authorized data; entitlement-action independence;
stale/deleted template version; sanitizer; timeout/cleanup; audit theo contract.
Chạy targeted backend/JS tests, git diff --check, mojibake và quality gate phù hợp.
Bàn giao file/diff scope, API contract, UI states, fixtures, migration impact,
compatibility, test commands/results, rollback và unsupported checks.
```

### 12.11. Prompt 15C — Restore, usage và UI hoàn chỉnh

```text
Hoàn thiện increment 15C sau khi 15A/15B pass và DG-15-01..03 đã được duyệt.
Đây là task độc lập về review/diff nhưng phụ thuộc artifacts đã nghiệm thu.

Đọc AGENTS.md, CONTEXT.md, mục 14/15 trong tài liệu đề xuất, evidence ledger,
ADR 0001/0005 và implementation/tests 15A/15B. Chạy git status --short; bảo toàn
dirty diff ngoài scope. Không đổi permission/scope/masking/field visibility,
không tạo sensitive-read capability và không dùng Word entitlement để che dữ liệu.

1. UI version timeline với exact checksum/creator/time/status; accessible upload,
   preflight, publish, restore, preview và stale-CAS recovery.
2. Restore tạo version draft mới, sau đó đi qua normal preflight + publish pin
   accepted run; history/audit đúng contract và không mutate old version/run.
3. Tạo usage provider registry: current assignment, workflow/rule relation và
   historical generated artifacts chỉ từ authoritative foreign key/provenance.
   Không suy usage từ filename/template name.
4. Authorize từng target của usage bằng canonical scope; aggregate không leak
   denied records. Word entitlement không che record details được phép đọc.
5. Thêm hook để future generated artifact ghi exact template_version_id;
   không tự triển khai toàn bộ mục 14 hoặc tuyên bố file stale khi thiếu source
   record/legal provenance.
6. Feature-flag rollout, telemetry không chứa raw document data, migration parity
   dashboard và documented rollback về legacy alias.

Tests: UI keyboard/focus/states; restore race; usage current/history/no-leak;
assignment compatibility; audit; migration parity; old routes under flag;
regression full Word suite. Bàn giao screenshots nếu repo workflow yêu cầu,
files/tests/results, compatibility và provenance gaps còn lại. Chạy targeted
backend/JS tests, git diff --check, mojibake và quality gate phù hợp; báo rõ
migration/rollback/feature flag và mọi test chưa chạy.
```

## 13. Mục 19 — Tích hợp lịch công việc

### 13.1. Tách phase bắt buộc

- **19A:** user xem preview và chủ động tải snapshot `.ics`; không credential ngoài, không auto-push.
- **19B:** Google Calendar/Microsoft Outlook connectors sau khi có ADR tích hợp, explicit consent, outbound field profile và token operations.

Cả hai dùng chung pure `WorkCalendar` projection. Không để mỗi timeline/case/contract tự sinh format/provider payload riêng.

### 13.2. Nguồn hiện có và target module

Tái sử dụng `shared/timeline_rules.json`, `backend/timeline/effective_timeline.py`, `timeline_context_service.py`, timeline schema/UI, dashboard deadline facts và canonical authorization. Case deadline của mục 20/21 và contract expiry về sau là source adapters.

```text
backend/work_calendar/
  service.py                  # auth + orchestration
  projector.py                # source facts -> canonical CalendarEvent
  source_registry.py          # timeline/case/contract adapters
  revision_policy.py          # UID/significant payload/revision/sequence
  ics_serializer.py           # RFC 5545 adapter
  providers/                  # phase 19B only
    base.py
    google.py
    microsoft.py
  connection_service.py       # consent/token lifecycle, phase 19B
  delivery_outbox.py          # retry/idempotency, phase 19B
```

Canonical event tối thiểu:

```text
eventKey/uid, sourceType/sourceRef, target version/lineage,
title, description/location theo outbound profile,
start/end, valueType DATE|DATE_TIME, timezone,
canonicalRevisionAt, sequence, status, significantPayloadHash
```

UID là opaque/deterministic/global-unique từ stable target lineage + milestone/case instance + approved namespace; không chứa plaintext tenant/record ID. Exact algorithm phải ổn định qua deploy/key rotation. `SEQUENCE` chỉ tăng khi significant calendar payload thay đổi, không dùng download count và không mặc định map mọi `rowVersion`.

Preflight cho từng source adapter phải chứng minh có persisted significant-payload revision contract. Timeline/source hiện hữu chưa chứng minh `rowVersion` chỉ đổi theo field lịch, nên 19A mặc định cần technical projection state:

```text
calendar_event_head
  organization_id + stable event_key/uid,
  significant_payload_hash, sequence, canonical_revision_at,
  source fingerprint/projection policy version, row_version

calendar_event_revision (append-only nếu audit/replay contract yêu cầu)
  event head, sequence/hash/revision_at/source fingerprint
```

Project/export lock-or-CAS head: first observed canonical event gets initial sequence/revision; same significant hash keeps them; changed hash appends/advances exactly once. Đây là technical calendar projection, không sửa business record. Nếu một future source muốn không dùng bảng, ADR + tests phải chứng minh native persisted significant revision/sequence equivalent; không được rơi về broad record rowVersion hoặc download timestamp.

### 13.3. RFC 5545 contract cho 19A

Serializer phải tạo `VCALENDAR` có `PRODID`, `VERSION:2.0` và các `VEVENT` hợp lệ:

- persistent `UID`;
- `DTSTAMP` UTC lấy từ canonical event revision, không lấy thời điểm tải file;
- `DTSTART` và `DTEND`/`DURATION` theo date type;
- `DTEND` exclusive; all-day dùng `VALUE=DATE`, kết thúc là ngày kế tiếp;
- `SEQUENCE`/`STATUS` theo approved revision/cancellation contract;
- line endings CRLF, TEXT escaping đúng, fold quá 75 octet và không cắt hỏng UTF-8;
- DATE-TIME dùng UTC `Z` hoặc `TZID` với timezone definition đúng, không dùng numeric offset;
- snapshot export không thêm `METHOD`; chỉ thêm scheduling `METHOD` sau một contract riêng;
- MIME `text/calendar; charset=UTF-8`, safe filename và `Cache-Control: private, no-store`.

Nguồn chuẩn: [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545).

### 13.4. Authorization và outbound-data boundary

1. User chọn source records/events và outbound profile trong UI preview.
2. Server resolve selection và authorize từng source tại request time.
3. Denied item không trả title/date/detail; response theo contract có thể fail toàn bộ hoặc chỉ báo coarse excluded count sau DG-19.
4. Authorized internal record vẫn giữ đầy đủ field trong API hiện hành. Outbound profile chỉ quyết định nội dung file/provider payload, không phải masking/read permission.
5. `.ics` là calendar export, không dùng Word entitlement. Nếu product muốn entitlement riêng, đó là permission change cần approval/ADR.
6. Historical version/current version behavior phải explicit để không tạo event trùng hoặc vô tình cập nhật current event.

DG-19-01 phải chốt source matrix, planned/actual precedence, all-day/timed, timezone, title/description/location, cancellation, selection scope và update semantics.

### 13.5. Phase 19B connectors

Port:

```text
CalendarProvider.connect/callback/refresh/revoke
CalendarProvider.upsertEvent(connection, event, binding)
CalendarProvider.cancelEvent(connection, binding)
CalendarProvider.reconcile(cursor)             # chỉ nếu two-way được duyệt
```

Data hỗ trợ:

```text
calendar_connection
  owner scope, provider/account/calendar, encrypted token reference,
  granted scopes, consent/outbound profile version, status, expiry

calendar_event_binding
  local event UID/revision/hash, provider connection, remote event ID/etag,
  last delivered revision, last result

calendar_delivery_outbox
  event revision, action, idempotency/attempt/backoff/status
```

- Google Calendar: dùng API tạo event và provider-valid client-supplied event `id` khi contract cho phép; `id` này khác RFC `iCalUID`, phải được adapter dẫn xuất thành base32hex hợp lệ/unique theo Google, không truyền thẳng canonical UID. Scope phải qua product/security review, không copy scope rộng từ sample. Nguồn: [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events), [Choose scopes](https://developers.google.com/workspace/calendar/api/auth). Nếu two-way, persist `nextSyncToken`, giữ query nhất quán qua pagination và xử lý HTTP 410 bằng full resync theo [Incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync).
- Microsoft Graph: event create qua calendar endpoint, scope/permission được duyệt; `transactionId` là seam idempotency. Nguồn: [Create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0), [Permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference). Tài liệu delta hiện được viện dẫn chỉ mô tả `calendarView/delta` theo khoảng thời gian của **primary calendar**, với opaque next/delta links: [Event delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0). Calendar không phải primary chỉ hỗ trợ one-way trong plan này; two-way phải chờ một adapter/contract chính thức khác được duyệt.

Google login ID token hiện có không phải Calendar OAuth credential và tuyệt đối không tái sử dụng. Connector dùng authorization-code flow, `state`/PKCE theo provider, token encryption/reference, refresh/revoke/disconnect và secret-safe logging. Reauthorize source trước enqueue, trước send và trước retry. Xử lý event đã gửi khi user mất record access/revoke consent là DG-19-02; không tự xóa hoặc giữ remote event theo suy đoán.

### 13.6. API/UI

**19A:** query source events → preview exact outbound fields → download `.ics`. UI phân biệt date/timezone, event excluded/not evaluated và cảnh báo dữ liệu sắp rời hệ thống; download chỉ sau explicit click.

**19B:** integration settings cho connect/account/calendar/outbound profile, review consent/scopes, manual sync, status/error/retry và disconnect. Default không connected, không auto-push. Two-way controls không hiện nếu chưa duyệt; với Microsoft, delta control chỉ hợp lệ cho primary calendar theo API contract đã viện dẫn.

### 13.7. Migration/rollout/rollback

- 19A thêm tenant-scoped `calendar_event_head` (và append-only revision history nếu ADR yêu cầu) vì source hiện tại chưa có persisted significant-event revision. Chỉ source adapter chứng minh native equivalent qua ADR/contract tests mới được bỏ projection table.
- 19B bắt buộc migration connection/binding/outbox, secret-management runbook, cleanup/revoke và provider feature flags riêng.
- Bật `.ics` cho một source type trước; validate bằng nhiều calendar clients.
- Connector canary từng provider; kill switch ngăn enqueue/send mới nhưng không xóa remote events ngầm.

### 13.8. Test và nghiệm thu

- Golden/parser tests RFC: CRLF, fold UTF-8 75 octet, escape backslash/comma/semicolon/newline, Unicode và long line; có negative vectors chứng minh forward slash và colon không bị escape.
- `PRODID/VERSION/UID/DTSTAMP/DTSTART/DTEND`, all-day exclusive end, timezone/DST vectors; không numeric offset, không `METHOD` cho snapshot.
- Same source/revision → same UID/sequence/bytes theo contract; significant change tăng sequence, irrelevant row change không tăng.
- Concurrent exports/CAS chỉ advance một sequence; crash/retry không tăng lặp; broad rowVersion-only change không đổi head.
- Authorization tenant/module/assignment/record; no denied metadata; full internal record contract không đổi.
- Preview khớp outbound payload; không download/push trước user action/consent.
- Connector state/PKCE/token secrecy/refresh/revoke; retries không duplicate; stale event/etag handling.
- Revoked record/consent chặn enqueue/send/retry; behavior remote existing đúng ADR.
- Google sync-token 410 và Microsoft opaque next/delta link chỉ khi two-way được duyệt; Microsoft delta bị giới hạn ở primary calendar, non-primary không được âm thầm dùng cùng flow.

### 13.9. Prompt 19A — `.ics`

```text
Triển khai mục 19A: user-previewed, user-initiated .ics export cho BiddingFlow.

Đọc AGENTS.md, CONTEXT.md, mục 18/19 trong tài liệu đề xuất, timeline rules/
effective timeline/context/UI/tests, canonical read scope, export route patterns,
evidence ledger và RFC 5545. Chạy git status --short; giữ diff ngoài task.

Trước code, xác nhận approved DG-19-01: event source matrix, planned/actual,
date-only/timed/timezone, stable UID namespace, significant change/SEQUENCE,
cancellation, historical/current scope, outbound title/description/location và
selection denied behavior. Nếu thiếu, chỉ làm pure projector/serializer test
vectors cho phần đã xác định; không đoán outbound production semantics.

1. Tạo WorkCalendar deep module và source adapter dùng effective_timeline; không
   copy deadline logic. Case/contract adapters chỉ thêm khi source đã authoritative.
2. Canonical CalendarEvent có opaque stable UID, source provenance, DATE hoặc
   DATE_TIME/timezone, canonical revision DTSTAMP, significant hash, SEQUENCE,
   STATUS và approved outbound fields.
3. UID không lộ plaintext tenant/record ID. DTSTAMP không lấy download time;
   SEQUENCE không map mọi rowVersion và không tăng theo download.
4. Preflight source revision contract. Với sources hiện hữu, thêm append-only/
   CAS technical calendar_event_head (và revision history nếu ADR yêu cầu) lưu
   significant hash, sequence, canonicalRevisionAt, source/policy fingerprint.
   Same hash giữ revision; changed hash advance đúng một lần; concurrent export/
   crash/retry không double-increment. Chỉ bỏ bảng khi ADR/tests chứng minh native
   persisted significant revision; broad rowVersion không đủ.
5. RFC serializer: VCALENDAR PRODID + VERSION:2.0; VEVENT UID/DTSTAMP/DTSTART/
   DTEND hoặc DURATION; all-day DTEND exclusive; CRLF; correct TEXT escaping;
   >75-octet folding không phá UTF-8; UTC Z hoặc TZID, không numeric offset;
   snapshot không METHOD; text/calendar UTF-8.
6. Strict server endpoint: resolve + authorize từng source bằng tenant/module/
   assignment/record scope, snapshot consistency, safe filename, private/no-store,
   audit. Không dùng Word entitlement và không đổi record response/masking.
7. Accessible selection/preview hiển thị chính xác outbound payload; file chỉ
   được tạo/tải sau explicit action. Denied record không lộ title/date/detail.
8. Feature flag; không thêm provider credential hoặc auto-push ở phase này.

Tests: RFC golden + independent parser; Unicode/escaping/folding; all-day/
timezone/DST; stable UID/revision/sequence; significant-vs-irrelevant changes;
concurrent head CAS/crash-retry/no double increment; fresh/upgrade schema contract;
auth/no-leak/cross-tenant; preview-payload parity; header/filename injection;
snapshot conflict/audit; UI keyboard/states. Chạy targeted tests,
git diff --check, python scripts/check_mojibake.py và quality gate authoritative
trong package/CI; báo test chưa chạy + lý do.

Bàn giao DG/ADR reference, event schema/source matrix, files/tests/results,
calendar-client validation, compatibility và source types chưa hỗ trợ.
```

### 13.10. Prompt 19B — Google/Outlook connectors

```text
Chỉ chạy prompt này sau khi mục 19A ổn định và DG-19-02/Integration ADR đã duyệt:
provider/account ownership, OAuth scopes, target calendar, one-way/two-way,
outbound field profile, auto/manual push, update/cancel/revoke, token storage,
retention và behavior khi record access bị thu hồi.

Đọc AGENTS.md, CONTEXT.md, mục 19 trong tài liệu đề xuất, evidence ledger,
approved Integration ADR, WorkCalendar/19A, existing auth/integration code và
official Google Calendar/Microsoft Graph docs được link trong kế hoạch. Chạy
git status --short và bảo toàn dirty diff ngoài 19B. Không đổi permission/scope,
masking/field visibility/capability/entitlement; outbound profile không thay
record read contract. Không tái sử dụng Google login ID token làm Calendar credential.

1. Tạo CalendarProvider port + Google/Microsoft adapters, không để provider JSON
   lan vào domain projection.
2. OAuth authorization-code với state/PKCE/provider validation; encrypted token
   reference, refresh/revoke/disconnect; không log/return token.
3. Migration tenant/owner-scoped connection, remote event binding và delivery
   outbox với composite constraints/idempotency/audit.
4. Reauthorize source trước enqueue, trước send và mỗi retry. Consent không thay
   record permission; outbound profile không thay field visibility nội bộ.
5. Pin local UID/revision/hash; dẫn xuất Google provider `id` base32hex hợp lệ,
   không truyền canonical RFC iCalUID vào field `id`; dùng Microsoft transactionId;
   retry/timeout không duplicate.
6. Implement update/cancel/remote-revocation đúng ADR. Kill switch dừng send mới,
   không tự xóa remote event.
7. Chỉ implement two-way khi được duyệt: Google nextSyncToken/pagination/410 full
   resync; Microsoft calendarView range + opaque nextLink/deltaLink chỉ cho
   primary calendar. Non-primary phải one-way/unsupported cho tới khi có official
   adapter contract khác được duyệt.
8. UI connect/review consent/select calendar/manual sync/status/retry/disconnect;
   default disconnected/no auto-push.

Tests: OAuth state/PKCE/account mix-up; token secrecy/refresh/revoke; tenant and
owner isolation; fresh reauthorization; payload allowlist; duplicate retry;
etag/stale/conflict; revoked access/consent; provider contract fixtures/rate
limit/backoff; Google provider-ID validation; sync-token/delta only if two-way;
Microsoft primary-vs-non-primary; audit and kill switch. Chạy targeted tests,
git diff --check, mojibake và quality gate phù hợp.
Bàn giao threat model/runbook/scopes, files, migrations/rollback, provider sandbox
test results, exact test commands/results, compatibility, observability không
chứa data/token và unresolved provider limits.
```

## 14. Mục 20 — Trung tâm quản lý làm rõ

### 14.1. Kiến trúc chung với mục 21

Xây một `ProcurementCase` deep module. `CLARIFICATION` và `PETITION` là hai case policies, không phải hai bảng/service/UI lịch sử độc lập. Shared core sở hữu:

- case identity/target/party/deadline/responsibility;
- optimistic row version và server-authoritative state machine;
- immutable response **content** revisions, với review/approval/issue là case events tham chiếu exact revision;
- attachment storage relation;
- legal basis relation;
- transactional activity/audit/notification;
- source observation/import reconciliation;
- list/detail projection và deadline/calendar projection.

Case policy sở hữu required fields, allowed transitions, SLA/legal rules và labels riêng. UI shell, repository, attachment, response, history và command bus dùng chung.

### 14.2. Quyền và version ownership phải chốt trước

Hai thay đổi dễ bị làm sai:

1. `assignee/responsible person` là dữ liệu trách nhiệm hay cấp thêm quyền đọc/sửa;
2. case thuộc exact package version, package lineage hay được clone sang version mới.

Contract bảo toàn khuyến nghị để thảo luận là: case read/write đi qua parent record authorization hiện hữu; responsibility không tự cấp access; party/nhà thầu không tự trở thành user được truy cập. Tuy nhiên đây vẫn phải được chủ sản phẩm chốt cho domain mới. Không tự thêm target `lamro/kiennghi` vào `phan_cong_nhan_su`, module permission, role hoặc inheritance.

Legacy `goi_thau_lam_ro` đang được clone cùng aggregate version. Chuyển ownership mà không có DG-20-01 sẽ thay đổi history/version semantics. Không tự quyết.

### 14.3. Data model dự kiến

```text
procurement_case
  organization_id, id, case_code, case_type,
  subject/content summary, received/sent/due timestamps,
  state, workflow_policy_version, priority,
  current_response_revision_id, approved_response_revision_id,
  issued_response_revision_id, row_version,
  created/updated/closed actor+time, source provenance

procurement_case_package_target (typed parent relation)
  organization_id + case_id composite FK,
  organization_id + exact package version/lineage composite FK theo DG-20-01

procurement_case_party
  case_id, role, stable external/local party reference,
  snapshot fields required by approved contract

procurement_case_responsibility
  case_id, user/team reference, responsibility role, interval
  # không mang authorization semantics trừ khi ADR nói rõ

procurement_case_response_revision (immutable)
  case_id, revision_no, content/body/storage reference,
  source revision/provenance, content hash, created_by/at

procurement_case_event (append-only)
  case_id, from/to state, exact response_revision_id when applicable,
  command/idempotency/evidence, actor/time, audit reference

procurement_case_attachment
  case_id/response revision, storage key, filename/media/size/SHA-256,
  uploaded actor/time, lifecycle marker

procurement_case_legal_basis
  case/response revision, exact legal instrument/profile version,
  provision/citation; optional unstructured field only if approved

procurement_case_source_observation
  provider, upstream identity/revision/hash, raw/canonical provenance,
  reconciliation state; không phải official case state
```

Response content revision bất biến ngay khi lưu; mỗi lần `SaveResponseDraft` tạo revision mới và advance current pointer bằng CAS. Submit/review/approve/issue không mutate revision state/timestamps mà ghi case transition event tham chiếu exact revision và cập nhật approved/issued pointer. Nếu nội dung đổi sau review/approve, phải tạo revision mới và quay/đổi state đúng policy; không mang approval cũ sang content mới.

Initial case platform chỉ hỗ trợ parent Gói thầu vì đó là seam có bằng chứng hiện tại. Dùng typed target relation với `organization_id` và composite FK; không dùng `target_type,target_id` polymorphic không enforce tenant. Nếu product duyệt target Kế hoạch/Hợp đồng khác, thêm typed target table/policy/migration riêng và invariant “exactly one target”.

History dùng `ActivityEvent`/tamper-evident audit hiện có trong cùng transaction, không tạo một JSON history rời thiếu integrity. Nếu cần domain outbox cho notification, ghi cùng transaction và xử lý idempotent.

Không thêm các bảng official workflow vào generic sync table registry; nếu client có thể update `state` trực tiếp qua sync thì state machine bị bypass.

### 14.4. State machine và commands

Policy đề xuất để product xác nhận cho clarification:

```text
DRAFT/RECEIVED → ASSIGNED → DRAFTING_RESPONSE → IN_REVIEW
→ APPROVED → ISSUED → CLOSED
```

Reject/return/reopen/cancel/withdraw, pause SLA và multi-level approval không được tự thêm. Mỗi transition có exact prerequisites, allowed source states, immutable evidence và command authorization.

Command surface:

```text
CreateCase
AssignResponsibility
SetDueDate
Add/RemoveAttachment (chỉ khi lifecycle cho phép)
SaveResponseDraft
SubmitResponseForReview
Review/ReturnResponse
ApproveResponse
IssueResponse
CloseCase
```

Mỗi command phải strict, idempotent, load parent, re-authorize, lock/CAS case, validate state/prerequisites, write response/case + activity/audit + notification atomically. Không có route `setState` generic. Official issued response/revision không bị update; chỉnh sửa tạo revision/withdrawal flow theo policy.

### 14.5. Deadline, attachment và read model

- Deadline calculator dùng versioned case policy + legal binding; nếu SLA chưa duyệt, user-entered due date được ghi provenance và không tự gắn “quá hạn pháp lý”.
- Publish canonical `CaseDeadline` cho WorkCalendar/notification; không tự viết `.ics` riêng.
- Reuse filename sanitization, media/size validation, SHA-256 và private scoped storage từ package documents, nhưng dùng relation case riêng; không nhét case file vào document-slot CHECK hiện hành.
- List/filter by type/state/due/responsibility chạy qua visible parent query; không load rồi lọc phía client.
- Authorized reader nhận đầy đủ case/party/attachment metadata theo contract; responsibility/Word entitlement không che field.

### 14.6. Legacy clarification migration

Current request/response là hai list độc lập, không có foreign key để pair. Kế hoạch expand:

1. Giữ schema/form/Word context/timeline legacy hoạt động.
2. Tạo adapter hiển thị legacy entry trong center với badge `LEGACY_UNLINKED`, read-only hoặc action chuyển đổi theo contract.
3. Không pair theo index/time/content. Nếu product chọn migration, tạo one-case-per-request và queue manual linking của response, hoặc import thủ công có preview.
4. Lưu source legacy ID/version/provenance; retry không duplicate.
5. Chỉ chuyển write UI sau parity và reconciliation; không xóa legacy rows.
6. Cách case tương tác với package version creation tuân DG-20-01 và có aggregate regression tests.

### 14.7. API/UI

- `GET /api/procurement-cases` dùng filters bounded/cursor; `GET /:id` authorized qua parent.
- Command endpoints theo action, expected rowVersion + idempotency key; attachment upload/download riêng, reauthorize khi download.
- Center views: queue, due status, case detail, party, response revision timeline, attachments, legal bases, activity.
- UI render available actions từ server policy result; không hard-code “role X được approve”.
- Offline có thể soạn draft chỉ nếu contract được duyệt; official submit/approve/issue luôn online/re-authorize. Không dùng outbox generic để force transition.

### 14.8. Rollout/rollback

- Feature flag shared core → clarification center shadow read → new case creation → legacy write switch sau parity.
- Seed no business state. Legacy stays readable during rollback.
- Backfill/reconciliation report counts unlinked requests/responses, ambiguous, imported and manually confirmed.
- Kill switch dừng new official commands nhưng không xóa case/history. Worker notification/calendar respects flag without losing outbox evidence.

### 14.9. Test và nghiệm thu

- Transition matrix và prerequisites; illegal/stale transition deterministic; no generic sync bypass.
- Idempotent command/notification/audit; concurrent response drafts/approve/issue.
- Tenant/parent module/assignment/record authorization, revoked after list, no cross-tenant link.
- Responsibility không tự cấp record access; party không có workspace access.
- Full authorized data, no masking/new capability/Word entitlement coupling.
- Response content revisions immutable; review/approve/issue events pin exact revision, và content mới không kế thừa approval cũ.
- Attachment traversal/media/size/hash/private download/rollback.
- Deadline policy version/boundary; user-entered due date không bị gọi legal overdue nếu thiếu rules.
- Legacy no-loss/no-heuristic pairing, package-version behavior đúng ADR.
- Fresh/upgrade/PostgreSQL schema contract, query bounds/N+1, UI accessibility.

### 14.10. Prompt 20A — Shared ProcurementCase foundation

```text
Triển khai increment 20A: nền tảng ProcurementCase dùng chung cho Làm rõ và
Kiến nghị. Chưa triển khai PETITION policy hoặc auto-import trong increment này.

Đọc AGENTS.md, CONTEXT.md, mục 20/21 tài liệu đề xuất, legacy goi_thau_lam_ro
schema/mapper/projection/UI, aggregate version policy, access_policy, activity/
audit/notification, package document storage, timeline và evidence ledger.
Chạy git status --short; bảo toàn mọi thay đổi không liên quan.

Gate bắt buộc: parent/version ownership; clone behavior; case read/write mapping;
responsibility-vs-access; workflow graph/prerequisites; approval/issue authority;
SLA/pause/escalation; attachment retention; response revision; offline behavior.
Nếu gate về permission/assignment/version/workflow chưa có ADR được product duyệt,
dừng production schema/routes tương ứng và bàn giao domain/ADR + blocker report;
không tự thêm module/role/capability/assignment target/default allow-deny.

1. Tạo ProcurementCase deep module với case header/type/rowVersion và typed
   package target relation có organization composite FKs,
   party, responsibility metadata, immutable response content revisions, case attachment,
   exact legal basis link và source observation.
2. Dùng shared repository/service/CaseWorkflow policy/queries; CLARIFICATION và
   future PETITION chỉ cung cấp policy, required fields và labels.
3. Case authorization luôn dựa parent record bằng tenant/module/assignment/
   record scope đã duyệt. Responsibility không cấp access nếu ADR không nói rõ;
   party không phải workspace principal.
4. Không đăng ký case official tables vào generic sync. Mọi write qua strict,
   idempotent command, expected rowVersion, server transition validation.
5. Save draft tạo content revision mới; review/approve/issue ghi transition event
   tham chiếu exact revision, không mutate revision hoặc reuse approval sau edit.
6. Transactionally persist business write + ActivityEvent/tamper-evident audit +
   notification/outbox. Không có arbitrary setState endpoint.
7. Reuse private attachment validation/hash/storage primitives nhưng relation/
   lifecycle riêng; không đổi package document slot semantics.
8. Publish canonical case deadline projection cho timeline/calendar; không copy
   .ics/export. Nếu SLA legal chưa duyệt, giữ explicit due date/provenance và
   không kết luận quá hạn pháp lý.
9. Add append-only migration/index/FK/constraints, including tenant-safe typed
   target relation (không unguarded target_type/id), fresh+upgrade schema contract,
   feature flag và rollback không xóa history.

Tests: policy transition table; stale/illegal/idempotent commands; fresh auth/
revocation/cross-tenant; responsibility-no-access; full authorized data;
response immutability/races; attachment security/rollback; audit/notification
atomicity/no duplicate; deadline provenance; generic-sync bypass rejection;
query bounds; migrations and UI shell accessibility.

Bàn giao ADR/ERD/state matrix, API/command schema, migration/runbook, files/tests/
results, compatibility và gates chưa chốt.
Chạy targeted backend/JS/E2E tests, git diff --check,
python scripts/check_mojibake.py và quality gate authoritative trong package/CI;
báo exact commands/results và test chưa chạy + lý do.
```

### 14.11. Prompt 20B — Clarification policy, legacy adapter và UI

```text
Triển khai increment 20B sau khi ProcurementCase 20A và CLARIFICATION policy đã
được product nghiệm thu. Xem đây là task độc lập về diff/review nhưng có
prerequisite chức năng là 20A.

Đọc AGENTS.md, CONTEXT.md, mục 20/21 trong tài liệu đề xuất, evidence ledger,
approved case ADR/state/SLA/version-ownership contracts và implementation/tests
20A. Chạy git status --short; bảo toàn dirty diff ngoài 20B. Không đổi role,
module/assignment/record scope, capability, entitlement, masking/field visibility;
responsibility không tự cấp access và authorized readers vẫn thấy full data.
Nếu policy/legacy migration/package-version behavior chưa được product duyệt,
dừng phần đó và báo blocker; không tự chọn semantics hay sửa expected tests.

1. Thêm exact CLARIFICATION required fields/state/SLA policy đã duyệt và commands:
   create/receive, assign responsibility, due date, attachment, response draft,
   submit review, review/return, approve, issue, close. Không thêm transition khác.
2. API list/detail/commands phải reauthorize package cha; UI action availability
   lấy từ server policy, không suy từ role phía client.
3. Xây case center/detail/revision/attachment/legal-basis/activity/deadline UI
   với loading/empty/error/stale/denied/keyboard/focus states.
4. Legacy adapter giữ goi_thau_lam_ro/form/Word/timeline hiện có. Hiển thị legacy
   đầy đủ với provenance; không pair request-response theo index/time/content.
5. Chỉ migrate theo approved strategy: manual preview/link hoặc deterministic
   evidence. Ghi legacy source ID/version, idempotent; không xóa rows cũ.
6. Package new-version clone/share/exact binding chỉ theo DG-20-01; thêm aggregate
   snapshot/history regression tests.
7. External NOTICE_CLARIFICATION chỉ tạo source observation/preview sau khi có
   redacted real fixture + schema contract; không ghi raw sidecar thành official case.
8. Feature flag shadow/parity → create new → switch write; rollback giữ case và
   legacy readable.

Acceptance: full transition/authorization/idempotency; content revisions immutable
và review/approve/issue pin exact revision; content mới không reuse approval;
no assignment/access drift; attachment/audit/notification/deadline; legacy no-loss,
no guessed pairing, version behavior; import retry/provenance if implemented;
bounded list/query and accessible UI. Chạy targeted backend/JS/E2E tests,
git diff --check, mojibake và quality gate phù hợp. Bàn giao files/migration impact,
reconciliation counts, exact test commands/results, compatibility/rollback/flag,
screenshots nếu workflow yêu cầu và remaining legacy/manual queue.
```

## 15. Mục 21 — Trung tâm quản lý kiến nghị

### 15.1. Phạm vi

Mục 21 là `PETITION` policy/adapter trên `ProcurementCase` đã nghiệm thu. Không tạo lại repository, case tables, response revisions, attachments, history, audit, deadline, notification hoặc UI shell.

Workflow proposal `Tiếp nhận → Phân công → Kiểm tra → Dự thảo → Phê duyệt → Phát hành → Đóng` mới là đầu vào. Product phải chốt reject/return/withdraw/reopen, SLA theo loại kiến nghị/legal regime, authority và evidence của approval/issue. Mục 22 approval nhiều cấp ngoài phạm vi; nếu chưa có, không giả lập bằng role check phía UI.

### 15.2. Petition policy và legal basis

- Stable `caseType = PETITION`, petition category/taxonomy và required fields theo contract.
- State machine/version riêng nhưng dùng shared engine.
- Deadline calculator dùng exact policy/legal binding; không hard-code một SLA chung với clarification.
- Legal basis tham chiếu exact instrument/profile version của mục 8. Free-text fallback chỉ khi được duyệt và phải được đánh dấu unverified, không cho AI xem như binding xác định.
- Response content revisions luôn immutable; review/approve/issue events pin exact revision. Correction/withdrawal là command mới nếu policy cho phép.
- Responsibility vẫn không tự cấp record access; case read/write theo parent policy đã duyệt.

### 15.3. Mua sắm công source adapter

Repo mới có raw/canonical sidecar `NOTICE_PETITION`, chưa có operational entity hay đủ fixture để biết schema nghiệp vụ. Luồng an toàn:

1. Thu response fixture thật đã xử lý theo policy test-data; ghi upstream operation/revision/source hash.
2. Xây strict canonical adapter và contract tests; unknown fields được bảo toàn trong raw provenance nhưng không tự map thành business state.
3. Tạo `source observation`, không tự tạo official petition.
4. Preview/link/create command authorize parent và hiển thị deterministic mapped fields/conflicts.
5. Apply chấp nhận opaque preview ID, re-fetch/re-authorize/revalidate/idempotency; external revision không overwrite local response/state.
6. Dedupe theo stable upstream identity + revision, không theo tên/ngày gần giống.

### 15.4. Test/nghiệm thu

- Shared core thực sự dùng chung: no duplicate petition tables/services for response/file/history.
- Petition transition matrix khác clarification đúng policy; illegal/stale transition fail.
- Legal binding/version/citation exact; missing binding không sinh legal conclusion.
- Parent authorization, responsibility-no-access, tenant isolation, full authorized fields.
- Import schema fixture/provenance/dedupe/idempotency, no raw-to-official write, no local overwrite.
- Response immutable/audit/notification/deadline/calendar projection.
- UI filters/type-specific fields/accessibility và no hard-coded permission.

### 15.5. Prompt thực thi mục 21

```text
Triển khai mục 21 “Trung tâm quản lý kiến nghị” như PETITION policy trên shared
ProcurementCase đã nghiệm thu ở mục 20. Nếu shared core chưa tồn tại hoặc chưa
pass authorization/state/audit tests, dừng và báo prerequisite blocker; không
xây hệ thống kiến nghị song song.

Đọc AGENTS.md, CONTEXT.md, mục 20/21, approved case ADR/state matrix,
LegalBinding mục 8, NOTICE_PETITION collector/raw/canonical code, procurement
import preview/apply pattern và evidence ledger. Chạy git status --short và bảo
toàn mọi dirty diff ngoài mục 21. Không đổi role/module/assignment/record scope,
capability, entitlement, masking/redaction hoặc field visibility; authorized
readers tiếp tục nhận full business data và Word entitlement chỉ gate Word action.

Gate phải chốt: petition taxonomy/required fields; exact state graph including
return/reject/withdraw/reopen; SLA by legal profile/type; approval/issue authority;
legal-basis requirements; parent/version ownership; source import policy.
Không tự tạo role/module/capability/assignment inheritance hoặc approval levels.

1. Add PETITION policy/validators/labels vào shared CaseWorkflow, không thêm
   duplicate repository/tables/attachment/response/history/audit/notification.
2. Commands cho exact approved receive/assign/check/draft/review/approve/issue/
   close transitions; strict/idempotent/CAS/fresh parent authorization.
3. Link legal basis tới exact legal instrument/profile version. Nếu binding/rule
   thiếu, hiện NEEDS_REVIEW; không chọn latest, không kết luận vi phạm.
4. Reuse case deadline → WorkCalendar/notification projection; không hard-code
   clarification SLA cho petition.
5. UI reuse case shell, chỉ add petition-specific fields/filter/state labels;
   actions do server trả, responsibility không tự cấp access.
6. NOTICE_PETITION: chỉ implement sau redacted real fixture + strict schema tests.
   Persist source observation/provenance/hash; preview/link/create dùng opaque
   authority, reauthorize/revalidate; retry dedupe; không overwrite local case.
7. Keep feature flag/rollback; no change to legacy clarification semantics.

Tests: shared-core reuse guard; petition transition matrix/races/idempotency;
parent auth/revocation/cross-tenant/responsibility-no-access/full data;
exact legal citation/missing-binding; response immutability; deadline/audit/
notification; source fixture/dedupe/no-overwrite/preview stale; UI accessibility.

Bàn giao policy/state/SLA versions, API/UI, import mapping/provenance, migrations
nếu cần, tests/results, compatibility và decisions còn blocked.
Chạy targeted backend/JS/E2E tests, git diff --check,
python scripts/check_mojibake.py và quality gate authoritative trong package/CI;
báo exact commands/results, test chưa chạy + lý do, files/diff scope và rollback.
```

## 16. Mục 30 — Trung tâm thao tác hàng loạt

### 16.1. Nguyên tắc kiến trúc

`BulkOperation` là orchestrator prepare/confirm/execute cho **allowlisted domain commands**. Nó không phải wrapper cho generic sync và không được nhận arbitrary table/patch/status từ client.

Chuỗi bắt buộc:

```text
Resolve selection phía server
→ authorize từng record
→ validate eligibility + impact + dependencies
→ persist opaque preview authority có TTL/digest
→ user xem và xác nhận
→ lock/reload/re-authorize/revalidate
→ execute domain command
→ transactional audit + per-item/summary result
```

Bulk không phải permission. Actor chỉ thực hiện được action mà cùng actor được phép làm với từng record qua exact canonical policy/domain command. Phải bảo toàn các nhánh `organization_manager`/`personal_owner` hiện hữu khi policy có chúng, nhưng không thêm creator/manager shortcut mới cho bulk. Không force lifecycle, không tạo sensitive-read capability và không dùng Word entitlement để lọc record data.

### 16.2. Action registry

Mỗi adapter khai báo bất biến, không để client chọn:

```text
actionKey + contractVersion
supported target types
strict input schema
selection modes
max prepare/execute size
authorization mode + exact canonical policy/domain command seam
eligibility/impact provider
dependency versions captured in preview
execution semantics: DB_ALL_OR_NOTHING | ITEMIZED_PARTIAL | STAGED_FINALIZE
side-effect boundary: DB_ONLY | FILESYSTEM | EXTERNAL_PROVIDER
sync/async threshold
retry/cancel behavior
audit/result projection
```

Action matrix phải được product duyệt. Candidate adapters:

- assign/reassign: hiện chưa có standalone assignment command/service; phải characterize generic-sync assignment semantics rồi trích một `AssignmentCommand` dùng chung (canonical authorization, delta, CAS, activity/notification/audit) trước khi chọn làm pilot;
- export data: gọi governed exporter, snapshot-consistent, full authorized fields theo approved export schema;
- archive: gọi lifecycle/soft-delete/archive policy hiện hành;
- workflow: chỉ gọi exact server transition command nếu domain đó đã có; nếu chưa có phải trích/characterize command seam trước, không update status trực tiếp;
- multi-Word: chỉ sau mục 15/14, re-check Word action entitlement, pin exact template/source/legal versions và chạy document jobs.

Case responsibility chỉ được thêm nếu case permission/assignment semantics đã chốt; không mở rộng `phan_cong_nhan_su` ngầm.

### 16.3. Data model

```text
bulk_operation
  organization_id, id, actor_id, action_key/contract_version,
  selection_mode/filter_version, input_hash/selection_hash,
  preview status/created/expires, confirmation binding,
  execution status/semantics/side-effect boundary, counts,
  semantic request hash + unique idempotency key/stored response,
  lease owner/until + attempt number,
  created/confirmed/started/completed/cancelled timestamps

bulk_operation_item
  operation_id, target_type/id,
  expected_row_version + dependency fingerprint,
  prepare eligibility/reason code/impact summary,
  execution status/result/error code, attempts/timestamps

bulk_operation_event/outbox (nếu async)
  append-only status/delivery evidence; audit chain reference
```

Composite tenant constraints, bounded payload/indexes và cleanup policy bắt buộc. Không persist full sensitive record snapshots chỉ để preview; giữ IDs, versions, digests, normalized input/impact metadata theo audit contract. UI detail được reload qua authorized projection.

Operation table là control plane nhưng success authority phải commit cùng business effect. Confirm/worker lấy lease bằng short CAS transaction. Với `DB_ALL_OR_NOTHING`, một bounded business transaction phải gồm reauthorization, all writes, business audit, operation `COMPLETED` và stored idempotent response. Nếu transaction rollback, catch path dùng **separate bounded control transaction** có attempt/lease CAS để ghi `FAILED` hoặc đưa về `PREVIEW_READY` theo retry contract; không ghi failure trong transaction vừa rollback. Nếu process crash, lease expiry recovery phân biệt: committed success đã có `COMPLETED`, còn uncommitted attempt không có business effect và được recover deterministically. Không để operation kẹt `PROCESSING` hoặc retry mù gây duplicate.

### 16.4. Prepare authority

- `actionKey` resolve qua static registry; unknown/version mismatch reject.
- Selection `EXPLICIT_IDS` là lát đầu an toàn hơn. `ALL_MATCHING_FILTER` chỉ thêm sau DG-30-02 với canonical filter schema/version, exclusions và stable snapshot semantics.
- Server resolve candidates bằng action-specific canonical query; không tin total, labels, rowVersions hoặc canonical record payload từ client.
- Registry khai báo authorization mode. Read/export preview dùng canonical read `VisibilityScope`; mutations dùng exact domain/write authorization; multi-Word dùng record read + existing Word action entitlement. `build_batch_write_authorization_context()` chỉ là optimization cho write actions có **cùng** sync-write semantics, không phải universal auth cho read/export hoặc mọi command. Mọi batch optimization phải có parity tests với single-record policy và vẫn authorize từng item.
- Adapter validate lifecycle/entitlement/dependency và trả stable reason codes.
- Persist exact eligible set, expected rowVersions, action input hash, relevant template/legal/policy/assignment revisions, actor/tenant và expiry.
- Preview trả detail chỉ cho authorized items; denied items không lộ title/date/data. Không mutate business state.

Opaque preview ID không phải quyền vĩnh viễn. Confirmation chỉ hợp lệ cho same tenant/actor/action/input/selection trong TTL và phải có CSRF/session/idempotency theo chuẩn repo.

### 16.5. Confirm/execute

1. Lock operation; reject wrong actor/tenant/status/expiry/replay mismatch.
2. Reload every target/dependency, reauthorize and compare rowVersion/fingerprint.
3. Nếu drift, mark preview stale và yêu cầu prepare lại; không best-effort im lặng trừ exact action contract đã duyệt.
4. Execute qua adapter/domain service. Official validations/transitions vẫn là authority.
5. `DB_ALL_OR_NOTHING` chỉ áp dụng cho bounded DB-only action thực thi trong **một** transaction; một item fail thì rollback business writes/audit. Không gọi async chunks/files/provider side effects là globally atomic.
6. `ITEMIZED_PARTIAL` chỉ dùng khi action contract cho phép; mỗi item có idempotent state/result, không gọi operation “thành công” nếu còn failed.
7. `STAGED_FINALIZE` dùng cho generated files: stage artifacts, verify complete manifest rồi mới publish/download bundle; crash cleanup/compensation/reconciliation rõ. Đây không phải rollback transaction xuyên DB/filesystem.
8. Async worker reauthorize trước mỗi chunk/item và download/result access; retry không nhân đôi item/audit/notification/artifact. Async mutation chunks phải `ITEMIZED_PARTIAL` hoặc một staged protocol được duyệt, không `DB_ALL_OR_NOTHING` toàn operation.
9. Cancel chỉ ngăn queued/unstarted work; không gọi là undo và không hoàn tác committed items.
10. Với DB-only success, business writes + audit + operation completion + idempotent stored response commit cùng transaction. Rollback/failure được ghi bằng control-plane transaction riêng có attempt/lease CAS; lease expiry recovery xử lý crash trước/sau commit xác định.

### 16.6. UI

- Accessible checkboxes, current-page selection; all-filtered/exclusions chỉ hiện khi approved.
- Bulk action bar chỉ hiện action server registry/policy cho phép, nhưng server vẫn re-check.
- Preview exact included/eligible/ineligible/impact/reason, action input, execution semantics và side-effect boundary; explicit confirmation.
- Progress/results/cancel/retry/download report; partial status rõ nếu contract cho phép.
- Reset selection khi workspace/module/filter/query version đổi; không giữ IDs ngầm giữa tenant.
- Denied records không lộ metadata. Authorized records không bị mask thêm trong preview/export.

### 16.7. Multi-Word đặc thù

Không bắt đầu trước khi item 15 có published immutable template version và document job/provenance contract:

- prepare pin exact `template_version_id`, target record/version/rowVersion, legal profile/rule context và filename policy;
- re-check record read + Word create action entitlement tại execute; re-check download access/entitlement theo existing contract;
- mỗi artifact có manifest/checksum/provenance; ZIP naming/collision/size/retention có limits;
- dùng `STAGED_FINALIZE` hoặc approved itemized semantics: chỉ expose ZIP sau complete manifest/checksum, cleanup/reconcile staged failures; không gọi đây là atomic DB+filesystem và không trả ZIP thiếu file như complete.

Word entitlement không che dữ liệu trong preview record hoặc API read; nó chỉ có thể làm action đó ineligible.

### 16.8. Migration/rollout/rollback

- Append operation/item/outbox tables; cleanup/retention job và runbook.
- Framework sau feature flag, một pilot action đã được phê duyệt, explicit IDs, bounded small limit.
- Observe prepare/execute latency, stale rate, denied/ineligible counts và worker retries bằng metadata không chứa raw record.
- Mở từng action/target riêng; registry kill switch.
- Rollback dừng prepare/execute mới; in-flight behavior theo runbook, giữ operation/audit/result. Không delete/undo business mutations đã commit.

### 16.9. Test và nghiệm thu

- Unknown action/input/selection rejected; client cannot send arbitrary patch/status.
- IDs ngoài visibility không vào detail; cross-tenant/actor preview inaccessible.
- Permission/assignment/lifecycle/rowVersion/template/legal drift sau preview làm confirm stale/denied.
- Exact same idempotency retry không execute/audit/notify/artifact hai lần.
- Crash trước/trong/sau business commit không để operation kẹt hoặc duplicate: success/outcome atomic; rollback failure recorded separately; expired lease recovery deterministic.
- DB-only bounded all-or-nothing rollback; itemized partial hoặc staged-finalize đúng approved action; không hứa global rollback cho async/filesystem/provider effects.
- Existing assignment/lifecycle/export/Word semantics giữ nguyên; invalid transition không force.
- Batch auth query bound/N+1, max size/TTL/cleanup, worker lease/race/cancel.
- Full authorized export/preview data không masking mới; Word entitlement action-only.
- UI selection reset, all-filtered exclusions, keyboard/focus/stale/partial states.
- Fresh/upgrade/PostgreSQL schema contract và kill-switch recovery.

### 16.10. Prompt 30A — Framework + một pilot được duyệt

```text
Triển khai increment 30A “BulkOperation prepare→confirm→execute”.

Placeholder phải được thay bằng ADR/product values:
APPROVED_PILOT_ACTION = <exact existing domain action>
APPROVED_TARGET_TYPES = <...>
APPROVED_SELECTION_MODE = <EXPLICIT_IDS | approved filter contract>
APPROVED_MAX_SIZE = <...>
APPROVED_EXECUTION = <DB_ALL_OR_NOTHING | ITEMIZED_PARTIAL | STAGED_FINALIZE>
APPROVED_SIDE_EFFECT_BOUNDARY = <DB_ONLY | FILESYSTEM | EXTERNAL_PROVIDER>
APPROVED_PREVIEW_TTL = <...>
APPROVED_RETRY_CANCEL = <...>
APPROVED_AUDIT_GRANULARITY = <...>

Đọc AGENTS.md, CONTEXT.md, mục 30, sync request/service/idempotency,
batch access_policy/record_validator, deletion service, procurement import
preview/apply, lifecycle policy, document jobs và evidence ledger. Chạy
git status --short; giữ mọi diff không liên quan.

Nếu placeholder/action contract chưa được duyệt:
- chỉ xây ADR/domain/interface và pure tests hoặc test-only fake adapter;
- không expose production action/route/UI, không tự chọn assignment/archive/export;
- không thêm role/module/capability/entitlement/default permission.

Khi gate đủ:
1. Tạo BulkOperation deep module và static versioned BulkAction registry. Client
   không được gửi table/field/status/arbitrary patch.
2. Append migration cho operation/items/outbox nếu async, composite tenant keys,
   constraints/indexes/TTL/cleanup, semantic hash/idempotency stored response,
   lease/attempt recovery; không lưu full record snapshots.
3. Prepare: verify session/org; resolve action; server-resolve selection bằng
   action-specific canonical policy. Read/export dùng VisibilityScope; mutation
   dùng exact domain/write auth; Word dùng record read + Word action entitlement.
   Sync batch-write context chỉ dùng khi action có exact same write semantics và
   parity tests. Authorize each; load rowVersion/dependency fingerprints;
   validate/impact; persist actor-bound preview; no mutation/no denied detail.
4. Confirm: lock/check actor/org/status/TTL/input/selection; reload, reauthorize,
   revalidate versions/state/dependencies. Drift yêu cầu preview mới.
5. Execute pilot qua exact characterized domain command/service, không direct
   status UPDATE/generic sync bypass. Nếu command seam chưa tồn tại (đặc biệt
   assignment/workflow), trích seam với parity tests trước khi pilot.
6. DB_ALL_OR_NOTHING chỉ cho bounded DB-only single transaction. Async/filesystem
   dùng approved ITEMIZED_PARTIAL hoặc STAGED_FINALIZE với durable outbox,
   compensation/reconciliation; không hứa rollback toàn cục. Worker lease/retry/
   backoff, fresh auth, no duplicate effect; cancel only queued/unstarted work.
7. Với DB_ALL_OR_NOTHING, business writes + audit + operation COMPLETED + stored
   idempotent response commit cùng transaction. Nếu rollback, ghi FAILED hoặc
   PREVIEW_READY trong separate bounded control tx với attempt/lease CAS. Lease
   expiry recovery phân biệt committed success và uncommitted attempt; không để
   PROCESSING kẹt hoặc retry duplicate.
8. UI selection/action bar/preview/confirm/progress/result accessible; reset on
   workspace/filter change. Server remains authority.
9. Không masking/redaction/capability mới. Authorized data remains full; Word
   entitlement only gates Word action if pilot is Word.
10. Feature flag/action kill switch and rollback runbook preserving audit/results.

Tests: strict registry/input; selection/auth/no-leak/cross-tenant/actor;
permission+rowVersion+dependency drift; idempotency; DB-only atomic rollback/
itemized partial/staged-finalize boundaries; domain
invalid transition; N+1/limits/TTL/cleanup; worker race/cancel;
crash before/during/after commit, lease recovery/stuck processing; audit/
notification once; full-data contract; UI selection/stale/accessibility;
fresh/upgrade/schema contract.

Bàn giao exact approved action contract, ERD/API, migration/rollback/runbook,
files/tests/results, performance bounds and actions intentionally unsupported.
Chạy targeted backend/JS/E2E tests, git diff --check,
python scripts/check_mojibake.py và quality gate authoritative trong package/CI;
báo exact commands/results, test chưa chạy + lý do, diff scope và compatibility.
```

### 16.11. Prompt 30B — Thêm từng action adapter

```text
Mở rộng BulkOperation bằng MỘT action adapter đã được product duyệt. Không thêm
nhiều action trong cùng change nếu không thể review/test atomicity độc lập.

ACTION_KEY/CONTRACT_VERSION = <...>
TARGET_TYPES/INPUT_SCHEMA = <...>
SELECTION/LIMIT/EXECUTION/SIDE_EFFECT_BOUNDARY = <...>
DOMAIN_COMMAND_SEAM = <existing service/command>
DEPENDENCY_FINGERPRINTS = <rowVersion/template/legal/policy/...>
ENTITLEMENT/AUTHORIZATION = <approved existing semantics>
RETRY/CANCEL/RESULT = <...>

Đọc AGENTS.md, CONTEXT.md, mục 30 trong tài liệu đề xuất, evidence ledger,
BulkOperation framework/ADR và existing single-record policy/command/tests.
Chạy git status --short; bảo toàn dirty diff ngoài action adapter. Không đổi
role/module/assignment/record scope, capability, entitlement, masking hay field
visibility; giữ canonical manager/personal-owner branches nhưng không thêm bulk
shortcut. Nếu placeholder/command seam chưa được duyệt hoặc chưa tồn tại, dừng
production adapter, characterization/extract seam trước và báo blocker.

1. Implement only prepare/execute adapter; không copy validator/write logic vào
   BulkOperation và không direct update status/assignment.
2. Khai báo action-specific auth: canonical read visibility cho read/export,
   exact domain/write auth cho mutation, record read + Word action entitlement
   cho Word. Không dùng sync batch-write context như universal policy.
3. Prepare reason/impact codes ổn định; capture all relevant dependencies.
4. Execute reauthorize/revalidate và call domain seam; DB_ALL_OR_NOTHING chỉ cho
   bounded DB-only one transaction. Async/filesystem dùng ITEMIZED_PARTIAL hoặc
   STAGED_FINALIZE với outbox/compensation/reconciliation.
5. Add adapter-specific UI copy/confirmation/result, not permission logic.
6. Add contract/integration/race/auth/performance/audit tests plus full framework
   regressions. Preserve full authorized data and current role/scope semantics.

Nếu action là multi-Word: prerequisite item 15 immutable published version và
artifact provenance; pin exact versions, re-check record + Word action entitlement,
ZIP manifest/checksum/naming/retention, no silent incomplete success.
Nếu assignment: repo hiện không có standalone assignment command; characterize
generic-sync auth/delta/CAS/activity/notification/audit, extract shared
AssignmentCommand + parity tests trước; preserve add/replace/remove/multi-assignee,
do not add case target or grant access.
Nếu workflow/archive: chỉ call canonical lifecycle command nếu tồn tại; nếu chưa,
extract/characterize trước; no force transition.
Nếu data export: use approved export field contract without masking record API.

Chạy targeted tests, git diff --check, mojibake và quality gate phù hợp. Bàn giao
adapter/auth/execution contract, files/migration impact/tests/results,
compatibility/rollback, rollout metric, kill switch và known unsupported targets.
```

## 17. Mức sẵn sàng để bắt đầu

| Mục | Có thể bắt đầu ngay | Chưa được làm trước khi chốt |
|---|---|---|
| 6 | Characterization, pure diff, per-version auth, timeline/assignment providers | Exact Word/legal impact khi provenance/binding chưa có |
| 7 | Characterization/ADR/prototype pure merge sau flag | Retain qua F5, base storage, production center/replay |
| 8 | Inventory/source-link/domain model/ADR | Applicability/binding production và backfill khi DG-08 chưa chốt |
| 12 | Eval design/context interface review | Compliance data tool nếu mục 8/9/11 chưa deterministic |
| 15 | Inventory/characterization/ADR | Lifecycle/mapping/preview action semantics chưa chốt |
| 19 | RFC serializer/projector tests cho facts đã xác định | Outbound profile production; mọi connector/auto-push trước DG-19 |
| 20 | Legacy inventory/domain/ADR | Case permission/version ownership/workflow production trước DG-20 |
| 21 | Petition fixtures/domain policy draft | Parallel case system, official import/workflow trước shared core/DG-21 |
| 30 | Existing command inventory/ADR/test-only registry | Production pilot nếu action/auth/command/execution/selection chưa duyệt |

## 18. Definition of Ready cho từng increment

Một increment chỉ được chuyển từ planning sang implementation khi có đủ:

- owner và phạm vi rõ, các DG liên quan có câu trả lời/link ADR;
- API/state/action contract và compatibility impact được review;
- không có thay đổi permission/visibility ngầm; nếu có, business contract + migration + seam regressions đã duyệt;
- test fixtures cho temporal/workflow/identity/provider edge cases;
- migration number/runbook/rollback owner nếu có schema;
- feature flag, rollout cohort, metric và kill-switch behavior;
- dependency upstream ở trạng thái nghiệm thu, không chỉ có interface mock;
- working-tree scope và danh sách file dự kiến để không đè thay đổi song song.

## 19. Definition of Done chung

- Deep module có interface nhỏ; route/UI/provider chỉ adapter; không có duplicate business validator.
- Tenant/session/module/assignment/record authorization được test ở read và write boundary.
- Authorized record giữ đầy đủ business fields; không masking/redaction/capability/entitlement drift.
- Commands strict/idempotent/CAS/audited; historical immutable; error/no-leak contract ổn định.
- Migration fresh + previous-version upgrade + schema contract pass; rollback application được diễn tập hoặc mô tả kiểm chứng được.
- Unit/integration/JS/E2E theo rủi ro; race, stale, cross-tenant, revocation và N+1 có test.
- Accessibility/loading/empty/error/stale/offline states được kiểm tra.
- Feature flag/observability/runbook; logs/metrics không chứa token hoặc raw sensitive snapshot ngoài contract.
- ADR/`CONTEXT.md` chỉ cập nhật khi semantics thực sự đã được chủ sản phẩm phê duyệt; test expectation không tự định nghĩa business mới.
- Bàn giao liệt kê file, schema/migration, API, test commands/results, compatibility, rollout và blocker còn lại.

## 20. Cách dùng bộ prompt

1. Mỗi prompt là một task/PR độc lập; không ghép tất cả 9 mục vào một lần code.
2. Điền placeholder bằng link/nội dung ADR đã duyệt, không chỉ xóa dòng gate.
3. Yêu cầu agent trả inventory và blocker trước production edits nếu gate thiếu.
4. Review diff theo hai trục: đúng business contract và đúng spec increment.
5. Chạy prompt tiếp theo chỉ khi acceptance/prerequisite của prompt trước đã đạt.

Prompt điều phối review sau mỗi increment:

```text
Review increment này theo hai trục độc lập:

1. BUSINESS CONTRACT/STANDARDS
- Đọc AGENTS.md, CONTEXT.md và ADR được link trong increment.
- Tìm mọi thay đổi field visibility/masking/redaction, role/module/assignment/
  record scope, capability, entitlement, inheritance/default allow-deny.
- Xác minh authorized records vẫn trả đầy đủ business fields và Word entitlement
  chỉ gate Word action.
- Kiểm tra tenant/session/auth/audit/idempotency/CAS/migration/rollback seams.

2. SPEC/ACCEPTANCE
- Đối chiếu đúng mục và increment trong
  docs/05_KE_HOACH_VA_PROMPT_9_TINH_NANG_2026-08-23.md.
- Kiểm tra gate đã có evidence approval, interface/dependency đúng, không lấn sang
  mục ngoài phạm vi, test bao phủ race/revocation/no-leak/history/N+1/UI states.

Chỉ review, không tự sửa. Báo finding theo severity với file:dòng, evidence,
impact và fix nhỏ nhất. Phân biệt blocker do thiếu product decision với bug code;
không đề xuất masking/least-privilege semantics trái business contract.
```

## 21. Verification commands gợi ý

Chọn tập đúng với increment; không mặc định mọi tên test mới đã tồn tại trước khi implement:

```powershell
# Baseline và diff hygiene
git status --short
git diff --check
python scripts/check_mojibake.py

# Existing seams quan trọng
python -m pytest tests/test_read_scope_contract.py -q
python -m pytest tests/test_sync_record_version_metadata.py -q
python -m pytest tests/test_aggregate_version_snapshot.py -q
python -m pytest tests/test_sync_conflict_authorization.py -q
python -m pytest tests/test_word_template_config_concurrency.py -q
python -m pytest tests/test_word_publication_template_assignments.py -q
python -m pytest tests/test_timeline_rule_engine.py -q
python -m pytest tests/test_n_plus_one_regressions.py -q
python -m pytest tests/ai/test_ai_permission_context.py -q
python -m pytest tests/ai/test_ai_knowledge.py -q

# JS/E2E: chọn file liên quan và script authoritative trong package.json
node --test tests/js/package_detail_version_selector.test.mjs
node --test tests/js/sync_conflict_recovery.test.mjs
npm run check:quality
```

Secure/build/full-suite command phải lấy từ `package.json` và CI hiện hành. Nếu full suite quá dài, targeted suite vẫn phải chạy trong PR và full gate chạy trước merge/release.

## 22. Traceability yêu cầu → kế hoạch

| Yêu cầu proposal | Nơi xử lý |
|---|---|
| 6: added/removed/modified/unchanged và tác động | 8.3–8.9 |
| 7: server/mine/per-field merge trên latest rowVersion | 9.3–9.8; gate 9.1 |
| 8: exact legal versions, effective status, no retroactivity | 10.1–10.8 |
| 12: một assistant, server decides/AI explains | 11.1–11.7 |
| 15: history/draft/publish/restore/preview/usage/preflight | 12.3–12.11 |
| 19: `.ics`, Google, Outlook, consent | 13.1–13.10 |
| 20: case create/assign/SLA/files/draft/review/issue/close/history | 14.3–14.11 |
| 21: shared case workflow/legal/deadline/response history | 15.1–15.5 |
| 30: preview/auth/validate/confirm/execute/audit/no force | 16.1–16.11 |

## 23. Nguồn và bằng chứng

- Tài liệu yêu cầu: `docs/04_DE_XUAT_TINH_NANG_BIDDINGFLOW_HOP_NHAT_2026-08-22.md`.
- Business contract: `AGENTS.md`, `CONTEXT.md`.
- Evidence ledger có source `file:dòng`: `docs/research/2026-08-23-evidence-ledger-tinh-nang-06-07-08-12-15-19-20-21-30.md`.
- Word contracts: `docs/adr/0001-word-template-config-cas-and-audit.md`, `docs/adr/0005-explicit-word-publication-template-assignments.md`.
- Version metadata/read scope: `docs/adr/0007-procurement-operation-and-version-metadata-read-scope.md` tại working tree được khảo sát.
- Calendar standards/provider docs: [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545), [Google Calendar create events](https://developers.google.com/workspace/calendar/api/guides/create-events), [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Google Calendar incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), [Microsoft Graph create event](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0), [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), [Microsoft Graph event delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0).

## 24. Khuyến nghị quyết định tiếp theo

Ưu tiên một buổi product/architecture review để chốt `DG-07`, `DG-08`, `DG-15`, `DG-20/21`, `DG-30`; `DG-19-01` có thể chốt độc lập cho `.ics`. Trong khi chờ, increment có giá trị/rủi ro thấp nhất để bắt đầu là mục 6A: authorized read-only comparison + timeline/assignment impact, vì không cần schema và không thay đổi quyền/hiển thị hay mutation semantics.
