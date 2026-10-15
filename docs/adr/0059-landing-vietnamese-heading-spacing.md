# ADR 0059: Giãn chữ cho tiêu đề tiếng Việt trên landing page

- **Trạng thái:** Đã chấp thuận và triển khai
- **Ngày:** 2026-10-05
- **Phạm vi:** Các tiêu đề lớn ở hero, phần proof và CTA cuối trang công khai

## Quyết định

Tiêu đề tiếng Việt dùng `letter-spacing: -0.01em` và `word-spacing: 0.02em`. Không thay đổi cỡ chữ, chiều cao dòng hoặc nội dung. Khoảng cách này giữ phong cách display hiện tại nhưng bảo toàn khoảng trắng giữa từ và khoảng thở cho dấu tiếng Việt.

## Lý do

### Cập nhật 2026-10-15: khoảng cách giữa dòng

Theo yêu cầu sửa chữ chồng dòng, các h1/h2/h3 trong `.landing-page` dùng
`line-height: 1.35`. Quyết định này thay thế giới hạn không đổi chiều cao dòng
ở bản sửa trước; giữ nguyên cỡ chữ, nội dung, khoảng cách ký tự và từ.
Phông Plus Jakarta Sans đã tải đầy đủ vẫn cho khoảng hở nét chữ âm ở cấu hình
cũ (khoảng -5 đến -9 px tại các tiêu đề được báo lỗi).

Kiểm thử `tests/js/vietnamese_heading_lines.test.mjs` đo dòng thực tế bằng
DOM Range và nét chữ bằng Canvas tại 320, 390, 768, 1024, 1440 và 1920 px;
yêu cầu khoảng hở tối thiểu 2 px. Chỉ đổi chiều cao dòng đã làm phép thử đạt.
Các vùng phía dưới có thể dịch xuống theo chiều cao nội dung mới; giữ nguyên
content-visibility, không cần migration và không thay đổi quyền hoặc dữ liệu.

Sau phản hồi khoảng cách quá rộng, tinh chỉnh hero/proof về `1.2` và CTA
về `1.32`; các tiêu đề nhỏ giữ `1.35` để đủ chỗ cho dấu. Cả sáu kích thước
vẫn đạt kiểm thử khoảng hở tối thiểu 2 px; không giảm ngưỡng kiểm thử.

Thiết lập cũ nén chữ từ khoảng `-0.055em` đến `-0.065em`, làm một số cụm từ trong tiêu đề lớn bị dính khi font Plus Jakarta Sans hiển thị tiếng Việt.

## Tương thích và kiểm chứng

- Không thay đổi dữ liệu, quyền, route, API hoặc nội dung nghiệp vụ.
- Regression kiểm tra khoảng cách ký tự, khoảng cách từ, chiều cao dòng và overflow ở 390, 768 và 1440 px.
- Regression deferred layout xác nhận ảnh chụp, hình học, typography và native navigation vẫn giữ nguyên ở 320, 768 và 1280 px.
