# ADR 0081: Đồng bộ tên Lấy dữ liệu tự động trên frontend

- Trạng thái: Chấp thuận theo yêu cầu chủ sản phẩm
- Ngày: 2026-10-10

## Business contract

Tên hiển thị chức năng Mua Sắm Công đổi thành “Lấy dữ liệu tự động” trong frontend, bao gồm bảng giá, tài khoản, quản lý gói, thống kê và thông báo thao tác. Đây là phần tiếp tục của ADR 0026.

Mô tả và lợi ích gói trong catalog cũ được đổi tên tại lớp trình bày. Nội dung có thể chỉnh sửa trong trường cấu hình Admin giữ giá trị gốc để không tự ý ghi lại bản phát hành. Không áp dụng phép đổi tên lên dữ liệu bản ghi nghiệp vụ.

## Compatibility impact

Không đổi chức năng, giá, hạn mức, quyền, provider, selector, API hoặc dữ liệu lưu. Catalog và bản phát hành đã mua vẫn giữ nguyên.

## Migration và rollback

Không cần migration. Phát hành frontend mới để cập nhật tên. Rollback bằng cách hoàn nguyên thay đổi trình bày.

## Regression seams

Kiểm tra catalog cũ được trình bày bằng tên mới mà không bị sửa dữ liệu nguồn; kiểm tra bảng giá landing/storefront, xem trước gói Admin, tài khoản và thông báo lấy dữ liệu.
