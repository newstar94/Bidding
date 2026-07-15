# Danh mục enum và trạng thái

Database chỉ lưu mã ổn định cho trạng thái vòng đời cố định. API/frontend nhận nhãn tiếng Việt từ `backend/shared/domain_enums.py` qua domain contract.

## Gói thầu

| Mã DB | Nhãn API |
|---|---|
| `PREPARING` | Chuẩn bị |
| `INVITED` | Đang mời thầu |
| `OPENED` | Đã mở thầu |
| `EVALUATING` | Đang chấm thầu |
| `AWARDED` | Đã có kết quả |
| `CANCELLED` | Hủy thầu |

## Hợp đồng

`NOT_EFFECTIVE`, `ACTIVE`, `SUSPENDED`, `COMPLETED`, `LIQUIDATED`, `CANCELLED` lần lượt ánh xạ sang Chưa hiệu lực, Đang thực hiện, Tạm dừng, Đã hoàn thành, Đã thanh lý, Đã hủy.

## Các enum cố định khác

- Tài khoản: `super_admin`, `user`; trạng thái `active`, `inactive`.
- Workspace/membership: `organization`, `personal`; `owner`, `manager`, `employee`.
- Công việc kế hoạch: `da_thuc_hien`, `khong_ap_dung`, `chua_du_dieu_kien`.
- Vòng đánh giá: `single`, `technical`, `financial`; trạng thái `draft`, `completed`, `approved`.
- Subscription: `active`, `suspended`, `expired`, `cancelled`.
- Loại phân công: `kehoach`, `goithau`, `hopdong`.
- Vai trò liên danh hiện vẫn là nhãn pháp lý “Đứng đầu liên danh”/“Thành viên liên danh”; schema có `CHECK` và serializer không dùng nhãn này làm khóa định danh.

Kế hoạch không có trạng thái vòng đời riêng trong baseline; tiến độ được suy ra từ các gói thuộc kế hoạch. Trạng thái hồ sơ giấy là danh mục do workspace quản trị: khóa ổn định là ID, tên tiếng Việt chỉ là nhãn có thể sửa. Kết quả đánh giá dùng các bảng chuẩn hóa và mã trạng thái vòng đánh giá nêu trên.

