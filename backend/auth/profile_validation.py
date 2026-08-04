import re
from urllib.parse import urlparse

from backend.shared.media_helper import reencode_base64_image


MAX_PROFILE_NAME_LENGTH = 100
MAX_PROFILE_EMAIL_LENGTH = 254
MAX_AVATAR_BYTES = 512 * 1024
_EMAIL_RE = re.compile(r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$", re.IGNORECASE)


class ProfileValidationError(ValueError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def _validate_name(value):
    name = " ".join(str(value or "").strip().split())
    if not name or len(name) > MAX_PROFILE_NAME_LENGTH:
        raise ProfileValidationError("Họ tên phải có từ 1 đến 100 ký tự.", "INVALID_PROFILE_NAME")
    if any(ord(char) < 32 or ord(char) == 127 for char in name) or "<" in name or ">" in name:
        raise ProfileValidationError("Họ tên chứa ký tự không hợp lệ.", "INVALID_PROFILE_NAME")
    return name


def _validate_email(value):
    email = str(value or "").strip().lower()
    if not email or len(email) > MAX_PROFILE_EMAIL_LENGTH or not _EMAIL_RE.fullmatch(email):
        raise ProfileValidationError("Địa chỉ email không hợp lệ.", "INVALID_PROFILE_EMAIL")
    return email


def _validate_avatar(value):
    avatar = str(value or "").strip()
    if not avatar:
        return ""

    parsed = urlparse(avatar)
    if parsed.scheme == "https" and parsed.hostname == "lh3.googleusercontent.com" and not parsed.username:
        if len(avatar) <= 2_048:
            return avatar
        raise ProfileValidationError("Đường dẫn ảnh đại diện quá dài.", "INVALID_PROFILE_AVATAR")

    try:
        return reencode_base64_image(
            avatar,
            max_input_bytes=MAX_AVATAR_BYTES,
            max_size=256,
            output_format="JPEG",
        )
    except ValueError as exc:
        message = str(exc)
        code = (
            "PROFILE_AVATAR_TOO_LARGE"
            if "dung lượng" in message.lower()
            else "INVALID_PROFILE_AVATAR"
        )
        raise ProfileValidationError(
            "Ảnh đại diện phải là PNG, JPEG hoặc WebP hợp lệ và không vượt quá 512 KB.",
            code,
        ) from None


def validate_profile_fields(name, email, avatar):
    return _validate_name(name), _validate_email(email), _validate_avatar(avatar)
