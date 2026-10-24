# ADR 0095: Công bố pháp lý công khai và ghi nhận đồng ý khi đăng ký

- Ngày: 2026-10-24
- Trạng thái: Chủ sản phẩm chấp thuận (2026-10-24)
- Phạm vi: trang `/legal`, form đăng ký, chân trang công khai, Super Admin

## Bối cảnh

Rà soát theo checklist "20 điểm pháp lý trước khi public" cho thấy còn thiếu: chính sách cookie, chính sách hoàn tiền riêng có ngoại lệ, checkbox đồng ý và bằng chứng đồng ý, khai báo mục đích tại form, quy trình yêu cầu xóa dữ liệu, khai báo thống kê sử dụng, cơ sở pháp lý, thông tin doanh nghiệp và thông báo cookie.

Chủ sản phẩm quyết định:

1. Checkbox đồng ý bắt buộc khi đăng ký và lưu bằng chứng đồng ý.
2. Quyền xóa dữ liệu được công bố dưới dạng quy trình gửi yêu cầu qua email và xử lý thủ công. Không thay đổi code ngừng hoạt động hay xóa tài khoản.
3. Không hoàn tiền, trừ lỗi giao dịch: bị trừ tiền nhiều lần, chuyển khoản thừa, hoặc đã thanh toán nhưng gói không kích hoạt được do lỗi hệ thống.
4. Thông tin doanh nghiệp do Super Admin cấu hình. Khi chưa cấu hình, chân trang hiển thị "Đang cập nhật" thay vì dữ liệu giả.

## Quyết định

1. **Trang `/legal` có năm tab:** Điều khoản sử dụng, Quyền riêng tư, Bảo mật, Cookie (`#cookies`) và Hoàn tiền (`#refund`). Ngày cập nhật và phiên bản chính sách (`2026-10-24`) hiển thị ở đầu trang. Mục 06 của Điều khoản dẫn sang trang Hoàn tiền.
2. **Quyền riêng tư bổ sung các mục:** thống kê sử dụng sản phẩm (ADR 0031), thời gian lưu trữ, quyền của chủ thể dữ liệu và cách gửi yêu cầu, cơ sở pháp lý (Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15), chuyển dữ liệu ra nước ngoài qua Google/Cloudflare, và việc ghi nhận đồng ý.
3. **Checkbox đồng ý khi đăng ký:** `POST /api/auth/register` yêu cầu `acceptLegal: true`.
   - Thiếu trường hoặc sai kiểu: trả `400 REQUEST_VALIDATION_FAILED`.
   - Giá trị `false`: trả `400 LEGAL_CONSENT_REQUIRED`, trước khi kiểm tra Turnstile và trước khi băm mật khẩu.
   - Form có checkbox `#register-accept-legal` kèm liên kết tới cả năm tài liệu, và đoạn khai báo mục đích `#register-purpose-note`.
4. **Bằng chứng đồng ý nằm trong audit log.** Sự kiện `legal.consent_accepted` được ghi bằng `log_audit(..., cursor=cursor, required=True)` trong cùng transaction tạo tài khoản (gồm cả trường hợp tái sử dụng tài khoản bỏ dở). Metadata gồm `policyVersion`, `documents`, `method`; IP và `requestId` do audit log tự ghi. Vì vậy không có tài khoản nào thiếu bằng chứng. Bằng chứng được hưởng chuỗi HMAC chống sửa và chính sách lưu giữ của audit, và không cần bảng hay migration mới.
5. **Tài khoản mới tạo qua Google** ghi cùng sự kiện với `method = google_sign_in_notice`. Nút Google nằm cạnh thông báo đồng ý (clickwrap). Người dùng cũ cũng đăng nhập qua nút này, nên không dùng checkbox ở đây.
6. **Thông tin doanh nghiệp:**
   - Lưu ở file `BIDDING_DATA_DIR/business_profile.json` (ghi đè bằng `BUSINESS_PROFILE_FILE`). File được ghi nguyên tử và đọc lại theo chữ ký file, giống `holidays.json`.
   - Các trường: tên doanh nghiệp, MST, giấy ĐKKD, người đại diện, địa chỉ, điện thoại, email. Tất cả đều tùy chọn và được kiểm tra định dạng.
   - API:
     - `GET /api/public/business-profile`: công khai, cache 300 giây.
     - `GET/POST /api/admin/business-profile`: chỉ `super_admin`. Ghi cần xác thực lại như các thao tác ghi quản trị khác và ghi audit `platform.business_profile_updated` với danh sách trường thay đổi.
   - Trang Super Admin `/admin/business-profile` nằm trong nhóm "Hệ thống".
   - Chân trang chủ và trang `/legal` include `views/components/business_profile_footer.html`. Trường trống hiển thị "Đang cập nhật". Email mặc định là `biddingflow@gmail.com`.
7. **Thông báo cookie:** hiển thị trên trang chủ, `/legal` và màn hình đăng nhập.
   - Chỉ mang tính thông báo, vì ứng dụng chỉ dùng cookie cần thiết (`session_token`, `csrf_token`) và không có tracker bên thứ ba, nên không có gì phải chặn trước khi đồng ý.
   - Trạng thái đã đóng thông báo lưu ở `localStorage["bf_cookie_notice_ack"]` theo phiên bản chính sách. Khi storage bị chặn, thông báo vẫn hiển thị.

## Không thay đổi

- Role, module permission, record/assignment scope, capability, entitlement và mọi quy tắc hiển thị dữ liệu bản ghi (AGENTS.md).
- Luồng "Ngừng hoạt động" tài khoản và quy tắc không xóa vật lý (`deploy/runbooks/account-deletion-retention.md`).
- Logic thanh toán, kích hoạt và refund intent hiện có.
- Schema database: vẫn là v103.

## Tương thích và chuyển đổi

- Client gọi `POST /api/auth/register` mà không gửi `acceptLegal: true` sẽ bị từ chối. Frontend và `scripts/verify_auth_roles_e2e.mjs` đã được cập nhật trong cùng thay đổi. Frontend và backend phải triển khai cùng nhau. Tab giao diện cũ còn mở sẽ nhận lỗi `REQUEST_VALIDATION_FAILED` cho tới khi tải lại trang.
- Tài khoản tạo trước thay đổi này không có sự kiện đồng ý. Không tạo bằng chứng hồi tố cho các tài khoản đó.
- Khi đổi nội dung chính sách đáng kể, tăng đồng thời:
  - `LEGAL_POLICY_VERSION` (`backend/auth/legal_consent.py`),
  - ngày và phiên bản trong `views/components/legal_page.html`,
  - `COOKIE_NOTICE_VERSION` (`frontend/shared/storageDisclosure.js`).

  `tests/test_legal_page.py` kiểm tra ba giá trị này khớp nhau.
- Rollback: khôi phục bản trước. Bản cũ bỏ qua sự kiện audit mới và file `business_profile.json`.

## Regression seams

`tests/test_business_profile_and_legal_consent.py`, `tests/test_legal_page.py`, `tests/test_review_2026_10_hardening.py`, `tests/test_turnstile.py`, `tests/test_word_variable_workspace_scope.py`, `tests/js/public_legal_disclosures.test.mjs`, `tests/js/admin_platform_router.test.mjs`, `tests/js/admin_platform_navigation.test.mjs`.

## Việc còn mở

- Nội dung pháp lý nên được luật sư rà soát trước khi bán chính thức.
- Workflow xóa/ẩn danh dữ liệu theo yêu cầu vẫn cần phê duyệt riêng theo runbook retention. Trước khi có workflow đó, yêu cầu xóa chỉ dẫn tới việc ngừng hoạt động tài khoản và xử lý thủ công đã được phê duyệt.
- Thời hạn xử lý yêu cầu hoàn tiền chưa được công bố.
