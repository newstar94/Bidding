# Kiểm chứng kế hoạch 9 tính năng và các cổng quyết định sản phẩm

**Ngày kiểm chứng:** 2026-08-24  
**Repo/commit kiểm chứng:** `main` tại `d636c700efea`  
**Phạm vi:** mục 6, 7, 8, 12, 15, 19, 20, 21 và 30  
**Loại tài liệu:** báo cáo nghiên cứu; không phải ADR, phê duyệt nghiệp vụ hay lệnh sửa production

## 1. Kết luận điều hành

Hai tài liệu đã được đọc đầy đủ:

- `docs/research/2026-08-23-evidence-ledger-tinh-nang-06-07-08-12-15-19-20-21-30.md`;
- `docs/05_KE_HOACH_VA_PROMPT_9_TINH_NANG_2026-08-23.md`.

Các prompt, schema dự kiến, interface dự kiến và câu mệnh lệnh nằm trong hai tài
liệu trên được xem là **nội dung cần phân tích**, không tự trở thành instruction có
thẩm quyền. Chính file kế hoạch cũng ghi rõ trạng thái là “kế hoạch kỹ thuật để chủ
sản phẩm duyệt; không phải phê duyệt thay đổi production” (`docs/05_KE_HOACH_VA_PROMPT_9_TINH_NANG_2026-08-23.md:7`) và yêu cầu mỗi prompt là một task/PR độc lập (`:2104-2110`).

Kết quả kiểm chứng nguồn sơ cấp:

1. Evidence ledger nhìn chung chính xác; không phát hiện claim nền tảng nào sai
   trọng yếu tại commit hiện hành.
2. Không có bằng chứng rằng chín tính năng đã được triển khai sau khi ledger được
   lập. Commit hiện hành chính là commit đưa hai tài liệu vào repo cùng seam
   `allVersions`; tìm kiếm không thấy các module/route/schema đích như
   `version_comparison`, `ProcurementCase`, `WorkCalendar`, `BulkOperation`, legal
   binding hoặc compliance context.
3. Chỉ mục 6 có một lát read-only 6A có thể bắt đầu mà không cần schema hoặc thay
   đổi semantics nghiệp vụ, với điều kiện vẫn authorize từng version độc lập và
   không kết luận tác động Word/pháp lý khi thiếu provenance/binding.
4. Các phần production của mục 7, 8, 12, 15, 19, 20, 21 và 30 còn phụ thuộc quyết
   định sản phẩm/ADR hoặc upstream chưa tồn tại. Việc người dùng yêu cầu “thực hiện
   theo file kế hoạch” không tự điền các placeholder, không chọn giá trị DG và
   không biến đề xuất trong file thành business contract đã duyệt.
5. Không khoảng trống nào là căn cứ để thêm masking/redaction, capability đọc dữ
   liệu nhạy cảm, đổi role/module/assignment/record scope hoặc dùng Word entitlement
   để che dữ liệu record. Contract tại `AGENTS.md:7-19`, `CONTEXT.md:75-80` và ADR
   0007 vẫn là ràng buộc ưu tiên.

## 2. Cách kiểm chứng

Nguồn được ưu tiên theo thứ tự:

1. `AGENTS.md`, `CONTEXT.md` và ADR đã chấp nhận;
2. source code, schema/migration và test hiện hành;
3. hai tài liệu được giao, chỉ để rút acceptance criteria và dependency;
4. tìm kiếm âm toàn repo cho module/API/schema được đề xuất.

Mốc trong kế hoạch là `9a2becaf` cộng working tree ngày 2026-08-23. Từ mốc đó tới
`d636c700efea` chỉ có một commit, chủ yếu đưa chính kế hoạch/ledger, ADR 0007,
`version_metadata` và regression read-scope vào repo. Vì vậy báo cáo này kiểm chứng
lại trên HEAD thay vì mặc định claim ngày 2026-08-23 vẫn đúng.

## 3. Ma trận 9 tính năng

| Mục | Acceptance cốt lõi | Bằng chứng hiện trạng | Gap/blocker quyết định | Phụ thuộc trực tiếp | Trạng thái an toàn |
|---|---|---|---|---|---|
| 6 | Compare hai version đã authorize; full old/new; diff scalar/relation; impact có mức chắc chắn; bounded | Lineage/snapshot, per-version visibility, selector, timeline catalog | Chưa có compare API/kernel/identity registry/impact registry/provenance | 15 cho Word provenance; 8/9/11 cho legal/compliance | Có thể làm 6A read-only |
| 7 | Base/local/server; allowlist merge; fresh auth/CAS; race mới vẫn 409 | CAS 409 + `serverRecord`, projection, quarantine, import three-way merge | Không base values; recovery làm rơi conflict payload; F5 hiện discard marker | DG-07-01..03 | Chỉ characterization/ADR/prototype chưa phát hành |
| 8 | Immutable legal source/profile/binding; temporal resolver; không “latest”; unresolved rõ | RAG registry/effective dates/hash; rule-version precedents | Chưa instrument/profile/binding/resolver; current RAG không phải historical authority | DG-08-01..04 | Inventory/domain/ADR; chưa wire production |
| 12 | Một assistant; deterministic context; AI chỉ giải thích/cite | Fresh auth tools, RAG/citation, quota/audit | Advice mode không có tool; chưa findings/context assembler | 8 + real rules/findings từ 9/11; DG-12-01 | Eval/interface review; compliance tool bị chặn |
| 15 | Immutable template versions; draft/publish/restore; preflight/preview/usage | Scoped storage, config CAS, CRUD/render, assignment/audit | `revision` chỉ config CAS; replace overwrite; thiếu lifecycle/history/provenance | DG-15-01..04 | Inventory/ADR; phần lifecycle production bị chặn |
| 19 | 19A preview + `.ics` chuẩn/stable; 19B explicit consent/connectors | Timeline catalog/effective milestones/deadline facts | Không serializer/route/UID/sequence/projection/connectors | DG-19-01; DG-19-02 cho 19B; case deadline sau 20/21 | Pure RFC tests có thể làm; outbound production bị chặn |
| 20 | Shared case core; state machine; immutable responses; attachment/SLA/audit; no-loss legacy | Legacy clarification lists, timeline/activity/storage primitives | Không case identity/relation/CAS/workflow/SLA; assignment scope chưa có case | DG-20-01/02 và DG-21-02 | Inventory/domain/ADR; production case bị chặn |
| 21 | PETITION policy trên shared case; exact legal basis; preview/reconcile source | Chỉ raw/canonical Mua sắm công sidecar | Không operational domain/API/UI/fixture contract | 20 shared core + 8 + DG-21-01/02 | Fixture/policy draft; không tạo case song song |
| 30 | Allowlisted action registry; authoritative preview; reauth/revalidate; exact domain command; audited result | Bounded sync, batch auth, idempotency/audit, preview/apply precedent, jobs | Không registry/selection authority/control plane/per-item result; pilot chưa chọn | DG-30-01/02; stable target commands; 15 cho multi-Word | Inventory/ADR/test fake; production pilot bị chặn |

## 4. Mục 6 — So sánh phiên bản và tác động

### Acceptance criteria được rút ra

- Authorize `leftVersionId` và `rightVersionId` độc lập bằng canonical read scope.
- Xác nhận cùng tenant, entity type và lineage trước khi compare.
- Trả đầy đủ old/new business values sau authorization; chỉ loại technical sync
  markers/internal credentials, không masking business data.
- Diff scalar/object/relation theo policy identity/order rõ ràng; không ghép child
  clone theo physical ID hoặc index khi identity không ổn định.
- Tách `CONFIRMED`, `POTENTIAL`, `NOT_EVALUATED`; provider lỗi không làm sai diff.
- Payload/relation lớn phải bounded, summary-first và phân trang ổn định.
- Không mutate snapshot, deadline, workflow, legal binding hoặc generated file.

### Bằng chứng hiện trạng

- Version lineage tồn tại trong schema (`backend/db/schema.py:484-493`, `:626-634`).
- Snapshot package clone/remap child aggregates (`backend/versioning/aggregate_snapshot.py:180-199`, `:273-380`).
- `allVersions` dùng `VisibilityScope` cho từng row version, không mở quyền cả
  family (`backend/sync/version_metadata.py:18-64`; ADR 0007 `:16-21`).
- Activity chỉ giữ tên field và audit giữ hash, không đủ làm nguồn old/new
  (`backend/activity/service.py:51-93`, `backend/sync/mutation_audit.py:77-113`).
- Timeline catalog là dependency map sẵn có (`shared/timeline_rules.json:1-86`).

### Gap và rủi ro

Không có compare route/kernel/field registry/relation policy/impact registry hoặc
generated-document provenance. Mục 6A có thể bắt đầu read-only, nhưng Word/legal
phải trả `NOT_EVALUATED` cho tới khi mục 15 và 8/9/11 cung cấp authority. Không
suy quyền từ một version sang family và không sửa historical snapshots.

## 5. Mục 7 — Trung tâm xung đột

### Acceptance criteria được rút ra

- Hiển thị Base/Của tôi/Máy chủ khi base khả dụng.
- Merge từng field chỉ trên allowlist có normalization/identity được duyệt.
- Resolution token/preview authority phải pin exact server rowVersion/projection;
  client payload không phải authority.
- Resolve là mutation mới: fresh session/tenant/module/assignment/record auth,
  canonical validation, idempotency, CAS và audit.
- “Giữ của tôi” không phải force write; writer thứ hai tạo 409 mới.
- Không auto-merge delete, nested list hoặc duplicate/ambiguous identity.

### Bằng chứng hiện trạng

- Sync writer dùng `UPDATE ... row_version = expected` và trả conflict cùng
  `serverRecord` (`backend/sync/record_writer.py:58-107`).
- Conflict projection giữ business fields và bỏ auth/internal secret material
  (`backend/sync/conflict_projection.py:28-48`).
- `ConflictResolver` chỉ toast rồi trả `resolved: false`
  (`frontend/app/ConflictResolver.js:14-34`).
- Recovery store chỉ giữ table/id/code/message, làm rơi `serverRecord` và version
  (`frontend/app/WorkspaceConflictRecoveryStore.js:11-19`, `:74-86`).
- Outbox có `baseSyncVersion` nhưng không có base business field values
  (`frontend/app/mutationQueue.js:106-165`).

### Blocker và rủi ro

`CONTEXT.md:127-129` xác nhận conflict marker hiện chỉ thuộc phiên, bị bỏ khi F5
trước authoritative pull và draft không được auto replay. Durable center thay đổi
semantics hiện hành, nên DG-07-01..03/ADR là blocker production. Việc lưu base
snapshot còn có retention/storage/logout/revocation implications; không được giải
quyết bằng cách mask business data của API record.

## 6. Mục 8 — Phiên bản pháp lý

### Acceptance criteria được rút ra

- Instrument/profile published versions và source artifact phải immutable.
- Binding gắn exact profile vào exact plan/package version, có provenance và
  typed tenant-safe FK/head CAS.
- Resolver version hóa theo approved anchor/transition policy; không fallback
  “latest” và không resolve lại mỗi lần read.
- Kết quả gồm `RESOLVED`, `AMBIGUOUS`, `UNRESOLVED` hoặc
  `MANUAL_REVIEW_REQUIRED`.
- Legacy không đủ evidence phải giữ unresolved; không backfill luật hiện tại.
- Mục 8 chỉ tạo source profile; executable rule/checklist bundle thuộc 9/11.

### Bằng chứng hiện trạng

- RAG registry có số văn bản, issuer, effective interval, version, status và hash
  (`backend/db/schema.py:275-303`).
- Retrieval chỉ lấy `active`, dùng ngày hiện tại và chỉ trừ điểm khi
  `effective_to` đã qua (`backend/ai/knowledge/retrieval.py:204-265`). Nó không
  phải temporal legal resolver và không bảo đảm historical retired source lookup.
- Chưa có legal instrument/profile/binding field hoặc table trên plan/package.

### Blocker và rủi ro

DG-08-01..04 phải chốt anchor, transition, ownership/publish/override, legacy và
clone-vs-resolve. Legal binding không phải permission engine, không mở/che field
và không cấp record access. Source-only profile không được trình bày như executable
compliance rules.

## 7. Mục 12 — AI tuân thủ

### Acceptance criteria được rút ra

- Dùng một `AssistantController`/conversation pipeline hiện có.
- Backend tự resolve target/version và fresh authorize mỗi tool call.
- Chỉ expose strict read-only `get_compliance_context` khi exact binding và
  deterministic findings đã tồn tại.
- AI giải thích finding/evidence/source/not-evaluated; không tính rule, quyết định
  quyền, approve/publish/sign, block workflow hoặc tuyên bố vi phạm từ cảnh báo.
- Exact historical source thắng current web result; không gửi record data sang
  external web search.

### Bằng chứng hiện trạng

- Tool executor re-derive fresh authorization (`backend/ai/tool_executor.py:16-31`).
- `procurement_advice` hiện không có tool vì chỉ mode `data` nhận data tools
  (`backend/ai/tools/__init__.py:18-32`).
- RAG/citation, quota, SSE và metadata-only audit đã tồn tại; generic deterministic
  compliance finding/context assembler chưa tồn tại.

### Blocker và rủi ro

Exact legal binding mục 8 và real immutable rules/findings mục 9/11 là prerequisite
chức năng, không được thay bằng prompt/schema giả. Trong khi thiếu dependency, chỉ
được tiếp tục general RAG advice hoặc trả structured `notEvaluated`. AI tool phải
dùng cùng record authorization và không dùng Word entitlement để giới hạn context.

## 8. Mục 15 — Trình thiết kế Word

### Acceptance criteria được rút ra

- Logical template identity ổn định và immutable content versions/checksum.
- Draft/publish/restore-as-new-version có CAS, idempotency và audit.
- Preflight run append-only pin parser/mapping/registry/policy versions.
- SAMPLE/RECORD preview tách rõ; record load dùng canonical authorization.
- Usage chỉ từ authoritative assignment/provenance, không suy theo filename.
- Migration giữ explicit publication assignments và ADR 0005; không fallback
  active template ngầm.

### Bằng chứng hiện trạng

- `config.revision` là revision của workspace config
  (`backend/documents/custom_exporter.py:503-509`, `:641-680`), không phải template
  content version.
- `list_templates()` chỉ trả filename/name/system/mutable/enabled/active
  (`backend/documents/custom_exporter.py:968-1010`).
- View trả raw `.docx`, chưa phải rendered preview
  (`backend/documents/routes_docx.py:1402-1436`).
- CRUD/render/assignment/sanitizer/audit đã có; replace hiện overwrite current file.
- Mapping mutation hiện là route riêng trên `word_mapping_overrides`; chưa có
  template-version ledger tương ứng (`backend/documents/routes_docx.py:1869-2034`).

### Blocker và rủi ro

DG-15-01..04 phải chốt lifecycle, action authority, retention/preview/provenance
và assignment follow-vs-pin/legacy alias. Word render context hiện có projection
theo `document_capabilities` (`backend/documents/docx_context_policy.py:612-638`);
đây là behavior artifact hiện hành cần characterization, không phải căn cứ để đổi
API/UI record read. Không tự bỏ, mở rộng hoặc diễn giải lại projection đó khi chưa
có yêu cầu nghiệp vụ riêng. Mọi preview tạo/tải Word vẫn giữ action entitlement
hiện hành; entitlement không che record fields trên màn hình/API.

## 9. Mục 19 — Lịch công việc

### Acceptance criteria được rút ra

- 19A dùng một canonical `CalendarEvent` projection và user-initiated preview/download.
- RFC 5545: stable opaque UID, canonical DTSTAMP, significant-change SEQUENCE,
  correct DATE/DATE-TIME/timezone, exclusive all-day DTEND, CRLF, UTF-8 folding,
  TEXT escaping và `text/calendar; charset=UTF-8`.
- Không dùng download time hoặc broad record rowVersion làm event revision.
- 19B chỉ sau explicit consent/OAuth/outbound profile; token không log/return;
  source được reauthorize trước enqueue/send/retry.

### Bằng chứng hiện trạng

- Timeline table có milestone/instance/source/date/status/template version
  (`backend/db/schema.py:1702-1734`).
- Effective timeline đã gom clarification và latest bid closing time
  (`backend/timeline/effective_timeline.py:160-198`, `:225-236`).
- Exact search không thấy `text/calendar`, `BEGIN:VCALENDAR`, `.ics` serializer,
  route hoặc connector trong backend/frontend/tests/shared.

### Blocker và rủi ro

DG-19-01 phải chốt source/outbound/date/timezone/UID/sequence/cancellation/denied
behavior trước route production. `calendar_event_head` trong kế hoạch là thiết kế
đề xuất, chưa phải schema được duyệt. 19B còn phụ thuộc DG-19-02/Integration ADR.
Outbound projection không phải masking của API record; `.ics` không dùng Word
entitlement.

## 10. Mục 20 — Làm rõ

### Acceptance criteria được rút ra

- Một shared `ProcurementCase` core cho clarification/petition.
- Server-authoritative state machine; strict action endpoints, CAS/idempotency,
  không generic `setState`/sync bypass.
- Response content revisions immutable; review/approve/issue event pin exact revision.
- Typed tenant-safe package target, responsibilities, parties, attachments, legal
  basis, deadlines, activity/audit/notification.
- Legacy data tiếp tục hiển thị đầy đủ; không pair request/response theo index,
  time hoặc content nếu thiếu evidence.

### Bằng chứng hiện trạng

- `goi_thau_lam_ro` chỉ có type/time/content/order và không thuộc row-version tables
  (`backend/db/schema.py:1044-1060`, `:2038-2047`).
- Mapper delete/reinsert cả list request/reply
  (`backend/sync/mapper.py:589-625`).
- `phan_cong_nhan_su` chỉ cho target plan/package/contract
  (`backend/db/schema.py:1155-1177`).
- Timeline/activity/notification/private-file primitives có thể tái sử dụng, nhưng
  chưa có case aggregate/workflow/SLA/response revision.

### Blocker và rủi ro

DG-20-01/02 và DG-21-02 phải chốt package version ownership, responsibility-vs-access,
workflow/SLA/approval và case permission mapping. Không tự thêm case target vào
assignment, module/role/capability/inheritance. Party/nhà thầu không mặc nhiên là
workspace principal. Legacy phải no-loss và không redaction.

## 11. Mục 21 — Kiến nghị

### Acceptance criteria được rút ra

- PETITION là policy trên shared case core, không duplicate tables/services/UI shell.
- Petition workflow/SLA/legal basis có version riêng; exact legal source/binding.
- Mua sắm công sidecar chỉ tạo source observation; preview/link/create dùng opaque
  authority, fresh auth/revalidation và idempotency.
- Upstream revision không overwrite local response/state; dedupe bằng stable
  upstream identity + revision, không theo tên/ngày gần giống.

### Bằng chứng hiện trạng

- Repo chỉ có endpoint/collector/raw semantics `NOTICE_PETITION` và
  `NOTICE_CLARIFICATION` (`backend/integrations/muasamcong_browser/endpoint_catalog.mjs:113-121`,
  `backend/integrations/muasamcong_browser/collectors.mjs:1103-1115`,
  `backend/procurement_raw.py:606-619`).
- Không có operational petition schema/API/UI.

### Blocker và rủi ro

Phụ thuộc shared core mục 20, legal binding mục 8 và DG-21-01/02. Chưa có real
redacted source fixture/schema contract nên không được tự map raw sidecar thành
official case. Không tạo module/permission/assignment inheritance mới.

## 12. Mục 30 — Bulk operation

### Acceptance criteria được rút ra

- Static, versioned allowlist registry; client không gửi arbitrary table/patch/status.
- Prepare resolve selection server-side, authorize từng record, capture row/dependency
  fingerprints và persist actor-bound opaque preview TTL/digest.
- Confirm reload/re-authorize/revalidate; drift làm preview stale.
- Execute exact characterized domain command với semantics rõ:
  `DB_ALL_OR_NOTHING`, `ITEMIZED_PARTIAL` hoặc `STAGED_FINALIZE`.
- Idempotent control-plane/result/audit; crash/lease recovery không duplicate hoặc
  kẹt `PROCESSING`.
- Denied item không lộ metadata; bulk không phải permission shortcut.

### Bằng chứng hiện trạng

- Sync batch bounded default 2.000/hard max 10.000
  (`backend/sync/request_contract.py:10-37`).
- Batch write auth prefetch tồn tại nhưng chỉ là optimization của sync write
  (`backend/shared/access_policy.py:549-570`).
- Procurement import đã có actor/workspace-bound `previewId`, digest, expiry và
  stale rowVersion check (`backend/procurement_import/routes.py:1000-1065`).
- Document jobs có durable status/lease/attempt metadata
  (`backend/db/schema.py:406-429`).
- Chưa có generic bulk registry/selection authority/control-plane/per-item result;
  generic sync không phải confirmed bulk domain command. Assignment cũng chưa có
  standalone command seam.

### Blocker và rủi ro

DG-30-01/02 và một pilot action cụ thể phải được duyệt. Mỗi action dùng đúng
canonical read/write/Word-action semantics; batch-write prefetch không phải universal
authorization. Multi-Word còn phụ thuộc immutable template/provenance mục 15. Không
force lifecycle hoặc mở rộng assignment target.

## 13. Đồ thị phụ thuộc và thứ tự có thể thực hiện

```text
6A authorized compare (độc lập, read-only)
├── 15 + artifact provenance ──> Word impact của 6
└── 8 -> 9/11 deterministic rules ──> legal/compliance impact của 6
                                      └──> 12 AI compliance explanation

20 shared ProcurementCase ──> 21 PETITION policy
├── case deadlines ──> 19 WorkCalendar source adapter
└── stable case commands ──> 30 bulk action adapters

15 stable publish/provenance ──> 30 multi-Word
```

Thứ tự dependency trong file kế hoạch là hợp lý, nhưng không đồng nghĩa tất cả
wave có thể chạy ngay. Definition of Ready tại `docs/05_KE_HOACH_VA_PROMPT_9_TINH_NANG_2026-08-23.md:2078-2089`
yêu cầu DG/ADR, contract, fixture, migration/rollback, feature flag và upstream
đã nghiệm thu.

## 14. Cổng quyết định còn thiếu

Không tìm thấy ADR/product answer tương ứng cho các gate sau trong repo hiện hành:

- **DG-07-01..03:** reload/retention/purge, merge allowlist, base snapshot/audit.
- **DG-08-01..04:** temporal anchor/transition, catalog owner/action authority,
  legacy và clone/re-resolve.
- **DG-12-01:** real deterministic rule/finding bundle từ mục 9/11.
- **DG-15-01..04:** lifecycle/restore, action semantics, retention/preview/usage,
  assignment follow-vs-pin/legacy alias.
- **DG-19-01/02:** event/outbound contract; connector consent/token/sync/revoke.
- **DG-20-01/02 và DG-21-01/02:** version ownership, workflow/SLA/approval,
  taxonomy/import và permission mapping.
- **DG-30-01/02:** pilot action/execution boundary/limits và selection authority.

Theo chính prompt trong kế hoạch, thiếu gate phải dừng phần production bị ảnh
hưởng và bàn giao blocker/ADR/inventory; không tự chọn default.

## 15. Regression seams bắt buộc bảo toàn

- Per-version `VisibilityScope`, list/detail parity và full business fields sau auth.
- Aggregate snapshot/history immutability.
- Denied conflict không trả `serverRecord`; unresolved draft không auto replay.
- AI tool fresh authorization, strict/read-only schema và no write side effect.
- Word config CAS, explicit assignment/no implicit active-template fallback,
  required audit rollback và action-only Word entitlement.
- Timeline backend/frontend parity và stable dynamic instances.
- Batch auth parity/N+1 bounds, preview/apply stale authority và idempotency.
- Transactional/tamper-evident audit tại official mutation boundary.

Đặc biệt, test không được đổi expected để hợp thức hóa permission/visibility
semantics chưa duyệt. Authorized record vẫn phải trả đầy đủ CCCD, ngân hàng, số
tài khoản, chữ ký, con dấu và business fields liên quan theo `AGENTS.md`.

## 16. Kết luận bàn giao

### Verification đã chạy

- Backend regression liên quan: `103 passed, 8 skipped` cho read scope/version
  metadata, aggregate snapshot, conflict authorization, Word CAS/assignment,
  timeline, N+1 và AI permission/knowledge.
- Frontend regression liên quan: `119 passed` cho version selector, conflict
  recovery và procurement import preview/apply.
- `python scripts/check_mojibake.py`: pass.
- `git diff --check`: pass tại thời điểm kiểm tra.

Các test trên kiểm chứng seam hiện hữu; chúng không phải acceptance test cho chín
tính năng chưa được triển khai và không tự phê duyệt semantics mới.

Nếu yêu cầu “thực hiện theo file kế hoạch” được áp dụng ngay ở trạng thái repo
hiện tại, phạm vi production có đủ điều kiện rõ nhất là **mục 6A read-only**. Các
phần còn lại phải theo gate nêu trên; phần độc lập chỉ nên là inventory,
characterization, pure kernel/serializer tests, domain/ADR draft hoặc fixture
contract, đúng giới hạn mà từng prompt đã tự quy định.

Không có thay đổi production code, schema, migration, UI hoặc test expectation
trong nghiên cứu này.
