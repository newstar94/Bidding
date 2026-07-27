# Kết quả lỗi sau kiểm thử toàn bộ ngày 2026-07-27

Trạng thái hiện tại: **không còn lỗi code mở trong phạm vi kiểm thử hiện tại**. Các lỗi đã sửa vẫn được giữ lại làm căn cứ truy vết.

## Phạm vi đã chạy

- Backend: toàn bộ 1.061 kiểm thử Python đạt, 1 kiểm thử bỏ qua theo điều kiện môi trường.
- Frontend: toàn bộ 244 kiểm thử JavaScript đạt.
- Trình duyệt: 17/17 E2E đạt, gồm doanh thu lần đầu, báo cáo chi tiết rỗng, route resource graph, bảng đánh giá 10/100/500 hồ sơ, bootstrap 100/1.000/5.000 nhà thầu, 500 tiêu chí, 6 workbook thật và ma trận 7 trường hợp loại gói/phương thức/quy trình/phân lô/liên danh.
- Excel thật: 6/6 workbook MuaSắmCông nhận diện đúng nhóm và đúng sheet theo phương thức/phương pháp; 1G1T/1G2T, phân lô/không phân lô, kỹ thuật/tài chính tư vấn đều đạt, không warning.
- Build: security lint, Trusted Types, vendor audit, Excel archive guard và secure production build đạt.

## Lỗi code phát hiện trong hậu kiểm

### BUG-09 — STT tab Tính hợp lệ bị trùng sau khi bỏ dòng thỏa thuận liên danh

- **Trạng thái:** Đã sửa ngày 2026-07-27 sau khi kiểm thử runtime thật phát hiện lỗi.
- **Mức độ:** Trung bình; dữ liệu đánh giá vẫn còn nhưng bảng và báo cáo Word có thể mang số mục sai.
- **Cách tái hiện:** Đăng nhập → chuyển vai trò Chuyên viên → mở gói `IB2500426517` → Báo cáo đánh giá E-HSDT → Báo cáo đánh giá chi tiết → tab Tính hợp lệ.
- **Hiện tại:** Nhà thầu là “Độc lập” nên dòng “Thỏa thuận liên danh” được loại đúng, nhưng STT hiển thị `1, 2, 2.1, 2.1.1, 2.1.2, 2.1.3, 2.1.4, 2.1.5, 2, 2`; số `2` xuất hiện ba lần.
- **Mong đợi:** Sau khi loại dòng liên danh, toàn bộ cây tiêu chí phải có STT phân cấp duy nhất và liên tục theo cấu trúc nguồn.
- **Bằng chứng:** Plugin trình duyệt đọc trực tiếp accessibility tree của runtime production-local và phát hiện `duplicates=["2"]`; dòng liên danh không còn hiện diện.
- **Phân loại:** Lỗi chuẩn hóa/đánh số trong code; không phải quy định nghiệp vụ. Logic cũ chỉ giảm phần số đầu khi bỏ dòng liên danh nhưng không kiểm tra trùng trên toàn cây.
- **Cách sửa:** Chuẩn hóa STT duy nhất theo từng nhóm trước bước lọc liên danh; khi số cha nguồn bị lặp, cấp số anh em kế tiếp và remap các số con theo cha mới. Criterion ID, kết quả và thứ tự dòng không thay đổi.
- **Regression:** Feedback loop thuần module đỏ với `actual=[1,2,2.1,2.1.1,2,2]`, xanh với `[1,2,2.1,2.1.1,3,4]`; thêm ca cha `1` lặp kèm con `1.1` để khóa kết quả `[1,1.1,2,2.1]`. Toàn bộ 245 test JavaScript và 1.061 test backend đạt.
- **Runtime thật sau đóng gói:** Plugin mở lại chính draft gói `IB2500426517` từ asset `app-SCWObzEl.js`; STT là `1, 2, 2.1, 2.1.1, 2.1.2, 2.1.3, 2.1.4, 2.1.5, 3, 4`, `duplicates=[]`, không có dòng thỏa thuận liên danh.

## Lỗi code đã xác nhận và xử lý

### BUG-01 — Trạng thái trang con báo cáo chi tiết bị giữ khi đổi gói thầu

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Trung bình.
- **Cách tái hiện:** Mở Gói A → Báo cáo đánh giá → Báo cáo chi tiết; quay về danh sách gói; mở Gói B → Báo cáo đánh giá.
- **Hiện tại:** Gói B mở thẳng trang báo cáo chi tiết. Nút “Báo cáo chi tiết” ở báo cáo tổng quát bị ẩn vì controller vẫn giữ trạng thái trang con của Gói A.
- **Mong đợi:** Khi package ID thay đổi, trạng thái trang con phải trở về báo cáo tổng quát; chỉ vào chi tiết sau khi người dùng bấm nút.
- **Bằng chứng:** 6/7 gói sau gói đầu trong browser matrix có `openedDetailedWithoutRequest=true`.
- **Phân loại:** Lỗi state/UI trong code, không phải quy định nghiệp vụ.
- **Cách sửa:** Khi package ID thay đổi, coordinator đặt `currentEvaluationView="summary"` và xóa cờ dirty điều hướng; map draft theo package/bid không bị xóa.
- **Regression:** E2E bắt buộc `openedDetailedWithoutRequest=false`; test đỏ trước sửa và xanh sau sửa. Unit test xác nhận đổi package reset trang con nhưng vẫn giữ draft, còn render lại cùng package không reset.

### BUG-02 — Một metrics timeout làm mất toàn bộ kết quả load rehearsal

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Thấp đối với ứng dụng, trung bình đối với độ tin cậy benchmark.
- **Cách tái hiện:** Chạy nhiều lượt production rehearsal; sau workload, để một trong các request song song tới `/metrics` trả `ReadTimeout` trong khi các worker khác vẫn phản hồi.
- **Hiện tại:** `asyncio.gather` fail-fast, script trả lỗi và không ghi kết quả workload dù toàn bộ request nghiệp vụ đã `200`.
- **Mong đợi:** Bỏ qua riêng metrics response lỗi, tiếp tục lấy snapshot từ response còn lại và báo đúng số worker quan sát được.
- **Phân loại:** Lỗi code trong công cụ benchmark, không phải quy định nghiệp vụ hay lỗi runtime ứng dụng.
- **Cách sửa:** Thu thập với `return_exceptions=True`, bỏ qua riêng exception/HTTP error và tiếp tục tối đa bốn vòng lấy mẫu.
- **Regression:** Test mô phỏng một response chậm đỏ trước sửa, xanh sau sửa; hai lượt production tiếp theo đều quan sát đủ 2/2 worker.

### BUG-03 — Bootstrap nhà thầu dò mảng O(n²) hai lần

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Trung bình về hiệu năng khi tổ chức có nhiều nhà thầu/version.
- **Cách tái hiện:** Bootstrap reference data với 1.000 identity; merge gọi 499.500 predicate, rồi persistence lookup gọi thêm 500.500 predicate.
- **Hiện tại:** 5.000 identity tạo long task dài nhất khoảng 373 ms dù bảng chỉ render 10 dòng.
- **Mong đợi:** Merge/persistence tuyến tính theo số identity; server pagination giữ DOM cố định theo page size.
- **Phân loại:** Lỗi độ phức tạp trong code frontend, không phải quy định nghiệp vụ.
- **Cách sửa:** Dựng `Map<id,index>` một lần và trả trực tiếp merged records cho batch persistence.
- **Regression:** Hai test đếm scan đỏ trước sửa, xanh sau sửa; microbenchmark merge 150,04 → 0,70 ms; E2E 5.000 identity giảm longest task 373 → 84 ms và còn đúng 10 row.

### BUG-04 — Production khởi tạo ứng dụng hai lần do hai URL của cùng entry module

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Cao; tạo DOM ID trùng, gọi bootstrap/sync/partial lặp và có thể hiển thị dữ liệu dashboard không đồng nhất.
- **Bằng chứng:** ZIP production tạo hai `#tab-superadmin-dashboard`; trace có hai lần tải partial, trong khi HTML ban đầu không chứa dashboard.
- **Nguyên nhân:** Script dùng asset băm kèm `?v=...`, còn import graph dùng cùng asset không có query; ESM coi là hai module identity.
- **Cách sửa:** Asset lấy từ Vite manifest dùng nguyên content-hash URL; mtime query chỉ dành cho fallback không băm.
- **Regression:** Test đóng gói khóa URL canonical; E2E khóa đúng một dashboard và route-trace production đạt.

### BUG-05 — CSP chặn đăng ký service worker vì thiếu TrustedScriptURL

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Trung bình; service worker không đăng ký và console production có lỗi an toàn.
- **Nguyên nhân:** `navigator.serviceWorker.register()` nhận chuỗi thường dưới `require-trusted-types-for 'script'`.
- **Cách sửa:** Cho phép hẹp `/service-worker.js?...` trong policy và truyền kết quả `trustedScriptURL()` vào sink; tắt runtime module-preload injection của Vite.
- **Regression:** Security gate khóa source/config; production route-trace không còn console/page/network error.

### BUG-06 — Worker xuất Excel nạp dư tầng ứng dụng và database

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Trung bình về hiệu năng; không làm sai dữ liệu workbook.
- **Bằng chứng:** Export 10–100 dòng trực tiếp chỉ mất 6–38 ms nhưng qua worker mất khoảng 1,1 giây; fresh-process import `excel_service` mất khoảng 0,9–1,1 giây.
- **Phân loại:** Bottleneck dependency graph trong code, không phải quy định nghiệp vụ.
- **Cách sửa:** Tách workbook builder thuần, để worker không nạp `excel_service` và shared helper khi export không cần database.
- **Kết quả:** Worker median giảm 27,4–56,5% trên 10–10.000 dòng; regression import-boundary và correctness suite đều đạt.

### BUG-07 — Reset metric kiểm thử bỏ sót database phase counters

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Thấp; ảnh hưởng độ cô lập của test/diagnostic, không làm sai dữ liệu nghiệp vụ.
- **Nguyên nhân:** `_reset_metrics_for_tests` xóa operation/duration counters nhưng không xóa phase count/sum/bucket/max.
- **Phân loại:** Lỗi code utility quan sát, không phải quy định nghiệp vụ.
- **Cách sửa:** Recorder sở hữu một interface reset duy nhất, xóa toàn bộ state dưới cùng lock; test ghi phase → reset → snapshot rỗng khóa hồi quy.

### BUG-08 — Audit độc lập không trả kết nối về PostgreSQL pool

- **Trạng thái:** Đã sửa ngày 2026-07-27.
- **Mức độ:** Cao; có thể làm cạn pool và phát sinh `connection timeout expired` sau nhiều thao tác có audit.
- **Bằng chứng:** Cả append thành công và lỗi đều có `close_calls=0`; `append_audit_row` chỉ commit/rollback. Có 14/36 call site dùng audit độc lập không gắn transaction cursor.
- **Phân loại:** Lỗi vòng đời tài nguyên trong code, không phải quy định nghiệp vụ hoặc lỗi PostgreSQL.
- **Cách sửa:** Đóng kết nối trong `finally` và import trực tiếp database primitive thay vì mega-facade.
- **Regression:** Fake connection khóa đúng một lần close; PostgreSQL pool 1 slot chạy 5 lượt liên tiếp không có request chờ hay mất slot.

## Không phải lỗi ứng dụng

- Một lượt E2E ghi `net::ERR_ABORTED` khi điều hướng hủy request phân trang cũ. Ca này chạy lặp 3/3 đạt và mọi DOM assertion đều đúng; harness đã bỏ qua riêng mã hủy điều hướng chuẩn này, vẫn bắt các request failure khác.
- Ba workbook hàng hóa có sheet kỹ thuật 03A/03B nhưng nội dung tiêu chí chỉ là dấu `-`; parser không tạo dòng đánh giá từ placeholder rỗng. Đây là trạng thái file nguồn, không phải mất dữ liệu do code.
- WebSocket từng trả `403` khi production test server chạy cổng `18084` nhưng môi trường vẫn mặc định `APP_PORT=8000`. Sau khi đặt đúng `APP_PORT=18084`, kết nối và toàn bộ route-trace đạt; đây là sai cấu hình test.
- Sau cleanup, tiến trình phát triển cũ ở cổng 8000 còn `APP_DEBUG=True` nên yêu cầu DOMPurify từ `node_modules` đã được dọn và màn hình dừng ở trạng thái tải. Khởi động lại với `APP_DEBUG=False` dùng asset content-hash trong `dist` thì đăng nhập, dashboard, danh sách gói và báo cáo chi tiết đều hoạt động, không có console warning/error. Đây là sai chế độ chạy hậu-cleanup, không phải lỗi production package.

## Giới hạn môi trường

- Đã có 5 lượt source và 5 lượt production package cục bộ; chưa có số đo staging/production thực tế bằng dữ liệu thật.
- Browser plugin tích hợp đã đăng nhập thật vào ứng dụng hậu-cleanup tại `http://127.0.0.1:8000/`, chuyển sang vai trò Chuyên viên và mở tới báo cáo chi tiết của gói `IB2500426517`; tab được giữ mở cho người dùng kiểm tra.
- Plugin xác nhận runtime `APP_DEBUG=False` dùng đúng một module content-hash trong `dist` và không có console warning/error. Trước đó production shell từ ZIP tại cổng 18084 cũng đạt route-trace; toàn bộ 17/17 E2E đã đạt trên cùng mã nguồn.
- Ma trận trình duyệt dùng fixture tại network boundary để không ghi dữ liệu kiểm thử vào database. Các test backend/frontend bao phủ lưu/reload, Excel, kết quả, hợp đồng và Word nhưng chưa thay thế một lượt staging với dữ liệu thật.

## Hậu kiểm production-local sau cleanup — 2026-07-27

- Plugin đăng nhập thật, chuyển Super Admin → Chuyên viên, mở danh sách gói, gói `IB2500426517`, báo cáo tổng quát và đủ bốn tab Tính hợp lệ/Năng lực và kinh nghiệm/Kỹ thuật/Tài chính.
- Runtime xác nhận draft 18/21 tiêu chí được tải lại; tab tài chính chỉ có `STT / Nội dung / Giá trị`; tiêu đề bảng sticky ở `top: 0`; font `Plus Jakarta Sans`.
- Không có “Lý do không đạt”, cột “Làm rõ” hoặc `nguoi_cham_id` trong báo cáo chi tiết. Dòng thỏa thuận liên danh được bỏ đúng cho nhà thầu độc lập.
- Trường hợp nội dung file đã nhập nhắc tới nhà thầu khác không được ghi là bug: theo ADR 0006/NV6, sai tên chỉ cảnh báo và người dùng vẫn có quyền chọn “Vẫn nhập”.
- `live=200`, `ready=200`, `metrics=200`; metrics có đủ document worker, partner, WebSocket, audit và database series.
