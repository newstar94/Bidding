import sys
import os


if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass


if sys.platform == 'win32':
    try:
        import socket
        _orig_shutdown = socket.socket.shutdown
        def _patched_shutdown(self, how):
            try:
                _orig_shutdown(self, how)
            except OSError:
                pass
        socket.socket.shutdown = _patched_shutdown
    except Exception:
        pass

import re
import threading
import hashlib
import contextlib
import secrets
import json
import time
from urllib.parse import urlparse

from starlette.applications import Starlette
from starlette.routing import Route, Mount, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.responses import JSONResponse, HTMLResponse, Response, FileResponse
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware





current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.insert(0, project_root)


env_path = os.path.join(project_root, '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'").strip('"'))

APP_HOST = os.environ.get("APP_HOST", "127.0.0.1")
APP_PORT = int(os.environ.get("APP_PORT", "8000"))
APP_SECURE_COOKIES = os.environ.get("APP_SECURE_COOKIES", "False").lower() == "true"
APP_DEBUG = os.environ.get("APP_DEBUG", "False").lower() == "true"
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV in {"prod", "production"}
BACKGROUND_STARTUP_DELAY_SECONDS = max(0, int(os.environ.get("BACKGROUND_STARTUP_DELAY_SECONDS", "5")))
ENABLE_IMAGE_CACHE_PREWARM = os.environ.get("ENABLE_IMAGE_CACHE_PREWARM", "true").lower() == "true"
ENABLE_PARTNER_LOOKUP_WORKER = os.environ.get("ENABLE_PARTNER_LOOKUP_WORKER", "true").lower() == "true"


def _split_env_list(value):
    return [item.strip().rstrip("/") for item in str(value or "").split(",") if item.strip()]


def _is_local_origin(origin):
    try:
        parsed = urlparse(origin)
    except Exception:
        return False
    return parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def _is_public_https_origin(origin):
    try:
        parsed = urlparse(origin)
    except Exception:
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


def _websocket_csp_source(origin):
    try:
        parsed = urlparse(origin)
    except Exception:
        return None
    if not parsed.netloc:
        return None
    if parsed.scheme == "https":
        return f"wss://{parsed.netloc}"
    if parsed.scheme == "http":
        return f"ws://{parsed.netloc}"
    if parsed.scheme in {"ws", "wss"}:
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


def _unique_ordered(values):
    seen = set()
    result = []
    for value in values:
        if value and value not in seen:
            result.append(value)
            seen.add(value)
    return result




_ws_origins_env = os.environ.get("ALLOWED_WS_ORIGINS", "")
if _ws_origins_env:
    ALLOWED_WS_ORIGINS = frozenset(_split_env_list(_ws_origins_env))
else:
    _scheme = "https" if APP_SECURE_COOKIES else "http"
    _port_suffix = f":{APP_PORT}" if APP_PORT not in (80, 443) else ""
    ALLOWED_WS_ORIGINS = frozenset([
        f"{_scheme}://{APP_HOST}{_port_suffix}",
        f"{_scheme}://localhost{_port_suffix}",
        f"{_scheme}://127.0.0.1{_port_suffix}",
    ])






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
    return tuple(entries)


def compile_html(file_path):
    """Biên dịch file HTML bằng cách giải quyết INCLUDE placeholders đệ quy.
    Khi production: trả về cache nếu đã biên dịch. Khi debug: luôn đọc từ disk.
    """
    global _compiled_html_cache, _compiled_html_cache_signature

    if not APP_DEBUG and _compiled_html_cache:
        if IS_PRODUCTION:
            return _compiled_html_cache
        signature = _html_cache_signature()
        if _compiled_html_cache_signature == signature:
            return _compiled_html_cache
    else:
        signature = None if APP_DEBUG or IS_PRODUCTION else _html_cache_signature()

    def replace_include(match):
        include_path = match.group(1).strip()
        full_path = os.path.join(project_root, include_path)
        if not os.path.exists(full_path) and include_path.startswith("views/"):
            full_path = os.path.join(project_root, include_path.replace("views/", ""))

        resolved = os.path.realpath(full_path)
        if not resolved.startswith(os.path.realpath(project_root)):
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

    if not APP_DEBUG:
        compiled = re.sub(
            r'\s*<link\s+rel="modulepreload"\s+href="/(?:frontend|views)/[^"]+">\s*',
            '\n',
            compiled
        )
        bundle_src = "/dist/assets/appbundle.js"
        manifest_path = os.path.join(project_root, 'dist', '.vite', 'manifest.json')
        if os.path.exists(manifest_path):
            try:
                with open(manifest_path, 'r', encoding='utf-8') as manifest_file:
                    manifest = json.load(manifest_file)
                bundle_file = manifest.get('frontend/app/app.js', {}).get('file')
                if bundle_file:
                    bundle_src = f"/dist/{bundle_file}"
            except Exception as exc:
                log_error(exc, "frontend_manifest")
        compiled = re.sub(
            r'<script\s+type="module"\s+src="/frontend/app/app\.js(?:\?v=[^"]*)?"></script>',
            f'<script type="module" src="{bundle_src}"></script>',
            compiled
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
    google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    html_content = html_content.replace("__GOOGLE_CLIENT_ID__", google_client_id)
    etag = f'"{hashlib.md5(html_content.encode("utf-8")).hexdigest()}"'
    if IS_PRODUCTION:
        with _compiled_html_lock:
            _index_response_cache = (html_content, etag)
    return html_content, etag


def _workspace_preload_tag(session_bootstrap):
    """Preload the authenticated workspace graph while the app shell parses."""
    if not session_bootstrap.get("valid"):
        return ""
    if APP_DEBUG:
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

    manifest_path = os.path.join(project_root, 'dist', '.vite', 'manifest.json')
    try:
        with open(manifest_path, 'r', encoding='utf-8') as manifest_file:
            manifest = json.load(manifest_file)
        workspace_entry = 'frontend/app/workspaceBootstrap.js'
        app_entry = 'frontend/app/app.js'
        pending = [workspace_entry if workspace_entry in manifest else app_entry]
        visited = set()
        preload_files = []
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
        if preload_files:
            return "\n".join(
                f'<link rel="modulepreload" href="/dist/{bundle_file}">'
                for bundle_file in preload_files
            )
    except Exception as exc:
        log_error(exc, "workspace_preload_manifest")
    return ""


async def index(request):
    """Return the compiled application shell with browser ETag caching."""
    global _index_response_cache
    if IS_PRODUCTION and _index_response_cache is not None:
        html_content, etag = _index_response_cache
    else:
        html_content, etag = _build_index_response_payload()

    bootstrap_started = time.perf_counter()
    try:
        session_bootstrap = build_session_bootstrap(request)
    except Exception as exc:
        log_error(exc, "index_session_bootstrap")
        session_bootstrap = {"valid": False, "reason": "bootstrap_error"}
    safe_bootstrap = json.dumps(session_bootstrap, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    response_etag = f'"{hashlib.md5((etag + safe_bootstrap).encode("utf-8")).hexdigest()}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match == response_etag:
        return HTMLResponse(content="", status_code=304, headers={"ETag": response_etag, "Vary": "Cookie", "Cache-Control": "private, no-cache"})
    html_content = html_content.replace("__BF_SESSION_BOOTSTRAP__", safe_bootstrap)
    html_content = html_content.replace("__BF_WORKSPACE_PRELOAD__", _workspace_preload_tag(session_bootstrap))
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
    OrgPermissionError,
    verify_session,
    database,
    get_active_org
)

from backend.auth.otp_routes import (
    register_api,
    verify_email_api,
    resend_code_api,
    forgot_password_api
)
from backend.api.org_routes import (
    add_user_to_org_api,
    remove_user_from_org_api
)
from backend.auth.auth_routes import (
    login_api,
    check_session_api,
    update_profile_api,
    change_password_api,
    logout_api,
    list_users_api,
    delete_user_api,
    update_user_role_api,
    update_user_package_api,
    update_user_metadata_api,
    list_system_packages_api,
    update_system_package_api,
    set_username_api
)
from backend.auth.auth_routes import build_session_bootstrap
from backend.auth.google_auth_routes import google_login_api
from backend.sync.api import (
    sync_websocket_endpoint,
    sync_api,
    get_all_data_api,
    record_api,
    paginate_api
)
from backend.documents.export_routes import (
    export_plan_api,
    export_report_api,
    list_templates_api,
    set_active_template_api,
    upload_template_api,
    list_word_mappings_api,
    save_word_mapping_api,
    delete_word_mapping_api,
    import_excel_api,
    export_excel_template_api,
    export_mothau_template_api,
    export_danhgiahsdt_template_api,
    export_ketquaqd_template_api,
    export_phanlo_excel_api,
    export_tuychonmuathem_excel_api,
    export_opening_fin_template_api
)
from backend.partners.address_routes import (
    get_provinces_api,
    get_wards_api,
    lookup_tax_code_api
)


_holidays_cache = None

async def list_holidays_api(request):
    global _holidays_cache
    if _holidays_cache is not None:
        return JSONResponse(_holidays_cache)

    import json
    holidays_file = os.path.join(project_root, 'holidays.json')
    try:
        if os.path.exists(holidays_file):
            with open(holidays_file, 'r', encoding='utf-8') as f:
                _holidays_cache = json.load(f)
        else:
            _holidays_cache = {}
        return JSONResponse(_holidays_cache)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


class SafeStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):

        blocked_exts = (".py", ".pyc", ".pyo", ".db", ".sqlite", ".docx")
        if path.lower().endswith(blocked_exts) or "__pycache__" in path:
            return Response("Access Denied", status_code=403)
        return await super().get_response(path, scope)


class ProductionViewStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        normalized = path.replace("\\", "/").lstrip("/")
        allowed = (
            normalized == "style.css"
            or normalized == "service-worker.js"
            or (normalized.startswith("css/") and normalized.endswith(".css"))
            or (normalized.startswith("vendor/") and normalized.endswith((".js", ".css", ".woff2", ".woff", ".ttf")))
            or (normalized.startswith("tabs/") and normalized.endswith(".html"))
            or (normalized.startswith("modals/") and normalized.endswith(".html"))
        )
        if not allowed:
            return Response("Access Denied", status_code=403)
        return await super().get_response(path, scope)


async def protected_upload_api(request):
    is_valid, role_or_err = verify_session(request)
    if not is_valid:
        return JSONResponse({"error": role_or_err}, status_code=403)

    rel_path = request.path_params.get('file_path', '').replace('\\', '/')
    if rel_path.startswith('/') or '..' in rel_path.split('/'):
        return JSONResponse({"error": "Đường dẫn không hợp lệ"}, status_code=400)

    uploads_root = os.path.realpath(os.path.join(project_root, 'templates', 'uploads'))
    file_path = os.path.realpath(os.path.join(uploads_root, rel_path))
    if not file_path.startswith(uploads_root + os.sep) or not os.path.isfile(file_path):
        return JSONResponse({"error": "Không tìm thấy tệp"}, status_code=404)

    if not rel_path.startswith(('chuyen_gia/', 'nha_thau/')):
        return JSONResponse({"error": "Không có quyền truy cập tệp này"}, status_code=403)

    conn = None
    try:
        owner_id = get_active_org(request, role_or_err.user_id)
        stored_path = 'uploads/' + rel_path
        filename = os.path.basename(rel_path)
        conn = database.get_connection()
        cursor = conn.cursor()
        if rel_path.startswith('nha_thau/'):
            cursor.execute(
                "SELECT 1 FROM nha_thau WHERE owner_id = ? AND anh_dau = ?",
                (owner_id, stored_path)
            )
        else:
            cursor.execute(
                """
                SELECT 1 FROM chuyen_gia
                WHERE owner_id = ? AND (anh_chung_chi = ? OR anh_chu_ky = ?)
                """,
                (owner_id, stored_path, stored_path)
            )
        allowed = cursor.fetchone() is not None
        if not allowed and rel_path.startswith('chuyen_gia/') and '_opt_' in filename:
            original_prefix = filename.split('_opt_', 1)[0]
            cursor.execute(
                """
                SELECT 1 FROM chuyen_gia
                WHERE owner_id = ? AND (anh_chung_chi LIKE ? OR anh_chu_ky LIKE ?)
                """,
                (owner_id, f'uploads/chuyen_gia/{original_prefix}.%', f'uploads/chuyen_gia/{original_prefix}.%')
            )
            allowed = cursor.fetchone() is not None
        if not allowed:
            return JSONResponse({"error": "Không có quyền truy cập tệp này"}, status_code=403)
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        log_error(e, "protected_upload_api")
        return JSONResponse({"error": "Không thể kiểm tra quyền truy cập tệp"}, status_code=500)
    finally:
        if conn:
            try: conn.close()
            except Exception: pass

    return FileResponse(file_path)



dist_dir = os.path.join(project_root, 'dist')
os.makedirs(dist_dir, exist_ok=True)
os.makedirs(os.path.join(project_root, 'templates', 'uploads'), exist_ok=True)

routes = [
    Route("/", index, methods=["GET"]),
    Route("/api/holidays", list_holidays_api, methods=["GET"]),
    Route("/uploads/{file_path:path}", protected_upload_api, methods=["GET"]),
    Route("/api/sync", sync_api, methods=["POST"]),
    Route("/api/paginate", paginate_api, methods=["GET"]),
    Route("/api/record", record_api, methods=["GET"]),
    Route("/api/get-all-data", get_all_data_api, methods=["GET"]),
    WebSocketRoute("/ws/sync", sync_websocket_endpoint),
    Route("/api/export-report/{package_id}", export_report_api, methods=["GET"]),
    Route("/api/export-plan/{plan_id}", export_plan_api, methods=["GET"]),
    Route("/api/templates", list_templates_api, methods=["GET"]),
    Route("/api/templates/active", set_active_template_api, methods=["POST"]),
    Route("/api/templates/upload", upload_template_api, methods=["POST"]),
    Route("/api/word-mappings", list_word_mappings_api, methods=["GET"]),
    Route("/api/word-mappings", save_word_mapping_api, methods=["POST"]),
    Route("/api/word-mappings/{mapping_id}", delete_word_mapping_api, methods=["DELETE"]),
    Route("/api/import-excel", import_excel_api, methods=["POST"]),
    Route("/api/export-excel-template/{import_type}", export_excel_template_api, methods=["GET"]),
    Route("/api/export-mothau-template", export_mothau_template_api, methods=["GET"]),
    Route("/api/export-danhgiahsdt-template", export_danhgiahsdt_template_api, methods=["GET"]),
    Route("/api/export-ketquaqd-template", export_ketquaqd_template_api, methods=["GET"]),
    Route("/api/export-opening-fin-template", export_opening_fin_template_api, methods=["GET"]),
    Route("/api/export-phanlo-excel", export_phanlo_excel_api, methods=["POST"]),
    Route("/api/export-tuychonmuathem-excel", export_tuychonmuathem_excel_api, methods=["POST"]),
    Route("/api/system-packages", list_system_packages_api, methods=["GET"]),
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
    Route("/api/auth/logout", logout_api, methods=["POST"]),
    Route("/api/auth/forgot-password", forgot_password_api, methods=["POST"]),
    Route("/api/auth/update-profile", update_profile_api, methods=["POST"]),
    Route("/api/auth/change-password", change_password_api, methods=["POST"]),
    Route("/api/auth/users", list_users_api, methods=["GET"]),

    Route("/api/auth/users/update-role", update_user_role_api, methods=["POST"]),
    Route("/api/auth/users/update-package", update_user_package_api, methods=["POST"]),
    Route("/api/auth/users/update-metadata", update_user_metadata_api, methods=["POST"]),
    Route("/api/auth/users/add-to-org", add_user_to_org_api, methods=["POST"]),
    Route("/api/auth/users/remove-from-org", remove_user_from_org_api, methods=["POST"]),
    Route("/api/auth/users/{user_id}", delete_user_api, methods=["DELETE"]),


    Route("/tong-quan", index, methods=["GET"]),
    Route("/ke-hoach", index, methods=["GET"]),
    Route("/ke-hoach/{action}", index, methods=["GET"]),
    Route("/goi-thau", index, methods=["GET"]),
    Route("/goi-thau/{action}", index, methods=["GET"]),
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

    Route("/tong-quan-admin", index, methods=["GET"]),
    Route("/quan-ly-tai-khoan", index, methods=["GET"]),
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
]

if APP_DEBUG:
    routes.extend([
        Mount("/frontend", app=SafeStaticFiles(directory=os.path.join(project_root, 'frontend')), name="frontend"),
        Mount("/views", app=StaticFiles(directory=os.path.join(project_root, 'views')), name="views"),
        Mount("/", app=StaticFiles(directory=os.path.join(project_root, 'views'), html=True), name="static")
    ])
else:
    routes.append(
        Mount("/", app=ProductionViewStaticFiles(directory=os.path.join(project_root, 'views'), html=True), name="static")
    )



cors_origins_str = os.environ.get("CORS_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000")
cors_origins = _split_env_list(cors_origins_str) or ["http://127.0.0.1:8000"]

if IS_PRODUCTION:
    super_admin_allowlist = _split_env_list(os.environ.get("SUPER_ADMIN_IP_ALLOWLIST", ""))
    if not APP_SECURE_COOKIES:
        raise RuntimeError("APP_SECURE_COOKIES=True is required when APP_ENV=production.")
    if "*" in cors_origins or not all(_is_public_https_origin(origin) for origin in cors_origins):
        raise RuntimeError("CORS_ORIGINS must contain production HTTPS origins only when APP_ENV=production.")
    if "*" in ALLOWED_WS_ORIGINS or not all(_is_public_https_origin(origin) for origin in ALLOWED_WS_ORIGINS):
        raise RuntimeError("ALLOWED_WS_ORIGINS must contain production HTTPS origins only when APP_ENV=production.")
    if "*" in super_admin_allowlist or not super_admin_allowlist:
        raise RuntimeError("SUPER_ADMIN_IP_ALLOWLIST must be explicit and cannot contain * when APP_ENV=production.")


CSP_CONNECT_SOURCES = " ".join(_unique_ordered([
    "'self'",
    *(_websocket_csp_source(origin) for origin in ALLOWED_WS_ORIGINS),
    "https://accounts.google.com",
    "https://oauth2.googleapis.com",
]))


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Thêm các HTTP security headers cho mọi response để chống XSS, clickjacking, sniffing."""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"

        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://accounts.google.com https://apis.google.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; "
            "img-src 'self' data: blob: https://lh3.googleusercontent.com; "
            f"connect-src {CSP_CONNECT_SOURCES}; "
            "font-src 'self' https://fonts.gstatic.com; "
            "frame-src 'self' https://accounts.google.com; "
            "worker-src 'self'; "
            "base-uri 'self'; "
            "object-src 'none';"
        )
        path = request.url.path

        if request.headers.get("X-Forwarded-Proto") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        if path.startswith("/api/") or path.startswith("/ws/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        elif request.query_params.get("v") and path.endswith(('.js', '.css', '.png', '.woff2', '.woff', '.ttf')):

            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.endswith(('.js', '.css')):

            response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        return response

class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Giới hạn kích thước request body tối đa 10MB để phòng chống DoS."""
    async def dispatch(self, request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > 10 * 1024 * 1024:
                    return JSONResponse({"error": "Payload quá lớn (Giới hạn 10MB)"}, status_code=413)
            except ValueError:
                return JSONResponse({"error": "Content-Length không hợp lệ"}, status_code=400)
        return await call_next(request)

class CSRFMiddleware(BaseHTTPMiddleware):
    """Bảo vệ request đã đăng nhập bằng Origin/Referer và double-submit CSRF token."""

    MUTATING_METHODS = {"POST", "PUT", "DELETE"}
    EXEMPT_PATHS = {
        "/api/auth/login",
        "/api/auth/google-login",
        "/api/auth/register",
        "/api/auth/check-session",
        "/api/auth/verify",
        "/api/auth/resend-code",
        "/api/auth/forgot-password",
    }

    async def dispatch(self, request, call_next):
        csrf_cookie = request.cookies.get("csrf_token")
        csrf_token = csrf_cookie or secrets.token_urlsafe(32)

        if request.method in self.MUTATING_METHODS:
            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            host = request.headers.get("host")
            from urllib.parse import urlparse

            def _same_host(value):
                try:
                    parsed = urlparse(value)
                    return parsed.netloc == host
                except Exception:
                    return False

            if origin and not _same_host(origin):
                return JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Origin không khớp)"}, status_code=403)
            if referer and not _same_host(referer):
                return JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Referer không khớp)"}, status_code=403)

            requires_token = (
                request.url.path.startswith("/api/")
                and request.url.path not in self.EXEMPT_PATHS
                and bool(request.cookies.get("session_token"))
            )
            if requires_token:
                header_token = request.headers.get("x-csrf-token", "")
                if not csrf_cookie or not header_token or not secrets.compare_digest(csrf_cookie, header_token):
                    return JSONResponse({"error": "Yêu cầu bị từ chối do thiếu hoặc sai CSRF token!"}, status_code=403)

        response = await call_next(request)
        if not csrf_cookie:
            response.set_cookie(
                "csrf_token",
                csrf_token,
                httponly=False,
                secure=APP_SECURE_COOKIES,
                samesite="lax",
                path="/",
            )
        return response


middleware = [
    Middleware(CORSMiddleware,
               allow_origins=cors_origins,
               allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
               allow_headers=['Content-Type', 'X-Active-Org', 'X-CSRF-Token'],
               allow_credentials=False),
    Middleware(BodySizeLimitMiddleware),
    Middleware(CSRFMiddleware),
    Middleware(SecurityHeadersMiddleware),
    Middleware(ErrorLoggingMiddleware)
]

import contextlib

@contextlib.asynccontextmanager
async def lifespan(app):
    if IS_PRODUCTION:
        _build_index_response_payload()


    try:
        from backend.shared.helpers import khoi_tao_va_di_tru_he_thong
        khoi_tao_va_di_tru_he_thong()
    except Exception as db_err:
        log_error(db_err, "startup_database_init")

    def _start_optional_background_services():
        import time as _time
        if BACKGROUND_STARTUP_DELAY_SECONDS:
            _time.sleep(BACKGROUND_STARTUP_DELAY_SECONDS)

        if ENABLE_IMAGE_CACHE_PREWARM:
            try:
                from backend.documents.custom_exporter import prewarm_image_cache
                prewarm_image_cache()
            except Exception as start_err:
                log_error(start_err, "prewarm_image_cache")

        # Partner enrichment is started on demand after a contractor is saved.

    threading.Thread(
        target=_start_optional_background_services,
        daemon=True,
        name="optional-background-startup",
    ).start()


    from backend.auth.auth_helper import _session_cache_cleanup
    from backend.shared.helpers import _org_cache_cleanup
    def _run_cache_cleanup():
        import time as _time
        _cleanup_cycle = 0
        while True:
            _time.sleep(300)
            _cleanup_cycle += 1
            try:
                _session_cache_cleanup()
                _org_cache_cleanup()
            except Exception:
                pass

            if _cleanup_cycle % 6 == 0:
                try:
                    from backend.shared.helpers import database as _db
                    _conn = _db.get_connection()


                    _conn.execute(
                        "DELETE FROM deleted_records WHERE deleted_at < datetime('now', 'localtime', '-90 days')"
                    )
                    _conn.commit()
                    _conn.close()
                except Exception:
                    pass

                try:
                    _cg_dir = os.path.join(project_root, 'templates', 'uploads', 'chuyen_gia')
                    if os.path.exists(_cg_dir):
                        for _fname in os.listdir(_cg_dir):
                            if "_opt_" in _fname:
                                _fpath = os.path.join(_cg_dir, _fname)
                                if os.path.getmtime(_fpath) < _time.time() - 86400 * 30:
                                    os.remove(_fpath)
                except Exception:
                    pass
    threading.Thread(target=_run_cache_cleanup, daemon=True).start()
    yield

async def org_permission_handler(request, exc):
    return JSONResponse({"error": "Không có quyền truy cập tổ chức này!"}, status_code=403)

app = Starlette(
    debug=APP_DEBUG,
    routes=routes,
    middleware=middleware,
    lifespan=lifespan,
    exception_handlers={OrgPermissionError: org_permission_handler}
)




if __name__ == "__main__":
    import uvicorn
    if APP_DEBUG:
        uvicorn.run("backend.app:app", host=APP_HOST, port=APP_PORT, reload=True)
    else:
        uvicorn.run(app, host=APP_HOST, port=APP_PORT, reload=False)
