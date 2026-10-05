# Phân tích lỗi, tính năng và chuẩn bị production — 05/10/2026

## 1. Kết luận

**Chưa đủ điều kiện phát hành production.** Rà soát phát hiện 9 điểm sai đã tái hiện trong mã hiện tại, tập trung ở đánh giá nhà thầu, tiếp nhận thanh toán và giám sát sao lưu. Hai rào cản phát hành đã xác nhận độc lập là CI của HEAD đang thất bại và ZIP phát hành cũ không khớp workspace/schema mới.

Lượt này chỉ phân tích và tạo báo cáo. Không sửa mã ứng dụng, test, cấu hình hoặc schema; không ghi DB đang dùng, nâng cấp DB, khởi động lại dịch vụ hay triển khai. Các sửa đổi từ lượt dọn code trước được giữ nguyên.

Tenant isolation, role/module/assignment/record scope, session, audit và quyền xem đầy đủ dữ liệu được phép đọc là contract bắt buộc. Entitlement Word kiểm soát hành động xuất. Các đề xuất dưới đây dùng contract hiện hành; thay đổi nghiệp vụ mới cần đặc tả/ADR trước khi thực hiện.

## 2. Phạm vi và độ chắc chắn

### Đối tượng hiện tại

- Workspace: `D:\Bidding`.
- HEAD: `d39509bc67adc1226d6c5a88ff5111cf262ffa3d`, kèm 37 tệp code/test/CSS đã sửa từ lượt trước và báo cáo cleanup chưa commit.
- Inventory theo nhóm: frontend 372 tệp, backend 375, views 83, shared 3, scripts 120, deploy 32, tests 626, workflow/config GitHub 6. Đây là số tệp được khảo sát cấu trúc, không phải số tệp đã kiểm chứng từng dòng bằng runtime.
- Toàn bộ 362 module Python backend được phân tích AST, không có lỗi cú pháp. Rà sâu các đường app/routes, auth/session, scope, sync/CAS/rollback, kế hoạch/gói thầu/đánh giá, nhập Excel/Mua Sắm Công, Word, AI, thương mại/thanh toán, DB/migration, giám sát và triển khai.
- Schema nguồn hiện tại v99: 132 bảng hoạt động, 605 index, 98 trigger; lịch sử migration giữ 164 bảng trong registry lịch sử. Kiểm tra cấu trúc ngoại tuyến không phát hiện điểm không nhất quán mới trong schema/mapping. Không kết nối để kiểm grants hoặc dữ liệu DB thật trong lượt này.

### Cách xác minh

Các lỗi bên dưới dùng module thật hoặc hàm trích nguyên AST từ nguồn hiện tại, với dữ liệu tổng hợp, parser/DB giả và I/O trong Temp. Harness không thay đổi source. Có control đối chiếu cho số, thứ hạng, listener, ngữ cảnh nhập Excel và tính đầy đủ của manifest sao lưu.

Không chạy lại toàn bộ bộ kiểm thử hay toàn bộ hành trình trình duyệt trong lượt phân tích này. Kết quả cleanup cùng ngày được dùng làm bằng chứng nền, có ghi rõ giới hạn ở mục 5. Không suy ra rằng ứng dụng hết mọi lỗi hoặc đã được rà soát bảo mật thủ công từng dòng.

Quy ước:

- **P1**: cần ưu tiên sửa trước release vì sai kết quả, sai mục tiêu thao tác hoặc đánh giá sai khả năng khôi phục.
- **P2**: lỗi có điều kiện hoặc ảnh hưởng hiệu năng/fallback; cần kiểm tra và xử lý theo phạm vi release.
- **P0 trong checklist phát hành**: điều kiện bắt buộc trước cutover, không đồng nghĩa đã chứng minh một lỗ hổng P0.
- **Đã xác nhận**: có đường mã và bằng chứng tái hiện; không đồng nghĩa đã gặp trên production.
- **Khoảng trống triển khai**: có phần code nhưng chưa nối đủ hoặc chưa kiểm chứng trên môi trường thực.
- **Quyết định sản phẩm/vận hành**: cần owner chốt yêu cầu; không tự suy diễn quyền, retention hay mức dịch vụ.

## 3. Lỗi đã xác nhận

### B01 — P1: số thập phân kỹ thuật có thể làm đảo thứ hạng

**Nguồn:** [DetailedEvaluationState.js:121](D:/Bidding/frontend/packages/DetailedEvaluationState.js:121), [formatters.js:13](D:/Bidding/frontend/shared/formatters.js:13), [evaluationMethodRules.js:100](D:/Bidding/frontend/packages/evaluationMethodRules.js:100), [BiddingCalculations.js:53](D:/Bidding/frontend/shared/BiddingCalculations.js:53).

Projection chuyển tổng điểm số `97.125` thành chuỗi `"97.125"`. Parser dùng chung nhận chuỗi này là số có dấu phân cách nghìn và trả **97125**, trong khi nhập chuỗi Việt Nam `"97,125"` hoặc truyền số thật trả **97.125**.

Tái hiện trên `calculateRankings`: hai nhà thầu cùng giá 1.000.000, kết luận Đạt, trọng số kỹ thuật 80%; A có 97,125 điểm, B có 99 điểm. Với số/chữ Việt Nam, B hạng 1 và A hạng 2. Với chuỗi do projection tạo, **A chuyển thành hạng 1**, B còn khoảng 20,08 điểm tổng hợp. Đây là lỗi tính toán, không chỉ lỗi trình bày.

**Hướng sửa:** phân biệt parse dữ liệu canonical và parse chuỗi nhập theo locale tại đúng seam; giữ kiểu/semantics API và storage hiện hành. Hiển thị `97,125`, `1.000.000` theo yêu cầu. Không thay toàn bộ dấu `.` thành `,` bằng tìm/thay chuỗi.

**Nghiệm thu:** điểm 97,125; 0,125; 100; giá hàng nghìn/hàng triệu; lưu → đọc lại → tính xếp hạng → xuất đều giữ cùng giá trị. Có regression khiến ca đảo thứ hạng đỏ trước sửa.

### B02 — P1: tiêu chí cha/con chấm điểm không thống nhất giữa kiểm tra và tổng hợp

**Nguồn:** [detailedEvaluationHierarchy.js:39](D:/Bidding/frontend/packages/detailedEvaluationHierarchy.js:39), [detailedEvaluationValidation.js:89](D:/Bidding/frontend/packages/detailedEvaluationValidation.js:89), [detailedEvaluationAggregation.js:17](D:/Bidding/frontend/packages/detailedEvaluationAggregation.js:17).

Validator bỏ qua mọi tiêu chí có con. Hàm suy kết quả cha chỉ xử lý `pass_fail`; hàm tổng hợp lại dùng cả cha và con để quyết định đạt/tính điểm.

Tái hiện: cha 1 tối đa 100; con 1.1 và 1.2 tối đa 50 mỗi dòng, điểm 40 và 45, đều Đạt. Để cha chưa nhập: validation cho hoàn thành nhưng trạng thái tổng hợp vẫn trống, điểm 85. Điền cha 85: tổng thành **170** vì cộng cả cha và hai con.

**Hướng sửa:** chốt một quy tắc điểm cha/con theo đặc tả và cấu trúc E-HSMT, rồi áp dụng đồng nhất ở UI, validation, projection, backend và export. Cần xác nhận cha là dòng tổng hợp hay dòng được chấm độc lập; bằng chứng hiện tại xác nhận inconsistency, chưa tự định nghĩa công thức mới.

**Nghiệm thu:** tiêu chí nhiều cấp, parent score/pass-fail, điểm rỗng, tiêu chí tùy chọn và import Excel không cho kết quả mâu thuẫn hoặc đếm hai lần.

### B03 — P1: một click vào icon tiêu chí có thể chạy nhiều lần

**Nguồn:** [DetailedEvaluationWorkflow.js:86](D:/Bidding/frontend/packages/DetailedEvaluationWorkflow.js:86), [DetailedEvaluationPanel.js:784](D:/Bidding/frontend/packages/detail/DetailedEvaluationPanel.js:784), [DetailedEvaluationPanelController.js:435](D:/Bidding/frontend/packages/DetailedEvaluationPanelController.js:435).

Renderer thay `innerHTML` nhưng giữ nguyên root. Binder mỗi lượt lại gắn listener click vào chính root, không hủy hoặc thay listener cũ. Sau hai lần bind: một click thêm gọi thêm hai lần; xóa gọi hai lần; sửa toggle hai lần nên kết thúc ở trạng thái không chỉnh sửa và render hai lần. Listener còn giữ state của lượt render cũ.

**Hướng sửa:** mỗi root chỉ có một listener còn hiệu lực, hoặc hủy listener của lần bind trước. Bảo đảm listener dùng state của lượt render hiện tại.

**Nghiệm thu:** render/chuyển tab/chọn nhà thầu nhiều lần, rồi mỗi click thêm/sửa/xóa chỉ tạo đúng một thao tác.

### B04 — P1: nhập Excel đánh giá rồi đổi nhà thầu có thể lưu sai mục tiêu

**Nguồn:** [DetailedEvaluationWorkflow.js:139](D:/Bidding/frontend/packages/DetailedEvaluationWorkflow.js:139), [DetailedEvaluationWorkflow.js:175](D:/Bidding/frontend/packages/DetailedEvaluationWorkflow.js:175), [DetailedEvaluationSaveWorkflow.js:342](D:/Bidding/frontend/packages/DetailedEvaluationSaveWorkflow.js:342).

Import giữ state A trước khi chờ parser/xác nhận, nhưng bước tự lưu resolve lại state đang chọn tại thời điểm sau. Không có kiểm tra ngữ cảnh còn thuộc workspace/gói/nhà thầu/vòng/tab của lần bắt đầu trước các bước ghi nháp/render/save.

Tái hiện bằng Workflow/SaveWorkflow thật và parser trì hoãn: bắt đầu nhập A, chọn B, cho parser hoàn tất. Nội dung nhập vẫn nằm ở draft A; **không có bằng chứng nội dung A bị gán sang B hoặc ghi chéo tenant**. Tuy nhiên hàm save lại persist B, xóa `completedGroups` của B từ `[validity, capacity, technical]` thành `[]`, trả thành công và báo đã nhập/lưu một tiêu chí.

**Hướng sửa:** giữ identity/generation của lần nhập, kiểm tra sau mỗi bước await và trước mọi mutation; chỉ apply/save khi ngữ cảnh bắt đầu vẫn hiện hành. Kết quả đã cũ phải kết thúc rõ ràng, không báo nhập thành công cho nhà thầu mới.

**Nghiệm thu:** đổi nhà thầu, gói, vòng, tab; back/forward; đổi hoặc mất workspace trong lúc đọc/xác nhận Excel. Không persist đối tượng mới và không mất trạng thái đã hoàn thành.

### B05 — P2: thao tác DB đồng bộ chặn HTTP event loop

**Nguồn đã tái hiện:** [webhook.py:32](D:/Bidding/backend/billing/webhook.py:32). Các đường cùng kiểu cần sửa/kiểm tra theo nhóm: [billing/routes.py:610](D:/Bidding/backend/billing/routes.py:610), [commercial_policy/routes.py:119](D:/Bidding/backend/commercial_policy/routes.py:119).

Async handler thực hiện lấy connection, SQL và commit trực tiếp. Trong probe của handler webhook, trì hoãn connection giả 150 ms làm ticker được hẹn sau 10 ms chỉ chạy sau **150,771 ms**. Các request/task cùng process phải chờ phần đồng bộ này. Đây là bằng chứng cấu trúc và hành vi cô lập; chưa đo độ trễ production hoặc khẳng định mọi AST candidate có cùng lỗi.

**Hướng sửa:** chuyển toàn bộ transaction ngắn sang cơ chế DB I/O có giới hạn đã có trong ứng dụng; giữ kiểm tra phiên/quyền/chữ ký, transaction, audit và ACK sau commit. Cách xử lý blocking work này phù hợp hướng dẫn [Python asyncio](https://docs.python.org/3/library/asyncio-dev.html#running-blocking-code).

**Nghiệm thu:** DB chậm/lỗi, webhook retry và request đọc khác chạy đồng thời; ticker/event-loop latency, rollback và ACK sau commit đúng. Đo tải trên staging để đặt budget.

### B06 — P2, có điều kiện: ID webhook không chứa provider profile

**Nguồn:** [webhook.py:71](D:/Bidding/backend/billing/webhook.py:71), [schema.py:2240](D:/Bidding/backend/db/schema.py:2240).

`event_id` chỉ dựa trên hash raw payload và là khóa chính toàn cục; dedupe lại theo `(provider_profile_id, dedupe_key, payload_hash)`. Khi hai profile hợp lệ dùng cùng checksum key và nhận cùng bytes, profile thứ hai va khóa chính.

Probe dùng hàm kiểm chữ ký payOS thật, khóa tổng hợp và DB giả tuân đúng các unique constraint: profile 1 lần đầu →202; replay profile 1 →202/duplicate; cùng payload ở profile 2 →**500 WEBHOOK_FAILED**. Chưa có bằng chứng production đang có hai profile chung khóa hoặc provider gửi trùng bytes sang cả hai.

**Hướng sửa:** identity inbox phải thống nhất phạm vi với dedupe, có xử lý tương thích bản ghi cũ. Không thay quyền đọc billing hoặc logic kích hoạt/ghi nhận thanh toán.

**Nghiệm thu:** cùng/khác profile, rotation profile, retry, trùng payload, payload khác cùng dedupe; lưu/ACK đúng và không kích hoạt quyền lợi hai lần.

### B07 — P1: giám sát có thể công bố backup chưa đầy đủ là đã kiểm chứng

**Nguồn:** [metrics.py:280](D:/Bidding/backend/observability/metrics.py:280), đối chiếu [backup.py:623](D:/Bidding/scripts/backup.py:623).

Helper metrics chỉ kiểm danh sách file và checksum. Nó không áp dụng đủ contract database entry và cây tài sản mà công cụ backup verifier đã có.

Bốn ca tái hiện bằng module thật, không kết nối DB: một manifest control đầy đủ được cả hai chấp nhận. Ba manifest thiếu database entry, database entry không thuộc tập file đã kiểm, hoặc thiếu cây upload/template được khai báo đều bị backup verifier từ chối nhưng **metrics vẫn ghi nhận timestamp backup hợp lệ**.

**Hướng sửa:** dùng một contract kiểm đầy đủ thống nhất, tránh hai bộ quy tắc lệch nhau. Chỉ công bố backup hợp lệ khi đủ thành phần được yêu cầu. Control chỉ kiểm manifest/file; không phải chứng minh dump thật restore được.

**Nghiệm thu:** ba ca âm tính trên và control hợp lệ; metrics/cảnh báo nhất quán với `backup verify --require-complete`. Restore drill thật là gate riêng.

### B08 — P2: kiểm backup trong metrics đọc toàn bộ dump vào RAM

**Nguồn:** [metrics.py:313](D:/Bidding/backend/observability/metrics.py:313), có helper streaming tại [backup.py:145](D:/Bidding/scripts/backup.py:145).

`candidate.read_bytes()` tạo vùng nhớ theo kích thước toàn file trước khi hash. Đo helper thật với dump tổng hợp 8/32 MiB: peak allocation khoảng 8,39/33,56 MB; helper streaming giữ khoảng 2,23 MB ở cả hai cỡ. Không suy ra production đã OOM hoặc dùng các con số này làm benchmark host.

**Hướng sửa:** hash theo từng khối, kiểm giới hạn/thời gian của lượt thu thập metrics; giữ semantics checksum đầy đủ.

**Nghiệm thu:** bộ nhớ không tăng theo kích thước toàn dump; file lớn và file bị sửa trong khi kiểm không tạo kết quả hợp lệ giả.

### B09 — P2: dashboard/notification fallback có thể báo chậm đánh giá sai

**Nguồn:** [dashboardAlertRules.js:46](D:/Bidding/frontend/app/dashboardAlertRules.js:46), [BiddingModel.js:271](D:/Bidding/frontend/app/BiddingModel.js:271), [DashboardView.js:200](D:/Bidding/frontend/app/DashboardView.js:200).

Model serialize metadata đánh giá thành JSON string, nhưng `packageHasEvaluationReport` dùng `Object.values` trực tiếp. Với chuỗi JSON, nó duyệt ký tự thay vì các vòng đánh giá.

Probe cùng dữ liệu có số/ngày báo cáo và `saved=true`: metadata dạng object không có cảnh báo chậm; canonical JSON string tạo một `delayedEvaluation` giả. Đường bị ảnh hưởng là tính cảnh báo frontend/fallback và notification dùng chung rule. Không khẳng định summary do máy chủ tính có lỗi này.

**Hướng sửa:** parse metadata bằng helper chuẩn trước khi kiểm, giữ semantics report/saved hiện hành.

**Nghiệm thu:** object/JSON string/null/metadata lỗi; khi online dùng server summary và khi fallback phải nhận cùng kết quả cho cùng dữ liệu.

## 4. Khoảng trống và các điểm chưa kết luận là bug

| Mục | Trạng thái hiện tại | Việc cần làm |
| --- | --- | --- |
| Retention hội thoại AI | Có `AI_CONVERSATION_RETENTION_DAYS` và helper nhưng 0 runtime caller, 0 lần đọc thuộc tính config. Cấu hình hiện chưa tạo dọn định kỳ. Helper chỉ soft delete | Chốt thời hạn/phạm vi áp dụng, nối cleanup có giới hạn và giám sát; quyết định purge vật lý riêng. Nếu phát hành AI với cam kết retention thì đây là gate cần đóng |
| Word template catalog | Factory API chưa đăng ký, 0 frontend consumer; mặc định tắt. Legacy template/assignment/export vẫn có đường riêng | Owner quyết định có đưa catalog vào release không. Nếu có, cần wiring, shadow parity, UI, export/rollback và nghiệm thu; không coi tính năng tắt là luồng đang chạy bị lỗi |
| Billing của tổ chức | Một số balance/detail trả `BLOCKED_DECISION`; lịch sử mua cá nhân có phạm vi riêng có chủ ý | Nếu release hỗ trợ các màn hình này cho tổ chức, chốt ai được đọc/mua/đối soát và lập ADR. Không tự sửa quyền hoặc mở lịch sử tổ chức |
| Alert khi không có backup hợp lệ | Rule `BiddingFlowBackupStale` chỉ chạy khi `backup_available == 1`; chưa thấy rule báo trường hợp bằng 0 trong bộ mẫu | Bổ sung alert cho thiếu backup và mất scrape/collector; thử đường gửi cảnh báo thật |
| Danh mục tỉnh/xã | Audit 03/10 từng có timeout/502 và cũng có lượt local cuối đạt | Chưa xác định lỗi nguồn mới. Đo lại trên host thật trước kết luận nguyên nhân; thử tải, lỗi upstream và retry |
| Các lỗi CI hiện tại | API cho biết job/step thất bại; annotations chỉ có exit 1, download logs công khai trả 403 | Lấy log/artifact đầy đủ qua tài khoản có quyền, đối chiếu đúng SHA; không gán mọi lỗi CI cho bug sản phẩm hay kết luận đã sửa toàn bộ từ log local |

Nguồn AI: [configuration.py:201](D:/Bidding/backend/ai/configuration.py:201), [conversation_repository.py:276](D:/Bidding/backend/ai/conversation_repository.py:276). Catalog: [routes.py:1060](D:/Bidding/backend/documents/template_catalog/routes.py:1060), [compatibility.py:26](D:/Bidding/backend/documents/template_catalog/compatibility.py:26). Billing: [routes.py:331](D:/Bidding/backend/billing/routes.py:331). Alert: [security-alerts.yml.example:114](D:/Bidding/deploy/monitoring/security-alerts.yml.example:114).

Candidate rò task filesystem metrics đã được loại: probe shutdown bình thường và lỗi startup đều không còn task. Candidate payload webhook không bị giới hạn cũng đã loại vì middleware hiện chặn body theo stream. Không biến các kết quả grep/TODO chưa kiểm chứng thành finding.

## 5. Bằng chứng phát hành hiện tại

### 5.1 CI của đúng HEAD

Đã đọc GitHub API chỉ đọc theo `head_sha=d39509bc…`, không lấy kết quả của revision cũ để kết luận cho revision này. [Full CI 37272838040](https://github.com/newstar94/Bidding/actions/runs/37272838040) kết thúc **failure** ngày 05/10/2026:

| Job | Kết quả |
| --- | --- |
| Quality and static contracts | Failure tại Canonical static quality |
| JavaScript unit coverage | Failure tại JavaScript coverage/critical-module ratchet |
| Python unit and integration coverage | Failure tại Python coverage/critical-module ratchet |
| Cross-browser and workflow E2E | Failure tại Playwright matrix; full role/workflow, admin frontend budget và analytics journey bị skip |
| Secure production build | Success |
| PostgreSQL schema and FK audit | Success, gồm admin large-data/query budgets |
| Startup performance budget | Success |
| Package and dependency gates | Success |
| Publish verified production artifact | Skipped |

[Supply-chain](https://github.com/newstar94/Bidding/actions/runs/37272838054), [CodeQL](https://github.com/newstar94/Bidding/actions/runs/37272838053) và [N+1 regressions](https://github.com/newstar94/Bidding/actions/runs/37272838121) cùng HEAD đạt. Các gate này không kiểm chứng working tree chứa bản sửa cleanup chưa commit và không chứng minh host production đã sẵn sàng.

### 5.2 ZIP hiện có và source hiện tại

Kiểm ZIP trực tiếp, không giải nén/chạy runtime/đóng gói lại:

| Thuộc tính | ZIP hiện có | Workspace hiện tại |
| --- | --- | --- |
| Schema | 98 | 99; runtime chấp nhận 99–99 |
| Frontend release ID | `75ae952e7c038f702b530ffce64a860e190b3405ddd251b8e603e24caa15d0c7` | `062f95215429bae66b0936552ad78a68f577b88f1683a0964738f918ba0f65bd` |
| File inventory | 894 runtime files + manifest | 440 entry trong ZIP không khớp cây hiện tại: 381 không còn path tương ứng, 59 khác bytes |

SHA-256 ZIP: `d0d26447db43c53df0a174e32946ff9e6a73c463bcea9f7c98796acd9d2b1685`. Manifest nội bộ của ZIP tự nhất quán, không có `.md`, `.map`, `.env` thật hoặc `.pyc`. Đây là kiểm tra tính toàn vẹn của gói cũ, không chứng minh gói khớp release mới.

Trong các mismatch có 78 path backend; 32 path backend đã bị xóa khỏi source, gồm Conflict Center, legal/compliance và version comparison. Không đếm chunk cũ thiếu khỏi build mới như 381 lỗi riêng. ID của secure build hiện tại khớp ID suy ra từ source, nhưng build đúng không làm ZIP cũ tự cập nhật.

**Không dùng ZIP hiện có cho release mới.** Runtime hiện chấp nhận schema v99; phải kiểm tra compatibility của release rollback với v99. Không giả định đổi symlink về code v98 là rollback đủ, và không sửa giảm số schema bằng tay.

### 5.3 Kiểm thử local từ lượt cleanup cùng ngày

Theo [báo cáo cleanup](D:/Bidding/docs/audit-cleanup-20261005.md): JavaScript cuối 2.281/2.281 đạt; static và secure build đạt. Python full đầu 2.963 đạt, 2 lỗi, 11 skip, 1 deselected; hai seam lỗi sau sửa chạy lại 7/7, webhook bổ sung 18/18. **Chưa chạy lại toàn bộ Python sau hai sửa cuối**, chưa chạy đầy đủ E2E cuối trên source hiện tại.

Các số này là bằng chứng local đã có, không phải full suite mới của lượt audit này. Cần gate mới sau sửa các finding và chốt revision release.

## 6. Đề xuất tính năng mới

Các đề xuất sau suy ra từ đường dùng và phần code hiện có, chưa được thực hiện. Ưu tiên tính chính xác và giảm thao tác trước khi mở rộng nghiệp vụ.

| Ưu tiên | Tính năng | Giá trị và phần mới | Độ lớn / phụ thuộc |
| --- | --- | --- | --- |
| F1 | **Xem cách tính xếp hạng** | Mỗi nhà thầu có phần giải thích phương pháp, điểm kỹ thuật gốc/chuẩn hóa, giá dùng xếp hạng, trọng số, điểm tổng hợp và lý do loại khỏi xếp hạng. Hiện UI chủ yếu hiển thị số điểm/hạng | Nhỏ–vừa; sửa B01/B02 trước; dùng công thức hiện có, không cho sửa tay kết quả |
| F2 | **Xem trước đối chiếu Excel đánh giá** | Trước khi apply, xem nhà thầu/vòng/tab đích, tiêu chí khớp/không khớp, giá trị sẽ thay và cảnh báo số/điểm. Hiện workflow auto apply/save rồi mới báo matched/skipped | Vừa; dùng analysis đã có, bổ sung bước review và hủy; sửa B04, kiểm ngữ cảnh và atomic save |
| F3 | **Tìm nhanh toàn workspace** | Một ô tìm kế hoạch, gói thầu, nhà thầu, chủ đầu tư, hợp đồng rồi mở đúng màn hình; hữu ích khi biết mã/tên nhưng chưa biết phân hệ. Hiện có tìm từng phân hệ, tìm admin và công cụ AI search | Vừa; tái sử dụng record/module/assignment scope hiện hành, phân trang có giới hạn, tìm tiếng Việt có/không dấu; không phụ thuộc AI |
| F4 | **Theo dõi thực hiện hợp đồng theo đợt** | Sổ các đợt tạm ứng, nghiệm thu, thanh toán, còn phải trả và bảo hành/bảo lãnh, kèm ngày/chứng từ. Hiện có hồ sơ/tổng giá trị/trạng thái/ngày thanh lý, chưa có ledger theo đợt | Lớn; đặc tả nghiệp vụ, migration, versioning, số tiền, quyền theo contract và đối soát; roadmap sau release ổn định |

Nguồn F1: [BidEvaluationRankingController.js:127](D:/Bidding/frontend/packages/BidEvaluationRankingController.js:127). F2: [DetailedEvaluationImport.js:129](D:/Bidding/frontend/packages/DetailedEvaluationImport.js:129), [DetailedEvaluationWorkflow.js:169](D:/Bidding/frontend/packages/DetailedEvaluationWorkflow.js:169). F3: [AdminSearch.js:21](D:/Bidding/frontend/admin-platform/AdminSearch.js:21), [workspace_search.py:89](D:/Bidding/backend/ai/workspace_search.py:89). F4: [schema.py:1498](D:/Bidding/backend/db/schema.py:1498), [HopDongWorkflow.js:583](D:/Bidding/frontend/contracts/HopDongWorkflow.js:583).

Nghiệm thu tính năng mới cần bảo toàn quyền dữ liệu hiện hành, kiểm kết quả trên dữ liệu thật được phép dùng và có phản hồi rõ ràng khi thao tác bị từ chối. Conflict luôn lấy server làm chuẩn. Các tính năng vừa chủ động loại bỏ không nằm trong roadmap này.

## 7. Checklist chuẩn bị production

| Mã / mức | Việc cần làm | Trạng thái | Owner / bằng chứng để đóng |
| --- | --- | --- | --- |
| R01 / P0 | Sửa B01–B04/B07, kiểm tra nhóm B05–B09; chốt quy tắc điểm cha/con | Lỗi còn trong code; semantics B02 cần quyết định cụ thể | Dev + QA + chủ sản phẩm; regression đỏ/trước, đạt/sau, E2E đánh giá/xếp hạng/import đúng |
| R02 / P0 | Chốt revision release chứa các sửa đã chọn; Full CI đúng revision đạt | HEAD CI thất bại, cleanup chưa commit | Chủ repo + Dev/QA; toàn bộ job bắt buộc đạt, không bỏ E2E đang skip; giữ logs/artifact đúng SHA |
| R03 / P0 | Build và package mới từ revision đó | Build local mới khớp source; ZIP cũ | Release owner; manifest/checksum/SBOM/identity, 0 Markdown/source map/env thật/private symbols/cache; extracted-package smoke trên DB cách ly |
| R04 / P0 | Kiểm nâng cấp v98 →v99 và phương án rollback dữ liệu/code | Có migration/archival và gate local; chưa diễn tập host/data thực | DBA + Release; bản sao dữ liệu đại diện, backup đủ trước migration, archive/FK/row counts/checksum, cấp/kiểm quyền backup trong namespace archive sau nâng cấp, thời gian nâng cấp, compatibility rollback và restore khi cần |
| R05 / P0 | Linux document worker và browser Mua Sắm Công chạy dưới unit thật | Unit/config/verifier có; chưa có bằng chứng host | Ops + Dev; service identity, sandbox/IPC/mount/storage ACL, Node/Chromium tương thích policy systemd; job Word tạo/tải thành công, import nguồn thật |
| R06 / P0 | PostgreSQL production: role/grants/TLS/ngân sách kết nối | Có công cụ preflight/config; chưa kiểm host | DBA; runtime/migrator/backup/worker roles, effective grants/ownership/search_path, TLS verify-full, max_connections và pool × workers × instances; migration chỉ chạy bằng role dành riêng |
| R07 / P0 | Storage, lịch backup và backup/restore ngoài host | CLI có; chưa thấy orchestration định kỳ/offhost trong repo, hạ tầng ngoài chưa kiểm; metrics sai B07/B08 | Ops/DBA; volume riêng, mã hóa, quota/ACL, lịch chạy và biên nhận, DB+uploads+templates đủ, retention/offhost retrieval, restore vào môi trường cách ly, RPO/RTO đo thật |
| R08 / P0 | Ingress HTTPS/session và cấu hình public origin | Template có; chưa có bằng chứng origin production | Ops; DNS/TLS, proxy/host/origin/cookie, private DB/metrics, live/ready từ ingress, smoke đăng nhập/đọc bản ghi theo đúng release ID |
| R09 / P0 | Deploy/rollback staging trên đúng artifact | Runbook/helper có; chưa diễn tập candidate v99 | Release/Ops/QA; versioned release, smoke web+Word, asset N/N+1, rollback/restore có logs; thử tab cũ, worker và mutation trong cutover |
| R10 / P1 | Provider thật và đường mạng nguồn | Contract/test có, không kiểm provider live trong lượt này | Owner tích hợp; SMTP/OTP/reset, OAuth, Turnstile, payOS create/retry/webhook/reconcile, Mua Sắm Công mapping method/txtK/score và tỉnh/xã. Provider bắt buộc với scope release phải đạt trước cutover |
| R11 / P1 | Theo dõi và cảnh báo vận hành | Metrics/alert mẫu có; thiếu alert backup không hợp lệ | Ops; dashboard lỗi/latency/DB/queue/disk/backup, SLO, threshold, alert mất scrape/collection, không có backup hoặc drill thiếu/cũ, thử gửi cảnh báo tới người trực |
| R12 / P1 | Retention, quota lưu trữ, secret rotation và ứng phó sự cố | Có cơ chế từng phần; AI retention chưa wired; giá trị/owner chưa xác nhận | Owner vận hành/sản phẩm; chính sách từng loại dữ liệu, rotation/khôi phục keys, audit checkpoint offhost, quyền thao tác vận hành, runbook và người trực |
| R13 / P1 | Full E2E nghiệp vụ/quyền/multi-tab/offline và tải đại diện | Gate/harness có; chưa có aggregate đạt trên source release cuối | QA; kế hoạch →gói →mở thầu →đánh giá →kết quả →hợp đồng →Word; 1/2 túi hồ sơ, lô/thuốc/liên danh, numeric score, loading/toast, rollback khi lỗi, server-wins conflict, workspace/persona/navigation |
| R14 / P1 | Quyết định scope sản phẩm và các trang công khai | Catalog tắt; billing tổ chức có BLOCKED_DECISION; trang/legal gate có | Chủ sản phẩm; xác nhận tính năng bán trong release, điều khoản/chính sách công khai và hỗ trợ, chốt quyết định còn thiếu. Không coi script legal pass là xác nhận pháp lý |
| R15 / P2 | Tài liệu hỗ trợ, onboarding và roadmap F1–F4 | Đề xuất | Product/Support; hướng dẫn lỗi và phục hồi, liên hệ hỗ trợ, changelog, kế hoạch cải tiến sau release |

Tài liệu PostgreSQL phân biệt SQL dump, filesystem backup và continuous archiving; chọn cách backup/RPO theo nhu cầu rồi diễn tập khôi phục, không dùng sự tồn tại của một file làm bằng chứng an toàn. [PostgreSQL 17 — Backup and Restore](https://www.postgresql.org/docs/17/backup.html)

V99 chuyển các bảng đã nghỉ vào namespace archive. PostgreSQL mô tả `SET SCHEMA` chuyển cả index/constraint/sequence thuộc bảng; backup role phải được kiểm lại quyền truy cập schema đó. `pg_dump` không lưu cluster roles/tablespaces, nên diễn tập recovery cần cả quy trình tái tạo role/secret của host. [PostgreSQL 17 — ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html), [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

Web unit hiện có `MemoryDenyWriteExecute=true` và `RestrictNamespaces=true`, trong khi launcher cần Node/Chromium. Tài liệu systemd nêu các giới hạn này có thể ảnh hưởng JIT và namespace; đây là suy luận về rủi ro tương thích cần test trong unit thực, chưa phải lỗi Node/Chromium đã tái hiện. Không tự bỏ sandbox để làm gate đạt. [systemd.exec chính thức](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.exec.xml), [web unit](D:/Bidding/deploy/systemd/biddingflow.service.example:1), [launcher](D:/Bidding/backend/integrations/muasamcong_browser/launchers.py:1).

Unit dùng nhiều Uvicorn workers; tính ngân sách pool và kiểm tải phải phản ánh cả workers/instances. [Uvicorn — settings](https://uvicorn.dev/settings/).

### Thứ tự thực hiện

1. Lấy log CI hiện tại, sửa các lỗi đã xác nhận và chốt B02; giữ các contract hiện hành.
2. Chạy kiểm thử trọng điểm rồi full Python/JS/static/E2E trên source cuối; chốt revision khi có thẩm quyền repo.
3. Tạo artifact mới và kiểm extracted runtime bằng DB/thư mục cách ly; lưu identity/checksum và evidence cùng release.
4. Chuẩn bị host/DB/secret/storage; backup, migration rehearsal, Linux worker/browser và provider thật trên staging.
5. Diễn tập deploy/rollback/restore, đo RPO/RTO và tải đại diện; thử alert và giao người trực.
6. Chỉ cutover khi các gate bắt buộc của phạm vi release đóng, có release owner xác nhận và phương án khôi phục đã kiểm chứng.

Các tính năng roadmap không bắt buộc phải làm hết để phát hành bản hiện có. Gate bắt buộc là tính đúng đắn, phạm vi đã cam kết và vận hành có bằng chứng.

## 8. Hồ sơ bằng chứng và giới hạn bàn giao

Thư mục bằng chứng: `C:\Users\newst\AppData\Local\Temp\bidding-production-analysis-20261005-143920`.

| File | Nội dung |
| --- | --- |
| `frontend-findings.json`, `frontend-readonly-proof.mjs` | Listener, cha/con, projection số |
| `ranking-decimal-evidence.json`, `ranking-decimal-proof.mjs` | Hai nhà thầu bị đổi thứ hạng |
| `excel-context-evidence.json`, `excel-context-proof.mjs` | Import A, persist trạng thái B |
| `dashboard-metadata-evidence.json`, `dashboard-metadata-proof.mjs` | Metadata object/string và cảnh báo giả |
| `backend-webhook-probe.json`, `probe_backend_webhook.py` | Event-loop và collision profile, chữ ký tổng hợp |
| `backend-static-probe.json`, `backend-production-audit.json` | Inventory backend, AI/catalog wiring và coverage |
| `backup-metric-probe.json`, `probe_backup_metrics.py` | Control +3 manifest thiếu thành phần |
| `backup-memory-probe.json` | Bộ nhớ với dump tổng hợp 8/32 MiB |
| `frontend-readonly-audit.md`, `db-ops-production-findings.vi.md` | Phạm vi rà sâu, nguồn chính thức và các candidate bị loại của từng phần |
| `db-ops-offline-structural.json`, `lifespan-task-probe.json` | Schema/mapping ngoại tuyến, candidate task leak bị loại |
| `artifact-audit.json`, `artifact_audit.py` | ZIP manifest, source IDs/schema và mismatch |
| `ci-readonly.json`, `ci-jobs-readonly.json`, `ci-annotations-readonly.json` | Snapshot GitHub của đúng HEAD |

Bằng chứng Temp cần được lưu vào kho evidence của release khi bắt đầu chuẩn bị phát hành. Không dùng báo cáo 03/10, một lần test local hoặc một hash ZIP để thay các gate còn thiếu của revision hiện tại. Không có bằng chứng mới trong lượt này cho staging/Linux, grants/TLS thật, restore offhost, payOS/SMTP/OAuth/Turnstile thật hoặc cutover production.
