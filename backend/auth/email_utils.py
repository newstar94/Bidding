"""Fail-closed SMTP delivery with certificate and hostname verification."""

from __future__ import annotations

from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import hashlib
import os
from pathlib import Path
import smtplib
import ssl

from backend.shared.logging_utils import log_structured_event


@dataclass(frozen=True)
class EmailDeliveryResult:
    accepted: bool
    provider: str
    error_code: str | None = None

    def __bool__(self) -> bool:
        return self.accepted


@dataclass(frozen=True)
class SmtpConfiguration:
    host: str
    port: int
    username: str
    password: str
    sender: str
    security: str
    timeout_seconds: float
    ca_file: str | None


def _recipient_hash(value: str) -> str:
    return hashlib.sha256(str(value or "").strip().casefold().encode("utf-8")).hexdigest()[:16]


def smtp_configuration_errors(environ=None, *, production=False) -> list[str]:
    environ = os.environ if environ is None else environ
    required = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SENDER", "SMTP_SECURITY")
    errors = [f"{name} is required" for name in required if production and not str(environ.get(name, "")).strip()]

    security = str(environ.get("SMTP_SECURITY", "starttls")).strip().casefold()
    if security not in {"starttls", "ssl"}:
        errors.append("SMTP_SECURITY must be starttls or ssl")
    try:
        port = int(str(environ.get("SMTP_PORT", "587")).strip())
        if port < 1 or port > 65535:
            raise ValueError
    except ValueError:
        errors.append("SMTP_PORT must be an integer from 1 to 65535")
    try:
        timeout = float(str(environ.get("SMTP_TIMEOUT_SECONDS", "10")).strip())
        if timeout < 1 or timeout > 30:
            raise ValueError
    except ValueError:
        errors.append("SMTP_TIMEOUT_SECONDS must be between 1 and 30")

    sender = str(environ.get("SMTP_SENDER", "")).strip()
    if sender and ("@" not in sender or "\r" in sender or "\n" in sender):
        errors.append("SMTP_SENDER must be a valid single email address")
    ca_file = str(environ.get("SMTP_CA_FILE", "")).strip()
    if ca_file and (not Path(ca_file).is_file()):
        errors.append("SMTP_CA_FILE must point to a readable CA bundle")
    return errors


def _load_configuration() -> SmtpConfiguration | None:
    username = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    if not username or not password:
        return None
    errors = smtp_configuration_errors(os.environ, production=False)
    if errors:
        raise ValueError("; ".join(errors))
    return SmtpConfiguration(
        host=os.environ.get("SMTP_HOST", "smtp.gmail.com").strip(),
        port=int(os.environ.get("SMTP_PORT", "587")),
        username=username,
        password=password,
        sender=(os.environ.get("SMTP_SENDER", "").strip() or username),
        security=os.environ.get("SMTP_SECURITY", "starttls").strip().casefold(),
        timeout_seconds=float(os.environ.get("SMTP_TIMEOUT_SECONDS", "10")),
        ca_file=os.environ.get("SMTP_CA_FILE", "").strip() or None,
    )


def _tls_context(configuration: SmtpConfiguration) -> ssl.SSLContext:
    context = ssl.create_default_context(cafile=configuration.ca_file)
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


def gui_email(email_nhan, tieu_de, noi_dung_html, sensitive_content=False):
    """Send an HTML email and report only SMTP provider acceptance.

    Development without SMTP is a non-accepted mock. Email bodies, OTPs,
    passwords and tokens are never written to runtime logs.
    """

    recipient = str(email_nhan or "").strip()
    subject = str(tieu_de or "").strip()
    recipient_hash = _recipient_hash(recipient)
    if "@" not in recipient or any(value in recipient + subject for value in ("\r", "\n")):
        log_structured_event(
            "email.message_invalid",
            level="WARN",
            fields={"recipientHash": recipient_hash},
        )
        return EmailDeliveryResult(False, "smtp", "EMAIL_MESSAGE_INVALID")
    try:
        configuration = _load_configuration()
    except (TypeError, ValueError, OSError) as exc:
        log_structured_event(
            "email.configuration_invalid",
            level="ERROR",
            fields={"recipientHash": recipient_hash, "errorType": type(exc).__name__},
        )
        return EmailDeliveryResult(False, "smtp", "SMTP_CONFIGURATION_INVALID")

    if configuration is None:
        log_structured_event(
            "email.mocked",
            level="WARN",
            fields={"recipientHash": recipient_hash, "sensitive": bool(sensitive_content)},
        )
        return EmailDeliveryResult(False, "mock", "SMTP_NOT_CONFIGURED")

    message = MIMEMultipart()
    message["From"] = configuration.sender
    message["To"] = recipient
    message["Subject"] = subject
    message.attach(MIMEText(str(noi_dung_html), "html", "utf-8"))

    try:
        context = _tls_context(configuration)
        if configuration.security == "ssl":
            connection = smtplib.SMTP_SSL(
                configuration.host,
                configuration.port,
                timeout=configuration.timeout_seconds,
                context=context,
            )
        else:
            connection = smtplib.SMTP(
                configuration.host,
                configuration.port,
                timeout=configuration.timeout_seconds,
            )

        with connection as server:
            if configuration.security == "starttls":
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
            server.login(configuration.username, configuration.password)
            refused = server.send_message(message, from_addr=configuration.sender, to_addrs=[recipient])
            if refused:
                log_structured_event(
                    "email.recipient_refused",
                    level="WARN",
                    fields={"recipientHash": recipient_hash},
                )
                return EmailDeliveryResult(False, "smtp", "SMTP_RECIPIENT_REFUSED")

        log_structured_event(
            "email.accepted",
            fields={"recipientHash": recipient_hash},
        )
        return EmailDeliveryResult(True, "smtp")
    except (smtplib.SMTPException, ssl.SSLError, OSError, TimeoutError) as exc:
        log_structured_event(
            "email.delivery_failed",
            level="WARN",
            fields={"recipientHash": recipient_hash, "errorType": type(exc).__name__},
        )
        return EmailDeliveryResult(False, "smtp", type(exc).__name__.upper())
