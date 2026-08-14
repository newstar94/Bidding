from backend.auth import email_utils
from backend.shared.email_templates import render_branded_email


def test_email_brand_icon_is_small_rgba_png():
    data = email_utils.EMAIL_BRAND_ICON_PATH.read_bytes()

    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    assert int.from_bytes(data[16:20], "big") == 96
    assert int.from_bytes(data[20:24], "big") == 96
    assert data[25] == 6  # PNG truecolour with alpha
    assert len(data) < 30_000


def test_branded_email_uses_cid_icon_and_email_safe_system_fonts():
    html = render_branded_email(title="Thông báo thử nghiệm")

    assert 'src="cid:biddingflow-brand-icon"' in html
    assert "@font-face" not in html
    assert "Plus Jakarta Sans" not in html
    assert "'Segoe UI',Arial,Helvetica,sans-serif" in html


def test_smtp_message_embeds_brand_icon_as_related_content(monkeypatch):
    captured = {}
    configuration = email_utils.SmtpConfiguration(
        host="smtp.example.test",
        port=587,
        username="mailer@example.test",
        password="secret",
        sender="mailer@example.test",
        security="starttls",
        timeout_seconds=5,
        ca_file=None,
    )

    class FakeSmtp:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def ehlo(self):
            pass

        def starttls(self, *, context):
            assert context is captured["context"]

        def login(self, username, password):
            assert (username, password) == (configuration.username, configuration.password)

        def send_message(self, message, **_kwargs):
            captured["message"] = message
            return {}

    captured["context"] = object()
    monkeypatch.setattr(email_utils, "_load_configuration", lambda: configuration)
    monkeypatch.setattr(email_utils, "_tls_context", lambda _configuration: captured["context"])
    monkeypatch.setattr(email_utils.smtplib, "SMTP", FakeSmtp)

    result = email_utils.gui_email(
        "recipient@example.test",
        "Thông báo",
        render_branded_email(title="Thông báo"),
    )

    assert result.accepted is True
    message = captured["message"]
    assert message.get_content_type() == "multipart/related"
    inline_images = [
        part
        for part in message.walk()
        if part.get_content_maintype() == "image"
    ]
    assert len(inline_images) == 1
    assert inline_images[0]["Content-ID"] == "<biddingflow-brand-icon>"
    assert inline_images[0].get_filename() == "biddingflow-email-icon.png"
