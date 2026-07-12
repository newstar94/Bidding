# Kế hoạch refactor BiddingFlow

Ngày lập: 12/07/2026

Trạng thái: Chờ xem xét và phê duyệt

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

- Bổ sung test cho:
  - Tạo, sửa, xem và xóa phiên bản kế hoạch.
  - Tạo, sửa, xem và xóa phiên bản gói thầu.
  - Mở thầu với nhà thầu độc lập và liên danh.
  - Giữ nguyên tên liên danh khi tra cứu/lưu.
  - Đánh giá HSDT một giai đoạn một túi và hai túi hồ sơ.
  - Khóa/mở khóa báo cáo đánh giá.
  - Lưu kết quả lựa chọn nhà thầu và khôi phục gói thầu bị hủy.
  - Lựa chọn đúng phiên bản nhà thầu theo ngày nghiệp vụ.
  - Xuất Word dùng đúng ngày, phiên bản và tên nhà thầu.
- Ghi lại payload và state đầu ra của các workflow quan trọng để so sánh trước/sau refactor.

### Điều kiện hoàn thành

- Các hành vi quan trọng có test bảo vệ.
- Toàn bộ test hiện tại và test mới đều đạt.
- Chưa thay đổi cấu trúc nghiệp vụ hoặc giao diện.

## Giai đoạn 1 — Chuẩn hóa helper và lớp gọi API

Ưu tiên: 1

Mức rủi ro: Thấp

### Công việc

- Tạo `controllers/api/apiClient.js`:
  - `getJson()`.
  - `postJson()`.
  - `putJson()`.
  - `deleteJson()`.
  - Xử lý thống nhất lỗi HTTP, JSON lỗi, hết phiên đăng nhập và `AbortSignal`.
- Thay thế dần các lời gọi `fetch()` trực tiếp, bắt đầu từ module partner và các bảng phân trang.
- Hợp nhất các helper lặp:
  - `escapeHtml`.
  - Ngày hiện tại dạng `yyyy-MM-dd`.
  - So sánh/chuẩn hóa mã định danh.
  - Định dạng và parse ngày.
  - Định dạng tiền tệ.
- Hợp nhất việc tải/cache tỉnh, phường trong `PartnerHelpers.js`, tránh hai luồng tải danh mục riêng biệt.

### Điều kiện hoàn thành

- Không thay đổi endpoint hoặc payload.
- Các module được chuyển đổi không còn tự xử lý lỗi API theo nhiều cách khác nhau.
- Build, unit test và API test đạt.

## Giai đoạn 2 — Tạo bộ thành phần bảng dùng chung

Ưu tiên: 2

Mức rủi ro: Trung bình

### Thành phần đề xuất

- `views/components/EntityTable.js`:
  - Tải trang từ server hoặc lọc dữ liệu local.
  - Tìm kiếm, sắp xếp và phân trang.
  - Trạng thái loading, empty và error.
  - Refresh sau thêm/sửa/xóa/import.
- `views/components/YearMonthFilter.js`:
  - Sinh danh sách năm/tháng.
  - Giữ lựa chọn hiện tại.
  - Lọc dữ liệu thống nhất.
- `views/components/VersionSelector.js`:
  - Tạo danh sách phiên bản.
  - Chọn phiên bản theo `rootId`.
  - Phát sự kiện đổi phiên bản.
- `views/components/EntityActions.js`:
  - Xem, sửa, xóa và xuất dữ liệu.

### Thứ tự chuyển đổi

1. Chuyên gia.
2. Chủ đầu tư.
3. Nhà thầu.
4. Hợp đồng.
5. Kế hoạch.
6. Gói thầu.

### Điều kiện hoàn thành

- Các bảng không còn lặp logic phân trang và trạng thái rỗng.
- Import, thêm, sửa và xóa làm bảng cập nhật ngay.
- Giao diện và thứ tự dữ liệu không thay đổi.

## Giai đoạn 3 — Chuẩn hóa form và CRUD thực thể có phiên bản

Ưu tiên: 3

Mức rủi ro: Trung bình

### Thành phần đề xuất

- `controllers/forms/FormBinder.js`:
  - Nạp object vào form theo cấu hình trường.
  - Thu thập form thành object.
  - Reset form và xóa trạng thái lỗi.
  - Chuẩn hóa giá trị trước khi lưu.
- `controllers/forms/FormValidation.js`:
  - Validate theo cấu hình.
  - Cuộn và focus trường lỗi đầu tiên.
  - Quản lý thông báo lỗi thống nhất.
- `controllers/domain/VersionedEntityService.js`:
  - Tìm toàn bộ phiên bản theo `rootId`.
  - Tạo phiên bản tiếp theo.
  - Đánh dấu `isLatest`.
  - Xóa phiên bản mới nhất hoặc toàn bộ.
  - Kiểm tra quan hệ trước khi xóa.
- `controllers/domain/MutationService.js`:
  - Cập nhật model.
  - Ghi IndexedDB.
  - Đưa vào hàng chờ đồng bộ.
  - Đồng bộ server.
  - Refresh các view phụ thuộc.

### Thứ tự áp dụng

1. Chủ đầu tư và nhà thầu.
2. Hợp đồng.
3. Kế hoạch.
4. Gói thầu.

### Điều kiện hoàn thành

- Workflow không còn tự lặp quy trình model → persist → sync → refresh.
- Logic phiên bản chỉ còn một nguồn triển khai.
- Dữ liệu cũ và dữ liệu mới cho kết quả giống nhau.

## Giai đoạn 4 — Hợp nhất phần dùng chung của chủ đầu tư và nhà thầu

Ưu tiên: 4

Mức rủi ro: Trung bình

### Thành phần đề xuất

- `controllers/partners/PartnerFormController.js`:
  - Mã định danh và mã số thuế.
  - Ngày áp dụng.
  - Địa chỉ chi tiết, phường và tỉnh/thành phố.
  - Tra cứu theo thứ tự DB → MuaSamCong → VietQR.
  - Nạp và lưu thông tin liên hệ/ngân hàng.
- Cấu hình riêng cho chủ đầu tư và nhà thầu chỉ chứa:
  - ID trường form.
  - Tên trường model.
  - Các trường bắt buộc.
  - Các trường riêng như dấu nhà thầu hoặc cơ quan chủ quản.

### Điều kiện hoàn thành

- Không còn hai bản triển khai riêng cho địa chỉ, ngày áp dụng và tra cứu đối tác.
- Mã số thuế chủ đầu tư vẫn là tùy chọn.
- Số tài khoản và nơi mở tài khoản nhà thầu vẫn là tùy chọn.

## Giai đoạn 5 — Tách quy trình chi tiết gói thầu

Ưu tiên: 5

Mức rủi ro: Cao

### Cấu trúc đề xuất

```text
features/packages/detail/
├── PackageDetailCoordinator.js
├── PackageDetailState.js
├── PackageTabs.js
├── panels/
│   ├── PreparationPanel.js
│   ├── InvitationPanel.js
│   ├── OpeningPanel.js
│   ├── TechnicalEvaluationPanel.js
│   ├── FinancialOpeningPanel.js
│   ├── FinancialEvaluationPanel.js
│   ├── AwardResultPanel.js
│   └── CancellationPanel.js
└── components/
    ├── PackageSummary.js
    ├── BidderTable.js
    ├── JointVentureModal.js
    ├── EvaluationConclusion.js
    └── WorkflowActions.js
```

### Nguyên tắc tách

- `PackageDetailCoordinator` quyết định tab và trạng thái workflow, không dựng HTML chi tiết.
- Mỗi panel chỉ render và phát sự kiện nghiệp vụ.
- Service nghiệp vụ chịu trách nhiệm validate, cập nhật model và lưu dữ liệu.
- View không được gọi `persistData()` trực tiếp.
- Modal liên danh và link nhà thầu dùng chung một component.
- Tách lần lượt từng panel, không thay toàn bộ `GoiThauDetail.js` cùng lúc.

### Thứ tự tách

1. Thông tin gói thầu.
2. Hủy/khôi phục gói thầu.
3. Kết quả lựa chọn nhà thầu.
4. Mở thầu.
5. Đánh giá kỹ thuật.
6. Mở và đánh giá tài chính.

### Điều kiện hoàn thành

- `GoiThauDetail.js` chỉ còn vai trò điều phối hoặc được thay thế hoàn toàn.
- Không còn thao tác ghi DB nằm trong view.
- Tất cả luồng nghiệp vụ được test trước và sau khi tách.

## Giai đoạn 6 — Chuẩn hóa Word, Excel và schema metadata

Ưu tiên: 6

Mức rủi ro: Cao

### Công việc

- Xây dựng một manifest chuẩn mô tả:
  - Bảng dữ liệu.
  - Tên trường DB và ứng dụng.
  - Nhãn hiển thị.
  - Kiểu dữ liệu.
  - Quy tắc định dạng Word/Excel.
  - Trường ngày thuần và trường ngày giờ.
- Sinh tự động từ manifest:
  - `schemaContract.js`.
  - Danh sách biến Word frontend.
  - Default Word mappings backend.
  - Cấu hình cột Excel áp dụng được.
- Tách `routes_docx.py` thành:
  - Route export/template.
  - Context builder.
  - Bid/result filtering.
  - Mapping service.
  - Formula evaluator.
- Hợp nhất các builder Excel có cùng cấu trúc bằng cấu hình cột.

### Điều kiện hoàn thành

- Một trường không cần khai báo thủ công tại nhiều nơi.
- Ngày, tiền tệ, hình ảnh và phiên bản nhà thầu được định dạng nhất quán.
- Test Word và Excel đạt với cả nhà thầu độc lập và liên danh.

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

- Route chỉ đọc request, xác thực, gọi service và trả response.
- Repository quản lý SQL và transaction.
- Validator xử lý định dạng, ownership và quan hệ cha/con.
- Serializer xử lý ánh xạ DB ↔ JSON.
- Service quản lý sync version, mutation, conflict và websocket event.
- Tách pagination và dashboard summary khỏi route đồng bộ.

### Điều kiện hoàn thành

- Không còn route dài hàng trăm dòng.
- Transaction và rollback có test riêng.
- Đồng bộ đầy đủ, đồng bộ delta, xóa và dữ liệu chờ đồng bộ cho kết quả như trước.

## Giai đoạn 8 — Giảm global state và chuẩn hóa command registry

Ưu tiên: 8

Mức rủi ro: Trung bình

### Công việc

- Dùng command registry làm đường gọi hành động chính.
- Loại bỏ dần các hàm `window.*` không còn được HTML hoặc module cũ sử dụng.
- Thay `Object.assign` lên prototype bằng dependency/module đăng ký rõ ràng.
- Đưa cache ngày nghỉ, địa giới và dữ liệu modal vào service/state có tên rõ ràng.
- Chỉ giữ global bridge cần thiết trong giai đoạn tương thích, có danh sách và ngày loại bỏ.

### Điều kiện hoàn thành

- Có thể tìm được nơi định nghĩa và nơi sử dụng của mỗi command bằng tìm kiếm tĩnh.
- Không còn phụ thuộc ngầm giữa các module qua `window` ngoài bridge được cho phép.

## Giai đoạn 9 — Chuẩn hóa CSS và dọn code cũ

Ưu tiên: 9

Mức rủi ro: Thấp đến trung bình

### Công việc

- Chuyển inline style lặp lại thành class CSS/component.
- Chuẩn hóa button, badge, field grid, table cell và panel card.
- Loại bỏ helper, handler và CSS không còn tham chiếu sau refactor.
- Chỉ xóa code sau khi đã kiểm tra import động, command registry và `data-bf-action`.
- Bổ sung ESLint hoặc công cụ kiểm tra tương đương cho JavaScript.
- Bổ sung kiểm tra format/lint Python phù hợp với dự án.

### Điều kiện hoàn thành

- Build production không chứa module cũ không còn sử dụng.
- Không còn selector CSS chết được xác nhận.
- `npm run check` bao gồm lint, build và test.

## 5. Thứ tự triển khai rút gọn

1. Bổ sung test bảo vệ hành vi.
2. API client và helper dùng chung.
3. Bảng, bộ lọc và selector phiên bản dùng chung.
4. Form binder, validation và version service.
5. Hợp nhất form chủ đầu tư/nhà thầu.
6. Tách từng panel của chi tiết gói thầu.
7. Chuẩn hóa manifest Word/Excel/schema.
8. Tách backend sync.
9. Giảm `window.*`, chuẩn hóa CSS và xóa code cũ.

## 6. Kiểm thử bắt buộc sau mỗi giai đoạn

- `npm run build`.
- `npm run test:unit`.
- `npm run test:api`.
- E2E cho màn hình hoặc workflow vừa thay đổi.
- Kiểm tra F5 tại trang danh sách và trang chi tiết.
- Kiểm tra thêm, sửa, xóa và import cập nhật giao diện ngay.
- Kiểm tra IndexedDB, hàng chờ đồng bộ và SQLite cho cùng một bản ghi.
- Kiểm tra xuất Word với đúng phiên bản nhà thầu/chủ đầu tư theo ngày nghiệp vụ.

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

