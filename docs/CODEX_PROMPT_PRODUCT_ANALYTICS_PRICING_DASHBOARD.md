# Codex Master Prompt — Xây dựng hệ thống Product Analytics & Pricing Intelligence cho BiddingFlow

Repository: `https://github.com/newstar94/Bidding`

## Vai trò

Bạn là **Principal Product Engineer + Data Architect + Staff Backend Engineer + Senior Frontend/Data Visualization Engineer**.

Nhiệm vụ của bạn là nghiên cứu kỹ repository hiện tại và **triển khai một hệ thống Product Analytics / Commercial Analytics / Pricing Intelligence first-party hoàn chỉnh**, phục vụ Super Admin phân tích hành vi sử dụng sản phẩm, chi phí phục vụ, conversion, retention và mức độ phù hợp của các gói trả phí.

Hệ thống phải bám sát kiến trúc hiện tại của BiddingFlow, không tạo một analytics stack tách rời không cần thiết.

---

# Yêu cầu đặc biệt về "skills"

Nếu môi trường Codex có các **skills** hoặc hướng dẫn chuyên môn cho:

- frontend design
- dashboard/data visualization
- PostgreSQL/database
- migrations
- backend architecture
- testing
- accessibility
- security/privacy
- performance
- product analytics

thì **phải đọc và áp dụng các skill liên quan trước khi triển khai**.

Đặc biệt:

1. Dùng skill thiết kế frontend/dashboard nếu có.
2. Dùng skill data visualization nếu có.
3. Dùng skill PostgreSQL/migration nếu có.
4. Dùng skill testing/quality nếu có.
5. Dùng skill security/privacy nếu có.

Không thiết kế dashboard theo kiểu "admin template" chung chung.

Dashboard phải:

- trực quan;
- có information hierarchy rõ;
- hỗ trợ phân tích nhanh;
- dễ đọc trên desktop;
- responsive hợp lý;
- accessible;
- không làm frontend nặng;
- không render hàng nghìn điểm dữ liệu không cần thiết.

---

# Mục tiêu kinh doanh

Hệ thống phải trả lời được ít nhất các câu hỏi:

1. Người dùng nào thực sự nhận được giá trị từ sản phẩm?
2. Quy mô team thực tế phân bố như thế nào?
3. Các mốc gói 1 / 5 / 15 / 50 user có phù hợp không?
4. Người dùng cần kết nối Mua Sắm Công với tần suất thế nào?
5. Included procurement quota hiện tại có quá thấp/quá cao không?
6. Credit pack 20 / 100 / 500 / 2.000 có phù hợp không?
7. Tính năng nào có tương quan mạnh với retention?
8. Tính năng nào thúc đẩy conversion trả phí?
9. Chi phí phục vụ từng nhóm khách hàng là bao nhiêu?
10. Margin từng gói là bao nhiêu?
11. Người dùng Internal khi nào nên nâng lên Connected?
12. Workspace nào đang dùng gói quá nhỏ?
13. Workspace nào đang mua gói quá lớn?
14. Có cần thêm tier >50 user / Enterprise không?
15. Có nên monetise AI trong tương lai không?
16. Có bottleneck nào trong checkout/payment/activation không?
17. Paid users có thực sự sử dụng tính năng trả phí sau khi mua không?

---

# Nguyên tắc tối quan trọng

## 1. Không thu thập dữ liệu vô tội vạ

Không xây hệ thống kiểu:

- track mọi click;
- track mouse movement;
- track từng scroll;
- track mọi API GET;
- session replay;
- thu raw browser fingerprint;
- lưu nội dung AI/document để định giá.

Chỉ thu thập sự kiện có ý nghĩa sản phẩm hoặc thương mại.

---

## 2. Privacy-by-design

Không sử dụng các dữ liệu sau để phân tích pricing cá nhân:

- email;
- họ tên;
- IP;
- full user-agent;
- device fingerprint;
- AI message content;
- document content;
- tender title;
- contractor/investor identity;
- địa chỉ;
- bất kỳ thuộc tính nhạy cảm hoặc inferred sensitive attribute nào.

Analytics phải tập trung vào:

- usage;
- workflow;
- seats;
- quota;
- feature adoption;
- conversion;
- retention;
- cost;
- revenue;
- margin.

---

## 3. Server-authoritative khi có thể

Các sự kiện sau phải lấy từ server/DB authoritative:

- payment verified;
- subscription activated;
- procurement credit consumed;
- procurement fetch succeeded;
- document export completed;
- AI usage;
- refund;
- plan activation;
- quota allocation.

Frontend không được tự khai báo các sự kiện authoritative này.

Frontend chỉ gửi những sự kiện server không thể biết chính xác, ví dụ:

- pricing page viewed;
- offer compared;
- CTA clicked;
- upgrade prompt shown/clicked;
- checkout cancelled by user.

---

## 4. Analytics không được ảnh hưởng request-critical path

Analytics failure **không được làm action chính của người dùng fail**.

Ví dụ:

- tạo gói thầu vẫn thành công dù analytics write lỗi;
- checkout vẫn hoạt động dù event collector lỗi;
- export vẫn hoàn thành dù analytics aggregator lỗi.

Ưu tiên:

- existing transaction facts;
- batch aggregation;
- outbox/background task nếu kiến trúc hiện tại phù hợp;
- idempotent writes.

---

## 5. Không query dashboard trực tiếp bằng các JOIN rất nặng trên transaction tables

Dashboard phải đọc từ:

- hourly fact;
- daily aggregate;
- weekly cohort;
- monthly plan-fit snapshot.

Không để Super Admin mở dashboard là quét toàn DB production.

---

# PHASE 0 — Audit repository trước khi code

Trước khi sửa code:

1. Đọc toàn bộ:
   - README;
   - `package.json`;
   - backend architecture;
   - frontend architecture;
   - DB schema;
   - migrations;
   - commercial policy;
   - billing/payment;
   - usage credits;
   - AI usage;
   - document jobs;
   - existing analytics;
   - Super Admin UI;
   - tests;
   - CI;
   - performance budgets.

2. Tìm và mô tả chính xác:
   - `product_usage_hourly`;
   - commercial release/version;
   - usage credit grants/ledger;
   - billing quote/order/payment;
   - document jobs;
   - AI daily usage;
   - existing analytics semantic registry;
   - account/session/organization/member model.

3. Lập bảng:

```text
Existing data source
Current fields
What question it can answer
What is missing
Whether new instrumentation is required
```

4. Không tạo table/event mới nếu dữ liệu hiện có đã trả lời được câu hỏi.

5. Chỉ bắt đầu migration sau khi viết ra `Analytics Gap Analysis`.

---

# PHASE 1 — Xây Data Dictionary chính thức

Tạo tài liệu:

`docs/analytics/product_analytics_dictionary.md`

Mỗi metric phải có:

```text
Metric name
Business definition
Formula
Source table(s)
Time grain
Dimensions
Exclusions
Privacy classification
Owner
Notes
```

---

# Định nghĩa bắt buộc

## Registered Seat

Một thành viên tồn tại trong workspace.

## Monthly Active Seat (MAS)

Một user duy nhất có ít nhất một **Meaningful Product Action** trong rolling 30 ngày.

Không tính heartbeat đơn thuần.

## Power Seat

Một active seat có meaningful actions trong >= 8 ngày của rolling 30 ngày.

## Monthly Active Workspace (MAW)

Workspace có ít nhất một meaningful action trong rolling 30 ngày.

## Monthly Active Procurement Workspace (MAPW)

Workspace có ít nhất một meaningful procurement/workflow action trong rolling 30 ngày.

Đây là ứng viên North Star Metric.

## First Value

Lần đầu workspace/user đạt một hành động nghiệp vụ có giá trị.

Ví dụ:

- tạo/import kế hoạch;
- tạo gói;
- fetch procurement source thành công;
- export tài liệu đầu tiên;
- milestone workflow quan trọng.

Phải xác định một definition chính thức sau khi đọc code hiện tại.

## Time To First Value (TTFV)

`first_value_at - account/workspace_created_at`

## Paid TTFV

`first_paid_value_at - subscription_activated_at`

## Seat Utilization

`monthly_active_seats / member_quota`

## Quota Utilization

`included_credits_consumed / included_credits_granted`

## Top-up Attach Rate

`paid workspaces purchasing >=1 credit pack / eligible paid workspaces`

## Contribution Margin

`net revenue - variable cost`

---

# PHASE 2 — Chuẩn hóa Meaningful Product Action taxonomy

Ưu tiên mở rộng cơ chế hiện có thay vì tạo SDK analytics mới.

Chuẩn hóa `feature_key`.

Gợi ý taxonomy ban đầu:

```text
planning.create
planning.import_excel
planning.update

package.create
package.issue
package.open
package.evaluate
package.award

contract.create
contract.update

procurement.lookup
procurement.fetch
procurement.import

contractor.lookup
contractor.violation_check

document.word_export
document.excel_export
document.award_export

collaboration.member_assign
collaboration.expert_assign

ai.request
ai.tool_call
```

Sau khi audit repository, điều chỉnh tên cho đúng domain thực tế.

## Yêu cầu

- `feature_key` phải allowlist.
- Không nhận arbitrary client string.
- Không lưu payload business raw.
- Tách `metric_key` và `feature_key` hợp lý.
- Có regression tests cho taxonomy.

---

# PHASE 3 — Commercial Funnel Instrumentation

Bổ sung event tối thiểu cần thiết cho phần frontend mà DB không tự biết.

Event allowlist:

```text
pricing.viewed
pricing.size_selected
pricing.variant_compared
pricing.offer_selected

upgrade.prompt_shown
upgrade.prompt_clicked

quota.warning_shown
quota.topup_clicked

checkout.started
checkout.cancelled

subscription.cancel_intent
downgrade.started
```

Không dùng generic event ingestion cho arbitrary JSON.

---

# Commercial event payload

Chỉ cho phép context cần thiết, ví dụ:

```json
{
  "event": "pricing.offer_selected",
  "ownerKind": "organization",
  "sizeBucket": "6_15",
  "skuCode": "example",
  "commercialReleaseId": "release-id",
  "source": "pricing_page",
  "occurredAt": "server-or-normalized-time"
}
```

Không cho phép:

```text
email
full_name
document_text
ai_message
tender_name
raw_ip
raw_user_agent
```

---

# PHASE 4 — Commercial Release attribution

Mọi dữ liệu pricing/commercial phải pin:

```text
commercial_release_id
```

Mục tiêu:

- phân tích cohort trước/sau đổi giá;
- tránh trộn dữ liệu giữa các catalog khác nhau;
- hỗ trợ A/B hoặc pilot release sau này.

Không mutate history của release.

---

# PHASE 5 — Data model / aggregate layer

Sau khi audit schema hiện tại, thiết kế migration mới.

Ưu tiên tận dụng `product_usage_hourly`.

Các bảng aggregate đề xuất:

```text
workspace_usage_daily
workspace_feature_daily
workspace_seat_daily

procurement_usage_daily
commercial_funnel_daily
subscription_snapshot_daily
revenue_daily
cost_usage_daily

retention_cohort_weekly
plan_fit_monthly
```

Không bắt buộc tạo tất cả nếu dữ liệu hiện có đã đủ.

Mỗi bảng mới phải giải thích:

- mục tiêu;
- grain;
- unique key;
- retention;
- indexes;
- write path;
- read path.

---

# PHASE 6 — Unified variable cost ledger

Nếu code hiện tại chưa có đủ, tạo lớp cost aggregation.

Đề xuất:

```text
usage_date
owner_kind
owner_id / pseudonymous workspace id
cost_type
quantity
estimated_cost_vnd
source
commercial_release_id
```

`cost_type` allowlist:

```text
procurement_fetch
ai
document_worker
storage
bandwidth
payment_fee
email
other_external_provider
```

Không cần event-level raw cost nếu daily aggregate đủ.

---

# PHASE 7 — Pseudonymization

Nếu analytics dashboard không cần ID gốc, tạo identifier analytics:

```text
analytics_user_id = HMAC(user_id)
analytics_workspace_id = HMAC(owner_id)
```

Yêu cầu:

- HMAC key riêng;
- không log key;
- không lưu raw ID trong data export nếu không cần;
- không dùng unsalted SHA trực tiếp;
- document design rationale.

Nếu nội bộ Super Admin cần drilldown workspace cụ thể cho support, tách hẳn:

- aggregate analytics mode;
- authorized support drilldown mode.

Không trộn hai use case.

---

# PHASE 8 — Dashboard UX/UI

Tạo khu vực Super Admin riêng:

```text
Analytics / Commercial Intelligence
```

Có thể gồm các route:

```text
/admin/analytics/overview
/admin/analytics/activation
/admin/analytics/features
/admin/analytics/seats
/admin/analytics/procurement
/admin/analytics/credits
/admin/analytics/funnel
/admin/analytics/retention
/admin/analytics/economics
/admin/analytics/plan-fit
```

Điều chỉnh route naming theo architecture hiện tại.

---

# Nguyên tắc thiết kế dashboard

Phải dùng skill frontend/design/data-viz nếu có.

Không dùng layout card lộn xộn.

Information hierarchy:

1. Filters
2. Primary KPI row
3. Main trend
4. Distribution/funnel/cohort
5. Segment comparison
6. Detailed table
7. Metric definition/help

---

# Global filters

Tất cả dashboard liên quan phải hỗ trợ khi phù hợp:

- date range;
- commercial release;
- owner type:
  - account;
  - organization;
- plan;
- variant:
  - Internal;
  - Connected;
- workspace size bucket;
- paid/free/shadow/live mode.

Filter state phải shareable qua URL nếu architecture hiện tại phù hợp.

---

# Date presets

```text
7D
30D
90D
6M
12M
Custom
```

Default không nên query thời gian quá dài.

---

# Chart rules

Ưu tiên:

- line chart cho trend;
- bar chart cho category;
- histogram cho distribution;
- funnel visualization cho conversion;
- cohort heatmap cho retention;
- stacked bar chỉ khi thực sự dễ hiểu;
- table cho dữ liệu chính xác.

Không dùng:

- 3D chart;
- gauge thừa thãi;
- pie chart với quá nhiều slice;
- animation nặng;
- chart library quá lớn nếu project chưa có.

---

# Accessibility

Mỗi chart phải có:

- title;
- subtitle hoặc metric description;
- accessible text summary;
- keyboard-friendly tooltip nếu library hỗ trợ;
- không phụ thuộc duy nhất vào màu;
- table fallback cho dữ liệu quan trọng.

---

# Empty state

Không hiển thị chart rỗng vô nghĩa.

Hiển thị:

```text
Chưa đủ dữ liệu trong khoảng thời gian này.
```

và giải thích threshold nếu có.

---

# Small cohort privacy

Không hiển thị phân tích cohort chi tiết nếu:

```text
workspace_count < 10
```

Ưu tiên `>=20` cho pricing recommendation nếu sample cho phép.

Cohort nhỏ phải:

- gộp vào Other;
- hoặc hiển thị "Insufficient sample".

---

# Dashboard 1 — Executive Commercial Overview

Mục tiêu:

Cho Super Admin hiểu tình trạng commercial trong 30 giây.

## KPI cards

- Monthly Active Workspaces
- Monthly Active Seats
- Paid Workspaces
- New Paid Workspaces
- Gross Revenue
- Net Settled Revenue
- Top-up Revenue
- Refund Amount
- ARPA
- Successful Procurement Fetches
- Estimated Variable Cost
- Contribution Margin
- Pricing → Paid Conversion
- D30 Paid Retention Proxy

## Main charts

1. MAW trend
2. Paid workspaces trend
3. Revenue vs variable cost
4. Internal vs Connected mix
5. Plan distribution
6. Top-up revenue trend

## Summary panel

Tự động tính các insight mô tả dựa trên threshold cố định, ví dụ:

- Connected usage tăng X%;
- top-up attach rate tăng;
- seat pressure xuất hiện ở tier Y.

Không dùng LLM inference trong v1 nếu không cần.

---

# Dashboard 2 — Activation

Funnel:

```text
Signup
→ Verified
→ First login
→ First meaningful action
→ First plan/package
→ First procurement/first export
→ D7 active
→ D30 active
```

## Metrics

- verification rate;
- median signup → verify;
- median TTFV;
- P75/P90 TTFV;
- D1/D7/D30 activation retention;
- % không bao giờ đạt first value.

## Breakdown

- personal vs organization;
- acquisition week;
- first feature used.

---

# Dashboard 3 — Feature Adoption

Table:

```text
Feature
Active users
Active workspaces
Usage frequency
Adoption %
D30 retention correlation
Paid conversion correlation
Median usage/workspace
```

Charts:

- top adopted features;
- feature trend;
- feature usage by plan;
- feature adoption vs retention.

Không trình bày correlation như causal proof.

UI phải ghi rõ:

> Correlation does not imply causation.

---

# Dashboard 4 — Seat Distribution & Team Sizing

Đây là dashboard quyết định mốc 1/5/15/50.

## Metrics

- registered seats;
- monthly active seats;
- power seats;
- seat utilization;
- workspaces >=80% quota;
- workspaces > quota.

## Charts

### Histogram

```text
1
2
3–5
6–10
11–15
16–25
26–50
>50
```

### Percentile summary

```text
P10
P25
P50
P60
P75
P80
P90
P95
P99
Max
```

### Tier overlay

Hiển thị vertical markers hoặc annotations tại:

```text
1
5
15
50
```

để nhìn ngay mức giá hiện tại có khớp distribution không.

## Key output

Tạo bảng:

```text
Current tier
Workspace count
Median active seats
P90 active seats
Median seat utilization
% at >=80%
% over limit
```

---

# Dashboard 5 — Procurement Economics

## Metrics

- fetch attempted;
- fetch succeeded;
- unique billable fetches;
- cache hits;
- failures;
- cancelled;
- credits consumed;
- credits reserved;
- credits released;
- included credits;
- purchased credits;
- expired unused credits;
- estimated external cost.

## Charts

1. Successful fetches/workspace distribution
2. Annualized usage histogram
3. Quota utilization by plan
4. Procurement usage trend
5. External cost trend
6. Internal vs Connected usage

## Percentiles

```text
P25
P50
P70
P75
P80
P90
P95
P99
```

---

# Dashboard 6 — Credit Pack Analysis

Credit pack hiện tại:

```text
20
100
500
2000
```

## Metrics

- pack sales mix;
- pack revenue;
- credits purchased;
- credits consumed;
- unused purchased credits;
- repeat top-up;
- median days between top-ups;
- top-up attach rate;
- workspaces buying multiple small packs;
- upgrade-equivalent spend.

## Special analysis

Phát hiện:

```text
20-pack purchased >=4 times within 45 days
```

để xem user thực tế nên mua 100-pack.

Tương tự cho các pack khác.

Không tự upsell dựa trên rule này; chỉ analytics.

---

# Dashboard 7 — Commercial Funnel

Funnel:

```text
Pricing viewed
→ Size selected
→ Variant compared
→ Offer selected
→ Quote created
→ Checkout created
→ Payment verified
→ Subscription activated
→ First paid value
```

## Metrics

- conversion từng bước;
- abandonment từng bước;
- median time từng bước;
- payment failure;
- activation failure;
- refund;
- paid TTFV.

## Breakdown

- SKU;
- commercial release;
- owner type;
- size bucket;
- Internal/Connected.

---

# Dashboard 8 — Retention Cohorts

Cohort heatmap:

- W1;
- W2;
- W4;
- W8;
- W12.

Cohorts:

- signup week;
- first-value week;
- paid activation week.

Segment:

- Internal;
- Connected;
- Personal;
- Organization;
- seat bucket;
- procurement intensity;
- collaboration intensity;
- AI adoption.

Không dùng heartbeat làm retention chính.

---

# Dashboard 9 — Cost & Margin

Theo plan/tier:

```text
Gross revenue
- refunds
= net revenue
- payment fee
- procurement provider cost
- AI cost
- document processing estimate
- storage/bandwidth estimate
= contribution margin
```

## Metrics

- cost/workspace;
- cost/active seat;
- cost/successful procurement fetch;
- AI cost/AI-active workspace;
- payment fee rate;
- contribution margin;
- contribution margin %.

## Chart

Revenue vs cost by tier.

Nếu một cost source chỉ là estimate, UI phải ghi rõ:

```text
Estimated
```

không giả vờ là accounting actual.

---

# Dashboard 10 — Plan Fit Intelligence

Đây là dashboard quan trọng nhất cho pricing decision.

Mỗi workspace/month phải có analytical dimensions:

```text
active_seats
seat_utilization
procurement_usage
quota_utilization
topup_spend
connected_feature_days
workflow_volume
workflow_depth
export_intensity
ai_intensity
estimated_cost
revenue
```

## Classification

Chỉ analytical recommendation:

```text
UNDER_SIZED
GOOD_FIT
OVER_SIZED
CONNECTED_CANDIDATE
TOPUP_HEAVY
ENTERPRISE_CANDIDATE
```

Không tự đổi plan.

---

# Suggested rule — UNDER_SIZED

Ví dụ:

```text
seat_utilization >= 0.80
for >= 2 monthly snapshots
```

hoặc:

```text
quota_utilization >= 0.80
```

hoặc:

```text
topup_spend >= 0.70 * price_gap_to_next_appropriate_plan
```

Strong candidate khi >=2 pressure signals.

Sau khi đọc code/catalog thực tế, implement rule bằng config/version thay vì hardcode rải rác.

---

# Suggested rule — OVER_SIZED

Ví dụ:

```text
seat_utilization < 0.30
AND quota_utilization < 0.20
AND workflow_volume low
for >= 2 months
```

Chỉ dùng cho analysis.

Không tự downgrade.

---

# Suggested rule — CONNECTED_CANDIDATE

Internal workspace có:

- procurement fetch frequency cao;
- repeat top-up;
- top-up spend gần hoặc vượt chênh lệch giá sang Connected;
- connected-relevant feature intent.

Tính:

```text
effective_internal_cost
=
subscription_price
+
topup_spend
```

so với:

```text
connected_price_same_size
```

Dashboard phải có:

```text
days_to_break_even
```

hoặc `not reached`.

---

# Suggested rule — ENTERPRISE_CANDIDATE

Ví dụ:

```text
monthly_active_seats > 50
```

hoặc repeated pressure gần 50 + enterprise-like usage.

Không tự tạo sản phẩm Enterprise trong commercial catalog.

Chỉ thống kê evidence.

---

# PHASE 9 — AI Analytics

Dùng dữ liệu AI usage/cost hiện tại.

Dashboard subsection:

- AI-active workspaces;
- AI requests/workspace;
- input/output tokens;
- tool calls;
- estimated AI cost;
- feedback helpful rate;
- too slow rate;
- incorrect/missing source feedback;
- retention correlation;
- paid conversion correlation.

Không sử dụng AI message content.

Không đưa AI vào paywall trong task này nếu commercial policy hiện tại chưa yêu cầu.

Mục tiêu chỉ là tạo dữ liệu để quyết định tương lai.

---

# PHASE 10 — Feedback instrumentation

Bổ sung structured optional feedback ở một số commercial moments.

Không spam user.

Moments:

```text
checkout_abandoned
second_topup
upgrade_completed
cancel_or_downgrade_intent
paid_day_45_60
```

Reason options predefined.

Ví dụ checkout:

```text
too_expensive
not_needed_yet
benefits_unclear
payment_method
need_internal_approval
technical_issue
other
```

Optional free text.

Không sử dụng free text cho personalized price automation.

---

# PHASE 11 — Performance engineering

Dashboard APIs phải:

- pagination khi có detailed tables;
- bounded date ranges;
- sử dụng aggregate tables;
- có index phù hợp;
- tránh N+1;
- tránh `COUNT(DISTINCT ...)` trên raw production table cho mỗi page load nếu có thể preaggregate;
- không trả hàng chục MB JSON.

## API response target

Với dashboard phổ biến và warm DB:

- ưu tiên P50 < 300 ms;
- P95 < 1 s nếu thực tế hạ tầng cho phép.

Không fake benchmark.

Đo trước/sau.

---

# Caching

Có thể cache dashboard aggregate ngắn hạn:

```text
30s–5m
```

tùy data freshness.

Cache key phải bao gồm:

- date range;
- filters;
- commercial release;
- authorization context nếu cần.

Không cache cross-tenant nhầm quyền.

---

# Frontend performance

- lazy-load dashboard sections/charts;
- tránh import chart library vào app chính nếu route admin không dùng;
- code-split admin analytics route;
- không render > vài nghìn DOM rows;
- virtualize/paginate table lớn;
- không animation nặng.

Đo bundle impact.

---

# PHASE 12 — Authorization & Security

Analytics toàn hệ thống chỉ dành cho đúng role Super Admin.

Không cho organization admin xem cross-tenant analytics.

Kiểm tra:

- backend authorization;
- frontend route guard;
- API scope;
- direct URL access;
- export endpoint;
- cache isolation.

Không dựa duy nhất vào frontend hide menu.

---

# Export dữ liệu

Nếu có CSV export:

- chỉ export aggregated data;
- apply same filters;
- enforce role server-side;
- limit range/row count;
- sanitize CSV injection;
- không export PII mặc định.

---

# PHASE 13 — Data retention

Đề xuất policy và implement nếu phù hợp với architecture hiện tại:

```text
Raw commercial UI events: 90–180 days
Hourly usage: 6–12 months
Daily aggregates: 24–36 months
Billing/accounting: theo policy tài chính/pháp lý
```

Không xóa accounting data chỉ vì analytics retention ngắn hơn.

Có maintenance job hoặc document lifecycle rõ ràng.

---

# PHASE 14 — Analytics QA / Data Quality

Tạo data-quality checks:

- no negative count;
- consumed <= plausible grant/purchase accounting;
- payment activation consistency;
- duplicate event/idempotency;
- unknown feature keys;
- unknown event types;
- future timestamps;
- missing commercial release where required.

Dashboard nên có internal health indicator hoặc diagnostics command.

---

# PHASE 15 — Tests bắt buộc

## Backend

Test:

- event validation;
- allowlist;
- idempotency;
- authorization;
- aggregation;
- timezone/date boundaries;
- commercial release attribution;
- pseudonymization;
- small-cohort suppression;
- plan-fit rules;
- cost aggregation.

## Database

Test:

- fresh schema;
- migration upgrade;
- constraints;
- indexes;
- FK audit;
- aggregate uniqueness.

## Frontend

Test:

- filters;
- empty state;
- loading;
- error state;
- route authorization;
- KPI formatting;
- chart data transformations;
- cohort suppression;
- responsive behavior;
- accessibility basics.

## E2E

At minimum:

1. Super Admin opens analytics overview.
2. Filters date range.
3. Filters commercial release.
4. Opens Seat Distribution.
5. Opens Procurement Economics.
6. Opens Retention cohort.
7. Opens Plan Fit.
8. Non-Super-Admin denied.
9. Empty dataset behaves correctly.

---

# PHASE 16 — Seed / Demo Analytics Data

Nếu project có dev fixtures:

Tạo deterministic analytics seed đủ để dashboard có:

- Internal + Connected;
- Personal + organization;
- small/medium/large workspace;
- different quota utilization;
- top-up;
- payment;
- retention cohorts;
- AI usage;
- costs.

Không dùng fake production data.

Seed chỉ dành dev/test.

---

# PHASE 17 — Documentation

Tạo:

```text
docs/analytics/README.md
docs/analytics/product_analytics_dictionary.md
docs/analytics/event_taxonomy.md
docs/analytics/privacy_and_retention.md
docs/analytics/pricing_decision_playbook.md
```

---

# Pricing Decision Playbook

Tài liệu phải mô tả cách đọc dashboard sau 60–90 ngày.

## Team tier review

Lấy distribution:

```text
P50
P75
P80
P90
P95
```

của monthly active seats.

Đánh giá mốc:

```text
1
5
15
50
```

Không đổi tier chỉ từ một tuần dữ liệu.

---

# Procurement quota review

Theo từng Connected tier:

```text
annualized_successful_unique_fetches
```

Tính:

```text
P25
P50
P70
P75
P80
P90
P95
```

So sánh included quota hiện tại.

Không tự động thay catalog.

---

# Credit pack review

Đánh giá:

- sales mix;
- repeat packs;
- unused credits;
- pack expiry;
- pack switching;
- break-even to Connected.

---

# Price review

Không ra quyết định chỉ từ usage.

Phải kết hợp:

```text
revealed willingness to pay
+ retention/value
+ cost to serve
+ margin
+ structured feedback
```

---

# A/B pricing

Không implement personalized dynamic pricing.

Nếu sau này cần experiment:

- cohort random;
- release versioned;
- transparent;
- stable offer during experiment.

Không dùng:

```text
heavy_user => higher_price
```

---

# PHASE 18 — Rollout strategy

Không bật tất cả ngay lập tức.

## Stage A — Schema + server-side existing facts

Triển khai aggregate từ data hiện có.

## Stage B — Hidden Super Admin dashboard

Chỉ nội bộ.

## Stage C — Minimal frontend funnel events

Bật server feature flag nếu repo hỗ trợ.

## Stage D — Data validation

Chạy ít nhất 1–2 tuần.

So sánh raw vs aggregate.

## Stage E — Full commercial observation

Thu dữ liệu 60–90 ngày trước pricing revision lớn.

---

# Yêu cầu visual / design chi tiết

Dashboard phải có một design system nhất quán với application hiện tại.

Không tự thêm một theme khác hoàn toàn.

## Header

- page title;
- concise subtitle;
- last updated;
- global filters.

## KPI cards

Mỗi card:

- metric;
- current value;
- change vs previous comparable period;
- tooltip definition;
- state:
  - positive;
  - negative;
  - neutral.

Không mặc định coi tăng là tốt.

Ví dụ cost tăng là xấu nhưng usage tăng có thể tốt.

---

# Chart interaction

Nếu library hiện tại hỗ trợ:

- hover tooltip;
- legend toggle;
- click segment → filter;
- accessible data table.

Không yêu cầu drilldown phức tạp trong v1 nếu tạo nhiều technical debt.

---

# Color semantics

Dùng palette phù hợp theme hiện tại.

Phải đảm bảo:

- sufficient contrast;
- không dùng đỏ/xanh như signal duy nhất;
- consistent series mapping.

Không hardcode màu rải rác trong component.

---

# Number formatting

- VND: format Việt Nam;
- percentage: 1 decimal khi cần;
- large counts: locale-aware;
- duration: ms/s/min/h;
- percentiles rõ nhãn P50/P90.

---

# Timezone

Phải thống nhất business timezone của application.

Không tạo bug do UTC vs local day.

Daily aggregates phải có definition rõ ràng.

---

# Yêu cầu implementation style

Ưu tiên kiến trúc:

```text
domain metrics definitions
        ↓
aggregation/query service
        ↓
analytics API
        ↓
frontend data adapter
        ↓
dashboard components
```

Không viết SQL trực tiếp trong UI.

Không để một file dashboard 3.000 dòng.

Tách:

- filters;
- KPI components;
- charts;
- tables;
- metric definitions;
- query hooks/store.

---

# Không over-engineer

Không thêm:

- Kafka;
- ClickHouse;
- BigQuery;
- Snowflake;
- external analytics SDK;
- event streaming platform

trừ khi repository hiện tại đã dùng hoặc có bằng chứng PostgreSQL không đáp ứng.

Với quy mô hiện tại, ưu tiên PostgreSQL aggregate first-party.

---

# Không làm thay đổi logic thương mại hiện tại

Task này **không tự thay đổi**:

- giá;
- SKU;
- member quotas;
- procurement quotas;
- credit pack prices;
- plan entitlement;
- payment policy.

Mục tiêu là xây **hệ thống dữ liệu để ra quyết định**.

Nếu phát hiện bug commercial thật, báo riêng trước khi sửa logic giá.

---

# Definition of Done

Chỉ coi là xong khi:

- [ ] Audit existing analytics/data complete
- [ ] Data dictionary complete
- [ ] Meaningful action taxonomy standardized
- [ ] Commercial funnel minimal instrumentation implemented
- [ ] commercial_release_id attribution correct
- [ ] Aggregate tables/jobs implemented where needed
- [ ] Variable cost model implemented or documented gap
- [ ] Small cohort privacy suppression implemented
- [ ] Super Admin authorization enforced server-side
- [ ] Executive dashboard complete
- [ ] Activation dashboard complete
- [ ] Feature Adoption dashboard complete
- [ ] Seat Distribution dashboard complete
- [ ] Procurement Economics dashboard complete
- [ ] Credit Pack dashboard complete
- [ ] Commercial Funnel dashboard complete
- [ ] Retention dashboard complete
- [ ] Cost & Margin dashboard complete
- [ ] Plan Fit dashboard complete
- [ ] AI subsection implemented
- [ ] Empty/loading/error states polished
- [ ] Accessibility checks pass
- [ ] Backend tests pass
- [ ] Frontend tests pass
- [ ] DB migration/fresh install pass
- [ ] FK/index audit pass
- [ ] E2E analytics flows pass
- [ ] Existing CI remains green
- [ ] No performance regression in main app
- [ ] Admin analytics route is code-split/lazy where appropriate
- [ ] Documentation complete
- [ ] Pricing decision playbook complete

---

# Báo cáo sau mỗi phase

Sau mỗi phase, báo:

```text
Phase:
Existing code reused:
New code:
Schema impact:
Privacy impact:
Security impact:
Performance impact:
Tests:
Remaining risks:
```

Không nói "done" nếu chưa chạy test.

---

# Báo cáo cuối cùng

Trả về:

## 1. Existing data inventory

Table:

```text
Source
Fields used
Metrics produced
New instrumentation required?
```

## 2. Schema changes

- tables;
- columns;
- indexes;
- migrations.

## 3. Event taxonomy

Danh sách event/feature keys chính thức.

## 4. Dashboard architecture

Route/component/API structure.

## 5. Dashboards completed

Mỗi dashboard:

- purpose;
- KPIs;
- charts;
- filters;
- main business decisions supported.

## 6. Privacy & security

Các biện pháp đã triển khai.

## 7. Performance

Before/after:

```text
Main app bundle
Analytics route bundle
Dashboard API P50/P95
DB query time
Page rendering
```

nếu benchmark được.

## 8. Tests

Liệt kê command + kết quả.

## 9. Data gaps

Những gì hiện chưa thể đo chính xác.

## 10. Recommended observation period

Đề xuất cách thu 60–90 ngày trước khi thay đổi pricing.

---

# Chỉ dẫn khởi động

Bắt đầu bằng:

1. đọc các skills liên quan;
2. audit repository;
3. lập Existing Data Inventory;
4. lập Analytics Gap Analysis;
5. lập Dashboard Information Architecture;
6. đưa ra implementation plan theo file/module;
7. sau đó mới code.

Ưu tiên:

**data correctness > privacy > security > compatibility > performance > UX > implementation speed**

Không thu thập dữ liệu chỉ vì "có thể hữu ích".

Không thay đổi pricing trong task này.

Mục tiêu cuối cùng là tạo ra một hệ thống để Super Admin có thể nhìn dashboard và trả lời bằng dữ liệu:

> "Gói nào phù hợp với người dùng thật, quota nào hợp lý, mức giá nào tạo được giá trị và margin bền vững?"
