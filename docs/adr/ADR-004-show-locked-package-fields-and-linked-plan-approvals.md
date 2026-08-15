# ADR-004: Hiển thị đầy đủ trường gói đã khóa và các QĐ kế hoạch liên kết

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-15
- Chủ sản phẩm phê duyệt: Có, trong hội thoại xử lý gói nhập từ Mua Sắm Công

## Bối cảnh

Các trường nền của gói thầu đã ở trạng thái “Đang mời thầu” trở đi được khóa để ngăn sửa dữ liệu lịch sử. Giao diện cũ đồng thời ẩn các trường này khỏi modal cập nhật, khiến người dùng hiểu nhầm dữ liệu nhập từ Mua Sắm Công bị khuyết dù màn chi tiết và cơ sở dữ liệu vẫn có tên gói, lĩnh vực, hình thức, phương thức và các dữ liệu liên quan.

Màn chi tiết cũng chỉ gọi `getLatestPlan()` rồi hiển thị một ngày phê duyệt. Cách này không phản ánh đúng trường hợp một lineage gói thầu được snapshot vào nhiều phiên bản kế hoạch, mỗi phiên bản có số QĐ và ngày phê duyệt riêng.

## Quyết định nghiệp vụ

Các trường thuộc `lockedAfterInvitation` vẫn bị khóa theo lifecycle hiện hành nhưng phải tiếp tục hiển thị đầy đủ trong modal. Danh sách phần lô, tùy chọn mua thêm và phân loại gói thuốc cũng được hiển thị ở chế độ chỉ đọc khi có dữ liệu.

Từ trạng thái “Đang mời thầu” trở đi, `Thời gian thực hiện`, `Thời gian tổ chức LCNT` và `Thời gian bắt đầu tổ chức` cũng là dữ liệu nền bị khóa. Chúng tiếp tục hiển thị để đối chiếu nhưng không được sửa.

Nếu một trường không có trong snapshot MSC, giao diện giữ trạng thái “Chưa có dữ liệu” thay vì tự chọn giá trị đầu tiên của danh mục. Cụ thể, BiddingFlow không tự suy đoán phương pháp đánh giá khi upstream trả `evalMethod = null`.

Màn chi tiết gói thầu lấy tất cả phiên bản gói có cùng `rootId`, từ đó lấy đúng các snapshot kế hoạch được liên kết qua `keHoachId`. Mỗi cặp “số QĐ phê duyệt + ngày phê duyệt” khác nhau được hiển thị cùng các phiên bản kế hoạch liên quan. Các cặp giống nhau sau khi chuẩn hóa ngày và khoảng trắng/chữ hoa-thường của số QĐ chỉ hiển thị một lần.

## Phạm vi tương thích

- Không thay đổi role, module permission, tenant, assignment, record scope, entitlement hoặc quyền sửa dữ liệu.
- Không mở khóa trường và không thay đổi quy tắc bất biến của phiên bản kế hoạch lịch sử.
- Bản ghi cũ không cần ghi lại; thay đổi chỉ sửa cách đọc và trình bày dữ liệu đã được người dùng hiện tại cấp quyền xem.
- Khi frontend phân trang chưa có đủ snapshot kế hoạch trong cache, màn chi tiết tải các bản ghi kế hoạch được liên kết bằng API đọc bản ghi hiện hành; authorization hiện hữu vẫn được áp dụng.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Rollback bằng cách khôi phục cách ẩn trường và resolver một kế hoạch cũ; không có dữ liệu mới cần xóa.

## Regression tests

- `tests/js/package_field_visibility.test.mjs`
- `tests/js/package_plan_approvals.test.mjs`
