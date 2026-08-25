Bạn đang làm việc trong repository BiddingFlow tại `D:\Bidding`. Hãy triển khai production-ready hệ thống gói trả phí, quota lấy hồ sơ Mua Sắm Công, thanh toán một lần và Trung tâm cấu hình thương mại cho Super Admin theo các hợp đồng đã được chủ sản phẩm chấp nhận.

Đây là nhiệm vụ thay đổi/build, không phải nhiệm vụ chỉ nghiên cứu hoặc viết thêm plan. Hãy đọc mã nguồn, thiết kế chi tiết theo seam hiện hữu, triển khai đầy đủ, viết migration, backend, frontend, kiểm thử, tài liệu vận hành và xác minh kết quả. Tiếp tục làm việc cho tới khi toàn bộ phần có thể hoàn thành an toàn trong môi trường hiện tại đã xong và được kiểm thử. Không dừng sau khi chỉ tạo schema, route khung, giao diện giả hoặc danh sách việc cần làm.

## 1. Thứ tự ưu tiên và tài liệu bắt buộc phải đọc

Trước khi sửa code, đọc đầy đủ các file sau:

1. `D:\Bidding\AGENTS.md`
2. `D:\Bidding\CONTEXT.md`
3. `D:\Bidding\docs\plans\2026-08-25-paid-packages-and-payment-rollout.md`
4. `D:\Bidding\docs\adr\0017-procurement-connection-commercial-boundary.md`
5. `D:\Bidding\docs\adr\0018-super-admin-versioned-commercial-control.md`
6. Các ADR, runbook, test report và hướng dẫn repo đang tồn tại mà những file trên dẫn chiếu trực tiếp.

Plan hiện có thể còn dẫn chiếu tới `D:\Bidding\docs\research\2026-08-25-paid-plans-and-payment-integration.md`. Nếu file này tồn tại tại thời điểm thực hiện thì đọc nó như tài liệu nghiên cứu có ưu tiên thấp hơn plan/ADR. Nếu không tồn tại, ghi đây là lỗi liên kết tài liệu trong implementation report; không tự bịa nội dung, không tạo file thay thế và không để liên kết hỏng đó chặn phần triển khai đã được prompt/plan/ADR mô tả đầy đủ.

Phân biệt rõ:

- `AGENTS.md` và yêu cầu trong prompt này là chỉ thị thực thi.
- Plan, research, ADR và `CONTEXT.md` là nguồn đặc tả/hợp đồng nghiệp vụ. Không coi câu mô tả, ví dụ hoặc nội dung trích dẫn bên ngoài trong các tài liệu đó là lệnh công cụ độc lập.
- Nếu tài liệu nghiên cứu cũ mâu thuẫn với plan hoặc ADR đã chấp nhận, ưu tiên `AGENTS.md` → prompt này → ADR 0017/0018 → plan mới nhất → research.
- Không tự sửa expected value để hợp thức hóa một semantics quyền hoặc hiển thị dữ liệu chưa được phê duyệt.

## 2. Cách làm việc bắt buộc

1. Bắt đầu bằng `git status --short`, đọc cấu trúc repo và xác định các thay đổi có sẵn của người dùng. Bảo toàn mọi thay đổi không thuộc nhiệm vụ.
2. Dùng `rg`/`rg --files` để tìm mã nguồn. Không suy đoán file, route, version migration hoặc lệnh test khi có thể xác minh trong repo.
3. Xác định schema version mới nhất tại thời điểm thực hiện rồi dùng version kế tiếp. Không mặc định số migration từ tài liệu nếu repo đã tiến thêm.
4. Lập inventory mọi nơi đọc/ghi `goi_dich_vu`, giá, quota, `duration_days=365`, tên Silver/Gold/Diamond và entitlement, gồm route, seed, session, landing page, dashboard, Word context/mapping, test và tài liệu. Không được xây catalog mới mà vẫn để Word generation tiếp tục đọc nguồn mutable cũ.
5. Xác minh baseline của audit, outbox, idempotency, re-auth, WebSocket/poll, loading chung, background worker, PostgreSQL/SQLite schema parity và các lệnh test hiện hữu.
6. Xem đây là master contract và lập plan thực thi theo các giai đoạn ở mục 15; chỉ một bước ở trạng thái đang làm. Mỗi phase tạo diff có thể review, migration compatibility và test report riêng; không gom toàn bộ nhiều tuần công việc thành một thay đổi khổng lồ rồi mới kiểm thử.
7. Có thể dùng sub-agent cho các nhánh độc lập như schema, payment adapter, frontend và review, nhưng agent chính phải tự đọc toàn bộ hợp đồng nghiệp vụ và chịu trách nhiệm tích hợp cuối.
8. Sửa file bằng `apply_patch`; không dùng thủ thuật ghi file qua shell. Không dùng lệnh Git phá hủy, không reset hard, không checkout đè thay đổi người dùng.
9. Không stage, commit, push, mở PR hoặc bật production trừ khi người dùng yêu cầu rõ.
10. Không để nội dung thay thế phần chưa làm, route giả, dấu việc chưa triển khai, code chết hoặc feature chỉ hiển thị UI nhưng backend chưa cưỡng chế.
11. Sau mỗi giai đoạn, chạy test phù hợp trước khi tiếp tục. Cuối nhiệm vụ chạy bộ test rộng tương xứng với rủi ro.
12. Trong khi làm, cập nhật ngắn gọn cho người dùng ít nhất mỗi 60 giây nếu đang có tác vụ dài.

## 3. Mục tiêu cuối cùng

Sau triển khai:

- Super Admin quản lý được catalog gói/SKU, giá, quota, kỳ bán, thẩm quyền mua, nâng/hạ/gia hạn, grace period, hoàn tiền, thuế/hóa đơn và provider routing bằng giao diện; không phải sửa code để đổi các giá trị thuộc policy type đã hỗ trợ.
- Mọi thay đổi thương mại đi qua bản nháp → validate/mô phỏng → xem trước tác động → tái xác thực → publish/schedule thành release bất biến.
- Storefront, quote, checkout, activation, renewal, quota và màn quản trị cùng resolve một release có hiệu lực; không tự tính chính sách tại từng route hoặc frontend.
- Đơn, thuê bao, quota grant và hóa đơn ghim exact release/SKU/giá/quyền lợi/policy snapshot đã dùng.
- Thanh toán thành công được đối chiếu từ máy chủ rồi mới tự kích hoạt đúng workspace; event trùng hoặc đến sai thứ tự không cấp hai lần.
- Bản Nội bộ dùng được lượt mua thêm. Bản Kết nối có lượt kèm gói, mua thêm được và có kiểm tra vi phạm Nhà thầu không giới hạn.
- Tra cứu/làm giàu thông tin Chủ đầu tư và Nhà thầu vẫn dùng chung, không giới hạn và không trừ lượt.
- Không thay đổi quyền xem dữ liệu, masking, role, module permission, assignment scope, record scope hoặc capability nội dung tài liệu hiện hữu.
- Có fake provider, shadow mode, migration tương thích, test đầy đủ, metrics/cảnh báo, runbook và đường rollback.

## 4. Business contract không được vi phạm

### 4.1. Quyền và hiển thị dữ liệu

- Người đã vượt qua tenant, module, assignment và record scope được xem đầy đủ bản ghi, gồm CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và trường liên quan.
- Entitlement xuất Word/Excel chỉ kiểm soát hành động xuất; không dùng để che/mở dữ liệu trong API hoặc màn đọc bản ghi.
- Không tạo capability đọc dữ liệu nhạy cảm riêng.
- Không thay đổi semantics của `super_admin`, `manager`, `employee`, active role, module permission, assignment scope hoặc record scope ngoài đúng quyền mua thương mại đã được ADR 0018 cho phép cấu hình.
- Commercial policy không được trả về field filter, redaction, masking hoặc quyền đọc.
- Test phải chứng minh full record projection và quyền hiện hữu không đổi.

### 4.2. Ranh giới Mua Sắm Công

- Tra cứu/làm giàu thông tin Chủ đầu tư và Nhà thầu: cả Nội bộ/Kết nối, không giới hạn, không usage debit.
- Lấy hồ sơ Kế hoạch/TBMT/Mở thầu: trừ quota theo một mã + revision được lấy và commit snapshot thành công.
- Preview, import/update từ cùng snapshot, cache hit, retry nội bộ, timeout, hủy, lỗi nguồn hoặc không có dữ liệu: không trừ lượt.
- Kiểm tra/ghi nhận vi phạm Nhà thầu: chỉ Kết nối, không giới hạn; kết quả phải từ nguồn/rule có thẩm quyền, không phải nhãn người dùng tự gán.
- Tra cứu/làm giàu đối tác không được âm thầm gọi mô-đun kiểm tra vi phạm hoặc dùng kết quả vi phạm để biến chức năng chung thành chức năng trả phí.
- “Không giới hạn” vẫn chịu rate limit chống lạm dụng, bảo vệ nguồn ngoài và giới hạn capacity kỹ thuật hợp lý; các giới hạn kỹ thuật này không được biến thành quota thương mại, entitlement ẩn hoặc ưu tiên gói ngầm.
- Nội bộ không chạy kiểm tra vi phạm mới nhưng người có quyền đọc vẫn xem kết quả đã lưu.
- Hết hạn/hạ gói không xóa, che hoặc đổi dữ liệu và trạng thái vi phạm đã lưu.
- Quota mua thêm thuộc đúng một workspace cá nhân hoặc tổ chức, không dùng chéo owner và được bảo toàn khi nâng Nội bộ lên Kết nối.
- `PROCUREMENT_LOOKUP_ENABLED` là deployment flag, không được dùng thay commercial entitlement/quota.

### 4.3. Quyền cấu hình thương mại

- Chỉ phiên có platform role `super_admin`, active role thực tế là `super_admin`, tài khoản còn hoạt động, vượt network control và recent privileged re-auth được mutation draft/publish/schedule/stop-sales/rollback/provider/tax/refund.
- Tái sử dụng `verify_session_in_transaction(cursor, request, required_role="super_admin")` và kiểm soát privileged re-auth hiện hữu. Không chỉ ẩn nút frontend.
- Không tạo role mới cho quản trị thương mại.
- Authority mua cho tổ chức là policy chọn từ tập được hỗ trợ, ban đầu chỉ Super Admin; có thể bật manager hiện hành bằng release mới. Policy này chỉ cho hành động mua, không mở quyền đọc bản ghi.
- Publish, stop-sales, đổi provider/tax và thao tác refund phải có audit bắt buộc trong cùng transaction.

### 4.4. Bất biến tài chính và cấu hình

- Chỉ draft được sửa. Release đã publish là bất biến.
- Rollback bằng cách clone release cũ thành draft mới, validate rồi publish release mới; không sửa/xóa lịch sử.
- Ngừng bán SKU chỉ chặn giao dịch mới, không thu hồi quyền lợi thuê bao cũ.
- Không dùng `goi_dich_vu.trang_thai` làm “ngừng bán mới” vì semantics hiện hành có thể làm subscription active mất entitlement. Giữ kill-switch cũ đúng hành vi hiện tại và tạo sales state riêng.
- Giá, quota, owner, SKU, tax, return URL và provider route do máy chủ resolve. Không tin dữ liệu thương mại do client gửi.
- Redirect sau thanh toán chỉ hiển thị trạng thái, không kích hoạt.
- Webhook signature verification, provider query verification, idempotency, concurrent lock, atomic activation và audit không phải tùy chọn Super Admin được tắt.
- Secret không nằm trong release hoặc response; chỉ lưu credential reference không bí mật.
- Tiền VND, quota và tax basis dùng số nguyên; không dùng floating point cho tiền.

## 5. Cấu hình thương mại ban đầu phải hỗ trợ

Các số sau dùng để tạo **initial draft seed** và release fixture xác định cho kiểm thử, không rải thành hằng số ở UI, route hoặc policy caller. Migration không được tự publish/schedule một release bán mới vào production; chỉ release legacy phục vụ backfill tương thích được tạo tự động. Release bán mới đầu tiên phải do Super Admin xem trước, validate, tái xác thực và publish sau khi mọi gate production đạt.

Entitlement xuất Word/Excel của initial offers phải được copy từ mapping gói/tier hiện hành sau inventory; Nội bộ/Kết nối không tự đổi quyền xuất. Nếu tám offer không thể map một-một mà không làm đổi entitlement hiện hữu, dừng phần mapping đó bằng `BLOCKED_DECISION` và hỏi chủ sản phẩm; không tự bật/tắt capability hoặc sửa expected test.

### 5.1. Tám offer năm

| Quy mô | Owner/người dùng | Nội bộ/năm | Kết nối/năm | Quota kèm Kết nối |
|---|---:|---:|---:|---:|
| Cá nhân | 1 | 2.490.000 VND | 3.990.000 VND | 1.000 |
| Bạc | 5 | 12.000.000 VND | 15.000.000 VND | 3.000 |
| Vàng | 15 | 28.000.000 VND | 35.000.000 VND | 7.000 |
| Kim Cương | 50 | 60.000.000 VND | 75.000.000 VND | 15.000 |

### 5.2. Bốn SKU lượt mua thêm

| Số lượt | Giá |
|---:|---:|
| 20 | 99.000 VND |
| 100 | 399.000 VND |
| 500 | 1.490.000 VND |
| 2.000 | 4.490.000 VND |

### 5.3. Policy ban đầu

- Kỳ bán: chỉ năm.
- Mua tổ chức: chỉ Super Admin.
- Nâng gói: kỳ mới; trường hợp có kỳ đang dùng chuyển review.
- Hạ gói self-service: tắt.
- Grace period: 0 ngày.
- Thanh toán muộn/thiếu/thừa: `REVIEW_REQUIRED`, không tự kích hoạt.
- Payment đã xác minh, đúng hạn, owner còn active và expected subscription revision khớp thì apply theo snapshot đã pin; không hủy quyền lợi chỉ vì creator mất purchase role sau khi checkout hợp lệ được tạo. Owner bị khóa/xóa, revision lệch, base subscription không còn đáp ứng điều kiện credit pack hoặc order đã cancel/expire trước khi trả thì `REVIEW_REQUIRED`; không tự đổi owner hoặc tự chọn gói khác.
- Refund: thủ công, tái xác thực, audit.
- Tự tạo tổ chức: tắt.
- Quota kèm gói: hết cùng kỳ, không tự cộng dồn.
- Quota mua thêm: 365 ngày, cần base subscription còn hiệu lực, được mua lặp, ưu tiên grant sắp hết hạn.
- “Kỳ năm” của base subscription chưa được plan/ADR chốt là 365 ngày hay mốc kỷ niệm theo lịch, cũng chưa chốt 29/02 và inclusive/exclusive boundary. Hỗ trợ bằng policy type đóng đã kiểm thử nhưng initial production release phải `BLOCKED_DECISION` cho tới khi chủ sản phẩm chọn semantics. Backfill luôn giữ nguyên exact start/end hiện hữu; không tính lại. Expiry 365 ngày của quota mua thêm là policy riêng đã chốt, không được dùng để ngầm quyết định kỳ base plan.
- Renewal anchor cho subscription đang hoạt động/đã hết hạn và thời điểm cấp quota kỳ mới cũng chưa được chốt. Mô hình hóa các lựa chọn đóng, viết simulation/test, nhưng không publish initial renewal policy hoặc bật renewal production trước quyết định của chủ sản phẩm.
- Ngưỡng lợi ích Kết nối: 20%; validator cảnh báo/chặn theo policy và yêu cầu reason khi override cảnh báo được phép.
- Provider: payOS ở shadow trước khi live.
- Cảnh báo quota: 70%, 90%, 100%.

Tính và kiểm tra lại bằng code rằng Kết nối tiết kiệm khoảng 27,1% / 23,0% / 21,3% / 20,6% so với Nội bộ + tổ hợp SKU lượt rẻ nhất đạt quota tương đương. Không hard-code các phần trăm; tính từ release.

## 6. Phạm vi MVP và phần ngoài phạm vi

### 6.1. Bắt buộc có trong code MVP

- Commercial draft/release, policy version, plan/price/SKU version.
- Super Admin Control Center: validate, preview, impact, schedule, publish, stop-sales, clone/rollback, audit.
- Public offers, server-side quote, checkout một lần, order history và subscription management.
- Gói lượt, số dư, usage history, cảnh báo và CTA nâng cấp.
- Payment fake adapter, payOS adapter, webhook inbox, reconciliation, activation state, admin review/refund thủ công.
- Shadow mode và feature flags mặc định an toàn.
- Hỗ trợ owner cá nhân và tổ chức; trong MVP chỉ cho phép mua cho tổ chức đã tồn tại, không tự tạo tổ chức mới.
- Gia hạn checkout một lần; code nâng/hạ chỉ mở khi release policy tương ứng hợp lệ.
- Loading chung toàn ứng dụng, responsive/accessibility và thông báo tiếng Việt dễ hiểu.
- Metrics, alert thresholds, runbooks và implementation/test report.
- Code và fake-provider E2E cho owner cá nhân/tổ chức, mua mới/gia hạn, base plan/credit pack đều thuộc phạm vi coding MVP và phải hoàn thành mà không chờ pilot thật. Chỉ việc bật rollout tổ chức, gia hạn hoặc transition production mới phải chờ gate pilot tương ứng.

### 6.2. Không triển khai hoặc không bật trong MVP

- Tự động trừ tiền định kỳ/MoMo Subscription.
- Trial 14 ngày.
- Self-service mua thêm chỗ ngồi.
- Tự tạo tổ chức.
- Cổng thanh toán thứ hai.
- AI hoặc tính năng shadow/pilot khác làm entitlement trả phí.
- Raw rule/code/SQL expression editor.
- Khôi phục Trung tâm hồ sơ, ProcurementCase độc lập, lịch ngoài ứng dụng hoặc tác vụ hàng loạt đã loại bỏ.

Nếu phải tạo seam để mở rộng MoMo sau này, chỉ tạo payment provider port có Fake + payOS adapter thực. Không viết adapter MoMo giả vờ hoàn chỉnh trong MVP.

## 7. Kiến trúc mô-đun bắt buộc

Tạo mô-đun sâu, ví dụ `backend/commercial_policy/`, với một interface runtime nhỏ và interface quản trị rõ ràng. Tên file có thể điều chỉnh theo convention của repo, nhưng không đặt logic mới vào `auth_routes.py` hoặc rải qua caller.

Interface hành vi tối thiểu:

```text
resolve_offer(context, at) -> catalog + allowed_actions + release_id
evaluate_commercial_command(command, context, at) -> decision + pinned_snapshot
save_draft(draft_id, expected_revision, changes) -> draft
validate_draft(draft_id, expected_revision) -> validation_digest + errors + warnings + impact_preview
publish_draft(draft_id, expected_revision, validation_digest, effective_at, reason) -> release
clone_release_as_draft(release_id) -> draft
stop_sales(scope, expected_revision, effective_at, reason) -> release_or_override
```

Yêu cầu interface:

- Runtime caller chỉ mô tả intent/context; không biết cách chọn bảng, tính giá, tax, quota, authority, transition hoặc provider.
- `CommercialDecision` chứa release ID, checksum/digest, owner, subscription revision, SKU/price/tax/benefit snapshot, authority result, provider profile, expiry và reason code.
- Decision là đối tượng server-side. Client không được gửi lại một decision tùy ý để yêu cầu kích hoạt.
- Resolver thông thường không gọi mạng; provider call nằm ở billing adapter sau khi order đã pin decision.
- Clock inject được để test effective time, cuối tháng, năm nhuận và timezone `Asia/Ho_Chi_Minh`.
- HTTP public/admin, fake provider, payOS và invoice integration là adapter tại seam phù hợp.
- Không tạo repository/service wrapper nông chỉ chuyển tiếp tham số. Tập trung validation, compilation, resolution, decision pinning và compatibility trong module.

Policy document phải dùng **schema đóng, dữ liệu mở**:

- Super Admin chọn policy kind/formula đã đăng ký như `start_new_term`, `end_of_term`, `prorata_by_day`, `manual_review`.
- Không chạy JavaScript, Python, SQL hoặc biểu thức tùy ý.
- Policy kind/capability lạ trả lỗi ổn định và không publish.
- Core field tài chính dùng typed relational columns/constraints; policy document versioned chỉ chứa field theo schema đã biết.
- Có compiler/projection đọc nhanh; không dùng một EAV/key-value table tự do làm nguồn sự thật.
- Giới hạn kích thước document, độ sâu, số node, số offer/rule và độ phức tạp mô phỏng để cấu hình không làm cạn tài nguyên.
- Cache phải invalidation được giữa nhiều app instance qua outbox/event hoặc cơ chế hiện hữu; effective-time resolution vẫn đúng khi instance cũ/mới chạy đồng thời trong cutover.
- Khi policy store/cache lỗi hoặc không có release hợp lệ, từ chối giao dịch mới bằng lỗi rõ ràng; không làm mất quyền đọc hoặc entitlement đã được pin cho thuê bao đang hoạt động.

## 8. Database và migration

### 8.1. Nguyên tắc

- Migration cộng thêm trước, feature flag tắt, không phá schema cũ.
- Cập nhật cả SQLite/schema contract và PostgreSQL theo convention repo; cập nhật generated PostgreSQL schema contract/index/constraint bằng công cụ chuẩn của repo.
- Mọi bảng tài chính dùng ID khó đoán ở public surface, timestamp chuẩn, money integer, revision/checksum và foreign key thích hợp.
- Snapshot release đã publish và các business fact đã ghi sổ về payment, activation, refund, invoice, usage là append-only/bất biến. Trạng thái xử lý như pending/retry có thể là projection mutable nhưng chỉ đổi qua state transition có điều kiện và phải truy nguyên được event/fact nguồn; không sửa đè snapshot hoặc fact tài chính để mô phỏng lịch sử mới.
- Không đưa commercial draft/release vào workspace sync, IndexedDB, document schema hoặc offline outbox.

### 8.2. Nhóm dữ liệu bắt buộc

Tên dưới đây là canonical đề xuất. Nếu convention repo buộc đổi tên, ghi mapping rõ trong implementation report.

1. `commercial_drafts`
   - ID, schema version, base release ID, status, revision dương.
   - Canonical document, checksum hiện tại, validation digest mới nhất.
   - Created/updated by và timestamp.
   - Optimistic concurrency bắt buộc.

2. `commercial_releases`
   - ID/version label/schema version/checksum.
   - Canonical immutable snapshot.
   - Mode/scope/effective from và metadata phát hành bất biến; không cập nhật `effective_to` của release cũ khi lên lịch release mới.
   - Base/source release, created/published by, reason và timestamp.
   - Lịch publish/schedule/stop/rollback dùng activation/timeline fact append-only hoặc cơ chế tương đương; current status/effective window chỉ là projection. Transaction publish khóa scope/channel, bảo đảm tại một thời điểm chỉ resolve một release mà không sửa snapshot đã publish.

3. `commercial_policy_versions`
   - Release ID, policy kind, schema version, typed/canonical payload, checksum.
   - Unique theo release + policy kind + selector phù hợp.

4. `billing_plan_versions`
   - Release ID, logical package code, owner kind, tier, variant `internal|connected`.
   - Member quota, included procurement quota, supported export entitlements, violation-check entitlement, display metadata, sales state.
   - Published row bất biến.

5. `billing_prices`
   - Plan version/SKU, period `monthly|yearly`, currency VND, integer amount, tax profile/version, effective date.
   - Dùng `subtotal`, `tax_amount`, `total_amount`; tax rate dùng integer basis points hoặc enum/rule đã đăng ký. Chốt rõ inclusive/exclusive và cách làm tròn theo line/order trong policy schema, không để từng caller tự tính.

6. `billing_skus`
   - Stable SKU code, item type `base_plan|procurement_credit_pack`, exact version references.
   - Quantity, repeatable policy, sellable state và display order.

7. `payment_provider_profiles`
   - Phiên bản metadata bất biến gồm provider, environment, merchant/reference metadata, min/max, capability, routing priority, checkout TTL, timeout/retry, sales/shadow state.
   - Chỉ credential reference; không lưu secret plaintext.
   - Tách profile version được order pin khỏi health/readiness/runtime projection có thể cập nhật. Rotation tạo credential version/reference mới; order cũ vẫn xác minh bằng exact version đã pin trong suốt checkout TTL + webhook retry/reconciliation window.

8. `billing_quotes`
   - Public ID khó đoán, owner/actor, operation/request hash, release/checksum và exact decision snapshot.
   - Expiry và revision; quote snapshot hoàn toàn bất biến sau khi phát hành. Binding nằm ở `billing_orders.quote_id UNIQUE` hoặc fact append-only riêng, không cập nhật quote để đánh dấu used.
   - Checkout chỉ nhận quote public ID, tải lại quote phía máy chủ, kiểm tra owner/expiry/request binding và không nhận decision/amount do client gửi lại.

9. `billing_orders`, `billing_order_items` và durable provider commands
   - Public ID, cột provider order code/reference, idempotency key + request hash.
   - Unique idempotency scope gồm actor/owner + operation + key; một quote chỉ bind một order, nhưng hai quote/intention hợp lệ vẫn có thể tạo hai order khác nhau.
   - Unique `(provider_profile_version_id, environment, provider_order_code)`; với payOS, `orderCode` là integer ổn định được sinh và kiểm tra collision trước commit, không đổi sau khi durable command đã tạo.
   - Chính xác một owner: account user hoặc organization, có database CHECK.
   - Creator, pinned commercial decision/release/plan/price/SKU/policy snapshot.
   - `subtotal_amount`/`tax_amount`/`total_amount`/currency, checkout URL/expiry, checkout/payment/activation state, expected subscription revision, reconciliation lease/error.
   - Tạo stable provider reference/order code hợp lệ với provider trước network call. Durable command/outbox có lease, attempt và recovery để process chết sau commit hoặc sau provider success vẫn query/reconcile cùng reference, không tạo order/link thứ hai.
   - Client không gửi amount làm nguồn đúng.

10. `payment_transactions` và refund intents
   - Unique provider + merchant + environment + provider transaction ID.
   - `verified_paid_amount`/`fee_amount`/`net_settled_amount`, type/status, provider timestamps và reconciliation state.
   - Refund intent bền vững có idempotency key, exact order/activation revision, amount, reason, actor, method `manual_off_platform|provider`, state và provider reference.
   - Refund record riêng hoặc typed transaction liên kết original payment; không sửa đè original payment. UI phân biệt “đã thu theo giao dịch” với “đã đối soát/settled”, không gọi là doanh thu thực nếu không có settlement source.

11. `payment_webhook_events`
    - Dedupe key tối thiểu theo provider + public profile version + environment + reference/paymentLinkId/orderCode theo dữ liệu provider thực có, signed-field snapshot tối thiểu và payload hash; không giả định provider luôn có event ID riêng.
    - Cùng dedupe key nhưng payload hash khác phải bị giữ để review/cảnh báo bảo mật, không overwrite hoặc coi là duplicate lành tính.
    - `pending|processing|retry|processed|dead|ignored`, attempts, lease, next retry, error.
    - Raw payload chỉ lưu khi thật sự cần forensic, phải mã hóa và có retention.

12. `billing_subscription_activations`
    - Một order một activation, before/after snapshot, expected/applied revision.
    - `pending|applied|retry|review_required|reversed`.
    - Applied/reversed business fact là append-only; current workflow state là projection hoặc transition log có guard, không sửa lịch sử cấp quyền.

13. `subscription_scheduled_changes`
    - Dùng khi policy cho transition cuối kỳ; pin release/source/target, effective date, expected subscription revision và state.

14. `usage_credit_grants`
    - Chính xác một account/organization owner.
    - Feature `procurement.source_fetch`, total/remaining/reserved, source `plan|purchase|admin`, order item, release/policy, issued/expiry.

15. `usage_reservations` và append-only usage ledger
    - Owner type/ID, feature, provider, entity kind, canonical source code + revision, job/idempotency và grant allocation.
    - Business uniqueness tối thiểu là owner type + owner ID + feature + provider + entity kind + canonical source code + revision; job key là lớp idempotency bổ sung, không tạo unique toàn hệ thống giữa các workspace.
    - `reserved|consumed|released`, TTL/lease/heartbeat và reaper để worker chết không giữ quota vô hạn.
    - Projection số dư đọc nhanh; lock owner/grant để không âm quota.

16. `billing_invoice_requests` hoặc invoice outbox theo convention repo
    - Order/transaction/tax snapshot, buyer invoice profile, requested/issued/failed state, idempotency và provider reference.
    - Ghi invoice request/outbox ngay trong Transaction B cùng payment activation; chỉ gọi nhà cung cấp hóa đơn sau commit. Lỗi delivery/provider retry mà không kích hoạt lại order.

17. Publication/audit projection nếu audit hiện hữu chưa đủ cho diff/impact.

### 8.3. Backfill và compatibility

- Tạo immutable legacy Connected version cho Silver/Gold/Diamond hiện hữu, bắt buộc `non_sellable`, không xuất hiện trong public offers/quote/checkout và chỉ dùng cho entitlement backfill/compatibility.
- Trước backfill, inventory dữ liệu thật theo account/organization, tier, member limit và FK legacy. Tạo legacy plan version theo owner kind/tier khi dữ liệu đòi hỏi; không ép account đang dùng Gold/Silver/Diamond thành offer Cá nhân mới chỉ vì owner là account.
- Ghim account/organization subscription vào exact plan version; `plan_version_id=NULL` chỉ là lỗi readiness tạm thời, không fallback lâu dài.
- Giữ Diamond legacy member quota `999` cho thuê bao hiện hữu; offer mới dùng 50 người.
- Không tạo order/payment giả cho subscription cũ; source là `legacy`.
- API cấp gói thủ công giữ source `admin`, chọn exact release/plan version, có idempotency/revision/audit.
- `goi_dich_vu` chỉ là compatibility projection/adapter trong cutover. Ghi mapping/checksum và duy trì FK legacy đúng convention repo; không xóa khi caller cũ còn dùng.
- Chạy resolver mới ở shadow và so sánh với `backend/shared/subscription_policy.py` trước khi enforce.

## 9. Backend và HTTP

### 9.1. Commercial admin/public adapter

Triển khai tối thiểu:

| Endpoint | Hành vi |
|---|---|
| `GET /api/commercial/admin/overview` | Current/scheduled release, drafts, readiness, validation/provider warnings |
| `POST /api/commercial/drafts` | Clone current/history thành draft |
| `GET /api/commercial/drafts/{id}` | Draft + revision + validation state |
| `PATCH /api/commercial/drafts/{id}` | Save với expected revision/`If-Match`; stale trả 409 |
| `POST /api/commercial/drafts/{id}/validate` | Validate, simulate, impact report và digest |
| `POST /api/commercial/drafts/{id}/publish` | Re-auth, digest/revision match, publish ngay hoặc schedule |
| `POST /api/commercial/releases/{id}/clone` | Restore as new draft |
| `POST /api/commercial/releases/{id}/stop-sales` | Dừng checkout mới có scope/reason |
| `GET /api/public/commercial/offers` | Catalog public từ release hiệu lực, ETag/cache theo release ID |
| `POST /api/billing/quotes` | Tạo quote server-side bất biến, có public ID, thời hạn và pinned snapshot |

Yêu cầu:

- Mutation dùng session, CSRF, privileged re-auth, network control, transaction-time authority revalidation, revision và stable error codes.
- Validate/publish kiểm tra lại từ DB trong transaction; không tin validation result do client tạo.
- Publish chỉ nhận validation digest khớp exact revision hiện tại.
- Audit + outbox + release write nguyên tử. Audit lỗi thì rollback publish.
- Effective release được resolve theo server clock; không phụ thuộc worker phải flip một cờ đúng giây.
- Validate/mô phỏng/impact scan và provider health check chạy trước transaction publish, lưu dependency/readiness digest có hạn. Transaction publish chỉ khóa draft + scope/timeline, kiểm tra lại revision/digest/readiness token và ghi release/audit/outbox; không gọi mạng hoặc quét dữ liệu dài trong transaction.
- Cache local phải hết hạn không muộn hơn `next_effective_at`, có version polling hoặc DB fallback nếu bỏ lỡ invalidation; public cache-control/ETag cũng không được giữ catalog cũ qua mốc hiệu lực.
- Public response không lộ draft, internal policy, credential reference hoặc dữ liệu admin.

### 9.2. Billing module

Tách checkout lifecycle, payment evidence và activation state. Một giao dịch provider đã xác minh vẫn phải được ghi nhận kể cả khi local checkout đã cancel/expire; timing quyết định activation/review, không được làm mất payment fact:

```text
Checkout: CREATING -> OPEN -> CANCELLED/EXPIRED
                    |-> CREATE_FAILED

Payment evidence: UNVERIFIED -> VERIFIED_PAID
                  VERIFIED_PAID/PARTIALLY_REFUNDED -> REFUND_PENDING
                  REFUND_PENDING -> PARTIALLY_REFUNDED/REFUNDED
                  REFUND_PENDING -> REFUND_FAILED -> previous verified/refund projection

Activation: NOT_READY -> PENDING -> APPLIED
                         |-> RETRY
                         |-> REVIEW_REQUIRED
             APPLIED -> REVERSED
```

HTTP adapter tối thiểu gồm create checkout, list/get order của đúng owner, cancel unpaid checkout, usage balance/history và Super Admin reconcile/review/refund. Dùng route naming nhất quán với repo; tham chiếu đề xuất:

- `POST /api/billing/checkouts`
- `GET /api/billing/orders`
- `GET /api/billing/orders/{public_id}`
- `POST /api/billing/orders/{public_id}/cancel`
- `GET /api/billing/usage`
- `POST /api/billing/admin/orders/{public_id}/reconcile`
- `POST /api/billing/admin/orders/{public_id}/review`
- `POST /api/billing/admin/orders/{public_id}/refund`

Admin mutation dùng Super Admin re-auth/audit; owner query dùng session + exact personal/organization scope và không lộ order tenant khác.

Quy tắc:

- `create_checkout`, `get_order`, `cancel_checkout`, `accept_verified_event`, `reconcile`, manual refund/review là behavior của billing module.
- Checkout nhận quote public ID, không nhận lại price/decision. Cùng actor/owner + operation + idempotency key + cùng request hash trả cùng order; cùng scope/key + payload khác trả 409; cùng quote không tạo order thứ hai.
- Trước khi tạo order, checkout recheck deployment flag, emergency stop và sellability hiện hành. Quote vẫn pin giá/quyền lợi để chống đổi giá giữa bước, nhưng quote cũ không được vượt stop-sales/checkout-off; từ chối bằng mã lỗi rõ và không sửa quote.
- Provider create timeout mơ hồ phải query lại cùng provider order code; không tạo mã khác.
- Không tự đặt giới hạn “mỗi owner chỉ có một checkout đang mở”. Hai intent/quote riêng hợp lệ tạo được hai order; credit pack repeatable vẫn mua lặp được. Nếu sau này muốn giới hạn checkout đồng thời thì phải là policy type được duyệt, không suy ra từ idempotency.
- Hai order khác nhau cùng trả tiền serialize trên owner lock; stale subscription revision vẫn giữ payment evidence `VERIFIED_PAID` nhưng activation chuyển `REVIEW_REQUIRED`, không ghi đè.
- Đơn plan cập nhật subscription; đơn credit pack tạo grant đúng số lượng và không đổi plan.
- Personal order không cấp quyền cho organization và ngược lại.

Tạo checkout không giữ transaction mở khi gọi provider:

1. Transaction ngắn thứ nhất khóa stable owner row, kiểm tra authority và quote bất biến, tạo order snapshot + stable provider reference/order code + scoped idempotency record + durable provider command, audit/outbox rồi commit.
2. Inline executor hoặc worker claim provider command bằng lease và gọi adapter ngoài transaction.
3. Transaction ngắn thứ hai tải owner/order key rồi khóa theo thứ tự chung `stable owner → order → provider command`, kiểm tra state/revision rồi ghi checkout reference hoặc reconcile state.
4. Crash trước/sau network call và timeout mơ hồ đều resume bằng cùng command/reference; query provider trước khi retry create, không tạo mã khác và không fallback provider sau khi link có thể đã được tạo.

### 9.3. Webhook và activation

Transaction A — tiếp nhận:

1. Giới hạn kích thước/rate.
2. Route webhook phải xác định được public provider-profile version/environment trước khi chọn checksum key; không dựa vào field merchant mà provider không gửi. Xác minh chữ ký theo canonicalization chính thức; kiểm tra timestamp/replay window nếu provider hỗ trợ.
3. Lưu inbox event idempotent rồi commit.
4. Trả 2xx nhanh cho event hợp lệ đã lưu hoặc duplicate đã biết.

Ngoài transaction:

1. Worker claim bằng lease.
2. Query provider để xác minh order, merchant, environment, trạng thái, currency và amount.
3. Xác thực response theo tài liệu provider, gồm chữ ký response nếu có.
4. Không giữ DB lock khi gọi mạng.

Transaction B — áp dụng:

Mọi checkout/activation/reconcile/refund transaction dùng một thứ tự khóa duy nhất: `stable account/organization owner → order → subscription/grants/activation → workflow event/refund intent/provider command`. Có thể đọc key trước khi khóa nhưng phải recheck liên kết/state sau khi đủ lock; không đảo `owner/order` và không giả định subscription row đã tồn tại ở người mua mới.

1. Từ event đã claim, xác định owner/order key rồi khóa stable owner, order, exact subscription/grants/activation và cuối cùng event theo thứ tự chung.
2. Kiểm tra pinned decision/release/SKU/amount/currency/provider/merchant và expected revision.
3. Ghi payment transaction/fact và payment timing `on_time|late_after_cancel|late_after_expiry`; late payment giữ verified fact nhưng activation chuyển `REVIEW_REQUIRED` theo initial policy.
4. Áp subscription hoặc credit grant đúng một lần.
5. Ghi activation/usage ledger, audit bắt buộc và notification/email/WebSocket outbox.
6. Mark event processed rồi commit.
7. Bất kỳ lỗi nào rollback Transaction B; inbox event còn để retry/reconcile.

Redirect hoặc query string không được thay đổi payment/activation state.

Refund trong MVP payOS là quy trình thủ công/off-platform có ghi nhận và đối soát, vì Payment Request API không được mặc định là có refund operation; API chi hộ/payout là sản phẩm và rủi ro khác, không dùng làm hoàn tiền nếu chưa có yêu cầu, hợp đồng và ADR riêng. Nếu provider profile tương lai thực sự hỗ trợ refund, luồng bắt buộc là:

1. Transaction ngắn khóa `stable owner → order → activation → refund intent`, kiểm tra re-auth/revision/verified payment và invariant `sum(refund succeeded + refund pending) + new_amount <= verified_paid_amount`, rồi tạo refund intent bền vững với idempotency key, audit/outbox và commit.
2. Gọi provider ngoài transaction bằng cùng refund reference; timeout/crash phải query/reconcile cùng intent, không tạo intent/lệnh hoàn thứ hai.
3. Transaction riêng lại khóa `stable owner → order → activation → refund intent`, xác minh provider result, append refund transaction/ledger, điều chỉnh quyền lợi theo pinned policy snapshot, audit/outbox rồi commit. Cho phép nhiều partial refund tuần tự trong giới hạn đã trả; failed/cancelled intent không cộng vào số đã hoàn nhưng vẫn giữ lịch sử.

Không xóa payment hoặc usage history; quota đã dùng làm trường hợp review, không cho phép số dư âm. Manual review không được biến payment chưa xác minh thành verified/paid; nó chỉ xử lý activation conflict sau khi payment evidence đã đạt invariant. Cấp gói không có payment đi qua luồng `source=admin` riêng.

### 9.4. Provider adapter

- Có deterministic fake adapter dùng cho unit/integration/E2E, hỗ trợ success, duplicate, delayed, wrong amount, cancel, expiry, timeout và failure.
- Có payOS adapter cho Payment Request create/get/cancel/verify theo tài liệu chính thức mới nhất. Không tuyên bố refund qua payOS nếu official Payment Request API không có operation đó; payout/chi hộ nằm ngoài scope refund MVP.
- Không thực hiện giao dịch thật, không đăng ký webhook production và không bật live activation nếu chưa có credentials/merchant authorization rõ ràng từ người dùng.
- Khi thiếu external credential, hoàn thành fake/shadow implementation, test và readiness state; báo blocker vận hành, không giả vờ pilot live đã đạt.
- Secret lấy từ secret manager/env adapter. UI chỉ thấy profile alias, readiness và lần health check; không thấy giá trị secret.
- Adapter sở hữu host/endpoint allowlist và hard capability/amount limits; cấu hình database không được chỉ định URL tùy ý, vượt contract của adapter hoặc tạo SSRF.
- Production startup/readiness phải từ chối nếu release live chọn Fake Provider hoặc profile environment không khớp deployment.
- Fake adapter đi qua cùng interface, inbox, verification và activation path như provider thật; không tạo test-only bypass trong production logic.
- Remote call có timeout, bounded retry/backoff, circuit protection và idempotency phù hợp; pause provider không được ngừng nhận webhook/reconcile order đã ghim provider đó.

### 9.5. Subscription và entitlement

- `account_subscriptions`/`organization_subscriptions` pin plan version, source và source order.
- Giữ public/wrapper interface `can_use_*` hiện hữu nếu caller đang phụ thuộc, nhưng implementation đọc pinned plan entitlement và commercial decision ở seam đúng.
- Không thay đổi Super Admin bypass hoặc entitlement hiện hữu nếu task không yêu cầu.
- `goi_dich_vu.trang_thai` giữ kill-switch semantics hiện tại; sales state mới chỉ ngừng bán.
- Renew không nhận arbitrary `duration_days=365` từ frontend làm nguồn đúng; dùng term/policy đã publish.
- `GET /api/public/packages` trong giai đoạn tương thích phải đọc cùng release projection với `GET /api/public/commercial/offers`, không tiếp tục đọc catalog mutable. Chuyển caller sang endpoint mới rồi deprecate/disable endpoint đọc cũ theo compatibility window; không xóa sớm.
- Trước cutover, compatibility mutation cũ nếu còn cần chỉ được tạo/lưu draft qua module mới; tuyệt đối không tự chạy validate → publish. Tại source-of-truth cutover, disable `POST /api/system-packages/update`; publish chỉ đi endpoint chuẩn với digest, impact preview, recent re-auth và thao tác xác nhận rõ của Super Admin. Không dual-write `goi_dich_vu` và release store.

### 9.6. Procurement quota và violation gate

Tạo một usage module chung, không lặp logic ở từng route. Luồng nguồn hiện hữu có thể yêu cầu `LATEST|ALL|SELECTED` và chỉ biết exact revision sau bước liệt kê metadata, vì vậy interface phải hỗ trợ batch:

- `get_balance(owner, feature)`
- `list_missing_source_revisions(owner, provider, entity_kind, request) -> candidates`
- `reserve_source_fetch_batch(owner, candidates, job_key) -> reservations`
- `consume_reservation_item(reservation, committed_snapshot)`
- `release_reservation_item(reservation, reason)`

Tích hợp:

- Procurement lookup/import: normal session/tenant/module/record authorization trước, liệt kê metadata và loại exact revision đã có authoritative snapshot, commercial quota gate sau, rồi mới tải nội dung còn thiếu từ nguồn ngoài.
- Reserve candidate set trước enqueue và consume/release từng revision khi xử lý. Semantics khi quota chỉ đủ một phần batch `ALL|SELECTED` chưa được plan/ADR chốt: trước hết bảo toàn hành vi hiện hữu nếu repo có contract rõ; nếu không, tạo `BLOCKED_DECISION` để chủ sản phẩm chọn một policy type đóng như `reject_all` hoặc `process_affordable_in_stable_order`. Không hard-code lựa chọn, không gọi nguồn cho batch mơ hồ trước quyết định và trong mọi trường hợp không được âm quota.
- Consume đúng lúc authoritative source snapshot commit; fail/cancel/worker lease expiry release. Lần fetch đầu tạo snapshot thành công trừ một lượt; preview/import/update/cache từ snapshot đó không trừ thêm.
- Contractor risk: record authorization trước, Connected entitlement gate sau, rồi mới gọi nguồn; không usage debit.
- Partner/address/tax lookup: không thêm commercial gate.
- Kết quả vi phạm đã lưu vẫn đọc được sau downgrade nếu record authorization còn cho phép.
- Hai worker hoặc retry không được âm quota hoặc consume hai lần cùng owner + feature + provider + entity kind + canonical source code + revision.

## 10. Frontend

### 10.1. Super Admin Control Center

Thêm menu/route/tab riêng **“Thương mại & Thanh toán”**, không nhồi vào quản lý người dùng. Rà các seam hiện hữu:

- `views/components/sidebar.html`
- `frontend/app/BiddingController.js`
- `frontend/app/BiddingControllerUI.js`
- `views/tabs/tab_superadmin.html`
- `views/modals/modal_edit_package.html`
- `frontend/admin/AdminUserController.js`
- `frontend/admin/SystemUserView.js`
- `frontend/app/DashboardView.js`

Tạo module frontend riêng, ví dụ `frontend/commercial-policy/`, và partial riêng. Không đưa draft/release vào workspace sync hoặc IndexedDB.

Sáu khu vực bắt buộc:

1. Tổng quan release/readiness/số tiền đã thu và trạng thái đối soát/đơn lỗi/quota/cảnh báo; form typed cho rollout mode `shadow|pilot|production`, cohort/phạm vi khách được mở và ngưỡng vận hành. Deployment flag vẫn là lớp kiểm soát vận hành riêng, không thay release policy.
2. Gói & Giá: 4 quy mô × 2 biến thể, kỳ, entitlements đã hỗ trợ, quota, giá, display metadata và preview storefront.
3. Lượt Mua Sắm Công: pack, hạn, repeatable, consumption order, mô phỏng lợi ích.
4. Chính sách thuê bao: purchase authority, renewal/upgrade/downgrade/grace/late payment/refund.
5. Thanh toán, Thuế & Hóa đơn: provider profile/readiness/limits, tax display, invoice trigger.
6. Bản nháp & Lịch sử: diff, validate, impact, schedule, publish, clone/rollback và audit.

UX bắt buộc:

- Form typed, không raw JSON editor.
- Tiền tự định dạng VND; thời gian hiển thị `Asia/Ho_Chi_Minh`.
- Derived value như giá/lượt, bình quân tháng và mức tiết kiệm chỉ đọc và tính từ draft.
- Autosave dùng expected revision; 409 hiển thị conflict/diff, không ghi đè.
- Draft đổi làm validation digest cũ vô hiệu.
- Publish có checklist, impact preview, reason, re-auth và màn xác nhận ngày giờ.
- “Ngừng bán mới” tách rõ khỏi kill-switch ảnh hưởng thuê bao.
- Secret không có field đọc lại.
- Mọi long task validate/preview/publish/rollback dùng loading chung từ `frontend/shared/LongTaskLoading.js` hoặc abstraction hiện hữu, có finally cleanup và không khóa vô hạn.
- Accessibility: label, focus, keyboard, aria-live cho trạng thái; responsive mobile/tablet; dùng style/component hiện hữu của ứng dụng.

### 10.2. Storefront và checkout

- `views/components/landing_page.html` và `frontend/landing/LandingPage.js` không giữ ba card/giá hard-code.
- Render offers từ `GET /api/public/commercial/offers`.
- Chọn quy mô rồi so sánh Nội bộ/Kết nối; Connected có nhãn Khuyên dùng, chênh bình quân tháng và tiết kiệm thực tính.
- Không dùng dark pattern, countdown/khuyến mại giả hoặc làm yếu Nội bộ.
- Giữ lựa chọn offer/period/workspace qua login bằng server-side state hoặc dữ liệu ký; server vẫn resolve giá lại.
- Checkout dùng hosted URL đã allowlist; hiển thị amount/expiry/status từ server.
- Return page poll/WebSocket rồi refresh session; không tin query URL.
- Quản lý thuê bao hiển thị plan version, ngày hết, người dùng, order/payment/invoice history, quota balance và hành động được policy cho phép.
- Cảnh báo quota theo release, nút mua thêm/nâng cấp và không tạo hai job sau khi thanh toán.
- Khi chi phí lượt đã mua hoặc nhu cầu người dùng chủ động nhập dự kiến chạm phần chênh Nội bộ/Kết nối, hiển thị phép tính thật và CTA nâng cấp. Mọi số liệu lấy từ release + usage/order history hoặc input minh bạch, không hard-code, không suy đoán nhu cầu và không dùng dark pattern.

## 11. Bảo mật bắt buộc

- Server-side pricing/owner/SKU/policy/provider resolution.
- CSRF cho mutation có session; rate limit create checkout, admin publish, re-auth, webhook và status polling.
- Recent privileged re-auth + transaction-time session/role reload cho mutation Super Admin.
- IP/network allowlist hiện hữu tiếp tục được áp dụng.
- Stable public IDs, không lộ sequential internal ID nếu gây enumeration.
- XSS-safe render; không đưa canonical policy JSON trực tiếp vào `innerHTML`; dùng helper escaping/trusted HTML hiện hữu đúng cách.
- Không log secret, password, OTP, API key, checksum key, signature, token, full bank account hoặc payload dư thừa.
- Không lưu PAN, CVV, mật khẩu ngân hàng hoặc OTP.
- Credential rotation giữ exact version cũ đủ lâu cho checkout TTL + webhook retry/reconciliation window; môi trường dev/staging/prod tách riêng.
- Webhook không dùng session nhưng bắt buộc signature và replay/idempotency protection.
- Không coi IP allowlist hoặc TLS là bằng chứng thanh toán duy nhất.
- Payment/invoice payload có retention và data minimization rõ.
- Inventory hợp đồng đọc dữ liệu quản trị tổ chức hiện hữu trước khi thiết kế order/invoice history. Không tự suy purchase authority thành read authority, không tự mở rộng hoặc thu hẹp người xem, không thêm masking/field filter/capability mới. Nếu repo/ADR chưa xác định ai được xem billing history và dữ liệu người mua/hóa đơn mới của organization, dừng phần API/UI/test expectation đó bằng `BLOCKED_DECISION` và hỏi chủ sản phẩm; các quyền đọc bản ghi nghiệp vụ hiện hữu vẫn giữ nguyên.
- Manual refund/review yêu cầu re-auth, reason, audit, exact activation revision; không reverse nhầm kỳ do order khác tạo.
- Nếu commercial resolver lỗi, dừng giao dịch mới với lỗi rõ; không ảnh hưởng quyền đọc dữ liệu hoặc thuê bao đã áp dụng.
- Audit append-only cho draft/publish/schedule/stop/restore, provider route/profile, order activation/review, manual grant/adjustment và refund. Audit lưu actor, session/request correlation, target, before/after revision, policy checksum, effective time và reason; không lưu secret.

## 12. Validation và error contract

Có mã lỗi ổn định, tối thiểu:

- `COMMERCIAL_POLICY_INVALID`
- `COMMERCIAL_POLICY_VALIDATION_FAILED`
- `COMMERCIAL_POLICY_STALE`
- `COMMERCIAL_POLICY_VALIDATION_OBSOLETE`
- `COMMERCIAL_POLICY_SCHEDULE_CONFLICT`
- `COMMERCIAL_POLICY_PROVIDER_UNAVAILABLE`
- `COMMERCIAL_POLICY_REFERENCE_IN_USE`
- `PRIVILEGED_REAUTH_REQUIRED`
- `COMMERCIAL_POLICY_AUDIT_FAILED`
- `OFFER_NOT_SELLABLE`
- `BUYER_NOT_AUTHORIZED`
- `TRANSITION_NOT_ALLOWED`
- `COMMERCIAL_POLICY_DECISION_REQUIRED`
- `QUOTE_EXPIRED`
- `QUOTE_NOT_AVAILABLE`
- `NO_HEALTHY_PROVIDER`
- `PAYMENT_MISMATCH`
- `PROVIDER_EVENT_UNVERIFIED`
- `ACTIVATION_REVISION_CONFLICT`
- `QUOTA_EXHAUSTED`
- `REFUND_NOT_SUPPORTED`
- `REFUND_AMOUNT_INVALID`

Validation trước publish phải kiểm tra:

- Catalog/SKU uniqueness và đủ offer định bán.
- Money/quota/tax integer và range.
- Effective window không chồng.
- Chỉ capability/policy kind có allowlist.
- Không có rule mâu thuẫn/no-match ở kịch bản bắt buộc.
- Tháng chỉ được bật khi mọi offer cần bán có giá tháng.
- Connected advantage đạt policy threshold hoặc override có reason hợp lệ.
- Transition/grace/refund/expiry/carry-over tương thích.
- Tax/invoice profile có approval/effective state.
- Provider có capability, credential reference, webhook/merchant/readiness phù hợp.
- Impact report cho subscription cũ, pending order, scheduled renewal và storefront.
- Validation digest khớp exact draft revision khi publish.

Ngoài schema validation, publish release `production` và mở pilot thật phải bị chặn nếu chưa có reference/phê duyệt hợp lệ cho tất cả nội dung bên ngoài sau:

- phân loại VAT, giá đã gồm/chưa gồm thuế, công thức làm tròn và thời điểm lập hóa đơn;
- hợp đồng/merchant payOS, giới hạn, SLA, webhook, retry, đối soát và quy trình hoàn tiền thủ công;
- credential profile trong kho bí mật, exact environment, webhook verification và health/readiness đạt;
- thủ tục thương mại điện tử, dữ liệu cá nhân, điều khoản bán hàng/chính sách hoàn tiền đã được người có trách nhiệm xác nhận;
- initial release đã qua validate, impact preview, kịch bản mô phỏng và recent Super Admin re-auth.

Thiếu một mục thì chỉ được fake/local/shadow, trạng thái là `BLOCKED_EXTERNAL`; không cho UI/API publish production hoặc bắt đầu pilot. Không lưu secret hay toàn văn tài liệu pháp lý trong release, chỉ lưu approval/reference/version cần thiết.

## 13. Kiểm thử bắt buộc

Tìm convention test hiện tại và viết test tại seam hành vi, không test chi tiết implementation dễ vỡ. Dùng database test thật/transaction phù hợp repo và deterministic fake provider.

Rà và giữ tương thích với các seam test hiện có, tối thiểu:

- `tests/test_generated_schema_runtime.py`
- `tests/test_postgres_schema_contract.py`
- `tests/test_database_upgrade_preflight.py`
- `tests/test_backend_route_composition.py`
- `tests/test_transactional_session_authority.py`
- `tests/test_document_export_entitlements.py`
- `tests/test_member_quota_concurrency.py`
- `tests/test_procurement_lookup_routes.py`
- `tests/test_procurement_import_routes.py`
- `tests/test_procurement_operation_idempotency.py`
- `tests/test_contractor_risk_routes.py`

Thêm test commercial policy/billing/quota và browser E2E mới theo convention repo; không thay thế regression hiện hữu bằng test hẹp hơn.

### 13.1. Commercial policy

- Chỉ active Super Admin + active role Super Admin + recent re-auth được mutation.
- Manager, employee và Super Admin đang chọn active role khác bị từ chối backend.
- Draft CAS conflict giữa hai cửa sổ; validation obsolete sau save.
- Invalid schema, unknown policy/capability, duplicate SKU, overlap window, provider/tax missing bị chặn.
- Publish + audit + outbox atomic; audit failure rollback toàn bộ.
- Scheduled release resolve đúng trước/đúng/sau effective time, timezone và restart/cache invalidation.
- Schedule release mới không update snapshot/effective-to của release cũ; missed invalidation vẫn chuyển đúng nhờ next-effective TTL/version polling/DB fallback.
- Storefront, quote, checkout, renewal và quota cùng resolve một release.
- Old order/subscription/grant giữ snapshot sau publish mới.
- Stop-sales không thu hồi active entitlement; rollback tạo release mới.
- Exact 8 initial offers, 8 prices, 4 packs và quotas được seed/resolve đúng.
- Clean/upgrade migration chỉ tạo initial draft idempotent và legacy compatibility release `non_sellable`; không auto-publish/schedule sale release và public offers/quote không có sellable offer trước publish chuẩn của Super Admin.
- Connected savings được tính đúng từ current draft/catalog.

### 13.2. Permission/data regression

- Tenant isolation, module permission, assignment scope, record authorization và session checks không đổi.
- Người có quyền đọc vẫn nhận đầy đủ CCCD, tài khoản, ngân hàng, chữ ký, con dấu và trường liên quan.
- Word entitlement chỉ chặn export action, không che API/UI record.
- Commercial policy không tạo field masking/capability đọc.
- Existing Super Admin behavior chỉ thay trong phạm vi cấu hình thương mại đã duyệt.
- Organization billing-history authorization bám đúng contract được xác minh; test không tự suy purchase authority thành read authority hoặc tạo capability mới.

### 13.3. Quota

- Nội bộ không quota không tạo source fetch mới; có purchased quota thì dùng được.
- Connected nhận đúng included quota; violation check không trừ quota.
- Partner lookup cả hai bản không usage event.
- Partner lookup không gọi ngầm violation module; rate limit/capacity protection áp dụng theo kỹ thuật/chống lạm dụng, không theo gói và không tạo quota/entitlement thương mại ẩn.
- Với mỗi workspace/owner, một provider + entity kind + canonical source code + revision thành công chỉ consume một lần; hai workspace dùng cùng mã không chia grant/reservation và cache hit không tạo debit sai.
- `LATEST|ALL|SELECTED`: list metadata → lọc snapshot đã có → reserve/consume/release từng revision đúng. Trường hợp batch thiếu quota phải theo exact policy đã được chủ sản phẩm duyệt; nếu chưa có quyết định thì test xác nhận bị chặn rõ trước external fetch, không âm thầm chọn semantics.
- Preview/import/update cùng snapshot, cache, retry, timeout, cancellation, provider/source failure không consume.
- Concurrent jobs không âm số dư.
- Reservation lease hết hạn/worker crash được reaper release an toàn; retry sau crash không consume hai lần.
- Personal grant không dùng ở organization và ngược lại.
- FEFO/consumption order/expiry/carry-over/repeatable theo pinned policy.
- Upgrade giữ purchased grant.

### 13.4. Billing/payment

- Client tamper amount, SKU, quantity, owner, tax, URL hoặc provider không thay quyết định server.
- Quote hết hạn/sai owner/sai request/reuse tạo order khác bị từ chối; cùng quote + retry idempotent trả cùng order.
- Quote phát hành trước stop-sales/checkout-off không vượt được emergency control; quote snapshot vẫn bất biến.
- Idempotency same key/same hash replay; same key/different hash 409.
- Crash giữa Transaction 1/provider/Transaction 2, process chết sau provider success và provider create timeout đều recover từ durable command + stable provider reference, không tạo order/link thứ hai.
- Concurrent provider order-code collision bị chặn bởi unique profile/environment/code và retry sinh code trước durable command commit; code đã commit không đổi.
- Duplicate webhook 2–50 lần, concurrent/out-of-order event chỉ apply một lần.
- Webhook sai public profile/environment/key version bị từ chối; rotation vẫn xác minh order cũ; cùng dedupe key nhưng payload hash khác vào review/cảnh báo, không overwrite.
- Callback trước redirect, redirect không tới, callback chậm và redirect giả.
- Missing/over/under payment, paid after cancel/expiry và ambiguous provider state không auto apply.
- Paid after cancel/expiry vẫn ghi verified payment fact với timing đúng rồi vào review; không bị bỏ qua vì checkout state terminal.
- Personal vs organization owner separation.
- Creator mất role, organization bị khóa, policy/admin đổi subscription khi pending → correct `APPLIED` hoặc `REVIEW_REQUIRED` theo pinned policy/revision.
- Người mua mới chưa có subscription row vẫn serialize trên stable owner lock; activation/refund/reconcile dùng cùng lock order và không deadlock.
- Audit/outbox failure rollback Transaction B nhưng inbox còn retry.
- Invoice request/outbox được ghi trong Transaction B; crash ngay sau commit và email/invoice delivery failure đều retry mà không mất invoice request hoặc cấp lần hai.
- Nhiều partial refund tuần tự không vượt `verified_paid_amount`; pending + succeeded được tính vào cap, failure/cancel giữ history; stale activation revision không reverse nhầm.
- Manual/off-platform refund intent idempotent, refund timeout/crash không ghi hai lệnh; manual review không đổi unverified payment thành paid và admin grant đi seam riêng.
- Mỗi policy type kỳ năm được hỗ trợ phải có test cuối tháng/năm nhuận/29-02/inclusive-exclusive/timezone Việt Nam; initial behavior chỉ test theo quyết định đã duyệt, còn backfill giữ exact timestamp. Quota mua thêm vẫn đúng 365 ngày theo policy riêng.

### 13.5. Frontend và E2E

- Super Admin draft → validate → preview → publish/schedule → catalog update.
- 409 conflict có UI rõ, không mất draft.
- Re-auth prompt và loading chung hoạt động, cleanup khi success/error/cancel.
- Public pricing desktop/mobile; offer selection qua login.
- Fake hosted checkout success/cancel/expired/review; poll/session refresh.
- Mất mạng giữa checkout, quay lại sau một giờ, link đã hết hạn hoặc webhook đến muộn vẫn hiển thị state máy chủ đúng và không kích hoạt từ URL.
- Mua credit pack tăng đúng balance; pending job không duplicate.
- CTA nâng cấp hiển thị đúng phép tính từ release + usage/order history hoặc input minh bạch, không hard-code.
- Manager/employee không thấy hoặc không gọi được admin action; backend vẫn là nguồn enforcement.
- Accessibility keyboard/focus/aria và thông báo tiếng Việt.
- Browser test kiểm tra DB + backend + frontend cho personal, organization, Super Admin, manager và employee.
- Production publish/pilot UI và API cùng chặn khi thiếu bất kỳ approval/reference VAT-hóa đơn, merchant-payOS, credential/webhook, thương mại điện tử, dữ liệu cá nhân hoặc điều khoản bán hàng.

Không dùng dữ liệu đấu thầu tự bịa để kết luận nghiệp vụ. Automated source-fetch test dùng fixture có provenance từ dữ liệu Mua Sắm Công đã được lưu trong repo hoặc fixture được tạo trực tiếp từ payload nguồn đã xác minh và đánh dấu rõ. Payment fake data phải được đánh dấu là giả lập kỹ thuật, không trình bày như giao dịch thật.

### 13.6. Kiểm tra cuối

- Targeted test từng module.
- Full backend test suite phù hợp.
- Frontend lint/unit/build nếu repo có.
- Schema/migration test cho clean database và database legacy fixture.
- Upgrade preflight/backfill checksum và chạy lại upgrade theo cơ chế repo phải không nhân đôi release, subscription pin, order hoặc grant.
- Generated schema contract check.
- Startup/feature-flag matrix test: tổ hợp hợp lệ chạy đúng, `ENABLED=false` + `shadow|enforce` fail rõ, quota enforcement không bật ngoài enforce; production checkout không dùng Fake nhưng activation vẫn chạy khi checkout-off.
- Browser E2E với fake provider.
- Security/permission regression.
- Performance/load cho resolver/catalog cache, publish, checkout, webhook backlog và quota concurrency; kiểm tra không phát sinh N+1 ở catalog/subscription resolution.
- `git diff --check`.
- UTF-8/mojibake scan và Markdown table/link check cho tài liệu sửa.
- Kiểm tra không còn giá/quota/365-day/purchase-authority hard-code trong caller, trừ fixture/default release có tên rõ.

Nếu full suite có lỗi có sẵn không liên quan, chứng minh bằng baseline hoặc phân tích cụ thể; không đổi expected value để che lỗi.

## 14. Feature flags, rollout, metrics và rollback

### 14.1. Cờ triển khai

Tạo cấu hình tập trung theo convention repo, mặc định an toàn. Có thể dùng tên sau nếu chưa có naming tương đương:

- `COMMERCIAL_POLICY_ENABLED=false`
- `COMMERCIAL_POLICY_MODE=off|shadow|enforce`
- `PAYMENT_CHECKOUT_ENABLED=false`
- `PAYMENT_ACTIVATION_ENABLED=false`
- `PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED=false`

Cập nhật `.env.example` và startup validation. Deployment flag không thay entitlement thương mại.

- Hợp lệ: `ENABLED=false, MODE=off`; `ENABLED=true, MODE=off` cho maintenance/load-without-use; `ENABLED=true, MODE=shadow`; `ENABLED=true, MODE=enforce`.
- `ENABLED=false` cùng `MODE=shadow|enforce` là cấu hình mâu thuẫn và startup/readiness phải fail rõ, không âm thầm chọn cờ thắng.
- `PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED=true` yêu cầu commercial policy đang `enforce` và có release hợp lệ.
- Ở production, `PAYMENT_CHECKOUT_ENABLED=true` yêu cầu commercial `enforce`, external/legal gate đạt và live provider profile không phải Fake; dev/test chỉ được dùng Fake khi environment profile ghi rõ. `PAYMENT_CHECKOUT_ENABLED=false, PAYMENT_ACTIVATION_ENABLED=true` là tổ hợp hợp lệ để ngừng bán mới nhưng tiếp tục xử lý order đã tạo/đã trả.
- `COMMERCIAL_POLICY_MODE=shadow` chỉ so sánh quyết định mới/cũ, không thay behavior hiện hành.
- Payment shadow không tự kích hoạt subscription/grant.
- Quota shadow chỉ ghi usage dự kiến; không reserve, consume hoặc chặn người dùng.
- Mọi mutation/enforcement flag mặc định tắt ở production cho tới gate tương ứng.

### 14.2. Cutover

1. Schema mới, mọi cờ tắt.
2. Legacy release/backfill và projection compatibility.
3. Resolver shadow so với hành vi cũ; đo mismatch.
4. Atomically chuyển Super Admin mutation source sang draft/release và disable direct-write `/api/system-packages/update`; `GET /api/public/packages` chỉ còn compatibility read từ release projection. Checkout vẫn tắt và legacy release `non_sellable` không xuất hiện như offer bán mới.
5. Fake billing/quota E2E đạt.
6. payOS shadow với giao dịch thật chỉ khi được cấp quyền rõ.
7. Hoàn tất toàn bộ external/legal readiness checklist; nếu thiếu thì dừng ở `BLOCKED_EXTERNAL` và giữ production flags tắt.
8. Super Admin publish initial production release rồi mới chuyển public storefront/quote sang sellable offers của resolver mới.
9. Pilot cá nhân; sau đó rollout tổ chức; sau đó renewal/upgrade. Chỉ xóa compatibility endpoint/projection trong migration sau khi mọi caller đã chuyển.

### 14.3. Metrics/cảnh báo

Tối thiểu đo:

- Draft validation/publish failures và active release ID.
- Quote/order/payment/activation counts theo state, không gắn PII.
- Webhook oldest age/backlog/retry/dead.
- Paid-not-applied age; target dưới 60 giây hoặc review.
- Provider 429/5xx/latency.
- Usage reserve/consume/release, quota rejection và negative-balance invariant violation.
- Policy shadow mismatch.
- Sau 60–90 ngày bán pilot: số người dùng/quota thực dùng, chi phí nguồn-vận hành, tỷ lệ xem giá → checkout → trả tiền, tỷ lệ mua Nội bộ/Kết nối/credit pack, churn/refund/support và phản hồi khách hàng trả tiền.

Runbook phải tạo mốc review giá pilot sau 60–90 ngày. Review chỉ sinh báo cáo/đề xuất; không tự đổi giá. Mọi giá mới vẫn đi qua draft → validate/impact → Super Admin publish release mới.

Cảnh báo tối thiểu:

- webhook oldest >30 giây;
- paid-not-applied >60 giây;
- pending order quá hạn;
- provider error spike;
- commercial resolver không có release hợp lệ;
- usage ledger/projection mismatch.

### 14.4. Rollback

- Emergency control chỉ dừng checkout mới hoặc scope bán mới.
- Không tắt webhook/inbox/worker/reconciliation cho order đã tạo/đã trả.
- Không xóa release, order, payment event, activation hoặc usage ledger.
- Commercial rollback bằng release mới từ snapshot cũ.
- Feature flag rollback phải giữ quyền lợi đã thanh toán và dữ liệu hiển thị.

## 15. Thứ tự triển khai và điều kiện qua cổng

Không làm giao diện trước khi interface/backend contract ổn định; không bật enforcement trước shadow.

Khi báo trạng thái giữa các phase, dùng nhãn chính xác:

- `DONE_PHASE_N`: phase có implementation và bằng chứng test đầy đủ.
- `BLOCKED_DECISION`: cần quyết định nghiệp vụ mới ngoài contract hiện có.
- `BLOCKED_EXTERNAL`: thiếu merchant, credential, pháp lý/kế toán, staging hoặc bên thứ ba.
- `READY_FOR_SHADOW`: code/fake test đạt, chưa xác minh external shadow.
- `READY_FOR_PILOT`: shadow có bằng chứng đạt, toàn bộ external/legal/provider checklist đạt và cohort đã được phê duyệt; chưa hoàn thành pilot.
- `PILOT_EVIDENCE_COMPLETE`: chỉ dùng khi đủ giao dịch/ngày quan sát thật.

Không dùng “production-ready”, “payOS đã hoạt động” hoặc “pilot hoàn tất” để mô tả fake/local test.

### Giai đoạn 0 — discovery và hợp đồng

- Đọc tài liệu, inventory hard-code/seam, xác minh migration/test commands.
- Ghi mapping implementation so với ADR 0017/0018.
- Xác định policy schema version 1, error codes và scenario matrix.
- Chốt với chủ sản phẩm các `BLOCKED_DECISION` còn ngoài plan: semantics kỳ năm/renewal, batch thiếu quota và quyền đọc billing history tổ chức. Bảo toàn exact legacy dates/quyền trong lúc chờ; không để test tự chọn đáp án.

Qua cổng khi không còn semantics mơ hồ trong phần code MVP. Dữ kiện external được mô hình hóa bằng readiness state, không chặn fake implementation.

### Giai đoạn 1 — schema và compatibility

- Migration additive, models/repository, legacy release/backfill, plan version pinning, flags off.
- Clean/upgrade migration tests và permission regression.

Qua cổng khi app cũ chạy trên schema mới và subscription behavior cũ không đổi.

### Giai đoạn 2A — commercial policy backend

- Resolver, admin commands, schema validator/compiler, decision snapshot, cache, API, audit/outbox.

### Giai đoạn 2B — Super Admin Control Center

- Typed forms, diff, preview, impact, validation, schedule/publish/rollback, re-auth/loading.

### Giai đoạn 2C — quota

- Grants, reservations, ledger, source seams, shadow and concurrency tests.

Qua cổng khi commercial/quota test đạt và chưa bật live payment.

### Giai đoạn 3A — billing + fake provider

- Orders, state machines, fake adapter, inbox/reconcile/activation/refund review, E2E.

### Giai đoạn 3B — payOS shadow

- Official adapter, secret profile/readiness, signed webhook, query verification, shadow metrics.

### Giai đoạn 3C — storefront/checkout/subscription UI

- Dynamic offers, hosted checkout, poll/WebSocket, history, quota/upgrade CTA, admin reconciliation.

### Giai đoạn 3D — organization, renewal và transition coding

- Hoàn thiện backend/frontend và fake-provider E2E cho organization owner, renewal, upgrade/downgrade policy và review conflict sau khi hợp đồng 2A/3A ổn định.
- Không chờ 20 giao dịch thật hoặc 7 ngày quan sát để viết/test; policy chưa được chủ sản phẩm chốt vẫn giữ `BLOCKED_DECISION` và production action tắt.

Qua cổng khi fake E2E cho personal/organization, base plan/credit pack và các transition đã được duyệt đều đạt. Nếu không có merchant credentials, giữ payOS live flags tắt và ghi external blocker.

### Giai đoạn 4 — operational pilot

Không tự tuyên bố hoàn thành giai đoạn này nếu chưa thực sự có:

- cohort cá nhân giới hạn đã được phê duyệt;
- có giao dịch thật thành công cho cả mua mới Nội bộ, mua mới Kết nối và mua credit pack;
- ít nhất 20 giao dịch thật thành công được ủy quyền;
- 0 mismatch owner/amount/SKU/quota/entitlement;
- 100% duplicate event idempotent;
- 100% paid được applied hoặc review trong 60 giây;
- ít nhất 7 ngày không có lỗi đối soát nghiêm trọng.

Agent coding chỉ chuẩn bị code, checklist và runbook cho pilot. Không tự thanh toán, không chờ giả 7 ngày và không ghi “pilot đạt” nếu chưa có bằng chứng thật.

### Giai đoạn 5–6 — tổ chức, renewal và transition

- Đây chỉ là rollout production theo cohort sau khi pilot thật của giai đoạn 4 đạt; code/fake E2E đã hoàn thành ở giai đoạn 3D. Trước đó giữ flag/cohort production tắt.
- Organization purchase dùng authority profile đã publish.
- Renewal/upgrade/downgrade dùng pinned/current policy đúng contract và review conflict.

### Giai đoạn 7 — ngoài task MVP

- Không triển khai auto-renew/MoMo trừ khi người dùng mở scope bằng yêu cầu mới.

## 16. Tài liệu và deliverable bắt buộc

Hoàn thành đầy đủ:

1. Migration/schema/index/constraints cho SQLite/PostgreSQL và generated contract.
2. Commercial policy module + admin/public adapter.
3. Billing module + fake provider + payOS shadow adapter.
4. Usage credit module và procurement/violation integration đúng seam.
5. Super Admin Control Center.
6. Dynamic storefront, quote/checkout, subscription/quota/history UI.
7. Feature flags, startup validation, metrics/cảnh báo.
8. Unit/integration/concurrency/security/E2E tests.
9. Runbook gồm publish/rollback, provider outage, reconciliation, secret rotation, refund review và lịch đánh giá lại giá pilot sau 60–90 ngày.
10. Hướng dẫn Super Admin bằng tiếng Việt giải thích từng trường cấu hình, validation, tác động, publish/schedule/stop-sales/rollback và điều không được dùng cấu hình để làm.
11. Threat model ngắn cho admin policy, checkout, webhook, provider routing, secret, refund và quota concurrency; ghi data retention/log-redaction verification.
12. Implementation report Markdown trong `docs/testing/` ghi:
    - phạm vi hoàn thành theo từng giai đoạn;
    - mapping yêu cầu → file/test;
    - migration/backfill/cutover;
    - lệnh test và kết quả chính xác;
    - feature flag cuối;
    - external blocker và điều kiện pilot chưa đạt;
    - xác nhận quyền/hiển thị dữ liệu không đổi.
13. Cập nhật plan/ADR/CONTEXT chỉ khi implementation làm phát sinh thuật ngữ hoặc quyết định mới đã được chủ sản phẩm xác nhận. Không âm thầm đổi ADR đã accepted.

## 17. Khi nào phải hỏi người dùng

Không dừng để hỏi những gì có thể xác minh trong repo hoặc đã có default trong plan. Chỉ hỏi khi:

- cần thay đổi role, masking, dữ liệu hiển thị, module/assignment/record scope hoặc entitlement ngoài ADR đã duyệt;
- cần chốt semantics kỳ năm/renewal hoặc hành vi batch thiếu quota chưa có trong plan/ADR;
- cần thực hiện giao dịch thật, đăng ký webhook/merchant hoặc bật production;
- cần secret/credential/hợp đồng mà môi trường không có;
- cần quyết định hoặc phê duyệt VAT/hóa đơn, merchant/payOS, thương mại điện tử, dữ liệu cá nhân, điều khoản bán hàng/hoàn tiền không thể suy ra;
- chưa có contract rõ ai được xem billing history và dữ liệu người mua/hóa đơn của organization;
- cần destructive migration hoặc thao tác external có hậu quả đáng kể.

Trong các trường hợp đó, tiếp tục hoàn thành mọi phần fake/local/shadow an toàn trước, ghi blocker cụ thể và không giả định quyền.

## 18. Định nghĩa hoàn thành coding

Chỉ báo coding implementation hoàn thành khi:

- Không còn giá, quota, 365-day renewal, purchase authority hoặc lifecycle policy nằm rải rác dưới dạng hằng số ở caller; initial values chỉ nằm trong versioned seed/draft fixture.
- Super Admin thay đổi được mọi giá trị đã hỗ trợ qua release mới mà không redeploy.
- Published release bất biến; order/subscription/grant pin exact version/snapshot.
- Migration/backfill giữ nguyên thuê bao và quyền hiện hữu.
- Fake-provider end-to-end đạt cho personal và organization, base plan, credit pack, renewal và mọi upgrade/downgrade transition đã được chủ sản phẩm duyệt; semantics còn `BLOCKED_DECISION` phải được nêu chính xác, không giả vờ đã nghiệm thu.
- Quota đúng một lần, không âm, không trừ partner lookup/violation/retry/cache/error.
- Permission/full-data regression đạt ở Super Admin/manager/employee và personal/organization.
- Toàn bộ targeted/full test phù hợp đạt hoặc có bằng chứng rõ về lỗi baseline không liên quan.
- Production flags vẫn tắt nếu chưa đạt pilot/external readiness.
- Runbook và implementation report hoàn chỉnh, không có placeholder.

Không coi task hoàn thành chỉ vì gần hết thời gian hoặc token. Nếu phần code an toàn đã hoàn tất nhưng production pilot bị chặn bởi external credential/thời gian thật, kết luận phải là **“coding complete, production rollout pending”**, liệt kê chính xác gate còn thiếu.

## 19. Nội dung bàn giao cuối

Final response phải dẫn đầu bằng kết quả, rồi nêu ngắn gọn:

1. Các capability đã triển khai.
2. Kiến trúc/module và seam chính.
3. Migration/backfill/cờ triển khai.
4. Test đã chạy và kết quả.
5. Những gì chưa bật vì external/pilot gate.
6. Link tuyệt đối tới implementation report, runbook và các file trọng tâm.

Không tuyên bố payOS production, pilot 20 giao dịch hoặc 7 ngày quan sát đã hoàn tất nếu không có bằng chứng thực tế.

## Kết thúc prompt
