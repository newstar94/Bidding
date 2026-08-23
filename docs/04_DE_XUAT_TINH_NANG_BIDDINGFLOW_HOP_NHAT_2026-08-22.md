# ĐỀ XUẤT TÍNH NĂNG MỚI VÀ NÂNG CẤP BIDDINGFLOW — BẢN HỢP NHẤT THUẦN VIỆT

**Ngày cập nhật:** 22/08/2026  
**Mục đích:** Hợp nhất toàn bộ các đề xuất tính năng trước đây thành một tài liệu duy nhất, sử dụng tiếng Việt dễ hiểu để thuận tiện trao đổi nghiệp vụ và lập kế hoạch phát triển.

> Đây là **tài liệu định hướng sản phẩm và danh sách tính năng đề xuất**.  
> Không có nghĩa là phải triển khai toàn bộ cùng lúc.
>
> Nguyên tắc chung: **tận dụng những gì BiddingFlow đã có, không xây lại hệ thống song song, ưu tiên tính năng giúp giảm lỗi nghiệp vụ, giảm thao tác thủ công, tăng khả năng tuân thủ và hỗ trợ người dùng ra quyết định.**

---

# 1. Tầm nhìn phát triển BiddingFlow

BiddingFlow không nên chỉ là một phần mềm để nhập dữ liệu và lưu hồ sơ đấu thầu.

Hướng phát triển dài hạn nên là một **hệ điều hành nghiệp vụ đấu thầu**, có khả năng:

- quản lý Kế hoạch lựa chọn nhà thầu;
- quản lý Gói thầu;
- quản lý quá trình đánh giá;
- quản lý Kết quả lựa chọn nhà thầu;
- quản lý Hợp đồng;
- quản lý toàn bộ hồ sơ, văn bản và biểu mẫu;
- biết dữ liệu đang ở phiên bản nào;
- biết quy định pháp lý nào đang áp dụng;
- phát hiện hồ sơ còn thiếu;
- phát hiện văn bản đã lỗi thời;
- cảnh báo rủi ro trước khi xảy ra;
- theo dõi thời hạn xử lý;
- theo dõi trách nhiệm của từng người;
- hỗ trợ kiểm tra, thanh tra và kiểm toán;
- hỗ trợ chủ đầu tư, bên mời thầu, tư vấn và nhà thầu ra quyết định;
- giảm phụ thuộc vào Excel, Word, email, Zalo và các file lưu rời rạc.

Định hướng tổng thể:

```text
Quản lý dữ liệu
→ Kiểm soát phiên bản
→ Kiểm soát quy trình
→ Kiểm soát tuân thủ
→ Tự động hóa hồ sơ
→ Phân tích rủi ro
→ Hỗ trợ ra quyết định
```

---

# 2. Giải thích một số thuật ngữ kỹ thuật bắt buộc phải giữ nguyên

Tài liệu này được viết bằng tiếng Việt, tuy nhiên một số tên kỹ thuật trong mã nguồn và một số chữ viết tắt nghiệp vụ vẫn phải giữ nguyên để đội phát triển có thể đối chiếu chính xác.

- `rootId`: mã dùng để liên kết các phiên bản của cùng một bản ghi.
- `rowVersion`: số phiên bản kỹ thuật dùng để phát hiện xung đột khi nhiều người cùng sửa dữ liệu.
- `isLatest`: cờ xác định bản ghi có phải phiên bản mới nhất hay không.
- `HTTP 409`: mã lỗi thường dùng khi xảy ra xung đột cập nhật dữ liệu.
- **SLA**: thời hạn cam kết phải xử lý xong một công việc.
- **e-GP**: hệ thống/luồng nghiệp vụ đấu thầu điện tử.
- **HSMT**: Hồ sơ mời thầu.
- **E-HSMT**: Hồ sơ mời thầu điện tử.
- **E-HSDT**: Hồ sơ dự thầu điện tử.
- **KQLCNT**: Kết quả lựa chọn nhà thầu.
- **AI**: trí tuệ nhân tạo.
- **API**: giao diện kết nối giữa các hệ thống.
- **Word/Excel**: tên sản phẩm/định dạng phổ biến nên giữ nguyên để tránh gây nhầm lẫn.

Những tên trường nằm trong dấu `` ` `` là tên kỹ thuật trong mã nguồn và không nên dịch khi triển khai.

---

# 3. Cách phân loại tính năng

Mỗi đề xuất được xếp vào một trong ba nhóm sau.

## 3.1. `NỀN TẢNG ĐÃ CÓ`

Đây là chức năng hoặc nền tảng BiddingFlow đã có.

**Không được xây lại một hệ thống mới để làm cùng việc.**

Chỉ được:

- mở rộng;
- cải thiện;
- bổ sung giao diện;
- bổ sung kiểm tra;
- bổ sung khả năng phân tích.

---

## 3.2. `NÂNG CẤP`

Là tính năng giúp một chức năng hiện có mạnh hơn.

Ví dụ:

- hệ thống phiên bản → bổ sung so sánh phiên bản;
- phát hiện xung đột → bổ sung màn hình xử lý xung đột;
- Trợ lý AI → bổ sung khả năng giải thích tuân thủ;
- cảnh báo → nâng cấp thành hệ thống theo dõi rủi ro và thời hạn;
- Trình thiết kế biểu mẫu Word → bổ sung lịch sử phiên bản và khôi phục.

---

## 3.3. `MỚI`

Là chức năng chưa có hoặc cần một lớp nghiệp vụ mới đáng kể.

Trước khi làm phải kiểm tra:

- có thật sự cần thay đổi cơ sở dữ liệu không;
- có trùng chức năng đang có không;
- có ảnh hưởng phân quyền không;
- có ảnh hưởng hệ thống làm việc ngoại tuyến không;
- có ảnh hưởng hàng đợi đồng bộ không;
- có cần kết nối hệ thống bên ngoài không;
- có làm tăng rủi ro bảo mật không.

---

# 4. Các nền tảng hiện có phải được tận dụng

BiddingFlow đã có nhiều nền tảng quan trọng. Các tính năng mới phải tận dụng những nền tảng này thay vì xây lại.

Bao gồm:

- hệ thống phiên bản Kế hoạch/Gói thầu;
- `rootId`;
- `phienBan`;
- `isLatest`;
- bộ chọn phiên bản;
- bản chụp dữ liệu theo từng phiên bản;
- phiên bản Nhà thầu;
- phiên bản Hợp đồng ở một số luồng;
- `rowVersion`;
- phát hiện xung đột cập nhật;
- khôi phục dữ liệu chuẩn từ máy chủ;
- hỗ trợ làm việc ngoại tuyến;
- hàng đợi thay đổi chờ đồng bộ;
- cơ chế xác nhận đúng lần thay đổi đã gửi;
- Trợ lý AI;
- hệ thống cảnh báo;
- bộ máy đánh giá;
- hồ sơ chi tiết Nhà thầu;
- Trình thiết kế biểu mẫu Word;
- hệ thống xử lý biểu mẫu và xuất Word;
- tiến trình xử lý văn bản;
- các bộ kiểm tra hợp lệ và toàn vẹn dữ liệu;
- tra cứu/nhập dữ liệu đấu thầu công khai;
- thông báo;
- nhập/xuất Excel;
- hệ thống phân quyền;
- phạm vi theo đơn vị và không gian làm việc.

**Mọi tính năng mới phải ưu tiên mở rộng các nền tảng này.**

---

# 5. Bảng tổng quan các tính năng đề xuất

| Nhóm | Tính năng | Loại | Mức ưu tiên |
|---|---|---|---|
| Phiên bản và dữ liệu | So sánh phiên bản và phân tích tác động thay đổi | Nâng cấp | Rất cao |
| Phiên bản và dữ liệu | Trung tâm xử lý xung đột dữ liệu | Nâng cấp | Rất cao |
| Pháp lý và tuân thủ | Bộ máy quản lý phiên bản pháp lý | Mới | Rất cao |
| Pháp lý và tuân thủ | Trung tâm cấu hình quy tắc | Mới | Rất cao |
| Pháp lý và tuân thủ | Trợ lý lựa chọn hình thức và quy trình đấu thầu | Mới | Rất cao |
| Pháp lý và tuân thủ | Bộ kiểm tra tuân thủ HSMT/E-HSMT | Mới/Nâng cấp | Rất cao |
| Pháp lý và tuân thủ | Trợ lý AI về tuân thủ đấu thầu | Nâng cấp | Rất cao |
| Hệ thống văn bản | Bản đồ hồ sơ và mức độ hoàn thiện văn bản | Mới | Rất cao |
| Hệ thống văn bản | Phát hiện văn bản lỗi thời | Mới | Rất cao |
| Hệ thống văn bản | Nâng cấp Trình thiết kế biểu mẫu Word | Nâng cấp | Rất cao |
| Tiến độ và vận hành | Trung tâm sẵn sàng e-GP và quản lý thời hạn | Mới/Nâng cấp | Rất cao |
| Tiến độ và vận hành | Phân tích rủi ro và thời hạn xử lý | Nâng cấp | Rất cao |
| Kiểm tra và quản trị | Bộ hồ sơ phục vụ kiểm tra, thanh tra, kiểm toán | Mới | Cao |
| Kiểm tra và quản trị | Trung tâm kiểm soát xung đột lợi ích | Mới | Cao |
| Kiểm tra và quản trị | Trung tâm chất lượng dữ liệu | Nâng cấp | Cao |
| Quy trình công việc | Trung tâm quản lý làm rõ | Mới | Cao |
| Quy trình công việc | Trung tâm quản lý kiến nghị | Mới | Cao |
| Quy trình công việc | Tiến độ phụ thuộc và đường găng | Mới | Cao |
| Quy trình công việc | Quy trình phê duyệt nhiều cấp | Mới/Một phần đã có | Trung bình |
| Quy trình công việc | Tích hợp lịch công việc | Mới | Trung bình |
| Vận hành | Trung tâm thao tác hàng loạt | Mới/Một phần đã có | Trung bình |
| Vận hành | Hoàn tác an toàn | Mới | Trung bình |
| Phân tích | Hồ sơ tổng hợp 360 độ về Nhà thầu | Nâng cấp | Cao |
| Phân tích | Phân tích và đối chuẩn giá | Mới/Nâng cấp | Cao |
| Phân tích | Tìm gói thầu tương đồng | Mới | Cao |
| Phân tích | Mô phỏng các kịch bản đánh giá | Mới | Cao |
| Nền tảng | Trung tâm tích hợp hệ thống | Mới | Cao |
| Dành cho Nhà thầu | Kho năng lực doanh nghiệp | Mới | Cao |
| Dành cho Nhà thầu | Điểm phù hợp để quyết định tham dự/không tham dự | Mới | Cao |
| Dành cho Nhà thầu | Gợi ý cơ hội thầu phù hợp | Mới | Cao |
| Dành cho Nhà thầu | Theo dõi thay đổi gói thầu | Mới | Cao |
| Dành cho Nhà thầu | Hỗ trợ chuẩn bị E-HSDT | Mới | Cao |
| Dành cho Nhà thầu | Phân tích rủi ro chi phí và hợp đồng | Mới | Cao |
| Dành cho Nhà thầu | Theo dõi sức khỏe hợp đồng | Mới/Nâng cấp | Cao |

---

# 6. So sánh phiên bản và phân tích tác động thay đổi

**Loại:** Nâng cấp

## 6.1. Hiện trạng

BiddingFlow đã có hệ thống phiên bản.

Ví dụ:

```text
-00
-01
-02
```

Do đó **không xây một bộ máy phiên bản mới**.

## 6.2. So sánh hai phiên bản

Cho phép người dùng chọn hai phiên bản và xem thay đổi theo từng trường.

Ví dụ:

```text
Thời gian đóng thầu
10/08 09:00 → 12/08 09:00

Giá gói thầu
Không đổi

Người phụ trách
Nguyễn A → Nguyễn A, Trần B

Danh mục hàng hóa
+2 dòng mới
-1 dòng bị xóa
3 dòng bị chỉnh sửa
```

Mỗi trường được phân loại:

- được thêm;
- bị xóa;
- bị sửa;
- không thay đổi.

## 6.3. Phân tích tác động

Khi một trường thay đổi, hệ thống phải xác định những phần có thể bị ảnh hưởng:

- thời hạn;
- tiến độ;
- phân công;
- văn bản;
- kết quả đánh giá;
- hợp đồng;
- thông báo;
- kiểm tra tuân thủ;
- file Word đã xuất;
- quy tắc pháp lý áp dụng.

### Giá trị

Đây là một trong những tính năng nên ưu tiên vì BiddingFlow đã có nền tảng phiên bản mạnh.

---

# 7. Trung tâm xử lý xung đột dữ liệu

**Loại:** Nâng cấp

## 7.1. Hiện trạng

BiddingFlow đã có:

- `rowVersion`;
- mã lỗi HTTP 409 khi có xung đột;
- khả năng lấy lại dữ liệu chuẩn từ máy chủ;
- một số trường hợp tự xử lý;
- hỗ trợ làm việc ngoại tuyến và đồng bộ sau.

## 7.2. Giao diện đề xuất

Khi hai người cùng sửa một bản ghi:

```text
                     Dữ liệu của tôi       Dữ liệu trên máy chủ
Thời gian đóng       12/08 10:00           12/08 09:00
Người phụ trách      Nguyễn A              Trần B
```

Cho phép:

- Dùng dữ liệu trên máy chủ;
- Giữ dữ liệu của tôi;
- Chọn từng trường để hợp nhất.

Sau khi hợp nhất phải tạo một thay đổi mới dựa trên `rowVersion` mới nhất.

Không được bỏ qua:

- phạm vi đơn vị;
- phân quyền;
- dữ liệu lịch sử;
- cơ chế đồng bộ;
- cơ chế xác nhận đúng lần thay đổi.

---

# 8. Bộ máy quản lý phiên bản pháp lý

**Loại:** Mới

## 8.1. Mục tiêu

Mỗi Kế hoạch/Gói thầu phải biết **bộ văn bản pháp luật nào áp dụng cho chính nó**.

Không được chỉ dùng luật mới nhất tại thời điểm người dùng mở phần mềm.

## 8.2. Dữ liệu cần quản lý

Ví dụ:

```text
Luật áp dụng
Nghị định áp dụng
Thông tư áp dụng
Bộ biểu mẫu áp dụng
Ngày bắt đầu hiệu lực
Ngày hết hiệu lực
Trạng thái văn bản
Phiên bản bộ quy tắc
```

Trạng thái:

- đang có hiệu lực;
- sắp có hiệu lực;
- hết hiệu lực;
- dự thảo.

## 8.3. Ví dụ

```text
Gói A
Phát hành trước ngày văn bản mới có hiệu lực
→ tiếp tục dùng bộ quy tắc cũ

Gói B
Bắt đầu sau ngày văn bản mới có hiệu lực
→ dùng bộ quy tắc mới
```

### Nguyên tắc

- không hồi tố làm thay đổi hồ sơ lịch sử;
- không ghi cứng ngưỡng pháp lý rải rác trong mã nguồn;
- mỗi hồ sơ nên lưu được bộ quy tắc pháp lý đã dùng tại thời điểm tạo/phát hành.

---

# 9. Trung tâm cấu hình quy tắc

**Loại:** Mới

## 9.1. Mục tiêu

Không để toàn bộ quy tắc nghiệp vụ nằm rải rác trong mã nguồn.

Quản trị viên có thể cấu hình các quy tắc có cấu trúc.

Ví dụ:

```text
NẾU
Giá gói thầu > ngưỡng quy định
VÀ
Hình thức lựa chọn = Chỉ định thầu

THÌ
Mức cảnh báo = Nghiêm trọng
Yêu cầu người dùng kiểm tra/giải trình
```

Hoặc:

```text
NẾU
Số ngày từ phát hành đến đóng thầu
< số ngày tối thiểu

THÌ
Cảnh báo
```

## 9.2. Mỗi quy tắc nên có

- mã định danh ổn định;
- tên quy tắc;
- mô tả;
- căn cứ pháp lý;
- điều kiện;
- mức độ cảnh báo;
- hành động cần thực hiện;
- ngày bắt đầu hiệu lực;
- ngày hết hiệu lực;
- trạng thái bật/tắt;
- phiên bản;
- lịch sử chỉnh sửa.

### Giá trị

Nền tảng này được dùng chung cho:

- Trợ lý lựa chọn quy trình;
- kiểm tra HSMT;
- Trợ lý AI;
- kiểm tra dữ liệu;
- cảnh báo tuân thủ.

---

# 10. Trợ lý lựa chọn hình thức và quy trình đấu thầu

**Loại:** Mới

## 10.1. Mục tiêu

Khi người dùng tạo hoặc sửa Gói thầu, BiddingFlow tự phân tích:

- loại gói;
- giá gói;
- nguồn vốn;
- dự án hay dự toán mua sắm;
- thời điểm thực hiện;
- điều kiện đặc biệt;

sau đó đề xuất các lựa chọn có thể áp dụng.

## 10.2. Ví dụ

> **Các hình thức cần xem xét**
>
> - Đấu thầu rộng rãi
> - Chỉ định thầu thuộc hạn mức
> - Chào giá trực tuyến rút gọn nếu đáp ứng các điều kiện còn lại
>
> **Căn cứ:** Điều..., Khoản..., văn bản...

Nếu người dùng thay đổi giá gói khiến điều kiện cũ không còn phù hợp:

> **Cảnh báo:** Hình thức lựa chọn hiện tại cần được kiểm tra lại.

## 10.3. Nguyên tắc

- bộ máy quy tắc đưa ra kết quả xác định;
- AI chỉ giải thích;
- người dùng đưa ra quyết định cuối cùng;
- mọi cảnh báo phải có căn cứ.

---

# 11. Bộ kiểm tra tuân thủ HSMT/E-HSMT

**Loại:** Mới/Nâng cấp

## 11.1. Mục tiêu

Trước khi phát hành hồ sơ, người dùng bấm:

```text
Kiểm tra tuân thủ
```

Hệ thống rà soát toàn bộ hồ sơ.

## 11.2. Các nhóm kiểm tra

- thiếu trường bắt buộc;
- thông tin không khớp với Kế hoạch/Gói thầu;
- tiêu chí có dấu hiệu hạn chế cạnh tranh;
- yêu cầu nhãn hiệu/xuất xứ cần kiểm tra;
- tiêu chí năng lực quá mức cần thiết;
- mốc thời gian bất hợp lý;
- hình thức/phương thức lựa chọn không phù hợp;
- thiếu căn cứ;
- nội dung mâu thuẫn giữa các phần;
- tài liệu đã lỗi thời so với phiên bản hiện tại.

## 11.3. Mức độ cảnh báo

- Thông tin;
- Cần kiểm tra;
- Rủi ro thấp;
- Rủi ro trung bình;
- Rủi ro cao.

Không để hệ thống tự kết luận:

```text
"Vi phạm pháp luật"
```

nếu kết quả chỉ được suy ra từ phân tích tự động.

---

# 12. Trợ lý AI về tuân thủ đấu thầu

**Loại:** Nâng cấp

BiddingFlow đã có Trợ lý AI nên **không xây một chatbot thứ hai**.

Trợ lý hiện có cần được bổ sung dữ liệu từ:

```text
Dữ liệu đã lọc theo quyền
+
Bộ quy tắc xác định
+
Phiên bản pháp lý
+
Trạng thái quy trình
+
Dữ liệu phiên bản
+
Dữ liệu văn bản
+
AI giải thích
```

Ví dụ người dùng có thể hỏi:

> Vì sao gói này cần kiểm tra lại hình thức lựa chọn?

> Còn thiếu tài liệu nào trước khi phát hành HSMT?

> Tiêu chí nào có dấu hiệu hạn chế cạnh tranh?

> File Word nào đã lỗi thời?

> Vì sao công việc này đang bị cảnh báo quá hạn?

### Phân chia trách nhiệm

**Phía máy chủ/bộ máy quy tắc:**

- quyết định điều kiện đúng/sai;
- kiểm tra quyền;
- kiểm tra dữ liệu;
- chặn thao tác không hợp lệ.

**AI:**

- giải thích;
- tổng hợp;
- chỉ ra căn cứ;
- đề xuất bước xử lý tiếp theo.

---

# 13. Bản đồ hồ sơ và mức độ hoàn thiện văn bản

**Loại:** Mới

## 13.1. Mục tiêu

Nâng phần **Hệ thống văn bản / Xuất bản Word** từ danh sách file thành một bản đồ hồ sơ hoàn chỉnh.

Ví dụ:

```text
Kế hoạch LCNT
      ↓
Tờ trình
      ↓
HSMT
      ↓
Báo cáo thẩm định
      ↓
Quyết định phê duyệt
      ↓
Biên bản mở thầu
      ↓
Báo cáo đánh giá
      ↓
Báo cáo thẩm định KQLCNT
      ↓
Quyết định KQLCNT
      ↓
Hợp đồng
```

Mỗi tài liệu có trạng thái:

- Đủ dữ liệu;
- Thiếu dữ liệu;
- Cần cập nhật;
- Chưa đến giai đoạn;
- Đã xuất;
- Đã lỗi thời;
- Chưa có biểu mẫu.

---

# 14. Phát hiện văn bản lỗi thời

**Loại:** Mới

## 14.1. Mục tiêu

Một file Word đã sinh phải biết nó được tạo từ dữ liệu và phiên bản nào.

Mỗi file nên lưu:

- phiên bản Kế hoạch;
- phiên bản Gói thầu;
- phiên bản kết quả/đánh giá nếu có;
- phiên bản biểu mẫu;
- bộ quy tắc pháp lý;
- thời gian sinh file;
- người sinh file;
- mã kiểm tra toàn vẹn nếu cần.

## 14.2. Ví dụ

> **Báo cáo đánh giá E-HSĐXKT**
>
> Sinh lúc: 21/08/2026 14:25  
> Phiên bản Gói thầu: 02  
> Phiên bản biểu mẫu: 4.1
>
> **Dữ liệu nguồn đã thay đổi**
>
> Có 4 trường thay đổi từ lần xuất gần nhất.
>
> [Xem thay đổi] [Xuất lại Word]

Nút **Xem thay đổi** phải dùng chung hệ thống So sánh phiên bản, không xây một bộ so sánh khác.

---

# 15. Nâng cấp Trình thiết kế biểu mẫu Word

**Loại:** Nâng cấp

## 15.1. Nền tảng hiện có

Trình thiết kế biểu mẫu đã có:

- tải lên;
- danh sách;
- xem;
- bật/tắt áp dụng;
- thay thế;
- đổi tên;
- xóa;
- kiểm tra hợp lệ;
- từ điển biến;
- ánh xạ dữ liệu;
- danh sách;
- biến tính toán;
- mở rộng cột/danh sách;
- phân quyền.

Không xây lại.

## 15.2. Các nâng cấp cần thêm

### Lịch sử phiên bản biểu mẫu

Mỗi biểu mẫu nên có:

```text
Mã biểu mẫu
Phiên bản
Mã kiểm tra toàn vẹn
Người tạo
Thời gian tạo
```

### Bản nháp / Phát hành

Cho phép chỉnh sửa biểu mẫu mà chưa ảnh hưởng ngay tới file chính thức.

### Khôi phục phiên bản

Có thể quay lại phiên bản cũ.

### Xem trước bản đã kết xuất

Dùng dữ liệu thật hoặc dữ liệu mẫu để xem Word/PDF sau khi điền biến.

### Xem nơi biểu mẫu đang được sử dụng

Biết biểu mẫu đang gắn với:

- loại văn bản nào;
- quy trình nào;
- Gói thầu nào;
- quy tắc nào.

### Kiểm tra tương thích khi thay biểu mẫu

Kiểm tra:

- thiếu biến;
- vòng lặp sai;
- biểu thức không hỗ trợ;
- thiếu dữ liệu bắt buộc.

### Nhật ký

Lưu ai đã:

- tải lên;
- thay thế;
- phát hành;
- khôi phục;
- đổi ánh xạ.

---

# 16. Trung tâm sẵn sàng e-GP và quản lý thời hạn

**Loại:** Mới/Nâng cấp

## 16.1. Mục tiêu

Không xây lại Hệ thống mạng đấu thầu quốc gia.

BiddingFlow đóng vai trò:

```text
Kiểm tra trước khi thực hiện
+
Theo dõi hạn xử lý
+
Cảnh báo thay đổi
```

## 16.2. Ví dụ

> **Mức độ sẵn sàng đăng tải E-HSMT: 92%**
>
> ✅ Kế hoạch đã được phê duyệt  
> ✅ HSMT đầy đủ  
> ✅ Thời điểm đóng thầu hợp lệ  
> ⚠ Thiếu tài liệu X  
> 🔴 Chưa hoàn tất thẩm định Y

Theo dõi:

- phát hành;
- đóng thầu;
- mở thầu;
- đánh giá;
- làm rõ;
- trình phê duyệt;
- phê duyệt;
- ký hợp đồng;
- hết hạn;
- các mốc hợp đồng.

---

# 17. Phân tích rủi ro và thời hạn xử lý

**Loại:** Nâng cấp

BiddingFlow hiện đã có nhiều cảnh báo.

Nâng cấp mỗi cảnh báo để có thêm:

- mức độ;
- người chịu trách nhiệm;
- xác nhận đã tiếp nhận;
- lý do đang chặn tiến độ;
- thời hạn cam kết xử lý;
- thời gian quá hạn;
- xu hướng rủi ro;
- ngưỡng có thể cấu hình;
- nhóm theo phòng ban;
- nhóm theo nhân sự;
- nhóm theo Gói thầu;
- liên kết mở thẳng tới nơi cần xử lý.

**Không tạo một bộ máy cảnh báo thứ hai nếu hệ thống hiện tại có thể mở rộng.**

---

# 18. Tiến độ phụ thuộc và đường găng

**Loại:** Mới

## 18.1. Mục tiêu

Không chỉ hiển thị các mốc thời gian riêng lẻ.

Hệ thống phải biết mốc nào phụ thuộc mốc nào.

```text
Phê duyệt HSMT
     ↓
Đăng tải
     ↓
Đóng thầu
     ↓
Mở thầu
     ↓
Đánh giá
     ↓
Trình KQLCNT
     ↓
Phê duyệt
     ↓
Ký hợp đồng
```

Nếu ngày đóng thầu lùi 5 ngày:

> Có 5 mốc tiếp theo có khả năng bị ảnh hưởng.

Người dùng có thể:

- dịch các mốc phụ thuộc;
- giữ nguyên các mốc;
- xem tác động;
- xem đường găng;
- xem mốc có nguy cơ trễ.

Dùng chung dữ liệu với:

- cảnh báo;
- SLA;
- lịch;
- thông báo;
- phân tích tác động thay đổi.

---

# 19. Tích hợp lịch công việc

**Loại:** Mới

## Giai đoạn đầu

Cho phép xuất lịch dạng `.ics`.

## Giai đoạn sau

Có thể kết nối:

- Google Calendar;
- Outlook.

Các mốc có thể đưa vào lịch:

- đăng tải;
- đóng thầu;
- mở thầu;
- đánh giá;
- phê duyệt;
- làm rõ;
- mốc hợp đồng;
- ngày hết hạn.

### Nguyên tắc bảo mật

Không tự động đẩy dữ liệu mật ra lịch bên ngoài nếu người dùng chưa cho phép.

---

# 20. Trung tâm quản lý làm rõ

**Loại:** Mới

Không quản lý làm rõ bằng email/Zalo/file rời.

Mỗi yêu cầu làm rõ trở thành một vụ việc.

Ví dụ:

```text
Mã: CLR-2026-018

Nhà thầu: Công ty ABC
Nội dung: Nhân sự chủ chốt
Ngày gửi: 20/08/2026
Hạn phản hồi: 24/08/2026
Người xử lý: Nguyễn A
Trạng thái: Đang chờ
```

Chức năng:

- tạo vụ việc;
- phân công;
- theo dõi hạn;
- đính kèm tài liệu;
- soạn dự thảo phản hồi;
- rà soát;
- phê duyệt;
- phát hành;
- đóng vụ việc;
- lưu lịch sử;
- lưu nhật ký.

---

# 21. Trung tâm quản lý kiến nghị

**Loại:** Mới

Quy trình đề xuất:

```text
Tiếp nhận
→ Phân công
→ Kiểm tra
→ Dự thảo trả lời
→ Phê duyệt
→ Phát hành
→ Đóng vụ việc
```

Theo dõi:

- thời hạn;
- căn cứ pháp lý;
- người phụ trách;
- tài liệu;
- trạng thái;
- phiên bản phản hồi;
- lịch sử xử lý.

Phần Làm rõ và Kiến nghị nên dùng chung một **nền tảng quản lý vụ việc**, không xây hai hệ thống tách biệt.

---

# 22. Quy trình phê duyệt nhiều cấp

**Loại:** Mới/Một phần đã có

Chỉ xây khi nhu cầu nghiệp vụ thực sự cần.

Ví dụ luồng:

```text
Bản nháp
→ Rà soát
→ Phê duyệt
→ Ký
→ Hoàn tất
```

Mỗi bước có:

- vai trò;
- quyền;
- lý do từ chối;
- nhận xét;
- ủy quyền;
- thời hạn xử lý;
- nhật ký.

Không được thay thế tùy tiện các quy trình pháp lý hiện có bằng một quy trình chung nếu bản chất nghiệp vụ khác nhau.

---

# 23. Bộ hồ sơ phục vụ kiểm tra, thanh tra và kiểm toán

**Loại:** Mới

## 23.1. Mục tiêu

Một lần bấm có thể tạo bộ hồ sơ đầy đủ để:

- kiểm tra nội bộ;
- thanh tra;
- kiểm toán;
- bàn giao;
- hậu kiểm.

Ví dụ cấu trúc:

```text
00_Muc_luc.pdf
01_Ke_hoach/
02_HSMT/
03_Tham_dinh/
04_Mo_thau/
05_Danh_gia/
06_Lam_ro/
07_KQLCNT/
08_Hop_dong/
09_Nhat_ky/
10_Lich_su_phien_ban/
```

File mục lục nên có:

- ai tạo;
- ai sửa;
- ai phê duyệt;
- thời gian;
- phiên bản;
- các thay đổi chính;
- căn cứ pháp lý;
- tài liệu thiếu;
- trạng thái tuân thủ tại thời điểm xuất;
- mã kiểm tra toàn vẹn của tài liệu nếu cần.

---

# 24. Trung tâm kiểm soát xung đột lợi ích

**Loại:** Mới

## Mục tiêu

Phát hiện các trường hợp:

- một người tham gia các vai trò không nên đồng thời đảm nhiệm;
- cần xác nhận tính độc lập;
- có quan hệ hoặc điều kiện cần kiểm tra theo quy tắc.

Ví dụ:

> Người A đã tham gia lập HSMT nhưng đang được phân công thẩm định HSMT.

Cho phép mỗi người xác nhận:

```text
Tôi xác nhận không có xung đột lợi ích
```

Lưu:

- người xác nhận;
- thời gian;
- quy tắc/căn cứ phát sinh yêu cầu;
- lịch sử thay đổi.

---

# 25. Trung tâm chất lượng dữ liệu

**Loại:** Nâng cấp

BiddingFlow đã có nhiều bộ kiểm tra ở phía máy chủ và trong kiểm thử.

Cần đưa chúng thành một màn hình quản trị dễ sử dụng.

Trạng thái lỗi:

```text
Đã phát hiện
Đã rà soát
Đã sửa
Bỏ qua có ghi lý do
```

Các loại lỗi:

- dữ liệu trùng;
- bản ghi mồ côi;
- lỗi liên kết gốc/phiên bản;
- có nhiều bản cùng là bản mới nhất;
- không có bản mới nhất;
- siêu dữ liệu không hợp lệ;
- tên phương thức cũ;
- thiếu `rowVersion`;
- bản ghi con không khớp;
- phân công đã lỗi thời;
- trùng mã số thuế Nhà thầu;
- liên kết văn bản hỏng;
- file đã xuất bị lỗi thời;
- liên kết sai phạm vi đơn vị.

### Tự sửa

Chỉ tự sửa trường hợp có kết quả xác định rõ ràng.

Mọi lần tự sửa phải có nhật ký.

---

# 26. Hồ sơ tổng hợp 360 độ về Nhà thầu

**Loại:** Nâng cấp

BiddingFlow đã có thông tin chi tiết Nhà thầu.

Nâng cấp thành một trang phân tích tổng hợp.

## 26.1. Lịch sử dự thầu

- số lần tham dự;
- số lần trúng;
- số lần trượt;
- tỷ lệ trúng.

## 26.2. Lịch sử hợp đồng

- số hợp đồng;
- tổng giá trị;
- hợp đồng đang thực hiện;
- đã thanh lý;
- đúng hạn/chậm tiến độ.

## 26.3. Phân tích giá

- lịch sử giá dự thầu;
- lịch sử giá trúng;
- các trường hợp giá thấp bất thường.

## 26.4. Mạng lưới liên danh

- từng liên danh với ai;
- vai trò trưởng/thành viên;
- tần suất.

## 26.5. Làm rõ và đánh giá

- lịch sử làm rõ;
- kết quả kỹ thuật;
- kết quả tài chính;
- lý do bị loại.

---

# 27. Phân tích và đối chuẩn giá

**Loại:** Mới/Nâng cấp

## Mục tiêu

So sánh giá gói hiện tại với dữ liệu lịch sử.

Ví dụ:

> Giá dự toán hiện tại: 18,4 triệu/bộ  
> Trung vị 12 tháng: 17,1 triệu/bộ  
> Cao hơn trung vị: 7,6%  
> Có 14 gói tương đồng.

Phân tích theo:

- loại hàng hóa/dịch vụ;
- mã phân loại;
- địa bàn;
- thời gian;
- đơn vị;
- Nhà thầu;
- giá dự toán;
- giá dự thầu;
- giá trúng;
- tỷ lệ tiết kiệm.

---

# 28. Tìm gói thầu tương đồng

**Loại:** Mới

Cho phép:

> Tìm 10 gói giống nhất với gói hiện tại.

Dùng để:

- tham khảo giá;
- tham khảo yêu cầu;
- so sánh thời gian;
- đánh giá năng lực;
- so sánh Nhà thầu;
- phân tích rủi ro.

Mức độ tương đồng phải giải thích được dựa trên tiêu chí cụ thể, không chỉ đưa ra một con số từ AI.

---

# 29. Mô phỏng các kịch bản đánh giá

**Loại:** Mới

## Mục tiêu

Cho phép thử các giả định mà **không làm thay đổi kết quả chính thức**.

Ví dụ:

```text
Trọng số kỹ thuật
30% → 40%
```

Sau đó xem thứ hạng thay đổi như thế nào.

Có thể mô phỏng:

- điểm kỹ thuật;
- giá giả định;
- trường hợp giá thấp;
- so sánh giữa các lô/phần.

Giao diện phải ghi rõ:

```text
MÔ PHỎNG
KHÔNG PHẢI KẾT QUẢ CHÍNH THỨC
```

Không lưu kết quả mô phỏng vào dữ liệu chính thức.

---

# 30. Trung tâm thao tác hàng loạt

**Loại:** Mới/Một phần đã có

Các trường hợp sử dụng:

- phân công nhiều bản ghi;
- phân công lại;
- xuất dữ liệu;
- lưu trữ;
- chạy một số thao tác quy trình;
- tạo văn bản cho nhiều bản ghi nếu hợp lệ.

Trình tự bắt buộc:

```text
Xem trước bản ghi bị ảnh hưởng
↓
Kiểm tra quyền
↓
Kiểm tra hợp lệ
↓
Người dùng xác nhận
↓
Thực thi
↓
Ghi nhật ký
```

Không cho phép thao tác hàng loạt cưỡng ép chuyển sang trạng thái không hợp lệ.

---

# 31. Hoàn tác an toàn

**Loại:** Mới

Cho một số thao tác có thể đảo ngược:

- xóa phân công;
- xóa ghi chú;
- xóa dòng chưa hoàn tất.

Ví dụ thông báo:

```text
Đã xóa · Hoàn tác
```

Không áp dụng cho:

- phê duyệt chính thức;
- kết quả lựa chọn cuối cùng;
- hợp đồng đã ký;
- hành động không thể đảo ngược;

trừ khi nghiệp vụ có cơ chế hủy/thu hồi chính thức.

---

# 32. Trung tâm tích hợp hệ thống

**Loại:** Kiến trúc mới

Hiện BiddingFlow đã có một số kết nối riêng lẻ.

Nên tạo một lớp kết nối dùng chung theo chuỗi:

```text
Bộ kết nối
→ Ánh xạ dữ liệu
→ Kiểm tra dữ liệu
→ Chống xử lý lặp
→ Thử lại khi lỗi
→ Hàng đợi lỗi
→ Nhật ký
→ Giám sát
```

Có thể phục vụ:

- e-GP/Mua sắm công;
- phần mềm quản trị doanh nghiệp;
- kế toán;
- hệ thống quản lý tài liệu;
- nhân sự;
- chữ ký số;
- email/SMS;
- hệ thống báo cáo;
- lịch làm việc.

Không viết lại các kết nối đang hoạt động chỉ để làm đẹp kiến trúc.

---

# 33. Nhánh sản phẩm dành cho Nhà thầu

BiddingFlow có thể phát triển một nhánh phục vụ doanh nghiệp đi dự thầu.

Quy trình tổng thể:

```text
Tìm cơ hội
→ Quyết định tham dự/không tham dự
→ Chuẩn bị hồ sơ
→ Nộp hồ sơ
→ Làm rõ
→ Kết quả lựa chọn
→ Hợp đồng
→ Theo dõi lợi nhuận
```

Nhánh này có thể dùng chung với hệ thống dành cho Chủ đầu tư:

- bộ máy pháp lý;
- bộ máy quy tắc;
- dữ liệu Nhà thầu;
- hệ thống văn bản;
- thông báo;
- phân tích;
- nhật ký;
- phiên bản.

---

# 34. Kho năng lực doanh nghiệp

**Loại:** Mới

## Mục tiêu

Khai một lần, sử dụng nhiều lần.

Cấu trúc:

```text
DOANH NGHIỆP
├── Hồ sơ pháp lý
├── Báo cáo tài chính
├── Doanh thu
├── Hợp đồng tương tự
├── Nhân sự
├── Chứng chỉ
├── Máy móc thiết bị
├── Bảo lãnh
├── Hồ sơ thuế
└── Kinh nghiệm
```

Mỗi mục có:

- ngày hiệu lực;
- ngày hết hạn;
- file gốc;
- người cập nhật;
- đang được dùng cho Gói thầu nào;
- trạng thái hợp lệ.

Ví dụ:

> Chứng chỉ của Nguyễn Văn A sẽ hết hạn trước thời điểm dự kiến thực hiện hợp đồng.

---

# 35. Điểm phù hợp để quyết định tham dự/không tham dự

**Loại:** Mới

## Mục tiêu

Giúp doanh nghiệp trả lời:

> Gói này có phù hợp với năng lực của chúng ta không?

Ví dụ:

```text
Mức phù hợp tổng thể: 82/100

Kinh nghiệm tương tự        90%
Tài chính                   78%
Nhân sự                     100%
Thiết bị                    65%
Địa bàn                     80%
Nguồn lực đang bận          72%
Biên lợi nhuận dự kiến      68%
```

Hệ thống phải giải thích rõ:

- thiếu thiết bị nào;
- thiếu chứng chỉ nào;
- nhân sự nào đang bận;
- hợp đồng tương tự nào được tính;
- chỉ tiêu tài chính nào chưa đạt.

Không để AI tự sinh một điểm số không giải thích được.

---

# 36. Gợi ý cơ hội thầu phù hợp

**Loại:** Mới

Dựa trên Kho năng lực doanh nghiệp để tìm các gói phù hợp.

Lọc theo:

- lĩnh vực;
- địa bàn;
- giá trị;
- mã phân loại;
- loại hợp đồng;
- kinh nghiệm;
- nhân sự;
- thiết bị;
- nguồn lực hiện tại;
- biên lợi nhuận kỳ vọng.

Ví dụ:

```text
14 gói phù hợp cao
5 gói cần bổ sung năng lực
3 gói không nên tham gia
```

---

# 37. Theo dõi thay đổi gói thầu

**Loại:** Mới

Người dùng chọn một Gói thầu để theo dõi.

BiddingFlow theo dõi:

- sửa HSMT;
- gia hạn;
- thay thời điểm đóng thầu;
- văn bản làm rõ;
- sửa Kế hoạch LCNT;
- mở thầu;
- KQLCNT;
- thông tin mới liên quan.

Cảnh báo phải nói rõ **thay đổi gì**.

Không chỉ:

> Gói thầu đã cập nhật.

Mà:

> Thời điểm đóng thầu thay đổi:  
> 28/08 09:00 → 30/08 09:00

---

# 38. Hỗ trợ chuẩn bị E-HSDT

**Loại:** Mới

Dùng Kho năng lực doanh nghiệp để giảm thao tác lặp.

Có thể:

- đề xuất hợp đồng tương tự;
- đề xuất nhân sự;
- đề xuất thiết bị;
- cảnh báo chứng chỉ sắp hết hạn;
- kiểm tra tài liệu còn thiếu;
- tạo danh sách kiểm tra trước khi nộp;
- tái sử dụng dữ liệu đã xác minh.

Không tự động nộp hồ sơ lên hệ thống bên ngoài nếu chưa có kết nối chính thức và quyền phù hợp.

---

# 39. Phân tích rủi ro chi phí và hợp đồng

**Loại:** Mới

Trước khi dự thầu, theo dõi:

- giá dự kiến chào;
- giá vốn;
- chi phí vốn;
- khoản dự phòng;
- biên lợi nhuận;
- biến động nguyên vật liệu;
- nhân công;
- thời gian thanh toán.

Ví dụ kiểm tra theo kịch bản:

> Nếu giá thép tăng 8% → biên lợi nhuận còn 2,8%.

> Nếu thanh toán chậm 60 ngày → chi phí vốn tăng 420 triệu.

> Nếu tiến độ kéo dài 3 tháng → biên lợi nhuận còn 1,4%.

---

# 40. Theo dõi sức khỏe hợp đồng

**Loại:** Mới/Nâng cấp

Sau khi trúng thầu, theo dõi:

```text
Tiến độ thời gian       72%
Khối lượng hoàn thành   51%
Thanh toán              43%
```

Cảnh báo:

> **Rủi ro cao:** Thời gian đã sử dụng 72% nhưng khối lượng mới hoàn thành 51%.

Theo dõi thêm:

- nghiệm thu;
- thanh toán;
- tạm ứng;
- bảo lãnh;
- phụ lục;
- gia hạn;
- yêu cầu phát sinh/bồi hoàn;
- phạt;
- thanh lý;
- lợi nhuận thực tế.

---

# 41. Kiến trúc sản phẩm dài hạn

## 41.1. BiddingFlow dành cho Chủ đầu tư/Bên mời thầu

Đối tượng:

- Chủ đầu tư;
- Bên mời thầu;
- Đơn vị tư vấn;
- Tổ chuyên gia;
- Đơn vị thẩm định.

Quy trình:

```text
Kế hoạch
→ Gói thầu
→ Chọn quy trình
→ Kiểm tra tuân thủ
→ Văn bản
→ Đánh giá
→ Kết quả
→ Hợp đồng
→ Kiểm tra/kiểm toán
```

## 41.2. BiddingFlow dành cho Nhà thầu

Đối tượng:

- doanh nghiệp Nhà thầu;
- phòng đấu thầu;
- phòng kinh doanh;
- phòng tài chính;
- ban giám đốc.

Quy trình:

```text
Cơ hội
→ Quyết định tham dự
→ Chuẩn bị
→ Nộp hồ sơ
→ Làm rõ
→ Kết quả
→ Hợp đồng
→ Lợi nhuận
```

## 41.3. Nền tảng dùng chung

Hai nhánh sử dụng chung:

- bộ máy pháp lý;
- bộ máy quy tắc;
- hệ thống phiên bản;
- hệ thống xử lý văn bản;
- hệ thống biểu mẫu;
- dữ liệu Nhà thầu;
- tìm kiếm;
- thông báo;
- thời hạn và SLA;
- phân tích dữ liệu;
- Trợ lý AI;
- nhật ký;
- trung tâm tích hợp;
- phân quyền và phạm vi đơn vị.

---

# 42. Những nhóm tính năng phải dùng chung một nền tảng

Để tránh xây nhiều hệ thống trùng nhau:

## 42.1. Nhóm pháp lý và tuân thủ

```text
Phiên bản pháp lý
+
Cấu hình quy tắc
+
Trợ lý chọn quy trình
+
Kiểm tra HSMT
+
Trợ lý AI
```

## 42.2. Nhóm văn bản

```text
Trình thiết kế biểu mẫu
+
Phiên bản biểu mẫu
+
Bản đồ hồ sơ
+
Phát hiện văn bản lỗi thời
+
Bộ hồ sơ kiểm toán
```

## 42.3. Nhóm thời hạn

```text
Dịch vụ quản lý thời hạn
+
Rủi ro/SLA
+
Kiểm tra sẵn sàng e-GP
+
Đường găng
+
Lịch
+
Thông báo
```

## 42.4. Nhóm quản lý vụ việc

```text
Làm rõ
+
Kiến nghị
+
Nhận xét
+
Phê duyệt
+
Hạn xử lý
+
Nhật ký
```

## 42.5. Nhóm phân tích

```text
Nhà thầu 360
+
Phân tích giá
+
Gói thầu tương đồng
+
Điểm quyết định tham dự
+
Gợi ý cơ hội thầu
```

---

# 43. Lộ trình triển khai đề xuất

## Giai đoạn 0 — Hoàn thiện phần đang phát triển

1. Hệ thống văn bản;
2. Xuất bản Word;
3. chọn Kế hoạch → chọn Gói thầu;
4. tự xác định loại văn bản theo Gói thầu;
5. tái sử dụng hệ thống xử lý văn bản hiện có.

## Giai đoạn 1 — Tận dụng nền tảng hiện tại để tạo giá trị nhanh

1. So sánh phiên bản và phân tích tác động;
2. Phát hiện văn bản lỗi thời;
3. Lịch sử phiên bản biểu mẫu Word;
4. Bản nháp/Phát hành/Khôi phục biểu mẫu;
5. Trung tâm xử lý xung đột;
6. Phân tích rủi ro và SLA.

### Lý do

Đây là các tính năng tận dụng trực tiếp hệ thống BiddingFlow đang có nên:

- giá trị cao;
- ít phải xây lại;
- rủi ro thấp hơn việc mở một phân hệ hoàn toàn mới.

## Giai đoạn 2 — Nền tảng pháp lý và tuân thủ

1. Bộ máy phiên bản pháp lý;
2. Trung tâm cấu hình quy tắc;
3. Trợ lý lựa chọn hình thức/quy trình;
4. Bộ kiểm tra HSMT/E-HSMT;
5. Trợ lý AI về tuân thủ;
6. Trung tâm xung đột lợi ích.

### Sau giai đoạn này BiddingFlow phải trả lời được

- Hồ sơ này đang áp dụng bộ quy định nào?
- Bước hiện tại có phù hợp không?
- Hồ sơ còn thiếu gì?
- Có rủi ro gì?
- Căn cứ ở đâu?

## Giai đoạn 3 — Thời hạn và quy trình xử lý

1. Trung tâm sẵn sàng e-GP;
2. Trung tâm quản lý thời hạn;
3. Tiến độ phụ thuộc và đường găng;
4. Trung tâm làm rõ;
5. Trung tâm kiến nghị;
6. Tích hợp lịch;
7. Phê duyệt nhiều cấp nếu nghiệp vụ thực sự cần.

## Giai đoạn 4 — Kiểm tra và quản trị dữ liệu

1. Bộ hồ sơ kiểm tra/kiểm toán;
2. Trung tâm chất lượng dữ liệu;
3. Trung tâm thao tác hàng loạt;
4. Hoàn tác an toàn;
5. lưu trạng thái tuân thủ tại thời điểm xuất;
6. tạo chỉ mục bằng chứng và mã kiểm tra toàn vẹn.

## Giai đoạn 5 — Phân tích cho Chủ đầu tư/Bên mời thầu

1. Nhà thầu 360;
2. Phân tích và đối chuẩn giá;
3. Tìm gói thầu tương đồng;
4. Mô phỏng kịch bản đánh giá;
5. Báo cáo quản trị.

## Giai đoạn 6 — Nhánh dành cho Nhà thầu

1. Kho năng lực doanh nghiệp;
2. Gợi ý cơ hội phù hợp;
3. Điểm quyết định tham dự/không tham dự;
4. Theo dõi thay đổi gói thầu;
5. Hỗ trợ chuẩn bị E-HSDT;
6. Phân tích rủi ro chi phí/hợp đồng;
7. Theo dõi sức khỏe hợp đồng.

## Giai đoạn 7 — Tích hợp và mở rộng quy mô

1. Trung tâm tích hợp;
2. kết nối e-GP nếu có API hợp lệ;
3. kết nối kế toán;
4. kết nối phần mềm quản trị doanh nghiệp;
5. kết nối hệ thống tài liệu;
6. chữ ký số;
7. email/SMS;
8. hệ thống báo cáo;
9. lịch làm việc.

---

# 44. Các tính năng nên ưu tiên nhất nếu nguồn lực có hạn

Nếu chỉ có nguồn lực làm một số tính năng trong 12–18 tháng tới, thứ tự khuyến nghị:

1. **So sánh phiên bản và phân tích tác động thay đổi**
2. **Phát hiện văn bản lỗi thời**
3. **Bộ máy quản lý phiên bản pháp lý**
4. **Trung tâm cấu hình quy tắc**
5. **Trợ lý lựa chọn hình thức và quy trình**
6. **Bộ kiểm tra tuân thủ HSMT/E-HSMT**
7. **Trợ lý AI về tuân thủ**
8. **Trung tâm xử lý xung đột dữ liệu**
9. **Trung tâm sẵn sàng e-GP và quản lý thời hạn**
10. **Bộ hồ sơ kiểm tra/kiểm toán**
11. **Trung tâm chất lượng dữ liệu**
12. **Nhà thầu 360**

Nếu phát triển nhánh dành cho Nhà thầu:

1. **Kho năng lực doanh nghiệp**
2. **Điểm quyết định tham dự/không tham dự**
3. **Theo dõi thay đổi Gói thầu**
4. **Gợi ý cơ hội thầu phù hợp**
5. **Phân tích rủi ro chi phí/hợp đồng**

---

# 45. Cách chấm điểm để chọn tính năng nào làm trước

Mỗi tính năng có thể chấm từ 1 đến 5 theo các tiêu chí:

| Tiêu chí | Điểm 1–5 |
|---|---:|
| Giảm lỗi nghiệp vụ | |
| Giảm rủi ro pháp lý/tuân thủ | |
| Tiết kiệm thời gian | |
| Tần suất sử dụng | |
| Giá trị đối với người dùng | |
| Khả năng tạo lợi thế cạnh tranh | |
| Khả năng tận dụng nền tảng hiện có | |
| Độ khó kỹ thuật | |
| Rủi ro làm hỏng chức năng cũ | |
| Có cần thay cơ sở dữ liệu hay không | |
| Có cần kết nối hệ thống bên ngoài hay không | |
| Tác động tới quyền và bảo mật | |
| Giá trị cho báo cáo/quản trị | |
| Khả năng tạo doanh thu/gói thuê bao | |

Có thể tính theo hướng:

```text
Điểm ưu tiên
=
Giá trị nghiệp vụ
+ Giá trị tuân thủ
+ Giá trị tái sử dụng nền tảng
+ Giá trị thương mại
-
Rủi ro kỹ thuật
-
Rủi ro làm hỏng chức năng cũ
```

---

# 46. Nguyên tắc bắt buộc khi triển khai tính năng mới

Mỗi tính năng phải:

1. kiểm tra trạng thái mã nguồn mới nhất;
2. kiểm kê chức năng đã có;
3. đọc `AGENTS.md`;
4. hiểu các nguyên tắc bất biến của hệ thống;
5. tái sử dụng cấu trúc hiện có;
6. không tạo phân hệ trùng lặp;
7. kiểm tra quyền ở mọi luồng;
8. giới hạn đúng đơn vị/không gian làm việc;
9. nhận biết phiên bản nếu dữ liệu có version;
10. có thể truy vết;
11. có kiểm thử;
12. không phá làm việc ngoại tuyến;
13. không phá hàng đợi đồng bộ;
14. không làm giảm hiệu năng;
15. không hạ mức bảo mật;
16. không dùng nhãn hiển thị tiếng Việt làm định danh nghiệp vụ;
17. không để AI thay thế quy tắc xác định ở phía máy chủ;
18. mọi kết nối ngoài phải có kiểm tra dữ liệu, chống xử lý lặp và nhật ký;
19. mọi lần tự động sửa dữ liệu phải có kết quả xác định rõ ràng và có nhật ký;
20. các hành động chính thức/không thể hoàn tác phải có cơ chế giao dịch rõ ràng.

---

# 47. Những thứ chưa nên ưu tiên

## 47.1. Dashboard quá nhiều biểu đồ

Không nên thêm biểu đồ chỉ để giao diện trông đẹp.

Người dùng cần thấy trước tiên:

- việc phải làm;
- việc sắp hết hạn;
- hồ sơ còn thiếu;
- lỗi/rủi ro;
- quyết định cần phê duyệt;
- văn bản đã lỗi thời;
- cảnh báo tuân thủ.

## 47.2. Xây một trợ lý AI độc lập khác

Không tạo một chatbot thứ hai.

Trợ lý AI hiện có phải được kết nối với:

- dữ liệu đã lọc theo quyền;
- luật;
- quy tắc;
- Kế hoạch;
- Gói thầu;
- phiên bản;
- văn bản;
- đánh giá;
- hợp đồng.

## 47.3. Xây nhiều hệ thống làm cùng một việc

Không nên có:

- hai bộ máy cảnh báo;
- hai hệ thống văn bản;
- hai hệ thống phân quyền;
- hai bộ máy phiên bản;
- một hệ thống quản lý vụ việc riêng cho Làm rõ và một hệ thống khác cho Kiến nghị.

Phải dùng chung nền tảng.

## 47.4. Mở quá nhiều phân hệ mới cùng lúc

Không nên làm sản phẩm phình quá nhanh.

Chỉ mở phân hệ mới khi:

- có nhu cầu nghiệp vụ rõ;
- có khách hàng sử dụng;
- có dữ liệu đủ;
- có nguồn lực vận hành.

---

# 48. Kết luận

Sau khi hợp nhất toàn bộ các đề xuất, hướng phát triển phù hợp nhất của BiddingFlow không phải là:

```text
Càng nhiều menu càng tốt
```

mà là:

```text
Tận dụng nền tảng hiện có
+
Biết hồ sơ đang ở phiên bản nào
+
Biết quy định nào đang áp dụng
+
Biết hồ sơ đang thiếu gì
+
Biết rủi ro nằm ở đâu
+
Biết văn bản nào đã lỗi thời
+
Biết ai đang chịu trách nhiệm
+
Biết bước tiếp theo cần làm
+
Giúp người dùng ra quyết định tốt hơn
```

Điểm khác biệt dài hạn của BiddingFlow nên là:

> **BiddingFlow biết một hồ sơ đang ở đâu trong quy trình, đang dùng phiên bản nào, đang áp dụng bộ quy định nào, còn thiếu gì, có rủi ro gì, văn bản nào đã lỗi thời, ai đang chịu trách nhiệm và bước tiếp theo cần làm là gì.**

Nếu phát triển đúng hướng, BiddingFlow có thể đi từ một phần mềm quản lý đấu thầu thành một **nền tảng vận hành và hỗ trợ ra quyết định cho toàn bộ vòng đời đấu thầu**.
