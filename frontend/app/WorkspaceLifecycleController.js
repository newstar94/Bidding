import {
  applyAccessContext,
  normalizeOrganizations,
} from "../auth/accessContext.js";
import { hydratePlanVersionDraftSessions } from "../plans/PlanVersionDraftSession.js";
import {
  completeStartupReconciliation,
  STARTUP_RECONCILIATION_PHASE,
  transitionStartupReconciliation,
} from "./startupReconciliation.js";
import {
  getActiveOrganizationId,
  setActiveOrganizationId,
} from "./workspaceState.js";
import { workspaceTaskScheduler } from "../shared/WorkspaceTaskScheduler.js";

function transitionAbortedError() {
  const error = new Error("Chuyển ngữ cảnh đã được thay thế bởi yêu cầu mới hơn.");
  error.name = "AbortError";
  error.code = "WORKSPACE_LIFECYCLE_SUPERSEDED";
  return error;
}

/**
 * Owns identity-bound workspace/persona transitions.
 *
 * The host only supplies rendering and reconciliation capabilities. This
 * module owns ordering, transition generations, shell readiness, background
 * reconciliation and stale-completion rejection.
 */
export class WorkspaceLifecycleController {
  constructor(host) {
    if (!host?.model) throw new TypeError("Workspace lifecycle requires a model.");
    this.host = host;
    this.generation = 0;
    this.workspaceTransition = null;
    this.roleTransition = null;
  }

  activeOrganizations() {
    return normalizeOrganizations(this.host.model?.state?.activeuser || {})
      .filter((organization) => organization.status === "active");
  }

  identityTuple({ organizationId, activeRole } = {}) {
    const model = this.host.model;
    const user = model?.state?.activeuser || {};
    return Object.freeze({
      userId: String(user.id || globalThis.sessionStorage?.getItem?.("bf_user_id") || ""),
      organizationId: String(
        organizationId || model?.workspaceScope?.organizationId
          || getActiveOrganizationId(),
      ),
      activeRole: String(activeRole || model?.state?.activerole || ""),
      generation: this.generation,
    });
  }

  assertCurrent(identity) {
    const current = this.identityTuple();
    if (
      identity.generation !== this.generation
      || identity.userId !== current.userId
      || identity.organizationId !== current.organizationId
      || identity.activeRole !== current.activeRole
    ) {
      throw transitionAbortedError();
    }
  }

  cancelCurrentScope() {
    const token = this.host.model?.getWorkspaceToken?.()
      || this.host.model?.workspaceScope?.key
      || "";
    if (token) workspaceTaskScheduler(this.host).cancelScope(`${token}:`);
  }

  switchWorkspace(nextOrgId, options = {}) {
    const organizationId = String(nextOrgId || "").trim();
    if (!organizationId) return Promise.reject(new Error("Thiếu organization ID khi đổi workspace"));
    if (this.workspaceTransition) return this.workspaceTransition;
    this.workspaceTransition = this.#switchWorkspace(organizationId, options)
      .finally(() => {
        this.host.model.endWorkspaceTransition?.();
        this.host._workspaceSwitching = false;
        this.workspaceTransition = null;
      });
    return this.workspaceTransition;
  }

  async #switchWorkspace(organizationId, options) {
    const host = this.host;
    const model = host.model;
    const currentUser = model?.state?.activeuser || {};
    const organization = this.activeOrganizations().find((item) => item.id === organizationId);
    if (!organization && !options.accessRevoked) {
      throw new Error("Tổ chức không còn khả dụng trong phiên hiện tại");
    }
    const currentOrganizationId = model?.workspaceScope?.organizationId || getActiveOrganizationId();
    if (currentOrganizationId === organizationId && model?.workspaceScope?.organizationId === organizationId) {
      return { changed: false, organizationId };
    }
    const hasUnsavedForm = Boolean(
      globalThis.document?.querySelector?.(".modal-overlay.active[data-bf-unsaved='true']"),
    );
    if (!options.accessRevoked && !options.skipUnsyncedWarning && hasUnsavedForm) {
      const confirmed = await host.view?.customConfirm?.(
        "Đổi workspace?",
        "Workspace hiện tại còn biểu mẫu đang nhập chưa được lưu. Dữ liệu đã lưu trên thiết bị vẫn được giữ riêng theo workspace; nội dung biểu mẫu chưa lưu sẽ không tự chuyển sang workspace mới.",
        "refresh-cw",
      );
      if (!confirmed) {
        return { changed: false, cancelled: true, organizationId: currentOrganizationId };
      }
    }

    host._workspaceSwitching = true;
    this.cancelCurrentScope();
    model.beginWorkspaceTransition?.();
    await model.waitForWorkspaceMutations?.();
    const generation = ++this.generation;
    if (host._backgroundSyncTimer) {
      globalThis.clearTimeout(host._backgroundSyncTimer);
      host._backgroundSyncTimer = null;
    }
    host._backgroundSyncQueued = false;
    host.disconnectWebSocket?.(false);
    setActiveOrganizationId(organizationId);
    globalThis.window?.dispatchEvent?.(new CustomEvent("bf:workspace-changed", {
      detail: { organizationId, previousOrganizationId: currentOrganizationId },
    }));
    applyAccessContext(currentUser, {
      ...currentUser,
      active_org_id: organizationId,
      platform_role: currentUser.platformRole,
    });
    model.state.activerole = model.constructor.resolveAllowedActiveRole(currentUser);
    currentUser.title = model.constructor.getRoleTitle(model.state.activerole);
    globalThis.sessionStorage?.setItem?.(
      model.STORAGE_KEYS.ACTIVEROLE,
      JSON.stringify(model.state.activerole),
    );
    const serializedUser = JSON.stringify(currentUser);
    globalThis.sessionStorage?.setItem?.(model.STORAGE_KEYS.ACTIVEUSER, serializedUser);
    globalThis.localStorage?.setItem?.(model.STORAGE_KEYS.ACTIVEUSER, serializedUser);

    const identity = Object.freeze({
      userId: String(currentUser.id || globalThis.sessionStorage?.getItem?.("bf_user_id") || ""),
      organizationId,
      activeRole: String(model.state.activerole || ""),
      generation,
    });
    await model.init({
      userId: identity.userId,
      organizationId,
      priorityKeys: host.getStartupPriorityKeys?.(globalThis.window?.location?.pathname || "/"),
    });
    this.assertCurrent(identity);
    host.initializeStartupReconciliation();
    host._workspacePullGenerations?.clear?.();
    host._pendingDetailRecordLoads?.clear?.();
    host.packageWizard = { active: false, planId: null, totalCount: 0, currentCount: 0 };
    model.endWorkspaceTransition?.();
    model.dashboardSummary = model.dashboardSummary || null;
    if (host.view) host.view._dashboardAggregateCache = null;
    host.renderWorkspaceSwitcher?.();
    host.view?.updateActiveUserProfileDisplay?.();
    if (typeof host.switchTab === "function") {
      const targetTab = model.state.activerole === "super_admin"
        ? "superadmin-dashboard" : "dashboard";
      await host.switchTab(targetTab, null, true);
      this.assertCurrent(identity);
    }
    host.schedulePostStartupTask?.(
      () => hydratePlanVersionDraftSessions(model),
      {
        timeout: 1200,
        delay: 0,
        key: `hydrate-plan-drafts:${identity.organizationId}:${identity.activeRole}`,
        priority: "local",
        lane: "cpu",
      },
    );
    host.setupWebSocketConnection?.();
    let reconciliation = null;
    if (!options.localOnly && typeof host.forceSyncData === "function" && globalThis.navigator?.onLine) {
      const workspaceToken = model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "";
      reconciliation = Promise.resolve().then(async () => {
        try {
          this.assertCurrent(identity);
          const pullResult = await host.forceSyncData(false, true);
          this.assertCurrent(identity);
          completeStartupReconciliation(host, pullResult, workspaceToken);
          return pullResult;
        } catch (error) {
          if (error?.name !== "AbortError") {
            completeStartupReconciliation(host, { ok: false, error }, workspaceToken);
            console.warn("Workspace data refresh will be retried in the background:", error);
          }
          return { ok: false, error };
        }
      });
      transitionStartupReconciliation(
        host,
        STARTUP_RECONCILIATION_PHASE.RECONCILING,
        { promise: reconciliation, workspaceToken },
      );
      host._startupReconciliationPromise = reconciliation;
      void reconciliation.finally(() => {
        if (host._startupReconciliationPromise === reconciliation) {
          host._startupReconciliationPromise = null;
        }
      });
    }
    void host.scheduleRemainingStorageHydration?.(reconciliation);
    void host.schedulePrimaryTabWarming?.(reconciliation);
    void host.scheduleReferenceDataLoading?.(reconciliation);
    return {
      changed: true,
      organizationId,
      pendingPreserved: true,
      reconciliationPending: Boolean(reconciliation),
    };
  }

  transitionConfirmedRole({ activeRole, userName, userId, targetTab, targetPath }) {
    if (this.roleTransition) return this.roleTransition;
    this.roleTransition = this.#transitionConfirmedRole({
      activeRole, userName, userId, targetTab, targetPath,
    }).finally(() => { this.roleTransition = null; });
    return this.roleTransition;
  }

  async #transitionConfirmedRole({ activeRole, userName, userId, targetTab, targetPath }) {
    const host = this.host;
    const model = host.model;
    const generation = ++this.generation;
    this.cancelCurrentScope();
    model.switchActiveRole(activeRole, userName, userId);
    host.view.updateActiveUserProfileDisplay();
    globalThis.document?.querySelectorAll?.(
      ".modal-overlay:not(#modal-custom-dialog)",
    )?.forEach?.((modal) => modal.classList.remove("active"));
    globalThis.document?.getElementById?.("profile-dropdown-menu")?.classList?.remove?.("active");
    await model.prepareWorkspaceRoleTransition?.();
    const identity = Object.freeze({
      userId: String(userId || ""),
      organizationId: String(getActiveOrganizationId()),
      activeRole: String(activeRole || ""),
      generation,
    });
    this.assertCurrent(identity);
    globalThis.history?.pushState?.({ tab: targetTab, action: null }, "", targetPath);
    const routeRender = Promise.resolve().then(
      () => host.switchTab(targetTab, null, false),
    );
    const durablePurge = Promise.resolve().then(
      () => model.purgeWorkspaceData?.(),
    );
    await Promise.all([routeRender, durablePurge]);
    this.assertCurrent(identity);
    if (generation !== this.generation) throw transitionAbortedError();
    await model.init({
      userId,
      organizationId: identity.organizationId,
      priorityKeys: host.getStartupPriorityKeys?.(globalThis.window?.location?.pathname || "/"),
    });
    this.assertCurrent(identity);
    host.initializeStartupReconciliation?.();
    const reconciliation = Promise.resolve(host.reconcileInitialRouteData?.());
    void reconciliation.catch((error) => {
      if (error?.name !== "AbortError") {
        console.warn("Đối soát vai trò sẽ được thử lại ở nền:", error);
      }
    });
    void host.scheduleRemainingStorageHydration?.(reconciliation);
    void host.schedulePrimaryTabWarming?.(reconciliation);
    void host.scheduleReferenceDataLoading?.(reconciliation);
    host.renderWorkspaceSwitcher?.();
    host.setupWebSocketConnection?.();
    return { activeRole, identity };
  }
}

export function workspaceLifecycleController(host) {
  if (!host._workspaceLifecycleController) {
    host._workspaceLifecycleController = new WorkspaceLifecycleController(host);
  }
  return host._workspaceLifecycleController;
}
