# Ngân sách hiệu năng frontend

## Mục tiêu build

Build phát hành mặc định dùng `vite build --mode production`, minify nhưng không obfuscate. Obfuscation chỉ là tùy chọn phân phối qua `npm run build:secure`; đây không phải biện pháp bảo mật và không thay thế authorization, CSP hay kiểm soát dữ liệu phía server.

Ngân sách được kiểm tra bằng `npm run audit:bundle`:

- JavaScript khởi tạo: tối đa 400 KiB raw và 110 KiB gzip.
- Một lazy chunk: tối đa 260 KiB raw.
- Admin, Excel và Word phải là dynamic entry, không thuộc graph JavaScript khởi tạo.
- Tên asset phát hành có content hash để hỗ trợ cache bất biến.

Baseline ngày 2026-07-14: khoảng 274 KiB raw / 75 KiB gzip cho graph khởi tạo, giảm từ bundle đơn khoảng 1,67 MiB raw / 317 KiB gzip. XLSX được tải riêng khi người dùng thực sự chạy chức năng Excel.

## Thiết bị và trải nghiệm mục tiêu

- Laptop văn phòng 4 nhân, RAM 8 GB.
- Chrome/Edge hiện hành, mạng mô phỏng Fast 3G cho lần tải đầu.
- Initial JavaScript parse/compile mục tiêu dưới 300 ms trong Lighthouse CI; LCP dưới 2,5 giây ở percentile 75.
- Mỗi thay đổi vượt ngân sách phải có số đo thực tế, lý do và ngân sách mới được review, không được chỉ tăng ngưỡng để qua CI.
