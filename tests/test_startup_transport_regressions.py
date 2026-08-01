import asyncio
import json
import os
import subprocess
import sys

from backend import app as app_module
from backend.http_middleware import ResponseIntegrityMiddleware


def test_development_server_serves_shared_timeline_catalog():
    probe = """
import asyncio
import httpx2 as httpx
from backend.app import app

async def main():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://testserver') as client:
        response = await client.get('/shared/timeline_rules.json')
        print(response.status_code, response.headers.get('content-type', ''))
        if response.status_code != 200 or response.json().get('catalogVersion') != 2:
            raise SystemExit(1)

asyncio.run(main())
"""
    environment = os.environ.copy()
    environment.update(
        {
            "APP_DEBUG": "True",
            "APP_ENV": "test",
            "ALLOWED_HOSTS": "testserver",
        }
    )
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=os.getcwd(),
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr


def _response_headers_for(path: str) -> dict[str, str]:
    messages = []

    async def inner_app(_scope, _receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"application/javascript"),
                (b"content-length", b"4"),
            ],
        })
        await send({"type": "http.response.body", "body": b"test", "more_body": False})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "query_string": b"",
        "headers": [],
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 1234),
    }
    asyncio.run(ResponseIntegrityMiddleware(inner_app)(scope, receive, send))
    return {
        name.decode("latin-1").lower(): value.decode("latin-1")
        for name, value in messages[0]["headers"]
    }


def test_static_response_preserves_content_length():
    headers = _response_headers_for("/dist/assets/app-12345678.js")
    assert headers["content-length"] == "4"


def test_dynamic_response_keeps_defensive_chunked_framing():
    headers = _response_headers_for("/api/example")
    assert "content-length" not in headers


def test_production_preloads_hashed_app_before_authenticated_workspace(monkeypatch, tmp_path):
    manifest_directory = tmp_path / "dist" / ".vite"
    manifest_directory.mkdir(parents=True)
    manifest = {
        "frontend/app/app.js": {
            "file": "assets/app-12345678.js",
            "imports": ["_app-shared.js"],
        },
        "_app-shared.js": {"file": "assets/app-shared-12345678.js"},
        "frontend/app/workspaceBootstrap.js": {
            "file": "assets/workspace-12345678.js",
            "imports": ["_workspace-shared.js"],
        },
        "_workspace-shared.js": {"file": "assets/workspace-shared-12345678.js"},
    }
    (manifest_directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    anonymous = app_module._workspace_preload_tag({"valid": False})
    authenticated = app_module._workspace_preload_tag({"valid": True})

    assert anonymous.splitlines() == [
        '<link rel="modulepreload" href="/dist/assets/app-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/app-shared-12345678.js">',
    ]
    assert authenticated.splitlines() == [
        '<link rel="modulepreload" href="/dist/assets/app-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/app-shared-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/workspace-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/workspace-shared-12345678.js">',
    ]


def test_secure_html_uses_one_hashed_stylesheet(monkeypatch, tmp_path):
    views_directory = tmp_path / "views"
    manifest_directory = tmp_path / "dist" / ".vite"
    views_directory.mkdir(parents=True)
    manifest_directory.mkdir(parents=True)
    index_path = views_directory / "index.html"
    index_path.write_text(
        """<html><head>
<link rel="stylesheet" href="/css/base.css?v=2.0">
<link rel="stylesheet" href="/css/runtime-styles.css?v=2.0" data-runtime-styles>
</head><body><script type="module" src="/frontend/app/app.js?v=2.0"></script></body></html>
""",
        encoding="utf-8",
    )
    manifest = {
        "frontend/app/app.js": {
            "file": "assets/app-12345678.js",
            "css": ["assets/styles-12345678.css"],
        },
    }
    (manifest_directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)

    compiled = app_module.compile_html(str(index_path))

    assert '/dist/assets/styles-12345678.css' in compiled
    assert 'data-runtime-styles' in compiled
    assert '/css/base.css' not in compiled
    assert '/css/runtime-styles.css' not in compiled


def test_frontend_prewarm_reads_only_manifest_assets_inside_dist(monkeypatch, tmp_path):
    dist_directory = tmp_path / "dist"
    manifest_directory = dist_directory / ".vite"
    assets_directory = dist_directory / "assets"
    manifest_directory.mkdir(parents=True)
    assets_directory.mkdir()
    (assets_directory / "app-12345678.js").write_bytes(b"app")
    (assets_directory / "shared-12345678.js").write_bytes(b"shared")
    (assets_directory / "styles-12345678.css").write_bytes(b"styles")
    manifest = {
        "frontend/app/app.js": {
            "file": "assets/app-12345678.js",
            "imports": ["_shared.js"],
            "css": ["assets/styles-12345678.css"],
        },
        "_shared.js": {"file": "assets/shared-12345678.js"},
        "frontend/app/workspaceBootstrap.js": {"file": "../outside.js"},
    }
    (manifest_directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "outside.js").write_bytes(b"outside")
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    warmed_files, warmed_bytes = app_module._prewarm_frontend_assets()

    assert warmed_files == 3
    assert warmed_bytes == len(b"appsharedstyles")
