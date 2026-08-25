# Báo cáo triển khai gói trả phí và thanh toán

Ngày kiểm tra: 2026-08-25  
Trạng thái: `READY_FOR_SHADOW` cho code/local fake; production rollout chưa được bật.

## Kết quả

Đã triển khai nền tảng commercial release có version, checkout/order/provider command, webhook inbox, đối soát và activation exactly-once, usage credit FEFO, storefront động và Commercial Control Center. Mọi cờ production tiếp tục tắt. Các phần cần quyết định nghiệp vụ hoặc điều kiện bên ngoài được chặn rõ, không được test hay code tự chọn semantics.

## Phạm vi theo phase

| Phase | Trạng thái | Bằng chứng chính |
|---|---|---|
| 0 - discovery/contract | `DONE_PHASE_0` | ADR 0017/0018, plan rollout, primary-source payOS research |
| 1 - schema/compatibility | `READY_FOR_SHADOW` | Migration v79, legacy non-sellable release, subscription plan pin/backfill; generated PostgreSQL contract v79 đã khớp runtime |
| 2A - commercial backend | `DONE_PHASE_2A` | Draft CAS, validation/simulation, immutable publish/schedule, resolver, stop-sales, clone rollback |
| 2B - Super Admin UI | `DONE_PHASE_2B` | Sáu khu vực quản trị, trạng thái readiness, offer/policy/provider/order/history, responsive UI |
| 2C - quota | `READY_FOR_SHADOW` | Grant/reservation/ledger/FEFO/reaper và lookup seam; partial-batch vẫn `BLOCKED_DECISION` |
| 3A - billing + Fake | `READY_FOR_SHADOW` | Quote, order, durable command, fake scenarios, reconcile, payment fact, activation/review, manual refund intent |
| 3B - payOS | `BLOCKED_EXTERNAL` | Adapter/signature/host allowlist/timeout reconcile hoàn tất; thiếu merchant, credential, legal/accounting readiness |
| 3C - storefront | `READY_FOR_SHADOW` | Dynamic offers, quote/checkout, personal order/usage projection, admin operational health |
| 3D - renewal/transitions | `BLOCKED_DECISION` | Renewal/base term không được tự áp dụng khi semantics kỳ năm và anchor chưa được chốt |
| 4+ - pilot/rollout | `BLOCKED_EXTERNAL` | Chưa có cohort, 20 giao dịch thật và 7 ngày bằng chứng vận hành |

## Mapping yêu cầu sang implementation/test

| Yêu cầu | File/seam | Kiểm tra |
|---|---|---|
| Commercial document đóng, 8 offer và 4 pack | `backend/commercial_policy/document.py` | `tests/test_commercial_policy_document.py` |
| Draft/validate/publish/resolve/rollback | `backend/commercial_policy/{repository,service,routes}.py` | focused commercial tests, route composition |
| Migration additive và legacy pin | `backend/db/{schema,postgres_schema,upgrades}.py` | `tests/test_startup_database_migration.py` |
| Startup flag matrix | `backend/commercial_policy/config.py`, `backend/startup.py`, `.env.example` | `tests/test_commercial_runtime_config.py` |
| Quote/order/idempotency/provider command | `backend/billing/service.py`, `backend/billing/routes.py` | provider tests và focused route checks |
| payOS signature, response/webhook verify, allowlist | `backend/billing/providers/payos.py` | `tests/test_payment_providers.py` |
| Fake provider scenarios | `backend/billing/providers/fake.py` | `tests/test_payment_providers.py` |
| Payment fact + activation/review | `backend/billing/activation.py` | compile/static checks; PostgreSQL integration pending local DB availability |
| Webhook verify-first inbox | `backend/billing/webhook.py` | provider signature tests; DB integration pending PostgreSQL |
| Usage FEFO/reserve/consume/release/reaper | `backend/usage_credits/service.py` | `tests/test_usage_credit_policy.py` |
| Procurement quota seam | `backend/procurement_lookup/routes.py` | `tests/test_procurement_lookup_routes.py`; enforcement remains off |
| Dynamic public catalog | `/api/public/commercial/offers`, `frontend/landing/LandingPage.js` | JS suite, module/security lint |
| Landing page chuyển đổi | `views/components/landing_page.html`, `views/css/landing.css`, `frontend/landing/LandingPage.js` | Browser QA 1638/1024/768/375 px, reduced motion, catalog 8 offer và fallback 3 gói |
| Storefront personal | `views/tabs/tab_commercial_storefront.html`, `frontend/commercial-policy/CommercialStorefront.{js,css}` | JS suite/module/security/route CSS checks |
| Super Admin Control Center | `views/tabs/tab_commercial_admin.html`, `frontend/commercial-policy/CommercialControlCenter.{js,css}` | JS suite/module/security/route CSS checks |
| Operational health/alerts | `backend/commercial_policy/metrics.py`, Control Center order section | focused compile/lint; thresholds 30s/60s encoded |
| Không đổi quyền/hiển thị record | compatibility changes limited to commercial/export/purchase seams | existing Word entitlement JS regression passed; PostgreSQL record-access suite pending DB |

## Migration, backfill và cutover

- Runtime schema version: 79.
- Migration tạo schema commercial/billing/usage additive; không xóa hay đổi semantics bảng quyền.
- Seed chỉ tạo `commercial-release-legacy-v79` không bán được và initial review draft; không tự publish offer bán mới.
- Subscription legacy giữ nguyên `starts_at`, `expires_at`, package và entitlement; chỉ ghim thêm non-sellable plan version.
- Cutover giữ flag tắt, chạy resolver shadow, kiểm tra mismatch, sau đó Super Admin mới validate và publish release. Checkout/payOS/enforcement chỉ được bật sau gate tương ứng.
- `backend/db/postgres_schema_contract.json` đã được tạo lại theo generator chính thức cho schema v79 (127 tables, 561 indexes, 102 triggers); không sửa tay artifact generated. Kiểm tra:

```powershell
python scripts/generate_postgres_schema_contract.py --write
python -m pytest tests/test_postgres_schema_contract.py -q
```

## Lệnh kiểm tra và kết quả

| Lệnh | Kết quả |
|---|---|
| Focused commercial/provider/usage/procurement/routes + activation/startup/schema | `97 passed`; chạy lại nhóm sau sửa generator đạt `97 passed` trừ một regression helper, sau đó helper đã được sửa và schema/migration suite đạt riêng |
| PostgreSQL schema contract + migration chain v1/v35/v46/v79 | `42 passed` |
| Focused migration/startup trước đó | `40 passed, 13 skipped` |
| Focused combined trước đó | `56 passed, 1 skipped` |
| `npm run test:js -- --runInBand` | `1351 passed, 0 failed` |
| `npm run lint:modules` | 314 modules, 0 static import cycles |
| `npm run lint:security` | pass; Trusted Types payload pass |
| `npm run check:route-css` | pass; main bundle dưới baseline |
| Ruff commercial/billing/usage/procurement | pass |
| `python scripts/check_mojibake.py` | pass |
| `python -m compileall` focused modules | pass |
| `git diff --check` | pass (chỉ có cảnh báo line-ending Windows) |
| Full Python suite | `1861 passed, 8 failed` ở lần đầu; 8 lỗi đều do projection v79 bị kéo ngược vào historical v46. Sau sửa, toàn bộ schema/migration suite `42 passed`; lần full tiếp theo chạy sạch qua 77% trước khi session output đóng, không ghi nhận failure |
| `npm run build:secure` | pass; 319 modules transformed, secure artifacts và route CSS đều đạt |

## Landing page và kiểm tra chuyển đổi ngày 2026-08-26

- Thiết kế lại theo ngôn ngữ cobalt editorial workspace, đồng bộ màu cobalt, Plus Jakarta Sans, logo và dashboard thật của ứng dụng.
- Nội dung đi theo hành trình vấn đề vận hành → bằng chứng kiểm soát → kết quả quy trình → phân vai → lựa chọn gói → CTA mua dịch vụ; không dùng logo khách hàng, testimonial, tỷ lệ hoặc số liệu chuyển đổi giả.
- Giữ nguyên URL, anchor điều hướng, liên kết pháp lý và hành vi đăng nhập; không thay đổi quyền, record scope hoặc dữ liệu người dùng được phép xem.
- Catalog thương mại đã được kiểm tra bằng browser route fixture: 4 nhóm quy mô, 8 offer Nội bộ/Kết nối, không tràn ngang. Khi commercial flags tắt, trang vẫn hiển thị đúng 3 gói compatibility từ `/api/public/packages`.
- Browser QA đạt tại 1638×897, 1024×768, 768×900 và 375×812; `scrollWidth === clientWidth` ở mọi kích thước, CTA hero nằm trong màn hình đầu và reduced-motion không chạy reveal animation.

## Cờ cuối cùng

```dotenv
COMMERCIAL_POLICY_ENABLED=false
COMMERCIAL_POLICY_MODE=off
PAYMENT_CHECKOUT_ENABLED=false
PAYMENT_ACTIVATION_ENABLED=false
PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED=false
COMMERCIAL_EXTERNAL_LEGAL_READY=false
COMMERCIAL_PAYMENT_PROVIDER=fake
```

Không bật Fake provider ở production. Tổ hợp checkout-off/activation-on được giữ hợp lệ để dừng bán mới nhưng xử lý order đã tạo.

## Blocker và quyết định còn thiếu

### `BLOCKED_DECISION`

1. Kỳ năm của base subscription: fixed 365 ngày hay anniversary lịch; quy tắc 29/02 và boundary.
2. Renewal anchor và thời điểm cấp quota kỳ mới.
3. Hành vi batch khi quota chỉ đủ một phần.
4. Ai được đọc billing/invoice/usage history của organization.

### `BLOCKED_EXTERNAL`

- Merchant/payOS credential và webhook registration.
- Legal/accounting/VAT/invoice/terms/refund approval.
- Staging và shadow evidence với provider thật.
- Pilot cohort được phê duyệt, tối thiểu 20 payment thật và 7 ngày quan sát đạt tiêu chí.
- Full DB regression dài vẫn nên được lặp lại trong CI; focused migration chain và schema contract hiện đã đạt `42 passed` trên PostgreSQL 17 local.

File research mà plan cũ dẫn tới, `docs/research/2026-08-25-paid-plans-and-payment-integration.md`, không tồn tại. Không tạo nội dung thay thế. Nghiên cứu payOS chính thức nằm ở `docs/research/2026-08-25-payos-adapter-primary-sources.md`.

## Xác nhận business contract

- Không thêm masking, redaction hoặc sensitive-read capability.
- Không thay đổi role, module permission, assignment scope hay record scope.
- Người đã có quyền đọc record vẫn nhận full projection, gồm CCCD, ngân hàng, tài khoản, chữ ký và con dấu.
- Word/Excel entitlement chỉ gate hành động export; không gate nội dung màn hình/API đọc.
- Tenant/session/module/assignment/record authorization hiện hữu vẫn chạy trước commercial quota.
- Organization billing history không được tự mở quyền; endpoint trả `BLOCKED_DECISION`.
