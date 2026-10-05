# ADR 0053 — Thao tác và phân cấp tiêu chí đánh giá kỹ thuật

Status: Accepted by the product owner's request.

## Decision

Trong bảng đánh giá kỹ thuật:

- STT là giá trị trình bày cố định, không cho nhập hoặc sửa trực tiếp.
- Sau cột “Nhận xét của chuyên gia” có cột “Thao tác”, chỉ dùng icon cho thêm,
  sửa và xóa.
- Thêm trên một dòng kỹ thuật tạo tiêu chí con ngay sau nhánh của dòng đó và
  sinh STT con theo dạng `1.1`, `1.2`.
- Sửa mở khóa nội dung tiêu chí, yêu cầu và giới hạn điểm của đúng dòng; nút
  sửa chuyển thành hoàn tất.
- Xóa tiêu chí cha có tiêu chí con phải xác nhận rồi xóa cả nhánh và kết quả
  đánh giá tương ứng. Xóa không tự đánh số lại các tiêu chí còn lại.
- Các nhóm đánh giá khác giữ luồng hiện tại.

## Compatibility and migration

Thay đổi chỉ áp dụng cho giao diện và draft metadata của tiêu chí đánh giá kỹ
thuật. Không có schema migration và không rewrite các báo cáo đã lưu. STT cũ
được hiển thị nguyên trạng; việc thêm mới dùng số con kế tiếp trong cùng nhánh.
Khi khóa đọc hoặc báo cáo đã hoàn thành, cột thao tác không cho mutation.

## Verification

- `tests/js/technical_evaluation_panel.test.mjs`
- Regression tests for technical criterion actions and hierarchy
- Existing detailed-evaluation, medicine, save and Excel tests

