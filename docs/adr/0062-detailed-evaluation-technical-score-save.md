# ADR 0062: Ghi điểm kỹ thuật số khi lưu đánh giá chi tiết

- **Trạng thái:** Đã chấp thuận và triển khai
- **Ngày:** 2026-10-05

## Quyết định

Khi lưu báo cáo đánh giá chi tiết của gói áp dụng phương pháp kết hợp kỹ
thuật và giá, bản nháp không gửi lại kết quả kỹ thuật dạng phân loại cũ
(`Đạt` hoặc `Không đạt`). Khi hoàn thành nhóm kỹ thuật, hệ thống tổng hợp
điểm từ các tiêu chí và ghi `danhGiaKyThuat` bằng chuỗi số. Khi hoàn thành
toàn bộ báo cáo, điểm kỹ thuật cũng phải là số trước khi gửi mutation.

## Lý do

Bản ghi mở thầu trước đó có thể giữ `danhGiaKyThuat: "Đạt"`. Luồng lưu báo
cáo chi tiết gửi lại toàn bộ bản ghi này trước khi nhóm kỹ thuật được chiếu
điểm, khiến server trả `TECHNICAL_SCORE_REQUIRED` dù người dùng đã nhập điểm
ở các tiêu chí đánh giá.

## Tương thích và kiểm chứng

- Không thay đổi quyền, phạm vi dữ liệu, schema hoặc quy tắc phương pháp đánh
  giá.
- Bản nháp vẫn lưu nội dung tiêu chí; bỏ trường legacy khỏi mutation để server
  giữ giá trị canonical hiện có cho tới khi có điểm số hợp lệ.
- Hoàn thành nhóm kỹ thuật yêu cầu có điểm số và chiếu tổng điểm dạng số.
- Regression: `tests/js/detailed_evaluation_completion.test.mjs`; nhóm test
  hoàn thành và giao diện kỹ thuật đạt 14/14.
