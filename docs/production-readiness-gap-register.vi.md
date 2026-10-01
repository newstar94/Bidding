# Danh mục hoàn tất trước khi phát hành production — BiddingFlow

Ngày cập nhật: 01/10/2026. Phạm vi: working tree tại `D:\Bidding`. Các kết quả cục bộ bên dưới chưa phải bằng chứng của commit phát hành bất biến, staging hoặc host production. Chưa commit, push, deploy hay thực hiện giao dịch PayOS thật. File PPTX không liên quan trong `output/` vẫn nằm ngoài phạm vi.

**Cập nhật 01/10/2026:** các kết quả gate ở bảng dưới là snapshot ngày
30/09, không phải chứng nhận bản sửa mới. Bằng chứng và những lỗi phát hiện/sửa
sau đó được theo dõi tại [báo cáo sửa lỗi](production-repair-report.vi.md).
Backend hiện đã đạt 2.502 test/1 skip, coverage 65,02%; frontend cuối đạt
1.972/1.972 test và 14 coverage ratchets ở snapshot trước bổ sung F5. Bản
ADR 0049 đã đạt focused 33/33 conflict và 79/79 draft/workflow, full JS cuối
2.026/2.026 và 14 coverage ratchets ở snapshot ADR 0049. Bổ sung ADR 0050
hiện đạt full JS **2.049/2.049**, 14 ratchets, focused landing/browser **26/26**.
Secure build/package smoke mới đạt với release ID `9ba70825…`. Gate startup
landing **100ms** đạt hai lượt **30 cold + 30 warm**, không ghi nhận task
>=50ms; đây không phải tổng startup <100ms hoặc bằng chứng Edge/workspace thật.
Chưa có smoke F5/IndexedDB có xác thực trên staging.
Đối chiếu bằng chứng hiện hành trong báo cáo đó, không dùng bảng lịch sử bên dưới.

## Kết luận

**Chưa đủ điều kiện phát hành production.** Blocker phê duyệt 27 mục legal đã được gỡ theo quyết định của chủ sản phẩm; ba trang legal tối giản vẫn được giữ. Đây là thay đổi của cổng kiểm tra trang công khai, **không phải** kết luận tuân thủ pháp luật hay miễn các kiểm tra kỹ thuật và vận hành.

Artifact **01/10 sau tối ưu startup ADR 0050**: 168 bundle obfuscate,
882 runtime files, 5.201.005 bytes; SHA-256
`c892d5536a227dbf87e860752b8bdfa929625cf01794808bb45367739f5afd94`;
release ID `9ba7082517f82a60f48cd27bb436a7a82259c1a3e772f349aaa5e18c8fa3747d`.
Secure build và `package_production.py --check` đạt, gồm extracted-runtime
smoke. ZIP/checksum trước tối ưu được giữ dưới tên `pre-startup-20261001`
để phục hồi, không deploy artifact cũ. Đây vẫn chỉ là
ứng viên working tree, chưa được phê duyệt/deploy; chưa có clone-data
migration/restore, staging smoke hoặc cutover production.

Phạm vi phát hành đã bổ sung **thanh toán production** theo yêu cầu của chủ sản
phẩm. Code/runbook đã chuẩn bị, nhưng lượt kiểm tra chưa được cung cấp bằng
chứng credential, merchant/webhook authorization, legal/commercial approval
và host. Không khẳng định những cấu hình đó chắc chắn chưa tồn tại bên ngoài;
không bật checkout hoặc chạy giao dịch thật trước khi xác nhận đủ điều kiện.

## Lịch sử kiểm tra ngày 30/09 — không dùng chứng nhận ứng viên 01/10

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| Nội dung công khai | Giữ [Điều khoản](../views/legal/terms.html), [Quyền riêng tư](../views/legal/privacy.html) và [Bảo mật](../views/legal/security.html) ở mức tối giản; không còn placeholder công khai. Không thay đổi quyền xem bản ghi hoặc quyền xuất Word. | Cả ba trang còn nguyên panel ID; lệnh check:legal:production đạt. |
| Cổng phát hành | [Checker](../scripts/check_legal_readiness.py) không đọc trạng thái 27 mục nữa; production vẫn thất bại khi thiếu trang, trang rỗng, có [TODO] hoặc phần tử legal-placeholder. Chuỗi package và workflow thủ công vốn đã gọi checker trước khi đóng gói nên được giữ nguyên. | [Kiểm thử Python](../tests/test_legal_readiness.py) và [workflow](../.github/workflows/ci.yml). |
| Quyết định và hướng dẫn | [ADR 0047](adr/0047-retire-27-fact-production-legal-blocker.md) thay phần 27 mục của [ADR 0042](adr/0042-engineering-ci-and-production-legal-gate.md); [phiếu lịch sử](legal-fact-sheet.md) không còn là release dependency. Runbook đóng gói/triển khai đã được đồng bộ. | [Hướng dẫn đóng gói](production-packaging-guide.md), [runbook triển khai](../deploy/README.md). |
| Deployment worker và smoke | Đã thêm unit worker production, env template không chứa secret, verifier boundary và smoke runner chỉ đọc/fail-closed; test tập trung đạt 22/22. | [Unit worker](../deploy/systemd/biddingflow-document-worker.service.example), [smoke](../deploy/scripts/production_smoke.py), [test worker](../tests/test_document_worker_deployment.py), [test smoke](../tests/test_production_smoke.py). Host Linux, systemd, DB role, volume và credential thật chưa được xác minh. |
| Phụ thuộc | Đã cập nhật `brace-expansion` lên `5.0.12` và `undici` lên `6.29.0`; npm audit và pip-audit không còn cảnh báo. | [Package](../package.json), [lockfile](../package-lock.json). Chưa thay thế secret scan/CodeQL và CI của commit phát hành. |
| Secure build và package | Secure build mới đạt, 167 bundle obfuscate; package check và extracted-runtime smoke đạt, 879 runtime files và 5.161.770 bytes. Không có Markdown, source map hoặc secret trong package được kiểm. | [Packager](../scripts/package_production.py), `dist/secure-build.json`: release ID `64f16ed699327c673b51555bdf6804a063c561cc6b75e0161b5b4ca30cdab900`; archive checksum lưu tại `release/biddingflow-production.zip.sha256`. Đây vẫn là artifact working tree, chưa phải release đã phê duyệt. |
| Browser và Playwright release gates | Đã thêm HTTPS/security headers/CSP/assets/console/login/authorized-read smoke; kiểm release ID từ `/api/admin/system/version`; `forbidOnly` và verifier từ chối skip ngoài allowlist/spec bắt buộc không chạy được nối vào CI. | [Browser smoke](../scripts/verify_deployed_browser_smoke.mjs), [verifier](../scripts/verify_playwright_results.mjs), [workflow](../.github/workflows/ci.yml). Các test/verifier tập trung đạt; chưa có staging/browser-matrix current-SHA. |
| Database cục bộ | PostgreSQL cô lập đã đạt schema 98; preflight và transactional dry-run đạt; FK audit 216 khóa ngoại, không thiếu index. | [Database manager](../scripts/manage_database.py), [FK audit](../scripts/audit_fk_indexes.py). Không thay thế clone-data migration, lock/cardinality hoặc restore của host thật. |
| Linked-notice enrichment recovery | Đã thêm claim atomic giữa worker, fencing worker cũ bằng lease epoch-microsecond, recovery `PENDING`/`RUNNING` sau restart; giữ tenant/session/actor/workspace lease/TTL/digest, không cần migration mới. | [Repository](../backend/procurement_import/repository.py), [routes](../backend/procurement_import/routes.py), [lifecycle](../backend/lifecycle.py), [PostgreSQL tests](../tests/test_procurement_enrichment_recovery_postgres.py). 5/5 test PostgreSQL đạt với DB cô lập; chưa có crash drill staging. |
| Thanh toán production | Đã rà soát runtime/webhook/profile/credential reference/activation/reconciliation và bổ sung runbook. Các test PayOS/commercial/activation/quota tập trung đạt 63/63. | [Runbook PayOS](runbooks/payos-production-integration.md), [đăng ký webhook](guides/dang-ky-webhook-payos.vi.md). Chưa cấp secret thật hoặc bật checkout. |
| Kiểm chứng cục bộ | `npm run test:js` đạt 1.920/1.920; Python full run đạt 2.451 test, hai lỗi cleanup do chạy DB đồng thời đã chạy lại tuần tự đạt 2/2; production smoke đạt 7; package/security và static/build đạt. | Bằng chứng của working tree, chưa thay thế coverage, E2E đa trình duyệt/staging và CI của commit ứng viên cuối cùng. |

## Việc bắt buộc trước khi mở production

| Mã | Danh mục | Hiện trạng đã xác minh / chưa xác minh | Việc cần làm và điều kiện hoàn tất |
|---|---|---|---|
| P0-01 | Phạm vi bản phát hành | Working tree có các sửa đổi release gates/recovery/payment runbook; chưa có commit ứng viên. Thanh toán production đã nằm trong scope được yêu cầu. | Chốt owner, dùng checkout phát hành sạch, bảo toàn PPTX ngoài phạm vi; mọi bằng chứng phải gắn cùng commit/ID bất biến. |
| P0-02 | Full engineering gates | Backend không đổi sau snapshot Python 2.502 pass/1 skip và 16 mô-đun trọng yếu. F5 đạt focused 33/33 conflict và 79/79 draft/workflow; ADR 0050 full JS 2.049/2.049, 14 ratchets, focused landing/browser 26/26 và static/lint/secure build đạt. Gate startup landing 100ms đạt hai lượt 30 cold + 30 warm, không task >=50ms. Chưa có authenticated Edge/multi-browser E2E/full CI current-SHA. | Smoke F5 và đo startup Edge/workspace trên staging; chạy full CI và E2E/browser matrix cho cùng commit/ID; không đổi kỳ vọng quyền hoặc dữ liệu để làm test xanh. |
| P0-03 | An ninh và chuỗi cung ứng | Dependency audit cục bộ đã sạch; chưa có kết quả current-commit cho secret scan, CodeQL, vendor assets và security deployment preflight. | Chạy đủ gate, xử lý phát hiện có căn cứ hoặc ghi exception có chủ sở hữu; xác nhận không rò secret/source map và không có Markdown runtime trong artifact. |
| P0-04 | Hợp đồng quyền và dữ liệu | Lượt này không sửa role, tenant, module, assignment, record scope, masking hay API đọc. | Chạy regression xác thực/session, tenant isolation, module/assignment/record authorization và hiển thị đầy đủ bản ghi đã được cấp quyền; quyền xuất Word chỉ điều khiển xuất/tải. |
| P0-05 | Cơ sở dữ liệu | Local isolated schema 98, preflight/dry-run và FK audit đã đạt; runtime hỗ trợ 80–98. Chưa diễn tập trên clone dữ liệu ứng viên và chưa có rollback/restore evidence. | Kiểm tra preflight, migration từ các phiên bản được hỗ trợ trên clone staging tương đương, index/lock/cardinality, dữ liệu trước–sau và đường khôi phục; lưu log schema thực tế đã redacted. |
| P0-06 | Cấu hình và bí mật production | [Mẫu môi trường](../deploy/production.env.example) là template; chưa có bằng chứng host/secret manager được cung cấp trong lượt kiểm tra, không khẳng định secret/hạ tầng thực tế chưa tồn tại. | Xác nhận/cấp secret qua kho bí mật, cấu hình exact origin, SMTP bắt buộc, khóa email outbox và OTP HMAC, cookie, DB private network, admin bootstrap và các tích hợp bật; chạy preflight trên host thật, không commit/in secret. |
| P0-07 | DNS, TLS và biên mạng | Repository có mẫu/runbook, chưa có bằng chứng DNS/TLS, proxy, firewall và ingress trên hạ tầng đích. | Xác minh chứng chỉ, HTTPS/HSTS, trusted proxy, ingress/Cloudflare nếu dùng, nginx và systemd trên host thực tế; lưu kết quả và người chịu trách nhiệm. |
| P0-08 | Sao lưu và khôi phục | Có công cụ/runbook, chưa có bằng chứng lịch chạy, off-host, cảnh báo và diễn tập restore production/staging gần nhất. | Cấu hình backup DB + file, retention, kiểm checksum, lưu ngoài host, cảnh báo stale; khôi phục vào môi trường cách ly và xác nhận RPO/RTO. |
| P0-09 | Giám sát và ứng phó sự cố | Có template chỉ số/cảnh báo; chưa xác nhận scrape, receiver, on-call và diễn tập cảnh báo thực tế. | Kết nối dashboard/alert, đặt ngưỡng, kiểm audit checkpoint, phân công trực và thử alert → tiếp nhận → xử lý. |
| P0-10 | Staging smoke | Smoke runner/browser smoke có kiểm release ID, HTTPS/headers/assets/login/read; contract tests đạt. Chưa có credential smoke, fixture record, artifact ứng viên hoặc log staging. | Cấu hình DEPLOY_SMOKE_SCRIPT/ROLLBACK_SMOKE_SCRIPT bằng artifact ứng viên; cấp tài khoản/cookie ngắn hạn qua secret manager, cài staging giống production, kiểm health/release identity, browser headers/assets/console, login, authorized read, phiên, đồng bộ, Word/Excel và lỗi; lưu log không chứa secret. |
| P0-11 | Cutover và rollback | Runbook có quy trình, chưa có diễn tập cho ứng viên này. | Diễn tập đổi phiên bản, rollback code và phương án khôi phục DB/file sau migration; ghi thời gian, health, dữ liệu và quyết định go/no-go. |
| P0-12 | Secure build và package | Ứng viên sau ADR 0050 khớp source-derived ID `9ba70825…`, 168 obfuscated bundles, 882 runtime files; package/extracted-runtime smoke đạt. ZIP/checksum hiện hành khớp báo cáo; bản trước tối ưu được giữ để phục hồi. Chưa có commit ứng viên hoặc staging deployment. | Đối chiếu release ID/manifest/hash, allowlist, extracted smoke và ZIP không có Markdown/secret/source map trên checkout phát hành sạch; chỉ deploy artifact sau phê duyệt. |
| P0-13 | Provenance và phê duyệt phát hành | SBOM và SHA-256 đã sinh cục bộ cho archive; chưa có release record/approval gắn với commit bất biến và môi trường. | Gắn SBOM, SHA-256, log gate, thay đổi/migration và phê duyệt go/no-go vào release record; đối chiếu artifact → commit → build → môi trường. |
| P0-14 | Trải nghiệm, khả năng truy cập và sức tải | Chưa có bằng chứng staging cho các màn hình chính, responsive, browser matrix, lỗi accessibility nghiêm trọng và capacity/latency của ứng viên. | Kiểm các luồng có xác thực, xuất tài liệu, mobile/desktop, accessibility, baseline hiệu năng và connection budget; sửa lỗi được xác nhận mà không đổi hợp đồng hiển thị dữ liệu. |
| P0-15 | Document worker | Đã thêm unit worker, env template, ràng buộc web–worker, verifier merge `APP_ENV` an toàn và test contract; chưa có bằng chứng host Linux/systemd, service account, DB role, Bubblewrap, volume hoặc sandbox probe thật. | Cài worker/service account, DB role, secret và queue/storage tách biệt; đáp ứng kiểm tra coupling và [trình xác minh worker](../scripts/verify_document_worker_deployment.py) trên host đích, ghi evidence 0600 ngoài release. |
| P0-16 | Enrichment recovery | Recovery/claim/fencing đã implement; 5/5 PostgreSQL regression tests đạt trên DB cô lập, gồm stale-owner rollback, failure-after-progress và starvation. Chưa có crash/rollback drill staging. | Chạy [bộ test PostgreSQL](../tests/test_procurement_enrichment_recovery_postgres.py) trên DB staging phù hợp; kiểm stale worker không ghi đè session bundle, rollback khi mất lease, không đổi TTL/quyền; diễn tập crash/restart staging. |
| P0-17 | Bật thanh toán production | Code/runbook PayOS đã có; lượt kiểm tra chưa có bằng chứng credential, merchant/webhook authorization, legal/commercial approval, host/path và giao dịch thật đã được phê duyệt. Chưa tự bật checkout hoặc giao dịch thật. | Xác nhận các điều kiện trong [runbook PayOS](runbooks/payos-production-integration.md): profile `provider-payos-production-v2`/`env://payos/default`, secret manager, webhook public/HMAC, readiness, reconciliation/support/rollback và staging smoke. Activation ổn → bật checkout trong cửa sổ kiểm thử có kiểm soát đã phê duyệt → giao dịch/đối soát → mở cho khách; xác nhận người thực hiện và số tiền. |

## Việc phụ thuộc tính năng hoặc mô hình triển khai

Các mục này phải hoàn thành **trước go-live nếu tính năng/mô hình tương ứng được bật**. Nếu không dùng, ghi rõ N/A trong release record; không tự suy diễn rằng code mẫu đã được triển khai.

| Mã | Điều kiện áp dụng | Việc còn thiếu / bằng chứng cần có |
|---|---|---|
| C-01 | Tra cứu đấu thầu bằng trình duyệt | Nếu bật: cài Node/Chromium theo runbook cho worker không chạy root, ghim nguồn mạng/TLS, kiểm probe và benchmark trên staging tương đương; không chạy probe --live trong APP_ENV=production. Image bất biến là một lựa chọn triển khai, không phải yêu cầu duy nhất. |
| C-02 | Nhiều app instance | Quyết định shared artifact storage hoặc chỉ chạy một instance; xác minh truy cập file, worker và bản ghi liên instance. |
| C-03 | Thu phí/thanh toán | Đã thuộc scope theo yêu cầu chủ sản phẩm; bắt buộc hoàn tất P0-17 và [runbook PayOS](runbooks/payos-production-integration.md). Nếu phát hành trước khi mở bán, ghi deferred/N/A có quyết định owner; không trình bày là đã sẵn sàng thanh toán. Cờ legal/commercial của thanh toán là quyết định riêng, không hồi sinh 27 mục cũ. |
| C-04 | Dịch vụ ngoài tùy chọn | Với Turnstile, đăng nhập Google, tra cứu đối tác và dịch vụ khác thực sự bật: xác minh credential, miền/origin, quyền dữ liệu, failure mode và smoke trên staging. SMTP production nằm ở P0-06, không phải tùy chọn. |

## Trình tự và quyết định phát hành

1. Chốt scope tính năng, owner và commit ứng viên; giữ nguyên file PPTX của người dùng; tạo secure build/package ứng viên mới cùng checksum/SBOM/release record.
2. Hoàn tất P0-02 đến P0-11, P0-14 đến P0-16 và các mục C áp dụng trên staging/hạ tầng thật; chạy smoke runner/browser smoke/verifier worker bằng artifact ứng viên.
3. Hoàn tất P0-17 theo thứ tự webhook/profile/credential → activation/reconciliation → checkout; giao dịch thật phải có phê duyệt người thực hiện và số tiền. Chạy lại smoke với chính ZIP dự định phát hành.
4. Ghi go/no-go: gate legal trang công khai, full engineering/security/DB/ops, rollback và phê duyệt owner/legal-commercial áp dụng đều đạt. Chỉ sau đó mới cutover production.

Việc bỏ 27 mục pháp lý không tạo thêm quyền truy cập, không che bớt dữ liệu người đã được phép đọc và không miễn trách nhiệm đánh giá pháp lý riêng của đơn vị vận hành.
