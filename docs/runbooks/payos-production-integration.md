# Runbook — kích hoạt payOS production

## Trạng thái sau khi triển khai code

Adapter Payment Request, xác minh chữ ký response/webhook, durable inbox,
reconciliation và activation exactly-once đã có sẵn. Migration v80 bổ sung
profile bất biến `provider-payos-production-v2` ở chế độ `live/ready`; profile
chỉ lưu tham chiếu `env://payos/default`, không lưu secret.

Mọi cờ thanh toán vẫn tắt mặc định. Không có request thật nào được gửi cho tới
khi operator tự điền credential, xác nhận webhook và bật các cờ rollout.

## 1. Chuẩn bị payOS

1. Tạo hoặc chọn kênh thanh toán trong payOS và lấy `Client ID`, `API Key`,
   `Checksum Key` từ kênh đó.
2. Triển khai ứng dụng tại một `APP_PUBLIC_URL` HTTPS công khai, ổn định.
3. Đăng ký/xác nhận webhook sau trong payOS:

   ```text
   {APP_PUBLIC_URL}/api/billing/providers/provider-payos-production-v2/webhook
   ```

4. Chỉ đặt `PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED=true` và
   `PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED=true` sau khi merchant đúng và payOS
   xác nhận endpoint thành công.

Không tự động gọi confirm-webhook khi mỗi worker khởi động: đây là mutation cấu
hình bên ngoài và có thể tạo race giữa nhiều instance. Thực hiện nó một lần từ
dashboard/quy trình vận hành payOS.

## 2. Cấu hình môi trường

Giữ secret trong `.env` của deployment hoặc lớp secret injection tạo ra các
biến môi trường tương đương. Không commit giá trị thật.

```dotenv
COMMERCIAL_PAYMENT_PROVIDER=payos
PAYMENT_PROVIDER_ENVIRONMENT=production
PAYOS_CREDENTIAL_REFERENCE=env://payos/default
PAYOS_CLIENT_ID=
PAYOS_API_KEY=
PAYOS_CHECKSUM_KEY=

PAYOS_MERCHANT_AUTHORIZATION_CONFIRMED=true
PAYOS_WEBHOOK_AUTHORIZATION_CONFIRMED=true
COMMERCIAL_EXTERNAL_LEGAL_READY=true
```

`COMMERCIAL_EXTERNAL_LEGAL_READY` là gate hiện hữu; thay đổi này không sửa 27
mục legal hoặc tự xác nhận nội dung pháp lý thay chủ sản phẩm.

## 3. Migration và kiểm tra readiness

1. Chạy migration bằng credential migrator để DB đạt v80.
2. Khởi động web worker với runtime DB role bình thường.
3. Startup phải dừng trước readiness nếu thiếu secret, chọn môi trường khác
   `production`, DB chưa có profile v2, profile không `live/ready`, hoặc
   credential reference không khớp.
4. Không có thông báo lỗi startup nào chứa giá trị credential.

## 4. Trình tự bật

1. Giữ `PAYMENT_CHECKOUT_ENABLED=false` và
   `PAYMENT_ACTIVATION_ENABLED=false` khi kiểm tra startup/config.
2. Bật `COMMERCIAL_POLICY_ENABLED=true` và
   `COMMERCIAL_POLICY_MODE=enforce` theo runbook commercial hiện hữu.
3. Bật `PAYMENT_ACTIVATION_ENABLED=true` để worker có thể nhận, query và xử lý
   evidence của order đã tạo.
4. Bật `PAYMENT_CHECKOUT_ENABLED=true` để mở checkout mới.
5. Thực hiện một giao dịch giá trị nhỏ có phê duyệt. Kiểm tra:
   checkout URL thuộc đúng host payOS; webhook được ACK; worker query lại
   provider; order chuyển `verified_paid`; activation chỉ được áp dụng một lần.

payOS không công bố sandbox riêng cho Payment Request. Automated test phải tiếp
tục dùng fake provider/transport; smoke test bằng credential thật có thể phát
sinh tiền thật.

## 5. Redirect, webhook và rollback

- `returnUrl` và `cancelUrl` chỉ đưa trình duyệt về trang lịch sử thanh toán.
  Query string redirect không bao giờ xác minh payment hoặc kích hoạt gói.
- Chỉ chữ ký webhook hợp lệ mới được đưa vào inbox; worker vẫn query payOS bằng
  profile đã pin và đối chiếu order code, trạng thái và số tiền trước activation.
- Nếu có sự cố, đặt `PAYMENT_CHECKOUT_ENABLED=false` để ngừng bán mới nhưng giữ
  `PAYMENT_ACTIVATION_ENABLED=true` trong thời gian xử lý webhook/reconcile order
  đã tạo hoặc đã trả.
- Không xóa profile, order, webhook event, payment fact hoặc activation ledger.

Chi tiết contract API và nguồn chính thức nằm tại
`docs/research/2026-08-26-payos-production-integration.md`.
