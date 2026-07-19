"""PII-minimized account security notification helpers."""

from __future__ import annotations

import html
from starlette.background import BackgroundTasks

from backend.shared.helpers import gui_email


def build_security_notification_tasks(
    *,
    email: str | None,
    display_name: str | None,
    subject: str,
    message: str,
) -> BackgroundTasks | None:
    recipient = str(email or "").strip()
    if not recipient:
        return None
    safe_name = html.escape(str(display_name or "bạn"))
    safe_message = html.escape(str(message))
    body = (
        '<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b">'
        f"<p>Xin chào <strong>{safe_name}</strong>,</p>"
        f"<p>{safe_message}</p>"
        "<p>Nếu không phải bạn thực hiện, hãy đổi mật khẩu và liên hệ quản trị viên ngay.</p>"
        "</body></html>"
    )
    tasks = BackgroundTasks()
    tasks.add_task(gui_email, recipient, subject, body)
    return tasks


def build_security_notification_batch(
    recipients,
    *,
    subject: str,
    message: str,
    max_recipients: int = 50,
) -> BackgroundTasks | None:
    tasks = BackgroundTasks()
    seen = set()
    for email, display_name in list(recipients or [])[:max_recipients]:
        recipient = str(email or "").strip()
        normalized = recipient.casefold()
        if not recipient or normalized in seen:
            continue
        seen.add(normalized)
        single = build_security_notification_tasks(
            email=recipient,
            display_name=display_name,
            subject=subject,
            message=message,
        )
        if single:
            for task in single.tasks:
                tasks.tasks.append(task)
    return tasks if tasks.tasks else None
