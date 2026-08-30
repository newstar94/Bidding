# Product Analytics implementation report

## Phase reports

| Phase | Existing code reused | New code/schema | Privacy/security/performance impact | Tests / remaining risk |
| --- | --- | --- | --- | --- |
| 0–1 Audit + dictionary | PostgreSQL schema, usage/billing/credit/AI/document facts | Inventory, gap analysis, metric dictionary, IA | No runtime impact | Source facts audited; acquisition source remains unavailable |
| 2–4 Taxonomy + funnel + release | Existing usage rollup and immutable commercial releases | Strict feature/event registries, HMAC collector, release-pinned UI intent | No arbitrary JSON/PII; best-effort writes | Validation/idempotency tests pass; historical release is not guessed |
| 5–7 Aggregate + cost + pseudonyms | Usage hourly, activity ledger, payment/refund, subscription, credit ledger, AI, document jobs | v84–v87 read models, exact range-funnel timing, cost status, expired-credit facts and HMAC projections | Dashboard avoids transaction-table joins; configured zero differs from Not configured | Fresh install, v1→v87, adjacent upgrade, FK/index, cross-day uniqueness and aggregate smoke pass |
| 8–10 Dashboard + AI | Existing lazy Super Admin usage route | Ten-view workspace, URL filters, accessible fallback table, AI structured metrics | Super Admin server guard; small cohort suppression | Browser navigation/filter/empty/error/deny test passes; associations are descriptive, suppressed and explicitly non-causal |
| 11–14 Performance + QA + retention | Existing route code split, request limits and DB helpers | Bounded 366-day API, 30-second private cache, diagnostics and opt-in retention command | No cross-tenant cache; no billing/audit deletion | Secure build/static checks pass; no production-volume P50/P95 benchmark |
| 15–18 Tests, docs, rollout | Existing pytest/node/playwright/build toolchain | Migration/API/frontend tests plus a PostgreSQL-backed Starlette/browser journey and required docs | Staged rollout documented | Demo seed is deterministic, opt-in and test/dev-only; observe real facts for 60–90 days |

## Delivered architecture

```text
authoritative facts + strict UI intent inbox
                    ↓
scripts/refresh_product_analytics.py
                    ↓
daily usage/seat/feature/subscription/funnel/revenue/cost
weekly retention + monthly plan fit
                    ↓
Super Admin aggregate-only API
                    ↓
lazy ProductAnalyticsView
```

API routes:

- `POST /api/commercial-analytics/events`
- `POST /api/commercial-analytics/feedback`
- `GET /api/admin/product-analytics/dashboard`
- `POST /api/admin/product-analytics/refresh`

## Schema v84/v85/v86/v87/v88

Tables: `commercial_analytics_events`, `workspace_usage_daily`,
`workspace_feature_daily`, `workspace_seat_daily`,
`subscription_snapshot_daily`, `commercial_funnel_daily`, `revenue_daily`,
`cost_usage_daily`, `retention_cohort_weekly`, `plan_fit_monthly`,
`workspace_activation_facts`, `credit_pack_purchase_daily`,
`workspace_feature_user_daily`, and `commercial_feedback`. v85 also adds
`registration_verified_at` for future exact verification timing; older verified
accounts are marked `historical_timestamp_unavailable` rather than backfilled.
v86 adds `commercial_funnel_workspace_daily`, an HMAC-keyed daily aggregate fact
that supports exact `COUNT(DISTINCT analytics_workspace_id)` across a selected
range without querying raw commercial events or double-counting daily uniques.
v87 adds first/last funnel occurrence timestamps, explicit cost availability,
and expired unused purchased-credit facts. Funnel timing is computed only from
these pseudonymous aggregates; out-of-order journeys are excluded and samples
below 10 are suppressed. Unconfigured AI/document cost quantities no longer
appear as measured zero, while a configured zero rate remains `available`.
v88 is an append-only reconciliation step for development installations that
recorded a pre-release analytics version before every canonical table/column was
present; it replays the idempotent v84–v87 seams and converges them with fresh installs.

All daily/monthly grains have primary keys; release foreign keys have child-side
indexes; PostgreSQL normalized schema contract contains 144 tables, 648 indexes
and 104 triggers. The migration is additive and does not modify authorization,
entitlements, pricing, SKU or quota semantics.

## Verification evidence

The current verification database was initialized from an empty PostgreSQL
temporary schemas at v88 and converged to the generated contract:

```text
PostgreSQL schema initialized successfully (version 88)
PostgreSQL normalized schema contract matches (144 tables, 648 indexes, 104 triggers)
FK audit: 213 foreign keys, missing=[]
```

The focused migration-chain contract and every-view backend route tests pass.
The Product Analytics unit suite passes 21/21 Python tests and the frontend suite
passes 3/3 JavaScript tests. A real PostgreSQL + refresh + Starlette + browser E2E
journey provides route/UI evidence. Complete regression runs pass 2,072/2,072
Python and 1,552/1,552 JavaScript tests against schema v88.
npm run check:static: passed
npm run lint:security: passed
npm run build:secure: passed

Current secure-build artifact sizes (not a before/after benchmark):

- main JS: 150.18 kB raw / 48.83 kB gzip;
- lazy `ProductAnalyticsView`: 39.15 kB raw / 11.55 kB gzip;
- lazy Usage Analytics CSS: 21.70 kB raw / 3.99 kB gzip;
- main CSS: 332.04 kB raw / 57.60 kB gzip.

No production-volume API P50/P95 or before/after bundle baseline was measured;
the report does not infer one from the empty local test database.

## Known data gaps

- Durable procurement cache-hit/non-billable-attempt facts do not exist at every
  source seam. The dashboard marks attempts as billable-ledger-only and cache
  hits as unavailable.
- Historical subscription release/plan attribution is only used where the
  current stored subscription interval provides evidence; history is never
  backfilled by guessing.
- AI VND cost is not configured until Finance approves and configures
  `ANALYTICS_AI_COST_VND_MULTIPLIER`.
- Document/storage/bandwidth/provider unit costs are not configured; quantity
  can be observed without pretending it is an accounting actual.
- Workspace-level revenue cannot be reconstructed from the aggregate revenue
  table without retaining a new financial identifier. Plan-fit revenue is
  therefore explicitly marked not attributable rather than evenly allocated.
- Signup, first-value and paid-activation cohorts, exact TTFV percentiles,
  funnel stage timing, descriptive feature associations and repeat-pack 45-day
  signals are available. Timing coverage remains sample-dependent and is never
  inferred for historical rows without timestamps.
- Connected break-even and upgrade-equivalent top-up spend remain unavailable
  without authoritative workspace-level catalog/revenue attribution.
- Acquisition source is unavailable for historical rows. Optional commercial
  feedback uses fixed moments/reasons only. The prompt's optional free-text
  field is deliberately omitted for data minimization and is not claimed as an
  exact implementation of that optional item.
- Production-volume API P50/P95 still requires representative production-scale
  data and is not inferred from the local verification database.

## Observation and decision policy

Run the refresh/diagnostic job on a schedule, reconcile source and aggregate
counts for 1–2 weeks, then observe 60–90 days before revising pricing. Small
cohorts below 10 workspaces are suppressed; plan-fit recommendations prefer 20
or more workspaces. No classification automatically changes a subscription.
