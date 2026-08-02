# PROMPT CHO CODEX — RÀ SOÁT, DỌN DẸP MÃ NGUỒN VÀ BẢO ĐẢM FRESH INSTALL PRODUCTION

## 1. Vai trò và mục tiêu

Bạn là kỹ sư phần mềm cấp cao, chuyên gia Python/Starlette, JavaScript/Vite, PostgreSQL, bảo mật triển khai và kiểm thử hồi quy.

Hãy làm việc trực tiếp trên toàn bộ repository **BiddingFlow** hiện tại. Nhiệm vụ là:

1. Rà soát thật kỹ **tất cả file, thư mục, module, tài nguyên, script, cấu hình và từng vùng code** trong ứng dụng.
2. Phát hiện và loại bỏ có kiểm soát:
   - file hoặc thư mục thừa;
   - bản sao, file cũ, file tạm, artifact lỗi thời;
   - code chết, code không thể chạy tới, code không còn được gọi;
   - import/export không dùng;
   - hàm, class, biến, constant, route, handler, component, stylesheet hoặc tài nguyên không còn được sử dụng;
   - cấu hình, dependency hoặc script đã lỗi thời và thực sự không còn cần thiết;
   - code thử nghiệm, code debug, code workaround cũ, comment rác và nhánh tương thích không còn giá trị.
3. Làm repository gọn, rõ ràng, dễ bảo trì và sẵn sàng cho **fresh install production**.
4. Sau khi dọn dẹp, phải chứng minh ứng dụng vẫn cài mới, build, migrate, khởi động và vận hành bình thường; không làm mất bất kỳ chức năng, dữ liệu, luồng nghiệp vụ, quyền hạn, API, giao diện, tác vụ nền hoặc khả năng triển khai nào.

Không được chỉ lập kế hoạch hoặc đưa ra danh sách đề xuất. Hãy thực hiện việc rà soát, chỉnh sửa, xóa, kiểm thử và lập báo cáo hoàn chỉnh.

---

## 2. Nguyên tắc an toàn tuyệt đối

### 2.1. Không được xóa theo phỏng đoán

Chỉ được xóa một file, thư mục hoặc đoạn code khi đã có bằng chứng đủ mạnh rằng nó không được sử dụng trong:

- runtime backend;
- startup/lifespan/shutdown;
- route hoặc middleware;
- dependency injection, registry, plugin hoặc import động;
- frontend entrypoint, import tĩnh, dynamic import hoặc chunk build;
- HTML/template/CSS/JS;
- xử lý sự kiện dựa trên ID, class, `data-*`, tên route hoặc tên action dạng chuỗi;
- worker, queue, scheduled job hoặc subprocess;
- migration, fresh schema, backup/restore;
- tạo Word/Excel/PDF, template và tài nguyên nhúng;
- cấu hình production, systemd, nginx, Cloudflare, monitoring hoặc rollback;
- script build/package/deploy/security/audit;
- test unit, integration, E2E hoặc fixture còn có giá trị;
- tài liệu hướng dẫn cài đặt, cấu hình, vận hành, khôi phục hoặc xử lý sự cố;
- API hoặc dữ liệu tương thích ngược;
- bất kỳ đường dẫn nào được ghép động từ chuỗi, biến môi trường, database hoặc tên file.

Kết quả từ công cụ static analysis chỉ là **tín hiệu tham khảo**, không phải bằng chứng duy nhất để xóa.

### 2.2. Không dùng lệnh xóa hàng loạt nguy hiểm

Nghiêm cấm:

- `git clean -fd`, `git clean -fdx` hoặc biến thể tương tự;
- `rm -rf`/`Remove-Item -Recurse -Force` trên phạm vi rộng;
- xóa toàn bộ thư mục chỉ vì không thấy import trực tiếp;
- tự động xóa tất cả file untracked/ignored;
- reset, checkout hoặc overwrite làm mất thay đổi hiện có của người dùng;
- xóa database, backup, upload, media, template người dùng hoặc secret.

Mỗi lần xóa phải theo nhóm nhỏ, có danh sách rõ ràng và có thể khôi phục bằng Git.

### 2.3. Không làm thay đổi nghiệp vụ

Đây là nhiệm vụ dọn dẹp, không phải thiết kế lại nghiệp vụ. Không được tự ý:

- thay đổi quy trình lựa chọn nhà thầu;
- thay đổi logic tính toán, xếp hạng, ưu đãi hoặc giá;
- thay đổi role, permission hoặc phạm vi dữ liệu;
- đổi schema/API contract nếu không bắt buộc;
- đổi hành vi offline sync/outbox;
- đổi định dạng tài liệu xuất;
- đổi giao diện hoặc UX ngoài những chỉnh sửa bắt buộc do xóa code chết;
- thay đổi migration đã phát hành;
- hạ mức kiểm tra bảo mật để làm test/build vượt qua.

Nếu phát hiện lỗi nghiệp vụ độc lập với việc dọn dẹp, ghi vào báo cáo; không tự mở rộng phạm vi nếu việc sửa lỗi đó có rủi ro làm thay đổi hành vi.

---

## 3. Các file và thư mục bắt buộc phải giữ

### 3.1. Bảo vệ tuyệt đối tài sản cục bộ

Không được xóa, di chuyển, đổi tên, làm rỗng, ghi đè hoặc hiển thị nội dung nhạy cảm của:

- `.env` và mọi file environment thật đang tồn tại;
- `node_modules/`;
- mọi file/thư mục skill, bao gồm nhưng không giới hạn:
  - `skills-lock.json`;
  - `skills/`;
  - `data/skills/`;
  - `.codex/` và các skill bên trong;
  - `.agents/` và các skill bên trong;
  - mọi file có tên `SKILL.md`;
  - mọi đường dẫn được khai báo trong `skills-lock.json`;
- các thay đổi chưa commit của người dùng;
- file chứng thư, key, secret, cấu hình thật hoặc credential cục bộ;
- dữ liệu người dùng, upload, ảnh, template Word, file sinh ra bởi người dùng;
- database, WAL/lock liên quan, backup và bản restore drill;
- log/audit checkpoint cần cho vận hành hoặc điều tra sự cố.

Không đọc hoặc in giá trị secret trong `.env` ra console, log hay báo cáo. Chỉ được kiểm tra sự tồn tại của biến bằng tên biến, không ghi lại giá trị.

### 3.2. Giữ lại tài liệu và cấu hình cần cho cài đặt/production

Mặc định phải giữ, trừ khi có bằng chứng chắc chắn về một bản trùng lặp đã được thay thế hoàn toàn:

- `README.md`;
- `.env.example`;
- `.python-version`;
- `package.json`, `package-lock.json`;
- `pyproject.toml`, `requirements.txt`;
- `vite.config.js`, `eslint.config.js`;
- `.gitignore`, `.gitleaksignore`;
- `deploy/**`;
- `docs/**`, đặc biệt tài liệu production, security và runbook;
- `.github/workflows/**`;
- `scripts/package_production.py`;
- các script migration, database, backup/restore, worker, sandbox, deployment verification, security, audit và build;
- `backend/**`, `frontend/**`, `views/**` và các runtime asset thật sự được sử dụng;
- `shared/**`, `holidays.json` và dữ liệu tĩnh được runtime/package sử dụng;
- test và fixture cần để chứng minh không hồi quy;
- migration registry và toàn bộ migration đã phát hành.

Không được xóa test chỉ vì test không đi vào production artifact. Test là điều kiện bắt buộc để chứng minh việc dọn dẹp an toàn.

### 3.3. Phân biệt working tree và production artifact

Phải phân biệt rõ:

1. **Working tree/source repository**: chứa source, test, tài liệu, CI, skill và công cụ bảo trì.
2. **Production artifact**: gói tối thiểu do `scripts/package_production.py` tạo ra theo allowlist.

Yêu cầu “giữ `.env`, `node_modules`, skill” nghĩa là **không xóa chúng khỏi máy làm việc**. Không được vì vậy mà sửa cơ chế package để đưa `.env`, secret hoặc toàn bộ `node_modules` vào file release.

Cơ chế package production hiện có là nguồn tham chiếu quan trọng. Không được nới lỏng các kiểm tra bảo mật, allowlist, manifest hash, kiểm tra source map, kiểm tra đường dẫn hoặc kiểm tra smoke test chỉ để làm package thành công.

---

## 4. Hiểu kiến trúc trước khi chỉnh sửa

Trước khi xóa bất cứ thứ gì, hãy đọc và lập bản đồ kiến trúc tối thiểu cho:

- entrypoint backend và quá trình khởi tạo ứng dụng;
- `backend/app.py`, startup/lifecycle/middleware;
- tất cả router, service, repository, domain module và policy;
- PostgreSQL schema, fresh schema và migration registry;
- document worker, queue, sandbox và external worker mode;
- offline sync/outbox;
- notification, activity/audit và timeline;
- authentication, session, OAuth, role và permission;
- frontend entrypoint tại `frontend/app/app.js`;
- toàn bộ module frontend theo feature;
- HTML partial, CSS và vendor asset trong `views/`;
- cấu hình Vite, secure build, obfuscation và manifest;
- script build/package/deploy/backup/restore;
- danh sách runtime file trong `scripts/package_production.py`;
- tất cả test Python, Node và E2E;
- tài liệu production và rollback.

Tạo một dependency map đủ để biết:

- module nào import module nào;
- route nào được đăng ký ở đâu;
- script nào được gọi bởi `package.json`, CI, deploy hoặc tài liệu;
- file tĩnh/template nào được truy cập bằng đường dẫn động;
- file nào chỉ phục vụ development/test nhưng vẫn phải giữ trong source repository;
- file nào thực sự là artifact/cache/tạm và có thể sinh lại.

---

## 5. Giai đoạn 0 — Bảo vệ trạng thái hiện tại

Thực hiện trước mọi thay đổi:

1. Chạy `git status --short --branch`.
2. Ghi nhận file tracked, untracked và ignored mà không xóa chúng.
3. Không sửa hoặc overwrite các thay đổi có sẵn không liên quan tới nhiệm vụ.
4. Ghi lại commit hiện tại bằng `git rev-parse HEAD`.
5. Tạo báo cáo ban đầu tại:
   - `docs/production-cleanup-report.md`
6. Trong báo cáo, ghi:
   - commit gốc;
   - môi trường chạy;
   - phiên bản Python, Node, npm, PostgreSQL;
   - các thay đổi đã tồn tại trước khi bắt đầu;
   - các file bảo vệ đặc biệt đã phát hiện, chỉ ghi đường dẫn, không ghi nội dung secret.
7. Nếu working tree không sạch, vẫn tiếp tục nhưng phải bảo toàn chính xác thay đổi của người dùng và phân biệt chúng với thay đổi do nhiệm vụ này tạo ra.

---

## 6. Giai đoạn 1 — Chạy baseline đầy đủ

Trước khi dọn dẹp, chạy các kiểm tra baseline phù hợp với repository:

```bash
python -m compileall -q backend scripts tests
python -m pytest -q
node --test tests/js/*.test.mjs
npm run lint:python
npm run lint:security
npm run lint:debt
npm run audit:vendor
npm run build:secure
python scripts/package_production.py --check
```

Nếu project định nghĩa lệnh tổng hợp tương ứng, chạy thêm:

```bash
npm run check:quality
npm run check
```

Lưu ý:

- Không bỏ qua lỗi.
- Không xóa/sửa test để che lỗi.
- Không hạ coverage threshold.
- Không thêm `skip`, `xfail`, `try/except` nuốt lỗi hoặc điều kiện né test.
- Nếu baseline có lỗi do môi trường, ghi rõ lỗi, bằng chứng và điều kiện cần thiết.
- Nếu test Linux Bubblewrap/seccomp không thể chạy trên hệ điều hành hiện tại, phải chạy nó trên môi trường Linux production/staging phù hợp trước khi kết luận hoàn tất.
- Các lỗi baseline có sẵn phải được phân biệt với lỗi mới do dọn dẹp.

Chụp lại kết quả baseline trong báo cáo, bao gồm số test pass/fail/skip, thời gian build và kích thước artifact hiện tại.

---

## 7. Giai đoạn 2 — Lập inventory toàn repository

Quét toàn bộ repository, bao gồm tracked, untracked và ignored, nhưng không được xóa tự động.

Phân loại từng mục vào một trong các nhóm:

1. **Runtime bắt buộc**.
2. **Build/package bắt buộc**.
3. **Migration/database bắt buộc**.
4. **Deploy/operations/rollback bắt buộc**.
5. **Test/CI/quality/security bắt buộc**.
6. **Tài liệu cấu hình/cài đặt bắt buộc**.
7. **Skill/tooling phải giữ theo yêu cầu**.
8. **Dữ liệu cục bộ/người dùng phải bảo vệ**.
9. **Generated artifact có thể tái tạo**.
10. **Cache/temp/log cục bộ có thể dọn nhưng không được tự xóa nếu đang cần cho điều tra hoặc người dùng chưa cho phép**.
11. **Ứng viên code chết/file thừa cần xác minh**.
12. **Không chắc chắn — bắt buộc giữ**.

Với mỗi ứng viên xóa, ghi vào báo cáo:

- đường dẫn hoặc symbol;
- loại file/code;
- lý do nghi ngờ là thừa;
- kết quả tìm reference;
- có import động/string reference hay không;
- có nằm trong build/package/deploy/test/docs hay không;
- rủi ro;
- bằng chứng cho phép xóa;
- test sẽ dùng để xác nhận sau khi xóa.

---

## 8. Giai đoạn 3 — Phân tích file và thư mục thừa

Kiểm tra ít nhất các nhóm sau:

### 8.1. Artifact/cache/temp

Tìm các file như:

- `__pycache__`, `*.pyc`;
- `.pytest_cache`, coverage output;
- Playwright report/test result;
- Vite cache;
- file `*.tmp`, `*.temp`, `*.bak`, swap;
- log cũ;
- build/release artifact lỗi thời;
- file copy có hậu tố `old`, `backup`, `copy`, `final2`, ngày tháng;
- file sinh ra nhưng không còn được manifest/build tham chiếu.

Không được xóa database, backup, audit log, upload, template người dùng hoặc dữ liệu runtime chỉ dựa trên pattern tên file.

### 8.2. File trùng lặp hoặc phiên bản cũ

- So sánh hash và nội dung.
- Kiểm tra lịch sử Git.
- Kiểm tra import, route, script, docs và CI.
- Xác định file canonical.
- Chỉ xóa bản trùng khi mọi reference đã được chuyển chính xác và test xác nhận.

### 8.3. Script tưởng như không dùng

Một script không được import vẫn có thể được gọi bởi:

- `package.json`;
- workflow CI;
- systemd/nginx/deploy;
- README/docs/runbook;
- subprocess;
- thao tác thủ công khi backup/restore/migration;
- production incident response.

Phải tìm toàn bộ các nguồn gọi này trước khi kết luận.

### 8.4. Asset/template/vendor

- Đối chiếu Vite manifest, HTML/template, CSS `url()`, JS string path và backend static mount.
- Kiểm tra file được nạp động theo tên trong database/config.
- Không xóa vendor asset chỉ vì không thấy import ES module.
- Không xóa Word/Excel template, ảnh, font hoặc schema nếu được dùng khi xuất tài liệu.

---

## 9. Giai đoạn 4 — Phân tích code chết Python

Kết hợp nhiều phương pháp:

- AST/import graph;
- `git grep`/`rg` theo symbol và path;
- static analyzer như Ruff/Pyflakes/Vulture/Deptry nếu phù hợp;
- coverage hiện có;
- route registration;
- startup/lifespan hook;
- callable được truyền như callback;
- registry/decorator;
- dynamic import;
- `getattr`, mapping string → handler;
- subprocess/CLI entrypoint;
- worker task;
- migration và serialization contract;
- monkeypatch/fixture trong test.

Đặc biệt lưu ý:

- Không xóa migration đã phát hành hoặc sửa migration cũ.
- Không xóa model/field/enum có thể xuất hiện trong dữ liệu cũ hoặc API tương thích ngược.
- Không xóa exception, policy hoặc validation chỉ vì nhánh khó đạt tới.
- Không xóa endpoint ít dùng nếu vẫn thuộc nghiệp vụ.
- Không xóa code document worker/sandbox chỉ vì môi trường local không chạy được.
- Không xóa backup/restore và security verification script.

Mỗi symbol bị xóa phải có bằng chứng không có caller trực tiếp, gián tiếp hoặc động.

---

## 10. Giai đoạn 5 — Phân tích code chết JavaScript/Frontend

Kiểm tra:

- import/export tĩnh;
- dynamic import;
- Vite entry/chunk;
- side-effect import;
- module được nạp từ HTML;
- event listener theo selector;
- inline handler nếu còn tồn tại;
- ID/class/`data-*` dùng làm contract giữa HTML, CSS và JS;
- custom event;
- route name/action name dạng chuỗi;
- IndexedDB/offline sync/outbox;
- service worker nếu có;
- feature flag/config từ backend;
- module được nạp theo role hoặc trạng thái nghiệp vụ;
- Playwright/E2E selector.

Không xóa CSS selector chỉ vì không tìm thấy trong một file HTML; selector có thể được tạo động hoặc dùng trong modal/component/template khác.

Không xóa DOM compatibility code nếu chưa kiểm thử tất cả role, màn hình và trạng thái.

Không sửa secure build/obfuscation để né lỗi sau khi xóa module.

---

## 11. Giai đoạn 6 — Rà soát dependency và cấu hình

Đối chiếu:

- `pyproject.toml` với `requirements.txt` và import thực tế;
- `package.json` với `package-lock.json` và import/build script;
- devDependency với CI/build/test;
- dependency runtime với production package;
- script npm với workflow/docs/deploy;
- biến môi trường với `.env.example`, code, deploy và tài liệu;
- Vite input/output với template và package manifest.

Chỉ xóa dependency khi:

1. không có import/use trực tiếp hoặc gián tiếp;
2. không được tool/build/test/script dùng;
3. fresh install vẫn thành công;
4. lockfile được cập nhật đúng cách;
5. audit/build/test/E2E đều vượt qua.

Không tự ý nâng phiên bản dependency trong nhiệm vụ này, trừ khi việc loại bỏ dependency bắt buộc tạo lại lockfile và không làm thay đổi phiên bản còn lại ngoài phạm vi cần thiết.

---

## 12. Giai đoạn 7 — Thực hiện dọn dẹp theo batch nhỏ

Thứ tự ưu tiên:

1. import/biến/comment/debug code chắc chắn thừa;
2. hàm/class/module chắc chắn không có reference;
3. file trùng hoặc artifact được tái tạo;
4. dependency thực sự không dùng;
5. thư mục thừa đã được chứng minh hoàn toàn.

Quy trình cho mỗi batch:

1. Ghi danh sách mục sắp xóa vào báo cáo.
2. Xóa/chỉnh sửa batch nhỏ.
3. Chạy kiểm tra liên quan ngay lập tức.
4. Chạy test nhanh cho module bị ảnh hưởng.
5. Nếu có lỗi hoặc hành vi không chắc chắn, khôi phục batch đó và giữ lại mục tương ứng.
6. Chỉ chuyển sang batch tiếp theo khi batch hiện tại đã an toàn.

Không gộp hàng trăm thay đổi không liên quan vào một lần xóa lớn.

Ưu tiên `git rm` cho file tracked để lịch sử thay đổi rõ ràng. Không dùng `git rm` đối với `.env`, `node_modules`, skill, dữ liệu hoặc file untracked của người dùng.

---

## 13. Giai đoạn 8 — Kiểm tra fresh install thật sự trong môi trường sạch

Không được coi việc ứng dụng chạy trong working tree hiện tại là bằng chứng đủ, vì môi trường đó có `.env`, `node_modules`, cache và artifact cũ.

Tạo một thư mục/worktree kiểm thử sạch, chỉ chứa trạng thái source sau khi chỉnh sửa. Không phá working tree hiện tại.

Trong môi trường sạch:

1. Cài đúng Python từ `.python-version`.
2. Cài backend từ metadata chính thức của project.
3. Chạy `npm ci` từ `package-lock.json`.
4. Tạo `.env` kiểm thử từ `.env.example`, chỉ dùng secret giả an toàn và database test cách ly.
5. Khởi tạo PostgreSQL test sạch.
6. Chạy fresh schema/migration đúng quy trình.
7. Build frontend secure từ đầu, không tái sử dụng `dist` cũ.
8. Tạo production package từ đầu.
9. Giải nén package vào thư mục release sạch.
10. Cài/chạy đúng theo tài liệu production.
11. Khởi động web và document worker theo cấu hình production phù hợp.
12. Kiểm tra health/liveness/readiness.
13. Chạy smoke test trên package đã giải nén, không chỉ chạy trên source tree.

Không được copy `.env` thật hoặc credential production vào môi trường kiểm thử.

Không được dùng database production. Tên database smoke/test phải thể hiện rõ đây là database cách ly.

---

## 14. Giai đoạn 9 — Kiểm thử hồi quy đầy đủ

Sau khi hoàn tất dọn dẹp, chạy lại toàn bộ kiểm tra baseline và tất cả lệnh E2E đang được định nghĩa trong `package.json`, bao gồm tối thiểu các nhóm hiện có:

```bash
python -m compileall -q backend scripts tests
python -m pytest -q
node --test tests/js/*.test.mjs
npm run lint:python
npm run lint:security
npm run lint:debt
npm run audit:vendor
npm run build:secure
npm run package:production
npm run test:auth-shell
npm run test:auth-roles-e2e
npm run test:bidder-goods-e2e
npm run test:crud-modules-e2e
npm run test:multi-assignee-e2e
npm run test:joint-venture-e2e
npm run test:low-price-conflict-e2e
npm run test:offline-sync-e2e
npm run test:package-pairwise-e2e
npm run test:lifecycle
npm run test:performance
npm run test:ui-quality-e2e
npm run test:authenticated-ui-matrix
```

Nếu repository có thêm test hoặc script mới, phải phát hiện và chạy chúng, không giới hạn ở danh sách trên.

### 14.1. Ma trận chức năng bắt buộc

Kiểm tra như người dùng thật đối với tất cả role/tài khoản và các chức năng chính:

- đăng ký, đăng nhập, đăng xuất, session và OAuth nếu đã cấu hình;
- phân quyền và giới hạn truy cập;
- quản lý người dùng/chuyên gia/đối tác;
- tạo, xem, sửa, xóa và tìm kiếm gói thầu/hợp đồng;
- nhiều người cùng được phân công;
- activity/audit gồm người thực hiện và thời gian;
- toàn bộ lifecycle gói thầu;
- các loại/phương thức/hình thức gói thầu đang hỗ trợ;
- gói hàng hóa, gói hỗn hợp và phần lô;
- nhà thầu độc lập và liên danh;
- danh mục hàng hóa dự thầu;
- đánh giá tính hợp lệ, năng lực kinh nghiệm, kỹ thuật, tài chính;
- báo cáo đánh giá tổng quát và chi tiết;
- trường hợp giá đề nghị trúng thầu nhỏ hơn 50% theo đúng logic hiện tại;
- upload/download tài liệu;
- xuất Word/Excel và các tài liệu liên quan;
- danh sách hàng hóa trúng thầu;
- notification;
- offline sync/outbox và phục hồi lỗi;
- backup, verify và restore drill trên môi trường cách ly;
- document worker và sandbox;
- health/readiness;
- UI desktop, responsive, focus, validation, custom select và bảng hàng hóa;
- startup/performance guard hiện có.

Không được đánh dấu hoàn thành nếu có chức năng không thể kiểm tra mà không nêu rõ lý do và bằng chứng thay thế.

---

## 15. Điều kiện chấp nhận bắt buộc

Chỉ được kết luận hoàn thành khi đáp ứng tất cả:

1. Không xóa hoặc làm hỏng `.env`, `node_modules`, skill, dữ liệu, backup, template người dùng hay thay đổi chưa commit.
2. Không có file/runtime dependency bị thiếu.
3. Fresh install trong môi trường sạch thành công.
4. Fresh database/schema/migration thành công.
5. Secure frontend build thành công từ đầu.
6. Production package thành công và manifest hợp lệ.
7. Package giải nén khởi động được.
8. Web và document worker hoạt động đúng.
9. Tất cả test, lint, audit, build, smoke và E2E bắt buộc đều pass.
10. Không giảm coverage hoặc chất lượng kiểm thử.
11. Không bỏ qua test để che lỗi.
12. Không thay đổi nghiệp vụ ngoài phạm vi.
13. Không có import, route, asset, template hoặc dependency bị đứt.
14. Không làm yếu bảo mật hoặc cơ chế package.
15. `git diff` chỉ chứa thay đổi có chủ đích, giải thích được.
16. Báo cáo cuối cùng đầy đủ và có bằng chứng.

Cụm từ “ứng dụng chạy bình thường” phải được chứng minh bằng kết quả test và smoke test; không được chỉ dựa vào việc trang chủ mở được.

---

## 16. Báo cáo bắt buộc

Cập nhật `docs/production-cleanup-report.md` với cấu trúc:

### A. Tóm tắt

- mục tiêu;
- commit trước và sau;
- phạm vi đã rà soát;
- kết luận fresh install production.

### B. Baseline trước chỉnh sửa

- lệnh đã chạy;
- kết quả;
- lỗi có sẵn;
- kích thước repo/build/package;
- số lượng file và dòng code chính.

### C. Inventory và dependency map

- kiến trúc chính;
- entrypoint;
- runtime paths;
- build/deploy paths;
- test/CI paths;
- tài sản được bảo vệ.

### D. Các mục đã xóa

Với từng file/thư mục/symbol:

- đường dẫn/tên;
- lý do;
- bằng chứng không còn được dùng;
- test xác nhận;
- số dòng hoặc dung lượng giảm.

### E. Các mục nghi ngờ nhưng giữ lại

- đường dẫn/tên;
- vì sao chưa đủ bằng chứng để xóa;
- rủi ro nếu xóa.

### F. Dependency đã thay đổi

- dependency bỏ đi;
- lý do;
- bằng chứng;
- thay đổi lockfile.

### G. Kết quả kiểm thử sau chỉnh sửa

- compile;
- pytest;
- Node tests;
- lint;
- audit;
- secure build;
- package check;
- fresh install;
- fresh database;
- health/readiness;
- E2E theo từng script;
- document worker/sandbox;
- backup/restore drill;
- performance.

### H. So sánh trước/sau

- số file;
- LOC;
- kích thước source;
- kích thước `dist`;
- kích thước production zip;
- startup time nếu đo được;
- test duration.

### I. Rủi ro còn lại

- hạng mục không thể chạy do môi trường;
- hạng mục cần kiểm tra trên Linux/staging;
- đề xuất tiếp theo, không tự thực hiện ngoài phạm vi.

---

## 17. Đầu ra cuối cùng trong phản hồi Codex

Khi hoàn tất, trả lời ngắn gọn nhưng đầy đủ:

1. Tổng số file/thư mục và dòng code đã xóa.
2. Danh sách thay đổi quan trọng.
3. Những mục đã chủ động giữ lại vì chưa đủ bằng chứng.
4. Xác nhận `.env`, `node_modules` và toàn bộ skill không bị xóa/ghi đè.
5. Kết quả từng nhóm test/build/package/E2E.
6. Kết quả fresh install production trong môi trường sạch.
7. Đường dẫn báo cáo `docs/production-cleanup-report.md`.
8. Bất kỳ hạn chế môi trường nào còn tồn tại.

Không được nói “đã đảm bảo” nếu chưa có log kiểm thử tương ứng. Nếu có bất kỳ test nào fail, nhiệm vụ chưa hoàn tất: tiếp tục điều tra, sửa và chạy lại cho đến khi pass; nếu lỗi khách quan do môi trường, phải ghi rõ bằng chứng và không được che giấu.

---

## 18. Chỉ dẫn thực thi cuối cùng

Hãy bắt đầu bằng việc đọc toàn bộ cấu trúc repository và các hướng dẫn trong repo. Sau đó thực hiện lần lượt các giai đoạn trên.

Ưu tiên an toàn và tính đúng đắn hơn số lượng code bị xóa. Khi không chắc chắn, **giữ lại và ghi vào báo cáo**, không được xóa.
