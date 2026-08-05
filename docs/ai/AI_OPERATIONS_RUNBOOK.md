# Operations runbook

## Bật/tắt

Đặt `AI_ENABLED=false` để rollback tức thời; frontend không mount panel và API trả `AI_DISABLED`. Restart worker/app sau khi đổi env.

## Cấu hình

Biến chung: `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_VERSION`, `AI_PROVIDER_VERSION`, `AI_AUTH_TYPE`, `AI_MAX_OUTPUT_TOKENS`, `AI_REQUEST_TIMEOUT_SECONDS`, `AI_TOOL_TIMEOUT_SECONDS`, `AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_TOKEN_LIMIT`, `AI_CONVERSATION_RETENTION_DAYS`, `AI_PROVIDER_STORE_RESPONSES`.

`OPENAI_API_KEY`/`OPENAI_BASE_URL` tiếp tục là fallback tương thích ngược. Anthropic, Gemini, Ollama và Azure cũng chấp nhận các tên env riêng được liệt kê trong [AI_PROVIDER_ADAPTERS.md](AI_PROVIDER_ADAPTERS.md).

## Sự cố provider

Kiểm tra `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_TIMEOUT`, `AI_RATE_LIMITED`, latency và quota. Xác minh `AI_PROVIDER`, model, base URL, auth type và API version khớp cùng một giao thức. Tắt flag nếu provider lỗi kéo dài; không retry vô hạn ở frontend.

## Dữ liệu/audit

Conversation được soft delete và cleanup theo retention. Audit không chứa prompt/raw result. Khi rotate key, thay secret ở backend secret store, không sửa database/frontend.

## Rollback

Rollback application code theo quy trình deploy hiện có. Migration v38 tạo bảng độc lập; giữ bảng khi rollback app để tránh mất audit/conversation, hoặc cleanup theo retention được phê duyệt.
