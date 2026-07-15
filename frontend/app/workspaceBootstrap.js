import { BiddingModel } from "./BiddingModel.js";
import { BiddingView } from "./BiddingView.js";
import { BiddingController } from "./BiddingController.js";
import * as Auth from "../auth/AuthController.js";
import * as MainUI from "./BiddingControllerUI.js";
import * as MainForms from "./BiddingControllerForms.js";
import * as MainSync from "./BiddingControllerSync.js";
import * as IntegrationBridges from "./IntegrationWorkflowBridges.js";
import { installPrototypeModules } from "./moduleRegistry.js";
import { installAdminModule } from "./adminModuleLoader.js";
import { apiFetch } from "../shared/apiClient.js";
import { hideInitLoader } from "../auth/authRuntimeState.js";
import { setActiveOrganizationId } from "./workspaceState.js";

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
  title.textContent = "Tài khoản chưa thuộc tổ chức";
  const description = document.createElement("p");
  const accountName = String(initialSession?.user?.name || initialSession?.user?.username || "Tài khoản").trim();
  description.textContent = `${accountName} đã đăng ký thành công. Quản lý cần thêm tài khoản này vào tổ chức trước khi sử dụng dữ liệu nghiệp vụ.`;
  const note = document.createElement("p");
  note.className = "unassigned-workspace-note";
  note.textContent = "Sau khi quản lý hoàn tất, bấm “Kiểm tra lại” để vào không gian làm việc.";

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
      if (response.ok && session?.valid && sessionHasActiveWorkspace(session)) {
        window.location.reload();
        return;
      }
      note.textContent = "Tài khoản vẫn chưa được thêm vào tổ chức. Vui lòng liên hệ quản lý.";
    } catch (_error) {
      note.textContent = "Không thể kiểm tra lúc này. Vui lòng kiểm tra kết nối và thử lại.";
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Kiểm tra lại";
    }
  });
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.reload();
    }
  });
  hideInitLoader();
  window.lucide?.createIcons?.({ root: panel });
}

export async function bootstrapWorkspace(initialSession) {
  if (!sessionHasActiveWorkspace(initialSession)) {
    await bootstrapUnassignedAccount(initialSession);
    return;
  }
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
  const view = new BiddingView(model);
  const controller = new BiddingController(model, view);
  controller._initialSessionData = initialSession;
  await controller.init();
}
