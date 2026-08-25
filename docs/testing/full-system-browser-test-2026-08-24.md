# Báo cáo kiểm thử toàn hệ thống BiddingFlow

**Ngày kiểm thử:** 24/08/2026  
**Môi trường:** máy cục bộ, `http://127.0.0.1:8000/`  
**Phạm vi:** trình duyệt, giao diện, API/backend, PostgreSQL, phân quyền theo vai trò và xuất Word chạy nền.

## Kết luận nhanh

- Luồng chính với dữ liệu thật từ Mua sắm công hoạt động: nhập kế hoạch, xem kế hoạch/gói thầu, timeline và xuất Word.
- Bộ kiểm thử giao diện đạt **1.349/1.349**.
- Bộ kiểm thử backend đạt **1.872/1.873**; một bài kiểm thử cũ chưa theo kịp cơ chế xuất Word theo lô.
- Ghi nhận **3 lỗi vận hành/sử dụng** và **1 lỗi ở bài kiểm thử**. Chưa sửa mã nguồn trong đợt này.
- Không thay đổi quyền, cách hiển thị dữ liệu, che dữ liệu hoặc nghiệp vụ hiện có.

## Dữ liệu thật đã dùng

Nguồn chính thức: `https://muasamcong.mpi.gov.vn/`

- Mã kế hoạch: `PL2600276090-00` (mã lưu cục bộ: `PL2600276090`)
- Tên: **Lắp đặt thiết bị hút ẩm cho các bể chứa xăng sinh học E10 tại các trạm xăng dầu trực thuộc Công ty Xăng dầu Quân đội Khu vực 3**
- Chủ đầu tư: **CÔNG TY TNHH MỘT THÀNH VIÊN TỔNG CÔNG TY XĂNG DẦU QUÂN ĐỘI**
- Ngày đăng tải: `24/08/2026 22:27`
- Ngày phê duyệt: `07/08/2026`
- Quyết định: `1103/QĐ-CTKV3`
- Giá trị: `388.962.000 VND`
- Hình thức: `Chỉ định thầu rút gọn`
- Nguồn không có mã gói thầu, vì vậy ứng dụng hiển thị `(Chưa nhập)`; không tự tạo mã giả.

Dấu vết DB xác nhận phiên nhập có nhà cung cấp `MUASAMCONG`, loại `PLAN`, mã họ dữ liệu `PL2600276090`, trạng thái `COMPLETED`; bản nguồn được đánh dấu `APPLIED`. Bốn lần đọc nguồn đều thành công.

## Các phần đã kiểm tra và đạt

### Vai trò Quản lý

Đã mở và kiểm tra 13 màn hình: Tổng quan đơn vị, Kế hoạch LCNT, Gói thầu, Timeline gói thầu, Trung tâm hồ sơ và tác vụ, Hợp đồng, Chủ đầu tư, Nhà thầu, Chuyên gia, Biểu mẫu Word, Xuất bản Word, Nhân sự và phân quyền, Trạng thái hợp đồng.

### Vai trò Chuyên viên

Đã mở và kiểm tra 11 màn hình: Công việc của tôi, Kế hoạch LCNT, Gói thầu, Timeline gói thầu, Trung tâm hồ sơ và tác vụ, Hợp đồng, Chủ đầu tư, Nhà thầu, Chuyên gia, Biểu mẫu Word, Xuất bản Word.

- Không hiển thị hai mục dành cho quản lý: Nhân sự và phân quyền, Trạng thái hợp đồng.
- Biểu mẫu Word dùng chung chỉ cho xem/sao chép; không có nút thêm, sửa, xóa.

### Vai trò Super Admin

Đã kiểm tra Tổng quan Super Admin và Quản lý người dùng.

- Không hiển thị Kế hoạch, Gói thầu và Xuất bản Word, đúng phạm vi vai trò hiện tại.

### Luồng nghiệp vụ sâu

- Danh sách kế hoạch và gói thầu hiển thị đúng dữ liệu đã nhập.
- Timeline nhận đúng gói thầu, tải 7 mốc áp dụng và tự điền quyết định `1103/QĐ-CTKV3`, ngày `07/08/2026`.
- Xuất bản Word nhận ra 2 loại tài liệu; tài liệu kế hoạch có 1 mẫu sẵn sàng.
- Tác vụ Word chạy nền hoàn tất và tải được `Ke_hoach_LCNT_PL2600276090.docx`.
- DB ghi nhận tác vụ `render_docx` hoàn tất, tiến độ `1/1`, không có lỗi.
- Nhật ký có đủ sự kiện tạo tác vụ và tải kết quả Word.
- Trong lúc duyệt ma trận vai trò không phát hiện lỗi console.

### Toàn vẹn DB

- Kế hoạch: 1; gói thầu: 1; chủ đầu tư: 1.
- Gói thầu liên kết đúng kế hoạch và cùng đơn vị.
- Chủ đầu tư liên kết đúng kế hoạch và cùng đơn vị.
- Không có gói thầu mồ côi; không có liên kết lệch đơn vị.
- Tổng giá gói thầu bằng tổng mức kế hoạch: `388.962.000 = 388.962.000`.
- Phiên bản đồng bộ cuối: `11`.

## Lỗi ghi nhận

### BF-TEST-01 — Màn lấy dữ liệu Mua sắm công có thể bị kẹt

**Mức ảnh hưởng:** Trung bình  
**Hiện tượng:** Các trường đã được điền đầy đủ nhưng dòng “Đang lấy dữ liệu kế hoạch” vẫn còn hơn 32 giây. Nút lưu/đóng ban đầu trông như không phản hồi. Khi mở lại trang, ứng dụng báo có phiên nhập chưa hoàn tất; chọn “Tiếp tục” thì lưu và hoàn tất được.  
**Ảnh hưởng:** Không mất dữ liệu nhưng người dùng dễ tưởng ứng dụng treo và phải tải/mở lại trang để phục hồi.

### BF-TEST-02 — Phiên đăng nhập ban đầu bị phiên khác thay thế

**Mức ảnh hưởng:** Trung bình  
**Hiện tượng:** Lần đăng nhập đầu xuất hiện thông báo “Tài khoản đăng nhập ở thiết bị khác”. WebSocket đóng với mã `4001`, lần tải danh sách kế hoạch thất bại do phiên hết hiệu lực. DB cho thấy nhiều phiên được tạo sát nhau và phiên cũ bị phiên mới thu hồi. Đăng nhập lại thì hoạt động bình thường.  
**Lưu ý:** Đã xác nhận hiện tượng phiên trùng/thay thế; chưa đủ bằng chứng kết luận nguyên nhân gốc.

### BF-TEST-03 — Tác vụ dọn tài liệu hết hạn lỗi định kỳ

**Mức ảnh hưởng:** Cao về vận hành lâu dài  
**Bằng chứng log:** `retention_cleanup` lặp lại lỗi:

```text
AttributeError: 'PostgresConnection' object has no attribute 'executemany'
```

Vị trí: `backend/documents/document_worker.py`, hàm `purge_expired_durable_document_jobs`.  
**Ảnh hưởng:** Việc xuất Word hiện tại vẫn thành công, nhưng dữ liệu/tệp tác vụ hết hạn có thể không được dọn đúng hạn và tăng dần theo thời gian.

### BF-TEST-04 — Một bài kiểm thử backend chưa theo cơ chế xuất Word theo lô

**Loại:** Lỗi bộ kiểm thử, chưa thấy lỗi thật trên giao diện  
**Bài lỗi:** `tests/test_word_publication_template_assignments.py::test_multiple_assigned_templates_render_into_one_zip_download`  
**Hiện tượng:** Mô phỏng cũ còn đọc `payload["template_path"]`, trong khi mã hiện tại gửi tác vụ `render_docx_batch` bằng `payload["templates"]`, gây `KeyError: 'template_path'`.  
**Ảnh hưởng:** Làm bộ backend không xanh hoàn toàn và có thể che khuất lỗi hồi quy thật về sau. Luồng xuất Word thực tế trong phiên này vẫn hoàn tất.

## Kết quả kiểm thử tự động

```text
python -m pytest -q
1872 passed, 1 failed
Thời gian: 257,15 giây

npm run test:js
1349 passed, 0 failed
Thời gian: 96,55 giây
```

Các lỗi log có nội dung `audit unavailable`, lỗi readiness giả lập và lỗi `schema-field` phát sinh từ chính các bài kiểm thử cố ý mô phỏng lỗi; không xếp chúng thành lỗi vận hành độc lập.

## Phần chưa thể kiểm thử đầy đủ mà không bịa dữ liệu

Các thao tác sâu của hợp đồng, nhà thầu, chuyên gia, mở thầu, đánh giá và kết quả cần hồ sơ thật ở các giai đoạn tương ứng. Bộ dữ liệu Mua sắm công được chọn chỉ có kế hoạch và một gói thầu, nên đợt này chỉ kiểm tra khả năng mở màn hình và quyền truy cập của các phần đó; không tạo bản ghi giả để ép chạy luồng.

“Tất cả chức năng” vì vậy được hiểu là toàn bộ màn hình/vai trò có thể tiếp cận và các luồng có đủ dữ liệu thật trong bộ hồ sơ đã chọn. Không tuyên bố bao phủ tuyệt đối mọi nhánh dữ liệu, lỗi mạng, tải lớn hoặc mọi loại mẫu Word.

## Ưu tiên xử lý đề nghị

1. Sửa tác vụ dọn tài liệu hết hạn (`BF-TEST-03`).
2. Điều tra việc tạo/thay thế nhiều phiên đăng nhập sát nhau (`BF-TEST-02`).
3. Làm rõ và kết thúc trạng thái loading của phiên nhập Mua sắm công (`BF-TEST-01`).
4. Cập nhật mô phỏng kiểm thử Word theo lô (`BF-TEST-04`).

## Cập nhật khắc phục và kiểm thử lại ngày 25/08/2026

Đã khắc phục:

- `BF-TEST-03`: dọn tác vụ Word hết hạn dùng đúng thao tác theo lô của con trỏ PostgreSQL. Chạy trực tiếp trên DB thành công, không còn `AttributeError`.
- `BF-TEST-04`: mô phỏng kiểm thử đã dùng đúng payload `render_docx_batch` và danh sách `templates`.
- `BF-TEST-02`: giao diện đăng nhập chặn gửi lặp trong khi yêu cầu đầu đang chạy. Kiểm thử trình duyệt gửi hai lần đồng thời chỉ tạo một phiên mới.
- Loading nhập Mua sắm công: 131 bài kiểm thử chuyên biệt đều đạt, gồm thay phiên, hủy, đổi workspace và đóng loading sau khi form đổi định danh. Không sửa thêm khi không còn tín hiệu lỗi tái hiện được.

Kiểm thử sâu còn phát hiện và sửa thêm:

- Bản ghi gói thầu nhẹ khi đồng bộ lần đầu thiếu `hình thức lựa chọn` và `phương thức lựa chọn`, làm màn Xuất Word suy ra sai sau đăng nhập sạch. Server nay gửi hai trường này trong bản ghi tham chiếu. Trình duyệt xác nhận lại đúng **2 loại văn bản**, `Một giai đoạn một túi hồ sơ` và `Chỉ định thầu rút gọn`.
- Dropdown đưa ra ngoài khung trang bị lệch trong lúc hiệu ứng mở còn chạy. Vị trí nay được căn ổn định cả sau cuộn.
- Bài kiểm thử khóa nút Word được chuyển về đúng thời điểm tác vụ còn đang chạy, tránh kết luận sai khi tác vụ giả đã hoàn tất.

Kết quả cuối:

```text
Backend đầy đủ: 1874 passed, 0 failed
Frontend đầy đủ: 1350 passed, 0 failed
Kiểm thử đồng bộ/read scope: 28 passed, 16 skipped theo điều kiện môi trường
Kiểm tra tĩnh: đạt
Xuất Word thật: completed, 1/1, không có mã lỗi
```

Màn loading chung được quan sát trực tiếp khi xuất Word: hiển thị trong lúc xử lý, `aria-busy=true`, rồi tự đóng khi tác vụ hoàn tất.
