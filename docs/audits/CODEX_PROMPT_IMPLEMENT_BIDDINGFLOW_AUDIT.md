# PROMPT CHO CODEX — TRIỂN KHAI CÁC KẾT LUẬN AUDIT BIDDINGFLOW

## 0. Vai trò và mục tiêu

Bạn là kỹ sư phần mềm cấp cao chịu trách nhiệm **trực tiếp đọc, sửa, kiểm thử và hoàn thiện mã nguồn** của dự án BiddingFlow tại repository:

- Repository: `https://github.com/newstar94/Bidding`
- Nhánh mục tiêu: nhánh hiện tại của workspace, ưu tiên `main` nếu không có nhánh làm việc riêng.
- Báo cáo đầu vào: `BIDDINGFLOW_APPLICATION_AUDIT_2026-07-30.md`.
- Commit đã được audit trong báo cáo: `b850aaabdc4b22eee9052664d3c80b0919ed67f7`.

Mục tiêu là triển khai các quyết định và roadmap đã được phê duyệt trong báo cáo audit, theo đúng thứ tự rủi ro, **không viết lại toàn bộ ứng dụng**, không làm thay đổi nghiệp vụ đã ổn định một cách không cần thiết và không dừng ở việc viết kế hoạch.

Bạn phải:

1. Đọc toàn bộ repository và toàn bộ file audit trước khi sửa.
2. Kiểm tra trạng thái thực tế tại `HEAD`; không giả định line number trong báo cáo còn chính xác.
3. Xác định hạng mục nào đã được sửa sau commit audit, hạng mục nào còn tồn tại và hạng mục nào chỉ được sửa một phần.
4. Viết regression test trước đối với các thay đổi có rủi ro P0/P1.
5. Sửa code thật, migration thật, test thật và tài liệu thật.
6. Chạy các bộ kiểm tra phù hợp sau từng nhóm thay đổi và chạy full gate trước khi kết thúc.
7. Không chỉ tạo plan, TODO, issue hoặc bản mô tả thay cho implementation.

---

## 1. Quy tắc bắt buộc trước khi sửa code

### 1.1. Khảo sát repository

Thực hiện và ghi lại kết quả tối thiểu:

```bash
git status --short
git rev-parse HEAD
git log -1 --oneline
python --version
node --version
npm --version
```

Sau đó đọc tối thiểu:

- `README.md`;
- `.python-version`;
- `package.json` và `package-lock.json`;
- `pyproject.toml`;
- các file `AGENTS.md`, `CONTRIBUTING.md`, tài liệu hoặc rule cục bộ nếu tồn tại;
- toàn bộ file `BIDDINGFLOW_APPLICATION_AUDIT_2026-07-30.md`;
- các workflow trong `.github/workflows/`;
- kiến trúc backend, frontend, sync/offline, auth, document worker, audit, UI primitives và CSS liên quan tới từng finding.

Không dựa duy nhất vào đường dẫn/dòng trong báo cáo. Dùng tìm kiếm symbol, call site và test để tìm implementation hiện tại.

### 1.2. Baseline trước thay đổi

Chạy baseline phù hợp với môi trường. Tối thiểu:

```bash
python -m compileall -q backend scripts tests
python -m pytest -q
node --test tests/js/*.test.mjs
npm run lint:security
npm run audit:vendor
npm run build:secure
```

Nếu môi trường đáp ứng đầy đủ, chạy thêm:

```bash
npm test
npm run package:production
```

Đối với E2E cần PostgreSQL/server, dựng môi trường test riêng theo README và chạy các script hiện có liên quan tới auth, role, offline sync, lifecycle, multi-assignee, joint venture, low-price conflict, UI quality, performance và N+1.

Nếu baseline có lỗi sẵn:

- không bỏ qua;
- ghi rõ lỗi nào có trước thay đổi;
- phân biệt lỗi môi trường với lỗi code;
- sửa lỗi code thuộc phạm vi audit;
- không hạ threshold hoặc tắt test để làm pipeline xanh giả tạo.

### 1.3. Kiểm kê finding tại HEAD

Tạo file tạm hoặc tài liệu triển khai `docs/audit-implementation-status.md` với bảng:

| ID | Trạng thái tại HEAD | Bằng chứng | Quyết định | Test bảo vệ |
|---|---|---|---|---|
| BF-SEC-01 | open/partial/fixed | file + symbol/test | implement/retain | test name |

Bao phủ toàn bộ ID sau đây:

```text
BF-SEC-01, BF-LEGAL-01, BF-SYNC-01, BF-OPS-01, BF-SEC-02,
BF-AUDIT-01, BF-SYNC-02, BF-SYNC-03, BF-DOC-01, BF-MEDIA-01,
BF-TEST-01, BF-ARCH-01, BF-ARCH-02, BF-ARCH-03, BF-ARCH-04,
BF-ARCH-05, BF-ARCH-06, BF-ARCH-07,
H-C01, H-C02, H-C03, H-M01, H-M02, H-M03, H-M04, H-M05, H-M06, H-m01
```

Quy tắc:

- Nếu finding đã được sửa đầy đủ, không viết lại. Bổ sung test hoặc tài liệu còn thiếu nếu cần.
- Nếu mới sửa một phần, hoàn thiện theo acceptance criteria.
- Nếu implementation hiện tại tốt hơn phương án audit, giữ phương án tốt hơn nhưng phải chứng minh bằng test và giải thích.
- Không bỏ một finding chỉ vì line number đã dịch chuyển.

---

## 2. Các quyết định sản phẩm đã chốt — không hỏi lại

Các quyết định sau là yêu cầu bắt buộc:

### DEC-01 — Thực hiện P0/P1 trước

Thứ tự bắt buộc:

1. bảo mật và toàn vẹn dữ liệu;
2. vận hành/readiness và audit;
3. state/router/component architecture;
4. CSS/data seam;
5. P2 scale/performance sau khi các seam ổn định.

Regression test phải có trước các sửa đổi P0/P1 có rủi ro cao.

### DEC-02 — Dữ liệu nhạy cảm default-deny

Dữ liệu thuộc nhóm sau mặc định bị ẩn và từ chối truy cập:

- `identity`;
- `financial`;
- `signature`, con dấu và media tương đương.

Chỉ người dùng có capability riêng tương ứng mới được xem. Áp dụng nhất quán cho:

- API response;
- sync/conflict response;
- protected media/image download;
- document/Word/Excel export;
- activity/history projection;
- WebSocket hoặc notification payload nếu có dữ liệu nhạy cảm.

Mọi lượt cấp/revoke capability và mọi lượt tải/xuất dữ liệu nhạy cảm phải có audit phù hợp.

### DEC-03 — Không phục sinh dữ liệu đã xóa từ stale client

- Client offline cũ không được tự tạo lại record đã bị xóa.
- Stale update không được ngầm chuyển thành insert.
- Restore phải là command riêng.
- Restore yêu cầu quyền riêng, `reason`, actor, mutation/request ID và immutable audit.
- Nếu tombstone/cursor đã quá retention, trả `FULL_SYNC_REQUIRED` thay vì đoán.

### DEC-04 — Không tự điền thông tin pháp lý

Không suy luận hoặc bịa thông tin pháp nhân, hạ tầng, retention, region, backup, incident contact hay luật áp dụng.

Nếu thiếu legal facts:

- giữ production-public blocker rõ ràng;
- tạo fact sheet/template có owner/evidence/status;
- thêm kiểm tra CI hoặc deployment gate phù hợp để không phát hành public với placeholder chưa được xác nhận;
- không tự thay `[TODO]` bằng nội dung giả định.

### DEC-05 — Refactor tăng dần, không rewrite

Tạo các module sâu theo roadmap:

- `RouteRegistry`;
- `PackageWorkspaceState`;
- `WorkspaceDataStore`;
- `LifecyclePolicy`;
- `PackageDetailModule`;
- các UI primitive chuẩn.

Không viết lại toàn bộ frontend/backend và không thêm wrapper mỏng chỉ để tăng số file.

### DEC-06 — Tạm hoãn chuyển form gói thầu khỏi modal

Không chuyển form tạo/sửa gói thầu dài sang routed workbench/page-sized flow trong đợt này.

Vẫn phải sửa trong modal hiện tại nếu liên quan:

- bảo mật;
- mất dữ liệu;
- validation;
- focus/keyboard/accessibility;
- error summary;
- khả năng khôi phục draft nếu có thể triển khai an toàn mà không redesign toàn luồng.

---

## 3. Thứ tự triển khai bắt buộc

Thực hiện theo các phase dưới đây. Không bắt đầu code splitting hoặc redesign lớn trước khi phase P0/P1 hoàn tất và test xanh.

---

# PHASE 0 — ĐÓNG CÁC BOUNDARY RÕ NHẤT

## 4. BF-SEC-01 — Không để conflict response làm lộ record

### 4.1. Vấn đề cần kiểm tra

Kiểm tra toàn bộ upsert/delete/conflict path, đặc biệt các module tương đương:

- `backend/sync/record_validator.py`;
- `backend/sync/deletion_service.py`;
- `backend/sync/service.py`;
- serializer/response/projection/access policy liên quan.

Tìm mọi đường đi có thể:

1. đọc record hiện tại;
2. so sánh version;
3. đưa `serverRecord`, row version hoặc dữ liệu hiện tại vào lỗi;
4. trước khi người gọi được xác nhận có quyền đọc record.

### 4.2. Yêu cầu implementation

- Authorize trước mọi fetch/compare có dữ liệu được phản chiếu ra client.
- Phân biệt rõ:
  - `can_write_record`;
  - `can_read_record`;
  - quyền xem field nhạy cảm.
- Khi không có quyền write:
  - fail fast;
  - response không cho phép record enumeration;
  - không trả current version, server record, before/after, field list nhạy cảm hay metadata có thể suy ra sự tồn tại của record ngoài error contract hữu hạn.
- Chỉ trả `serverRecord` nếu:
  1. người gọi có quyền đọc record;
  2. record đã được project/redact theo capability nhạy cảm;
  3. contract thực sự cần record để resolve conflict.
- Không serialize raw database model làm conflict DTO mặc định.
- Tạo typed/bounded conflict DTO riêng.

### 4.3. Regression test bắt buộc

Viết test trước khi sửa, tối thiểu:

1. Upsert, cùng organization, biết ID, không có permission, `expectedVersion` sai.
2. Delete, cùng organization, biết ID, không có permission, `expectedVersion` sai.
3. Có quyền write nhưng không có quyền xem `financial`.
4. Có quyền đọc record nhưng không có quyền xem `identity`/`signature`.
5. Cross-tenant ID.
6. Authorized conflict trả đúng DTO đã redact.

Acceptance:

- denied response không chứa record, current version hoặc dữ liệu nhạy cảm;
- không khác biệt response theo cách dễ dùng để enumeration;
- authorized response vẫn đủ dữ liệu để client xử lý conflict;
- test integration chạy bằng database thực tế nếu boundary phụ thuộc PostgreSQL.

---

## 5. BF-OPS-01 — Readiness phải đọc audit-chain health

### 5.1. Yêu cầu

Kiểm tra:

- `backend/shared/audit_monitor.py`;
- `/health/live`;
- `/health/ready`;
- startup/lifespan state;
- metrics và deployment probe.

Readiness phải thỏa đồng thời:

```text
startup_complete && application_ready && database_ok
```

Trong đó `application_ready` phải phản ánh fail-closed state của audit-chain monitor và các trạng thái critical tương đương.

### 5.2. Response contract

- Khi không ready, trả HTTP `503`.
- Chỉ trả reason code hữu hạn, ví dụ `STARTUP_INCOMPLETE`, `DATABASE_UNAVAILABLE`, `AUDIT_CHAIN_INVALID`, `AUDIT_VERIFIER_ERROR`.
- Không lộ stack trace, SQL, path, secret hoặc nội dung audit record.
- `/health/live` không bị biến thành readiness.

### 5.3. Test bắt buộc

- valid → ready 200;
- invalid audit chain → ready 503;
- verifier exception → ready 503;
- database unavailable → ready 503;
- transition valid → invalid → valid theo semantics hiện tại;
- test staging/probe script nếu repository có deployment drill.

---

## 6. Quick UI/UX fixes không gây redesign

### 6.1. Không render raw internal ID

Kiểm tra `MultiAssigneeSelect`, package table và mọi fallback tương tự.

- Không hiển thị `user-*`, UUID hoặc technical ID cho người dùng.
- Dùng display name đã cache hoặc nhãn an toàn như `Nhân sự không còn hoạt động`.
- Trong lúc hydrate dùng skeleton/placeholder, không flash ID.
- Mobile hiển thị chip/tên đầu tiên và `+N`, không nối chuỗi quá dài.
- Thêm test missing user, deactivated user, delayed hydration, mobile rendering.

### 6.2. Focus indicator

- Chuẩn hóa `outline` tối thiểu 2 px với `outline-offset` phù hợp.
- Focus indicator phải đạt contrast tối thiểu 3:1 trên các surface chính.
- Không dùng `outline: none` nếu không có indicator thay thế tốt hơn.
- Không đổi border width gây layout shift khi focus.
- Thêm keyboard/screenshot regression cho input, select, button, tabs, sidebar.

### 6.3. Tooltip sidebar

- Tooltip khi sidebar collapse phải xuất hiện cả khi `:focus-visible`, không chỉ hover.
- Nếu có tooltip primitive, hỗ trợ focus tức thời và Escape dismiss.

---

## 7. BF-LEGAL-01 — Production legal blocker

### 7.1. Không được làm

- Không tự điền 27 placeholder bằng suy đoán.
- Không lấy `.env.example`, cấu hình local hoặc tên repository làm legal fact.
- Không tuyên bố TLS, encryption, backup, retention, region hoặc SLA nếu chưa có evidence vận hành.

### 7.2. Việc phải làm

1. Quét toàn bộ trang Terms/Privacy/Security để kiểm kê placeholder và nội dung cần xác minh.
2. Tạo `docs/legal-fact-sheet.md` hoặc file tương đương, gồm:
   - fact;
   - owner;
   - evidence/link nội bộ;
   - trạng thái `missing/verified/approved`;
   - ngày xác nhận;
   - người phê duyệt.
3. Thêm validation script, ví dụ `scripts/check_legal_readiness.py` hoặc tương đương:
   - phát hiện `[TODO]`/placeholder chưa được phê duyệt;
   - có chế độ cảnh báo cho dev;
   - fail production-public packaging/deploy gate khi legal facts chưa hoàn chỉnh;
   - không làm hỏng local development ngoài mục tiêu đã định.
4. Kết nối script với CI/production packaging/deploy checklist phù hợp.
5. Thêm test cho script và false-positive cases.

---

# PHASE 1 — TOÀN VẸN DỮ LIỆU, QUYỀN NHẠY CẢM VÀ TRUY VẾT

## 8. BF-SYNC-01 — Tombstone-aware mutation và explicit restore

### 8.1. Khảo sát

Đọc đầy đủ:

- payload validation;
- mutation request contract;
- record writer/repository;
- tombstone/delete policy;
- sync version/cursor retention;
- idempotency;
- offline client outbox và retry;
- schema/migration hiện tại.

Tại thời điểm audit, `baseSyncVersion` mới được validate cú pháp và stale update có nguy cơ insert lại record. Tại thời điểm kiểm tra gần nhất, `clientMutationId` vẫn chỉ được validate khi có, chưa được bắt buộc cho request có mutation. Phải kiểm tra lại `HEAD` và sửa nếu còn tồn tại.

### 8.2. Mutation ID bắt buộc

- Mọi request có upsert/delete/restore mutation phải có `clientMutationId` hợp lệ.
- Request read-only không bắt buộc nếu contract hiện tại không cần.
- Idempotency phải được enforce server-side theo tenant/user/workspace và mutation identity phù hợp.
- Retry cùng mutation không tạo duplicate side effect/audit/outbox event.
- Mutation ID phải xuất hiện trong audit event và observability correlation nhưng không lộ dữ liệu nhạy cảm.

### 8.3. Tombstone semantics

Khi record hiện tại không còn tồn tại:

- không mặc định insert;
- kiểm tra tombstone cùng ID và tenant;
- nếu mutation là stale update và `delete_version > baseSyncVersion`, trả conflict code `RECORD_DELETED` hoặc contract typed tương đương;
- nếu tombstone/cursor quá cũ so với retention, trả `FULL_SYNC_REQUIRED`;
- chỉ create mới khi request thật sự là create theo contract rõ ràng, không phải update có `expectedVersion`/base state cũ.

Phải xử lý đúng race condition:

- delete đồng thời với offline update;
- delete rồi restore;
- duplicate restore;
- create cùng ID sau retention;
- cross-tenant tombstone;
- partial batch rollback.

### 8.4. Restore command riêng

Thiết kế command/endpoint/service rõ ràng:

```text
restoreRecord({ table, id, reason, expectedDeleteVersion, clientMutationId })
```

Yêu cầu:

- capability/permission riêng;
- reason bắt buộc và có giới hạn độ dài;
- validate tenant và record type;
- restore transactionally;
- immutable audit trong cùng transaction;
- idempotent;
- không cho client chỉnh sửa stale payload rồi tự phục hồi ngầm;
- projection response theo sensitive policy.

### 8.5. Migration

Nếu cần thêm schema/index/constraint:

- tạo migration mới theo registry bất biến hiện có;
- không sửa migration đã phát hành;
- hỗ trợ PostgreSQL 17;
- đảm bảo tenant constraints;
- có forward verification;
- không tự động hạ schema khi rollback ứng dụng.

### 8.6. Test bắt buộc

- stale offline update sau delete → `RECORD_DELETED`, không insert;
- tombstone hết retention/cursor quá cũ → `FULL_SYNC_REQUIRED`;
- create mới hợp lệ không bị chặn nhầm;
- explicit restore allow/deny;
- restore thiếu reason;
- restore duplicate/retry idempotent;
- restore audit đầy đủ;
- batch có một conflict không để partial commit ngoài semantics đã định;
- client outbox hiểu các code mới và không lặp vô hạn.

---

## 9. BF-SEC-02 — Capability cho identity/financial/signature

### 9.1. Mô hình quyền

Tạo hoặc hoàn thiện policy tập trung với interface rõ ràng:

```text
can_view_record(context, record)
can_view_identity(context, record)
can_view_financial(context, record)
can_view_signature(context, record)
project_record(context, record, purpose)
```

Không dựa chỉ vào module `view`.

### 9.2. Phạm vi áp dụng

Quét toàn bộ call site và áp dụng nhất quán cho:

- API list/detail;
- sync pull/push/conflict;
- protected image/media;
- nhà thầu, chuyên gia, nhân sự, hợp đồng và dữ liệu ngân hàng/tài chính;
- chữ ký, con dấu, ảnh scan;
- Word/Excel/PDF/document export;
- background document jobs;
- notifications/WebSocket payload;
- activity feed/audit viewer;
- admin preview nếu có.

### 9.3. Redaction/projection

- Default deny.
- Module view chỉ trả reference data tối thiểu cần cho UX.
- Không trả field rồi chỉ ẩn bằng frontend.
- Redaction phải ổn định và có schema/DTO rõ ràng.
- Không để cache, offline store hoặc service worker lưu field người dùng không có quyền.
- Khi quyền bị revoke, lần sync/refresh tiếp theo phải loại dữ liệu không còn được phép; thiết kế cache invalidation phù hợp.

### 9.4. Audit quyền nhạy cảm

Ghi audit cho:

- grant/revoke capability;
- protected media download;
- export chứa dữ liệu nhạy cảm;
- restore hoặc privileged access đặc biệt.

Không ghi raw secret/PII không cần thiết vào audit.

### 9.5. Test matrix

Tạo matrix theo role × module permission × capability × endpoint/purpose:

- super admin;
- manager;
- employee;
- assigned/unassigned;
- identity allow/deny;
- financial allow/deny;
- signature allow/deny;
- API/media/export/conflict/offline.

Mỗi protected surface phải có test allow và deny.

---

## 10. BF-AUDIT-01 — Audit mọi mutation vật chất trong cùng transaction

### 10.1. Tách hai khái niệm

- **Immutable audit evidence**: dữ liệu phục vụ truy vết/tranh chấp, không sửa/xóa tùy tiện.
- **Activity feed**: bản trình bày dễ đọc cho người dùng.

Hai lớp liên kết bằng event ID nhưng không đồng nhất schema.

### 10.2. Audit event tối thiểu

Mọi create/update/delete/restore vật chất phải ghi trong cùng transaction với business mutation:

- event ID;
- organization/tenant;
- actor ID và actor type;
- request/client mutation ID;
- action;
- target table/type/ID;
- root aggregate/package/contract ID nếu có;
- timestamp server;
- danh sách field thay đổi;
- before hash/after hash;
- reason nếu nghiệp vụ yêu cầu;
- correlation ID;
- redaction classification.

Không ghi password, token, secret, full signature image hoặc PII raw không cần thiết.

### 10.3. Coverage matrix

Bao phủ tối thiểu:

- gói thầu;
- hợp đồng;
- biên bản mở thầu;
- phần lô;
- danh mục hàng hóa;
- hàng hóa dự thầu;
- vòng/tiêu chí/kết quả đánh giá;
- báo cáo đánh giá chi tiết;
- nhà thầu/liên danh;
- chuyên gia/nhân sự;
- assignment;
- quyền/capability liên quan hồ sơ;
- tài liệu/upload/delete;
- restore;
- award/lifecycle material transitions.

Tạo bảng table/action → audit handling → test.

### 10.4. UI lịch sử chỉnh sửa

Mặc định hiển thị:

- actor;
- thời điểm;
- hành động;
- đối tượng/bảng;
- field names;
- summary an toàn.

Old/new value:

- chỉ hiển thị với field không nhạy cảm;
- người xem phải có quyền tương ứng;
- identity/financial/signature luôn project/redact theo capability;
- không render technical ID nếu có label an toàn.

### 10.5. Test

- transaction rollback không để audit orphan;
- business commit không thiếu audit;
- retry idempotent không tạo audit duplicate;
- redaction đúng theo capability;
- audit-chain verification vẫn hoạt động;
- create/update/delete/restore matrix pass.

---

## 11. BF-TEST-01 — Quality gate theo rủi ro

### 11.1. Warning cleanup

- Sửa unclosed SQLite/database fixtures bằng context manager/finalizer.
- Xử lý Starlette `TestClient` deprecation theo API được hỗ trợ.
- Bật warnings-as-errors có chọn lọc cho các warning đã dọn.
- Không suppress warning toàn cục nếu chưa xử lý nguyên nhân.

### 11.2. Coverage gate

Không tăng aggregate threshold máy móc để tạo số đẹp. Thiết lập branch/per-module gate cho vùng critical:

- auth/access policy;
- sync service;
- tombstone/restore;
- readiness/startup;
- WebSocket/outbox;
- lot lifecycle;
- document routes/jobs;
- protected media;
- audit projection.

Có baseline hợp lý, owner và cơ chế ratchet không tụt.

### 11.3. Static quality

- Không hạ Ruff/ESLint/security gate.
- Có thể mở rộng rule theo đợt và debt ratchet.
- Không cố sửa hàng trăm cảnh báo ngoài phạm vi làm PR quá lớn, nhưng không tạo debt mới.

---

# PHASE 2 — ROUTER, WORKSPACE STATE VÀ COMPONENT CONTRACT

## 12. BF-ARCH-03 — RouteRegistry

### 12.1. Mục tiêu

Tạo một nguồn chuẩn duy nhất cho parse/serialize/navigate:

```text
RouteRegistry.parse(url) -> AppRoute
RouteRegistry.serialize(route) -> url
RouteRegistry.navigate(route, { replace, preserveDirty })
```

Không feature nào tự split pathname, tự nối URL hoặc tự `pushState` ngoài compatibility seam.

### 12.2. AppRoute tối thiểu

Bao phủ:

```text
{
  packageId,
  workflowTab,
  evaluationRoundId,
  bidId,
  detailTab,
  lotScope
}
```

Không đưa dữ liệu nghiệp vụ nhạy cảm vào URL. Opaque/random record ID được phép nếu cần cho F5/back/forward; server vẫn phải authorize.

### 12.3. Test

- `parse(serialize(state)) === normalizedState`;
- canonical redirect;
- invalid route fallback có chủ đích;
- encode/decode ký tự an toàn;
- back/forward;
- F5;
- deep link;
- lot scope;
- không silent discard dirty state.

---

## 13. PackageWorkspaceState

Tạo state machine/module riêng sở hữu:

```text
{
  packageId,
  workflowTab,
  evaluationRoundId,
  bidId,
  detailTab,
  lotScope,
  dirty,
  draft
}
```

Interface gợi ý:

```text
load(route, model) -> state
transition(event) -> { state, effects }
snapshot() -> serializable route state
subscribe(listener)
dispose()
```

Yêu cầu:

- không lưu parent tab chỉ trên view object;
- một event chỉ có một owner state;
- route và workspace state đồng bộ hai chiều có kiểm soát;
- dispose listener/subscription khi rời feature;
- tránh vòng lặp route/render;
- bảo vệ dirty state;
- F5/back/forward giữ parent + child tab, round, bid và lot.

---

## 14. BF-ARCH-02 — Controller/View và PackageDetailModule

Refactor tăng dần package detail và các controller/view lớn theo workflow. Không chia file cơ học; mục tiêu là thu nhỏ interface và ownership.

Tạo module có lifecycle:

```text
mount(root, { route, store, lifecyclePolicy })
navigate(route)
save(command)
dispose()
```

- Child panel chỉ nhận data/command cần thiết.
- Không truyền toàn bộ mutable controller/view/model nếu không cần.
- Prototype registry có thể giữ tạm cho legacy, nhưng API mới không cài thêm command lên global controller.
- Không tạo pass-through service chỉ chuyển tiếp 1:1.
- Migrate theo vertical slice có test, không big-bang rewrite.
- Mỗi feature phải dispose event listener, observer, timer và subscription.
- Test feature module không được bắt buộc dựng toàn bộ global controller nếu không cần.

---

## 15. BF-ARCH-05 — Backend app composition khi chạm vùng liên quan

Đây là P2, trừ phần app/route đang buộc phải sửa vì P0/P1. Khi chỉnh `backend/app.py`, auth, sync, document hoặc lifecycle routes:

- mỗi feature nên export route list/router rõ ràng;
- app factory chỉ compose dependency, middleware, route và lifespan;
- không để app composition tiếp tục phình bằng logic nghiệp vụ mới;
- không tách wrapper mỏng nếu không giảm interface/coupling;
- giữ route ordering, CSP/static delivery, health và WebSocket behavior;
- thêm route registration/smoke test để tránh mất endpoint.

Không refactor toàn bộ app composition trước P0/P1 chỉ để đổi cấu trúc.

---

## 16. H-M01 — Accessible Tabs primitive

Dùng implementation tốt hiện có ở detailed evaluation làm chuẩn, sau đó hợp nhất.

Yêu cầu:

- `role=tablist`;
- `role=tab`;
- `aria-selected`;
- `aria-controls`/tabpanel linkage;
- roving tabindex;
- Arrow Left/Right hoặc Up/Down theo orientation;
- Home/End;
- focus retention;
- disabled state;
- URL/workspace state integration;
- keyboard và screen-reader test.

Không chỉ thêm ARIA attribute mà thiếu hành vi bàn phím.

---

## 17. H-C01 — Accessible Select/Combobox

- Ngừng tạo select mới bằng `initCustomSelect`.
- Migrate legacy select sang native select hoặc `accessibleCombobox` hiện có.
- Nếu cần mở rộng combobox, giữ interface nhỏ và test đầy đủ.

Test bắt buộc:

- Tab/focus;
- Arrow navigation;
- Enter/Space;
- Escape;
- typeahead;
- disabled/read-only;
- outside click;
- positioning trong modal/scroll frame;
- screen-reader roles/state;
- form validation;
- mobile/touch.

Legacy enhancer chỉ tồn tại sau compatibility seam và phát dev warning/inventory; không được dùng cho call site mới.

---

## 18. H-M02 — Explicit Button/Action contract

Tạo primitive/factory với contract rõ ràng:

```text
Button({
  variant,
  icon,
  label,
  loading,
  disabled,
  ariaLabel,
  type,
  onAction
})
```

- Không suy luận icon/variant từ text, title hoặc regex tiếng Việt ở component đã migrate.
- Không chèn icon sau render bằng MutationObserver cho code mới.
- Loading state không gây double submit.
- Icon-only button bắt buộc có accessible name.
- Runtime enhancer cũ chỉ là compatibility layer, có dev warning và inventory.

---

## 19. H-M04 — Feedback policy

Giảm success toast không cần thiết:

- lỗi field: inline + focus;
- lỗi submit tổng hợp: error summary/banner hoặc popup nghiệp vụ đã duyệt;
- lưu thành công nhìn thấy ngay: silent hoặc trạng thái `Đã lưu lúc…` cạnh action;
- background/non-visible result: toast;
- irreversible/cross-record conflict: modal;
- giữ các cảnh báo nghiệp vụ đã chốt, ví dụ chênh tổng hàng hóa dự thầu khi lưu chính thức.

Không thay đổi hàng loạt copy mà không có test UX/flow.

---

## 20. H-M06 — Authenticated UI/E2E

Bổ sung Playwright/E2E trên ứng dụng thật, không chỉ `page.setContent`:

Viewport tối thiểu:

- 320;
- 375;
- 414;
- 768;
- 1280.

Màn hình/luồng tối thiểu:

- dashboard;
- danh sách gói thầu;
- package detail/workflow;
- detailed evaluation;
- bidder goods;
- form/modal dài;
- assignment/multi-assignee;
- protected data allow/deny.

Kiểm tra:

- axe serious/critical;
- keyboard-only;
- F5/back/deep-link;
- focus restore;
- responsive overflow;
- screenshot regression có chủ đích;
- không hiển thị raw ID.

---

# PHASE 3 — DATA SEAM, LIFECYCLE CONTRACT VÀ CSS

## 21. BF-ARCH-04 — WorkspaceDataStore.transaction

### 21.1. Interface mục tiêu

```text
WorkspaceDataStore.transaction({ tables, mutationId }, mutate)
WorkspaceDataStore.query(selector)
WorkspaceDataStore.subscribe(selector, listener)
```

Outcome typed:

```text
committed | offlineQueued | conflict | rejected
```

### 21.2. Trách nhiệm implementation

Data store chịu trách nhiệm:

- snapshot;
- validation;
- local mutation;
- persistence;
- outbox;
- sync;
- rollback;
- idempotency correlation;
- một lần render notification;
- subscription invalidation.

Bên ngoài không được gán trực tiếp `model.state[table]` cho code mới.

### 21.3. Migration strategy

- Migrate một workflow rủi ro cao trước, ưu tiên bidder goods hoặc package lifecycle.
- Giữ compatibility layer cho legacy.
- Thêm lint/test/grep gate để không phát sinh direct write mới.
- Không migrate toàn bộ ứng dụng trong một commit khổng lồ.
- Sau vertical slice đầu tiên, chứng minh giảm code snapshot/rollback thủ công và giữ offline behavior.

### 21.4. Test

- success online;
- offline queued;
- sync conflict;
- validation reject;
- persistence failure rollback;
- outbox failure;
- rerender một lần;
- retry/idempotency;
- multi-table atomicity theo semantics hiện tại.

---

## 22. BF-ARCH-01 — LifecyclePolicy

Backend là nguồn chuẩn cho status code/transition.

Tạo contract versioned và frontend adapter:

```text
normalizeStatus(value) -> code
allowedTransitions(code, context) -> code[]
fieldPolicy(code, packageType) -> { editable, required, visible }
workflowStep(code, method, lotState) -> step
presentStatus(code) -> { label, tone, icon }
```

Yêu cầu:

- Không so sánh chuỗi label tiếng Việt rải rác trong dashboard/form/timeline/tabs/workflow.
- Label chỉ là presentation.
- Có compatibility mapping cho dữ liệu legacy.
- Có test parity backend/frontend.
- Có version/schema contract và validation khi mismatch.
- Không hard-code transition mới ở nhiều module.

---

## 23. H-C02 — Design source, token và cascade layers

### 23.1. Design source thật

Tạo `design.md` hoặc tài liệu tương đương được review, mô tả:

- token ownership;
- semantic colors;
- typography;
- spacing;
- radius/shadow;
- focus;
- z-index scale;
- component state;
- accessibility requirements;
- legacy compatibility policy.

Không để CSS ghi stamp tới file không tồn tại.

### 23.2. Token architecture

Chọn một nguồn token chuẩn. Các hệ cũ chỉ là alias/compatibility trong giai đoạn migrate.

Dùng cascade layers theo hướng:

```css
@layer tokens, base, components, features, utilities, legacy;
```

- Không bulk rewrite toàn CSS.
- Migrate theo component/feature.
- Tạo z-index scale hữu hạn.
- Không thêm raw color hoặc `!important` mới ngoài compatibility layer khi không có lý do được review.
- Tạo lint/ratchet `no-new-debt` cho:
  - `!important`;
  - raw colors;
  - runtime style mutation;
  - inferred actions;
  - direct model state writes.

### 23.3. Không phá secure build

Mọi thay đổi CSS/JS phải giữ:

- CSP;
- Trusted Types;
- DOMPurify policy;
- secure build;
- production packaging;
- startup performance budget.

---

# PHASE 4 — P2 SAU KHI SEAM ỔN ĐỊNH

Chỉ bắt đầu các mục dưới khi P0/P1 đã xanh và architecture seam cần thiết đã ổn định.

## 24. BF-SYNC-02 — Delta sync paging

Thiết kế snapshot paging:

- `throughVersion` cố định cho một lần pull;
- stable ordering;
- record limit;
- byte limit;
- signed/tamper-resistant continuation cursor;
- tenant/user/workspace binding;
- cursor expiry;
- client chỉ advance durable cursor sau page cuối;
- `FULL_SYNC_REQUIRED` khi cursor quá cũ;
- tombstone và live record cùng semantics paging.

Test:

- nhiều page;
- concurrent write trong lúc paging;
- byte limit;
- cursor tamper;
- cursor replay/cross-tenant;
- timeout/cancel;
- client resume sau mất mạng.

---

## 25. BF-SYNC-03 — Transactional WebSocket outbox

- Ghi outbox event bằng cùng cursor/transaction với business mutation trước commit.
- `NOTIFY` chỉ là wake-up optimization.
- Consumer idempotent.
- Có scan/retry pending events.
- Có status/attempt/backoff/dead-letter policy hợp lý.
- Không đưa dữ liệu nhạy cảm thừa vào event.

Test crash point:

- business commit trước broadcast;
- process crash sau commit;
- consumer retry;
- duplicate delivery;
- ordering theo aggregate/workspace nếu cần.

---

## 26. BF-DOC-01 — Async export API

Đối với export lớn:

- trả `202 Accepted + jobId`;
- job gắn user/tenant/workspace;
- status endpoint;
- authorized download endpoint;
- notification hoặc polling backoff hợp lý;
- cancel/retry semantics;
- expiry/cleanup;
- permission được kiểm tra cả lúc tạo job và lúc download;
- sensitive projection/capability được snapshot hoặc re-evaluate theo policy đã chọn và được tài liệu hóa.

Giữ synchronous fast path chỉ cho export nhỏ với deadline ngắn.

Không poll DB mỗi 50 ms trong HTTP request dài.

Test:

- create/status/download;
- owner/non-owner;
- capability revoke;
- retry;
- cancel;
- worker failure;
- expired artifact;
- large job không giữ ASGI request.

---

## 27. BF-MEDIA-01 — Asset staging/journal/reconciliation

- Ghi upload vào staging namespace.
- Tạo durable asset journal.
- Promote sau business commit.
- Cleanup/reconcile bằng grace-period mark-and-sweep.
- Không chỉ cleanup derivative `_opt_`.
- Bảo vệ tenant/path traversal/content type/size.

Test kill points:

- crash trước DB transaction;
- crash trước commit;
- crash sau commit trước promote;
- retry;
- orphan sweep;
- referenced asset không bị xóa nhầm.

---

## 28. BF-ARCH-06 — Code splitting có kiểm soát

Chỉ thực hiện sau khi route/module state ổn định.

Chunk gợi ý:

1. shell/auth/dashboard;
2. admin;
3. documents/Word/Excel;
4. partner management;
5. package detail/evaluation.

Mỗi thay đổi phải giữ:

- Trusted Types/CSP;
- offline behavior;
- dynamic import failure handling;
- secure obfuscation/package;
- cold p95 ≤ 800 ms;
- warm p95 ≤ 300 ms;
- long task budget hiện hành hoặc budget mới có giải trình.

Không tăng dead-code injection để thay thế security boundary.

---

## 29. BF-ARCH-07 — Tài liệu kiến trúc bắt buộc

Tạo/cập nhật tối thiểu:

- `docs/architecture-overview.md`;
- `docs/package-lifecycle.md`;
- `docs/evaluation-and-lot-scope.md`;
- `docs/offline-sync-conflict-tombstone.md`;
- `docs/document-worker-trust-model.md`;
- ADR single-bundle/code-splitting + Trusted Types;
- ADR immutable audit/migration policy;
- glossary Việt–code;
- `docs/audit-implementation-status.md`;
- `docs/legal-fact-sheet.md`.

Tài liệu phải phản ánh implementation cuối cùng, không chỉ chép audit.

---

## 30. Các hạng mục tuyệt đối không được làm

1. Không viết lại toàn bộ ứng dụng.
2. Không chuyển form gói thầu khỏi modal theo DEC-06; đây là H-M03 đã được tạm hoãn, không phải finding bị quên.
3. Không tự bịa legal facts.
4. Không hạ test/coverage/security/performance gate để pass.
5. Không tắt CSP, Trusted Types, DOMPurify hoặc document sandbox.
6. Không coi obfuscation là authorization/security boundary.
7. Không sửa migration đã phát hành; tạo migration mới.
8. Không làm mất offline/outbox behavior đã có.
9. Không đổi ID hoặc phá dữ liệu production mà không có migration/compatibility.
10. Không trả field nhạy cảm rồi chỉ ẩn ở frontend.
11. Không dùng broad `except`/silent failure để che lỗi mới.
12. Không thêm wrapper/service rỗng chỉ để chia file.
13. Không bulk rewrite CSS hoặc component ngoài kiểm soát.
14. Không dừng ở báo cáo hoặc plan khi còn có thể sửa code trong workspace.
15. Không commit secret, `.env`, DB dump, upload, log, source map hoặc artifact không thuộc allowlist.

---

## 31. Acceptance criteria toàn cục

### 31.1. Bảo mật và dữ liệu

- 100% conflict response qua read authorization và sensitive projection.
- Denied conflict không trả record/current version.
- 100% stale update trên tombstoned record trả conflict/full-sync, không insert ngầm.
- Restore chỉ qua command riêng, có quyền, reason, mutation ID và audit.
- Mọi mutation có `clientMutationId` bắt buộc và idempotent.
- 100% protected API/media/export có capability allow/deny test.
- Không cache offline dữ liệu người dùng không có quyền xem.
- 100% bảng vật chất trong audit coverage matrix có create/update/delete/restore evidence hoặc lý do loại trừ.

### 31.2. Readiness và audit

- Audit-chain invalid làm `/health/ready` trả 503.
- Readiness response chỉ dùng reason code hữu hạn.
- Business transaction và immutable audit không tách rời.
- Retry không tạo duplicate audit/outbox side effect.

### 31.3. Điều hướng/state

- F5/back/forward giữ package, parent tab, child tab, bid, round và lot scope.
- Route round-trip/property test pass.
- Zero direct state write mới ngoài compatibility/data-store layer.
- Dirty state không bị silent discard.

### 31.4. UI/accessibility

- Zero select mới dùng `initCustomSelect`.
- Zero button mới phụ thuộc text inference.
- Axe không có serious/critical violation trên các màn hình trọng yếu đã xác định.
- Keyboard-only hoàn thành các luồng chính.
- Focus indicator 2 px và contrast ≥ 3:1.
- Không hiển thị raw internal ID.
- Không tăng success-toast fatigue ở các luồng đã migrate.

### 31.5. Quality/ops

- Không còn unclosed-resource warning thuộc test suite.
- Critical module có branch/per-module threshold.
- Không tăng debt metrics đã ratchet.
- Cold p95 ≤ 800 ms, warm p95 ≤ 300 ms hoặc có thay đổi budget được chứng minh/phê duyệt.
- Secure build, production package, SBOM, dependency/security scan pass.
- Document sandbox probe vẫn pass trên môi trường Linux phù hợp.

---

## 32. Bộ lệnh kiểm tra cuối cùng

Điều chỉnh theo script thực tế trong `package.json`, nhưng tối thiểu phải chạy:

```bash
python -m compileall -q backend scripts tests
python -m pytest -q
node --test tests/js/*.test.mjs
npm run lint:security
npm run audit:vendor
npm run build:secure
npm run package:production
```

Nếu `npm test` là full aggregate gate, chạy thêm:

```bash
npm test
```

Chạy các E2E hiện có và E2E mới liên quan tối thiểu:

```bash
npm run test:auth-shell
npm run test:auth-roles-e2e
npm run test:offline-sync-e2e
npm run test:multi-assignee-e2e
npm run test:joint-venture-e2e
npm run test:lifecycle
```

Đồng thời tìm và chạy script thực tế cho:

- bidder goods;
- CRUD modules;
- low-price conflict;
- pairwise package paths;
- UI quality;
- startup performance;
- N+1 regression;
- production package/SBOM;
- legal readiness;
- document worker sandbox/deployment nếu môi trường hỗ trợ.

Không ghi “pass” cho test không chạy. Với test không thể chạy do môi trường, ghi rõ:

- lệnh;
- lý do;
- dependency còn thiếu;
- bằng chứng từ unit/integration thay thế;
- cách chạy trong CI/staging.

---

## 33. Cách tổ chức thay đổi

Ưu tiên các commit/nhóm thay đổi có thể review độc lập:

1. regression tests + BF-SEC-01;
2. readiness + quick accessibility/raw ID;
3. legal readiness gate;
4. tombstone/mutation ID/restore;
5. sensitive capability + projections;
6. immutable audit coverage;
7. warning/coverage gates;
8. RouteRegistry/PackageWorkspaceState/Tabs;
9. Combobox/Button/feedback/E2E;
10. WorkspaceDataStore vertical slice;
11. LifecyclePolicy;
12. CSS/token/cascade layers;
13. P2 items riêng biệt.

Không bắt buộc phải tạo git commit nếu môi trường agent không được phép commit, nhưng diff phải được chia logic, dễ review và không trộn refactor không liên quan.

---

## 34. Báo cáo cuối cùng bắt buộc

Khi hoàn tất, trả báo cáo bằng tiếng Việt gồm:

### 34.1. Baseline

- HEAD trước sửa;
- trạng thái worktree;
- versions;
- test baseline;
- finding đã fixed/partial/open trước khi sửa.

### 34.2. Thay đổi đã thực hiện

Theo từng ID:

- nguyên nhân gốc;
- file/symbol đã đổi;
- migration/contract;
- test mới;
- compatibility impact;
- security/privacy impact.

### 34.3. Test đã chạy

Bảng:

| Lệnh | Kết quả | Thời gian/ghi chú |
|---|---|---|

### 34.4. Hạng mục chưa hoàn tất

Chỉ liệt kê khi thực sự bị chặn bởi:

- legal facts bên ngoài;
- dependency môi trường không có;
- quyết định DEC-06;
- vấn đề phát sinh vượt phạm vi và có bằng chứng.

Không dùng “quá lớn” làm lý do dừng nếu vẫn có thể thực hiện thêm trong workspace.

### 34.5. Rủi ro còn lại

- migration/deployment;
- backward compatibility;
- cache/offline upgrade;
- rollout/rollback;
- staging drill cần chạy.

### 34.6. Tệp đầu ra

Đảm bảo repository có:

- code đã sửa;
- test;
- migration nếu cần;
- tài liệu kiến trúc;
- audit implementation status;
- legal fact sheet/template;
- không có secret hoặc artifact thừa.

---

## 35. Nguyên tắc ra quyết định khi implementation khác báo cáo

Báo cáo audit là định hướng và evidence tại snapshot, không phải yêu cầu sao chép line-by-line.

Khi code tại `HEAD` đã thay đổi:

1. kiểm tra behavior bằng test;
2. giữ implementation mới nếu đáp ứng hoặc vượt acceptance criteria;
3. không reintroduce kiến trúc cũ chỉ để khớp tên file;
4. cập nhật tài liệu/status theo symbol mới;
5. mọi quyết định khác audit phải có lý do kỹ thuật, test và không xung đột DEC-01…DEC-06.

Ưu tiên cuối cùng:

```text
Security/data correctness
→ authorization and sensitive projection
→ audit/readiness
→ route/workspace state
→ mutation transaction seam
→ accessible component contracts
→ CSS consolidation
→ scale/performance
```

Bắt đầu bằng việc đọc toàn bộ code và audit, chạy baseline, lập finding inventory, sau đó **thực hiện sửa code ngay theo Phase 0**.
