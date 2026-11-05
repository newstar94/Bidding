# ADR 0098 — Trình quản lý gói gọn hơn và bảng giá phân cấp hình thức

- Ngày: 2026-11-04.
- Trạng thái: Đã triển khai theo yêu cầu chủ sản phẩm (đơn giản hóa quản lý gói và làm đẹp bảng giá). Chủ sản phẩm quyết định giữ hai tab Cơ bản/Nâng cao và chữ nút mua **Mua gói** (2026-11-05); phần giao diện còn lại chờ xác nhận trước khi commit.
- Phạm vi: chỉ trình bày trong Admin `/admin/plans` và khu vực bảng giá landing. Bổ sung cho ADR 0064, 0069, 0078, 0083 và 0085.

## Business contract

### Admin — quản lý gói

Luồng ADR 0085 giữ nguyên: tạo hoặc chỉnh sửa gói → chọn chế độ phát hành và trạng thái bán → **Lưu** (lưu, kiểm tra và áp dụng nguyên tử). Giao diện được rút gọn:

1. Đầu danh sách gói có thanh **Đang áp dụng**: chế độ phát hành bằng tiếng Việt, phiên bản, ngày hiệu lực, số kỳ đang mở bán, bảng giá đã/chưa hiển thị trên trang chủ và ô **Chế độ phát hành** (đổi lựa chọn vẫn chỉ mở bản nháp như ADR 0083).
2. Bảng gói có chip màu theo mức (Cá nhân/Bạc/Vàng/Kim cương), nhãn "Đề xuất" và "Ẩn khỏi bảng giá", trạng thái bán từng kỳ có chấm màu.
3. Trình chỉnh sửa hiển thị bốn phần liền nhau trong một trang. Nút 1–4 chỉ nhảy tới phần tương ứng, không ẩn phần khác. Các ô chỉ-đọc nhóm/mức/đối tượng/kỳ/mã/tiền tệ được thay bằng dòng thông tin; các giá trị này vẫn không chỉnh được. Phần 4 đưa Trạng thái bán, Hiển thị và Gói được đề xuất lên đầu. Thanh công cụ có công tắc Hàng tháng/Hàng năm; thanh Lưu và thẻ xem trước dính theo khi cuộn.
4. Tab Bản nháp & mở bán và Lịch sử hiển thị nhãn tiếng Việt cho chế độ, phạm vi và trạng thái bản nháp (trạng thái gốc của bản nháp vẫn có trong tooltip; giá trị lạ hiển thị nguyên văn).

### Landing — bảng giá

1. Giữ tab Cơ bản/Nâng cao theo ADR 0064 (chủ sản phẩm xác nhận 2026-11-05, không chuyển sang hiển thị cả 8 gói cùng lúc), chọn kỳ từng thẻ, thứ tự catalog và thứ tự nội dung thẻ của ADR 0069 (tên, nhóm/mã, kỳ, giá sau VAT căn giữa, mô tả, đầy đủ quyền lợi Có/Không).
2. Hình thức thẻ theo `offer.tier` đã phát hành: personal = mức 1, silver = 2, gold = 3, diamond = 4 (đầu thẻ tối). Mỗi thẻ có biểu tượng, đối tượng (Cá nhân/Tổ chức theo `ownerKind`) và thước cấp độ 4 vạch. Tier khác dùng kiểu trung tính, không có thước cấp độ.
3. Chỉ gói có `display.recommended = true` (Admin đánh dấu) được làm nổi bật: viền và bóng nhấn, nút mua chính tô đầy. Không tự chọn gói đề xuất. Viền và nút mua của gói đề xuất dùng màu của chính mức gói, không dùng một màu xanh chung, để các mức vẫn phân biệt được khi nhiều gói cùng nhóm được đánh dấu (catalog mặc định đánh dấu cả bốn gói Nâng cao; chủ sản phẩm phản hồi 2026-11-05).
4. Dòng quyền lợi có dấu ✓ khi được bao gồm; dòng "Không"/"Chưa cấu hình"/"Không lấy dữ liệu tự động" được làm mờ nhưng giữ nguyên chữ.
5. Nút mua ghi **Mua gói** thay cho "Bắt đầu" (chủ sản phẩm xác nhận 2026-11-05), tên truy cập gồm tên gói và kỳ; gói lượt giữ **Mua lượt**. Đích liên kết, checkout và luồng QR không đổi.
6. Thẻ giá landing **không hiển thị nhãn nào**: không có ruy-băng "Gói đề xuất" và không hiển thị `display.badge`, kể cả nhãn Admin đặt sau này (chủ sản phẩm yêu cầu bỏ chữ "Đề xuất" và chọn ẩn mọi nhãn trên landing, 2026-11-05). Điều này sửa đổi ADR 0064 (badge đến từ release và được hiển thị) cho riêng landing. Dữ liệu `display.recommended`/`display.badge` không đổi. Trước thay đổi này, landing hiển thị nhãn trong đầu thẻ. Trình chỉnh sửa Admin hiện không có ô nhập `display.badge`; giá trị duy nhất trong dữ liệu là "Đề xuất" của các gói Nâng cao. Trang Gói và thanh toán trong ứng dụng (`CommercialStorefront`) và thẻ xem trước của Admin vẫn hiển thị nhãn.

## Compatibility impact

- Không đổi API, document/serialization của bản nháp, SKU, giá, thuế, quota, kỳ hạn, trạng thái bán, entitlement, quyền xuất, role, tenant/module/assignment/record scope, masking hay dữ liệu bản ghi.
- Mọi `data-admin-*` mà trình soạn thảo đọc khi lưu được giữ nguyên; các ô chỉ-đọc bị bỏ không được serialize trước đây.
- `commercialOfferDetails` giữ nguyên hình dạng; thêm hàm thuần `commercialDetailIncluded` chỉ để trình bày.
- Màu dùng biến CSS sẵn có; không tăng số màu thô hoặc `!important` (`scripts/check_frontend_debt.py`).

## Migration strategy

Không migration DB, không reseed, không phát hành release mới. Triển khai frontend (`npx vite build`). Rollback bằng cách hoàn nguyên frontend; bản nháp, release, đơn và thuê bao không bị ảnh hưởng.

## Regression seams

- `tests/js/admin_platform_plans.test.mjs`: thanh Đang áp dụng, nhãn chế độ/trạng thái, công tắc kỳ, không còn ô chỉ-đọc định danh, đủ các trường serialize.
- `tests/js/admin_desktop_interactions.test.mjs`: bốn phần luôn hiển thị, nút nhảy phần, công tắc kỳ đổi đúng gói đang sửa và lưu đúng trạng thái bán từng kỳ.
- `tests/js/landing_dynamic_packages.test.mjs`: phân cấp theo tier, chỉ một thẻ đề xuất và không thẻ nào có chữ "Đề xuất", dòng quyền lợi bao gồm/không bao gồm, tên truy cập nút **Mua gói** theo kỳ, tier lạ trung tính; các kiểm tra hàng ngang 1440px, tràn ngang 320–1440px và axe tiếp tục áp dụng.
