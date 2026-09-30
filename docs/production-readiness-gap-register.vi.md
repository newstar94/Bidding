# Danh mục hoàn tất trước khi phát hành production — BiddingFlow

Ngày cập nhật: 30/09/2026. Phạm vi: mã nguồn tại D:\Bidding; HEAD nền khi rà soát là b369c0d488d5d09c3dca2cbccbd21d58ddfb6ab4. Các thay đổi legal, deployment worker và smoke trong lượt này còn ở working tree, chưa tạo bản phát hành.

## Kết luận

**Chưa đủ điều kiện phát hành production.** Blocker phê duyệt 27 mục legal đã được gỡ theo quyết định của chủ sản phẩm; ba trang legal tối giản vẫn được giữ. Đây là thay đổi của cổng kiểm tra trang công khai, **không phải** kết luận tuân thủ pháp luật hay miễn các kiểm tra kỹ thuật và vận hành.

Bản secure build hiện có trong dist hợp lệ về cấu trúc nhưng không khớp mã nguồn đang làm việc; kiểm tra package --check dừng trước khi tạo archive. ZIP trong release là artifact cũ. Không dùng lại hai đầu ra này để triển khai. Chưa chạy full release pipeline, migration, staging smoke hay cutover production trong lượt này.

## Đã thực hiện trong lượt này

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Nội dung công khai | Giữ [Điều khoản](../views/legal/terms.html), [Quyền riêng tư](../views/legal/privacy.html) và [Bảo mật](../views/legal/security.html) ở mức tối giản; không còn placeholder công khai. Không thay đổi quyền xem bản ghi hoặc quyền xuất Word. | Cả ba trang còn nguyên panel ID; lệnh check:legal:production đạt. |
| Cổng phát hành | [Checker](../scripts/check_legal_readiness.py) không đọc trạng thái 27 mục nữa; production vẫn thất bại khi thiếu trang, trang rỗng, có [TODO] hoặc phần tử legal-placeholder. Chuỗi package và workflow thủ công vốn đã gọi checker trước khi đóng gói nên được giữ nguyên. | [Kiểm thử Python](../tests/test_legal_readiness.py) và [workflow](../.github/workflows/ci.yml). |
| Quyết định và hướng dẫn | [ADR 0047](adr/0047-retire-27-fact-production-legal-blocker.md) thay phần 27 mục của [ADR 0042](adr/0042-engineering-ci-and-production-legal-gate.md); [phiếu lịch sử](legal-fact-sheet.md) không còn là release dependency. Runbook đóng gói/triển khai đã được đồng bộ. | [Hướng dẫn đóng gói](production-packaging-guide.md), [runbook triển khai](../deploy/README.md). |
| Deployment worker và smoke | Đã thêm unit worker production, env template không chứa secret, verifier boundary và smoke runner chỉ đọc/fail-closed; test tập trung đạt 22/22. | [Unit worker](../deploy/systemd/biddingflow-document-worker.service.example), [smoke](../deploy/scripts/production_smoke.py), [test worker](../tests/test_document_worker_deployment.py), [test smoke](../tests/test_production_smoke.py). Host Linux, systemd, DB role, volume và credential thật chưa được xác minh. |
| Kiểm chứng cục bộ | Gate legal production đạt; 28 kiểm thử Python legal và bốn kiểm thử JavaScript danh mục legal đạt; worker/smoke/deploy tests đạt 22/22; package contract tests đạt 36/36; static, security frontend, chất lượng Python, mã hóa UTF-8 và git diff --check đạt. Full `npm test` đã được khởi chạy nhưng chưa có kết quả hoàn tất current-SHA. | Đây là bằng chứng trong working tree, chưa thay thế full CI của commit phát hành. |

## Việc bắt buộc trước khi mở production

| Mã | Danh mục | Hiện trạng đã xác minh / chưa xác minh | Việc cần làm và điều kiện hoàn tất |
|---|---|---|---|
| P0-01 | Phạm vi bản phát hành | Working tree có các sửa đổi legal và file PPTX riêng của người dùng tại output; chưa có commit ứng viên. | Chốt phạm vi, dùng checkout phát hành sạch, bảo toàn PPTX ngoài phạm vi; mọi bằng chứng phải gắn cùng commit/ID bất biến. |
| P0-02 | Full engineering gates | Static gate, security frontend và các test tập trung đã đạt; full `npm test`, coverage, E2E đa trình duyệt và performance chưa có kết quả hoàn tất current-SHA. | Chạy full CI, Python/JS coverage, kiểm tra static/build, Playwright và các luồng E2E quan trọng; lưu log theo commit, không đổi kỳ vọng quyền hoặc dữ liệu để làm test xanh. |
| P0-03 | An ninh và chuỗi cung ứng | Chưa có kết quả current-commit cho secret scan, CodeQL, dependency audit, vendor assets và security deployment preflight. | Chạy đủ gate, xử lý phát hiện có căn cứ hoặc ghi exception có chủ sở hữu; xác nhận không rò secret/source map trong artifact. |
| P0-04 | Hợp đồng quyền và dữ liệu | Lượt này không sửa role, tenant, module, assignment, record scope, masking hay API đọc. | Chạy regression xác thực/session, tenant isolation, module/assignment/record authorization và hiển thị đầy đủ bản ghi đã được cấp quyền; quyền xuất Word chỉ điều khiển xuất/tải. |
| P0-05 | Cơ sở dữ liệu | Mã nguồn nhắm schema 98, chấp nhận runtime từ 80; chưa diễn tập schema/migration trên bản sao dữ liệu ứng viên và chưa có bằng chứng rollback/restore. | Kiểm tra preflight, migration từ các phiên bản được hỗ trợ, index/lock/cardinality, dữ liệu trước–sau và đường khôi phục; lưu log schema thực tế. |
| P0-06 | Cấu hình và bí mật production | [Mẫu môi trường](../deploy/production.env.example) còn giá trị mẫu, secret chưa cấp và nhiều xác nhận hạ tầng chưa được đánh dấu. | Cấp secret qua kho bí mật, cấu hình exact origin, SMTP bắt buộc, khóa email outbox và OTP HMAC, cookie, DB private network, admin bootstrap và các tích hợp bật; chạy preflight trên host thật, không commit/in secret. |
| P0-07 | DNS, TLS và biên mạng | Repository có mẫu/runbook, chưa có bằng chứng DNS/TLS, proxy, firewall và ingress trên hạ tầng đích. | Xác minh chứng chỉ, HTTPS/HSTS, trusted proxy, ingress/Cloudflare nếu dùng, nginx và systemd trên host thực tế; lưu kết quả và người chịu trách nhiệm. |
| P0-08 | Sao lưu và khôi phục | Có công cụ/runbook, chưa có bằng chứng lịch chạy, off-host, cảnh báo và diễn tập restore production/staging gần nhất. | Cấu hình backup DB + file, retention, kiểm checksum, lưu ngoài host, cảnh báo stale; khôi phục vào môi trường cách ly và xác nhận RPO/RTO. |
| P0-09 | Giám sát và ứng phó sự cố | Có template chỉ số/cảnh báo; chưa xác nhận scrape, receiver, on-call và diễn tập cảnh báo thực tế. | Kết nối dashboard/alert, đặt ngưỡng, kiểm audit checkpoint, phân công trực và thử alert → tiếp nhận → xử lý. |
| P0-10 | Staging smoke | Đã cung cấp `deploy/scripts/production_smoke.py` và test contract; chưa có credential smoke, fixture record, artifact mới hoặc log chạy trên staging. | Cấu hình DEPLOY_SMOKE_SCRIPT/ROLLBACK_SMOKE_SCRIPT bằng artifact đã ký; cấp tài khoản/cookie ngắn hạn qua secret manager, cài đúng artifact lên staging giống production, kiểm health, login, đọc bản ghi đúng quyền, phiên, đồng bộ, Word/Excel và hành vi lỗi; lưu log không chứa secret. |
| P0-11 | Cutover và rollback | Runbook có quy trình, chưa có diễn tập cho ứng viên này. | Diễn tập đổi phiên bản, rollback code và phương án khôi phục DB/file sau migration; ghi thời gian, health, dữ liệu và quyết định go/no-go. |
| P0-12 | Secure build và package | Collector đã bỏ qua cache `__pycache__` sinh từ test và package contract đạt 36/36; `verify_secure_build_artifact.py` đạt, nhưng `package_production.py --check` vẫn dừng vì marker `136958dedb5be5fe5231bac8fecf62747c52704ad5aac85ee3c7f191a4611ef0` lệch source hiện tại `e817b727ef51a6b6d305b535c6a34e67130cf956749c3daeed11e11eec826f33`; ZIP release là bản cũ. | Build lại từ checkout phát hành; chạy chuỗi package chính thức, kiểm release ID/manifest/hash, allowlist, extracted smoke và xác nhận ZIP không có Markdown, secret hoặc source map. Không ghi đè ZIP cũ khi chưa chốt ứng viên. |
| P0-13 | Provenance và phê duyệt phát hành | Chưa có SBOM, checksum và release record cùng trỏ tới một artifact mới. | Sinh SBOM, lưu SHA-256, log gate, thay đổi/migration và phê duyệt go/no-go; đối chiếu artifact → commit → build → môi trường. |
| P0-14 | Trải nghiệm, khả năng truy cập và sức tải | Chưa có bằng chứng staging cho các màn hình chính, responsive, browser matrix, lỗi accessibility nghiêm trọng và capacity/latency của ứng viên. | Kiểm các luồng có xác thực, xuất tài liệu, mobile/desktop, accessibility, baseline hiệu năng và connection budget; sửa lỗi được xác nhận mà không đổi hợp đồng hiển thị dữ liệu. |
| P0-15 | Document worker | Đã thêm unit worker, env template, ràng buộc web–worker, verifier merge `APP_ENV` an toàn và test contract; chưa có bằng chứng host Linux/systemd, service account, DB role, Bubblewrap, volume hoặc sandbox probe thật. | Cài worker/service account, DB role, secret và queue/storage tách biệt; đáp ứng kiểm tra coupling và [trình xác minh worker](../scripts/verify_document_worker_deployment.py) trên host đích, ghi evidence 0600 ngoài release. |

## Việc phụ thuộc tính năng hoặc mô hình triển khai

Các mục này phải hoàn thành **trước go-live nếu tính năng/mô hình tương ứng được bật**. Nếu không dùng, ghi rõ N/A trong release record; không tự suy diễn rằng code mẫu đã được triển khai.

| Mã | Điều kiện áp dụng | Việc còn thiếu / bằng chứng cần có |
|---|---|---|
| C-01 | Tra cứu đấu thầu bằng trình duyệt | Nếu bật: cài Node/Chromium theo runbook cho worker không chạy root, ghim nguồn mạng/TLS, kiểm probe và benchmark trên staging tương đương; không chạy probe --live trong APP_ENV=production. Image bất biến là một lựa chọn triển khai, không phải yêu cầu duy nhất. |
| C-02 | Nhiều app instance | Quyết định shared artifact storage hoặc chỉ chạy một instance; xác minh truy cập file, worker và bản ghi liên instance. |
| C-03 | Thu phí/thanh toán | Mẫu hiện để provider fake và chức năng checkout/activation tắt. Nếu mở bán: cấu hình provider thật, webhook, đối soát, idempotency, hỗ trợ và rollback; nếu chưa bán: ghi rõ deferred/N/A, không trình bày là đã sẵn sàng thanh toán. Cờ pháp lý của thanh toán là quyết định riêng, không hồi sinh 27 mục cũ. |
| C-04 | Dịch vụ ngoài tùy chọn | Với Turnstile, đăng nhập Google, tra cứu đối tác và dịch vụ khác thực sự bật: xác minh credential, miền/origin, quyền dữ liệu, failure mode và smoke trên staging. SMTP production nằm ở P0-06, không phải tùy chọn. |

## Trình tự và quyết định phát hành

1. Chốt scope tính năng, owner và commit ứng viên; giữ nguyên file PPTX của người dùng.
2. Hoàn tất P0-02 đến P0-11, P0-14, P0-15 và các mục C áp dụng trên staging/hạ tầng thật; đặc biệt chạy smoke runner và verifier worker bằng artifact ứng viên.
3. Build/package lại, kiểm P0-12 và P0-13 trên đúng commit; chạy lại smoke với chính ZIP dự định phát hành.
4. Ghi go/no-go: gate legal trang công khai đạt, full engineering/security/DB/ops đạt, rollback khả dụng, owner chấp thuận. Chỉ sau đó mới cutover production.

Việc bỏ 27 mục pháp lý không tạo thêm quyền truy cập, không che bớt dữ liệu người đã được phép đọc và không miễn trách nhiệm đánh giá pháp lý riêng của đơn vị vận hành.
