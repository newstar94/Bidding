import { setRuntimeStyle } from "../shared/runtimeStyles.js";
﻿import { bindCurrencyElement } from "../app/domUtils.js";
import { businessOrganizations, normalizeOrganizations, organizationDisplayName, organizationEmployeeProfile } from "../auth/accessContext.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
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
  const confirmed = await this.view.customConfirm("Xác nhận xóa tài khoản", `Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản "${username}" khỏi hệ thống?`, "user-x");
  if (confirmed) {
    try {
      const res = await apiFetch(`/api/auth/users/${userId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok) {
        await this.view.customAlert("Thành công", "Đã xóa tài khoản người dùng thành công!", "check-circle");
        this.loadSystemUsers();
      } else {
        await this.view.customAlert("Thất bại", data.error || "Không thể xóa tài khoản này.", "alert-triangle");
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
    document.getElementById("detail-su-organization").value = organizationDisplayName(user);
    const activeOrgId = getActiveOrganizationId();
    const activeMembership = normalizeOrganizations(user).find((organization) => organization.id === activeOrgId);
    document.getElementById("detail-su-role").value = activeMembership?.role || "employee";
    const organizations = normalizeOrganizations(user);
    const organization = organizations.find((item) => item.id === getActiveOrganizationId()) || organizations[0];
    const subscription = organization?.subscription || {};
    document.getElementById("form-detail-system-user").dataset.organizationId = organization?.id || "";
    document.getElementById("detail-su-package").value = subscription.package_id || "none";
    const orgContainer = document.getElementById("detail-su-org-container");
    if (orgContainer) {
      setRuntimeStyle(orgContainer, "display", organization ? "block" : "none");
    }
    document.getElementById("detail-su-startdate").value = subscription.start_date ? this.model.formatForDateInput(subscription.start_date) : "";
    document.getElementById("detail-su-enddate").value = subscription.end_date ? this.model.formatForDateInput(subscription.end_date) : "";
    this.view.openModal("modal-detail-system-user");
  } catch (err) {
    await this.view.customAlert("Lỗi hệ thống", "Không thể kết nối đến máy chủ: " + err.message, "alert-triangle");
  }
}
export function setupRBACEvents() {
  this.renderWorkspaceSwitcher();
  const profileDropdown = document.getElementById("profile-dropdown-menu");
  bindAdminEvent(document, "click", "switch-active-role", (e) => {
      const btn = e.target.closest?.(".dropdown-role-btn");
      if (!btn) return;
      const val = btn.getAttribute("data-switch-role");
      const currentUser = this.model.state.activeuser;
      const userName = currentUser ? currentUser.name : "Vy Tuấn Dương";
      if (val === "super_admin") {
        this.model.switchActiveRole("super_admin", userName, "sa-1");
      } else if (val === "manager") {
        this.model.switchActiveRole("manager", userName, "mgr-1");
      } else {
        let realUserId = sessionStorage.getItem("bf_user_id") || "1";
        if (!realUserId.startsWith("user-") && !realUserId.startsWith("emp-")) {
          realUserId = "user-" + realUserId;
        }
        this.model.switchActiveRole("employee", userName, realUserId);
      }
      this.view.updateActiveUserProfileDisplay();
      document.querySelectorAll(".modal-overlay:not(#modal-custom-dialog)").forEach((m) => m.classList.remove("active"));
      if (profileDropdown) profileDropdown.classList.remove("active");
      if (val === "super_admin") {
        this.switchTab("superadmin-dashboard");
      } else {
        this.switchTab("dashboard");
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
    bindAdminEvent(formEmp, "submit", "save-manager-employee", async (e) => {
      e.preventDefault();
      if (!this.view.validateForm(formEmp)) return;
      const activeOrg = getActiveOrganizationId();
      const activeOrganization = normalizeOrganizations(this.model.state.activeuser || {})
        .find((organization) => organization.id === activeOrg);
      const quotaLimit = Number(activeOrganization?.subscription?.member_quota || 0);
      const memberCount = Number(activeOrganization?.subscription?.member_count || 0);
      const id = document.getElementById("form-employee-id").value;
      if (!id && quotaLimit > 0 && memberCount >= quotaLimit) {
        await this.triggerUpgradePrompt();
        return;
      }
      let foundUser = null;
      const employeeName = document.getElementById("emp-name").value.trim();
      const employeePhone = document.getElementById("emp-phone").value.trim();
      const emailInput = document.getElementById("emp-email").value.trim().toLowerCase();
      try {
        const res = await apiFetch(`/api/auth/users?email=${encodeURIComponent(emailInput)}`);
        if (res.ok) {
          const matchedUsers = await res.json();
          foundUser = matchedUsers.find((u) => u.email && u.email.trim().toLowerCase() === emailInput);
        }
      } catch (err) {
        console.error("Failed to load account information:", err);
      }
      if (!foundUser) {
        await this.view.customAlert("Thông báo", "Nhân sự chưa có tài khoản trên hệ thống!", "alert-triangle");
        return;
      }
      if (id) {
        const existingEmp = this.model.state.employees.find((em) => em.id === id);
        if (existingEmp && existingEmp.email.trim().toLowerCase() !== emailInput) {
          try {
            const oldUserId = id;
            await apiFetch("/api/auth/users/remove-from-org", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: oldUserId })
            });
          } catch (err) {
            console.error("Failed to remove the previous employee from the organization:", err);
          }
          const newEmpId = foundUser.id;
          this.model.state.permissionmatrix.forEach((m) => {
            if (m.empId === id) m.empId = newEmpId;
          });
          this.model.state.assignments.forEach((a) => {
            if (a.empId === id) a.empId = newEmpId;
          });
          this.model.persistData("permissionmatrix");
          this.model.persistData("assignments");
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
          await this.view.customAlert("Thất bại", errData.error || "Không thể phân công nhân sự này.", "alert-triangle");
          return;
        }
      } catch (err) {
        await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
        return;
      }
      const empIdInState = foundUser.id;
      await this.reloadEmployeesFromDatabase();
      if (!this.model.state.permissionmatrix.some((m) => m.empId === empIdInState)) {
        this.model.state.permissionmatrix.push({
          id: generateRecordId("permissionmatrix"),
          empId: empIdInState,
          kehoach: "view",
          goithau: "view",
          hopdong: "view",
          chudautu: "view",
          nhathau: "view",
          chuyengia: "view"
        });
        this.model.persistData("permissionmatrix");
      }
      this.view.closeModal("modal-manager-employee");
      this.view.renderManagerNhanVienPanel();
      await this.view.customAlert("Thành công", "Thông tin nhân viên đã được cập nhật thành công!", "check-circle");
      this.autoSync();
    });
  }
  const btnSaveMatrix = document.getElementById("btn-save-permission-matrix");
  if (btnSaveMatrix) {
    bindAdminEvent(btnSaveMatrix, "click", "save-permission-matrix", async () => {
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
          }
        }
      });
      this.model.persistData("permissionmatrix");
      await this.view.customAlert("Lưu Ma trận thầu", "Ma trận phân quyền chi tiết đã được áp dụng và đồng bộ hóa thành công!", "check-circle");
      this.autoSync();
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
        ? this.model.state.custompaperstatuses.find((status) => status.id === id)
        : null;
      const data = {
        ...(currentStatus || {}),
        organizationId,
        id: id || generateRecordId("custompaperstatuses"),
        name,
        color
      };
      if (id) {
        const idx = this.model.state.custompaperstatuses.findIndex((s) => s.id === id);
        if (idx !== -1) this.model.state.custompaperstatuses[idx] = data;
      } else {
        this.model.state.custompaperstatuses.push(data);
      }
      await this.model.persistData("custompaperstatuses");
      this.view.renderManagerHoSoGiayPanel();
      const syncResult = await this.autoSync();
      if (!syncResult?.ok) {
        await this.view.customAlert(
          "Chưa đồng bộ",
          "Thay đổi đã được lưu trên thiết bị nhưng chưa được máy chủ xác nhận. Vui lòng đồng bộ lại.",
          "alert-triangle"
        );
        return;
      }
      formHsg.reset();
      document.getElementById("form-hosogiay-id").value = "";
      document.getElementById("btn-save-hosogiay").innerHTML = '<i data-lucide="plus"></i> Thêm trạng thái';
      lucide.createIcons();
      this.view.renderManagerHoSoGiayPanel();
      await this.view.customAlert("Thành công", "Trạng thái hồ sơ giấy đã được cập nhật thành công!", "check-circle");
    });
  }
  const suPkgDropdown = document.getElementById("detail-su-package");
  if (suPkgDropdown) {
    bindAdminEvent(suPkgDropdown, "change", "toggle-system-user-org", (e) => {
      const orgContainer = document.getElementById("detail-su-org-container");
      if (orgContainer) {
        setRuntimeStyle(orgContainer, "display", e.target.value !== "none" ? "block" : "none");
      }
    });
  }
  const formSu = document.getElementById("form-detail-system-user");
  if (formSu) {
    bindAdminEvent(formSu, "submit", "save-system-user", async (e) => {
      e.preventDefault();
      if (!this.view.validateForm(formSu)) return;
      const userId = document.getElementById("detail-su-id").value;
      const role = document.getElementById("detail-su-role").value;
      const packageId = document.getElementById("detail-su-package").value;
      const organizationId = formSu.dataset.organizationId || "";
      if (!organizationId) {
        if (!packageId || packageId === "none") {
          await this.view.customAlert("Chưa chọn gói", "Hãy chọn gói dịch vụ để kích hoạt không gian làm việc cá nhân.", "alert-triangle");
          return;
        }
        try {
          const response = await apiFetch("/api/auth/users/activate-personal-package", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, package_id: packageId })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Không thể kích hoạt gói cá nhân.");
          this.view.closeModal("modal-detail-system-user");
          await this.view.customAlert("Thành công", "Đã kích hoạt gói và không gian làm việc cá nhân.", "check-circle");
          this.loadSystemUsers();
        } catch (err) {
          await this.view.customAlert("Không thể kích hoạt", err.message, "alert-triangle");
        }
        return;
      }
      try {
        const roleResponse = await apiFetch("/api/auth/users/update-role", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Active-Org": organizationId },
          body: JSON.stringify({ user_id: userId, role, scope: "organization" })
        });
        if (!roleResponse.ok) {
          const roleError = await roleResponse.json();
          throw new Error(roleError.error || "Không thể cập nhật vai trò.");
        }
        await updateOrganizationSubscription(organizationId, "set_package", { package_id: packageId });
        this.view.closeModal("modal-detail-system-user");
        await this.view.customAlert("Thành công", "Đã lưu thiết lập tài khoản thành công!", "check-circle");
        this.loadSystemUsers();
      } catch (err) {
        await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
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
export function editEmployee(id) {
  const emp = this.model.state.employees.find((e) => e.id === id);
  if (!emp) return;
  document.getElementById("modal-employee-title").textContent = "Cập nhật Nhân sự phòng thầu";
  document.getElementById("form-employee-id").value = emp.id;
  document.getElementById("emp-name").value = emp.name;
  document.getElementById("emp-email").value = emp.email;
  document.getElementById("emp-phone").value = emp.phone;
  this.view.openModal("modal-manager-employee");
}
export async function deleteEmployee(id) {
  const emp = this.model.state.employees.find((e) => e.id === id);
  if (!emp) return;
  const assignmentsCount = this.model.state.assignments.filter((a) => a.empId === id).length;
  let warningText = `Bạn có chắc chắn muốn gỡ nhân sự "${emp.name}" khỏi đơn vị? Họ sẽ không còn quyền truy cập dữ liệu của đơn vị này nữa.`;
  if (assignmentsCount > 0) {
    warningText += `

⚠️ CHÚ Ý: Nhân sự này hiện đang được phân công phụ trách ${assignmentsCount} gói thầu/hợp đồng. Nếu gỡ bỏ, các thầu này sẽ không có chuyên viên phụ trách!`;
  }
  const confirmed = await this.view.customConfirm("Xác nhận gỡ nhân sự", warningText, "trash-2");
  if (confirmed) {
    try {
      const res = await apiFetch("/api/auth/users/remove-from-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: id })
      });
      if (res.ok) {
        await this.reloadEmployeesFromDatabase();
        this.model.state.permissionmatrix = this.model.state.permissionmatrix.filter((m) => m.empId !== id);
        this.model.state.assignments = this.model.state.assignments.filter((a) => a.empId !== id);
        await this.model.persistData("permissionmatrix");
        await this.model.persistData("assignments");
        this.view.renderManagerNhanVienPanel();
        await this.autoSync();
      } else {
        const data = await res.json();
        await this.view.customAlert("Thất bại", data.error || "Không thể gỡ bỏ nhân sự này.", "alert-triangle");
      }
    } catch (err) {
      await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
    }
  }
}
export async function reloadEmployeesFromDatabase() {
  try {
    const usersRes = await apiFetch("/api/auth/users");
    if (usersRes.ok) {
      const users = await usersRes.json();
      this.model.state.employees = users.map((u) => {
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
      this.model.persistData("employees");
      this.view.populateNhanVienPhuTrachDropdowns();
    }
  } catch (err) {
    console.error("Failed to reload employees:", err);
  }
}
export function editHoSoGiayStatus(id) {
  const status = this.model.state.custompaperstatuses.find((s) => s.id === id);
  if (!status) return;
  document.getElementById("form-hosogiay-id").value = status.id;
  document.getElementById("hsg-name").value = status.name;
  document.getElementById("hsg-color").value = status.color;
  document.getElementById("btn-save-hosogiay").innerHTML = '<i data-lucide="save"></i> Cập nhật trạng thái';
  lucide.createIcons();
}
export async function deleteHoSoGiayStatus(id) {
  const status = this.model.state.custompaperstatuses.find((s) => s.id === id);
  if (!status) return;
  const confirmed = await this.view.customConfirm(
    "Xác nhận xóa trạng thái",
    `Bạn có chắc chắn muốn xóa trạng thái hồ sơ "${status.name}"?`,
    "trash-2"
  );
  if (!confirmed) return;
  this.model.state.custompaperstatuses = this.model.state.custompaperstatuses.filter((s) => s.id !== id);
  this.model.markDeleted?.("custompaperstatuses", [id]);
  await this.model.persistData("custompaperstatuses");
  const editingId = document.getElementById("form-hosogiay-id").value;
  if (editingId === id) {
    document.getElementById("form-manager-hosogiay").reset();
    document.getElementById("form-hosogiay-id").value = "";
    document.getElementById("btn-save-hosogiay").innerHTML = '<i data-lucide="plus"></i> Thêm trạng thái';
  }
  this.view.renderManagerHoSoGiayPanel();
  const syncResult = await this.autoSync();
  if (!syncResult?.ok) {
    await this.view.customAlert(
      "Chưa đồng bộ",
      "Yêu cầu xóa đã được lưu trên thiết bị nhưng chưa được máy chủ xác nhận. Vui lòng đồng bộ lại.",
      "alert-triangle"
    );
    return;
  }
  await this.view.customAlert("Thành công", "Đã xóa trạng thái hồ sơ giấy thành công!", "check-circle");
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
    `Gia hạn gói dịch vụ của tổ chức "${organization.name}" thêm 365 ngày?`,
    "calendar-plus"
  );
  if (!confirmed) return;
  try {
    await updateOrganizationSubscription(organizationId, "renew", { duration_days: 365 });
    this.view.renderSuperAdminPanel();
    await this.view.customAlert("Thành công", "Đã gia hạn gói dịch vụ thêm 365 ngày.", "check-circle");
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
export function renderWorkspaceSwitcher() {
  const orgSwitchSection = document.getElementById("org-switch-section");
  const orgSwitchList = document.getElementById("org-switch-list");
  const currentUser = this.model.state.activeuser;
  const orgs = businessOrganizations(currentUser || {}).filter((organization) => organization.status === "active");
  if (!currentUser || orgs.length === 0) {
    if (orgSwitchSection) setRuntimeStyle(orgSwitchSection, "display", "none");
    return;
  }
  if (orgs.length <= 1) {
    if (orgSwitchSection) setRuntimeStyle(orgSwitchSection, "display", "none");
    return;
  }
  if (orgSwitchSection) setRuntimeStyle(orgSwitchSection, "display", "block");
  let activeOrg = getActiveOrganizationId();
  if (!activeOrg || !orgs.some((organization) => organization.id === activeOrg)) {
    activeOrg = orgs[0].id;
    setActiveOrganizationId(activeOrg);
  }
  const htmlContent = orgs.map((org) => {
    const isActive = org.id === activeOrg;
    const initials = escapeHtml(org.name.split(" ").map((w) => w[0]).join("").substring(0, 2).toUpperCase());
    const activeBg = isActive ? "var(--primary-soft)" : "transparent";
    return `
            <button class="dropdown-item dropdown-org-btn" data-org="${escapeHtml(org.id)}" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; border: none; background: ${activeBg}; width: 100%; text-align: left; padding: 8px 16px; cursor: pointer; transition: background 0.15s ease;">
                <div class="bf-s-1ec945a6d2">
                    <div style="width: 24px; height: 24px; border-radius: 6px; background: ${isActive ? "var(--primary)" : "var(--border-color)"}; color: ${isActive ? "#ffffff" : "var(--text-muted)"}; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; transition: all 0.2s;">
                        ${initials}
                    </div>
                    <span style="font-size: 0.78rem; font-weight: ${isActive ? "700" : "500"}; color: ${isActive ? "var(--primary)" : "var(--text-main)"}; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: 1; min-width: 0;">
                        ${escapeHtml(org.name)}
                    </span>
                </div>
                ${isActive ? `<i data-lucide="check" class="bf-s-2238b82015"></i>` : ""}
            </button>
        `;
  }).join("");
  if (orgSwitchList) orgSwitchList.innerHTML = htmlContent;
  lucide.createIcons();
  const registerClick = (listEl) => {
    if (!listEl) return;
    listEl.querySelectorAll(".dropdown-org-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const selectedOrg = btn.getAttribute("data-org");
        const currentActive = getActiveOrganizationId();
        if (selectedOrg === currentActive) {
          const profileDropdown = document.getElementById("profile-dropdown-menu");
          if (profileDropdown) profileDropdown.classList.remove("active");
          return;
        }
        try {
          await this.switchWorkspaceContext(selectedOrg);
          await this.reloadEmployeesFromDatabase();
          const selectedName = orgs.find((org) => org.id === selectedOrg)?.name || selectedOrg;
          await this.view.customAlert("Chuyển đổi thành công", `Đã chuyển sang không gian làm việc của "${selectedName}"!`, "check-circle");
          const profileDropdown = document.getElementById("profile-dropdown-menu");
          if (profileDropdown) profileDropdown.classList.remove("active");
        } catch (err) {
          await this.view.customAlert("Lỗi hệ thống", "Lỗi kết nối máy chủ: " + err.message, "alert-triangle");
        }
      });
    });
  };
  registerClick(orgSwitchList);
}
import { generateRecordId } from "../shared/idUtils.js";
