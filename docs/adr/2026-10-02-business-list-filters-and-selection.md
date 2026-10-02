# Bộ lọc nhiều trường và chọn dòng trong ba danh sách

Ngày: 2026-10-02. Trạng thái: đã triển khai theo yêu cầu chủ sản phẩm.

## Phạm vi

Kế hoạch, Gói thầu, Hợp đồng dùng nút **Bộ lọc** mở modal popup ở giữa màn hình, theo yêu cầu điều chỉnh của chủ sản phẩm. Modal không làm thay đổi vị trí của bảng; vùng điều kiện cuộn riêng, tiêu đề và các nút hành động luôn hiển thị. Các ô lọc năm, tháng, trạng thái, hình thức trước đây không còn hiển thị bên ngoài. Tìm kiếm, cột dữ liệu, thao tác từng dòng và bộ chọn phiên bản tiếp tục hoạt động.

Người dùng chọn một hoặc nhiều trường. Điều kiện giữa các trường kết hợp AND; nhiều giá trị của một trường kết hợp OR. Theo điều chỉnh của chủ sản phẩm, popup **Kế hoạch** chỉ có **Chủ đầu tư** (chọn một hoặc nhiều chủ đầu tư) và **Thời gian phê duyệt kế hoạch** (trường `ngayPheDuyet`, khoảng **Từ ngày – Đến ngày**). Có thể lọc riêng từng trường hoặc kết hợp cả hai; không có lựa chọn năm/tháng riêng trong popup Kế hoạch.

Theo điều chỉnh tiếp theo của chủ sản phẩm, popup **Hợp đồng** chỉ có bảy trường: **Chủ đầu tư**, **Nhà thầu**, **Kế hoạch**, **Gói thầu**, **Người phụ trách**, **Trạng thái**, **Ngày ký**. Sáu trường đầu cho chọn một hoặc nhiều giá trị. Ngày ký dùng trường `ngayKy` với khoảng **Từ ngày – Đến ngày**, không có lựa chọn năm/tháng riêng. Có thể dùng từng trường hoặc kết hợp nhiều trường.

Theo ảnh và yêu cầu tiếp theo của chủ sản phẩm, popup **Gói thầu** chỉ có mười trường: **Kế hoạch**, **Trạng thái**, **Hình thức lựa chọn**, **Lĩnh vực**, **Phương thức lựa chọn**, **Loại hợp đồng**, **Chia phần / lô**, **Gói thầu thuốc**, **Tùy chọn mua thêm**, **Ngày phát hành hồ sơ**. Chín trường đầu cho chọn một hoặc nhiều giá trị. Ngày phát hành hồ sơ dùng `thoiGianDangTai` (`thoi_gian_dang_tai`): thời gian đăng tải được lưu trong thao tác phát hành HSMT hiện hành. Khoảng **Từ ngày – Đến ngày** tính theo ngày Việt Nam; không có bộ lọc năm/tháng riêng hoặc ngày quyết định trong popup.

Khoảng bao gồm hai đầu; ô trống không tạo điều kiện; chỉ nhập một đầu khoảng cũng hợp lệ; số 0 là giá trị hợp lệ. Từ ngày lớn hơn Đến ngày bị từ chối trước khi áp dụng. Từ khóa tìm kiếm không phân biệt hoa thường và giữ dấu tiếng Việt. Các ký tự %, _ và dấu gạch chéo ngược được hiểu là ký tự thông thường. Ngày của trường có giờ được tính theo Asia/Ho_Chi_Minh.

Thay đổi trong modal là bản nháp. **Áp dụng** cập nhật danh sách và về trang 1. **Hủy**, nút đóng, nhấn nền bên ngoài hoặc Escape ngoài vùng lựa chọn hủy bản nháp. **Xóa điều kiện** tác động tới bản nháp; cần Áp dụng để bỏ bộ lọc hiện hành. Nút Bộ lọc hiển thị số điều kiện đang áp dụng. Khi mở, bàn phím và thao tác chuột giới hạn trong modal; khi đóng, tiêu điểm trở về nút Bộ lọc.

## Chọn dòng

- Checkbox đầu bảng chỉ chọn trang hiện tại, gồm cả dòng chưa được dựng trong bảng cuộn ảo. Điện thoại có ô **Chọn trang này** riêng.
- Sau khi chọn trang, có thể chọn toàn bộ kết quả của tìm kiếm và bộ lọc hiện tại. Trạng thái này lưu truy vấn và các dòng đã bỏ chọn; không tải toàn bộ bản ghi về trình duyệt.
- Duy trì lựa chọn khi chuyển trang/sắp xếp. Đổi tìm kiếm, điều kiện, cảnh báo dashboard, tài khoản, tổ chức hoặc phạm vi truy cập sẽ xóa lựa chọn.
- Khi đồng bộ xác nhận có bản ghi bị xóa, bỏ lựa chọn của danh sách liên quan để không giữ ID hoặc số lượng đã lỗi thời; phản hồi của phiên làm việc cũ không được xóa lựa chọn trong phiên mới.
- Mỗi họ bản ghi được chọn tối đa một phiên bản. Chọn dòng giữ đúng phiên bản đang hiển thị. Nếu hiển thị phiên bản khác, bỏ lựa chọn họ bản ghi đó; người dùng chọn lại phiên bản mong muốn.
- Chọn toàn bộ dùng phiên bản hiện hành của các kết quả chưa xem và những phiên bản đã chọn rõ ràng. Mô tả lựa chọn là đầu vào cho thao tác hàng loạt; không phải bằng chứng về quyền hay ảnh chụp bất biến của dữ liệu.
- Theo yêu cầu tiếp theo của chủ sản phẩm, bổ sung **Xóa dữ liệu đã chọn** trong cả ba danh sách. Danh sách, phiên bản, quyền và trạng thái được xác minh lại với máy chủ trước khi thực hiện.

## Xóa dữ liệu đã chọn

Nút xóa xuất hiện trên thanh chọn dòng, theo cùng điều kiện vai trò của nút xóa từng dòng hiện hành. Có thể chọn nhiều trang hoặc tất cả kết quả lọc và bỏ chọn từng dòng. Trước khi xác nhận, hệ thống đọc lại toàn bộ tập kết quả và các phiên bản theo ID chính xác; không dùng bộ nhớ đệm hoặc tự thay thế bản ghi mất quyền/đã biến mất. Nếu số lượng, phiên bản, phạm vi làm việc hoặc dữ liệu thay đổi, toàn bộ bước chuẩn bị bị hủy và yêu cầu chọn lại.

Giữ nguyên phạm vi nghiệp vụ của thao tác từng dòng:

- **Kế hoạch:** chọn xóa phiên bản gần nhất hoặc toàn bộ các phiên bản của các kế hoạch đã chọn. Chặn phạm vi chứa kế hoạch còn gói thầu liên kết trực tiếp. Chọn dòng phiên bản cũ vẫn xác định đúng nhóm kế hoạch; hộp xác nhận ghi rõ phạm vi phiên bản sẽ xóa.
- **Hợp đồng:** chỉ khởi tạo từ phiên bản hiện tại; chọn xóa phiên bản gần nhất hoặc toàn bộ các phiên bản.
- **Gói thầu:** chỉ khởi tạo từ phiên bản hiện tại của kế hoạch hiện tại; xóa cả nhóm phiên bản qua các phiên bản kế hoạch, gồm thông tin mở thầu liên quan. Giữ cách nhận diện nhóm phiên bản cũ tách root hiện có; máy chủ tính lại tổng kế hoạch. Các quy tắc lưu trữ khi có tham chiếu, xóa dữ liệu phụ thuộc, audit và tombstone giữ nguyên.

Sau bước chọn phạm vi là hộp xác nhận cuối cùng, ghi tên các dòng đã chọn, số phiên bản và số dòng thông tin mở thầu bị ảnh hưởng. Hủy không gửi yêu cầu xóa. Giới hạn giao diện là 2.000 bản ghi mỗi đợt, tính cả phiên bản và thông tin mở thầu; giới hạn cấu hình máy chủ vẫn được áp dụng. Phạm vi vượt giới hạn bị chặn nguyên vẹn, không chia thành nhiều đợt tự động. Nếu chỉ phạm vi toàn bộ quá lớn thì vẫn có thể chọn phạm vi gần nhất hợp lệ.

Lệnh đã xác nhận được đóng băng và gửi trong **một giao dịch** `/api/sync`, kèm `expectedVersion` từng dòng và `expectedSyncVersion` của toàn bộ phần xem trước. Máy chủ kiểm tra phiên đồng bộ dưới khóa giao dịch; sai phiên hoặc một dòng không hợp lệ làm rollback cả đợt. Khóa này chỉ áp dụng khi có trường mới. Luồng đồng bộ cũ không truyền trường này giữ nguyên hành vi. Kiểm tra kết quả theo `clientMutationId` diễn ra trước kiểm tra phiên đồng bộ để thử lại lệnh đã thành công trả đúng kết quả cũ.

Không xóa khỏi dữ liệu cục bộ hoặc tạo outbox xóa trước khi máy chủ xác nhận. Thao tác yêu cầu trực tuyến và hoàn tất các thay đổi đang chờ đồng bộ trước đó. Khi không biết kết quả do lỗi kết nối, giữ cùng mã lệnh và nội dung trong phiên đang mở; nút **Kiểm tra kết quả xóa** vẫn hoạt động kể cả lựa chọn đã bị làm mới. Chỉ thử lại sau thao tác rõ ràng của người dùng hoặc lượt thử lại có giới hạn của cùng yêu cầu. Không dựng một lệnh khác từ danh sách mới để thay thế kết quả chưa xác định. Thay đổi đơn vị/tài khoản/vai trò hủy sử dụng phiên cũ. Sau xác nhận thành công, cập nhật dữ liệu cục bộ và tải lại danh sách; lỗi tải lại phải báo rõ dữ liệu đã xóa trên máy chủ, không báo rollback sai.

Tương thích: `/api/record?exactId=1` bổ sung truy vấn ID chính xác, giữ nguyên tất cả kiểm tra quyền và dữ liệu liên quan; truy vấn không truyền tham số mới giữ nguyên cơ chế tra cứu hiện hành. Không thay role, entitlement, assignment, record scope, dữ liệu được phép đọc, hoặc điều kiện xuất Word. Không có schema/migration dữ liệu. Khi triển khai cần cập nhật đồng thời máy chủ và giao diện; máy chủ cũ không nhận hợp đồng `expectedSyncVersion`. Có thể quay lại giao diện trước mà không cần chuyển đổi dữ liệu.

## Tương thích và quyền

Tham số `filters` bổ sung cho API phân trang hiện có. Mọi điều kiện được kiểm tra theo danh sách trường cố định, dùng tham số SQL và áp dụng trước COUNT/phân trang. API truy vấn cũ vẫn giữ nghĩa hiện hành. Bộ lọc trạng thái gói thầu mới dùng cùng phép tính trạng thái chính thức với dashboard và giao diện, bao gồm kết quả từng phần.

Không đổi role, module permission, entitlement, tenant isolation, assignment, record scope, masking hoặc nội dung được phép đọc. Không đổi điều kiện xuất Word. Không có schema/migration dữ liệu.

Các ID ô lọc cũ được giữ trong vùng ẩn để tương thích. Trạng thái và Hình thức lựa chọn cũ của Gói thầu được chuyển vào điều kiện mới khi mở danh sách. Trong cả ba danh sách, điều kiện cũ ngoài các trường/phép lọc được chấp thuận và các giá trị năm/tháng ẩn được xóa khi dựng danh sách, đồng thời về trang 1 và bỏ lựa chọn dòng để không còn điều kiện ngầm ảnh hưởng kết quả. Các điều kiện hợp lệ đã chọn được giữ lại. Bộ máy lọc và API vẫn hiểu truy vấn cũ; không thu hẹp hợp đồng API. Trạng thái danh sách gói thầu thông thường vẫn được lưu trong phiên làm việc; dữ liệu cũ thiếu `advancedFilters` vẫn khôi phục được và được dọn điều kiện cũ trước khi truy vấn, sau đó lưu lại trạng thái đã dọn. Không khôi phục chức năng lưu bộ lọc có tên. Lựa chọn dòng chỉ tồn tại trong bộ nhớ của từng danh sách/phạm vi làm việc.

Các danh mục liên quan dùng dữ liệu có quyền đọc và tra cứu phân trang có giới hạn. Dữ liệu đang chờ đồng bộ vẫn được đối chiếu bộ lọc khi ghép vào trang kết quả.

Với Hợp đồng, lựa chọn Chủ đầu tư, Nhà thầu, Kế hoạch và Gói thầu bao gồm các phiên bản mà API đã xác nhận được phép đọc trong `allVersions`, hiển thị số phiên bản để phân biệt và vẫn lọc theo ID chính xác. Không tự đổi điều kiện sang toàn bộ họ phiên bản. Người phụ trách được tải khi mở lựa chọn qua bộ tải nhân sự của đơn vị hiện hành; các ID đã được phân công trên hợp đồng có quyền đọc vẫn chọn được nếu không còn trong danh mục nhân sự. Kết quả tải muộn không được cập nhật bản nháp đã đóng, thay đổi hoặc chuyển đơn vị.

## Kiểm chứng

Các bộ test `business_list_filters`, `business_list_selection`, `business_list_pending_overlay`, `business_list_render_integration` và `test_list_filters` kiểm tra điều kiện nhiều trường, số tiền lớn, ngày Việt Nam, phân trang, truy vấn chọn tất cả, phiên bản lịch sử, cuộn ảo, hủy bản nháp và phạm vi truy cập. Kiểm thử trình duyệt xác nhận Kế hoạch có đúng hai trường, Hợp đồng có đúng bảy trường và Gói thầu có đúng mười trường; kiểm tra nhiều giá trị, hai đầu khoảng ngày, từ chối khoảng đảo ngược và loại bỏ điều kiện cũ ngoài phạm vi. Các test danh sách/đồng bộ hiện có được chạy tại các điểm tích hợp thay đổi. Bản dựng bảo mật kiểm tra Trusted Types và đóng gói tài nguyên.

Các test `business_list_bulk_delete_preparation`, `business_list_bulk_delete_service`, `business_list_bulk_delete_workflow`, `test_selected_row_batch_delete` và `test_sync_exact_record_lookup` kiểm tra tập xóa nhiều trang, các ngoại lệ bỏ chọn, phiên bản chính xác, điều kiện liên kết, rollback cả đợt, thử lại cùng mã lệnh, thay đổi đơn vị/quyền trong khi xác nhận, cập nhật sau xác nhận và tương thích API cũ. Kiểm thử backend dùng dữ liệu SQL cô lập, không truy cập/xóa dữ liệu thật. Chưa mô phỏng lịch cạnh tranh thực tế giữa các giao dịch trên PostgreSQL.
