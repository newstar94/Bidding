# Kế hoạch thêm tab Tài liệu vào chi tiết gói thầu

Trạng thái: đã triển khai.

Ngày cập nhật: 24/07/2026.

## 1. Mục tiêu

Thêm một tab **Tài liệu** trong màn hình chi tiết gói thầu.

Tab này liệt kê lũy kế các loại tài liệu từ bước đầu tiên đến bước hiện tại của gói thầu:

- Bước chuẩn bị: tải HSMT/E-HSMT và báo cáo thẩm định HSMT nếu có.
- Bước đánh giá: tải các báo cáo đánh giá và báo cáo thẩm định tương ứng với
  phương thức lựa chọn nhà thầu.
- Khi gói đã sang bước sau: cả loại tài liệu đã tải và chưa đính kèm của bước cũ
  vẫn được hiển thị. Người có quyền sửa gói thầu có thể bổ sung, thay hoặc xóa
  tài liệu của mọi bước đã đi qua; gói đã hủy chỉ cho xem và tải xuống.

Mục tiêu là lưu file theo gói thầu, không xây dựng hệ thống quản lý tài liệu độc
lập.

## 2. Phạm vi đơn giản

### Có trong lần triển khai này

- Một tab **Tài liệu** trong `goi-thau-chi-tiet`.
- Danh sách các loại tài liệu được hệ thống xác định từ trạng thái gói thầu.
- Mỗi loại tài liệu có tối đa một file hiện hành.
- Upload, tải xuống, thay file và xóa file.
- Hiển thị tên file, dung lượng, người tải và thời gian tải.
- Phân quyền theo quyền xem/sửa gói thầu hiện có.
- Lưu file vào vùng upload riêng tư và đưa vào cơ chế backup hiện tại.

### Không làm trong lần triển khai này

- Không có lịch sử phiên bản.
- Không liên kết tài liệu với phần lô, đợt xử lý hoặc
  `ho_so_nghiep_vu_lcnt`.
- Không có số văn bản, ngày văn bản, mô tả, tag hay tìm kiếm toàn văn.
- Không có ký số, OCR, xem/chỉnh sửa file trực tuyến.
- Không có chia sẻ công khai.
- Không upload nhiều file cho cùng một loại tài liệu.
- Không tạo danh mục loại tài liệu tùy chỉnh.

## 3. Quy tắc hiển thị theo bước gói thầu

Tab **Tài liệu** luôn xuất hiện trong chi tiết gói thầu để người dùng có thể xem
lại file đã tải.

Server trả về:

- Các tài liệu đã có của gói thầu.
- Các loại tài liệu được phép upload tại trạng thái hiện tại.

Frontend không tự suy luận quyền upload chỉ từ giao diện.

### 3.1. Trạng thái `Chuẩn bị`

Hiển thị các ô:

| Mã loại | Nhãn trên giao diện |
| --- | --- |
| `HSMT` | Hồ sơ mời thầu/E-Hồ sơ mời thầu |
| `HSMT_APPRAISAL_REPORT` | Báo cáo thẩm định HSMT/E-HSMT |

Ô báo cáo thẩm định HSMT có thể chỉ hiển thị khi gói có yêu cầu thẩm định HSMT
theo dữ liệu hiện có.

### 3.2. Trạng thái `Đang mời thầu` hoặc `Đã mở thầu`

- Không mở thêm loại tài liệu mới.
- Tiếp tục hiển thị HSMT và báo cáo thẩm định HSMT đã tải ở bước chuẩn bị.
- Việc upload báo cáo đánh giá chỉ bắt đầu khi gói chuyển sang
  `Đang chấm thầu`.

### 3.3. Trạng thái `Đang chấm thầu`

Với phương thức một giai đoạn một túi hồ sơ:

| Mã loại | Nhãn trên giao diện |
| --- | --- |
| `BID_EVALUATION_REPORT` | Báo cáo đánh giá E-HSDT |
| `RESULT_APPRAISAL_REPORT` | Báo cáo thẩm định kết quả lựa chọn nhà thầu |

Với phương thức một giai đoạn hai túi hồ sơ:

| Mã loại | Nhãn trên giao diện |
| --- | --- |
| `TECHNICAL_EVALUATION_REPORT` | Báo cáo đánh giá E-HSĐXKT |
| `TECHNICAL_APPRAISAL_REPORT` | Báo cáo thẩm định nhà thầu đạt kỹ thuật |
| `FINANCIAL_EVALUATION_REPORT` | Báo cáo đánh giá E-HSĐXTC |
| `RESULT_APPRAISAL_REPORT` | Báo cáo thẩm định kết quả lựa chọn nhà thầu |

Để giữ triển khai đơn giản, các ô của bước đánh giá được hiển thị cùng nhau.
Không cần thêm state machine riêng cho từng file. Người dùng tải file nào đã có
tại thời điểm thực hiện nghiệp vụ.

### 3.4. Trạng thái `Đã có kết quả một phần` hoặc `Đã có kết quả`

- Hiển thị toàn bộ tài liệu đã tải.
- Không mở thêm loại tài liệu mới trong phạm vi hiện tại.
- Nếu cần bổ sung quyết định phê duyệt kết quả, đây sẽ là một loại tài liệu mới
  ở lần mở rộng sau.

### 3.5. Trạng thái `Hủy thầu`

- Tab chuyển sang chỉ xem và tải xuống.
- Không cho upload, thay hoặc xóa tài liệu.

### 3.6. Quy tắc khi thay đổi trạng thái

- Tài liệu đã tải không biến mất khi gói chuyển bước.
- Loại tài liệu chưa tải của bước cũ vẫn có nút upload để bổ sung.
- Người dùng có quyền sửa được **Thay file** hoặc **Xóa** đối với mọi loại tài
  liệu thuộc các bước gói thầu đã đi qua.

## 4. Giao diện tab Tài liệu

### 4.1. Bố cục

Mỗi loại tài liệu là một card hoặc một dòng:

```text
Hồ sơ mời thầu
────────────────────────────────────────
HSMT_goi_xay_lap_01.pdf     8,4 MB
Tải bởi Nguyễn Văn A · 24/07/2026 15:30
[Tải xuống] [Thay file] [Xóa]
```

Nếu chưa có file và loại đó được phép upload:

```text
Báo cáo đánh giá E-HSDT
────────────────────────────────────────
Chưa có tài liệu
[Chọn file để tải lên]
```

### 4.2. Hành vi

- Chọn một file rồi upload ngay; không cần form metadata riêng.
- Hiển thị tiến trình hoặc trạng thái đang tải.
- Upload thành công thì cập nhật lại đúng card.
- Nếu thay file thất bại, file cũ vẫn còn.
- Xóa cần hộp xác nhận.
- Người chỉ có quyền xem chỉ thấy nút **Tải xuống**.
- Tên file dài được rút gọn trên màn hình nhưng giữ nguyên khi tải xuống.
- Tab dùng được bằng bàn phím và trên màn hình nhỏ.

## 5. Mô hình dữ liệu

Chỉ thêm một bảng `tai_lieu_goi_thau`:

| Cột | Ý nghĩa |
| --- | --- |
| `id` | ID bản ghi |
| `organization_id` | Phạm vi tổ chức |
| `owner_type` | Tương thích workspace hiện tại |
| `goi_thau_id` | Gói thầu sở hữu tài liệu |
| `document_type` | Một trong các mã loại tài liệu được server cho phép |
| `original_filename` | Tên file người dùng đã chọn |
| `storage_key` | Tên/khóa lưu file do server sinh |
| `content_type` | MIME đã kiểm tra |
| `size_bytes` | Dung lượng file |
| `sha256` | Checksum để kiểm tra toàn vẹn |
| `uploaded_by_id` | Người tải gần nhất |
| `uploaded_at` | Thời điểm tải gần nhất |
| `created_at`, `updated_at` | Thời gian hệ thống |

Ràng buộc:

- Unique `(organization_id, goi_thau_id, document_type)`.
- Một gói chỉ có một file hiện hành cho mỗi loại.
- Không nhận `organization_id`, `storage_key`, `uploaded_by_id` từ client làm
  nguồn sự thật.
- Khi thay file, server chỉ xóa file cũ sau khi file mới đã được kiểm tra và lưu
  thành công.
- Khi xóa tài liệu, xóa cả bản ghi và file. Audit hiện có ghi lại thao tác và
  metadata tối thiểu.

Không thêm bảng phiên bản, bảng liên kết phần lô hoặc bảng danh mục loại tài liệu.
Danh sách loại tài liệu là một policy nhỏ trong mã nguồn.

## 6. Lưu file

Dùng vùng `BIDDING_UPLOAD_DIR` hiện có, tạo thư mục con:

```text
goi-thau-documents/<organization-id>/<package-id>/<random-file-id>
```

Yêu cầu tối thiểu:

- Không lưu file trong `views`, `dist` hoặc thư mục release.
- Không dùng tên file gốc làm tên thật trên ổ đĩa.
- API tải xuống phải kiểm tra quyền; không public thư mục file.
- Dùng lại `spooled_upload` để không đọc toàn bộ file lớn vào RAM.
- Dùng đường dẫn đã chuẩn hóa, chặn `../` và symlink thoát khỏi upload root.
- Thư mục `BIDDING_UPLOAD_DIR` đã nằm trong luồng backup/restore hiện tại, nên
  không cần thêm một cơ chế backup mới.

## 7. Định dạng và giới hạn

Đề xuất ban đầu:

- Cho phép `.pdf`, `.docx`, `.xlsx`.
- Tối đa 25 MiB/file.
- Một file/request.

Kiểm tra tối thiểu phía server:

- Phần mở rộng, MIME và magic bytes phải khớp.
- DOCX/XLSX dùng lại `backend/documents/archive_validation.py`.
- PDF phải có signature PDF hợp lệ.
- Từ chối file thực thi, file macro, HTML, ZIP/RAR và tên file nguy hiểm.
- Dùng tên file đã sanitize trong `Content-Disposition` khi tải xuống.

Cập nhật giới hạn tương ứng tại:

- `backend/http_middleware.py`.
- `.env.example`.
- `deploy/nginx-biddingflow.conf.example`.

## 8. API

| Method và route | Mục đích |
| --- | --- |
| `GET /api/packages/{package_id}/documents` | Trả các loại tài liệu lũy kế đến bước hiện tại, gồm cả loại chưa đính kèm |
| `PUT /api/packages/{package_id}/documents/{document_type}` | Upload mới hoặc thay file bằng multipart |
| `GET /api/packages/{package_id}/documents/{document_type}/download` | Tải file |
| `DELETE /api/packages/{package_id}/documents/{document_type}` | Xóa file |

Response của API danh sách đề xuất:

```json
{
  "packageId": "package-1",
  "packageStatus": "Đang chấm thầu",
  "slots": [
    {
      "type": "TECHNICAL_EVALUATION_REPORT",
      "label": "Báo cáo đánh giá E-HSĐXKT",
      "canUpload": true,
      "document": null
    }
  ]
}
```

Server kiểm tra:

- Session và active organization.
- Gói thầu tồn tại trong đúng tổ chức.
- Người dùng có quyền xem/sửa đúng record gói thầu.
- `document_type` thuộc allowlist của gói theo trạng thái và phương thức lựa
  chọn.

## 9. Phân quyền

| Thao tác | Quyền |
| --- | --- |
| Xem danh sách và tải file | Quyền xem record gói thầu |
| Upload hoặc thay file | Quyền sửa record gói thầu và loại file thuộc bước hiện tại hoặc bước đã đi qua |
| Xóa file | Quyền sửa record gói thầu và loại file thuộc bước hiện tại hoặc bước đã đi qua |
| Gói đã hủy | Chỉ xem/tải |

Dùng lại `can_read_record` và `authorize_record_write` trong
`backend/shared/access_policy.py`. Mọi query đều lọc `organization_id` để tránh
đọc file chéo tổ chức.

## 10. Các file dự kiến thay đổi

### Backend

- `backend/db/schema.py`: thêm bảng `tai_lieu_goi_thau`.
- `backend/db/upgrades.py`: thêm migration additive.
- `backend/db/postgres_schema.py`: index/FK cho PostgreSQL.
- `backend/documents/package_document_policy.py`: ánh xạ trạng thái/phương thức
  sang loại tài liệu.
- `backend/documents/package_document_service.py`: lưu, thay, tải và xóa file.
- `backend/documents/package_document_routes.py`: bốn API tài liệu.
- `backend/app.py`: đăng ký route.
- `backend/http_middleware.py`: giới hạn body cho route upload.
- `backend/shared/access_policy.py`: thêm mapping bảng vào phân hệ `goithau` nếu
  cần.

### Frontend

- `frontend/packages/detail/PackageTabs.js`: thêm tab `documents`.
- `frontend/packages/GoiThauDetail.js`: render và bind tab.
- `frontend/packages/detail/PackageDocumentsPanel.js`: card upload/download.
- `frontend/shared/apiClient.js`: dùng helper request hiện có.
- CSS component hiện có; chỉ bổ sung style nhỏ nếu thật sự cần.

### Hạ tầng và test

- `.env.example` và `deploy/nginx-biddingflow.conf.example`: giới hạn upload.
- Test backend cho policy, API, quyền và file validation.
- Test frontend cho trạng thái card và quyền thao tác.

## 11. Trình tự triển khai

### Bước 1 — database và backend

- Thêm bảng/migration.
- Viết policy xác định slot theo trạng thái gói.
- Viết upload/download/delete service và route.
- Tích hợp quyền, giới hạn file và audit.

### Bước 2 — tab Tài liệu

- Thêm tab vào chi tiết gói thầu.
- Render slot do API trả về.
- Thêm chọn file, tiến trình, tải xuống, thay và xóa.
- Bảo đảm các file đã tải vẫn hiển thị khi gói chuyển bước.

### Bước 3 — kiểm thử và đóng gói

- Chạy test quyền truy cập chéo tổ chức.
- Chạy test trạng thái/phương thức lựa chọn.
- Chạy test upload file hợp lệ, file lỗi và vượt dung lượng.
- Kiểm tra backup/restore có chứa thư mục `goi-thau-documents`.
- Kiểm tra giao diện desktop, mobile và bàn phím.

## 12. Trường hợp kiểm thử bắt buộc

1. Gói `Chuẩn bị` hiển thị upload HSMT, không hiển thị báo cáo đánh giá.
2. Gói `Đang mời thầu` vẫn thấy HSMT đã tải nhưng không có upload báo cáo đánh
   giá.
3. Gói một túi hồ sơ ở `Đang chấm thầu` hiển thị đúng hai loại báo cáo.
4. Gói hai túi hồ sơ ở `Đang chấm thầu` hiển thị đúng bốn loại báo cáo.
5. Chuyển sang `Đã có kết quả` không làm mất các tài liệu đã tải.
6. Gói `Hủy thầu` chỉ cho xem/tải.
7. Người có quyền view không thể upload/thay/xóa.
8. Người không được phân công không thể xem hoặc đoán URL tải file.
9. Thay file thành công mới xóa file cũ; thay file lỗi vẫn tải được file cũ.
10. File sai định dạng, vượt 25 MiB hoặc có tên nguy hiểm bị từ chối.
11. Tài liệu của tổ chức A không thể được đọc từ tổ chức B.
12. Backup/restore giữ nguyên bản ghi và file.

## 13. Tiêu chí hoàn thành

- Có tab **Tài liệu** trong chi tiết mọi gói thầu.
- Tab liệt kê đúng các loại tài liệu từ bước trước đến bước hiện tại theo
  `trangThai` và `phuongThucLuaChon`, kể cả loại chưa đính kèm.
- Mỗi loại tài liệu chỉ giữ một file hiện hành.
- Upload, download, thay và xóa hoạt động đúng quyền.
- Tài liệu đã tải vẫn xem được sau khi gói chuyển bước.
- File được lưu ngoài web root, có giới hạn dung lượng và kiểm tra định dạng.
- Không có truy cập chéo tổ chức/gói thầu.
- File nằm trong backup/restore hiện có.
- Các test bắt buộc đều đạt.

## 14. Giả định cần chốt trước khi code

1. Chấp nhận quy tắc một file hiện hành cho mỗi loại; tải lại là thay file cũ.
2. Chấp nhận PDF, DOCX, XLSX và giới hạn 25 MiB/file.
3. Khi qua bước, tài liệu cũ chỉ xem/tải; không cho sửa, trừ khi sau này bổ sung
   quyền sửa sai cho manager.
4. Các gói hai túi hồ sơ hiển thị cùng lúc bốn loại báo cáo khi ở
   `Đang chấm thầu`, không khóa tuần tự từng báo cáo.
