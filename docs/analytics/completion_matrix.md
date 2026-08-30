# Product Analytics Definition-of-Done matrix

This matrix is the authoritative, requirement-by-requirement completion record for
`docs/CODEX_PROMPT_PRODUCT_ANALYTICS_PRICING_DASHBOARD.md`. A row is marked **Done**
only when both implementation and regression evidence exist. **Partial** means the
available first-party facts support only part of the requested decision. **Gap** is
intentional when the repository has no authoritative historical fact; the system
must report that fact as unavailable rather than manufacture it.

The analytics implementation does not change prices, SKUs, quotas, entitlements,
payment policy, record visibility, or authorization semantics.

| Requirement | Status | Authoritative implementation | Verification / remaining evidence |
|---|---|---|---|
| Repository inventory and Analytics Gap Analysis | Done | `docs/analytics/README.md`, `docs/analytics/implementation_report.md` | Inventory identifies existing transaction facts and explicit gaps. |
| Metric dictionary and official First Value definition | Done | `docs/analytics/product_analytics_dictionary.md` | Dictionary records formula, grain, dimensions, exclusions, privacy, and owner. |
| Allowlisted meaningful-action taxonomy | Done | `backend/product_analytics/taxonomy.py` | `tests/test_product_analytics.py` rejects unknown/client-authoritative keys. |
| Minimal UI commercial events | Done | `backend/product_analytics/events.py`, `frontend/commercial-policy/CommercialStorefront.js` | Strict payload, idempotency, sensitive-field rejection, and best-effort tests. |
| Immutable commercial release attribution | Done | event constraint plus billing/catalog joins in `aggregation.py` | Unknown historical release remains unavailable; no retroactive attribution. |
| Aggregate read layer | Done | v88 canonical daily/weekly/monthly tables, exact range-funnel workspace/timing facts and `refresh_product_analytics` | Fresh install, v1→v88 and adjacent migration, uniqueness, checks, FK and exact cross-day distinct-workspace tests. |
| Unified variable-cost ledger | Partial | `cost_usage_daily.cost_status`; payment fee, AI and document quantity sources | Configured zero is distinguishable from Not configured. AI VND conversion requires approved configuration. Procurement/storage/bandwidth/provider rates remain unavailable until approved. |
| HMAC pseudonymization | Done | `privacy.py` | Stable, namespaced HMAC test; raw IDs are not returned by dashboard APIs. |
| Small-cohort suppression | Done | `query_service.suppress_small_cohorts` | `<10` suppression and `<20` pricing recommendation tests. |
| Super Admin authorization | Done | `routes.py` | Server-side denial occurs before dashboard query; route remains inside existing Super Admin surface. |
| Global filters and shareable URL | Done | `ProductAnalyticsView.js`, `query_service.py` | Inclusive date range bounded to 366 days; release/owner/plan/variant/size/paid-state filters. |
| Executive overview | Done with configured-cost disclosure | 14 KPIs, latest rolling-30-day snapshot semantics, previous comparable-period deltas, six chart read models and fixed-threshold insights | Directionality is metric-specific; D30 paid-retention proxy is suppressed below 10; missing cost facts remain Not configured rather than measured zero. |
| Activation funnel and TTFV | Done with historical coverage disclosure | `workspace_activation_facts`, activation API and dashboard-specific detail panel | Exact median/P75/P90 TTFV, never-activated, D1/D7/D30, explicit D7/D30 funnel stages and personal/organization/acquisition-week/first-feature breakdown. Verification percentiles use only observed timestamps. |
| Feature adoption | Done with cohort suppression | `workspace_feature_daily`, `workspace_feature_user_daily`, feature API table | Denominator is selected-range active workspaces; active users, usage frequency and median usage/workspace are aggregate facts. Retention/paid comparisons are descriptive and non-causal. |
| Seat distribution and tier sizing | Done | exact seat bins, overall seat utilization, percentile helper, tier table and markers in `query_service.py` | Bins are `1, 2, 3–5, 6–10, 11–15, 16–25, 26–50, >50`; P10/P25/P50/P60/P75/P80/P90/P95/P99/Max and 1/5/15/50 markers are returned. |
| Procurement economics | Done with cache/rate gaps | reserve/consume/release/failure aggregates, unique billable fetch alias and percentile/utilization response | Quantity remains observable while external cost is Not configured unless an approved cost fact exists. Cache hits remain `not_available` because no durable authoritative fact exists. |
| Credit-pack analysis | Done with catalog gap | `credit_pack_purchase_daily`, purchased/consumed/unused/expired totals, pack mix, repeat intervals, attach rate and 45-day signal | Expired unused purchase-grant balance is attributed to its expiry day. Upgrade-equivalent spend remains unavailable without authoritative workspace price-gap attribution. |
| Commercial funnel | Done with sample disclosure | ordered workspace facts retain first/last timestamps; stage conversion/abandonment, median step timing and Paid TTFV | Negative/out-of-order durations are excluded. Stage timing is suppressed below 10 ordered journeys; payment/activation/refund facts are server-derived. |
| Retention cohorts | Done with maturation disclosure | signup/first-value/paid-activation weekly cohorts, segment key and mature-week filter | W1/W2/W4/W8/W12 plus segment filters are returned; only cohorts with an observed week are emitted and `<10` is suppressed. |
| Cost and margin | Done with estimated-cost disclosure | economics unit metrics, margin %, tier table and payment/AI/document cost sources | Cost/workspace, active seat, successful fetch, AI-active workspace and payment-fee rate are returned. Provider/storage/bandwidth rates remain explicitly unconfigured. |
| Plan Fit Intelligence | Done with attribution gap | v1 monthly classifier, detailed dimensions, repeat-topup evidence and analytical table | No subscription mutation. Connected break-even and workspace revenue remain `not_available` unless catalog and authoritative attribution can be joined safely. |
| AI analytics | Done with configured-cost disclosure | usage, requests/AI-active workspace, tokens, tool calls, configured estimated cost, structured feedback and descriptive retention/paid-conversion associations | Associations are suppressed below 10 and explicitly non-causal; absent approved VND cost stays Not configured. |
| Optional commercial feedback | Partial by deliberate data-minimization choice | `/api/commercial-analytics/feedback`, storefront optional reason form, `commercial_feedback` | Fixed moments/reasons are implemented. The prompt's optional free-text field is deliberately not accepted or persisted; best-effort writes cannot block checkout. |
| Loading/error/empty states | Done | Product Analytics view | JS tests cover all three states. |
| Accessibility and responsive layout | Done for delivered views | semantic headings, live states, labelled charts, keyboard-focusable bars, bounded tables, 390 px layout | Browser test covers responsive shell, navigation, loading/error/empty and table fallback. |
| Bounded aggregate-only API and code splitting | Done | `query_service.py`, lazy import in `UsageAnalyticsView.js` | Secure build records a separate Product Analytics chunk. |
| Data retention and quality | Done | maintenance script, `quality.py`, privacy/retention docs | Tests cover negative values, unknown keys, duplicates, future times and missing releases. |
| Deterministic demo data | Done (opt-in) | `scripts/seed_product_analytics_demo.py` | Requires existing release and `--confirm-dev-seed`; refuses production; inserts synthetic aggregate facts only and never runs automatically. |
| Backend/database/frontend regression suite | Done for implemented scope | Product analytics Python/JS suites and schema contract | Complete regression runs pass 2,072/2,072 Python and 1,552/1,552 JavaScript tests; static, security and secure-build checks also pass. |
| Analytics E2E journey | Done | Real temporary PostgreSQL schema + refresh job + Starlette analytics route + browser UI | Covers Overview, date/release filters, Seats, Procurement, Retention, Plan Fit, direct non-Super-Admin denial, empty state and 390 px overflow. |
| Production-volume latency evidence | Gap | API is bounded/indexed and payload is compact | P50/P95 must be measured against representative production-scale data; no fabricated benchmark. |
| Documentation, rollout, decision playbook | Done | `docs/analytics/` | Includes privacy, retention, staged rollout, observation windows and pricing decision thresholds. |

## Evidence policy

- A missing historical timestamp or cost rate is represented as `not_available` or
  `not_configured`, never as zero when zero would imply a measured fact.
- Correlation outputs must state that correlation does not imply causation and are
  suppressed below the cohort threshold.
- Analytics failures remain off the request-critical path.
- Aggregate analytics is separate from support drill-down; no raw identity is exposed.
