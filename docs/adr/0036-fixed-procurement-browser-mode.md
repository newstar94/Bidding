# ADR 0036 — Cố định chế độ trình duyệt tra cứu

- Trạng thái: Chấp thuận theo yêu cầu chủ sản phẩm ngày 05/09/2026.
- Quyết định: bộ đọc cấu hình tra cứu và nguồn tích hợp dùng chung hằng số
  `PROCUREMENT_BROWSER_MODE = "research-stealth"`, `RESEARCH_STEALTH_ENABLED = True`.
- Hai biến môi trường cùng tên không còn tác dụng, kể cả giá trị standard,
  false, rỗng hoặc không hợp lệ. Registry không tái tạo nguồn vì hai biến legacy.
- Giữ nguyên allowlist hostname chính thức, kiểm tra nguồn, CAPTCHA, timeout,
  driver/extractor, công tắc bật/tắt lookup, tenant/module/assignment/record scope.
- Tương thích: deployment từng dùng standard hoặc tắt stealth nay dùng stealth;
  không còn rollback chế độ bằng ENV. Không có migration DB hoặc đổi secret.
- Triển khai: dùng code mới, khởi động lại web/worker; có thể bỏ hai biến legacy.
  Rollback bằng phiên bản code trước cùng cấu hình phù hợp, không bằng hai biến này.
- Regression: kiểm tra cả settings và source khi legacy là standard/false/rỗng/sai;
  hostname ngoài phạm vi vẫn bị từ chối. Không thay behavior của quyền đọc dữ liệu.
