import json
import sqlite3

from backend.db.db_utils import _build_create_table_sql
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.sync.mapper import attach_child_rows, save_child_payloads
from backend.sync.payload_validation import validate_sync_payload_shape


def _database():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        connection.execute(_build_create_table_sql(table_name, table_spec))
    return connection


def test_evaluation_metadata_requires_version_and_size_contract():
    base = {"id": "package-1", "organizationId": "org-1", "tenGoiThau": "Package"}
    missing_version = validate_sync_payload_shape({
        "goithau": [{**base, "danhGiaHsdtMetadata": json.dumps({"saved": True})}]
    })
    assert any(error["code"] == "INVALID_EVALUATION_METADATA" for error in missing_version)

    valid = validate_sync_payload_shape({
        "goithau": [{
            **base,
            "danhGiaHsdtMetadata": json.dumps({"schemaVersion": 1, "saved": True}),
        }]
    })
    assert not [error for error in valid if error["field"].endswith("danhGiaHsdtMetadata")]

    connection = _database()
    package_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(goi_thau)").fetchall()
    }
    assert "danh_gia_hsdt_metadata" not in package_columns
    connection.close()


def test_rounds_criteria_and_bid_results_are_normalized_and_rehydrated():
    connection = _database()
    cursor = connection.cursor()
    metadata = {
        "schemaVersion": 1,
        "is1G2T": True,
        "technical": {
            "saved": True,
            "qualifiedSaved": True,
            "soBaoCao": "BC-01",
            "ngayBaoCao": "2026-07-14",
            "criteria": [{"code": "KT-01", "name": "Kỹ thuật", "maxScore": 100}],
            "cvLamRo": [{"soCv": "CV-01"}],
        },
        "financial": {"saved": False},
    }
    save_child_payloads(
        cursor, "goi_thau",
        {"id": "package-1", "danhGiaHsdtMetadata": json.dumps(metadata)},
        "org-1", "organization", 3, "2026-07-14 10:00:00",
    )
    save_child_payloads(
        cursor, "thong_tin_mo_thau",
        {
            "id": "opening-1", "goiThauId": "package-1",
            "danhGiaHopLe": "Đạt", "danhGiaKyThuat": "Đạt",
            "danhGiaKetLuan": "Đạt", "diemDanhGia": 92.5,
        },
        "org-1", "organization", 3, "2026-07-14 10:00:00",
    )

    assert cursor.execute("SELECT count(*) FROM vong_danh_gia").fetchone()[0] == 2
    assert cursor.execute("SELECT count(*) FROM tieu_chi_danh_gia").fetchone()[0] == 1
    technical_extension = json.loads(cursor.execute(
        "SELECT extension_json FROM vong_danh_gia WHERE loai_vong = 'technical'"
    ).fetchone()[0])
    assert technical_extension == {
        "cvLamRo": [{"soCv": "CV-01"}],
        "schemaVersion": 1,
    }
    criterion_extension = json.loads(cursor.execute(
        "SELECT extension_json FROM tieu_chi_danh_gia"
    ).fetchone()[0])
    assert criterion_extension == {"schemaVersion": 1}
    result = cursor.execute("SELECT * FROM ket_qua_danh_gia_nha_thau").fetchone()
    assert result["danh_gia_hop_le"] == "Đạt"
    assert result["diem"] == 92.5

    package = {"id": "package-1", "danhGiaHsdtMetadata": '{"schemaVersion":1}'}
    attach_child_rows(cursor, "goi_thau", package, organization_id="org-1")
    restored = json.loads(package["danhGiaHsdtMetadata"])
    assert restored["technical"]["saved"] is True
    assert restored["technical"]["criteria"][0]["code"] == "KT-01"
    assert restored["technical"]["cvLamRo"] == [{"soCv": "CV-01"}]

    opening = {"id": "opening-1"}
    attach_child_rows(cursor, "thong_tin_mo_thau", opening, organization_id="org-1")
    assert opening["danhGiaHopLe"] == "Đạt"
    assert opening["diemDanhGia"] == 92.5
    connection.close()
