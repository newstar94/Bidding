# Chuẩn Hóa miễn phí và độc lập

Status: accepted, 2026-09-19. Quyết định trực tiếp của chủ sản phẩm: phát hành Chuẩn Hóa miễn phí, loại bỏ code quản lý người dùng Chuẩn Hóa và liên kết với BiddingFlow. Thay thế ADR `centralized-chuan-hoa-admin.md` và `cross-application-admin-integration.md`.

Chuẩn Hóa không yêu cầu tài khoản, trial, thanh toán, activation key, entitlement, giấy phép theo thời hạn hoặc định danh thiết bị. Bộ quy tắc đi cùng bản cài; kiểm tra tính toàn vẹn, tương thích và an toàn sửa Word không phải cấp quyền sử dụng và phải được giữ lại.

## Compatibility impact

Loại bỏ menu, bộ lọc đa ứng dụng, API quản trị/proxy và cấu hình kết nối Chuẩn Hóa khỏi BiddingFlow. URL tích hợp cũ không còn được hỗ trợ; không chuyển hướng sang thao tác khác. Không thay đổi tài khoản, role, scope, billing hoặc quyền đọc dữ liệu của BiddingFlow, và không xóa chức năng chuẩn hóa tài liệu Word riêng của BiddingFlow.

## Migration strategy

Cài bản Chuẩn Hóa mới để thay client còn phụ thuộc giấy phép. Ngừng dịch vụ quản trị/cấp phép cũ khi triển khai; không triển khai lại các artifact cũ. Cache giấy phép và thông tin phiên cũ không được đọc hoặc tự chuyển đổi. Không xóa database, lịch sử thanh toán, secrets hay dữ liệu cá nhân đã tồn tại bằng migration tự động; xử lý lưu trữ/xóa dữ liệu lịch sử là tác vụ riêng cần phê duyệt. Bộ quy tắc được cập nhật qua bản phát hành ứng dụng.

## Regression seams

Kiểm tra route/menu/API tích hợp đã bị loại bỏ, các route người dùng/thương mại BiddingFlow giữ nguyên; kiểm tra Chuẩn Hóa sử dụng đầy đủ bộ quy tắc khi không có tài khoản, mạng hoặc lease, và các gate an toàn tài liệu vẫn chạy.
