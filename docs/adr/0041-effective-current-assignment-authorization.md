# ADR 0041: Effective current assignment authorization

## Status

Accepted

## Context

Plans, packages, and contracts are versioned as immutable physical snapshots in one logical lineage. Assignment rows on historical snapshots remain necessary audit evidence. Previously, write authorization could treat an assignment on any snapshot in the lineage as an active grant. After a manager transferred only the latest snapshot from specialist A to specialist B, A could therefore retain write authority through the historical assignment even though direct read and visibility projection excluded the latest snapshot.

Authorization and assignment transfer also did not participate in one explicit lock discipline. A specialist transaction could authorize against an assignment while a manager concurrently revoked it, then persist using stale authorization.

This decision does not alter field visibility, masking, module permissions, role semantics, tenant isolation, record scope, the specialist logical-new create exception, or the contractor creator exception in ADR 0040.

## Decision

- The effective assignment grant for a plan, package, or contract is the assignment attached to the exact physical snapshot being accessed.
- A historical snapshot assignment authorizes that historical snapshot only; it does not authorize another version in the lineage.
- An assignment on an exact child package remains an independent grant to that package's exact parent plan snapshot under the existing plan-access rule.
- Direct read, paginated projection, delta projection, child-record access, and write authorization use the same exact-target semantics.
- Batch and direct write authorization lock the relevant assignment rows with `SELECT ... FOR UPDATE`. This covers regular sync, aggregate-version commands, and conflict-resolution writes. Manager assignment `UPDATE` and `DELETE` statements acquire the same PostgreSQL row locks, so revocation and specialist writes serialize. The specialist decision is evaluated after the lock is obtained and before persistence in the same transaction.
- New logical Plan, Package, and Contract creation remains server-authoritative: the server adds the creator assignment under ADR 0038, while the client mirrors it only for immediate offline UX.

## Compatibility impact

- Specialists transferred away from the latest snapshot lose active read/write/projection access to that snapshot and its dependent child rows.
- Historical assignment evidence is retained and historical snapshots continue to follow their explicit exact-snapshot read policy.
- Managers, independent valid grants, module permission behavior, full authorized record data, and protected asset rules are unchanged.

## Migration strategy

No schema or data migration is required. Existing assignment rows remain intact. The authorization resolver changes how those rows are interpreted for an exact requested snapshot.

## Regression coverage

- Real PostgreSQL V00/V01 transfer tests for Plan, Package, and Contract.
- Real multi-connection PostgreSQL transfer-versus-write serialization test that observes PostgreSQL's blocking graph, commits an actual row mutation, and proves a post-transfer mutation is denied, without timing sleeps.
- Direct read, direct write, batched write-context, child authorization, visibility projection, and N+1 query-count coverage.
- Specialist logical-new self-assignment and anti-self-claim coverage remains required at the server augmentation seam.

## Client reconciliation implementation

The client must not treat a pending mutation as an independent read grant.
On a full authoritative scope change, server-removed persisted records are
removed from visible projections, plan draft snapshots and legacy backup
arrays. Genuinely uncommitted drafts and independently authorized records are
preserved. Dirty plan breakdown and package editors close when their target
is no longer visible.

Pending upserts remain in the existing outbox for normal server authorization
and error handling; they must not repopulate a revoked visible projection.
The client stores only revoked table/record IDs in user/workspace-scoped
metadata (`bf_revoked_projection_ids_v1`), reads updates from other tabs before
merging, and clears an ID when an authoritative response grants it again.
Existing workspace purge removes this metadata. This is projection bookkeeping,
not a new permission or a substitute for backend authorization.

A tab compares incoming visibility against its own previously observed token
as well as the shared committed cursor. Another tab advancing storage cannot
prove that this tab's in-memory state has already reconciled.

Compatibility: no field masking, role, module permission or assignment scope
changes. No server schema migration. Metadata is additive and empty on first
use. Regression coverage includes full/partial reset, dirty drafts, pending
inserts/updates, model recreation, regrant, workspace isolation and two-tab
browser transfer with both dirty editors open.
