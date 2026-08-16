# ADR-021: Lấy dữ liệu Mua sắm công ngay trong thao tác mở thầu

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu bổ sung nút lấy dữ liệu mở thầu từ Mua sắm công để điền thẳng vào biên bản mở thầu

## Bối cảnh và quyết định

Luồng nhập dữ liệu mở thầu từ Mua sắm công đã tồn tại ở màn hình nhập mở thầu độc lập, nhưng chưa xuất hiện trong hộp thoại chuyển gói từ “Đang mời thầu” sang “Đã mở thầu” và cũng thiếu trong panel biên bản ở màn hình chi tiết gói thầu.

Quy tắc mới:

- Hộp thoại “Chọn thời gian mở thầu” hiển thị hành động phụ “Lấy dữ liệu mở thầu từ Mua sắm công” khi gói thầu đủ điều kiện và máy chủ công bố capability nhập dữ liệu hiện hành.
- Hành động dùng đúng luồng prepare/apply preview có kiểm tra workspace và row version. Không gửi canonical source payload từ trình duyệt lên endpoint apply.
- Khi lấy thành công, thời gian mở thầu được điền vào trường ngày giờ và trạng thái trong hộp thoại thông báo số nhà thầu đã lấy.
- Người dùng vẫn phải bấm “Xác nhận” để chuyển trạng thái gói thầu. Sau khi chuyển thành công, dữ liệu nhà thầu được gộp vào bản nháp biên bản mở thầu để người dùng kiểm tra và lưu.
- Nếu bản ghi gói thầu thay đổi sau preview, thao tác bị dừng và yêu cầu người dùng lấy lại dữ liệu.
- Nút nhập Mua sắm công cũng xuất hiện trong panel biên bản mở thầu tại màn hình chi tiết, dùng chung luồng preview hiện có.
- Gói chỉ định thầu rút gọn hoặc trường hợp đặc biệt vẫn không hiển thị hành động này, giữ nguyên nghiệp vụ trước đây.

## Quy tắc trải nghiệm

- “Xác nhận” tiếp tục là CTA chính; lấy dữ liệu là nút outline phụ đặt gần trường thời gian.
- Nút nhập có biểu tượng Lucide, vùng bấm tối thiểu 44px, khóa khi đang tải và có `aria-busy`.
- Tiến trình và kết quả được thông báo bằng vùng `role="status"`/`aria-live="polite"`; khi lỗi, nút được bật lại để thử lại.
- Modal giới hạn theo chiều rộng viewport để không tràn ngang trên màn hình 375px.

## Tác động tương thích và quyền

- Giữ nguyên capability `procurement-import-v2` và quyền sửa module gói thầu ở backend; không tạo capability, entitlement hoặc đường bypass mới.
- Không thay đổi role, module permission, tenant isolation, assignment scope, record scope, masking hoặc dữ liệu người dùng được phép xem.
- Không tự động lưu biên bản: dữ liệu nguồn chỉ điền vào bản nháp; người dùng vẫn kiểm tra và dùng thao tác lưu hiện hành.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Thay đổi có hiệu lực sau khi frontend mới được build, triển khai và trình duyệt tải cache key CSS mới.

## Regression tests

- `tests/js/bid_process_tender_lifecycle_conflict.test.mjs` kiểm tra lấy preview, tự điền thời gian, chuyển trạng thái rồi áp dụng nhà thầu vào draft theo đúng thứ tự.
- `tests/js/procurement_import_wizard.test.mjs` kiểm tra prepare/apply dùng một preview authority, row version và workspace lease.
- `tests/js/package_tab_opening_icons.test.mjs` kiểm tra panel chi tiết có nút nhập Mua sắm công cùng mô tả trợ năng.
- `tests/js/custom_prompt_secondary_action.test.mjs` kiểm tra nút phụ, nhãn trường, trạng thái aria-live, tự điền giá trị, vùng bấm 44px và không tràn ngang ở viewport 375px.
