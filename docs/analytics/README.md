# Product Analytics & Commercial Intelligence

## Mục tiêu và phạm vi

Hệ thống cung cấp số liệu first-party cho Super Admin để đánh giá activation, feature adoption, seat/quota fit, funnel, retention, cost và contribution margin. Analytics chỉ hỗ trợ ra quyết định; không tự đổi giá, SKU, quota, subscription, entitlement, role hoặc quyền đọc dữ liệu.

Ưu tiên kiến trúc:

```text
transaction facts + allowlisted UI events
                 ↓
       scheduled aggregation
                 ↓
 daily / weekly / monthly facts
                 ↓
 bounded Super Admin API
                 ↓
 lazy-loaded analytics workspace
```

Business timezone là `Asia/Ho_Chi_Minh`. Timestamp nguồn lưu UTC; daily grain là ngày lịch Việt Nam `[00:00, 24:00)`.

## Existing Data Inventory

| Source | Fields used | Metrics produced | New instrumentation required? |
| --- | --- | --- | --- |
| `product_usage_hourly` | window, Hệ thống hiện lưu user/workspace, owner type, metric/feature key, count, first/last seen | MAS, MAW, power-seat days, feature adoption/frequency, Word exports, first meaningful feature use | Mở rộng taxonomy; không tạo SDK mới |
| `nhat_ky_thuc_hien` | workspace, actor, action, occurred_at | workflow volume/depth, first value, active seat/workspace | Không; đây là success ledger hiện hữu |
| `tai_khoan`, `to_chuc`, `thanh_vien_to_chuc` | created/verified/status, workspace membership | signup/verification, registered seats, owner type, seat distribution | Không |
| `commercial_releases`, `billing_plan_versions`, `billing_skus`, `billing_prices` | release/mode, plan tier/variant/quota, SKU type/quantity, immutable price | release filter, plan/variant/size dimensions, current tier overlays | Không |
| `billing_quotes`, `billing_orders`, `billing_order_items` | owner, operation, release, totals, checkout/payment/activation states, created/updated | quote/checkout/activation funnel, plan/pack mix, paid workspace | Không cho các state server biết; pricing UI intent cần event tối thiểu |
| `payment_transactions`, `billing_refund_intents` | type/status, paid/fee/net amounts, provider time | gross/net revenue, payment fee, refunds, contribution margin | Không |
| `organization_subscriptions`, `account_subscriptions` | owner, plan version, status, start/expiry, member quota | paid workspace, new paid, seat utilization, paid TTFV | Không |
| `usage_credit_grants` | owner, source, total/remaining/reserved, release, issue/expiry | included/purchased/unused/expired credits, quota utilization | Không |
| `usage_reservations`, `usage_ledger` | exact source revision, reservation state, ledger entry/quantity/time | attempted/reserved/consumed/released and unique billable fetches | Không |
| procurement lookup service metrics/raw snapshot | cache layer, outcome, committed snapshots | cache hits, failures/cancellations where persisted | Chưa có durable daily outcome cho mọi attempt; xem Gap Analysis |
| `document_jobs` và `word_export.completed` | operation/status/completed time, hourly successful export fact | document workload and completed export count | Không |
| `ai_usage_daily`, `ai_feedback` | requests, tokens, tool calls, estimated cost, structured rating/category | AI adoption/cost/feedback quality | Không dùng message/comment content |

## Analytics Gap Analysis

Gap analysis này là cổng bắt buộc trước migration.

| Câu hỏi/gap | Dữ liệu hiện có | Thiếu | Quyết định instrumentation |
| --- | --- | --- | --- |
| Pricing page → offer intent | Quote chỉ xuất hiện sau khi user đã chọn offer | pricing viewed, size selected, variant compared, offer selected | Bổ sung raw commercial UI event allowlist, không nhận metadata tùy ý |
| Upgrade/quota intent | Có subscription và credit facts | prompt shown/clicked, top-up click, cancel/downgrade intent | Cùng allowlisted event endpoint; optional, best-effort |
| Dashboard nhanh | Transaction facts đầy đủ nhưng JOIN trực tiếp sẽ nặng | daily/weekly/monthly read models | Bổ sung aggregate tables và idempotent refresh job |
| Stable cross-table analytics ID | Các fact hiện dùng raw owner/user ID | aggregate/dashboard không cần ID gốc | HMAC-SHA256 bằng key riêng; raw commercial UI event chỉ lưu pseudonym |
| Procurement attempts/cache/failure | Consume/reserve/release authoritative; cache layer có process metric | toàn bộ attempt/cache/failure chưa durable ở mọi seam | V1 báo số authoritative từ ledger; trường chưa đo chính xác được ghi `dataQuality=partial`, không suy đoán |
| Document variable cost | Có duration/status nhưng chưa có approved unit-cost policy | chi phí worker/storage/bandwidth thực tế | Aggregate hỗ trợ cost source; hiển thị Estimated hoặc Not configured, không giả accounting actual |
| AI variable cost | `estimated_cost` có sẵn | đơn vị/FX cần owner xác nhận nếu dùng VND | Chỉ quy đổi khi `ANALYTICS_AI_COST_VND_MULTIPLIER` được cấu hình; nếu không thì cost VND là Not configured; không đọc message content |
| Retention correlation | meaningful actions và paid state có thể tạo cohort | causal proof | Tính association mô tả khi cohort đủ lớn; UI luôn ghi correlation không chứng minh quan hệ nhân quả |
| Acquisition source | Không có first-party source đã được duyệt | breakdown theo source | Không thu thêm trong v1 |
| Free-text commercial feedback | Chưa có | prompt cho phép optional text nhưng không có nhu cầu quyết định bắt buộc | V1 chỉ nhận reason allowlist và từ chối free text để giảm thu thập nội dung; không dùng cho automation/personalized pricing |

## Dashboard Information Architecture

Khu vực hiện hữu `/phan-tich-su-dung` được mở rộng thành Analytics / Commercial Intelligence để giữ route shell và code-splitting hiện tại. State filter được phản ánh vào URL query.

| View | Primary decision |
| --- | --- |
| Overview | Commercial health trong 30 giây |
| Activation | Bottleneck signup → first/paid value |
| Features | Feature adoption và association với retention/conversion |
| Seats | Mốc 1/5/15/50 có khớp team thực tế |
| Procurement | Included quota và cost/fetch pattern |
| Credits | Pack 20/100/500/2000 và repeat-top-up pattern |
| Funnel | Pricing → quote → payment → activation → first paid value |
| Retention | W1/W2/W4/W8/W12 meaningful-action cohorts |
| Economics | Revenue, refunds, variable cost, contribution margin |
| Plan fit | UNDER/GOOD/OVER/CONNECTED/TOPUP/ENTERPRISE evidence |

Mỗi view theo thứ tự: global filters → KPI → main trend → distribution/cohort → segment comparison → bounded table → metric help. Cohort `<10` bị suppress; pricing recommendation ưu tiên sample `>=20`.

## Implementation plan theo file/module

- `backend/db/schema.py`, `backend/db/upgrades.py`, `backend/db/postgres_schema.py`: additive v84–v87 tables, columns, constraints và indexes.
- `backend/product_analytics/taxonomy.py`: event/feature/cost/plan-fit registries.
- `backend/product_analytics/privacy.py`: HMAC IDs và export-safe utilities.
- `backend/product_analytics/events.py`: strict event validation/idempotent writer.
- `backend/product_analytics/aggregation.py`: batch refresh daily/weekly/monthly facts từ authoritative sources.
- `backend/product_analytics/query_service.py`: bounded/filterable aggregate-only dashboard reads, small-cohort suppression.
- `backend/product_analytics/routes.py`: Super Admin aggregate API, refresh API và event collector.
- `scripts/refresh_product_analytics.py`: scheduler/diagnostics/retention command.
- `frontend/admin/ProductAnalyticsView.js` và CSS: lazy dashboard workspace, URL filters, formatters và accessible chart/table fallback.
- `views/tabs/tab_usage_analytics.html`: semantic shell/loading/error/empty regions.
- `frontend/commercial-policy/CommercialStorefront.js`: minimal approved funnel events only.
- `tests/test_product_analytics.py`, `tests/test_product_analytics_migration.py`, `tests/test_product_analytics_e2e.py`, `tests/js/product_analytics.test.mjs`: contract, real PostgreSQL/API migration, frontend seams và backend-backed browser journey.

## Rollout

1. Schema + authoritative facts, collector disabled if `ANALYTICS_HMAC_KEY` is absent.
2. Hidden Super Admin dashboard; dùng fixture test cô lập, không tạo fake production data.
3. Minimal frontend events behind server availability; failures remain fail-open.
4. Compare transaction facts with aggregates for 1–2 weeks.
5. Observe 60–90 days before a pricing revision.

Không có bảng/event mới nào được dùng để thay đổi quyền hoặc hiển thị dữ liệu nghiệp vụ hiện hữu.
