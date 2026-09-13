# Bổ sung bắt buộc cho prompt xử lý bảo mật

Thêm hai finding P2 sau vào phạm vi triển khai của
`PROMPT_SECURITY_REMEDIATION_BIDDING_CHUAN_HOA.md`.

## P2 — Tái xác minh quyền trước mutation liên ứng dụng

`backend/admin/platform_chuan_hoa_routes.py` kiểm tra session trước khi đọc
body rồi mới gọi mutation upstream. Session bị revoke hoặc role bị hạ trong lúc
POST chờ body vẫn có thể làm lệnh entitlement được gửi đi.

Yêu cầu tái xác minh session, role, mapped Super Admin và target scope ngay
trước dispatch; không tin snapshot cũ; giữ actor server-side, audit,
idempotency và không retry sau khi mất quyền.

Bắt buộc test revoke session, hạ role/bỏ mapping trong lúc đọc body, timeout
upstream và mutation hợp lệ đúng một lần.

## P2 — Revalidate session ở mỗi AI tool execution

`backend/auth/auth_helper.py` cache user snapshot trong một request và
`backend/ai/tool_executor.py` chỉ đối chiếu user/workspace ID. AI stream dài có
thể tiếp tục gọi tool sau khi session bị revoke, hết hạn hoặc role/workspace
thay đổi.

Yêu cầu revalidate session/revocation/expiry/quyền ở server cho từng tool call;
thất bại phải dừng tool chain; không thay đổi tenant, assignment, record scope
hoặc dữ liệu người dùng hợp lệ được phép đọc; không đưa auth internals vào AI
payload.

Bắt buộc test revoke/expiry/role/workspace change giữa hai tool calls, giữ scope,
tool failure, prompt injection, redaction và audit-safe payload.
