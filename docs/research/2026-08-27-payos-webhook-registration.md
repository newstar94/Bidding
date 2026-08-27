# payOS webhook — hướng dẫn đăng ký và bằng chứng vận hành

- Ngày kiểm tra: **2026-08-27** (Asia/Saigon)
- Phạm vi: đăng ký/cập nhật webhook Payment Request, payload kiểm tra, ACK và chữ ký.
- Nguồn: chỉ tài liệu chính thức của payOS; phần kiểm tra endpoint BiddingFlow được ghi riêng như bằng chứng vận hành.
- Không thực hiện trong lần nghiên cứu này: không dùng credential, không gọi `confirm-webhook`, không tạo giao dịch thật và không thay đổi cấu hình Cloudflare.

## Kết luận hiện tại

Webhook cần đăng ký cho BiddingFlow là:

```text
https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook
```

**Chưa nên đăng ký ngay.** Lúc 2026-08-27, cả phép kiểm tra `HEAD` và `POST` JSON
tới URL trên đều trả `302 Found`, có header
`Www-Authenticate: Cloudflare-Access` và chuyển hướng tới trang đăng nhập
Cloudflare Access. Request máy-tới-máy của payOS không có phiên đăng nhập
Cloudflare của người dùng nên hiện bị chặn trước khi tới ứng dụng.

Trước khi xác nhận với payOS, cần tạo ngoại lệ public/bypass **chỉ cho đúng path
webhook này**, không mở toàn bộ `/api` hoặc toàn bộ website. Sau đó kiểm tra lại
để chắc chắn request không còn nhận `3xx` hoặc `Www-Authenticate`. Endpoint ứng
dụng vẫn xác thực HMAC bằng Checksum Key và đối chiếu order; việc bỏ Cloudflare
Access ở đúng ingress webhook không bỏ các kiểm soát đó.

## 1. Hành vi chính thức của payOS

payOS cung cấp hai cách cấu hình webhook:

1. Dashboard: đăng nhập `my.payos.vn`, vào **Kênh thanh toán**, chọn đúng kênh và
   thêm `webhookURL`. Tài liệu chính thức không mô tả tên các nút chi tiết hơn
   sau bước này. [Tạo kênh thanh toán][create-channel]
2. API: gọi `POST /confirm-webhook`. API vừa kiểm tra URL, vừa thêm hoặc cập nhật
   webhook URL của đúng kênh ứng với Client ID/API Key nếu kiểm tra thành công.
   Trong lúc kiểm tra, payOS gửi một payload có thông tin giao dịch ngân hàng
   **mẫu** tới URL đã khai báo. [payOS API][api]

Webhook receiver phải nhận `POST application/json` và trả một mã HTTP `2xx` để
xác nhận đã nhận webhook thành công. [Webhook Payment Request][webhook]

## 2. Cách đăng ký qua dashboard

1. Deploy phiên bản ứng dụng có route webhook và migration DB tương ứng.
2. Điền ba credential của **cùng một kênh payOS** vào secret environment:

   ```dotenv
   PAYOS_CLIENT_ID=
   PAYOS_API_KEY=
   PAYOS_CHECKSUM_KEY=
   ```

3. Cấu hình Cloudflare để URL webhook bên trên đi thẳng tới ứng dụng, không yêu
   cầu đăng nhập, CAPTCHA hoặc redirect.
4. Đăng nhập `https://my.payos.vn`.
5. Vào **Kênh thanh toán**, chọn đúng kênh đã cấp ba credential ở bước 2.
6. Thêm URL webhook chính xác, không thêm dấu `/` ở cuối:

   ```text
   https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook
   ```

7. Lưu/xác nhận và kiểm tra payOS báo thành công. Khi đó payOS đã gửi payload mẫu
   tới BiddingFlow và nhận được `2xx`.

Không dùng payload mẫu để kích hoạt gói hoặc cộng quyền lợi. Payload này phải
được xác minh chữ ký và ACK, nhưng chỉ một payment khớp order đã tồn tại,
`paymentLinkId` và số tiền kỳ vọng mới có thể đi tiếp vào activation. Đây là
policy an toàn của BiddingFlow suy ra từ việc payOS chủ động gửi giao dịch mẫu
khi xác nhận URL; không phải lời cam kết riêng của payOS về domain model của ứng
dụng.

## 3. Cách đăng ký qua API

Request chính thức:

```http
POST https://api-merchant.payos.vn/confirm-webhook
x-client-id: <PAYOS_CLIENT_ID>
x-api-key: <PAYOS_API_KEY>
Content-Type: application/json

{
  "webhookUrl": "https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook"
}
```

`PAYOS_CHECKSUM_KEY` **không** gửi trong header của request đăng ký. Key này
được giữ server-side để tạo/kiểm tra HMAC cho dữ liệu Payment Request, gồm cả
việc kiểm tra chữ ký payload webhook.

Ví dụ PowerShell, giả sử credential đã được inject vào environment của phiên
operator (không chép giá trị thật vào tài liệu hoặc lịch sử lệnh):

```powershell
$payosHeaders = @{
    "x-client-id" = $env:PAYOS_CLIENT_ID
    "x-api-key" = $env:PAYOS_API_KEY
}
$payosBody = @{
    webhookUrl = "https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook"
} | ConvertTo-Json -Compress
$payosResult = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api-merchant.payos.vn/confirm-webhook" `
    -Headers $payosHeaders `
    -ContentType "application/json" `
    -Body $payosBody
$payosResult | Select-Object code, desc, @{Name="webhookUrl"; Expression={$_.data.webhookUrl}}
```

Thành công được tài liệu mô tả là HTTP `200`, body có `code: "00"`,
`desc: "success"` và `data.webhookUrl`. Không chạy lệnh này tự động khi mỗi web
worker khởi động: nó là thao tác thay đổi cấu hình bên ngoài và chỉ cần operator
thực hiện có chủ đích.

## 4. Xác minh chữ ký webhook

Envelope webhook có các trường ngoài gồm `code`, `desc`, `success`, `data` và
`signature`. Quy tắc Payment Request chính thức là:

1. Chỉ lấy object `data`; không ký toàn bộ outer envelope.
2. Sắp xếp field trong `data` theo tên key tăng dần theo alphabet.
3. Ghép thành `key1=value1&key2=value2...`.
4. Tính HMAC-SHA256 với Checksum Key và so với outer `signature`.

Tài liệu payOS còn minh họa việc chuẩn hóa `null`/`"null"`/`"undefined"` thành
chuỗi rỗng và serialize array theo quy tắc mẫu. Không tự viết một biến thể khác
với URI encoding cho Payment Request webhook. [Kiểm tra signature][signature]

BiddingFlow đã thực hiện seam này tại `backend/billing/providers/payos.py`; route
public nhận webhook nằm tại `backend/billing/webhook.py` và khi tiếp nhận thành
công trả HTTP `202`, vẫn thuộc họ `2xx` mà payOS yêu cầu.

## 5. Kiểm tra trước và sau khi đăng ký

### 5.1. Kiểm tra ingress sau khi bỏ Cloudflare Access

Một `HEAD` tới route POST-only có thể trả `405`; điều cần kiểm tra ở bước này là
không còn `302` tới login và không còn `Www-Authenticate: Cloudflare-Access`:

```powershell
curl.exe -I "https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook"
```

Sau đó gửi một JSON cố ý không có chữ ký. Request phải tới được ứng dụng và bị
ứng dụng từ chối bằng `400`, thay vì bị Cloudflare chuyển hướng:

```powershell
curl.exe -i -X POST `
  -H "Content-Type: application/json" `
  --data "{}" `
  "https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook"
```

Không dùng Checksum Key để tự dựng request kiểm tra từ máy cá nhân nếu không cần
thiết; thao tác `/confirm-webhook` của payOS là phép thử end-to-end chuẩn.

### 5.2. Kiểm tra kết quả confirm

- API confirm trả HTTP `200`, `code == "00"` và đúng `data.webhookUrl`.
- Log/metrics của ingress không có redirect, CAPTCHA hoặc lỗi TLS.
- BiddingFlow trả `2xx` cho payload mẫu có chữ ký hợp lệ.
- Payload mẫu không tạo activation/quyền lợi.
- Không có giá trị Client ID, API Key hoặc Checksum Key trong log/response/audit.

Chỉ sau khi xác nhận thành công mới đặt:

```dotenv
PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED=true
PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED=true
```

Sau đó restart ứng dụng. Giữ `PAYMENT_CHECKOUT_ENABLED=false` trong khi kiểm tra
readiness; bật activation trước và chỉ mở checkout sau một smoke test production
giá trị nhỏ đã được phê duyệt. payOS nói rõ không có sandbox/staging riêng và đề
nghị dùng giao dịch thật giá trị nhỏ để test end-to-end. [Môi trường test][test]

## 6. Lỗi có thể kết luận trực tiếp từ tài liệu

| Kết quả confirm | Nghĩa theo payOS | Kiểm tra trước tiên |
|---|---|---|
| `400` | Webhook URL không hợp lệ | URL tuyệt đối, HTTPS, đúng path, không có khoảng trắng/sai hostname |
| `401` | Thiếu API Key hoặc Client Key | Hai header `x-api-key`, `x-client-id`; credential phải thuộc cùng kênh |
| `5xx` | Lỗi từ hệ thống nhận webhook của merchant | Endpoint public, TLS, Cloudflare/WAF, timeout, response có phải `2xx` |
| `200`, `code: "00"` | Xác nhận thành công | Đối chiếu `data.webhookUrl` với URL vừa gửi |

Hai cột “Kiểm tra trước tiên” là hướng chẩn đoán vận hành, không phải error
catalogue đầy đủ do payOS công bố. Tài liệu công khai được kiểm tra không nêu
timeout confirm, lịch retry webhook, IP allowlist hay việc payOS có theo redirect
hay không; vì vậy endpoint production nên trả `2xx` trực tiếp và không thiết kế
dựa trên các giả định chưa được công bố.

Lỗi chữ ký thường đến từ việc ký sai tập field, ký cả envelope thay vì riêng
`data`, sort key sai hoặc biến đổi dữ liệu trước khi ký. FAQ chính thức cũng lưu
ý phải dùng đúng thông tin truyền trong JSON body khi tạo/kiểm tra signature.
[FAQ payOS][faq]

## Nguồn chính thức

[api]: https://payos.vn/docs/api/
[create-channel]: https://payos.vn/docs/huong-dan-su-dung/tao-kenh-thanh-toan/
[webhook]: https://payos.vn/docs/du-lieu-tra-ve/webhook/
[signature]: https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/
[faq]: https://payos.vn/docs/cau-hoi-thuong-gap/
[test]: https://payos.vn/docs/moi-truong-test/
