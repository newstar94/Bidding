import sqlite3


def _details(connection, sql, params):
    return " ".join(
        str(row[3]) for row in connection.execute(f"EXPLAIN QUERY PLAN {sql}", params)
    )


def test_large_list_filters_and_latest_dashboard_use_indexes():
    connection = sqlite3.connect(":memory:")
    connection.executescript(
        """
        CREATE TABLE ke_hoach_lcnt (
            id TEXT PRIMARY KEY,
            organization_id TEXT NOT NULL,
            is_latest INTEGER NOT NULL,
            archived_at TEXT,
            ngay_phe_duyet TEXT
        );
        CREATE INDEX idx_ke_hoach_lcnt_latest_date
            ON ke_hoach_lcnt (organization_id, is_latest, archived_at, ngay_phe_duyet);
        CREATE INDEX idx_ke_hoach_lcnt_latest_month
            ON ke_hoach_lcnt (
                organization_id, is_latest, archived_at, substr(ngay_phe_duyet, 6, 2)
            );
        """
    )
    connection.executemany(
        "INSERT INTO ke_hoach_lcnt VALUES (?, ?, 1, NULL, ?)",
        (
            (f"plan-{index}", f"org-{index % 4}", f"202{index % 7}-{index % 12 + 1:02d}-15")
            for index in range(10_000)
        ),
    )
    connection.execute("ANALYZE")

    range_plan = _details(
        connection,
        """
        SELECT id FROM ke_hoach_lcnt
        WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL
          AND ngay_phe_duyet >= ? AND ngay_phe_duyet < ?
        """,
        ("org-1", "2026-01-01", "2027-01-01"),
    )
    month_plan = _details(
        connection,
        """
        SELECT id FROM ke_hoach_lcnt
        WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL
          AND substr(ngay_phe_duyet, 6, 2) = ?
        """,
        ("org-1", "07"),
    )
    latest_plan = _details(
        connection,
        """
        SELECT COUNT(*) FROM ke_hoach_lcnt
        WHERE organization_id = ? AND is_latest = 1 AND archived_at IS NULL
        """,
        ("org-1",),
    )
    connection.close()

    assert "idx_ke_hoach_lcnt_latest_date" in range_plan
    assert "idx_ke_hoach_lcnt_latest_month" in month_plan
    assert "idx_ke_hoach_lcnt_latest_" in latest_plan
    assert "SCAN ke_hoach_lcnt" not in range_plan
    assert "SCAN ke_hoach_lcnt" not in month_plan
