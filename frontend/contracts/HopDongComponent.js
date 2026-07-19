import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { escapeHtml, formatDate, formatCurrency, initCustomSelect, safeAttr } from "../shared/view_helpers.js";
import { loadPaginatedRecords, paginateRecords, sortRecords } from "../shared/tableDataUtils.js";
import { matchesYearMonth, populateYearMonthFilters } from "../shared/YearMonthFilter.js";
import { clearVirtualTable, renderVirtualTable } from "../shared/virtualTable.js";
import { renderVersionSelector, resolveVersionedRow } from "../shared/VersionSelector.js";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../shared/EntityTable.js";
import { renderEntityActions, standardEditDeleteActions } from "../shared/EntityActions.js";
import { executeAppCommand } from "../app/commandBus.js";
import { renderNeutralStatusBadge } from "../shared/statusBadges.js";
import { formatPartnerIdentityCode } from "../app/domUtils.js";
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
    renderTableLoading(tableBody, 12);
    try {
      const data = await loadPaginatedRecords(this.model, "hopdong", {
        page: currentPage, pageSize, search: searchVal, sortBy, sortOrder,
        nam: filterNam, thang: filterThang
      });
      slicedData = data.items;
      totalItems = data.totalItems;
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("Failed to fetch paginated contracts", e);
      clearVirtualTable(tableBody);
      renderTableError(tableBody, { colspan: 12, message: "Không thể tải danh sách hợp đồng. Vui lòng thử lại.", onRetry: () => this.renderHopDongTable() });
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
    renderTableEmpty(tableBody, { colspan: 12, message: "Không tìm thấy Hợp đồng nào phù hợp", icon: "file-check-2", pagination: pag });
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
        return `<a href="#" data-bf-action="show-package" data-id="${safeAttr(gt.id)}" title="${safeAttr(gt.tenGoiThau || "")}" class="bf-s-1ab2d5a4d0"><span class="detail-code link-hover">${escapeHtml(gt.maGoiThau || "Gói")}</span></a>`;
      }).filter(Boolean).join(" ");
      const statusBadge = renderNeutralStatusBadge(displayedHd.trangThaiHoSo);
      const contractStatusBadge = `<span class="badge badge-info">${escapeHtml(displayedHd.trangThaiHopDong || "Đang thực hiện")}</span>`;
      const wordExportEnabled = Boolean(this.model.state.activeuser?.wordExportEnabled);
      const contractActions = displayedHd.goiThauIds?.length ? [{
        id: displayedHd.goiThauIds[0],
        command: "export-contract",
        className: "btn-export",
        title: wordExportEnabled ? "Xuất hợp đồng" : "Cần gói trả phí đang hoạt động để xuất Word",
        icon: "file-text",
        disabled: !wordExportEnabled,
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
                        <div class="bf-s-8c8dc52ed7">
                            <a href="#" data-bf-action="show-contract" data-id="${safeAttr(displayedHd.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Hợp đồng"><span class="detail-code link-hover bf-s-dc5de304c3">${escapeHtml(displayedHd.soHopDong)}</span></a>
                            <span class="bf-s-db1d8f859f">-</span>
                            ${dropdownHtml}
                        </div>
                    </td>
                    <td class="fw-bold text-wrap bf-s-0569d2208a">${escapeHtml(displayedHd.tenHopDong)}</td>
                    <td>${displayedHd.ngayKy ? formatDate(displayedHd.ngayKy) : "--"}</td>
                    <td class="text-wrap bf-s-3ce088a59b">${escapeHtml(cdtName)}</td>
                    <td class="text-wrap bf-s-3ce088a59b">${ntNameHtml}</td>
                    <td class="fw-bold text-blue">${formatCurrency(displayedHd.giaTri)}</td>
                    <td><span class="badge badge-info">${escapeHtml(displayedHd.loaiHopDong || "Trọn gói")}</span></td>
                    <td><span class="badge badge-secondary bf-s-f9ecd915ac">${escapeHtml(displayedHd.phanLoai || "Tư vấn")}</span></td>
                    <td>${escapeHtml(displayedHd.soNgayThucHien ? isNaN(displayedHd.soNgayThucHien) ? displayedHd.soNgayThucHien : `${displayedHd.soNgayThucHien} ngày` : "--")}</td>
                    <td>${contractStatusBadge}</td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        ${actionHtml}
                    </td>
                </tr>
            `;
    }, { colSpan: 12, rowHeight: 86, onRender: () => lucide.createIcons({ root: tableBody }) });
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
      setRuntimeStyle(editBtn, "display", "flex");
      editBtn.onclick = () => {
        executeAppCommand("editHopDong", versionId);
      };
    } else {
      setRuntimeStyle(editBtn, "display", "none");
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
  const statusBadge = renderNeutralStatusBadge(hd.trangThaiHoSo);
  const contractStatusBadge = `<span class="badge badge-info">${escapeHtml(hd.trangThaiHopDong || "Đang thực hiện")}</span>`;
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
    return `<option value="${safeAttr(h.id)}" ${h.id === versionId ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const versionSelectHtml = `
        <select id="fullpage-hd-version-select" class="page-version-select bf-s-0c44a9336a">
            ${selectOptionsHtml}
        </select>
    `;
  const html = `
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code bf-s-018b1c91c7">${escapeHtml(hd.soHopDong || "--")}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        ${versionSelectHtml}
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${escapeHtml(hd.tenHopDong || "Hợp đồng không có tên")}</h4>
                <div class="bf-s-2d505736cb">
                    ${contractStatusBadge}
                    ${statusBadge}
                </div>
            </div>

            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Số hợp đồng</div>
                    <div class="detail-value fw-bold text-blue">${escapeHtml(hd.soHopDong || "--")}</div>
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
                    <div class="detail-value text-blue fw-bold bf-s-61f44adbb8">${formatCurrency(hd.giaTri)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại hợp đồng</div>
                    <div class="detail-value"><span class="badge badge-info">${escapeHtml(hd.loaiHopDong || "Trọn gói")}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Phân loại</div>
                    <div class="detail-value"><span class="badge badge-secondary bf-s-f9ecd915ac">${escapeHtml(hd.phanLoai || "Tư vấn")}</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Thời gian thực hiện</div>
                    <div class="detail-value">${escapeHtml(hd.soNgayThucHien ? isNaN(hd.soNgayThucHien) ? hd.soNgayThucHien : `${hd.soNgayThucHien} ngày` : "--")}</div>
                </div>
            </div>

            <div class="detail-grid bf-s-090b21d06a">
                <div class="detail-item">
                    <div class="detail-label">Quyết định chỉ định thầu</div>
                    <div class="detail-value">${hd.coQdChiDinh === 1 ? '<span class="badge badge-success">Có quyết định</span>' : '<span class="badge badge-secondary">Không</span>'}</div>
                </div>
                ${hd.coQdChiDinh === 1 ? `
                    <div class="detail-item">
                        <div class="detail-label">Số quyết định chỉ định</div>
                        <div class="detail-value fw-bold">${escapeHtml(hd.soQdChiDinh || "--")}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">Ngày quyết định chỉ định</div>
                        <div class="detail-value">${hd.ngayQdChiDinh ? formatDate(hd.ngayQdChiDinh) : "--"}</div>
                    </div>
                ` : ""}
            </div>

            <div class="detail-sub-section bf-s-a005516828">
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

            ${hd.ngayThanhLy ? `
            <div class="detail-sub-section bf-s-a005516828">
                <h5 class="detail-sub-title">Thông tin đối tác tại thời điểm thanh lý</h5>
                <div class="associated-item">
                    <div><strong>Chủ đầu tư:</strong> ${escapeHtml(liquidationCdt?.tenChuDauTu || "--")} (phiên bản ${escapeHtml(liquidationCdt?.phienBan || "--")})</div>
                    <div><strong>Nhà thầu:</strong> ${escapeHtml(liquidationNt?.tenNhaThau || "--")} (phiên bản ${escapeHtml(liquidationNt?.phienBan || "--")})</div>
                </div>
            </div>` : ""}

            <div class="detail-sub-section bf-s-a005516828">
                <h5 class="detail-sub-title">Thông tin Nhà thầu trúng thầu</h5>
                ${nt ? `
                    <div class="associated-item">
                        <div>
                            <strong class="bf-s-a91dac6c9e">${escapeHtml(nt.tenNhaThau)}</strong><br>
                            <small class="text-muted">Mã số thuế: ${escapeHtml(nt.maSoThue || "--")} | Đại diện: ${escapeHtml(nt.nguoiDaiDien || "--")}</small>
                        </div>
                        <span class="associated-badge partner-identity-code">${escapeHtml(formatPartnerIdentityCode(nt.maNhaThau, "nha_thau"))}</span>
                    </div>
                ` : '<div class="text-muted"><small>Không tìm thấy thông tin nhà thầu.</small></div>'}
            </div>

            ${kh ? `
                <div class="detail-sub-section bf-s-a005516828">
                    <h5 class="detail-sub-title">Kế hoạch lựa chọn nhà thầu liên kết</h5>
                    <div class="associated-item bf-s-ecfbb78629" data-bf-action="show-plan" data-id="${safeAttr(kh.id)}">
                        <div>
                            <strong class="bf-s-bafb444301">${escapeHtml(kh.tenKeHoach)}</strong><br>
                            <small class="text-muted">Mã KH: ${escapeHtml(kh.maKeHoach || "--")} | Tổng mức: ${formatCurrency(kh.tongMucDauTu)}</small>
                        </div>
                    </div>
                </div>
            ` : ""}

            <div class="detail-sub-section bf-s-a005516828">
                <h5 class="detail-sub-title bf-s-fcb5ddef65">Các gói thầu thuộc hợp đồng (${linkedPkgs.length})</h5>
                <div class="associated-list">
                    ${linkedPkgs.length > 0 ? linkedPkgs.map((gt) => `
                        <div class="associated-item bf-s-ecfbb78629" data-bf-action="show-package" data-id="${safeAttr(gt.id)}">
                            <div class="associated-info">
                                <i data-lucide="briefcase" class="text-blue bf-s-0f88141c20"></i>
                                <span><strong>${escapeHtml(gt.maGoiThau || "--")}</strong> - ${escapeHtml(gt.tenGoiThau || "--")}</span>
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
    contentEl.innerHTML = trustedHTML(html);
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
