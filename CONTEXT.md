# BiddingFlow

BiddingFlow là hệ thống điều hành hồ sơ lựa chọn nhà thầu và hợp đồng theo phạm vi từng tổ chức.

## Gói thầu

**Giá gói thầu**:
Giá trị dự toán của gói thầu; đối với gói thầu có phần lô, giá gói thầu bằng tổng giá trị của tất cả phần lô và không được nhập độc lập.
_Avoid_: Tổng giá dự thầu, giá trúng thầu

**Phần lô**:
Phạm vi độc lập thuộc một gói thầu mà nhà thầu có thể tham dự và được đánh giá riêng.
_Avoid_: Gói thầu con

**Đợt đánh giá**:
Một lần đánh giá chính thức và ra kết quả LCNT cho một tập phần lô chưa được xử lý của cùng gói thầu; các đợt được đánh số theo thứ tự phát sinh.
_Avoid_: Bản nháp đánh giá, lần lưu tạm

**Phần lô chưa đánh giá**:
Phần lô chưa thuộc bất kỳ đợt đánh giá chính thức nào và còn có thể được chọn cho đợt tiếp theo.
_Avoid_: Phần lô đang nháp

**Đã có kết quả một phần**:
Trạng thái của gói thầu nhiều phần lô khi ít nhất một phần lô đã có kết quả LCNT chính thức nhưng vẫn còn phần lô chưa có kết quả chính thức.
_Avoid_: Đang chấm thầu, Đã có kết quả

## Hợp đồng

**Trạng thái hợp đồng**:
Nhãn thể hiện tình trạng hiện tại của hợp đồng; mỗi tổ chức tự cấu hình số lượng, tên và màu nhãn áp dụng cho các hợp đồng của mình.
_Avoid_: Trạng thái hồ sơ giấy, tình trạng giấy tờ

**Danh mục trạng thái hợp đồng**:
Tập trạng thái hợp đồng thuộc một tổ chức; trạng thái đang được hợp đồng sử dụng không được xóa.
_Avoid_: Danh mục hồ sơ giấy
