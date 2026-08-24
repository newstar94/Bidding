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
# Compliance target extension (bundle v1)

`POST /api/ai/conversations/{conversationId}/messages` nhận thêm optional untrusted `targetHint`:

```json
{"targetType":"goithau","targetId":"package-root","versionId":"package-v2"}
```

Chỉ mode `procurement_advice` dùng hint này. Khi hai feature flag legal/compliance bật, mode có đúng một tool target-aware `get_compliance_context` với cùng ba trường strict, `additionalProperties=false`. Server fresh-authorize exact version và từ chối tool target khác hint. Tool chỉ đọc, trả `DeterministicComplianceSnapshot`; không có write/approve/publish/sign/change-state action.
