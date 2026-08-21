# MSC plan import: authoritative sequential state machine

This document is the canonical contract for the sequential Mua Sắm Công plan
import path. It does not change tenant, module, assignment, record-scope, or
full-record read permissions.

## Authority flow

```text
preview bundle (digest + reconciliationByRevision)
    -> session creation (server-owned canonical bundle)
    -> decision binding (bounded choices, CAS on bundle digest)
    -> resolved revision draft (effective fields, validated decisions)
    -> local plan-version draft session
    -> form editing and intermediate saves
    -> atomic finalization / resume
```

The server is the authority for source, base/local fields, three-way merge,
package candidates, required-field observations, and selected investor. A
client sends only `bundleDigest`, `investorId`, `packageMatches`,
`fieldConflicts`, and `fieldValues` in the decision-binding request. It never
sends a canonical source object or an arbitrary local root as authority.

## Decision binding

`POST /api/procurement/imports/plan/sessions/{sessionId}/decisions` validates
the workspace/session scope, preview digest, candidate root and snapshot,
row/local version, required field and type/domain, and investor workspace
membership. The resulting authority is immutable and idempotent: the same
digest and decisions may be retried, while changed decisions are rejected.

An unbound clean revision may be read for existing inline lookup compatibility;
the server still overlays its preview `effectiveFields`. A revision with an
ambiguity, conflict, or missing required field must be bound before it can be
materialized.

## Sequential and ALL semantics

The session manifest contains only the selected, materializable revisions and
keeps their chronological order. ALL mode cannot bypass an unresolved issue in
an earlier revision because decision requirements are collected across every
selected revision and binding resolves every one before the first draft opens.

Each later revision targets the exact committed predecessor (`id`, `rootId`,
`localVersion`, and `rowVersion`). Historical snapshots remain immutable.

## Local materialization and recovery

Resolved effective fields are the only source fields presented to local
materialization. Local-only changes therefore survive, `KEEP_LOCAL` keeps the
local value, and `APPLY_SOURCE` applies the source value. Application metadata,
assignments, child snapshots, workflow/appraisal state, and historical rows are
preserved by the existing aggregate materializers.

The selected investor is copied as an authoritative `chuDauTuId` only after
server validation. Inline lookup without a selected investor retains its
existing source-based resolver behavior; the required modal selection must be
bound and is never silently replaced.

After a durable local draft exists, a UI handoff failure retains the exact flow
and recovery pointer while releasing loading state. Flow identity, workspace
lease/storage identity, and session identity guard every asynchronous side
effect; a replaced flow in the same workspace cannot reset or mutate the new
flow.

## Compatibility and migration

The decision authority is stored inside the existing session canonical JSON;
no table or migration is required. Existing sessions without an authority are
read through the clean-revision compatibility path and must bind before any
ambiguous/conflicting/required revision is materialized. Enrichment updates
replace only the server-owned canonical bundle before binding. Resume reads the
bound authority from the session and never stores the canonical bundle in
browser storage.

Regression coverage is maintained at the session service, route resolver,
wizard gate/client, materializer, resume, and inline handoff seams.
