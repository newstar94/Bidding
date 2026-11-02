# ADR 0096: Thao tác hàng loạt trên dòng đã chọn

Ngày: 2026-11-02. Trạng thái: chủ sản phẩm đã chấp thuận, đã triển khai.

## Business contract đã duyệt

Chủ sản phẩm yêu cầu bổ sung các thao tác còn thiếu khi chọn nhiều dòng và chốt bốn quyết định:

1. Thanh chọn dòng của danh sách nghiệp vụ có thêm **Phân công phụ trách**, **Đổi trạng thái** (Hợp đồng) và **Xuất Word**.
2. Khi phân công hàng loạt, người dùng chọn **Thêm vào hiện có** (mặc định) hoặc **Thay thế toàn bộ** ngay trong hộp thoại.
3. Phạm vi chọn giống **Xóa dữ liệu đã chọn**: chọn tay nhiều trang hoặc **Chọn tất cả kết quả** theo bộ lọc, tối đa 2.000 bản ghi mỗi đợt.
4. Trang quản trị **Người dùng** và **Tổ chức** có **Khóa/Kích hoạt hàng loạt**.

Ngoài ra, sửa lỗi trang quản trị: lựa chọn cũ không bị xóa khi áp dụng bộ lọc hoặc tìm kiếm mới.

## Quyết định

### Nguyên tắc chung

Mỗi thao tác hàng loạt là phiên bản nhiều dòng của một thao tác từng dòng đang có. Hệ thống dùng cùng endpoint, cùng kiểm tra quyền phía máy chủ và cùng điều kiện hiển thị. Thao tác hàng loạt không cấp quyền mới, không mở rộng phạm vi đọc và không đổi masking. Lựa chọn dòng chỉ là đầu vào. Trước khi xác nhận, hệ thống đọc lại từng bản ghi theo ID chính xác (`/api/record?exactId=1`), khóa `syncVersion` và chỉ chấp nhận **phiên bản hiện tại**. Gói thầu còn phải thuộc phiên bản kế hoạch hiện tại. Nếu dòng đã chọn là phiên bản lịch sử, hoặc số lượng, phiên bản hay phiên dữ liệu thay đổi trong lúc chuẩn bị, cả đợt bị hủy.

### Phân công phụ trách (Gói thầu, Hợp đồng)

- Nút chỉ hiện khi vai trò đang hoạt động khác `employee`. Đây đúng là điều kiện bật ô "Chuyên viên phụ trách" trong form từng bản ghi.
- **Kế hoạch không có nút này.** Hiện không có ô phân công thủ công cho Kế hoạch (chỉ có tự gán khi chuyên viên tạo mới). Thêm nút này sẽ là một nghiệp vụ phân công mới, cần chủ sản phẩm xác nhận riêng.
- Phân công gắn vào đúng phiên bản hiện tại (`targetId` = ID phiên bản), giống khi lưu form.
- **Thêm vào hiện có:** chỉ thêm người chưa được phân công, không gỡ ai. **Thay thế toàn bộ:** thêm người được chọn và gỡ các phân công khác của cùng loại bản ghi đó. Phải chọn ít nhất một người.
- Toàn bộ thay đổi được gửi trong **một giao dịch** `/api/sync` gồm `assignments` (dòng mới) và `deletions` (bảng `assignments`, kèm `expectedVersion`) cùng `expectedSyncVersion`. Máy chủ kiểm tra quyền phân công từng dòng như hiện hành, ví dụ quản lý được bổ nhiệm không được giao việc cho quản lý ngang hàng. Một dòng bị từ chối thì rollback cả đợt.
- Danh sách phân công hiện có được đọc lại từ máy chủ (`/api/paginate?table=assignments`, con trỏ), không dùng bộ nhớ đệm.

### Đổi trạng thái hợp đồng

- Chỉ áp dụng cho Hợp đồng. Trạng thái gói thầu do vòng đời mở thầu, chấm thầu và kết quả quyết định nên không đổi tay hàng loạt.
- Nút hiện với mọi vai trò, giống nút Sửa từng dòng. Máy chủ kiểm tra quyền sửa phân hệ, phân công và phạm vi bản ghi trên từng dòng; một dòng không hợp lệ hủy cả đợt.
- Danh sách trạng thái lấy từ danh mục trạng thái hợp đồng của tổ chức.
- Trạng thái được **ghi đè vào phiên bản hiện tại** và **không tạo phiên bản mới**. Form từng dòng cho chọn giữa ghi đè và tạo phiên bản mới; tạo hàng loạt phiên bản mới sẽ buộc phải sao chép phân công theo từng phiên bản, nên không làm.
- Hệ thống gửi lại đầy đủ bản ghi chuẩn, gồm `goiThauIds`, và chỉ đổi `trangThaiHopDong`/`updatedAt` kèm `expectedVersion`. Nếu bản đọc chuẩn thiếu `goiThauIds`, thao tác bị chặn để không xóa liên kết gói thầu.
- Bản ghi đã ở trạng thái đích được bỏ qua.

### Xuất Word hàng loạt

- Chỉ bật khi workspace có `wordExportEnabled`. Quyền đọc và quyền xuất Word được kiểm tra lại ở endpoint tạo tác vụ của **từng** bản ghi, như khi xuất từng bản. Entitlement xuất Word chỉ kiểm soát việc tạo/tải tài liệu và không ảnh hưởng dữ liệu hiển thị.
- **Kế hoạch:** văn bản "Kế hoạch lựa chọn nhà thầu" (`/api/document-jobs/plan/{id}`), dùng mọi biểu mẫu đã gán và mọi căn cứ lập kế hoạch. Mặc định này giống hộp chọn từng bản ghi.
- **Gói thầu:** người dùng chọn một loại văn bản phạm vi gói thầu. Gói không áp dụng loại đó được liệt kê và bỏ qua.
- **Hợp đồng:** giống nút "Xuất hợp đồng" từng dòng (`package-report/{goiThauIds[0]}?type=contract`). Hợp đồng chưa liên kết gói thầu được bỏ qua, vì ở danh sách từng dòng cũng không có nút xuất cho chúng.
- Các tác vụ chạy lần lượt và gộp thành **một tệp ZIP** do trình duyệt tạo (phương thức STORE). Dòng không xuất được không chặn các dòng khác; lý do được ghi trong `Ket_qua_xuat_Word.txt` trong ZIP. Thao tác chỉ đọc nên cho phép kết quả từng phần.
- Nếu phiên dữ liệu thay đổi giữa chừng (`EXPORT_SNAPSHOT_STALE/CHANGED`), hệ thống lấy `syncVersion` mới và thử lại dòng đó tối đa 2 lần.
- Lớp phủ tiến trình có nút **"Dừng sau tài liệu hiện tại"**. Các tài liệu đã tạo vẫn được tải xuống.
- Không có thay đổi về entitlement, credit hay quota: mỗi tài liệu đi qua đúng endpoint và audit `document.export_job_created` như xuất từng bản.

### Khóa/kích hoạt hàng loạt ở trang quản trị

- **Người dùng:** "Ngừng hoạt động" gọi `DELETE /api/auth/users/{id}`, giữ nguyên các chặn hiện hành (không tự khóa mình, không khóa Super Admin hoặc Quản lý hoạt động cuối cùng). "Kích hoạt lại" dùng endpoint mới `POST /api/auth/users/{id}/reactivate`, là thao tác đảo ngược của ngừng hoạt động:
  - chỉ Super Admin, kiểm tra lại quyền trong giao dịch, bắt buộc đã xác thực lại mật khẩu gần đây;
  - `inactive → active`, idempotent (`changed: false` nếu tài khoản đang hoạt động);
  - ghi audit bắt buộc `admin.user_reactivated`;
  - phiên đăng nhập đã thu hồi vẫn bị thu hồi. Membership, phân công và quyền vốn được giữ nguyên khi ngừng hoạt động nên tự có hiệu lực lại; hạn mức thành viên không đổi vì đếm theo membership.
- **Tổ chức:** "Khóa/Mở khóa đăng ký" gọi `POST /api/organizations/subscription` với `lock|unlock`, mỗi tổ chức một `Idempotency-Key`. Các chặn hiện hành vẫn áp dụng, ví dụ gói hết hạn phải gia hạn trước khi mở khóa.
- Mỗi dòng là một giao dịch riêng của endpoint từng dòng, nên kết quả có thể là từng phần. Lần xác thực lại mật khẩu được dùng chung trong thời hạn TTL. Nếu người dùng hủy xác thực lại, phần còn lại dừng. Kết quả (thành công, không đổi, lỗi từng dòng) hiển thị ngay dưới thanh chọn.
- Lựa chọn được giữ khi chuyển trang và sắp xếp, nhưng bị xóa khi áp dụng bộ lọc hoặc tìm kiếm mới và sau khi chạy thao tác hàng loạt.

## Compatibility impact

- API: thêm `POST /api/auth/users/{user_id}/reactivate`. Các endpoint khác giữ nguyên hợp đồng. `/api/sync` dùng hợp đồng `expectedSyncVersion` đã có từ ADR 2026-10-02.
- Quyền: không thêm, bỏ hay đổi role, module permission, assignment scope, record scope, entitlement hay masking. Super Admin vốn đã có quyền ngừng hoạt động tài khoản. Kích hoạt lại là thao tác đảo ngược của cùng quyền đó, cùng yêu cầu xác thực lại.
- Giao diện: thanh chọn dòng có thêm nút. Nút "Bỏ chọn" vẫn nằm cuối. Khi có một lần xóa chưa xác định kết quả, các nút mới bị ẩn.
- Không có schema hay migration dữ liệu. Có thể rollback bằng cách triển khai lại giao diện và máy chủ trước đó mà không cần chuyển đổi dữ liệu. Tài khoản đã được kích hoạt lại vẫn ở trạng thái `active`, là trạng thái hợp lệ trước đây.

## Regression seams

- `tests/js/business_list_bulk_targets.test.mjs`: phiên bản hiện tại, kế hoạch hiện tại, chọn tất cả qua nhiều trang, loại trừ, thay đổi số lượng/phiên bản/`syncVersion`, giới hạn 2.000.
- `tests/js/business_list_bulk_update_service.test.mjs`: một giao dịch, chỉ chiếu cục bộ trường đã đổi sau ACK, phân công thêm/gỡ trong cùng đợt, thử lại gửi đúng nội dung cũ, từ chối lệnh không hợp lệ hoặc sai loại phiên.
- `tests/js/business_list_bulk_actions.test.mjs`: chế độ thêm/thay thế, giữ `goiThauIds`, endpoint xuất Word khớp với từng dòng, thử lại khi `EXPORT_SNAPSHOT_STALE`, lỗi từng dòng, ZIP và báo cáo, dừng giữa chừng, chặn khi thiếu entitlement.
- `tests/js/business_list_bulk_actions_browser.test.mjs`: nút theo loại danh sách và vai trò, đổi trạng thái và phân công đầu-cuối tới một `/api/sync`.
- `tests/js/admin_platform_directory.test.mjs`: nút hàng loạt, xác thực lại dùng chung, tiếp tục khi một dòng lỗi, dừng khi hủy xác thực, một khóa idempotency mỗi tổ chức.
- `tests/test_admin_user_reactivation.py`: chỉ đổi `inactive → active`, audit bắt buộc, idempotent, 404, quyền bị thu hồi trong giao dịch.
- `tests/js/zip_store.test.mjs`: CRC, tên UTF-8, nội dung chính xác, tên tệp duy nhất.
