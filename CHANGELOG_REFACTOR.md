# Changelog review/refactor

## 2026-07-26 — Chốt nghiệp vụ NV1–NV6 và đổi màu warning

### Quyết định đã ghi nhận

- Code cũ được phép chạy với database schema mới hơn; vẫn chặn schema thấp hơn yêu cầu.
- Bỏ “Trạng thái hồ sơ giấy”, chỉ dùng “Trạng thái hợp đồng”.
- Liên kết hợp đồng–gói thầu không bắt buộc nhà thầu hợp đồng là nhà thầu trúng.
- Tác vụ tài liệu lỗi phải được giữ để tra cứu và chạy lại.
- Báo cáo đánh giá chi tiết không cần `nguoi_cham_id`.
- Sai/thiếu/xung đột tên nhà thầu trong Excel chỉ cảnh báo; người dùng chọn “Vẫn nhập” hoặc “Hủy”.

Các quyết định được ghi trong `CONTEXT.md`, `docs/adr/0001-*` đến `docs/adr/0006-*`, `TOM_TAT_BUG_CAN_XAC_NHAN.md`, `CODE_REVIEW_REPORT.md` và `REFACTOR_PLAN.md`.

### CSS đã sửa

Đổi warning sang bảng màu cam thống nhất trong `views/css/variables.css`, `tokens.css`, `toast.css`, `ui-redesign.css` và `views.css`:

- màu chính `#c2410c`;
- hover `#a83a08`;
- accent/icon `#f97316`;
- nền nhạt `#fff7ed`;
- viền `#fed7aa`.

`npm run build:secure` đạt; tương phản màu chính với nền trắng là 5,18:1 và với nền nhạt là 4,88:1.

### Release gate CSS focus đã sửa

Rule focus của ô đánh dấu báo cáo chi tiết không còn hard-code `3px`, mà dùng `--focus-ring-width` (1px). Test policy focus và secure build đều đạt.

### Data contract báo cáo đánh giá chi tiết đã sửa

- Backend không còn bắt buộc lý do cho tiêu chí `fail` trong báo cáo chi tiết.
- Draft/payload/output mới không còn `nguoi_cham_id`; upsert không ghi đè giá trị legacy.
- Cột database nullable được giữ nguyên để tương thích với code cũ và migration đã áp dụng.
- 24/24 test mapper policy và 40/40 test đánh giá chi tiết đạt.

### Đối chiếu nhà thầu khi nhập Excel đã sửa

Mismatch tên nhà thầu không còn chặn cứng. Hộp thoại hiển thị tên trong Excel và tên đang chọn, với hai thao tác “Vẫn nhập”/“Hủy”. `customConfirm` hỗ trợ nhãn nút theo ngữ cảnh mà không làm đổi nhãn của các hộp thoại sau. 131/131 test JavaScript và secure build đạt.

### Failed document job retention/retry đã sửa

Failed job không còn bị xóa khi worker hoặc consumer trả lỗi. Metadata, lỗi cuối và immutable input được giữ đến retention purge; thao tác `--retry-failed <JOB_ID>` chuyển trạng thái có idempotency từ `failed` sang `retry`. Retention mặc định là 24 giờ và có thể cấu hình tối đa 30 ngày.

### Mutation outbox durability đã sửa

Mutation được dual-write theo workspace vào local storage/IndexedDB và hydrate sau reload. Sync 500/409/network error không còn discard hoặc force-reload local draft; ack snapshot cũ giữ nguyên chỉnh sửa phát sinh trong lúc request đang chờ. 5/5 regression test durability, 136/136 JS suite và secure build đạt.

### Persistence của mutation outbox đã tách thành deep module

Envelope version/revision/tombstone, dual-write local storage/IndexedDB, lựa chọn bản mới nhất, đọc dữ liệu legacy và lỗi flush đã được gom vào `WorkspaceMutationOutboxStore`. `BiddingModel` chỉ delegate qua interface `persist`/`hydrate`/`flush`; không còn biết khóa lưu hay cấu trúc envelope. 5/5 test trực tiếp tại seam, 5/5 characterization sync, 144/144 JavaScript test và secure build đạt.

### Queue mutation đã deepening và bỏ deep equality

`WorkspaceMutationOutbox` sở hữu enqueue/snapshot/ack/reject cùng generation theo bản ghi. Ack hoặc validation response của snapshot cũ không thể xóa chỉnh sửa mới; mỗi thay đổi payload sinh idempotency key mới, kể cả partial ack/reject. `BiddingModel` chỉ còn adapter nghiệp vụ và không clone toàn queue ở mỗi mutation. Microbenchmark 100/500/1.000 bản ghi nhanh hơn lần lượt 2,96×/3,30×/3,35×; 152/152 JavaScript test và secure build đạt.

### Import binding chết đã được cleanup

Đã xác minh lại và xóa 21 import binding `SAFE_TO_REMOVE` trên 12 file theo `DEAD_CODE_REPORT.md`; không xóa function/export chỉ “có khả năng” không dùng và không đụng facade tương thích. Full Python suite đạt 996 test, 1 bỏ qua; security static gate, app/auth/sync import smoke và secure frontend build đều đạt.

### Sync transaction module đã deepening giai đoạn 1

HTTP adapter và 31 characterization test không còn gọi hàm private; seam hiện là `execute_sync_mutation`. Typed command/context và các stage actor/idempotency, transaction recheck, post-commit/rollback, default assignment, mutation tracking, payload index và domain uniqueness đã được tách khỏi orchestration. Hàm chính giảm còn khoảng 704 dòng, transaction boundary không đổi. Dynamic SQL auto-assignment được thay bằng ba câu SQL cố định; security baseline giảm từ 9 xuống 8 expression sau review. Full Python suite đạt 999 test, 1 bỏ qua; security static gate đạt trên 151 file.

### Sync record serializer và optimistic writer đã tách

Chuẩn hóa ID/JSON/date/datetime/money/number/default/enum cùng kiểm tra ownership ảnh đã chuyển vào `SyncRecordSerializer`. Insert/update theo row version, conflict payload, ownership, child rows và liên kết hợp đồng–gói thầu đã chuyển vào `SyncRecordWriter`. `execute_sync_mutation` giảm từ khoảng 704 xuống 457 dòng. Sáu dynamic SQL expression được phân bổ lại 2 serializer + 4 writer, tổng không tăng; identifier đều từ schema allowlist và giá trị vẫn bind. Full Python suite đạt 1.001 test, 1 bỏ qua; security static gate đạt trên 153 file.

### Sync record validation stage đã tách

Authorization, optimistic precheck, archived rule, package transition/locked fields, assignment requirement, owner reference, uniqueness và error formatting đã chuyển vào `SyncRecordValidator.validate_payload()`. `execute_sync_mutation` còn khoảng 335 dòng orchestration và không còn dynamic SQL. Hai SELECT theo bảng chuyển sang validator với identifier từ schema iterator, tenant/ID bind parameter. Full Python suite đạt 1.002 test, 1 bỏ qua; security static gate đạt trên 154 file.

### Tenant-scoped media path đã sửa

Ảnh upload mới được lưu dưới segment tenant hash, nên cùng record ID giữa hai tổ chức không còn trùng file. Signed URL từ chối namespace tenant khác; path legacy vẫn được đọc qua kiểm tra ownership database. Các suite security/sync/media liên quan đều đạt.

### Sparse evaluation update đã sửa

Upsert kết quả đánh giá phân biệt key thiếu, `null` và chuỗi rỗng. Field không có trong payload không còn bị ghi đè bằng mặc định rỗng; câu SQL cố định tiếp tục dùng bind parameter. 26/26 mapper policy test đạt.

### Immutable Excel import context đã sửa

Package/tab/workspace được capture khi chọn file và truyền xuyên parser/preview/save. Nếu context thay đổi trong lúc đọc hoặc trước khi lưu, import dừng mà không mutate. 3/3 regression test context, 139/139 JS suite và secure build đạt.

### Idempotency request hash đã bổ sung

Migration v18 thêm `sync_mutations.request_hash`. Sync lưu SHA-256 của canonical payload và trả 409 khi một `clientMutationId` bị dùng lại với nội dung khác; row legacy hash `NULL` vẫn replay tương thích. Test cả preflight và transaction recheck đạt.

### npm High vulnerabilities đã xử lý

PostCSS/nanoid được nâng lên bản vá và `brace-expansion` được override lên 5.0.8 mà không dùng breaking downgrade của obfuscator. `npm audit --audit-level=high` hiện báo 0 vulnerability; secure build đạt.

### Release gate security/package đã khôi phục

Toàn bộ dynamic SQL đã được review nguồn identifier/bind/tenant scope trước khi cập nhật fingerprint. Static gate đạt trên 146 file Python. `build:plain` bị loại khỏi production interface; package smoke check đạt.

## 2026-07-26 — Giai đoạn review và đề xuất

### Phạm vi

Đã review repository tại HEAD `1fb76ad` và diff từ merge-base `abeca2ac4d47d978b1363aa542474216e274a679` với `origin/main`.

## Cập nhật implementation: bỏ danh tính người chấm khỏi runtime

- SQL đồng bộ vòng/kết quả đánh giá không còn ghi `nguoi_cham_id`.
- Migration v19 bỏ index, trigger, khóa ngoại và hàm kiểm tra liên quan; cột nullable vẫn được giữ để code cũ chạy với schema mới.
- Full Python suite: 1.004 đạt, 1 bỏ qua; security gate và 41 test JavaScript đánh giá chi tiết đều đạt.

## Cập nhật implementation: Award Result ViewModel

- Thêm interface thuần `buildAwardResultViewModel` để gom metadata, edit scope, mode hiển thị, contractor binding và rule trúng–trượt.
- `AwardResultDetailsPanel.js` giảm 1.477 → 1.343 dòng; xóa map/set chết và logic domain khỏi HTML branch.
- 9 test interface mới, 161/161 JavaScript test và secure build đều đạt.

## Cập nhật implementation: Award Approval Command

- Thêm interface `prepareAwardApprovalCommand` để chụp và chuẩn hóa toàn bộ decision/bidder/winner/lot/JV data trước mutation.
- Submit handler không còn query lặp DOM sau validation; panel query theo local root thay vì global document.
- `AwardResultDetailsPanel.js` giảm tiếp 1.343 → 1.290 dòng; 165/165 JavaScript test và secure build đều đạt.

## Cập nhật implementation: Award Approval Workflow

- Thêm module `AwardResultApprovalWorkflow` với interface `execute(context)` và production/test ports cho dependency commit, decision commit và lot lifecycle.
- Renderer không còn sở hữu mutation bid/contractor/lot/metadata, sync, navigation hay result alerts; 382 dòng được thay bằng một lời gọi workflow.
- `AwardResultDetailsPanel.js` giảm 1.290 → 904 dòng; 169/169 JavaScript test và secure build đều đạt.

## Cập nhật implementation: Award Result Panel Controller

- Thêm module `AwardResultPanelController` với interface `bindAwardResultPanelController(context)` để sở hữu hủy chỉnh sửa, đồng bộ ngày, winner exclusivity, trạng thái input, row liên danh/chỉ định thầu, Excel actions, thêm nhà thầu và submit orchestration.
- Renderer chỉ còn dựng history/summary/approval markup rồi giao toàn bộ hành vi của form cho controller; các dependency DOM/workflow thừa đã được loại khỏi caller.
- Giữ đúng DOM contract của gói phân lô ngay cả khi danh sách lô rỗng và thêm regression test cho trường hợp này.
- `AwardResultDetailsPanel.js` giảm 904 → 397 dòng, lũy kế 1.477 → 397 dòng; 172/172 JavaScript test, security lint, secure build và `git diff --check` đều đạt.

## Cập nhật implementation: Award Result Presentation

- Tách `buildOfficialResultHistoryMarkup` sang module riêng và giữ re-export tương thích; parser phần lô legacy hỏng JSON giờ trả danh sách rỗng an toàn thay vì làm vỡ màn hình lịch sử.
- Thêm interface `buildAwardResultSummaryPresentation({ model, pkg, summary, allBids })` sở hữu winner/lot/JV runtime binding, bidder rows và table header cho cả gói phân lô lẫn không phân lô.
- Chuẩn hóa đối chiếu contractor ID dạng số/chuỗi trong màn hình nhiều nhà thầu trúng; thêm test trực tiếp cho whole-package, multiple-lot và joint-venture presentation.
- `AwardResultDetailsPanel.js` giảm 397 → 220 dòng, lũy kế 1.477 → 220 dòng; 176/176 JavaScript test, security lint, secure build và `git diff --check` đều đạt.

## Cập nhật implementation: Bid Evaluation Ranking Controller

- Thêm interface `createBidEvaluationRankingController({ root, pkg, bids, isTwoEnvelope, isReadOnly })`, sở hữu thu thập DOM row, process-two locking, lý do không đạt, tính xếp hạng/điểm và cập nhật row.
- Thay hai lượt `find` trên toàn bộ bid cho mỗi row bằng `Map<bidId,bid>` dùng lại trong render cycle; đường lưu báo cáo cũng dùng index tương tự.
- Thay static source assertion bằng test qua interface cho xếp hạng, stale row và quy trình 2 khóa sau nhà thầu đạt nhưng mở lại đầy đủ trường làm rõ khi row còn hợp lệ.
- `BidEvaluationWorkflow.js` giảm 1.264 → 1.128 dòng. Microbenchmark lookup 100/500/1.000/5.000 row nhanh hơn 3,00×/10,85×/21,09×/45,16×; đây là benchmark lookup, chưa gồm DOM/layout.
- Toàn bộ 178/178 JavaScript test, security lint, secure build và `git diff --check` đều đạt.

## Cập nhật implementation: Bid Evaluation History và Lot Scope

- Thêm interface `renderBidEvaluationRoundHistory(context)` sở hữu history cards, scoped bidder rows, dữ liệu báo cáo 1G1T/1G2T, continuation gate và trạng thái ẩn/hiện vòng hiện tại.
- Thêm interface `renderBidEvaluationLotScope(context)` sở hữu mode toàn bộ/đã chọn, checkbox phần lô, badge/feedback/title, khóa Excel cho partial scope và callback state mới.
- Thay static source assertion về nút Excel bằng test hành vi qua interface; giữ characterization rằng partial save luôn tạo official batch.
- `BidEvaluationWorkflow.js` giảm 1.128 → 974 dòng, lũy kế 1.264 → 974 dòng; toàn bộ 180/180 JavaScript test, security lint, secure build và `git diff --check` đều đạt.

## Cập nhật implementation: Bid Evaluation Table Presentation

- Thêm interface thuần `buildBidEvaluationTablePresentation({ pkg, isTwoEnvelope, currentTab, lotScope })` trả descriptor chung cho row renderer: `caseType`, consulting/lot flags, combined-score visibility, title và header markup.
- Gom bảy nhánh 1G1T/1G2T, kỹ thuật/tài chính, phân lô/không phân lô và tư vấn thành một bảng cell có thứ tự ổn định; caller không còn tự suy luận lại các cờ này.
- Test trực tiếp toàn bộ bảy case, scope title, cột đảm bảo/giá, hiệu lực E-HSĐXKT/E-HSĐXTC và vị trí điểm tổng hợp.
- `BidEvaluationWorkflow.js` giảm 974 → 811 dòng, lũy kế 1.264 → 811 dòng; toàn bộ 185/185 JavaScript test, security lint, secure build và `git diff --check` đều đạt.

## Cập nhật implementation: Bid Evaluation Row Renderer

- Thêm interface `renderBidEvaluationRows({ root, pkg, bids, model, presentation, isReadOnly, onRankingChange })` sở hữu toàn bộ bidder-row markup, detailed-report projection, contractor/JV binding, quy trình 2 và listener của bảng đánh giá.
- `BidEvaluationTablePresentation` trả thêm `isTwoEnvelope` và `currentTab`; row renderer dùng descriptor duy nhất thay vì suy luận lại loại vòng ở caller.
- Chuyển các dependency contractor version, JV modal, currency/duration binding và detailed projection khỏi workflow sang module row renderer; xóa static source test cũ và thay bằng sáu test qua interface.
- Bao phủ editable 1G1T, financial 1G2T kết hợp giá–kỹ thuật, read-only projection, liên danh, quy trình 2, empty state cùng listener tiền/thời hạn.
- `BidEvaluationWorkflow.js` giảm 811 → 524 dòng, lũy kế 1.264 → 524 dòng; toàn bộ 190/190 JavaScript test, security lint và secure build đều đạt.

## Cập nhật implementation: Bid Evaluation Panel State/Controller và event batching

- Thêm pure module `buildBidEvaluationPanelState(...)` sở hữu parse/normalize metadata legacy, 1G1T/1G2T tab gate, scope theo lô, trạng thái hoàn thành/chỉnh sửa và khóa theo kết quả gói thầu.
- Thêm interface `bindBidEvaluationPanelController({ appController, pkg, panelState, onRerender })` sở hữu Quy trình 1/2, ưu đãi/tie-price eligibility, tab kỹ thuật–tài chính, form báo cáo, công văn, Excel và save/edit actions.
- Sửa phạm vi Quy trình 1/2 theo nghiệp vụ: hiển thị cho Hàng hóa, Xây lắp, Hỗn hợp và Phi tư vấn dùng 1G1T; fallback không hợp lệ được persist một lần và rerender bằng microtask thay cho timeout 100 ms.
- `BidEvaluationRankingController` thêm `schedule()`/`dispose()`: cập nhật đầu tiên chạy ngay, các yêu cầu tiếp theo được batch theo animation frame và scheduled callback cũ không can thiệp DOM sau rerender.
- `BidEvaluationWorkflow.js` giảm 524 → 192 dòng, lũy kế 1.264 → 192 dòng; toàn bộ 202/202 JavaScript test, security lint, secure build và `git diff --check` đều đạt.

## Cập nhật implementation: Detailed Evaluation deep modules

- Tách `resolveDetailedEvaluationState(controller)` sở hữu lựa chọn gói/vòng/nhà thầu/tab, draft cache, criteria override, template-seed suppression, hierarchy và toàn bộ rule read-only/reopen.
- Tách `bindDetailedEvaluationPanelController(...)` cùng collector DOM; module sở hữu discard gate, điều hướng nhà thầu/tab bằng chuột–bàn phím, dirty state, result marks, save/reopen, add/remove và Excel actions.
- Tách `analyzeDetailedEvaluationWorkbook(...)` thành import plan thuần: generic/muasamcong mapping, hierarchy/STT, criteria replacement và row merge hoàn tất trước nhưng không mutate cache cho tới khi xác minh nhà thầu.
- Tách `DetailedEvaluationCriteriaController` cho thêm/xóa/cấu hình tiêu chí và `executeDetailedEvaluationSave(...)` cho validation, projection, metadata, atomic commit, success state cùng retry-safe dirty draft khi commit lỗi.
- Giữ public re-export hiện có và không đưa `nguoi_cham_id` trở lại draft/report/payload. `DetailedEvaluationWorkflow.js` giảm 1.004 → 192 dòng.
- Toàn bộ 215/215 JavaScript test, security lint, secure build và `git diff --check` đều đạt.

## Cập nhật implementation: Package Detail deep modules

- Thêm pure interface `buildPackageDetailViewModel(...)` sở hữu canonical package version, tab hợp lệ, trạng thái kết quả hiệu lực, quyền chỉnh sửa và danh sách phiên bản đã dedupe theo phiên bản kế hoạch.
- `bindPackageDetailChrome(...)` sở hữu header, status badge, hủy thầu, version selector và điều hướng tab; `showPackageDetails` không còn tự quản lý DOM chrome.
- Tách `PackageOpeningPanel`, `QualifiedApprovalPanel` và deepening `FinancialOpeningPanel` để mỗi panel sở hữu markup, state, validation, event và save tương ứng.
- Sửa lỗi quyết định phê duyệt kỹ thuật theo lô từng mutate một metadata object khác object được lưu; target của đợt phần lô giờ thuộc đúng canonical metadata.
- Gom metadata `financialOpening` theo lô vào cùng lần persist/sync với giá dự thầu, bỏ lượt sync package thứ hai và tránh trạng thái metadata/bid lệch nhau.
- `GoiThauDetail.js` giảm 829 → 194 dòng; public re-export `checkBidQualified` được giữ tương thích.
- Toàn bộ 225/225 JavaScript test, `npm run lint:security`, `npm run build:secure` và `git diff --check` đều đạt.

## Cập nhật implementation: batch detailed-evaluation persistence

- Thay hai SELECT trên mỗi dòng chi tiết bằng một criterion prefetch và một existing-detail prefetch cho mỗi report; cả hai đều tenant-scoped.
- Giữ kiểm tra owner/vòng, required result, score bound, stable detail ID và sparse child-list semantics trên map đã prefetch.
- Gửi upsert chi tiết qua `executemany`; statement logic phần detail giảm từ `3R + 1` xuống `R + 3`, được khóa ở 10/100/1.000 criterion.
- PostgreSQL integration round-trip/tenant isolation đạt; toàn bộ Python 1.007 test đạt, 1 bỏ qua; security static gate và `git diff --check` đạt.
- Chưa có latency/WAL/lock benchmark staging, nên chưa kết luận hiệu năng production.

## Cập nhật implementation: durable worker idle backoff

- Thêm `IdlePollBackoff` dùng chung cho document embedded/external, email outbox và partner enrichment; exponential delay có subtractive jitter, hard max và reset sau khi có job.
- Giữ cancellation qua `asyncio.CancelledError` và `threading.Event.wait`; partner claim failure không còn tạo hot retry loop, job xử lý lỗi không chặn job kế tiếp.
- Thêm các max-poll env và runbook vận hành; mặc định hard max 10 giây.
- Thêm benchmark mô phỏng tái lập. Fixed-5-second scenario giảm 46,9–47,2% claim attempt; external document fixed-1-second giảm 89,4%; pickup p95 mô phỏng dưới 10 giây.
- Toàn bộ Python 1.017 test đạt, 1 bỏ qua; security static gate và `git diff --check` đạt. Chưa đo lại `pg_stat_statements` production.

## Cập nhật implementation: incremental audit-chain verification

- Thêm checkpoint-anchored incremental verifier: xác minh checkpoint/HMAC/installation, anchor rows, chỉ hash tail mới và đối chiếu materialized heads.
- Monitor dùng incremental giữa các checkpoint export; mọi bất nhất fallback về full scan vẫn gắn checkpoint. Startup và export tiếp tục full verification.
- Tái sử dụng full verification khi build checkpoint, bỏ lần full scan thứ hai trong cùng lượt export.
- PostgreSQL tests khóa full/incremental equivalence, query shape không full-scan và anchor rollback fail closed.
- Toàn bộ Python 1.022 test đạt, 1 bỏ qua; security static gate và `git diff --check` đạt. Benchmark 10k/100k/1M và runtime remeasurement còn thiếu.

## Cập nhật implementation: route-specific workflow loading

- Thêm deep module `WorkflowModuleLoader` sở hữu ma trận route/method, readiness, concurrent promise reuse, failed-import retry và compatibility load cả hai group.
- Route mở thầu/đánh giá/chi tiết gói thầu và thao tác tạo kế hoạch/gói thầu chỉ tải bidding workflow; thao tác tạo/chỉnh sửa chủ đầu tư, nhà thầu, chuyên gia và hợp đồng chỉ tải partner workflow.
- `ensureWorkflowModules()` tiếp tục được giữ cho caller cũ; `GoiThauDetail` fallback qua bidding-only loader.
- Secure artifact cho thấy execution path bidding tránh yêu cầu chunk partner 61.590 B raw/14.071 B gzip; partner-create tránh yêu cầu chunk bidding 376.519 B raw/80.738 B gzip. Chưa tuyên bố navigation nhanh hơn vì chưa có Playwright trace.
- Toàn bộ JavaScript 230/230 đạt; `npm run lint:security`, `npm run build:secure` và `git diff --check` đạt.

### File đã tạo

- `CODE_REVIEW_REPORT.md`
- `DEAD_CODE_REPORT.md`
- `REFACTOR_PLAN.md`
- `PERFORMANCE_REPORT.md`
- `CHANGELOG_REFACTOR.md`

### Mã nguồn đã sửa

**Không có.** Giai đoạn này chỉ tạo tài liệu review/đề xuất theo yêu cầu:

- không sửa frontend/backend;
- không sửa database schema;
- không chỉnh migration đã áp dụng;
- không đổi dependency/lockfile;
- không đổi cấu hình deploy/CI;
- không ghi dữ liệu ứng dụng.

Workspace đã có sẵn trạng thái xóa `ke-hoach-bao-cao-danh-gia-chi-tiet.md` trước khi tạo các artifact review; lượt review không tạo, khôi phục hay chỉnh sửa thay đổi đó.

### Code đã xóa

Không có. `DEAD_CODE_REPORT.md` ghi 21 import binding `SAFE_TO_REMOVE` và các candidate cần xác nhận cho PR implementation riêng.

### Module đã tách

Không có. `REFACTOR_PLAN.md` mô tả seam/interface/module mục tiêu và thứ tự PR.

### Public interface được giữ nguyên

Toàn bộ public behavior/interface hiện tại được giữ nguyên vì không sửa source.

### Public interface đã thay đổi

Không có.

### Test đã thêm

Không có.

### Kiểm tra đã chạy

| Lệnh/nhóm | Kết quả |
|---|---|
| Full Python suite | 985 đạt, 1 bỏ qua, 1 lỗi |
| `node --test tests/js/*.test.mjs` | 130/130 đạt |
| `node --test tests/js/detailed_evaluation.test.mjs` | 40/40 đạt |
| `npm run build:secure` | Đạt |
| `python scripts/package_production.py --check` | Đạt |
| Coverage backend | 72%, coverage gate hiện tại đạt |
| `pip-audit` | Không có vulnerability Python đã biết |
| Bandit | Đạt |
| `npm run lint:security` | Đạt |
| `python scripts/security_static_gate.py` | Lỗi: 10 dynamic-SQL fingerprint cần review |
| `npm audit --audit-level=high` | Lỗi: 5 High |
| Linux document sandbox probe | Không chạy được trên Windows |

Lỗi Python còn lại:

- `tests/test_frontend_navigation_stability_policy.py::test_focus_indicators_share_one_compact_width_token`
- Nguyên nhân: `views/css/views.css:3924` dùng outline 3px thay vì token 1px.

### Benchmark

- Secure build: 6,25 giây ở lần warm hiện tại; lượt trước 8,84 giây.
- Bundle: 39 JS chunk, 1.745.238 byte raw, 379.856 byte gzip.
- PostgreSQL local seeded snapshot: 17.10; hot query mẫu dùng index và không sequential scan.
- Worker snapshot: 71.113 poll, 71.112 poll rỗng, khoảng 3,77 giây DB execution cộng dồn.
- Audit-chain snapshot: 425 full verification, 113 audit row hiện tại.
- Không có số “sau tối ưu” vì chưa triển khai tối ưu.

### Việc còn lại sau khi sửa correctness/release gate

Các lỗi P0/P1 đã liệt kê ở snapshot review này đã được xử lý. Phần còn lại là refactor deep module, cleanup code chết, tối ưu có benchmark và full verification cuối.

Đối chiếu tên nhà thầu đã chuyển sang cảnh báo có hai lựa chọn “Vẫn nhập” và “Hủy”; loại nhà thầu tiếp tục lấy từ dữ liệu hệ thống.

## Đo navigation source/production lặp 5 lần — 2026-07-27

- Chạy 20 ca Chromium: 10 login sample và 5 sample cho mỗi thao tác navigation trên source và ZIP production; tất cả đạt.
- Login → dashboard median/p95: source 734/939 ms, production 588/816 ms.
- Package → evaluation median/p95: source 911/1.241 ms, production 824/1.040 ms.
- Mở báo cáo chi tiết rỗng median/p95: source 106/114 ms, production 98/109 ms.
- Không thay code vì production không có hồi quy so với source; số đo được ghi vào `PERFORMANCE_REPORT.md`. Staging/network profile và parse/evaluate vẫn là giới hạn còn lại.

## Benchmark xuất Word chi tiết — 2026-07-27

- Thêm `scripts/benchmark_document_export.py` để đo context seal, render trực tiếp, worker sandbox và burst song song trên 10/100/500 dòng.
- 500 dòng có direct median/p95 74,71/90,56 ms; worker cô lập 594,25/612,46 ms; output 39.960 byte và đủ 500 dòng khi mở lại.
- 4 job song song hoàn tất trong 1.243,37 ms với giới hạn mặc định 2 worker, không reject/timeout.
- Không thay runtime worker: chi phí khoảng 0,5–0,6 giây là sandbox process boundary có chủ đích, không tăng đáng kể theo số dòng.

## Tối ưu worker xuất Excel — 2026-07-27

- Tách ba tác vụ dựng workbook thuần khỏi `excel_service` sang `excel_workbook_builder`, tránh nạp helper database và tầng ứng dụng trong tiến trình con.
- Giữ nguyên API tương thích tại `excel_service`; các export cần database không thay đổi đường chạy.
- Worker median giảm từ 1.143 xuống 497 ms ở 10 dòng, 1.119 xuống 504 ms ở 100 dòng, 1.244 xuống 642 ms ở 1.000 dòng và 2.346 xuống 1.702 ms ở 10.000 dòng.
- Thêm benchmark tái lập và regression import-boundary; full backend `1.050 passed, 1 skipped`, frontend `244/244`, security gate và nhóm Excel/document đều đạt.
- Production ZIP mới gồm 272 runtime file, 1.528.607 byte; SHA-256 `79E16ECEC4D32E8A7E550ABADF8AE9A830D6693BF3290DB4184023A1467A36B2`.

## Tách recorder metric khỏi Prometheus renderer — 2026-07-27

- Thêm deep module ghi/snapshot/reset metric thuần standard-library; database/session/logging producer không còn nạp endpoint Prometheus và dependency graph ứng dụng.
- Giữ compatibility bằng re-export tại `metrics.py`; nội dung metric Prometheus và tên label không thay đổi.
- SCC backend lớn nhất giảm 13 xuống 6 module; fresh import median database lane giảm 22,1%, session store giảm 17,9%.
- Sửa `_reset_metrics_for_tests` trước đây bỏ sót database phase/max counters; thêm regression qua interface recorder và renderer.
- Backend `1.054 passed, 1 skipped`, JavaScript `244/244`, security static gate `161` file đều đạt.
- Production ZIP gồm 273 runtime file, 1.529.745 byte; SHA-256 `68D5A504195E3F6F82C606B944AF01CE3F4857881E71DE9297A9FBC4B09FBB65`.

## Sửa rò kết nối trong audit độc lập — 2026-07-27

- `log_audit()` nay luôn đóng pooled connection trong `finally` sau audit độc lập, cả khi append thành công hoặc phát sinh lỗi.
- Test giả lập đỏ trước sửa với `close_calls=0`; sau sửa hai nhánh đều đóng đúng một lần.
- Integration PostgreSQL pool 1 slot chạy 5 audit liên tiếp không cạn pool; `pool_available=1`, `requests_waiting=0` sau mỗi lượt.
- Loại import logging qua `shared.helpers`, làm SCC backend 6 module biến mất; chỉ còn SCC partner/sync 3 module.
- Full backend `1.058 passed, 1 skipped`, JavaScript `244/244`, security gate `161` file đạt.
- Production ZIP gồm 273 runtime file, 1.529.765 byte; SHA-256 `C5E8C9B155997020E73ADB45AEBEDDB9AD4A5ACBCA93925F221531B20A3D8438`.

## Loại import cycle partner/sync cuối cùng — 2026-07-27

- Partner enrichment worker gọi broadcast trực tiếp qua module sở hữu `sync.websocket`, không đi vòng qua route facade `sync.api`.
- Static import graph test đỏ với SCC 3 module trước sửa và xác nhận toàn backend 0 cycle sau sửa.
- Không đổi WebSocket payload, post-commit ordering, partner queue hoặc transaction semantics.
- Focused suite `76 passed`; full backend `1.059 passed, 1 skipped`; JavaScript `244/244`; security gate `161` file.
- Production ZIP gồm 273 runtime file, 1.529.765 byte; SHA-256 `47B5D8E86B26C1FD5C5B52DD86EB9A692286FA44B09F48C143F04B44FCD23726`.

## Mở rộng deep recorder cho document/partner/WebSocket/audit — 2026-07-27

- Document worker, partner lookup/address, WebSocket và audit monitor ghi metric trực tiếp vào `backend.observability.recording`; renderer Prometheus không còn bị nạp trên các hot-path này.
- `metrics.py` giữ nguyên public compatibility và chỉ phục vụ snapshot/render/HTTP; payload, label và reset semantics được khóa bằng regression test.
- Partner lookup và WebSocket không còn import database qua `shared.helpers`.
- Fresh-import median giảm 24,2% cho partner service, 19,5% cho WebSocket, 39,3% cho document worker và 9,2% cho address routes; audit monitor không đổi đáng kể.
- Full backend `1.061 passed, 1 skipped`, JavaScript `244/244`, security gate `161` file và backend import graph 0 cycle đều đạt.
- Production ZIP gồm 273 runtime file, 1.530.190 byte; SHA-256 `8D58AAE4AEDA1ED2913B63D04FCE0EDF8D227C3F8324FF58B0083CC1362A854C`.

## Sửa STT trùng sau khi loại tiêu chí liên danh — 2026-07-27

- Chuẩn hóa STT duy nhất theo từng nhóm trước khi điều chỉnh cho nhà thầu độc lập/liên danh; dữ liệu draft cũ và Excel có số cấp cao lặp không còn tạo nhiều dòng cùng STT.
- Khi một số cha nguồn lặp, số anh em kế tiếp được cấp tự động và toàn bộ hậu duệ ngay sau đó được remap theo cha mới; không đổi criterion ID, kết quả hoặc thứ tự dòng.
- Feedback loop đỏ đúng chuỗi runtime `1, 2, 2.1, 2.1.1, 2, 2`, sau sửa thành `1, 2, 2.1, 2.1.1, 3, 4`; ca cha/con lặp cũng được khóa.
- Gate: JavaScript `245/245`; backend `1.061 passed, 1 skipped`; security static gate `161` file; secure build và production package đạt.
- Production ZIP gồm 273 runtime file, 1.531.588 byte; SHA-256 `47AB33B7CE92EB8D1C1BF59836F4BBB84BBC8881A4828BE3854E25D0771A46B1`.
