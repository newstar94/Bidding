import { escapeHtml, formatDateOnly, safeImageSrc } from "../shared/view_helpers.js";
import { loadPaginatedRecords, paginateRecords, sortRecords } from "../shared/tableDataUtils.js";
import { clearVirtualTable, renderVirtualTable } from "../shared/virtualTable.js";
import { renderVersionSelector, resolveVersionedRow } from "../shared/VersionSelector.js";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../shared/EntityTable.js";
import { renderEntityActions, standardEditDeleteActions } from "../shared/EntityActions.js";
import { executeAppCommand } from "../app/commandBus.js";
import { getAppController } from "../app/controllerRef.js";
export async function renderChuyenGiaTable() {
  const table = document.getElementById("chuyengia-table");
  if (!table) return;
  const tableBody = table.querySelector("tbody");
  const searchVal = document.getElementById("search-chuyengia").value.toLowerCase();
  const requestId = (this._chuyenGiaRenderRequestId || 0) + 1;
  this._chuyenGiaRenderRequestId = requestId;
  const isEmployee = this.model.state.activerole === "employee";
  const btnAdd = document.getElementById("btn-add-chuyengia");
  if (btnAdd) {
    btnAdd.style.display = isEmployee ? "none" : "flex";
  }
  let slicedData = [];
  let totalItems = 0;
  const currentPage = this.model.currentPage.chuyengia || 1;
  const pageSize = this.model.pageSize || 10;
  const sortState = this.model.sortState.chuyengia || {};
  const sortBy = sortState.field || "";
  const sortOrder = sortState.order || "asc";
  if (this.model.useServerSidePagination) {
    renderTableLoading(tableBody, 7);
    try {
      const data = await loadPaginatedRecords(this.model, "chuyengia", {
        page: currentPage, pageSize, search: searchVal, sortBy, sortOrder
      });
      if (requestId !== this._chuyenGiaRenderRequestId || !table.isConnected) return;
      slicedData = data.items;
      totalItems = data.totalItems;
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("Failed to fetch paginated experts", e);
      if (requestId !== this._chuyenGiaRenderRequestId || !table.isConnected) return;
      clearVirtualTable(tableBody);
      renderTableError(tableBody, { colspan: 7, message: "Không thể tải danh sách chuyên gia. Vui lòng thử lại.", onRetry: () => this.renderChuyenGiaTable() });
      return;
    }
  } else {
    const latestChuyenGia = this.model.getLatestChuyenGia();
    const filtered = latestChuyenGia.filter(
      (cg) => (cg.hoTen || "").toLowerCase().includes(searchVal) || (cg.soCCCD || "").includes(searchVal) || (cg.soChungChi || "").toLowerCase().includes(searchVal)
    );
    sortRecords(filtered, sortBy, sortOrder);
    totalItems = filtered.length;
    slicedData = paginateRecords(filtered, currentPage, pageSize);
  }
  if (totalItems === 0) {
    clearVirtualTable(tableBody);
    const pag = document.getElementById("chuyengia-pagination");
    renderTableEmpty(tableBody, { colspan: 7, message: "Không tìm thấy Chuyên gia nào phù hợp", icon: "user-x", pagination: pag });
  } else {
    renderVirtualTable(tableBody, slicedData, (cg) => {
      if (!this.model.state.selectedChuyenGiaVersion) {
        this.model.state.selectedChuyenGiaVersion = {};
      }
      const { rootId: root, versions, displayed: displayedCg } = resolveVersionedRow(
        this.model.state.chuyengia, cg, this.model.state.selectedChuyenGiaVersion
      );
      const displayedId = escapeHtml(displayedCg.id);
      const expertName = escapeHtml(displayedCg.hoTen || "");
      const actionHtml = renderEntityActions(standardEditDeleteActions({
        id: displayedCg.id,
        editCommand: "edit-expert",
        deleteCommand: "delete-expert"
      }), { visible: !isEmployee && displayedCg.id === cg.id });
      const expertCccd = escapeHtml(displayedCg.soCCCD || "");
      const certificateNo = escapeHtml(displayedCg.soChungChi || "");
      const certificateIssuer = escapeHtml(displayedCg.donViCapChungChi || "--");
      const certificateDate = escapeHtml(displayedCg.ngayCapChungChi ? formatDateOnly(displayedCg.ngayCapChungChi) : "--");
      const dropdownHtml = renderVersionSelector({
        versions, selectedId: displayedCg.id, rootId: root, changeAction: "change-expert-version"
      });
      return `
            <tr>
                <td class="fw-bold">
                    <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                        <a href="#" data-bf-action="show-expert" data-id="${displayedId}" class="text-blue fw-bold link-hover" title="Xem chi tiết lý lịch" style="display: inline-flex; align-items: center; line-height: 1;"><span style="margin: 0; line-height: 1;">${expertName}</span></a>
                        <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                        ${dropdownHtml}
                    </div>
                </td>
                <td>${expertCccd}</td>
                <td><span class="badge badge-info">${certificateNo}</span></td>
                <td style="min-width: 200px; max-width: 300px;" class="text-muted text-wrap">${certificateIssuer}</td>
                <td>${certificateDate}</td>
                <td class="text-right">
                    ${actionHtml}
                </td>
            </tr>
            `;
    }, { colSpan: 7, rowHeight: 76, onRender: () => lucide.createIcons({ root: tableBody }) });
    executeAppCommand("renderTablePagination", "chuyengia-pagination", totalItems, currentPage, pageSize);
  }
  lucide.createIcons({ root: tableBody });
  this.enhanceTableHeaders("chuyengia-table", "chuyengia");
}
export function showChuyenGiaDetails(id) {
  if (!document.getElementById("modal-detail-chuyengia")) {
    getAppController()?.ensureLazyModal?.("modal-detail-chuyengia").then(() => this.showChuyenGiaDetails(id));
    return;
  }
  const cg = this.model.state.chuyengia.find((c) => c.id === id);
  if (!cg) return;
  const displayName = escapeHtml(cg.hoTen || "");
  const cccd = escapeHtml(cg.soCCCD || "--");
  const cccdDate = escapeHtml(cg.ngayCapCCCD ? formatDateOnly(cg.ngayCapCCCD) : "--");
  const cccdIssuer = escapeHtml(cg.noiCapCCCD || "--");
  const certificateNo = escapeHtml(cg.soChungChi || "--");
  const certificateDate = escapeHtml(cg.ngayCapChungChi ? formatDateOnly(cg.ngayCapChungChi) : "--");
  const certificateIssuer = escapeHtml(cg.donViCapChungChi || "--");
  const expertId = escapeHtml(cg.id);
  const imageVersion = cg.updatedAt || cg.createdAt;
  const signatureSrc = safeImageSrc(cg.anhChuKy, imageVersion);
  const certificateSrc = safeImageSrc(cg.anhChungChi, imageVersion);
  const avatarInitial = escapeHtml(String(cg.hoTen || "?").split(" ").map((w) => w[0]).pop().toUpperCase());
  const certFileName = escapeHtml(cg.tenAnhChungChi || (cg.soCCCD ? `CC_${cg.soCCCD}.png` : "--"));
  const sigFileName = escapeHtml(cg.tenAnhChuKy || (cg.soCCCD ? `CK_${cg.soCCCD}.png` : "--"));
  const html = `
        <div class="expert-profile-grid">
            <div class="profile-passport-card">
                <div class="profile-passport-avatar">${avatarInitial}</div>
                <div class="profile-passport-name">${displayName}</div>

                <div class="passport-details-list">
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Số CCCD</div>
                        <div class="passport-detail-val fw-bold">${cccd}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Ngày cấp CCCD</div>
                        <div class="passport-detail-val">${cccdDate}</div>
                    </div>
                    <div class="passport-detail-row">
                        <div class="passport-detail-label">Nơi cấp CCCD</div>
                        <div class="passport-detail-val">${cccdIssuer}</div>
                    </div>
                </div>

                <div style="margin-top: 18px;">
                    <div class="passport-detail-label" style="margin-bottom: 6px;">Ảnh chữ ký chuyên gia</div>
                    <div class="signature-display-frame" data-bf-action="zoom-signature" data-id="${expertId}" title="Bấm để phóng to">
                        ${signatureSrc ? `<img src="${signatureSrc}" alt="Chữ ký" loading="lazy" decoding="async" style="max-height:80px; max-width:100%; object-fit:contain;">` : `<span class="text-muted" style="font-size:0.78rem;">Chưa có ảnh chữ ký</span>`}
                    </div>
                    <div style="margin-top:4px; font-size:0.72rem; color:var(--text-light);">📁 ${sigFileName}</div>
                </div>
            </div>

            <div class="expert-profile-details">
                <div class="expert-cert-viewer">
                    <div class="expert-cert-title-bar">
                        <h5>Chứng chỉ Hành nghề Đấu thầu</h5>
                        <span class="badge badge-info">Số CC: ${certificateNo}</span>
                    </div>

                    <div class="passport-details-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 0; margin-bottom: 12px;">
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Số chứng chỉ</div>
                            <div class="passport-detail-val fw-bold text-blue">${certificateNo}</div>
                        </div>
                        <div class="passport-detail-row">
                            <div class="passport-detail-label">Ngày cấp</div>
                            <div class="passport-detail-val">${certificateDate}</div>
                        </div>
                        <div class="passport-detail-row" style="grid-column: span 2;">
                            <div class="passport-detail-label">Đơn vị cấp chứng chỉ</div>
                            <div class="passport-detail-val fw-bold">${certificateIssuer}</div>
                        </div>
                    </div>

                    <div class="passport-detail-label" style="margin-bottom: 6px;">Ảnh chụp chứng chỉ thực tế</div>
                    <div class="cert-image-frame" data-bf-action="zoom-certificate" data-id="${expertId}">
                        ${certificateSrc ? `<img src="${certificateSrc}" alt="Ảnh chứng chỉ" loading="lazy" decoding="async">` : `<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--text-light);">Chưa có ảnh chứng chỉ</div>`}
                        ${certificateSrc ? `<div class="cert-zoom-overlay"><i data-lucide="zoom-in"></i> Phóng to</div>` : ""}
                    </div>
                    <div style="margin-top:4px; font-size:0.72rem; color:var(--text-light);">📁 ${certFileName}</div>
                </div>
            </div>
        </div>
    `;
  document.getElementById("detail-chuyengia-content").innerHTML = html;
  this.openModal("modal-detail-chuyengia");
  lucide.createIcons({ root: document.getElementById("detail-chuyengia-content") });
}
