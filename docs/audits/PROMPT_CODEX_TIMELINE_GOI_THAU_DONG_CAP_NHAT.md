# PROMPT CHO CODEX — MỞ RỘNG TIMELINE GÓI THẦU THÀNH CHECKLIST ĐỘNG THEO NGHIỆP VỤ

## 1. Vai trò và mục tiêu

Bạn đang làm việc trên repository:

- https://github.com/newstar94/Bidding

Hãy nghiên cứu kỹ toàn bộ mã nguồn hiện tại trước khi sửa. Mục tiêu là mở rộng **timeline gói thầu** thành một checklist động, tự động xác định những mốc nào:

- áp dụng;
- chưa xác định có áp dụng hay không;
- không áp dụng;
- phát sinh nhiều lần theo dữ liệu thực tế.

Việc mở rộng phải:

1. Không làm hỏng bất kỳ chức năng hiện có nào.
2. Không thay đổi bố cục, phong cách hoặc trải nghiệm giao diện hiện tại ngoài những bổ sung cần thiết cho timeline.
3. Không tạo một hệ thống timeline song song.
4. Giữ tương thích dữ liệu cũ, offline/outbox, đồng bộ, xung đột, xuất Word và các kiểm thử hiện tại.
5. Không sửa đổi chính sách phân quyền hoặc cách ứng dụng đang xử lý dữ liệu nhạy cảm.
6. Không tự suy diễn thêm quy định pháp luật hoặc nghiệp vụ chưa có căn cứ trong dữ liệu và yêu cầu dưới đây.

File nghiệp vụ tham chiếu đã được cung cấp trước đây:

- `File gốc thông thường.xlsx`
- Sheet cần đối chiếu: `Check list` hoặc `Checklist`

Bảng trong Excel là **tập hợp tối đa các mốc có thể có**, không phải danh sách bắt buộc cho mọi gói thầu.

---

## 2. Việc bắt buộc phải làm trước khi chỉnh sửa

Trước khi viết code, hãy:

1. Đọc cấu trúc backend, frontend, database, IndexedDB, mutation outbox, sync mapper, row version, conflict handling, document worker và test.
2. Tìm toàn bộ phần liên quan đến timeline, bao gồm nhưng không giới hạn:
   - nơi khai báo danh sách mốc;
   - nơi lọc mốc theo dữ liệu gói thầu;
   - nơi lưu dữ liệu người dùng nhập cho từng mốc;
   - validation mã mốc;
   - API/sync mapper;
   - IndexedDB/local model;
   - xuất Word/Excel/PDF nếu có;
   - sao chép hoặc tạo phiên bản gói thầu;
   - tính tỷ lệ hoàn thành và cảnh báo quá hạn.
3. Kiểm tra kỹ các file hiện có, đặc biệt:
   - `frontend/packages/packageTimelineRows.js`;
   - `backend/documents/timeline_context_service.py`;
   - các file validation, model, schema, migration và test liên quan.
4. Xác nhận tên field và mã giá trị thực tế đang dùng cho:
   - hình thức lựa chọn nhà thầu;
   - phương thức lựa chọn;
   - loại/lĩnh vực gói thầu;
   - kiểu phê duyệt kế hoạch;
   - yêu cầu thẩm định E-HSMT;
   - tư vấn lập;
   - tư vấn thẩm;
   - tổ chuyên gia;
   - tổ thẩm định;
   - điều chỉnh E-HSMT;
   - làm rõ;
   - gia hạn;
   - vòng đánh giá;
   - phiên bản gói thầu.
5. Không dựa vào chuỗi tiếng Việt hiển thị nếu hệ thống đã có mã chuẩn. Nếu chưa có mã chuẩn, bổ sung mã chuẩn theo hướng tương thích ngược.

Hãy lập một bản đồ tác động ngắn trước khi sửa, nhưng sau đó phải trực tiếp triển khai đầy đủ, không chỉ dừng ở phân tích hoặc đề xuất.

---

## 3. Nguyên tắc nghiệp vụ tổng quát

Timeline phải được xác định theo ba trạng thái áp dụng:

```text
APPLICABLE
CONDITIONAL
NOT_APPLICABLE
```

Ý nghĩa:

### `APPLICABLE`

Mốc chắc chắn áp dụng cho gói thầu.

- Hiển thị bình thường.
- Được nhập dữ liệu.
- Được tính vào tiến độ.
- Có thể cảnh báo quá hạn.
- Được xuất ra tài liệu.

### `CONDITIONAL`

Chưa đủ dữ liệu để xác định mốc có áp dụng hay không.

- Vẫn hiển thị trên timeline làm việc.
- Hiển thị nhẹ hơn bằng đúng design system hiện có.
- Có nhãn: `Chưa xác định` hoặc `Dự kiến – Chưa xác định`.
- Không bắt buộc nhập số/ngày.
- Không tính vào tỷ lệ hoàn thành.
- Không cảnh báo quá hạn.
- Không tính là hồ sơ còn thiếu.
- Không đưa vào timeline chính thức khi xuất Word/Excel/PDF, trừ khi ứng dụng có chế độ xuất bản nháp và người dùng chủ động chọn bao gồm mốc dự kiến.
- Khi đủ dữ liệu, tự chuyển thành `APPLICABLE` hoặc `NOT_APPLICABLE`.

### `NOT_APPLICABLE`

Mốc không áp dụng.

- Bỏ hoàn toàn khỏi timeline hiệu lực.
- Không hiển thị trong danh sách thông thường.
- Không tính vào tiến độ.
- Không cảnh báo.
- Không xuất tài liệu.
- Không xóa vật lý dữ liệu cũ của mốc nếu trước đây người dùng đã nhập.
- Nếu điều kiện thay đổi và mốc áp dụng trở lại thì phải khôi phục dữ liệu cũ.

Cần có một tùy chọn quản trị/kỹ thuật hoặc chế độ debug phù hợp để kiểm tra các mốc đang bị ẩn, nhưng không làm rối giao diện người dùng thông thường.

---

## 4. Quy tắc bắt buộc: thẩm định E-HSMT có ba trạng thái

Không được dùng mô hình chỉ có boolean `Có/Không`.

Dùng mã chuẩn tương đương:

```text
UNDETERMINED
REQUIRED
NOT_REQUIRED
```

Có thể giữ tên field hiện tại nếu cần tương thích, nhưng phải hỗ trợ đủ ba trạng thái.

### 4.1. Khi chưa xác định

Nếu gói thầu đang trong giai đoạn chuẩn bị và chưa xác định có cần thẩm định E-HSMT hay không:

- Dòng `Báo cáo thẩm định E-HSMT` phải ở trạng thái `CONDITIONAL`.
- Hiển thị nhãn:
  - `Chưa xác định`; hoặc
  - `Dự kiến – chờ xác định yêu cầu thẩm định`.
- Không yêu cầu nhập số/ngày.
- Không tính tiến độ.
- Không cảnh báo quá hạn.
- Không đưa vào bản timeline chính thức khi xuất tài liệu.

### 4.2. Khi xác định có thẩm định

Nếu giá trị là `REQUIRED`:

- Dòng chuyển thành `APPLICABLE`.
- Cho phép nhập và tự lấy dữ liệu như hiện tại.
- Tính vào tiến độ.
- Có deadline/cảnh báo nếu timeline hiện tại hỗ trợ.
- Được xuất tài liệu.

### 4.3. Khi xác định không thẩm định

Nếu giá trị là `NOT_REQUIRED`:

- Dòng chuyển thành `NOT_APPLICABLE`.
- Bị loại hoàn toàn khỏi timeline hiệu lực và tài liệu xuất.

### 4.4. Tự suy luận từ dữ liệu

Nếu tồn tại một trong các dữ liệu chắc chắn sau thì hệ thống có thể tự chuyển sang `REQUIRED` hoặc đề nghị người dùng xác nhận:

- yêu cầu thẩm định E-HSMT;
- ngày gửi hồ sơ thẩm định;
- tổ/đơn vị thẩm định;
- số hoặc ngày báo cáo thẩm định;
- tài liệu báo cáo thẩm định được tải lên;
- một bản ghi nghiệp vụ thẩm định liên quan.

Không được âm thầm ghi đè lựa chọn rõ ràng của người dùng. Nếu đang là `NOT_REQUIRED` nhưng xuất hiện dữ liệu thẩm định, hiển thị cảnh báo xung đột nghiệp vụ và cho phép người dùng xác nhận chuyển sang `REQUIRED`.

### 4.5. Thời điểm phải xác định dứt điểm

Không ép người dùng lựa chọn ngay khi tạo gói thầu.

Tuy nhiên, trước khi hoàn thành mốc `QĐ phê duyệt E-HSMT`, nếu vẫn là `UNDETERMINED`, hệ thống phải yêu cầu xác nhận:

```text
Gói thầu có thực hiện thẩm định E-HSMT không?
- Có
- Không
```

Không cho hoàn tất bước phê duyệt E-HSMT khi trạng thái vẫn chưa xác định, trừ khi nghiệp vụ hiện tại có một ngoại lệ rõ ràng và đã được mã hóa.

---

## 5. Quy tắc bắt buộc: chào hàng cạnh tranh

Nếu hình thức lựa chọn là `Chào hàng cạnh tranh`:

- Tự động loại hoàn toàn các dòng timeline về thẩm định không áp dụng cho hình thức này.
- Không hiển thị chúng ở trạng thái `CONDITIONAL`.
- Không yêu cầu người dùng tự xóa hoặc đánh dấu “Không áp dụng”.
- Không tính tiến độ.
- Không cảnh báo.
- Không xuất tài liệu.

Không hard-code bằng cách so sánh tên từng dòng ở nhiều nơi.

Hãy gắn các mốc thẩm định vào một nhóm/tag nghiệp vụ ổn định, ví dụ:

```text
APPRAISAL
E_HSMT_APPRAISAL
TECHNICAL_RESULT_APPRAISAL
CONTRACTOR_SELECTION_RESULT_APPRAISAL
```

Rule engine quyết định theo tag và dữ liệu gói thầu.

Nếu mã nguồn hiện tại đã loại một phần các dòng thẩm định cho chào hàng cạnh tranh, phải giữ đúng hành vi đó và mở rộng thành quy tắc đầy đủ, không tạo logic trùng lặp.

---

## 6. Quy tắc bắt buộc: dự toán và kế hoạch lựa chọn nhà thầu

### 6.1. Phê duyệt riêng

Nếu kiểu phê duyệt là `Kế hoạch` hoặc tương đương với việc lập riêng dự toán và kế hoạch:

Hiển thị các dòng riêng:

- Tờ trình dự toán.
- QĐ phê duyệt dự toán.
- Tờ trình kế hoạch.
- QĐ phê duyệt kế hoạch.

Loại các dòng gộp:

- Tờ trình dự toán + kế hoạch.
- QĐ phê duyệt dự toán + kế hoạch.

### 6.2. Phê duyệt gộp

Nếu kiểu phê duyệt là `Dự toán và kế hoạch`:

Hiển thị:

- Tờ trình dự toán + kế hoạch.
- QĐ phê duyệt dự toán + kế hoạch.

Loại hoàn toàn các dòng riêng:

- Tờ trình dự toán.
- QĐ phê duyệt dự toán.
- Tờ trình kế hoạch.
- QĐ phê duyệt kế hoạch.

Khi người dùng thay đổi kiểu phê duyệt:

- Tính lại timeline ngay.
- Không tạo dòng trùng.
- Không xóa dữ liệu cũ.
- Nếu đổi ngược lại, khôi phục đúng dữ liệu đã nhập.
- UI và tài liệu xuất phải giống nhau.

---

## 7. Các quy tắc theo tính chất gói thầu

Các dòng có ghi chú “Nếu có” trong file Excel không được mặc định hiển thị đầy đủ cho mọi gói.

Hãy xây dựng rule engine để mốc được xác định từ dữ liệu thực tế, bao gồm tối thiểu:

- hình thức lựa chọn;
- phương thức lựa chọn;
- loại/lĩnh vực gói thầu;
- cách phê duyệt kế hoạch;
- có thuê tư vấn lập hay thực hiện nội bộ;
- có thuê tư vấn thẩm hay thực hiện nội bộ;
- có tổ chuyên gia;
- có tổ thẩm định;
- có tách bước kỹ thuật và tài chính;
- có điều chỉnh E-HSMT;
- có làm rõ;
- có gia hạn;
- có vòng đánh giá bổ sung;
- có hủy thầu hoặc tổ chức lại;
- dữ liệu nghiệp vụ thực tế đã phát sinh.

Chỉ triển khai những quy tắc có thể xác định chắc chắn từ:

1. dữ liệu và logic đang có trong repository;
2. bảng Checklist;
3. yêu cầu trong prompt này.

Không tự sáng tạo thêm điều kiện pháp lý.

### 7.1. Một giai đoạn một túi hồ sơ — 1G1T

Phải có rule riêng cho mã phương thức `ONE_STAGE_ONE_ENVELOPE` hoặc mã tương đương đang dùng trong repository.

Đối với gói 1G1T:

- Chỉ giữ các mốc thuộc quy trình nộp, mở và đánh giá một bộ E-HSDT/E-HSĐX thống nhất.
- Không hiển thị các mốc chỉ dành cho việc tách kỹ thuật và tài chính, bao gồm tối thiểu:
  - báo cáo hoặc quyết định phê duyệt danh sách nhà thầu đạt kỹ thuật;
  - thông báo nhà thầu đạt kỹ thuật nếu đây là bước chỉ có ở 1G2T;
  - biên bản mở hồ sơ đề xuất tài chính riêng;
  - báo cáo đánh giá E-HSĐXTC riêng;
  - các mốc phê duyệt kỹ thuật riêng trước khi mở tài chính.
- Không được giữ các dòng trên dưới trạng thái `CONDITIONAL`; phải đánh giá là `NOT_APPLICABLE`.
- Các mốc đánh giá hợp lệ, năng lực/kinh nghiệm, kỹ thuật và tài chính vẫn có thể tồn tại dưới dạng nội dung của quá trình đánh giá chung nếu mô hình dữ liệu hiện tại quản lý chúng, nhưng không được biến thành các bước mở/phê duyệt tài chính riêng của 1G2T.
- UI, tính tiến độ và tài liệu xuất phải cùng áp dụng quy tắc này.

### 7.2. Một giai đoạn hai túi hồ sơ — 1G2T

Phải có rule riêng cho mã phương thức `ONE_STAGE_TWO_ENVELOPES` hoặc mã tương đương đang dùng trong repository.

Đối với gói 1G2T, timeline phải thể hiện rõ chuỗi bước tách biệt:

1. Đóng thầu/mở hồ sơ đề xuất kỹ thuật.
2. Đánh giá hồ sơ đề xuất kỹ thuật.
3. Báo cáo kết quả đánh giá kỹ thuật.
4. Thẩm định kết quả kỹ thuật nếu thuộc trường hợp áp dụng.
5. Quyết định phê duyệt danh sách nhà thầu đạt kỹ thuật.
6. Thông báo/mời nhà thầu đạt kỹ thuật tham dự mở tài chính nếu dữ liệu hiện tại có bước này.
7. Mở hồ sơ đề xuất tài chính.
8. Đánh giá hồ sơ đề xuất tài chính.
9. Các bước tổng hợp, xếp hạng, thương thảo và phê duyệt kết quả theo dữ liệu hiện có.

Yêu cầu:

- Chỉ hiển thị các mốc kỹ thuật–tài chính riêng khi phương thức thực tế là 1G2T.
- Trạng thái thẩm định kết quả kỹ thuật vẫn tuân theo rule `APPLICABLE/CONDITIONAL/NOT_APPLICABLE`, không mặc định bắt buộc cho mọi gói.
- Không gộp biên bản mở kỹ thuật và biên bản mở tài chính thành một dòng.
- Không để việc đổi từ 1G2T sang 1G1T làm mất dữ liệu cũ; các mốc không còn áp dụng chỉ bị ẩn.
- Nếu đổi ngược lại, khôi phục các dữ liệu đã nhập trước đó.

### 7.3. Chỉ định thầu

Phải có nhánh rule riêng cho hình thức `DIRECT_APPOINTMENT` hoặc mã tương đương. Không được dùng timeline của đấu thầu rộng rãi/chào hàng cạnh tranh rồi yêu cầu người dùng tự xóa.

Trước hết phải xác định repository đang phân biệt các trường hợp nào, tối thiểu kiểm tra:

- chỉ định thầu thông thường;
- chỉ định thầu rút gọn;
- chỉ định thầu theo quy trình hoặc trường hợp riêng đã được ứng dụng hỗ trợ.

Đối với từng trường hợp:

- Chỉ hiển thị các mốc thực sự có trong quy trình tương ứng.
- Loại các mốc đấu thầu cạnh tranh không phát sinh, chẳng hạn các bước đăng tải/mở thầu/đánh giá tách túi, nếu dữ liệu và quy trình hiện tại không áp dụng.
- Sử dụng đúng loại hồ sơ đang được ứng dụng quản lý, ví dụ hồ sơ yêu cầu/hồ sơ đề xuất thay vì ép dùng tên E-HSMT/E-HSDT nếu nghiệp vụ hiện tại phân biệt.
- Các mốc thương thảo, hoàn thiện hợp đồng, phê duyệt kết quả, thông báo kết quả và ký hợp đồng chỉ xuất hiện theo dữ liệu/quy trình thực tế.
- Với quy trình rút gọn, loại các mốc của quy trình thông thường không tồn tại; không để dưới trạng thái `CONDITIONAL`.
- Không tự suy diễn quy trình pháp lý mới. Phải đối chiếu field, workflow, template tài liệu và dữ liệu hiện có trong repository cùng sheet Checklist.
- Nếu repository chưa có field phân biệt thông thường/rút gọn, bổ sung mã chuẩn tương thích ngược trước khi áp dụng rule.

### 7.4. Lựa chọn nhà thầu trong trường hợp đặc biệt

Phải có nhánh rule riêng cho hình thức `SPECIAL_SELECTION` hoặc mã tương đương.

Không được mặc định áp dụng toàn bộ timeline của đấu thầu rộng rãi, chào hàng cạnh tranh hoặc chỉ định thầu.

Do quy trình đặc biệt có thể được phê duyệt theo phương án riêng:

- Timeline cơ sở chỉ hiển thị các mốc chung chắc chắn áp dụng theo dữ liệu hiện có.
- Các mốc đặc thù phải được sinh từ:
  - phương án/quy trình lựa chọn đặc biệt đã được phê duyệt;
  - loại tài liệu hoặc quyết định thực tế;
  - các entity nghiệp vụ đã phát sinh;
  - cấu hình milestone đặc thù của gói nếu ứng dụng có hỗ trợ.
- Cho phép bổ sung milestone đặc thù bằng catalog/rule cấu hình, nhưng vẫn phải dùng `milestoneKey`, `instanceKey`, row version, outbox, sync và export chung.
- Không cho phép người dùng sửa tự do tiêu đề để thay thế định danh nghiệp vụ; milestone tùy biến phải có khóa ổn định và audit.
- Các dòng tiêu chuẩn không chắc chắn phải ở `CONDITIONAL` hoặc `NOT_APPLICABLE` theo dữ liệu, không mặc định là `APPLICABLE`.
- Khi phương án đặc biệt được cập nhật, effective timeline phải tính lại nhưng không xóa dữ liệu cũ.
- Tài liệu xuất phải phản ánh đúng timeline đã được xác định/phê duyệt cho gói đó.

### 7.5. Tư vấn lập và tư vấn thẩm

Nhóm tư vấn lập/tư vấn thẩm phải căn cứ vào dữ liệu thực tế:

- có thuê tư vấn hay không;
- có hợp đồng tư vấn;
- có quyết định chỉ định;
- có nghiệm thu/thanh toán/thanh lý;
- thực hiện nội bộ hay thuê ngoài.

Nếu không thuê tư vấn:

- Không hiển thị các dòng hợp đồng, thanh toán, thanh lý và thủ tục lựa chọn tư vấn tương ứng.
- Vẫn có thể hiển thị các mốc của tổ nội bộ nếu có dữ liệu tổ nội bộ.

---

## 8. Điều chỉnh E-HSMT

Sau mốc:

```text
QĐ phê duyệt E-HSMT
```

phải tự sinh thêm:

```text
QĐ phê duyệt điều chỉnh E-HSMT
```

khi gói thầu có dữ liệu điều chỉnh.

### 8.1. Hỗ trợ nhiều lần điều chỉnh

Không dùng một bộ field đơn lẻ làm lần điều chỉnh sau ghi đè lần trước.

Dữ liệu cần có dạng danh sách hoặc entity riêng, tương đương:

```text
ehsmtAdjustments[]
- id
- packageId
- sequence
- reason
- submissionNumber
- submissionDate
- appraisalReportNumber
- appraisalReportDate
- approvalDecisionNumber
- approvalDecisionDate
- publishedAt
- createdBy
- createdAt
- updatedBy
- updatedAt
- rowVersion
```

Hãy tái sử dụng entity hiện có nếu repository đã có cấu trúc tương đương.

### 8.2. Dòng timeline động

Mỗi lần điều chỉnh tạo một instance riêng:

```text
QĐ phê duyệt điều chỉnh E-HSMT lần 1
QĐ phê duyệt điều chỉnh E-HSMT lần 2
...
```

Các dòng phải:

- nằm ngay sau mốc phê duyệt E-HSMT hoặc đúng vị trí nghiệp vụ;
- sắp xếp theo `sequence`, ngày quyết định hoặc thứ tự tạo có kiểm soát;
- lấy số/ngày quyết định từ dữ liệu điều chỉnh;
- có liên kết đến bản ghi điều chỉnh nếu UI hiện tại có cơ chế mở chi tiết;
- không bị trùng sau khi offline retry hoặc sync lại;
- không ghi đè dữ liệu các lần khác.

Nếu một lần điều chỉnh bị hủy/xóa:

- chỉ instance tương ứng biến mất khỏi effective timeline;
- không ảnh hưởng các lần còn lại;
- tuân thủ tombstone và quy tắc xóa hiện tại.

---

## 9. Các mốc phát sinh động khác

Thiết kế phải đủ mở rộng để tự sinh dòng khi dữ liệu tương ứng tồn tại, tối thiểu hỗ trợ kiến trúc cho:

- yêu cầu làm rõ E-HSMT;
- văn bản trả lời/làm rõ E-HSMT;
- gia hạn thời điểm đóng thầu;
- sửa đổi/điều chỉnh E-HSMT;
- hủy thầu;
- tổ chức lựa chọn lại;
- vòng đánh giá bổ sung;
- quyết định điều chỉnh kết quả nếu repository đã có nghiệp vụ này.

Không bắt buộc phải xây mới toàn bộ nghiệp vụ chưa tồn tại. Tuy nhiên, rule engine và data model timeline phải hỗ trợ milestone lặp lại theo entity thực tế mà không cần thay đổi kiến trúc lần nữa.

---

## 10. Kiến trúc bắt buộc

### 10.1. Không để frontend và backend có hai bộ quy tắc độc lập

Hiện tại logic timeline có dấu hiệu bị lặp giữa frontend và backend xuất tài liệu.

Phải tạo một nguồn quy tắc chuẩn duy nhất hoặc một cơ chế sinh tự động, ví dụ:

```text
shared/timeline_rules.json
```

hoặc cấu trúc tương đương.

Mỗi milestone định nghĩa tối thiểu:

```text
milestoneKey
sectionKey
title
issuer
source
tags
applicabilityRule
repeatable
sortAnchor
templateVersion
legacyCodes
```

Có thể dùng:

- catalog declarative dùng chung;
- tập predicate chuẩn;
- evaluator riêng cho JavaScript và Python.

Nhưng phải có **golden/parity tests** chứng minh cùng một fixture dữ liệu thì frontend và backend trả về cùng:

- milestone key;
- applicability state;
- thứ tự;
- số lượng;
- tiêu đề;
- instance động.

Không chấp nhận việc sửa rule ở frontend nhưng quên backend hoặc ngược lại.

### 10.2. Tách định danh ổn định khỏi số thứ tự hiển thị

Không dùng mã như `4.3`, `5.10` làm cả khóa dữ liệu và số hiển thị.

Dùng cấu trúc tương đương:

```text
milestoneKey: E_HSMT_ADJUSTMENT_APPROVAL
instanceKey: <adjustment-id>
displayCode: 4.4
```

Trong đó:

- `milestoneKey` ổn định.
- `instanceKey` phân biệt các dòng lặp.
- `displayCode` được tính sau khi áp dụng rule và sắp xếp.
- Thay đổi số thứ tự hiển thị không được làm mất dữ liệu.

Dữ liệu cũ đang lưu theo `maMoc` phải có mapping/migration tương thích.

### 10.3. Effective timeline

Tạo một hàm/service thuần, dễ test, tương đương:

```text
buildEffectiveTimeline(packageData, relatedEntities, savedEntries)
```

Kết quả mỗi dòng nên có tối thiểu:

```text
milestoneKey
instanceKey
displayCode
title
sectionKey
applicability
applicabilityReason
status
source
sourceEntityId
savedEntry
isRepeatable
sortOrder
```

Hàm này phải:

- không mutate input;
- deterministic;
- có unit test đầy đủ;
- được sử dụng bởi UI, progress calculation và export;
- bảo toàn dữ liệu saved entries của mốc bị ẩn.

### 10.4. Rule priority

Áp dụng thứ tự ưu tiên rõ ràng:

1. Quy tắc chắc chắn loại trừ theo loại/hình thức/phương thức.
2. Dữ liệu nghiệp vụ thực tế đã phát sinh.
3. Lựa chọn rõ ràng của người dùng.
4. Trạng thái chưa xác định.
5. Mặc định an toàn.

Mỗi dòng nên có `applicabilityReason` để phục vụ debug và test, ví dụ:

```text
EXCLUDED_BY_COMPETITIVE_OFFERING
WAITING_FOR_E_HSMT_APPRAISAL_DECISION
INCLUDED_BY_ADJUSTMENT_RECORD
EXCLUDED_BY_COMBINED_PLAN
```

Không cần hiển thị mã kỹ thuật này cho người dùng thông thường.

---

## 11. Giao diện

Phải giữ nguyên design system và cấu trúc giao diện hiện tại.

### 11.1. Mốc `CONDITIONAL`

Hiển thị:

- kiểu chữ/màu nền nhẹ hơn;
- badge `Chưa xác định`;
- tooltip hoặc mô tả ngắn về dữ liệu còn thiếu;
- không dùng màu lỗi hoặc cảnh báo quá hạn;
- không làm thay đổi chiều rộng bảng bất hợp lý;
- vẫn dùng keyboard/focus/ARIA theo component hiện có.

### 11.2. Mốc bị loại

Không hiển thị trong bảng timeline thông thường.

Không thêm hàng “Không áp dụng” hàng loạt vì sẽ làm timeline dài và khó sử dụng.

### 11.3. Phản hồi khi dữ liệu thay đổi

Khi người dùng thay đổi dữ liệu làm thay đổi timeline:

- cập nhật ngay danh sách effective timeline;
- giữ vị trí cuộn/focus nếu có thể;
- không tải lại toàn trang;
- thông báo ngắn, không gây gián đoạn;
- không mất dữ liệu người dùng đang nhập;
- nếu có mâu thuẫn nghiệp vụ thì hiển thị dialog xác nhận theo component hiện có.

### 11.4. Tỷ lệ hoàn thành

Chỉ tính các dòng `APPLICABLE`.

Không tính:

- `CONDITIONAL`;
- `NOT_APPLICABLE`;
- section header;
- dòng chỉ mang tính mô tả.

---

## 12. Backend, database, offline và sync

Mọi entity/field mới phải đi đầy đủ qua:

```text
PostgreSQL
→ backend model/repository
→ API/sync mapper
→ validation
→ row_version
→ conflict handling
→ local model
→ IndexedDB
→ mutation outbox
→ retry/idempotency
→ UI
→ export
```

### 12.1. Migration

- Chỉ thêm migration mới.
- Không sửa migration đã phát hành.
- Tương thích database cũ.
- Giá trị cũ của field thẩm định phải được map:
  - `true`/`Có` → `REQUIRED`;
  - `false`/`Không` → `NOT_REQUIRED`;
  - `null`, rỗng hoặc chưa có → `UNDETERMINED`.
- Không làm mất dữ liệu timeline cũ.
- Tăng `TIMELINE_TEMPLATE_VERSION` nếu repository đang dùng version.
- Có migration/normalization cho saved entries đang khóa theo mã mốc cũ.

### 12.2. Idempotency

Dòng timeline động phải có khóa ổn định từ:

```text
milestoneKey + sourceEntityId
```

hoặc tương đương.

Offline retry, outbox replay và delta sync không được tạo dòng trùng.

### 12.3. Conflict

Nếu có xung đột khi sửa điều chỉnh E-HSMT hoặc timeline entry:

- dùng cơ chế row version hiện tại;
- không tự ghi đè;
- không để stale client phục sinh bản ghi đã xóa;
- giữ đúng tombstone policy hiện tại.

---

## 13. Xuất Word/Excel/PDF

Timeline trên giao diện và tài liệu xuất phải sử dụng cùng effective timeline.

Bản xuất chính thức:

- chỉ chứa dòng `APPLICABLE`;
- không chứa dòng `CONDITIONAL`;
- không chứa dòng `NOT_APPLICABLE`;
- giữ đúng section và thứ tự sau khi lọc;
- đánh lại STT/display code theo quy tắc hiển thị;
- hỗ trợ nhiều lần điều chỉnh E-HSMT;
- không tạo khoảng trống do dòng bị ẩn;
- số liệu và nội dung phải giống giao diện tại cùng một thời điểm dữ liệu.

Nếu có nhiều backend exporter, phải cập nhật tất cả hoặc gom về cùng một timeline context service.

---

## 14. Kiểm thử bắt buộc

Phải bổ sung unit, integration và E2E phù hợp. Không chỉ kiểm thử happy path.

### 14.1. Ba trạng thái thẩm định E-HSMT

1. Gói mới chưa xác định:
   - dòng thẩm định hiển thị `CONDITIONAL`;
   - không tính tiến độ;
   - không cảnh báo;
   - không xuất bản chính thức.
2. Chuyển sang `REQUIRED`:
   - dòng thành `APPLICABLE`;
   - dữ liệu được nhập/lấy tự động;
   - được tính tiến độ và xuất.
3. Chuyển sang `NOT_REQUIRED`:
   - dòng bị loại hoàn toàn.
4. Đổi từ `REQUIRED` sang `NOT_REQUIRED` rồi đổi lại:
   - dữ liệu cũ được khôi phục.
5. Trước khi hoàn thành phê duyệt E-HSMT mà vẫn `UNDETERMINED`:
   - hệ thống yêu cầu xác nhận.

### 14.2. Chào hàng cạnh tranh

1. Không còn bất kỳ dòng thẩm định không áp dụng nào.
2. Không có mốc thẩm định `CONDITIONAL`.
3. Không tính tiến độ.
4. Không xuất Word/Excel/PDF.
5. Đổi từ hình thức khác sang chào hàng cạnh tranh:
   - dòng biến mất;
   - dữ liệu cũ không bị xóa.
6. Đổi ngược lại:
   - dòng được khôi phục đúng.

### 14.3. Dự toán và kế hoạch

1. Kế hoạch riêng chỉ có các dòng riêng.
2. Kế hoạch gộp chỉ có các dòng gộp.
3. Chuyển qua lại không tạo trùng.
4. Dữ liệu cũ được bảo toàn.
5. UI và export giống nhau.

### 14.4. Phương thức 1G1T và 1G2T

1. Gói 1G1T không có:
   - phê duyệt danh sách nhà thầu đạt kỹ thuật riêng;
   - biên bản mở tài chính riêng;
   - báo cáo đánh giá E-HSĐXTC riêng.
2. Gói 1G2T có đúng thứ tự:
   - mở kỹ thuật;
   - đánh giá kỹ thuật;
   - phê duyệt nhà thầu đạt kỹ thuật;
   - mở tài chính;
   - đánh giá tài chính.
3. Các mốc thẩm định kỹ thuật chỉ xuất hiện theo rule áp dụng, không mặc định cho mọi gói 1G2T.
4. Chuyển 1G2T sang 1G1T chỉ ẩn mốc, không mất dữ liệu.
5. Chuyển ngược lại khôi phục dữ liệu cũ.
6. Progress và export được tính đúng ở cả hai phương thức.

### 14.5. Chỉ định thầu

1. Chỉ định thầu không sử dụng nguyên timeline đấu thầu cạnh tranh.
2. Quy trình thông thường và rút gọn cho effective timeline khác nhau đúng theo dữ liệu.
3. Các mốc không áp dụng bị loại, không chuyển thành `CONDITIONAL` hàng loạt.
4. Tên loại hồ sơ đúng với model nghiệp vụ hiện tại.
5. Chuyển loại quy trình không làm mất dữ liệu.
6. UI, progress và export có cùng danh sách mốc.

### 14.6. Lựa chọn nhà thầu trong trường hợp đặc biệt

1. Không tự động áp dụng toàn bộ milestone tiêu chuẩn.
2. Milestone chung và milestone đặc thù được sinh đúng theo phương án/dữ liệu của gói.
3. Milestone đặc thù có khóa ổn định, audit và hỗ trợ sync.
4. Cập nhật phương án đặc biệt tính lại timeline nhưng không xóa dữ liệu.
5. UI và tài liệu xuất có cùng effective timeline.

### 14.7. Điều chỉnh E-HSMT

1. Không có điều chỉnh: không có dòng động.
2. Một điều chỉnh: có đúng một dòng.
3. Hai điều chỉnh: có hai dòng đúng thứ tự.
4. Cập nhật số/ngày quyết định: dòng cập nhật đúng.
5. Xóa/hủy một lần: chỉ dòng đó biến mất.
6. Offline tạo điều chỉnh rồi sync: không trùng.
7. Retry outbox: không trùng.
8. Conflict row version: xử lý đúng.
9. UI và export có cùng số dòng/nội dung.

### 14.8. Parity frontend/backend

Tạo một bộ fixture chung gồm nhiều tổ hợp:

- chào hàng cạnh tranh;
- đấu thầu rộng rãi;
- kế hoạch riêng;
- kế hoạch gộp;
- một túi;
- hai túi;
- thẩm định chưa xác định/có/không;
- có/không tư vấn;
- một/nhiều điều chỉnh.

Với mỗi fixture, frontend và backend phải cho cùng effective timeline.

### 14.9. Hồi quy

Chạy toàn bộ test hiện có:

- Python;
- JavaScript;
- database/migration;
- sync/offline;
- document export;
- E2E nếu môi trường cho phép.

Không được bỏ qua test lỗi bằng cách xóa, skip hoặc hạ assertion nếu chưa chứng minh test cũ sai.

---

## 15. Tiêu chí chấp nhận

Chỉ coi công việc hoàn thành khi đáp ứng tất cả:

1. Timeline được suy ra tự động từ dữ liệu gói thầu.
2. Người dùng không phải tự xóa các dòng không áp dụng.
3. Có đủ ba trạng thái áp dụng.
4. Trường hợp chưa xác định thẩm định E-HSMT hiển thị đúng dạng dự kiến.
5. Chào hàng cạnh tranh loại đúng các dòng thẩm định.
6. Kế hoạch gộp loại đúng các dòng riêng.
7. Điều chỉnh E-HSMT tạo được nhiều dòng động.
8. Định danh mốc ổn định, không phụ thuộc STT hiển thị.
9. UI và export dùng cùng effective timeline.
10. Không mất dữ liệu timeline cũ.
11. Offline/outbox/sync không tạo trùng.
12. Không thay đổi giao diện ngoài phạm vi cần thiết.
13. Không thay đổi phân quyền hoặc dữ liệu nhạy cảm.
14. Toàn bộ test cũ và test mới đều vượt qua.
15. Có tài liệu ngắn mô tả cách bổ sung một rule/milestone mới sau này.

---

## 16. Những điều không được làm

- Không rewrite toàn bộ module.
- Không tạo timeline v2 song song.
- Không hard-code điều kiện bằng chuỗi tiêu đề tiếng Việt ở nhiều file.
- Không xóa vật lý dữ liệu của mốc chỉ vì tạm thời không áp dụng.
- Không coi `CONDITIONAL` là công việc chưa hoàn thành.
- Không đưa mốc chưa xác định vào progress hoặc cảnh báo quá hạn.
- Không chỉ sửa frontend mà bỏ backend/export.
- Không chỉ sửa backend mà bỏ offline/local model.
- Không dùng STT hiển thị làm primary key.
- Không thêm hàng loạt `!important`, inline style hoặc component UI trái design system.
- Không thay đổi quyền xem dữ liệu của người đã có quyền truy cập hồ sơ.
- Không bổ sung field-level permission hoặc redaction.
- Không sửa luật nghiệp vụ ngoài phạm vi prompt.
- Không bỏ test để làm pipeline xanh.

---

## 17. Kết quả Codex phải bàn giao

Sau khi hoàn tất, cung cấp:

1. Danh sách file đã sửa/thêm.
2. Mô tả ngắn kiến trúc rule engine.
3. Bảng mapping dữ liệu cũ sang dữ liệu mới.
4. Danh sách rule đã triển khai.
5. Migration đã thêm.
6. Test đã thêm.
7. Kết quả chạy toàn bộ test.
8. Các giả định còn lại, nếu có.
9. Hướng dẫn ngắn cách thêm một milestone hoặc rule mới.
10. Xác nhận rõ:
    - UI hiện tại không bị redesign;
    - dữ liệu cũ không bị mất;
    - chính sách phân quyền/dữ liệu nhạy cảm không bị thay đổi;
    - frontend và backend đã có parity test.

Hãy trực tiếp thực hiện việc sửa code, migration, test và tài liệu. Không chỉ viết kế hoạch.
