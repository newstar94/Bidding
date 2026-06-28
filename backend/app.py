import sys
import os

# Reconfigure stdout/stderr to use UTF-8 to prevent UnicodeEncodeError on Windows terminals
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

# Fix for Windows asyncio ProactorEventLoop WinError 10054 / ConnectionResetError
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

import uvicorn
import re
import threading
import hashlib
import contextlib

from starlette.applications import Starlette
from starlette.routing import Route, Mount, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.responses import JSONResponse, HTMLResponse, Response
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

# ==========================================
# 1. CẤU HÌNH ĐƯỜNG DẪN & TẢI MODULE BIÊN DỊCH
# ==========================================

current_dir = os.path.dirname(os.path.abspath(__file__))  # backend/
project_root = os.path.dirname(current_dir)               # root
models_dir = os.path.join(project_root, 'models')
backend_dir = os.path.join(project_root, 'backend')
helpers_py_dir = os.path.join(backend_dir, 'helpers_py')
routes_dir = os.path.join(backend_dir, 'routes')

# Thêm các thư mục MVC vào sys.path để Python có thể nạp chéo giữa các mô-đun
sys.path.insert(0, project_root)
sys.path.append(models_dir)
sys.path.append(backend_dir)
sys.path.append(helpers_py_dir)
sys.path.append(routes_dir)

# Tự động tải các cấu hình từ file .env nếu có
env_path = os.path.join(project_root, '.env')
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                os.environ[k.strip()] = v.strip().strip("'").strip('"')

APP_HOST = os.environ.get("APP_HOST", "127.0.0.1")
APP_PORT = int(os.environ.get("APP_PORT", "8000"))
APP_DEBUG = os.environ.get("APP_DEBUG", "False").lower() == "true"  # Mặc định TẮt debug trên production

# ==========================================
# 2. HTML TEMPLATE COMPILER
# ==========================================

# Cache cho HTML đã biên dịch (chỉ được dùng khi APP_DEBUG=False)
_compiled_html_cache = None
_compiled_html_lock = threading.Lock()


def compile_html(file_path):
    """Biên dịch file HTML bằng cách giải quyết INCLUDE placeholders đệ quy.
    Khi production: trả về cache nếu đã biên dịch. Khi debug: luôn đọc từ disk.
    """
    global _compiled_html_cache

    # Trả cache ngay nếu production và đã có cache
    if not APP_DEBUG and _compiled_html_cache:
        return _compiled_html_cache

    def replace_include(match):
        include_path = match.group(1).strip()
        full_path = os.path.join(project_root, include_path)
        if not os.path.exists(full_path) and include_path.startswith("views/"):
            full_path = os.path.join(project_root, include_path.replace("views/", ""))
        if os.path.exists(full_path):
            with open(full_path, 'r', encoding='utf-8') as f:
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
            r'<script\s+type="module"\s+src="/controllers/app\.js(?:\?v=[^"]*)?"></script>',
            '<script type="module" src="/dist/controllers/app.bundle.js"></script>',
            compiled
        )
        with _compiled_html_lock:
            if not _compiled_html_cache:
                _compiled_html_cache = compiled
    return compiled


async def index(request):
    """
    [GET] /
    Biên dịch và trả về tệp index.html đã được ghép nối từ các partials.
    Tối ưu hóa ETag browser caching.
    """
    html_content = compile_html(os.path.join(project_root, 'views', 'index.html'))
    etag = f'"{hashlib.md5(html_content.encode("utf-8")).hexdigest()}"'

    if_none_match = request.headers.get("if-none-match")
    if if_none_match and if_none_match == etag:
        return HTMLResponse(content="", status_code=304, headers={"ETag": etag})

    return HTMLResponse(content=html_content, status_code=200, headers={"ETag": etag})

from helpers import (
    log_error,
    ErrorLoggingMiddleware,
    OrgPermissionError
)

import custom_exporter


from routes.auth_routes import (
    register_api,
    verify_email_api,
    resend_code_api,
    login_api,
    check_session_api,
    forgot_password_api,
    update_profile_api,
    change_password_api,
    list_users_api,
    delete_user_api,
    update_user_role_api,
    update_user_package_api,
    update_user_metadata_api,
    list_system_packages_api,
    update_system_package_api,
    add_user_to_org_api,
    remove_user_from_org_api
)
from routes.sync_routes import (
    sync_websocket_endpoint,
    sync_api,
    get_all_data_api,
    paginate_api
)
from routes.export_routes import (
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
from routes.address_routes import (
    get_provinces_api,
    get_wards_api
)


class SafeStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        # Chỉ cho phép các file tĩnh phục vụ Frontend (.js, .css), từ chối mã nguồn Python và file nhạy cảm
        blocked_exts = (".py", ".pyc", ".pyo", ".db", ".sqlite", ".docx")
        if path.lower().endswith(blocked_exts) or "__pycache__" in path:
            return Response("Access Denied", status_code=403)
        return await super().get_response(path, scope)


# Đảm bảo thư mục dist tồn tại để tránh StaticFiles báo lỗi khi chưa chạy build lần đầu
dist_dir = os.path.join(project_root, 'dist')
os.makedirs(dist_dir, exist_ok=True)

routes = [
    Route("/", index, methods=["GET"]),
    Route("/api/sync", sync_api, methods=["POST"]),
    Route("/api/paginate", paginate_api, methods=["GET"]),
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

    # Address proxy routes (tránh bị chặn CSP, server gọi API bên ngoài thay browser)
    Route("/api/address/provinces", get_provinces_api, methods=["GET"]),
    Route("/api/address/wards/{province_code}", get_wards_api, methods=["GET"]),
    
    # Auth Routes
    Route("/api/auth/register", register_api, methods=["POST"]),
    Route("/api/auth/verify", verify_email_api, methods=["POST"]),
    Route("/api/auth/resend-code", resend_code_api, methods=["POST"]),
    Route("/api/auth/login", login_api, methods=["POST"]),
    Route("/api/auth/check-session", check_session_api, methods=["POST"]),
    Route("/api/auth/forgot-password", forgot_password_api, methods=["POST"]),
    Route("/api/auth/update-profile", update_profile_api, methods=["POST"]),
    Route("/api/auth/change-password", change_password_api, methods=["POST"]),
    Route("/api/auth/users", list_users_api, methods=["GET"]),
    # Static sub-routes PHẢI đứng trước dynamic {user_id} để tránh Starlette match nhầm
    Route("/api/auth/users/update-role", update_user_role_api, methods=["POST"]),
    Route("/api/auth/users/update-package", update_user_package_api, methods=["POST"]),
    Route("/api/auth/users/update-metadata", update_user_metadata_api, methods=["POST"]),
    Route("/api/auth/users/add-to-org", add_user_to_org_api, methods=["POST"]),
    Route("/api/auth/users/remove-from-org", remove_user_from_org_api, methods=["POST"]),
    Route("/api/auth/users/{user_id}", delete_user_api, methods=["DELETE"]),
    
    # SPA Clean Paths Fallback to serve index.html for browser routes (Kebab-Case Standardized)
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

    # Mount gốc views cho tệp index.html và style.css (Dùng SafeStaticFiles cho /controllers và /models để chỉ serve file tĩnh JS/CSS)
    Mount("/dist", app=SafeStaticFiles(directory=dist_dir), name="dist"),
    Mount("/controllers", app=SafeStaticFiles(directory=os.path.join(project_root, 'controllers')), name="controllers"),
    Mount("/models", app=SafeStaticFiles(directory=os.path.join(project_root, 'models')), name="models"),
    Mount("/uploads", app=StaticFiles(directory=os.path.join(project_root, 'templates', 'uploads')), name="uploads"),
    Mount("/views", app=StaticFiles(directory=os.path.join(project_root, 'views')), name="views"),
    Mount("/", app=StaticFiles(directory=os.path.join(project_root, 'views'), html=True), name="static")
]

# CORS: Mặc định chỉ cho phép localhost + 127.0.0.1.
# Để mở rộng, set CORS_ORIGINS trong .env (VD: CORS_ORIGINS=https://yourdomain.com)
cors_origins_str = os.environ.get("CORS_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000")
cors_origins = [o.strip() for o in cors_origins_str.split(",")] if cors_origins_str else ["http://127.0.0.1:8000"]


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Thêm các HTTP security headers cho mọi response để chống XSS, clickjacking, sniffing."""
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Thêm CSP hỗ trợ tải tài nguyên tự host và các CDN cần thiết
        response.headers["Content-Security-Policy"] = (
            "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://fonts.googleapis.com; "
            "img-src 'self' data: blob:; "
            f"connect-src 'self' https://unpkg.com https://cdn.jsdelivr.net ws://127.0.0.1:{APP_PORT} wss://127.0.0.1:{APP_PORT} ws://localhost:{APP_PORT} wss://localhost:{APP_PORT}; "
            "font-src 'self' https://fonts.gstatic.com https://unpkg.com https://cdn.jsdelivr.net;"
        )
        path = request.url.path
        # Priority 11: HSTS khi chạy sau reverse proxy HTTPS
        if request.headers.get("X-Forwarded-Proto") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # Priority 3: Cache-Control cho static assets
        if path.startswith("/api/") or path.startswith("/ws/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        elif request.query_params.get("v") and path.endswith(('.js', '.css', '.png', '.woff2', '.woff', '.ttf')):
            # File có version string (?v=6.7) → cache vĩnh viễn (nội dung không đổi)
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.endswith(('.js', '.css')):
            # JS/CSS không có version → revalidate mỗi request
            response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        return response

class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Giới hạn kích thước request body tối đa 10MB để phòng chống DoS."""
    async def dispatch(self, request, call_next):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > 10 * 1024 * 1024:  # 10MB
                    return JSONResponse({"error": "Payload quá lớn (Giới hạn 10MB)"}, status_code=413)
            except ValueError:
                return JSONResponse({"error": "Content-Length không hợp lệ"}, status_code=400)
        return await call_next(request)

class CSRFMiddleware(BaseHTTPMiddleware):
    """Bảo vệ ứng dụng khỏi tấn công CSRF bằng cách so khớp tiêu đề Origin/Referer."""
    async def dispatch(self, request, call_next):
        if request.method in ["POST", "PUT", "DELETE"]:
            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            host = request.headers.get("host")
            if origin and host not in origin:
                return JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Origin không khớp)"}, status_code=403)
            if referer and host not in referer:
                return JSONResponse({"error": "Yêu cầu bị từ chối do vi phạm CSRF! (Referer không khớp)"}, status_code=403)
        return await call_next(request)


middleware = [
    Middleware(CORSMiddleware,
               allow_origins=cors_origins,
               allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
               allow_headers=['Content-Type', 'X-Session-Token', 'X-Username', 'X-Active-Org'],
               allow_credentials=False),
    Middleware(BodySizeLimitMiddleware),
    Middleware(CSRFMiddleware),
    Middleware(SecurityHeadersMiddleware),
    Middleware(ErrorLoggingMiddleware)
]

import contextlib

@contextlib.asynccontextmanager
async def lifespan(app):
    # Khởi tạo và di trú cơ sở dữ liệu nếu chưa tồn tại
    try:
        from helpers import khoi_tao_va_di_tru_he_thong
        khoi_tao_va_di_tru_he_thong()
    except Exception as db_err:
        print("Lỗi khởi tạo cơ sở dữ liệu tại startup:", db_err)

    import threading
    threading.Thread(target=custom_exporter.prewarm_image_cache, daemon=True).start()
    
    # Dọn dẹp session cache và org cache hết hạn mỗi 5 phút để tránh RAM tích tụ
    from helpers_py.auth_helper import _session_cache_cleanup
    from helpers import _org_cache_cleanup
    def _run_cache_cleanup():
        import time as _time
        _cleanup_cycle = 0
        while True:
            _time.sleep(300)  # 5 phút
            _cleanup_cycle += 1
            try:
                _session_cache_cleanup()
                _org_cache_cleanup()
            except Exception:
                pass
            # Mỗi 6 chu kỳ (30 phút): xoá deleted_records cũ hơn 90 ngày
            if _cleanup_cycle % 6 == 0:
                try:
                    from helpers import database as _db
                    _conn = _db.get_connection()
                    _conn.execute(
                        "DELETE FROM deleted_records WHERE deleted_at < strftime('%s','now') - 7776000"
                    )  # 7776000 = 90 ngày * 86400 giây
                    _conn.commit()
                    _conn.close()
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

# ==========================================
# 5. KHỞI CHẠY MÁY CHỦ UVICORN
# ==========================================
if __name__ == "__main__":
    # Khởi chạy server sử dụng đường dẫn import dạng module chính xác 'backend.app:app'
    uvicorn.run("backend.app:app", host=APP_HOST, port=APP_PORT, reload=APP_DEBUG)
