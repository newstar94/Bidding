# Rà soát toàn bộ BiddingFlow — 2026-08-25

## Trạng thái khắc phục — cập nhật cùng ngày

Đã sửa và có kiểm thử hồi quy:

- H1: migration v77 tạm tháo trigger bất biến, dọn activity legacy và dựng lại trigger trong cùng transaction.
- H3: các mutation Super Admin khóa và xác minh lại session, tài khoản, role và step-up ngay trong transaction ghi.
- H4: upload tài liệu dài xác minh lại session sau khi kiểm tra/lưu file tạm và trước khi commit metadata.
- M1, M2 và L1: bỏ runtime/config còn sót của Trung tâm hồ sơ; readiness đối chiếu toàn bộ schema contract.
- M3: Conflict Center chỉ được frontend gọi khi session bootstrap quảng bá `conflict-center-v1`.
- M5: loading dùng chung cô lập nền bằng `inert`, quản lý focus và giữ stack nhiều tác vụ.
- M6: mã lỗi Word từ backend được giữ qua helper tải file và luồng xuất hợp đồng.
- M7: mỗi lần retry dựng lại `X-Active-Org` từ workspace hiện hành.
- M8: dashboard Super Admin báo lỗi rõ và không biến response lỗi thành số 0 hợp lệ.
- M9: progressbar đánh giá có accessible name.
- M10: nguồn pháp lý chỉ nhận URL HTTP(S) có host, không có credentials; frontend chặn URL cũ không an toàn.
- M12: username không tồn tại vẫn chạy một lượt Argon2 giả qua cùng CPU lane để giảm chênh lệch timing.

Chưa đóng và không sửa tắt:

- H2: cần authority/digest chính xác cho toàn aggregate Word và cập nhật ADR 0015. Chỉ bỏ `syncRevision` sẽ tránh false conflict nhưng có thể xuất snapshot cũ khi phụ thuộc thật thay đổi.
- H5: cần thay mật khẩu Google gửi qua email bằng token đặt mật khẩu một lần, có expiry/replay protection; đây là migration và compatibility flow riêng.
- M11: OTP đăng ký cần HMAC key độc lập, secret rotation và migration/compatibility cho mã đang còn hạn.
- M13: password reset và Google cần audit/outbox bắt buộc cùng transaction; chưa đổi transaction contract trong lượt này.
- Các mục “cần quyết định sản phẩm”, dữ liệu pháp lý và placeholder vẫn giữ nguyên, không tự thay đổi semantics hoặc tự bịa dữ liệu.

Kết quả xác minh sau sửa: backend `1828 passed`, frontend `1347 passed`; static, security lint, secure build, schema contract `106/501/92` và `151` FK index đều đạt.

## Kết luận điều hành

Trạng thái hiện tại **chưa sẵn sàng phát hành production**.

- Không phát hiện lỗi mức Critical.
- Có 5 phát hiện High, 13 phát hiện Medium, 4 nhóm Low/cần dọn và 3 cảnh báo readiness/chất lượng.
- Không phát hiện bằng chứng tenant isolation, module permission, assignment scope, record authorization hoặc contract hiển thị dữ liệu trong `AGENTS.md` bị phá vỡ.
- Audit này chỉ đọc. Không sửa code, schema, migration, quyền, response hay expected test.

Hai lỗi High đã được tái hiện trực tiếp:

1. Migration v77 thất bại trên DB v76 có activity `procurement_case`.
2. Xuất Word nền thất bại khi một mutation không liên quan làm đổi phiên bản đồng bộ toàn workspace.

Ba lỗi High bảo mật được xác nhận bằng call path/transaction boundary; chưa thực hiện khai thác phá hoại trên DB thật.

## Phạm vi và phương pháp

- Cơ sở dữ liệu: schema, v1→v77, migration, trigger, FK, index, tenant key, audit chain và readiness.
- Backend: auth/session, CSRF/origin/CORS, role/module/assignment/record scope, upload/download, Word job, worker/sandbox, AI, SSRF, SQL/path/archive safety.
- Frontend: route/module graph, state/sync/offline, workspace, phân quyền hiển thị, Word/loading, error handling, XSS/Trusted Types và trợ năng.
- Nghiệp vụ: version lineage, snapshot bất biến, lịch sử, phân lô, liên danh, Word publication và contract trong `AGENTS.md`/`CONTEXT.md`.
- Tự động: unit/integration, coverage, security lint, dependency audit, secure build, package smoke, schema contract, FK index audit và các bằng chứng E2E đã có.

## Phát hiện High

### H1. Migration v77 bị chặn bởi trigger bất biến

- [upgrades.py](D:/Bidding/backend/db/upgrades.py:2925) `DELETE` activity `procurement_case` trước khi bỏ constraint/drop bảng.
- [postgres_schema.py](D:/Bidding/backend/db/postgres_schema.py:1017) cài trigger cấm mọi `UPDATE/DELETE` trên `nhat_ky_thuc_hien`.
- Reproduction an toàn trên schema tạm: nâng v1→v76, chèn một activity, chạy v77.
- Kết quả: `CheckViolation`, SQLSTATE `23514`, `AUDIT_LOG_IMMUTABLE`.
- Ảnh hưởng: DB có lịch sử Hồ sơ không thể nâng lên v77; transaction migration rollback.
- Khoảng trống test: migration chain hiện không seed activity này.

### H2. Word job phụ thuộc phiên bản toàn workspace

- [SyncCoordinator.js](D:/Bidding/frontend/app/SyncCoordinator.js:260) lấy `syncVersion` toàn workspace.
- [WordPublication.js](D:/Bidding/frontend/documents/WordPublication.js:499) gửi phiên bản đó khi tạo job.
- [document_job_policy.py](D:/Bidding/backend/documents/document_job_policy.py:324) từ chối nếu `sync_metadata.current_version` thay đổi, kể cả bản ghi đang xuất không đổi.
- E2E liên danh đã tái hiện `409 DOCUMENT_EXPORT_SOURCE_CHANGED`.
- Ảnh hưởng: người dùng khác hoặc tác vụ nền sửa bất kỳ dữ liệu nào trong tenant có thể làm Word đang render thất bại; tài liệu có ảnh càng lâu càng dễ gặp.

### H3. Race thu hồi quyền ở thao tác Super Admin

- [admin_user_routes.py](D:/Bidding/backend/auth/admin_user_routes.py:537), [auth_routes.py](D:/Bidding/backend/auth/auth_routes.py:1826) và [auth_routes.py](D:/Bidding/backend/auth/auth_routes.py:1995) kiểm tra session/step-up ở DB read lane, sau đó mới xếp transaction ghi.
- Transaction ghi dùng actor đã chụp trước đó nhưng không đọc/khóa lại session, tài khoản và step-up của actor.
- Ảnh hưởng: request đã qua bước đầu có thể commit sau khi session/quyền quản trị vừa bị thu hồi.
- Đây là race condition đã xác nhận từ code path; cần regression test điều khiển interleaving trước khi sửa.

### H4. Upload dài có thể commit sau khi session bị thu hồi

- [package_document_routes.py](D:/Bidding/backend/documents/package_document_routes.py:344) xác minh session trước khi đọc/kiểm tra và lưu file.
- Transaction cuối tại [package_document_routes.py](D:/Bidding/backend/documents/package_document_routes.py:452) kiểm tra lại record/module/assignment bằng session object cũ, nhưng không xác minh lại session/tài khoản.
- Ảnh hưởng: session bị revoke trong lúc upload/validate file vẫn có cửa sổ commit metadata và file.

### H5. “Mật khẩu tạm” Google không có vòng đời tạm

- [google_auth_routes.py](D:/Bidding/backend/auth/google_auth_routes.py:126) email mật khẩu tạm.
- [google_auth_routes.py](D:/Bidding/backend/auth/google_auth_routes.py:312) lưu nó như mật khẩu đăng nhập thông thường.
- Không có cờ bắt buộc đổi, hết hạn hoặc chỉ dùng một lần.
- Ảnh hưởng: bí mật được gửi qua email vẫn có hiệu lực vô thời hạn cho đến khi người dùng tự đổi.

## Phát hiện Medium

### M1. Activity API vẫn truy vấn bảng v77 đã xóa

- [routes.py](D:/Bidding/backend/activity/routes.py:15) vẫn nhận `procurement_case`; nhánh dòng 61–70 truy vấn hai bảng đã drop.
- Route vẫn đăng ký tại [app.py](D:/Bidding/backend/app.py:999).
- Xác minh read-only trên DB v77: `UndefinedTable`, SQLSTATE `42P01`.
- Người dùng đã đăng nhập có thể làm endpoint trả 500.

### M2. Startup production chỉ kiểm tra một phần schema

- [startup.py](D:/Bidding/backend/startup.py:82) chỉ liệt kê 9 bảng bắt buộc.
- [startup.py](D:/Bidding/backend/startup.py:715) kiểm version, 9 bảng và FK chưa validate; không đối chiếu đủ 106 bảng, constraint, index và trigger.
- DB gắn version 77 nhưng thiếu đối tượng ngoài danh sách có thể vẫn được báo ready.

### M3. Frontend luôn gọi Conflict Center khi tính năng tắt

- [startupReconciliation.js](D:/Bidding/frontend/app/startupReconciliation.js:325) luôn gọi refresh.
- [BiddingModel.js](D:/Bidding/frontend/app/BiddingModel.js:827) luôn `GET /api/conflict-drafts`.
- Backend tắt tính năng trả `404 CONFLICT_CENTER_DISABLED`, gây lỗi lặp, nhiễu log/hiệu năng và làm nhiều suite E2E đỏ.

### M4. UI chưa phản ánh module permission hiện hành

- [BiddingControllerUI.js](D:/Bidding/frontend/app/BiddingControllerUI.js:23) chủ yếu guard tab quản trị theo role.
- Nút/mở form nghiệp vụ chưa dùng cùng permission matrix với backend.
- Backend vẫn chặn đúng, nên chưa phải bypass; người dùng có thể thấy/mở thao tác rồi mới bị từ chối.
- Nếu sửa phải chỉ phản chiếu semantics hiện hữu, không tự đổi role/module/record scope.

### M5. Loading toàn ứng dụng không cô lập bàn phím và không quản lý nhiều tác vụ

- [LongTaskLoading.js](D:/Bidding/frontend/shared/LongTaskLoading.js:26) dùng overlay `role=status`.
- [LongTaskLoading.js](D:/Bidding/frontend/shared/LongTaskLoading.js:173) thay token tác vụ đang chạy bằng token mới; không có reference count/queue.
- Overlay chặn chuột bằng CSS nhưng không `inert`, không chuyển focus và không giữ focus.
- Người dùng bàn phím vẫn có thể kích hoạt control phía sau; mutation đó cũng có thể làm Word gặp H2.

### M6. Frontend làm mất mã lỗi Word

- [workflow_helpers.js](D:/Bidding/frontend/shared/workflow_helpers.js:7) chỉ đọc `payload.error`.
- Job API trả `{code}` tại [document_job_routes.py](D:/Bidding/backend/documents/document_job_routes.py:49).
- [ContractWordExport.js](D:/Bidding/frontend/contracts/ContractWordExport.js:35) bọc lại thành lỗi chung.
- Người dùng không biết lỗi là source changed, hết hạn hay bị thu hồi quyền.

### M7. Retry sau phục hồi workspace giữ header tổ chức cũ

- [apiClient.js](D:/Bidding/frontend/shared/apiClient.js:210) tạo `headers` và `X-Active-Org` một lần trước vòng retry.
- [apiClient.js](D:/Bidding/frontend/shared/apiClient.js:287) retry sau `recoverActiveOrgAccess()` nhưng không dựng lại header.
- Backend vẫn authorize tenant nên chưa thấy vượt tenant; retry có thể tiếp tục dùng workspace cũ và thất bại/đụng sai context.

### M8. Dashboard Super Admin che lỗi API

- [DashboardView.js](D:/Bidding/frontend/app/DashboardView.js:604) gọi song song hai API nhưng không có error boundary.
- Response người dùng lỗi được đổi thành `[]`; lỗi transport có thể thành promise rejection.
- Dashboard có thể hiển thị số 0 như dữ liệu hợp lệ hoặc không render rõ lỗi.

### M9. Progressbar đánh giá thiếu accessible name

- [BidEvaluationProgressView.js](D:/Bidding/frontend/packages/BidEvaluationProgressView.js:31) có `role=progressbar` và value nhưng thiếu `aria-label/aria-labelledby`.
- Axe E2E đã xác nhận ở viewport 320px.

### M10. URL nguồn pháp lý chưa được giới hạn scheme/host

- [service.py](D:/Bidding/backend/legal_versioning/service.py:49) chỉ kiểm chuỗi/độ dài `sourceUri`.
- [LegalBindingPanel.js](D:/Bidding/frontend/legal-versioning/LegalBindingPanel.js:57) gắn trực tiếp vào `href`.
- CSP và `noopener noreferrer` giảm XSS/opener, nhưng chưa bảo đảm link là nguồn `https/http` đáng tin.
- Tính năng hiện feature-flagged; đây là rủi ro khi bật.

### M11. OTP đăng ký được lưu dạng rõ

- [otp_routes.py](D:/Bidding/backend/auth/otp_routes.py:200) sinh OTP 6 số và [otp_routes.py](D:/Bidding/backend/auth/otp_routes.py:203) lưu trực tiếp trong `tai_khoan` trong 10 phút.
- Quyền đọc DB trong cửa sổ đó có thể dùng mã để kích hoạt tài khoản qua API.

### M12. Timing đăng nhập có thể giúp dò tài khoản

- [auth_routes.py](D:/Bidding/backend/auth/auth_routes.py:421) trả ngay nếu username không tồn tại.
- Tài khoản tồn tại mới chạy Argon2 tại dòng 425–431.
- Rate limit và Turnstile giảm tác động nhưng không loại khác biệt thời gian.

### M13. Một số thay đổi bảo mật commit trước audit best-effort

- [password_reset_service.py](D:/Bidding/backend/auth/password_reset_service.py:105) đổi mật khẩu/revoke session và commit ở dòng 144.
- Audit được gọi sau đó tại [otp_routes.py](D:/Bidding/backend/auth/otp_routes.py:548), không cùng transaction và không `required=True`.
- Google audit cũng chạy background sau commit tại [google_auth_routes.py](D:/Bidding/backend/auth/google_auth_routes.py:419).
- Khi audit storage lỗi, thay đổi bảo mật vẫn tồn tại nhưng thiếu dấu vết bắt buộc.

## Cần quyết định sản phẩm trước khi sửa

API OTP/đăng ký trả phản hồi khác nhau cho username/email đã có, tài khoản không tồn tại, đã xác minh, sai mã và hết hạn tại [otp_routes.py](D:/Bidding/backend/auth/otp_routes.py:189) và [otp_routes.py](D:/Bidding/backend/auth/otp_routes.py:355). Điều này cho phép dò trạng thái tài khoản, nhưng chuẩn hóa response có thể đổi UX/API contract. Không tự thay đổi khi chưa được chủ sản phẩm duyệt.

## Low / dọn kỹ thuật

### L1. Gỡ Trung tâm hồ sơ chưa sạch trong source/config

- Registry còn tên bảng đã nghỉ tại [aggregate_mutability.py](D:/Bidding/backend/sync/aggregate_mutability.py:30) và [aggregate_policy.py](D:/Bidding/backend/versioning/aggregate_policy.py:50).
- `.env` và `.env.example` vẫn còn/bật cờ Hồ sơ, Lịch và Xuất hàng loạt.
- [paths.py](D:/Bidding/backend/shared/paths.py:24) vẫn tạo `BULK_EXPORT_DIR` không có consumer.
- Secure build sau audit đã sạch route/module/API cũ.

### L2. Bảng capability đọc nhạy cảm là legacy no-op

- [schema.py](D:/Bidding/backend/db/schema.py:1881) vẫn tạo `sensitive_record_read_capabilities`.
- Runtime hiện không dùng bảng; DB có 0 dòng.
- Có thể retire bằng migration mới + ADR/regression test, bảo toàn contract “đọc đầy đủ bản ghi đã được cấp quyền”. Không sửa migration đã phát hành.

### L3. DB development chạy bằng role toàn quyền

- Cấu hình runtime hiện nối bằng PostgreSQL role `postgres`, dù `.env` khai báo `biddingflow_app`.
- Production từ chối cấu hình này; development không từ chối.
- Không phải lỗi quyền nghiệp vụ nhưng tăng hậu quả nếu môi trường dev bị lộ mạng.

### L4. Nợ kỹ thuật tĩnh còn cao

- Baseline Python cho phép 114 vị trí SQL động và 114 khối bắt lỗi rộng; audit không thấy injection đã xác nhận, nhưng baseline lớn làm giảm tín hiệu kiểm tra.
- Frontend debt report: 59 direct state writes, 512 runtime styles và 930 màu raw.

## Readiness, hiệu năng và coverage

### R1. Legal production readiness đang bị chặn

- `check_legal_readiness.py --production-public` thất bại với 27 `LEGAL_FACT_UNAPPROVED` và 27 `LEGAL_PLACEHOLDER_PRESENT`.
- Placeholder còn trong [privacy.html](D:/Bidding/views/legal/privacy.html:36), [security.html](D:/Bidding/views/legal/security.html:20) và [terms.html](D:/Bidding/views/legal/terms.html:42).

### R2. Coverage tổng đạt nhưng seam nhạy cảm còn mỏng

- Backend tổng: 62,51%.
- `auth_routes.py`: khoảng 12% line / 5% branch.
- `google_auth_routes.py`: khoảng 13% line / 0% branch.
- `password_reset_service.py`: khoảng 16% line / 0% branch.
- `conflict_resolution/routes.py`: khoảng 13% line / 0% branch.
- `package_document_routes.py`: khoảng 12% line / 4% branch.
- `sync/version_api.py`: 0%.
- Đây là rủi ro lọt regression, không phải bằng chứng lỗ hổng.

### R3. Performance gate debug thất bại; production chưa được đo

- Môi trường debug: cold P95 khoảng `1578 ms` so với ngưỡng `800 ms`; warm P95 khoảng `1074 ms` so với `325 ms`.
- 138 ES modules, khoảng 1,89 MB ở cold load; long task vẫn dưới 100 ms.
- Secure build vẫn có bundle `BiddingWorkflows` khoảng 930 KB raw và `workspaceBootstrap` khoảng 431 KB raw.
- Cần benchmark secure build/production trước khi kết luận mức độ người dùng thật.

## Các kiểm tra đạt

- Backend: `1815 passed`; coverage gate và 16 critical-module ratchets đạt.
- Frontend: `1345 passed`; critical JS coverage gate đạt.
- Static: compile, schema runtime, migration fixture, Python quality, encoding, module graph, dead-code audit và E2E discovery đạt.
- Frontend graph: 311/311 module reachable, 0 static import cycle.
- Dependency: `npm audit` 0 lỗ hổng trong 294 package; `pip-audit` không thấy advisory trong requirements hiện tại.
- Security lint và Trusted Types đạt; không thấy secret/private key bị commit.
- Secure build đạt: 316 module transformed, 64 bundle được kiểm tra; vendor/SheetJS/archive guards đạt.
- Production package smoke đạt: 556 runtime files.
- Security deploy: 73 test đạt; Turnstile local matrix đủ 6 trạng thái đạt.
- PostgreSQL contract: 106 bảng, 501 index, 92 trigger.
- 151 FK đều có index phía bảng con; không có FK chưa validate/index lỗi/trigger tắt.
- Mọi FK giữa hai bảng tenant được rà soát đều có `organization_id`; chưa thấy liên kết chéo tenant ở constraint seam.
- Audit chain hiện tại hợp lệ với 404 dòng.
- HTTP headers kiểm tra cục bộ có CSP, Trusted Types, nosniff, frame policy và Host validation; origin lạ bị từ chối.
- Không phát hiện lỗi xác nhận được ở SQL parameterization, SSRF, path traversal, ZIP/XML bomb, document sandbox hoặc AI vượt record scope.
- Không phát hiện masking/redaction/capability mới trái `AGENTS.md`.

## E2E và giới hạn audit

- Báo cáo E2E chi tiết nằm tại [e2e-recheck-2026-08-25.md](D:/Bidding/docs/testing/e2e-recheck-2026-08-25.md:1).
- Trình điều khiển Browser trực tiếp không khởi tạo được trong phiên trước; Playwright vẫn cung cấp trace/ảnh/video.
- Đây không phải pentest production từ mạng ngoài và không phải chứng minh hình thức rằng mọi dòng code đều không có lỗi.

## Thứ tự khắc phục đề xuất

1. Sửa H1 và thêm migration regression có activity thật trước mọi triển khai v77.
2. Sửa H3–H5 tại transaction/session boundary; thêm test interleaving/revoke.
3. Đổi H2 sang authority gắn exact record/aggregate thay vì global workspace revision.
4. Sửa M1–M3 để loại lỗi 500/404 lặp và tăng readiness.
5. Hoàn thiện audit bắt buộc, OTP/timing và quyết định contract chống enumeration.
6. Sửa loading/error/a11y/workspace retry; sau đó chạy lại toàn bộ E2E.
7. Dọn schema/config legacy bằng migration mới + ADR, không sửa lịch sử migration.
8. Phê duyệt nội dung pháp lý và benchmark secure build trước production.
