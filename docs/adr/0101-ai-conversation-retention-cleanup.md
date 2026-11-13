# ADR 0101: Tự dọn hội thoại AI theo thời hạn lưu

- Ngày: 2026-11-12
- Trạng thái: Chủ sản phẩm chấp thuận (2026-11-12, khi rà soát lỗi toàn ứng dụng)
- Phạm vi: vòng dọn dữ liệu định kỳ (`backend/lifecycle.py`), bảng `ai_conversations`

## Bối cảnh

`docs/ai/AI_OPERATIONS_RUNBOOK.md` ghi: "Conversation được soft delete và cleanup theo retention". Cấu hình `AI_CONVERSATION_RETENTION_DAYS` (mặc định 30, giới hạn 1–3650) đã có trong `AiConfig.conversation_retention_days`, và `conversation_repository.cleanup_expired_conversations` đã viết sẵn.

Rà soát cho thấy không chỗ nào gọi hàm này và không chỗ nào đọc cấu hình trên. Hội thoại AI vì vậy không bao giờ hết hạn, trái với runbook.

## Quyết định

1. Vòng dọn retention hiện có (30 phút/lần, chỉ worker giữ khóa `biddingflow-retention-cleanup` chạy) gọi thêm `expire_idle_ai_conversations(database)` ở bước cuối, sau `reconcile_asset_journal`.
2. Hội thoại `status = 'active'` có `updated_at` cũ hơn `AI_CONVERSATION_RETENTION_DAYS` ngày được xóa mềm, giống hệt khi người dùng tự xóa:
   - `status = 'deleted'`, `deleted_at = CURRENT_TIMESTAMP`;
   - tin nhắn và phản hồi vẫn gắn với hội thoại;
   - `updated_at` giữ thời điểm hoạt động cuối.
3. Dọn theo lô `RETENTION_CLEANUP_BATCH_SIZE` (mặc định 1000), mỗi lô commit riêng, chọn dòng bằng `FOR UPDATE SKIP LOCKED`, giống các bảng retention khác.
4. Không xóa vật lý. Xóa vĩnh viễn hội thoại đã xóa mềm vẫn cần quy trình riêng đã duyệt (runbook).

## Hệ quả, tương thích và triển khai

- **Người dùng thấy gì:** hội thoại không hoạt động quá thời hạn biến mất khỏi danh sách hội thoại AI của chính người đó. Không đổi quyền, masking hay phạm vi tenant; câu lệnh chỉ đổi trạng thái, không đọc nội dung.
- **Lần chạy đầu:** mọi hội thoại đang tồn đọng quá 30 ngày sẽ được xóa mềm theo lô. Muốn giữ lâu hơn, đặt `AI_CONVERSATION_RETENTION_DAYS` trước khi khởi động lại.
- **Migration:** không có. Bảng và cột đã có từ migration v38.
- **Hiệu năng:** điều kiện lọc chưa có chỉ mục dẫn đầu bằng `updated_at`, nên mỗi lần quét là quét tuần tự bảng `ai_conversations`. Bảng nhỏ (theo người dùng), quét 30 phút/lần là chấp nhận được. Nếu bảng lớn lên, thêm chỉ mục một phần `(updated_at) WHERE status = 'active'` bằng migration riêng.
- **Lỗi:** lỗi ở bước này được vòng dọn ghi log `retention_cleanup` mức WARN và thử lại ở lần sau. Các bước dọn trước đó không bị ảnh hưởng.
- **Rollback:** bỏ lời gọi trong `_purge_retained_rows`. Hội thoại đã xóa mềm có thể khôi phục thủ công bằng cách đặt lại `status = 'active'`, `deleted_at = NULL`.

## Kiểm thử hồi quy

`tests/test_ai_conversation_retention.py`:

- dọn theo lô cho tới khi hết tồn đọng, mỗi lô commit, kết nối được đóng;
- chặn đầu vào (ngày và lô tối thiểu 1);
- đọc đúng `AI_CONVERSATION_RETENTION_DAYS` (mặc định 30) và `RETENTION_CLEANUP_BATCH_SIZE`;
- vòng dọn gọi bước này sau các bước dọn khác;
- trên PostgreSQL thật: chỉ hội thoại active quá hạn bị xóa mềm; hội thoại mới và hội thoại người dùng đã xóa giữ nguyên.
