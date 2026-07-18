const EMAIL_CHANGE_ERROR_MESSAGES = Object.freeze({
  EMAIL_CHANGE_REAUTH_REQUIRED: "Vui lòng nhập lại mật khẩu hiện tại để thay đổi email.",
  EMAIL_CHANGE_REAUTH_FAILED: "Mật khẩu hiện tại không chính xác.",
  EMAIL_ALREADY_EXISTS: "Địa chỉ email này đã được một tài khoản khác sử dụng.",
  EMAIL_CHANGE_OTP_INVALID: "Mã OTP không chính xác. Vui lòng kiểm tra và nhập lại.",
  EMAIL_CHANGE_OTP_EXPIRED: "Mã OTP đã hết hạn. Hãy cập nhật hồ sơ để nhận mã mới.",
  EMAIL_CHANGE_NOT_PENDING: "Không còn yêu cầu đổi email nào đang chờ xác minh.",
  EMAIL_CHANGE_REQUEST_REPLACED: "Yêu cầu đổi email này đã được thay thế. Hãy dùng mã OTP mới nhất.",
  EMAIL_CHANGE_REQUEST_STALE: "Yêu cầu đổi email không còn hiệu lực. Hãy tạo yêu cầu mới.",
  rate_limit_exceeded: "Bạn đã thử quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.",
  REQUEST_JSON_INVALID: "Dữ liệu gửi lên không hợp lệ. Vui lòng thử lại.",
  REQUEST_JSON_OBJECT_REQUIRED: "Dữ liệu gửi lên không đúng định dạng. Vui lòng thử lại."
});

export function normalizeProfileEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function deriveEmailChangeUiState({ currentEmail, desiredEmail, pendingEmail = "" }) {
  const current = normalizeProfileEmail(currentEmail);
  const desired = normalizeProfileEmail(desiredEmail);
  const pending = normalizeProfileEmail(pendingEmail);
  const emailChanged = Boolean(desired && desired !== current);
  const verificationPending = Boolean(emailChanged && pending && desired === pending);
  return {
    emailChanged,
    verificationPending,
    passwordRequired: emailChanged && !verificationPending
  };
}

export function buildProfileUpdatePayload({ name, email, avatar, currentEmail, password }) {
  const desiredEmail = String(email || "").trim();
  const state = deriveEmailChangeUiState({ currentEmail, desiredEmail });
  const payload = {
    name: String(name || "").trim(),
    email: desiredEmail,
    avatar: String(avatar || "")
  };
  if (state.emailChanged) payload.password = String(password || "");
  return { payload, emailChanged: state.emailChanged };
}

export function isValidEmailChangeOtp(value) {
  return /^[0-9]{6}$/.test(String(value || "").trim());
}

export function emailChangeErrorMessage(code, fallback = "") {
  return EMAIL_CHANGE_ERROR_MESSAGES[String(code || "")]
    || String(fallback || "")
    || "Không thể hoàn tất thay đổi email. Vui lòng thử lại.";
}
