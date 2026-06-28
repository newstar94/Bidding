# ==========================================
# CẤU HÌNH ĐƯỜNG DẪN & RE-EXPORT CÁC THÀNH PHẦN CON (Python Re-export Entry-point)
# ==========================================

import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
models_dir = os.path.join(project_root, 'models')
backend_dir = os.path.join(project_root, 'backend')
helpers_py_dir = os.path.join(backend_dir, 'helpers_py')
routes_dir = os.path.join(backend_dir, 'routes')

sys.path.insert(0, project_root)
sys.path.append(models_dir)
sys.path.append(backend_dir)
sys.path.append(helpers_py_dir)
sys.path.append(routes_dir)

# Import and Re-export from db_helper, media_helper, and auth_helper (Tương thích ngược)
from helpers_py import db_helper
from helpers_py.db_helper import (
    load_and_register,
    models,
    database
)

from helpers_py import media_helper
from helpers_py.media_helper import (
    save_base64_image,
    load_base64_image
)

from helpers_py import auth_helper
from helpers_py.auth_helper import (
    ROLE_HIERARCHY,
    get_effective_roles,
    hash_password,
    verify_password,
    SessionRole,
    verify_session,
    _session_cache_invalidate,
    _session_cache_invalidate_by_user_id
)

# Re-export from new helpers_py package
from helpers_py.schema import SCHEMA_DINH_NGHIA

from helpers_py.text_utils import (
    to_snake_case,
    to_camel_case,
    clean_id,
    clean_admin_prefix,
    format_date_str,
    VietnameseFloat
)

from helpers_py.db_utils import (
    recalculate_is_latest,
    recalculate_tong_muc_dau_tu,
    khoi_tao_va_di_tru_he_thong,
    _build_create_table_sql,
    _normalize_sqlite_type,
    _assert_safe_table
)

from helpers_py.email_utils import (
    gui_email
)

from helpers_py.session_utils import (
    get_active_org,
    _org_cache_cleanup,
    _org_cache_invalidate_by_user_id,
    OrgPermissionError
)

from helpers_py.logging_utils import (
    log_error,
    ErrorLoggingMiddleware
)
