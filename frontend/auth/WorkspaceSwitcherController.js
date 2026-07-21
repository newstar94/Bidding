import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { normalizeOrganizations } from "./accessContext.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";

function closeProfileDropdown() {
  document.getElementById("profile-dropdown-menu")?.classList.remove("active");
}

export function renderWorkspaceSwitcher() {
  const orgSwitchSection = document.getElementById("org-switch-section");
  const orgSwitchList = document.getElementById("org-switch-list");
  const orgPillContainer = document.getElementById("workspace-pill-container");
  const currentUser = this.model.state.activeuser;
  const workspaces = normalizeOrganizations(currentUser || {})
    .filter((workspace) => workspace.status === "active");
  const onlyPersonalWorkspace = workspaces.length === 1 && workspaces[0].scope_type === "personal";

  if (orgPillContainer) {
    const showWorkspacePill = Boolean(currentUser && workspaces.length > 0 && !onlyPersonalWorkspace);
    orgPillContainer.hidden = !showWorkspacePill;
    setRuntimeStyle(orgPillContainer, "display", showWorkspacePill ? "inline-block" : "none");
  }

  if (!currentUser || workspaces.length <= 1) {
    if (orgSwitchSection) setRuntimeStyle(orgSwitchSection, "display", "none");
    if (orgSwitchList) orgSwitchList.replaceChildren();
    return;
  }

  if (orgSwitchSection) setRuntimeStyle(orgSwitchSection, "display", "block");

  let activeWorkspaceId = getActiveOrganizationId();
  if (!activeWorkspaceId || !workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
    activeWorkspaceId = workspaces[0].id;
    setActiveOrganizationId(activeWorkspaceId);
  }

  if (!orgSwitchList) return;

  orgSwitchList.innerHTML = trustedHTML(workspaces.map((workspace) => {
    const isActive = workspace.id === activeWorkspaceId;
    const initials = workspace.scope_type === "personal"
      ? '<i data-lucide="user" aria-hidden="true"></i>'
      : escapeHtml(workspace.name.split(" ").map((word) => word[0]).join("").substring(0, 2).toUpperCase());
    const activeBackground = isActive ? "var(--primary-soft)" : "transparent";

    return `
      <button type="button" role="menuitem" aria-current="${isActive ? "true" : "false"}"
        class="dropdown-item dropdown-org-btn" data-org="${escapeHtml(workspace.id)}"
        style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border: none; background: ${activeBackground}; width: 100%; text-align: left; padding: 8px 16px; cursor: pointer; transition: background 0.15s ease;">
        <div class="bf-s-1ec945a6d2">
          <div style="width: 24px; height: 24px; border-radius: 6px; background: ${isActive ? "var(--primary)" : "var(--border-color)"}; color: ${isActive ? "#ffffff" : "var(--text-muted)"}; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; transition: background-color 0.2s, color 0.2s;">
            ${initials}
          </div>
          <span style="font-size: 0.78rem; font-weight: ${isActive ? "700" : "500"}; color: ${isActive ? "var(--primary)" : "var(--text-main)"}; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: 1; min-width: 0;">
            ${escapeHtml(workspace.name)}
          </span>
        </div>
        ${isActive ? '<i data-lucide="check" class="bf-s-2238b82015" aria-hidden="true"></i>' : ""}
      </button>
    `;
  }).join(""));

  window.lucide?.createIcons?.({ root: orgSwitchList });

  orgSwitchList.querySelectorAll(".dropdown-org-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const selectedWorkspaceId = button.getAttribute("data-org");
      if (!selectedWorkspaceId) return;

      if (selectedWorkspaceId === getActiveOrganizationId()) {
        closeProfileDropdown();
        return;
      }

      try {
        await this.switchWorkspaceContext(selectedWorkspaceId);
        if (typeof this.reloadEmployeesFromDatabase === "function") {
          await this.reloadEmployeesFromDatabase();
        }
        const selectedName = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.name
          || selectedWorkspaceId;
        await this.view.customAlert(
          "Chuyển đổi thành công",
          `Đã chuyển sang không gian làm việc “${selectedName}”.`,
          "check-circle"
        );
        closeProfileDropdown();
      } catch (error) {
        await this.view.customAlert(
          "Lỗi hệ thống",
          `Không thể chuyển không gian làm việc: ${error.message}`,
          "alert-triangle"
        );
      }
    });
  });
}
