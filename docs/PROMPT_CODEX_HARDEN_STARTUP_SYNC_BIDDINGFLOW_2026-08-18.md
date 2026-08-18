# PROMPT CODEX — RÀ SOÁT VÀ SỬA LỖI BIDDINGFLOW TRÊN HEAD MỚI NHẤT

## 0. Bối cảnh bắt buộc

Repository:

```text
https://github.com/newstar94/Bidding
```

Commit `main` đã được rà soát gần nhất:

```text
bd095798dca6a62f6f6db086af2b55cfbad4f436
```

Commit message:

```text
feat: implement initial route reconciliation scheduling and enhance sync state handling
```

**Không được mặc định rằng commit trên vẫn là HEAD khi bắt đầu làm việc.**

Trước khi sửa bất kỳ file nào:

1. Checkout `main`.
2. Fetch/pull code mới nhất.
3. Ghi lại SHA HEAD hiện tại, commit message và thời điểm commit.
4. Nếu HEAD khác `bd095798...`, rà soát diff từ commit này đến HEAD mới.
5. Chỉ sửa vấn đề còn tồn tại trên HEAD thực tế.

---

# 1. Mục tiêu

Thực hiện một vòng hardening có kiểm soát cho BiddingFlow, tập trung vào:

1. Startup reconciliation sau khi chuyển từ blocking sang deferred/background.
2. Đồng bộ local IndexedDB ↔ server trong thời gian người dùng đã thấy UI.
3. Sync state machine, retry, conflict, outbox và workspace switching.
4. Bảo vệ khỏi stale local snapshot gây sửa sai dữ liệu.
5. Version/snapshot invariants của kế hoạch và gói thầu.
6. CI/E2E thực tế trên HEAD hiện tại.
7. Tiếp tục refactor có kiểm soát các God-module.
8. Không làm regression các phần đã được sửa:
   - secure frontend build;
   - `.vite/manifest.json`;
   - production frontend fail-fast;
   - Excel technical evaluation method;
   - MuaSamCong source contracts;
   - version fixes đã có.

Mục tiêu cuối cùng:

```text
UI nhanh
+
không hiển thị/sửa dữ liệu stale một cách nguy hiểm
+
không mất mutation local
+
không ghi đè lỗi sync
+
không vượt workspace/permission
+
CI xanh bằng sửa code thật
```

---

# 2. Những việc KHÔNG được làm

Tuyệt đối không:

- giảm coverage threshold;
- xóa critical coverage gate;
- bỏ Firefox/WebKit;
- dùng `test.skip()` để né lỗi;
- tăng performance budget chỉ để test pass;
- bỏ secure build/artifact verification;
- bỏ FK/index audit;
- bỏ dependency audit/SBOM;
- sửa test expectation sai thành đúng chỉ để hợp implementation;
- tăng technical debt baseline;
- thêm broad `except Exception` không có lý do;
- swallow error để CI xanh.

Nếu test phát hiện bug thật: **sửa implementation**, không sửa test để hợp thức hóa bug.

Không được quay lại blocking toàn bộ startup bằng cách `await full authoritative sync` trước khi render UI.

Không được xử lý stale state bằng `server wins everything` hoặc `client wins everything` một cách mù quáng. Phải tôn trọng outbox, row version, aggregate version, workspace lease, assignment, permission, immutable historical versions và local unsynced changes.

Không phá offline mode. Nếu offline thật sự:
- local snapshot vẫn dùng được theo policy hiện có;
- mutation local phải lưu bền vững;
- UI phải phân biệt offline/pending/error;
- online lại phải reconcile đúng.

---

# 3. Những phần đã được sửa — KHÔNG làm lại

Chỉ sửa nếu HEAD mới cho thấy regression thật.

## 3.1 Secure frontend artifact

Đã có:

```text
backend/frontend_assets.py
scripts/verify_secure_build_artifact.py
```

CI đã giữ hidden `.vite` và downstream verify artifact.

## 3.2 Production frontend fail-fast

Production đã kiểm tra manifest, hashed assets, path safety, secure marker và không silent fallback về legacy bundle.

## 3.3 Technical evaluation method

Đã có:

```text
backend/documents/technical_evaluation_method.py
shared/technical_evaluation_method_cases.json
```

Excel service đã đọc stored evaluation metadata.

## 3.4 MuaSamCong source operation registry

Đã có:

```text
backend/procurement_import/source_contracts.py
```

Không quay về hard-code endpoint/shape rải rác.

---

# 4. P0 — STARTUP RECONCILIATION CORRECTNESS

Đọc kỹ:

```text
frontend/app/BiddingController.js
frontend/app/startupReconciliation.js
frontend/app/SyncPullService.js
frontend/app/BiddingControllerSync.js
frontend/app/BiddingModel.js
frontend/app/workspaceLease.js
frontend/app/SyncWorkspaceContext.js
frontend/app/workspaceState.js
frontend/app/WorkspaceMutationOutbox.js
frontend/app/WorkspaceMutationOutboxStore.js
```

Trace toàn flow:

```text
browser boot
→ session
→ workspace resolution
→ IndexedDB hydration
→ route render
→ user interaction
→ reconciliation push
→ authoritative pull
→ merge
→ outbox replay
→ render
```

Phải chứng minh có hay không khoảng:

```text
local snapshot rendered
BEFORE
authoritative server reconciliation completes
```

Lập bảng các action user có thể thực hiện trong stale window và đánh giá rủi ro:
- xem danh sách;
- mở detail;
- search/filter;
- sửa kế hoạch;
- sửa gói;
- chỉnh thời gian đóng thầu;
- thay assignment;
- cập nhật trạng thái;
- import dữ liệu;
- đánh giá HSDT;
- chỉnh hợp đồng;
- xóa;
- tạo version;
- tạo record mới.

---

# 5. P0 — Thiết kế startup reconciliation state machine

Nếu chưa có state machine rõ ràng, tạo tối thiểu các semantics tương đương:

```text
LOCAL_READY
RECONCILING
RECONCILED
OFFLINE_LOCAL
SYNC_ERROR
CONFLICT
```

Yêu cầu:
- LOCAL_READY: local workspace load xong, UI render được nhưng chưa authoritative.
- RECONCILING: đang push/pull server; mutation rủi ro cao không được xử lý như local là authoritative.
- RECONCILED: authoritative pull xong, merge xong, outbox xử lý theo contract.
- OFFLINE_LOCAL: xác định server/network không khả dụng; cho phép offline workflow, mọi mutation phải vào durable outbox.
- SYNC_ERROR: lỗi actionable, không được background pull ghi đè.
- CONFLICT: giữ conflict cho đến khi được xử lý.

State phải phản ánh operation thật, không dựa vào timeout.

---

# 6. P0 — Mutation gate trong stale window

Không khóa toàn bộ UI.

Chỉ chặn hoặc revalidate mutation nguy hiểm khi:
- startup reconciliation chưa hoàn tất;
- browser đang online;
- chưa xác định offline workflow thật.

Tạo guard tập trung, ví dụ tương đương:

```javascript
canMutateAuthoritatively(...)
awaitAuthoritativeMutationBoundary(...)
```

Không rải hàng chục `if (controller._startupReconciled)` khắp workflow.

UX ưu tiên:
- vẫn render nhanh;
- có thể cho mở form;
- trước commit thì chờ/revalidate;
- nếu record changed thì dùng conflict/version mechanism hiện có.

Không tạo popup spam.

---

# 7. P0 — Permission/assignment stale protection

Test bắt buộc:

## Case A — Quyền bị thu hồi server-side
Local cache còn quyền/record cũ.
Yêu cầu:
- không lưu mutation bằng quyền stale;
- backend RBAC vẫn là authority cuối;
- sau authoritative pull UI re-render scope đúng.

## Case B — Assignment bị gỡ
Không được cho sửa record chỉ vì cache cũ còn assignment.

## Case C — Record đã bị xóa
Không resurrect record do stale local edit.

## Case D — Version mới đã được user khác tạo
Không để edit stale version làm sai latest/version family.

---

# 8. P0 — Reconciliation phải workspace-safe

Test race:

```text
startup reconciliation bắt đầu ở org A
→ user switch org B
→ response org A về muộn
```

Tuyệt đối không:
- ghi state A vào B;
- ghi IndexedDB A vào B;
- update sync UX state B;
- commit cursor A vào B;
- render table A trong B.

Phải dùng đầy đủ:
- workspace lease;
- workspace epoch;
- captured workspace;
- request abort;
- current-workspace assertion.

---

# 9. P0 — Route-safe reconciliation

Test:

```text
user ở /goithau/...
→ reconciliation chạy
→ user chuyển /hopdong/...
→ reconciliation hoàn tất
```

Không được:
- render lại sai route;
- mở modal cũ;
- reset selected tab;
- mất deep-link;
- đè detail selection mới.

Nếu cần render changed state, render theo current route.

---

# 10. P0 — Startup reconciliation + outbox

Trace:

```text
local unsynced mutations exist
→ startup
→ initial autoSync()
→ pull
→ local mutation mới phát sinh trong lúc pull
→ replay
```

Phải chứng minh:
1. mutation không gửi duplicate;
2. mutation phát sinh trong pull chỉ replay một lần;
3. conflict không retry vô hạn;
4. replay failure giữ actionable state;
5. replay success clear đúng outbox;
6. cursor chỉ commit khi hợp lệ;
7. reload giữa chừng không mất outbox.

---

# 11. P0 — Sync UX state machine

Đọc:

```text
frontend/app/SyncPullService.js
frontend/app/BiddingControllerSync.js
frontend/app/SyncPresenter.js
```

Lập danh sách tất cả nơi gọi `updateSyncState(...)`.

Lập transition table cho các phase hiện có, ví dụ:

```text
conflict
error
storageError
transportError
validationRejected
localPending
serverSaved
```

Tìm:
- impossible transition;
- error bị che;
- stale phase;
- phase không bao giờ clear;
- workspace switch giữ phase cũ;
- offline/online nhảy sai state.

Nếu logic phân tán quá nhiều, tạo transition helper tập trung.

---

# 12. P0 — Retry contract

Explicit retry phải theo semantics:

```text
user retry
→ retry pending operation/outbox
→ authoritative verify/pull
→ clear actionable error
→ serverSaved chỉ khi thật sự không còn pending
```

Test:
- retry success;
- retry transport failure;
- retry validation failure;
- retry conflict;
- retry sau workspace switch;
- double-click retry;
- concurrent auto-sync + manual retry.

---

# 13. P0 — IndexedDB durability

Đọc:

```text
frontend/app/BrowserDB.js
frontend/app/WorkspaceMutationOutboxStore.js
frontend/app/BiddingModel.js
```

Test:

## Storage read failure
- table hydration fail;
- UI báo degraded;
- write vào table đó bị chặn;
- recovery thành công;
- write mở lại.

## Outbox durability failure
- outbox store corrupt/fail;
- mutation không được coi là server-saved;
- user không mất thay đổi;
- recovery không tạo duplicate mutation.

Silent catch không được phép ở đường critical durability.

---

# 14. P0 — Workspace switching

Giữ invariant:

```text
org A state NEVER leaks into org B
```

Test:
1. A → B không pending.
2. A → B có pending outbox.
3. A → B khi reconciliation A đang chạy.
4. A → B khi A đang transportError.
5. B local IndexedDB rỗng nhưng cursor còn.
6. A → B → A nhanh.
7. access revoked.
8. session/permission thay đổi.

---

# 15. P0 — Manager → employee persona scope

Commit gần đây cho phép:

```text
manager membership + active role employee
→ inherited VIEW
→ không inherited EDIT
```

Rà soát:

```text
backend/shared/access_policy.py
backend/sync/visibility_epoch.py
frontend access context
workspace role switch
```

Invariant:
- assigned record view allowed;
- unassigned record denied nếu employee scope yêu cầu assignment;
- edit denied nếu không explicit edit;
- explicit edit permission hoạt động;
- role switch refresh authoritative snapshot;
- stale IndexedDB không giữ manager scope cũ.

---

# 16. P0 — CI trên HEAD THỰC TẾ

Không dùng failure log cũ.

Chạy canonical commands từ repo hiện tại:

```bash
npm ci
npm run check:static
npm run test:js:coverage
npm run build:secure
```

Python:

```bash
python -m pytest -q --cov=backend --cov-branch --cov-report=term --cov-report=json:coverage.json --cov-fail-under=45
python scripts/check_critical_coverage.py coverage.json
```

Nếu PostgreSQL khả dụng:

```bash
python scripts/manage_database.py
python scripts/audit_fk_indexes.py
```

Chạy E2E canonical theo package scripts/workflow hiện tại.

Không tự chế command nếu repo đã có script chuẩn.

---

# 17. P0 — Full CI jobs

Giữ mô hình job độc lập ít nhất:

```text
quality
unit-python
unit-js
build
database
e2e
performance
package
release
```

Không gom lại giant job.

`release` phải phụ thuộc required gates.

Giữ restore + verify secure build artifact ở E2E/performance/package.

---

# 18. P0 — E2E startup/sync mới

Thêm Playwright scenarios:

## Scenario 1 — Local stale record
IndexedDB = package version cũ; server = version mới.
Kỳ vọng:
- local render nhanh;
- không commit mutation sai;
- reconcile xong UI phản ánh server;
- route không mất.

## Scenario 2 — Server deleted record
Local còn X, server đã xóa X.
Kỳ vọng:
- không resurrect;
- detail xử lý not-found/refresh hợp lý;
- không crash.

## Scenario 3 — Permission revoked
Local còn record/quyền cũ.
Kỳ vọng:
- mutation không thành công;
- dữ liệu ngoài scope bị loại;
- không leak tenant.

## Scenario 4 — Workspace switch during reconciliation
A reconcile chạy, switch B.
Kỳ vọng: A response không touch B.

## Scenario 5 — Offline startup
Local data + offline.
Kỳ vọng:
- UI dùng local;
- state rõ offline;
- mutation vào durable outbox;
- online lại sync đúng.

## Scenario 6 — Interrupted mutation
Mutation fail transport, background pull success.
Kỳ vọng `transportError` không bị che thành `localPending` trước explicit retry/resolution.

---

# 19. P1 — VERSION / SNAPSHOT INVARIANTS

Đọc:

```text
frontend/packages/GoiThauWorkflow.js
frontend/shared/versionResolver.js
backend/sync/aggregate_mutability.py
backend/sync/version_api.py
backend/sync/mapper.py
backend/sync/deletion_service.py
backend/sync/delete_policy.py
```

Tạo invariant tests.

## Latest invariant
Trong cùng `(rootId, planSnapshot)` phải có tối đa một `isLatest`, hoặc đúng một nếu business rule yêu cầu family không rỗng.

## Package version inheritance
Version mới phải kế thừa đúng:
- assignee;
- status;
- package fields;
- lots;
- goods;
- experts;
- evaluation metadata;
- child graph theo policy.

Không reset về `Chuẩn bị` / `Chưa phân công` nếu không có business rule explicit.

## Detail edit vs list-modal edit
Hai đường sửa phải dùng cùng aggregate-version semantics.
Tạo regression test cho bug:
- edit closing time từ detail;
- edit cùng field từ list modal;
- kết quả inheritance phải giống nhau.

## Delete latest
Delete latest phải phục hồi predecessor trong cùng plan snapshot nếu còn hợp lệ.

## Cold cache == warm cache
Cùng command phải cho semantic result giống nhau khi browser cache lạnh và đã hydrate đầy đủ.

---

# 20. P1 — Mua Sắm Công contract regression

Không viết lại registry.

Rà soát:

```text
backend/procurement_import/source_contracts.py
backend/procurement_import/opening_snapshot.py
backend/integrations/muasamcong_browser/procurement_source.py
```

Giữ semantic authority:
- OPENING_BID = bidder-level summary;
- OPENING_LOT = bidder-lot relation;
- OPENING_LOT_DETAIL = lot detail.

Không biến `OPENING_SUBMISSION` thành required source nếu evidence/code hiện tại không yêu cầu.

---

# 21. P1 — Excel bid evaluation regression

Rà soát:

```text
backend/documents/excel_service.py
backend/documents/technical_evaluation_method.py
frontend/documents/excelImportAdapters.js
frontend/packages/technicalEvaluationMethod.js
shared/technical_evaluation_method_cases.json
```

Invariant:
- PASS_FAIL → dropdown `Đạt/Không đạt`;
- SCORE → numeric score, không dropdown pass/fail.

Round-trip không mất:
- clarification;
- failure reason;
- score;
- zero;
- false;
- decimal;
- lot code;
- JV data.

---

# 22. P1 — Refactor `backend/procurement_import/routes.py`

Không rewrite.

Strangler extraction:
- routes.py chỉ còn HTTP/auth/context/input boundary/service call/response mapping;
- dần tách plan import, notice import, opening import, enrichment, import session, error mapping.

Chỉ extract boundary có test.

---

# 23. P1 — Refactor `backend/sync/mapper.py`

Tiếp tục extraction đã có:

```text
child_projection.py
payload_mapping.py
record_serializer.py
record_validator.py
record_writer.py
```

Ưu tiên tách:
1. evaluation persistence;
2. opening child persistence;
3. JV member persistence;
4. package child persistence;
5. plan child persistence.

Giữ compatibility aliases/import facade nếu external code đang phụ thuộc.

---

# 24. P1 — `payload_validation.py`

Nếu vẫn lớn, tách theo domain:
- plan;
- package;
- opening;
- evaluation;
- contract;
- shared.

Chỉ làm nếu boundary rõ, có test và không duplicate schema logic.

---

# 25. P1 — Frontend large modules

Đọc dependency graph trước khi refactor.

Đánh giá:

```text
frontend/app/BiddingController.js
frontend/app/BiddingControllerForms.js
frontend/app/BiddingView.js
frontend/packages/*
```

Không refactor chỉ vì file lớn.

Chỉ tách khi boundary use-case rõ:
- startup coordinator;
- workspace coordinator;
- sync coordinator;
- routing coordinator.

---

# 26. P1 — Broad exception / silent catches

Python: tìm `except Exception`.
JavaScript: tìm `catch {}` hoặc catch không xử lý meaningful.

Allowed:
- transaction boundary + rollback + re-raise;
- background best-effort có structured log/metric;
- optional UI best-effort không ảnh hưởng correctness.

Không allowed silent catch ở:
- outbox;
- permission;
- sync cursor;
- version mutation;
- persistence;
- workspace transition;
- schema validation;
- release gate.

---

# 27. Repo governance

Kiểm tra `main`.

Nếu branch/ruleset chưa protected, đề xuất hoặc cấu hình nếu có quyền.

Required checks nên gồm tối thiểu:
- Full CI / release-equivalent gate;
- CodeQL;
- Supply-chain security.

Yêu cầu:
- block force push;
- block deletion;
- required checks trước merge;
- không bypass cho normal contributor.

Nếu Codex không có quyền settings: không giả vờ đã bật, chỉ xuất hướng dẫn chính xác.

---

# 28. Test strategy

Phải có đủ:

## Unit
- state transition;
- mutation gate;
- workspace lease;
- retry;
- startup schedule.

## Integration
- outbox + pull + replay;
- version persistence;
- backend permission;
- IndexedDB failure.

## E2E
- stale startup;
- permission change;
- workspace race;
- version edit;
- offline → online;
- cross-browser.

Tên test phải mô tả invariant, ví dụ:

```text
startup_does_not_commit_a_stale_package_before_authoritative_reconciliation
workspace_a_reconciliation_cannot_mutate_workspace_b
background_pull_preserves_actionable_sync_error_until_retry
detail_package_edit_preserves_assignment_and_status_when_versioning
cold_cache_and_warm_cache_produce_the_same_latest_package_version
```

---

# 29. Performance constraints

Không đưa full server sync vào critical render path.

Không:
- hydrate toàn DB chỉ để guard một mutation;
- double pull;
- duplicate IndexedDB persistence;
- tăng budget để che regression.

Tận dụng startup metrics nếu có:
- route:rendered;
- loader:hidden;
- route-data-sync:start;
- route-data-sync:end.

Mục tiêu: **render nhanh + mutation an toàn**.

---

# 30. Security constraints

Giữ:
- tenant isolation;
- workspace isolation;
- RBAC;
- assignment scope;
- record scope;
- active-role least privilege;
- session/CSRF rules hiện có.

Frontend guard chỉ là UX/correctness. Backend vẫn là authority.

Không enforce quyền backend dựa vào hidden/disabled UI hay role do client gửi.

---

# 31. Data-loss constraints

Không làm mất:
- unsynced local mutation;
- outbox;
- opening data;
- bid evaluation result;
- evaluation criteria;
- lot relation;
- JV member;
- assignment;
- status;
- historical version;
- latest relation.

Nếu storage schema thay đổi:
1. backward compatibility;
2. test legacy data;
3. không purge local DB im lặng;
4. có recovery path.

---

# 32. Observability

Khi reconciliation fail, không log full payload, secrets, session token hoặc PII không cần thiết.

Cho phép log:
- safe workspace key;
- correlationId;
- phase;
- operation;
- error code;
- duration;
- retry count.

Tận dụng `releaseDiagnostics.js` nếu đã có.

---

# 33. Kiểm tra duplicate sync scheduling

Startup hiện có initial reconciliation và background sync.

Trace xem có overlap:

```text
initial reconcile
+
background auto sync
```

Nếu có, dùng single-flight/coordinator workspace-scoped.

Không dùng global mutex không cần thiết.

Test:

```text
initial reconciliation still running
→ scheduled background sync fires
→ không tạo hai pipeline push/pull xung đột
```

---

# 34. Kiểm tra duplicate `forceSyncData`

Search toàn repo:

```text
forceSyncData(
```

Phân loại:
- initial startup;
- workspace switch;
- manual refresh;
- conflict recovery;
- background sync;
- visibility epoch reset.

Không để hai full authoritative pulls chạy chỉ vì route render + startup background cùng kích hoạt.

---

# 35. Kiểm tra visibility epoch và sync cursor

Invariant:

```text
cursor belongs to workspace + visibility policy
```

Nếu scope/policy đổi:
- cursor cũ không được chứng minh local state authoritative;
- phải full/appropriate authoritative pull;
- không reuse cursor A cho B;
- role switch phải invalidate projection cũ đúng cách;
- không purge outbox.

---

# 36. Kiểm tra `hasLocalWorkspaceData()`

Không được coi:

```text
has local data
```

tương đương:

```text
has authoritative/current data
```

Nếu semantic đang bị trộn, tách rõ `hasLocalSnapshot` và `hasAuthoritativeSnapshot` hoặc equivalent.

---

# 37. Kiểm tra detail record hydration

Các helper như:
- detailRecordExists;
- fetchRecordByLookup;
- storeFetchedRecord;

phải tôn trọng:
- referenceOnly;
- workspace;
- route;
- visibility;
- latest/version semantics.

Local reference-only row không được coi như full authoritative record.

---

# 38. Kiểm tra mutation success semantics

Một save không được gọi là server-saved nếu mới chỉ persist IndexedDB.

Phân biệt:

```text
LOCAL_DURABLE
SERVER_ACKED
```

Nếu UI wording chưa chính xác, sửa ở centralized presenter.

---

# 39. Deliverable cuối cùng từ Codex

Trả báo cáo Markdown gồm:

## A. HEAD

```text
start SHA:
end SHA:
```

## B. Root causes

Phân biệt:
- CONFIRMED;
- RISK;
- NOT REPRODUCED;
- ALREADY FIXED.

Không bịa bug.

## C. Files changed

| File | Change | Reason |
|---|---|---|

## D. Tests added

| Test | Scenario | Regression protected |
|---|---|---|

## E. Commands run

Ghi command + result thật.

Ví dụ:

```text
npm run check:static       PASS
npm run test:js:coverage   PASS
pytest ...                 PASS
npm run build:secure       PASS
```

Không ghi PASS nếu chưa chạy.

## F. Remaining risks

Chỉ ghi risk thực.

## G. Refactors deferred

Nêu rõ phần chưa làm để tránh scope creep.

---

# 40. Definition of Done

## Correctness
- [ ] stale local snapshot không tạo mutation nguy hiểm trước authoritative reconciliation mà không guard/revalidation;
- [ ] offline workflow vẫn hoạt động;
- [ ] workspace A response không thể ghi workspace B;
- [ ] background pull không che actionable sync error;
- [ ] retry success/failure transition đúng;
- [ ] outbox không duplicate và không mất sau reload;
- [ ] permission revoked không edit được từ stale cache;
- [ ] assignment revoked không edit được từ stale cache;
- [ ] deleted record không bị resurrect;
- [ ] server-side version change không phá latest invariant.

## Versioning
- [ ] detail edit và list-modal edit inheritance giống nhau;
- [ ] assignment/status được kế thừa đúng;
- [ ] delete latest restore predecessor đúng;
- [ ] cold-cache == warm-cache semantic result.

## CI
- [ ] static gate pass;
- [ ] Python tests pass;
- [ ] JS tests pass;
- [ ] coverage gates pass;
- [ ] secure build pass;
- [ ] artifact verification pass;
- [ ] DB audit pass nếu môi trường hỗ trợ;
- [ ] E2E pass;
- [ ] Chromium pass;
- [ ] Firefox pass;
- [ ] WebKit pass;
- [ ] performance pass;
- [ ] production package validation pass.

Không hạ chuẩn để đạt checkbox.

---

# 41. Thứ tự thực hiện bắt buộc

## PHASE 0 — Reproduce
1. Xác định HEAD.
2. Chạy test hiện tại.
3. Reproduce stale-window.
4. Trace sync transitions.
5. Trace workspace lease.
6. Trace outbox lifecycle.
7. Ghi root cause trước khi sửa.

## PHASE 1 — P0 correctness
8. Thiết kế reconciliation state contract.
9. Mutation safety/revalidation.
10. Workspace-safe async completion.
11. Sync state machine.
12. Retry.
13. Permission/assignment stale behavior.
14. Add unit/integration tests.

## PHASE 2 — E2E
15. stale startup E2E.
16. workspace race E2E.
17. offline/online E2E.
18. version regression E2E.

## PHASE 3 — Version invariants
19. Add invariant tests.
20. Sửa version behavior nếu còn bug.

## PHASE 4 — CI
21. Run all canonical gates.
22. Fix only real failures.
23. Rerun until green.

## PHASE 5 — Refactor
Chỉ sau khi P0 xanh:
24. Extract `procurement_import/routes.py`.
25. Extract `sync/mapper.py`.
26. Extract `payload_validation.py`.

---

# 42. Nguyên tắc triển khai

Ưu tiên:
- small explicit helpers;
- domain/state contracts;
- invariant tests;
- reuse existing workspace lease/outbox abstractions.

Tránh:
- giant new manager class;
- global mutable flags;
- random `setTimeout`;
- magic delays;
- arbitrary retries;
- duplicate permission logic;
- duplicate technical evaluation logic;
- duplicate MSC contracts.

Không dùng timeout như correctness mechanism.

---

# 43. Final instruction

Làm như một senior engineer chuẩn bị BiddingFlow cho production.

Mục tiêu không phải “làm test xanh”, mà là:

```text
đúng dữ liệu
đúng quyền
không mất dữ liệu
không race workspace
không stale mutation
không regression version
CI xanh vì implementation đúng
```

Trước mỗi thay đổi lớn:
1. chứng minh root cause;
2. thêm/reproduce failing test nếu có thể;
3. sửa implementation;
4. chạy regression;
5. giữ backward compatibility;
6. ghi lại kết quả.

Nếu mục nào đã được HEAD mới sửa:
```text
ALREADY FIXED
```
và không sửa lại.

Nếu không reproduce được:
```text
NOT REPRODUCED
```
giải thích cách kiểm tra, không bịa patch.

Nếu phát hiện lỗi mới nghiêm trọng hơn, ưu tiên correctness/security/data-loss hơn refactor.

Không làm refactor P1/P2 khi P0 vẫn đỏ.
