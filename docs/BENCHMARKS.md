# Benchmark SQLite sau tối ưu P0

Chạy lại ngày 18/07/2026 bằng `npm run benchmark:database` trên máy phát triển Windows, SQLite WAL, schema migration 5, 20.000 kế hoạch tự động và 100.000 gói thầu. Mỗi truy vấn đọc được đo 30 lần sau khi seed; kết quả máy đọc được nằm trong `BENCHMARK_RESULTS.json`.

| Kịch bản | p95 |
| --- | ---: |
| Dashboard tổng hợp | 48,265 ms |
| FTS tiếng Việt | 0,069 ms |
| Trang keyset 50 dòng | 22,157 ms |
| Mở chi tiết | 0,015 ms |
| Sync delta 500 dòng | 0,233 ms |
| Trang full bootstrap 500 dòng | 0,218 ms |

Database benchmark có kích thước 119,09 MiB; seed mất 11,278 giây.

## Write amplification: trước và sau

Benchmark tạo cùng một trạng thái đầu vào trong hai bản sao database: một family gói thầu cần tính lại và kế hoạch tương ứng cần cập nhật tổng. Nhánh “cũ” thực thi đúng thuật toán quét/update toàn tenant trước P0; nhánh “mới” gọi thuật toán targeted hiện hành. Cả hai cùng chạy trên schema migration 5 nên phép đo tách riêng tác động của thuật toán tính lại, không trộn với thay đổi trigger FTS.

| Chỉ số cho một mutation | Thuật toán cũ | Targeted hiện tại |
| --- | ---: | ---: |
| Base row khớp lệnh update | 220.000 | 2 |
| `total_changes` kể cả trigger | 660.000 | 6 |
| Sync-version được cấp | 220.000 | 2 |
| WAL frame | 17.293 | 13 |
| WAL bytes | 71.247.192 | 53.592 |
| Thời gian transaction | 4.088,130 ms | 139,815 ms |

Kết quả cho thấy số row update và sync-version giảm **110.000 lần**, WAL giảm khoảng **1.330 lần**, và thời gian transaction trên máy đo giảm khoảng **29 lần**. Targeted path chỉ thay đổi đúng một gói và một kế hoạch, nên chi phí ghi không còn tăng theo tổng số bản ghi tenant trong kịch bản này.

Đây là benchmark kỹ thuật tái lập được, không thay thế mixed load/soak test qua mạng trên cấu hình production thực tế. E2E `startup-performance.spec.js` và `manager-performance.spec.js` đo thêm cold/warm navigation trên trình duyệt Chromium.
