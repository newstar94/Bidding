# Hướng dẫn đăng ký webhook payOS cho BiddingFlow

- Cập nhật: **2026-08-27**
- Provider profile: `provider-payos-production-v2`
- Tài liệu này chỉ hướng dẫn kết nối webhook và rollout thanh toán. Không thay đổi
  quyền, phạm vi truy cập, cách hiển thị dữ liệu hoặc 27 nội dung legal.

## 1. URL cần đăng ký

URL theo cấu hình chung:

```text
{APP_PUBLIC_URL}/api/billing/providers/provider-payos-production-v2/webhook
```

Với `APP_PUBLIC_URL` hiện tại của dự án, URL đầy đủ là:

```text
https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook
```

Chỉ đăng ký URL HTTPS này. Không đăng ký `returnUrl`, `cancelUrl`, trang chủ hoặc
URL có dấu `/` thừa ở cuối thay cho endpoint trên.

## 2. Blocker hiện tại: Cloudflare Access đang chặn webhook

Kiểm tra cả `HEAD` và `POST application/json` từ Internet ngày 2026-08-27 cho
thấy endpoint trên đang trả:

```text
HTTP/1.1 302 Found
Www-Authenticate: Cloudflare-Access
Location: https://...cloudflareaccess.com/cdn-cgi/access/login/...
```

payOS gọi webhook bằng máy chủ, không có phiên đăng nhập Cloudflare Access. Vì vậy
payOS chưa thể xác nhận URL ở trạng thái hiện tại.

Cần tạo ngoại lệ public cho **đúng một path** sau trong Cloudflare Zero Trust:

```text
/api/billing/providers/provider-payos-production-v2/webhook
```

Một cách triển khai phù hợp:

1. Mở **Cloudflare Zero Trust → Access controls → Applications**.
2. Tạo một Self-hosted application riêng cho hostname
   `demo.hosodauthau.online` và path chính xác ở trên, hoặc chỉnh application hiện
   có nếu giao diện tài khoản cho phép policy theo path.
3. Tạo policy action **Bypass** cho endpoint này và áp dụng cho mọi request tới
   đúng path webhook.
4. Đặt application/path webhook có độ ưu tiên cụ thể hơn application đang bảo vệ
   toàn hostname.
5. Không bypass toàn bộ `/api`, không bypass toàn hostname và không tắt Access
   cho các trang còn lại.
6. Bảo đảm WAF/Bot protection không CAPTCHA, JavaScript Challenge, chuyển hướng,
   cache hoặc đổi body của request `POST` tại path này.

Cloudflare xác nhận đây là use case chính thức của policy **Bypass → Include →
Everyone** cho webhook receiver/public endpoint. Khi có nhiều application cùng
hostname, path cụ thể hơn được ưu tiên hơn rule ở root. Xem
[Bypass public endpoint][cloudflare-bypass] và
[Access application paths][cloudflare-paths].

Việc public endpoint không bỏ xác thực thanh toán: backend vẫn kiểm tra chữ ký
HMAC-SHA256 bằng `PAYOS_CHECKSUM_KEY` trước khi lưu sự kiện. Public docs của payOS
không công bố dải IP webhook ổn định; không tự tạo IP allowlist dựa trên địa chỉ
quan sát tạm thời.

Sau khi sửa Cloudflare, kiểm tra lại từ một máy không đăng nhập Access:

```powershell
curl.exe -i -X POST `
  "https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook" `
  -H "Content-Type: application/json" `
  --data "{}"
```

Kết quả đúng ở bước dò đường là response trực tiếp từ BiddingFlow, thường là
`400` do payload không có dữ liệu/chữ ký hợp lệ. Không được còn `302`, trang HTML
đăng nhập Cloudflare, CAPTCHA, `403` của WAF hoặc chuyển hướng sang URL khác.

## 3. Chuẩn bị ứng dụng trước khi xác nhận trên payOS

### 3.1. Database và deployment

1. Deploy phiên bản có payOS integration.
2. Chạy migration để database đạt schema **v80**.
3. Xác nhận profile `provider-payos-production-v2` tồn tại và có trạng thái
   `payos / production / live / ready`.
4. Kiểm tra readiness:

   ```powershell
   curl.exe -i "https://demo.hosodauthau.online/health/ready"
   ```

   Cần nhận HTTP `200` và JSON `{"status":"ready"}`.

### 3.2. Credential

Điền ba giá trị của đúng kênh thanh toán payOS vào secret environment của máy
chạy backend:

```dotenv
PAYOS_CREDENTIAL_REFERENCE=env://payos/default
PAYOS_CLIENT_ID=
PAYOS_API_KEY=
PAYOS_CHECKSUM_KEY=
```

Sau đó restart ứng dụng. Không đưa giá trị thật vào `.env.example`, Git, ảnh chụp,
ticket, log hoặc frontend. `Checksum Key` chỉ được giữ server-side.

Trong lúc đăng ký webhook, tiếp tục giữ:

```dotenv
PAYMENT_CHECKOUT_ENABLED=false
PAYMENT_ACTIVATION_ENABLED=false
```

Endpoint webhook vẫn có thể xác minh chữ ký và tiếp nhận sự kiện mẫu khi hai cờ
trên đang tắt; checkout và activation thật chưa được mở.

## 4. Cách 1 — đăng ký trên dashboard payOS (khuyến nghị)

1. Đăng nhập [my.payOS](https://my.payos.vn/).
2. Mở đúng kênh thanh toán đã cấp ba credential ở trên.
3. Mở phần cấu hình webhook của kênh thanh toán.
4. Nhập nguyên URL:

   ```text
   https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook
   ```

5. Chọn lưu/xác nhận webhook.
6. payOS sẽ gửi dữ liệu giao dịch mẫu tới endpoint để kiểm tra. BiddingFlow trả
   HTTP `202`, đây là response `2xx` hợp lệ để ACK webhook.
7. Chỉ coi là thành công khi dashboard payOS báo URL đã được xác nhận và access
   log của ứng dụng cho thấy request `POST` đi thẳng tới endpoint, không qua trang
   đăng nhập Cloudflare.

Hướng dẫn chính thức: [Tạo kênh thanh toán][payos-channel] và
[Webhook API][payos-webhook].

## 5. Cách 2 — đăng ký bằng API payOS

Chỉ dùng cách này từ một phiên PowerShell đã có sẵn credential trong biến môi
trường. Không chép key trực tiếp vào câu lệnh hoặc commit script chứa key.

```powershell
$payosWebhookUrl = "$($env:APP_PUBLIC_URL.TrimEnd('/'))/api/billing/providers/provider-payos-production-v2/webhook"
$payosHeaders = @{
  "x-client-id" = $env:PAYOS_CLIENT_ID
  "x-api-key" = $env:PAYOS_API_KEY
}
$payosBody = @{ webhookUrl = $payosWebhookUrl } | ConvertTo-Json -Compress

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api-merchant.payos.vn/confirm-webhook" `
  -Headers $payosHeaders `
  -ContentType "application/json" `
  -Body $payosBody
```

API tương đương:

```http
POST https://api-merchant.payos.vn/confirm-webhook
x-client-id: <PAYOS_CLIENT_ID>
x-api-key: <PAYOS_API_KEY>
Content-Type: application/json

{"webhookUrl":"https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook"}
```

Không gửi `PAYOS_CHECKSUM_KEY` trong header/body của lệnh confirm. Theo API chính
thức, `200` là thành công; `400` thường là URL không hợp lệ/endpoint kiểm tra
không đạt; `401` là thiếu hoặc sai Client ID/API Key. Xem [payOS API reference][payos-api].

## 6. Xác nhận sau đăng ký

Hoàn tất checklist sau trước khi bật thanh toán:

- Dashboard/API payOS báo confirm thành công.
- Endpoint không còn trả Cloudflare `302` cho request ngoài Internet.
- Access log có `POST .../webhook` với response `202`.
- Không có lỗi `PROVIDER_CREDENTIAL_UNAVAILABLE`, `PROVIDER_EVENT_UNVERIFIED`
  hoặc `WEBHOOK_FAILED` cho payload xác nhận hợp lệ của payOS.
- Sự kiện mẫu confirm không tạo payment fact, không đổi order và không kích hoạt
  gói/quota vì không khớp order thật. Không dùng thao tác **Review** để phê duyệt
  sự kiện mẫu thành giao dịch thật.
- Khi `PAYMENT_ACTIVATION_ENABLED=false`, một event mẫu hợp lệ có thể còn ở trạng
  thái `pending` và được tính vào webhook backlog. Sau khi bật activation, theo
  dõi nó tới trạng thái kết thúc; nếu bị giữ `review`/`dead` vì không có order
  tương ứng thì giữ nguyên bằng chứng, không xóa hoặc gán vào order thật.
- Super Admin → **Thương mại & Thanh toán** không có `PAID_NOT_APPLIED_OLD` hoặc
  payment/activation nào phát sinh từ payload mẫu trước smoke test.

Khi các điều kiện trên đạt, đặt:

```dotenv
COMMERCIAL_PAYMENT_PROVIDER=payos
PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED=true
PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED=true
COMMERCIAL_EXTERNAL_LEGAL_READY=true
```

`COMMERCIAL_EXTERNAL_LEGAL_READY=true` ở đây ghi nhận quyết định của chủ sản phẩm
rằng 27 mục legal được coi là đã đạt; nó không sửa nội dung của 27 mục đó.

Restart ứng dụng và kiểm tra `/health/ready` lại sau mỗi lần đổi cấu hình.

## 7. Trình tự bật thanh toán thật

Không bật cả hai cờ cùng một lần:

1. Bật commercial policy theo release đã được duyệt:

   ```dotenv
   COMMERCIAL_POLICY_ENABLED=true
   COMMERCIAL_POLICY_MODE=enforce
   ```

2. Bật xử lý webhook/đối soát trước, nhưng chưa cho tạo checkout mới:

   ```dotenv
   PAYMENT_ACTIVATION_ENABLED=true
   PAYMENT_CHECKOUT_ENABLED=false
   ```

3. Restart, kiểm tra readiness, worker và Commercial Control Center.
4. Khi hệ thống ổn định, bật checkout:

   ```dotenv
   PAYMENT_CHECKOUT_ENABLED=true
   ```

5. Thực hiện một giao dịch thật giá trị nhỏ đã được phê duyệt. payOS không có
   sandbox riêng cho Payment Request, nên smoke test này dùng production và có
   thể phát sinh tiền thật. Xem [môi trường test payOS][payos-test].
6. Xác nhận chuỗi kết quả: checkout URL đúng host payOS → thanh toán → webhook
   `202` → query/đối soát chữ ký hợp lệ → order `verified_paid` → activation chỉ
   áp dụng một lần.

Redirect `returnUrl`/`cancelUrl` chỉ dùng cho trải nghiệm trình duyệt. Không lấy
query string redirect làm bằng chứng thanh toán hoặc kích hoạt quyền lợi.

## 8. Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `302` + `Cloudflare-Access` | Endpoint còn nằm sau Access login | Tạo Bypass cho đúng path webhook, rồi thử lại từ phiên không đăng nhập |
| `403`/HTML challenge | WAF/Bot rule chặn server payOS | Bỏ challenge cho đúng path; vẫn giữ rate limit hợp lý và HMAC backend |
| `404 NOT_FOUND` | Chưa có profile v2 trong DB hoặc sai path/profile ID | Chạy migration v80 và dùng đúng URL trong mục 1 |
| `503 PROVIDER_CREDENTIAL_UNAVAILABLE` | Credential rỗng/sai reference hoặc process chưa restart | Kiểm tra ba biến secret và `env://payos/default`, restart backend |
| `400 PROVIDER_EVENT_UNVERIFIED` | Sai Checksum Key hoặc payload bị proxy sửa | Dùng Checksum Key cùng kênh; bảo đảm proxy giữ nguyên JSON body |
| confirm API trả `401` | Sai/thiếu Client ID hoặc API Key | Lấy lại credential của đúng kênh payOS; không dùng Checksum Key làm API Key |
| payOS báo timeout/URL invalid | DNS/TLS, Access, redirect hoặc backend không trả `2xx` | Kiểm tra public HTTPS từ mạng ngoài và access log; không thử confirm liên tục khi blocker chưa sửa |
| Webhook trùng | payOS retry hoặc gửi lại | Bình thường; inbox dedupe và activation exactly-once xử lý, không xóa ledger/event |

Nếu cần dừng bán khẩn cấp:

```dotenv
PAYMENT_CHECKOUT_ENABLED=false
PAYMENT_ACTIVATION_ENABLED=true
```

Cách này ngừng tạo checkout mới nhưng vẫn cho hệ thống nhận webhook, đối soát và
xử lý những order đã tạo/đã thanh toán. Không xóa provider profile, order, webhook
event, payment transaction hoặc activation ledger.

## Nguồn chính thức

- [payOS API reference][payos-api]
- [Dữ liệu webhook và yêu cầu ACK `2xx`][payos-webhook]
- [Kiểm tra webhook bằng signature][payos-signature]
- [Tạo kênh thanh toán][payos-channel]
- [Môi trường test payOS][payos-test]
- [Cloudflare: Bypass public endpoint][cloudflare-bypass]
- [Cloudflare: application path và độ ưu tiên][cloudflare-paths]

[payos-api]: https://payos.vn/docs/api/
[payos-webhook]: https://payos.vn/docs/du-lieu-tra-ve/webhook/
[payos-signature]: https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/
[payos-channel]: https://payos.vn/docs/huong-dan-su-dung/tao-kenh-thanh-toan/
[payos-test]: https://payos.vn/docs/moi-truong-test/
[cloudflare-bypass]: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/#bypass-a-public-endpoint
[cloudflare-paths]: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/

Tài liệu vận hành đầy đủ hơn: [Runbook payOS production](../runbooks/payos-production-integration.md).

Bằng chứng nghiên cứu riêng: [Đăng ký webhook payOS — nguồn chính thức](../research/2026-08-27-payos-webhook-registration.md).
