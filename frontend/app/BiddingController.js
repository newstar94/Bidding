import { getJvData } from "../packages/jvDataStore.js";
import { safeImageSrc } from "../shared/view_helpers.js";
import { installPrototypeModules } from "./moduleRegistry.js";
import { setCommandExecutor } from "./commandBus.js";
import { hasHolidays, setHolidays } from "../shared/runtimeState.js";
import { APP_DEBUG } from "./appConfig.js";
import { setAppController } from "./controllerRef.js";
import { hideInitLoader, isAuthTransitionActive } from "../auth/authRuntimeState.js";
import {
  applyAccessContext,
  normalizeOrganizations,
  selectActiveOrganization
} from "../auth/accessContext.js";
import { reconcileRouteDataAtStartup } from "./startupReconciliation.js";
import { appendExportSnapshotVersion } from "../shared/exportSnapshot.js";
import {
  getActiveOrganizationId,
  setActiveOrganizationId
} from "./workspaceState.js";
export class BiddingController {
  constructor(model, view) {
    this.model = model;
    this.view = view;
    this.tempChuyenGiaImageBase64 = "";
    this.tempChuyenGiaSignatureBase64 = "";
    this.tempNhaThauStampBase64 = "";
    this.packageWizard = {
      active: false,
      planId: null,
      totalCount: 0,
      currentCount: 0
    };
    this.routeMap = {
      "dashboard": "tong-quan",
      "kehoach": "ke-hoach",
      "goithau": "goi-thau",
      "mothau": "mothau",
      "danhgiahsdt": "danh-gia-hsdt",
      "hopdong": "hop-dong",
      "chudautu": "chu-dau-tu",
      "nhathau": "nha-thau",
      "chuyengia": "chuyen-gia",
      "bieumau": "bieu-mau",
      "superadmin-dashboard": "tong-quan-admin",
      "superadmin": "quan-ly-tai-khoan",
      "managernhanvien": "nhan-su",
      "managerhosogiay": "trang-thai-ho-so",
      "profile": "trang-ca-nhan",
      "goithau-detail": "goi-thau-chi-tiet",
      "kehoach-detail": "ke-hoach-chi-tiet",
      "hopdong-detail": "hop-dong-chi-tiet",
      "chudautu-detail": "chu-dau-tu-chi-tiet",
      "nhathau-detail": "nha-thau-chi-tiet"
    };
    this.actionMap = {
      "taomoi": "tao-moi",
      "chinhsua": "chinh-sua"
    };
    this.lazyTabPartials = {
      "kehoach-detail": "/tabs/tab_kehoach_detail.html",
      "goithau-detail": "/tabs/tab_goithau_detail.html",
      mothau: "/tabs/tab_mothau.html",
      danhgiahsdt: "/tabs/tab_danhgiahsdt.html",
      "chudautu-detail": "/tabs/tab_chudautu_detail.html",
      "nhathau-detail": "/tabs/tab_nhathau_detail.html",
      "hopdong-detail": "/tabs/tab_hopdong_detail.html",
      bieumau: "/tabs/tab_bieumau.html",
      "superadmin-dashboard": "/tabs/tab_superadmin_dashboard.html",
      superadmin: "/tabs/tab_superadmin.html",
      managernhanvien: "/tabs/tab_managernhanvien.html",
      managerhosogiay: "/tabs/tab_managerhosogiay.html",
      profile: "/tabs/tab_profile.html"
    };
    this.lazyModalPartials = {
      "modal-kehoach": "/modals/modal_kehoach.html",
      "modal-plan-breakdown": "/modals/modal_plan_breakdown.html",
      "modal-phathanh-hsmt": "/modals/modal_phathanh_hsmt.html",
      "modal-goithau": "/modals/modal_goithau.html",
      "modal-chudautu": "/modals/modal_chudautu.html",
      "modal-nhathau": "/modals/modal_nhathau.html",
      "modal-chuyengia": "/modals/modal_chuyengia.html",
      "modal-detail-goithau": "/modals/modal_detail_goithau.html",
      "modal-detail-kehoach": "/modals/modal_detail_kehoach.html",
      "modal-detail-chuyengia": "/modals/modal_detail_chuyengia.html",
      "modal-hopdong": "/modals/modal_hopdong.html",
      "modal-manager-employee": "/modals/modal_manager_employee.html",
      "modal-edit-package": "/modals/modal_edit_package.html",
      "modal-detail-system-user": "/modals/modal_detail_system_user.html"
    };
    this._lazyPartialPromises = /* @__PURE__ */ new Map();
    this._lazyPartialHtmlCache = /* @__PURE__ */ new Map();
    this._lazyPartialPreloadPromises = /* @__PURE__ */ new Map();
  }
  async ensureLazyPartial(kind, id) {
    const isTab = kind === "tab";
    const existing = document.getElementById(isTab ? `tab-${id}` : id);
    if (existing) return existing;
    const partials = isTab ? this.lazyTabPartials : this.lazyModalPartials;
    const url = partials[id];
    if (!url) return null;
    const key = `${kind}:${id}`;
    if (!this._lazyPartialPromises.has(key)) {
      this._lazyPartialPromises.set(key, (async () => {
        const html = this._lazyPartialHtmlCache.get(key) || await this.preloadLazyPartial(kind, id);
        const template = document.createElement("template");
        template.innerHTML = html.trim();
        const root = document.getElementById(isTab ? "lazy-tab-root" : "lazy-modal-root") || document.querySelector(isTab ? ".content-viewport" : "body");
        root.appendChild(template.content);
        this.view.elements.navButtons = document.querySelectorAll(".nav-btn");
        this.view.elements.tabPanes = document.querySelectorAll(".tab-pane");
        if (isTab) {
          this.setupActionListeners?.();
          if (["superadmin", "superadmin-dashboard", "managernhanvien", "managerhosogiay", "profile"].includes(id)) {
            this.setupRBACEvents?.();
          }
        }
        if (!isTab) {
          this.setupActionListeners?.();
          if (id === "modal-goithau") {
            this.setupConditionalUI?.();
          }
          if (["modal-chuyengia", "modal-nhathau"].includes(id)) {
            this.setupFileUploads?.();
          }
          if (["modal-manager-employee", "modal-detail-system-user", "modal-edit-package"].includes(id)) {
            this.setupRBACEvents?.();
          }
        }
        const inserted = document.getElementById(isTab ? `tab-${id}` : id);
        this.view.createIconsScoped(inserted || root);
        this.view.enhanceVisibleContent(inserted || root);
        return inserted;
      })().catch((err) => {
        this._lazyPartialPromises.delete(key);
        throw err;
      }));
    }
    return this._lazyPartialPromises.get(key);
  }
  preloadLazyPartial(kind, id) {
    const isTab = kind === "tab";
    const partials = isTab ? this.lazyTabPartials : this.lazyModalPartials;
    const url = partials[id];
    if (!url) return Promise.resolve(null);
    const key = `${kind}:${id}`;
    if (this._lazyPartialHtmlCache.has(key)) {
      return Promise.resolve(this._lazyPartialHtmlCache.get(key));
    }
    if (!this._lazyPartialPreloadPromises.has(key)) {
      const request = fetch(url, { credentials: "same-origin" }).then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to preload ${url}: HTTP ${response.status}`);
        }
        return response.text();
      }).then((html) => {
        this._lazyPartialHtmlCache.set(key, html);
        return html;
      }).finally(() => this._lazyPartialPreloadPromises.delete(key));
      this._lazyPartialPreloadPromises.set(key, request);
    }
    return this._lazyPartialPreloadPromises.get(key);
  }
  async preloadPrimaryModals() {
    const modalIds = ["modal-chudautu", "modal-nhathau", "modal-kehoach", "modal-goithau"];
    for (const modalId of modalIds) {
      try {
        await this.preloadLazyPartial("modal", modalId);
      } catch (error) {
        console.warn(`Failed to preload modal: ${modalId}`, error);
      }
    }
  }
  ensureLazyTab(tabName) {
    return this.ensureLazyPartial("tab", tabName);
  }
  ensureLazyModal(modalId) {
    return this.ensureLazyPartial("modal", modalId);
  }
  getTabNameForPath(pathname = window.location.pathname) {
    const cleanPath = pathname.startsWith("/") ? pathname.substring(1) : pathname;
    const urlTab = cleanPath.split("/").filter(Boolean)[0] || "";
    for (const [tabName, routePath] of Object.entries(this.routeMap)) {
      if (routePath === urlTab) return tabName;
    }
    if (urlTab === "chudautu-detail") return "chudautu-detail";
    if (urlTab === "nhathau-detail") return "nhathau-detail";
    return null;
  }
  markStartup(label) {
    try {
      if (!this._startupTimes) this._startupTimes = {};
      const now = window.performance?.now ? window.performance.now() : Date.now();
      this._startupTimes[label] = now;
      if (window.performance?.mark) {
        window.performance.mark(`bf:${label}`);
      }
    } catch (e) {
    }
  }
  measureStartup(name, startLabel, endLabel) {
    try {
      const start = this._startupTimes?.[startLabel];
      const end = this._startupTimes?.[endLabel];
      const measureName = `bf:${name}`;
      if (Number.isFinite(start) && Number.isFinite(end)) {
        if (window.performance?.measure) {
          window.performance.measure(measureName, {
            start,
            end
          });
        }
        return { name, duration: Math.round(end - start) };
      }
      if (!window.performance?.measure) return null;
      window.performance.measure(measureName, `bf:${startLabel}`, `bf:${endLabel}`);
      const entries = window.performance.getEntriesByName(measureName);
      const entry = entries[entries.length - 1];
      return entry ? { name, duration: Math.round(entry.duration) } : null;
    } catch (e) {
      return null;
    }
  }
  publishStartupMetrics() {
    const metrics = [
      Number.isFinite(this._startupTimes?.["loader:hidden"])
        ? { name: "navigation to hide loader", duration: Math.round(this._startupTimes["loader:hidden"]) }
        : null,
      this.measureStartup("session check", "session-check-start", "session-check-end"),
      this.measureStartup("workspace module import", "workspace-import-start", "workspace-import-end"),
      this.measureStartup("app module to DOM ready", "app-module-start", "dom-content-loaded"),
      this.measureStartup("model init", "init:start", "model:init"),
      this.measureStartup("critical ui setup", "model:init", "ui:critical"),
      this.measureStartup("initial route data", "route-data-sync:start", "route-data-sync:end"),
      this.measureStartup("route render", "ui:critical", "route:rendered"),
      this.measureStartup("app module to hide loader", "app-module-start", "loader:hidden"),
      this.measureStartup("time to hide loader", "init:start", "loader:hidden")
    ].filter(Boolean);
    try {
      window.performance?.measure?.("bf:navigation to hide loader", {
        start: 0,
        end: "bf:loader:hidden"
      });
    } catch (e) {
    }
    const perfDebugEnabled = APP_DEBUG
      || localStorage.getItem("bf_perf_debug") === "true"
      || new URLSearchParams(window.location.search).get("bf_perf_debug") === "true";
    if (perfDebugEnabled) {
      console.info(`[Startup Metrics] ${JSON.stringify(metrics)}`);
      console.table(metrics);
    }
  }
  schedulePostStartupTask(task, { timeout = 1500, delay = 0 } = {}) {
    const run = () => {
      try {
        Promise.resolve(task()).catch((err) => {
          console.error("Post-startup task failed:", err);
        });
      } catch (err) {
        console.error("Post-startup task failed:", err);
      }
    };
    const scheduleIdle = () => {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(run, { timeout });
      } else {
        setTimeout(run, delay);
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(scheduleIdle));
  }
  async reconcileInitialRouteData() {
    return reconcileRouteDataAtStartup(this);
  }
  ensureWorkflowModules() {
    if (!this._workflowModulesPromise) {
      this._workflowModulesPromise = Promise.all([
        import("../packages/BiddingWorkflows.js"),
        import("../partners/PartnerWorkflows.js")
      ]).then(([bidding, partner]) => {
        installPrototypeModules(BiddingController, [
          { name: "bidding-workflows", module: bidding },
          { name: "partner-workflows", module: partner },
        ]);
        this._workflowModulesReady = true;
      }).catch((err) => {
        this._workflowModulesPromise = null;
        throw err;
      });
    }
    return this._workflowModulesPromise;
  }
  getWorkflowDataKeys(methodName) {
    const dependencies = {
      editChuDauTu: ["CHUDAUTU"],
      editNhaThau: ["NHATHAU"],
      editKeHoach: ["KEHOACH", "CHUDAUTU", "ASSIGNMENTS", "EMPLOYEES"],
      editGoiThau: ["GOITHAU", "KEHOACH", "NHATHAU", "CHUYENGIA", "ASSIGNMENTS", "EMPLOYEES", "THONGTINMOTHAU"]
    };
    return dependencies[methodName] || null;
  }
  ensureWorkflowData(methodName) {
    const keys = this.getWorkflowDataKeys(methodName);
    return keys ? this.model.loadStorageKeys(keys) : this.model.ensureAllDataLoaded();
  }
  ensureWorkflowReady(methodName) {
    return Promise.all([
      this.ensureWorkflowModules(),
      this.ensureWorkflowData(methodName)
    ]);
  }
  loadHolidaysInBackground() {
    if (hasHolidays()) return;
    fetch("/api/holidays").then((res) => res.json()).then((data) => {
      setHolidays(data);
    }).catch((e) => {
      console.error("Failed to load holidays:", e);
      setHolidays({});
    });
  }
  hasLocalWorkspaceData() {
    const keys = ["kehoach", "goithau", "chudautu", "nhathau", "chuyengia", "hopdong", "thongtinmothau"];
    return keys.some((key) => Array.isArray(this.model.state[key]) && this.model.state[key].length > 0) || this.model?._hasPersistedWorkspaceData === true;
  }
  hasLocalDataForRoute(pathname = window.location.pathname) {
    const cleanPath = pathname.startsWith("/") ? pathname.substring(1) : pathname;
    const parts = cleanPath.split("/").filter(Boolean);
    const urlTab = parts[0] || "";
    const action = parts[1] ? decodeURIComponent(parts[1]) : "";
    const normalize = (value) => String(value || "").trim().toLowerCase();
    const normalizedAction = normalize(action);
    const actionSuffix = action.includes("_") ? normalize(action.split("_").pop()) : "";
    const detailRouteToState = {
      [this.routeMap["goithau-detail"]]: {
        key: "goithau",
        match: (item) => normalize(item.id) === normalizedAction || normalize(item.maGoiThau) === normalizedAction || normalize(this.model.getPackageBaseCode?.(item.maGoiThau)) === normalizedAction
      },
      [this.routeMap["kehoach-detail"]]: {
        key: "kehoach",
        match: (item) => normalize(item.id) === normalizedAction || normalize(encodeURIComponent(String(item.maKeHoach || ""))) === normalizedAction
      },
      [this.routeMap["hopdong-detail"]]: {
        key: "hopdong",
        match: (item) => {
          const cleanAction = normalizedAction.replace(/[\/-]/g, "");
          const cleanNumber = String(item.soHopDong || "").toLowerCase().replace(/[\/-]/g, "");
          return normalize(item.id) === normalizedAction || cleanNumber === cleanAction;
        }
      },
      [this.routeMap["chudautu-detail"]]: {
        key: "chudautu",
        match: (item) => normalize(item.id) === normalizedAction || normalize(item.maChuDauTu) === normalizedAction
      },
      [this.routeMap["nhathau-detail"]]: {
        key: "nhathau",
        match: (item) => normalize(item.id) === normalizedAction || normalize(item.maNhaThau) === normalizedAction
      }
    };
    const detailRoute = detailRouteToState[urlTab];
    if (!detailRoute || !action) {
      return this.hasLocalWorkspaceData();
    }
    const list = this.model.state[detailRoute.key] || [];
    return list.some((item) => {
      const id = normalize(item.id);
      return detailRoute.match(item) || actionSuffix && id.startsWith(actionSuffix);
    });
  }
  getActiveUserWorkspaceList() {
    const currentUser = this.model?.state?.activeuser || {};
    return normalizeOrganizations(currentUser).filter((organization) => organization.status === "active");
  }
  async switchWorkspaceContext(nextOrgId, options = {}) {
    const organizationId = String(nextOrgId || "").trim();
    if (!organizationId) throw new Error("Thiếu organization ID khi đổi workspace");
    if (this._workspaceTransitionPromise) return this._workspaceTransitionPromise;
    const currentUser = this.model?.state?.activeuser || {};
    const organization = this.getActiveUserWorkspaceList().find((item) => item.id === organizationId);
    if (!organization && !options.accessRevoked) {
      throw new Error("Tổ chức không còn khả dụng trong phiên hiện tại");
    }
    const currentOrganizationId = this.model?.workspaceScope?.organizationId || getActiveOrganizationId();
    if (currentOrganizationId === organizationId && this.model?.workspaceScope?.organizationId === organizationId) {
      return { changed: false, organizationId };
    }
    this._workspaceTransitionPromise = (async () => {
      this._workspaceSwitching = true;
      this.model.beginWorkspaceTransition?.();
      if (this._backgroundSyncTimer) {
        clearTimeout(this._backgroundSyncTimer);
        this._backgroundSyncTimer = null;
      }
      this._backgroundSyncQueued = false;
      if (currentOrganizationId && !options.skipPendingFlush && navigator.onLine && typeof this.autoSync === "function") {
        try {
          await this.autoSync();
        } catch (error) {
          console.warn("Pending mutations remain isolated in the previous workspace:", error);
        }
      }
      this.disconnectWebSocket?.(false);
      setActiveOrganizationId(organizationId);
      applyAccessContext(currentUser, {
        ...currentUser,
        active_org_id: organizationId,
        platform_role: currentUser.platformRole
      });
      this.model.state.activerole = this.model.constructor.resolveAllowedActiveRole(currentUser);
      currentUser.title = this.model.constructor.getRoleTitle(this.model.state.activerole);
      sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEROLE, JSON.stringify(this.model.state.activerole));
      sessionStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(currentUser));
      localStorage.setItem(this.model.STORAGE_KEYS.ACTIVEUSER, JSON.stringify(currentUser));
      await this.model.init({
        userId: currentUser.id || sessionStorage.getItem("bf_user_id"),
        organizationId,
        priorityKeys: this.getStartupPriorityKeys?.(window.location.pathname)
      });
      this._pendingDetailRecordLoads?.clear?.();
      this.packageWizard = { active: false, planId: null, totalCount: 0, currentCount: 0 };
      this.model.endWorkspaceTransition?.();
      if (!options.localOnly && typeof this.forceSyncData === "function") {
        await this.forceSyncData(false, false);
      }
      this.model.dashboardSummary = this.model.dashboardSummary || null;
      if (this.view) this.view._dashboardAggregateCache = null;
      this.renderWorkspaceSwitcher?.();
      this.view?.updateActiveUserProfileDisplay?.();
      if (typeof this.switchTab === "function") {
        const targetTab = this.model.state.activerole === "super_admin" ? "superadmin-dashboard" : "dashboard";
        this.model.state.activetab = targetTab;
        await this.switchTab(targetTab, null, true);
      }
      this.setupWebSocketConnection?.();
      return { changed: true, organizationId, pendingPreserved: true };
    })().finally(() => {
      this.model.endWorkspaceTransition?.();
      this._workspaceSwitching = false;
      this._workspaceTransitionPromise = null;
    });
    return this._workspaceTransitionPromise;
  }
  async resetWorkspaceData(nextOrg = "") {
    if (nextOrg) return this.switchWorkspaceContext(nextOrg, { skipPendingFlush: true, accessRevoked: true });
    this.disconnectWebSocket?.(false);
    setActiveOrganizationId("");
    await this.model?.deactivateWorkspace?.();
    return { changed: true, organizationId: "" };
  }
  async recoverActiveOrgAccess() {
    if (this._recoveringActiveOrg) return false;
    this._recoveringActiveOrg = true;
    try {
      const currentOrg = getActiveOrganizationId();
      const orgs = this.getActiveUserWorkspaceList();
      const nextOrganization = orgs.find((org) => org.id !== currentOrg) || orgs[0] || null;
      const nextOrg = nextOrganization?.id || "";
      if (!nextOrg) {
        await this.resetWorkspaceData("");
        return false;
      }
      await this.switchWorkspaceContext(nextOrg, { skipPendingFlush: true, accessRevoked: true });
      if (typeof this.renderWorkspaceSwitcher === "function") {
        this.renderWorkspaceSwitcher();
      }
      this.view?.showToast?.(
        "Đã đổi workspace",
        `Workspace cũ không còn quyền truy cập. Đang tải dữ liệu của "${nextOrganization?.name || nextOrg}".`,
        "warning"
      );
      return true;
    } catch (err) {
      console.error("Failed to recover active workspace:", err);
      return false;
    } finally {
      this._recoveringActiveOrg = false;
    }
  }
  ensureCommandRegistry() {
    if (!this.commands) {
      this.commands = /* @__PURE__ */ new Map();
    }
    return this.commands;
  }
  registerCommand(name, handler, { exposeLegacy = false } = {}) {
    if (!name || typeof handler !== "function") return;
    this.ensureCommandRegistry().set(name, handler);
    if (exposeLegacy) {
      window[name] = (...args) => this.executeCommand(name, ...args);
    }
  }
  executeCommand(name, ...args) {
    const handler = this.ensureCommandRegistry().get(name);
    if (typeof handler === "function") {
      return handler(...args);
    }
    console.warn(`[Command] Missing handler: ${name}`);
    return void 0;
  }
  getStartupPriorityKeys(pathname = window.location.pathname) {
    const cleanPath = pathname.startsWith("/") ? pathname.substring(1) : pathname;
    const tab = cleanPath.split("/").filter(Boolean)[0] || this.routeMap.dashboard;
    const byRoute = {
      [this.routeMap.dashboard]: ["KEHOACH", "GOITHAU", "HOPDONG", "CHUDAUTU", "NHATHAU", "ASSIGNMENTS"],
      [this.routeMap["superadmin-dashboard"]]: ["SYSTEMPACKAGES", "ORGANIZATIONS", "EMPLOYEES", "PERMISSIONMATRIX"],
      [this.routeMap.superadmin]: ["SYSTEMPACKAGES", "ORGANIZATIONS", "EMPLOYEES", "PERMISSIONMATRIX"],
      [this.routeMap.managernhanvien]: ["EMPLOYEES", "PERMISSIONMATRIX", "ORGANIZATIONS"],
      [this.routeMap.managerhosogiay]: ["CUSTOMPAPERSTATUSES"],
      [this.routeMap.kehoach]: ["KEHOACH", "GOITHAU", "CHUDAUTU"],
      [this.routeMap["kehoach-detail"]]: ["KEHOACH", "GOITHAU", "CHUDAUTU"],
      [this.routeMap.goithau]: ["GOITHAU", "KEHOACH", "CHUDAUTU", "NHATHAU", "THONGTINMOTHAU", "ASSIGNMENTS"],
      [this.routeMap["goithau-detail"]]: ["GOITHAU", "KEHOACH", "CHUDAUTU", "NHATHAU", "HOPDONG", "THONGTINMOTHAU"],
      [this.routeMap.mothau]: ["GOITHAU", "KEHOACH", "NHATHAU", "THONGTINMOTHAU"],
      [this.routeMap.danhgiahsdt]: ["GOITHAU", "KEHOACH", "NHATHAU", "THONGTINMOTHAU"],
      [this.routeMap.hopdong]: ["HOPDONG", "GOITHAU", "NHATHAU", "CHUDAUTU"],
      [this.routeMap["hopdong-detail"]]: ["HOPDONG", "GOITHAU", "KEHOACH", "CHUDAUTU", "NHATHAU"],
      [this.routeMap.chudautu]: ["CHUDAUTU", "KEHOACH"],
      [this.routeMap["chudautu-detail"]]: ["CHUDAUTU", "KEHOACH"],
      [this.routeMap.nhathau]: ["NHATHAU", "GOITHAU", "HOPDONG", "THONGTINMOTHAU"],
      [this.routeMap["nhathau-detail"]]: ["NHATHAU", "GOITHAU", "HOPDONG", "THONGTINMOTHAU"],
      [this.routeMap.chuyengia]: ["CHUYENGIA"],
      [this.routeMap.bieumau]: ["GOITHAU", "KEHOACH", "HOPDONG", "CHUDAUTU", "NHATHAU"]
    };
    return Array.from(new Set(byRoute[tab] || byRoute[this.routeMap.dashboard]));
  }
  getSyncTableKeysForPath(pathname = window.location.pathname) {
    return this.getStartupPriorityKeys(pathname)
      .map((key) => String(key || "").toLowerCase())
      .filter((key) => ["chudautu", "kehoach", "goithau", "chuyengia", "nhathau", "hopdong", "assignments", "custompaperstatuses", "thongtinmothau", "permissionmatrix"].includes(key));
  }
  loadInitDataInBackground() {
    const load = async () => {
      try {
        const [usersRes, pkgsRes] = await Promise.all([
          fetch("/api/auth/users"),
          fetch("/api/system-packages")
        ]);
        if (usersRes.ok) {
          const users = await usersRes.json();
          const localEmployees = JSON.parse(localStorage.getItem("bf_employees") || "[]");
          this.model.state.employees = users.map((u) => {
            const localEmp = localEmployees.find((le) => le.email && le.email.trim().toLowerCase() === (u.email || "").trim().toLowerCase());
            return {
              id: u.id,
              username: u.username,
              name: localEmp ? localEmp.name : u.name,
              email: u.email || "",
              phone: localEmp ? localEmp.phone : "",
              role: u.role,
              package_id: u.package_id
            };
          });
          this.model.persistData("employees");
          this.view.populateNhanVienPhuTrachDropdowns();
        }
        if (pkgsRes.ok) {
          const pkgs = await pkgsRes.json();
          const lockedPkgs = JSON.parse(localStorage.getItem("bf_locked_system_packages") || "[]");
          pkgs.forEach((p) => {
            p.isLocked = lockedPkgs.includes(p.id);
          });
          this.model.state.systempackages = pkgs;
          this.model.persistData("systempackages");
        }
      } catch (err) {
        console.error("Failed to load init data (users/packages):", err);
      }
    };
    if ("requestIdleCallback" in window) {
      requestIdleCallback(load, { timeout: 2500 });
    } else {
      setTimeout(load, 1e3);
    }
  }
  async init() {
    this.markStartup("init:start");
    const originalFetch = window.fetch;
    const readCookie = (name) => {
      const prefix = `${name}=`;
      const raw = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
      return raw ? decodeURIComponent(raw.slice(prefix.length)) : "";
    };
    window.fetch = async (url, options = {}) => {
      const activeOrg = getActiveOrganizationId();
      if (typeof url === "string" && url.startsWith("/api/")) {
        const headers = new Headers(options.headers || {});
        const method = (options.method || "GET").toUpperCase();
        headers.delete("X-Session-Token");
        headers.delete("X-Username");
        if (activeOrg) {
          headers.set("X-Active-Org", encodeURIComponent(activeOrg));
        }
        if (["POST", "PUT", "DELETE"].includes(method)) {
          const csrfToken = readCookie("csrf_token");
          if (csrfToken) {
            headers.set("X-CSRF-Token", csrfToken);
          }
        }
        options.headers = headers;
      }
      const response = await originalFetch(url, options);
      if (response.status === 403 && typeof url === "string" && url.startsWith("/api/") && !url.includes("/api/auth/login") && !url.includes("/api/auth/check-session")) {
        let errorMsg = "Yêu cầu bị từ chối do không đủ quyền hạn hoặc vi phạm cấu hình hệ thống.";
        let isSessionError = false;
        try {
          const clone = response.clone();
          const data = await clone.json();
          if (data && data.error) {
            errorMsg = data.error;
          }
          if (errorMsg === "Không có quyền truy cập tổ chức này!") {
            const recovered = await this.recoverActiveOrgAccess();
            if (recovered) {
              return response;
            }
          }
          if (errorMsg === "Thiếu thông tin xác thực phiên làm việc!" || errorMsg === "Tài khoản không tồn tại!" || errorMsg === "Phiên làm việc đã hết hạn hoặc không hợp lệ!" || errorMsg === "Phiên đăng nhập đã hết hạn! Vui lòng đăng nhập lại.") {
            isSessionError = true;
          }
        } catch (e) {
          console.error("Failed to parse the 403 response:", e);
        }
        if (isSessionError) {
          if (isAuthTransitionActive()) {
            return response;
          }
          const overlay = document.getElementById("auth-overlay");
          if (overlay && overlay.style.display !== "flex") {
            this.disconnectWebSocket?.(false);
            void this.model.deactivateWorkspace?.();
            this.model.clearSessionData();
            overlay.style.display = "flex";
            document.querySelector(".app-container").style.filter = "blur(10px)";
            const formLogin = document.getElementById("form-auth-login");
            const formRegister = document.getElementById("form-auth-register");
            const formForgot = document.getElementById("form-auth-forgot");
            if (formLogin) formLogin.style.display = "block";
            if (formRegister) formRegister.style.display = "none";
            if (formForgot) formForgot.style.display = "none";
          }
          return response;
        }
        if (errorMsg === "Không có quyền truy cập tổ chức này!") {
          await this.view.customAlert("⚠️ LỖI QUYỀN HẠN", "Không có quyền truy cập tổ chức này!", "log-out");
        } else {
          await this.view.customAlert("⚠️ LỖI QUYỀN HẠN (403)", `${errorMsg}

Nhấn Xác nhận để tải lại hệ thống.`, "log-out");
        }
        window.location.reload();
        return response;
      }
      if (response.status === 401 && typeof url === "string" && url.startsWith("/api/") && !url.includes("/api/auth/login") && !url.includes("/api/auth/check-session")) {
        if (isAuthTransitionActive()) {
          return response;
        }
        const overlay = document.getElementById("auth-overlay");
        if (overlay && overlay.style.display !== "flex") {
          this.disconnectWebSocket?.(false);
          void this.model.deactivateWorkspace?.();
          this.model.clearSessionData();
          overlay.style.display = "flex";
          document.querySelector(".app-container").style.filter = "blur(10px)";
          const formLogin = document.getElementById("form-auth-login");
          const formRegister = document.getElementById("form-auth-register");
          const formForgot = document.getElementById("form-auth-forgot");
          if (formLogin) formLogin.style.display = "block";
          if (formRegister) formRegister.style.display = "none";
          if (formForgot) formForgot.style.display = "none";
        }
      }
      return response;
    };
    sessionStorage.removeItem("bf_session_token");
    localStorage.removeItem("bf_session_token");
    const rememberedUserId = localStorage.getItem("bf_user_id");
    const rememberedUsername = localStorage.getItem("bf_username");
    if (rememberedUserId && !sessionStorage.getItem("bf_user_id")) {
      sessionStorage.setItem("bf_user_id", rememberedUserId);
    }
    if (rememberedUsername && !sessionStorage.getItem("bf_username")) {
      sessionStorage.setItem("bf_username", rememberedUsername);
    }
    let initialSessionData = this._initialSessionData;
    if (initialSessionData === void 0) {
      initialSessionData = { valid: false };
      try {
        const sessionResponse = await fetch("/api/auth/check-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" })
        });
        if (sessionResponse.ok) {
          initialSessionData = await sessionResponse.json();
        }
      } catch (err) {
        console.warn("Initial session check failed:", err);
      }
    }
    this._initialSessionData = initialSessionData;
    if (!initialSessionData?.valid) {
      this._workspaceDeferredUntilReload = true;
      this.view.initDOM();
      this.setupAuth();
      this.markStartup("ui:critical");
      return;
    }
    if (initialSessionData.user?.id) {
      sessionStorage.setItem("bf_user_id", String(initialSessionData.user.id));
    }
    if (initialSessionData.user?.username) {
      sessionStorage.setItem("bf_username", initialSessionData.user.username);
    }
    selectActiveOrganization(initialSessionData.user || {});
    const startupPriorityKeys = this.getStartupPriorityKeys(window.location.pathname);
    await this.model.init({
      userId: initialSessionData.user?.id,
      organizationId: getActiveOrganizationId(),
      priorityKeys: startupPriorityKeys
    });
    this.markStartup("model:init");
    const banner = document.createElement("div");
    banner.id = "offline-indicator-banner";
    banner.className = "offline-banner";
    banner.innerHTML = `<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`;
    document.body.appendChild(banner);
    if (window.lucide) {
      window.lucide.createIcons({ root: banner });
    }
    const updateOnlineStatus = () => {
      if (navigator.onLine) {
        banner.classList.remove("visible");
      } else {
        banner.innerHTML = `<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`;
        if (window.lucide) {
          window.lucide.createIcons({ root: banner });
        }
        banner.classList.add("visible");
      }
    };
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    updateOnlineStatus();
    const hasLocalWorkspaceSnapshot = this.hasLocalWorkspaceData();
    if (!hasLocalWorkspaceSnapshot) {
      this.model.workspaceStorage?.setItem("bf_last_sync_timestamp", "0");
      this.model.workspaceStorage?.removeItem("bf_last_sync_version");
      this.model.workspaceStorage?.removeItem("bf_last_fetch_time");
    }
    this.view.initDOM();
    this.setupAuth();
    this.setupActivityTracker();
    this.registerCommands();
    this.setupTheme();
    this.setupSidebar();
    this.setupProfileDropdownEvents();
    this.setupTabs();
    this.setupActionListeners();
    this.setupDelegatedActions();
    this.setupConditionalUI();
    this.view.updateActiveUserProfileDisplay();
    this.setupRBACEvents();
    this.markStartup("ui:critical");
    window.addEventListener("popstate", (e) => {
      this.handlePathRouting(window.location.pathname, false);
    });
    const initialPath = window.location.pathname;
    const initialTabName = this.getTabNameForPath(initialPath) || (this.model.state.activerole === "super_admin" ? "superadmin-dashboard" : "dashboard");
    const routePreparationTasks = [this.view.ensureViewModules(initialTabName)];
    if (["mothau", "danhgiahsdt"].includes(initialTabName) && !this._workflowModulesReady) {
      routePreparationTasks.push(this.ensureWorkflowModules());
    }
    if (!document.getElementById(`tab-${initialTabName}`) && this.lazyTabPartials?.[initialTabName]) {
      routePreparationTasks.push(this.ensureLazyTab(initialTabName));
    }
    routePreparationTasks.push(this.reconcileInitialRouteData());
    await Promise.all(routePreparationTasks);
    await this.handlePathRouting(window.location.pathname, false, true);
    this.markStartup("route:rendered");
    hideInitLoader();
    this.markStartup("loader:hidden");
    this.publishStartupMetrics();
    this.schedulePostStartupTask(() => this.ensureWorkflowModules(), { timeout: 1400, delay: 250 });
    this.schedulePostStartupTask(() => this.preloadPrimaryModals(), { timeout: 1800, delay: 400 });
    this.schedulePostStartupTask(() => {
      this.setupFileUploads();
      this.loadHolidaysInBackground();
    }, { timeout: 600, delay: 100 });
    this._initialSyncStarted = true;
    this.schedulePostStartupTask(() => {
      this.setupAutoSyncBackground();
      this.scheduleBackgroundSync?.(300);
      this.loadInitDataInBackground();
    }, { timeout: 2500, delay: 900 });
  }
  registerCommands() {
    setAppController(this);
    setCommandExecutor((name, ...args) => this.executeCommand(name, ...args));
    const toggleSortTable = (tableKey, field) => {
      const current = this.model.sortState[tableKey] || { field: "", order: "asc" };
      if (current.field === field) {
        current.order = current.order === "asc" ? "desc" : "asc";
      } else {
        current.field = field;
        current.order = "asc";
      }
      this.model.sortState[tableKey] = current;
      if (tableKey === "kehoach") this.view.renderKeHoachTable();
      else if (tableKey === "goithau") this.view.renderGoiThauTable();
      else if (tableKey === "chudautu") this.view.renderChuDauTuTable();
      else if (tableKey === "nhathau") this.view.renderNhaThauTable();
      else if (tableKey === "chuyengia") this.view.renderChuyenGiaTable();
      else if (tableKey === "hopdong") this.view.renderHopDongTable();
    };
    const changePlanRowVersion = (root, selectedId) => {
      if (!this.model.state.selectedPlanVersion) {
        this.model.state.selectedPlanVersion = {};
      }
      this.model.state.selectedPlanVersion[root] = selectedId;
      this.view.renderKeHoachTable();
    };
    const changePackageRowVersion = (root, selectedId) => {
      if (!this.model.state.selectedPackageVersion) {
        this.model.state.selectedPackageVersion = {};
      }
      this.model.state.selectedPackageVersion[root] = selectedId;
      this.view.renderGoiThauTable();
    };
    const changeChuDauTuRowVersion = (root, selectedId) => {
      if (!this.model.state.selectedChuDauTuVersion) {
        this.model.state.selectedChuDauTuVersion = {};
      }
      this.model.state.selectedChuDauTuVersion[root] = selectedId;
      this.view.renderChuDauTuTable();
    };
    const changeNhaThauRowVersion = (root, selectedId) => {
      if (!this.model.state.selectedNhaThauVersion) {
        this.model.state.selectedNhaThauVersion = {};
      }
      this.model.state.selectedNhaThauVersion[root] = selectedId;
      this.view.renderNhaThauTable();
    };
    const changeChuyenGiaRowVersion = (root, selectedId) => {
      if (!this.model.state.selectedChuyenGiaVersion) {
        this.model.state.selectedChuyenGiaVersion = {};
      }
      this.model.state.selectedChuyenGiaVersion[root] = selectedId;
      this.view.renderChuyenGiaTable();
    };
    const changeHopDongRowVersion = (root, selectedId) => {
      if (!this.model.state.selectedHopDongVersion) {
        this.model.state.selectedHopDongVersion = {};
      }
      this.model.state.selectedHopDongVersion[root] = selectedId;
      this.view.renderHopDongTable();
    };
    const invokeLazyViewMethod = async (tabName, methodName, ...args) => {
      try {
        await this.view.ensureViewModules(tabName);
        const method = this.view?.[methodName];
        if (typeof method !== "function") {
          throw new TypeError(`View method ${methodName} is unavailable after loading ${tabName}`);
        }
        return method.apply(this.view, args);
      } catch (error) {
        console.error(`Failed to execute view method ${methodName}:`, error);
        this.view?.showToast?.("Không thể mở thông tin chi tiết", "Vui lòng thử lại hoặc tải lại trang.", "error");
        return void 0;
      }
    };
    const showPackageDetails = (id) => invokeLazyViewMethod("goithau-detail", "showPackageDetails", id);
    const showKeHoachDetails = (id) => invokeLazyViewMethod("kehoach-detail", "showKeHoachDetails", id);
    const showHopDongDetails = (id) => invokeLazyViewMethod("hopdong-detail", "showHopDongDetails", id);
    const showChuyenGiaDetails = (id) => invokeLazyViewMethod("chuyengia", "showChuyenGiaDetails", id);
    const showChuDauTuDetails = (id) => invokeLazyViewMethod("chudautu-detail", "showChuDauTuDetails", id);
    const showNhaThauDetails = (id) => invokeLazyViewMethod("nhathau-detail", "showNhaThauDetails", id);
    const zoomCertificateImage = (id) => {
      const cg = this.model.state.chuyengia.find((c) => c.id === id);
      const safeSrc = safeImageSrc(cg?.anhChungChi, cg?.updatedAt || cg?.createdAt);
      if (!safeSrc) return;
      const lightbox = document.createElement("div");
      lightbox.className = "certificate-lightbox";
      const img = document.createElement("img");
      img.src = safeSrc;
      img.alt = "Chung chi Zoom";
      img.loading = "lazy";
      img.decoding = "async";
      lightbox.appendChild(img);
      lightbox.onclick = () => lightbox.remove();
      document.body.appendChild(lightbox);
    };
    const zoomSignatureImage = (id) => {
      const cg = this.model.state.chuyengia.find((c) => c.id === id);
      const safeSrc = safeImageSrc(cg?.anhChuKy, cg?.updatedAt || cg?.createdAt);
      if (!safeSrc) return;
      const lightbox = document.createElement("div");
      lightbox.className = "certificate-lightbox";
      const img = document.createElement("img");
      img.src = safeSrc;
      img.alt = "Chu ky Zoom";
      img.loading = "lazy";
      img.decoding = "async";
      img.style.maxHeight = "60vh";
      img.style.background = "#fff";
      img.style.padding = "24px";
      img.style.borderRadius = "12px";
      lightbox.appendChild(img);
      lightbox.onclick = () => lightbox.remove();
      document.body.appendChild(lightbox);
    };
    const runWorkflow = async (methodName, ...args) => {
      await this.ensureWorkflowReady(methodName);
      return this[methodName](...args);
    };
    const editKeHoach = (id) => runWorkflow("editKeHoach", id);
    const deleteKeHoach = (id) => runWorkflow("deleteKeHoach", id);
    const addBreakdownRow = (type) => runWorkflow("addBreakdownRow", type);
    const removeBreakdownRow = (btn, type) => runWorkflow("removeBreakdownRow", btn, type);
    const editGoiThau = (id, isReadOnly = false) => runWorkflow("editGoiThau", id, isReadOnly);
    const deleteGoiThau = (id) => runWorkflow("deleteGoiThau", id);
    const restoreCanceledPackage = (id) => runWorkflow("restoreCanceledPackage", id);
    const addGiaHanRow = (data) => runWorkflow("addGiaHanRow", data);
    const validateGiaHanRealtime = () => runWorkflow("validateGiaHanRealtime");
    const moThauGoiThau = (id) => runWorkflow("moThauGoiThau", id);
    const phatHanhHsmtGoiThau = (id) => runWorkflow("phatHanhHsmtGoiThau", id);
    const enforceSingleLeader = (tbodyId, roleName) => runWorkflow("enforceSingleLeader", tbodyId, roleName);
    const openMoThauJVManager = (tr) => runWorkflow("openMoThauJVManager", tr);
    const openMoThauJVViewModal = (members, leadName, leadCode, leadContractorVersionId = "") => runWorkflow("openMoThauJVViewModal", members, leadName, leadCode, leadContractorVersionId);
    const showNhaThauDetailsAndCloseJV = (ntId) => runWorkflow("showNhaThauDetailsAndCloseJV", ntId);
    const editChuDauTu = (id) => runWorkflow("editChuDauTu", id);
    const deleteChuDauTu = (id) => runWorkflow("deleteChuDauTu", id);
    const editNhaThau = (id, isReadOnly = false) => runWorkflow("editNhaThau", id, isReadOnly);
    const deleteNhaThau = (id) => runWorkflow("deleteNhaThau", id);
    const editChuyenGia = (id) => runWorkflow("editChuyenGia", id);
    const deleteChuyenGia = (id) => runWorkflow("deleteChuyenGia", id);
    const editHopDong = (id) => runWorkflow("editHopDong", id);
    const deleteHopDong = (id) => runWorkflow("deleteHopDong", id);
    const saveKetQuaChiDinhThau = (gtId) => runWorkflow("saveKetQuaChiDinhThau", gtId);
    const exportContractFromHopDong = async (pkgId, soHopDong) => {
      const dbId = pkgId;
      const btn = document.querySelector(`button[onclick*="${pkgId}"][onclick*="${soHopDong}"]`);
      const origHTML = btn ? btn.innerHTML : "";
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="animate-spin" style="width:14px;height:14px;"></i>';
        lucide.createIcons({ root: btn });
      }
      try {
        const snapshotVersion = await this.prepareExportSnapshot();
        const exportUrl = appendExportSnapshotVersion(
          `/api/export-report/${dbId}?type=contract`,
          snapshotVersion
        );
        const r = await fetch(exportUrl);
        if (!r.ok) throw new Error("Không thể xuất hợp đồng");
        const b = await r.blob();
        const url = window.URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Hop_dong_${soHopDong || "LCNT"}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } catch (err) {
        this.view.customAlert("Lỗi xuất hợp đồng", err.message, "x-circle");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origHTML;
          lucide.createIcons({ root: btn });
        }
      }
    };
    const addJointVentureMemberCard = (data) => this.addJointVentureMemberCard(data);
    const removeJointVentureMemberCard = (id) => this.removeJointVentureMemberCard(id);
    const switchTab = (tab, action = null, updateState = true) => this.switchTab(tab, action, updateState);
    const toggleOrgLock = (id) => this.toggleOrgLock(id);
    const renewOrgSubscription = (id) => this.renewOrgSubscription(id);
    const editPackageQuota = (pkgId, defaultQuota) => this.editPackageQuota(pkgId, defaultQuota);
    const editSystemPackage = (pkgId) => this.editSystemPackage(pkgId);
    const togglePackageLock = (id) => this.togglePackageLock(id);
    const editEmployee = (id) => this.editEmployee(id);
    const deleteEmployee = (id) => this.deleteEmployee(id);
    const editHoSoGiayStatus = (id) => this.editHoSoGiayStatus(id);
    const deleteHoSoGiayStatus = (id) => this.deleteHoSoGiayStatus(id);
    const triggerUpgradePrompt = () => this.triggerUpgradePrompt();
    const deleteSystemUser = (id, username) => this.deleteSystemUser(id, username);
    const changeUserRole = (id, newRole) => this.changeUserRole(id, newRole);
    const changeUserPackage = (id, newPackage) => this.changeUserPackage(id, newPackage);
    const toggleUserPackage = (id, packageId, isChecked) => this.toggleUserPackage(id, packageId, isChecked);
    const updateUserMetadata = (id, field, value) => this.updateUserMetadata(id, field, value);
    const showSystemUserDetail = (id) => this.showSystemUserDetail(id);
    const renderTablePagination = (containerId, totalItems, currentPage, pageSize) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      const totalPages = Math.ceil(totalItems / pageSize) || 1;
      if (currentPage > totalPages) currentPage = totalPages;
      const startIdx = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
      const endIdx = Math.min(currentPage * pageSize, totalItems);
      let html = `
                <div class="pagination-info">
                    Hiển thị <strong>${startIdx}-${endIdx}</strong> trên tổng số <strong>${totalItems}</strong> bản ghi
                </div>
                <div class="pagination-buttons">
                    <button class="pagination-btn" ${currentPage === 1 ? "disabled" : ""} data-bf-action="page" data-container-id="${containerId}" data-page="1" title="Trang đầu">
                        <i data-lucide="chevrons-left" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === 1 ? "disabled" : ""} data-bf-action="page" data-container-id="${containerId}" data-page="${currentPage - 1}" title="Trang trước">
                        <i data-lucide="chevron-left" style="width:14px; height:14px;"></i>
                    </button>
            `;
      const maxVisiblePages = 5;
      let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
      let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
      }
      for (let i = startPage; i <= endPage; i++) {
        html += `
                    <button class="pagination-btn ${i === currentPage ? "active" : ""}" data-bf-action="page" data-container-id="${containerId}" data-page="${i}">
                        ${i}
                    </button>
                `;
      }
      html += `
                    <button class="pagination-btn" ${currentPage === totalPages ? "disabled" : ""} data-bf-action="page" data-container-id="${containerId}" data-page="${currentPage + 1}" title="Trang sau">
                        <i data-lucide="chevron-right" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === totalPages ? "disabled" : ""} data-bf-action="page" data-container-id="${containerId}" data-page="${totalPages}" title="Trang cuối">
                        <i data-lucide="chevrons-right" style="width:14px; height:14px;"></i>
                    </button>
                </div>
            `;
      container.innerHTML = html;
      lucide.createIcons({ root: container });
    };
    const handlePageChange = (containerId, pageNum) => {
      const tabKey = containerId.split("-")[0];
      this.model.currentPage[tabKey] = pageNum;
      this.model.savePage(tabKey);
      if (tabKey === "kehoach") this.view.renderKeHoachTable();
      else if (tabKey === "goithau") this.view.renderGoiThauTable();
      else if (tabKey === "chudautu") this.view.renderChuDauTuTable();
      else if (tabKey === "nhathau") this.view.renderNhaThauTable();
      else if (tabKey === "chuyengia") this.view.renderChuyenGiaTable();
      else if (tabKey === "hopdong") this.view.renderHopDongTable();
    };
    const commandHandlers = {
      toggleSortTable,
      changePlanRowVersion,
      changePackageRowVersion,
      changeChuDauTuRowVersion,
      changeNhaThauRowVersion,
      changeChuyenGiaRowVersion,
      changeHopDongRowVersion,
      showPackageDetails,
      showKeHoachDetails,
      showHopDongDetails,
      showChuyenGiaDetails,
      showChuDauTuDetails,
      showNhaThauDetails,
      zoomCertificateImage,
      zoomSignatureImage,
      editKeHoach,
      deleteKeHoach,
      addBreakdownRow,
      removeBreakdownRow,
      editGoiThau,
      deleteGoiThau,
      restoreCanceledPackage,
      addGiaHanRow,
      validateGiaHanRealtime,
      moThauGoiThau,
      phatHanhHsmtGoiThau,
      enforceSingleLeader,
      openMoThauJVManager,
      openMoThauJVViewModal,
      showNhaThauDetailsAndCloseJV,
      editChuDauTu,
      deleteChuDauTu,
      editNhaThau,
      deleteNhaThau,
      editChuyenGia,
      deleteChuyenGia,
      editHopDong,
      deleteHopDong,
      saveKetQuaChiDinhThau,
      exportContractFromHopDong,
      addJointVentureMemberCard,
      removeJointVentureMemberCard,
      switchTab,
      toggleOrgLock,
      renewOrgSubscription,
      editPackageQuota,
      editSystemPackage,
      togglePackageLock,
      editEmployee,
      deleteEmployee,
      editHoSoGiayStatus,
      deleteHoSoGiayStatus,
      triggerUpgradePrompt,
      deleteSystemUser,
      changeUserRole,
      changeUserPackage,
      toggleUserPackage,
      updateUserMetadata,
      showSystemUserDetail,
      renderTablePagination,
      handlePageChange,
    };
    Object.entries(commandHandlers).forEach(([name, handler]) => {
      this.registerCommand(name, handler, { exposeLegacy: false });
    });
  }
  setupDelegatedActions() {
    if (this._delegatedActionsReady) return;
    this._delegatedActionsReady = true;
    document.addEventListener("click", (event) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (!eventTarget) return;
      if (eventTarget.closest("[data-bf-stop]") && !eventTarget.closest("[data-bf-stop] [data-bf-action]")) {
        return;
      }
      const target = eventTarget.closest("[data-bf-action]");
      if (!target) return;
      const action = target.dataset.bfAction;
      const id = target.dataset.id;
      const root = target.dataset.root;
      const value = target.dataset.value;
      const call = (fn, ...args) => {
        event.preventDefault();
        const modalId = target.dataset.closeBefore;
        if (modalId) {
          return this.closeModal(modalId, { restoreRoute: false }).then(() => this.executeCommand(fn, ...args));
        }
        return this.executeCommand(fn, ...args);
      };
      switch (action) {
        case "call": {
          const fn = target.dataset.fn;
          if (fn) {
            event.preventDefault();
            let args = [];
            try {
              args = JSON.parse(target.dataset.args || "[]");
            } catch (e) {
              args = [];
            }
            args = args.map((arg) => arg === null ? target : arg);
            this.executeCommand(fn, ...args);
          }
          return;
        }
        case "remove-closest": {
          const selector = target.dataset.selector;
          if (selector) {
            event.preventDefault();
            const node = target.closest(selector);
            if (node) node.remove();
          }
          return;
        }
        case "page":
          return call("handlePageChange", target.dataset.containerId, parseInt(target.dataset.page, 10));
        case "switch-tab":
          return call("switchTab", target.dataset.tab);
        case "close-modal":
          if (target.dataset.modalId) {
            event.preventDefault();
            const modal = document.getElementById(target.dataset.modalId);
            if (modal) modal.classList.remove("active");
          }
          return;
        case "show-package":
          return call("showPackageDetails", id);
        case "edit-package":
          return call("editGoiThau", id);
        case "view-package":
          return call("editGoiThau", id, true);
        case "delete-package":
          return call("deleteGoiThau", id);
        case "restore-package":
          return call("restoreCanceledPackage", id);
        case "show-plan":
          return call("showKeHoachDetails", id);
        case "edit-plan":
          return call("editKeHoach", id);
        case "delete-plan":
          return call("deleteKeHoach", id);
        case "show-investor":
          return call("showChuDauTuDetails", id);
        case "edit-investor":
          return call("editChuDauTu", id);
        case "delete-investor":
          return call("deleteChuDauTu", id);
        case "show-contractor":
          return call("showNhaThauDetails", id);
        case "show-contractor-close-jv":
          return call("showNhaThauDetailsAndCloseJV", id);
        case "show-jv":
          if (getJvData(id)) {
            event.preventDefault();
            const data = getJvData(id);
            this.executeCommand("openMoThauJVViewModal", data.members, data.leadName, data.leadCode, data.leadContractorVersionId || "");
          }
          return;
        case "show-lot-winners":
          return call("showLotWinnersModal", id);
        case "edit-contractor":
          return call("editNhaThau", id);
        case "delete-contractor":
          return call("deleteNhaThau", id);
        case "show-expert":
          return call("showChuyenGiaDetails", id);
        case "edit-expert":
          return call("editChuyenGia", id);
        case "delete-expert":
          return call("deleteChuyenGia", id);
        case "zoom-signature":
          return call("zoomSignatureImage", id);
        case "zoom-certificate":
          return call("zoomCertificateImage", id);
        case "show-contract":
          return call("showHopDongDetails", id);
        case "edit-contract":
          return call("editHopDong", id);
        case "delete-contract":
          return call("deleteHopDong", id);
        case "export-contract":
          return call("exportContractFromHopDong", id, target.dataset.contractNo || "");
        case "change-plan-version":
          return call("changePlanRowVersion", root, value);
        case "change-package-version":
          return call("changePackageRowVersion", root, value);
        default:
          return;
      }
    });
    document.addEventListener("change", (event) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (!eventTarget) return;
      const target = eventTarget.closest("[data-bf-change]");
      if (!target) return;
      const action = target.dataset.bfChange;
      const root = target.dataset.root;
      if (action === "change-plan-version") {
        this.executeCommand("changePlanRowVersion", root, target.value);
      }
      if (action === "change-package-version") {
        this.executeCommand("changePackageRowVersion", root, target.value);
      }
      if (action === "change-investor-version") {
        this.executeCommand("changeChuDauTuRowVersion", root, target.value);
      }
      if (action === "change-contractor-version") {
        this.executeCommand("changeNhaThauRowVersion", root, target.value);
      }
      if (action === "change-expert-version") {
        this.executeCommand("changeChuyenGiaRowVersion", root, target.value);
      }
      if (action === "change-contract-version") {
        this.executeCommand("changeHopDongRowVersion", root, target.value);
      }
    }, true);
  }
}
