# PROMPT CHO CODEX — SỬA TRIỆT ĐỂ CÁC VẤN ĐỀ AUDIT VÒNG 2 CỦA BIDDINGFLOW

## 0. Mục tiêu và tính kế thừa

Bạn đang thực hiện một đợt sửa lỗi và củng cố production cho repository BiddingFlow.

Baseline dùng trong audit:

```text
2bd3e018fb0ca5cc4dcfd349207ca5c252c66606
```

Trước khi sửa bất kỳ code nào, bắt buộc đọc đầy đủ ba tài liệu theo thứ tự:

```text
docs/PROMPT_CODEX_REFACTOR_FIX_BIDDINGFLOW_TOAN_DIEN.md
docs/PROMPT_CODEX_FIX_HOAN_THIEN_TOAN_BO_CAC_VAN_DE_AUDIT_BIDDINGFLOW.md
docs/PROMPT_CODEX_FIX_TRIET_DE_CAC_VAN_DE_AUDIT_VONG_2_BIDDINGFLOW.md
```

Tài liệu này bổ sung các finding H1–H14 được phát hiện sau khi đối chiếu prompt trước với code hiện hành. Nó không thay thế hoặc làm giảm hiệu lực của bất kỳ yêu cầu A1–A10, B1–B5, C1–C3, D1–D4, E1–E3, F1–F2 và G1–G3 nào trong prompt audit vòng 1. Nếu các tài liệu khác nhau về độ chặt, áp dụng yêu cầu chặt hơn, trừ khi một ADR mới có bằng chứng rõ ràng thay thế quyết định cũ.

Đây là nhiệm vụ triển khai hoàn chỉnh. Không được dừng ở báo cáo, TODO, skeleton, helper chưa được nối vào production path, test bị skip, hoặc sửa một seam trong khi các seam tương đương vẫn lệch contract.

## 0.1. Business contract ưu tiên cao nhất — không tự ý đổi hiển thị dữ liệu hoặc quyền

Phần này thay thế mọi yêu cầu hoặc suy luận mâu thuẫn trong prompt gốc, prompt audit vòng 1, H2 của tài liệu này, ADR 0008 và implementation phát sinh từ các nội dung đó.

1. Codex không được tự ý thêm/bỏ masking, redaction, ẩn trường, lọc response hoặc thay đổi dữ liệu người dùng nhìn thấy.
2. Codex không được tự ý thêm/bỏ/gộp/tách hoặc đổi semantics của role, permission, assignment scope, capability, entitlement, inheritance hay default allow/deny.
3. “An toàn hơn”, “least privilege”, “fail-closed” hoặc “best practice” không phải là thẩm quyền để thay đổi nghiệp vụ. Khi prompt không yêu cầu rõ, phải giữ nguyên hành vi. Nếu contract chưa rõ và thay đổi là cần thiết, phải hỏi chủ sản phẩm trước khi sửa code/schema/UI/test.
4. Người có quyền đọc bản ghi theo tenant + module + assignment + record scope phải xem đầy đủ dữ liệu của bản ghi đó, bao gồm CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và trường liên quan.
5. Entitlement/capability xuất Word chỉ kiểm soát hành động tạo hoặc tải tài liệu Word; tuyệt đối không dùng nó để che/mở dữ liệu ở API hoặc giao diện đọc bản ghi.
6. Không tồn tại capability đọc dữ liệu nhạy cảm riêng trong contract hiện hành. Mọi implementation, UI, migration, visibility epoch và test được thêm dựa trên giả định này phải được loại bỏ hoặc vô hiệu hóa tương thích.
7. Các rào chắn tenant isolation, module permission, assignment scope, record authorization, session và audit vẫn bắt buộc; quy tắc này không mở quyền truy cập bản ghi ngoài scope.
8. Mọi thay đổi quyền/hiển thị được phép trong tương lai phải có xác nhận nghiệp vụ rõ ràng, ADR/business contract, compatibility/migration plan và regression tests xuyên mọi seam liên quan.

---

# 1. Quy tắc làm việc bắt buộc

## 1.1. Bảo toàn worktree

Repository có thể đang chứa thay đổi dở dang của người dùng hoặc của phiên làm việc trước. Trước khi sửa:

1. Ghi lại `git status --short`, branch và HEAD.
2. Phân biệt thay đổi đã có trước với thay đổi do nhiệm vụ này tạo ra.
3. Không reset, restore, checkout, clean, xóa hoặc ghi đè thay đổi không thuộc phạm vi.
4. Không khôi phục các tài liệu đang bị xóa nếu không được yêu cầu.
5. Nếu file cần sửa đã dirty, đọc diff và tích hợp cẩn thận; không thay toàn bộ file.

Tuyệt đối không dùng:

```text
git reset --hard
git checkout -- <path>
git clean -fd
```

## 1.2. Audit lại trạng thái thực tế trước implementation

Line number trong tài liệu này chỉ là mốc audit. Phải dùng search và call graph để xác nhận code hiện hành, mọi alias, route registration, writer, reader và consumer liên quan.

Trước khi sửa phải tạo requirement traceability matrix tối thiểu có các cột:

| ID | Invariant/requirement | Production writers/readers | Tests hiện có | Khoảng trống | Files dự kiến sửa | Verification |
|---|---|---|---|---|---|---|

Matrix phải bao phủ toàn bộ yêu cầu của ba prompt, không chỉ H1–H14. Mỗi finding phải được đóng bằng code production và regression test hoặc được chứng minh đã đúng bằng test có ý nghĩa.

## 1.3. Chốt contract trước khi thay đổi schema/hành vi

Phải đọc toàn bộ ADR 0001–0007 trong `docs/adr/`. Nếu code hiện hành trái ADR, sửa code và test theo ADR. Nếu bằng chứng mới buộc phải đổi contract, tạo ADR superseding rõ lý do, migration/compatibility impact và rollout plan; không âm thầm đổi semantics.

Ít nhất phải chốt nhất quán các contract sau:

1. Canonical module identity và alias migration.
2. Quyền đọc đầy đủ bản ghi sau khi đã qua tenant/module/assignment/record scope; quyền export Word là action entitlement độc lập và không được chi phối hiển thị trường.
3. Assignment khi offboard là optional hay bắt buộc successor.
4. Active role là persona/UI hay security boundary thực sự.
5. Visibility epoch gồm những input nào và legacy cursor được nâng cấp ra sao.
6. WebSocket là durable delivery hay bounded invalidation hint; ADR 0006 hiện chọn hint.
7. Official export lấy authoritative state nào và entitlement nào.
8. Cách biểu diễn effective contract relation khi exact link và lineage-derived link cùng tồn tại.

## 1.4. Test-first và kiểm tra xuyên seam

Với mỗi lỗi:

1. Viết regression test đỏ tại ranh giới gần production nhất.
2. Sửa source-of-truth chung.
3. Chuyển toàn bộ route/service/sync/UI/AI/export consumer sang source-of-truth đó.
4. Chạy test hẹp ngay.
5. Cuối cùng chạy full suite và các gate ở mục 6.

Không mock bỏ qua authorization, transaction, database semantics hoặc client merge behavior mà lỗi thực tế phụ thuộc vào chúng.

---

# 2. Các finding bổ sung bắt buộc sửa

## H1. Canonical module registry vẫn phân mảnh và gây deny sai

### Bằng chứng audit

- `backend/shared/access_policy.py` chuẩn hóa `thong_tin_mo_thau`, package goods và bidder goods về module `goithau`.
- `backend/procurement_import/routes.py` vẫn có đường chạy hard-code `thongtinmothau`.
- `backend/ai/workspace_search.py` vẫn gán opening/bidder goods vào `thongtinmothau`.
- `backend/ai/permission_context.py` không cấp permission key tương ứng.

Một người dùng có quyền `goithau` hợp lệ vì vậy vẫn có thể bị deny sai ở direct procurement import hoặc AI search. Alias khác nhau còn làm audit log, permission cache và migration khó kiểm soát.

### Yêu cầu

1. Tạo một canonical module registry duy nhất cho module ID, legacy alias, permission key và resource/table mapping.
2. Mọi authorization seam — HTTP, sync, procurement import, AI, export, background job và frontend capability — phải dùng registry hoặc API chung.
3. Legacy alias chỉ được nhận ở compatibility boundary và phải canonicalize trước khi authorize/persist/log.
4. Thêm migration/data audit nếu database đang lưu alias cũ; không tạo hai permission row có nghĩa tương đương.
5. Unknown module phải fail closed với public error ổn định.

### Acceptance

- Cùng một principal/workspace/resource cho kết quả authorization giống nhau qua direct route, sync, import và AI.
- User chỉ có canonical `goithau` không bị deny ở opening/bidder goods hợp lệ.
- Alias cũ được normalize có audit signal; alias lạ bị deny.
- Test quét route/resource registry phát hiện module literal ngoài allowlist.

## H2. Quyền đọc dữ liệu nhạy cảm đang dùng nhầm capability export tài liệu

### Bằng chứng audit

- `backend/shared/sensitive_data.py` đọc `_stored_document_export_capabilities` để quyết định hiển thị dữ liệu nhạy cảm.
- Schema, organization API và UI mô tả capability này là quyền xuất tài liệu.
- Vì vậy grant tưởng chỉ cho DOCX/XLSX có thể vô tình mở bank account, identity hoặc signature trong UI/API record read.

### Yêu cầu

1. Tách rõ hai action trong authorization vocabulary:
   - `sensitive.record.read`
   - `sensitive.document.export`
2. Nếu giữ một capability trung tính dùng chung, phải rename xuyên schema/API/UI/migration và giải thích rõ semantics; không giữ tên “export” nhưng dùng cho read.
3. Default và migration phải fail closed, không tự nâng quyền người dùng hiện hữu.
4. Redaction phải được thực hiện server-side trước serialization, search index, AI context, export context và async job payload.
5. Audit log không được chứa chính secret đã bị deny.

### Acceptance

- Bốn tổ hợp read/export grant được test độc lập.
- Có export permission không tự động mở sensitive fields trên record API nếu contract tách quyền.
- Revocation có hiệu lực với request mới, async job và sync pull.
- UI label, API DTO, database column/capability registry không còn mô tả mâu thuẫn.

## H3. Optional assignment vẫn bị sync bắt successor

### Bằng chứng audit

- Member/offboarding API xác nhận assignment có thể để trống successor.
- `backend/sync/service.py` vẫn trả `ASSIGNMENT_SUCCESSOR_REQUIRED`.
- Admin UI và BiddingView vẫn điều khiển successor modal theo contract cũ.

### Yêu cầu

1. Chọn đúng domain contract đã chốt trong ADR/prompt vòng 1 và áp dụng qua member API, sync mutation, offline queue, UI và bulk operation.
2. Đặt rule trong `AssignmentDomainService` hoặc policy duy nhất; không copy điều kiện.
3. Nếu successor optional, định nghĩa rõ disposition của assignment còn mở và record visibility sau offboarding.
4. Nếu một loại assignment đặc biệt bắt buộc successor, dùng typed reason/policy theo loại, không blanket rule.

### Acceptance

- Cùng payload cho kết quả nghiệp vụ tương đương qua online API và offline sync.
- Cancel successor modal không làm client/server rơi vào trạng thái khác nhau.
- Retry/idempotency không tạo assignment trùng hoặc mất provenance.

## H4. Visibility epoch thiếu security input và legacy cursor có thể bypass reset

### Bằng chứng audit

- `backend/sync/visibility_epoch.py` mới hash membership, permission row, assignment và một số capability.
- Token chưa phản ánh đầy đủ platform role, active/effective role, scope/owner, account/org active state, subscription entitlement và policy/fingerprint version.
- Delta paging chỉ compare khi client gửi token có giá trị.
- Frontend vẫn có thể dùng last sync version với visibility token trống từ cache legacy.

### Yêu cầu

1. Định nghĩa versioned visibility fingerprint canonical từ mọi input có thể thay đổi tập record/field/action nhìn thấy.
2. Include ít nhất principal/account state, tenant membership state, platform/effective role, module permission revision, assignment revision, scope/personal owner semantics, sensitive/export entitlement revision, subscription/org state và policy schema version.
3. Không hash raw secret; token phải ổn định, canonical và không lộ security state.
4. Cursor legacy có last version nhưng thiếu token phải full reset/full sync một lần, không được delta tiếp.
5. Token mismatch/revocation phải xóa/quarantine local rows không còn visible, kể cả tombstone không xuất hiện.
6. Có rollout/migration cho cache cũ và multi-tab.

### Acceptance

- Mỗi thay đổi security-relevant làm đổi epoch và buộc safe reset.
- Thay đổi không ảnh hưởng visibility không gây reset vô ích nếu contract cho phép.
- Legacy empty/malformed token không bypass reset.
- Multi-tab không thể ghi ngược cursor/epoch cũ sau khi tab khác đã reset.

## H5. Full/delta sync vẫn fetch tenant-wide rồi filter, gây privacy leak và starvation

### Bằng chứng audit

- `backend/sync/read_service.py` select toàn bộ tenant row rồi mới gọi record filter.
- Full manifest select tenant-wide ID.
- Legacy tombstone chỉ kiểm table-level permission.
- Delta union lấy candidate tenant-wide trước limit rồi mới lọc record scope; record unauthorized có thể chiếm page budget và làm authorized row bị starvation.

### Yêu cầu

1. Tạo shared `VisibilityScopeBuilder`/query policy được dùng bởi full rows, manifest, delta upsert, tombstone và count/cursor logic.
2. Push tenant, role, assignment, owner/scope và record predicate xuống SQL trước ordering/limit.
3. Tombstone chỉ được phát nếu client từng có quyền thấy identity đó hoặc qua privacy-preserving revocation/reset protocol; không tiết lộ ID foreign record.
4. Pagination cursor phải tiến theo stream authorized, có ordering deterministic và không skip/starve vì candidate bị lọc hậu kỳ.
5. Tránh giant `IN (...)`, N+1 và materialize toàn tenant trong RAM.

### Acceptance

- Tenant có lượng lớn unauthorized row không làm page authorized rỗng/starve.
- Query/result count và memory scale theo authorized page, không theo toàn tenant.
- Manifest không lộ foreign ID.
- PostgreSQL explain/benchmark chứng minh predicate và index được dùng.

## H6. Snapshot clone còn fail-open và validator chưa kiểm toàn graph

### Bằng chứng audit

Trong `backend/versioning/aggregate_snapshot.py` còn các pattern nguy hiểm:

- award lot thiếu mapping vẫn tự tạo ID mới;
- criterion parent thiếu mapping thì bỏ qua;
- detailed criterion fallback về source criterion ID;
- bidder goods opening fallback về source opening ID;
- timeline unknown source ID được giữ nguyên.

Relation query chưa có canonical ordering, trong khi deterministic ID factory phụ thuộc ordinal. `aggregate_validator.py` mới kiểm một phần top-level graph.

### Yêu cầu

1. Clone pipeline phải fail closed với mọi internal reference không map được, trừ reference được registry đánh dấu external/shared hợp lệ.
2. Cấm `mapping.get(old_id, old_id)`, silent `continue`, tự sinh target cho missing parent, hoặc giữ source-version ID.
3. Tạo relation clone policy registry đầy đủ: ownership, clone/share policy, required/optional, resolver, order key và validation rule.
4. Repository query phải có ordering canonical dựa trên stable business/source key; deterministic ID không được phụ thuộc incidental database row order.
5. Validator phải kiểm full pending target graph trước persist: packages, lots, award lots, goods, opening, bidder goods, rounds, criteria/parents/details, evaluations/reports, assignments/provenance, timeline/metadata, adjustments, joint venture, documents và mọi relation registry entry.
6. Validate no cross-version leakage và exactly-one/uniqueness cardinality cần thiết.
7. Generation, validation và persistence cùng transaction; lỗi không để partial target.

### Acceptance

- Mỗi missing map kể trên có test đỏ riêng và fail atomic với typed error.
- Cùng source snapshot tạo cùng target IDs bất kể query insertion order.
- Validator coverage test thất bại khi registry có relation mới nhưng thiếu clone/validation policy.
- Không orphan, dangling parent hoặc source-version internal ID sau snapshot.

## H7. Historical aggregate mutability guard chỉ phủ một phần writer

### Bằng chứng audit

- `backend/sync/aggregate_mutability.py` mới nhận diện opening, package goods và bidder goods.
- Package document direct routes chỉ dùng normal write authorization.
- Lot lifecycle routes không kiểm owning plan là historical.
- Lots, evaluations, timeline, adjustments, documents, lifecycle artifacts và expert relations chưa có coverage thống nhất.

### Yêu cầu

1. Tạo ownership graph/registry từ mọi mutable child về aggregate plan/version root.
2. Một guard canonical phải chạy trên mọi writer: direct HTTP, sync/offline, bulk import, background job, document job và internal command.
3. Historical version immutable theo contract, kể cả mutation gián tiếp qua child ID hoặc file endpoint.
4. Guard phải resolve tenant + owner atomically, không tin client-supplied parent.
5. Unknown/unregistered mutable type phải fail closed hoặc làm registry coverage test thất bại.

### Acceptance

- Matrix test mọi mutable table × writer seam × latest/historical.
- Không thể sửa historical data qua document upload/delete, lifecycle route, sync hoặc import.
- Latest transition race với write được khóa/CAS đúng; không TOCTOU.

## H8. Direct-write convergence thiếu ngoài procurement import

### Bằng chứng audit

- Lot lifecycle service insert row với `sync_version=0`, create route không enqueue event.
- Lifecycle/document table không có trong generic sync table registry.
- Package document routes có thể phát `db_changed`, nhưng delta không trả document state tương ứng.
- Client nhận hint rồi pull có thể không thấy thay đổi nào, dẫn tới event “rỗng” và state không hội tụ.

### Yêu cầu

1. Lập writer → projection/convergence matrix cho mọi state có thể mutate.
2. Mỗi writer bắt buộc chọn đúng một cơ chế có contract rõ:
   - generic delta row;
   - bump parent aggregate version rồi refetch projection;
   - typed invalidation + conditional direct GET.
3. Persist domain change, sync cursor/projection revision và transactional outbox trong cùng transaction khi applicable.
4. Không phát event generic nếu client không có đường lấy state mới.
5. Retry phải idempotent; delete và replacement phải hội tụ đa client.

### Acceptance

- Matrix production được test tự động để writer mới không thể thiếu convergence policy.
- Lifecycle create/update/delete và document upload/delete hội tụ trên client khác mà không reload toàn app.
- Rollback domain write không để cursor/event phantom; commit không để state vô hình.

## H9. Official export vẫn có client-only bypass và entitlement sai loại

### Bằng chứng audit

- Award result official winning-goods export đọc trực tiếp `model.state` và gọi `XLSX.writeFile` trên client.
- Bidder/package goods có đường export client-side tương tự.
- Một số backend Excel route nhận rows từ client và chỉ xác minh session.
- Timeline XLSX và frontend award result dùng Word entitlement cho Excel.

### Yêu cầu

1. Mọi official export phải chạy server-side từ authoritative persisted snapshot/revision.
2. Server phải authorize tenant, record scope, active role, sensitive field policy và đúng entitlement theo format/action tại thời điểm generate và, nếu async, tại thời điểm download.
3. Không tin rows/columns/sensitive values do client gửi. Client chỉ gửi resource ID, expected revision và typed export option allowlisted.
4. Draft/local export nếu được phép phải có tên, watermark/metadata và UX phân biệt rõ; không gọi là official.
5. Tạo entitlement registry chung cho Word/Excel/PDF và route registration coverage test.
6. Audit log phải ghi actor, tenant, resource/revision, export type, outcome; không ghi secret.

### Acceptance

- Pending local edits không xuất hiện trong official file.
- Revoked user/entitlement không thể export bằng gọi route trực tiếp hoặc replay job URL.
- Excel không dùng Word entitlement.
- Tamper client rows không thay đổi official output.
- TOCTOU revision có typed conflict hoặc snapshot semantics rõ.

## H10. Runtime WebSocket không tuân ADR “bounded invalidation hint”

### Bằng chứng audit

- ADR 0006 chọn WebSocket chỉ là hint và yêu cầu periodic bounded delta.
- `frontend/app/WebSocketSyncClient.js` dừng polling khi nhận socket `ready`.
- Backend broker đọc `id > last_event_id` kết hợp `available_at <= now`, trong khi scalar cursor có thể tiến qua event đang backoff.
- Global delivered status kết hợp local socket theo worker có thể tạo false delivery.

### Yêu cầu

1. Thực thi đúng ADR 0006: socket chỉ kích hoạt pull sớm; periodic bounded pull vẫn chạy khi socket healthy.
2. Dùng jitter/backoff, visibility/online awareness và single-flight để tránh thundering herd, nhưng phải có convergence latency bound đo được.
3. Không dùng scalar cursor theo cách skip event deferred. Broker claim/delivery phải hỗ trợ retry gap hoặc không còn là correctness boundary.
4. Không đánh dấu globally delivered chỉ vì một worker không sở hữu socket của recipient.
5. Reconnect, missed event, duplicated/out-of-order hint và multi-worker đều phải an toàn.

### Acceptance

- Giữ socket `ready` nhưng drop một event: client vẫn hội tụ trong bound đã cấu hình.
- Deferred event ID thấp không bị skip bởi ID cao.
- Hai backend worker với socket ở worker khác không false-deliver.
- Duplicate hint không gây concurrent pull/merge corruption.

## H11. Sync error path lộ raw exception, schema và identifier

### Bằng chứng audit

- `backend/sync/service.py` đưa `str(item_err)` vào public response và echo record ID.
- PostgreSQL exception có thể chứa constraint, table, column hoặc SQL context.
- Foreign/unauthorized ID có thể bị phản chiếu, tạo enumeration oracle.

### Yêu cầu

1. Tạo allowlisted public error mapper với stable code, safe localized message và optional correlation ID.
2. Không trả raw exception, SQL text, schema/constraint name, stack trace hoặc unauthorized identifier.
3. Record ID chỉ echo nếu caller được phép biết identity đó; nếu không dùng client mutation correlation token an toàn.
4. Structured internal log được redaction, phân quyền và có correlation; không log sensitive payload.
5. Error contract đồng nhất giữa direct API, batch sync và async job.

### Acceptance

- Constraint, type, serialization và unexpected exception đều không lộ internal detail.
- Foreign ID probe trả response indistinguishable phù hợp policy.
- Client vẫn phân biệt validation/conflict/retryable/auth mà không cần raw message.

## H12. Active-role contract mâu thuẫn giữa authorization, UI và AI

### Bằng chứng audit

- `has_inherited_specialist_access()` vẫn cho manager/super-admin ở employee mode broad access.
- `is_organization_manager()` lại false trong employee mode.
- `has_module_permission()` có thể true nhờ inherited path.
- UI hiển thị “Chuyên viên” và ẩn manager action, trong khi backend có thể vẫn cho broad action.
- AI tự xây permission context bằng logic riêng.

### Yêu cầu

1. Chốt ADR: active role chỉ là persona/presentation hay là effective least-privilege security boundary.
2. Tạo `AuthorizationContext` duy nhất phân biệt platform role, organization role, active persona, effective capabilities và record scope.
3. HTTP, sync, AI, export, background job và frontend capability projection phải cùng semantics.
4. Nếu persona-only, UI không được tạo cảm giác đã hạ quyền; phải hiển thị effective authority rõ.
5. Nếu security boundary, backend phải hạ quyền thật và cache/token/async job phải bind effective role.
6. Role switch phải rotate/recompute visibility epoch và xử lý pending offline mutations an toàn.

### Acceptance

- Decision table test cho manager/super-admin/member × active persona × seam.
- UI action availability không mâu thuẫn backend authorization.
- AI không đọc resource mà direct API bị deny trong cùng context.
- Switch persona ở tab khác không giữ stale elevated cache.

## H13. Aggregate scale chưa được giải quyết, mới chỉ tăng cap

### Bằng chứng audit

- Generated aggregate cap được tăng đến 100.000.
- Payload vẫn materialize lớn trong memory, validator đi nhiều pass và persistence có thể per-record/savepoint.
- Nested child cap vẫn có nơi là 500.
- Chưa có benchmark bắt buộc cho aggregate trên 2.000 record, query count, peak memory và rollback chunk.

### Yêu cầu

1. Không coi tăng constant/cap là performance fix.
2. Định nghĩa supported aggregate envelope thực tế theo entity mix, payload bytes, memory, latency và database parameter/query limit.
3. Dùng streaming/chunking/bulk insert hợp lý nhưng vẫn giữ atomicity hoặc explicit resumable protocol có idempotency; không partial snapshot âm thầm.
4. Validator cần bounded memory và không quadratic; dedupe/index mapping phải O(n) kỳ vọng.
5. Harmonize cap ở request, nested validation, generator và DB layer; error phải sớm và rõ.
6. Đo query count, peak RSS/heap, wall time và rollback behavior trên PostgreSQL production-like.

### Acceptance

- Benchmark ít nhất các mốc 2.000, 10.000 và một mốc gần supported maximum với entity mix thực tế.
- Có threshold regression trong CI hoặc documented performance job.
- Failure giữa chunk không để partial graph/event/version.
- Không giant `IN`, N+1 hoặc per-row commit/savepoint.

## H14. Relation lineage có thể nhân đôi effective contract

### Bằng chứng audit

- `backend/versioning/relation_policy.py` join mọi link cùng lineage.
- Một contract có exact link và nhiều historical/lineage link có thể xuất hiện lặp trong effective projection.
- Timeline document, frontend timeline, analytics, detail/export và AI có thể đếm/hiển thị sai.

### Yêu cầu

1. Giữ raw relation evidence bất biến để audit.
2. Xây effective projection canonical, dedupe theo contract identity với precedence:
   - exact target-version link;
   - sau đó lineage-derived link phù hợp gần nhất theo rule đã chốt.
3. Tie-break phải deterministic; ambiguity không được phụ thuộc row order.
4. Shared resolver phải dùng cho backend document context, frontend DTO/timeline, analytics, detail/export và AI.
5. Không để từng consumer tự dedupe theo cách khác nhau.

### Acceptance

- Exact + một/nhiều lineage link chỉ tạo một effective contract.
- Raw evidence vẫn truy vấn/audit được đầy đủ.
- Analytics count, timeline UI, document/export và AI trả cùng tập effective relation.
- Insertion order không thay đổi kết quả.

---

# 3. Regression test bổ sung bắt buộc

Ngoài toàn bộ test đã yêu cầu trong hai prompt trước, phải có ít nhất các scenario sau:

1. Canonical `goithau` permission qua direct import, sync và AI cho cùng kết quả.
2. Legacy module alias normalize; unknown alias fail closed.
3. Sensitive record read và document export được cấp/thu hồi độc lập.
4. Offboarding không successor có parity online/offline/UI theo contract.
5. Visibility epoch đổi khi role, persona, assignment, scope, account/org state hoặc entitlement đổi.
6. Legacy cursor có version nhưng thiếu visibility token buộc full reset.
7. Unauthorized delta candidates không chiếm page limit của authorized records.
8. Full manifest và tombstone không lộ foreign record ID.
9. Snapshot fail atomic cho missing award-lot, criterion-parent, detailed-criterion, opening và timeline map.
10. Snapshot ID ổn định khi database trả relation theo thứ tự khác.
11. Historical plan bị deny qua document và lifecycle direct route lẫn sync.
12. Lifecycle/document direct write hội tụ trên client thứ hai.
13. Rollback direct write không phát cursor/outbox phantom.
14. Official export bỏ pending client overlay và bỏ qua client-supplied rows.
15. Excel route kiểm đúng Excel entitlement, không dùng Word entitlement.
16. Socket healthy nhưng miss hint vẫn hội tụ trong bounded interval.
17. Deferred broker event không bị scalar cursor skip; multi-worker không false-deliver.
18. Sync database exception không lộ schema/constraint/raw ID.
19. Active-role decision matrix parity giữa API, sync, AI, export và UI capability.
20. Exact + lineage relation dedupe nhất quán ở timeline, analytics, export và AI.

Test security phải có positive, negative, cross-tenant và revocation case. Test concurrency/transaction semantics phải chạy PostgreSQL thật; SQLite-only không đủ.

---

# 4. Ma trận bắt buộc trong implementation và báo cáo

## 4.1. Writer → projection/convergence matrix

Liệt kê mọi writer production cho từng aggregate/resource và chỉ rõ:

| Resource | Writer/seam | Transaction owner | Revision/cursor allocation | Projection strategy | Outbox/hint | Client fetch path | Idempotency |
|---|---|---|---|---|---|---|---|

Không được để ô trống hoặc ghi “N/A” nếu resource có thể nhìn thấy ở client khác.

## 4.2. Authorization parity matrix

| Action/resource | HTTP | Sync | Import | AI | Export | Async job | Frontend projection | Canonical policy |
|---|---|---|---|---|---|---|---|---|

Mỗi hàng phải trỏ về cùng source-of-truth hoặc giải thích boundary khác biệt có ADR.

## 4.3. Export action matrix

| Export type | Draft/official | Server source | Record permission | Sensitive permission | Format entitlement | Generate reauth | Download reauth | Audit event |
|---|---|---|---|---|---|---|---|---|

Bao phủ Word, Excel, PDF và tất cả package/bidder/award/timeline document route.

## 4.4. Snapshot relation registry matrix

| Entity/relation | Owner root | Clone/share/external | Required | Stable order key | ID namespace | Resolver | Validator | Historical mutability |
|---|---|---|---|---|---|---|---|---|

Registry coverage test phải phát hiện entity/relation mới chưa khai báo policy.

---

# 5. Thứ tự triển khai đề xuất

## Phase 1 — Contract và red tests

1. Audit lại ba prompt, ADR, current diff và production call graph.
2. Hoàn thiện requirement traceability matrix.
3. Chốt ADR cho module identity, sensitive capability, active role, official export và effective relation nếu chưa đủ rõ.
4. Viết regression test đỏ cho H1–H14 và các mục A–G còn chưa đạt.

## Phase 2 — Security source-of-truth

1. Canonical module/action/capability registry.
2. Unified AuthorizationContext và sensitive policy.
3. Assignment policy parity.
4. Versioned visibility fingerprint và safe legacy reset.
5. SQL-pushed visibility scope cho full/delta/manifest/tombstone.

## Phase 3 — Aggregate/versioning integrity

1. Full ownership/relation registry.
2. Fail-closed deterministic snapshot mapping.
3. Full pending graph validator.
4. Historical mutability guard trên mọi writer.
5. Effective relation projection với deterministic precedence.

## Phase 4 — Convergence, export và WebSocket

1. Hoàn thiện writer → projection matrix và chuyển mọi direct writer vào sync protocol.
2. Server-authoritative official export và entitlement registry.
3. Sanitized public error contract.
4. Bounded periodic delta đúng ADR 0006; sửa retry-gap/multi-worker semantics.

## Phase 5 — Scale và hardening

1. Bulk/stream/chunk snapshot path có atomicity/idempotency rõ.
2. PostgreSQL index/query plan/concurrency tests.
3. Multi-tab/offline/revocation/E2E.
4. Full regression, build, migration và benchmark.

---

# 6. Verification gates bắt buộc

Codex phải phát hiện command chuẩn của repository thay vì đoán. Báo cáo exact command, exit code và kết quả cho từng gate:

1. Full Python test suite.
2. Full JavaScript test suite.
3. Targeted security/versioning/sync/export/WebSocket regression tests.
4. PostgreSQL integration, transaction rollback và race tests.
5. Migration upgrade từ schema hiện hành và clean-install schema.
6. Schema/model/API contract checks.
7. Lint, static analysis, type checking và formatting theo repo.
8. Production frontend build/package.
9. E2E tối thiểu cho role switch, revocation, offline retry, official export và missed WebSocket hint.
10. `git diff --check` và review chỉ các file thực sự thay đổi.
11. Benchmark aggregate ở các mốc quy định, kèm query count, memory và latency.
12. Coverage/registry completeness tests cho route entitlement, authorization seam, mutable entity và snapshot relation.

Nếu một gate không tồn tại hoặc không chạy được, phải nêu exact blocker, bằng chứng đã thử và rủi ro còn lại. Không được ghi “pass” nếu test bị skip/xfailed ngoài chủ đích hoặc chỉ chạy subset.

---

# 7. Những điều tuyệt đối không được làm

1. Không chỉ tăng cap để tuyên bố đã sửa scale.
2. Không thêm alias permission rải rác ở từng route.
3. Không dùng capability có tên export để mở record read mà không chốt/migrate semantics.
4. Không filter record authorization sau pagination limit.
5. Không trả raw exception hoặc database detail cho client.
6. Không fallback internal snapshot reference về source ID.
7. Không silent-skip child relation lỗi.
8. Không coi WebSocket event là state hoặc correctness boundary theo ADR 0006.
9. Không dừng bounded polling chỉ vì socket báo ready.
10. Không phát `db_changed` khi client không có projection/refetch path.
11. Không gọi file tạo từ mutable client state là official export.
12. Không tin client-supplied export rows/sensitive fields.
13. Không tự dedupe lineage riêng ở từng consumer.
14. Không sửa direct route mà bỏ sync/import/background seam tương đương.
15. Không thêm test chỉ xác nhận helper trong khi production route chưa dùng helper.
16. Không weaken tenant isolation, historical immutability, transaction atomicity hoặc offline durability để làm test pass.

---

# 8. Definition of Done

Chỉ được coi là hoàn tất khi:

## Functional và parity

- Mọi requirement của cả ba prompt có trạng thái và bằng chứng trong traceability matrix.
- Direct API, sync/offline, import, AI, export, async job và UI dùng cùng domain/security contract.
- Assignment, active role và relation lineage không còn semantics mâu thuẫn.

## Security và privacy

- Module/capability/action canonical, deny-by-default và có coverage test.
- Sensitive read/export tách đúng contract.
- Full/delta/manifest/tombstone không lộ foreign identity.
- Public error không lộ raw exception/schema/ID.
- Revocation và role switch làm invalid local visibility an toàn.

## Data integrity

- Snapshot clone fail closed, deterministic và validate full graph trước commit.
- Historical aggregate immutable qua mọi writer.
- Raw relation evidence được bảo toàn, effective projection không duplicate.
- Không partial graph/event/cursor sau rollback.

## Convergence

- Mọi writer có projection strategy và client fetch path.
- Direct write, offline mutation, delete và async change hội tụ đa client.
- Missed WebSocket hint vẫn hội tụ trong bounded interval.
- Multi-tab/multi-worker/retry không skip hoặc ghi ngược cursor.

## Export

- Official export là server-authoritative, revision-aware, reauthorized và audited.
- Entitlement đúng format/action; pending local overlay không đi vào official artifact.

## Scale và quality

- Supported aggregate envelope có benchmark và regression threshold.
- Không N+1, giant tenant materialization hoặc post-limit visibility filter trên hot path.
- Full test/lint/build/migration/PostgreSQL gates đạt hoặc blocker được chứng minh minh bạch.
- Không còn TODO/placeholder/dead compatibility path do đợt sửa tạo ra.

---

# 9. Báo cáo cuối cùng Codex bắt buộc trả về

Báo cáo không được chỉ tóm tắt chung. Phải gồm:

1. Baseline HEAD, branch, worktree trước/sau và cách bảo toàn user changes.
2. Requirement traceability matrix cho prompt gốc, audit vòng 1 và H1–H14.
3. Root cause và thay đổi production cho từng finding.
4. ADR/domain decisions và compatibility/migration impact.
5. Authorization parity matrix.
6. Writer → projection/convergence matrix.
7. Export action matrix.
8. Snapshot relation/ownership registry matrix.
9. Migration/index/schema changes và rollback/rollout notes.
10. Tests mới thêm, exact commands, số pass/fail/skip và exit code.
11. PostgreSQL race/transaction results.
12. Benchmark dataset, hardware/environment, query count, peak memory và latency.
13. Files changed theo nhóm, không trộn user pre-existing changes.
14. Remaining risks/blockers cụ thể; không dùng câu “không có” nếu chưa chạy đủ gate.

Kết quả mong muốn không chỉ là test xanh, mà là một hệ thống có authorization nhất quán, snapshot không fail-open, historical data bất biến, sync hội tụ có giới hạn, official export đáng tin và các invariant được bảo vệ bằng test ở đúng ranh giới production.
