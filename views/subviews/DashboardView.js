import { escapeHtml, safeAttr, renderEmptyRow } from "./view_helpers.js";
const PACKAGE_STATUS_COLORS = {
  "Chuẩn bị": "var(--text-light)",
  "Đang mời thầu": "var(--primary)",
  "Đã mở thầu": "#f59e0b",
  "Đang chấm thầu": "#9333ea",
  "Đã có kết quả": "var(--success)",
  "Hủy thầu": "var(--danger)"
};
export function normalizeDashboardStatusCounts(incoming = {}) {
  const counts = Object.fromEntries(
    Object.keys(PACKAGE_STATUS_COLORS).map((status) => [status, 0])
  );
  Object.entries(incoming || {}).forEach(([rawStatus, rawCount]) => {
    const status = rawStatus === "Huỷ thầu" ? "Hủy thầu" : rawStatus;
    counts[status] = Number(rawCount || 0);
  });
  return counts;
}
export function renderDashboard() {
  const serverSummary = this.model.useServerSidePagination ? this.model.dashboardSummary : null;
  if (serverSummary && serverSummary.counts) {
    const counts = serverSummary.counts || {};
    const statusCounts2 = normalizeDashboardStatusCounts(serverSummary.statusCounts);
    const recentPackages = Array.isArray(serverSummary.recentPackages) ? serverSummary.recentPackages : [];
    document.getElementById("stat-count-kehoach").textContent = counts.kehoach || 0;
    document.getElementById("stat-count-goithau").textContent = counts.goithau || 0;
    document.getElementById("stat-count-chudautu").textContent = counts.chudautu || 0;
    document.getElementById("stat-count-nhathau").textContent = counts.nhathau || 0;
    document.getElementById("stat-count-chuyengia").textContent = counts.chuyengia || 0;
    const statCountHopDong2 = document.getElementById("stat-count-hopdong");
    if (statCountHopDong2) statCountHopDong2.textContent = counts.hopdong || 0;
    document.getElementById("stat-active-goithau").textContent = `${counts.activeGoithau || 0} gói đang mời thầu`;
    document.getElementById("stat-total-budget").textContent = this.model.formatCurrency(serverSummary.totalContractValue || 0);
    document.getElementById("stat-savings-value").textContent = `${counts.hopdong || 0} Hợp đồng`;
    document.getElementById("stat-savings-percent").textContent = "Đang thực hiện";
    document.getElementById("donut-total-count").textContent = counts.goithau || 0;
    const total2 = counts.goithau || 1;
    const fallbackPalette = Object.values(PACKAGE_STATUS_COLORS);
    let accum2 = 0;
    const gradientParts2 = [];
    let legendHTML2 = "";
    Object.entries(statusCounts2).forEach(([status, count], index) => {
      const pct = Number(count || 0) / total2 * 100;
      const color = PACKAGE_STATUS_COLORS[status] || fallbackPalette[index % fallbackPalette.length];
      if (count > 0) {
        gradientParts2.push(`${color} ${accum2}% ${accum2 + pct}%`);
        accum2 += pct;
      }
      legendHTML2 += `
                <div class="legend-item">
                    <div class="legend-info">
                        <span class="legend-dot" style="background-color: ${color}"></span>
                    <span>${escapeHtml(status)}</span>
                    </div>
                    <span class="legend-val">${count} (${pct.toFixed(0)}%)</span>
                </div>
            `;
    });
    const donutElement2 = document.querySelector(".status-donut-chart");
    if (donutElement2) {
      donutElement2.style.background = gradientParts2.length > 0 ? `conic-gradient(${gradientParts2.join(", ")})` : "var(--neutral-soft)";
    }
    document.getElementById("status-legend-list").innerHTML = legendHTML2;
    const recentTableBody2 = document.getElementById("recent-packages-table").querySelector("tbody");
    if (recentPackages.length === 0) {
      recentTableBody2.innerHTML = renderEmptyRow(5, "Chưa có gói thầu nào", "inbox");
    } else {
      recentTableBody2.innerHTML = recentPackages.map((gt) => `
                <tr>
                    <td><a href="#" data-bf-action="show-package" data-id="${safeAttr(gt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu"><span class="detail-code">${escapeHtml(gt.maGoiThau || "")}</span></a></td>
                    <td><a href="#" data-bf-action="show-package" data-id="${safeAttr(gt.id)}" class="view-package-link">${escapeHtml(gt.tenGoiThau || "")}</a></td>
                    <td>${this.model.formatCurrency(gt.giaGoiThau)}</td>
                    <td>${escapeHtml(gt.hinhThucLuaChon || "")}</td>
                    <td>${this.getStatusBadge(gt.trangThai)}</td>
                </tr>
            `).join("");
    }
    this.createIconsScoped(document.getElementById("tab-dashboard"));
    return;
  }
  const listSignature = (items, fields) => (items || []).map((item) => fields.map((field) => item[field] ?? "").join(":")).join("|");
  const dashboardSignature = [
    localStorage.getItem("bf_last_sync_version") || "",
    listSignature(this.model.state.goithau, ["id", "updatedAt", "syncVersion", "trangThai", "giaGoiThau"]),
    listSignature(this.model.state.hopdong, ["id", "updatedAt", "syncVersion", "giaTri"])
  ].join("|");
  let latestPackages;
  let filteredContracts;
  let totalContractValue;
  let activePackages;
  let statusCounts;
  const cachedAggregate = this._dashboardAggregateCache;
  if (cachedAggregate && cachedAggregate.signature === dashboardSignature) {
    ({ latestPackages, filteredContracts, totalContractValue, activePackages, statusCounts } = cachedAggregate);
  } else {
    latestPackages = this.model.getFilteredGoiThau();
    filteredContracts = this.model.getFilteredHopDong();
    totalContractValue = 0;
    filteredContracts.forEach((hd) => {
      totalContractValue += hd.giaTri || 0;
    });
    activePackages = 0;
    latestPackages.forEach((gt) => {
      if (gt.trangThai === "Đang mời thầu") {
        activePackages++;
      }
    });
    statusCounts = normalizeDashboardStatusCounts();
    latestPackages.forEach((gt) => {
      if (statusCounts[gt.trangThai] !== void 0) {
        statusCounts[gt.trangThai]++;
      }
    });
    this._dashboardAggregateCache = { signature: dashboardSignature, latestPackages, filteredContracts, totalContractValue, activePackages, statusCounts };
  }
  document.getElementById("stat-count-kehoach").textContent = this.model.getFilteredKeHoach().length;
  document.getElementById("stat-count-goithau").textContent = latestPackages.length;
  document.getElementById("stat-count-chudautu").textContent = this.model.getLatestChuDauTu().length;
  document.getElementById("stat-count-nhathau").textContent = this.model.getLatestNhaThau().length;
  document.getElementById("stat-count-chuyengia").textContent = this.model.state.chuyengia.length;
  const statCountHopDong = document.getElementById("stat-count-hopdong");
  if (statCountHopDong) {
    statCountHopDong.textContent = filteredContracts.length;
  }
  document.getElementById("stat-active-goithau").textContent = `${activePackages} gói đang mời thầu`;
  document.getElementById("stat-total-budget").textContent = this.model.formatCurrency(totalContractValue);
  document.getElementById("stat-savings-value").textContent = `${filteredContracts.length} Hợp đồng`;
  document.getElementById("stat-savings-percent").textContent = `Đang thực hiện`;
  const total = latestPackages.length || 1;
  document.getElementById("donut-total-count").textContent = latestPackages.length;
  let accum = 0;
  const gradientParts = [];
  let legendHTML = "";
  Object.keys(statusCounts).forEach((status) => {
    const count = statusCounts[status];
    const pct = count / total * 100;
    if (count > 0) {
      gradientParts.push(`${PACKAGE_STATUS_COLORS[status]} ${accum}% ${accum + pct}%`);
      accum += pct;
    }
    legendHTML += `
            <div class="legend-item">
                <div class="legend-info">
                    <span class="legend-dot" style="background-color: ${PACKAGE_STATUS_COLORS[status]}"></span>
                    <span>${status}</span>
                </div>
                <span class="legend-val">${count} (${pct.toFixed(0)}%)</span>
            </div>
        `;
  });
  const donutElement = document.querySelector(".status-donut-chart");
  if (donutElement) {
    if (gradientParts.length > 0) {
      donutElement.style.background = `conic-gradient(${gradientParts.join(", ")})`;
    } else {
      donutElement.style.background = "var(--neutral-soft)";
    }
  }
  document.getElementById("status-legend-list").innerHTML = legendHTML;
  const recentTableBody = document.getElementById("recent-packages-table").querySelector("tbody");
  const recentList = [...latestPackages].reverse().slice(0, 4);
  if (recentList.length === 0) {
    recentTableBody.innerHTML = renderEmptyRow(5, "Chưa có gói thầu nào", "inbox");
  } else {
    recentTableBody.innerHTML = recentList.map((gt) => `
            <tr>
                <td><a href="#" data-bf-action="show-package" data-id="${safeAttr(gt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Gói thầu"><span class="detail-code">${escapeHtml(gt.maGoiThau)}</span></a></td>
                <td><a href="#" data-bf-action="show-package" data-id="${safeAttr(gt.id)}" class="view-package-link">${escapeHtml(gt.tenGoiThau)}</a></td>
                <td>${this.model.formatCurrency(gt.giaGoiThau)}</td>
                <td>${escapeHtml(gt.hinhThucLuaChon)}</td>
                <td>${this.getStatusBadge(gt.trangThai)}</td>
            </tr>
        `).join("");
  }
  this.createIconsScoped(document.getElementById("tab-dashboard"));
}
export function renderSuperAdminDashboard() {
  fetch("/api/auth/users").then((r) => r.ok ? r.json() : []).then((users) => {
    const allOrgs = [];
    users.forEach((u) => {
      if (u.organization_name) {
        u.organization_name.split(",").map((o) => o.trim()).filter(Boolean).forEach((org) => {
          allOrgs.push(org);
        });
      }
    });
    const orgCount = new Set(allOrgs).size;
    const saStatOrgs = document.getElementById("sad-stat-orgs");
    if (saStatOrgs) saStatOrgs.textContent = `${orgCount} Đơn vị`;
    const saStatUsers = document.getElementById("sad-stat-users");
    if (saStatUsers) saStatUsers.textContent = `${users.length} Người dùng`;
    const activeOrgs = [];
    users.forEach((u) => {
      if (u.package_id && u.package_id !== "none" && u.organization_name) {
        u.organization_name.split(",").map((o) => o.trim()).filter(Boolean).forEach((org) => {
          activeOrgs.push(org);
        });
      }
    });
    const activeOrgsCount = new Set(activeOrgs).size;
    const saStatActiveOrgs = document.getElementById("sad-stat-active-orgs");
    if (saStatActiveOrgs) saStatActiveOrgs.textContent = `Đang hoạt động: ${activeOrgsCount}`;
    const orgListContainer = document.getElementById("sa-org-list-tbody");
    if (orgListContainer) {
      const orgMap = {};
      users.forEach((u) => {
        const orgs = u.organization_name ? u.organization_name.split(",").map((o) => o.trim()).filter(Boolean) : [];
        orgs.forEach((orgName) => {
          if (!orgMap[orgName]) {
            orgMap[orgName] = {
              name: orgName,
              manager: "",
              email: "",
              package_id: "none",
              start: "",
              end: "",
              userCount: 0
            };
          }
          orgMap[orgName].userCount++;
          if (u.role === "manager" || !orgMap[orgName].manager) {
            orgMap[orgName].manager = u.name;
            orgMap[orgName].email = u.email;
            orgMap[orgName].package_id = u.package_id || "none";
            orgMap[orgName].start = u.package_start_date ? this.model.formatDate(u.package_start_date) : "";
            orgMap[orgName].end = u.package_end_date ? this.model.formatDate(u.package_end_date) : "";
          }
        });
      });
      const list = Object.values(orgMap);
      if (list.length === 0) {
        orgListContainer.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Chưa có tổ chức nào đăng ký thầu</td></tr>`;
      } else {
        orgListContainer.innerHTML = list.map((org) => {
          const pkgName = org.package_id === "diamond" ? "Gói Kim Cương" : org.package_id === "gold" ? "Gói Vàng" : org.package_id === "silver" ? "Gói Bạc" : "Chưa đăng ký";
          const pkgClass = org.package_id === "diamond" ? "badge-primary" : org.package_id === "gold" ? "badge-warning" : org.package_id === "silver" ? "badge-success" : "badge-neutral";
          return `
                            <tr>
                                <td style="font-weight:700; color:var(--text-main);">${org.name}</td>
                                <td>${org.manager || '<span class="text-muted">Chưa cấu hình</span>'}</td>
                                <td>${org.email || '<span class="text-muted">Chưa có</span>'}</td>
                                <td><span class="badge ${pkgClass}">${pkgName}</span></td>
                                <td style="font-weight:600;">${org.end || '<span class="text-muted">Vô thời hạn</span>'}</td>
                                <td style="font-weight:700; text-align:center;">${org.userCount}</td>
                                <td class="text-right">
                                    <div class="actions-group">
                                        <button class="btn btn-icon btn-neutral" data-bf-action="switch-tab" data-tab="superadmin" title="Quản lý chi tiết"><i data-lucide="edit"></i></button>
                                    </div>
                                </td>
                            </tr>
                        `;
        }).join("");
      }
    }
    this.createIconsScoped(document.getElementById("tab-superadmin-dashboard"));
  });
}
