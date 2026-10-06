# Rà soát mã nguồn và GitHub CI — 06/10/2026

**Trạng thái: đang tổng hợp kiểm chứng cuối.** Báo cáo này ghi các lỗi đã xác nhận, các bản sửa đã thực hiện và bằng chứng hiện có. Những mục ghi **CHỜ ROOT** chưa có kết luận cuối; không được dùng báo cáo này để xác nhận toàn bộ CI đã xanh hoặc hệ thống đã sẵn sàng phát hành production.

## 1. Phạm vi và mốc nguồn

- Repository: `D:\Bidding`, remote `newstar94/Bidding`.
- HEAD và remote `main` được xác minh trong lượt rà soát: `d2e9dd637b473f45a9809f91a1f7d7b029fb4ba0`.
- Mốc GitHub được kiểm tra: các run của đúng SHA trên, tạo ngày 05/10/2026; các sửa đổi trong lượt này đang ở working tree, chưa commit/push và chưa chạy lại GitHub Actions.
- Đã đọc AGENTS.md/business contract, cấu hình Python/Node, manifest và lock dependencies, toàn bộ 5 workflow đã lưu trong Git, các script/gate liên quan; đối chiếu log GitHub thực với kết quả local.
- Kiểm tra tĩnh được áp dụng trên toàn bộ cây backend/scripts/tests và đồ thị frontend. Việc đọc sâu tập trung ở những seam phát hiện lỗi: lưu đánh giá chi tiết, sync/conflict retirement, hủy tác vụ workspace, điều hướng Admin, quota và vòng đời AI stream, tiền và JSON ở HTTP boundary, test harness và CI.
- Đây không phải bằng chứng rằng mọi dòng mã đã được đọc thủ công hoặc một đợt security source-to-sink độc lập đã hoàn tất. CodeQL/Supply-chain là các lớp kiểm tra đã có; kết quả của chúng được ghi riêng dưới đây.

### Inventory ban đầu từ Git tree của HEAD

| Khu vực | Số file tracked | Thành phần chính |
|---|---:|---|
| `backend/` | 376 | 363 Python, 10 module Node, 3 JSON |
| `frontend/` | 372 | 365 JavaScript, 7 CSS |
| `scripts/` | 120 | 49 Python, 63 MJS, 3 CJS, 3 PowerShell và 2 file khác |
| `tests/` | 629 | 274 Python, 325 MJS và 30 fixture/file khác |
| `.github/workflows/` | 5 | Full CI, CodeQL, N+1, Supply-chain, Startup performance |
| `views/` | 83 | HTML, CSS, thư viện/assets đã vendor |
| `shared/` | 3 | JSON schema/chính sách dùng chung |
| `deploy/` | 32 | Cấu hình, runbook và tài nguyên triển khai |

Toàn repository có **1.755 file tracked** tại mốc HEAD. Số này là inventory, không phải số file được sửa. Các regression mới thêm trong lượt này chưa nằm trong Git tree ban đầu.

## 2. GitHub CI tại đúng SHA

| Workflow | Run | Kết quả đã xác minh |
|---|---|---|
| Full CI | [37299139126](https://github.com/newstar94/Bidding/actions/runs/37299139126) | **Failure** |
| Supply-chain security | [37299139339](https://github.com/newstar94/Bidding/actions/runs/37299139339) | **Success**; dependency-review không áp dụng cho event push |
| CodeQL | [37299139159](https://github.com/newstar94/Bidding/actions/runs/37299139159) | **Success** cho Python và JavaScript/TypeScript |
| N+1 query regressions | [37299139102](https://github.com/newstar94/Bidding/actions/runs/37299139102) | **Success** |
| Startup performance gate riêng | [34709051916](https://github.com/newstar94/Bidding/actions/runs/34709051916) | Lần gần nhất **Success** tại SHA cũ `f8a529bb2b930b919f1077f61669a5a792aec049` ngày 13/09/2026 theo giờ Việt Nam; **không xác nhận HEAD hiện tại** |

### Chi tiết Full CI thất bại

| Job | Kết quả | Bằng chứng/nguyên nhân |
|---|---|---|
| Quality and static contracts | Success | Các static contract của mốc GitHub đạt |
| PostgreSQL schema and FK audit | Success | Job database của mốc GitHub đạt |
| Secure production build | Failure | ESLint tại `frontend/packages/DetailedEvaluationSaveWorkflow.js:224`: complexity **101**, giới hạn **80** |
| Python unit and integration coverage | Failure | Dừng tại bước build frontend cùng lỗi complexity, **chưa chạy pytest** |
| JavaScript unit coverage | Failure | Critical branch coverage của `frontend/app/BiddingModel.js` **63,15% < 65%**; không hạ ngưỡng |
| Cross-browser and workflow E2E | Skipped | Dependency `build` thất bại; **không có bằng chứng E2E đạt ở SHA này** |
| Startup performance budget | Skipped | Dependency `build` thất bại |
| Package and dependency gates | Skipped | Dependency `build` thất bại |
| Publish verified production artifact | Skipped | Event push không phải workflow_dispatch; không phát hành |

Log chi tiết được tải read-only qua GitHub API bằng credential helper hiện có; credential không được in ra. Thư mục log máy kiểm tra: `%TEMP%\biddingflow-ci-audit-20261006` (`111727417490.log`, `111727417487.log`, `111727417227.log`).

## 3. Lỗi đã sửa và phạm vi thay đổi

| Khu vực | Lỗi/bằng chứng | Bản sửa và giới hạn |
|---|---|---|
| Lưu đánh giá chi tiết | Hàm vượt complexity gate; candidate có thể cập nhật model trước khi validation điểm kỹ thuật từ chối hoàn thành | Tách các bước kiểm tra, invalidation và completion; chuẩn bị candidate ngoài live model rồi mới publish/stage sau khi validation đạt. Bảo toàn cách tính điểm, trình tự nhóm, điều kiện hoàn thành và canonical commit |
| Coverage BiddingModel | GitHub thiếu branch coverage tại conflict retirement | Bổ sung regression cho patch/delete, base snapshots, receipt persistence failure/retry, cache adapter và đổi workspace. Không sửa business contract hoặc ngưỡng coverage để hợp thức hóa |
| Workspace task scheduler | Hủy scope sau khi dành lane nhưng trước microtask vẫn có thể gọi callback của workspace cũ | Kiểm tra AbortSignal ngay trước dispatch; giữ bounded concurrency và rejected cancellation |
| Điều hướng Admin plans | Import hoàn thành sau khi rời route có thể bắt đầu request của route đã lỗi thời | Dùng cùng loader có signal/route lifetime như các Admin route khác; không đổi server authorization hoặc dữ liệu được phép xem |
| AI stream/quota | Đóng stream sau event đầu, hủy khi reservation đang commit hoặc hủy transport có thể để reservation/tác vụ chưa cleanup | Đưa các yield vào phạm vi finally; giữ reservation handle khi write đã được submit, hoàn tất cleanup dưới repeated cancellation, dừng pending next-event trước aclose và luôn hoàn trả metric active stream |
| Tiền ở HTTP boundary | Chuỗi số dạng exponent rất lớn bị chuyển thành integer trước khi kiểm tra miền int64 | So sánh Decimal với miền đã có trước int(); giữ nguyên miền hợp lệ **0..9.223.372.036.854.775.807** và giá trị trả về |
| Đọc JSON | Python giới hạn chữ số integer có thể ném ValueError ra ngoài validator | Trả cùng `REQUEST_JSON_INVALID`/HTTP 400 cho lỗi decode/UTF-8/integer digit limit; JSON object hợp lệ giữ nguyên |
| Dependency build | npm audit local xác nhận source-map-js 1.2.1 mắc [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | Nâng có giới hạn lên **1.2.2**, cập nhật lock và expectation version tương ứng; audit full/dev và production đều được giữ |
| Transcript JS coverage | Log GitHub bị cắt giữa dòng trước summary/coverage table do ghi stdout lớn rồi process.exit(1) | Dùng exitCode và return để Node flush output trước thoát, bảo toàn exit code/gate. Reproducer với bộ ghi stdout bất đồng bộ: trước sửa **0 byte**, sau sửa **1.049.258 byte**, cả hai exit 1 đúng gate |
| CI PostgreSQL opt-in | LOT_SCOPE_TEST_DATABASE_URL và WEBHOOK_TEST_DATABASE_URL không được cấu hình, khiến **21 case PostgreSQL** bị skip dù CI có database | Bind rõ hai URL vào unit database cô lập đã có. Regression workflow bảo vệ binding. Hai module kiểm thử chạy **42 passed, 0 skipped** trên PostgreSQL scratch |
| Browser test harness | Fixture Admin còn kỳ vọng hai tính năng đã được loại khỏi contract hiện hành; thao tác trực tiếp trên input checkbox được ẩn không giống thao tác của người dùng | Đồng bộ fixture với API hiện hành và vẫn assert tính năng đã loại không xuất hiện; click label hiển thị và assert checkbox đã chọn. Hai case đã được frontend kiểm tra trước/sau sửa; ma trận browser cuối vẫn chờ root |
| Auth-role E2E harness | Chromium có thể giải phóng body Response trước lúc đọc trong journey tìm kiếm chuyên gia | Capture raw upstream bytes qua route.fetch rồi fulfill nguyên response cho trang; kiểm tra status và payload thực, giữ kiểm tra XSS/authorization. Chặn service worker chỉ trong context harness để interception không bị bypass |

Các đường dẫn production chính đã thay đổi: `backend/ai/routes.py`, `backend/ai/service.py`, `backend/shared/async_io.py`, `backend/shared/numeric_utils.py`, `backend/shared/request_validation.py`, `frontend/packages/DetailedEvaluationSaveWorkflow.js`, `frontend/shared/WorkspaceTaskScheduler.js`, `frontend/admin-platform/AdminApp.js`. Phần tooling nằm ở `.github/workflows/ci.yml`, `scripts/run_js_coverage.mjs`, `package.json` và `package-lock.json`; các regression liên quan được thêm/sửa tại `tests/`.

## 4. Contract bắt buộc được bảo toàn

- Không thêm/bỏ masking, redaction, ẩn trường hoặc lọc response đối với dữ liệu mà người dùng đã được phép xem.
- Không thêm/bỏ/đổi semantics role, module permission, tenant/record/assignment scope, capability, entitlement hoặc default allow/deny.
- Người có quyền đọc bản ghi vẫn được xem đầy đủ CCCD, tài khoản ngân hàng, chữ ký, con dấu và dữ liệu liên quan của bản ghi đó.
- Entitlement xuất Word tiếp tục chỉ kiểm soát thao tác tạo/tải Word; không dùng để quyết định visibility trong API/màn hình đọc.
- Tenant isolation, session checks, server authorization, assignment scope, record-level checks và audit được giữ.
- Lưu thành công cuối vẫn phụ thuộc authoritative result; rejected mutation không được biến thành thành công hoặc tự replay draft.
- Không sửa migration/schema, `.env` hoặc database thật; không nâng timeout, thêm skip/retry để che lỗi, hạ coverage/quality gate hoặc bỏ dependency audit.
- Chưa commit, push, dispatch workflow, merge hoặc publish production trong lượt này.

Independent diff review đã đọc các bản sửa production/tooling/regression hiện có; chưa phát hiện regression có bằng chứng hoặc thay đổi quyền/visibility. Kết luận này cần được đối chiếu với lượt kiểm chứng cuối của root, không thay thế E2E toàn bộ.

## 5. Bằng chứng local đã ổn định

Các kết quả dưới đây là những lượt có log và exit receipt. Nếu có bản sửa mới sau lượt đó, root cần xác nhận lại tính tương ứng trước khi chốt báo cáo.

| Gate | Kết quả | Bằng chứng |
|---|---|---|
| Static toàn cây | **Exit 0**, 365 frontend modules, 0 static import cycles, không orphan/unresolved module | `release/audit-20261006-static-stable.log`, `.exit` |
| Secure frontend build | **Exit 0**, verification 172 obfuscated bundles và private symbolication; route CSS gate đạt | `release/audit-20261006-build-stable.log`, `.exit` |
| Dependency audits | **Exit 0**, npm full **0**, npm production **0**, pip runtime **0** known vulnerabilities tại thời điểm kiểm tra | `release/audit-20261006-dependencies-final.log`, `.exit` |
| Production SBOM | **Exit 0**, tạo CycloneDX cho npm/runtime/vendor và Python | `release/audit-20261006-sbom.log`, `.receipt.json` (7,96 giây) |
| Fresh database initialization | **Exit 0** cho runtime/unit/API; target schema **99** | `release/audit-20261006-initialize-*.receipt.json` |
| FK/index audit | **190 foreign keys**, **0 missing indexes**, exit 0 | `release/audit-20261006-fk-indexes.log`, `.receipt.json` |
| Migration rehearsal | **Exit 0**, dry-run đến schema 99 và rollback thành công | `release/audit-20261006-migration-dry-run.log`, `.receipt.json` |
| Package validation + extracted runtime smoke | **Exit 0**, **862 runtime files**, **5.222.659 bytes** | `release/audit-20261006-production-package.log`, `.receipt.json` |
| CI contract/pins/coverage unit | **18 passed** | Focused `tests/test_ci_supply_chain_pins.py`, `tests/test_test_dependencies.py`, `tests/test_critical_coverage_gate.py` |
| Lot scope + webhook PostgreSQL | **42 passed**, không skip | Focused `tests/test_lot_parent_scope.py`, `tests/test_payment_webhook_ingress.py` với các opt-in URL trỏ cluster scratch |
| JS diagnostic/coverage parser regression | **3 passed** | Focused `tests/js/js_coverage_diagnostics.test.mjs`, `tests/js/js_critical_coverage_gate.test.mjs` |
| AI quota/transport cancellation regression | **6 passed** | Focused `tests/ai/test_stream_quota_cleanup.py` |

Package dùng `--check`: ZIP chỉ là file tạm để kiểm tra và đã bị xóa sau kiểm chứng. **Không có ZIP production mới được bàn giao từ lượt này**, và package gate đạt không chứng minh production publication readiness.

Local PostgreSQL dùng cluster scratch riêng trên `127.0.0.1:55439` và các database audit; ứng dụng E2E dùng port/database riêng theo harness. Không dùng kết quả của server/database cũ để suy ra kết quả của working tree này.

## 6. Ma trận kiểm chứng local và GitHub

| Hạng mục | Trạng thái cuối | Số lượng/kết quả cần điền |
|---|---|---|
| Python toàn bộ + line/branch coverage + 16 critical modules | **Đạt local** | **3.009 passed, 2 skipped** (hai symlink bị giới hạn host), coverage **66,87%**, critical ratchet **16/16**; `release/audit-20261006-python-final.receipt.json` |
| JavaScript toàn bộ + global/14 critical coverage modules | **Đạt local** | **2.300 passed, 0 failed/skipped**, `BiddingModel.js` branch **67,47%**, critical ratchet **14/14**; `release/audit-20261006-js-final.receipt.json` |
| Playwright Chromium/Firefox/WebKit | **Lượt full local chưa đạt** | Lượt `audit-20261006-e2e-final` exit 1 sau **960,25 giây**; lỗi còn lại tập trung startup/scope và fixture Word export. Các case filter/admin đã có focused green với startup `RECONCILED`; cần đọc lại run GitHub đúng SHA |
| Role và nghiệp vụ E2E/lifecycle/offline sync | **Một phần đạt** | Auth roles, offline, multi-assignee đã đạt trong workflow cô lập; JV primary vẫn lỗi ở Word export snapshot; receipt `release/audit-20261006-workflow-joint-venture-primary.receipt.json` exit 1 |
| Startup/platform performance budgets | **Đạt local một phần** | Package/platform gates ổn định; GitHub Startup performance run **37414289509** đã `success`; không suy ra production latency |
| Static/build tương ứng diff cuối | **Đạt local** | Secure build sau `SyncPushService` fix exit 0; `git diff --check` đạt; package/SBOM receipts nêu trên |
| GitHub Actions của bản sửa | **Đang chạy trên đúng SHA** | `911986ccba46e6acfc4892c78d1d6f27a398f6b4`, Full CI run **37414289509**; quality/build/database/package/performance đã success, Python/JS/E2E còn in progress tại thời điểm ghi mục này |

## 7. Giới hạn và việc còn lại

1. Python lượt đầu bị kết thúc khi chưa hoàn thành, receipt `4294967295`; lượt cuối đã đạt **3.009/2 skipped**. Hai skip là giới hạn symlink của Windows, không phải skip nghiệp vụ CI.
2. Full local browser run vẫn có lỗi; focused admin/filter đã xác minh readiness boundary, còn startup/fixture failures phải được phân loại riêng, không hạ assertion hay thêm retry.
3. JV primary đã xác nhận toàn bộ chuẩn bị dữ liệu và các export Excel; Word export vẫn dừng trước download. Bản sửa startup barrier có unit regression 15/15 liên quan nhưng chưa đủ bằng chứng để tuyên bố JV Word E2E đã xanh.
4. Bản sửa đã được commit/push ngoài kế hoạch ban đầu trong quá trình chạy tác vụ: HEAD/`origin/main` hiện là `911986ccba46e6acfc4892c78d1d6f27a398f6b4`; GitHub đã khởi chạy run **37414289509**. Không thực hiện thêm commit/push/dispatch thủ công.
5. Supply-chain/CodeQL của SHA cũ và kết quả mới phải được đọc theo đúng SHA; chúng không thay thế security audit source-to-sink độc lập hoặc bằng chứng production.
6. Không có Linux/systemd, staging credentials/providers, backup/restore, rollback, deploy hoặc production publication proof. Không suy ra release-ready từ lint/build/package/performance.
