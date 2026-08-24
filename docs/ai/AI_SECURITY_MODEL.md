# Mô hình bảo mật

- API key chỉ được đọc trong `backend/ai/configuration.py`.
- Conversation khóa theo `user_id + organization_id`; workspace switch tạo context mới và frontend hủy context cũ.
- Mỗi tool dùng metric/filter/group allowlist, `additionalProperties: false`, giới hạn ngày/bản ghi và query scope tĩnh.
- Permission được kiểm tra lúc dựng context và dựng lại lúc thực thi tool. Aggregation chạy trên cùng visibility predicate với list.
- Source link do backend tạo từ route allowlist và record đã scope; frontend chỉ render link nội bộ dạng relative.
- Tool result được đánh dấu `untrustedData`; prompt injection trong dữ liệu không thể thay đổi quyền.
- Audit chỉ lưu tool, filter đã redaction, record count, duration, scope hash và error code; không lưu prompt/raw result/chain-of-thought/secret.
- Rate limit và quota được lưu theo workspace + user trong `ai_usage_daily`; provider store responses mặc định false.
- MVP không có create/update/delete/approve/publish/award/sign/change-role tool.
- Markdown/HTML từ model không được dùng làm HTML sink; frontend render `textContent` và DOM node an toàn.
# Exact-target compliance

Compliance target hint không phải authority. Mỗi tool call re-derive session/workspace/active role/module/assignment/record scope và authorize exact version trước khi nạp binding. Kết quả giữ đầy đủ business fields đã được phép đọc; Word entitlement không gate record context và không có sensitive-read capability mới.

Tool payload được đánh dấu `untrustedData`; instruction trong record/source không được thực thi. Với exact target, external web search bị vô hiệu để không gửi record query/identifier ra ngoài. Exact historical legal binding/source luôn là provenance ưu tiên; missing/ambiguous binding chỉ tạo `notEvaluated`, không cho model tự chọn luật mới nhất.
