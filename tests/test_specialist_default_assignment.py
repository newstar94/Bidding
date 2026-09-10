"""Creator assignment is a one-time create default, never a lasting grant."""

from types import SimpleNamespace

import pytest

from backend.sync import assignment_augmentation as augmentation


class Cursor:
    def __init__(self, existing=()):
        self.existing = {
            (str(value[0]), str(value[1]))
            if isinstance(value, tuple)
            else (str(value), str(value))
            for value in existing
        }
        self.rows = []

    def execute(self, sql, params=()):
        candidates = {str(value) for value in params[1:]}
        self.rows = [
            (record_id, root_id)
            for record_id, root_id in self.existing
            if record_id in candidates or root_id in candidates
        ]
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


def test_missing_physical_root_with_existing_descendant_is_not_self_assigned(monkeypatch):
    monkeypatch.setattr(augmentation, "is_organization_manager", lambda *args: False, raising=False)
    payload = {"kehoach": [{"id": "v2", "rootId": "root"}], "assignments": []}
    cursor = Cursor([("v1", "root")])

    assert augmentation.augment_default_assignments(
        cursor, transaction(), payload, batch_limit=100,
    ) == 0
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
    ("kehoach", "ke_hoach_lcnt"),
    ("goithau", "goi_thau"),
    ("hopdong", "hop_dong"),
])
def test_client_supplied_self_assignment_requires_proven_new_logical_record(
    kind,
    table,
):
    from backend.shared.access_policy import (
        BatchWriteAuthorizationContext,
        authorize_record_write_from_context,
    )

    assignment = {
        "id": "claim",
        "empId": "creator",
        "targetId": "v2",
        "type": kind,
    }
    context = BatchWriteAuthorizationContext(
        role_str="employee",
        user_id="creator",
        organization_id="org",
        organization_manager=False,
        personal_workspace_owner=False,
        active_membership=True,
        inherited_specialist_access=False,
        membership_role="employee",
        permissions={kind: "edit"},
        assigned_targets={(kind, "v2")},
    )

    denied = authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", assignment,
    )
    assert not denied.allowed

    context.new_records.add((table, "v2"))
    assert authorize_record_write_from_context(
        context, "assignments", "phan_cong_nhan_su", assignment,
    ).allowed


def test_postgres_missing_root_descendant_blocks_successor_self_claim():
    from backend.auth.auth_helper import SessionRole
    from backend.shared.access_policy import (
        authorize_record_write_from_context,
        build_batch_write_authorization_context,
    )
    from tests.test_sync_conflict_authorization import (
        _seed_denied_package,
        _test_database,
    )
    import uuid

    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, specialist_id, source_package_id = _seed_denied_package(cursor)
        missing_root_id = f"missing-root-{uuid.uuid4().hex}"
        descendant_id = f"descendant-{uuid.uuid4().hex}"
        successor_id = f"successor-{uuid.uuid4().hex}"
        cursor.execute(
            """INSERT INTO goi_thau
                (id, organization_id, id_goc, ke_hoach_id, ten_goi_thau,
                 gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                 thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc, trang_thai)
                SELECT ?, organization_id, ?, ke_hoach_id, ten_goi_thau,
                       gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
                       thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc,
                       trang_thai
                  FROM goi_thau
                 WHERE organization_id = ? AND id = ?""",
            (
                descendant_id,
                missing_root_id,
                organization_id,
                source_package_id,
            ),
        )
        successor = {"id": successor_id, "rootId": missing_root_id}
        self_assignment = {
            "id": f"claim-{uuid.uuid4().hex}",
            "empId": specialist_id,
            "targetId": successor_id,
            "type": "goithau",
        }
        role = SessionRole(
            "user", specialist_id, platform_role="user", active_role="employee",
        )
        context = build_batch_write_authorization_context(
            cursor,
            role,
            specialist_id,
            organization_id,
            {
                "goi_thau": [successor],
                "phan_cong_nhan_su": [self_assignment],
            },
            {"goi_thau": {}, "phan_cong_nhan_su": {}},
        )

        assert ("goi_thau", successor_id) not in context.new_records
        assert ("goithau", successor_id) not in context.assigned_targets
        assert not authorize_record_write_from_context(
            context, "goithau", "goi_thau", successor,
        ).allowed
        assert not authorize_record_write_from_context(
            context, "assignments", "phan_cong_nhan_su", self_assignment,
        ).allowed
    finally:
        connection.rollback()
        connection.close()
        database.close()


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


@pytest.mark.parametrize(
    "payload_key,table_name,package_status",
    [
        ("thongtinmothau", "thong_tin_mo_thau", "PREPARING"),
        ("goithauhanghoa", "goi_thau_hang_hoa", "PREPARING"),
        ("hanghoaduthaunhathau", "hang_hoa_du_thau_nha_thau", "OPENED"),
    ],
)
def test_postgres_package_transfer_revokes_old_assignee_child_mutations(
    payload_key,
    table_name,
    package_status,
):
    from backend.auth.auth_helper import SessionRole
    from backend.shared.access_policy import (
        authorize_record_write,
        authorize_record_write_from_context,
        build_batch_write_authorization_context,
    )
    from tests.test_sync_conflict_authorization import (
        _seed_denied_package,
        _test_database,
    )
    import uuid

    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, successor_id, package_id = _seed_denied_package(cursor)
        assignment_id, old_assignee_id = cursor.execute(
            """SELECT id, id_nhan_vien FROM phan_cong_nhan_su
                WHERE organization_id = ? AND id_muc_tieu = ?
                  AND loai_doi_tuong = 'goithau'""",
            (organization_id, package_id),
        ).fetchone()
        cursor.execute(
            """INSERT INTO ma_tran_phan_quyen
                (id, organization_id, emp_id, goithau)
                VALUES (?, ?, ?, 'edit')""",
            (uuid.uuid4().hex, organization_id, old_assignee_id),
        )
        cursor.execute(
            "UPDATE goi_thau SET trang_thai = ? WHERE organization_id = ? AND id = ?",
            (package_status, organization_id, package_id),
        )

        record_id = uuid.uuid4().hex
        opening_id = uuid.uuid4().hex
        if table_name in {"thong_tin_mo_thau", "hang_hoa_du_thau_nha_thau"}:
            contractor_id = uuid.uuid4().hex
            cursor.execute(
                "INSERT INTO nha_thau (id, organization_id, ten_nha_thau) VALUES (?, ?, 'Nhà thầu')",
                (contractor_id, organization_id),
            )
            if table_name == "thong_tin_mo_thau":
                opening_id = record_id
            cursor.execute(
                """INSERT INTO thong_tin_mo_thau
                    (id, organization_id, goi_thau_id, nha_thau_id)
                    VALUES (?, ?, ?, ?)""",
                (opening_id, organization_id, package_id, contractor_id),
            )
        if table_name == "goi_thau_hang_hoa":
            cursor.execute(
                """INSERT INTO goi_thau_hang_hoa
                    (id, organization_id, goi_thau_id, ma_hang_hoa,
                     ten_hang_hoa, don_vi_tinh, so_luong)
                    VALUES (?, ?, ?, 'HH-01', 'Hàng hóa', 'cái', 1)""",
                (record_id, organization_id, package_id),
            )
        elif table_name == "hang_hoa_du_thau_nha_thau":
            cursor.execute(
                """INSERT INTO hang_hoa_du_thau_nha_thau
                    (id, organization_id, goi_thau_id, thong_tin_mo_thau_id,
                     danh_muc_hang_hoa)
                    VALUES (?, ?, ?, ?, 'Hàng hóa dự thầu')""",
                (record_id, organization_id, package_id, opening_id),
            )

        record = {"id": record_id, "goiThauId": package_id}
        role = SessionRole(
            "user",
            old_assignee_id,
            platform_role="user",
            active_role="employee",
        )

        def decisions():
            context = build_batch_write_authorization_context(
                cursor,
                role,
                old_assignee_id,
                organization_id,
                {table_name: [record]},
                {table_name: {record_id: record}},
            )
            return (
                authorize_record_write(
                    cursor,
                    role,
                    old_assignee_id,
                    organization_id,
                    payload_key,
                    table_name,
                    record,
                ).allowed,
                authorize_record_write_from_context(
                    context,
                    payload_key,
                    table_name,
                    record,
                ).allowed,
            )

        assert decisions() == (True, True)
        cursor.execute(
            """UPDATE phan_cong_nhan_su SET id_nhan_vien = ?
                WHERE organization_id = ? AND id = ?""",
            (successor_id, organization_id, assignment_id),
        )
        assert decisions() == (False, False)
    finally:
        connection.rollback()
        connection.close()
        database.close()


@pytest.mark.parametrize("kind,table", [
    ("kehoach", "ke_hoach_lcnt"), ("goithau", "goi_thau"),
    ("hopdong", "hop_dong"),
])
def test_postgres_latest_version_transfer_does_not_leave_historical_lineage_grant(
    kind,
    table,
):
    """An assignment on V00 is audit evidence, not authority for V01."""

    from backend.auth.auth_helper import SessionRole
    from backend.shared.access_policy import (
        authorize_record_write,
        authorize_record_write_from_context,
        build_batch_write_authorization_context,
        can_read_record,
    )
    from tests.test_sync_conflict_authorization import _seed_denied_package, _test_database
    import uuid

    database = _test_database()
    connection = database.get_connection()
    try:
        cursor = connection.cursor()
        organization_id, creator_id, seeded_package_id = _seed_denied_package(cursor)
        successor_id = cursor.execute(
            "SELECT id_nhan_vien FROM phan_cong_nhan_su WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()[0]
        cursor.execute(
            """UPDATE ma_tran_phan_quyen
                  SET kehoach = 'edit', goithau = 'edit', hopdong = 'edit'
                WHERE organization_id = ?""",
            (organization_id,),
        )
        parent_plan_id, investor_id = cursor.execute(
            """SELECT plan.id, plan.chu_dau_tu_id
                 FROM ke_hoach_lcnt AS plan
                 JOIN goi_thau AS package ON package.ke_hoach_id = plan.id
                WHERE package.id = ?""",
            (seeded_package_id,),
        ).fetchone()
        root_id = uuid.uuid4().hex
        if kind == "kehoach":
            cursor.execute(
                """INSERT INTO ke_hoach_lcnt
                    (id, organization_id, id_goc, phien_ban, is_latest,
                     ten_ke_hoach, loai_hinh_mua_sam, chu_dau_tu_id,
                     ngay_phe_duyet, quyet_dinh_phe_duyet)
                    VALUES (?, ?, ?, 0, 1, 'Kế hoạch V00', 'Dự án', ?,
                            CURRENT_DATE, 'QD')""",
                (root_id, organization_id, root_id, investor_id),
            )
        elif kind == "goithau":
            cursor.execute(
                """INSERT INTO goi_thau
                    (id, organization_id, id_goc, phien_ban, is_latest,
                     ten_goi_thau, ke_hoach_id, gia_goi_thau,
                     thoi_gian_thuc_hien, nguon_von, thoi_gian_to_chuc,
                     thoi_gian_bat_dau_to_chuc)
                    VALUES (?, ?, ?, 0, 1, 'Package V00', ?, 100, '30 days',
                            'Budget', '2026', '2026')""",
                (root_id, organization_id, root_id, parent_plan_id),
            )
        else:
            contractor_id = uuid.uuid4().hex
            cursor.execute(
                "INSERT INTO nha_thau (id, organization_id, ten_nha_thau) VALUES (?, ?, 'Contractor')",
                (contractor_id, organization_id),
            )
            cursor.execute(
                """INSERT INTO danh_muc_trang_thai_hop_dong
                    (id, organization_id, name)
                    VALUES (?, ?, 'Dang thuc hien')""",
                (uuid.uuid4().hex, organization_id),
            )
            cursor.execute(
                """INSERT INTO hop_dong
                    (id, organization_id, id_goc, phien_ban, is_latest,
                     ten_hop_dong, so_hop_dong, ngay_ky, chu_dau_tu_id,
                     nha_thau_id, ke_hoach_id, gia_tri, loai_hop_dong,
                     thoi_gian_thuc_hien, trang_thai_hop_dong)
                    VALUES (?, ?, ?, 0, 1, 'Contract V00', ?, CURRENT_DATE,
                            ?, ?, ?, 100, 'Consulting', '30 days',
                            'Dang thuc hien')""",
                (
                    root_id,
                    organization_id,
                    root_id,
                    f"HD-{root_id}",
                    investor_id,
                    contractor_id,
                    parent_plan_id,
                ),
            )
        root_assignment_id = uuid.uuid4().hex
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
                (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
                VALUES (?, ?, ?, ?, ?)""",
            (root_assignment_id, organization_id, creator_id, root_id, kind),
        )

        # Clone a physical V01 snapshot and its assignment, as versioning does.
        latest_id = uuid.uuid4().hex
        columns = [
            str(row[0])
            for row in cursor.execute(
                """SELECT column_name FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = ?
                    ORDER BY ordinal_position""",
                (table,),
            ).fetchall()
        ]
        cloned = dict(cursor.execute(
            f"SELECT * FROM {table} WHERE organization_id = ? AND id = ?",  # noqa: S608 - parametrized allowlist
            (organization_id, root_id),
        ).fetchone())
        cursor.execute(
            f"UPDATE {table} SET is_latest = 0 WHERE organization_id = ? AND id = ?",  # noqa: S608 - parametrized allowlist
            (organization_id, root_id),
        )
        cloned.update({
            "id": latest_id,
            "id_goc": root_id,
            "phien_ban": 1,
            "is_latest": 1,
            "row_version": 1,
        })
        cursor.execute(
            f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",  # noqa: S608 - parametrized allowlist
            tuple(cloned[column] for column in columns),
        )
        latest_assignment_id = uuid.uuid4().hex
        cursor.execute(
            """INSERT INTO phan_cong_nhan_su
                (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
                VALUES (?, ?, ?, ?, ?)""",
            (
                latest_assignment_id,
                organization_id,
                creator_id,
                latest_id,
                kind,
            ),
        )
        cursor.execute(
            """UPDATE phan_cong_nhan_su SET id_nhan_vien = ?
                WHERE organization_id = ? AND id = ?""",
            (successor_id, organization_id, latest_assignment_id),
        )

        creator_role = SessionRole(
            "user", creator_id, platform_role="user", active_role="employee",
        )
        successor_role = SessionRole(
            "user", successor_id, platform_role="user", active_role="employee",
        )
        cursor.execute(
            """INSERT INTO ma_tran_phan_quyen
                (id, organization_id, emp_id, kehoach, goithau, hopdong)
                VALUES (?, ?, ?, 'edit', 'edit', 'edit')
                ON CONFLICT (organization_id, emp_id) DO UPDATE
                SET kehoach = 'edit', goithau = 'edit', hopdong = 'edit'""",
            (uuid.uuid4().hex, organization_id, successor_id),
        )
        latest_record = {"id": latest_id, "rootId": root_id}

        def decisions(role, user_id):
            context = build_batch_write_authorization_context(
                cursor,
                role,
                user_id,
                organization_id,
                {table: [latest_record]},
                {table: {latest_id: latest_record}},
            )
            return (
                can_read_record(
                    cursor, role, user_id, organization_id, kind, table, latest_record,
                ),
                authorize_record_write(
                    cursor, role, user_id, organization_id, kind, table, latest_record,
                ).allowed,
                authorize_record_write_from_context(
                    context, kind, table, latest_record,
                ).allowed,
            )

        assert decisions(creator_role, creator_id) == (False, False, False)
        assert decisions(successor_role, successor_id) == (True, True, True)
        assert can_read_record(
            cursor, creator_role, creator_id, organization_id, kind, table,
            {"id": root_id, "rootId": root_id},
        )
    finally:
        connection.rollback()
        connection.close()
        database.close()


@pytest.mark.parametrize(
    "kind,payload_key,table_name,mutable_column,mutated_value",
    [
        ("kehoach", "kehoach", "ke_hoach_lcnt", "ten_ke_hoach", "Plan mutation serialized before transfer"),
        ("goithau", "goithau", "goi_thau", "ten_goi_thau", "Package mutation serialized before transfer"),
        ("hopdong", "hopdong", "hop_dong", "ten_hop_dong", "Contract mutation serialized before transfer"),
    ],
)
def test_postgres_assignment_transfer_serializes_with_write_authorization(
    kind,
    payload_key,
    table_name,
    mutable_column,
    mutated_value,
):
    """A writer and transfer serialize; no old-user write follows revocation."""

    from concurrent.futures import ThreadPoolExecutor
    from datetime import datetime, timezone
    from queue import Queue
    import time
    import uuid

    from backend.auth.auth_helper import SessionRole
    from backend.db.db_helper import PostgresCursor
    from backend.shared.access_policy import (
        authorize_record_write_from_context,
        build_batch_write_authorization_context,
    )
    from backend.sync.record_writer import SyncRecordWriter
    from tests.test_member_quota_concurrency import _connect, _test_database_url
    from tests.test_sync_conflict_authorization import _seed_denied_package

    database_url = _test_database_url()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    setup_database = _test_database_url()
    setup = _connect(setup_database)
    organization_id = old_assignee_id = successor_id = record_id = None
    try:
        cursor = PostgresCursor(setup.cursor())
        organization_id, successor_id, package_id = _seed_denied_package(cursor)
        assignment = cursor.execute(
            """SELECT id, id_nhan_vien FROM phan_cong_nhan_su
                WHERE organization_id = ? AND id_muc_tieu = ?
                  AND loai_doi_tuong = 'goithau'""",
            (organization_id, package_id),
        ).fetchone()
        seeded_assignment_id, old_assignee_id = assignment
        parent_plan_id, investor_id = cursor.execute(
            """SELECT plan.id, plan.chu_dau_tu_id
                 FROM ke_hoach_lcnt AS plan
                 JOIN goi_thau AS package ON package.ke_hoach_id = plan.id
                WHERE package.organization_id = ? AND package.id = ?""",
            (organization_id, package_id),
        ).fetchone()
        if kind == "kehoach":
            record_id = uuid.uuid4().hex
            cursor.execute(
                """INSERT INTO ke_hoach_lcnt
                    (id, organization_id, id_goc, ten_ke_hoach,
                     loai_hinh_mua_sam, chu_dau_tu_id, ngay_phe_duyet,
                     quyet_dinh_phe_duyet)
                    VALUES (?, ?, ?, 'Independent plan', 'Dự án', ?,
                            CURRENT_DATE, 'QD-RACE')""",
                (record_id, organization_id, record_id, investor_id),
            )
        elif kind == "goithau":
            record_id = package_id
        else:
            record_id = uuid.uuid4().hex
            contractor_id = uuid.uuid4().hex
            cursor.execute(
                "INSERT INTO nha_thau (id, organization_id, ten_nha_thau) VALUES (?, ?, 'Contractor')",
                (contractor_id, organization_id),
            )
            cursor.execute(
                """INSERT INTO danh_muc_trang_thai_hop_dong
                    (id, organization_id, name) VALUES (?, ?, 'Dang thuc hien')""",
                (uuid.uuid4().hex, organization_id),
            )
            cursor.execute(
                """INSERT INTO hop_dong
                    (id, organization_id, id_goc, ten_hop_dong, so_hop_dong,
                     ngay_ky, chu_dau_tu_id, nha_thau_id, ke_hoach_id, gia_tri,
                     loai_hop_dong, thoi_gian_thuc_hien, trang_thai_hop_dong)
                    VALUES (?, ?, ?, 'Contract', ?, CURRENT_DATE, ?, ?, ?, 100,
                            'Consulting', '30 days', 'Dang thuc hien')""",
                (
                    record_id,
                    organization_id,
                    record_id,
                    f"HD-{record_id}",
                    investor_id,
                    contractor_id,
                    parent_plan_id,
                ),
            )
        if kind == "goithau":
            assignment_id = seeded_assignment_id
        else:
            assignment_id = uuid.uuid4().hex
            cursor.execute(
                """INSERT INTO phan_cong_nhan_su
                    (id, organization_id, id_nhan_vien, id_muc_tieu, loai_doi_tuong)
                    VALUES (?, ?, ?, ?, ?)""",
                (assignment_id, organization_id, old_assignee_id, record_id, kind),
            )
        cursor.execute(
            f"""INSERT INTO ma_tran_phan_quyen
                (id, organization_id, emp_id, {kind})
                VALUES (?, ?, ?, 'edit')""",
            (f"permission-old-{assignment_id}", organization_id, old_assignee_id),
        )
        setup.commit()
    finally:
        setup.close()

    mutation_connection = _connect(database_url)
    try:
        mutation = PostgresCursor(mutation_connection.cursor())
        role = SessionRole(
            "user",
            old_assignee_id,
            platform_role="user",
            active_role="employee",
        )
        previous_record = dict(mutation.execute(
            f"SELECT * FROM {table_name} WHERE organization_id = ? AND id = ?",
            (organization_id, record_id),
        ).fetchone())
        record = {
            "id": record_id,
            "rootId": previous_record.get("id_goc") or record_id,
            "rowVersion": previous_record["row_version"],
            "expectedVersion": previous_record["row_version"],
        }
        context = build_batch_write_authorization_context(
            mutation,
            role,
            old_assignee_id,
            organization_id,
            {table_name: [record]},
            {table_name: {record_id: record}},
        )
        assert authorize_record_write_from_context(
            context, payload_key, table_name, record,
        ).allowed

        class Tracker:
            def __getattr__(self, _name):
                return lambda *_args, **_kwargs: None

        updated_record = dict(previous_record)
        updated_record[mutable_column] = mutated_value
        writer = SyncRecordWriter(
            SimpleNamespace(
                cursor=mutation,
                actor=SimpleNamespace(
                    user_id=old_assignee_id,
                    organization_id=organization_id,
                ),
                owner_type="organization",
                current_time=datetime.now(timezone.utc),
            ),
            sync_version=1,
            mutation_tracker=Tracker(),
            clean_record_id=lambda _table, value: str(value) if value else None,
            ownership_scoped_tables=set(),
            defer_latest_flag=lambda *_args: None,
            map_database_record=lambda _table, value: value,
            save_children=lambda *_args: None,
        )
        write_result = writer.write(
            payload_key=payload_key,
            table_name=table_name,
            item=record,
            db_row_data=updated_record,
            previous_record=previous_record,
        )
        assert write_result.conflict_error is None

        transfer_pid_queue = Queue()

        def transfer_assignment():
            connection = _connect(database_url)
            try:
                cursor = PostgresCursor(connection.cursor())
                backend_pid = cursor.execute("SELECT pg_backend_pid()").fetchone()[0]
                transfer_pid_queue.put(backend_pid)
                cursor.execute(
                    """UPDATE phan_cong_nhan_su SET id_nhan_vien = ?
                        WHERE organization_id = ? AND id = ?""",
                    (successor_id, organization_id, assignment_id),
                )
                connection.commit()
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=1) as executor:
            transfer_future = executor.submit(transfer_assignment)
            transfer_pid = transfer_pid_queue.get(timeout=5)
            observer = _connect(database_url)
            try:
                observer_cursor = PostgresCursor(observer.cursor())
                writer_pid = mutation.execute("SELECT pg_backend_pid()").fetchone()[0]
                deadline = time.monotonic() + 5
                blocked_by_writer = False
                while time.monotonic() < deadline:
                    blockers = observer_cursor.execute(
                        "SELECT pg_blocking_pids(?)",
                        (transfer_pid,),
                    ).fetchone()[0]
                    if writer_pid in blockers:
                        blocked_by_writer = True
                        break
                assert blocked_by_writer, "transfer did not join the assignment row lock discipline"
            finally:
                observer.close()

            # The old user's real row write commits before the transfer can
            # become effective. Only then may the transfer commit.
            mutation_connection.commit()
            transfer_future.result(timeout=5)

        after_connection = _connect(database_url)
        try:
            after = PostgresCursor(after_connection.cursor())
            current = dict(after.execute(
                f"SELECT * FROM {table_name} WHERE organization_id = ? AND id = ?",
                (organization_id, record_id),
            ).fetchone())
            second_record = {
                "id": record_id,
                "rootId": current.get("id_goc") or record_id,
                "rowVersion": current["row_version"],
                "expectedVersion": current["row_version"],
            }
            revoked_context = build_batch_write_authorization_context(
                after,
                role,
                old_assignee_id,
                organization_id,
                {table_name: [second_record]},
                {table_name: {record_id: second_record}},
            )
            assert not authorize_record_write_from_context(
                revoked_context, payload_key, table_name, second_record,
            ).allowed
            assert current[mutable_column] == mutated_value
            after_connection.rollback()
        finally:
            after_connection.close()
    finally:
        mutation_connection.rollback()
        mutation_connection.close()
        cleanup = _connect(database_url)
        try:
            cursor = PostgresCursor(cleanup.cursor())
            cursor.execute(
                "DELETE FROM phan_cong_nhan_su WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM ma_tran_phan_quyen WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM hop_dong WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM goi_thau WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM ke_hoach_lcnt WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM chu_dau_tu WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM nha_thau WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM danh_muc_trang_thai_hop_dong WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE organization_id = ?",
                (organization_id,),
            )
            cursor.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
            cursor.execute(
                "DELETE FROM tai_khoan WHERE id IN (?, ?)",
                (old_assignee_id, successor_id),
            )
            cleanup.commit()
        finally:
            cleanup.close()
