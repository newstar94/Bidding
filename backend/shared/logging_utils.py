import os
import traceback
import json
import sqlite3
import time
from datetime import datetime
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from backend.shared.client_ip import get_client_ip

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))

def log_error(e_or_msg, context="System", level="ERROR"):
    log_file = os.path.join(project_root, "sync_error.log")
    try:

        if os.path.exists(log_file) and os.path.getsize(log_file) > 5 * 1024 * 1024:
            try:
                backup_file = log_file + ".1"
                if os.path.exists(backup_file):
                    os.remove(backup_file)
                os.rename(log_file, backup_file)
            except Exception:
                try:
                    with open(log_file, "w", encoding="utf-8") as f:
                        f.write(f"[{datetime.now().isoformat()}] Log file truncated due to size limit.\n")
                except Exception:
                    pass

        now_str = datetime.now().isoformat()
        if isinstance(e_or_msg, Exception):
            tb = traceback.format_exc()
            msg = f"[{now_str}] [{context}] [{level}] LỖI: {str(e_or_msg)}\n{tb}\n"
        else:
            msg = f"[{now_str}] [{context}] [{level}] THÔNG BÁO: {str(e_or_msg)}\n"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(msg)
    except Exception:
        pass
    if os.environ.get("APP_DEBUG", "False").lower() == "true":
        print(f"[{context}] [{level}] {e_or_msg}")


def log_audit(action, actor_user_id=None, owner_id=None, target_type=None, target_id=None, request=None, metadata=None):

    conn = None
    try:
        ip_address = None
        if request is not None:
            ip_address = get_client_ip(request)

        metadata_json = None
        if metadata is not None:
            metadata_json = json.dumps(metadata, ensure_ascii=False, default=str)

        sql = """
            INSERT INTO audit_log (
                actor_user_id, owner_id, action, target_type, target_id, ip_address, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            actor_user_id,
            owner_id,
            action,
            target_type,
            target_id,
            ip_address,
            metadata_json,
        )

        from backend.shared.helpers import database as _db
        last_err = None
        for attempt in range(3):
            try:
                conn = _db.get_connection()
                try:
                    conn.execute("PRAGMA busy_timeout = 1000")
                except Exception:
                    pass
                cur = conn.cursor()
                cur.execute(sql, params)
                conn.commit()
                return
            except sqlite3.OperationalError as err:
                last_err = err
                if conn:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = None
                if "locked" not in str(err).lower() or attempt == 2:
                    raise
                time.sleep(0.05 * (attempt + 1))
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = None

        if last_err:
            raise last_err
    except Exception as audit_err:
        log_error(audit_err, "audit_log", level="WARN")



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
