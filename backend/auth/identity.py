"""Canonical account identity handling shared by every authentication flow."""

from backend.db.errors import INTEGRITY_ERRORS


GOOGLE_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})


def normalize_username(value):
    return str(value or "").strip().casefold()


def normalize_email(value):
    return str(value or "").strip().casefold()


def identity_conflict_code(error):
    """Map database uniqueness failures to a stable public field error code."""
    if not isinstance(error, INTEGRITY_ERRORS):
        return None
    message = str(error).casefold()
    if "username_norm" in message:
        return "USERNAME_ALREADY_EXISTS"
    if "email_norm" in message and "dinh_danh_ngoai" not in message:
        return "EMAIL_ALREADY_EXISTS"
    if "dinh_danh_ngoai.issuer" in message or "dinh_danh_ngoai.subject" in message:
        return "EXTERNAL_IDENTITY_ALREADY_LINKED"
    if "dinh_danh_ngoai.user_id" in message:
        return "EXTERNAL_PROVIDER_ALREADY_LINKED"
    return None


def conflict_payload(code):
    messages = {
        "USERNAME_ALREADY_EXISTS": "Tên đăng nhập đã tồn tại!",
        "EMAIL_ALREADY_EXISTS": "Địa chỉ email này đã được sử dụng bởi một tài khoản khác!",
        "EXTERNAL_IDENTITY_ALREADY_LINKED": "Tài khoản Google này đã được liên kết với người dùng khác.",
        "EXTERNAL_PROVIDER_ALREADY_LINKED": "Người dùng đã liên kết với một tài khoản Google khác.",
    }
    return {"error": messages.get(code, "Định danh tài khoản đã tồn tại."), "code": code}
