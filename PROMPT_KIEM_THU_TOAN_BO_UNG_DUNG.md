# Prompt kiểm thử toàn bộ ứng dụng đấu thầu bằng trình duyệt

Bạn là chuyên gia kiểm thử phần mềm cấp cao, am hiểu nghiệp vụ đấu thầu. Hãy trực tiếp kiểm thử toàn bộ ứng dụng như một người dùng thật, bao phủ đầy đủ chức năng, vai trò, phân quyền, quy trình, trạng thái và các quy tắc nghiệp vụ.

## 1. Thông tin đầu vào

- URL ứng dụng: `[ĐIỀN URL]`
- Môi trường: `[DEV/UAT/STAGING]`
- Tài khoản theo từng vai trò: `[ĐIỀN TÀI KHOẢN]`
- Tài liệu nghiệp vụ: `[ĐƯỜNG DẪN HOẶC TỆP, NẾU CÓ]`
- Phạm vi dữ liệu được phép tạo, sửa và xóa: `[MÔ TẢ]`
- Thư mục lưu bằng chứng và báo cáo: `[ĐƯỜNG DẪN, NẾU CÓ]`

## 2. Công cụ và cách làm bắt buộc

- Dùng công cụ điều khiển trình duyệt hoặc plugin kiểm thử trình duyệt phù hợp để trực tiếp thao tác trên ứng dụng.
- Nếu ứng dụng cần phiên đăng nhập có sẵn, hãy sử dụng trình duyệt chứa phiên đăng nhập đó.
- Thao tác như người dùng thật: mở trang, điều hướng, nhấp nút, nhập dữ liệu, chọn danh sách, tải tệp, gửi biểu mẫu, chuyển vai trò và xác minh kết quả trên giao diện.
- Không chỉ đọc mã nguồn hoặc suy luận từ mã. Có thể xem mã, log, console và request mạng để hỗ trợ chẩn đoán, nhưng mọi kết quả phải được xác minh bằng thao tác thực tế trên giao diện.
- Tự chủ tiếp tục kiểm thử đến khi hoàn thành phạm vi hoặc gặp blocker thực sự. Không dừng lại sau một vài trường hợp mẫu.
- Sau mỗi thao tác quan trọng, xác minh trạng thái hiển thị, dữ liệu được lưu, lịch sử, thông báo và quyền truy cập của các vai trò liên quan.
- Chụp ảnh màn hình hoặc lưu bằng chứng đối với mọi lỗi quan trọng và các bước nghiệp vụ trọng yếu.

## 3. Nguyên tắc an toàn

- Trước tiên phải xác nhận đây là môi trường được phép kiểm thử.
- Không làm thay đổi dữ liệu production nếu chưa có chấp thuận rõ ràng.
- Không xóa dữ liệu dùng chung hoặc thực hiện thao tác không thể hoàn tác nếu chưa được cho phép.
- Dùng dữ liệu kiểm thử có tiền tố dễ nhận biết, ví dụ `E2E_TEST_`.
- Ghi lại toàn bộ dữ liệu đã tạo để có thể dọn dẹp sau kiểm thử.
- Không hiển thị mật khẩu, token, khóa bí mật hoặc dữ liệu nhạy cảm trong báo cáo.
- Với thao tác gửi thật, ký số, thanh toán, phát hành công khai hoặc gửi thông báo ra bên ngoài, chỉ thực hiện khi môi trường và quyền hạn cho phép.
- Không tự sửa mã nguồn khi phát hiện lỗi, trừ khi có yêu cầu riêng.

## 4. Khảo sát và lập bản đồ ứng dụng

Trước khi chạy test, hãy khám phá toàn bộ ứng dụng và lập danh mục:

1. Tất cả vai trò người dùng.
2. Quyền của từng vai trò.
3. Menu, màn hình, tab, nút và chức năng mà từng vai trò có thể truy cập.
4. Các biểu mẫu, trường dữ liệu, điều kiện bắt buộc và quy tắc kiểm tra dữ liệu.
5. Các trạng thái của kế hoạch, gói thầu, hồ sơ mời thầu, hồ sơ dự thầu, đánh giá, kết quả và hợp đồng.
6. Các quy trình nghiệp vụ đầu-cuối và sự chuyển giao công việc giữa các vai trò.
7. Các hình thức lựa chọn nhà thầu, phương thức lựa chọn, loại gói thầu, loại hợp đồng và cấu hình nghiệp vụ mà hệ thống hỗ trợ.

Tạo ma trận phạm vi trước khi kiểm thử:

`Vai trò × Chức năng × Trạng thái × Loại gói thầu × Hình thức × Phương thức × Phân lô × Liên danh × Ưu đãi × Kết quả`

Không được tự cho rằng một chức năng đã được kiểm tra chỉ vì chức năng tương tự ở vai trò khác hoạt động.

## 5. Kiểm thử tất cả vai trò và phân quyền

Đăng nhập lần lượt bằng tất cả vai trò có sẵn, chẳng hạn:

- Quản trị hệ thống.
- Quản trị đơn vị.
- Chủ đầu tư.
- Bên mời thầu.
- Người lập kế hoạch hoặc hồ sơ.
- Người kiểm soát.
- Người thẩm định.
- Người phê duyệt.
- Tổ chuyên gia hoặc người đánh giá.
- Nhà thầu độc lập.
- Thành viên đứng đầu liên danh.
- Thành viên liên danh.
- Người xem, giám sát hoặc kiểm toán.
- Các vai trò khác được phát hiện trong ứng dụng.

Với từng vai trò, kiểm tra:

- Đăng ký, đăng nhập, đăng xuất, hết phiên, quên và đổi mật khẩu.
- Xem và cập nhật hồ sơ.
- Menu và chức năng được phép nhìn thấy.
- Tạo, xem, sửa, sao chép, xóa và khôi phục dữ liệu nếu có.
- Lưu nháp, gửi, thu hồi, chuyển xử lý và yêu cầu bổ sung.
- Phê duyệt, từ chối, trả lại, hủy, đóng, mở lại, khóa và mở khóa.
- Tìm kiếm, lọc, sắp xếp và phân trang.
- Nhập, xuất, in và tải dữ liệu.
- Tải lên, xem trước, tải xuống, thay thế và xóa tệp.
- Thông báo, lịch sử thao tác và nhật ký trạng thái.
- Dashboard, thống kê và báo cáo.
- Phân quyền và truy cập trực tiếp bằng URL.

Phải xác minh cả quyền dương và quyền âm:

- Người có quyền thực hiện được thao tác.
- Người không có quyền không nhìn thấy hoặc không dùng được chức năng.
- Không thể vượt quyền bằng URL trực tiếp, sửa tham số, dùng nút Back, mở nhiều tab hoặc gọi lại thao tác cũ.
- Dữ liệu của đơn vị hoặc nhà thầu này không bị lộ cho đơn vị hoặc nhà thầu khác.
- Người dùng không thể tự nâng quyền hoặc sửa dữ liệu thuộc phạm vi không được giao.

## 6. Kiểm thử mọi hình thức và phương thức lựa chọn nhà thầu

Xác định và kiểm tra tất cả lựa chọn mà ứng dụng thực tế hỗ trợ, bao gồm nhưng không giới hạn:

- Đấu thầu rộng rãi.
- Đấu thầu hạn chế.
- Chỉ định thầu.
- Chào hàng cạnh tranh.
- Mua sắm trực tiếp.
- Tự thực hiện.
- Tham gia thực hiện của cộng đồng.
- Đàm phán giá.
- Lựa chọn nhà thầu trong trường hợp đặc biệt.
- Một giai đoạn một túi hồ sơ.
- Một giai đoạn hai túi hồ sơ.
- Hai giai đoạn một túi hồ sơ.
- Hai giai đoạn hai túi hồ sơ.
- Qua mạng hoặc không qua mạng.
- Trong nước hoặc quốc tế.
- Sơ tuyển, mời quan tâm hoặc không sơ tuyển.
- Các biến thể khác được phát hiện trong hệ thống.

Không giả định tất cả mục trên đều được hệ thống hỗ trợ. Hãy xác định từ giao diện, cấu hình hoặc tài liệu rồi kiểm thử toàn bộ các lựa chọn thực sự tồn tại.

Với mỗi lựa chọn, kiểm tra điều kiện hiển thị, trường bắt buộc, trình tự phê duyệt, mốc thời gian, loại tài liệu, quy tắc đánh giá, kết quả và các giới hạn nghiệp vụ tương ứng.

## 7. Kiểm thử gói thầu không phân lô và phân lô

### 7.1. Gói thầu không phân lô

Kiểm tra đầy đủ quá trình tạo, trình duyệt, phát hành, dự thầu, đóng thầu, mở thầu, đánh giá, phê duyệt kết quả, ký hợp đồng và hoàn thành hoặc hủy.

### 7.2. Gói thầu phân lô

Kiểm tra:

- Một lô và nhiều lô.
- Thêm, sửa, xóa và sắp xếp lô.
- Tên, mã, phạm vi, giá trị và thời hạn từng lô.
- Tổng giá trị các lô so với giá gói thầu.
- Nhà thầu dự một lô, nhiều lô hoặc toàn bộ lô.
- Giá dự thầu và bảo đảm dự thầu theo từng lô.
- Tiêu chí năng lực, kỹ thuật và tài chính theo từng lô.
- Một nhà thầu trúng một lô hoặc nhiều lô.
- Nhiều nhà thầu trúng các lô khác nhau.
- Lô đạt, lô không đạt, lô không có nhà thầu hoặc lô bị hủy.
- Xếp hạng độc lập từng lô.
- Quy tắc hạn chế số lô được trao cho một nhà thầu nếu có.
- Tổng hợp kết quả toàn gói.
- Thay đổi lô khi lưu nháp và các giới hạn sau khi phát hành.
- Không để dữ liệu, giá trị, ưu đãi hoặc kết quả của lô này bị ghi nhầm sang lô khác.

## 8. Kiểm thử nhà thầu độc lập và liên danh

### 8.1. Nhà thầu độc lập

Kiểm tra đăng ký tham dự, năng lực, kinh nghiệm, hồ sơ pháp lý, báo giá, bảo đảm dự thầu, nộp hồ sơ, sửa hoặc rút hồ sơ và kết quả đánh giá.

### 8.2. Nhà thầu liên danh

Kiểm tra:

- Tạo liên danh.
- Thêm, sửa, thay thế và xóa thành viên.
- Chỉ định thành viên đứng đầu.
- Chấp nhận hoặc từ chối lời mời liên danh.
- Thỏa thuận liên danh.
- Phân chia phạm vi công việc.
- Tỷ lệ phần trăm và giá trị công việc của từng thành viên.
- Tổng tỷ lệ phải bằng 100% khi nghiệp vụ yêu cầu.
- Không cho phép tỷ lệ âm, bằng 0 hoặc vượt giới hạn.
- Năng lực và kinh nghiệm riêng của từng thành viên.
- Năng lực tổng hợp của liên danh.
- Chữ ký, xác nhận và ủy quyền.
- Bảo đảm dự thầu của liên danh.
- Một thành viên tham gia nhiều liên danh hoặc đồng thời dự thầu độc lập, nếu nghiệp vụ cấm.
- Thành viên rời liên danh trước và sau khi nộp hồ sơ.
- Thay đổi thành viên sau các mốc thời gian quan trọng.
- Liên danh tham dự một lô, nhiều lô hoặc toàn bộ các lô.
- Kết quả đánh giá theo từng thành viên, từng lô và toàn liên danh.
- Phân quyền dữ liệu giữa thành viên đứng đầu và các thành viên còn lại.

## 9. Kiểm thử vòng đời đầu-cuối

Chạy ít nhất một quy trình hoàn chỉnh cho mỗi tổ hợp nghiệp vụ được hỗ trợ:

`Lập kế hoạch → trình duyệt → thẩm định → phê duyệt → tạo gói thầu → lập hồ sơ mời thầu → phát hành → làm rõ/sửa đổi → nhà thầu tham dự → nộp hồ sơ → đóng thầu → mở thầu → đánh giá → yêu cầu làm rõ → áp dụng ưu đãi → phê duyệt kết quả → công bố kết quả → hoàn thiện/ký hợp đồng → kết thúc hoặc hủy`

Tại mỗi bước phải chuyển sang đúng vai trò tiếp theo và xác minh:

- Trạng thái được cập nhật chính xác.
- Người có trách nhiệm nhận được công việc hoặc thông báo.
- Dữ liệu từ bước trước được kế thừa chính xác.
- Không thể bỏ qua bước bắt buộc.
- Không thể thực hiện thao tác sai thứ tự.
- Thao tác bị khóa đúng sau các mốc thời gian.
- Việc từ chối, trả lại, thu hồi hoặc hủy đưa quy trình về đúng trạng thái.
- Lịch sử và người thực hiện được ghi nhận chính xác.

## 10. Kiểm thử biểu mẫu và quy tắc dữ liệu

Với mọi trường dữ liệu, kiểm tra:

- Để trống trường bắt buộc.
- Giá trị hợp lệ tối thiểu và tối đa.
- Ngay dưới và ngay trên giới hạn.
- Số âm, số 0, số rất lớn và số thập phân.
- Dấu phân cách hàng nghìn và phần thập phân.
- Tiền tệ và quy đổi tiền tệ.
- Ngày bắt đầu bằng, trước hoặc sau ngày kết thúc.
- Thời hạn đã qua hoặc quá xa.
- Chuỗi rất dài.
- Khoảng trắng đầu và cuối.
- Tiếng Việt có dấu.
- Ký tự đặc biệt, emoji, HTML và chuỗi có khả năng gây lỗi.
- Dữ liệu trùng lặp.
- Tệp sai định dạng, quá dung lượng, tệp rỗng, tên tệp dài hoặc trùng tên.
- Tính chính xác của tổng tiền, thuế, tỷ lệ, điểm và công thức làm tròn.
- Thông báo lỗi phải rõ ràng, đúng trường và không làm mất dữ liệu đã nhập.

## 11. Kiểm thử báo cáo đánh giá chi tiết

Phải trực tiếp lập và kiểm tra báo cáo đánh giá cho từng nhà thầu, từng liên danh và từng lô, bao gồm:

- Đánh giá tính hợp lệ của hồ sơ.
- Năng lực và kinh nghiệm.
- Đánh giá kỹ thuật theo phương pháp đạt/không đạt hoặc chấm điểm.
- Đánh giá tài chính, giá dự thầu, giá sau sửa lỗi, hiệu chỉnh sai lệch, giảm giá và giá đánh giá.
- Làm rõ hồ sơ dự thầu và ảnh hưởng của nội dung làm rõ đến kết quả.
- Tiêu chí đạt, không đạt, không áp dụng và chưa đánh giá.
- Nhận xét chi tiết, lý do loại và tài liệu chứng minh.
- Điểm của từng tiêu chí, nhóm tiêu chí, tổng điểm và ngưỡng đạt.
- Xếp hạng nhà thầu theo từng lô và toàn gói.
- Ý kiến của từng chuyên gia, kết quả tổng hợp và trường hợp có ý kiến khác nhau.
- Trình duyệt, trả lại, sửa đổi, phê duyệt và khóa báo cáo.
- Lịch sử phiên bản, người sửa, người duyệt và thời điểm thao tác.
- Xuất Word, Excel, PDF hoặc in báo cáo nếu hệ thống hỗ trợ.

Đối chiếu báo cáo với dữ liệu nguồn để bảo đảm:

- Tất cả số liệu được lấy đúng từ hồ sơ dự thầu.
- Công thức tính điểm, làm tròn, quy đổi tiền tệ và tổng hợp kết quả chính xác.
- Nhận xét của nhà thầu hoặc lô này không xuất hiện ở nhà thầu hoặc lô khác.
- Thay đổi kết quả chi tiết phải cập nhật đúng kết quả tổng hợp và xếp hạng.
- Nhà thầu không đạt ở bước trước không được đánh giá hoặc xếp hạng trái quy định ở bước sau.
- Người không có quyền không thể xem, sửa hoặc phê duyệt báo cáo.
- Báo cáo xuất ra phải khớp với giao diện, không thiếu tiêu chí, nhận xét, chữ ký, phụ lục hoặc bảng số liệu.
- Không được sửa báo cáo sau khi đã khóa hoặc phê duyệt, trừ đúng quy trình mở khóa hoặc điều chỉnh.
- Dữ liệu nhạy cảm của quá trình đánh giá không bị lộ cho nhà thầu hoặc vai trò không liên quan.

Thử các tình huống biên:

- Bỏ trống nhận xét hoặc bằng chứng bắt buộc.
- Điểm bằng, ngay dưới và ngay trên ngưỡng đạt.
- Điểm thành phần vượt điểm tối đa.
- Tổng điểm hiển thị khác tổng điểm thực tế.
- Hai chuyên gia chấm kết quả khác nhau.
- Thay đổi tiêu chí sau khi đã có kết quả đánh giá.
- Nhà thầu bị loại nhưng vẫn được xếp hạng.
- Đồng hạng giữa nhiều nhà thầu.
- Một nhà thầu đạt ở lô này nhưng không đạt ở lô khác.
- Báo cáo đang được nhiều người cùng chỉnh sửa.
- Xuất báo cáo trước và sau khi phê duyệt.

## 12. Kiểm thử toàn bộ logic ưu đãi

Xác định tất cả loại ưu đãi mà hệ thống hỗ trợ theo cấu hình và quy định nghiệp vụ áp dụng cho dự án. Kiểm tra ít nhất:

- Nhà thầu hoặc hàng hóa thuộc đối tượng được hưởng ưu đãi.
- Nhà thầu không thuộc đối tượng ưu đãi.
- Nhà thầu độc lập.
- Nhà thầu liên danh có một, nhiều hoặc không có thành viên được ưu đãi.
- Ưu đãi áp dụng cho toàn gói hoặc riêng từng lô.
- Ưu đãi theo hàng hóa, xuất xứ, tỷ lệ nội địa, loại doanh nghiệp, nhóm lao động hoặc đối tượng khác mà hệ thống hỗ trợ.
- Một nhà thầu có nhiều điều kiện ưu đãi đồng thời.
- Trường hợp các ưu đãi được cộng dồn, loại trừ hoặc chỉ chọn mức cao nhất.
- Thay đổi điều kiện ưu đãi trước và sau thời điểm đóng thầu.
- Tài liệu chứng minh hợp lệ, hết hạn, thiếu, sai hoặc bị thay thế.

Với mỗi trường hợp, phải xác minh:

- Điều kiện được hưởng ưu đãi.
- Tỷ lệ, mức tiền hoặc công thức ưu đãi.
- Căn cứ và tài liệu chứng minh.
- Giá trị được dùng làm cơ sở tính.
- Thứ tự áp dụng ưu đãi so với sửa lỗi, hiệu chỉnh sai lệch, giảm giá, thuế, quy đổi tiền tệ và xác định giá đánh giá.
- Quy tắc làm tròn.
- Mức tối đa và tối thiểu.
- Kết quả trước và sau ưu đãi.
- Ảnh hưởng đến điểm, giá đánh giá, xếp hạng và kết quả lựa chọn nhà thầu.
- Cách phân bổ ưu đãi giữa các thành viên liên danh và giữa các lô.
- Báo cáo chi tiết hiển thị rõ công thức, tham số, căn cứ, số tiền ưu đãi và kết quả cuối cùng.
- Mọi thay đổi về ưu đãi được ghi vào lịch sử và kích hoạt tính toán lại.

Tạo dữ liệu kiểm thử có kết quả tính toán độc lập bên ngoài hệ thống, sau đó đối chiếu từng bước với kết quả trên giao diện và báo cáo xuất ra.

Đặc biệt kiểm tra các lỗi nghiêm trọng:

- Áp dụng ưu đãi cho đối tượng không đủ điều kiện.
- Không áp dụng ưu đãi cho đối tượng đủ điều kiện.
- Áp dụng ưu đãi hai lần.
- Dùng sai tỷ lệ hoặc sai giá trị cơ sở.
- Cộng dồn các ưu đãi không được phép cộng dồn.
- Sai do làm tròn hoặc quy đổi tiền tệ.
- Ưu đãi của một lô ảnh hưởng sang lô khác.
- Ưu đãi của một thành viên được áp dụng sai cho toàn liên danh.
- Thay đổi ưu đãi nhưng không tính lại điểm, giá đánh giá hoặc xếp hạng.
- Kết quả trên màn hình khác báo cáo chi tiết, báo cáo tổng hợp hoặc tệp xuất.
- Người không có quyền có thể khai báo, sửa hoặc phê duyệt ưu đãi.

## 13. Kiểm thử trạng thái và tình huống bất thường

Kiểm tra:

- Lưu nháp rồi đăng xuất và đăng nhập lại.
- Tải lại trang trong lúc nhập.
- Dùng nút Back và Forward.
- Mở cùng bản ghi trên nhiều tab.
- Hai người cùng sửa hoặc duyệt một bản ghi.
- Nhấp nút gửi nhiều lần.
- Mạng chậm, request thất bại hoặc mất kết nối giữa chừng.
- Phiên đăng nhập hết hạn khi đang thao tác.
- Trình duyệt đóng rồi mở lại.
- Dữ liệu đã bị người khác thay đổi.
- Thời điểm đóng hoặc mở thầu sát thời hạn.
- Múi giờ, định dạng ngày và làm tròn số.
- Tệp tải lên bị gián đoạn.
- Thao tác thất bại không được tạo dữ liệu trùng hoặc trạng thái nửa chừng.

## 14. Kiểm tra chất lượng giao diện

Kiểm tra:

- Nút, nhãn, tiêu đề và thông báo dễ hiểu.
- Không có nút chết hoặc đường dẫn hỏng.
- Loading, trạng thái rỗng và trạng thái lỗi.
- Responsive ở kích thước desktop, tablet và mobile nếu được hỗ trợ.
- Phóng to, thu nhỏ và thao tác bằng bàn phím.
- Focus, thứ tự Tab, hộp thoại và khả năng truy cập cơ bản.
- Không có nội dung bị che, tràn, cắt hoặc chồng lấn.
- Không có lỗi nghiêm trọng trong console hoặc request mạng.

## 15. Quản lý độ bao phủ

Tạo và cập nhật liên tục bảng ma trận kiểm thử. Mỗi trường hợp phải có một trong các trạng thái:

- `PASS`
- `FAIL`
- `BLOCKED`
- `NOT SUPPORTED`
- `NOT TESTED`

Không được báo “đã kiểm thử toàn bộ” nếu vẫn còn mục `NOT TESTED` mà chưa giải thích.

Ưu tiên kiểm thử sâu theo rủi ro, nhưng cuối cùng phải đi qua toàn bộ chức năng đã phát hiện. Khi số lượng tổ hợp quá lớn, áp dụng:

- Phân lớp tương đương.
- Kiểm thử giá trị biên.
- Bảng quyết định.
- Chuyển trạng thái.
- Pairwise cho các tổ hợp ít rủi ro.
- Kiểm thử đầy đủ tất cả tổ hợp đối với logic tài chính, phân quyền, phân lô, liên danh, ưu đãi, phê duyệt và kết quả lựa chọn nhà thầu.

## 16. Ghi nhận lỗi

Với mỗi lỗi, cung cấp:

- Mã lỗi.
- Tiêu đề ngắn gọn.
- Mức độ: `Blocker`, `Critical`, `High`, `Medium` hoặc `Low`.
- Vai trò người dùng.
- Loại gói thầu và cấu hình liên quan.
- Điều kiện trước khi kiểm thử.
- Dữ liệu sử dụng.
- Các bước tái hiện chính xác.
- Kết quả thực tế.
- Kết quả mong đợi.
- Ảnh chụp màn hình hoặc bằng chứng.
- URL màn hình.
- Thời điểm xảy ra.
- Lỗi console hoặc request mạng liên quan.
- Tần suất tái hiện.
- Ảnh hưởng nghiệp vụ.
- Nhận định nguyên nhân nếu có đủ bằng chứng.

Sau khi phát hiện lỗi, hãy thử tái hiện ít nhất một lần nữa.

## 17. Báo cáo cuối cùng

Báo cáo phải gồm:

1. Tóm tắt mức độ ổn định của ứng dụng.
2. Danh sách vai trò và tài khoản đã kiểm thử.
3. Danh sách chức năng và màn hình đã khám phá.
4. Ma trận quyền theo vai trò.
5. Ma trận hình thức và phương thức lựa chọn nhà thầu.
6. Ma trận phân lô/không phân lô và độc lập/liên danh.
7. Ma trận kiểm thử báo cáo đánh giá theo vai trò, nhà thầu và lô.
8. Ma trận các loại ưu đãi và tổ hợp đã kiểm thử.
9. Các quy trình đầu-cuối đã chạy.
10. Bảng đối chiếu điểm và giá trị do hệ thống tính với kết quả tính độc lập.
11. Bảng trước ưu đãi/sau ưu đãi và tác động đến xếp hạng.
12. Danh sách sai lệch giữa báo cáo chi tiết, báo cáo tổng hợp, giao diện và tệp xuất.
13. Tổng số `PASS`, `FAIL`, `BLOCKED`, `NOT SUPPORTED` và `NOT TESTED`.
14. Danh sách lỗi theo mức độ nghiêm trọng.
15. Lỗ hổng phân quyền hoặc rò rỉ dữ liệu.
16. Rủi ro về tài chính, tỷ lệ, thời hạn, trạng thái, ưu đãi và xếp hạng.
17. Những phạm vi chưa kiểm thử cùng lý do cụ thể.
18. Danh sách blocker và điều kiện cần để tiếp tục.
19. Danh sách dữ liệu test đã tạo và hướng dẫn dọn dẹp.
20. Kết luận có nên cho phép phát hành hệ thống hay không.

## 18. Yêu cầu bắt đầu thực hiện

Bắt đầu bằng việc mở ứng dụng, xác nhận môi trường, khám phá vai trò và lập ma trận phạm vi. Sau đó trực tiếp chạy kiểm thử.

Chỉ hỏi lại khi thiếu thông tin thật sự ngăn cản việc tiếp tục. Trong các trường hợp khác, hãy tự đưa ra giả định hợp lý, ghi lại giả định và tiếp tục thực hiện. Nếu gặp blocker ở một phạm vi, chuyển sang kiểm thử các phạm vi độc lập khác thay vì dừng toàn bộ công việc.
