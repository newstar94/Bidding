import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { getJvData } from "../packages/jvDataStore.js";
import { safeImageSrc } from "../shared/view_helpers.js";
import { installPrototypeModules } from "./moduleRegistry.js";
import { setCommandExecutor } from "./commandBus.js";
import { hasHolidays, setHolidays } from "../shared/runtimeState.js";
import { APP_DEBUG } from "./appConfig.js";
import { setAppController } from "./controllerRef.js";
import { hideInitLoader, isAuthTransitionActive } from "../auth/authRuntimeState.js";
import { isSessionAuthenticationFailure } from "../auth/AuthSessionController.js";
import { quarantineForcedSession } from "../auth/logoutMutationSafety.js";
import {
  applyAccessContext,
  normalizeOrganizations,
  organizationEmployeeProfile,
  selectActiveOrganization
} from "../auth/accessContext.js";
import {
  awaitAuthoritativeMutationBoundary as awaitStartupAuthoritativeMutationBoundary,
  completeStartupReconciliation,
  getStartupReconciliationState as readStartupReconciliationState,
  initializeStartupReconciliation,
  reconcileRouteDataAtStartup,
  scheduleInitialRouteReconciliation,
  STARTUP_RECONCILIATION_PHASE,
  transitionStartupReconciliation,
} from "./startupReconciliation.js";
import { resolveCommandArgs } from "../shared/commandArgs.js";
import {
  getActiveOrganizationId,
  setActiveOrganizationId
} from "./workspaceState.js";
import { apiFetch, configureApiClient } from "../shared/apiClient.js";
import { showLotWinnersModal as renderLotWinnersModal } from "../packages/lotWinnersModal.js";
import { selectExpertVersion } from "../experts/ExpertVersionSelection.js";
import { selectPackageVersion } from "../shared/versionResolver.js";
import { hydratePlanVersionDraftSessions } from "../plans/PlanVersionDraftSession.js";
import {
  WorkflowModuleLoader,
  workflowRequirementForMethod,
  workflowRequirementForRoute,
} from "./WorkflowModuleLoader.js";
import { createFeatureServices } from "./FeatureServices.js";
import { exportContractWordInBackground } from "../contracts/ContractWordExport.js";
import {
  assertWorkspaceLeaseCurrent,
  beginWorkspaceRequest,
  finishWorkspaceRequest,
} from "./workspaceLease.js";
export class BiddingController {
  constructor(model, view) {
    this.model = model;
    this.view = view;
    Object.assign(this, createFeatureServices(this));
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
      "goithau-timeline": "timeline-goi-thau",
      "mothau": "mothau",
      "danhgiahsdt": "danh-gia-hsdt",
      "hopdong": "hop-dong",
      "chudautu": "chu-dau-tu",
      "nhathau": "nha-thau",
      "chuyengia": "chuyen-gia",
      "bieumau": "bieu-mau",
      "xuatban-word": "xuat-ban-word",
      "superadmin-dashboard": "tong-quan-admin",
      "superadmin": "quan-ly-tai-khoan",
      "commercial-admin": "thuong-mai-thanh-toan",
      "commercial-storefront": "goi-va-thanh-toan",
      "managernhanvien": "nhan-su",
      "managerhosogiay": "trang-thai-hop-dong",
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
      "goithau-timeline": "/tabs/tab_goithau_timeline.html",
      "kehoach-detail": "/tabs/tab_kehoach_detail.html",
      "goithau-detail": "/tabs/tab_goithau_detail.html",
      mothau: "/tabs/tab_mothau.html",
      danhgiahsdt: "/tabs/tab_danhgiahsdt.html",
      "chudautu-detail": "/tabs/tab_chudautu_detail.html",
      "nhathau-detail": "/tabs/tab_nhathau_detail.html",
      "hopdong-detail": "/tabs/tab_hopdong_detail.html",
      bieumau: "/tabs/tab_bieumau.html",
      "xuatban-word": "/tabs/tab_xuatban_word.html",
      "superadmin-dashboard": "/tabs/tab_superadmin_dashboard.html",
      superadmin: "/tabs/tab_superadmin.html",
      "commercial-admin": "/tabs/tab_commercial_admin.html",
      "commercial-storefront": "/tabs/tab_commercial_storefront.html",
      managernhanvien: "/tabs/tab_managernhanvien.html",
      managerhosogiay: "/tabs/tab_managerhosogiay.html",
      profile: "/tabs/tab_profile.html"
    };
    this.lazyModalPartials = {
      "modal-kehoach": "/modals/modal_kehoach.html",
      "modal-procurement-import": "/modals/modal_procurement_import.html",
      "modal-procurement-notice-import": "/modals/modal_procurement_notice_import.html",
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
      "modal-manager-employee-detail": "/modals/modal_employee_detail.html",
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
        template.innerHTML = trustedHTML(html.trim());
        const root = document.getElementById(isTab ? "lazy-tab-root" : "lazy-modal-root") || document.querySelector(isTab ? ".content-viewport" : "body");
        root.appendChild(template.content);
        this.view.elements.navButtons = document.querySelectorAll(".nav-btn");
        this.view.elements.tabPanes = document.querySelectorAll(".tab-pane");
        if (isTab) {
          this.setupActionListeners?.();
          if (["superadmin", "superadmin-dashboard", "commercial-admin", "commercial-storefront", "managernhanvien", "managerhosogiay", "profile"].includes(id)) {
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
      const request = apiFetch(url, { cache: "no-store" }).then((response) => {
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
    } catch {
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
    } catch {
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
    } catch {
    }
    const perfDebugEnabled = APP_DEBUG
      || localStorage.getItem("bf_perf_debug") === "true"
      || new URLSearchParams(window.location.search).get("bf_perf_debug") === "true";
    if (perfDebugEnabled) {
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
  getStartupReconciliationState() {
    return readStartupReconciliationState(this);
  }
  initializeStartupReconciliation() {
    return initializeStartupReconciliation(this);
  }
  async awaitAuthoritativeMutationBoundary() {
    return awaitStartupAuthoritativeMutationBoundary(this);
  }
  getWorkflowModuleLoader() {
    if (!this._workflowModuleLoader) {
      this._workflowModuleLoader = new WorkflowModuleLoader({
        install: (name, module) => installPrototypeModules(BiddingController, [
          { name, module },
        ]),
      });
    }
    return this._workflowModuleLoader;
  }
  isWorkflowRequirementReady(requirement) {
    if (!requirement) return true;
    if (this._workflowModulesReady) return true;
    if (requirement === "bidding" && this._biddingWorkflowModulesReady) return true;
    if (requirement === "partner" && this._partnerWorkflowModulesReady) return true;
    return this.getWorkflowModuleLoader().isReady(requirement);
  }
  ensureWorkflowRequirement(requirement) {
    if (!requirement) return Promise.resolve();
    const promise = this.getWorkflowModuleLoader().ensure(requirement);
    const promiseProperty = requirement === "all"
      ? "_workflowModulesPromise"
      : `_${requirement}WorkflowModulesPromise`;
    this[promiseProperty] = promise;
    return promise.then(() => {
      this._biddingWorkflowModulesReady = this.getWorkflowModuleLoader().isReady("bidding");
      this._partnerWorkflowModulesReady = this.getWorkflowModuleLoader().isReady("partner");
      this._workflowModulesReady = this.getWorkflowModuleLoader().isReady("all");
    }).catch((error) => {
      this[promiseProperty] = null;
      throw error;
    });
  }
  ensureBiddingWorkflows() {
    return this.ensureWorkflowRequirement("bidding");
  }
  ensurePartnerWorkflows() {
    return this.ensureWorkflowRequirement("partner");
  }
  ensureWorkflowModules() {
    return this.ensureWorkflowRequirement("all");
  }
  getWorkflowRequirementForRoute(tabName, action = null) {
    return workflowRequirementForRoute(tabName, action);
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
    const requirement = workflowRequirementForMethod(methodName);
    return Promise.all([
      this.ensureWorkflowRequirement(requirement),
      this.ensureWorkflowData(methodName)
    ]);
  }
  loadHolidaysInBackground() {
    if (hasHolidays()) return;
    apiFetch("/api/holidays").then((res) => res.json()).then((data) => {
      setHolidays(data);
    }).catch((e) => {
      console.error("Failed to load holidays:", e);
      setHolidays({});
    });
  }
  hasLocalWorkspaceData() {
    if (this.model?.hasStorageReadFailures?.()) return true;
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
    const hasUnsavedForm = Boolean(document.querySelector(".modal-overlay.active[data-bf-unsaved='true']"));
    if (!options.accessRevoked && !options.skipUnsyncedWarning && hasUnsavedForm) {
      const details = "biểu mẫu đang nhập chưa được lưu";
      const confirmed = await this.view?.customConfirm?.(
        "Đổi workspace?",
        `Workspace hiện tại còn ${details}. Dữ liệu đã lưu trên thiết bị vẫn được giữ riêng theo workspace; nội dung biểu mẫu chưa lưu sẽ không tự chuyển sang workspace mới.`,
        "refresh-cw"
      );
      if (!confirmed) return { changed: false, cancelled: true, organizationId: currentOrganizationId };
    }
    const startupState = this.getStartupReconciliationState?.();
    const startupReconciliationInFlight = Boolean(
      startupState?.promise || this._startupReconciliationPromise,
    );
    this._workspaceTransitionPromise = (async () => {
      this._workspaceSwitching = true;
      this.model.beginWorkspaceTransition?.();
      await this.model.waitForWorkspaceMutations?.();
      if (this._backgroundSyncTimer) {
        clearTimeout(this._backgroundSyncTimer);
        this._backgroundSyncTimer = null;
      }
      this._backgroundSyncQueued = false;
      if (
        currentOrganizationId
        && !options.skipPendingFlush
        && navigator.onLine
        && typeof this.autoSync === "function"
        && !startupReconciliationInFlight
        && !this._startupReconciliationPromise
      ) {
        try {
          await this.autoSync();
        } catch (error) {
          console.warn("Pending mutations remain isolated in the previous workspace:", error);
        }
      }
      this.disconnectWebSocket?.(false);
      setActiveOrganizationId(organizationId);
      window.dispatchEvent(new CustomEvent("bf:workspace-changed", {
        detail: { organizationId, previousOrganizationId: currentOrganizationId }
      }));
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
      await hydratePlanVersionDraftSessions(this.model);
      this.initializeStartupReconciliation();
      this._workspacePullGenerations?.clear?.();
      this._pendingDetailRecordLoads?.clear?.();
      this.packageWizard = { active: false, planId: null, totalCount: 0, currentCount: 0 };
      this.model.endWorkspaceTransition?.();
      if (!options.localOnly && typeof this.forceSyncData === "function") {
        // A workspace may retain a current delta cursor while its locally
        // hydrated route tables are empty. Cross the scope boundary with an
        // authoritative snapshot so the new workspace cannot render stale data.
        const workspaceToken = this.model?.getWorkspaceToken?.()
          || this.model?.workspaceScope?.key
          || "";
        transitionStartupReconciliation(
          this,
          STARTUP_RECONCILIATION_PHASE.RECONCILING,
          { workspaceToken },
        );
        const pullResult = await this.forceSyncData(false, true);
        completeStartupReconciliation(this, pullResult, workspaceToken);
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
      [this.routeMap["commercial-admin"]]: [],
      [this.routeMap.managernhanvien]: ["EMPLOYEES", "PERMISSIONMATRIX", "ORGANIZATIONS"],
      [this.routeMap.managerhosogiay]: ["CUSTOMCONTRACTSTATUSES"],
      [this.routeMap.kehoach]: ["KEHOACH", "GOITHAU", "CHUDAUTU"],
      [this.routeMap["kehoach-detail"]]: ["KEHOACH", "GOITHAU", "CHUDAUTU"],
      [this.routeMap.goithau]: ["GOITHAU", "GOITHAUHANGHOA", "KEHOACH", "CHUDAUTU", "NHATHAU", "THONGTINMOTHAU", "ASSIGNMENTS"],
      [this.routeMap["goithau-timeline"]]: ["GOITHAU", "KEHOACH", "CHUDAUTU", "HOPDONG", "THONGTINMOTHAU", "ASSIGNMENTS"],
      [this.routeMap["goithau-detail"]]: ["GOITHAU", "GOITHAUHANGHOA", "KEHOACH", "CHUDAUTU", "NHATHAU", "HOPDONG", "THONGTINMOTHAU", "ASSIGNMENTS"],
      [this.routeMap.mothau]: ["GOITHAU", "KEHOACH", "NHATHAU", "THONGTINMOTHAU"],
      [this.routeMap.danhgiahsdt]: ["GOITHAU", "GOITHAUHANGHOA", "HANGHOADUTHAUNHATHAU", "KEHOACH", "NHATHAU", "THONGTINMOTHAU"],
      [this.routeMap.hopdong]: ["HOPDONG", "GOITHAU", "NHATHAU", "CHUDAUTU", "CUSTOMCONTRACTSTATUSES"],
      [this.routeMap["hopdong-detail"]]: ["HOPDONG", "GOITHAU", "KEHOACH", "CHUDAUTU", "NHATHAU", "CUSTOMCONTRACTSTATUSES"],
      [this.routeMap.chudautu]: ["CHUDAUTU", "KEHOACH"],
      [this.routeMap["chudautu-detail"]]: ["CHUDAUTU", "KEHOACH"],
      [this.routeMap.nhathau]: ["NHATHAU", "GOITHAU", "HOPDONG", "THONGTINMOTHAU"],
      [this.routeMap["nhathau-detail"]]: ["NHATHAU", "GOITHAU", "HOPDONG", "THONGTINMOTHAU"],
      [this.routeMap.chuyengia]: ["CHUYENGIA"],
      [this.routeMap.bieumau]: ["GOITHAU", "KEHOACH", "HOPDONG", "CHUDAUTU", "NHATHAU"],
      [this.routeMap["xuatban-word"]]: ["KEHOACH", "GOITHAU"]
    };
    return Array.from(new Set(byRoute[tab] || byRoute[this.routeMap.dashboard]));
  }
  getSyncTableKeysForPath(pathname = window.location.pathname) {
    return this.getStartupPriorityKeys(pathname)
      .map((key) => String(key || "").toLowerCase())
      .filter((key) => ["chudautu", "kehoach", "goithau", "goithauhanghoa", "hanghoaduthaunhathau", "chuyengia", "nhathau", "hopdong", "assignments", "customcontractstatuses", "thongtinmothau", "permissionmatrix"].includes(key));
  }
  loadInitDataInBackground() {
    const load = async () => {
      const request = beginWorkspaceRequest(this.model);
      try {
        const [usersRes, pkgsRes] = await Promise.all([
          apiFetch("/api/auth/users", { signal: request.signal }),
          apiFetch("/api/system-packages", { signal: request.signal })
        ]);
        assertWorkspaceLeaseCurrent(this.model, request.lease);
        if (usersRes.ok) {
          const users = await usersRes.json();
          assertWorkspaceLeaseCurrent(this.model, request.lease);
          request.lease.state.employees = users.map((u) => {
            const employeeProfile = organizationEmployeeProfile(u);
            return {
              id: u.id,
              username: u.username,
              name: employeeProfile.name,
              email: u.email || "",
              phone: employeeProfile.phone,
              role: u.role,
              organizations: normalizeOrganizations(u)
            };
          });
          await this.model.persistData("employees", { trackMutation: false });
          assertWorkspaceLeaseCurrent(this.model, request.lease);
          this.view.populateNhanVienPhuTrachDropdowns();
        }
        if (pkgsRes.ok) {
          const pkgs = await pkgsRes.json();
          assertWorkspaceLeaseCurrent(this.model, request.lease);
          request.lease.state.systempackages = pkgs;
          await this.model.persistData("systempackages", { trackMutation: false });
          assertWorkspaceLeaseCurrent(this.model, request.lease);
        }
      } catch (err) {
        if (err?.code !== "WORKSPACE_CHANGED") {
          console.error("Failed to load init data (users/packages):", err);
        }
      } finally {
        finishWorkspaceRequest(this.model, request);
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
    configureApiClient({
      activeOrganization: getActiveOrganizationId,
      onHttpError: async ({ path, response, data }) => {
        const errorMsg = data?.error || data?.message || "Yêu cầu tới máy chủ thất bại.";
        if (
          response.status === 403
          && path !== "/api/auth/privileged-reauth"
          && String(errorMsg).startsWith("Cần xác thực lại mật khẩu")
        ) {
          if (!this._privilegedReauthPromise) {
            this._privilegedReauthPromise = (async () => {
              const password = await this.view.customPrompt(
                "Xác thực thao tác quản trị",
                "Nhập lại mật khẩu. Quyền thao tác nhạy cảm sẽ có hiệu lực trong thời gian ngắn.",
                "",
                "Mật khẩu hiện tại",
                false,
                null,
                "password"
              );
              if (password === null) return false;
              const reauthResponse = await apiFetch("/api/auth/privileged-reauth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
                handleHttpErrors: false,
                retries: 0
              });
              if (!reauthResponse.ok) {
                let error = "Không thể xác thực lại quyền quản trị.";
                try {
                  error = (await reauthResponse.json())?.error || error;
                } catch {
                }
                await this.view.customAlert("Xác thực thất bại", error, "shield-alert");
                return false;
              }
              return true;
            })().finally(() => {
              this._privilegedReauthPromise = null;
            });
          }
          return { retry: await this._privilegedReauthPromise };
        }
        if (path === "/api/auth/login" || path === "/api/auth/check-session") return null;
        if (response.status === 403 && errorMsg === "Không có quyền truy cập tổ chức này!") {
          if (await this.recoverActiveOrgAccess()) return { retry: true };
        }
        const isSessionError = isSessionAuthenticationFailure(response.status, data);
        if (isSessionError) {
          if (isAuthTransitionActive()) return null;
          void this._checkSessionNow?.();
          const overlay = document.getElementById("auth-overlay");
          if (overlay && getComputedStyle(overlay).display !== "flex") {
            void quarantineForcedSession(this).catch((error) => {
              console.error("Failed to quarantine expired workspace data:", error);
            });
            setRuntimeStyle(overlay, "display", "flex");
            setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
            const formLogin = document.getElementById("form-auth-login");
            const formRegister = document.getElementById("form-auth-register");
            const formForgot = document.getElementById("form-auth-forgot");
            if (formLogin) setRuntimeStyle(formLogin, "display", "block");
            if (formRegister) setRuntimeStyle(formRegister, "display", "none");
            if (formForgot) setRuntimeStyle(formForgot, "display", "none");
          }
          return null;
        }
        if (response.status === 403 && errorMsg === "Không có quyền truy cập tổ chức này!") {
          await this.view.customAlert("⚠️ LỖI QUYỀN HẠN", "Không có quyền truy cập tổ chức này!", "log-out");
          window.location.reload();
        } else if (response.status === 403) {
          await this.view.customAlert("⚠️ LỖI QUYỀN HẠN (403)", `${errorMsg}

Nhấn Xác nhận để tải lại hệ thống.`, "log-out");
          window.location.reload();
        } else if (response.status === 409) {
          window.dispatchEvent(new CustomEvent("bf:api-conflict", { detail: { error: errorMsg, data } }));
        } else if (response.status === 429) {
          window.dispatchEvent(new CustomEvent("bf:api-rate-limit", { detail: { error: errorMsg, data } }));
        }
        return null;
      }
    });
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
        const sessionResponse = await apiFetch("/api/auth/check-session", {
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
    await hydratePlanVersionDraftSessions(this.model);
    this.initializeStartupReconciliation();
    this.markStartup("model:init");
    const banner = document.createElement("div");
    banner.id = "offline-indicator-banner";
    banner.className = "offline-banner";
    banner.hidden = true;
    banner.innerHTML = trustedHTML(`<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`);
    document.body.appendChild(banner);
    if (window.lucide) {
      window.lucide.createIcons({ root: banner });
    }
    const updateOnlineStatus = () => {
      if (navigator.onLine) {
        banner.classList.remove("visible");
        banner.hidden = true;
      } else {
        banner.innerHTML = trustedHTML(`<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`);
        if (window.lucide) {
          window.lucide.createIcons({ root: banner });
        }
        banner.hidden = false;
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
    this.setupSyncUx();
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
    this.renderWorkspaceSwitcher?.();
    this.setupRBACEvents();
    this.markStartup("ui:critical");
    window.addEventListener("popstate", () => {
      this.handlePathRouting(window.location.pathname, false);
    });
    const initialPath = window.location.pathname;
    const initialTabName = this.getTabNameForPath(initialPath) || (this.model.state.activerole === "super_admin" ? "superadmin-dashboard" : "dashboard");
    const routePreparationTasks = [this.view.ensureViewModules(initialTabName)];
    const initialWorkflowRequirement = this.getWorkflowRequirementForRoute(initialTabName);
    if (!this.isWorkflowRequirementReady(initialWorkflowRequirement)) {
      routePreparationTasks.push(this.ensureWorkflowRequirement(initialWorkflowRequirement));
    }
    if (!document.getElementById(`tab-${initialTabName}`) && this.lazyTabPartials?.[initialTabName]) {
      routePreparationTasks.push(this.ensureLazyTab(initialTabName));
    }
    await Promise.all(routePreparationTasks);
    await this.handlePathRouting(window.location.pathname, false, true);
    this.markStartup("route:rendered");
    this.schedulePostStartupTask(async () => {
      await this.ensureBiddingWorkflows();
      await this.resumeProcurementImportSession?.();
    }, { timeout: 2200, delay: 500 });
    hideInitLoader();
    this.markStartup("loader:hidden");
    this.publishStartupMetrics();
    scheduleInitialRouteReconciliation(this, (task, options) => this.schedulePostStartupTask(task, options));
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
      selectPackageVersion(this.model.state, root, selectedId);
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
    const changeChuyenGiaRowVersion = (root, selectedId) => (
      selectExpertVersion(this, root, selectedId)
    );
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
    const showPackageDetails = (id) => {
      this.view._requestedPackageSnapshotId = null;
      this.view._requestedPlanSnapshotId = null;
      return invokeLazyViewMethod("goithau-detail", "showPackageDetails", id);
    };
    const showPackageDetailsSnapshot = (id) => {
      const pkg = (this.model.state.goithau || []).find(
        (candidate) => String(candidate?.id || "") === String(id || ""),
      );
      this.view._requestedPackageSnapshotId = id;
      this.view._requestedPlanSnapshotId = pkg?.keHoachId || null;
      return invokeLazyViewMethod("goithau-detail", "showPackageDetails", id, true);
    };
    const showKeHoachDetails = (id) => invokeLazyViewMethod("kehoach-detail", "showKeHoachDetails", id);
    const showHopDongDetails = (id) => invokeLazyViewMethod("hopdong-detail", "showHopDongDetails", id);
    const showChuyenGiaDetails = (id) => invokeLazyViewMethod("chuyengia", "showChuyenGiaDetails", id);
    const showChuDauTuDetails = (id) => invokeLazyViewMethod("chudautu-detail", "showChuDauTuDetails", id);
    const showNhaThauDetails = (id) => invokeLazyViewMethod("nhathau-detail", "showNhaThauDetails", id);
    const showNhaThauInfoModal = (id) => invokeLazyViewMethod("nhathau-detail", "showNhaThauInfoModal", id);
    const showLotWinnersModal = (id) => {
      try {
        return renderLotWinnersModal({
          model: this.model,
          view: this.view,
        }, id);
      } catch (error) {
        console.error("Failed to show lot winners:", error);
        this.view?.showToast?.(
          "Không thể mở thông tin",
          "Dữ liệu nhà thầu trúng thầu theo phần lô chưa thể hiển thị. Vui lòng thử lại.",
          "error",
        );
        return false;
      }
    };
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
      img.className = "certificate-lightbox-signature";
      img.src = safeSrc;
      img.alt = "Chu ky Zoom";
      img.loading = "lazy";
      img.decoding = "async";
      lightbox.appendChild(img);
      lightbox.onclick = () => lightbox.remove();
      document.body.appendChild(lightbox);
    };
    const runWorkflow = async (methodName, ...args) => {
      await this.ensureWorkflowReady(methodName);
      return this[methodName](...args);
    };
    const editKeHoach = (id) => this.plans.edit(id);
    const deleteKeHoach = (id) => this.plans.delete(id);
    const addBreakdownRow = (type) => this.plans.addBreakdownRow(type);
    const removeBreakdownRow = (btn, type) => this.plans.removeBreakdownRow(btn, type);
    const editGoiThau = (id, isReadOnly = false) => this.packages.edit(id, isReadOnly);
    const deleteGoiThau = (id) => this.packages.delete(id);
    const restoreCanceledPackage = (id) => this.packages.restoreCanceled(id);
    const addGiaHanRow = (data) => this.packages.addExtension(data);
    const validateGiaHanRealtime = () => runWorkflow("validateGiaHanRealtime");
    const moThauGoiThau = (id) => this.evaluation.openBid(id);
    const phatHanhHsmtGoiThau = (id) => this.packages.publishInvitation(id);
    const enforceSingleLeader = (tbodyId, roleName) => runWorkflow("enforceSingleLeader", tbodyId, roleName);
    const openMoThauJVManager = (tr) => this.evaluation.openJointVentureManager(tr);
    const openMoThauJVViewModal = (members, leadName, leadCode, leadContractorVersionId = "") => runWorkflow("openMoThauJVViewModal", members, leadName, leadCode, leadContractorVersionId);
    const showNhaThauDetailsAndCloseJV = (ntId) => runWorkflow("showNhaThauDetailsAndCloseJV", ntId);
    const editChuDauTu = (id) => this.partners.editInvestor(id);
    const deleteChuDauTu = (id) => this.partners.deleteInvestor(id);
    const editNhaThau = (id, isReadOnly = false) => this.partners.editContractor(id, isReadOnly);
    const deleteNhaThau = (id) => this.partners.deleteContractor(id);
    const editChuyenGia = (id) => this.partners.editExpert(id);
    const deleteChuyenGia = (id) => this.partners.deleteExpert(id);
    const editHopDong = (id) => this.contracts.edit(id);
    const deleteHopDong = (id) => this.contracts.delete(id);
    const saveKetQuaChiDinhThau = (gtId) => this.evaluation.saveDirectAppointmentResult(gtId);
    const exportContractFromHopDong = async (pkgId, soHopDong, trigger = null) => {
      if (!this.model.state.activeuser?.wordExportEnabled) {
        await this.view.customAlert(
          "Chức năng cần gói trả phí",
          "Phạm vi đang làm việc chưa có quyền xuất Word.",
          "lock-keyhole"
        );
        return;
      }
      const dbId = pkgId;
      const btn = trigger?.matches?.("button")
        ? trigger
        : document.querySelector(`button[onclick*="${pkgId}"][onclick*="${soHopDong}"]`);
      const origHTML = btn ? btn.innerHTML : "";
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = trustedHTML('<i data-lucide="loader-2" class="animate-spin bf-s-641778be2c"></i>');
        lucide.createIcons({ root: btn });
      }
      try {
        await exportContractWordInBackground({
          packageId: dbId,
          contractNumber: soHopDong,
          prepareExportSnapshot: () => this.prepareExportSnapshot(),
        });
      } catch (err) {
        this.view.customAlert("Lỗi xuất hợp đồng", err.message, "x-circle");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = trustedHTML(origHTML);
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
    const viewEmployee = (id) => this.viewEmployee(id);
    const deleteEmployee = (id) => this.deleteEmployee(id);
    const reAddEmployee = (id, actionButton) => this.reAddEmployee(id, actionButton);
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
                        <i data-lucide="chevrons-left" class="bf-s-641778be2c"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === 1 ? "disabled" : ""} data-bf-action="page" data-container-id="${containerId}" data-page="${currentPage - 1}" title="Trang trước">
                        <i data-lucide="chevron-left" class="bf-s-641778be2c"></i>
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
                        <i data-lucide="chevron-right" class="bf-s-641778be2c"></i>
                    </button>
                    <button class="pagination-btn" ${currentPage === totalPages ? "disabled" : ""} data-bf-action="page" data-container-id="${containerId}" data-page="${totalPages}" title="Trang cuối">
                        <i data-lucide="chevrons-right" class="bf-s-641778be2c"></i>
                    </button>
                </div>
            `;
      container.innerHTML = trustedHTML(html);
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
      showPackageDetailsSnapshot,
      showKeHoachDetails,
      showHopDongDetails,
      showChuyenGiaDetails,
      showChuDauTuDetails,
      showNhaThauDetails,
      showNhaThauInfoModal,
      showLotWinnersModal,
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
      viewEmployee,
      deleteEmployee,
      reAddEmployee,
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
            let args = resolveCommandArgs(target.dataset.argKey);
            if (!target.dataset.argKey) {
              try {
                args = JSON.parse(target.dataset.args || "[]");
              } catch {
                args = [];
              }
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
            return this.closeModal(target.dataset.modalId, { restoreRoute: false });
          }
          return;
        case "show-package":
          return call("showPackageDetails", id);
        case "show-package-snapshot":
          return call("showPackageDetailsSnapshot", id);
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
        case "show-contractor-modal": {
          const openContractorModal = () => call("showNhaThauInfoModal", id);
          const modalId = target.dataset.closeBefore;
          if (modalId) {
            return this.closeModal(modalId, { restoreRoute: false }).then(openContractorModal);
          }
          return openContractorModal();
        }
        case "show-contractor-close-jv":
          return call("showNhaThauDetailsAndCloseJV", id);
        case "show-jv": {
          const data = getJvData(this.model, id);
          if (data) {
            event.preventDefault();
            const openJointVenture = () => this.executeCommand("openMoThauJVViewModal", data.members, data.leadName, data.leadCode, data.leadContractorVersionId || "");
            const modalId = target.dataset.closeBefore;
            if (modalId) {
              return this.closeModal(modalId, { restoreRoute: false }).then(openJointVenture);
            }
            return openJointVenture();
          }
          return;
        }
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
          return call(
            "exportContractFromHopDong",
            id,
            target.dataset.contractNo || "",
            target,
          );
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
