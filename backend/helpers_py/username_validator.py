"""
username_validator.py
=====================
Bộ lọc kiểm tra username dùng chung cho toàn hệ thống.

Các lớp kiểm tra (theo thứ tự):
  1. FORMAT  — Chỉ [a-z0-9_], 3-30 ký tự, không bắt đầu/kết thúc bằng '_'
  2. SENSITIVE — Không chứa từ nhãn hàng, từ thô tục, từ hệ thống nguy hiểm
  3. RESERVED  — Không trùng route SPA / API của hệ thống (prefix hoặc toàn phần)

Trả về:
  (True,  "")       — Username hợp lệ
  (False, "Lý do")  — Username vi phạm, kèm thông báo rõ ràng
"""

import re as _re

# ---------------------------------------------------------------------------
# 1. FORMAT
# ---------------------------------------------------------------------------
_USERNAME_REGEX = _re.compile(r'^[a-z0-9_]{3,30}$')


# ---------------------------------------------------------------------------
# 2. TỪ NHẠY CẢM (sensitive keywords)
#    - Nhãn hàng / tổ chức có bản quyền
#    - Từ thô tục / xúc phạm (viết theo cách Latin-only sau khi bỏ dấu)
#    - Từ hệ thống nguy hiểm (admin, root, superuser …)
# ---------------------------------------------------------------------------
_SENSITIVE_WORDS = frozenset([
    # ── Hệ thống / đặc quyền ──────────────────────────────────────────────
    "admin", "administrator", "superadmin", "superuser", "root", "sysadmin",
    "system", "support", "helpdesk", "moderator", "staff", "operator",
    "service", "bot", "daemon", "null", "undefined", "anonymous", "guest",
    "test", "demo", "debug", "dev", "devops", "api", "server",
    "billing", "noreply", "no_reply", "postmaster", "webmaster", "hostmaster",
    "info", "contact", "abuse", "security",

    # ── Nhãn hàng / nền tảng có bản quyền ────────────────────────────────
    "google", "facebook", "microsoft", "apple", "amazon", "twitter", "tiktok",
    "youtube", "instagram", "linkedin", "github", "gitlab", "openai", "chatgpt",
    "netflix", "spotify", "paypal", "visa", "mastercard",
    "vingroup", "viettel", "vnpt", "mobifone", "vinaphone",
    "biddingflow", "bidding_flow",

    # ── Từ thô tục / xúc phạm (dạng ASCII sau bỏ dấu) ────────────────────
    # (Danh sách tối thiểu, đủ để lọc cơ bản – có thể mở rộng)
    "dit", "dcm", "dm", "lol", "cac", "lon", "bu_lon", "bu_cac",
    "me_may", "fuck", "shit", "ass", "bitch", "bastard", "cunt",
    "porn", "sex", "nude", "xxx", "rape",
])

# Regex: khớp nếu username *chứa* bất kỳ từ nhạy cảm nào
# Dùng word-boundary để tránh false-positive (e.g. "classic" chứa "ass")
_SENSITIVE_PATTERNS = [
    _re.compile(r'(?:^|_)' + _re.escape(w) + r'(?:_|$)')
    for w in _SENSITIVE_WORDS
]
# Ngoài ra: khớp toàn bộ username == từ nhạy cảm (đã cover bởi pattern trên)


def _is_sensitive(username: str) -> bool:
    """Trả True nếu username chứa từ nhạy cảm."""
    u = username.lower()
    # Khớp chính xác toàn phần
    if u in _SENSITIVE_WORDS:
        return True
    # Khớp từ trong chuỗi (ngăn cách bởi _ hoặc đầu/cuối)
    for pat in _SENSITIVE_PATTERNS:
        if pat.search(u):
            return True
    return False


# ---------------------------------------------------------------------------
# 3. RESERVED — Route hệ thống (SPA + API prefix)
# ---------------------------------------------------------------------------
# Lấy từ app.py, bao gồm cả các segment đầu của path API
_RESERVED_ROUTES = frozenset([
    # SPA frontend routes
    "tong-quan", "ke-hoach", "goi-thau", "mothau", "danh-gia-hsdt",
    "chu-dau-tu", "nha-thau", "chuyen-gia", "hop-dong", "bieu-mau",
    "tong-quan-admin", "quan-ly-tai-khoan", "nhan-su", "trang-thai-ho-so",
    "trang-ca-nhan", "goi-thau-chi-tiet", "ke-hoach-chi-tiet",
    "hop-dong-chi-tiet", "chu-dau-tu-chi-tiet", "nha-thau-chi-tiet",
    "chudautu-detail", "nhathau-detail",
    # API segments
    "api", "auth", "sync", "paginate", "ws", "dist", "views",
    "controllers", "models", "uploads", "static", "templates",
    "holidays", "export", "import", "address",
    "login", "logout", "register", "verify", "forgot", "password",
    # Misc
    "me", "self", "my", "account", "profile", "dashboard",
    "settings", "config", "setup", "install",
])

# Username có dấu '-' sẽ không qua được regex, nhưng vẫn kiểm tra dạng gạch dưới
def _is_reserved(username: str) -> bool:
    """Trả True nếu username trùng với route hệ thống."""
    u = username.lower()
    # So sánh trực tiếp
    if u in _RESERVED_ROUTES:
        return True
    # Chuẩn hoá: thay '_' → '-' rồi so sánh lại
    if u.replace('_', '-') in _RESERVED_ROUTES:
        return True
    return False


# ---------------------------------------------------------------------------
# PUBLIC API
# ---------------------------------------------------------------------------

def validate_username(username: str):
    """
    Kiểm tra username theo 3 lớp.

    Tham số:
        username (str): Username cần kiểm tra (đã strip + lower)

    Trả về:
        (True,  "")        nếu hợp lệ
        (False, message)   nếu vi phạm
    """
    # --- Lớp 1: Định dạng ---
    if not username or not _USERNAME_REGEX.match(username):
        return False, (
            "Tên đăng nhập chỉ được chứa chữ thường (a-z), số (0-9) và dấu gạch dưới (_), "
            "từ 3 đến 30 ký tự."
        )

    if username.startswith('_') or username.endswith('_'):
        return False, "Tên đăng nhập không được bắt đầu hoặc kết thúc bằng dấu gạch dưới (_)."

    if '__' in username:
        return False, "Tên đăng nhập không được chứa hai dấu gạch dưới liên tiếp (__)."

    # --- Lớp 2: Từ nhạy cảm ---
    if _is_sensitive(username):
        return False, (
            "Tên đăng nhập chứa từ không được phép (nhãn hàng, từ thô tục hoặc từ hệ thống). "
            "Vui lòng chọn tên khác."
        )

    # --- Lớp 3: Trùng route hệ thống ---
    if _is_reserved(username):
        return False, (
            "Tên đăng nhập này trùng với đường dẫn hệ thống và không thể sử dụng. "
            "Vui lòng chọn tên khác."
        )

    return True, ""
