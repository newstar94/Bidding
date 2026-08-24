from pathlib import Path
import os
import uuid
from types import SimpleNamespace

import psycopg
import pytest

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.procurement_cases.repository import ProcurementCaseRepository
from backend.procurement_cases.service import ProcurementCaseService
from backend.work_calendar.service import WorkCalendar
from backend.bulk_operations.service import BulkOperationService
from backend.bulk_operations.storage import remove


def _database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    path = Path(__file__).resolve().parents[1] / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "TEST_DATABASE_URL":
                return value.strip().strip('"').strip("'")
    return ""


@pytest.fixture
def case_database():
    url = _database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    connection = psycopg.connect(url, connect_timeout=5, row_factory=compat_row_factory)
    cursor = PostgresCursor(connection.cursor())
    if not cursor.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'calendar_event_head'"
    ).fetchone():
        connection.close()
        pytest.skip("TEST_DATABASE_URL has not been migrated to schema v72")
    token = uuid.uuid4().hex
    values = {
        "user": f"case-user-{token}", "org": f"case-org-{token}",
        "investor": f"case-investor-{token}", "plan": f"case-plan-{token}",
        "package": f"case-package-{token}",
    }
    cursor.execute(
        """INSERT INTO tai_khoan
             (id, ten_dang_nhap, username_norm, mat_khau, ho_ten, email,
              email_norm, vai_tro, da_xac_minh)
           VALUES (?, ?, ?, 'hash', 'Case User', ?, ?, 'super_admin', 1)""",
        (values["user"], f"case-{token}", f"case-{token}",
         f"case-{token}@example.test", f"case-{token}@example.test"),
    )
    cursor.execute("INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, 'Case Org')", (values["org"],))
    cursor.execute(
        """INSERT INTO chu_dau_tu
             (id, organization_id, id_goc, ma_chu_dau_tu, ma_so_thue, ten_chu_dau_tu)
           VALUES (?, ?, ?, 'CDT-CASE', 'MST-CASE', 'Chủ đầu tư')""",
        (values["investor"], values["org"], values["investor"]),
    )
    cursor.execute(
        """INSERT INTO ke_hoach_lcnt
             (id, organization_id, id_goc, ma_ke_hoach, ten_ke_hoach,
              ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
              ngay_phe_duyet, quyet_dinh_phe_duyet)
           VALUES (?, ?, ?, 'KH-CASE', 'Kế hoạch case', 'Dự án case',
                   'Mua sắm hàng hóa', ?, '2026-08-01', 'QD-CASE')""",
        (values["plan"], values["org"], values["plan"], values["investor"]),
    )
    cursor.execute(
        """INSERT INTO goi_thau
             (id, organization_id, id_goc, ma_goi_thau, ke_hoach_id,
              ten_goi_thau, gia_goi_thau, thoi_gian_thuc_hien, nguon_von,
              thoi_gian_to_chuc, thoi_gian_bat_dau_to_chuc)
           VALUES (?, ?, ?, 'GT-CASE', ?, 'Gói thầu case', 1000000,
                   '30 ngày', 'Ngân sách', '30 ngày', '2026-08-01')""",
        (values["package"], values["org"], values["package"], values["plan"]),
    )
    try:
        yield cursor, values
    finally:
        connection.rollback()
        connection.close()


def test_case_revisions_transitions_observation_and_calendar_head(case_database):
    cursor, values = case_database
    repository = ProcurementCaseRepository(cursor)
    audits = []

    def audit(action, **_values):
        audits.append(action)

    service = ProcurementCaseService(repository, audit=audit)
    package = repository.package(values["org"], values["package"])
    case = service.create_case(
        organization_id=values["org"], package=package, case_no="LR-01",
        case_type="CLARIFICATION", direction="INBOUND", category=None,
        other_description=None, subject="Làm rõ tiêu chí", due_at="2026-09-01",
        actor_user_id=values["user"], idempotency_key="create-case-0001",
    )
    assert case["deadlineStatus"] == "NOT_EVALUATED"
    case = service.add_party(
        organization_id=values["org"], case_id=case["id"],
        expected_row_version=case["rowVersion"],
        package_version_id=values["package"], role="REQUESTER",
        display_name="Nhà thầu đầy đủ", contact={
            "cccd": "012345678901", "bankAccount": "123456789",
            "bank": "Ngân hàng A", "signature": "signed",
            "seal": "sealed",
        }, actor_user_id=values["user"], idempotency_key="party-case-0001",
    )
    assert case["parties"][0]["contact"] == {
        "bank": "Ngân hàng A", "bankAccount": "123456789",
        "cccd": "012345678901", "seal": "sealed", "signature": "signed",
    }
    case = service.save_response(
        organization_id=values["org"], case_id=case["id"],
        expected_row_version=case["rowVersion"], package_version_id=values["package"],
        content="Phản hồi đầy đủ", actor_user_id=values["user"],
        idempotency_key="response-case-0001",
    )
    revision_id = case["currentResponseRevisionId"]
    case = service.transition(
        organization_id=values["org"], case_id=case["id"],
        expected_row_version=case["rowVersion"], action="SUBMIT_REVIEW",
        package_version_id=values["package"], actor_user_id=values["user"],
        idempotency_key="submit-case-0001",
    )
    case = service.transition(
        organization_id=values["org"], case_id=case["id"],
        expected_row_version=case["rowVersion"], action="APPROVE",
        package_version_id=values["package"], actor_user_id=values["user"],
        idempotency_key="approve-case-0001",
    )
    assert next(item for item in case["transitions"] if item["action"] == "APPROVE")["responseRevisionId"] == revision_id
    case = service.observe_source(
        organization_id=values["org"], case_id=case["id"],
        expected_row_version=case["rowVersion"], package_version_id=values["package"],
        provider="MST", upstream_identity="notice-01", upstream_revision="r1",
        canonical={"subject": "external only"}, actor_user_id=values["user"],
        idempotency_key="observe-case-0001",
    )
    assert case["state"] == "APPROVED"
    assert len(case["sourceObservations"]) == 1
    assert cursor.execute(
        "SELECT content FROM procurement_case_response_revision WHERE id = ?",
        (revision_id,),
    ).fetchone()[0] == "Phản hồi đầy đủ"

    calendar = WorkCalendar(cursor)
    first = calendar.project(values["org"], [{"sourceType": "CASE_DEADLINE", "sourceId": case["id"]}])
    second = calendar.project(values["org"], [{"sourceType": "CASE_DEADLINE", "sourceId": case["id"]}])
    assert first[0]["uid"] == second[0]["uid"]
    assert first[0]["sequence"] == second[0]["sequence"] == 0
    head = cursor.execute(
        "SELECT source_type, source_id FROM calendar_event_head WHERE organization_id = ? AND id = ?",
        (values["org"], first[0]["eventHeadId"]),
    ).fetchone()
    assert (head[0], head[1]) == ("CASE_DEADLINE", case["id"])
    cursor.execute(
        "UPDATE procurement_case SET row_version = row_version + 1 WHERE organization_id = ? AND id = ?",
        (values["org"], case["id"]),
    )
    irrelevant = calendar.project(values["org"], [{"sourceType": "CASE_DEADLINE", "sourceId": case["id"]}])
    assert irrelevant[0]["sequence"] == 0
    cursor.execute(
        "UPDATE procurement_case SET due_at = '2026-09-02', row_version = row_version + 1 WHERE organization_id = ? AND id = ?",
        (values["org"], case["id"]),
    )
    changed = calendar.project(values["org"], [{"sourceType": "CASE_DEADLINE", "sourceId": case["id"]}])
    assert changed[0]["sequence"] == 1
    assert calendar.export_ics(second).endswith(b"END:VCALENDAR\r\n")
    assert "procurement_case.created" in audits


def test_bulk_export_prepare_stale_recheck_and_staged_zip(case_database):
    cursor, values = case_database

    class Visibility:
        @staticmethod
        def live_predicate(_table, alias):
            return SimpleNamespace(
                sql=f"{alias}.organization_id = ?", parameters=(values["org"],)
            )

    service = BulkOperationService(cursor)
    preview = service.prepare(
        values["org"], values["user"], "EXPORT_RECORD_DATA", "goithau",
        "EXPLICIT_IDS", [values["package"]], Visibility(),
    )
    assert preview["items"][0]["title"] == "Gói thầu case"
    cursor.execute(
        "UPDATE goi_thau SET row_version = row_version + 1 WHERE organization_id = ? AND id = ?",
        (values["org"], values["package"]),
    )
    result, stale = service.confirm(
        values["org"], values["user"], preview["operationId"],
        "bulk-confirm-stale-0001", Visibility(),
    )
    assert result is None and stale == "BULK_PREVIEW_STALE"

    fresh = service.prepare(
        values["org"], values["user"], "EXPORT_RECORD_DATA", "goithau",
        "EXPLICIT_IDS", [values["package"]], Visibility(),
    )
    result, stale = service.confirm(
        values["org"], values["user"], fresh["operationId"],
        "bulk-confirm-success-0001", Visibility(),
    )
    assert stale is None
    assert result["status"] == "COMPLETED"
    artifact = cursor.execute(
        "SELECT storage_key FROM bulk_operation_artifact WHERE organization_id = ? AND operation_id = ?",
        (values["org"], fresh["operationId"]),
    ).fetchone()
    assert artifact
    remove(artifact[0])
