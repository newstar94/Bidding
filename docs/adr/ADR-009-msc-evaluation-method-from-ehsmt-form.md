# ADR-009: Phương pháp đánh giá MSC lấy từ biểu mẫu E-HSMT

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, theo đặc tả `PROMPT_CODEX_MAPPING_PHUONG_PHAP_DANH_GIA_MUASAMCONG.md`

## Bối cảnh và quyết định

Trường `evalMethod` trong dữ liệu tổng quan Mua Sắm Công thường không có giá
trị và `evalTechnical` thuộc biểu mẫu chấm kỹ thuật, không phải phương pháp
đánh giá tổng thể. BiddingFlow đọc phương pháp đánh giá từ biểu mẫu E-HSMT có
`formCode = BD.CG.02.0113`, parse JSON an toàn trong `formValue`, rồi kết hợp
`formValue.method` với lĩnh vực gói nguồn.

Quy tắc chuẩn hóa:

- `method = 1`: Giá thấp nhất.
- `method = 2` và `bidField = TV`: Giá cố định.
- `method = 2` và có `bidField` khác `TV`: Giá đánh giá.
- `method = 3`: Kết hợp giữa kỹ thuật và giá, dùng nhãn chuẩn hiện hữu của
  BiddingFlow.
- `method = 4`: Dựa trên kỹ thuật.
- Thiếu form, JSON lỗi, thiếu/không hỗ trợ `method`, hoặc `method = 2` nhưng
  thiếu `bidField`: không suy đoán, trả `null`.

Không dùng `evalMethod`, `evalTechnical` hoặc mã TBMT cụ thể để suy ra kết quả.
Giá trị chuẩn hóa được lưu trong canonical `evaluationMethod`, chuyển thành
draft `phuongPhapDanhGia`, và tiếp tục đi qua cơ chế lưu/hiển thị hiện hữu.

## Tác động tương thích

- Snapshot MSC mới hoặc resync có thể bổ sung `phuongPhapDanhGia` trước đây bị
  trống khi E-HSMT cung cấp form hợp lệ.
- Nhãn phương pháp dùng vocabulary hiện hữu, gồm “Kết hợp giữa kỹ thuật và
  giá”, để tương thích danh mục frontend và dữ liệu đã lưu.
- Khi không đủ dữ liệu, hành vi “Chưa có dữ liệu” của ADR-004 được giữ nguyên.
- Không thay đổi role, permission, tenant isolation, assignment scope, record
  scope, entitlement, masking hoặc quyền đọc/sửa dữ liệu.

## Migration strategy

Không cần migration schema hoặc rewrite dữ liệu. Mapping áp dụng khi import,
resync hoặc reprocess raw bundle Mua Sắm Công. Bản ghi cũ được bổ sung khi người
dùng chủ động lấy lại dữ liệu nguồn. Rollback bằng cách bỏ extractor form và
không project `evaluationMethod`; dữ liệu hợp lệ đã lưu không cần xóa.

## Regression tests

- `tests/test_muasamcong_integration_source.py::test_evaluation_method_mapping_depends_on_method_and_raw_package_field`
- `tests/test_muasamcong_integration_source.py::test_ib2600271825_evaluation_method_comes_from_ehsmt_form`
- `tests/test_muasamcong_integration_source.py::test_evaluation_method_form_returns_none_for_invalid_json`
- `tests/test_muasamcong_integration_source.py::test_ib2600079201_consulting_method_three_uses_ehsmt_form`
- `tests/test_muasamcong_integration_source.py::test_complete_notice_bundle_maps_opening_result_and_contract_sources`
- `tests/test_procurement_import_service.py::test_plan_linked_notice_stores_complete_source_and_caps_local_projection`
- `tests/js/procurement_lookup_wizard.test.mjs` — `package preview maps the normalized E-HSMT evaluation method`
