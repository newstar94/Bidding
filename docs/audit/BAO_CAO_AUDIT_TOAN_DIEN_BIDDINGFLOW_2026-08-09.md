# BÁO CÁO AUDIT TOÀN DIỆN BIDDINGFLOW

Ngày audit: 2026-08-09
Nhánh: `main`
Audit SHA: `47629c307b1ab6289918eb638fdddf09488a7639`
`origin/main`: `47629c307b1ab6289918eb638fdddf09488a7639`
Phạm vi: toàn repository, PostgreSQL local/dev read-only, build/test/E2E trên môi trường cô lập.
Chế độ: **chỉ audit; không sửa production code, schema, API hay dữ liệu**.

## Phạm vi, phương pháp và giới hạn bằng chứng

Trước audit đã chạy `git fetch`; `main`, `origin/main` và mốc audit trùng tuyệt đối. Các kết luận dưới đây chỉ áp dụng cho SHA nêu trên. Worktree trước khi tạo báo cáo chỉ có file prompt untracked của người dùng.

Audit kết hợp đọc code, static import/runtime registry/route/action scan, deterministic deferred-promise repro, unit/integration tests, secure build, dependency/vendor checks, browser E2E, catalog PostgreSQL và truy vấn integrity/`EXPLAIN` read-only. Không dùng grep đơn lẻ để kết luận dead code; mọi candidate đã được đối chiếu dynamic import, prototype registry, DOM action, test, worker URL, backend router, database registry và bundle metadata khi phù hợp.

Giới hạn quan trọng:

- Không có production telemetry, production cardinality hoặc production query statistics; finding về scale được giữ là `RISK` nếu chỉ có plan/code proof.
- Không mutate `biddingflow_dev`. E2E dùng `TEST_DATABASE_URL` riêng; dữ liệu local/dev chỉ được truy vấn read-only. Số hàng fixture là ảnh chụp tại thời điểm audit và có thể thay đổi.
- Các race P0 frontend có deterministic deferred fetch/IndexedDB repro; các race quota/last-manager/package-document backend mới có code-path proof nên không nâng thành confirmed bug.
- External API consumers không thể được chứng minh từ repository; endpoint không thấy frontend caller chỉ ghi `POSSIBLY UNUSED`.
- Không dùng nội dung `dist/` cũ làm bằng chứng cho SHA. Build current-SHA được chạy mới; coverage current-SHA được tạo mới trong phiên audit.

---

# 1. Executive Summary

## 1.1. Kết luận sức khỏe tổng thể

BiddingFlow có nền tảng tốt ở transaction generic sync, aggregate versioning, restore tombstone, schema/FK/index baseline, document hardening và test breadth. Tuy nhiên ứng dụng **chưa sẵn sàng phát hành** vì có ba P0 trực tiếp liên quan tenant isolation/RBAC, nhiều race P1 có thể làm sai hoặc mất dữ liệu, cùng một legal gate đang chủ động chặn production package.

Rủi ro lớn nhất không nằm ở CRUD thông thường mà ở ranh giới bất đồng bộ: workspace đổi trong khi fetch/mutation đang chạy; role session được tái dùng qua workspace; pull chồng lấn; local state/outbox/IndexedDB không cùng một lease. Đây là các seam xuyên tầng và không được bao phủ bởi test hiện tại.

## 1.2. Số liệu finding

| Chỉ số | Kết quả |
|---|---:|
| P0 | **3** |
| P1 | **14** |
| P2 | **31** |
| P3 | **9** |
| Tổng active findings | **57** |
| Confirmed product correctness/security bugs | **9** |
| Finding được giữ rõ là risk/debt/issue, không gọi là bug | **48** |
| Dead-code groups đã xác nhận | **3** |
| Whole module/file đã xác nhận dead | **0** |
| Possibly-unused script groups | **2** |
| Active DB/schema findings | **8** |
| Material test gaps | **12** |
| Direct application-security findings | **5** |
| Supply-chain/deployment-security findings bổ sung | **4** |

`Confirmed product bugs` gồm: ba P0; pull ghi đè pending edit; overlapping pull regress state/cursor; direct model mutation thiếu atomicity; Word access controls không có hiệu lực; stale delete thắng update mới; personal workspace mất cả WebSocket lẫn polling. Release/tooling/UI defects đã xác nhận được phân loại riêng, không làm tăng số bug sản phẩm.

## 1.3. Top findings

1. **BF-P0-01:** response tenant A có thể hydrate state và IndexedDB tenant B sau workspace switch.
2. **BF-P0-02:** mutation bắt đầu ở A có thể stage outbox hoặc tiếp tục delete trong DB tenant B.
3. **BF-P0-03:** `active_role` toàn session cho phép manager A dùng quyền manager khi AI đọc workspace B nơi họ chỉ là employee.
4. **BF-P1-01/BF-P1-02:** pull có thể ghi đè pending edit và response cũ có thể lùi cả state lẫn cursor.
5. **BF-P1-09:** stale delete không khóa/compare-and-delete nên có thể xóa update mới commit.
6. **BF-P1-08:** checkbox hạn chế dữ liệu Word được lưu nhưng runtime luôn trả `allow_all()`.
7. **BF-P1-14:** personal workspace bị server đóng WebSocket 4003, trong khi client đã dừng polling và không bật lại.
8. **BF-P1-06/BF-P1-07:** artifact thiếu operational tools và legal gate 27/27 đang chặn production package.

## 1.4. Điểm tích cực cần giữ nguyên

- PostgreSQL 17.10, schema v42: đủ 79/79 bảng, 104 FK, 379 index; không có invalid constraint/index; FK index audit 104/104.
- Không thấy duplicate latest, broken active lineage, owner-type mismatch hoặc các invariant award/opening/lot/JV đang sai trong snapshot read-only.
- Generic sync update dùng atomic row-version predicate; aggregate version chạy `SERIALIZABLE`, lock repository và có idempotency; restore tombstone dùng `FOR UPDATE` + idempotency.
- 633/633 Python tests và 522/522 JavaScript tests pass; module graph 258 module, 0 static cycle; security/encoding/vendor/debt gates pass.
- Secure build thành công với 262 module và 46 obfuscated chunks.
- Path traversal, OOXML/archive validation, document sandbox và allowlisted dynamic SQL nhìn chung được harden; không có bằng chứng để gọi 128 Bandit S608 là SQL injection.

---

## 1.5. Bảng tổng findings

| ID | Severity | Type | Area | File/Symbol | Evidence | Impact | Confidence | Recommendation |
|---|---|---|---|---|---|---|---|---|
| BF-P0-01 | P0 | CONFIRMED BUG / TENANT ISOLATION | Frontend async reads | `tableDataUtils.js:78-184`; `BiddingModel.js:193-213` | Deferred A response sau switch B ghi được record A vào state và IndexedDB B | Cross-tenant durable leakage | HIGH | Workspace lease + captured DB + abort/reset requests; deferred A→B regression tests |
| BF-P0-02 | P0 | CONFIRMED BUG / DATA INTEGRITY | Frontend mutation | `BiddingModel.js:676-731`; `MutationService.js:21-84`; `BiddingController.js:441-498` | Deferred A IDB completion stages A record vào outbox B; multi-await delete chạy trên DB B | Cross-tenant upload/delete/corruption | HIGH | Capture token/DB/outbox, post-await validation, wait/abort in-flight mutations |
| BF-P0-03 | P0 | CONFIRMED BUG / SECURITY | AI RBAC | `auth_routes.py:647-677`; `auth_helper.py:192-226`; `permission_context.py:33-73` | Manager A chọn role manager, đổi active org sang B nơi là employee; AI scope vẫn manager | Đọc toàn bộ tenant B ngoài assignment | HIGH | Derive effective role theo membership của current org; bind role selection với org |
| BF-P1-01 | P1 | CONFIRMED BUG | Pull/outbox merge | `syncMergeUtils.js:7-18,86-143`; `WorkspaceMutationOutbox.js:244-261` | Incoming stale row apply trước khi đọc pending IDs; edit tiếp theo queue server-stale fields | Mất pending local edit | HIGH | Snapshot/overlay pending mutations trước merge; delta/full regression |
| BF-P1-02 | P1 | CONFIRMED BUG / RACE | Pull ordering | `SyncPullService.js:133-276` | Version 2 resolve trước, version 1 resolve sau; final state/cursor lùi về 1 | Sync state/cursor regression | HIGH | Per-workspace single-flight hoặc request generation commit guard |
| BF-P1-03 | P1 | CONFIRMED BUG | Local persistence | `entityStore.js:1-9`; `BiddingModel.js:701-731` | Inject IDB failure: state đổi, outbox null; fire-and-forget caller có rejection | Edit biến mất/revert sau reload | HIGH | Route qua `WorkspaceDataStore` hoặc rollback/checkpoint atomically |
| BF-P1-04 | P1 | DATA INTEGRITY RISK | Dual outbox | `WorkspaceMutationOutboxStore.js:63-125` | localStorage throw chặn IDB fallback; cả read failures/corruption bị map thành queue rỗng | Pull có thể ghi đè edit chưa sync | HIGH | Degraded state, durable-backend quorum/recovery, fail closed trước authoritative pull |
| BF-P1-05 | P1 | CORRECTNESS RISK | Contractor versioning | `bidProcessOpeningData.js:67-180,330-359`; `BidProcessWorkflow.js:947-995` | Lookup enrich mutates date-effective contractor record rồi sync | Lịch sử nhà thầu bị sửa ngược | HIGH | Tạo version mới hoặc lưu enrichment trên bid snapshot |
| BF-P1-06 | P1 | BUILD/DEPLOY DEFECT | Production package | `package_production.py:27-50`; `deploy/README.md:97,105,132` | `collect_runtime_files()` có README nhưng thiếu scripts/runbook được README gọi | Operator không chạy được preflight/recovery | HIGH | Include operational assets hoặc package-specific runbook; path-contract test |
| BF-P1-07 | P1 | INTENTIONAL RELEASE BLOCKER | Legal/CI | `package.json:21`; `ci.yml:145`; `legal-fact-sheet.md:16-42` | `LEGAL_FACT_UNAPPROVED=27`, `LEGAL_PLACEHOLDER_PRESENT=27` | Full CI không tạo/upload production archive | HIGH | Hoàn thiện/phê duyệt fact sheet; không bypass gate |
| BF-P1-08 | P1 | CONFIRMED BUG / SECURITY | Word access policy | `access_policy.py:193-209`; `routes_docx.py:486-567`; `modal_detail_system_user.html:96-107`; `admin_user_routes.py:439-454` | DB lưu `0/0/0` nhưng effective policy luôn true/`allow_all()` | UI hứa hạn chế nhưng export vẫn đọc tất cả | HIGH | Quyết định product contract: restore deny gates hoặc retire UI/schema coherently |
| BF-P1-09 | P1 | CONFIRMED BUG / RACE | Delete concurrency | `deletion_service.py:178-182,237-239,314-343`; `delete_policy.py:245-252` | Prefetch không lock; final delete/archive thiếu `row_version` predicate | Stale delete thắng update mới | HIGH | `FOR UPDATE` hoặc compare-and-delete + `rowcount`; two-connection barrier test |
| BF-P1-10 | P1 | CONCURRENCY RISK | Member quota | `org_routes.py:515-575` | Subscription/count không lock trước hai insert/reactivate | Vượt quota nhân sự | HIGH | Lock org/subscription + recount trong transaction |
| BF-P1-11 | P1 | CONCURRENCY RISK | Last manager | `org_routes.py:709-725,859-863`; `auth_routes.py:1672-1686` | Hai manager đồng thời có thể cùng thấy manager còn lại | Tổ chức mất manager cuối | HIGH | Serialize membership mutations trên org row |
| BF-P1-12 | P1 | CONCURRENCY RISK | Last super-admin | `admin_user_routes.py:525-548,621` | Count super-admin không lock trước delete | Platform mất super-admin cuối | HIGH | Shared advisory/role lock + concurrent integration test |
| BF-P1-13 | P1 | CONCURRENCY RISK | Package documents | `package_document_routes.py:417-475,745-788`; `package_document_service.py:69-80` | Workflow step check là SELECT thường, write xảy ra sau | Upload/delete trái lifecycle | HIGH | Lock package/batch hoặc expected package row version |
| BF-P1-14 | P1 | CONFIRMED BUG | Personal realtime sync | `websocket.py:261-281,373-375`; `WebSocketSyncClient.js:9,61-91,124-138` | Backend đóng 4003; client đã stop polling và không restart vì close non-retryable | Multi-tab personal workspace stale | HIGH | Hỗ trợ personal scope hoặc luôn khôi phục polling khi WS không usable |
| BF-P2-01 | P2 | CONFIRMED DATA-FIDELITY DEFECT | Generated schema | `schema.py:668,706`; `schemaRuntime.js`; `generate_schema_runtime.py:49-57`; `outboundSerializer.js:94-140`; `bidProcessTenderLifecycle.js:221-225,283-284` | Generated output lệch 896 chars; canonical fields bị unknown/drop | Field appraisal có thể reload về default; legacy text fallback thường giữ visible timeline nên chưa chứng minh P1 failure mọi path | HIGH | Generate-and-diff CI + serializer contract tests |
| BF-P2-02 | P2 | CONFIRMED CACHE DEFECT | Bootstrap assets | `http_middleware.py:219-223`; `index.html:22,90` | `?v=2.0` được cache 1 năm immutable dù file đổi sau lần bump | Returning client chạy bootstrap cũ | HIGH | Content hash URL và build assertion |
| BF-P2-03 | P2 | CORRECTNESS/COMPAT RISK | Contractor selection | `contractorVersionBinding.js:43-62` | Không có effective version thì chọn oldest future version | Dùng dữ liệu chưa có hiệu lực | HIGH | Explicit no-match policy; test date trước first effective |
| BF-P2-04 | P2 | MEMORY/PRIVACY RISK | JV render cache | `jvDataStore.js:1-8`; `runtimeState.js:1-12` | Process-global unbounded maps chứa tax/name/member, không scope/clear | Retained/stale cross-workspace data | HIGH | Scope workspace/render lifecycle và dispose |
| BF-P2-05 | P2 | UX/ACCESSIBILITY ISSUE | Custom select | `view_helpers.js:109-287`; `PartnerHelpers.js:305-467` | Native control hidden; div/list click-only, thiếu combobox/listbox/keyboard/ARIA | Keyboard/screen-reader không thao tác được | HIGH | Dùng `accessibleCombobox.js`; keyboard/AT tests |
| BF-P2-06 | P2 | CONFIRMED ACCESSIBILITY ISSUE | Package detail 320px | `views/css/components.css:1521-1532,1677-1696`; `.disabled > .custom-select-trigger > span` | Authenticated axe matrix đo contrast 3.86:1, yêu cầu 4.5:1 | Text disabled khó đọc | HIGH | Token màu đạt 4.5:1 + visual/axe regression |
| BF-P2-07 | P2 | DUPLICATED LOGIC / RISK | Lot JSON parsing | `bidEvaluationLowPriceRules.js:6-15`; `lotEvaluationScope.js:9-18`; `AwardResultApprovalWorkflow.js:34-43`; xem §9 | Cùng corrupt JSON trả `[]` ở nơi này nhưng throw ở nơi khác | Workflow legacy xử lý không nhất quán | HIGH | Canonical strict/display parser |
| BF-P2-08 | P2 | ARCHITECTURAL DEBT | Latest/root resolver | `BiddingModel.js:933-1167` + component resolvers | Plan/package/single getters dùng tie-break khác nhau | Dễ chọn version khác nhau theo màn hình | HIGH | Canonical resolver contract + invariant tests trước refactor |
| BF-P2-09 | P2 | PERFORMANCE/BUILD DEBT | CSS/bundle | `views/css/app.css:1-14` | Eager import toàn route CSS; CSS 378,372 B raw | Tăng initial/workspace transfer/parse | HIGH | Incremental route CSS split có visual/perf gate |
| BF-P2-10 | P2 | PERFORMANCE ISSUE | Startup | `data/logs/startup-performance.json` | 30+30 runs: cold p95 539 ms, warm 150 ms; longest 145 ms > 100 ms | Main-thread hitch; overall timing vẫn trong budget | HIGH | Long-task attribution + profile exact task; không đoán refactor |
| BF-P2-11 | P2 | TEST FLAKINESS | Offline E2E | `verify_offline_sync_e2e.mjs:157-171` | Một run nhận `local-pending`, hai fresh reruns pass; fixed 250 ms handoff | CI không ổn định, có thể che race | HIGH | Wait theo state/network barrier; repeat/soak gate |
| BF-P2-12 | P2 | TEST DEBT | E2E harness | `verify_full_lifecycle.mjs:652`; `verify_offline_sync_e2e.mjs:89,159,206`; `verify_joint_venture_e2e.mjs:262,271,292,924` | 29 waits, 4 DOM `.click()`, 84 date/year literals | Flake/clock drift risk | MEDIUM | Locator/state waits + relative clock fixture |
| BF-P2-13 | P2 | TEST GAP | Coverage gates | `package.json:7`; `check_critical_coverage.py:13-27` | Global backend floor 28%, no JS coverage; critical floors rất thấp | High-risk regressions vẫn pass | HIGH | Risk-based line/branch floors + JS coverage |
| BF-P2-14 | P2 | TEST GAP | Cross-browser Playwright | `playwright.config.mjs:28-31`; `ci.yml:60,124-134` | Config 3 browsers; CI cài/chạy Chromium custom scripts; canonical spec skip | Firefox/WebKit không được enforce | HIGH | Canonical runner + real fixtures/browser matrix hoặc docs trung thực |
| BF-P2-15 | P2 | DEPENDENCY DEBT | Full npm lock | `package-lock.json:3121-3123`; `package.json:14` | Full audit: HIGH `nanoid@3.3.16`; prod-only audit pass | Build-chain supply-chain exposure | HIGH | Upgrade lock; full-lock scheduled audit |
| BF-P2-16 | P2 | REPRODUCIBILITY DEBT | Python CI | `requirements.txt`; `ci.yml:58` | Hashed lock được ship nhưng CI cài editable và tự resolve transitives | Test env có thể khác deploy | HIGH | `--require-hashes`, then project `--no-deps` |
| BF-P2-17 | P2 | SBOM GAP | Vendored assets | `generate_sbom.py:47-70`; `vendor-manifest.json` | SBOM bỏ Flatpickr/Lucide/SheetJS/fonts được package | Inventory/license/CVE response thiếu | HIGH | Merge vendor manifest/hash/version/license vào CycloneDX |
| BF-P2-18 | P2 | OBSERVABILITY GAP | Obfuscated client | `vite.config.js:78-83,149`; `releaseDiagnostics.js:25-31` | Không source map/private mapping; chỉ release/name/hash/line/column | Không symbolicate incident đáng tin cậy | HIGH | Private map archive theo immutable release + smoke symbolication |
| BF-P2-19 | P2 | RELEASE DEBT | Release ID | `vite.config.js:121-134`; `package_production.py:176-184` | Local secure artifact `releaseId=development` vẫn validate | Telemetry/backend correlation sai | HIGH | Production package bắt buộc immutable release ID |
| BF-P2-20 | P2 | OBSERVABILITY/QUALITY DEBT | Swallowed/caught errors | `check_python_quality.py:14-19,44`; `releaseDiagnostics.js:176` | Ratchet BLE001=118/S608=128; frontend 239 catches; caught critical failures không vào global handler | Operational failures thiếu context/metric | MEDIUM | Module ratchet + structured redacted telemetry at critical boundaries |
| BF-P2-21 | P2 | SUPPLY-CHAIN RISK | CI refs | `.github/workflows/ci.yml`; `.github/workflows/security.yml`; action major tags + `postgres:17` | Tags/image refs mutable | Build có thể đổi ngoài repo review | HIGH | Pin commit SHA/digest + reviewed automation |
| BF-P2-22 | P2 | DATABASE ASSURANCE GAP | Schema contract | `postgres_schema.py:960-1068` | Chỉ exact table/column names + subset FK/index names; bỏ definitions/types/default/check/unique/trigger/extra | Dangerous drift có thể pass startup | HIGH | Normalized catalog contract + negative drift tests |
| BF-P2-23 | P2 | MIGRATION RISK | Upgrade v36 | `backend/db/upgrades.py:1239-1343` | Load/normalize/update toàn lot/opening rows trong Python rồi create unique index trong một transaction | O(N) memory, long lock/transaction | HIGH | Giữ history; preflight/cardinality/dry-run/runbook, không rewrite migration |
| BF-P2-24 | P2 | DATABASE DEBT | `sync_metadata` invariants | `backend/db/schema.py:1465-1470`; live catalog | Thiếu `current_version >= 0` và `min_available_version <= current_version`; live rows hợp lệ | Corrupt sync cursor có thể được lưu | HIGH | Add validated CHECK migration sau data preflight |
| BF-P2-25 | P2 | IDEMPOTENCY RISK | Lot finalize | `lot_lifecycle_routes.py:178-246`; `lot_lifecycle_service.py:410-444,572-592` | Version check trước closed-state; retry sau lost response trả conflict | Client không replay-safe | HIGH | Idempotency key + request digest/result replay |
| BF-P2-26 | P2 | REALTIME CONSISTENCY RISK | WS outbox | `websocket.py:596-612` | Broadcaster nuốt durable enqueue error, fallback local, luôn true; thường gọi after business commit | Multi-replica client stale | HIGH | Canonical transactional event enqueue/outbox |
| BF-P2-27 | P2 | DEPLOYMENT SECURITY RISK | AI provider URL | `ai/configuration.py:115-152`; `providers/base.py:47-85`; `legal_search.py:315` | Deployment config cho arbitrary base URL/redirect/proxy path | Có thể gửi tenant data/API key sai host | MEDIUM | Allowlisted HTTPS hosts, redirect/proxy policy, startup validation |
| BF-P2-28 | P2 | PERFORMANCE RISK | Retention queries | `lifecycle.py:97-153`; `postgres_schema.py:548-552` | Global cutoff filter nhưng indexes dẫn bằng organization; read-only EXPLAIN Seq Scan | Cleanup chậm/lock khi dữ liệu lớn | HIGH | Cutoff-first/partial indexes + batched cleanup + realistic plan tests |
| BF-P2-29 | P2 | MIGRATION TEST GAP | PostgreSQL upgrades | `ci.yml:67-71`; `postgres_schema.py:1082-1168`; `upgrades.py:1907-1937` | CI chỉ fresh final schema; không chạy real v1/vN→v42 chain | Historical install upgrade có thể regress | HIGH | Real PostgreSQL baseline fixtures + final catalog/data assertions |
| BF-P2-30 | P2 | PRIVACY/RETENTION RISK | Account deletion | `admin_user_routes.py:570-621`; `deleted_records.record_snapshot_json` | Blocker/count không bao quát snapshot cá nhân; tombstone không FK user | Dữ liệu cá nhân có thể còn sau account deletion | MEDIUM | Retention/product decision + deletion integration test |
| BF-P2-31 | P2 | DATA INTEGRITY RISK | Org decommission | `schema.py:1348-1374,1465-1488` | 62 org tables, chỉ membership/subscription FK trực tiếp; 39 polymorphic owner tables; chưa có delete endpoint | Future/manual org deletion dễ để orphan | MEDIUM | Transactional decommission/owner registry; không thêm FK mù |
| BF-P3-01 | P3 | LIFECYCLE SMELL | NotificationCenter | `NotificationCenter.js:167-170,268-274` | Interval/listeners không retained/disposed; guard hiện ngăn duplicate init | Leak nếu shell remountable sau này | MEDIUM | Add explicit dispose khi lifecycle cho phép remount |
| BF-P3-02 | P3 | CONFIRMED DEAD CODE | Award direct/special branch | `AwardResultApprovalWorkflow.js:64-164`; sole caller `AwardResultPanelController.js:378-419` | Caller return legacy direct path, còn lại truyền false; no other prod caller | Noise/duplicate behavior | HIGH | SAFE AFTER TEST; remove branch only, not module |
| BF-P3-03 | P3 | CONFIRMED DEAD CODE | Evaluation metadata aliases | `evaluationMetadata.js:60-71` | 5 exports chỉ có declarations; no test/dynamic/registry/bundle symbol | Dead symbols | HIGH | SAFE AFTER TEST; retain used module functions |
| BF-P3-04 | P3 | BROKEN TOOLING/DOCS | Business matrix | `package.json:45`; `docs/e2e/*` | Command `MODULE_NOT_FOUND`; docs vẫn claim generator/pass/spec không tồn tại | Coverage claim không executable | HIGH | Restore generator+gate hoặc retire command/archive docs |
| BF-P3-05 | P3 | CI MAINTAINABILITY DEBT | Duplicate/drifting gates | `package.json:11-12,22`; `ci.yml:72-99` | Manual CI bỏ encoding/modules và lặp security/build | Drift + CI time | HIGH | One canonical reusable gate/artifact |
| BF-P3-06 | P3 | POSSIBLY UNUSED | Benchmarks | `benchmark_explicit_persistence.mjs`; `benchmark_n_plus_one.py` | No package/CI/docs caller; standalone still runnable | Maintenance noise, not proven dead | MEDIUM | Owner decision/telemetry; do not delete yet |
| BF-P3-07 | P3 | DATABASE DEBT | Duplicate audit index | `schema.py:1857-1860`; `postgres_schema.py:588,1039` | Hai unique btree exact `(chain_id, previous_hash)`, mỗi 1,104 kB, 0 scans tại snapshot | Double write/storage overhead | HIGH | Migration drop explicit duplicate + contract update; keep constraint index |
| BF-P3-08 | P3 | CONFIRMED DEAD/LEGACY CHAIN | Timeline DOCX | `routes_docx.py:755`; `export_routes.py:51-52`; worker IPC chain | Dispatcher route timeline sang Excel; legacy symbol/worker path không còn active caller | Dead compatibility surface | HIGH | SAFE AFTER coordinated test/IPC/template cleanup |
| BF-P3-09 | P3 | TEST ISOLATION BUG | LP-25 fixture | `low_price_conflict_fixture.py:28-129,154-163`; E2E `:267-271` | Cleanup xóa org/accounts nhưng để 7 business rows × 7 runs = 49 local orphan rows | Shared dev/test DB contamination | HIGH | Reverse-dependency cleanup + postcondition zero-row assertion + test-DB guard |

---

# 2. Architecture Map

## 2.1. Dependency map tổng thể

```text
Browser / views/index.html
  -> frontend/app/app.js
     -> AuthShell (unauthenticated/legal)
     -> workspaceBootstrap (authenticated)
        -> BiddingModel (state, entity indexes, workspace epoch)
        -> BiddingView (DOM + lazy views)
        -> BiddingController (route/command orchestration)
           -> FeatureServices / WorkflowModuleLoader
           -> package, plan, partner, contract, evaluation workflows
           -> ExcelIntegration -> ExcelParseWorkerClient -> excelParseWorker
           -> WordIntegration / NotificationCenter / AssistantLoader
        -> WorkspaceDataStore / MutationService
           -> workspace-scoped BrowserDB (IndexedDB)
           -> WorkspaceMutationOutbox(Store)
           -> SyncPushService -> POST /api/sync
        -> SyncPullService -> delta/full/pagination/record APIs
           -> syncMergeUtils -> state + IndexedDB -> render coordinator
        -> WebSocketSyncClient -> db_changed -> debounced pull
                               -> polling fallback on disconnect

Starlette backend/app.py
  -> auth/admin/org routes -> session + membership + RBAC
  -> sync API/command/service/repository -> PostgreSQL transaction
  -> versioning service/repository -> SERIALIZABLE aggregate copy-on-write
  -> lifecycle/lot/evaluation/domain services
  -> document routes/jobs/worker/sandbox -> DOCX/XLSX/file storage
  -> AI routes -> permission context -> scoped analytics/search -> provider
  -> WebSocket event log/leases -> client pull notification
  -> notifications/activity/contractor-risk/integrations

PostgreSQL canonical schema.py + postgres_schema.py
  -> 79 tables / 1,115 columns / 104 FKs / 379 indexes
  -> schema v42; upgrades.py v2..v42
  -> organization_id / owner_type tenant scope
  -> root_id + phien_ban + is_latest aggregate lineage
  -> row_version optimistic concurrency
  -> sync_version + sync_metadata + deleted_records + sync_mutations
  -> immutable activity/audit chains and durable job/event queues
```

## 2.2. Frontend

Entry chain là `views/index.html` → `frontend/app/app.js:151-156` → `workspaceBootstrap.js:111-150`. `BiddingController.js:47-83` là route table; `RouteRegistry.js:53-106` và `BiddingControllerUI.js:332,441` xử lý parse/serialize/history. `BiddingView.js:70-92` lazy-load dashboard/plan/partner/timeline; `WorkflowModuleLoader.js:55-113` và `moduleRegistry.js:10-35` nạp workflow rồi gắn export có collision check lên prototype.

Workspace dự kiến được cô lập ba lớp: `workspaceState.js:48-61,177-215` tạo scope/DB name; `BiddingModel.js:167-176,391-407` tăng epoch và rebuild DB/storage; push/pull/WebSocket chính capture token. Các P0 xuất hiện tại loader/mutation path không tham gia đầy đủ contract này.

`BrowserDB.js:63-84` khai báo store; multi-store server apply dùng một IDB transaction tại `BrowserDB.js:324-357`. `EntityIndexes` phục vụ lookup ID/root. Boundary hiện đại là `WorkspaceDataStore.js:89-285`; các API legacy trên `BiddingModel` vẫn direct-mutate state và là nguồn BF-P0-02/BF-P1-03.

## 2.3. Backend

`backend/app.py` lắp Starlette routes, middleware, static assets và lifecycle. Domain được tách theo `auth`, `sync`, `versioning`, `documents`, `ai`, `activity`, `notifications`, `contractor_risk`, `partners`, `timeline`, `analytics`; DB primitive/pool ở `backend/db/db_helper.py`.

Transaction boundary quan trọng:

- Generic sync: request validation → command/service → repository/record writer trong transaction; optimistic `row_version` ở update.
- Aggregate version: `backend/sync/service.py:654-659` dùng `SERIALIZABLE`; repository lock source/latest và idempotency.
- Restore: `backend/sync/restore_service.py:105-153` khóa tombstone và replay idempotent.
- Lot lifecycle: package lock ở `lot_lifecycle_service.py:230,318,434-444`, nhưng finalize retry chưa replay-safe.
- Documents: route kiểm access/workflow rồi file/DB operations; package-document step lock hiện có TOCTOU.
- AI: route → `permission_context` → analytics/query scope/workspace search → provider. Đây là nơi session-global active role phá workspace RBAC.

## 2.4. Database

Canonical fresh schema là `backend/db/schema.py`, được PostgreSQL hóa và assert ở `backend/db/postgres_schema.py`. `backend/db/upgrades.py` giữ contiguous historical upgrades v2–v42; fresh install tạo trực tiếp v42, database cũ mới chạy chain. `frontend/documents/schemaRuntime.js` là generated browser contract nhưng hiện drift khỏi generator.

Tenant model không chỉ có FK trực tiếp: 62 bảng có `organization_id`, nhiều bảng dùng `owner_type` polymorphic và personal workspace. Vì vậy không được thêm cascade/FK hàng loạt hoặc drop object chỉ từ static reference; decommission cần canonical owner registry và transaction riêng.

## 2.5. Route/API inventory theo nhóm

Catalog route có 145 registrations: 100 transport endpoints (99 HTTP + 1 WebSocket), còn lại là SPA/static mounts/routes. Bảng dưới map endpoint, caller, quyền/scope và transaction chính; danh sách path đầy đủ nằm ở Phụ lục B.

| Nhóm | Endpoint chính | Caller | Auth/RBAC + tenant scope | Service/repository/transaction |
|---|---|---|---|---|
| Sync/version | `/api/sync`, `/api/versioning/aggregate`, `/api/sync/delta`, `/api/get-all-data`, `/api/paginate`, `/api/record`, `/api/sync/restore`, `/api/sync-version` | Push/pull/model/version client | session + active org + table/record access | sync command/service/repository; aggregate `SERIALIZABLE`; generic mutations transactional |
| Realtime | `/ws/sync` | `WebSocketSyncClient` | session/origin/org membership/lease | durable event log + leases; personal scope bug BF-P1-14 |
| Auth/admin/org | `/api/auth/*`, `/api/organizations/*` | AuthShell/AdminUserController | public auth routes; privileged/admin/member checks | auth/admin/org services + DB transactions; concurrency risks BF-P1-10..12 |
| AI | `/api/ai/*` | AssistantController | session + active org + AI permission context | conversation repository, scoped search, provider; BF-P0-03 |
| Lot/lifecycle | `/api/packages/{id}/lot-*`, `/api/contracts/package-lifecycle` | package workflow | package read/write access + org | lifecycle service locks package; replay gap BF-P2-25 |
| Package documents | `/api/packages/{id}/documents/*` | package detail/Word/document UI | session + org + package/document policy | package document service + file staging/DB; step-lock TOCTOU BF-P1-13 |
| Document jobs/export | `/api/document-jobs/*`, `/api/export-*`, `/api/templates*`, `/api/word-mappings*`, `/api/import-excel` | Word/Excel/integration/admin UI | session, org, record + export capability | document worker/job repository/sandbox; some endpoints only possibly unused |
| Award Excel | `/api/packages/{id}/award-result-excel/*` | award result workflow | package/org/evaluation access | validation artifact + mapping/export service |
| Contractor risk | `/api/packages/{id}/bid-opening/contractors/resolve` | opening workflow | package/org write/read | provider/cache/repository + violation snapshot |
| Notifications/activity | `/api/notifications*`, `/api/activities/*` | NotificationCenter, activity UI | user/org/record scope | notification/activity service/repository |
| Partner/address | `/api/address/*`, `/api/lookup-tax-code` | partner workflows | public/reference vs authenticated lookup policy | upstream/cache/normalizer |
| Health/ops/client errors | `/health/*`, `/metrics`, `/api/client-errors` | probe/monitor/client diagnostics | deployment/network/middleware policy | readiness, metrics, redacted diagnostics |
| SPA/static | `/tong-quan`, `/ke-hoach`, `/goi-thau`, detail routes, `/dist`, `/views` | browser navigation | shell/session routing; static middleware | compiled index + content-hashed Vite assets; vendor query cache bug BF-P2-02 |

Không endpoint nào được tuyên bố dead chỉ vì không thấy frontend caller. `/api/contracts/package-lifecycle`, năm document-job routes, `/api/export-plan/{plan_id}`, GET/PUT document-export-capabilities, `/api/sync-version`, `/api/sync/restore` được giữ là `POSSIBLY UNUSED` vì có thể có external/manual callers và một số có test.

---

# 3. Confirmed Bugs

## BF-P0-01 — Stale tenant response ghi vào workspace mới

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P0-01` / P0 / frontend state, IndexedDB, tenant isolation |
| File / Function | `frontend/shared/tableDataUtils.js:78-146,162-184` — `loadPaginatedRecords`, `hydratePlanPackageRecords`, `cachePaginatedRecords`; `frontend/app/BiddingModel.js:193-213` — `_resetWorkspaceMemory` |
| Root cause | Loader không capture/check workspace token; reset không abort/reset `_paginationRequests` hay `_planPackageHydrationRequests`; completion dereference `model.state` và `model.db` hiện tại. |
| Reproduction | Gửi request khi scope `org-A`; đổi model/state/DB sang `org-B`; resolve response A. Repro deferred-promise cho kết quả `state=[pkg-B,pkg-A]` và log write `{workspace:"org-B", id:"pkg-A"}`. Lookup hydration cho cùng kết quả. |
| Actual | Record A append vào state B và được `putRecords()` vào IndexedDB B. |
| Expected | Response của epoch/scope cũ phải abort hoặc trở thành no-op, không mutate state/DOM/storage hiện tại. |
| Data impact | Cross-tenant contamination cả memory và durable local storage; notification/user/Word loaders cùng pattern có thể render dữ liệu sai workspace. |
| User impact | Người dùng B có thể thấy record/notification/mapping của A; lần sync sau có thể đưa dữ liệu sai vào workflow B. |
| Suggested fix | Một workspace lease immutable gồm token/scope/captured DB; đăng ký/abort mọi fetch; validate lease trước mọi state, DOM và persistence side effect; clear request maps khi transition. |
| Tests needed | Deferred A→B cho pagination, plan/package lookup, users, Word mapping/template, notification và employee modal; assert state/IDB/DOM B không đổi. |

Callers của shared path bao phủ plans, packages, contractors, experts, contracts, package preparation/lifecycle. Các unchecked-response sites liên quan gồm `BiddingController.js:589-617`, `AdminUserController.js:1152-1174`, `NotificationCenter.js:182-207`, `GoiThauWorkflow.js:150-167`, `HopDongWorkflow.js:340-357`, `WordIntegration.js:1009-1042`, `PackageTimelineView.js:238-250`.

## BF-P0-02 — In-flight mutation vượt qua workspace transition

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P0-02` / P0 / frontend state, persistence, outbox, tenant isolation |
| File / Function | `BiddingModel.js:676-731` — direct record APIs; `MutationService.js:21-84` — `persistChanges`; `BiddingController.js:441-498` — workspace switch |
| Root cause | Chỉ validate workspace trước `await`, sau đó dùng mutable `this.db`, state và outbox hiện tại. Switch khóa write mới nhưng không wait/fence mutation đã chạy. |
| Reproduction | `addRecord` bắt đầu ở A, defer A IDB write; switch model/outbox sang B; resolve write. Record A được stage vào outbox B. Với multi-change persist: upsert dùng DB A, switch, delete sau await dùng DB B. |
| Actual | Một logical transaction đi qua hai database/outbox scopes. |
| Expected | Mutation giữ nguyên captured scope/resources tới commit hoặc abort toàn bộ khi lease invalid. |
| Data impact | Có thể stage/upload content A dưới tenant B hoặc delete record B. |
| User impact | Cross-tenant corruption/loss; conflict khó giải thích sau reconnect. |
| Suggested fix | Captured token + DB + outbox, validate sau mỗi await; mutation coordinator single-flight/refcount; switch chờ hoặc abort in-flight mutations trước mở write B. |
| Tests needed | Deferred IDB/outbox/localStorage failures và mixed upsert/delete qua A→B; assert không side effect ở B và rollback/state consistency ở A. |

## BF-P0-03 — AI giữ role manager của tổ chức khác

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P0-03` / P0 / backend auth, RBAC, tenant isolation, AI |
| File / Function | `backend/auth/auth_routes.py:647-677` — set active role; `auth_helper.py:192-226` — session context; `ai/permission_context.py:33-73`; `analytics/query_scope.py:32-38`; `ai/workspace_search.py:238-269` |
| Root cause | `active_role` được persist trên session nhưng không bind với organization. Set-role chỉ chứng minh role ở active org lúc gọi; org header có thể đổi trong cùng session. AI permission context tin role session và bỏ assignment scope khi role là manager. |
| Reproduction | User là manager ở A, employee ở B. Chọn manager tại A; gửi AI request với `X-Active-Org=B`. Permission context vẫn manager, workspace search không giới hạn assignments. |
| Actual | AI trả full-scope B theo quyền manager không tồn tại ở B. |
| Expected | Effective role luôn là giao của selected mode và membership/role trong current workspace; nếu org đổi phải rederive/invalidate. |
| Data impact | Server-side read leakage của tenant B, không chỉ local cache. |
| User impact | Employee có thể đọc plan/package/contract/assignment ngoài phạm vi qua AI. |
| Suggested fix | Bind role selection với `organization_id`, hoặc derive mỗi request; invalidate on org switch/demotion; AI/tools chỉ nhận effective workspace authorization object. |
| Tests needed | Manager A/employee B cross-org, demotion mid-session, stale header/session role, every AI tool/query mode; negative result/404/filtered scope assertions. |

## BF-P1-01 — Pull ghi đè pending local upsert

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P1-01` / P1 / sync merge + outbox |
| File / Function | `frontend/shared/syncMergeUtils.js:7-18,86-143`; `WorkspaceMutationOutbox.js:244-261` |
| Root cause | Incoming rows được apply trước khi pending IDs được snapshot; protection chỉ áp dụng reference/manifest paths. `_enqueueUpserts` thay whole queued record. |
| Reproduction | Local row `LOCAL UNSYNCED` nằm outbox; server pull trả `SERVER STALE`; merge làm visible state thành server stale trong khi queue cũ còn local. Edit tiếp theo queue whole record dựa trên stale state. |
| Actual | Original local fields bị mất khỏi queued payload. |
| Expected | Pending upsert/delete là overlay/protected truth cho tới push resolve/conflict. |
| Data impact | Lost local update; server cuối cùng có thể nhận mixed stale payload. |
| User impact | Người dùng thấy edit đổi ngược rồi mất sau lần edit/sync kế tiếp. |
| Suggested fix | Snapshot pending mutation identities/payload trước merge; defer/overlay incoming; explicit conflict model. |
| Tests needed | Delta/full pull + pending upsert/delete + second edit + reload/reconnect. |

## BF-P1-02 — Overlapping pulls làm lùi state và cursor

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P1-02` / P1 / pull concurrency |
| File / Function | `frontend/app/SyncPullService.js:133-276`; callers manual/route/background |
| Root cause | Có workspace token guard nhưng không có per-workspace single-flight hay latest-generation commit. Scheduler chỉ serialize background calls, không serialize manual/route/workflow pulls. |
| Reproduction | Hai pull cùng scope: response version 2 resolve trước, version 1 resolve sau. |
| Actual | Final row là bản cũ và cursor thành `1`. |
| Expected | Completion cũ không được commit sau completion mới; cursor monotonic. |
| Data impact | Local state và delta baseline regress; có thể bỏ/redo change. |
| User impact | UI hiển thị dữ liệu cũ, conflict/reload bất thường. |
| Suggested fix | Serialize all pulls per workspace hoặc request generation + compare-and-commit cursor. |
| Tests needed | Reverse completion, 409 recursive full-sync, WebSocket+manual overlap, cursor monotonicity. |

## BF-P1-03 — State đổi trước durable write/outbox

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P1-03` / P1 / local persistence atomicity |
| File / Function | `frontend/shared/entityStore.js:1-9`; `BiddingModel.js:701-731`; fire-and-forget at `BidEvaluationPanelController.js:24-27` |
| Root cause | Legacy direct API mutate in-memory entity first, rồi await persistence/staging; failure không rollback. |
| Reproduction | Inject `db.putRecords` failure cho update. Promise reject nhưng state vẫn `{name:'after'}`, outbox null. |
| Actual | UI giữ edit không durable; reload làm mất/revert. Fire-and-forget có thể tạo unhandled rejection. |
| Expected | State, IDB và outbox commit atomically hoặc rollback về snapshot. |
| Data impact | Mất edit assignments/goods/timeline/evaluation/custom status ở failure edge. |
| User impact | UI báo/hiển thị thành công tạm thời nhưng dữ liệu biến mất. |
| Suggested fix | Route mọi synced mutation qua `WorkspaceDataStore`; nếu giữ compatibility path thì checkpoint + rollback + durable outbox staging. |
| Tests needed | Add/update/delete dưới IDB quota/error và localStorage error; reload verification. |

## BF-P1-08 — Word access controls được lưu nhưng không có hiệu lực

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P1-08` / P1 / backend access control, DOCX export |
| File / Function | UI `modal_detail_system_user.html:96-107`; client `AdminUserController.js:593-616`; persist `admin_user_routes.py:439-454`; runtime `access_policy.py:193-209`; consumer `routes_docx.py:486-567` |
| Root cause | Compatibility projection trả `allow_all()` bất kể stored flags. UI/API/schema vẫn trình bày flags là enforcement controls. |
| Reproduction | Lưu cả ba quyền thành `0`; test/query xác nhận DB `0/0/0`; effective policy vẫn ba giá trị true và DOCX route dùng policy đó. |
| Actual | Người bị hạn chế vẫn có full data scope trong Word export. |
| Expected | Stored policy được enforce hoặc UI/API không được hứa behavior không tồn tại. |
| Data impact | Export có thể chứa records ngoài phạm vi người quản trị chọn. |
| User impact | False sense of security; potential unauthorized disclosure. |
| Suggested fix | Product decision trước: restore deny/filter gates end-to-end hoặc retire controls/columns qua compatibility window. |
| Tests needed | Each checkbox false/combination; DOCX context negative assertions; manager/employee/org scope. |

## BF-P1-09 — Stale delete xóa update mới

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P1-09` / P1 / backend optimistic concurrency |
| File / Function | `backend/sync/deletion_service.py:178-182,237-239,314-343`; `backend/sync/delete_policy.py:245-252` |
| Root cause | Service đọc/check `row_version` không lock; final archive/delete chỉ match identity, không match expected row version. |
| Reproduction | Tx delete đọc v1; Tx update commit v2; Tx delete tiếp tục archive/delete row vì SQL không có `row_version=v1`. |
| Actual | Update v2 bị xóa bởi stale request v1. |
| Expected | Stale delete nhận conflict, giữ update v2. |
| Data impact | Lost update hoặc mất record. |
| User impact | Người dùng thứ hai mất thay đổi dù update đã thành công. |
| Suggested fix | Lock row khi prefetch hoặc conditional delete/archive với expected version và check `rowcount`; preserve tombstone semantics. |
| Tests needed | Real PostgreSQL two-connection barrier cho archive và hard-delete policies, retry/idempotency cases. |

## BF-P1-14 — Personal workspace mất realtime lẫn fallback polling

| Field | Nội dung |
|---|---|
| ID / Severity / Area | `BF-P1-14` / P1 / WebSocket/polling sync |
| File / Function | `backend/sync/websocket.py:261-281,373-375`; `frontend/app/WebSocketSyncClient.js:9,61-91,124-138` |
| Root cause | Backend resolver không chấp nhận `personal:*` và close 4003. Client stop polling khi mở WS; 4003 được coi non-retryable nhưng close path không restart polling. |
| Reproduction | Mở personal workspace trong hai tab; client connect WS, server close 4003; kiểm timer/poll state. Không có WS và không có poll. |
| Actual | Tab khác không nhận/pull thay đổi cho tới manual refresh/reload. |
| Expected | Personal scope có WS hợp lệ hoặc client luôn bật polling fallback khi WS unusable. |
| Data impact | Stale state, tăng conflict/lost-intent risk khi hai tab edit. |
| User impact | Thay đổi không xuất hiện realtime; workflow có thể thao tác trên dữ liệu cũ. |
| Suggested fix | Canonicalize personal scope server-side hoặc normalize close-state machine để restart polling. |
| Tests needed | Two-tab personal workspace, 4003/other non-retryable closes, reconnect/logout/workspace switch. |

---

# 4. Correctness Risks

## 4.1. Rủi ro P1 cần xử lý ngay sau P0

- **BF-P1-04 — dual outbox fail-open:** localStorage write diễn ra trước IDB fallback, nên exception đầu tiên làm fallback không chạy; read/corruption của cả hai backend bị chuyển thành queue rỗng. Cần một degraded/recovery state và cấm authoritative pull tới khi reconciliation hoàn tất.
- **BF-P1-05 — historical contractor mutation:** opening lookup enrich record date-effective tại chỗ rồi stage sync. Không sửa snapshot lịch sử; tạo version mới hoặc giữ enrichment trên immutable bid snapshot.
- **BF-P1-10 — member quota race:** hai transaction ở quota còn một chỗ cùng count rồi insert. Chỉ code proof, chưa chạy race harness; cần lock subscription/org row và recount.
- **BF-P1-11 — last-manager race:** remove/demote paths không dùng chung serialization lock. Hai manager có thể đồng thời loại nhau; cần một invariant boundary duy nhất.
- **BF-P1-12 — last-super-admin race:** cùng dạng write skew ở platform scope; dùng advisory lock hoặc singleton role lock.
- **BF-P1-13 — package-document TOCTOU:** lifecycle check và upload/delete không cùng lock/version. Giữ file staging rollback, nhưng thêm expected workflow version/row lock.

## 4.2. Rủi ro correctness/versioning P2

- **BF-P2-03:** date trước version đầu tiên hiện chọn dữ liệu tương lai; behavior phải được product owner quyết định trước khi bỏ fallback.
- **BF-P2-07:** corrupted legacy lot JSON có behavior vừa fail-open (`[]`) vừa throw. Một parser canonical phải có strict mode cho command và display mode có telemetry cho UI.
- **BF-P2-08:** latest/root tie-break khác nhau giữa plans, packages và component resolvers. Không refactor resolver trước khi đóng invariant/tie-break contract bằng tests.
- **BF-P2-25:** finalize lot tăng version rồi lost response; retry bị conflict. Idempotency key phải bind canonical request digest và replay cùng result.
- **BF-P2-26:** event enqueue sau commit không transactional; local fallback chỉ hữu ích single replica. Business commit và durable notification intent phải cùng unit/outbox.

## 4.3. Rủi ro dữ liệu/privacy/deployment

- **BF-P2-27:** AI base URL là deployment-controlled, không phải user-controlled SSRF đã xác nhận. Dù vậy arbitrary host/redirect/proxy có thể exfiltrate tenant prompt/API key khi cấu hình sai; validate scheme/host và redirect policy.
- **BF-P2-30:** account deletion không định nghĩa rõ xử lý `deleted_records.record_snapshot_json`; cần retention/privacy decision, không tự động purge audit evidence.
- **BF-P2-31:** future org decommission thiếu canonical owner registry. 39 bảng polymorphic khiến giải pháp “thêm FK cascade hết” nguy hiểm; cần service transactional có dry-run/postcondition.

---

# 5. Database Findings

## 5.1. Catalog snapshot và integrity

Read-only catalog trên PostgreSQL `17.10`, database `biddingflow_dev`, schema version `42`:

| Metric | Kết quả |
|---|---:|
| Canonical/live tables | 79 / 79 |
| Columns | 1,115 |
| Tables có `organization_id` | 62 |
| Tables có `row_version` | 18 |
| Tables có `sync_version` | 31 |
| Foreign keys | 104 |
| FK có usable left-prefix index | 104 / 104 |
| Indexes | 379 |
| Unvalidated constraints | 0 |
| Invalid indexes | 0 |
| Extra/missing table so với canonical | 0 / 0 |

Các read-only invariant checks đều pass:

- contract/package/plan lineage và cross-owner references được kiểm trong phạm vi FK/domain query;
- assignment targets hợp lệ;
- tối đa một active session/user;
- awarded package/lot invariants;
- active opening business key và active normalized lot code uniqueness;
- tối đa một JV leader cho contractor/opening snapshot;
- `sync_version`, `row_version` hiện tại nằm trong miền hợp lệ;
- version root/latest không duplicate; archived lineage và plan-snapshot package scope được tính đúng.

Không có bảng production nào zero-reference sau khi kết hợp static SQL, schema registry, sync payload registry, export/import, route, test và migration scan. Không có table/column nào đủ bằng chứng để đề xuất drop.

## 5.2. Active database/schema findings

### BF-P2-22 — Startup schema assertion có blind spots

`assert_schema_contract()` tại `backend/db/postgres_schema.py:960-1068` kiểm expected table, exact column-name set, một subset FK/index names. Nó không reject extra tables và không so phần lớn type, nullability, default, CHECK, UNIQUE, trigger definitions, FK/index definitions hoặc extension. `scripts/audit_fk_indexes.py` chỉ kiểm FK đang tồn tại có index; nó không thể phát hiện FK bị drop.

Hướng xử lý: normalize catalog (`pg_attribute`, `pg_constraint`, `pg_index`, triggers/extensions) thành deterministic contract; thêm negative tests mutate từng loại drift. Không thay schema bằng ORM rewrite.

### BF-P3-07 — Exact duplicate unique index

| Index | Definition | Size snapshot | `idx_scan` snapshot |
|---|---|---:|---:|
| `audit_log_chain_id_previous_hash_key` | unique btree `(chain_id, previous_hash)` | 1,104 kB | 0 |
| `idx_audit_log_single_successor` | unique btree `(chain_id, previous_hash)` | 1,104 kB | 0 |

Constraint-backed index đến từ `backend/db/schema.py:1857-1860`; explicit index đến từ `postgres_schema.py:588` và bị schema contract yêu cầu tại `:1039`. Audit table có 5,951 rows khi đo. Candidate duy nhất để remove là explicit duplicate, nhưng **không SAFE NOW**:

- `migration required`: yes — append-only migration drop explicit duplicate và update fresh-schema/contract;
- `backfill required`: no;
- `compatibility window`: ít nhất một release/catalog validation, bảo đảm không external tooling phụ thuộc exact custom name;
- `rollback strategy`: recreate exact unique index và restore named-index contract nếu audit-chain/concurrency regression xuất hiện.

Không drop constraint-backed index.

### BF-P2-24 — Missing CHECK candidates

`sync_metadata.current_version` không có `>= 0`; không có CHECK `min_available_version <= current_version`. Live rows đều hợp lệ nên đây là database debt, không phải active corruption. Quy trình: preflight invalid rows → `NOT VALID` constraints → validate → canonical/schema-contract update.

### BF-P2-28 — Retention filter/index mismatch

`backend/lifecycle.py:97-153` cleanup toàn cục bằng cutoff `deleted_at`/`created_at`, trong khi `idx_deleted_records_owner_deleted` và `idx_sync_mutations_owner_created` dẫn bằng `organization_id`. Read-only `EXPLAIN` trên local cardinality thấp chọn Seq Scan cho `deleted_records`, `sync_mutations` và claim path `partner_enrichment_jobs`. Chưa có production latency evidence, nên giữ là scale risk. Đề xuất cutoff-first/partial indexes chỉ sau realistic-cardinality benchmark; delete theo batch để giới hạn lock/WAL.

### BF-P2-31 — Organization decommission chưa có invariant boundary

Trong 62 bảng có `organization_id`, chỉ `thanh_vien_to_chuc` và `organization_subscriptions` FK trực tiếp tới `to_chuc`; 39 bảng còn có ownership polymorphic. Hiện không có production endpoint delete organization, vì vậy đây là conditional risk. Nếu triển khai decommission, cần canonical owner registry, dry-run, one transaction hoặc resumable state machine, audit/retention decisions và postcondition query. Không thêm cascade FK một cách máy móc.

### BF-P3-09 — Low-price fixture để orphan rows

`scripts/low_price_conflict_fixture.py:28-129` seed bảy business rows/run; cleanup `:154-163` chỉ xóa organization/accounts. Read-only local evidence xác nhận bảy run `lp25-*`, mỗi run còn bảy rows = 49 rows. Các bidder/JV/multi-assignee/pairwise fixtures có explicit owner-row cleanup, nên không khái quát finding này cho mọi fixture. Cần reverse-dependency cleanup, test-database guard (`APP_ENV=test` + allowlisted DB name) và final zero-row assertion.

### Generated schema contract drift

BF-P2-01 là seam database→browser: actual `frontend/documents/schemaRuntime.js` 23,309 chars, regenerated canonical 24,205 chars. Ngoài `goi_thau.yeuCauThamDinhHsmtCode`, drift gồm export capability fields, normalized lot và violation fields. Serializer reject/drop unknown canonical fields; appraisal workflow thực sự ghi field này. Tuy vậy legacy yes/no/text fallback thường vẫn giữ visible timeline behavior, nên bằng chứng hiện tại xác nhận contract/data-fidelity defect nhưng chưa chứng minh P1 business failure ở mọi path; severity giữ P2. Generator hiện không nằm trong package scripts/CI drift gate.

## 5.3. Data integrity và orphan interpretation

Catalog có 0 invalid FK; “logical orphan organization” không đồng nghĩa FK violation vì owner scope cố ý polymorphic và audit/event/tombstone có retention riêng. Snapshot local cho thấy residue ở business version tables, tombstones, activity/audit và WebSocket events sau test runs. Finding chắc chắn được thu hẹp vào LP-25 49 rows; các aggregate counts còn lại chỉ là evidence cần decommission/retention contract, không được dùng để kết luận production corruption.

## 5.4. Index/query audit

- 104/104 foreign keys có usable index; không có missing-FK-index finding.
- Exact duplicate audit index là confirmed removable candidate sau migration/test.
- Retention query mismatch là candidate rõ nhất từ read-only `EXPLAIN`; local dataset quá nhỏ để dùng `EXPLAIN ANALYZE` latency làm production conclusion.
- Tenant, root/latest, plan/package, contractor, opening, lot, assignments và pagination đều có canonical index families. Không đề xuất thêm index chỉ từ một query text; cần `pg_stat_statements`/production-like benchmark để tránh write amplification.
- Hai duplicate audit indexes đều `idx_scan=0` trong local snapshot, nhưng scan count local không phải đủ bằng chứng drop; definition duplication mới là evidence quyết định.

## 5.5. Transaction boundary audit

| Flow | Kết luận |
|---|---|
| Generic sync update | Tốt: atomic `row_version` predicate ở `record_writer.py:58-107` |
| Generic sync delete | **BF-P1-09:** stale prefetch/delete race, thiếu lock/expected-version predicate |
| Aggregate plan/package version | Tốt: `SERIALIZABLE`, repository locks, idempotency |
| Restore tombstone | Tốt: `FOR UPDATE`, idempotency và bounded evidence |
| Lot create/finalize | Package lock tốt; **BF-P2-25** retry finalize chưa idempotent |
| Package document upload/delete | **BF-P1-13:** step check/write TOCTOU |
| Membership/quota | **BF-P1-10/BF-P1-11:** count-then-write write skew |
| Platform last admin | **BF-P1-12:** count-then-delete write skew |
| WebSocket broadcast intent | **BF-P2-26:** after-commit durable enqueue fail-open |
| Versioned frontend local mutation | **BF-P0-02/BF-P1-03:** scope/atomicity broken qua awaits/failures |

## 5.6. Migration matrix v2–v42

Mọi released migration là historical và phải giữ. Registry chỉ chạy mỗi version một lần trong transaction của upgrade runner; “guarded” dưới đây nói về khả năng chịu partial/reconcile, không phải khuyến nghị chạy function tùy ý. Không có downgrade migrations; rollback expectation là restore backup/transaction rollback trước commit. Production auto-migration mặc định tắt tại `backend/lifecycle.py:30-42`.

| V | Name | Idempotency / compatibility | Lock/data risk | Decision |
|---:|---|---|---|---|
| 2 | `remove_mfa` | `DROP IF EXISTS`/`DROP COLUMN IF EXISTS`; destructive retired feature | metadata lock | KEEP HISTORICAL |
| 3 | `reconcile_retired_mfa_schema` | idempotent repair cho installations ghi v2 sớm | metadata lock | KEEP HISTORICAL |
| 4 | `enforce_single_active_session` | ranks/revokes duplicates + partial unique index | scans/updates sessions | KEEP HISTORICAL; preflight active sessions |
| 5 | `add_package_expert_updated_at` | additive `IF NOT EXISTS` | table rewrite risk tùy PG/default/version | KEEP HISTORICAL |
| 6 | `reconcile_record_ownership_constraint` | drop/re-add named CHECK | short table lock | KEEP HISTORICAL |
| 7 | `add_user_notifications` | additive/reconcile purpose CHECK | metadata/index build | KEEP HISTORICAL |
| 8 | `add_session_active_role` | additive + CHECK | session table lock | KEEP HISTORICAL; BF-P0-03 fix must not rewrite history |
| 9 | `normalize_package_technical_weight` | data normalization, not semantic-idempotent outside registry | update matching packages | KEEP HISTORICAL |
| 10 | `add_plan_submission_numbers` | additive guarded columns | metadata lock | KEEP HISTORICAL |
| 11 | `replace_paper_status_with_contract_catalog` | creates/backfills catalog; contains historical destructive `CASCADE` path at `upgrades.py:291-300` | backfill + destructive DDL | KEEP HISTORICAL; backup/preflight required |
| 12 | `add_lot_selection_lifecycle` | additive/backfill stable lot identity | multi-table backfill/indexes | KEEP HISTORICAL |
| 13 | `add_partial_package_result_status` | CHECK/status reconcile | table lock | KEEP HISTORICAL |
| 14 | `reconcile_canonical_schema` | broad repair for v11/v12 databases | widest schema reconciliation | KEEP HISTORICAL; catalog diff before/after |
| 15 | `add_package_documents` | additive table/index | low/medium | KEEP HISTORICAL |
| 16 | `extend_evaluation_criteria` | additive released contract restore | metadata/backfill | KEEP HISTORICAL |
| 17 | `add_detailed_bid_evaluations` | additive normalized evaluation tables | DDL/index build | KEEP HISTORICAL |
| 18 | `add_sync_mutation_request_hash` | additive/backfill idempotency binding | mutation table update | KEEP HISTORICAL |
| 19 | `retire_evaluation_actor_infrastructure` | retire constraints/indexes, columns retained | metadata lock | KEEP HISTORICAL |
| 20 | `add_bid_evaluation_prices` | additive money columns | table alteration | KEEP HISTORICAL |
| 21 | `add_low_proposed_award_price_acceptance` | additive decision fields | table alteration | KEEP HISTORICAL |
| 22 | `add_package_goods` | additive table/index/FK | DDL | KEEP HISTORICAL |
| 23 | `add_bidder_goods` | additive wide table/index/FK | DDL/index build | KEEP HISTORICAL |
| 24 | `scope_package_documents_by_evaluation_batch` | transforms uniqueness/scope | uniqueness validation/lock | KEEP HISTORICAL; duplicate preflight |
| 25 | `add_multi_assignee_activity_log` | expands assignment model + immutable activity | backfill/constraint/index | KEEP HISTORICAL |
| 26 | `preserve_activity_actor_snapshot` | compatibility snapshot before account delete | backfill activity | KEEP HISTORICAL |
| 27 | `add_goods_preference` | additive auditable inputs/results | wide bidder-goods alteration | KEEP HISTORICAL |
| 28 | `drop_retired_evaluation_actor_columns` | destructive but has loss-prevention preflight; deliberately avoids CASCADE at `:933-946` | exclusive DDL lock | KEEP HISTORICAL; never bypass preflight |
| 29 | `cover_remaining_foreign_keys` | index-only coverage | index build/WAL | KEEP HISTORICAL |
| 30 | `add_tombstone_restore_evidence` | additive bounded restore fields | tombstone alteration/backfill | KEEP HISTORICAL |
| 31 | `add_durable_assets_and_export_scope` | additive journal/job authorization | DDL/index | KEEP HISTORICAL |
| 32 | `add_websocket_delivery_state` | additive retry/dead-letter state | event-log alteration/index | KEEP HISTORICAL |
| 33 | `add_effective_timeline_model` | backfill stable timeline IDs + tri-state appraisal | multi-row normalization/unique constraints | KEEP HISTORICAL |
| 34 | `index_ehsmt_adjustment_actors` | index-only FK coverage | index build | KEEP HISTORICAL |
| 35 | `sparse_word_mapping_overrides` | transforms defaults to seeds + sparse overrides | data migration/compatibility | KEEP HISTORICAL |
| 36 | `persist_canonical_lot_codes` | loads all lot/opening rows into Python; normalizes, updates all, creates uniques | **O(N) memory + long transaction/locks** | KEEP HISTORICAL; BF-P2-23 preflight/runbook |
| 37 | `add_document_export_capabilities` | additive; preserves legacy access | DDL/backfill | KEEP HISTORICAL; Word policy decision separate |
| 38 | `add_ai_assistant_storage` | additive tenant-scoped AI storage | DDL/index | KEEP HISTORICAL |
| 39 | `cover_ai_foreign_keys` | index-only coverage | index build | KEEP HISTORICAL |
| 40 | `add_ai_knowledge` | additive approved/versioned RAG registry | DDL/index | KEEP HISTORICAL |
| 41 | `add_contractor_violation_checks` | additive authoritative snapshots | DDL/index | KEEP HISTORICAL |
| 42 | `recheck_failed_violation_snapshots` | data invalidation/repair | updates affected snapshots | KEEP HISTORICAL |

BF-P2-29 tồn tại vì CI chỉ test fresh final schema; fake-cursor/unit tests không thay thế real PostgreSQL v1/vN→v42. Cần fixtures có data đại diện, chạy chain, so normalized catalog, backfill và invariants; không sửa nội dung historical functions để “làm đẹp”.

---

# 6. Frontend Findings

## 6.1. State và async lifecycle

Frontend có một workspace-isolation design đúng hướng (epoch, scoped DB, scoped outbox), nhưng enforcement chưa centralized. Ba loại async side effect còn bypass boundary:

1. loaders mutate current model/DB sau response mà không check captured epoch — BF-P0-01;
2. mutations dereference current DB/outbox qua awaits — BF-P0-02;
3. pulls cùng scope không có ordering/overlay contract — BF-P1-01/BF-P1-02.

Legacy direct record API tại BF-P1-03 tiếp tục là đường vòng qua `WorkspaceDataStore`. Đây là abstraction thiếu: không cần state-management rewrite; cần một `WorkspaceLease`/mutation coordinator bắt buộc tại mọi async entry.

## 6.2. IndexedDB và outbox

Điểm tốt: `BrowserDB.applySyncChanges` dùng một IDB transaction cho multi-store server changes; storage hydration recovery đã có per-key in-flight dedupe và workspace epoch guard. Điểm còn hở: dual store outbox fail-open (BF-P1-04), direct mutations thiếu rollback (BF-P1-03), transition không drain mutation (BF-P0-02).

Không thấy bằng chứng IndexedDB store/key nào obsolete. Không drop `kv_store` hoặc compatibility storage keys trước telemetry/migration window.

## 6.3. Version/resolver và business UI

- Contractor effective-date lookup có hai risks BF-P1-05/BF-P2-03.
- Latest/root selection duplicated/divergent BF-P2-08.
- Lot JSON parsing BF-P2-07 và award projection duplication ở §9.
- Global JV render caches BF-P2-04 phải được scope/clear, không xóa trước replacement.

## 6.4. Module/bundle/lifecycle

Build chứng minh lazy workflow/view splits là thật, không phải abstraction thừa. `ExcelParseWorkerClient` tạo worker qua `new URL(...?no-inline, import.meta.url)`; worker asset được emit, do đó không dead. NotificationCenter thiếu dispose nhưng guard hiện ngăn duplicate initialization, nên BF-P3-01 chỉ là lifecycle smell.

---

# 7. Backend Findings

## 7.1. Auth, tenant và access-policy

- BF-P0-03 là server-side RBAC bypass thực sự; phải fix trước mọi AI rollout.
- BF-P1-08 là policy/UI contract bị vô hiệu, không nên “sửa” bằng cách chỉ đổi label hoặc chỉ đổi backend flag.
- Membership/platform count-then-write races BF-P1-10..12 phải được giải bằng shared locking seam, không ba lock ad hoc khác nhau.

## 7.2. Sync, transactions và realtime

Generic update/aggregate/restore được thiết kế tốt. Delete path là exception BF-P1-09. Personal WebSocket BF-P1-14 là state-machine mismatch client/server. Durable WebSocket enqueue BF-P2-26 là multi-replica correctness risk; route broadcast sau commit cần đi qua canonical outbox.

## 7.3. Documents

Document subsystem có archive validation, safe spooling, worker isolation/sandbox và permission checks. Active issues là Word policy BF-P1-08, package step-lock BF-P1-13, production symbolication/worker coverage và legacy timeline DOCX chain. Không thấy path traversal/ZIP-slip/OOXML active exploit trong audited paths.

## 7.4. AI/integrations

AI query scope có tenant filters nhưng dùng sai effective role ở BF-P0-03. Provider base URL BF-P2-27 là deployment risk, không được gọi là user-triggered SSRF. Không thấy secret tracked. Dynamic SQL chủ yếu dùng allowlisted identifiers/placeholders; Bandit S608 detections không đủ bằng chứng SQL injection.

## 7.5. Router/service/repository quality

Không có static Python circular dependency finding. Một số route vẫn chứa orchestration/domain decisions, nhưng chưa có evidence để đề xuất broad refactor. Ưu tiên extraction chỉ nơi nó tạo shared invariant boundary: workspace authorization, membership locks, conditional delete, document lifecycle lock, transactional event outbox.

---

# 8. Dead / Unused / Legacy Code

## DEAD_CODE_INVENTORY

| File | Symbol | Loại | Evidence | Runtime path checked | Test usage | Dynamic usage checked | Safe to remove? | Removal risk | Replacement |
|---|---|---|---|---|---|---|---|---|---|
| `frontend/shared/evaluationMetadata.js:60-71` | `parseEvaluationMetadata`, `parseStrict`, `parseForDisplay`, `serialize`, `migrate` | confirmed dead symbols | Whole-repo exact refs chỉ declarations; Vite module metadata/tree-shaking excludes five exports; alias strings absent | imports, workflow registry, DOM/action, bundle | none | yes | **SAFE AFTER TEST** | Low; module còn symbols được dùng | Canonical used exports trong cùng module |
| `frontend/packages/detail/AwardResultApprovalWorkflow.js:64-164` | direct/special contractor/bid creation branch | confirmed dead branch | Sole prod caller returns qua legacy direct path; active new path luôn `isDirectOrSpecial=false`; no other caller | controller action/prototype registry/workflow loader | tests only exercise false path | yes | **SAFE AFTER TEST** | Medium; award is high-risk | Legacy `saveKetQuaChiDinhThau` hiện là active direct/special path |
| `backend/documents/routes_docx.py:755` + worker/timeline service chain | `export_timeline_api`, `render_timeline_docx` chain | confirmed dead / legacy chain | Dispatcher `export_routes.py:51-52` routes timeline sang Excel; no active route caller | Starlette registration, dispatcher, IPC allowlist, template provisioning | legacy/unit references must be updated together | yes | **SAFE AFTER TEST** | Medium/high due IPC/template assets | Active Excel timeline export |
| `frontend/shared/NotificationCenter.js` | interval/listeners | lifecycle smell, not dead | No dispose; persistent root/init guard prevents duplicate today | shell lifecycle/remount | notification tests | yes | no | Could break refresh | Add disposal seam first |
| `scripts/benchmark_explicit_persistence.mjs` | whole script | possibly unused | No package/CI/docs caller; standalone executable | scripts/docs/package registry | no canonical gate | N/A | not yet | May be manual diagnostic | Owner decision |
| `scripts/benchmark_n_plus_one.py` | whole script | possibly unused | No caller; rollback/manual benchmark semantics | scripts/docs/CI | no canonical gate | N/A | not yet | May be release diagnostic | Owner decision |
| backend endpoint group | lifecycle contract, 5 document-job, export-plan, document-export-capabilities GET/PUT, sync-version, sync-restore | possibly unused externally | No frontend caller found | router, tests, docs, dynamic caller | mixed; some tested | external unavailable | no | External/API/ops compatibility | Telemetry/deprecation window |
| `frontend/shared/AggregateVersionClient.js:23-47` | local aggregate fallback | legacy/compatibility | Backend currently always advertises capability, fallback still explicitly tested | runtime capability + client fallback | yes | yes | not yet | Offline/rolling-deploy compatibility | Server aggregate API |
| `backend/lot_lifecycle_routes.py:88-127` | `stagedApprovalAuthorized`, `authorizationBasis` | compatibility candidate | Current policy no longer needs flag at `lot_selection_lifecycle.py:260-265` | request contract and tests | compatibility tests | N/A | not yet | Old clients/contracts | Canonical lifecycle policy |
| `frontend/documents/excelParseWorker.js` | worker module | active, disproved dead | Runtime `new URL`; test/build/benchmark refs; worker asset emitted | yes | yes | yes | no | Break Excel parsing | None |
| lifecycle contract module | `lifecycleContract` | active, disproved dead | `tests/test_lifecycle_policy_contract.py:13-14` imports/executes | backend policy contract | direct | yes | no | Break contract validation | None |
| `scripts/generate_schema_runtime.py` | generator | runtime-critical automation gap | Generated file drift proves it is needed, not unused | package scripts/CI checked | generator tests absent | N/A | no | Increases schema drift | Add generate-and-diff gate |

Kết luận: 3 confirmed dead groups, tương ứng sáu frontend symbols/branch plus một coordinated backend legacy chain; **không có whole JS/Python module/file nào SAFE NOW**. Hai benchmark scripts chỉ `POSSIBLY UNUSED`.

## SAFE_TO_DELETE_MATRIX

| Object type | Candidate | Mức | Điều kiện / warning |
|---|---|---|---|
| JS symbols | 5 `evaluationMetadata` aliases | SAFE AFTER TEST | Targeted import/serializer/evaluation tests + secure build |
| JS branch | Award direct/special branch | SAFE AFTER TEST | Characterize direct/special award, DB/export/contract behavior first |
| JS module | `excelParseWorker.js` | DO NOT DELETE | Active dynamic worker |
| CSS | No selector/file proven dead | UNKNOWN | Runtime classes/templates/visual matrix chưa đủ để delete |
| Python symbol/chain | Timeline DOCX legacy chain | SAFE AFTER TEST | Coordinated route/worker IPC/template/test removal |
| Python module | No whole module proven dead | UNKNOWN | Keep |
| API endpoint | 11 no-frontend-caller paths (grouped above) | UNKNOWN | External telemetry + deprecation/compat window |
| DB index | `idx_audit_log_single_successor` | SAFE AFTER TEST | Migration required; contract update; keep constraint-backed twin |
| DB column | None | DO NOT DELETE | No confirmed dead column; migration/backfill/compat/rollback required |
| DB table | None | DO NOT DELETE | All 79 have production/schema/runtime references |
| Migration | v2–v42 | KEEP HISTORICAL | Never delete/rewrite released history |
| Script | Two standalone benchmarks | UNKNOWN | Determine operational owner; not dead by no-caller alone |
| Script | Schema runtime generator | DO NOT DELETE | Add automation |
| Dependency | Direct npm/Python deps | DO NOT DELETE | All have static/runtime/dynamic evidence |
| Vendor assets | 8 pinned assets | DO NOT DELETE | Vendor audit and runtime refs pass |
| Test fixture | LP-25 fixture | DO NOT DELETE | Fix cleanup/test DB guard; scenario remains valuable |
| Legacy adapter | Aggregate local fallback | KEEP FOR COMPATIBILITY | Retire only after rollout telemetry/min-client contract |
| Legacy request flags | staged approval fields | KEEP FOR COMPATIBILITY | Deprecation contract first |
| Local ignored artifacts | generated `dist/`, `release/`, coverage/test outputs | SAFE NOW locally only | Not tracked production code; regenerate as needed; **không bao gồm báo cáo audit bắt buộc này** |

Database delete warning: mọi future DB deletion proposal phải ghi rõ migration, data/backfill preflight, compatibility window, external/report/export/import/sync checks và rollback strategy. Báo cáo này chỉ nêu duplicate index candidate; không đề xuất drop table/column.

---

# 9. Duplicated Logic

## DUPLICATED_RULE_MATRIX

| Rule | File A | File B | File C/khác | Có khác behavior? | Nên canonicalize? |
|---|---|---|---|---|---|
| Award projection/direct-special vs competitive | `bidProcessAwardResult.js:50-100` | `BidProcessWorkflow.js:1055-1205` | `AwardResultApprovalWorkflow.js:174-215,285-505` | Có; direct/special dùng legacy, multi-lot dùng new | Có, sau characterization tests |
| Evaluation method token normalization | `evaluationMethodRules.js:26-54` | `technicalEvaluationMethod.js:23-41` | backend evaluation rules/maps | Maps/accepted aliases có thể drift | Có, shared contract fixtures; không ép JS/Python chung runtime |
| Latest/root resolution | `BiddingModel.js:933-1167` | `PackageDetailState`/`VersionSelector` | `NhaThauComponent` | Có; flags/version/tie-break khác | Có, sau invariant contract |
| Contractor identity/version | `contractorVersionBinding.js:20-66` | `bidProcessOpeningData.js:90-180` | `openingContractorLookup.js:180-210`, award workflow | Có; exact ID/code-latest/date-effective/future fallback | Có, canonical resolver modes |
| Lot JSON parsing | `bidEvaluationLowPriceRules.js:6-15` | `lotEvaluationScope.js:9-18` | award markup/controllers + three direct `JSON.parse` sites | Có; `[]` vs throw | Có, strict/display parser |
| Lot outcome enum | `lot_selection_lifecycle.py:39-47` | `award_result_mapping.py:9-17` | document/export mapping | Có nguy cơ label/token drift | Có, shared backend domain enum/adapter |
| AI restriction/effective scope | `ai/permission_context.py:33-73` | `analytics/query_scope.py:32-38` | `ai/workspace_search.py:238-269` | Có; manager short-circuit lặp và tạo BF-P0-03 | Có, one authorization object |
| Tax-code normalization | `contractor_risk/violation_rules.py:31-39` | `award_result_excel/normalization.py:20-21` | frontend contractor identity normalizers | Có; punctuation/empty handling khác | Có, contract vectors per boundary |
| Realtime event enqueue | transactional `enqueue_websocket_event` path | `websocket.py:596-612` fallback broadcaster | route after-commit callers | Có; durable fail vs silent local success | Có, canonical outbox |
| Timeline document export | active Excel dispatcher | legacy DOCX API/worker/template chain | frontend timeline export action | Có; one active, one unreachable | Retire legacy after test, không merge behaviors |

Không canonicalize bằng một “god utility”. Mỗi rule cần contract vectors và boundary rõ: domain enum/resolver trong backend, pure parser/resolver trong frontend, shared JSON fixtures khi cần cross-language equivalence.

---

# 10. Performance

## 10.1. Startup measurement

Fresh run `30 cold + 30 warm` từ `data/logs/startup-performance.json`:

| Mode | Min | Median | p95 | Max | Budget p95 | Longest task | Long-task budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Cold | 346 ms | 385 ms | **539 ms** | 656 ms | 800 ms | **145 ms** | 100 ms |
| Warm | 126 ms | 135 ms | **150 ms** | 178 ms | 325 ms | 0 ms | 100 ms |

Overall result fail chỉ vì cold longest task 145 ms. Cold/warm p95 đều pass. Trước cleanup Round 4 là 466/179/94 ms; chênh lệch trên shared Windows host không đủ để khẳng định regression ở startup latency, nhưng 145 ms là một long-task event thật trong sample và cần attribution. Không đề xuất đổi framework/bundler từ một sample.

## 10.2. Bundle

- Secure build: 262 modules, 46 obfuscated JS chunks, 5 assets.
- JS+CSS: 3,378,765 raw / 858,001 gzip / 704,169 Brotli.
- Initial closure: 564,572 raw / 126,929 gzip.
- Authenticated workspace closure: 1,190,499 raw / 306,566 gzip.
- CSS: 378,372 raw; `views/css/app.css:1-14` eager-import mọi route style.
- Largest obfuscated chunk: `BiddingWorkflows`, 684.57 kB raw / 178.55 kB gzip.

JS lazy splits đang hoạt động; ưu tiên split route CSS và profile workflow imports thay vì phá module graph. Mọi change cần before/after closure, RUM/startup và visual matrix.

## 10.3. Runtime/data paths

- `EntityIndexes` giảm ID/root full scans và nên giữ.
- Pagination/hydration giúp memory/startup nhưng thiếu workspace lease (BF-P0-01); không tắt pagination để sửa race.
- Global `jvDataStore`/`lotWinners` là unbounded privacy/memory risk (BF-P2-04).
- Retention global cutoff đang Seq Scan ở local plan (BF-P2-28).
- Excel worker là active off-main-thread split; không inline/delete.

Không có production cardinality/query telemetry để xác nhận N+1 hay slow endpoint khác. Đề xuất thêm query-duration/cardinality observations trước khi tạo indexes hoặc cache mới.

---

# 11. Security

## 11.1. Active findings

Năm direct application-security findings:

1. BF-P0-01 — cross-tenant stale read vào local durable store.
2. BF-P0-02 — cross-tenant in-flight mutation/outbox/delete.
3. BF-P0-03 — server-side AI RBAC bypass qua session-global role.
4. BF-P1-08 — ineffective Word data access controls.
5. BF-P2-27 — deployment-controlled AI provider destination risk.

Bốn deployment/supply-chain security findings bổ sung: BF-P1-06 packaged runbook/tool mismatch, BF-P2-15 full-lock `nanoid` advisory, BF-P2-17 incomplete vendor SBOM, BF-P2-21 mutable CI action/image refs.

## 11.2. Areas verified without active exploit finding

- Session/auth, CSRF/origin/CORS/trusted-host/middleware paths có substantial tests; không phát hiện generic auth bypass ngoài BF-P0-03.
- Protected image route canonicalizes path, validates signed/tenant ownership và uses private/no-store.
- DOCX/XLSX archive validation, upload spooling, file path handling và document sandbox có explicit guards.
- Trusted Types/security lint/vendor hash gates pass; no tracked secret found.
- Dynamic SQL sites được review theo identifier provenance; allowlisted identifiers và parameterized values không bị đánh đồng với SQL injection. 128 S608 là debt scanner count, không phải 128 vulnerabilities.
- AI external URL finding là deployment misconfiguration risk; không có user input path chứng minh SSRF.

## 11.3. Security tests cần thêm

- Cross-org role matrix cho mọi AI mode/tool và demotion/session replacement.
- Deferred local A→B read/write tests như security regression, không chỉ store unit test.
- DOCX export negative scope cho từng capability flag.
- AI provider host/redirect/proxy validation and redacted failure logging.
- Production artifact runbook path contract, full-lock dependency audit và complete vendor SBOM assertions.

---

# 12. State / Persistence / Sync

## 12.1. State model

`BiddingModel.state` + `EntityIndexes` là source cho render; BrowserDB/outbox/server là durability/sync layers. Modern `WorkspaceDataStore` cố gắng giữ state+IDB+outbox nhất quán. 59 direct state writes còn tồn tại theo ratchet; không phải tất cả sai, nhưng paths ghi synced entities phải đi qua một mutation boundary.

## 12.2. Failure matrix

| Event | Expected invariant | Active issue |
|---|---|---|
| Workspace A→B trong fetch | Completion A no-op everywhere | BF-P0-01 |
| Workspace A→B trong mutation | Commit/abort entirely in A, B untouched | BF-P0-02 |
| IDB write fails | State rollback, outbox unchanged/recoverable | BF-P1-03 |
| localStorage fails | IDB outbox still attempted/recoverable | BF-P1-04 |
| Pull over pending edit | Pending local payload remains overlay | BF-P1-01 |
| Two pulls resolve reverse | State/cursor monotonic | BF-P1-02 |
| Personal WS rejected | Polling resumes | BF-P1-14 |
| Server event durable enqueue fails | Retryable outbox intent retained | BF-P2-26 |
| Logout/workspace reset | all scoped maps/timers/requests disposed | Pagination requests/global JV cache incomplete |

## 12.3. Recommended seam

Không thay toàn bộ state management. Thêm incremental contracts:

- `WorkspaceLease {token, scope, db, outbox}` captured once;
- `assertCurrent()` before each side effect/after each await;
- per-workspace pull coordinator/generation;
- mutation drain/abort during transition;
- pending-mutation overlay in merge;
- explicit degraded outbox state and recovery UI/telemetry.

Mỗi seam phải đi bằng red-green tests từ deterministic repro đã ghi.

---

# 13. Versioning

## 13.1. Server aggregate version

Server aggregate path là phần nên giữ: `SERIALIZABLE`, repository locks, root/latest invariants và idempotency. Local aggregate fallback vẫn cần compatibility cho rolling rollout/offline clients; chỉ retire sau capability telemetry và minimum client version policy.

## 13.2. Active risks

- BF-P1-05: enrichment mutates historical contractor version.
- BF-P2-03: pre-effective date selects oldest future version.
- BF-P2-08: resolver/tie-break divergence.
- BF-P2-25: lot finalize response replay not idempotent.
- Generated schema drift có thể làm field versioned/lifecycle mới mất ở outbound serialization.

## 13.3. Invariants và tests

Live DB không có duplicate latest/broken active lineage. Test gaps còn lại: concurrent browser aggregate version creation; immutable historical contractor after opening/award/contract; date before first effective; resolver equivalence across model/components; lost-response replay for finalize.

Không thay root/version schema hoặc rewrite history. Canonicalize resolver behavior trước, sau đó thay từng caller trong small commits.

---

# 14. Evaluation / Award / JV

Audit đã đối chiếu 1G1T, 1G2T, multi-lot/multi-round, combined technical-price, lowest/evaluated/fixed/technical methods, goods/preference, low-price decision, award and JV paths.

## 14.1. Evidence hiện có

- JS/Python rule/unit coverage rộng cho evaluation, lots, goods, preference, opening and award.
- Fresh E2E paths pass cho bidder goods, pairwise 15-package matrix, full lifecycle, JV reload/relogin/DB/export/contract/multi-lot/1G2T, low-price two-user conflict và DB checks.
- Database invariants active lot code/opening key/JV leader/award lineage pass.

## 14.2. Findings

- Award direct/special branch trong new approval workflow dead; active direct/special still uses legacy implementation (BF-P3-02).
- Award projection and lot parsers duplicated (§9/BF-P2-07).
- Contractor opening lookup có historical mutation/future fallback (BF-P1-05/BF-P2-03).
- JV global caches unscoped (BF-P2-04), dù persistence/reload scenarios pass.
- Lot finalize lacks replay-safe idempotency (BF-P2-25).

Không gom award workflows trước khi có characterization vectors cho direct, special, competitive, partial multi-lot, 1G2T, low-price accept/reject, reload, DB and export/contract projections.

---

# 15. CSS / UI / Accessibility

## 15.1. Confirmed accessibility issues

- Authenticated 320 px package-detail matrix: disabled custom-select text contrast 3.86:1, dưới 4.5:1 (BF-P2-06).
- Generic and partner custom selects hide native control and expose click-only non-semantic elements, thiếu keyboard and ARIA combobox/listbox contract (BF-P2-05).

Existing `accessibleCombobox.js` là incremental replacement. Cần ArrowUp/Down, Enter, Escape, Home/End (nếu contract), focus/expanded/active-descendant, label/error/disabled semantics và screen-reader smoke.

## 15.2. CSS debt metrics

`!important=421`, raw colors `842`, runtime styles `541`; CSS eager bundle 378,372 raw. Ratchets pass nhưng không giảm so prior baseline. Không xóa selector từ static scan đơn lẻ: routes, runtime classes, modal injection và state selectors phải được capture qua coverage/visual inventory.

Static scan không thấy duplicate IDs trong `views/**/*.html`; runtime IDs vẫn cần browser validation. Authenticated UI matrix chỉ có một confirmed contrast failure; không có evidence để gọi toàn bộ mobile UI broken.

---

# 16. Test Quality / Gaps / Flaky Tests

## 16.1. Execution results

| Gate/scenario | Kết quả |
|---|---|
| Python current-SHA | 633/633 pass, no skip |
| JavaScript current-SHA | 522/522 pass, no fail/skip/todo |
| Auth shell | pass |
| UI quality | pass |
| Auth/RBAC full scenario | pass |
| Bidder goods | pass |
| Multi-assignee/activity | pass |
| Joint venture | pass |
| Low-price conflict | pass |
| CRUD modules | pass |
| Pairwise 15-package | pass |
| Full lifecycle | pass |
| Offline sync | 1 fail (`local-pending` vs `transport-error`), then 2 fresh pass — flaky |
| Authenticated UI matrix | fail one contrast target at 320 px |
| Performance | fail only long-task 145 ms budget |
| Canonical contractor-violation Playwright spec | 3 browser projects skipped vì fixture env conditions absent |
| Business matrix generator command | fail `MODULE_NOT_FOUND` |

Browser E2E dùng dedicated `TEST_DATABASE_URL` trong fresh runs; read-only audit queries dùng `biddingflow_dev`. Playwright canonical coverage vẫn không được CI enforce, dù custom Chromium scripts cover nhiều business scenarios.

## 16.2. Coverage

Fresh Python coverage artifact tại target SHA:

- combined coverage: 44.97%; statements 48.66%; branches 35%; global gate chỉ 28%;
- 0%: `document_worker_entry.py`, `sync/version_api.py`, `document_sandbox_probe.py`;
- low: `auth/auth_routes.py` 9.6%, `sync/websocket.py` 11.3%, `lot_lifecycle_routes.py` 6.3%, `lot_lifecycle_service.py` 7.8%, `package_document_routes.py` 11.9%; nhiều DOCX/Excel services 2–14%;
- frontend không thu line/branch coverage.

Pass count cao không bù cho branch/race gaps ở các module trên.

## 16.3. Critical flow matrix

Legend: `✓` direct scenario; `△` partial/indirect; `—` không thấy. Browser columns phản ánh fresh executed custom E2E trừ nơi ghi rõ skip.

| Critical flow | Unit | Integration | E2E | DB verification | Reload | Multi-user | Offline | Conflict | Gap trọng yếu |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Session/RBAC/workspace | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | △ | AI cross-org role; deferred A response/mutation |
| State/IDB/outbox/sync/WS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | reverse pulls, pull-over-pending edit, direct failure |
| Plan/package versioning | ✓ | ✓ | ✓ | ✓ | ✓ | △ | — | ✓ | real concurrent aggregate-version browser race |
| Opening/JV identity | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | △ | ✓ | historical freeze + pre-effective date |
| Evaluation/1G2T/lots/award | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | direct/special characterization; finalize replay |
| Contracts/assignments/activity | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | △ | contract offline/conflict |
| Goods/Excel/Word/documents | ✓ | ✓ | △/✓ | ✓ | ✓ | △ | — | △ | Word workspace race, worker/multi-replica/failure scope |
| Notification/AI | ✓ | ✓ | △ | △ | △ | △ | — | — | no full AI browser scope matrix; notification switch |
| Cross-browser/a11y/perf | ✓ | △ | △ | N/A | ✓ | N/A | △ | N/A | Firefox/WebKit absent; custom-select keyboard; long-task attribution |

## 16.4. Mười hai material gaps

1. Deferred tenant A responses across all shared loaders.
2. In-flight A mutation across workspace switch.
3. Same-workspace overlapping pulls and 409/full-sync recursion ordering.
4. Pull over pending upsert/delete followed by another edit.
5. Real direct add/update/delete failure/rollback.
6. Both outbox stores unavailable/corrupt and recovery.
7. Backend two-connection stale delete/last-manager/quota races.
8. Contractor historical freeze/pre-effective date.
9. Personal workspace WS→poll fallback/two tab.
10. Legacy custom-select keyboard/screen-reader and disabled contrast.
11. Canonical multi-browser CI with real fixture conditions.
12. AI browser data scope, document worker/offline/multi-replica and upgrade-chain coverage.

Arbitrary sleep/actionability/date debt: 29 timer waits, 4 direct DOM `.click()` calls bypass Playwright actionability, 84 hardcoded year/date occurrences. Thay bằng response/state/database barriers và relative clock fixtures; giữ timeout chỉ như outer safety bound.

---

# 17. Build / CI / Dependencies

## 17.1. Gate results

| Check | Result |
|---|---|
| `lint:python`, `lint:encoding`, `lint:security`, `lint:modules`, `lint:debt` | pass |
| Module graph | 258 modules, 0 static cycles |
| Vendor/security/Trusted Types gates | pass; 8 vendor files pinned |
| Secure Vite build | pass; 262 modules, 46 obfuscated chunks |
| `pip-audit -r requirements.txt` | 0 vulnerabilities |
| `npm audit --omit=dev` | 0 vulnerabilities |
| full `npm audit` | 1 HIGH: `nanoid@3.3.16` via Vite→PostCSS |
| `check:legal` | pass with 27 unapproved + 27 placeholders warnings |
| `check:legal:production` | fail intentional readiness gate |
| `test:e2e:business-matrix` | fail missing generator |
| FK/schema/package smoke/SBOM | relevant checks pass, nhưng SBOM scope incomplete |

## 17.2. Release readiness

Production package chain stops at legal gate before build/package. Đây là intentional blocker, không bypass. Sau khi fact sheet được approved, BF-P1-06 vẫn khiến operator runbook trong artifact tham chiếu scripts/runbook không package. Local package còn cho phép `releaseId=development` BF-P2-19.

## 17.3. Dependency/vendor/SBOM

Runtime dependency audits pass. High `nanoid` advisory nằm trong dev/build chain, chưa có runtime exploit evidence; scheduled full-lock audit vẫn cần. All direct npm/Python deps có static/runtime/dynamic usage; `python-multipart` là Starlette dynamic form dependency. Không dependency nào SAFE NOW.

Vendored Flatpickr/Lucide/SheetJS/fonts được package và vendor audit, nhưng generator SBOM chỉ inventory npm production + Python. Merge vendor manifest/licenses/hashes vào CycloneDX.

## 17.4. CI design

CI manual sequence drift khỏi canonical `npm run check`, bỏ encoding/modules ở một path và lặp security/secure build/package. Consolidate reusable job/artifact without weakening gates. Pin action SHAs/container digests. Add real upgrade chain and canonical Playwright matrix.

---

# 18. Observability

## 18.1. Active gaps

- BF-P2-18: obfuscated frontend không có private source/mapping artifact nên client errors không symbolicate.
- BF-P2-20: caught critical errors có thể chỉ console/silent; global `error`/`unhandledrejection` handler không thấy caught failures.
- BF-P2-26: WebSocket durable enqueue error bị swallow rồi report success.
- Long task 145 ms không có source attribution đủ dùng.
- IDB/outbox degraded state chưa có durable user-visible/metric signal.

## 18.2. Logging/security balance

Structured diagnostics phải gắn release ID, workspace hash (không raw tenant), operation, phase, retryability, storage/backend status và correlation ID. Không log record payload, document content, API keys, email/tax code hoặc prompt raw. High-cardinality IDs cần hash/bucket; private source maps không được public serve.

## 18.3. Failure-boundary priorities

1. workspace lease violation/stale completion counter;
2. IDB/outbox read/write/degraded/recovery events;
3. pull generation/cursor monotonic conflicts;
4. WebSocket persistent enqueue/dead-letter and polling state;
5. aggregate/delete/document transaction conflicts;
6. document worker/sandbox failure category;
7. AI provider destination validation and scoped authorization decision;
8. symbolication success test per release.

---

# 19. Technical Debt Metrics

## 19.1. Before/current

| Metric | Prior Round 4 baseline/revalidation | Current audit | Change |
|---|---:|---:|---:|
| Python tests | 633 pass | 633 pass | unchanged |
| JavaScript tests | 522 pass at revalidation | 522 pass | unchanged |
| Frontend modules / static cycles | 258 / 0 | 258 / 0 | unchanged |
| Direct state writes | 59 | 59 | unchanged |
| CSS `!important` | 421 | 421 | unchanged |
| Raw colors | 842 | 842 | unchanged |
| Runtime styles | 541 | 541 | unchanged |
| Inferred actions | 6 | 6 | unchanged |
| Python BLE001 | 118 | 118 | at ratchet limit |
| Python S608 | 128 | 128 | at ratchet limit; not 128 confirmed SQLi |
| Python F401/F841/S110 | 0/0/0 | 0/0/0 | unchanged |
| Secure chunks | 46 | 46 | unchanged count |
| FK coverage | 104/104 | 104/104 | unchanged/pass |
| Startup cold/warm p95 | implementation 485/209 ms; later isolated 651/286 ms | 539/150 ms | host/run variance; both within budget |
| Longest task | 94/76 ms implementation; later isolated 0/0 | 145/0 ms | one cold over-budget event |

Current debt gates pass vì ratchet không tăng, không có nghĩa debt đã được giải. Đặc biệt direct writes/catches/CSS counts đứng yên và đã che các seam P0/P1 không được đo bằng count.

## 19.2. Coverage metrics

Current Python combined 44.97%, statements 48.66%, branches 35%, nhưng production-risk modules vẫn 0–12%. Global 28% và module floors hiện chủ yếu chống tụt mạnh, chưa chứng minh high-risk paths. JavaScript không có coverage metric. Kế hoạch phải tăng theo risk/branch, không tăng một con số global bằng low-value tests.

---

# 20. Remediation Backlog

## 20.1. NOW

1. **BF-P0-03:** fix workspace-bound effective role ở auth/AI; disable/restrict AI manager scope cho tới khi regression pass nếu cần feature flag an toàn.
2. **BF-P0-01/BF-P0-02:** implement workspace lease cho async reads/mutations; transition drain/abort; capture DB/outbox.
3. **BF-P1-01/BF-P1-02/BF-P1-03/BF-P1-04:** make pull/outbox/local mutation ordering and durability explicit.
4. **BF-P1-09:** conditional/locked delete.
5. **BF-P1-08:** product decision + enforce/retire Word policy coherently.
6. **BF-P1-14:** restore personal workspace polling or support WS scope.
7. **BF-P1-10..13:** shared locking/version contracts for membership/quota/admin/document.
8. **BF-P1-07:** complete legal approvals; do not bypass.
9. **BF-P1-06:** make packaged runbook self-contained.

## 20.2. NEXT

- BF-P2-01 generated schema drift gate and serializer field tests.
- BF-P2-02 content-hashed bootstrap URLs.
- BF-P2-03/07/08 contractor/version/lot resolver contracts.
- BF-P2-25/26 idempotent finalize and transactional realtime outbox.
- BF-P2-22/24/29 schema contract, constraints and real upgrade-chain tests.
- BF-P2-05/06 accessible custom select and contrast.
- Add all twelve material test gaps and canonical Chromium/Firefox/WebKit coverage.
- BF-P2-18/19/20 production release diagnostics/symbolication.

## 20.3. LATER

- CSS route splitting and debt reduction with visual/perf budgets.
- Retention indexes only after realistic-cardinality benchmark.
- Vendor-complete SBOM, lockfile reproducibility, action/image pinning.
- Scope global JV caches; cleanup notification lifecycle.
- Dead branches/symbols and timeline DOCX chain after tests.
- Decide ownership of standalone benchmark scripts and stale E2E docs/tool.

## 20.4. DO NOT TOUCH YET

- Historical migrations v2–v42; especially do not rewrite v11/v28/v36.
- Aggregate server transaction/repository locking and local fallback until compatibility telemetry exists.
- `EntityIndexes`, BrowserDB multi-store transaction, Excel worker, document sandbox/archive guards.
- Any DB table/column, owner model, root/version schema or 104 FK set.
- Whole frontend/backend framework or state management.
- Word capability columns before product/legal compatibility decision.

## 20.5. Five remediation waves

### Wave 1 — Correctness / data safety

| Field | Nội dung |
|---|---|
| Expected files | `auth_routes.py`, `auth_helper.py`, AI permission/query files; `tableDataUtils.js`, `BiddingModel.js`, controller/sync/outbox/store; backend deletion/membership/document/WS services |
| Risk | High; touches authorization, tenant state and transactions |
| Test requirement | All deterministic repros first; two-connection races; cross-org AI matrix; offline/two-tab/reload/DB assertions; full unit/integration/E2E |
| Migration requirement | None expected for workspace/RBAC/delete code; possible session role compatibility handling only |
| Blast radius | Authenticated users, all tenant reads/writes, AI, sync, document workflow |

### Wave 2 — Dead code / legacy cleanup

| Field | Nội dung |
|---|---|
| Expected files | `evaluationMetadata.js`, award workflow/controller/tests, timeline DOCX route/worker/IPC/templates, compatibility docs |
| Risk | Medium/high because award/document paths are business critical |
| Test requirement | Characterization before deletion; secure build/tree-shake; direct/special/competitive/lot/export matrices |
| Migration requirement | None for code; deprecation window for request flags/endpoints |
| Blast radius | Evaluation/award/document export and old clients |

### Wave 3 — DB cleanup

| Field | Nội dung |
|---|---|
| Expected files | `schema.py`, `postgres_schema.py`, `upgrades.py` (append-only new version), schema audit/tests, retention lifecycle, LP-25 fixture |
| Risk | High for schema/index/retention; low for fixture cleanup |
| Test requirement | Catalog negative tests, fresh + v1/vN→latest PostgreSQL, integrity/FK/index audit, concurrent audit-chain writes, backup/rollback rehearsal |
| Migration requirement | Yes for duplicate index/CHECK/new indexes; no backfill for duplicate index; preflight/validation for CHECKs |
| Blast radius | Startup readiness, sync/audit writes, upgrade/deploy and retention |

### Wave 4 — Performance / maintainability

| Field | Nội dung |
|---|---|
| Expected files | CSS entry/routes, bundle config, resolver/parser utilities, JV caches, retention indexes, CI reusable jobs |
| Risk | Medium; regressions dễ ở lazy loading/visual behavior |
| Test requirement | Before/after bundle closure, 30+30 startup, long-task attribution, visual matrix, realistic DB plans |
| Migration requirement | Only if retention index selected |
| Blast radius | Startup, navigation, memory, cleanup operations, developer cycle |

### Wave 5 — UI/CSS/test debt

| Field | Nội dung |
|---|---|
| Expected files | custom selects/accessibility helper, tokens/CSS, Playwright/custom E2E, coverage config, stale docs/matrix generator |
| Risk | Low/medium, except business E2E harness changes can hide regressions |
| Test requirement | Keyboard/AT/axe, 320 px+, three browsers, repeat/soak, state-based waits, JS/Python risk floors |
| Migration requirement | No |
| Blast radius | UX/accessibility, CI time/reliability and audit confidence |

Mọi wave phải đi bằng small commits, compatibility-safe rollout và measurable gates; không big-bang rewrite.

---

# VERIFIED RESOLVED FROM PRIOR AUDITS

Chỉ các item trực tiếp kiểm lại ở current SHA:

1. Storage hydration retry hiện invalidate failed key/all-data promise, dedupe per-key in-flight và guard stale workspace completion cho `loadStorageKeys`; BF-P0-01 là các loader khác chưa dùng guard này.
2. Static frontend import graph: 258 modules, 0 cycles.
3. Không có duplicate static ID trong `views/**/*.html` theo direct scan.
4. Excel worker active và được bundle; disproves prior/possible dead-code candidate.
5. `lifecycleContract` có direct contract test; không dead.
6. FK index coverage 104/104; không còn missing-FK-index finding.
7. Aggregate versioning, generic sync update và tombstone restore có transaction/version/idempotency controls nêu ở §5.5.
8. Live v42 snapshot không có duplicate latest, invalid constraint/index hoặc failed checked business invariants.

Security lint/Trusted Types pass không được diễn giải thành “mọi security issue đã resolve”; ba P0 chứng minh ngược lại.

---

# Commands, evidence và kết quả

| Command/tooling | Kết quả/evidence |
|---|---|
| `git fetch origin main`; `git rev-parse HEAD`; `git rev-parse origin/main` | both `47629c307...` |
| Python pytest + branch coverage | 633/633 pass; fresh `.coverage`/`coverage.json` generated 2026-08-09 10:03 local; 44.97% combined, 48.66% statements, 35% branches |
| `npm run test:js` | 522/522 pass |
| `npm run lint:python` | pass; BLE001=118, S608=128, F401/F841/S110=0 |
| `npm run lint:encoding` | pass |
| `npm run lint:security` | pass including Trusted Types |
| `npm run lint:modules` | pass; 258 modules, 0 cycles |
| `npm run lint:debt` | pass ratchets: 59/421/842/541/6 |
| vendor audit/checks | pass; 8 pinned vendor files |
| Fresh secure build | pass; 262 modules, 46 obfuscated chunks |
| `pip-audit -r requirements.txt` | no vulnerabilities |
| `npm audit --omit=dev` | no runtime vulnerabilities |
| full `npm audit` | one HIGH `nanoid@3.3.16` |
| `npm run check:legal` | pass-with-warning 27 unapproved/27 placeholders |
| `npm run check:legal:production` | fail `LEGAL_READINESS_BLOCKED` |
| `npm run test:e2e:business-matrix` | fail `MODULE_NOT_FOUND` |
| Custom browser E2E suite | pass outcomes and limitations listed §16; offline 1 fail then 2 pass; authenticated matrix one contrast fail |
| `npm run test:performance` equivalent fresh measurement | fail only 145 ms long task; p95 539/150 within budgets |
| `python scripts/audit_fk_indexes.py` | 104/104 covered |
| PostgreSQL catalog/integrity SQL under read-only transaction | 79 tables, 379 indexes, 104 FK, 0 invalid/unvalidated; invariants pass |
| Read-only `EXPLAIN` | retention cutoff candidates choose Seq Scan at low local cardinality |
| Deterministic deferred fetch/IDB repro scripts | BF-P0-01/BF-P0-02/BF-P1-01/BF-P1-02/BF-P1-03 reproduced |
| Static/dynamic dead-code cross-check + in-memory Vite metadata | three confirmed dead groups; no whole module/file SAFE NOW |

Không chạy destructive database reset trên `biddingflow_dev`, không drop object, không commit throwaway audit script/instrumentation và không tạo fix/PR.

---

# Phụ lục A — Full PostgreSQL schema inventory

Nguồn: `information_schema` + `pg_catalog` read-only tại PostgreSQL 17.10/schema v42. Ký hiệu column: `NN` = NOT NULL, `NULL` = nullable, `DEFAULT ...` giữ expression catalog. PK/UNIQUE/FK là constraint definitions; index list gồm cả constraint-backed indexes. `Ownership/version/timestamps` được suy trực tiếp từ tên cột, không suy đoán semantics ngoài catalog.

### `account_subscriptions`

- Ownership: `user_id`; version: `none`; timestamps: `starts_at, expires_at, created_at, updated_at`.
- Columns (8): `user_id text NN`; `package_id text NN`; `status text NN DEFAULT 'active'::text`; `starts_at bigint NN`; `expires_at bigint NULL`; `revision bigint NN DEFAULT 1`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `account_subscriptions_pkey`: PRIMARY KEY (user_id).
- FK: `fk_account_subscriptions_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE; `fk_account_subscriptions_2_8f3a82d4`: FOREIGN KEY (package_id) REFERENCES goi_dich_vu(id) ON DELETE RESTRICT.
- Indexes (3): `account_subscriptions_pkey`, `idx_account_subscriptions_package`, `idx_account_subscriptions_status_expiry`.

### `ai_conversations`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `created_at, updated_at, deleted_at`.
- Columns (9): `id text NN`; `organization_id text NN`; `user_id text NN`; `mode text NN`; `title text NULL`; `status text NN DEFAULT 'active'::text`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `deleted_at timestamp with time zone NULL`.
- PK/UNIQUE: `ai_conversations_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_ai_conversations_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (3): `ai_conversations_pkey`, `idx_ai_conversations_user_workspace_updated`, `idx_ai_conversations_workspace_created`.

### `ai_feedback`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `created_at`.
- Columns (8): `id text NN`; `organization_id text NN`; `message_id text NN`; `user_id text NN`; `rating text NN`; `category text NN`; `comment text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ai_feedback_pkey`: PRIMARY KEY (organization_id, id); `ai_feedback_organization_id_message_id_user_id_key`: UNIQUE (organization_id, message_id, user_id).
- FK: `fk_ai_feedback_1_653b5d9d`: FOREIGN KEY (organization_id, message_id) REFERENCES ai_messages(organization_id, id) ON DELETE CASCADE; `fk_ai_feedback_2_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (3): `ai_feedback_organization_id_message_id_user_id_key`, `ai_feedback_pkey`, `idx_ai_feedback_user`.

### `ai_knowledge_chunks`

- Ownership: `none explicit`; version: `none`; timestamps: `created_at`.
- Columns (8): `id text NN`; `document_id text NN`; `chunk_index bigint NN`; `section text NN DEFAULT ''::text`; `page_number bigint NULL`; `content text NN`; `char_count bigint NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ai_knowledge_chunks_pkey`: PRIMARY KEY (id); `ai_knowledge_chunks_document_id_chunk_index_key`: UNIQUE (document_id, chunk_index).
- FK: `fk_ai_knowledge_chunks_1_0378c6b4`: FOREIGN KEY (document_id) REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE.
- Indexes (3): `ai_knowledge_chunks_document_id_chunk_index_key`, `ai_knowledge_chunks_pkey`, `idx_ai_knowledge_chunks_document`.

### `ai_knowledge_documents`

- Ownership: `organization_id`; version: `none`; timestamps: `approved_at, created_at, updated_at`.
- Columns (19): `id text NN`; `organization_id text NULL`; `title text NN`; `document_number text NN`; `issuing_authority text NN`; `document_type text NN`; `issued_date date NN`; `effective_from date NN`; `effective_to date NULL`; `version text NN`; `status text NN`; `confidentiality text NN`; `approved_by text NN`; `approved_at text NN DEFAULT CURRENT_TIMESTAMP`; `source_url text NN DEFAULT ''::text`; `source_filename text NN`; `content_hash text NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ai_knowledge_documents_pkey`: PRIMARY KEY (id); `ai_knowledge_documents_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: `fk_ai_knowledge_documents_1_7b4fe071`: FOREIGN KEY (approved_by) REFERENCES tai_khoan(id) ON DELETE RESTRICT.
- Indexes (7): `ai_knowledge_documents_organization_id_id_key`, `ai_knowledge_documents_pkey`, `idx_ai_knowledge_active_org`, `idx_ai_knowledge_approved_by`, `idx_ai_knowledge_one_global_active`, `idx_ai_knowledge_one_org_active`, `idx_ai_knowledge_scope_hash`.

### `ai_messages`

- Ownership: `organization_id`; version: `none`; timestamps: `created_at`.
- Columns (11): `id text NN`; `organization_id text NN`; `conversation_id text NN`; `role text NN`; `content text NN`; `status text NN DEFAULT 'completed'::text`; `model text NULL`; `input_tokens integer NULL`; `output_tokens integer NULL`; `error_code text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ai_messages_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_ai_messages_1_8d03fa38`: FOREIGN KEY (organization_id, conversation_id) REFERENCES ai_conversations(organization_id, id) ON DELETE CASCADE.
- Indexes (2): `ai_messages_pkey`, `idx_ai_messages_conversation_created`.

### `ai_tool_executions`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `created_at`.
- Columns (13): `id text NN`; `organization_id text NN`; `conversation_id text NN`; `message_id text NULL`; `user_id text NN`; `tool_name text NN`; `arguments_redacted text NN DEFAULT '{}'::text`; `result_summary text NULL`; `record_count integer NN DEFAULT 0`; `duration_ms integer NN DEFAULT 0`; `status text NN`; `error_code text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ai_tool_executions_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_ai_tool_executions_1_8d03fa38`: FOREIGN KEY (organization_id, conversation_id) REFERENCES ai_conversations(organization_id, id) ON DELETE CASCADE; `fk_ai_tool_executions_2_d6b81459`: FOREIGN KEY (organization_id, message_id) REFERENCES ai_messages(organization_id, id) ON DELETE SET NULL; `fk_ai_tool_executions_3_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (4): `ai_tool_executions_pkey`, `idx_ai_tool_executions_conversation_created`, `idx_ai_tool_executions_message`, `idx_ai_tool_executions_user`.

### `ai_usage_daily`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `updated_at`.
- Columns (9): `usage_date text NN`; `organization_id text NN`; `user_id text NN`; `request_count integer NN DEFAULT 0`; `input_tokens integer NN DEFAULT 0`; `output_tokens integer NN DEFAULT 0`; `tool_call_count integer NN DEFAULT 0`; `estimated_cost numeric(20,4) NN DEFAULT 0`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ai_usage_daily_pkey`: PRIMARY KEY (usage_date, organization_id, user_id).
- FK: `fk_ai_usage_daily_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (3): `ai_usage_daily_pkey`, `idx_ai_usage_daily_user`, `idx_ai_usage_daily_workspace_date`.

### `api_idempotency`

- Ownership: `none explicit`; version: `none`; timestamps: `created_at`.
- Columns (5): `actor_user_id text NN`; `operation text NN`; `idempotency_key text NN`; `response_json text NN`; `created_at integer NN`.
- PK/UNIQUE: `api_idempotency_pkey`: PRIMARY KEY (actor_user_id, operation, idempotency_key).
- FK: `fk_api_idempotency_1_c42edb88`: FOREIGN KEY (actor_user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (2): `api_idempotency_pkey`, `idx_api_idempotency_created`.

### `asset_journal`

- Ownership: `organization_id`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (12): `id text NN`; `organization_id text NN`; `client_mutation_id text NN`; `staging_path text NN`; `managed_path text NN`; `sha256 text NN`; `size_bytes integer NN`; `status text NN DEFAULT 'staged'::text`; `attempt_count integer NN DEFAULT 0`; `last_error_code text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `asset_journal_pkey`: PRIMARY KEY (organization_id, id); `asset_journal_organization_id_client_mutation_id_managed_pa_key`: UNIQUE (organization_id, client_mutation_id, managed_path).
- FK: none.
- Indexes (2): `asset_journal_organization_id_client_mutation_id_managed_pa_key`, `asset_journal_pkey`.

### `audit_chain_heads`

- Ownership: `none explicit`; version: `none`; timestamps: `updated_at`.
- Columns (5): `chain_id text NN`; `last_sequence bigint NN DEFAULT 0`; `last_log_id bigint NULL`; `last_hash text NN`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `audit_chain_heads_pkey`: PRIMARY KEY (chain_id).
- FK: none.
- Indexes (1): `audit_chain_heads_pkey`.

### `audit_log`

- Ownership: `organization_id`; version: `none`; timestamps: `created_at`.
- Columns (13): `id bigint NN`; `chain_id text NN`; `sequence bigint NN`; `actor_user_id text NULL`; `organization_id text NULL`; `action text NN`; `target_type text NULL`; `target_id text NULL`; `ip_address text NULL`; `metadata_json text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `previous_hash text NN`; `entry_hash text NN`.
- PK/UNIQUE: `audit_log_pkey`: PRIMARY KEY (id); `audit_log_chain_id_entry_hash_key`: UNIQUE (chain_id, entry_hash); `audit_log_chain_id_previous_hash_key`: UNIQUE (chain_id, previous_hash); `audit_log_chain_id_sequence_key`: UNIQUE (chain_id, sequence); `audit_log_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: `fk_audit_log_1_a1c4ef70`: FOREIGN KEY (chain_id) REFERENCES audit_chain_heads(chain_id) ON DELETE RESTRICT.
- Indexes (9): `audit_log_chain_id_entry_hash_key`, `audit_log_chain_id_previous_hash_key`, `audit_log_chain_id_sequence_key`, `audit_log_organization_id_id_key`, `audit_log_pkey`, `idx_audit_log_action_created`, `idx_audit_log_actor_created`, `idx_audit_log_owner_created`, `idx_audit_log_single_successor`.

### `auth_sessions`

- Ownership: `user_id`; version: `none`; timestamps: `created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, privileged_reauth_at`.
- Columns (12): `id text NN`; `user_id text NN`; `token_hash text NN`; `created_at integer NN`; `last_seen_at bigint NN`; `idle_expires_at bigint NN`; `absolute_expires_at bigint NN`; `revoked_at bigint NULL`; `remember_me smallint NN DEFAULT 0`; `device_info text NULL`; `privileged_reauth_at bigint NULL`; `active_role text NULL`.
- PK/UNIQUE: `auth_sessions_pkey`: PRIMARY KEY (id); `auth_sessions_token_hash_key`: UNIQUE (token_hash).
- FK: `fk_auth_sessions_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (8): `auth_sessions_pkey`, `auth_sessions_token_hash_key`, `idx_auth_sessions_active_absolute_expiry`, `idx_auth_sessions_active_idle_expiry`, `idx_auth_sessions_expiry`, `idx_auth_sessions_one_active_per_user`, `idx_auth_sessions_revoked_cleanup`, `idx_auth_sessions_user_active`.

### `bao_cao_danh_gia_nha_thau`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (12): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `vong_danh_gia_id text NN`; `thong_tin_mo_thau_id text NN`; `trang_thai text NN DEFAULT 'draft'::text`; `ket_luan text NULL`; `hoan_thanh_luc text NULL`; `extension_json text NN DEFAULT '{"schemaVersion":1}'::text`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `bao_cao_danh_gia_nha_thau_pkey`: PRIMARY KEY (organization_id, id); `bao_cao_danh_gia_nha_thau_organization_id_vong_danh_gia_id__key`: UNIQUE (organization_id, vong_danh_gia_id, thong_tin_mo_thau_id).
- FK: `fk_bao_cao_danh_gia_nha_thau_1_e123866c`: FOREIGN KEY (organization_id, vong_danh_gia_id) REFERENCES vong_danh_gia(organization_id, id) ON DELETE CASCADE; `fk_bao_cao_danh_gia_nha_thau_2_44248a15`: FOREIGN KEY (organization_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, id) ON DELETE CASCADE.
- Indexes (5): `bao_cao_danh_gia_nha_thau_organization_id_vong_danh_gia_id__key`, `bao_cao_danh_gia_nha_thau_pkey`, `idx_bao_cao_danh_gia_nha_thau_owner_type_owner`, `idx_detailed_evaluation_report_opening`, `idx_detailed_evaluation_report_round`.

### `cau_hinh_bien_word`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (9): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `ten_bien text NN`; `source_table text NN`; `source_column text NN`; `mo_ta text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `cau_hinh_bien_word_pkey`: PRIMARY KEY (organization_id, id); `cau_hinh_bien_word_organization_id_source_table_source_colu_key`: UNIQUE (organization_id, source_table, source_column); `cau_hinh_bien_word_organization_id_ten_bien_key`: UNIQUE (organization_id, ten_bien).
- FK: none.
- Indexes (4): `cau_hinh_bien_word_organization_id_source_table_source_colu_key`, `cau_hinh_bien_word_organization_id_ten_bien_key`, `cau_hinh_bien_word_pkey`, `idx_cau_hinh_bien_word_owner_type_owner`.

### `chi_tiet_danh_gia_nha_thau`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (17): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `bao_cao_danh_gia_nha_thau_id text NN`; `tieu_chi_danh_gia_id text NN`; `ket_qua text NN DEFAULT 'pending'::text`; `diem numeric(20,4) NULL`; `noi_dung_hsdt text NULL`; `nhan_xet text NULL`; `ly_do_khong_dat text NULL`; `yeu_cau_lam_ro text NULL`; `ket_qua_lam_ro text NULL`; `tai_lieu_tham_chieu text NULL`; `extension_json text NN DEFAULT '{"schemaVersion":1}'::text`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `chi_tiet_danh_gia_nha_thau_pkey`: PRIMARY KEY (organization_id, id); `chi_tiet_danh_gia_nha_thau_organization_id_bao_cao_danh_gia_key`: UNIQUE (organization_id, bao_cao_danh_gia_nha_thau_id, tieu_chi_danh_gia_id).
- FK: `fk_chi_tiet_danh_gia_nha_thau_1_f8eba641`: FOREIGN KEY (organization_id, bao_cao_danh_gia_nha_thau_id) REFERENCES bao_cao_danh_gia_nha_thau(organization_id, id) ON DELETE CASCADE; `fk_chi_tiet_danh_gia_nha_thau_2_fa6b404a`: FOREIGN KEY (organization_id, tieu_chi_danh_gia_id) REFERENCES tieu_chi_danh_gia(organization_id, id) ON DELETE CASCADE.
- Indexes (5): `chi_tiet_danh_gia_nha_thau_organization_id_bao_cao_danh_gia_key`, `chi_tiet_danh_gia_nha_thau_pkey`, `idx_chi_tiet_danh_gia_nha_thau_owner_type_owner`, `idx_detailed_evaluation_row_criterion`, `idx_detailed_evaluation_row_report`.

### `chu_dau_tu`

- Ownership: `organization_id, owner_type`; version: `phien_ban, is_latest, sync_version, row_version`; timestamps: `archived_at, created_at, updated_at`.
- Columns (28): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `id_goc text NULL`; `phien_ban bigint NN DEFAULT 0`; `is_latest smallint NN DEFAULT 1`; `archived_at timestamp with time zone NULL`; `ngay_ap_dung date NN DEFAULT CURRENT_DATE`; `ma_chu_dau_tu text NULL`; `ten_chu_dau_tu text NN`; `ten_viet_tat text NULL`; `ma_so_thue text NULL`; `chuc_vu_nguoi_dung_dau text NULL`; `dai_dien_cdt text NULL`; `chuc_vu_dai_dien text NULL`; `danh_xung text NULL DEFAULT 'Ông'::text`; `dia_chi text NULL`; `dia_chi_goc text NULL`; `so_dien_thoai text NULL`; `so_tai_khoan text NULL`; `noi_mo_tai_khoan text NULL`; `email text NULL`; `ma_qhns text NULL`; `co_quan_chu_quan text NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `chu_dau_tu_pkey`: PRIMARY KEY (organization_id, id).
- FK: none.
- Indexes (12): `chu_dau_tu_pkey`, `idx_chu_dau_tu_default_page`, `idx_chu_dau_tu_ma_chu_dau_tu_owner_latest_unique`, `idx_chu_dau_tu_ma_so_thue_owner_latest_unique`, `idx_chu_dau_tu_owner_latest`, `idx_chu_dau_tu_owner_root`, `idx_chu_dau_tu_owner_sync_version`, `idx_chu_dau_tu_owner_type_owner`, `idx_chu_dau_tu_owner_updated`, `idx_chu_dau_tu_search_trgm`, `idx_chu_dau_tu_unique_latest`, `idx_chu_dau_tu_unique_version`.

### `chuyen_gia`

- Ownership: `organization_id, owner_type`; version: `phien_ban, is_latest, sync_version, row_version`; timestamps: `archived_at, created_at, updated_at`.
- Columns (22): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `id_goc text NULL`; `phien_ban bigint NN DEFAULT 0`; `is_latest smallint NN DEFAULT 1`; `archived_at timestamp with time zone NULL`; `ho_ten text NN`; `so_chung_chi text NULL`; `ngay_cap_chung_chi date NULL`; `don_vi_cap_chung_chi text NULL`; `so_cccd text NULL`; `ngay_cap_cccd date NULL`; `noi_cap_cccd text NULL`; `anh_chung_chi text NULL`; `ten_anh_chung_chi text NULL`; `anh_chu_ky text NULL`; `ten_anh_chu_ky text NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `chuyen_gia_pkey`: PRIMARY KEY (organization_id, id).
- FK: none.
- Indexes (11): `chuyen_gia_pkey`, `idx_chuyen_gia_default_page`, `idx_chuyen_gia_owner_latest`, `idx_chuyen_gia_owner_root`, `idx_chuyen_gia_owner_sync_version`, `idx_chuyen_gia_owner_type_owner`, `idx_chuyen_gia_owner_updated`, `idx_chuyen_gia_search_trgm`, `idx_chuyen_gia_so_cccd_owner_latest_unique`, `idx_chuyen_gia_unique_latest`, `idx_chuyen_gia_unique_version`.

### `contractor_violation_cache`

- Ownership: `none explicit`; version: `none`; timestamps: `expires_at, updated_at`.
- Columns (9): `cache_key text NN`; `provider text NN`; `contractor_identifier text NN`; `tax_code text NULL`; `response_schema_version text NN`; `records_json text NN DEFAULT '[]'::text`; `payload_hash text NN DEFAULT ''::text`; `expires_at bigint NN`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `contractor_violation_cache_pkey`: PRIMARY KEY (cache_key).
- FK: none.
- Indexes (2): `contractor_violation_cache_pkey`, `idx_contractor_violation_cache_expiry`.

### `contractor_violation_checks`

- Ownership: `organization_id`; version: `none`; timestamps: `bid_closing_at, checked_at, created_at, updated_at`.
- Columns (21): `id text NN`; `organization_id text NN`; `package_id text NN`; `lot_id text NULL`; `bid_opening_record_id text NN`; `contractor_id text NULL`; `joint_venture_member_id text NULL`; `contractor_identifier text NN`; `tax_code text NULL`; `bid_closing_at timestamp with time zone NULL`; `checked_at timestamp with time zone NN`; `status text NN`; `matched_identity_type text NN`; `rule_version text NN`; `source_provider text NN`; `source_payload_hash text NN DEFAULT ''::text`; `source_records_json text NN DEFAULT '[]'::text`; `is_stale smallint NN DEFAULT 0`; `created_by text NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `contractor_violation_checks_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_contractor_violation_checks_1_e0ec6efd`: FOREIGN KEY (organization_id, package_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_contractor_violation_checks_2_607ac606`: FOREIGN KEY (organization_id, lot_id) REFERENCES goi_thau_phan_lo(organization_id, id) ON DELETE CASCADE; `fk_contractor_violation_checks_3_e5e21078`: FOREIGN KEY (organization_id, bid_opening_record_id) REFERENCES thong_tin_mo_thau(organization_id, id) ON DELETE CASCADE; `fk_contractor_violation_checks_4_dea01c24`: FOREIGN KEY (organization_id, contractor_id) REFERENCES nha_thau(organization_id, id) ON DELETE SET NULL; `fk_contractor_violation_checks_5_06de9e91`: FOREIGN KEY (organization_id, joint_venture_member_id) REFERENCES thong_tin_mo_thau_lien_danh_thanh_vien(organization_id, id) ON DELETE CASCADE; `fk_contractor_violation_checks_6_e063bafc`: FOREIGN KEY (created_by) REFERENCES tai_khoan(id) ON DELETE RESTRICT.
- Indexes (7): `contractor_violation_checks_pkey`, `idx_contractor_violation_check_contractor`, `idx_contractor_violation_check_creator`, `idx_contractor_violation_check_lot`, `idx_contractor_violation_check_member`, `idx_contractor_violation_check_package`, `idx_contractor_violation_check_target`.

### `danh_muc_trang_thai_hop_dong`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `created_at, updated_at`.
- Columns (9): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `name text NN`; `color text NN DEFAULT '#64748b'::text`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `danh_muc_trang_thai_hop_dong_pkey`: PRIMARY KEY (organization_id, id); `danh_muc_trang_thai_hop_dong_organization_id_name_key`: UNIQUE (organization_id, name).
- FK: none.
- Indexes (4): `danh_muc_trang_thai_hop_dong_organization_id_name_key`, `danh_muc_trang_thai_hop_dong_pkey`, `idx_danh_muc_trang_thai_hop_dong_owner_sync_version`, `idx_danh_muc_trang_thai_hop_dong_owner_type_owner`.

### `database_metadata`

- Ownership: `none explicit`; version: `schema_version`; timestamps: `created_at, updated_at`.
- Columns (6): `id integer NN`; `schema_version bigint NN`; `baseline text NN`; `installation_id text NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `database_metadata_pkey`: PRIMARY KEY (id).
- FK: none.
- Indexes (1): `database_metadata_pkey`.

### `deleted_records`

- Ownership: `organization_id`; version: `delete_version`; timestamps: `deleted_at`.
- Columns (9): `id bigint NN`; `table_name text NN`; `record_id text NN`; `organization_id text NN`; `delete_version bigint NULL DEFAULT 0`; `deleted_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `record_snapshot_json text NULL`; `delete_actor_user_id text NULL`; `delete_mutation_id text NULL`.
- PK/UNIQUE: `deleted_records_pkey`: PRIMARY KEY (id); `deleted_records_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: none.
- Indexes (6): `deleted_records_organization_id_id_key`, `deleted_records_pkey`, `idx_deleted_records_owner_delete_version`, `idx_deleted_records_owner_deleted`, `idx_deleted_records_owner_table`, `idx_deleted_records_unique_record`.

### `dinh_danh_ngoai`

- Ownership: `user_id`; version: `none`; timestamps: `created_at`.
- Columns (5): `issuer text NN`; `subject text NN`; `user_id text NN`; `email_norm text NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `dinh_danh_ngoai_pkey`: PRIMARY KEY (issuer, subject); `dinh_danh_ngoai_user_id_issuer_key`: UNIQUE (user_id, issuer).
- FK: `fk_dinh_danh_ngoai_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (3): `dinh_danh_ngoai_pkey`, `dinh_danh_ngoai_user_id_issuer_key`, `idx_dinh_danh_ngoai_user`.

### `document_export_capabilities`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (7): `organization_id text NN`; `user_id text NN`; `financial smallint NN DEFAULT 0`; `identity smallint NN DEFAULT 0`; `signature smallint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `document_export_capabilities_pkey`: PRIMARY KEY (organization_id, user_id).
- FK: `fk_document_export_capabilities_1_b06fce24`: FOREIGN KEY (user_id, organization_id) REFERENCES thanh_vien_to_chuc(user_id, organization_id) ON DELETE CASCADE.
- Indexes (2): `document_export_capabilities_pkey`, `idx_document_export_capabilities_user`.

### `document_jobs`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `cancelled_at, available_at, locked_at, completed_at, expires_at, created_at, updated_at`.
- Columns (19): `id text NN`; `operation text NN`; `organization_id text NULL`; `user_id text NULL`; `package_id text NULL`; `filename text NULL`; `content_type text NULL`; `cancelled_at integer NULL`; `status text NN DEFAULT 'pending'::text`; `attempt_count integer NN DEFAULT 0`; `available_at integer NN`; `locked_at integer NULL`; `locked_by text NULL`; `last_error_code text NULL`; `last_error_message text NULL`; `completed_at integer NULL`; `expires_at bigint NN`; `created_at integer NN`; `updated_at integer NN`.
- PK/UNIQUE: `document_jobs_pkey`: PRIMARY KEY (id); `document_jobs_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: none.
- Indexes (5): `document_jobs_organization_id_id_key`, `document_jobs_pkey`, `idx_document_jobs_claim`, `idx_document_jobs_expiry`, `idx_document_jobs_stale`.

### `dot_xu_ly_phan_lo`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `closed_at, created_at, updated_at`.
- Columns (17): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `sequence_no integer NN`; `procedure_kind text NN`; `approval_mode text NN DEFAULT 'CONSOLIDATED_APPROVAL'::text`; `status text NN DEFAULT 'DRAFT'::text`; `policy_version integer NN DEFAULT 1`; `staged_approval_authorized smallint NN DEFAULT 0`; `authorization_basis text NULL`; `created_by_id text NULL`; `closed_at timestamp with time zone NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `dot_xu_ly_phan_lo_pkey`: PRIMARY KEY (organization_id, id); `dot_xu_ly_phan_lo_organization_id_goi_thau_id_sequence_no_key`: UNIQUE (organization_id, goi_thau_id, sequence_no).
- FK: `fk_dot_xu_ly_phan_lo_1_6a807e28`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT; `fk_dot_xu_ly_phan_lo_2_ad881fe7`: FOREIGN KEY (created_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL.
- Indexes (5): `dot_xu_ly_phan_lo_organization_id_goi_thau_id_sequence_no_key`, `dot_xu_ly_phan_lo_pkey`, `idx_dot_xu_ly_phan_lo_owner_type_owner`, `idx_lot_batch_created_by`, `idx_lot_batch_package`.

### `dot_xu_ly_phan_lo_chi_tiet`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `created_at, updated_at`.
- Columns (13): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `batch_id text NN`; `lot_id text NN`; `current_stage text NN DEFAULT 'NOT_STARTED'::text`; `lifecycle_revision integer NN DEFAULT 1`; `outcome text NULL`; `is_active smallint NN DEFAULT 1`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `dot_xu_ly_phan_lo_chi_tiet_pkey`: PRIMARY KEY (organization_id, id); `dot_xu_ly_phan_lo_chi_tiet_organization_id_batch_id_lot_id_key`: UNIQUE (organization_id, batch_id, lot_id).
- FK: `fk_dot_xu_ly_phan_lo_chi_tiet_1_192e4922`: FOREIGN KEY (organization_id, batch_id) REFERENCES dot_xu_ly_phan_lo(organization_id, id) ON DELETE RESTRICT; `fk_dot_xu_ly_phan_lo_chi_tiet_2_a737ce95`: FOREIGN KEY (organization_id, lot_id) REFERENCES goi_thau_phan_lo(organization_id, id) ON DELETE RESTRICT.
- Indexes (6): `dot_xu_ly_phan_lo_chi_tiet_organization_id_batch_id_lot_id_key`, `dot_xu_ly_phan_lo_chi_tiet_pkey`, `idx_dot_xu_ly_phan_lo_chi_tiet_owner_type_owner`, `idx_lot_batch_detail_batch`, `idx_lot_batch_detail_lot`, `idx_lot_batch_detail_one_active`.

### `email_delivery_status`

- Ownership: `user_id`; version: `none`; timestamps: `next_attempt_at, locked_at, accepted_at, created_at, updated_at`.
- Columns (17): `id text NN`; `user_id text NN`; `purpose text NN`; `recipient_hash text NN`; `recipient_ciphertext text NULL`; `subject_ciphertext text NULL`; `body_ciphertext text NULL`; `sensitive_content smallint NN DEFAULT 1`; `status text NN DEFAULT 'pending'::text`; `attempt_count integer NN DEFAULT 0`; `last_error_code text NULL`; `next_attempt_at integer NULL`; `locked_at integer NULL`; `locked_by text NULL`; `accepted_at integer NULL`; `created_at integer NN`; `updated_at integer NN`.
- PK/UNIQUE: `email_delivery_status_pkey`: PRIMARY KEY (id).
- FK: `fk_email_delivery_status_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (4): `email_delivery_status_pkey`, `idx_email_delivery_retry`, `idx_email_delivery_stale`, `idx_email_delivery_user_purpose`.

### `goi_dich_vu`

- Ownership: `none explicit`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (11): `id text NN`; `ten_goi text NULL`; `gia_ca bigint NN`; `han_muc_nhan_su integer NN`; `document_export_word smallint NN DEFAULT 1`; `document_export_excel smallint NN DEFAULT 1`; `document_export_award_result_excel smallint NN DEFAULT 1`; `trang_thai text NN DEFAULT 'active'::text`; `mo_ta text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `goi_dich_vu_pkey`: PRIMARY KEY (id).
- FK: none.
- Indexes (1): `goi_dich_vu_pkey`.

### `goi_thau`

- Ownership: `organization_id, owner_type`; version: `phien_ban, is_latest, sync_version, row_version`; timestamps: `archived_at, created_at, updated_at`.
- Columns (55): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `id_goc text NULL`; `ma_goi_thau text NULL`; `phien_ban bigint NN DEFAULT 0`; `is_latest smallint NN DEFAULT 1`; `archived_at timestamp with time zone NULL`; `ke_hoach_id text NN`; `ten_goi_thau text NN`; `gia_goi_thau bigint NN`; `loai_hop_dong text NULL`; `hinh_thuc_lua_chon text NULL`; `phuong_thuc_lua_chon text NULL`; `qua_mang text NN DEFAULT 'Qua mạng'::text`; `trong_nuoc_quoc_te text NN DEFAULT 'Trong nước'::text`; `thoi_gian_thuc_hien text NN`; `nguon_von text NN`; `nha_thau_trung_thau_id text NULL`; `gia_trung_thau bigint NULL`; `linh_vuc text NULL`; `tuy_chon_mua_them text NULL DEFAULT 'Không'::text`; `thoi_gian_to_chuc text NN`; `thoi_gian_bat_dau_to_chuc text NN`; `phan_lo text NULL DEFAULT 'Không'::text`; `thoi_gian_dang_tai timestamp with time zone NULL`; `thoi_gian_dong_thau timestamp with time zone NULL`; `thoi_gian_mo_thau timestamp with time zone NULL`; `thoi_gian_mo_ehsdxtc timestamp with time zone NULL`; `so_quyet_dinh text NULL`; `ngay_quyet_dinh date NULL`; `so_quyet_dinh_ket_qua text NULL`; `ngay_quyet_dinh_ket_qua date NULL`; `thoi_gian_goi_thau text NULL`; `thoi_gian_hop_dong text NULL`; `gia_tri_dam_bao_du_thau bigint NULL`; `hieu_luc_hsdt integer NULL`; `hieu_luc_dam_bao_du_thau integer NULL`; `phuong_phap_danh_gia text NULL`; `trong_so_ky_thuat integer NULL`; `ty_le_bao_dam_hop_dong numeric(20,4) NULL`; `is_thuoc smallint NN DEFAULT 0`; `is_rebid smallint NN DEFAULT 0`; `rebid_from_package_id text NULL`; `trang_thai text NN DEFAULT 'PREPARING'::text`; `yeu_cau_tham_dinh_hsmt text NULL DEFAULT 'Không'::text`; `yeu_cau_tham_dinh_hsmt_code text NN DEFAULT 'UNDETERMINED'::text`; `so_bao_cao_tham_dinh_hsmt text NULL`; `ngay_bao_cao_tham_dinh_hsmt date NULL`; `so_to_trinh_hsmt text NULL`; `ngay_trinh_hsmt date NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `goi_thau_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_goi_thau_1_424294db`: FOREIGN KEY (organization_id, ke_hoach_id) REFERENCES ke_hoach_lcnt(organization_id, id) ON DELETE RESTRICT; `fk_goi_thau_2_5615f86a`: FOREIGN KEY (organization_id, nha_thau_trung_thau_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT; `fk_goi_thau_3_9bd1c9a6`: FOREIGN KEY (organization_id, rebid_from_package_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (15): `goi_thau_pkey`, `idx_goi_thau_default_page`, `idx_goi_thau_ke_hoach`, `idx_goi_thau_latest_date`, `idx_goi_thau_ma_goi_thau_owner_plan_latest_unique`, `idx_goi_thau_nha_thau_trung`, `idx_goi_thau_owner_latest`, `idx_goi_thau_owner_root`, `idx_goi_thau_owner_sync_version`, `idx_goi_thau_owner_type_owner`, `idx_goi_thau_owner_updated`, `idx_goi_thau_rebid_parent`, `idx_goi_thau_search_trgm`, `idx_goi_thau_unique_latest`, `idx_goi_thau_unique_plan_snapshot_version`.

### `goi_thau_chuyen_gia`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (9): `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `chuyen_gia_id text NN`; `loai text NN DEFAULT 'chuyen_gia'::text`; `chuc_vu text NULL`; `cong_viec text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `goi_thau_chuyen_gia_pkey`: PRIMARY KEY (organization_id, goi_thau_id, chuyen_gia_id, loai).
- FK: `fk_goi_thau_chuyen_gia_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_goi_thau_chuyen_gia_2_30c86ffc`: FOREIGN KEY (organization_id, chuyen_gia_id) REFERENCES chuyen_gia(organization_id, id) ON DELETE RESTRICT.
- Indexes (4): `goi_thau_chuyen_gia_pkey`, `idx_goi_thau_chuyen_gia_owner_cg`, `idx_goi_thau_chuyen_gia_owner_gt`, `idx_goi_thau_chuyen_gia_owner_type_owner`.

### `goi_thau_dieu_chinh_hsmt`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `published_at, archived_at, created_at, updated_at`.
- Columns (20): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `sequence bigint NN`; `reason text NN DEFAULT ''::text`; `submission_number text NN DEFAULT ''::text`; `submission_date text NULL`; `appraisal_report_number text NN DEFAULT ''::text`; `appraisal_report_date text NULL`; `approval_decision_number text NN DEFAULT ''::text`; `approval_decision_date text NULL`; `published_at text NULL`; `archived_at timestamp with time zone NULL`; `created_by_id text NULL`; `updated_by_id text NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `goi_thau_dieu_chinh_hsmt_pkey`: PRIMARY KEY (organization_id, id); `goi_thau_dieu_chinh_hsmt_organization_id_goi_thau_id_id_key`: UNIQUE (organization_id, goi_thau_id, id); `goi_thau_dieu_chinh_hsmt_organization_id_goi_thau_id_sequen_key`: UNIQUE (organization_id, goi_thau_id, sequence).
- FK: `fk_goi_thau_dieu_chinh_hsmt_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_goi_thau_dieu_chinh_hsmt_2_ad881fe7`: FOREIGN KEY (created_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL; `fk_goi_thau_dieu_chinh_hsmt_3_ba006352`: FOREIGN KEY (updated_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL.
- Indexes (7): `goi_thau_dieu_chinh_hsmt_organization_id_goi_thau_id_id_key`, `goi_thau_dieu_chinh_hsmt_organization_id_goi_thau_id_sequen_key`, `goi_thau_dieu_chinh_hsmt_pkey`, `idx_goi_thau_dieu_chinh_hsmt_created_by`, `idx_goi_thau_dieu_chinh_hsmt_owner_type_owner`, `idx_goi_thau_dieu_chinh_hsmt_package`, `idx_goi_thau_dieu_chinh_hsmt_updated_by`.

### `goi_thau_gia_han`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (10): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `thoi_gian_dong_thau timestamp with time zone NULL`; `ly_do_gia_han text NULL`; `sort_order integer NULL DEFAULT 0`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `goi_thau_gia_han_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_goi_thau_gia_han_1_6a807e28`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (3): `goi_thau_gia_han_pkey`, `idx_goi_thau_gia_han_owner_type_owner`, `idx_goi_thau_gia_han_parent`.

### `goi_thau_hang_hoa`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `created_at, updated_at`.
- Columns (23): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `phan_lo_id text NULL`; `ma_hang_hoa text NN`; `ten_hang_hoa text NN`; `nhom_hang_hoa text NULL`; `don_vi_tinh text NN`; `so_luong numeric(20,4) NN`; `yeu_cau_ky_thuat text NULL`; `ky_ma_hieu_tham_chieu text NULL`; `xuat_xu_yeu_cau text NULL`; `dia_diem_giao_hang text NULL`; `thoi_gian_giao_hang text NULL`; `don_gia_du_toan bigint NULL`; `thanh_tien_du_toan bigint NULL`; `ghi_chu text NULL`; `sort_order integer NN DEFAULT 0`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `goi_thau_hang_hoa_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_goi_thau_hang_hoa_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_goi_thau_hang_hoa_2_228adf1e`: FOREIGN KEY (organization_id, phan_lo_id) REFERENCES goi_thau_phan_lo(organization_id, id) ON DELETE RESTRICT.
- Indexes (7): `goi_thau_hang_hoa_pkey`, `idx_goi_thau_hang_hoa_code_by_lot`, `idx_goi_thau_hang_hoa_code_no_lot`, `idx_goi_thau_hang_hoa_lot_fk`, `idx_goi_thau_hang_hoa_owner_sync_version`, `idx_goi_thau_hang_hoa_owner_type_owner`, `idx_goi_thau_hang_hoa_parent`.

### `goi_thau_lam_ro`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (11): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `loai text NN`; `thoi_gian timestamp with time zone NULL`; `noi_dung text NULL`; `sort_order integer NULL DEFAULT 0`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `goi_thau_lam_ro_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_goi_thau_lam_ro_1_6a807e28`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (3): `goi_thau_lam_ro_pkey`, `idx_goi_thau_lam_ro_owner_type_owner`, `idx_goi_thau_lam_ro_parent`.

### `goi_thau_moc_tien_do`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (25): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `milestone_key text NN`; `instance_key text NN DEFAULT ''::text`; `source_entity_id text NN DEFAULT ''::text`; `ma_nhom text NN`; `ten_nhom text NN`; `ma_moc text NN`; `cong_viec text NN`; `don_vi_ban_hanh text NN DEFAULT ''::text`; `so_van_ban text NN DEFAULT ''::text`; `ngay_du_kien date NULL`; `ngay_thuc_te date NULL`; `ghi_chu text NN DEFAULT ''::text`; `source_key text NN DEFAULT ''::text`; `source_mode text NN DEFAULT 'MANUAL'::text`; `is_optional smallint NN DEFAULT 0`; `trang_thai text NN DEFAULT 'PENDING'::text`; `sort_order integer NN DEFAULT 0`; `template_version integer NN DEFAULT 2`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `goi_thau_moc_tien_do_pkey`: PRIMARY KEY (organization_id, id); `goi_thau_moc_tien_do_organization_id_goi_thau_id_milestone__key`: UNIQUE (organization_id, goi_thau_id, milestone_key, instance_key).
- FK: `fk_goi_thau_moc_tien_do_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE.
- Indexes (5): `goi_thau_moc_tien_do_organization_id_goi_thau_id_milestone__key`, `goi_thau_moc_tien_do_pkey`, `idx_goi_thau_moc_tien_do_owner_type_owner`, `idx_goi_thau_moc_tien_do_package`, `idx_goi_thau_moc_tien_do_status`.

### `goi_thau_phan_lo`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `archived_at, created_at, updated_at`.
- Columns (20): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `ma_phan_lo text NULL`; `ma_phan_lo_normalized text NN DEFAULT ''::text`; `ten_phan_lo text NULL`; `gia_tri_phan_lo bigint NULL`; `bao_dam_du_thau bigint NULL`; `thoi_gian_thuc_hien text NULL`; `nha_thau_trung_thau_id text NULL`; `gia_trung_thau bigint NULL`; `thoi_gian_goi_thau text NULL`; `thoi_gian_hop_dong text NULL`; `sort_order integer NULL DEFAULT 0`; `archived_at timestamp with time zone NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `goi_thau_phan_lo_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_goi_thau_phan_lo_1_6a807e28`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT; `fk_goi_thau_phan_lo_2_5615f86a`: FOREIGN KEY (organization_id, nha_thau_trung_thau_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (5): `goi_thau_phan_lo_pkey`, `idx_goi_thau_phan_lo_active_code`, `idx_goi_thau_phan_lo_owner_type_owner`, `idx_goi_thau_phan_lo_parent`, `idx_goi_thau_phan_lo_winner`.

### `goi_thau_tuy_chon_mua_them`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (13): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `hang_muc text NULL`; `don_vi text NULL`; `so_luong numeric(20,4) NULL`; `ty_le numeric(20,4) NULL`; `gia_tri_uoc_tinh bigint NULL`; `sort_order integer NULL DEFAULT 0`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `goi_thau_tuy_chon_mua_them_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_goi_thau_tuy_chon_mua_them_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE.
- Indexes (3): `goi_thau_tuy_chon_mua_them_pkey`, `idx_goi_thau_tuy_chon_mua_them_owner_type_owner`, `idx_goi_thau_tuy_chon_parent`.

### `hang_hoa_du_thau_nha_thau`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `uu_dai_manual_updated_at, created_at, updated_at`.
- Columns (47): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `thong_tin_mo_thau_id text NN`; `phan_lo_id text NULL`; `goi_thau_hang_hoa_id text NULL`; `stt_nguon text NN DEFAULT ''::text`; `ma_phan_lo_nguon text NN DEFAULT ''::text`; `ten_phan_lo_nguon text NN DEFAULT ''::text`; `danh_muc_hang_hoa text NN`; `ky_ma_hieu text NN DEFAULT ''::text`; `nhan_hieu text NN DEFAULT ''::text`; `nam_san_xuat text NN DEFAULT ''::text`; `xuat_xu text NN DEFAULT ''::text`; `hang_san_xuat text NN DEFAULT ''::text`; `cau_hinh_tinh_nang_ky_thuat text NN DEFAULT ''::text`; `don_vi_tinh text NN DEFAULT ''::text`; `khoi_luong numeric(20,4) NULL`; `ma_hs text NN DEFAULT ''::text`; `don_gia_du_thau bigint NULL`; `thanh_tien_du_thau bigint NULL`; `ma_uu_dai integer NN DEFAULT 0`; `he_so_uu_dai_goc_bp integer NN DEFAULT 0`; `he_so_cong_uu_dai_bp integer NN DEFAULT 0`; `gia_tri_co_so_sau_giam_gia bigint NULL`; `gia_tri_cong_uu_dai bigint NULL`; `thanh_tien_sau_uu_dai bigint NULL`; `uu_dai_source_sheet text NN DEFAULT ''::text`; `uu_dai_source_row integer NULL`; `uu_dai_match_method text NN DEFAULT 'no_15a'::text`; `uu_dai_match_status text NN DEFAULT 'matched'::text`; `uu_dai_source_payload text NN DEFAULT ''::text`; `uu_dai_manual_override smallint NN DEFAULT 0`; `uu_dai_manual_actor_id text NULL`; `uu_dai_manual_updated_at text NULL`; `uu_dai_manual_reason text NN DEFAULT ''::text`; `trang_thai_uu_dai text NN DEFAULT 'empty'::text`; `mapping_method text NN DEFAULT 'unmatched'::text`; `mapping_status text NN DEFAULT 'unmatched'::text`; `sort_order integer NN DEFAULT 0`; `import_batch_id text NN DEFAULT ''::text`; `is_draft smallint NN DEFAULT 1`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `hang_hoa_du_thau_nha_thau_pkey`: PRIMARY KEY (organization_id, id); `hang_hoa_du_thau_nha_thau_organization_id_thong_tin_mo_thau_key`: UNIQUE (organization_id, thong_tin_mo_thau_id, goi_thau_hang_hoa_id).
- FK: `fk_hang_hoa_du_thau_nha_thau_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_hang_hoa_du_thau_nha_thau_2_44248a15`: FOREIGN KEY (organization_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, id) ON DELETE CASCADE; `fk_hang_hoa_du_thau_nha_thau_3_228adf1e`: FOREIGN KEY (organization_id, phan_lo_id) REFERENCES goi_thau_phan_lo(organization_id, id) ON DELETE RESTRICT; `fk_hang_hoa_du_thau_nha_thau_4_51b0c6a0`: FOREIGN KEY (organization_id, goi_thau_hang_hoa_id) REFERENCES goi_thau_hang_hoa(organization_id, id) ON DELETE RESTRICT; `fk_hang_hoa_du_thau_nha_thau_5_5e20ed19`: FOREIGN KEY (uu_dai_manual_actor_id) REFERENCES tai_khoan(id) ON DELETE SET NULL; `fk_hang_hoa_du_thau_nha_thau_6_71c78384`: FOREIGN KEY (organization_id, goi_thau_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, goi_thau_id, id) ON DELETE CASCADE.
- Indexes (10): `hang_hoa_du_thau_nha_thau_organization_id_thong_tin_mo_thau_key`, `hang_hoa_du_thau_nha_thau_pkey`, `idx_bidder_goods_import_batch`, `idx_bidder_goods_lot_fk`, `idx_bidder_goods_manual_actor_fk`, `idx_bidder_goods_requirement`, `idx_bidder_goods_requirement_fk`, `idx_bidder_goods_scope`, `idx_hang_hoa_du_thau_nha_thau_owner_sync_version`, `idx_hang_hoa_du_thau_nha_thau_owner_type_owner`.

### `ho_so_nghiep_vu_lcnt`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `finalized_at, voided_at, created_at, updated_at`.
- Columns (23): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `batch_id text NN`; `artifact_type text NN`; `status text NN DEFAULT 'DRAFT'::text`; `document_number text NULL`; `document_date date NULL`; `revision bigint NN DEFAULT 1`; `snapshot_schema_version integer NN DEFAULT 1`; `snapshot_json text NN DEFAULT '{}'::text`; `scope_hash text NN`; `content_digest text NULL`; `finalized_by_id text NULL`; `finalized_at timestamp with time zone NULL`; `voided_by_id text NULL`; `voided_at timestamp with time zone NULL`; `void_reason text NULL`; `supersedes_id text NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `ho_so_nghiep_vu_lcnt_pkey`: PRIMARY KEY (organization_id, id); `ho_so_nghiep_vu_lcnt_organization_id_batch_id_artifact_type_key`: UNIQUE (organization_id, batch_id, artifact_type, revision).
- FK: `fk_ho_so_nghiep_vu_lcnt_1_192e4922`: FOREIGN KEY (organization_id, batch_id) REFERENCES dot_xu_ly_phan_lo(organization_id, id) ON DELETE RESTRICT; `fk_ho_so_nghiep_vu_lcnt_2_0911a3cc`: FOREIGN KEY (finalized_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL; `fk_ho_so_nghiep_vu_lcnt_3_fa5a55ee`: FOREIGN KEY (voided_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL; `fk_ho_so_nghiep_vu_lcnt_4_907c2643`: FOREIGN KEY (organization_id, supersedes_id) REFERENCES ho_so_nghiep_vu_lcnt(organization_id, id) ON DELETE RESTRICT.
- Indexes (7): `ho_so_nghiep_vu_lcnt_organization_id_batch_id_artifact_type_key`, `ho_so_nghiep_vu_lcnt_pkey`, `idx_ho_so_nghiep_vu_lcnt_owner_type_owner`, `idx_lcnt_artifact_batch`, `idx_lcnt_artifact_finalized_by`, `idx_lcnt_artifact_supersedes`, `idx_lcnt_artifact_voided_by`.

### `ho_so_nghiep_vu_lcnt_phan_lo`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (8): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `artifact_id text NN`; `lot_id text NN`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ho_so_nghiep_vu_lcnt_phan_lo_pkey`: PRIMARY KEY (organization_id, id); `ho_so_nghiep_vu_lcnt_phan_lo_organization_id_artifact_id_lo_key`: UNIQUE (organization_id, artifact_id, lot_id).
- FK: `fk_ho_so_nghiep_vu_lcnt_phan_lo_1_fab8ae2f`: FOREIGN KEY (organization_id, artifact_id) REFERENCES ho_so_nghiep_vu_lcnt(organization_id, id) ON DELETE RESTRICT; `fk_ho_so_nghiep_vu_lcnt_phan_lo_2_a737ce95`: FOREIGN KEY (organization_id, lot_id) REFERENCES goi_thau_phan_lo(organization_id, id) ON DELETE RESTRICT.
- Indexes (4): `ho_so_nghiep_vu_lcnt_phan_lo_organization_id_artifact_id_lo_key`, `ho_so_nghiep_vu_lcnt_phan_lo_pkey`, `idx_ho_so_nghiep_vu_lcnt_phan_lo_owner_type_owner`, `idx_lcnt_artifact_lot`.

### `hop_dong`

- Ownership: `organization_id, owner_type`; version: `phien_ban, is_latest, sync_version, row_version`; timestamps: `archived_at, created_at, updated_at`.
- Columns (28): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `id_goc text NULL`; `phien_ban bigint NN DEFAULT 0`; `is_latest smallint NN DEFAULT 1`; `archived_at timestamp with time zone NULL`; `ten_hop_dong text NN`; `so_hop_dong text NN`; `ngay_ky date NN`; `chu_dau_tu_id text NN`; `nha_thau_id text NN`; `ngay_thanh_ly date NULL`; `chu_dau_tu_thanh_ly_id text NULL`; `nha_thau_thanh_ly_id text NULL`; `ke_hoach_id text NN`; `gia_tri bigint NN`; `loai_hop_dong text NN`; `thoi_gian_thuc_hien text NN`; `trang_thai_hop_dong text NN DEFAULT 'Đang thực hiện'::text`; `phan_loai text NULL`; `co_qd_chi_dinh smallint NN DEFAULT 0`; `so_qd_chi_dinh text NULL`; `ngay_qd_chi_dinh date NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `hop_dong_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_hop_dong_1_9a07e634`: FOREIGN KEY (organization_id, chu_dau_tu_id) REFERENCES chu_dau_tu(organization_id, id) ON DELETE RESTRICT; `fk_hop_dong_2_fb48d995`: FOREIGN KEY (organization_id, nha_thau_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT; `fk_hop_dong_3_c2042c33`: FOREIGN KEY (organization_id, chu_dau_tu_thanh_ly_id) REFERENCES chu_dau_tu(organization_id, id) ON DELETE RESTRICT; `fk_hop_dong_4_2042d987`: FOREIGN KEY (organization_id, nha_thau_thanh_ly_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT; `fk_hop_dong_5_424294db`: FOREIGN KEY (organization_id, ke_hoach_id) REFERENCES ke_hoach_lcnt(organization_id, id) ON DELETE RESTRICT; `fk_hop_dong_6_57e8f291`: FOREIGN KEY (organization_id, trang_thai_hop_dong) REFERENCES danh_muc_trang_thai_hop_dong(organization_id, name) ON UPDATE CASCADE ON DELETE RESTRICT.
- Indexes (18): `hop_dong_pkey`, `idx_hop_dong_chu_dau_tu`, `idx_hop_dong_chu_dau_tu_thanh_ly`, `idx_hop_dong_default_page`, `idx_hop_dong_ke_hoach`, `idx_hop_dong_latest_date`, `idx_hop_dong_nha_thau`, `idx_hop_dong_nha_thau_thanh_ly`, `idx_hop_dong_owner_latest`, `idx_hop_dong_owner_root`, `idx_hop_dong_owner_sync_version`, `idx_hop_dong_owner_type_owner`, `idx_hop_dong_owner_updated`, `idx_hop_dong_search_trgm`, `idx_hop_dong_so_hop_dong_owner_latest_unique`, `idx_hop_dong_trang_thai`, `idx_hop_dong_unique_latest`, `idx_hop_dong_unique_version`.

### `hop_dong_goi_thau`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (6): `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `hop_dong_id text NN`; `goi_thau_id text NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `hop_dong_goi_thau_pkey`: PRIMARY KEY (organization_id, hop_dong_id, goi_thau_id).
- FK: `fk_hop_dong_goi_thau_1_e7b779a3`: FOREIGN KEY (organization_id, hop_dong_id) REFERENCES hop_dong(organization_id, id) ON DELETE RESTRICT; `fk_hop_dong_goi_thau_2_6a807e28`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (4): `hop_dong_goi_thau_pkey`, `idx_hop_dong_goi_thau_owner_gt`, `idx_hop_dong_goi_thau_owner_hd`, `idx_hop_dong_goi_thau_owner_type_owner`.

### `ke_hoach_cong_viec`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (13): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `ke_hoach_id text NN`; `loai text NN`; `ten_cong_viec text NULL`; `gia_tri bigint NULL`; `don_vi_thuc_hien text NULL`; `van_ban_phe_duyet text NULL`; `sort_order integer NULL DEFAULT 0`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ke_hoach_cong_viec_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_ke_hoach_cong_viec_1_424294db`: FOREIGN KEY (organization_id, ke_hoach_id) REFERENCES ke_hoach_lcnt(organization_id, id) ON DELETE RESTRICT.
- Indexes (3): `idx_ke_hoach_cong_viec_owner_type_owner`, `idx_ke_hoach_cong_viec_parent`, `ke_hoach_cong_viec_pkey`.

### `ke_hoach_lcnt`

- Ownership: `organization_id, owner_type`; version: `phien_ban, is_latest, sync_version, row_version`; timestamps: `archived_at, created_at, updated_at`.
- Columns (39): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `id_goc text NULL`; `ma_ke_hoach text NULL`; `ma_du_an text NULL`; `phien_ban bigint NN DEFAULT 0`; `is_latest smallint NN DEFAULT 1`; `archived_at timestamp with time zone NULL`; `ten_ke_hoach text NN`; `ten_du_an_du_toan text NN`; `loai_hinh_mua_sam text NN`; `chu_dau_tu_id text NN`; `don_vi_trinh_cdt text NULL`; `ten_viet_tat_don_vi_trinh text NULL`; `tong_muc_dau_tu bigint NULL`; `is_tong_muc_tu_dong smallint NN DEFAULT 0`; `ngay_phe_duyet date NN`; `quyet_dinh_phe_duyet text NN`; `thoi_gian_dang_tai timestamp with time zone NULL`; `nguon_von text NULL`; `thoi_gian_du_an text NULL`; `dia_diem_quy_mo text NULL`; `thong_tin_khac text NULL`; `so_qd_phe_duyet_du_an text NULL`; `ngay_qd_phe_duyet_du_an date NULL`; `co_quan_phe_duyet_du_an text NULL`; `phe_duyet text NULL`; `so_to_trinh_du_toan text NULL`; `ngay_trinh_du_toan date NULL`; `ngay_phe_duyet_du_toan date NULL`; `so_qd_phe_duyet_du_toan text NULL`; `so_to_trinh_ke_hoach text NULL`; `so_to_trinh_du_toan_ke_hoach text NULL`; `ngay_trinh_ke_hoach date NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `ke_hoach_lcnt_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_ke_hoach_lcnt_1_9a07e634`: FOREIGN KEY (organization_id, chu_dau_tu_id) REFERENCES chu_dau_tu(organization_id, id) ON DELETE RESTRICT.
- Indexes (13): `idx_ke_hoach_chu_dau_tu`, `idx_ke_hoach_lcnt_default_page`, `idx_ke_hoach_lcnt_latest_date`, `idx_ke_hoach_lcnt_ma_ke_hoach_owner_latest_unique`, `idx_ke_hoach_lcnt_owner_latest`, `idx_ke_hoach_lcnt_owner_root`, `idx_ke_hoach_lcnt_owner_sync_version`, `idx_ke_hoach_lcnt_owner_type_owner`, `idx_ke_hoach_lcnt_owner_updated`, `idx_ke_hoach_lcnt_search_trgm`, `idx_ke_hoach_lcnt_unique_latest`, `idx_ke_hoach_lcnt_unique_version`, `ke_hoach_lcnt_pkey`.

### `ket_qua_danh_gia_nha_thau`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (26): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `thong_tin_mo_thau_id text NN`; `danh_gia_hop_le text NULL`; `danh_gia_nang_luc text NULL`; `danh_gia_ky_thuat text NULL`; `danh_gia_tai_chinh text NULL`; `gia_xep_hang bigint NULL`; `gia_de_nghi_trung_thau bigint NULL`; `chap_thuan_gia_de_nghi_trung_thau_duoi_50 smallint NULL`; `danh_gia_ket_luan text NULL`; `diem numeric(20,4) NULL`; `ly_do_loai text NULL`; `lam_ro_hop_le text NULL`; `lam_ro_nang_luc text NULL`; `lam_ro_ky_thuat text NULL`; `lam_ro_tai_chinh text NULL`; `nguyen_nhan_khong_dat_hop_le text NULL`; `nguyen_nhan_khong_dat_nang_luc text NULL`; `nguyen_nhan_khong_dat_ky_thuat text NULL`; `danh_gia_luc text NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `ket_qua_danh_gia_nha_thau_pkey`: PRIMARY KEY (organization_id, id); `ket_qua_danh_gia_nha_thau_organization_id_thong_tin_mo_thau_key`: UNIQUE (organization_id, thong_tin_mo_thau_id).
- FK: `fk_ket_qua_danh_gia_nha_thau_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_ket_qua_danh_gia_nha_thau_2_44248a15`: FOREIGN KEY (organization_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, id) ON DELETE CASCADE; `fk_ket_qua_danh_gia_nha_thau_3_71c78384`: FOREIGN KEY (organization_id, goi_thau_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, goi_thau_id, id) ON DELETE CASCADE.
- Indexes (6): `idx_ket_qua_danh_gia_nha_thau_owner_type_owner`, `idx_ket_qua_danh_gia_opening`, `idx_ket_qua_goi_thau`, `idx_ket_qua_goi_thau_opening`, `ket_qua_danh_gia_nha_thau_organization_id_thong_tin_mo_thau_key`, `ket_qua_danh_gia_nha_thau_pkey`.

### `ma_tran_phan_quyen`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `created_at, updated_at`.
- Columns (15): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `emp_id text NN`; `kehoach text NN DEFAULT ''::text`; `goithau text NN DEFAULT ''::text`; `chudautu text NN DEFAULT ''::text`; `nhathau text NN DEFAULT ''::text`; `chuyengia text NN DEFAULT ''::text`; `hopdong text NN DEFAULT ''::text`; `thongtinmothau text NN DEFAULT ''::text`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `ma_tran_phan_quyen_pkey`: PRIMARY KEY (organization_id, id); `ma_tran_phan_quyen_organization_id_emp_id_key`: UNIQUE (organization_id, emp_id).
- FK: none.
- Indexes (4): `idx_ma_tran_phan_quyen_owner_sync_version`, `idx_ma_tran_phan_quyen_owner_type_owner`, `ma_tran_phan_quyen_organization_id_emp_id_key`, `ma_tran_phan_quyen_pkey`.

### `nha_thau`

- Ownership: `organization_id, owner_type`; version: `phien_ban, is_latest, sync_version, row_version`; timestamps: `archived_at, created_at, updated_at`.
- Columns (29): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `id_goc text NULL`; `phien_ban bigint NN DEFAULT 0`; `is_latest smallint NN DEFAULT 1`; `archived_at timestamp with time zone NULL`; `ngay_ap_dung date NN DEFAULT CURRENT_DATE`; `ma_nha_thau text NULL`; `ten_nha_thau text NN`; `ten_viet_tat text NULL`; `loai_nha_thau text NULL`; `ma_so_thue text NULL`; `nguoi_dai_dien text NULL`; `chuc_vu_dai_dien text NULL`; `danh_xung text NULL DEFAULT 'Ông'::text`; `so_dien_thoai text NULL`; `email text NULL`; `dia_chi text NULL`; `dia_chi_goc text NULL`; `so_tai_khoan text NULL`; `noi_mo_tai_khoan text NULL`; `ma_ngan_hang text NULL`; `anh_dau text NULL`; `ten_anh_dau text NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `nha_thau_pkey`: PRIMARY KEY (organization_id, id).
- FK: none.
- Indexes (12): `idx_nha_thau_default_page`, `idx_nha_thau_ma_nha_thau_owner_latest_unique`, `idx_nha_thau_ma_so_thue_owner_latest_unique`, `idx_nha_thau_owner_latest`, `idx_nha_thau_owner_root`, `idx_nha_thau_owner_sync_version`, `idx_nha_thau_owner_type_owner`, `idx_nha_thau_owner_updated`, `idx_nha_thau_search_trgm`, `idx_nha_thau_unique_latest`, `idx_nha_thau_unique_version`, `nha_thau_pkey`.

### `nha_thau_lien_danh_thanh_vien`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (22): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `nha_thau_id text NN`; `thanh_vien_nha_thau_id text NN`; `ten_nha_thau text NULL`; `ma_nha_thau text NULL`; `ma_so_thue text NULL`; `vai_tro text NN`; `nguoi_dai_dien text NULL`; `danh_xung text NULL`; `so_dien_thoai text NULL`; `email text NULL`; `dia_chi text NULL`; `dia_chi_goc text NULL`; `so_tai_khoan text NULL`; `noi_mo_tai_khoan text NULL`; `ma_ngan_hang text NULL`; `sort_order integer NULL DEFAULT 0`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `nha_thau_lien_danh_thanh_vien_pkey`: PRIMARY KEY (organization_id, id); `nha_thau_lien_danh_thanh_vien_organization_id_nha_thau_id_t_key`: UNIQUE (organization_id, nha_thau_id, thanh_vien_nha_thau_id).
- FK: `fk_nha_thau_lien_danh_thanh_vien_1_fb48d995`: FOREIGN KEY (organization_id, nha_thau_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT; `fk_nha_thau_lien_danh_thanh_vien_2_3449692b`: FOREIGN KEY (organization_id, thanh_vien_nha_thau_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (6): `idx_nha_thau_lien_danh_member`, `idx_nha_thau_lien_danh_one_leader`, `idx_nha_thau_lien_danh_parent`, `idx_nha_thau_lien_danh_thanh_vien_owner_type_owner`, `nha_thau_lien_danh_thanh_vien_organization_id_nha_thau_id_t_key`, `nha_thau_lien_danh_thanh_vien_pkey`.

### `nha_thau_tham_du_mo_thau`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `created_at`.
- Columns (9): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `thong_tin_mo_thau_id text NN`; `goi_thau_id text NN`; `lot_scope text NN`; `nha_thau_goc_id text NN`; `nha_thau_phien_ban_id text NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `nha_thau_tham_du_mo_thau_pkey`: PRIMARY KEY (organization_id, id); `nha_thau_tham_du_mo_thau_organization_id_goi_thau_id_lot_sc_key`: UNIQUE (organization_id, goi_thau_id, lot_scope, nha_thau_goc_id); `nha_thau_tham_du_mo_thau_organization_id_thong_tin_mo_thau__key`: UNIQUE (organization_id, thong_tin_mo_thau_id, nha_thau_goc_id).
- FK: `fk_nha_thau_tham_du_mo_thau_1_44248a15`: FOREIGN KEY (organization_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, id) ON DELETE CASCADE; `fk_nha_thau_tham_du_mo_thau_2_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_nha_thau_tham_du_mo_thau_3_36d9f8dc`: FOREIGN KEY (organization_id, nha_thau_goc_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT; `fk_nha_thau_tham_du_mo_thau_4_788daa62`: FOREIGN KEY (organization_id, nha_thau_phien_ban_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (7): `idx_nha_thau_tham_du_mo_thau_bid`, `idx_nha_thau_tham_du_mo_thau_owner_type_owner`, `idx_nha_thau_tham_du_root`, `idx_nha_thau_tham_du_version`, `nha_thau_tham_du_mo_thau_organization_id_goi_thau_id_lot_sc_key`, `nha_thau_tham_du_mo_thau_organization_id_thong_tin_mo_thau__key`, `nha_thau_tham_du_mo_thau_pkey`.

### `nhat_ky_thuc_hien`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `occurred_at, created_at`.
- Columns (16): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `target_type text NN`; `target_id text NN`; `target_root_id text NN`; `action text NN`; `actor_user_id text NULL`; `actor_name_snapshot text NN DEFAULT 'Không xác định'::text`; `occurred_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `related_document_id text NULL`; `related_assignment_id text NULL`; `client_mutation_id text NULL`; `request_id text NULL`; `metadata_json text NN DEFAULT '{}'::text`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `nhat_ky_thuc_hien_pkey`: PRIMARY KEY (organization_id, id).
- FK: none.
- Indexes (5): `idx_activity_actor_timeline`, `idx_activity_mutation_dedupe`, `idx_activity_target_timeline`, `idx_nhat_ky_thuc_hien_owner_type_owner`, `nhat_ky_thuc_hien_pkey`.

### `nhom_phu_thuoc_phan_lo`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `created_at, updated_at`.
- Columns (13): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `dependency_kind text NN`; `reason text NN`; `must_move_together smallint NN DEFAULT 1`; `policy_version integer NN DEFAULT 1`; `is_active smallint NN DEFAULT 1`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `nhom_phu_thuoc_phan_lo_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_nhom_phu_thuoc_phan_lo_1_6a807e28`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (3): `idx_lot_dependency_package`, `idx_nhom_phu_thuoc_phan_lo_owner_type_owner`, `nhom_phu_thuoc_phan_lo_pkey`.

### `nhom_phu_thuoc_phan_lo_thanh_vien`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (8): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `dependency_group_id text NN`; `lot_id text NN`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `nhom_phu_thuoc_phan_lo_thanh_vien_pkey`: PRIMARY KEY (organization_id, id); `nhom_phu_thuoc_phan_lo_thanh__organization_id_dependency_gr_key`: UNIQUE (organization_id, dependency_group_id, lot_id).
- FK: `fk_nhom_phu_thuoc_phan_lo_thanh_vien_1_af898daa`: FOREIGN KEY (organization_id, dependency_group_id) REFERENCES nhom_phu_thuoc_phan_lo(organization_id, id) ON DELETE CASCADE; `fk_nhom_phu_thuoc_phan_lo_thanh_vien_2_a737ce95`: FOREIGN KEY (organization_id, lot_id) REFERENCES goi_thau_phan_lo(organization_id, id) ON DELETE RESTRICT.
- Indexes (5): `idx_lot_dependency_member_group`, `idx_lot_dependency_member_lot`, `idx_nhom_phu_thuoc_phan_lo_thanh_vien_owner_type_owner`, `nhom_phu_thuoc_phan_lo_thanh__organization_id_dependency_gr_key`, `nhom_phu_thuoc_phan_lo_thanh_vien_pkey`.

### `organization_subscriptions`

- Ownership: `organization_id`; version: `none`; timestamps: `starts_at, expires_at, created_at, updated_at`.
- Columns (9): `organization_id text NN`; `package_id text NN`; `status text NN DEFAULT 'active'::text`; `starts_at bigint NN`; `expires_at bigint NULL`; `member_quota integer NN`; `revision bigint NN DEFAULT 1`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `organization_subscriptions_pkey`: PRIMARY KEY (organization_id).
- FK: `fk_organization_subscriptions_1_900fddb1`: FOREIGN KEY (organization_id) REFERENCES to_chuc(id) ON DELETE CASCADE; `fk_organization_subscriptions_2_8f3a82d4`: FOREIGN KEY (package_id) REFERENCES goi_dich_vu(id) ON DELETE RESTRICT.
- Indexes (3): `idx_organization_subscriptions_package`, `idx_organization_subscriptions_status_expiry`, `organization_subscriptions_pkey`.

### `partner_enrichment_jobs`

- Ownership: `organization_id`; version: `none`; timestamps: `available_at, locked_at, created_at, updated_at`.
- Columns (11): `id text NN`; `organization_id text NN`; `contractor_id text NN`; `status text NN DEFAULT 'pending'::text`; `attempt_count integer NN DEFAULT 0`; `available_at integer NN`; `locked_at integer NULL`; `locked_by text NULL`; `last_error_code text NULL`; `created_at integer NN`; `updated_at integer NN`.
- PK/UNIQUE: `partner_enrichment_jobs_pkey`: PRIMARY KEY (organization_id, id); `partner_enrichment_jobs_organization_id_contractor_id_key`: UNIQUE (organization_id, contractor_id).
- FK: `fk_partner_enrichment_jobs_1_fdbc401e`: FOREIGN KEY (organization_id, contractor_id) REFERENCES nha_thau(organization_id, id) ON DELETE CASCADE.
- Indexes (4): `idx_partner_enrichment_claim`, `idx_partner_enrichment_stale`, `partner_enrichment_jobs_organization_id_contractor_id_key`, `partner_enrichment_jobs_pkey`.

### `partner_lookup_cache`

- Ownership: `none explicit`; version: `none`; timestamps: `expires_at, updated_at`.
- Columns (5): `cache_key text NN`; `result_json text NULL`; `found smallint NN`; `expires_at bigint NN`; `updated_at integer NN`.
- PK/UNIQUE: `partner_lookup_cache_pkey`: PRIMARY KEY (cache_key).
- FK: none.
- Indexes (2): `idx_partner_lookup_cache_expiry`, `partner_lookup_cache_pkey`.

### `partner_upstream_health`

- Ownership: `none explicit`; version: `none`; timestamps: `updated_at`.
- Columns (5): `upstream text NN`; `failure_count integer NN DEFAULT 0`; `opened_until integer NN DEFAULT 0`; `probe_locked_until integer NN DEFAULT 0`; `updated_at integer NN`.
- PK/UNIQUE: `partner_upstream_health_pkey`: PRIMARY KEY (upstream).
- FK: none.
- Indexes (2): `idx_partner_upstream_open`, `partner_upstream_health_pkey`.

### `password_reset_tokens`

- Ownership: `user_id`; version: `none`; timestamps: `expires_at, used_at, created_at`.
- Columns (7): `id text NN`; `user_id text NN`; `token_hash text NN`; `expires_at bigint NN`; `used_at bigint NULL`; `requested_ip text NULL`; `created_at integer NN`.
- PK/UNIQUE: `password_reset_tokens_pkey`: PRIMARY KEY (id); `password_reset_tokens_token_hash_key`: UNIQUE (token_hash).
- FK: `fk_password_reset_tokens_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (4): `idx_password_reset_expires`, `idx_password_reset_user_active`, `password_reset_tokens_pkey`, `password_reset_tokens_token_hash_key`.

### `pending_email_changes`

- Ownership: `user_id`; version: `none`; timestamps: `requested_at, expires_at, verified_at`.
- Columns (9): `user_id text NN`; `current_email_norm text NN`; `pending_email text NN`; `pending_email_norm text NN`; `otp_hash text NN`; `requested_at bigint NN`; `expires_at bigint NN`; `verified_at bigint NULL`; `requested_ip text NULL`.
- PK/UNIQUE: `pending_email_changes_pkey`: PRIMARY KEY (user_id); `pending_email_changes_pending_email_norm_key`: UNIQUE (pending_email_norm).
- FK: `fk_pending_email_changes_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (3): `idx_pending_email_changes_expiry`, `pending_email_changes_pending_email_norm_key`, `pending_email_changes_pkey`.

### `phan_cong_nhan_su`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `created_at, updated_at`.
- Columns (10): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `id_nhan_vien text NN`; `id_muc_tieu text NN`; `loai_doi_tuong text NN`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `phan_cong_nhan_su_pkey`: PRIMARY KEY (organization_id, id); `phan_cong_nhan_su_organization_id_id_nhan_vien_id_muc_tieu__key`: UNIQUE (organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong).
- FK: `fk_phan_cong_nhan_su_1_62576cf9`: FOREIGN KEY (id_nhan_vien) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (7): `idx_phan_cong_nhan_su_employee`, `idx_phan_cong_nhan_su_owner_sync_version`, `idx_phan_cong_nhan_su_owner_type_owner`, `idx_phan_cong_owner_assignee`, `idx_phan_cong_owner_target`, `phan_cong_nhan_su_organization_id_id_nhan_vien_id_muc_tieu__key`, `phan_cong_nhan_su_pkey`.

### `phan_cong_nhan_su_lich_su`

- Ownership: `organization_id`; version: `none`; timestamps: `assigned_at, ended_at`.
- Columns (11): `id bigint NN`; `organization_id text NN`; `assignment_id text NN`; `id_nhan_vien text NN`; `id_muc_tieu text NN`; `loai_doi_tuong text NN`; `assigned_at timestamp with time zone NULL`; `ended_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `ended_by text NULL`; `successor_user_id text NULL`; `reason text NN DEFAULT 'member_left'::text`.
- PK/UNIQUE: `phan_cong_nhan_su_lich_su_pkey`: PRIMARY KEY (id); `phan_cong_nhan_su_lich_su_organization_id_assignment_id_end_key`: UNIQUE (organization_id, assignment_id, ended_at); `phan_cong_nhan_su_lich_su_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: none.
- Indexes (4): `idx_assignment_history_member`, `phan_cong_nhan_su_lich_su_organization_id_assignment_id_end_key`, `phan_cong_nhan_su_lich_su_organization_id_id_key`, `phan_cong_nhan_su_lich_su_pkey`.

### `rate_limit_buckets`

- Ownership: `none explicit`; version: `none`; timestamps: `window_started_at, expires_at`.
- Columns (4): `bucket_key text NN`; `window_started_at bigint NN`; `attempt_count integer NN`; `expires_at bigint NN`.
- PK/UNIQUE: `rate_limit_buckets_pkey`: PRIMARY KEY (bucket_key).
- FK: none.
- Indexes (2): `idx_rate_limit_expires`, `rate_limit_buckets_pkey`.

### `record_edit_ownership`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `created_at`.
- Columns (5): `organization_id text NN`; `table_name text NN`; `record_id text NN`; `user_id text NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `record_edit_ownership_pkey`: PRIMARY KEY (organization_id, table_name, record_id).
- FK: `fk_record_edit_ownership_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (3): `idx_record_edit_ownership_by_user`, `idx_record_edit_ownership_user`, `record_edit_ownership_pkey`.

### `sync_metadata`

- Ownership: `organization_id`; version: `current_version, min_available_version`; timestamps: `updated_at`.
- Columns (4): `organization_id text NN`; `current_version bigint NN DEFAULT 0`; `min_available_version bigint NN DEFAULT 0`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `sync_metadata_pkey`: PRIMARY KEY (organization_id).
- FK: none.
- Indexes (1): `sync_metadata_pkey`.

### `sync_mutations`

- Ownership: `organization_id`; version: `none`; timestamps: `created_at`.
- Columns (6): `organization_id text NN`; `actor_user_id text NN`; `client_mutation_id text NN`; `request_hash text NULL`; `response_json text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `sync_mutations_pkey`: PRIMARY KEY (organization_id, actor_user_id, client_mutation_id).
- FK: `fk_sync_mutations_1_c42edb88`: FOREIGN KEY (actor_user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (3): `idx_sync_mutations_actor`, `idx_sync_mutations_owner_created`, `sync_mutations_pkey`.

### `tai_khoan`

- Ownership: `none explicit`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (15): `id text NN`; `ten_dang_nhap text NULL`; `username_norm text NULL`; `mat_khau text NN`; `ho_ten text NULL`; `vai_tro text NN DEFAULT 'user'::text`; `email text NN`; `email_norm text NN`; `anh_dai_dien text NULL`; `da_xac_minh smallint NN DEFAULT 0`; `ma_xac_minh text NULL`; `han_xac_minh integer NULL`; `username_da_dat smallint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `tai_khoan_pkey`: PRIMARY KEY (id); `tai_khoan_email_norm_key`: UNIQUE (email_norm); `tai_khoan_username_norm_key`: UNIQUE (username_norm).
- FK: none.
- Indexes (3): `tai_khoan_email_norm_key`, `tai_khoan_pkey`, `tai_khoan_username_norm_key`.

### `tai_lieu_goi_thau`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `uploaded_at, created_at, updated_at`.
- Columns (15): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `evaluation_batch_id text NULL`; `document_type text NN`; `original_filename text NN`; `storage_key text NN`; `content_type text NN`; `size_bytes integer NN`; `sha256 text NN`; `uploaded_by_id text NULL`; `uploaded_at text NN DEFAULT CURRENT_TIMESTAMP`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `tai_lieu_goi_thau_pkey`: PRIMARY KEY (organization_id, id).
- FK: `fk_tai_lieu_goi_thau_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE; `fk_tai_lieu_goi_thau_2_a82bc0bc`: FOREIGN KEY (organization_id, evaluation_batch_id) REFERENCES dot_xu_ly_phan_lo(organization_id, id) ON DELETE RESTRICT; `fk_tai_lieu_goi_thau_3_4532842d`: FOREIGN KEY (uploaded_by_id) REFERENCES tai_khoan(id) ON DELETE SET NULL.
- Indexes (7): `idx_package_documents_batch_fk`, `idx_package_documents_batch_type`, `idx_package_documents_general_type`, `idx_package_documents_package`, `idx_package_documents_uploader`, `idx_tai_lieu_goi_thau_owner_type_owner`, `tai_lieu_goi_thau_pkey`.

### `thanh_vien_to_chuc`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `left_at, created_at, updated_at`.
- Columns (10): `user_id text NN`; `organization_id text NN`; `vai_tro_trong_to_chuc text NN DEFAULT 'employee'::text`; `ten_nhan_su text NULL`; `so_dien_thoai text NULL`; `trang_thai_thanh_vien text NN DEFAULT 'active'::text`; `left_at timestamp with time zone NULL`; `left_by text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `thanh_vien_to_chuc_pkey`: PRIMARY KEY (user_id, organization_id).
- FK: `fk_thanh_vien_to_chuc_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE; `fk_thanh_vien_to_chuc_2_900fddb1`: FOREIGN KEY (organization_id) REFERENCES to_chuc(id) ON DELETE CASCADE.
- Indexes (2): `idx_thanh_vien_to_chuc_to_chuc`, `thanh_vien_to_chuc_pkey`.

### `thong_tin_mo_thau`

- Ownership: `organization_id, owner_type`; version: `sync_version, row_version`; timestamps: `archived_at, violation_bid_closing_at, violation_checked_at, created_at, updated_at`.
- Columns (32): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `archived_at timestamp with time zone NULL`; `goi_thau_id text NN`; `nha_thau_id text NN`; `ma_phan_lo text NN DEFAULT ''::text`; `ma_phan_lo_normalized text NN DEFAULT ''::text`; `ten_phan_lo text NULL`; `ma_dinh_danh text NULL`; `gia_du_thau bigint NULL`; `ty_le_giam_gia numeric(20,4) NULL`; `gia_sau_giam_gia bigint NULL`; `tong_gia_tri_cong_uu_dai bigint NULL`; `gia_so_sanh_sau_uu_dai bigint NULL`; `gia_danh_gia_sau_uu_dai bigint NULL`; `trang_thai_tinh_uu_dai text NN DEFAULT 'empty'::text`; `uu_dai_tinh_luc text NULL`; `uu_dai_input_hash text NN DEFAULT ''::text`; `hieu_luc_hsdt integer NULL`; `gia_tri_dam_bao bigint NULL`; `hieu_luc_bao_dam_ngay integer NULL`; `thoi_gian_thuc_hien text NULL`; `ten_nha_thau text NULL`; `loai_nha_thau text NULL`; `violation_status text NN DEFAULT 'NOT_CHECKED'::text`; `violation_bid_closing_at timestamp with time zone NULL`; `violation_checked_at timestamp with time zone NULL`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `row_version bigint NN DEFAULT 1`.
- PK/UNIQUE: `thong_tin_mo_thau_pkey`: PRIMARY KEY (organization_id, id); `thong_tin_mo_thau_organization_id_goi_thau_id_id_key`: UNIQUE (organization_id, goi_thau_id, id).
- FK: `fk_thong_tin_mo_thau_1_6a807e28`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE RESTRICT; `fk_thong_tin_mo_thau_2_fb48d995`: FOREIGN KEY (organization_id, nha_thau_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (7): `idx_thong_tin_mo_thau_active_business_key`, `idx_thong_tin_mo_thau_goi_thau`, `idx_thong_tin_mo_thau_nha_thau`, `idx_thong_tin_mo_thau_owner_sync_version`, `idx_thong_tin_mo_thau_owner_type_owner`, `thong_tin_mo_thau_organization_id_goi_thau_id_id_key`, `thong_tin_mo_thau_pkey`.

### `thong_tin_mo_thau_lien_danh_thanh_vien`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `violation_bid_closing_at, violation_checked_at, created_at, updated_at`.
- Columns (25): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `thong_tin_mo_thau_id text NN`; `thanh_vien_nha_thau_id text NN`; `ten_nha_thau text NULL`; `ma_nha_thau text NULL`; `ma_so_thue text NULL`; `vai_tro text NN`; `nguoi_dai_dien text NULL`; `danh_xung text NULL`; `so_dien_thoai text NULL`; `email text NULL`; `dia_chi text NULL`; `dia_chi_goc text NULL`; `so_tai_khoan text NULL`; `noi_mo_tai_khoan text NULL`; `ma_ngan_hang text NULL`; `violation_status text NN DEFAULT 'NOT_CHECKED'::text`; `violation_bid_closing_at timestamp with time zone NULL`; `violation_checked_at timestamp with time zone NULL`; `sort_order integer NULL DEFAULT 0`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `thong_tin_mo_thau_lien_danh_thanh_vien_pkey`: PRIMARY KEY (organization_id, id); `thong_tin_mo_thau_lien_danh_t_organization_id_thong_tin_mo__key`: UNIQUE (organization_id, thong_tin_mo_thau_id, thanh_vien_nha_thau_id).
- FK: `fk_thong_tin_mo_thau_lien_danh_thanh_vien_1_44248a15`: FOREIGN KEY (organization_id, thong_tin_mo_thau_id) REFERENCES thong_tin_mo_thau(organization_id, id) ON DELETE CASCADE; `fk_thong_tin_mo_thau_lien_danh_thanh_vien_2_3449692b`: FOREIGN KEY (organization_id, thanh_vien_nha_thau_id) REFERENCES nha_thau(organization_id, id) ON DELETE RESTRICT.
- Indexes (6): `idx_mo_thau_lien_danh_member`, `idx_mo_thau_lien_danh_one_leader`, `idx_mo_thau_lien_danh_parent`, `idx_thong_tin_mo_thau_lien_danh_thanh_vien_owner_type_owner`, `thong_tin_mo_thau_lien_danh_t_organization_id_thong_tin_mo__key`, `thong_tin_mo_thau_lien_danh_thanh_vien_pkey`.

### `tieu_chi_danh_gia`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (16): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `vong_danh_gia_id text NN`; `ma_tieu_chi text NN`; `ten_tieu_chi text NN`; `diem_toi_da numeric(20,4) NULL`; `trong_so numeric(20,4) NULL`; `nhom_danh_gia text NN DEFAULT 'technical'::text`; `loai_ket_qua text NN DEFAULT 'pass_fail'::text`; `bat_buoc smallint NN DEFAULT 1`; `tieu_chi_cha_id text NULL`; `thu_tu integer NN DEFAULT 0`; `extension_json text NN DEFAULT '{"schemaVersion":1}'::text`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `tieu_chi_danh_gia_pkey`: PRIMARY KEY (organization_id, id); `tieu_chi_danh_gia_organization_id_vong_danh_gia_id_ma_tieu__key`: UNIQUE (organization_id, vong_danh_gia_id, ma_tieu_chi).
- FK: `fk_tieu_chi_danh_gia_1_e123866c`: FOREIGN KEY (organization_id, vong_danh_gia_id) REFERENCES vong_danh_gia(organization_id, id) ON DELETE CASCADE; `fk_tieu_chi_danh_gia_2_a8921b68`: FOREIGN KEY (organization_id, tieu_chi_cha_id) REFERENCES tieu_chi_danh_gia(organization_id, id) ON DELETE SET NULL.
- Indexes (5): `idx_tieu_chi_danh_gia_owner_type_owner`, `idx_tieu_chi_danh_gia_parent`, `idx_tieu_chi_danh_gia_round`, `tieu_chi_danh_gia_organization_id_vong_danh_gia_id_ma_tieu__key`, `tieu_chi_danh_gia_pkey`.

### `to_chuc`

- Ownership: `none explicit`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (5): `id text NN`; `ten_to_chuc text NN`; `trang_thai text NN DEFAULT 'active'::text`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `to_chuc_pkey`: PRIMARY KEY (id).
- FK: none.
- Indexes (1): `to_chuc_pkey`.

### `user_notifications`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `read_at, created_at`.
- Columns (12): `id text NN`; `user_id text NN`; `organization_id text NULL`; `kind text NN`; `severity text NN DEFAULT 'info'::text`; `title text NN`; `message text NN`; `target_type text NULL`; `target_id text NULL`; `route text NULL`; `read_at bigint NULL`; `created_at integer NN`.
- PK/UNIQUE: `user_notifications_pkey`: PRIMARY KEY (id); `user_notifications_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: `fk_user_notifications_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (4): `idx_user_notifications_user_created`, `idx_user_notifications_user_unread`, `user_notifications_organization_id_id_key`, `user_notifications_pkey`.

### `vong_danh_gia`

- Ownership: `organization_id, owner_type`; version: `sync_version`; timestamps: `created_at, updated_at`.
- Columns (15): `id text NN`; `organization_id text NN`; `owner_type text NN DEFAULT 'organization'::text`; `goi_thau_id text NN`; `loai_vong text NN`; `thu_tu integer NN DEFAULT 0`; `trang_thai text NN DEFAULT 'draft'::text`; `so_bao_cao text NULL`; `ngay_bao_cao date NULL`; `da_luu_danh_sach_dat smallint NN DEFAULT 0`; `hoan_thanh_luc text NULL`; `extension_json text NN DEFAULT '{"schemaVersion":1}'::text`; `sync_version bigint NN DEFAULT 0`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `vong_danh_gia_pkey`: PRIMARY KEY (organization_id, id); `vong_danh_gia_organization_id_goi_thau_id_loai_vong_key`: UNIQUE (organization_id, goi_thau_id, loai_vong).
- FK: `fk_vong_danh_gia_1_c70646d2`: FOREIGN KEY (organization_id, goi_thau_id) REFERENCES goi_thau(organization_id, id) ON DELETE CASCADE.
- Indexes (4): `idx_vong_danh_gia_owner_type_owner`, `idx_vong_danh_gia_package`, `vong_danh_gia_organization_id_goi_thau_id_loai_vong_key`, `vong_danh_gia_pkey`.

### `websocket_connection_leases`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `expires_at, created_at, updated_at`.
- Columns (8): `id text NN`; `user_id text NULL`; `organization_id text NULL`; `client_ip_hash text NN`; `worker_id text NN`; `expires_at bigint NN`; `created_at integer NN`; `updated_at integer NN`.
- PK/UNIQUE: `websocket_connection_leases_pkey`: PRIMARY KEY (id); `websocket_connection_leases_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: `fk_websocket_connection_leases_1_d0816114`: FOREIGN KEY (user_id) REFERENCES tai_khoan(id) ON DELETE CASCADE.
- Indexes (5): `idx_websocket_leases_expiry`, `idx_websocket_leases_ip`, `idx_websocket_leases_user`, `websocket_connection_leases_organization_id_id_key`, `websocket_connection_leases_pkey`.

### `websocket_events`

- Ownership: `organization_id, user_id`; version: `none`; timestamps: `available_at, delivered_at, created_at`.
- Columns (11): `id bigint NN`; `event_type text NN`; `organization_id text NULL`; `user_id text NULL`; `payload_json text NULL`; `status text NN DEFAULT 'pending'::text`; `attempt_count integer NN DEFAULT 0`; `available_at integer NN DEFAULT 0`; `delivered_at integer NULL`; `last_error_code text NULL`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `websocket_events_pkey`: PRIMARY KEY (id); `websocket_events_organization_id_id_key`: UNIQUE (organization_id, id).
- FK: none.
- Indexes (2): `websocket_events_organization_id_id_key`, `websocket_events_pkey`.

### `word_default_seeds`

- Ownership: `organization_id`; version: `none`; timestamps: `updated_at`.
- Columns (3): `organization_id text NN`; `mappings_version integer NN`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `word_default_seeds_pkey`: PRIMARY KEY (organization_id).
- FK: none.
- Indexes (1): `word_default_seeds_pkey`.

### `word_mapping_overrides`

- Ownership: `organization_id, owner_type`; version: `none`; timestamps: `created_at, updated_at`.
- Columns (11): `organization_id text NN`; `owner_type text NN`; `mapping_key text NN`; `ten_bien_override text NULL`; `source_table_override text NULL`; `source_column_override text NULL`; `mo_ta_override text NULL`; `disabled smallint NN DEFAULT 0`; `base_version integer NN`; `created_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`; `updated_at timestamp with time zone NN DEFAULT CURRENT_TIMESTAMP`.
- PK/UNIQUE: `word_mapping_overrides_pkey`: PRIMARY KEY (organization_id, mapping_key).
- FK: none.
- Indexes (2): `idx_word_mapping_overrides_owner_type_owner`, `word_mapping_overrides_pkey`.

# Phụ lục B — Full route registration inventory

Static AST inventory tại target SHA: 145 `Route`/`WebSocketRoute` registrations. Trong đó có 100 transport endpoints (99 HTTP + 1 WS); phần còn lại là SPA/static/dev routes. Permission/tenant/service/transaction được map theo family ở §2.5; no-frontend-caller không đồng nghĩa dead.

| Method | Path | Handler | Registration | Kind |
|---|---|---|---|---|
| `GET` | `/` | `index` | `backend/app.py:856` | SPA/static |
| `GET` | `/api/activities/{target_type}/{target_id}` | `list_activity_timeline_api` | `backend/app.py:872` | API/ops |
| `GET` | `/api/address/provinces` | `get_provinces_api` | `backend/app.py:903` | API/ops |
| `GET` | `/api/address/wards/{province_code}` | `get_wards_api` | `backend/app.py:904` | API/ops |
| `GET` | `/api/ai/config` | `ai_config_api` | `backend/ai/routes.py:268` | API/ops |
| `GET` | `/api/ai/conversations` | `list_ai_conversations_api` | `backend/ai/routes.py:269` | API/ops |
| `POST` | `/api/ai/conversations` | `create_ai_conversation_api` | `backend/ai/routes.py:270` | API/ops |
| `DELETE` | `/api/ai/conversations/{conversation_id}` | `delete_ai_conversation_api` | `backend/ai/routes.py:274` | API/ops |
| `GET` | `/api/ai/conversations/{conversation_id}` | `get_ai_conversation_api` | `backend/ai/routes.py:273` | API/ops |
| `GET` | `/api/ai/conversations/{conversation_id}/messages` | `list_ai_messages_api` | `backend/ai/routes.py:272` | API/ops |
| `POST` | `/api/ai/conversations/{conversation_id}/messages` | `send_ai_message_api` | `backend/ai/routes.py:271` | API/ops |
| `POST,DELETE` | `/api/ai/feedback` | `ai_feedback_api` | `backend/ai/routes.py:275` | API/ops |
| `GET` | `/api/ai/suggested-questions` | `suggested_questions_api` | `backend/ai/routes.py:276` | API/ops |
| `POST` | `/api/auth/active-role` | `set_active_role_api` | `backend/app.py:915` | API/ops |
| `POST` | `/api/auth/change-password` | `change_password_api` | `backend/app.py:921` | API/ops |
| `POST` | `/api/auth/check-session` | `check_session_api` | `backend/app.py:914` | API/ops |
| `POST` | `/api/auth/forgot-password` | `forgot_password_api` | `backend/app.py:917` | API/ops |
| `POST` | `/api/auth/google-login` | `google_login_api` | `backend/app.py:912` | API/ops |
| `POST` | `/api/auth/login` | `login_api` | `backend/app.py:911` | API/ops |
| `POST` | `/api/auth/logout` | `logout_api` | `backend/app.py:916` | API/ops |
| `POST` | `/api/auth/privileged-reauth` | `privileged_reauth_api` | `backend/app.py:922` | API/ops |
| `POST` | `/api/auth/register` | `register_api` | `backend/app.py:908` | API/ops |
| `POST` | `/api/auth/resend-code` | `resend_code_api` | `backend/app.py:910` | API/ops |
| `POST` | `/api/auth/reset-password` | `reset_password_api` | `backend/app.py:918` | API/ops |
| `POST` | `/api/auth/set-username` | `set_username_api` | `backend/app.py:913` | API/ops |
| `POST` | `/api/auth/update-profile` | `update_profile_api` | `backend/app.py:919` | API/ops |
| `GET` | `/api/auth/users` | `list_users_api` | `backend/app.py:923` | API/ops |
| `PUT` | `/api/auth/users/access-settings` | `update_user_access_settings_api` | `backend/app.py:924` | API/ops |
| `POST` | `/api/auth/users/add-to-org` | `add_user_to_org_api` | `backend/app.py:928` | API/ops |
| `POST` | `/api/auth/users/remove-from-org` | `remove_user_from_org_api` | `backend/app.py:929` | API/ops |
| `POST` | `/api/auth/users/update-metadata` | `update_user_metadata_api` | `backend/app.py:927` | API/ops |
| `POST` | `/api/auth/users/update-role` | `update_user_role_api` | `backend/app.py:926` | API/ops |
| `DELETE` | `/api/auth/users/{user_id}` | `delete_user_api` | `backend/app.py:942` | API/ops |
| `POST` | `/api/auth/verify` | `verify_email_api` | `backend/app.py:909` | API/ops |
| `POST` | `/api/auth/verify-email-change` | `verify_email_change_api` | `backend/app.py:920` | API/ops |
| `POST` | `/api/client-errors` | `client_error_api` | `backend/app.py:855` | API/ops |
| `GET` | `/api/contracts/package-lifecycle` | `lifecycle_policy_api` | `backend/lifecycle_policy_routes.py:14` | API/ops |
| `POST` | `/api/document-jobs/package-report/{package_id}` | `create_package_export_job_api` | `backend/documents/document_job_routes.py:244` | API/ops |
| `DELETE` | `/api/document-jobs/{job_id}` | `cancel_document_export_job_api` | `backend/documents/document_job_routes.py:264` | API/ops |
| `GET` | `/api/document-jobs/{job_id}` | `document_export_job_status_api` | `backend/documents/document_job_routes.py:249` | API/ops |
| `GET` | `/api/document-jobs/{job_id}/download` | `download_document_export_job_api` | `backend/documents/document_job_routes.py:254` | API/ops |
| `POST` | `/api/document-jobs/{job_id}/retry` | `retry_document_export_job_api` | `backend/documents/document_job_routes.py:259` | API/ops |
| `GET` | `/api/export-danhgiahsdt-template` | `export_danhgiahsdt_template_api` | `backend/app.py:893` | API/ops |
| `GET` | `/api/export-excel-template/{import_type}` | `export_excel_template_api` | `backend/app.py:891` | API/ops |
| `GET` | `/api/export-ketquaqd-template` | `export_ketquaqd_template_api` | `backend/app.py:894` | API/ops |
| `GET` | `/api/export-mothau-template` | `export_mothau_template_api` | `backend/app.py:892` | API/ops |
| `GET` | `/api/export-opening-fin-template` | `export_opening_fin_template_api` | `backend/app.py:895` | API/ops |
| `POST` | `/api/export-phanlo-excel` | `export_phanlo_excel_api` | `backend/app.py:896` | API/ops |
| `GET` | `/api/export-plan/{plan_id}` | `export_plan_api` | `backend/app.py:879` | API/ops |
| `GET` | `/api/export-report/{package_id}` | `export_report_api` | `backend/app.py:874` | API/ops |
| `GET` | `/api/export-timeline/{package_id}` | `export_timeline_api` | `backend/app.py:875` | API/ops |
| `POST` | `/api/export-tuychonmuathem-excel` | `export_tuychonmuathem_excel_api` | `backend/app.py:897` | API/ops |
| `GET` | `/api/get-all-data` | `get_all_data_api` | `backend/sync/api.py:67` | API/ops |
| `GET` | `/api/holidays` | `list_holidays_api` | `backend/app.py:861` | API/ops |
| `POST` | `/api/import-excel` | `import_excel_api` | `backend/app.py:890` | API/ops |
| `GET` | `/api/lookup-tax-code` | `lookup_tax_code_api` | `backend/app.py:905` | API/ops |
| `GET` | `/api/notifications` | `list_notifications_api` | `backend/app.py:869` | API/ops |
| `POST` | `/api/notifications/read-all` | `mark_all_notifications_read_api` | `backend/app.py:870` | API/ops |
| `POST` | `/api/notifications/{notification_id}/read` | `mark_notification_read_api` | `backend/app.py:871` | API/ops |
| `GET` | `/api/organizations/document-export-capabilities/{user_id}` | `get_document_export_capabilities_api` | `backend/app.py:932` | API/ops |
| `PUT` | `/api/organizations/document-export-capabilities/{user_id}` | `update_document_export_capabilities_api` | `backend/app.py:937` | API/ops |
| `GET` | `/api/organizations/former-members` | `list_former_organization_members_api` | `backend/app.py:931` | API/ops |
| `POST` | `/api/organizations/subscription` | `update_organization_subscription_api` | `backend/app.py:930` | API/ops |
| `POST` | `/api/packages/{package_id}/award-result-excel/export` | `export_award_result_excel_api` | `backend/documents/award_result_excel_routes.py:647` | API/ops |
| `GET` | `/api/packages/{package_id}/award-result-excel/preview` | `award_result_excel_preview_api` | `backend/documents/award_result_excel_routes.py:652` | API/ops |
| `POST` | `/api/packages/{package_id}/award-result-excel/reconciliation` | `award_result_excel_reconciliation_api` | `backend/documents/award_result_excel_routes.py:657` | API/ops |
| `POST` | `/api/packages/{package_id}/award-result-excel/validate` | `validate_award_result_excel_api` | `backend/documents/award_result_excel_routes.py:642` | API/ops |
| `DELETE` | `/api/packages/{package_id}/award-result-excel/validation` | `cancel_award_result_excel_validation_api` | `backend/documents/award_result_excel_routes.py:662` | API/ops |
| `POST` | `/api/packages/{package_id}/bid-opening/contractors/resolve` | `resolve_bid_opening_contractor` | `backend/contractor_risk/routes.py:197` | API/ops |
| `GET` | `/api/packages/{package_id}/documents` | `list_package_documents_api` | `backend/documents/package_document_routes.py:600` | API/ops |
| `DELETE` | `/api/packages/{package_id}/documents/{document_type}` | `delete_package_document_api` | `backend/documents/package_document_routes.py:610` | API/ops |
| `PUT` | `/api/packages/{package_id}/documents/{document_type}` | `upload_package_document_api` | `backend/documents/package_document_routes.py:605` | API/ops |
| `GET` | `/api/packages/{package_id}/documents/{document_type}/download` | `download_package_document_api` | `backend/documents/package_document_routes.py:615` | API/ops |
| `POST` | `/api/packages/{package_id}/lot-batches` | `create_lot_batch_api` | `backend/app.py:866` | API/ops |
| `POST` | `/api/packages/{package_id}/lot-batches/{batch_id}/finalize` | `finalize_lot_batch_api` | `backend/app.py:867` | API/ops |
| `GET` | `/api/packages/{package_id}/lot-lifecycle` | `get_lot_lifecycle_api` | `backend/app.py:865` | API/ops |
| `GET` | `/api/paginate` | `paginate_api` | `backend/sync/api.py:65` | API/ops |
| `GET` | `/api/public/packages` | `list_public_packages_api` | `backend/app.py:899` | API/ops |
| `GET` | `/api/record` | `record_api` | `backend/sync/api.py:66` | API/ops |
| `POST` | `/api/sync` | `sync_api` | `backend/sync/api.py:56` | API/ops |
| `GET` | `/api/sync-version` | `current_sync_version_api` | `backend/sync/api.py:64` | API/ops |
| `GET` | `/api/sync/delta` | `delta_sync_api` | `backend/sync/api.py:63` | API/ops |
| `POST` | `/api/sync/restore` | `restore_record_api` | `backend/sync/api.py:62` | API/ops |
| `GET` | `/api/system-packages` | `list_system_packages_api` | `backend/app.py:898` | API/ops |
| `POST` | `/api/system-packages/update` | `update_system_package_api` | `backend/app.py:900` | API/ops |
| `GET` | `/api/templates` | `list_templates_api` | `backend/app.py:880` | API/ops |
| `POST` | `/api/templates/active` | `set_active_template_api` | `backend/app.py:881` | API/ops |
| `POST` | `/api/templates/upload` | `upload_template_api` | `backend/app.py:882` | API/ops |
| `DELETE` | `/api/templates/{filename}` | `delete_template_api` | `backend/app.py:885` | API/ops |
| `GET` | `/api/templates/{filename}` | `view_template_api` | `backend/app.py:883` | API/ops |
| `PUT` | `/api/templates/{filename}` | `replace_template_api` | `backend/app.py:884` | API/ops |
| `POST` | `/api/versioning/aggregate` | `aggregate_version_api` | `backend/sync/api.py:57` | API/ops |
| `GET` | `/api/word-mappings` | `list_word_mappings_api` | `backend/app.py:886` | API/ops |
| `POST` | `/api/word-mappings` | `save_word_mapping_api` | `backend/app.py:887` | API/ops |
| `DELETE` | `/api/word-mappings/{mapping_id}` | `delete_word_mapping_api` | `backend/app.py:888` | API/ops |
| `POST` | `/api/word-mappings/{mapping_id}/reset` | `reset_word_mapping_api` | `backend/app.py:889` | API/ops |
| `GET` | `/bieu-mau` | `index` | `backend/app.py:963` | SPA/static |
| `GET` | `/chu-dau-tu` | `index` | `backend/app.py:955` | SPA/static |
| `GET` | `/chu-dau-tu-chi-tiet` | `index` | `backend/app.py:977` | SPA/static |
| `GET` | `/chu-dau-tu-chi-tiet/{action}` | `index` | `backend/app.py:978` | SPA/static |
| `GET` | `/chu-dau-tu/{action}` | `index` | `backend/app.py:956` | SPA/static |
| `GET` | `/chudautu-detail` | `index` | `backend/app.py:981` | SPA/static |
| `GET` | `/chudautu-detail/{action}` | `index` | `backend/app.py:982` | SPA/static |
| `GET` | `/chuyen-gia` | `index` | `backend/app.py:959` | SPA/static |
| `GET` | `/chuyen-gia/{action}` | `index` | `backend/app.py:960` | SPA/static |
| `GET` | `/dang-nhap` | `index` | `backend/app.py:859` | SPA/static |
| `GET` | `/danh-gia-hsdt` | `index` | `backend/app.py:953` | SPA/static |
| `GET` | `/danh-gia-hsdt/{action}` | `index` | `backend/app.py:954` | SPA/static |
| `GET` | `/goi-thau` | `index` | `backend/app.py:948` | SPA/static |
| `GET` | `/goi-thau-chi-tiet` | `index` | `backend/app.py:971` | SPA/static |
| `GET` | `/goi-thau-chi-tiet/{action}` | `index` | `backend/app.py:972` | SPA/static |
| `GET` | `/goi-thau/{action}` | `index` | `backend/app.py:949` | SPA/static |
| `GET` | `/health/live` | `health_live_api` | `backend/app.py:852` | API/ops |
| `GET` | `/health/ready` | `health_ready_api` | `backend/app.py:853` | API/ops |
| `GET` | `/hop-dong` | `index` | `backend/app.py:961` | SPA/static |
| `GET` | `/hop-dong-chi-tiet` | `index` | `backend/app.py:975` | SPA/static |
| `GET` | `/hop-dong-chi-tiet/{action}` | `index` | `backend/app.py:976` | SPA/static |
| `GET` | `/hop-dong/{action}` | `index` | `backend/app.py:962` | SPA/static |
| `GET` | `/images/{file_path:path}` | `protected_image_api` | `backend/app.py:862` | API/ops |
| `GET` | `/index.html` | `index` | `backend/app.py:857` | SPA/static |
| `GET` | `/ke-hoach` | `index` | `backend/app.py:946` | SPA/static |
| `GET` | `/ke-hoach-chi-tiet` | `index` | `backend/app.py:973` | SPA/static |
| `GET` | `/ke-hoach-chi-tiet/{action}` | `index` | `backend/app.py:974` | SPA/static |
| `GET` | `/ke-hoach/{action}` | `index` | `backend/app.py:947` | SPA/static |
| `GET` | `/legal` | `index` | `backend/app.py:860` | SPA/static |
| `GET` | `/metrics` | `metrics_api` | `backend/app.py:854` | API/ops |
| `GET` | `/mothau` | `index` | `backend/app.py:951` | SPA/static |
| `GET` | `/mothau/{action}` | `index` | `backend/app.py:952` | SPA/static |
| `GET` | `/nha-thau` | `index` | `backend/app.py:957` | SPA/static |
| `GET` | `/nha-thau-chi-tiet` | `index` | `backend/app.py:979` | SPA/static |
| `GET` | `/nha-thau-chi-tiet/{action}` | `index` | `backend/app.py:980` | SPA/static |
| `GET` | `/nha-thau/{action}` | `index` | `backend/app.py:958` | SPA/static |
| `GET` | `/nhan-su` | `index` | `backend/app.py:968` | SPA/static |
| `GET` | `/nhathau-detail` | `index` | `backend/app.py:983` | SPA/static |
| `GET` | `/nhathau-detail/{action}` | `index` | `backend/app.py:984` | SPA/static |
| `GET` | `/node_modules/dompurify/dist/purify.es.mjs` | `dompurify_development_asset` | `backend/app.py:1007` | DEV |
| `GET` | `/quan-ly-tai-khoan` | `index` | `backend/app.py:967` | SPA/static |
| `GET` | `/reset-password` | `index` | `backend/app.py:964` | SPA/static |
| `GET` | `/timeline-goi-thau` | `index` | `backend/app.py:950` | SPA/static |
| `GET` | `/tong-quan` | `index` | `backend/app.py:945` | SPA/static |
| `GET` | `/tong-quan-admin` | `index` | `backend/app.py:966` | SPA/static |
| `GET` | `/trang-ca-nhan` | `index` | `backend/app.py:970` | SPA/static |
| `GET` | `/trang-thai-ho-so` | `index` | `backend/app.py:969` | SPA/static |
| `GET` | `/views/index.html` | `index` | `backend/app.py:858` | SPA/static |
| `WS` | `/ws/sync` | `sync_websocket_endpoint` | `backend/app.py:873` | WS |

---

# Kết luận cuối — trả lời 15 câu bắt buộc

## 1. Có P0 nào không?

Có, **3 P0**: stale tenant response ghi vào workspace khác (BF-P0-01), in-flight mutation vượt workspace boundary (BF-P0-02), và AI dùng role manager của organization khác (BF-P0-03).

## 2. Có P1 nào không?

Có, **14 P1**: 6 confirmed product bugs/defects và 8 data/concurrency/release risks hoặc blockers, chi tiết ở bảng tổng.

## 3. Bug nghiêm trọng nhất là gì?

Về confidentiality/authorization, BF-P0-03 nghiêm trọng nhất vì bypass diễn ra server-side và cho phép employee đọc full-scope tenant qua AI. Về integrity, BF-P0-02 nghiêm trọng nhất vì một mutation A có thể stage/upload/delete trong B.

## 4. Có nguy cơ mất/sai dữ liệu không?

Có: direct mutation failure, pending-edit pull overwrite, reverse pull completion, stale delete, dual outbox fail-open, historical contractor mutation và cross-workspace mutation đều có thể làm mất/sai dữ liệu. Năm path đầu đã có deterministic/code-path evidence theo classification; backend count races chưa chạy harness nên giữ là risk.

## 5. Có nguy cơ cross-tenant không?

Có, ba P0 đều liên quan cross-workspace/tenant; BF-P0-03 là server authorization leakage, BF-P0-01/BF-P0-02 là frontend local durability/outbox contamination có thể lan lên server sync.

## 6. Có code chết xác nhận được không?

Có **3 groups**: năm `evaluationMetadata` exports, dead direct/special branch trong new award workflow, và legacy timeline DOCX route/worker chain. Không có whole module/file được xác nhận dead.

## 7. Có bao nhiêu code/file candidate có thể xóa?

Ba confirmed-dead groups là **SAFE AFTER TEST**, không có item tracked production nào `SAFE NOW`. Hai standalone benchmark scripts là `POSSIBLY UNUSED/UNKNOWN`, chưa được tính là dead hoặc approved deletion.

## 8. Có DB object nào candidate để loại bỏ không?

Có đúng **một candidate rõ**: explicit unique index `idx_audit_log_single_successor` trùng exact constraint-backed index. Cần migration/contract update/compatibility window/rollback; không backfill. Không có table/column candidate.

## 9. Có index/constraint nào thiếu không?

Không thiếu FK index: 104/104 covered. Có hai CHECK candidates cho `sync_metadata`; có cutoff-first/partial index candidates cho retention sau benchmark. Schema readiness assertion cũng thiếu validation definitions, nhưng đó là assurance gap chứ không phải DB constraint đang thiếu chắc chắn.

## 10. Có business rule duplicate không?

Có, **10 rule families** trong `DUPLICATED_RULE_MATRIX`: award projection, evaluation normalization, latest/root, contractor identity/version, lot JSON, lot outcome, AI scope, tax-code normalization, realtime enqueue và timeline export.

## 11. Có compatibility path nào nên retire không?

Có candidates: local aggregate-version fallback, staged-approval request fields, legacy timeline DOCX chain, dead award branch và future-version contractor fallback. Chỉ timeline chain/dead branch đủ evidence `SAFE AFTER TEST`; các path còn lại cần telemetry, product contract hoặc deprecation window.

## 12. Có test flaky hoặc gap nghiêm trọng không?

Có. Offline E2E fail một lần rồi pass hai lần do fixed timing; canonical Playwright cross-browser bị skip; không có regression cho ba P0, reverse pulls/pending overlay, backend races, personal WS fallback, custom-select keyboard, real upgrade chain và several worker/AI paths. Có 12 material gap groups.

## 13. Có performance bottleneck rõ ràng không?

Có một measured cold long task 145 ms vượt budget 100 ms, CSS eager bundle 378 kB raw và retention query/index mismatch. Cold/warm p95 vẫn pass; không có production telemetry để gọi query/service khác là confirmed bottleneck.

## 14. Có phần nào tuyệt đối chưa nên refactor không?

Có: historical migrations v2–v42, root/version schema, aggregate server transaction/locks, generic atomic row-version writer, restore tombstone, BrowserDB multi-store apply, EntityIndexes, Excel worker, document sandbox/archive guards và toàn owner/tenant model. Chỉ thay incremental seam có characterization tests.

## 15. Nếu chỉ được sửa 10 việc tiếp theo, đó là những việc nào theo thứ tự?

1. Bind effective role với current organization và khóa AI full-scope cho tới khi BF-P0-03 tests pass.
2. Introduce workspace lease + abort/drain cho mọi async read/mutation (BF-P0-01/BF-P0-02).
3. Fix pending mutation overlay và serialize/generation-guard pulls (BF-P1-01/BF-P1-02).
4. Route legacy direct entity writes qua atomic data store; make dual outbox fail-closed/recoverable (BF-P1-03/BF-P1-04).
5. Make backend delete conditional/locked với expected row version (BF-P1-09).
6. Decide and enforce/retire Word access policy end-to-end (BF-P1-08).
7. Restore personal workspace polling/WS and transactional durable realtime enqueue (BF-P1-14/BF-P2-26).
8. Add shared serialization locks for member quota, last manager, last super-admin and package-document lifecycle (BF-P1-10..13).
9. Add generated schema drift gate, content-hashed bootstrap vendor URLs và required regression tests (BF-P2-01/BF-P2-02).
10. Clear release blockers: approve legal facts, package operational scripts/runbook coherently, require immutable release ID, then run full release/E2E/upgrade gates.

---

**Stop condition:** Báo cáo kết thúc tại đây. Không có production code/schema/API fix, refactor, database drop hay feature implementation nào được thực hiện trong audit này.
