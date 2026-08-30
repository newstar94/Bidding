import socket
from threading import Thread
import time
from types import SimpleNamespace
from pathlib import Path

import subprocess
from starlette.applications import Starlette
from starlette.responses import FileResponse, HTMLResponse
from starlette.routing import Route
import uvicorn

from backend.db.upgrades import DB_SCHEMA_VERSION, apply_database_upgrades
from backend.product_analytics.aggregation import refresh_product_analytics
from backend.product_analytics import routes as analytics_routes
from tests.test_postgres_migration_chain import (
    _close_fixture_connection,
    _open_fixture_connection,
    _upgrade_context,
)


def test_real_backend_browser_analytics_journey(monkeypatch):
    connection, cursor, schema_name = _open_fixture_connection()
    server = None
    thread = None
    socket_handle = None
    try:
        assert apply_database_upgrades(cursor, 1, _upgrade_context()) == DB_SCHEMA_VERSION
        release_id = cursor.execute(
            "SELECT id FROM commercial_releases ORDER BY created_at LIMIT 1"
        ).fetchone()[0]
        epoch = 1_788_055_200  # 2026-08-30 09:00 Asia/Ho_Chi_Minh.
        cursor.execute(
            "INSERT INTO to_chuc (id, ten_to_chuc) VALUES ('e2e-org', 'Analytics E2E')"
        )
        cursor.execute(
            """INSERT INTO tai_khoan
                 (id,ten_dang_nhap,username_norm,mat_khau,ho_ten,email,email_norm,
                  vai_tro,da_xac_minh)
               VALUES ('e2e-user','analytics-e2e','analytics-e2e','hash',
                       'Analytics E2E','analytics-e2e@example.test',
                       'analytics-e2e@example.test','user',1)"""
        )
        cursor.execute(
            """INSERT INTO product_usage_hourly
               (window_started_at,user_id,organization_id,owner_type,metric_key,
                feature_key,event_count,first_seen_at,last_seen_at)
               VALUES (?, 'e2e-user', 'e2e-org', 'organization',
                       'feature.used', 'plans', 3, ?, ?)""",
            (epoch, epoch, epoch),
        )
        refresh_product_analytics(
            cursor, from_date="2026-08-30", to_date="2026-08-30",
            hmac_key="analytics-browser-e2e-key",
        )
        cursor.execute(
            "UPDATE workspace_usage_daily SET commercial_release_id=?",
            (release_id,),
        )

        class ConnectionProxy:
            def cursor(self):
                return cursor

            def close(self):
                return None

        async def database_read(function, *args, **_kwargs):
            return function(*args)

        def verify(request, required_role=None):
            allowed = request.cookies.get("analytics_role") == "super_admin"
            if required_role == "super_admin" and not allowed:
                return False, "SUPER_ADMIN_REQUIRED"
            return True, SimpleNamespace(user_id="analytics-e2e")

        monkeypatch.setattr(analytics_routes, "run_database_read", database_read)
        monkeypatch.setattr(analytics_routes, "verify_session", verify)
        monkeypatch.setattr(
            analytics_routes, "database",
            SimpleNamespace(get_connection=lambda: ConnectionProxy()),
        )

        async def index(_request):
            template = Path("views/tabs/tab_usage_analytics.html").read_text(encoding="utf-8")
            return HTMLResponse(f"<!doctype html><html lang='vi'><body>{template}</body></html>")

        async def frontend_file(request):
            return FileResponse(f"frontend/{request.path_params['path']}")

        app = Starlette(routes=[
            Route("/", index),
            Route("/frontend/{path:path}", frontend_file),
            *analytics_routes.product_analytics_routes(Route),
        ])
        socket_handle = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        socket_handle.bind(("127.0.0.1", 0))
        socket_handle.listen(2048)
        port = socket_handle.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(
            app, log_level="error", lifespan="off", ws="none",
        ))
        thread = Thread(target=server.run, kwargs={"sockets": [socket_handle]}, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started

        completed = subprocess.run(
            [
                "node", "tests/fixtures/product_analytics_browser_journey.mjs",
                f"http://127.0.0.1:{port}", release_id,
            ],
            cwd=Path.cwd(), check=False, capture_output=True, text=True, timeout=90,
        )
        assert completed.returncode == 0, completed.stdout + completed.stderr
    finally:
        if server:
            server.should_exit = True
        if thread:
            thread.join(timeout=10)
        if socket_handle:
            socket_handle.close()
        _close_fixture_connection(connection, cursor, schema_name)
