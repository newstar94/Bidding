# Decision packet mục 15 — WordTemplateCatalog

**Trạng thái:** đã được chủ sản phẩm duyệt ngày 2026-08-24; contract tại ADR 0010  
**Contract giữ nguyên:** ADR 0001 config CAS/audit; ADR 0005 explicit publication
assignments; Word entitlement chỉ gate create/download action.

## Bốn quyết định cần chốt

| Gate | Giá trị cần product điền |
|---|---|
| DG-15-01 | Exact lifecycle draft/published/retired/restore; một hay nhiều published version theo scope; restore tạo version mới hay pointer change |
| DG-15-02 | Ai draft/publish/restore; preview SAMPLE/RECORD nào tạo/tải Word artifact và phải giữ entitlement nào |
| DG-15-03 | File/version/preflight/preview/artifact retention; approved sample data; usage source nào authoritative |
| DG-15-04 | Assignment pin exact version hay follow-published logical template; rename/legacy filename alias/cutover serialization |

## Inventory khóa semantics hiện hữu

- Filesystem config `revision` là CAS revision, không phải content history.
- Replace hiện thay bytes của current file; tự biến thành immutable publish sẽ
  đổi behavior và storage/retention.
- Mapping là default registry + sparse owner overrides; chưa thuộc template
  content version.
- Explicit publication assignment không được fallback sang active template ngầm.
- Record preview/export vẫn phải authorize target và action entitlement hiện hữu;
  entitlement không che field trên record API/UI.

### Snapshot inventory đọc trực tiếp ngày 2026-08-24

Inventory này chỉ ghi nhận authority hiện hữu; không tạo logical identity/version,
không đổi config và không suy diễn assignment mới.

| Scope | Code/file hiện hữu | Relative path | SHA-256 | Bytes | Config revision |
|---|---|---|---|---:|---:|
| `organization:org-04f0c923d7fb32b3` | `BiddingFlow_Mau_Kiem_Thu_Xuat_Word.docx` | `data/templates/words/organizations/org-04f0c923d7fb32b3/BiddingFlow_Mau_Kiem_Thu_Xuat_Word.docx` | `1DBE4501A08AA5DC83ABC604F5D8F889B84C38C5DB4004F83E9CB3A7048E5976` | 41,559 | 14 |

Config cùng scope ghi file này là `active_template` và là phần tử duy nhất của
`enabled_templates`. Explicit publication assignments hiện hữu:

| Document code | Assigned filename |
|---|---|
| `award_result_appraisal_report` | `BiddingFlow_Mau_Kiem_Thu_Xuat_Word.docx` |
| `consultant_evaluation_step_1` | `BiddingFlow_Mau_Kiem_Thu_Xuat_Word.docx` |
| `procurement_plan` | `BiddingFlow_Mau_Kiem_Thu_Xuat_Word.docx` |

Không phát hiện `.docx` hoặc `config.json` Word-template khác bên dưới
`data/templates/words` tại thời điểm chụp inventory. Thời gian sửa file quan sát
được là `2026-08-23T05:57:28Z`; timestamp chỉ là inventory metadata, không phải
version/provenance và không được dùng để kết luận template lỗi thời.

## Deep module/interface dự kiến

```text
WordTemplateCatalog.saveDraft(logicalTemplateId, bytes, mappingDraft,
                              expectedDraftRevision, idempotencyKey)
WordTemplateCatalog.publish(logicalTemplateId, draftRevision,
                            expectedCatalogRowVersion, idempotencyKey)
WordTemplateCatalog.restoreAsDraft(logicalTemplateId, sourceVersionId, ...)
WordTemplateCatalog.preflight(templateVersionId, contextContractVersion)
WordTemplateCatalog.preview(templateVersionId, SAMPLE|authorized RECORD, ...)
WordTemplateCatalog.getUsage(logicalTemplateId|templateVersionId)
```

Module che giấu immutable byte storage/checksum, sanitizer/parser versions,
mapping snapshot, publication pointer CAS, compensation và usage/provenance query.
Không expose filesystem path hoặc repository qua HTTP.

## Compatibility/migration strategy cần duyệt

1. Expand logical template/version/preflight tables và immutable storage keys.
2. Inventory existing files + hashes; duplicate/ambiguous filename giữ
   `LEGACY_UNMAPPED`, không đoán logical identity.
3. Adapter đọc/ghi giữ CRUD và explicit assignments hiện hành trong shadow phase.
4. Chọn pin/follow semantics, backfill assignment qua preview report rồi switch.
5. Replace legacy command được map thành save-draft/publish sequence chỉ sau khi
   compatibility được duyệt.
6. Rollback app dùng adapter cũ, giữ versions/preflight/provenance; không xóa history.

## Definition of Ready

- Lifecycle/state table và action authorization có product owner.
- Golden `.docx` fixtures, sample/record preview contract, retention/size limits.
- Assignment cutover matrix cho rename/replace/delete/restore và ADR 0005 parity.
- Provenance hook contract cho mục 14/6 và exact usage authority.
- Migration/runbook/feature flag; tests cho immutable bytes, stale CAS, audit
  rollback, record authorization và entitlement action-only.

Multi-Word mục 30 vẫn bị chặn cho tới khi exact published template version và
artifact provenance tồn tại.
