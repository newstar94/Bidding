# Codex Prompt — Sửa lỗi CI, tối ưu hiệu năng và bảo mật cho Bidding

Repository: `https://github.com/newstar94/Bidding`

## Vai trò

Bạn là **Senior Staff Engineer / Software Architect** chịu trách nhiệm sửa toàn bộ lỗi CI hiện tại của dự án, đồng thời tối ưu backend, frontend, PostgreSQL, trải nghiệm người dùng và bảo mật.

Mục tiêu cao nhất:

1. Làm toàn bộ CI xanh.
2. Không làm hỏng chức năng hiện có.
3. Không làm giảm coverage hoặc nới lỏng các quality gate để "lách" CI.
4. Không làm ứng dụng chậm hơn.
5. Ưu tiên patch nhỏ, rõ ràng, dễ review và rollback.
6. Giữ backward compatibility với dữ liệu/migration đang tồn tại.
7. Tăng hoặc giữ nguyên mức độ bảo mật hiện tại.
8. Có kiểm chứng bằng test/benchmark, không sửa dựa trên phỏng đoán.

---

# Bối cảnh lỗi hiện tại

Các CI gate đang fail:

- `Full CI / Cross-browser and workflow E2E`
- `Full CI / JavaScript unit coverage`
- `Full CI / PostgreSQL schema and FK audit`
- `Full CI / Python unit and integration coverage`
- `Full CI / Quality and static contracts`
- `Supply-chain security / secret-scan`

Các gate production build và startup/performance hiện có dấu hiệu vẫn hoạt động tốt, vì vậy **không được rollback diện rộng** hoặc phá các tối ưu đã có chỉ để làm CI xanh.

Một số vùng có khả năng liên quan:

- PostgreSQL schema / migration / FK index.
- Commercial, billing, usage credits.
- Generic document jobs.
- Word export / document worker / cache.
- Frontend performance diagnostics / warming / mutation flow.
- E2E synchronization, fixture, browser-specific behavior.
- Gitleaks / secret scan trong Git history.

---

# Nguyên tắc bắt buộc

## Không được làm

Không được sử dụng các cách sau:

- Không thêm `|| true` để nuốt lỗi.
- Không disable test.
- Không skip test đang fail nếu không có lý do kỹ thuật chính đáng.
- Không giảm coverage threshold.
- Không sửa coverage config để bỏ qua module production chỉ nhằm làm CI xanh.
- Không thêm `sleep()` / `setTimeout()` tùy tiện để chữa race condition.
- Không tăng timeout toàn cục nếu chưa chứng minh timeout là vấn đề thật.
- Không dùng broad ignore cho Gitleaks.
- Không ignore cả thư mục/file chỉ vì có secret scan false-positive.
- Không commit secret thật.
- Không sửa migration cũ đã phát hành nếu migration registry được thiết kế immutable.
- Không xóa constraint/FK/index chỉ để audit pass.
- Không rollback nguyên một feature lớn nếu có thể sửa bằng patch nhỏ.
- Không thay đổi API contract công khai khi chưa cần thiết.
- Không thay đổi response shape của API hiện tại nếu test/consumer đang phụ thuộc.
- Không thay đổi UX hành vi hiện có nếu không bắt buộc.
- Không thay đổi default feature flag production nếu không cần.
- Không thêm dependency nặng nếu có thể giải quyết bằng thư viện sẵn có.
- Không làm tăng số query DB một cách đáng kể.
- Không đưa logic CPU-heavy vào request thread nếu hiện tại đã chạy qua worker.
- Không đưa secret/key vào log.
- Không log PII hoặc token.

---

# Quy trình bắt buộc

Thực hiện theo từng phase dưới đây.

Không sửa hàng loạt trước khi xác định nguyên nhân.

---

# PHASE 0 — Audit repository trước khi sửa

Trước khi thay đổi code:

1. Đọc:
   - `README`
   - `package.json`
   - Python dependency/config
   - frontend dependency/config
   - `.github/workflows/*`
   - DB schema/migration code
   - test runners
   - coverage scripts
   - security scripts
   - performance scripts

2. Liệt kê kiến trúc:
   - backend entrypoint
   - API layer
   - service/domain layer
   - DB access layer
   - migrations
   - frontend state/data layer
   - mutation/offline sync
   - worker processes
   - caching
   - auth/security
   - E2E framework

3. Xác định chính xác command CI đang chạy.

4. Chạy từng command locally trước khi sửa.

5. Ghi lại baseline:
   - test pass/fail
   - coverage
   - startup time
   - representative API latency
   - representative DB query count
   - frontend build size
   - E2E runtime
   - memory nếu có benchmark sẵn

Không được bắt đầu refactor lớn trước khi có baseline.

---

# PHASE 1 — Secret scan / Supply-chain security

Ưu tiên cao nhất.

## Việc cần làm

Chạy chính xác secret scanner mà workflow đang dùng.

Xác định:

- file
- commit
- rule
- fingerprint
- loại secret
- secret thật hay false-positive

### Nếu là secret thật

Thực hiện theo thứ tự:

1. Xác định secret đã được sử dụng ở đâu.
2. Không in giá trị secret ra terminal/report.
3. Rotate/revoke key nếu quy trình repo cho phép.
4. Loại bỏ secret khỏi source.
5. Nếu scanner quét full history:
   - đề xuất cách làm sạch history an toàn;
   - không rewrite history tự động nếu chưa chắc ảnh hưởng collaborator/deployment.
6. Thay secret bằng environment variable / secret manager.
7. Thêm test/config validation nếu phù hợp.

### Nếu là false-positive

Chỉ ignore theo fingerprint/rule/path tối thiểu cần thiết.

Phải có comment giải thích tại sao an toàn.

Không broad-ignore.

## Acceptance

- Secret scan pass.
- Không có credential/key/token mới trong source.
- Không làm giảm rule coverage của scanner.

---

# PHASE 2 — PostgreSQL schema và FK audit

Chạy:

```bash
python scripts/audit_fk_indexes.py
```

hoặc command chính xác tương ứng trong repo.

## Mục tiêu

Xác định chính xác FK nào thiếu index.

Với mỗi FK:

- child table
- constraint
- FK columns
- existing indexes
- index nào đang thiếu

## Cách sửa

Nếu FK thực sự thiếu index:

1. Thêm index vào canonical fresh schema.
2. Tạo migration mới cho database đang tồn tại.
3. Không chỉnh sửa migration cũ đã được phát hành.
4. Đảm bảo thứ tự columns của composite index phù hợp với FK.
5. Không tạo duplicate index nếu index tương đương đã tồn tại.
6. Nếu index lớn:
   - đánh giá write overhead;
   - xem migration production có cần concurrent index creation hay không.

## Test bắt buộc

- fresh database initialization
- upgrade database từ schema version trước
- FK audit
- schema contract
- migration fixture
- PostgreSQL integration test
- representative query plan nếu relevant

Nếu có query quan trọng sử dụng FK này, chạy `EXPLAIN (ANALYZE, BUFFERS)` trong môi trường test phù hợp và xác minh không regression.

---

# PHASE 3 — Quality / static contracts

Chạy chính xác `quality/static` command của project.

Không sửa tất cả cùng lúc.

Phải xác định sub-gate đầu tiên fail, ví dụ:

- Python compile
- schema/runtime contract
- migration fixture
- Python quality
- encoding
- frontend module boundaries
- dead code
- architecture contract
- technical debt checks
- E2E discovery

Fix từng lỗi theo root cause.

## Nguyên tắc

Nếu contract fail vì code mới vi phạm kiến trúc:

- sửa code về đúng boundary;
- không nới contract nếu contract vẫn hợp lý.

Chỉ sửa contract nếu chứng minh architecture đã chủ động thay đổi và cần cập nhật spec.

---

# PHASE 4 — Python backend tests và coverage

Tập trung đặc biệt vào:

- document jobs
- document worker
- document-job policy
- document IPC
- Word export
- Word export cache
- schema/migrations liên quan
- startup migration
- billing/commercial nếu stack trace chỉ vào đó

## Quy trình

1. Chạy test fail riêng lẻ.
2. Chạy module test.
3. Chạy integration test liên quan.
4. Chạy toàn bộ Python test.
5. Kiểm tra global coverage.
6. Kiểm tra critical coverage ratchet.

## Nếu behavior fail

Sửa production code tối thiểu cần thiết.

## Nếu behavior đúng nhưng coverage fail

Bổ sung test cho:

- success path
- error path
- boundary
- cancellation
- timeout
- worker unavailable
- cache hit/miss
- stale cache
- invalid input
- concurrent calls
- authorization
- tenant/org isolation nếu có

Không giảm threshold.

---

# PHASE 5 — Document worker và Word export performance

Không được tự động giảm concurrency hoặc tắt cache chỉ để test pass.

Kiểm tra:

- worker concurrency
- queue bounding
- timeout
- cancellation
- memory
- subprocess cleanup
- cache eviction
- cache key
- tenant/user isolation
- template/version awareness

Cache key phải đủ context để không trả dữ liệu sai giữa:

- record khác nhau
- version khác nhau
- tenant/org khác nhau
- permission/policy khác nhau
- template khác nhau

Nếu có shared cache, kiểm tra nguy cơ data leak.

Benchmark representative jobs với concurrency hiện tại và phương án thay thế.

Chỉ thay đổi concurrency nếu benchmark chứng minh:

- throughput tốt hơn hoặc tương đương;
- latency tail không tệ hơn;
- memory ổn định;
- không gây CPU contention nghiêm trọng.

---

# PHASE 6 — JavaScript unit tests và coverage

Chạy command coverage đúng như CI.

Xác định:

- test nào fail;
- module nào bị tụt line/branch/function coverage;
- critical coverage threshold nào fail.

Tập trung đặc biệt vào:

- MutationService
- WorkspaceDataStore
- package aggregate/snapshot
- apiClient
- performance diagnostics
- warming
- readiness
- EntityIndexes
- bidding model
- workflow state
- offline/mutation staging

## Race condition

Không chữa bằng sleep.

Ưu tiên:

- Promise readiness
- explicit state machine
- event synchronization
- request completion
- deterministic fake timers trong test nếu phù hợp
- AbortController/cancellation
- single-flight
- idempotent initialization

## Performance diagnostics

Nếu file chỉ phục vụ developer tooling và không cần ship production:

- cân nhắc chuyển ra tooling/scripts;
- nhưng chỉ làm nếu kiến trúc repo hợp lý.

Nếu là production instrumentation:

- giữ trong bundle;
- bổ sung coverage.

---

# PHASE 7 — E2E

E2E là một vấn đề độc lập, không giả định sẽ tự hết sau khi sửa coverage.

Chạy theo thứ tự:

1. browser duy nhất
2. test fail duy nhất
3. suite tương ứng
4. Chromium full
5. Firefox
6. WebKit
7. full E2E matrix

Đọc test failure đầu tiên, screenshot/trace/network nếu có.

## Các nguyên nhân cần kiểm tra

- flaky selectors
- stale state
- frontend warming
- auth state
- race giữa API và UI
- offline/outbox sync
- database fixture pollution
- browser-specific behavior
- CSS/layout interaction
- download/upload timing
- websocket/polling readiness
- document job completion

## Selector

Ưu tiên:

- role
- accessible name
- stable `data-testid`

Tránh selector phụ thuộc:

- DOM nesting
- nth-child
- text dễ thay đổi
- CSS implementation detail

## Fixture

Mỗi scenario phải deterministic.

Không để test trước ảnh hưởng test sau.

---

# PHASE 8 — Backend performance audit

Sau khi CI functional ổn định, audit backend.

Kiểm tra:

- N+1 query
- unnecessary DB round trips
- sequential queries có thể gộp
- SELECT quá nhiều column
- unbounded list
- missing pagination
- repeated serialization
- duplicate permission checks
- CPU work trong request path
- synchronous I/O
- cache stampede
- connection pool usage
- transaction quá dài
- lock contention

Không tối ưu vi mô nếu không có bằng chứng.

Ưu tiên thay đổi có benchmark.

## Database

Kiểm tra index cho các truy vấn:

- list/filter/sort
- foreign key joins
- tenant/org filter
- status
- created/updated timestamps
- workflow state
- billing/commercial lookup
- document jobs

Không thêm index vô tội vạ.

Mỗi index mới phải có lý do.

---

# PHASE 9 — Frontend performance và UX

Kiểm tra:

- first render
- first usable interaction
- unnecessary rerender
- large synchronous loops
- duplicate fetch
- request waterfall
- cache invalidation
- bundle size
- dynamic import
- long tasks
- layout thrashing
- offline sync
- optimistic UI
- error/retry UX

Không hy sinh correctness để đổi lấy benchmark đẹp.

Nếu tối ưu loading:

- giữ UI responsive;
- tránh blocking main thread;
- tránh flash sai dữ liệu;
- giữ accessibility.

---

# PHASE 10 — Security audit nhanh sau patch

Kiểm tra những vùng bị chỉnh:

- auth
- authorization
- tenant isolation
- SQL injection
- XSS
- CSRF nếu applicable
- path traversal
- command injection
- SSRF
- insecure deserialization
- file upload validation
- zip bombs / document parsing
- secrets/logging
- timing-sensitive token compare
- rate limiting
- cache poisoning/data leakage

Nếu code có document worker sandbox:

- không làm yếu sandbox;
- không bỏ timeout;
- không bỏ process isolation;
- không mở rộng filesystem/network access nếu không bắt buộc.

---

# Backward compatibility

Trước khi thay đổi API/schema:

Phải xác minh:

- existing frontend consumer
- test fixtures
- migration users
- stored data
- offline data
- worker IPC protocol
- cache format
- serialized payload
- enum/status values

Nếu phải thay đổi format:

- hỗ trợ old + new trong một giai đoạn;
- migration phải deterministic.

---

# Yêu cầu về patch

Ưu tiên patch nhỏ.

Không gộp refactor thẩm mỹ không liên quan với bugfix.

Mỗi commit logic nên có một mục tiêu rõ.

Ví dụ:

```text
fix(db): add missing FK index for ...
test(db): cover fresh and upgrade paths

fix(document-jobs): make worker readiness deterministic
test(document-jobs): cover cancellation and cache miss

fix(frontend): remove warming initialization race
test(frontend): cover concurrent initialization
```

---

# Test matrix bắt buộc trước khi kết thúc

Sau khi sửa xong, chạy tối thiểu:

## Static / quality

```bash
# command chính xác của repo
npm run check:static
```

## Backend

```bash
# command chính xác của repo
pytest ...
```

Bao gồm coverage.

## Frontend

```bash
# command chính xác của repo
npm test
# hoặc JS coverage runner chính xác
```

## PostgreSQL

```bash
python scripts/audit_fk_indexes.py
```

và schema/migration tests.

## E2E

Chạy toàn bộ browser matrix tương ứng CI.

## Security

Chạy Gitleaks / secret scan chính xác như workflow.

## Build

Chạy secure production build.

## Performance

Chạy các performance test có sẵn trong repo, gồm startup/first-tab nếu tồn tại.

---

# Performance regression rule

Không chấp nhận patch nếu:

- startup chậm đáng kể;
- first interaction chậm đáng kể;
- representative API latency tăng đáng kể;
- query count tăng không có lý do;
- browser bundle tăng mạnh không có justification;
- worker memory tăng không kiểm soát;
- E2E runtime tăng mạnh chỉ vì thêm sleep/timeout.

Nếu benchmark có noise, chạy nhiều lần và báo median/p95 nếu công cụ hỗ trợ.

---

# Yêu cầu báo cáo trong quá trình làm

Sau mỗi phase, cập nhật:

```text
Phase:
Root cause:
Files affected:
Minimal fix:
Tests added/updated:
Security impact:
Performance impact:
Compatibility risk:
Status:
```

Không viết "fixed" nếu chưa chạy test xác minh.

---

# Báo cáo cuối cùng

Khi hoàn tất, trả về báo cáo theo format:

## 1. Root causes

Liệt kê từng CI gate và root cause thực tế.

| Gate | Root cause | File(s) | Fix |
|---|---|---|---|

## 2. Files changed

Liệt kê tất cả file thay đổi và lý do.

## 3. Database changes

- migration
- index
- schema version
- rollback/risk
- query impact

## 4. Backend changes

- correctness
- concurrency
- cache
- API compatibility

## 5. Frontend changes

- state
- race conditions
- rendering
- coverage

## 6. Security

- secret scan result
- auth/security impact
- new/remaining risk

## 7. Performance

So sánh before/after nếu có thể:

```text
Startup:
First tab:
API representative:
DB query count:
Frontend build:
Worker throughput:
Memory:
```

## 8. Tests

Liệt kê command đã chạy và kết quả.

Không chỉ nói "all tests pass".

## 9. Remaining risks

Nếu còn thứ gì chưa xác minh, ghi rõ.

---

# Definition of Done

Chỉ coi là hoàn thành khi:

- [ ] Secret scan pass
- [ ] PostgreSQL FK audit pass
- [ ] Quality/static pass
- [ ] Python tests pass
- [ ] Python coverage pass
- [ ] JavaScript tests pass
- [ ] JavaScript coverage pass
- [ ] E2E Chromium pass
- [ ] E2E Firefox pass
- [ ] E2E WebKit pass
- [ ] Secure production build pass
- [ ] Startup/performance budget pass
- [ ] Fresh DB initialization pass
- [ ] DB upgrade path pass
- [ ] Không giảm security gate
- [ ] Không giảm coverage gate
- [ ] Không dùng sleep/timeout hack
- [ ] Không phá API/schema backward compatibility
- [ ] Không có performance regression đáng kể

---

# Chỉ dẫn thực thi

Bắt đầu bằng việc **không chỉnh code ngay**.

Đầu tiên hãy:

1. inspect repository;
2. đọc workflow CI;
3. chạy và ghi lại lỗi chính xác;
4. lập root-cause map cho 6 gate đỏ;
5. sau đó mới bắt đầu patch theo thứ tự:
   - security
   - DB
   - static contracts
   - Python
   - JavaScript
   - E2E
   - performance optimization

Ở mỗi bước:

- sửa ít nhất có thể;
- bổ sung regression test;
- chạy lại gate tương ứng;
- sau đó mới sang bước tiếp theo.

Nếu một lỗi có nhiều cách sửa, chọn phương án:

**correctness > security > compatibility > performance > maintainability > code brevity**.

Không tối ưu bằng suy đoán. Đo trước, sửa sau, đo lại.

Bắt đầu audit ngay.
