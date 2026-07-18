import asyncio
import json
import sqlite3

from backend.auth import auth_routes


class _Database:
    def __init__(self, path):
        self.path = path

    def get_connection(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection


def test_public_packages_returns_only_active_commercial_plans(monkeypatch, tmp_path):
    database_path = tmp_path / "packages.db"
    connection = sqlite3.connect(database_path)
    connection.execute("""
        CREATE TABLE goi_dich_vu (
            id TEXT PRIMARY KEY,
            ten_goi TEXT,
            gia_ca INTEGER NOT NULL,
            han_muc_nhan_su INTEGER NOT NULL,
            mo_ta TEXT,
            trang_thai TEXT NOT NULL
        )
    """)
    connection.executemany(
        "INSERT INTO goi_dich_vu VALUES (?, ?, ?, ?, ?, ?)",
        [
            ("diamond", "Gói Kim Cương", 75_000_000, 999, "Quy mô lớn", "active"),
            ("silver", "Gói Bạc", 15_000_000, 5, "Quy mô nhỏ", "active"),
            ("retired", "Gói cũ", 1, 1, "Không còn bán", "inactive"),
            ("gold", "Gói Vàng", 35_000_000, 15, "Phòng thầu", "active"),
        ],
    )
    connection.commit()
    connection.close()
    monkeypatch.setattr(auth_routes, "database", _Database(database_path))

    response = asyncio.run(auth_routes.list_public_packages_api(object()))
    payload = json.loads(response.body)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=300"
    assert [package["id"] for package in payload["packages"]] == ["silver", "gold", "diamond"]
    assert payload["packages"][1]["price"] == "35000000"
    assert all("status" not in package for package in payload["packages"])
