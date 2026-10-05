# ADR 0054 — Hoàn tất đánh giá nhà thầu trực tiếp tại bước Tài chính

Status: Accepted by the product owner's request.

## Decision

Ở bước **Tài chính**, người dùng có thể bấm **Hoàn thành đánh giá nhà thầu**
trực tiếp. Nút **Hoàn thành tab** không hiển thị ở bước này. Các bước trước
vẫn giữ thao tác hoàn thành tab để bảo đảm luồng đánh giá tuần tự mở đúng bước
tiếp theo.

Luồng lưu `completeReport` tiếp tục kiểm tra đầy đủ tiêu chí của các nhóm được
cấu hình và ghi nhận kết quả tổng hợp trước khi báo cáo được đánh dấu hoàn
thành.

## Compatibility and migration

Thay đổi chỉ ảnh hưởng tới hành động hiển thị ở giao diện bước Tài chính và
không thay đổi quyền, phạm vi bản ghi, dữ liệu hiển thị hoặc schema. Không cần
migration. Các báo cáo nháp và báo cáo đã hoàn thành hiện có tiếp tục được đọc
và xử lý theo metadata hiện tại.

## Verification

- `tests/js/detailed_evaluation_completion.test.mjs`
- `tests/js/technical_evaluation_panel.test.mjs`
- `tests/js/detailed_evaluation_tab_navigation.test.mjs`
- `tests/js/evaluation_conflict_draft_hold.test.mjs`
