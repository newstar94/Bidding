# Hướng dẫn sử dụng BiddingFlow

## Không gian làm việc và quyền truy cập

BiddingFlow luôn thao tác trong không gian làm việc đang chọn ở phần đầu ứng dụng. Dữ liệu, lịch sử trợ lý và quyền xem hoặc chỉnh sửa được giới hạn theo không gian làm việc hiện tại. Nếu không thấy một chức năng hoặc bản ghi, hãy kiểm tra lại không gian làm việc và quyền được người quản lý cấp. Không đổi không gian làm việc khi đang nhập dở biểu mẫu.

## Tổng quan

Mở mục Tổng quan tại đường dẫn `/tong-quan` để xem các chỉ số, công việc và dữ liệu mới cập nhật theo quyền hiện tại. Chọn một dòng hoặc liên kết chi tiết để mở đối tượng nghiệp vụ tương ứng.

## Kế hoạch lựa chọn nhà thầu

Mở mục Kế hoạch lựa chọn nhà thầu tại `/ke-hoach`. Để tạo kế hoạch, chọn Thêm mới hoặc mở `/ke-hoach/tao-moi`, nhập các trường bắt buộc rồi lưu. Mở một kế hoạch để xem chi tiết tại `/ke-hoach-chi-tiet`. BiddingFlow lưu lịch sử theo dòng phiên bản; phiên bản lịch sử là ảnh chụp bất biến và chỉ phiên bản mới nhất nhận thay đổi tiếp theo.

## Danh sách và tạo gói thầu

Mở mục Gói thầu tại `/goi-thau`. Để tạo gói thầu, chọn Thêm mới hoặc mở `/goi-thau/tao-moi`, chọn kế hoạch liên quan, nhập thông tin bắt buộc và chuyên viên phụ trách rồi lưu. Nếu biểu mẫu báo thiếu dữ liệu, hoàn thiện trường được đánh dấu trước khi lưu lại. Việc xem hoặc sửa gói thầu phụ thuộc quyền Gói thầu trong không gian làm việc hiện tại.

## Chi tiết và quy trình gói thầu

Từ danh sách Gói thầu, chọn nút xem để mở `/goi-thau-chi-tiet`. Màn hình chi tiết tập hợp thông số gói thầu và các bước nghiệp vụ. Timeline tổng hợp có tại `/timeline-goi-thau`. Trạng thái và dữ liệu ở từng bước quyết định phần tiếp theo được phép hiển thị; ứng dụng không tự bỏ qua điều kiện nghiệp vụ chưa hoàn thành.

## Mở thầu và đánh giá hồ sơ dự thầu

Mở mục Mở thầu tại `/mothau` để nhập thông tin E-HSDT hoặc E-HSĐXKT cho gói thầu phù hợp. Mở mục Đánh giá hồ sơ dự thầu tại `/danh-gia-hsdt` để làm việc với các vòng và tiêu chí đánh giá. Phải chọn đúng gói thầu, phần lô và vòng đánh giá trước khi nhập hoặc nhập khẩu dữ liệu. Các nút chuyển bước chỉ xuất hiện khi trạng thái nghiệp vụ và quyền hiện tại cho phép.

## Hợp đồng

Mở danh sách Hợp đồng tại `/hop-dong`. Chọn Thêm mới để tạo hợp đồng từ các gói thầu và nhà thầu liên quan; mở một dòng để xem `/hop-dong-chi-tiet`. Trạng thái hợp đồng tùy chỉnh do người quản lý cấu hình. Giá trị, ngày ký và ngày thanh lý là các trường nghiệp vụ riêng, không thay thế lẫn nhau.

## Danh mục Chủ đầu tư, Nhà thầu và Chuyên gia

Mở Chủ đầu tư tại `/chu-dau-tu`, Nhà thầu tại `/nha-thau` và Tổ Chuyên gia tại `/chuyen-gia`. Chọn Thêm mới để tạo bản ghi khi có quyền chỉnh sửa. Từ danh sách có thể mở màn hình chi tiết của Chủ đầu tư hoặc Nhà thầu để xem các đối tượng liên quan.

## Biểu mẫu và từ điển

Mở `/bieu-mau` để quản lý biểu mẫu Word và từ điển biến theo quyền. Khi xuất tài liệu, BiddingFlow dùng dữ liệu của đúng gói thầu, kế hoạch hoặc hợp đồng đang chọn. Hãy kiểm tra đối tượng và phiên bản trước khi tạo tệp.

## Trợ lý AI BiddingFlow

Nút Trợ lý AI mở bảng hỏi đáp mà không thay đổi dữ liệu. Chế độ Dữ liệu BiddingFlow dùng các công cụ chỉ đọc có kiểm tra quyền. Chế độ Tư vấn đấu thầu chỉ trả lời khi kho tài liệu có nguồn đã duyệt. Chế độ Hướng dẫn ứng dụng dùng tài liệu hướng dẫn và route thực tế. Mỗi lịch sử trò chuyện được tách theo người dùng, không gian làm việc và chế độ.
