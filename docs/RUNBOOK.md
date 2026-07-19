# BiddingFlow production runbook

## Metrics, SLO và cảnh báo

1. Kiểm tra `/health/live`, `/health/ready` và mục tiêu Prometheus trước.
2. Đối chiếu tỷ lệ 5xx, p95/p99, event-loop lag, worker queue và PostgreSQL pool trong cùng cửa sổ 15 phút.
3. Không restart hàng loạt. Loại từng instance khỏi load balancer, lưu log/request ID rồi restart tuần tự.
4. Nếu rollback ứng dụng, không hạ schema. Chỉ dùng release cũ khi `database_metadata.schema_version` nằm trong dải release đó hỗ trợ.

## PostgreSQL pool và lock

1. Xác nhận `biddingflow_postgres_pool_value{stat="requests_waiting"}`, `pool_available`, timeout theo lane và số worker đang chạy.
2. Trên PostgreSQL, kiểm tra `pg_stat_activity`, `pg_locks`, transaction `idle in transaction`, query chậm và connection theo `application_name`.
3. Hủy query gây nghẽn trước; chỉ terminate session khi đã xác định tác động transaction. Không tăng pool mù quáng vì tổng `instances × workers × pool_max` phải nhỏ hơn ngân sách kết nối.
4. Nếu pool cạn do tải hợp lệ, giảm concurrency ở proxy/worker queue, sau đó điều chỉnh index/query dựa trên `EXPLAIN (ANALYZE, BUFFERS)` ở staging.
5. Nếu database không phản hồi, ngừng nhận mutation mới bằng cách loại instance khỏi load balancer; giữ bằng chứng và chuyển sang quy trình failover của nhà cung cấp PostgreSQL.

## Audit chain không hợp lệ

1. Đặt readiness về fail-closed và ngừng mutation; không xóa/sửa `audit_log` hay `audit_chain_heads`.
2. Lưu checkpoint v2 gần nhất, log bảo mật và snapshot database để điều tra.
3. Chạy verifier trên bản sao cô lập. So sánh từng `chain_id`, `sequence`, `previous_hash`, `entry_hash` và head materialized.
4. Chỉ mở lại traffic sau khi nguyên nhân, phạm vi tenant và quyết định phục hồi được phê duyệt; không “sửa hash cho khớp”.

## Backup và restore diễn tập

```bash
python scripts/backup.py verify --snapshot <snapshot>
python scripts/backup.py drill --snapshot <snapshot>
```

`RESTORE_DRILL_DATABASE_URL` phải là database cô lập. Drill thành công phải tạo marker HMAC mà metrics nhận diện. Kiểm tra RPO bằng tuổi backup, RTO bằng thời gian từ lúc bắt đầu restore đến khi schema/FK/readiness xanh. Không chạy `restore` trực tiếp vào production khi chưa đóng traffic và chưa có phê duyệt sự cố.

## WebSocket outbox tồn đọng

1. Kiểm tra `biddingflow_websocket_outbox_rows` và tuổi event cũ nhất.
2. Xác minh các worker giữ kết nối LISTEN/NOTIFY, database connectivity và log broker.
3. Restart tuần tự một worker để xác nhận replay theo event id; không xóa outbox thủ công khi client chưa bắt kịp.

## Dung lượng thấp

1. Xác định volume media, backup hay runtime bị đầy.
2. Dọn artifact đã hết retention bằng công cụ vận hành; không xóa PostgreSQL data/WAL thủ công.
3. Mở rộng volume trước khi VACUUM/backup lớn nếu free space dưới ngưỡng an toàn.
