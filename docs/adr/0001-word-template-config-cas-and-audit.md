# ADR 0001 — CAS và audit bền vững cho cấu hình biểu mẫu Word

- Trạng thái: Chấp nhận
- Ngày: 2026-08-22
- Phạm vi: Cấu hình và file biểu mẫu Word theo workspace

## Bối cảnh

`config.json` trước đây được cập nhật theo chuỗi `đọc → sửa → os.replace` dưới
`threading.RLock`. Lock này chỉ có hiệu lực trong một process, vì vậy hai Uvicorn
worker có thể cùng đọc một phiên bản rồi ghi đè lẫn nhau. JSON hỏng bị đọc thành
`{}`, khiến lần ghi tiếp theo có thể xóa cấu hình còn khả năng khôi phục.

Các API assignment, availability và CRUD file cũng ghi audit sau mutation. Nếu
audit bắt buộc thất bại, API trả lỗi nhưng config/filesystem đã thay đổi.

## Quyết định

1. `config.json` chứa trường số nguyên không âm `revision`.
2. Config legacy chưa có `revision` được đọc như revision `0`; lần mutation đầu
   tiên ghi revision `1`. Không cần migration chủ động.
3. GET assignment trả `revision`. PUT assignment và POST availability phải gửi
   `expectedRevision`; stale write trả HTTP `409` với code
   `WORD_TEMPLATE_CONFIG_CONFLICT` và `currentRevision`.
4. Mọi read-modify-write config chạy dưới cả process-local lock và advisory lock
   file theo workspace. File mới được ghi vào temporary file, `fsync`, rồi
   `os.replace`.
5. JSON, encoding, root type hoặc revision hỏng phải fail rõ ràng. File gốc được
   giữ nguyên; mutation không được tiếp tục trên config tổng hợp `{}`.
6. Mutation có audit hai pha:
   - event `*_requested` bắt buộc được ghi trước mutation;
   - event kết quả bắt buộc được ghi tại commit boundary.
7. Nếu result audit ném lỗi, config/file được phục hồi dưới cùng workspace lock
   rồi API mới trả lỗi. Nếu process dừng đột ngột giữa hai pha, intent audit còn
   lại là marker có thẩm quyền để vận hành đối soát thay vì một mutation vô danh.
8. Upload, replace/rename và delete dùng scope lock đa process. Rename/delete cập
   nhật reference trong config và audit trong cùng critical section; fault ở
   file/config/audit phục hồi cả hai phía.

Quyết định này không thay đổi masking, dữ liệu được đọc, entitlement xuất Word,
role, module permission, assignment scope hoặc record scope.

## Compatibility impact

- Response GET assignment có thêm `revision`; client cũ bỏ qua trường mới vẫn đọc
  được.
- Write client phải được triển khai đồng bộ để gửi `expectedRevision`. Client cũ
  không có precondition nhận lỗi validation, không được phép ghi kiểu last-write-wins.
- Payload `assignmentSets`, stable document ID, singleton compatibility fields và
  semantics availability giữ nguyên.
- `config.json` có thêm metadata `revision`; code legacy đọc JSON object vẫn bỏ qua
  được trường này.
- Các mutation thành công tạo thêm intent audit event bên cạnh result event hiện
  hữu. Consumer audit phải coi `*_requested` không phải bằng chứng hoàn tất.

## Migration và rollout

1. Không có schema/database migration.
2. Triển khai backend và frontend trong cùng release vì write API yêu cầu revision.
3. Config legacy được nâng revision lazy ở mutation đầu tiên.
4. Trước rollout phải sao lưu thư mục Word template/config theo chính sách backup
   hiện hành và kiểm tra quyền tạo lock/temp file.

## Rollback strategy

- Có thể rollback code mà không sửa dữ liệu: phiên bản cũ bỏ qua trường `revision`.
- Nếu rollback riêng backend, phải rollback frontend cùng lúc vì frontend mới gửi
  `expectedRevision` và backend cũ dùng strict request validation.
- Không xóa `revision` hàng loạt và không rewrite config trong rollback.
- Intent không có result phải được đối soát với file/config hiện tại và request ID;
  không tự suy diễn rằng mutation đã hoàn tất.

## Regression seams

- `tests/test_word_template_config_concurrency.py`: CAS đa process, config corruption
  và lazy revision cho config legacy.
- `tests/test_word_publication_template_assignments.py`: stale PUT 409 và rollback
  khi result audit thất bại.
- `tests/test_word_template_crud.py`: availability CAS, audit hai pha và rollback
  upload/rename/delete.
- `tests/test_docx_attached_template_sanitizer.py`: upload đã sanitize được persist
  và audit đầy đủ.
- `tests/js/word_template_assignments_ui.test.mjs` và
  `tests/js/word_template_crud.test.mjs`: client gửi revision hiện hành.
