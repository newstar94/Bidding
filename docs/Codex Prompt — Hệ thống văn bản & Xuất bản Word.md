# BIDDINGFLOW — IMPLEMENT “HỆ THỐNG VĂN BẢN” + “XUẤT BẢN WORD”

Bạn đang làm việc trực tiếp trên repository **BiddingFlow**.

Hãy triển khai hoàn chỉnh tính năng được mô tả dưới đây trên **HEAD hiện tại của repository**.

Đây là yêu cầu production, không phải prototype.

---

# 0. NGUYÊN TẮC LÀM VIỆC BẮT BUỘC

## 0.1. Audit trước khi code

Trước khi sửa bất kỳ file nào:

1. Xác nhận:
   - branch hiện tại
   - HEAD commit hiện tại
   - working tree có sạch hay không

2. Đọc tối thiểu:
   - `AGENTS.md`
   - `CONTEXT.md` nếu còn tồn tại
   - các tài liệu kiến trúc liên quan tới:
     - frontend navigation
     - procurement plan/package
     - Word template
     - document/export pipeline
     - permission
     - versioning
     - workspace sync/outbox

3. Tìm implementation hiện tại của:
   - menu/sidebar
   - `Biểu mẫu Word`
   - searchable dropdown/select đang được dùng ở các màn hình khác
   - Kế hoạch LCNT
   - Gói thầu
   - quan hệ Kế hoạch → Gói thầu
   - các field/enum xác định:
     - 1G1T
     - 1G2T
     - chỉ định thầu rút gọn
     - lựa chọn đặc biệt
   - Word/document/template/export service
   - document worker nếu có
   - API liên quan đến export Word
   - test liên quan

**Không được đoán tên file, field, enum, route hay API.**

Phải trace implementation hiện tại rồi mới quyết định cách sửa.

---

# 1. BASELINE KIẾN TRÚC CẦN BẢO TOÀN

Repository gần đây đã được harden về:

- versioning
- historical immutability
- workspace mutation outbox
- mutation generation/receipt
- finalize acknowledgement
- `isLatest`
- recalculation trước deletion guard
- canonical server state
- workspace isolation

HEAD cuối cùng được xác minh trước yêu cầu này là commit:

`593a5056f3238a78f5e0fd5bfccbf09096f3344c`

Tuy nhiên **không được mặc định đây vẫn là HEAD**.

Hãy xác minh HEAD hiện tại trước khi code.

Nếu repository đã có commit mới hơn thì lấy **HEAD mới nhất làm source of truth**.

Tính năng này về bản chất chủ yếu là:

**read → select context → determine document availability → generate/export Word**

Không được làm thay đổi semantics của:

- versioning
- sync
- outbox
- mutation receipt
- permission
- active role
- record scope
- assignment scope
- workspace isolation

trừ khi thực sự cần thiết và có căn cứ từ implementation hiện tại.

---

# 2. MỤC TIÊU SẢN PHẨM

Hiện sidebar có section:

**HỆ THỐNG MẪU**

bên trong có:

**Biểu mẫu Word**

Hãy thay đổi thành:

**HỆ THỐNG VĂN BẢN**

và trong section này có 2 menu item:

1. **Biểu mẫu Word**
2. **Xuất bản Word**

---

# 3. BIỂU MẪU WORD

`Biểu mẫu Word` phải **giữ nguyên toàn bộ chức năng hiện tại**.

Không được làm thay đổi ngoài ý muốn:

- route
- page
- data loading
- template management
- permission
- export behavior
- document worker behavior
- API contract
- active menu state
- responsive behavior

Nếu cần refactor navigation để thêm `Xuất bản Word`, phải có regression test chứng minh `Biểu mẫu Word` vẫn hoạt động như trước.

---

# 4. MENU “XUẤT BẢN WORD”

Thêm menu item mới:

**Xuất bản Word**

nằm ngay cùng section với:

**Biểu mẫu Word**

Cấu trúc mong muốn:

```text
HỆ THỐNG VĂN BẢN

  Biểu mẫu Word
  Xuất bản Word
```

Không đưa toàn bộ loại báo cáo thành submenu sidebar.

Các loại Word phải nằm bên trong màn hình **Xuất bản Word**.

---

# 5. ROUTE VÀ MÀN HÌNH XUẤT BẢN WORD

Tạo route/page mới cho:

**Xuất bản Word**

theo đúng convention router/page/module hiện tại.

Không tự phát minh một routing pattern mới.

Màn hình này có workflow:

```text
Chọn Kế hoạch LCNT
        ↓
Chọn Gói thầu thuộc Kế hoạch
        ↓
Đọc dữ liệu canonical của Gói thầu
        ↓
Xác định các loại văn bản phù hợp
        ↓
Hiển thị danh sách tài liệu có thể xuất
        ↓
Người dùng chọn Xuất Word
```

---

# 6. DROPDOWN KẾ HOẠCH

Ở đầu màn hình có field:

**Kế hoạch lựa chọn nhà thầu**

Sử dụng **searchable dropdown**.

## Bắt buộc

Phải audit các searchable dropdown đang tồn tại trong BiddingFlow và **reuse component/pattern hiện hữu**.

Không dùng native `<select>` nếu app đã có searchable select/combo box.

Không tự xây một searchable dropdown thứ hai nếu reusable component hiện tại đáp ứng được.

Dropdown phải:

- search được
- keyboard accessible theo capability của component hiện tại
- có loading state
- empty state
- clear/reset nếu component hiện tại hỗ trợ
- hiển thị option đủ rõ để phân biệt các Kế hoạch

Search tối thiểu theo các field thực sự tồn tại như:

- mã/số Kế hoạch
- tên Kế hoạch

Không được giả định tên field.

Phải kiểm tra schema/model hiện tại.

Ví dụ UI:

```text
Kế hoạch lựa chọn nhà thầu

[ 🔍 Tìm và chọn kế hoạch...                         ▼ ]
```

Option nên hiển thị theo dữ liệu thực tế, ví dụ:

```text
KHLCNT-2026-001
Kế hoạch mua sắm thiết bị năm 2026
```

hoặc dạng một dòng nếu component hiện tại phù hợp hơn.

---

# 7. VERSIONING CỦA KẾ HOẠCH

BiddingFlow có versioning Kế hoạch/Gói thầu.

Phải audit cách hệ thống hiện tại xác định:

- latest plan
- plan version
- `isLatest`
- historical plan
- package parent/version relationship

Dropdown Kế hoạch phải dùng đúng semantics hiện tại của application.

Không vô tình hiển thị version lịch sử nếu các màn hình nghiệp vụ hiện tại chỉ sử dụng latest version.

Không mutate historical record.

Không tạo version mới chỉ vì người dùng mở hoặc sử dụng màn hình Xuất bản Word.

---

# 8. DROPDOWN GÓI THẦU

Field thứ hai:

**Gói thầu**

Đây là dependent searchable dropdown.

## Trước khi chọn Kế hoạch

Dropdown Gói thầu:

- disabled
- không load toàn bộ Gói thầu không cần thiết
- placeholder:

```text
Vui lòng chọn Kế hoạch trước
```

hoặc wording tương đương theo UI convention hiện tại.

## Sau khi chọn Kế hoạch

Dropdown được enable.

Chỉ hiển thị:

**các Gói thầu thuộc Kế hoạch đang chọn**

Không được để người dùng chọn package thuộc plan khác.

Search tối thiểu theo các field có thật như:

- mã/số Gói
- tên Gói thầu

Ví dụ:

```text
Gói 03
Mua sắm trang thiết bị CNTT
```

---

# 9. SEARCH BEHAVIOR

Hãy audit xem searchable dropdown hiện tại đang hoạt động:

- client-side
- server-side
- hybrid

và sử dụng đúng pattern đó.

Nếu server-side search:

- reuse debounce hiện có
- tránh request race
- tránh stale response overwrite query mới
- loading state đúng
- empty state đúng

Nếu component/shared hook hiện tại đã xử lý các vấn đề trên thì reuse trực tiếp.

Không reimplement.

---

# 10. QUAN HỆ KẾ HOẠCH → GÓI THẦU

Đây là invariant của UI.

Khi user chọn:

`Kế hoạch A`

thì dropdown package chỉ có package thuộc:

`Kế hoạch A`

Nếu user đang có:

```text
Kế hoạch A
Gói A1
```

rồi đổi thành:

```text
Kế hoạch B
```

thì bắt buộc:

1. reset `Gói A1`
2. reset selected document type nếu có
3. clear document availability của `Gói A1`
4. không cho phép export bằng package ID cũ
5. load package list của `Kế hoạch B`

Không được giữ stale package state.

---

# 11. KHÔNG CHO USER TỰ CHỌN CLASSIFICATION

Sau khi chọn Gói thầu, **không tạo dropdown hoặc radio** để user tự chọn:

- 1G1T
- 1G2T
- chỉ định thầu rút gọn
- lựa chọn đặc biệt

Hệ thống phải tự đọc các thuộc tính này từ dữ liệu Gói thầu.

Không yêu cầu user khai báo lại dữ liệu hệ thống đã có.

---

# 12. SOURCE OF TRUTH CỦA CLASSIFICATION

Trước khi implement conditional logic, hãy tìm chính xác field/domain code hiện đang được BiddingFlow sử dụng để xác định:

## A. Phương thức:

- 1G1T
- 1G2T

## B. Hình thức lựa chọn:

- chỉ định thầu rút gọn
- lựa chọn đặc biệt
- các hình thức khác

Ưu tiên:

- canonical enum
- canonical code
- backend/domain constants
- normalized field

Không viết logic kiểu:

```js
package.name.includes("1G2T")
```

Không viết:

```js
package.method === "Một giai đoạn hai túi hồ sơ"
```

nếu hệ thống đã có canonical code.

Không dựa vào label tiếng Việt để quyết định business rule nếu source code có identifier chuẩn.

---

# 13. DOCUMENT AVAILABILITY POLICY

Không rải `if/else` trong render component.

Tạo một layer/config/policy tập trung theo convention hiện tại.

Ví dụ conceptual API:

```js
getAvailableWordPublicationTypes({
  plan,
  packageRecord
})
```

Tên thật phải theo coding convention của repository.

Mục tiêu là:

```text
package canonical data
        ↓
document availability policy
        ↓
list document types
        ↓
UI render
```

---

# 14. DANH SÁCH LOẠI VĂN BẢN

Sau khi chọn Gói thầu, hệ thống hiển thị khu vực:

**Loại văn bản có thể xuất bản**

Các loại cần hỗ trợ:

### Nhóm chung

1. **Kế hoạch lựa chọn nhà thầu**
2. **Tư vấn lập, đánh giá Bước 1**
3. **Tư vấn lập, đánh giá Bước 2**
4. **Tư vấn thẩm định Bước 1**
5. **Tư vấn thẩm định Bước 2**

### Theo 1G1T

6. **Báo cáo đánh giá**

Chỉ áp dụng khi Gói thầu là:

**1G1T**

### Theo 1G2T

7. **Báo cáo đánh giá E-HSĐXKT**
8. **Báo cáo đánh giá E-HSĐXKT**
9. **Báo cáo đánh giá E-HSĐXKT**

Cả 3 chỉ áp dụng khi Gói thầu là:

**1G2T**

### Theo hình thức lựa chọn

10. **Báo cáo thẩm định, KQLCNT**

Áp dụng cho:

**tất cả Gói thầu KHÔNG phải:**
- chỉ định thầu rút gọn
- lựa chọn đặc biệt

11. **Kết quả lựa chọn nhà thầu**

Áp dụng khi Gói thầu là:
- chỉ định thầu rút gọn
- hoặc lựa chọn đặc biệt

---

# 15. BA DOCUMENT E-HSĐXKT

Input nghiệp vụ hiện tại cung cấp 3 document có cùng tên:

**Báo cáo đánh giá E-HSĐXKT**

Không được tự ý merge chúng thành một loại.

Phải tạo **3 document definition riêng biệt** với stable internal ID khác nhau.

Ví dụ conceptual IDs:

```text
evaluation_ehsdxkt_01
evaluation_ehsdxkt_02
evaluation_ehsdxkt_03
```

Tên thật phải theo convention repository.

Mục đích là sau này có thể đổi label/template/mapping riêng cho từng loại mà không phải migration identity.

Nếu việc hiển thị 3 label giống hệt nhau gây khó sử dụng, có thể tạm render:

```text
Báo cáo đánh giá E-HSĐXKT (1)
Báo cáo đánh giá E-HSĐXKT (2)
Báo cáo đánh giá E-HSĐXKT (3)
```

nhưng:

- stable IDs phải độc lập
- không dùng display label làm identity
- cấu trúc phải cho phép đổi tên từng loại sau này dễ dàng

Không tự suy đoán tên nghiệp vụ mới cho 3 tài liệu này.

---

# 16. BUSINESS RULE CHI TIẾT

## CASE A — GÓI 1G1T

Khi package là 1G1T:

hiển thị nhóm chung:

```text
Kế hoạch lựa chọn nhà thầu
Tư vấn lập, đánh giá Bước 1
Tư vấn lập, đánh giá Bước 2
Tư vấn thẩm định Bước 1
Tư vấn thẩm định Bước 2
```

và:

```text
Báo cáo đánh giá
```

Không hiển thị ba E-HSĐXKT dành riêng 1G2T.

Sau đó tiếp tục áp dụng rule hình thức lựa chọn để xác định:

```text
Báo cáo thẩm định, KQLCNT
```

hoặc:

```text
Kết quả lựa chọn nhà thầu
```

---

# 17. CASE B — GÓI 1G2T

Khi package là 1G2T:

hiển thị nhóm chung:

```text
Kế hoạch lựa chọn nhà thầu
Tư vấn lập, đánh giá Bước 1
Tư vấn lập, đánh giá Bước 2
Tư vấn thẩm định Bước 1
Tư vấn thẩm định Bước 2
```

và ba document riêng:

```text
Báo cáo đánh giá E-HSĐXKT (1)
Báo cáo đánh giá E-HSĐXKT (2)
Báo cáo đánh giá E-HSĐXKT (3)
```

Không hiển thị:

```text
Báo cáo đánh giá
```

nếu đây là document riêng của 1G1T.

Tiếp tục áp dụng rule hình thức lựa chọn.

---

# 18. CASE C — GÓI THÔNG THƯỜNG

Nếu hình thức lựa chọn **không phải**:

- chỉ định thầu rút gọn
- lựa chọn đặc biệt

thì hiển thị:

**Báo cáo thẩm định, KQLCNT**

---

# 19. CASE D — CHỈ ĐỊNH THẦU RÚT GỌN / LỰA CHỌN ĐẶC BIỆT

Nếu Gói thầu thuộc một trong hai hình thức:

- chỉ định thầu rút gọn
- lựa chọn đặc biệt

thì hiển thị:

**Kết quả lựa chọn nhà thầu**

và không hiển thị:

**Báo cáo thẩm định, KQLCNT**

nếu hai document này loại trừ nhau theo yêu cầu trên.

---

# 20. DATA-DRIVEN CONFIG

Document types phải được cấu hình tập trung.

Ví dụ conceptual structure:

```js
{
  id,
  label,
  applicability,
  templateType,
  exportAction
}
```

Có thể bổ sung:

```js
description
icon
category
sortOrder
```

nếu phù hợp kiến trúc hiện tại.

Không duplicate strings và business logic khắp nhiều component.

---

# 21. UX MÀN HÌNH

Thiết kế đồng nhất với application hiện tại.

Bố cục đề xuất:

```text
XUẤT BẢN WORD

Chọn dữ liệu

Kế hoạch lựa chọn nhà thầu
[ searchable dropdown                         ]

Gói thầu
[ searchable dependent dropdown               ]


Thông tin gói thầu

Tên gói: ...
Phương thức: ...
Hình thức LCNT: ...


Loại văn bản có thể xuất bản

┌──────────────────────────────────────────────┐
│ icon   Kế hoạch lựa chọn nhà thầu            │
│        [Xuất Word]                           │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ icon   Tư vấn lập, đánh giá Bước 1           │
│        [Xuất Word]                           │
└──────────────────────────────────────────────┘

...
```

Đây chỉ là hướng UX.

Hãy reuse design system/component pattern hiện tại thay vì xây layout xa lạ với ứng dụng.

---

# 22. TRẠNG THÁI UI

## Chưa chọn Kế hoạch

Hiển thị:

- Plan dropdown
- Package dropdown disabled
- chưa hiển thị document list

Có thể có empty-state nhẹ:

```text
Chọn Kế hoạch và Gói thầu để xem các văn bản có thể xuất.
```

---

## Đã chọn Kế hoạch nhưng chưa chọn Gói

- Plan dropdown có value
- Package dropdown enabled
- document list chưa xuất hiện

---

## Đã chọn Gói

- render package information
- calculate document availability
- render đúng document types

---

# 23. KHI ĐỔI GÓI THẦU

Ví dụ:

```text
Kế hoạch A
Gói A — 1G1T
```

UI đang có:

```text
Báo cáo đánh giá
```

User đổi sang:

```text
Gói B — 1G2T
```

UI phải ngay lập tức:

- bỏ `Báo cáo đánh giá`
- thêm 3 E-HSĐXKT
- recalculate hình thức lựa chọn
- reset selected document/action state cũ nếu không còn hợp lệ

Không để state từ package A bleed sang package B.

---

# 24. WORD EXPORT PIPELINE

Audit kỹ implementation hiện tại của:

**Biểu mẫu Word / document generation / document worker / export Word**

Ưu tiên reuse.

Không tạo hệ thống export Word mới nếu backend đã có:

- document types
- templates
- template resolver
- document rendering
- document worker
- export/download API

Mục tiêu:

```text
Xuất bản Word
     ↓
document type
     ↓
existing document/template pipeline
     ↓
generate Word
     ↓
download/result
```

không phải:

```text
Xuất bản Word
     ↓
new duplicated document subsystem
```

---

# 25. TEMPLATE MAPPING

Mỗi document type phải có stable identity để sau này map vào template Word tương ứng.

Nếu repository hiện tại chưa có template cho một số document mới:

- vẫn thiết kế document type/config sạch
- không hard-code template binary
- không fake document content
- không tạo placeholder Word giả như thể chức năng đã hoàn tất

Hãy trace xem hệ thống hiện tại xử lý:

- missing template
- template unavailable
- disabled export
- incomplete configuration

và dùng cùng pattern.

Nếu cần support backend mới để map document type → template, hãy implement tối thiểu theo architecture hiện tại.

---

# 26. NÚT XUẤT WORD

Mỗi document item khả dụng có action:

**Xuất Word**

Khi click:

- dùng selected plan
- dùng selected package
- dùng stable document type
- gọi pipeline hiện có
- chống accidental duplicate submission theo pattern app
- có loading state
- có failure feedback
- có success/download behavior đúng với app hiện tại

Không dùng package/plan ID stale.

---

# 27. PERMISSION

Không được tự phát minh permission mới nếu không cần.

Audit quyền hiện tại của:

- `Biểu mẫu Word`
- Word export
- document generation
- route/menu access

Nếu `Xuất bản Word` là capability cùng nhóm permission hiện tại thì reuse đúng semantics.

Không tự thay đổi:

- role hierarchy
- active role
- record scope
- masking
- redaction
- entitlement semantics

chỉ để làm tính năng này.

Đặc biệt tuân thủ `AGENTS.md`.

---

# 28. OFFLINE / OUTBOX

Feature này chủ yếu là read/export.

Không enqueue selection state vào workspace mutation outbox.

Không coi:

- chọn Kế hoạch
- chọn Gói thầu
- chọn loại Word

là domain mutation.

Nếu generate/export hiện tại có một server-side action riêng, dùng flow hiện tại của document pipeline.

Không đụng tới outbox chỉ để “đồng bộ hóa” UI selection.

---

# 29. MUTATION RECEIPT / FINALIZE INVARIANT

Repository hiện có generation-aware mutation receipt và finalize acknowledgement.

Không làm thay đổi logic này.

Không:

- clear outbox toàn cục
- ACK mutation không thuộc operation
- ACK generation mới hơn
- mutate historical aggregate
- bypass canonical response

Feature Xuất bản Word không được can thiệp vào các semantics này.

---

# 30. BACKEND

Chỉ sửa backend nếu thực sự cần.

Ví dụ có thể cần backend change nếu:

- chưa có document type mới
- chưa có endpoint export generic tương ứng
- template resolver cần thêm mapping

Nếu phải sửa backend:

- reuse service hiện có
- không duplicate endpoint architecture
- validate workspace
- validate permission
- validate plan/package relation nếu endpoint nhận cả hai ID
- reject cross-workspace references
- reject invalid package/plan pair
- không làm thay đổi unrelated sync transaction

---

# 31. PLAN/PACKAGE VALIDATION Ở SERVER

Nếu export API nhận:

```text
planId
packageId
documentType
```

thì không chỉ tin frontend.

Nếu architecture hiện tại phù hợp, backend phải đảm bảo:

- package tồn tại
- plan tồn tại
- package thuộc đúng plan/version được phép
- cùng workspace
- user có quyền
- documentType áp dụng cho package nếu validation thuộc backend

Không tạo security rule duplicate sai semantics của hệ thống hiện tại.

Hãy follow established backend pattern.

---

# 32. RESPONSIVE

Sidebar phải hoạt động đúng:

- desktop
- collapsed state
- mobile
- drawer nếu có

Màn hình Xuất bản Word:

- desktop dễ đọc
- tablet không overflow
- mobile usable
- searchable dropdown không bị cắt popup
- document card/list responsive

Không phá scroll behavior.

---

# 33. ACCESSIBILITY

Theo capability hiện tại của app:

- label đúng cho dropdown
- keyboard selection
- focus state
- button disabled state
- loading state
- accessible active/navigation semantics

Không downgrade accessibility của reusable select hiện tại.

---

# 34. TEST — SIDEBAR

Thêm/update test để xác minh:

### Test 1

Không còn heading:

```text
HỆ THỐNG MẪU
```

mà có:

```text
HỆ THỐNG VĂN BẢN
```

### Test 2

Section có:

```text
Biểu mẫu Word
Xuất bản Word
```

### Test 3

`Biểu mẫu Word` vẫn điều hướng đúng route/page cũ.

### Test 4

`Xuất bản Word` điều hướng sang page mới.

### Test 5

Active state đúng.

---

# 35. TEST — DEPENDENT DROPDOWN

Cover tối thiểu:

### Initial

```text
plan = null
package = null
```

Expected:

- plan select enabled
- package select disabled
- no reports

### Select Plan A

Expected:

- package select enabled
- chỉ package thuộc Plan A

### Search Plan

Search text phải lọc/query đúng.

### Search Package

Search package phải hoạt động đúng.

### Change Plan A → B

Expected:

```text
selectedPackage = null
availableDocuments = empty
```

Không còn package A.

---

# 36. TEST — 1G1T

Fixture dùng canonical code thực tế của repo.

Khi selected package là 1G1T:

Expected có:

```text
Báo cáo đánh giá
```

Expected không có ba:

```text
Báo cáo đánh giá E-HSĐXKT
```

---

# 37. TEST — 1G2T

Khi package là 1G2T:

Expected:

- có 3 E-HSĐXKT
- ba item có stable IDs khác nhau
- không bị deduplicate
- không có document 1G1T nếu rule loại trừ

---

# 38. TEST — HÌNH THỨC LCNT THÔNG THƯỜNG

Với package không phải:

- chỉ định thầu rút gọn
- lựa chọn đặc biệt

Expected có:

```text
Báo cáo thẩm định, KQLCNT
```

---

# 39. TEST — CHỈ ĐỊNH RÚT GỌN

Expected có:

```text
Kết quả lựa chọn nhà thầu
```

Expected không có:

```text
Báo cáo thẩm định, KQLCNT
```

---

# 40. TEST — LỰA CHỌN ĐẶC BIỆT

Expected có:

```text
Kết quả lựa chọn nhà thầu
```

Expected không có:

```text
Báo cáo thẩm định, KQLCNT
```

---

# 41. TEST — STALE STATE

Sequence:

```text
Plan A
→ Package A / 1G1T
→ chọn/hiển thị document 1G1T
→ đổi Plan B
```

Expected:

- Package A reset
- document 1G1T reset
- không export được stale Package A

Sequence:

```text
Package 1G1T
→ Package 1G2T
```

Expected:

- document availability tính lại hoàn toàn

---

# 42. TEST — EXPORT

Nếu pipeline export được wire trong scope hiện tại:

test tối thiểu:

- correct plan ID
- correct package ID
- correct document type
- loading
- successful result
- error result
- no double-trigger nếu current implementation hỗ trợ guard

Nếu backend được sửa:

thêm backend test cho:

- valid export
- invalid package-plan relation
- cross-workspace
- permission
- invalid/inapplicable document type
- existing document type regression

---

# 43. NO-REGRESSION

Không được phá:

- Kế hoạch LCNT
- Gói thầu
- Timeline gói thầu
- Hợp đồng
- Chủ đầu tư
- Nhà thầu
- Chuyên gia
- Nhân sự & Phân quyền
- Trạng thái Hợp đồng
- Biểu mẫu Word
- existing templates
- document generation
- version navigation
- offline state
- outbox
- sync
- permissions

---

# 44. KHÔNG OVER-ENGINEER

Không tạo:

- document microservice mới
- second template system
- second searchable select
- second permission model
- second plan/package repository
- duplicate business enum

nếu project đã có capability tương ứng.

Ưu tiên:

**extend existing capability**

thay vì:

**build parallel capability**.

---

# 45. CODE QUALITY

Implementation phải:

- data-driven
- reusable
- có stable IDs
- business rules tập trung
- không magic string rải rác
- không dùng display label làm domain identity
- không dùng text matching để phân loại package
- dễ thêm loại Word mới về sau

Không refactor unrelated code lớn ngoài phạm vi.

---

# 46. EXPECTED IMPLEMENTATION SHAPE

Không bắt buộc đúng tên file, nhưng kiến trúc cuối nên có concern tương đương:

```text
Navigation config
       │
       └── Hệ thống văn bản
            ├── Biểu mẫu Word
            └── Xuất bản Word


WordPublicationPage
       │
       ├── Plan searchable selector
       │
       ├── Package searchable selector
       │
       ├── Package summary
       │
       └── Document list


Document publication config/policy
       │
       ├── base documents
       ├── 1G1T rules
       ├── 1G2T rules
       └── procurement-method rules


Existing Word pipeline
       │
       └── generation/export/download
```

Nếu repo hiện tại có architecture tốt hơn thì follow architecture đó.

---

# 47. IMPLEMENTATION ORDER

Thực hiện theo đúng trình tự:

## Phase 1 — Audit

- Git status / HEAD
- architecture rules
- navigation
- existing Word feature
- searchable select
- plan/package data
- canonical classification fields
- document pipeline
- tests

## Phase 2 — Plan

Trước khi sửa, ghi ngắn gọn:

- files/modules dự kiến sửa
- fields/enums authoritative tìm được
- reusable components sẽ dùng
- Word pipeline sẽ reuse thế nào
- backend có cần đổi hay không

Sau đó mới code.

## Phase 3 — Implement

- rename sidebar section
- add menu
- route/page
- dependent searchable selects
- document availability policy
- UI
- export integration

## Phase 4 — Tests

Thêm/update test.

## Phase 5 — Validation

Chạy targeted tests trước.

Sau đó chạy các quality gates phù hợp với repository.

Không tuyên bố pass nếu test chưa chạy.

---

# 48. ACCEPTANCE CRITERIA

Chỉ coi task hoàn thành khi **tất cả** điều kiện sau đạt:

- [ ] `Hệ thống mẫu` đã đổi thành `Hệ thống văn bản`.
- [ ] Section có `Biểu mẫu Word`.
- [ ] Section có `Xuất bản Word`.
- [ ] `Biểu mẫu Word` giữ nguyên behavior hiện tại.
- [ ] Có page/route `Xuất bản Word`.
- [ ] Có searchable dropdown Kế hoạch.
- [ ] Searchable dropdown reuse component/pattern hiện hữu.
- [ ] Chưa chọn Kế hoạch thì Gói thầu disabled.
- [ ] Chọn Kế hoạch thì chỉ load/display Gói thuộc Kế hoạch.
- [ ] Dropdown Gói thầu searchable.
- [ ] Đổi Kế hoạch reset Gói cũ.
- [ ] Không tồn tại stale package/document state.
- [ ] Sau khi chọn Gói, system tự đọc classification.
- [ ] User không phải tự chọn 1G1T/1G2T.
- [ ] 1G1T hiển thị `Báo cáo đánh giá`.
- [ ] 1G2T hiển thị đúng 3 E-HSĐXKT.
- [ ] 3 E-HSĐXKT là 3 stable document identities.
- [ ] Gói thường hiển thị `Báo cáo thẩm định, KQLCNT`.
- [ ] Chỉ định thầu rút gọn hiển thị `Kết quả lựa chọn nhà thầu`.
- [ ] Lựa chọn đặc biệt hiển thị `Kết quả lựa chọn nhà thầu`.
- [ ] Các business rule dùng canonical code/enum.
- [ ] Không dùng display text để phân loại.
- [ ] Document types được config/policy tập trung.
- [ ] Reuse Word/document infrastructure hiện tại.
- [ ] Không tạo subsystem Word song song.
- [ ] Không làm thay đổi outbox/versioning semantics.
- [ ] Có regression tests.
- [ ] Targeted tests pass.
- [ ] Relevant project quality gates pass hoặc ghi rõ lỗi pre-existing.

---

# 49. FINAL REPORT BẮT BUỘC

Sau khi hoàn thành, trả lại report theo format:

## A. HEAD

```text
Branch:
Commit before changes:
Working tree state before changes:
```

## B. Audit findings

Nêu chính xác:

- navigation implementation
- searchable dropdown reused
- Plan source
- Package source
- relationship field
- canonical 1G1T/1G2T field/code
- canonical procurement method field/code
- Word pipeline hiện tại

## C. Implementation

Mô tả:

- sidebar change
- new route/page
- dependent dropdown behavior
- document policy
- Word export integration

## D. Files changed

Liệt kê từng file và mục đích.

## E. Business rule mapping

Lập bảng:

```text
Condition                         Documents
-------------------------------------------------------------
Base                              ...
1G1T                              ...
1G2T                              ...
Normal procurement method         ...
Chỉ định thầu rút gọn             ...
Lựa chọn đặc biệt                 ...
```

## F. Tests

Liệt kê:

- test added
- test modified
- commands executed
- result

## G. Assumptions / unresolved items

Đặc biệt ghi rõ:

Ba mục:

```text
Báo cáo đánh giá E-HSĐXKT
Báo cáo đánh giá E-HSĐXKT
Báo cáo đánh giá E-HSĐXKT
```

hiện chưa có tên nghiệp vụ phân biệt trong yêu cầu.

Chúng phải được giữ thành 3 document IDs riêng để đổi tên/mapping template về sau.

## H. No-regression statement

Xác nhận cụ thể:

- Biểu mẫu Word không bị thay đổi behavior ngoài yêu cầu.
- Không thay đổi permission semantics ngoài phạm vi.
- Không thay đổi versioning/outbox/sync semantics ngoài phạm vi.
- Không tạo parallel document/template system.

---

# 50. QUY TẮC CUỐI CÙNG

**Không dừng ở việc phân tích hoặc đưa proposal.**

Sau khi audit, hãy **thực hiện code hoàn chỉnh**, thêm test, chạy validation và báo cáo kết quả.

Nếu phát hiện implementation hiện tại khác giả định của prompt:

1. ưu tiên source code/`AGENTS.md` hiện tại làm source of truth;
2. giữ nguyên mục tiêu sản phẩm;
3. điều chỉnh implementation để phù hợp kiến trúc thật;
4. không tự thay đổi business requirement;
5. ghi lại quyết định trong final report.

Không hỏi lại những thứ có thể tự xác định bằng cách đọc repository.

Chỉ dừng và báo blocker nếu có vấn đề thực sự không thể suy ra từ source code hoặc thiếu asset/template nghiệp vụ bắt buộc để hoàn thành một phần cụ thể.