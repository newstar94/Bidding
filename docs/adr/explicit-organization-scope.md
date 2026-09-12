# Explicit organization scope for ambiguous requests

Status: requested by the product owner's improvement prompt; implementation
and verification are incomplete. This ADR does not approve additional access
restrictions beyond that prompt and AGENTS.md.

## Decision

When `get_active_org` receives no `X-Active-Org`, it must not select the first
membership if multiple active memberships exist. It reads at most two joined
membership rows and raises `OrgScopeRequiredError` on ambiguity. HTTP adapters
must expose `ORG_SCOPE_REQUIRED` with status 409 without performing a mutation.
An explicit header still undergoes account, membership, organization status,
and membership-role validation on every resolution.

Preserve the existing single-membership fallback and no-membership personal
workspace behavior. An inactive organization is not silently removed from the
candidate list to select another workspace or fall back to personal scope.
Explicit personal scope and platform administrator rules remain unchanged.

No session-selected organization field is added: a shared session selection
would require separate cross-tab semantics. Clients should send the workspace
captured for their operation, not retarget a pending operation after switching.

## Compatibility and migration

Multi-membership clients omitting the header now receive an explicit error
instead of having the backend select a workspace. This is the intended
compatibility change requested by the prompt. Successful response shapes,
ordinary 403 denial payloads, roles, assignments, module/record permissions,
Word entitlements, and authorized record data remain unchanged.

No database migration or data rewrite is required. Before rollout, verify all
organization-scoped adapters and client recovery flows. A 409 must not cause
an automatic retry against the newly selected organization: retain pending
work in its originating workspace and resolve scope there.

## Recovery

If compatibility problems occur, retain affected pending work and repair the
client's explicit scope propagation. Do not restore silent first-membership
selection as an operational workaround. Source rollback requires reviewing
this scope invariant with the owner; no schema rollback is necessary.

## Verification and outstanding work

Resolver tests: `tests/test_active_org_ambiguity.py`.
Direct adapter tests: `tests/test_lot_scope_http_error.py`,
`tests/test_document_scope_http_error.py`, `tests/test_sync_scope_http_error.py`.
They cover ambiguity versus ordinary denial but do not prove complete route
coverage or PostgreSQL revocation/concurrency behavior. WebSocket, offline
replay, remaining adapters and end-to-end workspace switching remain required.
See `docs/prompt-improvement-progress.md`; do not claim rollout readiness yet.
