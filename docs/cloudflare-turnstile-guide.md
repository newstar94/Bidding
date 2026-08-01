# Hướng dẫn cấu hình Cloudflare Turnstile

Tài liệu này hướng dẫn cấu hình Cloudflare Turnstile cho BiddingFlow từ local
đến production. Cấu hình đã được chuẩn bị theo hướng tùy chọn: khi dùng
`TURNSTILE_ENABLED=auto`, ứng dụng vẫn hoạt động nếu chưa có đủ key; Turnstile
sẽ tự kích hoạt sau khi có đủ site key, secret key và hostname hợp lệ.

## 1. Turnstile dùng để làm gì?

Cloudflare Turnstile giúp giảm đăng ký tự động, dò mật khẩu, spam OTP và các yêu
cầu quên mật khẩu do bot tạo ra. Đây là một lớp chống bot ở cấp biểu mẫu, không
thay thế rate limit, reverse proxy, WAF hoặc biện pháp chống DDoS ở tầng mạng.

Turnstile thường xác minh trong nền. Với người dùng hợp lệ, widget có thể không
yêu cầu thao tác; thử thách chỉ hiện rõ khi Cloudflare cần thêm tương tác.

Trong ứng dụng hiện tại, Turnstile bảo vệ:

- Đăng ký tài khoản.
- Gửi lại mã xác minh email.
- Yêu cầu quên mật khẩu.
- Xác minh email sau ngưỡng thử lại được cấu hình.
- Đăng nhập sau ngưỡng thử lại được cấu hình.
- Đăng nhập có tín hiệu rủi ro từ tầng edge, nếu tùy chọn nâng cao này được bật.

## 2. Luồng xác minh trong ứng dụng

1. Trình duyệt tải script Turnstile từ `challenges.cloudflare.com`.
2. Widget chạy kiểm tra và tạo một token ngắn hạn.
3. Frontend gửi token cùng yêu cầu đăng nhập, đăng ký hoặc OTP tới backend.
4. Backend gửi token và secret key tới API Siteverify của Cloudflare.
5. Backend kiểm tra kết quả, action và hostname trước khi chấp nhận yêu cầu.

Site key là định danh công khai dùng ở trình duyệt. Secret key chỉ được dùng tại
backend và không được đưa vào mã frontend, Git, tài liệu, ảnh chụp hoặc log.

Mã triển khai chính:

- Frontend: `frontend/auth/TurnstileController.js`.
- Backend: `backend/security/turnstile.py`.
- Vị trí widget: `views/components/auth_overlay.html`.

## 3. Có cần tài khoản Cloudflare và trả phí không?

Production cần một tài khoản Cloudflare riêng để tạo widget và nhận cặp key
thật. Website không bắt buộc phải sử dụng Cloudflare DNS, CDN hoặc proxy mới có
thể dùng Turnstile.

Gói Free hiện phù hợp với phần lớn ứng dụng production, hỗ trợ tối đa 20 widget,
10 hostname cho mỗi widget và không giới hạn lượt challenge. Gói Enterprise chỉ
cần khi cần giới hạn cao hơn hoặc tính năng doanh nghiệp. Luôn kiểm tra lại bảng
giá chính thức trước khi triển khai vì chính sách dịch vụ có thể thay đổi.

Tài liệu chính thức:

- [Bắt đầu với Turnstile](https://developers.cloudflare.com/turnstile/get-started/)
- [Tạo widget bằng Dashboard](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)
- [Các gói Turnstile](https://developers.cloudflare.com/turnstile/plans/)
- [Test key chính thức](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
- [Xác minh token tại backend](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 4. Trạng thái local hiện tại

File `.env` đang dùng cặp test key always-pass chính thức của Cloudflare:

```dotenv
TURNSTILE_ENABLED=auto
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
TURNSTILE_ALLOWED_HOSTNAMES=localhost,127.0.0.1
```

Các key này chỉ dành cho development và test. Chúng không thuộc tài khoản cá
nhân, luôn tạo kết quả có thể dự đoán và không bảo vệ production. Dòng cảnh báo
đỏ “Chỉ để kiểm tra” trong widget là hành vi bình thường khi dùng test key.

Không sử dụng cặp key trên cho staging hoặc production.

## 5. Ý nghĩa các biến môi trường

| Biến | Bắt buộc khi kích hoạt | Ý nghĩa |
| --- | --- | --- |
| `TURNSTILE_ENABLED` | Có | Chế độ `false`, `auto` hoặc `true`. |
| `TURNSTILE_SITE_KEY` | Có | Key công khai do widget Cloudflare cấp. |
| `TURNSTILE_SECRET_KEY` | Có | Key bí mật để backend gọi Siteverify. |
| `TURNSTILE_ALLOWED_HOSTNAMES` | Có | Danh sách hostname chính xác được chấp nhận. |
| `TURNSTILE_VERIFY_TIMEOUT_SECONDS` | Không | Timeout gọi Siteverify; mặc định khuyến nghị là `5`. |
| `TURNSTILE_LOGIN_AFTER_ATTEMPTS` | Không | Số lần thử trước khi đăng nhập yêu cầu Turnstile. |
| `TURNSTILE_VERIFY_AFTER_ATTEMPTS` | Không | Số lần thử trước khi xác minh email yêu cầu Turnstile. |
| `TURNSTILE_EDGE_CHALLENGE_HEADER` | Không | Header rủi ro do edge đáng tin cậy ghi đè. |
| `TURNSTILE_EDGE_CHALLENGE_VALUE` | Không | Giá trị chính xác của header rủi ro. |

Không thêm `https://`, port hoặc đường dẫn vào
`TURNSTILE_ALLOWED_HOSTNAMES`. Ví dụ đúng:

```dotenv
TURNSTILE_ALLOWED_HOSTNAMES=app.example.vn
```

Ví dụ sai:

```dotenv
TURNSTILE_ALLOWED_HOSTNAMES=https://app.example.vn/login
```

Nếu có nhiều hostname, phân tách bằng dấu phẩy:

```dotenv
TURNSTILE_ALLOWED_HOSTNAMES=app.example.vn,www.app.example.vn
```

## 6. Chọn chế độ kích hoạt

| Giá trị | Hành vi |
| --- | --- |
| `false` | Luôn tắt Turnstile, kể cả khi đã có key. |
| `auto` | Đủ và hợp lệ cả ba giá trị key/hostname thì bật; thiếu hoặc sai thì tắt và ứng dụng vẫn chạy. |
| `true` | Bắt buộc Turnstile; cấu hình thiếu hoặc sai làm kiểm tra khởi động thất bại. |

Khuyến nghị ban đầu là `auto`. Sau khi production đã chạy ổn định và có quy
trình quản lý secret, có thể chuyển sang `true` nếu muốn fail closed.

Lưu ý: `auto` ưu tiên tính sẵn sàng nên một lỗi nhập key có thể làm CAPTCHA tự
tắt. Vì vậy phải chạy preflight và smoke test trước khi mở traffic.

## 7. Tạo widget production trên Cloudflare

1. Tạo hoặc đăng nhập tài khoản tại Cloudflare Dashboard.
2. Mở mục **Turnstile**.
3. Chọn **Add widget**.
4. Đặt tên rõ môi trường, ví dụ `BiddingFlow Production`.
5. Trong Hostname Management, thêm domain chính xác, ví dụ
   `app.example.vn`.
6. Chọn widget mode **Managed**.
7. Tạo widget.
8. Sao chép site key và secret key.
9. Lưu secret key vào secret manager hoặc biến môi trường bảo mật của máy chủ.

Nên tạo widget riêng cho staging và production. Không dùng chung key để số liệu,
hostname và việc xoay secret của hai môi trường không ảnh hưởng lẫn nhau.

## 8. Cấu hình production

Template sẵn có nằm tại:

```text
deploy/turnstile/production.env.example
```

Sao chép template thành file environment nằm ngoài repository, ví dụ
`/etc/biddingflow/web.env`. Thay domain ở toàn bộ placeholder, sau đó inject key
thật từ secret manager:

```dotenv
APP_ENV=production
APP_PUBLIC_URL=https://app.example.vn
ALLOWED_HOSTS=app.example.vn
CORS_ORIGINS=https://app.example.vn
ALLOWED_WS_ORIGINS=https://app.example.vn

TURNSTILE_ENABLED=auto
TURNSTILE_SITE_KEY=<site-key-production>
TURNSTILE_SECRET_KEY=<secret-key-production>
TURNSTILE_ALLOWED_HOSTNAMES=app.example.vn
TURNSTILE_VERIFY_TIMEOUT_SECONDS=5
TURNSTILE_LOGIN_AFTER_ATTEMPTS=3
TURNSTILE_VERIFY_AFTER_ATTEMPTS=3
TURNSTILE_EDGE_CHALLENGE_HEADER=
TURNSTILE_EDGE_CHALLENGE_VALUE=
```

Không điền key production vào `.env.example` hoặc
`deploy/turnstile/production.env.example`. Hai file này phải tiếp tục chỉ chứa
placeholder.

Sau khi cập nhật environment, restart dịch vụ để tiến trình đọc cấu hình mới.
Không cần sửa hoặc build lại mã nguồn chỉ để thay domain/key.

## 9. Cấu hình edge-risk tùy chọn

Mặc định giữ trống:

```dotenv
TURNSTILE_EDGE_CHALLENGE_HEADER=
TURNSTILE_EDGE_CHALLENGE_VALUE=
```

Chỉ bật sau khi có Cloudflare Transform Rule đáng tin cậy ghi đè header trên
request đăng nhập đáng ngờ:

```dotenv
TURNSTILE_EDGE_CHALLENGE_HEADER=X-BiddingFlow-Edge-Risk
TURNSTILE_EDGE_CHALLENGE_VALUE=challenge
```

Không bật chỉ bằng cách tin header do client gửi. Nếu origin nhận trực tiếp
traffic Internet hoặc proxy không ghi đè header, kẻ tấn công có thể tự tạo giá
trị này. Tùy chọn này chỉ tăng mức yêu cầu challenge, không thay thế firewall,
rate limit hoặc xác thực.

## 10. Kiểm tra trước khi mở production

Chạy bộ kiểm thử bảo mật trong repository:

```bash
npm run test:security-deploy
```

Trên máy chủ production, chạy preflight với các file thật:

```bash
python scripts/check_security_deployment.py \
  --environment-file /etc/biddingflow/web.env \
  --cloudflared-config /etc/cloudflared/config.yml \
  --nginx-config /etc/nginx/conf.d/biddingflow.conf \
  --systemd-unit /etc/systemd/system/biddingflow.service \
  --postgres-max-connections "$POSTGRES_MAX_CONNECTIONS"
```

Sau khi restart, smoke test lần lượt:

1. Mở trang bằng đúng domain production.
2. Đăng ký một tài khoản thử nghiệm.
3. Thử gửi lại OTP.
4. Thử luồng quên mật khẩu.
5. Nhập sai mật khẩu đủ ngưỡng để kiểm tra adaptive login.
6. Xác nhận không còn dòng cảnh báo test key màu đỏ.
7. Xác nhận request hợp lệ thành công và token lỗi bị backend từ chối.
8. Kiểm tra log/metrics nhưng không ghi token hoặc secret ra output.

Vì giao diện dùng `appearance: "interaction-only"`, widget có thể chỉ hiện trạng
thái xác minh hoặc chỉ mở thử thách khi cần. Việc không thấy ô checkbox thường
trực không đồng nghĩa Turnstile đang tắt.

## 11. Cách xác nhận Turnstile đã kích hoạt

Có thể kiểm tra theo các dấu hiệu sau:

- Site key production được trả về trong cấu hình công khai của trang.
- Trình duyệt tải tài nguyên từ `challenges.cloudflare.com`.
- Form cần bảo vệ nhận token trước khi gửi.
- Backend gọi Siteverify và ghi outcome vào metric
  `biddingflow_turnstile_validations_total`.
- Cloudflare Dashboard bắt đầu hiển thị analytics của widget.

Không dùng việc tìm secret key trong HTML để kiểm tra. Secret key không được
phép xuất hiện ở trình duyệt.

## 12. Lỗi thường gặp

### CAPTCHA không xuất hiện

Nguyên nhân thường gặp:

- `TURNSTILE_ENABLED=auto` nhưng thiếu site key, secret key hoặc hostname.
- Dịch vụ chưa restart sau khi thay environment.
- Trang đang mở không thuộc hostname đã khai báo.
- Trình chặn quảng cáo hoặc chính sách mạng chặn `challenges.cloudflare.com`.
- Widget đã xác minh nền nên chưa cần hiển thị tương tác.

Kiểm tra environment của đúng tiến trình đang chạy và xem kết quả preflight.

### Vẫn thấy cảnh báo “Chỉ để kiểm tra”

Ứng dụng vẫn đang dùng test site key. Thay đồng thời cả site key và secret key
bằng cặp production cùng một widget, sau đó restart dịch vụ và tải lại trang.

### Báo domain không được phép

Đảm bảo domain đang truy cập đã được thêm vào Hostname Management của widget và
khớp với `TURNSTILE_ALLOWED_HOSTNAMES`. Không nhập scheme hoặc đường dẫn.

### Frontend xác minh nhưng backend từ chối

Kiểm tra:

- Site key và secret key có thuộc cùng một widget không.
- Có trộn test key với production key không.
- Hostname và action có đúng không.
- Token có bị dùng lại hoặc hết hạn không.
- Máy chủ có kết nối HTTPS tới `challenges.cloudflare.com` không.

### Cloudflare hoặc mạng tạm thời không khả dụng

Khi Turnstile đã bật và một action bắt buộc challenge, backend từ chối action đó
nếu không xác minh được. Đây là hành vi an toàn. Theo dõi outcome `unavailable`
và chỉ rollback theo quy trình dưới đây khi cần duy trì dịch vụ.

## 13. Rollback hoặc tắt tạm thời

Để tắt rõ ràng:

```dotenv
TURNSTILE_ENABLED=false
```

Sau đó restart dịch vụ và tăng cường rate limit/WAF trong thời gian CAPTCHA tắt.

Nếu giữ `auto`, có thể bỏ cấu hình key để Turnstile tự tắt, nhưng cách này dễ bị
nhầm với lỗi cấu hình. Khi xử lý sự cố, dùng `false` sẽ thể hiện chủ đích rõ hơn.

Không xóa widget hoặc rotate secret ngay trong lúc sự cố nếu chưa xác định
nguyên nhân; hành động đó có thể làm việc phục hồi phức tạp hơn.

## 14. Bảo quản và xoay secret

- Chỉ lưu `TURNSTILE_SECRET_KEY` trong secret manager/environment của backend.
- Không gửi secret qua email, ticket, Markdown, ảnh chụp hoặc chat.
- Giới hạn quyền đọc secret cho đúng service account.
- Xoay secret định kỳ hoặc ngay khi nghi ngờ bị lộ.
- Sau khi rotate, cập nhật secret manager, restart/rollout dịch vụ và smoke test.
- Xác nhận key cũ hết hiệu lực sau cửa sổ chuyển đổi của Cloudflare.

Nếu secret từng được commit, xóa khỏi commit hiện tại là chưa đủ. Cần rotate
secret trên Cloudflare và xử lý lịch sử Git theo quy trình phản ứng sự cố.

## 15. Checklist triển khai nhanh

- [ ] Có tài khoản Cloudflare do tổ chức sở hữu.
- [ ] Đã tạo widget `BiddingFlow Production` ở chế độ Managed.
- [ ] Widget chỉ allow đúng hostname production.
- [ ] Site key và secret key thuộc cùng widget.
- [ ] Secret key được lưu ngoài repository.
- [ ] `TURNSTILE_ALLOWED_HOSTNAMES` không chứa scheme/path/wildcard.
- [ ] Không dùng test key trên production.
- [ ] Đã chạy `npm run test:security-deploy`.
- [ ] Đã chạy production security preflight.
- [ ] Đã restart dịch vụ sau khi cập nhật environment.
- [ ] Đã smoke test đăng ký, OTP, quên mật khẩu và adaptive login.
- [ ] Đã xác nhận Dashboard/metrics nhận lượt xác minh.
- [ ] Có người chịu trách nhiệm rotate key và xử lý sự cố.

## 16. Các file liên quan

- `.env`: cấu hình local hiện tại.
- `.env.example`: danh sách biến và placeholder dùng chung.
- `deploy/turnstile/local.env.example`: cấu hình test local.
- `deploy/turnstile/staging.env.example`: overlay staging.
- `deploy/turnstile/production.env.example`: overlay production.
- `docs/production-security-information.md`: phiếu thông tin cần thu thập.
- `docs/security-ddos-captcha-plan.md`: kế hoạch bảo mật tổng thể.
- `docs/runbooks/ddos-bot-abuse.md`: runbook xử lý bot/DDoS.
- `deploy/README.md`: quy trình triển khai và preflight đầy đủ.

