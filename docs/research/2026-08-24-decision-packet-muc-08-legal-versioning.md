# Decision packet mục 8 — Phiên bản pháp lý

**Trạng thái:** đã được chủ sản phẩm duyệt ngày 2026-08-24; contract tại ADR 0009  
**Code/schema production:** chưa tạo  
**Quyết định:** DG-08-01..04 dùng toàn bộ phương án khuyến nghị trong phiếu quyết định sản phẩm.

## Câu hỏi domain cần chốt

| Gate | Quyết định bắt buộc | Scenario phân biệt semantics |
|---|---|---|
| DG-08-01 | Anchor event/date cho từng target: tạo hồ sơ, phê duyệt, đăng tải, phát hành E-HSMT hay event khác | Hồ sơ tạo trước nhưng phê duyệt sau ngày luật mới hiệu lực dùng profile nào? |
| DG-08-02 | Amend/repeal/suspend/overlap/transition; ưu tiên và evidence khi facts thiếu | Văn bản A bị thay một phần bởi B; target nằm trong giai đoạn chuyển tiếp thì `RESOLVED`, `AMBIGUOUS` hay review? |
| DG-08-03 | Catalog `SYSTEM` hay theo organization; ai draft/publish/override; ánh xạ action vào permission hiện có | Org A có được dùng system profile và override bằng profile org A? Org B có thấy artifact org A không? |
| DG-08-04 | Legacy backfill; version mới clone binding hay resolve lại; offline/unresolved behavior | Version 02 kế thừa target facts từ 01 nhưng phát hành sau mốc luật mới: clone hay resolve? |

## Vocabulary dự kiến — chưa đưa vào `CONTEXT.md`

- **LegalInstrument**: identity ổn định của một văn bản; không đồng nghĩa một
  lần publish/content version.
- **LegalInstrumentVersion**: source artifact/content hash bất biến cùng effective
  interval và relation pháp lý đã duyệt.
- **LegalSourceProfileVersion**: manifest bất biến gồm exact instrument versions;
  source-only, không phải executable rules.
- **ApplicabilityPolicyVersion**: policy nhận target facts + anchor/transition
  facts và trả resolution có evidence.
- **LegalBinding**: append-only result gắn exact target version với exact profile
  version hoặc explicit unresolved status.
- **ComplianceBundleVersion**: dependency tương lai từ mục 9/11; không được tạo
  placeholder FK trong mục 8.

## Interface nhỏ dự kiến

```text
LegalCatalog.publishDraft(draftId, expectedDraftRevision, idempotencyKey)
  -> PublishedInstrumentVersion | PublishedProfileVersion

LegalApplicability.resolve(targetFacts, policyVersion)
  -> RESOLVED | AMBIGUOUS | UNRESOLVED | MANUAL_REVIEW_REQUIRED

LegalBinding.bind(targetVersion, resolution, expectedBindingRevision,
                  expectedTargetRowVersion?, idempotencyKey)
  -> Bound | Unresolved

LegalBinding.getExact(authorizedTargetVersion)
  -> Bound | Unresolved

LegalCitation.getExactSources(profileVersionId, sourceIds)
  -> hash-verified immutable sources
```

Interface che giấu draft/publish transaction, typed target FK, binding-head CAS,
manifest hashing và exact historical citation. Route/UI chỉ là adapter. Legal
module không phải permission engine; caller phải authorize target trước.

## Data/compatibility shape sau khi duyệt

- Mutable CAS drafts tách khỏi immutable published instrument/profile versions.
- Typed `plan_legal_binding` và `package_legal_binding`, tenant composite FKs;
  không polymorphic `target_type,target_id` không enforce được tenant.
- Append binding history + advance one-head-per-target bằng binding revision CAS
  trong cùng transaction; target rowVersion không thay binding CAS.
- Không backfill “current law” vào historical rows. Thiếu evidence giữ
  `UNRESOLVED`/review queue.
- Exact source artifact được hash và `RESTRICT` khi đã được profile/binding dùng;
  RAG current/retired không quyết định historical authority.
- Rollback app bỏ read projection mới nhưng giữ append-only history.

## Definition of Ready evidence

1. Product answer có owner cho cả bốn DG, fixtures trước/đúng/sau effective date,
   transition/overlap và clone-vs-resolve.
2. Action authorization map chỉ tới role/module permission hiện hữu hoặc ADR được
   duyệt nếu thực sự đổi semantics.
3. Legacy reconciliation strategy + expected resolved/ambiguous/unresolved counts.
4. Artifact retention/source-hash contract và test fixture hợp pháp.
5. Migration number/runbook/feature flag/kill switch.

Cho tới khi đủ, compare mục 6 và AI mục 12 phải trả legal/compliance impact
`NOT_EVALUATED`; không fallback `latest`.
