import sys
import os
import json
import base64
import uuid
import hashlib
import secrets
from datetime import datetime
import re
import traceback
import smtplib
import random
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from starlette.middleware.base import BaseHTTPMiddleware

# ==========================================
# CẤU HÌNH ĐƯỜNG DẪN & TẢI MODULE BIÊN DỊCH
# ==========================================

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
models_dir = os.path.join(project_root, 'models')
controllers_dir = os.path.join(project_root, 'controllers')

sys.path.insert(0, project_root)
sys.path.append(models_dir)
sys.path.append(controllers_dir)

# Load env file if any
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

import importlib.machinery
import importlib.util

def load_and_register(name, filepath):
    loader = importlib.machinery.SourcelessFileLoader(name, filepath)
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    sys.modules[name] = module
    loader.exec_module(module)
    return module

models = load_and_register('models', os.path.join(models_dir, 'models.cpython-314.pyc'))
database = load_and_register('database', os.path.join(models_dir, 'database.cpython-314.pyc'))

db_indexes_created = False
orig_get_connection = database.get_connection

def optimized_get_connection(*args, **kwargs):
    conn = orig_get_connection(*args, **kwargs)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA cache_size = -65536")
        cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.execute("PRAGMA temp_store = MEMORY")
        
        global db_indexes_created
        if not db_indexes_created:
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_kehoach ON goi_thau(ke_hoach_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_kehoach_chudautu ON ke_hoach_lcnt(chu_dau_tu_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_thongtinmothau_goithau ON thong_tin_mo_thau(goi_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chudautu_latest ON chu_dau_tu(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nhathau_latest ON nha_thau(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_hopdong_chudautu ON hop_dong(chu_dau_tu_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_hopdong_nhathau ON hop_dong(nha_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_kehoach_latest ON ke_hoach_lcnt(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_latest ON goi_thau(id_goc, is_latest)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_goithau_nhathau ON goi_thau(nha_thau_trung_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_thongtinmothau_nhathau ON thong_tin_mo_thau(nha_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_hopdonggoithau_goithau ON hop_dong_goi_thau(goi_thau_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_deletedrecords_lookup ON deleted_records(owner_id, deleted_at)")
            db_indexes_created = True
    except Exception as e:
        print(f"Error applying SQLite PRAGMAs or indexes: {e}")
    return conn

database.get_connection = optimized_get_connection

import custom_exporter
from image_helpers import save_base64_image, load_base64_image

def hash_password(password: str, salt: str = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
    return f"{salt}:{pwd_hash.hex()}"

def verify_password(stored_password: str, provided_password: str) -> bool:
    try:
        if not stored_password:
            return False
        if ":" not in stored_password:
            return stored_password == provided_password
        salt, stored_hash = stored_password.split(":")
        pwd_hash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return secrets.compare_digest(stored_hash, pwd_hash.hex())
    except Exception:
        return False

ROLE_HIERARCHY = {
    'super_admin': ['super_admin', 'manager', 'employee'],
    'manager':     ['manager', 'employee'],
    'employee':    ['employee'],
}

def get_effective_roles(role_str):
    roles = [r.strip() for r in (role_str or '').split(',') if r.strip()]
    effective = set()
    for r in roles:
        effective.update(ROLE_HIERARCHY.get(r, [r]))
    return effective

class SessionRole(str):
    def __new__(cls, role, user_id):
        instance = super().__new__(cls, role)
        instance.user_id = user_id
        return instance

def verify_session(request, required_role=None):
    token = request.headers.get('X-Session-Token')
    username = request.headers.get('X-Username')
    
    if not token or not username:
        return False, "Thiếu thông tin xác thực phiên làm việc!"
        
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, vai_tro, token_phien, han_su_dung_token FROM tai_khoan WHERE ten_dang_nhap = ? OR (email != '' AND email = ?)", (username, username))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return False, "Tài khoản không tồn tại!"
        
    user = dict(row)
    if user['token_phien'] != token:
        return False, "Phiên làm việc đã hết hạn hoặc không hợp lệ!"

    if user.get('han_su_dung_token'):
        try:
            expiry = datetime.fromisoformat(user['han_su_dung_token'])
            if datetime.utcnow() > expiry:
                return False, "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại."
        except Exception:
            pass
        
    if required_role and required_role not in get_effective_roles(user['vai_tro']):
        return False, "Bạn không có quyền thực hiện thao tác này!"
        
    return True, SessionRole(user['vai_tro'], user['id'])

def to_snake_case(name):
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

def to_camel_case(snake_str):
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])

def clean_id(val):
    if val is None or val == "":
        return None
    val_str = str(val).strip()
    val_str = re.sub(r'^(cdt-|kh-|gt-|cg-|nt-|hd-|emp-|user-|tm-)', '', val_str)
    return val_str

from db_setup import SCHEMA_DINH_NGHIA, SPECIAL_FIELD_MAPS, khoi_tao_va_di_tru_he_thong
khoi_tao_va_di_tru_he_thong(database, hash_password, clean_id)

def log_error(e_or_msg, context="System"):
    log_file = os.path.join(project_root, "sync_error.log")
    try:
        now_str = datetime.now().isoformat()
        if isinstance(e_or_msg, Exception):
            tb = traceback.format_exc()
            msg = f"[{now_str}] [{context}] LỖI: {str(e_or_msg)}\n{tb}\n"
        else:
            msg = f"[{now_str}] [{context}] THÔNG BÁO: {str(e_or_msg)}\n"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(msg)
    except Exception:
        pass
    print(f"[{context}] {e_or_msg}")

class ErrorLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        try:
            response = await call_next(request)
            if response.status_code >= 500:
                log_error(f"Phản hồi lỗi server {response.status_code}", f"HTTP {request.method} {request.url.path}")
            return response
        except Exception as e:
            log_error(e, f"HTTP {request.method} {request.url.path}")
            raise e

def format_date_str(date_str):
    if not date_str:
        return '--'
    date_str = str(date_str).strip().split(' ')[0]
    for fmt in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(date_str, fmt).strftime('%d/%m/%Y')
        except ValueError:
            pass
    return date_str

class VietnameseFloat(float):
    def __str__(self):
        try:
            formatted = format(float(self), ",.0f")
            return formatted.replace(",", ".")
        except Exception:
            return super().__str__()

    def __repr__(self):
        return self.__str__()

    def __format__(self, spec):
        try:
            formatted = format(float(self), ",.0f")
            return formatted.replace(",", ".")
        except Exception:
            return super().__format__(spec)

def clean_admin_prefix(name):
    if not name:
        return ""
    pattern = r"^(thành phố|tỉnh|phường|xã|thị trấn)\s+"
    return re.sub(pattern, name, flags=re.IGNORECASE)

from email_helper import gui_email

def get_active_org(request, user_id):
    active_org = request.headers.get('X-Active-Org')
    if active_org:
        import urllib.parse
        active_org = urllib.parse.unquote(active_org)
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc 
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return str(user_id)
        
    for row in rows:
        if active_org and (active_org == row['id'] or active_org == row['ten_to_chuc']):
            return row['id']
            
    return rows[0]['id']
