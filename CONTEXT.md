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

**Tra cứu thông tin đối tác**:
Việc tự động làm giàu thông tin Chủ đầu tư hoặc Nhà thầu từ định danh của đối tác, không bao gồm kết luận hay trạng thái vi phạm. Chức năng này dùng chung, không giới hạn cho cả bản Nội bộ và bản Kết nối Mua Sắm Công.
_Avoid_: Lượt Mua Sắm Công, kiểm tra vi phạm, nhập hồ sơ đấu thầu

**Kiểm tra và ghi nhận vi phạm nhà thầu**:
Việc đối chiếu Nhà thầu với nguồn vi phạm có thẩm quyền rồi ghi nhận trạng thái đánh giá vào đúng ngữ cảnh gói thầu; đây không phải nhãn do người dùng tự gán. Chức năng này chỉ thuộc bản Kết nối Mua Sắm Công và không giới hạn lượt.
_Avoid_: Tra cứu thông tin Nhà thầu, đánh dấu thủ công, quota tra cứu đối tác

**Lượt lấy hồ sơ Mua Sắm Công**:
Một lần lấy thành công một mã và revision hồ sơ Kế hoạch, TBMT hoặc Mở thầu từ nguồn Mua Sắm Công; xem trước, nhập hoặc cập nhật từ cùng snapshot đã lấy không tạo thêm lượt. Lỗi nguồn, retry kỹ thuật và cache hit không tiêu thụ lượt.
_Avoid_: Request HTTP, tra cứu thông tin đối tác, kiểm tra vi phạm nhà thầu

**Quota kèm bản Kết nối**:
Số lượt lấy hồ sơ Mua Sắm Công được cấp cùng một kỳ của bản Kết nối, tách biệt với lượt người dùng mua thêm.
_Avoid_: Tra cứu đối tác, quota dùng chung toàn hệ thống, lượt mua thêm

**Quota mua thêm**:
Gói lượt lấy hồ sơ Mua Sắm Công thuộc đúng một workspace, được cả bản Nội bộ và Kết nối sử dụng và được bảo toàn khi nâng từ Nội bộ lên Kết nối.
_Avoid_: Lượt tặng kèm, quyền đọc dữ liệu, quota theo vai trò

**Bản Nội bộ**:
Biến thể gói dùng nhập thủ công hoặc Excel và được tra cứu thông tin đối tác không giới hạn; gói không kèm sẵn lượt lấy hồ sơ Mua Sắm Công nhưng workspace được lấy hồ sơ khi còn quota đã mua. Bản Nội bộ không được chạy kiểm tra vi phạm nhà thầu.
_Avoid_: Gói theo vai trò thấp, bản bị che dữ liệu

**Bản Kết nối Mua Sắm Công**:
Biến thể gói kèm quota lấy trực tiếp hồ sơ đấu thầu từ Mua Sắm Công và quyền kiểm tra vi phạm nhà thầu không giới hạn; tra cứu thông tin đối tác vẫn là quyền chung như bản Nội bộ.
_Avoid_: Role quản lý, quyền đọc dữ liệu nhạy cảm, gói tra cứu đối tác

**Cấu hình thương mại**:
Tập giá, gói, quota và chính sách bán hàng được áp dụng nhất quán cho việc chào bán, thanh toán, kích hoạt và gia hạn; cấu hình này không quyết định quyền đọc dữ liệu nghiệp vụ.
_Avoid_: Cấu hình phân quyền, feature flag triển khai, hằng số giao diện

**Bản nháp thương mại**:
Phiên làm việc chưa có hiệu lực để Super Admin chuẩn bị và kiểm tra một thay đổi cấu hình thương mại.
_Avoid_: Bảng giá đang chạy, chỉnh trực tiếp gói hiện hành

**Bản phát hành thương mại**:
Ảnh chụp bất biến của toàn bộ cấu hình thương mại có thời điểm hiệu lực xác định; giao dịch và quyền lợi phát sinh luôn ghim đúng bản đã dùng.
_Avoid_: Hàng cấu hình mutable, giá mới nhất, sửa hồi tố

**Thẩm quyền cấu hình thương mại**:
Quyền riêng của vai trò nền tảng Super Admin để tạo, kiểm tra, lên lịch, xuất bản hoặc ngừng cấu hình thương mại; quyền này không cấp thêm quyền đọc bản ghi.
_Avoid_: Manager mua gói, module permission, quyền xem dữ liệu nhạy cảm

**SKU thương mại**:
Định danh ổn định của một thứ có thể mua như kỳ gói chính hoặc gói lượt Mua Sắm Công; mỗi giao dịch ghim phiên bản giá và quyền lợi cụ thể của SKU.
_Avoid_: Tên hiển thị gói, package ID mutable, capability đọc dữ liệu

**Disposition nhập liệu**:
Phân loại có thẩm quyền của một revision nguồn, xác định revision đó tạo snapshot nghiệp vụ, đồng bộ lại, chỉ lưu bằng chứng nguồn hay đã được xử lý trước đó.
_Avoid_: Trạng thái giao diện, lựa chọn materialize của client

**Thu hồi phạm vi hiển thị**:
Sự kiện một tài khoản không còn được phép giữ hoặc xem bản ghi đã đồng bộ trước đó do thay đổi membership, phân công, quyền phân hệ hoặc record scope. Không được dùng capability cấp trường để che một phần bản ghi mà người dùng vẫn có quyền đọc.
_Avoid_: Xóa bản ghi nghiệp vụ, tombstone xóa dữ liệu

**Phạm vi đọc tiến trình nhập liệu**:
Quyền xem trạng thái một tiến trình nhập procurement được suy ra từ tenant, phân hệ, vai trò hoạt động và phạm vi bản ghi mà tiến trình tác động; người tạo tiến trình không mặc nhiên là người duy nhất được xem. Khi tiến trình chưa có bản ghi đích để đánh giá, quyền xem phân hệ là ranh giới bản ghi khả dụng.
_Avoid_: Tenant-only, actor-only, quyền sở hữu tiến trình riêng

**Phạm vi metadata dòng phiên bản**:
Tập phiên bản được công bố trong metadata của một bản ghi chính xác là tập phiên bản mà cùng người dùng được phép đọc riêng lẻ ở thời điểm yêu cầu; quyền với một phiên bản không tự mở metadata của cả dòng phiên bản.
_Avoid_: Family-wide metadata, latest-only metadata, kế thừa quyền ngầm theo dòng phiên bản

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

**Bản nháp giải quyết xung đột bền vững**:
Ảnh chụp base/local/server của một mutation bị xung đột, được giữ qua tải lại trang để đúng người tạo xem và quyết định nhưng không bao giờ tự phát lại mutation.
_Avoid_: Outbox đang hoạt động, force overwrite, auto replay sau F5

**Văn bản pháp lý**:
Định danh ổn định của một văn bản pháp lý xuyên suốt các lần công bố nội dung; mỗi nội dung bất biến là một phiên bản văn bản pháp lý riêng.
_Avoid_: Tài liệu RAG mới nhất, file luật hiện hành

**Hồ sơ nguồn pháp lý**:
Manifest bất biến chứa chính xác các phiên bản văn bản pháp lý dùng làm nguồn cho một lần phân giải; hồ sơ nguồn không tự chứa quy tắc tuân thủ thực thi.
_Avoid_: Danh sách luật mới nhất, kết quả tìm kiếm web

**Ràng buộc pháp lý**:
Kết quả bất biến gắn một phiên bản kế hoạch hoặc gói thầu với đúng hồ sơ nguồn pháp lý, hoặc ghi rõ trạng thái chưa thể phân giải.
_Avoid_: Luật áp dụng suy ra theo ngày hiện tại, fallback latest

**Căn cứ lập kế hoạch**:
Văn bản hoặc tài liệu được viện dẫn khi lập một phiên bản Kế hoạch LCNT, được ghi nhận bằng câu nguyên văn và thường gồm tên, số hoặc ký hiệu, ngày và đơn vị ban hành.
_Avoid_: Ràng buộc pháp lý, kết luận tuân thủ, văn bản tự suy ra từ hồ sơ nguồn

**Finding tuân thủ xác định**:
Kết quả do bộ quy tắc đã được duyệt tạo ra từ snapshot và bằng chứng cụ thể; AI chỉ được giải thích finding chứ không tạo hoặc đổi trạng thái finding.
_Avoid_: Kết luận do mô hình suy đoán, lời khuyên RAG chung

**Biểu mẫu Word logic**:
Định danh bền vững của một biểu mẫu xuyên suốt các bản nháp, phiên bản xuất bản và việc đổi tên; tên file chỉ là alias tương thích.
_Avoid_: File Word đang active, filename là identity

**Phiên bản biểu mẫu Word đã xuất bản**:
Bytes, mapping và manifest bất biến của một biểu mẫu Word logic đã qua preflight và được phép dùng để tạo tài liệu.
_Avoid_: Config revision, file bị replace tại chỗ

**Provenance tài liệu Word**:
Bằng chứng một artifact đã được tạo từ exact phiên bản biểu mẫu, checksum, mapping và snapshot nghiệp vụ nào.
_Avoid_: Suy luận từ filename hoặc thời gian sửa file

**Sự kiện lịch công việc**:
Projection có định danh và revision ổn định của một mốc timeline đã được phép đưa ra lịch; projection lịch không thay đổi dữ liệu hoặc quyền đọc bản ghi nguồn.
_Avoid_: Raw timeline row, calendar connector record

**Hồ sơ nghiệp vụ đấu thầu**:
Aggregate vận hành dùng chung cho làm rõ và kiến nghị, thuộc một dòng phiên bản gói thầu và giữ bằng chứng exact phiên bản tại từng response hoặc transition.
_Avoid_: Hai hệ thống làm rõ/kiến nghị song song, danh sách text trong gói thầu

**Trách nhiệm hồ sơ**:
Metadata chỉ người hoặc đơn vị chịu trách nhiệm xử lý hồ sơ; trách nhiệm không cấp hoặc mở rộng quyền truy cập.
_Avoid_: Assignment cấp quyền, owner có toàn quyền

**Bên tham gia hồ sơ**:
Chủ thể nghiệp vụ được nhắc tới trong hồ sơ nhưng không mặc nhiên là tài khoản hoặc principal của workspace.
_Avoid_: User ngoài tổ chức, external login

**Quan sát nguồn**:
Ảnh chụp bất biến của một revision từ hệ thống ngoài; quan sát nguồn không phải hồ sơ chính thức và không ghi đè response hoặc state nội bộ.
_Avoid_: Auto-import case, nguồn ngoài là write authority

**Phiên bản nội dung phản hồi**:
Nội dung phản hồi bất biến của hồ sơ tại một lần lưu; review, approve và issue luôn tham chiếu chính xác phiên bản đã dùng, còn chỉnh sửa tiếp theo tạo phiên bản mới không kế thừa phê duyệt cũ.
_Avoid_: Nội dung phản hồi mutable, approval gắn với response mới nhất

**Chuyển trạng thái hồ sơ**:
Bằng chứng bất biến rằng một command hợp lệ đã đưa hồ sơ từ trạng thái nguồn sang trạng thái đích và đã ghim exact phiên bản nội dung/gói thầu cần thiết.
_Avoid_: Set state trực tiếp, sửa lịch sử trạng thái

**Hạn xử lý hồ sơ**:
Mốc thời gian của hồ sơ có provenance từ policy pháp lý đã duyệt hoặc do người dùng nhập rõ ràng; hạn nhập tay không tự trở thành kết luận quá hạn pháp lý.
_Avoid_: SLA suy đoán, overdue pháp lý không có policy

**Thao tác hàng loạt**:
Một hành động đã đăng ký rõ, chạy trên tập bản ghi được máy chủ chuẩn bị và authorize, rồi được authorize lại trước khi thực thi; thao tác hàng loạt không phải generic sync hoặc permission shortcut.
_Avoid_: Arbitrary table patch, select-all không snapshot
