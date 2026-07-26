# Kế hoạch refactor và sửa lỗi BiddingFlow

- Căn cứ: `CODE_REVIEW_REPORT.md`, `DEAD_CODE_REPORT.md`, `PERFORMANCE_REPORT.md`
- Snapshot lập kế hoạch: `1fb76ad`
- Trạng thái: **đề xuất; chưa triển khai**

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
| 1 | Schema compatibility fail-closed | P0 | PR 0 |
| 2 | Bảo toàn/khôi phục migration v11 | P0 | PR 1 |
| 3A | Characterization sync failure | P0 | PR 0 |
| 3B | Persistent mutation outbox | P0 | PR 3A |
| 4 | Tenant-scoped media paths | P0 | PR 0 |
| 5 | Đồng bộ data contract đánh giá chi tiết | P0/P1 | PR 0 |
| 6A | Immutable Excel import context | P1 | PR 0 |
| 6B | Deep module import muasamcong + contractor identity | P1 | PR 6A |
| 7 | Contract–award–lot integrity | P1 | Quyết định nghiệp vụ/pháp chế |
| 8A | Sparse update semantics | P1 | PR 3A |
| 8B | Idempotency request hash | P1 | PR 8A |
| 9 | Failed document job retention/retry | P1 | PR 0 |
| 10 | Deepen sync transaction module | P2 | PR 3B, 8A, 8B |
| 11 | Tách các god render và shared rules | P2 | PR 5, 6B, 7 |
| 12 | Tối ưu theo benchmark | P3 | Baseline E2E/load hoàn chỉnh |
| 13 | Cleanup code chết và tài liệu kiến trúc | P3 | Các PR correctness ổn định |

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

## 4. PR 1 — Schema compatibility fail-closed

**Problem**

Code cũ hiện chấp nhận mọi database schema mới hơn.

**Current behavior**

`verify_database_readiness` và readiness probe chỉ reject schema thấp hơn; migration runner lại reject schema cao hơn.

**Target design**

Module `SchemaCompatibilityPolicy` có interface nhỏ:

`evaluate({installedVersion, applicationVersion, declaredRange}) -> {compatible, reason, guidance}`

Mặc định `declaredRange=[applicationVersion, applicationVersion]`. Một release chỉ khai báo range rộng hơn sau contract test. Startup/readiness/migrator dùng cùng policy.

**Files affected**

`backend/startup.py`, `backend/db/upgrades.py` hoặc module policy mới, `backend/lifecycle.py`, tests startup/migration, deployment docs.

**Refactor steps**

1. Viết test đỏ cho installed 18 / app 17 bị reject mặc định.
2. Tách pure policy; không đưa database adapter vào interface.
3. Dùng policy từ readiness và startup.
4. Giữ auto migration opt-in; error hướng dẫn deploy đúng code, tuyệt đối không hạ metadata.
5. Ghi ADR compatibility range.

**Tests required**

Older/equal/newer, declared compatible range, metadata missing, readiness parity, fresh schema và upgrade schema.

**Risk**

Medium: rollout đang dựa vào hành vi fail-open có thể ngừng startup; đây là dừng an toàn có chủ đích.

**Rollback**

Rollback binary, không sửa metadata. Nếu cần zero-downtime, deploy code tương thích trước rồi migration.

**Estimated complexity**

S–M — 1–2 ngày.

## 5. PR 2 — Bảo toàn và khôi phục migration v11

**Problem**

v11 drop dữ liệu trạng thái hồ sơ giấy mà không archive.

**Current behavior**

Database chưa qua v11 sẽ chạy destructive statements; database đã qua v11 chỉ có thể phục hồi từ backup.

**Target design**

- Không sửa function v11 đã áp dụng.
- Migration runner có pre-upgrade preservation hook khi `current_version < 11`, tạo backup table/versioned export trước khi gọi v11.
- Migration mới v18 tạo vùng tương thích/khôi phục có audit metadata.
- Runbook chỉ dẫn extract từ backup cho database đã qua v11.

**Files affected**

`backend/db/upgrades.py` chỉ để đăng ký migration mới/hook mới, `scripts/manage_database.py`, tests migration, deploy runbook.

**Refactor steps**

1. Chụp canonical legacy fixture v10 có dữ liệu khác rỗng.
2. Viết test đỏ chứng minh giá trị mất.
3. Thêm preflight backup ngoài implementation v11.
4. Thêm v18 forward migration/schema hỗ trợ import recovery.
5. Thêm dry-run/report và backup-required check.
6. Viết hướng dẫn đã-upgrade/chưa-upgrade riêng.

**Tests required**

v10→current có dữ liệu, v11→current, fresh current, retry idempotent, rollback transaction, backup restore.

**Risk**

High: migration và recovery data.

**Rollback**

Backup bắt buộc; migration mới chỉ additive; rollback ứng dụng không xóa backup table.

**Estimated complexity**

L — 4–7 ngày cộng diễn tập staging.

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
5. Xác nhận `nguoi_cham_id` luôn gắn actor hợp lệ và không cần trường UI.

**Tests required**

Fail không reason, not-applicable note, score bounds, parent aggregation, payload cũ/mới, save/reload, active reviewer tenant.

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

`ImportDecision` chỉ có `accepted` hoặc `rejected`, identity evidence, criteria, rows, warnings và selected sheets. Module tự xử lý:

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
4. Fail closed cho workbook muasamcong thiếu/xung đột/sai identity.
5. Chỉ mutate draft sau `accepted`; lưu import provenance.
6. Giữ custom-template path riêng, không tự suy là muasamcong.

**Tests required**

14A/B/C/D; hàng hóa/xây lắp/hỗn hợp/phi tư vấn/tư vấn; 1G1T/1G2T; quy trình 1/2; phân lô; independent/JV; đúng/sai/mất identity; accent/dash/case; multi-sheet conflicting name; no-mutation rejection.

**Risk**

High: nhận diện nghiệp vụ nhiều biến thể.

**Rollback**

Giữ parser hiện tại sau feature flag trong một release; compare decisions ở shadow mode nhưng chỉ một path được write.

**Estimated complexity**

XL — 7–10 ngày, chia recognition/identity và mapping/application thành hai PR.

## 12. PR 7 — Contract–award–lot integrity

**Problem**

Hợp đồng không xác nhận winner/lot.

**Current behavior**

UI lọc theo plan; DB trigger chỉ kiểm tra same-plan lineage.

**Target design**

Link hợp đồng tham chiếu stable award result + lot identity. Invariant:

- result final;
- contractor hợp đồng khớp winner của từng lot;
- package-level award dùng explicit whole-package scope;
- direct/special selection đi qua exception type được pháp chế chấp thuận.

**Files affected**

Contract UI/workflow, schema canonical, PostgreSQL trigger, migration mới, mapper/sync, document context, tests/research ADR.

**Refactor steps**

1. Chốt câu hỏi pháp chế về direct appointment và multi-lot contract.
2. Characterize dữ liệu contract hiện có.
3. Thêm nullable compatibility columns/link table bằng migration mới.
4. Backfill có báo cáo unmatched; không đoán winner.
5. Enforce UI rồi backend rồi DB constraint/trigger.
6. Mở hard enforcement sau staging audit.

**Tests required**

Whole package, multi-lot multi-winner, wrong contractor, canceled/reopened result, exception, old payload, tenant cross-link.

**Risk**

High: nghiệp vụ hợp đồng và migration.

**Rollback**

Enforcement feature flag; schema additive; giữ old links đến khi backfill xác nhận.

**Estimated complexity**

XL — 10–15 ngày sau quyết định nghiệp vụ.

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

Failed job metadata/input immutable được quarantine với TTL, encryption/permission hiện có, size quota và audit. Ops command retry tạo attempt mới gắn parent job; purge là thao tác riêng, idempotent và logged.

**Files affected**

`document_worker.py`, worker CLI, schema/migration nếu cần attempt lineage, deployment runbook, metrics/tests.

**Refactor steps**

1. Chốt retention và dữ liệu nào được phép giữ.
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
- Route-specific workflow load nếu browser trace chứng minh lợi ích.

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

**Problem**

Import thừa, test-only exports, README nghèo và không có domain context/ADR.

**Current behavior**

21 binding an toàn để xóa; nhiều candidate cần xác nhận; architecture knowledge nằm rải rác.

**Target design**

Cleanup nhỏ, không behavior change; `CONTEXT.md` mô tả ubiquitous language và data flow; ADR ghi schema compatibility, sync outbox, import identity, contract-lot.

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
