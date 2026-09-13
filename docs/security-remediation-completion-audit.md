# Security remediation completion audit

Ngày xác minh: 2026-09-13

## Kết quả

| Finding | Trạng thái | Thay đổi | Bằng chứng |
|---|---|---|---|
| Replay nonce process-local | fixed locally | Chuẩn Hóa dùng PostgreSQL `admin_integration_replay_nonces`, primary key `(client_id, nonce)`, expiry index và insert-if-absent | V003 migration; persistence harness 7 passed |
| HMAC body serialize lại | fixed | Controller xác minh exact raw UTF-8 request bytes trước deserialize | API contract Unicode test; 36 API tests passed |
| Query không được ký | fixed | Client/server ký path + query string | Bidding integration query/tamper tests |
| Cross-app mutation authorization race | fixed locally | Tái `verify_session(..., fresh=True)` và kiểm tra mapping ngay trước dispatch | regression test revoke-before-upstream |
| AI session snapshot cũ | fixed locally | `build_request_context` fresh-reload session ở mỗi tool boundary | AI/session regression suite |
| Development Admin reverse-proxy boundary | deferred | Chưa thay đổi vì cần quyết định topology/proxy trust production | Production topology chưa được cung cấp |

## Gates

- Bidding Python: `2393 passed, 1 skipped`, coverage `64.85%`, critical ratchet
  `18 modules` pass.
- Bidding JS coverage: pass, critical ratchet `14 modules` pass.
- `npm run lint:security`: pass.
- `npm run audit:vendor`: pass.
- `npm run lint:modules`: pass, 356 modules, 0 cycles.
- Bidding targeted security/integration/AI tests: `33 passed`.
- Chuẩn Hóa solution: `504 passed`.
- Chuẩn Hóa API tests: `36 passed`.
- Chuẩn Hóa build: 0 warning, 0 error.
- PostgreSQL persistence: `7 passed`, V001/V002/V003 applied and asserted.
- `git diff --check`: pass ở cả hai repository.

## Compatibility và migration

Các thay đổi không mở rộng quyền đọc, không thay đổi masking/redaction,
tenant/module/assignment/record scope, Word entitlement hoặc semantics billing.
V003 là migration additive; rollback chỉ xóa bảng replay nonce mới trong môi
trường rollback được phê duyệt. V002 và dữ liệu cũ không bị sửa.

## Giới hạn

Chưa chạy production migration/deploy, production multi-replica traffic,
production proxy topology hoặc payment thật. Dependency advisory scan và local
test evidence không thay thế production security review.
