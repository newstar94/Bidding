Bạn đang làm việc trên repository:

https://github.com/newstar94/Bidding

## Mục tiêu

Hãy kiểm tra **code mới nhất của nhánh `main`**, xác minh lại toàn bộ các vấn đề bên dưới, sau đó trực tiếp sửa/refactor/test repository để:

1. Ngăn sai phạm vi tổ chức/workspace.
2. Tăng độ an toàn cho các luồng nghiệp vụ quan trọng.
3. Hardening phần AI, audit và redaction dữ liệu nhạy cảm.
4. Giảm technical debt backend/frontend.
5. Tăng coverage thực chất cho các module quan trọng.
6. Cải thiện monitoring/observability production.
7. Giữ nguyên toàn bộ tính năng hiện có và không làm regression.
8. Đảm bảo toàn bộ CI hiện tại vẫn pass sau khi thay đổi.

Không được chỉ viết báo cáo hoặc đề xuất. Hãy **thực hiện thay đổi code thực tế**, thêm migration nếu thực sự cần, bổ sung tests, chạy test/lint/build và sửa đến khi đạt yêu cầu.

## Thứ tự ưu tiên và giới hạn bắt buộc

1. `AGENTS.md` và business contract hiện hành có ưu tiên cao nhất.
2. Phải bảo toàn tenant isolation, module permission, assignment scope, record-level authorization, role, capability, entitlement và API/UI behavior hiện có.
3. Không tự ý thay đổi masking, redaction, ẩn trường, lọc response hoặc rút gọn dữ liệu trong màn hình/API đọc bản ghi mà người dùng đã có quyền truy cập đầy đủ. Redaction chỉ áp dụng cho log, audit, telemetry, prompt context, tool payload hoặc dữ liệu nội bộ được chỉ định.
4. Không dùng “least privilege”, “fail closed” hoặc “an toàn hơn” làm lý do đủ để thay đổi business behavior chưa được phê duyệt.
5. Không thực hiện mega-refactor; chỉ xử lý phase hoặc nhóm thay đổi có phạm vi và tiêu chí nghiệm thu rõ ràng.
6. Nếu contract chưa rõ, phải ghi nhận `deferred`/`blocked` và không tự suy luận để sửa production code, schema, UI hoặc test expectation.

---

# I. QUY TẮC BẮT BUỘC TRƯỚC KHI SỬA

Trước tiên:

- Kiểm tra branch, HEAD và working tree trước. Không tự ý pull, merge, reset, checkout hoặc ghi đè thay đổi chưa commit; chỉ fetch khi cần xác minh remote mà không làm thay đổi working tree.
- Đọc:
  - `README`
  - cấu trúc backend/frontend
  - `.github/workflows/**`
  - `package.json`
  - Python dependency/config
  - scripts quality/coverage
  - migration registry
  - deploy/monitoring
  - auth/session/organization
  - sync/offline
  - document processing
  - billing
  - AI modules
- Kiểm tra CI gần nhất trên GitHub nếu môi trường cho phép.
- Không được giả định rằng các line/function/path trong prompt này còn giống hệt phiên bản trước.
- Nếu một vấn đề đã được sửa trong code mới, KHÔNG sửa lại một cách không cần thiết; ghi nhận là đã được xử lý và chuyển sang vấn đề tiếp theo.
- Mỗi finding phải được phân loại: `confirmed`, `already fixed`, `not reproducible`, `deferred`, `fixed` hoặc `unverified`. Chỉ gọi là `fixed` khi có bằng chứng code và regression test phù hợp.
- Không downgrade security hoặc nới quality gate chỉ để làm CI xanh.
- Không xóa test failing để che regression.
- Không dùng broad exception / `# noqa` / eslint-disable / coverage exclusion chỉ để qua gate nếu có thể sửa nguyên nhân thực tế.
- Không thay đổi API contract công khai nếu không thật sự cần thiết.
- Nếu bắt buộc thay API contract, phải có backward compatibility hoặc migration rõ ràng.
- Không tự commit hoặc push nếu chưa được yêu cầu; commit plan ở cuối chỉ là đề xuất.

---

# II. P1 — SỬA ACTIVE ORGANIZATION / WORKSPACE SCOPE

Kiểm tra kỹ logic liên quan đến:

- `backend/auth/session_utils.py`
- `get_active_org()`
- `X-Active-Org`
- organization membership
- session
- API routes sử dụng organization context
- websocket
- sync/offline replay
- AI permission context
- billing/admin nếu sử dụng organization scope.

Trước đây có logic dạng:

- nếu có `X-Active-Org` thì kiểm tra membership;
- nếu thiếu header thì backend tự lấy một organization đầu tiên từ danh sách membership.

Điều này có thể dẫn tới trường hợp user thuộc nhiều organization nhưng request bị mất header và backend tự chạy trên một workspace khác với workspace UI hiện tại.

## Yêu cầu sửa

Thiết kế scope theo nguyên tắc **fail closed**.

### Mutation request

Đối với:

- POST
- PUT
- PATCH
- DELETE

nếu endpoint thuộc phạm vi organization thì phải xác định organization một cách rõ ràng.

Nếu user có >1 organization mà không thể xác định active organization một cách đáng tin cậy:

- không được tự chọn organization đầu tiên;
- trả lỗi rõ ràng, ví dụ:

`409 ORG_SCOPE_REQUIRED`

hoặc contract tương đương phù hợp kiến trúc hiện tại.

### Read request

Có thể fallback khi user chỉ có đúng 1 organization hợp lệ.

Nếu user có nhiều organization:

- yêu cầu active organization rõ ràng;
- không silently select organization.

### Session

Xem xét sử dụng:

`active_organization_id`

hoặc equivalent trong server-side session.

Nếu client gửi `X-Active-Org`:

- validate organization tồn tại;
- validate active;
- validate membership;
- validate role;
- chỉ sau đó mới thay active organization trong session nếu phù hợp.

### Membership revoke

Nếu membership đã bị revoke sau khi session được tạo:

- request tiếp theo phải fail;
- không được tiếp tục dùng stale organization scope.

### Bắt buộc test

Thêm tests ít nhất cho:

1. User có 1 organization + thiếu header.
2. User có 2 organization + thiếu header.
3. User có 2 organization + header hợp lệ.
4. Header trỏ tới organization không phải member.
5. Membership bị revoke sau khi login.
6. Organization bị disabled/inactive.
7. POST/PATCH/DELETE không có scope.
8. Websocket với organization scope không hợp lệ.
9. Offline replay được tạo ở Org A nhưng hiện user đang ở Org B.
10. Sync replay sau khi quyền tại Org A đã bị revoke.
11. AI request thiếu organization context.
12. AI tool execution sau khi organization context thay đổi giữa lúc model lập kế hoạch và lúc tool được execute.

Đảm bảo fix không tạo cross-tenant access.

---

# III. P1 — TĂNG COVERAGE CHO CÁC MODULE NGHIỆP VỤ QUAN TRỌNG

Kiểm tra:

- `scripts/check_critical_coverage.py`
- Python coverage config
- JS coverage config
- workflow CI.

Các module cần ưu tiên gồm, nếu vẫn tồn tại:

- `lot_lifecycle_routes.py`
- `package_document_routes.py`
- `audit_monitor.py`
- `sync/service.py`
- `document_worker.py`
- `sync/websocket.py`

Không được chỉ nâng threshold mà không thêm test thực.

## Mục tiêu

Nâng dần coverage thực tế cho các đường đi nghiệp vụ quan trọng.

Target đề xuất:

- lot lifecycle: >= 80% line / >= 60% branch
- package document: >= 80% / >= 60%
- audit monitor: >= 90% / >= 70%
- sync service: >= 75% / >= 60%
- document worker: >= 80% / >= 60%
- websocket sync: >= 70% / >= 50%

Nếu kiến trúc hoặc thời lượng CI khiến target trên chưa thực tế trong một PR:

- nâng coverage tối đa một cách hợp lý;
- nhưng phải thiết lập ratchet để coverage không bao giờ giảm;
- ghi rõ phần còn thiếu.

Phải ghi baseline coverage trước thay đổi tại cùng scope và cùng công cụ. Không coi coverage tăng là đạt nếu test không kiểm tra kết quả, quyền, side effect hoặc failure mode thực tế.

Không viết test vô nghĩa chỉ để execute line.

## Bắt buộc thêm scenario test

Đặc biệt kiểm tra luồng:

**Kế hoạch → Gói thầu → Hợp đồng**

Bao gồm:

- happy path;
- invalid status transition;
- duplicate submit;
- concurrent submit;
- optimistic/pessimistic locking nếu có;
- transaction rollback;
- idempotency;
- retry;
- FK integrity;
- delete dependency;
- unauthorized transition;
- cross-org access.

---

# IV. P1 — DOCUMENT PROCESSING / FILE CONSISTENCY

Rà toàn bộ:

- upload document;
- metadata DB;
- object/file storage;
- document worker;
- OCR/parser nếu có;
- retry;
- queue;
- sandbox;
- delete;
- download authorization.

Tìm race condition kiểu:

1. DB insert thành công nhưng file write thất bại.
2. File write thành công nhưng DB commit thất bại.
3. Worker xử lý cùng document 2 lần.
4. Retry tạo duplicate output.
5. Delete document trong khi worker đang chạy.
6. Organization/user mất quyền trong thời gian worker đang xử lý.
7. Filename/path traversal.
8. MIME spoofing.
9. oversized/decompression bomb.
10. download bằng ID của organization khác.

Ưu tiên:

- transaction/outbox pattern;
- idempotency key;
- document processing state machine;
- unique constraint phù hợp;
- lock/compare-and-set;
- safe cleanup.

Thêm test cho các failure mode quan trọng.

---

# V. P1/P2 — AI SECURITY, REDACTION VÀ AUDIT

Rà toàn bộ:

- `backend/ai/**`
- prompt policy;
- tool executor;
- permission context;
- redaction;
- audit;
- provider integration;
- context construction.

Kiến trúc hiện tại cần tiếp tục giữ các nguyên tắc:

- model không tự execute SQL tùy ý;
- AI tool mặc định read-only nếu thiết kế hiện tại như vậy;
- mỗi tool execution phải re-check auth/permission;
- tool output được coi là untrusted data;
- prompt injection từ dữ liệu không được biến thành system instruction.

## Cải thiện redaction

Nếu `redact_value()` hiện chủ yếu che theo key name, hãy bổ sung **content-based redaction**.

Ít nhất nhận diện và che:

- email xuất hiện bên trong free-text;
- số điện thoại;
- Bearer token;
- JWT;
- access token;
- API key phổ biến;
- cookie/session token;
- URL chứa password/token/query secret;
- credential dạng `username:password`;
- secret có entropy/prefix đặc trưng.

Đặc biệt với các field:

- `message`
- `query`
- `content`
- `prompt`
- `arguments`
- `metadata`

không được giả định chỉ vì key không tên `password` mà nội dung an toàn.

Xem xét lưu:

- hash;
- length;
- type/category;
- truncated sanitized content

thay vì raw free-text đối với dữ liệu không cần lưu nguyên văn.

### Tests

Thêm test cho:

- email embedded trong câu;
- JWT trong message;
- bearer token;
- URL query token;
- nested dict/list;
- Unicode;
- long string;
- malicious input;
- secret nằm trong tool argument;
- secret trong tool result;
- audit payload sau redaction.

Không được redact quá mức khiến audit mất hoàn toàn giá trị forensic.

---

# VI. P2 — REFACTOR BACKEND GOD MODULES

Kiểm tra kích thước, cohesion, dependency direction của các module lớn, đặc biệt nếu vẫn tồn tại:

- `backend/app.py`
- `auth_routes.py`
- `sync/service.py`
- `metrics.py`
- `package_document_routes.py`

Không refactor chỉ vì số dòng.

Chỉ tách khi module có nhiều trách nhiệm rõ ràng.

## Hướng refactor đề xuất

### app.py

Tách hợp lý thành:

- application factory;
- startup/lifespan;
- configuration validation;
- production security validation;
- middleware registration;
- route registration;
- frontend shell/static setup.

### auth_routes.py

Có thể tách:

- login/session;
- credential recovery;
- profile;
- organization membership;
- role management;
- platform admin.

### sync

Tách:

- pull;
- push;
- conflict resolution;
- idempotency;
- serialization;
- websocket coordination.

### documents

HTTP routes chỉ nên:

1. validate request;
2. resolve permission;
3. gọi service;
4. map result → response.

Business logic, storage và worker orchestration không nên nằm dày trong route handler.

## Điều kiện

- Không làm đổi behavior ngoài ý muốn.
- Existing tests phải pass.
- Thêm characterization test trước nếu đang refactor code chưa được cover.
- Tránh circular import.
- Không tạo abstraction quá mức.

---

# VII. P2 — GIẢM PYTHON QUALITY DEBT

Kiểm tra các baseline trong:

`scripts/check_python_quality.py`

Đặc biệt:

- BLE001
- S608
- các suppressed Ruff/Bandit warnings.

## BLE001

Giảm `except Exception` không cần thiết.

Thay bằng exception cụ thể.

Nếu thực sự cần broad catch ở boundary:

- log exception đúng cách;
- không swallow lỗi;
- trả error contract chuẩn;
- giữ traceback cần thiết.

## S608 / dynamic SQL

Không được giả định mọi S608 đều là SQL injection.

Phân loại từng trường hợp:

1. SQL hoàn toàn static.
2. Dynamic identifier an toàn.
3. Dynamic values nhưng parameterized.
4. Dynamic SQL nguy hiểm.

Sửa các trường hợp 3/4 bằng:

- parameterized queries;
- safe identifier composition;
- whitelist table/column names.

Không suppress hàng loạt S608.

Sau khi sửa:

- hạ ratchet baseline;
- CI phải ngăn số warning tăng trở lại.

---

# VIII. P2 — FRONTEND TECHNICAL DEBT

Kiểm tra:

- raw color;
- `!important`;
- runtime inline style;
- direct state mutation;
- cyclomatic complexity;
- duplicated components;
- API state management.

Nếu scripts hiện đang có baseline kiểu:

- nhiều `!important`;
- raw color;
- runtime style;
- direct state writes;

hãy tiếp tục mô hình **ratchet**, nhưng giảm debt thật.

## Yêu cầu

### Design tokens

Chuẩn hóa:

- colors;
- spacing;
- radius;
- typography;
- z-index;
- elevation;
- transitions.

Code mới không được thêm raw hex/rgb tùy tiện.

### Runtime style

Giảm:

- `element.style.*`
- runtime style manipulation

nếu có thể thay bằng:

- class;
- data attribute;
- component state;
- CSS variable.

### State mutation

Giảm direct mutation kiểu:

`model.state.foo = ...`

nếu architecture hiện tại cho phép chuyển sang:

- action;
- command;
- reducer;
- controlled update method.

Không rewrite toàn bộ frontend sang framework khác.

### Complexity

Nếu ESLint complexity threshold đang rất cao như khoảng 80:

hạ dần:

80 → 50 → 35

và refactor các function vượt mức.

Không hạ threshold trước khi giảm code tương ứng.

---

# IX. P2 — TYPE SAFETY FRONTEND

Nếu frontend hiện vẫn chủ yếu JavaScript:

Không bắt buộc migrate toàn bộ sang TypeScript.

Triển khai incremental:

1. bật `checkJs` nếu phù hợp;
2. bổ sung JSDoc type cho:
   - API DTO;
   - organization;
   - user;
   - billing;
   - invoice;
   - sync operations;
   - package/plan/contract;
3. thêm typecheck vào CI;
4. migrate những module core ít thay đổi sang TypeScript nếu risk thấp.

Đặc biệt kiểm tra mismatch giữa:

- backend response;
- frontend assumptions;
- optional/null values;
- enum/status strings.

Không tạo hàng trăm `any`.

---

# X. P3 — DEPENDENCY HYGIENE

Kiểm tra `package.json`.

Nếu:

- Playwright
- Puppeteer
- test-only tools

đang nằm trong production `dependencies` nhưng không dùng runtime production:

chuyển sang `devDependencies`.

Trước khi chuyển, grep toàn repo để chắc chắn worker/runtime production không cần.

Kiểm tra:

- npm audit;
- Python dependency audit;
- duplicate packages;
- unused dependencies;
- lockfile integrity;
- SBOM/supply-chain workflows.

Không update major version hàng loạt nếu không cần.

---

# XI. P2/P3 — OBSERVABILITY VÀ ALERTING

Rà:

- `backend/observability/**`
- metrics;
- deploy monitoring;
- Prometheus rules;
- health/readiness endpoints.

Nếu application đã expose metrics nhưng alert rule chưa đầy đủ, bổ sung alert cho các tín hiệu quan trọng.

Ít nhất xem xét:

- HTTP 5xx ratio;
- sustained high latency;
- DB pool exhaustion;
- DB connectivity;
- worker queue depth;
- oldest queued job age;
- document processing failure rate;
- document retry storm;
- websocket disconnect/error;
- sync failure/conflict spike;
- audit chain verification failure;
- backup age;
- restore drill failure;
- disk low;
- CPU/memory saturation;
- event loop lag;
- AI provider error/timeout;
- billing webhook failure;
- unusual authentication failure spike.

Alert phải:

- có `for:` hợp lý;
- tránh flapping;
- severity rõ ràng;
- có annotation đủ để vận hành.

Không tạo alert cho metric không tồn tại.

Nếu thiếu metric quan trọng, bổ sung metric trước.

---

# XII. SECURITY REVIEW BỔ SUNG

Trong khi làm các mục trên, rà thêm:

## Authentication

- login brute force;
- password reset token;
- session fixation;
- logout invalidation;
- CSRF;
- cookie flags;
- SameSite;
- session expiry;
- privilege elevation.

## Authorization

Tìm mọi endpoint có:

- `/{id}`
- document ID
- contract ID
- package ID
- plan ID
- invoice ID
- user ID

và xác nhận authorization **không chỉ dựa vào object ID** mà có organization/user scope.

Tìm IDOR.

## Billing/webhook

Nếu có payment webhook:

- verify signature;
- replay protection;
- idempotency;
- amount/currency check;
- order mapping;
- event timestamp;
- duplicate webhook;
- out-of-order webhook.

Client không bao giờ được tự quyết định trạng thái thanh toán thành công.

## Admin/env

Nếu dashboard/admin có chức năng cấu hình env:

- không bao giờ trả raw secret về frontend;
- secret đã lưu chỉ hiển thị masked;
- phân quyền platform admin;
- audit every change;
- CSRF/re-auth nếu phù hợp;
- allowlist những variable được phép sửa;
- chặn arbitrary environment injection.

## Logging

Không log:

- password;
- reset token;
- session cookie;
- API key;
- full card/payment token;
- secret environment values.

---

# XIII. DATABASE / TRANSACTION REVIEW

Rà các nghiệp vụ:

- Kế hoạch;
- Gói thầu;
- Lô;
- Nhà thầu;
- Hợp đồng;
- hóa đơn;
- subscription;
- document;
- organization membership;
- sync/outbox.

Tìm:

- race condition;
- check-then-act;
- lost update;
- duplicate record;
- missing unique constraint;
- missing FK;
- missing transaction;
- N+1;
- unbounded query;
- pagination issue;
- timezone bug;
- soft-delete inconsistency.

Ưu tiên enforce invariant ở DB khi có thể:

- FK;
- UNIQUE;
- CHECK;
- transaction.

Không dựa hoàn toàn vào frontend validation.

---

# XIV. PERFORMANCE

Không micro-optimize vô căn cứ.

Kiểm tra dựa trên code/query thực tế:

- N+1;
- query gọi trong loop;
- missing index;
- unbounded SELECT;
- expensive dashboard query;
- large JSON payload;
- synchronous blocking I/O trong async route;
- repeated file stat/read;
- excessive frontend rerender;
- duplicated API requests.

Nếu thêm index:

- chứng minh query sử dụng cột đó;
- thêm migration đúng chuẩn;
- xem xét write overhead.

---

# XV. TEST MATRIX

Sau sửa phải chạy tối thiểu những gì repo hỗ trợ:

## Backend

- unit tests;
- integration tests;
- PostgreSQL tests;
- migration tests;
- auth/organization tests;
- sync tests;
- document worker tests;
- AI tests;
- billing tests nếu có.

## Frontend

- lint;
- typecheck nếu thêm;
- unit tests;
- build production.

## E2E

- Chromium;
- Firefox;
- WebKit nếu CI hiện chạy;
- workflow E2E;
- authentication;
- workspace switching;
- Kế hoạch → Gói thầu → Hợp đồng;
- upload/download;
- role permissions;
- offline/sync;
- billing/admin nếu đã có test framework.

## Security/quality

- Ruff/Bandit hoặc tool hiện dùng;
- CodeQL nếu chạy local được;
- dependency checks;
- gitleaks;
- package integrity;
- frontend debt ratchet;
- Python debt ratchet;
- coverage gate.

Không được coi task hoàn thành nếu các test liên quan đang fail.

---

# XVI. ACCEPTANCE CRITERIA

Task chỉ hoàn thành khi:

### Workspace

- Không còn silent organization selection nguy hiểm khi user thuộc nhiều organization.
- Mutation không thể ghi nhầm organization do thiếu scope.
- Có regression tests đầy đủ.

### Security

- Không tìm thấy cross-org IDOR trong các route đã rà.
- Membership revoke có hiệu lực ngay ở request sau phù hợp kiến trúc.
- AI tool permission được revalidate.
- Redaction che secret/PII embedded trong free-text.
- Không log secret.

### Documents/sync

- Critical workflow có idempotency.
- Có test concurrency/failure.
- Worker retry không tạo duplicate.
- Offline replay không thể ghi vào organization sai.

### Code quality

- Các god module quan trọng đã được giảm độ phức tạp nếu có thể mà không gây rewrite rủi ro.
- Python debt không tăng.
- Frontend debt không tăng và nên giảm.
- Complexity ratchet chặt hơn.

### Coverage

- Critical module coverage tăng rõ rệt.
- Không dùng meaningless tests.
- Coverage gate không giảm.

### Production

- Full build chạy được.
- Deployment config không bị phá.
- Migration registry hợp lệ.
- Monitoring rules hợp lệ.
- CI xanh.

### Evidence bắt buộc

- Branch, HEAD và working tree đã kiểm tra.
- Baseline và kết quả sau thay đổi.
- Từng command/test/workflow đã chạy, exit code và phạm vi kiểm tra.
- Coverage trước/sau trên cùng scope.
- Migration/index/constraint và rollback hoặc recovery strategy nếu có.
- Alert/monitoring rule đã parse/lint và chỉ tham chiếu metric tồn tại.
- Các phần chưa chạy hoặc chưa xác minh, cùng lý do kỹ thuật, không được tuyên bố là đã hoàn thành.

### Business-contract verification

Phải xác nhận riêng rằng thay đổi không làm đổi ngoài ý muốn tenant isolation, module permission, assignment/record scope, role/capability, dữ liệu người dùng được phép đọc, API response shape và ranh giới masking/redaction.

---

# XVII. CÁCH THỰC HIỆN

Thực hiện theo từng phase để tránh một mega-refactor:

## Phase 1 — Safety

- active organization;
- cross-org authorization;
- AI redaction;
- critical race conditions;
- document/sync correctness.

## Phase 2 — Tests

- characterization tests;
- integration tests;
- concurrency tests;
- coverage increase.

## Phase 3 — Refactor

- backend god modules;
- state/style frontend debt;
- type safety.

## Phase 4 — Operations

- dependencies;
- metrics;
- alerting;
- documentation.

Sau mỗi phase:

- chạy test liên quan;
- sửa regression ngay.

---

# XVIII. KHÔNG ĐƯỢC LÀM

Không:

- rewrite toàn bộ project;
- đổi framework chỉ vì sở thích;
- đổi DB engine;
- phá API hiện có;
- bỏ backward compatibility không cần thiết;
- xóa feature đang hoạt động;
- disable test;
- giảm coverage threshold;
- giảm security check;
- disable CI check;
- dùng `try/except Exception: pass`;
- suppress lint hàng loạt;
- dùng `any` hàng loạt;
- hardcode secret;
- ghi secret vào log;
- thêm package mới nếu stdlib/current dependency xử lý được;
- thêm abstraction không có giá trị thực tế.

---

# XIX. OUTPUT CUỐI CÙNG

Sau khi sửa xong, hãy trả về báo cáo theo format:

## 1. Executive summary

- tổng số vấn đề kiểm tra;
- số vấn đề xác nhận;
- số vấn đề đã sửa;
- vấn đề nào hóa ra không còn tồn tại trên code mới.

## 2. Changes

Bảng:

| Priority | Issue | Root cause | Files changed | Fix | Tests |
|---|---|---|---|---|---|

## 3. Security

Liệt kê:

- organization isolation;
- authorization;
- AI;
- secrets;
- billing;
- documents.

## 4. Coverage

Cho biết coverage trước/sau theo critical module.

## 5. Refactor

Cho biết:

- module nào được tách;
- lý do;
- behavior được giữ nguyên bằng test nào.

## 6. Database changes

Liệt kê migration/index/constraint nếu có.

## 7. CI verification

Liệt kê từng command/workflow đã chạy và kết quả.

## 8. Remaining issues

Chỉ liệt kê những việc thực sự chưa thể giải quyết trong patch hiện tại, nêu rõ lý do kỹ thuật.

## 9. Commit plan

Đề xuất chia commit hợp lý, ví dụ:

1. `fix(auth): fail closed on ambiguous organization scope`
2. `test(core): add lifecycle and cross-org regression coverage`
3. `fix(ai): harden audit payload redaction`
4. `fix(sync): enforce replay scope and idempotency`
5. `refactor(core): split oversized backend services`
6. `refactor(frontend): reduce style and state mutation debt`
7. `chore(observability): expand production alerts`

Không gộp mọi thứ thành một commit nếu có thể tách an toàn.

Không tự tạo commit nếu chưa được yêu cầu; mục này chỉ là đề xuất phân ranh giới commit.

## 10. Evidence and limitations

- Branch/HEAD/working tree đã kiểm tra.
- Baseline trước thay đổi.
- Commands, exit code, test count và coverage trước/sau.
- Migration/rollback evidence.
- Các kiểm tra không chạy được và lý do.
- Các finding còn `deferred`, `not reproducible` hoặc `unverified`.

## 11. Business-contract verification

Xác nhận riêng việc bảo toàn tenant isolation, module permission, assignment/record scope, role/capability, API response shape và quyền xem đầy đủ dữ liệu của người dùng đã được cấp quyền. Nêu rõ mọi điểm chưa thể xác minh.

---

Mục tiêu cuối cùng không phải chỉ để CI xanh, mà là để repository **an toàn hơn, ít regression hơn, dễ bảo trì hơn và đủ tin cậy cho production nhiều organization/người dùng**.
