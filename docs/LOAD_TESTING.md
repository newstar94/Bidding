# Mixed load, burst, recovery và soak test

Bộ kiểm thử này tạo bằng chứng capacity qua HTTP/WebSocket thật trên **môi trường staging hoặc performance cô lập**. Nó không được phép chạy vào production: script từ chối `BF_LOAD_ENVIRONMENT=production`, yêu cầu xác nhận đúng tên profile và xác nhận đúng hostname đối với mọi đích không phải localhost.

## Phạm vi đo

Profile `mixed-100.json` phát workload bằng 100 session riêng trong 35 phút. Đây là mô hình tải kỹ thuật, **không tự chứng minh có 100 con người đang tương tác đồng thời**: arrival-rate executor có thể dùng nhiều VU để giữ nhịp, còn mỗi con người có think time và chuỗi thao tác khác nhau. Muốn tuyên bố mức "100 người dùng hoạt động", phải hiệu chỉnh mix/rate/think time từ telemetry sử dụng thật và đối chiếu số phiên đang hoạt động phía máy chủ.

- đăng nhập rồi đăng xuất để đo PBKDF2/session mà không để session rác;
- pagination có phân quyền;
- transaction sync ghi qua write lane;
- upload Word template;
- xuất Word sau `GET /api/sync-version` có xác thực để lấy `snapshotVersion` bằng DB read lane, không tạo transaction/version rỗng; retry đúng một lần nếu có concurrent write và đo riêng tỷ lệ snapshot conflict;
- WebSocket có xác thực, giữ kết nối và trả lời heartbeat;
- probe `/health/live` riêng trong giai đoạn recovery sau burst.

Gate mặc định kiểm tra tỷ lệ 5xx, 429, lỗi ngoài dự kiến, dropped iterations, p95/p99 của read/sync/export và health recovery. k6 trả exit code khác `0` khi bất kỳ threshold nào thất bại. `soak-100.json` kéo dài steady state một giờ và tắt login/upload để hạn chế thay đổi file kéo dài.

Đây là network load test; nó không tự thu RAM, kích thước WAL, CPU, file descriptor hay queue depth trên máy chủ. Khi chạy thật, phải thu đồng thời các số đó từ host/metrics stack và ghép timestamp với file summary để lập capacity envelope.

## 1. Dry-run trong CI, không gửi network

Lệnh sau chỉ đọc/kiểm tra JSON và sinh execution plan đã loại bỏ credential. Nó không import ứng dụng, không mở socket và không gọi HTTP:

```powershell
python scripts/validate_load_profile.py load/profiles/mixed-100.json --output artifacts/load/mixed-100-plan.json
```

Exit code là `0` khi profile hợp lệ và `2` khi cấu hình không hợp lệ. Có thể kiểm tra cả profile soak tương tự:

```powershell
python scripts/validate_load_profile.py load/profiles/soak-100.json
```

## 2. Chuẩn bị dữ liệu staging

Chỉ dùng bản sao dữ liệu không chứa dữ liệu cá nhân thật. Tạo service accounts theo đúng ma trận quyền cần đo. Mỗi session phải khác nhau; profile yêu cầu 100 cookie riêng để tránh tái sử dụng một phiên, nhưng số cookie này không đồng nghĩa 100 con người hoạt động. Không commit hai file dưới đây; toàn bộ `load/secrets/` đã được ignore.

`load/secrets/sessions.json`:

```json
{
  "sessions": [
    {
      "cookie": "session_token=<STAGING_SESSION_TOKEN>",
      "organizationId": "<STAGING_ORGANIZATION_ID>",
      "packageId": "<READABLE_STAGING_PACKAGE_ID>",
      "planId": "<READABLE_STAGING_PLAN_ID>"
    }
  ]
}
```

`load/secrets/login-users.json`:

```json
{
  "users": [
    {
      "username": "<STAGING_LOAD_USERNAME>",
      "password": "<STAGING_LOAD_PASSWORD>"
    }
  ]
}
```

Nhân các entry bằng tài khoản/session staging riêng, không lặp token hoặc username. Profile mixed cần ít nhất 10 username để tránh một tài khoản làm sai kết quả rate-limit đăng nhập.

Chuẩn bị thêm:

- một `.docx` hợp lệ, không chứa dữ liệu thật, cho `BF_UPLOAD_FIXTURE`;
- tùy chọn một JSON sync fixture đại diện cho batch nghiệp vụ qua `BF_SYNC_FIXTURE`;
- snapshot/backup staging trước test vì upload thay template của service account và sync luôn tạo một transaction/version mới.

Nếu không đặt `BF_SYNC_FIXTURE`, profile dùng payload an toàn `{"includeDashboardSummary": false}`. Payload này đo lock/write-lane và thông báo sync nhưng không đại diện write amplification của batch dữ liệu; capacity gate cuối cùng nên dùng fixture có kích thước và quan hệ gần production.

Xác thực đầy đủ runtime inputs mà vẫn **không gửi network**:

```powershell
python scripts/validate_load_profile.py load/profiles/mixed-100.json `
  --runtime-inputs `
  --sessions-file load/secrets/sessions.json `
  --login-users-file load/secrets/login-users.json `
  --upload-fixture C:\load-fixtures\safe-template.docx `
  --sync-fixture C:\load-fixtures\representative-sync.json `
  --output artifacts/load/mixed-100-runtime-plan.json
```

Output chỉ chứa số lượng session/user và kích thước fixture; không chứa token, username, password, organization ID, record ID hoặc target URL.

## 3. Chạy production-like trên staging/performance

Cài k6 trên máy phát tải riêng, đồng bộ giờ giữa load generator và server, sau đó cấu hình rõ ba lớp xác nhận:

```powershell
$env:BF_BASE_URL = 'https://performance.example.internal'
$env:BF_LOAD_ENVIRONMENT = 'performance'
$env:BF_LOAD_TARGET_ACK = 'performance.example.internal'
$env:BF_LOAD_RUN_ACK = 'mixed-100-burst-recovery'
$env:BF_LOAD_PROFILE = '../profiles/mixed-100.json'
$env:BF_SESSIONS_FILE = '../../load/secrets/sessions.json'
$env:BF_LOGIN_USERS_FILE = '../../load/secrets/login-users.json'
$env:BF_UPLOAD_FIXTURE = 'C:\load-fixtures\safe-template.docx'
$env:BF_SYNC_FIXTURE = 'C:\load-fixtures\representative-sync.json'
$env:BF_SUMMARY_PATH = 'mixed-100-summary.json'

k6 run load/k6/mixed_load.js
if ($LASTEXITCODE -ne 0) { throw "Capacity/SLO gate failed" }
```

Các đường dẫn truyền cho `open()` được k6 resolve tương đối theo file `load/k6/mixed_load.js`; dùng đường dẫn tuyệt đối nếu load generator có layout khác. Với đích HTTP nội bộ không có TLS, phải thêm `BF_LOAD_ALLOW_HTTP=1`; chỉ làm vậy trong mạng performance cô lập.

Script không in base URL, cookie hay credential trong custom summary. Không bật HTTP debug (`--http-debug`) và không đưa secret vào tag, tên file artifact hoặc command history dùng chung.

## 4. Kết quả máy đọc và capacity envelope

`BF_SUMMARY_PATH` nhận JSON có schema version, verdict `passed`, tải cấu hình, thresholds và các metric chính. Lưu cùng:

- commit/release identifier và schema version;
- số instance, Uvicorn/Nginx limits, DB engine/pool/queue limits;
- CPU/RAM/disk/IOPS của app và database;
- peak/steady QPS, số WebSocket, p95/p99, 5xx, 429 và dropped iterations;
- peak RAM, WAL bytes/checkpoint, file descriptors, queue depth;
- thời gian health phục hồi sau burst và tình trạng dữ liệu/sync sau test.

Không nâng capacity envelope chỉ vì k6 chạy hết thời gian. Chỉ ghi nhận mức workload đã đạt khi exit code là `0`, `passed=true`, không mất dữ liệu/outbox, không có queue hoặc WAL tăng không hồi phục, và tài nguyên còn headroom đã thống nhất. `100 distinct sessions` chỉ là điều kiện cô lập phiên của phép thử; nó không phải bằng chứng độc lập cho `100 active humans`. Mỗi thay đổi pool size, instance count, DB engine hoặc cấu hình ingress phải tạo một kết quả mới thay vì ghi đè artifact cũ.

## Hạn chế hiện tại

Repository đã có harness, profile, dry-run validation và SLO gate; chưa có bằng chứng tải thực tế vì việc đó cần server staging/performance, 100 session riêng, fixture hợp lệ và metrics hạ tầng. Do đó chưa được đánh dấu capacity gate hay mốc 100 concurrent users là đạt chỉ dựa trên các file này.
