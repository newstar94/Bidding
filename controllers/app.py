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

import json
import uvicorn
import shutil
from datetime import datetime
import pandas as pd

# Import các thành phần của framework Starlette để dựng Web API Server
from starlette.applications import Starlette
from starlette.routing import Route, Mount, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.responses import StreamingResponse, JSONResponse, FileResponse, HTMLResponse
from starlette.middleware import Middleware
# ... (các imports khác giữ nguyên)

import re

# Cache cho HTML đã biên dịch/ghép nối
_compiled_html_cache = None

def compile_html(file_path):
    global _compiled_html_cache
    
    # Nếu không phải chế độ debug và đã có cache, trả về cache luôn
    if not APP_DEBUG and _compiled_html_cache:
        return _compiled_html_cache
        
    def replace_include(match):
        include_path = match.group(1).strip()
        # Đường dẫn trong placeholder ví dụ: views/components/sidebar.html
        # Ta sẽ giải quyết đường dẫn tuyệt đối dựa trên thư mục gốc dự án (project_root)
        full_path = os.path.join(project_root, include_path)
        
        # Thử lại nếu không chứa views/ hoặc tìm kiếm trực tiếp
        if not os.path.exists(full_path) and include_path.startswith("views/"):
            full_path = os.path.join(project_root, include_path.replace("views/", ""))
            
        if os.path.exists(full_path):
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Biên dịch đệ quy phòng trường hợp file con cũng chứa placeholder INCLUDE
                return compile_content(content)
        else:
            return f"<!-- INCLUDE ERROR: File not found {include_path} ({full_path}) -->"

    def compile_content(content):
        # Trận khớp dạng <!-- INCLUDE: đường_dẫn_file -->
        pattern = r'<!--\s*INCLUDE:\s*([^\s\-]+)\s*-->'
        return re.sub(pattern, replace_include, content)

    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_content = f.read()
        compiled = compile_content(raw_content)
        if not APP_DEBUG:
            _compiled_html_cache = compiled
        return compiled
    return "<h1>Error: Main template index.html not found</h1>"


async def index(request):
    """
    [GET] /
    Biên dịch và trả về tệp index.html đã được ghép nối từ các partials.
    """
    html_content = compile_html(os.path.join(project_root, 'views', 'index.html'))
    return HTMLResponse(content=html_content, status_code=200)
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.background import BackgroundTasks

# ==========================================
# 1. CẤU HÌNH ĐƯỜNG DẪN & TẢI MODULE BIÊN DỊCH
# ==========================================

# Lấy đường dẫn của thư mục controllers/ và thư mục gốc của dự án
current_dir = os.path.dirname(os.path.abspath(__file__)) # controllers/
project_root = os.path.dirname(current_dir) # root
models_dir = os.path.join(project_root, 'models')
controllers_dir = os.path.join(project_root, 'controllers')

# Thêm các thư mục MVC vào sys.path để Python có thể nạp chéo giữa các mô-đun
sys.path.insert(0, project_root)
sys.path.append(models_dir)
sys.path.append(controllers_dir)

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
                k = k.strip()
                v = v.strip().strip("'").strip('"')
                os.environ[k] = v

# Nạp helpers.py và dùng các module/hàm từ helpers
import helpers
from helpers import (
    models,
    database,
    log_error,
    ErrorLoggingMiddleware,
    format_date_str,
    VietnameseFloat,
    clean_admin_prefix,
    gui_email,
    verify_session,
    SCHEMA_DINH_NGHIA,
    hash_password,
    verify_password,
    get_effective_roles,
    save_base64_image,
    load_base64_image,
    ROLE_HIERARCHY,
    SessionRole
)

# exporter = load_and_register('exporter', os.path.join(controllers_dir, 'exporter.cpython-314.pyc'))
import custom_exporter
import uuid
import hashlib
import secrets


from auth_routes import (
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
    update_system_package_api
)
from sync_routes import (
    sync_websocket_endpoint,
    sync_api,
    get_all_data_api,
    paginate_api
)
from export_routes import (
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
    export_ketquaqd_template_api
)


class SafeStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        # Chỉ cho phép các file tĩnh phục vụ Frontend (như .js, .css), từ chối mã nguồn Python (.py, .pyc, .pyo) và file nhạy cảm (.db, .sqlite, .docx)
        blocked_exts = (".py", ".pyc", ".pyo", ".db", ".sqlite", ".docx")
        if path.lower().endswith(blocked_exts) or "__pycache__" in path:
            from starlette.responses import Response
            return Response("Access Denied", status_code=403)
        return await super().get_response(path, scope)


# ==========================================
# 4. KHAI BÁO PATH ROUTING & STATIC FILES
# ==========================================
routes = [
    Route("/", index, methods=["GET"]),
    Route("/api/sync", sync_api, methods=["POST"]),
    Route("/api/paginate", paginate_api, methods=["GET"]),
    Route("/api/get-all-data", get_all_data_api, methods=["GET"]),
    WebSocketRoute("/ws/sync", sync_websocket_endpoint),
    Route("/api/export-report/{package_id}", export_report_api, methods=["GET"]),
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
    Route("/api/system-packages", list_system_packages_api, methods=["GET"]),
    Route("/api/system-packages/update", update_system_package_api, methods=["POST"]),
    
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
    Route("/api/auth/users/{user_id}", delete_user_api, methods=["DELETE"]),
    Route("/api/auth/users/update-role", update_user_role_api, methods=["POST"]),
    Route("/api/auth/users/update-package", update_user_package_api, methods=["POST"]),
    Route("/api/auth/users/update-metadata", update_user_metadata_api, methods=["POST"]),
    
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

    # Mount gốc views cho tệp index.html và style.css (Dùng SafeStaticFiles cho /controllers và /models để chỉ serve file tĩnh JS/CSS)
    Mount("/controllers", app=SafeStaticFiles(directory=os.path.join(project_root, 'controllers')), name="controllers"),
    Mount("/models", app=SafeStaticFiles(directory=os.path.join(project_root, 'models')), name="models"),
    Mount("/uploads", app=StaticFiles(directory=os.path.join(project_root, 'uploads')), name="uploads"),
    Mount("/views", app=StaticFiles(directory=os.path.join(project_root, 'views')), name="views"),
    Mount("/", app=StaticFiles(directory=os.path.join(project_root, 'views'), html=True), name="static")
]

APP_HOST = os.environ.get("APP_HOST", "127.0.0.1")
APP_PORT = int(os.environ.get("APP_PORT", "8000"))
APP_DEBUG = os.environ.get("APP_DEBUG", "False").lower() == "true"   # Mặc định TẮT debug trên production

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
            "connect-src 'self' ws: wss: http: https:; "
            "font-src 'self' https://fonts.gstatic.com https://unpkg.com https://cdn.jsdelivr.net;"
        )
        # Chỉ cache tài nguyên tĩnh, không cache API
        if request.url.path.startswith("/api/") or request.url.path.startswith("/ws/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return response

middleware = [
    Middleware(CORSMiddleware,
               allow_origins=cors_origins,
               allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
               allow_headers=['Content-Type', 'X-Session-Token', 'X-Username', 'X-Active-Org'],
               allow_credentials=False),
    Middleware(SecurityHeadersMiddleware),
    Middleware(ErrorLoggingMiddleware)
]

import contextlib

@contextlib.asynccontextmanager
async def lifespan(app):
    import threading
    threading.Thread(target=custom_exporter.prewarm_image_cache, daemon=True).start()
    yield

app = Starlette(debug=APP_DEBUG, routes=routes, middleware=middleware, lifespan=lifespan)

# ==========================================
# 5. KHỞI CHẠY MÁY CHỦ UVICORN
# ==========================================
if __name__ == "__main__":
    # Khởi chạy server sử dụng đường dẫn import dạng module chính xác 'controllers.app:app'
    uvicorn.run("controllers.app:app", host=APP_HOST, port=APP_PORT, reload=APP_DEBUG)
