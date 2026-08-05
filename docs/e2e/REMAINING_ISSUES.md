# Lỗi còn tồn tại

Commit kiểm thử: `8b935359f40ce2841014f8f40dff5b1c91fcc032`  
Môi trường: local `http://127.0.0.1:8000`, Windows, Chromium/Firefox/WebKit.

| ID | Mức độ | Khu vực | Lỗi còn tồn tại | Bằng chứng / tái hiện |
|---|---|---|---|---|
| BUG-A11Y-001 | S3 | Accessibility dashboard | axe phát hiện lỗi serious `scrollable-region-focusable` trên `.content-viewport`; vùng cuộn không có phần tử focus được bằng bàn phím. | Chạy `npm run test:e2e:smoke`; xem `test-results/...chromium|firefox|webkit.../error-context.md`. |
| BUG-WEBKIT-001 | S3 | WebKit/CSP | WebKit từ chối 2 stylesheet do CSP và nhận một response 403; lỗi xuất hiện trong smoke WebKit. | Chạy `npm run test:e2e:smoke -- --project=webkit`; xem trace/screenshot/video WebKit trong `test-results/`. |
| BUG-UI-001 | S3 | Google login | Google Identity Services ghi `GSI_LOGGER: The given origin is not allowed for the given client ID` với origin local `127.0.0.1:8000`, làm UI-quality suite fail. | Chạy `npm run test:ui-quality-e2e`. |
| BUG-LIFECYCLE-001 | S3 | Lifecycle award | Sau khi award và reload tab kết quả, không render được đúng một contractor result visible; không thể xác minh award đã lưu và các bước contract/cancel/rebid không chạy tiếp. | Chạy `npm run test:lifecycle`; lỗi tại `scripts/verify_full_lifecycle.mjs:318`. |
| BUG-TEST-001 | S2/S3 | Forgot password/privacy | Tài khoản tồn tại trả thành công nhưng tài khoản không tồn tại trả HTTP 400 khác biệt. Test auth kỳ vọng phản hồi không làm lộ sự tồn tại tài khoản nên đang fail; cần thống nhất lại contract và xử lý privacy. | Chạy auth roles suite với Turnstile tắt trong isolated E2E; lỗi `Forgot-password response failed`. |
| BUG-FIXTURE-001 | S3 | Bidder-goods fixture | Fixture tạo duplicate active opening business key với lot code rỗng, vi phạm `idx_thong_tin_mo_thau_active_business_key`; browser import chưa thể bắt đầu. | Chạy `npm run test:bidder-goods-e2e`; lỗi tại `scripts/bidder_goods_e2e_fixture.py:177`. |
| BUG-TEST-002 | S3 | Password-reset unit tests | Hai unit test đang kỳ vọng nội dung cũ: thiếu `Vui lòng kiểm tra lại.` và dùng `và thư rác` thay vì `hoặc thư rác`. | Chạy `npm test`; `tests/test_password_reset_feedback.py:38,56` fail. |
| BLOCKER-ENV-001 | S3 | Turnstile local E2E | Khi server chạy `TURNSTILE_ENABLED=auto` với test key local, registration bị trả `403 BOT_CHALLENGE_REQUIRED`; auth roles suite không thể chạy trọn vẹn ở cấu hình đó. | Chạy `npm run test:auth-roles-e2e` trên server local hiện tại. |

## Trạng thái tổng hợp

- Playwright smoke: 3/6 pass, 3/6 fail trên Chromium, Firefox và WebKit.
- `npm test`: 426 pass, 2 fail do `BUG-TEST-002`.
- Các lỗi trên chưa được sửa trong code sản phẩm; chỉ test harness/documentation được bổ sung hoặc làm rõ.

## Artifact chung

- HTML report: `playwright-report/index.html`
- JUnit: `test-results/e2e-junit.xml`
- JSON: `test-results/e2e-results.json`
- Screenshot/video/trace lỗi: `test-results/`
