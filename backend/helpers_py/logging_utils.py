import os
import traceback
from datetime import datetime
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))

def log_error(e_or_msg, context="System", level="ERROR"):
    log_file = os.path.join(project_root, "sync_error.log")
    try:
        # Xoay vòng file log nếu > 5MB
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

