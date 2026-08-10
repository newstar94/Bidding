# Quản lý nghiệp vụ đấu thầu

Ngữ cảnh này quản lý lịch sử nghiệp vụ từ kế hoạch lựa chọn nhà thầu đến gói thầu và hợp đồng, với khả năng xem lại chính xác trạng thái tại từng phiên bản.

## Language

**Dòng phiên bản**:
Một đối tượng nghiệp vụ xuyên suốt các lần thay đổi, trong đó mọi phiên bản cùng đại diện cho một kế hoạch, gói thầu hoặc hợp đồng.
_Avoid_: Bản ghi trùng, đối tượng mới

**Phiên bản mới nhất**:
Ảnh chụp hiện hành duy nhất của một dòng phiên bản và là nơi tiếp nhận thay đổi tiếp theo.
_Avoid_: Bản hiện tại tạm thời

**Phiên bản lịch sử**:
Ảnh chụp bất biến của đối tượng nghiệp vụ và dữ liệu liên quan tại thời điểm phiên bản kế tiếp được sinh ra.
_Avoid_: Bản cũ có thể cập nhật

**Snapshot kế hoạch**:
Toàn bộ trạng thái của kế hoạch và các snapshot gói thầu thuộc kế hoạch tại thời điểm tạo phiên bản kế hoạch.
_Avoid_: Chỉ dữ liệu của riêng hàng kế hoạch

**Snapshot gói thầu**:
Toàn bộ trạng thái của gói thầu và dữ liệu nghiệp vụ liên quan tại một phiên bản, bao gồm trạng thái tiến trình và kết quả đã có.
_Avoid_: Gói thầu rỗng, khởi tạo lại quy trình

**Kế thừa phiên bản**:
Việc tạo ảnh chụp mới từ toàn bộ trạng thái của phiên bản mới nhất mà không làm thay đổi ảnh chụp nguồn.
_Avoid_: Reset dữ liệu, sửa đè lịch sử

**Phiên bản nguồn**:
Một lần công bố hoặc thay đổi của đối tượng trên hệ thống nguồn ngoài, được nhận diện bằng mã dòng, số phiên bản nguồn và định danh revision của nguồn. `planVersion` và `notifyVersion` nguồn độc lập với cả phiên bản kế hoạch và phiên bản gói nội bộ của BiddingFlow.
_Avoid_: Đồng nhất `planVersion`, `notifyVersion` với phiên bản nội bộ

**Đối chiếu phiên bản nguồn**:
Việc so sánh một snapshot nguồn với binding đã lưu để phân loại đối tượng thành giữ nguyên, thay đổi, mới, bị loại hoặc mơ hồ trước khi áp dụng quy tắc phiên bản nội bộ.
_Avoid_: Ghép tự động bằng tên hoặc số thứ tự

**Thông báo liên kết**:
Thông báo trên Mua Sắm Công được nối từ một gói trong KHLCNT để bổ sung dữ liệu ở giai đoạn thông báo. Liên kết này là nguồn làm giàu dữ liệu, không thay thế định danh dòng gói thầu.
_Avoid_: Gói thầu mới, khóa duy nhất của gói

**Tài khoản ngừng hoạt động**:
Tài khoản được bảo toàn cùng toàn bộ lịch sử nhưng bị khóa đăng nhập, không được ghi mới và không xuất hiện trong danh sách tài khoản đang hoạt động.
_Avoid_: Tài khoản đã xóa, purge người dùng

**Tổ chức ngừng hoạt động**:
Tổ chức được bảo toàn cùng toàn bộ lịch sử nhưng bị khóa truy cập, không nhận ghi mới và không xuất hiện trong danh sách workspace đang hoạt động.
_Avoid_: Tổ chức đã xóa, decommission vật lý
