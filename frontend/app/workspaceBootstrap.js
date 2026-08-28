import { installPrototypeModules } from "./moduleRegistry.js";
import { installAdminModule } from "./adminModuleLoader.js";
import { apiFetch } from "../shared/apiClient.js";
import { beginExplicitLogout, hideInitLoader } from "../auth/authRuntimeState.js";
import { setActiveOrganizationId } from "./workspaceState.js";
import { reportIndexedDBReadFailure } from "../shared/releaseDiagnostics.js";
import { updateServerCapabilitiesFromSession } from "../auth/serverCapabilities.js";
import { POST_STARTUP_TIMING } from "./startupTiming.js";

export function sessionHasActiveWorkspace(initialSession) {
  const user = initialSession?.user;
  if (!user) return false;
  const activeOrganizationId = String(user.active_org_id || "").trim();
  return activeOrganizationId.length > 0
    && Array.isArray(user.organizations)
    && user.organizations.some((organization) => (
      String(organization?.id || "").trim() === activeOrganizationId
      && String(organization?.status || "active").toLowerCase() === "active"
    ));
}

async function bootstrapUnassignedAccount(initialSession) {
  setActiveOrganizationId("");
  document.body.classList.add("workspace-unassigned");
  const overlay = document.getElementById("auth-overlay");
  if (overlay) overlay.hidden = true;
  const viewport = document.querySelector(".content-viewport");
  if (!viewport) {
    hideInitLoader();
    return;
  }
  hideInitLoader();
  viewport.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "unassigned-workspace-panel";
  panel.setAttribute("aria-labelledby", "unassigned-workspace-title");

  const icon = document.createElement("div");
  icon.className = "unassigned-workspace-icon";
  icon.setAttribute("aria-hidden", "true");
  const iconElement = document.createElement("i");
  iconElement.setAttribute("data-lucide", "building-2");
  icon.appendChild(iconElement);

  const title = document.createElement("h1");
  title.id = "unassigned-workspace-title";
  title.textContent = "Không thể khởi tạo không gian làm việc";
  const description = document.createElement("p");
  const accountName = String(initialSession?.user?.name || initialSession?.user?.username || "Tài khoản").trim();
  description.textContent = `${accountName} có thể sử dụng hệ thống bằng không gian dữ liệu cá nhân mà không cần thuộc tổ chức hoặc đăng ký gói tài khoản.`;
  const note = document.createElement("p");
  note.className = "unassigned-workspace-note";
  note.textContent = "Hệ thống chưa nhận được không gian dữ liệu từ máy chủ. Hãy kiểm tra lại để hoàn tất khởi tạo tự động.";

  const actions = document.createElement("div");
  actions.className = "unassigned-workspace-actions";
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "btn btn-primary";
  refreshButton.textContent = "Kiểm tra lại";
  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.className = "btn btn-outline";
  logoutButton.textContent = "Đăng xuất";
  actions.append(refreshButton, logoutButton);
  panel.append(icon, title, description, note, actions);
  viewport.appendChild(panel);

  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = "Đang kiểm tra...";
    try {
      const response = await apiFetch("/api/auth/check-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remember: localStorage.getItem("bf_remember_me") === "true" })
      });
      const session = await response.json();
      updateServerCapabilitiesFromSession(session);
      if (response.ok && session?.valid && sessionHasActiveWorkspace(session)) {
        window.location.reload();
        return;
      }
      note.textContent = "Máy chủ chưa trả về không gian dữ liệu cá nhân. Vui lòng thử lại; tài khoản không cần gói dịch vụ để hoạt động.";
    } catch (_error) {
      note.textContent = "Không thể kiểm tra lúc này. Vui lòng kiểm tra kết nối và thử lại.";
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Kiểm tra lại";
    }
  });
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    beginExplicitLogout();
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.reload();
    }
  });
  window.lucide?.createIcons?.({ root: panel });
}

export function scheduleWorkspaceEnhancements(controller, {
  importAssistantLoader = () => import("../assistant/AssistantLoader.js"),
  importNotificationCenter = () => import("./NotificationCenter.js"),
} = {}) {
  if (typeof controller?.schedulePostStartupTask !== "function") return false;
  controller.schedulePostStartupTask(async () => {
    try {
      const { initializeNotificationCenter } = await importNotificationCenter();
      controller.notificationCenter = initializeNotificationCenter(controller);
    } catch (error) {
      console.warn("Notification center could not be initialized:", error);
    }
  }, {
    timeout: 2500,
    delay: POST_STARTUP_TIMING.notificationCenter,
    key: "notification-center",
    priority: "maintenance",
  });
  controller.schedulePostStartupTask(async () => {
    try {
      const { loadAssistant } = await importAssistantLoader();
      await loadAssistant(controller);
    } catch (error) {
      console.warn("Assistant could not be initialized:", error);
    }
  }, {
    timeout: 3000,
    delay: POST_STARTUP_TIMING.assistant,
    key: "assistant",
    priority: "maintenance",
  });
  return true;
}

export async function bootstrapWorkspace(initialSession) {
  if (!sessionHasActiveWorkspace(initialSession)) {
    await bootstrapUnassignedAccount(initialSession);
    return;
  }
  const [
    { BiddingModel },
    { BiddingView },
    { BiddingController },
    Auth,
    MainUI,
    MainForms,
    MainSync,
    IntegrationBridges,
  ] = await Promise.all([
    import("./BiddingModel.js"),
    import("./BiddingView.js"),
    import("./BiddingController.js"),
    import("../auth/AuthController.js"),
    import("./BiddingControllerUI.js"),
    import("./BiddingControllerForms.js"),
    import("./BiddingControllerSync.js"),
    import("./IntegrationWorkflowBridges.js"),
  ]);
  const effectiveRoles = initialSession?.user?.effective_roles || [];
  const needsAdmin = effectiveRoles.some((role) => ["manager", "super_admin"].includes(role));
  const Admin = needsAdmin ? await installAdminModule(BiddingController) : {
    setupRBACEvents() {
    }
  };
  installPrototypeModules(BiddingController, [
    { name: "auth", module: Auth },
    { name: "admin", module: Admin },
    { name: "main-ui", module: MainUI },
    { name: "main-forms", module: MainForms },
    { name: "main-sync", module: MainSync },
    { name: "integration-bridges", module: IntegrationBridges },
  ]);
  const model = new BiddingModel();
  model.addStorageHydrationListener(({ code, state }) => {
    if (state === "failed") {
      void reportIndexedDBReadFailure(code, { workspaceKey: model.workspaceScope?.key });
    }
  });
  const view = new BiddingView(model);
  const controller = new BiddingController(model, view);
  controller._initialSessionData = initialSession;
  await controller.init();
  scheduleWorkspaceEnhancements(controller);
}
