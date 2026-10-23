# ADR 0094: Tạo tổ chức ngay, xác minh mã số thuế sau

- Ngày: 2026-10-22
- Trạng thái: Chủ sản phẩm chấp thuận bước 1 (2026-10-22)
- Thay thế: quy tắc "mỗi mã số thuế chỉ thuộc một tổ chức, ai đăng ký trước giữ"

## Bối cảnh

Trước đây `to_chuc.ma_so_thue` là duy nhất trên toàn hệ thống, không kiểm tra định dạng. Bất kỳ tài khoản nào cũng có thể tạo tổ chức với mã số thuế (MST) của doanh nghiệp khác. Doanh nghiệp thật khi đó bị chặn bằng `409 ORGANIZATION_TAX_CODE_EXISTS` và không có cách lấy lại. Thông báo này cũng cho biết một MST đã có người dùng BiddingFlow.

## Quyết định

1. **Tạo tổ chức không bị chặn vì trùng MST.** MST được chuẩn hóa (bỏ khoảng trắng, dấu chấm, gạch dưới; 13 chữ số viết thành `XXXXXXXXXX-XXX`) và phải khớp định dạng app đang dùng cho MST (`9–14` chữ số hoặc `10 chữ số-3 chữ số`). Không kiểm tra chữ số kiểm tra, để không từ chối nhầm MST thật. Tổ chức mới luôn ở trạng thái `unverified` và dùng được ngay, đầy đủ như trước.
2. **Chỉ tổ chức đã xác minh mới giữ MST độc quyền.** Ràng buộc duy nhất ở database chỉ áp dụng cho `tax_code_status = 'verified'`. Khi tạo tổ chức với MST đã có tổ chức khác xác minh, phản hồi có `taxCodeClaimedByVerifiedOrganization: true`. Giao diện chỉ nhắc nhẹ và chỉ đường gửi hồ sơ xác minh.
3. **Giới hạn tạo tổ chức:** tối đa `ORGANIZATION_CREATE_PER_DAY` (mặc định 3) tổ chức mỗi tài khoản trong 24 giờ. Chỉ tính lần tạo thành công; bỏ qua lần phát lại cùng `Idempotency-Key`. Quản trị nền tảng không bị giới hạn.
4. **Xác minh bằng giấy tờ:** quản lý tổ chức gửi một tệp PDF/JPG/PNG tối đa 10 MB, ví dụ giấy chứng nhận đăng ký doanh nghiệp hoặc quyết định thành lập, kèm ghi chú. Mỗi tổ chức có tối đa một yêu cầu đang chờ và gửi tối đa 5 yêu cầu/ngày. Quản lý có thể hủy yêu cầu đang chờ. Tệp lưu riêng tư dưới `IMAGE_DIR/organization-verification`, chỉ quản trị nền tảng mở được.
5. **Duyệt bởi quản trị nền tảng** (cần xác thực lại mật khẩu như các thao tác ghi khác). Duyệt sẽ đặt tổ chức thành `verified` với phương thức `document`. Nếu MST đang thuộc một tổ chức đã xác minh khác, việc duyệt trả `409` cho tới khi quản trị viên xác nhận `replaceExisting`. Khi đó tổ chức cũ trở về `unverified`. Từ chối bắt buộc có lý do, quản lý xem được lý do đó. Mọi bước đều ghi audit.
6. **Xác minh chỉ cấp huy hiệu và quyền giữ MST.** Huy hiệu "Đã xác minh" hiển thị ở bộ chọn tổ chức và trong lời mời tham gia tổ chức (ADR 0093). Xác minh không mở hay khóa module, quyền, phạm vi dữ liệu, gói dịch vụ hay entitlement nào.

## Không thay đổi

Quyền đọc bản ghi, module permission, assignment/record scope, vai trò thành viên, gói dịch vụ và entitlement của mọi tổ chức (đã hoặc chưa xác minh) đều giữ nguyên. Người tạo tổ chức vẫn trở thành quản lý của tổ chức đó.

## Tương thích và chuyển đổi

- Schema v103:
  - Thêm vào `to_chuc` các cột `tax_code_status`, `tax_code_verified_at`, `tax_code_verified_by`, `tax_code_verification_method`.
  - Mọi tổ chức đang có được đánh dấu `verified` với phương thức `legacy`, nên không ai bị đổi nhãn.
  - Thay `uq_to_chuc_ma_so_thue` bằng `uq_to_chuc_verified_tax_code`, chỉ áp dụng cho bản ghi đã xác minh. Thêm chỉ mục tra cứu `idx_to_chuc_tax_code`.
  - Thêm bảng `organization_verification_requests`.
- MST đã lưu từ trước không bị chuẩn hóa lại.
- Code cũ vẫn chạy được trên database v103: nó tự chặn trùng MST bằng truy vấn kiểm tra riêng.
- `DB_RUNTIME_MIN_SCHEMA_VERSION` = 103: chạy `scripts/manage_database.py` trước khi khởi động bản mới.
- Rollback: khôi phục bản trước. Các cột và bảng mới không được bản cũ dùng tới. Nếu đã có hai tổ chức chưa xác minh trùng MST, chỉ mục duy nhất cũ không tạo lại được, nên bản cũ phải chấp nhận tình trạng đó.

## Regression seams

`tests/test_organization_tax_code_verification_postgres.py`, `tests/test_postgres_migration_chain.py` (v103), `tests/js/organization_creation.test.mjs`, `tests/js/organization_verification.test.mjs`, `tests/js/admin_platform_router.test.mjs`.

## Ngoài phạm vi bước 1

Tự động xác minh khi thanh toán bằng tài khoản ngân hàng đứng tên doanh nghiệp và xác minh bằng chữ ký số doanh nghiệp.
