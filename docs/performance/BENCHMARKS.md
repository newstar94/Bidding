# Benchmark thủ công

Các benchmark hiệu năng dưới đây do nhóm phát triển chủ động chạy khi thay đổi
đường ghi dữ liệu hoặc truy vấn lớn. Chúng cung cấp số đo để so sánh và **không phải CI pass/fail gate**.

- `npm run benchmark:persistence`: đo transaction ghi, xử lý lỗi và rollback.
- `npm run benchmark:n-plus-one`: phát hiện hồi quy truy vấn N+1 trên các luồng
  đọc dữ liệu chính.

Ghi lại cấu hình máy, kích thước dữ liệu, commit và kết quả trước/sau trong báo
cáo thay đổi để số đo có thể tái lập.
