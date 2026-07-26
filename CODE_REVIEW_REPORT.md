# Báo cáo review toàn diện BiddingFlow

- Ngày rà soát: 2026-07-26 (Asia/Saigon)
- Nhánh: `codex/public-readiness-hardening-20260719`
- HEAD: `1fb76ad`
- Mốc so sánh: merge-base với `origin/main` là `abeca2ac4d47d978b1363aa542474216e274a679`
- Diff đã đọc: `git diff origin/main...HEAD` — 328 file, 36.048 dòng thêm, 5.696 dòng xóa
- Phạm vi: toàn repository và thay đổi trên nhánh hiện tại
- Trạng thái: **chỉ review và đề xuất; chưa sửa mã nguồn, migration hay dữ liệu**

## 1. Kết luận điều hành

Repository có nền tảng an toàn tương đối tốt: PostgreSQL được ràng buộc theo tenant, sync có version/tombstone, tài liệu chạy qua durable queue và sandbox, coverage backend đạt 72%, 130/130 kiểm thử JavaScript đạt và secure build thành công. Tuy nhiên, chưa nên phát hành hoặc bắt đầu refactor lớn vì còn các vấn đề ưu tiên cao:

1. Ứng dụng hiện chấp nhận database có schema mới hơn bất kỳ phiên bản code nào mà không có compatibility matrix. Cơ chế này có thể cho code cũ ghi vào schema không tương thích.
2. Migration v11 xóa dữ liệu trạng thái hồ sơ giấy mà không lưu bản sao; không được sửa migration đã áp dụng, nhưng cần cơ chế bảo toàn tiến về phía trước và hướng dẫn khôi phục.
3. Sync xóa mutation batch khi server trả lỗi rồi nạp lại dữ liệu, có thể làm mất thay đổi người dùng chưa đồng bộ.
4. Tên file ảnh dùng `record_id` nhưng không có `organization_id`; hai tenant có cùng ID có thể ghi đè ảnh của nhau.
5. UI báo cáo chi tiết đã bỏ “Lý do không đạt”, trong khi backend vẫn bắt buộc trường này khi kết quả là `fail`; tái hiện tối thiểu trả `ValueError: Tieu chi khong dat phai co ly do.`
6. Một số luồng Excel cũ đọc selector gói thầu nhiều lần sau các bước bất đồng bộ, nên có thể ghi dữ liệu vào gói khác nếu người dùng đổi lựa chọn giữa chừng.
7. Hợp đồng chỉ được kiểm tra cùng kế hoạch; chưa ràng buộc nhà thầu hợp đồng với kết quả trúng thầu và phạm vi phần lô.
8. Ba release gate đang đỏ: một policy test CSS, security static gate cho dynamic SQL, và `npm audit` có 5 cảnh báo High.

Yêu cầu mới về đối chiếu nhà thầu trong Excel **đã có triển khai cơ bản** trên HEAD: file muasamcong sai tên bị chặn trước khi dữ liệu được áp vào bản nháp, thông báo hiển thị cả tên trong file và tên đang chọn. Kiểm thử chuyên biệt 40/40 đạt. Phần này vẫn cần hardening ở PR sau: tách identity validation khỏi nhận diện biểu mẫu, đóng băng ngữ cảnh import và ưu tiên mã số thuế/mã nhà thầu khi nguồn có cung cấp.

## 2. Phạm vi và phương pháp

Đã thực hiện:

- Đọc `AGENTS.md`, tài liệu agent, README, cấu hình Python/Node, tài liệu triển khai, kế hoạch và nghiên cứu nghiệp vụ hiện có.
- Xác nhận repository chưa có `CONTEXT.md`, ADR hoặc coding standard riêng; vì vậy review Standards dùng quy tắc repository đang thực thi và code-smell baseline.
- Lập bản đồ entry point, dependency, side effect và data flow.
- Rà soát toàn bộ source bằng tìm kiếm symbol, import graph, Python AST, diff và kiểm tra thủ công các luồng rủi ro cao.
- Chạy test/build/security/packaging/coverage và benchmark có thể chạy trên Windows.
- Đọc `pg_stat_statements` và execution plan trên database PostgreSQL cục bộ có dữ liệu seed; không suy rộng kết quả đó thành production.

Không thực hiện:

- Không thay đổi source, database schema, applied migration hoặc dependency.
- Không xóa code chỉ dựa trên static reachability.
- Không chạy sandbox Bubblewrap vì probe yêu cầu Linux/POSIX.
- Không có browser E2E harness để đo initial load, chuyển tab và render bảng trong trình duyệt thật.

## 3. Baseline chất lượng

| Hạng mục | Kết quả | Ý nghĩa |
|---|---:|---|
| `python -m pytest` | 985 đạt, 1 bỏ qua, 1 lỗi | Gate đang đỏ do focus ring ở `views/css/views.css:3924` |
| `node --test tests/js/*.test.mjs` | 130/130 đạt | Unit/DOM policy JavaScript đạt |
| `node --test tests/js/detailed_evaluation.test.mjs` | 40/40 đạt | Xác nhận import, liên danh/độc lập, lưu/đọc lại và đối chiếu tên nhà thầu |
| `npm run build:secure` | Đạt | Lần đo cục bộ 6,25 giây sau cache; lần trước 8,84 giây |
| `python scripts/package_production.py --check` | Đạt | 260 runtime file, 1.502.937 byte |
| Backend coverage | 72% | Gate tổng >=70% và auth/sync quan trọng >=90% đạt |
| `pip-audit` | Không có CVE đã biết | Chỉ phản ánh dependency Python tại thời điểm chạy |
| Bandit | Đạt | Không thay thế review nghiệp vụ/tenant |
| `npm run lint:security` | Đạt | ESLint và Trusted Types policy đạt |
| `python scripts/security_static_gate.py` | **Lỗi** | 10 fingerprint dynamic SQL thay đổi, cần security review trước khi cập nhật baseline |
| `npm audit --audit-level=high` | **Lỗi** | 5 High; không dùng `npm audit fix --force` vì đề xuất breaking downgrade |
| Linux document sandbox probe | Không chạy được | Windows; phải xác nhận lại trong Linux CI/staging |

### Release gate đỏ cụ thể

- `tests/test_frontend_navigation_stability_policy.py:296-314` yêu cầu focus outline dùng token 1px, nhưng `views/css/views.css:3923-3925` đặt `outline: 3px`.
- Dynamic SQL gate yêu cầu review và baseline có kiểm soát cho: `backend/api/org_routes.py`, `backend/auth/admin_user_routes.py`, `backend/db/db_utils.py`, `backend/db/postgres_schema.py`, `backend/db/upgrades.py`, `backend/lot_lifecycle_service.py`, `backend/notifications/service.py`, `backend/sync/dashboard_summary.py`, `backend/sync/mapper.py`, `backend/sync/service.py`.
- `npm audit` báo `brace-expansion` qua `minimatch`/`multimatch`/`javascript-obfuscator` và `postcss`; `--force` sẽ đưa `javascript-obfuscator` về `0.14.3`, là thay đổi phá vỡ nên không được áp tự động.

## 4. Tổng quan và bản đồ kiến trúc

| Khu vực | Entry point / module chính | Trách nhiệm, input → output | Dependency và side effect | Độ phức tạp / rủi ro |
|---|---|---|---|---|
| Frontend bootstrap | `frontend/app/app.js`, `frontend/app/workspaceBootstrap.js` | Session bootstrap + route → model/controller/view | Dynamic import, DOM, history, browser storage, network | Khởi động đã lazy-load nhưng controller còn gom nhiều workflow |
| Frontend UI/workflow | `frontend/app/BiddingController.js`, `BiddingView.js`, `frontend/packages/*` | State + user event → DOM và mutation command | Model, view partials, `apiFetch`, IndexedDB | Nhiều god function; render, state, validation và nghiệp vụ còn trộn |
| Báo cáo đánh giá | `BidEvaluationWorkflow.js`, `DetailedEvaluationWorkflow.js`, `detail/DetailedEvaluationPanel.js` | Gói thầu + hồ sơ + tiêu chí → bảng, draft, kết luận | Excel reader, selectors/rules, MutationService | Đã có module rules/selectors nhưng workflow/panel vẫn rộng; data contract legacy và mới chồng nhau |
| Excel import/export | `ExcelIntegration.js`, `excelImportAdapters.js`, `excelSaveAdapters.js`, `detailedEvaluationExcel.js` | Workbook → preview/mapped rows → state/sync | SheetJS reader, DOM selector, model | Luồng cũ có race phạm vi; nhận diện sheet và business rule phân tán |
| Backend HTTP | `backend/app.py:653-812`, Starlette | HTTP/WebSocket request → response | Auth, sync, document, notification, static files | Route registry lớn; lazy document dispatch giảm import cost |
| Authentication | `backend/auth/*` | Credential/session/role → session và access decision | PostgreSQL, Argon2, OTP/email, Google | Coverage cao; `auth_routes.py` 2.082 dòng và có facade/re-export khó đọc |
| Authorization | `backend/shared/access_policy.py`, ownership validators | Actor + org + record → allow/deny | Membership, assignment, owner type | Chính sách tenant tốt nhưng caller và DB trigger phải luôn đồng bộ |
| Database | `backend/db/schema.py`, `postgres_schema.py` | Canonical schema → PostgreSQL DDL/constraint/trigger | PostgreSQL 17, composite tenant key | Fresh schema lớn; dynamic DDL cần baseline review; contract/lot invariant còn thiếu |
| Migration | `backend/db/upgrades.py`, `scripts/manage_database.py` | Installed version → tuần tự v1…v17 | Transaction, DDL, metadata | Version liên tục nhưng forward-compat startup và v11 cần xử lý an toàn |
| Sync layer | `/api/sync`, `backend/sync/service.py`, `mapper.py`, frontend `BiddingControllerSync.js` | Mutation batch ↔ row versions/delta/tombstone | PostgreSQL transaction, WebSocket, browser state | Hai hàm gần 1.000 dòng; lỗi có thể mất mutation; partial semantics không rõ |
| Tenant isolation | `organization_id`, `owner_type`, composite FK, access policy | Workspace identity → scoped read/write | DB constraints, trigger, request header | DB record tốt; filesystem ảnh chưa namespace theo tenant |
| Document processing | `backend/documents/*`, durable `document_jobs` | Template/input → Word/Excel/result | Worker queue, filesystem, Bubblewrap/seccomp | Production boundary tốt; failed-job retention trái runbook |
| Background jobs | lifecycle, document/email/partner workers, audit monitor | Job queue/event → side effect | PostgreSQL polling, network/email, filesystem | 71.113 lần poll gần như rỗng; audit chain tăng tuyến tính |
| Deployment/observability | `deploy/`, `/health/*`, `/metrics`, logging/metrics | Runtime signals → health/metrics/runbook | systemd/nginx/Prometheus | README hướng dẫn plain build trái secure release path |
| Testing | `tests/`, `tests/js/`, coverage/security scripts | Source + fixtures → policy/regression gates | pytest, Node test, PostgreSQL | Nhiều policy test tốt; chưa có E2E/browser và một số route quan trọng coverage rất thấp |

## 5. Mười khu vực cần ưu tiên review/refactor

1. Độ bền mutation và xử lý lỗi trong `BiddingControllerSync.js`/`BiddingModel.js`.
2. Namespace filesystem ảnh theo tenant trong `sync/service.py`/`media_helper.py`.
3. Compatibility policy giữa application version và database schema version.
4. Migration v11 và chiến lược khôi phục dữ liệu legacy.
5. Data contract báo cáo đánh giá chi tiết giữa UI, validation, mapper và summary projection.
6. Excel import context: package/bid/lot/round/contractor identity phải là snapshot bất biến.
7. Ràng buộc hợp đồng ↔ nhà thầu trúng ↔ phần lô.
8. `_process_sync_request_blocking` và `mapper.py` — transaction, partial update, query/mapping.
9. Các god render: kết quả lựa chọn nhà thầu, đánh giá HSDT, chi tiết gói thầu.
10. Durable worker retry/retention và polling strategy.

## 6. Phát hiện correctness và an toàn dữ liệu

### [HIGH] Code cũ được phép chạy với mọi schema mới hơn

- **Vị trí:** `backend/startup.py:525-536`, `backend/startup.py:584-599`, `tests/test_database_startup_policy.py:75-89`.
- **Vấn đề:** startup chỉ chặn `installed < required`; mọi `installed > required` được chấp nhận vô điều kiện. Test hiện còn đặt tên “accepted as backward compatible”.
- **Ảnh hưởng:** một binary cũ có thể đọc/ghi schema mới đã đổi constraint, cột hoặc semantics. Đây là lỗi fail-open ở lớp bảo vệ cuối cùng của database.
- **Bằng chứng:** `backend/db/upgrades.py:773-776` lại từ chối schema mới hơn khi chạy migration, cho thấy hai policy mâu thuẫn.
- **Tái hiện:** gọi `verify_database_readiness(database(version=16), expected_schema_version=15)`; hiện không ném lỗi.
- **Phương án:** không loại bỏ version. Mặc định dùng equality hoặc compatibility range được khai báo theo release (`min=max=17`); chỉ nới range khi có contract test fresh/upgrade cho từng cặp.
- **Test cần bổ sung:** schema mới hơn bị chặn mặc định; chỉ được chạy khi nằm trong manifest tương thích; readiness và startup dùng cùng resolver.

### [HIGH] Migration v11 có thể làm mất dữ liệu trạng thái hồ sơ giấy

- **Vị trí:** `backend/db/upgrades.py:218-300`.
- **Vấn đề:** v11 xóa `hop_dong.trang_thai_ho_so` tại dòng 287 và bảng `trang_thai_ho_so_giay` tại dòng 296 mà không archive/backfill các giá trị người dùng.
- **Ảnh hưởng:** dữ liệu đã áp dụng có thể không phục hồi được nếu không còn backup.
- **Bằng chứng:** chỉ có mapping `trang_thai_hop_dong`; không có câu lệnh sao chép hai nguồn legacy trước `DROP`.
- **Tái hiện:** tạo database v10 có trạng thái hồ sơ giấy khác rỗng, nâng cấp lên v11, truy vấn dữ liệu cũ không còn.
- **Phương án:** tuyệt đối không sửa v11 đã phát hành. Thêm pre-upgrade preservation hook cho DB `<11`, một migration mới để tạo vùng tương thích/nhập dữ liệu khôi phục, và runbook phục hồi từ backup cho DB đã qua v11.
- **Test cần bổ sung:** seed dữ liệu legacy khác rỗng, upgrade đến v17/v18, kiểm tra bản sao và mapping còn đủ.

### [HIGH] Sync có thể xóa thay đổi chưa đồng bộ

- **Vị trí:** `frontend/app/BiddingModel.js:296-299`, `:604-620`; `frontend/app/BiddingControllerSync.js:423-534`.
- **Vấn đề:** mutation batch chỉ sống trong memory. Với lỗi server không phải success, code gọi `discardMutationBatch()` rồi `forceSyncData()`. Conflict cũng discard trước khi reload. Thay đổi phát sinh trong lúc request chạy phụ thuộc so sánh snapshot bằng `JSON.stringify`.
- **Ảnh hưởng:** lỗi validation, 5xx, conflict hoặc reload có thể làm biến mất dữ liệu người dùng vừa lưu cục bộ — phù hợp với triệu chứng “đã lưu bản nháp nhưng vào lại dữ liệu biến mất”.
- **Tái hiện:** tạo mutation, giả lập `/api/sync` trả 500, xác nhận batch bị xóa ở dòng 532 và state bị thay bởi force sync.
- **Phương án:** persistent outbox theo workspace; chỉ acknowledge đúng snapshot sau success; lỗi retryable giữ nguyên batch; validation rejection chỉ loại record được server chỉ rõ; concurrent edits tạo revision mới.
- **Test cần bổ sung:** 500/offline/reload, 409, validation per-record, edit trong request, chuyển workspace và idempotent retry.

### [HIGH] Ảnh có thể bị ghi đè giữa hai organization

- **Vị trí:** `backend/db/schema.py:1536-1548`, `backend/sync/service.py:152-190`, `backend/shared/media_helper.py:320-377`.
- **Vấn đề:** ID record chỉ unique trong `(organization_id, id)`, nhưng filename là `{record_id}_{suffix}.{ext}` trong thư mục dùng chung; `organization_id` không tham gia đường dẫn.
- **Ảnh hưởng:** tenant khác có cùng ID có thể ghi đè dấu/chữ ký/chứng chỉ, gây lộ hoặc sai tài liệu.
- **Tái hiện:** hai org ghi base64 khác nhau cho cùng `record_id`; cả hai nhận cùng managed path.
- **Phương án:** namespace path bằng định danh tenant đã hash/encode an toàn, truyền org vào interface lưu ảnh, migrate path bằng copy-verify-switch; không dùng tên org thô.
- **Test cần bổ sung:** cùng record ID ở hai org tạo hai path/file khác nhau; access và cleanup không vượt tenant.

### [HIGH] Báo cáo chi tiết “Không đạt” không lưu được sau khi UI bỏ lý do

- **Vị trí:** frontend không render trường tại `tests/js/detailed_evaluation.test.mjs:838-845`; frontend validator không yêu cầu lý do tại `frontend/packages/detailedEvaluationValidation.js:1-57`; backend vẫn bắt buộc tại `backend/sync/mapper.py:1328-1338`.
- **Vấn đề:** data contract frontend/backend mâu thuẫn với yêu cầu nghiệp vụ “lý do ghi ở báo cáo tổng quát”.
- **Ảnh hưởng:** người dùng có thể đánh dấu `Không đạt` hợp lệ trên UI nhưng save/sync thất bại.
- **Bằng chứng tái hiện đã chạy:** gọi mapper thật với report draft, một detail `ketQua='fail'`, `lyDoKhongDat=''` trả `ValueError: Tieu chi khong dat phai co ly do.`
- **Phương án:** giữ cột legacy để đọc tương thích, bỏ invariant bắt buộc ở detail trong code mới, và để trường lý do/làm rõ ở summary hoàn toàn do người dùng quản lý. Không drop cột trong cùng PR.
- **Test cần bổ sung:** draft và completed report lưu được `fail` không có detail reason; summary reason không bị projection detail ghi đè; payload cũ có lý do vẫn round-trip.

### [HIGH] Excel import cũ có thể ghi sang gói thầu khác

- **Vị trí:** `frontend/documents/ExcelIntegration.js:124-171`, `excelImportAdapters.js:7-10`, `:68-88`, `excelSaveAdapters.js:329-399`.
- **Vấn đề:** package selector được đọc lại ở nhiều bước parse/save sau thao tác bất đồng bộ thay vì dùng immutable import context.
- **Ảnh hưởng:** đổi gói trong lúc đọc file có thể preview theo gói A nhưng validate/save theo gói B.
- **Tái hiện:** bắt đầu import file ở A, trì hoãn file reader, đổi selector sang B trước khi promise hoàn tất, tiếp tục save.
- **Phương án:** tạo `ImportContext` bất biến `{workspace, packageId, bidId, lotScope, roundType, contractorIdentity, epoch}` ở thời điểm chọn file; mọi bước dùng context này và abort nếu UI epoch đổi.
- **Test cần bổ sung:** deferred reader + đổi package/tab/lot; xác nhận không state nào bị ghi và cảnh báo rõ.

### [HIGH] Sparse update đánh giá có thể xóa giá trị cũ

- **Vị trí:** `backend/sync/mapper.py:363-417`; key validation ở `backend/sync/payload_validation.py:434-503`.
- **Vấn đề:** chỉ cần payload có một key đánh giá, mapper upsert toàn bộ cột; key bị thiếu được chuyển thành `""`/`None`.
- **Ảnh hưởng:** client cũ hoặc partial update một trường có thể xóa kết quả/làm rõ/lý do khác.
- **Tái hiện:** record có đầy đủ đánh giá, gửi payload chỉ chứa `danhGiaKyThuat`, đọc lại các cột khác.
- **Phương án:** định nghĩa rõ `missing` khác `null` khác empty; dùng patch semantics hoặc đọc/merge trong transaction trước upsert.
- **Test cần bổ sung:** missing/empty/null cho từng field, retry, concurrent update và round-trip client cũ.

### [HIGH] Hợp đồng chưa ràng buộc đúng nhà thầu trúng và phần lô

- **Vị trí:** `frontend/contracts/HopDongWorkflow.js:118-131`, trigger `backend/db/postgres_schema.py:698-719`, policy test `tests/test_contract_workflow_policy.py:161-174`.
- **Vấn đề:** UI và trigger chỉ bảo đảm hợp đồng/gói cùng kế hoạch; bảng liên kết không mang lot/result identity và test hiện chủ động yêu cầu không kiểm tra winner.
- **Ảnh hưởng:** có thể liên kết hợp đồng với nhà thầu không trúng hoặc với sai phần lô.
- **Căn cứ nội bộ:** `docs/research/multi-lot-evaluation-legal-research.md:90` yêu cầu hợp đồng chỉ rõ lô và nhà thầu khớp KQLCNT.
- **Phương án:** chốt ngoại lệ chỉ định thầu/pháp chế trước; sau đó thêm link tới award/lot stable identity và DB invariant trong migration mới.
- **Test cần bổ sung:** nhiều lô/nhiều winner, winner sai, result chưa final, direct appointment exception, tenant mismatch.

### [MEDIUM] Failed document job bị xóa trái runbook

- **Vị trí:** `deploy/RUNBOOK.md:28-35`; `backend/documents/document_worker.py:816-827`, `:891-904`; `tests/test_postgres_core.py:945-995`.
- **Vấn đề:** runbook cấm xóa failed job/payload trước retry có kiểm soát, nhưng worker xóa job directory ở lần lỗi cuối và xóa database row khi consumer đọc lỗi; test đang codify hành vi này.
- **Ảnh hưởng:** mất artifact phục vụ điều tra và không còn khả năng retry vận hành như tài liệu mô tả.
- **Phương án:** chọn một policy duy nhất: giữ metadata + immutable input đã kiểm soát trong retention window, cung cấp retry command idempotent và purge audit được; giới hạn dung lượng/quyền truy cập.
- **Test cần bổ sung:** failed job còn đủ metadata để retry, retention purge, malicious payload quarantine, idempotent retry.

### [MEDIUM] Idempotency key không gắn với nội dung request

- **Vị trí:** `backend/sync/service.py:215-254`, `:275-292`; `backend/db/schema.py:1300-1310`.
- **Vấn đề:** replay key chỉ gồm org/user/clientMutationId; cùng key nhưng payload khác nhận response cũ.
- **Ảnh hưởng:** bug client hoặc collision có thể báo thành công giả và bỏ qua thay đổi mới.
- **Phương án:** lưu canonical request hash; cùng key + cùng hash replay, cùng key + khác hash trả 409.
- **Test cần bổ sung:** exact replay, mismatched payload, concurrent duplicate và tenant separation.

## 7. Đối chiếu tên nhà thầu khi nhập Excel

### Hành vi hiện có đã xác nhận

- `frontend/packages/detailedEvaluationExcel.js:21-59` lấy tên “Nhà thầu:” trong 8 dòng đầu, chuẩn hóa chữ hoa/thường, dấu tiếng Việt và punctuation.
- `frontend/packages/DetailedEvaluationWorkflow.js:724-744` đọc workbook, nhận diện sheet muasamcong và chặn trước khi thay criteria/draft nếu identity không hợp lệ.
- `frontend/packages/DetailedEvaluationWorkflow.js:850-871` hiển thị tên trong file, tên đang chọn và khẳng định dữ liệu chưa được nhập.
- `tests/js/detailed_evaluation.test.mjs:396-466` bao phủ match, mismatch, nhiều tên xung đột và alert; toàn file test 40/40 đạt.
- Bidder type lấy từ hệ thống, không tin workbook để quyết định dòng “Thỏa thuận liên danh”; test tại `:305-393` và `:1402-1473` xác nhận nhà thầu độc lập bỏ dòng và đánh lại STT, liên danh giữ dòng.

### Khoảng trống cần xử lý trong PR

1. Verification hiện chỉ gọi khi parser đã nhận ra ít nhất một sheet muasamcong (`muasamcongImports.length > 0`); identity extraction nên độc lập với mapping để parser fallback không vô tình đi vòng.
2. Chỉ so tên chưa chống được hai doanh nghiệp trùng/tương tự tên; nếu file có mã số thuế/mã nhà thầu thì ưu tiên định danh đó.
3. Việc chỉ quét 8 dòng đầu là heuristic; cần fixture từ đủ 6 workbook mẫu và giới hạn rõ trong interface.
4. Import cần snapshot `bidId/packageId/lotScope/workspaceEpoch`; nếu lựa chọn thay đổi trong lúc đọc file thì abort, không tự chuyển target.
5. Cần test “không mutation”: mismatch không thay criteria override, draft, dirty flag hoặc dữ liệu đã lưu trước đó.

Quyết định đề xuất: **fail closed đối với workbook nhận diện là muasamcong**. File sai/mất/xung đột identity không được nhập; custom workbook không có identity dùng luồng template riêng với xác nhận rõ, không âm thầm giả làm muasamcong.

## 8. Data contract báo cáo đánh giá chi tiết

| Khái niệm | Frontend | PostgreSQL | Nhận xét |
|---|---|---|---|
| Vòng đánh giá | metadata gói + `roundType` | `vong_danh_gia` | `single`, `technical`, `financial` phải theo phương thức/lĩnh vực/phương pháp |
| Tiêu chí | criteria override + metadata | `tieu_chi_danh_gia` | STT phân cấp và bidder type phải ổn định khi save/reload |
| Báo cáo nhà thầu | `baoCaoDanhGiaChiTietList` trên bid | `bao_cao_danh_gia_nha_thau` | Unique theo org + vòng + hồ sơ mở thầu |
| Dòng đánh giá | `chiTietList` | `chi_tiet_danh_gia_nha_thau` | Có legacy reason/clarification fields dù UI đã bỏ |
| Người chấm | `nguoiChamId` hoặc active user | `nguoi_cham_id` | Cần cho audit attribution; trigger `bf_validate_evaluation_actor` bảo đảm là thành viên active cùng org |
| Kết quả tổng quát | projection vào bid khi report completed | `ket_qua_danh_gia_nha_thau` | Chỉ project status/score; lý do/làm rõ phải do báo cáo tổng quát sở hữu |
| Extension | object có schemaVersion | `extension_json` | Cần schema contract/version và unknown-field compatibility rõ |

`nguoi_cham_id` là định danh tài khoản đã thực hiện/chịu trách nhiệm cho lần đánh giá. Nên giữ vì phục vụ audit, phân quyền và truy vết; có thể ẩn khỏi UI, nhưng không nên xóa khỏi data model.

## 9. Technical debt, độ phức tạp và dependency

### File và hàm quá lớn

| File/hàm | Kích thước xấp xỉ | Vấn đề |
|---|---:|---|
| `views/css/views.css` | 4.423 dòng | Nhiều feature style, khó xác định ownership |
| `frontend/documents/wordVariableManifest.js` | 2.812 dòng | Generated data cần tách khỏi review thủ công |
| `backend/auth/auth_routes.py` | 2.082 dòng | Auth flow + system routes + re-export |
| `backend/sync/mapper.py` | 1.872 dòng | Query, mapping, validation, child persistence |
| `frontend/app/BiddingView.js` | 1.588 dòng | Nhiều view responsibility |
| `backend/db/schema.py` | 1.559 dòng | Canonical schema + transformation logic |
| `renderAwardResultDetailsPanel` | khoảng 1.244 dòng | Render + rule + event + mutation |
| `renderDanhGiaHsdtPanel` | khoảng 1.074 dòng | Tab/layout/ranking/validation/event |
| `_process_sync_request_blocking` | khoảng 974 dòng | Auth, idempotency, image, transaction, validation, write, response |
| `setupWordTemplatesEvents` | khoảng 873 dòng | Event/controller logic tập trung |

### Duplicated code và magic strings

- `"Đạt"`: 52 occurrence / 12 file JS; `"Không đạt"`: 52 / 8; `"Đã có kết quả"`: 53 / 17; `"Hủy thầu"`: 39 / 19; `"Liên danh"`: 41 / 13.
- Normalize/matching logic lặp giữa `detailedEvaluationTemplates.js`, `detailedEvaluationExcel.js`, `detailedEvaluationCriteria.js`.
- Investor/contractor version selector lặp tại `frontend/contracts/HopDongWorkflow.js:149-275`.
- Snake/camel detailed-evaluation shaping lặp tại `backend/sync/mapper.py:1431-1468` và `:1575-1604`.

Không nên gom thành một helper tổng quát nhiều nhánh. Nên tạo domain rule/selector nhỏ có interface theo nghiệp vụ và một mapper declarative cho snake/camel.

### Chu kỳ dependency backend

- `observability.metrics` ↔ `shared.logging_utils`.
- `shared.database_io` → `observability.metrics` → `shared.database_io`.
- `shared.helpers` ↔ `shared.logging_utils`.
- `partners.partner_lookup_service` → `sync.api` → `sync.service` → `partners.partner_lookup_service`.

Một số cạnh được giấu bằng local import. Di chuyển import không giải quyết coupling; cần seam nhỏ cho metrics sink/event publisher và tránh facade `shared.helpers` kéo cả database/auth/logging vào nhau.

Frontend có 173 module JS đều reachable từ `frontend/app/app.js`; không phát hiện import cycle frontend trong static graph.

### Code chết và module cần refactor

- Static AST + repository scan xác định 21 Python import binding trên 12 file có thể xóa độc lập với độ tin cậy cao; chưa xóa trong giai đoạn review. Danh sách, risk và test nằm trong `DEAD_CODE_REPORT.md`.
- Các export/function chỉ có test caller được giữ ở mức `LIKELY_UNUSED`/`REQUIRES_CONFIRMATION`, gồm lot-scope guard, query helper, policy wrapper và một số operational hook. Không được xóa trước xác nhận runtime/owner.
- Không có frontend JS file nào đủ bằng chứng là code chết; toàn bộ 173 module reachable. Chưa có bằng chứng đủ để xóa CSS selector, asset, table hoặc column.
- Module ưu tiên refactor: sync transaction (`service.py`/`mapper.py`), detailed-evaluation import/workflow, award-result render, bid-evaluation render, contract selector và observability dependency cluster.

## 10. Database và tenant isolation

Điểm tốt:

- Schema nâng key record theo `(organization_id, id)` và bổ sung composite tenant FK.
- Access policy, sync ownership validation và nhiều DB trigger bảo vệ tenant.
- PostgreSQL audit ban đầu không phát hiện foreign key thiếu leading index; ba hot plan mẫu dùng index, không có sequential scan.
- Version migration liên tục đến `DB_SCHEMA_VERSION = 17`.

Vấn đề:

- Filesystem ảnh chưa đi cùng tenant identity.
- Contract-package trigger chưa ràng winner/lot.
- Dynamic SQL fingerprints thay đổi ở 10 file chưa được duyệt.
- v11 có destructive drop không bảo toàn dữ liệu.
- Fresh schema và upgrade path cần contract test cùng một canonical snapshot; audit cũ `docs/reviews/full-stack-code-audit-2026-07-23.md` dừng ở schema v14 và không còn đại diện cho HEAD v17.

Không đề xuất thêm index mới từ dataset cục bộ nhỏ. Mọi index mới phải gắn với query thật, `EXPLAIN (ANALYZE, BUFFERS)`, write cost và tenant-leading column.

## 11. Test coverage và khoảng trống

Backend tổng 72%. Các vùng thấp đáng chú ý:

- `backend/api/org_routes.py`: 33%
- `backend/documents/package_document_routes.py`: 7%
- `backend/lot_lifecycle_routes.py`: 6%
- `backend/notifications/routes.py`: 11%
- `backend/documents/routes_docx.py`: 12%
- `backend/documents/routes_excel.py`: 0%

Một phần coverage document route có thể bị ảnh hưởng bởi subprocess/Windows; cần xác nhận lại trong Linux CI. Gate hiện chỉ ép auth và toàn bộ sync >=90%, chưa bảo vệ các route tài liệu/lifecycle mới.

Không có Playwright/Cypress/E2E harness và `package.json` không có test script. Đây là khoảng trống lớn cho các bug chuyển tab, async import, save/reload, sticky table header và race selector — những lỗi unit/policy test khó phát hiện.

Test ưu tiên bổ sung trước refactor:

1. Save/reload/offline/conflict cho mutation outbox.
2. Cùng image record ID ở hai tenant.
3. Detail `fail` không có lý do nhưng summary reason độc lập.
4. Import muasamcong đúng/sai/mất/xung đột contractor identity; independent/JV và phân lô.
5. Đổi package/tab/lot trong lúc import bất đồng bộ.
6. Contract winner/lot invariants và ngoại lệ chỉ định thầu.
7. Migration preservation từ v10 qua v11 đến current.
8. E2E 1G1T, 1G2T kỹ thuật/tài chính, tư vấn, save/reopen/reload.

## Standards

### Vi phạm cứng

1. `deploy/RUNBOOK.md:30-34` cấm xóa failed job/payload trước retry vận hành có idempotency, nhưng `backend/documents/document_worker.py:823-827` và `:891-901` xóa cả file và row; `tests/test_postgres_core.py:945-995` còn khóa hành vi trái tài liệu này.
2. Release path trong `package.json:9-12` và `.github/workflows/security-quality.yml` yêu cầu secure lint/vendor/package gate, nhưng `README.md:5-6` khuyên dùng `npm run build:plain` cho production; command này bỏ qua các gate đó.

### Code smell — nhận định, không phải vi phạm cứng

1. **Duplicated Code:** toàn bộ lifecycle selector chủ đầu tư/nhà thầu lặp tại `frontend/contracts/HopDongWorkflow.js:149-275`.
2. **Duplicated Code:** mapping chi tiết đánh giá snake/camel lặp tại `backend/sync/mapper.py:1431-1468` và `:1575-1604` dù đã có shaping helper.
3. **Divergent Change:** `BidEvaluationWorkflow.js`, `DetailedEvaluationWorkflow.js`, `sync/service.py`, `mapper.py` thay đổi vì nhiều lý do không cùng trách nhiệm.
4. **Primitive Obsession / Repeated Switches:** trạng thái và loại gói là chuỗi tiếng Việt hardcode rải rác; cùng rule được lặp giữa render, mapper và validation.

Kết quả trục Standards: 2 vi phạm cứng, 4 nhóm smell. Nghiêm trọng nhất là policy failed-job trong code trái runbook vận hành.

## Spec

### Thiếu hoặc mới đáp ứng một phần

1. Năm artifact bắt buộc chưa tồn tại trước lượt review này; được tạo trong lượt hiện tại.
2. Yêu cầu E2E cho 1G1T/1G2T/import/save-reload chưa có harness.
3. Yêu cầu không mất dữ liệu và không chỉnh applied migration chưa được bảo vệ đầy đủ: v11 drop legacy data, mutation batch có thể bị discard.
4. Yêu cầu import Excel không ghi nhầm hồ sơ mới được đáp ứng chắc ở luồng báo cáo chi tiết muasamcong; các adapter Excel cũ còn race package selector.
5. Yêu cầu dữ liệu lý do/làm rõ thuộc báo cáo tổng quát bị backend detail invariant cũ cản trở.
6. Yêu cầu tenant isolation chưa bao phủ filesystem image namespace.
7. Yêu cầu benchmark trước/sau: có baseline một số hạng mục, nhưng chưa có “sau” vì đúng phạm vi hiện tại chưa tối ưu code.

### Hành vi ngoài/không khớp yêu cầu

1. Startup chấp nhận mọi schema mới hơn để “code luôn chạy”; điều này làm yếu data-safety guard và không có compatibility proof.
2. Contract workflow chủ động không lọc theo procurement result trong policy test, trái invariant lot/winner đã ghi trong nghiên cứu nghiệp vụ nội bộ.

### Đã đáp ứng đúng đáng ghi nhận

1. Detailed evaluation tự chọn mẫu 14A/14B/14C/14D theo loại gói/phương thức, giữ logic system bidder type, hierarchy/STT và kết quả hệ thống/chuyên gia.
2. Báo cáo mới không seed sẵn criteria; người dùng thêm dòng hoặc nhập Excel.
3. Draft chi tiết được persistence theo opening bid/lot và có test save/reload.
4. Contractor name mismatch trong workbook muasamcong bị chặn, hiển thị hai tên, không áp dữ liệu.
5. Applied migration không bị sửa trong lượt review này.

Kết quả trục Spec: 7 yêu cầu thiếu/một phần, 2 hành vi lệch, 5 nhóm đã đáp ứng. Nghiêm trọng nhất là data safety ở schema compatibility và sync durability.

## 12. Ưu tiên đề xuất

### P0 — khóa trước mọi refactor

1. Khôi phục fail-closed schema compatibility hoặc compatibility manifest có test.
2. Persistent mutation outbox và không discard trên lỗi retryable.
3. Namespace ảnh theo tenant.
4. Kế hoạch preservation/khôi phục migration v11 không sửa applied migration.
5. Sửa contract backend cho detail fail không cần reason và khóa bằng test.

### P1 — correctness nghiệp vụ

1. Immutable Excel import context + deep import module + identity ưu tiên MST/mã nhà thầu.
2. Contract ↔ award ↔ lot invariant sau khi chốt ngoại lệ pháp chế.
3. Sparse update semantics và idempotency request hash.
4. Failed document job retention/retry thống nhất với runbook.
5. Xử lý ba release gate đỏ.

### P2 — maintainability

1. Deepen sync module quanh một interface mutation transaction nhỏ.
2. Tách render/rules/commands cho award result và bid evaluation.
3. Chuẩn hóa domain status resolver, không tạo một helper nhiều nhánh.
4. Cắt cycle metrics/logging/database I/O bằng metrics sink/event publisher seam.
5. Bổ sung `CONTEXT.md`, ADR cho schema compatibility, sync semantics và import identity.

### P3 — tối ưu sau khi đo

1. Index bids theo ID trước ranking và debounce input.
2. Batch detailed-evaluation DB lookup/upsert.
3. Backoff/LISTEN-NOTIFY cho worker polling.
4. Incremental audit-chain verification.
5. Chỉ tách thêm bundle sau browser trace và network benchmark.

Chi tiết chia PR, test, risk và rollback nằm trong `REFACTOR_PLAN.md`; số liệu nằm trong `PERFORMANCE_REPORT.md`; ứng viên code chết nằm trong `DEAD_CODE_REPORT.md`.
