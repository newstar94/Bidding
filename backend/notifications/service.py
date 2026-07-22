"""Transactional notification creation for membership and work assignments."""

from __future__ import annotations

import html
import os
import time
import uuid

from backend.auth.email_delivery_service import create_email_delivery


def _organization_name(cursor, organization_id: str) -> str:
    row = cursor.execute(
        "SELECT ten_to_chuc FROM to_chuc WHERE id = ? LIMIT 1",
        (organization_id,),
    ).fetchone()
    return str(row[0] or organization_id).strip() if row else str(organization_id)


def _account(cursor, user_id: str):
    return cursor.execute(
        "SELECT email, COALESCE(NULLIF(ho_ten, ''), ten_dang_nhap, email) "
        "FROM tai_khoan WHERE id = ? LIMIT 1",
        (user_id,),
    ).fetchone()


def _email_html(display_name: str, message: str, route: str | None) -> str:
    safe_name = html.escape(display_name or "bạn")
    safe_message = html.escape(message)
    public_url = str(os.environ.get("APP_PUBLIC_URL", "")).strip().rstrip("/")
    action = ""
    if route and public_url:
        href = html.escape(f"{public_url}{route}", quote=True)
        action = (
            '<p style="margin:24px 0">'
            f'<a href="{href}" style="background:#4356d8;color:#fff;text-decoration:none;'
            'padding:11px 18px;border-radius:8px;display:inline-block">Mở BiddingFlow</a></p>'
        )
    return (
        '<html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b">'
        f"<p>Xin chào <strong>{safe_name}</strong>,</p>"
        f"<p>{safe_message}</p>{action}"
        '<p style="color:#64748b;font-size:13px">Đây là email tự động từ BiddingFlow.</p>'
        "</body></html>"
    )


def queue_user_notification(
    cursor,
    *,
    user_id: str,
    organization_id: str | None,
    kind: str,
    title: str,
    message: str,
    email_subject: str,
    target_type: str | None = None,
    target_id: str | None = None,
    route: str | None = None,
    severity: str = "info",
    now: int | None = None,
) -> str:
    """Create the in-app row and its durable email in the caller transaction."""

    created_at = int(time.time() if now is None else now)
    notification_id = str(uuid.uuid4())
    cursor.execute(
        """INSERT INTO user_notifications (
               id, user_id, organization_id, kind, severity, title, message,
               target_type, target_id, route, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            notification_id,
            user_id,
            organization_id,
            kind,
            severity,
            title,
            message,
            target_type,
            target_id,
            route,
            created_at,
        ),
    )
    account = _account(cursor, user_id)
    # Production validates this key at startup. In local/test environments an
    # unset key must not make a successful membership or assignment mutation
    # fail; the durable in-app notification remains available in that case.
    if account and str(account[0] or "").strip() and str(os.environ.get("EMAIL_OUTBOX_ENCRYPTION_KEY", "")).strip():
        create_email_delivery(
            cursor,
            user_id=user_id,
            purpose="user_notification",
            recipient=str(account[0]).strip(),
            subject=email_subject,
            html_body=_email_html(str(account[1] or "bạn"), message, route),
            sensitive_content=False,
            now=created_at,
        )
    return notification_id


def snapshot_assignment_state(cursor, organization_id: str) -> dict:
    """Capture package/contract assignment ownership and labels for diffing."""

    rows = cursor.execute(
        """SELECT pc.id_nhan_vien, pc.id_muc_tieu, pc.loai_doi_tuong,
                  CASE pc.loai_doi_tuong
                    WHEN 'goithau' THEN gt.ma_goi_thau
                    WHEN 'hopdong' THEN hd.so_hop_dong
                  END AS target_code,
                  CASE pc.loai_doi_tuong
                    WHEN 'goithau' THEN gt.ten_goi_thau
                    WHEN 'hopdong' THEN hd.ten_hop_dong
                  END AS target_name
           FROM phan_cong_nhan_su pc
           LEFT JOIN goi_thau gt
             ON pc.loai_doi_tuong = 'goithau'
            AND gt.organization_id = pc.organization_id
            AND gt.id = pc.id_muc_tieu
           LEFT JOIN hop_dong hd
             ON pc.loai_doi_tuong = 'hopdong'
            AND hd.organization_id = pc.organization_id
            AND hd.id = pc.id_muc_tieu
           WHERE pc.organization_id = ?
             AND pc.loai_doi_tuong IN ('goithau', 'hopdong')""",
        (organization_id,),
    ).fetchall()
    return {
        (str(row[2]), str(row[1])): {
            "user_id": str(row[0]),
            "target_id": str(row[1]),
            "target_type": str(row[2]),
            "code": str(row[3] or "").strip(),
            "name": str(row[4] or "").strip(),
        }
        for row in rows
    }


def find_unreplaced_assignment_removals(
    cursor,
    *,
    organization_id: str,
    before: dict,
    after: dict,
) -> list[dict]:
    """Return active work targets whose assignee was removed without replacement."""

    missing = []
    for key, old in before.items():
        if key in after:
            continue
        table_name = "goi_thau" if old["target_type"] == "goithau" else "hop_dong"
        target_exists = cursor.execute(
            f"""SELECT 1 FROM {table_name}
                WHERE organization_id = ? AND id = ? AND archived_at IS NULL
                LIMIT 1""",
            (organization_id, old["target_id"]),
        ).fetchone()
        if target_exists:
            missing.append(old)
    return missing


def _target_copy(item: dict) -> tuple[str, str, str]:
    target_type = item["target_type"]
    noun = "gói thầu" if target_type == "goithau" else "hợp đồng"
    display_type = "Gói thầu" if target_type == "goithau" else "Hợp đồng"
    identity = item.get("code") or item.get("name") or item["target_id"]
    if item.get("name") and item.get("code"):
        identity = f"{item['code']} – {item['name']}"
    return noun, display_type, identity


def queue_assignment_state_changes(
    cursor,
    *,
    organization_id: str,
    before: dict,
    after: dict,
) -> int:
    """Notify users affected by an assignment add, removal, or transfer."""

    organization_name = _organization_name(cursor, organization_id)
    created = 0
    for key in sorted(set(before) | set(after)):
        old = before.get(key)
        new = after.get(key)
        old_user = old and old["user_id"]
        new_user = new and new["user_id"]
        if old_user == new_user:
            continue
        if old_user:
            item = old
            noun, display_type, identity = _target_copy(item)
            queue_user_notification(
                cursor,
                user_id=old_user,
                organization_id=organization_id,
                kind="assignment_removed",
                severity="warning",
                title=f"Không còn phụ trách {display_type}",
                message=(
                    f"Bạn không còn được phân công phụ trách {noun} {identity} tại "
                    f"{organization_name} và không còn quyền truy cập công việc này."
                ),
                email_subject=f"[BiddingFlow] Bạn không còn phụ trách {display_type}",
                target_type=item["target_type"],
                target_id=item["target_id"],
            )
            created += 1
        if new_user:
            item = new
            noun, display_type, identity = _target_copy(item)
            route_prefix = "/goi-thau-chi-tiet/" if item["target_type"] == "goithau" else "/hop-dong-chi-tiet/"
            route = f"{route_prefix}{item['target_id']}"
            queue_user_notification(
                cursor,
                user_id=new_user,
                organization_id=organization_id,
                kind="assignment_added",
                title=f"Được phân công {display_type}",
                message=f"Bạn đã được phân công phụ trách {noun} {identity} tại {organization_name}.",
                email_subject=f"[BiddingFlow] Bạn được phân công {display_type}",
                target_type=item["target_type"],
                target_id=item["target_id"],
                route=route,
            )
            created += 1
    return created


def queue_membership_notification(
    cursor,
    *,
    user_id: str,
    organization_id: str,
    added: bool,
) -> str:
    organization_name = _organization_name(cursor, organization_id)
    if added:
        return queue_user_notification(
            cursor,
            user_id=user_id,
            organization_id=organization_id,
            kind="organization_added",
            title="Đã được thêm vào tổ chức",
            message=f"Bạn đã được thêm vào tổ chức {organization_name} với vai trò Chuyên viên.",
            email_subject="[BiddingFlow] Bạn đã được thêm vào tổ chức",
        )
    return queue_user_notification(
        cursor,
        user_id=user_id,
        organization_id=organization_id,
        kind="organization_removed",
        severity="warning",
        title="Đã rời tổ chức",
        message=f"Bạn không còn là thành viên của tổ chức {organization_name} và không còn quyền truy cập dữ liệu của tổ chức này.",
        email_subject="[BiddingFlow] Bạn không còn thuộc tổ chức",
    )
