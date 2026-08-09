# Performance benchmarks

Owner: maintainers reviewing frontend persistence and backend query-shape
changes. Đây là manual diagnostics; kết quả phải được ghi vào change/PR đang
đánh giá. Các timing này **không phải CI pass/fail gate** và không phải
production SLO khi chưa có telemetry/cardinality tương đương production.

## Explicit persistence

~~~bash
npm run benchmark:persistence
~~~

Script so sánh median của whole-table `persistData` với explicit
`persistChanges` cho 100, 1.000 và 10.000 records trong model/DB giả lập. Chạy
trước và sau thay đổi persistence/outbox để phát hiện mất lợi ích O(changes).
Không dùng số millisecond tuyệt đối để kết luận production vì benchmark không có
IndexedDB, disk, browser scheduling hoặc dữ liệu người dùng thật.

## Batched N+1 PostgreSQL paths

~~~bash
npm run benchmark:n-plus-one -- --sizes 1,10,50,100 --json
~~~

Script cần `TEST_DATABASE_URL`, seed owner-scoped records trong một transaction,
đo query count/pattern và database time cho delete references/impacts,
ownership, uniqueness và authorization, sau đó **rollback** toàn bộ. Dùng khi
sửa các batch context/query nói trên; query count theo size là signal chính,
timing chỉ dùng để so sánh trên cùng PostgreSQL host và cùng dataset.

Không chạy với `DATABASE_URL` production. Nếu benchmark lỗi hoặc để lại row,
dừng đánh giá, kiểm tra rollback/credential và không nâng timing budget để che
regression. Correctness và query-count regressions bắt buộc vẫn nằm trong test;
benchmark manual không thay thế test gate.
