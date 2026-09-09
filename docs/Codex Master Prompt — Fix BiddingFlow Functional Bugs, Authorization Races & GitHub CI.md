Bạn đang làm việc trực tiếp trên repository:

https://github.com/newstar94/Bidding

Hãy xử lý task này như một Staff/Senior Software Engineer chịu trách nhiệm đồng thời:

- authorization;
- PostgreSQL transaction correctness;
- offline-first synchronization;
- frontend UX state;
- version lineage;
- CI/CD;
- Playwright E2E;
- security/release engineering.

KHÔNG chỉ phân tích.

Bạn phải:

1. lấy code mới nhất;
2. reproduce lỗi;
3. viết regression test;
4. sửa code;
5. chạy CI-equivalent locally;
6. review diff của chính mình;
7. tiếp tục sửa cho tới khi các lỗi phần mềm được giải quyết và các CI gate hợp lệ xanh.

---

# 0. SOURCE OF TRUTH — LUÔN DÙNG CODE MỚI NHẤT

Tại thời điểm prompt này được viết, `main` được quan sát ở:

```text
1e06300eb3bb8508b770326e37e55f9d31278dcf
```

NHƯNG không được mặc định đây vẫn là HEAD.

Trước khi làm:

```bash
git status
git branch --show-current
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
git log --oneline -10
```

Nếu checkout cũ hơn `origin/main`:

- cập nhật theo workflow an toàn;
- không overwrite local changes;
- không discard uncommitted work của người khác.

Ghi SHA thực tế vào báo cáo cuối.

---

# 1. ĐỌC CONTRACT TRƯỚC KHI SỬA

Đọc ít nhất:

```text
AGENTS.md
CONTEXT.md

docs/adr/0038-specialist-create-new-business-records.md
docs/adr/0040-contractor-creator-edit.md

.github/workflows/ci.yml
.github/workflows/n-plus-one-regressions.yml
.github/workflows/security.yml
.github/workflows/codeql.yml

package.json
pyproject.toml
```

Sau đó đọc implementation liên quan.

Không sửa authorization dựa trên suy đoán.

---

# 2. PRODUCT POLICY HIỆN TẠI PHẢI ĐƯỢC GIỮ

Code/ADR mới đã cố ý quy định:

```text
Specialist + module view
    -> có thể CREATE logical-new record

Specialist + module edit
    -> có thể edit record hiện có nếu scope/assignment hợp lệ
```

Đừng tự đổi:

```text
view -> read only
```

trừ khi repository mới nhất đã có ADR/test mới thay thế policy này.

Đặc biệt giữ semantics hiện tại của ADR 0038.

---

# 3. CONTRACTOR STAMP — KHÔNG REGRESS

Code mới đã sửa quyền ảnh dấu Nhà thầu.

Giữ invariant:

```text
Specialist được phép tạo Nhà thầu mới với ảnh dấu
```

và behavior creator hiện tại theo ADR 0040 nếu repository HEAD vẫn giữ rule đó.

KHÔNG mở rộng generic workspace asset permission làm specialist được upload:

```text
chuyen_gia.anh_chu_ky
chuyen_gia.anh_chung_chi
```

nếu policy hiện tại vẫn manager-only.

Test:

```text
specialist create contractor without stamp -> success
specialist create contractor with stamp    -> success

specialist unauthorized expert signature   -> denied
specialist unauthorized certificate        -> denied
```

Managed image pipeline vẫn phải giữ:

- MIME validation;
- decode;
- safe re-encode;
- managed path;
- organization scope;
- rollback cleanup.

---

# 4. P1 SECURITY — ASSIGNMENT TRANSFER QUA VERSION LINEAGE

Đây là vấn đề ưu tiên cao nhất.

Inspect:

```text
backend/shared/access_policy.py

backend/versioning/
backend/versioning/aggregate_snapshot.py
backend/versioning/command.py

frontend/shared/MultiAssigneeSelect.js

backend/sync/visibility_scope.py
backend/sync/read_service.py
backend/sync/delta_paging.py
backend/sync/visibility_epoch.py
```

## Vấn đề cần xác minh

Authorization hiện có logic lineage-wide tương đương:

```text
chỉ cần specialist được assign vào một snapshot
trong cùng lineage
→ có thể được coi là assigned cho lineage
```

Trong khi versioning có thể clone assignment:

```text
V00 assignment A
↓ create version
V01 assignment A
```

và manager transfer trên UI hiện có khả năng chỉ update assignment của exact current record:

```text
V01: A -> B
```

nhưng vẫn để:

```text
V00: A
V01: B
```

Nếu access policy hỏi:

```text
A có assignment ở bất kỳ snapshot nào trong lineage?
```

thì A có thể vẫn giữ grant.

Đây là security bug nếu reproduce được.

---

# 5. EXPECTED TRANSFER SEMANTICS

Manager transfer logical entity:

```text
Employee A -> Employee B
```

thì A phải mất active authorization grant của entity đó, trừ khi A có một grant độc lập hợp lệ khác.

Áp dụng:

```text
ke_hoach_lcnt
goi_thau
hop_dong
```

và các child record phụ thuộc package.

Sau transfer:

```text
A direct read       -> denied
A pagination        -> không thấy
A delta projection  -> không thấy
A write             -> denied

B direct read       -> allowed nếu module permission phù hợp
B write             -> allowed nếu module permission phù hợp
```

## Historical snapshots

Không nhất thiết phải xóa historical assignment evidence nếu dữ liệu đó có giá trị audit.

Nhưng:

> Historical assignment evidence không được tự động trở thành active authorization grant sau transfer.

Nếu cần, tách khái niệm:

```text
historical responsibility
```

khỏi:

```text
effective current authorization assignment
```

Ưu tiên không migration nếu có thể làm đúng bằng resolver/query hiện tại.

Nhưng correctness/security quan trọng hơn việc né migration.

---

# 6. ALIGN READ VÀ WRITE AUTHORIZATION

Kiểm tra sự khác biệt giữa:

```text
access_policy lineage authorization
```

và:

```text
visibility_scope exact-record filtering
```

Không chấp nhận trạng thái:

```text
user không nhìn thấy record trong projection
nhưng vẫn được write thông qua lineage grant
```

hoặc ngược lại nếu không có product rule rõ ràng.

Tạo một authoritative helper/resolver cho:

```text
effective assignment grant
```

và dùng semantics nhất quán ở:

- record read;
- pagination;
- delta sync;
- write authorization;
- child package authorization;
- historical/version access.

Không duplicate business rule bằng nhiều SQL hơi khác nhau.

---

# 7. REQUIRED VERSION TEST

Tạo PostgreSQL regression test:

```text
Package V00
assignment A
```

Sau đó tạo:

```text
Package V01
```

và xác nhận assignment inheritance hiện hành.

Manager transfer latest logical package:

```text
A -> B
```

Sau đó assert:

```text
A cannot read V01
A cannot modify V01
A cannot modify child records
A cannot exploit V00 assignment to gain V01 lineage write
B receives proper access
```

Lặp lại tương đương cho:

```text
Plan
Contract
```

Nếu historical version read có policy riêng, test rõ policy đó.

---

# 8. P1 RACE CONDITION — TRANSFER VS SAVE

Regular `/api/sync` phải được review ở:

```text
backend/sync/service.py
backend/sync/record_validator.py
backend/shared/access_policy.py
```

Kiểm tra interleaving:

```text
T1 Employee A
    BEGIN
    authorize because A assigned

T2 Manager
    transfer A -> B
    COMMIT

T1
    write using stale authorization context
    COMMIT
```

Nếu mutation của A vẫn commit sau khi quyền đã bị revoke thì đây là TOCTOU authorization bug.

---

# 9. PHẢI VIẾT REAL CONCURRENCY TEST

Không test tuần tự giả lập.

Dùng PostgreSQL thật với ít nhất 2 connections/transactions.

Synchronize test bằng barrier/event/database locking, không dựa vào arbitrary:

```text
sleep(1)
```

Test phải chứng minh một thứ tự commit cụ thể.

Invariant:

> Sau khi transfer/revocation trở thành effective, transaction của old assignee không được commit mutation dựa trên authorization stale.

---

# 10. FIX CONCURRENCY ĐÚNG TRANSACTION BOUNDARY

Không mặc định giải pháp.

Inspect transaction model hiện tại và chọn mechanism phù hợp:

- row locks;
- lineage/root lock;
- assignment locks;
- transaction advisory lock;
- authorization revalidation;
- stronger isolation;
- hoặc combination hợp lý.

Nếu dùng locking:

- cả transfer path và specialist mutation phải tham gia cùng lock discipline;
- deterministic lock ordering;
- tránh deadlock;
- lock scope nhỏ nhất hợp lý;
- organization phải nằm trong lock key/scope.

Không chuyển toàn bộ application sang SERIALIZABLE một cách mù quáng.

---

# 11. P1 UX — LOCAL DURABLE KHÔNG PHẢI SERVER SUCCESS

Inspect:

```text
frontend/shared/MutationService.js
frontend/app/SyncPushService.js
frontend/app/SyncPullService.js
frontend/app/SyncCoordinator.js
```

Hiện `backgroundSync:true` có thể:

```text
IndexedDB durable
↓
outbox durable
↓
afterLocalDurable()
↓
start remote sync
↓
return {
    ok: true,
    local: true,
    queued: true,
    syncPromise
}
```

`ok:true` ở đây KHÔNG đồng nghĩa canonical server commit.

Audit toàn repo:

```text
backgroundSync: true
afterLocalDurable
afterPersist
afterCanonicalSync
showToast(... success ...)
closeModal(...)
```

---

# 12. DEFINE SAVE STATE SEMANTICS

Phải phân biệt:

```text
LOCAL_DURABLE
REMOTE_PENDING
CANONICAL_COMMITTED
CANONICAL_REJECTED
CONFLICT
OFFLINE_PENDING
```

Final green success:

```text
“Đã lưu ...”
```

chỉ xuất hiện sau:

```text
CANONICAL_COMMITTED
```

Nếu local durable nhưng remote chưa xác nhận:

có thể hiển thị neutral pending UI:

```text
“Đã lưu trên thiết bị · đang chờ đồng bộ”
```

Không được:

```text
green success
↓
server reject
↓
red error
```

Không nhất thiết phải giữ modal mở khi offline nếu UX hiện tại không yêu cầu.

Nhưng label/state phải trung thực.

---

# 13. KHÔNG BREAK OFFLINE-FIRST

Không giải quyết bằng:

```text
backgroundSync = false cho mọi thứ
```

hoặc bắt app luôn phải online.

Giữ:

- durable mutation outbox;
- IndexedDB;
- idempotency;
- reconnect;
- conflict quarantine;
- row-version conflict;
- delta sync;
- visibility reset;
- full sync fallback.

Có thể thêm API/helper kiểu:

```text
awaitCanonicalSyncResult()
```

hoặc explicit:

```text
canonicalStatus
pending
syncPromise
```

nhưng phải audit tất cả caller trước khi thay semantics global.

---

# 14. GHOST OPTIMISTIC CONTRACTOR

Trace:

```text
NhaThauWorkflow.handleNhaThauSubmit
persistContractorFormChanges
HopDongWorkflow
contractor selector
```

Scenario:

```text
create contractor locally
↓
local durable
↓
contract modal selects contractor
↓
server rejects contractor
```

Không được để contract tiếp tục tham chiếu contractor chưa canonical.

Online:

- dependent canonical reference phải chờ server acceptance.

Offline:

nếu app cho phép relationship pending thì:

- đánh dấu pending;
- giữ dependency trong outbox đúng thứ tự;
- rollback dependency nếu parent bị rejected;
- không giả vờ record đã canonical.

---

# 15. FRONTEND DEFAULT SELF-ASSIGNMENT

Backend đã có server-authoritative default assignment.

Frontend vẫn phải mirror đúng cho offline UX.

Inspect:

```text
frontend/packages/packageAssignmentPolicy.js
frontend/packages/GoiThauWorkflow.js

frontend/contracts/HopDongWorkflow.js

frontend/plans/
```

Specialist tạo new package/contract/plan:

```text
selected assignee = current specialist
control disabled khỏi reassignment tùy policy
```

Không để UI:

```text
[]
+ disabled
```

Backend vẫn phải tự gán dù malicious/custom client bỏ assignment.

---

# 16. ANTI SELF-CLAIM

Inspect:

```text
backend/sync/assignment_augmentation.py
```

Test trường hợp:

```text
existing lineage root = ROOT
physical root row missing/archived/deleted theo lifecycle nào đó
descendant V01 vẫn id_goc = ROOT

specialist gửi:
new record
rootId = ROOT
```

Không được coi đây là genuinely-new lineage rồi auto-assign specialist.

Nếu root row bất biến và không thể biến mất:

- chứng minh bằng DB/domain invariant;
- thêm test.

Nếu invariant không tồn tại:

- sửa lineage existence lookup;
- kiểm tra cả `id` và `id_goc`.

---

# 17. ERROR CLASSIFICATION

Inspect:

```text
frontend/app/SyncPushService.js
```

Ưu tiên phân loại bằng stable:

```text
error.code
```

trước message text.

Ít nhất:

```text
required
format
business_logic
duplicate
authorization
conflict
not_found
system
```

Các code như:

```text
RECORD_ACCESS_DENIED
ORG_ACCESS_DENIED
ORG_ASSET_UPLOAD_MANAGER_REQUIRED
ORG_ASSET_MUTATION_MANAGER_REQUIRED
```

không được hiển thị dưới:

```text
SAI ĐỊNH DẠNG
```

Giữ text fallback cho legacy errors.

---

# 18. REJECTED INSERT + `/api/record` 404

Trace:

```text
applyFailedPush
restoreRejectedRecords
fetchRecordByLookup
```

Nếu rejected mutation là optimistic INSERT chưa từng tồn tại canonical:

```text
GET /api/record -> 404
```

là expected.

Nếu mutation metadata đủ chứng minh record là new insert:

- xóa/rollback optimistic local record;
- không fetch server vô ích.

Đối với rejected UPDATE:

- vẫn fetch canonical record khi cần.

Không suppress tất cả 404.

---

# 19. CI BASELINE — REPRODUCE TRƯỚC KHI SỬA

GitHub Full CI gần nhất quan sát được đang fail ba nhóm:

```text
Quality and static contracts
Package and dependency gates
Cross-browser and workflow E2E
```

Trước khi sửa functional code, reproduce từng cái.

Dùng đúng Python/Node version từ workflow:

```text
Python 3.14
Node 24
PostgreSQL version theo ci.yml
```

Install dependency đúng CI:

```bash
python -m pip install --disable-pip-version-check \
  --require-hashes -r requirements-test.txt

python -m pip install \
  --disable-pip-version-check \
  --no-build-isolation \
  --no-deps -e .

npm ci
```

Không dùng dependency mới hơn tùy tiện.

---

# 20. CI — QUALITY AND STATIC CONTRACTS

GitHub step:

```bash
npm run check:static
```

`package.json` hiện expand thành các check kiểu:

```text
python compileall
schema-runtime check
PostgreSQL migration fixture check
Python quality
encoding/mojibake
frontend modules
dead-code reachability
frontend debt
Playwright discovery
```

Chạy:

```bash
npm run check:static
```

Nếu fail, xác định SUBCOMMAND ĐẦU TIÊN thực sự fail.

Sau đó chạy riêng subcommand đó.

Không:

- tăng debt budget chỉ để pass;
- add arbitrary allowlist;
- delete quality test;
- dùng `|| true`;
- dùng `continue-on-error`;
- bỏ file khỏi scan vô căn cứ.

Fix root cause.

Sau fix chạy lại toàn bộ:

```bash
npm run check:static
```

---

# 21. CI — PLAYWRIGHT CROSS-BROWSER

GitHub đang fail ở:

```text
Cross-browser Playwright matrix
```

với:

```bash
npm run check:e2e-discovery
npm run test:e2e:smoke
```

Full role/workflow suite nằm SAU bước này.

Reproduce môi trường CI:

- fresh PostgreSQL schemas;
- isolated app;
- secure build artifact theo workflow;
- Chromium;
- Firefox;
- WebKit;
- CI env variables tương đương.

Chạy:

```bash
npm run check:e2e-discovery
npm run test:e2e:smoke
```

Nếu smoke fail:

- xác định browser;
- xác định exact test;
- đọc Playwright trace;
- screenshot;
- video nếu có;
- console;
- network;
- server log;
- `test-results/e2e-results.json`;
- `playwright-report`.

Không chỉ rerun đến khi xanh.

---

# 22. KHÔNG “FIX” E2E BẰNG FLAKINESS MASKING

Không được mặc định:

- tăng timeout hàng loạt;
- tăng retries;
- bỏ Firefox;
- bỏ WebKit;
- skip test;
- `test.fixme`;
- remove assertion;
- hard-code delay;
- `waitForTimeout(5000)`.

Chỉ thay timeout/retry nếu có evidence test budget thật sự sai.

Ưu tiên deterministic readiness/state assertions.

---

# 23. SAU SMOKE — CHẠY FULL WORKFLOW E2E

Khi smoke xanh, chạy đúng các command CI:

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

và product analytics browser journey nếu workflow hiện tại còn chạy nó.

---

# 24. THÊM E2E CHO BUG NÀY

Nếu architecture của test suite phù hợp, thêm coverage browser cho ít nhất:

## Specialist create

```text
specialist creates plan
specialist creates package
specialist creates contract
specialist creates contractor + stamp
```

## Assignment

```text
new package shows current specialist assigned
new contract shows current specialist assigned
```

## Transfer

```text
Manager A -> B
old specialist loses entity
new specialist receives entity
```

## Toast semantics

Simulate server rejection:

```text
no green final success before reject
only appropriate error/pending state
```

Không nhất thiết nhồi toàn bộ vào một Playwright test lớn.

---

# 25. CI — PACKAGE AND DEPENDENCY GATES

GitHub flow hiện tại:

```bash
python scripts/package_production.py --check
npm run sbom
npm run audit:dependencies
npm run package:production:from-build
```

Failure quan sát được nằm ở:

```text
Build reproducible production archive candidate
```

tức command:

```bash
npm run package:production:from-build
```

Inspect exact stderr locally.

---

# 26. LEGAL READINESS LÀ GOVERNANCE GATE — KHÔNG ĐƯỢC BỊA

`package:production:from-build` hiện gọi:

```bash
npm run check:legal:production
```

trước package.

`docs/legal-fact-sheet.md` hiện có các item:

```text
LEGAL-01 ... LEGAL-27
```

đang `missing`.

KHÔNG được:

```text
missing -> approved
```

chỉ để GitHub Actions xanh.

Không tự bịa:

- pháp nhân;
- địa chỉ;
- email;
- TLS guarantees;
- backup promises;
- luật áp dụng;
- data retention;
- incident SLA;
- nhà cung cấp;
- compliance statement.

Chỉ approve khi có evidence theo chính contract của repository.

---

# 27. TÁCH “CI CORRECTNESS” VÀ “PRODUCTION RELEASE READINESS” NẾU PHÙ HỢP

Kiểm tra ý định workflow/documentation hiện hành.

Hiện một Full CI chạy trên mỗi push có thể bị đỏ vĩnh viễn chỉ vì production legal facts chưa được doanh nghiệp cung cấp.

Nếu đây KHÔNG phải chủ đích governance, refactor CI như sau:

## Code/package verification

Main CI phải kiểm được:

```text
source correctness
tests
secure build
package structure
reproducibility
SBOM
dependency audit
```

mà không cần bịa legal facts.

## Production release readiness

Tách thành explicit gate/workflow/job:

```text
legal production readiness
```

và:

```text
Publish verified production artifact
```

PHẢI depend vào gate đó.

Production artifact tuyệt đối không publish khi:

```text
check:legal:production
```

fail.

Có thể:

- separate release workflow;
- tag/release-triggered gate;
- workflow_dispatch production release;
- dedicated release-readiness job.

Chọn cách phù hợp architecture hiện có.

---

# 28. KHÔNG ĐƯỢC LÀM CI “XANH GIẢ”

Cấm:

```yaml
continue-on-error: true
```

để che lỗi.

Cấm:

```bash
command || true
```

để che lỗi.

Cấm disable:

```text
legal production gate
CodeQL
dependency audit
gitleaks
critical coverage
Firefox/WebKit
N+1 regression
```

Cấm giảm:

```text
coverage threshold
security severity
quality threshold
```

chỉ để pass.

Nếu legal readiness chưa thể pass:

- production release phải BLOCK;
- ordinary engineering CI có thể xanh nếu workflow được phân tách đúng semantics.

---

# 29. N+1 REGRESSION — PHẢI GIỮ XANH

Repository có workflow riêng:

```text
N+1 query regressions
```

Sau authorization/assignment refactor phải chạy:

```bash
python -m pytest -q tests/test_n_plus_one_regressions.py
```

Đặc biệt khi sửa:

```text
lineage assignment
visibility filtering
```

không được biến:

```text
1 batched query
```

thành:

```text
N queries / N records
```

Nếu cần resolver mới:

- batch IDs;
- preload assignments;
- avoid per-row DB call.

---

# 30. PYTHON COVERAGE GATE

Run exact equivalent từ current workflow, hiện gần dạng:

```bash
python -m pytest -q -m "not browser_e2e" \
  --cov=backend \
  --cov-branch \
  --cov-report=term \
  --cov-report=json:coverage.json \
  --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json
```

Không chỉ đảm bảo global 45%.

Critical authorization/concurrency changes phải có targeted regression coverage.

---

# 31. JAVASCRIPT COVERAGE

Run:

```bash
npm run test:js:coverage
```

Nếu thêm helper/state machine cho canonical sync:

- thêm focused JS unit tests;
- không để coverage critical module giảm.

---

# 32. SECURE BUILD

Run:

```bash
npm run build:secure
```

Không break:

- Trusted Types;
- CSP-related assumptions;
- vendor audit;
- bootstrap assets;
- secure build artifact verification;
- route CSS checks.

---

# 33. SUPPLY-CHAIN SECURITY

Đọc current security workflow.

Giữ:

- npm audit;
- production dependency audit;
- pip-audit;
- secret scanning;
- dependency-review policy.

Nếu functional fix yêu cầu dependency mới:

- phải chứng minh cần thiết;
- update lockfile;
- update hashes;
- SBOM;
- security audit.

Ưu tiên không thêm dependency cho các fix này.

---

# 34. CODEQL

Không viết workaround chỉ để CodeQL im lặng.

Nếu security/refactor code tạo warning:

- sửa data flow;
- validate inputs;
- parameterize SQL;
- sanitize filesystem/data boundary đúng cách.

Không suppress CodeQL alert nếu chưa chứng minh false positive.

---

# 35. DATABASE / FK AUDIT

Assignment/version changes phải giữ PostgreSQL schema integrity.

Chạy các DB checks đúng current `ci.yml`.

Nếu không cần schema change:

- tuyệt đối không tạo migration vô ích.

Nếu thật sự cần schema change:

- append immutable migration theo repo convention;
- regenerate/check migration fixture;
- FK indexes;
- schema runtime;
- fresh DB;
- upgraded DB.

---

# 36. AUTHORIZATION TEST MATRIX

Actors:

```text
Manager
Specialist A
Specialist B
Specialist không assignment
```

Permissions:

```text
module none
module view
module edit
```

Entities:

```text
Plan
Package
Contract
Contractor
Package child records
```

Test:

```text
create
read
edit
version
assign
transfer
direct API
pagination
delta
```

---

# 37. REQUIRED CREATE SEMANTICS

Preserve ADR 0038:

Specialist với đủ điều kiện hiện hành cho create phải tạo được logical-new:

```text
Plan
Package
Contract
```

Server phải tự tạo assignment.

Không tin client assignment.

Specialist không được self-claim:

```text
existing record
existing lineage
another user's lineage
another organization
```

---

# 38. REQUIRED TRANSFER SEMANTICS

Scenario:

```text
A owns/assigned logical entity
Manager transfers A -> B
```

Sau canonical transfer:

```text
A loses active grant
B gains active grant
```

Nếu A có independent valid grant từ child/package relationship:

chỉ grant đó được giữ.

Đừng blanket-ban A nếu domain policy khác vẫn cho access.

---

# 39. CLIENT VISIBILITY AFTER TRANSFER

Old specialist có thể đang cache:

```text
IndexedDB
in-memory collection
paginated list
selected version
open modal
```

Sau visibility change:

- sync/visibility epoch phải invalidate scope;
- inaccessible records bị purge;
- children bị purge;
- stale selection/modal không được leak content;
- direct fetch bị deny;
- polling fallback vẫn converge nếu WebSocket mất.

WebSocket chỉ là hint.

Không biến WebSocket thành source of truth.

---

# 40. OFFLINE SYNC INVARIANTS

Không phá:

1. local mutation durability;
2. mutation outbox;
3. idempotency;
4. row-version conflict;
5. conflict quarantine;
6. full-sync-required;
7. visibility-reset-required;
8. delta cursor;
9. polling fallback;
10. organization/workspace isolation;
11. rejected mutation rollback.

---

# 41. CI HISTORY — PHÂN BIỆT LEGACY DEBT VÀ REGRESSION

Đọc vài Full CI runs trước HEAD.

Nếu failure đã tồn tại nhiều commit:

label:

```text
pre-existing CI debt
```

Nếu chỉ xuất hiện sau patch mới:

label:

```text
regression
```

Không dùng “pre-existing” làm lý do bỏ qua.

Nhưng phải ghi rõ để reviewer biết nguồn gốc.

---

# 42. DÙNG DIAGNOSTIC ARTIFACTS

CI đang upload artifacts như:

```text
quality diagnostics
E2E diagnostics
package diagnostics
Python test diagnostics
JavaScript diagnostics
secure build
```

Nếu môi trường Codex/GitHub cho phép download artifact:

ưu tiên đọc chúng.

Nếu không:

reproduce local bằng exact commands.

Không đoán error dựa trên tên job.

---

# 43. QUALITY FIX TRƯỚC MASS REFACTOR

`access_policy.py` đã được refactor một phần ở recent commits.

Các technical debt cũ như duplicate helper/path check có thể đã được sửa.

Không re-apply prompt cũ một cách máy móc.

Trước mọi cleanup:

```text
check current code
check current tests
check current diff
```

Functional/security fixes trước.

Refactor lớn sau.

---

# 44. WORK ORDER

Thực hiện theo thứ tự:

## Phase A — Baseline

```text
HEAD SHA
git status
CI workflow commands
baseline tests
baseline failures
```

## Phase B — Reproduce 3 failing Full CI jobs

```text
check:static
E2E smoke
package production candidate
```

Không sửa trước khi biết local failure.

## Phase C — Authorization lineage transfer

- reproduce;
- add regression tests;
- fix;
- direct-read/write tests.

## Phase D — Concurrency race

- real PostgreSQL two-transaction test;
- fix lock/revalidation;
- rerun.

## Phase E — Canonical save UX

- introduce accurate save-state semantics;
- fix toast;
- fix modal/dependent workflow;
- ghost contractor.

## Phase F — Frontend self-assignment projection

- package;
- contract;
- plan if needed.

## Phase G — Error/rollback cleanup

- access error categories;
- rejected INSERT 404.

## Phase H — CI quality failure

Fix actual first failing static check.

## Phase I — E2E failure

Fix cross-browser smoke and run workflow suites.

## Phase J — CI package/release semantics

Resolve code/package bugs.

Handle legal readiness honestly.

Split release gate if appropriate.

## Phase K — Full regression

Run widest feasible CI-equivalent suite.

---

# 45. PATCH GROUPS

Ưu tiên reviewable patches:

```text
A. regression tests for lineage transfer
B. active assignment semantics
C. concurrent revocation protection
D. canonical sync state contract
E. workflow UX/toast fixes
F. frontend default self-assignment
G. sync error/rollback handling
H. static-quality CI fixes
I. Playwright E2E fixes
J. CI/release legal-gate separation if justified
```

Không làm một commit/refactor khổng lồ.

---

# 46. KHÔNG SỬA TEST ĐỂ HỢP VỚI BUG

Khi test fail sau behavioral change:

trước tiên hỏi:

```text
test outdated?
hay implementation sai?
```

Không đổi expected result nếu product contract không thay.

Đặc biệt:

- authorization deny tests;
- tenant isolation;
- immutable history;
- protected media;
- conflict tests.

---

# 47. DEFINITION OF DONE — FUNCTIONAL

Không hoàn thành nếu chưa chứng minh:

- specialist create flow hoạt động;
- contractor + stamp hoạt động;
- protected expert media không bị broaden;
- new Plan self-assigned;
- new Package self-assigned;
- new Contract self-assigned;
- frontend phản ánh self-assignment;
- no existing-lineage self-claim;
- Manager transfer A→B hoạt động;
- A không giữ active grant qua old version;
- B nhận quyền;
- transfer-vs-save race được bảo vệ;
- old client projection bị revoke;
- final success toast chỉ sau canonical commit;
- server reject không tạo success+error UX;
- ghost contractor không còn;
- access errors được classify đúng;
- rejected optimistic INSERT rollback sạch.

---

# 48. DEFINITION OF DONE — CI

Mục tiêu:

```text
npm run check:static
```

PASS.

Python unit/integration + critical coverage:

PASS.

```text
npm run test:js:coverage
```

PASS.

```text
npm run build:secure
```

PASS.

PostgreSQL schema/FK audit:

PASS.

Playwright discovery + cross-browser smoke:

PASS.

Full role/workflow E2E:

PASS.

Startup performance gate:

PASS.

N+1 regression:

PASS.

Dependency/SBOM/security checks:

PASS.

CodeQL-compatible changes:

PASS.

Package structural/reproducibility checks:

PASS.

---

# 49. LEGAL GATE EXCEPTION

Nếu production legal facts vẫn thiếu bằng chứng hợp lệ:

KHÔNG được ghi:

```text
Production release ready
```

KHÔNG được mark fake approved.

Correct final state phải là một trong hai:

### Option A — project policy muốn main đỏ cho tới khi legal đầy đủ

Giữ gate fail và báo:

```text
CI software checks pass;
production legal readiness remains intentionally blocked by missing approved facts.
```

### Option B — project policy muốn engineering Full CI xanh

Tách:

```text
engineering CI
```

khỏi:

```text
production-public release readiness
```

và đảm bảo production publication không thể chạy nếu legal gate chưa pass.

Ưu tiên Option B nếu architecture/documentation cho thấy legal facts là external business input chứ không phải software defect.

Không dùng `continue-on-error`.

---

# 50. FINAL SELF-REVIEW

Trước khi trả lời:

```bash
git status
git diff --check
git diff --stat
git diff
```

Review từng thay đổi bằng câu hỏi:

### Authorization

Có thể specialist lợi dụng patch để:

```text
claim existing lineage?
claim another user record?
claim another organization?
retain access after transfer?
```

### Concurrency

Có interleaving nào vẫn dùng stale authorization?

### Offline

Có mutation nào bị mất?

### UX

Có local durable nào vẫn bị gọi là final success?

### CI

Có check nào bị làm yếu thay vì fix?

### Legal

Có bất kỳ fact nào bị invent/approve không có evidence?

Nếu có, chưa được coi là done.

---

# 51. FINAL REPORT FORMAT

Trả về đúng các phần:

## Baseline

```text
HEAD:
origin/main:
Git status:
CI baseline:
```

## Architecture/Call Flow

Tối thiểu:

```text
frontend
→ MutationService
→ SyncPushService
→ POST /api/sync
→ sync service
→ assignment augmentation
→ validator
→ access policy
→ writer
→ PostgreSQL
→ delta/WebSocket
```

## Root Causes

Mỗi lỗi:

```text
symptom
root cause
file
symbol/function
security/business impact
```

## Changes Made

Mỗi patch:

```text
file
old behavior
new behavior
reason
```

## Authorization Matrix

Cho:

```text
Manager
Specialist A
Specialist B
view-only specialist
unassigned specialist
old assignee after transfer
```

## Concurrency

Ghi:

```text
race reproduced?
interleaving:
fix:
lock/revalidation:
test:
```

## Sync State Contract

Ghi chính xác semantics:

```text
local durable
remote pending
canonical committed
canonical rejected
conflict
offline
```

## CI Before / After

Bảng:

```text
Check
Before
After
Command
Root cause
```

Ít nhất:

```text
Quality/static
Python tests
JS tests
Secure build
DB audit
Playwright smoke
Full workflow E2E
Performance
N+1
Package
Dependency audit
Legal readiness
```

## Commands Actually Run

Không paraphrase.

Liệt kê exact command và exit result.

## Legal Release Status

Một trong:

```text
READY — approved evidence exists
```

hoặc:

```text
BLOCKED — external legal facts missing
```

Không invent.

## Remaining Risks

Liệt kê phần chưa verify.

## Diff Review Notes

5–10 khu vực reviewer nên đọc kỹ nhất.

## Recommended Next Steps

Tối đa 5 mục, P0 → P2.

---

# 52. ABSOLUTE RULES

Không được:

- rewrite framework;
- migrate sang React/Vue;
- thay Starlette;
- rewrite toàn SQL layer;
- bỏ offline mode;
- nới authorization để test pass;
- giảm coverage;
- skip browser;
- disable CodeQL;
- disable dependency audit;
- disable N+1 gate;
- fake legal facts;
- `continue-on-error` để che failure;
- `|| true` để che failure;
- claim CI xanh khi chưa chạy.

Ưu tiên:

```text
correctness
> authorization safety
> transaction safety
> data integrity
> truthful UX
> maintainability
> convenience
```

Với mọi authorization fix, trước khi hoàn tất hãy tự trả lời:

> “Một specialist độc hại có thể dùng thay đổi này để chiếm existing lineage, giữ quyền sau transfer, truy cập tenant khác, hoặc mutate protected asset ngoài phạm vi nghiệp vụ hay không?”

Nếu câu trả lời chưa chắc chắn là “không”, tiếp tục sửa và test.