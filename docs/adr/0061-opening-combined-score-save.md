# ADR 0061: Không gửi điểm kỹ thuật rỗng khi lưu biên bản mở E-HSĐXKT

- **Trạng thái:** Đã chấp thuận và triển khai
- **Ngày:** 2026-10-05

## Quyết định

Khi lưu bản ghi `thong_tin_mo_thau` ở bước mở E-HSĐXKT, client không gửi
trường `danhGiaKyThuat` nếu gói thầu thông thường chưa có điểm. Trường này
chỉ được ghi ở bước đánh giá; gói chỉ định thầu hoặc trường hợp đặc biệt vẫn
giữ giá trị `Đạt` theo hợp đồng hiện hành.

## Lý do

Gói áp dụng phương pháp kết hợp kỹ thuật và giá (`method=3`) bắt buộc điểm
kỹ thuật là số khi đánh giá. Collector của biên bản mở thầu trước đây luôn
gửi `danhGiaKyThuat: ""`, khiến server diễn giải mutation mở thầu là một kết
quả đánh giá chưa hợp lệ và trả `TECHNICAL_SCORE_REQUIRED`.

## Tương thích và kiểm chứng

- Không thay đổi mapping `method=3`/`txtK`, quy tắc bắt buộc điểm khi hoàn
  thành đánh giá, quyền, schema hoặc dữ liệu đã lưu.
- Khi field bị bỏ qua, persistence giữ nguyên kết quả đánh giá hiện có thay
  vì xóa nó trong lúc chỉnh sửa biên bản mở thầu.
- Regression: gói kết hợp kỹ thuật và giá không có `danhGiaKyThuat` trong
  payload mở thầu; các kiểm thử điểm kỹ thuật ở chế độ nháp và hoàn thành vẫn
  đạt.
