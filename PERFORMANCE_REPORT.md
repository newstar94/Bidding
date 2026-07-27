# Báo cáo hiệu năng BiddingFlow

## Cập nhật 2026-07-27: truy vấn N+1 và tương tác bảng lớn

- Test đếm SQL đã xác nhận bốn đường đọc N+1: tự gán bản ghi mới, kiểm tra phân công bị gỡ, kiểm tra gói liên kết hợp đồng và tải row-version khi validation đồng bộ. Các đường này đã được đổi sang tải theo bảng/loại và chia lô 500 ID.
- Với fixture nhỏ trong regression test, số truy vấn đọc tương ứng giảm `122 → 3`, `80 → 2`, `40 → 1` và `40 → 1`. Đây là query-count test, không phải latency production.
- Ở bảng 500 nhà thầu, lần đo sau dirty-row cache từng giảm input→ranking `446 ms → 363 ms`; full-suite gần nhất là 543 ms nhưng vẫn có `0` interaction long task. Đường danh sách→bảng đánh giá dao động 4.220–5.530 ms và longest task 805–999 ms giữa các lượt local; DOM/render khởi tạo vẫn là giới hạn, không dùng single-run này làm p95.

- Snapshot: `1fb76ad`
- Ngày đo: 2026-07-26
- Trạng thái: **baseline kèm implementation, browser scale và 5 lượt source/production package; staging/Linux benchmark chưa hoàn tất**
- Máy đo frontend: Windows 11 Pro, Python 3.14.5, Node 24.18.0, npm 11.16.0
- PostgreSQL cục bộ: 17.10

## 1. Nguyên tắc đọc số liệu

1. Đây là số liệu cục bộ, không phải production SLO.
2. Kết quả database ban đầu dùng dataset seed nhỏ, khoảng 16,56 MB; không đủ để kết luận index hoặc scalability.
3. Sau khi test suite cleanup, `PERFORMANCE_DATABASE_URL` trỏ tới database khoảng 8,18 MB nhưng không còn application table; vì vậy lần chạy `--explain` sau đó lỗi `relation \"chu_dau_tu\" does not exist`. Kết quả plan ban đầu được giữ làm bằng chứng của lượt đo, nhưng phải tái tạo trên staging trước implementation.
4. Bảng baseline ban đầu bên dưới được giữ làm lịch sử. Kết quả implementation/đo lại mới nằm trong các mục chi tiết; không suy ra p95 hoặc production SLO từ single-run local.

## 2. Baseline bắt buộc

| Hạng mục | Trước tối ưu | Sau tối ưu | Thay đổi | Trạng thái / cách đo tiếp |
|---|---:|---:|---:|---|
| Frontend secure build time | 6,25 giây warm; lượt trước 8,84 giây | Chưa thực hiện | — | Đo 5 lần clean/warm, báo median và p95 |
| Tổng JS bundle | 1.745.238 byte raw; 379.856 byte gzip | Chưa thực hiện | — | 39 chunk, đo bằng artifact `dist` |
| Initial load | Chưa đo | Login → dashboard: source median/p95 734/939 ms; production ZIP 588/816 ms | 10 lượt mỗi runtime, local Chromium | Lặp trên staging với network profile |
| Time to render package | Chưa đo | Package → evaluation: source median/p95 911/1.241 ms; production ZIP 824/1.040 ms | 5 lượt mỗi runtime, local Chromium | Tách server/API/render bằng trace staging |
| Danh sách gói → bảng đánh giá | Chưa đo | 1.458/1.756/5.530 ms với 10/100/500 bid ở full-suite gần nhất | Local single-run | Tiếp tục đo p95 trên staging |
| Time to render contractor table | Chưa đo | 242–273 ms, luôn 10 row với tổng 100/1.000/5.000 contractor | Server-pagination E2E | Theo dõi bootstrap identity thay vì DOM table |
| Save/sync duration | Chưa đo end-to-end | Production package sync-write p95 median 76,32 ms; source 84,12 ms | 5 lượt local/cây runtime | Đo lại staging + `pg_stat_statements` |
| Load package API | Chưa đo end-to-end | Chưa thực hiện | — | p50/p95/p99 trên staging |
| Database query count | Chưa đo theo workflow | Query-count regression cho bốn N+1: `122→3`, `80→2`, `40→1`, `40→1` | Đã có test hẹp | Reset/tag `pg_stat_statements` theo scenario trên staging |
| Import Excel duration | Chưa đo | 6 file thật: 82,1–109,9 ms/file | Local Chromium, file 15–34 KiB | Bổ sung fixture 1.000/10.000 dòng nếu dữ liệu thực đạt quy mô này |
| Export Excel duration | Worker median 1.119–2.346 ms với 10–10.000 dòng | Worker median 497–1.702 ms | Giảm 27,4–56,5% | Deep module thuần; đo lại template thật trên staging |
| Export Word duration | Chưa đo | 500 dòng: direct median/p95 74,71/90,56 ms; worker cô lập 594,25/612,46 ms | 5 lượt, production render pipeline | Đo template thật có ảnh trên staging |
| Worker idle polling | 71.113 call, 71.112 call rỗng | Mô phỏng: giảm 46,9–47,2% với fixed-5s; external document giảm 89,4% | Chưa đo lại runtime | Snapshot runtime role, chi tiết mục 5 |
| Audit-chain verification | 425 full scans, 113 audit row hiện tại | Incremental: đọc checkpoint anchors + tail giữa các full scan | Chưa đo lại runtime | Chi tiết mục 6 |
| Import backend database/session | 313/311 ms median | 244/255 ms median | Giảm 22,1%/17,9% | 9 tiến trình mới/module; tách recorder khỏi Prometheus renderer |

## 3. Frontend bundle

Secure build tạo 39 JS chunk:

| Chunk | Raw | Gzip |
|---|---:|---:|
| `BiddingWorkflows` | 395.960 B (386,68 KiB) | 78.765 B (76,92 KiB) |
| `GoiThauDetail` | 286.146 B (279,44 KiB) | 44.349 B (43,31 KiB) |
| `workspaceBootstrap` | 196.119 B (191,52 KiB) | 49.434 B (48,28 KiB) |
| `PartnerView` | 118.320 B (115,55 KiB) | 16.997 B (16,60 KiB) |
| `BiddingView` | 110.573 B (107,98 KiB) | 25.981 B (25,37 KiB) |
| `app` | 68.967 B | 23.801 B |
| `wordVariableManifest` | 62.384 B | 8.104 B |
| `PartnerWorkflows` | 61.600 B | 14.062 B |
| `ExcelIntegration` | 55.754 B | 12.513 B |

### Nhận định

- Vite đã code-split theo route/module; không có bằng chứng bundle monolith.
- Baseline: `BiddingController.ensureWorkflowModules()` từng tải đồng thời bidding và partner workflows; route `mothau`/`danhgiahsdt`/`goithau-detail` vì vậy kéo cả hai dù không dùng partner workflow ngay. Hành vi này đã được thay bằng route-specific loader, xem kết quả bên dưới.
- Kích thước chunk không tự chứng minh bottleneck. Chỉ tách command group sau khi browser trace cho thấy download/parse/compile ảnh hưởng route navigation.
- Manifest Word raw lớn nhưng gzip nhỏ; split thêm có thể làm tăng request/complexity mà lợi ích không đáng kể.

### Kết quả sau deepening Package Detail (2026-07-26)

- `GoiThauDetail.js` giảm 829 → 194 dòng; các module panel mới vẫn nằm trong cùng lazy chunk nên đây là cải thiện locality/testability, không phải tuyên bố giảm network bằng code splitting.
- Secure build hiện tại tạo chunk `GoiThauDetail` khoảng 265,55 kB raw, so với baseline 286.146 byte raw. Resource/navigation trace hiện đã có; production ZIP không chậm hơn source trong 5 lượt package → evaluation, nhưng phép đo chưa cô lập riêng tác động download/parse của chunk nên không quy toàn bộ chênh lệch cho code splitting.
- Save biên bản mở tài chính theo đợt phần lô trước đây gọi `persistAndSync` hai lần liên tiếp (bid/package rồi package metadata). Metadata giờ được stage trước và đi cùng lần sync `thongtinmothau` + `goithau`, giảm một round-trip/sync cycle trên luồng này.

### Kết quả tách workflow theo route (2026-07-26)

- Thêm `WorkflowModuleLoader` sở hữu ma trận route/method, trạng thái readiness, dùng chung promise khi import đồng thời và xóa failed promise để lần sau có thể retry.
- `mothau`, `danhgiahsdt`, `goithau-detail` và tạo kế hoạch/gói thầu chỉ import `BiddingWorkflows`; tạo chủ đầu tư/nhà thầu/chuyên gia/hợp đồng chỉ import `PartnerWorkflows`. `ensureWorkflowModules()` vẫn là interface tương thích tải cả hai.
- Secure artifact sau thay đổi: `BiddingWorkflows` 376.519 B raw/80.738 B gzip; `PartnerWorkflows` 61.590 B raw/14.071 B gzip; `workspaceBootstrap` 209.386 B raw/52.189 B gzip. So với build ngay trước thay đổi, bootstrap tăng khoảng 3,2 kB raw/0,9 kB gzip để chứa loader và ma trận.
- Trên route bidding, execution path không còn yêu cầu lazy chunk partner 61.590 B raw/14.071 B gzip; trên thao tác tạo partner, không còn yêu cầu lazy chunk bidding 376.519 B raw/80.738 B gzip. Đây là chênh lệch artifact/request graph, chưa phải số transferred hoặc latency đo bằng trình duyệt vì shared chunk, cache và scheduling còn ảnh hưởng kết quả thực tế.
- Manifest secure build vẫn khai báo hai dynamic import độc lập từ bootstrap; test interface khóa ma trận route/method, tải đúng một group, promise reuse, retry sau lỗi và compatibility loader.

### Đề xuất đo

1. Thêm Playwright E2E và `performance.mark/measure` cho bootstrap, first route, package detail và evaluation tab.
2. Chạy profile với cache lạnh/ấm, CPU throttle 4x và Fast 4G.
3. Ghi total transferred, JS parse/evaluate, LCP/INP và long task.
4. So sánh loader đã tách với baseline bằng cùng Playwright trace; chưa kết luận navigation nhanh hơn trước khi có số transferred/parse/evaluate và route timing.

## 4. Bottleneck frontend đã có bằng chứng tĩnh

### 4.1. Ranking đánh giá rescan theo mỗi lần gõ

**Trạng thái triển khai 2026-07-26: Đã loại lookup O(n²); event/layout optimization còn tiếp tục.**

**Evidence**

- Trước refactor, `BidEvaluationWorkflow.js:794-938` lấy toàn bộ DOM row, với mỗi row lại `find` trên `model.state.thongtinmothau` hai lượt.
- `createBidEvaluationRankingController` hiện tạo `Map<bidId,bid>` một lần cho render cycle và dùng lại cho mọi lần update; đường lưu báo cáo dùng cùng kiểu index thay vì hai lượt `find`.
- Event `input`/`change` được gom theo animation frame. Sau lần full update đầu, luồng không tuần tự chỉ đọc row bẩn và chỉ ghi ranking/score đã đổi; Quy trình 2 vẫn full-scan để giữ đúng ngữ nghĩa dừng tại nhà thầu đạt đầu tiên.

Chi phí lookup đã chuyển từ O(n²) xuống O(n) cho mỗi update. DOM query và calculate ranking toàn bảng vẫn còn là chi phí tuyến tính cần đo bằng browser trace.

**Đề xuất**

- Tạo `Map<bidId,bid>` một lần cho render/update cycle.
- Event delegation tại tbody thay listener cho từng input.
- Batch update qua `requestAnimationFrame`; debounce chỉ với input text, không trì hoãn action quyết định.
- Chỉ cập nhật row/rank bị ảnh hưởng nếu rule cho phép.

**Lợi ích dự kiến**

Microbenchmark cô lập lookup trên máy phát triển, gồm cả chi phí dựng `Map`, cho kết quả 100/500/1.000/5.000 row nhanh hơn tương ứng 3,00×/10,85×/21,09×/45,16×. Đây không phải benchmark toàn màn hình; DOM/layout vẫn cần Playwright trace trước khi batch bằng `requestAnimationFrame`.

**Rủi ro**

Debounce có thể làm save đọc state cũ; cần flush trước save/tab switch.

### 4.2. Mutation queue deep clone và deep equality

**Evidence**

- `frontend/app/BiddingModel.js:350-359` dùng `JSON.stringify` so từng record với persisted data.
- `:380-387` deep-clone toàn `_mutationBatch` qua parse/stringify mỗi lần đọc queue.
- `:604-620` lại stringify record để acknowledge snapshot.

**Đề xuất**

- Persistent outbox theo command/record, structural sharing và revision/hash per record.
- Không deep-clone toàn queue cho mỗi notification.
- Correctness PR phải đi trước performance PR; không tối ưu cơ học khi semantics discard còn sai.

**Lợi ích dự kiến**

Giảm CPU/GC theo kích thước queue và tránh clone base64/large JSON.

**Rủi ro**

Hash/canonicalization sai có thể bỏ mutation; bắt buộc property tests và reload tests.

### 4.2.1. Kết quả sau khi deepening mutation outbox

Đã tách `WorkspaceMutationOutbox` sở hữu queue và generation của từng bản ghi. `BiddingModel` không còn clone toàn queue cho mỗi lần enqueue hoặc dùng `JSON.stringify` để so record khi acknowledge; snapshot gửi server dùng receipt generation. Benchmark tổng hợp chạy bằng `node --expose-gc scripts/benchmark_mutation_outbox.mjs`, lấy trung vị 7 mẫu sau 2 lượt warm-up, payload 256 byte/bản ghi:

| Số bản ghi enqueue tuần tự | Cơ chế cũ | Deep module | Nhanh hơn |
|---:|---:|---:|---:|
| 100 | 10,22 ms | 3,45 ms | 2,96× |
| 500 | 250,04 ms | 75,68 ms | 3,30× |
| 1.000 | 1.009,87 ms | 301,39 ms | 3,35× |

Đây là microbenchmark thuật toán trên máy phát triển Windows, không phải SLO trình duyệt. Chi phí vẫn tăng theo kích thước queue vì mỗi mutation phải tạo durable envelope tương thích trong giai đoạn dual-write; bước tối ưu tiếp theo chỉ nên chuyển sang persistence theo record sau khi đã có migration/drain strategy cho dữ liệu outbox cũ.

### 4.3. Excel parsing có thể khóa UI

**Evidence**

Workbook được đọc/mapped ở frontend; chưa có long-task measurement. Đây là nghi ngờ, chưa phải bottleneck đã chứng minh.

**Đề xuất**

- Trước hết đo 6 workbook thật ở 100/1.000/10.000 dòng.
- Chỉ chuyển SheetJS parse/mapping sang Web Worker nếu long task vượt budget, ví dụ >50 ms liên tục hoặc INP suy giảm.
- Worker trả `ImportDecision` serializable; validation target vẫn kiểm tra trên main thread trước mutation.

**Lợi ích dự kiến**

Chưa định lượng.

**Rủi ro**

Copy workbook/rows qua structured clone có thể tốn hơn xử lý trực tiếp với file nhỏ.

## 5. Worker polling

**Trạng thái triển khai 2026-07-26: Đã thêm backoff và benchmark mô phỏng; chưa đo lại production query/pickup metrics.**

Snapshot `pg_stat_statements` lúc 2026-07-26 11:33:55 +07, lọc current `DATABASE_URL` và runtime role:

| Claim query | Calls | Rows | Empty calls | Tổng DB execution |
|---|---:|---:|---:|---:|
| Partner lookup | 23.698 | 1 | 23.697 | 1.412,0521 ms |
| Document | 23.708 | 0 | 23.708 | 1.259,5666 ms |
| Email | 23.707 | 0 | 23.707 | 1.094,2201 ms |
| **Tổng** | **71.113** | **1** | **71.112** | **3.765,8388 ms** |

Code tương ứng:

- Partner claim `backend/partners/partner_lookup_service.py:676`, fixed 5-second wait `:963`.
- Document claim `backend/documents/document_worker.py:647`, default 5-second idle poll `:924-930`.
- Email claim `backend/auth/email_delivery_service.py:191`, default 5-second poll `:463`.

### Nhận định

- Query churn cao nhưng DB execution cost đo được chỉ khoảng 3,77 giây cộng dồn; hiện chưa phải latency bottleneck.
- Chi phí connection acquisition, network round-trip, log/metrics và wake-up không nằm trọn trong execution time.
- Tối ưu đáng làm khi số instance tăng, vì poll tăng tuyến tính theo worker instance.

### Đề xuất

1. Thêm exponential idle backoff + jitter, reset về nhanh khi có job.
2. Cân nhắc PostgreSQL `LISTEN/NOTIFY` như wake-up hint, nhưng vẫn có low-frequency poll để recovery; đây là hai adapter thật (notification + fallback poll) tại worker wake-up seam.
3. Đo queue pickup latency p95 trước/sau; không đổi nếu backoff làm job chậm quá SLO.

### Kết quả implementation

- Tạo deep module `IdlePollBackoff` dùng chung cho document queue embedded/external, email outbox và partner enrichment; interface chỉ gồm `next_delay()` và `reset()`.
- Delay tăng theo cấp số nhân đến max poll, dùng subtractive jitter để các instance không poll đồng nhịp nhưng không bao giờ vượt hard maximum. Khi xử lý được ít nhất một job, delay reset ngay về initial poll.
- External document thread tiếp tục dùng `stop_event.wait(delay)`, nên SIGTERM/SIGINT không bị chặn bởi sleep. Partner worker giữ process-local event wake-up; lỗi claim DB thoát khỏi drain cycle để backoff thay vì retry nóng, còn lỗi xử lý một job không chặn các job kế tiếp.
- Cấu hình mặc định mới: max poll 10 giây cho document/email/partner, common jitter 0,1; operator có thể hạ max để đổi query rate lấy pickup latency.
- Benchmark mô phỏng tái lập: `python scripts/benchmark_idle_backoff.py`, 3.600 giây, seed `20260726`:

| Worker scenario | Fixed attempts | Backoff attempts | Giảm | Pickup p95 | Max |
|---|---:|---:|---:|---:|---:|
| Document external (1s → max 10s) | 3.600 | 382 | 89,4% | 9,937s | 9,998s |
| Document embedded (5s → max 10s) | 720 | 380 | 47,2% | 9,939s | 9,998s |
| Email (5s → max 10s) | 720 | 380 | 47,2% | 9,939s | 9,998s |
| Partner fallback (5s cũ; 1s → max 10s mới) | 720 | 382 | 46,9% | 9,937s | 9,998s |

- Đây là mô phỏng claim schedule khi queue rỗng, không phải số đo PostgreSQL production. Cần đo lại `pg_stat_statements`, queue age và pickup latency sau deploy trước khi xác nhận lợi ích vận hành thực tế.

## 6. Audit-chain verification

**Trạng thái triển khai 2026-07-26: Đã thêm incremental verification an toàn; chưa benchmark 10k/100k/1M hoặc đo lại production.**

`inspect_audit_chain` hiện:

- `count(*)` toàn log tại `backend/shared/audit_chain.py:179`;
- đọc toàn bộ row có order tại `:180`;
- kiểm tra sequence và hash từng row tại `:194`;
- đọc toàn materialized head tại `:265`.

Monitor mặc định chạy mỗi 300 giây tại `backend/shared/audit_monitor.py:202-268`.

Snapshot cùng runtime:

| Query | Calls | Rows | Tổng DB time | Mean |
|---|---:|---:|---:|---:|
| Ordered full audit scan | 425 | 37.792 | 167,9535 ms | 0,395185 ms |
| `count(*)` | 425 | — | 36,9115 ms | — |
| Head-table scan | 425 | — | 7,3736 ms | — |

`audit_log` hiện có 113 row nên chi phí còn nhỏ. Tuy nhiên thuật toán tuyến tính theo toàn bộ lịch sử và Python hash time không có trong `pg_stat_statements`.

### Đề xuất

- Lưu verified checkpoint gồm chain ID, sequence, hash và timestamp.
- Mỗi vòng xác minh phần mới kể từ checkpoint; full scan theo lịch thưa hoặc khi checkpoint/head mismatch.
- Không bỏ full verification trước readiness nếu compliance yêu cầu; có thể giới hạn startup bằng checkpoint đã ký và background full scan.
- Benchmark 10k/100k/1M row trước khi đổi.

### Kết quả implementation

- `inspect_audit_chain_incremental(...)` xác minh integrity/HMAC và installation identity của checkpoint, đối chiếu chính xác từng `(id, chain_id, sequence, entry_hash)` anchor, rồi chỉ đọc `audit_log WHERE id > max_anchor_id` để hash tail mới.
- Kết quả cuối vẫn phải khớp toàn bộ `audit_chain_heads`; new chain, sequence gap, previous-hash mismatch, entry-hash mismatch và materialized-head mismatch đều fail closed.
- Nếu incremental báo bất nhất, monitor chạy lại `inspect_audit_chain_against_checkpoint(...)`. Full fallback không bỏ checkpoint nên rollback/truncation anchor vẫn bị từ chối, không bị “chữa” thành hợp lệ bởi một chain hiện tại đã bị cắt.
- Startup readiness luôn dùng full checkpoint-protected verification. Checkpoint export định kỳ cũng full scan; full result được tái sử dụng để build checkpoint nên không còn quét lần hai trong cùng transaction.
- PostgreSQL integration chứng minh incremental và full scan trả cùng `row_count`, aggregate hash và heads sau khi append tail; query trace incremental không có `count(*)` hoặc ordered full-table scan. Test disable immutable trigger rồi xóa anchor xác nhận incremental trả `checkpoint_head_missing` và full-with-checkpoint cũng invalid.
- Query-shape scale theo `H + Δ` row (`H` checkpoint heads, `Δ` tail mới) thay vì `N` toàn bộ lịch sử giữa các full scan. Đây là bằng chứng row-scan shape, chưa phải latency/WAL/CPU benchmark 10k/100k/1M.

## 7. Detailed-evaluation persistence

**Trạng thái triển khai 2026-07-26: Đã tối ưu query shape; benchmark staging về thời gian/WAL/lock còn thiếu.**

`backend/sync/mapper.py:1173-1428` xử lý từng report/detail:

- SELECT opening và round/report.
- Với mỗi detail: SELECT criterion, SELECT existing detail, một UPSERT.
- Sau vòng lặp: dynamic `DELETE ... NOT IN (...)`.

Với R dòng, static lower bound xấp xỉ `3R + overhead` statement cho detail path, chưa tính validation completed report. Đây là query-count concern có bằng chứng code, nhưng thời gian production chưa đo.

### Đề xuất

1. Prefetch criteria của round thành map một query.
2. Prefetch existing detail IDs một query.
3. Dùng `executemany`/batch insert-upsert nếu psycopg adapter hỗ trợ và execution plan tốt.
4. Giữ tenant predicate trên mọi query.
5. Thay list `NOT IN` rất lớn bằng staging set/unnest chỉ khi benchmark chứng minh cần.

### Required benchmark

- 10/100/1.000 criterion, draft/completed, existing/new mix.
- Statement count, transaction duration, WAL bytes, lock time.
- Kết quả row-by-row và batch phải giống hệt.

### Kết quả implementation

- Mapper parse và dedupe criterion ID trước, prefetch criterion bằng một query `organization_id + id = ANY(...)`, đồng thời prefetch existing detail ID bằng một query `organization_id + report_id`.
- Mọi kiểm tra owner, vòng đánh giá, kết quả, score bound và required criterion chạy trên các map đã prefetch; upsert được gửi bằng một lần gọi `executemany`.
- Tenant predicate vẫn có trên cả hai prefetch và upsert vẫn dùng unique key `(organization_id, report_id, criterion_id)`.
- Characterization statement logic của riêng detail path (hai lookup/prefetch + R upsert + cleanup):

| Số criterion | Trước (`3R + 1`) | Sau (`R + 3`) | Giảm |
|---:|---:|---:|---:|
| 10 | 31 | 13 | 58,1% |
| 100 | 301 | 103 | 65,8% |
| 1.000 | 3.001 | 1.003 | 66,6% |

- Đây là statement-count characterization và batch-call evidence, chưa phải latency benchmark. Chưa có số transaction duration, WAL bytes hoặc lock time trên staging; không tuyên bố tốc độ production trước khi đo các chỉ số này.
- PostgreSQL integration xác nhận round-trip, tenant isolation, identity reuse và cascade; full Python suite đạt 1.007 test, 1 bỏ qua.

## 8. PostgreSQL query/index baseline

Lượt audit seed ban đầu:

- PostgreSQL 17.10, database khoảng 16,56 MB.
- `pg_stat_statements` ready.
- Không phát hiện FK thiếu leading index.
- Không deadlock trong snapshot ban đầu.
- Ba hot plan mẫu đều dùng index, không có sequential scan:
  - sync delta: khoảng 0,199 ms;
  - latest page: khoảng 0,017 ms;
  - trigram search: khoảng 0,046 ms.

Lần audit sau cleanup:

- Database `biddingflow_load_test` khoảng 8.181.427 byte, không còn application table nên không thể tái chạy hot plans.
- `pg_stat_database` có 9.427.418 byte temp lịch sử; số này gồm workload/audit trong DB và không đủ để quy cho query ứng dụng cụ thể.

### Quyết định index

**Không đề xuất index mới ở giai đoạn này.** Dataset quá nhỏ và hot plans đã dùng index. Với mỗi index tương lai phải ghi:

- query và parameter shape;
- thứ tự column, bắt đầu bằng tenant/scope phù hợp;
- before/after plan;
- write/WAL/storage cost;
- trùng lặp với index hiện có;
- tenant isolation test.

## 9. Server/module complexity có ảnh hưởng hiệu năng

| Module | Evidence | Rủi ro hiệu năng | Hành động |
|---|---|---|---|
| `backend/sync/service.py` | `_process_sync_request_blocking` khoảng 974 dòng | Transaction dài, nhiều phase/side effect | Instrument phase timing trước khi tách |
| `backend/sync/dashboard_summary.py` | `build_dashboard_summary` khoảng 421 dòng | Nhiều query/aggregation trong một request | Dùng `pg_stat_statements` theo route, không cache nhạy cảm trước khi đo |
| `backend/sync/pagination.py` | `_paginate_records_blocking` khoảng 437 dòng | Search/sort/permission branching | Benchmark cursor/page/search theo table |
| `backend/documents/*` | Worker queue đã tách khỏi request | File/process cost | Giữ sandbox; đo queue wait, render, output size riêng |
| `frontend/packages/detail/AwardResultDetailsPanel.js` | render khoảng 1.244 dòng | DOM tạo lại lớn | Browser profile rồi incremental render nếu cần |

## 10. Benchmark cần bổ sung

### Browser E2E

Harness Playwright deterministic hiện đã khóa năm kịch bản:

1. Login Super Admin và đối chiếu doanh thu lần hiển thị đầu với sau khi chuyển tab.
2. Chuyển sang Quản lý, mở gói 1G1T fixture, vào Báo cáo đánh giá → Báo cáo chi tiết và xác nhận báo cáo mới có 0 dòng cùng hai cách cấu hình.
3. Dựng bảng đánh giá với 10, 100 và 500 nhà thầu; đếm đủ row, DOM node, long task và heap.
4. Mọi page error, console error, HTTP 4xx/5xx và request ứng dụng bị lỗi đều làm test thất bại.

#### Số đo cục bộ ngày 2026-07-26

| Điểm đo | Một mẫu gần nhất |
|---|---:|
| Login → dashboard Super Admin sẵn sàng, test doanh thu | 606 ms |
| Chuyển tab Super Admin rồi quay lại | 236 ms |
| Login → dashboard Super Admin sẵn sàng, test báo cáo | 602 ms |
| Mở danh sách gói → panel Báo cáo đánh giá | 797 ms |
| Mở panel Báo cáo chi tiết | 99 ms |
| Tổng 2 kịch bản Playwright | 5,0 giây |

- Đây là single-run local observation trên database dev; không phải p95, staging benchmark hoặc production SLO.
- Fixture báo cáo được chèn ở network boundary và không ghi database, nên thời gian 797/99 ms đo luồng UI/module/render nhưng không đại diện độ trễ tải dataset lớn.
- CI Ubuntu 24.04 đã được cấu hình cài Chromium, chạy E2E và giữ artifact khi lỗi; vẫn cần GitHub Actions run của commit hiện tại làm bằng chứng Linux thật.

#### Scale profile và batching row renderer

| Số nhà thầu | Trước: mở bảng | Trước: block dài nhất | Sau: mở bảng | Sau: block dài nhất | DOM node sau | Heap sau |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.662 ms | 0 ms | 1.107 ms | 0 ms | 3.179 | 17,1 MB |
| 100 | 1.392 ms | 220 ms | 1.503 ms | 233 ms | 8.759 | 21,7 MB |
| 500 | 3.374 ms | 1.300 ms | 3.817 ms | 693 ms | 33.796 | 53,5 MB |

- Renderer đồng bộ vẫn dùng cho tối đa 50 nhà thầu. Danh sách lớn chia batch 50 theo animation frame, tạo row trong `DocumentFragment`, và dùng revision để lượt đổi gói/tab mới hủy batch cũ.
- Với 500 nhà thầu, block dài nhất giảm 46,7%; thời gian mở bảng tăng 13,1%. Tổng long-task tăng 1.853 → 2.338 ms nhưng được chia từ 2 thành 10 khoảng block. Đây là trade-off responsiveness, không phải throughput speedup.
- 100 nhà thầu gần như không cải thiện và vẫn có block 233 ms; ranking/DOM scan cuối là bottleneck tiếp theo, cần batch/worker-friendly state trước khi đặt p95 gate.
- Secure bundle `BiddingWorkflows` tăng khoảng 1,82 kB raw/0,67 kB gzip so với artifact ngay trước batching.
- Việc còn lại: đo LCP/INP thực, network bytes, import/save/reload và tiếp tục giảm DOM scan/render khởi tạo.

#### Scale profile 500 tiêu chí báo cáo chi tiết

- Fixture gồm 500 tiêu chí custom tối thiểu, vẫn nằm trong giới hạn metadata 64 KiB của production; 500 row draft được gắn vào một hồ sơ dự thầu tại network boundary, không ghi database.
- Baseline một lượt: mở đủ 500 dòng trong 785 ms; 15.312 DOM node; một long task 263 ms; heap 39,6 MB.
- Sau tối ưu: bảng trên 100 dòng render 25 dòng đầu rồi nối batch 25 dòng theo animation frame; action lưu/hoàn thành/import/thêm dòng bị khóa trong lúc bảng đang hoàn tất; revision hủy lượt cũ và event delegation giữ các dòng chèn sau có thể chỉnh sửa/xóa.
- Ba lượt sau tối ưu: thời gian mở 960/985/1.490 ms (median 985 ms); longest task 60/67/67 ms (median 67 ms); full-suite gần nhất 1.450 ms và 68 ms. Long task median giảm khoảng 74,5%, đổi lại throughput hoàn tất bảng tăng khoảng 25,5% so với baseline đơn lượt.
- Đây là responsiveness trade-off cục bộ, chưa đạt budget đề xuất `<300 ms`; virtual scrolling chỉ nên làm nếu UX thực tế có bảng gần 500 tiêu chí và cần giảm cả DOM/throughput.

#### Bootstrap identity và bảng 100/1.000/5.000 nhà thầu

- Bảng nhà thầu dùng server pagination, nên tổng dataset không được phép làm số row DOM tăng. E2E xác nhận cả ba quy mô chỉ render 10 row và khoảng 2.425 DOM node.
- Bootstrap vẫn nhận identity/reference nhẹ của mọi version để phục vụ liên kết theo ngày. `mergeReferenceRecords` trước đây gọi `findIndex` cho từng identity, sau đó `applyServerSnapshot` lại gọi `find` từng identity để dựng batch IndexedDB. Với 1.000 identity, hai vòng tạo 499.500 và 500.500 predicate call.
- Sửa bằng một `Map<id,index>` dựng một lần và trả trực tiếp danh sách record đã merge cho persistence; giữ nguyên full local fields, package reference authoritative và `referenceOnly` semantics.
- Microbenchmark 5.000 identity, 7 lượt: riêng merge median `150,04 → 0,70 ms`, nhanh hơn khoảng 213×; p95 `161,20 → 1,82 ms`.

| Tổng identity | Payload fixture | Login → dashboard | Chuyển Manager | Mở tab nhà thầu | Row DOM | Long task dài nhất | Heap |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 43 KB | 874 ms | 1.172 ms | 273 ms | 10 | 0 ms | 17,1 MB |
| 1.000 | 437 KB | 822 ms | 1.719 ms | 242 ms | 10 | 0 ms | 19,3 MB |
| 5.000 | 2,21 MB | 1.205 ms | 1.955 ms | 267 ms | 10 | 84 ms | 31,2 MB |

- Intermediate E2E sau khi mới sửa vòng `findIndex` đầu tiên vẫn ghi 5.000 identity có longest task 373 ms, tổng long task 640 ms. Sau khi loại vòng `find` persistence, longest task còn 84 ms và tổng còn 157 ms (giảm lần lượt khoảng 77,5% và 75,5%).
- 5.000 identity vẫn có hai long task trên 50 ms do JSON/reference persistence tổng thể; nhưng block dài nhất dưới budget 100 ms và DOM không scale theo tổng record. Chưa cần virtualize bảng nhà thầu thêm.

### Backend/load

Trên staging database riêng:

`python scripts/seed_performance_data.py`  
`python scripts/postgres_performance_audit.py --top 20 --explain --require-pg-stat-statements`  
`python scripts/run_load_rehearsal.py`

Không chạy seed trên production. Tag scenario/application name để tách statement stats.

#### Rehearsal cục bộ nhiều worker ngày 2026-07-26

- Runner đăng nhập một lần rồi chia sẻ cùng session như các tab trình duyệt; không còn tự thu hồi phiên giữa các workload worker.
- Warmup đi qua `/api/sync-version` có session và database thay vì chỉ `/health/live`, nên cửa sổ đo không bắt đầu khi một worker/pool còn lạnh.
- Trước khi xóa schema, runner xác minh database đích có tên disposable, khác database runtime theo identity thực và cổng rehearsal chưa bị process khác chiếm.
- Teardown Windows không còn phát `CTRL_BREAK_EVENT` qua console; chỉ `taskkill /PID <supervisor> /T /F` trên cây process đã tạo. PostgreSQL PID `24460` và app dev PID `4352` giữ nguyên sau rehearsal; `live=200`, `ready=200`, cổng `18083` đã đóng.
- Cấu hình đo: 2 web worker, concurrency 8, 5 giây, database riêng `biddingflow_load_test`.
- Kết quả: 2.712/2.712 request trả `200`, `errors={}`, 527,05 request/giây; latency tổng p50 11,55 ms, p95 30,98 ms, p99 47,54 ms; sync write p95 59,73 ms.
- Quan sát đủ 2/2 worker; tối đa 16 kết nối, 6 kết nối active, 2 kết nối chờ lock tại thời điểm sample, 0 lock chưa được cấp, 0 deadlock, 0 temp file.
- Đây là rehearsal cục bộ ngắn để khóa correctness/session/process ownership, chưa thay thế benchmark staging dài hoặc remeasurement production.

#### So sánh source và production package ngày 2026-07-27

Runner hỗ trợ `--application-root` và đã chạy Uvicorn từ cây giải nén của chính `release/biddingflow-production.zip`, không import backend từ worktree. Mỗi phía chạy 5 lượt liên tiếp với 2 worker, concurrency 8, 5 giây/lượt trên cùng database disposable và cùng máy.

| Chỉ số | Source median | Production package median | Chênh lệch production |
|---|---:|---:|---:|
| Request/giây | 424,20 | 412,28 | -2,81% |
| Latency tổng p95 | 42,38 ms | 39,96 ms | -5,71% |
| Sync-write p95 | 84,12 ms | 76,32 ms | -9,27% |
| Initial-data p95 | 39,81 ms | 39,87 ms | +0,15% |
| Sync-version p95 | 18,35 ms | 18,39 ms | +0,22% |

- Production xử lý 10.344/10.344 request `200`; source xử lý 10.498/10.498 request `200`; cả 10 lượt đều `errors={}` và quan sát đủ 2/2 worker.
- Production run-level p95: throughput 438,43 req/s, latency tổng 49,98 ms, sync-write 94,83 ms. Source tương ứng 426,11 req/s, 42,97 ms và 161,77 ms. Với chỉ 5 lượt, đây là độ biến thiên cục bộ, không phải confidence interval.
- Cả hai phía tối đa 16 connection, không deadlock và không temp file; tối đa 1 lock chưa được cấp tại một số sample rồi tự giải phóng.
- Một warmup production chạm timeout/retry khoảng 15,48 giây; median warmup p95 là 1,74 giây. Main timed window của lượt đó vẫn không lỗi. Cần đo trên staging để xác định đây là cold-start/Windows scheduling hay vấn đề runtime.
- Kết luận hẹp: cây production giải nén không tạo hồi quy server rõ ràng so với source trong workload này; throughput median lệch dưới 3%, còn ba latency median không xấu hơn. Chưa có bằng chứng Linux, WAL theo statement hoặc dữ liệu staging.
- Benchmark từng mất toàn bộ kết quả nếu một request `/metrics` timeout sau tải. `_collect_worker_metrics` nay thu thập best-effort từng response; test đỏ trước sửa và hai lượt production tiếp theo đều quan sát đủ worker.

#### WAL và pg_stat_statements trên production package cục bộ

PostgreSQL 17.10 đã preload `pg_stat_statements`; runner chỉ tạo extension trong `biddingflow_load_test`, reset thống kê theo đúng database OID và không reset số liệu database runtime. WAL được đo bằng chênh lệch LSN toàn cluster nên được ghi là upper bound; `wal_bytes` theo statement được lấy riêng từ database load-test.

Ba lượt production package, 2 worker, concurrency 8, 10 giây/lượt:

| Chỉ số | Lượt 1 | Lượt 2 | Lượt 3 | Median |
|---|---:|---:|---:|---:|
| Request | 2.953 | 4.085 | 3.929 | 3.929 |
| Request/giây | 293,90 | 407,55 | 391,80 | 391,80 |
| Latency tổng p95 | 63,78 ms | 41,84 ms | 46,42 ms | 46,42 ms |
| Sync-write p95 | 115,16 ms | 86,60 ms | 82,45 ms | 86,60 ms |
| WAL cluster upper bound | 789.832 B | 1.006.904 B | 1.641.264 B | 1.006.904 B |
| WAL ứng dụng theo statement | 768.471 B | 979.900 B | 1.025.949 B | 979.900 B |
| WAL ứng dụng/request | 260,23 B | 239,88 B | 261,12 B | 260,23 B |
| Statement call/request | 15,81 | 15,62 | 15,91 | 15,81 |
| Tổng statement execution/request | 1,005 ms | 0,897 ms | 0,904 ms | 0,904 ms |

- 10.967/10.967 request trả `200`, không workload error, deadlock hoặc temp block/file.
- Ở lượt median-throughput, ba nguồn WAL lớn nhất trong top execution set là cập nhật cờ version-family `is_latest` khoảng 382 KB, insert `chu_dau_tu` khoảng 325 KB và tăng `sync_metadata` khoảng 19 KB. Đây là workload cố ý tạo record mới, không phải WAL idle.
- Chênh lệch cluster WAL và tổng `wal_bytes` statement là upper-bound noise từ checkpoint/background/traffic database khác; lượt 3 chênh khoảng 615 KB nên không dùng cluster LSN để quy trách nhiệm cho riêng ứng dụng.
- Số đo chứng minh local workload không spill temp và cho biết write amplification hiện tại; vẫn cần `pg_stat_statements` staging theo scenario/tag và thời gian dài hơn trước khi đặt WAL budget.

### Import/export

Browser benchmark tùy chọn `tests/e2e/real_excel_import.spec.mjs` đã đọc trực tiếp sáu workbook MuaSắmCông thật qua `E2E_REAL_EXCEL_DIR`, đi qua Excel archive guard, SheetJS và parser production. Kết quả ngày 2026-07-27:

| Workbook | Sheet/dòng | Nhóm có dữ liệu | Sheet nghiệp vụ được chọn | Tổng thời gian |
|---|---:|---|---|---:|
| 1G1T không phân lô | 9/120 | Hợp lệ, năng lực, tài chính | 01, 02, 07B | 109,9 ms |
| 1G1T phân lô | 10/149 | Hợp lệ, năng lực, tài chính | 01, 02A, 07B | 102,9 ms |
| 1G2T phân lô | 7/94 | Hợp lệ, năng lực | 01, 02A | 88,2 ms |
| 1G2T tài chính | 8/99 | Tài chính | 06C | 83,3 ms |
| Kỹ thuật tư vấn | 3/98 | Hợp lệ, kỹ thuật | 01, 02 | 82,9 ms |
| Tài chính tư vấn | 4/51 | Tài chính | 02B | 82,1 ms |

- Mỗi nhóm nhận diện có số match bằng số tiêu chí và `warningCount=0`.
- Các sheet kỹ thuật 03A/03B chỉ có dòng mẫu `-` được bỏ qua, không sinh tiêu chí rỗng.
- Đây là single-run local Chromium trên file nhỏ 15–34 KiB; chưa đo peak memory/event-loop long task cho workbook 1.000+ dòng và chưa đo document worker queue/render/serialize.

## 11. Mục tiêu hiệu năng đề xuất

Đây là budget cần chốt, không phải kết quả đã đạt:

| Luồng | Budget ban đầu đề xuất |
|---|---:|
| Chuyển evaluation tab, 100 bid, desktop | p95 < 200 ms |
| Input → ranking visible, 100 bid | p95 < 100 ms |
| Render detail 500 criteria | p95 < 300 ms hoặc dùng virtualization |
| Import 1.000 row | không có main-thread long task > 100 ms |
| Sync 100 changed record trên staging | p95 < 1 giây, không mất outbox |
| Idle worker pickup | p95 < 10 giây |
| Document export | queue wait và render có SLO riêng theo loại/kích thước |

Budget phải được xác nhận với người dùng và dữ liệu thật trước khi trở thành release gate.

## 12. Trạng thái các đề xuất tối ưu

| Ưu tiên | Đề xuất | Trạng thái |
|---|---|---|
| P1 | Map bid + batch ranking | Đã triển khai Map, frame batching và dirty-row cache |
| P1 | Outbox không clone toàn queue khi tạo sync snapshot | Đã dùng generation receipt; clone vẫn giữ tại durable-storage/public snapshot boundary để tránh mutation race |
| P1 | Batch detailed-evaluation write | Đã prefetch và `executemany`; có query-count regression 10/100/1.000 dòng |
| P2 | Idle backoff + notify hint | Backoff đã triển khai; chưa có LISTEN/NOTIFY vì chưa chứng minh polling là latency bottleneck |
| P2 | Incremental audit verification | Đã triển khai checkpoint + tail verification |
| P3 | Đo route-specific workflow imports đã tách | Đã đo resource graph trên production ZIP cục bộ; còn thiếu parse/evaluate và staging |
| P3 | Web Worker Excel | Tạm chưa làm: 6 file thật chỉ mất 82–110 ms; cần fixture lớn chứng minh main-thread long task trước |

Browser E2E regression, bảng đánh giá 10/100/500 bid, bootstrap 100/1.000/5.000 nhà thầu, profile 500 tiêu chí, 6 file Excel thật, source/production package remeasurement, local WAL/`pg_stat_statements` và resource graph route-specific đã có. Phần còn thiếu là staging latency/WAL/lock/statement stats, GitHub Actions Linux và browser parse/evaluate trace; chưa có kết luận SLO production tổng thể.

### Resource graph theo tuyến trên production ZIP

Đo trên Chromium cục bộ từ ZIP production đã giải nén, sau khi sửa module identity và Trusted Types:

| Luồng | JS resource | Encoded/decoded body | Thời gian tài nguyên lớn nhất | Kiểm tra tách module |
|---|---:|---:|---:|---|
| Mở chi tiết gói thầu | 15 | 831.811 B | 36,9 ms | Có `BiddingWorkflows`, không có `PartnerWorkflows` |
| Mở form thêm nhà thầu | 3 | 114.193 B | 7,6 ms | Có `PartnerWorkflows`, không tải lại `BiddingWorkflows` |

`transferSize=0` ở các chunk đã được module preload/cache, vì vậy bảng dùng `encodedBodySize` để mô tả kích thước tài nguyên. Đây là single-run local resource timing, chưa phải số đo parse/evaluate hay staging latency.

### Navigation lặp trên source và production ZIP

Hai ca E2E được chạy lặp trong Chromium, cùng máy và cùng PostgreSQL cục bộ. Login được ghi từ cả hai ca nên có 10 mẫu/runtime; các thao tác còn lại có 5 mẫu/runtime.

| Chỉ số | Source median | Source p95 | Production median | Production p95 |
|---|---:|---:|---:|---:|
| Login → dashboard sẵn sàng | 734 ms | 939 ms | 588 ms | 816 ms |
| Vòng Super Admin → tài khoản → dashboard | 300 ms | 322 ms | 263 ms | 277 ms |
| Mở package → evaluation hiển thị | 911 ms | 1.241 ms | 824 ms | 1.040 ms |
| Mở báo cáo chi tiết rỗng | 106 ms | 114 ms | 98 ms | 109 ms |

20/20 ca đạt và production không chậm hơn source ở bốn chỉ số. Đây là local warm-runtime measurement, không thay thế Fast 4G/LAN profile hoặc staging p95/p99.

### Xuất Word báo cáo đánh giá chi tiết

Benchmark tái lập dùng đúng `seal_docx_context` → `generate_report_from_custom_template` và `run_document_job("render_docx")`. Template có vòng lặp hàng như biểu mẫu đánh giá chi tiết; mỗi kết quả được mở lại bằng `python-docx` để xác nhận đủ số dòng.

| Dòng | Seal context median/p95 | Render trực tiếp median/p95 | Worker cô lập median/p95 | 4 job song song: batch/p95 | Output |
|---:|---:|---:|---:|---:|---:|
| 10 | 0,05/0,13 ms | 19,63/105,01 ms | 524,35/659,26 ms | 1.182,09/1.180,29 ms | 35.768 B |
| 100 | 0,48/0,55 ms | 37,98/39,55 ms | 552,72/583,22 ms | 1.162,12/1.160,48 ms | 36.621 B |
| 500 | 1,66/2,17 ms | 74,71/90,56 ms | 594,25/612,46 ms | 1.243,37/1.241,82 ms | 39.960 B |

- 4/4 tác vụ song song hoàn tất với cấu hình mặc định 2 worker; không có reject/timeout.
- Render và seal tăng tuyến tính, chưa có bottleneck theo số dòng đến 500. Khoảng 0,5–0,6 giây chủ yếu là khởi tạo tiến trình sandbox cô lập và gần như không phụ thuộc số dòng.
- Không bỏ sandbox hoặc tăng concurrency chỉ để giảm số này: cô lập mạng/tài nguyên là ranh giới bảo mật. Cần template staging có ảnh/chữ ký trước khi đặt SLO.
- Chạy lại bằng `python scripts/benchmark_document_export.py --rows 10 100 500 --iterations 5 --mode both --parallel-jobs 4`.

### Xuất Excel qua document worker

Benchmark tái lập đo `create_phanlo_excel` trực tiếp và qua đúng tiến trình worker production. Baseline cho thấy worker thuần Excel vẫn import `excel_service`, kéo theo helper dùng database và toàn bộ tầng ứng dụng. Ba hàm xuất thuần đã được chuyển sang deep module `excel_workbook_builder`; facade cũ vẫn re-export để giữ tương thích, còn các tác vụ cần database vẫn đi qua `excel_service`.

| Dòng | Direct trước median/p95 | Worker trước median/p95 | Direct sau median/p95 | Worker sau median/p95 | Giảm worker median |
|---:|---:|---:|---:|---:|---:|
| 10 | 6,35/21,56 ms | 1.142,75/1.165,06 ms | 8,24/22,43 ms | 497,02/510,27 ms | 56,5% |
| 100 | 38,08/44,73 ms | 1.119,03/1.140,07 ms | 35,32/42,26 ms | 503,94/519,93 ms | 55,0% |
| 1.000 | 139,58/144,76 ms | 1.244,21/1.412,59 ms | 139,61/145,75 ms | 641,60/671,44 ms | 48,4% |
| 10.000 | 1.246,59/1.329,55 ms | 2.346,37/2.368,10 ms | 1.204,46/1.223,55 ms | 1.702,43/1.708,25 ms | 27,4% |

- Regression import-boundary khóa ba export thuần không được nạp `backend.documents.excel_service` hoặc `backend.shared.helpers` trong worker.
- Correctness được giữ bằng full backend `1.050 passed, 1 skipped`, frontend `244/244`, security static gate `160` file Python và nhóm Excel/document `58 passed, 1 skipped`.
- Chi phí worker còn lại khoảng 0,5 giây ở file nhỏ chủ yếu là khởi tạo tiến trình và import `openpyxl`; đây là ranh giới cô lập có chủ đích.
- Chạy lại bằng `python scripts/benchmark_excel_export.py --rows 10 100 1000 10000 --iterations 3 --mode both`.

### Import graph của database lane và session

Database/session/logging trước đây chỉ cần ghi một phép đo nhưng import trực tiếp `backend.observability.metrics`, kéo endpoint Prometheus, Starlette, crypto, filesystem metrics và các helper ứng dụng vào hot-path. Deep module `backend.observability.recording` nay sở hữu interface ghi/snapshot/reset thuần standard-library; renderer chỉ đọc snapshot và vẫn re-export tên cũ để giữ compatibility.

| Module, 9 fresh process | Median trước | P95 trước | Median sau | P95 sau | Giảm median |
|---|---:|---:|---:|---:|---:|
| `backend.shared.database_io` | 312,99 ms | 344,85 ms | 243,68 ms | 279,44 ms | 22,1% |
| `backend.auth.session_store` | 310,79 ms | 337,21 ms | 255,04 ms | 267,63 ms | 17,9% |
| `backend.shared.logging_utils` | 160,19 ms | 172,10 ms | 160,46 ms | 178,00 ms | Không đổi đáng kể |

- Logging trước đó đã dùng lazy import chỉ khi queue đầy nên không kỳ vọng cải thiện fresh import; việc chuyển sang recorder vẫn loại cạnh vòng tĩnh.
- Strongly connected component backend lớn nhất giảm từ 13 xuống 6 module; `metrics`, `database_io`, `db_helper`, session store/utils và recorder không còn nằm trong cùng một vòng.
- Recorder reset toàn bộ operation, duration, phase/max và log-drop counters; utility reset cũ bỏ sót phase counters đã được sửa và khóa bằng test interface.
- Correctness gate: backend `1.054 passed, 1 skipped`, JavaScript `244/244`, security static gate `161` file Python.
- Lát tiếp theo loại import `logging_utils → shared.helpers` và đóng kết nối audit độc lập. SCC 6 module biến mất hoàn toàn; backend chỉ còn một SCC riêng 3 module ở sync/partner.
- AST ghi nhận 36 điểm gọi `log_audit`: 22 gắn cursor giao dịch và 14 nhánh audit độc lập. Test PostgreSQL pool 1 slot chạy 5 audit liên tiếp với `pool_available=1`, `requests_waiting=0`; bản cũ giữ slot đầu tiên và không thể tái sử dụng.
- Import graph backend sau lát partner/WebSocket không còn SCC nào. Worker enrichment gọi thẳng interface do `sync.websocket` sở hữu thay vì đi vòng qua route facade `sync.api`; test Tarjan trên toàn bộ 161 file Python khóa trạng thái không cycle.

### Mở rộng recorder sang các hot-path tài liệu, đối tác, WebSocket và audit

Các producer còn lại trước đây vẫn import renderer Prometheus hoặc mega-facade dù chỉ cần ghi metric. Chúng đã chuyển sang deep module `backend.observability.recording`; `metrics.py` chỉ còn trách nhiệm render/HTTP và re-export interface cũ. Mỗi số dưới đây là median của 15 fresh process trên cùng máy; baseline dùng 7 fresh process trước thay đổi.

| Module | Median trước | Median sau | Thay đổi |
|---|---:|---:|---:|
| Partner lookup service | 419,44 ms | 318,10 ms | −24,2% |
| Address routes | 419,02 ms | 380,38 ms | −9,2% |
| WebSocket | 396,81 ms | 319,33 ms | −19,5% |
| Document worker | 202,30 ms | 122,74 ms | −39,3% |
| Audit monitor | 300,17 ms | 297,04 ms | Không đổi đáng kể |

- Không tuyên bố cải thiện cho audit monitor vì chênh lệch nằm trong nhiễu đo.
- Partner lookup và WebSocket lấy primitive database trực tiếp từ `db_helper`, không còn nạp `shared.helpers` trên hot-path.
- Full gate sau thay đổi: backend `1.061 passed, 1 skipped`, JavaScript `244/244`, security static gate `161` file Python; backend import graph vẫn 0 cycle.
