# ADR 0103: Cảnh báo hiệu lực HSDT và mốc tiến độ quá hạn

- Ngày: 2026-11-14
- Trạng thái: Chấp nhận. Chủ sản phẩm chọn triển khai (mục 2C, 2026-11-13) và xác nhận ngày 2026-11-14: cảnh báo trước 7 ngày; ngày có thời điểm đóng thầu là ngày hiệu lực thứ nhất. Không làm cảnh báo "làm rõ chưa trả lời" vì giới hạn dữ liệu (quyết định 5).
- Phạm vi: `backend/sync/dashboard_summary.py`, `backend/sync/deadline_alerts.py` (mới), `frontend/app/dashboardAlertRules.js`, `DashboardView.js`, `NotificationCenter.js`

## Bối cảnh

Tổng quan có 8 loại cảnh báo: đóng/mở thầu, chậm báo cáo đánh giá, hợp đồng hết hạn, đăng tải kế hoạch. Chưa có cảnh báo khi hiệu lực HSDT hoặc bảo đảm dự thầu sắp hết trong lúc đang đánh giá, và chưa cảnh báo mốc trên tab Tiến độ đã qua ngày dự kiến.

## Quyết định

1. **`bidValidityExpiring` — Hiệu lực HSDT sắp hết.**
   - Áp dụng cho gói có trạng thái hiệu lực (theo kết quả chính thức) là Đã mở thầu, Đang chấm thầu hoặc Đã có kết quả một phần.
   - Thời điểm đóng thầu là giá trị muộn nhất giữa gói thầu và các lần gia hạn đã lưu (`goi_thau_gia_han`), giống tab Tiến độ.
   - Ngày cuối có hiệu lực = ngày đóng thầu + N − 1 ngày: ngày có thời điểm đóng thầu tính là ngày thứ nhất.
   - Tính cho cả số ngày hiệu lực HSDT và hiệu lực bảo đảm dự thầu của gói thầu; lấy ngày sớm hơn. Gói không có số ngày nào thì không cảnh báo.
   - Cảnh báo khi ngày cuối ≤ hôm nay + 7 ngày, kể cả khi đã hết hạn (chi tiết ghi "Còn N ngày" hoặc "Đã hết hiệu lực N ngày").
2. **`milestoneOverdue` — Mốc tiến độ quá hạn.**
   - Cùng quy tắc `is_overdue` mà xuất Word tiến độ đang dùng: mốc APPLICABLE, có ngày dự kiến trước hôm nay, chưa có ngày thực tế, trạng thái khác DONE/NOT_APPLICABLE. Quy tắc nay nằm ở một hàm dùng chung `timeline_row_is_overdue`.
   - Dòng đã lưu trong `goi_thau_moc_tien_do` chỉ dùng để chọn ứng viên. Mỗi ứng viên được đánh giá lại bằng `build_effective_timeline` để mốc tự động lấy ngày từ dữ liệu khác không bị báo nhầm.
   - Bỏ qua gói Hủy thầu. Tối đa 200 gói ứng viên mỗi lần dựng Tổng quan (ưu tiên ngày dự kiến gần nhất); vượt ngưỡng thì `milestoneAlertPartial = true`.
   - Chỉ tính ở máy chủ. Khi Tổng quan dựng từ dữ liệu cục bộ (không có bản tóm tắt máy chủ), cảnh báo này không xuất hiện.
3. Hai cảnh báo mới **không loại trừ** cảnh báo trạng thái hiện có: một gói vừa "Chậm báo cáo đánh giá" vừa "Hiệu lực HSDT sắp hết" xuất hiện ở cả hai. Chúng chỉ hiện trong "Việc cần xử lý" và chuông thông báo, giống cảnh báo kế hoạch và hợp đồng. Không thêm thẻ cảnh báo, không thêm bộ lọc danh sách gói thầu (`package_alert_conditions` giữ nguyên).
4. Thứ tự ưu tiên: Quá hạn mở thầu → Hợp đồng hết hạn → Quá hạn đăng kế hoạch → **Hiệu lực HSDT** → Đóng thầu hôm nay → Chậm báo cáo đánh giá → **Mốc quá hạn** → Hợp đồng sắp hết hạn → Cần đăng kế hoạch → Sắp đóng thầu.
5. Không làm cảnh báo "yêu cầu làm rõ chưa trả lời": `goi_thau_lam_ro` không liên kết yêu cầu với câu trả lời, và ADR 0012 cấm ghép cặp theo thứ tự, thời gian hoặc nội dung.

## Không thay đổi

Cảnh báo dùng đúng tập gói thầu hiển thị của bản tóm tắt hiện tại (`visible_packages`: tenant, bản mới nhất, chưa lưu trữ, phân công với nhân viên). Không đổi role, module permission, record/assignment scope, entitlement hay hiển thị dữ liệu. 8 cảnh báo cũ giữ nguyên định nghĩa và thứ tự tương đối.

## Tương thích và triển khai

Không có migration. Phản hồi tóm tắt có thêm hai khóa trong `alertCounts` và trường `milestoneAlertPartial`; client cũ bỏ qua khóa lạ (`ALERT_META` dự phòng). Cần build lại frontend. Rollback: bỏ hai hàm tính và hai khóa; quy tắc `is_overdue` của Word không đổi nghĩa.

## Regression seams

`tests/test_deadline_alerts.py` (quy tắc ngày, cửa sổ 7 ngày, gia hạn, múi giờ, xác nhận ứng viên bằng timeline hiệu lực, giới hạn ứng viên, đối chiếu khóa/thứ tự/ngưỡng với JS), `tests/js/dashboard_bid_validity_alert.test.mjs`.
