# ADR 0031 — Thống kê hành vi sử dụng phục vụ quyết định thương mại

- Trạng thái: Chấp nhận
- Ngày: 2026-08-30
- Phạm vi: Telemetry hành vi sản phẩm và bảng điều khiển Super Admin

## Bối cảnh

Chủ sản phẩm cần biết số người đang online, khung giờ sử dụng cao nhất, tính năng được dùng nhiều nhất và mức sử dụng trung bình để thiết kế gói trả phí, định giá và cách bán hàng. Audit bảo mật hiện có không phù hợp làm nguồn báo cáo sản phẩm: audit phải giữ ngữ nghĩa truy vết thay đổi, còn telemetry sản phẩm cần ít chiều dữ liệu, tổng hợp nhanh và không được làm chậm nghiệp vụ.

## Quyết định

1. Tạo luồng `usage analytics` riêng với event name và feature code nằm trong allowlist do code quản lý. Event không nhận metadata tùy ý, URL/query, nội dung biểu mẫu, tên tệp, record ID, CCCD, tài khoản ngân hàng, chữ ký, con dấu hoặc dữ liệu của bản ghi nghiệp vụ.
2. Client chỉ gửi heartbeat hiện diện và việc mở/sử dụng một tính năng đã đăng ký. Khối lượng công việc lấy từ ledger `nhat_ky_thuc_hien` đã được ghi nguyên tử tại success seam; lượt xuất Word lấy từ success seam phía máy chủ. Client không phải nguồn có thẩm quyền cho hai chỉ số này.
3. Telemetry là best-effort. Lỗi ghi, timeout hoặc backpressure không được làm thay đổi kết quả điều hướng, lưu nghiệp vụ hay xuất tài liệu. Telemetry không thay thế security audit và không được dùng làm căn cứ cấp quyền hoặc trừ quota.
4. Bảng điều khiển dùng control plane Super Admin hiện hữu; không tạo role, capability, module permission hoặc entitlement mới. API tổng hợp phải xác minh phiên và vai trò `super_admin` phía máy chủ. Các API đọc bản ghi và toàn bộ tenant/module/assignment/record scope hiện hữu không thay đổi.
5. Dữ liệu thời gian được lưu theo UTC. Bộ lọc ngày và nhãn khung giờ trên dashboard dùng múi giờ sản phẩm `Asia/Ho_Chi_Minh`, đồng thời response công bố rõ timezone và thời điểm sinh báo cáo.

## Contract chỉ số

| Chỉ số | Định nghĩa |
| --- | --- |
| Online hiện tại | Số user khác nhau có heartbeat trong 2 phút gần nhất. Nhiều tab của cùng một user chỉ tính một. Tab bị ẩn không tiếp tục tự nhận là hoạt động. |
| Khoảng cao điểm | Bucket giờ/ngày trong khoảng chọn có nhiều user khác nhau phát heartbeat nhất; nếu hòa, chọn bucket sớm nhất và trả cả đầu/cuối bucket. Đây là peak theo bucket, không phải số kết nối đồng thời tuyệt đối. |
| Người dùng hoạt động | Hợp số user khác nhau có ít nhất một `feature.used`, một dòng activity nghiệp vụ hoặc một lượt xuất Word thành công trong khoảng chọn; heartbeat đơn thuần không đủ. |
| Tính năng hay dùng | Xếp hạng theo số event `feature.used`; kèm số user duy nhất để phân biệt tần suất với độ phủ. Chỉ dùng feature code ổn định, không dùng URL động. |
| Hoạt động công việc/người | Số dòng `nhat_ky_thuc_hien` có actor chia cho số người dùng hoạt động trong cùng khoảng, kể cả người hoạt động nhưng không có activity nghiệp vụ. Ledger hiện ghi các thay đổi gói thầu/hợp đồng, phân công và tài liệu gói thầu đã thành công; đây là số hoạt động nghiệp vụ, không được diễn giải thành số workflow đã hoàn tất. |
| Lượt xuất Word/người | Tổng `word_export.completed` được ghi nguyên tử khi xuất trực tiếp thành công hoặc khi durable document job chuyển duy nhất từ `processing` sang `completed`, chia cho số người dùng hoạt động trong cùng khoảng. Preview/validate, lỗi, retry không thắng chuyển trạng thái và tải lại artifact không được tính. |
| Độ phủ dữ liệu | Ngày trước thời điểm telemetry đầu tiên không được zero-fill hoặc diễn giải là không có sử dụng. Response công bố `coverage.hasData`, `coverage.startedAt` và `coverage.partial`; khoảng giao với thời điểm bắt đầu đo chỉ tổng hợp từ thời điểm đó và phải được UI ghi rõ là dữ liệu một phần. |

Response trả cả tử số, mẫu số và giá trị trung bình để dashboard không che mất cỡ mẫu. Khoảng ngày là nửa mở `[from, to + 1 ngày)`; khoảng không có người hoạt động trả trung bình `0`, không chia cho số tài khoản đã đăng ký.

`eventCount`/“Tổng hoạt động được đo” bằng lượt dùng tính năng + activity nghiệp vụ + lượt xuất Word thành công trong khoảng chọn. Heartbeat không nằm trong tổng này vì presence được upsert theo user/bucket và không phải raw event counter.

## Compatibility impact

- Bổ sung bảng/index telemetry và API mới; không sửa dữ liệu nghiệp vụ hiện có.
- Không thay đổi masking, redaction, dữ liệu người dùng được phép xem, role, permission, assignment scope, record scope hoặc entitlement. Đặc biệt, entitlement Word vẫn chỉ kiểm soát hành động tạo/tải Word; event analytics không mở hoặc che dữ liệu.
- Heartbeat tạo thêm một request nhẹ theo chu kỳ khi ứng dụng đang hiển thị. Ghi nhận được rate-limit/dedupe và thất bại âm thầm để không ảnh hưởng thao tác chính.
- Báo cáo toàn hệ thống chỉ trả số liệu tổng hợp và feature code/label đã đăng ký, không trả danh sách user, tenant hoặc record.

## Migration và rollout

1. Migration chỉ tạo cấu trúc telemetry rỗng và index theo thời gian/user/feature; không backfill suy đoán từ audit vì hai nguồn có semantics khác nhau.
2. Triển khai writer và endpoint tổng hợp trước, sau đó bật tracker client. Dữ liệu trước thời điểm rollout được hiển thị là không có dữ liệu, không diễn giải thành 0 sử dụng lịch sử.
3. Theo dõi dung lượng, tỷ lệ event bị drop và chi phí truy vấn. Việc thêm retention/rollup hoặc export dữ liệu là thay đổi tiếp theo, cần nêu rõ thời hạn lưu và đường migration trước khi bật.
4. Rollback có thể dừng tracker và bỏ route dashboard mà không ảnh hưởng bảng nghiệp vụ. Không dùng việc rollback telemetry để xóa audit hoặc lịch sử nghiệp vụ.

## Regression seams

- POST event: bắt buộc phiên hợp lệ, allowlist event/feature, rate limit/dedupe và từ chối metadata ngoài contract;
- activity/Word success seam: activity ledger dedupe đúng mutation; chỉ xuất Word thành công mới tăng chỉ số, request lỗi/preview không tăng;
- GET summary: chỉ Super Admin, boundary ngày/timezone, distinct user, nhiều tab, peak tie-break, zero denominator và giới hạn khoảng truy vấn;
- coverage: khoảng hoàn toàn trước rollout trả trạng thái chưa có dữ liệu, khoảng cắt qua rollout đánh dấu một phần và không đọc activity trước lúc bắt đầu đo;
- frontend lifecycle: heartbeat chỉ khi authenticated + visible, dừng khi logout/ẩn tab và lỗi telemetry không làm hỏng điều hướng;
- dashboard: trạng thái loading/empty/error, bộ lọc ngày, timezone/định nghĩa chỉ số và response không chứa user/tenant/record detail;
- regression quyền: API đọc bản ghi và Word action entitlement hiện hữu giữ nguyên hành vi.
