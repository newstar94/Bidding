# CODEX PROMPT — FIX COMMIT `b2e1727`, HARDEN AI QUOTA/AUTH/DOCX, VÀ LÀM TOÀN BỘ CI XANH

Bạn đang làm việc trong repository:

```text
https://github.com/newstar94/Bidding
```

Nhánh mục tiêu:

```text
main
```

Baseline cần kiểm tra trước khi sửa:

```text
b2e1727
feat: Implement token reservation and settlement in quota management
```

## NHIỆM VỤ

Hãy **tự đọc repository hiện tại và GitHub Actions hiện tại trước khi chỉnh sửa**. Không được giả định mã vẫn giống prompt nếu main đã có commit mới.

Mục tiêu cuối cùng:

1. Sửa triệt để các bug/race condition trong commit quota/auth/template mới.
2. Reproduce và sửa root cause toàn bộ GitHub CI đang fail.
3. Bổ sung regression tests đầy đủ.
4. Không làm mất tính năng hiện hữu.
5. Không hạ chuẩn security/coverage/E2E để “làm xanh CI”.
6. Kết thúc bằng báo cáo file thay đổi, test đã chạy và kết quả CI.

---

# 0. QUY TẮC LÀM VIỆC

Trước khi sửa:

```bash
git status
git log -10 --oneline
git show --stat --oneline b2e1727
git show b2e1727
```

Đọc tối thiểu:

```text
AGENTS.md
CONTEXT.md
README.md
pyproject.toml
package.json
playwright.config.mjs
.github/workflows/**
```

và các file:

```text
backend/ai/quota_service.py
backend/ai/service.py
backend/ai/configuration.py
backend/ai/types.py
backend/auth/auth_routes.py
backend/auth/session_store.py
backend/documents/template_security.py
backend/db/**
tests/**
e2e/**
```

Nếu GitHub CLI khả dụng:

```bash
gh run list --branch main --limit 30
gh run view <RUN_ID>
gh run view <RUN_ID> --log-failed
```

Phải ghi lại chính xác:

- workflow;
- job;
- step;
- command;
- error đầu tiên;
- file/line liên quan.

**Không sửa CI bằng cách:**

- `continue-on-error: true`;
- xóa/skip test;
- giảm coverage threshold;
- bỏ Firefox/WebKit;
- tăng timeout vô hạn;
- comment security scan;
- ignore secret toàn repo/thư mục;
- sửa test expectation sai với business rule chỉ để pass;
- retry vô điều kiện để che race/flaky bug.

---

# 1. P0 — FIX FIRST-ROW TOKEN QUOTA BYPASS

File hiện liên quan:

```text
backend/ai/quota_service.py
```

Hiện `reserve_tokens()` có dạng logic:

```sql
INSERT ...
VALUES (... amount ...)
ON CONFLICT (...) DO UPDATE ...
WHERE current + amount <= limit
RETURNING ...
```

Bug: `WHERE` của `DO UPDATE` không bảo vệ nhánh INSERT. Nếu chưa có `ai_usage_daily` row và `amount > daily_token_limit`, insert đầu tiên có thể vượt quota.

## Yêu cầu

Thiết kế SQL/transaction sao cho invariant sau đúng cả INSERT và UPDATE:

```text
actual_input_tokens
+ actual_output_tokens
+ active_reserved_tokens
<= daily_token_limit
```

Nếu chưa tách reserved riêng thì vẫn phải bảo đảm logic tương đương.

Thêm test:

```text
first reservation < limit
first reservation == limit
first reservation > limit => reject
```

Không được chỉ sửa UI/API response.

---

# 2. P0 — RESERVATION LIFECYCLE KHÔNG ĐƯỢC LEAK

Hiện `backend/ai/service.py` reserve trước provider execution và settlement chủ yếu ở success + `except AiError`.

Phải xử lý mọi đường thoát:

- `AiError`
- `RuntimeError`
- DB error
- provider timeout
- tool error
- generator close
- client disconnect
- cancellation
- unexpected exception

## Yêu cầu kiến trúc

Ưu tiên model:

```python
reservation = await reserve_token_budget(...)
settled = False

try:
    ...
    await settle_token_reservation(reservation, actual_input, actual_output)
    settled = True
finally:
    if not settled:
        await release_token_reservation(reservation)
```

Nếu cancellation có thể hủy cleanup, triển khai cancellation-safe cleanup phù hợp, ví dụ cleanup ngắn có kiểm soát; không tạo task orphan.

Release/settle phải:

- idempotent;
- không double charge;
- không làm số reserved âm;
- có metric khi state transition bất hợp lệ.

---

# 3. P0 — FIX CROSS-MIDNIGHT BUG

Không được gọi `_usage_date()` độc lập ở reserve và settle để xác định cùng reservation.

Reserve phải trả về context ít nhất:

```python
@dataclass(frozen=True)
class TokenReservation:
    id: str | ...
    usage_date: str
    organization_id: ...
    user_id: ...
    reserved_tokens: int
```

Settlement/release phải dùng `reservation.usage_date`.

Test bắt buộc:

```text
reserve 23:59:59
settle 00:00:01
```

và xác nhận usage của ngày reserve được cập nhật chính xác.

Dùng injected clock/time provider trong test nếu phù hợp, không sleep thật qua midnight.

---

# 4. P1 — TÁCH RESERVED TOKENS KHỎI INPUT TOKENS

Thiết kế hiện tại dùng `input_tokens` để chứa reservation rồi cộng delta khi settle. Điều này làm semantics khó kiểm chứng.

Ưu tiên schema rõ ràng:

```text
ai_usage_daily:
    input_tokens
    output_tokens
    reserved_tokens
```

Invariant:

```text
input_tokens >= 0
output_tokens >= 0
reserved_tokens >= 0

input_tokens + output_tokens + reserved_tokens <= hard_limit
```

Reserve:

```text
reserved_tokens += estimate
```

Settle:

```text
reserved_tokens -= estimate
input_tokens += actual_input
output_tokens += actual_output
```

Release:

```text
reserved_tokens -= estimate
```

Nếu migration mới cần thiết:

- dùng cơ chế migration hiện có của repo;
- không sửa migration đã phát hành;
- backward-compatible deployment nếu project yêu cầu;
- thêm constraint/index cần thiết.

Nếu quyết định không đổi schema, phải giải thích rõ vì sao invariant vẫn dễ chứng minh và test.

---

# 5. P1 — IDEMPOTENT RESERVATION/SETTLEMENT

Nếu architecture hiện tại cho phép, thêm reservation ledger:

```text
ai_token_reservations
id
usage_date
organization_id
user_id
reserved_tokens
actual_input_tokens
actual_output_tokens
status
created_at
settled_at
```

Các state:

```text
reserved -> settled
reserved -> released
```

Không cho:

```text
settled -> settled
released -> settled
released -> released charge
```

Nếu không thêm table, tạo idempotency mechanism tương đương.

Test:

- settle hai lần;
- release hai lần;
- settle rồi release;
- retry request;
- concurrent settlement.

---

# 6. P1 — TOKEN ESTIMATION PHẢI PHẢN ÁNH REQUEST THẬT

Không gọi:

```python
len(content) // 4 + max_output_tokens
```

là “worst case” nếu chưa tính các phần khác.

Tạo helper rõ ràng, ví dụ:

```python
estimate_request_token_budget(...)
```

Tính/ước lượng:

- current user content;
- history;
- system/policy instructions;
- workspace context;
- retrieved knowledge;
- legal/web search context nếu có;
- tool schemas;
- expected tool outputs hoặc safety allocation;
- max output tokens;
- safety margin;
- provider tokenizer nếu khả dụng.

Nếu exact tokenization chưa khả thi, dùng conservative upper bound và document assumptions.

---

# 7. P0 — FIX PASSWORD REHASH RACE

Các file:

```text
backend/auth/auth_routes.py
backend/auth/session_store.py
```

Hiện `_commit_successful_login()` có thể update replacement hash trước khi `replace_user_session()` lock row.

Race cần loại bỏ:

```text
A verify H1
B password change -> H2
A rehash update by id -> H1'
A lock/check
```

A không được phép ghi đè H2.

## Phương án ưu tiên

### Option A — lock trước

Trong cùng transaction:

```sql
SELECT id, mat_khau, trang_thai
FROM tai_khoan
WHERE id=?
FOR UPDATE
```

Sau đó:

1. account active;
2. current hash == hash đã verify;
3. nếu rehash thì update;
4. revoke old sessions;
5. create new session;
6. commit.

### Option B — CAS

```sql
UPDATE tai_khoan
SET mat_khau = :replacement
WHERE id=:id
  AND mat_khau=:verified_hash
  AND trang_thai='active'
RETURNING id
```

rowcount != 1 => abort login với credential-changed error.

Không được update chỉ theo `id`.

## Test concurrency

- password change commits between verify and login commit;
- login commit first;
- account disabled between verify and commit;
- two simultaneous login attempts;
- Google login vs password login nếu dùng cùng session invariant.

---

# 8. DOCX/JINJA SECURITY

File:

```text
backend/documents/template_security.py
```

Commit bật:

```python
autoescape=True
```

Giữ mục tiêu chống XML injection nhưng phải chứng minh không phá DOCX.

Thêm fixture/test:

Payloads:

```text
A & B
<abc>
"</w:t><w:r><w:t>INJECTED
{{ variable }}
Vietnamese Unicode
newline
tab
```

Kiểm tra:

- render thành text hợp lệ;
- XML parse được;
- không tạo node XML trái phép;
- không double escape;
- loops/conditions vẫn hoạt động;
- whitelist filters hoạt động;
- StrictUndefined vẫn đúng;
- các template thực tế quan trọng vẫn render.

Nếu `autoescape=True` toàn cục không tương thích với docxtpl, triển khai escaping đúng layer thay vì tắt security.

---

# 9. GITHUB CI — PHẢI LẤY LOG THẬT

Trạng thái cần điều tra trên baseline gồm các nhóm:

```text
Full CI
- Quality and static contracts
- Python unit and integration coverage
- Cross-browser and workflow E2E

Supply-chain security
- secret-scan
```

Các workflow khác cần giữ pass, gồm CodeQL và N+1 regression nếu vẫn tồn tại trên main.

## Quy trình

Với mỗi failing job:

1. `gh run view --log-failed`
2. copy error đầu tiên vào notes
3. reproduce local bằng đúng command
4. fix source/root cause
5. chạy lại riêng command
6. chạy nhóm test liên quan
7. cuối cùng chạy full suite

---

# 10. QUALITY / STATIC CONTRACTS

Chạy đúng lệnh trong workflow.

Nếu có:

```text
ruff / formatter
eslint
type checks
schema contracts
dependency boundaries
generated artifact check
security lint
```

thì sửa source tương ứng.

Không thêm noqa/ignore rộng nếu có thể sửa code.

Mọi suppression mới phải:

- scope nhỏ nhất;
- có comment lý do;
- không che security defect.

---

# 11. PYTHON UNIT + INTEGRATION COVERAGE

Bổ sung tests cho toàn bộ bug trong prompt.

Tập trung tìm test suite hiện có thay vì tạo test framework song song.

Phải chạy ít nhất:

```bash
python -m compileall -q backend scripts tests
python -m pytest -q
```

và command coverage chính xác từ workflow.

Không giảm threshold.

---

# 12. CROSS-BROWSER / WORKFLOW E2E

Đọc:

```text
playwright.config.mjs
e2e/specs/**
package.json
.github/workflows/**
```

Reproduce từng browser/config.

Phải phân biệt:

- Chromium-only bug;
- Firefox-only bug;
- WebKit-only bug;
- fixture race;
- auth/session race;
- test isolation;
- service readiness;
- IndexedDB/localStorage/outbox state leak;
- timezone;
- network timing.

Không chữa bằng sleep tùy tiện.

Dùng:

```text
locator assertions
response/event wait
server readiness
deterministic fixture reset
unique test data
```

Nếu test fail do race thật trong app, sửa app.

---

# 13. SECRET-SCAN

Lấy chính xác:

```text
file
line
rule
severity
redacted fingerprint
```

Nếu secret thật:

- remove;
- rotate/revoke;
- dùng GitHub Secret/secret manager;
- update docs/example bằng placeholder;
- nếu public history cần xử lý, ghi rõ.

Nếu false positive:

- allowlist/baseline fingerprint cụ thể nhất;
- giải thích comment;
- không ignore cả directory;
- không `--no-fail` để né gate.

Không in secret đầy đủ trong log hoặc commit message.

---

# 14. REGRESSION TEST MATRIX BẮT BUỘC

## AI quota

```text
1. first reserve < limit
2. first reserve == limit
3. first reserve > limit
4. existing + reserve == limit
5. existing + reserve > limit
6. concurrent reservations cannot exceed hard limit
7. actual < reserved
8. actual == reserved
9. actual > reserved according to explicit policy
10. AiError releases
11. RuntimeError releases
12. cancellation releases
13. client disconnect releases if applicable
14. cross-midnight settle
15. settle twice
16. release twice
17. settle after release
18. missing reservation row/state
```

## Auth

```text
19. password change vs login rehash
20. account disabled mid-login
21. concurrent login session invariant
22. password change revokes sessions atomically
```

## DOCX

```text
23. XML injection blocked
24. &, <, > render correctly
25. no double escape
26. loops/conditions
27. allowed filters
28. generated DOCX XML parses
```

---

# 15. OBSERVABILITY

Thêm/duy trì metrics hợp lý:

```text
ai_token_reservations_total
ai_token_reservation_rejections_total
ai_token_reservation_releases_total
ai_token_settlement_failures_total
ai_token_settlement_overage_total
```

Không log:

- prompt content;
- full tokens/keys;
- password/hash;
- session token;
- API key.

Audit chỉ nên chứa identifiers không bí mật + state/error code.

---

# 16. DATABASE / CONCURRENCY

Mọi invariant quota phải đúng với PostgreSQL production, không chỉ SQLite-like wrapper syntax.

Kiểm tra abstraction `database.get_connection()` và SQL dialect adapter của repo.

Test concurrent transaction thực tế nếu test infrastructure hỗ trợ PostgreSQL.

Cần xem xét:

- isolation level;
- row lock;
- atomic UPSERT;
- deadlock order;
- retry policy;
- statement timeout.

Không tạo read-check-write race:

```python
SELECT current
if current < limit:
    UPDATE ...
```

trừ khi row được lock trong transaction phù hợp.

---

# 17. COMPATIBILITY

Không phá:

- API response hiện tại;
- existing AI chat behavior;
- request quota;
- tool-call accounting;
- metrics;
- single-session invariant;
- password change;
- Google/OAuth login;
- document templates;
- migrations;
- offline sync;
- role authorization.

Nếu đổi schema/API internal, update tất cả call sites và tests.

---

# 18. LỆNH KIỂM TRA CUỐI

Lấy command chính xác từ repo/workflows. Tối thiểu dự kiến:

```bash
python -m compileall -q backend scripts tests
python -m pytest -q

node --test tests/js/*.test.mjs

npm run lint:security
npm run audit:vendor
npm run build:secure
npm run package:production
```

Sau đó các E2E mà repo định nghĩa, ví dụ:

```bash
npm run test:auth-shell
npm run test:auth-roles-e2e
npm run test:offline-sync-e2e
npm run test:multi-assignee-e2e
npm run test:joint-venture-e2e
npm run test:lifecycle
```

Và mọi command khác trong Full CI hiện tại.

Nếu workflow có matrix browsers, chạy đủ Chromium/Firefox/WebKit tương ứng.

---

# 19. DEFINITION OF DONE

Không kết luận hoàn tất nếu chưa đạt tất cả:

```text
[ ] first-row quota bypass fixed
[ ] reservations cannot leak on exceptions/cancellation
[ ] cross-midnight fixed
[ ] settlement/release idempotent
[ ] hard quota invariant proven by tests
[ ] password rehash race fixed
[ ] DOCX XML injection test passes
[ ] no DOCX double escaping regression
[ ] Python unit/integration pass
[ ] Python coverage gate pass
[ ] JS tests pass
[ ] quality/static contracts pass
[ ] build/package pass
[ ] cross-browser E2E pass
[ ] secret-scan pass
[ ] CodeQL pass
[ ] N+1 regression pass
[ ] all required GitHub checks green
[ ] no CI gate weakened
```

---

# 20. OUTPUT BẮT BUỘC CỦA CODEX

Khi hoàn tất, trả về:

## A. Root causes

Bảng:

```text
Severity | Area | Root cause | File/function | Fix
```

## B. Files changed

Cho từng file:

```text
path
what changed
why
```

## C. Migrations

Nếu có:

```text
migration version
forward behavior
rollback/compatibility notes
```

## D. Tests added

Liệt kê test name + bug được khóa.

## E. Commands executed

Không nói chung chung. Ghi command và:

```text
PASS / FAIL
```

## F. GitHub Actions

Liệt kê:

```text
workflow
job
previous failure
fix
final status
run URL/ID nếu có
```

## G. Remaining risks

Nếu còn thứ chưa verify được, nêu rõ. Không tự nhận “all green” nếu chưa chạy/quan sát được.

---

# 21. NGUYÊN TẮC ƯU TIÊN

Thứ tự:

```text
1. correctness / data integrity
2. security
3. concurrency safety
4. CI root cause
5. backward compatibility
6. performance
7. cleanup/refactor
```

Không thực hiện refactor lớn ngoài phạm vi nếu làm tăng rủi ro. Tuy nhiên nếu cần tách reservation state/ledger để chứng minh invariant và idempotency thì được phép thực hiện có migration + tests đầy đủ.
