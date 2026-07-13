import { escapeHtml, formatDate, formatCurrency, initCustomSelect } from "../shared/view_helpers.js";
import { loadPaginatedRecords, paginateRecords, sortRecords } from "../shared/tableDataUtils.js";
import { matchesYearMonth, populateYearMonthFilters } from "../shared/YearMonthFilter.js";
import { clearVirtualTable, renderVirtualTable } from "../shared/virtualTable.js";
import { renderVersionSelector, resolveVersionedRow } from "../shared/VersionSelector.js";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../shared/EntityTable.js";
import { renderEntityActions, standardEditDeleteActions } from "../shared/EntityActions.js";
import { executeAppCommand } from "../app/commandBus.js";
export async function renderHopDongTable() {
  const tableBody = document.getElementById("hopdong-table").querySelector("tbody");
  const searchVal = document.getElementById("search-hopdong").value.toLowerCase();
  const yearSelect = document.getElementById("filter-hopdong-nam");
  const monthSelect = document.getElementById("filter-hopdong-thang");
  const allContracts = this.model.state.hopdong || [];
  if (yearSelect && monthSelect) {
    populateYearMonthFilters({ records: allContracts, getDate: (h) => h.ngayKy, yearSelect, monthSelect });
    initCustomSelect("filter-hopdong-nam");
    initCustomSelect("filter-hopdong-thang");
  }
  const filterNam = yearSelect ? yearSelect.value : "";
  const filterThang = monthSelect ? monthSelect.value : "";
  let slicedData = [];
  let totalItems = 0;
  const currentPage = this.model.currentPage.hopdong || 1;
  const pageSize = this.model.pageSize || 10;
  const sortState = this.model.sortState.hopdong || {};
  const sortBy = sortState.field || "";
  const sortOrder = sortState.order || "asc";
  if (this.model.useServerSidePagination) {
    renderTableLoading(tableBody, 13);
    try {
      const data = await loadPaginatedRecords(this.model, "hopdong", {
        page: currentPage, pageSize, search: searchVal, sortBy, sortOrder,
        nam: filterNam, thang: filterThang
      });
      slicedData = data.items;
      totalItems = data.totalItems;
    } catch (e) {
      console.error("Failed to fetch paginated contracts", e);
      clearVirtualTable(tableBody);
      renderTableError(tableBody, { colspan: 13, message: "Không thể tải danh sách hợp đồng. Vui lòng thử lại." });
      return;
    }
  } else {
    const latestHopDong = this.model.getLatestHopDong();
    const filtered = latestHopDong.filter((h) => {
      const matchesSearch = (h.soHopDong || "").toLowerCase().includes(searchVal) || (h.tenHopDong || "").toLowerCase().includes(searchVal);
      return matchesSearch && matchesYearMonth(h.ngayKy, filterNam, filterThang);
    });
    sortRecords(filtered, sortBy, sortOrder);
    totalItems = filtered.length;
    slicedData = paginateRecords(filtered, currentPage, pageSize);
  }
  if (totalItems === 0) {
    clearVirtualTable(tableBody);
    const pag = document.getElementById("hopdong-pagination");
    renderTableEmpty(tableBody, { colspan: 13, message: "Không tìm thấy Hợp đồng nào phù hợp", icon: "file-check-2", pagination: pag });
  } else {
    renderVirtualTable(tableBody, slicedData, (h) => {
      if (!this.model.state.selectedHopDongVersion) {
        this.model.state.selectedHopDongVersion = {};
      }
      const { rootId: root, versions, displayed: displayedHd } = resolveVersionedRow(
        this.model.state.hopdong, h, this.model.state.selectedHopDongVersion
      );
      const dropdownHtml = renderVersionSelector({
        versions, selectedId: displayedHd.id, rootId: root, changeAction: "change-contract-version"
      });
      const chudautuList = Array.isArray(this.model.state.chudautu) ? this.model.state.chudautu : [];
      const cdt = chudautuList.find((c) => c.id === displayedHd.chuDauTuId);
      const cdtName = cdt ? cdt.tenChuDauTu : "--";
      const nhathauList = Array.isArray(this.model.state.nhathau) ? this.model.state.nhathau : [];
      const nt = nhathauList.find((n) => n.id === displayedHd.nhaThauId);
      const ntName = nt ? nt.tenNhaThau : "--";
      const ntNameHtml = nt?.id
        ? `<a href="#" data-bf-action="show-contractor" data-id="${escapeHtml(nt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${escapeHtml(ntName)}</a>`
        : escapeHtml(ntName);
      const goithauList = typeof this.model.getLatestPackages === "function" ? this.model.getLatestPackages() : Array.isArray(this.model.state.goithau) ? this.model.state.goithau : [];
      const linkedPkgs = (displayedHd.goiThauIds || []).map((gtId) => {
        const gt = goithauList.find((g) => g.id === gtId);
        if (!gt) return "";
        return `<a href="#" data-bf-action="show-package" data-id="${gt.id}" style="margin:2px; display:inline-block;" title="${gt.tenGoiThau || ""}"><span class="detail-code link-hover">${gt.maGoiThau || "Gói"}</span></a>`;
      }).filter(Boolean).join(" ");
      const custompaperstatuses = Array.isArray(this.model.state.custompaperstatuses) ? this.model.state.custompaperstatuses : [];
      const statusObj = custompaperstatuses.find((s) => s.name === displayedHd.trangThaiHoSo);
      const statusColor = statusObj ? statusObj.color : "#6b7280";
      const statusBadge = displayedHd.trangThaiHoSo ? `<span class="status-pill" style="background-color: ${statusColor}; color: white; padding: 4px 10px; border-radius: 20px; font-weight: 700; font-size: 0.78rem;">${displayedHd.trangThaiHoSo}</span>` : '<span class="text-muted" style="font-size:0.8rem;">Chưa cập nhật</span>';
      const contractActions = displayedHd.goiThauIds?.length ? [{
        id: displayedHd.goiThauIds[0],
        command: "export-contract",
        className: "btn-export",
        title: "Xuất hợp đồng",
        icon: "file-text",
        style: "color: var(--emerald);",
        attributes: { "contract-no": displayedHd.soHopDong }
      }] : [];
      contractActions.push(...standardEditDeleteActions({
        id: displayedHd.id,
        editCommand: "edit-contract",
        deleteCommand: "delete-contract"
      }));
      const actionHtml = renderEntityActions(contractActions, { visible: displayedHd.id === h.id });
      return `
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                            <a href="#" data-bf-action="show-contract" data-id="${displayedHd.id}" class="text-blue fw-bold link-hover" title="Xem chi tiết Hợp đồng" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code link-hover" style="margin: 0; line-height: 1;">${displayedHd.soHopDong}</span></a>
                            <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                            ${dropdownHtml}
                        </div>
                    </td>
                    <td style="min-width: 200px; max-width: 300px;" class="fw-bold text-wrap">${displayedHd.tenHopDong}</td>
                    <td>${displayedHd.ngayKy ? formatDate(displayedHd.ngayKy) : "--"}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${cdtName}</td>
                    <td style="min-width: 180px; max-width: 280px;" class="text-wrap">${ntNameHtml}</td>
                    <td class="fw-bold text-blue">${formatCurrency(displayedHd.giaTri)}</td>
                    <td><span class="badge badge-info">${displayedHd.loaiHopDong || "Trọn gói"}</span></td>
                    <td><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">${displayedHd.phanLoai || "Tư vấn"}</span></td>
                    <td>${displayedHd.soNgayThucHien ? isNaN(displayedHd.soNgayThucHien) ? displayedHd.soNgayThucHien : displayedHd.soNgayThucHien + " ngày" : "--"}</td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        ${actionHtml}
                    </td>
                </tr>
            `;
    }, { colSpan: 11, rowHeight: 86, onRender: () => lucide.createIcons({ root: tableBody }) });
    executeAppCommand("renderTablePagination", "hopdong-pagination", totalItems, currentPage, pageSize);
  }
  lucide.createIcons({ root: tableBody });
  this.enhanceTableHeaders("hopdong-table", "hopdong");
}
export function showHopDongDetails(id, isSwitchingVersion = false) {
  let targetId = id;
  if (!isSwitchingVersion) {
    const latestContract = this.model.getLatestContract(id);
    if (latestContract) {
      targetId = latestContract.id;
    }
  }
  id = targetId;
  const detailPane = document.getElementById("tab-hopdong-detail");
  if (!detailPane || !detailPane.classList.contains("active")) {
    executeAppCommand("switchTab", "hopdong-detail", id);
    return;
  }
  const hd = this.model.state.hopdong.find((h) => h.id === id);
  if (!hd) return;
  this.renderContractVersionDetails(id);
}
export function renderContractVersionDetails(versionId) {
  const hd = this.model.state.hopdong.find((h) => h.id === versionId);
  if (!hd) return;
  const editBtn = document.getElementById("btn-edit-hopdong-fullpage");
  if (editBtn) {
    const latestContract = this.model.getLatestContract(versionId);
    const isLatest = latestContract && latestContract.id === versionId;
    if (isLatest) {
      editBtn.style.display = "flex";
      editBtn.onclick = () => {
        executeAppCommand("editHopDong", versionId);
      };
    } else {
      editBtn.style.display = "none";
    }
  }
  const cdt = this.model.state.chudautu.find((c) => c.id === hd.chuDauTuId);
  const nt = this.model.state.nhathau.find((n) => n.id === hd.nhaThauId);
  const liquidationCdt = this.model.state.chudautu.find((c) => c.id === hd.chuDauTuThanhLyId);
  const liquidationNt = this.model.state.nhathau.find((n) => n.id === hd.nhaThauThanhLyId);
  const kh = this.model.getLatestPlan(hd.keHoachId);
  const goithauList = typeof this.model.getLatestPackages === "function" ? this.model.getLatestPackages() : this.model.state.goithau || [];
  const linkedPkgs = (hd.goiThauIds || []).map((gtId) => {
    return goithauList.find((g) => g.id === gtId);
  }).filter(Boolean);
  const custompaperstatuses = this.model.state.custompaperstatuses || [];
  const statusObj = custompaperstatuses.find((s) => s.name === hd.trangThaiHoSo);
  const statusColor = statusObj ? statusObj.color : "#6b7280";
  const statusBadge = hd.trangThaiHoSo ? `<span class="status-pill" style="background-color: ${statusColor}; color: white; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem;">${hd.trangThaiHoSo}</span>` : '<span class="text-muted">Chưa cập nhật</span>';
  const rootId = hd.rootId || hd.id;
  const allRelated = this.model.state.hopdong.filter((h) => (h.rootId || h.id) === rootId);
  const verMap = {};
  allRelated.forEach((h) => {
    const ver = h.phienBan || "00";
    if (!verMap[ver] || h.isLatest == 1) {
      verMap[ver] = h;
    }
  });
  const allVersions = Object.values(verMap);
  allVersions.sort((a, b) => {
    const valA = parseInt(a.phienBan || 0);
    const valB = parseInt(b.phienBan || 0);
    return valB - valA;
  });
  const selectOptionsHtml = allVersions.map((h) => {
    const ver = h.phienBan || "00";
    const label = String(parseInt(ver)).padStart(2, "0");
    return `<option value="${h.id}" ${h.id === versionId ? "selected" : ""}>${label}</option>`;
  }).join("");
  const versionSelectHtml = `
        <select id="fullpage-hd-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;">
            ${selectOptionsHtml}
        </select>
    `;
  const html = `
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box;">${hd.soHopDong || "--"}</span>
                        <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                        ${versionSelectHtml}
                    </div>
                </div>
                <h4 class="detail-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${hd.tenHopDong || "Hợp đồng không có tên"}</h4>
                <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    ${statusBadge}
                </div>
            </div>

            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Số hợp đồng</div>
                    <div class="detail-value fw-bold text-blue">${hd.soHopDong || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày ký hợp đồng</div>
                    <div class="detail-value">${hd.ngayKy ? formatDate(hd.ngayKy) : "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Ngày thanh lý hợp đồng</div>
                    <div class="detail-value">${hd.ngayThanhLy ? formatDate(hd.ngayThanhLy) : "Chưa thanh lý"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Giá trị hợp đồng</div>
                    <div class="detail-value text-blue fw-bold" style="font-size: 1.15rem;">${formatCurrency(hd.giaTri)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại hợp đồng</div>
                    <div class="detail-value"><span class="badge badge-info">${hd.loaiHopDong || "Trọn gói"}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phân loại</div>
                    <div class="detail-value"><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">${hd.phanLoai || "Tư vấn"}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian thực hiện</div>
                    <div class="detail-value">${hd.soNgayThucHien ? isNaN(hd.soNgayThucHien) ? hd.soNgayThucHien : hd.soNgayThucHien + " ngày" : "--"}</div>
                </div>
            </div>

            <div class="detail-grid" style="margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 20px;">
                <div class="detail-item">
                    <div class="detail-label">Quyết định chỉ định thầu</div>
                    <div class="detail-value">${hd.coQdChiDinh === 1 ? '<span class="badge badge-success">Có quyết định</span>' : '<span class="badge badge-secondary">Không</span>'}</div>
                </div>
                ${hd.coQdChiDinh === 1 ? `
                    <div class="detail-item">
                        <div class="detail-label">Số quyết định chỉ định</div>
                        <div class="detail-value fw-bold">${hd.soQdChiDinh || "--"}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Ngày quyết định chỉ định</div>
                        <div class="detail-value">${hd.ngayQdChiDinh ? formatDate(hd.ngayQdChiDinh) : "--"}</div>
                    </div>
                ` : ""}
            </div>

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title">Thông tin Chủ đầu tư</h5>
                ${cdt ? `
                    <div class="associated-item">
                        <div>
                            <strong style="font-size: 0.9rem;">${cdt.tenChuDauTu}</strong><br>
                            <small class="text-muted">Mã số thuế: ${cdt.maSoThue} | Địa chỉ: ${(cdt.diaChi || "").replace(/\s*\|\s*/g, ", ")}</small>
                        </div>
                        <span class="associated-badge">${cdt.maChuDauTu}</span>
                    </div>
                ` : '<div class="text-muted"><small>Không tìm thấy thông tin chủ đầu tư.</small></div>'}
            </div>

            ${hd.ngayThanhLy ? `
            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title">Thông tin đối tác tại thời điểm thanh lý</h5>
                <div class="associated-item">
                    <div><strong>Chủ đầu tư:</strong> ${liquidationCdt?.tenChuDauTu || "--"} (phiên bản ${liquidationCdt?.phienBan || "--"})</div>
                    <div><strong>Nhà thầu:</strong> ${liquidationNt?.tenNhaThau || "--"} (phiên bản ${liquidationNt?.phienBan || "--"})</div>
                </div>
            </div>` : ""}

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title">Thông tin Nhà thầu trúng thầu</h5>
                ${nt ? `
                    <div class="associated-item">
                        <div>
                            <strong style="font-size: 0.9rem;">${nt.tenNhaThau}</strong><br>
                            <small class="text-muted">Mã số thuế: ${nt.maSoThue} | Đại diện: ${nt.nguoiDaiDien || "--"}</small>
                        </div>
                        <span class="associated-badge">${nt.maNhaThau || "NHA_THAU"}</span>
                    </div>
                ` : '<div class="text-muted"><small>Không tìm thấy thông tin nhà thầu.</small></div>'}
            </div>

            ${kh ? `
                <div class="detail-sub-section" style="margin-top: 24px;">
                    <h5 class="detail-sub-title">Kế hoạch lựa chọn nhà thầu liên kết</h5>
                    <div class="associated-item" style="cursor: pointer;" data-bf-action="show-plan" data-id="${kh.id}">
                        <div>
                            <strong style="font-size: 0.9rem; color: var(--primary);">${kh.tenKeHoach}</strong><br>
                            <small class="text-muted">Mã KH: ${kh.maKeHoach} | Tổng mức: ${formatCurrency(kh.tongMucDauTu)}</small>
                        </div>
                    </div>
                </div>
            ` : ""}

            <div class="detail-sub-section" style="margin-top: 24px;">
                <h5 class="detail-sub-title" style="color: var(--primary);">Các gói thầu thuộc hợp đồng (${linkedPkgs.length})</h5>
                <div class="associated-list">
                    ${linkedPkgs.length > 0 ? linkedPkgs.map((gt) => `
                        <div class="associated-item" style="cursor: pointer;" data-bf-action="show-package" data-id="${gt.id}">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue" style="width:16px;"></i>
                                <span><strong>${gt.maGoiThau}</strong> - ${gt.tenGoiThau}</span>
                            </div>
                            <span class="badge badge-success">${formatCurrency(gt.giaGoiThau)}</span>
                        </div>
                    `).join("") : '<div class="text-muted"><small>Hợp đồng này chưa có gói thầu trực tiếp liên kết.</small></div>'}
                </div>
            </div>
        </div>
    `;
  const contentEl = document.getElementById("fullpage-hopdong-content");
  if (contentEl) {
    contentEl.innerHTML = html;
    const innerSelect = document.getElementById("fullpage-hd-version-select");
    if (innerSelect) {
      innerSelect.onchange = (e) => {
        this.renderContractVersionDetails(e.target.value);
      };
      initCustomSelect("fullpage-hd-version-select");
    }
    lucide.createIcons();
  }
}
