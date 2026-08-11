# PROMPT CODEX — Tái kiến trúc tích hợp Mua Sắm Công theo Complete Raw Bundle, bảo toàn 100% dữ liệu và tối ưu tốc độ

Bạn đang làm việc với hai repository:

- `https://github.com/newstar94/Bidding`
- `https://github.com/newstar94/WEB_DAU_THAU`

## 1. Mục tiêu

Hãy nghiên cứu thật kỹ **code mới nhất của cả hai repository** trước khi sửa.

Tôi muốn tái kiến trúc phần tích hợp dữ liệu từ `muasamcong.mpi.gov.vn` trong Bidding theo nguyên tắc:

> **Không cố gắng định nghĩa/mapping trước toàn bộ schema của Mua Sắm Công.**
>
> Thay vào đó:
>
> 1. Thu thập đầy đủ các response JSON liên quan đến một thực thể.
> 2. Lưu/bảo toàn nguyên vẹn raw JSON.
> 3. Sau đó mới tạo canonical data và mapping sang dữ liệu nghiệp vụ của Bidding.
> 4. Mapping chỉ định nghĩa các field Bidding thực sự cần.
> 5. Field chưa được mapping tuyệt đối không được mất.
> 6. Khi Mua Sắm Công bổ sung field mới, collector không được lỗi chỉ vì chưa biết field đó.
> 7. Với thực thể có nhiều version/revision phải lấy và bảo toàn đầy đủ từng version.
> 8. Đặc biệt phải tối ưu tốc độ, tránh tình trạng lấy đầy đủ dữ liệu nhưng làm lookup chậm nghiêm trọng.

Kiến trúc mong muốn:

```text
Mua Sắm Công
      │
      ▼
Endpoint Graph Collector
      │
      ▼
Complete Raw Bundle
      │
      ├──────────────► Raw Snapshot / Audit
      │
      ▼
Canonical Mapper
      │
      ▼
Import / Reconcile
      │
      ▼
Bidding Domain Database
```

Trong đó:

> **RAW JSON là source of truth.**

Canonical chỉ là một projection/view có version của raw data.

Không được coi canonical là nơi thay thế raw response.

---

# 2. Vấn đề hiện tại cần khắc phục

Sau khi nghiên cứu code hiện tại, hãy xác minh lại các vấn đề sau và sửa đúng nguyên nhân gốc.

## 2.1. Lookup hiện tại làm mất quá nhiều dữ liệu

Trong Bidding hiện đã có các lớp normalize/canonical nhưng luồng lookup đang dựng một response rất mỏng từ dữ liệu canonical.

Ví dụ kế hoạch có thể chỉ còn:

```json
{
  "planNo": "...",
  "planName": "...",
  "projectName": "...",
  "investorName": "...",
  "decisionNo": "...",
  "decisionDate": "...",
  "publicDate": "...",
  "packages": [...]
}
```

Trong khi raw response Mua Sắm Công có rất nhiều field khác.

Không được tiếp tục thiết kế theo kiểu:

```text
RAW
 ↓
lọc một vài field
 ↓
bỏ phần còn lại
```

Phải thay bằng:

```text
RAW được giữ nguyên
      │
      ├── Canonical projection
      └── Domain mapping
```

---

# 3. Đặc điểm quan trọng của dữ liệu Mua Sắm Công

Không được giả định:

```text
1 thực thể = 1 request = 1 JSON
```

Thực tế một thực thể có thể được cấu thành từ nhiều API request liên quan.

Ví dụ đối với **kế hoạch lựa chọn nhà thầu**, frontend Mua Sắm Công có thể gọi các endpoint như:

```text
get-version-list
get-by-id
get-bidp-plan-detail-by-id
...
```

và có thể còn các endpoint bổ sung khác.

Vì vậy yêu cầu quan trọng là:

> Một "Complete Plan" phải là một **bundle/graph của toàn bộ các response cần thiết**, không phải JSON của riêng một endpoint.

---

# 4. Complete Raw Bundle

Hãy xây dựng/mở rộng abstraction `Complete Raw Bundle`.

Ví dụ:

```json
{
  "schemaVersion": "biddingflow-muasamcong-raw-bundle-v2",

  "provider": "MUASAMCONG",

  "entity": {
    "kind": "PLAN",
    "canonicalCode": "PL2600244105"
  },

  "retrievedAt": "...",

  "sources": {
    "...": {}
  }
}
```

`Complete Raw Bundle` phải giữ nguyên response từ upstream.

Không được xóa field chỉ vì parser chưa biết field đó.

Không được whitelist toàn bộ schema Mua Sắm Công trước khi lưu raw.

---

# 5. Collector phải theo Endpoint Graph

Hãy xây dựng collector theo quan hệ giữa các request.

Khái niệm:

```text
Request A
   │
   ├── lấy identifier
   ▼
Request B
   │
   ├── lấy identifier khác
   ▼
Request C
```

Điều cần cấu hình là:

> Quan hệ giữa các endpoint.

Không phải:

> Danh sách tất cả field mà endpoint có thể trả về.

Ví dụ:

```text
get-version-list
      │
      ▼
revisionId
      │
      ▼
get-by-id(revisionId)
      │
      ▼
package identifiers
      │
      ▼
get-bidp-plan-detail-by-id(...)
```

Đây là nguyên tắc:

> **Workflow-driven, không schema-driven.**

---

# 6. Kế hoạch lựa chọn nhà thầu

Đây là phần phải triển khai và kiểm thử kỹ nhất.

Với một mã kế hoạch:

```text
PLxxxxxxxxxx
```

collector phải:

### Bước 1 — xác định kế hoạch

Lấy search/basic record cần thiết.

### Bước 2 — lấy danh sách tất cả version

Gọi endpoint tương ứng với:

```text
get-version-list
```

Không chỉ lấy latest revision.

Phải nhận biết đầy đủ:

```text
00
01
02
...
```

cùng:

```text
revisionId
revisionNumber
publishedAt
status
...
```

### Bước 3 — lấy detail của TỪNG revision

Cho mỗi revision:

```text
get-by-id(revisionId)
```

hoặc API upstream thực tế tương ứng.

Phải lưu raw JSON của từng revision riêng biệt.

Ví dụ:

```text
revisions
├── 00
│    └── planDetail
│
└── 01
     └── planDetail
```

### Bước 4 — xác định các gói thầu thuộc revision

Không được coi package là global theo `planNo`.

Package phải gắn với revision cụ thể.

Ví dụ:

```text
PLAN
 ├── revision 00
 │     ├── package A
 │     └── package B
 │
 └── revision 01
       ├── package A
       ├── package B
       └── package C
```

### Bước 5 — lấy các API chi tiết gói thầu liên quan

Nếu Mua Sắm Công sử dụng:

```text
get-bidp-plan-detail-by-id
```

hoặc endpoint khác để trả thông tin bổ sung của gói thầu thì collector phải lấy response đó.

Không được mặc định rằng object:

```text
bidPack
```

trong `get-by-id` đã chứa toàn bộ dữ liệu.

Hãy nghiên cứu thực tế code của `WEB_DAU_THAU`, network workflow hiện có và endpoint catalog để xác định chính xác quan hệ này.

---

# 7. Cấu trúc mong muốn cho Plan Raw Bundle

Không bắt buộc phải đúng hoàn toàn cấu trúc dưới đây, nhưng kiến trúc phải đảm bảo cùng nguyên tắc:

```json
{
  "entity": {
    "kind": "PLAN",
    "planNo": "PL2600244105"
  },

  "sources": {
    "search": {
      "endpoint": "...",
      "request": {},
      "response": {}
    },

    "versionList": {
      "endpoint": "...",
      "request": {},
      "response": {}
    }
  },

  "revisions": {
    "00": {
      "revisionId": "...",

      "sources": {
        "planDetail": {
          "endpoint": "...",
          "request": {},
          "response": {}
        }
      },

      "packages": {
        "<stable package key>": {
          "sources": {
            "planPackageDetail": {
              "endpoint": "...",
              "request": {},
              "response": {}
            }
          }
        }
      }
    },

    "01": {
      "revisionId": "...",
      "sources": {},
      "packages": {}
    }
  }
}
```

Quan trọng hơn format cụ thể là:

- giữ nguyên raw response;
- biết response đến từ endpoint nào;
- biết request/payload nào tạo ra response;
- biết thuộc revision nào;
- biết thuộc package nào;
- không overwrite version cũ;
- có timestamp;
- có schema fingerprint nếu cần;
- có content hash nếu hữu ích;
- có error metadata cho source thất bại.

---

# 8. Partial failure

Một endpoint phụ bị lỗi không được làm mất toàn bộ bundle nếu dữ liệu khác đã lấy thành công.

Ví dụ:

```text
version list        OK
revision 00         OK
revision 01         OK
package detail A    OK
package detail B    FAILED
```

Kết quả vẫn phải có khả năng trả:

```json
{
  "complete": false,

  "failures": [
    {
      "operation": "...",
      "revision": "01",
      "package": "...",
      "error": "..."
    }
  ]
}
```

và giữ nguyên các source đã lấy được.

Phải phân biệt rõ:

```text
FOUND_COMPLETE
FOUND_PARTIAL
NOT_FOUND
UNSUPPORTED
UPSTREAM_ERROR
AUTH_SESSION_ERROR
...
```

Không được biến partial failure thành `not found`.

---

# 9. Raw Snapshot

Hãy nghiên cứu phương án lưu raw response lâu dài.

Không bắt buộc phải nhét toàn bộ Complete Bundle vào một cột JSON khổng lồ.

Có thể thiết kế dạng snapshot/source.

Ví dụ logical schema:

```text
procurement_raw_snapshot

id
provider

entity_kind
canonical_code

revision_id
revision_number

child_entity_kind
child_entity_id

operation
endpoint

request_payload
response_json

content_hash
schema_fingerprint

retrieved_at
created_at
```

Tên bảng/field phải phù hợp với conventions hiện tại của repo.

Không tạo schema thừa nếu kiến trúc hiện tại đã có abstraction tương đương.

---

# 10. Immutable Raw Data

Raw response đã lưu phải được coi là immutable snapshot.

Không được:

```text
fetch raw
→ normalize
→ ghi đè raw bằng normalized object
```

Nếu fetch lần sau khác, tạo snapshot/version phù hợp hoặc update cache theo chính sách rõ ràng.

Cần có:

```text
content hash
```

hoặc cơ chế tương tự để tránh lưu duplicate không cần thiết.

---

# 11. Canonical Mapper

Sau khi có raw bundle mới thực hiện normalize.

Ví dụ:

```text
Raw Bundle
    ↓
PlanCanonicalMapper
    ↓
CanonicalPlan
```

Canonical phải bao gồm những dữ liệu Bidding đang cần.

Nhưng:

> Canonical không cần biết mọi field upstream.

Nếu upstream thêm:

```json
{
  "someFutureField": "abc"
}
```

collector vẫn phải hoạt động.

Raw phải giữ:

```text
someFutureField
```

dù canonical chưa mapping.

---

# 12. Mapping bằng alias

Không nên viết logic cứng kiểu:

```python
value = raw["bidName"]
```

Hãy hỗ trợ alias/fallback nếu phù hợp.

Ví dụ:

```python
PACKAGE_FIELDS = {
    "name": [
        "bidName",
        "name",
        "packageName"
    ],

    "contractType": [
        "ctype",
        "contractType"
    ]
}
```

Hàm mapping có thể lấy field đầu tiên hợp lệ.

Nhưng không lạm dụng alias để che giấu schema drift.

Nếu upstream có thay đổi đáng kể phải:

- phát hiện;
- log;
- đưa vào metrics/diagnostics;
- không âm thầm map sai dữ liệu.

---

# 13. Field provenance

Nếu hợp lý với kiến trúc hiện tại, hãy hỗ trợ metadata cho biết canonical field được lấy từ đâu.

Ví dụ:

```json
{
  "fieldSources": {
    "bidPrice": {
      "operation": "plan-package-detail",
      "revision": "01",
      "sourcePath": "bidPrice"
    }
  }
}
```

Không nhất thiết trả phần này ở API frontend mặc định.

Có thể dùng cho:

- debug;
- audit;
- admin diagnostics;
- data reconciliation;
- AI sau này;
- kiểm tra mapping.

Không được làm response nghiệp vụ thông thường nặng lên đáng kể chỉ vì provenance.

---

# 14. Revision model

Đối với plan phải hỗ trợ rõ:

```text
LATEST
SELECTED
ALL
```

Không hardcode:

```python
max(revisions)
```

ở tầng thấp rồi bỏ revision khác.

Đề xuất:

```json
{
  "revisionMode": "LATEST"
}
```

hoặc:

```json
{
  "revisionMode": "ALL"
}
```

hoặc:

```json
{
  "revisionMode": "SELECTED",
  "revisionNumbers": ["00", "02"]
}
```

Kiểm tra xem import flow hiện tại đã có abstraction tương tự chưa.

Nếu đã có:

> tái sử dụng.

Không tạo hai hệ thống revision selection độc lập.

---

# 15. Detail level

Không phải request nào cũng cần Complete Bundle.

Đây là yếu tố CỰC KỲ QUAN TRỌNG đối với tốc độ.

Hãy thiết kế các mức detail.

Ví dụ:

```text
SUMMARY
CANONICAL
COMPLETE
```

### SUMMARY

Dùng cho:

- search;
- autocomplete;
- danh sách;
- kiểm tra mã nhanh.

Không được fetch toàn bộ graph.

### CANONICAL

Dùng cho lookup thông thường.

Fetch đủ dữ liệu cần thiết để xây canonical entity.

### COMPLETE

Dùng cho:

- nhập dữ liệu;
- đồng bộ;
- audit;
- reprocess;
- debug;
- dữ liệu yêu cầu toàn bộ versions/sources.

COMPLETE mới thực hiện full endpoint graph cần thiết.

Không được bắt mọi lookup chạy COMPLETE.

---

# 16. Performance là tiêu chí bắt buộc

Đây không phải optimization làm sau.

Hãy coi performance là yêu cầu kiến trúc ngay từ đầu.

Mục tiêu:

> Lấy dữ liệu đầy đủ hơn nhưng không làm lookup thông thường chậm hơn đáng kể; với warm path phải nhanh hơn implementation hiện tại.

Trước khi sửa:

1. Benchmark implementation hiện tại.
2. Ghi lại:
   - cold start;
   - first lookup;
   - warm lookup;
   - cache hit;
   - cache miss;
   - session acquire;
   - upstream network;
   - normalize;
   - total;
   - số request upstream;
   - số lần browser launch;
   - số lần token/session bootstrap.

Sau khi sửa:

> chạy lại cùng benchmark và báo cáo before/after.

Không được chỉ nói "performance improved" mà không có số liệu.

---

# 17. Không eager-launch browser fallback

Hãy kiểm tra kỹ worker/runtime hiện tại.

Nếu protected API đang là happy path thì:

> Không được launch một browser automation runtime khác chỉ để chuẩn bị fallback ngay khi worker initialize.

Luồng mong muốn:

```text
Worker startup
     │
     ▼
Protected API available
     │
     ├── session cached
     │       ↓
     │    API request
     │
     └── session missing
             ↓
        bootstrap session
```

Browser fallback như Playwright chỉ được initialize:

```text
Protected API failed
       ↓
fallback required
       ↓
lazy launch browser
```

Không:

```text
worker startup
 ↓
launch Playwright
 ↓
sau đó lại launch Puppeteer
```

nếu protected API đang hoạt động.

---

# 18. Tối ưu session bootstrap

Session/token/cookie phải được reuse tối đa trong giới hạn an toàn.

Không bootstrap browser lại trên mỗi request.

Hãy kiểm tra:

- process-level session reuse;
- TTL;
- invalidation;
- refresh;
- concurrent refresh;
- duplicate refresh;
- race condition.

Khi nhiều request cùng phát hiện session hết hạn:

Không được:

```text
request 1 → launch browser
request 2 → launch browser
request 3 → launch browser
request 4 → launch browser
```

Phải có single-flight/session-refresh lock:

```text
request 1 → refresh
request 2 ─┐
request 3 ─┼→ await same refresh promise
request 4 ─┘
```

---

# 19. Cache architecture

Kiểm tra lại cache lookup hiện tại.

Luồng mong muốn:

```text
L1 process memory
       ↓ miss
L2 shared cache / PostgreSQL
       ↓ miss
RAW snapshot/database nếu phù hợp
       ↓ miss/stale
Mua Sắm Công upstream
```

Không query PostgreSQL trước memory cache nếu memory cache đang có dữ liệu hợp lệ.

L1 phải thực sự là L1.

Phân biệt cache:

```text
summary cache
canonical cache
raw source cache
complete bundle cache
session cache
```

Không trộn tất cả thành một cache key không rõ semantics.

Cache key phải tính đến tối thiểu:

```text
provider
entity kind
canonical code
revision mode
selected revision
detail level
schema version
```

nếu các dimension đó ảnh hưởng dữ liệu trả về.

---

# 20. Reuse raw data

Nếu raw source đã có và còn fresh:

Không gọi Mua Sắm Công lại chỉ để remap canonical.

Ví dụ:

```text
RAW snapshot
    ↓
mapper v1
```

sau khi update mapper:

```text
RAW snapshot
    ↓
mapper v2
```

Không cần refetch upstream nếu raw vẫn hợp lệ.

Đây là một lợi ích quan trọng của kiến trúc mới.

---

# 21. Parallel fetching

COMPLETE mode có thể phải gọi nhiều API.

Không fetch tuần tự một cách không cần thiết.

Ví dụ:

```text
version list
     ↓
revision 00
revision 01
revision 02
```

sau khi có revision list, các revision độc lập có thể chạy concurrent.

Tương tự package details độc lập có thể chạy concurrent.

Nhưng:

> concurrency phải bounded.

Ví dụ dùng giới hạn hiện có/configurable concurrency.

Không `Promise.all()` không giới hạn với hàng trăm request.

Phải:

```text
bounded concurrency
+
rate limit
+
retry policy
+
backoff
+
circuit breaker
```

phù hợp.

Không được tối ưu tốc độ bằng cách spam Mua Sắm Công.

---

# 22. In-flight deduplication

Nếu đồng thời có nhiều request:

```text
PL2600244105 COMPLETE ALL
PL2600244105 COMPLETE ALL
PL2600244105 COMPLETE ALL
```

không nên chạy 3 full collections giống nhau.

Dùng:

```text
single-flight
in-flight promise dedupe
request coalescing
```

cho các upstream operation phù hợp.

Tận dụng abstraction hiện tại nếu `MscApiClient` đã có.

---

# 23. JSONL worker / IPC

Kiểm tra việc Python ↔ Node runtime hiện tại có lock toàn bộ `_exchange()` hay không.

Nếu một lock khiến toàn bộ independent lookup bị serialize:

```text
request A ─────────────
request B               ─────────────
request C                            ─────────
```

hãy đánh giá phương án:

```text
requestId multiplexing
```

hoặc:

```text
worker pool
```

hoặc abstraction phù hợp hơn.

Tuy nhiên:

> không được vội viết lại IPC nếu bottleneck chính vẫn là browser/session/cache.

Thứ tự ưu tiên:

1. bỏ browser eager initialization;
2. session reuse;
3. L1/L2 cache;
4. raw source reuse;
5. endpoint parallelism;
6. đo benchmark;
7. chỉ sau đó mới sửa IPC nếu benchmark chứng minh nó là bottleneck.

---

# 24. Metrics bắt buộc

Hiện lookup response không được để:

```json
{
  "metrics": {}
}
```

trong khi runtime đã đo thời gian.

Hãy truyền metrics xuyên suốt.

Ví dụ:

```json
{
  "metrics": {
    "totalMs": 812,

    "cache": {
      "hit": false,
      "layer": null
    },

    "session": {
      "cacheHit": true,
      "acquireMs": 3,
      "refreshCount": 0
    },

    "upstream": {
      "requestCount": 4,
      "networkMs": 630
    },

    "collector": {
      "revisions": 2,
      "packageDetails": 4
    },

    "normalizeMs": 7,

    "browser": {
      "launched": false,
      "startupMs": 0
    }
  }
}
```

Không nhất thiết API public phải lộ toàn bộ diagnostics.

Có thể:

- log nội bộ;
- diagnostics endpoint;
- dev mode;
- admin mode.

Nhưng benchmark/test phải truy cập được.

Không log:

- token;
- cookie;
- Authorization;
- captcha token;
- secret;
- sensitive headers.

---

# 25. Benchmark phải đo production path thật

Kiểm tra script benchmark hiện tại.

Nếu benchmark đang dùng implementation/source cũ nhưng production API dùng source khác thì phải sửa.

Benchmark phải chạy đúng:

```text
route/service/source/runtime
```

mà production hiện đang sử dụng.

Cần benchmark ít nhất:

```text
1. cold worker + cold session
2. warm worker + cold session
3. warm session
4. L1 cache hit
5. L2 cache hit
6. COMPLETE latest
7. COMPLETE all revisions
8. concurrent lookups
```

Report:

```text
median
p95
min
max
request count
browser launches
session refresh
cache layer
```

---

# 26. Không đặt target tốc độ giả tạo

Không hardcode một target kiểu:

```text
mọi lookup phải < 500 ms
```

vì upstream Mua Sắm Công không nằm trong quyền kiểm soát của Bidding.

Thay vào đó phải đo:

### Application overhead

Thời gian do chính Bidding tạo ra.

### Upstream latency

Thời gian chờ Mua Sắm Công.

### Cache path

Cache hit phải nhanh và không phụ thuộc upstream.

### Cold/warm comparison

Warm path phải tránh browser bootstrap không cần thiết.

Mục tiêu chính:

> Giảm tối đa overhead do Bidding tạo ra và số upstream request dư thừa.

---

# 27. Backward compatibility

Không được phá các caller hiện tại.

Route hiện tại như:

```text
/api/procurement/lookup
```

nếu đang được frontend sử dụng phải tiếp tục hoạt động.

Có thể mở rộng request:

```json
{
  "code": "PL2600244105",
  "kind": "PLAN",

  "detailLevel": "CANONICAL",
  "revisionMode": "LATEST"
}
```

Default phải tương thích hành vi cũ nếu thay đổi default có nguy cơ phá frontend.

Đối với flow:

```text
Nhập dữ liệu từ Mua Sắm Công
```

có thể chủ động sử dụng:

```text
detailLevel = COMPLETE
revisionMode = ALL
```

nếu nghiệp vụ yêu cầu lấy đầy đủ phiên bản.

---

# 28. Import flow

Nghiên cứu kỹ:

```text
backend/procurement_import/
```

Nếu đã có:

```text
LATEST
SELECTED
ALL
```

thì tái sử dụng model đó.

Không tạo:

```text
LookupRevisionMode
ImportRevisionMode
CollectorRevisionMode
```

với 3 implementation khác nhau nếu có thể dùng chung domain abstraction.

---

# 29. WEB_DAU_THAU

Repository `WEB_DAU_THAU` phải được dùng làm nguồn tham khảo rất quan trọng.

Đặc biệt nghiên cứu:

```text
/api/detail/complete
createCompleteBundle
collectVersionedDetails
collectPlanCompleteBundle
captureBundleSource
```

và các API upstream mà project này thực tế gọi.

Mục tiêu:

> Mang khả năng thu thập đầy đủ của WEB_DAU_THAU vào kiến trúc production-quality của Bidding.

Không copy code mù quáng.

WEB_DAU_THAU có thể là project nghiên cứu/debug.

Bidding cần:

- typing/schema rõ;
- cache;
- security;
- metrics;
- error handling;
- concurrency;
- tests;
- backward compatibility;
- maintainability.

---

# 30. Regression case bắt buộc: PL2600244105

Hãy sử dụng:

```text
PL2600244105
```

làm regression fixture/test case.

Trong dữ liệu đã quan sát, kế hoạch này có ít nhất:

```text
revision 00
revision 01
```

Test phải đảm bảo:

```text
revisionMode = ALL
```

trả được cả hai revision.

Không được chỉ lấy:

```text
max(revisionNumber)
```

rồi bỏ revision cũ.

---

# 31. Test field completeness

Không chỉ test:

```python
assert result["found"] is True
```

Phải test dữ liệu thực.

Ví dụ với plan:

```text
plan number
name
plan version
status
investor
decision information
investment total
plan type
packages
...
```

Với package phải kiểm tra các field upstream quan trọng như:

```text
id
idDetail
idPlan

bidNo
planNo

bidName

isInternet
isMultiLot
isDomestic
isPrequalification
isConcentrateShopping

bidPrice
bidPriceUnit

bidForm
bidField
bidMode

processApply

capitalDetail

bidStartUnit
bidStartYear
bidStartMonth
bidStartQuarter

createdDate
planDecisionDate

bidTime

ctype
cperiod
cperiodUnit
...
```

Không bắt canonical phải expose mọi field này ngay.

Nhưng:

> Raw bundle phải giữ chúng nếu upstream trả chúng.

Test raw preservation bằng fixture.

---

# 32. Unknown field regression test

Fixture:

```json
{
  "bidName": "...",
  "unknownFutureField2027": {
    "abc": 123
  }
}
```

Collector phải:

```text
PASS
```

Raw bundle phải còn:

```text
unknownFutureField2027
```

Canonical có thể bỏ qua.

Không được:

```text
schema validation failed
```

chỉ vì xuất hiện field mới.

---

# 33. Multi-version package isolation test

Test:

```text
revision 00
package A
price = 100

revision 01
package A
price = 200
```

Kết quả không được merge thành một package mất lịch sử.

Phải có:

```text
revision 00 → package A → 100
revision 01 → package A → 200
```

---

# 34. Dedup test

Hai lần fetch upstream trả cùng JSON:

```text
hash A
hash A
```

không được tạo duplicate snapshot không cần thiết nếu storage policy dùng dedup.

Nếu:

```text
hash A
hash B
```

phải nhận biết content thay đổi.

---

# 35. Partial failure test

Mock:

```text
plan revision 00 → success
plan revision 01 → success
package detail X → timeout
```

Phải trả:

```text
FOUND_PARTIAL
```

và giữ dữ liệu thành công.

---

# 36. Performance regression tests

Phải có test/benchmark đảm bảo:

### Warm lookup

Không launch browser nếu session/API đã sẵn sàng.

### L1 cache hit

Không query PostgreSQL.

### L2 cache hit

Không gọi upstream.

### Session single-flight

10 concurrent protected requests khi session hết hạn:

```text
browser bootstrap count = 1
```

chứ không phải 10.

### Complete collection

Independent revision/package requests được parallelize với concurrency limit.

---

# 37. Security

Giữ nguyên hoặc tăng security hiện tại.

Không để Complete Raw API vô tình bypass:

- authentication;
- workspace;
- organization;
- role permissions;
- rate limiting.

Không đưa raw upstream data vào frontend nếu người dùng không có quyền xem entity tương ứng.

Không expose:

```text
cookie
token
Authorization
recaptcha token
browser local storage secrets
```

trong:

- API response;
- database raw snapshot;
- logs;
- metrics;
- exception.

Nếu request metadata chứa secret thì sanitize trước khi persist.

---

# 38. Raw request storage

Nếu lưu request payload/header:

Chỉ lưu dữ liệu cần để audit/reproduce.

Header sensitive phải redact:

```text
Authorization: [REDACTED]
Cookie: [REDACTED]
X-...token: [REDACTED]
```

Không lưu browser session secret vào raw bundle.

---

# 39. API design

Hãy đề xuất và triển khai API contract sạch.

Ví dụ:

```json
POST /api/procurement/lookup

{
  "code": "PL2600244105",
  "kind": "PLAN",

  "detailLevel": "CANONICAL",
  "revisionMode": "LATEST"
}
```

COMPLETE:

```json
{
  "code": "PL2600244105",
  "kind": "PLAN",

  "detailLevel": "COMPLETE",
  "revisionMode": "ALL"
}
```

Không bắt buộc dùng chính xác tên trên nếu conventions của repo có phương án tốt hơn.

Nhưng semantics phải rõ ràng.

---

# 40. Không trả raw khổng lồ mặc định

Không làm:

```text
mọi lookup
  ↓
10 MB raw JSON
  ↓
frontend
```

Raw có thể được:

- lưu server-side;
- trả theo `detailLevel=COMPLETE`;
- hoặc qua endpoint diagnostics/raw riêng có quyền phù hợp.

Frontend nghiệp vụ mặc định chỉ cần canonical/domain data.

Điều này rất quan trọng để tránh:

- serialization overhead;
- network overhead;
- memory overhead;
- React payload lớn;
- API response chậm.

---

# 41. Source manifest

COMPLETE response nên có manifest nhẹ.

Ví dụ:

```json
{
  "manifest": {
    "sourceCount": 12,
    "successCount": 12,
    "failedCount": 0,

    "revisions": [
      "00",
      "01"
    ],

    "packages": 4,

    "operations": [
      "search",
      "plan-version-list",
      "plan-detail",
      "plan-package-detail"
    ]
  }
}
```

Nhờ vậy code nghiệp vụ có thể biết collection có đầy đủ hay không mà không parse toàn bộ raw tree.

---

# 42. Schema versioning

Các schema nội bộ cần version rõ:

```text
raw bundle schema
canonical schema
mapping schema
```

Ví dụ:

```text
biddingflow-muasamcong-raw-bundle-v2
biddingflow-procurement-canonical-v2
```

Không dựa hoàn toàn vào schema fingerprint của upstream.

---

# 43. Reprocessing

Thiết kế mapper sao cho có thể chạy:

```text
raw snapshot cũ
      ↓
mapper mới
      ↓
canonical mới
```

Không bắt buộc refetch upstream.

Đây là yêu cầu kiến trúc quan trọng.

Tách:

```text
collection
```

khỏi:

```text
normalization/mapping
```

rõ ràng.

---

# 44. Observability

Thêm structured logging phù hợp:

```text
lookup_request_id
provider
kind
canonical_code
revision_mode
detail_level

cache_layer

session_cache_hit

operation
upstream_duration

collection_duration
mapping_duration
total_duration

partial_failure_count
```

Không log raw payload cực lớn ở production mặc định.

---

# 45. Trình tự triển khai

Không sửa code ngay lập tức.

Thực hiện theo thứ tự:

## Phase 1 — Research

Đọc toàn bộ flow liên quan trong cả hai repo.

Lập sơ đồ:

```text
Frontend
→ route
→ service
→ source
→ runtime
→ collector
→ API client
→ session
→ upstream
```

Xác định:

- implementation production thật;
- implementation legacy;
- code nào đang dead;
- code nào duplicated;
- các endpoint Mua Sắm Công thực tế;
- identifier dùng để nối các request.

## Phase 2 — Baseline benchmark

Đo performance hiện tại.

## Phase 3 — Design

Đề xuất concrete design trước khi thực hiện thay đổi lớn.

Nhưng không dừng để hỏi tôi nếu có thể tự quyết định an toàn dựa trên code.

## Phase 4 — Implement

Ưu tiên thay đổi nhỏ, tái sử dụng abstraction hiện tại.

Không rewrite toàn bộ integration nếu không cần.

## Phase 5 — Tests

Unit + integration + regression + benchmark.

## Phase 6 — Verify

So sánh:

```text
before
after
```

về:

- completeness;
- latency;
- browser launches;
- upstream calls;
- cache;
- concurrency;
- memory nếu đo được.

---

# 46. Ưu tiên performance khi triển khai

Thứ tự tối ưu:

```text
P0  Không mất raw data

P0  Lấy đúng tất cả revision khi ALL

P0  Package detail thuộc đúng revision

P0  Không eager-launch browser không cần thiết

P0  Session reuse + single-flight refresh

P0  L1 memory trước L2 database

P1  Raw/source cache reuse

P1  In-flight upstream dedup

P1  Bounded parallel fetching

P1  Không trả raw payload lớn mặc định

P1  Metrics chính xác

P2  IPC multiplex / worker pool nếu benchmark chứng minh cần

P2  Các micro optimization khác
```

---

# 47. Không tối ưu sai cách

Không được tăng tốc bằng cách:

```text
chỉ lấy latest
```

khi caller yêu cầu ALL.

Không được tăng tốc bằng cách:

```text
bỏ package detail
```

rồi gọi đó là complete.

Không được tăng tốc bằng cách:

```text
không retry lỗi transient
```

mà không có error classification.

Không được tăng tốc bằng cách:

```text
concurrency không giới hạn
```

làm Mua Sắm Công block/rate-limit hệ thống.

---

# 48. Definition of COMPLETE

`COMPLETE` không có nghĩa:

> gọi mọi endpoint từng tồn tại trong source code.

COMPLETE nghĩa:

> lấy toàn bộ source cần thiết để biểu diễn đầy đủ thực thể và các child entities được xác định bởi endpoint graph hiện tại.

Hãy tránh request dư thừa.

Nếu hai endpoint trả dữ liệu duplicate và một endpoint không cần thiết:

Không gọi chỉ vì muốn "nhiều JSON".

Mục tiêu:

```text
Maximum useful completeness
+
Minimum necessary upstream requests
```

---

# 49. Mở rộng sau này

Kiến trúc không được hardcode chỉ cho PLAN.

Phải có khả năng mở rộng cùng pattern cho:

```text
PLAN
NOTICE / BID
OPENING
RESULT
CONTRACT
PROJECT
...
```

Ví dụ tương lai:

```text
PlanCollector
NoticeCollector
OpeningCollector
ResultCollector
ContractCollector
```

dùng chung:

```text
RawSource
SourceManifest
CollectionContext
Cache
Metrics
Error classification
```

---

# 50. Tránh over-engineering

Không biến toàn bộ việc này thành framework quá phức tạp.

Ưu tiên:

```text
simple
testable
observable
fast
backward-compatible
```

Nếu abstraction hiện tại đã đáp ứng:

> mở rộng nó.

Không tạo thêm tầng chỉ để đẹp kiến trúc.

---

# 51. Deliverables bắt buộc

Sau khi hoàn thành hãy cung cấp:

## A. Phân tích trước sửa

Liệt kê:

- root cause mất dữ liệu;
- root cause chậm;
- endpoint graph thực tế của PLAN;
- code cũ nào được tái sử dụng;
- code nào phải sửa.

## B. Danh sách file thay đổi

Giải thích lý do từng file.

## C. API contract mới

Bao gồm:

```text
detailLevel
revisionMode
```

và backward compatibility.

## D. Data model

Mô tả:

```text
Raw Bundle
Raw Snapshot
Canonical
Domain Mapping
```

## E. Test report

Bao gồm test case:

```text
PL2600244105
```

đặc biệt phải chứng minh:

```text
00
01
```

đều được giữ khi dùng `ALL`.

## F. Performance report

Bảng:

```text
Scenario                   Before     After
------------------------------------------------
Cold lookup                ...        ...
Warm lookup                ...        ...
L1 hit                     ...        ...
L2 hit                     ...        ...
Complete latest            ...        ...
Complete all revisions     ...        ...
Concurrent xN              ...        ...
Browser launches           ...        ...
Upstream request count     ...        ...
```

Nếu môi trường không cho benchmark live Mua Sắm Công thì:

- nói rõ;
- benchmark phần có thể đo;
- không bịa số liệu.

## G. Remaining risks

Liệt kê các vấn đề còn lại.

---

# 52. Acceptance criteria

Không coi task hoàn thành nếu chưa đạt các điều sau.

### Data completeness

- Raw upstream JSON được bảo toàn.
- Unknown field không bị mất.
- PLAN hỗ trợ tất cả revisions.
- Package detail không bị bỏ sót chỉ vì nằm ở endpoint khác.
- Package được phân tách đúng theo revision.
- Partial failure không làm mất successful sources.

### Mapping

- Mapping tách khỏi collection.
- Có thể remap raw data mà không cần refetch.
- Canonical không phải source of truth.

### Performance

- Không launch Playwright/browser fallback ở happy path nếu không cần.
- Session được reuse.
- Concurrent refresh sử dụng single-flight.
- Memory L1 được check trước shared L2.
- Cache hit không gọi upstream.
- Independent detail requests có bounded parallelism.
- Không trả raw bundle lớn mặc định.
- Có metrics thật.
- Có benchmark before/after.

### Stability

- Existing callers không bị phá.
- Authentication/permissions/rate limits vẫn hoạt động.
- Không leak token/cookie.
- Tests cũ vẫn pass hoặc được cập nhật với lý do chính đáng.

---

# 53. Nguyên tắc cuối cùng

Khi phải lựa chọn giữa:

```text
A. normalize sớm và mất dữ liệu

B. giữ nguyên raw rồi normalize sau
```

chọn **B**.

Khi phải lựa chọn giữa:

```text
A. COMPLETE nhưng gọi tuần tự rất chậm

B. COMPLETE với bounded concurrency + cache + session reuse
```

chọn **B**.

Khi phải lựa chọn giữa:

```text
A. launch browser từ đầu cho chắc

B. protected API first, browser lazy fallback
```

chọn **B**.

Kiến trúc cuối cùng phải tuân thủ:

```text
COLLECT ONCE
STORE RAW
MAP MANY TIMES
CACHE AGGRESSIVELY BUT SAFELY
FETCH ONLY WHAT THE REQUEST NEEDS
PRESERVE EVERY REVISION
LAZY-LOAD EXPENSIVE FALLBACKS
MEASURE EVERYTHING
```

Hãy bắt đầu bằng việc nghiên cứu code mới nhất của hai repository và xác định chính xác flow hiện tại. Sau đó thực hiện thay đổi trực tiếp trong repository `Bidding`, bổ sung tests và benchmark đầy đủ.

Không được chỉ viết báo cáo hoặc pseudocode.

**Hãy thực hiện code thực tế, chạy test, sửa các lỗi phát sinh và báo cáo kết quả cuối cùng.**