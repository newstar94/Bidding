import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";
import { bindCurrencyElement } from "../app/domUtils.js";
import { businessOrganizations, normalizeOrganizations, organizationEmployeeProfile } from "../auth/accessContext.js";
import { getActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
import { isTrialFullAccess } from "../commercial-policy/trialMode.js";
import { persistAndSync, refreshRecordBeforeDelete } from "../shared/MutationService.js";
import {
  assertWorkspaceLeaseCurrent,
  beginWorkspaceRequest,
  finishWorkspaceRequest,
} from "../app/workspaceLease.js";
import { organizationMembershipCommand } from "./OrganizationMembershipCommand.js";
import { workspaceLifecycleController } from "../app/WorkspaceLifecycleController.js";
import {
  buildProfileUpdatePayload,
  deriveEmailChangeUiState,
  emailChangeErrorMessage,
  isValidEmailChangeOtp
} from "./profileEmailChange.js";

function bindAdminEvent(element, eventName, bindingName, handler) {
  if (!element) return;
  element.__bfBoundEvents = element.__bfBoundEvents || /* @__PURE__ */ new Set();
  const bindingKey = `admin:${eventName}:${bindingName}`;
  if (element.__bfBoundEvents.has(bindingKey)) return;
  element.__bfBoundEvents.add(bindingKey);
  element.addEventListener(eventName, handler);
}

const SWITCHABLE_ACTIVE_ROLES = new Set(["super_admin", "manager", "employee"]);

function allowedActiveRoles(user) {
  const source = Array.isArray(user?.dbRoles) && user.dbRoles.length
    ? user.dbRoles
    : String(user?.dbRole || user?.role || "").split(",");
  const roles = new Set(source.map((role) => String(role).trim().toLowerCase()).filter(Boolean));
  if (roles.has("super_admin")) return new Set(["super_admin", "manager", "employee"]);
  if (roles.has("owner") || roles.has("manager")) return new Set(["manager", "employee"]);
  return new Set(["employee"]);
}

async function confirmedActiveRole(response, currentUser) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Máy chủ trả dữ liệu chuyển vai trò không hợp lệ.");
  }
  const requestId = String(payload?.requestId || response.headers?.get?.("x-request-id") || "").trim();
  if (!response.ok) {
    const suffix = requestId ? ` Mã yêu cầu: ${requestId}.` : "";
    throw new Error(`${payload?.error || payload?.message || "Máy chủ từ chối chuyển vai trò."}${suffix}`);
  }
  const activeRole = String(payload?.activeRole || "").trim().toLowerCase();
  if (!SWITCHABLE_ACTIVE_ROLES.has(activeRole) || !allowedActiveRoles(currentUser).has(activeRole)) {
    throw new Error("Vai trò máy chủ xác nhận không hợp lệ cho tài khoản này.");
  }
  return activeRole;
}

async function persistAdminUpserts(model, upsertsByTable) {
  const entries = Object.entries(upsertsByTable)
    .map(([table, records]) => [
      table,
      [...new Map(
        (records || []).filter((record) => record?.id != null).map((record) => [String(record.id), record]),
      ).values()],
    ])
    .filter(([, records]) => records.length > 0);
  for (const [table, records] of entries) {
    await model.persistChanges(table, { upserts: records }, { throwOnError: true });
  }
  for (const [table, records] of entries) {
    model.commitLocalMutation(table, { records });
  }
}

function setProfileFormBusy(form, label, busy, busyText, idleText) {
  form?.setAttribute("aria-busy", busy ? "true" : "false");
  const submitButton = form?.querySelector?.('button[type="submit"]');
  if (submitButton) submitButton.disabled = busy;
  if (label) label.textContent = busy ? busyText : idleText;
}

function persistActiveProfile(controller, profile) {
  const activeUser = controller.model.state.activeuser || {};
  controller.model.state.activeuser = activeUser;
  activeUser.name = profile.name;
  activeUser.email = profile.email;
  activeUser.avatar = profile.avatar || "";
  const serialized = JSON.stringify(activeUser);
  localStorage.setItem(controller.model.STORAGE_KEYS.ACTIVEUSER, serialized);
  sessionStorage.setItem(controller.model.STORAGE_KEYS.ACTIVEUSER, serialized);
  controller.view.updateActiveUserProfileDisplay();
}

function showLoginAfterSecurityChange(controller) {
  controller.disconnectWebSocket?.(false);
  void Promise.resolve(controller.model.deactivateWorkspace?.()).catch((error) => {
    console.error("Failed to deactivate workspace after email change:", error);
  });
  controller.model.clearSessionData();
  if (controller._sessionInterval) clearInterval(controller._sessionInterval);
  const overlay = document.getElementById("auth-overlay");
  if (!overlay) {
    window.location.assign("/");
    return;
  }
  setRuntimeStyle(overlay, "display", "flex");
  setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
  const formLogin = document.getElementById("form-auth-login");
  const formRegister = document.getElementById("form-auth-register");
  const formForgot = document.getElementById("form-auth-forgot");
  if (formLogin) setRuntimeStyle(formLogin, "display", "block");
  if (formRegister) setRuntimeStyle(formRegister, "display", "none");
  if (formForgot) setRuntimeStyle(formForgot, "display", "none");
  const loginUsername = document.getElementById("login-username");
  const loginPassword = document.getElementById("login-password");
  if (loginUsername) loginUsername.value = "";
  if (loginPassword) loginPassword.value = "";
}
export async function triggerUpgradePrompt() {
  if (isTrialFullAccess(document)) return;
  await this.view.customAlert(
    "Hạn mức Đạt giới hạn!",
    "⚠️ Bạn đã sử dụng hết số lượng nhân viên tối đa của Gói Vàng (15 tài khoản).\n\nVui lòng nâng cấp lên Gói Kim Cương (Không giới hạn nhân viên) để tiếp tục mở rộng quy mô phòng thầu của đơn vị!\n\nLiên hệ Hotline BiddingFlow: 1900.8888 để được hỗ trợ nâng cấp gói cước VIP trong 5 phút.",
    "alert-triangle"
  );
}
export async function loadSystemUsers() {
  try {
    const res = await apiFetch("/api/auth/users");
    if (res.ok) {
      const users = await res.json();
      const currentUsername = sessionStorage.getItem("bf_username");
      this.view.renderSystemUsersTable(users, currentUsername);
    }
  } catch (err) {
    console.error("Failed to load system users:", err);
  }
}
export async function deleteSystemUser(userId, username) {
  const confirmed = await this.view.customConfirm("Ngừng hoạt động tài khoản", `Tài khoản "${username}" sẽ bị khóa đăng nhập và ẩn khỏi danh sách đang hoạt động. Toàn bộ lịch sử vẫn được giữ nguyên. Bạn có muốn tiếp tục?`, "user-x");
  if (confirmed) {
    try {
      const res = await apiFetch(`/api/auth/users/${userId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok) {
        await this.view.customAlert("Thành công", data.message || "Tài khoản đã ngừng hoạt động.", "check-circle");
        this.loadSystemUsers();
      } else {
        await this.view.customAlert("Thất bại", data.error || "Không thể ngừng hoạt động tài khoản này.", "alert-triangle");
      }
    } catch (err) {
      await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
    }
  }
}
export async function changeUserRole(userId, newRole) {
  try {
    const res = await apiFetch("/api/auth/users/update-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, role: newRole })
    });
    const data = await res.json();
    if (res.ok) {
      await this.view.customAlert("Thành công", "Đã thay đổi vai trò người dùng thành công!", "check-circle");
      this.loadSystemUsers();
    } else {
      await this.view.customAlert("Thất bại", data.error || "Không thể thay đổi vai trò.", "alert-triangle");
      this.loadSystemUsers();
    }
  } catch (err) {
    await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
    this.loadSystemUsers();
  }
}
function idempotencyKey(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

function accessPackageOptions(controller) {
  const packages = Array.isArray(controller.model.state.systempackages)
    ? controller.model.state.systempackages.filter((item) => item.status !== "inactive")
    : [];
  return packages.length ? packages : [
    { id: "silver", name: "Gói Bạc (Silver)" },
    { id: "gold", name: "Gói Vàng (Gold)" },
    { id: "diamond", name: "Gói Kim Cương (Diamond)" }
  ];
}

function populateAccessPackageSelect(controller, select, selectedValue) {
  if (!select) return;
  const noneOption = document.createElement("option");
  noneOption.value = "none";
  noneOption.textContent = "Không có gói trả phí";
  const options = accessPackageOptions(controller).map((item) => {
    const option = document.createElement("option");
    option.value = String(item.id || "");
    option.textContent = String(item.name || item.id || "");
    return option;
  });
  select.replaceChildren(noneOption, ...options);
  select.value = selectedValue || "none";
}

function renderWordEntitlement(element, enabled, message) {
  if (!element) return;
  element.dataset.enabled = enabled ? "true" : "false";
  const icon = document.createElement("i");
  icon.dataset.lucide = enabled ? "circle-check" : "lock-keyhole";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = String(message || "");
  element.replaceChildren(icon, text);
}

function renderPersonalAccessSettings() {
  const platformRole = document.getElementById("detail-su-platform-role")?.value || "user";
  const packageSelect = document.getElementById("detail-su-account-package");
  const isPlatformAdmin = platformRole === "super_admin";
  if (packageSelect) packageSelect.disabled = isPlatformAdmin;
  const hasPaidPackage = packageSelect?.value && packageSelect.value !== "none";
  renderWordEntitlement(
    document.getElementById("detail-su-personal-entitlement"),
    isPlatformAdmin || Boolean(hasPaidPackage),
    isPlatformAdmin
      ? "Super Admin dùng quyền nền tảng và không có phạm vi dữ liệu Cá nhân."
      : hasPaidPackage
        ? "Được xuất Word trong phạm vi Cá nhân theo gói cá nhân đang hoạt động."
        : "Chưa có gói cá nhân: vẫn được thêm, sửa, xóa dữ liệu nhưng chức năng xuất Word bị khóa."
  );
  renderLucideIcons(document.getElementById("detail-su-personal-entitlement"));
}

function renderOrganizationAccessSettings(controller, user, organizationId) {
  const organizations = businessOrganizations(user);
  const organization = organizations.find((item) => item.id === organizationId) || organizations[0] || null;
  const form = document.getElementById("form-detail-system-user");
  if (form) form.dataset.organizationId = organization?.id || "";
  const roleSelect = document.getElementById("detail-su-role");
  if (roleSelect) roleSelect.value = organization?.role || "employee";
  populateAccessPackageSelect(
    controller,
    document.getElementById("detail-su-package"),
    organization?.subscription?.package_id || "none"
  );
  const isManager = organization?.role === "manager";
  document.querySelectorAll("[data-document-capability]").forEach((input) => {
    const field = input.dataset.documentCapability;
    input.checked = isManager || Boolean(organization?.document_capabilities?.[field]);
    input.disabled = isManager || !organization?.entitlements?.word_export;
  });
  renderWordEntitlement(
    document.getElementById("detail-su-organization-entitlement"),
    Boolean(organization?.entitlements?.word_export),
    organization?.entitlements?.word_export
      ? `Được xuất Word khi làm việc trong ${organization.name}; quyền lấy từ gói của tổ chức.`
      : `${organization?.name || "Tổ chức"} chưa có gói trả phí hoạt động nên chức năng xuất Word bị khóa.`
  );
  renderLucideIcons(document.getElementById("detail-su-organization-entitlement"));
}

async function updateOrganizationSubscription(organizationId, action, extra = {}) {
  const response = await apiFetch("/api/organizations/subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey(action)
    },
    body: JSON.stringify({ organization_id: organizationId, action, ...extra })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Không thể cập nhật gói dịch vụ.");
  return data;
}

export async function changeUserPackage(organizationId, newPackage) {
  try {
    await updateOrganizationSubscription(organizationId, "set_package", { package_id: newPackage });
    await this.view.customAlert("Thành công", "Đã thay đổi gói đăng ký của tổ chức!", "check-circle");
    this.loadSystemUsers();
  } catch (err) {
    await this.view.customAlert("Thất bại", err.message, "alert-triangle");
    this.loadSystemUsers();
  }
}
export async function toggleUserPackage(organizationId, packageId, isChecked) {
  if (isChecked) await this.changeUserPackage(organizationId, packageId);
}
export async function updateUserMetadata(userId, field, value) {
  try {
    const res = await apiFetch("/api/auth/users/update-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, field, value })
    });
    const data = await res.json();
    if (!res.ok) {
      await this.view.customAlert("Thất bại", data.error || "Không thể cập nhật thông tin.", "alert-triangle");
    }
  } catch (err) {
    await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
  }
}
export async function showSystemUserDetail(userId) {
  try {
    if (!document.getElementById("modal-detail-system-user")) {
      await this.ensureLazyModal?.("modal-detail-system-user");
    }
    const res = await apiFetch("/api/auth/users");
    if (!res.ok) throw new Error("Failed to fetch users");
    const users = await res.json();
    const user = users.find((u) => String(u.id) === String(userId));
    if (!user) {
      await this.view.customAlert("Lỗi", "Không tìm thấy người dùng này!", "alert-triangle");
      return;
    }
    document.getElementById("detail-su-id").value = user.id;
    document.getElementById("detail-su-username").value = user.username;
    document.getElementById("detail-su-name").value = user.name || "";
    document.getElementById("detail-su-email").value = user.email || "";
    document.getElementById("detail-su-platform-role").value = user.platform_role || "user";
    populateAccessPackageSelect(
      this,
      document.getElementById("detail-su-account-package"),
      user.account_subscription?.package_id || "none"
    );
    renderPersonalAccessSettings();
    const organizations = businessOrganizations(user);
    const organizationSelect = document.getElementById("detail-su-organization");
    if (organizationSelect) {
      organizationSelect.replaceChildren(...organizations.map((organization) => {
        const option = document.createElement("option");
        option.value = organization.id;
        option.textContent = organization.name;
        return option;
      }));
    }
    const selectedOrganization = organizations.find((item) => item.id === getActiveOrganizationId()) || organizations[0] || null;
    if (organizationSelect) organizationSelect.value = selectedOrganization?.id || "";
    const organizationSection = document.getElementById("detail-su-organization-section");
    const documentCapabilitiesSection = document.getElementById("detail-su-document-capabilities-section");
    if (organizationSection) organizationSection.hidden = !selectedOrganization;
    if (documentCapabilitiesSection) documentCapabilitiesSection.hidden = !selectedOrganization;
    const form = document.getElementById("form-detail-system-user");
    form.__detailUser = user;
    renderOrganizationAccessSettings(this, user, selectedOrganization?.id || "");
    renderLucideIcons(document.getElementById("modal-detail-system-user"));
    this.view.openModal("modal-detail-system-user");
  } catch (err) {
    await this.view.customAlert("Lỗi hệ thống", "Không thể kết nối đến máy chủ: " + err.message, "alert-triangle");
  }
}
export function setupRBACEvents() {
  bindAdminEvent(document, "click", "switch-active-role", async (e) => {
      const btn = e.target.closest?.(".dropdown-role-btn");
      if (!btn) return;
      const val = btn.getAttribute("data-switch-role");
      if (!["super_admin", "manager", "employee"].includes(val)) return;
      const currentUser = this.model.state.activeuser;
      const userName = currentUser ? currentUser.name : "VTD";
      const realUserId = currentUser?.id || sessionStorage.getItem("bf_user_id") || "";
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      try {
        const response = await apiFetch("/api/auth/active-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active_role: val })
        });
        const activeRole = await confirmedActiveRole(response, currentUser);
        const targetTab = activeRole === "super_admin" ? "superadmin-dashboard" : "dashboard";
        const targetPath = targetTab === "superadmin-dashboard" ? "/tong-quan-admin" : "/tong-quan";
        await workspaceLifecycleController(this).transitionConfirmedRole({
          activeRole,
          userName,
          userId: realUserId,
          targetTab,
          targetPath,
        });
      } catch (error) {
        await this.view.customAlert("Không thể chuyển chế độ", error?.message || "Vui lòng thử lại.", "alert-triangle");
      } finally {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
  });
  const btnAddEmp = document.getElementById("btn-manager-add-employee");
  if (btnAddEmp) {
    bindAdminEvent(btnAddEmp, "click", "open-manager-employee", async () => {
      if (!document.getElementById("modal-manager-employee")) {
        await this.ensureLazyModal?.("modal-manager-employee");
      }
      document.getElementById("modal-employee-title").textContent = "Thêm Nhân sự phòng thầu";
      document.getElementById("form-manager-employee").reset();
      document.getElementById("form-employee-id").value = "";
      this.view.openModal("modal-manager-employee");
    });
  }
  const formEmp = document.getElementById("form-manager-employee");
  if (formEmp) {
    const employeeEmail = document.getElementById("emp-email");
    let candidatePrefetchTimer = null;
    if (typeof employeeEmail?.addEventListener === "function") bindAdminEvent(employeeEmail, "input", "prefetch-membership-candidate", () => {
      if (candidatePrefetchTimer) clearTimeout(candidatePrefetchTimer);
      const email = employeeEmail?.value?.trim?.().toLowerCase() || "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return;
      candidatePrefetchTimer = setTimeout(() => {
        candidatePrefetchTimer = null;
        void organizationMembershipCommand(this).prefetchCandidate(email);
      }, 250);
    });
    bindAdminEvent(formEmp, "submit", "save-manager-employee", async (e) => {
      e.preventDefault();
      if (!this.view.validateForm(formEmp)) return;
      const submitButton = formEmp.querySelector('button[type="submit"]');
      const setEmployeeSubmitBusy = (busy) => {
        formEmp.setAttribute("aria-busy", String(busy));
        if (submitButton) {
          submitButton.disabled = busy;
          submitButton.setAttribute("aria-busy", String(busy));
        }
      };
      const activeOrg = getActiveOrganizationId();
      const activeOrganization = normalizeOrganizations(this.model.state.activeuser || {})
        .find((organization) => organization.id === activeOrg);
      const quotaLimit = Number(activeOrganization?.subscription?.member_quota || 0);
      const memberCount = Number(activeOrganization?.subscription?.member_count || 0);
      const id = document.getElementById("form-employee-id").value;
      if (
        !isTrialFullAccess(document)
        && !id
        && quotaLimit > 0
        && memberCount >= quotaLimit
      ) {
        await this.triggerUpgradePrompt();
        return;
      }
      let foundUser = null;
      const employeeName = document.getElementById("emp-name").value.trim();
      const employeePhone = document.getElementById("emp-phone").value.trim();
      const emailInput = document.getElementById("emp-email").value.trim().toLowerCase();
      let lookupFailureMessage = "";
      setEmployeeSubmitBusy(true);
      try {
        // Submit always revalidates even when typing already prefetched it.
        foundUser = await organizationMembershipCommand(this).lookupCandidate(
          emailInput,
          { revalidate: true },
        );
      } catch (err) {
        console.error("Failed to load account information:", err);
        lookupFailureMessage = err?.message || "Không thể kết nối máy chủ để tra cứu tài khoản.";
      }
      if (!foundUser) {
        setEmployeeSubmitBusy(false);
        await this.view.customAlert(
          "Thông báo",
          lookupFailureMessage || "Nhân sự chưa có tài khoản đang hoạt động và đã xác minh trên hệ thống!",
          "alert-triangle"
        );
        return;
      }
      if (id) {
        const existingEmp = this.model.state.employees.find((em) => em.id === id);
        if (existingEmp && existingEmp.email.trim().toLowerCase() !== emailInput) {
          try {
            const oldUserId = id;
            const removeResponse = await apiFetch("/api/auth/users/remove-from-org", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: oldUserId })
            });
            if (!removeResponse.ok) {
              setEmployeeSubmitBusy(false);
              let removePayload = {};
              try { removePayload = await removeResponse.json(); } catch { /* empty error body */ }
              await this.view.customAlert(
                "Không thể thay nhân sự",
                removePayload.error || "Không thể gỡ nhân sự cũ khỏi tổ chức. Vui lòng xử lý các công việc đang phụ trách trước.",
                "alert-triangle",
              );
              return;
            }
          } catch (err) {
            console.error("Failed to remove the previous employee from the organization:", err);
            setEmployeeSubmitBusy(false);
            await this.view.customAlert("Lỗi hệ thống", "Không thể kết nối máy chủ để gỡ nhân sự cũ. Vui lòng thử lại.", "alert-triangle");
            return;
          }
          const newEmpId = foundUser.id;
          const changedPermissions = [];
          const changedAssignments = [];
          this.model.state.permissionmatrix.forEach((m) => {
            if (m.empId === id) {
              m.empId = newEmpId;
              changedPermissions.push(m);
            }
          });
          this.model.state.assignments.forEach((a) => {
            if (a.empId === id) {
              a.empId = newEmpId;
              changedAssignments.push(a);
            }
          });
          await persistAdminUpserts(this.model, {
            assignments: changedAssignments,
            permissionmatrix: changedPermissions,
          });
        }
      }
      try {
        const resAdd = await apiFetch("/api/auth/users/add-to-org", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: foundUser.id,
            employee_name: employeeName,
            phone: employeePhone
          })
        });
        if (!resAdd.ok) {
          const errData = await resAdd.json();
          setEmployeeSubmitBusy(false);
          await this.view.customAlert("Thất bại", errData.error || "Không thể phân công nhân sự này.", "alert-triangle");
          return;
        }
      } catch (err) {
        setEmployeeSubmitBusy(false);
        await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
        return;
      }
      try {
        const empIdInState = foundUser.id;
        const optimisticEmployee = {
          id: empIdInState,
          username: foundUser.username || emailInput.split("@")[0],
          name: employeeName || foundUser.name || emailInput,
          email: foundUser.email || emailInput,
          phone: employeePhone,
          status: "active",
          role: foundUser.role || "employee",
          organizations: foundUser.organizations || [],
        };
        const employeeIndex = this.model.state.employees.findIndex(
          (employee) => String(employee.id) === String(empIdInState),
        );
        if (employeeIndex >= 0) this.model.state.employees[employeeIndex] = optimisticEmployee;
        else this.model.state.employees.push(optimisticEmployee);
        await this.model.persistChanges("employees", { upserts: [optimisticEmployee] }, {
          trackMutation: false,
          throwOnError: true,
        });
        if (!this.model.state.permissionmatrix.some((m) => m.empId === empIdInState)) {
          const defaultPermission = {
            id: generateRecordId("permissionmatrix"),
            empId: empIdInState,
            kehoach: "view",
            goithau: "view",
            hopdong: "view",
            chudautu: "view",
            nhathau: "view",
            chuyengia: "view"
          };
          this.model.state.permissionmatrix.push(defaultPermission);
          await persistAdminUpserts(this.model, { permissionmatrix: [defaultPermission] });
        }
        this.view.closeModal("modal-manager-employee");
        this.view.renderManagerNhanVienPanel();
        this.view.showToast?.(
          "Đã cập nhật nhân sự",
          "Thành viên đã xuất hiện trong tổ chức; dữ liệu máy chủ đang được đối chiếu nền.",
          "success",
        );
        void Promise.allSettled([
          Promise.resolve(this.reloadEmployeesFromDatabase?.()),
          Promise.resolve(this.autoSync?.()),
        ]);
      } catch (error) {
        console.error("Failed to persist the confirmed organization member locally:", error);
        this.view.showToast?.(
          "Đã thêm nhân sự trên máy chủ",
          "Dữ liệu cục bộ chưa cập nhật xong; hệ thống đang tải lại danh sách.",
          "warning",
        );
        void Promise.resolve(this.reloadEmployeesFromDatabase?.()).catch((reloadError) => {
          console.error("Failed to reload employees after local persistence failure:", reloadError);
        });
      } finally {
        setEmployeeSubmitBusy(false);
      }
    });
  }
  const btnSaveMatrix = document.getElementById("btn-save-permission-matrix");
  if (btnSaveMatrix) {
    bindAdminEvent(btnSaveMatrix, "click", "save-permission-matrix", async () => {
      const changedPermissions = [];
      document.querySelectorAll("#manager-matrix-tbody tr").forEach((row) => {
        const selects = row.querySelectorAll(".matrix-select");
        if (selects.length > 0) {
          const empId = selects[0].getAttribute("data-emp-id");
          const matrix = this.model.state.permissionmatrix.find((m) => m.empId === empId);
          if (matrix) {
            selects.forEach((sel) => {
              const mod = sel.getAttribute("data-module");
              matrix[mod] = sel.value;
            });
            changedPermissions.push(matrix);
          }
        }
      });
      await persistAdminUpserts(this.model, { permissionmatrix: changedPermissions });
      this.view.showToast?.(
        "Đã lưu ma trận phân quyền",
        "Thay đổi đã được lưu trên thiết bị; máy chủ đang được đối chiếu nền.",
        "success",
      );
      void Promise.resolve(this.autoSync?.()).catch((error) => {
        console.error("Background permission synchronization failed:", error);
      });
    });
  }
  const formHsg = document.getElementById("form-manager-hosogiay");
  if (formHsg) {
    bindAdminEvent(formHsg, "submit", "save-paper-status", async (e) => {
      e.preventDefault();
      if (!this.view.validateForm(formHsg)) return;
      const organizationId = getActiveOrganizationId();
      if (!organizationId) {
        await this.view.customAlert("Không thể lưu", "Không xác định được tổ chức đang làm việc.", "alert-triangle");
        return;
      }
      const id = document.getElementById("form-hosogiay-id").value;
      const name = document.getElementById("hsg-name").value.trim();
      const color = document.getElementById("hsg-color").value;
      const currentStatus = id
        ? this.model.state.customcontractstatuses.find((status) => status.id === id)
        : null;
      const data = {
        ...(currentStatus || {}),
        organizationId,
        id: id || generateRecordId("customcontractstatuses"),
        name,
        color
      };
      await this.model.updateRecord("customcontractstatuses", data);
      this.view.renderManagerHoSoGiayPanel();
      formHsg.reset();
      document.getElementById("form-hosogiay-id").value = "";
      document.getElementById("btn-save-hosogiay").innerHTML = trustedHTML('<i data-lucide="plus"></i> Thêm trạng thái');
      renderLucideIcons(document.getElementById("btn-save-hosogiay"), lucide);
      this.view.renderManagerHoSoGiayPanel();
      this.view.showToast?.(
        "Đã lưu trạng thái hợp đồng",
        "Thay đổi đã được lưu trên thiết bị; máy chủ đang được đối chiếu nền.",
        "success",
      );
      void Promise.resolve(this.autoSync?.()).catch((error) => {
        console.error("Background contract status synchronization failed:", error);
      });
    });
  }
  const accountPackageSelect = document.getElementById("detail-su-account-package");
  bindAdminEvent(accountPackageSelect, "change", "preview-personal-entitlement", renderPersonalAccessSettings);
  bindAdminEvent(
    document.getElementById("detail-su-platform-role"),
    "change",
    "preview-platform-role",
    renderPersonalAccessSettings
  );
  const organizationSelect = document.getElementById("detail-su-organization");
  bindAdminEvent(organizationSelect, "change", "switch-user-organization-settings", (event) => {
    const form = document.getElementById("form-detail-system-user");
    renderOrganizationAccessSettings(this, form?.__detailUser || {}, event.target.value);
  });
  const organizationPackageSelect = document.getElementById("detail-su-package");
  bindAdminEvent(organizationPackageSelect, "change", "preview-organization-entitlement", (event) => {
    const form = document.getElementById("form-detail-system-user");
    const organization = businessOrganizations(form?.__detailUser || {})
      .find((item) => item.id === form?.dataset.organizationId);
    const enabled = event.target.value !== "none";
    renderWordEntitlement(
      document.getElementById("detail-su-organization-entitlement"),
      enabled,
      enabled
        ? `Sau khi lưu, thành viên của ${organization?.name || "tổ chức"} được dùng chức năng xuất Word.`
        : `${organization?.name || "Tổ chức"} sẽ không dùng được chức năng xuất Word.`
    );
    document.querySelectorAll("[data-document-capability]").forEach((input) => {
      input.disabled = document.getElementById("detail-su-role")?.value === "manager" || !enabled;
    });
    renderLucideIcons(document.getElementById("detail-su-organization-entitlement"));
  });
  const organizationRoleSelect = document.getElementById("detail-su-role");
  bindAdminEvent(organizationRoleSelect, "change", "toggle-inherited-manager-permissions", (event) => {
    const isManager = event.target.value === "manager";
    document.querySelectorAll("[data-document-capability]").forEach((input) => {
      input.disabled = isManager || document.getElementById("detail-su-package")?.value === "none";
      if (isManager) input.checked = true;
    });
  });
  const formSu = document.getElementById("form-detail-system-user");
  if (formSu) {
    bindAdminEvent(formSu, "submit", "save-system-user", async (e) => {
      e.preventDefault();
      if (!this.view.validateForm(formSu)) return;
      const userId = document.getElementById("detail-su-id").value;
      const platformRole = document.getElementById("detail-su-platform-role").value;
      const accountPackageId = document.getElementById("detail-su-account-package").value;
      const organizationId = formSu.dataset.organizationId || "";
      const submitButton = document.getElementById("detail-su-submit");
      const documentCapabilities = Object.fromEntries(
        Array.from(document.querySelectorAll("[data-document-capability]")).map((input) => [
          input.dataset.documentCapability,
          Boolean(input.checked)
        ])
      );
      try {
        formSu.setAttribute("aria-busy", "true");
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = "Đang lưu...";
        }
        const trialAccess = isTrialFullAccess(document);
        const accessSettingsPayload = {
          user_id: userId,
          platform_role: platformRole,
          organization_id: organizationId || null,
          organization_role: organizationId ? document.getElementById("detail-su-role").value : null,
        };
        if (!trialAccess) {
          Object.assign(accessSettingsPayload, {
            account_package_id: accountPackageId,
            organization_package_id: organizationId ? document.getElementById("detail-su-package").value : null,
            document_capabilities: organizationId ? documentCapabilities : null,
          });
        }
        const response = await apiFetch("/api/auth/users/access-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accessSettingsPayload)
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Không thể cập nhật thiết lập tài khoản.");
        }
        this.view.closeModal("modal-detail-system-user");
        await this.view.customAlert("Thành công", payload.message || "Đã lưu thiết lập tài khoản.", "check-circle");
        await this.loadSystemUsers();
      } catch (err) {
        await this.view.customAlert("Không thể lưu", err.message, "alert-triangle");
      } finally {
        formSu.setAttribute("aria-busy", "false");
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Lưu thiết lập";
        }
      }
    });
  }
  const editPkgPriceInput = document.getElementById("edit-pkg-price");
  if (editPkgPriceInput) {
    bindCurrencyElement(editPkgPriceInput, (value) => this.model.formatVND(value));
  }
  const formEditPkg = document.getElementById("form-edit-package");
  if (formEditPkg) {
    bindAdminEvent(formEditPkg, "submit", "save-system-package", async (e) => {
      e.preventDefault();
      if (!this.view.validateForm(formEditPkg)) return;
      const id = document.getElementById("edit-pkg-id").value;
      const name = document.getElementById("edit-pkg-name").value.trim();
      const price = this.model.parseVND(document.getElementById("edit-pkg-price").value);
      const quota = parseInt(document.getElementById("edit-pkg-quota").value, 10) || 0;
      const description = document.getElementById("edit-pkg-desc").value.trim();
      try {
        const res = await apiFetch("/api/system-packages/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            name,
            price,
            quota,
            description,
            status: this.model.state.systempackages.find((item) => item.id === id)?.status || "active"
          })
        });
        const data = await res.json();
        if (res.ok) {
          const localPkg = this.model.state.systempackages.find((p) => p.id === id);
          if (localPkg) {
            Object.assign(localPkg, { name, price, quota, description });
          }
          this.model.persistData("systempackages");
          this.view.closeModal("modal-edit-package");
          this.view.renderSuperAdminPanel();
          await this.view.customAlert("Thành công", "Đã cập nhật thông tin gói cước thành công!", "check-circle");
          this.autoSync();
        } else {
          await this.view.customAlert("Thất bại", data.error || "Không thể cập nhật gói cước.", "alert-triangle");
        }
      } catch (err) {
        await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
      }
    });
  }
  this.tempProfileAvatarBase64 = "";
  const profileAvatarInput = document.getElementById("profile-avatar-input");
  const profileAvatarPreview = document.getElementById("profile-avatar-preview");
  const profileAvatarFallback = document.getElementById("profile-avatar-fallback");
  if (profileAvatarInput) {
    bindAdminEvent(profileAvatarInput, "change", "select-profile-avatar", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (!allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024) {
        e.target.value = "";
        this.view.customAlert("Ảnh không hợp lệ", "Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP không quá 5 MB.", "alert-triangle");
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const maxW = 150;
          const maxH = 150;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            if (w > maxW) {
              h = Math.round(h * maxW / w);
              w = maxW;
            }
          } else {
            if (h > maxH) {
              w = Math.round(w * maxH / h);
              h = maxH;
            }
          }
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.85);
          this.tempProfileAvatarBase64 = compressedBase64;
          if (profileAvatarPreview) {
            profileAvatarPreview.src = compressedBase64;
            profileAvatarPreview.hidden = false;
          }
          if (profileAvatarFallback) {
            profileAvatarFallback.hidden = true;
          }
        };
        img.onerror = () => {
          e.target.value = "";
          this.view.customAlert("Ảnh không hợp lệ", "Không thể đọc nội dung tệp ảnh đã chọn.", "alert-triangle");
        };
        img.src = event.target.result;
      };
      reader.onerror = () => {
        e.target.value = "";
        this.view.customAlert("Ảnh không hợp lệ", "Không thể đọc tệp ảnh đã chọn.", "alert-triangle");
      };
      reader.readAsDataURL(file);
    });
  }
  const formProfileUpdate = document.getElementById("form-profile-update");
  const profileEmailInput = document.getElementById("profile-email");
  const profileCurrentPassword = document.getElementById("profile-current-password");
  const profileCurrentPasswordGroup = document.getElementById("profile-current-password-group");
  const profileUpdateSubmitLabel = document.getElementById("profile-update-submit-label");
  const formProfileEmailVerification = document.getElementById("form-profile-email-verification");
  const profileEmailVerificationStatus = document.getElementById("profile-email-verification-status");
  const profileEmailOtp = document.getElementById("profile-email-otp");
  const profileEmailVerifySubmitLabel = document.getElementById("profile-email-verify-submit-label");

  const refreshEmailChangeControls = () => {
    const state = deriveEmailChangeUiState({
      currentEmail: this.model.state.activeuser?.email,
      desiredEmail: profileEmailInput?.value,
      pendingEmail: this.pendingProfileEmail
    });
    if (profileCurrentPasswordGroup) profileCurrentPasswordGroup.hidden = !state.passwordRequired;
    if (profileCurrentPassword) {
      profileCurrentPassword.required = state.passwordRequired;
      profileCurrentPassword.setAttribute("aria-required", state.passwordRequired ? "true" : "false");
      if (!state.passwordRequired) profileCurrentPassword.value = "";
    }
    if (formProfileEmailVerification) {
      formProfileEmailVerification.hidden = !state.verificationPending;
    }
    return state;
  };

  if (profileEmailInput) {
    bindAdminEvent(profileEmailInput, "input", "toggle-profile-email-password", () => {
      if (this.pendingProfileEmail
        && profileEmailInput.value.trim().toLowerCase() !== this.pendingProfileEmail.toLowerCase()) {
        this.pendingProfileEmail = "";
        if (profileEmailOtp) profileEmailOtp.value = "";
      }
      refreshEmailChangeControls();
    });
    refreshEmailChangeControls();
  }

  if (formProfileUpdate) {
    bindAdminEvent(formProfileUpdate, "submit", "save-profile", async (e) => {
      e.preventDefault();
      const emailState = refreshEmailChangeControls();
      if (!this.view.validateForm(formProfileUpdate)) return;
      const name = document.getElementById("profile-fullname").value.trim();
      const email = document.getElementById("profile-email").value.trim();
      const avatar = this.tempProfileAvatarBase64 || this.model.state.activeuser.avatar || "";
      const password = profileCurrentPassword?.value || "";
      if (emailState.passwordRequired && !password) {
        await this.view.customAlert(
          "Cần xác thực",
          "Vui lòng nhập mật khẩu hiện tại để thay đổi email.",
          "shield-alert",
          profileCurrentPassword
        );
        return;
      }
      const { payload } = buildProfileUpdatePayload({
        name,
        email,
        avatar,
        currentEmail: this.model.state.activeuser?.email,
        password
      });
      setProfileFormBusy(
        formProfileUpdate,
        profileUpdateSubmitLabel,
        true,
        "Đang cập nhật...",
        "Cập nhật hồ sơ"
      );
      try {
        const res = await apiFetch("/api/auth/update-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.profile) {
          persistActiveProfile(this, data.profile);
          if (data.emailChangePending && data.pendingEmail) {
            this.pendingProfileEmail = String(data.pendingEmail).trim();
            if (profileEmailInput) profileEmailInput.value = this.pendingProfileEmail;
            if (profileCurrentPassword) profileCurrentPassword.value = "";
            if (profileEmailVerificationStatus) {
              profileEmailVerificationStatus.textContent = `Mã OTP đã được gửi đến ${this.pendingProfileEmail}.`;
            }
            refreshEmailChangeControls();
            profileEmailOtp?.focus();
            await this.view.customAlert(
              "Cần xác minh email",
              "Thông tin hồ sơ đã được lưu. Hãy nhập mã OTP gửi đến email mới để hoàn tất thay đổi.",
              "mail-check"
            );
          } else {
            this.pendingProfileEmail = "";
            if (profileEmailInput) profileEmailInput.value = data.profile.email || "";
            refreshEmailChangeControls();
            await this.view.customAlert("Thành công", "Thông tin cá nhân đã được cập nhật thành công!", "check-circle");
          }
        } else {
          await this.view.customAlert(
            "Không thể cập nhật",
            emailChangeErrorMessage(data.code, data.error || "Máy chủ không trả về hồ sơ đã cập nhật."),
            "alert-triangle"
          );
        }
      } catch (err) {
        await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
      } finally {
        setProfileFormBusy(
          formProfileUpdate,
          profileUpdateSubmitLabel,
          false,
          "Đang cập nhật...",
          "Cập nhật hồ sơ"
        );
      }
    });
  }

  if (formProfileEmailVerification) {
    bindAdminEvent(formProfileEmailVerification, "submit", "verify-profile-email", async (e) => {
      e.preventDefault();
      const code = profileEmailOtp?.value?.trim() || "";
      if (!isValidEmailChangeOtp(code)) {
        profileEmailOtp?.setAttribute("aria-invalid", "true");
        await this.view.customAlert(
          "Mã OTP không hợp lệ",
          "Mã OTP phải gồm đúng 6 chữ số.",
          "alert-triangle",
          profileEmailOtp
        );
        return;
      }
      profileEmailOtp?.setAttribute("aria-invalid", "false");
      setProfileFormBusy(
        formProfileEmailVerification,
        profileEmailVerifySubmitLabel,
        true,
        "Đang xác minh...",
        "Xác minh và đổi email"
      );
      try {
        const response = await apiFetch("/api/auth/verify-email-change", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code })
        });
        const data = await response.json();
        if (!response.ok) {
          const restartCodes = new Set([
            "EMAIL_CHANGE_OTP_EXPIRED",
            "EMAIL_CHANGE_NOT_PENDING",
            "EMAIL_CHANGE_REQUEST_REPLACED",
            "EMAIL_CHANGE_REQUEST_STALE"
          ]);
          if (restartCodes.has(data.code)) {
            this.pendingProfileEmail = "";
            refreshEmailChangeControls();
          }
          await this.view.customAlert(
            "Không thể xác minh",
            emailChangeErrorMessage(data.code, data.error),
            "alert-triangle",
            restartCodes.has(data.code) ? profileCurrentPassword : profileEmailOtp
          );
          return;
        }
        await this.view.customAlert(
          "Email đã được thay đổi",
          data.message || "Email mới đã được xác minh. Vui lòng đăng nhập lại.",
          "check-circle"
        );
        showLoginAfterSecurityChange(this);
      } catch (err) {
        await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
      } finally {
        setProfileFormBusy(
          formProfileEmailVerification,
          profileEmailVerifySubmitLabel,
          false,
          "Đang xác minh...",
          "Xác minh và đổi email"
        );
      }
    });
  }
  const formProfilePassword = document.getElementById("form-profile-password");
  if (formProfilePassword) {
    bindAdminEvent(formProfilePassword, "submit", "change-profile-password", async (e) => {
      e.preventDefault();
      if (!this.view.validateForm(formProfilePassword)) return;
      const username = document.getElementById("profile-username").value;
      const oldPassword = document.getElementById("profile-old-password").value;
      const newPassword = document.getElementById("profile-new-password").value;
      const confirmPassword = document.getElementById("profile-confirm-password").value;
      if (newPassword.length < 8 || newPassword.length > 256) {
        await this.view.customAlert("Lỗi mật khẩu", "Mật khẩu mới phải có từ 8 đến 256 ký tự!", "alert-triangle", document.getElementById("profile-new-password"));
        return;
      }
      if (newPassword !== confirmPassword) {
        await this.view.customAlert("Lỗi mật khẩu", "Xác nhận mật khẩu mới không trùng khớp!", "alert-triangle", document.getElementById("profile-confirm-password"));
        return;
      }
      try {
        const res = await apiFetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, old_password: oldPassword, new_password: newPassword })
        });
        const data = await res.json();
        if (res.ok) {
          await this.view.customAlert("Thành công", "Đổi mật khẩu thành công! Vui lòng đăng nhập lại.", "check-circle");
          this.disconnectWebSocket?.(false);
          this.model.clearSessionData();
          if (this._sessionInterval) clearInterval(this._sessionInterval);
          const overlay = document.getElementById("auth-overlay");
          if (overlay) {
            setRuntimeStyle(overlay, "display", "flex");
            setRuntimeStyle(document.querySelector(".app-container"), "filter", "blur(10px)");
            const formLogin = document.getElementById("form-auth-login");
            const formRegister = document.getElementById("form-auth-register");
            const formForgot = document.getElementById("form-auth-forgot");
            setRuntimeStyle(formLogin, "display", "block");
            setRuntimeStyle(formRegister, "display", "none");
            setRuntimeStyle(formForgot, "display", "none");
            document.getElementById("login-username").value = "";
            document.getElementById("login-password").value = "";
          }
        } else {
          await this.view.customAlert("Thất bại", data.error || "Không thể đổi mật khẩu.", "alert-triangle");
        }
      } catch (err) {
        await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
      }
    });
  }
}
export async function editEmployee(id) {
  const emp = this.model.state.employees.find((e) => e.id === id);
  if (!emp) return;
  if (!document.getElementById("modal-manager-employee")) {
    await this.ensureLazyModal?.("modal-manager-employee");
  }
  document.getElementById("modal-employee-title").textContent = "Cập nhật Nhân sự phòng thầu";
  document.getElementById("form-employee-id").value = emp.id;
  document.getElementById("emp-name").value = emp.name;
  document.getElementById("emp-email").value = emp.email;
  document.getElementById("emp-phone").value = emp.phone;
  this.view.openModal("modal-manager-employee");
}

export async function viewEmployee(id) {
  if (!this.view.renderEmployeeDetail) return;
  if (!document.getElementById("modal-manager-employee-detail")) {
    await this.ensureLazyModal?.("modal-manager-employee-detail");
  }
  this.view.renderEmployeeDetail(id);
  this.view.openModal("modal-manager-employee-detail");
}
export async function deleteEmployee(id) {
  const emp = this.model.state.employees.find((e) => e.id === id);
  if (!emp) return;
  const assignmentsCount = this.model.state.assignments.filter(
    (assignment) => assignment.empId === id && ["goithau", "hopdong"].includes(assignment.type)
  ).length;
  let warningText = `Bạn có chắc chắn muốn gỡ nhân sự "${emp.name}" khỏi đơn vị? Họ sẽ không còn quyền truy cập dữ liệu của đơn vị này nữa.`;
  if (assignmentsCount > 0) {
    warningText += `

⚠️ CHÚ Ý: Nhân sự này đang phụ trách ${assignmentsCount} gói thầu/hợp đồng. Các phân công của họ sẽ được gỡ; bản ghi vẫn được giữ nguyên và có thể ở trạng thái chưa phân công.`;
  }
  const confirmed = await this.view.customConfirm(
    "Xác nhận gỡ nhân sự",
    warningText,
    "trash-2",
  );
  if (confirmed) {
    try {
      const submitOffboarding = ({ successorUserId = "", assignmentSuccessors = [] } = {}) => {
        const payload = { user_id: id };
        if (successorUserId) payload.successor_user_id = successorUserId;
        if (assignmentSuccessors.length) {
          payload.assignment_successors = assignmentSuccessors.map((item) => ({
            assignment_id: item.assignmentId,
            successor_user_id: item.successorUserId
          }));
        }
        return apiFetch("/api/auth/users/remove-from-org", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      };
      let res = await submitOffboarding();
      let data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === "SUCCESSOR_REQUIRED") {
        const candidates = Array.isArray(data.successorCandidates) ? data.successorCandidates : [];
        if (!candidates.length) {
          await this.view.customAlert("Chưa thể cho rời tổ chức", "Không có nhân sự đang hoạt động để tiếp quản công việc.", "alert-triangle");
          return;
        }
        const assignmentsToTransfer = data.assignmentsRequiringTransfer || data.openAssignments || [];
        const describeAssignment = (assignment) => {
          const type = assignment.type === "hopdong" ? "hopdong" : "goithau";
          const records = type === "hopdong"
            ? (this.model.state.hopdong || [])
            : (this.model.state.goithau || []);
          const target = records.find((record) => String(record.id) === String(assignment.targetId))
            || records.find((record) => String(record.rootId || record.id) === String(assignment.targetId));
          const code = type === "hopdong" ? target?.soHopDong : target?.maGoiThau;
          const name = type === "hopdong" ? target?.tenHopDong : target?.tenGoiThau;
          return {
            assignmentId: assignment.id,
            targetId: assignment.targetId,
            type,
            typeLabel: type === "hopdong" ? "Hợp đồng" : "Gói thầu",
            label: [code, name].filter(Boolean).join(" – ") || assignment.targetId
          };
        };
        const transferChoice = await this.view.customAssignmentTransferConfirm(
          "Chọn cách chuyển giao công việc",
          `${emp.name} đang phụ trách ${assignmentsToTransfer.length} gói thầu/hợp đồng. Mọi công việc phải có người tiếp quản trước khi gỡ nhân sự.`,
          assignmentsToTransfer.map(describeAssignment),
          candidates.map((candidate) => ({ value: candidate.user_id, label: candidate.name }))
        );
        if (!transferChoice) return;
        res = await submitOffboarding(transferChoice);
        data = await res.json().catch(() => ({}));
      }
      if (res.ok) {
        await this.reloadEmployeesFromDatabase();
        this.model.state.permissionmatrix = this.model.state.permissionmatrix.filter((m) => m.empId !== id);
        await this.model.persistData("permissionmatrix", { trackMutation: false });
        await this.forceSyncData(true, true);
        this.view.renderManagerNhanVienPanel();
        await this.view.customAlert("Đã cho nhân sự rời tổ chức", "Quyền truy cập đã được thu hồi và lịch sử phân công được giữ lại.", "check-circle");
      } else {
        await this.view.customAlert("Thất bại", data.error || "Không thể gỡ bỏ nhân sự này.", "alert-triangle");
      }
    } catch (err) {
      await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
    }
  }
}
export async function reAddEmployee(id, actionButton = null) {
  const employee = (this.model.state.formerEmployees || []).find((item) => item.id === id);
  if (!employee) return;
  const confirmed = await this.view.customConfirm(
    "Thêm lại nhân viên",
    `Thêm “${employee.name}” trở lại tổ chức với email hiện tại ${employee.email}? Nhân viên sẽ được cấp lại quyền xem mặc định.`,
    "user-plus"
  );
  if (!confirmed) return;

  const originalButtonHtml = actionButton?.innerHTML || "";
  let serverConfirmed = false;
  if (actionButton) {
    actionButton.disabled = true;
    actionButton.setAttribute("aria-busy", "true");
    actionButton.innerHTML = trustedHTML('<i class="anim-spin" data-lucide="loader-circle" aria-hidden="true"></i>');
    lucide.createIcons({ root: actionButton });
  }
  try {
    const response = await apiFetch("/api/auth/users/add-to-org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: employee.id,
        employee_name: employee.name,
        phone: employee.phone || ""
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await this.view.customAlert("Không thể thêm lại", data.error || "Không thể thêm lại nhân viên này.", "alert-triangle");
      return;
    }
    serverConfirmed = true;

    const restoredEmployee = { ...employee, status: "active" };
    const employeeIndex = this.model.state.employees.findIndex(
      (item) => String(item.id) === String(employee.id),
    );
    if (employeeIndex >= 0) this.model.state.employees[employeeIndex] = restoredEmployee;
    else this.model.state.employees.push(restoredEmployee);
    this.model.state.formerEmployees = (this.model.state.formerEmployees || []).filter(
      (item) => String(item.id) !== String(employee.id),
    );
    await this.model.persistChanges("employees", { upserts: [restoredEmployee] }, {
      trackMutation: false,
      throwOnError: true,
    });
    if (!this.model.state.permissionmatrix.some((item) => item.empId === employee.id)) {
      const defaultPermission = {
        id: generateRecordId("permissionmatrix"),
        empId: employee.id,
        kehoach: "view",
        goithau: "view",
        hopdong: "view",
        chudautu: "view",
        nhathau: "view",
        chuyengia: "view"
      };
      this.model.state.permissionmatrix.push(defaultPermission);
      await persistAdminUpserts(this.model, { permissionmatrix: [defaultPermission] });
    }
    this.view.renderManagerNhanVienPanel();
    this.view.showToast?.(
      "Đã thêm lại nhân viên",
      data.message || "Nhân viên đã trở lại tổ chức.",
      "success",
    );
    void Promise.allSettled([
      Promise.resolve(this.reloadEmployeesFromDatabase?.()),
      Promise.resolve(this.autoSync?.()),
    ]);
  } catch (err) {
    if (serverConfirmed) {
      console.error("Failed to persist the restored organization member locally:", err);
      this.view.showToast?.(
        "Đã thêm lại nhân viên trên máy chủ",
        "Dữ liệu cục bộ chưa cập nhật xong; hệ thống đang tải lại danh sách.",
        "warning",
      );
      void Promise.resolve(this.reloadEmployeesFromDatabase?.()).catch((reloadError) => {
        console.error("Failed to reload restored employees:", reloadError);
      });
    } else {
      await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
    }
  } finally {
    if (actionButton?.isConnected) {
      actionButton.disabled = false;
      actionButton.removeAttribute("aria-busy");
      actionButton.innerHTML = trustedHTML(originalButtonHtml);
      lucide.createIcons({ root: actionButton });
    }
  }
}
export async function reloadEmployeesFromDatabase() {
  return organizationMembershipCommand(this).reloadProjection(async () => {
  const request = beginWorkspaceRequest(this.model);
  try {
    const [usersRes, formerRes] = await Promise.all([
      apiFetch("/api/auth/users", { signal: request.signal }),
      apiFetch("/api/organizations/former-members", { signal: request.signal }),
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
          status: "active",
          role: u.role,
          organizations: normalizeOrganizations(u)
        };
      });
      await this.model.persistData("employees", { trackMutation: false });
      assertWorkspaceLeaseCurrent(this.model, request.lease);
      this.view.populateNhanVienPhuTrachDropdowns();
    }
    assertWorkspaceLeaseCurrent(this.model, request.lease);
    const formerEmployees = formerRes.ok ? await formerRes.json() : [];
    assertWorkspaceLeaseCurrent(this.model, request.lease);
    request.lease.state.formerEmployees = formerEmployees;
  } catch (err) {
    if (err?.code !== "WORKSPACE_CHANGED") {
      console.error("Failed to reload employees:", err);
    }
  } finally {
    finishWorkspaceRequest(this.model, request);
  }
  });
}
export function editHoSoGiayStatus(id) {
  const status = this.model.state.customcontractstatuses.find((s) => s.id === id);
  if (!status) return;
  document.getElementById("form-hosogiay-id").value = status.id;
  document.getElementById("hsg-name").value = status.name;
  document.getElementById("hsg-color").value = status.color;
  document.getElementById("btn-save-hosogiay").innerHTML = trustedHTML('<i data-lucide="save"></i> Cập nhật trạng thái');
  renderLucideIcons(document.getElementById("btn-save-hosogiay"), lucide);
}
export async function deleteHoSoGiayStatus(id) {
  const status = await refreshRecordBeforeDelete(this, "customcontractstatuses", id);
  if (!status) return;
  const confirmed = await this.view.customConfirm(
    "Xác nhận xóa trạng thái",
    `Bạn có chắc chắn muốn xóa trạng thái hợp đồng "${status.name}"? Trạng thái đang được hợp đồng sử dụng sẽ không thể xóa.`,
    "trash-2"
  );
  if (!confirmed) return;
  this.model.state.customcontractstatuses = this.model.state.customcontractstatuses.filter((s) => s.id !== id);
  this.model.markDeleted?.("customcontractstatuses", [status]);
  const editingId = document.getElementById("form-hosogiay-id").value;
  if (editingId === id) {
    document.getElementById("form-manager-hosogiay").reset();
    document.getElementById("form-hosogiay-id").value = "";
    document.getElementById("btn-save-hosogiay").innerHTML = trustedHTML('<i data-lucide="plus"></i> Thêm trạng thái');
  }
  const syncResult = await persistAndSync(this, "customcontractstatuses", {
    changes: { deletions: { customcontractstatuses: [status] } },
    afterPersist: () => this.view.renderManagerHoSoGiayPanel()
  });
  if (!syncResult?.ok) {
    await this.view.customAlert(
      "Không thể xóa",
      "Máy chủ chưa xác nhận yêu cầu xóa. Dữ liệu mới nhất sẽ được tải lại; vui lòng thử lại.",
      "alert-triangle"
    );
    return;
  }
}
export async function editSystemPackage(pkgId) {
  const pkg = this.model.state.systempackages.find((p) => p.id === pkgId);
  if (!pkg) return;
  if (!document.getElementById("modal-edit-package")) {
    await this.ensureLazyModal?.("modal-edit-package");
  }
  document.getElementById("edit-pkg-id").value = pkg.id;
  document.getElementById("edit-pkg-name").value = pkg.name;
  document.getElementById("edit-pkg-price").value = this.model.formatVND(pkg.price);
  document.getElementById("edit-pkg-quota").value = pkg.quota;
  document.getElementById("edit-pkg-desc").value = pkg.description || "";
  this.view.openModal("modal-edit-package");
}
export async function toggleOrgLock(organizationId) {
  const organization = this.model.state.organizations.find((item) => String(item.id) === String(organizationId));
  if (!organization) return;
  const isActive = organization.status === "Hoạt động";
  const action = isActive ? "lock" : "unlock";
  const confirmed = await this.view.customConfirm(
    "Xác nhận thay đổi",
    `Bạn có chắc chắn muốn ${isActive ? "khóa" : "mở khóa"} tổ chức "${organization.name}"?`,
    isActive ? "lock" : "unlock"
  );
  if (!confirmed) return;
  try {
    await updateOrganizationSubscription(organizationId, action);
    this.view.renderSuperAdminPanel();
    await this.view.customAlert("Thành công", `Đã ${isActive ? "khóa" : "mở khóa"} tổ chức.`, "check-circle");
  } catch (error) {
    await this.view.customAlert("Thất bại", error.message, "alert-triangle");
  }
}
export async function renewOrgSubscription(organizationId) {
  const organization = this.model.state.organizations.find((item) => String(item.id) === String(organizationId));
  if (!organization) return;
  const confirmed = await this.view.customConfirm(
    "Xác nhận gia hạn",
    `Gia hạn gói dịch vụ của tổ chức "${organization.name}" theo chính sách tương thích hiện hành?`,
    "calendar-plus"
  );
  if (!confirmed) return;
  try {
    await updateOrganizationSubscription(organizationId, "renew");
    this.view.renderSuperAdminPanel();
    await this.view.customAlert("Thành công", "Đã gia hạn gói dịch vụ theo chính sách tương thích hiện hành.", "check-circle");
  } catch (error) {
    await this.view.customAlert("Thất bại", error.message, "alert-triangle");
  }
}
export async function togglePackageLock(pkgId) {
  const pkg = this.model.state.systempackages.find((p) => p.id === pkgId);
  if (!pkg) return;
  const isCurrentlyLocked = Boolean(pkg.isLocked);
  const actionText = isCurrentlyLocked ? "kích hoạt lại" : "tạm khóa";
  const confirmed = await this.view.customConfirm(
    "Xác nhận thay đổi",
    `Bạn có chắc chắn muốn ${actionText} gói dịch vụ "${pkg.name}"?`,
    isCurrentlyLocked ? "unlock" : "lock"
  );
  if (confirmed) {
    try {
      const response = await apiFetch("/api/system-packages/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pkg.id,
          name: pkg.name,
          price: pkg.price,
          quota: pkg.quota,
          description: pkg.description || "",
          status: isCurrentlyLocked ? "active" : "inactive"
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể cập nhật trạng thái gói.");
      pkg.status = isCurrentlyLocked ? "active" : "inactive";
      pkg.isLocked = !isCurrentlyLocked;
      this.view.renderSuperAdminPanel();
      await this.view.customAlert("Thành công", `Đã ${actionText} gói dịch vụ thành công!`, "check-circle");
    } catch (error) {
      await this.view.customAlert("Thất bại", error.message, "alert-triangle");
    }
  }
}
export { renderWorkspaceSwitcher } from "../auth/WorkspaceSwitcherController.js";
import { generateRecordId } from "../shared/idUtils.js";
