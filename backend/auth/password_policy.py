MAX_PASSWORD_LENGTH = 1024
MIN_PASSWORD_LENGTH = 12


def validate_new_password(password):
    """Validate a new password without normalizing or trimming its contents."""
    if not isinstance(password, str):
        return False, "Mật khẩu không hợp lệ."
    if len(password) < MIN_PASSWORD_LENGTH:
        return False, f"Mật khẩu phải có ít nhất {MIN_PASSWORD_LENGTH} ký tự."
    if len(password) > MAX_PASSWORD_LENGTH:
        return False, f"Mật khẩu không được vượt quá {MAX_PASSWORD_LENGTH} ký tự."
    return True, ""
