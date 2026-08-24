# Decision packet mục 30 — BulkOperation pilot

**Trạng thái:** pilot đã được chủ sản phẩm duyệt ngày 2026-08-24; contract tại ADR 0013  
**Pilot được duyệt:** `EXPORT_RECORD_DATA`. Bulk không phải permission và không phải wrapper
cho generic sync.

## Candidate inventory

| Candidate | Existing seam | Blocker trước pilot |
|---|---|---|
| Assign/reassign | generic sync + batch auth/activity/notification | Chưa standalone `AssignmentCommand`; cần characterize/extract parity, exact target semantics |
| Data export | governed exporters + canonical reads | Approved export field contract, snapshot/limit/result format |
| Archive/delete | deletion/lifecycle policy | Exact archive action/transition/impact contract |
| Workflow transition | một số server lifecycle policies | Chưa universal domain command; không direct status update |
| Multi-Word | document jobs + Word entitlement | Mục 15 immutable published version + artifact provenance/ZIP contract |
| Case responsibility | chưa có case command | DG-20/21 và shared case core |

## DG-30 values cần product điền

```text
APPROVED_PILOT_ACTION = <exact existing/extracted domain command>
APPROVED_TARGET_TYPES = <...>
APPROVED_SELECTION_MODE = <EXPLICIT_IDS | approved filter contract>
APPROVED_MAX_SIZE = <...>
APPROVED_EXECUTION = <DB_ALL_OR_NOTHING | ITEMIZED_PARTIAL | STAGED_FINALIZE>
APPROVED_SIDE_EFFECT_BOUNDARY = <DB_ONLY | FILESYSTEM | EXTERNAL_PROVIDER>
APPROVED_PREVIEW_TTL = <...>
APPROVED_RETRY_CANCEL = <...>
APPROVED_AUDIT_GRANULARITY = <...>
APPROVED_PREVIEW_FIELDS/REASON_CODES = <...>
```

DG-30-02 còn phải chốt explicit IDs vs all-filtered, filter/schema version,
exclusions, selection drift và denied/ineligible preview disclosure.

## Deep module/interface dự kiến

```text
BulkOperation.prepare(actorContext, actionKey, strictInput, selection)
  -> actor-bound OpaquePreview

BulkOperation.confirm(actorContext, previewId, confirmation, idempotencyKey)
  -> OperationResult | AsyncOperationHandle

BulkOperation.getStatus(actorContext, operationId)
  -> AuthorizedOperationProjection
```

Static adapters khai action key/contract version, target/input/selection schema,
exact auth/domain seam, dependencies, limits, execution/side-effect semantics và
result projection. Caller không gửi table/field/status/arbitrary patch.

## Invariants để review pilot

- Prepare server-resolve candidates, authorize từng record, capture row/dependency
  fingerprints; denied records không lộ title/date/data.
- Confirm same tenant/actor/action/input/selection trong TTL; reload,
  reauthorize/revalidate; drift → stale preview.
- Execute exact domain command. `DB_ALL_OR_NOTHING` chỉ cho bounded one-transaction
  DB-only action. Files/provider không được hứa rollback toàn cục.
- Idempotency không nhân đôi business effect/audit/notify/artifact.
- Cancel chỉ queued/unstarted, không undo committed items.
- Authorized preview/export giữ full approved data; Word entitlement chỉ làm
  Word action ineligible, không che record.

## Control-plane questions

- Với DB-only success: business effect + audit + operation `COMPLETED` + stored
  response phải commit cùng transaction.
- Failure sau rollback ghi bằng separate attempt/lease-CAS transaction.
- Async cần itemized/staged semantics, durable outbox, lease expiry recovery và
  deterministic crash-before/during/after-commit behavior.
- Retention/cleanup giữ metadata/digest, không full sensitive snapshots nếu audit
  contract không yêu cầu.

## Definition of Ready

Một pilot chỉ ready khi exact domain command đã tồn tại/parity tested, toàn bộ
placeholder được duyệt, selection/auth/result contracts có fixtures, operational
limits/TTL/retention/kill switch có owner và migration/runbook được review.
Trước đó không expose production route/UI/action registry.
