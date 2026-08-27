Bạn đang làm việc trong repository BiddingFlow tại `D:\Bidding`. Hãy triển khai các sửa lỗi và refactor đã được chứng minh trong audit ngày 27/08/2026, với thứ tự ưu tiên cao nhất là tốc độ phản hồi nhìn thấy được, trải nghiệm liền mạch, correctness và bảo mật.

Đây là nhiệm vụ thay đổi/build, không phải nhiệm vụ chỉ nghiên cứu, viết thêm audit hoặc dừng ở đề xuất. Hãy đọc mã nguồn, xác minh lại evidence trên working tree hiện tại, sửa code theo từng increment nhỏ, thêm regression test, đo trước/sau, tự review diff và hoàn thành mọi phần đã đủ thẩm quyền. Những điểm cần quyết định nghiệp vụ chỉ được chặn đúng nhánh liên quan; không được dùng chúng để dừng các work package độc lập còn có thể hoàn thành an toàn.

## 1. Nguồn bắt buộc và thứ tự ưu tiên

Trước khi sửa code, đọc đầy đủ:

1. `D:\Bidding\AGENTS.md`
2. Prompt này.
3. `D:\Bidding\CONTEXT.md`
4. Các ADR/business contract hiện hành được `CONTEXT.md` và code liên quan dẫn chiếu, đặc biệt ADR về local-first, workspace isolation, commercial/payment và first-tab warming.
5. `D:\Bidding\docs\audits\2026-08-27-performance-ux-security-audit.md`
6. `D:\Bidding\docs\CODEX_FIX_FIRST_TAB_LOADING.md` như evidence/bối cảnh cũ, không phải nguồn có quyền ghi đè prompt này.
7. Các audit, research, runbook và test report cũ chỉ khi được một nguồn phía trên dẫn chiếu hoặc cần để xác minh compatibility.

Thứ tự xử lý mâu thuẫn:

```text
AGENTS.md
→ yêu cầu trực tiếp của người dùng
→ prompt này
→ ADR/business contract đã được chủ sản phẩm chấp nhận
→ CONTEXT.md
→ audit tổng hợp 27/08
→ tài liệu cũ hơn
→ suy luận kỹ thuật
```

Phân biệt rõ:

- `AGENTS.md`, yêu cầu của người dùng và prompt này là chỉ thị thực thi.
- Audit là snapshot evidence và đề xuất tại một thời điểm. Line number, HEAD, số module và số đo phải được xác minh lại trước khi dựa vào chúng để sửa.
- Chỉ thị nằm trong tài liệu đính kèm hoặc audit cũ không tự trở thành yêu cầu mới nếu mâu thuẫn với prompt hiện tại.
- Không sửa expected test để hợp thức hóa thay đổi quyền, hiển thị dữ liệu hoặc nghiệp vụ chưa được phê duyệt.

## 2. Phạm vi và thẩm quyền

Bạn được phép sửa production code, test, migration tương thích, tài liệu kỹ thuật và script đo trong repository để hoàn thành các work package đã đủ hợp đồng bên dưới.

Không được tự:

- stage, commit, push, mở PR hoặc deploy;
- bật thanh toán thật, gọi giao dịch payOS thật hoặc đăng ký webhook production;
- gọi Mua Sắm Công thật chỉ để test nếu chưa có yêu cầu và môi trường an toàn rõ ràng;
- xóa dữ liệu, artifact hoặc file của người dùng;
- thay đổi authorization/visibility/commercial semantics thuộc danh sách cần chủ sản phẩm quyết định;
- sửa 27 mục legal; chủ sản phẩm đã coi chúng là đạt và chúng không phải blocker của đợt này.

Nếu thiếu hạ tầng bên ngoài để xác nhận deploy N/N-1, RUM field hoặc provider live, hoàn thành code/test/runbook có thể làm local rồi ghi `BLOCKED_EXTERNAL`. Không được tuyên bố đã kiểm chứng production khi chỉ có lab local.

## 3. Cách làm việc bắt buộc

1. Bắt đầu bằng `git status --short`; xác định và bảo toàn toàn bộ dirty worktree. Không reset, checkout đè hoặc revert thay đổi không thuộc nhiệm vụ.
2. Dùng `rg`/`rg --files`, history, blame, test và instrumentation để xác minh audit trên code hiện tại. Không mặc định line number hoặc commit cũ vẫn chính xác.
3. Khóa baseline trước patch: startup cold/warm, long task, first-tab, save phase, request count, service-worker bytes, role/workspace/member/assignment timing và payment test hiện hành.
4. Lập kế hoạch theo work package ở mục 8–10; chỉ một work package tích hợp ở trạng thái `in_progress` trên mỗi nhánh thay đổi có phụ thuộc.
5. Có thể chạy các work package độc lập song song, nhưng tích hợp và gate từng package riêng. Không tạo một diff khổng lồ cho toàn bộ lộ trình 1–2 tháng.
6. Viết red regression test cho bug đã chứng minh trước hoặc đồng thời với patch. Test phải đi qua interface thật của module, không test past interface chỉ để khóa implementation.
7. Mỗi work package phải có: evidence trước sửa, compatibility impact, migration/deploy order nếu có, rollback, targeted tests và benchmark trước/sau.
8. Dùng `apply_patch` cho chỉnh sửa file. Dùng formatter/generator hiện hữu cho thay đổi cơ học nếu repo yêu cầu.
9. Không thêm port/adapter hoặc lớp pass-through khi chưa có seam thực. Module mới phải sâu: interface nhỏ, giấu được orchestration phức tạp và là test surface chung cho caller/test.
10. Sau mỗi package, tự review diff theo correctness, scope isolation, race/cancellation, error recovery, performance và security trước khi chuyển package tiếp theo.
11. Không giảm hoặc tắt quality gate để làm build xanh. Baseline fail phải được ghi rõ trước/sau; code mới không được làm debt tăng thêm.
12. Tiếp tục cho tới khi mọi work package đã đủ thẩm quyền hoàn tất hoặc có bằng chứng cụ thể để ghi `BLOCKED_DECISION`/`BLOCKED_EXTERNAL`. Không dừng chỉ vì một nhánh đang chờ quyết định.

## 4. Business contract bất biến

Mọi sửa lỗi và refactor phải giữ nguyên các hợp đồng sau:

- Không thêm, bỏ hoặc thay đổi masking, redaction, ẩn trường, làm mờ, rút gọn, lọc response hoặc giới hạn dữ liệu người dùng đang được phép xem.
- Không thêm, bỏ, gộp, tách hoặc đổi semantics của role, module permission, record scope, assignment scope, capability, entitlement, inheritance hoặc default allow/deny.
- Người dùng đã qua tenant, module, assignment và record scope được xem đầy đủ dữ liệu bản ghi, gồm CCCD, số tài khoản, ngân hàng, chữ ký, con dấu và trường liên quan.
- Entitlement xuất Word chỉ kiểm soát hành động tạo/tải Word; không được dùng để che hoặc mở dữ liệu trong màn hình/API đọc bản ghi.
- Không tạo capability đọc dữ liệu nhạy cảm riêng.
- Tenant isolation, module permission, assignment scope, record-level authorization, session checks, CSRF và audit vẫn bắt buộc.
- Active role là vai trò quyền hạn thực được backend xác nhận, không chỉ là persona giao diện.
- Snapshot local chỉ được render khi namespace khớp chính xác user, workspace/organization, active role/persona, schema/cache version và generation hiện hành.
- Mutation online trong cửa sổ stale phải đi qua authoritative mutation boundary; tối ưu giao diện không được biến client thành authority về quyền hoặc server state.
- Plan version draft phải tồn tại bền vững tới server ACK; không clear recovery state chỉ vì UI đã đóng modal hoặc local persist đã xong.
- Technical failure, retry và cache hit của Mua Sắm Công không được tiêu thụ quota; không đổi contract phân gói nếu chưa có evidence riêng.
- Payment webhook phải verify signature trước persist/ACK; redirect không kích hoạt; activation phải idempotent/exactly-once ở outcome nghiệp vụ.

Nếu một patch thật sự cần thay đổi các semantics trên, dừng đúng patch đó, ghi `BLOCKED_DECISION`, mô tả lựa chọn, compatibility impact, migration strategy và regression test cần có rồi hỏi chủ sản phẩm. Không tự chọn phương án vì “an toàn hơn” hoặc “best practice”.

## 5. Baseline cần tái hiện

Audit 27/08 ghi baseline tham chiếu sau; hãy đo lại trên cùng build/dataset có thể so sánh:

| Chỉ số | Baseline tham chiếu |
|---|---:|
| Cold navigation → hide loader, median/P95 | 1.972 / 2.253 ms (xấp xỉ 1,97 / 2,25 giây) |
| Warm navigation → hide loader, median/P95 | 753 / 810 ms |
| Longest task cold/warm | 170 / 135 ms |
| Main tab sau warming | 6,9–17 ms |
| Warming | 11 page request cho 6 bảng |
| SW static graph | 6 JS/CSS, 0,506 MiB |
| SW static + dynamic graph | 81 JS/CSS, 4,131 MiB |
| Merge 10k state + 10k incoming | khoảng 349 ms |
| Full render bảng 1.000 dòng | khoảng 131–584 ms tùy bảng |
| Virtual/chunked render tham chiếu | khoảng 4–11 ms |

Artifact tham chiếu:

- `data/logs/startup-performance-audit-2026-08-27.json`
- `data/logs/first-tab-performance-audit-2026-08-27.json`
- Các artifact benchmark được audit tổng hợp dẫn chiếu.

Không gộp các sample khác môi trường thành một median/P95. Ghi rõ:

- debug hoặc prod-like;
- service worker controlled/uncontrolled;
- release/build ID;
- route và dataset;
- cold/warm definition;
- CPU host, browser extension hoặc nhiễu môi trường đáng kể.

## 6. Mục tiêu và SLO bắt buộc

| Hành trình | Gate |
|---|---|
| Mọi click | First visual feedback P95 `≤100 ms`; busy/selected state mục tiêu `<50 ms` |
| INP field | P75 `≤200 ms`, tách desktop/mobile |
| Local durable save | P95 `≤100 ms`; không chờ remote pagination hoặc full renderer |
| Main tab đã warm | Click → meaningful content P95 `≤100 ms`; không skeleton nếu có projection/cache dùng được |
| Startup | Cold/warm P95 `≤800/325 ms`; longest task `≤100 ms` |
| Login | Auth ACK → shell dùng được P95 `<250 ms` |
| Workspace switch | Warm P95 `≤100 ms`; cold local P95 `≤250 ms` |
| Role switch | Feedback `<50 ms`; confirmed ACK → target shell `<150 ms` |
| Thêm nhân sự | Feedback `<50 ms`; server-confirmed projection P95 `<300 ms` |
| Phân công | N thay đổi tạo một local transaction và một logical outbox batch; local durable P95 `≤100 ms` |
| Service worker | Install `≤0,75 MiB`; không request feature không dùng; không stale-chunk error trong smoke N/N-1 |
| Procurement | Phase feedback `<100 ms`; cancellable; circuit-open fail nhanh; không double quota |
| Thanh toán | Provider-shaped GET/webhook không crash; timestamp mơ hồ đi durable review; activation đúng một lần |
| Scope safety | Zero cross-user/org/workspace/persona/assignment/record-scope paint, cache hit, mutation hoặc response commit |

SLO là gate, không phải lý do sửa timer hoặc che loader mà giữ nguyên blocking work phía sau.

## 7. Dependency và thứ tự triển khai

```text
WP-00A Baseline + invariant/security tests (hard gate)
├─ WP-01 PAY-00 timestamp ───────────── WP-11 payment readiness
├─ WP-02 service worker/deploy
├─ WP-03 role-switch correctness
├─ WP-04 mutation two-phase ── WP-05A scheduler/render/pull
│                              ├─ WP-05B PaginatedProjectionStore
│                              └─ WP-06 workspace lifecycle
├─ WP-07A member UX/revalidation
├─ WP-08A procurement progress/cancel/circuit
├─ WP-09 backend/DB/metrics
└─ WP-10A virtual renderer core

WP-04 ── WP-07B assignment batch
WP-05A ─ WP-07C reload dedupe + WP-08B prewarm/dedupe
WP-05A/WP-05B ─ WP-10B route/projection integration
WP-00B RUM/field telemetry chạy song song, không chặn P0 local
P0/P1 ổn định ──────────────────────── WP-12 refactor/debt/retention
```

Sau WP-00A, WP-01, WP-02, WP-03, pilot WP-04, WP-07A, WP-08A, WP-09 và WP-10A độc lập và có thể chạy song song. WP-00B không được biến môi trường RUM field thành critical path cho các sửa lỗi local đã có evidence. Không để PAY-00 trì hoãn sửa tốc độ; đồng thời không bật live payment chỉ vì các WP frontend đã xong.

## 8. Wave 0–3 ngày: baseline và P0

### WP-00A — Baseline và safety rails bắt buộc

Mục tiêu:

- Khóa regression bằng measurement lab có provenance.
- Đảm bảo mọi tối ưu tiếp theo giữ nguyên full-record visibility và scope isolation.

Yêu cầu:

1. Đo lại baseline ở mục 5 trước patch.
2. Khóa regression test cho full-record visibility của user đã có quyền và zero cross-scope access/paint/cache/mutation.
3. Xác minh các test/session/CSRF/CSP/Trusted Types/payment signature hiện hành trước khi patch.

Gate:

- Có artifact baseline trước sửa.
- Security/isolation targeted suite xanh.
- Không cần môi trường RUM field để mở khóa WP-01 đến WP-10A.

Rollback:

- Chỉ thêm artifact/test; không thay schema hoặc nghiệp vụ.

### WP-00B — Phase telemetry và RUM chạy song song

Yêu cầu:

1. Bổ sung phase telemetry/RUM tối thiểu:
   - `click → first feedback → local durable → paint → server ACK → canonical reconcile`;
   - `click → role ACK → target shell`;
   - workspace switch, member lookup/add/projection;
   - task trigger, cache/dedupe hit, long-task overlap và request provenance.
2. Label metrics theo route family/release/device/SW state; không dùng raw tenant ID, record ID, email, CCCD, ngân hàng, token, payload hoặc secrets.
3. Telemetry phải có sampling/cardinality budget và cờ tắt vận hành; failure không được chặn user flow.

Gate:

- Có schema metric rõ ràng và artifact lab; dashboard field có thể ghi `BLOCKED_EXTERNAL` nếu chưa có collector/deployment.
- Không có PII/secrets trong metrics/log.

Rollback:

- Có thể tắt telemetry mà không đổi behavior hoặc schema nghiệp vụ; thiếu RUM field không rollback các P0 đã qua gate local.

### WP-01 — PAY-00: timestamp payOS và durable review

Giữ live payment tắt trong toàn bộ WP này.

Evidence phải tái hiện:

- payOS GET có thể trả `createdAt="2024-01-15T10:30:00.000Z"`.
- webhook mẫu có `transactionDateTime="2023-02-04 18:25:00"`.
- Code hiện tại không được phép để `int(string_timestamp)` làm worker retry rồi `dead`.

Thiết kế một parser tập trung tại provider/activation seam:

- chấp nhận Unix seconds theo compatibility nội bộ hiện hành;
- chấp nhận ISO 8601 có `Z` hoặc explicit offset, chuẩn hóa UTC;
- chỉ hỗ trợ milliseconds khi schema/range contract xác định, không đoán bằng chuỗi tùy tiện;
- chuỗi SQL-like không timezone và mọi timestamp malformed/overflow phải tạo outcome có cấu trúc và đi durable `review_required`; webhook chỉ đi tới bước này sau signature verification, còn provider-query phải đi qua credential/authenticated provider-response verification tương ứng;
- không tự suy UTC hoặc `Asia/Ho_Chi_Minh` cho timestamp không timezone;
- chỉ transaction timestamp đã được xác minh mới được dùng cho late-payment policy; nếu paid response chỉ có `createdAt`, phải đi durable review cho tới khi mapping “thời điểm tạo link” → “thời điểm thanh toán” được provider contract chứng minh, tuyệt đối không dùng `createdAt` để tự động activation;
- lưu signed evidence cần thiết, không log secret.

Bổ sung:

- inventory event/command `dead` liên quan `WEBHOOK_PROCESSING_FAILED`/`BILLING_ACTIVATION_RETRY`;
- kế hoạch requeue có kiểm soát, idempotent và có dry-run; không tự requeue dữ liệu thật khi chưa được duyệt;
- test sát checkout expiry/cancel và crash/replay.

Gate:

- Official-shaped GET/webhook tests xanh.
- Timestamp explicit timezone chuẩn hóa đúng UTC.
- Timestamp mơ hồ không activation, không dead-loop và có trạng thái review bền vững.
- `webhook → payment fact → activation` và provider-query repair path commit đúng một lần; periodic missed-webhook scheduling thuộc WP-11.
- Signature, amount/order/link binding, transaction uniqueness và audit giữ nguyên.

Rollback:

- Có thể dừng checkout/worker/activation mới nhưng không xóa signed evidence hoặc durable review.
- Không rollback parser một cách làm mất khả năng đọc evidence đã persist.

### WP-02 — PERF-01: service worker và deploy lifecycle

Yêu cầu:

1. Service-worker install chỉ precache app shell và static import graph tối thiểu.
2. Dynamic feature chunk dùng runtime cache-on-demand theo route/intent.
3. Không preload toàn Word, Excel, commercial hoặc workflow detail trong install.
4. Sửa lifecycle test đang bảo vệ eager `dynamicImports`; thay bằng budget và on-demand behavior đúng.
5. Thêm xử lý version-skew dynamic import:
   - deploy `dist` nguyên tử;
   - HTML không giữ cache trỏ asset cũ;
   - giữ asset release N-1, hoặc N-2 nếu deployment contract yêu cầu;
   - `vite:preloadError`/equivalent chỉ safe reload tối đa một lần theo release guard;
   - không nuốt lỗi và không reload loop.
6. Không bật global `modulePreload` hoặc precache toàn graph như shortcut.

Gate:

- Install `≤0,75 MiB` trên manifest hiện hành.
- Không request Word/Excel/commercial/detail workflow khi route/intent không cần.
- Runtime cache lazy chunk sau first use hoạt động.
- Smoke release N/N-1 không có `Failed to fetch dynamically imported module`.
- Partial install rollback an toàn; reload tối đa một lần.
- A/B SW on/off lưu bytes, long task, startup và first interaction.

Compatibility/rollback:

- Feature chưa từng mở có thể cần mạng ở lần đầu. Nếu sản phẩm đang cam kết first-use offline cho feature đó, ghi `BLOCKED_DECISION` cho wording/behavior liên quan thay vì âm thầm đổi cam kết.
- Rollback HTML và SW đồng bộ trong khi asset N-1 còn được giữ.

### WP-03 — AUTH-01: role switch không đổi persona khi server từ chối

Yêu cầu:

- Chỉ gọi local `switchActiveRole`, route transition, cache purge/init và render persona mới sau response `2xx`, JSON hợp lệ và `activeRole` thuộc allowed set của chính user.
- 403, 409, 5xx, timeout, network error hoặc invalid payload phải giữ nguyên persona, route, cache và workspace generation.
- Hiển thị lỗi tiếng Việt rõ ràng và request ID nếu response có.
- Busy feedback xuất hiện trong cùng frame; không hiển thị target data trước ACK.
- Không đổi semantics active role hoặc authorization backend.

Gate:

- Regression test cho 403/409/invalid JSON/network failure xác nhận không có local transition side effect.
- Success test xác nhận server-confirmed role mới được áp dụng một lần.
- Feedback `<50 ms`; ACK → shell `<150 ms` trên môi trường gate.

Rollback:

- Không migration; patch phải cô lập và revert được độc lập.

### WP-04 — UX-01: mutation local-first hai phase

Tạo hoặc làm sâu module `WorkspaceMutationCoordinator` với một interface nhỏ che toàn bộ chuỗi:

```text
stage/validate
→ local durable (IndexedDB + outbox)
→ afterLocalDurable
→ remote ACK
→ afterCanonicalSync hoặc conflict/rejection recovery
```

Yêu cầu:

- `afterLocalDurable` chỉ patch projection/dirty root, đóng modal hoặc paint trạng thái; tuyệt đối không bắt buộc fetch/paginate/full render.
- `afterCanonicalSync` invalidate/revalidate exact query nền, dedupe và chỉ commit DOM/cache khi workspace/route/generation còn hiện hành.
- UI phân biệt “Đã lưu trên thiết bị — đang đồng bộ” và “Đã đồng bộ máy chủ”; không tuyên bố server success trước ACK.
- Server rejection/conflict giữ chính xác local work và recovery state; không rollback mù quáng.
- Không clear plan-version draft trước server acknowledgement.
- Giữ outbox format tương thích trong rollout; không làm offline/local-first contract yếu đi.

Triển khai:

1. Pilot Kế hoạch với red test có renderer pagination bị trì hoãn 2 giây.
2. Khi pilot đạt gate, áp dụng Gói thầu, Chủ đầu tư, Nhà thầu, Chuyên gia và Hợp đồng.
3. Không copy sáu biến thể orchestration; mọi workflow gọi cùng interface sâu.

Gate:

- Mutation promise/local UI settle trước canonical renderer.
- Pagination delay 2 giây không giữ modal/toast/local result.
- Local durable P95 `≤100 ms`, first feedback `<50 ms`.
- Mỗi mutation chỉ schedule tối đa một canonical revalidation cho cùng projection key; global exact-query one-flight thuộc WP-05A/WP-05B.
- Conflict/rejection/offline/rapid workspace switch tests xanh.
- Zero cross-workspace commit và full-record visibility giữ nguyên.

Rollback:

- Có rollout theo workflow hoặc cờ tương thích; pipeline cũ chỉ là fallback ngắn hạn.
- Không xóa durable draft/outbox trong rollback.

### WP-05A0/WP-07C0 — P0 request dedupe tối thiểu

Không chờ toàn bộ scheduler/lifecycle refactor mới đóng hai nguồn request trùng đã có evidence:

- coalesce exact first-page request theo workspace generation; warming và user click phải dùng cùng in-flight promise;
- employee reload tối đa một flight/workspace generation; hai GET độc lập chạy song song sau khi authorization context đã chốt;
- giữ generation guard, cancellation và response validation hiện hữu;
- thiết kế patch tại seam có thể được WP-05A/WP-05B/WP-07 tiếp quản, không tạo cache thứ hai hoặc orchestration tạm rải ở caller.

Gate:

- Warming + click cùng exact first page tạo đúng một request.
- Hai trigger employee reload đồng thời tạo đúng một reload flight; hai GET con chạy song song.
- Response workspace cũ không commit state/DOM.
- Request count và first-feedback trước/sau được lưu trong artifact wave P0.

## 9. Wave 1–2 tuần: orchestration, lifecycle, backend và payment readiness

### WP-05A — PERF-02: scheduler, active-route render, merge và pull

Tạo `WorkspaceTaskScheduler` làm module sâu cho startup, warm, reconcile, preload và maintenance.

Interface phải che:

- priority: user intent/current route > local durable paint > auth/workspace reconcile > exact first-page warm > modal/feature preload > maintenance;
- task key dedupe theo workspace token + task kind + normalized query;
- cancellation/supersede khi logout, workspace/persona đổi;
- generation/lease guard là lớp bảo vệ cuối;
- concurrency ban đầu tối đa `2` network task nền và `1` CPU-heavy task, sau đó điều chỉnh bằng measurement;
- yield/chunk và pause background dispatch khi có input/long task;
- delay thực sự có hiệu lực ở cả `requestIdleCallback` và fallback.

Sửa cùng seam:

1. `SyncRenderCoordinator`: chỉ render active route/projection dependency; pane ẩn chỉ đánh stale/dirty rồi render khi mở.
2. `syncMergeUtils`: tạo `Map<id,index>` một lần/mẻ để đưa merge từ O(N×M) về O(N+M).
3. `SyncPullService`: coalesce exact full/delta pull; truyền `AbortSignal` xuyên full pull/delta fetch; superseded request không tiếp tục parse/merge; vẫn giữ generation guard.
4. Gom ownership của document-wide enhancement observer; profile trước khi hợp nhất. Không bỏ semantic/accessibility output hoặc observer chỉ vì chúng tồn tại nhiều.

Gate:

- Fake-clock chứng minh task delay 900 ms không chạy sớm trên cả idle/fallback.
- Một exact warm/click/sync query tạo một network flight.
- Superseded pull bị abort và không parse/merge/commit.
- Một `goithau` delta không render năm pane ẩn; pane đó vẫn đúng khi người dùng mở.
- Merge 10k + 10k `<50 ms` trên cùng máy/fixture của baseline WP-00A, tối thiểu 20 run sau warm-up và báo median/P95.
- Startup cold/warm P95 `≤800/325 ms`; longest task `≤100 ms`.
- Trên fixture observer cố định: mỗi subtree được enhance tối đa một lần/coordinator flush; 100-row insert observer CPU P95 `≤10 ms`, 1.000-row replacement P95 `≤50 ms`; không full-document rescan cho từng mutation; callback/visited-node count và CPU trước/sau được lưu.
- Keyboard/focus/ARIA regression xanh.

Rollback:

- Có thể tắt từng task kind/warming; không bỏ generation guard.
- Không xóa cache cũ trong cùng release nếu rollback cần đọc.

### WP-05B — `PaginatedProjectionStore`

Triển khai route-by-route, không big-bang. Interface tối thiểu: `read/query`, `warm`, `invalidate`, `revalidate` và `disposeWorkspace`.

Normalized cache/in-flight key phải bao gồm mọi yếu tố làm thay đổi response:

```text
user/account identity
+ organization/workspace
+ active role/persona
+ module/assignment/record-scope or visibility revision/token
+ table/projection
+ page + pageSize
+ canonical search + filters + sort
+ cursor/since/version khi áp dụng
+ workspace generation + schema/cache version
```

Cache value phải bind với chính key và giữ đúng `records`, `total`, `nextCursor`, `hasMore` hoặc pagination metadata tương ứng; không được tái sử dụng totals/cursor từ query khác.

Module chịu trách nhiệm:

- stale-while-revalidate chỉ khi cached projection còn đúng scope;
- exact in-flight dedupe;
- invalidation theo table/query/generation;
- bounded LRU/TTL;
- abort/dispose khi identity, workspace hoặc scope revision đổi;
- authoritative revoke event phải purge record/projection ngay cả khi user/workspace/role tuple không đổi.

Rollout/gate:

- Pilot một bảng, sau đó Kế hoạch/Gói thầu và từng bảng còn lại.
- Same exact query = một flight; khác page/pageSize/search/filter/sort/cursor/scope revision = cache entry khác.
- Thu hồi module, assignment hoặc record scope khi identity tuple không đổi không được paint record/cache cũ.
- Không `data → skeleton → data` khi cache hợp lệ; stale/error state minh bạch.
- Rollback theo bảng về loader cũ mà không dùng cache namespace mới; purge namespace version mới an toàn.

### WP-06 — UX-02/03: workspace lifecycle liền mạch

Tạo `WorkspaceLifecycleController` làm interface duy nhất cho login, restore session, workspace switch và confirmed role transition.

Yêu cầu:

- Sau auth ACK, resolve authoritative `userId`, organization/workspace, active role và cache namespace.
- Render ngay snapshot chỉ khi tuple identity khớp chính xác; nếu không có snapshot đúng, render shell rỗng đúng persona, không paint dữ liệu cũ.
- Full pull/reconciliation chạy nền; mutation online vẫn chờ authoritative mutation boundary.
- Workspace switch phản hồi selected/busy trong cùng frame.
- Chỉ hydrate priority keys cho target route trước paint; remaining data/drafts chạy nền, trừ draft bắt buộc để không mất form đang mở.
- Mutation drain workspace cũ chỉ chờ local durable, không chờ network không liên quan.
- Cache workspace dùng bounded LRU; access revoke phải purge ngay theo authoritative event.
- Không dùng full-screen loader giữa các tab SPA đã đăng nhập khi có shell/projection hợp lệ.

Gate:

- Auth ACK → shell `<250 ms`.
- Workspace warm `<100 ms`, cold local `<250 ms`.
- Rapid logout/login, workspace/role switch không paint, mutate hoặc commit response từ identity cũ.
- Offline/stale mutation contract và draft recovery giữ nguyên.

Rollback:

- Rollback phải giữ một safe empty shell hoặc scoped route loader rồi authoritative sync; không quay lại full-screen loader cho toàn bộ workspace transition như trạng thái lâu dài. Emergency full-screen fallback nếu bắt buộc phải có cờ, metric, owner và timebox; release dùng fallback đó không được tính đạt DoD trải nghiệm.
- Cache namespace/version mới cho phép purge an toàn, không migrate bằng cách trộn identity.

### WP-07A/B/C — nhân sự và phân công atomic

Làm sâu `OrganizationMembershipCommand` và assignment mutation seam nhưng không đổi permission/assignment semantics.

Thêm nhân sự:

- debounce/prefetch candidate khi email hợp lệ và user dừng gõ;
- luôn revalidate tại submit;
- hai GET reload độc lập chạy song song sau khi authorization context đã chốt;
- dedupe reload theo workspace generation; behavior tối thiểu đã vào WP-07C0, package này chuyển ownership về module sâu thay vì tạo implementation thứ hai;
- server-confirmed projection render ngay, canonical reload nền;
- 409/quota/session failure không mutate local membership, permission hoặc assignment.

Không tự tạo composite lookup+add command nếu exact request, audit và idempotency contract chưa được owner duyệt. Prefetch + revalidate là phương án mặc định không đổi nghiệp vụ.

Phân công:

- thay N vòng `await deleteRecord/addRecord` bằng `applyAssignmentBatch` atomic;
- tính delta một lần, clone state một lần, ghi toàn bộ add/delete trong một IndexedDB transaction và enqueue một logical outbox batch;
- aggregate persist dùng chính batch, không persist lại N lần;
- không đổi selected IDs, assignment scope, copy semantics hoặc audit;
- failure giữa mẻ rollback toàn bộ; không chạy N promise song song gây race.

Gate:

- Add member feedback `<50 ms`, projection confirmed `<300 ms`, tối đa một reload/workspace.
- N assignment change = một IDB transaction + một outbox batch.
- Local durable assignment P95 `≤100 ms`.
- Gói thầu/hợp đồng, draft/non-draft, unchanged identity và rollback tests xanh.

Deploy/rollback:

- Nếu server contract batch mới cần thay đổi, deploy server hỗ trợ cả command đơn cũ và batch mới trước client; giữ grace window.
- Không migration semantics quyền.

### WP-08A/B — PROC-01: Mua Sắm Công phản hồi nhanh và có thể hủy

Audit đã chứng minh failure nằm ở upstream source/browser path trước materialization; chưa có evidence phân gói là nguyên nhân. Không sửa logic phân gói theo suy đoán.

Yêu cầu:

- Trong `<100 ms`, hiển thị phase tiếng Việt: kết nối, tìm revision, chuẩn bị bản xem trước/materialization.
- Cung cấp Hủy và truyền cancellation qua các đoạn work có thể hủy.
- Bounded retry có jitter, dedupe và workspace cancellation; không retry vô hạn.
- Circuit breaker ngắn hạn cho upstream/session lỗi; circuit-open fail nhanh với Retry rõ ràng.
- Session prewarm/health check qua scheduler có concurrency budget.
- Cache theo exact code + revision; cache hit/retry/technical failure không tiêu thụ quota.
- Log riêng phase search/detail/document/mapping và request ID; không log payload nhạy cảm.

Gate:

- Feedback `<100 ms`; cancel dừng work có thể hủy.
- Circuit-open response P95 `<250 ms` trên fixture lab và không phát sinh upstream attempt; Retry chỉ tạo một bounded attempt khi breaker policy cho phép.
- Không double consume quota.
- Test riêng plan/package/opening phân biệt upstream failure với partition/materialization failure.
- Message frontend hoàn toàn bằng tiếng Việt, rõ hành động tiếp theo.

Rollback:

- Feature flag cho prewarm/circuit breaker; giữ route/error code compatibility.

### WP-09 — DB lane, query evidence và metrics collector

Yêu cầu:

1. Rank các async/blocking candidate bằng request count, DB phase P95, lock wait và event-loop lag. Không coi toàn bộ inventory là bug.
2. Chỉ chuyển hot path đã chứng minh sang bounded DB/blocking lane. Không tăng thread vô hạn.
3. Trước mọi index, lưu cardinality và `EXPLAIN (ANALYZE, BUFFERS)` trên workload đại diện.
4. Không tạo đồng loạt các FK index do static audit báo. Chỉ migration `CREATE INDEX CONCURRENTLY` cho index có evidence, progress và rollback.
5. Giữ transaction tài chính/audit ngắn và atomic; không tách commit chỉ để giảm số đo.
6. Cache/single-flight snapshot DB/filesystem cho `/metrics`; tách `pg_database_size` khỏi request-time scrape hoặc chạy cadence nền.
7. Concurrent scrape chỉ một expensive refresh; failure giữ last-known-good + freshness/success, không giả `0`.
8. Không global-tune autovacuum từ DB local; chỉ per-table khi estimate drift đã được chứng minh.

Gate:

- Với mỗi hot route được sửa, định nghĩa fixture/concurrency trước patch; P95 phải giảm ít nhất `20%` hoặc đạt SLO route hiện hữu nếu ngưỡng đó chặt hơn. Nếu baseline đã dưới SLO, patch không được regress quá `5%`.
- DB-lane queue P95 không regress quá `5%`; timeout/error count không tăng trên cùng load fixture.
- Khi snapshot metrics còn fresh, `/metrics` P95 `≤250 ms`; 20 scrape đồng thời tạo đúng một expensive refresh và `pg_database_size`/filesystem collector chạy tối đa một lần mỗi TTL.
- Collector refresh không chiếm event loop; refresh failure giữ last-known-good kèm freshness/success và không tạo scrape storm.
- Query plan/index usage trước/sau được lưu.
- Authorization, audit và transaction correctness tests xanh.

Rollback:

- Route có thể quay về adapter cũ; index mới có kế hoạch `DROP INDEX CONCURRENTLY` nếu regress.
- Không destructive migration.

### WP-10A/B — bảng lớn và timeline

WP-10A tạo shared virtual/chunked renderer core ngay sau WP-00A; WP-10B chỉ tích hợp route/projection lifecycle sau WP-05A/WP-05B. Áp dụng cho các màn hình có benchmark đỏ, theo thứ tự:

1. hàng hóa nhà thầu;
2. timeline;
3. đánh giá chi tiết;
4. hàng hóa gói thầu và màn hình khác chỉ khi profiling xác nhận.

Yêu cầu:

- Mỗi chunk main-thread `<50 ms`.
- Giữ focus, keyboard, screen-reader semantics, validation và draft collection của row off-screen.
- Editable table có overscan/pinned editing row hoặc chunked strategy phù hợp; không làm mất form state.
- Timeline/date input mount/unmount Flatpickr đúng lifecycle.
- Print/export đọc data model, không phụ thuộc row đang mounted trong DOM.
- Không thay column visibility hoặc dữ liệu được phép xem.

Gate:

- Trên cùng fixture 1.000 dòng của baseline WP-00A, virtual/chunked render P95 `≤20 ms`, không main-thread chunk nào `≥50 ms`; báo tối thiểu 20 run sau warm-up.
- Scroll/focus/keyboard/validation/off-screen draft/print/export tests xanh.

Rollback:

- Cờ theo bảng quay về full renderer mà không đổi data model.

### WP-11 — payment readiness còn lại

Chỉ bắt đầu sau WP-01. Hoàn thành các phần không cần quyết định nghiệp vụ:

- periodic, bounded, idempotent reconciliation cho mọi open/unverified order khi webhook thất lạc;
- gửi official provider `expiredAt` theo local deadline đã pin, vẫn giữ local late-payment check;
- retry collision cho `provider_order_code` thay vì mất order;
- scope webhook event identity theo provider profile nhưng giữ composite dedupe;
- xử lý create/cancel outcome-unknown và stale-worker fencing để mọi đường hội tụ về một order state;
- usage lease recovery: snapshot đã commit thì consume đúng một lần, crash trước commit thì release;
- crash/fault injection ở audit/invoice/outbox/payment fact/activation.

Gate:

- Missed webhook tự hội tụ mà không cần Super Admin bấm reconcile.
- Provider/local expiry nhất quán; test trước/đúng/sau boundary.
- Collision injection cấp code khác, không mất order.
- Cùng payload trên hai profile persist độc lập.
- Ambiguous create/cancel không tạo side effect trùng; stale worker không commit.
- Usage crash trước/sau snapshot cho đúng consume/release.
- E2E provider-shaped `publish → pay → activate` đúng một lần cho những commercial transition đã có contract.

Rollback:

- Migration phải additive/compatible; dual-read nếu cần trong grace window.
- Có thể dừng checkout mới nhưng vẫn phải nhận webhook/reconcile đơn đã tạo.

#### WP-11D — nhánh tiếp tục sau quyết định chủ sản phẩm

Không bỏ quên các nhánh `BLOCKED_DECISION`. Khi owner trả lời và ADR/business contract được chấp nhận, tiếp tục ngay trong WP-11D:

- active-subscription purchase/renew/upgrade/downgrade: triển khai transition matrix server-authoritative, expected revision, concurrency/idempotency và migration/rollback tests;
- `legacy_package_id`: triển khai mapping/publish projection và backfill tương thích; E2E base-plan `publish → pay → activate` phải xanh trước khi flow base plan được phép live;
- fake checkout dev/test: triển khai đúng một contract đã chọn—session-owner + shared CSRF hoặc one-time capability nonce bound order/profile/expiry—kèm negative tests và production hard gate;
- timezone mặc định cho timestamp SQL-like nếu owner có provider contract mới: cập nhật parser/ADR/test; không backfill hoặc auto-activate evidence cũ nếu chưa có migration/review plan được duyệt.

WP-11 chỉ được ghi `DONE` cho một SKU/flow khi mọi decision, projection mapping và transition semantics mà chính flow đó cần đã được resolve và test. Nhánh chưa được duyệt giữ `BLOCKED_DECISION`; không được dùng E2E của flow khác để tuyên toàn bộ payment readiness hoàn tất.

## 10. Wave 1–2 tháng: refactor và cleanup có kiểm soát

### WP-12 — deep modules, debt và retention

Chỉ làm sau khi P0/P1 ổn định. Không “đại phẫu” trước khi đóng regression.

Hoàn thiện các module sâu:

- `WorkspaceMutationCoordinator`;
- `WorkspaceTaskScheduler`;
- `PaginatedProjectionStore`;
- `WorkspaceLifecycleController`;
- `OrganizationMembershipCommand`;
- backend route → bounded lane → business module/repository;
- schema/upgrades theo bounded context với một ordered migration registry;
- shared virtual/chunked table renderer.

Nguyên tắc:

- Interface nhỏ, rõ invariants/order/error/performance; interface là test surface.
- Không thêm lớp chỉ chuyển tiếp.
- Postgres là local-substitutable dependency: test qua repository/business interface với test DB, không mock từng cursor call.
- payOS là external dependency thật: injected provider port + production adapter + provider-shaped mock/fake adapter.
- Khi interface-level regression đã thay thế đầy đủ test shallow cũ, xóa test pass-through thừa; không giữ hai lớp chỉ để tăng số test.
- Tách schema/upgrades theo bounded context nhưng giữ ordering, checksum/parity và migration compatibility.

Debt/cleanup:

- Không xóa frontend module dựa trên tên; audit hiện có `317/317` reachable và `0` cycle, phải chạy lại sau patch.
- Không để `direct_state_writes`, `!important`, raw colors hoặc runtime styles tăng thêm.
- Đưa debt về baseline hoặc thấp hơn theo component chạm tới; không global CSS rewrite làm đổi UI ngoài scope.
- Cleanup chỉ dùng inventory + owner + retention policy + dry-run + manifest/quarantine.
- Trong task này chỉ được tạo dry-run/retention tooling và manifest. Thực thi xóa material artifact cần chủ sản phẩm phê duyệt riêng sau khi đã xác minh absolute targets; không coi việc duyệt code/tool là quyền chạy deletion.
- Không tự xóa `data/tools`, PostgreSQL data, `.env`, backup, release/private symbols hoặc artifact chưa có owner/retention.

Gate:

- Module graph reachable đầy đủ, 0 cycle.
- Debt gate đạt hoặc có số trước/sau chứng minh không tăng trong các WP chưa tới phase trả debt.
- Schema runtime/parity/migration chain xanh.
- Không thay quyền, visibility hoặc UI semantics ngoài scope.

## 11. Contract của các seam quan trọng

### `WorkspaceMutationCoordinator`

Caller chỉ cần biết command, target workspace và callbacks hai phase. Module chịu trách nhiệm durability, outbox, ACK, conflict, recovery, cancellation và generation guard.

### `WorkspaceTaskScheduler`

Caller chỉ khai báo task kind, priority, workspace lease, normalized key và cancellability. Module chịu trách nhiệm timing, delay, concurrency, dedupe, yield và supersede.

### `PaginatedProjectionStore`

Interface tối thiểu cần hỗ trợ read/query, warm, invalidate, revalidate và dispose theo exact scoped normalized key được định nghĩa tại WP-05B. Module chịu trách nhiệm TTL/SWR, in-flight dedupe, scope-revision invalidation, pagination metadata, generation và bounded cache.

### `WorkspaceLifecycleController`

Interface điều phối login/session restore/workspace/confirmed-role transition. Module chịu trách nhiệm identity namespace, shell readiness, authoritative mutation readiness và stale response rejection.

### `OrganizationMembershipCommand`

Interface che lookup/prefetch/revalidate/add/remove/reload. Không được che hoặc tự thay permission, copy assignment hay quota semantics.

### Payment provider seam

Provider adapter chịu transport/signature/provider schema. Billing module chịu pinned order state, idempotency, reconciliation và activation policy. Không để timestamp/provider quirk lan ra nhiều caller.

## 12. Những giải pháp bị cấm

- Thêm `setTimeout`, spinner hoặc skeleton chỉ để che blocking work mà không loại bỏ nguyên nhân.
- Dùng full-screen loader cho mọi chuyển tab/workspace đã đăng nhập.
- Precache/preload toàn app hoặc bật global `modulePreload` để chữa lazy-chunk 404.
- Chỉ bỏ `dynamicImports` mà không có deploy N/N-1 và safe reload guard.
- Chỉ bỏ `await afterPersist` mà làm mất draft, error, audit, server rejection hoặc conflict recovery.
- Full refetch/full-table render sau local save khi dirty projection đủ để phản hồi.
- Render pane ẩn chỉ vì element tồn tại trong DOM.
- Dùng cache key thiếu identity/workspace/persona/table/query/pagination/scope revision/generation hoặc tái sử dụng totals/cursor giữa hai query khác nhau.
- Chỉ chặn stale response commit nhưng vẫn để mọi superseded request dùng network/CPU khi có thể abort/coalesce.
- Chạy N assignment mutation song song hoặc tuần tự thay cho một atomic batch.
- Tăng thread pool, offload toàn bộ 45 candidate hoặc tạo 30 index theo static audit mà không đo.
- Tự suy timezone cho timestamp payOS không timezone.
- Kích hoạt payment từ redirect/client state.
- Log credential, checksum key, session/token, PII hoặc record payload vào telemetry.
- Tự thay đổi role, permission, scope, masking, entitlement hoặc field visibility.
- Sửa expected test để khớp một thay đổi nghiệp vụ chưa duyệt.
- Gọi module/artifact là code rác rồi xóa khi chưa có reachability/coverage/owner/retention evidence.
- Hạ performance/security/debt threshold để làm gate xanh.

## 13. Các quyết định bắt buộc hỏi chủ sản phẩm

Ghi `BLOCKED_DECISION` và dừng đúng nhánh nếu cần một trong các quyết định sau:

1. Timezone mặc định cho `transactionDateTime` payOS không kèm timezone. Trong lúc chờ, luôn durable review và không activation.
2. Purchase/renew/upgrade/downgrade khi subscription đang active.
3. Mapping `legacy_package_id` cho base-plan publish/activation.
4. Fake checkout dev/test dùng session-owner + CSRF hay capability nonce một lần; đây là authorization contract cần ADR.
5. Cam kết offline first-use cho feature chưa từng mở sau khi thu nhỏ SW precache.
6. Thời gian giữ asset N-1/N-2 và grace window theo tuổi tab/session.
7. Retention/backup của logs, Word QA temp, release/private symbols và artifact có owner.
8. Composite membership lookup+add command nếu muốn thay prefetch + revalidate; cần exact request, audit và idempotency contract.
9. Bật live payment và requeue event/command `dead` thật.

Mỗi decision packet phải có:

- hiện trạng/evidence;
- 2–3 lựa chọn thực tế;
- compatibility/security/UX impact;
- migration/rollback;
- phương án mặc định tạm thời không làm sai dữ liệu.

Các decision trên không được chặn WP độc lập khác.

## 14. Kiểm thử bắt buộc

### Targeted regression theo work package

- Service worker: install/static graph/runtime lazy cache/partial install/reload-once/N/N-1.
- Mutation: delayed `afterCanonicalSync`, outbox durability, conflict, rejection, offline, rapid workspace switch và plan-version draft.
- Role/workspace: 403/409/invalid payload/network failure, rapid persona/workspace switch, stale response and cache namespace.
- Scheduler/pull: fake clock, priority, delay, dedupe, cancellation, concurrency, abort và generation guard.
- Merge/render: 10k + 10k, active-pane-only, hidden dirty pane, observers, focus/ARIA.
- Membership/assignment: candidate revalidation, reload dedupe, 409/quota/session, atomic rollback và unchanged assignment identity.
- Procurement: plan/package/opening, upstream/circuit/cancel/cache/quota and partition/materialization distinction.
- Payment: official-shaped timestamp, signature, amount/order/link binding, duplicate/conflict, missed webhook, collision, expiry, outcome-unknown, stale worker, usage lease crash và exactly-once activation.
- DB/metrics: lane saturation/backpressure, concurrent scrape single-flight, last-known-good/freshness and query plan regression.
- Tables/timeline: focus, keyboard, validation, off-screen draft, print/export and Flatpickr lifecycle.

### Scope/security regression

Bắt buộc giữ xanh:

- tenant/module/assignment/record authorization;
- active role/session checks;
- CSRF Origin/Referer/token;
- CSP và Trusted Types;
- full-record visibility cho principal vốn có quyền;
- zero cross-user/org/workspace/persona cache or paint;
- webhook verification/idempotency/audit.

### Lệnh quality gate

Xác minh script hiện hữu trong `package.json`, sau đó chạy tối thiểu phù hợp với diff:

```powershell
npm run lint:security
npm run lint:modules
npm run audit:dead-code
npm run lint:debt
npm run audit:dependencies
npm run build:secure
npm run test:performance
npm run test:first-tab-performance
```

Sau các targeted tests, chạy bộ rộng một lần:

```powershell
npm run check:ci
```

`check:ci` đã bao gồm `npm test`; không chạy `npm test` lặp lại chỉ để tăng số pass. Chỉ chạy `npm test` riêng nếu cần artifact coverage riêng hoặc `check:ci` dừng trước test do một baseline static gate đã được tái hiện; khi đó báo rõ hai run không phải coverage bổ sung độc lập.

Chạy E2E liên quan khi môi trường cho phép, ít nhất các flow auth role, CRUD, multi-assignee, offline sync, full lifecycle và smoke deploy. Nếu một E2E cần server/credential/external state chưa có, ghi `BLOCKED_EXTERNAL` với lệnh chính xác, không tự khai pass.

Quy tắc báo cáo test:

- Ghi command, exit code, số pass/fail/skip và thời gian.
- Không cộng các run chồng lấp thành một tổng giả.
- Baseline fail phải được tái hiện và phân biệt với regression do patch.
- Không sửa test expectation để che bug hoặc thay contract.

## 15. Rollout và rollback

- Mỗi WP là một increment có thể review và rollback độc lập.
- Feature flag chỉ điều khiển rollout implementation, không bypass authorization/security hoặc thay business semantics.
- SW/deploy phải giữ asset N/N-1 trong grace window; rollback HTML, manifest và SW đồng bộ.
- Mutation/lifecycle rollout theo workflow/workspace cohort nếu cần; không migrate bằng cách xóa cache/draft/outbox.
- Backend batch contract deploy server trước client và hỗ trợ client cũ trong grace window.
- Payment live luôn OFF cho tới khi WP-01/WP-11 đạt gate cho đúng SKU/flow định bật; mọi `legacy_package_id`, transition hoặc authorization decision mà flow đó phụ thuộc đã có ADR + implementation + test; official provider credential/webhook/environment preflight xanh; periodic reconciliation/alert/runbook hoạt động; provider-shaped E2E và owner launch approval đều có evidence. Không dùng flow đơn giản đã pass để bật một flow còn mapping/semantics bị chặn.
- Khi dừng checkout mới, vẫn tiếp tục nhận webhook/reconcile những order đã tạo.
- Migration payment/schema phải additive, có backfill/dry-run/dual-read nếu cần và không destructive rollback.
- RUM/canary so sánh release trước/sau theo P75/P95; rollback khi correctness, scope safety hoặc latency gate regress.

## 16. Deliverable bắt buộc

Trong quá trình triển khai, tạo/cập nhật:

1. `docs/testing/2026-08-27-performance-ux-security-remediation.md`
2. Artifact benchmark trước/sau trong `data/logs/` với release/build ID và môi trường.
3. Regression tests ở đúng seam.
4. Migration/runbook/ADR chỉ khi thực sự cần và đã đủ quyết định nghiệp vụ.

Implementation report phải có bảng:

| WP/Finding | Trạng thái | Root cause | Files changed | Tests | Before | After | Compatibility | Rollback | Blocker |
|---|---|---|---|---|---:|---:|---|---|---|

Trạng thái chỉ dùng:

- `DONE`
- `PARTIAL` — còn việc cụ thể có evidence;
- `BLOCKED_DECISION` — cần quyết định owner;
- `BLOCKED_EXTERNAL` — thiếu external environment/credential/deploy authority;
- `FAILED` — gate đỏ do patch hoặc chưa khắc phục được.

Không dùng “hoàn thành” cho code chưa đo hoặc test chưa chạy.

## 17. Definition of Done

Chỉ coi nhiệm vụ hoàn tất khi:

- [ ] Đã đọc đủ nguồn bắt buộc và xác minh lại audit trên working tree hiện tại.
- [ ] Dirty worktree của người dùng được bảo toàn.
- [ ] Có baseline và artifact trước/sau so sánh được.
- [ ] PAY-00 không còn crash/dead-loop với timestamp provider-shaped; live payment vẫn OFF nếu chưa qua gate/duyệt.
- [ ] SW không eager-precache feature graph và deploy lifecycle không tái tạo lazy-chunk 404.
- [ ] Save local durable không chờ pagination/full renderer ở cả sáu workflow.
- [ ] Non-2xx role switch không đổi local persona/route/cache.
- [ ] Scheduler thực thi priority/delay/dedupe/cancel/concurrency đúng.
- [ ] Pane ẩn không render nền; exact pull coalesce/abort; merge đạt budget.
- [ ] Login/workspace/tab/member/assignment đạt SLO lab bắt buộc. Nếu còn lỗi nội bộ, trạng thái là `PARTIAL`/`FAILED` và nhiệm vụ chưa đạt DoD; chỉ RUM/deploy/provider evidence thật sự ngoài thẩm quyền mới được ghi `BLOCKED_EXTERNAL`.
- [ ] Procurement có progress/cancel/circuit behavior mà không đổi quota/phân gói.
- [ ] DB hot paths được xử lý theo measurement; không blanket offload/index.
- [ ] Payment recovery/readiness không mất hoặc cấp trùng order/credit/entitlement.
- [ ] Bảng lớn/timeline giữ focus, accessibility, draft và export.
- [ ] Không đổi visibility, masking, role, permission, scope, entitlement hoặc 27 legal items.
- [ ] Module/dead-code/security/dependency/build gates xanh; debt không tăng và được trả theo WP-12.
- [ ] Targeted, broad và E2E phù hợp đã chạy hoặc external blockers được ghi trung thực.
- [ ] Implementation report có mapping finding → diff → test → benchmark → rollback.
- [ ] Đã tự review diff; không còn placeholder, code chết mới, duplicate orchestration hoặc unhandled rejection.

## 18. Nội dung bàn giao cuối

Trả kết quả trước, không kể nhật ký dài. Báo cáo cuối phải gồm:

1. Work package đã hoàn thành và outcome người dùng nhìn thấy.
2. Root cause đã sửa, không chỉ tên file.
3. Bảng performance trước/sau.
4. Security/correctness controls được giữ.
5. Test/build command và kết quả.
6. File quan trọng đã đổi, dưới dạng link tuyệt đối.
7. `BLOCKED_DECISION` và `BLOCKED_EXTERNAL` còn lại, mỗi mục có hành động người dùng cần làm.
8. Rollout/rollback và trạng thái live payment.

## Kết thúc prompt

Hãy bắt đầu bằng việc đọc nguồn bắt buộc, kiểm tra dirty worktree và tái hiện baseline. Sau đó triển khai theo dependency graph, đóng từng gate trước khi tích hợp package tiếp theo. Không dừng ở phân tích; sửa code, test và đo mọi phần đã đủ thẩm quyền. Không đánh đổi correctness hoặc scope isolation để giảm vài trăm mili-giây, nhưng cũng không dùng security/correctness làm lý do giữ loader hoặc bắt người dùng chờ công việc có thể chạy nền.
