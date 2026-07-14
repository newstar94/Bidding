import { getAppController } from "../app/controllerRef.js";
import { escapeHtml as escapeHTML, safeAttr, safeImageSrc } from "../shared/view_helpers.js";
import { registerCommandArgs } from "../shared/commandArgs.js";
import { normalizeOrganizations, organizationDisplayName } from "../auth/accessContext.js";
import { getActiveOrganizationId, setActiveOrganizationId } from "../app/workspaceState.js";
import { apiFetch } from "../shared/apiClient.js";
export function updateActiveUserProfileDisplay() {
  const avatar = document.getElementById("header-profile-avatar");
  const h4 = document.getElementById("header-profile-name");
  const p = document.getElementById("header-profile-role");
  if (avatar && h4 && p) {
    const user = this.model.state.activeuser || { name: "Khách", title: "Khách", id: "" };
    h4.textContent = user.name;
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
    if (orgPill && orgPillName) {
      if (activeOrg) {
        orgPillName.textContent = orgs.find((organization) => organization.id === activeOrg)?.name || activeOrg;
        orgPill.style.display = "flex";
        orgPill.style.cursor = "default";
      } else {
        orgPill.style.display = "none";
      }
    }
    const appController = getAppController();
    if (typeof appController?.renderWorkspaceSwitcher === "function") {
      appController.renderWorkspaceSwitcher();
    }
    const avatarSrc = safeImageSrc(user.avatar);
    if (avatarSrc) {
      avatar.replaceChildren();
      const image = document.createElement("img");
      image.src = avatarSrc;
      image.alt = "Avatar";
      avatar.appendChild(image);
      avatar.style.background = "none";
    } else {
      avatar.textContent = user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
      if (this.model.state.activerole === "super_admin") {
        avatar.style.background = "linear-gradient(135deg, #a855f7 0%, #4f46e5 100%)";
      } else if (this.model.state.activerole === "manager") {
        avatar.style.background = "linear-gradient(135deg, #3b82f6 0%, #10b981 100%)";
      } else {
        avatar.style.background = "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)";
      }
    }
    const saSwitchSection = document.getElementById("sa-role-switch-section");
    if (saSwitchSection) {
      const effectiveRoles = Array.isArray(user.dbRoles) ? user.dbRoles : [];
      if (effectiveRoles.includes("super_admin") || effectiveRoles.includes("manager")) {
        saSwitchSection.style.display = "block";
        const superAdminBtn = document.querySelector('.dropdown-role-btn[data-switch-role="super_admin"]');
        const managerBtn = document.querySelector('.dropdown-role-btn[data-switch-role="manager"]');
        const employeeBtn = document.querySelector('.dropdown-role-btn[data-switch-role="employee"]');
        if (effectiveRoles.includes("super_admin")) {
          if (superAdminBtn) superAdminBtn.style.display = "flex";
          if (managerBtn) managerBtn.style.display = "flex";
          if (employeeBtn) employeeBtn.style.display = "flex";
        } else if (effectiveRoles.includes("manager")) {
          if (superAdminBtn) superAdminBtn.style.display = "none";
          if (managerBtn) managerBtn.style.display = "flex";
          if (employeeBtn) employeeBtn.style.display = "flex";
        }
      } else {
        saSwitchSection.style.display = "none";
      }
      document.querySelectorAll(".dropdown-role-btn").forEach((btn) => {
        const role = btn.getAttribute("data-switch-role");
        if (role === this.model.state.activerole) {
          btn.style.background = "rgba(147, 51, 234, 0.08)";
          btn.style.color = "#a855f7";
        } else {
          btn.style.background = "transparent";
          btn.style.color = "var(--text-main)";
        }
      });
    }
  }
  const saItems = document.querySelectorAll(".role-menu-superadmin");
  const managerItems = document.querySelectorAll(".role-menu-manager");
  const clientItems = document.querySelectorAll(".role-menu-client");
  saItems.forEach((item) => {
    item.style.display = this.model.state.activerole === "super_admin" ? "block" : "none";
  });
  managerItems.forEach((item) => {
    item.style.display = this.model.state.activerole === "manager" ? "block" : "none";
  });
  clientItems.forEach((item) => {
    item.style.display = this.model.state.activerole === "super_admin" ? "none" : "block";
  });
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
    gtDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optionsHtml;
  }
  if (hdDropdown) {
    hdDropdown.innerHTML = '<option value="">-- Chọn Chuyên viên phụ trách --</option>' + optionsHtml;
  }
}
export function renderSuperAdminPanel() {
  const pricingGrid = document.getElementById("sa-pricing-grid");
  if (pricingGrid && this.model.state.systempackages) {
    pricingGrid.innerHTML = this.model.state.systempackages.map((pkg) => {
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
                        <li><i data-lucide="check"></i> Đồng bộ dữ liệu SQLite động</li>
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
    }).join("");
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
        if (["owner", "manager"].includes(organization.role) || !orgMap[organization.id].contact) {
          orgMap[organization.id].contact = u.name;
        }
      });
    });
    this.model.state.organizations = Object.values(orgMap);
    this.model.state.employees = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email || "",
      phone: "",
      role: u.role,
      username: u.username,
      organizations: normalizeOrganizations(u)
    }));
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
      tbody.innerHTML = this.model.state.organizations.map((org) => {
        const pkg = this.model.state.systempackages.find((p) => p.id === org.packageId);
        const pkgLabel = pkg ? `<span class="badge ${org.packageId === "diamond" ? "badge-warning" : org.packageId === "gold" ? "badge-info" : "badge-neutral"}">${escapeHTML(pkg.name)}</span>` : "--";
        const statusBadge = org.status === "Hoạt động" ? '<span class="badge badge-success"><i data-lucide="check-circle"></i> Hoạt động</span>' : '<span class="badge badge-danger"><i data-lucide="lock"></i> Đã khóa</span>';
        const toggleArgsKey = registerCommandArgs([String(org.id || "")]);
        const renewArgsKey = registerCommandArgs([String(org.id || "")]);
        const toggleLockBtn = org.status === "Hoạt động" ? `<button class="action-btn btn-delete" data-bf-action="call" data-fn="toggleOrgLock" data-arg-key="${toggleArgsKey}" title="Khóa Đơn vị"><i data-lucide="lock"></i></button>` : `<button class="action-btn btn-edit" style="color:var(--success); background:rgba(16,185,129,0.1);" data-bf-action="call" data-fn="toggleOrgLock" data-arg-key="${toggleArgsKey}" title="Mở khóa Đơn vị"><i data-lucide="unlock"></i></button>`;
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
                                <div class="action-btn-group" style="justify-content: flex-end;">
                                    <button class="action-btn btn-view" data-bf-action="call" data-fn="renewOrgSubscription" data-arg-key="${renewArgsKey}" title="Gia hạn 1 năm"><i data-lucide="calendar-plus"></i></button>
                                    ${toggleLockBtn}
                                </div>
                            </td>
                        </tr>
                    `;
      }).join("");
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
    progressFill.style.width = `${Math.min(percent, 100)}%`;
    if (percent >= 90) {
      progressFill.style.background = "var(--danger)";
    } else if (percent >= 70) {
      progressFill.style.background = "var(--warning)";
    } else {
      progressFill.style.background = "linear-gradient(90deg, var(--primary) 0%, #1d4ed8 100%)";
    }
  }
  const pkgNameSpan = document.getElementById("manager-package-name");
  if (pkgNameSpan) pkgNameSpan.textContent = pkg ? pkg.name : "--";
  const tbody = document.getElementById("manager-employees-tbody");
  if (tbody) {
    tbody.innerHTML = orgEmployees.map((emp) => {
      const empAssignments = this.model.state.assignments.filter((a) => a.empId === emp.id);
      const assignedTasks = empAssignments.map((a) => {
        if (a.type === "goithau") {
          const gt = this.model.state.goithau.find((g) => g.id === a.targetId);
          return gt ? `<span class="badge badge-neutral" style="margin:2px;">GT: ${escapeHTML(gt.maGoiThau)}</span>` : "";
        } else if (a.type === "hopdong") {
          const hd = this.model.state.hopdong.find((h) => h.id === a.targetId);
          return hd ? `<span class="badge badge-info" style="margin:2px;">HD: ${escapeHTML(hd.soHopDong)}</span>` : "";
        }
        return "";
      }).filter(Boolean).join(" ");
      const editArgsKey = registerCommandArgs([String(emp.id || "")]);
      const deleteArgsKey = registerCommandArgs([String(emp.id || "")]);
      return `
                <tr>
                    <td class="fw-bold" style="text-align: center; vertical-align: middle;">${escapeHTML(emp.name)}</td>
                    <td style="text-align: center; vertical-align: middle;">${escapeHTML(emp.email)}</td>
                    <td style="text-align: center; vertical-align: middle;">${escapeHTML(emp.phone)}</td>
                    <td style="max-width: 250px; text-align: center; vertical-align: middle;">${assignedTasks || '<span class="text-muted">Chưa giao thầu</span>'}</td>
                    <td style="text-align: center; vertical-align: middle;">
                        <div class="action-btn-group" style="justify-content: center; display: inline-flex;">
                            <button class="action-btn btn-edit" data-bf-action="call" data-fn="editEmployee" data-arg-key="${editArgsKey}" title="Sửa"><i data-lucide="edit-2"></i></button>
                            <button class="action-btn btn-delete" data-bf-action="call" data-fn="deleteEmployee" data-arg-key="${deleteArgsKey}" title="Xóa"><i data-lucide="trash-2"></i></button>
                        </div>
                    </td>
                </tr>
            `;
    }).join("");
  }
  const matrixTbody = document.getElementById("manager-matrix-tbody");
  if (matrixTbody) {
    matrixTbody.innerHTML = orgEmployees.map((emp) => {
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
                        <select class="form-control matrix-select" data-emp-id="${safeAttr(emp.id)}" data-module="${safeAttr(moduleName)}" style="width: 100px; display: inline-block; padding: 2px 4px; height: auto; font-size: 0.82rem; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background-color: var(--bg-card); color: var(--text-main);">
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
    }).join("");
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
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Chưa cấu hình trạng thái hồ sơ giấy nào.</td></tr>`;
    } else {
      tbody.innerHTML = orgStatuses.map((status) => {
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
      }).join("");
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
      orgContainer.style.display = "block";
      orgInput.value = organizationNames;
    } else {
      orgContainer.style.display = "none";
      orgInput.value = "";
    }
  }
  const avatarPreview = document.getElementById("profile-avatar-preview");
  const avatarFallback = document.getElementById("profile-avatar-fallback");
  const avatarSrc = safeImageSrc(user.avatar);
  if (avatarSrc) {
    if (avatarPreview) {
      avatarPreview.src = avatarSrc;
      avatarPreview.style.display = "block";
    }
    if (avatarFallback) avatarFallback.style.display = "none";
  } else {
    if (avatarPreview) {
      avatarPreview.src = "";
      avatarPreview.style.display = "none";
    }
    if (avatarFallback) {
      avatarFallback.textContent = (user.name || "AD").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
      avatarFallback.style.display = "flex";
    }
  }
}
export function renderSystemUsersTable(usersList, currentUsername) {
  const tbody = document.getElementById("sa-users-tbody");
  if (!tbody) return;
  if (!usersList || usersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Không có người dùng nào.</td></tr>`;
    return;
  }
  const calculateRemainingDays = (endDateStr) => {
    if (!endDateStr) return '<span class="text-muted" style="font-size:0.8rem;">Chưa kích hoạt</span>';
    const endDate = new Date(endDateStr);
    const today = /* @__PURE__ */ new Date();
    endDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffTime = endDate - today;
    const diffDays = Math.ceil(diffTime / (1e3 * 60 * 60 * 24));
    if (diffDays < 0) {
      return `<span class="badge badge-danger" style="background-color: rgba(239,68,68,0.1); color: var(--danger); font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-circle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hết hạn (${Math.abs(diffDays)} ngày trước)</span>`;
    } else if (diffDays === 0) {
      return `<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;"><i data-lucide="alert-triangle" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Hôm nay hết hạn</span>`;
    } else if (diffDays <= 30) {
      return `<span class="badge badge-warning" style="background-color: rgba(245,158,11,0.1); color: #f59e0b; font-size: 0.8rem; font-weight: 600;">Còn ${diffDays} ngày</span>`;
    } else {
      return `<span class="badge badge-success" style="background-color: rgba(16,185,129,0.1); color: var(--success); font-size: 0.8rem; font-weight: 600;">Còn ${diffDays} ngày</span>`;
    }
  };
  const getRoleBadge = (role) => {
    const map = {
      super_admin: '<span class="badge badge-purple" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield-alert" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Super Admin</span>',
      manager: '<span class="badge badge-info" style="font-size:0.8rem; font-weight:600;"><i data-lucide="shield" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Quản lý</span>',
      employee: '<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600;"><i data-lucide="user" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:2px;"></i> Chuyên viên</span>'
    };
    return map[role] || `<span class="badge badge-neutral">${escapeHTML(role)}</span>`;
  };
  const getPackageBadge = (pkgId) => {
    const map = {
      silver: '<span class="badge badge-neutral" style="font-size:0.8rem; font-weight:600; background:rgba(148,163,184,0.1); color:#475569; border:1px solid rgba(148,163,184,0.2);">Gói Bạc (Silver)</span>',
      gold: '<span class="badge badge-warning" style="font-size:0.8rem; font-weight:600; background:rgba(245,158,11,0.1); color:#b45309; border:1px solid rgba(245,158,11,0.2);">Gói Vàng (Gold)</span>',
      diamond: '<span class="badge badge-info" style="font-size:0.8rem; font-weight:600; background:rgba(14,165,233,0.1); color:#0284c7; border:1px solid rgba(14,165,233,0.2);">Gói Kim Cương (Diamond)</span>',
      none: '<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>'
    };
    return map[pkgId] || '<span class="text-muted" style="font-size:0.8rem;">Chưa chọn gói</span>';
  };
  tbody.innerHTML = usersList.map((user) => {
    const subscription = normalizeOrganizations(user).find((organization) => organization.status === "active")?.subscription
      || normalizeOrganizations(user)[0]?.subscription
      || {};
    const isSelf = user.username === currentUsername;
    const detailArgsKey = registerCommandArgs([String(user.id || "")]);
    const deleteArgsKey = registerCommandArgs([String(user.id || ""), String(user.username || "")]);
    const deleteBtn = isSelf ? `<span class="text-muted" style="font-size:0.8rem; font-style:italic;">(Tài khoản hiện tại)</span>` : `<button class="action-btn btn-delete" data-bf-action="call" data-fn="deleteSystemUser" data-arg-key="${deleteArgsKey}" title="Xóa tài khoản"><i data-lucide="trash-2"></i></button>`;
    const detailBtn = `<button class="action-btn btn-edit" data-bf-action="call" data-fn="showSystemUserDetail" data-arg-key="${detailArgsKey}" title="Xem chi tiết & Cấu hình"><i data-lucide="user-cog"></i></button>`;
    return `
            <tr style="cursor: pointer;" data-bf-action="call" data-fn="showSystemUserDetail" data-arg-key="${detailArgsKey}">
                <td class="fw-bold" style="color: var(--text-main);">${escapeHTML(user.username)}</td>
                <td style="font-weight: 600;">${escapeHTML(user.name)}</td>
                <td>${escapeHTML(user.email) || "--"}</td>
                <td>${getRoleBadge(user.role)}</td>
                <td>${getPackageBadge(subscription.package_id)}</td>
                <td>${calculateRemainingDays(subscription.end_date)}</td>
                <td class="text-right" data-bf-stop>
                    <div class="action-btn-group" style="justify-content: flex-end;">
                        ${detailBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
  }).join("");
  lucide.createIcons();
}
