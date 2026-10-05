# ADR 0059: Giãn chữ cho tiêu đề tiếng Việt trên landing page

- **Trạng thái:** Đã chấp thuận và triển khai
- **Ngày:** 2026-10-05
- **Phạm vi:** Các tiêu đề lớn ở hero, phần proof và CTA cuối trang công khai

## Quyết định

Tiêu đề tiếng Việt dùng `letter-spacing: -0.01em` và `word-spacing: 0.02em`. Không thay đổi cỡ chữ, chiều cao dòng hoặc nội dung. Khoảng cách này giữ phong cách display hiện tại nhưng bảo toàn khoảng trắng giữa từ và khoảng thở cho dấu tiếng Việt.

## Lý do

Thiết lập cũ nén chữ từ khoảng `-0.055em` đến `-0.065em`, làm một số cụm từ trong tiêu đề lớn bị dính khi font Plus Jakarta Sans hiển thị tiếng Việt.

## Tương thích và kiểm chứng

- Không thay đổi dữ liệu, quyền, route, API hoặc nội dung nghiệp vụ.
- Regression kiểm tra khoảng cách ký tự, khoảng cách từ, chiều cao dòng và overflow ở 390, 768 và 1440 px.
- Regression deferred layout xác nhận ảnh chụp, hình học, typography và native navigation vẫn giữ nguyên ở 320, 768 và 1280 px.
