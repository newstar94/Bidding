# PROMPT CHO CODEX — TRA CỨU VI PHẠM NHÀ THẦU KHI NHẬP BIÊN BẢN MỞ THẦU

## 0. Bối cảnh và mục tiêu

Bạn đang làm việc trong repository BiddingFlow:

```text
https://github.com/newstar94/Bidding
```

Hãy nghiên cứu kỹ **code mới nhất của nhánh hiện tại** trước khi thay đổi. Không được giả định tên bảng, module, route, quyền hoặc cấu trúc frontend vẫn giống mô tả cũ nếu source hiện tại đã thay đổi.

Mục tiêu là triển khai chức năng sau:

Khi người dùng nhập **mã nhà thầu** tại bước nhập **biên bản mở thầu**:

1. Nếu nhà thầu chưa có trong database BiddingFlow, hệ thống tra cứu thông tin nhà thầu từ Hệ thống Mạng đấu thầu quốc gia/Mua sắm công theo cơ chế tích hợp hiện có hoặc provider mới.
2. Dù nhà thầu đã có hay chưa có trong database, hệ thống vẫn dùng mã nhà thầu để tra cứu dữ liệu vi phạm.
3. Backend đánh giá nhà thầu có vi phạm tại **thời điểm đóng thầu của gói thầu** hay không.
4. Nếu xác định chắc chắn có vi phạm, frontend chỉ **tô đỏ tên nhà thầu**.
5. Không hiển thị popup, modal, tooltip, icon, badge, toast, banner, bảng chi tiết hoặc thông tin vi phạm bổ sung.
6. Nếu một thành viên liên danh vi phạm:
   - tô đỏ tên liên danh;
   - tô đỏ đúng tên thành viên liên danh vi phạm;
   - các thành viên không vi phạm giữ màu bình thường.
7. Kết quả phải được lưu để sau khi tải lại trang vẫn tô màu đúng.

Không dừng ở kế hoạch hoặc pseudocode. Hãy sửa code thật, bổ sung migration nếu cần, provider, service, API, frontend và test.

---

# 1. Yêu cầu giao diện tuyệt đối

Đây là yêu cầu bắt buộc của chủ sản phẩm.

## 1.1 Chỉ tô đỏ tên

Khi có vi phạm đã được xác nhận:

```text
Nhà thầu độc lập vi phạm
→ tên nhà thầu màu đỏ

Một thành viên liên danh vi phạm
→ tên liên danh màu đỏ
→ tên đúng thành viên vi phạm màu đỏ
→ tên thành viên không vi phạm giữ màu bình thường

Nhiều thành viên liên danh vi phạm
→ tên liên danh màu đỏ
→ tên tất cả thành viên vi phạm màu đỏ
```

## 1.2 Không được thêm thành phần cảnh báo khác

Không được thêm:

- popup;
- modal;
- tooltip;
- icon cảnh báo;
- badge;
- toast;
- banner;
- dòng mô tả;
- nhãn “Có vi phạm”;
- nút xem chi tiết;
- link nguồn;
- cột mới;
- thông báo nổi;
- nội dung phụ dưới tên;
- thay đổi layout.

Không hiển thị lý do, số quyết định, ngày xử phạt hoặc loại vi phạm trên màn hình biên bản mở thầu.

Backend có thể lưu dữ liệu nội bộ phục vụ audit và tính toán, nhưng frontend chỉ dùng kết quả boolean/trạng thái để tô màu tên.

## 1.3 CSS

Tái sử dụng design token màu nguy hiểm hiện có của BiddingFlow.

Ví dụ:

```css
.bidder-name--violator {
    color: var(--color-danger);
}
```

Không hard-code màu nếu repository đã có token.

Không dùng inline style.

Không dùng `!important` nếu không thực sự cần.

Không thay đổi font, kích thước, nền hoặc bố cục.

---

# 2. Điểm kích hoạt tra cứu

Khi người dùng nhập mã nhà thầu tại màn hình biên bản mở thầu:

```text
Nhập mã nhà thầu
→ xác thực định dạng
→ resolve thông tin nhà thầu
→ tra cứu vi phạm
→ tính trạng thái theo thời điểm đóng thầu
→ lưu kết quả
→ render tên
```

## 2.1 Không gọi API theo từng ký tự

Chỉ tra cứu khi:

- người dùng nhấn Enter;
- rời khỏi ô;
- bấm hành động xác nhận hiện có;
- hoặc mã đã hoàn chỉnh theo validation của hệ thống.

Dùng debounce và hủy request cũ nếu mã thay đổi.

## 2.2 Tra cứu thông tin nhà thầu

Nếu contractor đã có trong database:

- dùng dữ liệu hiện có;
- không bắt buộc gọi lại API thông tin nhà thầu;
- vẫn tra cứu vi phạm theo chính sách cache/refresh.

Nếu contractor chưa có:

- gọi provider Mua sắm công để lấy thông tin;
- chuẩn hóa;
- hiển thị/lưu theo luồng hiện có;
- đồng thời tra cứu vi phạm.

Không để lỗi tra cứu vi phạm ngăn người dùng nhập nhà thầu nếu nghiệp vụ hiện tại cho phép tiếp tục.

---

# 3. Khóa đối chiếu nhà thầu

Ưu tiên:

```text
1. Mã định danh nhà thầu
2. Mã số thuế/số chứng thực
3. Tên chỉ dùng để hỗ trợ kiểm tra, không dùng làm khóa duy nhất
```

Không kết luận vi phạm chỉ do tên giống nhau.

Chuẩn hóa mã:

- trim;
- giữ số 0 đầu;
- không chuyển mã thành float;
- xử lý Unicode và khoảng trắng;
- không tự sửa giá trị nghiệp vụ không có căn cứ.

Nếu mã định danh và mã số thuế dẫn đến hai thực thể khác nhau:

```text
IDENTITY_CONFLICT
```

Không tô đỏ vì chưa đủ căn cứ.

---

# 4. Các nhóm vi phạm cần kiểm tra

Chỉ tính ba nhóm sau theo đúng quy tắc của chủ sản phẩm:

```text
BIDDING_BAN
CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT
UNRELIABLE_BID_PARTICIPATION
```

Không tự động dùng các nhóm vi phạm khác để tô đỏ nếu chưa có yêu cầu.

Nếu nguồn phân loại chấm dứt hợp đồng thành nhiều nhóm pháp lý, chỉ đưa vào nhóm tính toán khi bản chất là:

```text
chấm dứt hợp đồng do lỗi của nhà thầu
```

Không tính trường hợp chấm dứt không do lỗi nhà thầu.

---

# 5. Thời điểm tham chiếu

Mọi quy tắc phải được đánh giá tại:

```text
bid_closing_at
```

tức thời điểm đóng thầu của gói/phần lô tương ứng.

Không dùng:

- thời điểm nhập biên bản;
- thời điểm tra cứu;
- thời điểm hiện tại;
- `created_at`;
- `updated_at`;

thay cho thời điểm đóng thầu.

Dùng datetime có timezone theo cấu hình BiddingFlow.

Nếu gói phân lô có thời điểm đóng thầu riêng từng lô, dùng thời điểm đúng của lô. Nếu code hiện tại chỉ có một thời điểm đóng thầu chung, dùng trường chuẩn hiện có.

---

# 6. Quy tắc tính vi phạm

## 6.1 Cấm tham gia hoạt động đấu thầu

Tính vi phạm khi nhà thầu **đang trong thời hạn xử phạt tại thời điểm đóng thầu**.

Quy tắc chuẩn:

```text
decision chưa bị hủy/thu hồi
AND effective_from <= bid_closing_at
AND bid_closing_at < effective_to
```

Nếu nguồn trả thời hạn và đơn vị thay vì `effective_to`:

```text
effective_to = add_calendar_duration(
    effective_from,
    duration,
    duration_unit
)
```

Không dùng số ngày xấp xỉ nếu đơn vị là tháng/năm.

Nếu nguồn có trạng thái chuẩn xác tương ứng “đang trong thời hạn xử phạt”, có thể dùng làm tín hiệu nhưng vẫn phải bảo đảm đánh giá đúng theo `bid_closing_at`, không chỉ theo ngày tra cứu hiện tại.

Trường hợp:

- quyết định bắt đầu sau thời điểm đóng thầu → không vi phạm;
- quyết định hết hiệu lực đúng thời điểm đóng thầu → không còn vi phạm nếu dùng khoảng `[start, end)`;
- quyết định bị hủy/thu hồi → không vi phạm;
- thiếu ngày/thời hạn cần thiết → không xác nhận vi phạm.

## 6.2 Chấm dứt hợp đồng do lỗi của nhà thầu

Tính vi phạm khi:

```text
issued_date <= bid_closing_at
AND bid_closing_at < issued_date + 5 năm lịch
AND quyết định chưa bị hủy/thu hồi
```

Phải cộng **5 năm lịch** bằng thư viện date/calendar thích hợp.

Không dùng:

```text
5 * 365 ngày
```

Ví dụ:

```text
issued_date = 15/08/2021

bid_closing_at = 14/08/2026
→ vi phạm

bid_closing_at = 15/08/2026
→ đã đủ 5 năm, không vi phạm
```

Nếu quyết định ban hành sau thời điểm đóng thầu:

```text
không vi phạm tại thời điểm đóng thầu
```

## 6.3 Không bảo đảm uy tín khi tham dự thầu

Tính vi phạm khi:

```text
behavior_date <= bid_closing_at
AND bid_closing_at < behavior_date + 2 năm lịch
AND thông báo/quyết định chưa bị hủy
```

Phải dùng **ngày thực hiện hành vi**, không tự thay bằng:

- ngày đăng tải;
- ngày cập nhật;
- ngày tạo bản ghi;
- ngày ban hành;

nếu chưa có quy tắc nghiệp vụ cho phép.

Nếu không lấy được `behavior_date`:

```text
REVIEW_REQUIRED
```

Không tô đỏ.

Ví dụ:

```text
behavior_date = 10/09/2024

bid_closing_at = 09/09/2026
→ vi phạm

bid_closing_at = 10/09/2026
→ đã đủ 2 năm, không vi phạm
```

---

# 7. Trạng thái nội bộ

Không chỉ lưu một boolean nếu cần phân biệt lỗi nguồn và thiếu dữ liệu.

Dùng enum tương đương:

```text
VIOLATION_CONFIRMED
NO_ACTIVE_VIOLATION
REVIEW_REQUIRED
LOOKUP_FAILED
NOT_CHECKED
IDENTITY_CONFLICT
```

Quy tắc frontend:

```text
VIOLATION_CONFIRMED
→ tô đỏ

mọi trạng thái còn lại
→ không tô đỏ
```

Không hiển thị trạng thái nội bộ ra UI.

Không tô đỏ trong trường hợp:

- API timeout;
- không kết nối được nguồn;
- thiếu ngày;
- thiếu thời hạn;
- dữ liệu xung đột;
- chưa tra cứu;
- không xác định được bản ghi.

Không được coi `LOOKUP_FAILED` là `NO_ACTIVE_VIOLATION`.

---

# 8. Liên danh

## 8.1 Tra cứu từng thành viên

Mỗi thành viên liên danh phải được tra cứu độc lập bằng mã định danh của thành viên.

Không chỉ tra cứu mã/tên liên danh.

Mỗi thành viên lưu trạng thái riêng:

```text
member.violation_status
```

## 8.2 Quy tắc tô màu

```python
member_is_red = (
    member.violation_status == "VIOLATION_CONFIRMED"
)

joint_venture_is_red = any(
    member.violation_status == "VIOLATION_CONFIRMED"
    for member in members
)
```

Kết quả:

- tên liên danh đỏ nếu ít nhất một thành viên vi phạm;
- tên thành viên vi phạm đỏ;
- thành viên không vi phạm không đỏ;
- thành viên `REVIEW_REQUIRED` hoặc `LOOKUP_FAILED` không đỏ;
- không tô đỏ toàn bộ thành viên chỉ vì liên danh có một người vi phạm.

## 8.3 Thay đổi thành viên

Khi:

- thêm thành viên;
- xóa thành viên;
- đổi mã;
- thay trưởng liên danh;

phải tính lại trạng thái tên liên danh.

Không giữ màu đỏ nếu thành viên vi phạm đã bị xóa khỏi liên danh.

---

# 9. Lưu dữ liệu và snapshot

Kết quả phải được lưu để:

- reload trang vẫn tô đúng;
- không phải gọi nguồn ngoài mỗi lần render;
- biết kết quả được tính theo thời điểm đóng thầu nào;
- phục vụ audit nội bộ;
- cho phép tính lại khi thời điểm đóng thầu thay đổi.

Đánh giá schema hiện có trước khi thêm bảng.

Nếu chưa có nơi phù hợp, tạo entity tương đương:

```text
contractor_violation_checks
```

Các trường tối thiểu:

```text
id
organization_id
package_id
lot_id nullable
bid_opening_record_id
contractor_id nullable
joint_venture_id nullable
joint_venture_member_id nullable
contractor_identifier
tax_code nullable
bid_closing_at
checked_at
status
matched_identity_type
rule_version
source_provider
source_payload_hash
created_by
created_at
updated_at
```

Có thể lưu bản ghi vi phạm chuẩn hóa trong bảng con hoặc JSON đã validate:

```text
category
decision_number
issued_date
effective_from
effective_to
behavior_date
duration
duration_unit
source_status
is_revoked
is_applicable
```

Không bắt buộc lưu raw payload đầy đủ.

Không lưu dữ liệu nhạy cảm không cần thiết.

## 9.1 Rule version

Lưu:

```text
rule_version
```

để biết kết quả được tính theo phiên bản quy tắc nào.

Ví dụ:

```text
2026.1
```

## 9.2 Thời điểm đóng thầu thay đổi

Nếu `bid_closing_at` thay đổi:

- đánh dấu snapshot cũ là stale;
- tính lại từ raw normalized records hoặc gọi lại provider;
- cập nhật trạng thái;
- render lại màu.

Không tiếp tục dùng kết quả được tính theo thời điểm cũ.

---

# 10. Provider Mua sắm công

Tạo abstraction, không gọi nguồn ngoài rải rác trong controller/route.

Cấu trúc gợi ý:

```text
backend/integrations/vneps/
├── __init__.py
├── client.py
├── contractor_provider.py
├── violation_provider.py
├── response_parser.py
├── normalization.py
├── types.py
├── cache.py
└── errors.py
```

Service nghiệp vụ:

```text
backend/contractor_risk/
├── __init__.py
├── types.py
├── violation_rules.py
├── service.py
├── repository.py
└── routes.py
```

Điều chỉnh theo convention repository.

## 10.1 Không phụ thuộc cấu trúc frontend của nguồn

Nếu Mua sắm công không có API chính thức được tài liệu hóa:

- xác định request/response thực tế bằng trình duyệt DevTools hoặc Playwright;
- không bypass CAPTCHA, đăng nhập hoặc cơ chế chống bot;
- không thực hiện crawl hàng loạt;
- tuân thủ giới hạn hợp lý;
- tạo adapter để dễ sửa khi nguồn đổi schema;
- dùng fixture response trong test;
- không gọi live source trong CI.

## 10.2 Timeout và retry

- timeout ngắn, cấu hình được;
- retry có giới hạn cho lỗi mạng tạm thời;
- không retry lỗi validation;
- circuit breaker khi nguồn lỗi liên tục;
- không khóa UI vô thời hạn.

## 10.3 Cache

Cache theo:

```text
provider
contractor_identifier
tax_code
response_schema_version
```

Cache **raw normalized violation records**, không chỉ cache kết luận boolean.

Lý do: cùng nhà thầu nhưng mỗi gói có `bid_closing_at` khác nhau.

Có TTL cấu hình được.

Không dùng cache của mã nhà thầu khác.

Không trộn organization nếu dữ liệu cache có thêm metadata nội bộ.

---

# 11. API nội bộ BiddingFlow

Tái sử dụng route hiện có nếu phù hợp.

Có thể thêm endpoint:

```http
POST /api/packages/{package_id}/bid-opening/contractors/resolve
```

Request:

```json
{
  "contractorIdentifier": "...",
  "lotId": null,
  "jointVentureId": null,
  "jointVentureMemberId": null
}
```

Backend phải tự xác định:

- current user;
- organization;
- package;
- bid opening record;
- bid closing time;
- quyền;
- membership.

Không tin:

```text
organizationId
userId
bidClosingAt
violationStatus
```

do frontend gửi.

Response chỉ cần dữ liệu UI hiện có và trạng thái kỹ thuật tối thiểu:

```json
{
  "contractor": {
    "id": "...",
    "identifier": "...",
    "taxCode": "...",
    "name": "..."
  },
  "violationStatus": "VIOLATION_CONFIRMED"
}
```

Frontend không cần nhận danh sách quyết định nếu không dùng.

Có thể giữ chi tiết tại backend.

---

# 12. Phân quyền và multi-tenancy

Mọi request phải:

- xác thực session;
- kiểm tra package thuộc organization hiện tại;
- kiểm tra user có quyền xem/sửa biên bản mở thầu;
- kiểm tra lot/joint venture/member thuộc đúng package;
- ngăn truy cập chéo organization;
- ghi audit theo convention hiện có.

Không để người dùng:

- gửi package ID của tổ chức khác;
- gắn contractor check vào biên bản khác;
- đọc snapshot của tổ chức khác;
- sửa `violationStatus` từ frontend.

Backend là nguồn quyết định cuối.

---

# 13. Frontend

Tìm đúng module nhập biên bản mở thầu hiện có.

Không thêm framework mới.

## 13.1 State

Mỗi nhà thầu/thành viên cần có state tương đương:

```text
violationStatus
```

State phải được hydrate từ backend khi tải biên bản.

## 13.2 Render

Ví dụ:

```javascript
const isViolator =
  bidder.violationStatus === "VIOLATION_CONFIRMED";

nameElement.classList.toggle(
  "bidder-name--violator",
  isViolator
);
```

Liên danh:

```javascript
const jointVentureIsViolator = members.some(
  member =>
    member.violationStatus === "VIOLATION_CONFIRMED"
);
```

Không render thêm nội dung.

## 13.3 Trạng thái loading

Trong lúc tra cứu:

- giữ màu hiện tại hoặc màu bình thường theo state đã lưu;
- không hiển thị spinner cạnh tên nếu UI hiện tại không có;
- không thêm thông báo mới;
- tránh nhấp nháy màu.

Khi request hoàn tất, cập nhật class.

## 13.4 Lỗi nguồn

Nếu lookup lỗi:

- không popup;
- không toast mới chỉ dành cho vi phạm;
- không tô đỏ;
- có thể ghi lỗi theo cơ chế nền/log hiện có;
- không chặn việc nhập biên bản nếu nghiệp vụ hiện tại không yêu cầu.

Không che lỗi kỹ thuật khỏi log/test.

---

# 14. Cấu hình quy tắc

Không hard-code số năm rải rác.

Tạo cấu hình/domain constants tập trung:

```text
CONTRACT_TERMINATION_LOOKBACK_YEARS = 5
UNRELIABLE_BID_LOOKBACK_YEARS = 2
```

Hoặc registry:

```python
VIOLATION_RULES = {
    "CONTRACT_TERMINATION_BY_CONTRACTOR_FAULT": {
        "years": 5,
        "date_field": "issued_date",
    },
    "UNRELIABLE_BID_PARTICIPATION": {
        "years": 2,
        "date_field": "behavior_date",
    },
}
```

Cấm thầu dùng khoảng hiệu lực thực tế, không dùng số năm cố định.

Dùng calendar arithmetic.

Viết rõ boundary `[start, end)`.

---

# 15. Audit

Ghi audit nội bộ:

- user;
- organization;
- package;
- lot;
- bid opening record;
- contractor/member;
- checked_at;
- bid_closing_at;
- status;
- provider;
- rule_version;
- source payload hash;
- lookup success/failure.

Không cần hiển thị audit trên màn hình nhập biên bản.

Không log raw payload đầy đủ nếu chứa dữ liệu không cần thiết.

---

# 16. Kiểm thử bắt buộc

## 16.1 Unit test quy tắc thời gian

### Cấm thầu

1. Trước ngày hiệu lực.
2. Đúng ngày hiệu lực.
3. Trong thời hạn.
4. Ngay trước ngày hết hạn.
5. Đúng ngày hết hạn.
6. Sau ngày hết hạn.
7. Quyết định bị hủy.
8. Thiếu ngày bắt đầu.
9. Thiếu ngày kết thúc.
10. Thời hạn theo tháng/năm.

### Chấm dứt hợp đồng

1. Quyết định trước đóng thầu chưa đủ 5 năm.
2. Đúng ngày đủ 5 năm.
3. Sau 5 năm.
4. Quyết định sau đóng thầu.
5. Năm nhuận.
6. Ngày 29/02.
7. Quyết định bị thu hồi.
8. Thiếu ngày ban hành.

### Không bảo đảm uy tín

1. Hành vi trước đóng thầu chưa đủ 2 năm.
2. Đúng ngày đủ 2 năm.
3. Sau 2 năm.
4. Hành vi sau đóng thầu.
5. Thiếu ngày hành vi.
6. Có `publicDate` nhưng không có `behavior_date`.
7. Thông báo bị hủy.

## 16.2 Matching

- mã định danh khớp;
- mã số thuế khớp;
- tên giống nhưng mã khác;
- mã có số 0 đầu;
- whitespace;
- Unicode;
- identifier/tax conflict;
- nhiều record cùng nhà thầu;
- record thuộc nhà thầu khác.

## 16.3 Nhà thầu độc lập

- không vi phạm → tên không đỏ;
- có vi phạm → tên đỏ;
- review required → không đỏ;
- lookup failed → không đỏ;
- reload → giữ màu;
- đổi mã → tính lại;
- xóa nhà thầu → xóa state liên quan.

## 16.4 Liên danh

1. Không thành viên nào vi phạm.
2. Một thành viên vi phạm.
3. Hai thành viên vi phạm.
4. Thành viên vi phạm bị xóa.
5. Thêm thành viên vi phạm.
6. Đổi mã thành viên.
7. Thành viên `REVIEW_REQUIRED`.
8. Thành viên `LOOKUP_FAILED`.
9. Tên liên danh đỏ khi có ít nhất một người vi phạm.
10. Chỉ thành viên vi phạm đỏ.
11. Thành viên không vi phạm giữ màu bình thường.
12. Reload vẫn đúng.

## 16.5 UI invariant

Test DOM/CSS để chứng minh:

- chỉ class màu đỏ được thêm;
- không có popup mới;
- không có modal mới;
- không có tooltip mới;
- không có icon mới;
- không có badge mới;
- không có toast mới;
- không có text cảnh báo mới;
- không có cột mới;
- layout không đổi.

## 16.6 API và bảo mật

- chưa đăng nhập;
- thiếu quyền;
- package tổ chức khác;
- lot tổ chức khác;
- member không thuộc liên danh;
- sửa `violationStatus` từ frontend;
- provider timeout;
- provider schema thay đổi;
- retry;
- cache;
- audit;
- không leak dữ liệu chéo tổ chức.

## 16.7 Integration

Tạo dữ liệu:

- một gói có thời điểm đóng thầu cố định;
- một nhà thầu độc lập;
- một liên danh ba thành viên;
- một bản ghi cấm đang hiệu lực;
- một quyết định chấm dứt chưa đủ 5 năm;
- một hành vi không uy tín chưa đủ 2 năm;
- các bản ghi hết hạn;
- dữ liệu thiếu ngày.

Chạy toàn bộ luồng:

```text
nhập mã
→ resolve contractor
→ lookup violation
→ lưu snapshot
→ reload
→ kiểm tra màu
```

## 16.8 E2E Playwright

Thao tác qua trình duyệt:

1. Đăng nhập.
2. Mở gói thầu.
3. Vào biên bản mở thầu.
4. Nhập mã nhà thầu.
5. Chờ resolve.
6. Xác nhận tên đổi đỏ khi vi phạm.
7. Xác nhận không có popup/tooltip/icon/badge/text phụ.
8. Reload.
9. Kiểm tra vẫn đỏ.
10. Tạo liên danh.
11. Nhập thành viên vi phạm.
12. Kiểm tra tên liên danh và đúng thành viên đỏ.
13. Kiểm tra thành viên khác không đỏ.
14. Thay thời điểm đóng thầu để trạng thái hết hiệu lực.
15. Kiểm tra màu được cập nhật.

Dùng fake/recorded provider trong CI, không phụ thuộc live Mua sắm công.

---

# 17. Không được làm

Không được:

- tự động loại nhà thầu;
- ngăn lưu biên bản chỉ vì có vi phạm;
- tự động xóa nhà thầu;
- thay đổi kết quả đánh giá;
- hiển thị popup cảnh báo;
- hiển thị chi tiết vi phạm;
- tô đỏ khi chưa đủ dữ liệu;
- dùng tên làm khóa duy nhất;
- dùng ngày hiện tại thay thời điểm đóng thầu;
- dùng `5 * 365` hoặc `2 * 365`;
- lấy ngày đăng tải thay ngày hành vi;
- gọi nguồn ngoài ở mỗi lần render;
- gọi API theo từng ký tự;
- bypass CAPTCHA/anti-bot;
- gọi live source trong CI;
- để frontend quyết định trạng thái vi phạm;
- hard-code màu đỏ ngoài design token;
- làm hỏng các test và chức năng hiện có.

---

# 18. Tiêu chí nghiệm thu

Chức năng chỉ hoàn thành khi:

1. Người dùng nhập mã nhà thầu tại biên bản mở thầu.
2. Nhà thầu chưa có DB được resolve theo luồng hiện có.
3. Vi phạm được tra cứu cho cả nhà thầu đã có và chưa có DB.
4. Quy tắc dùng đúng thời điểm đóng thầu.
5. Cấm thầu dùng trạng thái/khoảng hiệu lực.
6. Chấm dứt do lỗi dùng mốc 5 năm lịch.
7. Không bảo đảm uy tín dùng mốc 2 năm lịch từ ngày hành vi.
8. Thiếu dữ liệu không bị tô đỏ.
9. Nhà thầu độc lập vi phạm có tên đỏ.
10. Liên danh có thành viên vi phạm có tên liên danh đỏ.
11. Đúng thành viên vi phạm đỏ.
12. Thành viên không vi phạm không đỏ.
13. Không xuất hiện popup, tooltip, icon, badge, toast hoặc text phụ.
14. Reload vẫn hiển thị đúng.
15. Đổi thời điểm đóng thầu làm kết quả được tính lại.
16. Có cache và timeout hợp lý.
17. Có audit nội bộ.
18. Quyền và multi-tenancy được kiểm soát.
19. Unit, integration, API và E2E test chạy pass.
20. Các test cũ không bị hỏng.
21. Không tuyên bố test pass nếu chưa thực sự chạy.

---

# 19. Quy trình thực hiện

Thực hiện theo thứ tự:

1. Ghi branch và commit SHA.
2. Phân tích code mới nhất.
3. Xác định màn hình và model biên bản mở thầu.
4. Xác định luồng resolve nhà thầu hiện có.
5. Xác định provider/API Mua sắm công thực tế.
6. Tạo types và rule engine.
7. Tạo provider abstraction.
8. Tạo repository/snapshot.
9. Tạo migration nếu cần.
10. Tạo service.
11. Tạo/điều chỉnh API.
12. Tích hợp frontend.
13. Chỉ thêm CSS class màu đỏ.
14. Viết unit test.
15. Viết integration/API test.
16. Viết E2E.
17. Chạy formatter/linter/test.
18. Sửa lỗi.
19. Kiểm tra trực quan không có UI cảnh báo khác.
20. Tổng kết.

Không dừng ở bước kế hoạch.

---

# 20. Báo cáo cuối cùng Codex phải trả

## A. Mốc code

- Branch.
- Commit ban đầu.
- Commit cuối.
- Môi trường test.

## B. Kiến trúc

- Provider Mua sắm công.
- Rule engine.
- Snapshot.
- API.
- Frontend state.
- Cache.

## C. File thay đổi

| File | Thay đổi | Lý do |
|---|---|---|

## D. Mapping dữ liệu nguồn

- Mã định danh.
- Mã số thuế.
- Loại vi phạm.
- Ngày hiệu lực.
- Ngày ban hành.
- Ngày hành vi.
- Trạng thái hủy/thu hồi.

Nêu rõ trường nào chưa xác minh được từ nguồn live.

## E. Quy tắc

- Cấm thầu.
- Chấm dứt hợp đồng 5 năm.
- Không bảo đảm uy tín 2 năm.
- Boundary.
- Trường hợp thiếu dữ liệu.

## F. UI

Xác nhận:

```text
Chỉ tô đỏ tên.
Không popup.
Không modal.
Không tooltip.
Không icon.
Không badge.
Không toast.
Không text phụ.
```

## G. Test

Ghi command thật:

```text
<command>
PASS/FAIL
```

Nêu:

- số test;
- coverage;
- E2E;
- test chưa chạy;
- lý do.

## H. Hạn chế

- nguồn Mua sắm công thay schema;
- thiếu ngày hành vi;
- dữ liệu cũ;
- live API không truy cập được;
- rule cần chủ sản phẩm xác nhận.

Không được ghi “hoàn thành” nếu còn test fail hoặc tiêu chí nghiệm thu chưa đạt.
