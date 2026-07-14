# Quy trình sao lưu và phục hồi SQLite

Tài liệu này áp dụng khi BiddingFlow chạy một instance ứng dụng với SQLite. Nếu cần nhiều instance ghi, high availability hoặc ghi đồng thời lớn, phải chuyển sang PostgreSQL; không chia sẻ file SQLite qua NFS/SMB hay thư mục đồng bộ file.

## 1. Bố trí dữ liệu production

Các đường dẫn production phải là đường dẫn tuyệt đối. Ứng dụng sẽ dừng ngay khi DB nằm trong source, OneDrive/Dropbox/Google Drive/iCloud, thiếu xác nhận single-writer, hoặc các thư mục runtime nằm bên trong thư mục DB.

```env
BIDDING_DB_PATH=/var/lib/biddingflow/database/bidding.db
BIDDING_SQLITE_SINGLE_WRITER=true
BIDDING_BACKUP_DIR=/var/backups/biddingflow
BIDDING_BACKUP_RETENTION_COUNT=14
BIDDING_UPLOAD_DIR=/var/lib/biddingflow/uploads
BIDDING_WORD_TEMPLATE_DIR=/var/lib/biddingflow/word-templates
DOCUMENT_WORKER_TEMP_DIR=/var/tmp/biddingflow-document-worker
BIDDING_LOG_DIR=/var/log/biddingflow
```

Chỉ chạy đúng một ASGI process/instance trên DB này. Khóa `bidding.db.writer.lock` ngăn instance thứ hai khởi động nhầm. Các kết nối và luồng bên trong cùng process vẫn dùng WAL bình thường. DB, backup, upload/template, temp và log nên là các mount/volume riêng theo chính sách lưu giữ tương ứng.

Tài khoản dịch vụ cần đọc/ghi thư mục DB, upload và template; chỉ ghi thư mục backup/log/temp. Không cấp các thư mục runtime qua web server. Backup phải được mã hóa và sao chép ra nơi lưu trữ off-host sau khi tạo.

## 2. Kiểm tra tính toàn vẹn

Chạy hằng ngày và cảnh báo khi exit code khác 0:

```bash
python scripts/check_database.py
```

Lệnh chạy đầy đủ `PRAGMA integrity_check` và `PRAGMA foreign_key_check`. Endpoint `/health/ready` tiếp tục chạy kiểm tra nhẹ khi nhận health check và kiểm tra đầy đủ ở startup.

## 3. Sao lưu online

Không sao chép trực tiếp riêng file `.db` khi ứng dụng đang chạy vì dữ liệu mới có thể còn trong WAL. Dùng SQLite Online Backup API:

```bash
python scripts/backup_database.py
```

Mỗi lần chạy sẽ:

1. thực hiện WAL checkpoint ở chế độ `PASSIVE`;
2. kiểm tra toàn vẹn DB nguồn;
3. tạo snapshot nhất quán vào file tạm rồi đổi tên nguyên tử;
4. kiểm tra toàn vẹn snapshot và tạo metadata `.db.json` gồm SHA-256, schema version và kết quả checkpoint;
5. giữ số bản gần nhất theo `BIDDING_BACKUP_RETENTION_COUNT`.

Lập lịch tối thiểu mỗi ngày; hệ thống có RPO ngắn hơn thì chạy mỗi giờ. Chỉ coi job thành công khi exit code bằng 0 và cả file `.db` lẫn `.db.json` đã được chuyển sang kho off-host. Retention tại máy không thay thế retention của kho off-host.

## 4. Diễn tập phục hồi

Thực hiện định kỳ vào một đường dẫn mới, tuyệt đối không ghi đè DB đang chạy:

```bash
python scripts/restore_database.py \
  --backup /var/backups/biddingflow/bidding-YYYYMMDDTHHMMSS.ffffffZ.db \
  --destination /var/lib/biddingflow-rehearsal/bidding.db

python scripts/check_database.py \
  --database /var/lib/biddingflow-rehearsal/bidding.db
```

Sau đó khởi động một instance cô lập với DB diễn tập, port/config riêng, xác nhận `/health/ready`, đăng nhập và đọc ít nhất một bản ghi ở các nghiệp vụ chính. Ghi lại thời gian phục hồi thực tế, backup được chọn, schema version và kết quả kiểm tra. Xóa môi trường diễn tập theo chính sách dữ liệu sau khi nghiệm thu.

## 5. Phục hồi khi có sự cố

1. Dừng service và xác nhận không còn process BiddingFlow sử dụng DB.
2. Giữ nguyên bằng chứng sự cố: di chuyển cả `.db`, `-wal`, `-shm` và log sang thư mục incident chỉ đọc. Không xóa riêng WAL/SHM.
3. Chọn backup gần nhất có metadata `integrity=ok`; đối chiếu SHA-256 với file thực tế.
4. Phục hồi backup vào một file mới bằng `restore_database.py` và chạy `check_database.py`.
5. Cấp quyền file cho tài khoản service, trỏ `BIDDING_DB_PATH` vào file mới rồi khởi động đúng một instance.
6. Xác nhận `/health/ready`, schema version, đăng nhập, dữ liệu gần nhất và các thao tác đọc/ghi quan trọng trước khi mở traffic.
7. Ghi nhận RPO/RTO thực tế và nguyên nhân sự cố. Chỉ hủy dữ liệu incident sau khi điều tra hoàn tất.

Tùy chọn `--replace` chỉ dành cho DB đã dừng, không có sidecar WAL/SHM và đã có bản sao incident. Phương án an toàn mặc định vẫn là phục hồi sang file mới rồi đổi cấu hình.
