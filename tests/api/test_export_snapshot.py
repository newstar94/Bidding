from types import SimpleNamespace

from backend.db.db_helper import SQLiteDatabase
from backend.documents import routes_docx


def _snapshot_database(path, version):
    database = SQLiteDatabase(path)
    conn = database.get_connection()
    try:
        conn.execute(
            "CREATE TABLE sync_metadata (organization_id TEXT PRIMARY KEY, current_version INTEGER NOT NULL)"
        )
        conn.execute(
            "INSERT INTO sync_metadata (organization_id, current_version) VALUES (?, ?)",
            ("org-1", version),
        )
        conn.commit()
    finally:
        conn.close()
    return database


def test_export_requires_snapshot_version(monkeypatch, tmp_path):
    monkeypatch.setattr(
        routes_docx,
        "database",
        _snapshot_database(tmp_path / "missing.db", 4),
    )
    request = SimpleNamespace(query_params={})

    version, response = routes_docx._validate_export_snapshot(request, "org-1")

    assert version is None
    assert response.status_code == 428


def test_export_rejects_stale_snapshot(monkeypatch, tmp_path):
    monkeypatch.setattr(
        routes_docx,
        "database",
        _snapshot_database(tmp_path / "stale.db", 8),
    )
    request = SimpleNamespace(query_params={"snapshotVersion": "7"})

    version, response = routes_docx._validate_export_snapshot(request, "org-1")

    assert version is None
    assert response.status_code == 409


def test_export_accepts_current_snapshot_and_detects_later_change(monkeypatch, tmp_path):
    database = _snapshot_database(tmp_path / "current.db", 9)
    monkeypatch.setattr(routes_docx, "database", database)
    request = SimpleNamespace(query_params={"snapshotVersion": "9"})

    version, response = routes_docx._validate_export_snapshot(request, "org-1")

    assert version == 9
    assert response is None

    conn = database.get_connection()
    try:
        conn.execute(
            "UPDATE sync_metadata SET current_version = 10 WHERE organization_id = 'org-1'"
        )
        conn.commit()
    finally:
        conn.close()

    changed_response = routes_docx._ensure_export_snapshot_unchanged("org-1", version)
    assert changed_response.status_code == 409
