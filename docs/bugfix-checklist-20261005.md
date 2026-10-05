# Lỗi còn phải sửa — 05/10/2026

Nguồn: [báo cáo phân tích](D:/Bidding/docs/production-analysis-20261005.vi.md).

Thực hiện từng lỗi. Chỉ xóa mục sau khi bản sửa đã kiểm chứng đúng ca lỗi và các ranh giới liên quan. Báo cáo phân tích giữ lại bằng chứng ban đầu. Tính năng mới và các việc vận hành production nằm trong báo cáo riêng.

- [ ] B04 — Nhập Excel rồi đổi ngữ cảnh có thể lưu nhầm nhà thầu, mất trạng thái hoàn thành.
- [ ] B05 — DB đồng bộ trong các route thanh toán/thương mại chặn HTTP event loop.
- [ ] B06 — ID webhook có thể trùng giữa các provider profile.
- [ ] B07 — Metrics xác nhận backup thiếu thành phần là hợp lệ.
- [ ] B08 — Kiểm backup trong metrics nạp toàn bộ dump vào RAM.
