# Báo cáo sửa lỗi trước production — 01/10/2026

Phạm vi: các lỗi vừa phát hiện trong working tree `D:\Bidding`. Không commit,
push, deploy, sửa bí mật hoặc thực hiện giao dịch PayOS thật. Giữ nguyên quyền
đọc đầy đủ dữ liệu đã được cấp quyền và mọi tenant/module/assignment/record scope.

**Kết luận:** các bản sửa thanh toán, export/recovery, dependency, conflict/F5
và startup landing đã đạt các kiểm chứng cục bộ dưới đây. Bổ sung ADR 0050
đã đóng gate tác vụ startup **100 ms** trên secure build mới qua hai lượt
30 cold + 30 warm; cả hai không ghi nhận task >=50 ms. Full JS cuối
**2.049/2.049**, focused landing/browser **26/26** đạt. Còn bằng chứng staging,
Edge/origin có xác thực và vận hành/thanh toán thật; không phê duyệt production
chỉ vì tests, build và package smoke cục bộ đạt.

## Các bản sửa và bằng chứng tập trung

### Bổ sung theo quyết định F5 của chủ sản phẩm

Chủ sản phẩm xác nhận: “Khi lưu bị xung đột giữ nội dung nhập đến khi nhấn
F5. Bấm F5 xong sẽ khôi phục dữ liệu máy chủ”. Quyết định được ghi tại
[ADR 0049](adr/0049-conflict-input-until-f5-and-canonical-reload.md), supersede
yêu cầu rollback ngay của ADR 0044 chỉ ở nhánh conflict.

Regression mới `node --test tests/js/conflict_f5_contract.test.mjs` đi qua
model, outbox/store, push/pull, routing và detail hydration thật; chỉ mô phỏng
DOM/transport/lưu trữ. Baseline 5 ca chạy hai lần đều 2 pass/3 fail; mở rộng
17 ca gồm direct lookup, page cache, newer same-row, lỗi detail/mạng và
thu hồi phạm vi: 5 pass/12 fail trước sửa. Sau sửa, mở rộng thành 33 ca và
đạt 33/33: thêm lỗi retirement/cache, GET denial/absence, loại bản ghi chưa
được Conflict Center hỗ trợ, batch hỗn hợp, envelope `fields.errors` và retry
khi reload chưa an toàn.
Đây không phải bằng chứng F5 trên trình duyệt production thật. Gate tổng và
artifact sau bổ sung ghi ở các mục kiểm chứng cuối bên dưới.

Nguyên nhân chính: nội dung bị từ chối vẫn nằm trong cache chi tiết và bản
nháp autosave; pull nền thay state mà không phân biệt projection chỉ giữ cho
phiên hiện tại. Bản sửa tách nội dung nhập giữ trong tab khỏi cache canonical,
retire đúng generation, không chặn kiểm tra session/phạm vi. F5 chờ detail
lookup có thẩm quyền; HTTP500/malformed response không được gọi là phục hồi.

Probe reload bằng Chromium thử nghiệm đã dừng vì trang fixture không đạt
trạng thái sẵn sàng; chưa chạy tới reload. Đã đóng browser/server và không
giữ harness tạm. Không dùng probe này làm bằng chứng F5 trên trình duyệt;
vẫn cần smoke với tài khoản/record được cấp quyền trên staging.

Rà soát đường gọi thực còn xác nhận lưu đánh giá chi tiết mặc định thiếu
explicit changes, sau bổ sung persistence vẫn thiếu staging outbox nên có
thể báo thành công với 0 POST. Đã sửa cả hai seam bằng danh sách exact
package/bid/hàng hóa của thao tác, không replace cả bảng. Probe độc lập dùng
`BiddingModel` + `autoSync` thật, không override commit: success và 409 khi
hoàn thành đều gửi đúng 1 POST; chưa success trước ACK. Khi authority pull
tăng rowVersion 4→8/9, expectedVersion gửi vẫn là 4 của editor base, trường
canonical không liên quan vẫn được giữ. 409 giữ dòng nhập nhưng rollback
derived lifecycle/conclusion về trạng thái trước; fresh autosave không áp
lại report rejected. Không thay business contract phiên bản hoặc phân quyền.

| Vấn đề | Xử lý | Bằng chứng |
| --- | --- | --- |
| Billing tin vai trò Quản lý cũ | Báo giá/checkout kiểm membership hiện hành trong transaction; giữ nguyên personal owner, persona và ngoại lệ Super Admin | Regression ban đầu 6 fail/5 pass; sau sửa 11/11. Kiểm tra session thật trên PostgreSQL cho membership left/downgrade; khóa đồng thời và quote/member-administration không deadlock |
| Xuất Word khi còn thay đổi chưa đồng bộ | Chặn pending/persona chưa đồng bộ, kiểm lại outbox và workspace sau await | Regression pending/skipped/manager/cursor/workspace qua helper thật và các caller xuất Word |
| Canonical lookup lỗi bị hiểu thành mất bản ghi | Phân biệt lỗi transport/HTTP/schema chưa xác định với absence/denial; lưu disposition trước khi retire rejected receipt; chỉ xác nhận phục hồi từ kết quả canonical | 94/94 kiểm thử tập trung; reviewer độc lập kiểm 7 biến thể với outbox hydrate thật, gồm rebuild generation, correction cùng hàng và mutation mới không liên quan; không còn gửi lại nội dung rejected trong các probe |
| PayOS query/cancel thiếu URL validation | Kiểm URL ở adapter chung sau xác minh chữ ký; lỗi parser về đúng error lane | Trước sửa 18 fail/29 pass; sau sửa 47/47, gồm signed javascript/host/port/userinfo/malformed input và omission/null/empty/Fake controls |
| DOMPurify nằm trong advisory | Pin và lock riêng lên 3.4.16; không bulk-upgrade | npm audit production/full sạch, pip-audit sạch; browser regression thực thi cả hai hook-detached subtree và wrapper Trusted Types thật |
| Smoke Mua Sắm Công dùng nút cũ | Harness dùng checkbox source toggle hiện hành và bộ xử lý production | Smoke 320/768/1280px, chuột/bàn phím/dedupe, 44px/no overflow/axe; 39 JS wizard tests đạt |
| Startup >100 ms | Giữ lazy-font fix; bố trí landing ngoài viewport khi cần, materialize trước anchor/F5 và lưu history tọa độ canonical | Baseline sửa harness fail 231ms/136ms; secure build mới đạt hai lượt 30 cold + 30 warm ở gate 100ms, không ghi nhận task >=50ms. Không đổi font/nội dung/quyền; không phải tổng thời gian startup <100ms |

Advisory DOMPurify: [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p).
Đường wrapper production không dùng IN_PLACE/hook này; việc cập nhật xử lý
dependency có advisory, không phải khẳng định đã khai thác được ứng dụng.

## Còn mở hoặc chưa xác minh

- Nhánh `ROW_VERSION_CONFLICT`: đã triển khai quyết định ADR 0049, focused
  33/33 conflict/F5 và 79/79 draft/workflow đạt, không skip. Không còn thiếu
  quyết định nghiệp vụ hoặc blocker được xác nhận trong rà soát hẹp. Gate
  tổng cuối và artifact mới đã đạt; chưa có smoke F5/IndexedDB trên trình
  duyệt staging có xác thực, không dùng mock để khẳng định deployment đạt.
- Hiệu năng: gate public landing cục bộ đã đạt với ngưỡng 100ms và đủ mẫu,
  xem bổ sung ADR 0050 bên dưới. Không nâng threshold, giảm sample hoặc che
  kết quả. Đo local Chromium không chứng minh startup workspace có xác thực
  hoặc tình trạng Edge/origin thật; các bằng chứng đó vẫn cần staging.
- Local test/build/package không thay cho staging/production, restore/cutover,
  secret scan/CI theo commit bất biến, authenticated multi-browser E2E hoặc
  giao dịch PayOS production đã được phê duyệt.

### Giới hạn phục hồi cần giữ rõ

- Recovery archive lưu theo đúng tài khoản/workspace ở localStorage và
  IndexedDB. Receipt ở pha `prepared` được đối chiếu từng operation/nội dung
  sau hydrate; không tin generation cũ hoặc adopt toàn bộ batch mới.
- Receipt delete cũ không chứa snapshot `expectedVersion`/nội dung. Nếu batch
  identity đã đổi, không đoán rằng delete cùng ID là operation cũ: giữ pending,
  giữ queue và không POST. Regression kiểm hai lần sync sau hydrate; chưa có
  giao diện giải quyết tự động riêng cho trường hợp mơ hồ này.
- Nếu cả hai nơi lưu recovery đều lỗi, giữ nội dung và chặn replay trong tab
  đang mở, báo lỗi lưu trữ. Không thể cam kết durability qua reload trong tình
  huống không có nơi lưu được; người dùng phải giữ tab mở và thử lại.
- Overlay upsert giữ chính xác bản nhập mới. Partial patch dùng helper
  `applyRecordPatch` hiện hành: metadata có thẩm quyền lấy từ canonical,
  trường được chỉnh lấy từ patch, raw queue không bị sửa. Không thay semantics
  version/rebase của helper dùng chung trong lượt này.
- Bản nháp recovery không tự phát lại, không được coi là dữ liệu đã lưu thành
  công; pha hoàn tất chỉ được ghi sau khi lookup/reconciliation có căn cứ.

## Kiểm chứng tổng thể trước bổ sung F5

Các kết quả trong mục này là snapshot trước bổ sung ADR 0049. Backend không
thay đổi sau lượt kiểm chứng đó; kết quả frontend/build cuối xem mục tiếp theo.

- `python -m pytest -q --cov=backend --cov-branch --cov-report=term --cov-report=json:coverage.json --cov-fail-under=45`:
  **2.502 passed, 1 skipped**, 1.087,15 giây; coverage **65,02%**; exit 0.
- `python scripts/check_critical_coverage.py coverage.json`: **16 modules đạt**, exit 0.
- Rerun backend tập trung sau review: **105 passed**, exit 0, gồm PostgreSQL
  revocation, lock serialization và không deadlock ở quote/member administration.
- `npm run audit:dependencies`: full/production npm audit **0 vulnerabilities**,
  pip-audit **no known vulnerabilities**, exit 0.
- `node --test tests/js/sync_rejection_export_regressions.test.mjs tests/js/sync_status.test.mjs tests/js/sync_push_workspace_races.test.mjs`:
  **94 passed, 0 skipped**, exit 0. Có 44 test mới cho export/recovery; kiểm
  state, cache và POST chứ không chỉ kiểm giá trị trả về của helper.
- `npm run check:static`, `npm run lint:security`, `npm run build:secure`,
  `python scripts/verify_secure_build_artifact.py` và `npm run check:legal:production`:
  **đạt trên source frontend cuối**, exit 0; **168 bundle obfuscate**.
  FK audit **216/0 thiếu index** đạt ở snapshot backend không thay đổi sau đó.
- `npm run test:js:coverage`: **1.972 passed, 0 failed/skipped**, 474,22 giây;
  lines **55,83%**, branches **66,60%**, functions **69,81%**; **14 mô-đun
  trọng yếu đạt**, exit 0. Không thay threshold hoặc kỳ vọng quyền.
- `node scripts/verify_turnstile_local_matrix.mjs`: **6/6 tình huống đạt**
  (pass/fail challenge, interactive, slow, script-failure, auto-pending),
  exit 0; chạy với DB API test cô lập. Phần Python security-deploy **78 test
  đạt**. Đây là browser matrix tình huống Turnstile, không phải mọi trình duyệt.
- `npm run test:procurement-lookup-ui` chạy lại cuối: **đạt**, exit 0 tại
  320/768/1280px, source toggle đúng, controls 44px, không overflow hoặc lỗi
  accessibility nghiêm trọng trong các màn hình được kiểm.
- Lượt JS coverage đầu tiên không đạt ratchet functions của SyncPullService
  (**59,18% < 60%**). Đây là snapshot lịch sử; sau regression thực thi lookup,
  normalization/storeResult/persistence thật, lượt cuối đạt như trên.
- Lượt đo route trên secure build mới sau lazy-font fix vẫn fail:
  **188ms > 100ms**. Trace xác nhận còn native whole-document layout, chưa
  xác định đoạn CSS cần sửa. Không coi một partial optimization là closure.
- `npm run test:route-css-visual` trên build cuối `app-DgcwzW_2.js`:
  **fail, exit 1**, long task **131ms > 100ms**. Không có suite/build/diagnostic
  chạy cùng lượt đo này. Trong A/B trước đó, thêm preload đúng production
  giữ PNG nhưng vẫn fail **142ms** qua 30 cold + 30 warm; CSS containment
  thử nghiệm thay chiều cao/ảnh nên không ship. Fixture route thiếu preload
  so với HTML backend; local measurement chưa chứng minh exact Edge/origin.

## Kiểm chứng bản sửa bổ sung ADR 0049

- Focused conflict/F5: **33/33 đạt**, exit 0, không skip; model/outbox,
  pull/detail/routing thật, có baseline đỏ và review độc lập.
- Focused bản nháp/lưu đánh giá: **79/79 đạt**, exit 0, không skip. Probe
  độc lập đường mặc định dùng model + autoSync thật kiểm 1 POST, chờ ACK,
  expectedVersion giữ đúng editor base, failed completion và no auto-restore.
- `npm run check:static`, `npm run build:secure`,
  `python scripts/verify_secure_build_artifact.py`,
  `npm run check:legal:production`: **đạt**, exit 0; **364 source modules**,
  không vòng import hoặc orphan, **168 bundle obfuscate**.
- `npm run audit:dependencies`: full/production npm audit **0 vulnerabilities**,
  pip-audit **no known vulnerabilities**, exit 0.
- `npm run test:js:coverage`: **2.026 passed, 0 failed/skipped**, exit 0,
  **479,63 giây**; lines **56,64%**, branches **66,95%**, functions **70,29%**;
  **14 mô-đun trọng yếu đạt**. Không hạ coverage/complexity threshold hoặc sửa
  expectation quyền để làm gate xanh. Lỗi complexity 81/80 của candidate
  trung gian đã được sửa bằng tách helper hẹp, không tăng ngưỡng.
- `npm run test:procurement-lookup-ui`: rerun cuối đạt, exit 0, tại
  320/768/1280px, controls 44px, không overflow/lỗi axe nghiêm trọng trong
  fixture được kiểm; không thay bằng chứng UI có xác thực trên staging.
- `npm run test:route-css-visual` trên build cuối `app-C-bL89lR.js`:
  **fail, exit 1**, long task **133ms > 100ms**. Lượt đo chạy riêng sau khi
  full JS, build, package và browser smoke đã kết thúc. Mẫu lỗi: frame
  **146,6ms**, style/layout, không script attribution; app-module-start tại
  **361ms** sau long task bắt đầu **83,8ms**. Không suy diễn đoạn CSS gây lỗi
  hoặc tình trạng exact Edge/origin chỉ từ fixture Chromium này; giữ gap mở.
- Không chạy lại Python full vì backend không thay đổi; bằng chứng trước
  vẫn được ghi đúng snapshot. Không chạy suite DB đồng thời với package smoke.

## Artifact snapshot ADR 0049 — trước tối ưu startup

Ứng viên dưới đây đã build/package lại từ nguồn bổ sung ADR 0049, không phải
ZIP của snapshot trước. Build/package cục bộ không phải phê duyệt go-live.

- `python scripts/package_production.py --check`: **đạt**, exit 0; chạy từ
  ZIP giải nén với DB cô lập `127.0.0.1:55432/biddingflow_api_test`, không chạy
  đồng thời với suite DB. Không dùng DB development/production.
- `python scripts/package_production.py`: tạo lại `release/biddingflow-production.zip`,
  **882 runtime files**, **5.183.472 bytes**; `PRODUCTION_MANIFEST.json` là
  entry thứ 883.
- SHA-256: `94246fbf04188cdb7e4c37b02e86c20e10397661eb67279854d3f66bdef15e11`.
- Source-derived release ID:
  `c54085b775559d784fae9896ef5b67ba78f193f5f6d70e3768cc3e868e8f6552`.
- Kiểm ZIP trực tiếp: billing helper mới có mặt, DOMPurify **3.4.16**;
  **0** Markdown/source map/`.env`/private-symbols entries. Đây là kiểm tra
  allowlist/artifact, không thay secret scan của CI. ZIP chứa app mới
  `app-C-bL89lR.js`; checksum sidecar đã được cập nhật và đối chiếu khớp.
- `npm run sbom`: đạt, tạo inventories dependency/vendor. Công cụ Python
  cảnh báo root component chưa có dependency edges; không khẳng định đồ thị
  SBOM root đã đầy đủ.
- ZIP và checksum trước bổ sung F5 đã được thay bằng ứng viên trên. Không dùng
  checksum cũ hoặc coi build/package pass là phê duyệt production.

## Kiểm chứng bổ sung ADR 0050 — startup landing 100 ms

Các kết quả ở phần ADR 0049 phía trên là lịch sử, được supersede cho frontend,
build/package và hiệu năng bởi snapshot dưới đây; không đổi verdict các lượt đỏ.
Backend không thay đổi trong lượt tối ưu này, không chạy lại Python full.

Nguyên nhân đã đo: bootstrap ghi icon/text rồi đọc scrollY làm flush bố cục
cả tài liệu. Harness được sửa về HTML/preload/cache/bootstrap/collector đúng
vòng đời: baseline secure app cũ tái hiện task **231 ms**, trong đó forced
style/layout **221 ms**; baseline lặp lại vẫn **136 ms**. Chỉ bỏ lần đọc
scrollY vẫn **121 ms** nên không đủ. Bản sửa dùng viewport-driven layout
cho section dưới hero/footer; giữ nguyên toàn bộ DOM, font, typography,
thiết kế, dữ liệu và các contract quyền. Xem [ADR 0050](adr/0050-landing-startup-viewport-layout.md).

Regression đã bắt và sửa thêm lệch native anchor, reload fragment khoảng
916 px và Back sau numeric scrollbar jump khoảng 40,5 px. Materialize trước
native anchor/reload; `pagehide` giữ vị trí section đang thấy theo tọa độ
canonical, không lưu chiều cao ước lượng. Không dùng timer để che thứ tự lỗi.
Contract giữ nội dung conflict đến F5 của ADR 0049 không thay đổi.

- `npm run check:static`: rerun cuối **đạt**, exit 0; 364 source modules,
  không vòng import/orphan, schema/encoding/debt/discovery gates giữ nguyên.
- `npm run build:secure`, `python scripts/verify_secure_build_artifact.py`
  và `npm run check:legal:production`: **đạt**, exit 0; 168 bundle obfuscate.
  Source-derived ID khớp marker/manifest của build và ZIP dưới đây.
- `npm run test:js:coverage`: **2.049 passed, 0 failed/skipped**, exit 0,
  **517,54 giây**; lines **56,64%**, branches **67,00%**, functions **70,29%**;
  **14 mô-đun trọng yếu đạt**, không hạ threshold hoặc đổi expectation quyền.
- Rerun focused cuối gồm deferred layout, responsive, dynamic pricing, icons
  và hai browser collector/navigation controls: **26/26 đạt**, exit 0,
  **69,40 giây**, không skip. Cả **9/9 deferred-layout tests** đạt; thêm
  đối chứng font/color/geometry/SVG path/stroke bằng primary text/paint guards.
  Đối chứng này kiểm guards metadata/geometry, không riêng thuật toán raster.
- Rerun conflict/F5 cùng policy/collector unit tests: **45/45 đạt**, exit 0,
  gồm 33/33 conflict/F5 và 12/12 policy/collector. Full JS cũng chạy các ca này.

So sánh visual dùng browser bình thường ở 320/768/1280; viewport ban đầu
pixel-identical, section được nhìn thấy giữ exact DOM/text-line/font/style/
pseudo/SVG geometry. Raster corner có giới hạn 3 px glyph/2 px SVG như ADR,
không chấp nhận sai màu phẳng hoặc tỷ lệ sai toàn ảnh; không tuyên bố mọi ảnh
sau cuộn pixel-identical. Native AX browser riêng chứng minh nội dung skipped
vẫn accessible; không bật AX flag trong phép đo hiệu năng.

Hai lượt `npm run test:route-css-visual` trên **cùng build cuối**, chạy riêng,
không có build/suite/probe khác chạy cùng:

| Lượt | Cold / warm | Task dài nhất được ghi nhận | Median ready cold / warm | P95 ready cold / warm | Hashed-asset HTTP requests cold / warm |
| --- | --- | --- | --- | --- | --- |
| 1 | 30 / 30 | Không có task >=50 ms | 140,3 / 45,4 ms | 421,9 / 114,4 ms | 300 / 0 |
| 2 | 30 / 30 | Không có task >=50 ms | 141,1 / 46,8 ms | 440,0 / 98,5 ms | 300 / 0 |

Ngưỡng vẫn **100 ms cho từng startup long task**, không phải tổng ready time.
Giá trị `longestTaskMs=0` nghĩa là browser không báo task >=50 ms, không phải
mọi công việc có thời lượng bằng 0. Cả hai lượt exit 0, đủ 120 mẫu tổng cộng,
12 route/viewport visual checks mỗi lượt, không overflow hoặc runtime/network
errors. Chromium **151.0.7922.34**, Node **v24.18.0**, Windows, Intel Core Ultra
9 285H. CDP chỉ fulfill Document; assets dùng origin HTTP/cache native với
security bình thường, block riêng `local.adguard.org`, service worker bị block.
Chờ bootstrap thành công và initial render/font; collector lỗi/resource thiếu
không được coi là mẫu 0. Task bắt đầu trong cửa sổ đo nhưng kéo dài qua
cutoff vẫn được tính đủ thời lượng. Không có getter instrumentation.

Log: `data/logs/landing-startup-final-gate-1.log`,
`landing-startup-final-gate-2.log`, `landing-startup-final-js-coverage.log`,
`landing-startup-final-focused.log`. Probe/PNG tạm đã dọn; review tĩnh độc lập
không phát hiện lỗi cụ thể còn lại trong seam sửa. Bằng chứng này chỉ áp dụng
public landing fixture cục bộ, không thay authenticated Edge/staging/production
startup, smoke F5/IndexedDB hoặc kiểm chứng máy chủ thật.

## Artifact hiện hành — sau ADR 0050

- `python scripts/package_production.py --check`: **đạt**, exit 0; extracted
  runtime với DB cô lập `127.0.0.1:55432/biddingflow_api_test`, đã xác nhận
  khác DB ứng dụng; không chạy cùng DB suite, không dùng DB production.
- ZIP hiện hành `release/biddingflow-production.zip`: **882 runtime files**,
  **883 entries**, **5.201.005 bytes**, gồm manifest; app `app-ChxRBdez.js`.
- SHA-256: `c892d5536a227dbf87e860752b8bdfa929625cf01794808bb45367739f5afd94`.
- Source-derived release ID:
  `9ba7082517f82a60f48cd27bb436a7a82259c1a3e772f349aaa5e18c8fa3747d`.
- ZIP/marker/hash/sidecar đối chiếu khớp; billing helper có mặt, **0** Markdown,
  source map, `.env` hoặc private-symbols entries. Không thay secret scan CI.
- `npm run sbom`: đạt, inventories đã tạo lại. Cảnh báo Python root component
  thiếu dependency edges vẫn tồn tại; không gọi đồ thị SBOM root đầy đủ.
- ZIP/sidecar trước tối ưu được giữ dưới tên
  `biddingflow-production.pre-startup-20261001.zip[.sha256]` để phục hồi.
  Không dùng bản backup làm ứng viên mới. Không commit, push, deploy, restart
  production hoặc thực hiện giao dịch PayOS thật.

## Contract, triển khai và rollback

Xem [ADR 0048](adr/0048-production-audit-bounded-correctness-repairs.md) và
[checklist cài đặt/cấu hình](production-setup-checklist.vi.md).
Không có migration PostgreSQL trong lượt sửa này. Metadata recovery additive
theo tài khoản/workspace, bản nháp không phải mutation có thể tự phát lại.
Không xóa dữ liệu nghiệp vụ/lịch sử thanh toán. Markdown là tài liệu repository,
không được đưa vào runtime production archive.
