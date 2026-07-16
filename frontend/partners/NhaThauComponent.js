import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { escapeHtml, initCustomSelect, safeAttr, safeImageSrc } from "../shared/view_helpers.js";
import { loadPaginatedRecords, paginateRecords, sortRecords } from "../shared/tableDataUtils.js";
import { clearVirtualTable, renderVirtualTable } from "../shared/virtualTable.js";
import { resolveContractorVersion } from "./contractorVersionBinding.js";
import { renderVersionSelector, resolveVersionedRow } from "../shared/VersionSelector.js";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../shared/EntityTable.js";
import { renderEntityActions, standardEditDeleteActions } from "../shared/EntityActions.js";
import { executeAppCommand } from "../app/commandBus.js";
import { formatPartnerIdentityCode } from "../app/domUtils.js";
export async function renderNhaThauTable() {
  const tableBody = document.getElementById("nhathau-table").querySelector("tbody");
  const searchVal = document.getElementById("search-nhathau").value.toLowerCase();
  let slicedData = [];
  let totalItems = 0;
  const currentPage = this.model.currentPage.nhathau || 1;
  const pageSize = this.model.pageSize || 10;
  const sortState = this.model.sortState.nhathau || {};
  const sortBy = sortState.field || "";
  const sortOrder = sortState.order || "asc";
  if (this.model.useServerSidePagination) {
    renderTableLoading(tableBody, 8);
    try {
      const data = await loadPaginatedRecords(this.model, "nhathau", {
        page: currentPage, pageSize, search: searchVal, sortBy, sortOrder
      });
      slicedData = data.items;
      totalItems = data.totalItems;
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("Failed to fetch paginated contractors", e);
      clearVirtualTable(tableBody);
      renderTableError(tableBody, { colspan: 8, message: "Không thể tải danh sách nhà thầu. Vui lòng thử lại.", onRetry: () => this.renderNhaThauTable() });
      return;
    }
  } else {
    const latestNhaThau = this.model.getLatestNhaThau();
    const filtered = latestNhaThau.filter(
      (n) => (n.maNhaThau || "").toLowerCase().includes(searchVal) || (n.tenNhaThau || "").toLowerCase().includes(searchVal) || (n.tenVietTat || "").toLowerCase().includes(searchVal) || n.maSoThue && n.maSoThue.includes(searchVal) || n.loaiNhaThau === "Liên danh" && n.thanhVienLienDanh && n.thanhVienLienDanh.some((m) => (m.tenNhaThau || "").toLowerCase().includes(searchVal) || (m.maSoThue || "").includes(searchVal))
    );
    sortRecords(filtered, sortBy, sortOrder);
    totalItems = filtered.length;
    slicedData = paginateRecords(filtered, currentPage, pageSize);
  }
  if (totalItems === 0) {
    clearVirtualTable(tableBody);
    const pag = document.getElementById("nhathau-pagination");
    renderTableEmpty(tableBody, { colspan: 8, message: "Không tìm thấy Nhà thầu nào phù hợp", icon: "shield-alert", pagination: pag });
  } else {
    const esc = escapeHtml;
    renderVirtualTable(tableBody, slicedData, (n) => {
      if (!this.model.state.selectedNhaThauVersion) {
        this.model.state.selectedNhaThauVersion = {};
      }
      const { rootId: root, versions, displayed: displayedNt } = resolveVersionedRow(
        this.model.state.nhathau, n, this.model.state.selectedNhaThauVersion
      );
      const dropdownHtml = renderVersionSelector({
        versions, selectedId: displayedNt.id, rootId: root, changeAction: "change-contractor-version"
      });
      const actionHtml = renderEntityActions(standardEditDeleteActions({
        id: displayedNt.id,
        editCommand: "edit-contractor",
        deleteCommand: "delete-contractor"
      }), { visible: displayedNt.id === n.id && displayedNt.canEdit !== false });
      const isJV = displayedNt.loaiNhaThau === "Liên danh";
      if (isJV) {
        const members = displayedNt.thanhVienLienDanh || [];
        const names = members.map((m) => esc(m.tenNhaThau || "")).join("<br>+ ");
        const msts = members.map((m) => esc(m.maSoThue || "")).join(", ");
        const leaders = members.length > 0 ? `${esc(members[0].danhXung || "Ông")} ${esc(members[0].nguoiDaiDien || "--")} (Trưởng LD)` : "--";
        const contacts = members.length > 0 ? `<small>SĐT: ${esc(members[0].soDienThoai || "--")}</small><br><small>Email: ${esc(members[0].email || "--")}</small>` : "--";
        const bankAccs = members.length > 0 ? `<div class="fw-bold bf-s-6bcb39735e">${esc(members[0].soTaiKhoan || "--")}</div><div class="bf-s-06f7fa3856">${esc(members[0].noiMoTaiKhoan || "--")} (+${members.length - 1} TV)</div>` : "--";
        return `
                    <tr>
                        <td>
                            <div class="bf-s-8c8dc52ed7">
                                <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Nhà thầu"><span class="detail-code partner-identity-code bf-s-dc5de304c3">${esc(formatPartnerIdentityCode(displayedNt.maNhaThau))}</span></a>
                                <span class="bf-s-db1d8f859f">-</span>
                                ${dropdownHtml}
                            </div>
                        </td>
                        <td class="fw-bold text-wrap bf-s-e7d9f0dfa1">
                            <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${esc(displayedNt.tenNhaThau || "")}</a>
                            ${displayedNt.tenVietTat ? `<div class="bf-s-92c49ab355">Tên viết tắt: ${esc(displayedNt.tenVietTat)}</div>` : ""}
                            <div class="bf-s-597bc8fb90"><span class="badge badge-info">Liên danh (${members.length} TV)</span></div>
                            <div class="bf-s-77e56bd1c2">
                                + ${names}
                            </div>
                        </td>
                        <td><small>${msts}</small></td>
                        <td>${leaders}</td>
                        <td>${contacts}</td>
                        <td>${bankAccs}</td>
                        <td class="text-right">
                            ${actionHtml}
                        </td>
                    </tr>
                `;
      } else {
        const rep = `${esc(displayedNt.danhXung || "Ông")} ${esc(displayedNt.nguoiDaiDien || "--")}`;
        const contact = `<small>SĐT: ${esc(displayedNt.soDienThoai || "--")}</small><br><small>Email: ${esc(displayedNt.email || "--")}</small>`;
        const bankAcc = `<div class="fw-bold bf-s-6bcb39735e">${esc(displayedNt.soTaiKhoan || "--")}</div><div class="bf-s-06f7fa3856">${esc(displayedNt.noiMoTaiKhoan || "--")}${displayedNt.maNganHang ? " (" + esc(displayedNt.maNganHang) + ")" : ""}</div>`;
        return `
                    <tr>
                        <td>
                            <div class="bf-s-8c8dc52ed7">
                                <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Nhà thầu"><span class="detail-code partner-identity-code bf-s-dc5de304c3">${esc(formatPartnerIdentityCode(displayedNt.maNhaThau))}</span></a>
                                <span class="bf-s-db1d8f859f">-</span>
                                ${dropdownHtml}
                            </div>
                        </td>
                        <td class="fw-bold text-wrap bf-s-e7d9f0dfa1">
                            <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${esc(displayedNt.tenNhaThau || "")}</a>
                            ${displayedNt.tenVietTat ? `<div class="bf-s-92c49ab355">Tên viết tắt: ${esc(displayedNt.tenVietTat)}</div>` : ""}
                        </td>
                        <td>${esc(displayedNt.maSoThue || "--")}</td>
                        <td>${rep}</td>
                        <td>${contact}</td>
                        <td>${bankAcc}</td>
                        <td class="text-right">
                            ${actionHtml}
                        </td>
                    </tr>
                `;
      }
    }, { colSpan: 7, rowHeight: 92, onRender: () => lucide.createIcons({ root: tableBody }) });
    executeAppCommand("renderTablePagination", "nhathau-pagination", totalItems, currentPage, pageSize);
  }
  lucide.createIcons({ root: tableBody });
  this.enhanceTableHeaders("nhathau-table", "nhathau");
}
export function showNhaThauDetails(id, isSwitchingVersion = false) {
  const detailPane = document.getElementById("tab-nhathau-detail");
  if (!detailPane || !detailPane.classList.contains("active")) {
    executeAppCommand("switchTab", "nhathau-detail", id);
    return;
  }
  const nt = this.model.state.nhathau.find((n) => n.id === id);
  if (!nt) return;
  this.renderNhaThauVersionDetails(id);
}
export function renderNhaThauVersionDetails(versionId) {
  const nt = this.model.state.nhathau.find((n) => n.id === versionId);
  if (!nt) return;
  const root = nt.rootId || nt.id;
  const allRelated = (this.model.state.nhathau || []).filter((n) => n.rootId === root || n.id === root);
  allRelated.sort((a, b) => parseInt(b.phienBan || 0) - parseInt(a.phienBan || 0));
  const isLatest = allRelated[0] && allRelated[0].id === versionId;
  const editBtn = document.getElementById("btn-edit-nhathau-fullpage");
  if (editBtn) {
    if (isLatest && nt.canEdit !== false) {
      setRuntimeStyle(editBtn, "display", "flex");
      editBtn.onclick = () => {
        executeAppCommand("editNhaThau", versionId);
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
        <select id="fullpage-nt-version-select" class="page-version-select" style="min-width: 100px; max-width: 320px; width: auto;" ${allRelated.length < 2 ? "disabled" : ""}>
            ${selectOptionsHtml}
        </select>
    `;
  const addressParts = (nt.diaChi || "").split(" | ");
  const addressStr = addressParts.filter(Boolean).join(", ");
  const stampSrc = safeImageSrc(nt.anhDau, nt.updatedAt || nt.createdAt);
  const stampFileName = escapeHtml(nt.tenAnhDau || "Ảnh dấu nhà thầu");
  let detailsHtml = "";
  const isJV = nt.loaiNhaThau === "Liên danh";
  if (isJV) {
    const members = nt.thanhVienLienDanh || [];
    detailsHtml = `
            <div class="detail-grid bf-s-6f7f7fd51b">
                <div class="detail-item">
                    <div class="detail-label">Ngày áp dụng</div>
                    <div class="detail-value fw-bold">${escapeHtml(nt.ngayApDung ? this.model.formatDate(nt.ngayApDung) : "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại nhà thầu</div>
                    <div class="detail-value"><span class="badge badge-info">Liên danh (${members.length} thành viên)</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số thành viên</div>
                    <div class="detail-value fw-bold">${members.length} TV</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt</div>
                    <div class="detail-value fw-bold">${escapeHtml(nt.tenVietTat || "--")}</div>
                </div>
            </div>

            <h5 class="detail-sub-title bf-s-e677e891f7">Danh sách thành viên liên danh</h5>
            <div class="associated-list">
                ${members.map((m, index) => {
      const memberAddress = (m.diaChi || "").split(" | ").filter(Boolean).join(", ");
      const memberContractor = resolveContractorVersion(this.model, m);
      const memberId = escapeHtml(memberContractor?.id || "");
      const memberName = escapeHtml(memberContractor?.tenNhaThau || m.tenNhaThau || "--");
      const memberCode = escapeHtml(formatPartnerIdentityCode(memberContractor?.maNhaThau || memberContractor?.maSoThue || m.maNhaThau || m.maSoThue, "--"));
      const nameHtml = memberId ? `<a href="#" data-bf-action="show-contractor" data-id="${memberId}" class="text-blue link-hover">${memberName}</a>` : memberName;
      const codeHtml = memberId ? `<a href="#" data-bf-action="show-contractor" data-id="${memberId}" class="text-blue link-hover">${memberCode}</a>` : memberCode;
      return `
                        <div class="associated-item bf-s-cbe87aeaba">
                            <div class="bf-s-d21628051b">
                                <strong class="bf-s-81227e2dc7">${index + 1}. ${nameHtml} ${index === 0 ? '<span class="badge badge-primary bf-s-cef2961f3b">Trưởng Liên danh</span>' : ""}</strong>
                                <span class="badge badge-secondary bf-s-01d9db4be2">Mã/MST: ${codeHtml}</span>
                            </div>
                            <div class="bf-s-b373b969d2">
                                <div><span class="text-muted">Đại diện:</span> ${escapeHtml(m.danhXung || "Ông")} ${escapeHtml(m.nguoiDaiDien || "--")} (${escapeHtml(m.chucVu || "--")})</div>
                                <div><span class="text-muted">Liên hệ:</span> SĐT: ${escapeHtml(m.soDienThoai || "--")} | Email: ${escapeHtml(m.email || "--")}</div>
                                <div class="bf-s-6d00fde401"><span class="text-muted">Tài khoản ngân hàng:</span> <strong>${escapeHtml(m.soTaiKhoan || "--")}</strong> tại ${escapeHtml(m.noiMoTaiKhoan || "--")} ${m.maNganHang ? `(${escapeHtml(m.maNganHang)})` : ""}</div>
                                <div class="bf-s-6d00fde401"><span class="text-muted">Địa chỉ:</span> ${escapeHtml(memberAddress || "--")}</div>
                            </div>
                        </div>
                    `;
    }).join("")}
            </div>
        `;
  } else {
    detailsHtml = `
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-label">Ngày áp dụng</div>
                    <div class="detail-value fw-bold">${escapeHtml(nt.ngayApDung ? this.model.formatDate(nt.ngayApDung) : "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại nhà thầu</div>
                    <div class="detail-value"><span class="badge badge-secondary bf-s-f9ecd915ac">Độc lập</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã số thuế</div>
                    <div class="detail-value fw-bold">${escapeHtml(nt.maSoThue || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt</div>
                    <div class="detail-value fw-bold">${escapeHtml(nt.tenVietTat || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Người đại diện</div>
                    <div class="detail-value">${escapeHtml(nt.nguoiDaiDien ? `${nt.danhXung || ""} ${nt.nguoiDaiDien}`.trim() : "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đại diện</div>
                    <div class="detail-value">${escapeHtml(nt.chucVuDaiDien || "--")}</div>
                </div>
                <div class="detail-item bf-s-6d00fde401">
                    <div class="detail-label">Địa chỉ</div>
                    <div class="detail-value">${escapeHtml(addressStr || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số điện thoại</div>
                    <div class="detail-value">${escapeHtml(nt.soDienThoai || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Email liên hệ</div>
                    <div class="detail-value">${escapeHtml(nt.email || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số tài khoản</div>
                    <div class="detail-value fw-bold text-blue">${escapeHtml(nt.soTaiKhoan || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Nơi mở tài khoản</div>
                    <div class="detail-value">${escapeHtml(nt.noiMoTaiKhoan || "--")}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã ngân hàng</div>
                    <div class="detail-value">${escapeHtml(nt.maNganHang || "--")}</div>
                </div>
            </div>
        `;
  }
  const html = `
        <div class="detail-section">
            <div class="detail-header-block bf-s-08b722fa44">
                <div class="bf-s-a36b98e9db">
                    <div class="bf-s-bbf072f32c">
                        <span class="detail-code partner-identity-code bf-s-018b1c91c7">${escapeHtml(formatPartnerIdentityCode(nt.maNhaThau, "--"))}</span>
                        <span class="version-separator bf-s-ada7b4c5a3">-</span>
                        ${versionSelectHtml}
                    </div>
                </div>
                <h4 class="detail-title bf-s-4749e65682">${escapeHtml(nt.tenNhaThau || "Nhà thầu chưa có tên")}</h4>
            </div>
            ${detailsHtml}
            ${stampSrc ? `
              <div class="bf-s-a005516828">
                <h5 class="detail-sub-title">Ảnh dấu nhà thầu</h5>
                <div class="file-preview-container bf-s-a66ba50765">
                  <a href="${stampSrc}" target="_blank" rel="noopener noreferrer" title="Xem ảnh dấu">
                    <img src="${stampSrc}" alt="${stampFileName}" class="bf-s-fefe4d57e7">
                  </a>
                  <div class="text-muted bf-s-56af3282d2">${stampFileName}</div>
                </div>
              </div>
            ` : ""}
        </div>
    `;
  const contentEl = document.getElementById("fullpage-nhathau-content");
  if (contentEl) {
    contentEl.innerHTML = html;
    const innerSelect = document.getElementById("fullpage-nt-version-select");
    if (innerSelect) {
      if (allRelated.length >= 2) {
        innerSelect.onchange = (e) => {
          this.renderNhaThauVersionDetails(e.target.value);
        };
      } else {
        innerSelect.onchange = null;
      }
      initCustomSelect("fullpage-nt-version-select");
    }
    lucide.createIcons();
  }
}
