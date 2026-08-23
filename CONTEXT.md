# Quản lý nghiệp vụ đấu thầu

Ngữ cảnh này quản lý lịch sử nghiệp vụ từ kế hoạch lựa chọn nhà thầu đến gói thầu và hợp đồng, với khả năng xem lại chính xác trạng thái tại từng phiên bản.

## Language

**Dòng phiên bản**:
Một đối tượng nghiệp vụ xuyên suốt các lần thay đổi, trong đó mọi phiên bản cùng đại diện cho một kế hoạch, gói thầu hoặc hợp đồng.
_Avoid_: Bản ghi trùng, đối tượng mới

**Phiên bản mới nhất**:
Ảnh chụp hiện hành duy nhất của một dòng phiên bản và là nơi tiếp nhận thay đổi tiếp theo.
_Avoid_: Bản hiện tại tạm thời

**Phiên bản lịch sử**:
Ảnh chụp bất biến của đối tượng nghiệp vụ và dữ liệu liên quan tại thời điểm phiên bản kế tiếp được sinh ra.
_Avoid_: Bản cũ có thể cập nhật

**Snapshot kế hoạch**:
Toàn bộ trạng thái của kế hoạch và các snapshot gói thầu thuộc kế hoạch tại thời điểm tạo phiên bản kế hoạch.
_Avoid_: Chỉ dữ liệu của riêng hàng kế hoạch

**Snapshot gói thầu**:
Toàn bộ trạng thái của gói thầu và dữ liệu nghiệp vụ liên quan tại một phiên bản, bao gồm trạng thái tiến trình và kết quả đã có.
_Avoid_: Gói thầu rỗng, khởi tạo lại quy trình

**Đại diện gói thầu trong snapshot kế hoạch**:
Snapshot gói thầu duy nhất đại diện cho một dòng gói thầu bên trong một snapshot kế hoạch cụ thể; đại diện này có thể thuộc một kế hoạch lịch sử nên không mặc nhiên được phép chỉnh sửa.
_Avoid_: Gói thầu mới nhất toàn cục, gói thầu hiện hành

**Kế thừa phiên bản**:
Việc tạo ảnh chụp mới từ toàn bộ trạng thái của phiên bản mới nhất mà không làm thay đổi ảnh chụp nguồn.
_Avoid_: Reset dữ liệu, sửa đè lịch sử

**Phiên bản nguồn**:
Một lần công bố hoặc thay đổi của đối tượng trên hệ thống nguồn ngoài, được nhận diện bằng mã dòng, số phiên bản nguồn và định danh revision. Với dòng do Mua Sắm Công quản lý, `planVersion` là phiên bản kế hoạch Bidding và `notifyVersion` là phiên bản gói thầu Bidding theo quan hệ một-một; hai dòng phiên bản này độc lập với nhau.
_Avoid_: Tăng phiên bản Bidding độc lập giữa hai revision Mua Sắm Công

**Bản nháp nhập liệu**:
Trạng thái phục hồi cục bộ của màn hình nhập, chỉ chứa lựa chọn chưa commit và không thuộc dòng phiên bản nghiệp vụ.
_Avoid_: Phiên bản tạm, revision cục bộ

**Đối chiếu phiên bản nguồn**:
Việc so sánh một snapshot nguồn với binding đã lưu để phân loại đối tượng thành giữ nguyên, thay đổi, mới, bị loại hoặc mơ hồ trước khi áp dụng quy tắc phiên bản nội bộ.
_Avoid_: Ghép tự động bằng tên hoặc số thứ tự

**Đối chiếu nguồn có thẩm quyền**:
Lần nhập hoặc đồng bộ lại từ Mua Sắm Công có phiên nguồn được máy chủ xác thực, được phép làm mới trường thuộc nguồn trên snapshot hiện hành dù lifecycle đang khóa thao tác sửa thủ công.
_Avoid_: Payload tự khai nguồn, sửa tay trường đã khóa

**Disposition nhập liệu**:
Phân loại có thẩm quyền của một revision nguồn, xác định revision đó tạo snapshot nghiệp vụ, đồng bộ lại, chỉ lưu bằng chứng nguồn hay đã được xử lý trước đó.
_Avoid_: Trạng thái giao diện, lựa chọn materialize của client

**Thu hồi phạm vi hiển thị**:
Sự kiện một tài khoản không còn được phép giữ hoặc xem bản ghi đã đồng bộ trước đó do thay đổi membership, phân công, quyền phân hệ hoặc record scope. Không được dùng capability cấp trường để che một phần bản ghi mà người dùng vẫn có quyền đọc.
_Avoid_: Xóa bản ghi nghiệp vụ, tombstone xóa dữ liệu

**Xuất bản chính thức**:
Tài liệu được tạo từ snapshot đã commit trên máy chủ, có kiểm tra quyền và entitlement tại thời điểm phát hành, dùng làm kết quả nghiệp vụ hoặc tuân thủ.
_Avoid_: Xuất bản nháp cục bộ, tải mẫu rỗng

**Phạm vi hợp đồng của tài liệu Word**:
Hồ sơ tổng hợp gói thầu là ngữ cảnh dữ liệu dùng để điền các tài liệu Word, không phải một loại tài liệu xuất bản và không có hàng gán biểu mẫu riêng. Tập hợp hợp đồng hiện hành được đưa vào từng tài liệu theo đúng chức năng xuất bản: tư vấn lập/đánh giá chỉ nhận hợp đồng Tư vấn, tư vấn thẩm định chỉ nhận hợp đồng Thẩm định, còn các tài liệu cấp gói thầu khác giữ danh sách hợp đồng đầy đủ khi mapping cần dùng.
_Avoid_: Danh sách hợp đồng dùng chung không phân loại, lọc theo tên biểu mẫu

**Đọc đầy đủ bản ghi đã được cấp quyền**:
Sau khi tenant, module, assignment và record scope cho phép đọc một bản ghi, người dùng xem đầy đủ các trường nghiệp vụ của bản ghi đó, bao gồm thông tin tài chính, định danh, chữ ký và con dấu. Quyền xuất Word chỉ kiểm soát hành động xuất tài liệu, không kiểm soát hiển thị trường.
_Avoid_: Capability đọc nhạy cảm riêng, masking mặc định, dùng entitlement Word để che dữ liệu

**Thay đổi quyền hoặc hiển thị dữ liệu**:
Thay đổi masking, redaction, trường hiển thị, role, permission, scope, capability, entitlement hoặc inheritance là quyết định nghiệp vụ cần chủ sản phẩm xác nhận rõ ràng; không được tự suy diễn từ best practice hoặc mục tiêu hardening.
_Avoid_: Tự chọn fail-closed, tự hạ quyền, sửa test để hợp thức hóa semantics chưa được duyệt

**Vai trò hoạt động**:
Vai trò quyền hạn tối thiểu mà tài khoản chủ động chọn trong một workspace; chọn “Chuyên viên” thực sự hạ quyền backend và phạm vi dữ liệu, không chỉ đổi giao diện.
_Avoid_: Persona chỉ để trình bày, vai trò nền tảng

**Chuyên viên kế thừa từ quản lý**:
Thành viên quản lý chủ động chọn vai trò hoạt động “Chuyên viên” được kế thừa quyền xem phân hệ, nhưng vẫn chịu assignment scope và record scope như chuyên viên khác; quyền sửa không được kế thừa.
_Avoid_: Quản lý ẩn, chế độ xem thử toàn quyền, kế thừa quyền sửa

**Thông báo liên kết**:
Thông báo trên Mua Sắm Công được nối từ một gói trong KHLCNT để bổ sung dữ liệu ở giai đoạn thông báo. Liên kết này là nguồn làm giàu dữ liệu, không thay thế định danh dòng gói thầu.
_Avoid_: Gói thầu mới, khóa duy nhất của gói

**Tài khoản ngừng hoạt động**:
Tài khoản được bảo toàn cùng toàn bộ lịch sử nhưng bị khóa đăng nhập, không được ghi mới và không xuất hiện trong danh sách tài khoản đang hoạt động.
_Avoid_: Tài khoản đã xóa, purge người dùng

**Tổ chức ngừng hoạt động**:
Tổ chức được bảo toàn cùng toàn bộ lịch sử nhưng bị khóa truy cập, không nhận ghi mới và không xuất hiện trong danh sách workspace đang hoạt động.
_Avoid_: Tổ chức đã xóa, decommission vật lý

**Loại kế hoạch Bidding**:
Phân loại kế hoạch nội bộ chỉ gồm “Dự án” và “Dự toán mua sắm”. Phân loại Mua Sắm Công `DTPT` hoặc `DTMS` thuộc “Dự án”; `TX` hoặc `KHAC` thuộc “Dự toán mua sắm”.
_Avoid_: Lưu trực tiếp mã phân loại nguồn vào loại kế hoạch nội bộ

**Danh mục hàng hóa mời thầu**:
Các mặt hàng thực có tên, đơn vị tính và số lượng dương thuộc phạm vi một gói hoặc một phần lô; dòng tiêu đề phần lô từ nguồn ngoài không phải là hàng hóa.
_Avoid_: Dòng biểu mẫu nguồn, dòng nhóm, tiêu đề phần lô

**Phạm vi hàng hóa mời thầu**:
Một hàng hóa thuộc trực tiếp gói không phân lô hoặc thuộc đúng một phần lô của gói phân lô; một phần lô có thể chứa một hoặc nhiều hàng hóa mà không tạo loại bản ghi khác.
_Avoid_: Tự tạo phần lô cho gói không phân lô, mô hình riêng cho quan hệ một-một và một-nhiều

**Ảnh chụp cục bộ chưa đối soát**:
Dữ liệu workspace đã lưu bền vững trên thiết bị và có thể dùng để render nhanh, nhưng chưa được xác nhận là phản ánh phạm vi và phiên bản có thẩm quyền hiện tại của máy chủ.
_Avoid_: Dữ liệu hiện hành, dữ liệu authoritative

**Ranh giới mutation có thẩm quyền**:
Điểm trước khi một thay đổi trực tuyến được phép persist hoặc gửi lên máy chủ, tại đó workspace phải hoàn tất đối soát có thẩm quyền hoặc đã được xác định là đang làm việc offline thực sự.
_Avoid_: Khóa toàn bộ giao diện, kiểm tra quyền phía client

**Mutation trong cửa sổ stale**:
Thay đổi được người dùng tạo sau khi ảnh chụp cục bộ đã render nhưng trước khi đối soát khởi động hoàn tất; thay đổi này phải đi qua authoritative pull trước lần push đầu tiên.
_Avoid_: Mutation khởi động có sẵn, mutation đã được máy chủ xác nhận

**Xung đột đồng bộ chưa giải quyết**:
Mutation cục bộ đã bị máy chủ xác nhận từ chối bằng `ROW_VERSION_CONFLICT`; batch đó được cách ly khỏi outbox hoạt động, giữ tạm làm marker trong phiên hiện tại và tự động bỏ khi tải lại trang trước khi lấy server state mới nhất. Mutation khác không thuộc batch xung đột vẫn được bảo toàn.
_Avoid_: Tự động merge field nhạy cảm, force overwrite, xóa toàn bộ outbox, áp lại conflict draft sau F5

**Plan breakdown edit session**:
Hydration/delta sau khi draft được mở phải rebase vào snapshot ba chiều, không ghi đè business edit local. Assignment clone không đổi phải giữ `id`/`rowVersion`; không phát sinh assignment mới chỉ vì form được lưu lại.
_Avoid_: Pull ngay trước commit làm mất draft, thay identity assignment không đổi, gửi lại historical/unmodified rows

**Plan version draft session**:
Chuỗi snapshot của một kế hoạch mới chưa từng persist, được lưu bền vững theo workspace và chỉ commit toàn bộ qua final save nguyên tử; intermediate save chỉ sinh snapshot local và phiên bản kế tiếp.
_Avoid_: Ghi từng phiên bản trung gian lên server, dùng outbox như draft chain, clear draft trước server acknowledgement
