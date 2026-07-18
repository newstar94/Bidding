from backend.app import app  # noqa: F401 - initializes backend import paths
from backend.db.schema import SCHEMA_DINH_NGHIA
from backend.sync.payload_validation import validate_sync_item


def test_partner_effective_date_is_required_by_canonical_schema():
    for table_name in ("chu_dau_tu", "nha_thau"):
        column = SCHEMA_DINH_NGHIA[table_name]["columns"]["ngay_ap_dung"]
        assert "NOT NULL" in column
        assert "DEFAULT" in column


def test_missing_effective_date_defaults_from_version_creation_date():
    item, errors, _ = validate_sync_item(
        "nha_thau",
        {
            "tenNhaThau": "Nhà thầu A",
            "createdAt": "2026-05-04 10:30:00",
        },
    )

    assert not errors
    assert item["ngayApDung"] == "2026-05-04"
