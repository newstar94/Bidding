# MSC plan import: authoritative sequential state machine

This is the business and consistency contract for sequential Mua Sắm Công plan
imports. It does not change tenant, module, assignment, record-scope, or
full-record read permissions.

## Final flow

```text
PREVIEW
  -> server session owns source bundle, active revisions and local authorities
  -> candidate decision (if AMBIGUOUS)
  -> candidate-specific three-way merge refinement
  -> explicit KEEP_LOCAL/APPLY_SOURCE decision (if conflict)
  -> FINAL DECISION AUTHORITY (serializable bind + immutable digest)
  -> REVISION DRAFT
  -> server Plan + package authority re-CAS
  -> frontend last-mile authority re-CAS against live model
  -> off-state materialization
  -> durable PlanVersionDraftSession / form
  -> next revision with exact authority recheck
```

The server is authoritative for source, base/local fields, candidate surfaces,
effective fields, required issues, exact Plan predecessor, exact package
targets, and selected investor. The browser sends only bounded decisions and
never sends a canonical source object or arbitrary local row as authority.

## Candidate merge and required fields

An `AMBIGUOUS` match is unresolved until the selected candidate is merged. The
server keeps bounded candidate merge inputs privately and exposes only the
candidate-specific effective fields, conflict values, and required issue names
needed by the decision surface. Selecting `root-b` therefore recomputes:

```text
baseFields(root-b) + localFields(root-b) + sourceFields
  -> effectiveFields(root-b), fieldConflicts(root-b), requiredIssues(root-b)
```

The same canonical merge helper is used for unique matches and selected
candidates. A `__NEW__` choice has no local target and uses source-owned fields
only. Candidate-specific conflict and required-field decisions carry the
selected `localRootId`; switching candidates clears incompatible transient UI
decisions before the next bind.

Required fields are checked on the final effective value, after merge and
explicit decisions. A local value therefore satisfies a missing source value;
an empty `APPLY_SOURCE` value remains a blocker until the user supplies a
bounded field value.

## Authority and CAS

Decision binding runs in one serializable transaction and validates workspace,
session, bundle digest, investor, Plan predecessor, and every exact package
target (`organizationId`, `rootId`, `snapshotId`, `localVersion`, `rowVersion`,
`isLatest`). Row version alone is never treated as identity. The authority is
immutable and idempotent: the same digest and decisions may retry, while a
changed decision or changed target is rejected.

`GET revision draft` revalidates the Plan predecessor and every selected
package target after bind and before mapping the draft. The response carries
bounded `planAuthority` and `packageAuthorities`. Before materialization, the
frontend compares those authorities with the live Plan/package model; a stale
response aborts before publishing any candidate state.

The same checks apply during resume and next-revision loading. Historical Plan
and package snapshots remain immutable, and package version inheritance keeps
assignments, responsible users, workflow state, and local-only metadata under
the existing domain rules.

## Enrichment, recovery, and UI

Background enrichment may refresh source evidence and the session digest. It
must not rebase the session onto a newer local Plan or package authority; a
local authority change marks the session stale. A changed digest invalidates
candidate-specific transient decisions and re-renders the authoritative
surface.

LocalStorage stores only bounded UI recovery. Investor recovery is restored
only for the same normalized Plan code and same preview digest; a changed code
cannot inherit the old investor. When a corrected code already has a latest
local Plan, its exact existing `chuDauTuId` seeds the visible investor option
before source code/name matching; no unrelated investor is invented. The
visible controls, submitted decision
payload, and server decision surface are the same state. Workspace lease,
storage identity, flow identity, session identity, request generation, and
post-durable recovery guards protect every asynchronous side effect.

## Compatibility and migration

Decision authority remains in the existing session canonical JSON; no schema
migration is required. Legacy service callers without an authority retain
their compatibility behavior, while production plan sessions require binding
before any revision draft is materialized. Enrichment replaces only the
server-owned unbound canonical bundle, and resume never stores that bundle in
browser storage.

Regression coverage spans the canonical merge helper, session bind/draft CAS,
route authority validation, wizard decision rehydration and candidate identity,
frontend last-mile checks, resume/next, enrichment, lifecycle protections,
package inheritance, and historical immutability.
