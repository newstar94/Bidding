# PLAN SỬA VÀ CỦNG CỐ BIDDINGFLOW

**Repository:** `https://github.com/newstar94/Bidding`  
**Mốc rà soát:** `main` tại commit `16b0952065a8c39bf4e4d7289dcec07f1904e8ea`  
**Ngày lập plan:** 2026-08-17  
**Nguyên tắc:** ưu tiên correctness nghiệp vụ và dữ liệu trước, sau đó mới refactor.

---

## 1. Mục tiêu

Plan này nhằm xử lý đồng thời 4 nhóm vấn đề:

1. Làm `main` xanh trở lại và không lách quality gate.
2. Sửa các lỗi contract Excel đánh giá HSDT đã xác nhận.
3. Củng cố test để các lỗi tương tự không tái diễn.
4. Refactor dần các God-module/rủi ro kiến trúc mà không thay đổi nghiệp vụ ngoài ý muốn.

Không coi đây là một lần "rewrite". Các thay đổi phải được chia theo phase, mỗi phase có regression test và tiêu chí hoàn thành riêng.

---

# 2. Nguyên tắc bắt buộc

## 2.1. Không sửa bằng cách nới quality baseline

Không được xử lý CI đỏ bằng cách:

- tăng global BLE001 limit;
- tăng per-module BLE001 baseline;
- cho phép F401 mới;
- thêm `# noqa` hàng loạt không có lý do;
- bỏ/skip test;
- hạ coverage gate;
- đổi workflow để che lỗi.

Nếu một `except Exception` thực sự hợp lệ ở transaction/boundary thì:
- phải có lý do rõ ràng;
- rollback/log/re-raise phù hợp;
- chỉ dùng `# noqa: BLE001` cục bộ nếu thực sự cần.

## 2.2. Không đổi nghiệp vụ ngầm trong refactor

Khi tách:
- `backend/sync/mapper.py`;
- `backend/procurement_import/routes.py`;
- `frontend/packages/BidProcessWorkflow.js`;
- `frontend/packages/BidderGoodsWorkflow.js`;

phải giữ nguyên observable behavior trừ các bug được nêu rõ trong plan.

## 2.3. Không làm mất tương thích dữ liệu cũ

Phải giữ:
- field aliases cũ cần thiết;
- dữ liệu phiên bản cũ;
- multi-lot;
- 1G1T / 1G2T;
- liên danh / độc lập;
- workspace / organization scope;
- RBAC hiện tại;
- dữ liệu mở thầu, đánh giá, xếp hạng, kết quả.

Nếu cần migration:
- phải idempotent;
- có test dữ liệu trước/sau migration;
- không phá rollback/read compatibility.

---

# 3. PHASE 0 — Xác nhận HEAD và baseline trước khi sửa

## Việc phải làm

1. Checkout `main`.
2. Pull/fetch code mới nhất.
3. Ghi lại:
   - HEAD SHA;
   - Python/Node versions;
   - trạng thái working tree.
4. Chạy quality/test command chuẩn của repo:
   - `npm run check:ci`
5. Xác nhận lại lỗi hiện tại thay vì giả định commit `16b0952` vẫn là HEAD.
6. Nếu HEAD đã đổi:
   - rà lại các file liên quan trước khi patch;
   - không áp patch dựa trên line number cũ.

## Kết quả cần lưu

Trong báo cáo cuối cùng:
- baseline HEAD;
- các lỗi reproduce được;
- lỗi nào trong plan đã được người khác sửa trước khi Codex bắt đầu.

---

# 4. PHASE 1 — P0: Làm Full CI xanh đúng cách

## 4.1. Sửa F401

Quality gate hiện đã từng báo ít nhất 1 `F401`.

### Yêu cầu

- tìm chính xác unused import;
- xóa hoặc sử dụng đúng;
- không suppress vô lý.

## 4.2. Giảm BLE001 về baseline hợp lệ

Các module cần kiểm tra đặc biệt:

- `backend/api/org_routes.py`
- `backend/procurement_import/routes.py`

### Phân loại từng broad catch

#### A. Expected exception
Bắt đúng type:
- `ValueError`
- DB exception
- timeout/network exception
- domain exception
- JSON/schema exception
- v.v.

#### B. Transaction boundary
Có thể cần broad catch để rollback:

```python
try:
    ...
except Exception:
    connection.rollback()
    raise
```

Nếu lint rule yêu cầu, chỉ suppress cục bộ với lý do.

#### C. Best-effort background path
Không được:

```python
except Exception:
    pass
```

Phải:
- structured log;
- metric/diagnostic nếu repo đã có;
- không làm mất main request nếu đúng là best effort.

#### D. Unknown
Không swallow.

### Definition of Done

- `npm run check:ci` không còn fail vì F401/BLE001.
- Không tăng quality baseline.
- Không giảm coverage.
- Không skip test.

---

# 5. PHASE 2 — P0: Chuẩn hóa contract Excel đánh giá HSDT

Đây là bug correctness dữ liệu.

## 5.1. Vấn đề đã xác nhận

Backend export đang dùng các header dạng:

- `Làm rõ tính hợp lệ (nếu có)`
- `Nguyên nhân không đạt hợp lệ (nếu có)`
- `Làm rõ năng lực kinh nghiệm (nếu có)`
- `Nguyên nhân không đạt năng lực (nếu có)`
- `Làm rõ kỹ thuật (nếu có)`
- `Nguyên nhân không đạt kỹ thuật (nếu có)`
- `Làm rõ tài chính (nếu có)`

Trong khi frontend importer đang chấp nhận/đọc các biến thể khác như:

- `Làm rõ hợp lệ`
- `Làm rõ tính hợp lệ`
- `Lý do không đạt hợp lệ`
- `Làm rõ năng lực`
- `Lý do không đạt năng lực`
- `Lý do không đạt kỹ thuật`
- `Làm rõ tài chính`

Kết quả: file do hệ thống tự export có thể không import round-trip đầy đủ.

## 5.2. Không sửa bằng alias rải rác

Không tiếp tục thêm hàng loạt:

```javascript
row["A"] || row["B"] || row["C"]
```

ở nhiều nơi.

Tạo một contract/registry tập trung, ví dụ:

```javascript
export const BID_EVALUATION_EXCEL_COLUMNS = {
  validityClarification: {
    canonical: "Làm rõ tính hợp lệ (nếu có)",
    aliases: [
      "Làm rõ tính hợp lệ",
      "Làm rõ hợp lệ"
    ],
  },
  validityFailureReason: {
    canonical: "Nguyên nhân không đạt hợp lệ (nếu có)",
    aliases: [
      "Nguyên nhân không đạt hợp lệ",
      "Lý do không đạt hợp lệ"
    ],
  },
};
```

Có thể chọn JSON/data module dùng chung theo kiến trúc repo, miễn:
- canonical header có một nguồn authority;
- import vẫn hỗ trợ alias cũ;
- export luôn dùng canonical.

### Các nhóm field phải bao phủ

- contractor type;
- contractor code;
- contractor name;
- lot code/name;
- JV members;
- validity;
- validity clarification;
- validity failure reason;
- capacity/experience;
- capacity clarification;
- capacity failure reason;
- technical evaluation;
- technical clarification;
- technical failure reason;
- financial clarification;
- bid/ranking/proposed award price;
- low-price decision.

---

# 6. PHASE 3 — P0: Đồng bộ Excel với phương pháp đánh giá kỹ thuật

## 6.1. Vấn đề đã xác nhận

Domain hiện có:
- `pass_fail`
- `score`

Các trường hợp như:
- tư vấn;
- kết hợp giữa kỹ thuật và giá;
- phương pháp dựa trên kỹ thuật;

có thể/bắt buộc dùng **chấm điểm**.

Nhưng backend Excel hiện vẫn gắn dropdown:

```text
Đạt
Không đạt
```

cho cột `Đánh giá kỹ thuật`.

Trong khi frontend importer lại từ chối `Đạt/Không đạt` khi package bắt buộc dùng score.

Đây là contract contradiction.

## 6.2. Tạo một backend resolver tương đương domain rule frontend

Không copy-paste logic rời rạc không test.

Backend phải resolve technical method từ package/domain data bằng cùng semantics với frontend:

- `linh_vuc`
- `hinh_thuc_lua_chon`
- `phuong_thuc_lua_chon`
- `phuong_phap_danh_gia`
- metadata technical evaluation method nếu có
- các field legacy cần thiết

Ưu tiên tạo pure function/backend domain module.

Ví dụ:

```python
resolve_technical_evaluation_method(package) -> "pass_fail" | "score" | ""
```

Có unit tests đối chiếu với rule hiện tại frontend.

## 6.3. Excel behavior

### Nếu PASS_FAIL

Cột `Đánh giá kỹ thuật`:
- dropdown `Đạt`, `Không đạt`;
- import giữ tương thích text.

### Nếu SCORE

Cột `Đánh giá kỹ thuật`:
- không dùng dropdown pass/fail;
- numeric;
- cho phép decimal nếu nghiệp vụ cho phép;
- validate >= 0;
- nếu package/criteria có min/max score thì kiểm tra tương ứng;
- không biến `0` thành blank;
- không biến số thập phân thành integer;
- import phải preserve score.

### Nếu chưa resolve được method

Không tự đoán.
Phải chọn behavior an toàn:
- không ép dropdown sai;
- hoặc báo explicit diagnostic tùy flow hiện tại.

---

# 7. PHASE 4 — P0/P1: Round-trip Excel contract tests

Đây là test quan trọng nhất để khóa lỗi.

## 7.1. Test workflow thực

Phải có test theo chuỗi:

```text
DB/model
↓
prepare_danhgiahsdt_template_spec()
↓
workbook
↓
sheet rows / JSON representation
↓
parseBidEvaluationImport()
↓
canonical frontend model
↓
save/persist mapping
↓
semantic equality
```

Không chỉ test export riêng và importer riêng.

## 7.2. Ma trận tối thiểu

Phải test:

### Package form
- non-lot
- multi-lot

### Bid mode
- 1G1T
- 1G2T technical
- 1G2T financial

### Contractor
- độc lập
- liên danh

### Technical method
- pass/fail
- score

### Field values
- null
- empty string
- `0`
- `false`
- decimal score
- Unicode Vietnamese
- clarification text
- failure reason text
- ranking price
- proposed award price
- low-price approval false

### Round-trip assertions
Đặc biệt kiểm tra:
- `False` không bị mất do `x or ""`;
- `0` không bị biến thành blank;
- canonical header export được importer hiểu;
- alias cũ vẫn import được.

---

# 8. PHASE 5 — P1: Củng cố version/snapshot bằng invariant tests

Không chỉ thêm case regression riêng.

## Invariants cần khóa

### Package latest invariant

Trong mỗi family phù hợp với domain:

```text
(rootId, plan snapshot)
```

tối đa một version được `isLatest`.

### Version inheritance invariant

Tạo version mới không được tự reset:
- status;
- assignee;
- owned child rows;
- opening data;
- package-linked evaluation data;

trừ field có policy reset rõ.

### Cold cache invariant

Cùng một operation:
- cold cache;
- warm cache;

phải cho kết quả domain tương đương.

### Delete latest invariant

Xóa latest:
- predecessor hợp lệ trong cùng snapshot/family trở thành latest;
- package không "biến mất" khỏi plan snapshot do thiếu hydration.

### Entry-point equivalence

Cùng một chỉnh sửa version-sensitive:
- từ detail page;
- từ list/modal;

phải đi qua cùng domain/version command hoặc cho kết quả hoàn toàn tương đương.

---

# 9. PHASE 6 — P1: Refactor backend theo strangler pattern

Chỉ bắt đầu khi P0 test xanh.

## 9.1. `backend/sync/mapper.py`

Không rewrite toàn bộ.

Tách dần theo responsibility:

```text
backend/sync/
    mapper.py
    plan_mapper.py
    package_mapper.py

backend/evaluation/
    repository.py
    persistence.py
    policy.py

backend/opening/
    persistence.py

backend/packages/
    version_repository.py
```

### Mục tiêu

`mapper.py` không nên đồng thời:
- canonicalize;
- quyết định business policy;
- persist SQL;
- quản lý evaluation phase;
- quản lý opening child;
- quản lý version.

Mỗi extraction phải:
1. có test trước;
2. di chuyển code;
3. giữ signature/adapter cũ;
4. chạy regression;
5. mới xóa dead code.

## 9.2. `backend/procurement_import/routes.py`

Tách route orchestration khỏi service/domain.

Đích:

```text
routes.py
plan_import_service.py
notice_import_service.py
opening_import_service.py
enrichment_service.py
import_session_service.py
error_mapping.py
```

Route chỉ nên:
- auth/context;
- validate request;
- gọi service;
- map HTTP response.

Không để route giữ:
- source collection logic;
- cache decision phức tạp;
- canonical mapping;
- background progress algorithm;
- transaction business logic.

---

# 10. PHASE 7 — P1: Refactor frontend workflow lớn

Các file cần ưu tiên:

- `frontend/packages/BidProcessWorkflow.js`
- `frontend/packages/BidderGoodsWorkflow.js`
- `frontend/packages/BidEvaluationRowRenderer.js`

Không chia theo số dòng đơn thuần.

Tách theo lifecycle/use case:

```text
BidProcessOpeningWorkflow
BidProcessEvaluationWorkflow
BidProcessFinancialWorkflow
BidProcessAwardWorkflow
```

Renderer có thể tách:
- identity cell;
- lot cell;
- technical cell;
- financial cell;
- low-price decision cell.

## Điều kiện

- public behavior không đổi;
- không đổi DOM contract nếu test/E2E đang phụ thuộc trừ khi có migration test;
- giảm source-regex tests dần và tăng behavior tests.

---

# 11. PHASE 8 — P1/P2: MSC schema contract registry

Mục tiêu: ngăn việc sửa parser bằng alias ngẫu nhiên mỗi khi MSC đổi payload.

Tạo schema/operation registry với metadata:

```text
operation
packType
expected root shape
required containers
known aliases
semantic authority
normalizer
validator
fixture
```

Ưu tiên các operation:
- PLAN
- NOTICE
- OPENING_BID
- OPENING_LOT
- OPENING_LOT_DETAIL
- GOODS
- AWARD
- CONTRACTOR

## Nguyên tắc opening

Không được trộn authority:
- bidder-level fields;
- lot relation;
- lot detail;
- invitation requirement;
- submitted guarantee.

Nếu nguồn semantic khác nhau thì model khác nhau.

---

# 12. PHASE 9 — P2: CI song song, không để quality fail che E2E

Hiện `Full CI` chạy tuần tự trong một job lớn.

Nên tách dần thành:

```text
quality
unit-python
unit-js
security
database
integration
e2e
performance
package
release
```

`release` phụ thuộc các job còn lại.

## Mục tiêu

Nếu `quality` fail, vẫn có thể nhìn thấy:
- unit failures;
- integration failures;
- E2E regressions;
- performance regressions.

Không được làm giảm gate; chỉ cải thiện observability và thời gian feedback.

---

# 13. PHASE 10 — P2: AI/RBAC regression protection

Kiến trúc AI hiện đang theo hướng server-owned permission context + deterministic tools. Phải giữ.

Bổ sung/duy trì test:

- user A không đọc organization B;
- employee không tự trở thành manager bằng prompt;
- active role chỉ có hiệu lực trong organization đã cấp;
- AI tool không nhận arbitrary SQL;
- aggregate tool chỉ dùng enum metric được hỗ trợ;
- list result luôn scope theo permission;
- prompt injection không thể đổi permission context;
- audit/redaction không ghi raw secret/token.

Không rewrite AI tool layer thành "LLM sinh SQL tự do".

---

# 14. Kiểm thử bắt buộc cuối cùng

Tùy thay đổi thực tế, tối thiểu phải chạy:

```bash
npm run check:ci
```

Sau đó chạy riêng các test liên quan nếu `check:ci` không bao trùm đủ.

Khi refactor lớn:
- Python unit/integration;
- JS unit;
- Excel tests;
- procurement import tests;
- package version tests;
- Playwright smoke;
- role/workflow E2E liên quan.

Với CI workflow thay đổi:
- lint/parse workflow;
- verify dependencies/needs;
- không làm mất artifact diagnostics.

---

# 15. Definition of Done tổng

Chỉ coi task hoàn tất khi:

1. `main`-equivalent working tree pass canonical quality.
2. Không tăng debt baseline để lách CI.
3. Excel do hệ thống export import lại không mất:
   - clarification;
   - failure reason;
   - false;
   - zero;
   - score.
4. Gói score không còn nhận dropdown `Đạt/Không đạt`.
5. Gói pass/fail vẫn hoạt động như cũ.
6. Multi-lot và 1G2T không regression.
7. Version/snapshot critical tests pass.
8. MSC opening/import critical tests pass.
9. RBAC/AI tests không regression.
10. Không có schema/data migration không test.
11. Báo cáo cuối nêu:
    - root cause;
    - files changed;
    - tests added;
    - commands executed;
    - test results;
    - remaining risks/debt;
    - việc nào của P1/P2 chưa thực hiện.

---

# 16. Thứ tự triển khai khuyến nghị

## PR/commit group A — P0 correctness
- Fix F401/BLE001.
- Excel shared header contract.
- Fix technical method Excel behavior.
- Add round-trip tests.

## PR/commit group B — version + import hardening
- Version invariants.
- MSC schema/semantic validators.
- Improve diagnostics.

## PR/commit group C — backend refactor
- Extract mapper responsibilities.
- Extract procurement import services.

## PR/commit group D — frontend refactor
- Split large workflows/renderers.
- Increase behavior tests.

## PR/commit group E — CI architecture
- Parallelize CI.
- Preserve all gates and artifacts.

Không gộp tất cả thành một commit khổng lồ nếu không cần thiết.
