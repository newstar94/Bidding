# Kế hoạch refactor BiddingFlow

Ngày lập: 12/07/2026

Trạng thái: Đã hoàn thành và đạt toàn bộ cổng kiểm thử

Quy ước: `V` ở đầu dòng là hạng mục đã hoàn thành và đạt kiểm thử.

## 1. Mục tiêu

- Làm rõ trách nhiệm giữa view, workflow, model, API và lớp lưu trữ.
- Tái sử dụng các bảng, form, modal và nghiệp vụ có cùng cấu trúc.
- Giảm các file và hàm quá dài, đặc biệt tại quy trình gói thầu.
- Hạn chế việc view trực tiếp thay đổi model hoặc lưu dữ liệu.
- Giữ nguyên hành vi, dữ liệu và giao diện hiện tại trong suốt quá trình refactor.
- Mỗi bước phải có kiểm thử bảo vệ và có thể hoàn tác độc lập.

## 2. Nguyên tắc thực hiện

1. Không refactor nhiều luồng nghiệp vụ lớn trong cùng một lần thay đổi.
2. Viết kiểm thử mô tả hành vi hiện tại trước khi tách code có rủi ro cao.
3. Ưu tiên tách hàm thuần và thành phần dùng chung trước khi di chuyển workflow.
4. Không thay đổi schema DB, tên trường hoặc payload API nếu không thật sự cần thiết.
5. Nếu thay đổi trường dữ liệu, phải cập nhật đầy đủ DB, schema contract, sync, Excel, Word và test theo `.agents/AGENTS.md`.
6. Sau mỗi giai đoạn phải chạy build, unit test, API test và các E2E liên quan.
7. Không viết lại toàn bộ ứng dụng và không chuyển framework trong đợt refactor này.

## 3. Hiện trạng cần xử lý

### 3.1. Frontend

- `views/subviews/goithau/GoiThauDetail.js` có hơn 3.200 dòng; một hàm đang dựng HTML, gắn sự kiện, cập nhật model và lưu dữ liệu.
- `controllers/workflows/BidEvaluationWorkflow.js` có phần render đánh giá hơn 1.000 dòng.
- `controllers/workflows/BidProcessWorkflow.js` trộn nghiệp vụ mở thầu, bảng nhập liệu, liên danh, tra cứu nhà thầu và lưu dữ liệu.
- Các bảng kế hoạch, gói thầu, chủ đầu tư, nhà thầu, chuyên gia và hợp đồng lặp logic phân trang, tìm kiếm, sắp xếp và trạng thái rỗng.
- Chủ đầu tư và nhà thầu lặp logic ngày áp dụng, địa chỉ, tra cứu thông tin, nạp form và validation.
- Kế hoạch, gói thầu và hợp đồng lặp logic quản lý/xóa phiên bản.
- Nhiều lời gọi `fetch()` trực tiếp, chưa có một lớp API thống nhất.
- Nhiều workflow phụ thuộc vào `window.*` và việc trộn module bằng `Object.assign`, khiến quan hệ phụ thuộc khó theo dõi.
- Giao diện chi tiết gói thầu sử dụng nhiều inline style, khó tái sử dụng và khó điều chỉnh đồng bộ.

### 3.2. Backend

- `backend/routes/sync_routes.py` có các route rất dài; `sync_api` đang đảm nhiệm cả xác thực, validate, ánh xạ, truy vấn và ghi DB.
- `backend/routes/routes_docx.py` trộn route, lọc dữ liệu nhà thầu, công thức, ánh xạ Word và xử lý template.
- Khai báo biến/tên trường Word đang xuất hiện tại nhiều nơi ở frontend và backend.
- Một số service Excel tạo các biểu mẫu theo cấu trúc gần giống nhau nhưng chưa dùng cấu hình chung.

### 3.3. Kiểm thử

- Unit test hiện bảo vệ tốt một số helper mới như phiên bản nhà thầu, đồng bộ, định dạng và validation.
- Các luồng lớn như mở thầu, đánh giá HSDT, kết quả lựa chọn nhà thầu và CRUD phiên bản chưa có đủ test trực tiếp.
- E2E có phạm vi còn hạn chế và một số test cần tài khoản/môi trường chạy thật.

## 4. Thứ tự ưu tiên thực hiện

## Giai đoạn 0 — Đóng băng hành vi bằng kiểm thử

Ưu tiên: Bắt buộc thực hiện đầu tiên

Mức rủi ro: Thấp

### Công việc

V Bổ sung test cho:
  V Tạo, sửa, xem và xóa phiên bản kế hoạch.
  V Tạo, sửa, xem và xóa phiên bản gói thầu.
  V Mở thầu với nhà thầu độc lập và liên danh.
  V Giữ nguyên tên liên danh khi tra cứu/lưu.
  V Đánh giá HSDT một giai đoạn một túi và hai túi hồ sơ.
  V Khóa/mở khóa báo cáo đánh giá.
  V Lưu kết quả lựa chọn nhà thầu và khôi phục gói thầu bị hủy.
  V Lựa chọn đúng phiên bản nhà thầu theo ngày nghiệp vụ.
  V Xuất Word dùng đúng ngày, phiên bản và tên nhà thầu.
V Ghi lại payload và state đầu ra của các workflow quan trọng để so sánh trước/sau refactor.

### Điều kiện hoàn thành

V Các hành vi quan trọng có test bảo vệ.
V Toàn bộ test hiện tại và test mới đều đạt.
V Chưa thay đổi cấu trúc nghiệp vụ hoặc giao diện.

## Giai đoạn 1 — Chuẩn hóa helper và lớp gọi API

Ưu tiên: 1

Mức rủi ro: Thấp

### Công việc

V Tạo `controllers/api/apiClient.js`:
  V `getJson()`.
  V `postJson()`.
  V `putJson()`.
  V `deleteJson()`.
  V Xử lý thống nhất lỗi HTTP, JSON lỗi, hết phiên đăng nhập và `AbortSignal`.
V Thay thế các lời gọi `fetch()` trực tiếp tại module partner và các bảng phân trang.
V Hợp nhất các helper lặp:
  V `escapeHtml`.
  V Ngày hiện tại dạng `yyyy-MM-dd`.
  V So sánh/chuẩn hóa mã định danh.
  V Định dạng và parse ngày.
  V Định dạng tiền tệ.
V Hợp nhất việc tải/cache tỉnh, phường trong `PartnerHelpers.js`, tránh hai luồng tải danh mục riêng biệt.

### Điều kiện hoàn thành

V Không thay đổi endpoint hoặc payload.
V Các module được chuyển đổi không còn tự xử lý lỗi API theo nhiều cách khác nhau.
V Build, unit test và API test đạt.

## Giai đoạn 2 — Tạo bộ thành phần bảng dùng chung

Ưu tiên: 2

Mức rủi ro: Trung bình

### Thành phần đề xuất

V `views/components/EntityTable.js`:
  V Tải trang từ server hoặc lọc dữ liệu local.
  V Tìm kiếm, sắp xếp và phân trang.
  V Trạng thái loading, empty và error.
  V Refresh sau thêm/sửa/xóa/import.
V `views/components/YearMonthFilter.js`:
  V Sinh danh sách năm/tháng.
  V Giữ lựa chọn hiện tại.
  V Lọc dữ liệu thống nhất.
V `views/components/VersionSelector.js`:
  V Tạo danh sách phiên bản.
  V Chọn phiên bản theo `rootId`.
  V Phát sự kiện đổi phiên bản.
V `views/components/EntityActions.js`:
  V Xem, sửa, xóa và xuất dữ liệu.

### Thứ tự chuyển đổi

V 1. Chuyên gia.
V 2. Chủ đầu tư.
V 3. Nhà thầu.
V 4. Hợp đồng.
V 5. Kế hoạch.
V 6. Gói thầu.

### Điều kiện hoàn thành

V Các bảng không còn lặp logic phân trang và trạng thái rỗng.
V Import, thêm, sửa và xóa làm bảng cập nhật ngay.
V Giao diện và thứ tự dữ liệu không thay đổi.

## Giai đoạn 3 — Chuẩn hóa form và CRUD thực thể có phiên bản

Ưu tiên: 3

Mức rủi ro: Trung bình

### Thành phần đề xuất

V `controllers/forms/FormBinder.js`:
  V Nạp object vào form theo cấu hình trường.
  V Thu thập form thành object.
  V Reset form và xóa trạng thái lỗi.
  V Chuẩn hóa giá trị trước khi lưu.
V `controllers/forms/FormValidation.js`:
  V Validate theo cấu hình.
  V Cuộn và focus trường lỗi đầu tiên.
  V Quản lý thông báo lỗi thống nhất.
V `controllers/domain/VersionedEntityService.js`:
  V Tìm toàn bộ phiên bản theo `rootId`.
  V Tạo phiên bản tiếp theo.
  V Đánh dấu `isLatest`.
  V Xóa phiên bản mới nhất hoặc toàn bộ.
  V Kiểm tra quan hệ trước khi xóa.
V `controllers/domain/MutationService.js`:
  V Cập nhật model.
  V Ghi IndexedDB.
  V Đưa thay đổi/xóa vào hàng chờ đồng bộ trước lần `await` đầu tiên.
  V Đồng bộ server.
  V Refresh các view phụ thuộc.

### Thứ tự áp dụng

V 1. Chủ đầu tư và nhà thầu.
V 2. Hợp đồng.
V 3. Kế hoạch.
V 4. Gói thầu.

### Điều kiện hoàn thành

V Workflow không còn tự lặp quy trình model → persist → sync → refresh tại các luồng CRUD thực thể có phiên bản.
V Logic tạo/xóa phiên bản chỉ còn một nguồn triển khai.
V Dữ liệu cũ và dữ liệu mới cho kết quả giống nhau theo bộ kiểm thử hiện tại.

## Giai đoạn 4 — Hợp nhất phần dùng chung của chủ đầu tư và nhà thầu

Ưu tiên: 4

Mức rủi ro: Trung bình

### Thành phần đề xuất

V `controllers/partners/PartnerFormController.js`:
  V Mã định danh và mã số thuế.
  V Ngày áp dụng.
  V Địa chỉ chi tiết, phường và tỉnh/thành phố.
  V Tra cứu theo thứ tự DB → MuaSamCong → VietQR.
  V Nạp và lưu thông tin liên hệ/ngân hàng.
V Cấu hình riêng cho chủ đầu tư và nhà thầu chỉ chứa:
  V ID trường form.
  V Tên trường model.
  V Các trường bắt buộc.
  V Các trường riêng như dấu nhà thầu hoặc cơ quan chủ quản.

### Điều kiện hoàn thành

V Không còn hai bản triển khai riêng cho địa chỉ, ngày áp dụng và tra cứu đối tác.
V Mã số thuế chủ đầu tư vẫn là tùy chọn.
V Số tài khoản và nơi mở tài khoản nhà thầu vẫn là tùy chọn.

## Giai đoạn 5 — Tách quy trình chi tiết gói thầu

Ưu tiên: 5

Mức rủi ro: Cao

### Cấu trúc đề xuất

```text
features/packages/detail/
V ├── PackageDetailCoordinator.js
V ├── PackageDetailState.js
V ├── PackageTabs.js
V ├── panels/
V │   ├── PreparationPanel.js
V │   ├── PreparationDetailsPanel.js
V │   ├── InvitationPanel.js
V │   ├── OpeningPanel.js
V │   ├── TechnicalEvaluationPanel.js
V │   ├── FinancialOpeningPanel.js
V │   ├── FinancialEvaluationPanel.js
V │   ├── AwardResultPanel.js
V │   ├── AwardResultDetailsPanel.js
V │   └── CancellationPanel.js
V └── components/
V     ├── PackageSummary.js
V     ├── BidderTable.js
V     ├── JointVentureModal.js
V     ├── EvaluationConclusion.js
V     ├── EvaluationPanel.js
V     └── WorkflowActions.js
```

### Nguyên tắc tách

V `PackageDetailCoordinator` quyết định tab và trạng thái workflow, không dựng HTML chi tiết.
V Mỗi panel chỉ render và phát sự kiện nghiệp vụ.
V Service nghiệp vụ chịu trách nhiệm validate, cập nhật model và lưu dữ liệu.
V View không được gọi `persistData()` trực tiếp.
V Modal liên danh và link nhà thầu dùng chung một component.
V Tách lần lượt từng panel, không thay toàn bộ `GoiThauDetail.js` cùng lúc.

### Thứ tự tách

V 1. Thông tin gói thầu.
V 2. Hủy/khôi phục gói thầu.
V 3. Kết quả lựa chọn nhà thầu.
V 4. Mở thầu.
V 5. Đánh giá kỹ thuật.
V 6. Mở và đánh giá tài chính.

### Điều kiện hoàn thành

V `GoiThauDetail.js` chỉ còn vai trò điều phối hoặc được thay thế hoàn toàn.
V Không còn thao tác ghi DB nằm trong view.
V Tất cả luồng nghiệp vụ được test trước và sau khi tách.

## Giai đoạn 6 — Chuẩn hóa Word, Excel và schema metadata

Ưu tiên: 6

Mức rủi ro: Cao

### Công việc

V Xây dựng một manifest chuẩn mô tả:
  V Bảng dữ liệu.
  V Tên trường DB và ứng dụng.
  V Nhãn hiển thị.
  V Kiểu dữ liệu.
  V Quy tắc định dạng Word/Excel.
  V Trường ngày thuần và trường ngày giờ.
V Sinh tự động từ manifest:
  V `schemaContract.js`.
  V Danh sách biến Word frontend.
  V Default Word mappings backend.
  V Cấu hình cột Excel áp dụng được.
V Tách `routes_docx.py` thành:
  V Route export/template.
  V Context builder.
  V Bid/result filtering.
  V Mapping service.
  V Formula evaluator.
V Hợp nhất các builder Excel có cùng cấu trúc bằng cấu hình cột.

### Điều kiện hoàn thành

V Một trường không cần khai báo thủ công tại nhiều nơi.
V Ngày, tiền tệ, hình ảnh và phiên bản nhà thầu được định dạng nhất quán.
V Test Word và Excel đạt với cả nhà thầu độc lập và liên danh.

## Giai đoạn 7 — Tách backend sync thành service/repository

Ưu tiên: 7

Mức rủi ro: Cao

### Cấu trúc đề xuất

```text
backend/sync/
├── service.py
├── repository.py
├── validator.py
├── serializer.py
├── ownership.py
├── pagination.py
└── dashboard_summary.py
```

### Công việc

V Route chỉ đọc request, xác thực, gọi service và trả response.
V Repository quản lý SQL và transaction.
V Validator xử lý định dạng, ownership và quan hệ cha/con.
V Serializer xử lý ánh xạ DB ↔ JSON.
V Service quản lý sync version, mutation, conflict và websocket event.
V Tách pagination và dashboard summary khỏi route đồng bộ.

### Điều kiện hoàn thành

V Không còn route dài hàng trăm dòng.
V Transaction và rollback có test riêng.
V Đồng bộ đầy đủ, đồng bộ delta, xóa và dữ liệu chờ đồng bộ cho kết quả như trước.

## Giai đoạn 8 — Giảm global state và chuẩn hóa command registry

Ưu tiên: 8

Mức rủi ro: Trung bình

### Công việc

V Dùng command registry làm đường gọi hành động chính.
V Loại bỏ dần các hàm `window.*` không còn được HTML hoặc module cũ sử dụng.
V Thay `Object.assign` lên prototype bằng dependency/module đăng ký rõ ràng.
V Đưa cache ngày nghỉ, địa giới và dữ liệu modal vào service/state có tên rõ ràng.
V Chỉ giữ global bridge cần thiết trong giai đoạn tương thích, có danh sách và ngày loại bỏ.

### Điều kiện hoàn thành

V Có thể tìm được nơi định nghĩa và nơi sử dụng của mỗi command bằng tìm kiếm tĩnh.
V Không còn phụ thuộc ngầm giữa các module qua `window` ngoài bridge được cho phép.

## Giai đoạn 9 — Chuẩn hóa CSS và dọn code cũ

Ưu tiên: 9

Mức rủi ro: Thấp đến trung bình

### Công việc

V Chuyển inline style lặp lại thành class CSS/component.
V Chuẩn hóa button, badge, field grid, table cell và panel card.
V Loại bỏ helper, handler và CSS không còn tham chiếu sau refactor.
V Chỉ xóa code sau khi đã kiểm tra import động, command registry và `data-bf-action`.
V Bổ sung ESLint hoặc công cụ kiểm tra tương đương cho JavaScript.
V Bổ sung kiểm tra format/lint Python phù hợp với dự án.

### Điều kiện hoàn thành

V Build production không chứa module cũ không còn sử dụng.
V Không còn selector CSS chết được xác nhận.
V `npm run check` bao gồm lint, build và test.
V `npm run check` đạt: 115 unit test và 54 API test.
V Playwright đạt 7/7 E2E với tài khoản quản trị ở chế độ quản lý.

## 5. Thứ tự triển khai rút gọn

V 1. Bổ sung test bảo vệ hành vi.
V 2. API client và helper dùng chung.
V 3. Bảng, bộ lọc và selector phiên bản dùng chung.
V 4. Form binder, validation và version service.
V 5. Hợp nhất form chủ đầu tư/nhà thầu.
V 6. Tách từng panel của chi tiết gói thầu.
V 7. Chuẩn hóa manifest Word/Excel/schema.
V 8. Tách backend sync.
V 9. Giảm `window.*`, chuẩn hóa CSS và xóa code cũ.

## 6. Kiểm thử bắt buộc sau mỗi giai đoạn

V `npm run build`.
V `npm run test:unit`.
V `npm run test:api`.
V E2E cho màn hình hoặc workflow vừa thay đổi.
V Kiểm tra F5 tại trang danh sách và trang chi tiết.
V Kiểm tra thêm, sửa, xóa và import cập nhật giao diện ngay.
V Kiểm tra IndexedDB, hàng chờ đồng bộ và SQLite cho cùng một bản ghi.
V Kiểm tra xuất Word với đúng phiên bản nhà thầu/chủ đầu tư theo ngày nghiệp vụ.

## 7. Tiêu chí dừng hoặc hoàn tác

Phải dừng giai đoạn và hoàn tác phần thay đổi nếu xảy ra một trong các trường hợp:

- Dữ liệu hiển thị khác với trước refactor khi DB không đổi.
- Phải F5 mới thấy dữ liệu sau thêm/sửa/xóa.
- Bản ghi hợp lệ bị đưa vào lỗi đồng bộ.
- Phiên bản nhà thầu/chủ đầu tư bị chọn sai theo ngày nghiệp vụ.
- Word hoặc Excel thay đổi dữ liệu đầu ra ngoài phạm vi đã duyệt.
- Thời gian tải trang/F5 tăng đáng kể so với baseline.

## 8. Đề xuất phê duyệt triển khai

Nên phê duyệt trước Giai đoạn 0 đến Giai đoạn 4 vì đây là các bước tạo nền tảng, có thể triển khai tăng dần và rủi ro được kiểm soát.

Giai đoạn 5 đến Giai đoạn 8 cần được duyệt riêng trước khi bắt đầu vì tác động trực tiếp đến workflow gói thầu, Word và đồng bộ dữ liệu.

