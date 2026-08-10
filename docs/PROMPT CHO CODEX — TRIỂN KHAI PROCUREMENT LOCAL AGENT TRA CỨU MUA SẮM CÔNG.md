# PROMPT CHO CODEX — TRIỂN KHAI PROCUREMENT LOCAL AGENT TRA CỨU MUA SẮM CÔNG

## 1. Bối cảnh

Repository:

```text
newstar94/Bidding
```

Ứng dụng: **BiddingFlow**

Mục tiêu là hỗ trợ người dùng nhập:

```text
PL...
```

hoặc:

```text
IB...
```

vào form Kế hoạch lựa chọn nhà thầu / Gói thầu và tự động lấy dữ liệu công khai từ:

```text
https://muasamcong.mpi.gov.vn/
```

Thay vì bắt người dùng:

```text
Mở Mua Sắm Công
→ tìm kiếm
→ mở kết quả
→ copy dữ liệu
→ quay lại BiddingFlow
→ nhập lại thủ công
```

BiddingFlow cần rút gọn thành:

```text
Người dùng nhập PL / IB
        ↓
BiddingFlow tự tra cứu
        ↓
Lấy dữ liệu
        ↓
Hiển thị preview
        ↓
Người dùng xác nhận
        ↓
Điền vào form
```

---

# 2. Nguyên tắc bắt buộc

Đây **không phải crawler hàng loạt**.

Không được:

```text
- crawl toàn bộ dữ liệu Mua Sắm Công
- chạy pagination hàng loạt
- chạy job định kỳ để thu thập toàn hệ thống
- gửi request liên tục khi không có người dùng yêu cầu
- xoay proxy/IP
- dùng stealth browser
- dùng undetected-chromedriver
- giả browser fingerprint
Có thể:
- replay CAPTCHA token
- bypass CAPTCHA
- vô hiệu hóa reCAPTCHA
```

Tra cứu chỉ được phát sinh khi:

```text
người dùng thực sự nhập PL / IB
```

và cần dữ liệu để tạo mới KHLCNT hoặc gói thầu.

Nếu Mua Sắm Công yêu cầu CAPTCHA/challenge mà browser không thể tiếp tục bình thường thì có thể:
- replay CAPTCHA token
- bypass CAPTCHA
- vô hiệu hóa reCAPTCHA

---

# 3. Kiến trúc mục tiêu

Không chạy Playwright tập trung trên BiddingFlow server.

Ưu tiên chạy trên **máy người dùng** thông qua một Local Agent.

Kiến trúc:

```text
┌──────────────────────────────────────┐
│             BiddingFlow              │
│              Browser                 │
│                                      │
│ Người dùng nhập PL... hoặc IB...     │
└──────────────────┬───────────────────┘
                   │
                   │ localhost IPC
                   ↓
┌──────────────────────────────────────┐
│ BiddingFlow Procurement Local Agent  │
│                                      │
│ - validate PL/IB                     │
│ - local cache                        │
│ - Playwright                         │
│ - parser                             │
│ - normalize DTO                      │
│ - security boundary                  │
└──────────────────┬───────────────────┘
                   │
                   ↓
        Chromium persistent context
             headless by default
                   │
                   ↓
┌──────────────────────────────────────┐
│        muasamcong.mpi.gov.vn         │
└──────────────────────────────────────┘
```

---

# 4. Mục đích của Local Agent

Local Agent phải:

1. Chạy trên máy người dùng.
2. Chỉ lắng nghe trên:

```text
127.0.0.1
```

không bind:

```text
0.0.0.0
```

3. Nhận yêu cầu tra cứu PL/IB từ BiddingFlow.
4. Điều khiển Chromium bằng Playwright.
5. Thực hiện đúng luồng truy cập công khai thông thường.
6. Quan sát response Fetch/XHR hoặc dữ liệu render.
7. Chuẩn hóa dữ liệu.
8. Trả DTO về BiddingFlow.
9. Không cung cấp API chạy arbitrary JavaScript.
10. Không cho frontend truyền arbitrary URL.

---

# 5. Interface Local Agent

Thiết kế API tối thiểu.

Ví dụ:

```text
GET /health
```

Response:

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

Tra cứu:

```text
POST /v1/procurement/lookup
```

Request:

```json
{
  "kind": "package",
  "code": "IB2600123456"
}
```

hoặc:

```json
{
  "kind": "plan",
  "code": "PL2600123456"
}
```

Không nhận:

```text
url
javascript
selector
script
command
shell
```

từ frontend.

---

# 6. Validation đầu vào

Chỉ nhận mã hợp lệ.

Ví dụ:

```text
PLxxxxxxxxxx
IBxxxxxxxxxx
```

Không phân biệt chữ hoa/thường.

Normalize:

```text
pl2600123456
→
PL2600123456
```

Nếu có hậu tố phiên bản nội bộ:

```text
PL2600123456-00
```

thì lookup upstream bằng:

```text
PL2600123456
```

nhưng giữ input gốc trong metadata.

Reject mọi input không đúng format.

---

# 7. Security của Local Agent

Đây là yêu cầu bắt buộc.

Không triển khai kiểu:

```text
POST /open-url
POST /execute
POST /run-script
```

Local Agent chỉ expose operation allowlist.

Cần tối thiểu:

```text
Origin allowlist
nonce/challenge
short-lived local auth token
request validation
fixed upstream hostname
rate limit local
timeout
body size limit
logging an toàn
```

Chỉ chấp nhận Origin của BiddingFlow đã cấu hình.

Ví dụ:

```text
https://biddingflow.example.vn
```

Không dùng:

```text
Access-Control-Allow-Origin: *
```

Agent chỉ được phép truy cập:

```text
https://muasamcong.mpi.gov.vn
```

và các subresource bắt buộc được browser tải tự nhiên.

Không cho người dùng/frontend truyền hostname khác.

---

# 8. Browser strategy

Sử dụng:

```text
Playwright
+
Chromium
```

Chạy:

```text
headless = true
```

mặc định.

Không dùng stealth plugin.

Không sửa:

```text
navigator.webdriver
canvas fingerprint
WebGL fingerprint
UA fingerprint
TLS fingerprint
```

với mục đích né anti-bot.

---

# 9. Persistent browser context

Không launch browser mới cho từng lookup nếu không cần.

Dùng persistent user data directory riêng cho Agent.

Ví dụ:

```text
%LOCALAPPDATA%/
BiddingFlow/
ProcurementAgent/
browser-profile/
```

Luồng:

```text
Agent start
    ↓
Chromium/context ready
    ↓
idle

lookup 1
    ↓
reuse context

idle

lookup 2
    ↓
reuse context
```

Cookie/local storage được browser quản lý tự nhiên.

---

# 10. Lazy browser startup

Để tiết kiệm RAM có thể dùng:

```text
Agent start
    ↓
browser chưa launch
    ↓
lookup đầu tiên
    ↓
launch Chromium
    ↓
giữ warm trong N phút
```

Ví dụ:

```text
idle timeout = 15 phút
```

sau đó đóng browser.

Nếu có lookup mới thì launch lại.

Hãy benchmark cả:

```text
always warm
```

và:

```text
lazy warm
```

trước khi quyết định.

---

# 11. Lookup strategy

Ưu tiên:

```text
BiddingFlow DB/cache
        ↓
Local cache
        ↓
Browser lookup
```

Không gọi Mua Sắm Công nếu dữ liệu đủ mới đã tồn tại.

Luồng:

```text
lookup(code)
    ↓
check BiddingFlow data?
    ↓
check local cache?
    ↓
browser lookup
```

---

# 12. Không scrape DOM nếu có response JSON ổn định

Ưu tiên:

```text
Browser thao tác website
        ↓
website phát Fetch/XHR
        ↓
Playwright observe response
        ↓
response.json()
```

Browser phải để website tự tạo request.

Ví dụ về nguyên tắc:

```javascript
const responsePromise = page.waitForResponse((response) => {
  return (
    response.request().method() === "POST" &&
    isExpectedProcurementResponse(response)
  );
});

await performNormalSearchInteraction(page, code);

const response = await responsePromise;
const data = await response.json();
```


Có thể đọc hoặc sửa token CAPTCHA để tái sử dụng.

---

# 13. Fallback DOM parser

Nếu response không thể sử dụng ổn định nhưng dữ liệu được render công khai trên trang thì có thể dùng DOM parser.

Tách parser thành module riêng.

Ví dụ:

```text
BrowserTransport
     ↓
UpstreamPayload
     ↓
ProcurementParser
     ↓
Normalized DTO
```

Không để selector upstream lan ra workflow BiddingFlow.

---

# 14. ProcurementSource abstraction

Phải giữ abstraction để sau này thay bằng API chính thức.

Ví dụ:

```python
class ProcurementSource:
    def lookup(self, code, kind):
        ...
```

Implement:

```text
LocalBrowserSource
OfficialApiSource
FixtureSource
```

Hiện tại:

```text
LocalBrowserSource
```

Sau này nếu được cấp API:

```text
OfficialApiSource
```

Frontend không phải sửa.

---

# 15. DTO chuẩn hóa

Không trả raw JSON của Mua Sắm Công trực tiếp vào frontend.

Dùng schema ổn định.

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
    "retrievedAt": "2026-08-11T01:30:00+07:00"
  },
  "data": {
    "notifyNo": "IB2600123456",
    "planNo": "PL2600...",
    "bidName": "...",
    "investorName": "...",
    "procuringEntityName": "...",
    "bidPrice": null,
    "capitalDetail": "...",
    "bidField": "...",
    "bidForm": "...",
    "bidMode": "...",
    "bidCloseDate": "...",
    "bidOpenDate": "..."
  },
  "warnings": []
}
```

Unknown field/category:

```text
null
```

không được đoán.

---

# 16. Cache

## Local cache

Ví dụ SQLite hoặc file-backed cache.

Cache key:

```text
kind + canonicalCode + parserSchemaVersion
```

Cache raw CAPTCHA token.

## TTL đề xuất ban đầu

Đây chỉ là default để benchmark:

```text
KHLCNT:
6–24 giờ

TBMT chưa đóng:
15–60 phút

TBMT đã đóng:
6–24 giờ

KQLCNT:
6–24 giờ
```

Phải để cấu hình được.

---

# 17. Shared BiddingFlow cache

Sau khi lookup thành công:

```text
Local Agent
    ↓
BiddingFlow
    ↓
normalized cache/database
```

Máy người dùng khác có thể dùng lại dữ liệu nếu còn đủ mới.

Ưu tiên:

```text
Shared cache
     ↓
Local cache
     ↓
Mua Sắm Công
```

để giảm request upstream.

---

# 18. Concurrency

Một Local Agent không cần chạy nhiều browser lookup cùng lúc.

MVP:

```text
max concurrent lookup = 1
```

Có thể benchmark:

```text
2
```

nhưng không vượt quá nếu chưa chứng minh cần thiết.

Nếu có nhiều request cùng mã:

```text
IB2600123456
IB2600123456
IB2600123456
```

phải coalesce thành một lookup.

Không gửi ba request upstream.

---

# 19. Debounce frontend

Không lookup mỗi phím gõ.

Ví dụ:

```text
I
IB
IB2
IB26
...
```

không được gọi.

Chỉ gọi khi mã đã hợp lệ hoàn chỉnh.

Frontend:

```text
validate
→ debounce
→ lookup
```

Có:

```text
AbortController
```

và stale-response guard.

Nếu user đổi:

```text
IB1
→ IB2
```

thì response cũ không được ghi vào form mới.

---

# 20. CAPTCHA handling

Đây là requirement cứng.

Nếu browser nhận diện luồng không thể hoàn tất do website yêu cầu người dùng xác minh:

Có thể:

```text
- solve CAPTCHA
- replay token
- inject token
- dùng stealth để né challenge
```

Trả:

```json
{
  "success": false,
  "code": "PROCUREMENT_INTERACTION_REQUIRED"
}
```

BiddingFlow hiển thị thông báo:

```text
Mua Sắm Công đang yêu cầu xác minh người dùng.
Không thể hoàn tất tra cứu tự động trong phiên này.
```

---

# 21. Error taxonomy

Chuẩn hóa lỗi.

```text
PROCUREMENT_NOT_FOUND

PROCUREMENT_INTERACTION_REQUIRED

PROCUREMENT_TIMEOUT

PROCUREMENT_UPSTREAM_UNAVAILABLE

PROCUREMENT_SCHEMA_CHANGED

PROCUREMENT_AGENT_UNAVAILABLE

PROCUREMENT_AGENT_VERSION_UNSUPPORTED

PROCUREMENT_INVALID_CODE

PROCUREMENT_LOOKUP_BUSY
```

Không dùng một lỗi generic cho tất cả trường hợp.

---

# 22. Timeout

Đề xuất PoC:

```text
warm lookup timeout:
15 giây

cold start:
20 giây
```

Không retry vô hạn.

Retry tối đa:

```text
1 lần
```

và chỉ với lỗi network tạm thời.

---

# 23. Performance target

Đây là acceptance criteria cho PoC, không phải cam kết production.

## Cache hit

```text
p95 < 200 ms
```

## Warm browser lookup

```text
p50 < 3 giây
p95 < 7 giây
```

## Cold browser lookup

```text
p95 < 10 giây
```

## Timeout

```text
15–20 giây
```

tùy cold/warm.

---

# 24. Benchmark bắt buộc

Trước khi tích hợp sâu vào workflow, chạy PoC ít nhất:

```text
50–100 lookup thực tế
```

gồm cả:

```text
PL
IB
not found
TBMT mới
TBMT cũ
KHLCNT nhiều gói
```

Ghi metric:

```text
count
success
not_found
interaction_required
timeout
upstream_error

cache_hit
cache_miss

cold_start
warm_lookup

p50
p75
p95
max
```

---

# 25. Tối ưu CAPTCHA detection rate

Mục tiêu benchmark là:

```text
đo hành vi thật
```

Không phải:

```text
làm sao để website không nhận ra automation
```

Nếu tỷ lệ:

```text
PROCUREMENT_INTERACTION_REQUIRED
```

cao thì báo cáo đây là blocker.

Không tự ý thêm stealth technique.

---

# 26. UX BiddingFlow

Người dùng nhập:

```text
IB2600123456
```

UI:

```text
Đang tra cứu Mua Sắm Công...
```

Nếu thành công:

```text
✓ Đã tìm thấy thông tin
```

Hiển thị Preview Modal.

Ví dụ:

| Trường | Hiện tại | Mua Sắm Công | Áp dụng |
|---|---|---|---|
| Tên gói | trống | Gói mua sắm... | ✓ |
| Giá gói | trống | 2.500.000.000 | ✓ |
| Chủ đầu tư | BV A | BV A | |
| Nguồn vốn | trống | NSNN | ✓ |

Mặc định:

```text
field rỗng → chọn apply
field đã có → không chọn
```

Không tự ghi đè.

---

# 27. Không tự lưu form

Lookup chỉ được:

```text
fill draft
```

Không được tự:

```text
save
sync
create version
create plan
create package
change status
assign user
```

Người dùng vẫn phải bấm:

```text
Lưu
```

theo workflow hiện tại.

---

# 28. Versioning BiddingFlow

Không để lookup phá quy tắc version.

Nếu đang:

```text
create mode
```

được apply.

Nếu:

```text
historical version
read-only mode
```

không được lookup/apply.

Nếu edit version hiện tại thì chỉ hỗ trợ nếu business rule hiện hữu cho phép.

Không thay đổi logic version ngoài phạm vi feature.

---

# 29. Plan linkage

Nếu lookup IB trả về:

```text
planNo
```

và BiddingFlow đã có KHLCNT đó:

Phải liên kết đúng:

```text
latest version của cùng version lineage
```

Không tạo duplicate KHLCNT.

Nếu chưa có:

Không tự tạo KHLCNT trong MVP.

Chỉ cảnh báo:

```text
KHLCNT PL... chưa tồn tại trong BiddingFlow.
```

---

# 30. Packaging Local Agent

Ưu tiên Windows trước.

Mục tiêu:

```text
BiddingFlowProcurementAgent.exe
```

hoặc installer:

```text
BiddingFlow Procurement Agent Setup.exe
```

Agent tự start theo user login hoặc khi BiddingFlow yêu cầu.

Không cần quyền Administrator nếu không bắt buộc.

Không mở firewall inbound.

Chỉ localhost.

---

# 31. Agent discovery

Frontend cần kiểm tra:

```text
http://127.0.0.1:<fixed-port>/health
```

Nếu Agent chưa cài:

```text
PROCUREMENT_AGENT_UNAVAILABLE
```

UI:

```text
Chưa cài thành phần tra cứu Mua Sắm Công.
```

Không crash form.

---

# 32. Version compatibility

`/health` trả:

```json
{
  "status": "ok",
  "agentVersion": "1.0.0",
  "protocolVersion": "1"
}
```

Frontend kiểm tra protocol.

Nếu không tương thích:

```text
PROCUREMENT_AGENT_VERSION_UNSUPPORTED
```

---

# 33. Logging

Log tối thiểu:

```text
timestamp
lookup kind
canonical code hash hoặc code nếu chính sách cho phép
duration
cache hit/miss
result class
browser cold/warm
```

Không log:

```text
CAPTCHA token
cookies
Authorization
browser storage
raw sensitive payload
```

---

# 34. Data provenance

Mỗi lookup thành công phải có:

```text
source
retrievedAt
canonicalCode
sourceUrl nếu phù hợp
parserSchemaVersion
```

Ví dụ:

```json
{
  "source": "MUASAMCONG_BROWSER",
  "retrievedAt": "2026-08-11T01:30:00+07:00",
  "parserSchemaVersion": "2026.1"
}
```

---

# 35. Schema guard

Parser phải fail closed.

Nếu upstream thay đổi cấu trúc quan trọng:

Không đoán.

Trả:

```text
PROCUREMENT_SCHEMA_CHANGED
```

Fixture phải có một case schema bị thay đổi để test.

---

# 36. Test architecture

Không dùng live Mua Sắm Công trong CI.

CI dùng:

```text
fixture
mock page
mock XHR
```

Live test chỉ chạy thủ công hoặc test environment riêng.

---

# 37. Unit tests bắt buộc

Ít nhất:

```text
code normalization
PL validation
IB validation
cache
cache TTL
cache invalidation
DTO mapping
unknown enum
schema changed
timeout mapping
interaction required mapping
duplicate concurrent lookup coalescing
origin validation
local auth
upstream hostname restriction
```

---

# 38. Frontend tests

Test:

```text
debounce
AbortController
stale response
agent unavailable
lookup success
not found
interaction required
preview
apply only selected fields
do not overwrite populated field by default
read-only mode
```

---

# 39. Security tests

Phải chứng minh Agent reject:

```text
Origin lạ

arbitrary URL

localhost request từ site không được cấp quyền

invalid nonce

expired nonce

invalid code

oversized body

unsupported action
```

Test rằng API không thể bị lợi dụng thành:

```text
open proxy
SSRF proxy
local command runner
browser automation proxy
```

---

# 40. PoC phase

Không triển khai toàn bộ ngay.

## Phase 1

Tạo standalone PoC:

```text
tools/procurement-agent-poc/
```

Cho phép chạy:

```bash
procurement-agent lookup IB2600123456
```

Output:

```json
{
  "success": true,
  "durationMs": 1850,
  "data": {}
}
```

---

# 41. Phase 2

Benchmark 50–100 lookup.

Tạo report:

```text
docs/PROCUREMENT_LOCAL_AGENT_BENCHMARK.md
```

Report phải có:

```text
OS
CPU
RAM
browser version
Playwright version
network environment

number of lookups
PL count
IB count

success rate
interaction required rate
not found
timeout
errors

cold p50/p95
warm p50/p95
cache p50/p95
```

---

# 42. Go / No-Go decision

Chỉ chuyển sang tích hợp BiddingFlow sau benchmark.

Ví dụ:

## GO

Nếu:

```text
normal lookup success >= 95%
warm p95 <= 7s
no security blocker
```

## REVIEW

Nếu:

```text
interaction required 5–20%
```

## NO-GO

Nếu:

```text
CAPTCHA/challenge xuất hiện thường xuyên
hoặc
lookup không ổn định
```

Có thể tìm cách giảm CAPTCHA bằng stealth.

---

# 43. Phase 3

Nếu GO:

Tích hợp Local Agent client vào BiddingFlow.

Module đề xuất:

```text
frontend/procurement/
    procurementLookup.js
    procurementAgentClient.js
    procurementPreview.js
```

Backend/shared nếu cần:

```text
backend/procurement_lookup/
    models.py
    service.py
```

Local Agent:

```text
procurement-agent/
    src/
        server/
        browser/
        parser/
        cache/
        security/
        models/
```

---

# 44. Phase 4

Sau khi ổn định:

Thêm:

```text
OfficialApiSource
```

nếu sau này có API chính thức.

Không xóa abstraction LocalBrowserSource ngay.

---

# 45. Những điều Codex không được tự quyết định

Không tự:

```text
thay đổi workflow version
tự tạo KHLCNT
tự tạo gói thầu
tự lưu dữ liệu
tự thay đổi trạng thái
```
Có thể:
```text
thêm stealth plugin
bypass CAPTCHA
dùng CAPTCHA solving API
xoay proxy
giả fingerprint
```
Nếu gặp blocker phải ghi rõ trong báo cáo.

---

# 46. Deliverables

Codex phải trả:

## 1. Báo cáo nghiên cứu

```text
docs/PROCUREMENT_LOCAL_AGENT_RESEARCH.md
```

## 2. PoC Local Agent

```text
tools/procurement-agent-poc/
```

## 3. Benchmark

```text
docs/PROCUREMENT_LOCAL_AGENT_BENCHMARK.md
```

## 4. Security review

```text
docs/PROCUREMENT_LOCAL_AGENT_SECURITY.md
```

## 5. Architecture decision

```text
docs/adr/ADR_PROCUREMENT_LOCAL_AGENT.md
```

## 6. Test

Unit + integration + browser tests.

---

# 47. Báo cáo cuối cùng bắt buộc

Codex phải trả lời rõ:

```text
1. Có chạy được Playwright headless không?

2. Warm lookup trung bình bao lâu?

3. Cold lookup bao lâu?

4. Cache hit bao lâu?

5. Tỷ lệ lookup thành công?

6. Bao nhiêu lần gặp interaction/CAPTCHA?

7. Có endpoint/data response nào ổn định để parse không?

8. Có phải fallback DOM không?

9. Có blocker bảo mật không?

10. Có đủ điều kiện GO để tích hợp BiddingFlow không?
```

Không chỉ báo:

```text
tests passed
```

mà phải có số liệu.

---

# 48. Acceptance criteria cuối

Feature chỉ được coi là thành công khi:

```text
✓ lookup chỉ xảy ra on-demand

✓ không crawler nền

✓ chạy trên máy người dùng

✓ browser headless

✓ không stealth

✓ cache-first

✓ persistent/lazy browser context

✓ exact PL/IB validation

✓ normalized DTO

✓ preview trước khi apply

✓ không tự save

✓ Local Agent localhost-only

✓ Origin/auth security

✓ không arbitrary URL/script

✓ schema fail-closed

✓ benchmark có số liệu thật

✓ CI không gọi live Mua Sắm Công
```

---

# 49. Nguyên tắc ưu tiên

Ưu tiên theo thứ tự:

```text
Correctness
    ↓
Security
    ↓
Data integrity
    ↓
User experience
    ↓
Performance
```

Không hy sinh security hoặc tính hợp lệ chỉ để tăng success rate.

---

# 50. Mục tiêu UX cuối cùng

Người dùng chỉ cần:

```text
1. Mở form KHLCNT hoặc Gói thầu

2. Nhập:
   PL...
   hoặc
   IB...

3. Chờ khoảng vài giây

4. Xem preview

5. Xác nhận dữ liệu

6. Lưu theo workflow hiện hữu
```

Không phải tự mở Mua Sắm Công và copy từng trường.

Đây là mục tiêu của feature.