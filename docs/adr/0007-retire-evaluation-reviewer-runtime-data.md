---
status: accepted
supersedes: 0005-detailed-evaluation-has-no-reviewer-identity
---

# Không lưu danh tính người chấm trong dữ liệu đánh giá

Code hiện tại không đọc, ghi, lập chỉ mục hoặc kiểm tra `nguoi_cham_id`
cho vòng đánh giá, báo cáo đánh giá chi tiết hay kết quả đánh giá
nhà thầu.

Các cột vật lý nullable cùng tên chỉ được giữ trong schema để code cũ
vẫn chạy với database schema mới hơn. Code mới không được phép phụ thuộc
vào các cột tương thích này.
