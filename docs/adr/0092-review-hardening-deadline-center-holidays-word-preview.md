# ADR 0092: Sửa lỗi sau rà soát 2026-10, trung tâm hạn chót, quản lý ngày lễ và xem trước Word

- Ngày: 2026-10-22
- Trạng thái: Được chủ sản phẩm yêu cầu
- Phạm vi: xác thực, khởi động phiên, đồng bộ, hiệu năng tải, tính năng mới

## Quyết định

1. **Khoá đăng nhập**: bộ đếm theo tài khoản chỉ tăng khi kiểm tra mật khẩu thất bại, không tăng với request bị chặn ở Turnstile. Khi tài khoản đã vượt ngưỡng và Turnstile đang bật, người dùng giải thử thách vẫn được thử mật khẩu; khi Turnstile tắt giữ 429 như trước.
2. **OTP đăng ký**: mỗi mã chịu tối đa `REGISTRATION_OTP_MAX_FAILURES` (5) lần sai rồi bị huỷ. Đăng ký chưa xác minh có mã hết hạn quá `UNVERIFIED_ACCOUNT_RELEASE_HOURS` (72 giờ) và không có định danh ngoài được tái sử dụng tại chỗ khi có người đăng ký lại cùng username/email.
3. **Liên kết Google**: lần đầu liên kết Google vào tài khoản đã có mật khẩu gửi email cảnh báo (`user_notification`); mật khẩu và liên kết khôi phục đang có giữ nguyên.
4. **Khởi động phiên**: lỗi hạ tầng khi dựng trang trả `valid: null` để trình duyệt kiểm tra lại phiên (có thử lại) thay vì hiện màn hình đăng nhập. `ensure_personal_word_workspace` chỉ khoá/ghi khi chưa có `sync_metadata`.
5. **Hạn chót & nhắc việc**: `GET /api/deadlines` và `/api/deadlines/calendar.ics` dùng đúng `build_dashboard_summary` (cùng phạm vi tenant/module/phân công/bản ghi như thẻ cảnh báo tổng quan), chỉ nới giới hạn số mục. Nhắc việc lưu trên trình duyệt; tệp `.ics` chỉ chứa mã, nhãn mốc, tên và liên kết nội bộ (theo ADR 0011).
6. **Ngày nghỉ lễ**: `holidays.json` vẫn là nguồn duy nhất; super admin sửa qua `/admin/holidays` (cần xác thực lại), ghi nguyên tử, có audit `platform.holidays_updated`; mọi worker tự đọc lại khi file đổi.
7. **Xem trước Word**: `GET /api/document-jobs/{id}/preview` dùng cùng kiểm tra quyền, hạn và chính sách xuất (`docx.document_job`) như tải xuống, có audit `document.export_job_previewed`. Tệp chỉ được tải khi người dùng chọn "Tải xuống".

## Không thay đổi

Không thay đổi role, module permission, record/assignment scope, entitlement hay hiển thị dữ liệu. Quyền xuất Word vẫn chỉ kiểm soát việc tạo/tải (và nay là xem trước) tài liệu.

## Tương thích và chuyển đổi

Không có migration. Email nhắc hạn chót theo lịch cần thêm loại thông báo mới vào ràng buộc `user_notifications.kind` và bảng chống gửi trùng; để lại cho một migration riêng.

## Regression seams

`tests/test_review_2026_10_hardening.py`, `tests/js/workspace_tools.test.mjs`, `tests/js/contract_word_export.test.mjs` (xem trước trước khi tải), `tests/test_export_policy_registry.py`.
