# MASTER PROMPT CHO CODEX — SỬA VÀ CỦNG CỐ BIDDINGFLOW

Bạn đang làm việc trên repository:

`https://github.com/newstar94/Bidding`

Mốc rà soát ban đầu của prompt này là:

`main @ 16b0952065a8c39bf4e4d7289dcec07f1904e8ea`

Tuy nhiên **KHÔNG được giả định SHA này vẫn là HEAD** khi bắt đầu. Hãy đọc code mới nhất trước.

---

# 1. NHIỆM VỤ

Hãy nghiên cứu thật kỹ code hiện tại và thực hiện sửa lỗi/refactor theo các ưu tiên dưới đây.

Mục tiêu chính:

1. Làm Full CI xanh trở lại mà không lách quality gate.
2. Sửa contract Excel đánh giá HSDT để export/import round-trip chính xác.
3. Đồng bộ Excel với phương pháp đánh giá kỹ thuật `pass_fail` / `score`.
4. Bổ sung regression/round-trip/invariant tests để khóa lỗi.
5. Củng cố version/snapshot và procurement import.
6. Refactor dần các God-module theo hướng behavior-preserving.
7. Giữ nguyên RBAC, workspace scope và AI permission safety.
8. Không phát sinh regression cho multi-lot, 1G1T, 1G2T, liên danh, opening, award, sync.

---

# 2. BẮT BUỘC ĐỌC CODE TRƯỚC KHI SỬA

Trước khi thay đổi bất kỳ file nào:

```bash
git status
git rev-parse HEAD
git log -10 --oneline
```

Sau đó đọc tối thiểu các file hiện tại tương ứng với các chức năng sau:

## CI / quality

- `.github/workflows/ci.yml`
- `package.json`
- script quality gate liên quan, ví dụ `scripts/check_python_quality.py`
- các baseline/config lint hiện hành

## Excel HSDT

- `backend/documents/excel_service.py`
- `backend/documents/excel_workbook_builder.py`
- `frontend/documents/excelImportAdapters.js`
- `frontend/documents/excelSaveAdapters.js`
- `frontend/packages/technicalEvaluationMethod.js`
- `frontend/packages/evaluationMethodRules.js`

## Evaluation

- `frontend/packages/BidEvaluation*`
- `frontend/packages/DetailedEvaluation*`
- backend persistence/model của `ket_qua_danh_gia_nha_thau`

## Version/snapshot

- package version resolver/inheritance/delete logic
- plan snapshot logic
- sync mapper/persistence
- các test `package_version_*`, `plan_version_*`, `detail_version_*`

## Procurement import / MuaSamCong

- `backend/procurement_import/routes.py`
- collectors/client/canonical/cache/source validation hiện tại
- opening/notice/plan import tests

## AI/RBAC

- `backend/ai/permission_context.py`
- `backend/ai/tools/*`
- access-policy/workspace-scope helpers
- AI security/permission tests

Nếu tên/file đã đổi ở HEAD mới, hãy tìm module tương đương.

---

# 3. BASELINE: REPRODUCE TRƯỚC

Chạy:

```bash
npm run check:ci
```

Ghi lại lỗi baseline.

Mốc review trước cho thấy Full CI từng fail tại bước:

`Canonical quality and secure build`

với debt kiểu:

```text
BLE001: 120, limit 117
F401:   1, limit 0
```

và có tăng BLE001 trong các module như:

```text
backend/api/org_routes.py
backend/procurement_import/routes.py
```

Nhưng hãy xác nhận lại trên HEAD mới.

Nếu các lỗi này đã được sửa bởi commit mới:
- không sửa lại;
- ghi rõ trong report;
- tiếp tục các phần còn tồn tại.

---

# 4. QUY TẮC CẤM

## 4.1. Không lách quality gate

KHÔNG:

- tăng BLE001 baseline chỉ để CI xanh;
- tăng F401 allowance;
- hạ coverage;
- bỏ quality ratchet;
- thêm `# noqa` hàng loạt;
- skip/remove test đang fail;
- đổi workflow để không chạy test;
- catch exception rộng rồi `pass`.

Nếu broad exception thực sự hợp lệ:
- giải thích boundary;
- rollback/log/re-raise đúng;
- suppress cục bộ có lý do nếu cần.

## 4.2. Không rewrite lớn khi chưa có regression tests

Đặc biệt:
- `backend/sync/mapper.py`
- `backend/procurement_import/routes.py`
- `frontend/packages/BidProcessWorkflow.js`
- `frontend/packages/BidderGoodsWorkflow.js`

Chỉ refactor sau khi P0 xanh.

## 4.3. Không thay đổi business semantics ngầm

Không tự:
- reset status;
- reset assignee;
- bỏ inherited child rows;
- đổi version identity;
- đổi ranking semantics;
- đổi technical evaluation rules;
- trộn invitation guarantee với submitted bid guarantee;
- normalize contractor code theo giả định không có bằng chứng;
- nới RBAC.

---

# 5. P0-1 — SỬA FULL CI

## 5.1. F401

Tìm unused import chính xác.

Fix bằng:
- xóa import nếu không dùng;
- hoặc dùng đúng nếu code thiếu.

Không suppress vô lý.

## 5.2. BLE001

Rà từng `except Exception` mới/vượt baseline.

Phân loại:

### Expected error

Ví dụ:
- `ValueError`
- DB error
- JSON/schema error
- HTTP/network timeout
- domain-specific exception

Bắt type cụ thể.

### Transaction boundary

Nếu cần:

```python
try:
    ...
except Exception:
    connection.rollback()
    raise
```

giữ broad catch nhưng lý do phải rõ.

### Best-effort background path

Thay:

```python
except Exception:
    pass
```

bằng:
- structured logging;
- metric/diagnostic nếu có;
- không phá main request nếu đúng là best effort.

### Không biết xử lý

Không swallow.

---

# 6. P0-2 — SỬA EXCEL EVALUATION HEADER CONTRACT

## 6.1. Root cause cần xác nhận

Backend export hiện/đã từng sinh:

```text
Làm rõ tính hợp lệ (nếu có)
Nguyên nhân không đạt hợp lệ (nếu có)
Làm rõ năng lực kinh nghiệm (nếu có)
Nguyên nhân không đạt năng lực (nếu có)
Làm rõ kỹ thuật (nếu có)
Nguyên nhân không đạt kỹ thuật (nếu có)
Làm rõ tài chính (nếu có)
```

Frontend importer lại đang/đã từng đọc alias khác như:

```text
Làm rõ hợp lệ
Làm rõ tính hợp lệ
Lý do không đạt hợp lệ
Làm rõ năng lực
Lý do không đạt năng lực
Lý do không đạt kỹ thuật
Làm rõ tài chính
```

Hãy đọc code mới nhất và xác nhận.

## 6.2. Cách sửa

Tạo **một nguồn contract tập trung** cho các cột đánh giá HSDT.

Không hard-code canonical labels ở nhiều file nếu có thể tránh.

Yêu cầu:

```text
canonical export label
+
legacy aliases for import
+
single helper to resolve imported value
```

Ví dụ API mong muốn:

```javascript
readEvaluationExcelValue(row, "validityFailureReason")
```

thay vì:

```javascript
row["A"] || row["B"] || row["C"]
```

Nếu backend và frontend không thể import chung JS/Python module, tạo data contract chung:
- JSON manifest;
- generated constants;
- hoặc contract test buộc hai phía đồng bộ.

Không tạo kiến trúc phức tạp quá mức; ưu tiên đơn giản nhưng có authority rõ.

## 6.3. Preserve falsy values

Rà code export/import để không dùng logic làm mất:

```text
0
false
```

Ví dụ tránh:

```python
value or ""
```

nếu `0` hoặc `False` là dữ liệu hợp lệ.

Dùng explicit null check.

Đặc biệt kiểm tra:
- `chap_thuan_gia_de_nghi_trung_thau_duoi_50`
- score = `0`
- financial numeric fields
- boolean decisions.

---

# 7. P0-3 — ĐỒNG BỘ PASS/FAIL VÀ SCORE TRONG EXCEL

## 7.1. Domain hiện tại

Frontend hiện có/từng có:

```text
TECHNICAL_EVALUATION_METHODS.PASS_FAIL
TECHNICAL_EVALUATION_METHODS.SCORE
```

Các rule đã có như:
- Tư vấn → SCORE
- Kết hợp giữa kỹ thuật và giá → SCORE
- phương pháp dựa trên kỹ thuật → SCORE
- một số hình thức khác → PASS_FAIL

Hãy xác nhận code hiện tại.

## 7.2. Bug cần sửa

Backend Excel hiện/đã từng luôn tạo:

```python
"Đánh giá kỹ thuật": ["Đạt", "Không đạt"]
```

Trong khi frontend import đối với package yêu cầu score lại từ chối text `Đạt/Không đạt`.

Phải thống nhất.

## 7.3. Backend resolver

Tạo pure domain resolver phía backend, ví dụ:

```python
resolve_technical_evaluation_method(package_context)
```

Trả:

```text
pass_fail
score
unknown
```

Input phải đủ để phản ánh semantics frontend, ít nhất rà:
- `linh_vuc`
- `hinh_thuc_lua_chon`
- `phuong_thuc_lua_chon`
- `phuong_phap_danh_gia`
- metadata evaluation method
- legacy fields nếu có.

Không suy đoán bằng string rải rác trong Excel service.

Viết unit tests cho resolver.

## 7.4. Excel PASS_FAIL

Nếu method là `pass_fail`:

- giữ dropdown:
  - `Đạt`
  - `Không đạt`
- import/export tương thích cũ.

## 7.5. Excel SCORE

Nếu method là `score`:

- bỏ dropdown pass/fail;
- cell numeric;
- preserve decimal;
- validate >= 0;
- nếu min/max score có source authority đáng tin thì validate;
- score `0` phải giữ là `0`;
- importer nhận numeric string/cell number phù hợp;
- importer không chấp nhận `Đạt/Không đạt`.

Không ép max=100 nếu domain không đảm bảo điều đó.

## 7.6. Unknown method

Không tạo dropdown sai.

Chọn behavior an toàn theo UX hiện tại:
- no dropdown;
- hoặc explicit warning/metadata.

Viết test.

---

# 8. P0-4 — ROUND-TRIP TEST

Bổ sung test không chỉ kiểm từng đầu.

## Test flow

```text
prepare_danhgiahsdt_template_spec()
↓
create workbook
↓
read workbook rows giống flow import
↓
parseBidEvaluationImport()
↓
semantic row
```

Nếu cần test qua Python + JS khác runtime, có thể dùng fixture JSON do Python generate hoặc contract manifest, miễn test chứng minh header export thực tế được importer hiểu.

## Ma trận bắt buộc

### Non-lot / multi-lot

### 1G1T

### 1G2T technical

### 1G2T financial

### Contractor independent

### Joint venture

### Technical pass/fail

### Technical score

### Falsy/edge values

- `0`
- `False`
- `null`
- empty string
- decimal
- Vietnamese Unicode

### Fields

- validity result
- validity clarification
- validity failure reason
- capacity result
- capacity clarification
- capacity failure reason
- technical result/score
- technical clarification
- technical failure reason
- financial clarification
- ranking price
- proposed award price
- low-price acceptance

---

# 9. P1 — VERSION/SNAPSHOT INVARIANT TESTS

Trước khi refactor version logic, bổ sung invariant-oriented tests.

## Invariant A — latest uniqueness

Trong cùng package family + plan snapshot hợp lệ:
- không hơn 1 `isLatest`.

## Invariant B — inheritance

Tăng version không được tự làm mất:
- trạng thái;
- người phụ trách;
- owned rows;
- opening/evaluation data;

trừ field explicit reset.

## Invariant C — cold/warm cache

Cùng operation:
- cold cache;
- warm cache;

cho cùng domain result.

## Invariant D — delete latest

Xóa latest:
- predecessor hợp lệ được restore/promote;
- package không mất khỏi current plan snapshot.

## Invariant E — entry-point equivalence

Sửa package từ:
- detail page;
- list/modal;

không được tạo semantics version khác nhau.

Nếu hiện tại hai entry-point gọi hai đường code khác nhau, hãy cân nhắc đưa về chung một domain command/service.

---

# 10. P1 — PROCUREMENT IMPORT / MSC HARDENING

## 10.1. Không thêm alias bừa

Rà canonical/source mapping hiện tại.

Tạo/chuẩn hóa operation schema metadata:

```text
operation
packType
expected shape
semantic authority
validator
known aliases
fixture
```

## 10.2. Opening semantic authority

Giữ phân biệt:

```text
bid-open
→ bidder-level summary

lot-open
→ bidder-lot relation

lotOpenDetail
→ lot detail
```

Không coi:
- invitation guarantee requirement;
- submitted bid guarantee;
- nested detail field;

là cùng một semantic nếu chưa có bằng chứng.

Không thêm endpoint chỉ vì tên nghe có vẻ đúng.

## 10.3. Cross-source validation

Nếu:
- lot/detail cho thấy bidder tồn tại,
- nhưng bid-open không có bidder tương ứng,

không được silent success với null bidder-level fields.

Phải:
- partial/schema diagnostic;
- hoặc explicit warning/error theo policy hiện tại.

Legitimate empty opening vẫn phải được hỗ trợ.

## 10.4. Safe diagnostics

Nếu chưa có đầy đủ, thêm diagnostic không lộ:
- raw token;
- cookie;
- auth header;
- raw sensitive payload.

Có thể expose:
- operation;
- success;
- recordCount;
- schema version;
- packType;
- partial status.

---

# 11. P1 — REFACTOR `backend/sync/mapper.py`

Chỉ làm sau khi P0 xanh.

Không rewrite.

Dùng strangler/extraction pattern.

## Mục tiêu

Tách dần:
- package mapping;
- plan mapping;
- evaluation persistence;
- opening persistence;
- version persistence/policy.

Có thể hướng tới:

```text
backend/sync/mapper.py
backend/sync/package_mapper.py
backend/sync/plan_mapper.py

backend/evaluation/repository.py
backend/evaluation/persistence.py
backend/evaluation/policy.py

backend/opening/persistence.py
backend/packages/version_repository.py
```

Mỗi extraction:
1. thêm/giữ test;
2. move code;
3. adapter cũ gọi module mới;
4. chạy test;
5. xóa duplicate.

Không đổi DB semantics chỉ vì refactor.

---

# 12. P1 — REFACTOR `backend/procurement_import/routes.py`

Tách:

```text
HTTP boundary
≠
business service
≠
collector
≠
canonical mapper
≠
cache policy
```

Hướng tới:

```text
routes.py
plan_import_service.py
notice_import_service.py
opening_import_service.py
enrichment_service.py
import_session_service.py
error_mapping.py
```

Route chỉ:
- auth;
- workspace context;
- parse/validate input;
- call service;
- response/error mapping.

Không để raw MSC mapping/business decision trong route.

---

# 13. P1 — FRONTEND MODULARIZATION

Các file lớn cần xem:

```text
frontend/packages/BidProcessWorkflow.js
frontend/packages/BidderGoodsWorkflow.js
frontend/packages/BidEvaluationRowRenderer.js
```

Tách theo use case/lifecycle, không theo số dòng.

Ví dụ:

```text
BidProcessOpeningWorkflow
BidProcessEvaluationWorkflow
BidProcessFinancialWorkflow
BidProcessAwardWorkflow
```

Renderer có thể tách:
- contractor identity;
- lot;
- technical evaluation;
- financial evaluation;
- low-price decision.

Giữ DOM/test contract trừ khi có lý do và regression test.

Ưu tiên behavior tests hơn source-regex tests khi khả thi.

---

# 14. P2 — CI PARALLELIZATION

Hiện Full CI từng chạy nhiều stage tuần tự trong một job.

Refactor cẩn thận thành các jobs độc lập, ví dụ:

```text
quality
unit-python
unit-js
database
integration
e2e
performance
package
```

Security workflow hiện có thể giữ riêng nếu hợp lý.

`release`/artifact production chỉ chạy nếu các gate bắt buộc đều pass.

## Yêu cầu

- không giảm gate;
- không bỏ artifact diagnostics;
- không làm E2E chạy trên schema chưa init;
- dùng `needs` rõ;
- tránh duplicate dependency install quá mức nếu cache/artifact có thể tái sử dụng;
- timeout hợp lý.

Mục tiêu: quality fail không che E2E/performance result.

---

# 15. P2 — AI/RBAC SAFETY

Không refactor AI theo kiểu model được sinh arbitrary SQL.

Giữ pattern:

```text
LLM intent
↓
strict tool schema
↓
server permission validation
↓
deterministic query
↓
safe response
```

Test tối thiểu:
- cross-org denied;
- employee cannot prompt-escalate role;
- active role scoped đúng organization;
- no arbitrary SQL;
- unsupported metric rejected;
- result scoped server-side;
- secret/token redaction;
- audit không leak sensitive content.

---

# 16. TEST COMMANDS

Đầu tiên:

```bash
npm run check:ci
```

Sau đó chạy targeted test ngay sau từng phase.

Hãy đọc `package.json` để dùng đúng scripts hiện tại.

Khi hoàn tất P0:
- Python tests liên quan Excel/evaluation;
- JS evaluation/import tests;
- version tests;
- procurement import tests.

Khi có refactor:
- full canonical check;
- E2E liên quan;
- Playwright smoke nếu môi trường cho phép.

Không nói "test pass" nếu chưa chạy.

Nếu một test không thể chạy vì môi trường:
- ghi command;
- ghi nguyên nhân;
- không giả vờ pass.

---

# 17. ACCEPTANCE CRITERIA P0 — BẮT BUỘC

P0 chỉ được coi hoàn thành khi:

- [ ] `npm run check:ci` pass.
- [ ] Không tăng F401/BLE001 baseline.
- [ ] Không skip/remove tests để xanh.
- [ ] File Excel do app export import lại giữ clarification fields.
- [ ] Failure reason fields không bị mất.
- [ ] `False` không bị đổi thành blank.
- [ ] `0` không bị đổi thành blank.
- [ ] PASS_FAIL vẫn có `Đạt/Không đạt`.
- [ ] SCORE không còn dropdown `Đạt/Không đạt`.
- [ ] SCORE import/export preserve numeric/decimal.
- [ ] Multi-lot regression pass.
- [ ] 1G2T technical/financial regression pass.
- [ ] Joint venture regression pass.

Không bắt đầu refactor lớn nếu các checkbox trên chưa đạt.

---

# 18. ACCEPTANCE CRITERIA P1/P2

- [ ] Version/snapshot invariants được test.
- [ ] Cold-cache/warm-cache behavior được khóa.
- [ ] Procurement import source semantics rõ hơn.
- [ ] Không silent partial source mismatch.
- [ ] `sync/mapper.py` giảm responsibility mà không regression.
- [ ] `procurement_import/routes.py` giảm business logic.
- [ ] Large frontend workflows được tách dần.
- [ ] CI feedback tốt hơn mà không giảm gate.
- [ ] AI/RBAC tests pass.

Nếu P1/P2 quá lớn cho một lượt:
- hoàn tất P0;
- thực hiện P1 theo từng safe extraction;
- ghi rõ remaining work;
- không tạo refactor nửa vời làm code khó hơn.

---

# 19. OUTPUT CUỐI CÙNG CỦA CODEX

Sau khi sửa, trả về báo cáo theo đúng format:

## A. Baseline

```text
Start HEAD:
End HEAD / working tree:
Baseline failures:
```

## B. Root causes

Mỗi lỗi:
- symptom;
- root cause;
- file/function;
- vì sao test cũ không bắt được.

## C. Changes

Bảng:

| File | Change | Reason |
|---|---|---|

## D. Tests added/updated

Bảng:

| Test | Scenario protected |
|---|---|

## E. Commands executed

Liệt kê command thật đã chạy.

## F. Results

```text
Python:
JavaScript:
Quality:
E2E:
Security:
```

Không ghi pass nếu không chạy.

## G. Compatibility

Xác nhận riêng:
- non-lot;
- multi-lot;
- 1G1T;
- 1G2T;
- independent;
- JV;
- package versioning;
- procurement import;
- AI/RBAC.

## H. Remaining risks

Nêu rõ việc P1/P2 chưa làm.

---

# 20. CÁCH LÀM VIỆC

Ưu tiên:

```text
reproduce
→ understand
→ test failing behavior
→ minimal correctness fix
→ regression tests
→ refactor
→ full validation
```

Không làm:

```text
large refactor
→ hy vọng tests vẫn chạy
```

Nếu phát hiện nhận định trong prompt không còn đúng vì HEAD đã đổi, hãy:
1. chứng minh bằng code/test hiện tại;
2. không sửa một bug đã hết;
3. cập nhật implementation plan;
4. tiếp tục giải quyết mục tiêu nghiệp vụ tương ứng.

Mục tiêu cuối cùng là **hệ thống đúng dữ liệu, ổn định phiên bản, test được và dễ bảo trì hơn**, không phải chỉ làm CI xanh.
