# Chẩn đoán hiệu năng khởi động — 2026-07-27

## Kết luận

Mốc `navigation to hide loader = 1.365 ms` trong ảnh là một mẫu chậm bất thường, nhưng chưa có bằng chứng cho thấy đây là hồi quy ổn định do code mới.

- 15/15 lượt tải lạnh bằng Chromium có kiểm soát đều không vượt `746 ms`.
- Các lượt tải ấm ổn định khoảng `218–265 ms`; giá trị lớn nhất trong bộ kiểm tra là `312 ms`.
- Frontend hiện tại giống byte với baseline `8d5743b`; tổng bundle hiện tại không lớn hơn baseline.
- Backend, truy vấn database và API dữ liệu tuyến đầu không chiếm phần tăng chính.

Phần chậm trong ảnh tập trung trước khi model và API thực sự chạy. Khả năng cao nhất là trạng thái tải lạnh phía trình duyệt: cache/service worker vừa đổi phiên bản, module scheduling, parse/evaluate, extension chèn mã hoặc CPU của máy tại đúng thời điểm đo. Đây là kết luận theo xác suất dựa trên bằng chứng hiện có, chưa phải khẳng định một tác nhân duy nhất.

## Cách đọc đúng số liệu trong ảnh

Các mốc console bị lồng nhau nên không được cộng tất cả các dòng:

| Khoảng thời gian | Thời lượng |
|---|---:|
| Navigation → app module bắt đầu | `765 ms` |
| App module → `init:start` | `385 ms` |
| Trong đó import workspace | `330 ms` |
| `init:start` → ẩn loader | `215 ms` |
| Tổng | khoảng `1.365 ms` |

Các mốc model `10 ms`, UI quan trọng `27 ms`, dữ liệu tuyến đầu `70 ms` và hoàn tất route `179 ms` nằm bên trong các khoảng trên.

## Bằng chứng

### Không tái hiện được lỗi 1.365 ms

Đã chạy ba đợt, mỗi đợt gồm 5 lượt lạnh và 5 lượt ấm bằng cùng Chromium engine:

- Tải lạnh: tối đa `746 ms`, 15/15 lượt đạt ngưỡng `800 ms`.
- Tải ấm thông thường: `218–265 ms`.
- Một số lượt chuyển trạng thái service worker: khoảng `337–438 ms`.

Baseline lịch sử cũng không phải mọi lượt đều dưới 800 ms:

- Bản production: median `588 ms`, p95 `816 ms`.
- Chạy source: median `734 ms`, p95 `939 ms`.

Vì vậy một số đơn lẻ `1.365 ms` chưa đủ chứng minh code bị chậm đi; cần so sánh p50/p95 trên cùng profile và cùng trạng thái cache.

### Không thấy frontend mới làm bundle phình lên

- Hiện tại: 39 chunk, `1.725.017 B` raw / `381.735 B` gzip.
- Baseline: `1.745.238 B` raw / `379.856 B` gzip.
- Runtime frontend hiện tại giống baseline commit `8d5743b`.

Tuy nhiên đường tải quan trọng vẫn còn nặng và dễ tạo outlier:

- Workspace graph: khoảng 16 file, `520.668 B` raw / `139.370 B` gzip.
- Riêng workspace bootstrap: khoảng `208 KB`.
- HTML ban đầu: khoảng `94 KB`.
- 11 CSS: khoảng `353 KB` raw.
- Lucide runtime: khoảng `409 KB`, vẫn tải song song trong giai đoạn đầu.

### Backend không phải điểm nghẽn chính của mẫu trong ảnh

- HTML shell: trung bình khoảng `12,4 ms`.
- API `get-all-data`: trung bình khoảng `94 ms`; trong ảnh dữ liệu tuyến đầu chỉ `70 ms`.
- Chờ hàng đợi database: trung bình `0,474 ms`.
- Session lookup: trung bình `4,45 ms`.
- Tải trực tiếp chunk workspace 208 KB từ Uvicorn: khoảng `7–37 ms` trong các lượt đo.

Backend vẫn có query fan-out quyền cần tối ưu riêng: một response nhỏ từng chạy 54 SQL, trong đó có khoảng 30 lần lặp truy vấn membership. Điều này làm mất dư địa hiệu năng, nhưng không giải thích phần `765 ms` trước app module trong ảnh.

## Nguyên nhân khả dĩ, theo thứ tự ưu tiên

1. **Trạng thái cache/service worker hoặc browser profile tại đúng lượt đo.** Lượt đầu sau build có thể vừa cập nhật service worker vừa tải và ghi cache, cạnh tranh tài nguyên với import workspace.
2. **Module scheduling và parse/evaluate phía trình duyệt.** Server tải file nhanh nhưng import workspace mất `330 ms`, phù hợp với chi phí xử lý module graph và CPU hơn là thời gian mạng/backend.
3. **Extension hoặc policy phía trình duyệt.** Đối chứng sau đó đã xác nhận Chrome trên máy bị `http://local.adguard.org` chèn hai content script vào mọi lượt tải. Chrome có AdGuard chậm hơn rõ rệt và sinh long task, trong khi Chromium sạch không có hiện tượng này.
4. **Đường tải quan trọng còn quá rộng.** HTML, 11 CSS, workspace graph và Lucide tạo ít dư địa khi máy bận hoặc cache lạnh.
5. **Chạy trực tiếp Uvicorn.** Asset hiện không được gzip/Brotli và không tận dụng HTTP/2 như cấu hình reverse proxy production trước đây.

## Giải pháp đề xuất

### Ưu tiên 1 — đo đúng nguyên nhân trên profile thật

- Đo 10–20 lượt trên đúng tài khoản và route, tách tải lạnh/tải ấm.
- So sánh bốn trường hợp: service worker bật/tắt và extension bật/tắt.
- Thử cửa sổ Incognito hoặc whitelist origin nội bộ trong AdGuard.
- Ghi thêm Navigation Timing, Resource Timing, long task, trạng thái service worker và `Server-Timing`.
- Dùng p50/p95; không dùng một giá trị tối đa đơn lẻ để quyết định hồi quy.

Trình duyệt tích hợp đã được thử lại nhưng không khởi tạo do lỗi Windows sandbox `helper_unknown_error`, xảy ra trước khi kết nối tới ứng dụng. Vì vậy phép đo trong báo cáo dùng Chromium tự động có kiểm soát thay cho đúng profile đăng nhập của người dùng.

### Ưu tiên 2 — khôi phục hàng rào chống hồi quy

- Khôi phục bộ kiểm thử Playwright/E2E và performance gate đã bị xóa trong đợt cleanup.
- Gate đề xuất: cold p95 `≤ 800 ms`, warm p95 `≤ 300 ms`, không có long task `> 100 ms` trên cấu hình chuẩn.
- Lưu trace khi một lượt vượt ngưỡng để phân biệt server, network, service worker và main thread.

### Ưu tiên 3 — giảm chi phí tải đầu

- Production đi qua Nginx/Caddy với HTTP/2 và gzip/Brotli; giữ `Content-Length` cho static response.
- Preload đúng `app-<hash>.js` ở đầu `<head>`.
- Lazy-load Notification, Admin và các controller không cần cho route đầu.
- Dời Lucide đầy đủ, Google Identity và tác vụ nền sang sau khi loader đã ẩn hoặc thời điểm idle.
- Bundle/minify CSS, tách CSS landing khỏi CSS workspace và giảm DOM ban đầu.

### Ưu tiên 4 — service worker

- Đo A/B trước khi sửa.
- Khi cache miss, trả network response ngay và ghi cache bằng tác vụ nền `event.waitUntil(...)`.
- Hoặc không dùng service worker cache cho immutable hashed assets, để HTTP cache đảm nhiệm.
- Dời đăng ký/cập nhật service worker sang sau khi giao diện đầu tiên đã hiển thị.

### Ưu tiên 5 — backend

- Tái sử dụng access snapshot trong phạm vi một request để tránh lặp truy vấn membership.
- Gộp dashboard summary thành một truy vấn tổng hợp; không trì hoãn doanh thu sang nền vì sẽ tái tạo lỗi doanh thu sai ở lần mở đầu.
- Chỉ full sync khi chưa có cursor hoặc cache/schema không tương thích; các lần sau dùng delta sync.

## Tiêu chí xác nhận sau tối ưu

1. Chạy ít nhất 20 cold + 20 warm trên máy chuẩn.
2. Cold p95 không quá `800 ms`; warm p95 không quá `300 ms`.
3. Không có long task trên main thread quá `100 ms` trước khi ẩn loader.
4. API tuyến đầu p95 không quá `250 ms` và database queue không có timeout/reject.
5. Lặp lại trên profile có extension và profile sạch để xác nhận tác động của extension.

## Kết quả triển khai cải thiện

### Thay đổi đã thực hiện

- Preload đúng app bundle đã băm nội dung trước workspace graph.
- Gộp 11 stylesheet production thành một file `styles-<hash>.css` khoảng `292 KB` raw / `52,5 KB` gzip.
- Tách Notification Center khỏi critical graph; workspace bootstrap giảm từ khoảng `208 KB` xuống `200 KB`.
- Dời Lucide đầy đủ và đăng ký service worker ra sau khung hình ứng dụng đầu tiên.
- Chỉ tải Google Identity khi thực sự hiển thị màn hình đăng nhập.
- Service worker trả network response trước và ghi CacheStorage trong `event.waitUntil(...)`.
- Giữ `Content-Length` cho asset tĩnh có thân phản hồi ổn định.
- Prewarm app/workspace/admin/style graph khi backend khởi động để người dùng đầu tiên sau deploy không chịu cold file I/O.
- Khôi phục cấu hình Nginx HTTP/2 + gzip và thêm Playwright performance gate trong CI.

### Số đo sau triển khai

Phép đo cuối bằng 10 cold + 10 warm, Chromium sạch, build secure:

| Chỉ số | Kết quả | Ngưỡng |
|---|---:|---:|
| Cold median | `279 ms` | — |
| Cold p95 / max | `410 ms` | `≤ 800 ms` |
| Warm median | `83 ms` | — |
| Warm p95 / max | `133 ms` | `≤ 300 ms` |
| Long task lớn nhất | `52 ms` cold / `0 ms` warm | `≤ 100 ms` |

Một build với hash hoàn toàn mới được dùng để kiểm chứng prewarm. Ngay lượt đầu sau deploy, 5 cold có p95/max `687 ms`, không còn outlier `1.810–2.541 ms` từng xuất hiện khi asset chưa được prewarm.

### Đối chứng AdGuard

- Trước tối ưu, Chrome có AdGuard: cold p95 `1.160 ms`, warm p95 `724 ms`, long task tối đa `296 ms`.
- Sau tối ưu, Chrome có AdGuard: cold p95 `1.011 ms`, warm p95 `369 ms`, long task tối đa `194 ms`.
- Chromium sạch sau tối ưu: cold p95 `410 ms`, warm p95 `133 ms`.

Phần còn lại trên Chrome là tác động bên ngoài ứng dụng. Cần whitelist `127.0.0.1:8000` và tên miền triển khai trong AdGuard, hoặc tắt lọc cho origin BiddingFlow.

### Kiểm chứng

- `31` kiểm thử Python đạt.
- `3` kiểm thử Node về critical path đạt.
- Secure build, audit vendor và Trusted Types gate đạt.
- Production archive và extracted-runtime smoke test đạt.
- Playwright đo 20 lượt cuối không ghi nhận runtime error.

Không thay đổi nghiệp vụ hoặc dữ liệu người dùng trong lượt tối ưu này.
