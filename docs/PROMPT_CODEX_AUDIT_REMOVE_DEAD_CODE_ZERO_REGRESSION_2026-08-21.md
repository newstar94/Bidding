# PROMPT CODEX — AUDIT & REMOVE DEAD CODE / CODE RÁC
## ZERO-REGRESSION MODE — KHÔNG ĐƯỢC LÀM PHÁT SINH BUG MỚI

Repository:

```text
https://github.com/newstar94/Bidding
```

Mốc audit gần nhất trước khi tạo prompt:

```text
ffd57fcd1f02709d501eebc032f316a0b69070a7
```

---

# 0. MỤC TIÊU

Audit toàn bộ repository để tìm:

```text
dead code
unused exports
unused functions/classes
orphan modules
obsolete compatibility paths
duplicate logic
test-only runtime exports
unnecessary controller prototype commands
outdated wrappers
legacy code paths đã bị thay thế
unused scripts/config/dependencies
```

Sau đó:

```text
CHỈ XÓA / REFACTOR NHỮNG GÌ ĐÃ ĐƯỢC CHỨNG MINH AN TOÀN.
```

Mục tiêu quan trọng nhất:

```text
KHÔNG ĐỂ VIỆC DỌN CODE LÀM PHÁT SINH BUG MỚI,
KHÔNG THAY ĐỔI BUSINESS LOGIC,
KHÔNG LÀM MẤT TÍNH NĂNG,
KHÔNG THAY ĐỔI DATA SEMANTICS,
KHÔNG LÀM HỎNG WORKSPACE / VERSIONING / SYNC / RBAC / IMPORT.
```

---

# 1. NGUYÊN TẮC AN TOÀN TUYỆT ĐỐI

Đây là cleanup task, KHÔNG phải feature/refactor task.

Quy tắc mặc định:

```text
IF IN DOUBT → KEEP THE CODE.
```

Không được xóa code chỉ vì:

```text
grep không thấy caller
IDE báo unused
không có static import
không thấy test gọi
tên file có vẻ legacy
function chưa thấy runtime caller
```

Repository có:
- dynamic import;
- lazy route/module loading;
- prototype installation;
- HTML-driven actions;
- module registry;
- reflection-like `Object.entries(module)`;
- runtime command dispatch;
- E2E-only paths;
- background sync paths.

Vì vậy dead-code detection phải có bằng chứng nhiều lớp.

---

# 2. FETCH HEAD THỰC TẾ

Bắt buộc:

```bash
git checkout main
git fetch --all --prune
git pull --ff-only
git rev-parse HEAD
git log -1 --oneline
```

Ghi:

```text
START_HEAD=
```

Không giả định `ffd57fcd...` vẫn là HEAD.

Nếu HEAD mới hơn:

```bash
git diff ffd57fcd1f02709d501eebc032f316a0b69070a7..HEAD -- \
  frontend backend scripts tests package.json vite.config.js
```

Audit changes mới trước khi cleanup.

---

# 3. KHÔNG ĐƯỢC “CLEANUP HÀNG LOẠT”

Không:

```text
xóa tất cả unused exports một lần
xóa tất cả file không thấy import
xóa toàn bộ legacy helper
xóa test cũ chỉ vì test production không gọi
```

Phải chia theo đơn vị nhỏ:

```text
candidate
→ prove unused
→ test before
→ remove/refactor
→ targeted regression
→ full neighboring regression
→ continue
```

---

# 4. PHÂN LOẠI CANDIDATE

Mỗi candidate phải được xếp:

```text
A. CONFIRMED DEAD
B. PROBABLY DEAD
C. LIVE INDIRECTLY
D. TEST-ONLY BY DESIGN
E. COMPATIBILITY / MIGRATION CODE
F. UNKNOWN — DO NOT DELETE
```

Chỉ được tự động xóa:

```text
A. CONFIRMED DEAD
```

`PROBABLY DEAD` không đủ.

---

# 5. DEFINITION — CONFIRMED DEAD

Một function/module/export chỉ được coi là `CONFIRMED DEAD` khi đồng thời:

```text
1. Không có static caller/import runtime.
2. Không có dynamic import.
3. Không được module registry/prototype installer expose.
4. Không được gọi qua string/command/router/HTML data-*.
5. Không nằm trong compatibility/migration path.
6. Không được backend/plugin/background worker sử dụng.
7. Không được E2E/runtime script sử dụng.
8. Không là public API intentionally preserved.
9. Build graph chứng minh unreachable từ production entrypoints.
10. Xóa nó không thay đổi production bundle behavior ngoài expected size reduction.
11. Full tests/build/E2E không regress.
```

Nếu không chứng minh được 1 trong các điều trên:

```text
DO NOT DELETE.
```

---

# 6. PRODUCTION ENTRYPOINTS

Xác định đầy đủ entrypoints thực tế.

Frontend ít nhất:

```text
frontend/app/app.js
dynamic route modules
WorkflowModuleLoader
AssistantLoader
NotificationCenter
admin lazy loader
ExcelIntegration
WordIntegration
```

Backend:
- application startup;
- routers;
- document worker;
- CLI/scripts thực sự được deployment gọi.

Scripts:
- package.json scripts;
- deployment;
- migration;
- backup;
- fixture;
- CI.

Không coi một file unreachable từ `app.js` là dead nếu nó là CLI/worker/test/deployment entrypoint.

---

# 7. EXISTING FINDING — `canApplyPreview()`

Audit lại:

```text
frontend/procurement/PlanImportWizard.js
```

Candidate:

```js
export function canApplyPreview(preview, decisions = {}) { ... }
```

Known observation:
- runtime Apply hiện dùng `canStartSequentialImport()`;
- tests vẫn import trực tiếp `canApplyPreview()`.

Không được xóa ngay.

Phải search toàn repo:
- static imports;
- dynamic access;
- controller prototype;
- tests;
- documentation;
- external integration assumptions.

Nếu confirmed dead production logic:
- remove function;
- remove/update obsolete tests;
- prove behavior unchanged.

Nếu là compatibility helper:
- retain and document.

---

# 8. HIGH-PRIORITY ARCHITECTURAL CLEANUP
## `export *` + prototype installation

Current pattern:

```text
BiddingWorkflows.js
→ export * from many workflow modules
→ WorkflowModuleLoader imports BiddingWorkflows
→ moduleRegistry Object.entries(module)
→ installs every function/class export onto BiddingController.prototype
```

This may expose helpers/classes that are not controller commands.

Audit:

```text
frontend/packages/BiddingWorkflows.js
frontend/app/moduleRegistry.js
frontend/app/WorkflowModuleLoader.js
```

Do NOT refactor blindly.

Goal:

```text
controller prototype should receive only intentional controller commands.
```

Preferred architecture if safe:

```js
export const controllerCommands = {
    editKeHoach,
    deleteKeHoach,
    ...
};
```

or explicit exports/install manifest.

But this refactor is allowed ONLY IF:
- complete command inventory exists;
- all HTML/string command usage is mapped;
- all route action calls are mapped;
- all tests prove parity;
- no public runtime method disappears unintentionally.

If full proof cannot be produced:

```text
DO NOT CHANGE THE REGISTRY ARCHITECTURE IN THIS TASK.
```

Instead only report findings.

---

# 9. BUILD A COMMAND INVENTORY BEFORE TOUCHING PROTOTYPE EXPORTS

Generate a table:

| Command/export | Declared in | Installed? | Static caller | Dynamic/string caller | HTML caller | Test-only | Action |
|---|---|---:|---|---|---|---|---|

Search:

```bash
rg -n "this\.[A-Za-z0-9_]+\(" frontend
rg -n "controller\.[A-Za-z0-9_]+\(" frontend
rg -n "\[[\"'][A-Za-z0-9_]+[\"']\]" frontend
rg -n "data-[a-z-]+" views frontend
rg -n "methodName|fnName|command|actionMap|workflowRequirementForMethod" frontend
```

Also inspect:
- `setupActionListeners`;
- route handlers;
- lazy module loader;
- command bus;
- HTML onclick/data attributes if any.

---

# 10. STATIC MODULE GRAPH — EXTEND SAFELY

Current:

```text
scripts/check_frontend_modules.mjs
```

only checks import cycles.

Extend/add a separate checker for:

```text
reachable production modules
orphan modules
unused exports
dynamic entry allowlist
```

Do NOT break current cycle checker.

Preferred:
- keep cycle detection;
- add explicit production entrypoint list;
- support dynamic import parsing;
- allow worker/script/test entrypoints separately;
- produce report first;
- fail CI only on HIGH-CONFIDENCE confirmed dead additions.

---

# 11. DO NOT TRUST A SINGLE TOOL

If adding `knip` or another tool:

Use it as one signal only.

Do not:

```text
knip says unused → delete
```

Must cross-check:
- runtime architecture;
- module registry;
- tests;
- HTML;
- dynamic imports;
- scripts;
- backend routes.

---

# 12. FRONTEND DEAD-CODE AUDIT

Audit:

```text
frontend/app
frontend/procurement
frontend/plans
frontend/packages
frontend/partners
frontend/contracts
frontend/documents
frontend/admin
frontend/auth
frontend/assistant
frontend/shared
frontend/errors
frontend/experts
frontend/legal
frontend/landing
```

Find:
- unreachable module;
- unused export;
- duplicate helper;
- obsolete wrapper;
- helper only retained by tests;
- class exposed accidentally to controller prototype.

---

# 13. DIRECT STATE WRITE DEBT

Current debt checker tracks direct state writes.

Do not classify all direct state writes as dead code.

Audit each one:

```text
is this old mutation architecture?
is there already MutationService equivalent?
are both old/new paths active?
```

Only remove legacy path if:
- new path covers exact behavior;
- no call site remains;
- workspace/outbox semantics preserved;
- tests compare both.

---

# 14. BACKEND DEAD-CODE AUDIT

Use Ruff/F401/F841 as baseline but go beyond them.

Audit:
- unused functions/classes;
- orphan route handlers;
- duplicate services;
- superseded compatibility functions;
- unused worker entrypoints;
- scripts not referenced by package/deploy/README/CI.

Do NOT delete:
- migration helpers;
- DB compatibility paths;
- data-repair scripts;
- production incident tools;
unless explicitly proven obsolete.

---

# 15. PYTHON DYNAMIC USAGE

Account for:
- FastAPI router registration;
- decorators;
- dependency injection;
- import side effects;
- CLI entrypoints;
- worker processes.

A Python function with no direct caller may still be live through decorators.

---

# 16. DEPENDENCY AUDIT

Audit `package.json`, `requirements.txt`.

Candidate unused dependency must be cross-checked with:
- build config;
- scripts;
- E2E;
- runtime import;
- CLI;
- secure build.

Do not remove dependency unless:
- no runtime/build/test/script usage;
- clean install + full build/test passes.

---

# 17. DUPLICATE LOGIC ≠ DEAD CODE

If two implementations look equivalent:

```text
DO NOT DELETE ONE UNTIL SEMANTIC EQUIVALENCE IS PROVEN.
```

Compare:
- inputs;
- outputs;
- side effects;
- workspace capability;
- outbox behavior;
- errors;
- loading state;
- retries;
- historical compatibility.

---

# 18. MIGRATION / LEGACY COMPATIBILITY

Legacy code is not automatically garbage.

Examples:
- legacy field aliases;
- schema migrations;
- tombstone migrations;
- storage envelope migrations;
- old database format readers.

These can be removed only if:
- supported migration window is explicitly ended;
- production data no longer depends on them;
- migration version proof exists.

Otherwise retain.

---

# 19. NO BUSINESS-LOGIC REFACTOR

This task must NOT:
- redesign procurement logic;
- change version rules;
- change state machine;
- change sync semantics;
- change RBAC;
- change auth policy;
- change server contract;
- change storage schema;
unless strictly necessary to remove confirmed dead code and proven behavior-equivalent.

Default:

```text
NO FUNCTIONAL CHANGE.
```

---

# 20. GOLDEN BEHAVIOR SNAPSHOT BEFORE CLEANUP

Before first deletion, run and record:

```bash
npm run test:js:coverage

python -m pytest -q \
  --cov=backend \
  --cov-branch \
  --cov-report=term \
  --cov-report=json:coverage.json \
  --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json

npm run check:static
npm run build:secure
```

If baseline is red:
- report exact failures;
- do not attribute them to cleanup later.

---

# 21. TARGETED REGRESSION FOR EACH DELETION

For every removal:
- run nearest unit tests;
- run feature-specific regression;
- run module/route test if command removed;
- run build if export/module graph changed.

Example:

```text
remove PlanImportWizard helper
→ procurement_import_wizard tests
→ procurement lookup tests
→ build
```

---

# 22. FULL REGRESSION AFTER CLEANUP

Required:

```bash
npm run test:js:coverage

python -m pytest -q \
  --cov=backend \
  --cov-branch \
  --cov-report=term \
  --cov-report=json:coverage.json \
  --cov-fail-under=45

python scripts/check_critical_coverage.py coverage.json

npm run check:static
npm run build:secure
npm run test:e2e:smoke
npm run test:performance
```

E2E must include:
- Chromium;
- Firefox;
- WebKit.

If environment blocks:
- report BLOCKED;
- do not fake PASS.

---

# 23. CRITICAL BUSINESS REGRESSION MATRIX

After cleanup verify at least:

```text
Workspace switch
Same-org epoch switch
Plan create/edit/version
Package create/edit/version
MSC Plan import 00→01→02
Package import
Notice import
Opening import
Draft HSDT
Outbox sync
F5 conflict recovery
Resume/cancel import
Multi-tab draft
RBAC role isolation
Auth login/logout
Secure cookie behavior
Document Excel/Word lazy loading
Assistant lazy loading
Notification center lazy loading
```

---

# 24. NO TEST DELETION TO MAKE CLEANUP PASS

Forbidden:

```text
delete failing test
weaken assertion
skip test
mark flaky
lower coverage
remove E2E scenario
```

If deleting dead code invalidates a test:
- prove test was only testing dead API;
- replace/remove test with documented rationale;
- ensure equivalent production behavior remains covered.

---

# 25. BUNDLE COMPARISON

Before/after record:
- JS bundle total bytes;
- chunks;
- CSS total;
- dynamic chunks.

Expected cleanup:
- same behavior;
- equal or smaller code footprint.

Unexpected large change:
- investigate before proceeding.

---

# 26. PERFORMANCE

Cleanup must not worsen:
- startup time;
- route lazy loading;
- sync latency;
- form open latency.

Run:

```bash
npm run test:performance
```

If regression:
- revert responsible cleanup.

---

# 27. SECURE BUILD DEAD CODE INJECTION

`vite.config.js` intentionally uses:

```text
deadCodeInjection: true
```

This is obfuscation output, not source-code dead code.

Do NOT remove this setting as part of cleanup unless:
- separate benchmark proves it should change;
- user explicitly asks for build-obfuscation changes.

Out of scope by default.

---

# 28. GIT SAFETY

Before cleanup:

```bash
git status --short
```

Do not modify unrelated work.

Use small logical commits.

Example:

```text
chore(dead-code): remove confirmed unused preview helper
chore(modules): restrict controller command exports
chore(tooling): add dead-code reachability audit
```

No mixed feature changes.

---

# 29. REVERT POLICY

If any cleanup causes:
- behavioral uncertainty;
- flaky regression;
- unexpected data path change;
- dynamic command missing;
- E2E failure;
- performance regression;

then:

```text
REVERT THAT CLEANUP.
```

Do not “fix around it” with unrelated architecture changes.

---

# 30. REQUIRED FINAL DEAD-CODE MATRIX

| ID | Candidate | Evidence | Classification | Action | Regression evidence |
|---|---|---|---|---|---|

For NOT DELETED entries explain why.

---

# 31. REQUIRED REMOVAL LOG

For each actual removal:

```text
symbol/file:
why confirmed dead:
all known reference checks:
tests before:
tests after:
bundle impact:
behavior impact: NONE
```

---

# 32. STOP AUDIT ROUND 1

After all removals:
- rerun dead-code tooling;
- review changed import graph;
- review controller command inventory;
- review dynamic imports;
- review test-only exports.

If a newly unreachable production file appears unexpectedly:
- investigate.

---

# 33. STOP AUDIT ROUND 2 — NO REGRESSION REVIEW

Review every diff line and answer:

```text
Did this remove any side effect?
Did this remove any runtime registration?
Did this alter timing/order?
Did this alter import side effects?
Did this alter workspace capability?
Did this alter prototype command availability?
Did this alter public/test compatibility intentionally?
```

Any uncertain answer:
- revert or retain code.

---

# 34. STOP CONDITION

Codex may declare DONE only when:

```text
1. Every deleted symbol/file was CONFIRMED DEAD.
2. No uncertain candidate was deleted.
3. No business logic changed.
4. No public/runtime command disappeared unintentionally.
5. Dynamic/lazy routes still work.
6. Full unit tests pass.
7. Full Python tests pass.
8. Static checks pass.
9. Secure build passes.
10. E2E passes or is explicitly BLOCKED by environment.
11. Performance has no regression.
12. Bundle remains valid.
13. Post-cleanup stop audit finds no new functional regression.
14. Dead-code guard/tooling is added or improved to prevent recurrence.
```

---

# 35. FINAL QUESTIONS

Answer with evidence:

```text
1. Did any production feature behavior change?
2. Did any controller command disappear?
3. Did any dynamic/lazy module become unreachable?
4. Did any route/worker/script entrypoint disappear?
5. Did any test get weakened?
6. Did coverage threshold drop?
7. Did secure build behavior change?
8. Did workspace/versioning/sync/RBAC semantics change?
9. Did E2E regress?
10. Did performance regress?
11. Are all deleted candidates proven CONFIRMED DEAD?
12. Were uncertain candidates preserved?
```

If 1–10 = unsafe:

```text
TASK IS NOT DONE.
```

---

# 36. FINAL PRINCIPLE

```text
CLEANUP IS OPTIONAL.
CORRECTNESS IS NOT.
```

```text
DELETE LESS,
BUT DELETE ONLY WITH PROOF.
```

```text
IF SAFETY CANNOT BE PROVEN,
KEEP THE CODE AND REPORT IT.
```

```text
ZERO-REGRESSION IS MORE IMPORTANT
THAN MAXIMUM CODE REDUCTION.
```

---

# 37. FINAL EXECUTION ORDER

```text
FETCH LATEST
→ BASELINE TESTS
→ BUILD PRODUCTION/DYNAMIC REACHABILITY MAP
→ BUILD CONTROLLER COMMAND INVENTORY
→ CLASSIFY DEAD-CODE CANDIDATES
→ DO NOT DELETE UNCERTAIN CODE
→ REMOVE ONE CONFIRMED GROUP AT A TIME
→ TARGETED REGRESSION AFTER EACH GROUP
→ ADD DEAD-CODE TOOLING/GUARD
→ FULL JS/PYTHON
→ STATIC
→ SECURE BUILD
→ E2E 3 BROWSERS
→ PERFORMANCE
→ BUNDLE COMPARISON
→ STOP AUDIT ROUND 1
→ STOP AUDIT ROUND 2
→ ONLY THEN DONE
```
