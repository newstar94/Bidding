import sqlite3
from types import SimpleNamespace

import pytest

from backend.shared.access_policy import (
    BatchWriteAuthorizationContext, _contractor_created_by,
    authorize_record_write_from_context,
)


def test_creator_evidence_is_server_audit_and_scoped_to_organization():
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE audit_log (id INTEGER, actor_user_id TEXT, organization_id TEXT, target_type TEXT, target_id TEXT, action TEXT)")
    connection.execute("INSERT INTO audit_log VALUES (1, 'creator', 'org', 'nha_thau', 'root', 'sync.record_created')")
    cursor = connection.cursor()
    assert _contractor_created_by(cursor, "org", "creator", "root")
    assert not _contractor_created_by(cursor, "other-org", "creator", "root")
    assert not _contractor_created_by(cursor, "org", "other", "root")
    connection.close()


def test_creator_with_view_can_edit_stamp_but_unrelated_record_stays_protected():
    context = BatchWriteAuthorizationContext(
        role_str="employee", user_id="creator", organization_id="org",
        organization_manager=False, personal_workspace_owner=False,
        active_membership=True, inherited_specialist_access=False,
        membership_role="employee", permissions={"nhathau": "view"},
        owned_lineages={("nha_thau", "root")},
        lineage_root_by_item={("nha_thau", "mine"): "root", ("nha_thau", "other"): "other"},
    )
    def check(record_id):
        return authorize_record_write_from_context(context, "nhathau", "nha_thau", {
            "id": record_id, "createdBy": "creator", "anhDau": "data:image/png;base64,AA==",
        }).allowed
    assert check("mine")
    assert not check("other")
    context.permissions.clear()
    assert not check("mine")
from backend.shared import access_policy
from backend.shared.access_policy import (
    AccessDecision,
    authorize_record_write,
)


@pytest.mark.parametrize("role_name,manager,inherited", [
    ("manager", True, False),
    ("employee", False, False),
    ("specialist", False, True),
])
def test_paginated_contractor_can_edit_matches_scalar_authorization(
    monkeypatch, role_name, manager, inherited,
):
    role = SimpleNamespace(active_role=None)
    item = {"id": "record-1", "rootId": "root-1", "createdBy": "creator", "anhDau": "asset"}
    monkeypatch.setattr(access_policy, "is_organization_manager", lambda *_args: manager)
    monkeypatch.setattr(access_policy, "is_personal_workspace_owner", lambda *_args: False)
    monkeypatch.setattr(access_policy, "has_active_organization_membership", lambda *_args: True)
    monkeypatch.setattr(access_policy, "_table_record_exists", lambda *_args: False)
    monkeypatch.setattr(access_policy, "_existing_lineage_root", lambda *_args: "root-1")
    monkeypatch.setattr(access_policy, "_contractor_created_by", lambda _cursor, _org, user, root: user == "creator" and root == "root-1")
    monkeypatch.setattr(access_policy, "authorize_payload_key_write", lambda *_args, **_kwargs: AccessDecision(True))
    monkeypatch.setattr(access_policy, "has_module_permission", lambda _cursor, _role, _user, _org, _module, action="view": action == "view")

    context = BatchWriteAuthorizationContext(
        role_str=role_name,
        user_id="creator",
        organization_id="org-1",
        organization_manager=manager,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=inherited,
        membership_role="manager" if manager else "employee",
        permissions={"nhathau": "view"},
        lineage_root_by_item={("nha_thau", "record-1"): "root-1"},
        owned_lineages={("nha_thau", "root-1")},
    )
    scalar = authorize_record_write(None, role, "creator", "org-1", "nhathau", "nha_thau", item)
    batch = authorize_record_write_from_context(context, "nhathau", "nha_thau", item)
    assert batch.allowed is scalar.allowed
