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




_USERNAME_REGEX = _re.compile(r'^[a-z0-9_]{3,30}$')








_SENSITIVE_WORDS = frozenset([

    "admin", "administrator", "superadmin", "superuser", "root", "sysadmin",
    "system", "support", "helpdesk", "moderator", "staff", "operator",
    "service", "bot", "daemon", "null", "undefined", "anonymous", "guest",
    "test", "demo", "debug", "dev", "devops", "api", "server",
    "billing", "noreply", "no_reply", "postmaster", "webmaster", "hostmaster",
    "info", "contact", "abuse", "security",


    "google", "facebook", "microsoft", "apple", "amazon", "twitter", "tiktok",
    "youtube", "instagram", "linkedin", "github", "gitlab", "openai", "chatgpt",
    "netflix", "spotify", "paypal", "visa", "mastercard",
    "vingroup", "viettel", "vnpt", "mobifone", "vinaphone",
    "biddingflow", "bidding_flow",



    "dit", "dcm", "dm", "lol", "cac", "lon", "bu_lon", "bu_cac",
    "me_may", "fuck", "shit", "ass", "bitch", "bastard", "cunt",
    "porn", "sex", "nude", "xxx", "rape",
])



_SENSITIVE_PATTERNS = [
    _re.compile(r'(?:^|_)' + _re.escape(w) + r'(?:_|$)')
    for w in _SENSITIVE_WORDS
]



def _is_sensitive(username: str) -> bool:
    """Trả True nếu username chứa từ nhạy cảm."""
    u = username.lower()

    if u in _SENSITIVE_WORDS:
        return True

    for pat in _SENSITIVE_PATTERNS:
        if pat.search(u):
            return True
    return False






_RESERVED_ROUTES = frozenset([

    "tong-quan", "ke-hoach", "goi-thau", "mothau", "danh-gia-hsdt",
    "chu-dau-tu", "nha-thau", "chuyen-gia", "hop-dong", "bieu-mau",
    "tong-quan-admin", "quan-ly-tai-khoan", "nhan-su", "trang-thai-ho-so",
    "trang-ca-nhan", "goi-thau-chi-tiet", "ke-hoach-chi-tiet",
    "hop-dong-chi-tiet", "chu-dau-tu-chi-tiet", "nha-thau-chi-tiet",
    "chudautu-detail", "nhathau-detail",

    "api", "auth", "sync", "paginate", "ws", "dist", "views",
    "controllers", "features", "models", "uploads", "static", "templates",
    "holidays", "export", "import", "address",
    "login", "logout", "register", "verify", "forgot", "password",

    "me", "self", "my", "account", "profile", "dashboard",
    "settings", "config", "setup", "install",
])


def _is_reserved(username: str) -> bool:
    """Trả True nếu username trùng với route hệ thống."""
    u = username.lower()

    if u in _RESERVED_ROUTES:
        return True

    if u.replace('_', '-') in _RESERVED_ROUTES:
        return True
    return False






def validate_username(username: str):
    """
    Kiểm tra username theo 3 lớp.

    Tham số:
        username (str): Username cần kiểm tra (đã strip + lower)

    Trả về:
        (True,  "")        nếu hợp lệ
        (False, message)   nếu vi phạm
    """

    if not username or not _USERNAME_REGEX.match(username):
        return False, (
            "Tên đăng nhập chỉ được chứa chữ thường (a-z), số (0-9) và dấu gạch dưới (_), "
            "từ 3 đến 30 ký tự."
        )

    if username.startswith('_') or username.endswith('_'):
        return False, "Tên đăng nhập không được bắt đầu hoặc kết thúc bằng dấu gạch dưới (_)."

    if '__' in username:
        return False, "Tên đăng nhập không được chứa hai dấu gạch dưới liên tiếp (__)."


    if _is_sensitive(username):
        return False, (
            "Tên đăng nhập chứa từ không được phép (nhãn hàng, từ thô tục hoặc từ hệ thống). "
            "Vui lòng chọn tên khác."
        )


    if _is_reserved(username):
        return False, (
            "Tên đăng nhập này trùng với đường dẫn hệ thống và không thể sử dụng. "
            "Vui lòng chọn tên khác."
        )

    return True, ""
