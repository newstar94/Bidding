# BiddingFlow

BiddingFlow quản lý gói thầu, đánh giá hồ sơ dự thầu, hợp đồng và tài liệu liên quan trong một không gian làm việc đấu thầu thống nhất.

## Hợp đồng

**Trạng thái hợp đồng**:
Trạng thái vòng đời hiện tại của hợp đồng và là trạng thái duy nhất cần quản lý cho hợp đồng.
_Avoid_: Trạng thái hồ sơ giấy

**Liên kết hợp đồng–gói thầu**:
Quan hệ cho biết một hợp đồng có liên quan đến gói thầu nào; quan hệ này không khẳng định nhà thầu hợp đồng là nhà thầu trúng thầu.
_Avoid_: Liên kết hợp đồng–kết quả trúng thầu

## Đánh giá hồ sơ dự thầu

**Báo cáo đánh giá chi tiết**:
Kết quả đánh giá từng tiêu chí của một hồ sơ dự thầu; báo cáo không cần gắn với danh tính một người chấm cụ thể.
_Avoid_: Phiếu chấm cá nhân

**Đối chiếu nhà thầu khi nhập Excel**:
Kiểm tra mang tính cảnh báo giữa nhà thầu trong file và nhà thầu đang chọn; người dùng có quyền tiếp tục nhập sau khi nhận cảnh báo.
_Avoid_: Khóa nhập vì sai tên nhà thầu

## Tài liệu

**Tác vụ tài liệu lỗi**:
Tác vụ tạo hoặc xử lý tài liệu không thành công, được giữ lại để tra cứu nguyên nhân và chạy lại.
_Avoid_: Tác vụ đã xóa
