"""Email-client-safe, branded HTML templates for BiddingFlow messages."""

from __future__ import annotations

from html import escape
from html.parser import HTMLParser
import os
import re
from urllib.parse import urlparse


BRAND_NAME = "BiddingFlow"
BRAND_COLOR = "#3157e8"
BRAND_STRONG = "#2446c7"
ACCENT_COLOR = "#0797a6"
CANVAS_COLOR = "#f5f8fc"
INK_COLOR = "#111a2c"
MUTED_COLOR = "#53627a"
LINE_COLOR = "#dce5f0"
EMAIL_BRAND_CONTENT_ID = "biddingflow-brand-icon"

_NOTICE_TONES = {
    "info": ("#edf2ff", "#3157e8", "#2446c7"),
    "success": ("#eaf9f4", "#0f766e", "#0b625c"),
    "warning": ("#fff7ed", "#c2410c", "#9a3412"),
    "danger": ("#fff0f2", "#c73543", "#9f2635"),
}


def _text(value) -> str:
    return escape(str(value or ""), quote=True)


def _safe_http_url(value: str | None) -> str | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return candidate


def application_url(route: str | None = None) -> str | None:
    """Return a validated absolute application URL for an optional local route."""

    public_url = _safe_http_url(os.environ.get("APP_PUBLIC_URL"))
    if not public_url:
        return None
    base = public_url.rstrip("/")
    if not route:
        return base
    local_route = str(route).strip()
    if (
        not local_route.startswith("/")
        or local_route.startswith("//")
        or "\\" in local_route
        or any(character in local_route for character in ("\r", "\n", "\x00"))
    ):
        return None
    return f"{base}{local_route}"


def _paragraphs(values) -> str:
    return "".join(
        '<p style="margin:0 0 16px;color:#40506a;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;'
        'font-size:16px;line-height:1.7;">'
        f"{_text(value)}</p>"
        for value in values
        if str(value or "").strip()
    )


def _details_table(details) -> str:
    rows = []
    for label, value in details or ():
        if not str(value or "").strip():
            continue
        rows.append(
            '<tr><td style="padding:10px 12px;border-bottom:1px solid #dce5f0;'
            'color:#53627a;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;font-size:13px;'
            'font-weight:700;vertical-align:top;width:34%;">'
            f"{_text(label)}</td>"
            '<td style="padding:10px 12px;border-bottom:1px solid #dce5f0;'
            'color:#111a2c;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;font-size:14px;'
            'font-weight:600;vertical-align:top;word-break:break-word;">'
            f"{_text(value)}</td></tr>"
        )
    if not rows:
        return ""
    return (
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="margin:4px 0 20px;border:1px solid #dce5f0;border-radius:10px;'
        'border-collapse:separate;overflow:hidden;background:#f8faff;">'
        f"{''.join(rows)}</table>"
    )


def _code_panel(code: str | None, label: str | None) -> str:
    if not str(code or "").strip():
        return ""
    return (
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        'style="margin:8px 0 22px;border-collapse:separate;">'
        '<tr><td align="center" style="padding:20px 16px;border:1px solid #cfd9ff;'
        'border-radius:12px;background:#edf2ff;">'
        '<div style="margin:0 0 7px;color:#53627a;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;'
        'font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">'
        f"{_text(label or 'Mã xác thực')}</div>"
        '<div style="color:#2446c7;font-family:Consolas,Menlo,Monaco,monospace;'
        'font-size:28px;font-weight:800;line-height:1.25;letter-spacing:6px;word-break:break-all;">'
        f"{_text(code)}</div></td></tr></table>"
    )


def _action_button(label: str | None, url: str | None) -> str:
    safe_url = _safe_http_url(url)
    if not label or not safe_url:
        return ""
    href = _text(safe_url)
    return (
        '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 22px;">'
        '<tr><td bgcolor="#3157e8" style="border-radius:9px;">'
        f'<a href="{href}" style="display:inline-block;padding:13px 22px;color:#ffffff;'
        'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;'
        'line-height:20px;text-decoration:none;border-radius:9px;">'
        f"{_text(label)}</a></td></tr></table>"
        '<p style="margin:0 0 20px;color:#6b7890;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;'
        'font-size:12px;line-height:1.6;word-break:break-all;">'
        'Nếu nút không hoạt động, sao chép liên kết này vào trình duyệt:<br>'
        f'<a href="{href}" style="color:#3157e8;text-decoration:underline;">{href}</a></p>'
    )


def _notice_panel(message: str | None, tone: str) -> str:
    if not str(message or "").strip():
        return ""
    background, border, foreground = _NOTICE_TONES.get(tone, _NOTICE_TONES["info"])
    return (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'style="margin:2px 0 20px;border-left:4px solid {border};border-collapse:separate;">'
        f'<tr><td style="padding:13px 15px;background:{background};color:{foreground};'
        'font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;line-height:1.6;">'
        f"{_text(message)}</td></tr></table>"
    )


def render_branded_email(
    *,
    title: str,
    preheader: str | None = None,
    eyebrow: str = "THÔNG BÁO TÀI KHOẢN",
    recipient_name: str | None = None,
    lead: str | None = None,
    paragraphs=(),
    details=(),
    code: str | None = None,
    code_label: str | None = None,
    action_label: str | None = None,
    action_url: str | None = None,
    notice: str | None = None,
    notice_tone: str = "info",
) -> str:
    """Render one escaped, responsive email with conservative inline styling."""

    greeting = ""
    if recipient_name is not None:
        greeting = (
            '<p style="margin:0 0 14px;color:#111a2c;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;'
            'font-size:16px;line-height:1.65;">Xin chào '
            f"<strong>{_text(recipient_name or 'bạn')}</strong>,</p>"
        )
    lead_html = ""
    if str(lead or "").strip():
        lead_html = (
            '<p style="margin:0 0 18px;color:#111a2c;font-family:\'Segoe UI\',Arial,Helvetica,sans-serif;'
            'font-size:17px;font-weight:600;line-height:1.65;">'
            f"{_text(lead)}</p>"
        )
    home_url = application_url()
    footer_link = (
        f'<a href="{_text(home_url)}" style="color:#3157e8;text-decoration:none;font-weight:700;">'
        "Mở BiddingFlow</a>"
        if home_url
        else "BiddingFlow"
    )
    preview = preheader or lead or title
    return f"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{_text(title)}</title>
  <style>
    @media screen and (max-width:640px) {{
      .bf-email-shell {{ width:100% !important; }}
      .bf-email-pad {{ padding-left:20px !important; padding-right:20px !important; }}
      .bf-email-title {{ font-size:25px !important; }}
    }}
  </style>
</head>
<body style="margin:0;padding:0;background:{CANVAS_COLOR};color:{INK_COLOR};font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <div class="email-preheader" style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    {_text(preview)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="{CANVAS_COLOR}" style="width:100%;background:{CANVAS_COLOR};border-collapse:collapse;">
    <tr><td align="center" style="padding:30px 12px;">
      <table role="presentation" class="bf-email-shell" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:640px;border-collapse:separate;">
        <tr><td style="padding:0 8px 14px;color:#6b7890;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;text-align:center;">
          Email tự động từ hệ thống quản lý đấu thầu BiddingFlow
        </td></tr>
        <tr><td style="border:1px solid {LINE_COLOR};border-radius:16px;background:#ffffff;box-shadow:0 12px 36px rgba(35,57,91,.09);overflow:hidden;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr><td class="bf-email-pad" style="padding:22px 32px;border-bottom:1px solid {LINE_COLOR};background:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td width="48" valign="middle">
                    <img src="cid:{EMAIL_BRAND_CONTENT_ID}" alt="" width="42" height="42" style="display:block;width:42px;height:42px;border:0;border-radius:11px;">
                  </td>
                  <td valign="middle" style="padding-left:10px;">
                    <div style="color:{INK_COLOR};font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;letter-spacing:-.2px;">{BRAND_NAME}</div>
                    <div style="margin-top:2px;color:{MUTED_COLOR};font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:.45px;text-transform:uppercase;">Hệ thống quản lý đấu thầu</div>
                  </td>
                </tr>
              </table>
            </td></tr>
            <tr><td height="4" style="height:4px;background:{ACCENT_COLOR};font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td class="bf-email-pad" style="padding:34px 40px 30px;background:#ffffff;">
              <div style="margin:0 0 9px;color:{BRAND_COLOR};font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.25px;text-transform:uppercase;">{_text(eyebrow)}</div>
              <h1 class="bf-email-title" style="margin:0 0 22px;color:{INK_COLOR};font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:29px;font-weight:700;line-height:1.3;letter-spacing:-.4px;">{_text(title)}</h1>
              {greeting}{lead_html}{_paragraphs(paragraphs)}{_details_table(details)}{_code_panel(code, code_label)}{_action_button(action_label, action_url)}{_notice_panel(notice, notice_tone)}
              <p style="margin:24px 0 0;padding-top:20px;border-top:1px solid {LINE_COLOR};color:#6b7890;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.65;">
                Trân trọng,<br><strong style="color:{INK_COLOR};">Đội ngũ BiddingFlow</strong>
              </p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 24px 0;color:#718097;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px;line-height:1.65;text-align:center;">
          Đây là email tự động, vui lòng không trả lời trực tiếp.<br>{footer_link}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


class _PlainTextExtractor(HTMLParser):
    _BLOCKS = {"br", "p", "div", "h1", "h2", "h3", "tr", "td", "table"}
    _VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if self._skip_depth:
            if tag not in self._VOID:
                self._skip_depth += 1
            return
        if tag in {"head", "style", "script"} or "email-preheader" in attributes.get("class", ""):
            self._skip_depth = 1
            return
        if tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if self._skip_depth:
            self._skip_depth -= 1
            return
        if tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip_depth:
            self.parts.append(data)


def html_to_plain_text(value: str) -> str:
    """Create a readable fallback body without logging or persisting content."""

    parser = _PlainTextExtractor()
    parser.feed(str(value or ""))
    text = "".join(parser.parts).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    compact: list[str] = []
    for line in lines:
        if line or (compact and compact[-1]):
            compact.append(line)
    return "\n".join(compact).strip()
