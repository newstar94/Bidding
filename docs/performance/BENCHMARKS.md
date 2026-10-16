# Benchmark hiệu năng thủ công

Các benchmark sau phục vụ đo đạc và so sánh hiệu năng tại môi trường kiểm soát; chúng **không phải CI pass/fail gate**.

- `npm run benchmark:persistence`: đo đường ghi/persist dữ liệu rõ ràng.
- `npm run benchmark:n-plus-one`: phát hiện hồi quy số lượng truy vấn theo dữ liệu đầu vào.
- `npm run benchmark:excel-server`: đo đường xử lý cách ly thực tế của upload Excel chuyên gia; ngân sách mặc định là 1,5 giây.

Trước khi chạy, sử dụng fixture hoặc môi trường không có dữ liệu production. Ghi lại môi trường, commit và kết quả baseline để so sánh.

## Rollback

Các script benchmark chỉ đọc/đo theo fixture hoặc môi trường đã chuẩn bị. Nếu một benchmark có thay đổi dữ liệu trong môi trường thử nghiệm, rollback bằng cách khôi phục snapshot/fixture của môi trường đó trước khi lặp lại phép đo.

## Đo startup trong CI

`scripts/measure_startup.mjs` giữ ngưỡng tác vụ 100 ms và mốc `bf:loader:hidden`.
Ngoài PerformanceObserver, mỗi lượt đo thu CDP script timing (`scriptTimingTracing: true`)
để không bỏ sót script đầu tiên trên Chromium khi cả Long Task và LoAF đều trống.
Chỉ dùng sự kiện EvaluateScript của luồng chính trước mốc loader; không cộng các
script ngắn thành một tác vụ dài và không tính script sau mốc này.

`STARTUP_TRACE_DIR` vẫn chỉ bật lưu trace chẩn đoán chi tiết (`diagnosticTracing`);
khi không cấu hình thư mục này, trace tối thiểu chỉ được xử lý trong bộ nhớ.
Thu trace có overhead, vì vậy baseline hiệu năng cũ không hoàn toàn tương đương;
cần đo lại trên runner/release thực tế, không nới ngưỡng để bù overhead.
