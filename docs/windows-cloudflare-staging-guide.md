# Chia sẻ BiddingFlow từ máy Windows qua Cloudflare Tunnel

Tài liệu này hướng dẫn dùng chính máy Windows đang phát triển BiddingFlow làm máy chủ thử nghiệm cho khoảng 3–4 người ở các mạng Internet khác nhau.

Mô hình triển khai:

```text
Người dùng thử
    ↓ HTTPS
Cloudflare Access (giới hạn email)
    ↓ Cloudflare Tunnel
127.0.0.1:8000 trên máy Windows
    ↓
PostgreSQL cục bộ trên cùng máy
```

Cloudflare Tunnel tạo kết nối đi ra từ máy chủ tới Cloudflare. Không cần mở cổng `8000`, `5432` hoặc `55432` trên router và không công khai PostgreSQL ra Internet.

## 1. Điều kiện cần có

- Máy Windows có Internet ổn định và được phép chạy liên tục.
- Một tên miền đang được quản lý trong tài khoản Cloudflare.
- Quyền quản trị Windows để cài `cloudflared` thành Windows Service.
- Danh sách chính xác 3–4 email được phép truy cập.
- BiddingFlow và PostgreSQL đang hoạt động bình thường trên máy.

Nếu chưa có tên miền trên Cloudflare, không thể tạo hostname cố định theo hướng dẫn này. Có thể dùng Quick Tunnel để kiểm tra rất ngắn, nhưng không nên dùng để mời người dùng thử lâu dài vì địa chỉ thay đổi và không có cấu hình Access ổn định như Named Tunnel.

## 2. Sao lưu trước khi chia sẻ

Người dùng thử sẽ thao tác trên dữ liệu dùng chung. Trước khi cấu hình public hostname, mở PowerShell tại `D:\Bidding` và chạy:

```powershell
python scripts/backup.py create
```

Sau đó xác định snapshot vừa tạo và kiểm tra:

```powershell
python scripts/backup.py verify --snapshot <duong-dan-snapshot>
```

Nên dùng một database thử nghiệm riêng nếu dữ liệu phát triển hiện tại cần được bảo toàn tuyệt đối.

## 3. Chọn hostname thử nghiệm

Ví dụ tài liệu sử dụng:

```text
https://thu-nghiem.example.com
```

Thay toàn bộ `thu-nghiem.example.com` bên dưới bằng hostname thật. Không thêm đường dẫn phía sau và không thêm dấu `/` ở cuối `APP_PUBLIC_URL`.

## 4. Cấu hình `.env` của BiddingFlow

Sao lưu file môi trường trước khi sửa:

```powershell
Copy-Item .env .env.before-staging
```

Cập nhật các biến sau trong `D:\Bidding\.env`:

```dotenv
APP_HOST=127.0.0.1
APP_PORT=8000
APP_ENV=staging
APP_PUBLIC_URL=https://thu-nghiem.example.com
APP_SECURE_COOKIES=True

ALLOWED_HOSTS=thu-nghiem.example.com
CORS_ORIGINS=https://thu-nghiem.example.com
ALLOWED_WS_ORIGINS=https://thu-nghiem.example.com

DATABASE_AUTO_START_LOCAL=true
```

Giải thích:

- Giữ `APP_HOST=127.0.0.1`; chỉ `cloudflared` trên cùng máy được kết nối tới BiddingFlow.
- Không đổi thành `0.0.0.0` nếu chỉ chia sẻ qua Tunnel.
- `APP_PUBLIC_URL`, `CORS_ORIGINS` và `ALLOWED_WS_ORIGINS` phải cùng một HTTPS origin.
- `ALLOWED_HOSTS` chỉ chứa hostname, không chứa `https://` và không chứa đường dẫn.
- `APP_SECURE_COOKIES=True` là bắt buộc vì người dùng truy cập qua HTTPS.
- `DATABASE_AUTO_START_LOCAL=true` cho phép lifecycle development/staging khởi động PostgreSQL cục bộ. Nếu PostgreSQL được quản lý bằng service riêng, có thể đặt `false`.

Không gửi file `.env` cho người dùng và không commit file này lên Git.

## 5. Khởi động và kiểm tra BiddingFlow cục bộ

Mở PowerShell tại `D:\Bidding`:

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-proxy-headers
```

Mở một cửa sổ PowerShell khác để kiểm tra:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health/live -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8000/health/ready -UseBasicParsing
```

Cả hai request phải thành công trước khi tạo Tunnel. Nếu ứng dụng báo lỗi khởi động PostgreSQL, xử lý PostgreSQL trước; Tunnel không sửa được lỗi database cục bộ.

## 6. Tạo Cloudflare Access trước khi công bố Tunnel

Nên tạo Access Application trước Published Application Route để hostname không có khoảng thời gian bị mở cho tất cả người dùng Internet.

Trong Cloudflare Zero Trust:

1. Mở **Access controls → Applications**.
2. Chọn **Create application**.
3. Chọn ứng dụng **Self-hosted** hoặc **Self-hosted and private** tùy giao diện hiện tại.
4. Thêm public hostname `thu-nghiem.example.com`.
5. Tạo policy:
   - Action: `Allow`.
   - Include: `Emails`.
   - Nhập chính xác 3–4 email được phép sử dụng.
6. Không chọn `Everyone` và không cho phép toàn bộ email hợp lệ.
7. Có thể dùng phương thức đăng nhập One-time PIN qua email nếu chưa cấu hình Google/Microsoft làm identity provider.
8. Chọn thời hạn phiên phù hợp, ví dụ 8 hoặc 12 giờ.
9. Lưu application và policy.

Cloudflare Access là lớp bảo vệ ngoài. Mỗi người vẫn cần một tài khoản BiddingFlow riêng bên trong ứng dụng.

## 7. Cài `cloudflared` trên Windows

Tải bản Windows 64-bit mới nhất từ tài liệu Cloudflare Tunnel chính thức. Có thể cài bằng `winget` nếu gói khả dụng trên máy:

```powershell
winget install --id Cloudflare.cloudflared
```

Kiểm tra:

```powershell
cloudflared --version
```

Nếu không dùng `winget`, tải `cloudflared-windows-amd64.exe`, đặt tại:

```text
C:\Cloudflared\bin\cloudflared.exe
```

Không tải executable từ nguồn không chính thức.

## 8. Tạo Named Tunnel

Trong Cloudflare Dashboard:

1. Mở **Networking → Tunnels**.
2. Chọn **Create Tunnel**.
3. Đặt tên, ví dụ `biddingflow-staging-windows`.
4. Chọn môi trường Windows.
5. Cloudflare sẽ cung cấp lệnh có tunnel token.

Mở Command Prompt hoặc PowerShell bằng quyền Administrator và chạy lệnh do Cloudflare cung cấp, thường có dạng:

```powershell
cloudflared.exe service install <TUNNEL_TOKEN>
```

Tunnel token là secret. Không ghi token vào tài liệu, ảnh chụp, Git hoặc tin nhắn nhóm. Nếu token bị lộ, xóa/rotate tunnel credential trong Cloudflare.

## 9. Trỏ hostname về BiddingFlow

Trong tunnel vừa tạo:

1. Chọn **Routes → Add route → Published application**.
2. Hostname: `thu-nghiem.example.com`.
3. Service type: `HTTP`.
4. Service URL:

```text
http://127.0.0.1:8000
```

5. Bật **Protect with Access** nếu Cloudflare hiển thị lựa chọn này.
6. Lưu route.

Không cấu hình service URL là PostgreSQL và không tạo route cho cổng `5432` hoặc `55432`.

## 10. Kiểm tra Windows Service

Mở PowerShell bằng quyền Administrator:

```powershell
Get-Service cloudflared
```

Nếu service chưa chạy:

```powershell
Start-Service cloudflared
```

Đặt service tự khởi động cùng Windows nếu trình cài chưa thực hiện:

```powershell
Set-Service cloudflared -StartupType Automatic
```

Kiểm tra log bằng Event Viewer hoặc lệnh cấu hình/log tương ứng của phiên bản `cloudflared` đã cài.

## 11. Kiểm tra từ một mạng Internet khác

Không chỉ kiểm tra trên chính máy chủ. Dùng điện thoại tắt Wi-Fi hoặc một máy ở mạng khác:

1. Mở `https://thu-nghiem.example.com`.
2. Xác nhận Cloudflare Access yêu cầu xác thực email.
3. Email không nằm trong allowlist phải bị từ chối.
4. Email được phép phải đi tới màn hình đăng nhập BiddingFlow.
5. Đăng nhập bằng tài khoản BiddingFlow riêng.
6. Kiểm tra:
   - tải trang và đăng nhập;
   - chuyển workspace/đơn vị;
   - tạo một dữ liệu thử nghiệm;
   - cập nhật đồng thời từ hai trình duyệt;
   - WebSocket/thông báo và đồng bộ;
   - tra cứu Mua Sắm Công nếu tính năng được bật;
   - tải lên/xuất Word hoặc Excel nếu nằm trong phạm vi thử nghiệm.

Sau đó kiểm tra trực tiếp:

```text
https://thu-nghiem.example.com/health/live
https://thu-nghiem.example.com/health/ready
```

Nếu health endpoint cũng được Access bảo vệ thì đó là hành vi bình thường đối với hostname staging.

## 12. Tạo tài khoản cho người dùng thử

Khuyến nghị:

- Tạo một tổ chức thử nghiệm riêng.
- Mỗi người có tài khoản riêng; không dùng chung tài khoản admin.
- Chỉ cấp vai trò và quyền cần thiết.
- Dùng dữ liệu giả hoặc dữ liệu đã được phép chia sẻ.
- Không gửi mật khẩu trong cùng tin nhắn chứa URL ứng dụng.
- Thu hồi tài khoản và xóa email khỏi Cloudflare Access khi kết thúc thử nghiệm.

Cloudflare Access chỉ kiểm soát ai tới được trang web. Quyền đọc/ghi dữ liệu vẫn do tài khoản và phân quyền BiddingFlow quyết định.

## 13. Giữ máy chủ hoạt động

Máy chủ phải luôn bật, kết nối Internet và không Sleep. Trong Windows:

1. Mở **Settings → System → Power & battery**.
2. Khi cắm điện, đặt Sleep thành `Never` trong thời gian thử nghiệm.
3. Có thể cho màn hình tắt; không để hệ thống Sleep/Hibernate.
4. Nên dùng kết nối Ethernet nếu có.
5. Cấu hình Windows Update tránh tự khởi động lại giữa giờ người dùng thử.

Cần bảo đảm ba thành phần đang chạy:

- PostgreSQL;
- BiddingFlow/Uvicorn;
- Windows Service `cloudflared`.

Nếu một trong ba thành phần dừng, người dùng sẽ không sử dụng được ứng dụng.

## 14. Khởi động BiddingFlow tự động

Cloudflare Tunnel có thể chạy dưới dạng Windows Service, nhưng BiddingFlow cũng cần tự khởi động. Có thể dùng Task Scheduler:

1. Tạo task `BiddingFlow Staging`.
2. Trigger: `At startup` hoặc `At log on`.
3. Chọn **Run whether user is logged on or not**.
4. Action:
   - Program: `powershell.exe`.
   - Arguments:

```text
-NoProfile -ExecutionPolicy Bypass -File D:\Bidding\scripts\run_demo_server.ps1
```

   - Start in:

```text
D:\Bidding
```

5. Bật tự khởi động lại khi task lỗi (khuyến nghị sau 1 phút, tối thiểu 3 lần) và
   `Start the task as soon as possible after a scheduled start is missed`.

Script supervisor đọc release ID từ secure artifact, ép `APP_DEBUG=False`, dùng frontend bundle,
ghi stdout/stderr theo từng lần chạy vào `data/logs` và từ chối khởi động nếu cổng 8000 bị một tiến
trình không healthy chiếm giữ. Không chạy trực tiếp `python backend/app.py` song song với task; nếu
health đã xanh thì script thoát thành công thay vì tạo lỗi `WinError 10048`.

Nếu tài khoản Windows không có quyền đăng ký Task Scheduler, có thể dùng khóa `Run` theo người dùng;
script đã tự giám sát và khởi động lại child process sau 5 giây:

```powershell
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
  -Name 'BiddingFlowDemo' `
  -Value 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\Bidding\scripts\run_demo_server.ps1"' `
  -PropertyType String -Force
```

Không dùng `--reload` cho phiên dùng thử từ xa. Reloader cố ý khởi động hai process và restart server
khi source thay đổi, nên người dùng bên ngoài sẽ quan sát thấy gián đoạn giống crash.

## 15. Firewall và router

Với mô hình Tunnel:

- Không port-forward cổng `8000` trên router.
- Không mở inbound Internet cho `8000`, `5432` hoặc `55432`.
- Có thể giữ Windows Firewall chặn inbound các cổng này.
- `cloudflared` chỉ cần kết nối outbound tới Cloudflare.

Nếu router đã có port-forward cũ, hãy xóa port-forward đó trước khi mời người dùng.

## 16. Kiểm tra vận hành hằng ngày

Trước giờ dùng thử:

```powershell
Get-Service cloudflared
Invoke-WebRequest http://127.0.0.1:8000/health/live -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:8000/health/ready -UseBasicParsing
```

Kiểm tra dung lượng đĩa:

```powershell
Get-PSDrive D
```

Tạo backup định kỳ trong thời gian thử nghiệm:

```powershell
python scripts/backup.py create
```

Không coi đồng bộ trình duyệt hoặc IndexedDB là backup database.

## 17. Xử lý lỗi thường gặp

### Cloudflare hiển thị 502/Bad Gateway

- BiddingFlow chưa chạy tại `127.0.0.1:8000`.
- Cổng trong Tunnel route không đúng.
- Uvicorn khởi động thất bại do PostgreSQL.

Kiểm tra:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health/ready -UseBasicParsing
```

### BiddingFlow báo `Invalid host header` hoặc TrustedHost

Kiểm tra:

```dotenv
ALLOWED_HOSTS=thu-nghiem.example.com
```

Không thêm scheme vào `ALLOWED_HOSTS`.

### Đăng nhập hoặc ghi dữ liệu báo lỗi Origin/CSRF

Ba biến phải dùng cùng exact origin:

```dotenv
APP_PUBLIC_URL=https://thu-nghiem.example.com
CORS_ORIGINS=https://thu-nghiem.example.com
ALLOWED_WS_ORIGINS=https://thu-nghiem.example.com
```

Khởi động lại BiddingFlow sau khi sửa `.env`.

### Đăng nhập lặp lại hoặc cookie không được lưu

Kiểm tra:

```dotenv
APP_SECURE_COOKIES=True
```

Chỉ truy cập bằng URL HTTPS chính thức, không trộn URL IP/localhost với hostname staging.

### Tra cứu Mua Sắm Công không hoạt động

- Lookup/import mặc định bật; nếu không hoạt động, xác nhận deployment không đặt
  `PROCUREMENT_LOOKUP_ENABLED=false` hoặc `PROCUREMENT_IMPORT_ENABLED=false`.
- Chromium của Playwright phải được cài trên máy chạy BiddingFlow.
- Máy chủ phải truy cập được `muasamcong.mpi.gov.vn` qua TLS.
- Kiểm tra khóa `MUASAMCONG_RECAPTCHA_SITE_KEY` trong `.env` theo cấu hình hiện hành.

### Người dùng ngoài danh sách vẫn truy cập được

- Kiểm tra Access Application gắn đúng hostname.
- Không dùng policy `Include Everyone`.
- Không dùng policy cho phép mọi email hợp lệ.
- Bật `Protect with Access` trên route nếu có.
- Xóa session Access cũ khi kiểm tra thay đổi policy.

## 18. Kết thúc đợt thử nghiệm

1. Vô hiệu hóa hoặc xóa Published Application Route.
2. Gỡ email người thử khỏi Access policy.
3. Khóa/ngừng hoạt động tài khoản BiddingFlow thử nghiệm.
4. Tạo và kiểm tra backup cuối kỳ.
5. Dừng tunnel nếu không còn dùng:

```powershell
Stop-Service cloudflared
```

6. Khôi phục `.env` nếu cần:

```powershell
Copy-Item .env.before-staging .env -Force
```

7. Khởi động lại BiddingFlow để áp dụng cấu hình cũ.

## 19. Checklist ngắn

- [ ] Đã có domain trên Cloudflare.
- [ ] Đã backup và verify database.
- [ ] BiddingFlow chỉ lắng nghe `127.0.0.1:8000`.
- [ ] `.env` dùng đúng HTTPS hostname staging.
- [ ] Đã tạo Access Application và allowlist đúng email.
- [ ] Đã tạo Named Tunnel và route về `http://127.0.0.1:8000`.
- [ ] `cloudflared` chạy dưới dạng Windows Service.
- [ ] Không mở port router/firewall cho ứng dụng hoặc PostgreSQL.
- [ ] Đã kiểm tra bằng mạng Internet khác.
- [ ] Mỗi người có tài khoản BiddingFlow riêng.
- [ ] Máy không Sleep trong thời gian thử nghiệm.
- [ ] Có lịch backup và kế hoạch thu hồi quyền sau thử nghiệm.

## Tài liệu liên quan trong repository

- `README.md`
- `.env.example`
- `deploy/README.md`
- `deploy/cloudflared/config.yml.example`
- `deploy/turnstile/staging.env.example`
- `docs/cloudflare-turnstile-guide.md`

Tài liệu Cloudflare chính thức:

- Cloudflare Tunnel setup: <https://developers.cloudflare.com/tunnel/setup/>
- Chạy Cloudflare Tunnel dưới dạng Windows Service: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/windows/>
- Bảo vệ self-hosted application bằng Access: <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/>
- Access policies: <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/>
