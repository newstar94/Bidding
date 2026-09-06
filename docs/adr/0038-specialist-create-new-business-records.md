# ADR 0038 — Chuyên viên được tạo mới bản ghi nghiệp vụ

- Trạng thái: Chấp nhận
- Ngày: 2026-09-06
- Phạm vi: mutation đồng bộ của các phân hệ nghiệp vụ

## Bối cảnh

Quyền phân hệ hiện có hai mức `view` và `edit`. Hành vi cũ yêu cầu `edit` cho
mọi upsert, nên Chuyên viên đã được phép làm việc trong phân hệ vẫn nhận
`RECORD_ACCESS_DENIED` khi tạo bản ghi hoàn toàn mới. Lỗi đã được quan sát với
`chuyen_gia` và cùng seam authorization được dùng cho các phân hệ nghiệp vụ
khác.

Chủ sản phẩm xác nhận Chuyên viên được tự thêm dữ liệu mới. Quyền này không được
biến thành quyền sửa hoặc xóa dữ liệu đã tồn tại, không được mở bảng nội bộ và
không được bỏ qua tenant, membership, assignment, parent scope hay lifecycle.

## Quyết định

1. Upsert có `id` chưa tồn tại trong đúng organization được coi là tạo mới.
2. Tạo mới một bảng nghiệp vụ đã đăng ký trong `TABLE_TO_MODULE` yêu cầu quyền
   xem của phân hệ tương ứng. `edit` cũng thỏa điều kiện này như trước.
3. Upsert có `id` đã tồn tại tiếp tục yêu cầu quyền `edit`.
4. Bảng không ánh xạ tới một phân hệ và các payload được bảo vệ không hưởng
   quyền tạo mới này.
5. Các rule khác vẫn chạy độc lập: child record phải thuộc parent hợp lệ và được
   phân công khi rule yêu cầu; trạng thái gói thầu, historical immutability,
   uniqueness, row-version conflict, tenant/session và audit không thay đổi.
6. Delete không phải tạo mới và tiếp tục sử dụng authorization hiện hành.
7. Theo xác nhận bổ sung của chủ sản phẩm ngày 2026-09-06, khi vai trò hoạt
   động là Chuyên viên tạo dòng Kế hoạch/Gói thầu/Hợp đồng hoàn toàn mới,
   máy chủ thêm phân công cho chính người tạo trong cùng transaction. Chuỗi
   snapshot nháp hoàn toàn mới nhận phân công ở mỗi snapshot. Không tự phân
   công lại bản ghi đã persist hoặc phiên bản mới của dòng đã tồn tại.
8. Chủ đầu tư/Nhà thầu vẫn là danh mục dùng chung; không thêm assignment scope.
   Quản lý tạo mới vẫn giữ lựa chọn phân công rõ ràng hoặc để trống như trước.
9. Người tạo không có quyền sở hữu vượt phân công. Khi phân công của họ bị
   chuyển/gỡ, quyền đọc/ghi được đánh giá lại theo phân công còn hiệu lực;
   không tự cấp lại quyền từ `createdBy`, outbox retry hay save. Quyền sửa
   phân hệ vẫn bắt buộc cho cập nhật, không đổi `view` thành `edit`.
   Quan hệ kế hoạch được đọc thông qua gói thầu đang phân công vẫn giữ nguyên:
   chuyển cả phạm vi công việc cần chuyển các phân công liên quan, không chỉ
   thêm người mới vào danh sách nhiều người.

## Compatibility impact

- Chuyên viên có quyền xem phân hệ có thể tạo bản ghi nghiệp vụ mới qua cùng
  mutation flow mà Quản lý đang dùng.
- Chuyên viên không có quyền sửa sẽ vẫn bị từ chối khi thay đổi bản ghi đã tồn
  tại hoặc dữ liệu lịch sử.
- Không thay đổi response data, masking, entitlement xuất tài liệu hoặc phạm vi
  đọc bản ghi.

## Migration và rollout

- Không có schema hoặc data migration.
- Không backfill phân công cho dữ liệu cũ: tránh khôi phục quyền đã được quản
  lý thu hồi. Dữ liệu cũ chưa phân công cần Quản lý phân công rõ ràng.
- Backend phải được restart sau deploy để nạp authorization code mới.
- Outbox đang giữ mutation tạo mới có thể retry sau khi backend mới hoạt động;
  không cần xóa dữ liệu cục bộ.

## Rollback strategy

Rollback code không cần đổi schema. Mutation chưa được ACK vẫn nằm trong outbox;
rollback sẽ khôi phục lỗi từ chối tạo mới đối với Chuyên viên.

## Regression seams

- `tests/test_specialist_default_assignment.py`: tự phân công một lần, không
  tự nhận dòng cũ/phiên bản mới, giới hạn batch, danh mục dùng chung; PostgreSQL
  kiểm tra đọc và cả hai đường ghi trước/sau chuyển phân công cho cả ba loại.
- `tests/test_plan_draft_finalize.py`: finalize nhập nguồn nhiều revision lưu
  nguyên tử phân công người tạo cho mỗi snapshot.
- `tests/test_new_plan_import_permission.py`: Chuyên viên có quyền xem tạo được
  `chuyen_gia` mới, không sửa được bản ghi đã tồn tại và không tạo được bảng
  nội bộ không ánh xạ phân hệ.
- `tests/test_security_regressions.py`, `tests/test_record_access_projection.py`
  và `tests/test_read_scope_contract.py`: organization, persona, module,
  assignment và record scope không đổi.
- `tests/test_sync_mutation_contract.py`: historical/versioning/row-version và
  transaction invariants tiếp tục được áp dụng sau authorization.
