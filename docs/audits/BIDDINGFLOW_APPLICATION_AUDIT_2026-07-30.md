# BiddingFlow — Báo cáo audit toàn diện ứng dụng

**Ngày chốt số liệu:** 30/07/2026  
**Commit được rà soát:** `b850aaabdc4b22eee9052664d3c80b0919ed67f7` (`main`)  
**Loại tài liệu:** Đánh giá kỹ thuật và định hướng triển khai; các quyết định tại mục 1.2 đã được chủ sản phẩm phê duyệt  
**Ngày cập nhật quyết định:** 30/07/2026  
**Trạng thái mã nguồn khi bắt đầu audit:** worktree sạch  
**Phạm vi thay đổi của audit:** chỉ đọc. Không sửa mã ứng dụng, dữ liệu hay cấu hình. Tài liệu này là file duy nhất được tạo sau audit.

---

## 1. Tóm tắt điều hành

BiddingFlow **không cần viết lại**. Ứng dụng đã có một nền tảng đáng kể về bảo mật trình duyệt, cô lập xử lý tài liệu, PostgreSQL, đồng bộ offline, kiểm thử E2E, kiểm soát hiệu năng khởi động và chuỗi cung ứng phần mềm. 162 test Python và 212 test JavaScript đều vượt qua trong phiên audit. CI còn kiểm tra nhiều luồng nghiệp vụ thật bằng PostgreSQL 17, kiểm toán dependency, SBOM, CodeQL, Gitleaks, N+1 và gói phát hành production.

Điểm cần thay đổi không phải là tiếp tục “vá CSS” hay thêm nhiều lớp controller. Phần lớn lỗi lặp lại gần đây có cùng nguyên nhân hệ thống:

1. state điều hướng và state nghiệp vụ có nhiều nơi sở hữu;
2. dữ liệu frontend bị mutate công khai rồi mỗi caller tự persist/sync/rollback;
3. component Select, Tab và Button tồn tại cả bản tốt lẫn bản legacy, trong đó một số bản được “nâng cấp” sau render bằng suy luận từ DOM/text;
4. CSS có nhiều hệ token và nhiều lớp override cùng tồn tại;
5. quy tắc vòng đời gói thầu được lặp bằng chuỗi tiếng Việt ở nhiều module;
6. số lượng test lớn nhưng coverage tập trung chưa đúng vào auth, sync, WebSocket, lifecycle và document export.

Các vấn đề ưu tiên đã được chủ sản phẩm chấp thuận xử lý theo mục 1.2:

- **P0 bảo mật:** phản hồi xung đột sync có thể đính kèm bản ghi máy chủ trước khi xác nhận người gọi có quyền đọc bản ghi đó.
- **P0 trước khi cung cấp production cho bên ngoài:** ba trang pháp lý công khai còn 27 placeholder `[TODO]` trên 21 dòng nội dung.
- **P1 toàn vẹn dữ liệu:** client offline cũ có thể tạo lại bản ghi đã bị người khác xóa trên server.
- **P1 vận hành:** audit-chain monitor có thể đánh dấu ứng dụng không sẵn sàng nhưng endpoint `/health/ready` không đọc trạng thái này.
- **P1 dữ liệu nhạy cảm:** quyền `view` module hiện quá rộng đối với định danh, tài chính, chữ ký/con dấu và media.
- **P1 truy vết:** “Lịch sử chỉnh sửa” chưa bao phủ phần lớn bảng nghiệp vụ.

Khuyến nghị tổng thể là sửa các biên bảo mật/dữ liệu trước, sau đó tạo năm module sâu có interface nhỏ: `RouteRegistry`, `PackageWorkspaceState`, `WorkspaceDataStore`, `LifecyclePolicy` và `PackageDetailModule`. Tiếp theo mới hợp nhất Select/Tabs/Button/Feedback và thu gọn CSS cascade. Việc chia bundle nên thực hiện sau các seam này, không làm trước.

### 1.1. Bảng sức khỏe tổng quan

| Lĩnh vực | Nền tảng hiện tại | Rủi ro chính | Kết luận |
|---|---|---|---|
| Bảo mật ứng dụng | CSP, Trusted Types, DOMPurify, Argon2id, token hash, scan supply chain | Thứ tự authorize trong conflict path; quyền đọc nhạy cảm quá rộng | Nền tảng tốt, cần sửa hai biên quan trọng |
| Dữ liệu/offline | Tenant key, row version, tombstone, outbox client | Có thể phục sinh bản ghi đã xóa; delta không giới hạn | Cần làm rõ semantics restore và snapshot paging |
| Backend/ops | PostgreSQL migration lock, health, metrics, document worker | Readiness bỏ qua audit health; document request chờ lâu | Trưởng thành nhưng còn seam transaction/async |
| Frontend architecture | ES modules, lazy workflow import, collision guard | Controller/state/prototype rộng; route parse/serialize phân tán | Không cần rewrite; cần module sâu theo workflow |
| UI/UX | Desktop polished, responsive, dialog accessibility tốt | Select legacy, focus yếu, runtime-inferred buttons, token drift | Chuẩn hóa primitive thay vì tiếp tục override |
| Test/CI | 374 test local, nhiều E2E và performance gate | Coverage tổng 28,60%; critical modules 0–19% | Chuyển sang coverage theo rủi ro |
| Pháp lý/compliance | Có trang Terms/Privacy/Security công khai | Nội dung vận hành thực tế chưa được chốt | Blocker có điều kiện trước public production |

### 1.2. Quyết định đã được chủ sản phẩm chốt

Các quyết định dưới đây thay thế trạng thái “chờ quyết định” tương ứng trong bản audit ban đầu:

| ID quyết định | Nội dung | Trạng thái | Chỉ dẫn triển khai |
|---|---|---|---|
| DEC-01 | Triển khai nhóm P0/P1 | **Đã phê duyệt** | Thực hiện theo thứ tự roadmap: bảo mật/dữ liệu trước, sau đó state/component/architecture. Viết regression test trước các sửa đổi có rủi ro cao. |
| DEC-02 | Chính sách dữ liệu nhạy cảm | **Yêu cầu bắt buộc của chủ sản phẩm** | Mặc định ẩn và từ chối truy cập. Chỉ người dùng được cấp capability riêng `identity`, `financial` hoặc `signature` mới được xem nhóm dữ liệu tương ứng. Áp dụng nhất quán cho API, protected media và export; mọi lượt cấp quyền/tải dữ liệu nhạy cảm phải có audit. |
| DEC-03 | Dữ liệu đã xóa và client offline | **Đã phê duyệt theo khuyến nghị** | Client offline không được tự tái tạo bản ghi đã xóa. Restore phải là command riêng, do người có thẩm quyền thực hiện, có reason và audit; không coi stale update là create mới. |
| DEC-04 | Trang pháp lý production | **Đã phê duyệt theo khuyến nghị** | Chỉ điền dữ liệu đã được xác minh, không tự suy đoán. Legal facts chưa đầy đủ là blocker trước khi cung cấp production ra bên ngoài; cần fact sheet từ chủ thể vận hành. |
| DEC-05 | Cải tổ frontend | **Đã phê duyệt theo khuyến nghị** | Refactor tăng dần qua `RouteRegistry`, `PackageWorkspaceState`, `WorkspaceDataStore`, lifecycle contract và component primitives; không viết lại toàn bộ ứng dụng. |
| DEC-06 | Chuyển form gói thầu dài khỏi modal | **Tạm hoãn** | Chưa chuyển sang routed workbench/page-sized flow trong các giai đoạn hiện tại. Vẫn được sửa lỗi bảo mật, mất dữ liệu, validation và accessibility bên trong modal; không thực hiện redesign kiến trúc của form cho đến khi có quyết định mới. |

Đối với chi tiết kỹ thuật không cần thêm dữ kiện nghiệp vụ, đội triển khai được phép dùng phương án mặc định trong báo cáo. Thông tin pháp lý thực tế là đầu vào duy nhất không được tự suy luận từ mã nguồn.

---

## 2. Phạm vi, phương pháp và giới hạn

### 2.1. Phạm vi

Audit bao phủ:

- kiến trúc Starlette/Python, route composition, database schema/migration và boundary của module;
- authorization, dữ liệu nhạy cảm, sync/offline, row conflict, tombstone, WebSocket và audit history;
- document worker, media lifecycle, readiness, metrics và quy trình vận hành;
- frontend controller/view/state/router, mutation/persistence, dynamic module loading và bundle;
- CSS/token/component, accessibility, responsive behavior, feedback/validation và tính nhất quán giao diện;
- test, coverage, static analysis, CI, E2E, performance budget và secure build;
- quan sát trực tiếp một số đường đi trên desktop/mobile và hành vi F5/deep-link.

### 2.2. Phương pháp

1. Lập bản đồ repo, đếm file/line và xác định module lớn.
2. Đọc source tại các seam có rủi ro cao: auth, sync, access policy, audit chain, document worker, router/state và component enhancer.
3. Chạy `npm test`, đọc báo cáo coverage và cảnh báo runtime của test.
4. Kiểm tra cấu hình và artifact secure build hiện hành.
5. Đọc workflow CI/security/performance/N+1.
6. Kiểm tra UI tĩnh theo Hallmark và quan sát các đường đi trực tiếp ở viewport desktop/mobile.
7. Đối chiếu implementation legacy với implementation tốt đã tồn tại trong chính repo, ví dụ `initCustomSelect` với `accessibleCombobox`, tab gói thầu với tab đánh giá chi tiết.

### 2.3. Cách hiểu mức ưu tiên

- **P0:** cần xử lý ngay hoặc là điều kiện trước public production; có khả năng lộ dữ liệu, vi phạm biên bảo mật hoặc tạo rủi ro pháp lý rõ ràng.
- **P1:** nên đưa vào sprint gần nhất; ảnh hưởng toàn vẹn dữ liệu, khả năng vận hành, truy vết hoặc gây lỗi lặp lại có hệ thống.
- **P2:** cải tiến có giá trị nhưng có thể lên lịch sau khi P0/P1 được kiểm soát.

Mức `critical/major/minor` trong phần Hallmark là **mức nghiêm trọng về UI/UX/accessibility**, không đồng nghĩa tự động với P0/P1 bảo mật.

### 2.4. Giới hạn

- Đây không phải pentest chủ động; audit không khai thác payload phá hoại hoặc truy cập dữ liệu production.
- Không có quyền quan sát reverse proxy, TLS, lịch backup, region lưu trữ, alerting thực tế hay secret manager của môi trường production.
- Kết luận pháp lý chỉ xác định nội dung còn thiếu trong sản phẩm, không thay thế tư vấn pháp lý.
- Quan sát browser chỉ bao phủ các đường đi đã kiểm tra, không chứng minh toàn bộ 72 view asset đều không lỗi.
- Số liệu performance là local/CI-style measurement, không phải load test nhiều người dùng trên production.
- Coverage phản ánh test run tại thời điểm audit, không phải tỷ lệ rủi ro được loại bỏ.

---

## 3. Baseline kỹ thuật và điểm mạnh

### 3.1. Kiến trúc hiện tại

- Backend Starlette/Python 3.14 với PostgreSQL.
- Frontend vanilla ES modules, Vite, DOMPurify và Lucide.
- Local/offline state, mutation outbox, delta sync, row-version conflict và WebSocket invalidation.
- Word/Excel/document worker tách biệt, có durable job và sandbox production.
- Một SPA phục vụ các vai trò super admin, manager và employee.

Route HTTP, WebSocket, export, auth/admin và SPA hiện được compose trong một danh sách trung tâm tại [backend/app.py:787](../../backend/app.py#L787). Frontend có cơ chế cài module lên prototype và kiểm tra collision tại [frontend/app/moduleRegistry.js:10](../../frontend/app/moduleRegistry.js#L10), đồng thời lazy-import hai nhóm workflow bidding/partner tại [frontend/app/WorkflowModuleLoader.js:55](../../frontend/app/WorkflowModuleLoader.js#L55).

### 3.2. Quy mô snapshot

| Chỉ số | Giá trị |
|---|---:|
| File Python backend | 143 |
| File JavaScript frontend | 220 |
| Test source | 28 Python + 50 JavaScript |
| Tổng file trong `views/` | 72 |
| `backend/sync/mapper.py` | 2.078 dòng |
| `backend/auth/auth_routes.py` | 2.054 dòng |
| `frontend/app/BiddingView.js` | 1.599 dòng |
| `frontend/app/BiddingController.js` | 1.356 dòng |
| `views/css/views.css` | 5.830 dòng |
| `views/css/ui-redesign.css` | 3.073 dòng |

Các số trên tự thân không phải bug. Chúng cho biết một số module đang có interface rộng và locality thấp: để thay đổi một workflow, người phát triển phải biết state, route, DOM, persistence và sync ở nhiều nơi.

### 3.3. Điểm mạnh đáng giữ nguyên

1. **Tenant isolation được đưa xuống schema.** Hàm áp tenant constraints yêu cầu child và parent cùng mang organization key, giúp PostgreSQL chặn cross-tenant link thay vì chỉ dựa vào application code: [backend/db/schema.py:1621](../../backend/db/schema.py#L1621).
2. **Migration có kỷ luật.** PostgreSQL initialization dùng advisory transaction lock, schema contract, FK verification và commit nguyên khối: [backend/db/postgres_schema.py:1079](../../backend/db/postgres_schema.py#L1079).
3. **Credential/session tốt.** Mật khẩu mới dùng Argon2id tại [backend/auth/auth_helper.py:51](../../backend/auth/auth_helper.py#L51); session tra cứu bằng `token_hash` và có revoke tại [backend/auth/session_store.py:95](../../backend/auth/session_store.py#L95).
4. **Browser security tốt hơn mức phổ biến.** Middleware bật `require-trusted-types-for 'script'` tại [backend/http_middleware.py:193](../../backend/http_middleware.py#L193); frontend đưa HTML qua policy/DOMPurify tại [frontend/shared/trustedTypes.js:140](../../frontend/shared/trustedTypes.js#L140); build có policy regression test tại [scripts/check_trusted_types_policy.mjs:23](../../scripts/check_trusted_types_policy.mjs#L23).
5. **Document parser được coi là untrusted.** Production yêu cầu sandbox identity tách biệt, Bubblewrap và seccomp tại [backend/documents/document_sandbox.py:148](../../backend/documents/document_sandbox.py#L148) và [backend/documents/seccomp_policy.py:68](../../backend/documents/seccomp_policy.py#L68).
6. **Dialog accessibility đã có implementation tốt.** Focus trap, Escape, `aria-modal`, inert state và restore focus được xử lý tập trung tại [frontend/shared/dialogAccessibility.js:43](../../frontend/shared/dialogAccessibility.js#L43) và [frontend/shared/dialogAccessibility.js:86](../../frontend/shared/dialogAccessibility.js#L86).
7. **CI tương đối trưởng thành.** Full CI dựng PostgreSQL 17, chạy check/build/package, performance và nhiều E2E nghiệp vụ tại [.github/workflows/ci.yml:20](../../.github/workflows/ci.yml#L20) và [.github/workflows/ci.yml:54](../../.github/workflows/ci.yml#L54).
8. **Supply-chain controls tốt.** Gitleaks/dependency review tại [.github/workflows/security.yml:13](../../.github/workflows/security.yml#L13), CodeQL cho Python/JavaScript tại [.github/workflows/codeql.yml:14](../../.github/workflows/codeql.yml#L14), SBOM được tạo bởi [scripts/generate_sbom.py:1](../../scripts/generate_sbom.py#L1).
9. **Có performance và N+1 gate riêng.** Startup workflow chạy 30 cold + 30 warm samples với ngân sách cụ thể tại [.github/workflows/startup-performance.yml:50](../../.github/workflows/startup-performance.yml#L50); N+1 regression chạy riêng tại [.github/workflows/n-plus-one-regressions.yml:11](../../.github/workflows/n-plus-one-regressions.yml#L11).
10. **Các module hàng hóa trọng yếu đã có coverage khá.** Bidder goods 88%, package goods 85%, goods preference 85%, field manifest 98% và package document policy 92% trong test run audit.

---

## 4. Kết quả kiểm chứng: test, coverage, performance và build

### 4.1. Test run

Lệnh `npm test` tại snapshot audit:

| Bộ test | Kết quả |
|---|---:|
| Python/pytest | 162 passed |
| JavaScript/Node test runner | 212 passed |
| Tổng | 374 passed |
| Backend statement coverage | 28,60% — báo cáo terminal làm tròn 29% |
| Threshold hiện tại | 28% |

Threshold 28% được khai báo trực tiếp trong script `test` tại [package.json:7](../../package.json#L7). Đây là guard “không tụt dưới baseline”, chưa phải bằng chứng các boundary quan trọng đã được kiểm tra đủ.

Test run có hai nhóm cảnh báo cần dọn:

- Starlette `TestClient` deprecation warning;
- `ResourceWarning: unclosed database` từ một số SQLite fixture. Ví dụ helper tạo connection nhưng không có fixture finalizer/context manager tại [tests/test_bidder_goods.py:99](../../tests/test_bidder_goods.py#L99), [tests/test_package_goods.py:142](../../tests/test_package_goods.py#L142) và [tests/test_package_documents.py:191](../../tests/test_package_documents.py#L191).

Sau khi sửa, nên bật warnings-as-errors cho đúng nhóm warning để rò tài nguyên không quay lại.

### 4.2. Coverage lệch theo rủi ro

Các vùng tốt:

| Module | Coverage |
|---|---:|
| `backend/sync/bidder_goods.py` | 88% |
| `backend/sync/package_goods.py` | 85% |
| `backend/domain/goods_preference.py` | 85% |
| `backend/sync/record_validator.py` | 85% |
| `backend/documents/field_manifest.py` | 98% |
| `backend/documents/package_document_policy.py` | 92% |
| `backend/shared/subscription_policy.py` | 83% |
| `backend/notifications/service.py` | 80% |

Các vùng rủi ro cao nhưng coverage thấp:

| Module | Coverage |
|---|---:|
| `backend/auth/auth_routes.py` | 8% |
| `backend/auth/admin_user_routes.py` | 23% |
| `backend/startup.py` | 9% |
| `backend/sync/service.py` | 19% |
| `backend/sync/websocket.py` | 11% |
| `backend/sync/pagination.py` | 0% |
| `backend/lot_lifecycle_routes.py` | 8% |
| `backend/lot_lifecycle_service.py` | 11% |
| `backend/observability/metrics.py` | 11% |
| `backend/documents/routes_docx.py` | 0% |
| `backend/documents/docx_service.py` | 0% |
| `backend/documents/docx_bid_context_service.py` | 0% |
| `backend/documents/package_document_routes.py` | 14% |

Khuyến nghị không phải tăng coverage toàn repo một cách máy móc. Cần đặt branch/per-module threshold cho auth, access policy, sync, tombstone, readiness, lot lifecycle và document job. Regression test cho các finding P0/P1 phải được viết trước khi sửa.

### 4.3. Static analysis

Ruff hiện chỉ bắt nhóm lỗi fatal `E9,F63,F7,F82` tại [pyproject.toml:39](../../pyproject.toml#L39). Script quality riêng dùng debt ratchet, chỉ ngăn năm nhóm lỗi cũ tăng thêm:

- `BLE001`: 151;
- `F401`: 60;
- `F841`: 13;
- `S110`: 16;
- `S608`: 129.

Các baseline nằm tại [scripts/check_python_quality.py:14](../../scripts/check_python_quality.py#L14). Đây là chiến lược hợp lý để không chặn toàn bộ dự án, nhưng cần có lịch burn-down; nếu chỉ “không tăng”, debt sẽ tồn tại vô thời hạn.

### 4.4. Performance

Lần đo trong phiên audit gần nhất ghi nhận khoảng:

- cold p95: **527 ms**;
- warm p95: **294 ms**.

Cả hai nằm trong ngân sách workflow hiện tại: cold p95 800 ms, warm p95 300 ms, long task 100 ms tại [.github/workflows/startup-performance.yml:50](../../.github/workflows/startup-performance.yml#L50). Script tính nearest-rank percentile và ghi cả request/transfer/long-task metrics tại [scripts/measure_startup.mjs:29](../../scripts/measure_startup.mjs#L29).

Kết luận: bundle lớn chưa gây regression startup theo gate hiện tại. Vì vậy code splitting là P2 có kiểm soát, không phải thay đổi khẩn cấp.

### 4.5. Secure build và obfuscation

Secure build **thực sự đang làm rối và chèn dead code**:

- `deadCodeInjection: true`;
- threshold `0.02`;
- transformer `javascript-obfuscator@5.4.3`;
- JS trước transform: 1.482.621 byte;
- JS sau transform: 2.605.790 byte, tăng khoảng 75,8%;
- CSS production: 337.291 byte;
- output bundler trong phiên audit xấp xỉ 670 KB gzip cho JS.

Cấu hình nằm tại [vite.config.js:20](../../vite.config.js#L20), marker artifact tại [dist/secure-build.json:1](../../dist/secure-build.json#L1). Script kiểm tra hash, kích thước, marker `_0x...` và yêu cầu output lớn hơn input tại [scripts/check_secure_build_artifacts.mjs:11](../../scripts/check_secure_build_artifacts.mjs#L11).

**Không coi obfuscation là security boundary.** Mã client cuối cùng vẫn được gửi cho trình duyệt và có thể bị phân tích. Obfuscation chỉ tăng chi phí reverse engineering/IP friction. Không nên tăng dead-code injection chỉ để mã “trông rối hơn”, vì đổi lại là parse/compile/download cost mà không thay thế authorization, validation hay bảo vệ secret phía server.

Vite hiện cố ý giữ một JS entry, `codeSplitting: false`, cho đến khi route-level chunking có Trusted Types và startup-budget coverage tương ứng: [vite.config.js:142](../../vite.config.js#L142) và [vite.config.js:151](../../vite.config.js#L151).

### 4.6. Quan sát browser trực tiếp

Các quan sát trong phạm vi đã kiểm tra:

- deep-link vào **báo cáo đánh giá chi tiết** giữ được màn hình sau F5;
- nếu mới chỉ chọn parent workflow tab “Báo cáo đánh giá E-HSDT”, F5 có thể trở lại tab đầu “Thông tin gói thầu”; state parent tab chỉ nằm trong RAM tại [frontend/packages/detail/PackageDetailState.js:38](../../frontend/packages/detail/PackageDetailState.js#L38);
- trên mobile có trường hợp fallback hiển thị raw ID dạng `user-...`, phù hợp với code fallback tại [frontend/shared/MultiAssigneeSelect.js:45](../../frontend/shared/MultiAssigneeSelect.js#L45);
- không thấy global horizontal overflow tại viewport được kiểm tra;
- không thấy page/console error ở các path được kiểm tra;
- responsive shell và bảng hàng hóa giữ nội dung trong scroll frame ở các kích thước đã kiểm tra.

Không nên diễn giải hai dòng “không thấy lỗi” thành bảo đảm toàn ứng dụng. E2E UI-quality chính thức hiện chỉ mở `/dang-nhap` tại 1280×720 và 390×844: [scripts/verify_ui_quality_e2e.mjs:4](../../scripts/verify_ui_quality_e2e.mjs#L4) và [scripts/verify_ui_quality_e2e.mjs:26](../../scripts/verify_ui_quality_e2e.mjs#L26).

---

## 5. Findings backend, security, data và offline

### BF-SEC-01 — Conflict response có thể làm lộ bản ghi không được phép đọc

**Ưu tiên:** P0  
**Tác động:** Confidentiality/authorization boundary  
**Độ tin cậy:** Cao

**Bằng chứng**

- Upsert path gọi authorize nhưng khi bị từ chối chỉ append lỗi rồi vẫn tiếp tục đọc version; khi version lệch, response gắn raw `serverRecord`: [backend/sync/record_validator.py:166](../../backend/sync/record_validator.py#L166), [backend/sync/record_validator.py:202](../../backend/sync/record_validator.py#L202).
- Delete path kiểm tra version và trả `serverRecord` trước khi kiểm tra quyền write: [backend/sync/deletion_service.py:219](../../backend/sync/deletion_service.py#L219), [backend/sync/deletion_service.py:243](../../backend/sync/deletion_service.py#L243).
- Sync service trả danh sách validation errors này trực tiếp cho client: [backend/sync/service.py:607](../../backend/sync/service.py#L607).

**Kịch bản rủi ro**

Một thành viên cùng tổ chức nhưng không có module/assignment permission, nếu biết ID bản ghi và gửi expected version sai, có thể nhận server representation của bản ghi. Tùy bảng, dữ liệu có thể gồm tài chính nhà thầu hoặc định danh chuyên gia.

**Fix đề xuất**

1. Authorize trước mọi fetch/compare được phản chiếu ra client; fail fast bằng denial không cho phép enumeration.
2. Chỉ thêm `serverRecord` sau `can_read_record` độc lập với `can_write_record`.
3. Project DTO xung đột qua sensitive-field policy; không trả model đầy đủ mặc định.
4. Thêm integration test cho upsert và delete: cùng org nhưng không có quyền, known ID, wrong expected version; response không được chứa current version hoặc server record.

### BF-LEGAL-01 — Trang pháp lý public còn nội dung chưa quyết định

**Ưu tiên:** P0 có điều kiện trước public production  
**Tác động:** Compliance, cam kết với khách hàng, incident/privacy readiness  
**Độ tin cậy:** Cao

Route `/legal` được public tại [backend/app.py:794](../../backend/app.py#L794). Ba trang có tổng cộng 27 placeholder `[TODO]` trên 21 dòng:

- Terms: pháp nhân/chủ sở hữu, cách thông báo thay đổi, luật áp dụng, địa chỉ/email tại [views/legal/terms.html:42](../../views/legal/terms.html#L42), [views/legal/terms.html:62](../../views/legal/terms.html#L62), [views/legal/terms.html:66](../../views/legal/terms.html#L66), [views/legal/terms.html:70](../../views/legal/terms.html#L70).
- Privacy: cơ sở xử lý, nhà cung cấp/region, retention, quyền dữ liệu, chuyển biên giới, contact tại [views/legal/privacy.html:36](../../views/legal/privacy.html#L36), [views/legal/privacy.html:40](../../views/legal/privacy.html#L40), [views/legal/privacy.html:56](../../views/legal/privacy.html#L56), [views/legal/privacy.html:84](../../views/legal/privacy.html#L84).
- Security: TLS/storage encryption, backup drill, vulnerability SLA, incident response và security contact tại [views/legal/security.html:20](../../views/legal/security.html#L20), [views/legal/security.html:44](../../views/legal/security.html#L44), [views/legal/security.html:56](../../views/legal/security.html#L56), [views/legal/security.html:76](../../views/legal/security.html#L76).

**Fix đề xuất**

Không tự suy luận câu trả lời từ source. Chủ sản phẩm, vận hành và tư vấn pháp lý cần chốt một bảng facts có owner/evidence, sau đó mới cập nhật trang. Nếu chưa public production, có thể giữ P0 condition; nếu đã public, nên xử lý ngay.

### BF-SYNC-01 — Client offline cũ có thể phục sinh bản ghi đã xóa

**Ưu tiên:** P1  
**Tác động:** Data integrity/offline conflict semantics  
**Độ tin cậy:** Cao

`baseSyncVersion` mới chỉ được kiểm tra cú pháp tại [backend/sync/payload_validation.py:396](../../backend/sync/payload_validation.py#L396); chưa có enforcement mutation-side đối với tombstone. Khi writer không tìm thấy row hiện tại, nó insert như bản ghi mới và đặt `row_version = 1`: [backend/sync/record_writer.py:55](../../backend/sync/record_writer.py#L55), [backend/sync/record_writer.py:103](../../backend/sync/record_writer.py#L103).

**Fix đề xuất**

- Nếu mutation trông như update nhưng tombstone cùng ID có `delete_version > baseSyncVersion`, trả conflict `RECORD_DELETED`.
- Nếu cursor cũ hơn tombstone retention, trả `FULL_SYNC_REQUIRED`.
- Restore phải là command riêng có audit/reason hoặc dùng ID mới; không cho edit cũ ngầm trở thành restore.
- Bắt buộc `clientMutationId` cho mọi request có mutation. Hiện field chỉ bị validate nếu có, tức vẫn optional: [backend/sync/payload_validation.py:388](../../backend/sync/payload_validation.py#L388).

### BF-OPS-01 — Readiness bỏ qua fail-closed state của audit monitor

**Ưu tiên:** P1  
**Tác động:** Traffic routing sau khi phát hiện audit-chain corruption  
**Độ tin cậy:** Cao

Audit monitor đặt `application.state.ready = false` khi chain invalid hoặc verifier lỗi tại [backend/shared/audit_monitor.py:254](../../backend/shared/audit_monitor.py#L254) và [backend/shared/audit_monitor.py:274](../../backend/shared/audit_monitor.py#L274). Tuy nhiên `/health/ready` chỉ kiểm tra `startup_complete` và database responsiveness tại [backend/app.py:608](../../backend/app.py#L608).

**Fix đề xuất**

Readiness phải yêu cầu `startup_complete && state.ready && database_ok`. Response chỉ nên có reason code hữu hạn, không lộ detail nội bộ. Thêm test cho transition `valid → invalid → valid/error` và hành vi orchestrator.

### BF-SEC-02 — Quyền view module đang cấp quá nhiều dữ liệu nhạy cảm

**Ưu tiên:** P1  
**Tác động:** Least privilege/PII/financial/signature media  
**Độ tin cậy:** Cao

Sensitive read policy cho phép full expert/contractor details và signature images chỉ dựa trên quyền module `view`: [backend/shared/sensitive_data.py:30](../../backend/shared/sensitive_data.py#L30). Protected image route dùng cùng coarse permission: [backend/app.py:711](../../backend/app.py#L711). Trong khi schema đã có ba capability `financial`, `identity`, `signature` cho document export tại [backend/db/schema.py:1489](../../backend/db/schema.py#L1489).

**Fix đề xuất**

- Dùng capability riêng cho API reads và media download, không chỉ document export.
- Default-deny sensitive fields; module view chỉ trả reference data tối thiểu.
- Audit grant/revoke và mọi sensitive download.
- Tách rõ `can_view_record`, `can_view_identity`, `can_view_financial`, `can_view_signature`.

### BF-AUDIT-01 — “Lịch sử chỉnh sửa” chưa bao phủ nghiệp vụ

**Ưu tiên:** P1  
**Tác động:** Traceability, dispute handling, accountability  
**Độ tin cậy:** Cao

`_RECORD_ACTIONS` chỉ có `goi_thau` và `hop_dong`; bảng khác trả `None`: [backend/activity/service.py:22](../../backend/activity/service.py#L22), [backend/activity/service.py:64](../../backend/activity/service.py#L64). Sync chỉ persist events có trong tracker tại [backend/sync/service.py:783](../../backend/sync/service.py#L783). Delete có audit-chain riêng tại [backend/sync/delete_policy.py:295](../../backend/sync/delete_policy.py#L295), nhưng UI “lịch sử chỉnh sửa” không nhờ đó mà có timeline đầy đủ cho create/update.

**Phạm vi đang thiếu đáng chú ý**

- biên bản mở thầu;
- vòng/tiêu chí/kết quả đánh giá;
- phần lô và danh mục hàng hóa;
- hàng hóa dự thầu;
- nhà thầu/chuyên gia;
- thay đổi quyền và assignment có liên quan tới một hồ sơ cụ thể.

**Fix đề xuất**

Mọi create/update/delete vật chất cần ghi immutable audit entry **trong cùng transaction**, gồm actor, request/client mutation ID, action, target/root ID, danh sách field đổi, before/after hash, reason tùy chọn. Không ghi secret hoặc PII dạng rõ nếu timeline không cần hiển thị chúng. Tách “activity feed dễ đọc” khỏi “audit evidence bất biến”, nhưng liên kết bằng event ID.

### BF-SYNC-02 — Delta sync không giới hạn theo page/byte

**Ưu tiên:** P2  
**Tác động:** Availability đối với workspace offline lâu  
**Độ tin cậy:** Cao

Mỗi bảng delta chạy `sync_version > after_version` rồi `fetchall`, không có `LIMIT`: [backend/sync/read_service.py:137](../../backend/sync/read_service.py#L137). Tombstone cũng không giới hạn: [backend/sync/read_service.py:294](../../backend/sync/read_service.py#L294). Route timeout sau 30 giây tại [backend/sync/read_service.py:50](../../backend/sync/read_service.py#L50), nhưng blocking future có thể tiếp tục chạy sau timeout do executor semantics tại [backend/shared/async_io.py:127](../../backend/shared/async_io.py#L127).

**Fix đề xuất**

Delta page cần `throughVersion` snapshot, record/byte limit, signed continuation cursor và stable ordering. Client chỉ advance durable cursor sau page cuối. Nếu cursor quá cũ, giữ `FULL_SYNC_REQUIRED` như hiện có tại [backend/sync/read_service.py:120](../../backend/sync/read_service.py#L120).

### BF-SYNC-03 — WebSocket outbox chưa cùng transaction với mutation

**Ưu tiên:** P2  
**Tác động:** Có thể mất real-time invalidation khi process crash  
**Độ tin cậy:** Cao

Business transaction commit trước rồi mới gọi broadcast tại [backend/sync/service.py:410](../../backend/sync/service.py#L410). Broker event dùng connection/transaction riêng tại [backend/sync/websocket.py:537](../../backend/sync/websocket.py#L537). Crash giữa hai commit để lại dữ liệu đã lưu nhưng không có invalidation event.

**Fix đề xuất**

Insert outbox row bằng cursor của transaction sync trước commit. Sau commit, `NOTIFY` chỉ là wake-up optimization. Consumer phải idempotent và có cơ chế scan pending events.

### BF-DOC-01 — Export dài vẫn giữ HTTP request và poll DB dày

**Ưu tiên:** P2  
**Tác động:** Web worker capacity, proxy timeout, UX export  
**Độ tin cậy:** Cao

Result consumer có deadline tối đa 900 giây và poll mỗi 50 ms tại [backend/documents/document_worker.py:872](../../backend/documents/document_worker.py#L872). Executor admission slot cố ý chỉ release khi underlying work xong dù HTTP request bị cancel: [backend/documents/document_worker.py:954](../../backend/documents/document_worker.py#L954). DOCX route await job đồng bộ: [backend/documents/routes_docx.py:466](../../backend/documents/routes_docx.py#L466).

**Fix đề xuất**

Trả `202 Accepted` với job ID gắn user/workspace; thêm status/download endpoint hoặc notification. Dùng LISTEN/NOTIFY hoặc exponential backoff. Chỉ giữ fast synchronous path cho export nhỏ có deadline ngắn.

### BF-MEDIA-01 — Crash có thể để lại primary image mồ côi

**Ưu tiên:** P2  
**Tác động:** Storage leak  
**Độ tin cậy:** Trung bình-cao

Image được ghi trước khi transaction DB bắt đầu: [backend/sync/service.py:517](../../backend/sync/service.py#L517). Normal failure path dọn image trong `finally`: [backend/sync/service.py:840](../../backend/sync/service.py#L840), nhưng process kill không chạy finally. Retention hiện chỉ purge file derivative có `_opt_`: [backend/lifecycle.py:164](../../backend/lifecycle.py#L164).

**Fix đề xuất**

Ghi vào staging namespace kèm durable asset journal, promote sau commit, và chạy grace-period mark-and-sweep so file được quản lý với DB references.

### BF-TEST-01 — Quality gate chưa bảo vệ đủ các boundary trên

**Ưu tiên:** P1 cho test BF-SEC-01/BF-SYNC-01/BF-OPS-01; P2 cho burn-down rộng  
**Tác động:** Regression prevention

Aggregate coverage 28% tại [package.json:7](../../package.json#L7) và Ruff fatal-only tại [pyproject.toml:39](../../pyproject.toml#L39) cho phép các đường authorization-order, tombstone và readiness lọt qua dù suite lớn.

**Fix đề xuất**

1. Viết test tái hiện ba finding trên trước khi implement fix.
2. Đặt branch coverage/per-module threshold cho auth/sync/access policy/audit/document queue.
3. Dọn resource warnings rồi fail CI trên warning mới.
4. Mở rộng Ruff theo từng đợt, gắn owner và giảm baseline hàng quý.

---

## 6. Findings kiến trúc, module, frontend state và router

### BF-ARCH-01 — Quy tắc vòng đời bị lặp bằng chuỗi hiển thị

**Ưu tiên:** P1  
**Vấn đề module:** interface nghiệp vụ chưa đủ sâu

Backend đã có code/label canonical tại [backend/shared/domain_enums.py:3](../../backend/shared/domain_enums.py#L3) và transition table tại [backend/sync/payload_validation.py:32](../../backend/sync/payload_validation.py#L32). Tuy vậy frontend vẫn so sánh trực tiếp chuỗi tiếng Việt ở nhiều nơi:

- dashboard color/progress: [frontend/app/DashboardView.js:9](../../frontend/app/DashboardView.js#L9), [frontend/app/DashboardView.js:127](../../frontend/app/DashboardView.js#L127);
- form field visibility/lock: [frontend/app/BiddingControllerForms.js:758](../../frontend/app/BiddingControllerForms.js#L758);
- timeline: [frontend/packages/PackageTimelineView.js:26](../../frontend/packages/PackageTimelineView.js#L26);
- package tabs: [frontend/packages/detail/PackageTabs.js:87](../../frontend/packages/detail/PackageTabs.js#L87);
- workflow transitions: [frontend/packages/GoiThauWorkflow.js:423](../../frontend/packages/GoiThauWorkflow.js#L423).

Điều này khiến đổi label/chính tả hoặc thêm trạng thái có thể làm dashboard, tab, form và backend hiểu khác nhau.

**Fix đề xuất**

Tạo `LifecyclePolicy` với interface presentation-neutral:

```text
normalizeStatus(value) -> code
allowedTransitions(code, context) -> code[]
fieldPolicy(code, packageType) -> { editable, required, visible }
workflowStep(code, method, lotState) -> step
presentStatus(code) -> { label, tone, icon }
```

Backend là nguồn chuẩn; generate/version frontend contract thay vì copy string. Đây phải là module sâu: caller không tự suy luận trạng thái.

### BF-ARCH-02 — Controller/View lớn và prototype installation làm interface rộng

**Ưu tiên:** P1 theo hướng refactor dần, không rewrite

`BiddingController.js` có 1.356 dòng, `BiddingView.js` 1.599 dòng, `BiddingControllerForms.js` 1.070 dòng. Prototype module registry có guard collision tốt tại [frontend/app/moduleRegistry.js:14](../../frontend/app/moduleRegistry.js#L14), nhưng command từ nhiều module cùng hoạt động trên một object controller mutable rộng. Constructor đã sở hữu route map, temp media, wizard và nhiều state khác tại [frontend/app/BiddingController.js:31](../../frontend/app/BiddingController.js#L31).

**Rủi ro**

- caller phải hiểu implementation/state rộng;
- khó dispose event/subscription theo feature;
- test dễ phải dựng controller lớn;
- locality thấp: route, DOM, model và sync thay đổi cùng lúc.

**Fix đề xuất**

Không thêm pass-through service chỉ để chia file. Tách theo workflow thành module có lifecycle `mount/navigate/save/dispose` và state riêng. Prototype registry có thể giữ cho legacy trong giai đoạn chuyển đổi, nhưng API mới không cài command lên global controller.

### BF-ARCH-03 — Route state chưa có một nguồn chuẩn

**Ưu tiên:** P1

Route parsing/lookup đang nằm trong một hàm orchestration dài tại [frontend/app/BiddingControllerUI.js:154](../../frontend/app/BiddingControllerUI.js#L154). Parent package tab chỉ gán `_currentWorkflowTab`/`_currentWorkflowPackageId` trên view object tại [frontend/packages/detail/PackageDetailState.js:38](../../frontend/packages/detail/PackageDetailState.js#L38). Tab header click lại mutate nhiều state điều phối trực tiếp tại [frontend/packages/detail/PackageDetailCoordinator.js:65](../../frontend/packages/detail/PackageDetailCoordinator.js#L65).

Đây là nguyên nhân kiến trúc của hiện tượng deep-link con có thể sống qua F5 nhưng parent workflow tab thì không.

**Fix đề xuất**

Tạo `RouteRegistry` và `PackageWorkspaceState` duy nhất cho:

```text
{ packageId, workflowTab, evaluationRoundId, bidId, detailTab, lotScope, dirty }
```

Yêu cầu test:

- `parse(serialize(state)) === state`;
- F5 giữ đúng parent + child tab;
- back/forward không mất lot scope;
- route invalid fallback có chủ đích;
- dirty state không bị silent discard.

### BF-ARCH-04 — Mutation, persist, outbox, sync và rollback chưa nằm sau một seam

**Ưu tiên:** P1

`MutationService` vẫn cho `mutate(model.state)` và gán trực tiếp từng table, sau đó stage local records: [frontend/shared/MutationService.js:68](../../frontend/shared/MutationService.js#L68). `persistAndSync` tự điều phối persist, outbox, autoSync và render flags: [frontend/shared/MutationService.js:1](../../frontend/shared/MutationService.js#L1). Các workflow phức tạp vẫn phải tự snapshot/rollback nhiều bảng; ví dụ bidder-goods flow tại [frontend/packages/BidderGoodsWorkflow.js:671](../../frontend/packages/BidderGoodsWorkflow.js#L671).

**Fix đề xuất**

Tạo interface sâu:

```text
WorkspaceDataStore.transaction({ tables, mutationId }, mutate)
```

Implementation chịu trách nhiệm snapshot, validate, local commit, persist, outbox, sync, rollback và một lần render notification. Bên ngoài không được gán trực tiếp `model.state[table]`.

### BF-ARCH-05 — Backend app composition và một số route module quá rộng

**Ưu tiên:** P2, trừ khi chạm vào vùng đang sửa P0/P1

`backend/app.py` vừa cấu hình/static delivery/health vừa compose toàn bộ route từ sync tới auth/admin và SPA tại [backend/app.py:787](../../backend/app.py#L787). Một số module có quy mô lớn: `auth_routes.py` 2.054 dòng, `org_routes.py` 1.261 dòng, `sync/mapper.py` 2.078 dòng.

**Fix đề xuất**

- Mỗi feature export `routes()` hoặc router list riêng: auth, org, sync, documents, notifications, package lifecycle, SPA/static.
- App factory chỉ compose dependencies/middleware/routes/lifespan.
- Với mapper/schema, ưu tiên contract/generator và test round-trip; không tạo thêm wrapper mỏng chỉ chuyển tiếp.

### BF-ARCH-06 — Single bundle lớn nhưng chưa phải regression hiện tại

**Ưu tiên:** P2

Secure JS khoảng 2,61 MB và CSS khoảng 337 KB. Vite cố ý tắt code splitting để giữ Trusted Types/startup behavior ổn định tại [vite.config.js:142](../../vite.config.js#L142). Startup p95 vẫn đạt budget.

**Fix đề xuất sau khi state/module ổn định**

Chia theo route/role có leverage cao:

1. shell/auth/dashboard;
2. admin;
3. documents/Word/Excel;
4. partner management;
5. package detail/evaluation.

Mỗi chunk change phải giữ Trusted Types tests, CSP, offline behavior và startup budget. Không đổi chỉ vì warning kích thước.

### BF-ARCH-07 — Thiếu tài liệu kiến trúc/domain decision

**Ưu tiên:** P1 nhẹ, làm song song với refactor

Trước report này, `docs/` không có architecture overview, ADR hoặc domain model được tìm thấy. Với domain có trạng thái gói thầu, lô, vòng đánh giá, offline conflict và document trust boundary, kiến thức chỉ nằm trong implementation.

**Tài liệu tối thiểu cần có**

- architecture overview và module ownership;
- package lifecycle/state machine;
- evaluation round + lot scope model;
- offline/outbox/conflict/tombstone guarantees;
- document worker trust model;
- ADR single-bundle/Trusted Types;
- ADR immutable audit/migration policy;
- glossary/ubiquitous language Việt–code.

---

## 7. Audit UI/UX theo Hallmark

### 7.1. Tổng kết Hallmark

**3 critical · 6 major · 1 minor**

Điểm tích cực cần giữ:

- visual desktop khá polished;
- dialog có focus trap/restore focus;
- detailed evaluation đã có ARIA tabs đúng;
- có `prefers-reduced-motion` ở nhiều stylesheet, ví dụ [views/css/base.css:220](../../views/css/base.css#L220);
- bảng bidder goods có test viewport 320–1920 và giữ bảng trong scroll frame tại [tests/js/bidder_goods_layout.test.mjs:140](../../tests/js/bidder_goods_layout.test.mjs#L140);
- dùng Lucide tương đối thống nhất;
- không có global overflow trên path/viewport được quan sát.

### H-C01 — Hover/click-only affordance: custom select legacy không dùng được đầy đủ bằng bàn phím

**Severity:** critical

**Tell**

Native `<select>` bị ẩn rồi thay bằng `div + ul`; trigger chỉ nghe click, không có `tabindex`, `role=combobox`, `aria-expanded`, Arrow/Enter/Escape. Control trông hoàn chỉnh bằng chuột nhưng không có equivalent interaction cho keyboard/screen reader.

**Where**

- mọi select phù hợp bị auto-upgrade tại [frontend/app/BiddingView.js:192](../../frontend/app/BiddingView.js#L192);
- native select bị ẩn và trigger `div` được tạo tại [frontend/shared/view_helpers.js:162](../../frontend/shared/view_helpers.js#L162), [frontend/shared/view_helpers.js:216](../../frontend/shared/view_helpers.js#L216), click binding tại [frontend/shared/view_helpers.js:250](../../frontend/shared/view_helpers.js#L250);
- implementation tốt đã tồn tại: ARIA combobox/listbox tại [frontend/shared/accessibleCombobox.js:41](../../frontend/shared/accessibleCombobox.js#L41), keyboard behavior tại [frontend/shared/accessibleCombobox.js:188](../../frontend/shared/accessibleCombobox.js#L188).

**Fix**

Ngừng tạo select mới bằng `initCustomSelect`; migrate về `accessibleCombobox` hoặc native select. Thêm test keyboard-only, screen-reader semantics, typeahead, Escape, outside click và dropdown positioning.

### H-C02 — Stamp lies, design-system drift và mid-render token improvisation

**Severity:** critical

**Tell**

CSS tự khai báo `design-system: design.md` nhưng repo không có `design.md`. Đồng thời có nhiều hệ token (`--color-*`, `--brand/--ink`, `--primary/--text-main`), Workbench pass chủ yếu desktop, raw colors/hash utility và compatibility overrides cùng tồn tại. “Con dấu” thiết kế không còn phản ánh một nguồn chuẩn có thật.

**Where**

- stamp và OKLCH tokens tại [views/css/tokens.css:1](../../views/css/tokens.css#L1);
- stamp khác tại [views/css/ui-redesign.css:1](../../views/css/ui-redesign.css#L1);
- hệ hex/alias song song tại [views/css/variables.css:28](../../views/css/variables.css#L28);
- Workbench override chỉ bắt đầu ở desktop media query tại [views/css/ui-redesign.css:2584](../../views/css/ui-redesign.css#L2584);
- app import 12 stylesheet theo thứ tự override tại [views/css/app.css:1](../../views/css/app.css#L1);
- generated hash styles tại [views/css/generated-static-styles.css:1](../../views/css/generated-static-styles.css#L1).

Số liệu tĩnh snapshot:

- 847 color-like raw values;
- 424 `!important`;
- 571 generated `.bf-s-*` definitions;
- CSS production 337.291 byte;
- z-index rời rạc tới 1.000.000, ví dụ [views/css/base.css:29](../../views/css/base.css#L29) và [views/css/components.css:1476](../../views/css/components.css#L1476).

**Fix**

Chọn một token source thật và tạo tài liệu thiết kế/ownership thật, hoặc bỏ stamp. Dùng cascade layers `tokens, base, components, features, utilities, legacy`; tạo z-index scale; cấm raw color/`!important` mới ngoài compatibility layer bằng lint; migrate theo component chứ không bulk rewrite.

### H-C03 — Input-state gate: focus indicator quá yếu

**Severity:** critical

**Tell**

Global focus width chỉ 1 px; form focus xóa outline rồi dùng border + ring alpha 0,24. Với bàn phím/low vision, trạng thái focus dễ bị lẫn với border bình thường.

**Where**

- token focus 1 px tại [views/css/variables.css:53](../../views/css/variables.css#L53);
- global focus dùng width token tại [views/css/base.css:47](../../views/css/base.css#L47);
- form focus ghi đè `outline: none` tại [views/css/ui-redesign.css:1131](../../views/css/ui-redesign.css#L1131).

**Fix**

Dùng `outline: 2px solid var(--color-focus); outline-offset: 2px`, không đổi border width khi focus, kiểm tra contrast focus ≥3:1 trên mọi surface và thêm screenshot/keyboard regression.

### H-M01 — Tab gói thầu hoàn chỉnh một nửa và state nằm trong RAM

**Severity:** major

**Tell**

Button có `role=tab` nhưng container thiếu `role=tablist`, button thiếu `aria-controls`, roving tabindex và Arrow/Home/End; current tab chỉ lưu trên view object nên F5 không giữ parent tab.

**Where**

- header tab tại [frontend/packages/detail/PackageDetailCoordinator.js:9](../../frontend/packages/detail/PackageDetailCoordinator.js#L9);
- RAM state tại [frontend/packages/detail/PackageDetailState.js:38](../../frontend/packages/detail/PackageDetailState.js#L38);
- implementation tốt để tái dùng tại [frontend/packages/detail/DetailedEvaluationPanel.js:440](../../frontend/packages/detail/DetailedEvaluationPanel.js#L440) và [frontend/packages/detail/DetailedEvaluationPanel.js:643](../../frontend/packages/detail/DetailedEvaluationPanel.js#L643).

**Fix**

Tạo một Tabs primitive accessible, sync tab state vào URL/history qua `RouteRegistry`, thêm test Arrow/Home/End, focus retention, back/forward và F5.

### H-M02 — Runtime-inferred action system

**Severity:** major

**Tell**

Variant và icon được suy luận từ ID/text/title tiếng Việt; MutationObserver chạy enhancer sau khi node được thêm. Thay copy có thể vô tình đổi icon/variant, đồng thời icon có thể chớp hoặc mất khi rerender.

**Where**

- regex suy luận icon/variant tại [frontend/shared/buttonSystem.js:1](../../frontend/shared/buttonSystem.js#L1) và [frontend/shared/buttonSystem.js:38](../../frontend/shared/buttonSystem.js#L38);
- enhancer mutate class/icon tại [frontend/shared/buttonSystem.js:79](../../frontend/shared/buttonSystem.js#L79);
- MutationObserver gọi enhancer tại [frontend/shared/semanticAccessibility.js:95](../../frontend/shared/semanticAccessibility.js#L95).

**Fix**

Khai báo `variant`, `icon`, `loading`, `ariaLabel` ở nơi render bằng Button/Action factory. Runtime enhancer chỉ giữ tạm cho legacy và phát dev warning để có migration inventory.

### H-M03 — Workbench nghiệp vụ bị nhốt trong modal quá dài

**Severity:** major

**Tell**

Form gói thầu dài 534 dòng, chứa nhiều nhóm input/select/table trong một modal-body có scroll riêng. Người dùng dễ mất vị trí, bỏ sót lỗi và mất draft khi đóng.

**Where**

- modal bắt đầu tại [views/modals/modal_goithau.html:2](../../views/modals/modal_goithau.html#L2), form kéo tới footer tại [views/modals/modal_goithau.html:508](../../views/modals/modal_goithau.html#L508);
- modal body luôn `overflow-y: scroll` tại [views/css/components.css:866](../../views/css/components.css#L866).

**Fix**

Chuyển create/edit gói thầu thành routed workbench hoặc page-sized sheet có section navigation, sticky action bar, autosave draft và error summary link tới trường lỗi. Modal chỉ phù hợp với thao tác ngắn.

**Quyết định ngày 30/07/2026:** hạng mục chuyển form khỏi modal **tạm hoãn** theo DEC-06. Finding vẫn được giữ để phản ánh nợ UX đã xác định, nhưng routed workbench/draft-flow redesign không thuộc roadmap triển khai hiện tại. Các sửa lỗi bảo mật, validation, accessibility và ngăn mất dữ liệu trong modal vẫn được phép thực hiện.

### H-M04 — Celebratory success toasts gây feedback fatigue

**Severity:** major

**Tell**

Hầu hết thao tác lưu/thêm/cập nhật được chuẩn hóa thành toast “Thành công”, kể cả khi kết quả đã hiển thị ngay trên màn hình. Nhiều notification cạnh tranh sự chú ý và làm giảm giá trị của cảnh báo thật.

**Where**

- bảng mapping success action rộng tại [frontend/shared/toastFeedback.js:3](../../frontend/shared/toastFeedback.js#L3) và [frontend/shared/toastFeedback.js:125](../../frontend/shared/toastFeedback.js#L125);
- renderer tự đặt title “Thành công” tại [frontend/app/BiddingView.js:1155](../../frontend/app/BiddingView.js#L1155).

**Fix**

Đặt feedback policy:

- local field error: inline + focus;
- aggregate submit error: summary/banner hoặc popup đã được nghiệp vụ duyệt;
- visible synchronous success: silent hoặc “Đã lưu lúc…” cạnh action;
- async/background/non-visible result: toast;
- irreversible/cross-record conflict: modal.

Giữ ngoại lệ nghiệp vụ đã quyết định, ví dụ popup cảnh báo tổng hàng hóa dự thầu lệch giá khi người dùng bấm lưu chính thức.

### H-M05 — Rò raw internal ID ra giao diện

**Severity:** major

**Tell**

Nếu employee chưa hydrate hoặc không còn trong cache, UI fallback thẳng sang `employee.id`/`assignment.empId`; mobile có thể hiển thị `user-...`.

**Where**

- fallback tại [frontend/shared/MultiAssigneeSelect.js:45](../../frontend/shared/MultiAssigneeSelect.js#L45);
- label được render vào bảng gói thầu tại [frontend/packages/GoiThauTable.js:257](../../frontend/packages/GoiThauTable.js#L257).

**Fix**

Không render technical ID. Dùng cached display name, “Nhân sự không còn hoạt động” hoặc skeleton. Mobile dùng tên đầu tiên/chip + `+N`, không nối chuỗi dài bằng dấu phẩy.

### H-M06 — UI test coverage tạo cảm giác an toàn lớn hơn phạm vi thật

**Severity:** major

**Tell**

UI-quality E2E thật chỉ kiểm tra trang login ở hai viewport. Một số layout test dựng HTML cô lập bằng `page.setContent`, nên không kiểm tra routing, auth state, dynamic enhancer, modal stack hay data hydration của ứng dụng thật.

**Where**

- login-only script tại [scripts/verify_ui_quality_e2e.mjs:4](../../scripts/verify_ui_quality_e2e.mjs#L4) và [scripts/verify_ui_quality_e2e.mjs:26](../../scripts/verify_ui_quality_e2e.mjs#L26);
- bidder-goods isolated DOM tại [tests/js/bidder_goods_layout.test.mjs:68](../../tests/js/bidder_goods_layout.test.mjs#L68);
- table vertical alignment isolated DOM tại [tests/js/table_vertical_alignment.test.mjs:18](../../tests/js/table_vertical_alignment.test.mjs#L18).

**Fix**

Thêm authenticated Playwright journeys tại 320/375/414/768/1280, axe scan, keyboard-only, F5/back/deep-link và screenshot regression cho tối thiểu: dashboard, danh sách gói thầu, package workbench, detailed evaluation/bidder goods và modal/form dài.

### H-m01 — Tooltip sidebar thu gọn chỉ xuất hiện khi hover

**Severity:** minor

**Tell**

Khi sidebar collapse, text bị ẩn; tooltip dùng selector `:hover` nhưng không có `:focus-visible`, nên keyboard user chỉ thấy icon.

**Where**

[views/css/components.css:133](../../views/css/components.css#L133) và [views/css/components.css:166](../../views/css/components.css#L166).

**Fix**

Áp cùng tooltip cho `:focus-visible` hoặc dùng tooltip primitive có hover delay, focus tức thời và Escape dismiss.

---

## 8. Các chỉ số debt giao diện cần theo dõi

Những số này là inventory để quản trị xu hướng, không phải mục tiêu “xóa sạch trong một PR”:

| Chỉ số | Snapshot |
|---|---:|
| Stylesheet import trong `app.css` | 12 |
| `!important` trong CSS | 424 |
| Raw color-like values | 847 |
| Generated `.bf-s-*` definitions | 571 |
| `setRuntimeStyle(...)` calls | 565 |
| HTML sink assignments/calls được quét | 248 |
| `customAlert(...)` calls | 237 |
| `customConfirm(...)` calls | 34 |
| Z-index cao nhất thấy trong CSS | 1.000.000 |

248 HTML sinks không đồng nghĩa 248 lỗ XSS; Trusted Types/DOMPurify đang giảm rủi ro đáng kể. Số liệu cho thấy rendering surface vẫn rộng và cần contract/lint/test để tránh một sink mới bỏ qua policy.

565 runtime style calls cũng không tự thân là bug. Chúng cho thấy state/presentation còn coupling; component mới nên biểu diễn state bằng class/attribute và token thay vì mutate nhiều property sau render.

---

## 9. Kiến trúc mục tiêu đề xuất

Mục tiêu không phải tạo thêm nhiều file, mà là tăng **độ sâu module**: interface nhỏ che được implementation phức tạp, giảm knowledge mà caller phải mang theo.

### 9.1. `RouteRegistry`

**Sở hữu:** route schema, parse, serialize, canonical redirect, history/back/forward.

```text
parse(url) -> AppRoute
serialize(AppRoute) -> url
navigate(route, { replace, preserveDirty })
```

Không module feature nào tự split pathname hoặc tự push URL.

### 9.2. `PackageWorkspaceState`

**Sở hữu:** packageId, parent workflow tab, evaluation round, bid, child tab, lot scope, dirty/draft.

```text
load(route, model) -> state
transition(event) -> nextState/effects
snapshot() -> serializable route state
```

Đây là state machine của màn hình package detail, không phải một bag field trên `view`.

### 9.3. `WorkspaceDataStore`

**Sở hữu:** local mutation, validation, persistence, outbox, sync, rollback, subscription.

```text
transaction({ tables, mutationId }, mutate)
query(selector)
subscribe(selector, listener)
```

Model state trở thành private implementation. Transaction trả outcome typed: committed/offlineQueued/conflict/rejected.

### 9.4. `LifecyclePolicy`

**Sở hữu:** canonical status code, transitions, field policies, workflow step, label/tone presentation adapter.

Backend contract phải versioned và có test frontend-backend parity.

### 9.5. `PackageDetailModule`

**Sở hữu:** mount/render/event binding/dispose của package workbench.

```text
mount(root, { route, store, lifecyclePolicy })
navigate(route)
save(command)
dispose()
```

Mỗi child panel nhận data/commands cần thiết, không nhận toàn bộ controller/view/model.

### 9.6. Design-system primitives

Tối thiểu:

- `Button/Action`;
- `Select/Combobox`;
- `Tabs`;
- `Field/ErrorSummary`;
- `Dialog/Sheet`;
- `Toast/Status`;
- `TableFrame/Pagination`.

Mỗi primitive có state contract, ARIA contract, token contract và test keyboard/visual. Legacy enhancer được giữ tạm sau một compatibility seam và có telemetry/dev warning để biết còn bao nhiêu call site.

---

## 10. Danh sách ưu tiên đã được chấp thuận

| ID | Ưu tiên | Đề xuất | Lợi ích | Ước lượng tương đối | Điều kiện hoàn thành |
|---|---|---|---|---|---|
| BF-SEC-01 | P0 | Authorize trước conflict projection | Chặn lộ record | S | Regression tests upsert/delete pass; response không chứa record/version khi denied |
| BF-LEGAL-01 | P0 trước public | Chốt legal facts và thay 27 TODO | Production/compliance readiness | M, phụ thuộc quyết định ngoài code | Legal/security/privacy owner ký xác nhận nội dung |
| BF-SYNC-01 | P1 | Tombstone-aware mutation + explicit restore | Chặn phục sinh dữ liệu | M | Test stale offline edit, retained/expired tombstone và intentional restore |
| BF-OPS-01 | P1 | Gắn audit health vào readiness | Fail closed đúng nghĩa | S | Invalid audit chain trả 503 với bounded reason |
| BF-SEC-02 | P1 | Capability cho identity/financial/signature | Least privilege | M | API/media projection test theo role/capability |
| BF-AUDIT-01 | P1 | Audit mọi mutation vật chất trong transaction | Lịch sử đầy đủ, dispute evidence | L | Coverage matrix table × create/update/delete; redaction test |
| BF-TEST-01 | P1 | Risk-weighted test thresholds | Ngăn finding quay lại | M | Critical module threshold và warnings clean |
| BF-ARCH-03 | P1 | RouteRegistry + PackageWorkspaceState | Sửa F5/back/tab/lot state tận gốc | M–L | Route round-trip, F5, back/forward E2E |
| BF-ARCH-04 | P1 | WorkspaceDataStore transaction seam | Giảm rollback/sync bug | L, incremental | Một workflow trọng yếu không mutate `model.state` trực tiếp |
| H-C01/H-C03 | P1 | Accessible Select + focus ring | Keyboard/low-vision | M | Keyboard + axe tests; select legacy không được dùng mới |
| H-M02 | P1 | Explicit Button/Action contract | Chấm dứt icon/style chập chờn | M | Không suy luận icon ở component đã migrate |
| H-C02 | P1 | Một token source + cascade layers | Giảm CSS override regression | L, incremental | Design source thật; lint no-new raw/important |
| BF-SYNC-02 | P2 | Delta paging với throughVersion | Scale workspace offline | L | Cursor/page/byte/load tests |
| BF-SYNC-03 | P2 | Transactional WebSocket outbox | Không mất invalidation | M | Crash-between-commit test |
| BF-DOC-01 | P2 | Async export `202 + jobId` | Giảm giữ request/DB polling | M–L | Cancel/retry/status/download tests |
| BF-MEDIA-01 | P2 | Asset staging/journal/sweep | Không rò storage khi crash | M | Kill-point test và reconciliation job |
| BF-ARCH-06 | P2 | Route/role code splitting | Giảm tải JS ban đầu | M | Trusted Types + startup budget vẫn pass |

`S/M/L` là ước lượng tương đối, không phải cam kết ngày công; cần refine khi lập sprint. Các mục trong bảng được triển khai theo thứ tự khuyến nghị. Routed workbench cho form gói thầu không nằm trong bảng và đang tạm hoãn theo DEC-06.

---

## 11. Roadmap đã được chấp thuận

### Giai đoạn 0 — 1 đến 3 ngày: đóng boundary rõ nhất

1. Viết regression test và sửa BF-SEC-01.
2. Sửa BF-OPS-01.
3. Không render raw `user-*`.
4. Nâng focus ring lên 2 px.
5. Thêm `:focus-visible` cho tooltip sidebar.
6. Lập owner/fact sheet cho 27 legal TODO; chưa tự điền bằng giả định.

### Giai đoạn 1 — Sprint gần nhất: toàn vẹn và truy vết

1. Triển khai semantics đã chốt tại DEC-03: stale offline update không được insert; restore là command riêng có quyền, reason và audit.
2. Bắt buộc mutation ID.
3. Triển khai yêu cầu bắt buộc DEC-02: capability `identity`/`financial`/`signature`, default-deny và projection cho API/media/export.
4. Thiết kế audit event schema, coverage matrix và transaction boundary.
5. Dọn unclosed SQLite/deprecation warning; bật warning gate.
6. Đặt threshold theo rủi ro cho auth/sync/startup/document.

### Giai đoạn 2 — 2 đến 3 sprint: state và component contract

1. Tạo `RouteRegistry` + route round-trip tests.
2. Tạo `PackageWorkspaceState`; migrate package detail/F5/back/lot scope.
3. Tạo Tabs primitive từ detailed-evaluation implementation tốt.
4. Migrate select legacy sang accessible combobox.
5. Tạo explicit Button/Action; runtime inference chuyển thành legacy warning.
6. Bổ sung authenticated visual/keyboard E2E.

### Giai đoạn 3 — 3 đến 6 sprint, incremental: data seam và CSS

1. Tạo `WorkspaceDataStore.transaction` và migrate một workflow có rủi ro cao trước, ví dụ bidder goods hoặc package lifecycle.
2. Định nghĩa lifecycle contract backend/frontend.
3. Tạo design source + token ownership + cascade layers.
4. Xóa compatibility CSS theo component đã migrate; theo dõi no-new debt thay vì bulk rewrite.
5. Không chuyển form gói thầu khỏi modal trong giai đoạn này; chỉ sửa lỗi cần thiết theo giới hạn DEC-06.

### Giai đoạn 4 — sau khi seam ổn định: scale/performance

1. Delta sync paging.
2. Transactional WebSocket outbox.
3. Async document job API.
4. Media asset journal/reconciliation.
5. Route/role code splitting với Trusted Types và startup gate.

### Hạng mục tạm hoãn ngoài roadmap hiện tại

- Chuyển form tạo/sửa gói thầu dài từ modal sang routed workbench hoặc page-sized draft flow.
- Hạng mục này chỉ được kích hoạt lại khi chủ sản phẩm thay đổi DEC-06.
- Việc tạm hoãn không ngăn các bản sửa nhỏ nhằm bảo vệ dữ liệu nhập, focus/keyboard, validation, error summary hoặc khả năng phục hồi draft trong implementation hiện tại.

---

## 12. Tiêu chí thành công được áp dụng

Không nên đo thành công chỉ bằng “ít bug hơn”. Dùng các chỉ số có thể kiểm chứng:

### Bảo mật/dữ liệu

- 100% conflict responses phải qua read authorization và redaction.
- 100% stale edit trên tombstoned record trả explicit conflict/full-sync, không insert ngầm.
- 100% endpoint/media nhạy cảm có capability test allow/deny.
- 100% bảng vật chất trong audit coverage matrix có create/update/delete evidence hoặc lý do loại trừ.

### Điều hướng/state

- F5/back/forward giữ package, parent tab, child tab, bid, round và lot scope.
- Zero direct write mới vào `model.state` ngoài compatibility/data-store layer.
- Route round-trip property tests pass.

### UI/accessibility

- Zero select mới dùng `initCustomSelect`.
- Zero button mới phụ thuộc text inference để có icon/variant.
- Axe không có serious/critical violation trên năm màn hình trọng yếu.
- Keyboard-only journey hoàn tất các luồng chính.
- Focus indicator đạt contrast ≥3:1 và 2 px.

### Quality/ops

- Test run không có unclosed-resource warning.
- Critical modules có branch threshold được phê duyệt.
- Startup vẫn dưới cold 800/warm 300 ms p95 hoặc budget mới có giải trình.
- Audit-chain invalid làm readiness 503 trong test và staging drill.
- Không tăng `!important`, raw colors, runtime inferred actions và direct state mutations.

---

## 13. Trạng thái quyết định và mặc định triển khai

Sáu quyết định ở mục 1.2 đã được chốt. Không cần hỏi lại chủ sản phẩm trong quá trình triển khai, trừ khi phạm vi thay đổi hoặc phát sinh xung đột với yêu cầu mới.

| Chủ đề | Quyết định/mặc định được áp dụng |
|---|---|
| Public production và legal TODO | Chỉ public khi legal fact sheet đã hoàn chỉnh và được xác nhận. Không tự điền thông tin hạ tầng/pháp nhân bằng giả định. |
| Identity, financial, signature/stamp | Đây là yêu cầu bắt buộc DEC-02: default-deny; chỉ capability riêng mới được xem; áp dụng cho API, media và export. |
| Delete/restore | Theo DEC-03: stale client không được phục sinh; restore là command riêng có quyền, reason và audit. |
| Lịch sử chỉnh sửa | Mặc định hiển thị actor, thời điểm, hành động, bảng/đối tượng, field names và summary. Old/new value chỉ hiển thị cho trường không nhạy cảm và khi người xem có quyền; dữ liệu identity/financial/signature luôn redacted theo capability. |
| State trong URL | Cho phép các opaque/random record ID cần thiết để F5/back/forward hoạt động, nhưng không đưa giá trị nghiệp vụ nhạy cảm vào URL. Mọi quyền vẫn phải được kiểm tra phía server; URL không phải capability. |
| Form gói thầu dài | Theo DEC-06: giữ implementation modal hiện tại và tạm hoãn routed workbench redesign. |
| Design system | Tạo `design.md` làm nguồn quyết định được review; chọn một token architecture chuẩn. `variables.css`/legacy alias chỉ là compatibility layer trong giai đoạn migrate. |
| Export lớn | Mặc định cho phép chuyển sang background job `202 + jobId`, trạng thái/notification/download; chỉ giữ synchronous fast path cho export nhỏ. |

### Đầu vào vẫn cần chủ sản phẩm hoặc đơn vị vận hành cung cấp

Chỉ còn **legal fact sheet thực tế** không thể suy luận an toàn từ mã nguồn, gồm tối thiểu:

- pháp nhân/đơn vị vận hành và địa chỉ;
- email pháp lý, quyền riêng tư và bảo mật;
- nhà cung cấp/khu vực lưu trữ dữ liệu;
- retention cho dữ liệu nghiệp vụ, log, file và backup;
- lịch backup/restore drill thực tế;
- quy trình và đầu mối xử lý sự cố;
- cơ chế thông báo thay đổi và chuyển dữ liệu quốc tế nếu có.

Các chi tiết kỹ thuật còn lại được ủy quyền triển khai theo khuyến nghị của báo cáo và acceptance criteria tại mục 12.

---

## 14. Phụ lục số liệu

### 14.1. Các file lớn nhất trong snapshot

| File | Dòng |
|---|---:|
| `views/css/views.css` | 5.830 |
| `views/css/ui-redesign.css` | 3.073 |
| `frontend/documents/wordVariableManifest.js` | 2.938 |
| `views/css/components.css` | 2.562 |
| `views/css/landing.css` | 2.558 |
| `backend/sync/mapper.py` | 2.078 |
| `backend/auth/auth_routes.py` | 2.054 |
| `backend/db/schema.py` | 1.688 |
| `frontend/app/BiddingView.js` | 1.599 |
| `frontend/app/BiddingController.js` | 1.356 |
| `frontend/admin/AdminUserController.js` | 1.271 |
| `backend/api/org_routes.py` | 1.261 |
| `backend/documents/document_worker.py` | 1.182 |
| `backend/db/upgrades.py` | 1.170 |
| `backend/shared/access_policy.py` | 1.169 |

### 14.2. Build artifact

| Artifact/thuộc tính | Giá trị |
|---|---:|
| Secure JS input | 1.482.621 byte |
| Secure JS output | 2.605.790 byte |
| Tăng do obfuscation/injection | 75,8% |
| Production CSS | 337.291 byte |
| Obfuscator | `javascript-obfuscator@5.4.3` |
| Dead-code threshold | 0,02 |
| Code splitting | Tắt có chủ đích |

### 14.3. CI/E2E inventory hiện có

Full CI gọi:

- auth shell;
- auth roles;
- bidder goods;
- CRUD modules;
- multi-assignee/activity;
- joint venture;
- low-price conflict;
- offline sync;
- pairwise package paths;
- full lifecycle;
- UI quality;
- performance budget;
- dependency audit;
- production package/SBOM.

Danh sách script nằm tại [package.json:16](../../package.json#L16) và được gọi trong [.github/workflows/ci.yml:73](../../.github/workflows/ci.yml#L73).

### 14.4. Ghi chú về bằng chứng

- Các file/line link trong báo cáo trỏ tới snapshot audit; refactor sau này có thể làm line number dịch chuyển.
- Các số đếm source/CSS được lấy trên worktree sạch của commit nêu ở đầu tài liệu.
- Kết quả test/performance là output của phiên audit; artifact build được đối chiếu với marker/check script trong repo.
- “Không tìm thấy lỗi” trong quan sát browser chỉ áp dụng path và viewport đã kiểm tra.

---

## 15. Kết luận

BiddingFlow đã vượt giai đoạn “ứng dụng thử nghiệm”: hệ thống có domain phức tạp, offline sync, tài liệu, audit, nhiều vai trò và CI vận hành nghiêm túc. Vì vậy cách cải thiện phù hợp là bảo vệ các boundary dữ liệu trước, rồi làm sâu module/interface để giảm số nơi phải hiểu cùng một quy tắc.

Thứ tự có leverage cao nhất:

1. đóng lỗ hổng conflict projection;
2. chốt delete/restore và sensitive capabilities;
3. hoàn thiện audit history;
4. hợp nhất route/workspace state;
5. đưa mutation/sync/rollback sau một transaction seam;
6. hợp nhất Select/Tabs/Button/token system;
7. sau cùng mới tối ưu bundle và async scale.

Nếu đi theo thứ tự này, các sửa giao diện tiếp theo sẽ ít làm phát sinh lỗi cũ hơn, trong khi vẫn giữ được những nền tảng tốt hiện có thay vì viết lại toàn bộ ứng dụng.

Theo quyết định ngày 30/07/2026, toàn bộ hướng xử lý nêu trên được chấp thuận theo khuyến nghị, ngoại trừ việc chuyển form gói thầu dài khỏi modal đang tạm hoãn. Chính sách default-deny cho dữ liệu identity/financial/signature là yêu cầu bắt buộc của chủ sản phẩm, không phải tùy chọn triển khai.
