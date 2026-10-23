"""Create now, verify the tax code later (ADR 0094) against real PostgreSQL SQL."""

import asyncio
import json
import os
from types import SimpleNamespace

import pytest

from backend.api import org_routes, org_verification
from backend.api.org_tax_code import normalize_tax_code
from backend.db.db_helper import IntegrityError, PostgresDatabase
from backend.db.postgres_schema import build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA


PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


@pytest.fixture
def verification_db(monkeypatch, tmp_path):
    url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    if not url:
        pytest.skip("TEST_DATABASE_URL required for TEMP-table PostgreSQL tests")
    database = PostgresDatabase(url)
    connection = database.get_connection()
    view = SimpleNamespace(
        execute=connection.execute, cursor=connection.cursor,
        commit=connection.commit, rollback=connection.rollback, close=lambda: None,
    )
    proxy = SimpleNamespace(get_connection=lambda: view)
    try:
        for ddl in (
            """CREATE TEMP TABLE tai_khoan (id TEXT PRIMARY KEY, email_norm TEXT, ho_ten TEXT,
                ten_dang_nhap TEXT, vai_tro TEXT DEFAULT 'user', trang_thai TEXT DEFAULT 'active')""",
            """CREATE TEMP TABLE thanh_vien_to_chuc (user_id TEXT, organization_id TEXT,
                vai_tro_trong_to_chuc TEXT DEFAULT 'employee', ten_nhan_su TEXT,
                trang_thai_thanh_vien TEXT DEFAULT 'active', PRIMARY KEY (user_id, organization_id))""",
            "CREATE TEMP TABLE goi_dich_vu (id TEXT PRIMARY KEY, han_muc_nhan_su INTEGER, trang_thai TEXT)",
        ):
            connection.execute(ddl)
        for table in ("to_chuc", "organization_verification_requests", "rate_limit_buckets", "api_idempotency"):
            ddl = build_create_table_sql(table, SCHEMA_DINH_NGHIA[table]).replace("CREATE TABLE ", "CREATE TEMP TABLE ", 1)
            connection.execute(ddl)
        connection.execute(
            "CREATE UNIQUE INDEX ON to_chuc (ma_so_thue) WHERE tax_code_status = 'verified' AND ma_so_thue IS NOT NULL AND btrim(ma_so_thue) <> ''"
        )
        connection.execute(
            "CREATE UNIQUE INDEX ON organization_verification_requests (organization_id) WHERE status = 'pending'"
        )
        for user, role in (("owner", "user"), ("squatter", "user"), ("admin", "super_admin")):
            connection.execute(
                "INSERT INTO tai_khoan (id, email_norm, ho_ten, vai_tro) VALUES (?, ?, ?, ?)",
                (user, f"{user}@example.test", f"Tên {user}", role),
            )
        events = []
        audit = lambda action, **_kwargs: events.append(action)  # noqa: E731
        for module in (org_routes, org_verification):
            monkeypatch.setattr(module, "database", proxy)
            monkeypatch.setattr(module, "log_audit", audit)
        monkeypatch.setattr(
            org_routes, "verify_session_in_transaction",
            lambda _cursor, request: (True, SimpleNamespace(user_id=request.user_id)),
        )
        monkeypatch.setattr(
            org_verification, "verify_session_in_transaction",
            lambda _cursor, request, *_role: (True, SimpleNamespace(user_id=request.user_id)),
        )
        monkeypatch.setattr(org_verification, "get_active_org", lambda request, *_a, **_k: request.org_id)
        monkeypatch.setattr(org_verification, "is_business_organization", lambda *_a: True)
        monkeypatch.setattr(
            org_verification, "is_organization_manager",
            lambda cursor, role, user_id, organization_id: cursor.execute(
                "SELECT 1 FROM thanh_vien_to_chuc WHERE user_id = ? AND organization_id = ? AND vai_tro_trong_to_chuc = 'manager'",
                (user_id, organization_id),
            ).fetchone() is not None,
        )
        monkeypatch.setattr(org_verification, "VERIFICATION_ROOT", tmp_path / "verification")
        monkeypatch.delenv("ORGANIZATION_CREATE_PER_DAY", raising=False)
        yield SimpleNamespace(connection=connection, events=events, root=tmp_path / "verification")
    finally:
        connection.rollback()
        connection.close()
        database.close()


def _request(user_id, org_id=None, key="idempotency-key-1"):
    return SimpleNamespace(
        user_id=user_id, org_id=org_id, headers={"Idempotency-Key": key},
        state=SimpleNamespace(), path_params={}, query_params={},
    )


def _body(response):
    return json.loads(response.body)


def _create(user, tax_code, key, name="HCP"):
    return org_routes._create_organization_sync(
        _request(user, key=key), SimpleNamespace(user_id=user), {"tax_code": tax_code, "short_name": name},
    )


class _Upload:
    def __init__(self, filename, content):
        self.filename = filename
        self._content = content

    async def read(self, size=-1):
        chunk, self._content = self._content, b""
        return chunk


def _submit(user, org_id, filename="dkkd.pdf", content=PDF, note="Giấy ĐKDN"):
    request = _request(user, org_id)
    role = SimpleNamespace(user_id=user)
    prepared = org_verification._prepare_submission_sync(request, role)
    if not isinstance(prepared, str):
        return prepared
    form = {"file": _Upload(filename, content), "note": note}
    upload = asyncio.run(org_verification._stage_upload(form, prepared))
    return org_verification._commit_submission_sync(request, role, upload)


def test_tax_code_is_normalized_and_validated():
    assert normalize_tax_code(" 0101.234 567 ") == "0101234567"
    assert normalize_tax_code("0101234567001") == "0101234567-001"
    assert normalize_tax_code("0101234567-001") == "0101234567-001"
    assert normalize_tax_code("ABC123") is None
    assert normalize_tax_code("12345") is None


def test_duplicate_tax_code_no_longer_blocks_creation_or_reveals_holders(verification_db):
    first = _create("owner", "0101234567", "key-owner-1")
    second = _create("squatter", "0101 234 567", "key-squat-1", name="Giả mạo")
    assert first.status_code == second.status_code == 200
    assert _body(second)["taxCodeClaimedByVerifiedOrganization"] is False
    assert _body(second)["organization"]["tax_code_verified"] is False
    rows = verification_db.connection.execute(
        "SELECT ma_so_thue, tax_code_status FROM to_chuc ORDER BY ten_to_chuc"
    ).fetchall()
    assert [tuple(row) for row in rows] == [("0101234567", "unverified"), ("0101234567", "unverified")]

    invalid = _create("owner", "không-phải-mst", "key-owner-2")
    assert invalid.status_code == 400
    assert _body(invalid)["code"] == "ORGANIZATION_TAX_CODE_INVALID"


def test_creation_is_limited_per_day_except_for_platform_admins(verification_db, monkeypatch):
    for index in range(3):
        assert _create("owner", f"010123456{index}", f"key-limit-{index}").status_code == 200
    # Replaying a stored idempotency key returns the original response, not a new org.
    assert _create("owner", "0101234560", "key-limit-0").status_code == 200
    limited = _create("owner", "0101234569", "key-limit-9")
    assert limited.status_code == 429
    for index in range(5):
        assert _create("admin", f"020123456{index}", f"key-admin-{index}").status_code == 200
    assert verification_db.connection.execute(
        "SELECT count(*) FROM to_chuc WHERE owner_user_id = 'owner'"
    ).fetchone()[0] == 3


def test_verified_holder_is_flagged_and_is_unique_in_the_database(verification_db):
    verification_db.connection.execute(
        """INSERT INTO to_chuc (id, ten_to_chuc, ma_so_thue, tax_code_status, tax_code_verification_method)
           VALUES ('org-legacy', 'Doanh nghiệp thật', '0309999999', 'verified', 'legacy')"""
    )
    created = _create("squatter", "0309999999", "key-squat-2")
    assert created.status_code == 200
    assert _body(created)["taxCodeClaimedByVerifiedOrganization"] is True
    verification_db.connection.execute("SAVEPOINT duplicate_verified")
    with pytest.raises(IntegrityError):
        verification_db.connection.execute(
            "UPDATE to_chuc SET tax_code_status = 'verified' WHERE id = ?",
            (_body(created)["organization"]["id"],),
        )
    verification_db.connection.execute("ROLLBACK TO SAVEPOINT duplicate_verified")


def test_manager_submits_and_admin_approves_a_document(verification_db):
    org_id = _body(_create("owner", "0101234567", "key-owner-3"))["organization"]["id"]
    response = _submit("owner", org_id)
    assert response.status_code == 200
    stored = list(verification_db.root.rglob("*.pdf"))
    assert len(stored) == 1 and stored[0].read_bytes() == PDF

    again = _submit("owner", org_id)
    assert again.status_code == 409
    assert _body(again)["code"] == "ORGANIZATION_VERIFICATION_PENDING"

    status = _body(org_verification._verification_status_sync(_request("owner", org_id), SimpleNamespace(user_id="owner")))
    assert status["status"] == "unverified" and status["request"]["status"] == "pending"

    pending = org_verification._admin_list_sync("pending")
    assert [item["organizationName"] for item in pending] == ["HCP"]
    assert pending[0]["requesterEmail"] == "owner@example.test"

    document = org_verification._admin_document_sync(_request("admin"), SimpleNamespace(user_id="admin"), pending[0]["id"])
    assert document[2] == "application/pdf"

    approved = org_verification._review_sync(_request("admin"), pending[0]["id"], "approve", {})
    assert approved.status_code == 200
    row = verification_db.connection.execute(
        "SELECT tax_code_status, tax_code_verification_method, tax_code_verified_by FROM to_chuc WHERE id = ?",
        (org_id,),
    ).fetchone()
    assert tuple(row) == ("verified", "document", "admin")
    assert "organization.tax_code_verified" in verification_db.events
    assert _submit("owner", org_id).status_code == 409


def test_approving_against_a_verified_holder_needs_explicit_replacement(verification_db):
    verification_db.connection.execute(
        """INSERT INTO to_chuc (id, ten_to_chuc, ma_so_thue, tax_code_status, tax_code_verification_method)
           VALUES ('org-squatted', 'Kẻ chiếm MST', '0101234567', 'verified', 'legacy')"""
    )
    org_id = _body(_create("owner", "0101234567", "key-owner-4"))["organization"]["id"]
    status = _body(org_verification._verification_status_sync(_request("owner", org_id), SimpleNamespace(user_id="owner")))
    assert status["claimedByVerifiedOrganization"] is True
    assert _submit("owner", org_id).status_code == 200
    request_id = org_verification._admin_list_sync("pending")[0]["id"]

    conflict = org_verification._review_sync(_request("admin"), request_id, "approve", {})
    assert conflict.status_code == 409
    assert _body(conflict)["holder"]["id"] == "org-squatted"

    replaced = org_verification._review_sync(_request("admin"), request_id, "approve", {"replaceExisting": True})
    assert replaced.status_code == 200
    statuses = dict(verification_db.connection.execute("SELECT id, tax_code_status FROM to_chuc").fetchall())
    assert statuses == {"org-squatted": "unverified", org_id: "verified"}
    assert "organization.tax_code_verification_revoked" in verification_db.events


def test_reject_requires_a_reason_and_cancel_frees_the_slot(verification_db):
    org_id = _body(_create("owner", "0101234567", "key-owner-5"))["organization"]["id"]
    assert _submit("owner", org_id).status_code == 200
    request_id = org_verification._admin_list_sync("pending")[0]["id"]
    assert org_verification._review_sync(_request("admin"), request_id, "reject", {}).status_code == 400
    rejected = org_verification._review_sync(_request("admin"), request_id, "reject", {"note": "Ảnh mờ"})
    assert rejected.status_code == 200
    status = _body(org_verification._verification_status_sync(_request("owner", org_id), SimpleNamespace(user_id="owner")))
    assert status["request"]["status"] == "rejected" and status["request"]["reviewNote"] == "Ảnh mờ"

    assert _submit("owner", org_id).status_code == 200
    cancelled, storage_key = org_verification._cancel_verification_sync(_request("owner", org_id), SimpleNamespace(user_id="owner"))
    assert cancelled.status_code == 200 and storage_key


def test_uploads_are_checked_by_content_and_restricted_to_managers(verification_db):
    org_id = _body(_create("owner", "0101234567", "key-owner-6"))["organization"]["id"]
    with pytest.raises(org_verification.VerificationInputError):
        _submit("owner", org_id, filename="giay.pdf", content=b"<html>not a pdf</html>")
    with pytest.raises(org_verification.VerificationInputError):
        _submit("owner", org_id, filename="giay.exe", content=PDF)
    stranger = _submit("squatter", org_id)
    assert stranger.status_code == 403
    assert not list(verification_db.root.rglob("*.pdf"))
