# ADR 0042 — Biến Word cho số/ngày văn bản theo mốc tiến độ

- Trạng thái: Chấp nhận (chủ sản phẩm yêu cầu ngày 2026-11-12)
- Ngày: 2026-11-12
- Phạm vi: Tab Tiến độ gói thầu, xuất Word Kế hoạch và Gói thầu

## Bối cảnh

Số văn bản và ngày của các mốc (QĐ thành lập TCG/TTĐ, báo cáo đánh giá, báo cáo
thẩm định, BB đối chiếu, BB hoàn thiện hợp đồng...) được nhập và tính trên tab
Tiến độ, lưu ở `goi_thau_moc_tien_do` và các nguồn tự động khai báo trong
`shared/timeline_rules.json`. Trước đây chúng chỉ được trình bày dưới dạng bảng
tiến độ (nay xuất Excel). Biểu mẫu Word chỉ thấy danh sách thô
`goi_thau.timeline_items` (các dòng đã lưu, chưa áp quy tắc và nguồn tự động),
nên không có biến đơn tương đương các trường dữ liệu khác.

## Quyết định

1. Mỗi mốc **không lặp** của catalog (48 mốc ở catalog v2) có một slug ổn định
   trong `backend/timeline/word_fields.py`. Slug là API của biểu mẫu: không đổi
   tên khi đã phát hành. Module tự kiểm tra slug khớp đủ với catalog lúc import.
2. Mỗi mốc sinh hai khóa ngữ cảnh gốc `moc_so_<slug>` và `moc_ngay_<slug>` và
   hai ánh xạ mặc định `__context__`: `so_<slug>` (text) và `ngay_<slug>`
   (date, nên có sẵn `S_ngay_<slug>`). Tên biến không có tiền tố riêng; slug được
   chọn để không trùng biến mặc định hiện có (vì vậy dùng `ttr_pd_hsmt`,
   `qd_pd_hsmt`, `qd_pd_kq` thay cho `so_ttr_hsmt`, `so_qd_hsmt`, `so_qd_kq` vốn
   là biến của gói thầu). Catalog từ chối tên mặc định trùng nhau.
3. Giá trị lấy từ đúng bộ đánh giá `build_effective_timeline` như tab Tiến độ:
   chỉ dòng `APPLICABLE` (giống bảng tiến độ chính thức), số văn bản theo chế độ
   AUTO/MANUAL của dòng, ngày = ngày thực tế, nếu trống thì ngày dự kiến. Mốc
   không áp dụng hoặc chưa có dữ liệu cho chuỗi rỗng; mọi khóa luôn có mặt.
4. Xuất Word gói thầu (evaluation, hsmt, opening, result, contract, liquidation)
   dùng tiến độ của chính gói thầu được xuất. Xuất Word Kế hoạch chỉ điền các mốc
   nhóm "KHLCNT + dự toán"; với mỗi mốc, lấy gói thầu đầu tiên của kế hoạch (cũ
   nhất theo `created_at`, rồi theo ID) có số hoặc ngày. Các nhóm khác để trống vì
   không xác định được gói thầu.
5. Mốc lặp (yêu cầu/trả lời làm rõ, gia hạn, điều chỉnh E-HSMT) không có biến đơn;
   tiếp tục dùng các danh sách hiện hữu.
6. Catalog ánh xạ mặc định tăng lên v17. Đây là biến hệ thống: mọi phạm vi (tổ
   chức, cá nhân, kể cả phạm vi mới tạo) có sẵn ngay khi ứng dụng khởi động, không
   cần seed dòng dữ liệu. Người dùng tùy biến bằng override thưa như các biến mặc
   định khác: đổi tên, đổi nguồn, đổi mô tả, ẩn, khôi phục mặc định.
7. Nếu một phạm vi đã có biến tự tạo trùng tên với biến mặc định mới, biến tự tạo
   giữ nguyên hiệu lực và biến mặc định đó không được liệt kê cho phạm vi ấy (trước
   đây biến tự tạo vốn được áp sau và thắng khi xuất). Đổi tên biến tự tạo thì biến
   mặc định xuất hiện lại.
8. Từ điển biến ở giao diện lấy nhãn và định dạng ngày của biến `__context__` từ
   manifest sinh tự động.

## Hệ quả, tương thích và triển khai

- Không đổi quyền, masking hay phạm vi hiển thị: dữ liệu tiến độ của gói thầu đã
  nằm trong ngữ cảnh Word (`timeline_items`) của cùng bản ghi; đây chỉ là phép
  chiếu trình bày có kiểm soát qua `docx_context_policy`. Word entitlement vẫn chỉ
  kiểm soát hành động xuất.
- Không có migration schema/dữ liệu. Ánh xạ mặc định được giải từ catalog trong
  mã nên mọi phạm vi nhận biến mới ngay; override/tùy biến cũ giữ nguyên (xem mục
  7 cho trường hợp trùng tên).
- Digest nguồn của tác vụ Word nền nay bao gồm các khóa mốc. Tác vụ đã xếp hàng
  trước khi triển khai sẽ báo `DOCUMENT_EXPORT_SOURCE_CHANGED` khi kiểm tra lại
  nguồn và cần xuất lại; sửa tiến độ sau khi xếp hàng cũng được coi là đổi nguồn.
- Mỗi lần xuất gói thầu thêm vài truy vấn đọc tiến độ cùng tổ chức; xuất kế hoạch
  thêm số truy vấn tương ứng số gói thầu hiện hành của kế hoạch.
- Rollback binary: bỏ khóa và ánh xạ; biểu mẫu dùng các biến này sẽ in rỗng.

## Kiểm thử hồi quy

`tests/test_timeline_word_variables.py` khóa: phủ đủ mốc không lặp và tên biến
duy nhất, định dạng/nhãn, hợp đồng ánh xạ cho plan và các loại báo cáo, chỉ dòng
áp dụng được chiếu, ưu tiên ngày thực tế, nguồn tự động từ kế hoạch, gói thầu
một túi loại mốc kỹ thuật, quy tắc chọn gói thầu cho xuất kế hoạch, và kết xuất
thực tế số/ngày/`S_` qua manifest đã niêm phong; phạm vi mới có sẵn biến và
đổi tên/ẩn/khôi phục được; biến tự tạo trùng tên vẫn thắng và không bị liệt kê đôi.
