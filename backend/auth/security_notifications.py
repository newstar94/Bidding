"""PII-minimized account security notification helpers."""

from __future__ import annotations

from starlette.background import BackgroundTasks

from backend.shared.helpers import gui_email
from backend.shared.email_templates import render_branded_email


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
    email_title = str(subject or "").removeprefix("[BiddingFlow]").strip()
    body = render_branded_email(
        title=email_title or "Thông báo bảo mật tài khoản",
        preheader=message,
        eyebrow="BẢO MẬT TÀI KHOẢN",
        recipient_name=display_name or "bạn",
        lead=message,
        notice="Nếu không phải bạn thực hiện, hãy đổi mật khẩu và liên hệ quản trị viên ngay.",
        notice_tone="danger",
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
