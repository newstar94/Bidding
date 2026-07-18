"""Stable identifiers for virtual personal workspaces.

Personal workspaces are account-owned data scopes. They are deliberately not
organizations and therefore never have rows in ``to_chuc`` or
``thanh_vien_to_chuc``.
"""


PERSONAL_SCOPE_PREFIX = "personal:"


def personal_scope_id(user_id):
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        raise ValueError("A personal scope requires a user ID")
    return f"{PERSONAL_SCOPE_PREFIX}{normalized_user_id}"


def personal_scope_owner_id(scope_id):
    normalized_scope_id = str(scope_id or "").strip()
    if not normalized_scope_id.startswith(PERSONAL_SCOPE_PREFIX):
        return None
    owner_id = normalized_scope_id[len(PERSONAL_SCOPE_PREFIX):].strip()
    return owner_id or None


def is_personal_scope_for_user(scope_id, user_id):
    owner_id = personal_scope_owner_id(scope_id)
    return bool(owner_id and owner_id == str(user_id or "").strip())


def personal_workspace_payload(user_id, display_name=None, subscription=None):
    return {
        "id": personal_scope_id(user_id),
        "name": "Cá nhân",
        "scope_type": "personal",
        "role": "employee",
        "status": "active",
        "subscription": subscription,
        "entitlements": {
            "word_export": bool(
                subscription and subscription.get("status") == "active"
            ),
            "source": "account_subscription",
        },
    }
