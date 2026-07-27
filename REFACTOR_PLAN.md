# Kế hoạch refactor và sửa lỗi BiddingFlow

## Cập nhật 2026-07-27

- Đã hoàn thành query-count feedback loop và loại bốn đường đọc N+1 đã tái hiện được trong sync/phân công/hợp đồng.
- Đã thêm dirty-row ranking cache; tương tác 500 nhà thầu giảm 446 ms xuống 363 ms và không còn long task trong lần nhập đo được.
- Đã profile 500 tiêu chí và batch 25 dòng/frame; longest task median giảm 263 ms xuống 67 ms, đổi lại thời gian hoàn tất bảng median khoảng 985 ms.
- Đã đo ghép cặp 5 lượt source/production và thêm 3 lượt WAL/`pg_stat_statements` trên production package; không deadlock/temp spill. Vẫn phải xác nhận trên staging/Linux bằng dữ liệu thật.
- Đã loại hai vòng O(n²) khi merge/persist identity bootstrap; 5.000 nhà thầu giảm longest browser task 373 → 84 ms và vẫn chỉ render 10 row nhờ server pagination.

- Căn cứ: `CODE_REVIEW_REPORT.md`, `DEAD_CODE_REPORT.md`, `PERFORMANCE_REPORT.md`
- Snapshot lập kế hoạch: `1fb76ad`
- Trạng thái: **PR 0–20 và cleanup an toàn đã triển khai cục bộ; chỉ còn xác nhận staging/Linux/GitHub Actions và SLO production bằng dữ liệu thật**

Các mục “Problem/Current behavior/Refactor steps” bên dưới được giữ làm lịch sử thiết kế. Chúng không còn là danh sách lỗi mở nếu phần cuối file đã có mục trạng thái triển khai tương ứng; danh sách bug hiện hành duy nhất là `BUGS_KIEM_THU_TOAN_BO_2026-07-27.md`.

## 1. Nguyên tắc thiết kế

Kế hoạch dùng các khái niệm sau:

- **Module:** một phần có interface và implementation, không nhất thiết là file/class.
- **Interface:** toàn bộ điều caller phải biết, gồm input, invariant, thứ tự gọi, error mode và performance expectation.
- **Seam:** vị trí đặt interface để thay đổi behavior mà không sửa caller.
- **Adapter:** implementation cụ thể tại seam; chỉ tạo khi thực sự có ít nhất hai adapter hợp lý.
- **Depth:** nhiều behavior có ích sau một interface nhỏ.
- **Locality:** rule, bug và test nằm cùng chỗ thay vì rải qua UI/mapper/validation.

Nguyên tắc bắt buộc:

1. Correctness, data safety và tenant isolation đứng trước giảm dòng code.
2. Không chỉnh migration đã áp dụng; mọi thay đổi schema đi bằng migration mới hoặc pre-upgrade hook ngoài nội dung migration cũ.
3. Characterization/regression test phải đỏ trước fix cho các lỗi P0/P1.
4. Không trộn refactor kiến trúc với đổi nghiệp vụ trong cùng PR.
5. Dùng PostgreSQL thật cho integration test; không tạo repository seam giả chỉ để mock một adapter.
6. Interface mới phải nhỏ hơn tổng knowledge hiện caller đang mang.
7. Mỗi PR rollback độc lập và có feature/config gate khi thay đổi persistence.

## 2. Thứ tự và dependency

| Thứ tự | PR | Ưu tiên | Phụ thuộc |
|---:|---|---|---|
| 0 | Khôi phục release gate | P0 | Không |
| 3A | Characterization sync failure | P0 | PR 0 |
| 3B | Persistent mutation outbox | P0 | PR 3A |
| 4 | Tenant-scoped media paths | P0 | PR 0 |
| 5 | Đồng bộ data contract đánh giá chi tiết | P0/P1 | PR 0 |
| 6A | Immutable Excel import context | P1 | PR 0 |
| 6B | Deep module import muasamcong + contractor identity | P1 | PR 6A |
| 8A | Sparse update semantics | P1 | PR 3A |
| 8B | Idempotency request hash | P1 | PR 8A |
| 9 | Failed document job retention/retry | P0 | PR 0 |
| 10 | Deepen sync transaction module | P2 | PR 3B, 8A, 8B |
| 11 | Tách các god render và shared rules | P2 | PR 5, 6B |
| 12 | Tối ưu theo benchmark | P3 | Baseline E2E/load hoàn chỉnh |
| 13 | Cleanup code chết và tài liệu kiến trúc | P3 | Các PR correctness ổn định |

Ba đề xuất cũ không còn là PR implementation: chặn schema mới hơn, khôi phục “Trạng thái hồ sơ giấy” và ràng buộc hợp đồng với nhà thầu trúng. Các quyết định NV1–NV3 đã được chốt là hành vi nghiệp vụ chủ ý.

## 3. PR 0 — Khôi phục release gate

**Problem**

Một CSS policy test, Python security static gate và npm dependency audit đang đỏ. Refactor trên baseline đỏ làm khó phân biệt regression.

**Current behavior**

- Focus mark chi tiết dùng 3px thay vì token 1px.
- 10 file dynamic SQL có fingerprint chưa được security review.
- 5 npm High vulnerability; auto-fix force đề xuất breaking downgrade.
- README cho phép production dùng plain build, bỏ secure gate.

**Target design**

Một release baseline xanh, trong đó security baseline chỉ thay sau review query-by-query; production chỉ có một command canonical là secure package.

**Files affected**

`views/css/views.css`, security baseline sau khi review, `package.json`/`package-lock.json`, `README.md`, CI nếu cần.

**Refactor steps**

1. Sửa focus rule dùng `--focus-ring-width`, giữ hit target và visibility.
2. Review từng dynamic SQL: identifier allowlist, placeholder parameter, tenant predicate, transaction scope.
3. Chỉ cập nhật fingerprint đã ký duyệt; không “accept all”.
4. Tạo dependency-upgrade PR riêng; kiểm tra changelog của obfuscator/PostCSS và lockfile diff.
5. Xóa khuyến nghị `build:plain` khỏi production README.

**Tests required**

Policy CSS, `security_static_gate.py`, `npm audit`, full JS, secure build, production packaging.

**Risk**

Medium: dependency upgrade có thể đổi secure artifact; CSS focus có thể giảm accessibility nếu chỉ làm mỏng mà không đủ contrast.

**Rollback**

Revert từng hunk độc lập; giữ lockfile cũ nếu audit chưa có bản nâng tương thích, nhưng không phát hành khi gate còn đỏ.

**Estimated complexity**

M — 2–4 ngày, tách tối thiểu 3 commit/PR nhỏ.

## 4. Quyết định NV1 — Cho phép code cũ chạy với schema mới hơn

**Trạng thái: Đã chốt, không tạo PR chặn schema mới hơn.**

Giữ hành vi startup/readiness hiện tại: schema thấp hơn phiên bản code yêu cầu vẫn bị chặn; schema bằng hoặc cao hơn được phép chạy. Không hạ schema metadata và không sửa migration đã áp dụng. Test phải khóa đúng hành vi này để tránh tái đưa cơ chế fail-closed vào sau này. Chi tiết tại `docs/adr/0001-allow-newer-database-schema.md`.

## 5. Quyết định NV2 — Không khôi phục “Trạng thái hồ sơ giấy”

**Trạng thái: Đã chốt, hủy đề xuất preservation/recovery migration v11.**

“Trạng thái hợp đồng” là trạng thái nghiệp vụ duy nhất còn dùng. Không thêm backup table, migration khôi phục hay cơ chế đồng bộ hai trạng thái; đặc biệt không chỉnh migration v11 đã áp dụng. Chi tiết tại `docs/adr/0002-retire-paper-file-status.md`.

## 6. PR 3A — Characterization sync failure

**Problem**

Chưa có test qua đúng seam bắt được mất mutation khi 500/conflict/reload/concurrent edit.

**Current behavior**

Test sync chủ yếu xác nhận request/merge/policy riêng lẻ.

**Target design**

Test interface là hành vi quan sát được của workspace mutation:

`edit → persist local → sync outcome → reload → visible state`

Không assert private map nếu có thể quan sát draft và outbox.

**Files affected**

Tests JS mới, test helpers cho deferred fetch/IndexedDB fake; chưa sửa production.

**Refactor steps**

1. Tạo deterministic deferred `apiFetch`.
2. Reproduce 500, 409, offline, edit trong pending request.
3. Reproduce save draft → reload.
4. Ghi expectation cho retryable và permanent validation failure.

**Tests required**

Chính các characterization test mới + existing sync tests.

**Risk**

Thấp; chỉ test. Rủi ro là fake quá nông, nên phải chạy qua MutationService/controller/model thật.

**Rollback**

Không cần; test mô tả behavior mong muốn.

**Estimated complexity**

M — 2–3 ngày.

## 7. PR 3B — Persistent mutation outbox

**Problem**

Mutation chỉ ở memory và bị discard quá rộng.

**Current behavior**

Batch bị xóa khi lỗi rồi server state ghi đè local; acknowledge dựa vào snapshot/revision và deep equality.

**Target design**

Deep module `WorkspaceMutationOutbox`:

`enqueue(command)`, `snapshotForSync()`, `ack(snapshotId, rowVersions)`, `reject(records, errors)`, `retry(snapshotId)`.

Implementation giữ durability trong IndexedDB theo workspace; caller không biết cấu trúc queue, revision hay serialization. Đây là local-substitutable dependency: test với BrowserDB/in-memory stand-in hiện có, không cần thêm port công khai.

**Files affected**

`frontend/app/BiddingModel.js`, `BiddingControllerSync.js`, `BrowserDB.js`, `MutationService.js`, tests.

**Refactor steps**

1. Cài interface sau characterization tests.
2. Persist mỗi command trước khi báo save thành công.
3. Phân loại lỗi retryable/permanent/conflict.
4. Ack đúng snapshot; giữ command mới phát sinh trong request.
5. Rebase conflict có UI rõ, không silently discard.
6. Migration local storage cũ idempotent.

**Tests required**

PR 3A, workspace isolation, crash/reload, quota error, duplicate ack, concurrent edits, logout.

**Risk**

High: core persistence/sync.

**Rollback**

Feature flag đọc outbox mới nhưng dual-write trong một release; rollback dùng legacy path chỉ sau khi drain/convert queue.

**Estimated complexity**

XL — 7–12 ngày, nên chia enqueue durability và error semantics thành hai PR.

## 8. PR 4 — Tenant-scoped media paths

**Problem**

Filesystem image path không namespace theo tenant.

**Current behavior**

`save_base64_image(value, subfolder, record_id_suffix)` tạo cùng path cho cùng record ID ở mọi org.

**Target design**

Interface:

`storeManagedImage({tenantId, recordId, kind, content, allowedExistingPaths}) -> ManagedImageRef`

Implementation tạo segment tenant bằng HMAC/hash ổn định, kiểm tra root containment và atomic replace. Path validation/cleanup nhận tenant scope bắt buộc.

**Files affected**

`backend/shared/media_helper.py`, `backend/sync/service.py`, protected image route, schema/path migration mới nếu cần, tests.

**Refactor steps**

1. Test đỏ hai org cùng ID.
2. Thêm tenant segment và validation.
3. Viết copy-verify-switch migration cho existing path; không overwrite.
4. Cho đọc dual-path trong compatibility window.
5. Chuyển cleanup/reference scan sang tenant-aware.

**Tests required**

Cross-tenant overwrite/read/delete, symlink/path traversal, allowed existing path, old-path compatibility, concurrent upload.

**Risk**

High: ảnh chữ ký/dấu và link cũ.

**Rollback**

Giữ old file trong retention window; DB ref có thể chuyển ngược bằng manifest; không move destructively trước verification.

**Estimated complexity**

L — 4–6 ngày.

## 9. PR 5 — Đồng bộ data contract báo cáo đánh giá chi tiết

**Problem**

UI bỏ reason/clarification detail nhưng backend vẫn yêu cầu reason cho `fail`; legacy fields và summary ownership chưa được mô tả bằng contract duy nhất.

**Current behavior**

Frontend save hợp lệ, backend mapper reject. Projection đã chủ động không ghi đè reason/clarification tổng quát.

**Target design**

Module rule thuần:

`validateDetailedEvaluationReport(report, criteria, mode) -> ValidationResult`

Cùng invariant được chia sẻ qua contract test frontend/backend: detail cần result/score; reason và clarification thuộc summary. Legacy detail text được đọc/round-trip nhưng không bắt buộc hoặc projection.

**Files affected**

`frontend/packages/detailedEvaluationValidation.js`, `DetailedEvaluationWorkflow.js`, `backend/sync/mapper.py`, `payload_validation.py`, schema contract/tests.

**Refactor steps**

1. Thêm mapper repro hiện đang đỏ.
2. Bỏ backend invariant detail reason, không drop column.
3. Mô tả ownership của summary fields.
4. Bảo toàn payload cũ và unknown extension.
5. Ngừng yêu cầu và tự điền `nguoi_cham_id`; tiếp tục đọc payload/dữ liệu legacy có trường này trong giai đoạn tương thích.
6. Chỉ loại cột vật lý bằng một migration mới sau khi đã xác nhận không còn consumer legacy; không sửa migration đã áp dụng.

**Tests required**

Fail không reason, not-applicable note, score bounds, parent aggregation, payload cũ/mới có/không có `nguoi_cham_id`, save/reload.

**Risk**

Medium: thay đổi validation nghiệp vụ có chủ đích.

**Rollback**

Revert code validation; schema không đổi. Không rollback nếu đã lưu fail không reason bằng cách làm mất report; cần forward-compatible reader.

**Estimated complexity**

M — 2–3 ngày.

## 10. PR 6A — Immutable Excel import context

**Problem**

Luồng import đọc live DOM selector nhiều lần.

**Current behavior**

Parse/save có thể dùng package/lot/tab khác thời điểm chọn file.

**Target design**

`ImportContext` immutable được tạo một lần:

`{workspaceId, packageId, bidId, lotScopeKey, roundType, bidderType, contractorId, uiEpoch}`.

Tất cả parser/validator/saver nhận context; không được query DOM. Controller adapter duy nhất đọc DOM và kiểm tra epoch trước commit.

**Files affected**

`ExcelIntegration.js`, `excelImportAdapters.js`, `excelSaveAdapters.js`, related tests.

**Refactor steps**

1. Deferred-reader regression test.
2. Tạo context factory/validator.
3. Đổi parser/save signatures.
4. Abort khi workspace/package/epoch đổi.
5. Disable import/confirm button trong pending operation.

**Tests required**

Đổi package/tab/lot/workspace, double submit, cancel, invalid file, save target identity.

**Risk**

Medium: nhiều import type dùng chung adapters.

**Rollback**

Feature flag theo import type; chuyển từng type, bắt đầu `danhgiahsdt` rồi `mothau`.

**Estimated complexity**

L — 4–6 ngày.

## 11. PR 6B — Deep module import muasamcong và contractor identity

**Problem**

Recognition, sheet selection, bidder-type adaptation, lot scope, criteria mapping và contractor validation còn rải ở parser/workflow.

**Current behavior**

Mismatched recognized workbook đã bị chặn, nhưng identity check phụ thuộc parser nhận dạng thành công và chỉ so tên.

**Target design**

Một in-process deep module:

`prepareDetailedEvaluationImport({sheets, context}) -> ImportDecision`

`ImportDecision` có `ready`, `confirmation_required` hoặc `rejected`, kèm identity evidence, criteria, rows, warnings và selected sheets. `rejected` chỉ dùng cho file không thể đọc/diễn giải; sai, thiếu hoặc xung đột tên nhà thầu dùng `confirmation_required`. Module tự xử lý:

- mẫu theo tư vấn/hàng hóa/xây lắp/hỗn hợp/phi tư vấn;
- 1G1T, 1G2T kỹ thuật/tài chính, quy trình 1/2, phân lô;
- phương pháp giá thấp nhất/kỹ thuật/kết hợp;
- bidder type từ system;
- contractor identity ưu tiên MST/mã, fallback normalized legal name;
- hierarchy/STT và dòng liên danh.

File reader là adapter ngoài module; parser thuần không cần port giả.

**Files affected**

`detailedEvaluationExcel.js`, `detailedEvaluationCriteria.js`, `detailedEvaluationRules.js`, `DetailedEvaluationWorkflow.js`, fixtures/tests.

**Refactor steps**

1. Chuyển 6 workbook người dùng thành sanitized fixtures hoặc fixture builders.
2. Viết matrix test trước.
3. Tách identity extraction không phụ thuộc sheet mapping.
4. Với workbook thiếu/xung đột/sai identity, hiện rõ tên trong Excel và tên nhà thầu đang chọn, cho người dùng chọn “Vẫn nhập” hoặc “Hủy”.
5. Chỉ mutate draft sau `ready` hoặc sau khi người dùng xác nhận “Vẫn nhập”; lưu import provenance và cảnh báo đã được xác nhận.
6. Giữ custom-template path riêng, không tự suy là muasamcong.

**Tests required**

14A/B/C/D; hàng hóa/xây lắp/hỗn hợp/phi tư vấn/tư vấn; 1G1T/1G2T; quy trình 1/2; phân lô; independent/JV; đúng/sai/mất identity; accent/dash/case; multi-sheet conflicting name; “Vẫn nhập”/“Hủy”; không mutate trước xác nhận.

**Risk**

High: nhận diện nghiệp vụ nhiều biến thể.

**Rollback**

Giữ parser hiện tại sau feature flag trong một release; compare decisions ở shadow mode nhưng chỉ một path được write.

**Estimated complexity**

XL — 7–10 ngày, chia recognition/identity và mapping/application thành hai PR.

## 12. Quyết định NV3 — Liên kết hợp đồng không bị ràng buộc bởi nhà thầu trúng

**Trạng thái: Đã chốt, hủy đề xuất Contract–award–lot integrity.**

Liên kết hợp đồng–gói thầu là quan hệ quản lý, không phải bằng chứng kết quả lựa chọn nhà thầu. Không thêm validation hoặc constraint bắt buộc nhà thầu trên hợp đồng phải là nhà thầu trúng của gói/phần lô. Các kiểm tra tenant và tính tồn tại của liên kết vẫn phải giữ. Chi tiết tại `docs/adr/0003-contract-package-link-is-not-award-constrained.md`.

## 13. PR 8A — Sparse update semantics

**Problem**

Missing field bị coi như clear trong evaluation upsert.

**Current behavior**

Một evaluation key kích hoạt ghi toàn bộ columns với default empty.

**Target design**

Patch contract rõ:

- missing = giữ nguyên;
- `null` = clear nếu field cho phép;
- empty string = giá trị người dùng rỗng theo field policy.

Mapper tạo SQL update theo allowlisted present fields hoặc merge current row trong transaction.

**Files affected**

`backend/sync/payload_validation.py`, `mapper.py`, request contract/serializer, frontend outbound serializer, tests.

**Refactor steps**

1. Characterization tests missing/null/empty.
2. Tạo field policy declarative.
3. Validate patch rồi merge trong transaction.
4. Giữ compatibility cho full payload client cũ.
5. Document public data contract.

**Tests required**

Mọi evaluation field, concurrent rowVersion conflict, retry, empty array vs missing, old/new payload.

**Risk**

High: persistence semantics.

**Rollback**

Feature/version gate payload; schema không đổi.

**Estimated complexity**

L — 4–6 ngày.

## 14. PR 8B — Idempotency request hash

**Problem**

Cùng mutation ID nhưng payload khác replay response cũ.

**Current behavior**

`sync_mutations` không lưu request hash.

**Target design**

Canonical serializer + SHA-256 request hash được lưu với idempotency record. Interface:

`resolveReplay({scope, key, requestHash}) -> miss | replay(response) | conflict`.

**Files affected**

Migration mới, `backend/sync/service.py`, idempotency helper, request serializer, tests.

**Refactor steps**

1. Define canonical payload excluding volatile fields.
2. Add nullable hash, backfill existing rows as unknown legacy.
3. Same key/same hash replay; different hash 409.
4. Record metric/audit event without logging payload nhạy cảm.

**Tests required**

Exact replay, key collision, concurrent transactions, legacy row, tenant/user isolation.

**Risk**

Medium.

**Rollback**

Ignore hash column but không drop; old behavior có thể phục hồi tạm thời.

**Estimated complexity**

M — 2–3 ngày.

## 15. PR 9 — Failed document job retention và retry

**Problem**

Code trái runbook, không giữ failed artifact để retry/forensics.

**Current behavior**

Final failure xóa job directory; consumer xóa DB row.

**Target design**

Failed job metadata/input immutable được giữ để tra cứu và chạy lại, với TTL cấu hình được, encryption/permission hiện có, size quota và audit. Ops command retry tạo attempt mới gắn parent job; purge là thao tác riêng, idempotent và logged.

**Files affected**

`document_worker.py`, worker CLI, schema/migration nếu cần attempt lineage, deployment runbook, metrics/tests.

**Refactor steps**

1. Chốt thời hạn retention, quota và dữ liệu nhạy cảm nào được phép giữ; không thay đổi yêu cầu phải giữ failed job.
2. Sửa test đang codify deletion.
3. Giữ failed record + sidecar hash.
4. Tạo retry/purge commands.
5. Thêm disk-pressure guard và redaction.

**Tests required**

Retry success/fail, malicious input, TTL purge, crash recovery, duplicate retry, quota, tenant access.

**Risk**

High về bảo mật file và dung lượng nếu retention sai.

**Rollback**

Tắt retry command, giữ metadata; purge theo runbook có audit, không tự động xóa ngay.

**Estimated complexity**

L — 4–6 ngày.

## 16. PR 10 — Deepen sync transaction module

**Trạng thái triển khai 2026-07-26:** Hoàn thành giai đoạn deepening đã hoạch định. HTTP adapter và toàn bộ characterization test dùng seam công khai `execute_sync_mutation`; alias private đã xóa. Typed context cùng các stage actor/idempotency, transaction recheck, post-commit/rollback, assignment augmentation, payload index, validation, uniqueness, serialization, optimistic writer và mutation tracking đã được tách. Orchestrator còn khoảng 335 dòng và không chứa dynamic SQL; transaction boundary vẫn duy nhất.

**Problem**

`_process_sync_request_blocking` gần 1.000 dòng và mapper trộn query/mapping/validation.

**Current behavior**

Caller/callee cùng phải biết auth scope, idempotency, image preprocessing, row version, tenant validation, child writes và response.

**Target design**

External interface nhỏ:

`executeSyncMutation(actorContext, mutationEnvelope) -> SyncCommitResult`

Implementation nội bộ gồm pipeline có locality:

1. validate envelope;
2. acquire idempotency;
3. resolve tenant/authorization;
4. stage external filesystem writes;
5. execute PostgreSQL transaction;
6. commit/rollback side effects;
7. build response/event.

Không tạo generic repository port cho PostgreSQL; integration test chạy DB thật. Chỉ tạo adapter ở filesystem/media và event publishing vì có production + test adapter thực.

**Files affected**

`backend/sync/service.py`, mapper modules, media helper, response/repository/ownership, tests.

**Refactor steps**

1. Đợi P0/P1 semantics ổn định.
2. Characterize interface HTTP.
3. Extract từng stage giữ behavior.
4. Chuyển test sang interface module mới; xóa test implementation cũ trùng sau khi coverage tương đương.
5. Giữ transaction boundary duy nhất.

**Tests required**

Full sync, tenant, conflict, idempotency, images, partial update, deletion, rollback and side-effect cleanup.

**Risk**

High; không làm cùng PR với đổi nghiệp vụ.

**Rollback**

Mỗi stage extraction là commit behavior-preserving; revert độc lập.

**Estimated complexity**

XL — 3–5 PR, tổng 10–15 ngày.

## 17. PR 11 — Tách god render và shared domain rules

**Trạng thái triển khai 2026-07-26:** Các lát Award Result, Bid Evaluation, Detailed Evaluation và Package Detail đã hoàn thành. `AwardResultDetailsPanel.js` giảm 1.477 → 220 dòng; `BidEvaluationWorkflow.js` giảm 1.264 → 192 dòng; `DetailedEvaluationWorkflow.js` giảm 1.004 → 192 dòng; `GoiThauDetail.js` giảm 829 → 194 dòng. Package Detail đã tách pure view-model, header/version/tab controller, opening/invitation panel, qualified approval panel và financial opening panel. Lookup Bid Evaluation O(n²) đã được thay bằng bid index, các yêu cầu ranking liên tiếp được batch theo frame và save biên bản mở tài chính theo lô chỉ còn một lượt persist/sync. Các god render ngoài danh sách file mục tiêu của PR 11 sẽ được đánh giá riêng, không mở rộng PR này.

**Problem**

Render function dài hơn 1.000 dòng, event/rule/mutation trộn nhau; trạng thái chuỗi lặp rộng.

**Current behavior**

Một thay đổi UI kéo theo sửa nhiều nhánh và khó test qua interface.

**Target design**

- Module rule/selector thuần cho status, ranking, lot scope và visibility.
- Module view chỉ nhận `ViewModel` và phát command.
- Workflow/controller xử lý command, không chứa HTML lớn.
- Row/table renderer nhỏ theo layout thực, không tạo abstraction generic cho mọi bảng.

**Files affected**

`AwardResultDetailsPanel.js`, `BidEvaluationWorkflow.js`, `GoiThauDetail.js`, `DetailedEvaluationWorkflow.js`, views CSS, tests.

**Refactor steps**

1. Chọn từng god function, không làm song song.
2. Characterize DOM output và command events.
3. Extract pure selectors/rules trước.
4. Tạo view-model; render không đọc global model.
5. Event delegation một lần tại container.
6. Xóa duplicated tests sau khi interface tests thay thế.

**Tests required**

1G1T/1G2T, process 1/2, lots, JV, read-only/completed/reopened, keyboard/a11y, save/reload.

**Risk**

Medium–high, dễ gây regression UI.

**Rollback**

Một feature/function mỗi PR; screenshot/E2E baseline cho rollback.

**Estimated complexity**

XL — nhiều PR 3–5 ngày mỗi god function.

## 18. PR 12 — Tối ưu theo benchmark

**Trạng thái triển khai 2026-07-27:** Lookup/ranking và outbox đã tối ưu ở các lát trước. Detailed-evaluation write đã prefetch toàn bộ criterion được yêu cầu và existing detail của report bằng hai query tenant-scoped, sau đó batch upsert qua `executemany`; characterization 10/100/1.000 dòng khóa statement logic phần detail từ `3R + 1` xuống `R + 3`. Document, email và partner worker đã dùng chung `IdlePollBackoff`; mô phỏng fixed-5-second worker giảm khoảng 46,9–47,2% claim attempt. Audit monitor đã dùng incremental checkpoint verification giữa các lần full scan. Workflow loader đã tách bidding/partner theo route và method. Browser E2E deterministic đã đo 10/100/500 bid. Renderer trên 50 bid dùng frame batch + `DocumentFragment` + revision cancellation; dirty-row ranking loại full DOM reread cho luồng không tuần tự. Báo cáo chi tiết 500 tiêu chí dùng batch 25 dòng/frame và event delegation, giảm longest task median 263 → 67 ms nhưng tăng thời gian hoàn tất bảng lên median khoảng 985 ms. Bootstrap reference merge/persist dùng một ID index và merged-result reuse thay hai vòng O(n²); 5.000 nhà thầu giảm longest task 373 → 84 ms, bảng vẫn 10 row. Năm lượt source và năm lượt cây production giải nén cho throughput median 424,20/412,28 req/s, latency tổng p95 median 42,38/39,96 ms và sync-write p95 median 84,12/76,32 ms. Ba lượt production 10 giây ghi median 979.900 byte WAL theo statement, 260,23 byte/request, 15,81 statement call/request và không temp spill/deadlock. Route resource graph, 5 lượt navigation source/production và Word render 10/100/500 dòng đã hoàn tất; staging latency/WAL/lock/statement stats, template có ảnh, parse/evaluate profile và Linux CI cho worktree hiện tại vẫn còn thiếu.

**Problem**

Có bottleneck tĩnh nhưng chưa có đầy đủ browser/load baseline.

**Current behavior**

Ranking rescan, deep clone queue, row-wise DB persistence, polling và audit full scan.

**Target design**

Chỉ áp tối ưu có metric:

- Map bid theo ID + debounce/batch ranking.
- Outbox structural sharing thay deep clone toàn queue.
- Prefetch criteria/existing details và batch upsert.
- Exponential backoff/jitter hoặc LISTEN/NOTIFY cho idle workers.
- Audit chain incremental checkpoints.
- Route-specific workflow load; artifact/request graph và local navigation timing đã xác minh, còn thiếu parse/evaluate profile trên staging.

**Files affected**

Các module tương ứng và benchmark scripts/tests.

**Refactor steps**

1. Thêm benchmark reproducible.
2. Đo 5 lần median/p95 trước.
3. Một tối ưu mỗi PR.
4. Đo lại cùng dataset/hardware.
5. Revert nếu không có lợi ích hoặc tăng lỗi.

**Tests required**

Correctness suite tương ứng, load test, query plan, tenant isolation, E2E performance budget.

**Risk**

Medium; tối ưu có thể đổi timing/race.

**Rollback**

Revert optimization độc lập; giữ benchmark.

**Estimated complexity**

M–L cho từng bottleneck.

## 19. PR 13 — Cleanup và tài liệu

**Trạng thái triển khai 2026-07-26:** Đã xóa đủ 21/21 import binding `SAFE_TO_REMOVE`, tạo `CONTEXT.md` và bảy ADR cho các quyết định nghiệp vụ/schema. Các symbol `LIKELY_UNUSED`, `REQUIRES_CONFIRMATION` và facade tương thích được giữ nguyên vì chưa có bằng chứng owner/runtime đủ để xóa.

**Problem**

Import thừa, test-only exports, README nghèo và không có domain context/ADR.

**Current behavior**

21 binding an toàn để xóa; nhiều candidate cần xác nhận; architecture knowledge nằm rải rác.

**Target design**

Cleanup nhỏ, không behavior change; `CONTEXT.md` chỉ mô tả ubiquitous language; ADR ghi các quyết định khó đảo ngược. Sáu quyết định NV1–NV6 đã được ghi tại `docs/adr/0001-*` đến `0006-*`.

**Files affected**

Danh sách trong `DEAD_CODE_REPORT.md`, README, `CONTEXT.md`, `docs/adr/*`.

**Refactor steps**

1. PR riêng xóa 21 import binding.
2. Xác nhận owner trước mọi `LIKELY_UNUSED`.
3. Không xóa migration/legacy fields.
4. Viết docs sau khi quyết định P0/P1 được chốt.

**Tests required**

Full Python/JS, secure build, package smoke.

**Risk**

Thấp với import; medium với public facade.

**Rollback**

Revert cleanup; Git giữ lịch sử. Không để commented-out code.

**Estimated complexity**

S cho import; M cho docs/ADR.

## 20. Mẫu mô tả bắt buộc cho từng PR implementation

Mỗi PR sau phải ghi:

`Summary`  
`Files changed`  
`Behavior preserved`  
`Behavior changed`  
`Dead code removed`  
`Tests added`  
`Tests executed`  
`Benchmark before/after`  
`Risks`  
`Rollback plan`

Không gộp hai mục P0 không liên quan vào một PR. Không đánh dấu hoàn thành chỉ vì test unit đạt; phải chạy gate tương ứng và cập nhật benchmark/changelog.

## 21. PR 14 — Canonical production module URL và Trusted Types runtime

**Trạng thái triển khai 2026-07-27:** Hoàn thành trên production ZIP cục bộ.

- Entry Vite content-hash không còn gắn mtime query, tránh hai module identity và hai lần bootstrap.
- Service worker URL đi qua `TrustedScriptURL`; runtime module-preload injection bị tắt để không tạo sink chuỗi ngoài policy.
- Regression khóa một dashboard, canonical entry URL và Trusted Types build policy.
- Production route graph xác nhận `BiddingWorkflows`/`PartnerWorkflows` chỉ tải đúng tuyến.
- Còn thiếu staging/Linux và browser parse/evaluate profile; không dùng số đo cục bộ này để tuyên bố SLO production.

## 22. PR 15 — Deep module thuần cho xuất Excel

**Trạng thái triển khai 2026-07-27:** Hoàn thành và đã đóng gói production.

- Tách dựng workbook thuần sang `backend/documents/excel_workbook_builder.py`; module không phụ thuộc database, application startup hay shared helper.
- `excel_service.py` tiếp tục re-export API cũ để không làm vỡ caller; worker chỉ dùng service đầy đủ cho các export thực sự cần database.
- Regression import-boundary ngăn tái tạo dependency graph nặng trong ba tác vụ `create_mothau_template`, `create_phanlo_excel`, `create_tuychonmuathem_excel`.
- Worker median giảm 27,4–56,5% trên 10–10.000 dòng; direct path không hồi quy đáng kể.
- Full backend, frontend, security, document/Excel gate và production package đều đạt. Còn thiếu Linux CI và template Excel staging có quy mô thực.

## 23. PR 16 — Deep module ghi metric trên hot-path

**Trạng thái triển khai 2026-07-27:** Hoàn thành cục bộ, full gate đạt.

- Tạo `backend.observability.recording` với interface nhỏ `record → snapshot → reset`; implementation chỉ dùng standard library và không import database, HTTP, logging hoặc application module.
- Database lane, session, db primitive, sync phase và structured-log queue ghi trực tiếp vào recorder; `metrics.py` chỉ render snapshot và re-export tên cũ để giữ compatibility.
- Test import-boundary đỏ trước sửa vì 5/5 producer import Prometheus renderer; sau sửa 0/5. SCC backend lớn nhất giảm 13 → 6 module.
- Fresh import median giảm `312,99 → 243,68 ms` cho database lane và `310,79 → 255,04 ms` cho session store; logging không đổi đáng kể vì vốn dùng lazy import.
- Reset test utility nay xóa cả database phase/max counters, tránh metric từ test trước rò sang test sau.
- Gate: backend `1.054 passed, 1 skipped`, JavaScript `244/244`, security static gate `161` file. Linux CI vẫn chờ môi trường ngoài máy hiện tại.

## 24. PR 17 — Trả kết nối audit độc lập về pool

**Trạng thái triển khai 2026-07-27:** Hoàn thành cục bộ và full gate đạt.

- `log_audit` có hai đường: audit gắn cursor dùng transaction của caller; audit độc lập tự lấy kết nối từ pool. Đường độc lập trước đây commit/rollback nhưng không `close`, khiến pooled connection không được trả lại.
- Regression giả lập khóa cả nhánh thành công và lỗi đều gọi `close()` đúng một lần. Integration PostgreSQL dùng pool tối đa 1 slot chạy 5 audit liên tiếp, mỗi lần vẫn có `pool_available=1` và không request chờ.
- 14/36 call site hiện dùng đường audit độc lập; vì vậy lỗi có thể làm cạn pool sau nhiều thao tác đăng nhập/tài liệu/OTP dù truy vấn chính đã kết thúc.
- Local import đổi từ mega-facade `shared.helpers` sang trực tiếp `db_helper`, giữ lazy loading nhưng loại SCC 6 module. Backend nay chỉ còn một SCC 3 module riêng ở partner/sync.
- Gate: backend `1.058 passed, 1 skipped`, JavaScript `244/244`, security static gate `161` file.

## 25. PR 18 — Loại import cycle partner/sync cuối cùng

**Trạng thái triển khai 2026-07-27:** Hoàn thành cục bộ và full gate đạt.

- SCC cuối gồm `partner_lookup_service → sync.api → sync.service → partner_lookup_service`. Cạnh ngược xuất phát từ partner worker import `broadcast_websocket_event` qua route facade `sync.api`.
- Broadcast interface thực sự do `sync.websocket` sở hữu; partner worker nay import lazy trực tiếp tại seam này. Route adapter và sync post-commit giữ nguyên interface/ordering.
- Thêm static graph test dùng Tarjan trên toàn backend; test đỏ với SCC 3 module và xanh sau sửa với 0 cycle. Test này ngăn facade import tái tạo vòng phụ thuộc.
- Focused partner/sync/WebSocket `76 passed`; full backend `1.059 passed, 1 skipped`; JavaScript `244/244`; security gate `161` file.

## 26. PR 19 — Mở rộng deep recorder cho toàn bộ metric producer nóng

**Trạng thái triển khai 2026-07-27:** Hoàn thành cục bộ, full gate đạt và đã đóng gói production.

- Chuyển document worker, partner lookup/address, WebSocket và audit monitor sang interface ghi metric thuần standard-library trong `backend.observability.recording`.
- Giữ `metrics.py` làm renderer/HTTP boundary và re-export API cũ; chỉ `app.py` và `lifecycle.py` còn import module này theo đúng trách nhiệm runtime/monitor.
- Partner lookup và WebSocket lấy database primitive trực tiếp từ `db_helper`, không đi qua mega-facade `shared.helpers`.
- Regression khóa import boundary, snapshot/reset/renderer cho document, partner, WebSocket và audit; payload metric giữ nguyên.
- Fresh-import median giảm 24,2% cho partner service, 19,5% cho WebSocket và 39,3% cho document worker; address routes giảm 9,2%; audit monitor không đổi đáng kể.
- Gate: focused recorder/worker/WebSocket/audit `78 passed, 1 skipped`; focused recorder/partner/import graph `44 passed`; full backend `1.061 passed, 1 skipped`; JavaScript `244/244`; security static gate `161` file; backend 0 import cycle.

## 27. PR 20 — Bảo toàn STT duy nhất cho cây tiêu chí chi tiết

**Trạng thái triển khai 2026-07-27:** Hoàn thành cục bộ, full gate đạt và đã đóng gói production.

- Chuẩn hóa số thứ tự theo từng nhóm trước bước loại dòng thỏa thuận liên danh; không renumber chéo tab.
- Dùng active prefix mapping để số con đi theo số cha mới khi STT nguồn lặp do ô gộp/draft cũ.
- Giữ nguyên criterion ID, nội dung, kết quả, thứ tự và quy tắc nhà thầu độc lập/liên danh.
- Regression thuần module không phụ thuộc DOMPurify, chạy trong khoảng 75 ms và khóa cả lặp cấp cao lẫn lặp cha có cây con.
- Gate: JavaScript `245/245`, backend `1.061 passed, 1 skipped`, security static gate `161` file, secure build/package đạt.
