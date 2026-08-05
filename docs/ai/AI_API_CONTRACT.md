# API contract

- `GET /api/ai/config` → `{ enabled, modes, capabilities, streaming, readOnly }`.
- `POST /api/ai/conversations` body `{ mode }`.
- `GET /api/ai/conversations` → lịch sử trong user/workspace hiện tại.
- `GET /api/ai/conversations/{id}` → conversation + messages trong đúng scope.
- `GET /api/ai/conversations/{id}/messages?limit=40&offset=0` → tin nhắn phân trang trong đúng scope.
- `DELETE /api/ai/conversations/{id}` → soft delete.
- `POST /api/ai/conversations/{id}/messages` body `{ content }`, trả SSE.
- `POST /api/ai/feedback` body `{ messageId, rating, category, comment }`.
- `GET /api/ai/suggested-questions?route=...` → câu hỏi theo route.

SSE event gateway: `message.started`, `message.delta`, `tool.started`, `tool.completed`, `source.added`, `message.completed`, `message.failed`.

Error code dùng `AI_DISABLED`, `AI_AUTH_REQUIRED`, `AI_PERMISSION_DENIED`, `AI_CONVERSATION_NOT_FOUND`, `AI_CONVERSATION_SCOPE_MISMATCH`, `AI_SCOPE_VALIDATION_FAILED`, `AI_INVALID_MESSAGE`, `AI_RATE_LIMITED`, `AI_QUOTA_EXCEEDED`, `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_TIMEOUT`, `AI_TOOL_NOT_ALLOWED`, `AI_TOOL_INVALID_ARGUMENTS`, `AI_TOOL_TIMEOUT`, `AI_TOOL_FAILED`, `AI_DATA_UNAVAILABLE`, `AI_SOURCE_UNAVAILABLE`, `AI_UNSUPPORTED_MODE`.
