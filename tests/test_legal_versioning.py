from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.db.db_helper import PostgresCursor, compat_row_factory
from backend.auth.auth_helper import SessionRole
from backend.compliance import ComplianceContext
from backend.compliance.repository import ComplianceContextRepository
from backend.legal_versioning.repository import LegalVersioningRepository
from backend.legal_versioning.service import (
    LegalConflictError,
    LegalVersioningError,
    LegalVersioningService,
)
from backend.legal_versioning.routes import list_profiles_api
from backend.sync.visibility_scope import VisibilityScope


def _database_url():
    if value := os.environ.get("TEST_DATABASE_URL"):
        return value
    path = Path(__file__).resolve().parents[1] / ".env"
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip('"').strip("'")
    return ""


def test_legal_http_kill_switch_and_session_boundary(monkeypatch):
    client = TestClient(Starlette(routes=[
        Route("/api/legal-versioning/profiles", list_profiles_api),
    ]))
    monkeypatch.setenv("LEGAL_VERSIONING_ENABLED", "false")
    assert client.get("/api/legal-versioning/profiles").status_code == 404

    monkeypatch.setenv("LEGAL_VERSIONING_ENABLED", "true")
    assert client.get("/api/legal-versioning/profiles").status_code == 403


@pytest.mark.parametrize(
    "source_uri",
    ("javascript:alert(1)", "data:text/html,unsafe", "https://user:pass@example.test/law"),
)
def test_legal_source_uri_rejects_unsafe_links(source_uri):
    class Repository:
        def create_instrument_draft(self, _payload):
            raise AssertionError("unsafe source must be rejected before persistence")

    service = LegalVersioningService(Repository(), audit=lambda *_args, **_kwargs: None)

    with pytest.raises(LegalVersioningError) as error:
        service.create_instrument_draft(
            stable_code="law-01",
            title="Legal title",
            document_type="LAW",
            document_number="01/2026",
            source_uri=source_uri,
            source_content="content",
            issued_date="2026-01-01",
            effective_from="2026-01-01",
            effective_to=None,
            relations=[],
            actor_user_id="admin-1",
        )

    assert error.value.fields == {"sourceUri": "INVALID_SOURCE_URI"}


def test_publish_exact_sources_and_bind_plan_with_independent_cas():
    if not (database_url := _database_url()):
        pytest.skip("TEST_DATABASE_URL is not configured")
    connection = psycopg.connect(
        database_url, connect_timeout=5, row_factory=compat_row_factory,
    )
    cursor = PostgresCursor(connection.cursor())
    token = uuid.uuid4().hex
    user_id = f"legal-user-{token}"
    organization_id = f"legal-org-{token}"
    investor_id = f"legal-investor-{token}"
    plan_id = f"legal-plan-{token}"
    audits = []

    def audit(action, **values):
        assert values["cursor"] is cursor
        assert values["required"] is True
        audits.append(action)
        return f"audit-{len(audits)}"

    try:
        cursor.execute(
            """INSERT INTO tai_khoan
                 (id, ten_dang_nhap, username_norm, mat_khau, ho_ten,
                  email, email_norm, vai_tro, da_xac_minh)
               VALUES (?, ?, ?, 'hash', 'Legal Admin', ?, ?, 'super_admin', 1)""",
            (user_id, f"legal-{token}", f"legal-{token}",
             f"legal-{token}@example.test", f"legal-{token}@example.test"),
        )
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES (?, ?)",
            (organization_id, f"Legal Org {token}"),
        )
        cursor.execute(
            """INSERT INTO chu_dau_tu
                 (organization_id, id, owner_type, ten_chu_dau_tu)
               VALUES (?, ?, 'organization', 'Chủ đầu tư legal')""",
            (organization_id, investor_id),
        )
        cursor.execute(
            """INSERT INTO ke_hoach_lcnt
                 (organization_id, id, owner_type, ten_ke_hoach,
                  ten_du_an_du_toan, loai_hinh_mua_sam, chu_dau_tu_id,
                  ngay_phe_duyet, quyet_dinh_phe_duyet)
               VALUES (?, ?, 'organization', 'Kế hoạch legal', 'Dự án legal',
                       'Mua sắm thường xuyên', ?, '2026-02-01', 'QD-01')""",
            (organization_id, plan_id, investor_id),
        )
        repository = LegalVersioningRepository(cursor)
        service = LegalVersioningService(repository, audit=audit)

        assert service.get_binding(organization_id, "plan", plan_id) == {
            "bindingRevision": 0,
            "status": "UNRESOLVED",
            "reason": "LEGACY_NOT_BACKFILLED",
            "profileVersionId": None,
        }
        draft = service.create_instrument_draft(
            stable_code=f"law-{token}", title="Luật đấu thầu thử nghiệm",
            document_type="LAW", document_number="01/2026/QH",
            source_uri="https://example.test/legal/01",
            source_content="Nội dung nguồn pháp lý bất biến.",
            issued_date="2026-01-01", effective_from="2026-01-01",
            effective_to=None, relations=[], actor_user_id=user_id,
        )
        source = service.publish_instrument(
            draft_id=draft["id"], expected_draft_revision=1,
            actor_user_id=user_id,
        )
        assert len(source["contentSha256"]) == 64
        assert "sourceContent" not in source

        profile_draft = service.create_profile_draft(
            stable_code=f"regime-{token}", display_name="Chế độ pháp lý 2026",
            effective_from="2026-01-01", effective_to=None, priority=10,
            manual_review_required=False,
            instrument_version_ids=[source["id"]], actor_user_id=user_id,
        )
        profile = service.publish_profile(
            draft_id=profile_draft["id"], expected_draft_revision=1,
            actor_user_id=user_id,
        )
        assert profile["instrumentVersionIds"] == [source["id"]]
        exact_sources = service.get_exact_sources(profile["id"])
        assert exact_sources["sources"][0]["sourceContent"] == (
            "Nội dung nguồn pháp lý bất biến."
        )
        assert exact_sources["sources"][0]["contentSha256"] == source["contentSha256"]

        bound = service.resolve_and_bind(
            organization_id=organization_id, target_type="plan",
            target_id=plan_id, expected_binding_revision=0,
            expected_target_row_version=1, actor_user_id=user_id,
        )
        assert bound["status"] == "RESOLVED"
        assert bound["profileVersionId"] == profile["id"]
        assert bound["bindingRevision"] == 1
        compliance_scope = VisibilityScope.resolve(
            cursor,
            SessionRole("super_admin", user_id, platform_role="super_admin"),
            user_id,
            organization_id,
        )
        compliance = ComplianceContext(
            ComplianceContextRepository(cursor, compliance_scope)
        ).get_snapshot({
            "targetType": "kehoach",
            "targetId": plan_id,
            "versionId": plan_id,
        })
        assert compliance["target"]["exactVersionId"] == plan_id
        assert compliance["legalBinding"]["sourceProfileVersionId"] == profile["id"]
        assert compliance["legalBinding"]["sources"][0]["id"] == source["id"]
        assert compliance["findings"][0]["result"] == "PASS"
        assert any(
            item["code"] == "LEGAL_CONCLUSION_NOT_EVALUATED"
            for item in compliance["notEvaluated"]
        )
        with pytest.raises(LegalConflictError) as stale:
            service.resolve_and_bind(
                organization_id=organization_id, target_type="plan",
                target_id=plan_id, expected_binding_revision=0,
                expected_target_row_version=1, actor_user_id=user_id,
            )
        assert stale.value.current["bindingRevision"] == 1

        cursor.execute("SAVEPOINT immutable_legal_source")
        with pytest.raises(psycopg.Error):
            cursor.execute(
                "UPDATE legal_instrument_version SET source_content = 'mutated' WHERE id = ?",
                (source["id"],),
            )
        cursor.execute("ROLLBACK TO SAVEPOINT immutable_legal_source")
        cursor.execute("RELEASE SAVEPOINT immutable_legal_source")
        assert audits == [
            "legal.instrument_draft_created",
            "legal.instrument_version_published",
            "legal.profile_draft_created",
            "legal.profile_version_published",
            "legal.target_binding_recorded",
        ]
    finally:
        connection.rollback()
        connection.close()
