# Kế hoạch đánh giá

Chạy unit cho configuration, registry/schema, date/decimal, scope, redaction, quota và conversation scope. Chạy security tests cho cross-organization, forged frontend scope, prompt/tool injection, XSS, session revoke và source link.

Fake provider được dùng trong CI; provider thật chỉ chạy ở môi trường có secret an toàn. Deterministic numeric checks so sánh trực tiếp với fixture database, không dùng model tự chấm số liệu.

`tests/ai/evaluation_dataset.jsonl` chứa tập câu hỏi nền gồm data, mơ hồ, không dữ liệu, trái quyền, tiền, thời gian, so sánh năm, typo, injection, citation và app help.
