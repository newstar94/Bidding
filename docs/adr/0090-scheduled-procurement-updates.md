# ADR 0090: Twice-daily HSMT clarification and petition alerts

Date: 2026-10-17. Status: product-owner approved; local implementation.

Partially superseded on 2026-10-20 by
[ADR 0091](0091-auto-write-hsmt-clarifications.md): for HSMT clarification
requests and responses only, new content detected by a scheduled check is now
appended to the package record. The no-import/no-overwrite rule below still
applies to petitions and to every other package, plan and HSMT field.

## Approved business contract

Automatically check HSMT clarifications and petitions at 08:30 and 14:30 every
day in Asia/Ho_Chi_Minh. Include current, unarchived packages from INVITED,
OPENED and EVALUATING through PARTIALLY_AWARDED and AWARDED, under their current,
unarchived plan. Exclude PREPARING, UNKNOWN and CANCELLED packages.

For fully AWARDED packages, stop when the stored result decision date is more
than ten Vietnam calendar days old; day ten remains eligible. Missing dates do
not establish expiry and are not replaced with an invented date. Partial awards
remain eligible until the full result. No saved package/plan/HSMT fields are
automatically imported or overwritten by monitoring.

The owner clarified that baseline capture must happen when monitoring starts,
not be deferred to the first scheduled check. The worker therefore initializes
newly eligible notices on its next polling pass (normally within 30 seconds),
including before 08:30. This one-time initialization is silent; a successfully
observed empty array is a real baseline, not an unknown/uninitialized state.
Every scheduled check compares against that baseline, including the first
scheduled check: previously empty -> new content must generate email.
If a notice is first discovered after a daily slot, the existing same-day
catch-up path initializes it immediately instead of waiting for the next slot.
Without any successful prior observation, existing content still cannot be
classified as new and is initialized silently, never inferred empty from errors.

Only new information relative to an established baseline generates email. New questions,
answers/resolutions and previously unseen updated content qualify. Previously
seen content, list reordering, removals and reappearance do not generate email.
Clarifications on earlier revisions of the same notice remain monitored, so a
later answer to an old question is not missed.

## Recipients and compatibility impact

Notify active organization managers/owner and active members assigned to the
exact current package, after checking existing module and record-read policy.
Membership, account state, tenant isolation and exact-snapshot assignments are
unchanged. A personal package notifies its personal owner only. An owner with
no existing read grant receives no new grant from this feature. Deduplicate
recipients who are both manager and assignee. No extra read role/capability or
data masking is introduced. Source names/URLs and raw source contents are not
included in email; the email contains the package identity, category/count and
an application link. Normal authenticated record access remains required.

The existing notification center additionally receives `procurement_update`
items from the same transaction as the encrypted email outbox. Existing
notification kinds and APIs remain compatible; no new public source endpoint.
Session validation on the application link is unchanged; background jobs do
not fabricate user sessions.

## Durability and failure semantics

Backend-owned cancellable worker, independent of a user's open browser. Poll
every 30 seconds when idle and drain one package at a time. Catch up only the
latest elapsed slot of the current Vietnam day after downtime, without replaying
older days. The server must be running to execute a slot. Work may complete
after its scheduled start because requests are serialized and bounded upstream.
Before 08:30, only missing category baselines are collected; known baselines are
not re-read/reset and new content in known categories is not consumed during a
retry for a different unavailable category. A category whose initialization
fails does not block scheduled notifications for categories already initialized.
The Vietnam midnight epoch is an initialization retry bucket only, not an extra
notification schedule. It does not consume the later 08:30/14:30 check slots.

State is keyed by tenant, package lineage and notice number, preserving the
baseline across physical package versions. Atomic PostgreSQL claims, lease
tokens and fencing prevent concurrent owners from publishing the same changes.
Network work occurs outside transactions. Recheck current package eligibility
and current recipients before atomically committing hashes, notifications and
encrypted outbox entries. Retries preserve successful category baselines; failed
or unknown source schemas never become authoritative empty results. Up to three
attempts per slot, five/ten-minute retry delays; later slots retry failures.
Missing email encryption configuration, absent eligible recipients or a failed
outbox transaction do not consume unseen content. SMTP retries/status remain
owned by the existing email delivery worker; queued does not mean delivered.

Only content hashes are persisted in monitor state. Clarifications reuse the
existing validated parser. Petition parsing accepts the observed
`biduPetitionContractorVersionDTOList` / `biduPetitionResolutionList` envelope,
or explicit business-row arrays; null/error/unknown envelopes stay retryable.
The observed live petition envelope was empty; populated request/resolution
rows are content-fingerprinted without assuming unobserved inner field names.

## Migration and rollback

Schema v101 adds `procurement_monitor_state` and extends the notification-kind
check constraint without rewriting existing business records or notifications.
It also idempotently materializes ADR 0089's existing canonical creator-audit
index, which had previously been added without its own numbered upgrade.
The runtime requires schema v101. Apply the normal database migration before
starting the new runtime in production; no live schema upgrade or deployment is
part of local implementation. The committed normalized PostgreSQL catalog is
regenerated transactionally and historical migration fixtures remain unchanged.
The clarified early-baseline behavior needs no additional schema migration or
backfill: preserve all existing `seen_json` hashes, including empty arrays and
pending unseen content. Existing successful baselines are never reset on deploy,
restart, date change or physical package-version change. Only categories lacking
an authoritative baseline are initialized; do not fabricate pre-install history.

Enabled by default when procurement lookup is enabled. Set
`PROCUREMENT_MONITOR_ENABLED=false` to stop new checks without deleting state or
changing manual lookup. Existing queued email remains managed by the email
worker. Do not downgrade/drop tables or reset baselines automatically; roll back
the runtime using the supported schema compatibility process. SMTP and
EMAIL_OUTBOX_ENCRYPTION_KEY must be configured for actual email delivery.

## Verification

Unit regressions cover Vietnam slots, day-ten/day-eleven cutoff, source failures,
silent first baseline, new questions/answers, known petition envelope and dedup.
JavaScript transport tests cover fresh revision selection, narrow source reads
and independent category failures. Real PostgreSQL TEMP-table tests exercise
leases/fencing, transactional email outbox publication, rollback/retry, exact
recipient permissions, personal ownership and physical version changes. No
real emails are sent by tests. Local/live-read evidence does not establish SMTP
delivery or production deployment.

Local verification: 138 focused backend tests, 16 catalog unit tests, three
isolated migration/fresh-install tests and 50 JavaScript regressions passed.
The migration tests include replay from v1, v99 checkout preservation and fresh
v101 catalog equivalence. Concurrent independent connections publish only once.
`npm run check:static` and `npm run build:secure` passed (174 protected bundles).
The existing local database still reports v100: directly comparing that
unmigrated database with the new catalog correctly fails. A complete v100-to-v101
migration and catalog assertion passed in dry-run and was rolled back; no live
schema migration, backend restart or SMTP delivery was performed.

Early-baseline clarification verification: 100 focused monitor, PostgreSQL,
application-lifespan and notification regressions passed. Coverage includes an
empty 07:00 baseline followed by new content at the first 08:30 check, silent
initial existing content, restart preservation, independent category retries,
bounded initialization failures, immediate initialization after a daily slot,
and concurrent independent connections before/during the scheduled slot.
`npm run check:static`, `python scripts/check_python_quality.py` and
`git diff --check` passed. The secure build above was not rerun for this
backend/test/documentation-only adjustment. No live migration, backend restart,
deployment, upstream request or real SMTP delivery was performed for this
clarification.

## Windows pilot deployment (2026-10-17)

Deployed to the existing Windows host, not a VPS production release. Created
and verified complete snapshot
`data/backups/biddingflow-backup-20261017T055047Z` (241 files, no retention
deletions). The v100-to-v101 transactional dry-run passed, then the live schema
upgrade completed at v101 and `assert_schema_contract` passed. PostgreSQL was
not restarted and existing application data was not reset.

Rebuilt the secure frontend (174 protected bundles), stopped only the verified
old backend PID 32408, and started the hidden `run_demo_server.ps1` supervisor
(PID 25612; backend PID 34264). Both app and database remain loopback-only.
Live/readiness checks return HTTP 200; HTML uses bundle mode, and served app,
admin and landing CSS bytes match the new on-disk artifact. Release identity:
`bf857da58265c9ce8c706a1b77f939295e5bcd58576db7f75dccb88d03db7262`.

The monitor is enabled and application startup completed successfully. SMTP
configuration and outbox encryption validation passed; no test email was sent
and provider acceptance/delivery is not established. There are currently zero
eligible-status package candidates, so no real monitor lookup/notification has
been exercised on this host. Keep Windows and the backend running for the
08:30/14:30 schedule; the supervisor is a current process, not a newly installed
Windows startup service.

Public-origin verification remains open: this host has no observed Cloudflared
process/service, while public probes receive Cloudflare Access/edge responses
(302/403), not an authenticated application response. No Tunnel/Access policy,
credentials, firewall, service installation or public exposure was changed.
