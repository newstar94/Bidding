# ADR: Cross-application Admin seam for Chuẩn Hóa

Status: accepted for the integration seam, bounded production reads, and the
idempotent entitlement-extension command

## Decision

BiddingFlow remains the only browser-facing Admin console. It calls a
server-to-server Chuẩn Hóa endpoint using a configured client id, timestamp,
nonce and HMAC-SHA256 signature. The shared secret is read only from server
configuration and is never rendered, bundled or logged.

Only explicitly mapped Bidding Super Admin user ids may use the integration.
An organization/workspace admin is not sufficient. Missing mapping returns
CHUAN_HOA_ADMIN_NOT_MAPPED; missing or invalid upstream configuration is
reported as unavailable. The client has a bounded timeout and no blind retry.

Chuẩn Hóa remains authoritative for its accounts, offers, payments, activation
and leases. The capabilities endpoint and bounded account/offer/order read
endpoints use production PostgreSQL stores. They must not be replaced by the
Development Admin store or fabricated data. Subscription, payment-event and
entitlement reads are proxied with bounded pagination. The only enabled
mutation is entitlement extension, implemented by the Chuẩn Hóa production
store with idempotency and audit; payment creation, webhook simulation and
lease refresh remain application-owned workflows.

## Compatibility and rollback

The feature is additive and disabled unless all server configuration is
present and `CHUAN_HOA_ADMIN_ENABLED=true`. Chuẩn Hóa can independently revoke
the client by setting `ChuanHoa:AdminIntegration:Enabled=false`. Existing Bidding admin routes and Chuẩn Hóa customer flows are
unchanged. Rollback is removing the additive route/UI/module and configuration;
no migration or data rewrite is required.

## Audit and idempotency

The integration authentication contract includes client identity, timestamp and
single-use nonce. Mutation endpoints must use the target application's existing
idempotency contract and record Bidding actor, target application, object,
action, result and correlation id in both audit systems. Entitlement extension
satisfies this contract; further payment or lease commands require separate
approval.
