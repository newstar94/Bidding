(() => {
  if (window.location.pathname === "/") return;
  const readJson = (value, fallback = null) => {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  };
  const resolveActiveRole = (user) => {
    const requested = readJson(sessionStorage.getItem("bf_active_role"))
      || readJson(localStorage.getItem("bf_active_role"));
    const effectiveRoles = Array.isArray(user?.effective_roles) ? user.effective_roles : [];
    const allowed = new Set(effectiveRoles);
    let switchableRoles;
    if (allowed.has("super_admin")) switchableRoles = ["super_admin", "manager", "employee"];
    else if (allowed.has("manager")) switchableRoles = ["manager", "employee"];
    else if (allowed.has("employee")) switchableRoles = ["employee"];
    else switchableRoles = ["employee"];
    return requested && switchableRoles.includes(requested) ? requested : switchableRoles[0];
  };
  const hydrateStableShell = () => {
    const appContainer = document.querySelector(".app-container");
    if (localStorage.getItem("bf_sidebar_collapsed") === "true") {
      appContainer?.classList.add("sidebar-collapsed");
    }

    const currentDate = new Date();
    const month = currentDate.getMonth() + 1;
    const displayMonth = month === 1 || month === 2 ? String(month).padStart(2, "0") : String(month);
    const weekday = currentDate.toLocaleDateString("vi-VN", { weekday: "long" });
    const dateText = document.querySelector("#current-date span");
    if (dateText) {
      dateText.textContent = `${weekday}, ${String(currentDate.getDate()).padStart(2, "0")}/${displayMonth}/${currentDate.getFullYear()}`;
    }

    const sessionNode = document.getElementById("bf-session-bootstrap");
    const bootstrap = readJson(sessionNode?.textContent);
    if (!bootstrap?.valid || !bootstrap.user) return;
    const user = bootstrap.user;
    const activeRole = resolveActiveRole(user);
    const roleLabels = {
      super_admin: "Super Admin",
      manager: "Quản lý",
      employee: "Chuyên viên"
    };
    const name = user.name || user.username || "Người dùng";
    const profileName = document.getElementById("header-profile-name");
    const profileRole = document.getElementById("header-profile-role");
    const avatar = document.getElementById("header-profile-avatar");
    if (profileName) profileName.textContent = name;
    if (profileRole) profileRole.textContent = `Chế độ: ${roleLabels[activeRole] || roleLabels.employee}`;
    if (avatar) {
      avatar.dataset.bfRole = activeRole;
      if (user.avatar) {
        const image = document.createElement("img");
        image.src = user.avatar;
        image.alt = "Avatar";
        image.addEventListener("error", () => {
          avatar.replaceChildren();
          avatar.classList.remove("has-image");
          avatar.classList.add("has-initials");
          avatar.textContent = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U";
        }, { once: true });
        avatar.replaceChildren(image);
        avatar.classList.add("has-image");
        avatar.classList.remove("has-initials");
      } else {
        avatar.classList.remove("has-image");
        avatar.classList.add("has-initials");
        avatar.textContent = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      }
    }

    const organizations = Array.isArray(user.organizations) ? user.organizations : [];
    let activeOrg = String(user.active_org_id || sessionStorage.getItem("bf_active_org") || localStorage.getItem("bf_active_org") || "");
    let selectedOrganization = organizations.find((organization) => organization.id === activeOrg && organization.status === "active");
    if (!selectedOrganization) selectedOrganization = organizations.find((organization) => organization.status === "active") || null;
    activeOrg = selectedOrganization?.id || "";
    if (activeOrg) {
      sessionStorage.setItem("bf_active_org", activeOrg);
      localStorage.setItem("bf_active_org", activeOrg);
    } else {
      sessionStorage.removeItem("bf_active_org");
      localStorage.removeItem("bf_active_org");
    }
    const orgPill = document.getElementById("header-active-org-pill");
    const orgName = document.getElementById("header-active-org-name");
    const orgPillContainer = document.getElementById("workspace-pill-container");
    if (orgPillContainer) orgPillContainer.hidden = !selectedOrganization;
    if (orgPill && orgName && selectedOrganization) {
      orgName.textContent = selectedOrganization.name;
    }

    document.querySelectorAll(".role-menu-superadmin").forEach((item) => {
      item.hidden = activeRole !== "super_admin";
    });
    document.querySelectorAll(".role-menu-manager").forEach((item) => {
      item.hidden = activeRole !== "manager";
    });
    document.querySelectorAll(".role-menu-client").forEach((item) => {
      item.hidden = activeRole === "super_admin";
    });
  };

  hydrateStableShell();
  const route = window.location.pathname.split("/").filter(Boolean)[0] || "tong-quan";
  const routes = {
    "tong-quan": ["dashboard", "Tổng quan hệ thống", "tổng quan"],
    "ke-hoach": ["kehoach", "Kế hoạch lựa chọn nhà thầu", "kế hoạch lựa chọn nhà thầu"],
    "goi-thau": ["goithau", "Danh sách Gói thầu", "danh sách gói thầu"],
    "timeline-goi-thau": ["goithau-timeline", "Timeline gói thầu", "timeline gói thầu"],
    mothau: ["goithau", "Nhập thông tin Mở thầu (E-HSDT / E-HSĐXKT)", "thông tin mở thầu"],
    "danh-gia-hsdt": ["goithau", "Đánh giá Hồ sơ dự thầu (E-HSDT)", "đánh giá hồ sơ dự thầu"],
    "hop-dong": ["hopdong", "Danh sách Hợp đồng", "danh sách hợp đồng"],
    "chu-dau-tu": ["chudautu", "Danh mục Chủ đầu tư", "danh mục chủ đầu tư"],
    "nha-thau": ["nhathau", "Danh mục Nhà thầu", "danh mục nhà thầu"],
    "chuyen-gia": ["chuyengia", "Tổ Chuyên gia Đấu thầu", "danh sách chuyên gia"],
    "bieu-mau": ["bieumau", "Quản lý Biểu mẫu & Từ điển", "biểu mẫu và từ điển"],
    "tong-quan-admin": ["superadmin-dashboard", "Bảng điều khiển Super Admin BiddingFlow", "tổng quan quản trị"],
    "quan-ly-tai-khoan": ["superadmin", "Quản lý Đơn vị & Tài khoản Thành viên", "tài khoản thành viên"],
    "nhan-su": ["managernhanvien", "Quản lý Chuyên viên & Phân quyền Matrix", "nhân sự và phân quyền"],
    "trang-thai-ho-so": ["managerhosogiay", "Cấu hình Danh mục Trạng thái Hồ sơ giấy", "trạng thái hồ sơ giấy"],
    "trang-ca-nhan": ["profile", "Thông tin tài khoản cá nhân", "thông tin tài khoản"],
    "goi-thau-chi-tiet": ["goithau", "Chi tiết Quy trình Gói thầu", "chi tiết gói thầu"],
    "ke-hoach-chi-tiet": ["kehoach", "Chi tiết Kế hoạch Lựa chọn Nhà thầu", "chi tiết kế hoạch"],
    "hop-dong-chi-tiet": ["hopdong", "Chi tiết Hợp đồng", "chi tiết hợp đồng"],
    "chu-dau-tu-chi-tiet": ["chudautu", "Chi tiết Chủ đầu tư", "chi tiết chủ đầu tư"],
    "nha-thau-chi-tiet": ["nhathau", "Chi tiết Nhà thầu", "chi tiết nhà thầu"]
  };
  const [tab, title, loadingLabel] = routes[route] || routes["tong-quan"];
  const pageTitle = document.getElementById("page-title");
  const loadingTitle = document.getElementById("initial-route-loading-title");
  if (pageTitle) pageTitle.textContent = title;
  if (loadingTitle) loadingTitle.textContent = `Đang tải dữ liệu ${loadingLabel}`;
  document.querySelectorAll(".nav-btn.active").forEach((button) => button.classList.remove("active"));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add("active");
  document.querySelectorAll(".tab-pane.active").forEach((pane) => pane.classList.remove("active"));
  document.getElementById(`tab-${tab}`)?.classList.add("active");
})();
