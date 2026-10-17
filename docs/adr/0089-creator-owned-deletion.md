# ADR 0089: Creator-owned deletion and personal delete controls

Date: 2026-10-17. Status: approved by product owner, implemented locally.

## Approved business contract

The product owner requested: “Cho phép xóa dữ liệu do chính họ tạo” and
“Sửa cả lỗi nút xóa ở cá nhân”. Organization members may delete their own
business records. Personal workspace owners must not lose Delete merely because
their workspace persona is `employee`.

This extends the former manager-only deletion rule for plans, packages,
contracts, investors, contractors, experts, and opening records. The first
server `sync.record_created` audit for the original lineage identifies its
creator. A later snapshot must also have its own immutable creation audit
confirming that original lineage; a mutable `rootId` is not sufficient evidence.
Editing, assignment, and creating a later version do not transfer
creator status. Unknown legacy creators remain manager-only; never infer
ownership from a client field or the currently assigned employee.

Existing module edit access, active membership, exact-snapshot assignment,
record authorization, tenant/session isolation, history restrictions, row
versions, references, archive/cascade behavior, audit, and canonical confirmation
remain required. This is an exception to the deletion role gate, not a new read
grant or exemption from access revocation. Manager behavior is unchanged.
Package opening rows in an explicit deletion of a creator-owned package follow
the existing package aggregate deletion, still subject to record write checks.
Standalone assignment/permission deletion receives no new creator exception.

## Browser and compatibility

Authorized sync, pagination, and exact-record responses add `deleteOwnerUserId`
containing the current user's ID when creator evidence exists (or for their own
personal workspace), otherwise null. This is an identity-bound UI hint, not
authority; writes do not persist it and deletion independently queries the audit.
No existing field or read permission is removed or masked.

Row Delete uses that hint for employees, and the personal scope check. Bulk
Delete is available regardless of employee role because a selection can span
unloaded pages; all rows are checked server-side, and an unauthorized row rolls
back the whole batch. No automatic partial deletion is introduced.

## Migration / rollback

No column migration or creator backfill. Schema initialization adds the
idempotent partial index `idx_audit_log_record_creator` to avoid scanning the
organization's full audit history on list reads. Existing immutable creation
audits apply immediately, including for roots no longer physically present.
Records without that evidence require a manager; do not fabricate history.
Deploy backend and frontend together and refresh/sync cached lists to obtain
the new hints. Older clients remain compatible but may hide the new actions.
Rollback both code changes; no business data conversion is required. The
additive index can remain during rollback.

## Regression evidence

Creator-delete tests cover own/other/mixed ownership, forged claims, revoked
write access and transaction rollback using isolated SQL fixtures. UI tests
cover personal owners, identity-bound hints, organization managers, bulk
preparation and rendered list buttons. Existing delete/reference/version tests
remain required. Local tests are not a production deployment claim.

CI compatibility regressions also cover exact opening-record reads with missing,
own, and other-user creation evidence. The auth/roles E2E must omit the read-only
`deleteOwnerUserId` from updates, allow deletion of an employee-created record,
deny deletion of a manager-created record, and deny creator deletion after module
edit access is revoked. These checks implement the approved contract above;
they do not restore the former blanket employee-delete denial.
