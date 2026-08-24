import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { consumeModalReturnState } from "./modalReturnState.js";
import { restoreRecordSnapshot } from "../shared/recordSnapshot.js";
import { restorePlanBreakdownDraft } from "../plans/planBreakdownDraft.js";
import {
  findPlanVersionDraftSession,
  persistActivePlanVersionDraftSession,
  removePlanVersionDraftSession,
} from "../plans/PlanVersionDraftSession.js";
import { getContractorViewOnly, setContractorViewOnly } from "../shared/runtimeState.js";
import { workflowRequirementForRoute } from "./WorkflowModuleLoader.js";
import { resolveLatestVersion } from "../shared/versionResolver.js";
import {
  createCompactSidebarMediaQuery,
  createSidebarMediaQuery,
  handleProfileMenuKeydown,
  setDesktopSidebarCollapsed,
  setMobileSidebarOpen,
  setProfileMenuOpen,
  synchronizeProfileMenu,
  synchronizeSidebarViewport
} from "./shellAccessibility.js";
function requiredRoleForTab(tabName) {
  if (tabName === "superadmin-dashboard" || tabName === "superadmin") return "super_admin";
  if (tabName === "managernhanvien" || tabName === "managerhosogiay") return "manager";
  return null;
}
function defaultTabForRole(model) {
  return model?.state?.activerole === "super_admin" ? "superadmin-dashboard" : "dashboard";
}

export function resolvePackageDetailRoute(model, action, snapshotId = "") {
  const packages = model?.state?.goithau || [];
  const requestedSnapshot = snapshotId
    ? packages.find((pkg) => String(pkg?.id || "").toLowerCase() === String(snapshotId).toLowerCase())
    : null;
  if (requestedSnapshot) {
    return {
      packageId: requestedSnapshot.id,
      planSnapshotId: requestedSnapshot.keHoachId || "",
    };
  }

  const requested = packages.find((pkg) => (
    (pkg?.maGoiThau && pkg.maGoiThau.toLowerCase() === String(action || "").toLowerCase())
    || (pkg?.id && pkg.id.toLowerCase() === String(action || "").toLowerCase())
  ));
  if (!requested) return { packageId: action, planSnapshotId: "" };
  const latest = typeof model?.getLatestPackage === "function"
    ? model.getLatestPackage(requested.id)
    : null;
  return { packageId: latest?.id || requested.id, planSnapshotId: "" };
}

export function packageDetailUrlAction(pkg, requestedSnapshotId = "") {
  if (!pkg?.maGoiThau) return pkg?.id || "";
  const code = encodeURIComponent(pkg.maGoiThau);
  if (String(requestedSnapshotId || "") !== String(pkg.id || "")) return code;
  return `${code}/${encodeURIComponent(pkg.id)}`;
}

export function detailRecordLookupForRoute(tabName, action, packageSnapshotId = "") {
  if (tabName === "goithau-detail" && packageSnapshotId) return packageSnapshotId;
  return action;
}

export function dashboardTitleForRole(role) {
  if (role === "manager") return "Tổng quan đơn vị";
  if (role === "employee") return "Công việc của tôi";
  return "Tổng quan hệ thống";
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
  const sidebarToggle = this.view.elements.sidebarToggle;
  const btnCollapse = document.getElementById("btn-sidebar-collapse");
  const mediaQuery = createSidebarMediaQuery(window);
  const compactMediaQuery = createCompactSidebarMediaQuery(window);
  const storedDesktopCollapsed = () => localStorage.getItem("bf_sidebar_collapsed") === "true";
  const synchronizeViewport = () => {
    return synchronizeSidebarViewport({
      appContainer,
      sidebar,
      toggle: sidebarToggle,
      collapseButton: btnCollapse,
      mediaQuery,
      compactMediaQuery,
      desktopCollapsed: storedDesktopCollapsed()
    });
  };
  synchronizeViewport();
  if (typeof mediaQuery.addEventListener === "function") mediaQuery.addEventListener("change", synchronizeViewport);
  else mediaQuery.addListener?.(synchronizeViewport);
  if (typeof compactMediaQuery.addEventListener === "function") compactMediaQuery.addEventListener("change", synchronizeViewport);
  else compactMediaQuery.addListener?.(synchronizeViewport);

  if (btnCollapse) {
    btnCollapse.addEventListener("click", () => {
      if (mediaQuery.matches) {
        setMobileSidebarOpen(sidebar, sidebarToggle, false, { focus: "toggle" });
        return;
      }
      if (compactMediaQuery.matches) return;
      const collapsed = !appContainer.classList.contains("sidebar-collapsed");
      setDesktopSidebarCollapsed(appContainer, btnCollapse, collapsed);
      localStorage.setItem("bf_sidebar_collapsed", collapsed);
      this.view.createIconsScoped(sidebar);
    });
  }
  const brandIcon = sidebar?.querySelector(".brand-icon");
  const expandCollapsedSidebar = () => {
    if (compactMediaQuery.matches) return;
    if (!appContainer.classList.contains("sidebar-collapsed")) return;
    setDesktopSidebarCollapsed(appContainer, btnCollapse, false);
    localStorage.setItem("bf_sidebar_collapsed", "false");
    this.view.createIconsScoped(sidebar);
  };
  brandIcon?.addEventListener("click", expandCollapsedSidebar);
  brandIcon?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    expandCollapsedSidebar();
  });
  sidebarToggle.addEventListener("click", () => {
    const open = !sidebar.classList.contains("active");
    setMobileSidebarOpen(sidebar, sidebarToggle, open, { focus: open ? "sidebar" : "toggle" });
  });
  appContainer.addEventListener("click", (event) => {
    if (!mediaQuery.matches || !sidebar.classList.contains("active")) return;
    if (sidebar.contains(event.target) || sidebarToggle.contains(event.target)) return;
    setMobileSidebarOpen(sidebar, sidebarToggle, false);
  });
  this.view.elements.navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!mediaQuery.matches) return;
      setMobileSidebarOpen(sidebar, sidebarToggle, false);
      queueMicrotask(() => document.getElementById("page-title")?.focus?.({ preventScroll: true }));
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !mediaQuery.matches || !sidebar.classList.contains("active")) return;
    event.preventDefault();
    setMobileSidebarOpen(sidebar, sidebarToggle, false, { focus: "toggle" });
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
// eslint-disable-next-line complexity -- Legacy route orchestration is isolated for a dedicated refactor.
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
  const packageSnapshotId = tabName === "goithau-detail" && parts[2]
    ? decodeURIComponent(parts[2])
    : "";
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
      const latest = resolveLatestVersion(this.model.state.chudautu, cdt || targetId);
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
      const latest = resolveLatestVersion(this.model.state.nhathau, nt || targetId);
      action = latest ? latest.id : targetId;
    }
  }
  if (tabName === "goithau-detail" && action) {
    const resolved = resolvePackageDetailRoute(this.model, action, packageSnapshotId);
    action = resolved.packageId;
    this.view._requestedPackageSnapshotId = resolved.planSnapshotId ? resolved.packageId : null;
    this.view._requestedPlanSnapshotId = resolved.planSnapshotId || null;
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
  const detailRecordLookup = detailRecordLookupForRoute(tabName, action, packageSnapshotId);
  if (detailRecordLookup && typeof this.ensureDetailRecordLoaded === "function") {
    const pendingDetailLoad = this.ensureDetailRecordLoaded(tabName, detailRecordLookup);
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
      if (gt) finalUrlAction = packageDetailUrlAction(gt, this.view._requestedPackageSnapshotId);
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
    const path = "/" + finalUrlTab + (finalUrlAction ? "/" + finalUrlAction : "")
      + window.location.search + window.location.hash;
    const currentPath = window.location.pathname + window.location.search + window.location.hash;
    if (currentPath !== path) {
      history.replaceState({ tab: tabName, action }, "", path);
    }
  }
  return this.switchTab(tabName, action, updateState);
}
export function shouldAutoOpenCreateModal(state, tabName) {
  return state?.activetab === tabName && state?.activeaction === "taomoi";
}

export function beginTabTransition(controller, transitionVersion = null) {
  let version = transitionVersion;
  if (version == null) {
    controller._tabTransitionVersion =
      Number(controller._tabTransitionVersion || 0) + 1;
    version = controller._tabTransitionVersion;
  }
  return {
    version,
    isCurrent: () => version === controller._tabTransitionVersion,
  };
}

export function switchTab(tabName, action = null, updateState = true, transitionVersion = null) {
  const transition = beginTabTransition(this, transitionVersion);
  transitionVersion = transition.version;
  const isCurrentTransition = transition.isCurrent;
  if (!isCurrentTransition()) return;
  const guardedRoute = guardTabAccess(this, tabName, action, updateState);
  tabName = guardedRoute.tabName;
  action = guardedRoute.action;
  if (!this.view.areViewModulesReady(tabName)) {
    return this.view.ensureViewModules(tabName).then(() => {
      if (!isCurrentTransition()) return;
      return this.switchTab(tabName, action, updateState, transitionVersion);
    }).catch((err) => {
      if (!isCurrentTransition()) return;
      console.error("Failed to load view module:", tabName, err);
      this.view?.showToast?.("Không tải được giao diện", "Vui lòng tải lại trang và thử lại.", "error");
    });
  }
  const workflowRequirement = workflowRequirementForRoute(tabName, action);
  const workflowReady = this._workflowModulesReady
    || this.isWorkflowRequirementReady?.(workflowRequirement);
  if (!workflowReady) {
    return this.ensureWorkflowRequirement(workflowRequirement).then(() => {
      if (!isCurrentTransition()) return;
      return this.switchTab(tabName, action, updateState, transitionVersion);
    }).catch((err) => {
      if (!isCurrentTransition()) return;
      console.error("Failed to load workflow module:", tabName, err);
      this.view?.showToast?.("Không tải được chức năng", "Vui lòng thử lại.", "error");
    });
  }
  if (!document.getElementById(`tab-${tabName}`) && this.lazyTabPartials?.[tabName]) {
    return this.ensureLazyTab(tabName).then(() => {
      if (!isCurrentTransition()) return;
      return this.switchTab(tabName, action, updateState, transitionVersion);
    }).catch((err) => {
      if (!isCurrentTransition()) return;
      console.error("Failed to lazy-load tab:", tabName, err);
      this.view?.showToast?.("Không tải được giao diện", "Vui lòng tải lại trang và thử lại.", "error");
    });
  }
  if (!isCurrentTransition()) return;
  resetTimelineOnNavigation(this, tabName);
  this.model.state.activetab = tabName;
  this.model.state.activeaction = action;
  if (updateState) {
    const urlTab = this.routeMap[tabName] || tabName;
    let urlAction = action ? this.actionMap[action] || action : null;
    if (tabName === "goithau-detail" && action) {
      const gt = this.model.state.goithau.find((g) => g.id === action);
      if (gt) urlAction = packageDetailUrlAction(gt, this.view._requestedPackageSnapshotId);
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
    dashboard: dashboardTitleForRole(this.model?.state?.activerole),
    kehoach: "Kế hoạch lựa chọn nhà thầu",
    goithau: "Danh sách Gói thầu",
    "goithau-timeline": "Timeline gói thầu",
    "procurement-center": "Trung tâm hồ sơ và tác vụ",
    chudautu: "Danh mục Chủ đầu tư",
    nhathau: "Danh mục Nhà thầu",
    chuyengia: "Tổ Chuyên gia Đấu thầu",
    hopdong: "Danh sách Hợp đồng",
    bieumau: "Quản lý Biểu mẫu & Từ điển",
    "xuatban-word": "Xuất bản Word",
    "superadmin-dashboard": "Bảng điều khiển Super Admin BiddingFlow",
    superadmin: "Quản lý Đơn vị & Tài khoản Thành viên",
    managernhanvien: "Quản lý Chuyên viên & Phân quyền Matrix",
    managerhosogiay: "Cấu hình trạng thái hợp đồng",
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
  const renderTask = this.renderTabData(tabName, action);
  if (action === "taomoi") {
    setTimeout(() => {
      if (!shouldAutoOpenCreateModal(this.model?.state, tabName)) return;
      if (tabName === "kehoach") {
        const modal = document.getElementById("modal-kehoach");
        if (!modal || !modal.classList.contains("active")) void this.plans.edit(null);
      } else if (tabName === "goithau") {
        const modal = document.getElementById("modal-goithau");
        if (!modal || !modal.classList.contains("active")) void this.packages.edit(null);
      } else if (tabName === "hopdong") {
        const modal = document.getElementById("modal-hopdong");
        if (!modal || !modal.classList.contains("active")) void this.contracts.edit(null);
      } else if (tabName === "chudautu") {
        const modal = document.getElementById("modal-chudautu");
        if (!modal || !modal.classList.contains("active")) void this.partners.editInvestor(null);
      } else if (tabName === "nhathau") {
        const modal = document.getElementById("modal-nhathau");
        if (!modal || !modal.classList.contains("active")) void this.partners.editContractor(null);
      } else if (tabName === "chuyengia") {
        const modal = document.getElementById("modal-chuyengia");
        if (!modal || !modal.classList.contains("active")) void this.partners.editExpert(null);
      }
    }, 100);
  } else if (!action) {
    document.querySelectorAll(".modal-overlay:not(#modal-custom-dialog)").forEach((el) => el.classList.remove("active"));
    const activeModals = document.querySelectorAll(".modal-overlay.active");
    if (activeModals.length === 0) {
      setRuntimeStyle(document.body, "overflow", "");
    }
  }
  return renderTask;
}

export function resetTimelineOnNavigation(controller, nextTab) {
  const currentTab = controller?.model?.state?.activetab;
  if (currentTab === "goithau-timeline" && nextTab !== currentTab) {
    controller.view?.suspendPackageTimeline?.();
    return true;
  }
  return false;
}

export function setupProfileDropdownEvents() {
  if (document.__bfProfileDropdownEventsBound) return;
  const trigger = document.getElementById("header-profile-trigger");
  const dropdown = document.getElementById("profile-dropdown-menu");
  if (!trigger || !dropdown) return;
  document.__bfProfileDropdownEventsBound = true;
  synchronizeProfileMenu(trigger, dropdown, { restoreFocus: false });
  const observer = new MutationObserver(() => synchronizeProfileMenu(trigger, dropdown));
  observer.observe(dropdown, { attributes: true, attributeFilter: ["class"] });
  trigger.addEventListener("keydown", (event) => handleProfileMenuKeydown(event, trigger, dropdown));
  dropdown.addEventListener("keydown", (event) => handleProfileMenuKeydown(event, trigger, dropdown));
  document.addEventListener("click", (event) => {
    const clickedTrigger = event.target.closest?.("#header-profile-trigger");
    const profileButton = event.target.closest?.("#btn-dropdown-profile");
    if (profileButton) {
      event.preventDefault();
      setProfileMenuOpen(trigger, dropdown, false);
      this.switchTab("profile");
      queueMicrotask(() => document.getElementById("page-title")?.focus?.({ preventScroll: true }));
      return;
    }
    if (clickedTrigger) {
      event.stopPropagation();
      setProfileMenuOpen(trigger, dropdown, !dropdown.classList.contains("active"));
      return;
    }
    if (!event.target.closest?.("#profile-dropdown-menu")) {
      setProfileMenuOpen(trigger, dropdown, false);
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
    case "goithau-timeline":
      this.view.renderPackageTimeline();
      break;
    case "procurement-center":
      return import("../procurement-cases/ProcurementOperationsCenter.js")
        .then(({ mountProcurementOperationsCenter }) => mountProcurementOperationsCenter(
          document.querySelector("#tab-procurement-center [data-procurement-center]"),
          { packages: this.model.state.goithau || [] },
        ));
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
    case "xuatban-word":
      return this.setupWordPublicationPage();
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
        return this.view.showPackageDetails(activeId);
      } else {
        return this.switchTab("goithau");
      }
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
  const preserveProcurementImport = options?.preserveProcurementImport === true;
  if (modalId === "modal-excel-preview") {
    this._excelImportData = [];
    this._excelImportType = null;
    const input = document.getElementById("excel-file-input-temp");
    if (input) input.value = "";
  }
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
    const discardImportedPlanDraft = Boolean(
      this.procurementPlanImport?.controller && !preserveProcurementImport,
    );
    if (this.planBreakdownDraft?.active) {
      const activePlanId = document.getElementById("breakdown-plan-id")?.value
        || this.planBreakdownDraft.planId;
      const durableDraft = findPlanVersionDraftSession(this.model, activePlanId);
      if (durableDraft) {
        if (discardImportedPlanDraft) {
          await removePlanVersionDraftSession(this.model, durableDraft.draftId, {
            expectedRevision: durableDraft.revision,
          });
          restorePlanBreakdownDraft(this.model, this.planBreakdownDraft);
        } else {
          this.updatePlanBreakdownDraftRows?.(this, activePlanId);
          await persistActivePlanVersionDraftSession(this, activePlanId);
        }
      } else {
        restorePlanBreakdownDraft(this.model, this.planBreakdownDraft);
      }
      this.planBreakdownDraft = null;
      this.backupKeHoachState = null;
      this.backupGoiThauState = null;
    } else if (this.backupKeHoachState) {
      this.model.replaceTableState(
        "kehoach",
        restoreRecordSnapshot(this.model.state.kehoach, this.backupKeHoachState),
      );
      this.backupKeHoachState = null;
    }
    if (this.backupGoiThauState) {
      this.model.replaceTableState(
        "goithau",
        restoreRecordSnapshot(this.model.state.goithau, this.backupGoiThauState),
      );
      this.backupGoiThauState = null;
    }
    this.tempPlanData = null;
    this.tempPlanAction = null;
    if (this.procurementPlanImport?.controller && !preserveProcurementImport) {
      await this.cancelActiveProcurementImportSession?.();
    }
    this.view.renderKeHoachTable();
    this.view.renderGoiThauTable();
  }
  if (modalId === "modal-kehoach" && this.planBreakdownDraft?.active) {
    const formPlanId = document.getElementById("form-kehoach-id")?.value;
    if (String(formPlanId || "") === String(this.planBreakdownDraft.planId || "")) {
      const durableDraft = findPlanVersionDraftSession(this.model, formPlanId);
      if (durableDraft) {
        if (this.procurementPlanImport?.controller && !preserveProcurementImport) {
          await removePlanVersionDraftSession(this.model, durableDraft.draftId, {
            expectedRevision: durableDraft.revision,
          });
          restorePlanBreakdownDraft(this.model, this.planBreakdownDraft);
        } else {
          await persistActivePlanVersionDraftSession(this, formPlanId);
        }
      } else {
        restorePlanBreakdownDraft(this.model, this.planBreakdownDraft);
      }
      this.planBreakdownDraft = null;
      this.backupKeHoachState = null;
      this.backupGoiThauState = null;
      this.tempPlanData = null;
      this.tempPlanAction = null;
      if (this.procurementPlanImport?.controller && !preserveProcurementImport) {
        await this.cancelActiveProcurementImportSession?.();
      }
      this.view.renderKeHoachTable();
      this.view.renderGoiThauTable();
    }
  }
  if (
    modalId === "modal-goithau"
    && this.procurementPackageImport?.controller
    && !preserveProcurementImport
  ) {
    await this.cancelActiveProcurementImportSession?.();
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
    const planModal = document.getElementById("modal-kehoach");
    const contractModal = document.getElementById("modal-hopdong");
    const isParentModalActive = [planModal, contractModal].some((modal) => modal?.classList.contains("active"));
    if (!isParentModalActive) {
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
