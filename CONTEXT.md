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
