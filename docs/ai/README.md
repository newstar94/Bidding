# BiddingFlow AI

Trợ lý AI của BiddingFlow là một gateway chỉ đọc, mặc định tắt bằng `AI_ENABLED=false`.

## Bật ở môi trường local

```text
AI_ENABLED=true
AI_PROVIDER=fake
```

`AI_PROVIDER=fake` dùng cho test và UI smoke test, không gọi mạng. Khi dùng một provider thật:

```text
AI_ENABLED=true
AI_PROVIDER=<openai|openai_chat|anthropic|gemini|ollama|azure_openai>
AI_API_KEY=<secret chỉ ở backend; Ollama local có thể để trống>
AI_BASE_URL=<để trống nếu dùng endpoint mặc định>
AI_MODEL=<model do môi trường cấu hình>
AI_PROVIDER_STORE_RESPONSES=false
```

Không đưa API key vào frontend, log, database hoặc commit. MVP chỉ đăng ký tool đọc dữ liệu; mọi tool phải tự kiểm tra workspace và permission tại thời điểm thực thi.

Xem cấu hình và alias đầy đủ tại [AI_PROVIDER_ADAPTERS.md](AI_PROVIDER_ADAPTERS.md). Xem thêm: [AI_ARCHITECTURE_ANALYSIS.md](AI_ARCHITECTURE_ANALYSIS.md), [AI_SECURITY_MODEL.md](AI_SECURITY_MODEL.md), [AI_OPERATIONS_RUNBOOK.md](AI_OPERATIONS_RUNBOOK.md).
