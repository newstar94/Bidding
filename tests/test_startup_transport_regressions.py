import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

from backend import app as app_module
from backend.http_middleware import ResponseIntegrityMiddleware, SecurityHeadersMiddleware


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


def test_development_index_aliases_never_expose_template_placeholders():
    probe = """
import asyncio
import httpx2 as httpx
from backend.app import app

async def main():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url='http://testserver') as client:
        for path in ('/index.html', '/views/index.html'):
            response = await client.get(path)
            body = response.text
            print(path, response.status_code, '__BF_' in body)
            if response.status_code != 200 or '__BF_' in body:
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


def _response_headers_for(
    path: str,
    query_string: bytes = b"",
    *,
    status_code: int = 200,
) -> dict[str, str]:
    messages = []

    async def inner_app(_scope, _receive, send):
        await send({
            "type": "http.response.start",
            "status": status_code,
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
        "query_string": query_string,
        "headers": [],
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 1234),
    }
    middleware = SecurityHeadersMiddleware(ResponseIntegrityMiddleware(inner_app))
    asyncio.run(middleware(scope, receive, send))
    return {
        name.decode("latin-1").lower(): value.decode("latin-1")
        for name, value in messages[0]["headers"]
    }


def test_static_response_preserves_content_length():
    headers = _response_headers_for("/dist/assets/app-12345678.js")
    assert headers["content-length"] == "4"


def test_manual_static_version_query_requires_revalidation():
    headers = _response_headers_for("/vendor/route-shell.js", b"v=2.0")

    assert headers["cache-control"] == "public, max-age=0, must-revalidate"


def test_content_hash_static_version_is_immutable():
    headers = _response_headers_for(
        "/vendor/route-shell.js",
        f"v={'a' * 64}".encode("ascii"),
    )

    assert headers["cache-control"] == "public, max-age=31536000, immutable"


def test_missing_content_hashed_dist_asset_is_not_cached_immutably():
    asset_path = "/dist/assets/app-12345678.js"

    existing_headers = _response_headers_for(asset_path, status_code=200)
    missing_headers = _response_headers_for(asset_path, status_code=404)

    assert existing_headers["cache-control"] == "public, max-age=31536000, immutable"
    assert missing_headers["cache-control"] == "no-store"


def test_content_hash_webp_version_is_immutable():
    headers = _response_headers_for(
        "/assets/app-brand-icon.webp",
        f"v={'b' * 64}".encode("ascii"),
    )

    assert headers["cache-control"] == "public, max-age=31536000, immutable"


def test_dynamic_response_keeps_defensive_chunked_framing():
    headers = _response_headers_for("/api/example")
    assert "content-length" not in headers


def test_bundle_mode_preloads_app_graph_and_authenticated_workspace_entry(monkeypatch, tmp_path):
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
    ]


def test_production_preloads_app_graph_and_authenticated_workspace_entry(monkeypatch, tmp_path):
    dist_root = tmp_path / "dist"
    assets_directory = dist_root / "assets"
    assets_directory.mkdir(parents=True)
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
    for entry in manifest.values():
        (dist_root / entry["file"]).write_text("export {};", encoding="utf-8")
    frontend_assets = SimpleNamespace(manifest=manifest, dist_root=dist_root)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", True)
    monkeypatch.setattr(
        app_module,
        "assert_production_frontend_ready",
        lambda _project_root: frontend_assets,
    )

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
    ]


def test_secure_html_uses_one_hashed_stylesheet(monkeypatch, tmp_path):
    views_directory = tmp_path / "views"
    manifest_directory = tmp_path / "dist" / ".vite"
    views_directory.mkdir(parents=True)
    manifest_directory.mkdir(parents=True)
    index_path = views_directory / "index.html"
    index_path.write_text(
        """<html><head>
<link rel="preload" href="/vendor/fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/vendor/fonts/plus-jakarta-sans-vietnamese.woff2" as="font" type="font/woff2" crossorigin>
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
    assert '/vendor/fonts/plus-jakarta-sans-latin.woff2' not in compiled
    assert '/vendor/fonts/plus-jakarta-sans-vietnamese.woff2' not in compiled


def test_backend_debug_can_use_hashed_frontend_bundle(monkeypatch, tmp_path):
    views_directory = tmp_path / "views"
    manifest_directory = tmp_path / "dist" / ".vite"
    views_directory.mkdir(parents=True)
    manifest_directory.mkdir(parents=True)
    index_path = views_directory / "index.html"
    index_path.write_text(
        """<html><head>
<meta name="bf-app-debug" content="true">
<link rel="stylesheet" href="/css/base.css?v=2.0">
</head><body><script type="module" src="/frontend/app/app.js?v=2.3"></script></body></html>
""",
        encoding="utf-8",
    )
    (manifest_directory / "manifest.json").write_text(
        json.dumps({
            "frontend/app/app.js": {
                "file": "assets/app-debug-12345678.js",
                "css": ["assets/app-debug-12345678.css"],
            },
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(app_module, "APP_DEBUG", True)
    monkeypatch.setattr(app_module, "FRONTEND_ASSET_MODE", "bundle")
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)

    compiled = app_module.compile_html(str(index_path))

    assert '/dist/assets/app-debug-12345678.js' in compiled
    assert '/dist/assets/app-debug-12345678.css' in compiled
    assert '<meta name="bf-app-debug" content="false">' in compiled
    assert '/frontend/app/app.js' not in compiled


def test_runtime_asset_mode_switch_invalidates_the_transport_choice(monkeypatch, tmp_path):
    views_directory = tmp_path / "views"
    manifest_directory = tmp_path / "dist" / ".vite"
    views_directory.mkdir(parents=True)
    manifest_directory.mkdir(parents=True)
    index_path = views_directory / "index.html"
    index_path.write_text(
        '<html><head><link rel="stylesheet" href="/css/base.css"></head>'
        '<body><script type="module" src="/frontend/app/app.js"></script></body></html>',
        encoding="utf-8",
    )
    (manifest_directory / "manifest.json").write_text(json.dumps({
        "frontend/app/app.js": {"file": "assets/app-debug-12345678.js"},
    }), encoding="utf-8")
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "APP_DEBUG", True)
    monkeypatch.setattr(app_module, "FRONTEND_ASSET_MODE", "source")
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)

    source = app_module.compile_html(str(index_path))
    assert "/frontend/app/app.js" in source
    assert "/dist/assets/app-debug-12345678.js" not in source

    monkeypatch.setattr(app_module, "FRONTEND_ASSET_MODE", "bundle")
    bundled = app_module.compile_html(str(index_path))
    assert "/dist/assets/app-debug-12345678.js" in bundled
    assert "/frontend/app/app.js" not in bundled


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


def test_foreground_sync_does_not_show_full_loader_after_startup():
    source = (Path(app_module.project_root) / "frontend" / "app" / "SyncPullService.js").read_text(
        encoding="utf-8"
    )
    assert "!controller?._initialSyncStarted" in source


def test_active_role_switch_stays_in_spa_without_location_reload():
    source = (Path(app_module.project_root) / "frontend" / "admin" / "AdminUserController.js").read_text(
        encoding="utf-8"
    )
    lifecycle_source = (
        Path(app_module.project_root)
        / "frontend"
        / "app"
        / "WorkspaceLifecycleController.js"
    ).read_text(encoding="utf-8")
    role_block = source.split('bindAdminEvent(document, "click", "switch-active-role"', 1)[1].split(
        'const btnAddEmp', 1
    )[0]
    assert "transitionConfirmedRole" in role_block
    assert "history?.pushState" in lifecycle_source
    assert "window.location.assign" not in role_block
