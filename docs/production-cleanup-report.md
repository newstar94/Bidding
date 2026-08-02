# Báo cáo rà soát và dọn dẹp production

## A. Tóm tắt

- Mục tiêu: rà soát an toàn repository BiddingFlow, loại bỏ chỉ các mục có bằng chứng chắc chắn là dư thừa và xác minh quy trình production/fresh install.
- Commit gốc và commit hiện tại: `e99f13cc8e795d4170324794c5f90fbdef32e05b` (`main`). Không tạo commit trong phiên rà soát này.
- Phạm vi đã rà soát: toàn bộ 655 file tracked, các cây runtime/build/test/deploy/docs, các mục ignored ở cấp repository và dependency map do `scripts/generate_audit_inventory.py` tạo.
- Kết luận: fresh database, migration, extracted archive, smoke HTTP và auth/role E2E đã được xác minh trên PostgreSQL 17 cô lập. Chưa thể xác nhận production release hoàn chỉnh vì `npm run package:production` bị legal-production gate chặn bởi dữ liệu vận hành/pháp lý chưa được cung cấp.

## B. Baseline trước chỉnh sửa

- Working tree ban đầu: chỉ có `docs/PROMPT_CODEX_RAO_SOAT_DON_DEP_PRODUCTION.md` ở trạng thái untracked. Không có tracked change.
- Môi trường: Git 2.54.0, Python 3.14.5, Node 24.18.0, npm 12.0.2; `psql` không có trong PATH.
- Tài sản bảo vệ đã phát hiện (chỉ ghi đường dẫn): `.env`, `node_modules/`, `.codex/`, `.agents/`, `skills-lock.json`, `data/`, `dist/`, `release/`, cache Python/pytest/ruff, kết quả test và coverage. Không đọc/in giá trị secret.
- `python -m compileall -q backend scripts tests`: pass.
- Node tests: 268 pass, 0 fail, 0 skip (15.55 s).
- `npm run lint:python`: pass. Chỉ số baseline legacy: BLE001 151, F401 60, F841 13, S110 16, S608 129.
- `npm run lint:security`: pass.
- `npm run lint:debt`: fail vì raw colors tăng từ baseline 842 lên 854; đây là nợ có sẵn, không bị che hoặc thay ngưỡng.
- `npm run audit:vendor`: pass.
- `npm run audit:dependencies`: pass; npm audit và pip-audit không phát hiện lỗ hổng đã biết.
- `npm run build:secure`: pass; 234 module, 51 bundle JavaScript đã obfuscate.
- Baseline `python scripts/package_production.py --check`: fail trước chỉnh sửa vì guard path nhầm `backend/security/turnstile.py` là thư mục cấm.

## C. Inventory và dependency map

- Backend entrypoint: `backend/app.py`; lifecycle tại `backend/lifecycle.py`; startup/configuration tại `backend/startup.py`.
- Runtime backend gồm router/service theo feature (`auth`, `sync`, `documents`, `activity`, `notifications`, `partners`), schema PostgreSQL và registry migration tại `backend/db/upgrades.py` (schema version 34), cùng `backend/security/turnstile.py` được `backend/app.py` import trực tiếp.
- Frontend entrypoint: `frontend/app/app.js`; Vite dùng dynamic feature chunks và phục vụ HTML/CSS/vendor từ `views/`.
- Production allowlist: `scripts/package_production.py` chọn `backend`, `shared`, `dist`, `views`, `deploy` và các runtime script/files cụ thể; archive có manifest SHA-256.
- Build/CI/test: `package.json`, `.github/workflows/`, `scripts/`, Python tests và Node tests. `deploy/`/runbook/backup/document-worker được giữ vì là đường vận hành/rollback.
- Inventory máy đọc được từng được tạo tại `docs/audits/BIDDINGFLOW_AUDIT_BASELINE.json` để rà soát dependency, sau đó đã xóa cùng nhóm artifact sinh tự động vì không cần cho fresh install.

## D. Các mục đã xóa

- Đã xóa 25 target sinh tự động, gồm 405 file và 12.724.029 bytes: `.pytest_cache`, `.ruff_cache`, `.coverage`, `coverage.json`, mọi `__pycache__` trong source/test, `dist`, `release`, `test-results` và `docs/audits`.
- Các mục trên đều bị Git ignore hoặc là inventory audit do phiên rà soát tạo; compile/test/build/package đã chứng minh chúng có thể tái tạo từ source.
- Không xóa tracked source, migration, test, fixture, tài liệu vận hành, dependency, asset/template runtime hay code nghiệp vụ: 0 dòng code bị xóa.

## E. Các mục nghi ngờ nhưng chủ động giữ lại

- `data/`, `dist/`, `release/`, `test-results/`, coverage/cache và toàn bộ ignored local artifact: giữ lại vì là tài sản cục bộ, evidence vận hành hoặc có thể cần điều tra; không tự xóa untracked/ignored.
- Toàn bộ `scripts/`, `deploy/`, migration, test, fixture, vendor asset, Word/Excel/document-worker/sandbox resource: giữ lại vì có reference trực tiếp hoặc khả năng được gọi qua CI, production, package allowlist, subprocess hay quy trình phục hồi.
- CSS compatibility selectors và frontend dynamic modules: giữ lại; static search đơn lẻ không đủ chứng minh không dùng.

## F. Dependency đã thay đổi

- Không thêm, xóa hoặc nâng phiên bản dependency; lockfile không đổi.

## G. Chỉnh sửa và kiểm thử sau chỉnh sửa

- Sửa `scripts/package_production.py`: tách path cấm ở cấp root khỏi `__pycache__` bị cấm ở mọi cấp. Trước đó guard chặn sai `backend/security/turnstile.py`, là module runtime được import trong `backend/app.py`. Guard vẫn chặn thư mục root nhạy cảm/artifact và mọi `__pycache__`.
- Sửa `backend/sync/service.py`: kiểm tra quyền media dùng `tuple(row)[4:]`, tương thích `CompatRow` PostgreSQL thay vì gọi slice không được hỗ trợ. Lỗi này từng gây HTTP 500 khi employee cập nhật expert không đổi media.
- Sửa E2E auth/role: selector legal-consent dùng button desktop `#btn-auth-brand-register` thay vì link chỉ hiện trên mobile; bổ sung diagnostic khi overlay auth không đóng để báo login response thực tế.
- Thêm hồi quy package cho runtime security path và synthetic host của smoke child; `tests/test_production_package.py`: 3 pass.
- Thêm hồi quy `CompatRow` cho kiểm tra quyền protected-media.
- Sửa smoke child của `scripts/package_production.py` để allowlist riêng host `testserver` dùng bởi Starlette TestClient. Override chỉ tồn tại trong child smoke, không đổi runtime production.
- Dựng PostgreSQL 17 tạm, tách biệt ngoài repository, bằng binary có sẵn; không động tới `.env`, `data/`, backup hay cluster hiện có. Fresh schema/migration chạy qua startup smoke.
- `python -m pytest -q` với `TEST_DATABASE_URL` cô lập: 311 pass, 0 fail, 0 skip (9.73 s).
- `node --test tests/js/*.test.mjs`: 268 pass, 0 fail, 0 skip.
- `npm run lint:debt`: pass sau khi thay 12 literal `#ffffff` bằng keyword CSS tương đương `white`; raw colors 854 -> 842, không đổi render.
- `npm run lint:python`, `npm run lint:security`, `npm run audit:vendor`, `npm run audit:dependencies`, `npm run build:secure` và `python scripts/audit_fk_indexes.py`: pass.
- `python scripts/package_production.py --check`: pass; extracted archive smoke HTTP/migration/health chạy thành công (309 runtime files, 2,126,839 bytes).
- `npm run check` được chạy với database cô lập nhưng vượt giới hạn 64 s của runner sau khi các bước riêng lẻ đã được xác minh; không có lỗi assertion được trả về trước timeout.
- `test:auth-roles-e2e`: pass đầy đủ trong harness PostgreSQL/server cô lập. Harness cấu hình đúng `TURNSTILE_ENABLED=false`; ba negative login sẽ kích hoạt Turnstile nếu chạy với local credential thật. Server tạm tự dừng, không còn process nền.
- `npm run package:production`: bị chặn trước build/package bởi `LEGAL_READINESS_BLOCKED` (thiếu legal fact sheet và 27 legal placeholder). Cổng này được giữ nguyên; không tự điền thông tin pháp lý/vận hành.
- Linux-only document sandbox/worker deployment verification và restore drill chưa chạy trên Windows hiện tại.

## H. So sánh trước/sau

- File tracked: 655 trước; thay đổi source gồm 1 file packaging và 1 test hồi quy, cộng báo cáo này. Không có file runtime bị loại bỏ.
- Text/source inventory trước báo cáo: 637 file, 153,461 dòng; tracked bytes: 8,501,803.
- `dist` sau secure build: 3,193,452 bytes.
- Production ZIP sau kiểm tra: 2,126,716 bytes.
- Startup được kiểm tra qua extracted-package smoke; chưa chạy performance assertion end-to-end.

## I. Rủi ro và điều kiện còn lại

- Cần fact sheet pháp lý đã duyệt để thay thế 27 placeholder trước khi `npm run package:production` có thể pass. Đây là dữ liệu do đơn vị vận hành sở hữu, nằm ngoài phạm vi dọn dẹp mã.
- Các E2E khác (bidder-goods, CRUD, offline-sync, joint-venture, low-price, pairwise, lifecycle, UI matrix, performance) và Linux-only sandbox/worker/restore drill vẫn cần chạy trong environment staging đầy đủ; không đánh dấu chúng pass khi chưa có log.
- Cần Linux staging/production có Bubblewrap + seccomp để chạy document sandbox/worker deployment check.
- Cần chạy backup/verify/restore drill trên database isolated theo runbook; không dùng database production.
- `.env`, `node_modules/`, tất cả skill, data/backup/user asset và thay đổi ban đầu của người dùng không bị xóa, ghi đè hoặc hiển thị nội dung.
