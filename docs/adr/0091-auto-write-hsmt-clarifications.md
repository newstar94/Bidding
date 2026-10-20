# ADR 0091: Tự ghi làm rõ HSMT mới vào hồ sơ gói thầu

- Trạng thái: Chấp nhận. Ngày 2026-10-20, chủ sản phẩm chọn hướng, trả lời bốn câu hỏi và xác nhận định nghĩa quyền lợi lấy dữ liệu tự động.
- Ngày: 2026-10-20
- Thay thế một phần: ADR 0090, câu "No saved package/plan/HSMT fields are automatically imported or overwritten by monitoring", chỉ cho yêu cầu làm rõ và trả lời làm rõ HSMT. Các phần khác của ADR 0090 giữ nguyên.
- Liên quan: ADR 0042 (nút cập nhật làm rõ, gia hạn), ADR 0017 (ranh giới thương mại và lượt), ADR 0057 (xung đột do máy chủ quyết định).

## Bối cảnh

ADR 0090 kiểm tra làm rõ HSMT và kiến nghị lúc 08:30 và 14:30 giờ Việt Nam, rồi gửi email khi có nội dung mới. Bộ theo dõi chỉ lưu hash nội dung, không ghi gì vào hồ sơ gói thầu. Muốn đưa làm rõ vào hồ sơ, người dùng phải bấm nút cập nhật theo ADR 0042.

Ngày 2026-10-20, chủ sản phẩm yêu cầu: khi phát hiện làm rõ HSMT mới, ngoài việc gửi email, hệ thống tự cập nhật luôn vào hồ sơ gói thầu (phương án A). Bốn câu trả lời của chủ sản phẩm:

1. Chỉ áp dụng khi workspace có quyền lợi lấy dữ liệu tự động.
2. Không trừ lượt lấy dữ liệu tự động.
3. Tiếp tục tự ghi trong suốt thời gian theo dõi, gồm cả 10 ngày sau quyết định kết quả.
4. Phạm vi phiên bản TBMT giống nút thủ công.

Kiến nghị nằm ngoài phạm vi ADR này; chủ sản phẩm sẽ thiết kế sau.

## Business contract

### Phạm vi dữ liệu

- Chỉ ghi yêu cầu làm rõ và trả lời làm rõ HSMT vào bảng `goi_thau_lam_ro` (loại `yeu_cau` và `tra_loi`).
- Không ghi kiến nghị, lịch sử gia hạn, hạn đóng thầu, hạn mở thầu hay bất kỳ trường nào khác của gói thầu hoặc kế hoạch. Không đổi trạng thái gói thầu.
- Bộ theo dõi tiếp tục chỉ lưu hash trong `procurement_monitor_state`. Nội dung làm rõ chỉ nằm trong hồ sơ gói thầu, giống khi người dùng bấm nút thủ công.

### Khi nào hệ thống tự ghi

Hệ thống tự ghi ngay trong lần kiểm tra theo lịch đã phát hiện làm rõ HSMT mới theo ADR 0090. Một gói được tự ghi khi đủ tất cả điều kiện sau:

1. Gói đang đủ điều kiện theo dõi theo ADR 0090: đúng trạng thái, chưa quá 10 ngày sau quyết định kết quả, gói và kế hoạch là bản mới nhất và chưa lưu trữ.
2. Workspace sở hữu gói (tổ chức, hoặc tài khoản với gói cá nhân) có quyền lợi lấy dữ liệu tự động theo định nghĩa ở mục "Quyền lợi lấy dữ liệu tự động".
3. Xác định được phiên bản TBMT của bản ghi gói thầu hiện hành bằng đúng quy tắc của nút thủ công, áp dụng trên dữ liệu đã lưu: lấy hậu tố của mã TBMT (ví dụ `-01`), nếu không có thì lấy phiên bản gói. Nút thủ công cũng dùng đúng dữ liệu này sau khi tải lại trang, vì metadata nguồn lúc nhập không được lưu vào bản ghi gói. Nếu không xác định được, hệ thống không ghi và chỉ gửi email.
4. Cờ cấu hình `PROCUREMENT_MONITOR_AUTO_WRITE_ENABLED` đang bật.

Lần khởi tạo baseline (lần đầu quan sát một gói) không bao giờ tự ghi, vì lúc đó chưa có nội dung nào được coi là mới.

### Ghi những gì

- Phạm vi phiên bản giống nút thủ công: chỉ lấy làm rõ của các phiên bản TBMT không lớn hơn phiên bản của bản ghi gói thầu. Làm rõ ở phiên bản mới hơn vẫn được báo qua email như ADR 0090 nhưng không ghi.
- Khi phát hiện nội dung mới, hệ thống thực hiện đúng phép gộp của nút thủ công: thêm mọi dòng nguồn trong phạm vi mà hồ sơ chưa có, kể cả dòng cũ người dùng chưa từng cập nhật.
- Phiên bản nguồn trả về `null`, lỗi hoặc không nhận dạng được không được coi là danh sách rỗng. Các phiên bản đã xác nhận vẫn được ghi.

### Cách ghi

- **Chỉ thêm dòng mới.** Không sửa, xóa hay sắp xếp lại dòng đang có, kể cả dòng nhập tay và dòng chưa hoàn chỉnh.
- **Nhận dạng dòng.** ID dòng dùng đúng công thức của ADR 0042: `lr-` + SHA-256 của mảng JSON `[mã gói cục bộ, mã thông báo, phiên bản nguồn, loại dòng, reqNo hoặc ID nguồn]`. Nhờ vậy nút thủ công nhận ra các dòng hệ thống đã ghi và không thêm bản sao.
- **Dòng người dùng đã xóa.** Chủ sản phẩm xác nhận ngày 2026-10-20: nếu nguồn vẫn còn một dòng làm rõ mà hồ sơ không có, kể cả khi người dùng đã xóa dòng đó trước đây, hệ thống thêm lại dòng ấy ở lần tự ghi tiếp theo. Hệ thống không lưu danh sách dòng đã xóa. Nút thủ công hiện cũng xử lý như vậy.
- **Nguồn sửa nội dung một dòng đã có.** Dòng trong hồ sơ được nhận ra qua ID nguồn và giữ nguyên nội dung; hệ thống không ghi đè. Email vẫn báo có nội dung mới theo ADR 0090.
- **Dòng nhập tay trùng nội dung.** Dòng nhập tay khớp chính xác thời gian (đến phút) và nội dung với một dòng nguồn được coi là đã có. Hệ thống không thêm bản sao và không đổi ID của dòng đó. Việc liên kết ID vẫn chỉ xảy ra khi người dùng bấm nút thủ công.
- **Định dạng.** Thời gian và nội dung dùng cùng chuẩn hóa với nút thủ công. Dòng mới được xếp sau các dòng hiện có, theo thứ tự nguồn.
- **Phiên bản gói thầu.** Mỗi lần tự ghi tăng `row_version` của gói thầu trong cùng transaction và so khớp (CAS) với phiên bản đã đọc. Đây là điều kiện bắt buộc: luồng lưu hiện hành ghi đè toàn bộ danh sách làm rõ, nên nếu không tăng phiên bản, một bản lưu dựa trên bản cũ sẽ âm thầm xóa các dòng hệ thống vừa ghi. Với cơ chế này, bản lưu cũ nhận xung đột 409 theo ADR 0057.
- **Xử lý xung đột.** Hệ thống khóa bản ghi gói trong lúc ghi. Nếu dữ liệu đồng bộ hoặc chuỗi audit của tổ chức đang được một thao tác khác giữ, hệ thống không chờ (để không thể gây deadlock) mà hoãn cả lần công bố và thử lại trong giới hạn số lần thử hiện có của ADR 0090. Hết số lần thử thì vẫn gửi email, ghi rõ trong email và thông báo là chưa tự cập nhật được và người dùng có thể bấm nút cập nhật. Nội dung lúc đó được đánh dấu đã thấy như hiện nay.
- **Tính nguyên tử.** Các dòng mới, phiên bản gói thầu, audit, hash của bộ theo dõi, thông báo trong ứng dụng và email outbox được commit trong cùng một transaction. Lỗi ở bất kỳ bước nào thì rollback toàn bộ: dữ liệu gói không đổi, nội dung vẫn được coi là chưa thấy và được thử lại.
- **Không phụ thuộc người nhận email.** Việc tự ghi vẫn diễn ra khi gói không có người nhận hợp lệ hoặc thiếu cấu hình mã hóa email. Theo ADR 0090, khi đó nội dung tiếp tục được coi là chưa thấy để các lần sau thử gửi lại email. Phép gộp ở các lần sau không thêm dòng trùng, và email gửi sau sẽ báo hồ sơ đã có đủ các làm rõ này.

### Tác nhân, quyền và audit

- Người thực hiện là "Hệ thống": `actor_user_id` để trống, metadata ghi nguồn `procurement_monitor`, slot, mã thông báo, phiên bản, số dòng và ID các dòng đã thêm. Worker không tạo phiên đăng nhập giả.
- Việc tự ghi không kiểm tra quyền sửa của một người dùng cụ thể, vì đây là thao tác của hệ thống đã được chủ sản phẩm chấp thuận. Thao tác chỉ chạm vào đúng gói thầu và tổ chức đang được theo dõi.
- Không đổi quyền đọc, vai trò, module permission, assignment scope, record scope, masking hay danh sách người nhận email của ADR 0090.

### Lượt và quyền lợi thương mại

- Không trừ lượt, không tạo reservation, không ghi sổ usage. Dữ liệu dùng để ghi là dữ liệu đã tải cho lần kiểm tra, nên không phát sinh truy vấn nguồn mới. Cách làm này khớp ADR 0017 mục 5.
- Workspace không có quyền lợi, kể cả gói Cơ bản đã mua thêm lượt, vẫn nhận email như hiện nay. Email và thông báo ghi rõ là hồ sơ chưa được tự cập nhật.

### Quyền lợi lấy dữ liệu tự động

Ở runtime, quyền lợi lấy dữ liệu tự động được thực thi bằng grant `procurement.source_fetch` khi bật `PROCUREMENT_CREDIT_ENFORCEMENT_ENABLED`. Mỗi grant có nguồn gốc `source` là `plan`, `purchase` hoặc `admin`. Chủ sản phẩm xác nhận định nghĩa sau:

- **Tắt cơ chế trừ lượt, kể cả khi bật `TRIAL_FULL_ACCESS_ENABLED`:** mọi workspace đang dùng được lấy dữ liệu tự động đều đủ điều kiện.
- **Bật cơ chế trừ lượt:** chủ sở hữu gói phải có ít nhất một grant còn hạn với `source = 'plan'`, tức grant đi kèm gói Nâng cao (`connected`). Gói Cơ bản (`internal`) không kèm lượt nên không có grant loại này.
- Không yêu cầu grant còn lượt, vì việc tự ghi không trừ lượt.
- Grant `purchase` (lượt mua thêm) và grant `admin` không tạo quyền tự ghi. Gói Cơ bản mua thêm lượt vẫn dùng được nút thủ công theo ADR 0017, nhưng với tự ghi thì chỉ nhận email.
- Khi gói Nâng cao hết hạn, hoặc workspace hạ xuống gói Cơ bản, hệ thống dừng tự ghi từ lần kiểm tra tiếp theo. Các dòng đã ghi trước đó vẫn hiển thị đầy đủ cho người có quyền đọc, đúng tinh thần ADR 0017.

### Nội dung thông báo

- Email và thông báo trong ứng dụng bổ sung kết quả tự ghi, ví dụ "Đã tự cập nhật 2 yêu cầu, 1 trả lời làm rõ vào hồ sơ".
- Khi không ghi, thông báo nêu lý do bằng ngôn ngữ người dùng: workspace chưa có quyền lợi lấy dữ liệu tự động, làm rõ thuộc phiên bản TBMT mới hơn bản ghi, hoặc chưa cập nhật được do hồ sơ đang thay đổi.
- Email vẫn không chứa nội dung nguồn, tên nguồn hay URL nguồn như ADR 0090.

## Compatibility impact

- Người đang mở sửa gói với bản cũ, hoặc client có hàng đợi offline dựa trên bản cũ, sẽ nhận xung đột 409 theo luồng hiện hành khi lưu sau lúc hệ thống tự ghi. Dữ liệu đang nhập không mất; cần tải lại bản chính thức.
- Nút cập nhật thủ công vẫn hoạt động như cũ và không nhân bản các dòng hệ thống đã ghi.
- Hash của bộ theo dõi phải giữ nguyên định dạng. Nếu đổi, mọi baseline hiện có sẽ coi nội dung cũ là mới và gửi email hàng loạt.
- Không có thay đổi giao diện ngoài nội dung thông báo và nhãn "Hệ thống" ở nơi đang hiển thị lịch sử thao tác.

## Migration và rollback

- Không cần migration schema. `goi_thau_lam_ro` đã có đủ cột cần thiết.
- Không backfill: gói hiện có chỉ được ghi ở lần tiếp theo phát hiện làm rõ mới. Hệ thống không quét và sửa hàng loạt dữ liệu đã lưu.
- Thêm biến `PROCUREMENT_MONITOR_AUTO_WRITE_ENABLED`, mặc định `true` khi bộ theo dõi đang bật. Đặt `false` để quay về chỉ gửi email. Các dòng đã ghi trước đó là dữ liệu bình thường, được giữ nguyên và người dùng có thể sửa hoặc xóa.

## Regression seams

- Phép gộp và ID dòng ở backend cho kết quả giống hệt frontend trên cùng bộ fixture, chạy ở cả pytest và test JavaScript.
- Hash của bộ theo dõi không đổi với dữ liệu hiện có.
- Phạm vi phiên bản: dòng ở phiên bản lớn hơn bản ghi không được ghi; phiên bản `null` không được coi là rỗng.
- Chỉ thêm dòng: dòng nhập tay, dòng chưa hoàn chỉnh và thứ tự hiện có được giữ; dòng nhập tay trùng nội dung không bị nhân bản và không bị đổi ID.
- CAS: người dùng lưu giữa lúc đọc và lúc ghi thì hệ thống thử lại rồi chuyển sang chỉ gửi email. Bản lưu cũ sau lúc tự ghi nhận 409, không xóa dòng hệ thống.
- Quyền lợi: tắt trừ lượt; trial; grant `plan` còn hạn kể cả khi đã hết lượt; grant `plan` hết hạn; chỉ có grant `purchase`; chỉ có grant `admin`; không có grant nào.
- Không phát sinh reservation hay dòng sổ usage.
- Tính nguyên tử: lỗi outbox hoặc lỗi ghi thì rollback cả dữ liệu gói lẫn hash.
- Gói có phiên bản vật lý mới (bảng làm rõ được clone) không bị ghi trùng.
- Lần khởi tạo baseline không ghi. Gói `AWARDED` ở ngày thứ 10 được ghi, ngày thứ 11 thì không. Kế hoạch không phải bản mới nhất hoặc đã lưu trữ thì không ghi.
- Gói cá nhân.
- Audit có tác nhân hệ thống. Bấm nút thủ công sau khi hệ thống đã tự ghi không tạo bản sao.
- Email không chứa nội dung nguồn và có số dòng đã ghi hoặc lý do không ghi.
