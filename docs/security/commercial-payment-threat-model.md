# Threat model — commercial policy, billing và usage credits

| Mối đe dọa | Kiểm soát bắt buộc |
|---|---|
| Sửa giá/quyền lợi từ client | Server resolve release/SKU/price; quote và order pin snapshot/checksum |
| Publish stale draft | CAS revision, validation digest exact revision, readiness TTL, recent re-auth |
| SSRF/checkout redirect | payOS API origin và checkout host exact allowlist; callback do server dựng |
| Webhook giả/replay | Bounded body, profile-version routing, HMAC constant-time, durable dedupe inbox, provider GET reconciliation |
| Timeout tạo checkout | Stable provider order code, durable command, query cùng code trước retry |
| Double activation/debit | Owner-first lock order, unique order/activation/transaction/reservation, immutable ledger |
| Cross-tenant billing read | Personal query khóa exact account; organization history giữ `BLOCKED_DECISION` |
| Lộ secret | Credential ở secret manager/env adapter; policy/API/UI chỉ có alias/readiness |
| Refund vượt payment | Manual intent, recent re-auth, verified payment invariant, audit; payOS refund unsupported |
| Quota âm/partial batch mơ hồ | FEFO row locks, reserved/remaining checks, exact revision identity; dừng trước external fetch khi policy blocked |
| Thay đổi quyền/hiển thị gián tiếp | Commercial schema từ chối record-read/masking capability; regression full-record/authority giữ nguyên |

Redirect/cancel URL chỉ cập nhật UX và poll server, không phải payment evidence.
Payment đã xác minh vẫn được giữ như fact khi order local cancel/expire; policy timing
quyết định activation hoặc review. Stop-sales chỉ dừng giao dịch mới và không thu
hồi subscription/grant đã áp dụng.
