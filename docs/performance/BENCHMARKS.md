# Benchmark thủ công

Các benchmark dưới đây dùng để tạo bằng chứng hiệu năng có thể lặp lại trong môi trường production-like. Chúng không phải CI pass/fail gate; CI chỉ giữ các regression threshold nhỏ, ổn định và ít phụ thuộc phần cứng.

## Lệnh chạy

- `npm run benchmark:persistence`: đo explicit persistence và rollback khi một write trong batch thất bại.
- `npm run benchmark:n-plus-one`: đo query count và phát hiện N+1 ở các repository chính.
- `npm run benchmark:aggregate-version`: đo clone + validation của aggregate server-generated ở 2.000, 10.000 và 25.000 record.

## Aggregate version — 2026-08-14

Máy đo: Windows, Python 3.14, benchmark in-memory dùng `tracemalloc`. Mỗi package có một goods row, một opening row và một bidder-goods row; validator chạy trên graph hoàn chỉnh.

| Requested records | Output items | Wall time | Peak traced memory |
|---:|---:|---:|---:|
| 2.000 | 2.001 | 0,0544 giây | 1,71 MiB |
| 10.000 | 10.001 | 0,2660 giây | 8,78 MiB |
| 25.000 | 25.001 | 0,6865 giây | 22,26 MiB |

Database loader giới hạn 500 parent ID/query. Official aggregate giữ một outer transaction; lỗi validation/write ở chunk muộn phải rollback toàn graph, sync cursor, audit và WebSocket outbox. Generated aggregate không tạo savepoint cho từng record.

Ngưỡng CI nhỏ hiện kiểm tra 2.001 record dưới 5 giây và dưới 128 MiB để phát hiện regression rõ rệt mà không biến độ nhanh/chậm của runner thành lỗi giả.
