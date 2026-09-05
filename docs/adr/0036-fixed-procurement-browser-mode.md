# ADR 0036 — Trình duyệt tra cứu thống nhất

- Chấp thuận theo yêu cầu chủ sản phẩm ngày 05/09/2026.
- Launcher: `ProcurementBrowserLauncher`. Không có lựa chọn mode hoặc cờ bật riêng.
- Bỏ metadata browserMode khỏi worker, nguồn trả về, log và benchmark.
- Giữ nguyên Chromium launch/context, driver, extractor, CAPTCHA, timeout, cache,
  giới hạn dung lượng, tái sử dụng trình duyệt và quyền truy cập dữ liệu.
- Allowlist đổi tên thành `PROCUREMENT_ALLOWED_TARGET_HOSTS`; vẫn chỉ chấp nhận
  đúng hostname chính thức. Deployment có override cũ phải chuyển nguyên giá trị
  sang tên mới trước restart. Không nới rộng phạm vi hostname.
- Không migration DB, không sửa dữ liệu lịch sử. Consumer ngoài repo dùng metadata
  đã bỏ cần cập nhật. Triển khai cần restart web/worker; rollback bằng code trước.
- Test bảo vệ cấu hình launch, hostname, trích xuất và luồng nhập; chưa là thử nguồn live.
