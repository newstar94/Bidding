# Runbook payOS production — BiddingFlow

Mục tiêu của runbook này là bật thanh toán production theo từng bước có thể
dừng lại. Không đặt secret vào tài liệu, Git, log hoặc trình duyệt. Không dùng
redirect `returnUrl` làm bằng chứng thanh toán.

## Điều kiện trước khi bật

- Artifact đã qua toàn bộ CI, có `releaseId` bất biến, checksum và SBOM.
- Database đã đạt schema 98; chạy `python scripts/manage_database.py --preflight`
  và `--dry-run` bằng credential migrator riêng.
- Profile bất biến `provider-payos-production-v2` có `payos / production / live /
  ready` và `env://payos/default`.
- `APP_PUBLIC_URL` là HTTPS public, webhook path được bypass đúng một path khỏi
  Cloudflare Access/WAF challenge, nhưng vẫn giữ HMAC backend.
- Merchant authorization, webhook authorization và quyết định pháp lý thương mại
  đã được chủ sở hữu xác nhận. Các cờ này không thay thế review pháp lý.

## Kiểm tra webhook không tạo giao dịch

Đăng ký chính xác:

`{APP_PUBLIC_URL}/api/billing/providers/provider-payos-production-v2/webhook`

Từ mạng ngoài, payload rỗng phải tới backend trực tiếp và trả lỗi JSON có kiểm
soát (thường 400), không trả 302 Access, HTML challenge hoặc 403 WAF. Payload
sample hợp lệ của payOS chỉ được ACK/persist; không được tạo payment fact,
activation hoặc quota nếu không khớp order thật.

## Trình tự bật

1. Tiêm `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` qua secret
   manager; chỉ giữ reference `env://payos/default` trong cấu hình.
2. Restart ứng dụng và chạy readiness. Lỗi credential/profile phải chặn startup.
3. Bật commercial policy với `COMMERCIAL_POLICY_MODE=enforce`.
4. Bật `PAYMENT_ACTIVATION_ENABLED=true`, giữ
   `PAYMENT_CHECKOUT_ENABLED=false`; theo dõi webhook backlog, review và
   reconciliation.
5. Sau khi activation ổn định, bật checkout. Giao dịch thật phải có phê duyệt
   số tiền và người thực hiện; payOS Payment Request không phải sandbox.
6. Đối chiếu chuỗi: checkout host hợp lệ → thanh toán → webhook đã ký → query
   authoritative → `verified_paid` → activation exactly-once.

## Dừng khẩn cấp và rollback

Để ngừng bán mới nhưng tiếp tục xử lý order đã tạo:

`PAYMENT_CHECKOUT_ENABLED=false`

giữ `PAYMENT_ACTIVATION_ENABLED=true` cho đến khi webhook/reconciliation không
còn backlog. Không xóa order, webhook event, payment transaction, provider
profile hoặc activation ledger. Rollback code phải giữ schema và dữ liệu tương
thích; nếu migration không đảo ngược được, khôi phục vào bản sao cô lập trước
khi quyết định cutover.

## Bằng chứng cần lưu

Lưu ngoài artifact và không chứa secret: release ID/checksum, migration preflight,
readiness, webhook confirmation, smoke log, worker health, backup/restore drill,
và người phê duyệt go/no-go. Thiếu host/DNS/TLS/secret/merchant evidence nghĩa
là chưa được phép tuyên bố production-ready.
