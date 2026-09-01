# ADR 0033 — Xuất Word giữ nguyên định dạng template đã chọn

- Trạng thái: Chấp nhận
- Ngày: 2026-09-01
- Phạm vi: `render_docx`, `render_docx_batch`, document worker và Word Template Catalog

## Quyết định

Mọi luồng xuất Word render trực tiếp từ đúng bytes của phiên bản template mà
assignment hiện hữu đã chọn. Đường xuất không tự phân loại tài liệu, không chọn
profile chuẩn hóa, không chạy `preview_fix`/`apply_fix`, không thay thế template
bằng candidate đã chuẩn hóa và không dùng cache template chuẩn hóa.

`WORD_EXPORT_STANDARDIZATION_MODE` cùng cache chuẩn hóa tự động bị loại khỏi cấu
hình runtime. Giá trị legacy còn tồn tại trong môi trường triển khai không có tác
dụng lên kết quả xuất. Định dạng của tài liệu đầu ra chỉ thay đổi do merge dữ liệu
vào placeholder và hành vi render vốn có của exporter; worker không chủ động đổi
font, cỡ chữ, màu, căn lề hoặc các thuộc tính trình bày của template.

Word Template Catalog vẫn hỗ trợ preflight, preview và tạo một bản nháp đã chuẩn
hóa khi người quản lý chủ động chọn. Nếu bản nháp đó được publish và assignment
trỏ tới phiên bản ấy, xuất Word sử dụng nó như một template bình thường. Catalog
không còn là bước ngầm trong đường xuất.

## Business và authorization contract

- Không thay đổi session, tenant isolation, module permission, assignment scope,
  record scope, Word entitlement hoặc audit hiện hữu.
- Không thay đổi dữ liệu merge, masking, redaction hoặc tập trường người dùng đã
  được phép đọc và xuất.
- Không sửa source/published template trong quá trình xuất.
- Cả xuất đồng bộ, durable job và xuất theo lô phải dùng cùng contract giữ nguyên
  template.

## Compatibility impact

API request/response, durable job payload, template assignment và provenance giữ
nguyên. Tài liệu trước đây được tự động chuẩn hóa bằng `apply_safe` sẽ không còn
nhận các thay đổi định dạng đó; kết quả mới phản ánh template đã publish/assign.

Biến `WORD_EXPORT_STANDARDIZATION_MODE` và các biến `WORD_EXPORT_CACHE_*`/
`BIDDING_WORD_EXPORT_CACHE_DIR` được bỏ khỏi template cấu hình. Không có schema
migration hoặc data backfill. Thư mục cache cũ không được đọc nữa và có thể được
dọn bằng quy trình vận hành riêng sau khi xác nhận không cần rollback.

## Regression

Regression test phải đặt `WORD_EXPORT_STANDARDIZATION_MODE=apply_safe` như một
giá trị legacy rồi xác nhận font, cỡ chữ và màu của template vẫn được giữ nguyên
trong file xuất. Các test Word Template Catalog tiếp tục bảo vệ workflow chuẩn
hóa thủ công độc lập.
