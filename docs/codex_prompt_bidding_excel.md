Hãy nghiên cứu kỹ kiến trúc và code hiện tại trước khi thay đổi. Sau đó triển khai hoàn chỉnh chức năng:

# Tự động điền kết quả lựa chọn nhà thầu vào file Excel mẫu của muasamcong

## 1. Bối cảnh nghiệp vụ

Người dùng tải từ hệ thống muasamcong một file Excel chứa danh sách nhà thầu theo từng phần/lô.

Trong file:

- Các cột A đến F do hệ thống muasamcong tự trích xuất.
- Các cột G đến O phải được người dùng nhập kết quả lựa chọn nhà thầu.
- Ứng dụng BiddingFlow đã có hoặc đang lưu dữ liệu kết quả lựa chọn nhà thầu theo từng gói thầu, phần/lô và nhà thầu.
- Người dùng muốn tải file Excel mẫu lên BiddingFlow.
- BiddingFlow phải đối chiếu dữ liệu trong file với dữ liệu kết quả lựa chọn nhà thầu đang có trong ứng dụng.
- Hệ thống tự động điền các cột G đến O.
- Sau khi xử lý, hệ thống trả lại một file Excel mới để người dùng tải xuống.

File mẫu để phân tích:

`/mnt/data/35-ok(1).xlsx`

Không được giả định cấu trúc chỉ dựa trên mô tả. Hãy mở và kiểm tra trực tiếp workbook mẫu để xác định:

- Tên sheet.
- Dòng tiêu đề.
- Tên chính xác của các cột.
- Dòng bắt đầu dữ liệu.
- Định dạng dữ liệu.
- Data validation.
- Ô gộp.
- Công thức.
- Độ rộng cột.
- Chiều cao dòng.
- Sheet ẩn nếu có.
- Các thuộc tính workbook cần được bảo toàn.

## 2. Yêu cầu quan trọng nhất

Tuyệt đối không được thay đổi thứ tự dòng trong file mẫu.

Không được:

- Sort dữ liệu.
- Tạo lại bảng từ danh sách kết quả trong database.
- Thêm dòng.
- Xóa dòng.
- Di chuyển dòng.
- Gộp các dòng dữ liệu.
- Ghi đè các cột A đến F.
- Thay đổi tên sheet.
- Làm mất style, border, font, fill, alignment hoặc number format.
- Làm mất data validation.
- Làm mất merged cells.
- Làm mất công thức hoặc các nội dung không liên quan.
- Ghi đè file gốc.

Chương trình phải mở workbook gốc, duyệt từng dòng theo đúng thứ tự hiện có và chỉ ghi dữ liệu vào các ô thuộc cột G đến O của chính dòng đó.

Ví dụ:

```text
Dòng 2 → đối chiếu kết quả → ghi G2:O2
Dòng 3 → đối chiếu kết quả → ghi G3:O3
Dòng 4 → đối chiếu kết quả → ghi G4:O4
...
```

File đầu ra phải là một file mới.

## 3. Khóa đối chiếu dữ liệu

Ưu tiên đối chiếu từng dòng Excel với dữ liệu trong BiddingFlow bằng khóa:

```text
Mã phần/lô + Mã định danh nhà thầu
```

Khóa dự phòng:

```text
Mã phần/lô + Mã số thuế nhà thầu
```

Yêu cầu chuẩn hóa trước khi so sánh:

- Loại bỏ khoảng trắng thừa đầu và cuối.
- Chuyển giá trị số được Excel đọc dưới dạng số thực về chuỗi chuẩn khi cần.
- Không làm mất số 0 ở đầu mã.
- Chuẩn hóa mã số thuế nhưng không tự ý thay đổi nội dung nghiệp vụ.
- So sánh mã theo cách nhất quán.
- Xử lý giá trị rỗng an toàn.

Không được tự động đối chiếu chỉ dựa vào tên nhà thầu.

Tên nhà thầu chỉ được dùng để:

- Hiển thị cho người dùng.
- Hỗ trợ cảnh báo.
- Giúp người dùng xử lý thủ công khi không khớp.

Nếu khóa chính và khóa dự phòng cho ra hai kết quả khác nhau, phải coi đó là xung đột và không tự động điền.

## 4. Dữ liệu cần điền vào cột G đến O

Hãy đọc tên cột thực tế trong file mẫu và tạo mapping rõ ràng.

Mapping nghiệp vụ dự kiến:

- Cột G: Kết quả.
- Cột H: Giá sau sửa lỗi, hiệu chỉnh sai lệch hoặc giảm giá.
- Cột I: Điểm kỹ thuật.
- Cột J: Giá đánh giá.
- Cột K: Giá trúng thầu.
- Cột L: Lý do không đáp ứng hoặc lý do không trúng thầu.
- Cột M: Thời gian thực hiện gói thầu.
- Cột N: Thời gian thực hiện hợp đồng.
- Cột O: Nội dung khác.

Không hard-code chữ cái cột một cách mù quáng nếu có thể xác định cột bằng header. Tuy nhiên chỉ cho phép ghi vào phạm vi G–O của mẫu này.

Hãy kiểm tra dữ liệu và entity hiện có trong repository để xác định trường nguồn chính xác. Tận dụng model, service và lifecycle hiện có, không tạo một nguồn dữ liệu kết quả riêng bị trùng lặp.

## 5. Quy tắc điền dữ liệu

### Nhà thầu trúng thầu

- Điền trạng thái phù hợp vào cột Kết quả.
- Điền giá sau hiệu chỉnh hoặc giảm giá nếu có.
- Điền điểm kỹ thuật nếu phương pháp đánh giá có sử dụng.
- Điền giá đánh giá nếu phương pháp đánh giá có sử dụng.
- Điền giá trúng thầu.
- Để trống lý do không đáp ứng.
- Điền thời gian thực hiện theo dữ liệu được phê duyệt.
- Điền nội dung khác nếu có.

### Nhà thầu không trúng thầu

- Điền trạng thái phù hợp vào cột Kết quả.
- Không điền giá trúng thầu, trừ khi nghiệp vụ hiện tại của ứng dụng có quy định khác rõ ràng.
- Điền lý do không trúng hoặc không đáp ứng.
- Các trường điểm kỹ thuật, giá đánh giá và giá sau hiệu chỉnh chỉ điền khi dữ liệu thực tế tồn tại và phù hợp với quy trình đánh giá.

### Phần/lô bị hủy

- Điền trạng thái hủy phù hợp.
- Điền lý do hủy nếu dữ liệu có trong kết quả được phê duyệt.
- Không tự tạo giá trúng thầu.

### Giá sau hiệu chỉnh

Nếu không có sửa lỗi, hiệu chỉnh sai lệch hoặc giảm giá và quy tắc nghiệp vụ cho phép, có thể sử dụng giá dự thầu làm giá sau hiệu chỉnh.

Không tự suy luận nếu dữ liệu không đủ chắc chắn.

### Giá trị không áp dụng

Để trống ô, không ghi:

- `0`
- `N/A`
- `Không có`

trừ khi mẫu hoặc quy định nghiệp vụ yêu cầu rõ ràng.

### Số tiền

- Ghi dưới dạng số Excel, không ghi chuỗi có dấu phân cách hàng nghìn.
- Bảo toàn number format của ô mẫu.
- Không làm tròn ngoài quy tắc hiện có của ứng dụng.
- Không chuyển số tiền thành scientific notation.
- Xử lý `Decimal` an toàn, không dùng phép tính float gây sai số.

## 6. Gói thầu phần/lô

Dữ liệu phải được xử lý ở cấp:

```text
Gói thầu
  → Phần/lô
    → Nhà thầu tham dự
      → Kết quả lựa chọn nhà thầu
```

Không được lấy kết quả chung của toàn gói rồi áp dụng cho tất cả các lô.

Một nhà thầu có thể:

- Trúng lô này.
- Không trúng lô khác.
- Không được đánh giá tiếp ở một lô.
- Tham gia nhiều lô với giá và kết quả khác nhau.

Mỗi tổ hợp phần/lô và nhà thầu phải được xử lý độc lập.

## 7. Kiểm tra trước khi xuất

Trước khi sinh file đầu ra, backend phải tạo báo cáo đối chiếu gồm tối thiểu:

- Tổng số dòng dữ liệu trong file.
- Số dòng khớp chính xác.
- Số dòng khớp bằng khóa dự phòng.
- Số dòng không tìm thấy dữ liệu.
- Số dòng có nhiều kết quả trùng nhau.
- Số dòng xung đột giữa mã định danh và mã số thuế.
- Số dòng thiếu mã phần/lô.
- Số dòng thiếu thông tin định danh nhà thầu.
- Số dòng đã có dữ liệu G–O trong file đầu vào.
- Danh sách số dòng Excel có lỗi hoặc cảnh báo.

Không được âm thầm bỏ qua lỗi.

Thiết kế hai mức:

### Lỗi chặn xuất file

Ví dụ:

- Không tìm thấy sheet cần xử lý.
- Không tìm thấy header bắt buộc.
- File không phải workbook hợp lệ.
- Có khóa đối chiếu trùng làm kết quả không xác định.
- Dữ liệu phần/lô thuộc gói thầu khác.
- File vượt giới hạn kích thước.
- File có cấu trúc nguy hiểm hoặc không hợp lệ.

### Cảnh báo không chặn

Ví dụ:

- Một số dòng không tìm thấy kết quả.
- Một số trường kết quả chưa có dữ liệu.
- Ô G–O đã có dữ liệu và sắp bị ghi đè.
- Tên nhà thầu trong Excel khác tên trong database nhưng mã vẫn khớp.

Người dùng phải xem được kết quả kiểm tra trước khi xác nhận xuất file.

## 8. Giao diện người dùng

Tích hợp chức năng vào màn hình kết quả lựa chọn nhà thầu hiện có.

Luồng giao diện đề xuất:

```text
Kết quả lựa chọn nhà thầu
→ Xuất file nhập kết quả muasamcong
→ Chọn file Excel
→ Tải lên và kiểm tra
→ Hiển thị báo cáo đối chiếu
→ Người dùng xác nhận
→ Backend điền dữ liệu
→ Tải file Excel kết quả
```

Giao diện cần có:

- Nút chọn file `.xlsx`.
- Hiển thị tên file và kích thước.
- Trạng thái đang kiểm tra.
- Bảng tổng hợp đối chiếu.
- Danh sách lỗi theo số dòng Excel.
- Cảnh báo khi file đã có dữ liệu trong G–O.
- Nút xác nhận xuất file.
- Nút tải file kết quả.
- Thông báo lỗi rõ ràng bằng tiếng Việt.
- Kiểm tra quyền truy cập và quyền xuất dữ liệu theo cơ chế RBAC/entitlement hiện có.

Không thêm framework frontend mới. Tuân theo kiến trúc JavaScript, controller, view, modal, router và API client hiện tại.

## 9. Backend API

Hãy nghiên cứu các API import/export Excel và document job đã có trong repository để tái sử dụng kiến trúc phù hợp.

Có thể thiết kế hai endpoint hoặc một document job nhiều bước.

Ví dụ:

### Kiểm tra file

```http
POST /api/packages/{package_id}/award-result-excel/validate
Content-Type: multipart/form-data
```

Response dự kiến:

```json
{
  "validationToken": "...",
  "fileName": "...",
  "sheetName": "Danh sách nhà thầu",
  "totalRows": 39,
  "exactMatches": 35,
  "fallbackMatches": 2,
  "unmatchedRows": 1,
  "conflictRows": 1,
  "blockingErrors": [],
  "warnings": [],
  "rows": [
    {
      "excelRow": 2,
      "lotCode": "...",
      "bidderIdentifier": "...",
      "taxCode": "...",
      "bidderName": "...",
      "status": "matched",
      "matchMethod": "lot_code_and_bidder_identifier",
      "warnings": []
    }
  ]
}
```

### Tạo file kết quả

```http
POST /api/packages/{package_id}/award-result-excel/export
Content-Type: application/json
```

Request:

```json
{
  "validationToken": "..."
}
```

Response:

- Trả file trực tiếp; hoặc
- Trả document job và URL tải xuống theo kiến trúc hiện có.

Không tin dữ liệu kết quả do frontend gửi lên. Backend phải tự đọc lại dữ liệu kết quả từ database khi tạo file.

Validation token phải:

- Có thời hạn.
- Gắn với user.
- Gắn với organization/workspace.
- Gắn với package.
- Gắn với hash của file đầu vào.
- Không thể sử dụng cho file hoặc gói thầu khác.

Nếu kiến trúc document job hiện tại phù hợp hơn, hãy sử dụng document job thay vì tạo một cơ chế mới.

## 10. An toàn file Excel

Sử dụng thư viện hiện có trong dự án, ưu tiên `openpyxl`.

Cần:

- Giới hạn kích thước file.
- Chỉ chấp nhận `.xlsx`.
- Xác minh MIME và cấu trúc ZIP/Open XML, không chỉ dựa vào extension.
- Chống zip bomb.
- Chống path traversal trong archive.
- Không chạy macro.
- Không cho phép external link nguy hiểm nếu kiến trúc hiện tại đã có cơ chế làm sạch.
- Không sử dụng LibreOffice.
- Không chuyển workbook sang CSV.
- Không ghi file người dùng vào đường dẫn tùy ý.
- Dùng temporary directory hoặc document artifact storage theo cơ chế hiện có.
- Xóa file tạm theo lifecycle hiện có.
- Không ghi log nội dung nhạy cảm của toàn workbook.

Nếu repository đã có sandbox/parser/document worker, hãy tái sử dụng thay vì bỏ qua.

## 11. Bảo toàn workbook

Khi lưu file mới, cần kiểm tra rằng:

- Số sheet không thay đổi.
- Tên và thứ tự sheet không thay đổi.
- Số dòng không thay đổi.
- Thứ tự dòng không thay đổi.
- A–F không thay đổi.
- Chỉ G–O ở các dòng dữ liệu được phép thay đổi.
- Style của G–O được giữ nguyên.
- Merged cells được giữ nguyên.
- Data validations được giữ nguyên.
- Print area và page setup được giữ nguyên.
- Freeze panes được giữ nguyên.
- Hidden rows/columns và hidden sheets được giữ nguyên.
- Column width và row height được giữ nguyên.
- Workbook properties không bị thay đổi ngoài phần cần thiết.
- Công thức ngoài phạm vi ghi không bị thay đổi.

Hãy tạo một fingerprint cho từng dòng dựa trên giá trị A–F trước và sau xử lý, đồng thời viết test khẳng định fingerprint và vị trí dòng không thay đổi.

## 12. Tên file đầu ra

Tên file đầu ra nên theo dạng:

```text
<ten-file-goc-khong-co-duoi>_da_dien_ket_qua.xlsx
```

Ví dụ:

```text
35-ok(1)_da_dien_ket_qua.xlsx
```

Phải sanitize tên file trước khi trả về.

Response tải file phải có:

- `Content-Disposition` phù hợp.
- MIME type chính xác.
- Cache policy phù hợp với dữ liệu nhạy cảm.
- Không để lộ đường dẫn file nội bộ.

## 13. Quyền và multi-tenancy

Mọi thao tác phải:

- Xác thực session.
- Kiểm tra user có quyền truy cập gói thầu.
- Kiểm tra gói thầu thuộc đúng organization/workspace.
- Kiểm tra quyền xem kết quả lựa chọn nhà thầu.
- Kiểm tra entitlement xuất Excel nếu hệ thống đã có.
- Ngăn truy cập chéo tổ chức.
- Ghi audit/activity cho thao tác kiểm tra và xuất file.

Không dựa vào `package_id` do frontend gửi mà bỏ qua ownership validation.

## 14. Cấu trúc code

Trước khi code:

1. Đọc `backend/app.py`.
2. Đọc các module export/import Excel hiện có.
3. Đọc document job service và sandbox.
4. Đọc model/schema liên quan tới:
   - Gói thầu.
   - Phần/lô.
   - Nhà thầu.
   - Mở thầu.
   - Đánh giá.
   - Kết quả lựa chọn nhà thầu.
5. Đọc frontend controller/view của màn hình kết quả lựa chọn nhà thầu.
6. Đọc quy ước test hiện tại.
7. Đọc cơ chế RBAC, organization ownership, audit và artifact download.

Sau đó:

- Tạo service chuyên trách, không nhồi toàn bộ logic vào `backend/app.py`.
- Tách phần đọc workbook, đối chiếu dữ liệu, validate và ghi workbook.
- Dùng dataclass hoặc kiểu dữ liệu rõ ràng cho kết quả validation.
- Tránh truy vấn N+1.
- Tải toàn bộ dữ liệu cần thiết của gói thầu trong số lượng query hợp lý.
- Dùng `Decimal` cho tiền.
- Không lặp lại logic nghiệp vụ đã có.
- Không tạo bảng database mới nếu không thực sự cần thiết.
- Nếu cần lưu validation session, ưu tiên document job/artifact mechanism hoặc storage tạm có TTL hiện có.

## 15. Kiểm thử bắt buộc

Viết test đầy đủ, sử dụng workbook mẫu hoặc fixture được tạo từ cấu trúc của workbook mẫu.

### Unit tests

- Chuẩn hóa mã phần/lô.
- Chuẩn hóa mã định danh.
- Chuẩn hóa mã số thuế.
- Match bằng khóa chính.
- Match bằng khóa dự phòng.
- Không match tự động bằng tên.
- Phát hiện kết quả trùng.
- Phát hiện xung đột giữa hai loại khóa.
- Mapping trạng thái.
- Mapping giá và `Decimal`.
- Mapping trường rỗng.
- Quy tắc nhà thầu trúng.
- Quy tắc nhà thầu không trúng.
- Quy tắc lô bị hủy.

### Workbook tests

- Giữ nguyên thứ tự dòng.
- Giữ nguyên số dòng.
- Giữ nguyên A–F.
- Chỉ thay đổi G–O.
- Giữ nguyên sheet order.
- Giữ nguyên merged cells.
- Giữ nguyên style.
- Giữ nguyên number format.
- Giữ nguyên data validation.
- Giữ nguyên column width.
- Giữ nguyên row height.
- Giữ nguyên formula ngoài phạm vi cho phép.
- Không ghi đè file gốc.
- Tên file đầu ra chính xác.

### API tests

- Không đăng nhập.
- Không có quyền.
- Truy cập chéo organization.
- File sai định dạng.
- File quá lớn.
- Workbook thiếu sheet.
- Workbook thiếu header.
- File hợp lệ.
- Validation token hết hạn.
- Validation token thuộc user khác.
- Validation token thuộc package khác.
- File bị thay đổi sau validation.
- Export thành công.
- Audit được ghi.

### Integration tests

Tạo dữ liệu:

- Một gói thầu nhiều lô.
- Một nhà thầu trúng lô 1 nhưng không trúng lô 2.
- Một lô bị hủy.
- Một nhà thầu có điểm kỹ thuật nhưng không có giá đánh giá.
- Một nhà thầu có giá sau giảm giá.
- Một dòng không tìm thấy kết quả.

Sau đó kiểm tra file đầu ra đúng từng dòng.

### Frontend tests

- Chọn file.
- Hiển thị validation summary.
- Hiển thị số dòng lỗi.
- Không cho export khi có blocking error.
- Cho export khi chỉ có warning.
- Tải file thành công.
- Thông báo lỗi tiếng Việt.
- Không gửi dữ liệu kết quả nghiệp vụ từ frontend để backend tin trực tiếp.

## 16. Tiêu chí nghiệm thu

Chức năng chỉ được coi là hoàn thành khi:

1. Người dùng có thể chọn một gói thầu phần/lô đã có kết quả.
2. Người dùng tải lên file Excel mẫu của muasamcong.
3. Hệ thống đối chiếu từng dòng theo phần/lô và nhà thầu.
4. Người dùng xem được báo cáo đối chiếu trước khi xuất.
5. Hệ thống điền chính xác cột G–O.
6. Cột A–F không thay đổi.
7. Không có dòng nào đổi vị trí.
8. Không thêm hoặc xóa dòng.
9. Workbook giữ nguyên định dạng.
10. File đầu ra tải được và mở bình thường trong Microsoft Excel.
11. Không ghi đè file gốc.
12. Quyền và multi-tenancy được kiểm soát.
13. Có unit test, integration test và API test.
14. Các test hiện có của repository không bị hỏng.
15. Không thêm dependency không cần thiết.
16. Code tuân thủ style và kiến trúc hiện tại.

## 17. Quy trình thực hiện

Hãy thực hiện theo thứ tự:

1. Phân tích codebase và file Excel mẫu.
2. Viết bản tóm tắt ngắn về kiến trúc hiện tại liên quan tới chức năng.
3. Nêu kế hoạch thay đổi theo từng file/module.
4. Triển khai backend service.
5. Triển khai API.
6. Triển khai UI.
7. Viết test.
8. Chạy formatter, linter và test liên quan.
9. Sửa toàn bộ lỗi phát hiện được.
10. Kiểm tra thủ công file đầu ra bằng cách đọc lại workbook.
11. So sánh file đầu vào và đầu ra để chứng minh:
    - Row order không đổi.
    - A–F không đổi.
    - Chỉ G–O thay đổi.
12. Tổng kết kết quả.

Không dừng lại ở việc viết kế hoạch hoặc pseudocode. Hãy chỉnh sửa code thật và hoàn thành chức năng trong repository.

## 18. Báo cáo cuối cùng

Sau khi hoàn thành, trả về:

- Tóm tắt kiến trúc đã sử dụng.
- Danh sách file đã thêm hoặc sửa.
- Mô tả endpoint mới.
- Mô tả giao diện mới.
- Quy tắc mapping dữ liệu.
- Quy tắc xử lý lỗi và cảnh báo.
- Kết quả test đã chạy.
- Những test chưa chạy được và lý do.
- Ví dụ tên file đầu ra.
- Xác nhận bằng test rằng thứ tự dòng và A–F được giữ nguyên.
- Các giả định nghiệp vụ còn cần người dùng xác nhận.

Không tuyên bố test đã pass nếu chưa thực sự chạy.
