# Audit backend, bảo mật và cơ sở dữ liệu — 2026-08-26

## Cập nhật remediation cùng ngày

BSD-01, BSD-02, BSD-07, BSD-11 và BSD-14 đã được sửa kèm regression.
Runtime payment đã bổ sung binding operation/item type, lọc provider
environment, checkout TTL, lease fencing, refund exact-request, offload provider
I/O và usage reservation reaper. SYNC-01 nay commit business mutation, draft
resolution và required audit trong cùng transaction; ADR 0008 đã ghi rõ
compatibility/rollback seam.

BSD-03/05 vẫn chờ chủ sản phẩm phê duyệt mapping/transition; BSD-04 chờ secret
resolver và profile deployment thật. BSD-13 chưa tự động tạo 30 index khi chưa
có quyết định concurrent migration/cardinality/waiver từ deployment owner. 27
legal fact/placeholder được chủ sản phẩm nhận xử lý sau và không bị thay đổi.

## Kết luận điều hành

Audit này tập trung vào phần thay đổi sau audit toàn hệ thống ngày 2026-08-25, đặc biệt là commercial release v79, billing/payment, usage credits, PostgreSQL contract, sync write path và lifecycle worker. Không sửa production code, schema, migration, UI hay test expectation trong quá trình audit.

Kết quả xác nhận **6 activation launch gate**: hai invariant tài chính P0 phải đóng trước mọi pilot activation (BSD-01/02) và bốn release/integration gate (BSD-03/04 cùng BSD-05/09 có điều kiện khi flags được bật). Ngoài ra còn các rủi ro ưu tiên, một reliability race trên Windows và 1 điểm cần chủ sản phẩm chốt semantics trước khi đổi. Rủi ro nghiêm trọng nhất là một transaction của provider có thể kích hoạt hai order khác nhau, trong khi một kết quả provider `PAID` sau rollback nằm ngoài cả hai selector worker hiện có; Super Admin query hoặc một webhook độc lập về sau vẫn có thể tạo đường phục hồi.

| ID | Mức độ | Trạng thái | Tóm tắt |
|---|---|---|---|
| BSD-01 | High / P0 | Xác nhận từ source và DB constraint | Cùng một provider transaction có thể kích hoạt hai order |
| BSD-02 | High / P0 | Xác nhận từ control flow | Kết quả `PAID` có thể rơi khỏi selector retry tự động hiện hữu sau lỗi Transaction B |
| BSD-03 | High / release blocker | Xác nhận từ publish→activation seam | Release mới không thể auto-activate base plan |
| BSD-04 | High / release blocker | Xác nhận từ startup/runtime wiring | payOS credential/profile chưa nối vào runtime |
| BSD-05 | High, conditional release gate / P1 | Xác nhận từ pinned policy | Upgrade/downgrade bỏ qua transition policy đã pin |
| BSD-06 | Medium / P1 | Xác nhận không có caller | Repo/lifecycle không tự reclaim usage reservation hết lease |
| BSD-07 | Medium / P1 | Xác nhận bằng phân tích thuật toán | Draft nhỏ có thể gây CPU/RAM exhaustion khi validate |
| BSD-08 | Low/Medium / P1 | Xác nhận từ PK/unique mismatch; cần hai profile chấp nhận cùng bytes | Webhook event ID xung đột giữa hai provider profile |
| BSD-09 | Medium, conditional release gate / P1 | Xác nhận từ routing/persistence | Profile environment và checkout TTL không được thực thi |
| BSD-10 | Low/Medium / P1 | Chỉ development/test; xác nhận từ middleware/route | Fake checkout vừa cho phép mutation không session, vừa lỗi với session thật |
| BSD-11 | Medium / P1 | Tái hiện read-only | Tỷ lệ giảm giá ngoài miền lọt qua validation rồi vỡ ở DB |
| BSD-12 | Low/Medium / cần quyết định | Chưa được phép tự đổi semantics | `get_balance()` làm mất số đã dùng khi grant hết hạn/hết lượt |
| BSD-13 | Medium / P1 operability | PostgreSQL live audit: 32 reported, 30 thiếu thực, 2 effective false positives | FK v79 thiếu child-side indexes, gồm ba hot path |
| BSD-14 | Low/Medium / P1 reliability, Windows-conditional | Tái hiện race lock file trong Word export cache | `os.open` với cờ `O_CREAT` và `O_EXCL` có thể ném `PermissionError` khi thread khác vừa release/unlink lock |

Các flag production hiện vẫn tắt và tài liệu triển khai ghi payOS là `BLOCKED_EXTERNAL`; BSD-03/04 là release/integration blocker, BSD-05/09 là conditional pre-pilot gate khi bật flags, chứ không phải lỗ hổng tenant authorization đang bị khai thác. BSD-01/02 vẫn là lỗi toàn vẹn tài chính phải sửa trước mọi pilot có activation.

## Business contract được bảo toàn

Audit không đề xuất masking, redaction, capability đọc dữ liệu nhạy cảm, thay đổi role/module/assignment/record scope, hoặc dùng entitlement Word để điều khiển API/màn hình đọc bản ghi. Contract hiện hành ở `AGENTS.md:7-19` và `CONTEXT.md:124-128` vẫn giữ nguyên:

- Sau khi tenant, module, assignment và record scope cho phép đọc, người dùng nhận đầy đủ trường của bản ghi.
- Entitlement Word chỉ gate hành động tạo/tải Word.
- Tenant isolation, session, module, assignment và record authorization tiếp tục bắt buộc.
- Bất kỳ remediation nào làm thay đổi quyền, visibility hoặc semantics nghiệp vụ phải có phê duyệt chủ sản phẩm, ADR/business contract, compatibility impact, migration strategy và regression test. Test không được tự đặt ra nghiệp vụ mới.

## Phạm vi và phương pháp

- So sánh thay đổi mới với `docs/testing/full-codebase-audit-2026-08-25.md`; không lặp lại finding đã đóng.
- Đọc control flow HTTP→service→transaction→worker ở billing, webhook, commercial policy, usage credits và procurement lookup.
- Đối chiếu Python schema, PostgreSQL schema contract, migration v79, unique/FK constraints và test seam.
- Kiểm tra auth/session transaction seam ở các route thương mại; không tìm thấy bằng chứng thay đổi contract record visibility hiện hành trong phần audit này.
- Dùng static data-flow/concurrency analysis và các harness read-only/rollback-only. Không gọi provider thật, không dùng credential thật và không mutate dữ liệu production.

## Findings chi tiết

### BSD-01 — High / P0: một provider transaction có thể kích hoạt hai order

**Bằng chứng.** Cả webhook path và query/reconciliation path đều `INSERT ... ON CONFLICT ... DO NOTHING` vào `payment_transactions`, nhưng không kiểm tra transaction hiện hữu thuộc order nào trước khi chuyển order đang xử lý sang `verified_paid` và gọi activation: `backend/billing/activation.py:94-125`, `backend/billing/activation.py:165-204`. DB chỉ bảo đảm identity duy nhất theo `(provider_profile_id, provider_transaction_id, transaction_type)`: `backend/db/schema.py:1822-1843`.

**Scenario/impact.** Order A ghi provider reference `T`. Một kết quả provider cho order B có `orderCode` và amount khớp B nhưng tái sử dụng `T`. Insert của B conflict và không tạo payment fact mới, tuy nhiên B vẫn được đánh dấu paid và có thể nhận subscription/credit grant. Đây là double activation/double entitlement từ một payment, đi ngược threat model “unique transaction ... chống double activation” tại `docs/security/commercial-payment-threat-model.md:10`.

Test hiện tại chỉ replay cùng một order (`tests/test_billing_activation.py:295-348`) và lặp credit-pack order đó 50 lần (`tests/test_billing_activation.py:403-452`); chưa có case một transaction identity qua hai order.

**Khuyến nghị.** Khi insert conflict, lock và đọc payment transaction hiện hữu. Chỉ coi là idempotent nếu `order_id`, provider profile, transaction type, amount/currency và evidence identity đều khớp order hiện tại. Khác order phải đưa cả sự kiện/order vào review, không đổi `payment_state`, không activation. Đặt invariant này trong một deep module duy nhất dùng chung webhook/query path.

**Regression bắt buộc.** Tạo hai order thuộc hai owner khác nhau, trả cùng provider transaction ID nhưng orderCode riêng hợp lệ; order thứ hai không được `verified_paid`, không có activation/grant/invoice/outbox, và có review/audit có thể điều tra. Thêm race test hai connection xử lý đồng thời.

### BSD-02 — High / P0: kết quả `PAID` rơi khỏi selector retry tự động hiện hữu sau lỗi Transaction B

**Bằng chứng.** `ProviderCommandExecutor._complete()` commit order checkout state và command `completed` trước ở `backend/billing/service.py:460-491`. Sau commit, code mở connection khác và gọi `apply_order_result()` ở `backend/billing/service.py:492-510`. Mọi exception bị swallow sau rollback ở `backend/billing/service.py:511-515`, dù comment nói payment fact đã durable. Thực tế payment transaction, `payment_state`, activation, invoice, audit và outbox đều nằm trong transaction sau và cùng rollback.

Worker chỉ chọn command `pending/retry` (`backend/billing/worker.py:70-82`) hoặc order đã `verified_paid` nhưng activation còn pending/retry (`backend/billing/worker.py:174-197`). Sau failure nói trên, command là `completed`, order vẫn `unverified`, nên provider fact `PAID` rơi khỏi các selector retry tự động hiện hữu; Super Admin query hoặc webhook độc lập vẫn là đường phục hồi khác.

**Scenario/impact.** Provider query có thẩm quyền trả paid, sau đó required audit/outbox hoặc một DB statement trong activation lỗi tạm thời. Ứng dụng ACK hoàn tất command nhưng worker không tự retry. Người dùng đã trả tiền nhưng không nhận quyền lợi; DB không giữ durable provider-result snapshot từ lần query đó, dù Super Admin/external reconciliation vẫn có thể query provider lại.

**Khuyến nghị.** Không đánh dấu command terminal trước khi payment fact durable. Hai thiết kế an toàn: (a) lưu authoritative provider-result snapshot/outbox trong transaction hoàn tất command rồi để consumer idempotent apply; hoặc (b) giữ command ở trạng thái retryable cho đến khi `apply_order_result` commit. Không log raw payment payload/credential.

**Regression bắt buộc.** Inject failure tại required audit/outbox sau provider trả `PAID`; sau rollback phải còn command/event retryable hoặc provider-result snapshot durable. Retry phải tạo đúng một payment transaction, một activation/grant và đúng bộ invoice/audit/outbox.

### BSD-03 — High / release blocker: release mới không thể auto-activate base plan

**Bằng chứng.** Projection khi publish tạo `billing_plan_versions` nhưng không ghi `legacy_package_id`: `backend/commercial_policy/repository.py:277-305`. Cột này nullable trong schema (`backend/db/schema.py:1622-1645`), còn activation bắt buộc nó và chuyển sang `PLAN_PACKAGE_MAPPING_MISSING` nếu null: `backend/billing/activation.py:336-359`. Test activation tự chèn cứng `legacy_package_id='diamond'`: `tests/test_billing_activation.py:93-109`, nên không kiểm tra seam publish→quote→order→paid→activation thật.

**Scenario/impact.** Một release có base-plan offer vượt validation và publish, người dùng checkout/trả tiền, rồi activation luôn vào manual review vì mapping package compatibility không tồn tại.

**Khuyến nghị.** Chủ sản phẩm phải phê duyệt mapping immutable từ commercial offer sang package compatibility; không được tự suy diễn `tier → package`. Ghi mapping trong document/projection hoặc một seam versioned rõ ràng. Validation/publish phải chặn offer sellable nếu mapping được yêu cầu nhưng thiếu, thay vì phát hiện sau khi thu tiền. Đây là thay đổi business contract nên cần ADR, compatibility/migration plan và regression seam.

**Regression bắt buộc.** Publish một document thật có mapping đã duyệt, tạo order từ projected SKU và apply paid result; assert đúng package/benefit. Document thiếu mapping phải fail trước publish/sale.

### BSD-04 — High / release blocker: payOS credential/profile chưa nối vào runtime

**Bằng chứng.** Registry yêu cầu `credential_reference` trong DB và một process-local resolver tại `backend/billing/runtime.py:60-83`. Hàm cấu hình resolver tồn tại ở `backend/billing/runtime.py:87-97`, nhưng không có caller trong repo. Startup chỉ kiểm tra chuỗi env `PAYOS_CREDENTIAL_REFERENCE` tại `backend/commercial_policy/config.py:63-87`; giá trị này không được nối vào registry và không chứng minh DB profile trỏ đến cùng reference. Seed payOS có `credential_reference=NULL`, `mode='shadow'`, `readiness_status='blocked_external'`: `backend/db/upgrades.py:3151-3167`. Projection release cũng không project `providerProfiles` sang `payment_provider_profiles`: `backend/commercial_policy/repository.py:259-363`.

**Scenario/impact.** Deployment có thể qua startup validation nhờ env/reference/attestation, nhưng checkout/worker/webhook vẫn resolve registry mặc định không có secret resolver hoặc không có DB profile ready. Request chết/retry sau khi nhận traffic; webhook có thể trả 503.

**Khuyến nghị.** Xây secret resolver thật tại composition root, chỉ lưu reference trong DB; startup phải resolve thử metadata an toàn và đối chiếu approved DB profile với environment/release. Pin immutable provider profile vào order/release. Không lưu secret trong DB, policy document, response hay log.

**Regression bắt buộc.** Production config + ready payOS profile + fake secret-manager contract phải resolve adapter ở startup. Missing resolver, missing reference hoặc env/DB mismatch phải fail readiness trước nhận traffic. Assert log/error không chứa secret.

### BSD-05 — High có điều kiện / P1: activation bỏ qua transition policy đã pin

**Bằng chứng.** Policy evaluation cho phép `purchase`, `renew`, `upgrade`, `downgrade`, `credit_pack`: `backend/commercial_policy/service.py:62-160`. Nó không ràng buộc operation với item type. Checkout chỉ kiểm tra một chiều “credit-pack SKU phải dùng operation `credit_pack`”, nhưng không cấm base-plan SKU dùng operation `credit_pack`: `backend/billing/service.py:102-129`. Default document ghi upgrade active term là `manual_review` và downgrade là `manual_review`: `backend/commercial_policy/document.py:137-157`. Activation chỉ đọc `baseTerm`; nó review active subscription cho `purchase/renew`, nhưng `upgrade`, `downgrade` và base plan giả danh `credit_pack` rơi qua và overwrite subscription, bắt đầu term mới: `backend/billing/activation.py:348-411`. Ngoài ra expected subscription revision lấy trực tiếp từ body và có thể bỏ trống (`backend/commercial_policy/routes.py:551-587`); activation chỉ so revision khi giá trị này khác null (`backend/billing/activation.py:348-351`).

**Scenario/impact.** Nếu operator chốt base term nhưng vẫn giữ transition manual-review, một paid upgrade/downgrade có thể thay package, starts/expires và quota ngay, trái với immutable policy snapshot. Một client còn có thể mua base-plan SKU với operation `credit_pack` để né nhánh review dành cho active `purchase/renew`, đồng thời bỏ `subscriptionRevision` để vô hiệu optimistic-concurrency guard. Finding này không đề xuất permission mới; nó chỉ chỉ ra runtime không thực thi quyết định đã pin và không capture revision authoritative.

**Khuyến nghị.** Ràng buộc operation↔item type ở một seam server-authoritative; capture current subscription revision trong transaction tạo quote thay vì tin field optional của client. Thực thi transition handler theo `operation × current subscription × pinned transition kind`. Với kind chưa được hỗ trợ, giữ order/payment fact và chuyển review; không tự chọn proration, renewal anchor hay carry-over.

**Regression bắt buộc.** Matrix operation × item type × trạng thái subscription × transition kind. Base-plan + `credit_pack` và credit-pack + operation khác đều bị từ chối trước checkout. `manual_review` không mutate subscription/grant; quote phải pin revision đọc từ DB và activation phải review khi revision đổi.

### BSD-06 — Medium / P1: usage reservation hết lease không có automatic reclaim trong repo/lifecycle

**Bằng chứng.** Reaper có tồn tại (`backend/usage_credits/service.py:314-326`) nhưng không có caller trong repo/lifecycle; startup chỉ tạo các janitor/worker khác ở `backend/lifecycle.py:424-435`. Retry xem mọi reservation `reserved` là hiện hữu mà không xét `lease_expires_at`: `backend/usage_credits/service.py:167-174`.

Có thêm crash window: raw snapshot được commit bởi repository/connection riêng ở `backend/procurement_lookup/routes.py:178-190`, rồi reservation mới consume trong transaction khác ở `backend/procurement_lookup/routes.py:341-361`. Crash giữa hai bước để lại snapshot đã giao và credit vẫn reserved. Lần sau cache hit bỏ qua reservation (`backend/procurement_lookup/routes.py:253-255`), nên không tự hồi phục. Tài liệu nói có “reaper”, nhưng test usage hiện chỉ kiểm tra normalize và blocked partial batch (`tests/test_usage_credit_policy.py:1-42`).

**Scenario/impact.** Worker/request chết sau reserve hoặc sau commit raw snapshot; `usage_credit_grants.reserved` không giảm. Available balance có thể tiếp tục bị khóa cho đến khi có recovery ngoài luồng, hoặc snapshot đã dùng không được debit.

**Khuyến nghị.** Thêm reconciliation/janitor durable có leader lock, reclaim lease hết hạn atomically và reconcile snapshot authoritative với reservation/ledger. Tốt hơn, gắn snapshot commit với debit/outbox bằng một recoverable state machine thay vì hai fire-and-forget transaction.

**Regression bắt buộc.** (1) Reserve→advance clock qua lease→janitor→available phục hồi. (2) Crash sau raw snapshot commit→reconcile consume đúng một credit. (3) Hai janitor đồng thời không double-release.

### BSD-07 — Medium / P1: commercial validation có thể gây CPU/RAM exhaustion hoặc 500

**Bằng chứng.** `_minimum_pack_cost()` cấp list `target + maximum + 1` và chạy dynamic programming theo toàn bộ list: `backend/commercial_policy/document.py:203-214`. `includedProcurementQuota` và credit-pack `quantity` chỉ kiểm tra kiểu/dương, không có computation bound: `backend/commercial_policy/document.py:274-323`. Validation luôn gọi `connected_savings()` khi offers/packs tồn tại, kể cả đã có lỗi integer ở pack: `backend/commercial_policy/document.py:358-367`. Endpoint chạy đồng bộ trong async request và giữ DB transaction: `backend/commercial_policy/routes.py:292-324`.

**Scenario/impact.** Super Admin hoặc client/session bị compromise gửi draft vài trăm byte với quota/quantity rất lớn; validate cố cấp hàng tỷ phần tử hoặc chiếm CPU lâu, làm nghẽn event loop/process và DB connection. Sai kiểu trong pack cũng có thể đi đến `max()`/arithmetic và trả generic 500 thay vì validation error ổn định.

**Khuyến nghị.** Thực hiện structural validation trước simulation; áp computation budget độc lập với business ceiling, dùng thuật toán bounded/closed-form phù hợp số pack nhỏ, và chạy CPU-heavy work ngoài event loop nếu vẫn cần. Business upper bound phải do chủ sản phẩm phê duyệt; computation safety bound không được ngầm biến thành giới hạn gói bán.

**Regression bắt buộc.** Huge/sai kiểu numeric payload trả deterministic 4xx trong time/RSS budget; event-loop lag không vượt ngưỡng; không mở transaction lâu khi computation chưa qua structural gate.

### BSD-08 — Low/Medium / P1: webhook primary key không scoped theo provider profile

**Bằng chứng.** Event ID chỉ lấy 32 hex đầu của raw payload hash: `backend/billing/webhook.py:54-84`; fake checkout dùng cùng pattern tại `backend/billing/routes.py:128-147`. Trong khi dedupe contract là `(provider_profile_id, dedupe_key, payload_hash)`, còn `id` là PK toàn cục: `backend/db/schema.py:1845-1864`.

**Scenario/impact.** Hai immutable provider profile nhận exact same bytes tạo cùng event PK nhưng khác scoped unique key. Trường hợp này cần hai profile cùng chấp nhận payload bytes đó, ví dụ profile version dùng chung credential hoặc fake profiles; vì điều kiện cấu hình hẹp nên severity được hạ từ Medium xuống Low/Medium. Insert thứ hai không match conflict target và có thể `UniqueViolation`→500, không persist event/ACK. Truncating hash còn tạo collision surface không cần thiết.

**Khuyến nghị.** Dùng random event PK, hoặc derive từ profile ID + full payload hash; giữ scoped unique constraint làm idempotency contract.

**Regression bắt buộc.** Cùng raw payload qua hai profile tạo hai event độc lập; replay cùng profile vẫn 202/idempotent; payload cùng identity nhưng khác hash vẫn vào review như contract hiện tại.

### BSD-09 — Medium, conditional release gate / P1: provider environment và checkout TTL không được thực thi

**Bằng chứng.** `_select_provider()` lọc provider/readiness/mode/amount nhưng không lọc `profile.environment` hay release binding: `backend/billing/service.py:345-360`. Profile có `checkout_ttl_seconds` bounded trong schema (`backend/db/schema.py:1686-1705`), nhưng request provider không gửi `expiredAt`: `backend/billing/service.py:166-183`. Completion hard-code fallback `now + 900`: `backend/billing/service.py:460-482`. Query/cancel có thể ghi lại expiry, trong khi payment timing đọc giá trị mutable đó ở `backend/billing/activation.py:503-513`.

**Scenario/impact.** Production process có thể route nhầm profile staging/test nếu cùng provider được marked ready; TTL tùy profile bị bỏ qua. Một query muộn có thể kéo dài `checkout_expires_at`, khiến payment sau expiry gốc bị phân loại on-time thay vì review.

**Khuyến nghị.** Route theo explicit app environment và profile pinned vào release/order; persist original authoritative expiry một lần, gửi `expiredAt` khi provider hỗ trợ, và không cho query/cancel kéo dài expiry gốc. Nếu cần “observed provider expiry”, lưu cột riêng thay vì overwrite invariant.

**Regression bắt buộc.** Staging profile không routable trong prod; custom TTL tồn tại qua create/query/cancel; payment sau original expiry luôn `late_after_expiry`.

### BSD-10 — Low/Medium / P1: fake checkout có authorization/CSRF contract mâu thuẫn

**Bằng chứng.** Route chỉ gate bằng `APP_ENV` mặc định `development` và lookup theo public `profile_id/order_code`, không verify session/owner hay nonce: `backend/billing/routes.py:36-64`. POST có thể complete/cancel/expire và enqueue reconciliation/activation: `backend/billing/routes.py:99-188`. Order code là hash rút xuống số nguyên 31-bit: `backend/billing/service.py:24-28`.

Ngược lại, khi người dùng đã đăng nhập và mở hosted simulator cùng origin, middleware yêu cầu Origin + double-submit CSRF token cho mọi mutating `/api/` request có session cookie: `backend/http_middleware.py:375-409`. `FakeCheckout.js` gửi JSON nhưng không gửi `X-CSRF-Token`: `frontend/billing/FakeCheckout.js:24-29`, `frontend/billing/FakeCheckout.js:48-55`. Vì vậy legitimate signed-in flow có thể 403, trong khi một client không có session và không gửi Origin có thể gọi mutation nếu biết URL.

**Scenario/impact.** Development/test có dữ liệu dùng chung có thể bị HTTP client biết/đoán URL đổi trạng thái order; browser cross-origin có `Origin` lạ vẫn bị middleware chặn, nên đây không phải CSRF browser cổ điển. Đồng thời người mua thử nghiệm đang đăng nhập không bấm được nút vì request có session nhưng thiếu CSRF header. Production config hiện cấm Fake Provider, nên severity được hạ từ Medium xuống Low/Medium và không được mô tả là production auth bypass đang active; `APP_ENV` mặc định development vẫn làm misconfiguration dễ che giấu rủi ro.

**Khuyến nghị.** Chốt rõ simulator authorization contract. Phương án ít gắn với role nhất là checkout URL chứa capability nonce ngẫu nhiên, một lần, hash-at-rest, bound với order/profile/expiry; mutation vẫn kiểm tra Origin và nonce. Nếu chọn session-owner authorization, phải được chủ sản phẩm phê duyệt/ADR vì thay đổi access semantics, và frontend phải dùng shared CSRF client. Production startup tiếp tục fail nếu Fake Provider/payment flags được bật.

**Regression bắt buộc.** Signed-in hosted flow complete thành công với CSRF đúng; missing/wrong nonce không mutate; nonce khác order/profile không dùng được; production/staging trả 404; replay action không double-activate.

### BSD-11 — Medium / P1: tỷ lệ giảm giá ngoài miền lọt qua validation rồi vỡ ở DB

**Bằng chứng.** Validator parse `tyLeGiamGia` bằng `Decimal` và derive `giaSauGiamGia` nhưng không kiểm tra `0 <= rate <= 100`: `backend/sync/payload_validation.py:1179-1192`. DB bắt buộc rate trong `[0,100]` và derived price không âm: `backend/db/schema.py:1219-1235`. Harness read-only xác nhận rate `-1` sinh `giaSauGiamGia='101000'`, rate `101` sinh `'-1000'`, cả hai trả `errors=[]`.

Write path chỉ phát hiện ở DB savepoint rồi sanitize thành generic `SYNC_ITEM_WRITE_FAILED`: `backend/sync/service.py:999-1070`, `backend/sync/public_errors.py:45-53`. Nếu có bất kỳ item error, toàn batch rollback: `backend/sync/service.py:1105-1113`.

**Scenario/impact.** Client lỗi hoặc người dùng nhập payload ngoài miền vượt validation, nhận lỗi generic không chỉ ra field, và toàn batch sync hợp lệ khác bị rollback; retry tự động có thể lặp vô ích. Đây là availability/UX/data-validation bug, không phải bypass DB integrity vì constraint vẫn chặn dữ liệu xấu.

**Khuyến nghị.** Validate finite Decimal và miền `[0,100]` trước derive, chuẩn hóa precision khớp DB (tối đa 4 chữ số thập phân), trả typed field error. Không nới DB constraint.

**Regression bắt buộc.** `-1`, `100.0001`, `101`, NaN/Infinity và malformed string trả 400 field-level error trước write; `0`, `100` và 4-decimal hợp lệ derive chính xác; batch không chạm DB khi validation lỗi.

### BSD-12 — Low/Medium, cần quyết định: `get_balance()` làm mất usage history

**Bằng chứng.** Balance chỉ SUM grant chưa hết hạn và `remaining > 0`: `backend/usage_credits/service.py:41-68`. Khi một grant dùng hết hoặc hết hạn, cả `total` và `remaining` của grant biến mất; phép `used = total - remaining` có thể giảm trở lại 0.

**Impact.** UI/ops có thể hiển thị “đã dùng” sai nếu field được hiểu là usage history. Tuy nhiên nếu API contract chỉ là “current active pool”, behavior có thể có chủ đích. Không được đổi query/test expectation khi semantics chưa được chốt.

**Khuyến nghị cần quyết định chủ sản phẩm.** Tách rõ `activePool` (remaining/reserved/available/next expiry) và lifetime hoặc kỳ usage từ immutable ledger nếu sản phẩm cần history. Ghi ADR/business contract và migration/compatibility impact trước khi đổi response.

**Regression sau khi chốt.** Exhausted/expired/partially-used grants phải cho kết quả đúng theo contract được duyệt; ledger reconciliation bằng tổng grant/reserve/consume/release không lệch.

### BSD-13 — Medium / P1 operability: 30 FK v79 thiếu child-side index thực sự

**Kết quả live audit.** Khi PostgreSQL phục hồi, `python scripts/audit_fk_indexes.py` đọc 201 FK và báo 32 missing. Script lấy `pg_constraint.conkey`, chỉ chấp nhận index valid/ready có toàn bộ FK columns ở left-prefix (`scripts/audit_fk_indexes.py:25-65`); unit test xác nhận thứ tự/prefix contract tại `tests/test_fk_index_audit.py:11-16`. Đây là cách kiểm tra bảo thủ đúng cho FK probe tổng quát, nhưng không chứng minh cả 32 đều gây scan lớn trong workload hiện tại.

Toàn bộ 32 constraint live đều có `confdeltype='r'` (`ON DELETE RESTRICT`) và `confupdtype='a'` (`NO ACTION`); không có `CASCADE` trong danh sách. Vì vậy finding là lock/performance/operability risk khi parent update/delete hoặc khi application query cùng key, không phải data-integrity bypass, tenant leak hay cascade-delete storm. Trên **DB audit cục bộ** tại thời điểm đo, `pg_stat_user_tables.n_live_tup` ước lượng 0 cho các bảng v79; số liệu này không chứng minh staging/production rỗng và có thể trễ so với `COUNT(*)`/`ANALYZE`.

#### Nhóm A — hot path, Medium, tạo index trước traffic

| Child FK | Vì sao nóng | Index hiện hữu có cover? |
|---|---|---|
| `billing_order_items(order_id)` | Activation đọc item theo order ở `backend/billing/activation.py:336-343`; bảng tăng theo mọi order | Không; chỉ có PK `id`. FK/schema ở `backend/db/schema.py:1783-1799` |
| `payment_transactions(order_id)` | Refund/payment history SUM/filter theo order ở `backend/billing/service.py:247-275`; bảng tài chính tăng append-only | Không; unique hiện hữu bắt đầu bằng `(provider_profile_id, provider_transaction_id, transaction_type)`, không dùng được cho `order_id`. Schema ở `backend/db/schema.py:1822-1843` |
| `commercial_release_timeline(release_id)` | Effective-release và checkout chạy correlated `NOT EXISTS timeline.release_id = ...` ở `backend/commercial_policy/repository.py:170-188` và `backend/billing/service.py:110-118` | Không; `idx_commercial_timeline_effective(scope_key,effective_at)` bắt đầu sai cột (`backend/db/upgrades.py:3006-3009`). FK ở `backend/db/schema.py:1589-1604` |

Index đề xuất về hình dạng: `(order_id)`, `(order_id, transaction_type)` nếu muốn cover refund query, và `(release_id, effective_at, event_type)` hoặc tối thiểu `(release_id)`. Chọn suffix dựa trên `EXPLAIN (ANALYZE, BUFFERS)` với cardinality đại diện; không tạo hai index khi một composite left-prefix đã cover.

#### Nhóm B — bảng tăng theo giao dịch/reconciliation, Medium→Low tùy retention

- `billing_invoice_requests(payment_transaction_id)`.
- `usage_credit_grants(order_item_id)` và `(release_id)`.
- `usage_ledger(grant_id)` và `(reservation_id)`; ledger là append-only/immutable, schema tại `backend/db/schema.py:1956-1970`, write seam tại `backend/usage_credits/service.py:389-397`.
- `usage_reservations(account_user_id)` và composite `(organization_id, grant_id)`; lease index hiện hữu bắt đầu bằng `(state, lease_expires_at)`, còn identity indexes bắt đầu bằng owner/expressions nên không cover hai FK này. Schema tại `backend/db/schema.py:1930-1954`.

Các index owner/expiry hiện hữu của grant và lease hiện hữu vẫn tốt cho balance/reaper (`backend/db/upgrades.py:3017-3023`), nhưng không thay thế FK indexes trên provenance keys. Ưu tiên nhóm này cùng BSD-06 vì reconciliation/ops sẽ cần lookup theo grant/reservation/payment identity khi dữ liệu bắt đầu lớn.

#### Nhóm C — immutable catalog/provenance hoặc parent lifecycle hiếm, Low

- Subscription/provenance: `account_subscriptions(plan_version_id)`, `account_subscriptions(source_order_id)`, `organization_subscriptions(plan_version_id)`.
- Catalog graph: `billing_plan_versions(legacy_package_id)`, `billing_skus(plan_version_id)`, `billing_prices(sku_id)`, `billing_quotes(release_id)`, `billing_orders(release_id)`, ba FK còn lại của `billing_order_items(sku_id, plan_version_id, price_id)`, `commercial_drafts(base_release_id)`, `commercial_releases(base_release_id)`.
- Actor/account provenance: `billing_quotes(actor_user_id)`, `billing_quotes(account_user_id)`, `billing_refund_intents(actor_user_id)`, `commercial_drafts(created_by)`, `commercial_drafts(updated_by)`, `commercial_release_timeline(actor_user_id)`, `commercial_releases(published_by)`.

Existing release-first indexes cover các query có cả release: ví dụ unique `billing_prices(release_id, sku_id, period)` hỗ trợ checkout join tại `backend/billing/service.py:104-120`. Tuy nhiên nó **không** cover PostgreSQL child probe chỉ có `sku_id` khi xóa/update parent SKU. Vì releases/plans/SKUs và audit actors được thiết kế immutable/RESTRICT và hiện không có delete workflow, nhóm này không phải hot-path blocker. Có thể tạo index trước khi cardinality lớn, hoặc ghi waiver có owner/review date thay vì thêm write amplification không đo lường.

#### Hai effective false positives — không cần index mới chỉ để thỏa script

1. Live composite FK `billing_orders(organization_id, quote_id) → billing_quotes(organization_id, id)` bị flag, nhưng `billing_orders.quote_id` đã `NOT NULL UNIQUE` (`backend/db/schema.py:1741-1743`). Probe với hai predicates dùng unique `quote_id` và chạm tối đa một child row; thêm `(organization_id,quote_id)` chỉ trùng chức năng.
2. Live composite FK `organization_subscriptions(organization_id, source_order_id) → billing_orders(organization_id,id)` bị flag, nhưng child PK là `organization_id` (`backend/db/schema.py:1501-1521`). Probe theo hai columns chạm tối đa một subscription row.

Hàm audit cố ý chỉ nhận full FK left-prefix nên không nhận ra unique subset có selectivity tuyệt đối. Nếu dùng script làm CI gate, nên mở rộng checker để coi valid non-partial unique index trên một tập con `NOT NULL` của FK columns là effective cover, hoặc allowlist chính xác hai constraint kèm rationale. Không nên tắt audit toàn cục.

**Severity.** Medium tổng thể: ba hot query sẽ suy giảm tuyến tính theo bảng và missing FK indexes làm parent RESTRICT checks giữ lock lâu khi dữ liệu tăng. Không nâng High vì không có cascade, DB audit cục bộ chưa có v79 rows theo thống kê tại thời điểm đo, production payment còn off và không có bằng chứng integrity/auth bypass.

**Migration recommendation.** Thêm index vào schema source + migration additive + generated PostgreSQL contract; không sửa trực tiếp contract JSON. Với bảng đã lớn, dùng `CREATE INDEX CONCURRENTLY` ngoài transaction migration, kiểm tra `indisvalid/indisready`, rồi deploy code/CI gate. Chỉ dùng migration index ngắn khi preflight trên target DB xác nhận bảng còn nhỏ/rỗng. Triển khai nhóm A trước, nhóm B theo reconciliation roadmap, nhóm C theo cardinality/parent lifecycle hoặc documented waiver. Trước mỗi index composite, so overlap bằng `pg_index` và workload stats để tránh index thừa.

**Regression/test recommendation.** (1) Fresh DB và upgrade v79→next xuất riêng `rawMissing`, `waived` và đạt `unexplainedMissing=[]`: mọi thiếu thật ở nhóm A/B/C có index hoặc waiver riêng với rationale/owner/review date; hai effective false positive được checker nhận đúng hoặc allowlist chính xác. (2) Unit test checker chỉ nhận valid, non-partial unique subset trên các FK column phù hợp và có ràng buộc `NOT NULL`; expression/invalid index và sai column order không được coi là cover. (3) `EXPLAIN (ANALYZE, BUFFERS)` fixtures có cardinality đại diện xác nhận Group A dùng Index Scan/Bitmap Index Scan cho activation, refund và effective-release query. (4) Migration test xác nhận index tồn tại/valid trên fresh + upgrade chain; rollback/failure không để invalid index bị coi là cover.

### BSD-14 — Low/Medium / P1, Windows-conditional: Word export cache lock race

**Bằng chứng.** `acquire_standardized_template_cache()` gọi `_acquire_lock()`; vòng lặp chỉ bắt `FileExistsError` (`backend/documents/word_export_cache.py:112-139`). Khi một thread khác vừa đóng descriptor và `unlink()` lock, Windows có thể trả `PermissionError [Errno 13]` cho `os.open(..., O_CREAT|O_EXCL|O_WRONLY)` thay vì `FileExistsError`. Test single-flight chính thức chạy đơn lẻ thường pass, nhưng các vòng lặp cạnh tranh riêng trên Windows quan sát failure không ổn định (`2/100` và `3/30`). Instrumented run `300` cache root mới × 4 thread ghi nhận `4` PermissionError, đều overlap owner unlink 0,146–1,569 ms; probe lock chỉ đang tồn tại/mở trả `FileExistsError` `20.000/20.000` lần. Đây là race `CreateNew`/unlink, không phải bằng chứng ACL hỏng hay antivirus.

**Impact.** Cache là tối ưu hóa nhưng lỗi xảy ra ở bước acquire trước khi render; document worker có thể làm job/request thất bại khi nhiều worker chuẩn hóa cùng source trên Windows. Không suy ra tỷ lệ production từ các vòng lặp cục bộ; cần xác minh trên OS/runtime triển khai.

**Khuyến nghị.** Bắt và phân loại hẹp lỗi access-denied/share tương ứng với lock path đang tồn tại hoặc vừa bị xóa, rồi retry với jitter và deadline hiện có; lỗi ACL/parent directory thật phải vẫn nổi lên hoặc chuyển thành cache miss có telemetry. Cân nhắc named mutex/in-process single-flight kết hợp cross-process lock nếu deployment có nhiều worker. Cache failure không được làm mất một render hợp lệ nếu có thể tiếp tục không cache.

**Regression bắt buộc.** Windows CI với Python runtime được hỗ trợ: ép đồng thời release/unlink và acquire, assert không có `PermissionError`, chỉ một `prepare`, ba caller nhận cache hit; thêm test permission-denied thật không retry quá deadline và test cache miss vẫn render được khi lock subsystem không khả dụng.

## Những điểm đã kiểm tra nhưng không mở lại

- Commercial/payment flags đang off theo tài liệu triển khai; payOS vẫn `BLOCKED_EXTERNAL`. Audit không coi flag-off là remediation cho invariant tài chính, nhưng dùng nó để đánh giá exploitability thực tế.
- Webhook đã verify chữ ký trước persist, có body bound và same-identity/different-payload review; finding BSD-08 chỉ nói về PK scope, không phủ nhận các control này (`backend/billing/webhook.py:18-84`).
- payOS adapter dùng HMAC constant-time, fixed API origin, HTTPS callback và checkout host allowlist (`backend/billing/providers/payos.py:59-95`, `backend/billing/providers/payos.py:120-208`).
- Billing personal reads vẫn bind exact account; organization history còn `BLOCKED_DECISION`. Audit không đề xuất tự mở hoặc tự thu hẹp quyền đó.
- Các finding đã ghi là “đã khắc phục” trong audit 2026-08-25 không được lặp lại như lỗi đang mở.

## Pass kiểm chứng false-positive và severity

- **Giữ High cho BSD-01/02.** Unique constraint không đủ bảo vệ vì control flow vẫn activation sau `DO NOTHING`; còn Transaction B failure thực sự để command `completed` + order `unverified`, ngoài cả hai selector của worker. Đây là invariant tài chính, không phụ thuộc attacker trực tiếp forge webhook.
- **Giữ release/integration blocker cho BSD-03/04.** Flag-off giảm exploitability hiện tại nhưng không sửa publish→activation mapping hoặc runtime secret/profile composition. Không được bật pilot trước khi hai seam này có E2E test.
- **Giữ BSD-05/09 là conditional pre-pilot gate.** BSD-05 có impact High khi reachable vì operation/item-type check bất đối xứng và revision do client tùy chọn; BSD-09 là Medium routing/TTL correctness. Cả hai phải đóng trước activation pilot khi flags tương ứng được bật.
- **Hạ BSD-08 xuống Low/Medium.** Xung đột cần hai profile cùng verify exact payload bytes; không phải mọi multi-profile deployment đều gặp.
- **Hạ BSD-10 xuống Low/Medium.** Route bị hard-gate development/test và Origin lạ vẫn bị chặn. Lỗi còn lại là bearer identity entropy/contract và signed-in simulator thiếu CSRF header, không phải production CSRF bypass.
- **Ngoài billing**, pass này giữ BSD-11 và BSD-14 là gap có reproduction/harness cụ thể. Không thêm finding suy đoán từ pattern scan; retention cleanup không phải false positive mới vì các helper commit từng bounded batch (`backend/lifecycle.py:119-192`) và session advisory lock có chủ ý sống qua các commit.

## Code hygiene được xác nhận trong phạm vi backend

- Lệnh `python -m ruff check backend --select F401,F811,F841 --output-format concise` tìm một lỗi chắc chắn ngoài security findings: `import contextlib` bị lặp tại `backend/app.py:34,1247` (F811; gate mặc định chưa bật). Có thể bỏ import thứ hai và bật rule trong CI sau khi chạy import/startup tests.
- Không có Vulture/dead-symbol scanner được pin trong repo. Các private symbol chỉ thấy ở definition phải qua characterization test và kiểm tra registration/dynamic lookup trước khi xóa; audit này không tuyên bố backend dead code đã được chứng minh exhaustive.
- Duplicate helper candidates (env-bound parser, auth rate-limit adapter, province gateway) nên gom sau khi khóa default/error semantics bằng golden tests; đây là refactor giảm drift, không phải thay đổi quyền hay visibility.

## Kết quả kiểm tra

| Check | Kết quả |
|---|---|
| `python -m pytest tests/test_billing_activation.py tests/test_usage_credit_policy.py tests/test_commercial_runtime_config.py tests/test_commercial_policy_document.py -q` | `12 passed, 8 skipped` trong `240.84s` |
| `python -m pytest tests/test_postgres_schema_contract.py tests/test_postgres_migration_chain.py tests/test_fk_index_audit.py -q` | `20 passed, 24 skipped` trong `122.24s` |
| `python -m pytest tests/test_usage_credit_policy.py tests/test_commercial_policy_document.py tests/test_commercial_runtime_config.py -q` | Pass kiểm chứng cuối: `12 passed` trong `0.09s` |
| `python -m pytest tests/test_payment_providers.py tests/test_auth_cookie_policy.py tests/test_csrf_origin_policy.py -q` | Pass kiểm chứng provider/CSRF: `21 passed` trong `0.41s` |
| `python scripts/audit_fk_indexes.py` sau khi PostgreSQL phục hồi | Exit `1`: `foreignKeyCount=201`, `missing=32`; audit chi tiết xác định 30 thiếu thực, 2 effective false positives |
| `python -m pytest tests/test_fk_index_audit.py -q` | `2 passed` trong `0.15s` |
| `python -m pytest tests/test_postgres_schema_contract.py -q` | Final isolated rerun sau restore: `28 passed` trong `8.94s` |
| `python -m pytest -q -k "not test_transport_ignores_ambient_proxy_environment"` sau khi PostgreSQL sẵn sàng | `1 failed, 1879 passed, 1 deselected` trong `1823.93s`; không còn failure PostgreSQL, failure còn lại ở Word export cache single-flight trên Windows |
| Harness `validate_sync_item` cho discount rate | Tái hiện `-1 → 101000/errors=[]`, `101 → -1000/errors=[]` |
| Reproduction rollback-only cross-order transaction | Không chạy được do PostgreSQL pool connection timeout trong lúc full suite khác đang chiếm DB; finding BSD-01 vẫn được xác nhận trực tiếp từ insert-conflict/control-flow/unique constraint |
| `python scripts/audit_fk_indexes.py` — lần đầu khi full suite còn chiếm/đã làm dừng PostgreSQL | Không hoàn tất do connection timeout; kết quả này đã được thay thế bởi live audit thành công ở dòng trên |

Các skipped ở những run targeted ban đầu chủ yếu là test cần PostgreSQL khi test DB không cấp connection ổn định. Các lệnh timeout ban đầu không được dùng làm kết luận. Một lần vô tình chạy chồng hai process schema/migration trên cùng test DB tạo deadlock catalog nên cũng bị loại khỏi kết luận; sau restore, schema-contract chạy cô lập lại đạt `28 passed` và FK audit lặp lại đúng 201/32. Run rộng không còn failure PostgreSQL nhưng vẫn chưa xanh vì Word export cache single-flight. Worktree sạch trước khi tạo báo cáo này.

Harness read-only cuối cùng đã chạy đúng lệnh sau và không ghi file/DB:

```powershell
@'
from backend.sync.payload_validation import validate_sync_item
cases = (-1, 0, 100, 100.0001, 101, 'NaN', 'Infinity', 'abc')
for rate in cases:
    item, errors, _ = validate_sync_item(
        'thong_tin_mo_thau',
        {'giaDuThau': '100000', 'tyLeGiamGia': rate},
    )
    print(repr(rate), repr(item.get('giaSauGiamGia')), len(errors))
'@ | python -X utf8 -
```

Kết quả đáng chú ý: `-1`, `100.0001` và `101` đều có `0` validation error; `101` derive `-1000`. `NaN`, `Infinity` và chuỗi sai định dạng có một error, nên finding được giới hạn chính xác ở range/precision validation chứ không nói parser chấp nhận mọi Decimal bất thường.

## Lộ trình remediation đề xuất

### Pre-pilot launch gates — gồm P0, release blocker và conditional P1

1. Sửa invariant transaction ownership BSD-01 và race tests.
2. Làm provider paid fact/retry durable theo BSD-02; thêm fault injection.
3. Chặn publish/sale nếu thiếu mapping đã được chủ sản phẩm duyệt (BSD-03).
4. Hoàn thiện composition/startup verification của secret resolver/profile (BSD-04).
5. Thực thi transition state machine theo pinned policy và provider environment/TTL (BSD-05/09) trước khi bật các flag tương ứng.
6. Chạy lại PostgreSQL integration suite, cross-order concurrency reproduction và FK audit trong DB riêng, không dùng chung với full suite.

### P1 — trước shadow/pilot có người dùng thật

1. Thêm usage reconciliation/reaper và crash-window tests (BSD-06).
2. Bound commercial validation và tách CPU work khỏi async transaction (BSD-07).
3. Sửa webhook event identity và fake simulator contract (BSD-08/10).
4. Sửa discount field validation ở seam sync (BSD-11).
5. Sửa Windows lock-race của Word export cache hoặc chuyển cache failure thành cache miss an toàn (BSD-14).

### P2 — observability/refactor có kiểm soát

1. Sau khi chủ sản phẩm chốt, tách active balance khỏi usage history (BSD-12).
2. Gom payment-evidence ingestion của webhook/query/fake thành một deep module duy nhất: verify identity→persist fact→classify timing→activation/outbox, giảm code lặp và tránh hai path lệch invariant.
3. Gom provider selection/profile binding/expiry thành một immutable runtime contract; route/service không tự dựng fallback riêng.
4. Biến reservation/snapshot/debit thành state machine/outbox có reconciliation, thay vì coordination ngầm qua nhiều connection.
5. Mỗi thay đổi chạm quyền/visibility/transition/package mapping phải đi qua ADR/business-contract gate; không “sửa expected value” để hợp thức hóa semantics chưa duyệt.

## Tiêu chí đóng audit

- Không còn cách dùng một provider transaction cho hai order, kể cả race hai worker.
- Mọi provider result terminal đều có durable fact hoặc durable retry trước khi command terminal.
- Publish-to-activation E2E qua projection thật, không dùng fixture tự chèn mapping.
- Startup production chứng minh được provider profile/environment/credential resolver tương thích trước readiness.
- Usage lease và snapshot/debit crash đều tự reconcile exactly once.
- Commercial/sync invalid input trả typed bounded 4xx, không OOM, không generic DB error.
- Word cache concurrent acquire/release không ném `PermissionError` trên Windows; cache subsystem lỗi không làm mất render hợp lệ.
- Regression suite chứng minh tenant/session/module/assignment/record contract và full-record visibility không đổi.
