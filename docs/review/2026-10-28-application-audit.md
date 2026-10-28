# BiddingFlow — Vấn đề còn tồn tại

Cập nhật: 28/10/2026. Chưa khắc phục và kiểm chứng toàn bộ ứng dụng.

## Vấn đề đã xác nhận, chưa xử lý xong

- **Ruff trả đầu ra rỗng:** chưa xác định nguyên nhân; chưa xác nhận lint Python toàn dự án. Bộ kiểm tra đã báo lỗi công cụ thay vì báo sai baseline.
- **CSS vượt ngưỡng:** 434 `!important`, ngưỡng 428; chưa xử lý và chưa có visual test để xác nhận việc giảm CSS không làm lệch giao diện.

## Các phần chưa hoàn tất kiểm chứng

- **Audit dependency online:** chưa hoàn tất do hạn chế kết nối; chưa kết luận các thư viện còn lỗ hổng hay không.
- **Kiểm thử tích hợp:** chưa hoàn tất HTTP/event loop, PostgreSQL, E2E trình duyệt và document worker Linux. Một số lượt chạy bị treo hoặc bị chặn bởi môi trường.
- **Hiệu năng và trải nghiệm thực tế:** chưa đo đầy đủ startup, truy vấn DB, tải đồng thời, bộ nhớ và responsive. Các đề xuất tối ưu index, cache runtime CSS và observer chưa có số đo để quyết định sửa.
- **Production:** chưa triển khai hoặc kiểm chứng các bản sửa trên production.

Các mục chưa kiểm chứng không đồng nghĩa đã xác nhận có lỗi. Khi xử lý tiếp, giữ nguyên contract quyền truy cập và hiển thị dữ liệu trong AGENTS.md; không nới ngưỡng hoặc sửa kỳ vọng kiểm thử để làm xanh kết quả.
