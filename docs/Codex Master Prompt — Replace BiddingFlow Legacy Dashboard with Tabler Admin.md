Bạn đang làm việc trực tiếp trên repository BiddingFlow:

https://github.com/newstar94/Bidding

Nhiệm vụ của bạn là:

> THAY THẾ HOÀN TOÀN giao diện Dashboard/Admin hiện tại bằng một dashboard mới dựa trên **Tabler**, hiện đại, trực quan và phù hợp mô hình SaaS của BiddingFlow, nhưng PHẢI giữ đầy đủ toàn bộ chức năng hiện có của dashboard cũ.

Ngoài feature parity, hãy bổ sung các chức năng quản trị hợp lý để dashboard mới trở thành trung tâm vận hành BiddingFlow.

Đây là một migration UI/architecture thực tế, không phải demo.

Không dừng ở mockup.

Bạn phải:

1. reverse-engineer dashboard hiện tại;
2. inventory toàn bộ tính năng;
3. map API/backend hiện có;
4. thiết kế dashboard mới;
5. tích hợp Tabler;
6. migrate từng chức năng;
7. bổ sung feature hợp lý;
8. giữ security boundary;
9. thêm test;
10. chạy CI;
11. xóa dashboard cũ chỉ khi feature parity được chứng minh.

---

# I. MỤC TIÊU SẢN PHẨM

Dashboard mới phải có tối thiểu:

```text
1. Tổng quan hệ thống
2. Thống kê / phân tích
3. Quản lý tổ chức
4. Quản lý người dùng
5. Quản lý gói đăng ký
6. Quản lý subscriptions
7. Quản lý hóa đơn
8. Quản lý thanh toán
9. Cấu hình hệ thống
10. Quản lý biến ENV/configuration an toàn
11. Health / operations
12. Audit logs
13. Security events
14. Jobs / workers
15. Storage / database status
```

Ngoài ra:

> Mọi chức năng dashboard cũ đang có phải tiếp tục tồn tại trong dashboard mới, kể cả khi không được liệt kê ở trên.

Không được silently drop functionality.

---

# II. UI FOUNDATION — TABLER

Sử dụng:

```text
Tabler
Bootstrap 5
HTML
CSS
Vanilla JavaScript / ES Modules
```

Ưu tiên tích hợp phù hợp architecture frontend hiện có của BiddingFlow.

KHÔNG:

```text
rewrite React
rewrite Vue
rewrite Angular
```

Không đưa thêm frontend framework lớn chỉ để làm dashboard.

Có thể sử dụng Tabler components/design tokens/assets theo license phù hợp.

Không copy nguyên demo application.

Chỉ lấy:

```text
layout system
navigation
cards
forms
tables
tabs
charts
dropdown
modal
offcanvas
badge
pagination
empty states
loading states
```

và xây dashboard BiddingFlow trên đó.

---

# III. NGUYÊN TẮC QUAN TRỌNG NHẤT — FEATURE PARITY FIRST

TRƯỚC KHI VIẾT CODE MỚI:

phải tìm toàn bộ dashboard/admin UI hiện có.

Search:

```text
dashboard
admin
billing
subscription
invoice
user management
organization
settings
environment
system config
analytics
metrics
audit
```

Tìm:

- HTML;
- CSS;
- JS;
- controllers;
- workflows;
- API endpoints;
- backend services;
- tests;
- permissions.

Lập bảng:

```text
Legacy Feature
Current UI
Frontend Entry
API
Backend Service
DB Tables
Permission
New Dashboard Destination
Migration Status
```

Ví dụ:

```text
Legacy Feature | Old Entry | API | New Page | Status
User list      | ...       | ... | Users    | pending
Billing        | ...       | ... | Billing  | migrated
```

Dashboard cũ chỉ được remove khi:

```text
ALL legacy features = migrated or intentionally replaced with documented equivalent
```

---

# IV. TUYỆT ĐỐI KHÔNG PHÁ DASHBOARD BUSINESS LOGIC

Migration này chủ yếu là:

```text
UI
navigation
information architecture
interaction
presentation
```

Không rewrite backend một cách không cần thiết.

Nếu API hiện tại hoạt động:

reuse API.

Nếu backend service hiện tại hoạt động:

reuse service.

Chỉ thêm API khi dashboard mới thực sự cần dữ liệu chưa có.

Không duplicate business logic trong frontend.

---

# V. TÁCH PLATFORM ADMIN KHỎI ORGANIZATION MANAGER

Dashboard mới là:

```text
PLATFORM ADMIN
```

không phải organization workspace thông thường.

Không được mặc định:

```text
organization manager == platform admin
```

Thiết kế authorization riêng cho platform admin.

Nếu codebase đã có platform-level role:

reuse.

Nếu chưa có:

thiết kế abstraction tối thiểu phù hợp architecture hiện tại.

Các role nên hỗ trợ hoặc chuẩn bị cho:

```text
platform_admin
billing_admin
support_admin
operations_admin
read_only_admin
```

Không bắt buộc tạo tất cả nếu schema hiện tại không phù hợp.

Nhưng authorization phải tách platform scope khỏi organization scope.

---

# VI. DASHBOARD INFORMATION ARCHITECTURE

Thiết kế sidebar tương tự:

```text
BIDDINGFLOW ADMIN

Tổng quan
├── Dashboard
└── Hoạt động hệ thống

Phân tích
├── Tổng quan
├── Người dùng
├── Doanh thu
├── Subscription
├── Sử dụng sản phẩm
└── Đấu thầu

Khách hàng
├── Tổ chức
├── Người dùng
└── Phiên đăng nhập

Thương mại
├── Gói đăng ký
├── Subscriptions
├── Hóa đơn
├── Thanh toán
└── Khuyến mãi / giảm giá
    nếu product hiện tại phù hợp

Hệ thống
├── Cấu hình
├── Feature Flags
├── Jobs / Workers
├── Sync
├── Storage
├── Database
└── Backup

Bảo mật
├── Audit Logs
├── Login Activity
├── Security Events
└── Sessions

DevOps
├── Environment
├── Health
├── Build / Version
└── Release Information
```

Nếu dashboard cũ có module khác:

thêm vào sidebar hợp lý.

---

# VII. ROUTING

Ưu tiên dashboard nằm tại:

```text
/admin
```

Ví dụ:

```text
/admin
/admin/analytics
/admin/organizations
/admin/users
/admin/plans
/admin/subscriptions
/admin/invoices
/admin/payments
/admin/settings
/admin/system
/admin/environment
/admin/audit
/admin/health
```

Không trộn platform admin route với:

```text
/app
workspace organization
bidding workflow
```

nếu architecture hiện tại cho phép tách rõ.

---

# VIII. DASHBOARD HOME — TỔNG QUAN

Thiết kế dashboard home trực quan.

## KPI

Ít nhất:

```text
Tổng tổ chức
Tổng người dùng
Active users
New users
Active subscriptions
MRR
ARR
Doanh thu kỳ hiện tại
Hóa đơn chưa thanh toán
Hóa đơn quá hạn
```

Nếu metric không có dữ liệu hoặc chưa có billing thật:

không invent.

Hiển thị:

```text
N/A
Not configured
No data
```

thay vì fake số liệu.

---

# IX. DASHBOARD CHARTS

Ưu tiên dùng chart library đang có trong Tabler/build hiện hành.

Không thêm dependency nếu Tabler/vendor hiện tại đã có solution.

Charts:

```text
Revenue over time
New organizations
New users
Subscription distribution
MRR growth
Invoice status
Product activity
Document generation
Sync activity
```

Chart phải:

- responsive;
- accessible;
- loading-safe;
- empty-state-safe;
- không crash nếu series rỗng.

---

# X. ANALYTICS CENTER

Tạo `/admin/analytics`.

Filter thời gian:

```text
7 ngày
30 ngày
90 ngày
Năm nay
Tùy chỉnh
```

Sections:

## Business

```text
MRR
ARR
ARPU
New subscription
Upgrade
Downgrade
Cancellation
Churn
Trial conversion
```

## User analytics

```text
DAU
WAU
MAU
New users
Active organizations
Retention nếu có data đủ
```

## Product usage

```text
Plans created
Packages created
Contracts created
Contractors created
Document exports
Procurement imports
Sync mutations
Conflict count
Storage usage
```

## Operational analytics

```text
API request count
4xx
5xx
sync failures
worker failures
job queue
DB latency
```

Chỉ implement metric có thể lấy chính xác từ dữ liệu hiện có.

Metric chưa support:

đặt extension seam/document future work.

Không invent metric từ approximations mà không ghi rõ.

---

# XI. ORGANIZATION MANAGEMENT

Tạo:

```text
/admin/organizations
```

Table:

```text
Organization
Owner / primary contact
Plan
Users
Status
Created
Last activity
Subscription
Actions
```

Functions nếu backend hỗ trợ:

```text
search
filter
sort
pagination
view details
suspend
reactivate
inspect subscription
inspect users
view audit
view usage
```

Organization detail page/drawer:

```text
Overview
Users
Subscription
Invoices
Usage
Activity
Security
```

Không cho platform admin mutate domain data đấu thầu trực tiếp chỉ vì có admin dashboard, trừ khi product policy hiện có cho phép.

---

# XII. USER MANAGEMENT

Tạo:

```text
/admin/users
```

Table:

```text
Name
Email
Organization
Role
Status
Plan
Last active
Created
```

Filters:

```text
organization
role
status
plan
created date
last active
```

User detail drawer/page:

```text
Profile
Organization memberships
Roles
Active sessions
Subscription context
Usage
Login activity
Audit history
```

Admin actions nếu backend hiện có:

```text
suspend
activate
terminate sessions
reset/revoke sessions
inspect organization membership
change allowed platform metadata
```

Không thêm:

```text
view password
view session secret
view authentication secret
```

---

# XIII. SUBSCRIPTION PLAN MANAGEMENT

Tạo:

```text
/admin/plans
```

Plan fields nên support nếu product hiện tại cho phép:

```text
name
code
description
monthly price
yearly price
currency
trial days
user limit
storage quota
document quota
feature flags
status
display order
```

Admin actions:

```text
create plan
edit draft/future plan
activate
deactivate
duplicate/version
```

---

# XIV. PLAN VERSIONING

Nếu gói đăng ký đang được khách hàng sử dụng:

không nên mutate lịch sử thương mại một cách âm thầm.

Ưu tiên:

```text
Plan definition/version
```

hoặc semantics tương đương.

Ví dụ:

```text
PRO v1
499k/month
↓
PRO v2
599k/month
```

Existing customer có thể:

```text
grandfather v1
```

nếu commercial policy yêu cầu.

Đừng tự tạo business rule nếu backend hiện tại đã có billing policy.

Reuse existing implementation.

---

# XV. SUBSCRIPTIONS

Tạo:

```text
/admin/subscriptions
```

Fields:

```text
Organization
Plan
Status
Billing cycle
Started
Renewal
Trial end
Cancellation
Amount
```

Statuses tùy backend hiện tại:

```text
trialing
active
past_due
cancelled
expired
```

Không invent status không phù hợp DB/service.

Support:

```text
filter
search
view detail
subscription timeline
upgrade/downgrade nếu product cho phép
cancel/reactivate nếu backend hỗ trợ
```

---

# XVI. INVOICE MANAGEMENT

Tạo:

```text
/admin/invoices
```

Header KPI:

```text
Total billed
Paid
Open
Overdue
Refunded
```

Table:

```text
Invoice #
Organization
Subscription
Amount
Status
Issued
Due
Paid
```

Potential status:

```text
DRAFT
OPEN
PAID
OVERDUE
VOID
REFUNDED
```

Nhưng phải map từ backend hiện tại.

Invoice detail:

```text
customer
line items
tax/fees nếu có
subtotal
total
payment status
timeline
audit
```

Không tính toán tiền chỉ ở frontend.

Backend là authoritative.

---

# XVII. PAYMENTS

Nếu codebase hiện tại có payment records:

tạo:

```text
/admin/payments
```

Show:

```text
Payment ID
Invoice
Customer
Amount
Method
Provider
Status
Created
```

Không hiển thị:

```text
full card number
CVV
payment provider secret
```

Nếu payment provider chưa tồn tại:

không fake integration.

---

# XVIII. SYSTEM SETTINGS

Tạo:

```text
/admin/settings
```

Phân loại settings:

```text
Application
Registration
Localization
Billing
Documents
Notifications
Storage
Sync
Feature Flags
```

Settings nên lưu vào persistent config store nếu application đã có.

Không dùng `.env` cho mọi runtime setting.

Phân biệt:

```text
runtime configuration
deployment configuration
secret configuration
```

---

# XIX. ENVIRONMENT / SECRET CONFIGURATION

Đây là security-critical.

Tạo:

```text
/admin/environment
```

NHƯNG tuyệt đối không expose raw `.env`.

Không được có API:

```text
GET /api/admin/env
```

trả toàn bộ:

```text
DATABASE_URL
SESSION_SECRET
SMTP_PASSWORD
API_SECRET
...
```

---

# XX. PHÂN LOẠI ENV

## Public/runtime-safe values

Có thể hiển thị value nếu không nhạy cảm:

```text
APP_ENV
APP_VERSION
REGION
DEFAULT_LOCALE
DEFAULT_TIMEZONE
```

## Secrets

Chỉ trả:

```text
configured: true/false
source
last updated
restart required
```

Ví dụ UI:

```text
DATABASE_URL
● Configured

SESSION_SECRET
● Configured

SMTP_PASSWORD
○ Missing
```

Không trả raw value.

---

# XXI. SECRET REPLACEMENT

Nếu backend hỗ trợ thay secret an toàn:

UI:

```text
SMTP password
● Configured

[Replace]
```

User nhập new secret.

Server:

```text
accept new value
validate
persist through approved secret/config mechanism
```

Frontend không được đọc lại secret hiện tại.

Không lưu secret trong:

```text
localStorage
IndexedDB
console
audit log
analytics
error response
```

---

# XXII. ENV WRITE MODEL

Không trực tiếp rewrite arbitrary `.env` file từ browser nếu architecture deployment không support an toàn.

Trước khi implement, xác định app đang deploy bằng:

```text
environment variables
container
systemd
Docker
cloud secret store
other mechanism
```

Thiết kế theo deployment model thực tế.

Có thể chia:

```text
Runtime Settings
Secrets
Deployment Environment
```

Nếu một ENV cần restart:

UI phải ghi:

```text
Restart required
```

Không giả vờ đã áp dụng runtime.

---

# XXIII. ALLOWLIST

Chỉ key trong server-side allowlist mới xuất hiện trong admin environment UI.

Ví dụ conceptual:

```python
ADMIN_CONFIG_SCHEMA = {
    "DEFAULT_LOCALE": {...},
    "SMTP_HOST": {...},
    "SMTP_PASSWORD": {
        "secret": True,
        "writable": True,
    },
}
```

Không cho client tự truyền arbitrary environment key để đọc/ghi.

---

# XXIV. AUDIT CONFIG CHANGES

Mọi config mutation ghi:

```text
actor
timestamp
key
action
old_state
new_state
request_id
```

Secrets:

```text
old_state = configured
new_state = configured
```

Không audit raw secret.

---

# XXV. FEATURE FLAGS

Nếu phù hợp architecture:

tạo:

```text
/admin/settings/features
```

Fields:

```text
feature
enabled
scope
description
updated by
updated at
```

Scope nếu backend hỗ trợ:

```text
global
plan
organization
```

Không xây một feature flag platform quá phức tạp nếu codebase chưa cần.

---

# XXVI. HEALTH / OPERATIONS

Tạo:

```text
/admin/health
```

Cards:

```text
Application
PostgreSQL
Document Worker
Storage
WebSocket
Sync
Background Jobs
Backup
```

Show:

```text
Healthy
Degraded
Unavailable
Unknown
```

Không expose sensitive connection data.

Ví dụ:

```text
PostgreSQL
● Healthy
Latency: 18 ms

Document Worker
● Healthy
Queue: 3
```

---

# XXVII. DATABASE STATUS

Không cho admin arbitrary SQL console.

Chỉ read-only operational status:

```text
connectivity
version
connection pool usage
migration version
database size nếu available
slow/error summary nếu safe
```

Không expose credentials.

Không add:

```text
Run SQL
```

trừ khi product hiện tại đã có secure internal tooling và explicit requirement.

---

# XXVIII. WORKER / JOBS

Tạo nếu application có job/document worker:

```text
/admin/system/jobs
```

Show:

```text
queued
running
completed
failed
retrying
```

Functions chỉ khi backend support:

```text
retry failed job
inspect sanitized error
```

Không expose document content không authorized.

---

# XXIX. SYNC OPERATIONS

BiddingFlow là offline-first.

Tạo:

```text
/admin/system/sync
```

Metrics:

```text
sync requests
failed syncs
row-version conflicts
visibility resets
full sync requests
outbox-related server failures
WebSocket connection health
```

Không cho platform admin sửa client outbox trực tiếp.

---

# XXX. SECURITY CENTER

Tạo:

```text
/admin/security
```

Sections:

```text
Failed login
Session activity
Suspicious events
Authorization denies
Admin actions
```

Data phải lấy từ audit/security events hiện có.

Không log secrets.

Không leak tenant data beyond admin's authorized platform scope.

---

# XXXI. AUDIT LOG

Tạo:

```text
/admin/audit
```

Table:

```text
Time
Actor
Action
Resource
Organization
Result
Request ID
```

Filters:

```text
time
actor
organization
action
resource
result
```

Detail drawer hiển thị sanitized metadata.

Không render raw JSON vô kiểm soát.

Escape/sanitize content.

---

# XXXII. BUILD / VERSION PAGE

Tạo:

```text
/admin/system/version
```

Show:

```text
Application version
Build SHA
Build time
Environment
Schema version
Frontend bundle version
```

Không expose filesystem path hoặc deployment secrets.

---

# XXXIII. ADMIN DASHBOARD SEARCH

Nếu phù hợp:

global search:

```text
organization
user
invoice
subscription
```

Không search raw domain bidding data nếu dashboard scope không cần.

Kết quả phải server-authorized.

Không fetch toàn bộ DB rồi filter client-side.

---

# XXXIV. TABLE COMPONENT STANDARDIZATION

Tạo reusable admin data-table abstraction phù hợp vanilla JS architecture.

Support:

```text
server pagination
search
filter
sort
loading
empty state
error state
selection
responsive layout
```

Không duplicate table code ở 10 page.

Không tạo mega-component khó maintain.

---

# XXXV. DRAWER / DETAIL PANEL STANDARD

Dùng Tabler offcanvas/modal hoặc detail page.

Prefer:

```text
list
→ click
→ detail drawer
```

cho:

```text
users
organizations
invoices
subscriptions
```

Deep-link vẫn nên hoạt động nếu architecture routing support.

---

# XXXVI. DESIGN SYSTEM

Dashboard mới phải thống nhất:

```text
spacing
typography
border radius
iconography
badge semantics
table density
button hierarchy
form validation
loading state
empty state
error state
```

Không mix dashboard cũ và mới.

---

# XXXVII. RESPONSIVE

Support tối thiểu:

```text
desktop 1440
desktop 1280
tablet
mobile admin fallback
```

Admin data-heavy screens có thể ưu tiên desktop nhưng không được vỡ layout.

Tables có responsive strategy:

```text
horizontal scroll
priority columns
drawer
```

---

# XXXVIII. DARK MODE

Nếu Tabler integration và application hiện tại có theme support:

support:

```text
light
dark
system
```

Nếu app không có theme architecture:

không cần tạo massive theme rewrite.

Nhưng code mới không nên hard-code màu làm dark mode sau này bất khả thi.

---

# XXXIX. ACCESSIBILITY

Tối thiểu:

```text
keyboard navigation
focus states
aria labels
semantic form labels
accessible modals
chart text fallback where practical
contrast
```

Không chỉ optimize screenshot.

---

# XL. PERFORMANCE

Dashboard home không được gọi hàng chục endpoint serial.

Thiết kế:

```text
/admin/api/overview
```

hoặc aggregate service tương đương nếu hợp architecture.

Nhưng không tạo mega-endpoint vô hạn.

Analytics queries phải:

```text
aggregated in SQL/backend
bounded by date range
indexed where needed
```

Không tải toàn bộ rows về browser để thống kê.

---

# XLI. N+1

Admin tables/detail APIs phải tránh N+1.

Ví dụ Users table không được:

```text
GET users
then one query per user for organization
then one query per user for subscription
```

Use:

```text
JOIN
batched query
preload
```

theo style repo.

Chạy N+1 regression checks hiện có.

---

# XLII. ADMIN API NAMESPACE

Nếu cần API mới, ưu tiên namespace rõ:

```text
/api/admin/overview
/api/admin/analytics
/api/admin/organizations
/api/admin/users
/api/admin/plans
/api/admin/subscriptions
/api/admin/invoices
/api/admin/settings
/api/admin/health
```

Không bắt buộc exact names nếu routing convention khác.

Tất cả admin API:

```text
authenticate
authorize platform admin capability
validate input
audit mutations
```

---

# XLIII. API CONTRACT

Responses nên predictable:

```json
{
  "items": [],
  "pagination": {},
  "filters": {}
}
```

hoặc theo API convention hiện hữu.

Không tạo format thứ ba nếu project đã có canonical response pattern.

---

# XLIV. SERVER-SIDE PAGINATION

Users/organizations/invoices/subscriptions/audit không được load toàn bộ dataset.

Support:

```text
limit
cursor/page
sort
search
filters
```

Bound max limit.

Whitelist sortable columns.

Không concatenate SQL từ arbitrary user sort keys.

---

# XLV. SECURITY — SQL

Mọi admin filter/search:

parameterized.

Không:

```python
f"ORDER BY {request_param}"
```

trừ khi param map qua allowlist.

---

# XLVI. SECURITY — XSS

Admin dashboard sẽ hiển thị:

```text
user names
organization names
invoice descriptions
audit metadata
errors
```

Tất cả dữ liệu từ DB là untrusted.

Không dùng unsafe:

```js
innerHTML = record.name
```

trừ khi sanitized through repository-approved mechanism.

Giữ CSP/Trusted Types hiện có.

---

# XLVII. SECURITY — CSRF / SESSION

Reuse:

```text
apiClient
CSRF
session
tenant/platform context
```

Không bypass client security layer bằng raw `fetch()` nếu repo đã có abstraction.

---

# XLVIII. SECURITY — ADMIN ACTION CONFIRMATION

Dangerous actions:

```text
suspend organization
cancel subscription
void invoice
replace secret
disable registration
maintenance mode
terminate all sessions
```

phải có:

```text
explicit confirmation
```

High-risk action nên yêu cầu nhập tên/identifier nếu phù hợp UX.

---

# XLIX. AUDIT ADMIN MUTATIONS

Mọi admin mutation quan trọng:

```text
who
what
target
before/after metadata where safe
when
request id
result
```

Không audit secret.

---

# L. BILLING SAFETY

Tiền phải dùng:

```text
Decimal/integer minor units
```

theo convention backend hiện tại.

Không dùng JS float làm authoritative billing calculation.

UI chỉ format.

---

# LI. CURRENCY

Không hard-code:

```text
VND
```

nếu backend plans/billing đã support currency khác.

Nếu BiddingFlow hiện chỉ có VND:

UI có thể mặc định VND nhưng schema/component không nên làm sai dữ liệu.

---

# LII. DATE / TIMEZONE

Admin timestamps phải nhất quán.

Store/use server canonical timestamps.

Display theo configured admin timezone hoặc application convention.

Không mix timezone ngẫu nhiên.

---

# LIII. LEGACY DASHBOARD MIGRATION STRATEGY

Không xóa dashboard cũ ngay từ đầu.

Thực hiện:

```text
Phase 1
new admin shell

Phase 2
migrate page-by-page

Phase 3
feature parity test

Phase 4
switch default admin route

Phase 5
remove unreachable legacy UI

Phase 6
dead-code checks
```

Nếu cần temporary compatibility route:

được phép trong migration.

Nhưng final state:

legacy dashboard UI không còn là production entrypoint.

---

# LIV. KHÔNG ĐỂ HAI DASHBOARD SONG SONG VÔ THỜI HẠN

Definition cuối:

```text
Tabler dashboard = only active platform admin UI
```

Legacy implementation:

```text
removed
or reduced to reusable business modules only
```

Không để:

```text
/admin-old
```

ẩn trong production nếu không có lý do.

---

# LV. REUSE BUSINESS MODULES

Nếu dashboard cũ có function tốt:

```text
billing service
user service
organization service
analytics queries
settings service
```

reuse.

Đừng delete backend chỉ vì frontend cũ bị xóa.

---

# LVI. ADMIN FRONTEND STRUCTURE

Thiết kế module rõ ràng, ví dụ:

```text
frontend/admin/
├── AdminApp.js
├── AdminRouter.js
├── AdminShell.js
│
├── overview/
├── analytics/
├── organizations/
├── users/
├── billing/
│   ├── plans/
│   ├── subscriptions/
│   ├── invoices/
│   └── payments/
│
├── system/
│   ├── settings/
│   ├── environment/
│   ├── health/
│   └── jobs/
│
├── security/
│   ├── AuditLogPage.js
│   └── SecurityEventsPage.js
│
└── shared/
    ├── AdminApi.js
    ├── DataTable.js
    ├── MetricCard.js
    ├── ChartCard.js
    ├── FilterBar.js
    └── DetailDrawer.js
```

Không bắt buộc exact tree.

Dựa trên conventions thật của repo.

---

# LVII. BACKEND STRUCTURE

Nếu cần admin backend mới, tránh nhồi mọi thứ vào:

```text
backend/app.py
```

Ưu tiên module:

```text
backend/admin/
    api.py
    service.py
    repository.py
    schemas.py
    authorization.py
```

hoặc structure phù hợp project.

Giữ `app.py` chủ yếu composition/routing.

---

# LVIII. OVERVIEW QUERY DESIGN

Overview cần ít roundtrip.

Có thể tạo:

```text
AdminOverviewService
```

trả:

```text
organizations
users
subscriptions
billing
recent activity
system status summary
```

Không thực hiện 50 queries nếu có thể aggregate.

Dùng EXPLAIN/test query count nếu cần.

---

# LIX. ANALYTICS QUERY DESIGN

Không tính mọi metric realtime bằng full-table scans.

Nếu dataset nhỏ:

aggregate SQL có index.

Nếu dataset lớn/current architecture đã có aggregation:

reuse.

Không tự tạo analytics warehouse trong task này.

---

# LX. ADMIN CACHE

Không cache dữ liệu nhạy cảm ở browser lâu hơn cần thiết.

Không đưa admin user list/invoice data vào offline IndexedDB business workspace nếu không cần.

Platform admin dashboard không nhất thiết phải offline-first như bidding workspace.

Có thể hoạt động online-only nếu phù hợp product.

---

# LXI. KHÔNG TRỘN ADMIN DATA VÀ WORKSPACE SYNC

Không đưa:

```text
platform users
billing
invoices
secrets
```

vào generic `/api/sync` offline replication nếu architecture không yêu cầu.

Ưu tiên dedicated admin API.

---

# LXII. ERROR UX

Mọi admin page có:

```text
loading state
empty state
error state
retry
permission denied state
```

Không chỉ `console.error`.

Toast:

success chỉ sau server-confirmed mutation.

Không lặp lại bug:

```text
local success
+
server error
```

---

# LXIII. CONFIRMATION UX

Ví dụ:

```text
Suspend organization ABC?
Users in this organization may lose access.
```

Không dùng generic:

```text
Are you sure?
```

cho mọi action.

---

# LXIV. ACTIVITY FEED

Dashboard overview có:

```text
recent organizations
new subscriptions
invoices paid
subscription changes
admin security events
```

Chỉ lấy audit/activity data thật.

---

# LXV. NOTIFICATIONS / ALERTS

Có thể bổ sung system alerts:

```text
invoice overdue spike
worker unavailable
backup stale
storage warning
DB degraded
subscription payment failure
```

Không implement complex alerting engine nếu project chưa có.

Một alert panel read-only từ health/billing data là đủ.

---

# LXVI. BACKUP STATUS

Nếu backend có backup infrastructure:

show:

```text
last successful backup
status
age
restore drill status nếu available
```

Không cho download raw DB backup từ browser trừ khi product có secure feature đó.

---

# LXVII. STORAGE DASHBOARD

Show:

```text
total managed assets
storage used
document assets
organization usage
failed cleanup if measurable
```

Không expose filesystem paths.

---

# LXVIII. INVOICE EXPORT

Nếu legacy dashboard có invoice download/export:

phải giữ.

Nếu chưa có:

có thể bổ sung nếu backend/document system đã support an toàn.

Không bắt buộc xây PDF invoice engine mới chỉ để hoàn thiện UI.

---

# LXIX. EXPORT ANALYTICS

Có thể bổ sung:

```text
CSV/XLSX export
```

cho admin tables/analytics nếu repository đã có safe export infrastructure.

Nếu không:

không mở một task lớn ngoài scope.

---

# LXX. ADMIN IMPERSONATION

KHÔNG tự động thêm:

```text
Login as user
impersonate
```

Đây là feature security-sensitive.

Chỉ implement nếu legacy dashboard đã có explicit capability và audit/security rules.

Nếu không có:

đề xuất future feature, không triển khai.

---

# LXXI. SOFT DELETE / DESTRUCTIVE OPERATIONS

Không thêm destructive delete cho:

```text
user
organization
invoice
subscription
```

nếu backend hiện dùng lifecycle/status.

Reuse product lifecycle.

---

# LXXII. DB SCHEMA

Ưu tiên reuse existing DB.

Chỉ thêm table/column nếu feature mới thực sự cần.

Nếu cần migration:

- immutable sequential migration;
- upgrade test;
- fresh DB test;
- FK index check;
- schema contract;
- no destructive migration.

---

# LXXIII. DASHBOARD TEST STRATEGY

## Unit tests

Test:

```text
formatters
filters
pagination
API client
permission gating
chart data transforms
secret masking
```

## Backend tests

Test:

```text
admin authorization
tenant/platform boundaries
pagination
filtering
billing values
config allowlist
secret redaction
audit
```

## E2E

Playwright:

```text
admin login
dashboard load
users
organizations
plans
subscriptions
invoices
settings
environment secret masking
```

---

# LXXIV. LEGACY FEATURE PARITY TESTS

Trước khi xóa old dashboard:

lấy test/use cases hiện tại.

Tạo parity checklist.

Ví dụ:

```text
Legacy user search
Legacy organization detail
Legacy plan update
Legacy invoice action
Legacy settings mutation
...
```

Tất cả phải:

```text
PASS in new dashboard
```

---

# LXXV. VISUAL E2E

Chạy ít nhất:

```text
Chromium
Firefox
WebKit
```

Tại:

```text
1440x900
1280x800
mobile/tablet representative viewport
```

Kiểm tra:

```text
sidebar
tables
modal
drawer
chart
forms
dark/light nếu có
```

Không chỉ screenshot compare nếu repo chưa có visual regression system.

---

# LXXVI. CI

Đọc GitHub workflows mới nhất trước.

Không dùng command trong prompt này nếu repo HEAD đã đổi.

At minimum chạy equivalents:

```bash
npm run check:static
```

Python tests + critical coverage.

```bash
npm run test:js:coverage
npm run build:secure
npm run check:e2e-discovery
npm run test:e2e:smoke
```

Và full Playwright workflow relevant.

Run N+1 regression.

Run package/dependency/security checks.

---

# LXXVII. KHÔNG LÀM YẾU CI

Không:

```text
skip test
increase retries blindly
continue-on-error
|| true
reduce coverage
remove browser
disable security checks
increase debt budget just to pass
```

Fix root cause.

---

# LXXVIII. TABLER ASSET SECURITY

Không load production Tabler JS/CSS từ random CDN nếu secure build/CSP hiện tại yêu cầu vendoring.

Ưu tiên:

```text
vendor assets
pin version
verify license
secure build inclusion
CSP-compatible
```

Không thêm third-party network dependency ở runtime mà không cần.

---

# LXXIX. LICENSE

Xác minh Tabler package/assets đang sử dụng có license phù hợp.

Giữ required attribution/license file theo quy định.

Không copy premium-only assets nếu không có quyền.

---

# LXXX. REMOVE LEGACY ASSETS

Sau migration:

find:

```text
old dashboard CSS
old dashboard JS
unused HTML
old route
unused API adapters
dead icons
```

Remove chỉ khi:

```text
reachability test
build
E2E
```

chứng minh không còn dùng.

Không xóa business service chỉ vì tên chứa `dashboard`.

---

# LXXXI. PERFORMANCE BUDGET

Đo trước/sau:

```text
admin JS bundle
CSS size
initial requests
dashboard load
```

Không để Tabler integration import toàn bộ unused demos/assets.

Tree-shake/prune nếu build system hỗ trợ.

---

# LXXXII. EMPTY DATA

New installation phải render đẹp khi:

```text
0 users
0 organizations
0 invoices
0 subscriptions
```

Không crash chart.

Show actionable empty state.

---

# LXXXIII. LARGE DATA

Test synthetic/fixture scale:

```text
10k users
1k organizations
many invoices
large audit log
```

Dashboard không được render tất cả client-side.

---

# LXXXIV. SEARCH DEBOUNCE / REQUEST CANCELLATION

Admin live search phải:

- debounce;
- avoid request race;
- latest result wins;
- abort stale requests where appropriate.

Không để query cũ overwrite query mới.

---

# LXXXV. NAVIGATION STATE

Refresh:

```text
/admin/invoices/INV-123
```

không được đá user về dashboard home nếu deep route support.

Browser back/forward phải hợp lý.

---

# LXXXVI. AUTH EXPIRY

Nếu admin session hết hạn:

dashboard phải:

```text
stop privileged calls
redirect/re-auth according to existing app behavior
```

Không loop request.

---

# LXXXVII. PLATFORM ADMIN LANDING

Sau platform admin login:

đi tới:

```text
/admin
```

Organization user bình thường:

không thấy Admin sidebar.

Direct request:

```text
/admin
```

phải bị server/frontend auth guard đúng cách.

Không chỉ hide menu.

---

# LXXXVIII. DOCUMENT CURRENT ARCHITECTURE

Sau migration, thêm/update docs:

```text
Admin Dashboard Architecture
Admin Roles
Admin API
Config/Secret Management
Billing Dashboard
```

Không cần over-document từng component.

---

# LXXXIX. CODEBASE MAP DELIVERABLE

Trước khi edit, ghi:

```text
Legacy Dashboard
Frontend entry
Routes
API
Backend
Tables
Permissions
Tests
```

Sau migration, ghi:

```text
New Dashboard
Page
Frontend module
API
Backend service
DB tables
Permission
```

---

# XC. FEATURE PARITY MATRIX DELIVERABLE

Final report phải có:

```text
Feature
Legacy
New
Test
Status
```

Không được chỉ nói:

```text
“dashboard redesigned successfully”
```

---

# XCI. NEW FEATURE MATRIX

Tách rõ:

```text
Migrated legacy functionality
```

và:

```text
Newly added functionality
```

để reviewer biết scope.

---

# XCII. WORK ORDER

## Phase 0 — Baseline

```text
git status
HEAD SHA
origin/main
CI baseline
```

## Phase 1 — Reverse engineer legacy dashboard

Không sửa code.

Lập feature map.

## Phase 2 — Tabler shell

Tạo:

```text
/admin
sidebar
header
routing
auth guard
base components
```

## Phase 3 — Overview + analytics

## Phase 4 — Organizations + users

## Phase 5 — Plans + subscriptions

## Phase 6 — Invoices + payments

## Phase 7 — System settings + environment

## Phase 8 — Audit + security + health

## Phase 9 — Migrate remaining legacy features

## Phase 10 — Feature parity validation

## Phase 11 — Switch production entry

## Phase 12 — Remove legacy dashboard

## Phase 13 — Full CI/E2E/security validation

---

# XCIII. PATCH STRATEGY

Giữ patch reviewable:

```text
A. Admin shell + Tabler assets
B. Overview/analytics
C. Organization/user management
D. Billing plans/subscriptions
E. Invoice/payment UI
F. Settings/environment security
G. Health/audit/security
H. Remaining legacy migrations
I. E2E/parity tests
J. Legacy dashboard removal
```

Không một giant commit.

---

# XCIV. DEFINITION OF DONE — UI

Dashboard cũ đã được thay thế hoàn toàn.

Production admin route dùng Tabler dashboard.

Không còn giao diện legacy được reachable ngoài backward-compatible redirect tạm thời nếu thực sự cần.

UI:

```text
clean
consistent
responsive
accessible
```

---

# XCV. DEFINITION OF DONE — FEATURE PARITY

Mọi chức năng dashboard cũ:

```text
migrated
tested
```

Không có:

```text
“feature này quên migrate”
```

Feature cũ nào intentionally removed phải:

- có lý do;
- có approval/product contract;
- có replacement.

Không tự ý remove.

---

# XCVI. DEFINITION OF DONE — REQUIRED FEATURES

Phải có hoạt động thực sự:

```text
Overview
Analytics
Organizations
Users
Plans
Subscriptions
Invoices
System Settings
Environment/Secrets
Audit
Health
```

Không chỉ static page.

---

# XCVII. DEFINITION OF DONE — SECURITY

Chứng minh:

```text
normal organization user cannot access /admin
platform authorization server-side
secrets never returned
secrets never logged
admin mutation audited
search/filter parameterized
XSS protections preserved
CSRF/session preserved
CSP/Trusted Types preserved
```

---

# XCVIII. DEFINITION OF DONE — ENV

Không có API trả raw environment dump.

Secret UI chỉ có:

```text
configured
missing
replace
```

Runtime config có schema/allowlist.

Unsupported deployment secrets được hiển thị read-only status thay vì edit giả.

---

# XCIX. DEFINITION OF DONE — CI

Target:

```text
check:static PASS
Python tests PASS
critical coverage PASS
JS coverage PASS
secure build PASS
Playwright smoke PASS
admin E2E PASS
existing workflow E2E PASS
N+1 PASS
DB checks PASS
dependency/security checks PASS
```

Nếu production legal release gate còn blocked bởi external legal facts:

không fake approval.

Báo riêng.

---

# C. FINAL SELF-REVIEW

Trước khi hoàn thành:

```bash
git status
git diff --check
git diff --stat
git diff
```

Tự hỏi:

## Feature parity

Có chức năng dashboard cũ nào biến mất không?

## Security

Có endpoint admin nào thiếu server authorization không?

## Secrets

Có secret nào đi xuống frontend/log không?

## Billing

Có giá trị tiền nào được authoritative calculate bằng JS float không?

## Performance

Có N+1/full table load không?

## UI

Có trang nào chỉ đẹp trên screenshot nhưng không xử lý loading/error/empty không?

## CI

Có check nào bị disable chỉ để xanh không?

Nếu có:

task chưa hoàn thành.

---

# CI. FINAL RESPONSE FORMAT

Trả về báo cáo:

## 1. Baseline

```text
HEAD
branch
CI status
```

## 2. Legacy Dashboard Inventory

Bảng:

```text
Legacy Feature
Old File
Old API
New Destination
```

## 3. New Admin Architecture

```text
/admin
frontend modules
backend APIs
authorization
DB
```

## 4. Screens / Features Added

Liệt kê:

```text
Overview
Analytics
Organizations
Users
Plans
Subscriptions
Invoices
Payments
Settings
Environment
Audit
Health
...
```

## 5. Feature Parity Matrix

```text
Feature | Old | New | Test | Status
```

## 6. Security Model

Ghi:

```text
admin auth
secret handling
audit
CSRF
XSS
SQL
```

## 7. Environment Model

Phân biệt:

```text
runtime config
deployment config
secrets
```

## 8. Backend/API Changes

Mỗi API:

```text
route
permission
service
tables
```

## 9. Database Changes

Nếu không có:

```text
No schema migration required
```

Nếu có:

giải thích migration.

## 10. Tests

Exact commands và exit codes.

## 11. CI Before / After

```text
Check
Before
After
```

## 12. Performance

Ghi:

```text
bundle impact
query design
N+1
pagination
```

## 13. Legacy Removal

Liệt kê:

```text
files/routes/assets removed
```

và evidence không còn dùng.

## 14. Remaining Risks

Không che giấu phần chưa verify.

## 15. Recommended Next Steps

Tối đa 5 mục.

---

# CII. ABSOLUTE RULES

Không:

```text
rewrite framework
React/Vue migration
fake backend data
fake analytics
fake invoice
fake legal fact
expose raw env
expose secrets
disable authorization
disable CSRF
disable CSP
disable Trusted Types
load all users client-side
calculate authoritative billing in browser
weaken CI
skip E2E to make build green
delete legacy dashboard before parity verification
```

Ưu tiên:

```text
FEATURE PARITY
+
SECURITY
+
CORRECT DATA
+
CLEAR UX
+
MAINTAINABILITY
```

hơn việc hoàn thành nhanh.

Dashboard mới phải là một **Platform Operations Console thực sự**, không chỉ là một bộ giao diện Tabler đẹp.