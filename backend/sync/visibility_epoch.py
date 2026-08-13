"""Versioned opaque fingerprint for one principal's visible projection."""

from __future__ import annotations

import hashlib
import json

from backend.shared.workspace_scope import is_personal_scope_for_user


VISIBILITY_POLICY_VERSION = 3
_PERMISSION_COLUMNS = (
    "kehoach",
    "goithau",
    "chudautu",
    "nhathau",
    "chuyengia",
    "hopdong",
)


def _row_values(row):
    if row is None:
        return None
    if hasattr(row, "keys"):
        return [row[key] for key in row.keys()]
    return list(row)


def build_visibility_token(
    cursor,
    organization_id,
    user_id,
    role_str=None,
    *,
    now=None,
):
    """Hash every stable input that can change rows or fields a client sees."""

    del now
    membership = cursor.execute(
        """SELECT lower(trim(vai_tro_trong_to_chuc)),
                  COALESCE(trang_thai_thanh_vien, 'active'), updated_at
             FROM thanh_vien_to_chuc
            WHERE organization_id = ? AND user_id = ?""",
        (organization_id, user_id),
    ).fetchone()
    account = cursor.execute(
        """SELECT lower(trim(vai_tro)), COALESCE(trang_thai, 'active'), updated_at
             FROM tai_khoan WHERE id = ?""",
        (user_id,),
    ).fetchone()
    organization = cursor.execute(
        """SELECT COALESCE(trang_thai, 'active'), updated_at
             FROM to_chuc WHERE id = ?""",
        (organization_id,),
    ).fetchone()
    permission = cursor.execute(
        f"""SELECT owner_type, {', '.join(_PERMISSION_COLUMNS)},
                   sync_version, updated_at
              FROM ma_tran_phan_quyen
             WHERE organization_id = ? AND emp_id = ?""",  # noqa: S608
        (organization_id, user_id),
    ).fetchone()
    assignments = cursor.execute(
        """SELECT loai_doi_tuong, id_muc_tieu
             FROM phan_cong_nhan_su
            WHERE organization_id = ? AND id_nhan_vien = ?
            ORDER BY loai_doi_tuong, id_muc_tieu""",
        (organization_id, user_id),
    ).fetchall()
    platform_role = str(
        getattr(role_str, "platform_role", role_str or "") or ""
    ).strip().lower()
    effective_role = str(
        getattr(role_str, "active_role", None) or role_str or ""
    ).strip().lower()
    scope_type = (
        "personal"
        if is_personal_scope_for_user(organization_id, user_id)
        else "organization"
    )
    canonical = {
        "policyVersion": VISIBILITY_POLICY_VERSION,
        "scope": [scope_type, str(organization_id), str(user_id)],
        "roles": [platform_role, effective_role],
        "account": _row_values(account),
        "organization": _row_values(organization),
        "membership": _row_values(membership),
        "permissions": _row_values(permission),
        "assignments": [_row_values(row) for row in assignments],
    }
    return hashlib.sha256(
        json.dumps(
            canonical,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode()
    ).hexdigest()
