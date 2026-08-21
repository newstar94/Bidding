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

## Workspace and flow capability rule

Every async operation that can persist, clean up, restore, render, open a modal,
change a pointer, or publish candidate state captures its capability before the
first `await` and verifies it immediately before each side effect. The
capability includes the workspace token/epoch, state and database identity,
workspace storage identity, target package/plan identity, and (where
applicable) flow/session identity. Plan, package, notice, and opening imports
must pass the originating capability into their start/resume functions; a stale
flow is never rebound to the current workspace.

Rollback is a mutation: a checkpoint is restored only into the exact capability
that created it. A stale completion returns `WORKSPACE_CHANGED` or
`FLOW_CHANGED` and leaves the current workspace/flow untouched. Late employee
or lookup callbacks must verify the edit flow and form identity before
populating controls.

## Resume and cancellation pointers

The pointer stores bounded session metadata only. It is advanced after a local
durable revision save, never before. It is cleared after a confirmed remote
cancel or successful completion. Network failure, workspace change, or a lost
response keeps the pointer for retry/reconciliation; it must not create an
invisible server session. Cancellation uses the flow's captured origin lease,
not a newly captured lease from whatever workspace is currently visible.

## Draft tombstones

The local draft envelope is version 4 and contains `sessions` plus exact
`tombstones`. At most 256 tombstones are retained. When the bound is exceeded,
the oldest exact entries are removed deterministically; malformed timestamps
sort first and are compacted without affecting any other draft ID. There are no
hash buckets or retirement watermarks, so an unrelated fresh draft can never be
rejected because another ID was removed. A removed durable draft can only be
recreated with revision `0`; any stale snapshot with revision `>= 1` is rejected
by the durable compare-and-swap path, even after its exact tombstone is
compacted. Removing an ID that was never durable does not allocate a tombstone.

## Historical and package invariants

- Historical plan/package snapshots are immutable.
- Each root/family has at most one `isLatest` row.
- A package snapshot belongs to its exact plan snapshot; plan and package source
  revisions remain independent.
- Every MSC revision targets the exact immediate authoritative predecessor
  (`id`, `rootId`, `rowVersion`, and `localVersion` where present).
- Draft reapply never overwrites authoritative shared references or resurrects
  a tombstoned draft.
- Notice and opening imports apply only to the selected package/preview and
  never render or reset a different workspace after an asynchronous switch.
