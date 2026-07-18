# Runbook vận hành BiddingFlow

## Phát hành

1. Chạy `npm ci`, `npm run check`, `npm run test:e2e`, `npm run audit:dependencies`.
2. Tạo artifact bằng `npm run package:production`; lưu manifest/SBOM cùng phiên bản phát hành.
3. Tạo database production mới trên volume mã hóa; không sao chép database phát triển.
4. Điền secret bằng secret manager, xác nhận HTTPS, CORS, WebSocket origin, proxy trust và secure cookie.
5. Chỉ đưa traffic vào khi `/health/live` và `/health/ready` đạt.

## Backup và restore diễn tập

Full-state backup phiên bản 2 chỉ chạy trong cửa sổ quiesce: timer dừng
`biddingflow.service`, công cụ phải lấy được writer lease độc quyền, sau đó mới
chụp SQLite, uploads và Word templates rồi khởi động lại ứng dụng. Nếu ứng dụng
vẫn chạy, backup fail-closed; không xóa `.writer.lock` để ép lệnh tiếp tục.

```powershell
python scripts/full_state_backup.py create --database <db> --backup-dir <backup> --uploads <uploads> --word-templates <templates>
python scripts/full_state_backup.py verify --snapshot <snapshot-dir>
python scripts/full_state_backup.py restore --snapshot <snapshot-dir> --destination <new-empty-directory>
```

Chạy restore diễn tập tối thiểu mỗi tháng và trước bản phát hành lớn. Ghi lại checksum, schema version, thời gian restore và người xác nhận. Backup phải ở volume mã hóa tách khỏi database và có bản sao off-host.

Sau khi cả snapshot nguồn và cây đã restore đều vượt qua kiểm tra checksum/SQLite, đặt `BIDDING_RESTORE_DRILL_HMAC_KEY` từ secret manager rồi ghi mốc diễn tập để metrics theo dõi tuổi bản restore:

```powershell
python scripts/record_restore_drill.py --snapshot <snapshot-dir> --restored <restored-dir> --state-file <backup-dir>/last-restore-drill.json
```

Không tạo mốc thủ công nếu chưa chạy restore thật; script xác minh lại cả hai cây trước khi ghi file trạng thái nguyên tử.

## Cô lập document worker

Ứng dụng giới hạn admission trước executor bằng `DOCUMENT_WORKER_MAX_CONCURRENCY + DOCUMENT_WORKER_QUEUE_SIZE`; khi đầy, export/import trả `503` thay vì giữ payload trong hàng đợi vô hạn. Subprocess chạy với thư mục làm việc riêng, không nhận `BIDDING_DB_PATH`, có deadline và quota CPU/RAM/output/process. Hủy HTTP request không giải phóng slot cho đến khi worker thật sự kết thúc.

Các giới hạn Python/Windows Job Object này **không thay thế OS sandbox**. Trước production công khai, chạy document worker bằng principal/container riêng, chỉ mount job directory và template cần thiết ở chế độ tối thiểu, dùng filesystem ACL/read-only mounts, cấm network bằng firewall/network namespace và không cấp quyền đọc DB/uploads/source ngoài phạm vi công việc. Nếu chưa có ranh giới OS này, giữ release gate security High ở trạng thái đóng.

## Database lock hoặc WAL tăng bất thường

1. Kiểm tra chỉ có một process được quyền ghi và `BIDDING_SQLITE_SINGLE_WRITER=true`.
2. Kiểm tra readiness, dung lượng disk, file `-wal`/`-shm` và request dài đang chạy.
3. Không xóa sidecar khi process còn hoạt động. Dừng nhận traffic, dừng app rồi chạy backup/checkpoint có kiểm soát.
4. Chạy `check_database.py`; nếu integrity không đạt, giữ nguyên bản lỗi để điều tra và restore bản backup đã xác minh.

## Mất mạng và WebSocket

- Frontend giữ mutation trong IndexedDB theo workspace, hiển thị số thay đổi chờ và tự đồng bộ lại khi kết nối phục hồi.
- Nếu cursor cũ hơn retention tombstone, server yêu cầu full bootstrap; không ép ghi đè dữ liệu server.
- Với conflict, người dùng chọn từng trường local/server rồi retry với `row_version` mới.

## Thu hồi phiên và sự cố tài khoản

- Khóa tài khoản/tổ chức hoặc đổi mật khẩu phải revoke phiên và đóng WebSocket liên quan.
- Khi nghi lộ secret: rotate credential tại nhà cung cấp, cập nhật secret manager, restart service, revoke toàn bộ phiên liên quan và rà audit log đã che dữ liệu nhạy cảm.

## Theo dõi tối thiểu

- Cảnh báo readiness, HTTP 5xx/429, p95 latency, event-loop lag, blocking-I/O queue, disk/WAL, lỗi backup và lần restore diễn tập gần nhất.
- Log đặt ngoài source artifact, có rotation; không ghi token, mật khẩu, CCCD đầy đủ, tài khoản ngân hàng hoặc nội dung file.

## Metrics, SLO và cảnh báo

`GET /metrics` xuất định dạng Prometheus nhưng không phải API công khai. Mặc định chỉ loopback được phép; nếu đặt `METRICS_BEARER_TOKEN`, scraper phải đồng thời thuộc `METRICS_ALLOWED_CIDRS` và gửi token. Nginx mẫu cũng chặn client ngoài máy chủ. Không thêm user ID, organization ID, URL động hoặc dữ liệu nghiệp vụ vào label metrics.

Kiểm tra cục bộ:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/metrics -Headers @{ Authorization = "Bearer <metrics-token>" }
```

Cấu hình mẫu nằm tại `deploy/prometheus/biddingflow-scrape.yml`, rule tại `deploy/prometheus/biddingflow-alerts.yml`, dashboard Grafana tại `deploy/grafana/biddingflow-overview.json`. Hạ tầng production phải nạp các file này, kết nối Alertmanager với kênh trực và thay các nhãn owner mẫu bằng lịch trực thực tế.

SLO khởi điểm (điều chỉnh sau capacity test, nhưng phải có phê duyệt):

- Availability HTTP không tính lỗi chủ động `429`: 99,9% trong cửa sổ 30 ngày, tương ứng error budget tối đa khoảng 43 phút 12 giây.
- Tỷ lệ `5xx` dưới 1% trong 30 ngày; cảnh báo nhanh khi vượt 2% liên tục 10 phút.
- p95 tổng thể dưới 1 giây trong cửa sổ 5 phút; theo dõi export tài liệu riêng khi phân tích vì deadline của nó dài hơn request thông thường.
- Event-loop lag dưới 500 ms; không có queue nào duy trì trên 80% capacity quá 5 phút hoặc tăng reject.
- Full-state backup đã xác minh không quá 26 giờ; restore drill đã xác minh không quá 35 ngày; disk còn ít nhất 15%.

Phân công mặc định: `application-oncall` chịu HTTP/queue/WebSocket, `database-oncall` chịu SQLite/WAL, `platform-oncall` chịu target, disk, backup và restore. Alert critical phải được xác nhận trong 15 phút; nếu error budget 30 ngày đã dùng trên 50%, tạm dừng thay đổi không cấp thiết; trên 100% thì đóng release gate cho đến khi có remediation được phê duyệt.

Log runtime mới là JSON Lines (`runtime.jsonl`) với `requestId` và, khi route đã xác thực/xác định workspace, chỉ các opaque ID `userId`/`organizationId`. Chế độ mặc định `STRUCTURED_REQUEST_LOG_MODE=errors` chỉ ghi request `4xx/5xx`; đặt `all` chỉ khi storage/retention đã được tính dung lượng. Bộ lọc log loại token, email, nội dung file và chuỗi số giống CCCD/tài khoản ngân hàng.

## Audit chain không hợp lệ

Verifier chạy ngay sau startup và lặp theo `AUDIT_CHAIN_VERIFY_INTERVAL_SECONDS`. Khi `biddingflow_audit_chain_valid` bằng `0` hoặc verifier không hoàn tất:

1. Ngừng các mutation quản trị và giữ nguyên database/WAL/backup liên quan; không sửa, xóa hay “nối lại” audit row trên bản gốc.
2. Chụp full-state backup để điều tra, đối chiếu checkpoint đã neo off-host gần nhất và xác định ID/hash đầu chuỗi bị sai.
3. Nếu chỉ verifier bị lỗi vận hành, kiểm tra DB read lane, disk và quyền truy cập; chỉ khởi động lại sau khi đã lưu bằng chứng.
4. Chỉ phục hồi từ backup đã xác minh và mở lại mutation sau khi `valid=1`. Ghi incident ID trong hồ sơ vận hành, không ghi PII vào alert/log.

Nếu đặt `AUDIT_CHECKPOINT_DIR`, ứng dụng kiểm tra chain hiện tại vẫn chứa hoặc nối tiếp checkpoint gần nhất trước khi tạo checkpoint mới; vì vậy rollback/truncation so với mốc local được phát hiện. Đặt `AUDIT_CHECKPOINT_HMAC_KEY` bằng secret manager. Thư mục local **không tự trở thành kho bất biến**: platform-oncall phải replicate từng file tên duy nhất sang object storage WORM/retention-lock ở tài khoản hoặc host tách biệt và giữ key HMAC ngoài database server. Nếu kẻ tấn công có thể đồng thời xóa database và checkpoint local, chỉ bản neo off-host bất biến mới cung cấp bằng chứng chống rollback.
