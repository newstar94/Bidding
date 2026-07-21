import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { escapeHtml, formatCurrency, formatDate, initCustomSelect, safeAttr } from "../shared/view_helpers.js";
import { loadPaginatedRecords, paginateRecords, sortRecords } from "../shared/tableDataUtils.js";
import { matchesYearMonth, populateYearMonthFilters } from "../shared/YearMonthFilter.js";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../shared/EntityTable.js";
import { renderEntityActions, standardEditDeleteActions } from "../shared/EntityActions.js";
import { clearVirtualTable, renderVirtualTable } from "../shared/virtualTable.js";
import { executeAppCommand } from "../app/commandBus.js";
import { formatPartnerIdentityCode } from "../app/domUtils.js";
export async function renderKeHoachTable() {
  const tableBody = document.getElementById("kehoach-table").querySelector("tbody");
  const searchVal = document.getElementById("search-kehoach").value.toLowerCase();
  const yearSelect = document.getElementById("filter-kehoach-nam");
  const monthSelect = document.getElementById("filter-kehoach-thang");
  const allPlans = this.model.state.kehoach || [];
  if (yearSelect && monthSelect) {
    populateYearMonthFilters({ records: allPlans, getDate: (kh) => kh.ngayPheDuyet, yearSelect, monthSelect });
    initCustomSelect("filter-kehoach-nam");
    initCustomSelect("filter-kehoach-thang");
  }
  const filterNam = yearSelect ? yearSelect.value : "";
  const filterThang = monthSelect ? monthSelect.value : "";
  let slicedData = [];
  let totalItems = 0;
  const currentPage = this.model.currentPage.kehoach || 1;
  const pageSize = this.model.pageSize || 10;
  const sortState = this.model.sortState.kehoach || {};
  const sortBy = sortState.field || "";
  const sortOrder = sortState.order || "asc";
  if (this.model.useServerSidePagination) {
    renderTableLoading(tableBody, 10);
    try {
      const data = await loadPaginatedRecords(this.model, "kehoach", {
        page: currentPage, pageSize, search: searchVal, sortBy, sortOrder,
        nam: filterNam, thang: filterThang
      });
      slicedData = data.items;
      totalItems = data.totalItems;
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("Failed to fetch paginated plans", e);
      clearVirtualTable(tableBody);
      renderTableError(tableBody, { colspan: 10, message: "Không thể tải danh sách kế hoạch. Vui lòng thử lại.", onRetry: () => this.renderKeHoachTable() });
      return;
    }
  } else {
    const latestPlans = this.model.getFilteredKeHoach();
    const filtered = latestPlans.filter((kh) => {
      const matchesSearch = kh.maKeHoach.toLowerCase().includes(searchVal) || kh.tenKeHoach.toLowerCase().includes(searchVal) || kh.tenDuAnDuToan && kh.tenDuAnDuToan.toLowerCase().includes(searchVal);
      return matchesSearch && matchesYearMonth(kh.ngayPheDuyet, filterNam, filterThang);
    });
    sortRecords(filtered, sortBy, sortOrder);
    totalItems = filtered.length;
    slicedData = paginateRecords(filtered, currentPage, pageSize);
  }
  if (totalItems === 0) {
    clearVirtualTable(tableBody);
    const pag = document.getElementById("kehoach-pagination");
    renderTableEmpty(tableBody, { colspan: 10, message: "Không tìm thấy Kế hoạch lựa chọn nhà thầu nào phù hợp", icon: "file-warning", pagination: pag });
  } else {
    const esc = escapeHtml;
    renderVirtualTable(tableBody, slicedData, (kh) => {
      const root = kh.rootId || kh.id;
      const allVersions = kh.allVersions || this.model.state.kehoach.filter((k) => (k.rootId || k.id) === root).sort((a, b) => parseInt(b.phienBan) - parseInt(a.phienBan));
      if (!this.model.state.selectedPlanVersion) {
        this.model.state.selectedPlanVersion = {};
      }
      const selectedId = this.model.state.selectedPlanVersion[root] || allVersions[0]?.id || kh.id;
      const displayedKh = this.model.state.kehoach.find((k) => k.id === selectedId) || kh;
      const cdt = this.model.state.chudautu.find((c) => c.id === displayedKh.chuDauTuId);
      const optionsHtml = allVersions.map((v) => {
        const label = v.phienBan || "00";
        const isSel = v.id === displayedKh.id ? "selected" : "";
        return `<option value="${esc(v.id)}" ${isSel}>${esc(label)}</option>`;
      }).join("");
      const dropdownHtml = `
                <select class="form-control version-droplist bf-s-b41ce2ea44" data-bf-change="change-plan-version" data-root="${esc(root)}">
                    ${optionsHtml}
                </select>
            `;
      const isLatest = displayedKh.id === kh.id;
      const planActions = standardEditDeleteActions({
        id: displayedKh.id,
        editCommand: "edit-plan",
        deleteCommand: "delete-plan",
        allowDelete: this.model.state.activerole !== "employee"
      });
      if (!isLatest) planActions.shift();
      const actionHtml = renderEntityActions(planActions);
      return `
                <tr>
                    <td>
                        <div class="bf-s-8c8dc52ed7">
                            <a href="#" data-bf-action="show-plan" data-id="${esc(displayedKh.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d"><span class="detail-code bf-s-dc5de304c3">${this.model.getPlanBaseCode(displayedKh.maKeHoach) ? esc(this.model.getPlanBaseCode(displayedKh.maKeHoach)) : '<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                            <span class="bf-s-db1d8f859f">-</span>
                            ${dropdownHtml}
                        </div>
                    </td>
                    <td class="fw-bold text-wrap bf-s-861d2aedee">${esc(displayedKh.tenKeHoach)}</td>
                    <td>${displayedKh.loaiHinhMuaSam ? `<span class="badge ${displayedKh.loaiHinhMuaSam === "Dự án" ? "badge-info" : "badge-warning"}">${esc(displayedKh.loaiHinhMuaSam)}</span>` : '<span class="text-muted">--</span>'}</td>
                    <td class="text-muted text-wrap bf-s-0569d2208a">${esc(displayedKh.tenDuAnDuToan || "--")}</td>
                    <td class="text-wrap bf-s-3ce088a59b">${cdt ? esc(cdt.tenChuDauTu) : '<span class="text-danger">Không rõ</span>'}</td>
                    <td class="text-blue fw-bold">${formatCurrency(displayedKh.tongMucDauTu)}</td>
                    <td>${formatDate(displayedKh.ngayPheDuyet)}</td>
                    <td>${esc(displayedKh.quyetDinhPheDuyet)}</td>
                    <td><span class="fw-bold text-muted">${displayedKh.thoiGianDangMa ? this.model.formatDateWithTime(displayedKh.thoiGianDangMa) : "--"}</span></td>
                    <td class="text-right">
                        ${actionHtml}
                    </td>
                </tr>
            `;
    }, { colSpan: 10, rowHeight: 82, onRender: () => lucide.createIcons({ root: tableBody }) });
    executeAppCommand("renderTablePagination", "kehoach-pagination", totalItems, currentPage, pageSize);
  }
  lucide.createIcons();
  this.enhanceTableHeaders("kehoach-table", "kehoach");
}
export function showKeHoachDetails(id, isSwitchingVersion = false) {
  let targetId = id;
  if (!isSwitchingVersion) {
    const latestPlan = this.model.getLatestPlan(id);
    if (latestPlan) {
      targetId = latestPlan.id;
    }
  }
  id = targetId;
  const detailPane = document.getElementById("tab-kehoach-detail");
  if (!detailPane || !detailPane.classList.contains("active")) {
    executeAppCommand("switchTab", "kehoach-detail", id);
    return;
  }
  const kh = this.model.state.kehoach.find((k) => k.id === id);
  if (!kh) return;
  this.renderPlanVersionDetails(id);
}
async function fetchPlanPackageSnapshots(planId) {
  if (!planId) return [];
  const pageSize = 200;
  let cursor = null;
  const items = [];
  do {
    const data = await loadPaginatedRecords(this.model, "goithau", {
      pagination: "cursor", cursor: cursor || "", pageSize, keHoachId: planId
    });
    const pageItems = data.items;
    items.push(...pageItems);
    cursor = data.nextCursor;
    if (!data.hasMore || pageItems.length === 0) break;
  } while (cursor);
  return items;
}
export async function renderPlanVersionDetails(versionId) {
  const kh = this.model.state.kehoach.find((k) => k.id === versionId);
  if (!kh) return;
  const editBtn = document.getElementById("btn-edit-kehoach-fullpage");
  if (editBtn) {
    const latestPlan = this.model.getLatestPlan(versionId);
    const isLatest = latestPlan && latestPlan.id === versionId;
    if (isLatest) {
      setRuntimeStyle(editBtn, "display", "flex");
      editBtn.onclick = () => {
        executeAppCommand("editKeHoach", versionId);
      };
    } else {
      setRuntimeStyle(editBtn, "display", "none");
    }
  }
  const rootId = kh.rootId || kh.id;
  const allRelated = this.model.state.kehoach.filter((k) => (k.rootId || k.id) === rootId);
  const verMap = {};
  allRelated.forEach((k) => {
    const ver = k.phienBan || "00";
    if (!verMap[ver] || k.isLatest == 1) {
      verMap[ver] = k;
    }
  });
  const allVersions = Object.values(verMap);
  allVersions.sort((a, b) => {
    const valA = parseInt(a.phienBan) || 0;
    const valB = parseInt(b.phienBan) || 0;
    return valA - valB;
  });
  const cdt = this.model.state.chudautu.find((c) => c.id === kh.chuDauTuId);
  let linkedPackages = this.model.getLatestPackagesForPlan(kh.id);
  if (this.model.useServerSidePagination && linkedPackages.length === 0) {
    await fetchPlanPackageSnapshots.call(this, kh.id);
    linkedPackages = this.model.getLatestPackagesForPlan(kh.id);
  }
  const uniqueLinkedPackages = [];
  const seenRoots = /* @__PURE__ */ new Set();
  const seenCodes = /* @__PURE__ */ new Set();
  const seenNames = /* @__PURE__ */ new Set();
  linkedPackages.forEach((gt) => {
    const root = gt.rootId;
    const code = gt.maGoiThau ? gt.maGoiThau.trim().toLowerCase() : "";
    const name = gt.tenGoiThau ? gt.tenGoiThau.trim().toLowerCase() : "";
    let isDuplicate = false;
    if (root && seenRoots.has(root)) isDuplicate = true;
    if (code && code !== "(chưa nhập)" && seenCodes.has(code)) isDuplicate = true;
    if (name && seenNames.has(name)) isDuplicate = true;
    if (!isDuplicate) {
      if (root) seenRoots.add(root);
      if (code && code !== "(chưa nhập)") seenCodes.add(code);
      if (name) seenNames.add(name);
      uniqueLinkedPackages.push(gt);
    }
  });
  const list1 = kh.cvDaThucHienList || [];
  const list2 = kh.cvKhongApDungList || [];
  const list3 = kh.cvChuaDuDieuKienList || [];
  let breakdownSection1 = "";
  if (list1.length > 0) {
    breakdownSection1 = `
            <div class="detail-sub-section bf-s-2e21a57cf0">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">I. Phần công việc đã thực hiện</h5>
                <div class="phanlo-table-wrap bf-s-d49e7f30b4">
                    <table class="phanlo-table bf-s-a2e921d929">
                        <thead>
                            <tr class="bf-s-b2b45352a8">
                                <th class="bf-s-c3fc104bea">Tên phần công việc</th>
                                <th class="bf-s-c7351276e7">Giá trị (VND)</th>
                                <th class="bf-s-369f705937">Đơn vị thực hiện</th>
                                <th class="bf-s-369f705937">Văn bản phê duyệt</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list1.map((item) => `
                                <tr class="bf-s-ddc4ced4b2">
                                    <td class="bf-s-8cebed82f0">${escapeHtml(item.tenCongViec)}</td>
                                    <td class="bf-s-c1b2008170">${formatCurrency(item.giaTri)}</td>
                                    <td class="bf-s-8e0dc07fff">${escapeHtml(item.donViThucHien || "--")}</td>
                                    <td class="bf-s-8e0dc07fff">${escapeHtml(item.vanBanPheDuyet || "--")}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
  }
  let breakdownSection2 = "";
  if (list2.length > 0) {
    breakdownSection2 = `
            <div class="detail-sub-section bf-s-93688d4ac4">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">II. Phần công việc không áp dụng được hình thức LCNT</h5>
                <div class="phanlo-table-wrap bf-s-d49e7f30b4">
                    <table class="phanlo-table bf-s-a2e921d929">
                        <thead>
                            <tr class="bf-s-b2b45352a8">
                                <th class="bf-s-c3fc104bea">Tên phần công việc</th>
                                <th class="bf-s-c7351276e7">Giá trị (VND)</th>
                                <th class="bf-s-e8c0087267">Đơn vị thực hiện</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list2.map((item) => `
                                <tr class="bf-s-ddc4ced4b2">
                                    <td class="bf-s-8cebed82f0">${escapeHtml(item.tenCongViec)}</td>
                                    <td class="bf-s-c1b2008170">${formatCurrency(item.giaTri)}</td>
                                    <td class="bf-s-8e0dc07fff">${escapeHtml(item.donViThucHien || "--")}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
  }
  let breakdownSection3 = "";
  if (list3.length > 0) {
    breakdownSection3 = `
            <div class="detail-sub-section bf-s-93688d4ac4">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">III. Phần công việc chưa đủ điều kiện lập kế hoạch LCNT</h5>
                <div class="phanlo-table-wrap bf-s-d49e7f30b4">
                    <table class="phanlo-table bf-s-a2e921d929">
                        <thead>
                            <tr class="bf-s-b2b45352a8">
                                <th class="bf-s-c3fc104bea">Tên phần công việc</th>
                                <th class="bf-s-c7351276e7">Giá trị (VND)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${list3.map((item) => `
                                <tr class="bf-s-ddc4ced4b2">
                                    <td class="bf-s-8cebed82f0">${escapeHtml(item.tenCongViec)}</td>
                                    <td class="bf-s-c1b2008170">${formatCurrency(item.giaTri)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
  }
  let pheDuyetDetailHtml = "";
  if (kh.pheDuyet === "Kế hoạch") {
    pheDuyetDetailHtml = `
            <div class="detail-item">
                <div class="detail-label">Số tờ trình dự toán</div>
                <div class="detail-value">${escapeHtml(kh.soToTrinhDuToan || "--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày trình dự toán</div>
                <div class="detail-value">${formatDate(kh.ngayTrinhDuToan) || "--"}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày phê duyệt dự toán</div>
                <div class="detail-value">${formatDate(kh.ngayPheDuyetDuToan) || "--"}</div>
            </div>
            <div class="detail-item bf-s-6d00fde401">
                <div class="detail-label">Số QĐ phê duyệt dự toán</div>
                <div class="detail-value">${escapeHtml(kh.soQdPheDuyetDuToan || "--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Số tờ trình kế hoạch</div>
                <div class="detail-value">${escapeHtml(kh.soToTrinhKeHoach || "--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày trình kế hoạch</div>
                <div class="detail-value">${formatDate(kh.ngayTrinhKeHoach) || "--"}</div>
            </div>
        `;
  } else if (kh.pheDuyet === "Dự toán và kế hoạch") {
    pheDuyetDetailHtml = `
            <div class="detail-item">
                <div class="detail-label">Số tờ trình dự toán và kế hoạch</div>
                <div class="detail-value">${escapeHtml(kh.soToTrinhDuToanKeHoach || "--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày trình dự toán và kế hoạch</div>
                <div class="detail-value">${formatDate(kh.ngayTrinhKeHoach) || "--"}</div>
            </div>
        `;
  }
  let projectDetailHtml = "";
  if (kh.loaiHinhMuaSam === "Dự án") {
    projectDetailHtml = `
            <div class="detail-item bf-s-6d00fde401">
                <div class="detail-label">Mã dự án</div>
                <div class="detail-value">${escapeHtml(kh.maDuan || "--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Số QĐ phê duyệt dự án</div>
                <div class="detail-value">${escapeHtml(kh.soQdPheDuyetDuAn || "--")}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Ngày QĐ phê duyệt dự án</div>
                <div class="detail-value">${formatDate(kh.ngayQdPheDuyetDuAn) || "--"}</div>
            </div>
            <div class="detail-item bf-s-6d00fde401">
                <div class="detail-label">Cơ quan phê duyệt dự án</div>
                <div class="detail-value">${escapeHtml(kh.coQuanPheDuyetDuAn || "--")}</div>
            </div>
        `;
  }
  const html = `
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code bf-s-4ec19854c0">${this.model.getPlanBaseCode(kh.maKeHoach) ? escapeHtml(this.model.getPlanBaseCode(kh.maKeHoach)) : '<span class="text-muted">(Chưa nhập)</span>'}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        <select id="fullpage-kh-version-select" class="page-version-select" ${allVersions.length < 2 ? "disabled" : ""}>
                            ${allVersions.map((k) => `<option value="${safeAttr(k.id)}" ${k.id === versionId ? "selected" : ""}>${escapeHtml(k.phienBan || "00")}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${escapeHtml(kh.tenKeHoach)}</h4>
            </div>

            <div class="detail-grid">
                <div class="detail-item bf-s-6d00fde401">
                    <div class="detail-label">Tên Dự án / Dự toán</div>
                    <div class="detail-value text-blue bf-s-fb9381027e">${escapeHtml(kh.tenDuAnDuToan || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Hình thức</div>
                    <div class="detail-value">${kh.loaiHinhMuaSam ? `<span class="badge ${kh.loaiHinhMuaSam === "Dự án" ? "badge-info" : "badge-warning"}">${escapeHtml(kh.loaiHinhMuaSam)}</span>` : '<span class="text-muted">Chưa xác định</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phê duyệt</div>
                    <div class="detail-value">${kh.pheDuyet ? `<span class="badge ${kh.pheDuyet === "Kế hoạch" ? "badge-info" : "badge-success"}">${escapeHtml(kh.pheDuyet)}</span>` : '<span class="text-muted">--</span>'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Đơn vị trình của chủ đầu tư</div>
                    <div class="detail-value">${escapeHtml(kh.donViTrinhCdt || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt đơn vị trình</div>
                    <div class="detail-value">${escapeHtml(kh.tenVietTatDonViTrinh || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tổng Giá Trị Kế Hoạch</div>
                    <div class="detail-value text-blue bf-s-61f44adbb8">${formatCurrency(kh.tongMucDauTu)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian đăng mã kế hoạch</div>
                    <div class="detail-value">${kh.thoiGianDangMa ? this.model.formatDateWithTime(kh.thoiGianDangMa) : "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số QĐ phê duyệt</div>
                    <div class="detail-value">${escapeHtml(kh.quyetDinhPheDuyet || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày QĐ phê duyệt</div>
                    <div class="detail-value">${formatDate(kh.ngayPheDuyet)}</div>
                </div>
                ${pheDuyetDetailHtml}
                ${projectDetailHtml}
            </div>

            <div class="detail-sub-section">
                <h5 class="detail-sub-title">Thông tin Chủ đầu tư</h5>
                ${cdt ? `
                    <div class="associated-item">
                        <div>
                            <strong class="bf-s-a91dac6c9e">${escapeHtml(cdt.tenChuDauTu)}</strong><br>
                            <small class="text-muted">Mã số thuế: ${escapeHtml(cdt.maSoThue || "--")} | Địa chỉ: ${escapeHtml((cdt.diaChi || "").replace(/\s*\|\s*/g, ", "))}</small>
                        </div>
                        <span class="associated-badge partner-identity-code">${escapeHtml(formatPartnerIdentityCode(cdt.maChuDauTu, "--"))}</span>
                    </div>
                ` : '<div class="text-muted"><small>Không tìm thấy thông tin chủ đầu tư.</small></div>'}
            </div>

            ${breakdownSection1}
            ${breakdownSection2}
            ${breakdownSection3}

            <div class="detail-sub-section bf-s-93688d4ac4">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">IV. Phần công việc thuộc kế hoạch lựa chọn nhà thầu (Các gói thầu - ${uniqueLinkedPackages.length})</h5>
                <div class="associated-list">
                    ${uniqueLinkedPackages.length > 0 ? uniqueLinkedPackages.map((gt) => `
                        <div class="associated-item bf-s-ecfbb78629" data-bf-action="show-package" data-id="${safeAttr(gt.id)}" title="Xem chi tiết Gói thầu">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue bf-s-0f88141c20"></i>
                                <span><strong>${escapeHtml(gt.maGoiThau || "--")}</strong> - ${escapeHtml(gt.tenGoiThau || "--")}${gt.isRebid ? ' <span class="badge badge-warning">Đấu thầu lại</span>' : ""}</span>
                            </div>
                            <span class="badge badge-success">${formatCurrency(gt.giaGoiThau)}</span>
                        </div>
                    `).join("") : '<div class="text-muted"><small>Phiên bản kế hoạch này hiện chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;
  document.getElementById("fullpage-kehoach-content").innerHTML = trustedHTML(html);
  const innerSelect = document.getElementById("fullpage-kh-version-select");
  if (innerSelect) {
    innerSelect.onchange = (e) => {
      this.renderPlanVersionDetails(e.target.value);
    };
    initCustomSelect("fullpage-kh-version-select");
  }
  lucide.createIcons();
}
