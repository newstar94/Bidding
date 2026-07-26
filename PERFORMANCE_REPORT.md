# Báo cáo hiệu năng BiddingFlow

- Snapshot: `1fb76ad`
- Ngày đo: 2026-07-26
- Trạng thái: **baseline và đề xuất; chưa tối ưu code**
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
| Worker idle polling | 71.113 call, 71.112 call rỗng | Chưa thực hiện | — | Snapshot runtime role, chi tiết mục 5 |
| Audit-chain verification | 425 full scans, 113 audit row hiện tại | Chưa thực hiện | — | Chi tiết mục 6 |

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
- `BiddingController.ensureWorkflowModules()` tại `frontend/app/BiddingController.js:283-299` tải đồng thời bidding và partner workflows. Route `mothau`/`danhgiahsdt`/`goithau-detail` gọi cả hai tại `:780-783` dù thường không cần partner workflow ngay.
- Kích thước chunk không tự chứng minh bottleneck. Chỉ tách command group sau khi browser trace cho thấy download/parse/compile ảnh hưởng route navigation.
- Manifest Word raw lớn nhưng gzip nhỏ; split thêm có thể làm tăng request/complexity mà lợi ích không đáng kể.

### Đề xuất đo

1. Thêm Playwright E2E và `performance.mark/measure` cho bootstrap, first route, package detail và evaluation tab.
2. Chạy profile với cache lạnh/ấm, CPU throttle 4x và Fast 4G.
3. Ghi total transferred, JS parse/evaluate, LCP/INP và long task.
4. Sau đó mới thử tách `ensureBiddingWorkflows` và `ensurePartnerWorkflows`; so sánh cùng trace.

## 4. Bottleneck frontend đã có bằng chứng tĩnh

### 4.1. Ranking đánh giá rescan theo mỗi lần gõ

**Evidence**

- `frontend/packages/BidEvaluationWorkflow.js:794-938` lấy toàn bộ DOM row, với mỗi row lại `find` trên `model.state.thongtinmothau` hai lượt.
- `:1191-1224` gọi `updateAllRankings()` trên từng `input` và `change` event.

Nếu số bid trong state tăng cùng số row, chi phí lookup tiến gần O(n²) trên mỗi keystroke, chưa tính DOM query và calculate ranking.

**Đề xuất**

- Tạo `Map<bidId,bid>` một lần cho render/update cycle.
- Event delegation tại tbody thay listener cho từng input.
- Batch update qua `requestAnimationFrame`; debounce chỉ với input text, không trì hoãn action quyết định.
- Chỉ cập nhật row/rank bị ảnh hưởng nếu rule cho phép.

**Lợi ích dự kiến**

Giảm lookup CPU và layout work; chưa định lượng trước benchmark 10/100/500 row.

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

## 6. Audit-chain verification

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

## 7. Detailed-evaluation persistence

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
| P3 | Tách workflow imports | Giảm route JS nếu trace chứng minh | Thêm chunks/request |
| P3 | Web Worker Excel | Giảm UI blocking nếu file lớn | Clone overhead, error handling |

Không có benchmark “sau tối ưu” vì chưa thay đổi code trong giai đoạn review.
