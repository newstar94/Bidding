import { escapeHtml, initCustomSelect } from "../shared/view_helpers.js";
import { loadPaginatedRecords, paginateRecords, sortRecords } from "../shared/tableDataUtils.js";
import { matchesYearMonth, populateYearMonthFilters } from "../shared/YearMonthFilter.js";
import { renderTableEmpty, renderTableError, renderTableLoading } from "../shared/EntityTable.js";
import { renderEntityActions, standardEditDeleteActions } from "../shared/EntityActions.js";
import { clearVirtualTable, renderVirtualTable } from "../shared/virtualTable.js";
import { setJvData } from "./jvDataStore.js";
import { resolveBidContractorName, resolveBidJointVentureMembers } from "../partners/contractorVersionBinding.js";
import { executeAppCommand } from "../app/commandBus.js";
import { setLotWinners } from "../shared/runtimeState.js";
import { beginWorkspaceRender } from "../shared/workspaceRenderCache.js";
import { resolvePackageResultStatus } from "./lotEvaluationScope.js";
import { showLotWinnersModal } from "./lotWinnersModal.js";
import {
  assigneeLabelsForTarget,
  formatAssigneeSummary,
} from "../shared/MultiAssigneeSelect.js";
import { parseLotListForDisplay } from "./lotJsonParser.js";

function bindLotWinnerActions(tableBody, view) {
  tableBody?.querySelectorAll('[data-bf-action="show-lot-winners"]').forEach((action) => {
    if (action.dataset.lotWinnerBound === "true") return;
    action.dataset.lotWinnerBound = "true";
    action.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showLotWinnersModal({ model: view.model, view }, action.dataset.id);
    });
  });
}

export async function renderGoiThauTable() {
  const cacheOwner = "package-list";
  beginWorkspaceRender(this.model, cacheOwner);
  const tableBody = document.getElementById("goithau-table").querySelector("tbody");
  const searchVal = document.getElementById("search-goithau").value.toLowerCase();
  const filterTrangThai = document.getElementById("filter-goithau-trangthai").value;
  const filterHinhThuc = document.getElementById("filter-goithau-hinhthuc").value;
  const yearSelect = document.getElementById("filter-goithau-nam");
  const monthSelect = document.getElementById("filter-goithau-thang");
  const allPackages = this.model.getLatestPackages();
  if (yearSelect && monthSelect) {
    populateYearMonthFilters({ records: allPackages, getDate: (gt) => gt.ngayQuyetDinh, yearSelect, monthSelect });
    initCustomSelect("filter-goithau-trangthai");
    initCustomSelect("filter-goithau-hinhthuc");
    initCustomSelect("filter-goithau-nam");
    initCustomSelect("filter-goithau-thang");
  }
  const filterNam = yearSelect ? yearSelect.value : "";
  const filterThang = monthSelect ? monthSelect.value : "";
  let slicedData = [];
  let totalItems = 0;
  const currentPage = this.model.currentPage.goithau || 1;
  const pageSize = this.model.pageSize || 10;
  const sortState = this.model.sortState.goithau || {};
  const sortBy = sortState.field || "";
  const sortOrder = sortState.order || "asc";
  if (this.model.useServerSidePagination) {
    renderTableLoading(tableBody, 8);
    try {
      const data = await loadPaginatedRecords(this.model, "goithau", {
        page: currentPage, pageSize, search: searchVal,
        trangThai: filterTrangThai, hinhThuc: filterHinhThuc,
        sortBy, sortOrder, nam: filterNam, thang: filterThang
      });
      slicedData = data.items;
      totalItems = data.totalItems;
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.error("Failed to fetch paginated packages", e);
      clearVirtualTable(tableBody);
      renderTableError(tableBody, { colspan: 8, message: "Không thể tải danh sách gói thầu. Vui lòng thử lại.", onRetry: () => this.renderGoiThauTable() });
      return;
    }
  } else {
    const latestPackages = this.model.getFilteredGoiThau();
    const filtered = latestPackages.filter((gt) => {
      const assigneeSearch = assigneeLabelsForTarget(this.model, gt.id, "goithau").join(" ").toLowerCase();
      const matchesSearch = gt.maGoiThau.toLowerCase().includes(searchVal)
        || gt.tenGoiThau.toLowerCase().includes(searchVal)
        || assigneeSearch.includes(searchVal);
      const matchesTrangThai = !filterTrangThai || resolvePackageResultStatus(gt) === filterTrangThai;
      const matchesHinhThuc = !filterHinhThuc || gt.hinhThucLuaChon === filterHinhThuc;
      return matchesSearch && matchesTrangThai && matchesHinhThuc
        && matchesYearMonth(gt.ngayQuyetDinh, filterNam, filterThang);
    });
    sortRecords(filtered, sortBy, sortOrder);
    totalItems = filtered.length;
    slicedData = paginateRecords(filtered, currentPage, pageSize);
  }
  if (totalItems === 0) {
    clearVirtualTable(tableBody);
    const pag = document.getElementById("goithau-pagination");
    renderTableEmpty(tableBody, { colspan: 8, message: "Không tìm thấy Gói thầu nào phù hợp", icon: "archive", pagination: pag });
  } else {
    const esc = escapeHtml;
    renderVirtualTable(tableBody, slicedData, (gt) => {
      const assigneeLabels = assigneeLabelsForTarget(this.model, gt.id, "goithau");
      const root = gt.rootId || gt.id;
      const allRelated = this.model.state.goithau.filter((g) => (g.rootId || g.id) === root);
      const verMap = {};
      allRelated.forEach((g) => {
        const ver = g.phienBan || "00";
        if (!verMap[ver]) {
          verMap[ver] = g;
        } else {
          const p1 = (this.model.state.kehoach || []).find((k) => String(k.id) === String(g.keHoachId));
          const p2 = (this.model.state.kehoach || []).find((k) => String(k.id) === String(verMap[ver].keHoachId));
          const v1 = p1 ? parseInt(p1.phienBan) || 0 : 0;
          const v2 = p2 ? parseInt(p2.phienBan) || 0 : 0;
          if (v1 > v2) {
            verMap[ver] = g;
          }
        }
      });
      const uniqueVersions = Object.values(verMap);
      uniqueVersions.sort((a, b) => parseInt(b.phienBan || 0) - parseInt(a.phienBan || 0));
      if (!this.model.state.selectedPackageVersion) {
        this.model.state.selectedPackageVersion = {};
      }
      // A remembered selection can outlive the row it points at, for example
      // when a plan version froze a new copy of the package or the row was
      // deleted. Falling back to the current row keeps the actions correct
      // instead of silently degrading them to view-only.
      const rememberedId = this.model.state.selectedPackageVersion[root];
      const rememberedGt = rememberedId
        ? uniqueVersions.find((version) => String(version.id) === String(rememberedId))
        : null;
      if (rememberedId && !rememberedGt) {
        delete this.model.state.selectedPackageVersion[root];
      }
      const displayedGt = rememberedGt
        || this.model.state.goithau.find((g) => String(g.id) === String(uniqueVersions[0]?.id))
        || gt;
      const displayedStatus = resolvePackageResultStatus(displayedGt);
      const kh = this.model.getLatestPlan(displayedGt.keHoachId);
      const nt = displayedGt.nhaThauTrungThauId ? this.model.state.nhathau.find((n) => n.id === displayedGt.nhaThauTrungThauId) : null;
      const matchBid = displayedGt.nhaThauTrungThauId ? this.model.state.thongtinmothau.find((b) => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(displayedGt.nhaThauTrungThauId)) : null;
      const ntDisplayName = matchBid ? resolveBidContractorName(this.model, matchBid) : nt ? nt.tenNhaThau : "--";
      const isWinnerJV = matchBid && matchBid.loaiNhaThau === "Liên danh";
      let ntLink;
      if (isWinnerJV) {
        const allJvMembers = resolveBidJointVentureMembers(this.model, matchBid);
        const leadMember = allJvMembers.find((m) => m.vaiTro === "Đứng đầu liên danh");
        const leadName = leadMember?.tenNhaThau || ntDisplayName;
        const leadCode = leadMember?.maSoThue || nt?.maSoThue || nt?.maNhaThau || matchBid.maDinhDanh || matchBid.maNhaThau || "";
        const subMembers = allJvMembers.filter((m) => m.vaiTro !== "Đứng đầu liên danh");
        setJvData(this.model, displayedGt.id, {
          members: subMembers,
          leadName,
          leadCode,
          leadContractorVersionId: leadMember?.thanhVienNhaThauId || matchBid.nhaThauId || ""
        }, { owner: cacheOwner });
        ntLink = `<a href="#" data-bf-action="show-jv" data-id="${esc(displayedGt.id)}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${esc(ntDisplayName)}</a>`;
      } else if (nt) {
        ntLink = `<a href="#" data-bf-action="show-contractor-modal" data-id="${esc(nt.id)}" class="text-blue fw-bold link-hover">${esc(ntDisplayName)}</a>`;
      } else {
        ntLink = `<span class="fw-bold text-success">${esc(ntDisplayName)}</span>`;
      }
      let winnerInfoHtml = "--";
      if (["Đã có kết quả một phần", "Đã có kết quả"].includes(displayedStatus)) {
        if (displayedGt.phanLo === "Có") {
          const plList = parseLotListForDisplay(displayedGt.phanLoList, { context: "package_table" });
          const winningLots = plList.filter((pl) => pl.nhaThauTrungThauId);
          const uniqueWinnerIds = [...new Set(winningLots.map((pl) => String(pl.nhaThauTrungThauId)).filter(Boolean))];
          if (uniqueWinnerIds.length > 1) {
            const lotWinners = winningLots.map((pl) => {
              const bidderInfo = this.model.state.thongtinmothau.find((b) => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(pl.nhaThauTrungThauId));
              const ntInfo = this.model.state.nhathau.find((n) => n.id === pl.nhaThauTrungThauId);
              const ntName = bidderInfo ? resolveBidContractorName(this.model, bidderInfo) : ntInfo ? ntInfo.tenNhaThau : "Nhà thầu #" + pl.nhaThauTrungThauId;
              const isJV = bidderInfo && bidderInfo.loaiNhaThau === "Liên danh";
              let jvData = null;
              if (isJV) {
                const allJvMembers = resolveBidJointVentureMembers(this.model, bidderInfo);
                const leadMember = allJvMembers.find((m) => m.vaiTro === "Đứng đầu liên danh");
                const leadName = leadMember?.tenNhaThau || ntName;
                const leadCode = leadMember?.maSoThue || ntInfo?.maSoThue || ntInfo?.maNhaThau || bidderInfo.maDinhDanh || bidderInfo.maNhaThau || "";
                const subMembers = allJvMembers.filter((m) => m.vaiTro !== "Đứng đầu liên danh");
                jvData = {
                  members: subMembers,
                  leadName,
                  leadCode,
                  leadContractorVersionId: leadMember?.thanhVienNhaThauId || bidderInfo.nhaThauId || ""
                };
              }
              return {
                maPhanLo: pl.maPhanLo,
                tenPhanLo: pl.tenPhanLo,
                nhaThauTrungThauId: pl.nhaThauTrungThauId,
                tenNhaThau: ntName,
                giaTrungThau: pl.giaTrungThau,
                isJV,
                jvData
              };
            });
            setLotWinners(this.model, displayedGt.id, lotWinners, { owner: cacheOwner });
            const totalGiaTrung = this.model.sumVND(winningLots.map((pl) => pl.giaTrungThau));
            winnerInfoHtml = `<button type="button" data-bf-action="show-lot-winners" data-id="${esc(displayedGt.id)}" aria-controls="modal-lot-winners" class="lot-winners-link text-blue fw-bold link-hover" title="Xem chi tiết các nhà thầu trúng thầu">Có nhiều nhà thầu trúng thầu</button><br><small class="text-muted">Tổng giá: ${this.model.formatCurrency(totalGiaTrung)}</small>`;
          } else if (uniqueWinnerIds.length === 1) {
            const singleWinnerId = uniqueWinnerIds[0];
            const singleWinnerNt = this.model.state.nhathau.find((n) => String(n.id) === String(singleWinnerId));
            const singleWinnerBid = this.model.state.thongtinmothau.find((b) => String(b.goiThauId) === String(displayedGt.id) && String(b.nhaThauId) === String(singleWinnerId));
            const name = singleWinnerBid ? resolveBidContractorName(this.model, singleWinnerBid) : singleWinnerNt ? singleWinnerNt.tenNhaThau : "Nhà thầu #" + singleWinnerId;
            const totalGiaTrung = this.model.sumVND(winningLots.map((pl) => pl.giaTrungThau));
            let link;
            if (singleWinnerBid && singleWinnerBid.loaiNhaThau === "Liên danh") {
              const allJvMembers = resolveBidJointVentureMembers(this.model, singleWinnerBid);
              const leadMember = allJvMembers.find((m) => m.vaiTro === "Đứng đầu liên danh");
              const leadName = leadMember?.tenNhaThau || name;
              const leadCode = leadMember?.maSoThue || singleWinnerNt?.maSoThue || singleWinnerNt?.maNhaThau || singleWinnerBid.maDinhDanh || singleWinnerBid.maNhaThau || "";
              const subMembers = allJvMembers.filter((m) => m.vaiTro !== "Đứng đầu liên danh");
              setJvData(this.model, displayedGt.id, {
                members: subMembers,
                leadName,
                leadCode,
                leadContractorVersionId: leadMember?.thanhVienNhaThauId || singleWinnerBid.nhaThauId || ""
              }, { owner: cacheOwner });
              link = `<a href="#" data-bf-action="show-jv" data-id="${esc(displayedGt.id)}" class="fw-bold text-success link-hover" title="Xem thành viên liên danh">👥 ${esc(name)}</a>`;
            } else if (singleWinnerNt) {
              link = `<a href="#" data-bf-action="show-contractor-modal" data-id="${esc(singleWinnerNt.id)}" class="text-blue fw-bold link-hover">${esc(name)}</a>`;
            } else {
              link = `<span class="fw-bold text-success">${esc(name)}</span>`;
            }
            winnerInfoHtml = `${link}<br><small class="text-muted">Giá: ${this.model.formatCurrency(totalGiaTrung)}</small>`;
          } else {
            winnerInfoHtml = "--";
          }
        } else {
          winnerInfoHtml = displayedGt.nhaThauTrungThauId ? ntLink + '<br><small class="text-muted">Giá: ' + this.model.formatCurrency(displayedGt.giaTrungThau) + "</small>" : "--";
        }
      } else {
        winnerInfoHtml = "--";
      }
      const optionsHtml = uniqueVersions.map((v) => {
        const label = String(parseInt(v.phienBan || 0)).padStart(2, "0");
        const isSel = v.id === displayedGt.id ? "selected" : "";
        return `<option value="${esc(v.id)}" ${isSel}>${esc(label)}</option>`;
      }).join("");
      const dropdownHtml = `
                <select class="form-control version-droplist bf-s-b41ce2ea44" data-bf-change="change-package-version" data-root="${esc(root)}" aria-label="Chọn phiên bản gói thầu ${esc(displayedGt.maGoiThau || displayedGt.tenGoiThau || "")}">
                    ${optionsHtml}
                </select>
            `;
      const isCanceledPackage = displayedStatus === "Hủy thầu";
      const isCompletedPackage = ["Đã có kết quả một phần", "Đã có kết quả"].includes(displayedStatus);
      const allowDelete = this.model.state.activerole !== "employee";
      let packageActions;
      if (displayedGt.id !== gt.id) {
        packageActions = [{ id: displayedGt.id, command: "show-package", className: "btn-view", title: "Xem chi tiết Gói thầu", icon: "eye" }];
      } else if (isCanceledPackage || isCompletedPackage) {
        packageActions = [
          isCanceledPackage && {
            id: displayedGt.id, command: "restore-package", className: "btn-restore",
            title: "Khôi phục hủy thầu", icon: "rotate-ccw", style: "color: var(--success, #10b981);"
          },
          { id: displayedGt.id, command: "view-package", className: "btn-view", title: "Xem chi tiết Gói thầu", icon: "eye" },
          allowDelete && { id: displayedGt.id, command: "delete-package", className: "btn-delete", title: "Xóa", icon: "trash-2" }
        ];
      } else {
        packageActions = standardEditDeleteActions({
          id: displayedGt.id,
          editCommand: "edit-package",
          deleteCommand: "delete-package",
          allowDelete
        });
      }
      const actionHtml = renderEntityActions(packageActions);
      return `
            <tr class="${isCanceledPackage ? "cancelled-package" : ""}">
                <td>
                    <div class="bf-s-8c8dc52ed7">
                        <a href="#" data-bf-action="show-package" data-id="${esc(displayedGt.id)}" class="text-blue fw-bold link-hover bf-s-e09f922d0d" title="Xem chi tiết Gói thầu"><span class="detail-code bf-s-dc5de304c3">${this.model.getPackageBaseCode(displayedGt.maGoiThau) ? esc(this.model.getPackageBaseCode(displayedGt.maGoiThau)) : '<span class="text-muted">(Chưa nhập)</span>'}</span></a>
                        <span class="bf-s-db1d8f859f">-</span>
                        ${dropdownHtml}
                    </div>
                </td>
                <td class="text-wrap bf-s-861d2aedee"><a href="#" data-bf-action="show-package" data-id="${esc(displayedGt.id)}" class="text-blue fw-bold link-hover">${esc(displayedGt.tenGoiThau)}</a><small class="assignee-summary"><span class="assignee-summary-full">${esc(formatAssigneeSummary(assigneeLabels))}</span><span class="assignee-summary-compact">${esc(formatAssigneeSummary(assigneeLabels, { compact: true }))}</span></small></td>
                <td class="text-wrap bf-s-861d2aedee">${kh ? '<a href="#" data-bf-action="show-plan" data-id="' + esc(kh.id) + '" class="text-blue fw-bold link-hover">' + esc(kh.tenKeHoach) + "</a>" : '<span class="text-danger">Không liên kết</span>'}</td>
                <td class="fw-bold">${this.model.formatCurrency(displayedGt.giaGoiThau)}</td>
                <td>${esc(displayedGt.hinhThucLuaChon || "--")}</td>
                <td>${this.getStatusBadge(displayedStatus)}</td>
                <td class="text-wrap bf-s-0569d2208a">${winnerInfoHtml}</td>
                <td class="text-right">
                    ${actionHtml}
                </td>
            </tr>
            `;
    }, {
      colSpan: 8,
      rowHeight: 88,
      onRender: () => {
        bindLotWinnerActions(tableBody, this);
        lucide.createIcons({ root: tableBody });
      },
    });
    executeAppCommand("renderTablePagination", "goithau-pagination", totalItems, currentPage, pageSize);
  }
  lucide.createIcons({ root: tableBody });
  this.enhanceTableHeaders("goithau-table", "goithau");
}
