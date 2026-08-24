# Runbook AI Compliance bundle v1

Áp dụng ADR 0009 và quyết định 12.1–12.4. Bundle này chỉ đánh giá mức sẵn sàng deadline/timeline; `FAIL` là thiếu dữ liệu quy trình deterministic, không phải tuyên bố vi phạm pháp luật.

## Interface và authority

`ComplianceContext.get_snapshot(targetHint)` là seam duy nhất. Adapter PostgreSQL fresh-authorize exact version bằng `VisibilityScope`, sau đó nạp exact legal binding/source hash và generated-document provenance. Engine thuần trả snapshot versioned; AI chỉ giải thích.

Tool `get_compliance_context` chỉ xuất hiện trong `procurement_advice` khi đồng thời:

```text
LEGAL_VERSIONING_ENABLED=true
AI_COMPLIANCE_ENABLED=true
```

Startup fail nếu bật compliance mà legal flag tắt. Mỗi message phải mang exact `{targetType,targetId,versionId}`; model gọi sai một giá trị sẽ bị `AI_SCOPE_VALIDATION_FAILED` trước khi mở database. Lượt exact-target không gọi external web search, nên record data/query/identifier không đi ra adapter Internet.

## Snapshot v1

- `record`: đầy đủ business fields của exact version sau authorization; không masking mới và không liên hệ Word entitlement.
- `legalBinding.sources`: exact immutable IDs, version, URI, effective interval và SHA-256 đã verify.
- `complianceBundle`: `compliance-deadline-readiness-v1`, timeline catalog version + content hash.
- `findings`: stable rule ID/version, `PASS|FAIL|NEEDS_REVIEW|NOT_EVALUATED`, severity, evidence paths và exact legal source IDs.
- `timeline`, `documents`, `versionContext`, `notEvaluated`: provenance và giới hạn rõ.
- `snapshotVersion`: SHA-256 của target rowVersion, binding revision, bundle và document provenance.

Legal conclusion luôn có `LEGAL_CONCLUSION_NOT_EVALUATED` cho tới khi legal reviewer duyệt citation fixtures. Workflow/document rules ngoài bundle v1 cũng phải hiện trong `notEvaluated`.

## Shadow/eval

1. Giữ `AI_COMPLIANCE_ENABLED=false`; bật legal catalog/binding theo runbook mục 8.
2. Chạy fixtures engine độc lập AI: missing timeline date → `FAIL`; conditional applicability → `NEEDS_REVIEW`; missing binding → `NOT_EVALUATED`; exact resolved binding → legal-readiness `PASS` nhưng legal conclusion vẫn not-evaluated.
3. Kiểm tra fresh authorization, revoked assignment, cross-tenant/target mismatch đều không trả target metadata.
4. Kiểm tra payload có prompt injection vẫn được đánh dấu `untrustedData=true`; prompt policy không làm theo chỉ dẫn trong record/source.
5. Kiểm tra provider timeout không thay đổi deterministic snapshot/finding và không có write tool.
6. UI phải hiện target/version chip, rule/result/evidence/not-evaluated và exact source; đổi workspace hoặc bỏ chip phải xóa context/result stale.

## Cutover và rollback

Sau khi product owner duyệt fixture bundle và legal reviewer duyệt citations, bật `AI_COMPLIANCE_ENABLED=true`, restart workers, smoke test một plan và package đã bind. Rollback bằng cách tắt riêng flag compliance và restart; general RAG advice vẫn hoạt động, legal binding/catalog/history không bị xóa hoặc sửa.
