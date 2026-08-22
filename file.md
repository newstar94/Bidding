# BiddingFlow — Báo cáo audit codebase

Ngày audit: 2026-08-22  
Phạm vi: toàn bộ repository `D:\Bidding`  
Phiên bản được rà soát: `main@9cc9d3d3`  
Hình thức: read-only; không sửa production code, schema, migration, UI hay test expectation

## 1. Kết luận điều hành

Codebase có nền tảng kiểm soát tương đối tốt: module graph không có cycle, security lint và Trusted Types pass, dependency audit hiện không phát hiện CVE đã biết, JavaScript suite chạy xanh. Tuy nhiên vẫn có các lỗi phải ưu tiên trước release:

1. `GET /api/auth/users` làm lộ metadata membership, subscription và permission xuyên tenant.
2. Durable document job có thể tiếp tục dùng quyền `super_admin` sau khi tài khoản đã bị hạ quyền.
3. Manager đang chọn employee persona vẫn có thể quản lý quyền xuất tài liệu.
4. Migration v61 đổi tên tenant dựa trên tên `HTD`, có thể sửa nhầm tenant hợp lệ.
5. Ảnh chữ ký, con dấu và chứng chỉ lưu theo tenant namespace bị loại khỏi Word export.
6. Cấu hình Word có thể mất cập nhật khi nhiều admin hoặc nhiều Uvicorn worker cùng ghi.
7. `npm run lint:debt` đang đỏ trên clean `main`, vì vậy release graph hiện không thể xanh hoàn toàn.

Ngoài lỗi chức năng, codebase còn có nợ concurrency/audit, hai nguồn policy Word, service-worker upgrade race, E2E bị bỏ qua âm thầm, coverage gate thấp và nhiều symbol/test đang giữ code không còn production caller.

## 2. Business contract bắt buộc phải giữ

Mọi remediation trong báo cáo này phải tuân thủ `AGENTS.md`:

- Không thêm, bỏ hoặc thay đổi masking/redaction/ẩn trường nếu chưa có yêu cầu nghiệp vụ được xác nhận.
- Người dùng đã có quyền đọc bản ghi phải tiếp tục thấy đầy đủ CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và các trường liên quan.
- Entitlement Word chỉ kiểm soát hành động tạo/tải tài liệu; không được dùng để che hoặc mở dữ liệu trong API/màn hình đọc bản ghi.
- Không tạo capability đọc dữ liệu nhạy cảm riêng.
- Phải tiếp tục bảo toàn tenant isolation, module permission, assignment scope, record authorization, session checks và audit.
- Cleanup liên quan role, scope, capability, schema hoặc response cần ADR/business contract, compatibility impact, migration strategy và regression tests.

Các finding authorization dưới đây nhằm khôi phục tenant/session isolation đã được quy định, không nhằm tạo semantics quyền mới.

## 3. P1 — Cần xử lý trước

### P1.1. Rò rỉ metadata xuyên tenant tại `GET /api/auth/users`

#### Bằng chứng

- `backend/auth/admin_user_routes.py:124-136` chọn đúng tập user thuộc organization hiện tại.
- Truy vấn enrich tại `backend/auth/admin_user_routes.py:142-168` chỉ lọc `tvtc.user_id IN (...)`, không lọc `tvtc.organization_id = active_org_id`.
- Projection tại `backend/auth/admin_user_routes.py:188-222` trả organization name/status, membership role, employee profile, subscription, quota, module permissions và document-export grants.
- `backend/auth/admin_user_routes.py:224-235` còn gắn personal account subscription/workspace của từng user.
- `backend/auth/admin_user_routes.py:99-111` đọc membership gốc để quyết định manager branch, không tôn trọng `SessionRole.active_role="employee"`.

#### Tác động

Manager tenant A có thể thấy membership và cấu hình quyền của tenant B nếu hai tenant có chung một thành viên. Đây là lỗi tenant isolation trực tiếp.

#### Khắc phục

- Tách response projection của `super_admin` và organization-scoped caller.
- Nhánh organization phải lọc enrich theo `active_org_id`.
- Không tải/trả personal subscription hoặc personal workspace của người khác cho organization manager.
- Dùng `is_organization_manager(cursor, session_role, ...)` với nguyên `SessionRole`.

#### Regression test bắt buộc

Tạo hai organization có chung một member; manager organization A không được thấy organization B, subscription B, permissions B, document grants B hoặc personal subscription của member.

### P1.2. Durable document job giữ quyền `super_admin` cũ sau demotion

#### Bằng chứng

- Policy snapshot lưu role tại `backend/documents/document_job_policy.py:42-57`.
- Worker đọc account role hiện tại tại `backend/documents/document_job_policy.py:99-104`.
- Nhưng `SessionRole` lại được dựng bằng role chuỗi lấy từ snapshot cũ tại `backend/documents/document_job_policy.py:105-113`.
- `backend/shared/subscription_policy.py:169-170` và `backend/shared/access_policy.py:117-127` tin giá trị chuỗi này.
- Worker recheck trước và sau render tại `backend/documents/document_worker.py:1002-1020`, nhưng cả hai lần đều gọi cùng reconstruction lỗi.

Probe runtime đã xác nhận: snapshot `super_admin`, account hiện tại `user`; `verify_document_job_policy()` vẫn trả `True` và downstream policies nhận `str(role) == "super_admin"`.

#### Tác động

Một export job đã enqueue có thể tiếp tục chạy với authority đã bị thu hồi.

#### Khắc phục

- Dựng authority từ current account và current membership.
- Snapshot persona chỉ được dùng sau khi xác minh persona vẫn hợp lệ trong organization tương ứng.
- Có thể reject ngay nếu snapshot platform role là elevated role nhưng current platform role đã thay đổi.

#### Regression test bắt buộc

- Demotion trước khi worker claim job.
- Demotion giữa hai lần authorization recheck.
- Membership hoặc export entitlement bị revoke trước render.

### P1.3. Employee persona vẫn quản lý quyền xuất tài liệu

#### Bằng chứng

- GET route ép `SessionRole` thành `str` tại `backend/api/org_routes.py:1241-1243`.
- PUT route lặp lại tại `backend/api/org_routes.py:1323-1325`.
- `backend/shared/access_policy.py:167-172` chỉ chặn manager ở employee persona nếu object vẫn còn thuộc tính `active_role`.

#### Tác động

Manager membership đang chủ động chọn employee persona vẫn có thể GET/PUT `document-export-capabilities`.

#### Khắc phục

Truyền nguyên `SessionRole` qua policy seam; không stringify role trước authorization.

#### Regression test bắt buộc

Manager membership với `active_role="employee"` phải bị từ chối ở cả GET và PUT; `active_role="manager"` giữ nguyên hành vi hiện hành.

### P1.4. Migration v61 có thể đổi nhầm tên tenant

#### Bằng chứng

`backend/db/upgrades.py:2287-2294` chạy:

```sql
UPDATE to_chuc
SET ten_to_chuc = 'HCP'
WHERE ten_to_chuc = 'HTD';
```

- Không có điều kiện theo historical default organization ID.
- `backend/db/id_utils.py:62-65` đã có `stable_org_id()` để xác định ID deterministic.
- `tests/test_postgres_migration_chain.py:474-511` hiện còn xác nhận một organization ID tùy ý tên `HTD` phải bị đổi.

#### Tác động

Mọi tenant hợp lệ có tên `HTD` đều bị đổi thành `HCP` khi đi qua schema v61.

#### Khắc phục và giới hạn

- Nếu chưa rollout v61: chặn rollout, chạy preflight liệt kê candidate và xác nhận exact historical ID.
- Không sửa migration v61 đã phát hành.
- Nếu v61 đã chạy: không tự động đổi toàn bộ `HCP` về `HTD`; cần mapping/backup/audit do chủ sản phẩm xác nhận, sau đó tạo remediation migration mới.
- Sửa test để bảo vệ arbitrary tenant khỏi rename, không đổi expected value để hợp thức hóa hành vi sai.

### P1.5. Ảnh tenant-scoped bị loại khỏi Word export

#### Bằng chứng

- Ảnh mới được lưu dạng `images/<type>/t-<tenant-hash>/<file>` tại `backend/shared/media_helper.py:371-438` và `backend/shared/media_helper.py:466-520`.
- `backend/documents/docx_context_policy.py:562-572` loại path nếu phần sau subfolder còn chứa `/`.
- `backend/documents/document_ipc.py:98-135` chỉ copy path có đúng ba segment.
- `backend/documents/custom_exporter.py:1063-1086` cũng từ chối filename chứa `/`.

Probe trực tiếp với tenant-scoped signature path trả `''` ở projection và `('', '')` ở renderer. Legacy path ba segment vẫn hoạt động.

#### Tác động

Chữ ký, con dấu và chứng chỉ mới có thể biến mất khỏi tài liệu Word dù record và export authorization đều hợp lệ.

#### Khắc phục

- Dùng canonical parser từ `media_helper` tại cả projection, IPC và renderer.
- Bắt buộc kiểm tra `managed_image_path_matches_tenant`; không nới path validation chung chung.
- IPC copy an toàn tenant subdirectory và giữ path traversal guard.

#### Regression test bắt buộc

- DOCX cuối cùng chứa media tenant-scoped của tenant hiện tại.
- Media tenant khác bị từ chối.
- Legacy media hợp lệ tiếp tục hoạt động theo compatibility contract.

### P1.6. Cấu hình Word bị silent lost update

#### Bằng chứng

- `_WORD_CONFIG_LOCK` chỉ là `threading.RLock`: `backend/documents/custom_exporter.py:33`.
- Production example chạy bốn worker: `.env.example:86`, `deploy/systemd/biddingflow.service.example:12`.
- Config được load–modify–`os.replace` toàn file tại `backend/documents/custom_exporter.py:442-467`.
- Assignment thay toàn map tại `backend/documents/custom_exporter.py:575-585`.
- Frontend gửi `PUT` toàn snapshot, không revision/ETag/If-Match tại `frontend/documents/WordPublicationTemplateConfig.js:112-129`.
- UI dựng lại toàn assignment map tại `frontend/documents/WordTemplateAssignments.js:446-452` và `frontend/documents/WordTemplateAssignments.js:548-557`.

#### Tác động

Hai admin mở cùng snapshot hoặc hai process cập nhật các key khác nhau có thể last-writer-wins. `os.replace` chỉ ngăn file rách, không ngăn mất cập nhật.

#### Khắc phục

Ưu tiên DB-backed repository có revision/CAS và trả `409 Conflict` khi stale. Phương án khác là PATCH theo document type. Interprocess file lock chỉ đủ cho một host và không giải quyết stale-editor conflict.

### P1.7. Static quality gate đang đỏ trên clean `main`

Lệnh thực tế:

```text
npm run lint:debt
raw_colors=915
baseline=842
FRONTEND_DEBT_INCREASED
```

- Baseline: `scripts/check_frontend_debt.py:12-18`.
- Gate nằm trong `check:static`: `package.json:32`.
- CI chạy gate tại `.github/workflows/ci.yml:53-56`.
- Phần tăng gần đây chủ yếu xuất hiện ở `views/css/not-found.css`.

#### Khắc phục

Đưa màu mới về design tokens/semantic tokens; không nâng baseline từ 842 lên 915 để làm CI xanh giả.

## 4. P2 — Độ bền, concurrency và kiến trúc

### P2.1. Authorization TOCTOU trong mutation thành viên và quyền

- Add member kiểm authority tại `backend/api/org_routes.py:615-619` nhưng không serialize/recheck actor trước mutation.
- Remove member kiểm tại `backend/api/org_routes.py:854-858`, sau đó mới lấy invariant lock tại dòng 859.
- Update document-export grants kiểm tại `backend/api/org_routes.py:1323-1332`, không serialize với role mutation.
- Role mutation dùng invariant lock tại `backend/auth/auth_routes.py:1682-1731`.

Một request có thể đọc actor là manager, request khác demote và commit, request đầu vẫn tiếp tục mutation. Cần lấy organization invariant lock trước authorization rồi đọc lại account/membership trong cùng transaction. Phải có PostgreSQL concurrency tests.

### P2.2. Filesystem mutation và audit Word không nguyên tử

- Assignment config được ghi trước required audit: `backend/documents/routes_docx.py:1184-1203`.
- Availability/active template cũng ghi trước audit: `backend/documents/routes_docx.py:1300-1327`.
- Upload, replace, delete tại `backend/documents/routes_docx.py:1340-1510` không có audit nghiệp vụ tương ứng.
- Rename/delete file trước khi update config tại `backend/documents/routes_docx.py:407-471` có thể để file và config lệch nhau.

Nếu audit thất bại, API có thể trả lỗi nhưng filesystem đã thay đổi. Cần DB state machine hoặc transactional outbox + filesystem reconciler; audit intent/result bắt buộc và fault-injection tests.

### P2.3. Config corruption bị nuốt thành cấu hình rỗng

`backend/documents/custom_exporter.py:442-451` bắt `OSError`, `JSONDecodeError`, `TypeError` rồi trả `{}`. Lần ghi tiếp theo có thể ghi đè và xóa cấu hình còn khôi phục được.

Nên fail rõ ràng, quarantine file lỗi, giữ backup/revision và không cho mutation tiếp tục trên synthetic empty config.

### P2.4. Hai nguồn business policy Word

- Backend source: `backend/documents/word_publication_policy.py:32-113`.
- API đã trả `documentTypes`: `backend/documents/routes_docx.py:668-675`.
- Frontend normalize response tại `frontend/documents/WordPublicationTemplateConfig.js:47-79` nhưng render vẫn dùng manifest tĩnh `frontend/documents/WordPublicationPolicy.js:28-156`.
- `tests/test_word_publication_template_assignments.py:491-497` chỉ regex document ID, không so label, applicability, scope, context hoặc export mapping.

Hiện ID chưa drift, nhưng metadata có thể lệch mà test vẫn xanh. Nên có một nguồn contract duy nhất hoặc parity test toàn metadata.

### P2.5. Race khi đổi workspace trong lúc tải Word config

- Success path có lease check, nhưng catch tại `frontend/documents/WordPublicationTemplateConfig.js:90-109` luôn ghi lỗi global.
- Caller vẫn render/finalize tại `frontend/documents/WordPublication.js:598-607` và `frontend/documents/WordTemplateAssignments.js:527-539`.
- State `_wordPublication*`/`_wordTemplateAssignmentState` không được reset/keyed theo workspace.

Request workspace A bị abort khi chuyển sang B vẫn có thể ghi lỗi hoặc render stale state lên B. Cần stale no-op trong catch/finally, guard render và state keyed theo workspace token.

### P2.6. Asset loader không retry và có CSS race

`frontend/shared/externalAssets.js:5-49` có ba vấn đề:

1. Rejected Promise bị giữ vĩnh viễn trong map và node lỗi không bị xóa.
2. `loadStyleOnce()` kiểm DOM `<link>` trước in-flight map, nên caller thứ hai có thể resolve trước khi CSS tải xong.
3. Script `onload` không xác nhận `window[globalName]`; listener gắn vào script đã phát load có thể treo mãi.

Cần state machine `loading/loaded/error`, cleanup khi reject, validate global và behavioral tests cho concurrent load + fail/retry.

### P2.7. Service worker có thể thay cache tốt bằng cache rỗng

- Manifest non-OK trả `[]`: `views/service-worker.js:6-27`.
- Install vẫn `skipWaiting`, kể cả catch: `views/service-worker.js:30-35`.
- Activate xóa cache cũ rồi `clients.claim`: `views/service-worker.js:38-45`.

Hai failure mode:

- Lỗi manifest tạm thời vẫn activate worker có cache rỗng.
- Update thành công vẫn takeover tab bundle cũ; lazy chunk/CSS hash cũ có thể mất sau khi server thay artifact.

Cần fail install nếu precache chưa hoàn chỉnh, chỉ evict sau khi cache mới commit, và giữ cache cũ khi còn client dùng build cũ hoặc không claim client cũ ngay.

### P2.8. Upgrade preflight/runbook không theo kịp schema

- Schema hiện đăng ký đến v62: `backend/db/upgrades.py:2542-2616`.
- `backend/db/upgrade_preflight.py:12-16` chỉ biết v36, v44-v47.
- `deploy/README.md:32-43` chỉ link runbook đến v47; runbook v48 có file nhưng chưa được link.

Các bước thiếu preflight đáng chú ý:

- v50/v54 thay unique constraints.
- v59 rewrite websocket rows.
- v61 rewrite tenant name.

Cần duplicate/cardinality/lock/candidate-org preflight cho v49-v62, dry-run và rollback rehearsal.

### P2.9. Hai Playwright spec không được CI discover

- `playwright.config.mjs:4-18` âm thầm `testIgnore` spec nếu thiếu env.
- Với env tương đương CI, `playwright --list` chỉ thấy 12 case trong 3 spec.
- `contractor-violation.spec.mjs` và `procurement-plan-import.spec.mjs` biến mất.
- `e2e/specs/procurement-plan-import.spec.mjs:38` còn chờ `#btn-open-procurement-import`, trong khi UI hiện dùng inline lookup ở `views/modals/modal_kehoach.html:31-40`.

CI nên fail nếu required spec bị ignore. Nếu wizard cũ đã retire, xóa spec cũ và viết E2E cho flow inline hiện hành.

### P2.10. Coverage và lint gates còn nhiều điểm mù

- Python global coverage floor chỉ 45%: `package.json:7`.
- Một số critical thresholds chỉ 8-12% line và 0-3% branch: `scripts/check_critical_coverage.py:13-28`.
- JS floor 45% line; critical ratchet chỉ bao phủ 14 module: `scripts/run_js_coverage.mjs:20-23`, `scripts/check_js_critical_coverage.mjs:5-20`.
- Ruff mặc định chỉ chọn `E9`, `F63`, `F7`, `F82`: `pyproject.toml:40`.
- Python quality ratchet chấp nhận 117 `BLE001` và 116 `S608`: `scripts/check_python_quality.py:15-21`.
- ESLint complexity threshold là 80: `eslint.config.js:141`.

Ưu tiên interaction/integration tests cho authorization, persistence, export, error và workspace-switch seam; không chỉ thêm source-regex tests.

### P2.11. Dependency monitoring chưa đầy đủ

- Scheduled security workflow chỉ audit npm: `.github/workflows/security.yml:14-24`.
- Dependabot chỉ cấu hình GitHub Actions: `.github/dependabot.yml:3-9`.
- Npm full/prod và Python runtime audit hiện đều 0 CVE đã biết.

Nên thêm weekly `pip-audit` và Dependabot cho npm/pip; update dependency theo PR nhỏ và chạy full CI.

## 5. P3 — Code chết, legacy inert và rác

### P3.1. Offboarding successor flow không thể chạy

- `_assignments_requiring_successor()` luôn trả `[]`: `backend/api/org_routes.py:133-141`.
- Nhánh `SUCCESSOR_REQUIRED` và transfer tại `backend/api/org_routes.py:890-994` vì thế không thể được kích hoạt.
- Frontend vẫn giữ modal/retry tại `frontend/admin/AdminUserController.js:1033-1088`.

Code hiện ghi rõ assignment là optional. Không được tự khôi phục successor requirement. Nếu chủ sản phẩm xác nhận semantics optional, cần deprecate request fields rồi xóa backend/frontend branch và test cũ.

### P3.2. Tàn dư staged-approval policy

- API vẫn nhận `stagedApprovalAuthorized`: `backend/lot_lifecycle_routes.py:195` và dòng 233-241.
- DB vẫn lưu flag/basis: `backend/lot_lifecycle_service.py:226-276`.
- `PackageLifecycleContext.staged_approval_authorized` không được truyền vào lifecycle context.
- `STAGED_APPROVAL_NOT_AUTHORIZED` và một số blocker code không có runtime caller: `backend/lot_selection_lifecycle.py:73`.

Chỉ deprecate API/schema theo ADR + migration sau khi xác nhận giá trị audit/history cần giữ.

### P3.3. Sensitive read capability schema chỉ còn là legacy no-op

- `backend/shared/sensitive_data.py:24-57` bỏ cursor/role/user/org và luôn trả full record.
- `sensitive_record_read_capabilities` vẫn tồn tại trong fresh schema: `backend/db/schema.py:1876-1890`.
- Migrations v56/v57 vẫn là lịch sử phát hành: `backend/db/upgrades.py:2205-2237`.

No-op hiện phù hợp business contract. Không được tái kích hoạt masking hoặc capability đọc riêng. Nếu retire, phải dùng ADR, compatibility analysis, migration mới và full-record regression tests.

### P3.4. Legacy procurement wizard được test giữ sống

Các export không có production caller, chỉ có test reference:

- `reconcileOpeningDrafts` — `frontend/procurement/OpeningImportWizard.js:72`.
- `originatePackageImportFlow` — `frontend/procurement/ProcurementInlineLookup.js:482`.
- `openProcurementImportWizard` — `frontend/procurement/PlanImportWizard.js:977`.
- `originatePlanImportFlow` — `frontend/procurement/PlanImportWizard.js:1041`.
- `openProcurementNoticeImportWizard` — `frontend/procurement/NoticeImportWizard.js:246`.

`frontend/packages/BiddingWorkflows.js:10-15` dùng `export *`, còn `frontend/app/moduleRegistry.js:14-34` gắn mọi function export lên controller prototype. Vì vậy audit cấp module vẫn báo reachable. Xác nhận wizard cũ đã retire trước khi xóa modal/class/test; giữ flow sequential/inline đang chạy.

### P3.5. Client-side winning-goods export cũ

- Builder và download client-side tại `frontend/packages/WinningGoodsExcel.js:5-152` chỉ còn test dùng.
- Selector projection tại `frontend/packages/winningGoodsSelectors.js:1-189` chỉ còn test dùng.
- Production dùng `downloadOfficialWinningGoodsWorkbook()` tại `frontend/packages/WinningGoodsExcel.js:154` và chỉ dùng `hasWinningGoodsExportScope()` tại `frontend/packages/winningGoodsSelectors.js:190`.

Có thể xóa gần 300 dòng builder/selector cũ sau khi chuyển hoặc bỏ các test bảo vệ implementation không còn chạy production.

### P3.6. Symbol không có production caller

Danh sách đã kiểm chứng:

- `resolvedWordPublicationTemplate` — `frontend/documents/WordPublicationTemplateConfig.js:132`.
- `selectContractorVersionForDate` — `frontend/partners/contractorVersionBinding.js:87`.
- `PLAN_VERSION_DRAFT_OWNED_TABLES` — `frontend/plans/PlanVersionDraftSession.js:24`.
- `unifiedSelectListenerRegistered`, `hasUnifiedSelectListener`, `markUnifiedSelectListenerRegistered` — `frontend/shared/runtimeState.js:8`, dòng 23-24.
- `RouteRegistry.navigate()` — `frontend/app/RouteRegistry.js:93-108`.
- `fillPlanFormFromProcurementDraft()` — `frontend/procurement/ProcurementDraftWorkflow.js:851`.
- `preparePackageSnapshot()` — `frontend/shared/VersionedEntityService.js:34`.
- `timelineProgress()` — `frontend/packages/timelineRuleEngine.js:485`.
- `shouldShowBidderGoodsTab()` — `frontend/packages/bidderGoodsSelectors.js:5`; runtime logic nằm ở `detailedEvaluationRules.js`.
- `_TRANSLATED_TEMPLATES_CACHE` — `backend/documents/custom_exporter.py:864`.
- Tham số `project_root` của `_collect_image_tasks()` không còn tác dụng: `backend/documents/custom_exporter.py:1089-1143`.

Helper chỉ phục vụ test nên chuyển sang test utilities hoặc đánh dấu internal: `getPrototypeModuleInventory`, `getSyncActivitySnapshot`, `evaluationExcelColumnLabel`.

### P3.7. Policy test đang trỏ vào implementation chết

`frontend/packages/LifecyclePolicy.js` chứa `lifecycleContract`, transitions, `fieldPolicy`, `workflowStep` chỉ được tests dùng. Runtime form lấy `model.domainContract.packageFieldPolicy` tại `frontend/app/BiddingControllerForms.js:723-759`.

Đây là dead policy nguy hiểm: test có thể xanh trên contract không chạy production. Test phải chuyển sang authoritative runtime domain contract trước khi xóa file.

### P3.8. Search trang 404 không thực hiện tìm kiếm

`frontend/errors/NotFoundPage.js:85-123` điều hướng đến `/ke-hoach`, `/goi-thau` hoặc `/tong-quan?q=...`, nhưng frontend không có consumer cho query param `q`. Người dùng được đưa tới danh sách chưa lọc.

Hoặc hydrate list filter từ `q`, hoặc đổi UI/copy thành điều hướng thay vì gọi là tìm kiếm.

### P3.9. Asset và tài liệu rác

- Root `favicon.png` được track, khoảng 1.87 MiB, không có runtime consumer.
- Runtime dùng `views/assets/favicon.png`, khoảng 41 KiB, tại `views/index.html:45-46`.
- `deploy/production-security-information.md` và `docs/production-security-information.md` có cùng SHA-256; nên chọn một nguồn canonical và link từ vị trí còn lại.

Root favicon chỉ nên xóa sau khi xác nhận nó không phải source-design asset ngoài runtime workflow.

### P3.10. Local ignored bloat và secret sprawl

- `release` khoảng 963 MiB, `data` khoảng 1.79 GiB, `node_modules` khoảng 140 MiB; đều không phải tracked repo bloat.
- Không được xóa `data` nếu chưa xác nhận đó không phải runtime data/backup.
- `.env` và `.env.before-staging` đều ignored và chưa từng xuất hiện trong Git history.
- `.env.before-staging` có nhiều trường nhạy cảm không rỗng; nếu không còn dùng, nên xóa an toàn hoặc chuyển secret manager. Không đưa giá trị vào log/tài liệu.

## 6. Nợ kiến trúc

### 6.1. Package detail module là interface nông

`frontend/packages/detail/PackageDetailModule.js:14-37` yêu cầu `route`, `store`, `lifecyclePolicy` nhưng chủ yếu lưu lại; `navigate/save` chỉ chuyển tiếp callback. Caller tại `frontend/packages/GoiThauDetail.js:173-181` vẫn phải biết toàn bộ implementation detail.

Hoặc đưa route/store/lifecycle orchestration thực sự vào module để tạo locality, hoặc bỏ wrapper. Không thay lifecycle semantics khi refactor.

### 6.2. Controller surface quá rộng

`frontend/packages/BiddingWorkflows.js` dùng nhiều `export *`; `frontend/app/moduleRegistry.js:14-34` tự động gắn mọi exported function lên prototype. Inventory ghi nhận khoảng 115 controller commands, gồm cả helper nội bộ.

Nên dùng explicit command manifest và chỉ expose UI commands thật sự. Dead-code audit phải kiểm symbol/export reachability, không chỉ import graph.

### 6.3. Module lớn và complexity gate cao

Các hotspot đáng tách theo transaction/use-case boundary:

- `backend/auth/auth_routes.py` khoảng 1,994 dòng.
- `backend/procurement_import/routes.py` khoảng 2,095 dòng.
- `views/css/views.css` khoảng 6,456 dòng.
- `views/css/components.css` khoảng 3,321 dòng.

Không nên chia file cơ học; ưu tiên deep modules quanh authorization, persistence, export và workflow boundaries.

## 7. Kết quả kiểm chứng

### Pass

- Pytest discovery: 1,495 tests collected.
- Các batch targeted backend/security/session/record visibility/Word đều pass.
- JavaScript full coverage run: 1,288 tests pass, 0 fail.
- JavaScript coverage khoảng 52.9% line, 64.7% branch, 69.6% function.
- `lint:python` pass.
- `lint:security` và Trusted Types checks pass.
- `lint:modules`: 299 module, 0 import cycle.
- Module-level dead-code audit báo 299/299 module reachable.
- Encoding, schema-runtime, bootstrap-assets và migration fixture checks pass.
- Npm audit full/prod: 0 vulnerability đã biết.
- Python runtime `pip-audit`: 0 vulnerability đã biết.

### Fail

- `npm run lint:debt`: `raw_colors 915 > baseline 842`.

### Không chạy và lý do

- Không chạy full Python suite vì integration tests có thể đọc `TEST_DATABASE_URL` từ local `.env` và mutate database.
- Không chạy production build vì build ghi/xóa `dist`, `release` và private-symbol artifacts; audit được giữ read-only.
- Local gitleaks không chạy được vì binary chưa cài và Docker daemon không hoạt động. CI đã có full-history redacted secret scan.

### Giới hạn của các gate hiện tại

Kết quả `299/299 module reachable` không chứng minh không có dead symbol. Reachability script kiểm import graph, chịu ảnh hưởng của `export *` và regex; controller inventory hiện chỉ in `MANUAL_REVIEW_DO_NOT_DELETE`, không fail khi có export test-only mới.

## 8. Thứ tự remediation đề xuất

1. Khóa tenant/auth leaks: user directory, durable job demotion và employee-persona document grants.
2. Kiểm kê deployment v61; chặn rollout hoặc lập remediation plan theo mapping đã xác nhận.
3. Sửa Word tenant-scoped media và thêm end-to-end DOCX media tests.
4. Chuyển Word config sang revision/CAS; xử lý audit/filesystem transaction boundary.
5. Làm `lint:debt` xanh bằng design tokens.
6. Sửa service-worker upgrade, workspace stale state và asset loader retry.
7. Bổ sung v49-v62 preflight/runbook, E2E discovery guard và critical coverage ratchets.
8. Chỉ dọn legacy schema/policy/workflow sau ADR, product confirmation, compatibility plan và regression tests.

## 9. Các quyết định cần chủ sản phẩm xác nhận

1. Mapping chính xác các tenant bị migration v61 đổi nhầm, nếu migration đã chạy.
2. Offboarding assignment có chính thức là optional và không yêu cầu successor hay không.
3. Staged approval metadata cần giữ bao lâu và có còn nằm trong API contract hay không.
4. Legacy procurement wizard đã chính thức retire hay vẫn cần user entrypoint.
5. Root `favicon.png` có phải source-design asset ngoài runtime hay không.

Không quyết định nào trong danh sách này được phép dùng làm lý do thay đổi masking, full-record read contract, role semantics hoặc capability semantics khi chưa có phê duyệt và ADR tương ứng.
