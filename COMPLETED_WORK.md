# Tổng hợp các việc đã hoàn thành

## 2026-07-27

### Chẩn đoán hiệu năng khởi động

- Đã phân rã mốc `navigation to hide loader = 1.365 ms` và xác định phần tăng chính nằm trước model/API.
- Đã benchmark 15 lượt tải lạnh và 15 lượt tải ấm bằng Chromium có kiểm soát; tải lạnh tối đa `746 ms`.
- Đã đối chiếu bundle, baseline lịch sử, backend/API, database queue và service worker.
- Chưa tìm thấy bằng chứng hồi quy do code frontend mới; `1.365 ms` hiện được phân loại là outlier phía browser/cache/CPU cần trace trên đúng profile nếu tái diễn.
- Đã lập danh sách giải pháp và tiêu chí kiểm thử tại [báo cáo chẩn đoán](docs/reports/STARTUP_PERFORMANCE_ANALYSIS_2026-07-27.md).
- Không sửa source ứng dụng trong lượt chẩn đoán này.

### Cải thiện hiệu năng khởi động

- Đã thêm Playwright performance gate với ngưỡng cold p95 `800 ms`, warm p95 `300 ms`, long task `100 ms`.
- Đã preload app bundle đúng thứ tự và prewarm critical assets khi backend khởi động.
- Đã gộp 11 CSS production thành một file băm nội dung.
- Đã lazy-load Notification Center, dời Lucide và service worker ra sau khung hình đầu, chỉ tải Google Identity trên màn hình đăng nhập.
- Đã sửa service worker để ghi cache nền và giữ `Content-Length` cho asset tĩnh.
- Đã bổ sung cấu hình Nginx HTTP/2 + gzip cho production.
- Kết quả cuối: cold p95/max `410 ms`, warm p95/max `133 ms`, không có runtime error; build hash mới đầu tiên tối đa `687 ms`.
- Đã xác nhận AdGuard là nguyên nhân ngoài ứng dụng còn làm Chrome chậm; cần whitelist origin BiddingFlow.
- `31` kiểm thử Python, `3` kiểm thử Node, secure build và production package smoke test đều đạt.
