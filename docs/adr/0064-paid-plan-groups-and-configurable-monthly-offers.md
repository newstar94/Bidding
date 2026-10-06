# ADR 0064 — Nhóm gói Cơ bản/Nâng cao và giá tháng cấu hình trong Admin

- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm ngày 2026-10-06.
- Phạm vi: trình bày gói trả phí, cấu hình bản nháp tháng và kỳ hạn kích hoạt.

## Business contract

1. Hai nhóm Cơ bản/Nâng cao tương ứng với `internal`/`connected`. Cơ bản là nền tảng nội bộ không kèm lấy dữ liệu Mua Sắm Công; Nâng cao có kết nối và quota theo gói được công bố.
2. Trong mỗi nhóm và mỗi chu kỳ, Cá nhân có một mức giá; Tổ chức có ba mức Bạc/Vàng/Kim Cương. Trang công khai tách một khu vực Cá nhân và một hàng ba thẻ Tổ chức. Cửa hàng trong ứng dụng tiếp tục giữ bộ lọc workspace sở hữu hiện hành.
3. Chu kỳ Hàng tháng/Hàng năm nằm ngay trong từng thẻ gói và được chọn độc lập. Hai tab Cơ bản/Nâng cao nằm phía trên. Lựa chọn chu kỳ chọn offer có thẩm quyền theo `price.period`, không lấy giá năm chia 12. Giá tháng được chủ sản phẩm yêu cầu cấu hình sau trong Admin; không seed, không sửa release hiệu lực và không tự xuất bản.
4. Admin thêm offer tháng từ gói năm tương ứng trong bản nháp. Giá, thuế và quota kết nối chưa có giá trị mặc định. Offer mới có `salesState=non_sellable`; các quyền xuất, loại chủ thể, số thành viên và cờ kiểm tra vi phạm giữ mapping của gói nguồn để người quản trị xem và cấu hình theo quy trình hiện hành.
5. Kỳ hạn tháng dùng `policies.monthlyBaseTerm`, với loại `fixed_days` hiện hữu và số ngày do Admin nhập rõ ràng. Không tự chọn 30/31 ngày và không suy ra từ kỳ năm. Thiếu kỳ hạn riêng ngăn xuất bản và không kích hoạt bằng kỳ hạn năm.
6. Không thay đổi quyền đọc bản ghi, tenant/module/assignment/record scope, masking, vai trò, quyền mua, quota mua thêm, cơ chế thanh toán hoặc dữ liệu đã lưu. Tab là lựa chọn trình bày và SKU, không phải gate quyền của API.

## Compatibility impact

- Tám offer năm, mã SKU cũ, giá, hạn mức, quyền lợi và `policies.baseTerm` tiếp tục hoạt động như trước.
- Tối đa 16 offer: ma trận năm bắt buộc hiện hành và tối đa tám offer tháng tùy chọn. Khóa duy nhất của validator là quy mô + biến thể + chu kỳ. Giá/quota chưa nhập không thể xuất bản.
- Tính lợi ích Kết nối riêng theo từng chu kỳ, giữ nguyên công thức và ngưỡng hiện hành.
- Tên, mô tả, badge, variant label, period label và quyền lợi vẫn đến từ release. Offer không thuộc hai nhóm hoặc chu kỳ chuẩn vẫn được trình bày trong khu vực gói khác, không bị mất.
- Kỳ tháng chưa có offer đang bán của thẻ được khóa với thông báo rõ ngay trong thẻ. Chuyển chu kỳ một thẻ không đổi các thẻ khác. Nhóm trống có trạng thái trống; không giữ các thẻ của lựa chọn trước.

## Migration strategy

- Không cần migration DB: `billing_prices.period` đã hỗ trợ `monthly`; SKU và plan version phân biệt bằng mã.
- Release/snapshot cũ không bổ sung offer tháng hoặc monthly policy tự động. Với đơn năm và snapshot legacy không có `price.period`, activation tiếp tục dùng `baseTerm`.
- Super Admin chọn bản nháp, thêm gói tháng, nhập giá/thuế/quota/kỳ hạn, chọn trạng thái bán rồi Lưu → Kiểm tra → Xuất bản. Các kiểm tra revision, digest, step-up, audit và external readiness giữ nguyên.
- Quay lui bằng phát hành phiên bản catalog mới theo quy trình hiện hành. Đơn đã trả giữ snapshot của chính đơn đó.

## Regression seams

- Chuyển hai nhóm và hai chu kỳ: một thẻ Cá nhân, ba thẻ Tổ chức, đúng tên/giá/quota/mã gói từ catalog.
- Kỳ tháng chưa cấu hình hoặc không có trong nhóm; nhóm trống; offer bổ sung; metadata tùy chỉnh; desktop/mobile và bàn phím.
- Cửa hàng giữ workspace sở hữu, gửi đúng SKU và owner trong quote, giữ các credit pack.
- Thêm offer tháng không sửa gói năm hoặc quyền nguồn; lưu lại số ngày hiệu lực do Admin nhập.
- Validator phân biệt cùng quy mô/biến thể ở hai chu kỳ, chặn trùng SKU và kỳ hạn tháng chưa rõ.
- Activation tháng dùng số ngày và thời hạn grant trong snapshot riêng; replay không cấp lại quyền lợi; thiếu policy tháng không dùng thời hạn năm.
