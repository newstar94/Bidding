Bạn đang làm việc trực tiếp trên repository:

https://github.com/newstar94/Bidding

Mục tiêu của task này là:

> XÁC ĐỊNH CHÍNH XÁC nguyên nhân GitHub CI `Cross-browser and workflow E2E` đang fail, sửa root cause và đưa toàn bộ nhóm Playwright/E2E liên quan về trạng thái ổn định trên Chromium, Firefox và WebKit.

Không chỉ rerun test.

Không che flakiness.

Không dừng ở một workaround local.

---

# 1. LUÔN DÙNG CODE MỚI NHẤT

Trước khi làm:

```bash
git status
git branch --show-current
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git log --oneline -10
```

Tại thời điểm prompt này được viết, HEAD gần nhất đã được quan sát là:

```text
14fe8a810b29b1ca2f2fd292daafca7a15c9a27c
```

Nhưng phải coi `origin/main` hiện tại mới là source of truth.

Không overwrite uncommitted work.

Ghi exact SHA vào báo cáo cuối.

---

# 2. ĐỌC CI TRƯỚC KHI SỬA

Đọc:

```text
.github/workflows/ci.yml
package.json
playwright.config.mjs
AGENTS.md
CONTEXT.md
```

và toàn bộ E2E helpers/config liên quan.

Xác định chính xác job:

```text
Cross-browser and workflow E2E
```

và thứ tự các step.

Theo trạng thái CI gần nhất đã quan sát, job đang fail tại step:

```text
Cross-browser Playwright matrix
```

trước khi tới toàn bộ workflow E2E phía sau.

Step này có các command kiểu:

```bash
npm run check:e2e-discovery
npm run test:e2e:smoke
```

Không được mặc định lỗi nằm ở full workflow suites nếu chúng chưa chạy.

---

# 3. REPRODUCE CHÍNH XÁC CI

Dùng version/runtime tương ứng GitHub workflow hiện tại.

Cài dependency đúng CI.

Sau đó chạy:

```bash
npm run check:e2e-discovery
```

Nếu pass, chạy:

```bash
npm run test:e2e:smoke
```

Không chạy mỗi Chromium.

Phải chạy đúng matrix:

```text
Chromium
Firefox
WebKit
```

Nếu smoke fail:

ghi chính xác:

```text
browser
spec
test title
line
error
URL
navigation state
console errors
network errors
server errors
```

---

# 4. ĐỌC ARTIFACT CI NẾU CÓ THỂ

Nếu môi trường có quyền GitHub Actions/artifacts:

tải diagnostic artifact của Full CI gần nhất.

Inspect:

```text
playwright-report
test-results
trace.zip
screenshots
videos
console logs
server logs
e2e-results.json
```

Không dựa vào tên job để đoán root cause.

Nếu không truy cập được artifact:

reproduce local bằng exact CI command.

---

# 5. ROOT CAUSE ĐÃ NGHI NGỜ — FIREFOX NAVIGATION RACE

Code/evidence hiện tại cho thấy một failure đã từng xảy ra:

```text
Firefox
NS_BINDING_ABORTED
```

sau login trong specialist flow.

Đặc biệt inspect:

```text
e2e/specs/specialist-create.spec.mjs
```

và các helper login/readiness đang dùng.

Pattern cần review:

```js
await page.goto("/dang-nhap", { waitUntil: "commit" });

// login

await expect(page.locator("#auth-overlay")).toBeHidden();

await ready(page);

await page.goto("/nha-thau", { waitUntil: "commit" });
```

`ready(page)` hiện có thể chỉ chờ application state kiểu:

```text
startupReconciliationPhase === RECONCILED
```

nhưng chưa chắc browser navigation/router đã settle.

Potential race:

```text
login
↓
app starts redirect / route restore
↓
startup reconciliation says RECONCILED
↓
test immediately page.goto(...)
↓
application navigation and Playwright navigation overlap
↓
Firefox aborts one navigation
↓
NS_BINDING_ABORTED
```

KHÔNG được coi đây là root cause cuối cùng nếu current failing trace chứng minh lỗi khác.

Reproduce trước.

---

# 6. KHÔNG VÁ BẰNG SLEEP

Cấm dùng như fix chính:

```js
await page.waitForTimeout(1000);
await page.waitForTimeout(3000);
```

Cấm tăng timeout hàng loạt.

Cấm tăng:

```text
retries
```

chỉ để test xanh.

Cấm:

```text
test.skip
test.fixme
```

để bỏ Firefox/WebKit.

Fix phải dựa trên deterministic readiness condition.

---

# 7. TẠO AUTH/ROUTER READINESS HELPER CHUẨN

Nếu xác nhận post-login navigation race, tạo/reuse helper duy nhất kiểu:

```text
loginAndWaitForWorkspaceReady()
```

Tên cụ thể theo conventions repo.

Helper phải chờ đủ các boundary cần thiết, ví dụ:

```text
login request accepted
↓
authenticated session established
↓
auth overlay hidden
↓
authenticated user/context restored
↓
workspace/organization resolved
↓
startup reconciliation complete
↓
router/post-login redirect settled
↓
expected authenticated shell visible
```

Không chỉ dựa vào:

```text
networkidle
```

nếu application có polling/WebSocket khiến network không idle.

Không chỉ dựa vào arbitrary timeout.

Dùng application-observable invariant thực sự.

---

# 8. TRÁNH DOUBLE NAVIGATION

Sau login, xác định application có tự điều hướng hay không.

Nếu app tự redirect:

đừng ngay lập tức gọi một `page.goto()` cạnh tranh với router.

Có thể thay bằng một trong các chiến lược phù hợp:

```text
waitForURL()
click application navigation
router helper
explicit wait for redirect settle
```

Nếu cần direct `page.goto()`:

phải đảm bảo navigation trước đã kết thúc hoàn toàn.

Không dùng `NS_BINDING_ABORTED` catch rồi ignore một cách chung chung.

Chỉ xử lý aborted navigation nếu chứng minh đó là expected browser lifecycle và vẫn verify final URL/state.

---

# 9. AUDIT TOÀN BỘ LOGIN → NAVIGATE PATTERN

Search repository:

```text
page.goto("/dang-nhap"
auth-overlay
startupReconciliationPhase
ready(page)
waitForURL
login helper
```

Tìm tất cả test có pattern:

```text
login
↓
ready
↓
page.goto(...)
```

Ít nhất kiểm tra:

```text
specialist-create.spec.mjs
browser-matrix.spec.mjs
contractor-related specs
role/auth specs
workflow specs
```

Không vá riêng một test nếu cùng race pattern lặp lại.

---

# 10. KHÔNG REGRESS BUSINESS ASSERTIONS

`specialist-create.spec.mjs` hiện có business coverage quan trọng, ví dụ:

```text
specialist creates contractor
uploads stamp
POST /api/sync succeeds
reload
record exists
stamp converted to managed path
edit form renders stamp
```

Giữ nguyên assertion nghiệp vụ.

Không giảm test thành:

```text
page loaded
```

chỉ để CI pass.

---

# 11. PHÂN BIỆT TEST RACE VÀ APPLICATION BUG

Nếu trace cho thấy application thật sự có double-navigation bug:

fix application/router.

Nếu application đúng nhưng test điều hướng cạnh tranh:

fix test/helper.

Không mặc định test luôn sai.

Kiểm tra:

```text
app initiated navigation
router history
location.href
document lifecycle
page URL sequence
```

---

# 12. GIỮ FIX RENDERER/OOM HIỆN CÓ

Repo trước đây đã có bug nghiêm trọng trong sync:

```text
active pull Map
↓
Promise.allSettled(activePulls)
↓
Map entries treated as arrays
↓
pull falsely considered settled
↓
recursive autosync
↓
Promise/event-loop growth
↓
renderer OOM
```

Code mới đã có fix lấy:

```text
flight.promise
```

thực sự.

Không revert hoặc làm mất fix đó.

Run regression tests liên quan SyncPull/SyncPush.

Nếu browser memory lại tăng:

đo heap/process memory và xác định đây là regression mới, không giả định bug cũ quay lại.

---

# 13. CROSS-BROWSER DIFFERENCES

Nếu bug chỉ xảy ra Firefox:

không viết branch kiểu:

```js
if (browserName === "firefox") {
  waitForTimeout(...)
}
```

trừ khi có browser-specific product behavior được document.

Fix synchronization invariant để cả ba browser dùng được.

Test:

```text
Chromium
Firefox
WebKit
```

---

# 14. E2E HELPER DESIGN

Helper mới phải:

- nhỏ;
- reusable;
- deterministic;
- không chứa business assertion riêng của một spec;
- không hide failures;
- fail với message rõ ràng.

Ví dụ helper có thể expose:

```text
loginAs(...)
waitForAuthenticatedShell(...)
navigateAfterAuth(...)
waitForWorkspaceReady(...)
```

Không tạo một helper khổng lồ thực hiện nửa test suite.

---

# 15. ROUTE READINESS

Khi vào route như:

```text
/nha-thau
/ke-hoach
/goi-thau
/hop-dong
```

không chỉ check URL.

Chờ một route-specific stable element, ví dụ:

```text
page title
main container
form/list root
data-ready marker
```

theo architecture hiện tại.

Không chờ generic spinner biến mất nếu page có nhiều independent loaders.

---

# 16. AUTHENTICATED SHELL READINESS

Thiết kế một invariant rõ ràng, ví dụ:

```text
auth overlay hidden
authenticated principal exists
sidebar/workspace shell visible
startup reconciliation complete
```

Nếu code application chưa expose trạng thái route-ready đủ rõ:

có thể thêm một testable, non-sensitive DOM/data attribute hoặc application state seam nhỏ.

Không expose secret/session token vào DOM chỉ để test.

---

# 17. NAVIGATION FAILURE DIAGNOSTICS

Khi test fail, logging helper nên có:

```text
current URL
expected URL
document.readyState
auth overlay state
startup reconciliation state
workspace id presence
console errors
page errors
failed requests
```

Không log:

```text
session token
CSRF secret
password
raw protected data
```

---

# 18. FIX TEST DISCOVERY NẾU CẦN

`check:e2e-discovery` hiện khả năng cao đã pass vì static CI xanh.

Tuy nhiên vẫn chạy.

Nếu discovery fail trên current HEAD:

fix:

```text
duplicate titles
missing spec
invalid project mapping
unregistered test
```

Không bỏ discovery check.

---

# 19. SAU SMOKE PASS — CHẠY FULL WORKFLOW E2E

Khi:

```bash
npm run test:e2e:smoke
```

PASS trên cả ba browser, tiếp tục chạy đúng các workflow command trong `.github/workflows/ci.yml`.

Ví dụ hiện có thể gồm:

```bash
npm run test:auth-shell
npm run test:auth-roles-e2e
npm run test:bidder-goods-e2e
npm run test:crud-modules-e2e
npm run test:multi-assignee-e2e
npm run test:joint-venture-e2e
npm run test:low-price-conflict-e2e
npm run test:offline-sync-e2e:soak
npm run test:package-pairwise-e2e
npm run test:lifecycle
npm run test:ui-quality-e2e
```

Nhưng lấy exact list từ workflow hiện tại.

Không dùng danh sách prompt nếu repo đã thay đổi.

---

# 20. COMMIT MỚI CÓ LIFECYCLE E2E

Current HEAD gần đây có commit:

```text
Add lifecycle E2E fixture and associated tests
```

Do đó sau smoke pass phải đặc biệt chạy lifecycle suite mới.

Nếu lifecycle suite fail:

tách nó thành issue riêng khỏi cross-browser smoke nếu root cause khác.

Không làm thay đổi lifecycle business behavior chỉ để test xanh.

---

# 21. E2E DATABASE STATE

Kiểm tra test isolation:

```text
schema
fixture
organization
users
assignments
billing data
```

Mỗi test phải bắt đầu từ state deterministic.

Nếu Firefox test fail vì record từ Chromium run còn sót lại:

fix fixture/schema isolation.

Không workaround bằng random suffix ở mọi assertion nếu CI design đã có per-run schema.

---

# 22. SERVICE STARTUP READINESS

Đảm bảo CI không chạy browser trước application thực sự ready.

Inspect workflow startup code.

Nếu hiện chỉ:

```text
start process in background
sleep N
```

thì cân nhắc health-check loop deterministic:

```text
GET health endpoint
expected response
database ready
app startup completed
```

Không thay đổi nếu current startup readiness đã robust.

---

# 23. PLAYWRIGHT WEB SERVER / EXTERNAL SERVER

Xác định CI đang:

```text
start app manually
```

hay Playwright config dùng `webServer`.

Không chạy hai server cạnh tranh cùng port.

Không để stale previous process tồn tại giữa reruns.

---

# 24. BROWSER INSTALL

Giữ setup hiện tại:

```text
playwright install
browser dependencies
```

Không giảm matrix.

Nếu Firefox-specific CI dependency thiếu:

fix setup dependency theo official Playwright expectation.

Nhưng chỉ làm nếu logs chứng minh browser startup/dependency lỗi.

---

# 25. NO GLOBAL RETRY MASKING

`playwright.config.mjs` hiện có thể:

```text
retries: 0
workers: 1
```

Giữ `retries:0` nếu có thể.

Một test deterministic không nên cần retry.

Nếu cuối cùng có lý do chính đáng để dùng retry:

document cụ thể tại sao và không dùng để che navigation race.

---

# 26. TEST REPEATABILITY

Sau fix, không chỉ chạy smoke một lần.

Chạy focused failing test nhiều lần:

```bash
npx playwright test <spec> --project=firefox --repeat-each=10
```

hoặc exact equivalent phù hợp config.

Sau đó:

```text
Chromium repeat
Firefox repeat
WebKit repeat
```

Không cần repeat toàn bộ huge suite 10 lần nếu quá tốn.

Nhưng failing seam phải chứng minh không flaky.

---

# 27. STRESS POST-LOGIN HELPER

Nếu race là login/navigation:

tạo focused test hoặc repeat để stress:

```text
login
wait ready
navigate contractor
logout/relogin if relevant
```

nhiều lần.

Không để helper chỉ pass một lần may mắn.

---

# 28. ASSERT NO UNEXPECTED PAGE ERROR

Trong relevant smoke tests, collect:

```text
pageerror
requestfailed
console.error
```

Không fail trên mọi benign browser warning.

Nhưng navigation exception/app uncaught error phải được surfaced.

---

# 29. `VM### / startTime` CONSOLE NOISE

Nếu gặp lại:

```text
VM172
Cannot read properties of undefined (reading 'startTime')
```

không mặc định đó là app bug.

Trong Playwright CI browser sạch, browser extensions thường không tồn tại.

Nếu lỗi không reproduce trong clean browser CI:

không patch app.

Nếu Playwright clean browser vẫn có:

xác định source script bằng URL/source map trước khi sửa.

---

# 30. PRESERVE PREVIOUS AUTHORIZATION FIXES

Không regress:

```text
specialist create plan/package/contract
server self-assignment
contractor stamp
manager transfer
lineage authorization fixes nếu HEAD đã có
```

Relevant E2E must continue pass.

---

# 31. PRESERVE OFFLINE SYNC

Do smoke specialist flow có thể trigger sync:

không sửa E2E bằng cách bypass:

```text
MutationService
SyncPushService
IndexedDB
outbox
```

trừ khi test thực sự không cần offline behavior.

Business E2E phải sử dụng production-like path.

---

# 32. CHECK STATIC AFTER E2E HELPER REFACTOR

Sau khi thay helpers/specs:

```bash
npm run check:static
```

phải pass.

Không tạo:

```text
dead helper
duplicate helper
unused export
frontend debt
```

---

# 33. JS TESTS

Nếu thay application frontend code:

run:

```bash
npm run test:js:coverage
```

Nếu chỉ thay E2E helpers, vẫn chạy targeted lint/static.

Nếu helper abstraction có unit-testable behavior, bổ sung test khi hợp lý.

---

# 34. PYTHON TESTS

Nếu fix nằm frontend test-only:

không cần chạy toàn bộ Python ngay sau mỗi patch.

Nhưng trước final, chạy CI-equivalent suite phù hợp hoặc ít nhất xác nhận không có backend code thay đổi.

Nếu backend/router/startup bị sửa:

run targeted Python tests + coverage relevant.

---

# 35. SECURE BUILD

Nếu E2E chạy trên secure build artifact:

sau frontend application changes phải chạy:

```bash
npm run build:secure
```

và E2E trên đúng artifact type mà CI dùng.

Không chỉ test dev server nếu CI test production build.

---

# 36. DO NOT CHANGE BUSINESS CODE UNLESS NEEDED

Nếu root cause nằm test synchronization:

fix test infrastructure.

Không sửa business workflow chỉ để browser test timing thay đổi.

Nếu root cause là real app router race:

fix app + regression test.

---

# 37. EXPECTED FIX SHAPE NẾU NAVIGATION RACE ĐƯỢC XÁC NHẬN

Preferred conceptual solution:

```text
shared auth E2E helper
        ↓
login
        ↓
wait authenticated shell
        ↓
wait post-login route stable
        ↓
wait startup reconciliation
        ↓
navigate through stable route method
        ↓
wait route-specific readiness
```

Use helper everywhere appropriate.

Không duplicate 6 different definitions of `ready()`.

---

# 38. SEARCH FOR DUPLICATE READINESS HELPERS

Search:

```text
function ready
const ready
waitForWorkspace
waitForStartup
auth-overlay
startupReconciliationPhase
```

Nếu nhiều helpers làm gần giống nhau:

consolidate incrementally.

Không mass-refactor toàn E2E suite trong cùng patch nếu rủi ro.

---

# 39. CURRENT CI DEFINITION OF DONE

Task chưa hoàn thành chỉ vì focused Firefox test pass.

Phải đạt ít nhất:

```text
check:e2e-discovery          PASS
test:e2e:smoke              PASS
Chromium                     PASS
Firefox                      PASS
WebKit                       PASS
```

Sau đó:

```text
Full role/workflow E2E       PASS
```

theo commands trong current workflow.

---

# 40. KHÔNG CLAIM CI XANH NẾU CHƯA CHẠY

Nếu local environment không thể chạy một browser:

ghi:

```text
NOT VERIFIED
```

Không nói:

```text
fixed
```

chỉ dựa vào code review.

---

# 41. PATCH PLAN

Ưu tiên:

## Patch A

Reproduce + diagnostics.

Không behavior change.

## Patch B

Shared authenticated-shell / route-readiness helper.

## Patch C

Migrate affected specs.

## Patch D

Application router fix nếu trace chứng minh app race thật.

## Patch E

Repeat/stability regression coverage.

## Patch F

Full workflow E2E verification.

---

# 42. FINAL SELF REVIEW

Trước khi kết thúc:

```bash
git status
git diff --check
git diff --stat
git diff
```

Tự kiểm tra:

```text
Có timeout/retry nào được tăng chỉ để pass?
Có test nào bị skip?
Có browser nào bị remove?
Có assertion nghiệp vụ nào bị làm yếu?
Có sleep mới?
Có catch NS_BINDING_ABORTED rồi ignore vô điều kiện?
Có helper nào khiến lỗi thật bị nuốt?
```

Nếu có:

task chưa hoàn thành.

---

# 43. FINAL RESPONSE FORMAT

Trả về:

## Baseline

```text
HEAD:
origin/main:
CI run inspected:
Failing job:
Failing step:
```

## Exact Failing Test

```text
Browser:
Spec:
Test:
Error:
Location:
```

Nếu failure khác previous evidence:

ghi rõ.

## Root Cause

Giải thích event sequence cụ thể.

Ví dụ:

```text
post-login redirect
→ readiness returned too early
→ competing navigation
→ Firefox NS_BINDING_ABORTED
```

Không chỉ ghi “flaky test”.

## Changes Made

Cho từng file:

```text
file
symbol/helper
before
after
reason
```

## Application vs Test Bug

Ghi rõ:

```text
application bug
test synchronization bug
or both
```

và evidence.

## Stability Verification

Bảng:

```text
Command | Browser | Runs | Passed | Failed
```

Bao gồm repeat test.

## Full E2E Verification

Liệt kê exact workflow commands.

## CI-equivalent Results

```text
check:e2e-discovery
test:e2e:smoke
full workflow E2E
check:static
secure build
```

## Files Changed

List ngắn.

## Remaining Risks

Phần chưa verify.

---

# 44. ABSOLUTE RULES

KHÔNG:

```text
skip Firefox
skip WebKit
increase retry để che flaky
waitForTimeout làm fix chính
remove assertion
catch và ignore mọi navigation error
disable CI
continue-on-error
|| true
```

Ưu tiên:

```text
DETERMINISTIC READINESS
+
CORRECT ROUTER STATE
+
CROSS-BROWSER STABILITY
+
UNCHANGED BUSINESS ASSERTIONS
```

Mục tiêu cuối cùng không phải “GitHub Actions xanh một lần”.

Mục tiêu là:

> E2E suite phải deterministic đủ để cùng flow đăng nhập → navigate → thao tác nghiệp vụ chạy ổn định trên Chromium, Firefox và WebKit, cả local lẫn Linux CI.