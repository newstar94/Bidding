# Codex Prompt — Fix CI failures after commit `59e5c0b`

Repository: `https://github.com/newstar94/Bidding`

Target commit / current HEAD context:

```text
59e5c0b
feat: enhance frontend bundle handling and improve browser session management in E2E tests
```

## Vai trò

Bạn là **Senior Staff Engineer / CI Reliability Engineer / Full-stack Debugger**.

Nhiệm vụ là sửa chính xác các lỗi CI hiện tại sau commit mới nhất, với nguyên tắc:

1. Không làm hỏng chức năng đang có.
2. Không làm chậm ứng dụng production.
3. Không hạ coverage threshold.
4. Không disable/skip test chỉ để CI xanh.
5. Không thêm sleep/timeout tùy tiện.
6. Không fake legal/compliance data.
7. Không broad-ignore lỗi package/security.
8. Ưu tiên patch nhỏ, rõ nguyên nhân, có regression test.
9. Không revert toàn bộ `59e5c0b` nếu có thể giữ được ý tưởng tốt của commit.
10. Mọi thay đổi phải được xác minh bằng test đúng scope trước, rồi mới chạy full CI.

---

# CI failures hiện tại

Hiện có 3 gate fail:

```text
Full CI / Cross-browser and workflow E2E
Full CI / Package and dependency gates
Full CI / Python unit and integration coverage
```

Các ảnh/log hiện tại cho thấy:

---

# FAILURE 1 — Cross-browser and workflow E2E

Log chính:

```text
Error: Final lot result was not rendered
```

Playwright timeout:

```text
locator('.award-result-card')
Timeout 20000ms exceeded
```

Diagnostic state cho thấy:

```text
statusBadge: "Đã có kết quả một phần"
resultCards: 0
```

Trong khi API request:

```text
POST /api/packages/.../lot-batches
```

trả:

```text
201
```

Script liên quan:

```text
scripts/verify_full_lifecycle.mjs
```

Stack trace gần:

```text
verify_full_lifecycle.mjs:1688
verify_full_lifecycle.mjs:1716
```

## Root cause hypothesis cần xác minh

Sau lot đầu tiên:

```text
.evaluation-round-card
```

đã tồn tại.

Trong helper xử lý lot tiếp theo, code đang chờ:

```js
await page
  .locator(".evaluation-round-card")
  .waitFor({ state: "visible", timeout: 20_000 });
```

Điều này có thể hoàn thành ngay lập tức vì card của lot trước đã visible.

Do đó test không thực sự chờ:

```text
lot 2 persisted
→ frontend mutation reconciled
→ lifecycle state updated
→ result rendered
```

Sau đó script chuyển tab result quá sớm và timeout.

Commit mới cũng đã thêm:

```js
click({
  force: true,
  noWaitAfter: true,
})
```

cho nút tiếp tục xử lý lot.

Đây có thể làm race rõ hơn vì Playwright actionability/navigation wait bị bỏ qua.

---

# FAILURE 2 — Python unit/integration coverage

Coverage tổng đã đạt:

```text
Required test coverage of 45% reached.
Total coverage: 63.27%
```

Kết quả:

```text
2086 passed
1 failed
1 skipped
```

Test duy nhất fail:

```text
tests/test_product_analytics_e2e.py::
test_real_backend_browser_analytics_journey
```

Lỗi:

```text
Error [ERR_MODULE_NOT_FOUND]:
Cannot find package 'playwright'

imported from:

tests/fixtures/product_analytics_browser_journey.mjs
```

Node runtime xuất hiện trong job Python:

```text
Node.js v22.23.2
```

## Root cause

Test Python đang dùng subprocess để chạy:

```text
node tests/fixtures/product_analytics_browser_journey.mjs
```

Fixture JS import:

```js
import { chromium } from "playwright";
```

Nhưng Python coverage job không cài:

```text
npm ci
Playwright browser
Node version pinned by project
```

Đây là lỗi **test placement / CI environment boundary**, không phải lỗi coverage.

---

# FAILURE 3 — Package and dependency gates

Các bước sau đã pass:

```text
Create isolated test databases
Initialize fresh PostgreSQL schemas
Production package validation
SBOM
Dependency audit
```

Fail tại:

```text
Build reproducible production archive candidate
```

Command:

```text
npm run package:production:from-build
```

Đi tiếp tới:

```text
npm run check:legal:production
```

và fail:

```text
LEGAL_READINESS_BLOCKED:
LEGAL_FACT_UNAPPROVED=27
LEGAL_PLACEHOLDER_PRESENT=27
```

Đây không phải dependency bug.

Legal readiness gate đang hoạt động đúng.

---

# PHASE 0 — Audit trước khi sửa

Trước khi sửa bất kỳ file nào:

1. Đọc:
   - `.github/workflows/ci.yml`
   - `package.json`
   - `scripts/verify_full_lifecycle.mjs`
   - `tests/js/e2e_harness_quality.test.mjs`
   - `tests/test_product_analytics_e2e.py`
   - `tests/fixtures/product_analytics_browser_journey.mjs`
   - `backend/app.py`
   - `scripts/check_legal_readiness.py`
   - `docs/legal-fact-sheet.md`
   - production package scripts

2. Chạy focused reproduction cho từng lỗi.

3. Không sửa code cho tới khi ghi rõ:

```text
Failure:
Exact root cause:
Affected file:
Minimal fix:
Regression risk:
```

---

# PHASE 1 — Fix E2E lot lifecycle synchronization

Đây là P0.

## Mục tiêu

Không tăng timeout.

Không thêm:

```text
sleep
setTimeout
waitForTimeout
```

chỉ để test pass.

Phải chờ **authoritative state transition**.

---

# 1.1 Xác minh `approveCurrentLot`

Tìm helper xử lý lot.

Nếu hiện tại có logic kiểu:

```js
const approveCurrentLot = async (...) => {
  ...
  await page.locator("#btn-approve-award").click();

  await page
    .locator(".evaluation-round-card")
    .waitFor({ state: "visible", timeout: 20_000 });
};
```

thì sửa.

---

# 1.2 Chờ round count tăng

Trước click:

```js
const roundsBefore = await page
  .locator(".evaluation-round-card")
  .count();
```

Chờ đúng POST request:

```js
const saveResponsePromise = page.waitForResponse((response) => {
  const url = new URL(response.url());

  return (
    response.request().method() === "POST"
    && url.pathname.endsWith("/lot-batches")
    && response.status() === 201
  );
});
```

Sau đó:

```js
await page.locator("#btn-approve-award").click();

await saveResponsePromise;
```

Rồi chờ:

```js
await page.waitForFunction(
  (expectedRounds) => {
    return document.querySelectorAll(".evaluation-round-card").length >= expectedRounds;
  },
  roundsBefore + 1,
  { timeout: 20_000 },
);
```

Điều chỉnh API/path theo code thật.

---

# 1.3 Ưu tiên domain state thay vì DOM count nếu có

Nếu frontend có:

```text
render version
workflow version
package lifecycle state
mutation generation
data-status
authoritative store state
```

thì dùng state đó thay vì chỉ DOM count.

Ví dụ:

```text
previous lifecycle version
→ POST success
→ wait lifecycle version > previous
```

Nếu project đã có helper:

```text
waitForRenderedWorkflowTab()
```

hoặc equivalent, tái sử dụng.

Không viết wait logic trùng lặp nếu helper hiện tại đủ đúng.

---

# 1.4 Chờ trạng thái final trước khi mở Result

Sau lot cuối:

Không chuyển sang result chỉ vì POST trả 201.

Phải chờ trạng thái business final.

Ví dụ nếu DOM có semantic state:

```js
await page.waitForFunction(() => {
  const element = document.querySelector("[data-lifecycle-status]");
  return element?.dataset.lifecycleStatus === "AWARDED";
});
```

Hoặc authoritative equivalent.

Chỉ nếu không có semantic state mới dùng text/status badge.

Không hardcode Vietnamese text nếu code có enum/data attribute tốt hơn.

Sau đó mới:

```js
await resultTab.click();
await waitForRenderedWorkflowTab(page, "result");
await page.locator(".award-result-card").waitFor({
  state: "visible",
  timeout: 20_000,
});
```

---

# 1.5 Re-evaluate `force: true, noWaitAfter: true`

Commit mới thêm:

```js
.click({
  force: true,
  noWaitAfter: true,
});
```

Không mặc định giữ workaround này.

Sau khi synchronization đúng:

1. thử dùng click bình thường;
2. chờ button visible;
3. chờ enabled;
4. click;
5. chờ outcome.

Ví dụ:

```js
const continueButton = page.locator("#btn-continue-lot-evaluation");

await continueButton.waitFor({ state: "visible" });

if (!(await continueButton.isEnabled())) {
  throw new Error("Continue lot evaluation button is not enabled");
}

await continueButton.click();
```

Nếu vẫn cần `force`, phải ghi rõ lý do kỹ thuật trong comment và test.

Không dùng `force` để che overlay/race thật.

---

# PHASE 2 — Fix E2E harness quality tests

File:

```text
tests/js/e2e_harness_quality.test.mjs
```

Nếu test hiện assert source string/regex chứa:

```text
force: true
noWaitAfter: true
```

thì đây là test implementation detail quá cứng.

## Yêu cầu

Đổi test để kiểm tra **behavior/invariant**, không khóa workaround cụ thể.

Ví dụ test nên kiểm:

```text
- browser session cũ được đóng
- browser session mới được tạo
- storage state được preserve nếu contract yêu cầu
- restart không leak browser process
- lot workflow helper chờ state transition
```

Không assert một chuỗi source cụ thể nếu không phải security contract.

Source-level architecture tests chỉ giữ cho invariant thật sự cần thiết.

---

# PHASE 3 — Harden browser session management

Commit `59e5c0b` thay đổi browser lifecycle.

Audit các function:

```text
openBrowserSession
renewBrowserSession
restartBrowserSession
close browser/context
```

## Mục tiêu

1. Không leak Chromium process.
2. Không double-launch.
3. Không bỏ mất storage state cần thiết.
4. Cleanup chắc chắn kể cả khi exception.
5. Không che error gốc.

---

# 3.1 Tách primitive rõ ràng

Nếu phù hợp, gom semantic thành:

```js
async function restartBrowserSessionPreservingStorage() {}
async function closeBrowserSession() {}
```

Không có hai function khác tên nhưng làm gần như cùng việc.

---

# 3.2 Cleanup bằng try/finally

Pattern gợi ý:

```js
async function restartBrowserSessionPreservingStorage() {
  const previousContext = context;
  const previousServer = browserServer;

  const storageState = previousContext
    ? await previousContext.storageState({ indexedDB: true })
    : undefined;

  try {
    if (previousContext) {
      await previousContext.close();
    }
  } finally {
    if (previousServer) {
      await previousServer.close().catch(() => {});
    }
  }

  clearBrowserReferences();

  try {
    await openBrowserSession(storageState);
  } catch (error) {
    await closeBrowserSession().catch(() => {});
    throw error;
  }
}
```

Điều chỉnh theo architecture thật.

---

# 3.3 Guard double-open

Nếu `openBrowserSession()` bị gọi khi server/context đang tồn tại:

fail fast hoặc close có chủ đích.

Không silently leak process.

---

# 3.4 Audit storage semantics

Xác minh app có dùng:

```text
cookies
localStorage
IndexedDB
sessionStorage
```

Nếu `sessionStorage` chứa state quan trọng mà `storageState()` không giữ được, phải:

- redesign test;
- hoặc preserve đúng state có chủ đích.

Không serialize dữ liệu nhạy cảm vào log.

---

# PHASE 4 — Fix Python browser analytics test placement

Đây là P0.

Không cài full frontend/Chromium stack vào Python coverage job trừ khi thật sự cần.

## Mục tiêu

Browser journey phải chạy trong job có:

```text
Node version đúng
npm ci
Playwright package
Chromium installed
```

Python coverage job chỉ chạy Python unit/integration test đúng nghĩa.

---

# 4.1 Mark browser E2E test

Trong:

```text
tests/test_product_analytics_e2e.py
```

thêm marker:

```python
@pytest.mark.browser_e2e
```

hoặc marker naming phù hợp convention repo.

Đăng ký marker trong pytest config nếu cần.

---

# 4.2 Exclude browser E2E khỏi Python coverage job

Thay command Python job từ:

```bash
pytest ...
```

thành equivalent:

```bash
pytest -m "not browser_e2e" ...
```

Nhưng phải giữ:

```text
coverage behavior
coverage threshold
critical-module ratchet
```

Không bỏ test khác.

---

# 4.3 Chạy browser analytics test trong E2E job

Trong job đã có:

```text
setup Node
npm ci
Playwright browsers
```

chạy:

```bash
pytest -q -m browser_e2e tests/test_product_analytics_e2e.py
```

hoặc command phù hợp.

Nếu test khởi động backend riêng, đảm bảo port isolation.

Không chạy trùng server nếu E2E harness hiện có đã có server reusable.

---

# 4.4 Node version phải deterministic

Không dùng Node mặc định của runner.

Browser analytics test phải chạy Node version project pin, ví dụ Node 24 nếu CI hiện dùng Node 24.

Không để Python job vô tình gọi:

```text
Node v22.x
```

từ runner.

---

# PHASE 5 — Normalize Playwright dependency

Audit `package.json`.

Nếu hiện có:

```json
"@playwright/test": "...",
"playwright": "..."
```

và fixture browser journey dùng:

```js
import { chromium } from "playwright";
```

hãy grep toàn repo.

Nếu không có lý do cần direct `playwright`, cân nhắc đổi fixture thành:

```js
import { chromium } from "@playwright/test";
```

và chỉ giữ dependency cần thiết.

Chỉ remove dependency nếu:

- full JS tests pass;
- E2E pass;
- scripts khác không phụ thuộc.

Không thay dependency chỉ vì style.

---

# PHASE 6 — Package / legal readiness

Đây không phải lỗi để "fix" bằng code giả.

## Tuyệt đối không

Không:

```text
auto-approve 27 legal facts
fill fake company data
remove legal gate
change missing → approved
delete placeholders blindly
return exit code 0
wrap legal check with || true
```

---

# 6.1 Audit legal facts

Đọc:

```text
docs/legal-fact-sheet.md
scripts/check_legal_readiness.py
```

Liệt kê 27 fact còn thiếu.

Phân loại:

```text
real operational fact required
legal approval required
public placeholder
technical placeholder only
```

---

# 6.2 Nếu main bắt buộc production-ready

Giữ CI như hiện tại.

Không thay gate.

Báo rõ:

```text
Technical code cannot legitimately make this job green
without supplying and approving real legal facts.
```

Nếu repository đã có đúng legal values ở source khác, có thể wire đúng nguồn.

Không invent.

---

# 6.3 Nếu main không bắt buộc legal-ready mỗi commit

Chỉ khi architecture/product policy cho phép:

Tách:

```text
technical package candidate
```

khỏi:

```text
production publish readiness
```

Gợi ý:

```text
Package candidate:
- production package validation
- reproducibility
- SBOM
- dependency audit

Production release:
- legal readiness
- signed/approved facts
- final package publish
```

Nhưng:

```text
release/publish
```

vẫn bắt buộc legal readiness.

Không được tạo đường publish bypass.

---

# PHASE 7 — Audit frontend bundle resolver in `backend/app.py`

Commit mới đã thêm runtime bundle resolver.

Tìm logic kiểu:

```python
def _frontend_bundle_enabled():
    return bool(
        IS_PRODUCTION
        or not APP_DEBUG
        or FRONTEND_ASSET_MODE == "bundle"
        or USE_FRONTEND_BUNDLE
    )
```

## Risk

Có thể đang tồn tại hai nguồn chân lý:

```text
runtime flags
+
import-time USE_FRONTEND_BUNDLE
```

Nếu constant import-time đã True, runtime patch về source mode có thể không có tác dụng.

---

# 7.1 Viết truth-table test trước

Test ít nhất:

```text
Production=true                => bundle
Debug=false                    => expected according to current contract
Debug=true, mode=source        => source
Debug=true, mode=bundle        => bundle
runtime source→bundle change   => correct
runtime bundle→source change   => correct if supported
```

Không đổi behavior hiện tại nếu chưa hiểu contract.

---

# 7.2 Một resolver canonical

Sau khi test rõ behavior:

mọi nơi phải dùng cùng resolver:

```text
compile_html
index response
preload
prewarm
asset selection
```

Không để một nơi dùng import-time constant, nơi khác runtime resolver.

---

# 7.3 Cache invalidation

Nếu HTML output phụ thuộc effective asset mode:

cache key hoặc invalidation phải phản ánh mode.

Không để test/runtime switch mode nhưng trả compiled HTML cũ.

---

# PHASE 8 — Regression tests bắt buộc

## E2E lifecycle

Tạo/điều chỉnh test cho:

```text
lot 1 approved
lot 2 approved
round count/state actually advances
final status no longer partial
result card rendered
```

Chạy nhiều lần để kiểm flake:

```text
at least 5 focused repetitions
```

nếu local/CI time cho phép.

Không dùng retry để che flake.

---

## Browser session

Test:

```text
restart preserves required auth/storage
old process closes
new process opens
no double-open
cleanup after failure
```

---

## Python CI boundary

Test:

```text
Python job does not require npm/playwright
browser_e2e marker excluded from Python coverage
browser_e2e test runs in E2E environment
```

---

## Legal gate

Test:

```text
unapproved facts block production release
technical packaging can be validated independently only if policy allows
no publish path bypasses legal check
```

---

## Frontend bundle resolver

Test truth table.

---

# PHASE 9 — Commands to run

Đầu tiên chạy focused tests.

Ví dụ, điều chỉnh command theo repo thật:

```bash
node scripts/verify_full_lifecycle.mjs
```

hoặc exact targeted E2E command.

```bash
node --test tests/js/e2e_harness_quality.test.mjs
```

Python:

```bash
pytest -q tests/test_product_analytics_e2e.py -m "not browser_e2e"
```

Browser E2E environment:

```bash
pytest -q tests/test_product_analytics_e2e.py -m browser_e2e
```

Static:

```bash
npm run check:static
```

Package technical:

```bash
npm run package:production:check
```

hoặc exact repo command.

Legal:

```bash
npm run check:legal:production
```

Full Python coverage.

Full JS coverage.

Full E2E.

Full CI-equivalent.

---

# PHASE 10 — Performance check

Các fix trên không được làm production runtime chậm.

Sau khi CI functional xanh:

chạy các performance tests hiện có:

```text
startup
first-tab
frontend bundle
API performance
```

Không cần benchmark E2E browser restart như production performance vì đó là test harness-only, nhưng không được làm E2E runtime tăng vô lý.

---

# Không được làm

## E2E

Không:

```text
increase timeout 20s → 60s
waitForTimeout(5000)
force:true everywhere
retry 5 times
skip WebKit
skip Firefox
```

## Python

Không:

```text
pip install node
npm ci inside Python job
install Chromium into Python coverage
```

trừ khi chứng minh architecture thật sự yêu cầu.

## Package

Không:

```text
approve legal facts automatically
remove legal gate
fake placeholders
```

## Coverage

Không:

```text
lower threshold
omit failing module
coverage ignore
```

---

# Definition of Done

Chỉ coi là hoàn thành khi:

- [ ] Lot lifecycle E2E root cause được xác minh
- [ ] Lot 2 wait dùng authoritative state transition
- [ ] `.award-result-card` render ổn định
- [ ] Không tăng timeout tùy tiện
- [ ] `force:true/noWaitAfter:true` được loại hoặc có justification rõ
- [ ] E2E harness quality test không khóa workaround bằng regex vô lý
- [ ] Browser restart không leak process
- [ ] Browser auth/storage state đúng
- [ ] Python coverage job không phụ thuộc Node/Playwright
- [ ] Product analytics browser journey chạy trong đúng E2E environment
- [ ] Node version deterministic
- [ ] Python full coverage pass
- [ ] Package technical validation pass
- [ ] Legal readiness behavior vẫn đúng
- [ ] Không có legal bypass
- [ ] Frontend bundle resolver truth-table tests pass
- [ ] Static/quality pass
- [ ] JS tests pass
- [ ] E2E Chromium pass
- [ ] E2E Firefox pass
- [ ] E2E WebKit pass
- [ ] Full CI pass hoặc chỉ còn legal fact blocker thực tế cần con người phê duyệt
- [ ] Production performance không regression

---

# Báo cáo sau mỗi phase

Format:

```text
Phase:
Root cause confirmed:
Files changed:
Behavior before:
Behavior after:
Tests added:
Tests run:
Performance impact:
Security/compliance impact:
Remaining risk:
```

---

# Báo cáo cuối cùng

Trả về:

## 1. Root causes

| CI gate | Root cause | Fix |
|---|---|---|

## 2. Files changed

Liệt kê từng file và lý do.

## 3. E2E fix

Giải thích:

```text
previous race
new synchronization
why it is deterministic
```

## 4. Python CI fix

Giải thích:

```text
why browser test belonged in E2E
how marker/job split works
```

## 5. Legal gate

Nêu rõ:

```text
code bug?
policy blocker?
remaining human-approved data?
```

## 6. Browser session hardening

- cleanup
- restart semantics
- storage
- leak prevention

## 7. Bundle resolver

- final truth table
- canonical resolver
- cache behavior

## 8. Tests

Liệt kê exact command + result.

## 9. Remaining blockers

Nếu legal facts vẫn thiếu, ghi rõ chúng là blocker hợp lệ và **không giả vờ task đã hoàn tất hoàn toàn**.

---

# Thứ tự thực hiện

Thực hiện theo đúng thứ tự:

```text
1. Reproduce E2E race
2. Fix synchronization
3. Harden browser-session lifecycle
4. Fix quality tests
5. Move browser analytics test to correct CI job
6. Normalize Playwright dependency if safe
7. Audit legal gate without bypass
8. Audit backend bundle resolver
9. Run focused tests
10. Run full CI
11. Run performance regression checks
```

Ưu tiên:

```text
correctness
> determinism
> security/compliance
> compatibility
> performance
> maintainability
> code brevity
```

Bắt đầu bằng audit và reproduction. Không sửa hàng loạt trước khi xác minh root cause.
