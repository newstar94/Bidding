import base64

import pytest

from backend.auth.profile_validation import ProfileValidationError, validate_profile_fields


def _data_uri(mime_type, payload):
    return f"data:image/{mime_type};base64,{base64.b64encode(payload).decode('ascii')}"


def test_profile_fields_are_normalized_and_safe_images_are_accepted():
    avatar = _data_uri("png", b"\x89PNG\r\n\x1a\ncontent")
    assert validate_profile_fields("  Nguyễn   Văn A  ", " USER@Example.COM ", avatar) == (
        "Nguyễn Văn A",
        "user@example.com",
        avatar,
    )
    google_avatar = "https://lh3.googleusercontent.com/a/photo"
    assert validate_profile_fields("User", "user@example.com", google_avatar)[2] == google_avatar


@pytest.mark.parametrize(
    ("name", "email", "avatar", "code"),
    [
        pytest.param("<img src=x>", "user@example.com", "", "INVALID_PROFILE_NAME", id="unsafe-name"),
        pytest.param("User", "not-an-email", "", "INVALID_PROFILE_EMAIL", id="invalid-email"),
        pytest.param("User", "user@example.com", "javascript:alert(1)", "INVALID_PROFILE_AVATAR", id="unsafe-url"),
        pytest.param("User", "user@example.com", _data_uri("png", b"not-png"), "INVALID_PROFILE_AVATAR", id="mime-mismatch"),
        pytest.param("User", "user@example.com", _data_uri("png", b"\x89PNG\r\n\x1a\n" + b"x" * (512 * 1024)), "PROFILE_AVATAR_TOO_LARGE", id="oversized"),
    ],
)
def test_profile_fields_reject_invalid_or_oversized_values(name, email, avatar, code):
    with pytest.raises(ProfileValidationError) as exc_info:
        validate_profile_fields(name, email, avatar)
    assert exc_info.value.code == code
