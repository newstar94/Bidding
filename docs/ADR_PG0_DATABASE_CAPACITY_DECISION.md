# ADR PG-0 — Quyết định database dựa trên capacity

- Trạng thái: **Đã chọn PostgreSQL làm database production mục tiêu; capacity gate vẫn chờ staging**
- Ngày quyết định kỹ thuật: 18/07/2026
- Người yêu cầu: chủ dự án BiddingFlow
- Evidence hiện có: `mixed-100.json` và `soak-100.json` đều hợp lệ; 6/6 regression test profile đạt. Đây là evidence định nghĩa workload, không phải kết quả chịu tải.

## Câu hỏi quyết định

BiddingFlow có thể tiếp tục production giới hạn bằng một SQLite instance trong capacity envelope đã đo, hay phải chuyển sang PostgreSQL trước khi nhận workload mục tiêu?

## Gate bắt buộc trước quyết định

- P0 security/stability đã hoàn thành và regression test đạt.
- Mixed load/soak dùng dữ liệu, quyền, sync batch, export và WebSocket gần thực tế.
- k6 exit code `0`, summary `passed=true`, không dropped iterations.
- Có metrics CPU, RAM, WAL, disk I/O, file descriptor và queue depth cùng timestamp.
- Kiểm tra sau tải xác nhận không mất sync/outbox, không ghi sai dữ liệu và resource growth đã hồi phục.
- Có headroom và người chịu trách nhiệm chấp nhận single-instance/single-point-of-failure nếu giữ SQLite.

## Các lựa chọn

1. Giữ SQLite tạm thời, một application process/instance, trong envelope được phê duyệt.
2. Bắt đầu PostgreSQL vì workload/HA/multi-instance đã vượt điều kiện vận hành SQLite.
3. Giảm workload hoặc trì hoãn phát hành và tối ưu thêm trước khi đo lại.

## Kết quả

Chọn phương án 2: triển khai PostgreSQL trước khi nhận workload mục tiêu 100 concurrent
active users và trước khi chạy nhiều application instance. Quyết định này xuất phát từ
yêu cầu vận hành đã chốt, không phải tuyên bố SQLite đã thất bại ở một phép đo cụ thể.

Việc repository có load harness không chứng minh PostgreSQL đã đạt workload mục tiêu.
Capacity gate, cấu hình tài nguyên và quyền mở traffic chỉ được phê duyệt sau mixed/soak
test trên staging có metrics đầy đủ. Sau mỗi thay đổi DB engine, pool/queue, ingress hoặc
số instance phải tạo evidence mới và duyệt lại ADR này.

## Bản ghi cần điền sau phép đo

- Evidence ID/source revision:
- Profile và fixture:
- Cấu hình app/DB/host:
- QPS, WebSocket, p95/p99, 5xx/429, dropped iterations:
- CPU/RAM/WAL/I/O/file descriptor/queue depth:
- Kết quả recovery và integrity:
- Headroom:
- Quyết định chọn lựa:
- Rationale và rủi ro còn lại:
- Người phê duyệt/ngày:
