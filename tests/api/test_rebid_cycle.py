import sqlite3

from backend.sync.ownership import validate_owner_scoped_references


def test_rebid_chain_cannot_point_back_to_a_descendant():
    connection = sqlite3.connect(":memory:")
    connection.execute("""
        CREATE TABLE goi_thau (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            archived_at TEXT,
            trang_thai TEXT,
            rebid_from_package_id TEXT
        )
    """)
    connection.executemany(
        "INSERT INTO goi_thau VALUES (?, 'org-1', NULL, 'Hủy thầu', ?)",
        [("package-a", None), ("package-b", "package-a")],
    )

    errors = validate_owner_scoped_references(
        connection.cursor(),
        "org-1",
        "goi_thau",
        {
            "id": "package-a",
            "isRebid": 1,
            "rebidFromPackageId": "package-b",
        },
    )

    assert "Chuỗi đấu thầu lại không được tạo vòng tham chiếu." in errors
