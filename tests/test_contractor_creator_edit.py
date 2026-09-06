import sqlite3

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
