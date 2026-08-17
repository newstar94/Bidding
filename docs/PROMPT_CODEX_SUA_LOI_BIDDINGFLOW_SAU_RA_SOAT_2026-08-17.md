# PROMPT CHO CODEX — SỬA TOÀN DIỆN CÁC LỖI CÒN TỒN TẠI SAU ĐỢT RÀ SOÁT BIDDINGFLOW

## 0. Vai trò và mục tiêu

Bạn là kỹ sư phần mềm senior chịu trách nhiệm trực tiếp sửa repository:

- Repository: `https://github.com/newstar94/Bidding`
- Nhánh mục tiêu: `main`
- HEAD tại thời điểm rà soát: `6068325e4b1baf3794a2daa77231904ac0c6d47d`
- Tuy nhiên **KHÔNG được giả định HEAD vẫn giữ nguyên**. Trước khi sửa phải fetch/pull và xác nhận code mới nhất.
- Nếu HEAD đã thay đổi, phải đối chiếu lại các phát hiện dưới đây với code hiện tại rồi chỉ sửa những lỗi còn tồn tại.

Mục tiêu chính:

1. Làm `Full CI` xanh thực chất.
2. Sửa root cause, không sửa test chỉ để qua CI.
3. Sửa lỗi artifact boundary giữa build → package/performance/E2E.
4. Làm production frontend fail-fast khi artifact Vite không hợp lệ.
5. Xử lý toàn bộ JavaScript unit/coverage failures đúng bản chất.
6. Sau khi P0 xanh mới xử lý các chênh lệch semantic còn lại giữa frontend/backend.
7. Không làm regression các phần đã sửa tốt: Excel HSDT, MuaSamCong opening, RBAC, workspace, PostgreSQL/FK, secure build.

---

# 1. Quy tắc bắt buộc

## 1.1. Đọc repo trước khi sửa

Trước tiên phải đọc ít nhất:

- `AGENTS.md`
- `CONTEXT.md`
- `.github/workflows/ci.yml`
- `package.json`
- `vite.config.js`
- `playwright.config.mjs`
- `backend/app.py`
- `scripts/package_production.py`
- `scripts/run_js_coverage.mjs`
- `scripts/check_js_critical_coverage.mjs`
- `tests/test_test_dependencies.py`
- các test JS đang fail
- các file runtime liên quan trực tiếp tới những test fail

Nếu repo có thêm `AGENTS.md`/`CONTEXT.md` ở thư mục con thì tuân thủ.

## 1.2. Không được làm các cách “lách CI”

CẤM:

- giảm coverage threshold;
- giảm performance budget chỉ để CI xanh;
- thêm `test.skip`, `.skip`, `xfail` cho lỗi thực tế;
- xóa test;
- loại file quan trọng khỏi coverage;
- nới lỏng validation production;
- đổi assertion sang giá trị hiện tại chỉ vì code đang trả về như vậy;
- tắt browser Firefox/WebKit;
- chỉ chạy Chromium rồi tuyên bố E2E đã pass;
- bỏ production package smoke test;
- tắt secure build;
- bỏ `.vite/manifest.json` khỏi production validation;
- thay đổi business rule chỉ để test pass;
- rollback kiến trúc CI đã tách thành nhiều job độc lập.

Nếu một test thực sự stale vì UX/business requirement đã chủ động thay đổi, phải:

1. chứng minh hành vi mới là hành vi đúng;
2. sửa implementation contract nếu cần;
3. cập nhật test theo hành vi đúng;
4. ghi rõ lý do trong báo cáo cuối.

## 1.3. Không làm đại refactor khi P0 chưa xanh

Thứ tự bắt buộc:

```text
P0 artifact/manifest
→ P0 production asset runtime
→ P0 JS unit/coverage
→ rerun package/performance/E2E
→ xử lý root cause còn lại
→ Full CI xanh
→ mới làm P1 semantic/refactor
```

Không được vừa sửa CI vừa rewrite toàn bộ frontend/backend.

---

# 2. Baseline bắt buộc trước khi thay đổi

Thực hiện và lưu kết quả:

```bash
git status
git rev-parse HEAD
git log -5 --oneline
```

Nếu working tree không sạch:

- không được xóa thay đổi của người dùng;
- không được `git reset --hard`;
- phân biệt rõ code có sẵn với thay đổi của nhiệm vụ này.

Sau đó chạy các gate khả dụng ở môi trường hiện tại:

```bash
npm ci
npm run check:static
npm run test:js:coverage
```

Nếu PostgreSQL/test environment đã sẵn sàng:

```bash
python -m pytest -q
```

Ghi lại chính xác failure trước khi sửa.

---

# 3. P0-1 — SỬA ARTIFACT BOUNDARY LÀM MẤT VITE MANIFEST

## 3.1. Root cause cần kiểm chứng

Hiện secure build tạo Vite manifest trong:

```text
dist/.vite/manifest.json
```

`vite.config.js` dùng:

```js
build: {
  manifest: true,
  outDir: "dist",
  ...
}
```

Trong Full CI, build job upload:

```yaml
path: dist/
```

nhưng `actions/upload-artifact` mặc định không include hidden files.

`.vite` là hidden directory.

Các job:

- `e2e`
- `performance`
- `package`

download lại secure build artifact.

Trong khi `scripts/package_production.py` yêu cầu:

```text
dist/.vite/manifest.json
```

phải tồn tại.

Phải kiểm chứng root cause này bằng code hiện tại và, nếu có thể, GitHub Actions diagnostics.

## 3.2. Sửa workflow

Trong `.github/workflows/ci.yml`, secure build artifact phải include hidden files.

Ví dụ:

```yaml
- name: Upload secure build for dependent gates
  uses: actions/upload-artifact@<PINNED_SHA>
  with:
    name: biddingflow-secure-build-${{ github.sha }}
    path: dist/
    include-hidden-files: true
    if-no-files-found: error
    retention-days: 1
```

Không đổi pin action sang tag nổi nếu repo đang pin SHA.

## 3.3. Verify artifact ngay sau restore

Sau mỗi bước:

```yaml
- name: Restore verified secure build
```

ở các job:

- `e2e`
- `performance`
- `package`

thêm validation rõ ràng.

Ít nhất phải kiểm tra:

```bash
test -f dist/.vite/manifest.json
test -f dist/secure-build.json
```

Nên có script dùng chung nếu việc lặp lại bắt đầu lớn.

Có thể thêm kiểm tra JSON parse:

```bash
python - <<'PY'
import json
from pathlib import Path

manifest = Path("dist/.vite/manifest.json")
secure = Path("dist/secure-build.json")

assert manifest.is_file(), manifest
assert secure.is_file(), secure
assert isinstance(json.loads(manifest.read_text("utf-8")), dict)
assert isinstance(json.loads(secure.read_text("utf-8")), dict)
PY
```

Không được chỉ kiểm tra thư mục `dist/` tồn tại.

## 3.4. Khóa regression bằng test

Cập nhật `tests/test_test_dependencies.py` hoặc tạo test phù hợp để đảm bảo:

1. build artifact có:

```yaml
include-hidden-files: true
```

2. `e2e`, `performance`, `package` đều verify:

```text
dist/.vite/manifest.json
```

sau restore.

Test phải đọc workflow như contract, không phụ thuộc formatting YAML không cần thiết.

## 3.5. Acceptance criteria P0-1

- `build:secure` vẫn pass.
- artifact chứa `.vite/manifest.json`.
- `package`, `performance`, `e2e` không fail chỉ vì manifest bị thất lạc ở artifact handoff.
- regression test tồn tại.

---

# 4. P0-2 — PRODUCTION FRONTEND PHẢI FAIL-FAST KHI MANIFEST/ENTRY KHÔNG HỢP LỆ

## 4.1. Vấn đề

Hiện `backend/app.py` có logic đọc Vite manifest nhưng còn fallback kiểu:

```text
/dist/assets/appbundle.js
```

Trong khi build hiện tại dùng hashed assets:

```text
assets/[name]-[hash].js
assets/[name]-[hash].css
```

Nếu production manifest mất/hỏng hoặc entry không tồn tại, server không được trả một HTML có script URL fallback đã lỗi/404.

## 4.2. Yêu cầu hành vi

### Development/test

Có thể giữ fallback hợp lý để developer chạy source trực tiếp nếu đây là contract hiện hành.

### Production

Nếu một trong các điều kiện sau xảy ra:

- `dist/.vite/manifest.json` không tồn tại;
- manifest JSON invalid;
- manifest không phải object hợp lệ;
- entry `frontend/app/app.js` không tồn tại;
- entry không có `file`;
- referenced JS/CSS asset không tồn tại;
- đường dẫn asset escape khỏi `dist`;
- secure build marker không hợp lệ khi production yêu cầu secure assets;

thì application phải **fail closed/fail-fast**.

Không được:

```text
manifest lỗi
→ fallback appbundle.js
→ HTTP 200 HTML
→ browser 404 JS
```

## 4.3. Tách helper asset resolver

Ưu tiên tạo module nhỏ, ví dụ:

```text
backend/frontend_assets.py
```

với các hàm có trách nhiệm rõ:

```python
load_frontend_manifest(...)
resolve_frontend_entry(...)
resolve_frontend_styles(...)
resolve_preload_graph(...)
validate_frontend_asset_path(...)
assert_production_frontend_ready(...)
```

Không bắt buộc đúng tên trên, nhưng phải:

- tránh lặp manifest parsing nhiều nơi;
- test được độc lập;
- không kéo toàn bộ `backend.app` vào unit test.

Sau đó `backend/app.py` dùng helper này cho:

- HTML compilation;
- stylesheet resolution;
- preload;
- asset prewarm;
- readiness/startup validation nếu phù hợp.

## 4.4. Security

Mọi manifest path phải:

- resolve dưới `dist/`;
- chống `../`;
- không trust raw path từ JSON;
- production không dùng un-hashed unexpected file nếu contract yêu cầu hashed assets.

Không làm yếu `scripts/package_production.py`.

## 4.5. Tests

Thêm tests cho ít nhất:

1. valid manifest → resolve đúng hashed app asset;
2. missing manifest trong production → fail;
3. malformed JSON → fail;
4. missing app entry → fail;
5. referenced asset missing → fail;
6. path traversal asset → fail;
7. dev behavior vẫn đúng theo contract hiện tại;
8. production HTML không sinh `/dist/assets/appbundle.js` khi manifest invalid.

## 4.6. Acceptance criteria P0-2

Production không thể “boot xanh nhưng frontend chết âm thầm vì asset 404”.

---

# 5. P0-3 — TRIAGE VÀ SỬA TOÀN BỘ JAVASCRIPT UNIT/COVERAGE FAILURES

## 5.1. Chạy canonical gate

Bắt buộc:

```bash
npm run test:js:coverage
```

Không chỉ chạy `node --test` tùy ý vì canonical gate còn critical-module ratchet.

Hiện runner có coverage floor tổng thể và critical coverage riêng. Không hạ các ngưỡng này.

## 5.2. Lập bảng triage nội bộ

Với từng test fail, phân loại:

```text
A. Runtime/code regression
B. Accessibility regression
C. Intentional UX/business change + stale test
D. Brittle/source-text/CSS-regex test cần chuyển sang behavior contract
E. Test infrastructure/environment issue
```

Không được gộp mọi lỗi thành “test stale”.

## 5.3. Quy tắc sửa theo loại

### A — Code regression

Sửa implementation.

### B — Accessibility regression

Giữ requirement, sửa UI:

- keyboard;
- focus;
- aria;
- labels;
- hit targets;
- visible focus;
- mobile/responsive usability.

### C — Intentional change

Chỉ cập nhật test khi có evidence code/domain mới thực sự là requirement đúng.

### D — Brittle test

Nếu test đang đọc CSS/source bằng regex mà mục tiêu thực tế là hành vi UI:

- chuyển sang test behavior/DOM/computed contract phù hợp;
- vẫn giữ guard nếu source-level contract có lý do bảo mật/build rõ ràng.

### E — Infrastructure

Sửa harness/mocks/setup mà không che lỗi runtime.

## 5.4. Các vùng cần kiểm tra kỹ

Từ failure hiện tại, chú ý:

- assistant/chat UI;
- custom select;
- keyboard navigation;
- package detail;
- detailed evaluation table;
- responsive forms;
- dashboard layout;
- table scrolling;
- datepicker;
- validation states;
- bidder goods;
- accessibility/focus.

Không mặc định tất cả các vùng trên đều có bug; phải đọc test failure thực tế.

## 5.5. Coverage

Nếu coverage fail:

- viết test có ý nghĩa cho critical paths;
- không thêm test vô nghĩa chỉ gọi hàm để tăng số %;
- không exclude module critical;
- không hạ threshold.

Critical modules phải có happy path + error/boundary path tương xứng.

## 5.6. Acceptance criteria P0-3

```bash
npm run test:js:coverage
```

pass hoàn toàn với ngưỡng hiện tại.

---

# 6. P0-4 — RERUN PACKAGE / PERFORMANCE / E2E SAU KHI SỬA ARTIFACT

Không được sửa cả 3 gate trước khi xác minh chúng có cùng root cause artifact.

Sau P0-1 và P0-2:

## 6.1. Production package

Chạy theo đúng môi trường CI.

Ít nhất gate tương đương:

```bash
python scripts/package_production.py --check
```

và các script npm wrapper hiện có.

Nếu vẫn fail:

- đọc exact error;
- sửa packager/runtime contract;
- không bỏ validation.

Phải đảm bảo production archive:

- reproducible;
- không chứa source maps public;
- không chứa `.env`;
- không chứa test/docs/frontend source nếu forbidden;
- smoke test chạy từ extracted archive;
- release ID đúng contract.

## 6.2. Performance

Chạy:

```bash
npm run test:performance
```

Nếu fail sau khi manifest đã được phục hồi:

- đo metric nào vượt budget;
- phân biệt cold startup/server startup/first navigation/workspace load;
- tìm nguyên nhân thật;
- không tăng budget trong nhiệm vụ này trừ khi có bằng chứng benchmark/spec chính thức và phải báo riêng trước khi thay.

Ưu tiên sửa:

- duplicate auth/bootstrap calls;
- blocking startup work;
- unnecessary synchronous I/O;
- eager imports;
- preload graph sai;
- repeated manifest reads;
- N+1 hoặc request waterfall.

## 6.3. E2E

Chạy trước:

```bash
npm run test:e2e:smoke
```

trên:

- Chromium
- Firefox
- WebKit

Sau đó chạy full workflow E2E theo script trong CI.

Nếu smoke fail:

- sửa smoke trước;
- không skip browser.

Nếu full role/workflow fail:

- sửa từng workflow;
- đặc biệt không phá:
  - workspace;
  - multi-org;
  - multi-role;
  - permissions;
  - package lifecycle;
  - plan;
  - contract;
  - procurement import;
  - evaluation;
  - lot-based flows.

## 6.4. Acceptance criteria P0-4

Các job tương ứng phải pass độc lập, không chỉ vì release job chưa chạy.

---

# 7. P0-5 — FULL CI PHẢI XANH THỰC CHẤT

Sau khi các P0 trên hoàn tất, chạy canonical gates tương đương CI.

Tối thiểu:

```bash
npm run check:static
npm run test:js:coverage
python -m pytest -q
npm run build:secure
```

Sau đó chạy package/performance/E2E với PostgreSQL test environment tương ứng.

Không tuyên bố hoàn thành khi:

```text
quality ✅
python ✅
build ✅
database ✅
nhưng JS/package/performance/E2E ❌
```

Release readiness chỉ đạt khi các gate bắt buộc đều xanh.

---

# 8. P1-1 — ĐỒNG BỘ TECHNICAL EVALUATION METHOD GIỮA FRONTEND VÀ BACKEND EXCEL

Chỉ làm sau khi P0 xanh.

## 8.1. Vấn đề còn lại

Backend đã có:

```text
PASS_FAIL
SCORE
UNKNOWN
```

và đã sửa Excel score/pass-fail đúng hướng.

Tuy nhiên backend export hiện chủ yếu suy luận từ:

- `linh_vuc`
- `hinh_thuc_lua_chon`
- `phuong_thuc_lua_chon`
- `phuong_phap_danh_gia`

Trong khi frontend còn đọc stored metadata:

```text
danhGiaHsdtMetadata
technicalEvaluationMethod
phuongPhapDanhGiaKyThuat
```

và phân theo round:

```text
single
technical
financial
```

Có nguy cơ frontend hiểu phương pháp là `score/pass_fail` nhưng backend Excel trả `UNKNOWN` hoặc validation khác.

## 8.2. Yêu cầu

Backend Excel phải lấy được stored evaluation metadata cần thiết.

Không copy mù toàn bộ frontend resolver.

Hãy xây một contract chung/golden cases.

Ưu tiên tạo:

```text
shared/technical_evaluation_method_cases.json
```

hoặc contract tương đương, chứa các case domain canonical.

Cả:

- Python tests;
- JavaScript tests

phải chạy cùng bộ case.

Các case tối thiểu:

```text
Tư vấn → score
Chào hàng cạnh tranh → pass_fail
Chỉ định thầu → pass_fail
Chỉ định thầu rút gọn → pass_fail
Trường hợp đặc biệt → pass_fail
Kết hợp kỹ thuật và giá → score
Dựa trên kỹ thuật → score
Stored technicalEvaluationMethod=score → score
Stored technicalEvaluationMethod=pass_fail → pass_fail
Round-specific stored metadata
Unknown overall method nhưng stored technical method có giá trị
```

## 8.3. Excel behavior

`PASS_FAIL`:

```text
dropdown Đạt / Không đạt
```

`SCORE`:

```text
numeric input >= 0
decimal allowed
```

`UNKNOWN`:

Không được tự bịa business rule. Giữ hành vi rõ ràng/an toàn theo contract hiện có và test.

## 8.4. Không regression

Phải giữ:

- `0` không biến thành blank;
- `False` không biến thành blank;
- Excel header canonical/aliases dùng shared contract hiện tại.

---

# 9. P1-2 — TẬP TRUNG FRONTEND ASSET CONTRACT VÀO MỘT MODULE

Nếu P0-2 chưa đủ để hoàn tất việc này thì tiếp tục sau khi CI xanh.

Hiện asset/manifest logic không nên nằm rải rác trong `backend/app.py`.

Mục tiêu:

```text
backend/app.py
        ↓
backend/frontend_assets.py
```

Các consumer:

- compile HTML;
- preload;
- prewarm;
- production validation;

phải dùng cùng một manifest authority.

Không được thay đổi API public không cần thiết.

---

# 10. P1-3 — GIẢM `backend/procurement_import/routes.py` THEO STRANGLER PATTERN

Chỉ thực hiện nếu P0 hoàn toàn xanh và thay đổi có thể chia nhỏ an toàn.

Không rewrite file.

Tách orchestration theo hướng:

```text
routes.py
  ├─ authentication/request parsing
  ├─ map exception → HTTP
  └─ gọi application services

plan_import_service.py
notice_import_service.py
opening_import_service.py
enrichment_service.py
```

Mỗi extraction phải:

- giữ API contract;
- giữ RBAC/workspace;
- giữ rate limit;
- giữ transaction semantics;
- có tests.

Đặc biệt không làm hỏng MuaSamCong opening đã sửa.

---

# 11. P1-4 — TIẾP TỤC THU NHỎ `backend/sync/mapper.py`

Không rewrite.

Dùng compatibility facade.

Các domain có thể tách dần:

```text
package mapping
plan mapping
opening mapping
evaluation mapping
version mapping
```

Một commit/refactor phải nhỏ, testable.

Không thay đổi payload contract legacy nếu chưa migration tất cả consumer.

---

# 12. BẢO VỆ CÁC PHẦN ĐÃ SỬA ĐÚNG

Trong toàn bộ nhiệm vụ, KHÔNG regression:

## 12.1. Excel evaluation

Giữ:

- shared column contract;
- aliases;
- `None -> ""`;
- giữ `0`;
- giữ `False`;
- SCORE numeric;
- PASS_FAIL dropdown.

## 12.2. MuaSamCong opening

Giữ semantic authority:

```text
OPENING_ROUND       → round/status/schedule
OPENING_BID         → bidder-level summary
OPENING_LOT         → bidder-lot relation
OPENING_LOT_DETAIL  → lot detail
```

Bidder guarantee phải ưu tiên:

```text
bidGuarantee
→ totalGuaranteeValue fallback
```

Không tái nhập `bidGuaranteed` thành bidder-level authoritative guarantee nếu chưa có evidence upstream chứng minh tương đương.

Không biến `OPENING_SUBMISSION` thành required source nếu current MSC flow chưa dùng nó.

## 12.3. Multi-lot

Không làm mất:

- contractor + lot identity;
- lot code;
- lot name;
- row order nơi business contract yêu cầu;
- joint venture data;
- bidder-level fields propagated đúng phase.

## 12.4. Security/RBAC

Không làm yếu:

- organization scoping;
- workspace lease;
- module permissions;
- rate limit;
- session scoping;
- PostgreSQL constraints;
- production package allowlist;
- secure frontend artifact verification.

---

# 13. TESTS BẮT BUỘC THÊM

Ít nhất phải có regression tests cho:

### CI artifact

```text
include-hidden-files=true
manifest verification after download
```

### Production frontend asset

```text
valid manifest
missing manifest
invalid JSON
missing app entry
missing referenced asset
path traversal
production fail-fast
development behavior
```

### JS failures

Tests sửa đúng root cause, không giảm coverage.

### Technical method parity

Golden cases dùng chung frontend/backend.

---

# 14. CÁCH XỬ LÝ KHI PHÁT HIỆN THÊM BUG

Nếu trong quá trình sửa phát hiện lỗi mới:

1. xác định có liên quan trực tiếp nhiệm vụ không;
2. nếu P0/release/security/data-integrity → sửa;
3. nếu refactor lớn không cần thiết → ghi backlog;
4. thêm regression test cho bug đã sửa;
5. không mở rộng vô hạn phạm vi.

Ưu tiên tuyệt đối:

```text
data integrity
authorization
production boot
runtime correctness
release correctness
E2E
performance
maintainability
```

---

# 15. GIT / COMMIT

Không reset/xóa thay đổi ngoài phạm vi.

Nếu tạo commit, chia logic hợp lý, ví dụ:

```text
fix(ci): preserve hidden Vite manifest in secure build artifact
fix(frontend-runtime): fail closed on invalid production asset manifest
fix(test): resolve JavaScript runtime and accessibility regressions
fix(evaluation): align backend Excel technical method with stored metadata
refactor(procurement): extract import orchestration service
```

Không bắt buộc đúng các message trên.

---

# 16. BÁO CÁO CUỐI CÙNG BẮT BUỘC

Sau khi hoàn tất, trả báo cáo theo format:

```markdown
# Kết quả sửa BiddingFlow

## HEAD
- Before:
- After:

## P0
### Artifact / .vite manifest
- Root cause:
- Files changed:
- Tests:
- Result:

### Production frontend fail-fast
- Root cause:
- Files changed:
- Tests:
- Result:

### JavaScript test/coverage
- Failure groups:
- Code regressions fixed:
- Stale tests updated:
- Accessibility fixes:
- Coverage result:

### Package
- Result:

### Performance
- Metrics before:
- Metrics after:
- Result:

### E2E
- Chromium:
- Firefox:
- WebKit:
- Full workflows:

## P1
- Technical evaluation parity:
- Asset resolver:
- Procurement routes refactor:
- Mapper refactor:

## Gates
- npm run check:static:
- npm run test:js:coverage:
- python -m pytest -q:
- npm run build:secure:
- package validation:
- performance:
- E2E smoke:
- full E2E:

## Remaining issues
- Chỉ liệt kê lỗi thực sự còn lại.
```

Phải nêu exact command + pass/fail.

Không được nói “all tests pass” nếu chưa chạy.

---

# 17. DEFINITION OF DONE

Nhiệm vụ chỉ được coi là hoàn thành khi:

- [ ] secure build artifact giữ `.vite/manifest.json`;
- [ ] downstream jobs verify manifest sau restore;
- [ ] production không fallback âm thầm sang asset JS không tồn tại;
- [ ] JS unit/coverage gate pass với threshold hiện tại;
- [ ] package validation pass;
- [ ] performance budget pass;
- [ ] Playwright smoke pass Chromium + Firefox + WebKit;
- [ ] full role/workflow E2E pass;
- [ ] Python tests pass;
- [ ] static quality pass;
- [ ] secure build pass;
- [ ] không giảm security/coverage/performance requirements;
- [ ] không regression Excel HSDT;
- [ ] không regression MuaSamCong opening;
- [ ] có regression tests cho các lỗi đã sửa;
- [ ] báo cáo cuối ghi rõ những gì thực sự đã chạy.

---

# 18. THỨ TỰ THỰC THI NGẮN GỌN

Thực hiện theo đúng chuỗi sau:

```text
1. Fetch latest main + inspect current HEAD
2. Reproduce JS/CI-relevant failures
3. Fix hidden `.vite` artifact
4. Add artifact regression tests
5. Implement production frontend asset fail-fast
6. Add frontend asset tests
7. Fix JS unit/coverage failures by root cause
8. Rerun JS gate
9. Build secure artifact
10. Run package gate
11. Run performance gate
12. Run cross-browser smoke
13. Run full E2E
14. Run Python/static gates
15. Make Full CI-equivalent green
16. Only then implement P1 evaluation parity
17. Only then perform small safe refactors
18. Final regression run + report
```

Không hỏi lại người dùng những thông tin có thể xác định trực tiếp từ repository.
Không dừng ở phân tích. Hãy sửa code, thêm test, chạy kiểm tra và báo cáo kết quả thực tế.
