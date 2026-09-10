# Prompt 1 — báo cáo bàn giao hoàn tất

Phạm vi kỹ thuật của Prompt 1 đã hoàn tất trên `main` và được xác minh lại tại
`7bc7e968ccd76cad28d1fb23ccbce51c0dccd3a1` cả cục bộ lẫn
trên GitHub Actions. Phát hành production vẫn bị chặn hợp lệ bởi dữ kiện pháp
lý bên ngoài như nêu dưới đây; đây là ngoại lệ được Prompt 1 cho phép và không
được hợp thức hóa bằng dữ liệu giả.

## Cập nhật bằng chứng ngày 11/09/2026

- HEAD và `origin/main` cùng là `7bc7e968ccd76cad28d1fb23ccbce51c0dccd3a1`
  tại lần audit hoàn tất Prompt 1 gần nhất.
- Full CI run `34541273596` hoàn tất `success`, bao gồm static contracts,
  PostgreSQL schema/FK, Python và JavaScript coverage, secure build, package,
  startup performance, cross-browser matrix, full role/workflow E2E và product
  analytics browser journey.
- CodeQL run `34541273635`, N+1 run `34541273661` và Supply-chain Security run
  `34541273577` đều hoàn tất `success` trên cùng SHA.
- Regression cuối cho race thu hồi phân công chạy qua đúng luồng pull: snapshot
  delta có thẩm quyền đã loại gói thầu vẫn đóng editor dù visibility token đã
  được quan sát trước. Suite multi-assignee cô lập đạt cả biến thể delta 200 và
  full-reset 409; không tăng timeout, retry hoặc thay đổi expectation.

## Cập nhật bằng chứng ngày 10/09/2026

- Toàn bộ suite cô lập `-Suite all -Project all` đạt: smoke 49 passed/5 skipped,
  sau đó auth shell, UI quality, authenticated UI matrix, auth roles, offline,
  multi-assignee, joint venture, low-price conflict, CRUD, pairwise và lifecycle
  đều exit 0. Lifecycle cuối là `E2E-1789041941003`.
- CRUD đã sửa barrier của hộp thoại chọn phiên bản: modal cha tạm ẩn không còn bị
  hiểu nhầm là persistence hoàn tất; create/update hợp đồng đều chờ đúng POST
  canonical chứa bản ghi dự kiến trước khi reload. Regression harness đạt 44/44.
- Cross-browser package conflict và landing đạt trên Chromium, Firefox, WebKit.
  Ownership/generation regression của bảng gói thầu đạt 11/11.
- `check:static`, JavaScript coverage, secure build, N+1 (25/25), SBOM,
  dependency audit và package extracted-runtime đều đạt. Secure build có 163
  bundle; package có 876 runtime files, 4.939.942 bytes.
- Startup đạt cold/warm p95 1245/236 ms, longest task 71 ms. First-tab đạt sau
  cô lập loopback khỏi host proxy; tất cả lượt đo dưới 100 ms, không runtime error.
- Hai lượt review độc lập cuối không có finding. GitHub CI từ xa chỉ được coi là
  xác nhận sau khi commit được push và các workflow của commit đó kết thúc xanh.

## Cập nhật bằng chứng ngày 09/09/2026

Các workflow bổ sung hiện có exit 0: auth-shell, auth-roles, bidder-goods,
UI-quality, pairwise, low-price conflict, joint-venture và analytics browser
journey. CRUD có một lượt đạt đầy đủ sau một lỗi mở editor gián đoạn chưa tái
hiện. Analytics có ResourceWarning lúc teardown, không được gọi warning-free.
Nhật ký tương ứng: `data/logs/prompt1-final-*.log` và
`data/logs/prompt1-crud-package-edit-diagnostic.log`.
Smoke tích hợp có một lỗi Firefox điều hướng trước khi vào chi tiết; bài riêng
đã đạt sau bổ sung readiness. Smoke tổng sau đó đạt 49 bài, 5 skip, exit 0.

Checkpoint mới hơn: build `903acc6beb91d9f4c1a431b6d1b8dfc7dda79992b16cac7d568c636ed1e7ebfe`
đã build secure/static đạt và toàn lifecycle `E2E-1788923825487` exit 0
(`data/logs/prompt1-memory-20260909-101656.*`). Lỗi trạng thái cũ ở màn hình
chi tiết đã có regression tái hiện: cache phân trang ghi đè mutation đang chờ
trong shared state, rồi acknowledgment cập nhật rowVersion. Bản sửa giữ overlay
pending cùng ID trong state/DB, không làm bẩn cache canonical hoặc thêm ID ngoài
response. 55 kiểm thử seam đạt, bài tái hiện trình duyệt và full lifecycle đạt.
Coverage nguồn cuối đã đạt: JavaScript 1740 bài, Python 2198 bài và critical
ratchets đều đạt. Các số liệu trong nhóm checkpoint cũ bên dưới chỉ là lịch sử,
không mặc nhiên áp dụng cho build mới.

Hai nhóm fixture từng skip đã chạy riêng thành công cả ba browser: nhập kế hoạch
và vi phạm nhà thầu, mỗi nhóm 3/3. Không đổi business contract để đạt các bài này.

- Bản build checkpoint trước: `83c910ff1606485041e598dc07c2703b4a583290178033430c1a7b0b8f50e196`.
- `npm.cmd run test:js:coverage`: exit 0, 1737/1737, không skip; lines
  53.64%, branches 65.31%, functions 67.62%, 14 critical modules đạt.
- `npm.cmd run build:secure` và `python scripts/verify_secure_build_artifact.py`:
  exit 0. Kiểm tra static sau sửa promise: exit 0.
- `python scripts/package_production.py --check`: lần chạy độc lập exit 0,
  876 tệp / 4.937.287 bytes; lần trước quá hạn khi có tải kiểm thử đồng thời
  vẫn được ghi nhận, chưa chứng minh nguyên nhân. Không tăng giới hạn 60 giây.
- Toàn lifecycle `E2E-1788907053985`: exit 0, gồm một/hai túi hồ sơ,
  hợp đồng, hủy/đấu thầu lại, hai đợt kết quả phân lô và snapshot lịch sử.
  Nhật ký `data/logs/prompt1-memory-20260909-053727.*`.
- Tại checkpoint cũ còn lỗi hiển thị và thiếu coverage nguồn mới; các mục này
  đã có bản sửa/bằng chứng nêu ở phần cập nhật phía trên. Lịch sử lỗi được giữ,
  còn kết luận hoàn tất phải dựa vào audit yêu cầu hiện tại.

## Baseline

- Baseline được prompt quan sát: `1e06300eb3bb8508b770326e37e55f9d31278dcf`.
- Branch hoàn tất: `main`; HEAD và `origin/main`:
  `7bc7e968ccd76cad28d1fb23ccbce51c0dccd3a1` tại lần audit gần nhất.
- Full CI baseline: https://github.com/newstar94/Bidding/actions/runs/34008073708
  — lỗi quality, package candidate và cross-browser matrix.
- Full CI sau sửa: https://github.com/newstar94/Bidding/actions/runs/34541273596
  — `success`.
- CodeQL sau sửa: https://github.com/newstar94/Bidding/actions/runs/34541273635
  — `success`.

### Lịch sử Full CI và phân loại

| Run / SHA | Kết quả | Phân loại |
| --- | --- | --- |
| `34008073708` / baseline `1e06300e` | Quality, package candidate và cross-browser lỗi | Nợ tồn tại trước Prompt 1 |
| `34525868784` / `2d94b62e` đến `34529555036` / `36ea6fe8` | Full role/workflow E2E lỗi trong bốn commit tích hợp Tabler kế tiếp | Regression của phạm vi Prompt 2, được sửa trước khi chốt HEAD hiện tại; không đổi expectation hay quyền để làm xanh |
| `34532286895` / `295115b8` | Toàn bộ engineering CI đạt | Mốc Prompt 1 hoàn tất ban đầu |
| `34541273596` / `7bc7e968` | Toàn bộ engineering CI đạt lại | Xác minh không regression Prompt 1 trên HEAD audit hiện tại |

## Architecture/Call Flow

Form → MutationService → lưu IndexedDB/outbox → SyncPushService → POST /api/sync
→ sync service → assignment augmentation → validator/access policy → writer
→ PostgreSQL commit → delta/WebSocket hint → SyncPullService → snapshot/rebase/render.
Kế hoạch nháp nhiều phiên bản commit qua `/api/plans/finalize-draft`.

## Root Causes

1. Assignment lịch sử được dùng như grant cho phiên bản khác; resolver ghi cần khớp exact snapshot và khóa assignment trong transaction.
2. ID vật lý mới bị nhầm với dòng nghiệp vụ mới khi root vật lý không còn nhưng descendant tồn tại; lookup phải kiểm cả id và id_goc.
3. Local durable bị nhầm với canonical success; cần phân loại kết quả sync và chỉ gọi success sau commit.
4. Rejected INSERT bị tra cứu canonical không tồn tại; receipt version/base snapshot cho phép nhận diện và rollback trực tiếp.
5. Khôi phục phiên bỏ sót activeuser.id; quyền đã tải nhưng form dùng ID rỗng.
6. URL ảnh tenant hợp lệ bị grammar frontend cũ loại bỏ; cần hỗ trợ đúng segment tenant backend hiện hành.
7. Form nạp chọn lọc không chờ permissionmatrix; tính quyền quá sớm làm khóa trường dấu.
8. Profile refresh ghi đè options multi-assignee của form, xóa lựa chọn người tạo.
9. Lưu gói gửi kèm kế hoạch không đổi, bị từ chối đúng ở quyền edit kế hoạch; chỉ gửi parent thực sự thay đổi.
10. Dirty draft/outbox có thể phục hồi projection bị thu hồi; cần loại ID theo snapshot có thẩm quyền, giữ riêng mutation chờ xử lý và đồng bộ metadata thu hồi theo workspace.
11. Token storage do tab khác cập nhật không chứng minh tab hiện tại đã reconcile; so sánh thêm token đã quan sát của chính tab.
12. E2E conflict chờ phản hồi A trong khi cố tình giữ request A để B commit; bắt đầu chờ ngay trước release A.
13. Cleanup E2E xóa audit bất biến; giữ/report audit, rollback savepoint và không nuốt lỗi khác.
14. SBOM Python thiếu cạnh từ ứng dụng đến dependency trực tiếp; ánh xạ manifest vào component chính xác.
15. SyncPushService chờ cặp khóa/giá trị Map thay vì promise của pull đang chạy,
    tạo vòng lặp microtask, tăng bộ nhớ renderer và gây OOM. Dấu vết debugger
    chỉ tới nhánh allSettled; regression thất bại trước sửa, đạt sau khi trích
    đúng flight.promise. Không phải bằng chứng lỗi GPU hoặc transport Chromium.
16. `cachePaginatedRecords` ghi snapshot máy chủ cũ vào shared state trong khi
    mutation vẫn chờ; bảng có overlay riêng nhưng detail dùng trạng thái cũ.
    Acknowledgment sau đó gắn rowVersion mới lên trường cũ. Giữ pending overlay
    cùng ID trong state/DB, cache canonical tách biệt; unit repro và lifecycle đạt.
17. HTML bundle loại preload font nguồn mà không thay bằng URL font đã hash;
    trình duyệt phát hiện font muộn trong lần bố trí đầu. Preload từ manifest đã
    xác thực giữ nguyên font sản phẩm; phép đo chính thức sau tích hợp đạt,
    đồng thời vẫn lưu các mẫu vượt 100 ms trước đó.

## Changes Made

- Backend access policy/assignment augmentation/validator: exact-target grants, batch lineage existence, transaction assignment locking, trusted server inheritance.
- MutationService và workflows: trạng thái lưu trung thực, bảo toàn offline/outbox, không success trước server acknowledgement.
- SyncPullService, syncMergeUtils, planBreakdownDraft, SyncRenderCoordinator: purge projection/draft/backup bị thu hồi; không cấp quyền từ pending upsert; đóng editor bị thu hồi.
- AuthFlowController, view_helpers, BiddingController, SystemUserView: sửa identity hydration, ảnh tenant, dependency quyền của form và ghi đè dropdown nền.
- CI/package/SBOM: tách engineering checks khỏi phát hành có legal gate; không tắt cổng bảo mật.
- E2E/tests: tạo mới Chuyên viên quyền view, dấu được lưu/reload, tự phân công PostgreSQL, hai tab đang sửa khi transfer, race/rollback và regression gates.
- tableDataUtils: phản hồi phân trang giữ mutation cùng ID trong shared state/DB,
  thay vì chỉ overlay hàng hiển thị; cache canonical vẫn giữ riêng và không thêm
  bản ghi ngoài response. Có kiểm thử lỗi trước sửa và lifecycle sau sửa đạt.
- frontend_assets/app: preload đúng hai font WOFF2 hiện hữu bằng đường dẫn đã
  xác thực từ manifest; không đổi font, CSS, quyền hoặc dữ liệu nghiệp vụ.

## Authorization Matrix

| Chủ thể | Hành vi được giữ |
| --- | --- |
| Manager | Quyền hiện hành trong tenant; lựa chọn phân công rõ ràng |
| Specialist A/B | Tạo logical-new khi đủ module view; sửa bản tồn tại cần edit và scope hợp lệ |
| View-only specialist | Không được sửa bản tồn tại, trừ ngoại lệ Nhà thầu do mình tạo theo ADR 0040 |
| Unassigned specialist | Không có grant đọc/ghi bản ghi cần assignment chỉ vì cùng tenant |
| Old assignee | Mất grant phiên bản đã chuyển; independent grant hợp lệ vẫn được giữ |

Không thay đổi masking hay quyền đọc đầy đủ bản ghi đã được cấp quyền; Word entitlement chỉ kiểm soát xuất Word.

## Concurrency

Test PostgreSQL hai kết nối quan sát blocking graph: writer khóa assignment,
ghi bản ghi thật rồi commit; transfer mới commit tiếp; lần ghi sau của người cũ bị từ chối.
E2E hai tab dirty package/plan breakdown đạt trên bản token mới; các tab đóng editor và purge list sau transfer.

## Sync State Contract

- LOCAL_DURABLE: lưu trên thiết bị, chưa phải server success.
- REMOTE_PENDING: đang chờ xác nhận.
- CANONICAL_COMMITTED: server xác nhận và không còn mutation đang chờ của kết quả đó.
- CANONICAL_REJECTED: server từ chối; phân loại code và rollback phù hợp.
- CONFLICT: xử lý ROW_VERSION_CONFLICT theo quarantine/reload hiện hành, không force overwrite.
- OFFLINE_PENDING: giữ mutation bền vững để đồng bộ sau; không báo success chính thức.

## CI Before / After

| Check | Baseline | Sau sửa trên SHA `7bc7e968` |
| --- | --- | --- |
| Quality/static | Lỗi | Full CI `success` |
| Python coverage | Chưa đạt gate tổng | Full CI `success`; critical coverage đạt |
| JS coverage | Chưa đạt gate tổng | Full CI `success`; critical coverage đạt |
| Secure build | Chưa có artifact chốt | Full CI `success` |
| DB/FK | Chưa có bằng chứng chốt | Full CI `success` |
| Playwright cross-browser | Lỗi | Chromium, Firefox và WebKit `success` |
| Full role/workflow E2E | Lỗi | Full CI `success` |
| Startup performance | Chưa có kết quả chốt | Full CI `success` theo ngưỡng đã duyệt |
| N+1 | Cần xác minh | Run `34541273661` `success` |
| Package/dependency/SBOM | Lỗi package candidate | Full CI và Supply-chain `success` |
| CodeQL | Baseline cũ không phủ patch | Run `34541273635` `success` |
| Legal production release | BLOCKED | Vẫn BLOCKED, 27 dữ kiện chưa duyệt; không giả mạo |

## Commands Actually Run

Các lệnh dưới đây đã có kết quả được quan sát; lịch sử lỗi và thứ tự bản sửa nằm
trong `prompt1-verification-progress.md`. Không coi tất cả là chạy trên cùng SHA.

| Exact command | Exit / kết quả |
| --- | --- |
| `git fetch origin` | 0 |
| `git diff --check` | 0 |
| `npm.cmd run check:static` | 0 |
| `npm.cmd run lint:security` | 0 |
| `npm.cmd run build:secure` | 0, artifact nêu trên |
| `npm.cmd run test:js:coverage` | 0, 1740 passed, log `prompt1-pending-projection-js-coverage.log` |
| `python -m pytest -q -m "not browser_e2e" --cov=backend --cov-branch --cov-report=term --cov-report=json:coverage.json --cov-fail-under=45` | 0, 2186 passed / 1 skipped / 1 deselected |
| `python scripts/check_critical_coverage.py coverage.json` | 0, 16 modules |
| `python -m pytest -v -m "not browser_e2e" --cov=backend --cov-branch --cov-report=term --cov-report=json:coverage.json --cov-fail-under=45` | 0, 2198 passed / 1 skipped / 1 deselected, 63.77%; `prompt1-python-final-verbose.log`, có footer mã thoát |
| `python -m pytest -q tests/test_n_plus_one_regressions.py` | 0, 25 passed |
| `python -m pytest -q tests/test_specialist_default_assignment.py` | 0, 25 passed với TEST_DATABASE_URL riêng |
| `python -m pytest -q tests/test_workspace_asset_permissions.py tests/test_contractor_creator_edit.py tests/test_record_access_projection.py` | 0, 39 passed với TEST_DATABASE_URL riêng |
| `python scripts/audit_fk_indexes.py` | 0, 214 foreign keys / không thiếu index |
| `python scripts/package_production.py --check` | 0, 876 runtime files / 4942547 bytes; log `prompt1-font-final-package.log` |
| `python scripts/verify_secure_build_artifact.py` | 0 ở lượt đã ghi nhận |
| `npm.cmd run sbom` | 0; inventory Python trung gian có warning, output cuối bổ sung 13 root edges |
| `npm.cmd run audit:dependencies` | 0, không tìm thấy lỗ hổng ở thời điểm chạy |
| `npm.cmd run check:legal:production` | 1, giữ nguyên legal block |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite smoke -HostAddress 127.0.0.2 -Port 8010` | 0, 49 passed / 5 skipped; log `prompt1-smoke-route-final.log` |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite lifecycle -HostAddress 127.0.0.2 -Port 8010` | 0, run E2E-1788923825487, wrapper đo bộ nhớ gọi đầy đủ, không loader rút gọn |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite multi-assignee -HostAddress 127.0.0.2 -Port 8010` | 0, gồm hai tab dirty editor và cleanup |
| `$env:E2E_REVOCATION_TRANSPORT='polling'; powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite multi-assignee -HostAddress 127.0.0.2 -Port 8010` | 0; chặn 2 `db_changed`, polling hội tụ khoảng 24,1 giây, cả hai editor đóng; `prompt1-polling-revocation-final.log` |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite performance -HostAddress 127.0.0.2 -Port 8010` | 0, cold/warm p95 1325/236 ms, không ghi nhận long task; log `prompt1-font-uninstrumented-check.log` |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite first-tab-performance -HostAddress 127.0.0.2 -Port 8010` | 0 trên bản đo trước |

Gitleaks 8.30.1 đã quét 788 commit ở checkpoint lịch sử và quét lại diff cuối
qua stdin (exit 0). Mười tài liệu mới cùng các tệp nguồn/test mới được quét riêng
và không có leak. Quét toàn workspace không dùng làm gate vì đi vào 4,76 GB
runtime/log/`.env`; một finding trong `docs/ai/README.md` là ví dụ rỗng có sẵn,
không thuộc patch.
Các suite offline soak, pairwise, joint venture và auth-role đã có kết quả trong
nhật ký bàn giao. Full CI `34541273596` là bằng chứng từ xa chốt trên đúng SHA;
các số liệu cục bộ bên trên được giữ như lịch sử chẩn đoán và không bị trình bày
như thể tất cả được chạy lại trong cùng một lần.

Các lệnh workflow bổ sung đã chạy trên nguồn tích hợp hiện tại:

| Exact command | Kết quả / log trong data/logs |
| --- | --- |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite auth-shell -HostAddress 127.0.0.2 -Port 8010` | exit 0; prompt1-final-auth-shell.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite auth-roles -HostAddress 127.0.0.2 -Port 8010` | exit 0; prompt1-final-auth-roles.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite bidder-goods -HostAddress 127.0.0.2 -Port 8010` | exit 0; prompt1-final-bidder-goods.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite crud -HostAddress 127.0.0.2 -Port 8010` | lượt diagnostic exit 0; lượt exact-ack đủ kết quả/cleanup nhưng handle hết hạn; prompt1-crud-canonical-final.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite ui-quality -HostAddress 127.0.0.2 -Port 8010` | exit 0; prompt1-final-ui-quality.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite pairwise -HostAddress 127.0.0.2 -Port 8010` | exit 0; prompt1-final-pairwise.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite low-price -HostAddress 127.0.0.2 -Port 8010` | exit 0; prompt1-final-low-price.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite joint-venture -HostAddress 127.0.0.2 -Port 8010` | exit 0; prompt1-final-joint-venture.log |
| `python -m pytest -q -m browser_e2e tests/test_product_analytics_e2e.py` | exit 0, 1 passed, có cảnh báo teardown; ANALYTICS_E2E_HOST=127.0.0.2 và ANALYTICS_E2E_PORT=8010; prompt1-final-analytics.log |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_isolated_audit_e2e.ps1 -Suite websocket-missed-hint -HostAddress 127.0.0.2 -Port 8010` | exit 0, một hint bị bỏ nhưng polling hội tụ trong 29914 ms; prompt1-final-missed-hint.log |

## Legal Release Status

**BLOCKED — external legal facts missing**. Không tự approve hoặc publish production-public artifact.

## Remaining Risks

Smoke tích hợp cuối có năm skips: ba lượt procurement-plan-import thiếu cấu
hình provider fixture trong smoke mặc định và hai lượt touch chỉ dành Chromium.
Procurement đã chạy riêng đạt cả ba browser; contractor-violation chạy đạt ngay
trong smoke tích hợp. Không có browser project bị bỏ. Tám skips trong các báo
cáo trước là lịch sử, không phải số liệu hiện tại.

- Các finding CodeQL lịch sử đã được phân loại trong
  `prompt1-codeql-triage.md`; GitHub CodeQL hiện đã xanh trên source đã push.
- Từng có lỗi browser/input/transport gián đoạn; các lượt pass không xóa lịch sử lỗi.
- Hai nhóm fixture đã có kết quả riêng 3/3 trên ba browser; violation đã chạy
  trong smoke chung. Procurement vẫn cần cấu hình fixture nên có thể skip ở
  smoke mặc định; kết quả riêng là bằng chứng thực thi, không phải discovery.
- File prompt E2E do người dùng cung cấp vẫn được giữ ngoài commit; không phải
  source hoặc artifact phát hành.

## Diff Review Notes

Đã review theo patch group: access-policy locking; lineage existence; sync
rejection receipts; canonical-save callbacks; snapshot/revocation overlays;
scoped metadata/regrant; draft backup pruning; multi-tab tokens; lazy workflow
readiness; font preload; package/SBOM và legal release dependencies. `git diff
--check` đạt. Không phát hiện thay đổi masking, Word-entitlement-based read
filtering, role/module/capability semantics hoặc grant ngoài ADR 0038/0040/0041.

## Recommended Next Steps

1. Bổ sung/phê duyệt 27 dữ kiện pháp lý bên ngoài trước khi phát hành production.
2. Giữ lịch sử finding CodeQL và ResourceWarning analytics trong hồ sơ chẩn đoán;
   không dùng suppression hoặc thay đổi nghiệp vụ để làm xanh giả.
3. Theo dõi cold/warm startup p95 định kỳ; tối ưu thêm khi thực hiện mục tiêu
   hiệu năng kế tiếp đã được chủ sản phẩm duyệt.
