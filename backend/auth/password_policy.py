import hashlib


MAX_PASSWORD_LENGTH = 256
MIN_PASSWORD_LENGTH = 15

# Offline denylist for the most common leaked/default passphrases, including
# variants seen in Vietnamese deployments. Hashes avoid accidentally treating
# these values as example credentials in scanners and logs.
_COMMON_PASSWORD_SHA256 = frozenset({
    hashlib.sha256(value.encode("utf-8")).hexdigest()
    for value in (
        "123456789012345",
        "1234567890123456",
        "passwordpassword",
        "password123456",
        "password123456789",
        "qwertyqwertyqwerty",
        "qwertyuiopasdfgh",
        "adminadminadmin",
        "administrator123",
        "letmeinletmein",
        "iloveyouiloveyou",
        "correcthorsebatterystaple",
        "matkhaumatkhau",
        "matkhau123456789",
        "biddingflow123456",
    )
})


def validate_new_password(password):
    """Validate a new password without normalizing or trimming its contents."""
    if not isinstance(password, str):
        return False, "Mật khẩu không hợp lệ."
    if len(password) < MIN_PASSWORD_LENGTH:
        return False, f"Mật khẩu phải có ít nhất {MIN_PASSWORD_LENGTH} ký tự."
    if len(password) > MAX_PASSWORD_LENGTH:
        return False, f"Mật khẩu không được vượt quá {MAX_PASSWORD_LENGTH} ký tự."
    normalized = password.casefold()
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    if digest in _COMMON_PASSWORD_SHA256:
        return False, "Mật khẩu này quá phổ biến hoặc đã xuất hiện trong danh sách rò rỉ."
    return True, ""


def validate_password_input(password):
    """Bound authentication work without changing any password characters."""
    return isinstance(password, str) and 0 < len(password) <= MAX_PASSWORD_LENGTH
