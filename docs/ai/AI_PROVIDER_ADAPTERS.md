# AI provider adapters

BiddingFlow dùng một contract nội bộ duy nhất cho mọi AI provider:

```python
stream_response(
    *,
    input_items: list[dict],
    instructions: str,
    tools: list[dict],
) -> Iterable[dict]
```

Adapter chuyển message, function tool, auth và stream riêng của từng hãng về các event `response.*` mà `backend/ai/service.py` đang dùng. Vì vậy đổi provider không làm thay đổi API frontend, giao diện, policy quyền hay tool executor.

## Provider được hỗ trợ

| `AI_PROVIDER` | Giao thức | Ghi chú |
|---|---|---|
| `fake` | Nội bộ deterministic | Không gọi mạng; dùng cho local/smoke test |
| `openai`, `openai_responses`, `responses` | OpenAI Responses | Mặc định cho OpenAI |
| `openai_chat`, `openai_compatible`, `chat_completions` | OpenAI Chat Completions | Dùng cho mọi gateway tương thích Chat Completions |
| `anthropic`, `claude` | Anthropic Messages | SSE, `tool_use`/`tool_result` |
| `gemini`, `google`, `gemini_interactions` | Gemini Interactions | Giao thức Gemini được khuyến nghị cho dự án mới |
| `gemini_generate_content`, `google_generate_content` | Gemini generateContent | Giao thức cũ vẫn được Google hỗ trợ |
| `ollama` | Ollama `/api/chat` | NDJSON; chạy local không cần API key |
| `azure`, `azure_openai` | Azure OpenAI Responses | API key hoặc bearer token |
| `azure_openai_chat` | Azure OpenAI Chat Completions | Cho deployment Azure dùng Chat protocol |

Các hãng/gateway như DeepSeek, Groq, Mistral, Together, OpenRouter, xAI hoặc một model server nội bộ có endpoint tương thích OpenAI Chat Completions dùng chung `AI_PROVIDER=openai_chat`; đặt `AI_BASE_URL` theo tài liệu chính thức của dịch vụ đó. Không cần thêm adapter theo tên thương hiệu.

AWS Bedrock, Google Vertex AI và các cloud wrapper dùng IAM/OAuth/signing riêng không được giả làm API-key endpoint. Có thể bổ sung adapter qua registry mà không sửa service; xem mục “Mở rộng” bên dưới.

## Biến môi trường chung

```text
AI_ENABLED=true
AI_PROVIDER=<provider trong bảng>
AI_API_KEY=<secret chỉ ở backend>
AI_BASE_URL=<base URL, không gồm endpoint nếu tài liệu không yêu cầu>
AI_MODEL=<model hoặc deployment name>
AI_PROVIDER_STORE_RESPONSES=false
AI_MAX_OUTPUT_TOKENS=1200
AI_REQUEST_TIMEOUT_SECONDS=45
```

`AI_API_KEY` và `AI_BASE_URL` là tên trung lập được ưu tiên. Cấu hình cũ `OPENAI_API_KEY` và `OPENAI_BASE_URL` vẫn hoạt động với OpenAI/OpenAI-compatible để không gây hồi quy.

Không đưa API key vào frontend, database, log hoặc Git. Sau khi đổi env phải restart application worker.

## Ví dụ cấu hình

### OpenAI Responses

```text
AI_ENABLED=true
AI_PROVIDER=openai
AI_API_KEY=<openai-secret>
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=<openai-model>
AI_PROVIDER_STORE_RESPONSES=false
```

### OpenAI-compatible provider

```text
AI_ENABLED=true
AI_PROVIDER=openai_chat
AI_API_KEY=<vendor-secret>
AI_BASE_URL=https://<vendor-host>/<vendor-api-prefix>
AI_MODEL=<vendor-model>
AI_CHAT_INCLUDE_USAGE=true
AI_CHAT_MAX_TOKENS_FIELD=max_tokens
```

Nếu provider dùng trường mới của OpenAI, đặt:

```text
AI_CHAT_MAX_TOKENS_FIELD=max_completion_tokens
```

Nếu một gateway cũ từ chối `stream_options`, có thể đặt `AI_CHAT_INCLUDE_USAGE=false`. Khi tắt, gateway có thể không trả token usage; chỉ dùng sau khi đã đánh giá ảnh hưởng tới quota token.

### Anthropic Claude

```text
AI_ENABLED=true
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<anthropic-secret>
AI_MODEL=<claude-model>
# Optional; mặc định là endpoint/version chính thức:
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_VERSION=2023-06-01
```

Có thể dùng `AI_API_KEY`, `AI_BASE_URL`, `AI_PROVIDER_VERSION` thay cho các tên riêng của Anthropic.

### Google Gemini Interactions

```text
AI_ENABLED=true
AI_PROVIDER=gemini
GEMINI_API_KEY=<gemini-secret>
AI_MODEL=<gemini-model>
AI_PROVIDER_STORE_RESPONSES=false
```

Adapter gửi `store=false` theo mặc định an toàn. Nếu cần giao thức generateContent:

```text
AI_PROVIDER=gemini_generate_content
```

### Ollama local

```text
AI_ENABLED=true
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
AI_MODEL=<model đã pull trong Ollama>
```

Ollama local không cần key. Nếu endpoint từ xa yêu cầu bearer token, đặt `OLLAMA_API_KEY` hoặc `AI_API_KEY`.

### Azure OpenAI

```text
AI_ENABLED=true
AI_PROVIDER=azure_openai
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<azure-secret>
AI_MODEL=<deployment-name>
AI_AUTH_TYPE=api_key
# Optional với endpoint v1 hiện hành:
AZURE_OPENAI_API_VERSION=v1
```

Adapter tự chuẩn hóa resource endpoint thành `/openai/v1/responses`. Với Microsoft Entra bearer token:

```text
AI_AUTH_TYPE=bearer
AI_API_KEY=<short-lived-entra-token>
```

Ứng dụng hiện không tự refresh Entra token; production nên cấp token qua secret/runtime integration có vòng đời phù hợp.

## Chuẩn hóa dữ liệu

Mọi adapter phát ra cùng nhóm event:

- `response.output_text.delta`
- `response.output_item.added`
- `response.function_call_arguments.delta`
- `response.function_call_arguments.done`
- `response.output_item.done`
- `response.completed`
- `error`

Call ID được giữ xuyên suốt vòng gọi tool. Usage được chuẩn hóa thành `input_tokens`/`output_tokens`; Gemini cộng cả thought/tool-use tokens để quota không bỏ sót phần token được provider tính.

Gemini generateContent còn bảo toàn `thoughtSignature` trong metadata nội bộ để gửi lại đúng context khi model gọi function. Metadata này không được trả ra frontend.

## Mở rộng

Adapter mới chỉ cần triển khai contract ở đầu tài liệu và đăng ký factory trong `backend/ai/providers/registry.py`:

```python
register_provider("my_protocol", MyAdapter, aliases=("my_vendor",))
```

Không sửa `backend/ai/service.py`, route, tool executor hoặc frontend. Provider không biết tên sẽ fail closed với `AI_PROVIDER_UNAVAILABLE`, thay vì bị gửi nhầm payload theo giao thức OpenAI.

Tài liệu giao thức tham chiếu:

- [OpenAI Responses và streaming](https://developers.openai.com/api/docs/guides/migrate-to-responses#7-update-streaming-consumers)
- [Anthropic streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Azure OpenAI Responses](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/responses)
