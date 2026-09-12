from types import SimpleNamespace

import pytest

from backend.auth.session_utils import OrgPermissionError, OrgScopeRequiredError, get_active_org


class _Cursor:
    def __init__(self, memberships):
        self.memberships = memberships
        self.statement = ""

    def execute(self, statement, _params=()):
        self.statement = " ".join(str(statement).split())
        self.params = _params
        return self

    def fetchone(self):
        if "FROM tai_khoan" in self.statement:
            return ("user", "active")
        return next((row for row in self.memberships if row["id"] == self.params[1]), None)

    def fetchall(self):
        return self.memberships


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
def test_missing_active_org_is_rejected_for_multiple_memberships(method):
    request = SimpleNamespace(headers={}, method=method)
    cursor = _Cursor(
        [
            {"id": "org-a", "trang_thai": "active", "vai_tro_trong_to_chuc": "manager"},
            {"id": "org-b", "trang_thai": "active", "vai_tro_trong_to_chuc": "employee"},
        ]
    )
    with pytest.raises(OrgScopeRequiredError) as error:
        get_active_org(request, "user-1", cursor=cursor)
    assert error.value.code == "ORG_SCOPE_REQUIRED"
    assert error.value.status_code == 409


def test_single_membership_still_falls_back_without_header():
    request = SimpleNamespace(headers={}, method="GET")
    cursor = _Cursor(
        [{"id": "org-a", "trang_thai": "active", "vai_tro_trong_to_chuc": "manager"}]
    )
    assert get_active_org(request, "user-1", cursor=cursor) == "org-a"


def test_inactive_organization_does_not_silently_fall_back_to_personal_scope():
    request = SimpleNamespace(headers={}, method="GET")
    cursor = _Cursor(
        [{"id": "org-a", "trang_thai": "suspended", "vai_tro_trong_to_chuc": "manager"}]
    )
    with pytest.raises(OrgPermissionError, match="tạm ngưng"):
        get_active_org(request, "user-1", cursor=cursor)


def test_scope_error_exposes_stable_http_contract():
    error = OrgScopeRequiredError("Cần chọn workspace")
    assert error.code == "ORG_SCOPE_REQUIRED"
    assert error.status_code == 409


def test_explicit_scope_is_revalidated_after_membership_revocation():
    request = SimpleNamespace(headers={"X-Active-Org": "org-b"}, state=SimpleNamespace())
    cursor = _Cursor([
        {"id": "org-a", "trang_thai": "active", "vai_tro_trong_to_chuc": "manager"},
        {"id": "org-b", "trang_thai": "active", "vai_tro_trong_to_chuc": "employee"},
    ])
    assert get_active_org(request, "user-1", cursor=cursor) == "org-b"
    assert request.state.organization_context.membership_role == "employee"
    cursor.memberships.pop()
    with pytest.raises(OrgPermissionError, match="Không có quyền"):
        get_active_org(request, "user-1", cursor=cursor)


@pytest.mark.parametrize("status,role", [("suspended", "manager"), ("active", "unknown")])
def test_explicit_scope_rejects_inactive_organization_or_invalid_role(status, role):
    request = SimpleNamespace(headers={"X-Active-Org": "org-a"})
    cursor = _Cursor([
        {"id": "org-a", "trang_thai": status, "vai_tro_trong_to_chuc": role},
    ])
    with pytest.raises(OrgPermissionError):
        get_active_org(request, "user-1", cursor=cursor)
