import os
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import time
from types import SimpleNamespace
from threading import Barrier
import uuid

import pytest

from backend.db.db_helper import PostgresDatabase
from backend.auth.auth_helper import SessionRole
from backend.procurement_import.domain import canonical_digest
from backend.procurement_import.repository import ProcurementImportSessionRepository
from backend.procurement_import.session import ProcurementImportSessionService
from backend.procurement_import.sync_binding import (
    _record_revision_commit,
    _session_records,
    _validate_session_authority,
    resolve_pending_imported_investor,
    validate_import_session_mutation,
)
from backend.sync import service as sync_service


def _authority(revision_number="00"):
    return {
        "sessionId": "session-1", "workspaceLease": "lease-1",
        "provider": "MUASAMCONG",
        "familyNo": "PL2600000001",
        "revisionId": f"revision-{revision_number}",
        "revisionNumber": revision_number,
        "revisionDigest": "sha256:" + "a" * 64,
    }


def test_session_records_rejects_mixed_authoritative_revisions():
    with pytest.raises(ValueError, match="PROCUREMENT_SOURCE_VERSION_CONFLICT"):
        _session_records({
            "kehoach": [
                {"id": "plan-00", "sourceRevision": _authority("00")},
                {"id": "plan-01", "sourceRevision": _authority("01")},
            ],
        })


def test_revision_commit_observability_is_bounded_and_excludes_raw_secrets(
    monkeypatch,
):
    events = []
    monkeypatch.setattr(
        "backend.procurement_import.sync_binding.log_structured_event",
        lambda event, **kwargs: events.append((event, kwargs)),
    )

    _record_revision_commit(
        {
            "kind": "PLAN", "provider": "MUASAMCONG",
            "familyNo": "PL2600000001",
            "canonicalBundle": {"cookie": "must-not-be-logged"},
        },
        {"revisionNumber": "01"},
        "org-1", "user-1", time.perf_counter(),
    )

    event, kwargs = events[0]
    assert event == "procurement_import.revision_committed"
    assert kwargs["fields"]["revisionNumber"] == "01"
    assert set(kwargs["fields"]) == {
        "kind", "provider", "familyNo", "revisionNumber",
        "revisionCommitMs",
    }
    assert kwargs["nonblocking"] is True
    rendered = json.dumps(events)
    assert "must-not-be-logged" not in rendered
    assert "cookie" not in rendered.casefold()
    assert "token" not in rendered.casefold()


@pytest.mark.parametrize(
    ("session_changes", "context_changes"),
    [
        ({"status": "CANCELLED"}, {}),
        ({"status": "COMPLETED"}, {}),
        ({"currentIndex": 1}, {}),
        ({}, {"provider": "OTHER"}),
        ({}, {"familyNo": "PL9999999999"}),
        ({}, {"workspaceLease": "lease-2"}),
    ],
)
def test_commit_rejects_inactive_cursor_or_mismatched_source_authority(
    session_changes, context_changes,
):
    session = {
        "provider": "MUASAMCONG", "familyNo": "PL2600000001",
        "workspaceLease": "lease-1",
        "status": "READY", "currentIndex": 0,
        "revisions": [
            {"revisionNumber": "00", "status": "READY"},
            {"revisionNumber": "01", "status": "READY"},
        ],
        **session_changes,
    }
    context = {
        "revisionNumber": "00", "provider": "MUASAMCONG",
        "familyNo": "PL2600000001", "workspaceLease": "lease-1",
        **context_changes,
    }

    with pytest.raises(
        ValueError, match="PROCUREMENT_SOURCE_VERSION_CONFLICT",
    ):
        _validate_session_authority(session, context)


def test_preflight_rejects_replayed_revision_before_entity_writes(monkeypatch):
    payload = {
        "kehoach": [{
            "id": "plan-retry", "phienBan": "00",
            "sourceRevision": _authority("00"),
        }],
    }
    monkeypatch.setattr(
        "backend.procurement_import.sync_binding._load_trusted_revision",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ValueError("PROCUREMENT_SOURCE_VERSION_CONFLICT")
        ),
    )

    with pytest.raises(
        ValueError, match="PROCUREMENT_SOURCE_VERSION_CONFLICT",
    ):
        validate_import_session_mutation(
            object(), payload, organization_id="org-1", user_id="user-1",
        )


def test_real_postgres_concurrent_investor_resolution_creates_one_identity():
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL concurrency test")
    database = PostgresDatabase(database_url)
    token = uuid.uuid4().hex
    organization_id = f"org-import-investor-{token}"
    investor_code = f"MSC-{token}"
    setup = database.get_connection()
    try:
        setup.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức kiểm thử import investor"),
        )
        setup.commit()
    finally:
        setup.close()

    barrier = Barrier(2)

    def resolve(candidate_id):
        connection = database.get_connection()
        payload = {
            "chudautu": [{
                "id": candidate_id,
                "maChuDauTu": investor_code,
                "tenChuDauTu": "Chủ đầu tư đồng thời",
            }],
            "kehoach": [{
                "id": f"plan-{candidate_id}",
                "phienBan": "00",
                "chuDauTuId": candidate_id,
                "sourceRevision": _authority(),
            }],
        }
        try:
            barrier.wait()
            reused_id = resolve_pending_imported_investor(
                connection.cursor(), payload, organization_id,
            )
            if reused_id is None:
                connection.execute(
                    """INSERT INTO chu_dau_tu
                       (id, organization_id, owner_type, id_goc, ma_chu_dau_tu,
                        ten_chu_dau_tu, phien_ban, is_latest)
                       VALUES (?, ?, 'organization', ?, ?, ?, '00', 1)""",
                    (
                        candidate_id, organization_id, candidate_id,
                        investor_code, "Chủ đầu tư đồng thời",
                    ),
                )
                authoritative_id = candidate_id
            else:
                authoritative_id = reused_id
            connection.commit()
            return authoritative_id, payload
        finally:
            connection.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(resolve, (f"investor-a-{token}", f"investor-b-{token}")))
        assert results[0][0] == results[1][0]
        check = database.get_connection()
        try:
            rows = check.execute(
                """SELECT id FROM chu_dau_tu
                   WHERE organization_id = ? AND ma_chu_dau_tu = ?""",
                (organization_id, investor_code),
            ).fetchall()
            assert len(rows) == 1
        finally:
            check.close()
    finally:
        cleanup = database.get_connection()
        try:
            cleanup.execute(
                "DELETE FROM chu_dau_tu WHERE organization_id = ?",
                (organization_id,),
            )
            cleanup.execute("DELETE FROM to_chuc WHERE id = ?", (organization_id,))
            cleanup.commit()
        finally:
            cleanup.close()
            database.close()


def test_api_sync_commits_plan_revisions_sequentially_with_atomic_provenance(
    monkeypatch,
):
    database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not database_url:
        pytest.skip("TEST_DATABASE_URL is required for sync integration test")
    database = PostgresDatabase(database_url)
    token = uuid.uuid4().hex
    organization_id = f"org-import-sync-{token}"
    user_id = f"user-import-sync-{token}"
    investor_id = f"investor-import-sync-{token}"
    family_no = f"PL{token[:10].upper()}"
    workspace_lease = f"lease-{token}"

    def package(symbol, revision_number, price):
        return {
            "planDetailRevisionId": f"detail-{symbol}-{revision_number}",
            "stablePackageId": f"stable-{symbol}",
            "symbol": symbol,
            "name": f"Gói {symbol} {revision_number}",
            "priceVnd": price,
            "executionPeriod": "30 ngày",
            "capitalDetail": f"Nguồn {revision_number}",
            "selectionDuration": "30 ngày",
            "selectionStart": f"Quý {1 + int(revision_number)}/2026",
        }

    revisions = [
        {
            "revisionId": f"revision-00-{token}",
            "revisionNumber": "00",
            "name": "Kế hoạch 00",
            "planType": "Dự toán mua sắm",
            "projectName": "Dự toán kiểm thử",
            "approvalDecisionNo": "01/QĐ",
            "approvalDecisionDate": "2026-01-01",
            "packages": [package("A", "00", 100), package("B", "00", 200)],
        },
        {
            "revisionId": f"revision-01-{token}",
            "revisionNumber": "01",
            "name": "Kế hoạch 01 đã điều chỉnh",
            "planType": "Dự toán mua sắm",
            "projectName": "Dự toán kiểm thử",
            "approvalDecisionNo": "02/QĐ",
            "approvalDecisionDate": "2026-02-01",
            "packages": [
                package("A", "01", 110),
                package("B", "01", 220),
                package("C", "01", 300),
            ],
        },
    ]
    for revision in revisions:
        revision["revisionDigest"] = canonical_digest(revision)

    setup = database.get_connection()
    try:
        setup.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, "Tổ chức kiểm thử sync import"),
        )
        setup.execute(
            """INSERT INTO tai_khoan
                   (id, mat_khau, email, email_norm, ho_ten, vai_tro,
                    da_xac_minh, trang_thai)
               VALUES (?, 'test-hash', ?, ?, 'Importer', 'user', 1, 'active')""",
            (user_id, f"{token}@example.test", f"{token}@example.test"),
        )
        setup.execute(
            """INSERT INTO thanh_vien_to_chuc
                   (user_id, organization_id, vai_tro_trong_to_chuc)
               VALUES (?, ?, 'manager')""",
            (user_id, organization_id),
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
            user_id=user_id,
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
                "user", user_id, platform_role="user", active_role="manager",
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

    def authority(revision_number, package_row=None):
        revision = next(
            row for row in revisions if row["revisionNumber"] == revision_number
        )
        value = {
            "sessionId": session["sessionId"],
            "workspaceLease": workspace_lease,
            "provider": "MUASAMCONG",
            "familyNo": family_no,
            "revisionId": revision["revisionId"],
            "revisionNumber": revision_number,
            "revisionDigest": revision["revisionDigest"],
        }
        if package_row:
            value.update({
                "packageObservationId": package_row["planDetailRevisionId"],
                "stablePackageId": package_row["stablePackageId"],
            })
        return value

    def plan_row(revision_number, plan_id, *, root_id=None):
        revision = next(
            row for row in revisions if row["revisionNumber"] == revision_number
        )
        return {
            "id": plan_id,
            "rootId": root_id or plan_id,
            "maKeHoach": family_no,
            "phienBan": revision_number,
            "isLatest": 1,
            "tenKeHoach": revision["name"],
            "tenDuAnDuToan": revision["projectName"],
            "loaiHinhMuaSam": revision["planType"],
            "chuDauTuId": investor_id,
            "ngayPheDuyet": revision["approvalDecisionDate"],
            "quyetDinhPheDuyet": revision["approvalDecisionNo"],
            "thongTinKhac": "Ghi chú local được kế thừa",
            "sourceRevision": authority(revision_number),
        }

    def package_row(revision_number, package_data, plan_id, package_id, root_id=None):
        return {
            "id": package_id,
            "rootId": root_id or package_id,
            "keHoachId": plan_id,
            "maGoiThau": f"{family_no}-{package_data['symbol']}",
            "phienBan": revision_number,
            "isLatest": 1,
            "tenGoiThau": package_data["name"],
            "giaGoiThau": package_data["priceVnd"],
            "thoiGianThucHien": package_data["executionPeriod"],
            "nguonVon": package_data["capitalDetail"],
            "thoiGianToChuc": package_data["selectionDuration"],
            "thoiGianBatDauToChuc": package_data["selectionStart"],
            "quaMang": "Qua mạng",
            "trongNuocQuocTe": "Trong nước",
            "phanLo": "Không",
            "tuyChonMuaThem": "Không",
            "trangThai": "Chuẩn bị",
            "sourceRevision": authority(revision_number, package_data),
        }

    plan_00_id = f"plan-00-{token}"
    package_a_00_id = f"package-a-00-{token}"
    package_b_00_id = f"package-b-00-{token}"
    payload_00 = {
        "clientMutationId": f"import-sync-00-{token}",
        "kehoach": [plan_row("00", plan_00_id)],
        "goithau": [
            package_row("00", revisions[0]["packages"][0], plan_00_id, package_a_00_id),
            package_row("00", revisions[0]["packages"][1], plan_00_id, package_b_00_id),
        ],
    }
    retry_payload_00 = deepcopy(payload_00)

    try:
        response_00 = sync_service.execute_sync_mutation(request, payload_00)
        body_00 = json.loads(response_00.body)
        assert response_00.status_code == 200
        assert body_00["procurementImport"]["revisionNumber"] == "00"

        retry_00 = sync_service.execute_sync_mutation(request, retry_payload_00)
        assert retry_00.status_code == 200, json.loads(retry_00.body)
        assert json.loads(retry_00.body) == body_00

        plan_01_id = f"plan-01-{token}"
        package_a_01_id = f"package-a-01-{token}"
        package_b_01_id = f"package-b-01-{token}"
        package_c_01_id = f"package-c-01-{token}"
        valid_payload_01 = {
            "clientMutationId": f"import-sync-01-{token}",
            "kehoach": [plan_row("01", plan_01_id, root_id=plan_00_id)],
            "goithau": [
                package_row(
                    "01", revisions[1]["packages"][0], plan_01_id,
                    package_a_01_id, root_id=package_a_00_id,
                ),
                package_row(
                    "01", revisions[1]["packages"][1], plan_01_id,
                    package_b_01_id, root_id=package_b_00_id,
                ),
                package_row(
                    "01", revisions[1]["packages"][2], plan_01_id,
                    package_c_01_id,
                ),
            ],
        }
        invalid_payload_01 = {
            **valid_payload_01,
            "clientMutationId": f"import-sync-01-invalid-{token}",
            "goithau": [
                *valid_payload_01["goithau"][:-1],
                {**valid_payload_01["goithau"][-1], "thoiGianThucHien": ""},
            ],
        }
        failed_01 = sync_service.execute_sync_mutation(request, invalid_payload_01)
        assert failed_01.status_code == 400

        check = database.get_connection()
        try:
            session_row = check.execute(
                """SELECT current_revision_index, status
                     FROM procurement_import_session
                    WHERE organization_id = ? AND id = ?""",
                (organization_id, session["sessionId"]),
            ).fetchone()
            assert tuple(session_row) == (1, "WAITING_NEXT_CONFIRMATION")
            assert check.execute(
                "SELECT COUNT(*) FROM ke_hoach_lcnt WHERE organization_id = ? AND id = ?",
                (organization_id, plan_01_id),
            ).fetchone()[0] == 0
        finally:
            check.close()

        response_01 = sync_service.execute_sync_mutation(request, valid_payload_01)
        body_01 = json.loads(response_01.body)
        assert response_01.status_code == 200
        assert body_01["procurementImport"]["revisionNumber"] == "01"

        check = database.get_connection()
        try:
            plans = check.execute(
                """SELECT id, phien_ban, is_latest, thong_tin_khac
                     FROM ke_hoach_lcnt
                    WHERE organization_id = ? AND ma_ke_hoach = ?
                    ORDER BY phien_ban""",
                (organization_id, family_no),
            ).fetchall()
            assert [tuple(row) for row in plans] == [
                (plan_00_id, 0, 0, "Ghi chú local được kế thừa"),
                (plan_01_id, 1, 1, "Ghi chú local được kế thừa"),
            ]
            packages = check.execute(
                """SELECT id_goc, phien_ban, ten_goi_thau, gia_goi_thau
                     FROM goi_thau
                    WHERE organization_id = ?
                    ORDER BY id_goc, phien_ban""",
                (organization_id,),
            ).fetchall()
            assert len(packages) == 5
            assert (package_a_00_id, 1, "Gói A 01", 110) in {
                tuple(row) for row in packages
            }
            assert (package_b_00_id, 1, "Gói B 01", 220) in {
                tuple(row) for row in packages
            }
            session_row = check.execute(
                """SELECT current_revision_index, status
                     FROM procurement_import_session
                    WHERE organization_id = ? AND id = ?""",
                (organization_id, session["sessionId"]),
            ).fetchone()
            assert tuple(session_row) == (2, "COMPLETED")
            provenance = check.execute(
                """SELECT revision_no, local_snapshot_id
                     FROM procurement_source_revision
                    WHERE organization_id = ? AND family_key = ?
                    ORDER BY revision_no""",
                (organization_id, family_no),
            ).fetchall()
            assert [tuple(row) for row in provenance] == [
                ("00", plan_00_id), ("01", plan_01_id),
            ]
            assert check.execute(
                """SELECT COUNT(*) FROM procurement_source_binding
                    WHERE organization_id = ? AND family_key = ?""",
                (organization_id, family_no),
            ).fetchone()[0] == 5
        finally:
            check.close()
    finally:
        cleanup = database.get_connection()
        try:
            cleanup.execute(
                "DELETE FROM to_chuc WHERE id = ?",
                (organization_id,),
            )
            cleanup.execute(
                "DELETE FROM tai_khoan WHERE id = ?",
                (user_id,),
            )
            cleanup.commit()
        finally:
            cleanup.close()
            database.close()
