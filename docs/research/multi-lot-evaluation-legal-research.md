# Nghiên cứu nghiệp vụ đánh giá gói thầu nhiều phần lô theo nhiều đợt

Ngày đối chiếu: 22/07/2026.

## 1. Phạm vi và giới hạn kết luận

Tài liệu này rà soát cơ sở pháp lý để thiết kế phần mềm cho trường hợp một gói thầu có nhiều phần lô, người dùng muốn xử lý một hoặc nhiều lô trước rồi tiếp tục các lô còn lại. Phạm vi gồm đánh giá HSDT, thẩm định, phê duyệt danh sách nhà thầu đáp ứng yêu cầu kỹ thuật, mở hồ sơ đề xuất tài chính đối với phương thức một giai đoạn hai túi hồ sơ (1G2T), thẩm định/phê duyệt kết quả lựa chọn nhà thầu (KQLCNT) và liên kết hợp đồng.

Đây là nghiên cứu sản phẩm, không thay thế ý kiến pháp lý cho một hồ sơ mời thầu (HSMT) cụ thể. Đặc biệt, các nguồn chung không nói rõ rằng mọi gói thầu đều được phép ban hành nhiều chuỗi báo cáo/quyết định chính thức ở các thời điểm khác nhau cho các nhóm lô khác nhau. Vì vậy sản phẩm phải hỗ trợ cả xử lý nháp tăng dần nhưng phê duyệt hợp nhất và xử lý chính thức theo đợt có kiểm soát; không được mặc định chế độ thứ hai luôn phù hợp.

## 2. Văn bản được dùng

- [Văn bản hợp nhất 74/VBHN-VPQH ngày 25/03/2026 — Luật Đấu thầu](https://vanban.chinhphu.vn/?classid=2629&docid=217348&pageid=27160), kèm [bản PDF chính thức](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/74-vbhn-vpqh.pdf).
- [Nghị định 214/2025/NĐ-CP](https://vanban.chinhphu.vn/?classid=1&docid=214821&orggroupid=2&pageid=27160), có hiệu lực từ ngày 04/08/2025; [bản gốc trong CSDL quốc gia về VBPL](https://vbpl.vn/FileData/TW/Lists/vbpq/Attachments/180764/VanBanGoc_214.N%C4%90_compressed.pdf).
- [Thông tư 79/2025/TT-BTC](https://vanban.chinhphu.vn/?classid=1&docid=214844&pageid=27160), hướng dẫn đăng tải thông tin và mẫu hồ sơ đấu thầu qua mạng.
- [Thông tư 80/2025/TT-BTC](https://vanban.chinhphu.vn/?classid=0&docid=214968&pageid=27160), quy định các mẫu báo cáo đánh giá và báo cáo thẩm định; [bản Công báo](https://congbao.chinhphu.vn/van-ban/thong-tu-so-80-2025-tt-btc-45967.htm).

Tại ngày đối chiếu, Cổng TTĐT Chính phủ mới công bố [dự thảo sửa đổi Nghị định 214/2025/NĐ-CP ngày 10/06/2026](https://vanban.chinhphu.vn/?pageid=30187&title=du-thao-nghi-dinh-sua-doi-bo-sung-mot-so-dieu-cua-nghi-dinh-so-214-2025-nd-cp-ngay-04-thang-8-na&vbid=7851) và ghi nhận dự thảo đã hết hạn lấy ý kiến. Dự thảo không được dùng làm quy tắc có hiệu lực cho thiết kế này.

## 3. Các kết luận pháp lý/nghiệp vụ chắc chắn

### 3.1. Phần lô là đơn vị phạm vi có tên và giá trị riêng

Điều 39 Luật Đấu thầu yêu cầu kế hoạch LCNT nêu nội dung cơ bản của từng phần và ghi giá ước tính cho từng phần trong giá gói thầu. Do đó `phan_lo` phải là thực thể có định danh ổn định; không thể chỉ là chuỗi hiển thị trên hồ sơ dự thầu.

Điều 67 Luật Đấu thầu cho phép một gói thầu chia phần được thực hiện bằng nhiều hợp đồng tương ứng với một hoặc một số phần. KQLCNT và hợp đồng vì vậy phải biểu diễn được nhiều nhà thầu trúng khác nhau và phạm vi lô của từng hợp đồng; một trường `nha_thau_trung_thau_id` ở cấp gói không đủ để làm dữ liệu chuẩn.

### 3.2. Tính độc lập hay phụ thuộc giữa các lô phải lấy từ HSMT

Khoản 8 Điều 26 Nghị định 214/2025/NĐ-CP yêu cầu HSMT nêu điều kiện chào thầu, bảo đảm dự thầu và phương pháp đánh giá cho từng phần **hoặc nhiều phần**. Quy tắc này có hai hệ quả:

1. Không được mặc định mọi lô độc lập.
2. Nếu tiêu chuẩn đánh giá, giảm giá, năng lực huy động hoặc cách tối ưu KQLCNT áp dụng cho một nhóm lô thì cả nhóm là một đơn vị phụ thuộc và không được chốt kết quả từng lô riêng lẻ làm thay đổi kết quả chung.

Điều 41 Nghị định 214/2025/NĐ-CP còn đặt việc xét duyệt gói chia phần trên tổng giá đề nghị trúng thầu/tổng giá đánh giá của gói và trần giá gói thầu đối với các lĩnh vực thông thường. Quy tắc chuyên ngành có thể khác, ví dụ mua thuốc đánh giá theo từng phần. Vì vậy phần mềm không được hard-code một công thức giá dùng cho mọi lĩnh vực; phải lưu phiên bản quy tắc lấy từ HSMT và chính sách chuyên ngành.

### 3.3. Trình tự 1G2T là chuỗi có điều kiện bắt buộc

Theo Nghị định 214/2025/NĐ-CP, tổ chuyên gia lập báo cáo đánh giá hồ sơ đề xuất kỹ thuật; danh sách nhà thầu đáp ứng yêu cầu kỹ thuật được thẩm định; chủ đầu tư phê duyệt danh sách trên cơ sở báo cáo đánh giá và báo cáo thẩm định. Chỉ nhà thầu đáp ứng kỹ thuật (hoặc nhà thầu có điểm kỹ thuật cao nhất trong phương pháp dựa trên kỹ thuật) mới được mở và đánh giá hồ sơ đề xuất tài chính.

Điều 134 và Điều 136 Nghị định 214/2025/NĐ-CP xác định danh sách nhà thầu đáp ứng yêu cầu kỹ thuật của gói 1G2T là một đối tượng phải thẩm định. Thông tư 80/2025/TT-BTC có mẫu riêng cho báo cáo thẩm định danh sách này và mẫu báo cáo đánh giá tài chính dẫn chiếu quyết định phê duyệt danh sách đạt kỹ thuật.

Vì vậy hệ thống phải chặn trình tự sai:

`Đánh giá kỹ thuật -> Báo cáo đánh giá kỹ thuật -> Thẩm định danh sách đạt kỹ thuật -> Quyết định phê duyệt -> Mở tài chính -> Đánh giá tài chính -> Thẩm định KQLCNT -> Quyết định KQLCNT`.

Một lô không có nhà thầu đạt kỹ thuật không đi vào mở/đánh giá tài chính, nhưng cũng không được tự động đồng nhất với “hủy thầu”. Hệ thống phải ghi nhận nguyên nhân không lựa chọn được và chờ quyết định xử lý phù hợp.

### 3.4. Mở E-HSĐXTC qua mạng có ràng buộc ở cấp nhà thầu

Mẫu E-HSMT ban hành theo Thông tư 79/2025/TT-BTC quy định E-HSĐXTC của **các nhà thầu có tên trong danh sách đạt kỹ thuật** được mở và công khai trên Hệ thống; biên bản mở tài chính liệt kê theo nhà thầu. Nguồn không xác nhận một cơ chế chung cho phép ứng dụng bên ngoài tự mở một phần giá trong cùng E-HSĐXTC theo lô.

Do đó, đối với gói qua mạng, phần mềm nội bộ chỉ được **ghi nhận** sự kiện mở tài chính và phạm vi do Hệ thống mạng đấu thầu quốc gia thực tế trả về. Trước khi cho phép một đợt 1G2T tiến qua bước này, phải kiểm tra:

- danh sách đạt kỹ thuật đã được thẩm định và phê duyệt;
- nhà thầu nào tham dự đồng thời lô được chọn và lô còn chờ;
- thao tác mở trên Hệ thống có làm lộ đề xuất tài chính của lô còn chờ hay không;
- các lô có thuộc cùng một nhóm đánh giá/giảm giá/năng lực hay không.

Nếu không chứng minh được tính tách biệt, các lô liên quan phải được gộp thành cùng một “nhóm phụ thuộc mở tài chính”. Đây là cổng nghiệp vụ bắt buộc, không phải cảnh báo có thể bỏ qua.

### 3.5. Báo cáo, thẩm định và quyết định phải có phạm vi truy nguyên được

Luật quy định chuỗi trình, thẩm định, phê duyệt và công khai KQLCNT. Các mẫu của Thông tư 80/2025/TT-BTC được lập theo tên gói thầu và danh sách nhà thầu, nhưng không phải là lý do để phần mềm làm mất phạm vi phần lô. Khi một hồ sơ chỉ xử lý một số lô, bản xuất phải thể hiện rõ mã/tên các lô thuộc phạm vi và danh sách nhà thầu theo cặp nhà thầu–lô.

Số/ngày báo cáo, số/ngày quyết định và biên bản mở tài chính là dữ liệu của một hồ sơ nghiệp vụ có phạm vi, không phải thuộc tính đơn nhất của toàn gói. Sau khi phát hành, hồ sơ phải bất biến; sửa sai bằng bản thay thế/hủy hiệu lực có lý do và liên kết phiên bản.

## 4. Điểm pháp luật không nên suy diễn

Qua các văn bản chung đã rà soát, chưa thấy quy định nói rõ mọi gói thầu chia phần được tự do ban hành nhiều chuỗi phê duyệt chính thức ở các thời điểm khác nhau cho các nhóm lô tùy chọn. Các văn bản xác nhận phần lô là phạm vi đánh giá/hợp đồng và HSMT có thể quy định đánh giá theo từng phần hoặc nhiều phần; điều này chưa đủ để bỏ qua cách tổ chức quy trình, biểu mẫu và thao tác thực tế trên Hệ thống mạng đấu thầu quốc gia.

Thiết kế an toàn phải có hai chế độ:

- `CONSOLIDATED_APPROVAL`: người dùng chấm và lưu nháp theo từng nhóm lô, nhưng chỉ phát hành báo cáo/quyết định chính thức khi phạm vi hợp nhất đã sẵn sàng.
- `STAGED_APPROVAL`: phát hành hồ sơ chính thức theo từng đợt lô, chỉ bật khi HSMT, quy tắc chuyên ngành, thao tác trên Hệ thống và ý kiến nghiệp vụ của đơn vị xác nhận các lô có thể tách.

Mặc định nên là `CONSOLIDATED_APPROVAL`. Việc bật `STAGED_APPROVAL` phải lưu người xác nhận, căn cứ, thời điểm và phạm vi áp dụng.

## 5. Các invariant phải được phần mềm thực thi

1. Mỗi kết quả đánh giá gắn với `bid_id + lot_id + stage + revision`; không dùng một kết luận toàn nhà thầu cho mọi lô.
2. Mỗi hồ sơ chính thức có tập `lot_id` rõ ràng, snapshot dữ liệu và mã băm; tập lô không được đổi sau khi phát hành.
3. Mọi lô ở bước sau phải có căn cứ hợp lệ ở bước trước; phạm vi bước sau chỉ được bằng hoặc là tập con hợp lệ của bước trước.
4. 1G2T không được ghi nhận mở tài chính trước quyết định phê duyệt danh sách đạt kỹ thuật.
5. Một lô không được tham gia đồng thời hai đợt chính thức đang hoạt động trong cùng vòng đời.
6. Nếu lô nằm trong nhóm phụ thuộc, thao tác phải bao phủ toàn nhóm.
7. KQLCNT cho phép nhà thầu trúng khác nhau giữa các lô; tổng giá cấp gói là số dẫn xuất, không phải dữ liệu nhập độc lập.
8. “Không lựa chọn được nhà thầu”, “hủy phần lô”, “tổ chức lựa chọn lại” và “hủy toàn gói” là các kết quả/quyết định khác nhau.
9. Chỉ đánh dấu toàn gói hoàn tất khi mọi lô đã có kết quả cuối cùng hợp lệ; có kết quả một số lô chỉ là hoàn tất một phần.
10. Hợp đồng phải chỉ rõ một hoặc nhiều lô được bao phủ và nhà thầu hợp đồng phải khớp KQLCNT của các lô đó.

## 6. Câu hỏi bắt buộc chốt với nghiệp vụ/pháp chế trước rollout

1. Những loại gói/lĩnh vực nào của đơn vị được phép dùng `STAGED_APPROVAL`?
2. HSMT và E-HSMT hiện thể hiện phạm vi quyết định/báo cáo theo lô ra sao?
3. Hệ thống mạng đấu thầu quốc gia có cho mở E-HSĐXTC theo cặp nhà thầu–lô trong trường hợp thực tế của đơn vị không?
4. Khi một nhà thầu dự nhiều lô, điều kiện năng lực, giảm giá và giới hạn trao thầu có tạo phụ thuộc chéo không?
5. Một quyết định KQLCNT có thể bao phủ một đợt lô hay đơn vị yêu cầu một quyết định hợp nhất cho toàn gói?
6. Quy trình xử lý lô không có nhà thầu/không đạt/vượt giá là không lựa chọn, hủy phần lô hay điều chỉnh kế hoạch để tổ chức lại trong từng lĩnh vực?

Các câu trả lời phải được cấu hình thành chính sách có phiên bản, không ghi bằng điều kiện rải rác trong giao diện.
