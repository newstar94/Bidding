import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";
import { getAppController } from "../app/controllerRef.js";
import { escapeHtml as escapeHTML, formatDateOnly, safeAttr, safeImageSrc } from "../shared/view_helpers.js";
import { registerCommandArgs } from "../shared/commandArgs.js";
import { normalizeOrganizations, organizationDisplayName, organizationEmployeeLabel, organizationEmployeeProfile } from "../auth/accessContext.js";
import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
import {
  paginateOwnedTable,
  paginateTableRows,
  renderTablePagination,
  setTablePage,
} from "../shared/TablePagination.js";

const ROLE_UI_CONTEXT = Object.freeze({
  super_admin: Object.freeze({
    label: "Super Admin",
    dashboardLabel: "Tổng quan nền tảng",
    primarySection: "Quản trị hệ thống"
  }),
  manager: Object.freeze({
    label: "Quản lý",
    dashboardLabel: "Tổng quan đơn vị",
    primarySection: "Nghiệp vụ đơn vị"
  }),
  employee: Object.freeze({
    label: "Chuyên viên",
    dashboardLabel: "Công việc của tôi",
    primarySection: "Công việc của tôi"
  })
});

export function getRoleUiContext(role) {
  return ROLE_UI_CONTEXT[role] || ROLE_UI_CONTEXT.employee;
}

export function updateRoleContextShell(activeRole = "employee") {
  const role = ROLE_UI_CONTEXT[activeRole] ? activeRole : "employee";
  const context = getRoleUiContext(role);
  document.body.dataset.activeRole = role;
  const dashboardLabel = document.getElementById("sidebar-dashboard-label");
  if (dashboardLabel) dashboardLabel.textContent = context.dashboardLabel;
  const primarySection = document.getElementById("sidebar-primary-section-label");
  if (primarySection) primarySection.textContent = context.primarySection;
  const dashboardButton = document.getElementById("btn-tab-dashboard");
  if (dashboardButton) {
    dashboardButton.dataset.tooltip = context.dashboardLabel;
    dashboardButton.setAttribute("aria-label", context.dashboardLabel);
  }
  renderLucideIcons(document.getElementById("sidebar"));
}

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
    updateRoleContextShell(activeRole);
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
          btn.classList.add("is-active");
          btn.setAttribute("aria-current", "true");
        } else {
          btn.classList.remove("is-active");
          btn.setAttribute("aria-current", "false");
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
  const optionsHtml = employees.map((e) => {
    return `<option value="${escapeHTML(e.id)}">${escapeHTML(organizationEmployeeLabel(e))}</option>`;
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
      const lockBtnIcon = isLocked ? "lock" : "circle-check";
      const lockBtnTitle = isLocked ? "Mở khóa gói" : "Khóa gói";
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
                        <button class="btn btn-outline"
                            data-bf-action="call" data-fn="editSystemPackage" data-arg-key="${editArgsKey}">
                            <i data-lucide="pencil" aria-hidden="true"></i>Chỉnh sửa Gói
                        </button>
                        <button class="btn ${lockBtnClass}" id="btn-lock-${safeAttr(pkg.id)}"
                            title="${lockBtnTitle}" aria-label="${lockBtnTitle}: ${escapeHTML(pkg.name)}"
                            data-bf-action="call" data-fn="togglePackageLock" data-arg-key="${lockArgsKey}">
                            <i data-lucide="${lockBtnIcon}" aria-hidden="true"></i>${lockBtnText}
                        </button>
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
    renderLucideIcons(document.getElementById("sa-pricing-grid"), lucide);
    renderLucideIcons(tbody, lucide);
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
  const formerEmployees = Array.isArray(this.model.state.formerEmployees)
    ? this.model.state.formerEmployees
    : [];
  const employeePageKey = `managerEmployees:${activeOrg || "all"}`;
  const matrixPageKey = `managerMatrix:${activeOrg || "all"}`;
  const employeePage = paginateOwnedTable(this, employeePageKey, [
    ...orgEmployees.map((employee) => ({ employee, former: false })),
    ...formerEmployees.map((employee) => ({ employee, former: true })),
  ]);
  if (tbody) {
    const activeRows = employeePage.items.filter((entry) => !entry.former).map(({ employee: emp }) => {
      const viewArgsKey = registerCommandArgs([String(emp.id || "")]);
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
                    <td class="bf-s-0c5104285b">
                        <div class="action-btn-group bf-s-273ba347d4">
                            <button type="button" class="action-btn btn-view" data-bf-action="call" data-fn="viewEmployee" data-arg-key="${viewArgsKey}" title="Xem chi tiết nhân viên" aria-label="Xem chi tiết nhân viên ${safeAttr(emp.name)}"><i data-lucide="eye" aria-hidden="true"></i></button>
                            <button type="button" class="action-btn btn-edit" data-bf-action="call" data-fn="editEmployee" data-arg-key="${editArgsKey}" title="Sửa nhân viên" aria-label="Sửa nhân viên ${safeAttr(emp.name)}"><i data-lucide="edit-2" aria-hidden="true"></i></button>
                            <button type="button" class="action-btn btn-delete" data-bf-action="call" data-fn="deleteEmployee" data-arg-key="${deleteArgsKey}" title="Cho nhân viên rời tổ chức" aria-label="Cho nhân viên ${safeAttr(emp.name)} rời tổ chức"><i data-lucide="trash-2" aria-hidden="true"></i></button>
                        </div>
                    </td>
                </tr>
            `;
    }).join("");
    const formerRows = employeePage.items.filter((entry) => entry.former).map(({ employee: emp }) => {
      const viewArgsKey = registerCommandArgs([String(emp.id || "")]);
      const reAddArgsKey = registerCommandArgs([String(emp.id || ""), null]);
      const leftDate = emp.leftAt ? formatDateOnly(emp.leftAt) : "";
      return `<tr class="is-former-member">
        <td class="fw-bold">${escapeHTML(emp.name)}</td>
        <td>${escapeHTML(emp.email)}</td><td>${escapeHTML(emp.phone)}</td>
        <td class="employee-status-cell">
          <span class="badge badge-danger"><i data-lucide="user-minus" aria-hidden="true"></i> Đã rời</span>
          ${leftDate ? `<span class="employee-status-meta">${escapeHTML(leftDate)}</span>` : ""}
        </td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="action-btn btn-view" data-bf-action="call" data-fn="viewEmployee" data-arg-key="${viewArgsKey}" title="Xem chi tiết nhân viên" aria-label="Xem chi tiết nhân viên ${safeAttr(emp.name)}">
              <i data-lucide="eye" aria-hidden="true"></i>
            </button>
            <button type="button" class="action-btn btn-view" data-bf-action="call" data-fn="reAddEmployee" data-arg-key="${reAddArgsKey}" title="Thêm lại nhân viên" aria-label="Thêm lại nhân viên ${safeAttr(emp.name)}">
              <i data-lucide="user-plus" aria-hidden="true"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join("");
    tbody.innerHTML = trustedHTML(activeRows + formerRows || `
      <tr>
        <td colspan="5" class="text-center text-muted">Chưa có nhân viên trong danh sách.</td>
      </tr>`);
  }
  renderTablePagination(
    document.getElementById("manager-employees-pagination"),
    employeePage,
    (page) => {
      setTablePage(this, employeePageKey, page);
      this.renderManagerNhanVienPanel();
    },
  );
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
        const mode = ["", "view", "edit"].includes(matrix[moduleName]) ? matrix[moduleName] : "view";
        return `
                    <td class="matrix-checkbox-cell">
                        <select class="form-control matrix-select bf-s-c75f9a3f39" data-emp-id="${safeAttr(emp.id)}" data-module="${safeAttr(moduleName)}">
                            <option value="" ${mode === "" ? "selected" : ""}>Không truy cập</option>
                            <option value="view" ${mode === "view" ? "selected" : ""}>Chỉ xem</option>
                            <option value="edit" ${mode === "edit" ? "selected" : ""}>Thêm / Sửa có điều kiện</option>
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
  paginateTableRows(
    this,
    matrixPageKey,
    matrixTbody,
    document.getElementById("manager-matrix-pagination"),
  );
  renderLucideIcons(tbody, lucide);
  renderLucideIcons(document.getElementById("manager-employees-pagination"), lucide);
  renderLucideIcons(document.getElementById("manager-matrix-pagination"), lucide);
}

function describeEmployeeAssignment(model, assignment) {
  const type = String(assignment?.type || "");
  const targetId = String(assignment?.targetId || "");
  const collection = type === "goithau"
    ? model.state.goithau
    : type === "hopdong"
      ? model.state.hopdong
      : type === "kehoach"
        ? model.state.kehoach
        : [];
  const target = collection.find((item) => String(item.id) === targetId);
  if (!target) return null;
  const meta = type === "goithau"
    ? { prefix: "GT", code: target.maGoiThau, name: target.tenGoiThau, icon: "briefcase-business" }
    : type === "hopdong"
      ? { prefix: "HD", code: target.soHopDong, name: target.tenHopDong, icon: "file-signature" }
      : { prefix: "KH", code: target.maKeHoach, name: target.tenKeHoach, icon: "file-text" };
  return { ...meta, targetId };
}

export function renderEmployeeDetail(id) {
  const employeeId = String(id || "");
  const employee = this.model.state.employees.find((item) => String(item.id) === employeeId)
    || (this.model.state.formerEmployees || []).find((item) => String(item.id) === employeeId);
  if (!employee) return;
  const isFormer = (this.model.state.formerEmployees || []).some((item) => String(item.id) === employeeId);
  const assignments = isFormer
    ? (employee.assignmentHistory || []).map((item) => ({ ...item, historical: true }))
    : (this.model.state.assignments || []).filter((item) => String(item.empId) === employeeId);
  const assignmentItems = assignments.map((assignment) => describeEmployeeAssignment(this.model, assignment)).filter(Boolean);
  const setText = (elementId, value) => {
    const element = document.getElementById(elementId);
    if (element) element.textContent = String(value || "--");
  };
  setText("employee-detail-title", employee.name || "Thông tin nhân viên");
  setText("employee-detail-name", employee.name);
  setText("employee-detail-email", employee.email);
  setText("employee-detail-phone", employee.phone || "Chưa cập nhật số điện thoại");
  setText("employee-detail-avatar", getUserInitials(employee.name, employee.email));
  const status = document.getElementById("employee-detail-status");
  if (status) {
    status.innerHTML = trustedHTML(isFormer
      ? '<span class="badge badge-danger"><i data-lucide="user-minus" aria-hidden="true"></i> Đã rời tổ chức</span>'
      : '<span class="badge badge-success"><i data-lucide="circle-check" aria-hidden="true"></i> Đang làm việc</span>');
  }
  const count = document.getElementById("employee-detail-assignment-count");
  if (count) count.textContent = String(assignmentItems.length);
  const list = document.getElementById("employee-detail-assignments");
  if (list) {
    list.innerHTML = trustedHTML(assignmentItems.length
      ? assignmentItems.map((item) => `
          <div class="employee-detail-assignment-item">
            <span class="employee-detail-assignment-icon">${item.prefix}</span>
            <span class="employee-detail-assignment-copy">
              <strong>${escapeHTML(item.code || "Chưa có mã")}</strong>
              <span>${escapeHTML(item.name || "")}</span>
            </span>
            ${item.historical ? '<span class="employee-detail-assignment-state">Lịch sử</span>' : '<span class="employee-detail-assignment-state is-active">Đang phụ trách</span>'}
          </div>`).join("")
      : '<div class="employee-detail-empty"><i data-lucide="inbox" aria-hidden="true"></i><span>Chưa có công việc được giao.</span></div>');
  }
  this.createIconsScoped?.(document.getElementById("modal-manager-employee-detail"));
}
export function renderManagerHoSoGiayPanel() {
  // The sync endpoint already scopes this collection to the active organization.
  const orgStatuses = Array.isArray(this.model.state.customcontractstatuses)
    ? this.model.state.customcontractstatuses
    : [];
  const statusPageKey = `managerContractStatuses:${getActiveOrganizationId() || "all"}`;
  const statusPage = paginateOwnedTable(this, statusPageKey, orgStatuses);
  const tbody = document.getElementById("manager-hosogiay-tbody");
  if (tbody) {
    if (orgStatuses.length === 0) {
      tbody.innerHTML = trustedHTML(`<tr><td colspan="3" class="text-center text-muted">Chưa cấu hình trạng thái hợp đồng nào.</td></tr>`);
    } else {
      tbody.innerHTML = trustedHTML(statusPage.items.map((status) => {
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
  renderTablePagination(
    document.getElementById("manager-hosogiay-pagination"),
    statusPage,
    (page) => {
      setTablePage(this, statusPageKey, page);
      this.renderManagerHoSoGiayPanel();
    },
  );
  renderLucideIcons(tbody, lucide);
  renderLucideIcons(document.getElementById("manager-hosogiay-pagination"), lucide);
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
  const users = Array.isArray(usersList) ? usersList : [];
  const usersPage = paginateOwnedTable(this, "systemUsers", users);
  if (!usersList || usersList.length === 0) {
    tbody.innerHTML = trustedHTML(`<tr><td colspan="7" class="text-center text-muted">Không có người dùng nào.</td></tr>`);
    renderTablePagination(document.getElementById("sa-users-pagination"), usersPage);
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
  tbody.innerHTML = trustedHTML(usersPage.items.map((user) => {
    const subscription = normalizeOrganizations(user).find((organization) => organization.status === "active")?.subscription
      || normalizeOrganizations(user)[0]?.subscription
      || {};
    const isSelf = user.username === currentUsername;
    const detailArgsKey = registerCommandArgs([String(user.id || "")]);
    const deleteArgsKey = registerCommandArgs([String(user.id || ""), String(user.username || "")]);
    const deleteBtn = isSelf ? `<span class="text-muted bf-s-09c7718479">(Tài khoản hiện tại)</span>` : `<button class="action-btn btn-delete" data-bf-action="call" data-fn="deleteSystemUser" data-arg-key="${deleteArgsKey}" title="Ngừng hoạt động tài khoản"><i data-lucide="user-x"></i></button>`;
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
  renderTablePagination(
    document.getElementById("sa-users-pagination"),
    usersPage,
    (page) => {
      setTablePage(this, "systemUsers", page);
      this.renderSystemUsersTable(users, currentUsername);
    },
  );
  renderLucideIcons(tbody, lucide);
  renderLucideIcons(document.getElementById("sa-users-pagination"), lucide);
}
