import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { getAppController } from "../app/controllerRef.js";
import { escapeHtml as escapeHTML, formatDateOnly, safeAttr, safeImageSrc } from "../shared/view_helpers.js";
import { registerCommandArgs } from "../shared/commandArgs.js";
import { businessOrganizations, normalizeOrganizations, organizationDisplayName, organizationEmployeeProfile } from "../auth/accessContext.js";
import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";

export function getUserInitials(name, username = "") {
  const source = String(name || username || "U").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || "U").toUpperCase();
}

export function getUserDisplayName(user = {}, storedUsername = "") {
  return String(
    user?.name
    || user?.username
    || storedUsername
    || user?.email
    || "Người dùng"
  ).trim() || "Người dùng";
}

export function updateActiveUserProfileDisplay() {
  const avatar = document.getElementById("header-profile-avatar");
  const h4 = document.getElementById("header-profile-name");
  const p = document.getElementById("header-profile-role");
  if (avatar && h4 && p) {
    const user = this.model.state.activeuser || { name: "Khách", title: "Khách", id: "" };
    const storedUsername = sessionStorage.getItem("bf_username") || localStorage.getItem("bf_username") || "";
    const displayName = getUserDisplayName(user, storedUsername);
    h4.textContent = displayName;
    const orgs = normalizeOrganizations(user).filter((organization) => organization.status === "active");
    let activeOrg = getActiveOrganizationId();
    if (!activeOrg || !orgs.some((organization) => organization.id === activeOrg)) {
      activeOrg = orgs[0]?.id || "";
      if (activeOrg) {
        setActiveOrganizationId(activeOrg);
      } else {
        setActiveOrganizationId("");
      }
    }
    p.textContent = `Chế độ: ${user.title}`;
    const orgPill = document.getElementById("header-active-org-pill");
    const orgPillName = document.getElementById("header-active-org-name");
    const orgPillContainer = document.getElementById("workspace-pill-container");
    const activeWorkspace = orgs.find(
      (organization) => organization.status === "active" && organization.id === activeOrg
    );
    const onlyPersonalWorkspace = orgs.length === 1 && orgs[0].scope_type === "personal";
    const showWorkspacePill = Boolean(activeWorkspace && !onlyPersonalWorkspace);
    if (orgPillContainer) {
      orgPillContainer.hidden = !showWorkspacePill;
      setRuntimeStyle(orgPillContainer, "display", showWorkspacePill ? "inline-block" : "none");
    }
    if (orgPill && orgPillName) {
      if (showWorkspacePill) {
        orgPillName.textContent = activeWorkspace.name;
        setRuntimeStyle(orgPill, "display", "flex");
        setRuntimeStyle(orgPill, "cursor", "default");
      } else {
        setRuntimeStyle(orgPill, "display", "none");
      }
    }
    const appController = getAppController();
    if (typeof appController?.renderWorkspaceSwitcher === "function") {
      appController.renderWorkspaceSwitcher();
    }
    const activeRole = this.model.state.activerole || "employee";
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.dataset.activeRole = activeRole;
    avatar.dataset.bfRole = activeRole;
    const renderAvatarFallback = () => {
      avatar.replaceChildren();
      avatar.textContent = getUserInitials(displayName, user.username || storedUsername);
      avatar.classList.remove("has-image");
      avatar.classList.add("has-initials");
    };
    const avatarSrc = safeImageSrc(user.avatar);
    if (avatarSrc) {
      avatar.replaceChildren();
      const image = document.createElement("img");
      image.src = avatarSrc;
      image.alt = "Avatar";
      image.addEventListener("error", renderAvatarFallback, { once: true });
      avatar.appendChild(image);
      avatar.classList.add("has-image");
      avatar.classList.remove("has-initials");
    } else {
      renderAvatarFallback();
    }
    const saSwitchSection = document.getElementById("sa-role-switch-section");
    if (saSwitchSection) {
      const effectiveRoles = Array.isArray(user.dbRoles) ? user.dbRoles : [];
      if (effectiveRoles.includes("super_admin") || effectiveRoles.includes("manager")) {
        setRuntimeStyle(saSwitchSection, "display", "block");
        const superAdminBtn = document.querySelector('.dropdown-role-btn[data-switch-role="super_admin"]');
        const managerBtn = document.querySelector('.dropdown-role-btn[data-switch-role="manager"]');
        const employeeBtn = document.querySelector('.dropdown-role-btn[data-switch-role="employee"]');
        if (effectiveRoles.includes("super_admin")) {
          if (superAdminBtn) setRuntimeStyle(superAdminBtn, "display", "flex");
          if (managerBtn) setRuntimeStyle(managerBtn, "display", "flex");
          if (employeeBtn) setRuntimeStyle(employeeBtn, "display", "flex");
        } else if (effectiveRoles.includes("manager")) {
          if (superAdminBtn) setRuntimeStyle(superAdminBtn, "display", "none");
          if (managerBtn) setRuntimeStyle(managerBtn, "display", "flex");
          if (employeeBtn) setRuntimeStyle(employeeBtn, "display", "flex");
        }
      } else {
        setRuntimeStyle(saSwitchSection, "display", "none");
      }
      document.querySelectorAll(".dropdown-role-btn").forEach((btn) => {
        const role = btn.getAttribute("data-switch-role");
        if (role === this.model.state.activerole) {
          setRuntimeStyle(btn, "background", "rgba(147, 51, 234, 0.08)");
          setRuntimeStyle(btn, "color", "#a855f7");
        } else {
          setRuntimeStyle(btn, "background", "transparent");
          setRuntimeStyle(btn, "color", "var(--text-main)");
        }
      });
    }
  }
  const saItems = document.querySelectorAll(".role-menu-superadmin");
  const managerItems = document.querySelectorAll(".role-menu-manager");
  const clientItems = document.querySelectorAll(".role-menu-client");
  saItems.forEach((item) => setRuntimeStyle(item, "display", this.model.state.activerole === "super_admin" ? "block" : "none"));
  managerItems.forEach((item) => setRuntimeStyle(item, "display", this.model.state.activerole === "manager" ? "block" : "none"));
  clientItems.forEach((item) => setRuntimeStyle(item, "display", this.model.state.activerole === "super_admin" ? "none" : "block"));
  this.applySecurityLockOverlay();
  this.populateNhanVienPhuTrachDropdowns();
}
export function applySecurityLockOverlay() {
  document.querySelectorAll(".security-lock-overlay").forEach((el) => el.remove());
}
export function populateNhanVienPhuTrachDropdowns() {
  const gtDropdown = document.getElementById("gt-nhanvienphutrach");
  const hdDropdown = document.getElementById("hd-nhanvienphutrach");
  let employees = Array.isArray(this.model.state.employees) ? this.model.state.employees : [];
  if (this.model.state.activerole !== "super_admin") {
    const activeOrg = getActiveOrganizationId();
    if (activeOrg) {
      employees = employees.filter((e) => {
        return normalizeOrganizations(e).some((organization) => organization.id === activeOrg);
      });
    }
  }
  const roleLabelMap = {
    super_admin: "Super Admin / Quản lý / Chuyên viên",
    manager: "Quản lý / Chuyên viên",
    employee: "Chuyên viên"
  };
  const optionsHtml = employees.map((e) => {
    const roleLabel = roleLabelMap[e.role] || e.role;
    return `<option value="${escapeHTML(e.id)}">${escapeHTML(e.name)} — ${escapeHTML(roleLabel)}${e.email ? " (" + escapeHTML(e.email) + ")" : ""}</option>`;
  }).join("");
  if (gtDropdown) {
    gtDropdown.innerHTML = trustedHTML('<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optionsHtml);
  }
  if (hdDropdown) {
    hdDropdown.innerHTML = trustedHTML('<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optionsHtml);
  }
}
export function renderSuperAdminPanel() {
  const pricingGrid = document.getElementById("sa-pricing-grid");
  if (pricingGrid && this.model.state.systempackages) {
    pricingGrid.innerHTML = trustedHTML(this.model.state.systempackages.map((pkg) => {
      const badgeLabel = pkg.id === "silver" ? "Silver" : pkg.id === "gold" ? "Bán chạy" : "Diamond";
      const badgeClass = pkg.id === "gold" ? "badge-popular" : "";
      const cardClass = pkg.id === "silver" ? "silver-card" : pkg.id === "gold" ? "gold-card popular" : "diamond-card";
      const formattedPrice = this.model.formatCurrency(pkg.price);
      const quotaText = pkg.quota >= 999 ? "Không giới hạn" : `Tối đa ${pkg.quota} Nhân sự`;
      const isLocked = pkg.isLocked || false;
      const lockBtnText = isLocked ? "Đã khóa" : "Hoạt động";
      const lockBtnClass = isLocked ? "btn-danger" : "btn-emerald";
      const editArgsKey = registerCommandArgs([String(pkg.id || "")]);
      const lockArgsKey = registerCommandArgs([String(pkg.id || "")]);
      return `
                <div class="pricing-card ${cardClass}">
                    <div class="pricing-badge ${badgeClass}">${badgeLabel}</div>
                    <h4 class="package-name">${escapeHTML(pkg.name)}</h4>
                    <div class="package-price">${escapeHTML(formattedPrice)}<span>/năm</span></div>
                    <p class="package-desc">${escapeHTML(pkg.description || "")}</p>
                    <ul class="package-features">
                        <li><i data-lucide="check"></i> Hạn mức nhân sự: <strong>${escapeHTML(quotaText)}</strong></li>
                        <li><i data-lucide="check"></i> Lập ma trận phân quyền</li>
                        <li><i data-lucide="check"></i> Đồng bộ dữ liệu PostgreSQL tự động</li>
                        <li><i data-lucide="check"></i> Nhập dữ liệu thầu từ Excel</li>
                    </ul>
                    <div class="package-action-btn-group">
                        <button class="btn btn-outline btn-full-width mb-2"
                            data-bf-action="call" data-fn="editSystemPackage" data-arg-key="${editArgsKey}">Chỉnh sửa Gói</button>
                        <button class="btn ${lockBtnClass} btn-full-width" id="btn-lock-${safeAttr(pkg.id)}"
                            data-bf-action="call" data-fn="togglePackageLock" data-arg-key="${lockArgsKey}">${lockBtnText}</button>
                    </div>
                </div>
            `;
    }).join(""));
  }
  apiFetch("/api/auth/users").then((r) => r.ok ? r.json() : []).then((users) => {
    const orgMap = {};
    users.forEach((u) => {
      const orgs = normalizeOrganizations(u)
        .filter((organization) => organization.scope_type === "organization");
      orgs.forEach((organization) => {
        if (!orgMap[organization.id]) {
          const subscription = organization.subscription || {};
          orgMap[organization.id] = {
            id: organization.id,
            name: organization.name,
            contact: "",
            phone: "",
            packageId: subscription.package_id || "none",
            regDate: subscription.start_date || "",
            expDate: subscription.end_date || "",
            quota: subscription.member_quota || 0,
            memberCount: subscription.member_count || 0,
            status: organization.status === "active" ? "Hoạt động" : "Đã khóa"
          };
        }
        if (organization.role === "manager" || !orgMap[organization.id].contact) {
          orgMap[organization.id].contact = organization.employee_name || u.name;
          orgMap[organization.id].phone = organization.employee_phone || "";
        }
      });
    });
    this.model.state.organizations = Object.values(orgMap);
    this.model.state.employees = users.map((u) => {
      const employeeProfile = organizationEmployeeProfile(u);
      return {
        id: u.id,
        name: employeeProfile.name,
        email: u.email || "",
        phone: employeeProfile.phone,
        role: u.role,
        username: u.username,
        organizations: normalizeOrganizations(u)
      };
    });
    const activeOrgs = this.model.state.organizations.filter((o) => o.status === "Hoạt động");
    const calculatedRevenue = this.model.sumVND(this.model.state.organizations
      .filter((org) => org.status === "Hoạt động")
      .map((org) => this.model.state.systempackages.find((pkg) => pkg.id === org.packageId)?.price || 0));
    const revEl = document.getElementById("sa-stat-revenue");
    if (revEl) revEl.textContent = this.model.formatCurrency(calculatedRevenue);
    const orgsEl = document.getElementById("sa-stat-orgs");
    if (orgsEl) orgsEl.textContent = `${this.model.state.organizations.length} Đơn vị`;
    const orgActiveEl = document.querySelector("#sa-stat-orgs + .stat-trend");
    if (orgActiveEl) {
      orgActiveEl.textContent = `Đang hoạt động: ${activeOrgs.length}`;
    }
    const empsEl = document.getElementById("sa-stat-employees");
    if (empsEl) empsEl.textContent = `${this.model.state.employees.length} Nhân sự`;
    const tbody = document.getElementById("sa-organizations-tbody");
    if (tbody) {
      tbody.innerHTML = trustedHTML(this.model.state.organizations.map((org) => {
        const pkg = this.model.state.systempackages.find((p) => p.id === org.packageId);
        const pkgLabel = pkg ? `<span class="badge ${org.packageId === "diamond" ? "badge-warning" : org.packageId === "gold" ? "badge-info" : "badge-neutral"}">${escapeHTML(pkg.name)}</span>` : "--";
        const statusBadge = org.status === "Hoạt động" ? '<span class="badge badge-success"><i data-lucide="check-circle"></i> Hoạt động</span>' : '<span class="badge badge-danger"><i data-lucide="lock"></i> Đã khóa</span>';
        const toggleArgsKey = registerCommandArgs([String(org.id || "")]);
        const renewArgsKey = registerCommandArgs([String(org.id || "")]);
        const toggleLockBtn = org.status === "Hoạt động" ? `<button class="action-btn btn-delete" data-bf-action="call" data-fn="toggleOrgLock" data-arg-key="${toggleArgsKey}" title="Khóa Đơn vị"><i data-lucide="lock"></i></button>` : `<button class="action-btn btn-edit bf-s-362d0a3203" data-bf-action="call" data-fn="toggleOrgLock" data-arg-key="${toggleArgsKey}" title="Mở khóa Đơn vị"><i data-lucide="unlock"></i></button>`;
        return `
                        <tr>
                            <td class="fw-bold">${escapeHTML(org.name)}</td>
                            <td><span class="fw-bold">${escapeHTML(org.contact)}</span></td>
                            <td>${escapeHTML(org.phone) || "--"}</td>
                            <td>${pkgLabel}</td>
                            <td>${escapeHTML(this.model.formatDate(org.regDate))}</td>
                            <td><small class="fw-bold">${escapeHTML(this.model.formatDate(org.expDate))}</small></td>
                            <td>${statusBadge}</td>
                            <td class="text-right">
                                <div class="action-btn-group bf-s-225682f723">
                                    <button class="action-btn btn-view" data-bf-action="call" data-fn="renewOrgSubscription" data-arg-key="${renewArgsKey}" title="Gia hạn 1 năm"><i data-lucide="calendar-plus"></i></button>
                                    ${toggleLockBtn}
                                </div>
                            </td>
                        </tr>
                    `;
      }).join(""));
    }
    lucide.createIcons();
  });
}
export function renderManagerNhanVienPanel() {
  const activeOrg = getActiveOrganizationId();
  const currentOrganizations = normalizeOrganizations(this.model.state.activeuser || {});
  const activeOrganization = currentOrganizations.find((organization) => organization.id === activeOrg);
  const subscription = activeOrganization?.subscription || {};
  const activePkgId = subscription.package_id || "silver";
  const pkg = this.model.state.systempackages.find((p) => p.id === activePkgId);
  const quotaLimit = Number(subscription.member_quota || pkg?.quota || 5);
  const orgEmployees = this.model.state.employees.filter((e) => {
    if (!activeOrg) return true;
    const membership = normalizeOrganizations(e).find((organization) => organization.id === activeOrg);
    return membership?.role === "employee";
  });
  const quotaLabel = document.getElementById("manager-quota-label");
  const memberCount = Number(subscription.member_count || orgEmployees.length);
  if (quotaLabel) quotaLabel.textContent = `${memberCount} / ${quotaLimit === 999 ? "Không giới hạn" : quotaLimit} Thành viên`;
  const progressFill = document.getElementById("manager-quota-progress-fill");
  if (progressFill) {
    const percent = quotaLimit === 999 ? 20 : memberCount / quotaLimit * 100;
    setRuntimeStyle(progressFill, "width", `${Math.min(percent, 100)}%`);
    if (percent >= 90) {
      setRuntimeStyle(progressFill, "background", "var(--danger)");
    } else if (percent >= 70) {
      setRuntimeStyle(progressFill, "background", "var(--warning)");
    } else {
      setRuntimeStyle(progressFill, "background", "linear-gradient(90deg, var(--primary) 0%, #1d4ed8 100%)");
    }
  }
  const pkgNameSpan = document.getElementById("manager-package-name");
  if (pkgNameSpan) pkgNameSpan.textContent = pkg ? pkg.name : "--";
  const tbody = document.getElementById("manager-employees-tbody");
  if (tbody) {
    const activeRows = orgEmployees.map((emp) => {
      const empAssignments = this.model.state.assignments.filter((a) => a.empId === emp.id);
      const assignedTasks = empAssignments.map((a) => {
        if (a.type === "goithau") {
          const gt = this.model.state.goithau.find((g) => g.id === a.targetId);
          return gt ? `<span class="badge badge-neutral bf-s-032fd79442">GT: ${escapeHTML(gt.maGoiThau)}</span>` : "";
        } else if (a.type === "hopdong") {
          const hd = this.model.state.hopdong.find((h) => h.id === a.targetId);
          return hd ? `<span class="badge badge-info bf-s-032fd79442">HD: ${escapeHTML(hd.soHopDong)}</span>` : "";
        }
        return "";
      }).filter(Boolean).join(" ");
      const editArgsKey = registerCommandArgs([String(emp.id || "")]);
      const deleteArgsKey = registerCommandArgs([String(emp.id || "")]);
      return `
                <tr>
                    <td class="fw-bold bf-s-0c5104285b">${escapeHTML(emp.name)}</td>
                    <td class="bf-s-0c5104285b">${escapeHTML(emp.email)}</td>
                    <td class="bf-s-0c5104285b">${escapeHTML(emp.phone)}</td>
                    <td class="employee-status-cell">
                        <span class="badge badge-success"><i data-lucide="circle-check" aria-hidden="true"></i> Đang làm việc</span>
                    </td>
                    <td class="bf-s-922aea7b47">${assignedTasks || '<span class="text-muted">Chưa giao thầu</span>'}</td>
                    <td class="bf-s-0c5104285b">
                        <div class="action-btn-group bf-s-273ba347d4">
                            <button type="button" class="action-btn btn-edit" data-bf-action="call" data-fn="editEmployee" data-arg-key="${editArgsKey}" title="Sửa nhân viên" aria-label="Sửa nhân viên ${safeAttr(emp.name)}"><i data-lucide="edit-2" aria-hidden="true"></i></button>
                            <button type="button" class="action-btn btn-delete" data-bf-action="call" data-fn="deleteEmployee" data-arg-key="${deleteArgsKey}" title="Cho nhân viên rời tổ chức" aria-label="Cho nhân viên ${safeAttr(emp.name)} rời tổ chức"><i data-lucide="trash-2" aria-hidden="true"></i></button>
                        </div>
                    </td>
                </tr>
            `;
    }).join("");
    const formerRows = (this.model.state.formerEmployees || []).map((emp) => {
      const history = (emp.assignmentHistory || []).map((assignment) => {
        const target = assignment.type === "goithau"
          ? this.model.state.goithau.find((item) => item.id === assignment.targetId)
          : this.model.state.hopdong.find((item) => item.id === assignment.targetId);
        const label = assignment.type === "goithau" ? target?.maGoiThau : target?.soHopDong;
        return label ? `<span class="badge badge-neutral">${assignment.type === "goithau" ? "GT" : "HD"}: ${escapeHTML(label)}</span>` : "";
      }).filter(Boolean).join(" ");
      const reAddArgsKey = registerCommandArgs([String(emp.id || ""), null]);
      const leftDate = emp.leftAt ? formatDateOnly(emp.leftAt) : "";
      return `<tr class="is-former-member">
        <td class="fw-bold">${escapeHTML(emp.name)}</td>
        <td>${escapeHTML(emp.email)}</td><td>${escapeHTML(emp.phone)}</td>
        <td class="employee-status-cell">
          <span class="badge badge-danger"><i data-lucide="user-minus" aria-hidden="true"></i> Đã rời</span>
          ${leftDate ? `<span class="employee-status-meta">${escapeHTML(leftDate)}</span>` : ""}
        </td>
        <td>${history || '<span class="text-muted">Không có lịch sử phân công</span>'}</td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="action-btn btn-view" data-bf-action="call" data-fn="reAddEmployee" data-arg-key="${reAddArgsKey}" title="Thêm lại nhân viên" aria-label="Thêm lại nhân viên ${safeAttr(emp.name)}">
              <i data-lucide="user-plus" aria-hidden="true"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join("");
    tbody.innerHTML = trustedHTML(activeRows + formerRows || `
      <tr>
        <td colspan="6" class="text-center text-muted">Chưa có nhân viên trong danh sách.</td>
      </tr>`);
  }
  const matrixTbody = document.getElementById("manager-matrix-tbody");
  if (matrixTbody) {
    matrixTbody.innerHTML = trustedHTML(orgEmployees.map((emp) => {
      const matrix = this.model.state.permissionmatrix.find((m) => m.empId === emp.id) || {
        kehoach: "view",
        goithau: "view",
        hopdong: "view",
        chudautu: "view",
        nhathau: "view",
        chuyengia: "view"
      };
      const getCellHtml = (moduleName) => {
        const mode = matrix[moduleName] || "view";
        return `
                    <td class="matrix-checkbox-cell">
                        <select class="form-control matrix-select bf-s-c75f9a3f39" data-emp-id="${safeAttr(emp.id)}" data-module="${safeAttr(moduleName)}">
                            <option value="view" ${mode === "view" ? "selected" : ""}>Xem</option>
                            <option value="edit" ${mode === "edit" ? "selected" : ""}>Sửa đổi</option>
                        </select>
                    </td>
                `;
      };
      return `
                <tr>
                    <td class="fw-bold">${escapeHTML(emp.name)}</td>
                    ${getCellHtml("kehoach")}
                    ${getCellHtml("goithau")}
                    ${getCellHtml("hopdong")}
                    ${getCellHtml("chudautu")}
                    ${getCellHtml("nhathau")}
                    ${getCellHtml("chuyengia")}
                </tr>
            `;
    }).join(""));
  }
  lucide.createIcons();
}
export function renderManagerHoSoGiayPanel() {
  // The sync endpoint already scopes this collection to the active organization.
  const orgStatuses = Array.isArray(this.model.state.custompaperstatuses)
    ? this.model.state.custompaperstatuses
    : [];
  const tbody = document.getElementById("manager-hosogiay-tbody");
  if (tbody) {
    if (orgStatuses.length === 0) {
      tbody.innerHTML = trustedHTML(`<tr><td colspan="3" class="text-center text-muted">Chưa cấu hình trạng thái hồ sơ giấy nào.</td></tr>`);
    } else {
      tbody.innerHTML = trustedHTML(orgStatuses.map((status) => {
        const safeName = escapeHTML(status.name);
        const safeColor = /^#[0-9a-fA-F]{6}$/.test(String(status.color || "")) ? status.color : "#64748b";
        const editArgsKey = registerCommandArgs([String(status.id || "")]);
        const deleteArgsKey = registerCommandArgs([String(status.id || "")]);
        return `
                <tr>
                    <td class="fw-bold">${safeName}</td>
                    <td><span class="status-pill" style="background-color: ${safeColor};">${safeName}</span></td>
                    <td class="text-right">
                        <div class="action-btn-group">
                            <button class="action-btn btn-edit" data-bf-action="call" data-fn="editHoSoGiayStatus" data-arg-key="${editArgsKey}" title="Sửa"><i data-lucide="edit-2"></i></button>
                            <button class="action-btn btn-delete" data-bf-action="call" data-fn="deleteHoSoGiayStatus" data-arg-key="${deleteArgsKey}" title="Xóa"><i data-lucide="trash-2"></i></button>
                        </div>
                    </td>
                </tr>
            `;
      }).join(""));
    }
  }
  lucide.createIcons();
}
export function renderProfileTab(user) {
  if (!user) return;
  const usernameInput = document.getElementById("profile-username");
  const fullnameInput = document.getElementById("profile-fullname");
  const emailInput = document.getElementById("profile-email");
  if (usernameInput) usernameInput.value = user.username || sessionStorage.getItem("bf_username") || "";
  if (fullnameInput) fullnameInput.value = user.name || "";
  if (emailInput) emailInput.value = user.email || "";
  const orgInput = document.getElementById("profile-organization");
  const orgContainer = document.getElementById("profile-org-container");
  if (orgContainer && orgInput) {
    const organizationNames = organizationDisplayName(user);
    if (organizationNames) {
      setRuntimeStyle(orgContainer, "display", "block");
      orgInput.value = organizationNames;
    } else {
      setRuntimeStyle(orgContainer, "display", "none");
      orgInput.value = "";
    }
  }
  const avatarPreview = document.getElementById("profile-avatar-preview");
  const avatarFallback = document.getElementById("profile-avatar-fallback");
  const avatarSrc = safeImageSrc(user.avatar);
  const showAvatarFallback = () => {
    if (avatarPreview) {
      avatarPreview.hidden = true;
      avatarPreview.removeAttribute("src");
    }
    if (avatarFallback) {
      const storedUsername = sessionStorage.getItem("bf_username") || "";
      const displayName = getUserDisplayName(user, storedUsername);
      avatarFallback.textContent = getUserInitials(displayName, user.username || storedUsername);
      avatarFallback.hidden = false;
    }
  };
  if (avatarSrc) {
    if (avatarPreview) {
      avatarPreview.src = avatarSrc;
      avatarPreview.hidden = false;
      avatarPreview.onerror = showAvatarFallback;
    }
    if (avatarFallback) avatarFallback.hidden = true;
  } else {
    showAvatarFallback();
  }
}
export function renderSystemUsersTable(usersList, currentUsername) {
  const tbody = document.getElementById("sa-users-tbody");
  if (!tbody) return;
  if (!usersList || usersList.length === 0) {
    tbody.innerHTML = trustedHTML(`<tr><td colspan="7" class="text-center text-muted">Không có người dùng nào.</td></tr>`);
    return;
  }
  const calculateRemainingDays = (endDateStr) => {
    if (!endDateStr) return '<span class="text-muted bf-s-51a7b72acc">Chưa kích hoạt</span>';
    const endDate = new Date(endDateStr);
    const today = /* @__PURE__ */ new Date();
    endDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffTime = endDate - today;
    const diffDays = Math.ceil(diffTime / (1e3 * 60 * 60 * 24));
    if (diffDays < 0) {
      return `<span class="badge badge-danger bf-s-bfbf914aa8"><i data-lucide="alert-circle" class="bf-s-03467ee7d0"></i> Hết hạn (${Math.abs(diffDays)} ngày trước)</span>`;
    } else if (diffDays === 0) {
      return `<span class="badge badge-warning bf-s-72cba8a381"><i data-lucide="alert-triangle" class="bf-s-03467ee7d0"></i> Hôm nay hết hạn</span>`;
    } else if (diffDays <= 30) {
      return `<span class="badge badge-warning bf-s-72cba8a381">Còn ${diffDays} ngày</span>`;
    } else {
      return `<span class="badge badge-success bf-s-fd8a67d847">Còn ${diffDays} ngày</span>`;
    }
  };
  const getRoleBadge = (role) => {
    const map = {
      super_admin: '<span class="badge badge-purple bf-s-13c364ba41"><i data-lucide="shield-alert" class="bf-s-03467ee7d0"></i> Super Admin</span>',
      manager: '<span class="badge badge-info bf-s-13c364ba41"><i data-lucide="shield" class="bf-s-03467ee7d0"></i> Quản lý</span>',
      employee: '<span class="badge badge-neutral bf-s-13c364ba41"><i data-lucide="user" class="bf-s-03467ee7d0"></i> Chuyên viên</span>'
    };
    return map[role] || `<span class="badge badge-neutral">${escapeHTML(role)}</span>`;
  };
  const getPackageBadge = (pkgId) => {
    const map = {
      silver: '<span class="badge badge-neutral bf-s-70ac53c242">Gói Bạc (Silver)</span>',
      gold: '<span class="badge badge-warning bf-s-456836f1dd">Gói Vàng (Gold)</span>',
      diamond: '<span class="badge badge-info bf-s-aa701780d4">Gói Kim Cương (Diamond)</span>',
      none: '<span class="text-muted bf-s-51a7b72acc">Chưa chọn gói</span>'
    };
    return map[pkgId] || '<span class="text-muted bf-s-51a7b72acc">Chưa chọn gói</span>';
  };
  tbody.innerHTML = trustedHTML(usersList.map((user) => {
    const subscription = normalizeOrganizations(user).find((organization) => organization.status === "active")?.subscription
      || normalizeOrganizations(user)[0]?.subscription
      || {};
    const isSelf = user.username === currentUsername;
    const detailArgsKey = registerCommandArgs([String(user.id || "")]);
    const deleteArgsKey = registerCommandArgs([String(user.id || ""), String(user.username || "")]);
    const deleteBtn = isSelf ? `<span class="text-muted bf-s-09c7718479">(Tài khoản hiện tại)</span>` : `<button class="action-btn btn-delete" data-bf-action="call" data-fn="deleteSystemUser" data-arg-key="${deleteArgsKey}" title="Xóa tài khoản"><i data-lucide="trash-2"></i></button>`;
    const detailBtn = `<button class="action-btn btn-edit" data-bf-action="call" data-fn="showSystemUserDetail" data-arg-key="${detailArgsKey}" title="Xem chi tiết & Cấu hình"><i data-lucide="user-cog"></i></button>`;
    return `
            <tr data-bf-action="call" data-fn="showSystemUserDetail" data-arg-key="${detailArgsKey}" class="bf-s-ecfbb78629">
                <td class="fw-bold bf-s-a8a12e586e">${escapeHTML(user.username)}</td>
                <td class="bf-s-018e18ec8e">${escapeHTML(user.name)}</td>
                <td>${escapeHTML(user.email) || "--"}</td>
                <td>${getRoleBadge(user.role)}</td>
                <td>${getPackageBadge(subscription.package_id)}</td>
                <td>${calculateRemainingDays(subscription.end_date)}</td>
                <td class="text-right" data-bf-stop>
                    <div class="action-btn-group bf-s-225682f723">
                        ${detailBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
  }).join(""));
  lucide.createIcons();
}
