# Khắc phục audit production ngày 09/10/2026

## Phạm vi và trạng thái

Thực hiện theo báo cáo F01–F18 tại commit gốc `5942daf20ffb64afd7e663b73c2140f980f7f1a2`. Trong lúc kiểm chứng, repository đã có commit nền mới `7670f7a5` chứa các bản sửa trước đó; các bổ sung F08, F14 và tài liệu cuối vẫn nằm trong working tree. Lượt sửa này không thực hiện commit/push/deploy. F12 được giữ nguyên theo yêu cầu chủ sản phẩm. **Chưa thể báo hoàn tất toàn bộ: F14 còn gate browser/CI chưa đạt; các bản sửa còn lại đã có kiểm chứng cục bộ, vẫn cần các gate host/provider trước khi duyệt production.**

Không đổi quyền đọc đầy đủ dữ liệu, masking, tenant/module/assignment/record scope hoặc phạm vi entitlement Word. Quyền F03 được chủ sản phẩm xác nhận riêng: người tạo đơn và chủ tổ chức được xem trạng thái/hủy đơn trong tổ chức đang chọn; giữ ngoại lệ Super Admin hiện hành. Quyết định, tương thích và chiến lược triển khai được ghi trong ADR0080.

## Theo dõi từng mục

| ID | Bản sửa | Bằng chứng và giới hạn |
|---|---|---|
| F01 | Import/lookup/opening dùng cùng reservation, source identity, atomic snapshot và ledger; giữ xử lý phần danh sách đủ lượt. | 244 passed, 1 skipped ở bộ procurement tập trung; provider giả lập/SQLite ledger. Chưa có chứng cứ connector thật dưới identity production. |
| F02 | Áp policy snapshot ở quote, checkout và paid activation; chặn upgrade/downgrade trái policy, giữ purchase/renewal hiện hành và replay. | 37 ca transition/provider-selection đạt sau sửa tương thích. Bộ Python cuối 3.386 passed; không dùng provider thật. |
| F03 | Hoàn thiện API trạng thái/hủy từng đơn tổ chức theo quyền người tạo/chủ tổ chức đã duyệt. | 108 Python passed, gồm PostgreSQL hai kết nối membership/lock và provider PAID → activation đúng một lần. 8 Chromium passed cho đóng/Esc/hủy/backdrop ở cá nhân/tổ chức. Không mở quyền usage hoặc lịch sử toàn tổ chức. |
| F04 | Chuẩn hóa `active_org_id` và xác định owner theo workspace của thao tác checkout. | Regression storefront/race đạt với source và API giả lập. |
| F05 | Khôi phục ngoại lệ owner tại điều kiện ngang cấp theo ADR0045. | Owner promote/revoke, nonowner deny, last-manager invariant đạt; giữ session/persona/tenant/audit. |
| F06 | Reserve từng provider round; settle actual usage idempotent và monotonic, kể cả overage/error/cancel; native adapter và producer queue giữ usage đã quan sát trước cleanup/freeze. | 206 focused passed, gồm threaded queue/cancel lặp/producer muộn. Không charge estimate, không suy usage provider chưa trả trước cutoff, không ghi ledger từ producer. Chưa kiểm provider thật. |
| F07 | DB/I/O/audit tài liệu chạy qua lane hữu hạn; stage/commit/cleanup giữ ownership khi timeout/cancel; deletion có cleanup lane riêng. | 28 focused passed; thêm 46 authority/document regressions đạt với executor thật, gồm session revoked/actor đổi sau upload, rollback và cleanup đúng một lần. Fixture cũ chỉ mock hàm trực tiếp đã được cập nhật, giữ expected 401. Branch coverage route 32,41% vượt ratchet 3%. |
| F08 | Storefront giữ workspace/model/generation qua refresh, quote, create và present. Chặn phản hồi/lỗi cũ khỏi QR/lịch sử/status; refresh mới không bị cờ loading cũ bỏ qua. | 5 regression Chromium tại quote/create/error, A→B→A và replacement model đạt; không tạo checkout từ quote cũ hoặc đưa đơn A vào UI B. Bộ targeted frontend 69 passed. Backend authorization giữ nguyên; đơn đã tạo không bị tự hủy theo phản hồi muộn. |
| F09 | Vô hiệu create/send continuation khi reset hoặc đổi workspace chatbot. | Regression delayed create/reset đạt. |
| F10 | Dùng `AccessDecision.message`, trả đúng 403 sau rollback. | HTTP denied aggregate-version regression đạt. |
| F11 | Backup manifest, completeness, verify và restore bao gồm immutable Word catalog, tương thích backup legacy. | Backup/restore PostgreSQL riêng đạt, DB/files verified, RPO 2,289 s và RTO 6,908 s cho fixture cục bộ. Không phải rehearsal snapshot production. |
| F12 | **Giữ nguyên TLS/sandbox browser Mua Sắm Công.** | Chờ chủ sản phẩm xác nhận/xử lý sau. Không xem việc hoãn này là duyệt production. |
| F13 | Await dữ liệu Admin route; tách shell, route và workspace reconciliation; bắt buộc release ID khớp artifact. | Focused readiness/release/workspace tests đạt. Admin và Tổng quan đạt phép đo 30 cold + 30 warm trên đúng artifact, giữ cold 2100 ms, warm 450 ms và long task 100 ms. Phép đo Tổng quan cần giãn hai pha theo cửa sổ telemetry hiện hành; chi tiết bên dưới. |
| F14 | **Chưa đóng.** Đã sửa canonical-only expert completion, pending receipt/identity, giữ nội dung mới, parser ngày ISO và fixture unresolved conflict theo ADR0057; giữ upstream response bytes ở các helper. | Unit/harness, startup nguyên bản 10/10 Chromium và conflict fixture 6/6 WebKit đạt. Luồng nghiệp vụ đầy đủ, UI quality và offline soak 5/5 được chạy lại sau parser ngày trên artifact cuối và đạt. Full browser matrix cuối vẫn có timeout gián đoạn Firefox; chi tiết và probes bên dưới. Không tăng timeout, thêm skip hoặc đổi quyền/nghiệp vụ để làm gate xanh. |
| F15 | Build secure mới; tạo lại ZIP từ bytes sau bản sửa cuối, kiểm currentness/integrity và extracted-runtime smoke. | Package/extracted smoke đạt; 873 runtime files, 5.377.823 bytes; manifest/digest/currentness đạt, 0 forbidden files. Artifact bao gồm bổ sung working tree, chưa phải commit phát hành cuối. |
| F16 | Inline parse giữ workspace/package/form generation; Excel save giữ mutation lease qua commit/rollback/outbox. | Success/failure/switch/close/reopen regressions đạt; rollback cũ không ghi sang workspace mới. |
| F17 | Chỉ báo hoàn tất/đóng preview sau canonical committed; pending/conflict/rejected giữ entered draft để retry có chủ ý. | Regression pending/offline/reject/conflict/canonical đạt; không tự phát lại draft bị từ chối. |
| F18 | Chỉ toast/refresh thành công khi lifecycle xác nhận đã chuyển workspace. | Regression cancelled transition đạt. |

## Gate kiểm chứng cục bộ

- Python: 3.386 passed, 2 skipped do Windows không cho tạo symlink, 1 browser test deselected để chạy riêng. Coverage 68,89%; critical ratchet 16 modules đạt. Source backend cuối đã qua full gate; frontend bổ sung được kiểm riêng.
- JavaScript: 2.520 passed, 0 failed/skipped; coverage lines 58,82%, branches 68,65%, functions 70,92%; critical ratchet 14 modules đạt. Lượt full này đã gồm hai regression ngày bổ sung.
- Full browser matrix **chưa đạt**. Lượt đầu: 95 passed, 2 allowed skips, 2 failed (`matrix-first-final-results`). V4: 94 passed, 2 allowed skips, 3 failed (WebKit JSON health navigation trước UI, login ECONNRESET và fixture conflict cho recovery GET thành công). V5: 95 passed, 2 allowed skips, 2 failed (Chromium chờ lưu kế hoạch 01, WebKit JSON health navigation).
- V6: 96 passed, 2 allowed skips, 1 failed ở Firefox guest CTA: click đã thực hiện nhưng URL còn landing sau 10 s. V7: 96 passed, 2 allowed skips, 1 failed ở Firefox tải lại `/goi-thau/chinh-sua` sau khi server đã từ chối receipt A và nhận giá trị B; `waitForApp` timeout 10 s. Tạo/lưu kế hoạch và business conflict assertions trước bước tải lại đã đạt. Logs, JSON đã lấy sau khi run kết thúc và traces được giữ riêng theo tên lượt; không thay kết quả lỗi bằng một rerun đơn lẻ.
- Probe giữ nguyên luồng kế hoạch với diagnostics trước cleanup: Chromium 5/5 và Firefox 4/4 đạt. Guest CTA thu pointer/click trước và sau bootstrap: 48 lượt đạt, 2 lượt TCP connect ETIMEDOUT tới `/health/live` trước UI; không tái hiện cú bấm thất bại. Các timeout chưa có nguyên nhân đủ rõ để sửa production code; không quy cho AdGuard, DB hoặc application leak từ dấu hiệu gián tiếp.
- Liveness fixture đã chuyển từ điều hướng tới JSON sang HTTP request, giữ mọi readiness/scroll/navigation assertions. WebKit landing 5 passed, 1 allowed touch skip; harness 46 passed. Fixture conflict tái hiện 6/6 trước sửa, sau sửa 6/6 đạt: recovery GET chỉ trả 503 sau POST bị từ chối; giữ startup read gate, zero POST trước release, một POST, conflict và entered form. Parser ngày có probe chứng minh đọc sai ISO trước sửa; test startup nguyên bản đạt 10/10 Chromium sau sửa. Nguyên nhân timing CI gốc chưa được chứng minh trên host này.
- Static và secure build cuối đạt. Package/check và extracted-runtime smoke đạt, manifest/digest/currentness đã kiểm sau sửa parser ngày.
- Role/auth shell, bidder goods, CRUD, multi-assignee, Joint Venture, low-price conflict và package pairwise đã đạt trong lượt sửa. Sau bản parser ngày cuối, chạy lại full lifecycle, UI quality và offline soak: tất cả đạt (`lifecycle-final-v7.log`, `ui-quality-final-v7.log`, `offline-soak-final-v7.log`). Lifecycle cuối dọn 315 fixture rows, giữ 156 immutable rows gồm 108 audit rows; offline 5/5 giữ cả bảy trường nhập, reconnect/reload/retry/dedup, không báo canonical success trước commit. Không gán lại bằng chứng các suite cũ cho một artifact mới khi chưa chạy lại.
- Product analytics 1 passed; có Windows asyncio teardown warnings, chưa đủ bằng chứng coi đây là application leak.
- Performance trên artifact cuối, sau khi các suite nặng kết thúc: Admin 30 cold + 30 warm đạt, p95 1.245/110 ms, long task 59/0 ms. Tổng quan 30 cold + 30 warm đạt với p95 hiển thị 1.252/141 ms, p95 đồng bộ xong 1.611/370 ms, 60/60 lượt RECONCILED, long task 0/0 ms; giữ nguyên budget 2.100/450/100 ms và kiểm tra runtime errors/release ID.
- Lượt đo Tổng quan đầu không đạt do warm run 30 trả telemetry 429. Có 61 lần mở trang (60 mẫu + một warmup), mỗi lần gửi heartbeat và feature: 122 events trong cửa sổ 60 s, vượt limiter hiện hành 120/user/phút. Tốc độ và reconciliation vẫn đạt nhưng không bỏ qua lỗi. Lượt đo có giãn pha dùng bản sao script ngoài repository, chỉ chờ 60 s giữa cold và warm; giữ mọi điều hướng, số mẫu, error/readiness/assertion và threshold, không tắt telemetry hoặc đổi limiter. Giữ cả `startup-performance-workspace.json` không đạt và `startup-performance-workspace-paced.json` đạt để đối chiếu.

Logs và test resources riêng nằm tại `C:\Users\newst\AppData\Local\Temp\bidding-repair-20261009`. Không sửa `.env` hoặc DB vận hành.

Đã dừng máy chủ kiểm thử riêng ở cổng 8018 và PostgreSQL kiểm thử ở cổng 55483 sau khi các suite kết thúc; giữ logs, traces và dữ liệu fixture riêng để đối chiếu. Việc commit/push nhánh kiểm thử và chạy Full CI mới đang chờ chủ sản phẩm duyệt; các lần cho phép trước chỉ áp dụng từng cặp file CI.

## Artifact cục bộ

- ZIP: `D:\Bidding\release\biddingflow-production.zip`.
- Release ID: `7aa1b0fa91fc6106897f95b9aac9997ab3cd2f7887fad8d1621d86d26d99950b`.
- SHA-256: `74b8dcff72fd149e37c264ceb070b7d3057bfbad13b71b10a2a7581c8238c2e8`.
- Manifest trong ZIP khớp từng runtime file của checkout hiện tại; không chứa Markdown, source map, `.env`, `.pyc`, `__pycache__` hoặc private symbols.
- Chưa deploy. Gate host/provider/CI trên commit phát hành vẫn được liệt kê riêng dưới đây.

## Gate thực tế còn cần trước khi duyệt production

Các mục dưới đây là giới hạn môi trường/bằng chứng, không được đóng bằng unit test hoặc tự đổi contract:

1. Full CI trên commit đã duyệt; audit nguồn và local matrix không thay kết quả CI remote.
2. Migration rehearsal từ snapshot thật với migrator role và startup bằng runtime role; đo khóa/DDL trên workload thật.
3. Linux/systemd worker và connector dưới service identity, storage ownership và network boundary thật; kiểm tương thích `MemoryDenyWriteExecute` với Node/Chromium JIT. F12 vẫn hoãn.
4. DNS/TLS/Cloudflare/origin/webhook production; payOS và Google thật, kích hoạt/gia hạn/reconcile/cancel. Lượt sửa này không phát sinh thanh toán thật.
5. Backup/restore/deploy/rollback từ artifact cuối trên host đích và kiểm alert delivery/provider/DB/worker recovery.
6. Desktop với workspace lớn và tải sync/AI/connector đồng thời: đo p50/p95/p99, RAM, long task, event-loop/DB pool/queue theo budget được chốt.
7. Candidate session revocation trong request đã bắt đầu và offboarding vẫn cần quyết định semantics/chứng cứ concurrency riêng; không suy quyền mới từ các bản sửa này.
8. Codex Security canonical scan chưa có bằng chứng hoàn tất do helper/runtime không khởi động được trong audit gốc. Không tuyên bố đã quét chuyên dụng hoặc ứng dụng không còn lỗ hổng.

