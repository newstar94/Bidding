---
status: accepted
supersedes: ADR 0008
---

# Authorized record read is complete

## Decision

A principal that passes tenant, module, assignment and record-level authorization reads the complete business record, including identity, bank-account, signature, stamp and related fields. BiddingFlow does not apply a separate sensitive-record-read capability to mask those fields.

Word/document export remains a separate action entitlement. It controls whether a document can be generated or downloaded, but never controls field visibility in record APIs or interactive UI.

No agent may change field visibility, masking/redaction, roles, permissions, scopes, capabilities, entitlements, inheritance or default allow/deny semantics without an explicit product-owner requirement. Security-hardening rationale alone is insufficient authority for a business behavior change.

## Compatibility

The `sensitive_record_read_capabilities` implementation introduced under ADR 0008 must no longer affect runtime authorization, visibility epochs, API projection, frontend controls or document-job authorization. Existing rows may be retained temporarily during a forward-only migration rollout, then removed only through an append-only migration after all callers have been removed. No business record data is deleted.

## Required regression coverage

- An employee with valid module and record scope receives complete identity, financial and signature fields without a separate field capability.
- A principal outside tenant/module/assignment/record scope receives no record; this ADR does not broaden record access.
- Revoking Word export blocks Word generation/download but does not mask record APIs or UI.
- Changing document entitlement does not change visibility epoch for record fields.
- Admin user settings expose no control that implies a separate sensitive-record-read grant.
