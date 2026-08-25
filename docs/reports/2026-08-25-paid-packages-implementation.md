# Báo cáo triển khai paid packages — 2026-08-25

## Đã triển khai

- Schema/migration v79 cho commercial releases/drafts/projections, quotes/orders,
  provider commands, payment evidence/webhook inbox/activation/refund intent,
  usage grants/reservations/ledger, invoice request và outbox.
- Legacy release non-sellable và plan-version backfill bảo toàn exact dates,
  member quota và export entitlement; không tự publish offer sellable.
- Closed commercial document với 8 offer, 4 credit pack, savings tính động,
  validation/impact, CAS draft, publish/schedule, clone và stop-sales.
- Public offer projection + compatibility adapter `/api/public/packages`; mutation
  catalog cũ bị disable trong enforce mode.
- Quote bất biến; checkout/order intent và durable Fake Provider command; personal
  order history/cancel seam. Organization history chưa được mở khi quyền đọc chưa
  chốt.
- Fake Provider và payOS shadow adapter: create/get/cancel/signature/allowlist,
  ambiguous-timeout reconciliation contract; refund capability false.
- Usage-credit module FEFO theo exact source revision, reserve/consume/release và
  lease reaper; partial batch blocked trước external fetch.
- Control Center riêng đồng bộ Workbench/cobalt/Plus Jakarta Sans/4–8px tokens,
  responsive và accessible loading/error/status.
- Startup flags/readiness, runbook, threat model, hướng dẫn Super Admin và nghiên
  cứu payOS nguồn sơ cấp.

## Mặc định vận hành

Toàn bộ commercial/payment/quota flags tắt. Không có giao dịch thật, không đăng
ký webhook production và không bật live activation.

## Chưa thể nghiệm thu live

- Ba quyết định nghiệp vụ vẫn là `BLOCKED_DECISION`: base yearly/renewal,
  partial batch và organization billing-history read authorization.
- External readiness thuế/hóa đơn, pháp lý, merchant/credential/webhook chưa có.
- PostgreSQL 17 generator không chạy được trong môi trường hiện tại; committed
  schema catalog vẫn v78 và phải được sinh lại bằng fresh database v79 trước CI.
- Full live-payment E2E/soak không được giả lập thành pilot thật.

## Evidence tại thời điểm báo cáo

- Commercial/runtime/provider/usage/startup focused tests: 56 passed (one
  PostgreSQL-dependent case skipped without test DB).
- Migration/startup/preflight chain: 40 passed, 13 skipped vì không có test DB.
- Route composition: 6 passed.
- Frontend module graph, ESLint/Trusted Types, route CSS và mojibake guard: passed.
- PostgreSQL catalog test: 1 expected failure do committed artifact v78; Docker
  daemon/test PostgreSQL không khả dụng.
