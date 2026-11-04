# ADR 0097: Đồng ý chủ động khi tạo tài khoản bằng Google

- Ngày: 2026-11-02 (sửa đổi 2026-11-04)
- Trạng thái: Chủ sản phẩm chấp thuận (2026-11-02; chuyển ô tích sang bước đặt tên đăng nhập 2026-11-04)
- Phạm vi: nút "Tiếp tục với Google", hộp "Đặt tên đăng nhập", `POST /api/auth/google-login`, `POST /api/auth/google-register`, trang chi tiết người dùng của Super Admin
- Thay thế: mục 5 của ADR 0095

## Bối cảnh

ADR 0095 bắt buộc checkbox đồng ý cho form đăng ký bằng mật khẩu. Riêng tài khoản tạo qua Google vẫn dùng đồng ý ngầm định: dưới nút Google có câu "Với việc đăng nhập bằng Google, bạn xác nhận đã đọc, hiểu và đồng ý…" (clickwrap, `method = google_sign_in_notice`). Ngoài ra, tài khoản Google mới được tạo ngay khi bấm nút, trước bước đặt tên đăng nhập.

Chủ sản phẩm yêu cầu mọi hình thức đăng ký đều phải chủ động tích chọn. Người dùng đã có tài khoản vẫn đăng nhập qua cùng nút Google mà không phải tích. Bản đầu của ADR này đặt ô tích dưới nút Google; ngày 2026-11-04 chủ sản phẩm quyết định chuyển ô tích sang bước "Đặt tên đăng nhập" và hoãn việc tạo tài khoản tới bước đó.

Rà soát các đường tạo bản ghi `tai_khoan`:

- `POST /api/auth/register` (mật khẩu, kể cả tái sử dụng tài khoản bỏ dở): đã bắt buộc `acceptLegal: true` từ ADR 0095. Không đổi.
- Google: thay đổi trong ADR này.
- Tạo super admin lúc khởi tạo database (`postgres_schema.py`, từ biến môi trường): đây là seed của người vận hành, không phải đăng ký, nên không thuộc phạm vi.

## Quyết định

1. **Màn hình đăng nhập** không còn câu đồng ý ngầm định và không có ô tích. Nút Google dùng chung cho đăng nhập và đăng ký.
2. **`POST /api/auth/google-login`** (chỉ nhận `credential`):
   - Định danh Google đã liên kết, hoặc email trùng tài khoản có sẵn (kể cả liên kết lần đầu và nâng cấp tài khoản chưa xác minh): đăng nhập như trước.
   - Không tìm thấy tài khoản: rollback, **không tạo gì** (tài khoản, định danh, phiên, email). Trả `200` với `pending_registration: true`, `suggested_username`, `name`, `email`, `avatar`, và đặt cookie `bf_google_pending`.
3. **Cookie `bf_google_pending`** giữ danh tính Google đã xác minh (`google_id`, `email`, `name`, `picture`):
   - Mã hóa và xác thực bằng Fernet với khóa dẫn xuất riêng mục đích từ `EMAIL_OUTBOX_ENCRYPTION_KEY` (HMAC-SHA256, nhãn `bf-google-pending-registration-v1`), nên không giải mã được dữ liệu outbox và ngược lại.
   - Hết hạn sau 15 phút (TTL kiểm tra khi giải mã và `max_age` của cookie).
   - `HttpOnly`, `SameSite=Strict`, `Secure` theo cấu hình phiên, `Path=/api/auth/google-register`.
   - Không cần bảng hay migration mới.
4. **Hộp "Đặt tên đăng nhập" ở chế độ đăng ký**:
   - Mô tả: email Google chưa có tài khoản, cần đặt tên đăng nhập và đồng ý để tạo tài khoản. Email được chèn bằng `textContent`.
   - Checkbox `#google-accept-legal` (trong `#set-username-legal-group`), mặc định không tích, `label for`, căn giữa. Nhãn chỉ có một liên kết "Điều khoản và Chính sách của chúng tôi" mở tab mới tới `/legal` (chủ sản phẩm yêu cầu không liệt kê từng chính sách, 2026-11-04). Khi hộp dùng cho tài khoản có sẵn chưa có tên đăng nhập, nhóm checkbox bị ẩn.
   - Bấm "Tạo tài khoản" khi chưa tích: lỗi inline tại checkbox bằng `setValidationError` và focus bằng `focusInvalidControl`, không gửi request.
   - Nút "Quay lại đăng nhập" đóng hộp và trở về màn hình đăng nhập; không có gì được tạo.
5. **`POST /api/auth/google-register`** nhận `{ username, acceptLegal }` (cả hai bắt buộc; sai kiểu trả `400 REQUEST_VALIDATION_FAILED`):
   - `acceptLegal: false`: `400 LEGAL_CONSENT_REQUIRED`, kiểm tra trước cookie và tên đăng nhập.
   - Cookie thiếu, sai hoặc hết hạn: `400 GOOGLE_REGISTRATION_EXPIRED`, xóa cookie. Frontend đưa người dùng về màn hình đăng nhập với thông báo bấm lại nút Google.
   - Tên đăng nhập không hợp lệ: `400`; đã có người dùng: `409`.
   - Định danh/email đã có tài khoản (tạo trong lúc chờ): `409 GOOGLE_ACCOUNT_EXISTS`, xóa cookie, yêu cầu bấm lại nút Google để đăng nhập.
   - Thành công: trong **một transaction** tạo tài khoản với tên đăng nhập đã chọn (`username_da_dat = 1`), không gian Word cá nhân, định danh Google, audit `auth.google_auto_register`, bằng chứng `legal.consent_accepted` (`method = google_registration_checkbox`), token và email đặt mật khẩu, phiên đăng nhập, audit `auth.google_login_success`. Phản hồi giống `google-login` thành công (`is_new_account: true`, `needs_username: false`), đặt `session_token` và xóa `bf_google_pending`.
   - Giới hạn tần suất riêng theo IP (`google_register:<ip>`). Endpoint không nằm trong danh sách miễn CSRF; như các endpoint xác thực khác, token CSRF chỉ bắt buộc khi đã có cookie phiên.
6. Hằng số `google_sign_in_notice` được giữ để đọc các sự kiện cũ, không dùng cho bằng chứng mới.
7. **Hiển thị bằng chứng cho Super Admin** (chủ sản phẩm chấp thuận 2026-11-04):
   - `GET /api/admin/users/{user_id}` (chỉ `super_admin`, như trước) trả thêm `legalConsent`: sự kiện `legal.consent_accepted` mới nhất của tài khoản, gồm `acceptedAt`, `policyVersion`, `method`, `documents`; `null` nếu chưa có.
   - **Không trả và không hiển thị IP.** IP vẫn nằm trong `audit_log` để tra cứu khi có tranh chấp.
   - Trang chi tiết người dùng có mục "Đồng ý điều khoản" (ngày đồng ý, phiên bản chính sách, hình thức, tài liệu). Danh sách người dùng không đổi. Không thay đổi quyền truy cập trang admin hay dữ liệu của các vai trò khác.
8. Nhãn checkbox `#register-accept-legal` ở form đăng ký bằng mật khẩu cũng rút gọn thành "Tôi đã đọc, hiểu và đồng ý với **Điều khoản và Chính sách của chúng tôi**", một liên kết mở tab mới tới `/legal` (chủ sản phẩm yêu cầu, 2026-11-04). Hành vi bắt buộc tích và mã lỗi không đổi.
9. Sửa lỗi lớp chờ "Đang đăng nhập bằng Google" không ẩn được: khối `cssText` của lớp chờ không còn khai báo `display`, để `hideGoogleAuthPending()` có hiệu lực. Lỗi có từ trước, lộ ra khi người dùng bấm "Quay lại đăng nhập".

## Không thay đổi

- Role, module permission, record/assignment scope, capability, entitlement và quy tắc hiển thị dữ liệu (AGENTS.md).
- Luồng đăng ký bằng mật khẩu và các mã lỗi của nó.
- Luồng đăng nhập/liên kết Google vào tài khoản có sẵn, email cảnh báo liên kết, email đặt mật khẩu, và `POST /api/auth/set-username` cho tài khoản có sẵn chưa có tên đăng nhập.
- `LEGAL_POLICY_VERSION` và nội dung chính sách.
- Schema database.

## Tương thích và chuyển đổi

- Người dùng Google đã có tài khoản: không bị ảnh hưởng.
- Người dùng Google mới trên tab giao diện cũ: giao diện cũ hiểu phản hồi `pending_registration` như tài khoản cần đặt tên, gọi `set-username` và nhận lỗi vì chưa có phiên. Không có tài khoản nào được tạo; tải lại trang là dùng được luồng mới. Frontend và backend phải triển khai cùng nhau.
- Tài khoản Google tạo trước thay đổi này giữ bằng chứng `google_sign_in_notice` và có thể chưa có tên đăng nhập; chúng tiếp tục dùng hộp đặt tên như cũ, không bị yêu cầu đồng ý lại. Không tạo bằng chứng hồi tố.
- Xoay `EMAIL_OUTBOX_ENCRYPTION_KEY` làm mất hiệu lực các cookie đang chờ; người dùng chỉ cần bấm lại nút Google.
- Rollback: khôi phục bản trước. Bản cũ bỏ qua cookie `bf_google_pending` (tự hết hạn sau 15 phút) và lại tạo tài khoản ngay khi bấm Google.

## Regression seams

`tests/test_platform_admin_directory_routes.py` và `tests/test_platform_admin_n_plus_one.py` (bằng chứng mới nhất, không lộ IP, số truy vấn cố định), `tests/js/admin_platform_directory.test.mjs`, `tests/test_auth_account_claim_and_password_attempts.py` (Google mới không tạo gì ở bước đăng nhập; `google-register` từ chối khi thiếu đồng ý, cookie hết hạn/giả, tên trùng, tài khoản đã tồn tại; tạo tài khoản kèm bằng chứng khi đủ điều kiện; tài khoản có sẵn không cần đồng ý), `tests/test_business_profile_and_legal_consent.py`, `tests/test_legal_page.py`, `tests/js/public_legal_disclosures.test.mjs` (payload và markup checkbox), `scripts/verify_ui_quality_e2e.mjs`.
