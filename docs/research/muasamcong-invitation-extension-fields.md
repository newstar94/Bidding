# Ánh xạ gia hạn và làm rõ từ Mua Sắm Công vào BiddingFlow

Ngày đối chiếu: 2026-10-03. Nguồn chính: JSON do chủ sản phẩm cung cấp cho `IB2600493339`, đối chiếu DOM trình duyệt đã đọc trong phiên trước. Ánh xạ đã triển khai cục bộ, chưa triển khai máy chủ hoặc kiểm chứng luồng cập nhật trên môi trường production.

## Bằng chứng JSON thực

| Tệp nguồn | Phiên bản | ID bản thông báo | SHA-256 tệp đầy đủ |
| --- | --- | --- | --- |
| Attachment `2926cf0c-5940-4f39-b547-1ae2a4e70b67` | 00 | `3a8a45a8-adb2-474d-bc57-e38cb8959cf3` | `12e34b0dacfa1f498da163264a8faf6d628e5897d1da18b9348ea18fe779a7a6` |
| Attachment `d09d9d6b-598a-41f2-8fd6-4604152bd2c4` | 01 | `bb78355e-90b4-416a-97a7-929cd64acaca` | `dd7e99e3adf5441e56975ef0937e7309d059f25fdbb80967dcde7cb73e143618` |
| Attachment `6d459868-2162-43ba-998a-3fd0c8b64065` | 02 | `217db3f1-9b19-4c93-a9e8-be3acc456da9` | `e59f613098f4eb013702bbfbfb6bfce4ca7dcf4050a2501db8e056e34668018f` |
| Attachment `71fdb948-8dbb-4901-bb0a-d9ec3a19f9b1`, phản hồi làm rõ chung | Nhóm 01 và 00 | ID mỗi dòng khớp bản thông báo tương ứng | `b806163b5c8f5ac3f8c84ee66ccdce58554b5802d72a37b7a1cbad8b1527c45b` |

Tên tệp trong mỗi attachment là `Văn bản đã dán.txt`, trong `C:/Users/newst/.codex/attachments/`. Test lưu fixture làm rõ chỉ gồm các trường cần cho nhận dạng/ngày/nội dung; hash trên là tệp đầy đủ gốc, không phải fixture rút gọn.

## Gia hạn: parent và ý nghĩa trường

Endpoint do chủ sản phẩm xác nhận: [lcnt_tbmt_ttc_ldt](https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/lcnt_tbmt_ttc_ldt), operation `NOTICE_TENDER_INFO`. Collector gọi `{id: revisionId}` riêng cho 00/01/02 và lưu phản hồi trong `revisions[notifyVersion].sources.tenderInfo`. Các phản hồi gia hạn dương ở bảng dưới được đặt vào envelope này khi kiểm tra pipeline; `noticeDetail` chỉ cung cấp thông tin nhận dạng gốc.

Ưu tiên envelope `tenderInfo` cho gia hạn LDT và ghi provenance đúng operation. Khi nguồn này lỗi/null/sai cấu trúc/sai phiên bản, báo chưa xác nhận; không fallback để che trạng thái. Raw bundle cũ không có `tenderInfo` giữ fallback `noticeDetail`; nguồn của quy trình khác giữ tương thích cũ. Thông tin chung của `tenderInfo` sai nhận dạng không ghi đè giá hoặc các trường của bản thông báo đang chọn.

Path đã xác nhận: `$.bidNoContractorResponse.bidNotification.delayDTOList`. Path `$.bidoNotifyContractorM.delayDTOList` là `null` ở cả hai response 00/01 có gia hạn. Không dùng path root này để kết luận không có gia hạn; không dò toàn bộ response vì bảng chào lại giá cũng dùng các tên thời gian tương tự.

| Trường nguồn của từng phần tử | Trường/ý nghĩa đích |
| --- | --- |
| `id` | ID sự kiện nguồn; ID lưu BiddingFlow được băm theo gói/mã/phiên bản/loại/ID nguồn |
| `bidCloseDelayDate` | `giaHanList[*].thoiGianDongThau`, **hạn đóng thầu mới** |
| `reason` | `giaHanList[*].lyDoGiaHan`, nguyên văn |
| `bidCloseDate` | Hạn cũ của lần gia hạn, dùng kiểm tra baseline trong draft |
| `createdDate` | Thời điểm tạo/ghi nhận bản ghi, dùng sắp nguồn; không kết luận là thời điểm công bố chính thức chỉ từ JSON |
| `bidOpenDelayDate` | Thời điểm mở mới trong nguồn; bảng gia hạn hiện hữu chỉ có thời gian đóng và lý do |
| `notifyNo`, `notifyVersion`, `notifyType` | Phải khớp mã/phiên bản đang phân tích và loại `TBMT` |

| Phiên bản | ID sự kiện | Ghi nhận | Đóng cũ | Đóng mới | Lý do nguyên văn |
| --- | --- | --- | --- | --- | --- |
| 00 | `b0d28818-c8b5-4624-b347-df1b5bc94474` | 17/09/2026 15:21:32.535 | 18/09/2026 10:00 | 28/09/2026 10:00 | Gia hạn thời gian đóng, mở thầu để điều chỉnh E-HSMT |
| 01 | `97e9b307-3e08-4de0-8c2d-f2272a53e3f0` | 27/09/2026 13:02:05.194 | 28/09/2026 10:00 | 01/10/2026 10:00 | Gia hạn thời điểm đóng mở thầu để trả lời yêu cầu làm rõ E-HSMT đảm bảo đúng thời gian quy định |
| 01 | `e87ff07d-6e1d-4ed6-a839-d5e034967162` | 29/09/2026 17:00:25.708 | 01/10/2026 10:00 | 12/10/2026 09:00 | Gia hạn thời điểm đóng thầu để sửa đổi E-HSMT |

Phần thông tin chung của 00 đóng 28/09; của 01 và 02 đóng 12/10. Giá trị chung là hạn mới nhất của bản thông báo, không phải hạn mới cho mọi dòng lịch sử. Response 02 có danh sách `null`: trạng thái chưa xác nhận, không phải danh sách rỗng có thẩm quyền.

## Làm rõ: phân nhóm và nội dung

Endpoint hiện hữu: `lcnt_tbmt_yclr`. Path nhóm: `biduClarifyReqInvAndContentViewVersionDTOList`; mỗi nhóm có `notifyVersion` và `biduClarifyReqInvAndContentViewList`. Response cung cấp cả 01 và 00, không có nhóm 02.

| Phiên bản | Mã yêu cầu | Thời gian yêu cầu (`signReqDate`) | Thời gian trả lời (`signResDate`) | Tiêu đề `reqName` |
| --- | --- | --- | --- | --- |
| 00 | `CID2600012195` | 13/09/2026 11:16:44 | 15/09/2026 16:48:06 | Đề nghị Chủ đầu tư làm rõ một số yêu cầu kỹ thuật Công nghệ đối với hạ tầng Cloud |
| 00 | `CID2600012277` | 14/09/2026 17:37:09 | 19/09/2026 09:34:21 | Đề nghị làm rõ E-HSMT |
| 01 | `CID2600012555` | 19/09/2026 11:55:01 | 28/09/2026 19:58:58 | Đề nghị Chủ đầu tư làm rõ một số nội dung yêu cầu trong HSMT |

- `notyfyNo` (đúng cách viết trong nguồn), `notyfyId`, phiên bản nhóm xác định đúng bản thông báo; không dùng ID/chỉ số câu hỏi con thay cho ID yêu cầu.
- `signReqDate` ánh xạ `thoiGianYeuCau`, dự phòng `reqDate`; `signResDate` ánh xạ `thoiGianTraLoi`. Chỉ nhập trả lời đã có thời điểm ký.
- `clarifyReqContent`/`clarifyResContent` là chuỗi JSON chứa mảng chủ đề. Câu hỏi dùng `question`, trả lời dùng `response`, có `subjectName`. Tiêu đề `reqName` được giữ trong nội dung yêu cầu. Mỗi yêu cầu nguồn tạo một dòng, toàn bộ chủ đề được ghép với xuống dòng.
- Trong mẫu này, câu hỏi/trả lời chỉ dẫn tới PDF đính kèm (ví dụ “Chi tiết tại file đính kèm”). Nguồn có tên và ID tệp nhưng không chứa phần văn bản trong PDF. Không giả lập nội dung PDF, không tự tạo URL tải chưa xác minh. Việc đọc/đính kèm PDF chưa nằm trong phần đã hoàn tất.
- Khóa nguồn gồm phiên bản và CID/ID; hai yêu cầu khác nhau có cùng câu trả lời vẫn là hai dòng. ID `lr-<SHA256>` độc lập giữa request/response và giữa các gói.

## Luồng cập nhật đã triển khai

Nút **Cập nhật làm rõ, gia hạn từ Mua Sắm Công** hiển thị ngay trên ba bảng trong phần Thông tin mời thầu của từng gói có quyền cập nhật hiện hữu; không lấy lúc thêm kế hoạch. Lookup `COMPLETE ALL` đọc các phiên bản. Gia hạn tổng hợp tất cả phiên bản thông báo trong một bảng, không cần chọn 00/01/02; làm rõ giữ phạm vi các nhóm không lớn hơn phiên bản nguồn của bản ghi hiện tại. Cả gói liên kết 00, 01 hoặc 02 đều nhận ba lần gia hạn của mẫu thực. Với gói 02, mẫu còn cho 3 yêu cầu và 3 trả lời từ 00/01, đồng thời báo chưa xác nhận phần riêng của 02.

Có loading lấy/điền/lưu, chặn bấm lặp và thao tác đồng thời, guard đổi workspace/gói/version, không xóa dữ liệu khi nguồn thiếu/lỗi/rỗng. Trong chế độ xem, nút gộp trên bản sao và tự lưu khi có thay đổi; chỉ báo thành công sau xác nhận máy chủ và đọc lại bản ghi. Nếu lưu chưa được xác nhận, giữ dữ liệu lấy được trong draft để thử lưu thủ công, không tự replay. Khi đang chỉnh sửa, lấy dữ liệu chỉ điền draft; bấm **Lưu thông tin mời thầu** mới đồng bộ để không tự lưu nội dung đang nhập. Dòng thủ công được bảo toàn; dòng nguồn dùng ID ổn định chống nhập lại sau save/reload và sau chỉnh nội dung. Thứ tự gia hạn được kiểm tra tăng dần; lịch sử cũ không so với hạn chung đã được gia hạn. Nếu lịch sử nguồn chưa đầy đủ, nhập lịch sử không đưa hạn đóng/mở hiện tại lùi về trước.

Contract API hiện hữu `response.data` vẫn là revision mới nhất; không thay schema/quyền/masking. Parser hiện tại `2026.10.03.5` làm mới cache đã phân tích.

Gia hạn tổng hợp giữ quy tắc cập nhật hạn hiện hữu: hạn mới cuối cùng tiến về sau thì cập nhật hạn đóng/mở; nguồn lịch sử thiếu không kéo hạn hiện tại về trước. Timeline và kiểm tra rủi ro nhà thầu vốn dùng thời điểm gia hạn muộn nhất cùng hạn chung, nên lịch sử đầy đủ được sử dụng trong các luồng đó. Không tạo quy tắc riêng giữ hạn của phiên bản nguồn cũ.

## Kiểm chứng và giới hạn

Đọc trực tiếp ba tệp gia hạn và tệp làm rõ đầy đủ, đặt gia hạn trong `sources.tenderInfo` còn `noticeDetail` chỉ có root nhận dạng, chạy qua parser production rồi frontend lookup/merge/validation cục bộ. Cả mục tiêu 00/01/02 đều có ba hạn mới; mục tiêu 02 có 3/3/3 yêu cầu/trả lời/gia hạn. Nhập lại sau mô phỏng canonical reload và sửa nội dung không thêm bản sao. Bộ kiểm tra hiện tại đạt 271 test Python và 123 test JavaScript; bản dựng secure đạt. Test trình duyệt cục bộ kiểm tra nút ngay chế độ xem, chờ xác nhận lưu, ba bảng và lỗi tải lại sau commit. Các regression còn gồm ALL/INVITATION, parent/revision mismatch, nguồn lỗi/null/empty, nội dung nhiều dòng/escape, readonly, ID lưu/transaction rollback và canonical-save failure. Test persistence seam dùng SQLite; chưa kiểm chứng PostgreSQL production hoặc phiên live update sau bản sửa.

Điều khiển Edge lần cuối bị công cụ dừng vì không xác minh được URL hiện tại. Không tiếp tục UI sau policy stop; phản hồi làm rõ do chủ sản phẩm gửi đã cung cấp bằng chứng JSON cần thiết. Không dựng dữ liệu từ DOM hay suy ra gia hạn từ chênh lệch thời gian giữa các bản thông báo.

## Lịch sử nghiên cứu trước khi nhận mẫu dương

Các ghi nhận dưới đây thuộc bước nghiên cứu trước khi chủ sản phẩm gửi response 00/01 và làm rõ ở trên. Những giới hạn thiếu JSON trong ghi nhận này đã được giải quyết bởi các tệp mới; giới hạn điều khiển/browser production vẫn giữ nguyên.

## Kết quả đã xác minh

Template trang công khai **Lựa chọn nhà thầu** của Mua Sắm Công hiển thị một hàng cho mỗi lần gia hạn. Các binding sau được đọc trực tiếp trong bảng gia hạn của [trang chính thức IB2400544735][msc-notice], tại phần “Thông tin gia hạn” (bản trích trang: dòng 537–545):

| Binding chính thức | Ý nghĩa trên bảng |
| --- | --- |
| `it.createdDate` | Ngày ghi nhận việc gia hạn |
| `it.bidCloseDate` | Hạn đóng trước thay đổi |
| `it.bidCloseDelayDate` | Hạn đóng mới của lần gia hạn |
| `it.bidOpenDate` | Giờ mở trước thay đổi |
| `it.bidOpenDelayDate` | Giờ mở mới |
| `it.reason` | Nội dung giải thích gia hạn |

Chỉ số hiển thị được tính bằng `index + 1`. Binding xác nhận tên trường và ý nghĩa của cột; nội dung crawler còn chứa biểu thức Vue, chưa cung cấp giá trị thực của hàng gia hạn hay tên danh sách cha.

Đối chiếu thêm [trang chính thức IB2600233351][msc-notice-2026], được web tool đọc ngày kiểm tra: phần gia hạn tại dòng 534–542 có cùng các binding. URL này cung cấp `notifyId = "2c75c5b7-6726-4114-9095-ea482479a166"`, `processApply = "LDT"`; chưa chứng minh notice đó có lịch sử gia hạn. Các bảng chào lại giá ở phần khác của cùng template cũng dùng `bidCloseDelayDate`, vì vậy phải kiểm tra đúng parent path khi map.

## Payload nguồn đã quan sát

Root đã lấy một bản ghi qua **runtime Mua Sắm Công hiện hữu**, operation `NOTICE_LDT_DETAIL`, cho `IB2600271825`, `notifyVersion = "00"`, `processApply = "LDT"`. Tôi đã đọc lại tệp nguồn và xác nhận:

```json
{
  "bidoNotifyContractorM.delayDTOList": null,
  "bidNoContractorResponse.bidNotification.delayDTOList": null
}
```

Đây là cách trình bày hai JSON path đã quan sát, không phải JSON response đầy đủ. Các path thực là `$.bidoNotifyContractorM.delayDTOList` và `$.bidNoContractorResponse.bidNotification.delayDTOList`.

Bằng chứng cục bộ: `C:/Users/newst/AppData/Local/Temp/bidding-extension-notice-IB2600271825.json`; SHA-256 `4754a926ae1ed58fbb4ad71fe6d9e956fb773b0d474f1b31dd0fa6aba0b38e7d`. Tệp ở thư mục tạm, không bảo đảm tồn tại lâu dài. Ghi nhận chỉ cho thấy hai danh sách null ở mẫu này, chưa chứng minh schema của phần tử hay điều kiện hiện diện.

Endpoint chính thức hiện được connector sử dụng: [NOTICE_LDT_DETAIL][msc-detail-api]. Request hiện hữu `{id: revisionId}`; không thêm endpoint đoán hoặc gọi login.

## Đối chiếu trực tiếp IB2600493339 trên trình duyệt

Ngày 2026-10-03, plugin trình duyệt trong ứng dụng đã mở được [đường dẫn chi tiết do chủ sản phẩm gửi][msc-notice-IB2600493339]. Đã chọn 01, 00, 02 trong bộ chọn “Phiên bản thay đổi”, chờ dữ liệu của mỗi lần đổi và kiểm tra ngày đăng tải tương ứng. Các thông tin sau đọc từ DOM hiển thị, **không phải JSON response**:

| Phiên bản được chọn | Đăng tải | Đóng thầu trên trang | Bảng gia hạn hiển thị |
| --- | --- | --- | --- |
| 00 | 29/08/2026 13:27 | 28/09/2026 10:00 | 1 dòng |
| 01 | 17/09/2026 20:22 | 12/10/2026 09:00 | 2 dòng |
| 02 | 01/10/2026 22:01 | 12/10/2026 09:00 | Không có bảng gia hạn trong DOM đã đọc |

Các dòng gia hạn trên trang:

| Phiên bản | Lần | Ghi nhận gia hạn | Đóng thầu cũ | Đóng thầu mới | Lý do nguyên văn |
| --- | --- | --- | --- | --- | --- |
| 00 | 1 | 17/09/2026 15:21 | 18/09/2026 10:00 | 28/09/2026 10:00 | Gia hạn thời gian đóng, mở thầu để điều chỉnh E-HSMT |
| 01 | 1 | 27/09/2026 13:02 | 28/09/2026 10:00 | 01/10/2026 10:00 | Gia hạn thời điểm đóng mở thầu để trả lời yêu cầu làm rõ E-HSMT đảm bảo đúng thời gian quy định |
| 01 | 2 | 29/09/2026 17:00 | 01/10/2026 10:00 | 12/10/2026 09:00 | Gia hạn thời điểm đóng thầu để sửa đổi E-HSMT |

Tab “Làm rõ HSMT” hiển thị cả các nhóm 01 và 00 kể cả khi bộ chọn thông báo là 02: nhóm 01 có 1 yêu cầu (19/09/2026, trả lời 28/09/2026); nhóm 00 có 2 yêu cầu (14/09/2026, trả lời 19/09/2026; 13/09/2026, trả lời 15/09/2026). Chưa thấy nhóm 02 trong DOM của tab này. Không dùng nhãn phiên bản đang chọn trên tab thông tin chung để gắn lại phiên bản cho mọi yêu cầu làm rõ.

Ba attachment chủ sản phẩm gửi với nhãn 02/01/00 đều giống nhau từng byte (17.786 byte, SHA-256 `e59f613098f4eb013702bbfbfb6bfce4ca7dcf4050a2501db8e056e34668018f`). Cả ba là `bidoNotifyContractorM.notifyVersion = "02"`, ID `217db3f1-9b19-4c93-a9e8-be3acc456da9`, hai path `delayDTOList` đều null. Danh mục `getVersionDTOS` cung cấp ID 01 `bb78355e-90b4-416a-97a7-929cd64acaca` và 00 `3a8a45a8-adb2-474d-bc57-e38cb8959cf3`; danh mục không chứa nội dung chi tiết của các phiên bản đó. Do đó ba attachment không thay thế được response thật của 00/01.

Plugin Edge báo `Codex auth token is unavailable`. Trình duyệt trong ứng dụng đọc được DOM nhưng API công khai của plugin không cung cấp Network response; nhấn F12 không mở DevTools trong mặt phẳng điều khiển. Các POST không kèm session tới đúng 3 ID và `lcnt_tbmt_yclr` đều trả HTTP 400. Chưa thu được JSON thô có phần tử gia hạn. Bằng chứng DOM xác nhận các sự kiện có thật và thuộc từng phiên bản; vẫn cần response có phần tử để xác nhận parent path, ID và kiểu dữ liệu trước khi map tự động. Không dựng raw JSON từ nội dung hiển thị và không suy ra gia hạn bằng chênh lệch thời gian giữa các phiên bản.

## Đối chiếu mã nguồn hiện hữu

Các số dòng dưới đây được kiểm tra trên working tree ngày nêu trên:

- `backend/integrations/muasamcong_browser/endpoint_catalog.mjs:37–39`: operation `NOTICE_LDT_DETAIL`, path `/expose/lcnt/bid-po-bido-notify-contractor-view/get-by-id`.
- `backend/integrations/muasamcong_browser/collectors.mjs:493–525`: chọn notice detail đúng `noticeNo` và `revisionId`, trả raw response.
- `backend/integrations/muasamcong_browser/collectors.mjs:1103–1115`: nhánh LDT lấy `NOTICE_TENDER_INFO`, `NOTICE_HSMT`; chưa có operation gia hạn riêng trong catalog.
- `backend/integrations/muasamcong_browser/canonical.py:1020`: `bidCloseDate` hiện được map thành `bidClosingAt` của thông báo. Đây là thời điểm của notice, chưa phải danh sách lịch sử gia hạn.
- `frontend/shared/FormSubTables.js:205–244`: editor gia hạn sử dụng `{id, thoiGianDongThau, lyDoGiaHan}`.
- `backend/sync/mapper.py:562–593`: lưu danh sách gia hạn vào `goi_thau_gia_han`, thời gian từ `thoiGianDongThau`, lý do từ `lyDoGiaHan`, và thứ tự danh sách qua `sort_order`.
- `backend/sync/child_projection.py:155–163`: projection đọc lại đúng hai trường gia hạn này.

## Hợp đồng trường có thể chuẩn bị, chưa đủ bằng chứng để triển khai

Ứng viên mapping, dựa trên ý nghĩa binding chính thức:

| Trường đích BiddingFlow | Trường nguồn ứng viên | Mức bằng chứng |
| --- | --- | --- |
| `giaHanList[*].thoiGianDongThau` | phần tử gia hạn `.bidCloseDelayDate` | Tên/ý nghĩa xác nhận qua template; chưa quan sát phần tử JSON |
| `giaHanList[*].lyDoGiaHan` | cùng phần tử `.reason` | Tên/ý nghĩa xác nhận qua template; chưa quan sát phần tử JSON |
| Thứ tự từng lần | danh sách nguồn / thời điểm `.createdDate` | Template có chỉ số; chưa xác minh ordering của API |
| ID/provenance | ID của phần tử nguồn | Chưa xác định từ mẫu null |

Cần ít nhất một payload `delayDTOList` có phần tử để chốt: parent path chính thức cho LDT/KHAC; ID; liên hệ với đúng notice version; ordering; kiểu timestamp; có null/trống trong `reason`; và việc hai danh sách trong cùng response là bản sao hay hai nguồn khác nhau. Không suy ra từng lần gia hạn bằng cách so sánh `notifyVersion`, hoặc tự điền lý do từ thay đổi `bidCloseDate`.

## Giới hạn kiểm tra trực tiếp

Một GET HTML thông thường bằng TLS mặc định thất bại `DH_KEY_TOO_SMALL`. GET dùng TLS policy có xác minh chứng chỉ hiện hữu tại `backend/shared/muasamcong_tls.py` trả HTTP 200 nhưng chỉ có 730 ký tự, không có binding hay script `egp`. Không xử lý/bỏ qua trang xác minh. IAB không khả dụng; Edge tạo tab bị công cụ cục bộ từ chối vì thiếu Codex auth token. Nguồn binding ở trên do web tool đọc trang chính thức; payload null được runtime hiện hữu đọc độc lập.

Thử tiếp một browser Edge headless mới qua Playwright, điều hướng công khai bình thường đến trang IB2600233351: HTTP 200, title `Error`, HTML 758 ký tự; không có script `egp`/`contractor`, `bidCloseDelayDate` hay `delayDTOList`. Browser được đóng sau lượt đọc. Không đăng nhập, không giải challenge, không đổi fingerprint/stealth và không lấy token. Lượt này chưa cung cấp bằng chứng JS bổ sung.

[msc-notice]: https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&bidForm=DTRR&bidMode=1_MTHS&bidOpenId=1331e818-5610-4d23-a9bd-5d6602c527d6&bidPreNotifyResultId=undefined&bidPreOpenId=undefined&caseKHKQ=undefined&id=f4514c0a-781b-4d4b-994c-169899aef98f&inputResultId=5c4d8dd5-ec71-423a-9a29-a360a025ebb9&isInternet=1&notifyId=f4514c0a-781b-4d4b-994c-169899aef98f&notifyNo=IB2400544735&p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_mode=view&p_p_state=normal&planNo=PL2400275279&pno=undefined&processApply=LDT&step=tbmt&stepCode=notify-contractor-step-4-kqlcnt&techReqId=undefined&type=es-notify-contractor
[msc-detail-api]: https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/expose/lcnt/bid-po-bido-notify-contractor-view/get-by-id
[msc-notice-IB2600493339]: https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&type=es-notify-contractor&stepCode=notify-contractor-step-1-tbmt&id=217db3f1-9b19-4c93-a9e8-be3acc456da9&notifyId=217db3f1-9b19-4c93-a9e8-be3acc456da9&inputResultId=undefined&bidOpenId=undefined&techReqId=undefined&bidPreNotifyResultId=undefined&bidPreOpenId=undefined&processApply=LDT&bidMode=1_MTHS&notifyNo=IB2600493339&planNo=PL2600275637&pno=undefined&step=tbmt&isInternet=1&caseKHKQ=undefined&bidForm=DTRR
[msc-notice-2026]: https://muasamcong.mpi.gov.vn/vi/web/guest/contractor-selection?_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=detail-v2&bidForm=DTRR&bidMode=1_MTHS&bidOpenId=cd1e7501-0635-47be-8629-d9e449bdce82&bidPreNotifyResultId=undefined&bidPreOpenId=undefined&caseKHKQ=undefined&id=2c75c5b7-6726-4114-9095-ea482479a166&inputResultId=03276239-8cc8-445b-af0d-1cc39550e697&isInternet=1&notifyId=2c75c5b7-6726-4114-9095-ea482479a166&notifyNo=IB2600233351&p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_mode=view&p_p_state=normal&planNo=PL2600139399&pno=undefined&processApply=LDT&step=tbmt&stepCode=notify-contractor-step-4-kqlcnt&techReqId=undefined&type=es-notify-contractor
