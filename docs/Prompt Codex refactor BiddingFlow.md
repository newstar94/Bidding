Bạn đang làm việc trực tiếp trên repository BiddingFlow.

Mục tiêu: sửa technical debt và một số vấn đề maintainability/security đã xác định, nhưng TUYỆT ĐỐI không làm thay đổi business behavior hiện tại nếu không cần thiết.

Hãy thực hiện như một senior software engineer: trước tiên đọc code liên quan, hiểu invariant hiện tại, sau đó sửa theo từng bước nhỏ và chạy test sau mỗi nhóm thay đổi.

## Nguyên tắc bắt buộc

1. Không rewrite framework.
2. Không chuyển frontend sang React/Vue.
3. Không thay đổi schema/database migration nếu task không thực sự cần.
4. Không thay đổi semantics authorization hiện tại.
5. Không thêm field masking cho dữ liệu nhạy cảm nếu policy hiện tại cho phép đọc toàn record.
6. Không làm mất backward compatibility của API.
7. Không phá offline sync/outbox/conflict handling.
8. Không thay đổi historical/versioning semantics.
9. Không force-overwrite conflict.
10. Ưu tiên patch nhỏ, dễ review.
11. Không sửa file ngoài scope nếu không có lý do kỹ thuật rõ ràng.
12. Trước khi sửa một invariant quan trọng, tìm test hiện có bao phủ nó.
13. Nếu chưa có test cho bug đang sửa, thêm regression test.
14. Không bỏ hoặc làm yếu security check chỉ để test pass.

## Task 1 — Fix duplicate `_chunked` trong access policy

Kiểm tra:

`backend/shared/access_policy.py`

Hiện có dấu hiệu `_chunked()` được định nghĩa nhiều hơn một lần trong cùng module.

Yêu cầu:

- tìm tất cả definition và caller;
- xác định API thực sự đang được dùng;
- chỉ giữ một implementation chuẩn;
- preserve behavior hiện tại;
- nếu parameter `size` là API hợp lý thì giữ support;
- dùng `_QUERY_CHUNK_SIZE` làm default thay vì hard-code;
- thêm hoặc cập nhật unit test để tránh regression;
- kiểm tra không có function khác bị shadow tương tự trong module.

Không chỉ xóa function một cách cơ học. Hãy xác minh caller trước.

## Task 2 — Fix path boundary validation

Kiểm tra code build/include HTML, đặc biệt `compile_html()` hoặc logic tương đương trong:

`backend/app.py`

Có pattern dạng:

```python
resolved = os.path.realpath(full_path)

if not resolved.startswith(os.path.realpath(project_root)):
    ...
```

String `startswith()` không phải cách an toàn để kiểm tra một path có thực sự nằm trong project root hay không.

Hãy thay bằng boundary check đúng về mặt filesystem, ví dụ dùng:

- `os.path.commonpath`, hoặc
- `pathlib.Path.resolve()` + kiểm tra parent relationship.

Yêu cầu:

- path hợp lệ bên trong root vẫn hoạt động;
- path traversal `../` bị reject;
- sibling path có prefix giống root nhưng nằm ngoài root phải bị reject;
- symlink escape phải bị reject nếu platform/runtime cho phép test;
- Windows/POSIX behavior không bị xử lý sai một cách rõ ràng;
- thêm regression tests cho ít nhất:
  - normal child path;
  - `../`;
  - prefix collision;
  - resolved path outside root.

Không mở rộng scope thành rewrite template compiler.

## Task 3 — Refactor `access_policy.py`

`backend/shared/access_policy.py` đang có quá nhiều responsibility.

Hãy phân tích module và refactor theo hướng chia nhỏ policy domain nhưng giữ public API tương thích.

Các concern có thể tách gồm:

- platform/organization role;
- membership;
- active persona;
- module permissions;
- assignment scope;
- plan/package/contract lineage;
- version ownership;
- document/export capability.

Không bắt buộc phải dùng đúng tên module trên. Hãy dựa vào code thực tế.

Mục tiêu:

- `access_policy.py` trở thành facade/orchestrator mỏng hơn;
- business rules được nhóm theo responsibility;
- tránh circular imports;
- không duplicate query/helper logic;
- giữ import path/public functions hiện tại nếu nhiều caller đang dùng chúng;
- không đổi authorization semantics.

Sau refactor phải chạy toàn bộ test authorization có liên quan.

Đặc biệt xác minh:

- organization isolation;
- manager persona downgrade;
- specialist assignment;
- plan/package lineage access;
- historical version access;
- export/document capability;
- unauthorized access vẫn bị deny.

Nếu việc refactor toàn bộ quá rủi ro trong một patch, hãy thực hiện theo incremental extraction và dừng ở boundary an toàn thay vì rewrite lớn.

## Task 4 — Tìm các god-module tương tự

Sau khi xử lý `access_policy.py`, rà soát các module lớn trong:

- sync;
- document worker;
- backend app/bootstrap;
- schema/migration registry.

Không refactor tất cả một cách tự động.

Chỉ báo cáo:

- file;
- số responsibility chính;
- dependency/coupling nổi bật;
- rủi ro;
- đề xuất extraction boundary.

Chỉ thực hiện thêm refactor nếu boundary rất rõ, test coverage đủ và thay đổi nhỏ.

## Task 5 — Bảo vệ offline sync invariants

Đọc kỹ implementation liên quan:

- durable mutation outbox;
- push;
- authoritative pull;
- row-version conflict;
- conflict quarantine/Conflict Center;
- FULL_SYNC_REQUIRED;
- SYNC_VISIBILITY_RESET_REQUIRED;
- WebSocket delta trigger;
- polling fallback.

Không thay đổi behavior này trừ khi test chứng minh có bug.

Nếu refactor code dùng chung, phải bảo toàn các invariant:

1. Mutation local không được mất khi offline.
2. Pull authoritative không được vô tình overwrite pending local mutation khi outbox chưa durable.
3. Row-version conflict không được auto force-merge.
4. Duplicate push phải có idempotency protection.
5. WebSocket chỉ là notification/trigger, không phải source of truth.
6. Mất WebSocket vẫn có polling/delta-sync fallback.
7. Switching organization/workspace không được áp event cũ vào workspace mới.

Chạy test liên quan nếu chúng tồn tại.

## Task 6 — PostgreSQL compatibility layer review

Tìm lớp compatibility chuyển SQL placeholder kiểu SQLite `?` sang PostgreSQL `%s`.

Không rewrite toàn bộ repository.

Chỉ:

- đọc parser;
- tìm các edge case;
- xem có test cho:
  - `?` trong string literal;
  - comments;
  - JSON operators;
  - escaped strings;
  - PostgreSQL-specific syntax;
- bổ sung regression tests nếu coverage thiếu.

Nếu tìm thấy bug thực sự, sửa parser bằng patch nhỏ.

Nếu không tìm thấy bug, không thay code chỉ để “clean up”.

## Task 7 — Python static quality

Đọc:

`pyproject.toml`

và custom Python quality scripts hiện có.

Hiện Ruff có thể chỉ enable một tập rule khá hẹp.

Không bật hàng loạt rule rồi sửa hàng trăm warning không liên quan.

Hãy:

1. đánh giá các rule có giá trị cao;
2. đề xuất một tập bổ sung nhỏ;
3. chỉ enable rule nếu codebase hiện tại có thể đạt được với patch hợp lý;
4. không làm CI noisy vô ích.

Ưu tiên các nhóm giúp phát hiện:

- shadowing;
- duplicate definitions;
- dangerous exception handling;
- obvious bug patterns;
- unused/dead imports;
- mutable defaults hoặc tương đương nếu tool hỗ trợ.

## Task 8 — Test coverage cho critical paths

Không chạy theo coverage percentage một cách máy móc.

Xác định test coverage của các khu vực critical:

- authorization;
- versioning;
- offline sync/conflict;
- document provenance;
- legal binding/version resolution;
- billing/commercial policy;
- destructive lifecycle operations.

Nếu một invariant critical hoàn toàn thiếu regression test, thêm test focused.

Không viết test chỉ để tăng số phần trăm.

## Cách làm việc

Trước khi edit, hãy in ra:

### 1. Findings
- vấn đề xác nhận được;
- file/function liên quan;
- mức độ rủi ro;
- test hiện có.

### 2. Patch plan
Chia thành patch nhỏ:

- Patch A: low-risk correctness fixes;
- Patch B: regression tests;
- Patch C: incremental refactor;
- Patch D: lint/quality nếu cần.

Sau đó mới sửa code.

## Testing

Sau mỗi nhóm thay đổi:

1. chạy test targeted trước;
2. chạy lint/static checks liên quan;
3. sau cùng chạy test suite rộng nhất khả thi.

Tìm command thật sự từ repo (`package.json`, `pyproject.toml`, CI config, scripts), không tự đoán command.

Nếu full suite quá lớn hoặc phụ thuộc external service, chạy phần khả thi và ghi rõ phần chưa chạy.

Không claim “all tests pass” nếu chưa thực sự chạy.

## Output cuối cùng

Khi hoàn tất, trả về báo cáo gồm:

### Changes made
Mỗi thay đổi ghi:
- file;
- function/module;
- lý do;
- behavior trước;
- behavior sau.

### Tests
Liệt kê chính xác các command đã chạy và kết quả.

### Remaining risks
Các vấn đề chưa sửa.

### Recommended next steps
Tối đa 5 việc, sắp xếp theo priority.

### Diff review notes
Highlight những đoạn reviewer nên kiểm tra kỹ.

## Definition of Done

Task chỉ được coi là hoàn thành khi:

- duplicate `_chunked` được xử lý sạch;
- path boundary bug được fix và có regression test;
- authorization behavior không đổi;
- `access_policy.py` được giảm coupling theo cách incremental và reviewable, nếu test coverage cho phép;
- sync invariants không bị phá;
- targeted tests pass;
- không có migration/schema change ngoài ý muốn;
- không có API breaking change;
- không có security check bị làm yếu;
- báo cáo rõ phần nào đã chạy và phần nào chưa verify.

Ưu tiên correctness và preservation of invariants hơn “code đẹp”.