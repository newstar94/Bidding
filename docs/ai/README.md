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

## AI local với Ollama và kho tri thức

Sau khi cài Ollama và tải một model hỗ trợ tool calling, cấu hình backend:

```text
AI_ENABLED=true
AI_PROVIDER=ollama
AI_BASE_URL=http://127.0.0.1:11434
AI_MODEL=<model đã cài trong Ollama>
AI_API_KEY=
AI_KNOWLEDGE_ENABLED=true
```

Kho tri thức không “huấn luyện lại” trọng số model. Tài liệu đã duyệt được chia đoạn, lưu theo version/phạm vi và truy xuất tại thời điểm hỏi. Xem quy trình kiểm tra, kích hoạt và cập nhật tài liệu tại [AI_KNOWLEDGE_INGESTION.md](AI_KNOWLEDGE_INGESTION.md).
