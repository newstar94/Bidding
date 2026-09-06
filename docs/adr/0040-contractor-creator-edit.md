# ADR 0040 — Chuyên viên sửa Nhà thầu do mình tạo

Chấp nhận theo xác nhận chủ sản phẩm ngày 2026-09-06.

Chuyên viên có quyền xem phân hệ Nhà thầu được sửa Nhà thầu do mình tạo,
bao gồm tải/thay/xóa ảnh dấu. Bằng chứng người tạo là sự kiện server audit
`sync.record_created` của bản ghi gốc trong cùng organization; không tin
`createdBy` hoặc `canEdit` từ payload ghi. Phiên bản sau dùng cùng gốc.
Quyền sửa phân hệ đã cấp vẫn giữ nguyên cho dữ liệu khác. Không thay đổi
phạm vi đọc dùng chung, quyền chuyên gia, Kế hoạch/Gói thầu/Hợp đồng.

Frontend dùng `canEdit` do máy chủ trả để mở phần ảnh dấu. Backend tính lại
quyền ở cả đường ghi đơn lẻ và batch, vẫn kiểm tra module view, membership,
tenant, historical immutability, row-version và xử lý ảnh.

Không cần schema migration hoặc backfill: dùng audit hiện có. Nếu dữ liệu cũ
không còn bằng chứng tạo, không suy đoán người tạo; quyền sửa phân hệ hiện
hành tiếp tục áp dụng. Rollback code thu hồi ngoại lệ creator, không xóa ảnh.

Kiểm thử: `test_contractor_creator_edit.py`, `contractor_stamp_policy.test.mjs`.
