# Benchmark baseline

Chạy ngày 15/07/2026 bằng `npm run benchmark:database` trên máy phát triển Windows, SQLite WAL, schema sạch, 20.000 kế hoạch và 100.000 gói thầu. Mỗi truy vấn được đo 30 lần sau khi seed; kết quả máy đọc được nằm trong `BENCHMARK_RESULTS.json`.

| Kịch bản | p95 |
| --- | ---: |
| Dashboard tổng hợp | 108,992 ms |
| FTS tiếng Việt | 0,194 ms |
| Trang keyset 50 dòng | 41,518 ms |
| Mở chi tiết | 0,040 ms |
| Sync delta 500 dòng | 0,628 ms |
| Trang full bootstrap 500 dòng | 0,663 ms |

Database benchmark có kích thước 119,02 MiB; seed mất 13,575 giây. Đây là baseline kỹ thuật, không thay thế load test qua mạng trên cấu hình production thực tế. E2E `startup-performance.spec.js` và `manager-performance.spec.js` đo thêm cold/warm navigation trên trình duyệt Chromium.
