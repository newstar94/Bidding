# ADR 0078 — Chế độ phát hành trong Admin và danh mục hiện hành

- Ngày: 2026-10-08.
- Trạng thái: Chấp nhận theo yêu cầu chủ sản phẩm.

## Business contract

Admin cấu hình **Chế độ phát hành** ngay trên đầu bản nháp: **Thử nội bộ**,
**Thí điểm**, hoặc **Công khai · Mở bán chính thức**. Chuyển chế độ là thay
đổi bản nháp, cần lưu, kiểm tra lại và xác nhận xuất bản. Cảnh báo, hộp xác
nhận và kết quả xuất bản nêu rõ chế độ; xuất bản nội bộ không tự trở thành
mở bán chính thức.

Danh sách gói trong Admin lấy đúng snapshot của bản phát hành hiện hành,
bao gồm gói ẩn và gói dừng bán. Catalog công khai được dùng riêng để xác
nhận bảng giá trên trang chủ. Không dùng dữ liệu công khai cũ hoặc lỗi đọc
catalog để thay thế snapshot hiện hành trong Admin.

Chủ sản phẩm đã duyệt tạo bản phát hành Công khai mới từ tám gói của
`commercial-release-e07ace5c052e4147a4fb26e122574267`, giữ nguyên giá và
quyền lợi. Chỉ thay chế độ và hoàn tất tham chiếu readiness bằng bằng chứng
đã xác minh; bản cũ bất biến và các điều kiện thanh toán tiếp tục áp dụng.

## Compatibility impact

Overview dành cho Super Admin bổ sung `currentCatalog`, lấy từ cùng release
với `currentRelease`. Xác thực trước khi đọc dữ liệu. Frontend cũ vẫn dùng
được response; frontend mới chỉ dùng nguồn public dự phòng khi backend cũ
chưa có trường này. Giá, quyền, scope và điều kiện public resolver không đổi.

## Migration strategy

Không cần migration DB hoặc sửa `.env`. Backend có thể triển khai trước
frontend. Khi chuyển chế độ, tạo bản phát hành mới qua API quản trị có
revision, validation digest, tái xác thực, CSRF, idempotency và audit.

## payOS revalidation

Ngày 2026-10-08, đã xác nhận lại đúng URL webhook hiện hữu bằng API chính
thức `POST https://api-merchant.payos.vn/confirm-webhook`: HTTP 200, `code=00`,
URL phản hồi khớp
`https://demo.hosodauthau.online/api/billing/providers/provider-payos-production-v2/webhook`.
Cơ sở dữ liệu của ứng dụng đang chạy đã nhận một webhook sau phép xác nhận
này. Không ghi khóa hoặc thông tin tài khoản ngân hàng vào tài liệu.

Phép kiểm tra xác nhận credential/kênh/webhook hiện tại, không phải giao
dịch thu tiền hoặc kiểm chứng kích hoạt/gia hạn của bản giá mới.

## Regression seams

- Super Admin thấy đúng giá, gói ẩn/dừng bán khi catalog public tắt, lỗi hoặc cũ.
- Chuyển nhóm, thẻ, kỳ tháng/năm và chỉnh sửa dùng cùng snapshot hiện hành.
- Chuyển chế độ lưu đúng giá trị và vô hiệu hóa validation trước đó.
- Public resolver trong enforce không chọn shadow; runtime shadow giữ contract hiện có.
- Chỉ catalog có gói và khớp release mới được báo đã hiển thị bảng giá.
- Bản lên lịch không thay bản hiện hành trước thời điểm hiệu lực.

## Local publication receipt

Ngày 2026-10-08, tạo và xuất bản qua API quản trị bản Công khai mới
`commercial-release-8557202ef2da4e0abb55fb0835383127`, phiên bản
`release-1791472114-2`, từ đúng nguồn đã duyệt
`commercial-release-e07ace5c052e4147a4fb26e122574267`.
Nguồn này và bản `commercial-release-86227038267d4a0ea66d3edd1ca13200`
đã có sự kiện dừng bán, nên trước thao tác này resolver chọn bản
`commercial-release-aad3cf5e1f5c4ec08ddd914cd5344d4d`; cả ba snapshot có cùng
checksum. Bản Công khai mới không sửa hoặc xóa lịch sử đó.

API public và Admin tại ứng dụng đang chạy trên máy đều trả đúng bản mới,
có đủ tám gói. So sánh toàn bộ offers xác nhận giữ nguyên giá và quyền lợi.
Bản nháp đang có của người dùng được giữ nguyên; thao tác dùng một bản
nháp mới. Bằng chứng này xác nhận danh mục mở bán tại runtime hiện tại,
không thay thế kiểm chứng một giao dịch trả tiền và kích hoạt thực tế.
