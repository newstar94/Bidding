import os
from types import SimpleNamespace
import uuid

import pytest

from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import PostgresDatabase
from backend.procurement_import import routes
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.procurement_import.runtime import ProcurementRouteError
from backend.procurement_import.session import ProcurementImportSessionService
from backend.shared.access_policy import (
    BatchWriteAuthorizationContext,
    authorize_record_write_from_context,
)


@pytest.mark.parametrize(
    "kind, exists, expected",
    [("PLAN", False, True), ("PLAN", True, False), ("PACKAGE", False, False)],
)
def test_session_new_plan_uses_view_only(kind, exists, expected, monkeypatch):
    class Cursor:
        def execute(self, query, params):
            assert "lower(trim(ma_ke_hoach))" in query
            assert params == ("org", "PL2600146586")
            return self

        def fetchone(self):
            return ("existing",) if exists else None

    monkeypatch.setattr(
        routes,
        "has_module_permission",
        lambda *args: args[-1] == "view",
    )
    assert routes._import_session_permission(
        Cursor(),
        SimpleNamespace(user_id="employee"),
        "org",
        {"kind": kind, "familyNo": "PL2600146586"},
    ) is expected


def test_new_plan_draft_does_not_grant_edit_or_unrelated_creation():
    context = BatchWriteAuthorizationContext(
        role_str="employee",
        user_id="employee",
        organization_id="org",
        organization_manager=False,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="employee",
        permissions={"kehoach": "view"},
        new_plan_draft_records={("ke_hoach_lcnt", "new")},
    )

    def check(record_id):
        return authorize_record_write_from_context(
            context,
            "kehoach",
            "ke_hoach_lcnt",
            {"id": record_id},
        ).allowed

    assert check("new")
    assert not check("existing")
    assert not check("unrelated-new")
    context.permissions = {}
    assert not check("new")


def test_new_plan_package_graph_requires_view_for_each_module():
    context = BatchWriteAuthorizationContext(
        role_str="employee",
        user_id="employee",
        organization_id="org",
        organization_manager=False,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="employee",
        permissions={"kehoach": "view", "goithau": "view"},
        package_status_by_id={"package-new": "Chuẩn bị"},
        new_plan_draft_records={
            ("ke_hoach_lcnt", "plan-new"),
            ("goi_thau", "package-new"),
            ("goi_thau_hang_hoa", "goods-new"),
        },
    )
    assert authorize_record_write_from_context(
        context,
        "kehoach",
        "ke_hoach_lcnt",
        {"id": "plan-new"},
    ).allowed
    assert authorize_record_write_from_context(
        context,
        "goithau",
        "goi_thau",
        {"id": "package-new", "keHoachId": "plan-new"},
    ).allowed
    assert authorize_record_write_from_context(
        context,
        "goithauhanghoa",
        "goi_thau_hang_hoa",
        {"id": "goods-new", "goiThauId": "package-new"},
    ).allowed
    context.permissions["goithau"] = ""
    assert not authorize_record_write_from_context(
        context,
        "goithau",
        "goi_thau",
        {"id": "package-new", "keHoachId": "plan-new"},
    ).allowed
    context.permissions["goithau"] = "view"
    assert not authorize_record_write_from_context(
        context,
        "goithau",
        "goi_thau",
        {"id": "package-existing", "keHoachId": "plan-new"},
    ).allowed


def test_revoked_view_cannot_continue_new_import(monkeypatch):
    cursor = SimpleNamespace(execute=lambda *args: SimpleNamespace(fetchone=lambda: None))
    monkeypatch.setattr(routes, "has_module_permission", lambda *args: False)
    assert not routes._import_session_permission(
        cursor,
        SimpleNamespace(user_id="employee"),
        "org",
        {"kind": "PLAN", "familyNo": "PL2600146586"},
    )


def test_specialist_view_can_resume_only_while_imported_plan_is_new(monkeypatch):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for import-session integration test")
    database = PostgresDatabase(database_url)
    token = uuid.uuid4().hex
    organization_id = f"org-new-plan-session-{token}"
    user_id = f"employee-new-plan-session-{token}"
    investor_id = f"investor-new-plan-session-{token}"
    plan_id = f"plan-new-plan-session-{token}"
    family_no = "PL2600146586"
    workspace_lease = f"lease-{token}"

    setup = database.get_connection()
    try:
        setup.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức kiểm thử chuyên viên tạo kế hoạch"),
        )
        email = f"{user_id}@example.test"
        setup.execute(
            """INSERT INTO tai_khoan
                   (id, mat_khau, email, email_norm, ho_ten, vai_tro,
                    da_xac_minh, trang_thai)
               VALUES (?, 'test-hash', ?, ?, 'Chuyên viên', 'user', 1, 'active')""",
            (user_id, email, email),
        )
        setup.execute(
            """INSERT INTO thanh_vien_to_chuc
                   (user_id, organization_id, vai_tro_trong_to_chuc)
               VALUES (?, ?, 'employee')""",
            (user_id, organization_id),
        )
        setup.execute(
            """INSERT INTO ma_tran_phan_quyen
                   (id, organization_id, emp_id, kehoach)
               VALUES (?, ?, ?, 'view')""",
            (f"permission-{token}", organization_id, user_id),
        )
        setup.execute(
            """INSERT INTO chu_dau_tu
                   (id, organization_id, owner_type, id_goc, ten_chu_dau_tu,
                    phien_ban, is_latest)
               VALUES (?, ?, 'organization', ?, 'Chủ đầu tư kiểm thử', '00', 1)""",
            (investor_id, organization_id, investor_id),
        )
        import_session = ProcurementImportSessionService(
            ProcurementImportSessionRepository(setup.cursor())
        ).create_from_bundle(
            {
                "provider": "MUASAMCONG",
                "plan": {"familyNo": family_no},
                "revisions": [
                    {
                        "revisionId": f"revision-{token}",
                        "revisionNumber": "00",
                        "name": "Kế hoạch mới của chuyên viên",
                        "packages": [],
                    }
                ],
            },
            organization_id=organization_id,
            user_id=user_id,
            workspace_lease=workspace_lease,
        )
        setup.commit()
    finally:
        setup.close()

    monkeypatch.setattr(routes, "database", database)
    role = SessionRole(
        "user",
        user_id,
        platform_role="user",
        active_role="employee",
        active_role_organization_id=organization_id,
    )
    monkeypatch.setattr(
        routes,
        "_request_context",
        lambda _request, _lease: (role, organization_id, workspace_lease),
    )
    request = SimpleNamespace(query_params={"workspaceLease": workspace_lease})

    try:
        manifest = routes._get_import_session_blocking(
            request,
            import_session["sessionId"],
        )
        assert manifest["familyNo"] == family_no

        existing = database.get_connection()
        try:
            existing.execute(
                """INSERT INTO ke_hoach_lcnt
                       (id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
                        ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                        ngay_phe_duyet, quyet_dinh_phe_duyet)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, ?)""",
                (
                    plan_id,
                    organization_id,
                    plan_id,
                    family_no,
                    "Kế hoạch đã tồn tại",
                    "Dự toán kiểm thử",
                    "Dự toán mua sắm",
                    investor_id,
                    "QĐ-TEST",
                ),
            )
            existing.commit()
        finally:
            existing.close()

        with pytest.raises(ProcurementRouteError) as caught:
            routes._get_import_session_blocking(
                request,
                import_session["sessionId"],
            )
        assert caught.value.status_code == 403
        assert caught.value.code == "ORGANIZATION_ACCESS_DENIED"
    finally:
        database.close()
