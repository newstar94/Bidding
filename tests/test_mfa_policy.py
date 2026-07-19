from __future__ import annotations

import base64
import json

from cryptography.fernet import Fernet
import pytest

from backend.auth import mfa_service


class _Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        return self

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


@pytest.fixture
def mfa_key(monkeypatch: pytest.MonkeyPatch) -> str:
    key = Fernet.generate_key().decode("ascii")
    monkeypatch.setenv("MFA_ENCRYPTION_KEY", key)
    return key


def test_mfa_key_configuration_is_fail_closed(
    monkeypatch: pytest.MonkeyPatch, mfa_key: str
) -> None:
    assert len(mfa_service._mfa_key_bytes()) == 32
    mfa_service.validate_mfa_configuration(
        {"MFA_ENCRYPTION_KEY": mfa_key}, required=True
    )
    mfa_service.validate_mfa_configuration({}, required=False)
    with pytest.raises(mfa_service.MfaConfigurationError):
        mfa_service.validate_mfa_configuration({}, required=True)
    with pytest.raises(mfa_service.MfaConfigurationError):
        mfa_service.validate_mfa_configuration(
            {"MFA_ENCRYPTION_KEY": "invalid"}, required=True
        )
    monkeypatch.setenv(
        "MFA_ENCRYPTION_KEY",
        base64.urlsafe_b64encode(b"too-short").decode("ascii"),
    )
    with pytest.raises(mfa_service.MfaConfigurationError):
        mfa_service._mfa_key_bytes()
    monkeypatch.setenv("MFA_ENCRYPTION_KEY", "é")
    with pytest.raises(mfa_service.MfaConfigurationError):
        mfa_service._mfa_key_bytes()
    monkeypatch.delenv("MFA_ENCRYPTION_KEY")
    with pytest.raises(mfa_service.MfaConfigurationError):
        mfa_service._mfa_key_bytes()


def test_totp_generation_normalization_and_recovery_digest_are_stable(
    mfa_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mfa_service.secrets, "token_bytes", lambda _count: b"x" * 20)
    secret = mfa_service.generate_totp_secret()
    assert "=" not in secret
    assert len(mfa_service.totp_code(secret, 1)) == 6
    assert mfa_service.current_totp_code(secret, now=30) == mfa_service.totp_code(
        secret, 1
    )
    assert mfa_service._normalize_code("ab-cd 23") == "ABCD23"
    assert mfa_service._recovery_digest("AB-CD") == mfa_service._recovery_digest(
        "abcd"
    )


def test_mfa_status_and_enabled_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("REQUIRE_SUPER_ADMIN_MFA", raising=False)
    assert mfa_service.is_mfa_enabled(_Cursor(rows=[(1,)]), "user")
    assert not mfa_service.is_mfa_enabled(_Cursor(rows=[None]), "user")
    status = mfa_service.get_mfa_status(
        _Cursor(rows=[(1, 100, 200)]), "user", " SUPER_ADMIN "
    )
    assert status == {
        "enabled": True,
        "required": False,
        "recommended": True,
        "enabled_at": 100,
        "last_used_at": 200,
    }
    status = mfa_service.get_mfa_status(_Cursor(rows=[None]), "user", "employee")
    assert not status["enabled"]
    assert not status["required"]
    assert not status["recommended"]

    monkeypatch.setenv("REQUIRE_SUPER_ADMIN_MFA", "true")
    assert mfa_service.get_mfa_status(
        _Cursor(rows=[None]), "user", "super_admin"
    )["required"]
    assert not mfa_service.is_mfa_required_for_role("employee")


def test_begin_enrollment_replaces_pending_secret(
    mfa_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(mfa_service.MfaStateError):
        mfa_service.begin_mfa_enrollment(
            _Cursor(rows=[(1,)]), user_id="user", account_label="User"
        )
    monkeypatch.setattr(
        mfa_service, "generate_totp_secret", lambda: "JBSWY3DPEHPK3PXP"
    )
    cursor = _Cursor(rows=[(0,)])
    payload = mfa_service.begin_mfa_enrollment(
        cursor, user_id="user", account_label="User name@example.com"
    )
    assert payload["secret"] == "JBSWY3DPEHPK3PXP"
    assert "User%20name%40example.com" in payload["otpauth_uri"]
    ciphertext = cursor.calls[1][1][1]
    assert mfa_service._decrypt_secret(ciphertext) == payload["secret"]
    with pytest.raises(mfa_service.MfaConfigurationError):
        mfa_service._decrypt_secret("tampered")


def test_matching_totp_counter_rejects_format_replay_and_accepts_window() -> None:
    secret = "JBSWY3DPEHPK3PXP"
    current_counter = 100
    now = current_counter * mfa_service.TOTP_PERIOD_SECONDS
    assert mfa_service._matching_counter(secret, "bad", now=now) is None
    code = mfa_service.totp_code(secret, current_counter)
    assert (
        mfa_service._matching_counter(
            secret, code, now=now, last_counter=current_counter
        )
        is None
    )
    assert (
        mfa_service._matching_counter(secret, code, now=now, last_counter=99)
        == current_counter
    )
    previous = mfa_service.totp_code(secret, current_counter - 1)
    assert (
        mfa_service._matching_counter(secret, previous, now=now, last_counter=-1)
        == current_counter - 1
    )


def test_recovery_codes_have_fixed_count_and_unambiguous_format(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(mfa_service.secrets, "choice", lambda _alphabet: "A")
    codes = mfa_service._new_recovery_codes()
    assert len(codes) == mfa_service.RECOVERY_CODE_COUNT
    assert set(codes) == {"AAAAA-AAAAA"}


def test_confirm_enrollment_state_and_code_validation(
    mfa_key: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(mfa_service.MfaStateError):
        mfa_service.confirm_mfa_enrollment(
            _Cursor(rows=[None]), user_id="user", code="000000", now=3_000
        )
    with pytest.raises(mfa_service.MfaStateError):
        mfa_service.confirm_mfa_enrollment(
            _Cursor(rows=[("cipher", 1, -1)]),
            user_id="user",
            code="000000",
            now=3_000,
        )

    secret = "JBSWY3DPEHPK3PXP"
    ciphertext = mfa_service._fernet().encrypt(secret.encode()).decode()
    with pytest.raises(mfa_service.MfaStateError):
        mfa_service.confirm_mfa_enrollment(
            _Cursor(rows=[(ciphertext, 0, -1)]),
            user_id="user",
            code="000000",
            now=3_000,
        )

    monkeypatch.setattr(
        mfa_service, "_new_recovery_codes", lambda: ["AAAAA-BBBBB"]
    )
    now = 3_000
    code = mfa_service.current_totp_code(secret, now=now)
    cursor = _Cursor(rows=[(ciphertext, 0, -1)])
    assert mfa_service.confirm_mfa_enrollment(
        cursor, user_id="user", code=code, now=now
    ) == ["AAAAA-BBBBB"]
    stored_hashes = json.loads(cursor.calls[1][1][1])
    assert stored_hashes == [mfa_service._recovery_digest("AAAAA-BBBBB")]


def test_consume_totp_recovery_and_invalid_state(mfa_key: str) -> None:
    assert not mfa_service.consume_mfa_code(
        _Cursor(rows=[None]), user_id="user", code="000000", now=3_000
    )
    assert not mfa_service.consume_mfa_code(
        _Cursor(rows=[("cipher", 0, -1, "[]")]),
        user_id="user",
        code="000000",
        now=3_000,
    )

    secret = "JBSWY3DPEHPK3PXP"
    ciphertext = mfa_service._fernet().encrypt(secret.encode()).decode()
    now = 3_000
    code = mfa_service.current_totp_code(secret, now=now)
    cursor = _Cursor(rows=[(ciphertext, 1, -1, "[]")])
    assert mfa_service.consume_mfa_code(
        cursor, user_id="user", code=code, now=now
    )
    assert cursor.calls[1][1][-1] == "user"

    recovery = "AAAAA-BBBBB"
    recovery_hash = mfa_service._recovery_digest(recovery)
    cursor = _Cursor(rows=[(ciphertext, 1, now // 30, json.dumps([recovery_hash]))])
    assert mfa_service.consume_mfa_code(
        cursor, user_id="user", code=recovery, now=now
    )
    assert json.loads(cursor.calls[1][1][0]) == []
    assert not mfa_service.consume_mfa_code(
        _Cursor(rows=[(ciphertext, 1, now // 30, "not-json")]),
        user_id="user",
        code="invalid",
        now=now,
    )
    assert not mfa_service.consume_mfa_code(
        _Cursor(rows=[(ciphertext, 1, now // 30, "[]")]),
        user_id="user",
        code="",
        now=now,
    )


def test_disable_mfa_is_user_scoped() -> None:
    cursor = _Cursor()
    mfa_service.disable_mfa(cursor, user_id="user")
    assert cursor.calls[0][1] == ("user",)
