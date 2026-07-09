import os
import time
import secrets
import json
import hashlib
from collections import defaultdict
from helpers import (
    _org_cache_invalidate_by_user_id
)
from helpers_py.id_utils import stable_org_id

# Configuration from environment
_SECURE_COOKIES = os.environ.get("APP_SECURE_COOKIES", "False").lower() == "true"
SESSION_EXPIRY_HOURS = int(os.environ.get("SESSION_EXPIRY_HOURS", "12"))
SESSION_REMEMBER_EXPIRY_HOURS = int(os.environ.get("SESSION_REMEMBER_EXPIRY_HOURS", "720"))
SESSION_INACTIVITY_TIMEOUT_HOURS = int(os.environ.get("SESSION_INACTIVITY_TIMEOUT_HOURS", "10"))

# Rate Limiter settings
_rate_limit_store = defaultdict(list)   # ip -> [timestamps]
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 60

def get_client_ip(request) -> str:
    """Lấy IP thật từ header X-Forwarded-For hoặc client.host"""
    forwarded = request.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return getattr(request.client, 'host', 'unknown')

def check_rate_limit(ip: str, consume_attempt: bool = True) -> bool:
    """Kiểm tra giới hạn rate limit, kết hợp in-memory + DB persist.

    Mac dinh van ghi nhan attempt de giu tuong thich voi cac flow OTP.
    Login dung consume_attempt=False de chi ghi nhan khi xac thuc that bai.
    """
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    
    # 1) In-memory check
    _rate_limit_store[ip] = [t for t in _rate_limit_store[ip] if t > window_start]
    
    # 2) DB-backed check
    try:
        from helpers import database as _db
        conn = _db.get_connection()
        cur = conn.cursor()
        key = f"rate_limit:{ip}"
        cur.execute("SELECT config_value FROM sys_config WHERE config_key = ?", (key,))
        row = cur.fetchone()
        if row:
            try:
                db_timestamps = [t for t in json.loads(row[0]) if t > window_start]
            except Exception:
                db_timestamps = []
        else:
            db_timestamps = list(_rate_limit_store[ip])
        
        all_timestamps = sorted(set(list(_rate_limit_store[ip]) + db_timestamps))
        all_timestamps = [t for t in all_timestamps if t > window_start]
        
        if len(all_timestamps) >= RATE_LIMIT_MAX:
            conn.close()
            _rate_limit_store[ip] = all_timestamps
            return False

        if not consume_attempt:
            conn.close()
            _rate_limit_store[ip] = all_timestamps
            return True
        
        all_timestamps.append(now)
        cur.execute(
            "INSERT INTO sys_config (config_key, config_value) VALUES (?, ?) "
            "ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value",
            (key, json.dumps(all_timestamps[-RATE_LIMIT_MAX:]))
        )
        conn.commit()
        conn.close()
        _rate_limit_store[ip] = all_timestamps
    except Exception:
        # Fallback
        if len(_rate_limit_store[ip]) >= RATE_LIMIT_MAX:
            return False
        if consume_attempt:
            _rate_limit_store[ip].append(now)
    
    return True

def record_rate_limit_failure(ip: str) -> bool:
    """Ghi nhan mot lan that bai vao rate limiter."""
    return check_rate_limit(ip, consume_attempt=True)

def generate_otp() -> str:
    """Tạo OTP cryptographically secure."""
    return str(secrets.randbelow(900000) + 100000)

def get_user_org_names(cursor, user_id):
    """Lấy danh sách tên các tổ chức của user."""
    cursor.execute("""
        SELECT tc.ten_to_chuc 
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    rows = cursor.fetchall()
    return ", ".join(row['ten_to_chuc'] for row in rows)

def update_user_organizations(cursor, user_id, organization_name, user_role='employee'):
    """Cập nhật tổ chức của người dùng."""
    new_orgs = [o.strip() for o in organization_name.split(',') if o.strip()]
    
    cursor.execute("""
        SELECT tc.id, tc.ten_to_chuc 
        FROM thanh_vien_to_chuc tvtc
        JOIN to_chuc tc ON tvtc.to_chuc_id = tc.id
        WHERE tvtc.user_id = ?
    """, (user_id,))
    current_assoc = {row['ten_to_chuc']: row['id'] for row in cursor.fetchall()}
    
    # 1. Add new associations
    for org_name in new_orgs:
        if org_name not in current_assoc:
            cursor.execute("SELECT id FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
            org_row = cursor.fetchone()
            if org_row:
                org_id = org_row['id']
            else:
                org_id = stable_org_id(org_name)
                cursor.execute(
                    "INSERT OR IGNORE INTO to_chuc (id, ten_to_chuc, quan_ly_id) VALUES (?, ?, ?)",
                    (org_id, org_name, user_id)
                )
            
            role_in_org = 'employee'
            if 'super_admin' in user_role:
                role_in_org = 'super_admin'
            elif 'manager' in user_role:
                role_in_org = 'manager'
            cursor.execute(
                "INSERT OR IGNORE INTO thanh_vien_to_chuc (user_id, to_chuc_id, vai_tro_trong_to_chuc) VALUES (?, ?, ?)",
                (user_id, org_id, role_in_org)
            )
            
    # 2. Remove old associations
    removed_any = False
    for org_name, org_id in current_assoc.items():
        if org_name not in new_orgs:
            cursor.execute(
                "DELETE FROM thanh_vien_to_chuc WHERE user_id = ? AND to_chuc_id = ?",
                (user_id, org_id)
            )
            removed_any = True

    if removed_any:
        _org_cache_invalidate_by_user_id(user_id)
