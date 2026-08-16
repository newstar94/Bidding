# ADR-026: Bảng dữ liệu dài phân trang 10 dòng

- Trạng thái: Đã chấp thuận
- Ngày: 2026-08-16
- Chủ sản phẩm phê duyệt: Có, trong yêu cầu kiểm tra hiển thị dữ liệu và phân trang 10 dòng khi có nhiều dữ liệu

## Bối cảnh và quyết định

Các danh sách nghiệp vụ chính đã phân trang 10 dòng, nhưng một số bảng quản trị, tài nguyên Word, timeline và hàng hóa vẫn hiển thị nhiều hơn 10 dòng hoặc dùng kích thước trang 20/100 dòng.

Quy tắc hiển thị thống nhất:

- Mỗi trang hiển thị tối đa 10 bản ghi dữ liệu.
- Điều khiển phân trang chỉ xuất hiện khi tổng số bản ghi lớn hơn 10.
- Phạm vi áp dụng gồm danh sách kế hoạch, gói thầu, hợp đồng, chủ đầu tư, nhà thầu, chuyên gia hiện hữu; tài khoản hệ thống; đơn vị; nhân viên; ma trận phân quyền; trạng thái hợp đồng; biểu mẫu Word; biến Word; timeline; danh mục hàng hóa; hàng hóa dự thầu; biên bản mở thầu trước/sau khi lưu; mở hồ sơ tài chính; báo cáo đánh giá tổng hợp/chi tiết/lịch sử; duyệt kỹ thuật/kết quả; các bảng phần lô, gia hạn, làm rõ, tổ chuyên gia/thẩm định; preview nhập dữ liệu; và trang đối chiếu xuất kết quả Excel.
- Tìm kiếm hoặc bộ lọc vẫn áp dụng trước khi phân trang. Khi tập kết quả giảm, số trang hiện tại được kẹp về trang hợp lệ cuối cùng.
- Số thứ tự hiển thị tiếp tục phản ánh vị trí trong toàn bộ tập kết quả, không bắt đầu lại từ 1 ở mỗi trang.
- Ma trận phân quyền giữ tất cả dòng trong DOM và chỉ ẩn dòng ngoài trang hiện tại để thao tác lưu vẫn đọc đầy đủ các giá trị đã chỉnh sửa trên mọi trang.
- Các bảng draft mở thầu, đánh giá và bảng nhập liệu động cũng giữ tất cả dòng/input trong DOM; paginator chỉ dùng thuộc tính `hidden`, nên lưu, validation và đồng bộ vẫn đọc toàn bộ tập bản ghi.
- Dòng vốn đã `hidden` bởi quy tắc nghiệp vụ không được paginator tự hiển thị lại.
- Timeline giữ toàn bộ dòng trong state; chuyển trang chỉ thay đổi tập dòng được render.

## Tác động tương thích

- Không bỏ, lọc, rút gọn, masking, redaction hoặc thay đổi nội dung trường dữ liệu mà người dùng được phép xem; người dùng truy cập toàn bộ bản ghi qua các trang.
- Không thay đổi role, module permission, tenant isolation, assignment scope, record scope, capability, entitlement, session check, audit hoặc quyền xuất Word.
- Không thay đổi API nghiệp vụ, schema hoặc định dạng dữ liệu. Riêng request xem trước kết quả Excel đổi `pageSize` từ 100 xuống 10; response contract giữ nguyên.
- Các bảng có tối đa 10 bản ghi giữ nguyên cách hiển thị và không hiện thanh phân trang.
- Các danh sách có paginator riêng tiếp tục dùng paginator hiện hành; cơ chế phân trang DOM chỉ áp dụng cho bảng opt-in để không tạo hai thanh điều hướng.

## Migration strategy

Không cần migration schema hoặc dữ liệu. Frontend mới áp dụng kích thước trang 10 sau khi build và triển khai; mọi state phân trang chỉ tồn tại trong phiên giao diện và tự kẹp khi dữ liệu thay đổi.

## Regression tests

- `tests/js/table_pagination.test.mjs` — xác nhận biên 10/11 dòng, kích thước trang 10, cửa sổ nút trang, số thứ tự toàn cục và kẹp trang cũ.
- `tests/js/table_pagination.test.mjs` — xác nhận bảng chỉnh sửa giữ đủ dòng trong DOM và chỉ ẩn các trang chưa chọn.
- `tests/js/table_pagination.test.mjs` — xác nhận phân trang tự động không mở lại dòng bị ẩn bởi quy tắc nghiệp vụ.
- `tests/js/opening_save_regressions.test.mjs` — xác nhận 11 dòng draft mở thầu chỉ hiện 10 nhưng cả 11 input vẫn tồn tại để lưu; bảng mở thầu và báo cáo đánh giá cùng opt-in vào seam phân trang dùng chung.
- `tests/js/award_result_excel_export.test.mjs` — xác nhận request xem trước kết quả Excel gửi `pageSize=10`.
- `tests/js/package_goods.test.mjs` — xác nhận cửa sổ nút trang của danh mục hàng hóa tiếp tục đồng nhất với các bảng khác.
- `tests/js/timeline_rule_engine.test.mjs` — xác nhận mô hình và quy tắc timeline không thay đổi khi thêm seam phân trang.
