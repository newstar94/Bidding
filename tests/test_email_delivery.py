from __future__ import annotations

import ssl

import pytest

from backend.auth import email_utils
from backend import startup


SMTP_ENV_KEYS = (
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_SENDER",
    "SMTP_SECURITY",
    "SMTP_TIMEOUT_SECONDS",
    "SMTP_CA_FILE",
)


def _configure_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        "SMTP_HOST": "smtp.example.test",
        "SMTP_PORT": "587",
        "SMTP_USER": "mailer@example.test",
        "SMTP_PASSWORD": "test-secret",
        "SMTP_SENDER": "mailer@example.test",
        "SMTP_SECURITY": "starttls",
        "SMTP_TIMEOUT_SECONDS": "5",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("SMTP_CA_FILE", raising=False)


def test_production_smtp_configuration_is_fail_closed() -> None:
    errors = email_utils.smtp_configuration_errors({}, production=True)
    assert any("SMTP_USER" in error for error in errors)
    assert any("SMTP_SECURITY" in error for error in errors)


def test_production_startup_rejects_missing_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(startup, "database_requires_admin_bootstrap", lambda _database: False)
    environment = {
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql://app:secret@db.example.test/biddingflow?sslmode=verify-full",
        "DATABASE_AUTO_MIGRATE": "false",
        "DATABASE_PRIVATE_NETWORK_CONFIRMED": "true",
    }
    with pytest.raises(startup.StartupValidationError, match="SMTP"):
        startup.validate_startup_configuration(object(), environment)


def test_missing_smtp_never_claims_provider_acceptance(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in SMTP_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    events = []
    monkeypatch.setattr(email_utils, "log_structured_event", lambda event, **kwargs: events.append((event, kwargs)))

    result = email_utils.gui_email(
        "owner@example.test",
        "Temporary password",
        "secret-value-that-must-not-be-logged",
        True,
    )

    assert not result.accepted
    assert result.provider == "mock"
    assert "secret-value-that-must-not-be-logged" not in repr(events)


def test_starttls_uses_verified_tls_context_and_provider_acceptance(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_smtp(monkeypatch)
    observed = {}

    class FakeSmtp:
        def __init__(self, host, port, timeout):
            observed.update(host=host, port=port, timeout=timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def ehlo(self):
            observed["ehlo"] = observed.get("ehlo", 0) + 1

        def starttls(self, *, context):
            observed["context"] = context

        def login(self, username, password):
            observed["login"] = (username, password)

        def send_message(self, _message, *, from_addr, to_addrs):
            observed["envelope"] = (from_addr, to_addrs)
            return {}

    monkeypatch.setattr(email_utils.smtplib, "SMTP", FakeSmtp)
    result = email_utils.gui_email("owner@example.test", "Subject", "Body", True)

    assert result.accepted
    assert observed["ehlo"] == 2
    assert observed["context"].check_hostname is True
    assert observed["context"].verify_mode == ssl.CERT_REQUIRED
    assert observed["context"].minimum_version == ssl.TLSVersion.TLSv1_2
    assert observed["envelope"] == ("mailer@example.test", ["owner@example.test"])


def test_smtp_configuration_rejects_invalid_bounds_and_sender(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    environment = {
        "SMTP_SECURITY": "plain",
        "SMTP_PORT": "invalid",
        "SMTP_TIMEOUT_SECONDS": "0",
        "SMTP_SENDER": "bad\r\nBcc: attacker@example.test",
        "SMTP_CA_FILE": str(tmp_path / "missing.pem"),
    }
    errors = email_utils.smtp_configuration_errors(environment)
    assert any("SMTP_SECURITY" in error for error in errors)
    assert any("SMTP_PORT" in error for error in errors)
    assert any("SMTP_TIMEOUT_SECONDS" in error for error in errors)
    assert any("SMTP_SENDER" in error for error in errors)
    assert any("SMTP_CA_FILE" in error for error in errors)

    environment.update(
        {
            "SMTP_SECURITY": "ssl",
            "SMTP_PORT": "65536",
            "SMTP_TIMEOUT_SECONDS": "31",
            "SMTP_SENDER": "mailer@example.test",
        }
    )
    errors = email_utils.smtp_configuration_errors(environment)
    assert any("SMTP_PORT" in error for error in errors)
    assert any("SMTP_TIMEOUT_SECONDS" in error for error in errors)

    ca_file = tmp_path / "ca.pem"
    ca_file.write_text("test", encoding="utf-8")
    environment.update(
        {
            "SMTP_PORT": "465",
            "SMTP_TIMEOUT_SECONDS": "10",
            "SMTP_CA_FILE": str(ca_file),
        }
    )
    assert email_utils.smtp_configuration_errors(environment) == []


def test_smtp_configuration_loading_is_optional_but_invalid_values_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for key in SMTP_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    assert email_utils._load_configuration() is None
    monkeypatch.setenv("SMTP_USER", "mailer@example.test")
    assert email_utils._load_configuration() is None

    monkeypatch.setenv("SMTP_PASSWORD", "secret")
    monkeypatch.setenv("SMTP_PORT", "invalid")
    with pytest.raises(ValueError):
        email_utils._load_configuration()

    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_SECURITY", "ssl")
    configuration = email_utils._load_configuration()
    assert configuration.host == "smtp.gmail.com"
    assert configuration.sender == "mailer@example.test"
    assert configuration.security == "ssl"


@pytest.mark.parametrize(
    ("recipient", "subject"),
    [
        ("invalid", "subject"),
        ("owner@example.test\r\nBcc: attacker@example.test", "subject"),
        ("owner@example.test", "subject\nBcc: attacker@example.test"),
    ],
)
def test_email_message_headers_are_injection_safe(
    monkeypatch: pytest.MonkeyPatch, recipient: str, subject: str
) -> None:
    events = []
    monkeypatch.setattr(
        email_utils,
        "log_structured_event",
        lambda *args, **kwargs: events.append((args, kwargs)),
    )
    result = email_utils.gui_email(recipient, subject, "body")
    assert not result
    assert result.error_code == "EMAIL_MESSAGE_INVALID"
    assert events[-1][0][0] == "email.message_invalid"


def test_invalid_runtime_smtp_configuration_returns_stable_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_smtp(monkeypatch)
    monkeypatch.setenv("SMTP_TIMEOUT_SECONDS", "invalid")
    result = email_utils.gui_email("owner@example.test", "subject", "body")
    assert not result.accepted
    assert result.error_code == "SMTP_CONFIGURATION_INVALID"


def test_ssl_delivery_recipient_refusal_and_transport_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_smtp(monkeypatch)
    monkeypatch.setenv("SMTP_SECURITY", "ssl")
    observed = {}

    class FakeSslSmtp:
        def __init__(self, host, port, timeout, context):
            observed.update(
                host=host, port=port, timeout=timeout, context=context
            )

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def login(self, username, password):
            observed["login"] = (username, password)

        def send_message(self, *_args, **_kwargs):
            return {"owner@example.test": (550, b"refused")}

    monkeypatch.setattr(email_utils.smtplib, "SMTP_SSL", FakeSslSmtp)
    refused = email_utils.gui_email(
        "owner@example.test", "subject", "body"
    )
    assert not refused.accepted
    assert refused.error_code == "SMTP_RECIPIENT_REFUSED"
    assert observed["context"].check_hostname

    class FailedSslSmtp:
        def __init__(self, *_args, **_kwargs):
            raise email_utils.smtplib.SMTPConnectError(421, "unavailable")

    monkeypatch.setattr(email_utils.smtplib, "SMTP_SSL", FailedSslSmtp)
    failed = email_utils.gui_email("owner@example.test", "subject", "body")
    assert not failed.accepted
    assert failed.error_code == "SMTPCONNECTERROR"
