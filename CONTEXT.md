# BiddingFlow

BiddingFlow là hệ thống điều hành hồ sơ lựa chọn nhà thầu và hợp đồng theo phạm vi từng tổ chức.

## Gói thầu

**Giá gói thầu**:
Giá trị dự toán của gói thầu; đối với gói thầu có phần lô, giá gói thầu bằng tổng giá trị của tất cả phần lô và không được nhập độc lập.
_Avoid_: Tổng giá dự thầu, giá trúng thầu

**Phần lô**:
Phạm vi độc lập thuộc một gói thầu mà nhà thầu có thể tham dự và được đánh giá riêng.
_Avoid_: Gói thầu con

## Hợp đồng

**Trạng thái hợp đồng**:
Nhãn thể hiện tình trạng hiện tại của hợp đồng; mỗi tổ chức tự cấu hình số lượng, tên và màu nhãn áp dụng cho các hợp đồng của mình.
_Avoid_: Trạng thái hồ sơ giấy, tình trạng giấy tờ

**Danh mục trạng thái hợp đồng**:
Tập trạng thái hợp đồng thuộc một tổ chức; trạng thái đang được hợp đồng sử dụng không được xóa.
_Avoid_: Danh mục hồ sơ giấy
