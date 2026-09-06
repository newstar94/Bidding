"""Creator assignment is a one-time create default, never a lasting grant."""

from types import SimpleNamespace

import pytest

from backend.sync import assignment_augmentation as augmentation


class Cursor:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.rows = []

    def execute(self, sql, params=()):
        self.rows = [(value,) for value in params[1:] if value in self.existing]
        return self

    def fetchall(self):
        return self.rows


def transaction():
    return SimpleNamespace(
        owner_type="organization",
        actor=SimpleNamespace(role="employee", user_id="creator", organization_id="org"),
    )


@pytest.mark.parametrize("kind", ["kehoach", "goithau", "hopdong"])
def test_specialist_new_record_is_assigned_once(kind, monkeypatch):
    # The real transaction has already resolved the active actor; keep this
    # focused test independent of principal SQL fixture details.
    monkeypatch.setattr(augmentation, "is_organization_manager", lambda *args: False, raising=False)
    payload = {kind: [{"id": "new"}], "assignments": []}
    assert augmentation.augment_default_assignments(Cursor(), transaction(), payload, batch_limit=100) == 1
    assignment = payload["assignments"][0]
    assert (assignment["empId"], assignment["targetId"], assignment["type"]) == ("creator", "new", kind)
    assert augmentation.augment_default_assignments(Cursor(), transaction(), payload, batch_limit=100) == 0


def test_existing_record_is_not_reclaimed_after_reassignment(monkeypatch):
    monkeypatch.setattr(augmentation, "is_organization_manager", lambda *args: False, raising=False)
    payload = {"goithau": [{"id": "existing", "createdBy": "creator"}], "assignments": []}
    assert augmentation.augment_default_assignments(Cursor(["existing"]), transaction(), payload, batch_limit=100) == 0
    assert payload["assignments"] == []


def test_new_snapshot_of_existing_lineage_is_not_self_assigned(monkeypatch):
    monkeypatch.setattr(augmentation, "is_organization_manager", lambda *args: False, raising=False)
    payload = {"kehoach": [{"id": "v2", "rootId": "v1"}], "assignments": []}
    assert augmentation.augment_default_assignments(Cursor(["v1"]), transaction(), payload, batch_limit=100) == 0
    assert payload["assignments"] == []


def test_new_draft_chain_assigns_each_snapshot(monkeypatch):
    monkeypatch.setattr(augmentation, "is_organization_manager", lambda *args: False, raising=False)
    payload = {"kehoach": [{"id": "v1"}, {"id": "v2", "rootId": "v1"}], "assignments": []}
    assert augmentation.augment_default_assignments(Cursor(), transaction(), payload, batch_limit=100) == 2
    assert {item["targetId"] for item in payload["assignments"]} == {"v1", "v2"}


def test_shared_partners_receive_no_assignment(monkeypatch):
    monkeypatch.setattr(augmentation, "is_organization_manager", lambda *args: False, raising=False)
    payload = {"chudautu": [{"id": "investor"}], "nhathau": [{"id": "bidder"}], "assignments": []}
    assert augmentation.augment_default_assignments(Cursor(), transaction(), payload, batch_limit=100) == 0
    assert payload["assignments"] == []


def test_generated_assignments_count_toward_batch_limit(monkeypatch):
    monkeypatch.setattr(augmentation, "is_organization_manager", lambda *args: False)
    with pytest.raises(augmentation.SyncBatchLimitExceeded):
        augmentation.augment_default_assignments(
            Cursor(), transaction(), {"kehoach": [{"id": "new"}]}, batch_limit=1,
        )


@pytest.mark.parametrize("kind,table", [
    ("kehoach", "ke_hoach_lcnt"), ("goithau", "goi_thau"),
    ("hopdong", "hop_dong"), ("chudautu", "chu_dau_tu"), ("nhathau", "nha_thau"),
])
def test_create_permission_does_not_grant_existing_record_edit(kind, table):
    from backend.shared.access_policy import (
        BatchWriteAuthorizationContext, authorize_record_write_from_context,
    )
    context = BatchWriteAuthorizationContext(
        role_str="employee", user_id="creator", organization_id="org",
        organization_manager=False, personal_workspace_owner=False,
        active_membership=True, inherited_specialist_access=False,
        membership_role="employee", permissions={kind: "view"},
        new_records={(table, "new")},
    )
    assert authorize_record_write_from_context(context, kind, table, {"id": "new"}).allowed
    assert not authorize_record_write_from_context(context, kind, table, {"id": "existing"}).allowed
    context.permissions.clear()
    assert not authorize_record_write_from_context(context, kind, table, {"id": "new"}).allowed


@pytest.mark.parametrize("kind,table", [
    ("kehoach", "ke_hoach_lcnt"), ("goithau", "goi_thau"), ("hopdong", "hop_dong"),
])
def test_postgres_create_assignment_then_transfer_revokes_creator(kind, table):
    from backend.auth.auth_helper import SessionRole
    from backend.shared.access_policy import (
        authorize_record_write, authorize_record_write_from_context,
        build_batch_write_authorization_context, can_read_record,
    )
    from tests.test_sync_conflict_authorization import _test_database, _seed_denied_package
    import uuid

    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        org, creator, package_id = _seed_denied_package(cursor)
        other = cursor.execute(
            "SELECT id_nhan_vien FROM phan_cong_nhan_su WHERE organization_id = ?",
            (org,),
        ).fetchone()[0]
        cursor.execute(
            "UPDATE ma_tran_phan_quyen SET kehoach = 'edit', goithau = 'edit', hopdong = 'edit' WHERE organization_id = ?",
            (org,),
        )
        role = SessionRole("user", creator, platform_role="user", active_role="employee")
        tx = SimpleNamespace(owner_type="organization", actor=SimpleNamespace(
            role=role, user_id=creator, organization_id=org,
        ))
        record_id = uuid.uuid4().hex
        record = {"id": record_id, "rootId": record_id, "createdBy": creator}
        payload = {kind: [record], "assignments": []}
        assert augmentation.augment_default_assignments(cursor, tx, payload, batch_limit=100) == 1
        context = build_batch_write_authorization_context(
            cursor, role, creator, org,
            {table: [record], "phan_cong_nhan_su": payload["assignments"]},
            {table: {}, "phan_cong_nhan_su": {}},
        )
        assert authorize_record_write_from_context(context, kind, table, record).allowed
        assert authorize_record_write_from_context(context, "assignments", "phan_cong_nhan_su", payload["assignments"][0]).allowed
        # Persist only the minimal policy fixture; the full finalize route is
        # covered by test_plan_draft_finalize against PostgreSQL separately.
        parent_plan, investor = cursor.execute(
            "SELECT p.id, p.chu_dau_tu_id FROM ke_hoach_lcnt p JOIN goi_thau g ON g.ke_hoach_id = p.id WHERE g.id = ?",
            (package_id,),
        ).fetchone()
        if kind == "kehoach":
            cursor.execute(
                """INSERT INTO ke_hoach_lcnt
                    (id, organization_id, id_goc, ten_ke_hoach, loai_hinh_mua_sam,
                     chu_dau_tu_id, ngay_phe_duyet, quyet_dinh_phe_duyet)
                    VALUES (?, ?, ?, 'Kế hoạch', 'Dự án', ?, CURRENT_DATE, 'QD')""",
                (record_id, org, record_id, investor),
            )
        elif kind == "goithau":
            cursor.execute(
                """INSERT INTO goi_thau
                    (id, organization_id, id_goc, ten_goi_thau, ke_hoach_id,
                     gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                     thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc)
                    VALUES (?, ?, ?, 'Gói thầu', ?, 100, '30 ngày', 'Ngân sách', '2026', '2026')""",
                (record_id, org, record_id, parent_plan),
            )
        else:
            contractor = uuid.uuid4().hex
            cursor.execute(
                "INSERT INTO danh_muc_trang_thai_hop_dong (id, organization_id, name) VALUES (?, ?, 'Đang thực hiện')",
                (uuid.uuid4().hex, org),
            )
            cursor.execute("INSERT INTO nha_thau (id, organization_id, ten_nha_thau) VALUES (?, ?, 'Nhà thầu')", (contractor, org))
            cursor.execute(
                """INSERT INTO hop_dong
                    (id, organization_id, id_goc, ten_hop_dong, so_hop_dong, ngay_ky,
                     chu_dau_tu_id, nha_thau_id, ke_hoach_id, gia_tri,
                     loai_hop_dong, thoi_gian_thuc_hien)
                    VALUES (?, ?, ?, 'Hợp đồng', 'HD', CURRENT_DATE, ?, ?, ?, 100, 'Tư vấn', '30 ngày')""",
                (record_id, org, record_id, investor, contractor, parent_plan),
            )
        assignment = payload["assignments"][0]
        cursor.execute(
            "INSERT INTO phan_cong_nhan_su (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong) VALUES (?, ?, ?, ?, ?)",
            (assignment["id"], org, creator, record_id, kind),
        )

        def allowed():
            context = build_batch_write_authorization_context(
                cursor, role, creator, org, {table: [record]}, {table: {record_id: record}},
            )
            return (
                can_read_record(cursor, role, creator, org, kind, table, record),
                authorize_record_write(cursor, role, creator, org, kind, table, record).allowed,
                authorize_record_write_from_context(context, kind, table, record).allowed,
            )

        assert allowed() == (True, True, True)
        cursor.execute(
            "UPDATE phan_cong_nhan_su SET id_nhan_vien = ? WHERE organization_id = ? AND id = ?",
            (other, org, assignment["id"]),
        )
        assert allowed() == (False, False, False)
        retry = {kind: [record], "assignments": []}
        assert augmentation.augment_default_assignments(cursor, tx, retry, batch_limit=100) == 0
        assert retry["assignments"] == []
        assert not authorize_record_write(cursor, role, creator, org, "assignments", "phan_cong_nhan_su", assignment).allowed
    finally:
        connection.rollback()
        connection.close()
        database.close()
