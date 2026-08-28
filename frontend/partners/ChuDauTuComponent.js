import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { renderLucideIcons } from "../shared/lucideIcons.js";
import { escapeHtml, initCustomSelect, safeAttr } from "../shared/view_helpers.js";
import { getCachedPaginatedRecords, loadPaginatedRecords, paginateRecords, sortRecords } from "../shared/tableDataUtils.js";
import { clearVirtualTable, renderVirtualTable } from "../shared/virtualTable.js";
import { renderVersionSelector, resolveVersionedRow } from "../shared/VersionSelector.js";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../shared/EntityTable.js";
import { renderEntityActions, standardEditDeleteActions } from "../shared/EntityActions.js";
import { executeAppCommand } from "../app/commandBus.js";
import { formatPartnerIdentityCode } from "../app/domUtils.js";
import { sortVersionsDescending, versionFamily } from "../shared/versionResolver.js";
import { beginTablePerf } from "../shared/perfDiagnostics.js";
export async function renderChuDauTuTable() {
  const tablePerf = beginTablePerf("chudautu", "chudautu");
  const tableBody = document.getElementById("chudautu-table").querySelector("tbody");
  const searchVal = document.getElementById("search-chudautu").value.toLowerCase();
  let slicedData = [];
  let totalItems = 0;
  const currentPage = this.model.currentPage.chudautu || 1;
  const pageSize = this.model.pageSize || 10;
  const sortState = this.model.sortState.chudautu || {};
  const sortBy = sortState.field || "";
  const sortOrder = sortState.order || "asc";
  if (this.model.useServerSidePagination) {
    const pageParams = { page: currentPage, pageSize, search: searchVal, sortBy, sortOrder };
    if (!getCachedPaginatedRecords(this.model, "chudautu", pageParams)) {
      renderTableLoading(tableBody, 8);
    }
    try {
      const data = await loadPaginatedRecords(this.model, "chudautu", pageParams, {
        cancellationOwner: "ui:investor-list",
      });
      slicedData = data.items;
      totalItems = data.totalItems;
      tablePerf.dataComplete(data);
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("Failed to fetch paginated investors", e);
      clearVirtualTable(tableBody);
      renderTableError(tableBody, { colspan: 8, message: "Không thể tải danh sách chủ đầu tư. Vui lòng thử lại.", onRetry: () => this.renderChuDauTuTable() });
      return;
    }
  } else {
    const latestChuDauTu = this.model.getLatestChuDauTu();
    const filtered = latestChuDauTu.filter(
      (c) => (c.maChuDauTu || "").toLowerCase().includes(searchVal) || (c.tenChuDauTu || "").toLowerCase().includes(searchVal) || (c.tenVietTat || "").toLowerCase().includes(searchVal) || c.maSoThue && c.maSoThue.includes(searchVal)
    );
    sortRecords(filtered, sortBy, sortOrder);
    totalItems = filtered.length;
    slicedData = paginateRecords(filtered, currentPage, pageSize);
    tablePerf.dataComplete({ cacheHit: true, localSnapshot: true });
  }
  if (totalItems === 0) {
    clearVirtualTable(tableBody);
    const pag = document.getElementById("chudautu-pagination");
    renderTableEmpty(tableBody, { colspan: 8, message: "Không tìm thấy Chủ đầu tư nào phù hợp", icon: "building", pagination: pag });
  } else {
    renderVirtualTable(tableBody, slicedData, (c) => {
      const esc = escapeHtml;
      if (!this.model.state.selectedChuDauTuVersion) {
        this.model.state.selectedChuDauTuVersion = {};
      }
      const { rootId: root, versions, displayed: displayedCdt } = resolveVersionedRow(
        this.model.state.chudautu, c, this.model.state.selectedChuDauTuVersion
      );
      const dropdownHtml = renderVersionSelector({
        versions, selectedId: displayedCdt.id, rootId: root, changeAction: "change-investor-version"
      });
      const actionHtml = renderEntityActions(standardEditDeleteActions({
        id: displayedCdt.id,
        editCommand: "edit-investor",
        deleteCommand: "delete-investor",
        allowDelete: this.model.state.activerole !== "employee"
      }), { visible: displayedCdt.id === c.id && displayedCdt.canEdit !== false });
      return `
            <tr>
                <td>
                    <div class="bf-s-8c8dc52ed7">
                        <a href="#" data-bf-action="show-investor" data-id="${safeAttr(displayedCdt.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Chủ đầu tư"><span class="detail-code partner-identity-code bf-s-dc5de304c3">${esc(formatPartnerIdentityCode(displayedCdt.maChuDauTu))}</span></a>
                        <span class="bf-s-db1d8f859f">-</span>
                        ${dropdownHtml}
                    </div>
                </td>
                <td class="fw-bold text-wrap bf-s-2281f122ad">
                    ${esc(displayedCdt.tenChuDauTu || "")}
                    ${displayedCdt.tenVietTat ? `<div class="bf-s-92c49ab355">Tên viết tắt: ${esc(displayedCdt.tenVietTat)}</div>` : ""}
                    ${displayedCdt.coQuanChuQuan ? `<div class="bf-s-92c49ab355">CQ chủ quản: ${esc(displayedCdt.coQuanChuQuan)}</div>` : ""}
                </td>
                <td>${esc(displayedCdt.maSoThue || "--")}</td>
                <td><span class="fw-bold">${esc(displayedCdt.danhXung || "Ông")} ${esc(displayedCdt.daiDienCdt || "--")}</span></td>
                <td class="text-wrap bf-s-e7d9f0dfa1">
                    <div class="fw-bold bf-s-6bcb39735e">${esc((displayedCdt.diaChi || "").replace(/\s*\|\s*/g, ", "))}</div>
                    <div class="bf-s-06f7fa3856">${esc(displayedCdt.soDienThoai || "")}${displayedCdt.email ? " | " + esc(displayedCdt.email) : ""}</div>
                </td>
                <td>
                    <div class="fw-bold bf-s-6bcb39735e">${esc(displayedCdt.soTaiKhoan || "--")}</div>
                    <div class="bf-s-06f7fa3856">${esc(displayedCdt.noiMoTaiKhoan || "--")}${displayedCdt.maQHNS ? " | QHNS: " + esc(displayedCdt.maQHNS) : ""}</div>
                </td>
                <td class="text-right">
                    ${actionHtml}
                </td>
            </tr>
            `;
    }, { colSpan: 7, rowHeight: 82, onRender: () => lucide.createIcons({ root: tableBody }) });
    executeAppCommand("renderTablePagination", "chudautu-pagination", totalItems, currentPage, pageSize);
  }
  lucide.createIcons({ root: tableBody });
  this.enhanceTableHeaders("chudautu-table", "chudautu");
  return { performance: tablePerf.complete() };
}
export function showChuDauTuDetails(id) {
  const detailPane = document.getElementById("tab-chudautu-detail");
  if (!detailPane || !detailPane.classList.contains("active")) {
    executeAppCommand("switchTab", "chudautu-detail", id);
    return;
  }
  const cdt = this.model.state.chudautu.find((c) => c.id === id);
  if (!cdt) return;
  this.renderChuDauTuVersionDetails(id);
}
export function renderChuDauTuVersionDetails(versionId) {
  const cdt = this.model.state.chudautu.find((c) => c.id === versionId);
  if (!cdt) return;
  const allRelated = sortVersionsDescending(versionFamily(this.model.state.chudautu, cdt));
  const isLatest = allRelated[0] && allRelated[0].id === versionId;
  const editBtn = document.getElementById("btn-edit-chudautu-fullpage");
  if (editBtn) {
    if (isLatest && cdt.canEdit !== false) {
      setRuntimeStyle(editBtn, "display", "flex");
      editBtn.onclick = () => {
        executeAppCommand("editChuDauTu", versionId);
      };
    } else {
      setRuntimeStyle(editBtn, "display", "none");
    }
  }
  const selectOptionsHtml = allRelated.map((v) => {
    const ver = String(parseInt(v.phienBan || 0)).padStart(2, "0");
    return `<option value="${safeAttr(v.id)}" ${v.id === versionId ? "selected" : ""}>${escapeHtml(ver)}</option>`;
  }).join("");
  const versionSelectHtml = `
        <select id="fullpage-cdt-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;" ${allRelated.length < 2 ? "disabled" : ""}>
            ${selectOptionsHtml}
        </select>
    `;
  const addressParts = (cdt.diaChi || "").split(" | ");
  const addressStr = addressParts.filter(Boolean).join(", ");
  const html = `
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code partner-identity-code bf-s-018b1c91c7">${escapeHtml(formatPartnerIdentityCode(cdt.maChuDauTu, "--"))}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        ${versionSelectHtml}
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${escapeHtml(cdt.tenChuDauTu || "Chủ đầu tư chưa có tên")}</h4>
            </div>

            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Ngày áp dụng</div>
                    <div class="detail-value fw-bold">${escapeHtml(cdt.ngayApDung ? this.model.formatDate(cdt.ngayApDung) : "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã số thuế</div>
                    <div class="detail-value fw-bold">${escapeHtml(cdt.maSoThue || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt</div>
                    <div class="detail-value fw-bold">${escapeHtml(cdt.tenVietTat || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Đại diện CĐT</div>
                    <div class="detail-value">${escapeHtml(cdt.daiDienCdt ? `${cdt.danhXung || ""} ${cdt.daiDienCdt}`.trim() : "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đại diện</div>
                    <div class="detail-value">${escapeHtml(cdt.chucVuDaiDien || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đứng đầu</div>
                    <div class="detail-value">${escapeHtml(cdt.chucVuNguoiDungDau || "--")}</div>
                </div>
                <div class="detail-item bf-s-6d00fde401">
                    <div class="detail-label">Địa chỉ</div>
                    <div class="detail-value">${escapeHtml(addressStr || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số điện thoại</div>
                    <div class="detail-value">${escapeHtml(cdt.soDienThoai || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Email liên hệ</div>
                    <div class="detail-value">${escapeHtml(cdt.email || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số tài khoản</div>
                    <div class="detail-value fw-bold text-blue">${escapeHtml(cdt.soTaiKhoan || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Nơi mở tài khoản</div>
                    <div class="detail-value">${escapeHtml(cdt.noiMoTaiKhoan || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã QHNS</div>
                    <div class="detail-value">${escapeHtml(cdt.maQHNS || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Cơ quan chủ quản</div>
                    <div class="detail-value">${escapeHtml(cdt.coQuanChuQuan || "--")}</div>
                </div>
            </div>
        </div>
    `;
  const contentEl = document.getElementById("fullpage-chudautu-content");
  if (contentEl) {
    contentEl.innerHTML = trustedHTML(html);
    const innerSelect = document.getElementById("fullpage-cdt-version-select");
    if (innerSelect) {
      if (allRelated.length >= 2) {
        innerSelect.onchange = (e) => {
          this.renderChuDauTuVersionDetails(e.target.value);
        };
      } else {
        innerSelect.onchange = null;
      }
      initCustomSelect("fullpage-cdt-version-select");
    }
    renderLucideIcons(contentEl, lucide);
  }
}
