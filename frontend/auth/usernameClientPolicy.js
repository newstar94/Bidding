/* Pure client-side username feedback; the server remains authoritative. */
export function validateUsernameClient(username) {
  const u = (username || "").toLowerCase().trim();
  if (!/^[a-z0-9_]{3,30}$/.test(u)) {
    return { ok: false, message: "Tên đăng nhập chỉ được chứa chữ thường (a-z), số (0-9) và dấu gạch dưới (_), từ 3 đến 30 ký tự." };
  }
  if (u.startsWith("_") || u.endsWith("_")) {
    return { ok: false, message: "Tên đăng nhập không được bắt đầu hoặc kết thúc bằng dấu gạch dưới (_)." };
  }
  if (u.includes("__")) {
    return { ok: false, message: "Tên đăng nhập không được chứa hai dấu gạch dưới liên tiếp (__)." };
  }
  const SENSITIVE = /* @__PURE__ */ new Set([
    // Hệ thống / đặc quyền
    "admin",
    "administrator",
    "superadmin",
    "superuser",
    "root",
    "sysadmin",
    "system",
    "support",
    "helpdesk",
    "moderator",
    "staff",
    "operator",
    "service",
    "bot",
    "daemon",
    "null",
    "undefined",
    "anonymous",
    "guest",
    "test",
    "demo",
    "debug",
    "dev",
    "devops",
    "api",
    "server",
    "billing",
    "noreply",
    "no_reply",
    "postmaster",
    "webmaster",
    "hostmaster",
    "info",
    "contact",
    "abuse",
    "security",
    // Nhãn hàng
    "google",
    "facebook",
    "microsoft",
    "apple",
    "amazon",
    "twitter",
    "tiktok",
    "youtube",
    "instagram",
    "linkedin",
    "github",
    "gitlab",
    "openai",
    "chatgpt",
    "netflix",
    "spotify",
    "paypal",
    "visa",
    "mastercard",
    "vingroup",
    "viettel",
    "vnpt",
    "mobifone",
    "vinaphone",
    "biddingflow",
    "bidding_flow",
    // Từ thô tục (dạng ASCII)
    "dit",
    "dcm",
    "dm",
    "lol",
    "cac",
    "lon",
    "bu_lon",
    "bu_cac",
    "me_may",
    "fuck",
    "shit",
    "ass",
    "bitch",
    "bastard",
    "cunt",
    "porn",
    "sex",
    "nude",
    "xxx",
    "rape"
  ]);
  if (SENSITIVE.has(u)) {
    return { ok: false, message: "Tên đăng nhập chứa từ không được phép (nhãn hàng, từ thô tục hoặc từ hệ thống). Vui lòng chọn tên khác." };
  }
  const parts = u.split("_").filter(Boolean);
  for (const part of parts) {
    if (SENSITIVE.has(part)) {
      return { ok: false, message: "Tên đăng nhập chứa từ không được phép (nhãn hàng, từ thô tục hoặc từ hệ thống). Vui lòng chọn tên khác." };
    }
  }
  const RESERVED = /* @__PURE__ */ new Set([
    "dang-nhap",
    "tong-quan",
    "ke-hoach",
    "goi-thau",
    "mothau",
    "danh-gia-hsdt",
    "chu-dau-tu",
    "nha-thau",
    "chuyen-gia",
    "hop-dong",
    "bieu-mau",
    "xuat-ban-word",
    "tong-quan-admin",
    "quan-ly-tai-khoan",
    "nhan-su",
    "trang-thai-ho-so",
    "trang-ca-nhan",
    "goi-thau-chi-tiet",
    "ke-hoach-chi-tiet",
    "hop-dong-chi-tiet",
    "chu-dau-tu-chi-tiet",
    "nha-thau-chi-tiet",
    "chudautu-detail",
    "nhathau-detail",
    "api",
    "auth",
    "sync",
    "paginate",
    "ws",
    "dist",
    "views",
    "controllers",
    "models",
    "uploads",
    "static",
    "templates",
    "holidays",
    "export",
    "import",
    "address",
    "login",
    "logout",
    "register",
    "verify",
    "forgot",
    "password",
    "me",
    "self",
    "my",
    "account",
    "profile",
    "dashboard",
    "settings",
    "config",
    "setup",
    "install"
  ]);
  if (RESERVED.has(u) || RESERVED.has(u.replace(/_/g, "-"))) {
    return { ok: false, message: "Tên đăng nhập này trùng với đường dẫn hệ thống và không thể sử dụng. Vui lòng chọn tên khác." };
  }
  return { ok: true, message: "" };
}
