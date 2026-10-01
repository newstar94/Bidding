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


def _source_preload_fixture(tmp_path):
    sources = {
        app_module.APP_ENTRY: '''
            import { shared } from "../shared/app-shared.js";
            const workspace = () => import("./workspaceBootstrap.js");
            const auth = () => import("../auth/AuthShell.js");
        ''',
        app_module._WORKSPACE_ENTRY: '''
            import { runtime } from "../shared/workspace-runtime.js";
            const assistant = () => import("../assistant/AssistantLoader.js");
        ''',
        app_module._AUTH_SHELL_ENTRY: '''
            import { auth } from "./auth-shared.js";
            const workspace = () => import("../app/workspaceBootstrap.js");
        ''',
        "frontend/app/BiddingModel.js": '''
            import { storage } from "../shared/storage.js";
        ''',
        "frontend/app/BiddingView.js": '''
            const route = () => import("./PlanView.js");
        ''',
        "frontend/app/BiddingControllerForms.js": '''
            const workflow = () => import("../plans/PlanModalController.js");
        ''',
        "frontend/shared/storage.js": '''
            export { nested } from "./storage-nested.js";
        ''',
        "frontend/app/DashboardView.js": '''
            import { chart } from "../shared/dashboard-chart.js";
            const workflow = () => import("../plans/PlanModalController.js");
        ''',
        "frontend/plans/KeHoachView.js": '''
            import { rows } from "../shared/plan-rows.js";
            const workflow = () => import("./PlanModalController.js");
        ''',
    }
    fixture_paths = set(sources) | set(app_module._REQUIRED_WORKSPACE_STARTUP_ENTRIES) | {
        "frontend/shared/app-shared.js", "frontend/shared/workspace-runtime.js",
        "frontend/shared/storage-nested.js", "frontend/auth/auth-shared.js",
        "frontend/app/PlanView.js", "frontend/plans/PlanModalController.js",
        "frontend/assistant/AssistantLoader.js",
        "frontend/shared/dashboard-chart.js", "frontend/shared/plan-rows.js",
        "frontend/app/DashboardView.css",
    }
    for relative in fixture_paths:
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(sources.get(relative, "export const available = true;"), encoding="utf-8")


def test_source_authenticated_preloads_static_transitive_graph_without_dynamic_workflows(monkeypatch, tmp_path):
    _source_preload_fixture(tmp_path)
    monkeypatch.setattr(app_module, "APP_DEBUG", True)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "FRONTEND_ASSET_MODE", "source")
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    tags = app_module._workspace_preload_tag({"valid": True}, "/ke-hoach")

    assert '<link rel="modulepreload" href="/frontend/shared/app-shared.js">' in tags
    assert '<link rel="modulepreload" href="/frontend/shared/workspace-runtime.js">' in tags
    assert '<link rel="modulepreload" href="/frontend/shared/storage-nested.js">' in tags
    assert "KeHoachView.js" not in tags
    assert "plan-rows.js" not in tags
    for entry in (app_module._WORKSPACE_ENTRY, *app_module._REQUIRED_WORKSPACE_STARTUP_ENTRIES):
        assert f'<link rel="modulepreload" href="/{entry}">' in tags
    for deferred in ("frontend/app/PlanView.js", "frontend/plans/PlanModalController.js",
                     "frontend/assistant/AssistantLoader.js", app_module._AUTH_SHELL_ENTRY):
        assert f'href="/{deferred}"' not in tags
    assert "DashboardView.js" not in tags
    assert "dashboard-chart.js" not in tags
    assert 'as="style"' not in tags
    # The existing versioned script/preload remains the single app entry URL.
    assert 'href="/frontend/app/app.js"' not in tags
    assert len(tags.splitlines()) == len(set(tags.splitlines()))
    # The measured initial-view hint is limited to the exact dashboard route.
    # Opening a create route must keep workflow dependencies click-owned.
    create_tags = app_module._workspace_preload_tag({"valid": True}, "/ke-hoach/tao-moi")
    assert create_tags == tags


def test_source_initial_dashboard_preloads_only_requested_view_graph_and_fetches_style(monkeypatch, tmp_path):
    _source_preload_fixture(tmp_path)
    monkeypatch.setattr(app_module, "APP_DEBUG", True)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "FRONTEND_ASSET_MODE", "source")
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    tags = app_module._workspace_preload_tag({"valid": True}, "/tong-quan")

    assert '<link rel="modulepreload" href="/frontend/app/DashboardView.js">' in tags
    assert '<link rel="modulepreload" href="/frontend/shared/dashboard-chart.js">' in tags
    assert '<link rel="preload" href="/frontend/app/DashboardView.css" as="style">' in tags
    assert 'rel="stylesheet"' not in tags
    for deferred in ("KeHoachView.js", "plan-rows.js", "PlanModalController.js",
                     "PlanView.js", "AssistantLoader.js", "AuthShell.js"):
        assert deferred not in tags


def test_source_anonymous_auth_preloads_do_not_expand_workspace_runtime(monkeypatch, tmp_path):
    _source_preload_fixture(tmp_path)
    monkeypatch.setattr(app_module, "APP_DEBUG", True)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "FRONTEND_ASSET_MODE", "source")
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    for path in ("/dang-nhap", "/tong-quan", "/ke-hoach", "/ke-hoach/tao-moi"):
        tags = app_module._workspace_preload_tag({"valid": False}, path)
        assert tags.splitlines() == [
            '<link rel="modulepreload" href="/frontend/auth/AuthShell.js">',
            '<link rel="modulepreload" href="/frontend/shared/app-shared.js">',
            '<link rel="modulepreload" href="/frontend/auth/auth-shared.js">',
        ]
        for workspace_entry in (app_module._WORKSPACE_ENTRY, *app_module._REQUIRED_WORKSPACE_STARTUP_ENTRIES):
            assert f'href="/{workspace_entry}"' not in tags
        for initial_view in ("DashboardView.js", "DashboardView.css", "KeHoachView.js",
                             "dashboard-chart.js", "plan-rows.js"):
            assert initial_view not in tags
        assert "workspace-runtime.js" not in tags
        assert 'href="/frontend/app/app.js"' not in tags


def test_index_revalidates_html_when_preload_representation_changes(monkeypatch):
    template = (
        '<html><head>__BF_WORKSPACE_PRELOAD__</head>'
        '<body>__BF_SESSION_BOOTSTRAP__</body></html>'
    )
    current_preload = ['<link rel="modulepreload" href="/frontend/shared/old.js">']
    bootstrap_reads = []

    async def read_session(_function, request):
        bootstrap_reads.append(request)
        return {"valid": True, "user": {"id": "fixture-user"}}

    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "_build_index_response_payload", lambda: (template, '"same-template"'))
    monkeypatch.setattr(app_module, "_page_shell", lambda body, _path: body)
    monkeypatch.setattr(app_module, "_page_bundle_stylesheet", lambda body, _path: (body, "same-style"))
    monkeypatch.setattr(app_module, "run_database_read", read_session)
    monkeypatch.setattr(app_module, "_workspace_preload_tag", lambda _session, _path: current_preload[0])

    def request(if_none_match=None):
        headers = {} if if_none_match is None else {"if-none-match": if_none_match}
        return SimpleNamespace(url=SimpleNamespace(path="/ke-hoach"), headers=headers)

    first = asyncio.run(app_module.index(request()))
    assert first.status_code == 200
    old_etag = first.headers["etag"]
    assert current_preload[0] in first.body.decode("utf-8")

    unchanged = asyncio.run(app_module.index(request(old_etag)))
    assert unchanged.status_code == 304
    assert unchanged.body == b""

    current_preload[0] = '<link rel="modulepreload" href="/frontend/shared/new.js">'
    changed = asyncio.run(app_module.index(request(old_etag)))
    assert changed.status_code == 200
    assert changed.headers["etag"] != old_etag
    assert current_preload[0] in changed.body.decode("utf-8")
    assert "/frontend/shared/old.js" not in changed.body.decode("utf-8")

    refreshed = asyncio.run(app_module.index(request(changed.headers["etag"])))
    assert refreshed.status_code == 304
    assert refreshed.headers["etag"] == changed.headers["etag"]
    for response in (first, unchanged, changed, refreshed):
        assert response.headers["cache-control"] == "private, no-cache"
        assert response.headers["vary"] == "Cookie"
    # Conditional HTML requests still evaluate the current session before reuse.
    assert len(bootstrap_reads) == 4


def test_bundle_mode_preloads_route_graph_for_reliable_cold_start(monkeypatch, tmp_path):
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
        "frontend/landing/LandingPage.js": {
            "file": "assets/landing-12345678.js",
            "imports": ["_landing-shared.js"],
        },
        "_landing-shared.js": {"file": "assets/landing-shared-12345678.js"},
    }
    for entry_key in app_module._REQUIRED_WORKSPACE_STARTUP_ENTRIES:
        manifest[entry_key] = {
            "file": f"assets/{entry_key.rsplit('/', 1)[-1]}-12345678.js"
        }
    for entry_key in ("frontend/app/DashboardView.js", "frontend/plans/KeHoachView.js"):
        manifest[entry_key] = {
            "file": f"assets/{entry_key.rsplit('/', 1)[-1]}-12345678.js"
        }
    (manifest_directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(app_module, "APP_DEBUG", False)
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))

    anonymous = app_module._workspace_preload_tag({"valid": False}, "/")
    authenticated = app_module._workspace_preload_tag({"valid": True})

    assert anonymous.splitlines() == [
        '<link rel="modulepreload" href="/dist/assets/app-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/landing-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/app-shared-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/landing-shared-12345678.js">',
    ]
    assert authenticated.splitlines() == [
        '<link rel="modulepreload" href="/dist/assets/app-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/workspace-12345678.js">',
        *[
            f'<link rel="modulepreload" href="/dist/assets/{entry_key.rsplit("/", 1)[-1]}-12345678.js">'
            for entry_key in app_module._REQUIRED_WORKSPACE_STARTUP_ENTRIES
        ],
        '<link rel="modulepreload" href="/dist/assets/app-shared-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/workspace-shared-12345678.js">',
    ]
    for path in ("/tong-quan", "/ke-hoach"):
        assert app_module._workspace_preload_tag({"valid": True}, path) == authenticated


def test_production_preloads_route_graph_for_reliable_cold_start(monkeypatch, tmp_path):
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
        "frontend/landing/LandingPage.js": {
            "file": "assets/landing-12345678.js",
            "imports": ["_landing-shared.js"],
        },
        "_landing-shared.js": {"file": "assets/landing-shared-12345678.js"},
    }
    for entry_key in app_module._REQUIRED_WORKSPACE_STARTUP_ENTRIES:
        manifest[entry_key] = {
            "file": f"assets/{entry_key.rsplit('/', 1)[-1]}-12345678.js"
        }
    for entry_key in ("frontend/app/DashboardView.js", "frontend/plans/KeHoachView.js"):
        manifest[entry_key] = {
            "file": f"assets/{entry_key.rsplit('/', 1)[-1]}-12345678.js"
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

    anonymous = app_module._workspace_preload_tag({"valid": False}, "/")
    authenticated = app_module._workspace_preload_tag({"valid": True})

    assert anonymous.splitlines() == [
        '<link rel="modulepreload" href="/dist/assets/app-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/landing-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/app-shared-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/landing-shared-12345678.js">',
    ]
    assert authenticated.splitlines() == [
        '<link rel="modulepreload" href="/dist/assets/app-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/workspace-12345678.js">',
        *[
            f'<link rel="modulepreload" href="/dist/assets/{entry_key.rsplit("/", 1)[-1]}-12345678.js">'
            for entry_key in app_module._REQUIRED_WORKSPACE_STARTUP_ENTRIES
        ],
        '<link rel="modulepreload" href="/dist/assets/app-shared-12345678.js">',
        '<link rel="modulepreload" href="/dist/assets/workspace-shared-12345678.js">',
    ]
    for path in ("/tong-quan", "/ke-hoach"):
        assert app_module._workspace_preload_tag({"valid": True}, path) == authenticated


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


def test_compiled_bundle_preloads_exact_manifest_fonts(monkeypatch, tmp_path):
    test_secure_html_uses_one_hashed_stylesheet(monkeypatch, tmp_path)
    manifest_path = tmp_path / "dist" / ".vite" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for subset in ("latin", "vietnamese"):
        font = f"assets/plus-jakarta-sans-{subset}-12345678.woff2"
        target = tmp_path / "dist" / font
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(b"fixture-font")
        manifest[f"views/vendor/fonts/plus-jakarta-sans-{subset}.woff2"] = {"file": font}
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    compiled = app_module.compile_html(str(tmp_path / "views" / "index.html"))
    for subset in ("latin", "vietnamese"):
        assert compiled.count(f'href="/dist/assets/plus-jakarta-sans-{subset}-12345678.woff2"') == 1
    assert 'as="font" type="font/woff2" crossorigin' in compiled


def test_bundled_landing_uses_its_small_shell_stylesheet_without_app_css(
    monkeypatch,
    tmp_path,
):
    views_directory = tmp_path / "views"
    manifest_directory = tmp_path / "dist" / ".vite"
    assets_directory = tmp_path / "dist" / "assets"
    views_directory.mkdir(parents=True)
    manifest_directory.mkdir(parents=True)
    assets_directory.mkdir(parents=True)
    index_path = views_directory / "index.html"
    index_path.write_text(
        """<html><head>
<link rel="stylesheet" href="/css/base.css">
</head><body><script type="module" src="/frontend/app/app.js"></script></body></html>
""",
        encoding="utf-8",
    )
    manifest = {
        "frontend/app/app.js": {
            "file": "assets/app-12345678.js",
            "css": ["assets/app-12345678.css"],
        },
        "views/css/landing-shell.css": {
            "file": "assets/landing-shell-12345678.css",
        },
    }
    for asset in (
        "app-12345678.js",
        "app-12345678.css",
        "landing-shell-12345678.css",
    ):
        (assets_directory / asset).write_text("/* fixture */", encoding="utf-8")
    (manifest_directory / "manifest.json").write_text(
        json.dumps(manifest),
        encoding="utf-8",
    )
    monkeypatch.setattr(app_module, "APP_DEBUG", True)
    monkeypatch.setattr(app_module, "IS_PRODUCTION", False)
    monkeypatch.setattr(app_module, "FRONTEND_ASSET_MODE", "bundle")
    monkeypatch.setattr(app_module, "project_root", str(tmp_path))
    monkeypatch.setattr(app_module, "_compiled_html_cache", None)
    monkeypatch.setattr(app_module, "_compiled_html_cache_signature", None)
    compiled = app_module.compile_html(str(index_path))
    monkeypatch.setattr(
        app_module,
        "_build_index_response_payload",
        lambda: (compiled, '"template"'),
    )
    monkeypatch.setattr(
        app_module,
        "build_session_bootstrap",
        lambda _request: {"valid": False},
    )

    landing = asyncio.run(app_module.index(SimpleNamespace(
        url=SimpleNamespace(path="/"),
        headers={},
    ))).body.decode("utf-8")
    workspace = asyncio.run(app_module.index(SimpleNamespace(
        url=SimpleNamespace(path="/goi-thau"),
        headers={},
    ))).body.decode("utf-8")

    assert '/dist/assets/landing-shell-12345678.css' in landing
    assert '/dist/assets/app-12345678.css' not in landing
    assert 'data-bf-shell-styles="landing"' in landing
    assert '/dist/assets/app-12345678.js' in landing
    assert '/dist/assets/app-12345678.css' in workspace
    assert '/dist/assets/landing-shell-12345678.css' not in workspace


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


def test_debug_runtime_defaults_to_bundled_frontend_transport():
    assert app_module._resolve_frontend_asset_mode({}) == "bundle"


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


def test_active_role_switch_keeps_workspace_roles_in_spa_and_opens_isolated_admin():
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
    assert 'if (activeRole === "super_admin")' in role_block
    assert 'window.location.assign("/admin")' in role_block
    workspace_role_block = role_block.split('if (activeRole === "super_admin")', 1)[1].split(
        'const targetTab = "dashboard"', 1
    )[1]
    assert "window.location.assign" not in workspace_role_block
