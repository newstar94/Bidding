# Tổng hợp công việc đã thực hiện

File này được cập nhật sau mỗi việc hoàn thành để theo dõi thay đổi đã làm, phạm vi ảnh hưởng và kết quả kiểm tra.

## 2026-07-26

### 1. Đổi màu giao diện warning sang màu cam

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Thống nhất màu warning chính, hover, accent, nền nhạt và viền sang bảng màu cam.
- **File:** `views/css/variables.css`, `views/css/tokens.css`, `views/css/toast.css`, `views/css/ui-redesign.css`, `views/css/views.css`.
- **Kiểm tra:** `npm run build:secure` đạt; độ tương phản màu chính đạt WCAG AA trên nền trắng và nền warning nhạt.

### 2. Chốt và ghi nhận các quyết định nghiệp vụ NV1–NV6

- **Trạng thái:** Hoàn thành phần tài liệu; chưa triển khai các thay đổi code NV4–NV6.
- **Đã làm:** Phân loại lại NV1–NV3 là hành vi nghiệp vụ chủ ý; xác định NV4 và NV6 là lỗi code; xác định NV5 là yêu cầu đơn giản hóa data model.
- **Quyết định:** Cho phép code cũ chạy với schema mới hơn; bỏ trạng thái hồ sơ giấy; không ràng buộc hợp đồng với nhà thầu trúng; giữ failed document job; không cần `nguoi_cham_id`; mismatch nhà thầu Excel chỉ cảnh báo.
- **File:** `CONTEXT.md`, `docs/adr/0001-*` đến `docs/adr/0006-*`, `TOM_TAT_BUG_CAN_XAC_NHAN.md`, `CODE_REVIEW_REPORT.md`, `REFACTOR_PLAN.md`, `CHANGELOG_REFACTOR.md`.

### 3. Đồng bộ kế hoạch refactor theo NV1–NV6

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Hủy các đề xuất chặn schema mới hơn, khôi phục trạng thái hồ sơ giấy và ràng buộc hợp đồng–nhà thầu trúng; đổi thiết kế import sang cảnh báo “Vẫn nhập”/“Hủy”; lập lộ trình bỏ `nguoi_cham_id`; ưu tiên giữ và chạy lại failed document job.
- **File:** `REFACTOR_PLAN.md`, `CHANGELOG_REFACTOR.md`.

### 4. Tạo file tổng hợp công việc đã thực hiện

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Tạo một nhật ký chung và thống nhất cập nhật file này sau mỗi việc hoàn thành.
- **File:** `CONG_VIEC_DA_THUC_HIEN.md`.

### 5. Sửa focus outline bị hard-code 3px

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Thay `outline: 3px` của ô đánh dấu báo cáo chi tiết bằng token dùng chung `--focus-ring-width` (1px).
- **File:** `views/css/views.css`.
- **Kiểm tra:** Test `test_focus_indicators_share_one_compact_width_token` đạt; `npm run build:secure` đạt.

### 6. Đồng bộ data contract báo cáo đánh giá chi tiết

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Bỏ yêu cầu “lý do không đạt” khỏi validation backend của báo cáo chi tiết; lý do tiếp tục thuộc báo cáo tổng quát.
- **Đã làm:** Loại `nguoi_cham_id` khỏi draft, payload ghi và output báo cáo chi tiết. Code mới không tự gắn người đăng nhập và không ghi đè cột legacy khi upsert.
- **Tương thích:** Giữ nguyên cột nullable trong database để không chỉnh migration đã áp dụng và không làm code cũ vỡ.
- **File:** `backend/sync/mapper.py`, `frontend/packages/DetailedEvaluationWorkflow.js`, `tests/test_sync_mapper_policy.py`, `tests/js/detailed_evaluation.test.mjs`.
- **Kiểm tra:** 24/24 test mapper policy và 40/40 test đánh giá chi tiết đạt.

### 7. Đổi mismatch nhà thầu Excel từ chặn cứng sang cảnh báo xác nhận

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Khi tên nhà thầu trong Excel sai, thiếu hoặc xung đột, hệ thống hiển thị bằng chứng đối chiếu và cho chọn “Vẫn nhập” hoặc “Hủy”.
- **An toàn:** Chỉ tiếp tục khi kết quả xác nhận là `true`; bấm Hủy/đóng hộp thoại không áp dụng dữ liệu. Loại nhà thầu vẫn lấy từ hệ thống.
- **Đã làm:** Mở rộng `customConfirm` để hỗ trợ nhãn nút theo ngữ cảnh và khôi phục nhãn mặc định sau khi đóng.
- **File:** `frontend/packages/DetailedEvaluationWorkflow.js`, `frontend/app/BiddingView.js`, `tests/js/detailed_evaluation.test.mjs`.
- **Kiểm tra:** 131/131 test JavaScript đạt; `npm run build:secure` đạt.

### 8. Giữ failed document job và bổ sung chạy lại có kiểm soát

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Worker không còn xóa thư mục/input khi lần cuối thất bại; consumer trả lỗi nhưng giữ nguyên row, mã lỗi và thông báo lỗi.
- **Đã làm:** Bổ sung `retry_failed_durable_document_job` với conditional update làm idempotency guard; chỉ một caller chuyển được job từ `failed` sang `retry`, input không bị sửa.
- **Vận hành:** Thêm lệnh `scripts/run_document_worker.py --retry-failed <JOB_ID>` và hướng dẫn trong runbook.
- **Retention:** Purge TTL là đường xóa failed job duy nhất; mặc định tăng từ 1 giờ lên 24 giờ, cấu hình tối đa 30 ngày.
- **File:** `backend/documents/document_worker.py`, `scripts/run_document_worker.py`, `.env.example`, `deploy/biddingflow-document-worker.env.example`, `deploy/RUNBOOK.md`, các test tài liệu/PostgreSQL.
- **Kiểm tra:** 2/2 regression test failed/retry, 27 đạt + 1 bỏ qua trong document-worker suite, 4/4 nhánh durable/tampered PostgreSQL đạt; compile Python đạt.

### 9. Ngăn mất mutation/bản nháp khi đồng bộ lỗi hoặc reload

- **Trạng thái:** Hoàn thành phần durability; refactor tách deep module outbox vẫn nằm trong giai đoạn refactor sau.
- **Đã làm:** Mutation outbox được lưu đồng thời theo workspace vào local storage và IndexedDB, có envelope revision/tombstone và hydrate lại khi mở ứng dụng.
- **Đã làm:** HTTP 500, conflict 409 và lỗi mạng không còn gọi `discardMutationBatch` hoặc force-reload ghi đè dữ liệu local.
- **Đồng thời:** Ack một snapshot chỉ xóa đúng dữ liệu thuộc snapshot đó; chỉnh sửa phát sinh khi request đang chờ vẫn nằm trong outbox.
- **An toàn workspace:** Kết quả ghi outbox của workspace cũ không được phép ghi lỗi vào trạng thái workspace mới.
- **File:** `frontend/app/BiddingModel.js`, `frontend/app/BiddingControllerSync.js`, `frontend/shared/MutationService.js`, `tests/js/sync_mutation_durability.test.mjs`.
- **Kiểm tra:** 5/5 test durability, 136/136 toàn bộ test JavaScript và `npm run build:secure` đạt.

### 10. Namespace file ảnh theo tenant

- **Trạng thái:** Hoàn thành cho upload mới và đọc tương thích legacy.
- **Đã làm:** Đường dẫn ảnh mới có segment `t-<hash>` sinh ổn định từ organization ID; hai tenant dùng cùng record ID không còn ghi đè file của nhau.
- **Bảo vệ:** Tạo URL và kiểm tra chữ ký từ chối path có namespace tenant khác; đường dẫn legacy chỉ được chấp nhận khi caller/database đã chứng minh quyền sở hữu bản ghi.
- **Tương thích:** Regex/path resolver tiếp tục đọc path cũ không có tenant segment; truy vấn ảnh tối ưu `_opt_` hỗ trợ cả thư mục tenant mới.
- **File:** `backend/shared/media_helper.py`, `backend/sync/service.py`, `backend/app.py`, `tests/test_security_primitives.py`, `tests/test_sync_service_policy.py`.
- **Kiểm tra:** 41/41 security primitive, 35/35 sync service và 119/119 test đọc/cleanup/phân trang liên quan đạt; compile Python đạt.

### 11. Sửa sparse update làm mất dữ liệu đánh giá cũ

- **Trạng thái:** Hoàn thành.
- **Contract:** Key không có trong payload giữ nguyên giá trị database; key có giá trị `null` xóa field nullable; key có chuỗi rỗng lưu chuỗi rỗng chủ ý.
- **Đã làm:** Upsert kết quả đánh giá tổng quát dùng `CASE` theo presence của từng key thay vì ghi mặc định rỗng cho toàn bộ cột.
- **An toàn SQL:** Câu lệnh cố định với bind parameter, không tạo tên cột động.
- **File:** `backend/sync/mapper.py`, `tests/test_sync_mapper_policy.py`.
- **Kiểm tra:** 26/26 mapper policy test đạt, gồm test SQL thực chứng minh field thiếu được giữ và `null`/rỗng được clear đúng.

### 12. Cố định context nhập Excel để tránh cập nhật nhầm gói/tab

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Capture context bất biến gồm loại import, package ID, tab đánh giá, workspace token và epoch ngay khi người dùng chọn file.
- **Đã làm:** Truyền context xuyên parser → preview → save; adapter dùng package/tab trong context thay vì đọc lại live DOM.
- **Guard:** Kiểm tra context trước đọc file, sau đọc, sau parse, trước save và sau hộp thoại xác nhận; nếu gói/tab/workspace đổi thì cảnh báo và không mutate.
- **File:** `frontend/documents/ExcelIntegration.js`, `excelImportAdapters.js`, `excelSaveAdapters.js`, `tests/js/excel_import_context.test.mjs`.
- **Kiểm tra:** 3/3 regression test context, 139/139 toàn bộ JavaScript test và `npm run build:secure` đạt.

### 13. Ràng buộc idempotency key với hash payload đồng bộ

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Canonical JSON (sort key, UTF-8, loại riêng `clientMutationId`) được SHA-256 trước khi xử lý sync.
- **Hành vi:** Cùng key/cùng hash replay response; cùng key/hash khác trả HTTP 409 `IDEMPOTENCY_KEY_REUSED`; row legacy có hash `NULL` tiếp tục replay để tương thích.
- **Database:** Thêm migration mới v18 bổ sung cột nullable `sync_mutations.request_hash`; không chỉnh migration v1–v17.
- **Race:** Kiểm tra hash cả trước transaction và sau advisory lock trong transaction.
- **File:** `backend/sync/idempotency.py`, `backend/sync/service.py`, `backend/sync/response.py`, `backend/db/schema.py`, `backend/db/upgrades.py`, các test sync/migration.
- **Kiểm tra:** 51/51 test sync support/service/migration đạt; fresh PostgreSQL schema contract đạt; compile Python đạt.

### 14. Xử lý toàn bộ npm vulnerability mức High

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Nâng PostCSS/nanoid lên bản vá bằng `npm audit fix`; thêm override `brace-expansion@5.0.8` để loại nhánh dễ DoS mà không downgrade breaking `javascript-obfuscator`.
- **File:** `package.json`, `package-lock.json`.
- **Kiểm tra:** `npm audit --audit-level=high` báo 0 vulnerability; `npm run build:secure` đạt.

### 15. Khôi phục toàn bộ release gate security/package

- **Trạng thái:** Hoàn thành.
- **Dynamic SQL:** Review từng expression string-built SQL; identifier đều từ schema allowlist/literal nội bộ, giá trị dùng bind parameter và truy vấn nghiệp vụ giữ tenant predicate. Cập nhật fingerprint sau review.
- **Packaging:** Bỏ `build:plain`; README chỉ hướng dẫn `npm run package:production` và migration command.
- **File:** `security/dynamic-sql-baseline.json`, `README.md`, `package.json`.
- **Kiểm tra:** `security_static_gate.py` đạt trên 146 file Python; npm audit 0 vulnerability; production package/extracted-runtime smoke check đạt với 261 file runtime.

### 16. Loại tham chiếu `nguoi_cham_id` còn sót khỏi lệnh ghi báo cáo chi tiết

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Lệnh `INSERT` báo cáo đánh giá chi tiết không còn liệt kê hoặc truyền giá trị cho `nguoi_cham_id`; payload có `nguoiChamId` tiếp tục bị bỏ qua và upsert không ghi đè dữ liệu legacy.
- **Tương thích:** Cột database nullable vẫn được giữ nguyên để code/schema cũ tiếp tục hoạt động; đây không còn là trường trong data contract hay luồng ghi mới của báo cáo chi tiết.
- **File:** `backend/sync/mapper.py`, `tests/test_sync_mapper_policy.py`.
- **Kiểm tra:** 26/26 mapper policy test đạt; regression test xác nhận SQL runtime không còn chứa `nguoi_cham_id`.

### 17. Tách persistence mutation outbox khỏi `BiddingModel`

- **Trạng thái:** Hoàn thành.
- **Deep module:** Tạo `WorkspaceMutationOutboxStore` với interface nhỏ `persist`/`hydrate`/`flush`; module tự quản lý envelope version, revision, tombstone, clone dữ liệu, dual-write local storage/IndexedDB, chọn bản mới nhất và báo lỗi ghi nền.
- **Tương thích:** Đọc được queue legacy và mirror `bf_local_deletions`; tombstone mới hơn ngăn queue đã acknowledge xuất hiện lại.
- **Refactor:** `BiddingModel` không còn giữ revision/write promise/write error hoặc biết khóa persistence; chỉ delegate và cập nhật state sau hydrate.
- **File:** `frontend/app/WorkspaceMutationOutboxStore.js`, `frontend/app/BiddingModel.js`, `tests/js/workspace_mutation_outbox_store.test.mjs`.
- **Kiểm tra:** 5/5 test module, 5/5 characterization durability, 144/144 toàn bộ JavaScript test và `npm run build:secure` đạt; `git diff --check` không có lỗi whitespace.

### 18. Deepening mutation outbox và loại clone/deep equality toàn queue

- **Trạng thái:** Hoàn thành.
- **Deep module:** Tạo `WorkspaceMutationOutbox` sở hữu queue, local deletion, generation từng record và các thao tác `enqueue`, `snapshotForSync`, `ack`, `reject`.
- **Correctness:** Ack hoặc lỗi validation thuộc snapshot cũ không xóa chỉnh sửa phát sinh trong lúc chờ; upsert mới hủy deletion cũ của cùng record; mỗi nội dung payload mới sinh `clientMutationId` mới để không xung đột request hash idempotency.
- **Tối ưu:** `BiddingModel` không còn deep-clone queue ở mỗi thao tác và không dùng `JSON.stringify` để so record khi ack; receipt generation thay thế deep equality.
- **Benchmark:** Với payload 256 byte/bản ghi, enqueue tuần tự 100/500/1.000 bản ghi giảm từ 10,22/250,04/1.009,87 ms xuống 3,45/75,68/301,39 ms, tương ứng nhanh hơn 2,96×/3,30×/3,35× trên microbenchmark.
- **File:** `frontend/app/WorkspaceMutationOutbox.js`, `WorkspaceMutationOutboxStore.js`, `BiddingModel.js`, `BiddingControllerSync.js`, `mutationQueue.js`, `scripts/benchmark_mutation_outbox.mjs`, các test outbox/durability.
- **Kiểm tra:** 7/7 test deep module, 5/5 test persistence, 6/6 characterization durability, 152/152 toàn bộ JavaScript test, `npm run build:secure` và `git diff --check` đạt.

### 19. Xóa 21 import binding chết đã xác minh

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Xác minh lại worktree hiện tại rồi xóa đúng 21 binding `SAFE_TO_REMOVE` trên 12 file backend/script; giữ nguyên mọi export `LIKELY_UNUSED`, `REQUIRES_CONFIRMATION` và facade legacy.
- **Phạm vi:** App startup, lot lifecycle route, auth, DOCX/Excel, logging/text helper, sync service và load-test script.
- **Môi trường test:** Full suite ban đầu phát hiện runtime database ở schema 17 trong khi code yêu cầu 18. Đã chạy migration v18 bằng công cụ quản lý database; không hạ metadata và không sửa migration đã áp dụng. Startup runtime-role sau đó đạt.
- **Kiểm tra:** Compile/import smoke đạt; security static gate đạt trên 146 file; 103/103 test sync/security trọng yếu đạt; full Python suite 996 đạt, 1 bỏ qua; 152/152 JavaScript test và secure build đạt.

### 20. Deepening sync transaction module — giai đoạn 1

- **Trạng thái:** Hoàn thành lát cắt đầu tiên; record validation/writer lớn còn tiếp tục ở giai đoạn sau.
- **Interface:** Đổi seam blocking sang `execute_sync_mutation`; HTTP adapter và toàn bộ 31 characterization test sync gọi interface này, alias private `_process_sync_request_blocking` đã xóa.
- **Typed context:** Thêm `SyncMutationEnvelope`, `SyncActorContext`, `SyncTransactionContext`, `SyncPostCommitContext` để truyền dữ liệu giữa các stage thay vì biến rời rạc.
- **Stage đã tách:** Actor/workspace + idempotency preflight; transaction scope/idempotency recheck; post-commit và rollback image cleanup; default assignment augmentation; mutation/version tracker; tenant-scoped domain uniqueness.
- **An toàn:** Giữ một PostgreSQL transaction boundary; không đổi schema/nghiệp vụ. Auto-assignment không còn SQL nội suy tên bảng mà dùng ba câu SQL cố định; dynamic-SQL baseline `service.py` giảm 9 → 8 expression sau review.
- **Kích thước:** `execute_sync_mutation` giảm từ gần 1.000 xuống khoảng 723 dòng; bookkeeping chuyển vào các deep module có interface riêng.
- **File:** `backend/sync/command.py`, `assignment_augmentation.py`, `mutation_tracker.py`, `uniqueness.py`, `service.py`, test sync/support và security baseline.
- **Kiểm tra:** 45/45 test sync/support đạt; full Python suite 998 đạt, 1 bỏ qua; security static gate đạt trên 150 file; compile và `git diff --check` đạt.

### 21. Tách payload index dùng chung cho validation và writer

- **Trạng thái:** Hoàn thành.
- **Deep module:** Tạo `SyncPayloadIndex` để canonicalize payload một lần, quản lý ID/record theo bảng, trạng thái hợp đồng cho phép, record database đã đọc và tập record cần bỏ qua.
- **Refactor:** Validation và writer không còn tự chia sẻ bốn map/set rời rạc; lookup stored record và skip decision đi qua interface của module.
- **Kết quả:** `execute_sync_mutation` giảm tiếp từ khoảng 723 xuống 704 dòng; record serializer/upsert vẫn là lát cắt tiếp theo.
- **File:** `backend/sync/payload_index.py`, `backend/sync/service.py`, `tests/test_sync_support_modules.py`.
- **Kiểm tra:** 46/46 test sync/support đạt; full Python suite 999 đạt, 1 bỏ qua; security static gate đạt trên 151 file; compile và `git diff --check` đạt.

### 22. Tách sync record serializer và optimistic writer

- **Trạng thái:** Hoàn thành.
- **Serializer:** `SyncRecordSerializer` sở hữu chuẩn hóa ID, JSON/list, trim text, tên người, date/datetime, money/REAL/INTEGER, default, enum và kiểm tra đường dẫn ảnh theo tenant/record.
- **Writer:** `SyncRecordWriter` sở hữu singleton replacement, insert/update optimistic row version, conflict response, edit ownership, child payload, liên kết hợp đồng–gói thầu và mutation tracking.
- **Correctness:** Validation ảnh data URI chưa xử lý/ảnh không thuộc tenant vẫn fail closed; blank optional date vẫn lưu `NULL`; partial row-version conflict vẫn trả server record hiện tại.
- **Kích thước:** `execute_sync_mutation` giảm từ khoảng 704 xuống 457 dòng.
- **SQL review:** Chuyển 6 dynamic expression ra module chuyên trách (2 serializer, 4 writer), tổng không tăng. Table/column identifier đều từ schema allowlist; tenant/value/version dùng bind parameter. Baseline cập nhật sau review và gate đạt.
- **File:** `backend/sync/record_serializer.py`, `record_writer.py`, `service.py`, test sync/support và security baseline.
- **Kiểm tra:** 48/48 test sync/support đạt; full Python suite 1.001 đạt, 1 bỏ qua; security static gate đạt trên 153 file; compile và `git diff --check` đạt.

### 23. Tách sync record validation stage và hoàn tất PR 10

- **Trạng thái:** Hoàn thành.
- **Deep module:** `SyncRecordValidator.validate_payload()` sở hữu authorization, row-version precheck, archived rule, package transition/locked field, assignment requirement, owner reference, uniqueness và chuẩn hóa error payload.
- **Interface:** `service.py` chỉ cấu hình validator/serializer/writer và điều phối transaction; toàn bộ test đi qua `execute_sync_mutation` công khai.
- **Kích thước:** `execute_sync_mutation` giảm tiếp từ khoảng 457 xuống 335 dòng, so với gần 1.000 dòng ban đầu.
- **SQL review:** `service.py` không còn dynamic SQL. Hai SELECT theo bảng chuyển vào validator; table identifier từ schema-owned iterator, organization/record ID dùng bind parameter.
- **Transaction:** Vẫn duy trì đúng một PostgreSQL transaction boundary; rollback/savepoint, failed image cleanup và post-commit event không đổi.
- **File:** `backend/sync/record_validator.py`, `service.py`, test sync/support, security baseline và kế hoạch refactor.
- **Kiểm tra:** 49/49 test sync/support đạt; full Python suite 1.002 đạt, 1 bỏ qua; security static gate đạt trên 154 file; compile và `git diff --check` đạt.

### 24. Loại hoàn toàn `nguoi_cham_id` khỏi runtime đánh giá

- **Trạng thái:** Hoàn thành.
- **Runtime:** Luồng đồng bộ không còn đọc/ghi `nguoi_cham_id` cho vòng đánh giá, báo cáo chi tiết hay kết quả đánh giá; dữ liệu demo cũ đã bỏ trường này.
- **Database:** Thêm migration v19 bỏ ba index, hai trigger, ba khóa ngoại và hàm kiểm tra danh tính người chấm. Không sửa migration đã áp dụng.
- **Tương thích NV1:** Ba cột DB nullable chỉ được giữ vật lý để code cũ vẫn chạy với schema mới; code hiện tại không phụ thuộc các cột này.
- **Tài liệu:** ADR 0005 được thay thế bằng ADR 0007; báo cáo review và bảng phân loại bug/nghiệp vụ đã cập nhật.
- **File:** `backend/sync/mapper.py`, `backend/db/schema.py`, `backend/db/postgres_schema.py`, `backend/db/upgrades.py`, `scripts/seed_demo_data.py`, test mapper/migration và tài liệu ADR.
- **Kiểm tra:** Migration database lên schema 19 thành công; 84/84 test DB/sync trọng yếu đạt; full Python suite 1.004 đạt, 1 bỏ qua; 41/41 test JavaScript đánh giá chi tiết đạt; security static gate đạt trên 154 file; `git diff --check` không có lỗi whitespace.

### 25. Deepening `AwardResultDetailsPanel` — ViewModel và shared award rules

- **Trạng thái:** Hoàn thành lát cắt đầu tiên của PR 11; approval command/workflow lớn còn tiếp tục tách ở lát sau.
- **Interface:** Tạo deep module `buildAwardResultViewModel({ pkg, bids, isEditable, editState })`; caller không còn tự hiểu metadata 1G1T/1G2T, official lot history, active scope, contractor bindings hay rule trúng–trượt.
- **Domain rules:** Module sở hữu mode `history`/`summary`/`approval`, khôi phục edit state, lọc bid theo phạm vi lô, đóng băng contractor version, suy luận winner duy nhất, multiple-lot winners, thứ tự dòng và lý do trượt.
- **Robustness:** Metadata JSON hỏng, `null` hoặc sai shape được cô lập sau default an toàn thay vì làm crash màn hình.
- **Cleanup:** Xóa hai map/set không được sử dụng và gom logic trùng parse/sort/match phần lô; `AwardResultDetailsPanel.js` giảm 1.477 → 1.343 dòng, riêng god render giảm khoảng 135 dòng.
- **Behavior giữ nguyên:** DOM marker, recursive rerender, Lucide initialization, command edit/export, 1G1T/1G2T, whole/selected lots và joint-venture bindings không đổi.
- **File:** `frontend/packages/detail/AwardResultViewModel.js`, `AwardResultDetailsPanel.js`, `tests/js/award_result_view_model.test.mjs`.
- **Kiểm tra:** 9/9 test interface ViewModel; 58/58 test workflow liên quan; toàn bộ JavaScript 161/161 đạt; `npm run build:secure` đạt.

### 26. Deepening approval workflow — command snapshot từ DOM

- **Trạng thái:** Hoàn thành seam DOM → approval command; phần execute mutation/sync tiếp tục được tách ở lát sau.
- **Interface:** Tạo deep module `prepareAwardApprovalCommand({ root, pkg, model, isDirectOrSpecial })` trả về một snapshot bất biến theo thời điểm bấm phê duyệt.
- **Command data:** Chuẩn hóa số/ngày quyết định, BCTĐ, toàn bộ bidder row, winner, contractor/JV identity, lot identity, giá, thời gian và lý do trượt.
- **Validation:** Required fields của decision và winner được kiểm tra tại một chỗ; caller chỉ hiển thị danh sách error và focus control đầu tiên.
- **Correctness:** Lot code/name được đọc đúng cả từ select của chỉ định thầu và static cell của bid đã đánh giá; submit không còn query DOM lặp lại sau validation.
- **DOM locality:** Các control của panel dùng `contentWrapper.querySelector` thay vì global document, tránh bắt nhầm ID của view/modal khác.
- **Kích thước:** `AwardResultDetailsPanel.js` giảm 1.343 → 1.290 dòng; lũy kế từ đầu PR 11 giảm 1.477 → 1.290 dòng.
- **File:** `frontend/packages/detail/AwardResultApprovalCommand.js`, `AwardResultDetailsPanel.js`, `tests/js/award_result_approval_command.test.mjs`.
- **Kiểm tra:** 4/4 test interface command; toàn bộ JavaScript 165/165 đạt; `npm run build:secure` đạt.

### 27. Tách execute mutation/sync khỏi Award Result renderer

- **Trạng thái:** Hoàn thành workflow mutation/sync; row event controller và direct-award row rendering là các lát cắt PR 11 còn lại.
- **Interface:** Tạo deep module `AwardResultApprovalWorkflow` với một interface `execute({ view, pkg, command, appController, viewModel })`.
- **Ports & adapters:** Ba port `commitDependencies`, `commitDecision`, `finalizeLotBatch` có production adapter dùng sync/lifecycle hiện tại và in-memory adapter trong test; renderer không biết endpoint, transaction ordering hay retry surface.
- **Workflow ownership:** Module sở hữu mutation bid/contractor/JV, merge lot award, contractor version bindings, metadata 1G1T/1G2T, cancellation projection, finalization, row-version acknowledgement, sync ordering, navigation và thông báo kết quả.
- **Correctness:** Chỉnh sửa batch `FINAL` không finalize lifecycle lần hai; scoped batch mới commit dependencies trước lifecycle; whole-package/no-winner chỉ commit decision một lần.
- **Renderer:** 382 dòng mutation/sync được thay bằng một lời gọi workflow; `AwardResultDetailsPanel.js` giảm 1.290 → 904 dòng, lũy kế từ 1.477 → 904 dòng.
- **File:** `frontend/packages/detail/AwardResultApprovalWorkflow.js`, `AwardResultDetailsPanel.js`, `tests/js/award_result_approval_workflow.test.mjs`.
- **Kiểm tra:** 4/4 test interface workflow; toàn bộ JavaScript 169/169 đạt; ESLint/Trusted Types và `npm run build:secure` đạt.

### 28. Tách row events và direct-award rendering khỏi Award Result renderer

- **Trạng thái:** Hoàn thành lát cắt controller của PR 11; history/summary markup và các god render khác còn tiếp tục ở lát sau.
- **Interface:** Tạo deep module `bindAwardResultPanelController({ view, root, pkg, appController, viewModel, approvalPanel, rerender, persistEditState })` để renderer chỉ truyền context một lần.
- **Controller ownership:** Module sở hữu hủy chỉnh sửa và persist trạng thái, đồng bộ trường ngày, winner exclusivity theo phần lô, enable/disable giá–thời gian–lý do, khởi tạo dòng bidder/JV, thêm/xóa dòng chỉ định thầu, Excel import/export, thêm bidder thủ công và điều phối approval command/workflow.
- **Correctness:** Dòng bidder mới của gói phân lô luôn giữ hai cột mã/tên phần lô kể cả khi danh sách lô đang rỗng; regression test khóa DOM contract này. Lucide, JV modal data và listener thời gian động vẫn được giữ nguyên.
- **Cleanup:** Loại toàn bộ import/destructure đã chuyển sang controller; `AwardResultDetailsPanel.js` giảm 904 → 397 dòng, lũy kế từ 1.477 → 397 dòng.
- **File:** `frontend/packages/detail/AwardResultPanelController.js`, `AwardResultDetailsPanel.js`, `tests/js/award_result_panel_controller.test.mjs`.
- **Kiểm tra:** 49/49 test Award Result/workflow liên quan đạt; toàn bộ JavaScript 172/172 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 29. Hoàn tất tách presentation khỏi Award Result god renderer

- **Trạng thái:** Hoàn thành lát god renderer Award Result của PR 11; các god render khác trong kế hoạch vẫn tiếp tục ở hạng mục sau.
- **History interface:** Chuyển `buildOfficialResultHistoryMarkup(view, pkg, state, metadata, options)` sang module riêng và re-export tương thích. Dữ liệu `phanLoList` legacy hỏng JSON hoặc `pendingLots` thiếu không còn làm vỡ màn hình lịch sử.
- **Summary interface:** Tạo `buildAwardResultSummaryPresentation({ model, pkg, summary, allBids })` sở hữu winner markup, bảng bidder, header theo phân lô, modal liên danh và runtime store cho nhiều nhà thầu trúng.
- **Correctness:** Contractor ID kiểu số và chuỗi được đối chiếu thống nhất; tên nhà thầu theo phiên bản vẫn được ưu tiên. Test khóa cả gói không phân lô, nhiều winner theo lô và liên danh.
- **Cleanup:** `AwardResultDetailsPanel.js` chỉ còn điều phối ViewModel, mode, render và binding; giảm 397 → 220 dòng, lũy kế từ 1.477 → 220 dòng.
- **File:** `frontend/packages/detail/AwardResultHistoryMarkup.js`, `AwardResultSummaryPresentation.js`, `AwardResultDetailsPanel.js`, `tests/js/award_result_summary_presentation.test.mjs`, `tests/js/scoped_award_result_merge.test.mjs`.
- **Kiểm tra:** 43/43 test presentation/workflow liên quan đạt; toàn bộ JavaScript 176/176 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 30. Tách live ranking controller và loại lookup O(n²) khỏi đánh giá HSDT

- **Trạng thái:** Hoàn thành lát đầu của `BidEvaluationWorkflow` trong PR 11; render bảng/history/scope và event batching còn tiếp tục ở lát sau.
- **Interface:** Tạo deep module `createBidEvaluationRankingController({ root, pkg, bids, isTwoEnvelope, isReadOnly })`; caller chỉ giữ một hàm `update()` cho các input event.
- **Controller ownership:** Module sở hữu đọc row, trạng thái đạt/không đạt/chờ đánh giá, quy trình 2 dừng sau nhà thầu đầu tiên đạt, khóa/mở control, lý do không đạt, giá sau giảm, xếp hạng, điểm tổng hợp và badge.
- **Tối ưu:** Tạo `Map<bidId,bid>` một lần cho render cycle thay vì hai lần `find` toàn bộ state trên mỗi row; `saveDanhGiaHsdt` cũng dùng một index chung cho hai lượt duyệt khi lưu.
- **Correctness:** DOM row stale không còn gây lỗi khi bid đã biến mất; ID được chuẩn hóa chuỗi; test qua interface xác nhận quy trình 2 vẫn khóa row sau nhà thầu đạt và mở lại toàn bộ trường làm rõ ở row đủ điều kiện.
- **Kích thước:** `BidEvaluationWorkflow.js` giảm 1.264 → 1.128 dòng.
- **Benchmark:** Lookup cô lập 100/500/1.000/5.000 row nhanh hơn 3,00×/10,85×/21,09×/45,16× khi dùng `Map` (đã tính chi phí dựng index); chưa bao gồm DOM/layout.
- **File:** `frontend/packages/BidEvaluationRankingController.js`, `BidEvaluationWorkflow.js`, `bidEvaluationActions.js`, `tests/js/bid_evaluation_ranking_controller.test.mjs`, `tests/js/evaluation_clarification_controls.test.mjs`, `PERFORMANCE_REPORT.md`.
- **Kiểm tra:** 24/24 test ranking/workflow liên quan đạt; toàn bộ JavaScript 178/178 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 31. Tách lịch sử đợt và phạm vi phần lô khỏi Bid Evaluation god renderer

- **Trạng thái:** Hoàn thành lát history/scope của `BidEvaluationWorkflow`; table-row presentation, form orchestration và event batching còn tiếp tục.
- **History interface:** Tạo `renderBidEvaluationRoundHistory({ view, model, pkg, metadataBlock, twoEnvelopeMetadata, continueRequested, onContinue })`; module sở hữu history cards, hồ sơ theo phạm vi, trường báo cáo 1G1T/1G2T, continuation action và ẩn/hiện vòng hiện tại.
- **Lot-scope interface:** Tạo `renderBidEvaluationLotScope({ view, pkg, scope, isLocked, onChange })`; module sở hữu radio toàn bộ/đã chọn, checkbox lô, badge/feedback/title, trạng thái khóa và hai nút Excel.
- **Correctness:** Partial scope tiếp tục khóa import/export Excel và phát scope mới đúng danh sách checkbox; history chỉ mở vòng nhập tiếp theo sau khi người dùng bấm tiếp tục, đồng thời giữ đúng bidder thuộc từng đợt.
- **Test locality:** Static assertion tìm chuỗi trong god renderer được thay bằng test trực tiếp tại hai interface; characterization tạo official batch khi lưu partial scope vẫn được giữ.
- **Kích thước:** `BidEvaluationWorkflow.js` giảm 1.128 → 974 dòng, lũy kế từ 1.264 → 974 dòng.
- **File:** `frontend/packages/BidEvaluationRoundHistory.js`, `BidEvaluationLotScopeController.js`, `BidEvaluationWorkflow.js`, `tests/js/bid_evaluation_presentation.test.mjs`, `tests/js/package_workflow_regressions.test.mjs`.
- **Kiểm tra:** 40/40 test history/scope/workflow liên quan đạt; toàn bộ JavaScript 180/180 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 32. Tách table presentation descriptor khỏi Bid Evaluation god renderer

- **Trạng thái:** Hoàn thành lát phân loại/title/header; row presentation và form orchestration còn tiếp tục.
- **Interface:** Tạo pure module `buildBidEvaluationTablePresentation({ pkg, isTwoEnvelope, currentTab, lotScope })` trả `caseType`, cờ tư vấn/phân lô/kết hợp, `showCombinedScore`, title và header markup.
- **Domain locality:** Bảy case `TU_VAN`, `1G2T_NO_LOT`, `1G2T_WITH_LOT`, `1G2T_TC_NO_LOT`, `1G2T_TC_WITH_LOT`, `1G1T_NO_LOT`, `1G1T_WITH_LOT` cùng thứ tự cột được định nghĩa tại một chỗ; row renderer dùng lại descriptor thay vì suy luận cờ riêng.
- **Correctness:** Giữ đúng cột E-HSĐXKT/E-HSĐXTC, đảm bảo dự thầu, giá, phần lô và điểm tổng hợp theo từng phương thức/giai đoạn; title tiếp tục kèm đúng mã lô đang chọn.
- **Test:** Bao phủ trực tiếp đủ bảy case, cả tư vấn, hàng hóa, phân lô, 1G1T, 1G2T kỹ thuật/tài chính và phương pháp kết hợp.
- **Kích thước:** `BidEvaluationWorkflow.js` giảm 974 → 811 dòng, lũy kế từ 1.264 → 811 dòng.
- **File:** `frontend/packages/BidEvaluationTablePresentation.js`, `BidEvaluationWorkflow.js`, `tests/js/bid_evaluation_table_presentation.test.mjs`.
- **Kiểm tra:** 67/67 test table/workflow/detailed-evaluation liên quan đạt; toàn bộ JavaScript 185/185 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 33. Tách bidder-row renderer khỏi Bid Evaluation god renderer

- **Trạng thái:** Hoàn thành lát row presentation của `BidEvaluationWorkflow`; package/tab form orchestration và event batching tiếp tục ở lát sau nên PR 11 chưa hoàn tất.
- **Interface:** Tạo deep module `renderBidEvaluationRows({ root, pkg, bids, model, presentation, isReadOnly, onRankingChange })`; caller chỉ truyền danh sách đã lọc/sắp xếp và callback cập nhật xếp hạng.
- **Renderer ownership:** Module sở hữu empty state, contractor/version link, dữ liệu và lệnh modal liên danh, projection “Tổng hợp từ báo cáo chi tiết”, layout chỉnh sửa/chỉ đọc của 1G1T–1G2T, quy trình 2 và các listener đánh giá, tiền, giảm giá, thời hạn.
- **Descriptor:** `BidEvaluationTablePresentation` trả thêm `isTwoEnvelope` và `currentTab`, nhờ đó row renderer không tự suy luận lại loại vòng từ nhiều cờ rời rạc.
- **Test locality:** Xóa test dò chuỗi source `evaluation_clarification_controls.test.mjs`; thay bằng test trực tiếp qua interface cho editable 1G1T, financial 1G2T kết hợp, detailed-report projection, liên danh, quy trình 2, empty state và listener.
- **Cleanup:** Chuyển tám nhóm dependency contractor/JV/currency/projection khỏi workflow; `BidEvaluationWorkflow.js` giảm 811 → 524 dòng, lũy kế 1.264 → 524 dòng.
- **File:** `frontend/packages/BidEvaluationRowRenderer.js`, `BidEvaluationTablePresentation.js`, `BidEvaluationWorkflow.js`, `tests/js/bid_evaluation_row_renderer.test.mjs`.
- **Kiểm tra:** 11/11 test row/table đích danh đạt; toàn bộ JavaScript 190/190 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 34. Hoàn tất panel state/controller và event batching của Bid Evaluation

- **Trạng thái:** Hoàn tất lát god renderer `BidEvaluationWorkflow` trong PR 11; `GoiThauDetail`, `DetailedEvaluationWorkflow` và các god render khác vẫn tiếp tục ở hạng mục sau.
- **State interface:** Tạo pure module `buildBidEvaluationPanelState({ pkg, rawMetadata, requestedTab, editingState, cachedScopes })`; module sở hữu parse/normalize metadata legacy, khóa tab tài chính trước khi kỹ thuật hoàn thành, active scope theo lô, edit state và khóa theo trạng thái gói.
- **Controller interface:** Tạo `bindBidEvaluationPanelController({ appController, pkg, panelState, onRerender })`; module sở hữu Quy trình 1/2, ưu đãi và điều kiện trùng giá thấp nhất, tab kỹ thuật/tài chính, các trường báo cáo, công văn, Excel, save/edit actions.
- **Sửa nghiệp vụ:** Quy trình 1/2 được hiển thị đúng cho cả Hàng hóa, Xây lắp, Hỗn hợp và Phi tư vấn dùng 1G1T. Trước đây UI chỉ cho Hàng hóa/Phi tư vấn dù detailed evaluation đã hỗ trợ Xây lắp/Hỗn hợp.
- **Event batching:** `BidEvaluationRankingController` có thêm `schedule()`/`dispose()`; lượt đầu cập nhật ngay, các yêu cầu tiếp theo trong cùng animation frame chỉ quét bảng một lần, callback từ render cũ tự bị vô hiệu bằng revision của root.
- **Cleanup:** Loại timeout 100 ms khi fallback Quy trình 2 không hợp lệ và thay bằng microtask; xóa state/form/tab logic trùng khỏi workflow. `BidEvaluationWorkflow.js` giảm 524 → 192 dòng, lũy kế 1.264 → 192 dòng.
- **File:** `frontend/packages/BidEvaluationPanelState.js`, `BidEvaluationPanelController.js`, `BidEvaluationRankingController.js`, `BidEvaluationWorkflow.js`, `tests/js/bid_evaluation_panel_state.test.mjs`, `bid_evaluation_panel_controller.test.mjs`, `bid_evaluation_ranking_controller.test.mjs`.
- **Kiểm tra:** 21/21 test panel/ranking/row đích danh đạt; toàn bộ JavaScript 202/202 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 35. Hoàn tất deepening Detailed Evaluation workflow

- **Trạng thái:** Hoàn tất lát `DetailedEvaluationWorkflow` của PR 11; `GoiThauDetail` và các god render khác tiếp tục ở hạng mục sau.
- **State interface:** Tạo `resolveDetailedEvaluationState(controller)` sở hữu gói/vòng/nhà thầu/tab đang chọn, draft cache, criteria override, suppression template seed, hierarchy, permission, stage lock và reopen rule. Các hàm draft/reopen/projection được chuyển sang cùng module nhưng vẫn re-export tương thích.
- **Panel controller:** Tạo `bindDetailedEvaluationPanelController({ appController, root, state, commands })`; controller sở hữu discard gate, điều hướng nhà thầu/tab bằng chuột và bàn phím, dirty state, derived marks, save/reopen, add/remove và vòng đời nút Excel.
- **Import analyzer:** Tạo pure interface `analyzeDetailedEvaluationWorkbook({ state, sheets, activeGroup, currentCriteriaOverride })`; generic và muasamcong workbook được phân tích thành plan không mutate, bảo toàn STT phân cấp và chỉ commit cache sau khi cảnh báo/xác minh nhà thầu được chấp nhận.
- **Criteria controller:** Tách thêm/xóa/cấu hình tiêu chí, STT kế tiếp, merge criterion và draft row khỏi workflow; giữ hành vi report mới chỉ có header cho đến khi người dùng thêm dòng hoặc nhập Excel.
- **Save workflow:** Tạo `executeDetailedEvaluationSave(...)` với commit adapter; module sở hữu validation, aggregation, summary projection, metadata criteria, atomic `goithau`/`thongtinmothau` commit, success state và giữ dirty draft khi commit lỗi để chạy lại.
- **Data contract:** Draft/report mới tiếp tục không có `nguoi_cham_id`; projection chỉ ghi kết quả nhóm/kết luận/điểm, không kéo lý do và làm rõ chi tiết sang summary ngoài contract đã chốt.
- **Cleanup:** `DetailedEvaluationWorkflow.js` chỉ còn điều phối open/close/render/import identity adapter và save delegation; giảm 1.004 → 192 dòng.
- **File:** `frontend/packages/DetailedEvaluationState.js`, `DetailedEvaluationPanelController.js`, `DetailedEvaluationImport.js`, `DetailedEvaluationCriteriaController.js`, `DetailedEvaluationSaveWorkflow.js`, `DetailedEvaluationWorkflow.js`, bốn test interface mới.
- **Kiểm tra:** 54/54 test Detailed Evaluation/interface đích danh đạt; toàn bộ JavaScript 215/215 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 36. Xác nhận loại `nguoi_cham_id` khỏi runtime

- **Trạng thái:** Hoàn thành rà soát lại theo quyết định nghiệp vụ NV5.
- **Runtime:** Không còn tham chiếu `nguoi_cham_id`, `nguoiChamId` hoặc `nguoiCham` trong giao diện, payload, mapper, lệnh ghi, tài liệu demo hay workflow đánh giá.
- **Tương thích database:** Chỉ giữ các cột vật lý nullable trong schema để code cũ vẫn chạy với database mới hơn; code hiện tại không đọc, ghi hoặc kiểm tra các cột này. Migration v19 xóa index, trigger và khóa ngoại cũ liên quan, không sửa migration đã áp dụng.
- **Kiểm tra:** 27/27 mapper policy test và 44/44 Detailed Evaluation test đạt.

### 37. Hoàn tất deepening Package Detail workflow

- **State/view-model:** Tạo `buildPackageDetailViewModel(...)` sở hữu chọn phiên bản mới nhất, giữ/reset tab, trạng thái kết quả hiệu lực, editability, nhãn 1G1T/1G2T và danh sách phiên bản dedupe; khi trùng `phienBan`, bản thuộc phiên bản kế hoạch mới hơn được chọn.
- **Chrome controller:** `bindPackageDetailChrome(...)` sở hữu header, badge, nút hủy, version selector và tab navigation.
- **Panel locality:** Tách `PackageOpeningPanel`, `QualifiedApprovalPanel`; deepening `FinancialOpeningPanel` để invitation/opening, phê duyệt kỹ thuật và mở tài chính tự sở hữu state, markup, validation, event và save.
- **Sửa lỗi theo lô:** Quyết định phê duyệt kỹ thuật của active lot batch giờ mutate đúng canonical metadata được lưu, không còn sửa một object rồi persist object khác.
- **Tối ưu sync:** Metadata mở tài chính theo lô được stage trước khi lưu giá, nên `thongtinmothau` và `goithau` đi trong một lượt persist/sync thay vì hai lượt liên tiếp.
- **Cleanup:** `GoiThauDetail.js` giảm 829 → 194 dòng và chỉ còn điều phối các panel; giữ public re-export `checkBidQualified`.
- **File:** `PackageDetailViewModel.js`, `PackageDetailCoordinator.js`, `PackageOpeningPanel.js`, `QualifiedApprovalPanel.js`, `FinancialOpeningPanel.js`, `GoiThauDetail.js` và bốn test interface mới.
- **Kiểm tra:** Toàn bộ JavaScript 225/225 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 38. Tối ưu persistence báo cáo đánh giá chi tiết theo batch

- **Prefetch:** Thay SELECT criterion và existing detail trên từng dòng bằng hai query tenant-scoped cho toàn report; criterion được lấy theo danh sách ID yêu cầu và existing detail theo `organization_id + report_id`.
- **Validation:** Giữ nguyên kiểm tra owner, đúng vòng đánh giá, result enum, score bound, required criterion và stable detail identity trên map prefetch.
- **Batch write:** Upsert các dòng chi tiết bằng `executemany`; cleanup stale row vẫn giữ scope `organization_id + report_id`.
- **Statement count:** Phần detail giảm từ `3R + 1` xuống `R + 3`: 10 dòng 31 → 13; 100 dòng 301 → 103; 1.000 dòng 3.001 → 1.003.
- **Giới hạn bằng chứng:** Đây là characterization statement-count; transaction duration, WAL và lock-time trên staging chưa đo nên chưa tuyên bố nhanh hơn trong production.
- **File:** `backend/sync/mapper.py`, `tests/test_sync_mapper_policy.py`.
- **Kiểm tra:** 30/30 mapper policy test, PostgreSQL detailed-evaluation integration test, security static gate và toàn bộ Python 1.007 test đạt; 1 test bỏ qua; `git diff --check` đạt.

### 39. Giảm polling rỗng của document, email và partner workers

- **Deep module:** Tạo `IdlePollBackoff` dùng chung với interface `next_delay()`/`reset()`, exponential delay, subtractive jitter và hard maximum.
- **Document worker:** Cả embedded async loop và external thread loop tăng delay khi queue rỗng, reset sau job; external loop tiếp tục chờ bằng `stop_event.wait` để dừng ngay khi nhận signal.
- **Email worker:** Empty/busy/error path dùng backoff; xử lý thành công reset về initial poll, giữ nguyên cancellation semantics.
- **Partner worker:** Giữ process-local event wake-up, thêm fallback backoff cho job từ instance khác; claim DB lỗi không retry nóng, lỗi một job vẫn cho phép drain job tiếp theo.
- **Cấu hình/vận hành:** Thêm max-poll env mặc định 10 giây, common jitter `0.1` và hướng dẫn điều chỉnh theo pickup SLO trong runbook.
- **Benchmark mô phỏng:** Fixed-5-second worker giảm 46,9–47,2% claim attempt trong một giờ; external document fixed-1-second giảm 89,4%; pickup p95 mô phỏng 9,937–9,939 giây, max dưới 10 giây. Chưa phải số đo production.
- **File:** `backend/shared/idle_backoff.py`, ba worker, `scripts/run_document_worker.py`, `scripts/benchmark_idle_backoff.py`, env/runbook và test backoff/worker.
- **Kiểm tra:** 56 test backoff/worker liên quan đạt, 1 bỏ qua; security static gate và toàn bộ Python 1.017 test đạt, 1 bỏ qua; `git diff --check` đạt.

### 40. Xác minh audit chain tăng dần từ checkpoint

- **Incremental interface:** Thêm `inspect_audit_chain_incremental(cursor, checkpoint, hmac_key=...)`; xác minh checkpoint digest/HMAC, installation identity và từng anchor trước khi đọc tail.
- **Tail verification:** Chỉ đọc row có `id > max_anchor_id`, kiểm tra sequence, previous hash và entry hash cho từng chain; new chain bắt đầu từ empty hash và toàn bộ kết quả cuối phải khớp `audit_chain_heads`.
- **Fail closed:** Incremental bất nhất tự chạy full verification vẫn gắn checkpoint; anchor rollback/truncation không thể được full scan hiện tại hợp thức hóa.
- **Compliance:** Startup và checkpoint export vẫn full scan. Monitor mới dùng incremental giữa các lần export/full scan.
- **Bỏ scan trùng:** `build_audit_checkpoint` nhận full verification vừa có, không gọi lại `inspect_audit_chain` lần hai trong cùng transaction.
- **Bằng chứng:** PostgreSQL test xác nhận incremental/full có cùng row count, aggregate hash và heads; query trace không có `count(*)` hoặc ordered full audit scan. Xóa anchor sau khi disable immutable trigger cho test khiến cả incremental và full-with-checkpoint invalid.
- **Giới hạn:** Query-shape giảm từ `N` lịch sử xuống `H + Δ` giữa full scan; chưa có benchmark thời gian 10k/100k/1M hoặc đo lại production.
- **File:** `backend/shared/audit_chain.py`, `backend/shared/audit_monitor.py`, `tests/test_audit_incremental_policy.py`, `tests/test_postgres_core.py`.
- **Kiểm tra:** 6 test policy/PostgreSQL audit liên quan đạt; security static gate và toàn bộ Python 1.022 test đạt, 1 bỏ qua; `git diff --check` đạt.

### 41. Tách tải bidding và partner workflow theo route

- **Deep module:** Tạo `WorkflowModuleLoader` với interface `ensure(group)`/`isReady(group)`; module sở hữu ma trận route/method, readiness, dùng chung promise đang chạy và xóa failed promise để retry.
- **Route:** Mở thầu, đánh giá HSDT, chi tiết gói thầu và tạo kế hoạch/gói thầu chỉ tải bidding; tạo chủ đầu tư, nhà thầu, chuyên gia và hợp đồng chỉ tải partner.
- **Tương thích:** Giữ `ensureWorkflowModules()` để tải cả hai cho caller cũ; method chưa nhận diện fallback về aggregate loader, Excel bridge tĩnh không kéo workflow thừa.
- **Artifact:** Bidding route không còn yêu cầu chunk partner 61.590 B raw/14.071 B gzip; partner-create không còn yêu cầu chunk bidding 376.519 B raw/80.738 B gzip. Bootstrap tăng khoảng 3,2 kB raw/0,9 kB gzip; browser trace vẫn cần trước khi kết luận latency nhanh hơn.
- **File:** `frontend/app/WorkflowModuleLoader.js`, `BiddingController.js`, `BiddingControllerUI.js`, `AuthFlowController.js`, `GoiThauDetail.js`, `tests/js/workflow_module_loader.test.mjs` và ba báo cáo refactor/hiệu năng.
- **Kiểm tra:** Test mới đỏ trước implementation và 5/5 đạt sau fix; toàn bộ JavaScript 230/230 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đạt.
