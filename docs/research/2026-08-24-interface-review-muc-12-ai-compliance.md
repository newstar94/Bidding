# Interface review mục 12 — AI tuân thủ

**Trạng thái:** Đã triển khai bundle v1 theo DG-12/ADR 0009; production rollout vẫn chờ legal reviewer duyệt citation fixtures  
**Pipeline giữ lại:** `AssistantController` + `procurement_advice`, fresh tool
authorization, quota/SSE/citation/audit hiện hữu.

## Prerequisite ledger

| Dependency | Evidence cần để mở tool | Hiện trạng |
|---|---|---|
| Exact legal binding mục 8 | `LegalBinding.getExact()` production + historical source tests | Đã có schema/API/UI/hash/integration test |
| Deterministic rules/findings mục 9/11 | immutable rule/checklist versions + independently tested findings | Bundle v1 đã được product duyệt: deadline/timeline-readiness từ exact hash `timeline_rules.json` |
| Authorized exact record/version | canonical read seam, revocation/cross-tenant tests | Có nền tảng; 6A đã reuse `VisibilityScope` |
| Provenance facts | document/workflow/timeline fact versions phù hợp câu hỏi | Mới có một phần timeline |

Tool được đăng ký có điều kiện bằng hai kill switch; legal conclusion vẫn
`NOT_EVALUATED` cho tới khi legal reviewer duyệt citation fixtures.

## Interface đích đã review

```text
ComplianceContext.getSnapshot(actorContext, targetHint)
  -> DeterministicComplianceSnapshot
```

`targetHint` không phải authority. Module phải resolve exact target/version,
fresh authorize, load exact legal binding + bundle + findings, bound payload và
trả `notEvaluated`. Model không thấy repository/rule evaluator.

Snapshot contract tối thiểu:

```json
{
  "target": {"type": "goithau", "id": "…", "exactVersionId": "…"},
  "snapshotVersion": "…",
  "legalBinding": {"sourceProfileVersionId": "…", "sources": []},
  "complianceBundle": {"bundleVersionId": "…"},
  "findings": [],
  "workflow": {},
  "timeline": {},
  "documents": {},
  "versionContext": {},
  "notEvaluated": []
}
```

## Eval contract phải có trước production

- Missing binding/rule/provenance chỉ sinh `notEvaluated`, không hallucinated finding.
- `NEEDS_REVIEW` không được diễn đạt thành “vi phạm pháp luật”.
- Exact historical source thắng current web result; record data/identifier không
  được đưa sang external web search.
- Prompt injection nằm trong record/source được xem là untrusted data.
- Mỗi compliance claim trace `ruleId → ruleVersion → evidencePath → exact source`.
- Fresh auth mỗi tool call; target/workspace mismatch và revoked assignment no-leak.
- Authorized context vẫn đầy đủ; không sensitive-read capability mới, Word
  entitlement không gate record context.
- Không write/approve/publish/sign/change-state tool.

## Structured unavailable result trong thời gian chờ

Nếu UI sau này cần báo readiness trước khi tool mở, server-owned result phải có
stable reason codes như `LEGAL_BINDING_NOT_AVAILABLE`,
`COMPLIANCE_BUNDLE_NOT_AVAILABLE`, `PROVENANCE_INCOMPLETE`; đây là readiness
metadata, không phải finding. General RAG advice hiện hữu vẫn tách biệt.

## Definition of Ready

Chỉ mở implementation khi DG-12-01 link tới rule/finding bundle đã nghiệm thu,
DG-08 đã có binding/citation production, eval fixtures được product/legal owner
duyệt và exact tool schema + rollout flag có owner.
