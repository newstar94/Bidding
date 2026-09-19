# ADR 0046 — BiddingFlow độc lập

Status: accepted, 2026-09-19; reaffirmed by the product owner.

## Quyết định

BiddingFlow chỉ quản lý sản phẩm BiddingFlow. Không duy trì menu đa ứng dụng,
client quản trị sản phẩm ngoài, reverse proxy sản phẩm ngoài hoặc cấu hình
kết nối cho các tích hợp đã nghỉ dùng.

## Tương thích và chuyển đổi

Các URL tích hợp đã nghỉ dùng không được hỗ trợ và không chuyển hướng sang
thao tác khác. Xóa cấu hình tích hợp không còn consumer. Không tự xóa database,
secrets ngoài repository hoặc dữ liệu lịch sử của sản phẩm khác.

Giữ nguyên tài khoản, vai trò, tenant/module/assignment/record scope, billing,
quyền xuất Word và quyền đọc dữ liệu BiddingFlow. Chuẩn hóa dữ liệu và công cụ
chuẩn hóa tài liệu Word nội bộ BiddingFlow không phải tích hợp sản phẩm ngoài.

## Kiểm chứng

Kiểm tra tập route Admin BiddingFlow chính xác; từ chối route không đăng ký;
không có bộ lọc đa ứng dụng. Kiểm tra module graph và các test tài liệu Word.
