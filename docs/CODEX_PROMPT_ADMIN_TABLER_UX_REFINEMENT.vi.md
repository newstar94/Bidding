# Prompt triển khai — cải thiện UX toàn bộ Platform Admin theo Tabler

## Vai trò và cách làm việc

Bạn là kỹ sư frontend/UX senior làm việc trực tiếp trong repository D:\Bidding.

Hãy triển khai cải thiện giao diện Platform Admin hiện tại theo phong cách Tabler đã có sẵn trong dự án. Đây là thay đổi production có ràng buộc nghiệp vụ, thương mại, quyền truy cập và audit; không phải mockup, không phải viết lại dashboard từ đầu.

Trước khi sửa, hãy dùng /plan để lập kế hoạch theo các milestone trong prompt này. Không bắt đầu bằng việc sửa hàng loạt CSS hoặc đổi framework. Mỗi milestone phải có bằng chứng kiểm tra trước khi chuyển sang milestone tiếp theo.

Mục tiêu cuối cùng:

1. Trang quản lý gói dịch vụ dễ hiểu, an toàn và trực quan hơn, đặc biệt là workflow draft → save → validate → publish.
2. Toàn bộ 17 route Platform Admin có cấu trúc điều hướng, card, table, form, status, drawer, empty/loading/error state và responsive behavior nhất quán với Tabler hiện tại.
3. Không làm mất dữ liệu đã được phép xem, không thay đổi quyền, không thay đổi API contract hoặc semantics thương mại nếu chưa có bằng chứng và phê duyệt riêng.
4. Có regression tests cho các lỗi workflow và interaction đã phát hiện, cùng bằng chứng visual QA ở desktop, tablet và mobile.

## Bối cảnh hiện tại đã xác minh

- Frontend là vanilla ES modules/Vite; không được chuyển sang React, Vue, Angular hoặc framework mới.
- Tabler đã được ghim ở @tabler/core 1.4.0.
- Entry và shell chính:
  - frontend/admin-platform/AdminEntry.js
  - frontend/admin-platform/AdminApp.js
  - frontend/admin-platform/AdminNavigation.js
  - frontend/admin-platform/AdminRouter.js
  - frontend/admin-platform/admin.css
  - views/admin/index.html
  - backend/app.py phần inject asset admin
- Các module route hiện có:
  - /admin — AdminOverview.js
  - /admin/analytics — AdminAnalytics.js
  - /admin/organizations và /admin/users — AdminDirectories.js, AdminDirectory.js
  - /admin/plans — AdminPlans.js
  - /admin/subscriptions, /admin/payments, /admin/invoices — AdminBilling.js
  - /admin/settings, /admin/environment, /admin/health, /admin/system/version — AdminOperations.js
  - /admin/audit, /admin/security — AdminSecurity.js
  - /admin/system/jobs, /admin/system/sync — AdminSystem.js
  - /admin/legal — AdminLegalCatalog.js và frontend/legal-versioning/LegalCatalogAdmin.js
- Test/UI entrypoints liên quan:
  - tests/js/admin_platform_plans.test.mjs
  - tests/js/admin_platform_navigation.test.mjs
  - tests/js/admin_platform_directory.test.mjs
  - tests/js/admin_platform_billing.test.mjs
  - tests/js/admin_platform_analytics.test.mjs
  - tests/js/admin_platform_legal.test.mjs
  - tests/js/admin_platform_overview_layout.test.mjs
  - e2e/specs/admin-shell.spec.mjs
  - scripts/run_isolated_audit_e2e.ps1
- ADR thương mại bắt buộc đọc trước khi sửa:
  - docs/adr/0018-super-admin-versioned-commercial-control.md
  - docs/guides/super-admin-commercial-control-center.vi.md

Audit trước đó đã phát hiện các điểm cần xử lý:

1. AdminPlans.js:414-420 validate chỉ gửi revision đã lưu, sau đó render() dựng lại form từ draft.document; input chưa lưu có thể mất.
2. Sau khi validation đạt, người dùng chỉnh tiếp nhưng publish vẫn có thể dùng revision/digest cũ; hiện chưa có dirty guard.
3. AdminPlans.js:244-255 nối toàn bộ danh mục, release, draft, editor, capability N/A và history trong một luồng dọc rất dài.
4. AdminPlans.js:150-157 dựng tất cả offer editor cùng lúc; mỗi offer có khoảng 22 control, nhiều trường chỉ đọc.
5. Stepper workflowGuideMarkup() tại AdminPlans.js:49-50 luôn active bước 1.
6. Có nguy cơ lặp quota/quyền lợi giữa presentCommercialOffer() và offerRightsMarkup().
7. Có ID heading lặp admin-plan-catalog-title và admin-plan-model-title.
8. Sidebar runtime gọi adminNavigationMarkup({ compact: true }), làm phẳng các nhóm đã định nghĩa trong AdminRouter.js.
9. Bộ lọc ngày của Users/Audit dùng label visually-hidden, khó phân biệt khi có nhiều khoảng ngày.
10. Billing table dày, status chưa thống nhất; Legal Catalog còn CSS/token cũ ngoài hệ Tabler.
11. Analytics có thể render rất nhiều chart và bảng điểm cùng lúc.
12. Có xung đột breakpoint overview ở khoảng 768–991px.

Audit này là điểm xuất phát cần xác minh lại trên HEAD hiện tại, không phải lý do để sửa mù hoặc thay đổi nghiệp vụ theo suy đoán.

## Business contract bất biến — ưu tiên cao nhất

Không được vi phạm các điều sau:

1. Không thêm, bỏ, che, mask, redact, truncate, lọc response hoặc giới hạn dữ liệu mà người dùng hiện có quyền xem.
2. Người dùng đã được cấp quyền đọc theo tenant, module, assignment và record scope phải tiếp tục xem đầy đủ dữ liệu được cấp phép. Không dùng Word entitlement để che dữ liệu màn hình/API.
3. Không thêm, bỏ, gộp, tách hoặc đổi semantics của role, module permission, tenant scope, assignment scope, record scope, capability, entitlement, inheritance hoặc default allow/deny.
4. Không tạo capability đọc dữ liệu nhạy cảm mới.
5. Platform Admin vẫn chỉ dành cho server-authorized super_admin; không đưa authorization ra browser và không dùng organization-manager scope thay thế platform scope.
6. Không đổi API shape, endpoint, revision rule, validation digest, readiness expiry, idempotency, CSRF, privileged re-authentication, audit hoặc transaction boundary chỉ để làm UI đơn giản hơn.
7. Published release, billing order, activation, usage ledger và release history vẫn bất biến. Rollback thương mại chỉ bằng release mới theo policy hiện tại.
8. Stop-sales vẫn chỉ dừng giao dịch mới; không thu hồi quyền lợi đã cấp và không che dữ liệu.
9. Không tự tính lại hoặc tự sửa subtotal, tax, total, currency, memberQuota, includedProcurementQuota, tier, variant, ownerKind, price.period, salesState, display.visibility hoặc export capability để làm số liệu “đẹp” hơn. Ví dụ total = 2201 phải được giữ nguyên nếu server trả về giá trị đó.
10. Không coi N/A, unsupported, not_available, not_configured là số 0 hoặc tự dựng số liệu thay thế.
11. Không xóa advanced editor chỉ vì khó trình bày. Mọi field chưa có structured form vẫn phải giữ khả năng xem/sửa qua khu vực nâng cao hiện tại.
12. Tabs, accordion, drawer và filter chỉ thay đổi cách bố trí. Mọi field, giá trị đầy đủ và action hiện có phải có đường truy cập rõ ràng trên desktop, tablet, mobile và bàn phím.

Nếu muốn thay đổi một semantics thuộc các mục trên, dừng đúng phần đó, ghi rõ bằng chứng, compatibility impact, migration strategy và yêu cầu chủ sản phẩm phê duyệt ADR. Không tự quyết định trong code hoặc trong test.

## Quy tắc an toàn trước khi chỉnh sửa

1. Đọc AGENTS.md, ADR 0018 và các test liên quan đầy đủ.
2. Kiểm tra git status --short, HEAD và diff hiện tại. Không dùng git reset --hard, git checkout --, git clean, rebase, merge, commit hoặc push.
3. Bảo vệ thay đổi đang có của người dùng. Nếu file mục tiêu đã dirty và thay đổi chồng lấn, dừng để báo chính xác.
4. Không nâng phiên bản Tabler, không thêm CDN, không thêm thư viện UI và không thay framework.
5. Không sửa database, migration, seed production, .env, secret, certificate hoặc deployment artifact cho nhiệm vụ này.
6. Không tạo mutation trên dữ liệu production hoặc tài khoản thật để thử UI. E2E mutation chỉ chạy trên test database cô lập do repository cung cấp.
7. Dùng token và component Tabler/BiddingFlow hiện có; không tạo hệ token thứ hai.
8. Trước mỗi thay đổi cấu trúc lớn, lập ma trận field/action hiện tại → vị trí mới để chứng minh không có field/action bị bỏ.

## Milestone 0 — baseline và reproduction

Thực hiện trước mọi production edit:

1. Đọc toàn bộ module admin và test liên quan, không chỉ file CSS.
2. Chạy test thu hẹp hiện có cho plans và shell để ghi baseline. Nếu môi trường không chạy được, ghi lệnh, lỗi và nguyên nhân, không giả định pass.
3. Reproduce static control flow của lỗi draft:
   - chỉ nhánh save gọi serializeDraftDocument();
   - nhánh validate chỉ gửi expectedRevision;
   - render() dựng lại từ draft.document;
   - backend validate lấy document đã lưu theo draft/revision.
4. Kiểm kê tất cả 17 route, route title, nav group, endpoint, loading/empty/error/permission state, drawer và mutation.
5. Chụp baseline nếu có thể ở các kích thước 1440, 1366, 1024, 992, 768, 414 và 375 px. Nếu không có browser/session, đánh dấu visual baseline là chưa xác minh.
6. Không gọi audit hoàn thành chỉ vì unit markup test đang pass.

## Milestone 1 — sửa state machine của draft trước khi làm đẹp

Đây là ưu tiên P0. Không được giải quyết bằng cách chỉ đổi HTML/CSS.

### 1.1 Ba lớp state bắt buộc

Tách rõ:

- canonicalSavedSnapshot: document/revision/checksum/digest được server xác nhận gần nhất.
- workingDraft: bản sao toàn bộ document đang được người dùng chỉnh, bao gồm mọi offer, advanced fields và unknown fields được policy cho phép giữ nguyên.
- uiState: draft đang mở, offer đang chọn, dirty, save pending, validate pending, publish pending, validation result, validation revision/digest/expiry, status message và request sequence.

DOM chỉ là render của workingDraft, không được là nguồn duy nhất của dữ liệu.

### 1.2 Dirty state

Dirty phải được cập nhật bởi tất cả nguồn nhập:

- input text/textarea;
- checkbox;
- select;
- advanced JSON textarea;
- effectiveAt chỉ là UI scheduling state, không tự nhập vào policy document nếu backend không yêu cầu.

Khi policy content thay đổi:

- đánh dấu dirty;
- xóa hoặc đánh dấu stale validation result;
- vô hiệu hóa publish;
- hiển thị “Chưa lưu” và lý do ngắn gọn;
- không gọi validate trên document cũ mà không báo cho người dùng.

Không autosave ngầm. Khi đóng editor, mở draft khác, chuyển route hoặc reload, nếu dirty phải có cảnh báo rõ ràng với lựa chọn giữ lại hoặc bỏ thay đổi. Không được tự replay bản nháp cục bộ thành mutation server.

### 1.3 Save

- Save phải serialize toàn bộ working document, không chỉ offer đang được mở.
- Gửi revision hiện hành và idempotency key đúng seam hiện tại.
- Chỉ hiển thị “Đã lưu bản nháp” sau authoritative server acknowledgement.
- Nếu conflict/revision mismatch: giữ nguyên working copy, không ghi đè bằng server snapshot, không retry mutation tự động; hiển thị cách tải bản mới hoặc người dùng quyết định xử lý.
- Nếu PATCH thành công nhưng refresh overview/catalog thất bại: hiển thị “Đã lưu bản nháp; chưa tải lại được tổng quan”, giữ canonical response và không gửi lại PATCH.
- Nếu Save thất bại: không gọi render() theo document cũ làm mất input; giữ working copy và lỗi inline.
- Sau Save thành công, cập nhật canonical snapshot bằng response server, reset dirty, xóa validation cũ nếu revision đã đổi và chỉ render lại khi không làm mất working state.

### 1.4 Validate

API validate hiện tại chỉ validate persisted document theo draft_id + expectedRevision; không gửi document tạm nếu chưa có backend contract mới.

Vì vậy, chọn một trong hai cách sau và ưu tiên cách đầu:

1. Khi dirty, chặn Validate với thông báo “Hãy lưu bản nháp trước khi kiểm tra”, giữ nguyên tất cả input; hoặc
2. Thực hiện Save → Validate theo một chuỗi UI tường minh, chỉ khi Save canonical thành công mới gọi Validate.

Không tự tạo validation digest, readiness TTL hoặc hiệu lực. Validation result phải gắn đúng draft ID, revision, checksum/digest và expiry server trả về.

### 1.5 Publish

Publish chỉ được hoạt động khi:

- không dirty;
- không còn save/validate request pending;
- validation không có lỗi;
- validation digest thuộc đúng draft/revision hiện tại;
- readiness chưa hết hạn;
- effectiveAt hợp lệ;
- reason bắt buộc đã được nhập;
- privileged re-authentication thành công nếu server yêu cầu.

Sau khi mở dialog reason hoặc re-authentication, kiểm tra lại state hiện tại; không dùng closure state cũ để publish nhầm revision/digest. Confirmation phải nói rõ publish áp dụng cho toàn bộ draft, không chỉ offer đang chọn.

### 1.6 Race và request ordering

Bảo đảm response cũ không render đè state mới trong các tình huống:

- validate A trả về sau khi người dùng mở draft B;
- người dùng sửa trong lúc validate;
- save cũ trả về sau thao tác mới;
- route bị đóng hoặc abort trong lúc request;
- double click Save/Validate/Publish;
- validation hết hạn trong lúc dialog đang mở.

Busy state phải khôi phục đúng trạng thái disabled/read-only ban đầu, không bật nhầm control vốn chỉ đọc.

## Milestone 2 — tái cấu trúc trang Gói dịch vụ theo Tabler

Không đổi route /admin/plans và không đổi API. Có thể dùng tabs/subnav, anchor hoặc accordion; ưu tiên deep-link có thể khôi phục trạng thái mà không tạo route/backend mới.

### 2.1 Cấu trúc thông tin đề xuất

Giữ đủ bốn vùng, nhưng phân cấp thành:

1. Tổng quan danh mục
   - release hiện hành;
   - gói đang công bố;
   - credit packs;
   - preview công khai;
   - trạng thái dữ liệu và checksum/release ID cần hiển thị.
2. Bản nháp và xuất bản
   - bản đang hiệu lực;
   - bản đã lên lịch;
   - danh sách draft;
   - editor toàn document;
   - stepper và action bar.
3. Mô hình quyền lợi
   - các capability được hỗ trợ;
   - các capability N/A/unsupported;
   - giải thích phạm vi hiện tại, không biến N/A thành zero.
4. Lịch sử phát hành
   - release immutable;
   - effective time;
   - sales state;
   - base release;
   - audit-relevant metadata đã được API trả về.

Mỗi tab phải có heading duy nhất, trạng thái rỗng/lỗi riêng và đường quay lại rõ ràng. Không render đồng thời toàn bộ nội dung nặng nếu không cần; nhưng không được làm mất khả năng truy cập hoặc dữ liệu.

### 2.2 Danh mục gói

- Giữ preview card nếu có giá trị đối chiếu với storefront.
- Bổ sung bảng quản trị đồng hàng để so sánh nhiều offer: code, tên, owner, tier, variant, price, period, quota, export capability, visibility và sales state.
- Không dùng preview công khai để thay thế admin projection.
- Không lặp cùng quota/violation benefit. Phân biệt “Mô tả công khai” với “Thông số quyền lợi”.
- Giữ trạng thái raw code có thể tra cứu trong detail/tooltip/table phụ, đồng thời dùng label Việt hóa và status badge cho đọc nhanh.

### 2.3 Editor toàn document và chọn offer

Có thể dùng accordion hoặc offer navigator để chỉ mở một offer tại một thời điểm, nhưng bắt buộc:

- workingDraft.offers vẫn chứa toàn bộ offers;
- mỗi offer có identity ổn định bằng code hoặc key server, không phụ thuộc index DOM;
- chọn offer A → B → quay lại A giữ nguyên input A;
- offer chưa mở vẫn được giữ nguyên khi Save;
- thứ tự offer được giữ nguyên;
- unknown fields trong từng offer được giữ nguyên;
- read-only fields được gửi lại đúng từ canonical/working snapshot, không bị bỏ;
- exportCapabilities: null được giữ nguyên và vẫn có cảnh báo rõ;
- advanced JSON không bị xóa hoặc biến thành {} khi đổi offer;
- effectiveAt không làm dirty policy content nếu chỉ là lịch publish.

Structured fields vẫn chia thành:

- Thông tin hiển thị;
- Giá và hạn mức;
- Quyền xuất và tính năng.

Trường read-only phải có kiểu trình bày metadata rõ ràng, không làm người dùng tưởng có thể sửa. Trường editable phải có id, label for, hint, invalid state và thông báo lỗi gắn đúng field.

### 2.4 Stepper và action bar

Stepper là trạng thái UI dẫn xuất, không tạo lifecycle/status backend mới. Các trạng thái tối thiểu:

- Xem release hiện hành;
- Đang chỉnh sửa;
- Chưa lưu;
- Đã lưu, chưa kiểm tra;
- Đã kiểm tra nhưng có lỗi;
- Đã kiểm tra và sẵn sàng xuất bản;
- Đã hết hạn cần kiểm tra lại.

Action bar của editor phải luôn dễ tìm, có thể sticky trong giới hạn editor nếu không che nội dung. Khi sticky:

- không che field cuối;
- không che focus ring;
- không làm thay đổi tab order;
- mobile vẫn có nút dễ bấm;
- giải thích ngay cạnh Publish vì sao đang disabled.

## Milestone 3 — chuẩn hóa shell và toàn bộ route

### 3.1 Sidebar và header

- Khôi phục các nhóm ADMIN_NAV_GROUPS: Điều hành, Khách hàng, Thương mại, Hệ thống, Bảo mật, DevOps.
- Giữ nguyên tất cả 17 route, active state, deep link, back/forward, mobile collapse và keyboard behavior.
- Không dùng nhóm để ẩn route hoặc đổi quyền.
- Giữ shell Tabler hiện tại, không viết sidebar mới ngoài hệ component đang dùng.

### 3.2 Shared status

Reuse AdminStatus.js hoặc mở rộng có kiểm soát. Chuẩn hóa presentation cho payment, activation, checkout, session, organization, jobs, legal và release:

- label tiếng Việt để đọc nhanh;
- màu/status badge Tabler nhất quán;
- raw code vẫn có thể xem trong detail hoặc tooltip khi cần audit/debug;
- không đổi giá trị trạng thái server trả về;
- unknown/unmapped phải hiển thị “Chưa xác định” hoặc N/A, không tự đoán.

### 3.3 Directory filters và tables

- Label nhìn thấy cho các khoảng ngày: “Tạo từ ngày / Tạo đến ngày”, “Hoạt động từ ngày / Hoạt động đến ngày”, “Từ ngày / Đến ngày” của audit.
- Giữ tất cả filter hiện tại và query state.
- Bảng phải có sort direction visible bên cạnh aria-sort.
- Nếu thêm page-size selector cho 25/50/100, giữ query state và pagination server-side.
- Không thêm bulk mutation chỉ vì có checkbox. Nếu checkbox chưa có action hợp lệ, trình bày trạng thái rõ ràng nhưng không tạo action mới.
- Mobile phải còn cách biết tên cột, sort, filter và mở detail; không chỉ ẩn header chứa control.

### 3.4 Billing và drawers

- Giữ đủ amount, currency, payment state, activation state, checkout state, provider reference, transaction IDs, detail và action.
- Tổ chức lại hàng/cột để quét nhanh; đưa phần phụ vào drawer chỉ khi vẫn có nút mở rõ ràng và label đầy đủ.
- Không bỏ transaction con, không gộp các state khác semantics.
- User/organization detail drawer nhóm thành nhận diện, đăng ký, hoạt động, membership, audit và thao tác; không xóa field hoặc thu hẹp projection.
- Detail drawer phải có focus trap, focus restore, Escape, close button accessible và chiều rộng responsive.

### 3.5 Overview và Analytics

- Overview: cảnh báo cần xử lý phải dễ thấy hơn; giữ KPI, growth, health, recent organizations, historical data, activity, alerts và N/A.
- Không để raw technical keys như newUsers hoặc newOrganizations làm heading người dùng đọc trực tiếp; label presentation phải có ngữ cảnh.
- Analytics: phân cấp KPI → chart → detail table; không render tất cả bảng điểm dài cùng lúc nếu có thể mở rộng rõ ràng.
- Mọi dữ liệu đầy đủ vẫn phải truy cập được.
- N/A, unsupported, insufficient_sample, not_available, not_configured phải giữ ngữ nghĩa và không bị biến thành số 0.

### 3.6 Legal Catalog

- Giữ nguyên immutable/versioned legal workflow và API.
- Chuyển LegalCatalogAdmin.css sang token Tabler/admin hiện tại hoặc tạo adapter token rõ ràng; không để biến như --text-muted, --border-color, --primary không có nguồn.
- Chuẩn hóa badge-warning, btn-outline, btn-sm thành variant Tabler hợp lệ.
- Không đổi source authority, publication, manual review hoặc version semantics.

## Milestone 4 — accessibility và responsive QA

Bắt buộc kiểm tra:

- 1440px và 1366px: sidebar, header, table density, plans tabs/editor, sticky action bar.
- 1024px và 992px: header tools, overview columns, drawers.
- 768px: xác nhận không có xung đột breakpoint và không ép hai cột làm vỡ layout.
- 414px và 375px: nav collapse, filter, editor, offer navigator, tables, buttons, drawer, action bar.

Acceptance accessibility:

1. Mỗi id trong DOM là duy nhất.
2. Mỗi input/select/textarea editable có label liên kết bằng for/id hoặc accessible name tương đương.
3. Tablist có aria-selected, aria-controls, roving tabindex và Arrow/Home/End behavior đúng.
4. Accordion có button/summary accessible, trạng thái mở/đóng rõ và không scroll jump bất ngờ.
5. Modal/drawer giữ focus, trả focus về opener và đóng bằng Escape.
6. Validation summary có thể focus và dẫn đến đúng offer/field.
7. Focus ring nhìn thấy trên mọi action, kể cả sticky bar và mobile.
8. Không có clickable label bị wrap thành hai dòng ở breakpoint mục tiêu nếu có thể tránh bằng layout/label ngắn hơn.
9. prefers-reduced-motion vẫn được tôn trọng.
10. Contrast và semantics status không chỉ dựa vào màu; luôn có text.

## Test bắt buộc

### Unit/markup/state tests

Mở rộng test hiện có, không sửa expected để hợp thức hóa thay đổi nghiệp vụ:

1. edit → validate khi dirty: không gửi validate document cũ và không làm mất input.
2. edit → save → validate: validate đúng revision mới và render vẫn giữ toàn bộ working document.
3. validate success → edit: validation bị stale, Publish disabled và UI giải thích lý do.
4. edit offer A → chọn B → quay lại A → save: giữ A, B và mọi offer chưa mở.
5. Preserve thứ tự, unknown fields, read-only fields, advanced JSON và exportCapabilities: null.
6. Save conflict/error giữ working copy và không tự replay.
7. Save thành công nhưng refresh thất bại hiển thị trạng thái “đã lưu, chưa tải lại” chính xác.
8. Close/route/reload khi dirty yêu cầu lựa chọn tường minh.
9. Response cũ của validate/save không render đè draft mới.
10. Double click không tạo hai mutation.
11. ID headings duy nhất, labels đúng, tabs/stepper có state đúng.
12. Public catalog benefits và structured entitlement không bị lặp cùng một giá trị.

### Lệnh test tối thiểu

Chạy và ghi lại exit status của các nhóm phù hợp:

- node --test tests/js/admin_platform_plans.test.mjs
- node --test tests/js/admin_platform_navigation.test.mjs tests/js/admin_platform_directory.test.mjs tests/js/admin_platform_billing.test.mjs tests/js/admin_platform_analytics.test.mjs tests/js/admin_platform_legal.test.mjs tests/js/admin_platform_overview_layout.test.mjs
- npm run lint:security
- npm run check:static
- npm run build:secure

Nếu có thay đổi interaction route, chạy thêm test Playwright admin trong test environment cô lập:

- npm run test:e2e:smoke -- --grep "commercial plans|admin shell|accessibility"

Nếu command trên không phù hợp với script hiện tại, không tự bịa command thay thế để báo pass. Đọc package.json, playwright.config.mjs và e2e/specs/admin-shell.spec.mjs, chọn command tương thích rồi ghi rõ command thực tế.

Không chạy mutation E2E trên production. Khi cần test save/validate/publish, dùng test database cô lập và fixture reset được. Không dùng test để publish release thật, stop-sales thật, refund thật, đối soát thật, đổi quyền thật hoặc đổi dữ liệu người dùng thật.

## Visual QA và bằng chứng nghiệm thu

Sau khi chỉnh:

1. Chụp before/after cho /admin/plans ở desktop, tablet, mobile.
2. Kiểm tra trực tiếp loading, empty, error-retry, permission, validation error, validation success, dirty, conflict, stale readiness và refresh failure.
3. Kiểm tra ít nhất một draft có nhiều offer, một offer exportCapabilities: null, một advanced field chưa có structured form và một release đã stop-sales.
4. Kiểm tra tất cả route không bị ảnh hưởng bởi shared CSS/token.
5. Báo riêng:
   - đã sửa và đã test;
   - đã sửa nhưng chưa có live browser evidence;
   - bị chặn bởi môi trường;
   - đề xuất cần quyết định sản phẩm.

Không được gọi là “đã hoàn tất” nếu chỉ có markup/unit test mà chưa kiểm tra interaction thực tế của dirty/save/validate/publish.

## Tiêu chí hoàn thành

Chỉ hoàn thành khi tất cả điều kiện sau đúng:

- Không còn đường code validate trên document cũ khi form đang dirty mà không cảnh báo/chặn.
- Input không bị mất khi validate, save lỗi, refresh lỗi, đổi offer, đổi tab hoặc response race.
- Publish chỉ dùng canonical saved revision và validation digest còn hợp lệ.
- Save payload luôn chứa toàn bộ draft document và bảo toàn offer chưa mở/unknown fields.
- Stepper, tabs, status, sidebar, labels, IDs và action bar phản ánh đúng state hiện tại.
- Toàn bộ dữ liệu/action được phép xem vẫn có thể truy cập đầy đủ.
- Không có thay đổi role, permission, masking, response shape, entitlement, tenant/record scope hoặc business semantics.
- Các test tập trung, lint/static/build và E2E phù hợp đều có exit status được báo cáo.
- Visual QA đã kiểm tra các breakpoint 1440, 1366, 1024, 992, 768, 414 và 375 px hoặc đã ghi rõ blocker.
- git diff chỉ chứa thay đổi thuộc phạm vi này; không có file tạm, secret, build artifact không được yêu cầu.

## Cách báo cáo cuối cùng

Báo cáo bằng tiếng Việt, ngắn gọn nhưng có bằng chứng:

1. Tóm tắt kết quả theo milestone.
2. Danh sách file đã sửa và mục đích từng file.
3. Các semantics/API/permission đã xác nhận giữ nguyên.
4. Các lệnh test đã chạy, exit status và số test pass/fail/skip.
5. Visual routes/breakpoints đã kiểm tra và nơi chưa thể kiểm tra.
6. Các điểm còn rủi ro hoặc cần chủ sản phẩm quyết định.
7. Không nói “production-ready” nếu còn blocker về test, browser evidence, legal readiness hoặc external provider readiness.

Kết thúc bằng một kết luận phân loại rõ: HOÀN TẤT, HOÀN TẤT CÓ GIỚI HẠN, hoặc BỊ CHẶN, kèm lý do và bằng chứng tương ứng.

