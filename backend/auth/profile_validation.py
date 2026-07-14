import base64
import binascii
import re
from urllib.parse import urlparse


MAX_PROFILE_NAME_LENGTH = 100
MAX_PROFILE_EMAIL_LENGTH = 254
MAX_AVATAR_BYTES = 512 * 1024
_EMAIL_RE = re.compile(r"^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$", re.IGNORECASE)
_DATA_IMAGE_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$")


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

    match = _DATA_IMAGE_RE.fullmatch(avatar)
    if not match:
        raise ProfileValidationError("Ảnh đại diện phải là PNG, JPEG hoặc WebP hợp lệ.", "INVALID_PROFILE_AVATAR")
    mime_type, encoded = match.groups()
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ProfileValidationError("Dữ liệu ảnh đại diện không hợp lệ.", "INVALID_PROFILE_AVATAR") from None
    if not raw or len(raw) > MAX_AVATAR_BYTES:
        raise ProfileValidationError("Ảnh đại diện không được vượt quá 512 KB.", "PROFILE_AVATAR_TOO_LARGE")

    signatures_are_valid = (
        mime_type == "png" and raw.startswith(b"\x89PNG\r\n\x1a\n")
        or mime_type == "jpeg" and raw.startswith(b"\xff\xd8\xff")
        or mime_type == "webp" and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"
    )
    if not signatures_are_valid:
        raise ProfileValidationError("Nội dung ảnh không khớp định dạng đã khai báo.", "INVALID_PROFILE_AVATAR")
    return avatar


def validate_profile_fields(name, email, avatar):
    return _validate_name(name), _validate_email(email), _validate_avatar(avatar)


def validate_profile_email(email):
    return _validate_email(email)
