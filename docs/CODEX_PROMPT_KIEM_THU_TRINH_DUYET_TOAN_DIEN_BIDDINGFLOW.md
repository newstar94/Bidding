# PROMPT CHO CODEX — KIỂM THỬ TRÌNH DUYỆT TOÀN DIỆN BIDDINGFLOW

## 0. Nhiệm vụ

Bạn đang làm việc trong repository:

```text
https://github.com/newstar94/Bidding
```

Hãy kiểm tra **code mới nhất của nhánh hiện tại** trước khi thực hiện. Không được dựa mù quáng vào tên file, số dòng, vai trò, trạng thái hoặc quy tắc được nêu trong prompt này nếu code hiện tại đã thay đổi.

Tại thời điểm lập prompt, commit gần nhất đã được quan sát là:

```text
e2196fb1e9e116fa11fa6de62843c361c3497cf2
```

Phải ghi lại SHA thực tế khi bắt đầu kiểm thử. Nếu SHA hiện tại khác, sử dụng code mới nhất và ghi rõ sự khác biệt trong báo cáo.

Mục tiêu là **kiểm thử toàn diện ứng dụng BiddingFlow bằng trình duyệt như một người dùng thật**, ưu tiên:

1. Codex browser tool, Playwright MCP hoặc plugin điều khiển trình duyệt nếu môi trường có hỗ trợ.
2. Playwright Test đã có trong repository nếu không có plugin.
3. DevTools/browser automation tương đương chỉ khi hai lựa chọn trên không dùng được.

Không được chỉ đọc code rồi kết luận. Không được thay thế thao tác giao diện bằng việc gọi API trực tiếp. Phải thực sự mở trang, đăng nhập, bấm nút, chọn menu, nhập dữ liệu, tải file, tải xuống, chuyển tab, chuyển tổ chức, xác nhận modal và quan sát kết quả như người dùng thật.

---

# 1. Kết quả bắt buộc

Sau nhiệm vụ, repository phải có tối thiểu:

```text
docs/e2e/BROWSER_TEST_PLAN.md
docs/e2e/FEATURE_INVENTORY.md
docs/e2e/ROLE_PERMISSION_MATRIX.md
docs/e2e/BUSINESS_COMBINATION_MATRIX.md
docs/e2e/TEST_DATA_MATRIX.md
docs/e2e/TEST_EXECUTION_REPORT.md
docs/e2e/BUG_REPORT.md
docs/e2e/UNCOVERED_OR_BLOCKED_CASES.md
```

Đồng thời bổ sung hoặc hoàn thiện bộ test trình duyệt tự động trong cấu trúc phù hợp với repository, ví dụ:

```text
scripts/e2e/
tests/e2e/
playwright/
```

Không bắt buộc dùng đúng các thư mục ví dụ nếu repository đang có convention khác.

Phải tạo được:

- Báo cáo HTML của Playwright.
- JUnit XML hoặc JSON machine-readable.
- Screenshot theo kịch bản.
- Video và trace cho kịch bản lỗi.
- Console log và page error.
- Network failure log.
- Danh sách bug có bước tái hiện.
- Bảng coverage theo tính năng, vai trò, tổ chức, thao tác và tổ hợp nghiệp vụ.

---

# 2. Quy tắc kiểm thử qua giao diện

## 2.1 Thao tác phải giống người dùng thật

Đối với hành vi cần kiểm thử, phải thực hiện qua UI:

- Mở route bằng trình duyệt.
- Đăng nhập qua form.
- Chọn không gian làm việc.
- Bấm nút thêm, sửa, xóa.
- Điền form.
- Chọn select, radio, checkbox.
- Dùng modal xác nhận.
- Tải file qua input.
- Nhấn nút tải xuống.
- Chuyển tab nghiệp vụ.
- Thao tác bảng, tìm kiếm, lọc và phân trang.
- Chờ thông báo thành công hoặc lỗi.
- Reload trang và xác minh dữ liệu còn tồn tại.
- Mở tab trình duyệt thứ hai khi kiểm tra đồng bộ.
- Ngắt mạng bằng browser context khi kiểm tra offline.

Không được dùng API trực tiếp để giả lập thao tác người dùng đang được kiểm thử.

## 2.2 Trường hợp được phép dùng API hoặc database

Chỉ được dùng API/database cho:

- Tạo fixture nền nếu giao diện không có chức năng tương ứng.
- Reset môi trường kiểm thử.
- Tạo nhiều tài khoản có vai trò khác nhau.
- Đưa hệ thống vào trạng thái đặc biệt rất khó tạo bằng UI.
- Xác minh hậu điều kiện sau khi đã thao tác qua UI.
- Kiểm tra backend thực sự trả 401/403 khi người dùng cố truy cập trái phép.
- Tạo lượng dữ liệu lớn phục vụ performance.

Mọi API/database shortcut phải được ghi trong báo cáo và không được thay thế thao tác chính đang kiểm thử.

## 2.3 Chạy headed và headless

Phải có:

- Ít nhất một vòng chạy **headed** để Codex/browser plugin quan sát giao diện trực tiếp.
- Toàn bộ regression suite chạy headless.
- Các luồng quan trọng chạy lại headed khi có lỗi khó xác định.
- Screenshot trước và sau mỗi mốc nghiệp vụ quan trọng.

Không cần mô phỏng hành vi né bot, fingerprint hoặc stealth. “Như người thật” ở đây có nghĩa là tương tác qua UI theo luồng sử dụng bình thường, không phải né cơ chế phát hiện tự động.

## 2.4 Không dùng chờ thời gian tùy tiện

Không dùng `sleep`/`waitForTimeout` cố định trừ khi có lý do được ghi rõ.

Ưu tiên:

- locator theo accessible name;
- `getByRole`;
- `getByLabel`;
- `getByText` khi ổn định;
- trạng thái network;
- trạng thái DOM;
- toast/modal cụ thể;
- response hoặc WebSocket event cụ thể.

Không dùng selector phụ thuộc thứ tự DOM hoặc class CSS dễ thay đổi nếu có selector ổn định hơn.

---

# 3. Môi trường kiểm thử an toàn

## 3.1 Tuyệt đối không kiểm thử trên production

Trước khi chạy:

1. Xác nhận URL không phải production.
2. Xác nhận database là database E2E riêng.
3. Xác nhận email/SMS không gửi đến người thật.
4. Xác nhận document worker và storage dùng vùng test.
5. Xác nhận không có secret production trong log hoặc artifact.

Nếu không xác minh được, dừng phần thao tác phá hủy và ghi blocker.

## 3.2 Dữ liệu cô lập theo lần chạy

Tạo `RUN_ID` duy nhất, ví dụ:

```text
e2e-20260804-231600-<random>
```

Mọi dữ liệu tạo mới phải có tiền tố hoặc hậu tố chứa `RUN_ID`:

- tổ chức;
- tài khoản;
- chủ đầu tư;
- nhà thầu;
- chuyên gia;
- kế hoạch;
- gói thầu;
- hợp đồng;
- tên file;
- mã nội bộ.

Không phụ thuộc dữ liệu cũ.

## 3.3 Test fixture phải portable

Không sử dụng đường dẫn cục bộ như:

```text
C:\Users\...
/Users/<name>/...
```

Mọi file Excel, Word, PDF, ảnh và fixture phải nằm trong repository hoặc được tạo trong thư mục tạm của test.

Các fixture bắt buộc nên có:

- Excel hàng hóa hợp lệ.
- Excel hàng hóa nhiều lô.
- Excel thuốc nhiều mặt hàng.
- Excel sai header.
- Excel quá lớn hoặc gần ngưỡng.
- DOCX hợp lệ.
- File giả mạo extension.
- File có nội dung nguy hiểm phục vụ kiểm tra an toàn.
- Ảnh con dấu hợp lệ và không hợp lệ.

## 3.4 Dọn dữ liệu

- Kiểm tra thao tác xóa qua UI trong các test riêng.
- Cleanup nền sau suite chỉ được dùng cho dữ liệu còn sót.
- Cleanup không được che bug xóa thất bại.
- Lưu evidence trước khi cleanup.
- Không xóa dữ liệu không chứa `RUN_ID`.

---

# 4. Kiểm kê tính năng từ code trước khi chạy

Không bắt đầu bằng một danh sách test cứng.

Trước tiên, hãy tự động hoặc bán tự động rà soát:

- route backend;
- route frontend;
- menu và submenu;
- tab chi tiết;
- modal;
- form;
- button;
- quyền;
- entitlement;
- trạng thái;
- transition;
- enum;
- rule engine;
- data validation;
- các script E2E hiện có;
- các fixture hiện có;
- các lệnh trong `package.json`;
- test trong `tests/`;
- các view HTML;
- controller/view/model liên quan.

Tạo `FEATURE_INVENTORY.md` với bảng:

| ID | Module | Route/màn hình | Tính năng | Thao tác | Vai trò | Quyền | Trạng thái áp dụng | Test hiện có | Test cần bổ sung |
|---|---|---|---|---|---|---|---|---|---|

Phải đối chiếu danh sách với:

- sidebar/menu;
- router;
- backend route registration;
- RBAC policy;
- entitlement;
- các trạng thái lifecycle.

Một tính năng chỉ được đánh dấu “đã kiểm thử” khi có test đã chạy và có kết quả, không phải vì đã có file test.

---

# 5. Ma trận người dùng, vai trò và quyền

## 5.1 Khám phá vai trò thực tế

Đọc code để xác định chính xác:

- vai trò cấp nền tảng;
- vai trò trong tổ chức;
- quyền chi tiết;
- entitlement theo gói dịch vụ;
- personal workspace nếu còn tồn tại;
- trạng thái thành viên;
- trạng thái tổ chức;
- trạng thái tài khoản.

Không tự tạo vai trò không tồn tại. Nếu code hiện có các vai trò tương đương `super_admin`, `manager`, `employee`, phải bao phủ toàn bộ.

## 5.2 Tài khoản kiểm thử tối thiểu

Tạo các persona tương ứng với code thực tế:

1. Chưa đăng nhập.
2. Tài khoản chưa xác minh.
3. Tài khoản bị khóa/vô hiệu hóa nếu hệ thống hỗ trợ.
4. Super admin.
5. Quản lý tổ chức.
6. Nhân viên có toàn quyền nghiệp vụ.
7. Nhân viên chỉ xem.
8. Nhân viên chỉ được tạo.
9. Nhân viên được sửa nhưng không được xóa.
10. Nhân viên được xóa nhưng không được quản trị thành viên.
11. Thành viên đã rời tổ chức.
12. Thành viên bị thu hồi quyền khi đang đăng nhập.
13. Người thuộc tổ chức bị tạm ngưng.
14. Người thiếu entitlement xuất tài liệu.
15. Một người thuộc nhiều tổ chức với vai trò khác nhau.
16. Một người vừa có vai trò nền tảng vừa có vai trò tổ chức, nếu model hỗ trợ.
17. Người có nhiều phiên đăng nhập/tab đồng thời.

Nếu permission model chi tiết hơn, sinh persona cho từng permission độc lập và các tổ hợp rủi ro cao.

## 5.3 Ma trận quyền

Tạo `ROLE_PERMISSION_MATRIX.md`:

| Persona | Workspace | Module | Xem | Tạo | Sửa | Xóa | Giao việc | Xuất file | Quản trị | Kết quả |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|

Mỗi ô phải được kiểm tra cả hai lớp:

1. UI ẩn/disable đúng.
2. Backend từ chối đúng khi người dùng cố:
   - mở deep link;
   - sửa request;
   - dùng ID của tổ chức khác;
   - giữ tab cũ sau khi bị thu hồi quyền.

Không được chỉ kiểm tra menu có ẩn hay không.

---

# 6. Không gian làm việc và nhiều tổ chức

Phải kiểm tra tối thiểu:

## 6.1 Một người — một tổ chức

- Đăng nhập.
- Tổ chức mặc định đúng.
- Dữ liệu đúng tổ chức.
- Reload vẫn giữ workspace.
- Logout/login lại.
- Deep link tới dữ liệu hợp lệ.

## 6.2 Một người — nhiều tổ chức

Tạo ít nhất ba tổ chức:

```text
ORG-A: người dùng là manager
ORG-B: người dùng là employee chỉ xem
ORG-C: người dùng là employee có quyền nghiệp vụ chọn lọc
```

Kiểm tra:

- Danh sách workspace.
- Chuyển A → B → C → A.
- Menu thay đổi theo vai trò từng tổ chức.
- Dữ liệu không lẫn nhau.
- IndexedDB/local state được đổi scope đúng.
- Search/filter không giữ kết quả của tổ chức cũ.
- Modal đang mở khi chuyển workspace.
- Deep link của ORG-A khi đang ở ORG-B.
- Back/forward browser sau khi chuyển tổ chức.
- Reload ngay sau chuyển.
- Mở hai tab, mỗi tab một tổ chức.
- Đồng bộ WebSocket ở đúng tổ chức.
- Notification/activity không rò sang tổ chức khác.
- File upload/download gắn đúng tổ chức.
- Tab cũ bị từ chối sau khi membership bị thu hồi.
- Mutation offline ở ORG-A không được gửi vào ORG-B.
- Chuyển tổ chức khi outbox còn mutation.
- Người cùng lúc được nâng/hạ vai trò tại một tổ chức.

## 6.3 Personal workspace

Nếu code còn hỗ trợ personal workspace:

- Tạo dữ liệu cá nhân.
- Chuyển personal ↔ organization.
- Kiểm tra ownership.
- Kiểm tra entitlement.
- Kiểm tra dữ liệu không lẫn.
- Kiểm tra chuyển dữ liệu nếu có tính năng chính thức.

Nếu không còn hỗ trợ, ghi rõ bằng chứng từ code.

---

# 7. Giao việc và nhiều vai trò

Phải kiểm tra:

- Giao một nhân viên.
- Giao nhiều nhân viên.
- Thêm người được giao.
- Gỡ người được giao.
- Đổi người phụ trách chính nếu có.
- Người được giao xem được dữ liệu.
- Người không được giao bị giới hạn đúng theo policy.
- Manager vẫn có quyền đúng.
- Nhân viên rời tổ chức.
- Nhân viên bị thu hồi permission trong khi đang mở màn hình.
- Giao cho người thuộc tổ chức khác phải bị chặn.
- Giao trùng cùng một người.
- Giao danh sách rỗng.
- Giao việc trên kế hoạch, gói thầu, hợp đồng hoặc entity thực tế có hỗ trợ.
- Activity/audit ghi đúng người giao và người được giao.
- Notification được gửi đúng đối tượng.
- Đồng bộ thay đổi assignment giữa hai tab/người dùng.
- Offline assignment và reconnect nếu UI cho phép.
- Xóa entity đã được giao.
- Xóa/rời thành viên đang được giao nhiều việc.
- Quyền sửa nội dung khác với quyền giao việc nếu policy tách riêng.

---

# 8. CRUD toàn bộ module

Đối với **mọi entity có giao diện thêm/sửa/xóa**, kiểm tra:

```text
Create → read/list → detail → update → reload → search/filter → delete → reload
```

Mỗi module phải có:

- Dữ liệu tối thiểu hợp lệ.
- Dữ liệu đầy đủ.
- Thiếu từng trường bắt buộc.
- Giá trị min/max.
- Unicode tiếng Việt.
- Khoảng trắng.
- Ký tự đặc biệt.
- Chuỗi rất dài.
- Giá trị trùng.
- ID/code có số 0 đầu.
- XSS text như `<script>`.
- Concurrent update.
- Permission denial.
- Cross-organization denial.
- Undo/confirm nếu có.
- Audit/activity.
- Persistence sau reload.
- Đồng bộ tab thứ hai.
- Offline/reconnect khi áp dụng.

Các module tối thiểu:

- Tổ chức.
- Thành viên/người dùng.
- Chủ đầu tư.
- Nhà thầu.
- Chuyên gia.
- Kế hoạch.
- Công việc thuộc kế hoạch.
- Gói thầu.
- Phần/lô.
- Hàng hóa/thuốc.
- Nhà thầu dự thầu.
- Liên danh.
- Mở thầu.
- Đánh giá.
- Kết quả lựa chọn nhà thầu.
- Hợp đồng.
- Tài liệu.
- Template/mapping tài liệu nếu có UI.
- Profile.
- Notification/activity.
- Admin/subscription/entitlement nếu có UI.

Nếu module không hỗ trợ một thao tác, ghi rõ rule và kiểm tra UI/API chặn thao tác đó.

---

# 9. Ma trận kế hoạch lựa chọn nhà thầu

## 9.1 Khám phá model thực tế

Đọc form và policy để xác định chính xác:

- loại kế hoạch;
- loại quyết định/phê duyệt;
- dự án;
- dự toán mua sắm;
- kế hoạch dự toán chung/riêng hoặc khái niệm tương đương;
- nguồn vốn;
- thời gian;
- các bảng phân rã;
- versioning;
- liên kết gói thầu.

Theo code được quan sát trước đây, UI có các lựa chọn tương tự:

```text
Loại:
- Dự án
- Dự toán mua sắm

Loại phê duyệt:
- Kế hoạch
- Dự toán và kế hoạch
```

Phải xác minh lại trên code mới nhất. Cụm “kế hoạch dự toán chung, riêng” của chủ sản phẩm phải được ánh xạ sang model thật, không tự suy luận.

## 9.2 Tổ hợp bắt buộc

Sinh và kiểm thử **toàn bộ tổ hợp hợp lệ** giữa các chiều hiện có, ví dụ:

- Dự án × Kế hoạch.
- Dự án × Dự toán và kế hoạch.
- Dự toán mua sắm × Kế hoạch.
- Dự toán mua sắm × Dự toán và kế hoạch.
- Chung/riêng nếu là chiều độc lập trong code.
- Có/không thông tin quyết định.
- Một/nhiều nguồn vốn.
- Thời gian một năm/nhiều năm.
- Có/không gói thầu.
- Một/nhiều phiên bản.

Nếu một tổ hợp không hợp lệ theo rule, phải kiểm tra hệ thống chặn và thông báo đúng.

## 9.3 Các bảng công việc

Kiểm tra toàn bộ khu vực thực tế, bao gồm các nhóm tương đương:

1. Công việc đã thực hiện.
2. Công việc không áp dụng lựa chọn nhà thầu.
3. Công việc chưa đủ điều kiện lựa chọn nhà thầu.
4. Các gói thầu.

Với từng nhóm:

- Thêm.
- Sửa.
- Xóa.
- Chuyển nhóm nếu có.
- Số tiền.
- Tổng tiền.
- Trùng mã.
- Dòng rỗng.
- Nhiều dòng.
- Giá trị âm.
- Số rất lớn.
- Decimal.
- Thứ tự hiển thị.
- Reload.
- Versioning.
- Permission.

## 9.4 Ràng buộc kế hoạch

Kiểm tra:

- Tổng mức đầu tư/dự toán và tổng các công việc.
- Tổng giá gói thầu.
- Nguồn vốn.
- Thời gian tổ chức lựa chọn nhà thầu.
- Thời gian bắt đầu.
- Quyết định phê duyệt.
- Mã dự án.
- Trùng mã kế hoạch.
- Kế hoạch đã có gói thầu.
- Sửa/xóa sau khi gói đã phát hành.
- Xóa phiên bản hiện tại.
- Xóa toàn bộ phiên bản.
- Tạo phiên bản mới.
- Dữ liệu nào được sao chép và dữ liệu nào phải reset.
- Export/Word nếu có.
- Audit/timeline.

---

# 10. Ma trận gói thầu — bắt buộc toàn bộ tổ hợp hợp lệ

## 10.1 Không chỉ kiểm tra pairwise

Repository đã có test pairwise đại diện. Nhiệm vụ này phải tiến xa hơn:

1. Đọc rule engine/form policy hiện tại.
2. Liệt kê toàn bộ domain hữu hạn.
3. Sinh ra **tất cả tuple hợp lệ**.
4. Sinh các tuple không hợp lệ tại biên để xác minh bị chặn.
5. Chia shard để chạy nếu số lượng lớn.
6. Báo cáo:
   - tổng số tuple hợp lệ;
   - số đã chạy;
   - số pass/fail/blocked;
   - tuple chưa chạy và lý do.

Pairwise có thể dùng bổ sung, không được dùng thay cho yêu cầu toàn bộ tổ hợp hợp lệ.

Đối với trường text/số/ngày có vô hạn giá trị, dùng equivalence partition và boundary value analysis thay vì tuyên bố kiểm tra mọi giá trị.

## 10.2 Các chiều phải đưa vào generator

Xác minh tên và giá trị thực tế từ code. Các chiều tối thiểu dự kiến:

### Lĩnh vực

- Hàng hóa.
- Xây lắp.
- Tư vấn.
- Phi tư vấn.
- Hỗn hợp.

### Hình thức lựa chọn nhà thầu

- Đấu thầu rộng rãi.
- Đấu thầu hạn chế.
- Chỉ định thầu.
- Chỉ định thầu rút gọn.
- Chào hàng cạnh tranh.
- Trường hợp đặc biệt.
- Mọi hình thức khác nếu code mới có.

### Phương thức

- Một giai đoạn một túi hồ sơ.
- Một giai đoạn hai túi hồ sơ.
- Hai giai đoạn một túi hồ sơ.
- Hai giai đoạn hai túi hồ sơ.
- Không có/không áp dụng.
- Mọi phương thức khác nếu code mới có.

### Phương pháp đánh giá

- Giá thấp nhất.
- Giá đánh giá.
- Kết hợp kỹ thuật và giá.
- Dựa trên kỹ thuật.
- Giá cố định.
- Mọi phương pháp khác.
- Trường hợp không áp dụng.

### Chiều khác

- Gói thuốc: có/không.
- Phân lô: có/không.
- Một lô/nhiều lô.
- Qua mạng/không qua mạng.
- Trong nước/quốc tế.
- Mua sắm bổ sung: có/không.
- Một/nhiều loại hợp đồng.
- Một/nhiều người phụ trách.
- Có/không bảo đảm dự thầu.
- Có/không bảo đảm thực hiện hợp đồng.
- Có/không thẩm định ở từng mốc.
- Có/không gia hạn.
- Có/không yêu cầu làm rõ.
- Có/không hàng hóa import Excel.

## 10.3 Các loại hợp đồng trong gói

Kiểm tra mọi lựa chọn hiện có, dự kiến:

- Trọn gói.
- Theo đơn giá cố định.
- Theo đơn giá điều chỉnh.
- Theo thời gian.
- Hỗn hợp.

Kiểm tra một hoặc nhiều loại hợp đồng nếu UI cho phép multi-select.

## 10.4 Lifecycle gói thầu

Đọc policy để tạo state machine chính xác. Với mọi transition:

- transition hợp lệ phải thành công;
- transition không hợp lệ phải bị chặn;
- nút đúng phải xuất hiện/ẩn;
- backend phải chặn deep request trái phép;
- audit/timeline đúng;
- reload giữ trạng thái;
- hai tab đồng bộ.

Các trạng thái dự kiến cần xác minh:

```text
Chuẩn bị
Đang mời thầu
Đã mở thầu
Đang chấm thầu
Đã có kết quả một phần
Đã có kết quả
Hủy thầu
```

Kiểm tra:

- Phát hành.
- Thẩm định trước phát hành nếu yêu cầu.
- Gia hạn thời điểm đóng thầu.
- Làm rõ.
- Mở thầu.
- Đánh giá kỹ thuật.
- Mở tài chính đối với 1G2T.
- Đánh giá tài chính.
- Xếp hạng.
- Phê duyệt kết quả.
- Kết quả một phần.
- Kết quả toàn bộ.
- Hủy ở từng thời điểm được phép.
- Tổ chức lại sau hủy.
- Tạo phiên bản mới.
- Dữ liệu reset/sao chép đúng.

## 10.5 Gói một giai đoạn hai túi hồ sơ

Phải kiểm tra riêng:

- Nhà thầu nộp hồ sơ.
- Mở kỹ thuật.
- Nhà thầu đạt kỹ thuật.
- Nhà thầu không đạt kỹ thuật.
- Không được mở tài chính khi chưa hoàn tất kỹ thuật.
- Mở tài chính chỉ cho nhà thầu đủ điều kiện.
- Điểm kỹ thuật.
- Giá tài chính.
- Xếp hạng.
- Kết quả.
- Phân lô.
- Liên danh.
- Không có nhà thầu đạt.
- Một phần lô đạt, một phần không đạt.
- Hủy/tổ chức lại.
- Audit/timeline.

## 10.6 Gói phân lô

Kiểm tra:

- Một lô.
- Hai lô.
- Nhiều lô.
- Thêm/sửa/xóa lô.
- Trùng mã lô.
- Mã có số 0 đầu.
- Tổng giá lô và giá gói.
- Một nhà thầu dự nhiều lô.
- Mỗi lô một nhà thầu khác nhau.
- Một nhà thầu trúng nhiều lô.
- Một lô nhiều nhà thầu.
- Hủy một lô nhưng không hủy gói.
- Kết quả một phần.
- Một lô không có hồ sơ.
- Một lô không có nhà thầu đạt kỹ thuật.
- Một lô cần tổ chức lại.
- Import hàng hóa theo lô.
- Thay đổi lô sau phát hành phải bị khóa đúng.
- Xuất Excel kết quả giữ nguyên thứ tự dòng.
- Đồng bộ trạng thái lô và trạng thái gói.

## 10.7 Gói thuốc

Kiểm tra các rule riêng của thuốc:

- Gói thuốc không phân lô nếu hợp lệ.
- Gói thuốc phân lô.
- Một/nhiều thuốc trong một lô.
- Một nhà thầu dự nhiều thuốc.
- Nhiều nhà thầu dự cùng thuốc.
- Tên hoạt chất.
- Hàm lượng.
- Dạng bào chế.
- Quy cách.
- Đơn vị.
- Số lượng.
- Đơn giá.
- Mã hàng/mã thuốc.
- Import Excel.
- Dòng trùng.
- Sai đơn vị.
- Thiếu mã.
- Tổng `số lượng × đơn giá`.
- Kết quả từng thuốc nếu model hỗ trợ.
- Xuất kết quả không ghép nhầm nhiều mặt hàng cùng bidder/lô.

## 10.8 Gói tư vấn

Kiểm tra:

- Đấu thầu rộng rãi/hạn chế.
- 1G2T và các phương thức hợp lệ.
- Kết hợp kỹ thuật và giá.
- Dựa trên kỹ thuật.
- Giá cố định.
- Điểm kỹ thuật tối thiểu.
- Hòa điểm.
- Nhà thầu độc lập.
- Liên danh.
- Một/nhiều chuyên gia.
- Phân công tổ chuyên gia.
- Báo cáo đánh giá.
- Kết quả và hợp đồng tư vấn.

## 10.9 Xây lắp, hàng hóa, phi tư vấn, hỗn hợp

Với từng lĩnh vực:

- Chạy toàn bộ tuple hợp lệ do policy cho phép.
- Kiểm tra field động hiển thị/ẩn.
- Kiểm tra validation theo lĩnh vực.
- Kiểm tra import hàng hóa nếu áp dụng.
- Kiểm tra phương pháp đánh giá.
- Kiểm tra phương thức.
- Kiểm tra phân lô.
- Kiểm tra tài liệu và kết quả.
- Kiểm tra tạo hợp đồng.

---

# 11. Nhà thầu dự thầu: độc lập và liên danh

## 11.1 Nhà thầu độc lập

- Một nhà thầu.
- Nhiều nhà thầu.
- Cùng nhà thầu nhiều lô.
- Nhà thầu thắng.
- Nhà thầu không thắng.
- Không đạt kỹ thuật.
- Không đạt tài chính.
- Bị loại vì tính hợp lệ.
- Giá thấp bất thường.
- Giá bằng nhau.
- Giá bằng 0 hoặc âm phải bị chặn.
- Giá rất lớn.
- Giảm giá.
- Sửa lỗi/hiệu chỉnh.
- Làm rõ.
- Rút hồ sơ nếu có.
- Trùng mã định danh/mã số thuế.

## 11.2 Liên danh

Kiểm tra:

- Liên danh hai thành viên.
- Liên danh ba hoặc nhiều thành viên.
- Thành viên đứng đầu.
- Tỷ lệ/phạm vi công việc.
- Tổng tỷ lệ.
- Thiếu thành viên đứng đầu.
- Trùng thành viên.
- Một nhà thầu vừa độc lập vừa thuộc liên danh trong cùng phần/lô nếu bị cấm.
- Một thành viên thuộc hai liên danh trong cùng phần/lô nếu bị cấm.
- Thành viên thuộc tổ chức khác trong dữ liệu master.
- Thêm/sửa/xóa thành viên.
- Thay trưởng liên danh.
- Upload thỏa thuận liên danh nếu có.
- Phân lô.
- 1G2T.
- Đánh giá/kết quả.
- Xuất tài liệu và Excel.
- Tạo hợp đồng với liên danh.
- Hiển thị đầy đủ thành viên trong detail/timeline.

Mọi rule ngăn xung đột phải kiểm tra cả UI và backend.

---

# 12. Mở thầu, đánh giá và kết quả

## 12.1 Mở thầu

- Không có nhà thầu.
- Một nhà thầu.
- Nhiều nhà thầu.
- Độc lập.
- Liên danh.
- Không phân lô.
- Phân lô.
- 1G1T.
- 1G2T.
- Các phương thức hai giai đoạn nếu hệ thống hỗ trợ.
- Giá dự thầu.
- Giảm giá.
- Hiệu lực HSDT.
- Bảo đảm dự thầu.
- Thời điểm nộp.
- Hồ sơ muộn.
- Dữ liệu thiếu.
- Import/export nếu có.

## 12.2 Đánh giá

- Tính hợp lệ.
- Năng lực/kinh nghiệm.
- Kỹ thuật.
- Tài chính.
- Điểm.
- Pass/fail.
- Giá thấp nhất.
- Giá đánh giá.
- Kỹ thuật và giá.
- Kỹ thuật.
- Giá cố định.
- Hòa điểm.
- Thứ hạng.
- Làm rõ.
- Sửa lỗi.
- Hiệu chỉnh sai lệch.
- Giảm giá.
- Giá thấp bất thường.
- Xung đột nhập liệu giữa hai người.
- Phân công nhiều chuyên gia.
- Thu hồi quyền chuyên gia giữa phiên.

## 12.3 Kết quả

- Một winner.
- Nhiều winner theo lô.
- Một bidder thắng nhiều lô.
- Kết quả một phần.
- Không có winner.
- Hủy lô.
- Hủy gói.
- Không có hồ sơ.
- Không đạt kỹ thuật.
- Không đạt tài chính.
- Không đáp ứng.
- Tổ chức lại.
- Giá trúng.
- Thời gian thực hiện.
- Lý do non-winner.
- Nội dung khác.
- Phê duyệt/chưa phê duyệt.
- Xuất Word.
- Xuất Excel muasamcong.
- Preview và đối chiếu.
- Không thay đổi A–F/thứ tự dòng của mẫu Excel.
- Download file thành công trên Chromium, Firefox và WebKit.

---

# 13. Ma trận hợp đồng

## 13.1 Tổ hợp hợp đồng

Đọc code để xác định chính xác các chiều. Kiểm tra toàn bộ tổ hợp hợp lệ giữa:

### Loại hợp đồng

- Trọn gói.
- Đơn giá cố định.
- Đơn giá điều chỉnh.
- Theo thời gian.
- Hỗn hợp.
- Loại khác nếu code có.

### Phân loại

- Tư vấn.
- Thẩm định.
- Khác.
- Mọi loại khác trong code.

### Liên kết

- Không có gói nếu hệ thống cho phép.
- Một gói.
- Nhiều gói.
- Một phần/lô.
- Nhiều phần/lô.
- Một nhà thầu độc lập.
- Liên danh.
- Một/nhiều người được giao.
- Có/không quyết định chỉ định nếu UI có.

## 13.2 CRUD và lifecycle

- Tạo từ màn hình hợp đồng.
- Tạo từ gói đã có kết quả.
- Sửa.
- Xóa.
- Không cho xóa khi lifecycle không cho phép.
- Giá trị hợp đồng.
- Giá trị bằng tổng award.
- Chênh giá trị.
- Ngày ký.
- Ngày hiệu lực.
- Thời hạn.
- Gia hạn.
- Hoàn thành.
- Thanh lý.
- Hủy/chấm dứt nếu có.
- Transition hợp lệ.
- Transition không hợp lệ.
- Một/nhiều phiên bản nhà thầu/chủ đầu tư.
- Thay đổi nhà thầu master không làm sai snapshot hợp đồng.
- File đính kèm.
- Giao việc.
- Permission.
- Audit/timeline.
- Reload.
- Đồng bộ nhiều tab.
- Cross-organization denial.

Phải khám phá tất cả trạng thái thực tế từ code và kiểm thử từng transition.

---

# 14. Chủ đầu tư, nhà thầu và chuyên gia

## 14.1 Chủ đầu tư

- Dữ liệu tối thiểu/đầy đủ.
- Mã trùng.
- Thông tin đại diện.
- Địa chỉ.
- Tài khoản ngân hàng.
- Phiên bản.
- Được tham chiếu bởi kế hoạch/hợp đồng.
- Sửa master sau khi tạo entity liên quan.
- Xóa khi đang được tham chiếu.
- Permission.
- Cross-org.

## 14.2 Nhà thầu

- Mã số thuế.
- Mã định danh.
- Tên.
- Người đại diện.
- Địa chỉ/khu vực.
- Ngân hàng.
- Ảnh con dấu.
- File ảnh sai.
- Phiên bản.
- Trùng mã.
- Tìm kiếm.
- Dùng trong liên danh.
- Dùng trong nhiều gói.
- Xóa khi được tham chiếu.
- XSS trong tên/địa chỉ.
- Permission.
- Cross-org.

## 14.3 Chuyên gia

- Thêm/sửa/xóa.
- Chức danh/năng lực.
- Phân công một/nhiều gói.
- Một gói nhiều chuyên gia.
- Gỡ phân công.
- Đang đánh giá thì bị gỡ.
- Quyền xem/sửa.
- Audit.
- Cross-org.

---

# 15. Tài liệu, upload, import và export

Kiểm tra qua UI:

- Upload file hợp lệ.
- File rỗng.
- File quá lớn.
- Extension hợp lệ nhưng MIME sai.
- MIME hợp lệ nhưng cấu trúc sai.
- Tên file Unicode.
- Tên file rất dài.
- Tên file chứa path traversal.
- Trùng tên.
- Download.
- Xóa.
- Quyền xem/tải/xóa.
- Cross-org.
- Worker thất bại.
- Worker timeout.
- Retry nếu có.
- Reload sau upload.
- Nhiều file đồng thời.
- File Word template.
- Export Word.
- Import Excel hàng hóa.
- Import Excel thuốc.
- Export Excel kết quả.
- Không ghi đè file nguồn.
- Công thức nguy hiểm được xử lý an toàn.
- Object URL được revoke sau download.
- Cache header phù hợp.
- Tên file trả về đúng.

Không dùng payload phá hoại ngoài môi trường E2E cô lập.

---

# 16. Xác thực, phiên và quản trị

Kiểm tra:

- Đăng ký nếu UI hỗ trợ.
- Xác minh email.
- Đăng nhập đúng/sai.
- Email viết hoa/thường.
- Khoảng trắng.
- Mật khẩu yếu/mạnh.
- Quên mật khẩu.
- Đổi mật khẩu.
- Logout.
- Logout tất cả phiên nếu có.
- Session hết hạn.
- Refresh trang.
- Hai tab.
- Hai browser context.
- Đăng nhập đồng thời.
- Thu hồi session.
- OTP nếu có.
- Google login nếu có thể mock an toàn.
- Turnstile ở môi trường test.
- Rate limit.
- Tài khoản chưa xác minh.
- Tài khoản bị khóa.
- Thành viên đã rời.
- Tổ chức bị tạm ngưng.
- Privileged reauthentication.
- Super admin.
- Quản trị tổ chức.
- Thêm/sửa/xóa thành viên.
- Nâng/hạ vai trò.
- Tự nâng quyền phải bị chặn.
- Xóa manager cuối cùng nếu bị cấm.
- Invitation nếu có.
- Subscription/entitlement.

Không log mật khẩu, OTP, session cookie hoặc token.

---

# 17. Phân quyền và chống truy cập chéo

Đối với mỗi module và thao tác:

1. Người có quyền thao tác thành công.
2. Người chỉ xem không tạo/sửa/xóa được.
3. Người không có quyền không thấy nút.
4. Deep link bị từ chối.
5. Sửa ID trong URL bị từ chối.
6. Sửa request payload sang organization khác bị từ chối.
7. Dùng ID entity của organization khác bị từ chối.
8. File artifact organization khác bị từ chối.
9. WebSocket không gửi dữ liệu chéo.
10. Search không trả dữ liệu chéo.
11. Notification/activity không trả dữ liệu chéo.
12. Export không chứa dữ liệu chéo.
13. Tab cũ sau revoke bị từ chối.
14. UI xử lý đúng 401 và 403.
15. Không lộ sự tồn tại entity qua thông báo khác biệt không cần thiết.

Phải ghi evidence request/response cho các lỗi quyền nhưng che token/cookie.

---

# 18. Offline, đồng bộ, nhiều tab và xung đột

## 18.1 Offline

Với các thao tác được hỗ trợ offline:

- Mất mạng trước khi mở màn hình.
- Mất mạng sau khi tải dữ liệu.
- Create offline.
- Update offline.
- Delete offline.
- Nhiều mutation cùng entity.
- Reload khi offline.
- Đóng/mở tab.
- Reconnect.
- Outbox gửi đúng thứ tự.
- Không mất mutation mới khi ACK mutation cũ.
- Toast/trạng thái offline rõ.
- Chuyển workspace khi còn mutation.
- Logout khi còn mutation.
- Session hết hạn trong lúc reconnect.

## 18.2 Nhiều tab

- Tab A tạo, tab B nhận thay đổi.
- Tab A sửa, tab B đang mở form cũ.
- Hai tab sửa cùng bản ghi.
- Một tab xóa, tab kia sửa.
- Một tab đổi workspace.
- Một tab logout.
- WebSocket reconnect.
- Delta sync.
- Không render trùng.
- Không mất local state ngoài ý muốn.

## 18.3 Hai người dùng

- Manager và employee sửa đồng thời.
- Hai employee sửa đồng thời.
- Row-version conflict.
- Server-wins behavior.
- Cảnh báo người bị mất thay đổi.
- Mutation không liên quan vẫn còn.
- Audit ghi đủ.
- Không có lost update âm thầm.

---

# 19. Search, filter, sort, pagination và dashboard

Với mọi danh sách:

- Search không dấu/có dấu nếu hỗ trợ.
- Viết hoa/thường.
- Khoảng trắng.
- Không có kết quả.
- Filter một/nhiều điều kiện.
- Reset filter.
- Sort tăng/giảm.
- Sort số/ngày/text.
- Pagination đầu/cuối.
- Thay page size.
- Xóa bản ghi cuối trang.
- Refresh.
- Chuyển workspace.
- Quyền.
- Dữ liệu lớn.
- URL/query state nếu có.
- Back/forward.

Dashboard:

- Số liệu đúng với dữ liệu fixture.
- Thay đổi sau CRUD.
- Thay đổi theo workspace.
- Chỉ số theo vai trò.
- Dữ liệu rỗng.
- Dữ liệu lớn.
- Link từ widget tới danh sách đúng.

---

# 20. Accessibility, responsive và trình duyệt

## 20.1 Browser matrix

Chạy các luồng trọng yếu trên:

- Chromium.
- Firefox.
- WebKit.

Chạy toàn bộ regression trên Chromium và smoke/critical path trên Firefox/WebKit nếu tổng suite quá lớn; phải ghi rõ coverage từng browser.

## 20.2 Viewport

Tối thiểu:

```text
320 × 800
375 × 812
414 × 896
768 × 1024
1280 × 800
1440 × 900
```

Kiểm tra:

- Sidebar.
- Modal.
- Bảng rộng.
- Tab.
- Form.
- Dropdown.
- Date picker.
- Upload.
- Toast.
- Không có horizontal overflow ngoài vùng bảng có chủ đích.
- Không che nút hành động.
- Zoom 200% cho luồng chính.

## 20.3 Accessibility

Dùng `@axe-core/playwright` hiện có hoặc công cụ tương đương.

Kiểm tra:

- Không có lỗi axe nghiêm trọng/nghiêm trọng cao.
- Keyboard-only.
- Tab order.
- Focus visible.
- Focus trap modal.
- Escape đóng modal nếu thiết kế cho phép.
- Label/input association.
- Button accessible name.
- Table header.
- Error message được liên kết.
- Toast có live region.
- Màu tương phản.
- Không dựa duy nhất vào màu.
- Không có duplicate ID.
- Loading state có thông báo.

Không chỉ chạy axe ở dashboard; phải chạy trên các màn hình và modal nghiệp vụ chính.

---

# 21. Hiệu năng và độ ổn định

Tạo dataset lớn hợp lý:

- 1.000 kế hoạch.
- 5.000 gói thầu.
- Nhiều phần/lô.
- Nhiều bidder.
- Nhiều notification/activity.
- File Excel hàng nghìn dòng.

Đo:

- thời gian tải shell;
- thời gian render danh sách;
- search/filter;
- chuyển workspace;
- mở detail;
- mở modal;
- sync;
- export;
- memory tăng bất thường;
- console error;
- request lặp;
- N+1 từ phía backend nếu có instrumentation.

Không đặt ngưỡng tùy tiện. Dùng baseline hiện tại hoặc ngân sách đã có trong repository; nếu chưa có, báo số đo và đề xuất ngân sách.

Chạy một vòng lặp thao tác dài để phát hiện:

- memory leak;
- Object URL leak;
- WebSocket leak;
- duplicate event listener;
- duplicate toast;
- modal không cleanup;
- IndexedDB connection leak.

---

# 22. Model kiểm thử tổ hợp nghiệp vụ

Tạo `BUSINESS_COMBINATION_MATRIX.md` từ code, không viết tay thiếu kiểm soát.

Mỗi tuple có dạng tương tự:

```text
plan_type
approval_type
package_field
selection_form
procedure
evaluation_method
is_medicine
is_lotted
network_mode
domestic_or_international
optional_purchase
contract_type
bidder_type
bidder_count
lot_count
result_outcome
user_role
workspace_role
```

Với mỗi tuple:

- ID duy nhất.
- Hợp lệ/không hợp lệ.
- Rule tạo ra kết luận.
- Fixture.
- Test spec.
- Kết quả.
- Evidence.

Dùng generator để:

1. Lấy các enum/domain từ source.
2. Áp dụng rule hợp lệ hiện tại.
3. Sinh toàn bộ tuple hữu hạn hợp lệ.
4. Sinh negative tuple bằng cách vi phạm từng constraint một.
5. Loại tuple trùng tương đương có chứng minh.
6. Chia shard ổn định.
7. In tổng số tuple.
8. Fail CI nếu tuple hợp lệ mới xuất hiện nhưng chưa được test.

Không được đánh dấu “toàn bộ” nếu chỉ chạy 15 case pairwise.

---

# 23. Kiến trúc bộ Playwright

Ưu tiên cấu trúc dễ bảo trì:

```text
e2e/
├── fixtures/
├── pages/
├── components/
├── models/
├── data/
├── generators/
├── specs/
│   ├── auth/
│   ├── workspace/
│   ├── permissions/
│   ├── plans/
│   ├── packages/
│   ├── bids/
│   ├── evaluation/
│   ├── contracts/
│   ├── documents/
│   ├── offline/
│   ├── accessibility/
│   └── performance/
└── reporters/
```

Điều chỉnh theo convention hiện tại.

## 23.1 Page object

Page object chỉ chứa thao tác UI, không chứa assertion nghiệp vụ phức tạp.

## 23.2 Domain model

Tạo helper/domain builder cho:

- plan;
- package;
- lot;
- bidder;
- joint venture;
- bid;
- evaluation;
- result;
- contract;
- permissions.

## 23.3 Fixture

- Worker-scoped auth state khi phù hợp.
- Test-scoped organization/data để tránh lẫn.
- Unique IDs.
- Cleanup an toàn.
- Không chia sẻ entity mutable giữa test song song.

## 23.4 Test ID

Mỗi test phải có ID:

```text
AUTH-...
WS-...
RBAC-...
PLAN-...
PKG-...
LOT-...
MED-...
JV-...
EVAL-...
AWARD-...
CONTRACT-...
DOC-...
SYNC-...
A11Y-...
PERF-...
```

## 23.5 Retry

- Không dùng retry để che lỗi deterministic.
- Retry tối đa cho lỗi hạ tầng có phân loại.
- Báo cáo cả kết quả lần đầu và retry.
- Flaky test phải được ghi bug/test debt, không im lặng.

## 23.6 Song song

- Chỉ parallel khi fixture cô lập.
- Các test lifecycle có thể serial trong một shard riêng.
- Không để test phụ thuộc thứ tự file.
- Có thể chạy shard theo ma trận nghiệp vụ.

---

# 24. Bằng chứng bắt buộc

Với mỗi bug:

- ID.
- Tiêu đề.
- Severity.
- Module.
- Commit SHA.
- Browser/viewport.
- Persona.
- Organization/workspace.
- Tiền điều kiện.
- Dữ liệu kiểm thử.
- Bước tái hiện chính xác.
- Kết quả mong đợi.
- Kết quả thực tế.
- Screenshot.
- Video/trace.
- Console log.
- Network request/response liên quan đã che secret.
- Tỷ lệ tái hiện.
- Ảnh hưởng.
- Workaround nếu có.
- Test tự động tái hiện nếu có thể.

Severity:

```text
S0 — rò dữ liệu, chiếm quyền, hỏng dữ liệu nghiêm trọng
S1 — blocker, không thể hoàn thành nghiệp vụ chính
S2 — chức năng chính sai hoặc mất dữ liệu cục bộ
S3 — chức năng phụ/UX sai đáng kể
S4 — cosmetic hoặc cải thiện
```

Không chụp hoặc ghi token, cookie, password, OTP.

---

# 25. Nguyên tắc khi gặp lỗi

- Không dừng toàn bộ suite khi gặp bug đầu tiên.
- Ghi bug, lưu evidence, reset fixture nếu cần và tiếp tục.
- Không sửa code sản phẩm trong lúc đang lập baseline kiểm thử.
- Chỉ được thêm:
  - test;
  - fixture;
  - reporter;
  - selector/test hook không thay đổi hành vi;
  - script chạy test;
  - tài liệu.
- Nếu selector không ổn định, ưu tiên sửa accessibility hoặc thêm `data-testid` tối thiểu trong commit riêng.
- Không thay đổi validation/rule để test pass.
- Không xóa test đang fail.
- Không giảm assertion.
- Không đổi expected result theo actual result nếu chưa chứng minh actual đúng nghiệp vụ.

Sau khi hoàn thành báo cáo baseline, có thể đề xuất patch sửa lỗi riêng nhưng không gộp việc sửa sản phẩm vào kết quả kiểm thử nếu chưa được yêu cầu.

---

# 26. Các script E2E hiện có phải được tái sử dụng và đánh giá

Đọc `package.json` và các script hiện hành. Tại thời điểm khảo sát, repository có các suite tương tự:

- auth shell;
- auth/roles;
- CRUD modules;
- multi-assignee;
- joint venture;
- low-price conflict;
- offline sync;
- package pairwise;
- full lifecycle;
- performance;
- UI quality;
- authenticated UI matrix;
- Turnstile;
- security/deploy checks.

Không mặc định các suite này đã đủ.

Với từng suite hiện có:

| Suite | Phạm vi thực | Dữ liệu | Vai trò | Browser | Điểm mạnh | Khoảng trống | Kết quả chạy |
|---|---|---|---|---|---|---|---|

Yêu cầu:

- Chạy lại trên commit mới nhất.
- Sửa đường dẫn fixture hard-code nếu có.
- Không viết lại test đã tốt.
- Tách helper dùng chung.
- Bổ sung các case còn thiếu.
- Đưa toàn bộ vào báo cáo coverage thống nhất.

---

# 27. Lệnh chạy

Trước khi chạy, đọc README và package scripts mới nhất. Không bịa lệnh.

Luồng dự kiến:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[test]"

npm ci
npx playwright install --with-deps

# Cấu hình database và biến môi trường E2E
# Chạy migration/fixture theo hướng dẫn thực tế của repository
# Khởi động backend/document worker/frontend nếu cần

npm run <existing-e2e-script>
npx playwright test
```

Bổ sung script rõ ràng nếu cần, ví dụ:

```text
test:e2e:smoke
test:e2e:roles
test:e2e:business-matrix
test:e2e:offline
test:e2e:cross-browser
test:e2e:a11y
test:e2e:full
```

Tên thực tế phải phù hợp convention repository.

Phải lưu command và exit code thật trong `TEST_EXECUTION_REPORT.md`.

---

# 28. Báo cáo coverage bắt buộc

Tạo bảng tổng hợp:

## 28.1 Theo module

| Module | Features | Operations | Roles | Valid combinations | Executed | Pass | Fail | Blocked | Coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## 28.2 Theo vai trò

| Persona | Workspaces | Routes | Allowed actions tested | Denied actions tested | Pass | Fail |
|---|---:|---:|---:|---:|---:|---:|

## 28.3 Theo tổ hợp nghiệp vụ

| Domain | Total valid tuples | Executed | Passed | Failed | Blocked | Missing |
|---|---:|---:|---:|---:|---:|---:|

## 28.4 Theo thao tác

| Entity | Create | Read | Update | Delete | Search | Filter | Export | Permission | Offline |
|---|---|---|---|---|---|---|---|---|---|

Không được ghi 100% nếu vẫn còn case blocked hoặc chưa chạy.

---

# 29. Tiêu chí nghiệm thu

Nhiệm vụ chỉ được coi là hoàn thành khi:

1. Đã ghi SHA code mới nhất.
2. Đã lập inventory từ code.
3. Đã lập ma trận vai trò/quyền.
4. Đã kiểm tra một người nhiều tổ chức.
5. Đã kiểm tra một người nhiều vai trò/quyền theo từng tổ chức.
6. Đã kiểm tra giao việc một và nhiều người.
7. Đã kiểm tra CRUD mọi entity có UI.
8. Đã sinh toàn bộ tuple nghiệp vụ hợp lệ hữu hạn.
9. Đã kiểm tra tuple không hợp lệ tại từng rule boundary.
10. Đã kiểm tra mọi loại kế hoạch hiện có.
11. Đã kiểm tra mọi hình thức, phương thức và phương pháp gói thầu hợp lệ.
12. Đã kiểm tra thuốc, tư vấn, 1G2T và phân lô.
13. Đã kiểm tra nhà thầu độc lập và liên danh.
14. Đã kiểm tra mở thầu, đánh giá, kết quả và hủy/tổ chức lại.
15. Đã kiểm tra mọi loại và transition hợp đồng hiện có.
16. Đã kiểm tra permission ở UI và backend.
17. Đã kiểm tra cross-organization.
18. Đã kiểm tra offline, nhiều tab và conflict.
19. Đã kiểm tra upload/import/export.
20. Đã kiểm tra Chromium, Firefox và WebKit theo matrix.
21. Đã kiểm tra responsive và accessibility.
22. Đã lưu screenshot/video/trace khi lỗi.
23. Đã tạo bug report có bước tái hiện.
24. Đã chạy lại toàn bộ suite hiện có.
25. Không dùng dữ liệu production.
26. Không để test phụ thuộc đường dẫn máy cá nhân.
27. Không hạ assertion để làm suite xanh.
28. Không tuyên bố case đã pass nếu chưa thực sự chạy.
29. Mọi case chưa chạy phải nằm trong `UNCOVERED_OR_BLOCKED_CASES.md`.
30. Báo cáo cuối cùng nêu rõ tổng số pass, fail, blocked và chưa chạy.

---

# 30. Báo cáo cuối cùng Codex phải trả

## A. Mốc code và môi trường

- Branch.
- Commit SHA.
- OS.
- Python.
- Node/npm.
- Playwright.
- Browser versions.
- Database.
- Base URL.
- Browser plugin/MCP đã dùng hay không.

## B. Phạm vi đã kiểm thử

- Module.
- Vai trò.
- Tổ chức.
- Browser.
- Viewport.
- Tổ hợp nghiệp vụ.
- Dữ liệu.

## C. Kết quả tổng hợp

```text
Total:
Passed:
Failed:
Blocked:
Skipped:
Flaky:
```

## D. Kết quả theo yêu cầu của chủ sản phẩm

Trả lời riêng:

- Không gian làm việc.
- Một người nhiều tổ chức.
- Một người nhiều vai trò.
- Giao việc.
- Kế hoạch.
- Gói thầu.
- Hợp đồng.
- CRUD.
- Phân quyền.
- Dự án.
- Dự toán mua sắm.
- Kế hoạch/dự toán chung, riêng theo model thực tế.
- Thuốc.
- Tư vấn.
- 1G2T.
- Phân lô.
- Nhà thầu độc lập.
- Liên danh.
- Offline.
- Đồng bộ.
- File/tài liệu.

## E. Bug

Bảng:

| ID | Severity | Module | Persona | Tổ hợp | Mô tả | Evidence | Test |
|---|---|---|---|---|---|---|---|

## F. Coverage

Đính kèm hoặc liên kết tới:

- feature matrix;
- role matrix;
- business matrix;
- Playwright HTML report;
- traces;
- screenshots;
- JUnit/JSON.

## G. Khoảng trống

- Case chưa chạy.
- Plugin/browser không dùng được.
- Integration ngoài hệ thống chưa mô phỏng được.
- Rule nghiệp vụ chưa xác định.
- Fixture còn thiếu.
- Hạn chế hạ tầng.

## H. Khuyến nghị

Phân loại:

- cần sửa ngay trước phát hành;
- cần regression test;
- cần cải thiện UX;
- cần tối ưu hiệu năng;
- cần bổ sung observability;
- cần làm rõ nghiệp vụ.

Không được kết luận “ứng dụng đã được kiểm thử đầy đủ” nếu bất kỳ ma trận bắt buộc nào chưa được sinh hoặc chưa được chạy.

---

# 31. Bắt đầu thực hiện

Thực hiện theo đúng thứ tự:

1. Ghi SHA code.
2. Đọc kiến trúc và test hiện có.
3. Tạo feature inventory.
4. Tạo role/permission matrix.
5. Tạo business combination generator và matrix.
6. Chuẩn bị môi trường E2E cô lập.
7. Chạy suite hiện có để lấy baseline.
8. Thực hiện browser exploration headed.
9. Bổ sung test tự động còn thiếu.
10. Chạy smoke.
11. Chạy role/workspace/permission.
12. Chạy CRUD.
13. Chạy toàn bộ business matrix theo shard.
14. Chạy lifecycle.
15. Chạy offline/concurrency.
16. Chạy documents/import/export.
17. Chạy cross-browser.
18. Chạy responsive/a11y.
19. Chạy performance/stability.
20. Tổng hợp evidence và bug.
21. Chạy lại các case fail để xác nhận.
22. Xuất toàn bộ báo cáo.

Không dừng ở việc viết kế hoạch. Phải điều khiển trình duyệt, thực hiện thao tác, chạy test và báo cáo kết quả thật.
