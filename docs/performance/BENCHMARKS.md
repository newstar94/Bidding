# Benchmark hiệu năng thủ công

Các benchmark sau phục vụ đo đạc và so sánh hiệu năng tại môi trường kiểm soát; chúng **không phải CI pass/fail gate**.

- `npm run benchmark:persistence`: đo đường ghi/persist dữ liệu rõ ràng.
- `npm run benchmark:n-plus-one`: phát hiện hồi quy số lượng truy vấn theo dữ liệu đầu vào.

Trước khi chạy, sử dụng fixture hoặc môi trường không có dữ liệu production. Ghi lại môi trường, commit và kết quả baseline để so sánh.

## Rollback

Các script benchmark chỉ đọc/đo theo fixture hoặc môi trường đã chuẩn bị. Nếu một benchmark có thay đổi dữ liệu trong môi trường thử nghiệm, rollback bằng cách khôi phục snapshot/fixture của môi trường đó trước khi lặp lại phép đo.
