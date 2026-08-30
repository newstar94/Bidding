# Báo cáo triển khai căn cứ lập Kế hoạch LCNT và ánh xạ Word

Ngày kiểm tra: 2026-08-30  
Trạng thái: `IMPLEMENTED_READY_FOR_REVIEW`; chưa commit, push hoặc deploy.

## Kết quả

Đã triển khai danh sách căn cứ có thứ tự cho Kế hoạch LCNT. Người dùng nhập mỗi
căn cứ bằng text tự nhiên; máy chủ giữ nguyên câu nhập và phân tích xác định thành
tên văn bản, số văn bản, ngày ban hành, đơn vị ban hành và trích yếu. Trường
`tenCanCu` được dẫn xuất từ tên văn bản và trích yếu theo ADR 0030, không trở thành
một nguồn dữ liệu lưu riêng.

Trước khi xuất Kế hoạch Word, người dùng có thể chọn tất cả, bỏ chọn tất cả hoặc
chọn một tập con. Lựa chọn chỉ áp dụng cho lần xuất hiện tại và không cập nhật ngược
vào kế hoạch. Word hỗ trợ cả recipe nguyên văn lẫn recipe cấu trúc theo từng trường.

## Mapping yêu cầu sang implementation và kiểm thử

| Yêu cầu | Implementation chính | Kiểm thử chính |
|---|---|---|
| Nhập text tự nhiên, parser ở backend | `backend/domain/plan_basis_parser.py` | `tests/test_plan_basis_parser.py` |
| Giữ nguyên raw, lưu projection có phiên bản | `backend/db/schema.py`, `backend/sync/mapper.py`, `backend/sync/child_projection.py` | `tests/test_plan_basis_persistence.py` |
| Client không được ghi trường parser | `backend/sync/payload_validation.py`, `frontend/app/outboundSerializer.js` | `tests/test_plan_basis_persistence.py`, `tests/js/generated_schema_serializer_contract.test.mjs` |
| Missing list là preserve, `[]` là clear | `backend/sync/mapper.py`, outbound serializer | `tests/test_plan_basis_persistence.py` và serializer contract |
| UI thêm/xóa/sắp xếp và xem projection | `frontend/plans/PlanBasisEditor.js`, `frontend/plans/KeHoachWorkflow.js`, `frontend/plans/KeHoachView.js`, `views/modals/modal_kehoach.html` | `tests/js/plan_basis_editor.test.mjs` |
| Clone phiên bản giữ projection/lineage, ID vật lý mới | `backend/versioning/command.py`, `frontend/plans/planAggregateSnapshot.js` | `tests/test_plan_basis_persistence.py` |
| Chọn all/subset/zero trước xuất Word | `backend/documents/plan_basis_context.py`, `frontend/documents/WordPublication.js` | `tests/test_plan_basis_word_context.py`, `tests/js/word_publication_ui.test.mjs` |
| Direct export và background job cùng transport | `backend/documents/routes_docx.py`, `backend/documents/document_job_routes.py`, `frontend/documents/WordPublicationJob.js` | Word context/job/UI suites |
| Alias Word selected-only | `backend/documents/docx_service.py`, `backend/documents/docx_context_policy.py`, `backend/documents/docx_mapping_service.py` | `tests/test_plan_basis_word_context.py` |
| Từ điển có recipe raw/cấu trúc và biến item | `frontend/partners/PartnerView.js`, `frontend/documents/wordVariableManifest.js`, `views/tabs/tab_bieumau.html` | manifest check và JS dictionary tests |
| Audit không ghi free text | direct/job export audit metadata | `tests/test_plan_basis_word_context.py`, job policy/source-authority tests |
| Job cũ tiếp tục chạy | policy v3 và nhánh rebuild legacy trong `document_source_authority.py` | `tests/test_document_source_authority.py`, `tests/test_generic_document_jobs.py` |
| Không đổi quyền/hiển thị | dùng lại authorization/entitlement hiện hữu, không thêm capability | authorization và Word entitlement regression suites |

## Contract parser và Word

Ví dụ đầu vào:

```text
Căn cứ Quyết định số 123/QĐ ngày 11/11/2025 của UBND xã ABC về việc phê duyệt dự toán
```

Projection:

```json
{
  "tenVanBan": "Quyết định",
  "soVanBan": "123/QĐ",
  "ngayBanHanh": "2025-11-11",
  "donViBanHanh": "UBND xã ABC",
  "trichYeu": "phê duyệt dự toán",
  "tenCanCu": "Quyết định về việc phê duyệt dự toán"
}
```

Recipe nguyên văn:

```text
{#ds_can_cu_lap_ke_hoach}
{noi_dung_goc}
{/ds_can_cu_lap_ke_hoach}
```

Recipe cấu trúc:

```text
{#ds_can_cu_lap_ke_hoach}
Căn cứ {ten_van_ban}{cum_so_van_ban}{cum_ngay_ban_hanh}{cum_don_vi_ban_hanh}{cum_trich_yeu}
{/ds_can_cu_lap_ke_hoach}
```

Các biến item gồm `stt`, `noi_dung_goc`, `ten_can_cu`, `ten_van_ban`,
`so_van_ban`, `ngay_ban_hanh`, `S_ngay_ban_hanh`, `don_vi_ban_hanh`,
`trich_yeu`, bốn helper `cum_*` và `parse_status`.

## Migration và rollback

- Schema tăng lên v83 bằng migration additive `add_plan_bases`.
- Migration tạo `ke_hoach_can_cu`, FK đến kế hoạch, unique business order, các index
  tenant/parent/lineage/owner và workspace-owner trigger.
- Kế hoạch cũ không được backfill bằng suy đoán; mặc định có danh sách rỗng.
- PostgreSQL normalized contract: 129 tables, 605 indexes, 104 triggers.
- Word default mapping tăng từ v15 lên v16; manifest sinh tự động đã đồng bộ.

Rollback thông thường là rollback binary tương thích schema expand: tắt/không dùng UI
và mapping mới nhưng giữ nguyên bảng cùng dữ liệu. Không drop bảng trong rollback
thông thường. Nếu buộc phải hạ schema trong cửa sổ bảo trì, phải sao lưu
`ke_hoach_can_cu`, xác nhận không còn binary v83 đang chạy, rồi mới drop trigger,
index và table; thao tác này là destructive và cần kế hoạch riêng.

## Tương thích

- Template Word cũ không tham chiếu `ds_can_cu_lap_ke_hoach` tiếp tục hoạt động;
  không sửa bytes của template đã publish. Template muốn dùng căn cứ cần publish
  một version mới.
- GET `/api/export-plan/{plan_id}` và POST thiếu
  `selectedCanCuLapKeHoachIds` đều giữ hành vi compat-all.
- `selectedCanCuLapKeHoachIds: []` là lựa chọn rỗng rõ ràng; danh sách ID là exact
  subset và thứ tự luôn lấy từ máy chủ.
- Job policy v3 niêm phong mode cùng exact IDs. Policy v1/v2 vẫn được chấp nhận và
  rebuild theo context contract cũ để không làm lệch source digest.
- Parser chỉ chạy khi tạo hoặc sửa câu gốc. Clone phiên bản giữ projection và
  parser version; không parse lại âm thầm.

## Lệnh kiểm tra và kết quả

| Lệnh/phạm vi | Kết quả |
|---|---|
| Lượt xác minh Python cuối: parser, persistence, Word context, source authority, generic job và startup migration | `71 passed` |
| Lượt xác minh JS cuối: editor/serializer/job và browser Word UI, gồm explicit zero | `21 passed` |
| Broad relevant Python suite | `115 passed, 7 failed` |
| PostgreSQL contract + Word catalog combined | `27 passed, 14 failed` |
| PostgreSQL non-live contract và migration checks | `26 passed, 12 deselected` |
| Schema v83/startup focused sau chỉnh clone | `28 passed` |
| ESLint trên các frontend module thay đổi | pass |
| `python scripts/check_python_quality.py` | pass theo baseline hiện hữu |
| Word manifest, schema runtime, PostgreSQL contract và v1 fixture checks | pass |
| `python scripts/check_mojibake.py` | pass |
| `git diff --check` | pass; chỉ có cảnh báo line-ending Windows |

Các failure trong hai lượt broad/live đều do `TEST_DATABASE_URL` trỏ tới database
`biddingflow_test` đang rỗng: thiếu các bảng nền như `to_chuc`, `tai_khoan`,
`document_jobs`, `goi_dich_vu` và metadata schema. Đây là blocker môi trường, không
phải mismatch expectation của tính năng. Không sửa test để che lỗi. Contract được
generate/check thành công qua `MIGRATOR_DATABASE_URL` ở schema v83.

## Rollout

1. Chạy migration v83 và schema-contract gate trên staging có database đầy đủ.
2. Chạy lại các live PostgreSQL/document catalog suites trên staging.
3. Publish version template mới nếu muốn dùng loop căn cứ; template cũ giữ nguyên.
4. Smoke test create/edit/reorder/version clone và ba lựa chọn Word all/subset/zero.
5. Kiểm tra audit chỉ chứa mode/count/IDs/hash, không chứa câu căn cứ.
6. Chỉ deploy sau khi các gate live database đạt; thay đổi hiện tại chưa được deploy.

## Xác nhận business contract

- Không thêm masking, redaction, rút gọn hoặc lọc dữ liệu người dùng đã được phép đọc.
- Không thêm hoặc thay đổi role, module permission, record scope, assignment scope,
  capability, entitlement hay default allow/deny.
- Người có quyền đọc Kế hoạch theo contract hiện hữu thấy đầy đủ câu gốc và projection
  căn cứ.
- Word entitlement chỉ kiểm soát hành động tạo/tải Word, không kiểm soát dữ liệu ở
  màn hình hoặc API đọc Kế hoạch.
- Tenant isolation, session, module, assignment và record-level authorization hiện
  hữu vẫn được giữ nguyên.

## Điều chỉnh UI và hiệu năng sau phản hồi

- Đưa editor căn cứ vào vùng cuộn chính của form kế hoạch thay vì đặt thành một
  khối cố định giữa body và footer.
- Đồng bộ editor với token/component hiện hữu: `form-control`, `btn-sm`,
  `action-btn`, màu `surface/line/brand`, radius và focus state chung.
- Bổ sung empty state, số thứ tự trực quan, trạng thái parser và disabled state cho
  nút lên/xuống ở biên danh sách; bố cục 390 px không tràn ngang.
- Nguyên nhân modal tạo mới xuất hiện chậm là `openModal()` nằm sau bước dựng toàn
  bộ option Chủ đầu tư và searchable-select đồng bộ. Luồng mới reset phần tạo mới,
  mở modal và chờ qua frame vẽ đầu tiên trước khi chạy phần khởi tạo nặng; vẫn kiểm
  tra workspace lease sau frame và vẫn giữ lựa chọn tra cứu procurement khi flow
  yêu cầu.
- Regression command:
  `node --test tests/js/plan_modal_open_performance.test.mjs tests/js/plan_basis_editor.test.mjs tests/js/plan_version_draft_session.test.mjs`
  đạt `58 passed`.
