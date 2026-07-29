# PROMPT CODEX: KIỂM THỬ TOÀN DIỆN BIDDINGFLOW BẰNG TRÌNH DUYỆT, PHÁT HIỆN LỖI, SỬA LỖI VÀ KIỂM TRA LẠI

**Repository:** `https://github.com/newstar94/Bidding`

---

# 1. VAI TRÒ VÀ MỤC TIÊU

Hãy làm việc trực tiếp trên repository **Bidding/BiddingFlow** tại branch hiện đang được checkout.

Bạn đóng vai trò đồng thời là:

- kỹ sư kiểm thử nghiệp vụ;
- kỹ sư kiểm thử E2E;
- người dùng thật của hệ thống;
- kỹ sư phân tích lỗi;
- kỹ sư sửa lỗi;
- người viết test hồi quy.

Mục tiêu là sử dụng **plugin, MCP, skill hoặc công cụ trình duyệt đã được tích hợp trong môi trường Codex** để vận hành ứng dụng như người dùng thật, kiểm thử toàn bộ chức năng, nghiệp vụ, vai trò, quyền hạn, trạng thái và vòng đời gói thầu.

Nhiệm vụ này **không được dừng ở việc lập kế hoạch, review code hoặc liệt kê lỗi**. Khi phát hiện lỗi, phải sửa lỗi, bổ sung test hồi quy, kiểm tra lại bằng trình duyệt và chỉ tiếp tục khi lỗi đã thực sự được khắc phục.

---

# 2. NGUYÊN TẮC BẮT BUỘC

## 2.1. Bắt buộc sử dụng trình duyệt

Trước khi kiểm thử:

1. kiểm tra danh sách plugin, MCP server, skill và công cụ có sẵn;
2. ưu tiên công cụ có thể điều khiển trình duyệt, ví dụ:
   - Playwright;
   - Browser MCP;
   - Chrome DevTools MCP;
   - công cụ browser automation tương đương;
3. khởi động đầy đủ frontend, backend, database và các dịch vụ liên quan;
4. mở ứng dụng trong trình duyệt;
5. thao tác như người dùng thật.

Các thao tác phải bao gồm khi chức năng có hỗ trợ:

- đăng ký;
- đăng nhập;
- đăng xuất;
- chuyển tài khoản;
- nhấp nút;
- nhập dữ liệu;
- chọn dropdown;
- chọn checkbox/radio;
- chuyển tab;
- mở và đóng modal;
- xác nhận hoặc hủy hộp thoại;
- tải file lên;
- tải file xuống;
- mở và kiểm tra file đã tải;
- tìm kiếm;
- lọc;
- phân trang;
- sắp xếp;
- tạo, xem, sửa, xóa dữ liệu;
- tải lại trang;
- mở trực tiếp URL;
- dùng nút Back/Forward;
- mở nhiều tab;
- đóng và mở lại trình duyệt;
- đăng xuất rồi đăng nhập lại;
- mô phỏng lỗi mạng;
- kiểm tra console và network.

Không được chỉ gọi API trực tiếp để kết luận một chức năng giao diện hoạt động.

API, database, script và fixture có thể được dùng để:

- chuẩn bị dữ liệu;
- xác minh kết quả;
- kiểm tra phân quyền backend;
- kiểm tra tính toàn vẹn dữ liệu;
- hỗ trợ tái hiện lỗi.

Tuy nhiên, mọi nghiệp vụ chính phải được thực hiện và xác nhận trên giao diện.

---

## 2.2. Không tự suy đoán cấu trúc ứng dụng

Trước khi kiểm thử, phải khảo sát code trên branch hiện tại để xác định chính xác:

- tất cả loại tài khoản;
- tất cả vai trò;
- quyền của từng vai trò;
- phạm vi dữ liệu của từng tài khoản;
- workspace hoặc tổ chức;
- route;
- menu;
- module;
- trạng thái nghiệp vụ;
- các giai đoạn của gói thầu;
- lĩnh vực gói thầu;
- loại hình kế hoạch;
- hình thức lựa chọn nhà thầu;
- phương thức lựa chọn nhà thầu;
- phương pháp đánh giá;
- loại hợp đồng;
- cơ chế phân lô;
- nhà thầu độc lập;
- nhà thầu liên danh;
- thành viên đứng đầu liên danh;
- tổ chuyên gia;
- tổ thẩm định;
- người phê duyệt;
- phân công nhân viên;
- báo cáo đánh giá tổng quát;
- báo cáo đánh giá chi tiết;
- xử lý giá đề nghị trúng thầu dưới 50%;
- hủy thầu;
- đấu thầu lại;
- hợp đồng;
- hoàn thành và thanh lý;
- phân quyền frontend;
- phân quyền backend;
- IndexedDB;
- local state;
- mutation queue;
- đồng bộ backend;
- PostgreSQL;
- import/export;
- sinh Word, Excel, PDF;
- test và script hiện có.

Phải đọc tối thiểu khi tồn tại:

- `README`;
- tài liệu trong `docs`;
- frontend auth;
- backend auth;
- access policy;
- route policy;
- role constants;
- database schema;
- migration;
- seed;
- fixtures;
- lifecycle scripts;
- Playwright tests;
- API tests;
- unit tests;
- code đánh giá hồ sơ dự thầu;
- code xếp hạng nhà thầu;
- code xử lý phần lô;
- code xử lý liên danh;
- code xử lý giá đề nghị trúng thầu dưới 50%;
- code tạo kết quả lựa chọn nhà thầu;
- code tạo hợp đồng.

Không được dựa vào tên gọi trong prompt để kết luận ứng dụng chắc chắn có một vai trò hoặc chức năng. Phải xác nhận từ code và giao diện thực tế.

---

## 2.3. Không bỏ qua do thiếu dữ liệu

Nếu chức năng cần dữ liệu đầu vào, phải tự tạo dữ liệu kiểm thử phù hợp:

- tài khoản;
- vai trò;
- workspace;
- nhân viên;
- chủ đầu tư;
- đối tác;
- nhà thầu;
- thành viên liên danh;
- chuyên gia;
- tổ chuyên gia;
- tổ thẩm định;
- kế hoạch;
- nguồn vốn;
- gói thầu;
- phần lô;
- hàng hóa;
- hồ sơ dự thầu;
- hồ sơ đề xuất kỹ thuật;
- hồ sơ đề xuất tài chính;
- báo cáo;
- quyết định;
- hợp đồng;
- file Word;
- file Excel;
- file PDF;
- file đính kèm.

Không được ghi “không kiểm thử được vì thiếu dữ liệu” nếu dữ liệu có thể tạo trong môi trường kiểm thử.

Không sử dụng dữ liệu production.

Dữ liệu kiểm thử phải có:

- tiền tố hoặc `runId` riêng;
- khả năng truy vết;
- khả năng dọn dẹp;
- không xung đột với các lần chạy khác.

---

# 3. RÀNG BUỘC NGHIỆP VỤ GIÁ ĐỀ NGHỊ TRÚNG THẦU DƯỚI 50%

## 3.1. Giữ nguyên thiết kế đơn giản hiện tại

Ứng dụng hiện được thiết kế có chủ đích để xử lý trường hợp giá đề nghị trúng thầu dưới 50% theo luồng đơn giản:

1. hệ thống phát hiện giá đề nghị trúng thầu nhỏ hơn 50% giá làm căn cứ;
2. giao diện hiển thị cảnh báo;
3. người đánh giá bắt buộc chọn:
   - **Chấp thuận**; hoặc
   - **Không chấp thuận**;
4. nếu chấp thuận, nhà thầu không bị tự động loại chỉ vì giá dưới 50%;
5. nếu không chấp thuận, hệ thống tự động ghi lý do không đạt và loại nhà thầu khỏi xếp hạng;
6. không cần thêm quy trình làm rõ nhiều bước.

Đây là yêu cầu sản phẩm có chủ đích nhằm tránh gây phức tạp cho người dùng.

## 3.2. Tuyệt đối không tự ý bổ sung luồng phức tạp

Không được tự ý xây dựng thêm các chức năng sau:

- yêu cầu nhà thầu giải trình;
- thời hạn phản hồi;
- luồng gửi/nhận làm rõ;
- tải chứng cứ cấu thành giá;
- đánh giá chứng cứ;
- phê duyệt riêng đối với giá thấp;
- nhiều cấp xác nhận;
- trạng thái workflow mới;
- bảng dữ liệu mới cho hồ sơ làm rõ;
- thông báo hoặc nhiệm vụ mới liên quan đến làm rõ giá thấp.

Chỉ sửa lỗi để cơ chế hiện tại hoạt động đúng, nhất quán, rõ ràng và an toàn.

## 3.3. Quy tắc cần xác minh

Phải kiểm tra code thực tế và xác nhận:

- gói không phân lô dùng giá gói thầu làm căn cứ;
- gói phân lô dùng giá phần lô tương ứng làm căn cứ;
- điều kiện dưới 50% là điều kiện nghiêm ngặt `< 50%`;
- giá bằng đúng 50% không bị coi là dưới 50%;
- phép tính không bị sai số số thực;
- không lấy nhầm giá của toàn gói khi đánh giá một phần lô;
- không lấy nhầm giá trước giảm giá nếu nghiệp vụ dùng giá sau giảm giá;
- không lấy nhầm giá trước hiệu chỉnh nếu nghiệp vụ dùng giá sau hiệu chỉnh;
- dữ liệu frontend, backend, database và báo cáo thống nhất.

Nếu code hiện tại sử dụng điều kiện tương đương:

```text
Giá đề nghị trúng thầu × 2 < Giá làm căn cứ
```

thì phải giữ đúng hành vi biên:

- `49,999...%`: dưới 50%;
- `50%`: không dưới 50%;
- `50,000...%`: không dưới 50%.

Ưu tiên số nguyên đơn vị đồng, `BigInt` hoặc `Decimal`. Không dùng `float` để so sánh tiền tại ngưỡng.

## 3.4. Hành vi khi chọn “Chấp thuận”

Phải xác minh:

- lưu giá trị quyết định chấp thuận;
- trường dữ liệu hiện có, ví dụ `chapThuanGiaDeNghiTrungThauDuoi50`, được lưu đúng nếu đó là tên trong code;
- nhà thầu vẫn được xem xét xếp hạng nếu đáp ứng các tiêu chí còn lại;
- lý do loại tự động do giá dưới 50% được xóa nếu trước đó tồn tại;
- không tự động chuyển mọi tiêu chí khác thành đạt;
- kết quả còn đúng sau reload;
- kết quả còn đúng sau đăng nhập lại;
- kết quả xuất báo cáo đúng;
- gói phân lô chỉ ảnh hưởng đúng phần lô.

## 3.5. Hành vi khi chọn “Không chấp thuận”

Phải xác minh:

- lưu giá trị quyết định không chấp thuận;
- hệ thống tự động ghi lý do không đạt theo nội dung hiện có;
- lý do dùng đúng “giá gói thầu” hoặc “giá phần lô” tùy trường hợp;
- nhà thầu bị loại khỏi xếp hạng;
- không được tự động xác định là nhà thầu trúng;
- không được tính vào tổng giá trúng thầu dự kiến;
- nhà thầu xếp hạng sau được xử lý đúng;
- kết quả còn đúng sau reload;
- kết quả còn đúng sau đăng nhập lại;
- báo cáo tổng quát và chi tiết thể hiện đúng;
- gói phân lô chỉ loại đúng phần lô, không làm sai các phần lô khác.

## 3.6. Hành vi khi chưa chọn

Nếu giá dưới 50% mà người dùng chưa chọn:

- không được lưu hoặc hoàn tất bước đánh giá;
- phải hiển thị thông báo rõ ràng;
- phải đưa focus hoặc chỉ ra đúng nhà thầu/phần lô bị thiếu quyết định;
- không được báo lưu thành công giả;
- không được bỏ qua bằng chuyển tab;
- không được bỏ qua bằng reload;
- không được bỏ qua bằng gọi API trực tiếp nếu backend có trách nhiệm kiểm tra;
- không được bỏ qua khi import hoặc đồng bộ.

## 3.7. Khi sửa giá lên bằng hoặc trên 50%

Phải xác minh:

- cảnh báo biến mất;
- quyết định cũ được xóa hoặc không còn tác dụng;
- lý do loại tự động do giá dưới 50% được xóa;
- nhà thầu được tính lại đúng;
- xếp hạng được tính lại;
- dữ liệu sau reload đúng;
- báo cáo không còn nội dung cảnh báo cũ.

## 3.8. Trường hợp giá bằng 0 và giá âm

Phải kiểm tra riêng:

- giá âm phải bị từ chối;
- giá bằng 0 phải tuân theo validation nghiệp vụ hiện có;
- nếu giá bằng 0 không hợp lệ thì phải bị chặn ở cả frontend và backend;
- không được để giá bằng 0 lọt qua chỉ vì rule dưới 50% có điều kiện `> 0`;
- thông báo phải rõ ràng;
- không được sinh xếp hạng sai;
- không được tạo hợp đồng giá 0 ngoài ý muốn.

Không thay đổi quy tắc giá bằng 0 nếu code/tài liệu nghiệp vụ quy định khác; phải xác định chính xác và ghi vào báo cáo.

---

# 4. FILE QUẢN LÝ KIỂM THỬ VÀ LỖI

Ngay khi bắt đầu, tạo hoặc cập nhật:

```text
docs/USER_FLOW_TEST_AND_FIX_REPORT.md
```

Nếu file đã tồn tại, không xóa lịch sử hợp lệ trước đó.

File này là nguồn sự thật duy nhất về:

- phạm vi;
- tiến độ;
- test case;
- lỗi;
- trạng thái sửa;
- kết quả kiểm tra lại;
- bằng chứng;
- rủi ro còn lại.

## 4.1. Thông tin chung

Ghi:

- thời gian bắt đầu;
- branch;
- commit ban đầu;
- trạng thái working tree;
- môi trường;
- hệ điều hành;
- trình duyệt;
- plugin/MCP/skill;
- URL frontend;
- URL backend;
- database kiểm thử;
- lệnh khởi động;
- lệnh build;
- lệnh test;
- phiên bản Node;
- phiên bản Python;
- phiên bản Playwright;
- phiên bản trình duyệt;
- các biến môi trường liên quan nhưng không ghi secret.

## 4.2. Danh sách tài khoản và vai trò

Tạo bảng:

| ID | Loại tài khoản/vai trò | Phạm vi dữ liệu | Quyền chính | Tài khoản test | Trạng thái |
|---|---|---|---|---|---|

Không ghi mật khẩu thật.

## 4.3. Ma trận chức năng

| ID | Module | Chức năng | Vai trò | Trường hợp | Kết quả | Lỗi liên quan |
|---|---|---|---|---|---|---|

Chỉ dùng:

- `CHƯA KIỂM THỬ`
- `ĐANG KIỂM THỬ`
- `ĐẠT`
- `KHÔNG ĐẠT`
- `BỊ CHẶN`

## 4.4. Ma trận tổ hợp gói thầu

| ID | Lĩnh vực | Hình thức | Phương thức | Phương pháp | Phân lô | Kiểu nhà thầu | Nhánh nghiệp vụ | Kết quả |
|---|---|---|---|---|---|---|---|---|

Phải bao phủ:

- mọi option thực tế ít nhất một lần;
- tương tác nghiệp vụ quan trọng;
- nhà thầu độc lập;
- nhà thầu liên danh;
- không phân lô;
- có phân lô;
- một giai đoạn một túi hồ sơ;
- một giai đoạn hai túi hồ sơ nếu có;
- giá bình thường;
- giá bằng 50%;
- giá dưới 50%;
- chấp thuận giá dưới 50%;
- không chấp thuận giá dưới 50%;
- hủy thầu;
- đấu thầu lại;
- hợp đồng.

Có thể dùng pairwise/combinatorial coverage thay vì tích Descartes vô hạn, nhưng phải giải thích chiến lược.

## 4.5. Mẫu ghi lỗi

```markdown
## BUG-XXX: Tên lỗi

- Trạng thái: PHÁT HIỆN | ĐANG SỬA | CHỜ KIỂM TRA LẠI | ĐÃ SỬA | CHƯA THỂ SỬA
- Mức độ: BLOCKER | CRITICAL | HIGH | MEDIUM | LOW
- Module:
- Vai trò:
- URL/route:
- Dữ liệu kiểm thử:
- Tiền điều kiện:
- Các bước tái hiện:
  1.
  2.
  3.
- Kết quả mong đợi:
- Kết quả thực tế:
- Console error:
- Network/API error:
- Backend error:
- Database state:
- Local/IndexedDB state:
- Screenshot/video/trace:
- Nguyên nhân gốc:
- File đã sửa:
- Migration:
- Test hồi quy:
- Lệnh kiểm tra:
- Kết quả kiểm tra lại bằng trình duyệt:
- Kết quả sau reload:
- Kết quả sau đăng nhập lại:
- Ngày phát hiện:
- Ngày sửa xong:
```

Không đánh dấu `ĐÃ SỬA` chỉ vì đã sửa code.

---

# 5. QUY TRÌNH DỪNG – GHI LỖI – SỬA – KIỂM TRA LẠI

## 5.1. Khi chưa gặp lỗi

Sau mỗi test case:

1. cập nhật trạng thái;
2. ghi bằng chứng;
3. xác minh dữ liệu;
4. reload khi cần;
5. mới chuyển sang test case tiếp theo.

## 5.2. Khi gặp lỗi

Bắt buộc:

1. dừng test case hiện tại;
2. không chuyển sang chức năng khác;
3. ghi lỗi vào báo cáo;
4. thu thập:
   - screenshot;
   - video;
   - trace;
   - console;
   - network;
   - request payload;
   - response;
   - backend traceback;
   - database state;
   - local state;
   - IndexedDB state;
5. tái hiện tối thiểu một lần;
6. xác định nguyên nhân gốc;
7. sửa đúng tầng gây lỗi;
8. bổ sung test hồi quy;
9. chạy test liên quan nhỏ nhất;
10. chạy test module;
11. thao tác lại bằng trình duyệt;
12. reload;
13. đăng xuất và đăng nhập lại nếu cần;
14. kiểm tra bằng vai trò có quyền;
15. kiểm tra bằng vai trò không có quyền;
16. chỉ khi tất cả đạt mới đánh dấu `ĐÃ SỬA`;
17. tiếp tục lại đúng test case vừa lỗi;
18. chỉ khi test case đó đạt mới chuyển tiếp.

Không gom lỗi để sửa vào cuối.

Không bỏ qua lỗi để tiếp tục khảo sát.

Ngoại lệ duy nhất là lỗi hạ tầng chặn toàn bộ hệ thống. Khi đó sửa lỗi hạ tầng trước rồi kiểm tra lại từ đầu.

---

# 6. KIỂM THỬ TẤT CẢ TÀI KHOẢN VÀ VAI TRÒ

Phải xác định từ code và kiểm thử tất cả vai trò thực tế.

## 6.1. Xác thực

Với mọi loại tài khoản:

- đăng ký nếu có;
- chấp nhận điều khoản;
- đăng nhập đúng;
- sai mật khẩu;
- tài khoản không tồn tại;
- tài khoản khóa;
- tài khoản vô hiệu hóa;
- đăng xuất;
- session hết hạn;
- refresh token;
- reload;
- URL bảo vệ khi chưa đăng nhập;
- Back/Forward;
- nhiều tab;
- đăng nhập lại bằng tài khoản khác;
- thay đổi mật khẩu;
- quên mật khẩu;
- cập nhật hồ sơ;
- lỗi mạng;
- 401;
- 403;
- token cũ;
- token bị thu hồi.

## 6.2. Phân quyền

Với mỗi vai trò:

- menu được phép hiển thị;
- menu không được phép bị ẩn hoặc khóa;
- route trái quyền bị từ chối;
- nút tạo/sửa/xóa đúng quyền;
- API trái quyền bị backend từ chối;
- không xem dữ liệu workspace khác;
- không sửa dữ liệu không được phân công;
- không nâng quyền bằng sửa URL;
- không nâng quyền bằng sửa request;
- không truy cập qua ID đoán được;
- quyền cập nhật sau thay đổi;
- quyền đúng sau reload;
- quyền đúng sau đăng nhập lại;
- quyền chỉ xem;
- quyền tạo nhưng không phê duyệt;
- được phân công;
- không được phân công;
- bị thu hồi quyền khi đang mở form;
- hai vai trò cùng thao tác một bản ghi.

---

# 7. KIỂM THỬ TOÀN BỘ MODULE

Khảo sát và kiểm thử tất cả module thực tế, bao gồm nhưng không giới hạn:

- landing;
- đăng ký;
- đăng nhập;
- tài khoản;
- điều khoản;
- quyền riêng tư;
- bảo mật;
- quản trị người dùng;
- vai trò;
- phân quyền;
- workspace;
- tổ chức;
- gói dịch vụ;
- nhân viên;
- chủ đầu tư;
- đối tác;
- nhà thầu;
- liên danh;
- chuyên gia;
- tổ chuyên gia;
- tổ thẩm định;
- kế hoạch lựa chọn nhà thầu;
- gói thầu;
- hàng hóa;
- phần lô;
- hồ sơ mời thầu;
- phát hành;
- gia hạn;
- mở thầu;
- đánh giá hồ sơ dự thầu;
- tính hợp lệ;
- năng lực và kinh nghiệm;
- kỹ thuật;
- tài chính;
- báo cáo đánh giá tổng quát;
- báo cáo đánh giá chi tiết;
- xử lý giá dưới 50%;
- thẩm định;
- phê duyệt;
- hủy thầu;
- đấu thầu lại;
- hợp đồng;
- thực hiện hợp đồng;
- hoàn thành;
- thanh lý;
- tài liệu;
- thông báo;
- import;
- export;
- đồng bộ;
- tìm kiếm;
- lọc;
- phân trang;
- sắp xếp;
- dashboard;
- thống kê;
- quản trị hệ thống.

Với mỗi màn hình:

- loading;
- empty state;
- error state;
- dữ liệu nhiều;
- Unicode tiếng Việt;
- nội dung dài;
- desktop;
- màn hình hẹp;
- keyboard cơ bản;
- modal;
- dropdown;
- tooltip;
- nút hủy;
- xác nhận;
- thông báo thành công;
- thông báo lỗi;
- reload;
- Back/Forward;
- nhiều tab;
- console error;
- request lỗi;
- request lặp;
- race condition.

---

# 8. KIỂM THỬ CRUD

Với mọi thực thể:

## 8.1. Tạo

- dữ liệu hợp lệ;
- bỏ trống từng trường bắt buộc;
- min/max;
- bằng 0;
- âm;
- ngày sai;
- ngày bắt đầu sau ngày kết thúc;
- Unicode;
- khoảng trắng;
- dữ liệu trùng;
- mã khác hoa/thường;
- double click;
- Enter;
- mất mạng;
- API lỗi;
- reload;
- database;
- audit log nếu có.

## 8.2. Xem

- danh sách;
- chi tiết;
- quan hệ dữ liệu;
- bản ghi không tồn tại;
- ID sai;
- workspace khác;
- chỉ xem;
- bản ghi đã xóa;
- URL trực tiếp.

## 8.3. Sửa

- một trường;
- nhiều trường;
- không thay đổi nhưng lưu;
- hai phiên cùng sửa;
- version conflict;
- mất mạng;
- quyền bị thu hồi;
- reload;
- đăng nhập lại;
- audit log.

## 8.4. Xóa

- hủy;
- xác nhận;
- chưa được tham chiếu;
- đang được tham chiếu;
- trái quyền;
- xóa lặp;
- reload;
- dữ liệu mồ côi;
- cascade;
- soft delete;
- restore nếu có.

---

# 9. TOÀN BỘ VÒNG ĐỜI GÓI THẦU

Không chỉ chạy happy path.

## 9.1. Chuẩn bị dữ liệu

Tạo:

- tài khoản;
- workspace;
- nhân viên;
- chủ đầu tư;
- nhà thầu độc lập;
- nhiều nhà thầu;
- nhà thầu liên danh;
- chuyên gia;
- tổ chuyên gia;
- tổ thẩm định;
- kế hoạch;
- nguồn vốn;
- hàng hóa;
- phần lô;
- file đính kèm.

## 9.2. Kế hoạch lựa chọn nhà thầu

Kiểm tra tất cả option thực tế:

- loại hình;
- loại phê duyệt;
- dự án;
- dự toán mua sắm;
- chủ đầu tư;
- tổng mức đầu tư;
- tổng dự toán;
- quyết định;
- ngày trình;
- ngày phê duyệt;
- phân bổ giá trị;
- nhiều gói;
- tổng giá bằng giá trị kế hoạch;
- tổng giá nhỏ hơn;
- tổng giá lớn hơn;
- sửa kế hoạch đã có gói;
- xóa kế hoạch đã được tham chiếu.

## 9.3. Lĩnh vực

Kiểm tra mọi lĩnh vực có trong hệ thống, ví dụ khi có:

- hàng hóa;
- xây lắp;
- tư vấn;
- phi tư vấn;
- hỗn hợp;
- lĩnh vực khác.

## 9.4. Hình thức lựa chọn nhà thầu

Kiểm tra tất cả hình thức có trong code/giao diện.

Không chỉ kiểm tra đấu thầu rộng rãi.

## 9.5. Phương thức

Kiểm tra tất cả phương thức, bao gồm khi có:

- một giai đoạn một túi hồ sơ;
- một giai đoạn hai túi hồ sơ;
- phương thức khác.

## 9.6. Phương pháp đánh giá

Kiểm tra tất cả phương pháp, ví dụ khi có:

- giá thấp nhất;
- giá đánh giá;
- kết hợp kỹ thuật và giá;
- đạt/không đạt;
- phương pháp khác.

## 9.7. Phân lô

Kiểm tra:

- không phân lô;
- một lô;
- nhiều lô;
- một lô một mặt hàng;
- một lô nhiều mặt hàng;
- nhà thầu dự một lô;
- nhà thầu dự nhiều lô;
- một lô một nhà thầu;
- một lô nhiều nhà thầu;
- trúng một lô, trượt lô khác;
- liên danh dự một lô;
- liên danh dự nhiều lô;
- tổng giá lô bằng giá gói;
- nhỏ hơn;
- lớn hơn;
- mã lô trùng;
- tên lô rỗng;
- giá lô bằng 0;
- giá lô âm;
- sửa/xóa lô sau khi đã có dữ liệu.

---

# 10. KIỂM THỬ NHÀ THẦU LIÊN DANH

Phải kiểm thử cả nhà thầu độc lập và liên danh.

## 10.1. Tạo và quản lý liên danh

Kiểm tra:

- liên danh hai thành viên;
- liên danh hơn hai thành viên;
- một thành viên đứng đầu;
- không có thành viên đứng đầu;
- hai thành viên cùng đứng đầu;
- thay đổi thành viên đứng đầu;
- thành viên trùng;
- nhà thầu vừa dự độc lập vừa tham gia liên danh trong cùng gói;
- hai liên danh có thành viên trùng;
- thay đổi thành viên trước thời điểm cho phép;
- thay đổi sau thời điểm bị khóa;
- xóa thành viên;
- tên liên danh;
- mã liên danh;
- tên trùng;
- mã trùng;
- tỷ lệ công việc từng thành viên;
- tổng tỷ lệ bằng 100%;
- tổng tỷ lệ dưới 100%;
- tổng tỷ lệ trên 100%;
- tỷ lệ 0;
- tỷ lệ âm;
- phạm vi công việc;
- thỏa thuận liên danh;
- file sai định dạng;
- reload;
- đăng nhập lại.

Phải xác định quy tắc nghiệp vụ thực tế. Không tự áp đặt tổng tỷ lệ bắt buộc bằng 100% nếu ứng dụng không thiết kế như vậy; thay vào đó ghi rõ quy tắc và kiểm thử đúng theo code/tài liệu.

## 10.2. Mở thầu liên danh

Kiểm tra:

- hiển thị tên liên danh;
- đầy đủ thành viên;
- đúng thành viên đứng đầu;
- giá dự thầu ở cấp liên danh;
- giảm giá;
- bảo đảm dự thầu;
- hiệu lực hồ sơ;
- hiệu lực thỏa thuận;
- nhiều phần lô;
- không tạo mỗi thành viên thành hồ sơ độc lập ngoài ý muốn;
- không cộng trùng giá;
- không đếm một liên danh thành nhiều nhà thầu.

## 10.3. Đánh giá tính hợp lệ

Kiểm tra:

- thỏa thuận liên danh;
- đại diện;
- thành viên đứng đầu;
- phạm vi công việc;
- tỷ lệ;
- bảo đảm dự thầu;
- hiệu lực;
- tư cách từng thành viên;
- một thành viên không hợp lệ;
- thành viên đứng đầu không hợp lệ;
- kết luận toàn liên danh.

## 10.4. Năng lực và kinh nghiệm

Kiểm tra đúng rule thực tế đối với:

- năng lực chung;
- năng lực từng thành viên;
- doanh thu;
- hợp đồng tương tự;
- nhân sự;
- thiết bị;
- năng lực tài chính;
- kinh nghiệm theo phạm vi;
- tiêu chí được cộng gộp;
- tiêu chí từng thành viên phải đáp ứng;
- tiêu chí thành viên đứng đầu;
- kết luận từng tiêu chí;
- kết luận toàn liên danh.

Không tự động cộng gộp mọi chỉ tiêu nếu nghiệp vụ không cho phép.

## 10.5. Kỹ thuật

- đánh giá toàn liên danh;
- nội dung từng thành viên phụ trách;
- thành viên phụ trách không đáp ứng;
- điểm kỹ thuật;
- đạt/không đạt;
- kết luận toàn liên danh.

## 10.6. Tài chính

- giá dự thầu;
- giảm giá;
- hiệu chỉnh;
- sai lệch;
- giá đánh giá;
- giá xếp hạng;
- giá đề nghị trúng thầu;
- phân bổ theo thành viên nếu có;
- phân bổ theo phần lô;
- không tính trùng;
- giá dưới 50% ở cấp liên danh;
- chấp thuận;
- không chấp thuận.

## 10.7. Kết quả và hợp đồng liên danh

- phê duyệt liên danh trúng;
- tên liên danh;
- thành viên đứng đầu;
- các thành viên;
- giá trúng toàn liên danh;
- phần việc từng thành viên nếu có;
- trúng một lô, trượt lô khác;
- tạo hợp đồng;
- đại diện ký;
- danh sách thành viên;
- trách nhiệm;
- phụ lục;
- thay đổi thành viên sau trúng thầu;
- Word/Excel/báo cáo/quyết định/hợp đồng hiển thị đúng.

---

# 11. CÁC GIAI ĐOẠN CỦA GÓI THẦU

## 11.1. Tạo gói thầu

- tạo mới;
- trường bắt buộc;
- mã trùng;
- giá gói;
- thời gian;
- nguồn vốn;
- nhân viên;
- tổ chuyên gia;
- tổ thẩm định;
- phần lô;
- phương thức;
- phương pháp;
- loại hợp đồng;
- reload;
- quyền.

## 11.2. Danh mục hàng hóa

- thêm thủ công;
- sửa;
- xóa;
- import Excel;
- preview;
- xác nhận;
- hủy;
- import lại;
- file sai;
- sai sheet;
- thiếu cột;
- cột thừa;
- số lượng sai;
- đơn giá sai;
- thành tiền sai;
- mã trùng;
- không gắn lô;
- gắn sai lô;
- một lô một mặt hàng;
- một lô nhiều mặt hàng;
- không phân lô;
- export;
- reload.

## 11.3. Hồ sơ mời thầu và phát hành

- số tờ trình;
- ngày trình;
- số quyết định;
- ngày quyết định;
- thời gian đăng;
- đóng thầu;
- bảo đảm;
- hiệu lực;
- ngày sai thứ tự;
- thiếu trường;
- sửa trước phát hành;
- khóa sau phát hành;
- tải tài liệu;
- sinh tài liệu;
- mở file kiểm tra.

## 11.4. Gia hạn

- gia hạn một lần;
- nhiều lần;
- lý do;
- thời điểm không hợp lệ;
- reload;
- quyền;
- tài khoản trái quyền;
- thông báo nếu có.

## 11.5. Mở thầu

- trước thời điểm;
- đúng/sau thời điểm;
- không nhà thầu;
- một nhà thầu;
- nhiều nhà thầu;
- nhà thầu trùng;
- nhà thầu độc lập;
- liên danh;
- giá dự thầu;
- giảm giá;
- hiệu lực;
- bảo đảm;
- thời gian thực hiện;
- phân lô;
- nhiều lô;
- lưu nháp;
- lưu chính thức;
- sửa sau lưu;
- reload.

## 11.6. Một giai đoạn một túi hồ sơ

- hợp lệ;
- năng lực;
- kỹ thuật;
- tài chính;
- giá dự thầu;
- giảm giá;
- hiệu chỉnh;
- sai lệch;
- giá đánh giá;
- giá xếp hạng;
- giá đề nghị trúng;
- đạt;
- không đạt;
- thiếu dữ liệu;
- nhiều nhà thầu;
- đồng hạng;
- giá cao hơn giá gói;
- giá bằng 50%;
- giá dưới 50%;
- chấp thuận dưới 50%;
- không chấp thuận dưới 50%;
- nhà thầu không hợp lệ nhưng giá thấp nhất;
- báo cáo tổng quát;
- báo cáo chi tiết;
- từng nhà thầu;
- từng lô;
- lưu nháp;
- hoàn tất;
- quyền tổ chuyên gia;
- người không được phân công.

## 11.7. Một giai đoạn hai túi hồ sơ

### Kỹ thuật

- mở đề xuất kỹ thuật;
- hợp lệ;
- năng lực;
- kỹ thuật;
- đạt;
- không đạt;
- chỉ nhà thầu đạt mới sang tài chính;
- không lộ dữ liệu tài chính sớm;
- quyền.

### Tài chính

- mở đề xuất tài chính;
- giá dự thầu;
- giảm giá;
- hiệu chỉnh;
- giá đánh giá;
- xếp hạng;
- giá đề nghị trúng;
- giá bằng 50%;
- giá dưới 50%;
- chấp thuận;
- không chấp thuận;
- nhà thầu trượt kỹ thuật không được chọn;
- từng lô;
- báo cáo;
- kết luận.

## 11.8. Thẩm định và phê duyệt

- báo cáo đánh giá;
- báo cáo thẩm định;
- số văn bản;
- ngày;
- quyết định;
- nhà thầu trúng;
- nhà thầu không trúng;
- liên danh trúng;
- giá trúng;
- thời gian;
- hợp đồng;
- nhiều nhà thầu trúng các lô khác nhau;
- không có nhà thầu đáp ứng;
- chưa hoàn thành đánh giá;
- trái quyền;
- thay đổi sau phê duyệt;
- reload.

## 11.9. Hủy thầu

Kiểm tra tại các thời điểm hệ thống cho phép:

- trước phát hành;
- sau phát hành;
- sau mở thầu;
- trong đánh giá;
- trước phê duyệt;
- sau phê duyệt nếu được hỗ trợ.

Kiểm tra:

- số quyết định;
- ngày;
- lý do;
- trạng thái khóa;
- dữ liệu liên quan;
- quyền;
- hủy thao tác;
- reload;
- không tiếp tục bước không hợp lệ.

## 11.10. Đấu thầu lại

- tạo từ gói bị hủy;
- liên kết gói gốc;
- sao chép đúng dữ liệu;
- không sao chép dữ liệu không được phép;
- chỉnh sửa gói mới;
- vòng đời độc lập;
- lịch sử;
- quyền;
- không thay đổi gói cũ.

## 11.11. Hợp đồng

- tạo từ kết quả;
- chủ đầu tư;
- nhà thầu độc lập;
- liên danh;
- gói;
- phần lô;
- giá trị;
- loại hợp đồng;
- ngày ký;
- thời gian;
- nhân viên;
- trạng thái;
- giá không phù hợp kết quả;
- nhiều lô;
- nhiều hợp đồng nếu có;
- đang thực hiện;
- tạm dừng nếu có;
- hoàn thành;
- thanh lý;
- ngày thanh lý;
- sửa;
- xóa;
- quyền;
- reload.

---

# 12. BÁO CÁO ĐÁNH GIÁ CHI TIẾT

Kiểm thử sâu:

- mở đúng luồng;
- dropdown nhà thầu;
- chuyển nhà thầu;
- chuyển phần lô;
- tab tính hợp lệ;
- tab năng lực và kinh nghiệm;
- tab kỹ thuật;
- tab tài chính;
- hàng hóa dự thầu nếu có;
- dữ liệu không lẫn giữa nhà thầu;
- dữ liệu không lẫn giữa phần lô;
- nhà thầu độc lập;
- liên danh;
- giá dưới 50%;
- lựa chọn chấp thuận/không chấp thuận;
- lưu nháp;
- hoàn tất;
- quay về tổng quát;
- đồng bộ kết luận;
- khóa theo trạng thái;
- import;
- export;
- reload;
- đăng nhập lại;
- nhiều người sửa;
- version conflict;
- tài khoản không được phân công.

Không bổ sung quy trình làm rõ giá thấp nhiều bước.

---

# 13. MA TRẬN KIỂM THỬ GIÁ DƯỚI 50%

Tạo tối thiểu các test case:

| ID | Trường hợp | Kết quả mong đợi |
|---|---|---|
| LP-01 | Giá bằng 100% | Không cảnh báo dưới 50% |
| LP-02 | Giá trên 50% | Không cảnh báo |
| LP-03 | Giá bằng đúng 50% | Không cảnh báo |
| LP-04 | Giá nhỏ hơn 50% đúng 1 đồng | Hiển thị cảnh báo và bắt buộc quyết định |
| LP-05 | Giá 49% | Hiển thị cảnh báo |
| LP-06 | Giá 30% | Hiển thị cảnh báo |
| LP-07 | Giá rất nhỏ nhưng dương | Xử lý đúng |
| LP-08 | Giá bằng 0 | Xử lý theo validation thực tế, không bỏ lọt |
| LP-09 | Giá âm | Bị từ chối |
| LP-10 | Giảm giá làm giá xuống dưới 50% | Rule dùng đúng giá sau giảm nếu nghiệp vụ quy định |
| LP-11 | Hiệu chỉnh làm giá xuống dưới 50% | Rule dùng đúng giá sau hiệu chỉnh nếu nghiệp vụ quy định |
| LP-12 | Một phần lô dưới 50% | Chỉ cảnh báo đúng phần lô |
| LP-13 | Toàn gói dưới 50% | Cảnh báo đúng toàn gói |
| LP-14 | Liên danh dưới 50% | Cảnh báo ở cấp liên danh |
| LP-15 | Dưới 50%, chưa chọn | Không được lưu/hoàn tất |
| LP-16 | Dưới 50%, chọn Chấp thuận | Vẫn được xếp hạng nếu tiêu chí khác đạt |
| LP-17 | Dưới 50%, chọn Không chấp thuận | Tự ghi lý do và loại khỏi xếp hạng |
| LP-18 | Chuyển từ Không chấp thuận sang Chấp thuận | Xóa lý do loại tự động và tính lại |
| LP-19 | Sửa giá lên đúng 50% | Xóa cảnh báo/quyết định cũ không còn tác dụng |
| LP-20 | Sửa giá từ trên 50% xuống dưới 50% | Bắt buộc quyết định |
| LP-21 | Reload sau Chấp thuận | Dữ liệu giữ nguyên |
| LP-22 | Reload sau Không chấp thuận | Dữ liệu giữ nguyên |
| LP-23 | Đăng nhập lại | Dữ liệu giữ nguyên |
| LP-24 | Gọi API bỏ qua quyết định | Backend xử lý đúng trách nhiệm hiện có |
| LP-25 | Hai người sửa quyết định | Xử lý xung đột đúng |
| LP-26 | Báo cáo tổng quát | Thể hiện đúng quyết định |
| LP-27 | Báo cáo chi tiết | Thể hiện đúng quyết định |
| LP-28 | Export Word/Excel | Thể hiện đúng kết quả |
| LP-29 | Không chấp thuận một lô | Không làm sai lô khác |
| LP-30 | Nhà thầu xếp sau | Được xếp hạng lại đúng |

Ví dụ với giá làm căn cứ `1.000.000.000` đồng:

- `1.000.000.000`;
- `500.000.001`;
- `500.000.000`;
- `499.999.999`;
- `490.000.000`;
- `300.000.000`;
- `1`;
- `0`;
- `-1`.

Bổ sung test tự động tại các biên:

```text
price = reference_price * 0.5
price = reference_price * 0.5 - 1
price = reference_price * 0.5 + 1
```

Không sử dụng phép so sánh float thiếu chính xác.

---

# 14. MA TRẬN KIỂM THỬ LIÊN DANH

Tạo tối thiểu:

| ID | Trường hợp | Kết quả mong đợi |
|---|---|---|
| JV-01 | Hai thành viên hợp lệ | Tạo liên danh thành công |
| JV-02 | Hơn hai thành viên | Lưu đúng |
| JV-03 | Không có thành viên đứng đầu | Xử lý đúng rule |
| JV-04 | Hai thành viên đứng đầu | Bị chặn nếu rule chỉ cho một |
| JV-05 | Thành viên trùng | Bị chặn |
| JV-06 | Tổng tỷ lệ bằng 100% | Xử lý đúng |
| JV-07 | Tổng tỷ lệ dưới 100% | Xử lý đúng rule |
| JV-08 | Tổng tỷ lệ trên 100% | Xử lý đúng rule |
| JV-09 | Tỷ lệ âm | Bị chặn |
| JV-10 | Thành viên dự độc lập và liên danh cùng gói | Xử lý đúng rule |
| JV-11 | Hai liên danh có thành viên trùng | Xử lý đúng rule |
| JV-12 | Một thành viên không hợp lệ | Kết luận liên danh đúng |
| JV-13 | Thành viên đứng đầu không hợp lệ | Kết luận đúng |
| JV-14 | Liên danh dự một lô | Dữ liệu đúng |
| JV-15 | Liên danh dự nhiều lô | Dữ liệu đúng |
| JV-16 | Trúng một lô, trượt lô khác | Kết quả đúng |
| JV-17 | Giá dưới 50%, Chấp thuận | Vẫn được xếp hạng nếu đạt tiêu chí khác |
| JV-18 | Giá dưới 50%, Không chấp thuận | Bị loại đúng |
| JV-19 | Phê duyệt liên danh trúng | Hiển thị đủ thành viên |
| JV-20 | Tạo hợp đồng liên danh | Dữ liệu đúng |
| JV-21 | Export báo cáo | Không mất thông tin thành viên |
| JV-22 | Reload và đăng nhập lại | Dữ liệu giữ nguyên |

---

# 15. IMPORT, EXPORT VÀ TÀI LIỆU

## 15.1. Import

- file hợp lệ;
- file rỗng;
- file hỏng;
- sai định dạng;
- sai sheet;
- thiếu cột;
- cột thừa;
- Unicode;
- số dạng text;
- công thức Excel;
- hàng trống;
- dòng trùng;
- file lớn;
- preview;
- hủy;
- import lặp;
- rollback khi lỗi;
- phân lô;
- liên danh nếu có import;
- không làm sai giá và tỷ lệ.

## 15.2. Export

Kiểm tra mọi định dạng có hỗ trợ:

- Word;
- Excel;
- PDF.

Xác minh:

- tên file;
- mở được;
- font tiếng Việt;
- căn lề;
- tiêu đề;
- bảng;
- số tiền;
- ngày;
- nhà thầu;
- liên danh;
- thành viên liên danh;
- phần lô;
- giá dưới 50%;
- quyết định Chấp thuận/Không chấp thuận;
- lý do không đạt;
- báo cáo tổng quát;
- báo cáo chi tiết;
- quyết định;
- hợp đồng.

Không chỉ kiểm tra HTTP 200. Phải mở hoặc phân tích file.

---

# 16. OFFLINE, ĐỒNG BỘ VÀ XUNG ĐỘT

Nếu ứng dụng có hỗ trợ:

- online;
- mất mạng trước lưu;
- mất mạng trong lưu;
- offline;
- mutation queue;
- khôi phục mạng;
- tự đồng bộ;
- retry;
- không tạo trùng;
- lỗi đồng bộ;
- version conflict;
- frontend đúng;
- backend đúng;
- PostgreSQL đúng;
- reload;
- đăng nhập lại;
- hai tab cùng sửa;
- hai tài khoản cùng sửa;
- một người chọn Chấp thuận, người khác chọn Không chấp thuận;
- xếp hạng không dùng dữ liệu cũ.

---

# 17. CHẤT LƯỢNG GIAO DIỆN VÀ TRẢI NGHIỆM

Ghi nhận và sửa lỗi thực tế như:

- nút không phản hồi;
- phải reload mới hoạt động;
- double click tạo trùng;
- modal không đóng;
- modal ngoài màn hình;
- dropdown sai;
- focus sai;
- loading vô hạn;
- báo thành công khi backend lỗi;
- dữ liệu cũ;
- sai định dạng tiền;
- sai định dạng ngày;
- chữ tràn;
- bảng không cuộn;
- nút bị che;
- thao tác khó hiểu;
- lỗi console;
- request lặp;
- API chậm;
- giao diện nhấp nháy;
- mất trạng thái;
- thông báo lỗi không rõ;
- accessibility cơ bản.

Riêng giá dưới 50%:

- cảnh báo phải dễ nhận biết;
- nút Chấp thuận/Không chấp thuận phải rõ;
- không thêm nhiều màn hình hoặc nhiều bước;
- không làm người dùng phải cung cấp chứng cứ;
- không yêu cầu phê duyệt riêng;
- thông báo phải ngắn gọn, dễ hiểu;
- không hiển thị cảnh báo ở giá bằng 50%;
- phải chỉ rõ nhà thầu hoặc phần lô đang cần xử lý.

Không tự ý thiết kế lại toàn bộ giao diện.

---

# 18. KIỂM TRA BẢO MẬT VÀ TOÀN VẸN DỮ LIỆU

Kiểm tra:

- authentication;
- authorization;
- IDOR;
- sửa URL;
- sửa request;
- workspace isolation;
- mass assignment;
- validation frontend/backend;
- XSS trong trường text;
- upload file;
- tên file nguy hiểm;
- path traversal;
- CSRF nếu phù hợp;
- token/session;
- dữ liệu nhạy cảm trong log;
- lỗi stack trace lộ ra giao diện;
- API không được tin dữ liệu quyết định từ client một cách mù quáng nếu backend có đủ dữ liệu để xác minh;
- không thể tự đặt mình là nhà thầu trúng qua request;
- không thể sửa kết quả đã khóa;
- không thể bỏ qua trạng thái gói thầu.

Không thay đổi kiến trúc bảo mật ngoài phạm vi cần thiết.

---

# 19. HIỆU NĂNG VÀ ĐỘ ỔN ĐỊNH

Kiểm tra:

- danh sách dữ liệu lớn;
- phân trang;
- tìm kiếm;
- lọc;
- N+1 query;
- request lặp;
- render lặp;
- tính xếp hạng nhiều nhà thầu;
- nhiều phần lô;
- nhiều thành viên liên danh;
- báo cáo dài;
- import file lớn;
- export file lớn;
- tốc độ reload;
- memory leak;
- thao tác nhanh liên tiếp;
- double submit;
- race condition.

Chỉ tối ưu khi có bằng chứng và không làm thay đổi nghiệp vụ.

---

# 20. CÁCH SỬA LỖI

Khi sửa:

- sửa nguyên nhân gốc;
- không che lỗi bằng workaround;
- không tắt validation hợp lệ;
- không bỏ phân quyền;
- không hard-code dữ liệu test;
- không thêm `sleep` tùy tiện;
- không tăng timeout để che race condition;
- không bỏ assertion;
- không nuốt exception;
- không sửa test để chấp nhận hành vi sai;
- không tạo module trùng;
- tái sử dụng kiến trúc hiện tại;
- giữ tương thích dữ liệu;
- thêm migration nếu cần;
- cập nhật frontend/backend/schema/sync đồng bộ;
- thêm test gần tầng phát sinh lỗi nhất.

Đối với giá dưới 50%:

- giữ luồng Chấp thuận/Không chấp thuận;
- không tạo workflow làm rõ;
- không tạo bước phê duyệt mới;
- không thay đổi mục tiêu đơn giản hóa trải nghiệm;
- chỉ sửa tính toán, validation, lưu dữ liệu, xếp hạng, hiển thị và báo cáo nếu sai.

---

# 21. TỰ ĐỘNG HÓA KIỂM THỬ

Sau khi kiểm tra thủ công bằng plugin:

1. tái sử dụng test Playwright hiện có;
2. mở rộng thay vì tạo trùng;
3. tách test hợp lý;
4. dùng `runId`;
5. tránh path tuyệt đối;
6. lưu fixture;
7. screenshot/video/trace khi thất bại;
8. chạy được trên CI;
9. cách ly hoặc dọn dữ liệu;
10. không phụ thuộc thứ tự ngẫu nhiên.

Gợi ý tổ chức:

```text
tests/e2e/
  auth/
  permissions/
  master-data/
  plans/
  packages/
  bidders/
  joint-ventures/
  lots/
  one-stage-one-envelope/
  one-stage-two-envelope/
  detailed-evaluation/
  low-price-decision/
  cancellation/
  rebidding/
  contracts/
  documents/
  sync/
```

Tên thư mục có thể điều chỉnh theo cấu trúc repo.

---

# 22. LỆNH KIỂM TRA

Sau mỗi lỗi:

- chạy test nhỏ nhất liên quan;
- chạy test module;
- chạy E2E đúng luồng;
- thao tác lại bằng trình duyệt.

Cuối nhiệm vụ, chạy các lệnh thực tế tương ứng, bao gồm khi tồn tại:

```bash
pytest -q
npm test
npm run lint:security
npm run audit:vendor
npm run build
npm run test:auth-shell
npm run test:lifecycle
npm run test:performance
```

Đồng thời kiểm tra các package con nếu repo là monorepo.

Nếu lệnh không tồn tại:

- ghi rõ;
- tìm lệnh tương đương;
- chạy lệnh thực tế;
- không tự kết luận đạt.

Nếu test cần PostgreSQL, browser, sandbox hoặc fixture, phải cấu hình và chạy thật.

---

# 23. ĐIỀU KIỆN HOÀN THÀNH

Chỉ kết luận hoàn thành khi:

- đã xác định mọi loại tài khoản;
- đã kiểm thử mọi vai trò;
- đã kiểm thử quyền cho phép và từ chối;
- đã lập ma trận module;
- đã lập ma trận gói thầu;
- đã kiểm thử mọi option thực tế;
- đã kiểm thử toàn bộ vòng đời;
- đã kiểm thử nhà thầu độc lập;
- đã kiểm thử liên danh;
- đã kiểm thử không phân lô;
- đã kiểm thử phân lô;
- đã kiểm thử 1G1T nếu có;
- đã kiểm thử 1G2T nếu có;
- đã kiểm thử nhiều nhà thầu;
- đã kiểm thử nhiều phần lô;
- đã kiểm thử giá bằng 50%;
- đã kiểm thử giá dưới 50%;
- đã kiểm thử Chấp thuận;
- đã kiểm thử Không chấp thuận;
- đã xác nhận không có workflow làm rõ phức tạp được thêm vào;
- đã kiểm thử hủy thầu;
- đã kiểm thử đấu thầu lại;
- đã kiểm thử hợp đồng đến hoàn thành/thanh lý;
- mọi lỗi được ghi;
- lỗi `ĐÃ SỬA` đã được retest bằng trình duyệt;
- đã bổ sung regression test;
- build thành công;
- test bắt buộc thành công;
- không còn lỗi JavaScript chưa giải thích;
- không còn request lỗi chưa giải thích;
- không còn test case `ĐANG KIỂM THỬ`;
- không còn lỗi `PHÁT HIỆN`, `ĐANG SỬA`, `CHỜ KIỂM TRA LẠI`;
- mục `BỊ CHẶN` có bằng chứng và nguyên nhân cụ thể.

Không tuyên bố “đã kiểm thử toàn bộ” khi còn `CHƯA KIỂM THỬ`.

---

# 24. BÁO CÁO CUỐI

Cập nhật:

```markdown
# TỔNG KẾT

- Branch:
- Commit ban đầu:
- Commit sau sửa:
- Plugin/MCP/skill:
- Số vai trò:
- Số module:
- Số test case:
- Đạt:
- Không đạt:
- Bị chặn:
- Tổng lỗi:
- Blocker:
- Critical:
- High:
- Medium:
- Low:
- Lỗi đã sửa:
- Lỗi chưa thể sửa:
- Test tự động bổ sung:
- Kết quả pytest:
- Kết quả frontend tests:
- Kết quả E2E:
- Kết quả build:
- Kết quả kiểm thử liên danh:
- Kết quả kiểm thử giá dưới 50%:
- Rủi ro còn lại:
```

Trong câu trả lời cuối cùng, trình bày:

1. công cụ trình duyệt đã dùng;
2. phạm vi đã kiểm thử;
3. loại tài khoản;
4. ma trận gói thầu;
5. trường hợp liên danh;
6. trường hợp giá dưới 50%;
7. lỗi phát hiện;
8. lỗi đã sửa;
9. file thay đổi;
10. test hồi quy;
11. kết quả từng lệnh;
12. trường hợp bị chặn;
13. đường dẫn `docs/USER_FLOW_TEST_AND_FIX_REPORT.md`.

Không trả lời chung chung.

---

# 25. LỆNH BẮT ĐẦU

Bắt đầu ngay:

1. kiểm tra branch và working tree;
2. đọc hướng dẫn repo;
3. kiểm tra plugin/MCP/skill trình duyệt;
4. khảo sát auth, role, policy;
5. khảo sát route và module;
6. khảo sát schema, migration, seed;
7. khảo sát Playwright và lifecycle tests;
8. khảo sát liên danh;
9. khảo sát rule giá dưới 50%;
10. tạo `docs/USER_FLOW_TEST_AND_FIX_REPORT.md`;
11. lập danh sách vai trò;
12. lập ma trận chức năng;
13. lập ma trận tổ hợp gói thầu;
14. lập ma trận liên danh;
15. lập ma trận giá dưới 50%;
16. khởi động ứng dụng;
17. mở bằng plugin trình duyệt;
18. bắt đầu từ đăng ký/đăng nhập;
19. thực hiện tuần tự;
20. gặp lỗi thì dừng, ghi, sửa, test lại;
21. chỉ tiếp tục sau khi test case lỗi đã đạt.

Không dừng ở bước lập kế hoạch.

Không tự ý bổ sung luồng làm rõ – cung cấp chứng cứ – đánh giá – phê duyệt riêng cho giá thấp bất thường.

Giữ đúng mục tiêu sản phẩm: **cảnh báo đơn giản, bắt buộc người đánh giá chọn Chấp thuận hoặc Không chấp thuận, sau đó hệ thống xử lý xếp hạng tương ứng.**
