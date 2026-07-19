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
