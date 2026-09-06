import sys
import os

# When this file is launched as ``python backend/app.py``, Python adds the
# backend directory (not the project root) to sys.path. Keep direct local
# startup working while preserving normal ``backend.app`` package imports.
if __package__ in {None, ""}:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

from backend.shared.windows_socket_adapter import install_windows_socket_shutdown_adapter


def _configure_utf8_stream(stream):
    if not hasattr(stream, "reconfigure"):
        return
    try:
        stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError, ValueError):
        # Some embedded/redirected streams expose reconfigure but reject it.
        return


_configure_utf8_stream(sys.stdout)
_configure_utf8_stream(sys.stderr)


install_windows_socket_shutdown_adapter()

import re
import threading
import hashlib
import contextlib
import html
import json
import time
from pathlib import Path
from urllib.parse import urlparse

from starlette.applications import Starlette
from starlette.routing import Route, Mount, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.responses import JSONResponse, HTMLResponse, Response, FileResponse
from starlette.requests import Request
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.insert(0, project_root)

from backend.shared.client_ip import parse_ip_networks
from backend.shared.origin_policy import get_allowed_websocket_origins
from backend.frontend_assets import (
    APP_ENTRY,
    LANDING_STYLE_ENTRY,
    FrontendAssetError,
    assert_production_frontend_ready,
    resolve_frontend_entry,
    resolve_preload_graph,
)


env_path = os.path.join(project_root, '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                key = k.strip()
                value = v.strip().strip("'").strip('"')
                # Local feature toggles must follow the checked-in .env even
                # when a stale parent process exported an older AI value.
                # Secrets and all other deployment settings keep the existing
                # process-environment precedence.
                if key in {"AI_ENABLED", "AI_PROVIDER"} and os.environ.get("APP_ENV", "development").strip().lower() not in {"prod", "production"}:
                    os.environ[key] = value
                else:
                    os.environ.setdefault(key, value)

from backend.shared.database_profile import load_profile
load_profile(project_root)

from backend.shared.paths import IMAGE_DIR
from backend.security.turnstile import public_turnstile_config
from backend.commercial_policy.config import trial_full_access_enabled

APP_HOST = os.environ.get("APP_HOST", "127.0.0.1")
APP_PORT = int(os.environ.get("APP_PORT", "8000"))
APP_SECURE_COOKIES = os.environ.get("APP_SECURE_COOKIES", "False").lower() == "true"
APP_DEBUG = os.environ.get("APP_DEBUG", "False").lower() == "true"
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV in {"prod", "production"}


def _resolve_frontend_asset_mode(environment):
    """Resolve and validate the asset transport independently of env-file loading."""

    mode = environment.get("FRONTEND_ASSET_MODE", "bundle").strip().lower()
    if mode not in {"source", "bundle"}:
        raise RuntimeError("FRONTEND_ASSET_MODE must be source or bundle.")
    return mode


FRONTEND_ASSET_MODE = _resolve_frontend_asset_mode(os.environ)
USE_FRONTEND_BUNDLE = not APP_DEBUG or FRONTEND_ASSET_MODE == "bundle"
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "").strip().rstrip("/")
BACKGROUND_STARTUP_DELAY_SECONDS = max(0, int(os.environ.get("BACKGROUND_STARTUP_DELAY_SECONDS", "5")))
ENABLE_IMAGE_CACHE_PREWARM = os.environ.get("ENABLE_IMAGE_CACHE_PREWARM", "true").lower() == "true"
ENABLE_PARTNER_LOOKUP_WORKER = os.environ.get("ENABLE_PARTNER_LOOKUP_WORKER", "true").lower() == "true"
VERSION_COMPARISON_ENABLED = os.environ.get(
    "VERSION_COMPARISON_ENABLED",
    "false" if IS_PRODUCTION else "true",
).lower() == "true"
LEGAL_VERSIONING_ENABLED = os.environ.get(
    "LEGAL_VERSIONING_ENABLED", "false"
).lower() == "true"


def _frontend_bundle_enabled():
    """Resolve asset mode from the current runtime flags.

    ``APP_DEBUG``, ``IS_PRODUCTION`` and ``FRONTEND_ASSET_MODE`` are runtime
    flags.  Resolve them at the call site so tests and controlled development
    switches cannot be pinned to the import-time ``USE_FRONTEND_BUNDLE`` value.
    """
    return bool(
        IS_PRODUCTION
        or not APP_DEBUG
        or FRONTEND_ASSET_MODE == "bundle"
    )


def _split_env_list(value):
    return [item.strip().rstrip("/") for item in str(value or "").split(",") if item.strip()]


def _is_local_origin(origin):
    try:
        parsed = urlparse(origin)
    except (TypeError, ValueError):
        return False
    return parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def _is_public_https_origin(origin):
    try:
        parsed = urlparse(origin)
    except (TypeError, ValueError):
        return False
    return (
        parsed.scheme == "https"
        and bool(parsed.netloc)
        and not parsed.path
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
        and not _is_local_origin(origin)
    )


def _public_google_client_id():
    """Expose Google Identity only where it is intentionally enabled.

    Development defaults to local credentials and origins that are not accepted
    by a production OAuth client.  Avoid loading the third-party widget there
    unless a developer explicitly opts in with a matching OAuth client.
    """
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    mode = os.environ.get("GOOGLE_AUTH_ENABLED", "auto").strip().casefold()
    if mode not in {"auto", "true", "false"}:
        mode = "auto"
    enabled = mode == "true" or (mode == "auto" and IS_PRODUCTION)
    return client_id if enabled else ""


ALLOWED_WS_ORIGINS = get_allowed_websocket_origins()






_compiled_html_cache = None
_compiled_html_cache_signature = None
_index_response_cache = None
_compiled_html_lock = threading.Lock()


def _html_cache_signature():
    """Build a cheap development signature without reading template contents."""
    entries = []
    views_dir = os.path.join(project_root, 'views')
    for root, dirs, files in os.walk(views_dir):
        dirs.sort()
        for filename in sorted(files):
            if filename.endswith('.html'):
                try:
                    path = os.path.join(root, filename)
                    stat = os.stat(path)
                    entries.append((os.path.relpath(path, views_dir), stat.st_mtime_ns, stat.st_size))
                except OSError:
                    pass
    for relative_path in (os.path.join('dist', '.vite', 'manifest.json'), os.path.join('dist', 'assets', 'appbundle.js')):
        try:
            path = os.path.join(project_root, relative_path)
            stat = os.stat(path)
            entries.append((relative_path, stat.st_mtime_ns, stat.st_size))
        except OSError:
            pass
    return tuple(entries)


def _path_is_within_root(candidate, root):
    """Return whether the resolved candidate is the root or a real descendant."""

    try:
        resolved_root = os.path.realpath(os.fspath(root))
        resolved_candidate = os.path.realpath(os.fspath(candidate))
        common = os.path.commonpath((resolved_root, resolved_candidate))
    except (OSError, TypeError, ValueError):
        # ValueError also covers paths on different Windows drives.
        return False
    return os.path.normcase(common) == os.path.normcase(resolved_root)


def compile_html(file_path):
    """Biên dịch file HTML bằng cách giải quyết INCLUDE placeholders đệ quy.
    Khi production: trả về cache nếu đã biên dịch. Khi debug: luôn đọc từ disk.
    """
    global _compiled_html_cache, _compiled_html_cache_signature

    if _frontend_bundle_enabled() and _compiled_html_cache:
        if IS_PRODUCTION:
            return _compiled_html_cache
        signature = _html_cache_signature()
        if _compiled_html_cache_signature == signature:
            return _compiled_html_cache
    else:
        signature = None if not _frontend_bundle_enabled() or IS_PRODUCTION else _html_cache_signature()

    def replace_include(match):
        include_path = match.group(1).strip()
        full_path = os.path.join(project_root, include_path)
        if not os.path.exists(full_path) and include_path.startswith("views/"):
            full_path = os.path.join(project_root, include_path.replace("views/", ""))

        resolved = os.path.realpath(full_path)
        if not _path_is_within_root(resolved, project_root):
            return f"<!-- INCLUDE ERROR: Path traversal denied for '{include_path}' -->"
        if os.path.exists(resolved):
            with open(resolved, 'r', encoding='utf-8') as f:
                return compile_content(f.read())
        return f"<!-- INCLUDE ERROR: File not found {include_path} ({full_path}) -->"

    def compile_content(content):
        pattern = r'<!--\s*INCLUDE:\s*([^\s\-]+)\s*-->'
        return re.sub(pattern, replace_include, content)

    if not os.path.exists(file_path):
        return "<h1>Error: Main template index.html not found</h1>"

    with open(file_path, 'r', encoding='utf-8') as f:
        compiled = compile_content(f.read())

    if _frontend_bundle_enabled():
        compiled = re.sub(
            r'\s*<link\s+rel="modulepreload"\s+href="/(?:frontend|views)/[^"]+">\s*',
            '\n',
            compiled
        )
        compiled = re.sub(
            r'\s*<link\s+rel="preload"\s+href="/vendor/fonts/plus-jakarta-sans-(?:latin|vietnamese)\.woff2"[^>]*>\s*',
            '\n',
            compiled,
        )
        bundle_src = "/dist/assets/appbundle.js"
        bundled_stylesheet = None
        if IS_PRODUCTION:
            frontend_assets = assert_production_frontend_ready(project_root)
            bundle_src = f"/dist/{frontend_assets.app_file}"
            bundled_stylesheet = (
                frontend_assets.stylesheets[0]
                if frontend_assets.stylesheets
                else None
            )
        else:
            bundle_is_content_hashed = False
            manifest_path = os.path.join(project_root, 'dist', '.vite', 'manifest.json')
            if os.path.exists(manifest_path):
                try:
                    with open(manifest_path, 'r', encoding='utf-8') as manifest_file:
                        manifest = json.load(manifest_file)
                    bundle_file = manifest.get(APP_ENTRY, {}).get('file')
                    if bundle_file:
                        bundle_src = f"/dist/{bundle_file}"
                        bundle_is_content_hashed = True
                    bundled_stylesheet = manifest.get('views/css/app.css', {}).get('file')
                    if not bundled_stylesheet:
                        app_styles = manifest.get(APP_ENTRY, {}).get('css') or []
                        bundled_stylesheet = app_styles[0] if app_styles else None
                except Exception as exc:
                    log_error(exc, "frontend_manifest")
            if not bundle_is_content_hashed:
                bundle_path = os.path.join(project_root, bundle_src.lstrip('/').replace('/', os.sep))
                try:
                    bundle_stat = os.stat(bundle_path)
                    bundle_version = f"{bundle_stat.st_mtime_ns:x}-{bundle_stat.st_size:x}"
                    bundle_src = f"{bundle_src}?v={bundle_version}"
                except OSError:
                    pass
        compiled = re.sub(
            r'<script\s+type="module"\s+src="/frontend/app/app\.js(?:\?v=[^"]*)?"></script>',
            f'<script type="module" src="{bundle_src}"></script>',
            compiled
        )
        if bundled_stylesheet:
            compiled = re.sub(
                r'\s*<link\s+rel="stylesheet"\s+href="/css/[^"]+"[^>]*>\s*',
                '\n',
                compiled,
            )
            compiled = compiled.replace(
                '</head>',
                f'    <link rel="stylesheet" href="/dist/{bundled_stylesheet}" data-runtime-styles>\n</head>',
                1,
            )
        compiled = compiled.replace('<meta name="bf-app-debug" content="true">', '<meta name="bf-app-debug" content="false">')
        with _compiled_html_lock:
            _compiled_html_cache = compiled
            _compiled_html_cache_signature = signature
    return compiled


def _build_index_response_payload():
    """Compile the index and its ETag once for a production process."""
    global _index_response_cache
    html_content = compile_html(os.path.join(project_root, 'views', 'index.html'))
    google_client_id = _public_google_client_id()
    html_content = html_content.replace("__GOOGLE_CLIENT_ID__", google_client_id)
    html_content = html_content.replace(
        "__TRIAL_FULL_ACCESS_ENABLED__",
        "true" if trial_full_access_enabled() else "false",
    )
    turnstile = public_turnstile_config()
    html_content = html_content.replace(
        "__TURNSTILE_ENABLED__",
        "true" if turnstile["enabled"] else "false",
    )
    html_content = html_content.replace(
        "__TURNSTILE_SITE_KEY__",
        html.escape(str(turnstile["siteKey"]), quote=True),
    )
    html_content = html_content.replace(
        "__VERSION_COMPARISON_ENABLED__",
        "true" if VERSION_COMPARISON_ENABLED else "false",
    )
    html_content = html_content.replace(
        "__LEGAL_VERSIONING_ENABLED__",
        "true" if LEGAL_VERSIONING_ENABLED else "false",
    )
    etag = f'"{hashlib.sha256(html_content.encode("utf-8")).hexdigest()}"'
    if IS_PRODUCTION:
        with _compiled_html_lock:
            _index_response_cache = (html_content, etag)
    return html_content, etag


def _prewarm_frontend_assets():
    """Read the small critical graph once so the first user does not pay cold file I/O."""
    if not _frontend_bundle_enabled():
        return 0, 0
    roots = (
        APP_ENTRY,
        'frontend/app/workspaceBootstrap.js',
        'frontend/admin/AdminUserController.js',
        'views/css/app.css',
    )
    try:
        if IS_PRODUCTION:
            frontend_assets = assert_production_frontend_ready(project_root)
            manifest = frontend_assets.manifest
            dist_root = os.fspath(frontend_assets.dist_root)
        else:
            manifest_path = os.path.join(project_root, 'dist', '.vite', 'manifest.json')
            dist_root = os.path.realpath(os.path.join(project_root, 'dist'))
            with open(manifest_path, 'r', encoding='utf-8') as manifest_file:
                manifest = json.load(manifest_file)
        pending = [key for key in roots if key in manifest]
        visited = set()
        warmed_files = 0
        warmed_bytes = 0
        max_total_bytes = 16 * 1024 * 1024
        while pending and warmed_bytes < max_total_bytes:
            manifest_key = pending.pop(0)
            if manifest_key in visited:
                continue
            visited.add(manifest_key)
            entry = manifest.get(manifest_key, {})
            pending.extend(entry.get('imports') or [])
            relative_file = str(entry.get('file') or '').replace('/', os.sep)
            if not relative_file:
                continue
            entry_files = [relative_file]
            entry_files.extend(
                str(value).replace('/', os.sep)
                for value in (entry.get('css') or []) + (entry.get('assets') or [])
            )
            for entry_file in dict.fromkeys(entry_files):
                candidate = os.path.realpath(os.path.join(dist_root, entry_file))
                try:
                    if os.path.commonpath((dist_root, candidate)) != dist_root:
                        continue
                    size = os.path.getsize(candidate)
                    if size > 5 * 1024 * 1024 or warmed_bytes + size > max_total_bytes:
                        continue
                    with open(candidate, 'rb') as asset_file:
                        while asset_file.read(256 * 1024):
                            pass
                    warmed_files += 1
                    warmed_bytes += size
                except (OSError, ValueError) as error:
                    if IS_PRODUCTION:
                        raise FrontendAssetError(
                            f"production frontend asset cannot be prewarmed: {entry_file}"
                        ) from error
                    continue
        return warmed_files, warmed_bytes
    except FrontendAssetError:
        raise
    except Exception as exc:
        if IS_PRODUCTION:
            raise FrontendAssetError("production frontend assets cannot be prewarmed") from exc
        log_error(exc, "frontend_asset_prewarm", level="WARN")
        return 0, 0


def _workspace_preload_tag(session_bootstrap):
    """Preload the app entry first, then the authenticated workspace graph."""
    if not _frontend_bundle_enabled():
        if not session_bootstrap.get("valid"):
            return ""
        workspace_src = "/frontend/app/workspaceBootstrap.js"
        preload_sources = [workspace_src]
        try:
            workspace_path = os.path.join(project_root, workspace_src.lstrip("/").replace("/", os.sep))
            with open(workspace_path, 'r', encoding='utf-8') as workspace_file:
                source = workspace_file.read()
            import_specifiers = re.findall(
                r'(?:import|export)\s+(?:[^\"\']*?\s+from\s+)?[\"\']([^\"\']+\.js)[\"\']',
                source,
            )
            workspace_directory = os.path.dirname(workspace_src)
            for specifier in import_specifiers:
                if specifier.startswith('/'):
                    resolved = os.path.normpath(specifier).replace('\\', '/')
                elif specifier.startswith('.'):
                    resolved = os.path.normpath(os.path.join(workspace_directory, specifier)).replace('\\', '/')
                else:
                    continue
                if not resolved.startswith('/'):
                    resolved = f'/{resolved}'
                preload_sources.append(resolved)
        except Exception as exc:
            log_error(exc, "workspace_preload_source")
        return "\n".join(
            f'<link rel="modulepreload" href="{module_src}">'
            for module_src in dict.fromkeys(preload_sources)
        )

    if IS_PRODUCTION:
        frontend_assets = assert_production_frontend_ready(project_root)
        workspace_entry = 'frontend/app/workspaceBootstrap.js'
        preload_files = list(resolve_preload_graph(
            frontend_assets.manifest,
            frontend_assets.dist_root,
            (APP_ENTRY,),
        ))
        if session_bootstrap.get("valid") and workspace_entry in frontend_assets.manifest:
            preload_files.append(resolve_frontend_entry(
                frontend_assets.manifest,
                frontend_assets.dist_root,
                workspace_entry,
            ))
        return "\n".join(
            f'<link rel="modulepreload" href="/dist/{bundle_file}">'
            for bundle_file in dict.fromkeys(preload_files)
        )

    manifest_path = os.path.join(project_root, 'dist', '.vite', 'manifest.json')
    try:
        with open(manifest_path, 'r', encoding='utf-8') as manifest_file:
            manifest = json.load(manifest_file)
        workspace_entry = 'frontend/app/workspaceBootstrap.js'
        app_entry = 'frontend/app/app.js'
        visited = set()
        preload_files = []
        pending = [app_entry]
        while pending:
            manifest_key = pending.pop(0)
            if manifest_key in visited:
                continue
            visited.add(manifest_key)
            entry = manifest.get(manifest_key, {})
            bundle_file = entry.get('file')
            if bundle_file:
                preload_files.append(bundle_file)
            pending.extend(entry.get('imports') or [])
        if session_bootstrap.get("valid") and workspace_entry in manifest:
            workspace_file = manifest[workspace_entry].get('file')
            if workspace_file:
                preload_files.append(workspace_file)
        if preload_files:
            return "\n".join(
                f'<link rel="modulepreload" href="/dist/{bundle_file}">'
                for bundle_file in dict.fromkeys(preload_files)
            )
    except Exception as exc:
        log_error(exc, "workspace_preload_manifest")
    return ""


def _page_metadata(path):
    if path == "/legal":
        title = "Điều khoản và chính sách | BiddingFlow"
        description = (
            "Điều khoản sử dụng, Chính sách quyền riêng tư và Chính sách bảo mật "
            "áp dụng cho BiddingFlow."
        )
    else:
        title = "BiddingFlow – Phần mềm quản lý đấu thầu và gói thầu"
        description = (
            "BiddingFlow giúp quản lý kế hoạch lựa chọn nhà thầu, gói thầu, hồ sơ, "
            "tiến độ, phê duyệt và hợp đồng trên một nền tảng thống nhất."
        )
    canonical_link = ""
    if APP_PUBLIC_URL and path in {"/", "/legal"}:
        canonical_url = f"{APP_PUBLIC_URL}{'' if path == '/' else path}"
        canonical_link = f'<link rel="canonical" href="{html.escape(canonical_url, quote=True)}">'
    return title, description, canonical_link


def _page_discovery_metadata(path, title, description):
    """Render public discovery metadata without exposing workspace routes."""
    if path not in {"/", "/legal"}:
        return '<meta name="robots" content="noindex, nofollow">', "", ""

    robots_meta = '<meta name="robots" content="index, follow, max-image-preview:large">'
    canonical_url = f"{APP_PUBLIC_URL}{'' if path == '/' else path}" if APP_PUBLIC_URL else ""
    image_url = f"{APP_PUBLIC_URL}/assets/biddingflow-social-preview.png" if APP_PUBLIC_URL else ""
    social_tags = [
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{html.escape(title, quote=True)}">',
        f'<meta property="og:description" content="{html.escape(description, quote=True)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{html.escape(title, quote=True)}">',
        f'<meta name="twitter:description" content="{html.escape(description, quote=True)}">',
    ]
    if canonical_url:
        escaped_url = html.escape(canonical_url, quote=True)
        social_tags.append(f'<meta property="og:url" content="{escaped_url}">')
    if image_url:
        escaped_image = html.escape(image_url, quote=True)
        social_tags.extend([
            f'<meta property="og:image" content="{escaped_image}">',
            '<meta property="og:image:width" content="1200">',
            '<meta property="og:image:height" content="630">',
            '<meta property="og:image:alt" content="BiddingFlow – Quản lý toàn bộ quy trình đấu thầu">',
            f'<meta name="twitter:image" content="{escaped_image}">',
        ])

    structured_data = ""
    if path == "/":
        graph = [{
            "@type": "WebApplication",
            "name": "BiddingFlow",
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Web",
            "description": description,
        }]
        if APP_PUBLIC_URL:
            graph[0]["url"] = APP_PUBLIC_URL
        payload = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("<", "\\u003c")
        structured_data = f'<script type="application/ld+json">{payload}</script>'
    return robots_meta, "\n    ".join(social_tags), structured_data


async def robots_txt(request):
    base_url = APP_PUBLIC_URL or str(request.base_url).rstrip("/")
    content = f"User-agent: *\nAllow: /\nSitemap: {base_url}/sitemap.xml\n"
    return Response(content, media_type="text/plain")


async def sitemap_xml(request):
    base_url = APP_PUBLIC_URL or str(request.base_url).rstrip("/")
    locations = [base_url, f"{base_url}/legal"]
    entries = "".join(f"<url><loc>{html.escape(location)}</loc></url>" for location in locations)
    content = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return Response(content, media_type="application/xml")


def _page_shell(html_content, path):
    shell_names = {
        "/": "LANDING",
        "/legal": "LEGAL",
    }
    selected_shell = shell_names.get(path, "WORKSPACE")
    for shell_name in ("LANDING", "LEGAL", "WORKSPACE"):
        start = f"<!-- BF_SHELL_{shell_name}_START -->"
        end = f"<!-- BF_SHELL_{shell_name}_END -->"
        pattern = re.compile(
            f"{re.escape(start)}(.*?){re.escape(end)}",
            re.DOTALL,
        )
        if shell_name == selected_shell:
            html_content = pattern.sub(lambda match: match.group(1), html_content, count=1)
        else:
            html_content = pattern.sub("", html_content, count=1)
    if selected_shell == "LANDING":
        html_content = re.sub(
            r'(<body\b[^>]*?)\s+hidden(?=[\s>])',
            r"\1",
            html_content,
            count=1,
        )
    return html_content


def _page_bundle_stylesheet(html_content, path):
    """Select the smallest reviewed stylesheet for a bundled public shell."""
    if path != "/" or not _frontend_bundle_enabled():
        return html_content, ""

    try:
        if IS_PRODUCTION:
            landing_stylesheet = assert_production_frontend_ready(
                project_root,
            ).landing_stylesheet
        else:
            manifest_path = os.path.join(
                project_root,
                "dist",
                ".vite",
                "manifest.json",
            )
            with open(manifest_path, "r", encoding="utf-8") as manifest_file:
                manifest = json.load(manifest_file)
            landing_stylesheet = resolve_frontend_entry(
                manifest,
                Path(project_root) / "dist",
                LANDING_STYLE_ENTRY,
            )
    except Exception as exc:
        if IS_PRODUCTION:
            raise
        log_error(exc, "landing_bundle_stylesheet")
        return html_content, ""

    selected_link = (
        f'<link rel="stylesheet" href="/dist/{landing_stylesheet}" '
        'data-runtime-styles data-bf-shell-styles="landing">'
    )
    html_content, replacements = re.subn(
        r'<link\s+rel="stylesheet"\s+href="/dist/[^"]+"\s+data-runtime-styles(?:\s+data-bf-shell-styles="[^"]+")?>',
        selected_link,
        html_content,
        count=1,
    )
    if replacements != 1:
        error = FrontendAssetError(
            "bundled application shell is missing its runtime stylesheet link"
        )
        if IS_PRODUCTION:
            raise error
        log_error(error, "landing_bundle_stylesheet")
        return html_content, ""
    return html_content, landing_stylesheet


def _initial_route_preload_tag(html_content):
    script_match = re.search(
        r'<script\s+src="(?P<src>/vendor/initial-route\.js\?v=[0-9a-f]{64})"'
        r"\s*></script>",
        html_content,
    )
    if not script_match:
        return ""
    return f'<link rel="preload" href="{script_match.group("src")}" as="script">'


async def index(request, *, not_found=False):
    """Return the compiled application shell with browser ETag caching."""
    global _index_response_cache
    if IS_PRODUCTION and _index_response_cache is not None:
        html_content, etag = _index_response_cache
    else:
        html_content, etag = _build_index_response_payload()

    bootstrap_started = time.perf_counter()
    try:
        session_bootstrap = await run_database_read(
            build_session_bootstrap,
            request,
        )
    except Exception as exc:
        log_error(exc, "index_session_bootstrap")
        session_bootstrap = {"valid": False, "reason": "bootstrap_error"}
    safe_bootstrap = json.dumps(session_bootstrap, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    request_path = request.url.path
    if request_path in {"/index.html", "/views/index.html"}:
        request_path = "/"
    html_content = _page_shell(html_content, request_path)
    html_content, page_asset_identity = _page_bundle_stylesheet(
        html_content,
        request_path,
    )
    page_title, page_description, canonical_link = _page_metadata(request_path)
    robots_meta, social_metadata, structured_data = _page_discovery_metadata(
        request_path,
        page_title,
        page_description,
    )
    response_etag = f'"{hashlib.sha256((etag + safe_bootstrap + request_path + page_asset_identity).encode("utf-8")).hexdigest()}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match == response_etag:
        return HTMLResponse(content="", status_code=304, headers={"ETag": response_etag, "Vary": "Cookie", "Cache-Control": "private, no-cache"})
    html_content = html_content.replace("__BF_SESSION_BOOTSTRAP__", safe_bootstrap)
    html_content = html_content.replace("__BF_PAGE_TITLE__", html.escape(page_title))
    html_content = html_content.replace("__BF_PAGE_DESCRIPTION__", html.escape(page_description, quote=True))
    html_content = html_content.replace("__BF_CANONICAL_LINK__", canonical_link)
    html_content = html_content.replace("__BF_ROBOTS_META__", robots_meta)
    html_content = html_content.replace("__BF_SOCIAL_METADATA__", social_metadata)
    html_content = html_content.replace("__BF_STRUCTURED_DATA__", structured_data)
    html_content = html_content.replace("__BF_NOT_FOUND__", "true" if not_found else "false")
    workspace_preload = "" if request_path in {"/", "/legal"} else _workspace_preload_tag(session_bootstrap)
    html_content = html_content.replace("__BF_WORKSPACE_PRELOAD__", workspace_preload)
    initial_route_preload = (
        ""
        if request_path in {"/", "/legal"}
        else _initial_route_preload_tag(html_content)
    )
    html_content = html_content.replace("__BF_INITIAL_ROUTE_PRELOAD__", initial_route_preload)
    bootstrap_ms = (time.perf_counter() - bootstrap_started) * 1000
    return HTMLResponse(
        content=html_content,
        status_code=200,
        headers={
            "ETag": response_etag,
            "Vary": "Cookie",
            "Cache-Control": "private, no-cache",
            "Server-Timing": f"session-bootstrap;dur={bootstrap_ms:.1f}"
        }
    )

from backend.shared.helpers import (
    log_error,
    ErrorLoggingMiddleware,
    RequestIdMiddleware,
    OrgPermissionError,
    verify_session,
    database,
    get_active_org
)
from backend.shared.logging_utils import error_response, log_and_error
from backend.shared.async_io import get_blocking_io_stats, run_blocking_io
from backend.shared.database_io import get_database_io_stats, run_database_read
from backend.shared.cpu_io import get_cpu_io_stats
from backend.observability.metrics import ObservabilityMiddleware, metrics_api
from backend.observability.client_errors import client_error_api
from backend.shared.access_policy import (
    can_read_record,
)
from backend.shared.media_helper import protected_image_signature_is_valid
from backend.db.db_helper import DatabaseError
from backend.db.db_utils import (
    DB_RUNTIME_MAX_SCHEMA_VERSION,
    DB_RUNTIME_MIN_SCHEMA_VERSION,
    DB_SCHEMA_VERSION,
)
from backend.startup import validate_startup_configuration, verify_database_responsive
from backend.lifecycle_policy_routes import lifecycle_policy_routes
from backend.commercial_policy.routes import commercial_policy_routes
from backend.billing.routes import billing_routes
from backend.usage_analytics.routes import usage_analytics_routes
from backend.product_analytics.routes import product_analytics_routes

from backend.auth.otp_routes import (
    register_api,
    verify_email_api,
    resend_code_api,
    forgot_password_api,
    reset_password_api,
)
from backend.api.org_routes import (
    add_user_to_org_api,
    get_document_export_capabilities_api,
    list_former_organization_members_api,
    lookup_membership_candidate_api,
    remove_user_from_org_api,
    update_document_export_capabilities_api,
    update_organization_subscription_api,
)
from backend.auth.auth_routes import (
    login_api,
    check_session_api,
    update_profile_api,
    verify_email_change_api,
    change_password_api,
    privileged_reauth_api,
    logout_api,
    list_users_api,
    delete_user_api,
    update_user_access_settings_api,
    update_user_role_api,
    update_user_metadata_api,
    set_active_role_api,
    list_system_packages_api,
    list_public_packages_api,
    update_system_package_api,
    set_username_api
)
from backend.auth.auth_routes import build_session_bootstrap
from backend.auth.google_auth_routes import google_login_api
from backend.sync.api import (
    sync_websocket_endpoint,
    sync_http_routes,
)
from backend.documents.export_routes import (
    export_plan_api,
    export_report_api,
    export_timeline_api,
    list_templates_api,
    get_word_publication_template_assignments_api,
    save_word_publication_template_assignments_api,
    view_template_api,
    set_active_template_api,
    upload_template_api,
    replace_template_api,
    delete_template_api,
    list_word_mappings_api,
    save_word_mapping_api,
    delete_word_mapping_api,
    reset_word_mapping_api,
    import_excel_api,
    export_excel_template_api,
    export_mothau_template_api,
    export_danhgiahsdt_template_api,
    export_ketquaqd_template_api,
    export_phanlo_excel_api,
    export_tuychonmuathem_excel_api,
    export_opening_fin_template_api
)
from backend.documents.package_document_routes import (
    package_document_routes,
)
from backend.partners.address_routes import (
    get_provinces_api,
    get_wards_api,
    lookup_tax_code_api
)
from backend.notifications.routes import (
    list_notifications_api,
    mark_all_notifications_read_api,
    mark_notification_read_api,
    delete_notification_api,
)
from backend.documents.document_job_routes import document_job_routes
from backend.documents.award_result_excel_routes import award_result_excel_routes
from backend.activity.routes import list_activity_timeline_api
from backend.lot_lifecycle_routes import (
    create_lot_batch_api,
    finalize_lot_batch_api,
    get_lot_lifecycle_api,
)
from backend.ai.routes import ai_routes
from backend.contractor_risk.routes import contractor_risk_routes
from backend.procurement_import.routes import procurement_import_routes
from backend.procurement_lookup.routes import procurement_lookup_routes
from backend.version_comparison.routes import version_comparison_routes
from backend.sync.conflict_resolution.routes import conflict_resolution_routes
from backend.documents.template_catalog.routes import word_template_catalog_routes
from backend.legal_versioning.routes import legal_versioning_routes


_holidays_cache = None


def _load_holidays_file(path):
    if not os.path.exists(path):
        return {}
    with open(path, 'r', encoding='utf-8') as holidays_stream:
        return json.load(holidays_stream)

async def list_holidays_api(request):
    global _holidays_cache
    if _holidays_cache is not None:
        return JSONResponse(_holidays_cache)

    holidays_file = os.path.join(project_root, 'holidays.json')
    try:
        _holidays_cache = await run_blocking_io(
            _load_holidays_file,
            holidays_file,
            timeout_seconds=5,
        )
        return JSONResponse(_holidays_cache)
    except Exception as e:
        return log_and_error(
            request,
            e,
            "list_holidays_api",
            "HOLIDAYS_LOAD_FAILED",
            "Không thể tải danh sách ngày nghỉ.",
        )


async def health_live_api(request):
    """Process liveness; intentionally does not depend on the database."""
    return JSONResponse(
        {"status": "live"},
        headers={"Cache-Control": "no-store"},
    )


async def health_ready_api(request):
    """Traffic readiness; fail closed when startup or the DB is unhealthy."""
    if not getattr(request.app.state, "startup_complete", False):
        return JSONResponse(
            {"status": "not_ready", "reason": "STARTUP_INCOMPLETE"},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    if not getattr(request.app.state, "ready", False):
        reason = getattr(request.app.state, "readiness_reason", None)
        if reason not in {
            "AUDIT_CHAIN_INVALID",
            "AUDIT_VERIFIER_ERROR",
            "APPLICATION_UNAVAILABLE",
        }:
            reason = "APPLICATION_UNAVAILABLE"
        return JSONResponse(
            {"status": "not_ready", "reason": reason},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    try:
        await run_database_read(
            verify_database_responsive,
            database,
            DB_RUNTIME_MIN_SCHEMA_VERSION,
            DB_RUNTIME_MAX_SCHEMA_VERSION,
            timeout_seconds=3.0,
        )
    except Exception as readiness_error:
        log_error(readiness_error, "readiness_database_check")
        return JSONResponse(
            {"status": "not_ready", "reason": "DATABASE_UNAVAILABLE"},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    io_stats = get_blocking_io_stats()
    database_io_stats = get_database_io_stats()
    cpu_io_stats = get_cpu_io_stats()
    response = JSONResponse(
        {"status": "ready"},
        headers={
            "Cache-Control": "no-store",
            "X-Event-Loop-Lag-Ms": f"{getattr(request.app.state, 'event_loop_lag_ms', 0.0):.1f}",
            "X-Blocking-IO-In-Flight": str(io_stats.in_flight),
            "X-Blocking-IO-Queue-Depth": str(io_stats.queued),
            "X-Blocking-IO-Timeouts": str(io_stats.timed_out),
            "X-Database-Read-In-Flight": str(database_io_stats["read"].in_flight),
            "X-Database-Read-Queue-Depth": str(database_io_stats["read"].queued),
            "X-Database-Write-In-Flight": str(database_io_stats["write"].in_flight),
            "X-Database-Write-Queue-Depth": str(database_io_stats["write"].queued),
            "X-CPU-Work-In-Flight": str(cpu_io_stats.in_flight),
            "X-CPU-Work-Queue-Depth": str(cpu_io_stats.queued),
        },
    )
    return response


class SafeStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):

        blocked_exts = (".py", ".pyc", ".pyo", ".db", ".sqlite", ".docx")
        if path.lower().endswith(blocked_exts) or "__pycache__" in path:
            return Response("Access Denied", status_code=403)
        return await super().get_response(path, scope)


def _is_production_view_asset_allowed(path):
    normalized = str(path or "").replace("\\", "/").lstrip("/")
    return (
        normalized == "service-worker.js"
        or normalized == "assets/auth-procurement-visual-v2.webp"
        or normalized == "assets/favicon.png"
        or normalized == "assets/app-brand-icon.webp"
        or normalized == "assets/biddingflow-social-preview.png"
        or normalized == "assets/landing-icons.svg"
        or (normalized.startswith("css/") and normalized.endswith(".css"))
        or (normalized.startswith("vendor/") and normalized.endswith((".js", ".css", ".woff2", ".woff", ".ttf")))
        or (normalized.startswith("tabs/") and normalized.endswith(".html"))
        or (normalized.startswith("modals/") and normalized.endswith(".html"))
    )


async def not_found_handler(request, _exception):
    """Render the branded 404 page for browser navigations only."""

    path = str(request.url.path or "")
    accepts = str(request.headers.get("accept") or "").lower()
    is_browser_navigation = (
        request.method in {"GET", "HEAD"}
        and "text/html" in accepts
        and not path.startswith(("/api/", "/ws/", "/css/", "/vendor/", "/frontend/", "/dist/", "/assets/"))
    )
    if not is_browser_navigation:
        if path.startswith(("/api/", "/ws/")):
            return JSONResponse({"error": "NOT_FOUND", "path": path}, status_code=404)
        return Response("Not found", status_code=404)
    response = await index(request, not_found=True)
    response.status_code = 404
    return response


class NotFoundViewStaticFiles(StaticFiles):
    """Serve view assets while rendering the branded fallback for missing pages."""

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            return await not_found_handler(Request(scope), exc)
        if getattr(response, "status_code", None) == 404:
            return await not_found_handler(Request(scope), None)
        return response


class ProductionViewStaticFiles(NotFoundViewStaticFiles):
    async def get_response(self, path: str, scope):
        if not _is_production_view_asset_allowed(path):
            return Response("Access Denied", status_code=403)
        return await super().get_response(path, scope)


async def protected_image_api(request):
    is_valid, role_or_err = verify_session(request)
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)

    rel_path = request.path_params.get('file_path', '').replace('\\', '/')
    if rel_path.startswith('/') or '..' in rel_path.split('/'):
        return JSONResponse({"error": "Đường dẫn không hợp lệ"}, status_code=400)

    if not rel_path.startswith(('chuyen_gia/', 'nha_thau/')):
        return JSONResponse({"error": "Không có quyền truy cập tệp này"}, status_code=403)

    conn = None
    try:
        organization_id = get_active_org(request, role_or_err.user_id)
        stored_path = 'images/' + rel_path
        session_token = str(request.cookies.get("session_token") or "").strip()
        if (
            request.query_params.get("org") != organization_id
            or not protected_image_signature_is_valid(
                session_token=session_token,
                organization_id=organization_id,
                managed_path=stored_path,
                expires_at=request.query_params.get("expires"),
                signature=request.query_params.get("sig", ""),
            )
        ):
            return JSONResponse({"error": "Liên kết ảnh không hợp lệ hoặc đã hết hạn"}, status_code=403)
        images_root = os.path.realpath(IMAGE_DIR)
        file_path = os.path.realpath(os.path.join(images_root, rel_path))
        if not file_path.startswith(images_root + os.sep):
            return JSONResponse({"error": "Đường dẫn không hợp lệ"}, status_code=400)
        filename = os.path.basename(rel_path)
        conn = database.get_connection()
        cursor = conn.cursor()
        owner_record_id = None
        if rel_path.startswith('nha_thau/'):
            row = cursor.execute(
                "SELECT id FROM nha_thau WHERE organization_id = ? AND anh_dau = ?",
                (organization_id, stored_path)
            ).fetchone()
            owner_record_id = row[0] if row else None
            payload_key = "nhathau"
            table_name = "nha_thau"
        else:
            row = cursor.execute(
                """
                SELECT id FROM chuyen_gia
                WHERE organization_id = ? AND (anh_chung_chi = ? OR anh_chu_ky = ?)
                """,
                (organization_id, stored_path, stored_path)
            ).fetchone()
            owner_record_id = row[0] if row else None
            payload_key = "chuyengia"
            table_name = "chuyen_gia"
        if not owner_record_id and rel_path.startswith('chuyen_gia/') and '_opt_' in filename:
            original_prefix = filename.split('_opt_', 1)[0]
            managed_directory = os.path.dirname(stored_path).replace('\\', '/')
            row = cursor.execute(
                """
                SELECT id FROM chuyen_gia
                WHERE organization_id = ? AND (anh_chung_chi LIKE ? OR anh_chu_ky LIKE ?)
                """,
                (
                    organization_id,
                    f'{managed_directory}/{original_prefix}.%',
                    f'{managed_directory}/{original_prefix}.%',
                )
            ).fetchone()
            owner_record_id = row[0] if row else None
        if not owner_record_id or not can_read_record(
            cursor,
            role_or_err,
            role_or_err.user_id,
            organization_id,
            payload_key,
            table_name,
            owner_record_id,
        ):
            return JSONResponse({"error": "Không có quyền truy cập tệp này"}, status_code=403)
        if not os.path.isfile(file_path):
            return JSONResponse({"error": "Không tìm thấy tệp"}, status_code=404)
    except OrgPermissionError:
        return error_response(
            request,
            "ORG_ACCESS_DENIED",
            "Không có quyền truy cập tổ chức này.",
            status_code=403,
        )
    except Exception as e:
        return log_and_error(
            request,
            e,
            "protected_image_api",
            "PROTECTED_FILE_ACCESS_CHECK_FAILED",
            "Không thể kiểm tra quyền truy cập tệp.",
        )
    finally:
        if conn:
            try:
                conn.close()
            except (DatabaseError, RuntimeError) as close_error:
                log_error(close_error, "protected_image_connection_close", level="WARN")

    return FileResponse(
        file_path,
        headers={"Cache-Control": "private, no-store"},
    )



dist_dir = os.path.join(project_root, 'dist')
os.makedirs(dist_dir, exist_ok=True)
os.makedirs(IMAGE_DIR, exist_ok=True)

routes = [
    *ai_routes,
    *usage_analytics_routes(Route),
    *product_analytics_routes(Route),
    Route("/health/live", health_live_api, methods=["GET"]),
    Route("/health/ready", health_ready_api, methods=["GET"]),
    Route("/metrics", metrics_api, methods=["GET"]),
    Route("/api/client-errors", client_error_api, methods=["POST"]),
    Route("/", index, methods=["GET"]),
    Route("/robots.txt", robots_txt, methods=["GET"]),
    Route("/sitemap.xml", sitemap_xml, methods=["GET"]),
    Route("/index.html", index, methods=["GET"]),
    Route("/views/index.html", index, methods=["GET"]),
    Route("/dang-nhap", index, methods=["GET"]),
    Route("/legal", index, methods=["GET"]),
    Route("/api/holidays", list_holidays_api, methods=["GET"]),
    Route("/images/{file_path:path}", protected_image_api, methods=["GET"]),
    *sync_http_routes(Route),
    *lifecycle_policy_routes(Route),
    *commercial_policy_routes(Route),
    *billing_routes(Route),
    Route("/api/packages/{package_id}/lot-lifecycle", get_lot_lifecycle_api, methods=["GET"]),
    Route("/api/packages/{package_id}/lot-batches", create_lot_batch_api, methods=["POST"]),
    Route("/api/packages/{package_id}/lot-batches/{batch_id}/finalize", finalize_lot_batch_api, methods=["POST"]),
    *package_document_routes(Route),
    Route("/api/notifications", list_notifications_api, methods=["GET"]),
    Route("/api/notifications/read-all", mark_all_notifications_read_api, methods=["POST"]),
    Route("/api/notifications/{notification_id}/read", mark_notification_read_api, methods=["POST"]),
    Route("/api/notifications/{notification_id}", delete_notification_api, methods=["DELETE"]),
    Route("/api/activities/{target_type}/{target_id}", list_activity_timeline_api, methods=["GET"]),
    WebSocketRoute("/ws/sync", sync_websocket_endpoint),
    Route("/api/export-report/{package_id}", export_report_api, methods=["GET"]),
    Route("/api/export-timeline/{package_id}", export_timeline_api, methods=["GET"]),
    *document_job_routes(Route),
    *award_result_excel_routes(Route),
    *contractor_risk_routes(Route),
    *procurement_import_routes(Route),
    *procurement_lookup_routes(Route),
    *version_comparison_routes(Route),
    *conflict_resolution_routes(Route),
    *word_template_catalog_routes(Route),
    *legal_versioning_routes(Route),
    Route("/api/export-plan/{plan_id}", export_plan_api, methods=["GET", "POST"]),
    Route("/api/templates", list_templates_api, methods=["GET"]),
    Route("/api/templates/active", set_active_template_api, methods=["POST"]),
    Route("/api/templates/upload", upload_template_api, methods=["POST"]),
    Route(
        "/api/word-publication-template-assignments",
        get_word_publication_template_assignments_api,
        methods=["GET"],
    ),
    Route(
        "/api/word-publication-template-assignments",
        save_word_publication_template_assignments_api,
        methods=["PUT"],
    ),
    Route("/api/templates/{filename}", view_template_api, methods=["GET"]),
    Route("/api/templates/{filename}", replace_template_api, methods=["PUT"]),
    Route("/api/templates/{filename}", delete_template_api, methods=["DELETE"]),
    Route("/api/word-mappings", list_word_mappings_api, methods=["GET"]),
    Route("/api/word-mappings", save_word_mapping_api, methods=["POST"]),
    Route("/api/word-mappings/{mapping_id}", delete_word_mapping_api, methods=["DELETE"]),
    Route("/api/word-mappings/{mapping_id}/reset", reset_word_mapping_api, methods=["POST"]),
    Route("/api/import-excel", import_excel_api, methods=["POST"]),
    Route("/api/export-excel-template/{import_type}", export_excel_template_api, methods=["GET"]),
    Route("/api/export-mothau-template", export_mothau_template_api, methods=["GET"]),
    Route("/api/export-danhgiahsdt-template", export_danhgiahsdt_template_api, methods=["GET"]),
    Route("/api/export-ketquaqd-template", export_ketquaqd_template_api, methods=["GET"]),
    Route("/api/export-opening-fin-template", export_opening_fin_template_api, methods=["GET"]),
    Route("/api/export-phanlo-excel", export_phanlo_excel_api, methods=["POST"]),
    Route("/api/export-tuychonmuathem-excel", export_tuychonmuathem_excel_api, methods=["POST"]),
    Route("/api/system-packages", list_system_packages_api, methods=["GET"]),
    Route("/api/public/packages", list_public_packages_api, methods=["GET"]),
    Route("/api/system-packages/update", update_system_package_api, methods=["POST"]),


    Route("/api/address/provinces", get_provinces_api, methods=["GET"]),
    Route("/api/address/wards/{province_code}", get_wards_api, methods=["GET"]),
    Route("/api/lookup-tax-code", lookup_tax_code_api, methods=["GET"]),


    Route("/api/auth/register", register_api, methods=["POST"]),
    Route("/api/auth/verify", verify_email_api, methods=["POST"]),
    Route("/api/auth/resend-code", resend_code_api, methods=["POST"]),
    Route("/api/auth/login", login_api, methods=["POST"]),
    Route("/api/auth/google-login", google_login_api, methods=["POST"]),
    Route("/api/auth/set-username", set_username_api, methods=["POST"]),
    Route("/api/auth/check-session", check_session_api, methods=["POST"]),
    Route("/api/auth/active-role", set_active_role_api, methods=["POST"]),
    Route("/api/auth/logout", logout_api, methods=["POST"]),
    Route("/api/auth/forgot-password", forgot_password_api, methods=["POST"]),
    Route("/api/auth/reset-password", reset_password_api, methods=["POST"]),
    Route("/api/auth/update-profile", update_profile_api, methods=["POST"]),
    Route("/api/auth/verify-email-change", verify_email_change_api, methods=["POST"]),
    Route("/api/auth/change-password", change_password_api, methods=["POST"]),
    Route("/api/auth/privileged-reauth", privileged_reauth_api, methods=["POST"]),
    Route("/api/auth/users", list_users_api, methods=["GET"]),
    Route("/api/auth/users/access-settings", update_user_access_settings_api, methods=["PUT"]),

    Route("/api/auth/users/update-role", update_user_role_api, methods=["POST"]),
    Route("/api/auth/users/update-metadata", update_user_metadata_api, methods=["POST"]),
    Route("/api/auth/users/add-to-org", add_user_to_org_api, methods=["POST"]),
    Route("/api/auth/users/remove-from-org", remove_user_from_org_api, methods=["POST"]),
    Route("/api/organizations/membership-candidate", lookup_membership_candidate_api, methods=["GET"]),
    Route("/api/organizations/subscription", update_organization_subscription_api, methods=["POST"]),
    Route("/api/organizations/former-members", list_former_organization_members_api, methods=["GET"]),
    Route(
        "/api/organizations/document-export-capabilities/{user_id}",
        get_document_export_capabilities_api,
        methods=["GET"],
    ),
    Route(
        "/api/organizations/document-export-capabilities/{user_id}",
        update_document_export_capabilities_api,
        methods=["PUT"],
    ),
    Route("/api/auth/users/{user_id}", delete_user_api, methods=["DELETE"]),


    Route("/tong-quan", index, methods=["GET"]),
    Route("/ke-hoach", index, methods=["GET"]),
    Route("/ke-hoach/{action}", index, methods=["GET"]),
    Route("/goi-thau", index, methods=["GET"]),
    Route("/goi-thau/{action}", index, methods=["GET"]),
    Route("/timeline-goi-thau", index, methods=["GET"]),
    Route("/mothau", index, methods=["GET"]),
    Route("/mothau/{action}", index, methods=["GET"]),
    Route("/danh-gia-hsdt", index, methods=["GET"]),
    Route("/danh-gia-hsdt/{action}", index, methods=["GET"]),
    Route("/chu-dau-tu", index, methods=["GET"]),
    Route("/chu-dau-tu/{action}", index, methods=["GET"]),
    Route("/nha-thau", index, methods=["GET"]),
    Route("/nha-thau/{action}", index, methods=["GET"]),
    Route("/chuyen-gia", index, methods=["GET"]),
    Route("/chuyen-gia/{action}", index, methods=["GET"]),
    Route("/hop-dong", index, methods=["GET"]),
    Route("/hop-dong/{action}", index, methods=["GET"]),
    Route("/bieu-mau", index, methods=["GET"]),
    Route("/xuat-ban-word", index, methods=["GET"]),
    Route("/reset-password", index, methods=["GET"]),

    Route("/tong-quan-admin", index, methods=["GET"]),
    Route("/quan-ly-tai-khoan", index, methods=["GET"]),
    Route("/thuong-mai-thanh-toan", index, methods=["GET"]),
    Route("/phan-tich-su-dung", index, methods=["GET"]),
    Route("/goi-va-thanh-toan", index, methods=["GET"]),
    Route("/nhan-su", index, methods=["GET"]),
    Route("/trang-thai-ho-so", index, methods=["GET"]),
    Route("/trang-ca-nhan", index, methods=["GET"]),
    Route("/goi-thau-chi-tiet", index, methods=["GET"]),
    Route("/goi-thau-chi-tiet/{action}", index, methods=["GET"]),
    Route("/ke-hoach-chi-tiet", index, methods=["GET"]),
    Route("/ke-hoach-chi-tiet/{action}", index, methods=["GET"]),
    Route("/hop-dong-chi-tiet", index, methods=["GET"]),
    Route("/hop-dong-chi-tiet/{action}", index, methods=["GET"]),
    Route("/chu-dau-tu-chi-tiet", index, methods=["GET"]),
    Route("/chu-dau-tu-chi-tiet/{action}", index, methods=["GET"]),
    Route("/nha-thau-chi-tiet", index, methods=["GET"]),
    Route("/nha-thau-chi-tiet/{action}", index, methods=["GET"]),
    Route("/chudautu-detail", index, methods=["GET"]),
    Route("/chudautu-detail/{action}", index, methods=["GET"]),
    Route("/nhathau-detail", index, methods=["GET"]),
    Route("/nhathau-detail/{action}", index, methods=["GET"]),


    Mount("/dist", app=SafeStaticFiles(directory=dist_dir), name="dist"),
    # The development ESM graph imports the shared JSON catalog directly;
    # production keeps the mount as a safe fallback for uncached clients.
    Mount("/shared", app=SafeStaticFiles(directory=os.path.join(project_root, "shared")), name="shared"),
]

if APP_DEBUG:
    async def dompurify_development_asset(_request):
        return FileResponse(
            os.path.join(
                project_root,
                "node_modules",
                "dompurify",
                "dist",
                "purify.es.mjs",
            ),
            media_type="text/javascript",
        )

    routes.extend([
        Route(
            "/node_modules/dompurify/dist/purify.es.mjs",
            dompurify_development_asset,
            methods=["GET"],
            name="dompurify-dev",
        ),
        Mount("/frontend", app=SafeStaticFiles(directory=os.path.join(project_root, 'frontend')), name="frontend"),
        Mount("/views", app=StaticFiles(directory=os.path.join(project_root, 'views')), name="views"),
        Mount("/", app=NotFoundViewStaticFiles(directory=os.path.join(project_root, 'views'), html=True), name="static")
    ])
else:
    routes.append(
        Mount("/", app=ProductionViewStaticFiles(directory=os.path.join(project_root, 'views'), html=True), name="static")
    )



cors_origins_str = os.environ.get("CORS_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000")
cors_origins = _split_env_list(cors_origins_str) or ["http://127.0.0.1:8000"]
allowed_hosts = _split_env_list(
    os.environ.get("ALLOWED_HOSTS", "127.0.0.1,localhost,testserver")
)

if IS_PRODUCTION:
    super_admin_allowlist = _split_env_list(os.environ.get("SUPER_ADMIN_IP_ALLOWLIST", ""))
    trusted_proxy_cidrs = os.environ.get("TRUSTED_PROXY_CIDRS", "")
    try:
        proxy_networks = parse_ip_networks(trusted_proxy_cidrs)
        admin_networks = parse_ip_networks(
            os.environ.get("SUPER_ADMIN_IP_ALLOWLIST", ""),
            allow_wildcard=True,
        )
    except ValueError as exc:
        raise RuntimeError("Trusted proxy and super-admin allowlists must contain valid IP/CIDR values.") from exc
    if not APP_SECURE_COOKIES:
        raise RuntimeError("APP_SECURE_COOKIES=True is required when APP_ENV=production.")
    if "*" in cors_origins or not all(_is_public_https_origin(origin) for origin in cors_origins):
        raise RuntimeError("CORS_ORIGINS must contain production HTTPS origins only when APP_ENV=production.")
    if "*" in ALLOWED_WS_ORIGINS or not all(_is_public_https_origin(origin) for origin in ALLOWED_WS_ORIGINS):
        raise RuntimeError("ALLOWED_WS_ORIGINS must contain production HTTPS origins only when APP_ENV=production.")
    if "*" in super_admin_allowlist or not super_admin_allowlist:
        raise RuntimeError("SUPER_ADMIN_IP_ALLOWLIST must be explicit and cannot contain * when APP_ENV=production.")
    if admin_networks == ("*",) or any(network.prefixlen == 0 for network in admin_networks):
        raise RuntimeError("SUPER_ADMIN_IP_ALLOWLIST cannot trust the entire internet in production.")
    if any(network.prefixlen == 0 for network in proxy_networks):
        raise RuntimeError("TRUSTED_PROXY_CIDRS cannot trust the entire internet in production.")
    if not APP_PUBLIC_URL or not _is_public_https_origin(APP_PUBLIC_URL):
        raise RuntimeError("APP_PUBLIC_URL must be a public HTTPS origin when APP_ENV=production.")
    if set(cors_origins) != {APP_PUBLIC_URL}:
        raise RuntimeError("Production CORS_ORIGINS must contain only APP_PUBLIC_URL (same-origin deployment).")
    if set(ALLOWED_WS_ORIGINS) != {APP_PUBLIC_URL}:
        raise RuntimeError("Production ALLOWED_WS_ORIGINS must contain only APP_PUBLIC_URL.")
    public_hostname = str(urlparse(APP_PUBLIC_URL).hostname or "").casefold()
    normalized_allowed_hosts = {host.casefold() for host in allowed_hosts}
    if (
        not public_hostname
        or normalized_allowed_hosts != {public_hostname}
        or any("*" in host or ":" in host or "/" in host for host in allowed_hosts)
    ):
        raise RuntimeError(
            "Production ALLOWED_HOSTS must contain only the hostname from APP_PUBLIC_URL."
        )


from backend.http_middleware import (
    BodySizeLimitMiddleware,
    CSRFMiddleware,
    ProxyHeaderTrustMiddleware,
    ResponseIntegrityMiddleware,
    SecurityHeadersMiddleware,
)

middleware = [
    Middleware(ResponseIntegrityMiddleware),
    Middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts, www_redirect=False),
    Middleware(ProxyHeaderTrustMiddleware),
    Middleware(CORSMiddleware,
               allow_origins=cors_origins,
               allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
               allow_headers=['Content-Type', 'X-Active-Org', 'X-CSRF-Token', 'X-Request-ID'],
               allow_credentials=True),
    Middleware(RequestIdMiddleware),
    Middleware(ObservabilityMiddleware),
    Middleware(CSRFMiddleware),
    Middleware(SecurityHeadersMiddleware),
    Middleware(ErrorLoggingMiddleware),
    Middleware(BodySizeLimitMiddleware),
]

LOCAL_DATABASE_SUPERVISOR_ENV = "BIDDINGFLOW_LOCAL_DATABASE_SUPERVISOR"


def _initialize_database():
    from backend.db.db_helper import PostgresDatabase
    from backend.db.postgres_schema import initialize_and_log

    database_url = os.environ.get("MIGRATOR_DATABASE_URL") or os.environ.get(
        "DATABASE_URL"
    )
    migration_database = PostgresDatabase(database_url)
    try:
        initialize_and_log(migration_database)
    finally:
        migration_database.close()


def _start_local_database_if_managed():
    """Start the repository-managed PostgreSQL cluster for local development."""

    if os.environ.get(LOCAL_DATABASE_SUPERVISOR_ENV) == "1":
        return False
    setup_script = os.path.join(project_root, "scripts", "setup_local_postgres.py")
    if not os.path.isfile(setup_script):
        return False

    from scripts.setup_local_postgres import (
        ensure_local_postgres_running,
        should_auto_start_local_postgres,
    )

    if not should_auto_start_local_postgres(os.environ):
        return False
    ensure_local_postgres_running()
    return True


def _start_local_database_before_reloader():
    """Let the stable Uvicorn supervisor own local PostgreSQL startup."""

    started = _start_local_database_if_managed()
    os.environ[LOCAL_DATABASE_SUPERVISOR_ENV] = "1"
    return started


@contextlib.asynccontextmanager
async def lifespan(application):
    from backend.lifecycle import application_lifespan

    _start_local_database_if_managed()
    async with application_lifespan(
        application,
        database=database,
        schema_version=DB_SCHEMA_VERSION,
        minimum_schema_version=DB_RUNTIME_MIN_SCHEMA_VERSION,
        initialize_database=_initialize_database,
        build_index_response=_build_index_response_payload,
        prewarm_frontend_assets=_prewarm_frontend_assets,
        is_production=IS_PRODUCTION,
        image_dir=IMAGE_DIR,
        background_startup_delay_seconds=BACKGROUND_STARTUP_DELAY_SECONDS,
        enable_image_cache_prewarm=ENABLE_IMAGE_CACHE_PREWARM,
        enable_partner_lookup_worker=ENABLE_PARTNER_LOOKUP_WORKER,
        validate_startup=validate_startup_configuration,
    ):
        yield

async def org_permission_handler(request, exc):
    return error_response(
        request,
        "ORG_ACCESS_DENIED",
        "Không có quyền truy cập tổ chức này.",
        status_code=403,
    )

app = Starlette(
    debug=APP_DEBUG,
    routes=routes,
    middleware=middleware,
    lifespan=lifespan,
    exception_handlers={
        OrgPermissionError: org_permission_handler,
        404: not_found_handler,
    }
)




if __name__ == "__main__":
    import uvicorn
    if APP_DEBUG:
        _start_local_database_before_reloader()
        uvicorn.run("backend.app:app", host=APP_HOST, port=APP_PORT, reload=True, proxy_headers=False)
    else:
        uvicorn.run(app, host=APP_HOST, port=APP_PORT, reload=False, proxy_headers=False)
