import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { consumeModalReturnState } from "./modalReturnState.js";
import { getContractorViewOnly, setContractorViewOnly } from "../shared/runtimeState.js";
function requiredRoleForTab(tabName) {
  if (tabName === "superadmin-dashboard" || tabName === "superadmin") return "super_admin";
  if (tabName === "managernhanvien" || tabName === "managerhosogiay") return "manager";
  return null;
}
function defaultTabForRole(model) {
  return model?.state?.activerole === "super_admin" ? "superadmin-dashboard" : "dashboard";
}
function canAccessTab(controller, tabName) {
  const requiredRole = requiredRoleForTab(tabName);
  return !requiredRole || controller.model.hasActiveEffectiveRole(requiredRole);
}
function guardTabAccess(controller, tabName, action = null, updateState = true) {
  if (canAccessTab(controller, tabName)) {
    return { tabName, action };
  }
  const fallbackTab = defaultTabForRole(controller.model);
  if (typeof controller.view?.showToast === "function") {
    controller.view.showToast(
      "Không có quyền truy cập",
      "Tài khoản của bạn không có quyền mở trang quản trị này.",
      "warning"
    );
  }
  if (updateState) {
    const fallbackUrl = controller.routeMap[fallbackTab] || fallbackTab;
    history.replaceState({ tab: fallbackTab, action: null }, "", "/" + fallbackUrl);
  }
  return { tabName: fallbackTab, action: null };
}
export function setupTheme() {
  document.body.classList.remove("dark-mode");
  localStorage.removeItem(this.model.STORAGE_KEYS.THEME);
}
export function setupSidebar() {
  const appContainer = document.querySelector(".app-container");
  const sidebar = this.view.elements.sidebar;
  const isCollapsed = localStorage.getItem("bf_sidebar_collapsed") === "true";
  if (isCollapsed) appContainer.classList.add("sidebar-collapsed");
  const btnCollapse = document.getElementById("btn-sidebar-collapse");
  if (btnCollapse) {
    btnCollapse.addEventListener("click", () => {
      appContainer.classList.toggle("sidebar-collapsed");
      const collapsed = appContainer.classList.contains("sidebar-collapsed");
      localStorage.setItem("bf_sidebar_collapsed", collapsed);
      this.view.createIconsScoped(sidebar);
    });
  }
  const brandIcon = document.querySelector(".brand-icon");
  if (brandIcon) {
    brandIcon.addEventListener("click", () => {
      if (appContainer.classList.contains("sidebar-collapsed")) {
        appContainer.classList.remove("sidebar-collapsed");
        localStorage.setItem("bf_sidebar_collapsed", "false");
        this.view.createIconsScoped(sidebar);
      }
    });
  }
  this.view.elements.sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("active");
  });
  this.view.elements.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      sidebar.classList.remove("active");
    });
  });
  const currentDate = /* @__PURE__ */ new Date();
  const weekday = currentDate.toLocaleDateString("vi-VN", { weekday: "long" });
  this.view.elements.currentDateSpan.textContent = `${weekday}, ${this.model.formatDate(currentDate)}`;
  const profileCard = document.querySelector(".profile-card");
  if (profileCard) {
    setRuntimeStyle(profileCard, "cursor", "pointer");
    profileCard.addEventListener("click", () => {
      this.switchTab("profile");
      sidebar.classList.remove("active");
    });
  }
}
export function setupTabs() {
  this.view.elements.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      this.switchTab(targetTab);
    });
  });
  const viewAllPackagesBtn = document.getElementById("btn-view-all-packages");
  if (viewAllPackagesBtn) {
    viewAllPackagesBtn.addEventListener("click", () => {
      this.switchTab("goithau");
    });
  }
}
export function handlePathRouting(pathname, updateState = true, isInit = false) {
  const cleanPath = pathname.startsWith("/") ? pathname.substring(1) : pathname;
  const parts = cleanPath.split("/").filter(Boolean);
  const urlTab = parts[0] || "";
  let tabName = "";
  for (const [key, val] of Object.entries(this.routeMap)) {
    if (val === urlTab) {
      tabName = key;
      break;
    }
  }
  if (!tabName) {
    if (urlTab === "chudautu-detail") {
      tabName = "chudautu-detail";
    } else if (urlTab === "nhathau-detail") {
      tabName = "nhathau-detail";
    } else {
      tabName = defaultTabForRole(this.model);
    }
  }
  let action = parts[1] || null;
  let urlAction = parts[1] || null;
  if (!action && urlAction) {
    action = urlAction;
  }
  if (tabName === "chudautu-detail" && action) {
    let targetId = null;
    if (action.includes("_")) {
      const parts2 = action.split("_");
      const idSuffix = parts2[parts2.length - 1].toLowerCase();
      const cdt = (this.model.state.chudautu || []).find((c) => c.id.toLowerCase().startsWith(idSuffix));
      if (cdt) targetId = cdt.id;
    }
    if (!targetId) {
      const cdt = (this.model.state.chudautu || []).find(
        (c) => c.maChuDauTu && c.maChuDauTu.toLowerCase() === action.toLowerCase() || c.id && c.id.toLowerCase() === action.toLowerCase()
      );
      if (cdt) targetId = cdt.id;
    }
    if (targetId) {
      const cdt = (this.model.state.chudautu || []).find((c) => c.id === targetId);
      const root = cdt ? cdt.rootId || cdt.id : targetId;
      const latest = (this.model.state.chudautu || []).find((c) => (c.rootId === root || c.id === root) && c.isLatest == 1);
      action = latest ? latest.id : targetId;
    }
  }
  if (tabName === "nhathau-detail" && action) {
    let targetId = null;
    if (action.includes("_")) {
      const parts2 = action.split("_");
      const idSuffix = parts2[parts2.length - 1].toLowerCase();
      const nt = (this.model.state.nhathau || []).find((n) => n.id.toLowerCase().startsWith(idSuffix));
      if (nt) targetId = nt.id;
    }
    if (!targetId) {
      const nt = (this.model.state.nhathau || []).find(
        (n) => n.maNhaThau && n.maNhaThau.toLowerCase() === action.toLowerCase() || n.id && n.id.toLowerCase() === action.toLowerCase()
      );
      if (nt) targetId = nt.id;
    }
    if (targetId) {
      const nt = (this.model.state.nhathau || []).find((n) => n.id === targetId);
      const root = nt ? nt.rootId || nt.id : targetId;
      const latest = (this.model.state.nhathau || []).find((n) => (n.rootId === root || n.id === root) && n.isLatest == 1);
      action = latest ? latest.id : targetId;
    }
  }
  if (tabName === "goithau-detail" && action) {
    const gt = this.model.state.goithau.find(
      (g) => g.maGoiThau && g.maGoiThau.toLowerCase() === action.toLowerCase() || g.id && g.id.toLowerCase() === action.toLowerCase()
    );
    if (gt) {
      const latestGt = this.model.getLatestPackage(gt.id);
      action = latestGt ? latestGt.id : gt.id;
    }
  }
  if (tabName === "kehoach-detail" && action) {
    let targetId = null;
    if (action.includes("_")) {
      const parts2 = action.split("_");
      const idSuffix = parts2[parts2.length - 1].toLowerCase();
      const kh = this.model.state.kehoach.find((k) => k.id.toLowerCase().startsWith(idSuffix));
      if (kh) targetId = kh.id;
    }
    if (!targetId) {
      const kh = this.model.state.kehoach.find(
        (k) => k.maKeHoach && encodeURIComponent(k.maKeHoach).toLowerCase() === action.toLowerCase() || k.id && k.id.toLowerCase() === action.toLowerCase()
      );
      if (kh) targetId = kh.id;
    }
    if (targetId) {
      const latestKh = this.model.getLatestPlan(targetId);
      action = latestKh ? latestKh.id : targetId;
    }
  }
  if (tabName === "hopdong-detail" && action) {
    let targetId = null;
    if (action.includes("_")) {
      const parts2 = action.split("_");
      const idSuffix = parts2[parts2.length - 1].toLowerCase();
      const hd = this.model.state.hopdong.find((h) => h.id.toLowerCase().startsWith(idSuffix));
      if (hd) targetId = hd.id;
    }
    if (!targetId) {
      const cleanAction = decodeURIComponent(action).toLowerCase().replace(/[\/-]/g, "");
      const hd = this.model.state.hopdong.find((h) => {
        const cleanSo = h.soHopDong ? h.soHopDong.toLowerCase().replace(/[\/-]/g, "") : "";
        return cleanSo === cleanAction || h.id && h.id.toLowerCase() === action.toLowerCase();
      });
      if (hd) targetId = hd.id;
    }
    if (targetId) {
      const latestHd = this.model.getLatestContract(targetId);
      action = latestHd ? latestHd.id : targetId;
    }
  }
  if (action && typeof this.ensureDetailRecordLoaded === "function") {
    const pendingDetailLoad = this.ensureDetailRecordLoaded(tabName, action);
    if (pendingDetailLoad) {
      return pendingDetailLoad.then((record) => {
        if (record) {
          return this.handlePathRouting(pathname, updateState, isInit);
        } else {
          return this.switchTab(tabName, action, updateState);
        }
      });
    }
  }
  const guardedRoute = guardTabAccess(this, tabName, action, true);
  tabName = guardedRoute.tabName;
  action = guardedRoute.action;
  if (isInit) {
    const finalUrlTab = this.routeMap[tabName] || tabName;
    let finalUrlAction = action ? this.actionMap[action] || action : null;
    if (tabName === "goithau-detail" && action) {
      const gt = this.model.state.goithau.find((g) => g.id === action);
      if (gt && gt.maGoiThau) {
        finalUrlAction = gt.maGoiThau;
      }
    }
    if (tabName === "kehoach-detail" && action) {
      const kh = this.model.state.kehoach.find((k) => k.id === action);
      if (kh && kh.maKeHoach) {
        const duplicates = this.model.state.kehoach.filter((k) => k.maKeHoach === kh.maKeHoach);
        const isUnique = duplicates.length <= 1;
        finalUrlAction = encodeURIComponent(kh.maKeHoach) + (isUnique ? "" : "_" + kh.id.substring(0, 8));
      }
    }
    if (tabName === "hopdong-detail" && action) {
      const hd = this.model.state.hopdong.find((h) => h.id === action);
      if (hd && hd.soHopDong) {
        const duplicates = this.model.state.hopdong.filter((h) => h.soHopDong === hd.soHopDong);
        const isUnique = duplicates.length <= 1;
        finalUrlAction = encodeURIComponent(hd.soHopDong.replace(/\//g, "-")) + (isUnique ? "" : "_" + hd.id.substring(0, 8));
      }
    }
    if (tabName === "chudautu-detail" && action) {
      const cdt = this.model.state.chudautu.find((c) => c.id === action);
      if (cdt && cdt.maChuDauTu) {
        const duplicates = this.model.state.chudautu.filter((c) => c.maChuDauTu === cdt.maChuDauTu);
        const isUnique = duplicates.length <= 1;
        finalUrlAction = encodeURIComponent(cdt.maChuDauTu) + (isUnique ? "" : "_" + cdt.id.substring(0, 8));
      }
    }
    if (tabName === "nhathau-detail" && action) {
      const nt = this.model.state.nhathau.find((n) => n.id === action);
      if (nt && nt.maNhaThau) {
        const duplicates = this.model.state.nhathau.filter((n) => n.maNhaThau === nt.maNhaThau);
        const isUnique = duplicates.length <= 1;
        finalUrlAction = encodeURIComponent(nt.maNhaThau) + (isUnique ? "" : "_" + nt.id.substring(0, 8));
      }
    }
    const path = "/" + finalUrlTab + (finalUrlAction ? "/" + finalUrlAction : "");
    if (window.location.pathname !== path) {
      history.replaceState({ tab: tabName, action }, "", path);
    }
  }
  return this.switchTab(tabName, action, updateState);
}
export function switchTab(tabName, action = null, updateState = true) {
  const guardedRoute = guardTabAccess(this, tabName, action, updateState);
  tabName = guardedRoute.tabName;
  action = guardedRoute.action;
  if (!this.view.areViewModulesReady(tabName)) {
    return this.view.ensureViewModules(tabName).then(() => this.switchTab(tabName, action, updateState)).catch((err) => {
      console.error("Failed to load view module:", tabName, err);
      this.view?.showToast?.("Không tải được giao diện", "Vui lòng tải lại trang và thử lại.", "error");
    });
  }
  const workflowTabs = ["mothau", "danhgiahsdt"];
  if (!this._workflowModulesReady && (action === "taomoi" || workflowTabs.includes(tabName))) {
    return this.ensureWorkflowModules().then(() => this.switchTab(tabName, action, updateState)).catch((err) => {
      console.error("Failed to load workflow module:", tabName, err);
      this.view?.showToast?.("Không tải được chức năng", "Vui lòng thử lại.", "error");
    });
  }
  if (!document.getElementById(`tab-${tabName}`) && this.lazyTabPartials?.[tabName]) {
    return this.ensureLazyTab(tabName).then(() => this.switchTab(tabName, action, updateState)).catch((err) => {
      console.error("Failed to lazy-load tab:", tabName, err);
      this.view?.showToast?.("Không tải được giao diện", "Vui lòng tải lại trang và thử lại.", "error");
    });
  }
  this.model.state.activetab = tabName;
  this.model.state.activeaction = action;
  if (updateState) {
    const urlTab = this.routeMap[tabName] || tabName;
    let urlAction = action ? this.actionMap[action] || action : null;
    if (tabName === "goithau-detail" && action) {
      const gt = this.model.state.goithau.find((g) => g.id === action);
      if (gt && gt.maGoiThau) {
        urlAction = gt.maGoiThau;
      }
    }
    if (tabName === "kehoach-detail" && action) {
      const kh = this.model.state.kehoach.find((k) => k.id === action);
      if (kh && kh.maKeHoach) {
        const duplicates = this.model.state.kehoach.filter((k) => k.maKeHoach === kh.maKeHoach);
        const isUnique = duplicates.length <= 1;
        urlAction = encodeURIComponent(kh.maKeHoach) + (isUnique ? "" : "_" + kh.id.substring(0, 8));
      }
    }
    if (tabName === "hopdong-detail" && action) {
      const hd = this.model.state.hopdong.find((h) => h.id === action);
      if (hd && hd.soHopDong) {
        const duplicates = this.model.state.hopdong.filter((h) => h.soHopDong === hd.soHopDong);
        const isUnique = duplicates.length <= 1;
        urlAction = encodeURIComponent(hd.soHopDong.replace(/\//g, "-")) + (isUnique ? "" : "_" + hd.id.substring(0, 8));
      }
    }
    if (tabName === "chudautu-detail" && action) {
      const cdt = this.model.state.chudautu.find((c) => c.id === action);
      if (cdt && cdt.maChuDauTu) {
        const duplicates = this.model.state.chudautu.filter((c) => c.maChuDauTu === cdt.maChuDauTu);
        const isUnique = duplicates.length <= 1;
        urlAction = encodeURIComponent(cdt.maChuDauTu) + (isUnique ? "" : "_" + cdt.id.substring(0, 8));
      }
    }
    if (tabName === "nhathau-detail" && action) {
      const nt = this.model.state.nhathau.find((n) => n.id === action);
      if (nt && nt.maNhaThau) {
        const duplicates = this.model.state.nhathau.filter((n) => n.maNhaThau === nt.maNhaThau);
        const isUnique = duplicates.length <= 1;
        urlAction = encodeURIComponent(nt.maNhaThau) + (isUnique ? "" : "_" + nt.id.substring(0, 8));
      }
    }
    const path = "/" + urlTab + (urlAction ? "/" + urlAction : "");
    history.pushState({ tab: tabName, action }, "", path);
  }
  this.view.elements.navButtons = document.querySelectorAll(".nav-btn");
  this.view.elements.tabPanes = document.querySelectorAll(".tab-pane");
  const parentNavigationTab = {
    mothau: "goithau",
    danhgiahsdt: "goithau",
    "goithau-detail": "goithau",
    "kehoach-detail": "kehoach",
    "hopdong-detail": "hopdong",
    "chudautu-detail": "chudautu",
    "nhathau-detail": "nhathau"
  }[tabName] || tabName;
  this.view.elements.navButtons.forEach((btn) => {
    if (btn.getAttribute("data-tab") === parentNavigationTab) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  this.view.elements.tabPanes.forEach((pane) => {
    if (pane.id === `tab-${tabName}`) {
      pane.classList.add("active");
    } else {
      pane.classList.remove("active");
    }
  });
  const titleMap = {
    dashboard: "Tổng quan hệ thống",
    kehoach: "Kế hoạch lựa chọn nhà thầu",
    goithau: "Danh sách Gói thầu",
    chudautu: "Danh mục Chủ đầu tư",
    nhathau: "Danh mục Nhà thầu",
    chuyengia: "Tổ Chuyên gia Đấu thầu",
    hopdong: "Danh sách Hợp đồng",
    bieumau: "Quản lý Biểu mẫu & Từ điển",
    "superadmin-dashboard": "Bảng điều khiển Super Admin BiddingFlow",
    superadmin: "Quản lý Đơn vị & Tài khoản Thành viên",
    managernhanvien: "Quản lý Chuyên viên & Phân quyền Matrix",
    managerhosogiay: "Cấu hình Danh mục Trạng thái Hồ sơ giấy",
    mothau: "Nhập thông tin Mở thầu (E-HSDT / E-HSĐXKT)",
    danhgiahsdt: "Đánh giá Hồ sơ dự thầu (E-HSDT)",
    "goithau-detail": "Chi tiết Quy trình Gói thầu",
    "kehoach-detail": "Chi tiết Kế hoạch Lựa chọn Nhà thầu",
    "hopdong-detail": "Chi tiết Hợp đồng",
    "chudautu-detail": "Chi tiết Chủ đầu tư",
    "nhathau-detail": "Chi tiết Nhà thầu",
    profile: "Thông tin tài khoản cá nhân"
  };
  this.view.elements.pageTitle.textContent = titleMap[tabName] || "Hệ thống Quản lý";
  this.renderTabData(tabName, action);
  if (action === "taomoi") {
    setTimeout(() => {
      if (tabName === "kehoach") {
        const modal = document.getElementById("modal-kehoach");
        if (!modal || !modal.classList.contains("active")) this.editKeHoach(null);
      } else if (tabName === "goithau") {
        const modal = document.getElementById("modal-goithau");
        if (!modal || !modal.classList.contains("active")) this.editGoiThau(null);
      } else if (tabName === "hopdong") {
        const modal = document.getElementById("modal-hopdong");
        if (!modal || !modal.classList.contains("active")) this.editHopDong(null);
      } else if (tabName === "chudautu") {
        const modal = document.getElementById("modal-chudautu");
        if (!modal || !modal.classList.contains("active")) this.editChuDauTu(null);
      } else if (tabName === "nhathau") {
        const modal = document.getElementById("modal-nhathau");
        if (!modal || !modal.classList.contains("active")) this.editNhaThau(null);
      } else if (tabName === "chuyengia") {
        const modal = document.getElementById("modal-chuyengia");
        if (!modal || !modal.classList.contains("active")) this.editChuyenGia(null);
      }
    }, 100);
  } else if (!action) {
    document.querySelectorAll(".modal-overlay:not(#modal-custom-dialog)").forEach((el) => el.classList.remove("active"));
    const activeModals = document.querySelectorAll(".modal-overlay.active");
    if (activeModals.length === 0) {
      setRuntimeStyle(document.body, "overflow", "");
    }
  }
}

export function setupProfileDropdownEvents() {
  if (document.__bfProfileDropdownEventsBound) return;
  document.__bfProfileDropdownEventsBound = true;
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.(".header-profile-trigger");
    const dropdown = document.getElementById("profile-dropdown-menu");
    if (!dropdown) return;
    const profileButton = event.target.closest?.("#btn-dropdown-profile");
    if (profileButton) {
      event.preventDefault();
      dropdown.classList.remove("active");
      this.switchTab("profile");
      return;
    }
    if (trigger) {
      event.stopPropagation();
      dropdown.classList.toggle("active");
      return;
    }
    if (!event.target.closest?.("#profile-dropdown-menu")) {
      dropdown.classList.remove("active");
    }
  });
}
export function renderTabData(tabName, action = null) {
  switch (tabName) {
    case "dashboard":
      this.view.renderDashboard();
      break;
    case "kehoach":
      this.view.renderKeHoachTable();
      break;
    case "goithau":
      this.view.renderGoiThauTable();
      break;
    case "chudautu":
      this.view.renderChuDauTuTable();
      break;
    case "nhathau":
      this.view.renderNhaThauTable();
      break;
    case "chuyengia":
      this.view.renderChuyenGiaTable();
      break;
    case "hopdong":
      this.view.renderHopDongTable();
      break;
    case "bieumau":
      this.setupWordTemplatesEvents();
      this.loadWordTemplates();
      this.view.renderDictionary("global");
      this.setupCopyVariableEvents();
      break;
    case "superadmin-dashboard":
      this.view.renderSuperAdminDashboard();
      break;
    case "superadmin":
      this.view.renderSuperAdminPanel();
      this.loadSystemUsers();
      break;
    case "managernhanvien":
      this.reloadEmployeesFromDatabase().then(() => {
        this.view.renderManagerNhanVienPanel();
      });
      break;
    case "managerhosogiay":
      this.view.renderManagerHoSoGiayPanel();
      break;
    case "profile":
      this.view.renderProfileTab(this.model.state.activeuser);
      break;
    case "mothau":
      this.renderMoThauPanel();
      break;
    case "danhgiahsdt":
      this.renderDanhGiaHsdtPanel();
      break;
    case "goithau-detail":
      const activeId = action || (history.state ? history.state.action : null);
      if (activeId) {
        this.view.showPackageDetails(activeId);
      } else {
        this.switchTab("goithau");
      }
      break;
    case "kehoach-detail":
      const khId = action || (history.state ? history.state.action : null);
      if (khId) {
        this.view.showKeHoachDetails(khId);
      } else {
        this.switchTab("kehoach");
      }
      break;
    case "hopdong-detail":
      const hdId = action || (history.state ? history.state.action : null);
      if (hdId) {
        this.view.showHopDongDetails(hdId);
      } else {
        this.switchTab("hopdong");
      }
      break;
    case "chudautu-detail":
      const cdtId = action || (history.state ? history.state.action : null);
      if (cdtId) {
        this.view.showChuDauTuDetails(cdtId);
      } else {
        this.switchTab("chudautu");
      }
      break;
    case "nhathau-detail":
      const ntId = action || (history.state ? history.state.action : null);
      if (ntId) {
        this.view.showNhaThauDetails(ntId);
      } else {
        this.switchTab("nhathau");
      }
      break;
  }
  const activePane = document.getElementById(`tab-${tabName}`) || this.view.getActiveEnhancementRoot();
  this.view.createIconsScoped(document.getElementById("sidebar"));
  this.view.createIconsScoped(document.querySelector(".top-header") || document.querySelector(".app-header") || document.querySelector("header"));
  this.view.createIconsScoped(activePane);
  this.view.enhanceVisibleContent(activePane);
}
export async function closeModal(modalId, options = {}) {
  const restoreRoute = options?.restoreRoute !== false;
  if (modalId === "modal-goithau" && this.packageWizard.active) {
    const confirmed = await this.view.customConfirm(
      "Xác nhận hủy",
      "Hệ thống đang trong quá trình thiết lập các gói thầu cho kế hoạch mới. Bạn có chắc chắn muốn hủy bỏ? Các gói thầu đã nhập trước đó vẫn được lưu lại."
    );
    if (!confirmed) {
      return;
    }
    this.packageWizard.active = false;
    const planSelect = document.getElementById("gt-kehoachid");
    if (planSelect) planSelect.disabled = false;
  }
  if (modalId === "modal-plan-breakdown") {
    if (this.backupKeHoachState) {
      this.model.state.kehoach = this.backupKeHoachState;
      this.backupKeHoachState = null;
    }
    if (this.backupGoiThauState) {
      this.model.state.goithau = this.backupGoiThauState;
      this.backupGoiThauState = null;
    }
    this.tempPlanData = null;
    this.tempPlanAction = null;
    this.model.persistData("kehoach");
    this.model.persistData("goithau");
    this.view.renderKeHoachTable();
    this.view.renderGoiThauTable();
    this.autoSync();
  }
  this.view.closeModal(modalId);
  if (!restoreRoute) return;
  if (modalId === "modal-kehoach") {
    const { tab: destTab, action: destAction } = consumeModalReturnState("kehoach");
    this.switchTab(destTab, destAction, true);
  } else if (modalId === "modal-goithau") {
    const modalBreakdown = document.getElementById("modal-plan-breakdown");
    const modalKeHoach = document.getElementById("modal-kehoach");
    const isParentModalActive = modalBreakdown && modalBreakdown.classList.contains("active") || modalKeHoach && modalKeHoach.classList.contains("active");
    if (!isParentModalActive) {
      const { tab: destTab, action: destAction } = consumeModalReturnState("goithau");
      this.switchTab(destTab, destAction, true);
    }
  } else if (modalId === "modal-chudautu") {
    const contractModal = document.getElementById("modal-hopdong");
    if (!contractModal || !contractModal.classList.contains("active")) {
      this.switchTab("chudautu", null, true);
    }
  } else if (modalId === "modal-nhathau") {
    if (getContractorViewOnly()) {
      setContractorViewOnly(false);
    } else {
      const contractModal = document.getElementById("modal-hopdong");
      if (!contractModal || !contractModal.classList.contains("active")) {
        this.switchTab("nhathau", null, true);
      }
    }
  } else if (modalId === "modal-chuyengia") {
    this.switchTab("chuyengia", null, true);
  } else if (modalId === "modal-hopdong") {
    const { tab: destTab, action: destAction } = consumeModalReturnState("hopdong");
    this.switchTab(destTab, destAction, true);
  } else if (modalId === "modal-plan-breakdown") {
    const { tab: destTab, action: destAction } = consumeModalReturnState("kehoach");
    this.switchTab(destTab, destAction, true);
  }
}
