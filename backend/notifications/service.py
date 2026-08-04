"""Transactional notification creation for membership and work assignments."""

from __future__ import annotations

import os
import time
import uuid

from backend.auth.email_delivery_service import create_email_deliveries
from backend.shared.email_templates import application_url, render_branded_email


_QUERY_CHUNK_SIZE = 500


def _organization_name(cursor, organization_id: str) -> str:
    row = cursor.execute(
        "SELECT ten_to_chuc FROM to_chuc WHERE id = ? LIMIT 1",
        (organization_id,),
    ).fetchone()
    return str(row[0] or organization_id).strip() if row else str(organization_id)


def _accounts(cursor, user_ids) -> dict[str, tuple[str, str]]:
    result = {}
    ordered_ids = list(dict.fromkeys(str(user_id) for user_id in user_ids if user_id))
    for offset in range(0, len(ordered_ids), _QUERY_CHUNK_SIZE):
        chunk = ordered_ids[offset:offset + _QUERY_CHUNK_SIZE]
        placeholders = ", ".join("?" for _ in chunk)
        rows = cursor.execute(
            "SELECT id, email, COALESCE(NULLIF(ho_ten, ''), ten_dang_nhap, email) "
            f"FROM tai_khoan WHERE id IN ({placeholders})",
            tuple(chunk),
        ).fetchall()
        result.update({
            str(row[0]): (str(row[1] or "").strip(), str(row[2] or "bạn"))
            for row in rows
        })
    return result


def _email_html(display_name: str, title: str, message: str, route: str | None) -> str:
    action_url = application_url(route) if route else None
    return render_branded_email(
        title=title or "Bạn có thông báo mới",
        preheader=message,
        eyebrow="CẬP NHẬT CÔNG VIỆC",
        recipient_name=display_name or "bạn",
        lead=message,
        action_label="Mở BiddingFlow" if action_url else None,
        action_url=action_url,
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

    return queue_user_notifications(cursor, [{
        "user_id": user_id,
        "organization_id": organization_id,
        "kind": kind,
        "severity": severity,
        "title": title,
        "message": message,
        "email_subject": email_subject,
        "target_type": target_type,
        "target_id": target_id,
        "route": route,
        "now": now,
    }])[0]


def queue_user_notifications(cursor, notifications) -> list[str]:
    """Create in-app and email-outbox rows in bounded set-based operations."""

    prepared = []
    for item in notifications:
        created_at = int(time.time() if item.get("now") is None else item["now"])
        prepared.append({**item, "id": str(uuid.uuid4()), "created_at": created_at})
    if not prepared:
        return []
    cursor.executemany(
        """INSERT INTO user_notifications (
               id, user_id, organization_id, kind, severity, title, message,
               target_type, target_id, route, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                item["id"], item["user_id"], item.get("organization_id"),
                item["kind"], item.get("severity", "info"), item["title"],
                item["message"], item.get("target_type"), item.get("target_id"),
                item.get("route"), item["created_at"],
            )
            for item in prepared
        ],
    )
    # Production validates this key at startup. In local/test environments an
    # unset key must not make a successful mutation fail; in-app rows remain.
    if str(os.environ.get("EMAIL_OUTBOX_ENCRYPTION_KEY", "")).strip():
        accounts = _accounts(cursor, (item["user_id"] for item in prepared))
        deliveries = []
        for item in prepared:
            account = accounts.get(str(item["user_id"]))
            if not account or not account[0]:
                continue
            deliveries.append({
                "user_id": item["user_id"],
                "purpose": "user_notification",
                "recipient": account[0],
                "subject": item["email_subject"],
                "html_body": _email_html(
                    account[1],
                    item["title"],
                    item["message"],
                    item.get("route"),
                ),
                "sensitive_content": False,
                "now": item["created_at"],
            })
        create_email_deliveries(cursor, deliveries)
    return [item["id"] for item in prepared]


def snapshot_assignment_state(cursor, organization_id: str) -> dict:
    """Capture package/contract assignment ownership and labels for diffing."""

    rows = cursor.execute(
        """SELECT pc.id, pc.id_nhan_vien, pc.id_muc_tieu, pc.loai_doi_tuong,
                   CASE pc.loai_doi_tuong
                    WHEN 'goithau' THEN gt.ma_goi_thau
                    WHEN 'hopdong' THEN hd.so_hop_dong
                  END AS target_code,
                  CASE pc.loai_doi_tuong
                    WHEN 'goithau' THEN gt.ten_goi_thau
                    WHEN 'hopdong' THEN hd.ten_hop_dong
                   END AS target_name,
                   CASE pc.loai_doi_tuong
                     WHEN 'goithau' THEN COALESCE(NULLIF(gt.id_goc, ''), gt.id)
                     WHEN 'hopdong' THEN COALESCE(NULLIF(hd.id_goc, ''), hd.id)
                   END AS target_root_id,
                   COALESCE(NULLIF(trim(tv.ten_nhan_su), ''), NULLIF(trim(tk.ho_ten), ''), tk.ten_dang_nhap, tk.email, pc.id_nhan_vien) AS user_name,
                   pc.created_at
           FROM phan_cong_nhan_su pc
           LEFT JOIN goi_thau gt
             ON pc.loai_doi_tuong = 'goithau'
            AND gt.organization_id = pc.organization_id
            AND gt.id = pc.id_muc_tieu
           LEFT JOIN hop_dong hd
             ON pc.loai_doi_tuong = 'hopdong'
            AND hd.organization_id = pc.organization_id
            AND hd.id = pc.id_muc_tieu
           LEFT JOIN tai_khoan tk ON tk.id = pc.id_nhan_vien
           LEFT JOIN thanh_vien_to_chuc tv
             ON tv.organization_id = pc.organization_id
            AND tv.user_id = pc.id_nhan_vien
           WHERE pc.organization_id = ?
             AND pc.loai_doi_tuong IN ('goithau', 'hopdong')""",
        (organization_id,),
    ).fetchall()
    return {
        (str(row[3]), str(row[2]), str(row[1])): {
            "assignment_id": str(row[0]),
            "user_id": str(row[1]),
            "target_id": str(row[2]),
            "target_type": str(row[3]),
            "code": str(row[4] or "").strip(),
            "name": str(row[5] or "").strip(),
            "target_root_id": str(row[6] or row[2]).strip(),
            "user_name": str(row[7] or row[1]).strip(),
            "assigned_at": row[8],
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

    candidates = []
    remaining_targets = {
        (item["target_type"], item["target_id"])
        for item in after.values()
    }
    seen_targets = set()
    candidates_by_type = {"goithau": [], "hopdong": []}
    for key, old in before.items():
        target = (old["target_type"], old["target_id"])
        if key in after or target in remaining_targets or target in seen_targets:
            continue
        seen_targets.add(target)
        candidates.append(old)
        candidates_by_type[old["target_type"]].append(old)

    active_ids_by_type = {"goithau": set(), "hopdong": set()}
    for target_type, table_name in (
        ("goithau", "goi_thau"),
        ("hopdong", "hop_dong"),
    ):
        typed_candidates = candidates_by_type[target_type]
        target_ids = list(
            dict.fromkeys(item["target_id"] for item in typed_candidates)
        )
        for offset in range(0, len(target_ids), _QUERY_CHUNK_SIZE):
            chunk = target_ids[offset:offset + _QUERY_CHUNK_SIZE]
            placeholders = ", ".join("?" for _ in chunk)
            rows = cursor.execute(
                f"""SELECT id FROM {table_name}
                    WHERE organization_id = ?
                      AND id IN ({placeholders})
                      AND archived_at IS NULL""",
                (organization_id, *chunk),
            ).fetchall()
            active_ids_by_type[target_type].update(str(row[0]) for row in rows)

    return [
        old
        for old in candidates
        if str(old["target_id"]) in active_ids_by_type[old["target_type"]]
    ]


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
    notifications = []
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
            notifications.append({
                "user_id": old_user,
                "organization_id": organization_id,
                "kind": "assignment_removed",
                "severity": "warning",
                "title": f"Không còn phụ trách {display_type}",
                "message": (
                    f"Bạn không còn được phân công phụ trách {noun} {identity} tại "
                    f"{organization_name} và không còn quyền truy cập công việc này."
                ),
                "email_subject": f"[BiddingFlow] Bạn không còn phụ trách {display_type}",
                "target_type": item["target_type"],
                "target_id": item["target_id"],
            })
        if new_user:
            item = new
            noun, display_type, identity = _target_copy(item)
            route_prefix = "/goi-thau-chi-tiet/" if item["target_type"] == "goithau" else "/hop-dong-chi-tiet/"
            route = f"{route_prefix}{item['target_id']}"
            notifications.append({
                "user_id": new_user,
                "organization_id": organization_id,
                "kind": "assignment_added",
                "title": f"Được phân công {display_type}",
                "message": f"Bạn đã được phân công phụ trách {noun} {identity} tại {organization_name}.",
                "email_subject": f"[BiddingFlow] Bạn được phân công {display_type}",
                "target_type": item["target_type"],
                "target_id": item["target_id"],
                "route": route,
            })
    return len(queue_user_notifications(cursor, notifications))


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
