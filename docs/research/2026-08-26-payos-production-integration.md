# payOS production integration — hợp đồng từ nguồn chính thức

- Ngày kiểm tra nguồn: **2026-08-26**
- Phạm vi: Payment Requests, redirect, webhook, chữ ký, trạng thái, lỗi/retry/idempotency và môi trường kiểm thử.
- Nguồn: chỉ tài liệu `payos.vn` và mã nguồn SDK trong tổ chức GitHub chính thức `payOSHQ`.
- Giới hạn nghiên cứu: không dùng credential, không gọi API giao dịch, không xác nhận webhook và không thực hiện thanh toán thật.

## Kết luận triển khai

1. API production duy nhất được công bố là `https://api-merchant.payos.vn`; payOS không có sandbox/staging riêng. Smoke test thật phải dùng production và giao dịch giá trị nhỏ. [API reference][api] [Môi trường test][test-env]
2. Tạo link dùng `POST /v2/payment-requests`, gửi `x-client-id`, `x-api-key`, JSON body và chữ ký HMAC-SHA256 từ Checksum Key. Checksum Key không phải header. [API reference][api] [Official Python client][py-client]
3. Chữ ký create dùng đúng năm trường theo chuỗi cố định `amount`, `cancelUrl`, `description`, `orderCode`, `returnUrl`. Chữ ký webhook và response ký **chỉ object `data`**, không ký outer envelope. [API reference][api] [Hướng dẫn signature][signature]
4. `returnUrl`/`cancelUrl` là browser redirect để cập nhật UX. Theo luồng chính thức, redirect hiển thị kết quả còn webhook mới là dữ liệu để merchant cập nhật đơn hàng. Vì query params redirect không có chữ ký, BiddingFlow không được cấp subscription/quota từ redirect; chỉ kích hoạt sau webhook hợp lệ hoặc GET reconciliation có response signature hợp lệ và khớp snapshot đơn hàng. Đây là suy luận an toàn trực tiếp từ luồng chính thức, không phải một câu cam kết riêng của payOS. [Luồng hoạt động][getting-started] [Return URL][return-url]
5. Payment Requests không công bố `x-idempotency-key`. Nếu create timeout/connection reset/5xx sau khi request có thể đã được gửi, giữ nguyên `orderCode` và GET lại theo mã đó trước khi quyết định retry; không sinh attempt/order mới một cách mù quáng. [API reference][api] [Official Python Payment Requests][py-payment-resource]
6. Chỉ `PAID` sau khi xác minh chữ ký và đối chiếu đúng `orderCode`, `paymentLinkId`, số tiền kỳ vọng mới là candidate kích hoạt. Mọi trạng thái khác đều không được kích hoạt. Public docs không định nghĩa đầy đủ terminal semantics cho `UNDERPAID`, `EXPIRED`, `FAILED`, nên mapping thận trọng được tách rõ ở mục trạng thái. [Return URL][return-url] [Official Payment Request types][py-payment-types]

## 1. Credential, host và headers

Sau khi tạo kênh thanh toán, payOS cung cấp ba key: Client ID, API Key và Checksum Key. Hướng dẫn SDK chính thức cũng đọc đúng ba biến môi trường `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`. [Tạo kênh thanh toán][create-channel] [Python SDK][python-sdk]

| Giá trị | Dùng để làm gì | Có gửi ra mạng không? |
|---|---|---|
| Client ID | header `x-client-id` | Có, tới API payOS |
| API Key | header `x-api-key` | Có, tới API payOS |
| Checksum Key | HMAC-SHA256 request/response/webhook | Không gửi như credential/header; chỉ giữ server-side |

Official SDK dựng các header `x-client-id`, `x-api-key`, `Content-Type: application/json`; `x-partner-code` chỉ là tùy chọn cho chương trình đối tác. [Official Python client][py-client]

Production origin được công bố:

```text
https://api-merchant.payos.vn
```

Không cho frontend biết API Key/Checksum Key. Backend nên đọc ba giá trị từ secret environment và fail startup khi cấu hình live nhưng thiếu/rỗng; tuyệt đối không ghi giá trị key vào log, DB, response hay audit metadata. Phần fail-startup và secret hygiene là yêu cầu triển khai của BiddingFlow; tài liệu SDK chính thức xác nhận các biến môi trường và từ chối khởi tạo khi credential thiếu/rỗng. [Python SDK][python-sdk] [Official Python client][py-client]

## 2. Tạo link thanh toán

### Endpoint

```http
POST https://api-merchant.payos.vn/v2/payment-requests
x-client-id: <Client ID>
x-api-key: <API Key>
Content-Type: application/json
```

Nguồn endpoint, auth và schema: [payOS API reference][api].

### Body

Các trường bắt buộc được public schema công bố:

| Trường | Kiểu | Ghi chú chính thức |
|---|---|---|
| `orderCode` | integer | Mã đơn hàng |
| `amount` | integer | Số tiền thanh toán |
| `description` | string | Nếu tài khoản ngân hàng không liên kết qua payOS thì giới hạn 9 ký tự |
| `cancelUrl` | URI string | URL nhận redirect khi người dùng hủy |
| `returnUrl` | URI string | URL nhận redirect sau thanh toán thành công |
| `signature` | string | HMAC-SHA256 bằng Checksum Key |

Optional: buyer name/company/tax/address/email/phone, `items`, `invoice`, `expiredAt`. `expiredAt` là Unix Timestamp kiểu Int32. Item có `name`, `quantity`, `price`, optional `unit`, `taxPercentage`; official SDK hiện giới hạn tax percentage ở `-2 | -1 | 0 | 5 | 10`. [API reference][api] [Official Payment Request types][py-payment-types]

Docs công khai **không nêu** minimum/maximum cho `amount`, positivity/range/uniqueness scope cho `orderCode`, hay khoảng thời gian tối thiểu/tối đa của `expiredAt`. Không được biến sample `time.time()`/`Date.now()` trong SDK/demo thành contract provider. [API reference][api] [Python SDK][python-sdk]

### Chữ ký create

Canonical string chính xác:

```text
amount={amount}&cancelUrl={cancelUrl}&description={description}&orderCode={orderCode}&returnUrl={returnUrl}
```

Tính lowercase hex digest:

```text
HMAC-SHA256(key = Checksum Key, message = canonical string UTF-8)
```

Năm field được giữ đúng thứ tự alphabet ở trên. Buyer/items/invoice/`expiredAt` không tham gia chữ ký create hiện hành. Không URI-encode các value trước khi ký; phải ký đúng string value được gửi. [API reference][api] [FAQ signature][faq] [Official crypto implementation][py-crypto]

### Response thành công

API mẫu trả envelope:

```json
{
  "code": "00",
  "desc": "success",
  "data": {
    "bin": "...",
    "accountNumber": "...",
    "accountName": "...",
    "amount": 10000,
    "description": "...",
    "orderCode": 123,
    "currency": "VND",
    "paymentLinkId": "...",
    "status": "PENDING",
    "checkoutUrl": "https://pay.payos.vn/web/...",
    "qrCode": "..."
  },
  "signature": "..."
}
```

Official SDK chỉ coi body `code == "00"` là thành công, xác minh `signature` trên `data`, rồi mới cast/unpack `data`. BiddingFlow cũng phải fail request khi response signature thiếu/sai thay vì chỉ log warning. [API reference][api] [Official Python client][py-client]

## 3. Query và cancel

| Operation | Endpoint | Input | Kết quả |
|---|---|---|---|
| Lấy thông tin | `GET /v2/payment-requests/{id}` | `{id}` là merchant `orderCode` dạng số hoặc payOS `paymentLinkId` dạng chuỗi | `PaymentLink` có amount summary, status, transactions và cancellation fields |
| Hủy link | `POST /v2/payment-requests/{id}/cancel` | optional `{ "cancellationReason": string }` | `PaymentLink`, sample có status `CANCELLED` |

Cả hai dùng `x-client-id` + `x-api-key`; API reference công bố `200`, `401`, `429`. Response thành công có `signature` trên `data`, và official SDK xác minh signature cho create/get/cancel. [API reference][api] [Official Python Payment Requests][py-payment-resource]

`cancel` chỉ là hủy payment link. Tài liệu Payment Requests không nói cancel hoàn/đảo một giao dịch đã `PAID`; không được dùng cancel như refund. [API reference][api]

## 4. Webhook: đăng ký, payload, ACK và xác minh

### Đăng ký/xác nhận URL

Có hai đường chính thức:

- Trong my.payos.vn: vào kênh thanh toán và thêm webhook URL. [Tạo kênh thanh toán][create-channel]
- Qua API: `POST https://api-merchant.payos.vn/confirm-webhook` với headers credential và body `{ "webhookUrl": "https://..." }`. API này vừa kiểm tra vừa thêm/cập nhật URL; payOS gửi dữ liệu giao dịch mẫu tới endpoint để kiểm tra. [API reference][api]

Các response được công bố cho confirm là `200`, `400` (URL invalid), `401` (missing API/Client key), và `5xx` khi hệ thống merchant lỗi. Vì confirm sẽ gửi payload mẫu, một webhook signature-valid không tự động đồng nghĩa giao dịch thật; luôn phải correlate với order đã tồn tại. [API reference][api]

### Payload và ACK

Outer payload:

```json
{
  "code": "00",
  "desc": "success",
  "success": true,
  "data": {
    "orderCode": 123,
    "amount": 3000,
    "description": "...",
    "accountNumber": "...",
    "reference": "...",
    "transactionDateTime": "2023-02-04 18:25:00",
    "currency": "VND",
    "paymentLinkId": "...",
    "code": "00",
    "desc": "Thành công",
    "counterAccountBankId": "",
    "counterAccountBankName": "",
    "counterAccountName": "",
    "counterAccountNumber": "",
    "virtualAccountName": "",
    "virtualAccountNumber": ""
  },
  "signature": "..."
}
```

Merchant trả bất kỳ HTTP `2xx` để xác nhận webhook đã được nhận. [Webhook API][webhook-api]

### Canonicalization webhook/response

1. Ký/xác minh **chỉ object `data`**; không gồm outer `code`, `desc`, `success`, `signature`.
2. Sort key của `data` tăng dần theo alphabet.
3. Chuyển mỗi field thành `key=value`, nối bằng `&`.
4. `null` và sentinel string `"null"`/`"undefined"` thành chuỗi rỗng; actual `undefined` bị loại/được xử lý theo implementation ngôn ngữ.
5. Nếu có array, giữ thứ tự phần tử, sort key trong từng object phần tử rồi compact JSON stringify.
6. Tính HMAC-SHA256 bằng Checksum Key trên UTF-8 canonical string; Payment Request canonicalization không dùng URI encoding.

Nguồn normative và code mẫu đa ngôn ngữ: [Hướng dẫn signature][signature]. Official SDK thực hiện đúng việc lấy `webhook.data`, canonicalize và so với outer `signature`. [Official Webhook resource][py-webhook-resource] [Official crypto implementation][py-crypto]

Implementation nên dùng constant-time comparison và xử lý webhook qua durable inbox/idempotent worker; đây là hardening phía BiddingFlow, không phải yêu cầu được diễn đạt nguyên văn trong docs.

## 5. Return URL/cancel URL chỉ phục vụ UX

Sau thanh toán, browser được đưa về `returnUrl`; khi người dùng hủy, browser được đưa về `cancelUrl`. Query params được công bố gồm `code`, `id`, `cancel`, `status`, `orderCode`; tài liệu không cung cấp signature cho các query params này. [Return URL][return-url]

Luồng chính thức phân vai:

- redirect: frontend hiển thị giao diện kết quả;
- webhook: merchant nhận đầy đủ thông tin và cập nhật trạng thái đơn hàng. [Luồng hoạt động][getting-started]

Vì người dùng có thể tự sửa query string, handler redirect chỉ nên hiển thị trạng thái chờ/đọc trạng thái server và poll/reload. Không ghi payment success, không cấp quyền lợi và không gia hạn subscription trực tiếp từ `status=PAID` trên URL.

## 6. Trạng thái và mapping an toàn

Return URL docs mô tả bốn giá trị: `PAID`, `PENDING`, `PROCESSING`, `CANCELLED`. Official SDK hiện định nghĩa tập đầy đủ hơn: `PENDING | CANCELLED | UNDERPAID | PAID | EXPIRED | PROCESSING | FAILED`. [Return URL][return-url] [Official Payment Request types][py-payment-types]

Public docs không định nghĩa chính thức toàn bộ state machine hoặc terminal semantics cho ba trạng thái bổ sung. Mapping triển khai sau vì vậy phân biệt fact và policy:

| Provider status | Ý nghĩa/căn cứ | Policy BiddingFlow |
|---|---|---|
| `PAID` | Docs: đã thanh toán | Chỉ candidate terminal-success sau signature + GET/order/amount match; có thể kích hoạt idempotently |
| `PENDING` | Docs: chờ thanh toán | Non-terminal, không kích hoạt; tiếp tục webhook/poll/reconciliation |
| `PROCESSING` | Docs: đang xử lý | Non-terminal, không kích hoạt; tiếp tục reconciliation |
| `CANCELLED` | Docs: đã hủy | Terminal non-success theo semantics công bố; không kích hoạt |
| `EXPIRED` | Có trong official SDK, docs không giải thích state machine | Không kích hoạt; xử lý như terminal non-success cục bộ nhưng cho phép reconciliation sửa nếu provider sau đó trả fact mạnh hơn |
| `FAILED` | Có trong official SDK, docs không giải thích state machine | Không kích hoạt; xử lý như terminal non-success cục bộ nhưng lưu bằng chứng/reconcile |
| `UNDERPAID` | Có trong official SDK, docs không nói có thể nộp thêm hay terminal | Không kích hoạt; giữ pending/manual review và reconcile, không tự coi là paid hoặc terminal |
| Unknown | Forward compatibility | Không kích hoạt; quarantine/manual review + reconciliation |

Quan trọng: webhook payment có dữ liệu giao dịch chứ không phải status field của Payment Link. Sau webhook hợp lệ, nên query Payment Link theo đúng pinned credential profile/orderCode, verify response signature rồi đối chiếu `amount`, `amountPaid`, `amountRemaining`, `paymentLinkId` và status trước activation. Query-and-match này là policy integrity của BiddingFlow dựa trên các field API công bố. [API reference][api]

## 7. Error, rate limit, retry và idempotency

### Điều được payOS/SDK công bố

- Payment Request create/get/cancel công bố HTTP `200`, `401`, `429`; `429` xảy ra khi gửi quá nhiều request. [API reference][api] [Rate limits][getting-started]
- Response dùng envelope `code`, `desc`, `data`, optional/operation-dependent `signature`; official SDK coi non-2xx hoặc body code khác `"00"` là lỗi API. [API reference][api] [Official Python SDK README][py-readme] [Official Python client][py-client]
- API docs không công bố bảng error code đầy đủ, rate limit cụ thể, SLA hay timeout bắt buộc.
- Payment Requests không có documented `x-idempotency-key`; cùng API page chỉ ghi header này cho Payout. Không được suy diễn idempotency của Payout sang create/cancel Payment Request. [API reference][api]
- Official Python SDK mặc định timeout 60 giây, tối đa 2 retry và retry HTTP `408`, `429`, `>=500`, timeout hoặc connection error. Đây là hành vi client SDK, không phải SLA hay bằng chứng rằng POST create/cancel idempotent. [Official Python client][py-client] [Official Python SDK README][py-readme]

### Policy retry/recovery đề nghị

- Persist `orderCode` ổn định và provider attempt trước outbound create.
- Với lỗi chắc chắn trước khi gửi: retry bounded với backoff/jitter.
- Với timeout/reset/5xx sau khi có thể đã gửi create: đánh dấu outcome unknown, GET bằng cùng `orderCode`, verify response signature và match snapshot; chỉ retry create sau reconciliation.
- Với GET: retry bounded, tôn trọng `Retry-After` khi có và reconcile định kỳ.
- Với cancel: query-before/query-after vì docs không cam kết idempotency.
- Webhook handler phải idempotent. Docs không công bố unique delivery ID, retry schedule hay retention; dedupe bằng local inbox identity/payload digest cùng provider profile, `orderCode`, `paymentLinkId`, transaction `reference`, amount.
- Trả `2xx` chỉ sau khi payload đã được xác minh và lưu durable đủ để xử lý sau; activation chạy idempotently ngoài request path.

Các bullet trên là resilience policy đề nghị, không phải guarantee của payOS. Tài liệu môi trường test cũng chủ động yêu cầu chuẩn bị logic retry, timeout và đồng bộ trạng thái. [Môi trường test][test-env]

## 8. Môi trường test và go-live

payOS nói rõ hiện không có sandbox/staging riêng; test redirect, webhook và payment flow chạy trên production. Họ khuyến nghị dùng tài khoản cá nhân, liên kết tài khoản ngân hàng và thanh toán giá trị nhỏ để test end-to-end. [Môi trường test][test-env]

Vì vậy:

- unit/integration/CI dùng fake provider và golden signature vectors, không gọi mạng;
- smoke test thật phải là bước vận hành có chủ đích, dùng tiền thật giá trị nhỏ;
- trước smoke test, deploy public HTTPS webhook, rồi confirm URL trong dashboard hoặc gọi `/confirm-webhook` bằng operator command riêng;
- xác nhận payload mẫu được ACK nhưng không tạo payment/activation;
- tạo một order test, kiểm tra redirect chỉ đổi UX, webhook + GET signed reconciliation mới đổi trạng thái server;
- kiểm tra duplicate delivery/replay không kích hoạt hai lần.

## 9. Test contract tối thiểu

### Crypto/provider adapter

- Golden vector create với đúng 5 field/thứ tự; thay từng field làm signature đổi; optional fields không tham gia.
- Webhook vector official: key order ngẫu nhiên vẫn verify; ký outer envelope phải fail; Unicode/empty/null/array serialization có coverage.
- Missing/wrong response signature ở create/get/cancel phải fail integrity.
- Headers chỉ có Client ID/API Key; Checksum Key không xuất hiện trong request/log.
- Non-2xx, body `code != "00"`, malformed JSON, timeout, `429`, `5xx` được map ổn định và không lộ secret.

### State/recovery

- Redirect giả `status=PAID` không kích hoạt.
- Webhook sai signature không vào trusted inbox.
- Webhook đúng signature nhưng order/paymentLink/amount mismatch không kích hoạt.
- Chỉ GET signed `PAID` khớp snapshot kích hoạt đúng một lần.
- Duplicate/out-of-order webhook, poll và reconciliation race chỉ tạo một ledger/activation transition.
- `PENDING`, `PROCESSING`, `UNDERPAID`, `CANCELLED`, `EXPIRED`, `FAILED`, unknown đều không kích hoạt.
- Create ambiguous outcome GET lại đúng `orderCode`, không sinh order/provider attempt mới.
- Confirm-webhook sample không match order thật và không kích hoạt.

## 10. Điểm public docs chưa đủ rõ

Cần xác nhận trực tiếp với payOS/support hoặc merchant contract trước khi code dựa vào các giả định sau:

1. `orderCode`: range, positivity, uniqueness scope và behavior chính xác khi create lặp cùng mã.
2. `amount`: min/max và constraint theo loại tài khoản/kênh.
3. `expiredAt`: khoảng thời gian hợp lệ ngoài việc là Unix Timestamp Int32.
4. Idempotency guarantee của create/cancel Payment Request.
5. Rate-limit cụ thể, SLA, timeout khuyến nghị và error-code catalogue đầy đủ.
6. Webhook retry schedule, retention, replay policy và delivery/event ID duy nhất.
7. State machine/terminal semantics chính thức cho `UNDERPAID`, `EXPIRED`, `FAILED`.
8. Secret rotation protocol, thời gian overlap key cũ/mới và ảnh hưởng tới webhook đang bay.
9. IP allowlist hoặc cơ chế xác thực nguồn bổ sung ngoài HMAC; public docs được kiểm tra chỉ quy định signature.

Các điểm chưa rõ này không chặn implementation local/fake hoặc integration theo contract đã công bố; chúng chặn việc tuyên bố những guarantee mà payOS chưa công bố.

## Nguồn chính thức

[api]: https://payos.vn/docs/api/
[getting-started]: https://payos.vn/docs/
[return-url]: https://payos.vn/docs/du-lieu-tra-ve/return-url/
[webhook-api]: https://payos.vn/docs/du-lieu-tra-ve/webhook/
[signature]: https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/
[faq]: https://payos.vn/docs/cau-hoi-thuong-gap/
[test-env]: https://payos.vn/docs/moi-truong-test/
[create-channel]: https://payos.vn/docs/huong-dan-su-dung/tao-kenh-thanh-toan/
[python-sdk]: https://payos.vn/docs/sdks/back-end/python/
[py-readme]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/README.md
[py-client]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/_client.py
[py-crypto]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/_crypto/provider.py
[py-payment-resource]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/resources/v2/payment_requests/payment_requests.py
[py-payment-types]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/types/v2/payment_requests/payment_requests.py
[py-webhook-resource]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/resources/webhooks/webhooks.py
