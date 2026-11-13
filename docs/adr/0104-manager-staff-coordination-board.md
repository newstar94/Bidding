# ADR 0104: Bảng điều phối nhân sự cho quản lý

- Ngày: 2026-11-14
- Trạng thái: Chủ sản phẩm chọn triển khai (2026-11-13). Hai điểm là mặc định đề xuất, chờ chủ sản phẩm xác nhận: gói giao cho nhiều người được tính cho từng người; gói Đã có kết quả và Hủy thầu không tính là việc đang xử lý.
- Phạm vi: `backend/sync/dashboard_summary.py` (`_staff_workload`), `views/tabs/tab_dashboard.html`, `frontend/app/DashboardView.js`, `DashboardView.css`, `frontend/admin/AdminUserController.js` (`viewEmployee`)

## Bối cảnh

Tổng quan của quản lý có cảnh báo toàn đơn vị nhưng không cho biết mỗi người đang phụ trách bao nhiêu việc, ai đang có nhiều cảnh báo, và gói nào chưa có người phụ trách.

## Quyết định

1. Bản tóm tắt Tổng quan (`build_dashboard_summary`) có thêm `staffWorkload` **chỉ khi người xem là quản lý của tổ chức** (vai trò đang hoạt động khác Nhân viên, cùng điều kiện `is_organization_manager` mà Tổng quan đang dùng). Với nhân viên, trường này là `null`.
2. Mỗi thành viên đang hoạt động một dòng (`thanh_vien_to_chuc` active, tài khoản active): tên nhân sự trong tổ chức, vai trò (Quản lý cao nhất / Quản lý / Chuyên viên) và:
   - **Gói đang xử lý**: gói thầu bản mới nhất, chưa lưu trữ, trạng thái hiệu lực khác Đã có kết quả và Hủy thầu. Chia cột Chuẩn bị, Mời thầu, Mở/đánh giá (Đã mở thầu, Đang chấm thầu, Đã có kết quả một phần).
   - **HĐ đang thực hiện**: hợp đồng bản mới nhất, chưa thanh lý, trạng thái "Đang thực hiện". Chỉ tính khi quản lý có quyền đọc Hợp đồng.
   - **Cảnh báo**: số cảnh báo của Tổng quan (ADR 0103 và 8 cảnh báo cũ) trên gói thầu, hợp đồng, kế hoạch mà người đó được phân công. Không bị giới hạn 8 dòng của danh sách "Việc cần xử lý".
   - **Hạn sớm nhất**: ngày hạn sớm nhất trong các cảnh báo đó.
3. Phân công lấy từ `phan_cong_nhan_su` trên đúng bản ghi hiện hành, như Tổng quan đang làm. Gói giao cho nhiều người được tính cho từng người.
4. Dòng **Chưa phân công**: gói đang xử lý không có thành viên đang hoạt động nào được phân công (kể cả gói chỉ còn phân công của người đã rời tổ chức), cùng cảnh báo trên các gói đó.
5. Sắp xếp: nhiều cảnh báo trước, rồi nhiều gói, nhiều hợp đồng, rồi tên. Thẻ ẩn khi không có dữ liệu máy chủ hoặc tổ chức có dưới 2 thành viên.
6. Bấm tên mở hộp "Chi tiết nhân sự" đã có (danh sách công việc được giao). `viewEmployee` tự tải danh sách nhân sự một lần nếu chưa có, thay vì mở hộp trống.

## Không thay đổi

Quản lý vốn đã đọc toàn bộ bản ghi và phân công của tổ chức (`can_read_record`, `filter_items_for_read`) và danh sách thành viên (`/api/auth/users`). Bảng chỉ tổng hợp số liệu từ dữ liệu đó, không trả thêm trường bản ghi nào. Không thêm role, capability, module permission, record/assignment scope hay entitlement; không đổi quyền phân công.

## Tương thích và triển khai

Không có migration. Phản hồi tóm tắt có thêm `staffWorkload`; client cũ bỏ qua. Tổng quan dựng từ dữ liệu cục bộ (không có bản tóm tắt máy chủ) không hiện thẻ. Cần build lại frontend. Rollback: bỏ trường và thẻ.

## Regression seams

`tests/test_staff_workload.py` (tách giai đoạn, nhiều người phụ trách, chưa phân công, hạn theo loại cảnh báo, không đếm trùng, sắp xếp, phạm vi tổ chức, không có quyền Hợp đồng), `tests/js/dashboard_staff_workload.test.mjs` (escape, mở chi tiết nhân sự, dòng chưa phân công).
