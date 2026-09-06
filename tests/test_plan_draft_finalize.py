import asyncio
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import os
from types import SimpleNamespace
import uuid

import pytest
from starlette.responses import JSONResponse

from backend.plan_drafts.finalize import (
    PlanDraftValidationError,
    finalize_response_metadata,
    validate_plan_draft_finalize,
)
from backend.plan_drafts import service
from backend.auth.auth_helper import SessionRole
from backend.db.db_helper import PostgresDatabase
from backend.procurement_import.domain import canonical_digest
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.procurement_import.session import ProcurementImportSessionService
from backend.sync import service as sync_service


class Cursor:
    def __init__(self, existing=None):
        self.existing = existing or {}

    def execute(self, sql, params):
        table = "ke_hoach_lcnt" if "ke_hoach_lcnt" in sql else "goi_thau"
        ids = set(str(value) for value in params[1:])
        rows = [(value,) for value in self.existing.get(table, set()) if value in ids]
        return type("Result", (), {"fetchall": lambda _self: rows})()


def valid_payload():
    return {
        "draftId": "draft-1",
        "planRootId": "plan-00",
        "clientMutationId": "finalize-1",
        "versions": [
            {"id": "plan-00", "version": 0},
            {"id": "plan-01", "version": 1},
            {"id": "plan-02", "version": 2},
        ],
        "kehoach": [
            {"id": "plan-00", "rootId": "plan-00", "phienBan": 0, "isLatest": 0},
            {"id": "plan-01", "rootId": "plan-00", "phienBan": 1, "isLatest": 0},
            {"id": "plan-02", "rootId": "plan-00", "phienBan": 2, "isLatest": 1},
        ],
        "goithau": [
            {"id": "package-a", "rootId": "package-a", "keHoachId": "plan-00", "tenGoiThau": "A"},
            {"id": "package-b", "rootId": "package-a", "keHoachId": "plan-01", "tenGoiThau": "B"},
            {"id": "package-c", "rootId": "package-a", "keHoachId": "plan-02", "tenGoiThau": "C"},
        ],
        "goithauhanghoa": [
            {"id": "goods-a", "goiThauId": "package-a"},
            {"id": "goods-b", "goiThauId": "package-b"},
            {"id": "goods-c", "goiThauId": "package-c"},
        ],
        "thongtinmothau": [],
        "hanghoaduthaunhathau": [],
        "assignments": [
            {"id": "assign-00", "type": "goithau", "targetId": "package-a", "empId": "e1"},
            {"id": "assign-01-e1", "type": "goithau", "targetId": "package-b", "empId": "e1"},
            {"id": "assign-01-e2", "type": "goithau", "targetId": "package-b", "empId": "e2"},
            {"id": "assign-02", "type": "goithau", "targetId": "package-c", "empId": "e2"},
        ],
        "deletions": [],
    }


def test_finalize_validator_accepts_complete_contiguous_new_aggregate():
    payload = valid_payload()
    validate_plan_draft_finalize(Cursor(), "org-1", payload)
    assert [row["isLatest"] for row in payload["kehoach"]] == [0, 0, 1]


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda data: data["versions"].__setitem__(1, {"id": "plan-01", "version": 2}), "DRAFT_VERSION_SEQUENCE_INVALID"),
        (lambda data: data["goithau"][1].__setitem__("keHoachId", "missing"), "DRAFT_REFERENCE_INVALID"),
        (lambda data: data["assignments"][0].__setitem__("targetId", "missing"), "DRAFT_REFERENCE_INVALID"),
        (lambda data: data.__setitem__("deletions", [{"table": "goithau", "id": "x"}]), "DRAFT_DELETIONS_NOT_ALLOWED"),
        (lambda data: data["kehoach"][0].__setitem__("rowVersion", 1), "DRAFT_ALREADY_PERSISTED"),
    ],
)
def test_finalize_validator_rejects_invalid_or_partly_persisted_graph(mutate, code):
    payload = valid_payload()
    mutate(payload)
    with pytest.raises(PlanDraftValidationError) as caught:
        validate_plan_draft_finalize(Cursor(), "org-1", payload)
    assert caught.value.code == code


def test_finalize_validator_rejects_ids_that_already_exist_in_the_workspace():
    with pytest.raises(PlanDraftValidationError) as caught:
        validate_plan_draft_finalize(
            Cursor({"ke_hoach_lcnt": {"plan-01"}}),
            "org-1",
            valid_payload(),
        )
    assert caught.value.code == "DRAFT_ALREADY_PERSISTED"


@pytest.mark.parametrize("invalid_version", ["abc", "٠", -1, None, True, 0.0])
def test_backend_rejects_malformed_plan_version(invalid_version):
    payload = valid_payload()
    payload["kehoach"][0]["phienBan"] = invalid_version
    with pytest.raises(PlanDraftValidationError) as caught:
        validate_plan_draft_finalize(Cursor(), "org-1", payload)
    assert caught.value.code == "DRAFT_VERSION_SEQUENCE_INVALID"


def test_backend_rejects_unknown_assignment_type():
    payload = valid_payload()
    payload["assignments"][0]["type"] = "unknown"
    with pytest.raises(PlanDraftValidationError) as caught:
        validate_plan_draft_finalize(Cursor(), "org-1", payload)
    assert caught.value.code == "DRAFT_REFERENCE_INVALID"


@pytest.mark.parametrize("field", ["rowVersion", "expectedVersion"])
def test_backend_rejects_malformed_new_record_version(field):
    payload = valid_payload()
    payload["kehoach"][0][field] = "abc"
    with pytest.raises(PlanDraftValidationError) as caught:
        validate_plan_draft_finalize(Cursor(), "org-1", payload)
    assert caught.value.code == "DRAFT_ALREADY_PERSISTED"


@pytest.mark.parametrize(
    ("table", "value"),
    [("goithauhanghoa", "abc"), ("chuyengia", -1)],
)
def test_backend_rejects_malformed_child_and_shared_record_versions(table, value):
    payload = valid_payload()
    if not payload.get(table):
        payload[table] = [{"id": f"{table}-1"}]
    payload[table][0]["rowVersion"] = value
    with pytest.raises(PlanDraftValidationError) as caught:
        validate_plan_draft_finalize(Cursor(), "org-1", payload)
    assert caught.value.code == "DRAFT_REFERENCE_INVALID"


@pytest.mark.parametrize(
    "existing",
    [
        {"ke_hoach_lcnt": {"plan-01"}},
        {"goi_thau": {"package-b"}},
    ],
    ids=[
        "finalize_draft_cannot_modify_existing_historical_plan",
        "finalize_draft_cannot_modify_existing_historical_package",
    ],
)
def test_finalize_draft_cannot_modify_existing_historical_parent(existing):
    with pytest.raises(PlanDraftValidationError) as caught:
        validate_plan_draft_finalize(Cursor(existing), "org-1", valid_payload())
    assert caught.value.code == "DRAFT_ALREADY_PERSISTED"


def test_finalize_response_returns_identity_mapping_and_latest_plan():
    metadata = finalize_response_metadata(valid_payload())
    assert metadata["draftId"] == "draft-1"
    assert metadata["persistedPlanIds"] == ["plan-00", "plan-01", "plan-02"]
    assert metadata["persistedPackageIds"] == ["package-a", "package-b", "package-c"]
    assert metadata["latestPlanId"] == "plan-02"
    assert metadata["idMapping"]["plans"]["plan-01"] == "plan-01"


def test_http_adapter_dispatches_finalize_to_atomic_sync_lane(monkeypatch):
    command = valid_payload()
    captured = {}

    async def read_json_object(_request):
        return command, None

    async def run_database_write(function, *args, **kwargs):
        captured.update({"function": function, "args": args, "kwargs": kwargs})
        return JSONResponse({"status": "success"})

    monkeypatch.setattr(service, "read_json_object", read_json_object)
    monkeypatch.setattr(service, "run_database_write", run_database_write)
    response = asyncio.run(service.process_plan_draft_finalize_request(object()))

    assert response.status_code == 200
    assert captured["args"][1] == command
    assert captured["kwargs"] == {"finalize_draft_command": True}


def test_atomic_finalize_mode_uses_serializable_and_no_record_savepoints():
    from pathlib import Path
    from backend.sync import service as sync_service

    source = Path(sync_service.__file__).read_text(encoding="utf-8")
    assert "aggregate_version_command or finalize_draft_command" in source
    atomic_branch = source.index("if atomic_command:", source.index("for payload_key"))
    savepoint = source.index('cursor.execute("SAVEPOINT sync_item")', atomic_branch)
    assert source.index("continue", atomic_branch, savepoint) < savepoint


def test_three_intermediate_versions_stay_absent_until_one_atomic_final_save(monkeypatch):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for plan draft integration test")
    database = PostgresDatabase(database_url)
    token = uuid.uuid4().hex
    organization_id = f"org-plan-draft-{token}"
    actor_id = f"actor-plan-draft-{token}"
    expert_1 = f"expert-1-{token}"
    expert_2 = f"expert-2-{token}"
    investor_id = f"investor-plan-draft-{token}"
    plan_ids = [f"plan-{index}-{token}" for index in range(3)]
    package_ids = [f"package-{index}-{token}" for index in range(3)]

    setup = database.get_connection()
    try:
        setup.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức kiểm thử plan draft"),
        )
        for user_id, role in ((actor_id, "manager"), (expert_1, "employee"), (expert_2, "employee")):
            email = f"{user_id}@example.test"
            setup.execute(
                """INSERT INTO tai_khoan
                       (id, mat_khau, email, email_norm, ho_ten, vai_tro,
                        da_xac_minh, trang_thai)
                   VALUES (?, 'test-hash', ?, ?, ?, 'user', 1, 'active')""",
                (user_id, email, email, user_id),
            )
            setup.execute(
                """INSERT INTO thanh_vien_to_chuc
                       (user_id, organization_id, vai_tro_trong_to_chuc)
                   VALUES (?, ?, ?)""",
                (user_id, organization_id, role),
            )
        setup.execute(
            """INSERT INTO chu_dau_tu
                   (id, organization_id, owner_type, id_goc, ma_chu_dau_tu,
                    ten_chu_dau_tu, phien_ban, is_latest)
               VALUES (?, ?, 'organization', ?, ?, ?, '00', 1)""",
            (investor_id, organization_id, investor_id, f"INV-{token[:8]}", "Chủ đầu tư A"),
        )
        setup.commit()
    finally:
        setup.close()

    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(
        sync_service,
        "verify_session",
        lambda _request: (
            True,
            SessionRole(
                "user", actor_id, platform_role="user", active_role="manager",
                active_role_organization_id=organization_id,
            ),
        ),
    )
    request = SimpleNamespace(
        headers={"X-Active-Org": organization_id},
        state=SimpleNamespace(),
        client=SimpleNamespace(host="127.0.0.1"),
        method="POST",
    )

    def plan(index):
        return {
            "id": plan_ids[index], "rootId": plan_ids[0], "phienBan": index,
            "isLatest": 1 if index == 2 else 0, "maKeHoach": f"KH-{token[:8]}",
            "tenKeHoach": f"Kế hoạch {index}", "tenDuAnDuToan": "Dự toán kiểm thử",
            "loaiHinhMuaSam": "Dự toán mua sắm", "chuDauTuId": investor_id,
            "ngayPheDuyet": "2026-08-19", "quyetDinhPheDuyet": f"QD-{index}",
        }

    def package(index):
        return {
            "id": package_ids[index], "rootId": package_ids[0], "keHoachId": plan_ids[index],
            "phienBan": 0, "isLatest": 1, "maGoiThau": f"GT-{token[:8]}",
            "tenGoiThau": ["A", "B", "C"][index], "giaGoiThau": 100 + index,
            "thoiGianThucHien": "30 ngày", "nguonVon": "Ngân sách",
            "thoiGianToChuc": "30 ngày", "thoiGianBatDauToChuc": "Quý III/2026",
            "quaMang": "Qua mạng", "trongNuocQuocTe": "Trong nước",
            "phanLo": "Không", "tuyChonMuaThem": "Không", "trangThai": "Chuẩn bị",
            "linhVuc": "Hàng hóa",
        }

    assignments = [
        {"id": f"a-00-e1-{token}", "type": "goithau", "targetId": package_ids[0], "empId": expert_1},
        {"id": f"a-01-e1-{token}", "type": "goithau", "targetId": package_ids[1], "empId": expert_1},
        {"id": f"a-01-e2-{token}", "type": "goithau", "targetId": package_ids[1], "empId": expert_2},
        {"id": f"a-02-e2-{token}", "type": "goithau", "targetId": package_ids[2], "empId": expert_2},
    ]
    payload = {
        "draftId": f"draft-{token}", "planRootId": plan_ids[0],
        "clientMutationId": f"finalize-{token}",
        "versions": [{"id": plan_ids[index], "version": index} for index in range(3)],
        "kehoach": [plan(index) for index in range(3)],
        "goithau": [package(index) for index in range(3)],
        "goithauhanghoa": [
            {
                "id": f"goods-{index}-{token}", "goiThauId": package_ids[index],
                "maHangHoa": f"HH-{index}", "tenHangHoa": f"Hàng hóa {index}",
                "donViTinh": "Cái", "soLuong": index + 1, "donGiaDuToan": 100,
            }
            for index in range(3)
        ],
        "thongtinmothau": [], "hanghoaduthaunhathau": [],
        "assignments": assignments, "deletions": [],
    }

    try:
        before = database.get_connection()
        try:
            assert before.execute(
                "SELECT COUNT(*) FROM ke_hoach_lcnt WHERE organization_id = ? AND id_goc = ?",
                (organization_id, plan_ids[0]),
            ).fetchone()[0] == 0
        finally:
            before.close()

        invalid = deepcopy(payload)
        invalid["goithauhanghoa"][-1]["soLuong"] = 0
        failed = sync_service.execute_sync_mutation(
            request, invalid, finalize_draft_command=True,
        )
        assert failed.status_code == 400

        after_failure = database.get_connection()
        try:
            assert after_failure.execute(
                "SELECT COUNT(*) FROM ke_hoach_lcnt WHERE organization_id = ? AND id_goc = ?",
                (organization_id, plan_ids[0]),
            ).fetchone()[0] == 0
            assert after_failure.execute(
                "SELECT COUNT(*) FROM goi_thau WHERE organization_id = ? AND id IN (?, ?, ?)",
                (organization_id, *package_ids),
            ).fetchone()[0] == 0
        finally:
            after_failure.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(
                lambda _index: sync_service.execute_sync_mutation(
                    request, deepcopy(payload), finalize_draft_command=True,
                ),
                range(2),
            ))
        successful = [response for response in responses if response.status_code == 200]
        assert successful, [
            (response.status_code, json.loads(response.body)) for response in responses
        ]
        body = json.loads(successful[0].body)
        for concurrent_response in responses:
            if concurrent_response.status_code == 200:
                assert json.loads(concurrent_response.body) == body
                continue
            concurrent_error = json.loads(concurrent_response.body)
            assert concurrent_response.status_code == 409
            assert concurrent_error["code"] == "VERSION_CREATION_CONFLICT"
            conflict_retry = sync_service.execute_sync_mutation(
                request, deepcopy(payload), finalize_draft_command=True,
            )
            assert conflict_retry.status_code == 200
            assert json.loads(conflict_retry.body) == body
        retry = sync_service.execute_sync_mutation(
            request, deepcopy(payload), finalize_draft_command=True,
        )
        assert retry.status_code == 200
        assert json.loads(retry.body) == body

        check = database.get_connection()
        try:
            plans = check.execute(
                """SELECT phien_ban, is_latest FROM ke_hoach_lcnt
                    WHERE organization_id = ? AND id_goc = ? ORDER BY phien_ban""",
                (organization_id, plan_ids[0]),
            ).fetchall()
            assert [tuple(row) for row in plans] == [(0, 0), (1, 0), (2, 1)]
            packages = check.execute(
                """SELECT ten_goi_thau FROM goi_thau
                    WHERE organization_id = ? AND id IN (?, ?, ?) ORDER BY ke_hoach_id""",
                (organization_id, *package_ids),
            ).fetchall()
            assert [row[0] for row in packages] == ["A", "B", "C"]
            assignment_rows = check.execute(
                """SELECT id_muc_tieu, id_nhan_vien FROM phan_cong_nhan_su
                    WHERE organization_id = ? AND id_nhan_vien IN (?, ?)""",
                (organization_id, expert_1, expert_2),
            ).fetchall()
            actual = {(row[0], row[1]) for row in assignment_rows}
            assert actual == {
                (package_ids[0], expert_1),
                (package_ids[1], expert_1), (package_ids[1], expert_2),
                (package_ids[2], expert_2),
            }
        finally:
            check.close()
    finally:
        database.close()


def test_specialist_with_view_can_finalize_new_imported_plan_revisions(monkeypatch):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for plan draft integration test")
    database = PostgresDatabase(database_url)
    token = uuid.uuid4().hex
    organization_id = f"org-plan-import-draft-{token}"
    actor_id = f"actor-plan-import-draft-{token}"
    investor_id = f"investor-plan-import-draft-{token}"
    family_no = f"PL{token[:10].upper()}"
    workspace_lease = f"lease-{token}"
    plan_ids = [f"plan-00-{token}", f"plan-01-{token}"]
    revisions = [
        {
            "revisionId": f"revision-00-{token}", "revisionNumber": "00",
            "name": "Kế hoạch nguồn 00", "planType": "Dự toán mua sắm",
            "projectName": "Dự toán kiểm thử", "approvalDecisionNo": "00/QĐ",
            "approvalDecisionDate": "2026-01-01", "packages": [],
        },
        {
            "revisionId": f"revision-01-{token}", "revisionNumber": "01",
            "name": "Kế hoạch nguồn 01", "planType": "Dự toán mua sắm",
            "projectName": "Dự toán kiểm thử", "approvalDecisionNo": "01/QĐ",
            "approvalDecisionDate": "2026-02-01", "packages": [],
        },
    ]
    for revision in revisions:
        revision["revisionDigest"] = canonical_digest(revision)

    setup = database.get_connection()
    try:
        setup.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức kiểm thử plan import draft"),
        )
        email = f"{token}@example.test"
        setup.execute(
            """INSERT INTO tai_khoan
                   (id, mat_khau, email, email_norm, ho_ten, vai_tro,
                    da_xac_minh, trang_thai)
               VALUES (?, 'test-hash', ?, ?, 'Importer', 'user', 1, 'active')""",
            (actor_id, email, email),
        )
        setup.execute(
            """INSERT INTO thanh_vien_to_chuc
                   (user_id, organization_id, vai_tro_trong_to_chuc)
               VALUES (?, ?, 'employee')""",
            (actor_id, organization_id),
        )
        setup.execute(
            """INSERT INTO ma_tran_phan_quyen
                   (id, organization_id, emp_id, kehoach)
               VALUES (?, ?, ?, 'view')""",
            (f"permission-{token}", organization_id, actor_id),
        )
        setup.execute(
            """INSERT INTO chu_dau_tu
                   (id, organization_id, owner_type, id_goc, ma_chu_dau_tu,
                    ten_chu_dau_tu, phien_ban, is_latest)
               VALUES (?, ?, 'organization', ?, ?, ?, '00', 1)""",
            (
                investor_id, organization_id, investor_id,
                f"INV-{token[:8]}", "Chủ đầu tư kiểm thử",
            ),
        )
        session = ProcurementImportSessionService(
            ProcurementImportSessionRepository(setup.cursor())
        ).create_from_bundle(
            {
                "provider": "MUASAMCONG",
                "plan": {"familyNo": family_no},
                "revisions": revisions,
            },
            organization_id=organization_id,
            user_id=actor_id,
            workspace_lease=workspace_lease,
        )
        setup.commit()
    finally:
        setup.close()

    monkeypatch.setattr(sync_service, "database", database)
    monkeypatch.setattr(
        sync_service,
        "verify_session",
        lambda _request: (
            True,
            SessionRole(
                "user", actor_id, platform_role="user", active_role="employee",
                active_role_organization_id=organization_id,
            ),
        ),
    )
    request = SimpleNamespace(
        headers={"X-Active-Org": organization_id}, state=SimpleNamespace(),
        client=SimpleNamespace(host="127.0.0.1"), method="POST",
    )

    def authority(index):
        revision = revisions[index]
        return {
            "sessionId": session["sessionId"], "workspaceLease": workspace_lease,
            "provider": "MUASAMCONG", "familyNo": family_no,
            "revisionId": revision["revisionId"],
            "revisionNumber": revision["revisionNumber"],
            "revisionDigest": revision["revisionDigest"],
        }

    def plan(index):
        revision = revisions[index]
        return {
            "id": plan_ids[index], "rootId": plan_ids[0], "phienBan": index,
            "isLatest": 1 if index == 1 else 0, "maKeHoach": family_no,
            "tenKeHoach": revision["name"],
            "tenDuAnDuToan": revision["projectName"],
            "loaiHinhMuaSam": revision["planType"], "chuDauTuId": investor_id,
            "ngayPheDuyet": revision["approvalDecisionDate"],
            "quyetDinhPheDuyet": revision["approvalDecisionNo"],
            "sourceRevision": authority(index),
        }

    payload = {
        "draftId": f"draft-{token}", "planRootId": plan_ids[0],
        "clientMutationId": f"finalize-import-{token}",
        "versions": [{"id": plan_ids[index], "version": index} for index in range(2)],
        "kehoach": [plan(0), plan(1)], "goithau": [], "goithauhanghoa": [],
        "thongtinmothau": [], "hanghoaduthaunhathau": [],
        "assignments": [], "deletions": [],
    }

    try:
        response = sync_service.execute_sync_mutation(
            request, deepcopy(payload), finalize_draft_command=True,
        )
        assert response.status_code == 200, json.loads(response.body)
        body = json.loads(response.body)
        assert body["procurementImport"]["revisionNumber"] == "01"
        assert [
            item["revisionNumber"]
            for item in body["procurementImport"]["revisions"]
        ] == ["00", "01"]

        check = database.get_connection()
        try:
            plans = check.execute(
                """SELECT phien_ban, is_latest FROM ke_hoach_lcnt
                    WHERE organization_id = ? AND id_goc = ? ORDER BY phien_ban""",
                (organization_id, plan_ids[0]),
            ).fetchall()
            assert [tuple(row) for row in plans] == [(0, 0), (1, 1)]
            assignments = check.execute(
                """SELECT id_muc_tieu, id_nhan_vien FROM phan_cong_nhan_su
                    WHERE organization_id = ? AND loai_doi_tuong = 'kehoach'""",
                (organization_id,),
            ).fetchall()
            assert {tuple(row) for row in assignments} == {
                (plan_id, actor_id) for plan_id in plan_ids
            }
            session_row = check.execute(
                """SELECT current_revision_index, status
                     FROM procurement_import_session
                    WHERE organization_id = ? AND id = ?""",
                (organization_id, session["sessionId"]),
            ).fetchone()
            assert tuple(session_row) == (2, "COMPLETED")
            assert check.execute(
                """SELECT COUNT(*) FROM procurement_source_revision
                    WHERE organization_id = ? AND family_key = ?""",
                (organization_id, family_no),
            ).fetchone()[0] == 2
        finally:
            check.close()
    finally:
        database.close()
