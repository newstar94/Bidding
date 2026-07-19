"""Canonical account identity handling shared by every authentication flow."""

from backend.db.db_helper import IntegrityError



GOOGLE_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})


def normalize_username(value):
    return str(value or "").strip().casefold()


def normalize_email(value):
    return str(value or "").strip().casefold()


def identity_conflict_code(error):
    """Map PostgreSQL uniqueness failures to stable public error codes."""
    if not isinstance(error, IntegrityError):
        return None
    constraint = str(getattr(getattr(error, "diag", None), "constraint_name", "") or "").casefold()
    message = f"{constraint} {error}".casefold()
    if "tai_khoan_username_norm" in message or "username_norm" in message:
        return "USERNAME_ALREADY_EXISTS"
    if "tai_khoan_email_norm" in message or (
        "email_norm" in message and "dinh_danh_ngoai" not in message
    ):
        return "EMAIL_ALREADY_EXISTS"
    if "dinh_danh_ngoai_pkey" in message or "issuer" in message and "subject" in message:
        return "EXTERNAL_IDENTITY_ALREADY_LINKED"
    if "dinh_danh_ngoai_user_id_issuer" in message:
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
