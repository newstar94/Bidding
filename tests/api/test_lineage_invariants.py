import sqlite3

import pytest

from backend.db.db_utils import _build_create_table_sql, _create_baseline_indexes_and_triggers
from backend.db.schema import SCHEMA_DINH_NGHIA


def test_version_lineage_is_filled_once_and_then_immutable():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    for table_name, table_spec in SCHEMA_DINH_NGHIA.items():
        connection.execute(_build_create_table_sql(table_name, table_spec))
    _create_baseline_indexes_and_triggers(connection.cursor())
    connection.execute(
        "INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('org-1', 'Organization 1')"
    )

    connection.execute(
        """
        INSERT INTO chuyen_gia (id, organization_id, ho_ten)
        VALUES ('expert-root', 'org-1', 'Nguyễn Văn A')
        """
    )
    root = connection.execute(
        "SELECT id_goc FROM chuyen_gia WHERE id = 'expert-root'"
    ).fetchone()[0]
    assert root == "expert-root"

    connection.execute("UPDATE chuyen_gia SET is_latest = 0 WHERE id = 'expert-root'")
    connection.execute(
        """
        INSERT INTO chuyen_gia (
            id, organization_id, id_goc, phien_ban, is_latest, ho_ten
        ) VALUES ('expert-v2', 'org-1', 'expert-root', 1, 1, 'Nguyễn Văn A')
        """
    )
    with pytest.raises(sqlite3.IntegrityError, match="LINEAGE_IMMUTABLE"):
        connection.execute(
            "UPDATE chuyen_gia SET id_goc = 'another-root' WHERE id = 'expert-v2'"
        )
    connection.close()
