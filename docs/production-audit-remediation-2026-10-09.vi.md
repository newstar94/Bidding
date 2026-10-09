# Khắc phục audit production ngày 09/10/2026

## Phạm vi và trạng thái

Thực hiện theo báo cáo F01–F18 tại commit gốc `5942daf20ffb64afd7e663b73c2140f980f7f1a2`. Các bản sửa nằm trong working tree; chưa commit, push hoặc deploy. F12 được giữ nguyên theo yêu cầu chủ sản phẩm.

Không đổi quyền đọc đầy đủ dữ liệu, masking, tenant/module/assignment/record scope hoặc phạm vi entitlement Word. Quyền F03 được chủ sản phẩm xác nhận riêng: người tạo đơn và chủ tổ chức được xem trạng thái/hủy đơn trong tổ chức đang chọn; giữ ngoại lệ Super Admin hiện hành. Quyết định, tương thích và chiến lược triển khai được ghi trong ADR0080.

## Theo dõi từng mục

| ID | Bản sửa | Bằng chứng và giới hạn |
|---|---|---|
| F01 | Import/lookup/opening dùng cùng reservation, source identity, atomic snapshot và ledger; giữ xử lý phần danh sách đủ lượt. | 244 passed, 1 skipped ở bộ procurement tập trung; provider giả lập/SQLite ledger. Chưa có chứng cứ connector thật dưới identity production. |
| F02 | Áp policy snapshot ở quote, checkout và paid activation; chặn upgrade/downgrade trái policy, giữ purchase/renewal hiện hành và replay. | 37 ca transition/provider-selection đạt sau sửa tương thích. Bộ Python cuối đang được chạy lại. |
| F03 | Hoàn thiện API trạng thái/hủy từng đơn tổ chức theo quyền người tạo/chủ tổ chức đã duyệt. | 108 Python passed, gồm PostgreSQL hai kết nối membership/lock và provider PAID → activation đúng một lần. 8 Chromium passed cho đóng/Esc/hủy/backdrop ở cá nhân/tổ chức. Không mở quyền usage hoặc lịch sử toàn tổ chức. |
| F04 | Chuẩn hóa `active_org_id` và xác định owner theo workspace của thao tác checkout. | Regression storefront/race đạt với source và API giả lập. |
| F05 | Khôi phục ngoại lệ owner tại điều kiện ngang cấp theo ADR0045. | Owner promote/revoke, nonowner deny, last-manager invariant đạt; giữ session/persona/tenant/audit. |
| F06 | Reserve từng provider round; settle actual usage idempotent và monotonic, kể cả overage/error/cancel; native adapter và producer queue giữ usage đã quan sát trước cleanup/freeze. | 206 focused passed, gồm threaded queue/cancel lặp/producer muộn. Không charge estimate, không suy usage provider chưa trả trước cutoff, không ghi ledger từ producer. Chưa kiểm provider thật. |
| F07 | DB/I/O/audit tài liệu chạy qua lane hữu hạn; stage/commit/cleanup giữ ownership khi timeout/cancel; deletion có cleanup lane riêng. | 28 focused passed; tái hiện red file mồ côi và queue rejection chờ cleanup không cần thiết. Regression giữ spool, hủy trước/sau submission, timeout, commit và overload. Branch coverage route 32,41% vượt ratchet 3%. |
| F08 | Storefront giữ workspace/generation qua request và render; refresh mới không bị cờ loading cũ bỏ qua. | Bộ race frontend đạt. Không thay authorization phía máy chủ. |
| F09 | Vô hiệu create/send continuation khi reset hoặc đổi workspace chatbot. | Regression delayed create/reset đạt. |
| F10 | Dùng `AccessDecision.message`, trả đúng 403 sau rollback. | HTTP denied aggregate-version regression đạt. |
| F11 | Backup manifest, completeness, verify và restore bao gồm immutable Word catalog, tương thích backup legacy. | Backup/restore PostgreSQL riêng đạt, DB/files verified, RPO 2,289 s và RTO 6,908 s cho fixture cục bộ. Không phải rehearsal snapshot production. |
| F12 | **Giữ nguyên TLS/sandbox browser Mua Sắm Công.** | Chờ chủ sản phẩm xác nhận/xử lý sau. Không xem việc hoãn này là duyệt production. |
| F13 | Await dữ liệu Admin route; tách shell, route và workspace reconciliation; bắt buộc release ID khớp artifact. | Focused readiness/release/workspace tests đạt; giữ cold 2100 ms, warm 450 ms và long task 100 ms. Đang đo artifact cuối. |
| F14 | Biểu mẫu chuyên gia chỉ đóng sau canonical confirmation; response cũ không đóng editor đã mở lại. Helper Joint Venture/Full Lifecycle giữ upstream finalize bytes trước khi Chromium giải phóng response body. | Có regression red/green tại workflow thật và lỗi `Network.getResponseBody` ở harness. 66 helper/harness tests đạt. Matrix local lần đầu 97 passed/2 allowed skips; đang rerun artifact cuối, không tăng timeout/skip/đổi assertion E2E. Lỗi timing CI gốc chưa tái hiện trong 10 lượt baseline; không khẳng định stack nguyên nhân CI đã được chứng minh. |
| F15 | Build secure mới; tạo lại ZIP từ bytes sau bản sửa cuối, kiểm currentness/integrity và extracted-runtime smoke. | Package/extracted smoke đạt; 873 runtime files, 5.376.353 bytes; manifest/digest/currentness đạt, 0 forbidden files. Artifact là working tree, chưa phải commit phát hành. |
| F16 | Inline parse giữ workspace/package/form generation; Excel save giữ mutation lease qua commit/rollback/outbox. | Success/failure/switch/close/reopen regressions đạt; rollback cũ không ghi sang workspace mới. |
| F17 | Chỉ báo hoàn tất/đóng preview sau canonical committed; pending/conflict/rejected giữ entered draft để retry có chủ ý. | Regression pending/offline/reject/conflict/canonical đạt; không tự phát lại draft bị từ chối. |
| F18 | Chỉ toast/refresh thành công khi lifecycle xác nhận đã chuyển workspace. | Regression cancelled transition đạt. |

## Gate kiểm chứng cục bộ

- JavaScript: 2.477 passed, 0 failed/skipped; coverage lines 58,44%, branches 68,58%, functions 70,86%; critical ratchet 14 modules đạt. Đã có thêm focused tests cho workspace marks sau lượt này.
- Browser matrix: 97 passed, 2 allowed skips, 0 unexpected skips/failures; verifier đạt.
- Static và secure build đạt. Bản build đã bao gồm readiness marks bổ sung.
- Bộ Python đầu có 24 lỗi do phiên bản transition guard được import trước khi sửa tương thích; 3.258 passed/2 skipped. 24 lỗi đó thuộc suite provider-selection đã chạy lại xanh. Không dùng lượt này làm bằng chứng full gate xanh; chạy lại source cuối.
- Downstream role/workflow/analytics và performance/package cuối đang hoàn tất.

Logs và test resources riêng nằm tại `C:\Users\newst\AppData\Local\Temp\bidding-repair-20261009`. Không sửa `.env` hoặc DB vận hành.

## Artifact cục bộ

- ZIP: `D:\Bidding\release\biddingflow-production.zip`.
- Release ID: `fe7873255aa68401c40cfa98a83d89604edff63cb41c3f66414cbac081b665b7`.
- SHA-256: `395668f55478db76168c21f19b51a775aa7dcc7ad639a27679a811e8072fe106`.
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

