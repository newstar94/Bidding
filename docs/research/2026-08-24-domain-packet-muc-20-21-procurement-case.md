# Domain packet mục 20/21 — ProcurementCase

**Trạng thái:** đã được chủ sản phẩm duyệt ngày 2026-08-24; contract tại ADR 0012  
**Nguyên tắc:** một shared case module; `CLARIFICATION` và `PETITION` là policies,
không phải hai hệ thống song song.

## Vocabulary đã chấp nhận — đã đưa vào `CONTEXT.md`

- **ProcurementCase**: aggregate vận hành gắn typed parent package target.
- **CasePolicyVersion**: required fields, transition table, action authority và
  deadline rules cho một case type.
- **Responsibility**: metadata người/đơn vị chịu trách nhiệm; mặc định không cấp access.
- **Party**: bên tham gia case; không mặc nhiên là workspace principal.
- **ResponseContentRevision**: immutable response content snapshot.
- **CaseTransitionEvent**: state change pin exact response revision/evidence.
- **SourceObservation**: immutable observation từ external revision; không phải
  official case và không overwrite local state.

## Product gates

| Gate | Quyết định cần chốt |
|---|---|
| DG-20-01 | Case gắn exact package version hay lineage; version mới clone/share/relink thế nào; legacy request/response pair/migrate strategy |
| DG-20-02 | Exact CLARIFICATION states/transitions/SLA; create/review/approve/issue authority; responsibility chỉ metadata hay có access consequence |
| DG-21-01 | PETITION taxonomy, required fields, states/return/withdraw/reopen, SLA/legal basis và external reconciliation |
| DG-21-02 | Parent permission inheritance hay module/permission riêng; external party access; assignment semantics |

Không có answer thì giữ: parent record authorization hiện hữu, responsibility
không cấp access, party không có workspace access, không official case writes.

## Shared interface dự kiến

```text
ProcurementCase.execute(actorContext, strict CaseCommand)
  -> CaseResult

ProcurementCase.query(actorContext, CaseQuery)
  -> AuthorizedCaseProjection

CaseDeadline.project(authorizedCase, exactPolicyAndLegalBinding)
  -> DeadlineFact | NOT_EVALUATED
```

`execute` che giấu state machine, expected rowVersion, immutable response
revision, attachments, activity/audit/notification/outbox và typed target checks.
Không có generic `setState`. HTTP/worker/UI là adapters.

## State questions cần fixtures

### CLARIFICATION

Proposal có create/receive → responsibility → response draft → review/return →
approve → issue → close. Product phải xác nhận:

- inbound/outbound clarification có cùng state machine không;
- edit sau approve làm approval stale thế nào;
- close/reopen/withdraw/cancel có tồn tại không;
- due date manual hay legal/SLA derived, timezone/evidence;
- issue authority và exact revision pinning.

### PETITION

Proposal tiếp nhận → phân công → kiểm tra → dự thảo → phê duyệt → phát hành →
đóng. Cần xác nhận return/reject/withdraw/reopen, taxonomy/SLA theo legal regime,
approval evidence và free-text legal basis có được phép hay không.

## Legacy/source reconciliation

- `goi_thau_lam_ro` request/response lists tiếp tục hiển thị đầy đủ; không pair
  theo index/time/content. Chỉ deterministic evidence hoặc manual preview/link.
- `NOTICE_CLARIFICATION`/`NOTICE_PETITION` cần redacted real fixture + strict
  canonical adapter trước khi map. Unknown raw fields chỉ ở provenance.
- External revision tạo `SourceObservation`; official create/link cần opaque
  preview authority + fresh parent auth + idempotency.
- Dedupe theo stable upstream identity + revision; external update không overwrite
  local response/state.

## Compatibility/migration shape sau duyệt

- Typed tenant-safe package target relation; không polymorphic unguarded ID.
- Case/header current state + append-only response revisions/events/source
  observations; attachment relation riêng nhưng reuse validation/storage primitives.
- Official commands không đăng ký generic sync tables.
- Legacy shadow/parity → new creates → switch writes; rollback giữ legacy và case
  readable, không xóa history.
- Deadline projection phát fact cho calendar mục 19; thiếu legal/SLA trả
  `NOT_EVALUATED`, không hard-code overdue conclusion.

## Definition of Ready

Approved state matrices, action authority map, parent/version ownership, external
party/access contract, SLA/legal fixtures, legacy reconciliation report, typed ERD,
migration/runbook/flag và regression seams cho revocation/no-leak/full authorized
data/immutable response/audit atomicity.
