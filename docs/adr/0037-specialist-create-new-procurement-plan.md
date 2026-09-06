# ADR 0037 — Chuyên viên được tạo mới kế hoạch từ phiên nhập procurement

- Trạng thái: Chấp nhận
- Ngày: 2026-09-06
- Phạm vi: Phiên nhập kế hoạch Mua Sắm Công và atomic plan-draft finalize

## Bối cảnh

Chuyên viên có quyền xem phân hệ kế hoạch đã được phép bắt đầu tra cứu và tạo
preview, nhưng các endpoint tiếp tục phiên nhập và lớp authorization của lần lưu
cuối vẫn luôn yêu cầu quyền sửa. Vì vậy một kế hoạch chưa tồn tại, ví dụ
`PL2600146586`, bị trả `ORGANIZATION_ACCESS_DENIED` hoặc
`RECORD_ACCESS_DENIED` dù nghiệp vụ cho phép Chuyên viên tự thêm dữ liệu mới.

Không được dùng quyền tạo mới này để cập nhật kế hoạch/gói thầu đã tồn tại, nối
vào một dòng phiên bản cũ hoặc bỏ qua tenant, session, module, assignment và
record scope hiện hành.

## Quyết định

1. Phiên nhập loại `PLAN` được tiếp tục với quyền `kehoach=view` khi trong đúng
   workspace chưa có kế hoạch mang cùng mã. Nếu mã đã tồn tại, phiên vẫn yêu cầu
   `kehoach=edit` như trước. Ngoại lệ duy nhất là chính phiên `CREATE` do máy chủ
   quản lý đã commit ít nhất một revision: kế hoạch vừa xuất hiện là kết quả của
   phiên đó, nên các revision tiếp theo và bước đọc trạng thái hoàn tất tiếp tục
   dùng quyền `view`. Session `CREATE` mới mở sau khi mã đã tồn tại vẫn yêu cầu
   `edit` và không được hưởng ngoại lệ này.
2. Quyền trên chỉ áp dụng cho luồng `finalize-draft` nguyên tử. Validator phải
   xác nhận toàn bộ chuỗi kế hoạch, snapshot gói thầu và bản ghi con là một graph
   khép kín, chưa từng persist, không có deletion và không nối vào ID/root đã có
   trong tenant.
3. Trong graph mới đã được xác nhận, mỗi bản ghi vẫn cần quyền xem của đúng phân
   hệ (`kehoach` hoặc `goithau`). Bản ghi không thuộc graph, bản ghi tham chiếu
   dùng chung và mọi cập nhật dữ liệu đã tồn tại tiếp tục yêu cầu quyền sửa như
   trước.
4. Quy tắc tự nhận phân công, cấm phân công người khác, trạng thái hàng hóa,
   protected payload, tenant/session/workspace lease và kiểm tra provenance của
   từng revision không thay đổi.
5. Luồng nhập/cập nhật gói thầu hoặc TBMT độc lập tiếp tục yêu cầu quyền sửa gói
   thầu. Quyết định này không mở quyền cập nhật dữ liệu hiện hữu.

## Compatibility impact

- Chuyên viên có quyền xem phân hệ có thể hoàn tất một kế hoạch procurement hoàn
  toàn mới, kể cả chuỗi nhiều revision và bước đọc trạng thái sau commit, thay vì
  nhận 403/validation error giữa phiên.
- Quản lý và người có quyền sửa giữ nguyên hành vi.
- Kế hoạch cùng mã đã tồn tại, graph chứa ID/root đã persist, quyền xem bị thu
  hồi hoặc thiếu quyền phân hệ liên quan vẫn bị từ chối.
- Không thay đổi dữ liệu trả về, masking, entitlement, role hay semantics của
  quyền sửa đối với bản ghi đã tồn tại.

## Migration và rollout

- Không có schema hoặc data migration.
- Deploy backend cùng frontend hiện hành; không cần chuyển đổi draft đã lưu cục
  bộ. Phiên hết hạn vẫn phải tra cứu lại theo cơ chế hiện hành.
- Trước rollout chạy regression cho session authorization, atomic finalize,
  multi-revision plan/package/E-HSMT và procurement import TOCTOU.

## Rollback strategy

Rollback code không cần đổi schema. Rollback sẽ khôi phục lỗi 403 đối với
Chuyên viên tạo kế hoạch mới, nhưng không làm thay đổi dữ liệu đã commit.

## Regression seams

- `tests/test_new_plan_import_permission.py`: phiên mới được tiếp tục bằng quyền
  xem; session mới mở bị từ chối khi mã kế hoạch đã tồn tại; chính session
  `CREATE` đã commit revision đầu vẫn được đi tiếp; session cập nhật và trường hợp
  thu hồi quyền xem vẫn bị từ chối.
- `tests/test_plan_draft_finalize.py`: Chuyên viên chỉ có quyền xem hoàn tất được
  toàn bộ revision nguồn mới; validator vẫn từ chối graph đã persist hoặc liên
  kết sai.
- `tests/test_procurement_import_routes.py`: session/tenant/lease, quyền cập nhật
  dữ liệu cũ, assignment revocation và các đường apply/resume giữ nguyên.
