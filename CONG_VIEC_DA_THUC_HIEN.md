# Tổng hợp công việc đã thực hiện

File này được cập nhật sau mỗi việc hoàn thành để theo dõi thay đổi đã làm, phạm vi ảnh hưởng và kết quả kiểm tra.

## 2026-07-26

### 1. Đổi màu giao diện warning sang màu cam

- **Trạng thái:** Hoàn thành.
- **Đã làm:** Thống nhất màu warning chính, hover, accent, nền nhạt và viền sang bảng màu cam.
- **File:** `views/css/variables.css`, `views/css/tokens.css`, `views/css/toast.css`, `views/css/ui-redesign.css`, `views/css/views.css`.
- **Kiểm tra:** `npm run build:secure` đạt; độ tương phản màu chính đạt WCAG AA trên nền trắng và nền warning nhạt.

### 2. Chốt và ghi nhận các quyết định nghiệp vụ NV1–NV6

- **Trạng thái:** Hoàn thành. Dòng này ban đầu chỉ ghi giai đoạn chốt tài liệu; phần code NV4–NV6 đã được triển khai và kiểm thử ở các mục 6, 7, 12, 17–20 và 27 bên dưới.
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

### 42. Loại hoàn toàn lý do không đạt khỏi báo cáo đánh giá chi tiết

- **Contract runtime:** Dòng đánh giá chi tiết mới, draft, report mở lại và state đã tải từ dữ liệu legacy đều không còn `lyDoKhongDat`/`ly_do_khong_dat`; normalizer tại state là seam duy nhất loại field cũ trước khi các caller sử dụng.
- **Nhập Excel:** Không đọc cột “Lý do không đạt/Nguyên nhân không đạt/Failure reason”; merge import loại field legacy khỏi toàn bộ dòng giữ lại, không chỉ dòng vừa khớp Excel.
- **Giao diện và tổng hợp:** Collector không tạo hoặc giữ lại field; aggregation không còn trả `failureReason`. Các trường nguyên nhân/làm rõ của báo cáo tổng quát không bị thay đổi.
- **Backend:** Mapper bỏ đọc payload, bỏ cột khỏi INSERT/UPDATE và bỏ field khỏi cả output camelCase/snake_case; report `completed` có tiêu chí `fail` lưu được khi không có lý do.
- **Tương thích database:** Giữ cột vật lý nullable `chi_tiet_danh_gia_nha_thau.ly_do_khong_dat`; không sửa migration đã áp dụng và không hạ schema metadata.
- **Kiểm tra:** Test mới đỏ đúng sáu seam frontend và hai seam backend trước fix; sau fix 17/17 mapper test, 52/52 Detailed Evaluation test, PostgreSQL round-trip, toàn bộ JavaScript 231/231 và Python 1.022/1.022 đạt (1 test bỏ qua); `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 43. Sửa rehearsal nhiều worker và cô lập teardown Windows

- **Session:** `run_benchmark` đăng nhập đúng một lần và chia sẻ cookie/header cho toàn workload, phù hợp invariant một phiên hoạt động trên một tài khoản; không còn các login song song tự thu hồi nhau thành `SESSION_INVALID`.
- **Warmup:** Mỗi workload connection phải gọi thành công `/api/sync-version` có session + organization + database trước start gate; không dùng `/health/live` làm tín hiệu sai về worker/pool đã sẵn sàng.
- **Database safety:** Fail trước mutation nếu cổng rehearsal đang được dùng, database đích không có tên disposable hoặc identity PostgreSQL trùng database runtime; `biddingflow_dev` và `biddingflow_load_test` được xác minh khác nhau.
- **Process ownership:** Windows không phát `CTRL_BREAK_EVENT` qua console vì tín hiệu này từng dừng cả PostgreSQL. Teardown chỉ nhắm PID supervisor và descendants bằng `taskkill /T /F`, có recheck trước khi dùng PID.
- **Rehearsal thật:** 2 worker, concurrency 8, 5 giây: 2.712/2.712 request `200`, không lỗi; 527,05 req/s; p95 30,98 ms; sync-write p95 59,73 ms; quan sát đủ 2/2 worker, 0 deadlock và 0 ungranted lock.
- **Hậu kiểm:** Cổng `18083` đóng; PostgreSQL PID `24460` và app PID `4352` giữ nguyên; health app `live=200`, `ready=200`.
- **Kiểm tra:** Test mới đỏ trên shared-session warmup và CTRL_BREAK ownership trước fix; 11/11 policy/multiworker test và toàn bộ Python 1.031/1.031 đạt, 1 test bỏ qua; `git diff --check` đạt.

### 44. Bổ sung placeholder Word cho báo cáo đánh giá chi tiết

- **Deep module:** Tạo `build_detailed_evaluation_context(package, bids)` ghép metadata tiêu chí với report/dòng đã lưu thành DTO Word ổn định; hỗ trợ snake/camel legacy, STT phân cấp, liên danh/phân lô và các vòng single/technical/financial.
- **Danh sách Word:** Thêm `ds_bao_cao_dgct` theo nhà thầu/vòng và năm danh sách phẳng `ds_dgct`, `ds_dgct_hop_le`, `ds_dgct_nang_luc`, `ds_dgct_ky_thuat`, `ds_dgct_tai_chinh`.
- **Bảng:** Expose đúng nội dung tiêu chí/yêu cầu/HSDT, dấu `x` hệ thống và chuyên gia, điểm tối đa/tối thiểu/điểm chấm, nhận xét, nhà thầu/lô/vòng; không expose lý do không đạt hoặc làm rõ chi tiết.
- **Security/DTO:** Thêm entity allowlist cho report + criterion row, nested group lists và mapping source; dữ liệu ngoài contract bị loại trước document worker.
- **Cấu hình:** Nâng default Word mapping version 12 → 13; generator đồng bộ manifest frontend; sáu nguồn xuất hiện trong form cấu hình danh sách Word.
- **Cú pháp:** Đã render qua engine ứng dụng cả vòng ngắn `{#ds_dgct_hop_le}`…`{/ds_dgct_hop_le}` và vòng lồng `{%p for bc ... %}` + `{%tr for tc in bc.ds_hop_le %}`.
- **Hướng dẫn:** Thêm `docs/WORD_PLACEHOLDER_BAO_CAO_DANH_GIA_CHI_TIET.md` với cấu trúc bảng 14A–14D, placeholder và lưu ý font Plus Jakarta Sans.
- **Visual QA:** DOCX output đã được đọc lại và kiểm tra cấu trúc/nội dung; không tạo artifact phát hành. Renderer PNG chuẩn không chạy do máy thiếu `pdf2image` và không có LibreOffice/Poppler, nên không tuyên bố visual render gate.
- **Kiểm tra:** 4/4 test context/mapping/render mới, 81 test tài liệu liên quan, toàn bộ JavaScript 231/231 và Python 1.031/1.031 đạt (1 test bỏ qua); `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

### 45. Bổ sung browser E2E và cô lập dữ liệu báo cáo chi tiết

- **Luồng thật:** Playwright đăng nhập Super Admin, kiểm tra doanh thu ngay lần hiển thị đầu tiên, chuyển tab rồi đối chiếu lại; sau đó chuyển vai trò Quản lý, mở Gói thầu → Báo cáo đánh giá → Báo cáo chi tiết.
- **Regression:** Test bắt đúng hai lỗi đã sửa: role phiên mới từng bị placeholder `employee` ghi đè và bidding route từng thiếu `makeSearchableSelect`, làm renderer báo cáo chi tiết dừng giữa chừng.
- **Fixture độc lập:** Kịch bản báo cáo chi tiết chèn một gói 1G1T và một hồ sơ dự thầu chỉ trong phản hồi trình duyệt, ép pagination trả đúng gói đó, không ghi database và không phụ thuộc dữ liệu dev.
- **Empty state:** Xác nhận báo cáo mới chỉ có header, nút **Thêm dòng**, **Nhập từ Excel**, **Quay lại** và đúng 0 dòng tiêu chí.
- **Quan sát lỗi:** Test thất bại khi có page error, console error, HTTP 4xx/5xx hoặc request ứng dụng bị lỗi; giữ trace, ảnh và video khi lỗi.
- **File:** `playwright.config.mjs`, `tests/e2e/biddingflow.spec.mjs`, `tests/js/auth_session_role.test.mjs`, `tests/js/workflow_module_loader.test.mjs`, `frontend/auth/AuthFlowController.js`, `frontend/packages/BiddingWorkflows.js`.
- **Kiểm tra:** Hai lượt trước khi cô lập và một lượt sau khi cô lập đều đạt 2/2; lượt deterministic gần nhất đạt trong 4,7 giây; `git diff --check` đạt.

### 46. Đưa browser E2E vào CI Linux

- **Workflow:** Job `test-build-audit` cài Chromium và system dependencies bằng Playwright sau bước build/audit, rồi chạy `npm run test:e2e` trên Ubuntu 24.04 với PostgreSQL disposable.
- **Chẩn đoán:** Khi E2E hoặc bước trước đó thất bại, CI tải `playwright-report/` và `test-results/` thành artifact giữ 14 ngày; trace, ảnh và video chỉ được giữ khi lỗi.
- **Không phụ thuộc seed:** Kịch bản báo cáo chi tiết dùng fixture route interception nên CI không cần tạo dữ liệu gói thầu thật và không ghi thay đổi vào database.
- **File:** `.github/workflows/security-quality.yml`.
- **Kiểm tra:** YAML parse thành công và `git diff --check` đạt. Chưa có GitHub Actions run của commit hiện tại, nên bằng chứng thực thi Ubuntu/AppArmor/Bubblewrap/Chromium vẫn chờ khi thay đổi được đẩy lên remote.

### 47. Chạy cổng hồi quy đầy đủ sau browser E2E

- **JavaScript:** 235/235 test đạt, gồm role phiên đăng nhập, route module loader, doanh thu lần đầu và toàn bộ báo cáo đánh giá chi tiết.
- **Python:** 1.031/1.031 test đạt trong 42,07 giây; 1 test được bỏ qua theo điều kiện môi trường.
- **Frontend:** `npm run lint:security` và `npm run build:secure` đạt; 200 module được build, vendor audit và các guard Excel đều đạt.
- **Browser:** 2/2 E2E đạt trong 5,0 giây. Single-run local metrics: login → dashboard 602–606 ms; chuyển tab Super Admin 236 ms; mở danh sách gói → panel đánh giá 797 ms; mở báo cáo chi tiết 99 ms; báo cáo fixture có 0 dòng.
- **Cleanup:** Không còn marker `[DEBUG-...]`, `E2E_AUTH` hoặc `E2E_EVALUATION`; `git diff --check` đạt.
- **Giới hạn:** Plugin trình duyệt tích hợp vẫn không khởi tạo được vì lỗi nền tảng `windows sandbox: helper_unknown_error`; Playwright cục bộ là feedback loop đang hoạt động. Chưa coi staging benchmark hoặc Linux CI evidence là hoàn tất.

### 48. Đồng bộ trạng thái các báo cáo Markdown

- **Sửa trạng thái cũ:** `REFACTOR_PLAN.md` không còn ghi toàn bộ kế hoạch “chưa triển khai”; phản ánh PR 0–11 và cleanup an toàn đã hoàn thành, PR 12 còn measurement ngoài local.
- **PR 12:** Ghi số đo browser E2E local đã có và tách rõ phần còn thiếu là scale 10/100/500 bid, staging WAL/lock/`pg_stat_statements` và production remeasurement.
- **PR 13/dead code:** Ghi nhận 21/21 import binding an toàn đã xóa, `CONTEXT.md` và bảy ADR đã có; không xóa các public/ops candidate chưa đủ bằng chứng.
- **Báo cáo hiệu năng:** Trạng thái đầu file phản ánh browser regression baseline đã có, không còn mâu thuẫn với phần số đo mới.
- **Kiểm tra:** Chỉ thay đổi tài liệu, không thay đổi runtime; `git diff --check` được chạy ở cổng cuối.

### 49. Đo 10/100/500 nhà thầu và giảm một lần treo dài

- **Feedback loop:** Mở gói 1G1T fixture với 10, 100 và 500 nhà thầu; xác nhận đủ row và ghi navigation, DOM node, long-task, longest task, heap. Cả năm E2E không ghi database.
- **Baseline 500:** Mở bảng 3.374 ms; 33.559 DOM node; 2 long task tổng 1.853 ms; block dài nhất 1.300 ms; heap 56,8 MB.
- **Renderer:** Giữ render đồng bộ đến 50 dòng; trên 50 dòng dùng batch 50 theo frame, tạo mỗi batch trong `DocumentFragment`, và revision cancellation để đổi gói/tab không bị lượt cũ ghi tiếp.
- **Sau tối ưu 500:** Mở bảng 3.817 ms; block dài nhất 693 ms (giảm 46,7%); tổng long-task 2.338 ms chia thành 10 khoảng; heap 53,5 MB. Đây là trade-off giảm freeze dài, không phải throughput nhanh hơn.
- **Regression test:** Test đỏ trước fix vì chưa có `renderBidEvaluationRowsBatched`; sau fix khóa batch size và hủy stale render.
- **Giới hạn:** Ranking/DOM scan cuối vẫn tạo block khoảng 693 ms; đây là bottleneck tiếp theo. Không đặt performance threshold từ single-run local.
- **File:** `frontend/packages/BidEvaluationRowRenderer.js`, `BidEvaluationWorkflow.js`, `tests/js/bid_evaluation_row_renderer.test.mjs`, `tests/e2e/biddingflow.spec.mjs`, `PERFORMANCE_REPORT.md`, `REFACTOR_PLAN.md`.
- **Kiểm tra:** 237/237 JavaScript test đạt; 5/5 browser E2E đạt trong 16,8 giây; security lint, vendor/Excel guards, secure build và `git diff --check` đạt.

### 50. Đo và loại bỏ các truy vấn N+1 đã xác nhận

- **Feedback loop:** Thêm test đếm trực tiếp số lệnh SQL khi số bản ghi tăng lên 40/80 dòng; test đỏ trước sửa với 122 câu kiểm tra tồn tại cho 122 bản ghi mới, 80 câu cho 80 phân công bị gỡ, 40 câu cho 40 gói liên kết hợp đồng và 40 câu tải row-version.
- **Tự gán người phụ trách:** Gom ID theo kế hoạch/gói thầu/hợp đồng, đọc theo lô tối đa 500 tham số thay vì `SELECT` từng bản ghi.
- **Kiểm tra phân công bị gỡ:** Gom theo gói thầu/hợp đồng, còn tối đa hai nhóm truy vấn cho lô nhỏ thay vì một truy vấn mỗi phân công.
- **Đồng bộ hợp đồng:** Kiểm tra toàn bộ gói liên kết bằng `IN (...)`, sau đó ghi liên kết bằng `executemany`; không còn đọc tồn tại theo từng gói.
- **Validation đồng bộ:** Tải trước bản ghi hiện tại theo bảng để kiểm tra `row_version` và trạng thái lưu trữ, dùng lại cùng snapshot trong toàn bộ payload.
- **Rời tổ chức:** Kiểm tra tập người tiếp quản và các phân công đã có theo hai truy vấn gom, không truy vấn lại trong vòng lặp chuyển giao.
- **Giữ nguyên có chủ đích:** Các vòng ghi lịch sử, optimistic locking/savepoint và ghi kết quả theo từng lô không được gắn nhãn N+1; đây là thao tác ghi có ngữ nghĩa/rollback riêng.
- **Kiểm tra:** 65 test tập trung đạt; toàn bộ Python 1.035 test đạt, 1 bỏ qua; toàn bộ JavaScript 238/238 đạt; 5/5 browser E2E đạt; secure lint, vendor/Excel guards và build bảo mật đạt.

### 51. Đóng gói, cleanup và kiểm thử trình duyệt hậu-cleanup

- **Production archive:** `scripts/package_production.py` kiểm tra allowlist, giải nén smoke và tạo `release/biddingflow-production.zip` gồm 271 runtime file, 1.529.861 byte.
- **Cleanup:** Xóa `node_modules`, cache Python/pytest, coverage, Playwright report/test result, log cũ và thư mục tạm có thể tái tạo. Giữ `dist`, source/migration/test/build config, `.agents`, `.codex`, `agent`, database PostgreSQL cục bộ, PostgreSQL tools, `.env`, template và tài liệu người dùng.
- **Browser matrix:** Thêm và chạy 7 trường hợp Tư vấn/Hàng hóa/Xây lắp/Hỗn hợp/Phi tư vấn; 1G1T quy trình 1/2; 1G2T; phân lô/không phân lô; liên danh/độc lập; các phương pháp giá thấp nhất/kỹ thuật/kết hợp.
- **Kết quả browser E2E:** 6/6 ca đạt, gồm doanh thu lần đầu, empty-state báo cáo chi tiết, business matrix và scale 10/100/500 nhà thầu.
- **Browser plugin hậu-cleanup:** Ứng dụng `live=200`, `ready=200`; plugin mở landing page thành công, đúng tiêu đề và không có console error. Tab được giữ mở cho người dùng.
- **Lỗi phát hiện:** Tạo `BUGS_KIEM_THU_TOAN_BO_2026-07-27.md`; xác nhận trạng thái trang con báo cáo chi tiết bị giữ khi chuyển sang gói khác là lỗi code, không phải quy định nghiệp vụ. Lỗi được xử lý ở mục 52.

### 52. Sửa trạng thái báo cáo chi tiết bị giữ khi đổi gói thầu

- **Feedback loop:** Browser matrix bắt buộc mỗi gói mới phải mở ở báo cáo tổng quát; trước sửa test đỏ tại gói thứ hai với `openedDetailedWithoutRequest=true`.
- **Nguyên nhân:** `currentEvaluationView` thuộc application controller và chỉ được đổi về `summary` khi người dùng bấm quay lại; `showPackageDetails` tạo DOM mới nhưng tiếp tục gọi `renderDetailedEvaluation()` vì state cũ vẫn là `contractor-detail`.
- **Sửa lỗi:** Thêm seam `resetDetailedEvaluationNavigationForPackageChange`; khi package ID thực sự thay đổi, chỉ reset trang con và cờ dirty điều hướng. Draft theo khóa package/bid vẫn được giữ; render lại cùng package không bị reset.
- **Regression:** Unit test kiểm tra cả đổi package và cùng package; E2E kiểm tra cả 7 loại gói/phương thức đều không tự mở chi tiết.
- **Kiểm tra:** 239/239 JavaScript, 1.035/1.035 Python (1 bỏ qua theo môi trường), secure build và 6/6 browser E2E đều đạt.

### 53. Đo và giảm long task khi hiển thị 500 tiêu chí chi tiết

- **Fixture hợp lệ:** Tạo 500 tiêu chí custom tối thiểu nằm dưới giới hạn metadata 64 KiB và 500 row draft tại network boundary; không ghi database.
- **Baseline:** Mở đủ bảng trong 785 ms, 15.312 DOM node, một long task 263 ms, heap 39,6 MB.
- **Tối ưu:** Với bảng trên 100 dòng, render 25 dòng đầu và nối batch 25 dòng theo animation frame; dùng revision cancellation; khóa tạm các action mutation; event delegation cho input/result/remove của dòng chèn sau.
- **Đo lại:** Ba lượt có thời gian hoàn tất 960/985/1.490 ms (median 985 ms) và longest task 60/67/67 ms (median 67 ms). Long task median giảm khoảng 74,5%; throughput hoàn tất bảng tăng khoảng 25,5%, là trade-off responsiveness có chủ đích.
- **Regression:** Unit test khóa batch boundary và event delegation cho dòng thêm muộn; browser test đếm đủ 500 dòng và ghi DOM/heap/long-task.
- **Kiểm tra:** 241/241 JavaScript, secure build và 7/7 browser E2E đạt; toàn bộ 1.035 Python đã đạt trong cùng lượt thay đổi backend trước đó, 1 test bỏ qua theo môi trường.

### 54. Khóa nhận diện sáu workbook MuaSắmCông thật

- **Fixture ngoài repository:** Bài kiểm thử tùy chọn đọc trực tiếp sáu file `.xlsx` người dùng cung cấp qua `E2E_REAL_EXCEL_DIR`; không sửa, sao chép hoặc đưa dữ liệu workbook vào source/release.
- **Chọn sheet theo nghiệp vụ:** 1G1T giá thấp nhất chọn `Mẫu số 07B`; 1G2T tài chính chọn `Mẫu số 06C`; tài chính tư vấn kết hợp kỹ thuật–giá chọn `Mẫu số 02B`; kỹ thuật tư vấn chọn `Mẫu số 02`.
- **Phân lô:** Dùng mã lô thật trong `Bảng X`/phụ lục; năng lực–kinh nghiệm được bổ sung đúng dữ liệu lô và không còn cảnh báo không tìm thấy lô.
- **Sheet rỗng:** Các sheet kỹ thuật 03A/03B của ba workbook hàng hóa chỉ có dòng mẫu `-`, nên không tạo tiêu chí rỗng; đây là dữ liệu nguồn, không phải lỗi nhận diện.
- **Kiểm tra:** 6/6 workbook đạt; mỗi nhóm nhận diện có số dòng map bằng số tiêu chí, không warning, tổng thời gian validate/đọc/chọn/map khoảng 82–110 ms/file trong Chromium.
- **File:** `tests/e2e/real_excel_import.spec.mjs`; test tự bỏ qua khi môi trường CI không có bộ workbook thật.

### 55. Lấp khoảng trống coverage ở adapter đồng bộ

- **Phát hiện:** 1.035 test backend đều đạt nhưng release coverage gate vẫn đỏ vì `backend/sync/api.py` và `backend/sync/repository.py` chỉ đạt 52,94%.
- **Test adapter:** Khóa đủ năm route adapter chuyển đúng request tới sync/read/pagination/version service và truyền đúng websocket broadcaster.
- **Test repository:** Khóa nhánh versioned/unversioned, tăng/đọc sync version và fallback `0` khi câu `RETURNING`/`SELECT` không có row.
- **Kết quả tập trung:** Hai module đạt 100% statement + branch coverage; 3/3 test mới đạt.
- **File:** `tests/test_sync_api_repository.py`.

### 56. Chạy cổng phát hành đầy đủ sau tối ưu

- **Backend:** 1.038/1.038 test đạt, 1 test bỏ qua theo điều kiện môi trường; coverage tổng đạt ngưỡng 70% và toàn bộ module quan trọng đạt tối thiểu 90%.
- **Frontend:** 241/241 JavaScript test đạt; security lint, Trusted Types, vendor audit, SheetJS smoke, Excel archive guard và secure Vite build đều đạt.
- **Trình duyệt:** 13/13 Playwright E2E đạt trong 43,5 giây, gồm 7 ca UI/hiệu năng/ma trận nghiệp vụ và 6 workbook MuaSắmCông thật.
- **Production:** Allowlist check và smoke boot từ bản giải nén đạt; tạo lại `release/biddingflow-production.zip` gồm 271 runtime file, 1.530.015 byte.

### 57. Dọn workspace hậu kiểm thử

- **Đã xóa:** `node_modules`, `.pytest_cache`, `playwright-report`, `test-results`, `.docx-review`, coverage/HTML coverage và toàn bộ `__pycache__` trong source/test/script.
- **Đã giữ:** source, migration, test hồi quy, cấu hình build/CI, `dist`, `release`, PostgreSQL/data, `.env`, template/tài liệu người dùng, `.agents`, `.codex`, `agent` và dữ liệu skill AI.
- **Hậu kiểm:** Không còn cache sinh ra trong source, không còn marker debug; `git diff --check` đạt; ứng dụng sau cleanup vẫn trả `live=200`, `ready=200`.

### 58. Kiểm thử plugin trình duyệt hậu-cleanup

- **Landing page:** Plugin mở trực tiếp `http://127.0.0.1:8000/`; tài liệu ở trạng thái `complete`, đúng title BiddingFlow, đúng H1 và đầy đủ liên kết đăng nhập/điều hướng.
- **Runtime health:** Song song với kiểm tra UI, backend vẫn trả `live=200`, `ready=200`; tab landing được giữ mở cho người dùng.
- **Giới hạn plugin:** Browser provider hiện tại không khởi tạo được workspace động khi đi thẳng `/dang-nhap`: shell dừng ở loader và isolated browser context báo thiếu `fetch`/`WebSocket`. Cùng luồng đã đạt bằng Chromium Playwright 13/13 ngay trước cleanup; cleanup không đổi runtime, nên ghi nhận là giới hạn provider/browser session, không gắn nhãn lỗi code.

### 59. Đo ghép cặp source và production package, sửa lỗi metrics harness

- **Production seam:** `run_load_rehearsal.py` nhận `--application-root` và `--output`, fail trước khi đụng database nếu cây runtime thiếu `backend/app.py`, `dist/secure-build.json` hoặc `views`; child process dùng đúng `cwd`/`PYTHONPATH` của cây giải nén.
- **Lỗi harness:** Một `/metrics` `ReadTimeout` từng làm lượt 4 trả lỗi dù workload đã hoàn tất. Test mô phỏng đỏ trước sửa; collector nay bỏ riêng response lỗi và tiếp tục lấy đủ worker.
- **Đo ghép cặp:** 5 lượt source và 5 lượt `release/biddingflow-production.zip` giải nén, cùng 2 worker/concurrency 8/5 giây/database disposable. Source: 424,20 req/s, overall p95 42,38 ms, sync-write p95 84,12 ms. Production: 412,28 req/s, 39,96 ms, 76,32 ms.
- **Correctness:** 20.842/20.842 request trả `200`, 0 workload error, đủ 2/2 worker ở 10/10 lượt, 0 deadlock và 0 temp file; tối đa 1 lock chưa được cấp tại một số sample rồi tự giải phóng.
- **Giới hạn:** Một warmup production có timeout/retry khoảng 15,48 giây; median warmup p95 1,74 giây. Chưa có Linux/staging, WAL theo statement hoặc `pg_stat_statements` runtime.
- **Kiểm tra tập trung:** 7/7 test load-rehearsal policy đạt.

### 60. Rà soát và cập nhật baseline SQL động sau batching N+1

- **Gate phát hiện:** `security_static_gate.py` chặn sáu file vì fingerprint SQL động thay đổi sau khi gom truy vấn N+1.
- **Rà soát:** `org_routes` và các sync module chỉ tạo số lượng placeholder `?`; tên bảng đến từ tuple nội bộ/schema allowlist (`goi_thau`, `hop_dong`, `ke_hoach_lcnt`); không có giá trị người dùng được nối vào SQL.
- **Baseline:** Cập nhật count/hash cho sáu file và ghi `lastReview` với invariant identifier/value binding vào `security/dynamic-sql-baseline.json`.
- **Kiểm tra:** Security static gate đạt trên 157 file Python; 18/18 test load rehearsal + production packaging đạt. Full suite xác nhận 1.040 test đạt, 1 bỏ qua; ba test nhúng Node được chạy lại sau khi cài dependency khóa tạm thời vì cleanup trước đó đã xóa `node_modules`.

### 61. Cleanup sau production benchmark

- **Database:** Xác minh identity load-test khác runtime và có tên disposable trước khi xóa/recreate schema `public` của `biddingflow_load_test`; không đụng database ứng dụng.
- **Artifact:** Xóa cây production giải nén, 10 JSON benchmark, log rehearsal, `node_modules` cài tạm, pytest/Python cache và coverage sinh lại.
- **Giữ lại:** Số đo tổng hợp trong `PERFORMANCE_REPORT.md`, production ZIP gốc, source/test, database runtime, tài liệu và skill AI.

### 62. Đo WAL và pg_stat_statements từ production package

- **Cô lập:** Xác nhận PostgreSQL đã preload `pg_stat_statements`; extension chỉ được tạo/reset theo OID trong database disposable, không reset thống kê runtime và không đổi cấu hình server.
- **Harness:** Ghi `clusterWalBytesUpperBound`, tổng statement calls/execution/WAL/temp blocks, top statement theo execution và WAL; câu query quan sát được tách khỏi câu ứng dụng.
- **Kết quả:** 3 lượt production, mỗi lượt 10 giây, tổng 10.967/10.967 request `200`; median 391,80 req/s, p95 tổng 46,42 ms, sync-write p95 86,60 ms.
- **Write profile:** Median 979.900 byte WAL ứng dụng, 260,23 byte/request, 15,81 statement call/request và 0,904 ms tổng statement execution/request; không deadlock, temp block hoặc temp file.
- **Giới hạn:** LSN là upper bound toàn cluster; lượt 3 có background/DB-other noise rõ. Cần staging scenario/tag trước khi đặt WAL budget.
- **Kiểm tra:** 8/8 policy test và security static gate 157 file đạt trước benchmark.

### 63. Cleanup sau WAL benchmark

- **Database:** Xác minh lại identity disposable rồi drop/recreate schema load-test; extension `pg_stat_statements` cục bộ và toàn bộ dữ liệu benchmark bị loại cùng schema.
- **Filesystem:** Xóa cây production giải nén, ba JSON WAL, smoke JSON, rehearsal log, pytest/Python cache; không giữ query text hay dữ liệu thử nghiệm ngoài báo cáo tổng hợp.
- **Runtime:** Production ZIP và database ứng dụng không bị thay đổi.

### 64. Loại hai vòng O(n²) trong bootstrap identity nhà thầu

- **Feedback loop:** Test 1.000 identity ghi 499.500 predicate ở `mergeReferenceRecords` và 500.500 predicate ở post-merge persistence; cả hai đỏ trước sửa.
- **Sửa:** Dựng ID index một lần, giữ first-existing semantics, trả danh sách merged record cho `applyServerSnapshot`; không dò lại state. Full local fields, authoritative package identity, `referenceOnly` và IndexedDB payload được giữ nguyên.
- **Microbenchmark:** 5.000 identity, 7 lượt: merge median 150,04 → 0,70 ms, p95 161,20 → 1,82 ms, khoảng 213×.
- **Browser:** 100/1.000/5.000 identity luôn render 10 row; 5.000 giảm longest task 373 → 84 ms, tổng long task 640 → 157 ms; tab nhà thầu 267 ms, DOM khoảng 2.425 node, heap 31,2 MB.
- **Harness:** Thêm E2E scale fixture và chờ route handler hoàn tất trước teardown, loại flake `Response has been disposed`.
- **Kiểm tra:** 244/244 JavaScript, secure build, 16/16 browser E2E và production archive smoke đều đạt.
- **Production:** Tạo lại ZIP 271 runtime file, 1.530.685 byte.

### 65. Cleanup sau contractor-scale E2E

- **Đã xóa:** `node_modules`, Playwright report/result, pytest/Python cache và coverage sinh trong lượt build/E2E/package.
- **Đã giữ:** Regression test scale, báo cáo số đo, secure `dist`, production ZIP, source/test, database và skill AI.
- **Hậu kiểm:** Không còn artifact tái tạo trong workspace; ứng dụng dev tiếp tục dùng runtime đang chạy.

### 66. Sửa khởi tạo lặp và lỗi Trusted Types trong production package

- **Feedback loop:** E2E chạy trực tiếp từ ZIP production bắt được hai `#tab-superadmin-dashboard`, hai lần tải partial và các request bootstrap lặp; test đóng gói cũng đỏ khi entry đã băm còn bị gắn `?v=`.
- **Nguyên nhân khởi tạo lặp:** Script entry dùng `/dist/assets/app-<hash>.js?v=...`, còn graph module dùng `/dist/assets/app-<hash>.js`; trình duyệt coi là hai module khác nhau và chạy bootstrap hai lần.
- **Sửa URL canonical:** Entry lấy từ Vite manifest được dùng nguyên URL content-hash; chỉ fallback `appbundle.js` không băm mới dùng mtime query. E2E khóa dashboard đúng một phần tử.
- **Lỗi an toàn bị lộ sau đó:** `navigator.serviceWorker.register()` nhận chuỗi thường trong khi CSP yêu cầu `TrustedScriptURL`; URL service worker nay đi qua allowlist hẹp và policy `biddingflow-html`.
- **Phòng ngừa:** Tắt runtime module-preload injection của Vite dưới CSP Trusted Types; security gate khóa cả cấu hình này và sink service worker.
- **Regression:** 12/12 test production packaging đạt; route-trace production từ đỏ chuyển xanh, không còn console/page/network error.

### 67. Đo graph tài nguyên production và chạy lại toàn bộ cổng phát hành

- **Route graph:** Tuyến gói thầu tải 15 tài nguyên JavaScript, 831.811 byte encoded, tối đa 36,9 ms; có `BiddingWorkflows` và không có `PartnerWorkflows`. Tuyến thêm nhà thầu tải 3 tài nguyên, 114.193 byte encoded, tối đa 7,6 ms; có `PartnerWorkflows` và không tải lại `BiddingWorkflows`.
- **WebSocket:** `403` trong lượt đầu do server kiểm thử chạy cổng 18084 nhưng thiếu `APP_PORT=18084`; cấu hình đúng thì route-trace sạch. Đây là giới hạn cấu hình test, không phải lỗi code.
- **Backend:** 1.042 test đạt, 1 test bỏ qua theo điều kiện môi trường.
- **Frontend:** 244/244 test JavaScript đạt; security lint, Trusted Types, vendor/Excel guards, secure build và production package smoke đều đạt.
- **Trình duyệt:** 17/17 E2E đạt, gồm ma trận nghiệp vụ, 500 tiêu chí, 10/100/500 hồ sơ, 100/1.000/5.000 nhà thầu và 6 workbook MuaSắmCông thật.
- **Production:** ZIP gồm 271 runtime file, 1.527.755 byte; SHA-256 `C639538B50A170BA88D9EEEC660A9880A32D65970793EEE8F0506F7C6654528C`.

### 68. Cleanup cuối và hậu kiểm bằng plugin trình duyệt

- **Đã xóa:** `node_modules`, `.pytest_cache`, `playwright-report`, `test-results`, `docx-review-output`, source/test/script `__pycache__` và bốn cây production route-trace trong thư mục tạm.
- **Database:** Xác minh `current_database() = biddingflow_load_test` trước khi drop/recreate schema `public`; không đụng database ứng dụng.
- **Đã giữ:** Source, test hồi quy, `dist`, production ZIP, PostgreSQL runtime/data, `.env`, tài liệu và các thư mục skill AI `.agents`, `.codex`, `agent`, `.hallmark`.
- **Plugin hậu-cleanup:** Mở `http://127.0.0.1:8000/`, trang ở `readyState=complete`, đúng title/H1, đúng một module entry và không có console warning/error.
- **Runtime:** Backend dev tiếp tục trả `live=200`, `ready=200` sau cleanup.

### 69. Đóng khoảng trống đo initial load và package navigation

- **Phạm vi:** Chạy lặp hai ca E2E trên source và ZIP production, tổng 20/20 ca đạt; login có 10 mẫu/runtime, các thao tác navigation có 5 mẫu/runtime.
- **Initial load:** Login → dashboard source median/p95 734/939 ms; production 588/816 ms.
- **Package:** Package → evaluation source median/p95 911/1.241 ms; production 824/1.040 ms.
- **Chi tiết:** Mở báo cáo chi tiết rỗng source median/p95 106/114 ms; production 98/109 ms.
- **Kết luận:** Không có hồi quy production để biện minh cho thay đổi code; giữ nguyên implementation và cập nhật báo cáo. Staging/network profile cùng parse/evaluate vẫn chưa có bằng chứng trên máy này.

### 70. Cleanup sau navigation benchmark

- **Đã xóa:** `node_modules`, JSON reporter, Playwright result và cây ZIP production giải nén dùng cho 20 ca đo.
- **Database:** Xác minh đúng `biddingflow_load_test`, sau đó drop/recreate schema `public`; không chạm database ứng dụng.
- **Đã giữ:** Production ZIP gốc, secure `dist`, source/test, tài liệu, PostgreSQL runtime/data và skill AI.

### 71. Đo pipeline xuất Word báo cáo đánh giá chi tiết

- **Benchmark tái lập:** Thêm `scripts/benchmark_document_export.py`, tạo template vòng lặp bảng, seal context theo manifest, đo direct render và đúng worker sandbox production; mở lại DOCX để xác minh đủ dòng.
- **500 dòng:** Direct median/p95 74,71/90,56 ms; worker cô lập 594,25/612,46 ms; output 39.960 byte.
- **Burst:** 4/4 job hoàn tất với giới hạn mặc định 2 worker trong 1.243,37 ms; p95 từng job 1.241,82 ms, không reject/timeout.
- **Kết luận:** Không có bottleneck theo số dòng đến 500. Chi phí khoảng 0,5–0,6 giây là khởi tạo sandbox bảo mật, nên không bỏ cô lập hoặc tăng concurrency khi chưa có template staging có ảnh chứng minh cần thiết.
- **Regression/gate:** 4 test benchmark đạt; nhóm document 36 đạt, 1 bỏ qua; security gate 158 file đạt; full backend 1.046 đạt, 1 bỏ qua.
- **Lệnh:** `python scripts/benchmark_document_export.py --rows 10 100 500 --iterations 5 --mode both --parallel-jobs 4`.

### 72. Cleanup sau benchmark xuất Word

- **Đã xóa:** `node_modules`, pytest cache và toàn bộ source/test/script `__pycache__` sinh trong lượt benchmark/gate.
- **Đã giữ:** Script benchmark và test hồi quy, production ZIP, secure `dist`, PostgreSQL runtime/data, tài liệu và skill AI.
- **Hậu kiểm:** Benchmark dùng `TemporaryDirectory`, không để lại template hay DOCX kết quả trong workspace.

### 73. Tối ưu tiến trình xuất Excel

- **Feedback loop:** Benchmark 10/100/1.000/10.000 dòng cho thấy worker mất 1,1–2,35 giây vì export thuần vẫn nạp `excel_service`, kéo theo helper database và tầng ứng dụng.
- **Sửa:** Tách dựng workbook, style, dropdown và ba hàm export thuần sang `excel_workbook_builder`; facade cũ re-export để giữ compatibility, export cần database không đổi.
- **Regression:** Thêm test import-boundary khóa worker thuần không được nạp `excel_service` hoặc `backend.shared.helpers`, cùng benchmark tái lập cho direct/worker.
- **Kết quả:** Worker median giảm 56,5% ở 10 dòng, 55,0% ở 100 dòng, 48,4% ở 1.000 dòng và 27,4% ở 10.000 dòng; direct path giữ ổn định.
- **Gate:** Backend `1.050 passed, 1 skipped`; JavaScript `244/244`; security static gate `160` file; nhóm Excel/document `58 passed, 1 skipped`.
- **Production:** ZIP gồm 272 runtime file, 1.528.607 byte; SHA-256 `79E16ECEC4D32E8A7E550ABADF8AE9A830D6693BF3290DB4184023A1467A36B2`.

### 74. Cleanup cuối và kiểm thử production bằng plugin trình duyệt

- **Đã xóa:** `node_modules`, `.pytest_cache`, Playwright report/result và toàn bộ `__pycache__` trong source/test/script; không còn dependency/cache kiểm thử tái tạo được trong workspace.
- **Đã giữ:** Source và test hồi quy, secure `dist`, production ZIP, PostgreSQL runtime/data, tài liệu và các thư mục skill AI `.agents`, `.codex`, `agent`, `.hallmark`.
- **Phân loại môi trường:** Tiến trình cũ ở cổng 8000 còn chạy `APP_DEBUG=True` nên sau cleanup không còn route DOMPurify từ `node_modules`; đây là lệch chế độ chạy hậu-cleanup, không phải lỗi production. Runtime được khởi động lại với `APP_DEBUG=False` để dùng asset content-hash trong `dist`.
- **Plugin trình duyệt:** Đăng nhập thật, chuyển Super Admin → Chuyên viên, mở danh sách gói, gói `IB2500426517`, báo cáo đánh giá và báo cáo chi tiết; không có console warning/error.
- **Nghiệp vụ kiểm tra trực tiếp:** Hàng hóa, 1G1T, quy trình 1, giá thấp nhất, không phân lô; dữ liệu nhà thầu độc lập và draft 18/21 tiêu chí được tải lại đúng.
- **Bảng chi tiết:** Tab tài chính chỉ có `STT / Nội dung / Giá trị`; header `position: sticky; top: 0`, tiêu đề và ô dữ liệu căn giữa ngang/dọc, font `Plus Jakarta Sans`; không có “Lý do không đạt”, cột “Làm rõ” hoặc `nguoi_cham_id`.
- **Hậu kiểm runtime:** `/health/live=200`, `/health/ready=200`; production dùng đúng một module content-hash `/dist/assets/app-DGIHFSm4.js`.

### 75. Tách deep module ghi metric khỏi hot-path database/session

- **Feedback loop đỏ:** Test import-boundary xác nhận cả 5 producer database/session/logging import `backend.observability.metrics`; fresh import database lane/session median 312,99/310,79 ms.
- **Sửa:** Tạo `backend.observability.recording` thuần standard-library, sở hữu interface record/snapshot/reset; Prometheus renderer đọc snapshot và re-export interface cũ để giữ compatibility.
- **Import graph:** SCC backend lớn nhất giảm 13 → 6 module; database lane import median/p95 còn 243,68/279,44 ms, session store còn 255,04/267,63 ms.
- **Correctness:** Nội dung counter/histogram/label giữ nguyên; reset nay xóa cả phase count/sum/bucket/max vốn bị bỏ sót trước đây.
- **Regression/gate:** 4 test recorder/renderer đạt; nhóm liên quan 123 test đạt; full backend `1.054 passed, 1 skipped`; JavaScript `244/244`; security static gate `161` file.
- **Production:** ZIP gồm 273 runtime file, 1.529.745 byte; SHA-256 `68D5A504195E3F6F82C606B944AF01CE3F4857881E71DE9297A9FBC4B09FBB65`.

### 76. Cleanup và hậu kiểm sau refactor recorder

- **Đã xóa:** `node_modules`, `.pytest_cache`, report/result kiểm thử và toàn bộ source/test/script `__pycache__` sinh bởi full gate/package.
- **Đã giữ:** Secure `dist`, production ZIP, source/test hồi quy, PostgreSQL runtime/data, tài liệu và skill AI.
- **Runtime mới:** Backend được khởi động lại với `APP_DEBUG=False`; `/health/live=200`, `/health/ready=200`.
- **Metrics smoke:** `/metrics=200`, payload 27.468 byte và có đủ database operation, database phase cùng runtime-log-drop series từ recorder mới.

### 77. Sửa rò kết nối pooled connection trong audit độc lập

- **Feedback loop đỏ:** `log_audit()` qua cả nhánh append thành công/lỗi đều cho `close_calls=0`; static boundary cũng bắt import `logging_utils → shared.helpers`.
- **Nguyên nhân:** `append_audit_row` chỉ commit/rollback; caller lấy kết nối qua `database.get_connection()` nhưng không có `finally` trả kết nối về pool.
- **Phạm vi:** 36 call site audit, gồm 22 transaction-bound và 14 audit độc lập có thể đi qua đường rò.
- **Sửa:** Audit độc lập import lazy trực tiếp `db_helper.database`, append trong `try` và luôn `conn.close()` trong `finally`; audit gắn cursor giữ nguyên transaction ownership.
- **PostgreSQL thật:** Pool `min=max=1`, 5 audit liên tiếp đều trả hash, `pool_available=1`, `requests_waiting=0` sau mỗi lượt.
- **Import graph:** SCC 6 module biến mất; backend chỉ còn SCC partner/sync 3 module.
- **Gate:** 4 test focused đạt; full backend `1.058 passed, 1 skipped`; JavaScript `244/244`; security static gate `161` file.
- **Production:** ZIP gồm 273 runtime file, 1.529.765 byte; SHA-256 `C5E8C9B155997020E73ADB45AEBEDDB9AD4A5ACBCA93925F221531B20A3D8438`.

### 78. Cleanup và hậu kiểm sau sửa audit pool

- **Đã xóa:** `node_modules`, `.pytest_cache`, report/result kiểm thử và source/test/script `__pycache__` sinh bởi full gate/package.
- **Đã giữ:** Secure `dist`, production ZIP, PostgreSQL runtime/data, source/test hồi quy, tài liệu và skill AI.
- **Runtime:** Backend đã nạp mã mới với `APP_DEBUG=False`; `/health/live=200`, `/health/ready=200`.
- **Hậu kiểm:** Không còn import `logging_utils → shared.helpers`, không còn debug instrumentation hoặc artifact tái tạo trong workspace.

### 79. Loại backend import cycle partner/sync cuối cùng

- **Feedback loop đỏ:** Test Tarjan trên toàn backend phát hiện SCC `partner_lookup_service`, `sync.api`, `sync.service`.
- **Nguyên nhân:** Partner worker cần broadcast nhưng import qua HTTP route facade `sync.api`; service sau commit lại import partner enrichment, tạo cạnh quay lại.
- **Sửa seam:** Import lazy trực tiếp `broadcast_websocket_event` từ module sở hữu `sync.websocket`; không tạo adapter/port giả và không đổi payload hay transaction ordering.
- **Kết quả graph:** Backend từ một SCC 3 module về 0 import cycle; policy test toàn graph ngăn hồi quy.
- **Gate:** Focused partner/sync/WebSocket `76 passed`; full backend `1.059 passed, 1 skipped`; JavaScript `244/244`; security static gate `161` file.
- **Production:** ZIP gồm 273 runtime file, 1.529.765 byte; SHA-256 `47B5D8E86B26C1FD5C5B52DD86EB9A692286FA44B09F48C143F04B44FCD23726`.

### 80. Cleanup và hậu kiểm sau khi backend đạt zero-cycle

- **Đã xóa:** `node_modules`, `.pytest_cache`, report/result kiểm thử và toàn bộ source/test/script `__pycache__`.
- **Đã giữ:** Secure `dist`, production ZIP, PostgreSQL runtime/data, source/test hồi quy, tài liệu và skill AI.
- **Runtime:** Backend đã nạp mã zero-cycle với `APP_DEBUG=False`; `/health/live=200`, `/health/ready=200`.
- **Hậu kiểm:** Static policy xác nhận backend 0 import cycle; không còn artifact tái tạo hoặc debug instrumentation trong workspace.

### 81. Mở rộng deep recorder cho toàn bộ hot-path metric còn lại

- **Đã làm:** Chuyển document worker, partner lookup/address, WebSocket và audit monitor sang `backend.observability.recording`; `metrics.py` chỉ còn render/HTTP và compatibility re-export.
- **Dependency:** Partner lookup và WebSocket lấy database trực tiếp từ `db_helper`, không qua `shared.helpers`; chỉ `app.py` và `lifecycle.py` còn import renderer metric.
- **Hiệu năng:** Fresh-import median giảm 24,2% cho partner service, 19,5% cho WebSocket, 39,3% cho document worker và 9,2% cho address routes; audit monitor không đổi đáng kể.
- **Gate:** Backend `1.061 passed, 1 skipped`; JavaScript `244/244`; security static gate `161` file; focused suites đạt; backend vẫn 0 import cycle.
- **Production:** ZIP gồm 273 runtime file, 1.530.190 byte; SHA-256 `8D58AAE4AEDA1ED2913B63D04FCE0EDF8D227C3F8324FF58B0083CC1362A854C`.

### 82. Cleanup production và hậu kiểm bằng plugin trình duyệt

- **Đã xóa:** `node_modules`, `.pytest_cache`, Playwright report/result, coverage cache và toàn bộ `__pycache__` dưới source/test/script; không xóa source, test hồi quy hoặc dữ liệu vận hành.
- **Đã giữ:** Secure `dist`, ZIP production, PostgreSQL runtime/data, `.env`, tài liệu và các thư mục skill AI `.agents`, `.codex`, `agent`, `.hallmark`.
- **Runtime:** Khởi động lại với `APP_DEBUG=False`; `/health/live`, `/health/ready`, `/metrics` đều `200` và đủ các metric series mới.
- **Plugin:** Đăng nhập thật, chuyển sang Chuyên viên, mở gói `IB2500426517`, báo cáo tổng quát và đủ bốn tab chi tiết; xác nhận font, sticky header, cấu trúc tab tài chính và các trường đã loại bỏ.
- **Lỗi ghi nhận tại thời điểm hậu kiểm:** Phát hiện STT trùng `2` trong tab Tính hợp lệ sau khi loại dòng liên danh; lỗi đã được sửa và đóng tại mục 83. Đây là lỗi code/draft normalization, không phải quy định cảnh báo sai tên nhà thầu.

### 83. Sửa BUG-09 — STT trùng trong tab Tính hợp lệ

- **Feedback loop:** Ca thuần module tái hiện đúng `1, 2, 2.1, 2.1.1, 2, 2` từ metadata có ba STT cấp cao nguồn cùng là `3`.
- **Nguyên nhân:** STT hợp lệ được giữ nguyên mà không kiểm tra trùng; sau khi bỏ dòng liên danh số `2`, mọi số cấp cao `3` cùng bị giảm thành `2`.
- **Sửa:** Chuẩn hóa STT duy nhất theo từng nhóm trước bước lọc; số cha lặp được cấp số anh em kế tiếp và số con được remap theo cha mới. Không đổi criterion ID/kết quả/thứ tự.
- **Kết quả:** Chuỗi lỗi thành `1, 2, 2.1, 2.1.1, 3, 4`; ca `[1,1.1,1,1.1]` thành `[1,1.1,2,2.1]`.
- **Gate:** JavaScript `245/245`; backend `1.061 passed, 1 skipped`; security static gate `161` file; secure build/package đạt.
- **Production:** ZIP gồm 273 runtime file, 1.531.588 byte; SHA-256 `47AB33B7CE92EB8D1C1BF59836F4BBB84BBC8881A4828BE3854E25D0771A46B1`.

### 84. Cleanup và hậu kiểm production sau BUG-09

- **Đã xóa:** `node_modules`, `.pytest_cache`, report/result, coverage cache và toàn bộ `__pycache__` dưới source/test/script sau full gate/package.
- **Đã giữ:** Secure `dist`, production ZIP, PostgreSQL runtime/data, source/test hồi quy, tài liệu và skill AI.
- **Runtime:** Backend nạp asset production mới `app-SCWObzEl.js` với `APP_DEBUG=False`; health/ready tiếp tục đạt.
- **Plugin:** Mở lại đúng draft từng lỗi và đủ bốn tab; không tab nào còn STT trùng. Tính hợp lệ là `1, 2, 2.1, 2.1.1, 2.1.2, 2.1.3, 2.1.4, 2.1.5, 3, 4`; Năng lực `1, 2, 3, 3.1, 3.2, 4, 5`; Kỹ thuật `1, 2, 3`; Tài chính `1–6` và chỉ có ba cột `STT / Nội dung / Giá trị`.

### 85. Đồng bộ trạng thái các báo cáo Markdown sau triển khai

- **Đã sửa mâu thuẫn:** Ghi rõ mục NV4–NV6 đã triển khai; BUG-09 tại mục 82 là phát hiện lịch sử và đã đóng ở mục 83.
- **Snapshot review:** Đánh dấu `CODE_REVIEW_REPORT.md` và `TOM_TAT_BUG_CAN_XAC_NHAN.md` là tài liệu trước sửa, thêm bảng trạng thái B1–B10 hiện hành để các mô tả baseline đỏ không bị hiểu nhầm là lỗi còn mở.
- **Kế hoạch:** Cập nhật `REFACTOR_PLAN.md` thành PR 0–20 đã triển khai cục bộ; phần còn lại chỉ là staging/Linux/GitHub Actions và xác nhận SLO bằng dữ liệu thật.
- **Nguồn sự thật:** Danh sách bug hiện hành duy nhất là `BUGS_KIEM_THU_TOAN_BO_2026-07-27.md`; hiện không còn lỗi code mở trong phạm vi gate cục bộ.
