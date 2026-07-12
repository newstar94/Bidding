import { escapeHtml, initCustomSelect, safeImageSrc } from "../view_helpers.js";
import { loadPaginatedRecords, paginateRecords, sortRecords } from "../tableDataUtils.js";
import { clearVirtualTable, renderVirtualTable } from "../virtualTable.js";
import { resolveContractorVersion } from "../../../controllers/workflows/contractorVersionBinding.js";
import { renderVersionSelector, resolveVersionedRow } from "../../components/VersionSelector.js";
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
    if (!tableBody.querySelector(".empty-state") && tableBody.children.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--primary); font-weight: bold;">Đang tải dữ liệu từ máy chủ...</td></tr>`;
    }
    try {
      const data = await loadPaginatedRecords(this.model, "nhathau", {
        page: currentPage, pageSize, search: searchVal, sortBy, sortOrder
      });
      slicedData = data.items;
      totalItems = data.totalItems;
    } catch (e) {
      console.error("Failed to fetch paginated contractors", e);
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
    tableBody.innerHTML = `
            <tr>
                <td colspan="8">
                    <div class="empty-state">
                        <i data-lucide="shield-alert"></i>
                        <p>Không tìm thấy Nhà thầu nào phù hợp</p>
                    </div>
                </td>
            </tr>
        `;
    const pag = document.getElementById("nhathau-pagination");
    if (pag) pag.innerHTML = "";
  } else {
    const esc = window.escapeHTML || ((value) => String(value ?? ""));
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
      const isJV = displayedNt.loaiNhaThau === "Liên danh";
      if (isJV) {
        const members = displayedNt.thanhVienLienDanh || [];
        const names = members.map((m) => esc(m.tenNhaThau || "")).join("<br>+ ");
        const msts = members.map((m) => esc(m.maSoThue || "")).join(", ");
        const leaders = members.length > 0 ? `${esc(members[0].danhXung || "Ông")} ${esc(members[0].nguoiDaiDien || "--")} (Trưởng LD)` : "--";
        const contacts = members.length > 0 ? `<small>SĐT: ${esc(members[0].soDienThoai || "--")}</small><br><small>Email: ${esc(members[0].email || "--")}</small>` : "--";
        const bankAccs = members.length > 0 ? `<div style="font-size:0.85rem;" class="fw-bold">${esc(members[0].soTaiKhoan || "--")}</div><div style="font-size:0.75rem; color:var(--text-light);">${esc(members[0].noiMoTaiKhoan || "--")} (+${members.length - 1} TV)</div>` : "--";
        return `
                    <tr>
                        <td>
                            <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                                <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${esc(displayedNt.maNhaThau || "")}</span></a>
                                <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                                ${dropdownHtml}
                            </div>
                        </td>
                        <td style="min-width: 240px; max-width: 360px;" class="fw-bold text-wrap">
                            <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${esc(displayedNt.tenNhaThau || "")}</a>
                            ${displayedNt.tenVietTat ? `<div style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-top:2px;">Tên viết tắt: ${esc(displayedNt.tenVietTat)}</div>` : ""}
                            <div style="margin-top: 4px;"><span class="badge badge-info">Liên danh (${members.length} TV)</span></div>
                            <div style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted); margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--primary-soft); white-space: normal !important;">
                                + ${names}
                            </div>
                        </td>
                        <td><small>${msts}</small></td>
                        <td>${leaders}</td>
                        <td>${contacts}</td>
                        <td>${bankAccs}</td>
                        <td class="text-right">
                            <div class="action-btn-group">
                                ${displayedNt.id === n.id ? `
                                <button class="action-btn btn-edit" data-bf-action="edit-contractor" data-id="${esc(displayedNt.id)}" title="Sửa">
                                    <i data-lucide="edit-2"></i>
                                </button>
                                <button class="action-btn btn-delete" data-bf-action="delete-contractor" data-id="${esc(displayedNt.id)}" title="Xóa">
                                    <i data-lucide="trash-2"></i>
                                </button>
                                ` : ""}
                            </div>
                        </td>
                    </tr>
                `;
      } else {
        const rep = `${esc(displayedNt.danhXung || "Ông")} ${esc(displayedNt.nguoiDaiDien || "--")}`;
        const contact = `<small>SĐT: ${esc(displayedNt.soDienThoai || "--")}</small><br><small>Email: ${esc(displayedNt.email || "--")}</small>`;
        const bankAcc = `<div style="font-size:0.85rem;" class="fw-bold">${esc(displayedNt.soTaiKhoan || "--")}</div><div style="font-size:0.75rem; color:var(--text-light);">${esc(displayedNt.noiMoTaiKhoan || "--")}${displayedNt.maNganHang ? " (" + esc(displayedNt.maNganHang) + ")" : ""}</div>`;
        return `
                    <tr>
                        <td>
                            <div style="display: inline-flex; align-items: center; gap: 6px; line-height: 1; vertical-align: middle;">
                                <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu" style="display: inline-flex; align-items: center; line-height: 1;"><span class="detail-code" style="margin: 0; line-height: 1;">${esc(displayedNt.maNhaThau || "")}</span></a>
                                <span style="color: var(--text-muted); font-size: 0.85rem; line-height: 1; display: inline-flex; align-items: center;">-</span>
                                ${dropdownHtml}
                            </div>
                        </td>
                        <td style="min-width: 240px; max-width: 360px;" class="fw-bold text-wrap">
                            <a href="#" data-bf-action="show-contractor" data-id="${esc(displayedNt.id)}" class="text-blue fw-bold link-hover" title="Xem chi tiết Nhà thầu">${esc(displayedNt.tenNhaThau || "")}</a>
                            ${displayedNt.tenVietTat ? `<div style="font-size:0.75rem; font-weight:normal; color:var(--text-muted); margin-top:2px;">Tên viết tắt: ${esc(displayedNt.tenVietTat)}</div>` : ""}
                        </td>
                        <td>${esc(displayedNt.maSoThue || "--")}</td>
                        <td>${rep}</td>
                        <td>${contact}</td>
                        <td>${bankAcc}</td>
                        <td class="text-right">
                            <div class="action-btn-group">
                                ${displayedNt.id === n.id ? `
                                <button class="action-btn btn-edit" data-bf-action="edit-contractor" data-id="${esc(displayedNt.id)}" title="Sửa">
                                    <i data-lucide="edit-2"></i>
                                </button>
                                <button class="action-btn btn-delete" data-bf-action="delete-contractor" data-id="${esc(displayedNt.id)}" title="Xóa">
                                    <i data-lucide="trash-2"></i>
                                </button>
                                ` : ""}
                            </div>
                        </td>
                    </tr>
                `;
      }
    }, { colSpan: 7, rowHeight: 92, onRender: () => lucide.createIcons({ root: tableBody }) });
    if (window.renderTablePagination) {
      window.renderTablePagination("nhathau-pagination", totalItems, currentPage, pageSize);
    }
  }
  lucide.createIcons({ root: tableBody });
  this.enhanceTableHeaders("nhathau-table", "nhathau");
}
export function showNhaThauDetails(id, isSwitchingVersion = false) {
  const detailPane = document.getElementById("tab-nhathau-detail");
  if (!detailPane || !detailPane.classList.contains("active")) {
    window.switchTab("nhathau-detail", id);
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
    if (isLatest) {
      editBtn.style.display = "flex";
      editBtn.onclick = () => {
        window.editNhaThau(versionId);
      };
    } else {
      editBtn.style.display = "none";
    }
  }
  const selectOptionsHtml = allRelated.map((v) => {
    const ver = String(parseInt(v.phienBan || 0)).padStart(2, "0");
    return `<option value="${v.id}" ${v.id === versionId ? "selected" : ""}>${ver}</option>`;
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
            <div class="detail-grid" style="margin-bottom: 24px;">
                <div class="detail-item">
                    <div class="detail-label">Ngày áp dụng</div>
                    <div class="detail-value fw-bold">${nt.ngayApDung ? this.model.formatDate(nt.ngayApDung) : "--"}</div>
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
                    <div class="detail-value fw-bold">${nt.tenVietTat || "--"}</div>
                </div>
            </div>

            <h5 class="detail-sub-title" style="margin-top: 24px; color: var(--primary); font-weight: 700;">Danh sách thành viên liên danh</h5>
            <div class="associated-list">
                ${members.map((m, index) => {
      const memberAddress = (m.diaChi || "").split(" | ").filter(Boolean).join(", ");
      const memberContractor = resolveContractorVersion(this.model, m);
      const memberId = escapeHtml(memberContractor?.id || "");
      const memberName = escapeHtml(memberContractor?.tenNhaThau || m.tenNhaThau || "--");
      const memberCode = escapeHtml(memberContractor?.maNhaThau || memberContractor?.maSoThue || m.maNhaThau || m.maSoThue || "--");
      const nameHtml = memberId ? `<a href="#" data-bf-action="show-contractor" data-id="${memberId}" class="text-blue link-hover">${memberName}</a>` : memberName;
      const codeHtml = memberId ? `<a href="#" data-bf-action="show-contractor" data-id="${memberId}" class="text-blue link-hover">${memberCode}</a>` : memberCode;
      return `
                        <div class="associated-item" style="flex-direction: column; align-items: flex-start; gap: 8px; padding: 16px;">
                            <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                                <strong style="font-size: 0.95rem; color: var(--text-main);">${index + 1}. ${nameHtml} ${index === 0 ? '<span class="badge badge-primary" style="margin-left: 8px; font-size: 0.7rem;">Trưởng Liên danh</span>' : ""}</strong>
                                <span class="badge badge-secondary" style="background-color: var(--primary-soft); color: var(--primary); font-weight: 600;">Mã/MST: ${codeHtml}</span>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; margin-top: 4px; font-size: 0.85rem;">
                                <div><span class="text-muted">Đại diện:</span> ${m.danhXung || "Ông"} ${m.nguoiDaiDien || "--"} (${m.chucVu || "--"})</div>
                                <div><span class="text-muted">Liên hệ:</span> SĐT: ${m.soDienThoai || "--"} | Email: ${m.email || "--"}</div>
                                <div style="grid-column: span 2;"><span class="text-muted">Tài khoản ngân hàng:</span> <strong>${m.soTaiKhoan || "--"}</strong> tại ${m.noiMoTaiKhoan || "--"} ${m.maNganHang ? "(" + m.maNganHang + ")" : ""}</div>
                                <div style="grid-column: span 2;"><span class="text-muted">Địa chỉ:</span> ${memberAddress || "--"}</div>
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
                    <div class="detail-value fw-bold">${nt.ngayApDung ? this.model.formatDate(nt.ngayApDung) : "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Loại nhà thầu</div>
                    <div class="detail-value"><span class="badge badge-secondary" style="background-color: var(--primary-light); color: var(--primary); font-weight: 600;">Độc lập</span></div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã số thuế</div>
                    <div class="detail-value fw-bold">${nt.maSoThue || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Tên viết tắt</div>
                    <div class="detail-value fw-bold">${nt.tenVietTat || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Người đại diện</div>
                    <div class="detail-value">${nt.nguoiDaiDien ? nt.danhXung + " " + nt.nguoiDaiDien : "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Chức vụ người đại diện</div>
                    <div class="detail-value">${nt.chucVuDaiDien || "--"}</div>
                </div>
                <div class="detail-item" style="grid-column: span 2;">
                    <div class="detail-label">Địa chỉ</div>
                    <div class="detail-value">${addressStr || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số điện thoại</div>
                    <div class="detail-value">${nt.soDienThoai || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Email liên hệ</div>
                    <div class="detail-value">${nt.email || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Số tài khoản</div>
                    <div class="detail-value fw-bold text-blue">${nt.soTaiKhoan || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Nơi mở tài khoản</div>
                    <div class="detail-value">${nt.noiMoTaiKhoan || "--"}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Mã ngân hàng</div>
                    <div class="detail-value">${nt.maNganHang || "--"}</div>
                </div>
            </div>
        `;
  }
  const html = `
        <div class="detail-section">
            <div class="detail-header-block" style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="detail-code" style="margin: 0; display: inline-flex; align-items: center; height: 28px; box-sizing: border-box;">${nt.maNhaThau || "--"}</span>
                        <span class="version-separator" style="color: var(--text-muted, #64748b); font-weight: 600;">-</span>
                        ${versionSelectHtml}
                    </div>
                </div>
                <h4 class="detail-title" style="margin: 0; font-size: 1.25rem; font-weight: 800; color: var(--text-main);">${nt.tenNhaThau || "Nhà thầu chưa có tên"}</h4>
            </div>
            ${detailsHtml}
            ${stampSrc ? `
              <div style="margin-top: 24px;">
                <h5 class="detail-sub-title">Ảnh dấu nhà thầu</h5>
                <div class="file-preview-container" style="display: inline-flex; max-width: 360px;">
                  <a href="${stampSrc}" target="_blank" rel="noopener noreferrer" title="Xem ảnh dấu">
                    <img src="${stampSrc}" alt="${stampFileName}" style="max-height: 180px; max-width: 320px; object-fit: contain;">
                  </a>
                  <div class="text-muted" style="font-size: 0.8rem;">${stampFileName}</div>
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
      if (window.initCustomSelect) window.initCustomSelect("fullpage-nt-version-select");
    }
    lucide.createIcons();
  }
}
