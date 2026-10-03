# 0042 — Cập nhật làm rõ và gia hạn trong từng gói thầu

## Quyết định của chủ sản phẩm

Lấy yêu cầu làm rõ, trả lời làm rõ và lịch sử gia hạn từ Mua Sắm Công bằng nút riêng trong từng gói thầu. Không lấy các dữ liệu này khi thêm hoặc nhập kế hoạch. Thời gian đóng thầu ở mỗi dòng gia hạn là thời gian đóng thầu mới của lần đó. Chủ sản phẩm xác nhận phạm vi này qua yêu cầu ngày 2026-10-03 và cung cấp JSON thực của `IB2600493339`.

## Ánh xạ làm rõ

- Nguồn: `lcnt_tbmt_yclr`, nhóm `biduClarifyReqInvAndContentViewVersionDTOList`.
- Chọn đúng `notifyVersion`, `notyfyNo` và `notyfyId` của mỗi bản thông báo nguồn. Phiên bản nguồn của TBMT độc lập với phiên bản chỉnh sửa nội bộ của gói thầu. Làm rõ giữ phạm vi các phiên bản nguồn không lớn hơn phiên bản TBMT của bản ghi đang mở. Theo yêu cầu tiếp theo của chủ sản phẩm, gia hạn tổng hợp tất cả phiên bản thông báo vào một bảng, không cần chọn từng phiên bản.
- Mỗi yêu cầu nguồn tạo một dòng yêu cầu; dùng `signReqDate`, dự phòng bằng `reqDate`.
- Mỗi trả lời có `signResDate` tạo một dòng trả lời.
- Giải mã các mảng trong `clarifyReqContent` và `clarifyResContent`; câu hỏi dùng `question`, trả lời dùng `response`, kèm `subjectName`. Giữ tiêu đề `reqName` trong nội dung yêu cầu, giữ nguyên nội dung và xuống dòng. Các câu dẫn tới PDF được hiển thị nguyên văn; không suy diễn nội dung tệp đính kèm.
- `id`/`reqNo` nguồn là thông tin nhận dạng để chống thêm trùng. ID dòng lưu trữ dùng SHA-256 của gói cục bộ, mã thông báo, phiên bản nguồn, loại dòng và `reqNo` (dự phòng `id` nguồn), độc lập giữa gói thầu và giữa yêu cầu/trả lời. Không dùng trực tiếp ID nguồn làm ID lưu trữ.
- Hai yêu cầu nguồn khác nhau có cùng nội dung và thời gian đến phút vẫn giữ hai dòng riêng. Bộ thu thập frontend và lưu backend dùng ID dòng để loại bản sao, không gộp theo nội dung. Dòng cũ không có ID giữ cơ chế tương thích hiện hữu.

## Luồng sử dụng và tương thích

Nút **Cập nhật làm rõ, gia hạn từ Mua Sắm Công** nằm ngay phía trên ba bảng của phần Thông tin mời thầu, hiển thị trong chế độ xem và chỉnh sửa khi có quyền hiện hữu. Chủ sản phẩm yêu cầu một nút lấy và cập nhật tự động sau khi chốt hai endpoint. Dùng API lookup `COMPLETE ALL` hiện hữu để đọc lịch sử; frontend giữ nhận dạng phiên bản nguồn của mỗi sự kiện nhưng hiển thị chung gia hạn tất cả phiên bản. `response.data` vẫn là bản thông báo mới nhất theo contract hiện hữu. Giữ nguyên kiểm tra phiên làm việc, tổ chức, quyền và chính sách credit/raw snapshot. Phản hồi làm rõ có nhiều nhóm phiên bản được lấy một lần cho mỗi notice/process, rồi phân tích riêng từng nhóm.

Dữ liệu được gộp vào bảng đang chỉnh sửa, giữ cả dòng nhập tay và dòng chưa hoàn chỉnh. Nguồn rỗng, lỗi hoặc không nhận diện được không xóa dữ liệu hiện có. Có loading và chặn bấm lặp; bỏ kết quả khi workspace, gói, phiên bản hoặc màn hình đã đổi.

Các hàm thêm/đọc/ghi dòng nhận rõ container của màn hình đang chỉnh sửa. Cửa sổ sửa gói thầu và màn hình chi tiết có thể tồn tại đồng thời với các ID bảng trùng nhau; cập nhật ở màn hình chi tiết không được ghi vào cửa sổ đang ẩn, và lưu từ cửa sổ sửa không thu thêm dòng của màn hình khác.

Khi một dòng thủ công chưa liên kết khớp chính xác thời gian/nội dung với một dòng nguồn có ID ổn định, liên kết trong draft bằng cách dùng ID nguồn đã băm cho dòng đó; giữ nguyên thời gian và nội dung. Việc đổi ID cần lưu mới có hiệu lực. Không có tham chiếu khóa ngoại đến các ID con này trong schema/mã đã kiểm tra; mapper thay danh sách con theo contract hiện hữu. Dòng khác nội dung hoặc chưa hoàn chỉnh vẫn giữ riêng. Đây là compatibility impact đối với ID của dòng thủ công được liên kết, không đổi quyền hay giá trị hiển thị; không cần migration dữ liệu cũ. Sau save/reload và sửa nội dung, ID ổn định tiếp tục chống nhập bản sao.

Trạng thái làm rõ và gia hạn độc lập theo từng phiên bản. Nếu 00/01 có dữ liệu nhưng 02 có danh sách `null` hoặc không có nhóm làm rõ, vẫn nhập được các sự kiện đã xác nhận; thông báo phần lịch sử chưa xác nhận. Không coi `null` hoặc thiếu nhóm là danh sách rỗng có thẩm quyền.

Trong chế độ xem, một lần bấm lấy dữ liệu, gộp trên bản sao của ba danh sách rồi lưu qua luồng đồng bộ hiện hữu; không thay trực tiếp bản ghi trước xác nhận. Chỉ thông báo cập nhật thành công sau xác nhận chính thức của máy chủ và đọc lại bản ghi. Nếu không có thay đổi thì không tạo lần lưu. Khi máy chủ chưa xác nhận, giữ dữ liệu lấy được trong bản nháp để người dùng thử lưu thủ công, không tự phát lại nội dung bị từ chối.

Khi đang chỉnh sửa, nút chỉ gộp vào các bảng bản nháp và nhắc **Lưu thông tin mời thầu**; không tự lưu các nội dung người dùng đang nhập. Đây là ngoại lệ cần thiết để giữ luồng chỉnh sửa hiện hữu. Không đổi trạng thái gói thầu hoặc quyền cập nhật theo giai đoạn. Các thao tác lưu/chỉnh sửa đồng thời được chặn trong lúc cập nhật.

Không đổi schema, quyền, masking hoặc dữ liệu đọc hiện hữu. Không cần migration. Cache kết quả sử dụng phiên bản bộ phân tích mới.

## Ánh xạ và lưu gia hạn

- Nguồn LDT: `lcnt_tbmt_ttc_ldt`, operation `NOTICE_TENDER_INFO`, envelope `revisions[notifyVersion].sources.tenderInfo`. Gọi `{id: revisionId}` riêng cho từng phiên bản chính thức; không dùng ID của bản mới nhất cho mọi phiên bản.
- Khi có envelope nguồn này, đọc chính nó kể cả khi lỗi, `null`, sai cấu trúc hoặc sai nhận dạng; báo trạng thái chưa xác nhận, không dùng nguồn chi tiết khác để che lỗi. Raw bundle cũ thiếu `tenderInfo` vẫn có fallback `noticeDetail`; operation khác giữ tương thích hiện hữu. Provenance ghi operation thực sự cung cấp gia hạn.
- Thông tin chung từ `tenderInfo` sai mã/ID/phiên bản không được ghi đè thông tin của bản thông báo đúng; nguồn thô vẫn được giữ để chẩn đoán trạng thái gia hạn.
- Chỉ đọc `bidNoContractorResponse.bidNotification.delayDTOList` đã đối chiếu với JSON thực. Danh sách `bidoNotifyContractorM.delayDTOList` có thể `null` dù path lồng có dữ liệu. Không dò toàn bộ response vì bảng chào lại giá dùng các tên trường tương tự.
- Kiểm tra mã, ID và phiên bản thông báo cha; mỗi dòng phải khớp `notifyNo`, `notifyVersion` và loại `TBMT`.
- `bidCloseDelayDate` → `giaHanList[*].thoiGianDongThau`; `reason` → `lyDoGiaHan`. `bidCloseDate` của dòng là hạn trước thay đổi; thời gian đóng thầu của thông tin chung là hạn mới nhất trong bản thông báo, không thay cho hạn mới của từng sự kiện.
- Dùng `createdDate` để xếp thứ tự các sự kiện nguồn, giữ `id` để nhận diện; ID lưu trữ dùng SHA-256 của gói cục bộ, mã thông báo, phiên bản nguồn, loại extension và ID sự kiện, với prefix `gh-`.
- Khi gộp lịch sử gia hạn, xếp các thời điểm đóng thầu theo trình tự tăng dần, giữ đầy đủ giá trị và dòng đang chỉnh sửa. Thay đổi thứ tự cũng là thay đổi draft cần lưu.
- Gia hạn được gom từ tất cả `canonical.revisions`, kể cả khi gói hiện tại liên kết một bản TBMT cũ. Các ID nguồn vẫn nhận dạng theo phiên bản thực; không gắn lại nhãn dữ liệu của phiên bản mới thành bản cũ. Không thêm bộ chọn phiên bản cho bảng gia hạn. Với mẫu `IB2600493339`, cả gói liên kết 00, 01 hoặc 02 đều thấy ba lần gia hạn đã xác nhận.
- Dòng khác ID không bị gộp theo thời gian/lý do. Bản sao đúng cùng ID được loại; cùng ID nhưng nội dung xung đột bị từ chối trước khi thay lịch sử lưu trữ. Dòng legacy thiếu ID giữ fallback tương thích hiện hữu.
- Lần gia hạn nhập tay mới vẫn phải sau hạn đóng thầu hiện tại. Lịch sử nhập từ nguồn so với hạn cũ `previousClosingAt` của lần đầu, được giữ trong draft; lịch sử đã lưu và chưa đổi thời gian được xác nhận qua ID/thời điểm trong bản ghi cũ. Không so lần đầu của lịch sử với hạn đóng thầu mới nhất vì điều đó ngăn lưu lại lịch sử hợp lệ. Các lần sau vẫn phải tiến về sau, thời gian/lý do vẫn bắt buộc.
- Lưu draft có lịch sử nguồn chỉ cập nhật hạn chung khi lần gia hạn mới nhất tiến về sau hạn hiện tại. Nếu nguồn lịch sử thiếu một phiên bản, không đưa hạn đóng/mở hiện tại về hạn cũ. Khi mở lại lịch sử nguồn đã lưu, nhận dạng `gh-` và thời gian khớp bản ghi hiện hữu giữ quy tắc này ngay cả khi metadata draft đã mất.
- Sau khi tổng hợp gia hạn tất cả phiên bản, giữ quy tắc cập nhật hạn hiện hữu: lần gia hạn cuối tiến về sau hạn hiện tại thì cập nhật hạn đóng/mở. Các bộ tính timeline và rủi ro nhà thầu hiện dùng thời điểm gia hạn muộn nhất cùng hạn chung. Yêu cầu tổng hợp làm lịch sử gia hạn đầy đủ xuất hiện trong các luồng đó; không thêm ngoại lệ chỉ giữ hạn của một phiên bản cũ. Không migration; bản ghi cũ được bổ sung lịch sử khi bấm cập nhật, không tự sửa hàng loạt dữ liệu đã lưu.

## Toàn vẹn phiên bản thông báo

Mẫu `IB2600493339` gửi với ba nhãn 00/01/02 thực tế là cùng response phiên bản 02. Một response đúng mã IB nhưng có `id`, `notifyId` hoặc `notifyVersion` khác phiên bản yêu cầu không được gắn lại nhãn thành phiên bản yêu cầu. Collector dừng phần chi tiết đó với `PROCUREMENT_REVISION_INVALID`; không thay bằng dữ liệu SEARCH khi đã phát hiện sai phiên bản. Bộ phân tích Python cũng kiểm tra các trường nhận dạng hiện diện để bảo vệ cả raw bundle được đọc lại từ cache. Response cũ thiếu các trường này vẫn giữ cơ chế tương thích hiện hữu.

Danh mục `getVersionDTOS` quan sát được dùng `version` thay vì `notifyVersion`. Chỉ nhận alias này trong các danh sách phiên bản có cấu trúc đã xác định (`getVersionDTOS`, `versionList`), không dò mọi mảng có trường `version`. Phiên bản kế hoạch và `linkNotifyInfo` cũ không thay thế nhận dạng của thông báo đang trả về. Phiên bản bộ phân tích được tăng để tránh dùng lại cache kết quả đã phân tích cũ; không di chuyển hay tự sửa dữ liệu đã lưu của người dùng.

## Kiểm chứng hồi quy

`test_muasamcong_clarifications.py` kiểm tra JSON lồng nhau, phân biệt câu hỏi/trả lời, phiên bản, nguồn lỗi/rỗng, và nội dung nhiều dòng. `invitation_updates.test.mjs` kiểm tra phiên bản nguồn, workspace và gói thay đổi, merge và chống trùng. `invitation_import_action.test.mjs` kiểm tra nhập vào draft, bấm lặp, nguồn rỗng/lỗi và đóng loading. `invitation_rows_browser.test.mjs` kiểm tra nội dung nhiều dòng, escape HTML và chế độ chỉ đọc. `test_clarification_row_identity.py` chạy SQL thực để kiểm tra giữ các dòng khác ID. `package_invitation.test.mjs` kiểm tra xác nhận máy chủ và phục hồi khi lưu không hoàn tất.

`test_muasamcong_notice_identity.py` và `muasamcong_notice_identity.test.mjs` kiểm tra response 02 không thể trở thành 00/01, ID/version không khớp, liên kết kế hoạch cũ, danh mục `version` và không dùng SEARCH để che lỗi sai phiên bản.

`test_muasamcong_extensions.py` và fixture làm rõ `clarifications_IB2600493339.json` đối chiếu các ID/thời điểm/nội dung quan sát thực ở 00/01, trạng thái thiếu dữ liệu ở 02 và `COMPLETE ALL`. Gia hạn chỉ có trong `tenderInfo` ở các fixture tích hợp; lỗi/null/sai nhận dạng của nguồn chính không được che bằng nguồn cũ. `test_extension_row_identity.py` kiểm tra seam lưu/projection bằng SQL, bảo toàn scope, repeat import và rollback collision. `package_extension_validation.test.mjs` cùng test trình duyệt kiểm tra nhập lịch sử, lưu lại lịch sử và điều kiện của lần gia hạn mới. Test seam SQL dùng SQLite; không đại diện cho kiểm chứng PostgreSQL production hay thao tác cập nhật qua phiên browser production.
