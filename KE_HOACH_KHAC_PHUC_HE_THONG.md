# Kế hoạch khắc phục và hoàn thiện hệ thống BiddingFlow

## 1. Mục tiêu

Kế hoạch này dùng cho hệ thống được triển khai trên cơ sở dữ liệu mới. Không cần duy trì tương thích với dữ liệu legacy, nhưng phải giữ đầy đủ khả năng tạo mới, chỉnh sửa, ghi đè, tạo phiên bản mới, đồng bộ và xử lý xung đột về sau.

Nguyên tắc thực hiện:

- Sửa theo từng giai đoạn; hoàn thành và xác minh giai đoạn hiện tại trước khi chuyển sang giai đoạn tiếp theo.
- Ưu tiên tính đúng đắn và toàn vẹn dữ liệu trước tối ưu hiệu năng hoặc dọn code.
- Backend là nguồn chuẩn cho quyền truy cập và quy tắc nghiệp vụ; frontend chỉ kiểm tra sớm để cải thiện trải nghiệm.
- Mọi truy vấn dữ liệu nghiệp vụ phải giới hạn theo `organization_id`.
- Dữ liệu gửi lên API phải được serialize theo schema cho phép, không gửi nguyên object giao diện.
- Khi sửa baseline/schema, xóa database thử nghiệm và khởi tạo lại từ đầu; vẫn giữ framework migration để bổ sung migration mới sau khi production hoạt động.
- Test không được đưa vào gói production, nhưng phải được giữ trong repository và dùng để xác minh thay đổi.

## 2. Thứ tự ưu tiên

| Mức | Ý nghĩa | Cách xử lý |
| --- | --- | --- |
| P0 | Có thể làm hỏng tạo/chỉnh sửa, mất dữ liệu hoặc tạo lỗ hổng bảo mật trực tiếp | Phải sửa trước khi tiếp tục sử dụng nghiệp vụ |
| P1 | Làm sai báo cáo, xuất tài liệu, quy tắc nghiệp vụ hoặc kiểm soát phiên | Sửa trước khi triển khai production |
| P2 | Ảnh hưởng hiệu năng, khả năng vận hành và độ nhất quán dài hạn | Sửa sau khi các luồng chính ổn định |
| P3 | Dọn code, chuẩn hóa tài liệu và cải thiện khả năng bảo trì | Thực hiện cuối cùng |

## 3. Giai đoạn 1 — Khôi phục tính đúng đắn của tạo và chỉnh sửa dữ liệu (P0)

### 3.1. Chuẩn hóa outbound payload

- [x] Tạo serializer dùng chung cho từng bảng đồng bộ dựa trên schema contract.
- [x] Chỉ gửi field thuộc schema, child field được hỗ trợ và `expectedVersion`.
- [x] Không gửi các field giao diện như `allVersions`, `referenceOnly`, trạng thái tải hoặc dữ liệu dẫn xuất.
- [x] Không gửi trùng dữ liệu ở cả top-level table và `upserts`.
- [x] Thống nhất một cấu trúc mutation payload duy nhất giữa frontend và backend.
- [x] Giữ `clientMutationId` để chống ghi lặp khi request bị gián đoạn.

### 3.2. Sửa optimistic locking

- [x] Khi ghi đè bản ghi, giữ nguyên `rowVersion` hiện tại và gửi thành `expectedVersion`.
- [x] Khi tạo phiên bản mới với ID mới, không dùng `expectedVersion` của phiên bản cũ.
- [x] Sửa các luồng chủ đầu tư, nhà thầu, chuyên gia, kế hoạch, gói thầu và hợp đồng.
- [x] Sửa Excel import khi cập nhật bản ghi hiện có để không làm mất `rowVersion`.
- [x] Khi có xung đột, giữ mutation chờ xử lý; không để local state và server state lệch nhau không có cảnh báo.

### 3.3. Đồng nhất field frontend/backend

- [x] Chọn tên JSON chính thức `maDuan` và khai báo mapping từ `ma_du_an`.
- [x] Rà lại toàn bộ acronym/camelCase như `CCCD`, `QHNS`, `HSDT`, `Ehsdxtc`.
- [x] Tạo kiểm tra tự động để mọi field form/import đều tồn tại trong schema contract.
- [x] Loại bỏ các `field_map` không gắn với column thực tế, đặc biệt phần dư trong `tai_khoan`.

### 3.4. Hoàn thiện nghiệp vụ đấu thầu lại

- [x] Thêm `is_rebid` và `rebid_from_package_id` vào schema nếu tiếp tục giữ chức năng đấu thầu lại.
- [x] Thêm foreign key cùng tổ chức tới gói thầu nguồn.
- [x] Ngăn tự tham chiếu và tham chiếu chéo tenant.
- [x] Xác định rõ gói đấu thầu lại có được cộng vào tổng giá kế hoạch hay không (không cộng lặp gói đấu thầu lại).
- [x] Đồng nhất cách hiển thị, tổng hợp và xuất Word/Excel cho gói đấu thầu lại.

### 3.5. Tiêu chí hoàn thành giai đoạn 1

- [x] Tạo mới được tất cả sáu thực thể chính.
- [x] Ghi đè bản ghi hiện có không bị `UNKNOWN_FIELD` hoặc `ROW_VERSION_CONFLICT` giả.
- [x] Tạo phiên bản mới giữ đúng lineage và chỉ có phiên bản phù hợp được đánh dấu mới nhất.
- [x] Hai phiên chỉnh sửa đồng thời tạo xung đột thật và xử lý được.
- [x] Tạo gói đấu thầu lại thành công.
- [x] Payload không còn chứa `allVersions`, `referenceOnly` hoặc dữ liệu upsert lặp.

## 4. Giai đoạn 2 — Chống chèn HTML và chuẩn hóa hiển thị dữ liệu (P0)

### 4.1. Loại bỏ HTML injection

- [x] Rà toàn bộ vị trí dùng `innerHTML`, `insertAdjacentHTML` và template string tạo thuộc tính HTML.
- [x] Dùng `textContent`, thuộc tính DOM và `element.value` cho dữ liệu người dùng.
- [x] Nếu bắt buộc dựng chuỗi HTML, dùng `escapeHtml` cho nội dung và `escapeAttribute` cho thuộc tính.
- [x] Sửa trước các màn hình chi tiết kế hoạch, đối tác, chuyên gia, hợp đồng, đánh giá HSDT và preview Excel.
- [x] Không đưa nội dung Excel, ghi chú lỗi, làm rõ hoặc tên thực thể trực tiếp vào `title`, `value`, `data-*`.
- [x] Thêm lint rule chặn dữ liệu động chưa escape trong HTML sink.

### 4.2. Tăng cường CSP

- [x] Chuyển các khối inline style và style lặp lại trọng yếu thành CSS tĩnh; các giá trị style động còn lại được cô lập ở `style-src-attr`.
- [x] Loại bỏ `unsafe-inline` khỏi `style-src`/`style-src-elem`; chỉ giữ tạm cho thuộc tính style qua `style-src-attr` để không phá các renderer hiện hữu.
- [x] Bật Trusted Types ở chế độ Report-Only để kiểm kê sink; chỉ chuyển sang enforcement sau khi không còn vi phạm từ renderer và Google Identity.
- [x] Bỏ `X-XSS-Protection` đã lỗi thời; tiếp tục dùng CSP làm lớp bảo vệ chính.

### 4.3. Tiêu chí hoàn thành giai đoạn 2

- [x] Chuỗi chứa dấu nháy, thẻ HTML và payload thử nghiệm chỉ được hiển thị như văn bản.
- [x] Import Excel không thể phá cấu trúc bảng hoặc thuộc tính input.
- [x] Không còn HTML sink nhận trực tiếp field nghiệp vụ chưa escape.

## 5. Giai đoạn 3 — Chuẩn hóa quy tắc nghiệp vụ và quan hệ dữ liệu (P1)

### 5.1. Đưa business rule về backend

- [x] Tạo validator dùng chung theo từng thực thể và trạng thái.
- [x] Khai báo tập field bắt buộc cho từng thực thể chính tại backend, không chỉ dựa vào thuộc tính `required` của form frontend.
- [x] Bắt buộc các trường cần thiết theo trạng thái gói thầu.
- [x] Kiểm tra trình tự đăng tải, đóng thầu, mở thầu và gia hạn.
- [x] Kiểm tra trình tự ngày trình, ngày phê duyệt dự toán/kế hoạch, ngày quyết định và thời gian đăng tải kế hoạch.
- [x] Kiểm tra các field điều kiện: loại hình Dự án, kiểu phê duyệt, quyết định chỉ định thầu, phân lô và tùy chọn mua thêm.
- [x] Kiểm tra hiệu lực HSDT và bảo đảm dự thầu.
- [x] Kiểm tra tổ chuyên gia/tổ thẩm định có đúng một tổ trưởng theo quy định được chọn.
- [x] Kiểm tra tổng phần lô, giá gói thầu, giá trúng thầu và nhà thầu trúng thầu.
- [x] Kiểm tra dữ liệu trúng thầu tổng thể phù hợp với kết quả từng phần lô.
- [x] Thiết lập state machine cho trạng thái gói thầu; ngăn nhảy trạng thái không hợp lệ.
- [x] Khóa các field nền tảng không được phép sửa sau khi phát hành; yêu cầu tạo phiên bản mới.
- [x] Kiểm tra ngày thanh lý không trước ngày ký và các ngày tham chiếu phải hợp lệ.

### 5.2. Sửa phân quyền tạo mới của employee

- [x] Quyết định employee có được tạo kế hoạch, gói thầu và hợp đồng hay không (được tạo và tự nhận phụ trách).
- [x] Nếu được tạo, tự động phân công người tạo trong cùng transaction.
- [x] Không áp dụng: policy chính thức cho phép employee tạo và tự nhận phụ trách.
- [x] Không để bản ghi tạo thành công rồi biến mất khỏi danh sách của người tạo.

### 5.3. Chuẩn hóa khóa nghiệp vụ

- [x] Chuẩn hóa mã kế hoạch, mã gói thầu, số hợp đồng, mã số thuế và CCCD trước khi kiểm tra trùng: trim, Unicode normalization, quy tắc hoa/thường và dấu phân cách.
- [x] Kiểm tra trùng theo logical root để các phiên bản của cùng một thực thể được dùng lại khóa nghiệp vụ, nhưng thực thể khác không được trùng.
- [x] Đưa quy tắc unique xuống DB bằng cột normalized hoặc index phù hợp; không chỉ kiểm tra trên danh sách frontend đang tải.
- [x] Sửa kiểm tra trùng số hợp đồng ở frontend để phiên bản cũ cùng lineage không chặn ghi đè hoặc tạo phiên bản mới.
- [x] Mã số thuế unique theo nhà thầu độc lập; liên danh không có mã số thuế chung và tham chiếu các thành viên đã có định danh riêng.

### 5.4. Chuẩn hóa phân công nhân sự

- [x] Quyết định mỗi kế hoạch/gói thầu/hợp đồng có một người phụ trách chính hay nhiều người cùng phụ trách (một người phụ trách chính).
- [x] Nếu chỉ có một người phụ trách, đặt unique theo `(organization_id, id_muc_tieu, loai_doi_tuong)`; nếu hỗ trợ nhiều người, bỏ logic xóa các phân công còn lại khi thêm một người.
- [x] Mọi câu lệnh thay thế hoặc xóa phân công phải có `organization_id`; sửa câu `DELETE` hiện chỉ lọc theo mục tiêu và loại đối tượng.
- [x] Dùng nguyên ID tài khoản chuẩn (`user-*`) và ngăn tạo ID dạng `user-user-*` khi chuyên viên tự nhận hợp đồng.
- [x] Xác thực mục tiêu phân công tồn tại, đang hoạt động, đúng loại thực thể và cùng tổ chức.
- [x] Tạo/cập nhật thực thể và phân công phải nằm trong cùng transaction; thất bại một phần phải rollback toàn bộ.
- [x] Khi tạo phiên bản mới, chuyển hoặc sao chép phân công theo chính sách đã chọn và bảo đảm người tạo vẫn đọc được phiên bản mới.

### 5.5. Chuẩn hóa phiên bản kế hoạch và aggregate con

- [x] Chọn chính sách snapshot: phiên bản kế hoạch mới sao chép dữ liệu chuẩn bị gói thầu và phân công, nhưng bắt đầu lại quy trình lựa chọn nhà thầu.
- [x] Sao chép aggregate chuẩn bị bằng ID mới đúng loại; không sao chép hồ sơ mở thầu hoặc kết quả đánh giá.
- [x] Khi sao chép gói thầu sang phiên bản kế hoạch mới, thiết lập rõ `id`, `rootId`, `phienBan`, `isLatest`, `createdAt`, `updatedAt` và quan hệ nguồn.
- [x] Không sao chép kết quả mở thầu/đánh giá/hủy thầu sang phiên bản mới.
- [x] Đồng nhất partition gói thầu mới nhất theo `(root, ke_hoach_id)` và chỉ tổng hợp gói thuộc phiên bản kế hoạch mới nhất.
- [x] Tính tổng kế hoạch trên đúng tập gói thầu của phiên bản/snapshot đã chọn và áp dụng cùng một quy tắc loại trừ gói đấu thầu lại ở frontend lẫn backend.
- [x] Bảo toàn liên kết lịch sử của hợp đồng; không tự gắn phiên bản gói mới vào hợp đồng cũ.

### 5.6. Toàn vẹn mở thầu, đánh giá và kết quả lựa chọn

- [x] Thêm unique cho hồ sơ mở thầu theo `(organization_id, goi_thau_id, nha_thau_id, ma_phan_lo)` sau khi chuẩn hóa mã phần lô.
- [x] Không cho một nhà thầu xuất hiện lặp trong cùng gói/phần lô, trừ trường hợp có mô hình hồ sơ thay thế được định nghĩa rõ.
- [x] Kiểm tra `ma_phan_lo` tồn tại trong gói thầu và chỉ dùng khi gói có phân lô.
- [x] Kiểm tra `gia_sau_giam_gia` nhất quán với giá dự thầu và tỷ lệ giảm giá; làm tròn half-up đến 1 VND.
- [x] Ràng buộc kết quả đánh giá phải tham chiếu hồ sơ mở thầu thuộc chính gói thầu đó, không chỉ cùng tổ chức.
- [x] Chỉ cho chọn nhà thầu trúng thầu từ danh sách đã mở thầu và đạt các vòng đánh giá bắt buộc.
- [x] Với gói phân lô, mỗi kết quả phần lô phải thuộc đúng lô, đúng nhà thầu đủ điều kiện; tổng giá trúng thầu phải bằng tổng các lô trúng.
- [x] Ngăn lưu kết quả lựa chọn khi chưa hoàn tất mở thầu/đánh giá hoặc khi gói đã hủy.
- [x] Ràng buộc mã phần lô duy nhất trong một gói tại DB, không chỉ cảnh báo trên form.

### 5.7. Toàn vẹn nghiệp vụ hợp đồng

- [x] Backend bắt buộc tên, số, ngày ký, chủ đầu tư, nhà thầu, kế hoạch, giá trị, loại hợp đồng, thời gian thực hiện và người phụ trách theo quy tắc nghiệp vụ.
- [x] Bắt buộc hợp đồng có ít nhất một gói thầu; mọi gói được chọn phải thuộc đúng kế hoạch/lineage kế hoạch của hợp đồng, cùng tổ chức và chưa archived.
- [x] Chỉ cho lập hợp đồng từ gói đã có kết quả hoặc từ hình thức chỉ định/đặc thù được cấu hình rõ.
- [x] Nhà thầu trên hợp đồng phải khớp nhà thầu trúng của các gói/phần lô; nếu một hợp đồng có nhiều nhà thầu hoặc liên danh, thiết kế bảng bên hợp đồng thay vì một `nha_thau_id` duy nhất.
- [x] Giá trị hợp đồng thường phải bằng tổng giá trúng thầu; hợp đồng chỉ định không được vượt tổng giá gói thầu. Điều chỉnh về sau dùng phiên bản hợp đồng.
- [x] Tách `trang_thai_hop_dong` khỏi `trang_thai_ho_so`; trạng thái hồ sơ giấy không được dùng để suy ra hợp đồng đang thực hiện.
- [x] Không tự tạo trạng thái hồ sơ giấy từ chuỗi gửi trong hợp đồng; chỉ owner/manager được quản lý danh mục.
- [x] Kiểm tra ngày quyết định chỉ định không sau ngày ký, ngày thanh lý không trước ngày ký và các field quyết định phải rỗng khi `co_qd_chi_dinh = 0`.
- [x] Chọn đúng phiên bản chủ đầu tư/nhà thầu có hiệu lực tại ngày ký và ngày thanh lý; không tham chiếu phiên bản archived.
- [x] Khi tạo phiên bản hợp đồng mới, giữ đúng liên kết gói thầu, phân công và lineage; phiên bản cũ không được làm tăng số liệu tổng hợp.

### 5.8. Hoàn thiện vòng đời tổ chức

- [x] Hệ thống hỗ trợ nhiều tổ chức nghiệp vụ và workspace cá nhân.
- [x] Có luồng quản lý membership và chọn tổ chức đang hoạt động.
- [x] Không dùng tên tổ chức làm định danh toàn cục duy nhất.
- [x] Dùng ID bất biến làm định danh tổ chức.
- [x] Có membership thì dữ liệu thuộc tổ chức đang chọn; không có membership nghiệp vụ thì dùng workspace cá nhân.

### 5.9. Tiêu chí hoàn thành giai đoạn 3

- [x] Gọi API trực tiếp không thể bỏ qua business rule của frontend.
- [x] Không tạo được quan hệ chéo tổ chức.
- [x] Employee không tạo ra bản ghi mồ côi quyền truy cập.
- [x] Các trạng thái, phần lô, kết quả và hợp đồng được kiểm tra nhất quán ở backend/DB.
- [x] Tạo phiên bản kế hoạch giữ đúng snapshot, quan hệ lịch sử và phân công theo policy đã chọn.
- [x] Không thể gắn hợp đồng với gói thầu ngoài kế hoạch, ngoài tổ chức hoặc chưa đủ điều kiện ký.
- [x] Không thể chọn nhà thầu chưa dự thầu/không đạt làm nhà thầu trúng hoặc bên nhận thầu.
- [x] Thêm hoặc đổi người phụ trách không xóa phân công của tenant khác và không tạo ID nhân sự sai chuẩn.

## 6. Giai đoạn 4 — Sửa Excel, Word và báo cáo (P1)

### 6.1. Excel import

- [x] Đổi trạng thái gói thầu mặc định từ `Chưa thực hiện` thành `Chuẩn bị`.
- [x] Khi cập nhật bản ghi hiện có, giữ `rootId`, `phienBan`, `rowVersion` và thời điểm tạo.
- [x] Quy định rõ import là thêm mới, cập nhật hay tạo phiên bản mới (upsert, không xóa dòng không có trong file).
- [x] Không xóa toàn bộ dữ liệu mở thầu trước khi toàn bộ file được xác nhận hợp lệ.
- [x] Gom import vào một batch đồng bộ transaction ở backend; lỗi không commit một phần dữ liệu server.
- [x] Báo rõ số dòng thêm mới, cập nhật và bỏ qua; lỗi từng dòng hiển thị ngay trong preview.
- [x] Escape toàn bộ dữ liệu trong preview.

### 6.2. Word export

- [x] Truy vấn tổ chức bằng `to_chuc.id`, không dùng `ten_to_chuc` với organization ID.
- [x] Lấy gói dịch vụ từ `organization_subscriptions` kết hợp `goi_dich_vu`.
- [x] Bổ sung `organization_id` vào mọi query kế hoạch, chủ đầu tư, nhà thầu và dữ liệu liên quan.
- [x] Truyền organization ID vào hàm enrich nhà thầu.
- [x] Dùng thời gian hiện tại thực tế thay vì phụ thuộc biến `CURRENT_TIME` không cấu hình.
- [x] Quy định có cho phép xuất bản ghi archived hay chỉ phiên bản đang hoạt động (chỉ bản ghi hoạt động).

### 6.3. Dashboard

- [x] Chỉ đếm hợp đồng phiên bản mới nhất.
- [x] Chỉ cộng giá trị hợp đồng phiên bản mới nhất.
- [x] Đồng nhất định nghĩa “mới nhất” giữa dashboard, pagination và hàm `recalculate_is_latest`.
- [x] Chỉ đếm gói mới nhất trong phiên bản kế hoạch mới nhất; snapshot cũ vẫn truy vấn được theo kế hoạch.
- [x] Định nghĩa riêng “Tổng hợp đồng” và “Hợp đồng phụ trách”; thẻ phụ trách phải lọc theo phân công kể cả với owner/manager nếu giữ nguyên tên gọi.
- [x] Không dùng cùng `counts.hopdong` cho cả ô tổng hợp đồng và ô hợp đồng phụ trách khi hai chỉ số có ý nghĩa khác nhau.
- [x] Bỏ chuỗi “Đang thực hiện” ghi cứng; tính theo `trang_thai_hop_dong` và hiển thị đúng số đang thực hiện.
- [x] Quy định tổng giá trị hợp đồng là toàn tổ chức hay theo phạm vi người dùng đang được phép xem và ghi rõ nhãn tương ứng.
- [x] Loại hợp đồng archived, phiên bản lịch sử, hợp đồng hủy và bản ghi chưa hiệu lực; vẫn tính hợp đồng hoàn thành/thanh lý.
- [x] Số hợp đồng, tổng tiền và trạng thái dùng cùng một SQLite read snapshot.

### 6.4. Tiêu chí hoàn thành giai đoạn 4

- [x] Import cập nhật không phá lineage hoặc optimistic locking.
- [x] Export Word có đủ tổ chức, gói dịch vụ, đối tác và ngày hiện tại.
- [x] Dashboard không tăng số lượng/tổng tiền khi chỉ tạo phiên bản mới.
- [x] “Hợp đồng phụ trách” khớp trực tiếp bảng phân công và không hiển thị trạng thái giả định.
- [x] Tổng giá trị hợp đồng khớp phạm vi quyền của người xem và chính sách trạng thái hợp đồng.

## 7. Giai đoạn 5 — Củng cố xác thực, đồng bộ và dữ liệu nhạy cảm (P1–P2)

### 7.1. Session phía server

- [x] Tạo bảng session riêng thay cho một `token_phien` duy nhất trên tài khoản.
- [x] Lưu `created_at`, `last_seen_at`, idle expiry, absolute expiry và thời điểm thu hồi.
- [x] Kiểm tra expiry kể cả khi lấy session từ cache.
- [x] Hỗ trợ nhiều thiết bị nếu nghiệp vụ cho phép.
- [x] Giữ khả năng thu hồi từng session hoặc toàn bộ session của tài khoản.
- [x] Giảm polling check-session còn 5 phút; ưu tiên WebSocket, focus/visibility.

### 7.2. CSRF và origin

- [x] Thêm `PATCH` vào danh sách method cần CSRF ở backend.
- [x] Đồng nhất method CORS với các method API thực tế.
- [x] Production bắt buộc CORS/WebSocket origin đúng duy nhất `APP_PUBLIC_URL` (same-origin).

### 7.3. Đồng bộ dài hạn

- [x] Trả `minAvailableSyncVersion` cho client.
- [x] Khi cursor cũ hơn tombstone còn giữ, buộc tải lại manifest đầy đủ.
- [x] Chỉ xóa tombstone sau khi cập nhật watermark phát hiện cursor quá cũ.
- [x] Thêm cleanup TTL cho `sync_mutations` và `api_idempotency`.
- [x] Xác định retention cấu hình được cho audit log và websocket event.
- [x] Không in validation error chứa `serverRecord` trực tiếp ra stdout.

### 7.4. Dữ liệu nhạy cảm

- [x] Bắt buộc volume mã hóa cho SQLite, ảnh, Word template và backup; production fail-fast nếu chưa xác nhận `DATA_AT_REST_ENCRYPTION_CONFIRMED=true` sau khi kiểm tra hạ tầng.
- [x] Systemd chạy bằng user riêng, `UMask=0077`, `ProtectSystem=strict`, `ProtectHome=true` và giới hạn `ReadWritePaths`.
- [x] Đã đánh giá mã hóa tầng ứng dụng: baseline chọn mã hóa volume + phân quyền + masking để giữ transaction/search/restore; chỉ bổ sung field encryption khi threat model yêu cầu tách khóa khỏi DB host.
- [x] Blind index hiện không áp dụng vì baseline không mã hóa field riêng; đây là điều kiện bắt buộc nếu sau này bật field encryption cho dữ liệu cần tìm kiếm/unique.
- [x] Mask CCCD và thông tin nhạy cảm trên UI theo quyền.
- [x] Đưa audit log quan trọng tới nơi lưu append-only hoặc có hash chain/WORM.

### 7.5. Xóa dữ liệu offline khi đăng xuất

- [x] Dùng `BroadcastChannel` yêu cầu mọi tab đóng IndexedDB trước khi xóa.
- [x] Xử lý sự kiện `onblocked` khi `deleteDatabase` bị tab khác giữ kết nối.
- [x] Retry việc xóa và kiểm tra lại ở lần khởi động tiếp theo bằng marker bền vững.
- [x] Xóa toàn bộ database workspace liên quan đến user, không chỉ workspace đang mở.

## 8. Giai đoạn 6 — Tối ưu hiệu năng và trải nghiệm người dùng (P2)

### 8.1. Backend và DB

- [x] Thay lọc quyền N+1 bằng query set-based/preload tập ID được phép.
- [x] Dùng `is_latest = 1` và index phù hợp thay cho window CTE lặp lại khi có thể.
- [x] Dùng khoảng ngày thay cho `strftime` đối với lọc tháng; cân nhắc generated year/month nếu cần.
- [x] Dùng cursor/keyset ổn định cho tải tuần tự tập dữ liệu lớn; giữ OFFSET cho điều hướng số trang trực tiếp trên UI.
- [x] Gộp các phép tổng hợp dashboard thành ít query hơn.
- [x] Đo `EXPLAIN QUERY PLAN` trên dữ liệu mô phỏng đủ lớn.

### 8.2. Frontend và network

- [x] Bỏ dữ liệu upsert bị gửi hai lần.
- [x] Chỉ đưa schema các bảng frontend thật sự dùng vào `schemaRuntime.js`.
- [x] Đặt cache immutable cho `/dist/assets/*` có tên hash.
- [x] Chuẩn hóa transport API qua `apiFetch` và các adapter `requestJson/getJson/postJson`.
- [x] Hủy request tìm kiếm/phân trang cũ bằng `AbortController`.
- [x] Debounce tìm kiếm danh sách và hủy request phân trang cũ.
- [x] Tránh render lại toàn bộ bảng khi chỉ một dòng thay đổi.
- [x] Giữ lazy loading các module nghiệp vụ lớn; có bundle budget audit.

### 8.3. UX

- [x] Chỉ hiển thị lỗi dưới field khi người dùng có thể sửa trực tiếp tại field đó.
- [x] Dùng toast/modal cho lỗi hệ thống, xung đột hoặc lỗi nghiệp vụ không gắn với một field.
- [x] Chỉ hiển thị trạng thái offline, lỗi hoặc số thay đổi đang chờ khi có hành động cần chú ý.
- [x] Có màn hình xử lý xung đột cho từng field thay vì chỉ giữ toàn bộ local hoặc server.
- [x] Giữ cảnh báo rời trang khi có form chưa lưu hoặc mutation chưa đồng bộ.
- [x] Bổ sung empty state, retry và skeleton nhất quán cho mọi bảng tải từ server.

## 9. Giai đoạn 7 — Tinh chỉnh schema và dọn code (P2–P3)

### 9.1. Schema clean baseline

- [x] Đổi `phien_ban` sang `INTEGER NOT NULL CHECK(phien_ban >= 0)`; chỉ pad khi hiển thị.
- [x] Đổi mọi `sync_version` thành `INTEGER NOT NULL DEFAULT 0 CHECK(sync_version >= 0)`.
- [x] Đặt `NOT NULL` cho các field thực sự bắt buộc.
- [x] Đặt trạng thái gói thầu mặc định `Chuẩn bị` và không cho null nếu nghiệp vụ không cần null.
- [x] Bổ sung trạng thái vòng đời hợp đồng độc lập với trạng thái hồ sơ giấy, kèm CHECK/state transition.
- [x] Ràng buộc `trang_thai_ho_so` bằng composite foreign key tới danh mục của đúng tổ chức.
- [x] Thêm CHECK ngày/giờ cho các trường quan trọng.
- [x] Ràng buộc `nguoi_cham_id` phải là thành viên cùng tổ chức bằng trigger.
- [x] Củng cố lineage `id_goc` hoặc thay bằng `logical_id` bất biến.
- [x] Thêm các cột normalized và unique index cho mã kế hoạch, mã gói thầu, số hợp đồng, mã số thuế và CCCD theo phạm vi tổ chức/logical root.
- [x] Thêm unique cho mã phần lô và hồ sơ mở thầu theo khóa nghiệp vụ của gói/lô/nhà thầu.
- [x] Ràng buộc composite để `ket_qua_danh_gia_nha_thau.goi_thau_id` khớp gói của `thong_tin_mo_thau_id`.
- [x] Xem xét thay quan hệ phân công polymorphic `id_muc_tieu + loai_doi_tuong` bằng các bảng liên kết có foreign key thật hoặc trigger kiểm tra tương đương.
- [x] Thêm khóa/ràng buộc bảo đảm liên kết hợp đồng–gói thầu cùng kế hoạch theo mô hình phiên bản đã chọn.
- [x] Chuẩn hóa representation timestamp trong toàn hệ thống.
- [x] Chọn nguồn chuẩn duy nhất cho metadata đánh giá: bảng chuẩn hóa hoặc JSON.

### 9.2. Tổ chức lại code

- [x] Tách workflow lớn theo use-case/validator/renderer: vòng đời và đấu thầu lại của gói được tách riêng; lookup mở thầu, validation, result và renderer dùng module chuyên trách.
- [x] Tách `backend/app.py`: middleware HTTP và lifecycle/background cleanup nằm ở module riêng; app chỉ còn cấu hình, route registry và composition root.
- [x] Tách `backend/sync/service.py`: request contract, validation/ownership, deletion use-case, mapper/repository và response commit nằm ở module riêng; service chỉ điều phối transaction.
- [x] Xóa một trong hai nhánh đang cùng lưu `goi_thau_chuyen_gia`; chỉ giữ một service xử lý quan hệ chuyên gia/thẩm định.
- [x] Tách `backend/auth/auth_routes.py`: route quản trị/list/xóa user nằm trong `admin_user_routes`; OTP/password reset, Google và session store tiếp tục là module độc lập.
- [x] Gom field definition/type/label/format vào `field_manifest` và schema contract sinh tự động, dùng chung cho persistence, form contract, Excel và Word.
- [x] Xóa code dead sau khi module/dead-code audit xác nhận không còn tham chiếu.
- [x] Thay các `print()` production bằng structured logging có redaction và request ID; chỉ giữ output debug/fallback logger.

### 9.3. Quyết định kiến trúc DB

- [x] Chọn kiến trúc hiện tại: SQLite, một node, một ASGI worker.
- [x] Chưa cần PostgreSQL với kiến trúc một node/một writer; đã xác định trigger chuyển đổi là HA, nhiều instance hoặc nhiều writer và lộ trình tại mục quyết định kiến trúc.
- [x] Service production cố định `--workers 1` và chỉ bind loopback.

Ngưỡng chuyển PostgreSQL: cần HA/failover, chạy hơn một ASGI instance có ghi, hoặc tải ghi khiến single-writer không đáp ứng SLO. Khi đạt một trong các ngưỡng này, thực hiện theo thứ tự: đóng băng thay đổi schema; thay các SQL/trigger đặc thù SQLite bằng repository tương thích PostgreSQL; chuyển khóa và timestamp sang kiểu native; chạy snapshot + CDC/cutover có đối soát số dòng/FK/tổng nghiệp vụ; cuối cùng mới tăng worker và bật health/failover. Không dùng chung một file SQLite qua network filesystem để thay thế bước chuyển đổi này.

## 10. Giai đoạn 8 — Hoàn thiện production và tài liệu (P1–P3)

### 10.1. Reverse proxy và đóng gói

- [x] Khôi phục `deploy/nginx-biddingflow.conf.example`.
- [x] Ghi đè `X-Forwarded-For` bằng IP socket client; xóa header forwarding do client gửi.
- [x] Cấu hình TLS, HSTS, WebSocket, timeout và body-size phù hợp backend.
- [x] Không công khai trực tiếp cổng backend.
- [x] Cung cấp systemd service dùng một process SQLite.

### 10.2. Cấu hình lần chạy đầu

- [x] Yêu cầu rõ `APP_ENV=production`, `APP_DEBUG=False`, secure cookie và public HTTPS URL.
- [x] Yêu cầu `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_NAME` và `DEFAULT_ORG_NAME` hợp lệ trong production.
- [x] Không dùng mặc định `admin@localhost` khi production.
- [x] Hướng dẫn đặt DB, log, upload, Word template, temp và backup ở các volume runtime riêng.
- [x] Diễn tập backup/restore trên DB mới: hash khớp, `integrity=ok`, không có vi phạm foreign key.

### 10.3. Sửa tài liệu

- [x] Sửa encoding tiếng Việt trong README.
- [x] Xóa liên kết chết và đưa lệnh backup/restore trực tiếp vào README.
- [x] Cập nhật hướng dẫn Vite theo bundle tên hash và code splitting hiện tại.
- [x] Không mô tả obfuscation như một biện pháp bảo mật bắt buộc.
- [x] Ghi rõ test không được ship nhưng phải được giữ trong repository.
- [x] Bỏ `tests/` khỏi `.gitignore` để test mới không bị bỏ sót.
- [x] Đồng bộ README với `.env.example` và startup validation thực tế.

## 11. Xác minh sau mỗi giai đoạn

Các kiểm tra sau chỉ là điều kiện xác minh, không phải nội dung triển khai production:

- [x] Lint JavaScript và Python đạt.
- [x] Schema contract được sinh lại và không drift.
- [x] Module reference, dead-code, vendor asset và secret audit đạt.
- [x] Dependency audit npm/Python không có lỗ hổng đã biết; vendor manifest/RetireJS và secret scan đạt.
- [x] Test liên quan trực tiếp tới phần vừa sửa đạt (183 unit, 220 API).
- [x] Build production đạt và bundle không vượt budget.
- [x] `foreign_key_check`, `quick_check`/integrity đạt trên DB mới và bản restore.
- [x] `git diff --check` đạt; các file thay đổi đều thuộc code, schema, test, tài liệu hoặc cấu hình triển khai của kế hoạch này.

## 12. Bộ kịch bản nghiệm thu cuối

- [x] Khởi tạo thành công database rỗng; startup production bắt buộc đủ biến an toàn.
- [x] Quyền admin, quản lý và chuyên viên được chuẩn hóa; vai trò Người xem đã bị loại bỏ.
- [x] User có tổ chức tạo dữ liệu trong tổ chức đang chọn.
- [x] User không có tổ chức nghiệp vụ tạo dữ liệu trong workspace cá nhân.
- [x] Không thể dùng header để truy cập tổ chức hoặc workspace cá nhân không thuộc quyền.
- [x] Tạo, ghi đè, tạo phiên bản mới, archive và xóa theo policy cho các thực thể chính.
- [x] Chỉnh sửa đồng thời được phát hiện bằng optimistic locking và có luồng giải quyết.
- [x] Tạo phiên bản kế hoạch giữ đúng snapshot/quan hệ lịch sử và phân công theo policy.
- [x] Khóa nghiệp vụ không thể vượt kiểm tra trùng bằng khác hoa/thường, khoảng trắng hoặc Unicode tương đương.
- [x] Hồ sơ mở thầu không lặp trong cùng gói/lô; kết quả đánh giá tham chiếu đúng hồ sơ/gói.
- [x] Chỉ nhà thầu đã dự thầu và có kết luận Đạt mới được ghi nhận trúng thầu.
- [x] Hợp đồng bị từ chối nếu thiếu/sai gói, kế hoạch, nhà thầu trúng, giá trị hoặc điều kiện ký.
- [x] Trạng thái hợp đồng và hồ sơ giấy độc lập; danh mục hồ sơ không tự sinh từ text.
- [x] Phân công được giới hạn tenant, ID đúng chuẩn và tự tạo cùng transaction.
- [x] Import Excel giữ lineage/rowVersion khi cập nhật; không xóa các dòng không có trong file.
- [x] Xuất Word/Excel giới hạn đúng tenant và phiên bản dữ liệu đã commit.
- [x] Dashboard dùng một read snapshot và cùng policy phiên bản/trạng thái.
- [x] “Hợp đồng phụ trách” lấy từ phân công; số đang thực hiện lấy từ trạng thái hợp đồng.
- [x] Đăng xuất yêu cầu mọi tab đóng DB, xóa mọi workspace và retry ở lần khởi động sau.
- [x] Cursor đồng bộ quá cũ nhận `FULL_SYNC_REQUIRED` và tự tải lại đầy đủ.
- [x] Backup được tạo, kiểm tra SHA-256/integrity và restore diễn tập thành công.
- [x] Reverse proxy ghi đè forwarding header; production khóa HTTP/WebSocket origin về `APP_PUBLIC_URL`.

## 13. Trạng thái thực hiện

| Giai đoạn | Trạng thái |
| --- | --- |
| 1. Tạo/chỉnh sửa và payload | Hoàn thành phần sửa lỗi cốt lõi |
| 2. HTML injection và hiển thị | Hoàn thành; CSP tách style element/attribute và Trusted Types Report-Only đã bật |
| 3. Business rule và quan hệ | Hoàn thành |
| 4. Excel, Word và dashboard | Hoàn thành |
| 5. Session, sync và dữ liệu nhạy cảm | Hoàn thành; production bắt buộc xác nhận volume mã hóa trước khi khởi động |
| 6. Hiệu năng và UX | Hoàn thành; tải tuần tự lớn dùng keyset, điều hướng số trang vẫn giữ OFFSET |
| 7. Schema và dọn code | Hoàn thành baseline và tách các module backend/frontend trọng yếu |
| 8. Production và tài liệu | Hoàn thành cấu hình mẫu, kiểm tra DB và diễn tập backup/restore |
| 9. Rà soát phát hành cuối | Hoàn thành dependency/SBOM, schema sinh tự động, cấu hình production và toàn bộ quality gate |

## 14. Rà soát phát hành cuối

- [x] Dependency npm: 384 dependency, không có lỗ hổng đã biết.
- [x] Dependency Python runtime: không có lỗ hổng đã biết; lock file có hash.
- [x] Vendor browser: 8 file đúng SHA-256 và RetireJS không phát hiện thư viện có cảnh báo.
- [x] Secret scan: không phát hiện secret trong mã nguồn được duy trì.
- [x] Sửa lệnh SBOM Python để chạy qua đúng interpreter (`python -m cyclonedx_py`), không phụ thuộc PATH; tạo thành công SBOM npm, Python runtime và vendor.
- [x] Schema runtime và manifest biến Word sinh lại ổn định, không thay đổi SHA-256 giữa hai lần sinh.
- [x] Kiểm tra cấu hình startup production và readiness đạt 13/13 kịch bản trực tiếp.
- [x] Không còn dấu hiệu mojibake, TODO/FIXME/HACK hoặc debug statement không được kiểm soát trong mã ứng dụng.
- [x] Chạy lại toàn bộ quality gate trên bộ dependency khóa phiên bản: lint, module/dead-code/vendor audit, build, bundle budget, 183 unit test và 220 API test đều đạt.
- [x] `git diff --check` đạt; chỉ còn cảnh báo quy đổi line ending của Git trên Windows, không có whitespace error.

Khi hoàn thành một mục, đổi `[ ]` thành `[x]`. Chỉ đánh dấu hoàn thành sau khi code đã được xác minh theo tiêu chí của chính giai đoạn đó.
