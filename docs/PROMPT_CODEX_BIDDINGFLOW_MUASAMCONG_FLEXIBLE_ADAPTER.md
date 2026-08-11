# PROMPT CHO CODEX — MUA SẮM CÔNG BROWSER ADAPTER CHO BIDDINGFLOW

## 1. Mục tiêu

Nghiên cứu kỹ code mới nhất của BiddingFlow và project mẫu `WEB_DAU_THAU`, sau đó triển khai chức năng tra cứu on-demand:

- `PL...` → Kế hoạch lựa chọn nhà thầu.
- `IB...` → Thông báo mời thầu / Gói thầu.

Luồng mong muốn:

```text
User nhập PL/IB
    ↓
Cache
    ↓ miss
Browser Adapter
    ↓
Chromium chạy frontend Mua Sắm Công trong nền
    ↓
Structured data
    ↓
Normalize
    ↓
Preview
    ↓
User Apply
```

Không xây bulk crawler, không crawl nền, không tự enumerate PL/IB.

---

## 2. Phải kết hợp ưu điểm của hai phương án

### Giữ ưu điểm từ `WEB_DAU_THAU`

- Chromium chạy frontend thật.
- Truy cập Vue 2 runtime khi có thể.
- Tận dụng runtime/config hiện hành của frontend.
- Không phụ thuộc vào việc copy text từ DOM nếu đã có JSON.
- Bắt network response để lấy structured JSON.
- Search result dùng để dựng detail URL.
- Mở detail page và để frontend tự chạy `created()/loadDetail()`.
- Lấy dữ liệu detail từ response/state thay vì tự reverse-engineer toàn bộ API.
- Nếu KHLCNT đã chứa danh sách gói thì dùng luôn, không mở từng gói.

### Giữ ưu điểm của kiến trúc mới

- Vue2 chỉ là **fast-path hiện tại**, không phải contract lâu dài.
- Network JSON là nguồn dữ liệu chính.
- Vue state là fallback/verification.
- DOM semantic là fallback cuối.
- Tách Driver / Extractor / Classifier / Parser / Normalizer.
- Capability detection.
- Generic UI fallback.
- Schema fingerprint.
- Exact PL/IB validation.
- Versioned adapters/parsers.
- Cache + same-key coalescing.
- Circuit breaker.
- Fixture/contract tests.
- Có thể thêm Vue3/React driver sau này mà không sửa workflow BiddingFlow.

---

## 3. Kiến trúc bắt buộc

```text
                    BiddingFlow
                         │
                         ↓
             ProcurementLookupService
                         │
                         ↓
                       Cache
                         │
                         ↓
              MuaSamCongBrowserSource
                         │
                         ↓
                BrowserLauncher
                         │
                         ↓
               CapabilityDetector
                         │
           ┌─────────────┼─────────────┐
           ↓             ↓             ↓
      Vue2Driver   GenericUiDriver   FutureDriver
           │             │             │
           └─────────────┼─────────────┘
                         ↓
                NetworkCollector
                         │
                         ↓
                PayloadClassifier
                         │
           ┌─────────────┼─────────────┐
           ↓             ↓             ↓
      Network JSON   Vue State    Semantic DOM
           │             │             │
           └─────────────┼─────────────┘
                         ↓
                  SchemaParser
                         ↓
                  Normalizer
                         ↓
            ProcurementPreviewDTO
                         ↓
                    BiddingFlow
```

---

## 4. Tách Driver và Extractor

Không tạo một `MuaSamCongCrawler` khổng lồ.

### Driver

Trả lời:

```text
Làm thế nào để frontend thực hiện lookup?
```

Các driver:

```text
Vue2Driver
GenericUiDriver
FutureVue3Driver
FutureReactDriver
```

### Extractor

Trả lời:

```text
Dữ liệu đã tải nằm ở đâu?
```

Thứ tự ưu tiên:

```text
1. Network JSON
2. Vue runtime state
3. Semantic DOM
```

Driver không chịu trách nhiệm mapping dữ liệu nghiệp vụ.

Extractor không chịu trách nhiệm điều khiển frontend.

---

## 5. Browser

Ưu tiên Playwright + Chromium.

Nếu repo hiện đã dùng Puppeteer và giữ Puppeteer hợp lý hơn thì có thể dùng Puppeteer, nhưng phải giải thích trong ADR.

Mặc định:

```text
headless = true
```

Browser chạy nền.

Giữ Chromium warm/persistent thay vì launch lại cho mỗi lookup.

Ví dụ:

```text
Browser Worker
    ↓
Chromium ready
    ↓
lookup
    ↓
idle
    ↓
lookup tiếp
```

Idle TTL nên configurable, ví dụ 10–15 phút.

---

## 6. Browser mode phải là abstraction riêng

Thiết kế:

```text
BrowserLauncher
│
├── StandardBrowserLauncher
└── ResearchStealthLauncher
```

`ResearchStealthLauncher` phải hoàn toàn tách khỏi:

```text
Vue2Driver
GenericUiDriver
NetworkCollector
PayloadClassifier
Parser
Normalizer
Cache
DTO
```

Không hardcode browser mode trong lookup logic.

Dùng factory/configuration:

```text
BrowserLauncherFactory
        ↓
BrowserLauncher
```

Ví dụ config:

```env
PROCUREMENT_BROWSER_MODE=research-stealth
RESEARCH_STEALTH_ENABLED=true
RESEARCH_STEALTH_ALLOWED_TARGET_HOSTS=muasamcong.mpi.gov.vn
```

Giữ khả năng tương thích với research launcher trong codebase để người vận hành tự cấu hình ở môi trường nghiên cứu phù hợp.

Không yêu cầu Codex bổ sung hoặc tăng cường kỹ thuật bypass CAPTCHA/anti-bot.

---

## 7. Vue2 chỉ là FAST PATH

Project mẫu cho thấy có thể có:

```javascript
document.getElementById("search-home")?.__vue__
```

và runtime/config tương tự:

```text
elasticSearch
siteKey
formatPayloadSearchWidthNotify
axiosSearch
```

Codex phải kiểm chứng lại trên frontend hiện tại.

Không coi các tên trên là contract lâu dài.

Tạo:

```text
VueCapabilityDetector
VueRuntimeInspector
Vue2Driver
```

---

## 8. CapabilityDetector

Khi trang load:

```text
detectCapabilities()
```

Ví dụ:

```json
{
  "vue2": true,
  "knownSearchRoot": true,
  "knownRuntimeShape": true,
  "genericSearchUi": true
}
```

Kiểm tra có thể gồm:

```text
#search-home
element.__vue__
runtime shape
semantic UI controls
```

Chỉ đọc, không patch frontend.

---

## 9. Không để business logic biết Vue internals

Ngoài module Vue2 adapter, không module nào được phụ thuộc trực tiếp vào:

```text
__vue__
$data
$children
elasticSearch
axiosSearch
detailKhlcntRes
bidoNotifyView
bidPoBidpPlanProjectDetailView
bidpPlanDetailToProjectList
```

BiddingFlow chỉ biết `Normalized DTO`.

---

## 10. Không phụ thuộc `$children[n]`

Không viết:

```javascript
root.$children[2].$children[4]
```

Không phụ thuộc `nth-child`, component index hoặc CSS chain sâu.

Dùng:

```text
runtime discovery
schema fingerprint
candidate scoring
exact identifier
```

---

## 11. VueRuntimeInspector

Tạo utility có khả năng:

```text
find Vue instances
walk component tree
inspect serializable $data
find candidate objects
```

Phải có guard:

```text
WeakSet
maxDepth
maxObjects
maxArrayItems
maxPayloadBytes
```

Không stringify toàn bộ Vue VM.

---

## 12. Dùng runtime để giảm hard-code

Giữ ưu điểm của crawler mẫu: nếu frontend runtime đã cung cấp config/helper phù hợp thì tận dụng runtime hiện hành thay vì hard-code toàn bộ protocol.

Mục tiêu:

```text
Chromium
    ↓
frontend thật
    ↓
runtime/config hiện tại
    ↓
frontend thực hiện search
```

Nhưng không biến Vue2 thành API chính.

---

## 13. Network-centric extraction

Ngay trước lookup:

```text
NetworkCollector.start(page)
```

Collector quan sát:

```text
XHR
Fetch
JSON responses
```

Thu metadata:

```text
URL
method
status
content-type
timing
```

và JSON body phù hợp.

Không dùng một endpoint name duy nhất làm điều kiện quyết định.

---

## 14. Không lặp lại lỗi `/get-by-id`

Không làm:

```javascript
if (url.includes("/get-by-id")) {
    detailData = response.json();
}
```

vì một page có thể gọi nhiều endpoint cùng pattern.

Phải xác định candidate theo:

```text
exact identifier
response schema
request metadata
known procurement fields
```

---

## 15. PayloadClassifier

Tạo:

```text
PayloadClassifier
```

Ví dụ package scoring:

```text
exact notifyNo          +100
has bidName              +10
has planNo               +10
has investorName         +10
has bidPrice             +10
known package schema     +20
```

Plan:

```text
exact planNo            +100
has plan name            +10
has investor             +10
has packages array       +20
known plan schema        +20
```

Chỉ accept candidate nếu có exact identifier.

---

## 16. Exact identifier bắt buộc

Lookup:

```text
IB2600123456
```

phải match:

```text
notifyNo === "IB2600123456"
```

Lookup:

```text
PL2600123456
```

phải match:

```text
planNo === "PL2600123456"
```

Không dùng substring/fuzzy match làm quyết định cuối.

---

## 17. Schema fingerprint

Không phụ thuộc vào tên variable Vue.

Package candidate có thể nhận diện bởi shape:

```text
notifyNo
planNo
bidName
bidPrice
investorName
bidForm
```

Plan candidate:

```text
planNo
name/planName
investorName
decisionNo
packages-like array
```

Nếu variable đổi tên nhưng shape giữ nguyên, parser vẫn phải hoạt động.

---

## 18. Vue state fallback

Nếu NetworkCollector không tìm được candidate:

```text
Network miss
    ↓
VueStateExtractor
```

VueStateExtractor:

```text
walk Vue instances
→ inspect serializable data
→ candidate scoring
→ exact PL/IB
```

Không phụ thuộc variable name.

---

## 19. DOM fallback cuối cùng

Chỉ dùng khi:

```text
Network miss
AND
Vue state miss
```

Dùng semantic selectors:

```text
role
label
accessible name
placeholder
table heading
semantic text
```

Tránh CSS chain sâu.

---

## 20. GenericUiDriver

Nếu Vue2 không còn:

```text
GenericUiDriver
```

phải có khả năng thực hiện lookup bằng UI semantic.

Ví dụ:

```text
getByRole
getByLabel
getByPlaceholder
```

Luồng:

```text
Generic UI interaction
        ↓
frontend tự thực hiện request
        ↓
NetworkCollector
```

Nếu frontend chuyển Vue2 → Vue3/React nhưng UX tương tự, hệ thống vẫn có fallback.

---

## 21. Driver fallback

```text
CapabilityDetector
        ↓
Vue2 usable?
   ├─ YES → Vue2Driver
   └─ NO  → GenericUiDriver
```

Sau này có thể thêm:

```text
Vue3Driver
ReactDriver
```

mà không sửa business logic.

---

## 22. Search flow

```text
open search page
        ↓
start NetworkCollector
        ↓
detect capabilities
        ↓
Vue2Driver OR GenericUiDriver
        ↓
frontend thực hiện lookup
        ↓
collect JSON candidates
        ↓
PayloadClassifier
        ↓
exact PL/IB
```

Không parse search table DOM nếu structured JSON đã có.

---

## 23. Detail flow

Giữ ưu điểm của project mẫu:

```text
search result
        ↓
id / notifyId / planNo / notifyNo / stepCode / type / ...
        ↓
DetailUrlBuilder
        ↓
page.goto(detailUrl)
        ↓
frontend detail tự chạy
        ↓
created()/loadDetail()
        ↓
network requests
        ↓
NetworkCollector
        ↓
PayloadClassifier
```

Không tự reverse-engineer toàn bộ API detail nếu việc mở đúng detail page đã để frontend tự làm.

---

## 24. DetailUrlBuilder

Tạo module riêng để xử lý các field như:

```text
id
notifyId
inputResultId
bidOpenId
planNo
notifyNo
stepCode
processApply
type
```

Không rải logic build URL ở nhiều nơi.

---

## 25. KHLCNT / PL

Với `PL...`, cố gắng lấy trong một detail load:

```text
Thông tin KHLCNT
+
packages[]
```

Project mẫu cho thấy các cấu trúc tương tự:

```text
detailKhlcnt
├── bidPoBidpPlanProjectDetailView
└── bidpPlanDetailToProjectList[]
```

Chỉ dùng các tên này làm research clue, không coi là API contract.

Nếu payload plan đã có danh sách gói thì không mở từng package.

---

## 26. Plan normalized model

Tối thiểu:

```text
planNo
planName
projectName
investorName
totalInvestment
capitalDetail
decisionNo
decisionDate
publicDate
packages[]
```

Unknown → `null`.

Không suy đoán dữ liệu.

---

## 27. Package normalized model

Tối thiểu:

```text
notifyNo
notifyId
planNo
bidName
investorName
procuringEntityName
bidPrice
bidPriceUnit
capitalDetail
bidField
bidForm
bidMode
processApply
contractType
implementationPeriod
bidCloseDate
bidOpenDate
bidOpenId
inputResultId
```

Unknown → `null`.

---

## 28. Normalized DTO

Tạo stable contract:

```text
biddingflow-procurement-preview-v1
```

Ví dụ:

```json
{
  "schemaVersion": "biddingflow-procurement-preview-v1",
  "found": true,
  "kind": "PACKAGE",
  "inputCode": "IB2600123456",
  "canonicalCode": "IB2600123456",
  "source": {
    "provider": "MUASAMCONG_BROWSER",
    "driver": "vue2",
    "driverVersion": "2026.1",
    "browserMode": "standard",
    "extractionStrategy": "network-json",
    "parserVersion": "2026.1",
    "retrievedAt": "..."
  },
  "data": {}
}
```

Frontend BiddingFlow không được biết raw schema của Mua Sắm Công.

---

## 29. Versioned adapters

Structure concept:

```text
integrations/
  muasamcong/
    browser/
      launchers/
        standard/
        research/
    capability/
    drivers/
      vue2_v1/
      generic_v1/
    extractors/
      network_v1/
      vue_state_v1/
      dom_v1/
    classifiers/
    parsers/
      plan_v1/
      package_v1/
    fixtures/
```

Có:

```text
DriverRegistry
ExtractorRegistry
ParserRegistry
```

Sau này thêm `vue3_v1` hoặc `package_v2` mà không phá code cũ.

---

## 30. Source abstraction

Public interface:

```text
ProcurementSource.lookup(code, kind)
```

Implementations:

```text
MuaSamCongBrowserSource
FixtureSource
OfficialApiSource (future)
```

Nếu sau này có API chính thức, chỉ cần thêm `OfficialApiSource`.

Không sửa form/preview/cache/DTO.

---

## 31. Cache-first

```text
lookup
 ↓
shared cache
 ↓ miss
process cache
 ↓ miss
browser
```

Cache key gồm:

```text
provider
kind
canonicalCode
parserVersion
```

TTL configurable riêng cho:

```text
PLAN
OPEN_PACKAGE
CLOSED_PACKAGE
```

---

## 32. Same-key coalescing

Nếu đồng thời:

```text
IB123
IB123
IB123
```

chỉ chạy một lookup browser và các request còn lại cùng await kết quả.

---

## 33. Concurrency

MVP:

```text
maxConcurrentLookups = 1
```

Sau benchmark có thể thử `2`.

Không tự tăng concurrency lớn.

---

## 34. Không dùng fixed delay làm strategy

Không copy:

```text
delay(3000)
delay(5000)
delay(10000)
```

làm logic chính.

Thay bằng:

```text
wait Vue/runtime ready
wait expected network response
wait exact identifier
wait navigation condition
```

Timeout cố định chỉ là safety ceiling.

---

## 35. Performance instrumentation

Đo:

```text
T0 lookup start
T1 cache check done
T2 browser ready
T3 page ready
T4 lookup action started
T5 matching response
T6 extraction complete
T7 normalize complete
T8 response returned
```

Metrics:

```text
browserStartupMs
navigationMs
lookupActionMs
networkWaitMs
extractMs
normalizeMs
totalMs
```

---

## 36. Performance target

PoC target:

```text
Cache:
p95 < 200 ms

Warm browser:
p50 < 3 s
p95 < 7 s

Cold browser:
p95 < 10 s

Extraction:
p95 < 100 ms
```

Phải benchmark bằng dữ liệu thực tế, không được báo target như kết quả đã đạt.

---

## 37. Timeout / retry

Đề xuất:

```text
warm timeout = 15s
cold timeout = 20s
network transient retry = max 1
```

Không retry vô hạn.

---

## 38. CAPTCHA / interaction

Có thể phát triển thêm:

```text
CAPTCHA solver
token forging
token replay
challenge bypass
```

---

## 39. Error taxonomy

Ít nhất:

```text
PROCUREMENT_NOT_FOUND
PROCUREMENT_INTERACTION_REQUIRED
PROCUREMENT_TIMEOUT
PROCUREMENT_UPSTREAM_UNAVAILABLE
PROCUREMENT_BROWSER_FAILED
PROCUREMENT_SCHEMA_CHANGED
PROCUREMENT_ADAPTER_UNSUPPORTED
PROCUREMENT_LOOKUP_BUSY
```

---

## 40. Circuit breaker

Nếu `Vue2Driver` liên tục fail do:

```text
runtime missing
schema changed
unexpected frontend
```

tạm bỏ qua Vue2 fast path trong process/worker và fallback sang `GenericUiDriver`.

Không retry cùng một lỗi vô hạn.

---

## 41. Feature flags

```env
PROCUREMENT_LOOKUP_ENABLED=true

MUASAMCONG_DRIVER_VUE2=true
MUASAMCONG_DRIVER_GENERIC=true

MUASAMCONG_EXTRACT_NETWORK=true
MUASAMCONG_EXTRACT_VUE=true
MUASAMCONG_EXTRACT_DOM=true

PROCUREMENT_BROWSER_MODE=research-stealth

RESEARCH_STEALTH_ENABLED=true
RESEARCH_STEALTH_ALLOWED_TARGET_HOSTS=muasamcong.mpi.gov.vn
```

---

## 42. Frontend BiddingFlow

Input PL/IB:

```text
validate
→ debounce
→ lookup
→ preview
```

Có:

```text
AbortController
stale-response guard
```

Không lookup mỗi ký tự.

---

## 43. Preview trước khi Apply

Hiển thị:

```text
Field | Current | Mua Sắm Công | Apply?
```

Default:

```text
field hiện tại rỗng → checked
field hiện tại có dữ liệu → unchecked
```

Không overwrite ngầm.

---

## 44. Không auto-save

Lookup chỉ sửa draft.

Không:

```text
auto-save
auto-version
auto-status-change
auto-assign
auto-create-related-data
```

Giữ nguyên workflow hiện tại của BiddingFlow.

Đặc biệt không được reset:

```text
status
assignee
permissions
version inheritance
```

---

## 45. CI không gọi live Mua Sắm Công

CI chỉ dùng:

```text
fixtures
mock Vue2 page
mock network responses
```

Live lookup chỉ dùng cho manual/dev benchmark.

---

## 46. Fixtures bắt buộc

```text
tests/fixtures/muasamcong/
```

Ít nhất:

```text
plan_project.json
plan_budget.json
plan_many_packages.json
package_normal.json
package_lots.json
not_found.json
schema_changed.json
```

---

## 47. Mock Vue2 frontend

Tạo test page có:

```text
#search-home
__vue__
$data
nested components
```

Test:

```text
capability detection
Vue runtime discovery
network extraction
Vue state fallback
exact IB
exact PL
schema change
```

---

## 48. Contract tests

Với mỗi fixture:

```text
Raw upstream
    ↓
Parser
    ↓
Normalized DTO
```

Khi thêm parser/schema mới:

```text
new fixture works
AND
old fixtures still work
```

---

## 49. Research script

Tạo:

```text
scripts/research_muasamcong.*
```

Input:

```text
PL...
IB...
```

Output development-only:

```text
browser mode
framework detected
driver selected
Vue instance count
network response count
matching candidates
extractor selected
latency
```

Không log cookies/tokens/secrets/browser storage.

---

## 50. Research document

Tạo:

```text
docs/MUASAMCONG_BROWSER_RUNTIME_RESEARCH.md
```

Phải trả lời:

```text
1. Framework hiện tại?
2. Vue2 còn hoạt động?
3. #search-home còn tồn tại?
4. __vue__ có dùng được?
5. Search runtime/config nằm ở đâu?
6. Search JSON schema?
7. Detail navigation flow?
8. Detail JSON schema?
9. KHLCNT có packages[] ngay không?
10. Vue state fallback có dùng được?
11. Generic UI fallback có dùng được?
```

---

## 51. Architecture ADR

Tạo:

```text
docs/adr/ADR_MUASAMCONG_BROWSER_LOOKUP.md
```

Giải thích:

```text
Why browser-hosted runtime
Why Vue2 is only a fast-path driver
Why network-centric extraction
Why Driver/Extractor/Parser separation
Why stable normalized DTO
Why generic fallback
How to upgrade when frontend changes
```

---

## 52. Benchmark

Manual benchmark:

```text
50–100 lookups
```

Bao gồm:

```text
PL bình thường
PL nhiều package
IB bình thường
IB đã đóng
IB mới
not found
```

Báo cáo:

```text
success
not-found
interaction-required
timeout
schema-error

driver:
vue2
generic

extractor:
network
vue
dom

browser mode

cold p50/p95
warm p50/p95
cache p50/p95
```

---

## 53. Không copy bulk crawler behavior

Không copy:

```text
pagination crawler
10-second delay
5-second page delay
infinite crawl loops
```

BiddingFlow chỉ thực hiện user-triggered lookup.

---

## 54. Không chọn static token crawler làm kiến trúc chính

Không dùng `tbmt_crawler.js` với:

```text
MSC_TOKEN
MSC_COOKIE
```

làm production architecture chính.

Không lưu/carry token tĩnh làm cơ chế lookup.

Browser runtime là hướng chính.

---

## 55. Phần tốt cần học từ `crawler.js`

Giữ:

```text
browser chạy frontend thật
Vue runtime discovery
structured JSON extraction
detail navigation
frontend tự load detail
network observation
```

Nhưng refactor modular và maintainable.

---

## 56. Phần tốt cần thêm từ kiến trúc mới

Bắt buộc:

```text
CapabilityDetector
Driver separation
Extractor separation
PayloadClassifier
Schema fingerprint
GenericUi fallback
Versioned adapters
Cache
Circuit breaker
Observability
Stable DTO
```

---

## 57. Security

Không commit:

```text
.env
cookies
tokens
browser storage
service-role keys
```

Nếu phát hiện secret thật:

```text
report file path + secret type
```

không print secret value.

Không mặc định copy:

```text
--disable-web-security
--no-sandbox
```

Nếu thật sự cần option đặc biệt, phải ghi rõ lý do và security impact.

---

## 58. Observability

Log:

```text
kind
canonical code
driver
browser mode
extractor
cache hit/miss
duration
result class
parser version
```

Không log:

```text
CAPTCHA token
cookie
Authorization
browser storage
secret
```

---

## 59. Implementation phases

### Phase 1 — Research only

Không sửa workflow BiddingFlow.

Thực hiện:

```text
inspect frontend hiện tại
Vue capability probe
network research
detail flow research
schema capture
```

### Phase 2 — Core adapter

Implement:

```text
BrowserLauncher
CapabilityDetector
Vue2Driver
GenericUiDriver
NetworkCollector
PayloadClassifier
VueStateExtractor
DomExtractor
SchemaParser
Normalizer
```

### Phase 3 — Standalone lookup

CLI/dev endpoint:

```text
lookup PL...
lookup IB...
```

Output normalized DTO.

### Phase 4 — Benchmark

Chạy benchmark thực tế.

### Phase 5 — Cache

Implement:

```text
cache-first
same-key coalescing
```

### Phase 6 — BiddingFlow UI

Chỉ tích hợp form sau khi PoC đạt GO.

---

## 60. File structure gợi ý

```text
backend/
  procurement/
    service
    models
    cache

integrations/
  muasamcong/
    browser/
      factory
      standard_launcher
      research_launcher

    capability/

    drivers/
      vue2/
      generic/

    network/

    classifiers/

    extractors/
      network/
      vue_state/
      dom/

    parsers/
      plan/
      package/

    dto/
```

Điều chỉnh theo repo thực tế nhưng phải giữ separation of concerns.

---

## 61. Cấm God Class

Không tạo một file/class kiểu:

```text
MuaSamCongCrawler
```

chứa chung:

```text
browser
Vue
network
parser
cache
form
database
```

Phải tách module rõ ràng.

---

## 62. Nguyên tắc nâng cấp frontend — BẮT BUỘC

Không xây:

```text
BiddingFlow
    ↓
Vue2
    ↓
Mua Sắm Công
```

Phải xây:

```text
BiddingFlow
    ↓
Stable Procurement Contract
    ↓
MuaSamCong Adapter
    ↓
Driver
    ↓
Browser frontend
    ↓
Structured data
```

Vue2 chỉ là:

```text
FAST PATH HIỆN TẠI
```

không phải contract lâu dài.

### Nếu Vue2 → Vue3

Chỉ cần thêm:

```text
Vue3Driver
```

Nếu network schema không đổi, phần:

```text
NetworkCollector
PayloadClassifier
Parser
Normalizer
DTO
BiddingFlow
```

không cần sửa.

### Nếu Vue → React

Fallback:

```text
GenericUiDriver
```

vẫn phải có khả năng hoạt động.

Sau đó có thể thêm:

```text
ReactDriver
```

### Nếu frontend đổi nhưng network schema giữ nguyên

Cố gắng chỉ thay Driver.

### Nếu network schema đổi

Thêm:

```text
ParserV2
```

Không sửa form/workflow BiddingFlow.

### Nếu variable Vue đổi tên

Không được làm feature chết nếu schema fingerprint/exact identifier vẫn nhận diện được dữ liệu.

Đây là tiêu chí kiến trúc cứng.

---

## 63. Acceptance checklist

```text
[ ] BiddingFlow codebase đã được nghiên cứu
[ ] WEB_DAU_THAU đã được nghiên cứu

[ ] Browser headless
[ ] Persistent/warm browser

[ ] BrowserLauncher abstraction
[ ] Standard launcher riêng
[ ] Research launcher riêng và configurable

[ ] Vue2 capability detection
[ ] Vue2 fast-path
[ ] Generic UI fallback

[ ] Network-centric extraction
[ ] Vue state fallback
[ ] DOM fallback

[ ] Exact PL validation
[ ] Exact IB validation

[ ] PayloadClassifier
[ ] Schema fingerprint

[ ] Driver / Extractor / Parser tách biệt
[ ] Versioned adapters
[ ] Versioned parsers

[ ] Detail frontend-driven navigation
[ ] Không mở N package nếu plan payload đã chứa packages

[ ] Stable Normalized DTO
[ ] BiddingFlow không biết raw MSC schema

[ ] Cache-first
[ ] Same-key coalescing
[ ] Circuit breaker

[ ] Không phụ thuộc fixed delay
[ ] Không dùng static token architecture làm core
[ ] Không bulk crawl

[ ] Preview before Apply
[ ] Không auto-save
[ ] Không phá version/status/assignee

[ ] CI dùng fixtures
[ ] Contract tests
[ ] Benchmark

[ ] Research document
[ ] Architecture ADR

[ ] Không commit secrets

[ ] Có upgrade path Vue2 → Vue3/React
```

---

## 64. Final report bắt buộc

Codex phải trả:

```text
Current portal framework:

Vue2 detected:
Vue2 root:

Vue2Driver:
PASS / FAIL

GenericUiDriver:
PASS / FAIL

Network extraction:
PASS / FAIL

Vue fallback:
PASS / FAIL

DOM fallback:
PASS / FAIL

PL exact lookup:
PASS / FAIL

IB exact lookup:
PASS / FAIL

Plan fields:
X/Y

Package fields:
X/Y

Plan package list in single load:
YES / NO

Browser cold p50:
Browser cold p95:

Warm lookup p50:
Warm lookup p95:

Cache p95:

Driver usage:
Vue2 %
Generic %

Extractor usage:
Network %
Vue %
DOM %

Interaction-required rate:
Schema error rate:

Upgrade resilience:
- Vue2 variable rename:
- Vue2 unavailable:
- Generic UI fallback:
- Parser version fallback:

Recommended:
GO / REVIEW / NO-GO
```

Không chỉ trả lời `Implemented successfully`.

Phải có bằng chứng test và số liệu.

---

# KẾT QUẢ CUỐI CÙNG

```text
User nhập PL/IB
       ↓
cache
       ↓ miss
browser warm
       ↓
capability detection
       ↓
Vue2 fast-path
       hoặc
Generic UI
       ↓
frontend tự load
       ↓
structured network JSON
       ↓
exact identifier validation
       ↓
schema parser
       ↓
normalized DTO
       ↓
cache
       ↓
preview
       ↓
user Apply
```

Hệ thống phải đạt các nguyên tắc:

```text
NHANH
CÓ CẤU TRÚC
KHÔNG KHÓA VÀO VUE2
KHÔNG PHỤ THUỘC DOM LÀM NGUỒN CHÍNH
DỄ NÂNG CẤP VUE3/REACT
DỄ THAY PARSER
DỄ DEBUG
DỄ BENCHMARK
DỄ THAY SOURCE SAU NÀY
```
