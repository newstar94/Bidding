# Audit toàn ứng dụng BiddingFlow — 2026-08-26

## Cập nhật remediation cùng ngày

Đã triển khai và có regression cho PAY-01, PAY-02, SYNC-01, LOCAL-01,
DOC-01/02/03, AUTH-UX-01, UX-01/02/03, validation giảm giá và Word cache
race. ORG-01 đã được chặn fail-safe ở client: lỗi remove/SUCCESSOR_REQUIRED
không còn rekey dữ liệu cục bộ hoặc thêm nhân sự mới; UI successor chuyên biệt
vẫn là cải tiến tiếp theo. Payment được bổ sung operation↔item-type validation,
provider environment/TTL, command lease fencing, refund exact-request,
offload provider I/O, return/cancel routes và usage lease reaper.

PAY-03/PAY-05 chưa được tự sửa vì mapping package và transition semantics cần
chủ sản phẩm phê duyệt theo business contract. PAY-04 còn phụ thuộc secret
resolver/deployment profile thật. DB-01 chưa tự tạo 30 index vì migration
concurrent/cardinality/waiver cần deployment owner chốt. 27 legal fact và 27
placeholder được chủ sản phẩm chấp nhận tạm thời và nằm ngoài remediation này.

## Kết luận điều hành

BiddingFlow **chưa sẵn sàng cho production release có thanh toán thật**. Không có bằng chứng về một lỗ hổng Critical đang cho phép đọc chéo tenant hoặc mở rộng dữ liệu/quyền trong cấu hình hiện hành, nhưng có nhiều lỗi High về toàn vẹn tài chính và nhất quán dữ liệu. Bốn blocker nền tảng phải đóng trước mọi pilot có payment activation là:

1. Một provider transaction có thể kích hoạt hai order khác nhau.
2. Provider đã trả `PAID` nhưng sau rollback có thể không còn automated durable work item để retry; Super Admin reconcile hoặc một webhook độc lập về sau vẫn có thể phục hồi.
3. Commercial release hiện không project mapping cần thiết để base plan tự kích hoạt.
4. payOS credential resolver/profile chưa được nối vào composition root của runtime.

Ngoài bốn blocker nền tảng này, PAY-05 (transition policy/revision) và PAY-08 (provider environment/TTL) là các gate High/Medium có điều kiện, cũng chặn pre-pilot khi commercial/payment flags được bật.

Ngoài payment, ba lỗi High xuyên lớp đã được tái hiện: thay tài khoản nhân sự bỏ qua `409 SUCCESSOR_REQUIRED`, resolve conflict commit business mutation và draft/audit trong hai transaction, và Excel import có thể ghi một phần nhiều IndexedDB store mà không có outbox. Đây đều là lỗi có thể làm client, server và audit trail bất đồng dù từng lớp riêng lẻ có validation.

Frontend build được tạo thành công và phần lớn security gate đạt, nhưng trải nghiệm thanh toán có ba lỗi Medium/P1 đủ để chặn launch UX: báo đồng bộ thành công khi API con lỗi, polling dừng sau một lỗi mạng, và popup checkout có thể bị chặn vì mở sau hai `await`. Local secure-build route gate đo được max long task `283 ms`, vượt budget `100 ms`; cần lưu host-load artifact trước khi suy ra capacity production. Production packaging còn bị chặn độc lập bởi `27` legal fact chưa duyệt và `27` placeholder.

Audit này chỉ tạo tài liệu. Không sửa production code, schema, migration, UI, test expectation; không xóa file; không gọi provider thật; không thay đổi bất kỳ contract quyền hoặc hiển thị dữ liệu nào.

## Trạng thái release

| Miền | Trạng thái | Bằng chứng chính |
|---|---|---|
| Tenant/session/module/assignment/record authorization | Giữ nguyên; không phát hiện bypass mới trong phạm vi audit | Các regression về projection/scope pass khi PostgreSQL hoạt động; audit không đề xuất capability đọc nhạy cảm mới |
| Payment activation | **BLOCKED** | PAY-01 đến PAY-05; PAY-08 là conditional gate khi provider/payment flags bật |
| Production package | **BLOCKED** | `LEGAL_FACT_UNAPPROVED=27`, `LEGAL_PLACEHOLDER_PRESENT=27` |
| Secure frontend build | Đạt build, chưa đạt performance | 319 module; artifact check và route-CSS static pass; startup long task fail |
| PostgreSQL operability | Chưa đạt gate | 201 FK; 32 bị báo thiếu index, trong đó 30 thiếu thực |
| Frontend maintainability | Chưa đạt CSS ratchet | `!important=433 > 428`, raw color `1067 > 930`; direct state write `59 = baseline`, runtime style `512 < 541` chỉ là inventory |
| Frontend ESM reachability | Fail do mô hình entrypoint thiếu | Script chỉ đi từ `frontend/app/app.js`; `FakeCheckout.js` là HTML/backend-served entrypoint thật nhưng bị báo orphan. Đây không phải audit dead code toàn repo |
| Test JavaScript | Đạt | `1356 passed`, `0 failed` |
| Test Python | Chưa xanh ổn định | Run cuối loại riêng AI transport flake đạt `1879 passed`, nhưng phát hiện một failure Windows ở Word export cache single-flight; `1` AI test bị deselect. Không còn failure PostgreSQL |

## Business contract bất biến

Mọi remediation trong báo cáo phải giữ nguyên `AGENTS.md`:

- Người dùng đã qua tenant, module, assignment và record scope được xem đầy đủ dữ liệu của bản ghi, gồm CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và các trường liên quan.
- Entitlement Word chỉ kiểm soát hành động tạo/tải Word; không điều khiển dữ liệu màn hình hoặc API đọc bản ghi.
- Không thêm capability đọc dữ liệu nhạy cảm riêng.
- Không đổi role, permission, inheritance, scope, default allow/deny hoặc masking/redaction nếu chưa có phê duyệt chủ sản phẩm.
- Tenant isolation, session, module permission, assignment scope, record authorization và audit vẫn bắt buộc.
- Nếu một remediation thật sự cần đổi semantics, phải có ADR/business contract, compatibility impact, migration strategy và regression test. Test không được tự định nghĩa nghiệp vụ mới.

Đặc biệt, DOC-01 phải được sửa theo hướng **trả đầy đủ dữ liệu lịch sử mà người dùng vốn đã được phép đọc, nhưng ở trạng thái read-only**; không được dùng finding này để che trường. ORG-01 phải tái sử dụng contract transfer nguyên tử hiện hữu của backend; không được tự diễn giải lại assignment/permission semantics ở frontend.

## Phạm vi và phương pháp

Snapshot được audit là branch `main`, HEAD `e0683e30`. Quy mô source đo tại snapshot:

| Khu vực | File code | Dòng |
|---|---:|---:|
| Backend | 373 | 117.963 |
| Frontend | 325 | 83.647 |
| Tests | 401 | 102.814 |

Các hoạt động đã thực hiện:

- Đọc luồng HTTP → authorization → service → transaction → worker/outbox ở billing, commercial policy, sync, conflict resolution, document jobs, package documents, procurement import và organization membership.
- Đối chiếu schema Python, migration chain, PostgreSQL live constraints/index, idempotency key, lease và transaction boundary.
- Đọc bootstrap, routing, offline/service worker, IndexedDB persistence, storefront, document jobs và accessibility ở frontend.
- Chạy unit/integration suite, secure build, dependency/security/vendor audit, module graph, frontend ESM reachability/debt gate, legal gate, FK-index audit, complexity scan và route visual/performance probe.
- Dùng fault-injection harness read-only hoặc test DB cho các seam khó tái hiện. Không mutate production data.
- Đối chiếu với `docs/testing/full-codebase-audit-2026-08-25.md`; không mở lại finding đã được báo cáo là đã đóng nếu không có bằng chứng regression mới.

Giới hạn:

- Không gọi payOS/AI provider thật và không dùng credential thật.
- Không pentest một deployment Internet đang chạy; mức exploitability production được suy ra từ flag/config/source hiện hành.
- Benchmark chạy trên máy audit cục bộ; kết luận chắc chắn là gate hiện tại đỏ, còn capacity production cần đo lại trên cấu hình triển khai đại diện.
- Một số behavior thương mại còn cố ý `BLOCKED_DECISION`; audit không tự chốt semantics thay chủ sản phẩm.

## Danh mục finding ưu tiên

### High/P0 và payment release blocker

Trong báo cáo này, **severity** mô tả impact/exploitability của lỗi ở cấu hình hiện hành; **P0/P1/P2** mô tả thứ tự xử lý; **release blocker** là điều kiện không được bật một deployment/capability, độc lập với security severity. Vì vậy PAY-03/PAY-04 và REL-01 có thể chặn release do correctness/readiness/compliance mà không đồng nghĩa với một authorization vulnerability đang bị khai thác; PAY-05 chỉ đạt mức High có điều kiện khi các flag liên quan được bật.

| ID | Finding | Impact | Evidence |
|---|---|---|---|
| PAY-01 | Một provider transaction có thể kích hoạt hai order | Double entitlement/double activation từ một payment | `backend/billing/activation.py:94-125,165-204`; `backend/db/schema.py:1822-1843` |
| PAY-02 | `PAID` có thể không còn automated retry sau rollback của transaction activation | Khách đã trả tiền nhưng không nhận quyền lợi; command đã completed và order còn unverified, ngoài hai selector worker. Super Admin query hoặc webhook mới vẫn có thể phục hồi thủ công/độc lập | `backend/billing/service.py:460-515`; `backend/billing/worker.py:70-82,174-197`; admin query tại `backend/billing/routes.py:474-526` |
| PAY-03 | Release projection thiếu `legacy_package_id` | Base-plan version do publish path hiện tại project sẽ rơi vào manual review sau payment; row legacy/manual có mapping không nằm trong kết luận này | `backend/commercial_policy/repository.py:277-305`; `backend/billing/activation.py:336-359` |
| PAY-04 | payOS credential/profile chưa nối runtime | Readiness có thể pass nhưng checkout/worker/webhook fail khi nhận traffic | `backend/billing/runtime.py:60-97`; `backend/commercial_policy/config.py:63-87`; `backend/db/upgrades.py:3151-3167` |
| PAY-05 | **High có điều kiện / P1, payment release blocker:** activation bỏ qua pinned transition policy | Khi commercial/payment flags được bật, upgrade/downgrade hoặc operation không tương xứng có thể mutate subscription trái release snapshot | `backend/commercial_policy/service.py:62-160`; `backend/billing/activation.py:348-411` |
| ORG-01 | UI thay tài khoản nhân sự bỏ qua lỗi remove thành viên cũ | Thành viên cũ vẫn active, thành viên mới có thể được thêm, assignment/permission phía client bị rekey và UI báo thành công | `frontend/admin/AdminUserController.js:411-483`; `frontend/shared/apiClient.js:284-303`; `backend/api/org_routes.py:944-1150` |
| SYNC-01 | Resolve conflict có hai transaction không có durable handoff | Business mutation đã commit nhưng draft còn active, audit `sync.conflict_resolved` thiếu, endpoint trả 500 mơ hồ; business mutation vẫn có audit riêng | `backend/sync/conflict_resolution/routes.py:228-281,374-397` |
| LOCAL-01 | Excel import nhiều bảng không atomic | IndexedDB ghi một phần, in-memory state đã đổi, outbox rỗng; reload/server lệch | `frontend/documents/excelSaveAdapters.js:66-75,115-167,359-398,491-551`; `frontend/app/BiddingModel.js:1217-1247` |

### Release/compliance gate độc lập với security severity

| ID | Gate | Impact | Evidence |
|---|---|---|---|
| REL-01 | Legal production gate đỏ | Không được đóng gói public production với nội dung pháp lý placeholder/chưa duyệt | `scripts/check_legal_readiness.py:74-100` và output gate |

### Medium / P1

| ID | Finding | Impact | Evidence |
|---|---|---|---|
| PAY-06 | Usage reservation có reaper nhưng không có caller/reconciliation | Repo/lifecycle hiện không tự reclaim/reconcile lease hết hạn; crash window snapshot/debit không tự hồi phục, dù recovery thủ công/ngoài luồng vẫn có thể tồn tại | `backend/usage_credits/service.py:167-174,314-326`; `backend/lifecycle.py:424-435`; `backend/procurement_lookup/routes.py:178-190,341-361` |
| PAY-07 | Commercial validation dùng dynamic programming không bound | Super Admin hoặc session quản trị bị compromise có thể gửi payload nhỏ với số rất lớn để chiếm CPU/RAM hoặc gây 500 | `backend/commercial_policy/document.py:203-214,274-323,358-367`; privileged route tại `backend/commercial_policy/routes.py:292-324` |
| PAY-08 | Provider environment và checkout TTL không được thực thi trọn vẹn | Route nhầm profile môi trường, TTL cấu hình bị bỏ qua/kéo dài sau query | `backend/billing/service.py:166-183,345-360,460-482`; `backend/db/schema.py:1686-1705` |
| PAY-09 | Retry/cancel command có semantics sai và thiếu lease fencing | Retry create chuyển thành GET theo attempt count; cancel có thể đánh cancelled dù provider trả pending; worker cũ có thể complete sau lease | `backend/billing/service.py:400-405,418-489,521-565` |
| PAY-10 | Manual refund idempotency/validation chưa đúng exact-request contract | Replay full refund có thể bị 409; cùng key khác payload không bị phát hiện; malformed amount có thể thành 500 | `backend/billing/service.py:247-301`; `backend/billing/routes.py:427-468` |
| PAY-11 | `provider_order_code` chỉ là hash 31-bit, không có collision retry | Nếu code gần phân phối đều/độc lập, xác suất có ít nhất một collision trong **một provider profile** xấp xỉ 2,3% ở 10.000 order và 44,1% ở 50.000 order | `backend/billing/service.py:24-28`; unique theo profile tại `backend/db/schema.py:1741-1771` |
| PAY-12 | Không có periodic reconciliation cho open order nếu webhook thất lạc | Không có scheduled repair trong repo; Super Admin vẫn có query command, fake simulator chỉ là dev/test path và personal user GET không enqueue query. Đây là thiếu automatic recovery, không khẳng định không có đường phục hồi nào khác | `backend/billing/worker.py:46-68,70-82,174-197`; admin query command tại `backend/billing/routes.py:474-526` |
| PAY-13 | Async billing paths gọi synchronous provider transport trực tiếp | Create checkout, cancel, admin reconcile và fake update có thể block ASGI event loop tới provider timeout 30 giây | executor call tại `backend/billing/routes.py:182,268-269,405-406,536`; `backend/billing/providers/base.py:18-38`; `backend/billing/providers/payos.py:120-125` |
| BILL-UI-01 | Thiếu `/thanh-toan/huy` và `/thanh-toan/ket-qua` | Provider redirect về route không tồn tại sau cancel/payment | URL được tạo tại `backend/billing/service.py:166-173`; không có route tương ứng trong repo |
| SYNC-02 | Discount rate ngoài `[0,100]` lọt validation | DB rollback toàn batch và trả lỗi generic thay vì field-level 4xx | `backend/sync/payload_validation.py:1179-1192`; `backend/db/schema.py:1219-1235`; `backend/sync/service.py:999-1113` |
| DB-01 | 30 FK v79 thiếu child-side index thực trên DB audit cục bộ | Parent RESTRICT probe và hot query có thể scan/giữ lock tuyến tính khi bảng lớn | `scripts/audit_fk_indexes.py:25-65`; chi tiết tại báo cáo backend BSD-13 |
| DOC-01 | Authorized GET tài liệu package historical trả 500 và lấy mutation lock | Người dùng đã có quyền đọc không xem được tài liệu lịch sử; `FOR UPDATE` trên GET là lock không cần thiết và có nguy cơ contention, cần workload đo để lượng hóa | `backend/documents/package_document_routes.py:180-185,267-342`; `backend/sync/aggregate_mutability.py:200-227` |
| DOC-02 | UI bỏ theo dõi durable Word job sau khi một polling request đã exhaust retry | Job server vẫn chạy nhưng UI báo lỗi; nếu người dùng khởi tạo lại export, POST không idempotent tạo UUID/job mới | `frontend/documents/WordPublicationJob.js:97-140`; `backend/documents/document_job_routes.py:242-285`; `backend/documents/document_worker.py:890-974` |
| DOC-03 | Upload idempotency key không bind với file/payload | Nếu file A đã commit nhưng client không nhận 2xx và key còn được giữ, lần chọn file B cùng key có thể replay success/document A | `backend/documents/package_document_routes.py:114-165,405-508,521-585`; `frontend/packages/detail/PackageDocumentsPanel.js:8-15,239-270` |
| AUTH-UX-01 | Lỗi mạng session bootstrap bị quy thành logout | 503/timeout hiển thị auth shell dù chưa chứng minh session invalid | `frontend/app/app.js:39-63,158-171` |
| OFFLINE-01 | Service worker không precache lazy route và banner hứa quá phạm vi | Route chưa từng mở không dùng được offline; thông báo làm người dùng hiểu nhầm | `views/service-worker.js:6-36,60-82`; `frontend/app/BiddingController.js:836-860` |
| PERF-01 | Startup/performance budget đỏ | Long task cản main thread; artifact trước đó cũng vượt cold/warm budget | `npm run test:route-css-visual` đo `283/100 ms`; `data/logs/startup-performance.json` ghi cold P95 `1578/800`, warm P95 `1074/325` |
| QA-01 | AI local transport test flaky theo thứ tự/churn socket trên Windows | Full suite đỏ không ổn định, che khuất regression thật | `tests/ai/test_ai_providers.py:707-787`; pair test đã tái hiện failure `ConnectionResetError` |
| QA-04 | **Low/Medium / P1, Windows-conditional:** Word export cache single-flight có race | Khi nhiều thread/worker chuẩn hóa cùng source, `_acquire_lock()` chỉ retry `FileExistsError`; race `open(O_EXCL)` với thread khác vừa `unlink()` có thể trả `PermissionError` và làm job fail. Các vòng lặp riêng quan sát `2/100` và `3/30` failure; instrumented harness quan sát `4/300` cache root mới (không phải tỷ lệ production) | `backend/documents/word_export_cache.py:112-139`; `tests/test_word_export_cache.py:168-187` |
| DEBT-01 | Frontend CSS debt vượt ratchet | Specificity và token drift tăng; chỉ `important=433 > 428` và `raw_colors=1067 > 930` làm gate fail. Direct state writes bằng baseline, runtime styles dưới baseline | `scripts/check_frontend_debt.py` |
| UX-01 | Storefront báo thành công dù usage/orders API lỗi | Người dùng tin dữ liệu đã đồng bộ trong khi balance/order bị thay bằng empty state; Medium/P1 và launch blocker | `frontend/commercial-policy/CommercialStorefront.js:88-114` |
| UX-02 | Phiên theo dõi order hiện tại bị bỏ sau một lỗi polling | Người dùng không thấy payment/activation hoàn tất dù backend tiếp tục xử lý; refresh/thao tác mới có thể tạo luồng theo dõi khác. Medium/P1 và launch blocker | `frontend/commercial-policy/CommercialStorefront.js:54-65` |
| UX-03 | Checkout popup mở sau hai `await` | Browser có thể chặn popup; người dùng đã tạo order nhưng không tới trang thanh toán; Medium/P1 và launch blocker | `frontend/commercial-policy/CommercialStorefront.js:67-80` |

### Low/Medium, P2 hoặc cần quyết định

| ID | Finding | Lưu ý |
|---|---|---|
| PAY-14 | Webhook event PK hash payload không scoped profile | Cần hai profile chấp nhận cùng bytes; scoped unique contract và global PK không đồng nhất (`backend/billing/webhook.py:54-84`; `backend/db/schema.py:1845-1864`) |
| PAY-15 | Fake checkout auth/CSRF contract mâu thuẫn | Chỉ development/test: foreign-Origin browser mutation đã bị middleware chặn, nên đây không phải classic CSRF bypass; còn lại là signed-in flow thiếu `X-CSRF-Token` và unauthenticated client biết/đoán bearer URL (`frontend/billing/FakeCheckout.js:24-55`; `backend/http_middleware.py:375-409`; `backend/billing/routes.py:36-188`) |
| BILL-BUILD-01 | Fake checkout entry contract chưa được mô hình hóa theo deployment | Dev/test hosted simulator cần bundle `FakeCheckout.js`; secure production có thể cố ý loại nếu route/page không reachable. Hiện manifest không có module nhưng HTML dev/test trỏ tới nó (`views/fake_checkout.html:60`; `vite.config.js:234-236`) |
| USAGE-01 | `get_balance().used` có thể giảm khi grant hết/hết hạn | Không sửa trước khi chủ sản phẩm chốt đây là active-pool hay lifetime-history (`backend/usage_credits/service.py:41-68`) |
| A11Y-01 | Sidebar active state thiếu `aria-current` | `views/components/sidebar.html:16-30`; `frontend/app/BiddingControllerUI.js:493-499` |
| A11Y-02 | Offline banner thiếu live-region semantics | `frontend/app/BiddingController.js:836-860` |
| QA-02 | Frontend ESM reachability báo sai FakeCheckout | Audit chỉ root từ `frontend/app/app.js`; file là HTML/backend-served entry thật. Check không bao phủ dead symbol Python/backend, template entry ngoài graph hoặc clone detection |
| QA-03 | Coverage artifact chưa phản ánh commercial/billing v79 và một số route seam nhạy cảm vẫn mỏng | `coverage.json` tạo 2026-08-25: combined line+branch 62,51% (line-only 65,82%); không có `backend/billing/*`; `auth/auth_routes.py` 12,31%/14,37%, `conflict_resolution/routes.py` 13,19%/16,41%, `package_document_routes.py` 12,44%/15,18%, `sync/version_api.py` 0%/0% (combined/line-only) |
| AUTH-DEC-01 | OTP/registration response cho biết trạng thái account khác nhau | Có thể hỗ trợ account enumeration, nhưng chuẩn hóa response đổi UX/API contract nên cần chủ sản phẩm duyệt (`backend/auth/otp_routes.py:194-199,303-314,367-374`) |
| DB-DEV-01 | Snapshot development cục bộ đang dùng `DATABASE_URL` với role `postgres` dù có runtime role riêng | Tăng blast radius nếu dev host bị lộ; production validation cấm role mismatch/privileged attributes, nên đây là local hardening chứ không phải bằng chứng production authorization bypass (`backend/startup.py:382-402,515-518`) |
| SCHEMA-LEGACY-01 | `sensitive_record_read_capabilities` là legacy no-op còn trong schema | Chỉ retire bằng migration mới + ADR/regression giữ full-record visibility; không kích hoạt lại và không dùng nó để che dữ liệu (`backend/db/schema.py:2366`; `tests/test_record_access_projection.py:259-272,1052-1086`) |
| CLEAN-01 | Artifact/log/cache chưa có retention/rotation rõ | Không phải tự động là “file rác”; xem inventory bên dưới |

## Finding High — remediation và regression seam

### PAY-01 — ràng buộc payment fact với đúng order

`INSERT ... ON CONFLICT DO NOTHING` hiện chỉ tránh ghi trùng identity, nhưng code vẫn tiếp tục đánh dấu order hiện tại paid và activation. Khi conflict, deep module nhận payment evidence phải lock/read transaction hiện hữu và chỉ coi là replay nếu `order_id`, profile, transaction type, amount, currency và evidence identity đều khớp.

Regression bắt buộc:

- Hai order khác owner, cùng provider transaction ID, xử lý tuần tự và đồng thời.
- Order thứ hai không đổi `payment_state`, không có grant/subscription/invoice/outbox.
- Sự kiện và order thứ hai vào trạng thái review có audit đủ điều tra; không log credential/raw secret.

### PAY-02 — durable provider result trước terminal command

Không được commit command `completed` trước khi có một trong hai thứ: payment fact đã durable, hoặc provider-result snapshot/outbox durable có consumer idempotent. Nếu apply activation thất bại, phải còn work item có thể retry. Comment hiện nói fact durable nhưng control flow không đáp ứng invariant đó.

Regression bắt buộc:

- Fault injection sau provider `PAID` tại required audit, invoice và outbox.
- Sau rollback vẫn có durable evidence/retry.
- Retry tạo đúng một transaction, một activation/grant và một bộ audit/outbox.

### PAY-03/PAY-05 — mapping và transition là business contract

Không tự suy diễn `tier → package`, proration, renewal anchor, carry-over hoặc semantics upgrade/downgrade. Chủ sản phẩm phải duyệt mapping immutable và transition matrix; sau đó ghi ADR, compatibility impact và migration strategy. Publish phải chặn offer sellable nếu thiếu mapping đã được yêu cầu, thay vì thu tiền rồi mới review.

Regression bắt buộc là E2E thật qua `publish → projected SKU → quote → order → provider paid → activation`, không dùng fixture tự chèn `legacy_package_id`. Matrix transition phải bao phủ operation × item type × current subscription × pinned transition kind × server-authoritative subscription revision. Hiện create-order chỉ enforce một chiều credit-pack → item credit-pack (`backend/billing/service.py:102-129`), còn revision là client-optional ở `backend/commercial_policy/routes.py:551-587` và activation chỉ so khi có giá trị (`backend/billing/activation.py:348-351`); quote phải capture revision từ DB thay vì tin client có gửi hay không.

### PAY-04 — composition root cho `PaymentProviderRegistry`

Runtime chỉ lưu credential reference trong DB; secret resolver thật được inject tại composition root. Startup/readiness phải chứng minh app environment, immutable provider profile, credential reference và secret metadata tương thích trước khi nhận traffic. Không đưa secret vào DB, policy document, response hoặc log.

### ORG-01 — thay nhân sự bằng một server transaction

Backend đã có flow `SUCCESSOR_REQUIRED` và transfer assignment nguyên tử. Frontend hiện không capture `Response` của remove, nên `apiFetch` trả 409 nhưng code vẫn rekey local permission/assignment, add user và báo success.

Mitigation an toàn ngay là capture `Response`, dừng ở mọi non-2xx, không rekey, không add, không success alert và reload authoritative server state. Hai request remove rồi add tuần tự vẫn không all-or-none: remove có thể 2xx rồi add fail. Full atomic replacement chỉ được làm sau khi chủ sản phẩm chốt outcome của assignment và permission (copy quyền cũ hay dùng default hiện hành), ghi ADR/compatibility/migration, rồi triển khai composite command exact-request/idempotent tái sử dụng offboarding hiện hữu. Không copy hoặc suy diễn permission phía client.

Regression bắt buộc:

- 409 successor required không đổi client/server state.
- Nếu chọn composite replacement đã được duyệt, transfer, membership add/remove, default/copy permission theo đúng contract, assignment history, audit, activity và outbox phải cùng transaction.
- Failure ở bất kỳ step nào rollback toàn bộ.
- Các rule/gate tenant, module, assignment và record authorization không đổi; chỉ những row membership/assignment/permission mà contract mới phê duyệt được đổi. Test phải assert access của người cũ/người mới đúng contract đó, không tự giữ nguyên hoặc mở rộng access.

### SYNC-01 — resolution phải có một outcome bền vững

Hiện business mutation commit trước; mark draft resolved và required audit chạy ở connection khác. Có hai thiết kế chấp nhận được:

1. Ưu tiên cùng transaction: reload draft, fresh-authorize, persist mutation, audit `sync.conflict_resolved`, resolved state và outbox atomically; không tin prepare snapshot đã cũ.
2. Nếu buộc dùng durable state machine, phase một phải atomically ghi immutable authoritative resolution evidence/audit và finalize command cùng mutation; không được trì hoãn required audit sang worker sau commit. Lifecycle/schema như `applied_pending_finalize` là contract mới, cần cập nhật ADR 0008, compatibility và migration trước khi triển khai.

Regression bắt buộc inject failure tại draft mark/audit, process crash giữa hai phase và duplicate request. Kết quả cuối phải là all-committed hoặc durably recoverable, không được mutation đã commit nhưng UI được hướng dẫn retry như chưa áp dụng.

### LOCAL-01 — một workspace mutation cho Excel import

Stage toàn bộ thay đổi trong memory, sau đó dùng một IndexedDB multi-store transaction chứa entity rows và authoritative `kv_store` outbox envelope. Outbox hiện dual-write IndexedDB + localStorage (`frontend/app/WorkspaceMutationOutboxStore.js:345-413`), nên localStorage chỉ được mirror best-effort sau commit và phải degrade rõ nếu mirror lỗi; không thể hứa atomic xuyên hai storage engine. Chỉ publish state mới sau IndexedDB commit; `onabort` phải phục hồi state cũ. BrowserDB cần API transaction sâu để caller không biết từng store.

Regression bắt buộc fault-inject store thứ hai cho basic/opening/award import; assert tất cả IndexedDB store và outbox cùng rollback hoặc cùng commit. Golden fixture phải giữ chính xác record/field hiện hữu, không lọc hay masking. Sau reload, local projection và mutation outbox phải đồng nhất.

### UX-01/02/03 — storefront dùng state machine rõ ràng

Tách state cho catalog, usage, orders, checkout và polling. API con lỗi phải giữ dữ liệu cũ nếu có, hiển thị stale/error và Retry riêng; không ghi đè bằng “đã đồng bộ”. Polling dùng bounded exponential backoff, abort/cleanup khi unmount và tiếp tục sau lỗi tạm thời. Mở blank popup đồng bộ trong click, sau đó gán URL; nếu bị chặn thì cung cấp same-tab/link fallback. Không coi redirect/browser payload là bằng chứng payment.

### DOC-01/02/03 — read-only history, resumable jobs và exact upload request

- Tách mutability probe dành cho read với `lock=False`. Package historical đã qua `_package_read_allowed` phải trả 200 với đầy đủ sections/slots/fields hiện hành và `write_allowed=false`; unauthorized vẫn 403, missing vẫn 404. Không dùng Word entitlement, masking hoặc redaction để “sửa” read path.
- Lưu/resume Word `jobId` theo actor + organization. Chỉ backoff/retry transport và lỗi retryable; auth/revocation/source-change/terminal error không retry. Create-job idempotency bind actor, organization và exact-request digest; mọi replay vẫn fresh-authorize và giữ nguyên entitlement xuất Word.
- Upload fingerprint bind normalized filename, size, SHA-256, media/domain fields và operation. Cùng key+cùng exact file được replay sau fresh session/write/mutability checks; cùng key+file khác trả 409. Phát hiện conflict trước khi giữ lại bytes của file B ngoài thời gian xử lý request. Schema thay đổi phải additive, có compatibility migration và no-duplicate audit test.

## Billing reliability bổ sung

Các finding PAY-09 đến PAY-13 nên được xử lý trước shadow/pilot dù không phải toàn bộ là P0:

- Command completion/failure phải có fencing predicate `status='processing' AND locked_by=? AND lease generation=?`; worker hết lease không được complete command mà worker mới đã claim.
- Dispatch retry phải dựa trên `command_type` và durable outcome evidence, không dùng `attempt_count > 1` để biến mọi retried create thành GET. Quy tắc hiện tại còn chuyển sang GET cả khi lỗi xảy ra trước khi create request được gửi, ví dụ resolver unavailable. Cancelled chỉ được ghi từ provider terminal status phù hợp.
- Manual refund lookup idempotency key phải xảy ra trước aggregate-limit validation, và replay phải so request fingerprint. `amount` cần typed validation trước `int()`.
- `provider_order_code` cần allocator/collision retry hoặc identity đủ entropy nằm trong giới hạn provider; deterministic 31-bit hash không đủ ở volume cao.
- Có scheduled reconciliation cho open/creating order với backoff, cutoff và audit; webhook vẫn là fast path chứ không phải path duy nhất.
- Provider network I/O phải chạy qua thread pool/job worker, không trực tiếp trong `async def`. Starlette chỉ tự đưa synchronous endpoint/background task phù hợp vào thread pool; lời gọi sync bên trong async handler vẫn block event loop.
- Tạo route kết quả/hủy có UX rõ, nhưng route không được tự activation từ query string/redirect.

## Database và hiệu năng

### FK indexes

Live audit trên **DB audit cục bộ** trả `foreignKeyCount=201`, `missing=32`. Kiểm tra sâu xác định 30 thiếu thực và hai effective false positive về performance:

- `billing_orders(organization_id, quote_id)` đã có unique `quote_id`.
- `organization_subscriptions(organization_id, source_order_id)` có PK `organization_id`, nên probe tối đa một row.

Ba hot path cần index trước traffic:

1. `billing_order_items(order_id)`.
2. `payment_transactions(order_id)`; cân nhắc `(order_id, transaction_type)` nếu `EXPLAIN` chứng minh cover refund query.
3. `commercial_release_timeline(release_id)`; cân nhắc suffix theo effective-release query.

Bảy provenance/reconciliation key tăng theo giao dịch nên đi cùng roadmap usage/payment; 20 FK catalog/actor immutable cần được quyết định riêng: tạo index theo cardinality/parent lifecycle, hoặc waiver có rationale, owner và review date. Tất cả constraint bị báo là `ON DELETE RESTRICT`/`NO ACTION`, không có cascade storm; đây là operability/locking risk, không phải authorization bypass.

Migration phải additive. Với bảng lớn dùng `CREATE INDEX CONCURRENTLY` ngoài transaction, xác nhận `indisvalid/indisready`. Các bảng v79 trên **DB audit cục bộ** chỉ được quan sát là rỗng tại thời điểm đo; không suy ra cardinality production từ quan sát này. Fresh DB và upgrade chain phải xuất riêng `rawMissing`, `waived` và đạt `unexplainedMissing=[]`: hai effective-cover exception hiện tại được checker nhận diện hoặc allowlist chính xác, còn mọi Group B/C waiver chỉ hợp lệ khi có rationale, owner và review date; FK chưa được waiver phải có index.

### Frontend bundle/startup

Secure build pass nhưng các chunk lớn nhất là:

| Artifact | Raw | Gzip |
|---|---:|---:|
| `BiddingWorkflows` | 933,84 kB | 253,76 kB |
| `workspaceBootstrap` | 472,96 kB | 134,25 kB |
| `GoiThauDetail` | 427,43 kB | 97,53 kB |
| Main CSS | 326,44 kB | 56,61 kB |

`BiddingController` còn warm-up toàn bộ `BiddingWorkflows` ở post-startup (`frontend/app/BiddingController.js:899-902`). Local self-hosted route probe ghi max long task `283 ms` trong 60 navigation, trong khi hard budget là `100 ms`; run này không persist host-load metadata nên chỉ chứng minh gate cục bộ đỏ, chưa chứng minh capacity production. Artifact startup ngày 2026-08-25 có cold P95 `1578/800 ms`, warm P95 `1074/325 ms`; artifact còn 404 Conflict Center cũ nên không dùng nó để kết luận route lỗi hiện tại. Cần đo lại bằng production server cô lập và lưu build/run/host-load artifact.

Khuyến nghị:

- Preload theo current route, user intent và network quality; không blanket warm-up workflow lớn.
- Profile source-mapped long task trước khi tách chunk; kích thước nhỏ hơn không tự đảm bảo parse/hydration nhanh hơn.
- Tách route-owned controller/view/forms; giữ shared domain/service ở seam ổn định.
- Dùng `pg_stat_statements` cùng `EXPLAIN (ANALYZE, BUFFERS)` trên dataset đại diện để ưu tiên query/index, không thêm index theo phỏng đoán.
- Gate cold/warm/long task trên secure production build với host load ghi kèm artifact.

### Offline và accessibility

Service worker chỉ đi qua `imports`, không qua `dynamicImports`; lazy route chưa mở chỉ cache sau request đầu. Chọn một contract rõ:

- Precache tập route tối thiểu đã được sản phẩm cam kết offline, hoặc
- Diễn đạt banner đúng rằng một số chức năng có thể không sẵn sàng và cung cấp route-level Retry.

Thêm `role="status" aria-live="polite"` cho banner và `aria-current="page"` cho đúng một nav button active. Đây là cải thiện accessibility, không đổi access permission.

## Code chết, code lặp và refactor

### Không được xóa nhầm

- `frontend/billing/FakeCheckout.js` **không phải code chết**. Nó được load bởi `views/fake_checkout.html:60` và dev/test route backend `backend/billing/routes.py:555-567`. Cần reachable-entry matrix theo deployment: dev/test bundle phải chứa simulator; secure production có thể cố ý loại nếu page/module không được phục vụ.
- `frontend/documents/wordVariableManifest.js` là generated artifact, có generator `scripts/generate_word_variable_manifest.py`; không refactor tay. `--check` hiện pass.
- `data/tools` là local PostgreSQL/toolchain; không phải rác.
- `data/postgresql17-data` là local database cluster, không phải cache; chỉ backup/restore/reset qua runbook rõ, không xóa tay.
- `release` chứa private symbols/provenance; không xóa nếu chưa có retention owner.
- `.env`, backup, logs, test evidence và root `favicon.png` không được xóa theo suy đoán.
- Không dùng blanket `git clean -fdX`: dry-run cho thấy nó có thể nhắm cả `.env`, database/toolchain local và artifact cần retention. Cleanup phải dùng allowlist literal-path đã review.

### Phạm vi reachability và duplication

`npm run audit:dead-code` hiện gọi `scripts/audit_frontend_reachability.mjs`. Script chỉ duyệt file `.js/.mjs` dưới `frontend`, nhận literal local `import`/`export`/`import()`/`new URL()`, và chỉ dùng `frontend/app/app.js` làm production entrypoint (`scripts/audit_frontend_reachability.mjs:6-9,36-51,98-110`). Vì vậy:

- Kết quả orphan duy nhất là false positive `FakeCheckout.js`; script chưa mô hình hóa HTML/backend-served entrypoint theo deployment.
- Audit này không chứng minh dead symbol/unreachable code ở Python/backend, không phát hiện unused export và không bao phủ computed import. Python quality gate có kiểm tra `F401/F841`, nhưng đó không phải dead-symbol scan toàn backend.
- Không được xóa file chỉ từ kết quả reachability hiện tại. Cần entry manifest theo deployment và, nếu muốn dọn backend, một scan riêng có allowlist cho framework registration/reflection rồi xác minh bằng test/reachable-route inventory.

Audit chưa chạy clone detector định lượng cho toàn repo; số dòng và C901 **không** phải bằng chứng code clone. Seam lặp đã xác nhận là mô tả route frontend bị phân tán: URL/lazy partial ở `frontend/app/BiddingController.js:65-112`, storage priority ở `frontend/app/BiddingController.js:619-646`, detail table ở `frontend/app/SyncPullService.js:30-36`, workflow grouping ở `frontend/app/WorkflowModuleLoader.js:1-45`, còn title/render dispatch ở `frontend/app/BiddingControllerUI.js:485-708`. Đây là semantic duplication/drift risk đủ để đề xuất một registry, không phải kết luận có N% dòng trùng nhau.

Backend dead-symbol chưa được chứng minh exhaustive. Lệnh mở rộng `python -m ruff check backend --select F401,F811,F841 --output-format concise` tìm một lỗi chắc chắn là import `contextlib` lặp tại `backend/app.py:34,1247`; gate mặc định hiện không bắt `F811`. Một số private symbol chỉ thấy ở definition (`_preservation_digest`, `_restore_document_properties`, `_resolve_publication_template_path`, `_add_issue`, `_enabled`, `_provider_name`, `_configuration_bool`, `_latest_broker_event_id`) là candidate cần characterization/registration check, **không** phải danh sách được phép xóa vì framework registration, dynamic import và reflection có thể làm static count sai. Repo hiện không có Vulture/dead-symbol scanner được pin; cần thêm scan riêng với allowlist và test route trước khi xóa.

Các clone/seam có bằng chứng source cụ thể để ưu tiên refactor (không đổi semantics):

| Seam | Bằng chứng | Hướng deep module |
|---|---|---|
| Bounded environment integer parsing | `backend/shared/async_io.py:26-31`, `backend/documents/document_worker.py:186-191`, `backend/documents/document_worker_entry.py:66-71`, `backend/documents/word_export_cache.py:38-43`, `backend/partners/partner_lookup_service.py:38-43`, `backend/sync/delta_paging.py:111-116`, `backend/sync/websocket.py:45-50` | Một typed env-reader nội bộ, giữ nguyên default/clamp/error hiện tại |
| Auth rate-limit adapter | `backend/auth/google_auth_routes.py:58-67` và `backend/auth/otp_routes.py:84-93` | Adapter chung nhận policy Busy/Timeout tường minh; khóa response/status bằng regression |
| Province upstream gateway/cache | `_fetch_json` tại `backend/partners/address_parser.py:42-49` và `backend/partners/address_routes.py:63-70`; cache riêng tại `address_parser.py:9-10,52-64` và `address_routes.py:33,73-90,135` | Gateway sâu + cache adapter, offload I/O sync; giữ response/error contract |
| Dialog lifecycle | DOM lookup block lặp tại `frontend/app/BiddingView.js:752-760,820-828,895-903,963-971,1309-1317,1438-1446,1678+` | `DialogSession` nội bộ quản lý focus/listener/restore; caller chỉ cung cấp content/result |
| Legacy record mutation transaction | `frontend/app/BiddingModel.js:1304-1427` (add/update/delete lặp begin/snapshot/checkpoint/write/commit/rollback) | `MutationRunner` qua callback; characterization test cho từng operation và crash seam |
| Word mapping form command | `frontend/documents/WordIntegration.js:788-905` | Validator + save command chung, giữ message/focus và field visibility hiện tại |
| Vietnamese token normalizer | `frontend/packages/detailedEvaluationCriteria.js:1-9`, `detailedEvaluationExcel.js:3-11`, `evaluationMethodRules.js:26-34`, `technicalEvaluationMethod.js:23-31` | Pure shared normalizer + golden vectors |

### Hotspot complexity

Backend có `215` finding C901. Các function cao nhất:

| Function | Complexity |
|---|---:|
| `validate_sync_item` | 122 |
| `validate_owner_scoped_references` | 75 |
| `validate_sync_payload_shape` | 75 |
| `apply_custom_mappings` | 65 |
| `_paginate_records_blocking` | 61 |
| `normalize_opening_bundle` | 59 |
| `parse_excel` | 58 |
| `validate_bidder_goods_batch` | 57 |
| `execute_sync_mutation` | 51 |
| `_read_sync_data_blocking` | 50 |

Frontend hotspot theo dòng gồm `BiddingView.js` 1.728, `BiddingModel.js` 1.711, `WordIntegration.js` 1.645, `PlanImportWizard.js` 1.558, `KeHoachWorkflow.js` 1.518 và `BiddingController.js` 1.437. Dòng không tự chứng minh thiết kế xấu; chúng chỉ là nơi ưu tiên đo coupling/change frequency và viết characterization test trước khi tách.

### Deep modules đề xuất

| Module | Interface ngoài nên nhỏ | Chi tiết cần giấu bên trong |
|---|---|---|
| `BillingWorkflow` | `create`, `ingestEvidence`, `reconcile`, `refund` | Quote snapshot, command, payment fact, timing, activation, audit/outbox, retry/fencing |
| `PaymentProviderRegistry` | `resolve(pinnedProfile)` | Environment, immutable profile, credential resolver, timeout, TTL, callback/checkout host policy |
| `SyncMutationExecutor` | `execute(envelope)` | Authorize → normalize/import authority → validate → persist/delete → required audit/commit → post-commit |
| `ConflictResolutionCommand` | `resolve(draft, decisions, mutationId)` | Business mutation + durable draft/audit outcome |
| `WorkspaceMutationStore` | `commit(changeSet)` | IndexedDB multi-store transaction, in-memory publish, outbox, rollback/recovery |
| `DocumentJobClient` | `startOrResume(exactRequest)` | Idempotent create, persisted jobId, polling/backoff, download, expiry |
| `RouteDescriptorRegistry` | `resolve`, `load`, `priorityKeys`, `render` | URL, lazy partial, startup keys và view loader metadata hiện lặp ở nhiều file |
| `BiddingModel` facade | API tương thích hiện tại | Dần tách `WorkspaceEntityCatalog`, `WorkspaceHydrator`, `WorkspaceMutationStore` |

Không rewrite framework. Mỗi bước giữ interface cũ và có characterization tests trước khi di chuyển logic. Đặc biệt:

- Validator registry trả normalized item + typed errors nhưng giữ public error code/path/message hiện hành.
- Route registry không được trở thành nơi tự suy diễn permission. `canAccessTab` chỉ là UI/navigation eligibility; server-side tenant/module/assignment/record authorization mới là security authority duy nhất.
- Schema declarations có thể modularize dữ liệu rồi assemble đúng thứ tự, nhưng không sửa migration lịch sử đã phát hành.
- Complexity/debt gate áp dụng ratchet cho code chạm mới trước, không bật threshold toàn repo và ép đổi semantics hàng loạt.

## Inventory cleanup và retention

Không có file nào bị xóa trong audit. Dung lượng dưới đây là snapshot point-in-time; test/build có thể tự sinh thêm cache/log, vì vậy cleanup phải đo lại ngay trước khi thực hiện.

| Nhóm | Dung lượng | Phân loại | Đề xuất |
|---|---:|---|---|
| `.tmp` | 113,30 MiB | Tái tạo/QA; 112,21 MiB là Word standardizer QA | Retain theo ticket/release; dọn có owner sau thời hạn |
| `release` | 296,36 MiB | Build/private symbol artifacts | Giữ N release hoặc theo provenance policy; không xóa ad hoc |
| `test-results` | 37,78 MiB | Playwright evidence | Giữ failure gần nhất và CI retention hữu hạn |
| `playwright-report` | 0,50 MiB | Rebuildable report | Có thể dọn sau khi evidence đã lưu |
| `coverage.json` | 3,54 MiB | Rebuildable | Dọn theo CI lifecycle, không commit |
| `data/logs` | khoảng 220,42 MiB; PostgreSQL khoảng 216,58 MiB | Operational logs | Bật size/time rotation, compression và retention; không truncate đang chạy |
| `data/tools` | 848,44 MiB | Local PostgreSQL/toolchain | Không gọi là rác; chỉ uninstall qua setup owner |
| `data/postgresql17-data` | khoảng 433,82 MiB | Local PostgreSQL cluster | Không xóa như cache; reset chỉ bằng script/runbook có xác nhận dữ liệu disposable |
| `node_modules` | khoảng 140 MiB | Rebuildable từ lockfile | Dọn khi không có process chạy; `npm ci` phục hồi |
| Backend `.pyc` | 5,61 MiB tại lần đo cuối (385 file/43 `__pycache__`) | Cache | Dọn theo cache policy; ba namespace retired hiện chỉ còn `__pycache__`; số liệu thay đổi khi test chạy |
| `.pytest_cache`, `.ruff_cache` | khoảng 0,43 MiB | Cache kiểm thử | Dọn theo CI lifecycle; không dùng làm bằng chứng runtime |
| `dist` | khoảng 4,16 MiB | Build tái tạo | Dọn trước release nếu không phải artifact được owner lưu |
| `.codex_lo_extract.log`, `test-artifacts` rỗng | khoảng 1,8 KiB + rỗng | Residue local | Xóa bằng allowlist sau khi kiểm tra process/retention |
| `data/word-export-cache` | khoảng 2,02 MiB | Runtime cache | Retention theo job expiry và lifecycle janitor |
| Root `favicon.png` | 1,78 MiB, tracked | Ứng viên thừa | Runtime dùng `views/assets/favicon.png` 41 KiB; chỉ retire sau owner xác nhận và asset-reference check |
| `BiddingFlow_Word_Standardizer_Skill_Package.zip` | khoảng 0,71 MiB, tracked | Research/source package có evidence reference | Không gọi là orphan; archive/relocate chỉ khi cập nhật tài liệu phân tích/hash liên quan |

Hai báo cáo `docs/reports/2026-08-25-paid-packages-implementation.md` và `docs/testing/2026-08-25-paid-packages-implementation.md` cùng tên nhưng khác nội dung lớn. Nên tạo documentation index, đánh dấu bản authoritative/superseded trước khi archive; không xóa một bản chỉ dựa vào tên.

## Lộ trình 0–90 ngày

### 0–30 ngày — đóng blocker và bảo toàn dữ liệu

1. Giữ payment activation/checkout thật tắt.
2. Sửa PAY-01/PAY-02 với race và fault-injection tests.
3. Chủ sản phẩm chốt mapping/transition; thực hiện PAY-03/PAY-05 qua ADR.
4. Nối `PaymentProviderRegistry`/readiness PAY-04.
5. Sửa ORG-01, SYNC-01, LOCAL-01 theo transaction/durable state machine.
6. Sửa UX-01/02/03, route kết quả/hủy và định nghĩa reachable-entry matrix cho fake checkout theo deployment.
7. Thêm Group A FK indexes; phân loại Group B/C thành index hoặc waiver có owner/review date; sửa checker/allowlist đúng hai effective-cover exception để gate đạt `unexplainedMissing=[]`.
8. Duyệt legal facts/placeholders hoặc tiếp tục giữ production packaging blocked.

### 30–60 ngày — reliability và deep-module seams

1. Hoàn thiện command fencing, periodic reconciliation, provider TTL/environment và refund idempotency.
2. Bật usage reaper/reconciliation; sửa crash window snapshot/debit.
3. Bound commercial validation và validate discount trước DB.
4. Sửa DOC-01/02/03, session tri-state và offline contract.
5. Sửa Windows race của Word export cache; cache failure phải degrade thành cache miss có telemetry thay vì làm mất render hợp lệ.
6. Tạo `BillingWorkflow`, `SyncMutationExecutor`, `WorkspaceMutationStore`, `DocumentJobClient` dưới facade tương thích.
7. Đo secure production startup và query workload; xử lý bundle/long task dựa trên profile.

### 60–90 ngày — giảm nợ có kiểm soát

1. Hợp nhất route metadata qua `RouteDescriptorRegistry`.
2. Tách dần BiddingModel/controller theo route/workflow, không big-bang rewrite.
3. Tách validator theo aggregate; khóa golden errors và authorization regression.
4. Modularize schema declarations, không sửa migration lịch sử.
5. Ratchet CSS/raw colors/runtime styles cho code thay đổi; không tăng baseline.
6. Ban hành retention/rotation cho log, release symbols, test artifact và cache.
7. Bật workload observability bằng `pg_stat_statements` nếu deployment owner chấp thuận restart/config.

## Quyết định cần chủ sản phẩm/owner

1. Mapping immutable từ commercial offer sang package compatibility.
2. Transition matrix upgrade/downgrade/renewal/proration/carry-over và revision authority.
3. Fake checkout dùng session-owner hay one-time capability nonce; bất kỳ thay đổi access semantics nào cũng cần ADR.
4. `usage.used` là active-pool usage hay lifetime/kỳ usage.
5. Quyền đọc/thao tác billing history của organization đang `BLOCKED_DECISION`; không tự mở hoặc tự thu hẹp.
6. Legal facts, URL và placeholder nào được public production.
7. Retention owner cho private symbols, Word QA artifacts, Playwright traces, PostgreSQL logs và root favicon.
8. Có chuẩn hóa response OTP/registration để giảm account enumeration hay giữ UX/API contract hiện tại; nếu đổi phải có compatibility plan và rate-limit/regression tương ứng.
9. Có retire bảng legacy `sensitive_record_read_capabilities` hay tiếp tục giữ no-op; nếu retire phải dùng migration mới và chứng minh full-record visibility không đổi.

Không cần và không được tạo capability đọc dữ liệu nhạy cảm mới để giải quyết bất kỳ finding nào ở trên.

## Kết quả kiểm tra

| Lệnh/check | Kết quả |
|---|---|
| `npm run test:js` | `1356 passed`, `0 failed`, khoảng 18,7 phút |
| `npm run build:secure` | Pass; 319 module transformed, secure artifact check pass, 64 bundle được kiểm tra |
| Dependency audit / security lint / vendor audit | Pass |
| `npm run lint:modules` | 315 module, 0 static cycle |
| `npm run audit:controller-commands` | 115 command có caller, giữ lại |
| `npm run audit:dead-code` (frontend ESM reachability, không phải dead-code audit toàn repo) | Exit 1; 315 module, 314 reachable, orphan duy nhất `frontend/billing/FakeCheckout.js` là false positive vì HTML/backend-served entry; không có kết luận dead-code toàn codebase |
| `npm run lint:debt` | Exit 1; `important 433 > 428`, `raw_colors 1067 > 930` |
| `python -m ruff check backend --select C901 --output-format json` | 215 finding; max complexity 122 |
| `python scripts/audit_fk_indexes.py` | Exit 1; 201 FK, 32 reported; 30 thiếu thực, 2 effective false positive |
| `npm run check:legal:production` | Exit 1; 27 fact chưa duyệt + 27 placeholder |
| `npm run test:route-css-visual` | Exit 1; long task `283 ms > 100 ms` |
| Python full suite lần đầu | `41 failed, 1777 passed, 63 skipped` trong 44:19; 40 failure do PostgreSQL cục bộ không chạy, một AI local-HTTP test flaky |
| `python -m pytest --lf -q` sau khi PostgreSQL sẵn sàng | Interim rerun: `40 passed, 10 deselected` trong 58,29 giây; không được dùng riêng lẻ để kết luận full suite xanh |
| `python -m pytest -q -k "not test_transport_ignores_ambient_proxy_environment"` | Run rộng cuối: `1 failed, 1879 passed, 1 deselected` trong 30:23; zero PostgreSQL failure, failure mới tại `test_standardized_template_cache_single_flight` |
| Word cache single-flight stress trên Windows | Một batch `50/50` pass, nhưng các batch khác tái hiện `2/100` và `3/30` failure; instrumented `300` cache root mới × 4 thread ghi nhận `4` PermissionError đúng lúc owner unlink lock |
| AI transport test chạy riêng | Pass; nhưng pair/full-order vẫn tái hiện `ConnectionResetError`, nên chưa được coi là suite xanh ổn định |

### Fault harness xác nhận

- Discount `-1` sinh giá sau giảm `101000` và `101` sinh `-1000`, cả hai `errors=[]` trước DB.
- Conflict resolve: `business_committed=true`, draft chưa mark, HTTP 500 khi phase hai lỗi.
- Excel import: `goithau` persist, `kehoach` lỗi, in-memory package/plan đã đổi, `commits=[]`.
- Word job: create trả `jobId`, poll đầu lỗi mạng, UI dừng và không download.
- Word cache: concurrent single-flight có thể ném `PermissionError [Errno 13]` tại `os.open(...O_EXCL...)` khi thread khác đang release/unlink lock; đây là race Windows cần regression riêng.
- Document upload: cùng idempotency key nhưng payload B replay response/document A.
- Membership replacement: remove response không được capture/check `.ok`, nhưng client vẫn rekey permission/assignment.

## Tiêu chí đóng audit

- Một provider transaction không thể mang lại quyền lợi cho hai order, kể cả race hai worker.
- Mọi provider terminal result có durable fact hoặc durable retry trước khi command terminal.
- Publish-to-activation E2E dùng projection thật và contract mapping/transition đã duyệt.
- Organization replacement, conflict resolution và Excel multi-table import có all-or-recoverable outcome.
- Open order tự reconcile khi mất webhook; command lease có fencing.
- Authorized historical read trả đầy đủ dữ liệu và chỉ biểu diễn mutability đúng, không thay visibility.
- Mỗi deployment build chứa mọi entrypoint reachable của chính deployment đó; dev/test có FakeCheckout, production chỉ loại khi simulator page/module không reachable. Redirect kết quả/hủy tồn tại nhưng không activation từ redirect.
- FK audit xuất `rawMissing`/`waived` và có `unexplainedMissing=[]`: mọi thiếu thật được index hoặc có waiver riêng với rationale/owner/review date; performance gate đạt trên secure production build đại diện.
- Legal gate, debt ratchet và test suite ổn định đều xanh.
- Regression chứng minh tenant/session/module/assignment/record authorization và full-record visibility không đổi.

## Tài liệu tham chiếu chính thức

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): custom header/token, Origin/Referer và SameSite defense-in-depth.
- [Starlette Thread Pool](https://www.starlette.io/threadpool/): sync work cần được đưa khỏi event loop; thread pool có giới hạn dùng chung.
- [Vite Multi-Page App](https://vite.dev/guide/build.html#multi-page-app): build cần khai báo nhiều entrypoint cho nhiều page độc lập.
- [PostgreSQL 17 Foreign Keys](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK): PostgreSQL không tự tạo child-side FK index; parent delete/update có thể phải scan child table.
- [PostgreSQL 17 `pg_stat_statements`](https://www.postgresql.org/docs/17/pgstatstatements.html): thống kê planning/execution để ưu tiên query theo workload thật.

Chi tiết backend/payment/DB với scenario và regression riêng từng finding nằm tại `docs/audits/2026-08-26-backend-security-db-audit.md`.
