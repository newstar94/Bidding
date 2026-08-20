# MSC plan/package import and version-draft state machine

This document describes the state boundaries used by the MSC import workflows.
It is an implementation contract for draft durability, workspace isolation, and
version provenance. It does not change tenant, module, assignment, record
scope, role, entitlement, or data-visibility semantics.

## Plan version domains

### New plan (local draft chain)

`00 → 01 → 02 …` is a local `PlanVersionDraftSession` until the user chooses
**Lưu & hoàn tất**. Intermediate saves update the workspace-scoped durable
draft only. They do not call `/api/sync`, do not create server rows, and do not
advance server `isLatest`.

Finalization validates and commits the complete graph atomically. The client
applies canonical row versions and removes the local draft only after the
server acknowledgement. A failed or lost response keeps the draft for an
idempotent retry; a post-durable UI failure retries rendering/pull and never
creates a second graph.

Declining the next source revision discards this local chain, cancels the source
session, and clears the resume pointer only after remote cancellation succeeds.
If cancellation fails, the active flow and pointer remain visible so the user
can retry; local discard is not represented as a successful server cancel.

### Existing plan (persisted revision chain)

An already persisted latest revision is authoritative. Importing the next MSC
revision creates the next server version through the normal versioning/sync
lane and preserves every committed predecessor. A decline means **stop at the
current version**; it does not delete or roll back committed versions.

The confirmation text reflects this distinction. Existing plan/package rows
remain available after a declined or failed cancellation.

## Source-import controller states

`SequentialRevisionController` allows these transitions:

```text
READY
  └─ loadCurrent() → EDITING_REVISION

EDITING_REVISION
  └─ saveCurrent() → WAITING_NEXT_CONFIRMATION (when another revision exists)
  └─ saveCurrent() → COMPLETED (last revision)

WAITING_NEXT_CONFIRMATION
  ├─ next() → LOADING_NEXT_REVISION → EDITING_REVISION
  ├─ decline → CANCELLED after remote cancel succeeds
  └─ decline + remote failure → remains visible/retryable

LOADING_NEXT_REVISION
  ├─ success → EDITING_REVISION
  └─ failure → WAITING_NEXT_CONFIRMATION at the prior index
```

`COMPLETED` and `CANCELLED` are terminal for that controller instance. A late
completion from an older flow/session cannot mutate a replacement flow, even
when the workspace token is unchanged.

## Capability rule for async work

Every async operation that can persist, clean up, restore, render, open a modal,
change a pointer, or publish candidate state captures its capability before the
first `await` and verifies it immediately before each side effect. The
capability includes the workspace token/epoch, state and database identity,
workspace storage identity, and (where applicable) flow/session identity.

Rollback is a mutation: a checkpoint is restored only into the exact capability
that created it. A stale completion returns `WORKSPACE_CHANGED` or
`FLOW_CHANGED` and leaves the current workspace/flow untouched.

## Resume and cancellation pointers

The pointer stores bounded session metadata only. It is advanced after a local
durable revision save, never before. It is cleared after a confirmed remote
cancel or successful completion. Network failure, workspace change, or a lost
response keeps the pointer for retry/reconciliation; it must not create an
invisible server session.

## Historical and package invariants

- Historical plan/package snapshots are immutable.
- Each root/family has at most one `isLatest` row.
- A package snapshot belongs to its exact plan snapshot; plan and package source
  revisions remain independent.
- Every MSC revision targets the exact immediate authoritative predecessor
  (`id`, `rootId`, `rowVersion`, and `localVersion` where present).
- Draft reapply never overwrites authoritative shared references or resurrects
  a tombstoned draft.

## Bounded draft tombstones

The durable draft envelope keeps at most 256 individual tombstones. When older
entries are compacted, their retirement time is folded into one of 64 bounded
watermark buckets derived from the draft ID. A draft with no active durable
session can be created only at revision `0` and only when its creation time is
newer than the bucket watermark. Consequently, a stale pre-save clone and a
previously persisted revision remain rejected after their individual tombstone
has been removed.

Removing an ID that was never durable is a no-op and does not allocate a
tombstone. Existing version-2 envelopes are normalized to version 3 on the next
durable mutation; active sessions and their revision CAS semantics are
unchanged. Malformed legacy retirement timestamps compact fail-closed into a
permanent bucket watermark, preserving the bound without forgetting deletion.
