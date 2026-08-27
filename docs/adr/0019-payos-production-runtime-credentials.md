# ADR 0019 — payOS production runtime credentials

- Status: Accepted
- Date: 2026-08-26

## Decision

BiddingFlow uses the official payOS Payment Request production API through the
existing provider adapter. The application composition root installs a
process-local credential resolver backed by `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`,
and `PAYOS_CHECKSUM_KEY`. Secret values are never persisted in the commercial
catalog, provider profile, API response, frontend state, log, or audit metadata.

The immutable database profile `provider-payos-production-v2` stores only the
non-secret reference `env://payos/default`. Startup permits real payment traffic
only when all of the following match:

1. `COMMERCIAL_PAYMENT_PROVIDER=payos`;
2. `PAYMENT_PROVIDER_ENVIRONMENT=production`;
3. the three process-local credentials and the configured reference are
   present;
4. the selected database profile is payOS, production, `live`, `ready`, and
   pins the exact same reference;
5. the merchant/webhook gates are confirmed, plus the existing production
   legal gate when running in production.

The payOS redirect URLs update browser UX only. They never verify a payment or
activate a subscription. A signed webhook is persisted first; the billing
worker then queries payOS using the order's pinned profile and applies only a
matching authoritative paid result through the existing exactly-once
activation seam.

## Compatibility impact

- No role, permission, tenant, assignment, record scope, masking, or record
  visibility behavior changes.
- Existing fake-provider development flows remain available and payment flags
  remain off by default.
- Existing payOS v1 metadata remains immutable and blocked. New orders use v2
  only after operators explicitly enable payOS and the payment flags.
- Existing orders remain pinned to their original provider profile.
- payOS has no separate sandbox in its public contract; automated tests keep
  using the fake provider and deterministic transports.

## Migration and rollback

Migration v80 inserts the v2 profile without secret material. The new runtime
requires schema v80 so a deployment cannot accidentally run without that
immutable reference. Configure the environment, register and verify the
webhook, then restart so startup validates the complete chain.

Rollback disables new checkout with `PAYMENT_CHECKOUT_ENABLED=false` while
keeping `PAYMENT_ACTIVATION_ENABLED=true` long enough to receive webhooks and
reconcile already-created orders. Do not delete provider profiles, orders,
webhook evidence, payment transactions, or activation ledgers.

## Regression seams

- official create/webhook signature vectors and signed response verification;
- exact HTTPS payOS host validation and fixed production API origin;
- environment resolver reference binding and missing-secret failure without
  secret disclosure;
- live/ready production DB profile/reference matching before readiness;
- redirect endpoints remain non-authoritative;
- webhook/query duplicate and mismatch handling remains exactly once.
