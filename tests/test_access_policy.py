from __future__ import annotations

from collections import deque

import pytest

from backend.shared import access_policy
from backend.shared.access_policy import AccessDecision, DocumentExportCapabilities


class _Cursor:
    def __init__(self, *, one=(), many=()):
        self.one = deque(one)
        self.many = deque(many)
        self.calls = []

    def execute(self, sql, parameters=()):
        self.calls.append((sql, parameters))
        return self

    def fetchone(self):
        return self.one.popleft() if self.one else None

    def fetchall(self):
        return self.many.popleft() if self.many else []


def test_role_and_membership_resolution_is_scope_bound() -> None:
    assert access_policy.is_manager_role("super_admin")
    assert not access_policy.is_manager_role("manager")
    assert not access_policy.organization_membership_role(_Cursor(), "", "org-1")
    assert not access_policy.organization_membership_role(_Cursor(), "user-1", "")

    cursor = _Cursor(one=[(" MANAGER ",)])
    assert (
        access_policy.organization_membership_role(cursor, "user-1", "org-1")
        == "manager"
    )
    assert cursor.calls[0][1] == ("user-1", "org-1")
    assert (
        access_policy.organization_membership_role(
            _Cursor(one=[None]), "user-1", "org-1"
        )
        is None
    )

    assert access_policy.is_business_organization(
        _Cursor(one=[(1,)]), "org-1"
    )
    assert not access_policy.is_business_organization(_Cursor(), "org-2")


def test_personal_owner_never_accepts_another_users_scope() -> None:
    cursor = _Cursor(one=[(1,)])
    assert access_policy.is_personal_workspace_owner(
        cursor, "user-1", "personal:user-1"
    )
    assert cursor.calls[0][1] == ("user-1",)
    assert not access_policy.is_personal_workspace_owner(
        _Cursor(one=[(1,)]), "user-1", "personal:user-2"
    )
    assert not access_policy.is_personal_workspace_owner(
        _Cursor(), "user-1", "personal:user-1"
    )


def test_manager_and_active_membership_checks() -> None:
    assert access_policy.is_organization_manager(
        _Cursor(), "super_admin", "admin", "org-1"
    )
    assert access_policy.has_active_organization_membership(
        _Cursor(), "super_admin", "admin", "org-1"
    )
    assert access_policy.is_organization_manager(
        _Cursor(one=[("manager",)]), "employee", "user-1", "org-1"
    )
    assert not access_policy.is_organization_manager(
        _Cursor(one=[("employee",)]), "employee", "user-1", "org-1"
    )
    assert access_policy.has_active_organization_membership(
        _Cursor(one=[("employee",)]), "employee", "user-1", "org-1"
    )
    assert not access_policy.has_active_organization_membership(
        _Cursor(), "employee", "user-1", "org-1"
    )


def test_document_capabilities_fail_closed_and_follow_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(access_policy, "can_use_word_export", lambda *_args: False)
    assert (
        access_policy.resolve_document_export_capabilities(
            _Cursor(), "employee", "user-1", "org-1"
        )
        == DocumentExportCapabilities()
    )

    monkeypatch.setattr(access_policy, "can_use_word_export", lambda *_args: True)
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: True
    )
    allowed = access_policy.resolve_document_export_capabilities(
        _Cursor(), "employee", "user-1", "personal:user-1"
    )
    assert allowed == DocumentExportCapabilities.allow_all()
    assert allowed.as_dict() == {
        "financial": True,
        "identity": True,
        "signature": True,
    }

    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: True
    )
    assert access_policy.resolve_document_export_capabilities(
        _Cursor(), "manager", "user-1", "org-1"
    ) == DocumentExportCapabilities.allow_all()

    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy,
        "has_active_organization_membership",
        lambda *_args: True,
    )
    capabilities = access_policy.resolve_document_export_capabilities(
        _Cursor(one=[(1, 0, 1)]), "employee", "user-1", "org-1"
    )
    assert capabilities == DocumentExportCapabilities(True, False, True)

    assert access_policy.resolve_document_export_capabilities(
        _Cursor(one=[None]), "employee", "user-1", "org-1"
    ) == DocumentExportCapabilities()
    monkeypatch.setattr(
        access_policy,
        "has_active_organization_membership",
        lambda *_args: False,
    )
    assert access_policy.resolve_document_export_capabilities(
        _Cursor(), "employee", "user-1", "org-1"
    ) == DocumentExportCapabilities()


def test_single_document_capability_uses_fixed_allowlist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        access_policy,
        "resolve_document_export_capabilities",
        lambda *_args: DocumentExportCapabilities(True, False, False),
    )
    assert access_policy.can_export_document_capability(
        _Cursor(), "employee", "user-1", "org-1", " FINANCIAL "
    )
    assert not access_policy.can_export_document_capability(
        _Cursor(), "employee", "user-1", "org-1", "unknown"
    )


class _BrokenRow:
    def __getitem__(self, _index):
        raise TypeError("broken row")


def test_module_permission_levels_and_malformed_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert access_policy._permission_for(_Cursor(), "org", "user", "") == ""
    assert access_policy._permission_for(
        _Cursor(one=[(" EDIT ",)]), "org", "user", "goithau"
    ) == "edit"
    assert access_policy._permission_for(
        _Cursor(one=[_BrokenRow()]), "org", "user", "goithau"
    ) == ""

    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: True
    )
    assert access_policy.has_module_permission(
        _Cursor(), "manager", "user", "org", "goithau", "edit"
    )
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: True
    )
    assert access_policy.has_module_permission(
        _Cursor(), "employee", "user", "personal:user", "goithau", "edit"
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy,
        "has_active_organization_membership",
        lambda *_args: False,
    )
    assert not access_policy.has_module_permission(
        _Cursor(), "employee", "user", "org", "goithau"
    )
    monkeypatch.setattr(
        access_policy,
        "has_active_organization_membership",
        lambda *_args: True,
    )
    monkeypatch.setattr(
        access_policy,
        "_permission_for",
        lambda *_args: "view",
    )
    assert access_policy.has_module_permission(
        _Cursor(), "employee", "user", "org", "goithau", "view"
    )
    assert not access_policy.has_module_permission(
        _Cursor(), "employee", "user", "org", "goithau", "edit"
    )
    monkeypatch.setattr(access_policy, "_permission_for", lambda *_args: "edit")
    assert access_policy.has_module_permission(
        _Cursor(), "employee", "user", "org", "goithau", "edit"
    )


def test_word_config_requires_export_and_edit_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(access_policy, "can_use_word_export", lambda *_args: False)
    assert not access_policy.can_manage_word_config(
        _Cursor(), "employee", "user", "org"
    )
    monkeypatch.setattr(access_policy, "can_use_word_export", lambda *_args: True)
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: True
    )
    assert access_policy.can_manage_word_config(
        _Cursor(), "manager", "user", "org"
    )
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: True
    )
    assert access_policy.can_manage_word_config(
        _Cursor(), "employee", "user", "personal:user"
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy,
        "has_module_permission",
        lambda *_args: _args[-2] == "goithau",
    )
    assert access_policy.can_manage_word_config(
        _Cursor(), "employee", "user", "org"
    )
    monkeypatch.setattr(
        access_policy, "has_module_permission", lambda *_args: False
    )
    assert not access_policy.can_manage_word_config(
        _Cursor(), "employee", "user", "org"
    )


def test_assignment_and_record_lookup_helpers_bind_tenant() -> None:
    assert not access_policy._assigned(_Cursor(), "org", "user", "", "goithau")
    assert not access_policy._assigned(_Cursor(), "org", "user", "id", "")
    cursor = _Cursor(one=[(1,)])
    assert access_policy._assigned(cursor, "org", "user", "id", "goithau")
    assert cursor.calls[0][1] == ("org", "user", "id", "goithau")
    assert not access_policy._assigned(
        _Cursor(), "org", "user", "id", "goithau"
    )

    assert not access_policy._table_record_exists(
        _Cursor(), "org", "goi_thau", ""
    )
    cursor = _Cursor(one=[(1,)])
    assert access_policy._table_record_exists(
        cursor, "org", "goi_thau", "id"
    )
    assert cursor.calls[0][1] == ("org", "id")


def test_lineage_and_ownership_helpers() -> None:
    assert access_policy._existing_lineage_root(
        _Cursor(one=[("root-1",)]),
        "org",
        "goi_thau",
        {"id": "version-1", "rootId": "root-requested"},
    ) == "root-1"
    assert access_policy._existing_lineage_root(
        _Cursor(one=[None, ("root-2",)]),
        "org",
        "goi_thau",
        {"id": "missing", "id_goc": "root-2"},
    ) == "root-2"
    assert access_policy._existing_lineage_root(
        _Cursor(), "org", "goi_thau", ""
    ) is None
    assert not access_policy._record_owned_by(
        _Cursor(), "org", "user", "goi_thau", ""
    )
    assert access_policy._record_owned_by(
        _Cursor(one=[(1,)]), "org", "user", "goi_thau", "root"
    )
    assert not access_policy._record_owned_by(
        _Cursor(), "org", "user", "goi_thau", "root"
    )


def test_lineage_assignment_checks_all_versions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert not access_policy._assigned_for_lineage(
        _Cursor(), "org", "user", "goi_thau", ""
    )
    monkeypatch.setattr(
        access_policy,
        "_assigned_for_table",
        lambda _cursor, _org, _user, _table, record_id: record_id == "v2",
    )
    assert access_policy._assigned_for_lineage(
        _Cursor(many=[[("v1",), ("v2",)]]),
        "org",
        "user",
        "goi_thau",
        "root",
    )
    assert not access_policy._assigned_for_lineage(
        _Cursor(many=[[("v1",)]]), "org", "user", "goi_thau", "root"
    )


def test_opening_parent_and_assignment_table_rules(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert access_policy._opening_parent_id(
        _Cursor(), "org", {"goiThauId": "package-1"}
    ) == "package-1"
    assert access_policy._opening_parent_id(_Cursor(), "org", {}) is None
    assert access_policy._opening_parent_id(
        _Cursor(one=[("package-2",)]), "org", "opening-1"
    ) == "package-2"
    assert access_policy._opening_parent_id(
        _Cursor(), "org", "opening-1"
    ) is None

    assignments = []
    monkeypatch.setattr(
        access_policy,
        "_assigned",
        lambda _cursor, _org, _user, target, kind: assignments.append(
            (target, kind)
        )
        or target == "assigned",
    )
    assert access_policy._assigned_for_table(
        _Cursor(),
        "org",
        "user",
        "thong_tin_mo_thau",
        {"goiThauId": "assigned"},
    )
    assert access_policy._assigned_for_table(
        _Cursor(), "org", "user", "nha_thau", "anything"
    )
    assert access_policy._assigned_for_table(
        _Cursor(), "org", "user", "goi_thau", "assigned"
    )
    assert not access_policy._assigned_for_table(
        _Cursor(), "org", "user", "hop_dong", {"id": "other"}
    )

    assert access_policy._assigned_for_table(
        _Cursor(), "org", "user", "ke_hoach_lcnt", "assigned"
    )
    assert access_policy._assigned_for_table(
        _Cursor(one=[(1,)]), "org", "user", "ke_hoach_lcnt", "other"
    )
    assert not access_policy._assigned_for_table(
        _Cursor(), "org", "user", "ke_hoach_lcnt", "other"
    )


def test_payload_key_write_protection() -> None:
    assert access_policy.authorize_payload_key_write(
        "super_admin", "employees"
    ).allowed
    assert access_policy.authorize_payload_key_write(
        "employee", "employees", organization_manager=True
    ).allowed
    denied = access_policy.authorize_payload_key_write("employee", "employees")
    assert not denied.allowed
    assert "employees" in denied.message
    assert access_policy.authorize_payload_key_write(
        "employee", "goithau"
    ).allowed


def test_assignment_write_only_allows_self_claim_of_new_valid_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    denied_other = access_policy.authorize_record_write(
        _Cursor(),
        "employee",
        "user-1",
        "org",
        "assignments",
        "phan_cong_nhan_su",
        {"empId": "user-2", "targetId": "target", "type": "goithau"},
    )
    assert not denied_other.allowed
    denied_target = access_policy.authorize_record_write(
        _Cursor(),
        "employee",
        "user-1",
        "org",
        "assignments",
        "phan_cong_nhan_su",
        {"empId": "user-1", "type": "invalid"},
    )
    assert not denied_target.allowed

    monkeypatch.setattr(
        access_policy, "_table_record_exists", lambda *_args: True
    )
    monkeypatch.setattr(access_policy, "_assigned", lambda *_args: False)
    denied_existing = access_policy.authorize_record_write(
        _Cursor(),
        "employee",
        "user-1",
        "org",
        "assignments",
        "phan_cong_nhan_su",
        {"empId": "user-1", "targetId": "target", "type": "goithau"},
    )
    assert not denied_existing.allowed
    monkeypatch.setattr(access_policy, "_assigned", lambda *_args: True)
    assert access_policy.authorize_record_write(
        _Cursor(),
        "employee",
        "user-1",
        "org",
        "assignments",
        "phan_cong_nhan_su",
        {"empId": "user-1", "targetId": "target", "type": "goithau"},
    ).allowed


def test_record_write_enforces_module_ownership_and_assignment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "has_module_permission", lambda *_args: False
    )
    assert not access_policy.authorize_record_write(
        _Cursor(), "employee", "user", "org", "goithau", "goi_thau", {"id": "1"}
    ).allowed

    monkeypatch.setattr(
        access_policy, "has_module_permission", lambda *_args: True
    )
    monkeypatch.setattr(
        access_policy, "_assigned_for_table", lambda *_args: False
    )
    assert not access_policy.authorize_record_write(
        _Cursor(),
        "employee",
        "user",
        "org",
        "thongtinmothau",
        "thong_tin_mo_thau",
        {"id": "1"},
    ).allowed

    monkeypatch.setattr(
        access_policy, "_existing_lineage_root", lambda *_args: "root"
    )
    monkeypatch.setattr(access_policy, "_record_owned_by", lambda *_args: False)
    assert not access_policy.authorize_record_write(
        _Cursor(), "employee", "user", "org", "nhathau", "nha_thau", {"id": "1"}
    ).allowed
    monkeypatch.setattr(access_policy, "_record_owned_by", lambda *_args: True)
    assert access_policy.authorize_record_write(
        _Cursor(), "employee", "user", "org", "nhathau", "nha_thau", {"id": "1"}
    ).allowed

    monkeypatch.setattr(
        access_policy, "_assigned_for_lineage", lambda *_args: False
    )
    assert not access_policy.authorize_record_write(
        _Cursor(), "employee", "user", "org", "goithau", "goi_thau", {"id": "1"}
    ).allowed
    monkeypatch.setattr(
        access_policy, "_assigned_for_lineage", lambda *_args: True
    )
    assert access_policy.authorize_record_write(
        _Cursor(), "employee", "user", "org", "goithau", "goi_thau", {"id": "1"}
    ).allowed


def test_record_write_manager_personal_and_protected_shortcuts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: True
    )
    assert access_policy.authorize_record_write(
        _Cursor(), "manager", "user", "org", "employees", "tai_khoan", {}
    ).allowed

    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    denied = access_policy.authorize_record_write(
        _Cursor(), "employee", "user", "org", "employees", "tai_khoan", {}
    )
    assert not denied.allowed
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: True
    )
    assert access_policy.authorize_record_write(
        _Cursor(), "employee", "user", "personal:user", "goithau", "goi_thau", {}
    ).allowed


def test_table_and_record_read_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: True
    )
    assert access_policy.can_read_table(
        _Cursor(), "manager", "user", "org", "employees", "tai_khoan"
    )
    assert access_policy.can_read_record(
        _Cursor(), "manager", "user", "org", "employees", "tai_khoan", "1"
    )

    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: True
    )
    assert access_policy.can_read_table(
        _Cursor(), "employee", "user", "personal:user", "goithau", "goi_thau"
    )
    assert not access_policy.can_read_table(
        _Cursor(), "employee", "user", "personal:user", "employees", "tai_khoan"
    )
    assert access_policy.can_read_record(
        _Cursor(), "employee", "user", "personal:user", "goithau", "goi_thau", "1"
    )

    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy,
        "has_active_organization_membership",
        lambda *_args: False,
    )
    assert not access_policy.can_read_table(
        _Cursor(), "employee", "user", "org", "goithau", "goi_thau"
    )
    monkeypatch.setattr(
        access_policy,
        "has_active_organization_membership",
        lambda *_args: True,
    )
    assert access_policy.can_read_table(
        _Cursor(), "employee", "user", "org", "assignments", "phan_cong_nhan_su"
    )
    monkeypatch.setattr(
        access_policy, "has_module_permission", lambda *_args: True
    )
    assert access_policy.can_read_record(
        _Cursor(), "employee", "user", "org", "nhathau", "nha_thau", "1"
    )
    monkeypatch.setattr(
        access_policy, "_assigned_for_table", lambda *_args: False
    )
    assert not access_policy.can_read_record(
        _Cursor(), "employee", "user", "org", "goithau", "goi_thau", "1"
    )


def test_filter_items_for_read_all_scope_variants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    items = [{"id": "1", "empId": "user"}, {"id": "2", "empId": "other"}]
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: True
    )
    assert access_policy.filter_items_for_read(
        _Cursor(), "manager", "user", "org", "employees", "tai_khoan", items
    ) == items

    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: True
    )
    assert access_policy.filter_items_for_read(
        _Cursor(), "employee", "user", "personal:user", "goithau", "goi_thau", items
    ) == items
    assert access_policy.filter_items_for_read(
        _Cursor(), "employee", "user", "personal:user", "employees", "tai_khoan", items
    ) == []

    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: False
    )
    assert access_policy.filter_items_for_read(
        _Cursor(), "employee", "user", "org", "assignments", "phan_cong_nhan_su", items
    ) == [items[0]]
    assert access_policy.filter_items_for_read(
        _Cursor(), "employee", "user", "org", "permissionmatrix", "ma_tran_phan_quyen", items
    ) == [items[0]]

    monkeypatch.setattr(access_policy, "can_read_table", lambda *_args: False)
    assert access_policy.filter_items_for_read(
        _Cursor(), "employee", "user", "org", "goithau", "goi_thau", items
    ) == []
    monkeypatch.setattr(access_policy, "can_read_table", lambda *_args: True)
    assert access_policy.filter_items_for_read(
        _Cursor(), "employee", "user", "org", "nhathau", "nha_thau", items
    ) == items
    assert access_policy.filter_items_for_read(
        _Cursor(), "employee", "user", "org", "goithau", "goi_thau", []
    ) == []


@pytest.mark.parametrize(
    ("table_name", "rows"),
    [
        ("ke_hoach_lcnt", [("1",)]),
        ("thong_tin_mo_thau", [("1",)]),
        ("goi_thau", [("1",)]),
    ],
)
def test_filter_assignment_scoped_items(
    monkeypatch: pytest.MonkeyPatch, table_name: str, rows
) -> None:
    monkeypatch.setattr(
        access_policy, "is_organization_manager", lambda *_args: False
    )
    monkeypatch.setattr(
        access_policy, "is_personal_workspace_owner", lambda *_args: False
    )
    monkeypatch.setattr(access_policy, "can_read_table", lambda *_args: True)
    items = [{"id": "1"}, {"id": "2"}]
    assert access_policy.filter_items_for_read(
        _Cursor(many=[rows]),
        "employee",
        "user",
        "org",
        "payload",
        table_name,
        items,
    ) == [{"id": "1"}]
