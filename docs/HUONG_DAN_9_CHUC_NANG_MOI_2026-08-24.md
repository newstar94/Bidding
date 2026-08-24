# Tóm tắt 9 chức năng mới và cách sử dụng

Ngày cập nhật: 2026-08-24  
Phạm vi: các mục 6, 7, 8, 12, 15, 19, 20, 21 và 30

## 1. Tổng quan nhanh

| Chức năng | Dùng để làm gì | Điểm vào chính |
|---|---|---|
| So sánh phiên bản | So sánh hai phiên bản Kế hoạch/Gói thầu và xem phạm vi bị ảnh hưởng | Nút **So sánh phiên bản** trong màn hình chi tiết |
| Trung tâm xử lý xung đột | Xem và giải quyết thay đổi cục bộ bị xung đột với dữ liệu máy chủ | Mở tự động khi đồng bộ có xung đột hoặc từ thông báo xử lý xung đột |
| Danh mục và ràng buộc pháp lý | Quản lý phiên bản văn bản, hồ sơ nguồn và gắn đúng căn cứ cho Kế hoạch/Gói thầu | Khu vực quản trị pháp lý; nút **Pháp lý** trên bản ghi |
| Trợ lý kiểm tra tuân thủ | Giải thích finding deterministic theo đúng bản ghi, phiên bản và nguồn pháp lý đã gắn | Trợ lý AI ở chế độ tư vấn mua sắm |
| Vòng đời biểu mẫu Word | Quản lý draft, preflight, publish, retire, restore và lịch sử sử dụng biểu mẫu | Màn hình **Biểu mẫu Word** |
| Lịch công việc | Xem trước/tải `.ics` hoặc chủ động gửi mốc sang Google/Microsoft | **Trung tâm hồ sơ → Lịch** |
| Hồ sơ làm rõ | Quản lý yêu cầu làm rõ, phản hồi, duyệt, phát hành, tệp và lịch sử | **Trung tâm hồ sơ → Hồ sơ** |
| Hồ sơ kiến nghị | Quản lý kiến nghị theo taxonomy, trạng thái, căn cứ pháp lý và phản hồi | **Trung tâm hồ sơ → Hồ sơ** |
| Xuất dữ liệu hàng loạt | Tạo ZIP chứa JSON của tối đa 100 Kế hoạch hoặc Gói thầu được phép đọc | **Trung tâm hồ sơ → Xuất hàng loạt** |

## 2. Nguyên tắc quyền và dữ liệu

- Các chức năng mới không tạo thêm role, module permission, record scope, assignment scope, capability hoặc entitlement.
- Người dùng chỉ thao tác trên bản ghi mà họ vốn đã có quyền truy cập theo tenant, phân hệ, phân công và record scope.
- Khi đã được phép đọc bản ghi, người dùng tiếp tục xem đầy đủ dữ liệu của bản ghi đó, gồm thông tin định danh, tài chính, tài khoản ngân hàng, chữ ký và con dấu nếu bản ghi có các trường này.
- Quyền xuất Word chỉ kiểm soát hành động tạo/tải Word; không kiểm soát việc đọc dữ liệu trên màn hình hoặc API.
- Phân công trách nhiệm trong hồ sơ và thông tin bên ngoài không tự cấp quyền truy cập.
- Các thao tác quan trọng đều được kiểm tra quyền lại ở máy chủ và ghi audit.

## 3. So sánh phiên bản — mục 6

### Chức năng

So sánh hai snapshot thuộc cùng dòng phiên bản, gồm:

- trường dữ liệu thay đổi;
- quan hệ được thêm, sửa hoặc loại bỏ;
- giá trị mơ hồ cần người dùng xem lại;
- ảnh hưởng đã xác nhận tới timeline, phân công, tài liệu Word đã sinh và căn cứ pháp lý;
- nhóm chưa có nguồn authoritative được ghi rõ là `NOT_EVALUATED`, không bị hiểu nhầm thành “không ảnh hưởng”.

### Cách dùng

1. Mở chi tiết một Kế hoạch hoặc Gói thầu có nhiều phiên bản.
2. Chọn **So sánh phiên bản**.
3. Chọn phiên bản bên trái và phiên bản bên phải.
4. Bấm **So sánh**.
5. Dùng các phần/tab kết quả để xem thay đổi trường, quan hệ và tác động.
6. Nếu kết quả dài, dùng bộ lọc và phân trang; không cần tải toàn bộ dữ liệu một lần.

### Cách đọc kết quả tác động

- `CONFIRMED`: có nguồn authoritative chứng minh ảnh hưởng.
- `POTENTIAL`: có khả năng ảnh hưởng nhưng cần kiểm tra thêm.
- `NOT_EVALUATED`: hệ thống chưa có đủ provenance hoặc provider authoritative để kết luận.

So sánh là chỉ đọc; thao tác này không sửa hai phiên bản.

## 4. Trung tâm xử lý xung đột — mục 7

### Chức năng

Khi người dùng chỉnh sửa trên dữ liệu cũ trong lúc máy chủ đã có phiên bản mới, hệ thống giữ bản nháp xung đột bền vững để người dùng quyết định thay vì tự ghi đè hoặc tự phát lại.

### Cách dùng

1. Khi đồng bộ báo xung đột, chọn mở **Trung tâm xử lý xung đột**.
2. Chọn một bản nháp xung đột trong danh sách.
3. Xem ba nguồn dữ liệu:
   - dữ liệu nền khi bắt đầu sửa;
   - thay đổi cục bộ của bạn;
   - dữ liệu mới nhất từ máy chủ.
4. Chọn quyết định cho từng trường được hỗ trợ.
5. Xác nhận xử lý.

Hệ thống sẽ kiểm tra lại quyền và `rowVersion` mới nhất trước khi ghi. Nếu trong lúc xử lý lại có người khác sửa tiếp, một xung đột mới có thể được tạo.

### Lưu ý

- Tải lại trang không tự áp lại mutation xung đột.
- Thay đổi khác không thuộc batch xung đột vẫn được bảo toàn.
- Có thể chọn bỏ vĩnh viễn bản nháp nếu không còn cần.
- Không dùng tính năng này như “force overwrite”.

## 5. Danh mục và ràng buộc pháp lý — mục 8

### Chức năng

Quản lý pháp lý theo phiên bản bất biến:

- văn bản pháp lý logic và các phiên bản nội dung;
- hồ sơ nguồn gồm đúng các phiên bản văn bản được dùng;
- policy xác định khả năng áp dụng;
- binding gắn đúng Kế hoạch/Gói thầu với hồ sơ nguồn;
- hash và provenance để biết chính xác nguồn nào đã được dùng.

### Cách dùng cho Super Admin

1. Mở khu vực quản trị danh mục pháp lý.
2. Tạo draft văn bản và nhập thông tin định danh, khoảng hiệu lực, nguồn chính thức và nội dung.
3. Kiểm tra draft rồi publish. Phiên bản đã publish là bất biến.
4. Tạo hồ sơ nguồn từ danh sách exact instrument version.
5. Kiểm tra thứ tự, priority, khoảng hiệu lực và trạng thái cần review.
6. Publish hồ sơ nguồn/policy sau khi đối chiếu.

### Cách gắn pháp lý cho bản ghi

1. Mở đúng phiên bản Kế hoạch hoặc Gói thầu.
2. Chọn **Pháp lý**.
3. Chạy resolve theo thông tin của exact version đang mở.
4. Kiểm tra kết quả:
   - `RESOLVED`: tìm được đúng một nguồn phù hợp;
   - `UNRESOLVED`: thiếu dữ kiện hoặc không có nguồn phù hợp;
   - `AMBIGUOUS`: có nhiều nguồn cùng mức ưu tiên;
   - `MANUAL_REVIEW_REQUIRED`: cần người có thẩm quyền xem lại.
5. Chỉ xác nhận binding khi exact profile/source đã được review.

Không có fallback tự động về “văn bản mới nhất”, và hệ thống không tự gắn dữ liệu legacy bằng suy đoán.

## 6. Trợ lý kiểm tra tuân thủ — mục 12

### Chức năng

Trợ lý giải thích kết quả do bộ quy tắc deterministic tạo ra trên đúng:

- loại bản ghi;
- ID bản ghi;
- exact version;
- legal binding và source hash;
- timeline, tài liệu và provenance liên quan.

AI không tự tạo hoặc đổi trạng thái finding.

### Cách dùng

1. Mở Kế hoạch/Gói thầu và chọn đúng phiên bản cần kiểm tra.
2. Mở Trợ lý AI ở chế độ tư vấn mua sắm.
3. Kiểm tra chip ngữ cảnh hiển thị đúng target và version.
4. Yêu cầu trợ lý giải thích tình trạng tuân thủ hoặc dữ liệu còn thiếu.
5. Đọc từng finding cùng rule ID, trạng thái, evidence path và exact source.
6. Xem phần `notEvaluated` để biết giới hạn nào chưa thể kết luận.

### Ý nghĩa trạng thái

- `PASS`: quy tắc deterministic đã đạt theo dữ liệu hiện có.
- `FAIL`: thiếu hoặc sai điều kiện dữ liệu của quy trình; không mặc nhiên là kết luận vi phạm pháp luật.
- `NEEDS_REVIEW`: cần người dùng/người có chuyên môn kiểm tra.
- `NOT_EVALUATED`: chưa đủ binding, provenance hoặc authority.

Kết luận pháp lý vẫn là `NOT_EVALUATED` cho tới khi bộ citation fixture được legal reviewer phê duyệt.

## 7. Vòng đời biểu mẫu Word — mục 15

### Chức năng

Mỗi biểu mẫu có identity ổn định và vòng đời:

```text
DRAFT → PUBLISHED → RETIRED
```

Hỗ trợ preflight, publish bằng CAS, restore thành draft mới, assignment có thứ tự và provenance exact template version/checksum cho tài liệu đã sinh.

### Cách dùng cho người quản lý biểu mẫu

1. Mở **Biểu mẫu Word**.
2. Tạo hoặc tải lên một draft `.docx`.
3. Chạy preflight bằng dữ liệu mẫu đã duyệt hoặc bản ghi thật mà bạn có quyền đọc.
4. Sửa lỗi mapping/placeholder nếu preflight không đạt.
5. Publish draft khi kết quả đạt yêu cầu.
6. Gán logical template cho đúng loại tài liệu; kiểm tra thứ tự nếu một chức năng có nhiều biểu mẫu.
7. Khi không còn dùng, retire phiên bản.
8. Muốn khôi phục phiên bản cũ, chọn restore; hệ thống tạo draft mới để preflight/publish, không âm thầm đổi con trỏ.

### Cách dùng khi xuất Word

1. Mở bản ghi cần xuất.
2. Chọn chức năng xuất Word hiện có.
3. Hệ thống resolve biểu mẫu đã publish theo assignment.
4. Tài liệu sinh ra được pin exact `templateVersionId`, checksum biểu mẫu và checksum artifact.

Người dùng vẫn cần Word entitlement hiện hành để tạo/tải Word.

## 8. Lịch công việc — mục 19

### 8.1. Xem trước và tải `.ics`

1. Mở **Trung tâm hồ sơ** từ thanh bên.
2. Chọn tab **Lịch**.
3. Đánh dấu các Gói thầu/mốc muốn đưa vào lịch.
4. Chọn **Xem trước** để kiểm tra chính xác tiêu đề, mô tả, ngày và loại sự kiện sẽ đi ra ngoài hệ thống.
5. Chọn **Tải .ics**.
6. Mở file bằng ứng dụng lịch mong muốn.

File chỉ được tạo sau thao tác chủ động, tối đa 500 sự kiện hoặc 1 MiB. Một nguồn trong selection không còn quyền truy cập sẽ làm toàn bộ yêu cầu bị từ chối mà không lộ metadata của nguồn đó.

### 8.2. Kết nối Google Calendar hoặc Microsoft Outlook

1. Trong tab **Lịch**, tới phần kết nối lịch ngoài.
2. Chọn nhà cung cấp và lịch đích; mặc định có thể dùng `primary`.
3. Chọn **Kết nối và xem consent**.
4. Đăng nhập nhà cung cấp và chấp thuận scope hiển thị:
   - Google: `calendar.events`;
   - Microsoft: `Calendars.ReadWrite` và `offline_access`.
5. Quay lại BiddingFlow và kiểm tra connection ở trạng thái `ACTIVE`.
6. Chọn các mốc cần gửi rồi bấm **Gửi các mốc đã chọn**.
7. Theo dõi trạng thái delivery. Nếu một delivery ở `FAILED` và connection còn active, có thể chọn **Thử lại**.
8. Chọn **Ngắt kết nối** khi không muốn gửi thêm.

Đây là đồng bộ một chiều BiddingFlow → lịch ngoài. Sửa event ở Google/Microsoft không ghi ngược vào bản ghi nghiệp vụ. Ngắt kết nối dừng các lần gửi mới nhưng mặc định không xóa event đã tạo trên lịch ngoài.

## 9. Hồ sơ làm rõ — mục 20

### Chức năng

Quản lý một yêu cầu làm rõ xuyên suốt package lineage, gồm:

- số hồ sơ, chiều inbound/outbound, chủ đề và hạn xử lý;
- bên liên quan và đơn vị/người chịu trách nhiệm;
- nhiều phiên bản phản hồi bất biến;
- duyệt, phát hành, đóng, trả lại, rút và mở lại có lịch sử;
- căn cứ pháp lý exact, observation nguồn và tệp PDF/DOCX/XLSX;
- activity và audit.

### Cách dùng

1. Mở **Trung tâm hồ sơ → Hồ sơ**.
2. Chọn **Tạo hồ sơ**.
3. Chọn Gói thầu, loại **Làm rõ**, số hồ sơ, chủ đề và chiều xử lý.
4. Có thể đặt hạn xử lý, thêm bên liên quan, căn cứ pháp lý và tệp đính kèm.
5. Phân công trách nhiệm nếu cần; việc phân công không tự cấp quyền đọc.
6. Lưu phản hồi. Mỗi lần sửa tạo revision mới.
7. Dùng các hành động mà máy chủ trả về để chuyển trạng thái:

```text
DRAFT → UNDER_REVIEW → APPROVED → ISSUED → CLOSED
```

8. Nếu bị trả lại, cập nhật phản hồi rồi gửi duyệt lại.
9. Xem lịch sử transition và activity trong chi tiết hồ sơ.

Sửa phản hồi sau khi đã approve làm approval cũ trở nên stale và hồ sơ quay về trạng thái cần duyệt lại.

## 10. Hồ sơ kiến nghị — mục 21

### Chức năng

Dùng chung trung tâm hồ sơ với làm rõ nhưng có taxonomy và state machine riêng.

Taxonomy v1:

- `E_HSMT`: kiến nghị về E-HSMT;
- `CONTRACTOR_SELECTION_RESULT`: kiến nghị về kết quả lựa chọn nhà thầu;
- `OTHER`: nhóm khác, bắt buộc có mô tả.

### Cách dùng

1. Mở **Trung tâm hồ sơ → Hồ sơ** và chọn **Tạo hồ sơ**.
2. Chọn loại **Kiến nghị**.
3. Chọn Gói thầu, nhập số hồ sơ, chủ đề và nhóm kiến nghị.
4. Với `OTHER`, bổ sung mô tả cụ thể.
5. Thêm bên liên quan, trách nhiệm, tệp, hạn xử lý và exact legal basis nếu có.
6. Thực hiện quy trình:

```text
RECEIVED → ASSIGNED → UNDER_REVIEW → DRAFT_RESPONSE
→ APPROVED → ISSUED → CLOSED
```

7. Sử dụng `RETURNED`, `WITHDRAWN`, `REJECTED` hoặc reopen khi nghiệp vụ yêu cầu và hành động đang được máy chủ cho phép.

Thiếu legal binding hoặc policy SLA không chặn lưu draft; hệ thống hiển thị `NOT_EVALUATED` thay vì tự suy đoán kết luận.

## 11. Xuất dữ liệu hàng loạt — mục 30

### Chức năng

Pilot hiện chỉ hỗ trợ action `EXPORT_RECORD_DATA` cho:

- Kế hoạch lựa chọn nhà thầu;
- Gói thầu.

Mỗi lần tối đa 100 ID rõ ràng. Artifact ZIP chứa JSON UTF-8 của toàn bộ dữ liệu bản ghi mà người dùng được phép đọc.

### Cách dùng

1. Mở **Trung tâm hồ sơ → Xuất hàng loạt**.
2. Chọn loại bản ghi: Gói thầu hoặc Kế hoạch.
3. Nhập mỗi ID bản ghi trên một dòng, tối đa 100 ID.
4. Chọn **Chuẩn bị preview**.
5. Kiểm tra mã, tiêu đề và danh sách bản ghi trong preview.
6. Chọn **Xác nhận tạo ZIP** trong vòng 10 phút.
7. Khi operation hoàn tất, chọn **Tải ZIP** trong vòng 24 giờ.

Máy chủ kiểm tra lại quyền và `rowVersion` khi xác nhận và khi tải. Chỉ một bản ghi bị mất quyền hoặc stale cũng làm toàn operation thất bại; hệ thống không trả metadata của bản ghi bị từ chối.

## 12. Cấu hình dành cho quản trị/vận hành

Các chức năng mặc định có thể bị tắt bằng feature flag. Sau khi đổi cấu hình cần restart toàn bộ ASGI workers và thực hiện smoke test theo runbook.

| Chức năng | Cấu hình chính |
|---|---|
| So sánh phiên bản | `VERSION_COMPARISON_ENABLED=true` |
| Trung tâm xung đột | `CONFLICT_CENTER_ENABLED=true` cùng encryption/signing keys |
| Pháp lý | `LEGAL_VERSIONING_ENABLED=true` |
| AI compliance | `LEGAL_VERSIONING_ENABLED=true` và `AI_COMPLIANCE_ENABLED=true` |
| Biểu mẫu Word | `WORD_TEMPLATE_CATALOG_ENABLED=true`, mode `shadow` hoặc `cutover` |
| `.ics` | `WORK_CALENDAR_ICS_ENABLED=true` |
| Calendar connectors | Master flag và từng provider flag cùng OAuth credentials/key riêng |
| Hồ sơ làm rõ/kiến nghị | `PROCUREMENT_CASE_ENABLED=true` |
| Xuất hàng loạt | `BULK_EXPORT_ENABLED=true` và storage path tuyệt đối ở production |

Không bật thẳng production chỉ vì flag đã tồn tại. Thực hiện shadow/canary, backup, migration, readiness và rollback rehearsal theo các runbook dưới đây:

- `docs/runbooks/legal-versioning-shadow-review.md`
- `docs/runbooks/ai-compliance-bundle-v1.md`
- `docs/runbooks/word-template-catalog-cutover.md`
- `docs/runbooks/procurement-case-shadow-cutover.md`
- `docs/runbooks/work-calendar-ics.md`
- `docs/runbooks/bulk-export-record-data.md`

## 13. Xử lý sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Không thấy nút/chuyên mục mới | Kiểm tra feature flag, restart worker, quyền đọc phân hệ và bản ghi hiện tại |
| So sánh trả `NOT_EVALUATED` | Xem `reasonCode`; có thể provider/provenance authoritative chưa tồn tại, không phải lỗi so sánh |
| Legal binding là `UNRESOLVED` hoặc `AMBIGUOUS` | Kiểm tra anchor, khoảng hiệu lực, priority và hồ sơ nguồn; không chọn “latest” để bỏ qua lỗi |
| AI compliance không xuất hiện | Phải bật cả legal và compliance; target/version context phải đầy đủ |
| Không xuất được Word | Kiểm tra Word entitlement, assignment, published template và preflight |
| Calendar connection là `REAUTH_REQUIRED` | Kết nối lại nhà cung cấp; không sửa token trực tiếp trong database |
| Delivery lịch `FAILED` | Kiểm tra quyền source, connection/provider flag và error code; sau đó dùng **Thử lại** nếu phù hợp |
| Case không có hành động mong muốn | Hành động phụ thuộc loại hồ sơ, state hiện tại, exact response revision và quyền trên Gói thầu cha |
| Bulk preview hết hạn hoặc stale | Chuẩn bị preview mới; không tái sử dụng preview cũ |
| Xung đột tiếp tục xuất hiện sau xử lý | Có thể bản ghi đã thay đổi thêm; tải server state mới và xử lý bản nháp xung đột mới |

## 14. Tài liệu kỹ thuật liên quan

- Trạng thái nghiệm thu: `docs/research/2026-08-24-execution-status-9-tinh-nang.md`
- ADR xung đột: `docs/adr/0008-durable-conflict-resolution-contract.md`
- ADR pháp lý và compliance: `docs/adr/0009-legal-binding-and-deterministic-compliance.md`
- ADR biểu mẫu Word: `docs/adr/0010-immutable-word-template-lifecycle.md`
- ADR lịch công việc: `docs/adr/0011-work-calendar-outbound-contract.md`
- ADR hồ sơ làm rõ/kiến nghị: `docs/adr/0012-shared-procurement-case.md`
- ADR bulk export: `docs/adr/0013-bulk-export-record-data-pilot.md`

