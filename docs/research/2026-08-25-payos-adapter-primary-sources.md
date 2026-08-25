# payOS Payment Request adapter — xác minh từ nguồn sơ cấp

- Ngày truy cập nguồn: **2026-08-25**
- Phạm vi: Payment Request `create/get/cancel`, chữ ký request/response/webhook, hợp đồng dữ liệu, `orderCode`, retry/timeout/đối soát, môi trường và host, khả năng hoàn tiền.
- Giới hạn: chỉ đọc tài liệu và mã nguồn chính thức của payOS; không dùng credential, không gọi API giao dịch, không đăng ký webhook và không thực hiện thanh toán thật.

## Kết luận phục vụ implementation

1. Payment Request công khai có đúng ba mutation/query cốt lõi cần adapter: tạo link, lấy thông tin và hủy link. Cả `get` và `cancel` nhận `orderCode` dạng số hoặc `paymentLinkId` dạng chuỗi. Response thành công có chữ ký trên `data`, và SDK chính thức xác minh chữ ký đó cho cả ba operation. [API reference][api] [Python Payment Requests resource][py-payment-resource]
2. Chữ ký tạo link là HMAC-SHA256 của đúng năm trường theo chuỗi cố định `amount&cancelUrl&description&orderCode&returnUrl`. Chữ ký response và webhook dùng canonicalization tổng quát: ký **chỉ object `data`**, sắp key tăng dần, nối `key=value` bằng `&`, không URI-encode theo quy tắc Payment Request. [Hướng dẫn chữ ký][signature-doc] [Python crypto implementation][py-crypto]
3. Public Payment Request API không công bố `x-idempotency-key`; header này chỉ được tài liệu ghi rõ cho Payout. Vì vậy timeout của `create` là kết quả chưa xác định: phải giữ nguyên `orderCode`, truy vấn lại theo mã đó rồi mới quyết định tiếp, không tạo order/provider attempt mới một cách mù quáng. [API reference][api]
4. payOS không có sandbox/staging riêng; tài liệu chỉ công bố production API `https://api-merchant.payos.vn`. Test thật sẽ dùng production và tiền thật, nên BiddingFlow phải dùng fake provider/fixture cho automated tests; mọi smoke test thật vẫn là external gate cần chủ sản phẩm cho phép. [Môi trường test][test-env] [API reference][api]
5. Tại ngày truy cập, API reference mới nhất và official SDK không có refund operation trong Payment Requests. `cancel` chỉ hủy payment link, không phải hoàn/đảo một khoản đã thanh toán. Adapter phải báo `REFUND_NOT_SUPPORTED` và giữ refund ở manual review cho tới khi payOS cung cấp quy trình/API merchant cụ thể. [API reference][api] [Python Payment Requests resource][py-payment-resource]

## 1. Hợp đồng endpoint và xác thực

| Operation | HTTP | Xác thực | Input chính | Response `data` |
|---|---|---|---|---|
| Create | `POST /v2/payment-requests` | `x-client-id`, `x-api-key`; `x-partner-code` chỉ khi tham gia partner program | `orderCode`, `amount`, `description`, `cancelUrl`, `returnUrl`, `signature`; optional buyer/items/invoice/`expiredAt` | thông tin nhận tiền, `orderCode`, `currency`, `paymentLinkId`, `status`, `checkoutUrl`, `qrCode`, optional `expiredAt` |
| Get | `GET /v2/payment-requests/{id}` | `x-client-id`, `x-api-key` | `{id}` là merchant `orderCode` hoặc payOS `paymentLinkId` | `id`, `orderCode`, amount summary, `status`, `createdAt`, `transactions`, cancellation fields |
| Cancel | `POST /v2/payment-requests/{id}/cancel` | `x-client-id`, `x-api-key` | optional `{ "cancellationReason": string }` | cùng shape Payment Link, có thể có `canceledAt` và `cancellationReason` |

Nguồn: [payOS API reference][api]. API công bố `200`, `401` và `429` cho ba endpoint này; code phải vẫn xử lý mọi non-2xx/invalid JSON/invalid signature như provider failure, không chỉ ba status mẫu.

Raw response thành công có envelope:

```json
{
  "code": "00",
  "desc": "success",
  "data": {},
  "signature": "hex-hmac"
}
```

SDK chính thức chỉ coi `code == "00"` là thành công, xác minh `signature` trên `data`, rồi mới cast/unpack `data`. Thiếu hoặc sai response signature phải là lỗi integrity, không được degrade thành warning. [Python client response verification][py-client]

### Create request

Theo public schema, các trường bắt buộc là:

- `orderCode: integer`
- `amount: integer`
- `description: string`
- `cancelUrl: URI`
- `returnUrl: URI`
- `signature: string`

Các trường optional gồm buyer name/company/tax/address/email/phone, `items`, `invoice` và `expiredAt`. `expiredAt` là Unix timestamp kiểu Int32. Item gồm `name`, `quantity`, `price`, optional `unit`, `taxPercentage`; official SDK giới hạn tax percentage trong `-2 | -1 | 0 | 5 | 10`. Tài liệu cũng cảnh báo `description` tối đa 9 ký tự nếu tài khoản ngân hàng không liên kết qua payOS. [API reference][api] [Python Payment Request types][py-payment-types]

Create `data` gồm:

```text
bin, accountNumber, accountName, amount, description, orderCode,
currency, paymentLinkId, status, expiredAt?, checkoutUrl, qrCode
```

Không tin `checkoutUrl` như một URL tùy ý: xem allowlist host ở mục 5.

### Get/cancel Payment Link

Official SDK định nghĩa:

```text
id, orderCode, amount, amountPaid, amountRemaining, status,
createdAt, transactions[], cancellationReason?, canceledAt?
```

Tập trạng thái SDK hiện hành là:

```text
PENDING | CANCELLED | UNDERPAID | PAID | EXPIRED | PROCESSING | FAILED
```

Mỗi transaction có `reference`, `amount`, `accountNumber`, `description`, `transactionDateTime` và các trường virtual/counter account optional. [Python Payment Request types][py-payment-types]

Lưu ý contract: sample render trong API page hiển thị `transactions: {}`, còn official SDK/type và tests dùng `transactions[]`. Adapter nên parse theo `Transaction[]` của SDK; nếu muốn tolerant với `{}` rỗng thì chỉ normalize đúng trường hợp rỗng và phải có regression test, không đoán shape transaction không rỗng.

## 2. Chữ ký create, response và webhook

### Create Payment Request

Canonical string là chính xác:

```text
amount={amount}&cancelUrl={cancelUrl}&description={description}&orderCode={orderCode}&returnUrl={returnUrl}
```

Sau đó tính HMAC-SHA256 bằng Checksum Key và xuất lowercase hex. Đây là danh sách năm trường cố định; buyer/items/invoice/`expiredAt` không tham gia chữ ký create hiện hành. Không URL-encode value và không serialize lại URL theo cách làm thay đổi byte so với payload JSON. [API reference][api] [FAQ chính thức][faq] [Python crypto implementation][py-crypto]

### Response và webhook

Với Payment Request response và webhook:

1. Lấy đúng object `data`, không ký toàn envelope `code/desc/success/data/signature`.
2. Sắp key top-level theo thứ tự tăng dần.
3. Chuyển thành `key=value`, nối bằng `&`.
4. `null` và chuỗi sentinel `"null"`/`"undefined"` thành chuỗi rỗng; code JavaScript mẫu bỏ actual `undefined`.
5. Nếu value là array, giữ thứ tự phần tử, sắp key trong mỗi object phần tử rồi JSON stringify compact, Unicode không escape theo implementation chính thức.
6. HMAC-SHA256 với Checksum Key; so sánh signature theo lowercase hex. Trong code BiddingFlow nên dùng constant-time comparison.

Nguồn normative và implementation: [hướng dẫn chữ ký payOS][signature-doc], [Python crypto implementation cố định theo commit][py-crypto]. Tài liệu cảnh báo signature của Payout khác Payment Requests; không tái sử dụng canonicalizer Payout. [Hướng dẫn chữ ký][signature-doc]

Webhook outer shape gồm `code`, `desc`, optional/required-tùy-version `success`, `data`, `signature`. `data` có:

```text
orderCode, amount, description, accountNumber, reference,
transactionDateTime, currency, paymentLinkId, code, desc,
counterAccountBankId?, counterAccountBankName?, counterAccountName?,
counterAccountNumber?, virtualAccountName?, virtualAccountNumber?
```

Nguồn: [Webhook API][webhook-api] [Python Webhook types][py-webhook-types]. Endpoint merchant trả HTTP 2xx để xác nhận đã nhận webhook. [Webhook API][webhook-api]

`returnUrl`/`cancelUrl` chỉ nhận query params `code`, `id`, `cancel`, `status`, `orderCode`; tài liệu không mô tả signature cho query này. Redirect chỉ được dùng cập nhật UX rồi poll server, tuyệt đối không kích hoạt subscription/quota. [Return URL contract][return-url]

## 3. `orderCode`, idempotency và create không chắc kết quả

### Điều payOS thực sự công bố

- `orderCode` của create chỉ được public schema mô tả là `integer`; official Python type là `int`, Node là `number`, Java là `long`.
- Tài liệu công khai không nêu min/max, số chữ số, bắt buộc dương hay uniqueness scope. Không biến timestamp sample hoặc giới hạn ngôn ngữ thành provider contract.
- `GET` và `cancel` cho phép lookup bằng `orderCode` hoặc `paymentLinkId`. [API reference][api]
- Create Payment Request không có documented idempotency header. Ngược lại, cùng API page ghi `x-idempotency-key` bắt buộc cho Payout, nên không được suy diễn header đó có hiệu lực cho Payment Request. [API reference][api]

### Implication cho code

Đây là suy luận resilience của BiddingFlow, không phải cam kết idempotency từ payOS:

- Sinh và persist một `provider_order_code` integer ổn định trước outbound call; unique trong provider profile/channel và không tái sử dụng cho business order khác.
- Chọn range tương thích mọi runtime/DB đang dùng. Nếu mã đi qua JavaScript, validate `Number.isSafeInteger`; đây là giới hạn runtime của BiddingFlow, không phải constraint payOS.
- Không lấy `Date.now()`/Unix seconds đơn thuần làm allocator vì có thể collision khi concurrent; dùng DB sequence/counter hoặc mapping deterministic có unique constraint.
- Nếu create timeout, connection reset hoặc 5xx sau khi có thể đã gửi body: đánh dấu `CREATE_OUTCOME_UNKNOWN`, gọi `GET` bằng chính `orderCode`, verify response signature và đối chiếu snapshot. Chỉ retry create sau khi policy/provider evidence cho phép; không đổi `orderCode` để “thử lại”.
- GET có thể retry với backoff và jitter. Cancel cũng cần query-before/query-after vì public docs không công bố idempotency của cancel.

SDK Python chính thức mặc định timeout 60 giây, tối đa 2 retry và retry timeout/connection error cùng HTTP `408`, `429`, `>=500`. Đây là hành vi SDK, **không phải SLA hay bảo đảm idempotency của service**. Nếu adapter tự quản lý ambiguous create, phải disable/bypass blind SDK retry cho create hoặc bao nó trong state machine có reconciliation. [Python client implementation][py-client] [Python SDK README][py-readme]

## 4. Webhook inbox và reconciliation

payOS yêu cầu 2xx để ACK, trang chính thức về developer nói webhook lỗi có retry, nhưng không công bố retry schedule hoặc unique event ID. [Webhook API][webhook-api] [Trang developer payOS][developer-page]

Do đó BiddingFlow cần:

1. Parse bounded body, verify schema và signature trước khi tin dữ liệu.
2. Persist raw event đã redaction phù hợp cùng canonical business fields vào durable inbox, rồi ACK nhanh; processing/activation chạy ngoài request.
3. Dedupe bằng local composite/inbox identity. `reference` là candidate quan trọng nhưng tài liệu không cam kết uniqueness scope, nên lưu cả provider profile, `paymentLinkId`, `orderCode`, `reference`, amount và payload digest.
4. Với webhook hợp lệ, vẫn `GET` lại Payment Link bằng đúng credential profile đã tạo link; verify response signature và đối chiếu `orderCode`, `paymentLinkId`, expected amount, `amountPaid`, `amountRemaining`, status và transaction reference.
5. Chỉ `PAID` khớp toàn bộ pinned order snapshot mới là candidate activation. `UNDERPAID`, amount lệch, owner/revision lệch, order cancel/expire hoặc status không terminal phải vào review/pending theo business contract.
6. Activation dùng unique ledger/transaction lock để webhook trùng, webhook đến sai thứ tự, poll và reconciliation worker không cấp quyền lợi hai lần.

Merchant identity trong `GET Payment Link` không có field merchant ID. Việc “xác minh merchant” phải dựa trên credential profile đã pin và outbound query bằng chính profile đó; không được giả vờ so một field không tồn tại. `accountNumber/bin/accountName` có ở create response, còn webhook có account number và Payment Link GET không trả currency/merchant ID. Đây là giới hạn cần phản ánh trong adapter/tests. [API reference][api] [Python Payment Request types][py-payment-types]

Đăng ký/cập nhật webhook qua `/confirm-webhook` khiến payOS gửi dữ liệu giao dịch mẫu để kiểm tra endpoint. Vì thế một webhook signature-valid tự nó không đủ để cấp quyền lợi; query-and-match order là gate bắt buộc. Nhiệm vụ nghiên cứu này không gọi endpoint đó. [API reference][api]

## 5. Môi trường, host allowlist và timeout

### Fact từ payOS

- API production: `https://api-merchant.payos.vn`.
- Không có sandbox/staging riêng; test tích hợp trên payOS là production và có thể phát sinh giao dịch thật.
- Create sample trả checkout URL dưới `https://pay.payos.vn/web/...`.
- CSP chính thức cho checkout frontend liệt kê frame host `https://pay.payos.vn/` và `https://next.pay.payos.vn/`.
- Public docs không công bố SLA hay một timeout bắt buộc. SDK chính thức cho phép client/request timeout; Python SDK default là 60 giây và 2 retry, README minh họa cấu hình khác.

Nguồn: [API reference][api] [Môi trường test][test-env] [Checkout Script/CSP][checkout-script] [Python client][py-client] [Python SDK README][py-readme].

### Allowlist đề nghị cho BiddingFlow

Đây là hardening tại adapter seam:

- Production API base URL phải đúng scheme/authority `https://api-merchant.payos.vn`, không wildcard subdomain, không path/userinfo tùy ý và không lấy từ request/UI.
- `checkoutUrl` chỉ chấp nhận HTTPS và exact host `pay.payos.vn` hoặc `next.pay.payos.vn`; reject credential-in-URL, non-default port và host suffix trick.
- `returnUrl`/`cancelUrl` do server dựng từ allowlisted public application origin; không nhận URL thương mại từ client.
- Official SDK cho phép override base URL bằng config/env. Ở production, BiddingFlow phải validate override thành exact official host; fake provider phải là adapter riêng thay vì đổi live payOS base URL sang một host tùy ý.
- Timeout/connect/read budget và retry count là deployment/provider policy có giới hạn. Không ghi giá trị 60 giây của SDK thành SLA payOS. Create timeout đi vào reconciliation; GET retry bounded với jitter và tôn trọng `Retry-After` khi hợp lệ.

## 6. Refund: negative finding có phạm vi

Tại ngày 2026-08-25:

- API reference mới nhất liệt kê Payment Request create/get/cancel, invoice và webhook; không có endpoint refund.
- Official Python Payment Requests resource chỉ expose `create`, `get`, `cancel` và invoices; không có `refund`.
- `cancel` trả trạng thái `CANCELLED` cho payment link. Không có bằng chứng công khai rằng nó đảo một payment `PAID`.
- Payout là sản phẩm/API riêng có authentication/signature/idempotency riêng. Không được map “refund” sang Payout hoặc cancel nếu chưa có merchant contract và phê duyệt nghiệp vụ.

Nguồn: [API reference][api] [Python Payment Requests resource][py-payment-resource]. Đây là **negative finding của public Payment Request API**, không phải tuyên bố rằng payOS không thể hỗ trợ quy trình hoàn tiền qua vận hành/kênh chi/hợp đồng riêng.

Implication: adapter interface có thể khai báo capability `supports_refund = false`; refund command phải dừng ở manual review + re-auth + audit. Nếu sau này payOS cung cấp endpoint/quy trình chính thức, đó là provider protocol/capability mới cần ADR, migration/compatibility impact và regression test; không dùng `cancel` thay thế.

## 7. Test contract tối thiểu

### Crypto và schema

- Golden vector create: đúng thứ tự năm trường; thay từng field làm signature đổi; optional field không tham gia.
- Golden vector webhook từ tài liệu với Checksum Key giả; Unicode UTF-8, empty/null/sentinel, key order ngẫu nhiên, array giữ thứ tự nhưng sort key từng object.
- Ký nhầm toàn envelope, URI-encode, sort array hoặc dùng canonicalizer Payout đều fail.
- Missing/invalid response signature ở create/get/cancel fail integrity.
- Webhook missing field/signature, wrong type, oversized body và invalid UTF-8/JSON bị reject trước inbox trusted state.

### State, retry và reconciliation

- Create success persist đúng `paymentLinkId`, signed data và allowlisted checkout URL.
- Create timeout-before-send và timeout-after-possible-send đều không tạo business order thứ hai; case sau đi GET cùng `orderCode`.
- `429`, `408`, `5xx`, `Retry-After`, retry exhausted và malformed provider response.
- GET theo cả `orderCode` và `paymentLinkId`; mọi status trong official enum.
- Webhook duplicate/out-of-order/race với poll chỉ tạo một activation ledger entry.
- Signed webhook nhưng GET mismatch order/paymentLink/amount/status vào review, không activation.
- Return URL giả `PAID` không activation.
- Cancel query-before/query-after; cancel không được dùng như refund.

### Host và capability

- Reject HTTP, userinfo, port lạ, Unicode/punycode/suffix spoof và host ngoài exact allowlist cho API/checkout.
- Production config từ chối fake/custom payOS base URL.
- Fake adapter chạy toàn bộ E2E mà không có network/credential.
- `refund` trả capability-not-supported và tạo manual review/audit đúng contract; test không sửa expected để giả định payOS có refund.

## 8. Việc phải xác nhận với payOS/merchant trước live shadow

Public docs không đủ để chốt các điểm sau; chúng là external readiness items, không chặn fake/local implementation:

- uniqueness scope/range chính thức của `orderCode` và behavior khi create lặp cùng mã;
- Payment Request create/cancel idempotency guarantee, retry schedule và webhook delivery retention;
- rate-limit cụ thể, SLA/timeout khuyến nghị và quy trình reconciliation/settlement;
- merchant/account identity nào có thể đối chiếu ngoài credential profile;
- quy trình hoàn tiền thực tế, toàn phần/một phần, phí/thời hạn và liệu có API/kênh chi được merchant phê duyệt;
- allowlist checkout host nếu payOS bổ sung host mới ngoài hai host tài liệu frontend hiện hành.

Không bật live checkout/shadow transaction, không đăng ký webhook và không tuyên bố refund support trước khi các item tương ứng có bằng chứng chính thức theo merchant profile.

## Nguồn sơ cấp

Tất cả nguồn dưới đây được truy cập ngày 2026-08-25.

[api]: https://payos.vn/docs/api/
[signature-doc]: https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/
[webhook-api]: https://payos.vn/docs/du-lieu-tra-ve/webhook/
[return-url]: https://payos.vn/docs/du-lieu-tra-ve/return-url/
[test-env]: https://payos.vn/docs/moi-truong-test/
[faq]: https://payos.vn/docs/cau-hoi-thuong-gap/
[checkout-script]: https://payos.vn/docs/sdks/front-end/script-js/
[developer-page]: https://payos.vn/solutions/giai-phap-thanh-toan-danh-cho-developer/
[py-readme]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/README.md
[py-payment-resource]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/resources/v2/payment_requests/payment_requests.py
[py-payment-types]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/types/v2/payment_requests/payment_requests.py
[py-webhook-types]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/types/webhooks/webhook.py
[py-crypto]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/_crypto/provider.py
[py-client]: https://github.com/payOSHQ/payos-lib-python/blob/830f95e95c89ae7c92e361644ce2045ce0f98360/src/payos/_client.py
