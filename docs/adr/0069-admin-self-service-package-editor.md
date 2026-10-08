# ADR 0069 — Admin tạo gói và quản lý bảng giá trực quan

- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm ngày 2026-10-06.
- Phạm vi: tạo, cấu hình và xem trước gói trong admin; xử lý khởi tạo khi chưa có release.
- Cập nhật ngày 2026-10-08: quy tắc nhập giá tháng/năm độc lập được thay thế trong trình cấu hình bởi ADR 0076 — giá tháng làm gốc, giá năm bằng giá tháng × 10; snapshot lịch sử giữ nguyên.

## Business contract

1. Giữ khung hiện hành: Cơ bản/Nâng cao (`internal`/`connected`), Cá nhân và ba mức Bạc/Vàng/Kim cương cho Tổ chức. Mỗi nhóm/mức có một offer theo năm và tối đa một offer theo tháng. Không mở thêm tier, role, capability hoặc quyền đọc.
2. Admin tạo gói mới hoặc bộ 8 gói mẫu trong bản nháp. Giá, thuế, quota tổ chức/kết nối chưa nhập là `null`; không suy giá tháng từ giá năm, không tự mở bán. Cá nhân có một thành viên và Cơ bản có quota kèm theo bằng 0. Quyền mua lượt riêng của thuê bao hiện hữu giữ contract ADR 0064.
3. Mapping quyền xuất chưa rõ được giữ `null`. Admin xác nhận thao tác cấu hình mapping rồi chọn các capability xuất hiện hữu. Việc chọn áp dụng vào bản nháp, không sửa quyền đọc hoặc quyền của đơn đã mua.
4. Bản nháp cho phép lưu thông tin chưa hoàn tất. Kiểm tra/publish tiếp tục dùng validator toàn tài liệu: đủ 8 offer năm, giá/thuế/tổng/quota hợp lệ, kỳ hạn, chính sách và external readiness đã xác nhận. Không bỏ qua validation digest, revision, tái xác thực, audit hoặc lịch sử bất biến.
5. Bảng và thẻ dùng cùng dữ liệu. Tháng/năm nằm giữa thẻ, lựa chọn từng thẻ độc lập. Giá chưa cấu hình không được trình bày như 0 đồng. Máy chủ xác nhận lưu trước khi thông báo thành công; thất bại giữ nội dung chưa lưu và chặn phát hành.
6. Calculator VAT là thao tác rõ ràng của admin, làm tròn đến VND bằng integer arithmetic. Snapshot vẫn lưu subtotal/tax/total, không tự sửa thuế/hóa đơn toàn hệ thống.

## Compatibility impact

- Admin overview hoạt động độc lập với public catalog. Thiếu release hoặc lỗi catalog không che thao tác quản lý draft; lỗi xác thực/quyền vẫn giữ trạng thái từ chối.
- POST draft giữ hành vi mặc định sao chép nguồn có thẩm quyền. `templateMode=empty` hoặc `blank_templates` tạo bản mới, bảo toàn policy/provider/readiness/credit packs nguồn. Nếu mất seed, khởi tạo từ schema hiện hữu với dữ liệu offer chưa cấu hình.
- Thêm/chỉnh gói không ghi trực tiếp projection, release, đơn, thuê bao hoặc ledger. Tên hiển thị được sửa, danh tính/SKU offer hiện có giữ nguyên.
- Không thay đổi masking, dữ liệu đọc, tenant/module/assignment/record scope hoặc quyền mua.

## Migration strategy

Không migration DB. Lưu/revision/validate/publish dùng API hiện hành. Backend mới nên triển khai trước frontend để hỗ trợ hai cách khởi tạo. Rollback giao diện không làm mất draft, release hoặc đơn; quay lui bảng giá bằng phát hành phiên bản mới.

## Regression seams

- Chưa có release/seed: tạo draft trống/mẫu, audit bắt buộc, rollback khi audit thất bại, session Super Admin.
- Giá năm/tháng độc lập, cấm trùng nhóm/mức/kỳ, nhân bản giữ gói nguồn và trường không có biểu mẫu.
- Lưu nháp thiếu giá/quota/mapping; validator chặn phát hành; policy chưa chốt và unknown fields giữ nguyên.
- VAT nguyên VND, preview không giá 0 giả, input không đáng tin được escape.
- Dirty guard, save failure, mở draft đua nhau, đổi thẻ/kỳ không làm mất nội dung; revision/digest và snapshot đã mua không đổi.

## Khắc phục xác nhận xuất bản — 2026-10-08

Hộp xác nhận từng chấp nhận lý do 1–2 ký tự trong khi API hiện hành yêu cầu ít nhất 3 ký tự sau khi bỏ khoảng trắng đầu/cuối. Giao diện nay kiểm tra ngay trong hộp xác nhận, giữ nội dung khi không hợp lệ và chỉ gửi yêu cầu khi đạt điều kiện. Nút xuất bản yêu cầu mã kiểm tra dài 64 ký tự như API. Máy chủ thông báo riêng lỗi lý do và lỗi mã kiểm tra.

Không thay đổi quy tắc xuất bản, mã lỗi/status HTTP, quyền quản trị, revision, thời hạn kiểm tra, tái xác thực, audit hoặc release đã mua; không migration dữ liệu. Regression nằm trong `admin_desktop_interactions.test.mjs`, `admin_platform_plans.test.mjs` và `test_commercial_admin_drafts.py`, gồm lý do ngắn/có khoảng trắng, sửa rồi xuất bản một lần, mã kiểm tra sai độ dài và giữ tham số cho writer hiện hữu.

## Đồng bộ thẻ gói công khai với Admin — 2026-10-08

Theo yêu cầu chủ sản phẩm, landing và cửa hàng trình bày cùng thứ tự với thẻ xem trước Admin: tên, nhóm/mã gói, nhãn đề xuất, kỳ tháng/năm căn giữa, giá sau VAT căn giữa, mô tả và đầy đủ quyền lợi. Nội dung giới thiệu thêm không thay thế hạn mức hoặc quyền xuất tài liệu. Mô hình `commercialOfferDetails` dùng chung cho thẻ xem trước đầy đủ và thẻ công khai, hiển thị cả trạng thái Có/Không của các quyền xuất hiện hữu; Cơ bản giữ thông tin không lấy dữ liệu Mua Sắm Công.

Đây là thay đổi trình bày đã được yêu cầu, không cấp/thu hồi quyền hoặc đổi quota, giá, SKU, lựa chọn kỳ, checkout, snapshot đã mua hay bộ lọc các offer công khai. Trang công khai tiếp tục đọc release đã phát hành; chỉnh bản nháp chưa phát hành không làm đổi bảng giá. Không migration dữ liệu. Regression kiểm tra quyền lợi đầy đủ khi có nội dung giới thiệu, thứ tự/căn giữa trên desktop và luồng chọn kỳ/mua gói tại `public_commercial_catalog.test.mjs`, `landing_dynamic_packages.test.mjs`, `commercial_storefront.test.mjs` và `admin_service_packages.test.mjs`.
