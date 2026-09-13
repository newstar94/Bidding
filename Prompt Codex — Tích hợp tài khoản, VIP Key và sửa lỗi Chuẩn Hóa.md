Bạn đang làm việc đồng thời với 02 repository:

- Bidding: https://github.com/newstar94/Bidding
- Chuan-Hoa: https://github.com/newstar94/Chuan-Hoa

## MỤC TIÊU

Hãy nghiên cứu **toàn bộ code mới nhất trên nhánh main của cả hai repo trước khi sửa**, sau đó triển khai hoàn chỉnh hệ thống xác thực/kích hoạt VIP cho ứng dụng Chuẩn Hóa, mở rộng Dashboard Admin của Bidding để quản trị Chuẩn Hóa, đồng thời sửa các lỗi Word formatting và xóa trang thừa nêu dưới đây.

Không chỉ viết tài liệu hoặc mock UI. Phải triển khai code production, migration, API, UI, test và các thay đổi cần thiết để tính năng hoạt động end-to-end.

Trước khi code, hãy dùng `git pull`/đọc trạng thái repository phù hợp và lập bản đồ những thành phần liên quan. Đặc biệt phải phân biệt code production với prototype/legacy.

Trong Chuan-Hoa, nguồn production chính là:

`src/ChuanHoa.Api/`

`src/ChuanHoa.AddIn.Vsto/`

`src/ChuanHoa.Client.Core/`

`src/ChuanHoa.Contracts/`

`src/ChuanHoa.Infrastructure/`

Không triển khai chức năng production vào các thư mục prototype cũ như `backend-api`, `client-vsto-csharp` nếu chúng không còn là runtime production.

Trong Bidding hiện đã có integration Chuẩn Hóa, bao gồm các thành phần tương tự:

`backend/integrations/chuan_hoa.py`

`backend/admin/platform_chuan_hoa_routes.py`

`frontend/admin-platform/AdminChuanHoa.js`

cùng hệ thống Super Admin, session revalidation, audit, HMAC S2S, idempotency/replay protection.

**Hãy mở rộng kiến trúc hiện có. Không tạo một integration song song mới.**

---

# 1. KIẾN TRÚC BẮT BUỘC

Giữ mô hình:

**Bidding Admin Dashboard = Control Plane / giao diện quản trị**

**Chuan-Hoa API = source of truth của dữ liệu Chuẩn Hóa**

Bidding KHÔNG được ghi trực tiếp vào database Chuẩn Hóa.

Mọi thao tác quản trị Chuẩn Hóa từ Dashboard Bidding phải đi:

`Browser -> Bidding backend -> authenticated S2S API -> Chuan-Hoa API -> Chuan-Hoa DB`

Tiếp tục sử dụng cơ chế bảo vệ hiện có:

- Bidding Super Admin authentication.
- Fresh-session/revalidation trước thao tác nhạy cảm.
- Mapping admin được phép quản trị Chuẩn Hóa.
- HMAC request signing.
- Timestamp/nonce/replay protection.
- Idempotency-Key cho mutation.
- Audit ở cả hai phía khi thích hợp.
- Không bao giờ gửi S2S secret xuống browser.
- Không log password, access token, raw activation key hoặc signing secret.
- Fail closed khi không xác minh được quyền.

Không merge database Bidding và Chuan-Hoa.

Không dùng tài khoản Bidding làm tài khoản người dùng Chuẩn Hóa.

---

# 2. HAI PHƯƠNG THỨC SỬ DỤNG CHUẨN HÓA

Ứng dụng Chuẩn Hóa phải hỗ trợ chính xác hai mode truy cập production:

## MODE A — ĐĂNG NHẬP TÀI KHOẢN

Người dùng bắt buộc đăng nhập trước khi dùng các chức năng được bảo vệ của Chuẩn Hóa.

Một tài khoản chỉ được sử dụng trên **01 máy tại một thời điểm**.

Yêu cầu:

- Khi đăng nhập thành công, server bind tài khoản với `deviceThumbprint` hiện tại.
- Nếu tài khoản đã có một thiết bị khác đang active thì máy thứ hai không được đăng nhập.
- Trả lỗi thân thiện, ví dụ:

`Tài khoản này đang được sử dụng trên một thiết bị khác.`

- Không tự động đá máy cũ để tránh chiếm tài khoản ngoài ý muốn.
- Khi logout hợp lệ, giải phóng binding của máy đó.
- Khi session hết hạn phải cho phép giải phóng/rebind theo chính sách server hợp lý, tránh tài khoản bị khóa vĩnh viễn.
- Admin phải có khả năng thu hồi/reset thiết bị từ Dashboard Bidding.

### Session 3 ngày

Thông tin đăng nhập chỉ có hiệu lực tối đa:

**72 giờ kể từ thời điểm login thành công.**

Đây phải là **absolute expiration**, không phải sliding expiration.

Ví dụ:

Đăng nhập 10:00 ngày 01 -> hết hạn đúng 10:00 ngày 04 dù người dùng có sử dụng liên tục.

Sau 72 giờ:

- các chức năng Chuẩn Hóa được bảo vệ không được tiếp tục chạy bằng account session cũ;
- yêu cầu người dùng đăng nhập lại;
- không được tự gia hạn thêm 3 ngày chỉ vì app đang hoạt động.

Không lưu raw password.

Token/session local phải được mã hóa bằng cơ chế an toàn phù hợp Windows, ưu tiên Windows DPAPI/Credential Manager hoặc abstraction bảo mật hiện có.

Phải chống trường hợp chỉnh giờ hệ thống để kéo dài session bằng cách tận dụng server-issued timestamps / trusted server time / signed lease hiện có.

### Quan trọng về OfflineLease

Chuan-Hoa hiện có signed offline lease.

Không được để offline lease 7 ngày hoặc cache cũ vô tình bypass yêu cầu đăng nhập lại sau 72 giờ.

Trong account mode:

`effective license expiry <= account session expiry`

hoặc command gate phải xác minh cả:

`valid signed entitlement AND valid account session`.

Sau 72 giờ account mode phải fail closed cho tới khi login lại.

---

## MODE B — KÍCH HOẠT BẰNG VIP KEY

Người dùng có thể không đăng nhập tài khoản mà nhập một **VIP Activation Key**.

Khi kích hoạt key thành công:

- Không yêu cầu đăng nhập.
- Các chức năng VIP được mở theo entitlement/package của key.
- Client vẫn phải xác minh trạng thái activation/license hợp lệ.
- Key phải bind theo thiết bị.

Ở yêu cầu này, `"số lượt dùng"` của key được hiểu là:

**số lượng thiết bị khác nhau có thể kích hoạt key**, KHÔNG phải số lần bấm chức năng.

Ví dụ:

`maxDevices = 5`

đã kích hoạt trên 3 device khác nhau:

`usedDevices = 3`

`remainingDevices = 2`

Cùng một device kích hoạt lại cùng key:

- phải idempotent;
- không tiêu thêm slot.

Key thứ 6 phải bị từ chối nếu `maxDevices = 5`.

Việc kiểm tra và giữ slot phải atomic ở database để không thể oversubscribe bằng hai request song song.

---

# 3. TẠO VÀ BẢO MẬT VIP KEY

VIP key chỉ được tạo từ Dashboard Admin Bidding.

Không để frontend tự generate key.

Key phải được sinh server-side bằng CSPRNG, entropy tối thiểu tương đương 128-bit.

Có thể dùng định dạng thân thiện kiểu:

`CHV-XXXX-XXXX-XXXX-XXXX-XXXX`

nhưng entropy thực tế vẫn phải đủ mạnh.

Yêu cầu bảo mật:

- Không lưu plaintext key lâu dài trong DB.
- Lưu hash/HMAC của key.
- Lưu một prefix/last characters đủ để admin nhận diện.
- Plaintext key chỉ trả về khi vừa tạo để admin copy.
- Không ghi plaintext key vào application log, audit log, exception hoặc analytics.
- So sánh key bằng cách chống timing attack khi phù hợp.
- Chuẩn hóa uppercase/whitespace trước khi hash.

Một key tối thiểu phải có:

`id`

`keyPrefix/displayKey`

`keyHash`

`status`

`package/entitlement`

`maxDevices`

`usedDevices`

`remainingDevices`

`createdAt`

`createdBy`

`expiresAt` nếu admin cấu hình

`revokedAt`

`note`

Admin phải có thể:

- tạo key;
- chọn số thiết bị tối đa;
- chọn gói/quyền VIP phù hợp với commercial model hiện tại;
- đặt ngày hết hạn nếu cần;
- xem danh sách key;
- tìm kiếm/filter;
- xem số máy đã kích hoạt;
- xem remaining slots;
- xem danh sách device activation;
- revoke/disable key;
- release một device activation;
- xem audit liên quan.

Không cho phép giảm `maxDevices` xuống thấp hơn số device đang active nếu chưa xử lý các activation đó.

Key bị revoke/expired phải không còn sử dụng được sau lần validation tiếp theo.

---

# 4. DATABASE CHUẨN HÓA

Hãy nghiên cứu schema/migrations hiện tại rồi thiết kế migration **append-only** phù hợp convention repo.

Không chỉnh sửa migration production đã chạy.

Có thể cần các concept tương đương:

`account_sessions`

`account_device_bindings`

`activation_keys`

`activation_key_devices`

hoặc mở rộng các bảng hiện hữu nếu repo đã có model tương đương.

Không tạo bảng trùng chức năng nếu hệ thống đã có device registration/session/entitlement model.

Các ràng buộc DB phải bảo đảm:

- một account tối đa một active device;
- một key/device chỉ có một active activation;
- không vượt `maxDevices`;
- activation request retry không tiêu hai slot;
- session có `issued_at` + `expires_at`;
- session expiry = 72 giờ;
- revocation rõ ràng;
- mọi critical identifier có UNIQUE/index phù hợp;
- foreign key đầy đủ;
- mutation concurrency-safe.

Thêm migration verification/up-down test theo convention của repo.

---

# 5. AUTH API CHUẨN HÓA

Hãy kiểm tra API hiện hữu trước rồi bổ sung/reuse contract cho các chức năng:

Register account.

Login.

Logout.

Current session/current account.

Refresh/revalidate nếu thực sự cần, nhưng tuyệt đối không biến thành sliding 72h.

Activate VIP key.

Validate current key activation.

Deactivate/release current activation nếu policy cho phép.

Device management.

Entitlement bootstrap/rule-pack retrieval.

Registration phải thực sự hoạt động với database production.

Không lưu password plaintext. Dùng password hashing chuẩn mạnh đang phù hợp .NET/runtime hiện tại, ví dụ ASP.NET PasswordHasher/Argon2id/bcrypt/PBKDF2 với thông số an toàn nếu repo chưa có abstraction.

Có rate limiting/throttling cho:

login;

register;

activation-key guessing.

Phản hồi API không được giúp attacker enumerate tài khoản/key quá dễ dàng.

---

# 6. THIẾT LẬP TRONG WORD ADD-IN

Hiện `AccountSettingsWindow` mới là placeholder và nút Đăng nhập bị disable.

Hãy chuyển thành UI production thực sự.

Trong **Thiết lập · Chuẩn hóa**, thiết kế tối thiểu các khu vực:

### Tài khoản

Nếu chưa đăng nhập:

`Đăng nhập`

`Đăng ký tài khoản`

Hiển thị form phù hợp.

Nếu đã đăng nhập:

Tên/email tài khoản.

Gói hiện tại.

Ngày hết hạn.

Thiết bị hiện tại.

`Đăng xuất`.

Hiển thị thời điểm cần đăng nhập lại.

### Kích hoạt VIP

Có ô:

`Nhập mã kích hoạt`

và nút:

`Kích hoạt`

Khi thành công hiển thị ngắn gọn:

`Đã kích hoạt VIP.`

Sau đó hiển thị:

gói/quyền;

trạng thái;

hạn dùng nếu có;

thiết bị hiện tại.

Nếu đang sử dụng VIP key thì **không bắt đăng nhập**.

### Ưu tiên access mode

Không được có trạng thái mơ hồ.

Tạo một abstraction rõ như:

`AccessMode.None`

`AccessMode.Account`

`AccessMode.ActivationKey`

hoặc tương đương.

Centralize authorization trong `LocalAccessManager` / service phù hợp.

Không viết điều kiện đăng nhập/key riêng lẻ ở từng Ribbon handler.

`LocalAccessManager.RequireCommand(...)` và command authorization hiện có phải trở thành điểm kiểm soát tập trung.

`Thiết lập` vẫn phải mở được khi chưa đăng nhập để người dùng có thể đăng nhập/đăng ký/nhập key.

---

# 7. DEVICE ID

Tận dụng device identity hiện tại.

`LocalAccessManager` hiện đã có stable local device identity và tạo `deviceThumbprint`, dữ liệu gốc được bảo vệ bằng Windows `ProtectedData`.

Reuse abstraction này thay vì thu thập tùy tiện:

MAC address;

CPU serial;

ổ cứng serial;

MachineGuid;

hoặc các thông tin phần cứng nhạy cảm khác.

Nếu cần refactor device service để API authentication dùng chung device thumbprint thì thực hiện nhưng phải bảo toàn compatibility với signed lease hiện tại.

---

# 8. DASHBOARD ADMIN BIDDING

Mở rộng trang quản trị Chuẩn Hóa hiện có trong Bidding.

Không tạo một dashboard thứ hai.

Dùng `AdminChuanHoa.js`/router/API adapter hiện tại và giữ style của Admin Platform.

Trang Chuẩn Hóa nên quản lý tối thiểu:

### Tổng quan

Số tài khoản.

Tài khoản active.

Subscription active.

Số VIP key active.

Tổng số device activation.

Key sắp hết slot.

Key sắp hết hạn.

### Tài khoản Chuẩn Hóa

Tìm kiếm.

Xem trạng thái.

Gói hiện tại.

Hạn sử dụng.

Thiết bị đang bind.

Reset/thu hồi thiết bị.

Grant/extend/revoke entitlement nếu hệ thống đã hỗ trợ semantics này.

Khóa/mở tài khoản chỉ khi model hiện hữu cho phép hợp lý.

### Gói đăng ký

Reuse commercial/subscription model hiện tại.

Không hard-code giá hoặc package nếu server đã có offer/SKU model.

Cho admin quản lý các action cần thiết cho Chuẩn Hóa mà không phá pricing/versioning invariant hiện tại.

### VIP Keys

Danh sách key.

Tạo key.

Số device tối đa.

Đã dùng.

Còn lại.

Gói.

Ngày tạo.

Ngày hết hạn.

Trạng thái.

Người tạo.

Ghi chú.

Revoke.

Xem devices.

Release device.

### Audit

Hiển thị các mutation quan trọng:

tạo key;

revoke key;

release device;

reset account device;

grant/extend/revoke entitlement.

Các mutation nhạy cảm phải tiếp tục yêu cầu Super Admin + fresh session/revalidation theo security model hiện tại của Bidding.

---

# 9. MỞ RỘNG S2S CONTRACT BIDDING ↔ CHUẨN HÓA

Mở rộng integration hiện tại thay vì bypass nó.

Bổ sung capability/resources/actions cần thiết cho:

activation keys;

key devices;

account device reset;

subscription/account mutation còn thiếu.

Các endpoint mutation phải có:

HMAC authentication;

timestamp;

nonce/replay protection;

request body integrity;

Idempotency-Key;

audit;

bounded request body;

fail-closed response validation.

Bidding backend phải xác minh:

`schema`

`application`

và contract response giống pattern hiện tại.

Frontend Bidding tuyệt đối không được gọi Chuan-Hoa API trực tiếp.

---

# 10. RÚT GỌN TOÀN BỘ THÔNG BÁO CỦA CHUẨN HÓA

Hiện code trong `RibbonRuntime.cs` có nhiều thông báo kiểu:

`Chuẩn hóa toàn bộ tài liệu theo ...`

`Đã chuẩn hóa toàn bộ tại máy...`

`hoàn toàn tại máy`

và hiển thị nhiều thống kê không cần thiết.

Hãy sửa.

## Chuẩn hóa toàn bộ

Thông báo xác nhận PHẢI là đúng nội dung:

`Chuẩn hóa toàn bộ tài liệu? Ứng dụng sẽ tự động Chuẩn hóa lại tài liệu của bạn`

Không ghi:

Nghị định 30;

Hướng dẫn 05;

chế độ nhận diện;

chi tiết rule;

`"tại máy"`.

Khi hoàn tất chỉ cần thông báo ngắn:

`Chuẩn hóa toàn bộ hoàn tất.`

## Kiểm tra thể thức

`Kiểm tra thể thức hoàn tất.`

## Kiểm tra chính tả

`Kiểm tra chính tả hoàn tất.`

## Chuyển đổi Unicode

`Chuyển đổi Unicode hoàn tất.`

## Sửa nhanh chính tả

`Sửa nhanh chính tả hoàn tất.`

Loại bỏ cụm:

`"tại máy"`

`"hoàn toàn tại máy"`

khỏi thông báo success bình thường.

Không cần hiện các thống kê dài dòng, số đoạn, số lỗi, backup path... trong success dialog thông thường.

Tuy nhiên:

- vẫn phải tạo backup/recovery như hiện tại;
- exception/error quan trọng vẫn phải thông báo đủ để xử lý;
- không xóa telemetry/log nội bộ cần thiết chỉ vì rút gọn UI.

Search toàn repo để đảm bảo không còn message production tương tự bị bỏ sót.

---

# 11. SỬA LỖI SPACING = 6 PT VÀ LINE SPACING = 1.2

Đây là bug thực tế.

Hiện trong `WordOneClickRuntime` đã có code tương tự:

`SpaceAfter = 6f`

`LineSpacingRule = wdLineSpaceMultiple`

`LineSpacing = 14.4f`

Do Word biểu diễn Multiple 1.2 theo 12 × 1.2 points.

Nhưng một số tài liệu sau khi `"Chuẩn hóa toàn bộ"` vẫn không được đưa về đúng:

**After = 6 pt**

**Line spacing = Multiple 1.2**

Không được chỉ thay hằng số vì hằng số hiện tại cơ bản đã đúng.

Hãy điều tra root cause.

Kiểm tra đặc biệt:

`ApplyParagraphFormat`

`NormalizeBodySpacing`

`NormalizeNd30ContentLineSpacing`

role detection;

`IsBodyParagraph`;

paragraph bị loại do text length;

article/point/subpoint paragraphs;

paragraph có style;

direct formatting vs style inheritance;

`SpaceAfterAuto`;

`SpaceBeforeAuto`;

formatting được áp trước/sau style;

paragraph trong list;

paragraph sau table;

mixed range;

paragraph mark;

end-of-cell marker;

story range;

section transitions;

các rule `ND30-PL1-M2-K6E-LINESPACING` và `ND30-PL1-M2-K6E-SPACEAFTER`;

scanner và autofix có dùng cùng canonical values hay không.

Đặc biệt chú ý đoạn hiện tại:

`IsBodyParagraph()` đang loại một số text theo regex/độ dài.

Không được để paragraph nội dung hợp lệ bị bỏ qua chỉ vì không thỏa heuristic quá hẹp.

## Kết quả mong muốn

Đối với các paragraph thuộc nội dung thân văn bản cần chuẩn hóa theo ND30:

`SpaceBeforeAuto = false`

`SpaceAfterAuto = false`

`SpaceBefore = 0 pt`

`SpaceAfter = 6 pt`

`LineSpacingRule = wdLineSpaceMultiple`

`LineSpacing = 14.4 pt`

tương ứng UI Word hiển thị:

`After: 6 pt`

`Line spacing: Multiple`

`At: 1.2`

Các thành phần có quy tắc riêng như:

quốc hiệu;

tiêu ngữ;

tên cơ quan;

header;

một số title/heading;

Party regime nếu có quy định riêng

vẫn phải tuân thủ rule riêng của chúng.

Không được ép toàn bộ mọi paragraph trong document thành 6pt/1.2 nếu pháp lý/rule pack quy định ngoại lệ.

Nhưng mọi body paragraph thuộc scope 6pt/1.2 phải được normalize deterministically.

Sau one-click normalization nên có một verification/reconciliation pass phù hợp để đảm bảo style hoặc thao tác sau đó không ghi đè ngược formatting.

Scanner và AutoFix phải nhất quán:

Nếu scanner báo sai spacing thì AutoFix phải sửa được.

Sau AutoFix scan lại không được báo lại cùng lỗi spacing.

---

# 12. TEST CHO SPACING

Tạo regression tests bao phủ tối thiểu:

body paragraph bình thường;

paragraph ngắn;

`Điều 1.`;

`1. ...`;

`a) ...`;

paragraph có custom Word Style;

paragraph có `SpaceAfterAuto`;

paragraph vốn là 0pt/Single;

paragraph vốn là 12pt/1.5;

paragraph ngay sau table;

nhiều section;

mixed direct formatting;

document được chuẩn hóa hai lần.

Tính idempotent:

Chuẩn hóa lần 2 không được tiếp tục thay đổi tài liệu đã canonical.

Nếu unit test không thể chạy Word Interop thực, tách policy/calculation thành testable pure components và vẫn giữ integration/manual fixture test cần thiết.

---

# 13. SỬA `"XÓA TRANG THỪA"`

Hiện Ribbon đã route:

`btnXoaTrangThua`

đến:

`WordLocalCommandRuntime.RemoveTrailingBlankParagraphs(...)`

và code cuối cùng gọi:

`WordTrailingBlankPageCleaner.Remove(document)`.

Nhưng tính năng hiện không hoạt động đúng.

Không chữa bằng cách chỉ rename button hoặc xóa một vài `\r`.

Hãy nghiên cứu đầy đủ nguyên nhân và sửa production implementation.

## Yêu cầu mới

Cho phép xóa:

- trailing blank paragraphs tạo trang trắng;
- redundant manual page break;
- trailing empty section;
- empty section ở giữa tài liệu khi thực sự không chứa nội dung;
- section break dư gây ra trang trắng.

Nhưng phải **giữ nguyên định dạng hiện tại của các section còn lại**.

Đây là yêu cầu bắt buộc.

## Xác định section trống an toàn

Không chỉ dùng `Range.Text.Trim()`.

Word có nhiều control characters:

`\r`

`\a`

`\f`

`\v`

NBSP;

zero-width chars;

section/page-break markers.

Một section chỉ được xem là empty khi thực sự không chứa meaningful document content.

Không xóa section nếu chứa:

table;

inline shape;

shape;

content control;

field có ý nghĩa;

ảnh;

textbox;

bookmark/content có ý nghĩa;

hoặc object khác dù visible text trống.

## Bảo toàn section formatting

Đây là phần quan trọng nhất.

Trong Word, section formatting gắn với section break/final section properties.

Việc xóa section break có thể khiến section trước/sau kế thừa:

orientation;

paper size;

margin;

header/footer;

page numbering;

columns;

section start;

different first page;

odd/even settings.

Trước mutation phải snapshot các thuộc tính cần thiết của neighboring surviving sections.

Sau khi xóa empty section/break:

reapply section properties cần thiết để document nhìn và in giống trước đó, trừ trang trắng/section thừa đã bị loại.

Đặc biệt test:

Portrait -> empty section -> Landscape.

Landscape -> empty section -> Portrait.

Portrait -> empty final section.

Section có header/footer khác nhau.

Section có `LinkToPrevious`.

Section có page numbering restart.

Không được collapse hai section có định dạng khác nhau thành một nếu empty section/break đang đóng vai trò boundary cần thiết cho format.

Nếu cần giữ section boundary để bảo toàn formatting thì chỉ loại nội dung/break gây page trắng phù hợp, không phá layout.

## Các trường hợp phải test

Cuối document có nhiều blank paragraph.

Manual page break ở cuối.

Section break `Next Page`.

Section break `Odd Page`.

Section break `Even Page`.

Empty last section.

Empty middle section.

Hai empty section liên tiếp.

Section chỉ có table — KHÔNG được xóa.

Section chỉ có image/shape — KHÔNG được xóa.

Document kết thúc bằng table.

Portrait/Landscape mix.

Headers/Footers khác nhau.

Page numbering khác nhau.

Repeated invocation.

Sau lần chạy thứ hai không được thay đổi thêm nếu tài liệu đã sạch.

Phải tránh Selection-dependent code nếu không cần thiết.

Dùng Range-based operation.

Giữ COM object release discipline hiện tại.

Nếu Word version hỗ trợ UndoRecord thì thao tác nên nằm trong một undo operation phù hợp.

Giữ recovery/backup behavior hiện có.

---

# 14. KHÔNG LÀM HỎNG PRIVACY MODEL

Chuan-Hoa hiện được thiết kế để nội dung tài liệu xử lý local.

Yêu cầu này phải giữ nguyên.

Tuyệt đối không gửi lên server:

document binary;

document text;

document path;

spelling contents;

format findings;

nội dung clipboard;

tên file nếu không thực sự cần.

Server chỉ được nhận dữ liệu phục vụ:

identity;

authentication;

device thumbprint;

license/key;

entitlement;

commercial data;

release metadata;

audit bảo mật.

---

# 15. RIBBON COMMAND AUTHORIZATION

Hãy rà toàn bộ `ProductFeaturePolicy` và các Ribbon command.

Mọi chức năng premium/protected hiện tại phải đi qua central access gate.

Đặc biệt các chức năng người dùng yêu cầu phải hoạt động chính xác:

`Chuẩn hóa toàn bộ`

`Kiểm tra thể thức`

`Kiểm tra chính tả`

`Chuyển đổi Unicode`

`Sửa nhanh chính tả`

`Xóa trang thừa`

Không hard-code logic kiểu:

`if (loggedIn)` ở từng button.

Thay vào đó:

`RequireCommand(commandId)`

phải biết current AccessMode và entitlement.

Tài khoản không đăng nhập/hết 72h:

hiển thị hướng dẫn ngắn để đăng nhập hoặc nhập VIP key.

VIP key hợp lệ:

không yêu cầu login.

---

# 16. UX KHI CHƯA ĐƯỢC KÍCH HOẠT

Khi bấm một chức năng bị bảo vệ mà chưa login/key:

Thông báo ngắn gọn, ví dụ:

`Vui lòng đăng nhập hoặc kích hoạt VIP trong Thiết lập để sử dụng tính năng này.`

Có thể điều hướng/mở trang Thiết lập nếu UX hiện tại hỗ trợ an toàn.

Khi session 3 ngày hết hạn:

`Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.`

Khi key hết device slots:

`Mã kích hoạt đã đạt số lượng thiết bị tối đa.`

Khi key revoked/expired:

hiển thị trạng thái tương ứng nhưng không leak thông tin nội bộ.

---

# 17. SECURITY / RACE CONDITION

Phải chủ động kiểm tra và sửa các race sau:

Hai máy login cùng một account cùng lúc.

Hai máy lấy slot cuối cùng của cùng VIP key cùng lúc.

Retry activation do timeout.

Hai request admin release cùng device.

Tạo/revoke key đồng thời.

Account logout song song với entitlement refresh.

Stale offline lease sau logout.

Stale offline lease sau key revoke.

Stale local account token sau admin reset.

Dùng DB transaction, unique constraint, optimistic/row-level locking hoặc cơ chế phù hợp PostgreSQL.

Không dựa vào:

`SELECT count(*)` rồi `INSERT`

mà không có synchronization vì có thể oversubscribe.

---

# 18. CACHE / OFFLINE BEHAVIOR

Không làm Word treo vì synchronous network request trên UI thread.

`LocalAccessManager` hiện chủ ý không thực hiện network I/O dài trên Ribbon UI thread.

Giữ nguyên nguyên tắc đó.

Các thao tác:

login;

register;

activate key;

manual refresh

có thể chạy async/background với UI state phù hợp.

Ribbon command phải dùng validated local state/signed artifacts để quyết định nhanh.

Tuy nhiên account mode không được offline quá giới hạn session 72 giờ.

Key mode có thể sử dụng signed device-bound lease/cache theo architecture hiện tại, nhưng phải có TTL/revalidation policy hợp lý và không được cho key revoked sống vô hạn.

---

# 19. BACKWARD COMPATIBILITY

Không làm hỏng:

rule packs;

current signed leases;

Development bootstrap;

existing commercial/subscription data;

current Bidding ↔ Chuan-Hoa admin integration;

Word 2010+ compatibility đang được repo hỗ trợ;

`.doc` nếu hiện tại repo vẫn hỗ trợ;

existing CI/security gates.

Nếu cần thay đổi signed artifact schema, phải version schema và hỗ trợ migration/compatibility rõ ràng.

---

# 20. TEST BẮT BUỘC

Bổ sung unit/integration/contract tests cho toàn bộ feature mới.

Tối thiểu phải test:

Account registration.

Successful login.

Wrong password.

1 account / 1 device.

Concurrent login.

Logout rồi login máy khác.

72h absolute expiry.

App restart không reset 72h.

Clock rollback không kéo dài hợp lệ.

No plaintext password/token.

Create VIP key.

Correct key activation.

Invalid key.

Revoked key.

Expired key.

`maxDevices = 1`.

`maxDevices > 1`.

Same device activates twice.

Concurrent final-slot activation.

Release device rồi kích hoạt máy khác.

Key mode works without login.

Account mode fails after 72h.

Admin reset device.

Admin key creation via Bidding S2S.

Unauthorized Bidding user denied.

Stale/replayed S2S request denied.

Duplicate Idempotency-Key is safe.

Raw key does not appear in DB/log response after creation.

Spacing regression.

Delete-extra-page regression.

Notification text regression.

Privacy regression: không upload document content.

---

# 21. CI / QUALITY GATES

Đọc workflow thực tế trong `.github/workflows` của cả hai repo trước khi chọn command.

Chạy ít nhất các test/build/lint liên quan, rồi chạy full gates mà repo yêu cầu.

Với Chuan-Hoa, kiểm tra các command hiện hành tương đương:

`dotnet build ChuanHoa.slnx -c Release`

`dotnet test ChuanHoa.slnx -c Release`

và source-quality/security validation scripts hiện có.

Với Bidding, chạy:

Python tests liên quan integration/admin/security;

JavaScript tests cho Admin Platform;

security lint;

module lint;

critical coverage gate;

frontend build;

contract test với Chuan-Hoa;

các CI gate khác trong repo.

Không bỏ qua test đỏ bằng cách:

skip test;

xóa test;

nới assertion;

giảm coverage threshold;

disable security check.

Phải sửa root cause.

---

# 22. PHƯƠNG PHÁP THỰC HIỆN

Trước khi sửa code:

1. Pull/read latest main của cả hai repo.
2. Kiểm tra `git status`.
3. Đọc README/AGENTS/CONTEXT/architecture docs.
4. Map code liên quan auth/device/lease/subscription/admin integration/Ribbon/Word formatting.
5. Xác định chức năng nào đã DONE / PARTIAL / NOT DONE.
6. Không viết lại phần đã tốt.
7. Thiết kế migration/API contract trước.
8. Sau đó mới implement từng lớp.
9. Chạy test nhỏ sau mỗi nhóm thay đổi.
10. Cuối cùng chạy full CI-equivalent gates.

Không thực hiện destructive production migration.

Không deploy production.

Không push hoặc force-push repository nếu chưa được yêu cầu rõ ràng.

Không tự thay secrets/environment production.

---

# 23. DEFINITION OF DONE

Chỉ coi công việc hoàn thành khi toàn bộ các điều kiện sau đúng:

**Auth account**

Người chưa login không dùng được protected feature.

Đăng ký hoạt động.

Đăng nhập hoạt động.

Một account chỉ active trên một máy.

Session hết đúng 72 giờ.

Logout/reset giải phóng thiết bị đúng.

**VIP key**

Admin Bidding tạo được key.

Admin chọn được max devices.

Key được sinh ngẫu nhiên phía server.

Client nhập key và kích hoạt được.

Key activation không cần account login.

Không vượt max devices kể cả concurrent requests.

Admin xem/revoke/release devices được.

**Admin**

Quản trị account/subscription/key Chuẩn Hóa trực tiếp từ Dashboard Bidding qua S2S contract hiện hữu.

Không có browser -> Chuan-Hoa direct request.

**Thông báo**

Không còn success message dài dòng hoặc cụm `"tại máy"` trong 5 chức năng nêu trên.

Confirmation Chuẩn hóa toàn bộ đúng yêu cầu.

**Spacing**

Tất cả body paragraph thuộc rule 6pt/1.2 sau normalize thực sự hiển thị `After 6 pt` + `Multiple 1.2`.

Scan lại không báo lại lỗi đã sửa.

**Xóa trang thừa**

Nút thực sự hoạt động.

Xóa được blank page/empty section an toàn.

Không phá orientation/margins/header/footer/page-numbering/section formatting còn lại.

**Security**

Không plaintext password.

Không plaintext activation key trong DB/log.

Không S2S secret ở browser.

Không document content upload.

Không race oversubscription.

Không stale lease bypass session/key revocation ngoài policy.

**Quality**

Build pass.

Tests pass.

CI-equivalent gates pass.

---

# 24. BÁO CÁO CUỐI CÙNG CHO TÔI

Sau khi hoàn tất, không chỉ nói `"Done"`.

Hãy báo cáo rõ:

## A. Những gì đã sửa

Theo từng repo:

`Bidding`

`Chuan-Hoa`

## B. Kiến trúc cuối cùng

Mô tả ngắn luồng:

Account login -> device binding -> 72h session -> entitlement -> command.

VIP key -> key validation -> device slot -> signed entitlement -> command.

Bidding Admin -> S2S -> Chuan-Hoa.

## C. Database migrations

Tên migration.

Bảng/cột/index/constraint mới.

## D. API mới/thay đổi

Method + route + chức năng.

## E. Các file chính đã thay đổi

Nêu file và lý do.

## F. Bug spacing

Nêu chính xác root cause tìm được, không chỉ nói đã sửa.

## G. Bug xóa trang thừa

Nêu chính xác root cause và cách bảo toàn Section formatting.

## H. Security

Nêu cách xử lý:

password;

72h token;

device binding;

key hashing;

concurrency;

replay/idempotency;

lease invalidation.

## I. Test

Liệt kê command thực tế đã chạy và kết quả PASS/FAIL.

Nếu có test không thể chạy, nói chính xác vì sao.

## J. Git

Cuối cùng cung cấp:

`git status --short`

`git diff --stat`

cho cả hai repo.

Nếu còn rủi ro hoặc việc chưa hoàn thành phải nói rõ, tuyệt đối không che giấu.

Mục tiêu là triển khai production-ready, không phải chỉ tạo prototype hoặc UI giả.