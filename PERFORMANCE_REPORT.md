# Báo cáo hiệu năng BiddingFlow

- Snapshot: `1fb76ad`
- Ngày đo: 2026-07-26
- Trạng thái: **baseline kèm kết quả implementation; browser E2E/staging benchmark chưa hoàn tất**
- Máy đo frontend: Windows 11 Pro, Python 3.14.5, Node 24.18.0, npm 11.16.0
- PostgreSQL cục bộ: 17.10

## 1. Nguyên tắc đọc số liệu

1. Đây là số liệu cục bộ, không phải production SLO.
2. Kết quả database ban đầu dùng dataset seed nhỏ, khoảng 16,56 MB; không đủ để kết luận index hoặc scalability.
3. Sau khi test suite cleanup, `PERFORMANCE_DATABASE_URL` trỏ tới database khoảng 8,18 MB nhưng không còn application table; vì vậy lần chạy `--explain` sau đó lỗi `relation \"chu_dau_tu\" does not exist`. Kết quả plan ban đầu được giữ làm bằng chứng của lượt đo, nhưng phải tái tạo trên staging trước implementation.
4. Cột “Sau tối ưu” để trống vì giai đoạn này không sửa code. Không tuyên bố “nhanh hơn” nếu chưa đo lại cùng harness/dataset.

## 2. Baseline bắt buộc

| Hạng mục | Trước tối ưu | Sau tối ưu | Thay đổi | Trạng thái / cách đo tiếp |
|---|---:|---:|---:|---|
| Frontend secure build time | 6,25 giây warm; lượt trước 8,84 giây | Chưa thực hiện | — | Đo 5 lần clean/warm, báo median và p95 |
| Tổng JS bundle | 1.745.238 byte raw; 379.856 byte gzip | Chưa thực hiện | — | 39 chunk, đo bằng artifact `dist` |
| Initial load | Chưa đo | Chưa thực hiện | — | Playwright trace, Fast 4G + desktop LAN |
| Time to render package | Chưa đo | Chưa thực hiện | — | Performance mark quanh `showPackageDetails` |
| Time to switch evaluation tab | Chưa đo | Chưa thực hiện | — | E2E 1G1T/1G2T với 10/100/500 bid |
| Time to render contractor table | Chưa đo | Chưa thực hiện | — | E2E với 100/1.000/5.000 contractor |
| Save/sync duration | Chưa đo end-to-end | Chưa thực hiện | — | Browser mark + server timing + DB statement stats |
| Load package API | Chưa đo end-to-end | Chưa thực hiện | — | p50/p95/p99 trên staging |
| Database query count | Chưa đo theo workflow | Chưa thực hiện | — | Reset/tag `pg_stat_statements` theo scenario |
| Import Excel duration | Chưa đo | Chưa thực hiện | — | 6 fixture thật, 100/1.000/10.000 dòng |
| Export Excel duration | Chưa đo | Chưa thực hiện | — | Worker metrics theo kích thước output |
| Worker idle polling | 71.113 call, 71.112 call rỗng | Mô phỏng: giảm 46,9–47,2% với fixed-5s; external document giảm 89,4% | Chưa đo lại runtime | Snapshot runtime role, chi tiết mục 5 |
| Audit-chain verification | 425 full scans, 113 audit row hiện tại | Incremental: đọc checkpoint anchors + tail giữa các full scan | Chưa đo lại runtime | Chi tiết mục 6 |

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
- Secure build hiện tại tạo chunk `GoiThauDetail` 265,30 kB raw và 45,30 kB gzip, so với baseline 286.146 byte raw và 44.349 byte gzip. Raw giảm nhưng gzip tăng nhẹ; chưa có browser trace nên không kết luận navigation nhanh hơn.
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
- Event `input`/`change` vẫn gọi update cho toàn bảng; event delegation/batching chưa triển khai trong lát này.

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

Tạo harness Playwright với fixture deterministic:

1. Login test workspace.
2. Mở gói có 10/100/500 bid.
3. Chuyển tab hợp lệ/năng lực/kỹ thuật/tài chính.
4. Sửa một ô, đo input-to-render và số DOM node.
5. Import workbook, đổi package giữa chừng, save/reload.

Metrics: navigation, LCP, INP, long tasks, heap delta, render count, network bytes.

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

### Import/export

Thêm CLI benchmark đọc fixture và báo:

- workbook size/sheet/row count;
- parse, recognize, validate identity, map, apply durations;
- worker queue wait/render/serialize durations;
- peak memory và event-loop long task.

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

## 12. Tóm tắt đề xuất chưa thực hiện

| Ưu tiên | Đề xuất | Lợi ích kỳ vọng | Rủi ro |
|---|---|---|---|
| P1 | Map bid + batch ranking | Giảm CPU/DOM per keystroke | Stale UI nếu flush sai |
| P1 | Persistent outbox không deep clone | Giảm GC và tăng data safety | Core sync complexity |
| P1 | Batch detailed-evaluation write | Giảm statement count/round trips | Transaction/query semantics |
| P2 | Idle backoff + notify hint | Giảm 71k poll rỗng | Tăng pickup latency |
| P2 | Incremental audit verification | Scale theo delta thay vì history | Compliance/checkpoint integrity |
| P3 | Đo route-specific workflow imports đã tách | Xác nhận mức giảm transferred/parse thực tế | Cache/shared chunk có thể làm lợi ích nhỏ hơn artifact |
| P3 | Web Worker Excel | Giảm UI blocking nếu file lớn | Clone overhead, error handling |

Các mục đã triển khai có characterization/microbenchmark riêng ở trên. Browser E2E, staging latency/WAL/lock và production remeasurement vẫn còn thiếu nên chưa có kết luận hiệu năng tổng thể.
