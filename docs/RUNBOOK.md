# Runbook vận hành BiddingFlow

## Phát hành

1. Chạy `npm ci`, `npm run check`, `npm run test:e2e`, `npm run audit:dependencies`.
2. Tạo artifact bằng `npm run package:production`; lưu manifest/SBOM cùng phiên bản phát hành.
3. Tạo database production mới trên volume mã hóa; không sao chép database phát triển.
4. Điền secret bằng secret manager, xác nhận HTTPS, CORS, WebSocket origin, proxy trust và secure cookie.
5. Chỉ đưa traffic vào khi `/health/live` và `/health/ready` đạt.

## Backup và restore diễn tập

```powershell
python scripts/backup_database.py --database <db> --backup-dir <backup>
python scripts/restore_database.py --backup <backup.db> --destination <rehearsal.db>
python scripts/check_database.py --database <rehearsal.db>
```

Chạy restore diễn tập tối thiểu mỗi tháng và trước bản phát hành lớn. Ghi lại checksum, schema version, thời gian restore và người xác nhận. Backup phải ở volume mã hóa tách khỏi database và có bản sao off-host.

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

