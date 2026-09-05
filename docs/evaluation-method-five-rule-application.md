# Áp dụng bảng năm quy tắc phương pháp đánh giá

Nguồn quyết định sản phẩm: `bang_5_quy_tac_danh_gia_tai_chinh_TT79.md`, được người dùng yêu cầu áp dụng trực tiếp.

## Phạm vi

- Một giai đoạn một túi hồ sơ: Giá thấp nhất, Giá đánh giá.
- Một giai đoạn hai túi hồ sơ, Xây lắp/Hỗn hợp: thêm Kết hợp giữa kỹ thuật và giá; không có Dựa trên kỹ thuật.
- Một giai đoạn hai túi hồ sơ, Hàng hóa/Phi tư vấn: thêm Kết hợp giữa kỹ thuật và giá và Dựa trên kỹ thuật.
- Tư vấn: Giá thấp nhất, Kết hợp giữa kỹ thuật và giá, Dựa trên kỹ thuật.
- EP/EC/PC/EPC dùng phân loại Hỗn hợp hiện hành; máy đặt/máy mượn dùng phân loại Hàng hóa hiện hành. Không tạo loại lĩnh vực mới.
- Hai giai đoạn và các ranh giới hình thức lựa chọn ngoài bảng không thay đổi.

## Tương thích và dữ liệu

Danh sách lựa chọn mới thay đổi; bản ghi hiện hữu giữ nguyên phương pháp khi mở form, kể cả phương pháp không nằm trong danh sách mới. Không tự đổi giá trị khi lưu trường khác.

Không migration dữ liệu, không đổi mã nguồn Mua Sắm Công (đặc biệt method 2 của Tư vấn), thuật toán xếp hạng, quyền hay phạm vi đọc dữ liệu. Việc chuyển các bản ghi lịch sử sang phương pháp mới cần quyết định riêng.

Kiểm thử: `tests/js/evaluation_method_rules.test.mjs` bao phủ các nhóm một/hai túi và bảo toàn hai giai đoạn; `tests/js/package_method_form_initialization.test.mjs` kiểm tra khởi tạo form không ép mặc định.
