# PROMPT CODEX — TÍCH HỢP TOÀN BỘ CƠ CHẾ MUA SẮM CÔNG TỪ `WEB_DAU_THAU` VÀO `Bidding`

## 0. Repository bắt buộc nghiên cứu

Hãy nghiên cứu **code mới nhất** của hai repository sau trước khi sửa:

- BiddingFlow: `https://github.com/newstar94/Bidding`
- Nguồn retrieval Mua Sắm Công: `https://github.com/newstar94/WEB_DAU_THAU`

Không được coding dựa trên suy đoán. Phải đọc kỹ các module hiện tại của cả hai repository, đặc biệt:

### Trong `Bidding`

- `backend/procurement_import/**`
- `backend/integrations/vneps/**`
- `backend/integrations/muasamcong_browser/**`
- `backend/procurement_lookup/**`
- `frontend/procurement/**`
- `frontend/plans/**`
- `frontend/packages/**`
- các repository/service liên quan đến:
  - kế hoạch lựa chọn nhà thầu;
  - gói thầu;
  - versioning;
  - snapshot;
  - assignment;
  - biên bản mở thầu;
  - nhà thầu;
  - liên danh;
  - phân lô;
  - provenance/import operation.

### Trong `WEB_DAU_THAU`

Phải đọc kỹ tối thiểu:

- `src/server.js`
- `src/services/mscTokenProvider.js`

và tất cả helper/module liên quan thực sự được sử dụng bởi hai file này.

---

# 1. Mục tiêu tổng thể

Tích hợp đầy đủ khả năng truy xuất dữ liệu Mua Sắm Công hiện có trong `WEB_DAU_THAU` vào `BiddingFlow`.

Kết quả cuối cùng phải đạt đồng thời 4 mục tiêu:

1. **Bidding có capability truy xuất Mua Sắm Công tối thiểu bằng `WEB_DAU_THAU`.**
2. **Bidding giữ nguyên domain, database, versioning, history, permissions, workspace, assignment và transaction model hiện có.**
3. **Kế hoạch, gói thầu/TBMT và biên bản mở thầu đều có thể lấy toàn bộ version và import vào Bidding.**
4. **Kiến trúc mới phải linh hoạt, tránh phụ thuộc chặt vào frontend/API hiện tại của Mua Sắm Công để dễ thích nghi khi upstream thay đổi.**

---

# 2. YÊU CẦU BẮT BUỘC — PORT NGUYÊN CƠ CHẾ TRUY CẬP MUA SẮM CÔNG TỪ `WEB_DAU_THAU`

Đây là requirement bắt buộc.

Repository:

```text
https://github.com/newstar94/WEB_DAU_THAU
```

là implementation nguồn đã được người sở hữu hệ thống chấp thuận sử dụng cho mục đích tích hợp này.

Khi triển khai vào:

```text
https://github.com/newstar94/Bidding
```

**không được tự ý loại bỏ, vô hiệu hóa hoặc thay thế các cơ chế đang tồn tại trong `WEB_DAU_THAU` chỉ vì chúng liên quan đến Puppeteer, browser automation, token/cookie, anti-detection, reCAPTCHA, CSP hoặc WAF.**

Mục tiêu là:

> PORT capability hiện có, không làm giảm capability.

Không nghiên cứu hoặc bổ sung kỹ thuật né/phá bảo vệ mới ngoài implementation hiện có của repository nguồn nếu không có yêu cầu riêng.

---

# 3. Port nguyên cơ chế Token/Cookie/Browser Session

Nghiên cứu kỹ:

```text
WEB_DAU_THAU/src/services/mscTokenProvider.js
```

và port đầy đủ behavior hiện tại, bao gồm toàn bộ cơ chế đang thực sự được source sử dụng:

- Puppeteer/Chromium;
- logic tìm executable browser;
- browser launch;
- launch arguments hiện tại;
- headless mode hiện tại;
- User-Agent hiện tại;
- `--disable-blink-features=AutomationControlled`;
- `page.setBypassCSP(true)`;
- truy cập domain chính thức `muasamcong.mpi.gov.vn`;
- bắt token phát sinh trong network request;
- lấy cookies từ browser session;
- token cache;
- cookie cache;
- TTL/token age;
- `forceRefresh`;
- refresh state;
- timeout;
- retry;
- `window.stop()`;
- fallback hiện có khi portal/Vue không tải bình thường;
- logic nạp reCAPTCHA script đang tồn tại;
- `RECAPTCHA_SITE_KEY` đang được source hiện tại sử dụng;
- `grecaptcha.ready(...)`;
- `grecaptcha.execute(siteKey, { action: "submit" })`;
- lấy token sinh ra trong browser/origin tương ứng;
- lấy cookie;
- đóng browser đúng cách;
- error handling hiện có.

Không được thay capability này bằng implementation fail-closed hiện tại của Bidding nếu việc đó làm Bidding mất khả năng truy xuất mà `WEB_DAU_THAU` hiện đang có.

---

# 4. Giữ nguyên behavior xử lý trường hợp frontend/WAF không tải bình thường

Nếu implementation nguồn hiện có flow tương đương:

```text
portal/Vue không tải được hoặc trả Error
        ↓
window.stop()
        ↓
setBypassCSP
        ↓
nạp reCAPTCHA script
        ↓
grecaptcha.execute(...)
        ↓
token
        ↓
cookie
        ↓
protected API
```

thì khi port vào Bidding phải giữ behavior tương đương.

Không được tự thay bằng:

```text
WAF / frontend error
→ PROCUREMENT_INTERACTION_REQUIRED
→ dừng
```

nếu source hiện tại vẫn lấy được dữ liệu.

---

# 5. Port nguyên transport/API client từ `WEB_DAU_THAU`

Nghiên cứu kỹ:

```text
WEB_DAU_THAU/src/server.js
```

và port các cơ chế thực sự được dùng như:

- xây HTTP headers;
- query token;
- cookie;
- protected/public API;
- parse response;
- timeout;
- retry;
- refresh token/cookie;
- gọi lại request sau khi session hết hiệu lực.

Đặc biệt giữ behavior tương đương:

```text
protected API
    ↓
session token + cookie
    ↓
request
    ↓
400 / 401 / 403 theo behavior source hiện tại
    ↓
force refresh
    ↓
retry
```

Không để frontend Bidding gọi trực tiếp Mua Sắm Công.

Token và cookie phải server-side only.

---

# 6. Port endpoint catalog hiện có

Sử dụng các endpoint thực tế đang tồn tại trong `WEB_DAU_THAU` làm nguồn chuẩn ban đầu.

Bao gồm tối thiểu:

## KHLCNT

- version list;
- plan detail.

## TBMT / Tender

- LDT detail;
- LDT versions;
- other detail;
- other versions;
- ADB/WB detail nếu source đang hỗ trợ.

## Biên bản mở thầu

- opening notify;
- opening round;
- opening bid;
- opening lot;
- opening lot detail;
- opening other;
- opening ADB/WB.

## Kết quả liên quan

- selection result;
- technical result;
- financial/result-related endpoints;
- contract/result endpoints nếu đang được source sử dụng.

Không được chỉ copy một phần endpoint khiến capability nhỏ hơn `WEB_DAU_THAU`.

---

# 7. Port nguyên complete collector logic

Ưu tiên port/refactor từ source hiện có thay vì tự viết lại đơn giản hơn.

Nghiên cứu và tái sử dụng logic tương đương:

- `collectVersionedDetails()`
- `collectPlanCompleteBundle()`
- `collectTenderCompleteBundle()`
- `collectLdtBidOpening()`
- các helper liên quan.

Mục tiêu:

```text
một mã đầu vào
    ↓
tìm toàn bộ version
    ↓
lấy detail từng version
    ↓
lấy dữ liệu phụ liên quan
    ↓
normalized complete bundle
```

---

# 8. Không bê nguyên Express server/database/UI của `WEB_DAU_THAU`

Chỉ port lớp retrieval/integration.

Không port nguyên:

- SQLite database;
- Express public server;
- frontend monitor;
- WEB_DAU_THAU UI;
- persistence model riêng của WEB_DAU_THAU.

`Bidding` tiếp tục là application authority.

Kiến trúc có thể dùng internal worker:

```text
Bidding backend
    ↓
internal Node worker
    ↓
ported WEB_DAU_THAU retrieval
    ↓
Puppeteer / HTTP
    ↓
Mua Sắm Công
```

Worker không expose public port.

Ưu tiên:

- stdin/stdout JSONL;
- IPC nội bộ;
- hoặc bridge nội bộ tương đương.

---

# 9. Một source duy nhất cho toàn bộ Mua Sắm Công

Sau refactor:

```text
                     ┌─ Plan
                     ├─ Package/TBMT
MscSession/MscClient ┼─ Opening
                     ├─ Technical/Financial
                     └─ Result
```

Không để:

```text
Plan import → source A
Package lookup → source B
Opening → source C
```

Toàn bộ phải dùng chung session provider và API transport.

---

# 10. Stable Procurement Contract

Business/domain code của Bidding không được biết:

- URL upstream;
- Vue/React;
- Puppeteer selector;
- reCAPTCHA;
- token parameter;
- cookie name;
- endpoint path;
- parser internals.

Tạo contract ổn định tương đương:

```python
class ProcurementSource(Protocol):
    def list_plan_revisions(...)
    def get_plan_revision(...)
    def list_notice_revisions(...)
    def get_notice_revision(...)
    def resolve_notice_package(...)
    def get_opening_bundle(...)
```

Có thể bổ sung:

```python
def get_result_bundle(...)
def get_capabilities(...)
def health(...)
```

nếu cần.

---

# 11. Tách `SessionProvider` khỏi API Client

Không để logic browser/token/cookie dính vào collector.

Kiến trúc:

```text
SessionProvider
    ├─ acquire()
    ├─ refresh()
    ├─ invalidate()
    ├─ health()
    └─ metadata()

MscApiClient
    └─ chỉ yêu cầu một session hợp lệ
```

Khi upstream thay đổi cơ chế token/cookie chỉ sửa `SessionProvider`.

Cần cải thiện concurrency:

- dùng shared refresh promise/single-flight;
- N request đồng thời không được mở N browser refresh;
- request chờ cùng một refresh;
- không trả stale empty cache.

---

# 12. Endpoint Catalog / Endpoint Profile

Không hard-code URL rải rác.

Tạo semantic operation:

```text
PLAN_VERSION_LIST
PLAN_DETAIL
NOTICE_VERSION_LIST
NOTICE_DETAIL
OPENING_NOTIFY
OPENING_ROUND
OPENING_BID
OPENING_LOT
OPENING_LOT_DETAIL
TECHNICAL_RESULT
FINANCIAL_RESULT
SELECTION_RESULT
```

Ví dụ:

```text
MuaSamCongProfile 2026.08
    sessionProvider: BrowserSessionV1
    endpoints:
        PLAN_DETAIL: ...
        NOTICE_DETAIL: ...
        OPENING_BID: ...
```

Cho phép có:

```text
2026.08 → ACTIVE
2026.05 → FALLBACK
```

Thay endpoint/profile không được yêu cầu sửa business code.

---

# 13. Retrieval Strategy Manager

Giữ và mở rộng tư duy hiện có của Bidding.

Ưu tiên:

```text
Protected API
    ↓ fallback
Browser Network JSON
    ↓ fallback
Framework State
    ↓ fallback
Semantic DOM
```

Không phụ thuộc duy nhất vào frontend.

Browser nên chủ yếu phục vụ:

- bootstrap session;
- network observation;
- fallback extraction.

Structured API vẫn là đường ưu tiên khi khả dụng.

---

# 14. Capability Detection

Không mặc định frontend luôn là Vue.

Tạo detector:

```json
{
  "protectedApi": true,
  "networkJson": true,
  "vue2": false,
  "vue3": true,
  "react": false,
  "semanticDom": true
}
```

Strategy Manager chọn extractor phù hợp.

---

# 15. Extractor interface

Không viết business logic trực tiếp với Vue component.

Tách:

```text
Extractor
    ├─ NetworkExtractor
    ├─ Vue2Extractor
    ├─ Vue3Extractor
    ├─ ReactExtractor
    └─ SemanticDomExtractor
```

Nếu upstream đổi framework, chỉ thay/add extractor.

---

# 16. Schema Fingerprint

Tạo fingerprint dựa trên shape/fields của payload, không phụ thuộc hoàn toàn URL.

Ví dụ:

```text
package-notice:v1
package-notice:v2
plan:v1
opening:v2
```

Fingerprint dựa trên các field đặc trưng như:

- `notifyNo`
- `notifyId`
- `notifyVersion`
- `planNo`
- `bidName`
- `bidPrice`
- `bidOpenId`
- `inputResultId`
- v.v.

---

# 17. Versioned Parser Registry

Giữ tư duy Parser Registry hiện có của Bidding nhưng làm rõ versioning.

Không sửa parser cũ để chạy schema mới.

Ví dụ:

```text
package-notice:v1 → PackageParserV1
package-notice:v2 → PackageParserV2
opening:v1 → OpeningParserV1
opening:v2 → OpeningParserV2
```

Parser cũ phải tiếp tục parse fixture lịch sử.

---

# 18. Field Alias Resolver

Không rải logic kiểu:

```python
row["bidName"]
```

Tạo utility tập trung:

```python
pick(row, "bidName", "name", "bidPackageName", "packageName")
```

Áp dụng cho các field có khả năng đổi tên.

Không được để mỗi parser tự lặp lại alias logic không thống nhất.

---

# 19. Upstream status/error classification

Phân biệt chính xác:

```text
FOUND_SUPPORTED
FOUND_SCHEMA_CHANGED
NOT_FOUND
SESSION_FAILED
UPSTREAM_CHANGED
ENDPOINT_CHANGED
PARTIAL_DATA
```

Nếu tìm thấy đúng procurement code nhưng schema lạ:

**không được trả "NOT_FOUND".**

Phải trả lỗi tương đương:

```text
PROCUREMENT_SCHEMA_CHANGED
```

để developer biết upstream đã thay đổi.

---

# 20. Diagnostic Artifact an toàn

Khi parser/schema lỗi, có thể ghi diagnostic artifact đã sanitize:

```text
diagnostics/
  YYYY-MM-DD/
    PLAN_xxx/
    PACKAGE_xxx/
```

Cho phép lưu:

- metadata;
- status;
- endpoint semantic name;
- schema fingerprint;
- sanitized JSON shape;
- parser error;
- extraction strategy.

Cấm lưu:

- token;
- cookie;
- authorization secret;
- session secret.

---

# 21. Fixture Corpus

Tạo tập fixture kiểm thử từ payload thực tế đã sanitize.

Ví dụ:

```text
tests/fixtures/muasamcong/
    plan/
    notice/
        ldt/
        1g2t/
        lots/
        consulting/
    opening/
        normal/
        lots/
        technical/
        financial/
    results/
```

Mỗi lần upstream đổi schema:

```text
thêm fixture mới
→ thêm parser mới
→ giữ test cũ
```

---

# 22. Shadow Parser

Hỗ trợ triển khai parser mới theo chế độ shadow:

```text
payload
  ├─ current parser → canonical A
  └─ shadow parser  → canonical B
                       ↓
                    compare
```

Nếu khác nhau:

- ghi diagnostic;
- không ghi đè production result;
- không tự động thay parser active.

Khi đủ tin cậy mới chuyển profile/parser.

---

# 23. Yêu cầu KHLCNT — import toàn bộ version

Khi người dùng nhập mã kế hoạch và chọn lấy dữ liệu từ Mua Sắm Công:

1. Normalize mã.
2. Lấy **tất cả source revisions**.
3. Sắp xếp chronological old → new.
4. Lấy detail từng revision.
5. Lấy danh sách gói thầu thuộc từng revision.
6. Reconcile với Bidding.
7. Preview.
8. Apply có transaction/idempotency/resume.

Không chỉ lấy latest.

---

# 24. Liên kết gói thầu trong kế hoạch

Khi import KHLCNT:

- các package thuộc plan phải được import/liên kết vào plan;
- không còn behavior chỉ "preview package list nhưng không tự tạo gói";
- phải xác định package identity ổn định;
- phải phân biệt:
  - ký hiệu/mã gói thầu trong kế hoạch;
  - mã TBMT/notifyNo/IB;
- không được conflated hai loại mã này.

---

# 25. Quy tắc status mặc định

Theo yêu cầu nghiệp vụ:

### Package chưa có mã TBMT

Mặc định:

```text
Đang chuẩn bị
```

### Package đã có mã TBMT/notifyNo

Mặc định tối thiểu:

```text
Đang mời thầu
```

Nếu upstream chứng minh lifecycle đã đi xa hơn thì không được downgrade.

---

# 26. Yêu cầu versioning BiddingFlow

Versioning plan và package là độc lập.

Ví dụ:

## Source snapshot đầu

```text
Plan 00
  A-00
  B-00
```

## Source snapshot tiếp theo

- A không đổi;
- B thay đổi;
- C mới.

Kết quả:

```text
Plan 01
  A-00
  B-01
  C-00
```

Không được clone A thành A-01 nếu A không đổi.

---

# 27. Package bị xóa khỏi version mới

Nếu package tồn tại trong snapshot cũ nhưng không còn ở snapshot mới:

```text
Old snapshot:
  A
  B

New snapshot:
  A
```

B vẫn tồn tại trong historical snapshot.

Không clone B vào snapshot mới.

Không hard-delete history.

---

# 28. Backfill source revision

Local version không bắt buộc bằng source revision.

Cho phép:

```text
source revision 01
local edit
source revision 02
backfill source revision 00
```

Backfill cũ không được rollback state hiện hành.

Có thể lưu:

```text
OBSERVED_NOT_APPLIED
```

và provenance.

---

# 29. Kế thừa dữ liệu khi tạo version mới

Khi package có version mới vì source field thay đổi:

Phải kế thừa tất cả dữ liệu local không thuộc source ownership, bao gồm tối thiểu:

- assignment;
- người phụ trách;
- trạng thái nội bộ không cần downgrade;
- hàng hóa;
- thông tin mở thầu;
- nhà thầu;
- liên danh;
- lot scope;
- dữ liệu nghiệp vụ liên quan;
- các quan hệ hiện có.

Ưu tiên reuse:

- aggregate snapshot;
- inheritance repository;
- version repository;
- existing Bidding domain logic.

Không tạo một đường versioning thứ hai.

---

# 30. Three-way merge và source-owned fields

Khi source revision mới về:

```text
old source
current local
new source
```

Phải dùng three-way merge.

Nếu local đã sửa field trong thời gian giữa hai source revision:

- không ghi đè âm thầm;
- tạo conflict khi cần;
- preview conflict trước apply.

---

# 31. TBMT — import toàn bộ version

Hiện tượng cần sửa:

- không được chỉ chọn `available[-1]`;
- không được reject `revisionMode == ALL`.

Flow:

```text
TBMT code
    ↓
list all versions
    ↓
get detail each version
    ↓
chronological reconciliation
    ↓
package lineage/version history
```

Phải hỗ trợ:

- ALL;
- LATEST;
- SELECTED nếu UI/domain có nhu cầu.

---

# 32. Durable Import Operation

Với ALL:

- import old → new;
- mỗi revision có transaction riêng hoặc cơ chế atomic phù hợp;
- operation có cursor;
- resume;
- idempotency;
- retry an toàn;
- tránh duplicate.

Một operation bị dừng giữa chừng phải resume được.

---

# 33. Provenance bắt buộc

Mỗi imported snapshot cần biết:

- source provider;
- source revision;
- upstream id;
- upstream code;
- retrievedAt;
- parser version;
- schema fingerprint;
- extraction strategy;
- operation id;
- local version;
- imported/observed/applied state.

Không lưu token/cookie vào provenance.

---

# 34. Lookup và Import dùng chung source

UI lookup hiện có của Bidding phải dùng cùng source/transport mới.

Không duy trì song song:

```text
browser lookup cũ
+
web_dau_thau adapter mới
```

nếu chúng làm cùng nhiệm vụ.

Refactor về một source abstraction.

---

# 35. Biên bản mở thầu — nút lấy dữ liệu từ Mua Sắm Công

Trong màn hình biên bản mở thầu, thêm nút:

```text
Lấy dữ liệu mở thầu từ Mua Sắm Công
```

Nút nằm cùng khu vực với các action hiện tại như:

- thêm nhà thầu;
- lưu;
- import Excel;
- download Excel.

Không tạo popup cảnh báo dư thừa.

---

# 36. Opening preview trước khi apply

Flow:

```text
click button
    ↓
fetch opening bundle
    ↓
normalize
    ↓
preview
    ↓
compare current draft
    ↓
apply
```

Nếu draft đã thay đổi sau preview phải detect stale/conflict.

Không tự ghi đè dữ liệu người dùng vừa sửa.

---

# 37. Opening endpoint support

Phải port các flow đang có trong `WEB_DAU_THAU`, bao gồm:

```text
notify
roundmng
bid-open
lot-open
lotOpenDetail
```

và các branch khác như:

- other;
- ADB/WB;
- LDT;
- 1G2T.

---

# 38. 1G2T

Đối với quy trình 1 giai đoạn 2 túi hồ sơ:

Phải phân biệt:

```text
technical opening
financial opening
```

theo `packType`/logic thực tế của source.

Không trộn dữ liệu kỹ thuật với tài chính.

---

# 39. Mapping biên bản mở thầu vào Bidding

Phải map vào model hiện có, không tạo parallel data model.

Reuse:

- `thongtinmothau`;
- model opening data;
- nhà thầu;
- contractor exact-version binding;
- liên danh;
- member;
- lead/member role;
- giá dự thầu;
- scope lot;
- hàng hóa dự thầu;
- validation hiện có.

---

# 40. Contractor resolution

Khi source trả mã nhà thầu:

1. tìm trong DB Bidding;
2. nếu chưa có, dùng contractor lookup hiện có;
3. resolve exact contractor/business date nếu domain yêu cầu;
4. tránh duplicate;
5. liên danh phải tái tạo đúng member/leader relationship.

---

# 41. Package lots

Đối với gói phân lô:

- giữ đúng lot identity;
- không reorder lot;
- map contractor participation scope;
- map giá dự thầu theo lot nếu upstream cung cấp;
- không gộp nhầm nhiều lot;
- không mất dữ liệu lot history.

---

# 42. Không downgrade dữ liệu local

Import upstream không được vô tình:

- đưa package từ trạng thái sau về `Đang chuẩn bị`;
- reset người phụ trách;
- mất assignment;
- mất opening data;
- mất contractor;
- mất lot;
- mất local note;
- mất history;
- mất relationship.

---

# 43. Security / workspace / permission

Giữ toàn bộ security model của Bidding.

Bắt buộc:

- authenticated route;
- organization/workspace scope;
- permission/capability check;
- investor validation;
- không cross-tenant;
- không để source integration vượt quyền user;
- rate limit hợp lý;
- server-side secret handling.

---

# 44. Token/cookie protection

Bắt buộc:

```text
token: server-side only
cookie: server-side only
```

Cấm:

- return token cho frontend;
- return cookie cho frontend;
- ghi token vào PostgreSQL;
- ghi cookie vào PostgreSQL;
- log full token;
- log full cookie;
- attach secret vào exception gửi client.

---

# 45. Retry / timeout / circuit breaker / concurrency

Giữ hoặc cải thiện:

- bounded timeout;
- bounded retry;
- concurrency semaphore;
- max response size;
- circuit breaker;
- single-flight session refresh;
- retry only theo policy rõ ràng;
- cancellation/cleanup browser.

Không tạo request storm khi upstream lỗi.

---

# 46. Parser không được gắn trực tiếp persistence

Luồng bắt buộc:

```text
upstream raw
    ↓
classifier/fingerprint
    ↓
versioned parser
    ↓
canonical DTO
    ↓
domain reconciler
    ↓
repository
```

Parser không được insert/update database trực tiếp.

---

# 47. Canonical DTO

Tạo stable canonical schema cho:

- PlanRevision;
- PackageObservation;
- NoticeRevision;
- OpeningBundle;
- ContractorObservation;
- LotObservation;
- ResultBundle nếu cần.

Upstream đổi field không được làm DB/domain thay đổi ngay.

---

# 48. Suggested module layout

Có thể refactor theo cấu trúc tương đương:

```text
backend/integrations/muasamcong/
│
├── source.py
├── contract.py
│
├── session/
│   ├── provider.py
│   ├── session_cache.py
│   └── browser_worker.*
│
├── transport/
│   ├── client.py
│   ├── retry.py
│   └── endpoint_catalog.py
│
├── strategies/
│   ├── api.py
│   ├── browser_network.py
│   ├── framework_state.py
│   └── semantic_dom.py
│
├── extractors/
│   ├── vue2.*
│   ├── vue3.*
│   ├── react.*
│   └── generic.*
│
├── classifier/
│   ├── classifier.py
│   └── fingerprint.py
│
├── parsers/
│   ├── registry.py
│   ├── plan_v1.py
│   ├── package_v1.py
│   ├── opening_v1.py
│   └── ...
│
├── collectors/
│   ├── plan.py
│   ├── notice.py
│   ├── opening.py
│   └── result.py
│
├── normalizers/
│   └── canonical.py
│
└── diagnostics/
    ├── recorder.py
    └── sanitizer.py
```

Đây là gợi ý kiến trúc, Codex có thể điều chỉnh tên/module nếu phù hợp codebase hiện tại, nhưng phải giữ separation of concerns.

---

# 49. Backward compatibility

Không làm hỏng:

- plan edit;
- package edit;
- existing lookup;
- existing import;
- Excel import/export;
- bid opening manual entry;
- package versioning;
- assignment;
- permissions;
- historical views.

Nếu cần migration, migration phải backward-compatible.

---

# 50. Test — Token/Session

Viết test cho:

- browser launch;
- token capture từ network;
- cookie extraction;
- cache;
- TTL;
- `forceRefresh`;
- retry;
- browser cleanup;
- shared refresh/single-flight;
- concurrent callers.

---

# 51. Test — behavior fallback ported từ source

Mock các trường hợp source hiện tại xử lý:

- portal bình thường;
- portal/Vue không phát token;
- frontend error;
- fallback path được invoke;
- session thu được;
- protected request tiếp tục.

Test phải chứng minh capability không nhỏ hơn source.

Không cần test live bypass external protection trong CI; test behavior bằng mock/fixture ở boundary nội bộ.

---

# 52. Test — API Client

Test:

```text
request #1 → 401/403
refresh session
request #2 → success
```

và các status khác theo policy thực tế của source.

---

# 53. Test — Plan ALL versions

Case:

```text
Source rev 00:
  A
  B

Source rev 01:
  A unchanged
  B changed
  C new
```

Assert:

```text
Plan-00:
  A-00
  B-00

Plan-01:
  A-00
  B-01
  C-00
```

---

# 54. Test — removed package

```text
rev 00: A, B
rev 01: A
```

Assert:

- B vẫn ở historical rev 00;
- B không được clone vào rev 01;
- không hard-delete B history.

---

# 55. Test — local edit interleaving

Ví dụ:

```text
source 00
local edit
source 01
local edit
source 02
```

Assert:

- source-owned fields merge đúng;
- local-owned fields được giữ;
- conflict được preview;
- version chỉ tăng khi đúng semantic.

---

# 56. Test — backfill

Import source revision cũ sau revision mới.

Assert:

- không rollback latest local state;
- provenance vẫn lưu;
- trạng thái observation phù hợp.

---

# 57. Test — TBMT ALL

Phải test:

- all revisions;
- ordering;
- unchanged;
- changed;
- idempotency;
- resume.

Không được chỉ test latest.

---

# 58. Test — Opening

Bao gồm:

- normal package;
- 1G1T;
- 1G2T technical;
- 1G2T financial;
- lot package;
- independent contractor;
- joint venture;
- multiple contractors;
- zero/missing optional price;
- stale preview;
- local modifications;
- idempotent apply.

---

# 59. Contract tests từ fixture corpus

Mỗi fixture phải test:

```text
raw artifact
→ classifier
→ fingerprint
→ parser
→ canonical DTO
```

Không cần database cho contract test.

---

# 60. Regression test parser cũ

Khi thêm parser mới:

- ParserV1 fixture phải vẫn pass;
- ParserV2 fixture pass;
- registry chọn đúng parser;
- unknown schema trả `PROCUREMENT_SCHEMA_CHANGED`.

---

# 61. Test secrets

Assert:

- API response không chứa token;
- API response không chứa cookie;
- logs không chứa secret;
- diagnostic sanitizer loại secret;
- exceptions ra frontend không chứa secret.

---

# 62. Observability

Thêm metrics/log an toàn:

- provider;
- semantic operation;
- totalMs;
- browserStartupMs;
- navigationMs;
- networkWaitMs;
- extractMs;
- normalizeMs;
- parserVersion;
- schemaFingerprint;
- extractionStrategy;
- retries;
- sessionRefreshCount.

Không log secret.

---

# 63. Health / upstream change detection

Tạo health signal phân biệt:

```text
UP
SESSION_DEGRADED
API_CHANGED
SCHEMA_CHANGED
FRONTEND_CHANGED
PARTIAL
DOWN
```

Mục đích là developer biết upstream đổi chỗ nào.

Không phải để chặn toàn bộ app.

---

# 64. Migration strategy

Không rewrite toàn bộ Bidding trong một lần nếu không cần.

Ưu tiên:

### Phase 1

- port SessionProvider;
- port API transport;
- port endpoint catalog;
- expose unified source.

### Phase 2

- Plan ALL versions;
- Notice ALL versions;
- canonical DTO;
- provenance.

### Phase 3

- Opening import;
- contractor/JV/lot mapping.

### Phase 4

- strategy manager;
- fingerprint;
- parser profiles;
- diagnostics;
- shadow parser.

Tuy nhiên, nếu codebase phù hợp, có thể triển khai trong một PR lớn miễn test rõ ràng.

---

# 65. Không được tạo duplicate architecture

Trước khi tạo module mới phải kiểm tra code hiện có.

Reuse/refactor các phần tốt hiện có trong Bidding, đặc biệt:

- `ProcurementSource`;
- `PayloadClassifier`;
- `ParserRegistry`;
- canonical/domain helpers;
- `ProcurementPlanReconciler`;
- `ProcurementImportRepository`;
- durable import operation;
- version inheritance;
- bid opening model;
- lookup DTO.

Không tạo hệ thống song song không cần thiết.

---

# 66. Function-by-function mapping bắt buộc

Trước coding, lập bảng nội bộ:

| Source `WEB_DAU_THAU` | Target `Bidding` | Action |
|---|---|---|
| `mscTokenProvider.js` | SessionProvider/internal worker | PORT + REFACTOR |
| browser launch config | SessionProvider | PORT |
| network token capture | SessionProvider | PORT |
| cookie extraction | SessionProvider | PORT |
| token cache/refresh | SessionProvider | PORT + IMPROVE SINGLE-FLIGHT |
| current fallback flow | SessionProvider | PORT |
| protected API caller | MscApiClient | PORT |
| public API caller | MscApiClient | PORT |
| endpoint constants | EndpointCatalog/Profile | PORT + REFACTOR |
| plan version collector | PlanCollector | PORT |
| plan detail collector | PlanCollector | PORT |
| versioned detail collector | shared collector helper | PORT |
| tender complete bundle | NoticeCollector | PORT |
| opening collector | OpeningCollector | PORT |
| SQLite persistence | Bidding persistence | DO NOT PORT |
| Express public server | internal integration only | DO NOT PORT |
| frontend WEB_DAU_THAU | Bidding frontend | DO NOT PORT |

---

# 67. Acceptance criteria — capability

Task chưa hoàn thành nếu:

- Bidding vẫn phải copy token thủ công;
- Bidding không tự lấy cookie;
- Bidding lấy được ít loại dữ liệu hơn `WEB_DAU_THAU`;
- Bidding chỉ lấy latest version;
- Bidding không import được packages từ KHLCNT;
- Bidding không import toàn bộ TBMT revisions;
- Bidding không lấy được opening data đã được source hỗ trợ;
- Bidding làm mất behavior session/browser hiện có của source;
- Bidding tạo public sidecar server không cần thiết.

---

# 68. Acceptance criteria — versioning

Task chưa hoàn thành nếu:

- unchanged package vẫn tăng local version;
- changed package không tăng version;
- new package không bắt đầu từ version 00;
- removed package bị hard-delete;
- backfill rollback latest;
- tạo version làm mất assignment;
- tạo version làm mất trạng thái;
- tạo version làm mất dữ liệu mở thầu;
- source revision bị ép bằng local version.

---

# 69. Acceptance criteria — architecture

Task chưa hoàn thành nếu:

- endpoint nằm rải rác khắp business code;
- browser/session logic dính trực tiếp vào plan/package service;
- parser ghi DB trực tiếp;
- Bidding domain phụ thuộc Vue;
- đổi endpoint bắt buộc sửa nhiều module nghiệp vụ;
- đổi upstream field bắt buộc sửa persistence/domain;
- không có parser versioning;
- không có contract/fixture tests.

---

# 70. Acceptance criteria — security

Task chưa hoàn thành nếu:

- token/cookie xuất hiện ở frontend;
- token/cookie được persist;
- token/cookie xuất hiện trong log;
- cross-workspace access;
- import route bỏ authorization;
- diagnostic chứa secret.

---

# 71. UI/UX

Giữ UI đơn giản.

Không sinh popup/cảnh báo thừa.

Với import:

```text
Fetch
→ Preview
→ Apply
```

Hiển thị rõ:

- revision;
- action;
- conflict;
- changed fields;
- result.

Opening import cũng theo cùng pattern.

---

# 72. Performance

Không fetch lặp vô ích.

Áp dụng:

- session reuse;
- TTL cache;
- bounded concurrency;
- request deduplication;
- single-flight;
- conditional detail fetch nếu đã có immutable revision;
- operation resume;
- reasonable timeout.

Không chạy browser mới cho từng API call nếu session cũ còn hợp lệ.

---

# 73. Failure isolation

Nếu một revision lỗi:

- operation phải ghi đúng failure;
- không làm mất revisions đã commit hợp lệ;
- cho phép resume;
- không tạo half-written aggregate.

Nếu parser một data type lỗi:

- không làm hỏng toàn bộ integration layer;
- health/diagnostic phải chỉ rõ semantic operation/schema gặp lỗi.

---

# 74. Documentation

Sau triển khai, tạo/update tài liệu:

- kiến trúc integration;
- session lifecycle;
- endpoint profile;
- parser/fingerprint;
- cách thêm parser mới;
- cách thêm endpoint profile mới;
- cách debug upstream schema change;
- cách chạy contract tests;
- cách chạy E2E;
- environment variables;
- Node/browser dependencies nếu có.

---

# 75. Environment/configuration

Không hard-code config môi trường nếu không thực sự bắt buộc bởi source.

Cho phép cấu hình:

- provider;
- browser executable path;
- headless;
- timeout;
- concurrency;
- cache TTL;
- active endpoint profile;
- diagnostics enable/disable;
- shadow parser enable/disable.

Các giá trị nhạy cảm không commit vào repository.

---

# 76. Yêu cầu nghiên cứu trước khi sửa

Trước khi thay code, Codex phải:

1. đọc implementation hiện tại;
2. xác định code nào đã đáp ứng requirement;
3. tránh rewrite phần đang đúng;
4. xác định exact files/functions cần sửa;
5. xác định migration risk;
6. xác định test cần thêm;
7. sau đó mới coding.

Không được giả định kiến trúc chỉ từ prompt.

---

# 77. Yêu cầu thực thi

Sau nghiên cứu:

1. triển khai code;
2. viết migration nếu cần;
3. viết unit tests;
4. viết integration tests;
5. viết contract tests;
6. viết E2E test phù hợp;
7. chạy test;
8. sửa lỗi;
9. kiểm tra lint/type/static checks;
10. báo cáo các file đã thay đổi.

---

# 78. Báo cáo cuối cùng của Codex

Khi hoàn thành, trả về:

## A. Kiến trúc cuối

Sơ đồ:

```text
Frontend
  ↓
Bidding API
  ↓
Procurement Source
  ↓
Collector
  ↓
MscApiClient
  ↓
SessionProvider
  ↓
Mua Sắm Công
```

và fallback strategy.

## B. Files changed

Nêu rõ từng file:

```text
path
reason
```

## C. Source mapping

Phần nào được port từ `WEB_DAU_THAU`.

## D. Versioning

Mô tả cách bảo đảm:

```text
A-00
B-00
→
A-00
B-01
C-00
```

## E. Opening import

Mô tả mapping.

## F. Tests

Danh sách test đã chạy + kết quả.

## G. Known limitations

Không che giấu limitation.

---

# 79. Nguyên tắc cuối cùng

Ba source of truth cần được giữ rõ ràng:

## Retrieval capability

```text
WEB_DAU_THAU
```

là nguồn tham chiếu capability hiện tại của Mua Sắm Công.

## Business/domain/versioning/security

```text
Bidding
```

là source of truth.

## Upstream data

```text
Mua Sắm Công
```

là source dữ liệu bên ngoài.

Không được để một tầng chiếm trách nhiệm của tầng khác.

---

# 80. Definition of Done

Chỉ coi task hoàn thành khi đồng thời đạt:

- [ ] Port nguyên capability retrieval hiện có của `WEB_DAU_THAU`.
- [ ] Browser/session/token/cookie hoạt động tự động.
- [ ] Không giảm behavior hiện có của source.
- [ ] Unified Mua Sắm Công source.
- [ ] Stable procurement contract.
- [ ] SessionProvider tách riêng.
- [ ] EndpointCatalog/Profile.
- [ ] Retrieval Strategy Manager.
- [ ] Schema Fingerprint.
- [ ] Versioned Parser Registry.
- [ ] Field Alias Resolver.
- [ ] Sanitized diagnostics.
- [ ] Fixture corpus.
- [ ] Plan ALL revisions.
- [ ] Plan package import/link.
- [ ] TBMT ALL revisions.
- [ ] Independent plan/package versioning.
- [ ] Correct inheritance.
- [ ] Removed-package history.
- [ ] Backfill-safe reconciliation.
- [ ] Three-way merge/conflict preview.
- [ ] Opening import button.
- [ ] Opening normal/lot/1G2T support.
- [ ] Contractor/JV/lot mapping.
- [ ] Durable operation/resume/idempotency.
- [ ] Provenance.
- [ ] Workspace/permission preserved.
- [ ] No token/cookie leak.
- [ ] Unit/integration/contract/E2E tests pass.
- [ ] Documentation updated.

Nếu một requirement trong prompt xung đột với implementation hiện tại, ưu tiên:

1. giữ đúng business/domain/versioning/security của `Bidding`;
2. giữ capability retrieval hiện có của `WEB_DAU_THAU`;
3. refactor integration để thỏa cả hai;
4. không âm thầm bỏ requirement.

Hãy thực hiện đầy đủ, không chỉ phân tích hoặc viết plan.
