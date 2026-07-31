import sqlite3

from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.db.upgrades import DB_SCHEMA_VERSION
from backend.documents.package_document_policy import compose_document_sections
from backend.documents.package_document_service import upsert_package_document
from backend.documents.package_document_routes import (
    _document_idempotency_replay,
    _store_document_idempotency,
)


def _document(document_type, *, batch_id=None, filename=None):
    return {
        "id": f"doc:{batch_id or 'package'}:{document_type}",
        "type": document_type,
        "evaluationBatchId": batch_id,
        "originalFilename": filename or f"{document_type}.pdf",
        "sizeBytes": 100,
    }


def test_package_document_schema_supports_batch_scopes():
    spec = SCHEMA_DINH_NGHIA["tai_lieu_goi_thau"]

    assert DB_SCHEMA_VERSION >= 24
    assert "evaluation_batch_id" in spec["columns"]
    assert any(
        "evaluation_batch_id) REFERENCES dot_xu_ly_phan_lo(organization_id, id)"
        in foreign_key
        for foreign_key in spec["foreign_keys"]
    )
    assert not any(
        "goi_thau_id, document_type" in constraint
        for constraint in spec["unique_constraints"]
    )


def test_lot_package_documents_are_isolated_by_evaluation_batch():
    package = {
        "phan_lo": "Có",
        "trang_thai": "PARTIALLY_AWARDED",
        "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
        "yeu_cau_tham_dinh_hsmt": "Không",
    }
    documents = [
        _document("HSMT"),
        _document("BID_EVALUATION_REPORT", batch_id="batch-1", filename="bcdg-1.pdf"),
        _document("RESULT_APPRAISAL_REPORT", batch_id="batch-1", filename="bctd-1.pdf"),
        _document("BID_EVALUATION_REPORT", batch_id="batch-2", filename="bcdg-2.pdf"),
    ]
    batches = [
        {
            "id": "batch-1",
            "sequenceNo": 1,
            "status": "CLOSED",
            "lotIds": ["lot-1", "lot-2"],
            "lotCodes": ["Lô 01", "Lô 02"],
        },
        {
            "id": "batch-2",
            "sequenceNo": 2,
            "status": "ACTIVE",
            "lotIds": ["lot-3"],
            "lotCodes": ["Lô 03"],
        },
    ]

    sections = compose_document_sections(
        package,
        documents,
        batches,
        write_allowed=True,
    )

    assert [section["scopeKey"] for section in sections] == [
        "package",
        "batch:batch-1",
        "batch:batch-2",
    ]
    first_round = sections[1]
    second_round = sections[2]
    assert first_round["lotCodes"] == ["Lô 01", "Lô 02"]
    assert second_round["lotCodes"] == ["Lô 03"]
    assert {
        slot["type"]: slot["document"]["originalFilename"]
        for slot in first_round["slots"]
    } == {
        "BID_EVALUATION_REPORT": "bcdg-1.pdf",
        "RESULT_APPRAISAL_REPORT": "bctd-1.pdf",
    }
    assert not any(slot["canUpload"] for slot in first_round["slots"])
    assert all(slot["canUpload"] for slot in second_round["slots"])
    assert next(
        slot for slot in second_round["slots"]
        if slot["type"] == "BID_EVALUATION_REPORT"
    )["document"]["originalFilename"] == "bcdg-2.pdf"


def test_legacy_evaluation_document_is_preserved_read_only():
    package = {
        "phan_lo": "Có",
        "trang_thai": "EVALUATING",
        "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
        "yeu_cau_tham_dinh_hsmt": "Không",
    }
    legacy = _document("BID_EVALUATION_REPORT", filename="bao-cao-cu.pdf")

    sections = compose_document_sections(
        package,
        [legacy],
        [],
        write_allowed=True,
    )

    legacy_section = next(
        section for section in sections
        if section["scopeType"] == "LEGACY_EVALUATION"
    )
    assert legacy_section["slots"][0]["document"] == legacy
    assert legacy_section["slots"][0]["canUpload"] is False
    assert legacy_section["slots"][0]["canDelete"] is False


def test_two_envelope_batch_exposes_technical_and_financial_document_slots():
    package = {
        "phan_lo": "Có",
        "trang_thai": "EVALUATING",
        "phuong_thuc_lua_chon": "Một giai đoạn hai túi hồ sơ",
        "yeu_cau_tham_dinh_hsmt": "Không",
    }
    sections = compose_document_sections(
        package,
        [],
        [
            {
                "id": "batch-1",
                "sequenceNo": 1,
                "status": "ACTIVE",
                "lotIds": ["lot-1"],
                "lotCodes": ["Lô 01"],
            }
        ],
        write_allowed=True,
    )
    batch_slots = next(
        section["slots"]
        for section in sections
        if section["scopeType"] == "EVALUATION_BATCH"
    )

    assert [slot["type"] for slot in batch_slots] == [
        "TECHNICAL_EVALUATION_REPORT",
        "TECHNICAL_APPRAISAL_REPORT",
        "FINANCIAL_EVALUATION_REPORT",
        "RESULT_APPRAISAL_REPORT",
    ]
    assert all(slot["evaluationBatchId"] == "batch-1" for slot in batch_slots)
    assert all(slot["canUpload"] for slot in batch_slots)


def test_awarded_package_documents_are_read_only_even_for_managers():
    package = {
        "phan_lo": "Có",
        "trang_thai": "AWARDED",
        "phuong_thuc_lua_chon": "Một giai đoạn một túi hồ sơ",
        "yeu_cau_tham_dinh_hsmt": "Không",
    }
    sections = compose_document_sections(
        package,
        [_document("HSMT")],
        [
            {
                "id": "batch-1",
                "sequenceNo": 1,
                "status": "CLOSED",
                "lotIds": ["lot-1"],
                "lotCodes": ["Lô 01"],
            }
        ],
        write_allowed=True,
    )

    assert not any(
        slot["canUpload"] or slot["canDelete"]
        for section in sections
        for slot in section["slots"]
    )


def test_upsert_replaces_only_the_same_batch_document_slot():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    cursor = connection.cursor()
    cursor.execute(
        """CREATE TABLE tai_lieu_goi_thau (
               id TEXT PRIMARY KEY,
               organization_id TEXT NOT NULL,
               owner_type TEXT NOT NULL,
               goi_thau_id TEXT NOT NULL,
               evaluation_batch_id TEXT,
               document_type TEXT NOT NULL,
               original_filename TEXT NOT NULL,
               storage_key TEXT NOT NULL,
               content_type TEXT NOT NULL,
               size_bytes INTEGER NOT NULL,
               sha256 TEXT NOT NULL,
               uploaded_by_id TEXT,
               uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
               created_at TEXT DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    cursor.execute(
        """CREATE UNIQUE INDEX idx_general
           ON tai_lieu_goi_thau (
               organization_id, goi_thau_id, document_type
           ) WHERE evaluation_batch_id IS NULL"""
    )
    cursor.execute(
        """CREATE UNIQUE INDEX idx_batch
           ON tai_lieu_goi_thau (
               organization_id, goi_thau_id,
               evaluation_batch_id, document_type
           ) WHERE evaluation_batch_id IS NOT NULL"""
    )
    package = {"id": "package-1", "owner_type": "organization"}

    def upload(batch_id, filename, storage_key):
        return upsert_package_document(
            cursor,
            organization_id="org-1",
            package=package,
            document_type="BID_EVALUATION_REPORT",
            original_filename=filename,
            storage_key=storage_key,
            content_type="application/pdf",
            size_bytes=100,
            sha256="a" * 64,
            uploaded_by_id="user-1",
            evaluation_batch_id=batch_id,
        )

    first, replaced = upload("batch-1", "bcdg-1.pdf", "one.pdf")
    second, second_replaced = upload("batch-2", "bcdg-2.pdf", "two.pdf")
    replacement, previous = upload("batch-1", "bcdg-1-moi.pdf", "one-new.pdf")

    assert replaced is None
    assert second_replaced is None
    assert previous["id"] == first["id"]
    assert replacement["id"] == first["id"]
    assert second["id"] != first["id"]
    rows = cursor.execute(
        """SELECT evaluation_batch_id, original_filename
           FROM tai_lieu_goi_thau
           ORDER BY evaluation_batch_id"""
    ).fetchall()
    assert [tuple(row) for row in rows] == [
        ("batch-1", "bcdg-1-moi.pdf"),
        ("batch-2", "bcdg-2.pdf"),
    ]
    connection.close()


class _IdempotencyCursor:
    def __init__(self):
        self.stored = None
        self.current = None

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        if normalized.startswith("INSERT INTO api_idempotency"):
            self.stored = tuple(params)
            self.current = None
        elif normalized.startswith("SELECT response_json"):
            self.current = (self.stored[3],) if self.stored else None
        else:
            self.current = (None,)
        return self

    def fetchone(self):
        return self.current


def test_document_mutation_idempotency_replays_original_response():
    cursor = _IdempotencyCursor()
    arguments = {
        "actor_user_id": "user-1",
        "operation": "package_document:org-1:package-1:HSMT:general:upload",
        "idempotency_key": "mutation-12345678",
    }
    assert _document_idempotency_replay(cursor, **arguments) is None
    _store_document_idempotency(
        cursor,
        **arguments,
        payload={"success": True, "document": {"id": "document-1"}},
        status_code=201,
    )

    payload, status_code = _document_idempotency_replay(cursor, **arguments)

    assert status_code == 201
    assert payload == {"success": True, "document": {"id": "document-1"}}
