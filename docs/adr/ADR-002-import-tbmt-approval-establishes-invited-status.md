# ADR-002: QĐ phê duyệt E-HSMT xác lập trạng thái Đang mời thầu khi nhập TBMT

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong hội thoại xử lý `IB2600291864`

## Bối cảnh

Dữ liệu Mua Sắm Công của một thông báo mời thầu có thể chứa quyết định phê duyệt E-HSMT nhưng mã trạng thái nguồn chưa thuộc bảng ánh xạ ổn định của BiddingFlow. Trước thay đổi này, gói thầu như `IB2600291864` bị nhập với trạng thái “Chưa xác định” dù đã có số QĐ phê duyệt E-HSMT.

Cùng payload này còn đặt thời gian hiệu lực E-HSDT trong JSON của biểu mẫu `BD_DATA_TABLE` và đặt danh sách tùy chọn mua thêm trong phản hồi chi tiết gói thuộc kế hoạch. Hai nguồn đã được tải nhưng chưa được ánh xạ vào bản nháp.

## Quyết định nghiệp vụ

Khi nhập đúng một revision TBMT có định danh thông báo/revision đầy đủ và có `approvalDecisionNo`, BiddingFlow dùng quyết định phê duyệt E-HSMT làm bằng chứng tối thiểu để project trạng thái local thành `INVITED` (“Đang mời thầu”). Nếu nguồn đã mở thầu, đang đánh giá, đã có kết quả hoặc hủy thầu thì trạng thái quan sát thật vẫn được giữ trong raw/canonical/provenance, nhưng không tự đẩy workflow local qua `INVITED`.

`derive_import_lifecycle_status()` diễn giải source observed lifecycle. `project_source_lifecycle_to_bidding()` là policy riêng cho local workflow. Import mới không materialize `OPENED`, `EVALUATING`, `PARTIALLY_AWARDED`, `AWARDED` hoặc `CANCELLED`; những bước này chỉ sinh ra bởi thao tác nghiệp vụ của người dùng trong Bidding.

Khi gói thầu hiện có đang ở trạng thái `UNKNOWN` (“Chưa xác định”), backend cho phép đối chiếu sang `INVITED` chỉ khi chính gói thầu đó thuộc một import session Mua Sắm Công đã được máy chủ khóa và xác thực revision/digest. Payload tự khai báo `sourceRevision` nhưng không vượt qua bước xác thực phiên không tạo ra quyền chuyển trạng thái. Thao tác sửa thủ công `UNKNOWN` → `INVITED` tiếp tục bị chặn bởi quy tắc chuyển trạng thái hiện hành.

Thời gian hiệu lực E-HSDT được đọc từ `effectTimeHSDT` trong biểu mẫu `BD_DATA_TABLE` khi trường chuẩn chưa có. Danh sách tùy chọn mua thêm được lấy từ `PLAN_PACKAGE_DETAIL.formValue`, giữ nguyên định danh nguồn, tên hạng mục, đơn vị, số lượng, tỷ lệ và giá trị ước tính.

Import plan/package không ghi `actualOpeningAt` hoặc `financialActualOpeningAt` vào trường thời gian mở thầu local. Evidence mở thầu/kết quả được giữ trong COMPLETE raw snapshot và chỉ được prefill vào bản nháp Biên bản mở thầu khi người dùng chọn “Lấy dữ liệu MSC”. Chỉ thao tác Lưu thông tin mở thầu mới tạo business rows và chuyển sang “Đang chấm thầu”. Gói mới import mặc định `Không/NOT_REQUIRED` cho Thẩm định HSMT; resync bảo toàn lựa chọn hiện hữu.

Đối với bản nháp có `bidValidityDays` hợp lệ, thời gian hiệu lực bảo đảm dự thầu được chuẩn hóa theo quy tắc hiện hành của BiddingFlow: `hieuLucDamBaoDuThau = bidValidityDays + 30`. Quy tắc được áp dụng tại ranh giới canonical-to-draft và khi materialize vào form để không phụ thuộc vào việc modal đã gắn listener DOM hay chưa. Giá trị bảo đảm đã được người dùng lưu trong bản ghi hiện hữu được giữ nguyên khi resync.

## Phạm vi tương thích

- Chỉ áp dụng fallback trạng thái cho revision TBMT chính xác; không áp dụng cho thông báo sơ bộ, gói chưa liên kết hoặc dữ liệu không có số QĐ E-HSMT.
- Trạng thái local đã tiến xa hơn `INVITED` do người dùng thao tác được bảo toàn khi resync; source không tự advance hoặc downgrade workflow local.
- Không thay đổi role, permission, tenant, assignment, record scope, entitlement hoặc cách hiển thị trường dữ liệu đã được cấp quyền.
- Không nới quy tắc chuyển trạng thái chung; ngoại lệ đối chiếu chỉ gắn với ID gói thầu được trả về từ bước xác thực import session ở cùng transaction.
- Payload bản nháp có thể chứa nhiều dòng tùy chọn mua thêm hơn trước vì dữ liệu nguồn không còn bị bỏ qua.
- Gói import có hiệu lực HSDT hợp lệ sẽ có sẵn hiệu lực bảo đảm dự thầu dẫn xuất trong bản nháp/form; bản ghi hiện hữu có giá trị người dùng nhập không bị ghi đè khi resync.

## Migration strategy

Không cần migration schema hoặc ghi lại dữ liệu hiện hữu. Bản ghi đã lưu giữ nguyên trạng thái và dữ liệu người dùng. Quy tắc mới áp dụng khi người dùng nhập mới hoặc chủ động lấy lại dữ liệu từ Mua Sắm Công; người dùng vẫn có thể chỉnh sửa trước khi lưu.

Rollback bằng cách bỏ policy projection, COMPLETE linked-notice retention/reuse, fallback QĐ E-HSMT, bộ đọc `effectTimeHSDT` và ánh xạ `PLAN_PACKAGE_DETAIL.formValue`; không cần rollback dữ liệu hoặc schema.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_complete_notice_bundle_maps_opening_result_and_contract_sources`
- `tests/test_procurement_import_service.py::test_import_lifecycle_mapping_is_conservative`
- `tests/test_procurement_import_service.py::test_source_truth_is_retained_while_local_projection_stops_at_invitation`
- `tests/test_procurement_import_service.py::test_source_resync_preserves_user_controlled_local_workflow`
- `tests/test_procurement_import_routes.py::test_opening_prepare_reuses_complete_exact_raw_snapshot`
- `tests/test_procurement_import_command.py::test_real_postgres_plan_00_to_01_is_atomic_and_preserves_version_axes`
- `tests/test_sync_mutation_contract.py::test_manual_unknown_to_invited_package_transition_remains_rejected`
- `tests/test_sync_mutation_contract.py::test_trusted_procurement_reconciliation_allows_unknown_to_invited`
- `tests/test_procurement_import_sync_binding.py::test_preflight_returns_only_validated_import_package_ids`
- `tests/test_procurement_import_service.py::test_package_draft_maps_invitation_fields_without_opening_materialization`
- `tests/js/plan_breakdown_draft_transaction.test.mjs::package procurement draft fills lifecycle and tender milestone controls`
