# BÁO CÁO KIỂM THỬ LUỒNG NGƯỜI DÙNG VÀ SỬA LỖI BIDDINGFLOW

> Nguồn sự thật duy nhất cho phiên kiểm thử bắt đầu ngày 29/07/2026. Không xóa lịch sử hợp lệ; mọi kết quả phải kèm bằng chứng.

## 1. Thông tin chung

| Thuộc tính | Giá trị |
|---|---|
| Thời gian bắt đầu | 2026-07-29 05:21:18 +07:00 |
| Trạng thái | ĐANG KIỂM THỬ |
| Branch | `main` |
| Commit ban đầu | `516f9d9` |
| Working tree ban đầu | Đang có thay đổi chưa commit của chức năng hàng hóa dự thầu; phải bảo toàn |
| Môi trường | Windows, workspace `D:\Bidding` |
| Node | v24.18.0 |
| npm | 11.16.0 |
| Python | 3.14.5 |
| Playwright | 1.62.0 |
| Trình duyệt | Codex In-app Browser (`iab`), đã kết nối và điều khiển thành công |
| Plugin/MCP/skill | Browser plugin + Node REPL MCP; skill control-in-app-browser, diagnosing-bugs |
| URL frontend/backend | `http://127.0.0.1:8000` |
| Database | PostgreSQL local theo `DATABASE_URL`; không ghi secret |
| Lệnh khởi động | `python backend/app.py` |
| Lệnh build/test | `npm run build`; pytest, Node test và các lệnh `test:*` trong `package.json` |

### 1.1. Sự kiện hạ tầng

| ID | Thời điểm | Sự kiện | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| INFRA-01 | 2026-07-29 | Browser MCP từng bootstrap thất bại ba lần do sandbox helper | ĐÃ KHÔI PHỤC | Sau khi quyền sandbox được gỡ, Browser plugin kết nối `iab`, mở `/dang-nhap` và đọc DOM thành công |

## 2. Tài khoản và vai trò

| ID | Loại tài khoản/vai trò | Phạm vi dữ liệu | Quyền chính | Tài khoản test | Trạng thái |
|---|---|---|---|---|---|
| ROLE-01 | Platform `super_admin` | Toàn nền tảng; có effective roles `super_admin`, `manager`, `employee` | Quản trị tài khoản/nền tảng; không tự nhận là quản lý thành viên của một tổ chức | Fixture cô lập; không ghi mật khẩu | ĐẠT |
| ROLE-02 | Organization `manager` | Tổ chức đang chọn | Toàn quyền nghiệp vụ trong tổ chức; cấu hình nhân sự/phân quyền | Fixture cô lập; không ghi mật khẩu | ĐẠT |
| ROLE-03 | Organization `employee` | Module và bản ghi được phân công | Xem/sửa theo `ma_tran_phan_quyen`; không xóa hoặc phê duyệt trái quyền | Fixture cô lập; không ghi mật khẩu | ĐẠT |
| SCOPE-01 | Chủ sở hữu workspace cá nhân | Workspace cá nhân của chính tài khoản | Quyền theo phạm vi sở hữu; đây không phải role backend riêng | Fixture cô lập; không ghi mật khẩu | ĐẠT |

Role canonical từ `backend/auth/roles.py`: platform chỉ có `super_admin`, `user`; tổ chức chỉ có `manager`, `employee`. `owner` không phải role canonical.

## 3. Ma trận chức năng

| ID | Module | Chức năng | Vai trò | Trường hợp | Kết quả | Lỗi liên quan |
|---|---|---|---|---|---|---|
| F-001 | Auth | Đăng ký/điều khoản | Tất cả | Happy path + validation + reload | ĐẠT | AUTH-01 |
| F-002 | Auth | Đăng nhập/đăng xuất/session | Tất cả | Đúng/sai/chưa xác minh/URL bảo vệ/multi-tab/đổi-reset mật khẩu/revoke-expire | ĐẠT | AUTH-01; lỗi mạng UI desktop/mobile hiển thị rõ và không báo thành công giả |
| F-003 | Workspace | Chuyển tổ chức và cách ly dữ liệu | Tất cả | Quyền cho phép/từ chối/IDOR | ĐẠT | Cross-workspace 403; UI chuyển hai tổ chức, reload giữ lựa chọn sau BUG-013; thành viên rời và tổ chức suspended đạt |
| F-004 | Quản trị | Người dùng, vai trò, phân quyền | super_admin/manager/employee | CRUD/thu hồi quyền/reload | ĐẠT | Role/menu/session; UI thêm lại–sửa–cho nhân sự rời tổ chức; chuyên viên bị cấm xóa; thu hồi edit→view có hiệu lực ngay |
| F-005 | Danh mục | Nhân viên/chủ đầu tư/nhà thầu/chuyên gia | manager/employee theo RBAC | CRUD/import/export/pagination | ĐẠT | C-U-D UI/reload/PostgreSQL; Excel import/export có E2E theo module; tìm kiếm và phân trang chuyên gia 15 dòng qua 2 trang đạt |
| F-006 | Kế hoạch | Kế hoạch lựa chọn nhà thầu | manager | CRUD/giá trị/tham chiếu | ĐẠT | C-U-D UI, versioning, phân rã, tham chiếu chủ đầu tư và PostgreSQL không còn active đạt |
| F-007 | Gói thầu | Tạo/sửa/xóa/phân lô/hàng hóa | manager/employee theo RBAC | Mọi option thực tế + validation | ĐẠT | C-U-D/reload/PostgreSQL; 15 tổ hợp pairwise; phân lô/hàng hóa/import và validation đều có E2E |
| F-008 | Vòng đời | HSMT/phát hành/gia hạn/mở thầu | manager | Trạng thái/quyền/tài liệu | ĐẠT | LIFE-02 bao phủ phát hành, gia hạn, mở thầu, hủy, đấu lại; RBAC bao phủ quyền |
| F-009 | Đánh giá | 1G1T tổng quát/chi tiết | manager/employee theo phân công | Nhiều nhà thầu/lô/giá | ĐẠT | 1G1T độc lập/liên danh, nhiều lô/nhà thầu, tổng quát/chi tiết, reload/PostgreSQL |
| F-010 | Đánh giá | 1G2T kỹ thuật/tài chính | manager/employee theo phân công | Gate kỹ thuật/không lộ tài chính | ĐẠT | Độc lập + liên danh; không có giá ở mở kỹ thuật; nhà thầu trượt kỹ thuật không sang tài chính; kết quả PostgreSQL đúng |
| F-011 | Giá thấp | Quyết định dưới 50% | manager/employee theo phân công | LP-01 đến LP-30 | ĐẠT | 30/30 dòng có bằng chứng rule/UI/PostgreSQL/export/conflict tương ứng |
| F-012 | Liên danh | Thành viên/mở thầu/đánh giá/kết quả | manager/employee theo phân công | JV-01 đến JV-22 | ĐẠT | 1G1T/1G2T, 3 thành viên, nhiều lô, hợp đồng, Word/Excel; các dòng tỷ lệ/đánh giá cấp thành viên ghi KHÔNG ÁP DỤNG theo schema |
| F-013 | Kết quả | Thẩm định/phê duyệt/hủy/đấu thầu lại | manager | Vòng đời và quyền | ĐẠT | 1G1T/1G2T/phân lô/liên danh, hủy và đấu lại; employee không được phê duyệt trái quyền |
| F-014 | Hợp đồng | Tạo/thực hiện/hoàn thành/thanh lý | manager/employee theo RBAC | Độc lập/liên danh/lô/quyền | ĐẠT | Hợp đồng độc lập đi đến thanh lý; hợp đồng liên danh + C-U-D/reload/PostgreSQL đạt |
| F-015 | Tài liệu | Word/Excel/PDF/import/export | theo entitlement/quyền | Mở file, Unicode, giá, liên danh | ĐẠT | Word + Excel được tải/mở/phân tích/render; Excel import đạt; PDF upload/download/delete và kiểm tra magic/EOF đạt; không có export PDF nghiệp vụ theo model |
| F-016 | Sync | Offline/retry/conflict/multi-tab | Tất cả | IndexedDB/outbox/PostgreSQL | ĐẠT | Offline trước lưu, ngắt request giữa lưu, retry, không trùng, PostgreSQL, multi-context và 409 rowVersion đều đạt sau BUG-011 |
| F-017 | UI/UX | Responsive/a11y/error/loading | Tất cả | Desktop/hẹp/keyboard/console/network | ĐẠT | Desktop 1280×720 + mobile 390×844, font/Unicode, không overflow, keyboard, accessible name, lỗi mạng và Browser plugin đạt sau BUG-010 |
| F-018 | Bảo mật | AuthZ/IDOR/CSRF/XSS/upload | Tất cả | UI + API xác minh backend | ĐẠT | AuthZ/IDOR/workspace; CSRF thiếu/sai/Origin giả; mass assignment; stored XSS; MIME giả/quá cỡ/tên file nguy hiểm; secure build đạt sau BUG-012 |
| F-019 | Hiệu năng | Dữ liệu lớn/N+1/reload | Tất cả | Đo lường, không suy đoán | ĐẠT | `test:performance` 30 cold + 30 warm; regression N+1/chunking PostgreSQL và reload E2E đạt |

## 4. Ma trận tổ hợp gói thầu (pairwise)

Chiến lược: bao phủ mọi option thực tế sau khi khảo sát, dùng pairwise cho lĩnh vực × hình thức × phương thức × phương pháp × phân lô × kiểu nhà thầu; bổ sung riêng các tương tác rủi ro cao (1G2T, nhiều lô, liên danh, dưới 50%, hủy, đấu thầu lại, hợp đồng).

| ID | Lĩnh vực | Hình thức | Phương thức | Phương pháp | Phân lô | Kiểu nhà thầu | Nhánh nghiệp vụ | Kết quả |
|---|---|---|---|---|---|---|---|---|
| PKG-01 | Hàng hóa | Đấu thầu rộng rãi | 1G1T | Giá thấp nhất | Không | Độc lập | Vòng đời đầy đủ, giá bình thường | ĐẠT PAIRWISE + LIFE-02 |
| PKG-02 | Hàng hóa | Đấu thầu hạn chế | 1G1T | Giá đánh giá | Có, nhiều lô | Liên danh | Tổ hợp tạo/reload/DB; giá thấp và liên danh kiểm riêng | ĐẠT PAIRWISE |
| PKG-03 | Hàng hóa | Đấu thầu rộng rãi | 1G2T | Kết hợp giữa kỹ thuật và giá | Không | Độc lập | Gate kỹ thuật → tài chính | ĐẠT PAIRWISE + LIFE-02 |
| PKG-04 | Hàng hóa | Đấu thầu hạn chế | 1G2T | Dựa trên kỹ thuật | Có | Liên danh | Tổ hợp tạo/reload/DB; nhiều lô/liên danh kiểm riêng | ĐẠT PAIRWISE |
| PKG-05 | Xây lắp | Đấu thầu rộng rãi | Hai giai đoạn một túi hồ sơ | Giá thấp nhất | Không | Độc lập | Tạo/reload/PostgreSQL | ĐẠT PAIRWISE |
| PKG-06 | Xây lắp | Đấu thầu hạn chế | Hai giai đoạn hai túi hồ sơ | Giá đánh giá | Có | Liên danh | Tạo/reload/PostgreSQL với 2 lô | ĐẠT PAIRWISE |
| PKG-07 | Tư vấn | Đấu thầu rộng rãi | 1G2T | Kết hợp giữa kỹ thuật và giá | Không | Liên danh | Tạo/reload/PostgreSQL; trọng số 70% | ĐẠT PAIRWISE |
| PKG-08 | Tư vấn | Đấu thầu hạn chế | 1G2T | Giá cố định | Có | Độc lập | Tạo/reload/PostgreSQL với 2 lô | ĐẠT PAIRWISE |
| PKG-09 | Phi tư vấn | Chào hàng cạnh tranh | 1G1T | Giá thấp nhất | Có | Độc lập | Tạo/reload/PostgreSQL; hủy/đấu thầu lại ở LIFE-02 | ĐẠT PAIRWISE |
| PKG-10 | Phi tư vấn | Đấu thầu rộng rãi | 1G2T | Giá đánh giá | Không | Liên danh | Tạo/reload/PostgreSQL | ĐẠT PAIRWISE |
| PKG-11 | Hỗn hợp | Đấu thầu hạn chế | Hai giai đoạn hai túi hồ sơ | Dựa trên kỹ thuật | Có | Liên danh | Tạo/reload/PostgreSQL với 2 lô | ĐẠT PAIRWISE |
| PKG-12 | Hỗn hợp | Đấu thầu rộng rãi | Hai giai đoạn một túi hồ sơ | Giá đánh giá | Không | Độc lập | Tạo/reload/PostgreSQL | ĐẠT PAIRWISE |
| PKG-13 | Hàng hóa | Chỉ định thầu | 1G1T | Giá thấp nhất | Không | Độc lập | Tạo/reload/PostgreSQL sau BUG-006 | ĐẠT PAIRWISE |
| PKG-14 | Xây lắp | Chỉ định thầu rút gọn | Không có | Không có | Có | Liên danh | Nhánh rút gọn, 2 lô, tạo/reload/PostgreSQL | ĐẠT PAIRWISE |
| PKG-15 | Hỗn hợp | Lựa chọn nhà thầu trong trường hợp đặc biệt | Không có | Không có | Không | Độc lập | Nhánh đặc biệt, tạo/reload/PostgreSQL | ĐẠT PAIRWISE |

## 5. Ma trận giá đề nghị trúng thầu dưới 50%

| ID | Trường hợp | Kết quả mong đợi | Kết quả | Bằng chứng/Lỗi |
|---|---|---|---|---|
| LP-01 | Giá bằng 100% | Không cảnh báo dưới 50% | ĐẠT | `low_price_matrix.test.mjs` |
| LP-02 | Giá trên 50% | Không cảnh báo | ĐẠT | `low_price_matrix.test.mjs` |
| LP-03 | Giá bằng đúng 50% | Không cảnh báo | ĐẠT | `low_price_matrix.test.mjs` |
| LP-04 | Giá nhỏ hơn 50% đúng 1 đồng | Hiển thị cảnh báo và bắt buộc quyết định | ĐẠT | Unit + UI 499.999/1.000.000 hiển thị cảnh báo và chặn lưu khi chưa chọn |
| LP-05 | Giá 49% | Hiển thị cảnh báo | ĐẠT | Unit + UI 490.000/1.000.000 |
| LP-06 | Giá 30% | Hiển thị cảnh báo | ĐẠT | Unit + UI 300.000/1.000.000 |
| LP-07 | Giá rất nhỏ nhưng dương | Xử lý đúng | ĐẠT | Unit + UI giá 1 đồng vẫn cảnh báo, không lỗi số học |
| LP-08 | Giá bằng 0 | Validation thực tế không bỏ lọt | ĐẠT | Backend chấp nhận 0; không coi là cảnh báo dưới 50% |
| LP-09 | Giá âm | Bị từ chối | ĐẠT | `test_sync_rejects_negative_bid_evaluation_prices` |
| LP-10 | Giảm giá làm giá xuống dưới 50% | Rule dùng đúng giá sau giảm nếu nghiệp vụ quy định | ĐẠT RULE | `low_price_matrix.test.mjs` xác minh dùng giá đề nghị cuối sau giảm |
| LP-11 | Hiệu chỉnh làm giá xuống dưới 50% | Rule dùng đúng giá sau hiệu chỉnh nếu nghiệp vụ quy định | ĐẠT RULE | `low_price_matrix.test.mjs` xác minh dùng giá đề nghị cuối sau hiệu chỉnh |
| LP-12 | Một phần lô dưới 50% | Chỉ cảnh báo đúng phần lô | ĐẠT | Unit + E2E nhiều lô: chỉ JV-L2 200.000/500.000 bị cảnh báo/loại; JV-L1 không sai |
| LP-13 | Toàn gói dưới 50% | Cảnh báo đúng toàn gói | ĐẠT | Unit + E2E toàn gói liên danh 400.000/1.000.000 |
| LP-14 | Liên danh dưới 50% | Cảnh báo ở cấp liên danh | ĐẠT | `test:joint-venture-e2e` hiển thị cảnh báo đúng liên danh |
| LP-15 | Dưới 50%, chưa chọn | Không được lưu/hoàn tất | ĐẠT | `test:joint-venture-e2e` chặn lưu và chỉ đúng nhà thầu thiếu quyết định |
| LP-16 | Dưới 50%, chọn Chấp thuận | Vẫn được xếp hạng nếu tiêu chí khác đạt | ĐẠT | Liên danh 400.000/1.000.000 được chấp thuận, xếp hạng 1 và phê duyệt trúng |
| LP-17 | Dưới 50%, chọn Không chấp thuận | Tự ghi lý do và loại khỏi xếp hạng | ĐẠT | E2E lưu `false`, tự ghi lý do, loại liên danh khỏi xếp hạng; PostgreSQL xác nhận |
| LP-18 | Chuyển Không chấp thuận → Chấp thuận | Xóa lý do loại tự động và tính lại | ĐẠT | E2E đổi `false→true`, xóa lý do và xếp hạng lại liên danh từ `--` lên hạng 1 |
| LP-19 | Sửa giá lên đúng 50% | Cảnh báo/quyết định cũ không còn tác dụng | ĐẠT | UI đổi 400.000→500.000, warning ẩn; lưu/reload/PostgreSQL giữ decision `null` và xếp hạng đúng |
| LP-20 | Sửa giá trên 50% → dưới 50% | Bắt buộc quyết định | ĐẠT | UI kiểm 600.000 không cảnh báo rồi 400.000 bắt buộc quyết định; lưu `true` và PostgreSQL đúng |
| LP-21 | Reload sau Chấp thuận | Dữ liệu giữ nguyên | ĐẠT | E2E reload và radio `true` vẫn được chọn |
| LP-22 | Reload sau Không chấp thuận | Dữ liệu giữ nguyên | ĐẠT | E2E reload và radio `false` vẫn được chọn |
| LP-23 | Đăng nhập lại | Dữ liệu giữ nguyên | ĐẠT | Context đăng nhập mới giữ quyết định `true`; chính sách một phiên được xử lý và xác minh |
| LP-24 | Gọi API bỏ qua quyết định | Backend xử lý đúng trách nhiệm hiện có | ĐẠT | Backend cho phép bỏ trống vì không có context giá gói; khi có giá trị thì kiểm kiểu boolean; UI chịu trách nhiệm bắt buộc |
| LP-25 | Hai người sửa quyết định | Xử lý xung đột đúng | ĐẠT | Hai manager tải rowVersion 1; người đầu lưu `true` lên version 2; người thứ hai dùng bản cũ bị HTTP 409 `ROW_VERSION_CONFLICT`; PostgreSQL giữ `true`; fixture cleanup |
| LP-26 | Báo cáo tổng quát | Thể hiện đúng quyết định | ĐẠT | Playwright xác minh dòng liên danh giá 400.000/1.000.000 hiển thị `Chấp thuận` sau lưu và reload |
| LP-27 | Báo cáo chi tiết | Thể hiện đúng quyết định | ĐẠT SAU SỬA | Regression renderer + Playwright mở báo cáo chi tiết, chọn liên danh và thấy `Xử lý giá đề nghị trúng thầu dưới 50% — Chấp thuận`; BUG-007 |
| LP-28 | Export Word/Excel | Thể hiện đúng kết quả | ĐẠT SAU SỬA | Excel đánh giá/kết quả mở bằng `openpyxl`; Word tải qua UI, mở cấu trúc và render 1 trang sạch, có quyết định `Chấp thuận`, đủ 3 thành viên, Unicode/font đúng; BUG-005/008 |
| LP-29 | Không chấp thuận một lô | Không làm sai lô khác | ĐẠT | E2E nhiều lô: liên danh trúng JV-L1; bị từ chối dưới 50% ở JV-L2, chỉ JV-L2 chuyển `--`, JV-L1 giữ hạng 1 và kết quả trúng |
| LP-30 | Nhà thầu xếp sau | Được xếp hạng lại đúng | ĐẠT | Unit + E2E: khi liên danh bị từ chối, nhà thầu độc lập lên hạng 1; khi chấp thuận, liên danh hạng 1 và độc lập hạng 2 |

## 6. Ma trận liên danh

| ID | Trường hợp | Kết quả mong đợi | Kết quả | Bằng chứng/Lỗi |
|---|---|---|---|---|
| JV-01 | Hai thành viên hợp lệ | Tạo liên danh thành công | ĐẠT | UI + PostgreSQL lưu 2 thành viên, đúng 1 đứng đầu |
| JV-02 | Hơn hai thành viên | Lưu đúng | ĐẠT | UI + PostgreSQL lưu 3 thành viên, đúng 1 đứng đầu; reload/export/kết quả giữ đủ 3 |
| JV-03 | Không có thành viên đứng đầu | Xử lý đúng rule thực tế | ĐẠT | Rule thực tế yêu cầu đúng một đứng đầu; validation backend từ chối payload không có thành viên đứng đầu |
| JV-04 | Hai thành viên đứng đầu | Bị chặn nếu rule chỉ cho một | ĐẠT | Validation backend từ chối payload có hai thành viên đứng đầu |
| JV-05 | Thành viên trùng | Bị chặn | ĐẠT | Backend và UI đều từ chối, UI chỉ đúng mã trùng |
| JV-06 | Tổng tỷ lệ bằng 100% | Xử lý đúng | KHÔNG ÁP DỤNG | UI và schema thành viên liên danh hiện không có trường tỷ lệ |
| JV-07 | Tổng tỷ lệ dưới 100% | Xử lý đúng rule thực tế | KHÔNG ÁP DỤNG | UI và schema thành viên liên danh hiện không có trường tỷ lệ |
| JV-08 | Tổng tỷ lệ trên 100% | Xử lý đúng rule thực tế | KHÔNG ÁP DỤNG | UI và schema thành viên liên danh hiện không có trường tỷ lệ |
| JV-09 | Tỷ lệ âm | Bị chặn | KHÔNG ÁP DỤNG | UI và schema thành viên liên danh hiện không có trường tỷ lệ |
| JV-10 | Thành viên dự độc lập và liên danh cùng gói | Xử lý đúng rule thực tế | ĐẠT | Validation backend từ chối trùng participant trong cùng gói/lô |
| JV-11 | Hai liên danh có thành viên trùng | Xử lý đúng rule thực tế | ĐẠT | Validation backend từ chối trùng participant trong cùng gói/lô; cho phép ở lô khác |
| JV-12 | Một thành viên không hợp lệ | Kết luận liên danh đúng | KHÔNG ÁP DỤNG | Model hiện hành đánh giá liên danh như một HSDT; thành viên không có trường kết luận hợp lệ riêng |
| JV-13 | Thành viên đứng đầu không hợp lệ | Kết luận đúng | KHÔNG ÁP DỤNG | Model hiện hành không có đánh giá hợp lệ cấp thành viên/đứng đầu; kết luận ở cấp HSDT liên danh |
| JV-14 | Liên danh dự một lô | Dữ liệu đúng | ĐẠT | Mỗi HSDT liên danh gắn đúng một `maPhanLo`; PostgreSQL và UI scope đúng JV-L1/JV-L2 |
| JV-15 | Liên danh dự nhiều lô | Dữ liệu đúng | ĐẠT | Cùng liên danh 3 thành viên lưu ở 2 lô, mỗi lô giữ đủ 3 thành viên |
| JV-16 | Trúng một lô, trượt lô khác | Kết quả đúng | ĐẠT | Liên danh trúng JV-L1; bị loại ở JV-L2; winner PostgreSQL lần lượt contractor-1 và contractor-4 |
| JV-17 | Giá dưới 50%, Chấp thuận | Vẫn được xếp hạng nếu đạt tiêu chí khác | ĐẠT | `test:joint-venture-e2e` |
| JV-18 | Giá dưới 50%, Không chấp thuận | Bị loại đúng | ĐẠT | E2E lưu quyết định `false`, liên danh có kết quả `--`, nhà thầu độc lập lên hạng 1 |
| JV-19 | Phê duyệt liên danh trúng | Hiển thị đủ thành viên | ĐẠT | Kết quả trúng và modal sau phê duyệt hiển thị đứng đầu + thành viên |
| JV-20 | Tạo hợp đồng liên danh | Dữ liệu đúng | ĐẠT | UI tạo/reload hợp đồng 400.000; PostgreSQL xác nhận liên kết đúng gói trúng, nhà thầu đứng đầu, 3 thành viên và đúng 1 đứng đầu |
| JV-21 | Export báo cáo | Không mất thông tin thành viên | ĐẠT WORD + EXCEL | Hai Excel và báo cáo Word đều đủ 3 thành viên; Word được mở cấu trúc, xác minh biến đã render và render PNG 1 trang không lỗi bố cục |
| JV-22 | Reload và đăng nhập lại | Dữ liệu giữ nguyên | ĐẠT | Reload giữ đủ thành viên/quyết định; context đăng nhập mới giữ quyết định `true` |

## 7. Nhật ký lỗi

### BUG-001: Lưu đánh giá 1G1T không chuyển sang bước kết quả

- Trạng thái: `ĐÃ SỬA` — regression, toàn luồng Playwright và retest trực tiếp bằng Browser plugin đều đạt.
- Mức độ: `High` — chặn vòng đời gói thầu và toàn bộ bước phê duyệt/hợp đồng phía sau.
- Môi trường: Playwright Chromium, PostgreSQL local, `http://127.0.0.1:8000`.
- Điều kiện: gói hàng hóa không phân lô, giá gói 900.000.000 đồng; một HSDT 780.000.000 đồng; giá xếp hạng và giá đề nghị trúng thầu 772.200.000 đồng; hợp lệ/năng lực/kỹ thuật đều đạt.
- Cách tái hiện: chạy `npm run test:lifecycle`.
- Mong đợi: lưu báo cáo đánh giá thành công và xuất hiện bước kết quả.
- Thực tế: sau khi bấm lưu, tab vẫn chỉ gồm `preparation`, `goods`, `opening`, `eval_tech`, `documents`; không có dialog, lỗi JavaScript hay HTTP; chờ tab `result` hết thời gian sau 20 giây.
- Bằng chứng: output E2E dừng ngay sau `[E2E] opening-saved` với `Evaluation did not advance`.
- Giả thuyết ban đầu: validation giá thấp; gate hàng hóa dự thầu; thiếu trường theo phương pháp; validation ẩn; hoặc trạng thái chưa đồng bộ.
- Nguyên nhân gốc: sau đồng bộ, action gọi `renderGoiThauTable()` lần hai nhưng không chờ Promise; màn chi tiết được dựng từ trạng thái phân trang cũ, nên tab kết quả chỉ xuất hiện sau reload.
- Cách sửa: chuyển refresh danh sách vào callback `afterPersist` của `persistAndSync` để chỉ refresh một lần và chờ hoàn tất trước khi dựng màn chi tiết.
- Regression test: `tests/js/bid_evaluation_transition.test.mjs` — xác minh refresh phân trang hoàn tất trước khi mở bước kết quả.
- Retest Playwright: `node --test tests/js/bid_evaluation_transition.test.mjs` đạt; `npm run test:lifecycle` vượt bước `evaluation-saved` và hoàn thành toàn bộ 33 mốc.
- Retest Browser plugin: lưu đánh giá 1G1T thành công; tab kết quả xuất hiện ngay không cần reload.

### BUG-002: Chọn Liên danh nhưng nút quản lý thành viên vẫn bị ẩn

- Trạng thái: `ĐÃ SỬA` — regression, E2E Playwright và retest trực tiếp bằng Browser plugin đều đạt.
- Mức độ: `High` — người dùng không thể nhập thành viên liên danh.
- Tái hiện: tại Mở thầu, đổi Loại nhà thầu từ `Độc lập` sang `Liên danh`.
- Nguyên nhân gốc: vùng nút đồng thời giữ lớp runtime `display:none` sinh từ `css-text` và lớp `display:block`; lớp `none` được chèn sau nên thắng cascade.
- Cách sửa: bỏ `display` inline khỏi HTML; khởi tạo và cập nhật `display` bằng cùng thuộc tính `setRuntimeStyle` để lớp cũ được thay thế.
- File/test: `frontend/packages/BidProcessWorkflow.js`; `tests/js/opening_save_regressions.test.mjs`.
- Retest Playwright: `test:joint-venture-e2e` tạo liên danh, chặn trùng và lưu PostgreSQL thành công.
- Retest Browser plugin: đổi loại nhà thầu sang `Liên danh`; nút `Thành viên liên danh (0)` hiển thị trực tiếp.

### BUG-003: Backend từ chối quyết định giá dưới 50% dạng boolean

- Trạng thái: `ĐÃ SỬA` — regression, E2E Playwright và retest trực tiếp bằng Browser plugin đều đạt.
- Mức độ: `High` — chặn lưu đánh giá khi người dùng chọn Chấp thuận/Không chấp thuận.
- Bằng chứng: `/api/sync` trả `INVALID_STRING` cho `chapThuanGiaDeNghiTrungThauDuoi50=true`.
- Nguyên nhân gốc: validation shape gom mọi virtual field thành chuỗi trước khi validation nghiệp vụ xử lý riêng boolean.
- Cách sửa: validation shape chấp nhận boolean/0/1/null cho đúng schema và mapper hiện có.
- File/test: `backend/sync/payload_validation.py`; `tests/test_bid_evaluation_prices.py`.
- Retest: 8 test backend đạt; E2E liên danh dưới 50% lưu, xếp hạng và phê duyệt thành công.
- Retest Browser plugin: chọn `Chấp thuận` cho giá 400.000/1.000.000, lưu thành công; reload vẫn giữ radio boolean `true` ở trạng thái chọn.

### BUG-004: Nút Google làm form đăng nhập cao bất thường

- Trạng thái: `ĐÃ SỬA` — đã retest trực tiếp bằng Browser plugin.
- Mức độ: `Medium` — logo SVG 300×300 px làm nút cao 344 px, card cao khoảng 1.000 px.
- Nguyên nhân gốc: fallback DOM của Google không nhận stylesheet nút bên thứ ba; SVG tự giãn theo chiều rộng 300 px.
- Cách sửa: giới hạn nút 300×40, SVG 18×18, ẩn nhãn hỗ trợ trùng khỏi phần nhìn, thêm viền và cache-bust stylesheet.
- File/test: `views/css/views.css`, `views/index.html`, `tests/js/auth_google_button_layout.test.mjs`.
- Retest Browser plugin: nút 300×40, SVG 18×18, card khoảng 700 px; font `Plus Jakarta Sans` và tiếng Việt hiển thị đúng.

### BUG-005: Export Excel làm mất thành viên liên danh và thiếu quyết định giá thấp

- Trạng thái: `ĐÃ SỬA` — regression và E2E tải/mở file đều đạt.
- Mức độ: `High` — báo cáo đánh giá/kết quả không phản ánh đầy đủ chủ thể dự thầu và quyết định bắt buộc dưới 50%.
- Tín hiệu đỏ: `npm run test:joint-venture-e2e` xác nhận PostgreSQL có 2 thành viên nhưng file export không có dữ liệu thành viên.
- Nguyên nhân gốc: dịch vụ Excel chỉ lấy bản ghi mở thầu chính, không truy vấn bảng `thong_tin_mo_thau_lien_danh_thanh_vien`; export kết quả cũng chưa có cột quyết định giá thấp.
- Cách sửa: truy vấn thành viên theo lô, thêm cột `Thành viên liên danh` cho hai loại export và cột `Xử lý giá đề nghị trúng thầu dưới 50%` cho export kết quả.
- File/test: `backend/documents/excel_service.py`; `tests/test_document_worker_excel_exports.py`.
- Retest: 9/9 regression đạt; E2E tải và mở `DanhGia_HSDT_*.xlsx`, `KetQua_QD_*.xlsx`, xác minh đủ 2 thành viên, quyết định `Chấp thuận`, Unicode và font `Calibri`.

### BUG-006: Chọn “Chỉ định thầu” làm phương pháp đánh giá rỗng, không thể lưu gói

- Trạng thái: `ĐÃ SỬA` — regression, Playwright E2E và retest trực tiếp bằng Browser plugin đều đạt.
- Mức độ: `High` — hình thức được hiển thị trong form nhưng không thể tạo gói để bắt đầu nghiệp vụ.
- Tín hiệu đỏ: regression mong `Giá thấp nhất`/`Giá đánh giá` cho 1G1T nhưng `getEvaluationMethods()` trả mảng rỗng; form vẫn yêu cầu trường phương pháp.
- Nguyên nhân gốc: tập hình thức có luồng mở thầu/đánh giá chỉ chứa đấu thầu rộng rãi và hạn chế, thiếu `Chỉ định thầu`, trong khi backend vẫn xem hình thức này là luồng phải mở thầu.
- Cách sửa: thêm `Chỉ định thầu` vào tập hình thức có phương pháp; giữ nhánh rút gọn/đặc biệt là `Không có` như thiết kế hiện hành.
- File/test: `frontend/packages/evaluationMethodRules.js`; `tests/js/evaluation_method_rules.test.mjs`.
- Retest: 7/7 regression đạt; `test:package-pairwise-e2e` tạo/reload/xác minh PostgreSQL thành công PKG-13 với 1G1T + Giá thấp nhất.
- Retest Browser plugin: chọn `Chỉ định thầu` + 1G1T hiển thị đúng hai phương pháp `Giá thấp nhất` và `Giá đánh giá`.

### BUG-007: Báo cáo đánh giá chi tiết không thể hiện quyết định giá đề nghị trúng thầu dưới 50%

- Trạng thái: `ĐÃ SỬA` — regression renderer và E2E Playwright toàn luồng đều đạt.
- Mức độ: `High` — báo cáo chi tiết thiếu quyết định nghiệp vụ bắt buộc, không nhất quán với báo cáo tổng quát và dữ liệu PostgreSQL.
- Tín hiệu đỏ: báo cáo tổng quát có radio `Chấp thuận`, nhưng renderer báo cáo chi tiết không đọc gói, giá đề nghị hoặc trường quyết định.
- Nguyên nhân gốc: `DetailedEvaluationPanel` chỉ hiển thị tiến độ/tiêu chí, chưa có phần tóm tắt quyết định giá dưới 50% của HSDT đang chọn.
- Cách sửa: dùng cùng rule giá dưới 50% của báo cáo tổng quát và hiển thị badge `Chấp thuận`, `Không chấp thuận` hoặc `Chưa quyết định` trong phần tổng quan báo cáo chi tiết.
- File/test: `frontend/packages/detail/DetailedEvaluationPanel.js`; `tests/js/detailed_evaluation_low_price.test.mjs`.
- Retest: unit 1/1; `test:joint-venture-e2e` mở báo cáo tổng quát và chi tiết của liên danh, xác nhận cùng quyết định `Chấp thuận`.

### BUG-008: Xuất Word trên PostgreSQL trả HTTP 500 trước khi render

- Trạng thái: `ĐÃ SỬA` — regression backend, E2E tải tệp, kiểm tra cấu trúc và render trực quan đều đạt.
- Mức độ: `High` — chặn mọi export Word có bước lọc ánh xạ trên PostgreSQL.
- Bằng chứng lỗi: `/api/export-report/{package}?type=result` trả 500 `DOCX_OPERATION_FAILED`; log requestId cho thấy `KeyError: slice(None, 3, None)`.
- Nguyên nhân gốc: `filter_mapping_rows()` dùng `row[:3]`, nhưng `CompatRow` PostgreSQL chỉ hỗ trợ khóa chuỗi và chỉ số nguyên, không hỗ trợ `slice`.
- Cách sửa: đọc theo tên cột khi row là `Mapping`; fallback đọc `row[0]`, `row[1]`, `row[2]` cho SQLite/tuple/list.
- File/test: `backend/documents/docx_context_policy.py`; `tests/test_docx_mapping_policy.py`.
- Retest: regression 1/1; E2E upload/kích hoạt mẫu Word qua UI, export thành công, đủ liên danh/quyết định; render qua Word + Poppler thành PNG 1 trang, không cắt/đè/mất glyph.

### BUG-009: Xóa danh mục đã sửa làm phiên bản cũ “hồi sinh” sau reload

- Trạng thái: `ĐÃ SỬA` — E2E CRUD UI và PostgreSQL đạt.
- Mức độ: `High` — người dùng xóa chủ đầu tư/nhà thầu/chuyên gia nhưng bản V0 được nâng lại thành active sau khi V1 bị xóa.
- Tín hiệu đỏ: UI tạm ẩn bản ghi, nhưng PostgreSQL còn `is_latest=1`; reload/tìm theo mã có thể thấy phiên bản cũ.
- Nguyên nhân gốc: ba workflow danh mục chỉ lọc/xóa đúng `id` hiện tại, trong khi kế hoạch/gói/hợp đồng đã xử lý theo `rootId` và họ phiên bản.
- Cách sửa: dùng `getVersionFamily`, cho chọn xóa phiên bản gần nhất hoặc toàn bộ, đánh dấu xóa đủ ID; kiểm tra phụ thuộc trúng thầu/hợp đồng/phân công trên toàn họ phiên bản.
- File/test: `frontend/partners/ChuDauTuWorkflow.js`, `frontend/partners/NhaThauWorkflow.js`, `frontend/experts/ChuyenGiaWorkflow.js`; `scripts/verify_crud_modules_e2e.mjs`.
- Retest: C-U-D UI + reload cho 6 module; PostgreSQL xác nhận 0 bản active/latest, chỉ giữ lịch sử không active theo model audit; fixture cleanup.

### BUG-010: Màn đăng nhập không cô lập focus và nội dung ứng dụng phía sau

- Trạng thái: `ĐÃ SỬA` — Playwright desktop/mobile và Browser plugin trực tiếp đều đạt.
- Mức độ: `Medium` — người dùng bàn phím/trình đọc màn hình có thể đi vào menu ứng dụng và hộp thoại đang đóng trước khi đăng nhập.
- Tín hiệu đỏ: từ ô tên đăng nhập, `Shift+Tab` thoát khỏi auth overlay; `.app-container` và `#modal-custom-dialog` vẫn nằm trong thứ tự tương tác.
- Nguyên nhân gốc: auth overlay chỉ làm mờ/che bằng CSS; không dùng `inert`, `aria-hidden` và focus trap. Dialog accessibility cũng không cô lập modal inactive.
- Cách sửa: đồng bộ trạng thái a11y của auth overlay, app, skip-link và modal; trap Tab trong auth; thêm role/label dialog.
- File/test: `frontend/auth/AuthUi.js`, `frontend/shared/dialogAccessibility.js`, `frontend/app/app.js`, `views/index.html`, `views/components/auth_overlay.html`, `views/modals/modal_custom_dialog.html`; `test:ui-quality-e2e`.
- Retest: 1280×720 và 390×844 không overflow; Tab/Shift+Tab không thoát; Browser plugin xác nhận app/modal `inert` + `aria-hidden`, font đúng.

### BUG-011: Outbox không tự retry khi mạng trở lại

- Trạng thái: `ĐÃ SỬA` — E2E offline/reconnect/interrupted request và PostgreSQL đạt.
- Mức độ: `High` — dữ liệu đã lưu cục bộ có thể nằm chờ vô thời hạn sau mất mạng.
- Tín hiệu đỏ: lưu chuyên gia khi offline giữ pending outbox, `navigator.onLine=true` sau khôi phục nhưng không có request `/api/sync` trong 20 giây.
- Nguyên nhân gốc: listener `online` chỉ đổi nhãn trạng thái; không biết còn mutation pending để gọi `autoSync`. Nút retry chỉ pull dữ liệu, không push outbox trước.
- Cách sửa: theo dõi `pendingMutationCount`; khi online lại thì tự `autoSync`; retry thủ công đẩy mutation trước khi tải snapshot.
- File/test: `frontend/app/BiddingControllerSync.js`; `scripts/verify_offline_sync_e2e.mjs`; lệnh `test:offline-sync-e2e`.
- Retest: offline trước lưu và abort giữa request đều commit sau retry; UI/reload/API phân trang/PostgreSQL chỉ có đúng 1 bản ghi mỗi trường hợp; fixture cleanup.

### BUG-012: Trusted Types chặn cả chuỗi XSS đã escape, làm bảng trắng

- Trạng thái: `ĐÃ SỬA` — unit, E2E UI/API/PostgreSQL đạt.
- Mức độ: `Medium` — dữ liệu văn bản hợp lệ có từ `onerror=` làm renderer dừng, bảng trống và phát sinh unhandled rejection.
- Tín hiệu đỏ: PostgreSQL/API trả `totalItems=1` với tên `<img ... onerror=...>`, nhưng UI không render; console báo `Unsafe HTML rejected` tại `renderVirtualTable`.
- Nguyên nhân gốc: prefilter Trusted Types quét regex thuộc tính sự kiện trên toàn chuỗi HTML, kể cả text đã mã hóa `&lt;...&gt;`.
- Cách sửa: phân tích riêng tag HTML thật và thuộc tính của tag; text/giá trị thuộc tính đã escape không bị hiểu nhầm. Thẻ thật có event handler và URL `javascript:` vẫn bị từ chối; DOMPurify vẫn giữ nguyên.
- File/test: `frontend/shared/trustedTypes.js`; `tests/js/trusted_types_text_safety.test.mjs`; `test:auth-roles-e2e`.
- Retest: payload hiển thị nguyên văn, không tạo `<img>`, không chạy handler; 4/4 regression bảo mật đạt.

### BUG-013: Chuyển workspace thành công nhưng reload quay về workspace mặc định

- Trạng thái: `ĐÃ SỬA` — UI switch, reload và server authorization E2E đạt.
- Mức độ: `High` — dễ thao tác nhầm phạm vi tổ chức sau tải lại trang.
- Tín hiệu đỏ: UI lưu `bf_active_org` của tổ chức thứ hai; reload ghi đè bằng tổ chức đầu tiên và không gọi `/api/auth/check-session` với workspace đã chọn.
- Nguyên nhân gốc: script initial-route ưu tiên `embedded.user.active_org_id` hơn lựa chọn local/session; app tái sử dụng embedded session dù hai workspace lệch nhau.
- Cách sửa: initial route ưu tiên workspace đã lưu nếu còn trong danh sách được phép; app refresh session khi embedded workspace khác lựa chọn đã lưu.
- File/test: `views/vendor/initial-route.js`, `frontend/app/app.js`, `frontend/auth/sessionBootstrapPolicy.js`, `tests/js/session_bootstrap_workspace.test.mjs`, `test:auth-roles-e2e`.
- Retest: quản lý thấy đủ workspace được phép, chuyển tổ chức, reload vẫn giữ đúng client state; server chấp nhận `X-Active-Org`; cross-workspace trái quyền vẫn 403.

## 8. Nhật ký bằng chứng

| Thời điểm | Test case | Hành động/Bằng chứng | Kết quả |
|---|---|---|---|
| 2026-07-29 05:21 | BOOT-01 | Đọc đầy đủ prompt 1.777 dòng; đọc skill Browser và Diagnosing Bugs | ĐẠT |
| 2026-07-29 05:22 | BOOT-02 | Browser MCP bootstrap thử 2 lần qua URL inference | BỊ CHẶN bởi sandbox helper |
| 2026-07-29 05:30 | BOOT-03 | Người dùng yêu cầu Browser plugin; gọi trực tiếp in-app Browser lần thứ 3 | BỊ CHẶN bởi cùng sandbox helper trước khi runtime khởi tạo |
| 2026-07-29 | BOOT-04 | Khởi tạo lại Codex In-app Browser sau khi gỡ sandbox; mở `http://127.0.0.1:8000/dang-nhap` | ĐẠT — form đăng nhập có đủ username/password, loader `aria-busy=false`, overlay hiển thị |
| 2026-07-29 | BASE-01 | `python -m pytest -q` | ĐẠT — 85/85 |
| 2026-07-29 | BASE-02 | `node --test tests/js/*.test.mjs` | ĐẠT — 59/59 |
| 2026-07-29 | BASE-03 | `npm run lint:security`; `npm run audit:vendor`; `npm run build` | ĐẠT |
| 2026-07-29 | BASE-04 | `npm run test:auth-shell`; chạy riêng để loại nhiễu tải | ĐẠT |
| 2026-07-29 | BASE-05 | `npm run test:performance`; chạy riêng, 30 cold + 30 warm | ĐẠT |
| 2026-07-29 | LIFE-01 | Chạy `npm run test:lifecycle` lần đầu | KHÔNG ĐẠT — BUG-001 |
| 2026-07-29 | LIFE-02 | Regression thứ tự refresh → mở kết quả; chạy lại `npm run test:lifecycle` | ĐẠT — 31 mốc, gồm 1G1T, 1G2T, phân lô, hủy, đấu thầu lại, hợp đồng đến thanh lý |
| 2026-07-29 | GOODS-01 | `npm run test:bidder-goods-e2e` với ba file `Dự thầu…xlsx` | ĐẠT — 1G1T/1G2T, không phân lô/phân lô, reload, PostgreSQL, context thứ hai, cleanup |
| 2026-07-29 | GOODS-02 | Phân loại fixture: `Dự thầu…xlsx` dùng cho hàng hóa dự thầu nhà thầu; `Không phân lô.xlsx`/`Phân lô - …xlsx` dùng cho danh mục hàng hóa gói thầu | ĐẠT — không trộn hai schema import |
| 2026-07-29 | AUTH-01 | `npm run test:auth-roles-e2e` với fixture tự tạo/tự xóa | ĐẠT — 10 nhóm auth/RBAC; thêm CRUD chuyên gia theo quyền, cấm xóa employee, thu hồi edit→view có hiệu lực tức thì, manager sửa/xóa; không ghi secret |
| 2026-07-29 | AUTH-02 | Audit schema/route: không có refresh token; không có trạng thái account locked/disabled riêng | KHÔNG ÁP DỤNG — dùng email chưa xác minh, membership `left`, organization `suspended` theo model thực tế |
| 2026-07-29 | JV-UI-01 | `npm run test:joint-venture-e2e` | ĐẠT — tạo/chặn trùng/lưu PostgreSQL/reload/giá dưới 50%/phê duyệt/đủ thành viên/cleanup |
| 2026-07-29 | JV-UI-02 | Chạy lại `npm run test:joint-venture-e2e` sau mở rộng 3 thành viên/nhiều lô | ĐẠT — 3 thành viên; từ chối/chấp thuận/rerank; reload/relogin; hai Excel; cùng liên danh dự 2 lô, trúng JV-L1, bị loại dưới 50% ở JV-L2, winner khác lên hạng; cleanup |
| 2026-07-29 | JV-UI-03 | Mở rộng `npm run test:joint-venture-e2e` cho báo cáo, hợp đồng và 1G2T | ĐẠT — báo cáo tổng quát/chi tiết giữ quyết định; hợp đồng liên danh reload/PostgreSQL đúng gói, giá và 3 thành viên; 1G2T không lộ giá sớm, chỉ liên danh đạt kỹ thuật sang tài chính, chấp thuận dưới 50%, trúng thầu; cleanup |
| 2026-07-29 | DOCX-01 | Upload/kích hoạt mẫu Word, export báo cáo kết quả liên danh, mở và render từng trang | ĐẠT SAU BUG-008 — DOCX 35.674 byte, 18 đoạn, Arial; đủ 3 thành viên và `Chấp thuận`; PNG 1 trang sạch, Unicode đúng |
| 2026-07-29 | CRUD-01 | `npm run test:crud-modules-e2e` | ĐẠT SAU BUG-009 — chủ đầu tư/nhà thầu/chuyên gia/kế hoạch/gói/hợp đồng C-U-D; validation/versioning/reload; PostgreSQL 0 active/latest và fixture cleanup |
| 2026-07-29 | CRUD-02 | Mở rộng `test:crud-modules-e2e` | ĐẠT — mobile card 390×844 + Enter mở modal; tìm kiếm/phân trang chuyên gia 15 dòng (10+5); PDF MIME giả/quá 25 MB/tên traversal bị chặn hoặc làm sạch; download giữ đúng bytes |
| 2026-07-29 | DOC-XLSX-01 | `python -m pytest -q tests/test_document_worker_excel_exports.py` | ĐẠT — 9/9; regression BUG-005 |
| 2026-07-29 | LP-RULE-01 | `node --test tests/js/low_price_matrix.test.mjs` | ĐẠT — 7/7 nhóm, bao phủ biên, giảm/hiệu chỉnh, lô/gói, accept/reject, đổi giá, cô lập lô và rerank |
| 2026-07-29 | LP-CONFLICT-01 | `npm run test:low-price-conflict-e2e` | ĐẠT — hai tài khoản cùng rowVersion 1; stale write bị 409 `ROW_VERSION_CONFLICT`; version cuối 2, quyết định cuối `true`; cleanup 1 tổ chức/2 tài khoản |
| 2026-07-29 | PAIRWISE-01 | `npm run test:package-pairwise-e2e` | ĐẠT — 15/15 tổ hợp UI/reload/PostgreSQL; đủ 5 lĩnh vực, 6 hình thức, 4 phương thức, 5 phương pháp, có/không phân lô; không lỗi console/API; cleanup |
| 2026-07-29 | LP-SYNC-01 | `python -m pytest -q tests/test_bid_evaluation_prices.py` | ĐẠT — 8/8, gồm payload boolean giá dưới 50% |
| 2026-07-29 | LP-UI-02 | Mở rộng `test:joint-venture-e2e` cho biên UI | ĐẠT — 50% lưu decision null; 49,9999%/49%/30%/1 đồng cảnh báo; trên 50% không cảnh báo; chuyển xuống dưới 50% bắt buộc chọn; reload/PostgreSQL đúng |
| 2026-07-29 | UI-LOGIN-01 | Browser plugin đo và chụp trước/sau nút Google | ĐẠT SAU SỬA — 344→40 px; SVG 300→18 px; font tiếng Việt đúng |
| 2026-07-29 | UI-BROWSER-02 | Browser plugin retest BUG-001/002/003/006 trong phiên đăng nhập fixture cô lập | ĐẠT — tab kết quả xuất hiện ngay; nút thành viên liên danh hiển thị; boolean giá thấp lưu/reload đúng; Chỉ định thầu có đủ phương pháp |
| 2026-07-29 | UI-A11Y-03 | `npm run test:ui-quality-e2e` + Browser plugin | ĐẠT SAU BUG-010 — desktop/mobile không overflow, Plus Jakarta Sans/Unicode đúng, keyboard/accessible name/validation/lỗi mạng đạt; app và modal nền inert |
| 2026-07-29 | SYNC-OFFLINE-01 | `npm run test:offline-sync-e2e` | ĐẠT SAU BUG-011 — offline trước lưu và mất mạng giữa request; reconnect/explicit retry; outbox→PostgreSQL; không trùng; cleanup |
| 2026-07-29 | SEC-01 | Mở rộng `npm run test:auth-roles-e2e` | ĐẠT SAU BUG-012/013 — CSRF token/Origin, mass assignment, stored XSS literal, workspace UI switch+reload, quản trị nhân sự UI, cross-workspace và session |
| 2026-07-29 | CLEANUP-01 | Xóa fixture Browser thủ công theo thứ tự liên danh → nền/tài khoản; đóng tab tạm | ĐẠT — xóa 2 tổ chức và 1 tài khoản fixture |
| 2026-07-29 | REG-01 | `python -m pytest -q` sau sửa | ĐẠT — 95/95 |
| 2026-07-29 | REG-02 | `node --test tests/js/*.test.mjs` sau sửa | ĐẠT — 67/67 |
| 2026-07-29 | REG-03 | `npm run lint:security`; `npm run audit:vendor`; `npm run build` | ĐẠT |
| 2026-07-29 | REG-04 | `test:auth-shell`; `test:auth-roles-e2e`; `test:bidder-goods-e2e`; `test:lifecycle`; `test:joint-venture-e2e` | ĐẠT, mọi fixture cleanup thành công |
| 2026-07-29 | REG-05 | `npm run test:performance` | ĐẠT — cold p95 463 ms < 800; warm trong ngưỡng 300; không long task/runtime failure |
| 2026-07-29 | REG-06 | Regression cuối: `python -m pytest -q`; `node --test tests/js/*.test.mjs`; security lint; vendor audit; build; toàn bộ E2E auth, hàng hóa, CRUD, liên danh, giá thấp, pairwise, offline, UI và performance | ĐẠT — 97/97 Python, 77/77 JavaScript; cold p95 570 ms < 800; warm đạt ngưỡng; không long task/runtime failure |
| 2026-07-29 | LIFE-03 | Chạy xác nhận `npm run test:lifecycle` sau một lần timeout ngẫu nhiên ở bước chờ tab `qualified` | ĐẠT hai lần liên tiếp — đủ 33 mốc; timeout không tái hiện, không có lỗi console/API và fixture hoàn tất |

## 9. TỔNG KẾT

- Branch: `main`
- Commit ban đầu: `516f9d9`
- Commit sau sửa: Chưa có
- Plugin/MCP/skill: Browser plugin, Node REPL MCP; control-in-app-browser, diagnosing-bugs
- Số vai trò/phạm vi quyền: 4 (owner, manager, employee và tài khoản ngoài tổ chức/không được cấp quyền)
- Số phạm vi chức năng chính: 19 (F-001…F-019)
- Số test case ma trận chính: 86 (19 luồng F, 15 tổ hợp pairwise, 30 trường hợp giá dưới 50%, 22 trường hợp liên danh)
- Đạt: 80/80 trường hợp áp dụng; 6/86 trường hợp không có workflow/schema tương ứng được ghi rõ `KHÔNG ÁP DỤNG`
- Không đạt: 0 test case sản phẩm
- Bị chặn: 0 ở thời điểm hiện tại; sự cố Browser plugin đã được khôi phục
- Tổng lỗi: 13 lỗi sản phẩm đã xác nhận
- Blocker/Critical/High/Medium/Low: 0/0/10/3/0
- Lỗi đã sửa: 13 (cả 13 đã được retest bằng Browser plugin hoặc E2E tương ứng; không còn lỗi chờ retest)
- Lỗi chưa thể sửa: 0
- Test tự động bổ sung: lifecycle/auth role/bidder goods/JV/LP conflict/pairwise/CRUD/offline/UI E2E; regression BUG-001…013
- Kết quả pytest/frontend/E2E/build: 97 Python + 77 JavaScript đạt; security lint, vendor audit, build và toàn bộ E2E đạt; lifecycle đạt 33 mốc trong hai lần liên tiếp sau một timeout ngẫu nhiên không tái hiện
- Kết quả kiểm thử liên danh: ĐẠT — 1G1T/1G2T, 3 thành viên, nhiều lô, UI/PostgreSQL/reload/relogin/giá thấp/phê duyệt/hợp đồng/Word/Excel đều đạt; thay đổi thành viên sau trúng thầu là `KHÔNG ÁP DỤNG` vì model hiện hành không có workflow/schema tương ứng
- Kết quả kiểm thử giá dưới 50%: ĐẠT — đủ LP-01…LP-30 qua rule, UI, reload/relogin, PostgreSQL, conflict và Word/Excel
- Rủi ro còn lại: không còn lỗi đã biết hoặc test case áp dụng nào chờ kiểm thử; tiếp tục theo dõi timeout ngẫu nhiên của lifecycle nếu tái xuất hiện trong CI dài hạn.
