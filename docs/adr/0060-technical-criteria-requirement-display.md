# ADR 0060 — Hiển thị yêu cầu tiêu chí kỹ thuật

Status: Accepted by the product owner's request.

## Decision

Trong bảng đánh giá kỹ thuật, trường “Yêu cầu của tiêu chí (nếu có)” là
trường tùy chọn:

- Khi báo cáo ở chế độ xem, tiêu chí luôn hiển thị nội dung tiêu chí dạng văn
  bản. Chỉ khi có nội dung yêu cầu sau khi trim mới hiển thị thêm đường phân
  cách và dòng in đậm `Yêu cầu:` theo cùng cách trình bày với nhóm Năng lực và
  kinh nghiệm.
- Khi yêu cầu rỗng, không tạo placeholder hoặc vùng trống cho trường này.
- Chế độ sửa vẫn giữ textarea yêu cầu để người dùng thêm hoặc sửa nội dung.
- Các icon thao tác tiêu chí dùng màu theo ý nghĩa: thêm và lưu màu xanh lá,
  sửa màu xanh dương, xóa màu đỏ.

## Compatibility and migration

Đây là thay đổi trình bày phía client. Không thay đổi schema, dữ liệu đã lưu,
quyền, phạm vi bản ghi hoặc logic chấm điểm. Nội dung chỉ được trim khi dựng
giao diện; giá trị nhập vẫn đi qua luồng thu thập draft hiện tại.

## Verification

- `tests/js/technical_evaluation_panel.test.mjs`
- `tests/js/technical_evaluation_actions_layout.test.mjs`

