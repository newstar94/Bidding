# ADR-006: Materialize hàng hóa mời thầu và bảo đảm theo lô từ Mua Sắm Công

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu chuẩn hóa và mapping dữ liệu Mua Sắm Công

## Bối cảnh

COMPLETE snapshot của thông báo mời thầu đã chứa `lotGuaranteeValue` theo từng phần lô và các dòng danh mục hàng hóa trong biểu mẫu `BD.MT.02.1224`, nhưng dữ liệu này dừng ở raw snapshot. Khi nhập một kế hoạch có thông báo liên kết, BiddingFlow giữ danh sách lô từ kế hoạch nên mất giá trị bảo đảm ở phía thông báo; đồng thời chưa có canonical contract và transaction materialization cho `goi_thau_hang_hoa`.

## Quyết định nghiệp vụ

BiddingFlow chuẩn hóa hàng hóa mời thầu từ đúng biểu mẫu `BD.MT.02.1224`. Chỉ dòng có mã/định danh nguồn, tên hàng hóa, đơn vị tính và số lượng dương mới là hàng hóa; dòng cha hoặc tiêu đề phần lô không được materialize. Các trường nguồn được giữ gồm chỉ mục/định danh, mã và tên phần lô, mã và tên hàng hóa, đơn vị, số lượng, yêu cầu kỹ thuật, ký mã hiệu tham chiếu, xuất xứ yêu cầu, địa điểm/thời gian giao hàng và ghi chú. Giá trị thiếu được để trống, không suy đoán.

Khi một gói trong kế hoạch được làm giàu bằng TBMT, bảo đảm dự thầu theo lô chỉ được ghép bằng mã lô chuẩn hóa trùng khớp chính xác. Không ghép mơ hồ bằng tên hoặc vị trí. Tên, giá và thời gian thực hiện từ kế hoạch được giữ; TBMT bổ sung bảo đảm dự thầu và chỉ điền các trường kế hoạch còn thiếu.

Hàng hóa được tạo cùng transaction bản nháp kế hoạch/gói, liên kết tới ID gói và ID lô nội bộ. Gói nhập lại chỉ được backfill hàng hóa nguồn khi chưa có hàng hóa; danh mục người dùng đã lưu không bị ghi đè. Việc này là projection ở giai đoạn mời thầu, không tạo dữ liệu mở thầu, chấm thầu, kết quả hay hợp đồng.

Chủ sản phẩm xác nhận danh mục hàng hóa vẫn được hoàn thiện trong cả trạng thái `PREPARING`/“Chuẩn bị” và `INVITED`/“Đang mời thầu”. Người dùng có quyền sửa gói theo tenant, module, assignment và record scope được thêm, nhập và chỉnh sửa danh mục trong hai trạng thái này. Quyền xóa từng hàng hóa không được mở rộng ngoài “Chuẩn bị”; từ trạng thái mở thầu trở đi, toàn bộ danh mục tiếp tục bị khóa.

## Tác động tương thích

- Gói nhập mới hoặc nhập lại khi chưa có danh mục sẽ có thêm bản ghi `goi_thau_hang_hoa` và bảo đảm đúng theo từng lô.
- Gói đã có danh mục hàng hóa do người dùng chỉnh sửa giữ nguyên danh mục hiện hữu.
- Dòng nguồn thiếu tên, đơn vị, số lượng dương hoặc không ghép được chính xác với mã lô vẫn được bảo toàn trong raw evidence nhưng không được tạo thành bản ghi nghiệp vụ không hợp lệ.
- Mở rộng cửa sổ chỉnh sửa danh mục từ riêng “Chuẩn bị” sang “Chuẩn bị” và “Đang mời thầu”; đây là thay đổi semantics được chủ sản phẩm phê duyệt để hàng hóa nhập từ MSC có thể lưu cùng gói.
- Không thay đổi role, module permission, tenant, assignment, record scope, entitlement, masking hoặc hiển thị dữ liệu đã được cấp quyền. Người dùng không có quyền sửa gói vẫn không được sửa danh mục.

## Migration strategy

Không cần migration schema. Bản ghi hiện hữu không bị rewrite. Người dùng chủ động lấy lại dữ liệu Mua Sắm Công để backfill các gói chưa có danh mục; gói đã có hàng hóa được bảo toàn. Rollback bằng cách bỏ canonical `goodsItems`, enrichment theo mã lô và materialization `goi_thau_hang_hoa`; raw snapshot vẫn giữ nguyên.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_complete_notice_bundle_maps_opening_result_and_contract_sources`
- `tests/test_procurement_import_service.py::test_plan_linked_notice_stores_complete_source_and_caps_local_projection`
- `tests/js/plan_breakdown_draft_transaction.test.mjs::prepared plan revision materializes source packages into one memory-only breakdown draft`
- `tests/js/plan_breakdown_draft_transaction.test.mjs::procurement resync preserves existing goods and stable lot ids`
- `tests/test_package_goods.py::test_package_goods_write_inherits_package_assignment_and_status_lock`
- `tests/test_package_goods.py::test_direct_package_goods_authorization_accepts_invited_status`
- `tests/test_package_goods.py::test_package_goods_delete_remains_locked_after_preparation`
- `tests/js/package_goods.test.mjs::goods tab and editing support goods and mixed procurement packages`
