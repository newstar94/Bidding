import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import {
  hasServerCapability,
  PROCUREMENT_IMPORT_CAPABILITY,
} from "../auth/serverCapabilities.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { bindCurrencyElement, debounce } from "../app/domUtils.js";
import { setFieldFeedback } from "../app/formStateUtils.js";
import { generateRecordId } from "../shared/idUtils.js";
import {
  canSaveOpeningInfo,
  getAwardRequiredFieldIds,
  isDirectOrSpecialPackage,
  isNextEvaluationStepSaved,
  validateOpeningTime
} from "./bidProcessValidation.js";
import { collectOpeningBidsFromRows, resolveOpeningLookupNames, validateOpeningJointVentureMembers, validateOpeningParticipantScopes, validateOpeningRows } from "./bidProcessOpeningData.js";
import {
  applyAutoPassedEvaluation,
  applyAwardMetadata,
  applyAwardResultToPackage,
  applyResultRowsToBids,
  getWinnerRows
} from "./bidProcessAwardResult.js";
import { renderOpeningSummary } from "./bidProcessRender.js";
import { getPartnerLookupInput } from "../partners/partnerTaxLookup.js";
import { getExactContractorVersion, resolveBidContractorName, resolveBidJointVentureMembers } from "../partners/contractorVersionBinding.js";
import { clearCompetitiveQuotationAppraisal } from "./packageAppraisal.js";
import { resolveLatestPackage, selectPackageDetailTab } from "./detail/PackageDetailState.js";
import { persistAndSync, stageLocalRecords } from "../shared/MutationService.js";
import { resolvePackageResultStatus } from "./lotEvaluationScope.js";
import {
  enrichOpeningRowsWithPartnerInfo,
  findContractorByCode,
  getJointVentureSubMembers,
  mapPartnerLookupToContractor,
  normalizeContractorLookupCode,
  refreshSavedOpeningViolationChecks,
  isViolationConfirmed,
  resolveBidOpeningContractor,
  resolveLeadMemberName,
  shouldRefreshSavedOpeningViolationCheck,
  updateOpeningViolationPresentation,
  VIOLATION_LOOKUP_FAILED,
  VIOLATION_NOT_CHECKED
} from "./openingContractorLookup.js";
import {
  resolveWorkflowActionMode,
  setWorkflowActionVisibility,
  WORKFLOW_ACTION_MODE,
} from "./workflowActionState.js";
import {
  enhanceTableRowPagination,
  paginateTableRows,
} from "../shared/TablePagination.js";
export { mapPartnerLookupToContractor, resolveOpeningLeadContractor } from "./openingContractorLookup.js";

export * from "./bidProcessTenderLifecycle.js";

export function refreshOpeningDraftPagination(owner = {}, packageId = "", options = {}) {
  const table = document.getElementById("mothau-table");
  if (table) return enhanceTableRowPagination(table, options);
  return paginateTableRows(
    owner,
    `openingDraft:${String(packageId || "unknown")}`,
    document.getElementById("mothau-table-tbody"),
    document.getElementById("mothau-table-pagination"),
  );
}

export function buildOpeningActionState({
  pkg,
  hasSavedOpeningData = false,
  isEditing = false,
  effectiveStatus = resolvePackageResultStatus(pkg),
} = {}) {
  const isNextStepSaved = isNextEvaluationStepSaved(pkg);
  const isCompleted = Boolean(
    hasSavedOpeningData
    || (
      pkg?.trangThai !== "Đang mời thầu"
      && pkg?.trangThai !== "Đã mở thầu"
      && isNextStepSaved
    ),
  );
  const isFinal = effectiveStatus === "Đã có kết quả" || effectiveStatus === "Hủy thầu";
  const actionMode = resolveWorkflowActionMode({
    isCompleted,
    isEditing,
    isNextStepSaved,
    isFinal,
  });
  return {
    actionMode,
    isCompleted,
    isEditable: actionMode === WORKFLOW_ACTION_MODE.SAVE,
    isFinal,
    isNextStepSaved,
    isReadOnly: actionMode !== WORKFLOW_ACTION_MODE.SAVE,
  };
}

export function renderMoThauPanel() {
  const select = document.getElementById("mothau-goithau-select");
  if (!select) return;
  const now = /* @__PURE__ */ new Date();
  const selectedVal = select.value;
  const targetPackages = this.model.state.goithau.filter((g) => {
    if (g.id === selectedVal) return true;
    const isDirectOrSpecial = isDirectOrSpecialPackage(g);
    if (isDirectOrSpecial) return true;
    const effectiveStatus = resolvePackageResultStatus(g);
    if (!["Đang mời thầu", "Đã mở thầu", "Đang chấm thầu", "Đã có kết quả một phần", "Đã có kết quả"].includes(effectiveStatus)) return false;
    if (effectiveStatus === "Đang mời thầu") {
      if (!g.thoiGianDongThau) return false;
      const dongThau = new Date(g.thoiGianDongThau);
      if (dongThau >= now) return false;
    }
    return true;
  });
  select.innerHTML = trustedHTML('<option value="">-- Chọn Gói thầu theo trạng thái nghiệp vụ --</option>' + targetPackages.map((g) => `<option value="${escapeHtml(g.id)}" data-search="${escapeHtml(`${g.maGoiThau || ""} ${g.tenGoiThau || ""}`)}">${escapeHtml(g.tenGoiThau)} (${escapeHtml(g.maGoiThau || "Chưa có mã")})</option>`).join(""));
  if (selectedVal && targetPackages.some((g) => g.id === selectedVal)) {
    select.value = selectedVal;
  } else {
    select.value = "";
  }
  this.makeSearchableSelect(select, "Tìm kiếm Gói thầu...");
  const summaryContainer = document.getElementById("mothau-goithau-summary");
  const bidContainer = document.getElementById("mothau-bid-container");
  const emptyState = document.getElementById("mothau-empty-state");
  const thead = document.getElementById("mothau-table-thead");
  const tbody = document.getElementById("mothau-table-tbody");
  const handlePackageSelection = () => {
    const gtId = select.value;
    if (!gtId) {
      summaryContainer.classList.add("is-hidden");
      bidContainer.classList.add("is-hidden");
      emptyState.classList.remove("is-hidden");
      return;
    }
    const gt = this.model.state.goithau.find((g) => g.id === gtId);
    if (!gt) return;
    const kh = this.model.getLatestPlan(gt.keHoachId);
    const cdt = kh ? this.model.state.chudautu.find((c) => c.id === kh.chuDauTuId) : null;
    const tenCdt = cdt ? cdt.tenChuDauTu : "Không rõ";
    const tenKhStr = kh ? kh.tenKeHoach : "Không rõ";
    const isDirectOrSpecial = isDirectOrSpecialPackage(gt);
    const isTuVan = gt.linhVuc === "Tư vấn";
    const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
    const is1G1T = gt.phuongThucLuaChon === "Một giai đoạn một túi hồ sơ";
    const hasPhanLo = gt.phanLo === "Có";
    const stepKey = is1G2T ? "opening_tech" : "opening";
    const hasSavedOpeningData = this.model.state.thongtinmothau.some((b) => String(b.goiThauId) === String(gt.id));
    const openingActionState = buildOpeningActionState({
      pkg: gt,
      hasSavedOpeningData,
      isEditing: Boolean(this.view._editingState?.[stepKey]),
    });
    const {
      actionMode,
      isEditable,
      isFinal: isLocked,
      isReadOnly,
    } = openingActionState;
    renderOpeningSummary({
      container: summaryContainer,
      gt,
      tenCdt,
      tenKhStr,
      model: this.model,
      isDirectOrSpecial,
      is1G2T,
      isEditable,
      isReadOnly,
      isLocked
    });
    if (isEditable) {
      this.view.initFlatpickr(summaryContainer);
    }
    emptyState.classList.add("is-hidden");
    bidContainer.classList.remove("is-hidden");
    const titleEl = document.getElementById("mothau-table-title");
    if (titleEl) {
      titleEl.textContent = isDirectOrSpecial ? "Danh sách Nhà thầu" : "Danh sách Nhà thầu tham dự & Nộp hồ sơ";
    }
    const addBidBtn2 = document.getElementById("btn-mothau-add-bid");
    const saveBtn2 = document.getElementById("btn-mothau-save");
    const importExcelBtnTop = document.getElementById("btn-mothau-import-excel");
    const downloadExcelBtnTop = document.getElementById("btn-mothau-download-excel");
    const importMscBtn = document.getElementById("btn-mothau-import-msc");
    if (addBidBtn2) {
      setWorkflowActionVisibility(addBidBtn2, isEditable);
      addBidBtn2.innerHTML = trustedHTML(`<i data-lucide="plus"></i> ${isDirectOrSpecial ? "Thêm nhà thầu" : "Thêm Nhà thầu nộp hồ sơ"}`);
    }
    if (importExcelBtnTop) {
      setWorkflowActionVisibility(importExcelBtnTop, isEditable);
    }
    if (downloadExcelBtnTop) {
      setWorkflowActionVisibility(downloadExcelBtnTop, isEditable);
    }
    if (importMscBtn) {
      const canImportMsc = isEditable
        && !isDirectOrSpecial
        && hasServerCapability(PROCUREMENT_IMPORT_CAPABILITY);
      setWorkflowActionVisibility(importMscBtn, canImportMsc);
      importMscBtn.onclick = canImportMsc
        ? () => this.importOpeningFromMuasamcong()
        : null;
    }
    if (saveBtn2) {
      delete saveBtn2.dataset.openingSaveBusy;
      saveBtn2.removeAttribute("aria-busy");
      setWorkflowActionVisibility(saveBtn2, actionMode !== WORKFLOW_ACTION_MODE.HIDDEN);
      if (actionMode === WORKFLOW_ACTION_MODE.HIDDEN) {
        saveBtn2.onclick = null;
      } else if (actionMode === WORKFLOW_ACTION_MODE.EDIT) {
        saveBtn2.innerHTML = trustedHTML('<i data-lucide="edit"></i> Chỉnh sửa');
        saveBtn2.className = "btn btn-primary";
        saveBtn2.onclick = () => {
          this.view._editingState = this.view._editingState || {};
          this.view._editingState[stepKey] = true;
          this.renderMoThauPanel();
        };
      } else {
        saveBtn2.innerHTML = trustedHTML(`<i data-lucide="save"></i> ${isDirectOrSpecial ? "Lưu thông tin" : "Lưu thông tin mở thầu"}`);
        saveBtn2.className = "btn btn-primary";
        saveBtn2.onclick = () => this.saveThongTinMoThau();
      }
    }
    let caseType = "1G1T_NO_LOT";
    if (isDirectOrSpecial) {
      caseType = hasPhanLo ? "DIRECT_SPECIAL_WITH_LOT" : "DIRECT_SPECIAL_NO_LOT";
    } else if (isTuVan) {
      caseType = "TU_VAN";
    } else if (!isTuVan && is1G2T) {
      caseType = hasPhanLo ? "1G2T_WITH_LOT" : "1G2T_NO_LOT";
    } else if (is1G1T) {
      caseType = hasPhanLo ? "1G1T_WITH_LOT" : "1G1T_NO_LOT";
    }
    let theadHtml = "";
    if (caseType === "TU_VAN") {
      theadHtml = `
                <tr>
                    <th class="bf-s-ad8c93e5fe">Loại nhà thầu</th>
                    <th class="package-contractor-code-column bf-s-a01153c965">Mã nhà thầu</th>
                    <th class="package-contractor-name-column bf-s-eb7671413b">Tên nhà thầu</th>
                    <th class="bf-s-ad8c93e5fe">Hiệu lực E-HSĐXKT</th>
                    <th class="bf-s-2811ee8f01">Thời gian thực hiện</th>
                    ${isEditable ? '<th class="bf-s-bcc505298c">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "1G2T_NO_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-2811ee8f01">Loại nhà thầu</th>
                    <th class="package-contractor-code-column bf-s-fa210469db">Mã nhà thầu</th>
                    <th class="package-contractor-name-column bf-s-4a13035285">Tên nhà thầu</th>
                    <th class="bf-s-2811ee8f01">Đảm bảo dự thầu</th>
                    <th class="bf-s-2811ee8f01">Hiệu lực đảm bảo</th>
                    <th class="bf-s-1e5172f548">Hiệu lực E-HSĐXKT</th>
                    ${isEditable ? '<th class="bf-s-bcc505298c">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "1G2T_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="package-lot-code-column bf-s-ae54075f01">Mã phần lô</th>
                    <th class="package-lot-name-column bf-s-ad8c93e5fe">Tên phần lô</th>
                    <th class="bf-s-ae54075f01">Loại nhà thầu</th>
                    <th class="package-contractor-code-column bf-s-ad8c93e5fe">Mã nhà thầu</th>
                    <th class="package-contractor-name-column bf-s-a01153c965">Tên nhà thầu</th>
                    <th class="bf-s-3faf34a5d2">Đảm bảo</th>
                    <th class="bf-s-3faf34a5d2">Hiệu lực ĐB</th>
                    <th class="bf-s-17cdc62f3d">Hiệu lực E-HSĐXKT</th>
                    ${isEditable ? '<th class="bf-s-e131b09644">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "1G1T_NO_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-ae54075f01">Loại nhà thầu</th>
                    <th class="package-contractor-code-column bf-s-c83ebbe56b">Mã nhà thầu</th>
                    <th class="package-contractor-name-column bf-s-a01153c965">Tên nhà thầu</th>
                    <th class="bf-s-ae54075f01">Giá dự thầu</th>
                    <th class="bf-s-b258c3e162">Tỷ lệ giảm (%)</th>
                    <th class="bf-s-17cdc62f3d">Giá sau giảm</th>
                    <th class="bf-s-3faf34a5d2">Hiệu lực E-HSDT</th>
                    <th class="bf-s-3faf34a5d2">Giá trị ĐB DT</th>
                    <th class="bf-s-415b5d64b8">Hiệu lực ĐB</th>
                    <th class="bf-s-415b5d64b8">Thời gian TH</th>
                    ${isEditable ? '<th class="bf-s-f58493ae29">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "1G1T_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="package-lot-code-column bf-s-8523765ec6">Mã phần lô</th>
                    <th class="package-lot-name-column bf-s-2811ee8f01">Tên phần lô</th>
                    <th class="bf-s-8523765ec6">Loại nhà thầu</th>
                    <th class="package-contractor-code-column bf-s-2811ee8f01">Mã nhà thầu</th>
                    <th class="package-contractor-name-column bf-s-c264699ce5">Tên nhà thầu</th>
                    <th class="bf-s-8523765ec6">Giá dự thầu</th>
                    <th class="bf-s-415b5d64b8">Tỷ lệ giảm (%)</th>
                    <th class="bf-s-ae54075f01">Giá sau giảm</th>
                    <th class="bf-s-8523765ec6">Hiệu lực E-HSDT</th>
                    <th class="bf-s-8523765ec6">Giá trị ĐB</th>
                    <th class="bf-s-415b5d64b8">Hiệu lực ĐB</th>
                    <th class="bf-s-415b5d64b8">Thời gian TH</th>
                    ${isEditable ? '<th class="bf-s-f58493ae29">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "DIRECT_SPECIAL_NO_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-2811ee8f01">Loại nhà thầu</th>
                    <th class="package-contractor-code-column bf-s-ad8c93e5fe">Mã nhà thầu</th>
                    <th class="package-contractor-name-column bf-s-4a13035285">Tên nhà thầu</th>
                    <th class="bf-s-ad8c93e5fe">Giá dự thầu</th>
                    <th class="bf-s-4a13035285">Thời gian thực hiện gói thầu</th>
                    ${isEditable ? '<th class="bf-s-bcc505298c">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "DIRECT_SPECIAL_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="package-lot-code-column bf-s-ae54075f01">Mã phần lô</th>
                    <th class="package-lot-name-column bf-s-ad8c93e5fe">Tên phần lô</th>
                    <th class="bf-s-ae54075f01">Loại nhà thầu</th>
                    <th class="package-contractor-code-column bf-s-2811ee8f01">Mã nhà thầu</th>
                    <th class="package-contractor-name-column bf-s-fa210469db">Tên nhà thầu</th>
                    <th class="bf-s-ae54075f01">Giá dự thầu</th>
                    <th class="bf-s-a01153c965">Thời gian thực hiện gói thầu</th>
                    ${isEditable ? '<th class="bf-s-59052b934c">Thao tác</th>' : ""}
                </tr>
            `;
    }
    thead.innerHTML = trustedHTML(theadHtml);
    tbody.innerHTML = trustedHTML("");
    const bids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
    bids.sort((a, b) => {
      const codeA = String(a.maPhanLo || "").toLowerCase();
      const codeB = String(b.maPhanLo || "").toLowerCase();
      return codeA.localeCompare(codeB, "vi", { numeric: true });
    });
    if (bids.length === 0) {
      if (isEditable) this.addMoThauRow(caseType, gt);
    } else {
      bids.forEach((bid) => this.addMoThauRow(caseType, gt, bid, isReadOnly));
    }
    refreshOpeningDraftPagination(this, gtId);
    lucide.createIcons();
  };
  select.onchange = handlePackageSelection;
  handlePackageSelection();
  this.setupExcelImportEvents();
  const addBidBtn = document.getElementById("btn-mothau-add-bid");
  if (addBidBtn) {
    addBidBtn.onclick = () => {
      const gtId = select.value;
      const gt = this.model.state.goithau.find((g) => g.id === gtId);
      if (!gt) return;
      if (!canSaveOpeningInfo(gt)) return;
      const isTuVan = gt.linhVuc === "Tư vấn";
      const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
      const is1G1T = gt.phuongThucLuaChon === "Một giai đoạn một túi hồ sơ";
      const hasPhanLo = gt.phanLo === "Có";
      const isDirectOrSpecial = isDirectOrSpecialPackage(gt);
      let caseType = "1G1T_NO_LOT";
      if (isDirectOrSpecial) caseType = hasPhanLo ? "DIRECT_SPECIAL_WITH_LOT" : "DIRECT_SPECIAL_NO_LOT";
      else if (isTuVan) caseType = "TU_VAN";
      else if (!isTuVan && is1G2T) caseType = hasPhanLo ? "1G2T_WITH_LOT" : "1G2T_NO_LOT";
      else if (is1G1T) caseType = hasPhanLo ? "1G1T_WITH_LOT" : "1G1T_NO_LOT";
      this.addMoThauRow(caseType, gt);
      refreshOpeningDraftPagination(this, gt.id, { showLastPage: true });
      lucide.createIcons();
    };
  }
}
export * from "./bidProcessJointVenture.js";
export function calculateOpeningDiscountedPrice(model, bidPriceValue, discountValue) {
  const price = Number(model.parseVND(bidPriceValue || ""));
  if (!Number.isFinite(price) || price <= 0) return "";
  const discountPercent = parseFloat(
    String(discountValue || "0").replace(/,/g, ".")
  ) || 0;
  return model.formatVND(price * (1 - discountPercent / 100));
}

export function buildOpeningContractorIdentity({
  value,
  className,
  contractorVersionId = "",
  violationStatus = VIOLATION_NOT_CHECKED,
} = {}) {
  const violationConfirmed = isViolationConfirmed(violationStatus);
  const violationClass = violationConfirmed ? " bidder-name--violator" : "";
  const linkColorClass = violationConfirmed ? "" : " text-blue";
  return contractorVersionId
    ? `<a href="#" data-bf-action="show-contractor" data-id="${escapeHtml(contractorVersionId)}" class="${className} link-hover${linkColorClass}${violationClass}">${value}</a>`
    : `<span class="${className}${violationClass}">${value}</span>`;
}

// eslint-disable-next-line complexity -- Legacy row orchestration is isolated for a dedicated refactor.
export function addMoThauRow(caseType, gt, bidData = {}, readOnly = false) {
  const tbody = document.getElementById("mothau-table-tbody");
  if (!tbody) return;
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", bidData.id || generateRecordId("thongtinmothau"));
  tr.dataset.contractorVersionId = bidData.nhaThauId || "";
  tr.dataset.contractorBindingSource = bidData.nhaThauId ? "saved" : "";
  let ntCode = bidData.maDinhDanh || bidData.maNhaThau || "";
  let ntName = resolveBidContractorName(this.model, bidData) || "";
  let ntType = bidData.loaiNhaThau || "Độc lập";
  let jvMembers = resolveBidJointVentureMembers(this.model, bidData);
  const latestNhaThauList = this.model.getLatestNhaThau();
  let foundNt = getExactContractorVersion(this.model, bidData.nhaThauId);
  if (!bidData.nhaThauId && !foundNt && ntCode) {
    foundNt = findContractorByCode(latestNhaThauList, ntCode);
  }
  if (foundNt) {
    if (!ntCode) ntCode = foundNt.maNhaThau || "";
    if (ntType !== "Liên danh") {
      ntName = foundNt.tenNhaThau || bidData.tenNhaThau || "";
    }
    if (bidData.loaiNhaThau === void 0 && foundNt.loaiNhaThau) {
      ntType = foundNt.loaiNhaThau;
    }
    if (jvMembers.length === 0 && foundNt.thanhVienLienDanh) {
      jvMembers = foundNt.thanhVienLienDanh;
    }
  }
  tr._thanhVienLienDanh = getJointVentureSubMembers(jvMembers || [], ntCode);
  const leadM = (jvMembers || []).find((m) => {
    const role = String(m.vaiTro || "").trim().toLowerCase();
    return role.includes("đứng") && role.includes("đầu") || (m.maNhaThau || m.maSoThue) && normalizeContractorLookupCode(m.maNhaThau || m.maSoThue) === normalizeContractorLookupCode(ntCode);
  });
  tr._leadMemberName = leadM ? leadM.tenNhaThau : "";
  tr._leadMemberId = leadM?.id || "";
  tr._violationStatus = bidData.violationStatus || VIOLATION_NOT_CHECKED;
  tr._leadMemberViolationStatus = leadM?.violationStatus || "";
  tr._leadMemberContractorId = leadM?.thanhVienNhaThauId || foundNt?.id || "";
  tr._leadMemberCode = normalizeContractorLookupCode(ntCode);
  if (!tr._leadMemberName && ntCode) {
    const foundLeadNt = findContractorByCode(latestNhaThauList, ntCode);
    if (foundLeadNt) {
      tr._leadMemberName = resolveLeadMemberName(foundLeadNt, ntCode);
    }
  }
  const typeSelectHtml = readOnly ? `<span class="bf-s-0e55741611">${escapeHtml(ntType)}</span>` : `<select class="form-control mt-loai-nha-thau" required>
            <option value="Độc lập" ${ntType === "Độc lập" ? "selected" : ""}>Độc lập</option>
            <option value="Liên danh" ${ntType === "Liên danh" ? "selected" : ""}>Liên danh</option>
        </select>`;
  const lotList = gt.phanLoList || [];
  const lotOptions = lotList.map((l) => `<option value="${escapeHtml(l.maPhanLo)}" data-name="${escapeHtml(l.tenPhanLo)}">${escapeHtml(l.maPhanLo)}</option>`).join("");
  const contractorCodeDisplay = escapeHtml(ntCode || bidData.maDinhDanh || "--");
  const contractorCodeValue = escapeHtml(ntCode || bidData.maDinhDanh || "");
  const contractorNameDisplay = escapeHtml(ntName || "--");
  const contractorNameValue = escapeHtml(ntName);
  const contractorVersionId = foundNt?.id || bidData.nhaThauId || "";
  const readOnlyContractorIdentity = (value, className) => buildOpeningContractorIdentity({
    value,
    className,
    contractorVersionId,
    violationStatus: tr._violationStatus,
  });
  const lotCodeDisplay = escapeHtml(bidData.maPhanLo || "--");
  const lotNameDisplay = escapeHtml(bidData.tenPhanLo || "--");
  const lotNameValue = escapeHtml(bidData.tenPhanLo || "");
  let cellHtml = "";
  const jvBtnCount = tr._thanhVienLienDanh.length;
  const jvDetailsHtml = readOnly ? ntType === "Liên danh" ? `<div class="bf-s-7dd018fd26"><a href="#" class="mt-jv-view-link bf-s-95a6b7be8c">👥 Liên danh ${jvBtnCount} thành viên</a></div>` : "" : `<div class="mt-jv-members-container">
            <button type="button" class="btn btn-outline btn-xs mt-btn-manage-members bf-s-32804fa5c4">
                <i data-lucide="users" class="bf-s-38e6fd7439"></i>
                <span class="mt-jv-btn-text">Thành viên liên danh (${jvBtnCount})</span>
            </button>
        </div>`;
  if (caseType === "TU_VAN") {
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td>${readOnlyContractorIdentity(contractorCodeDisplay, "mt-ma-nha-thau")}</td>
            <td>${readOnlyContractorIdentity(contractorNameDisplay, "mt-ten-nha-thau")}${jvDetailsHtml}</td>
            <td>${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}</td>
            <td>${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "--")}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "")}" required placeholder="Ví dụ: 120 ngày"></td>
            <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete mt-remove-row" aria-label="Xóa nhà thầu khỏi danh sách"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G2T_NO_LOT") {
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td>${readOnlyContractorIdentity(contractorCodeDisplay, "mt-ma-nha-thau")}</td>
            <td>${readOnlyContractorIdentity(contractorNameDisplay, "mt-ten-nha-thau")}${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || this.model.formatVND(gt.giaTriDamBaoDuThau) || "--"}</td>
            <td>${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}</td>
            <td>${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || this.model.formatVND(gt.giaTriDamBaoDuThau) || ""}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" placeholder="Hiệu lực bảo đảm"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiệu lực"></td>
            <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete mt-remove-row" aria-label="Xóa nhà thầu khỏi danh sách"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G2T_WITH_LOT") {
    cellHtml = readOnly ? `
            <td style="min-width: 11rem">${lotCodeDisplay}</td>
            <td class="package-lot-name-cell">${lotNameDisplay}</td>
            <td>${typeSelectHtml}</td>
            <td>${readOnlyContractorIdentity(contractorCodeDisplay, "mt-ma-nha-thau")}</td>
            <td>${readOnlyContractorIdentity(contractorNameDisplay, "mt-ten-nha-thau")}${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || "--"}</td>
            <td>${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}</td>
            <td>${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td class="package-lot-name-cell"><input type="text" class="form-control mt-ten-phan-lo" value="${lotNameValue}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || ""}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" placeholder="Hiệu lực ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiệu lực"></td>
            <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete mt-remove-row" aria-label="Xóa nhà thầu khỏi danh sách"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G1T_NO_LOT") {
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td>${readOnlyContractorIdentity(contractorCodeDisplay, "mt-ma-nha-thau")}</td>
            <td>${readOnlyContractorIdentity(contractorNameDisplay, "mt-ten-nha-thau")}${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || "--"}</td>
            <td class="bf-s-5f326564a5">${(bidData.tyLeGiamGia || 0).toString().replace(".", ",")}</td>
            <td>${this.model.formatVND(bidData.giaSauGiamGia) || "--"}</td>
            <td>${bidData.hieuLucHsdt || gt.hieuLucHsdt || 90 ? (bidData.hieuLucHsdt || gt.hieuLucHsdt || 90) + " ngày" : "--"}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || this.model.formatVND(gt.giaTriDamBaoDuThau) || "--"}</td>
            <td class="bf-s-5f326564a5">${bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120 ? (bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120) + " ngày" : "--"}</td>
            <td>${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "--")}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || ""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia bf-s-8b424f074a" value="${(bidData.tyLeGiamGia || 0).toString().replace(".", ",")}" required placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd bf-s-d4486f7f3a" value="${this.model.formatVND(bidData.giaSauGiamGia) || ""}" readonly></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiực lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || this.model.formatVND(gt.giaTriDamBaoDuThau) || ""}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay bf-s-8b424f074a" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" required></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "")}" required placeholder="Thực hiện"></td>
            <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete mt-remove-row" aria-label="Xóa nhà thầu khỏi danh sách"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G1T_WITH_LOT") {
    cellHtml = readOnly ? `
            <td style="min-width: 11rem">${lotCodeDisplay}</td>
            <td class="package-lot-name-cell">${lotNameDisplay}</td>
            <td>${typeSelectHtml}</td>
            <td>${readOnlyContractorIdentity(contractorCodeDisplay, "mt-ma-nha-thau")}</td>
            <td>${readOnlyContractorIdentity(contractorNameDisplay, "mt-ten-nha-thau")}${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || "--"}</td>
            <td class="bf-s-5f326564a5">${(bidData.tyLeGiamGia || 0).toString().replace(".", ",")}</td>
            <td>${this.model.formatVND(bidData.giaSauGiamGia) || "--"}</td>
            <td>${bidData.hieuLucHsdt || gt.hieuLucHsdt || 90 ? (bidData.hieuLucHsdt || gt.hieuLucHsdt || 90) + " ngày" : "--"}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || "--"}</td>
            <td class="bf-s-5f326564a5">${bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120 ? (bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120) + " ngày" : "--"}</td>
            <td>${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "--")}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td class="package-lot-name-cell"><input type="text" class="form-control mt-ten-phan-lo" value="${lotNameValue}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || ""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia bf-s-8b424f074a" value="${(bidData.tyLeGiamGia || 0).toString().replace(".", ",")}" required placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd bf-s-d4486f7f3a" value="${this.model.formatVND(bidData.giaSauGiamGia) || ""}" readonly></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || ""}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay bf-s-8b424f074a" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" required></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "")}" required placeholder="Thực hiện"></td>
            <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete mt-remove-row" aria-label="Xóa nhà thầu khỏi danh sách"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "DIRECT_SPECIAL_NO_LOT") {
    const defaultDurationPkg = bidData.thoiGianThucHien || gt.thoiGianThucHien || "";
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td>${readOnlyContractorIdentity(contractorCodeDisplay, "mt-ma-nha-thau")}</td>
            <td>${readOnlyContractorIdentity(contractorNameDisplay, "mt-ten-nha-thau")}${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || "--"}</td>
            <td>${escapeHtml(defaultDurationPkg)}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || ""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(defaultDurationPkg)}" required placeholder="Thời gian gói"></td>
            <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete mt-remove-row" aria-label="Xóa nhà thầu khỏi danh sách"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "DIRECT_SPECIAL_WITH_LOT") {
    const defaultDurationPkg = bidData.thoiGianThucHien || gt.thoiGianThucHien || "";
    cellHtml = readOnly ? `
            <td style="min-width: 11rem">${lotCodeDisplay}</td>
            <td class="package-lot-name-cell">${lotNameDisplay}</td>
            <td>${typeSelectHtml}</td>
            <td>${readOnlyContractorIdentity(contractorCodeDisplay, "mt-ma-nha-thau")}</td>
            <td>${readOnlyContractorIdentity(contractorNameDisplay, "mt-ten-nha-thau")}${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || "--"}</td>
            <td>${escapeHtml(defaultDurationPkg)}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td class="package-lot-name-cell"><input type="text" class="form-control mt-ten-phan-lo" value="${lotNameValue}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || ""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(defaultDurationPkg)}" required placeholder="Thời gian gói"></td>
            <td class="bf-s-63dbf5319a"><button type="button" class="action-btn btn-delete mt-remove-row" aria-label="Xóa nhà thầu khỏi danh sách"><i data-lucide="trash-2"></i></button></td>
        `;
  }
  tr.innerHTML = trustedHTML(cellHtml);
  updateOpeningViolationPresentation(tr);
  const rowLotSelect = tr.querySelector(".mt-ma-phan-lo");
  if (rowLotSelect) {
    if (bidData.maPhanLo) rowLotSelect.value = bidData.maPhanLo;
    const syncSelectedLot = () => {
      const selectedOpt = rowLotSelect.options[rowLotSelect.selectedIndex];
      const nameInput = tr.querySelector(".mt-ten-phan-lo");
      if (nameInput) {
        nameInput.value = selectedOpt ? selectedOpt.getAttribute("data-name") || "" : "";
      }
    };
    rowLotSelect.addEventListener("change", syncSelectedLot);
    syncSelectedLot();
  }
  const selectLoai = tr.querySelector(".mt-loai-nha-thau");
  const jvContainer = tr.querySelector(".mt-jv-members-container");
  if (selectLoai && jvContainer) {
    setRuntimeStyle(jvContainer, "marginTop", "4px");
    setRuntimeStyle(jvContainer, "display", ntType === "Liên danh" ? "block" : "none");
    selectLoai.addEventListener("change", () => {
      setRuntimeStyle(jvContainer, "display", selectLoai.value === "Liên danh" ? "block" : "none");
    });
  }
  const btnManage = tr.querySelector(".mt-btn-manage-members");
  if (btnManage) {
    btnManage.addEventListener("click", (e) => {
      e.preventDefault();
      this.openMoThauJVManager(tr);
    });
  }
  const inputMa = tr.querySelector(".mt-ma-nha-thau");
  const inputTen = tr.querySelector(".mt-ten-nha-thau");
  if (inputMa && inputTen) {
    let lookupRequestId = 0;
    let lookupController = null;
    const runRemoteLookup = async (code) => {
      const lookupInput = getPartnerLookupInput(code);
      if (!lookupInput || !tr.isConnected || inputMa.value.trim() !== code) return;
      const requestId = ++lookupRequestId;
      lookupController?.abort();
      const currentController = new AbortController();
      lookupController = currentController;
      try {
        setRuntimeStyle(inputMa, "opacity", "0.7");
        const data = await resolveBidOpeningContractor({
          packageId: gt.id,
          contractorIdentifier: code,
          lotId: tr.querySelector(".mt-ma-phan-lo")?.selectedOptions?.[0]?.dataset?.lotId || null,
          bidOpeningRecordId: tr.getAttribute("data-id"),
          signal: currentController.signal
        });
        if (requestId !== lookupRequestId || !tr.isConnected || inputMa.value.trim() !== code) return;
        tr._leadMemberViolationStatus = data?.violationStatus || VIOLATION_LOOKUP_FAILED;
        if (tr.querySelector(".mt-loai-nha-thau")?.value !== "Liên danh") {
          tr._violationStatus = tr._leadMemberViolationStatus;
        }
        updateOpeningViolationPresentation(tr);
        if (data?.contractor?.name) {
          const lookupData = await mapPartnerLookupToContractor(code, {
            name: data.contractor.name,
            org_code: data.contractor.identifier,
            tax_code: data.contractor.taxCode
          });
          if (requestId !== lookupRequestId || !tr.isConnected || inputMa.value.trim() !== code) return;
          tr._leadMemberLookupData = lookupData;
          tr._leadMemberContractorId = "";
          tr.dataset.contractorVersionId = "";
          tr.dataset.contractorBindingSource = "";
          tr._leadMemberCode = normalizeContractorLookupCode(inputMa.value);
          const names = resolveOpeningLookupNames(
            tr.querySelector(".mt-loai-nha-thau")?.value,
            inputTen.value,
            data.contractor.name,
            tr._leadMemberName
          );
          inputTen.value = names.bidName;
          tr._leadMemberName = names.leadMemberName;
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error("Contractor risk lookup during bid opening failed: ", err);
          tr._leadMemberViolationStatus = VIOLATION_LOOKUP_FAILED;
          tr._violationStatus = VIOLATION_LOOKUP_FAILED;
          updateOpeningViolationPresentation(tr);
        }
      } finally {
        if (requestId === lookupRequestId) {
          setRuntimeStyle(inputMa, "opacity", "1");
          if (lookupController === currentController) lookupController = null;
        }
      }
    };
    const scheduleRemoteLookup = debounce((code) => {
      runRemoteLookup(code);
    }, 450);
    const handleCodeChange = () => {
      const code = inputMa.value.trim();
      lookupRequestId++;
      const normalizedCode = normalizeContractorLookupCode(code);
      if (normalizedCode !== tr._leadMemberCode) {
        lookupController?.abort();
        tr._leadMemberName = "";
        tr._leadMemberLookupData = null;
        tr._leadMemberContractorId = "";
        tr.dataset.contractorVersionId = "";
        tr.dataset.contractorBindingSource = "";
        tr._leadMemberCode = normalizedCode;
        tr._leadMemberViolationStatus = VIOLATION_NOT_CHECKED;
        tr._violationStatus = VIOLATION_NOT_CHECKED;
        updateOpeningViolationPresentation(tr);
      }
      if (!code) {
        setRuntimeStyle(inputMa, "opacity", "1");
        return;
      }
      const latestList = this.model.getLatestNhaThau();
      const matched = findContractorByCode(latestList, code);
      if (matched) {
        tr._leadMemberContractorId = matched.id || "";
        tr.dataset.contractorVersionId = matched.id || "";
        tr.dataset.contractorBindingSource = matched.id ? "lookup" : "";
        tr._leadMemberLookupData = matched;
        const names = resolveOpeningLookupNames(
          tr.querySelector(".mt-loai-nha-thau")?.value,
          inputTen.value,
          matched.tenNhaThau,
          tr._leadMemberName
        );
        inputTen.value = names.bidName;
        tr._leadMemberName = names.leadMemberName;
        scheduleRemoteLookup(code);
        return;
      }
      scheduleRemoteLookup(code);
    };
    inputMa.addEventListener("input", handleCodeChange);
    inputMa.addEventListener("blur", () => scheduleRemoteLookup.flush());
    inputMa.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        scheduleRemoteLookup.flush();
      }
    });
  }
  const inputPkgDuration = tr.querySelector(".mt-thoi-gian-thuc-hien");
  const inputCtrDuration = tr.querySelector(".mt-thoi-gian-thuc-hien-hop-dong");
  if (inputPkgDuration && inputCtrDuration) {
    inputPkgDuration.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      inputCtrDuration.value = val ? val + " + Thời gian thực hiện các nghĩa vụ theo hợp đồng" : "";
    });
  }
  tr.querySelectorAll(".mt-hieu-luc-hsdt, .mt-hieu-luc-hsdxt, .mt-hieu-luc-dam-bao, .mt-hieu-luc-bao-dam-ngay").forEach((input) => {
    input.addEventListener("focus", () => {
      let val = input.value.trim();
      if (val) {
        const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num)) input.value = num;
      }
    });
    input.addEventListener("blur", () => {
      let val = input.value.trim();
      if (val) {
        const num = parseInt(val.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num)) {
          input.value = num + " ngày";
        }
      }
    });
  });
  tr.querySelectorAll(".mt-format-vnd").forEach((input) => {
    bindCurrencyElement(input, (value) => this.model.formatVND(value));
  });
  const recalculateDiscountPrice = () => {
    const inputGia2 = tr.querySelector(".mt-gia-du-thau");
    const inputTyLe2 = tr.querySelector(".mt-ty-le-giam-gia");
    const inputSauGiam = tr.querySelector(".mt-gia-sau-giam-gia");
    if (inputGia2 && inputTyLe2 && inputSauGiam) {
      inputSauGiam.value = calculateOpeningDiscountedPrice(
        this.model,
        inputGia2.value,
        inputTyLe2.value,
      );
    }
  };
  const inputGia = tr.querySelector(".mt-gia-du-thau");
  const inputTyLe = tr.querySelector(".mt-ty-le-giam-gia");
  if (inputGia) inputGia.addEventListener("input", recalculateDiscountPrice);
  if (inputTyLe) {
    inputTyLe.addEventListener("input", (e) => {
      let val = e.target.value.replace(/\./g, ",");
      const parts = val.split(",");
      if (parts.length > 2) {
        val = parts[0] + "," + parts.slice(1).join("").replace(/,/g, "");
      }
      val = val.replace(/[^0-9,]/g, "");
      if (e.target.value !== val) {
        const cursorPosition = e.target.selectionStart;
        e.target.value = val;
        e.target.setSelectionRange(cursorPosition, cursorPosition);
      }
      recalculateDiscountPrice();
    });
    inputTyLe.addEventListener("change", recalculateDiscountPrice);
  }
  recalculateDiscountPrice();
  const removeBtn = tr.querySelector(".mt-remove-row");
  if (removeBtn) {
    removeBtn.onclick = async () => {
      const confirmed = await this.view.customConfirm("Xác nhận xóa", "Bạn có chắc chắn muốn gỡ nhà thầu này khỏi danh sách nộp hồ sơ?", "trash-2");
      if (confirmed) {
        tr.remove();
        if (tbody.children.length === 0) {
          this.addMoThauRow(caseType, gt);
          lucide.createIcons();
        }
        refreshOpeningDraftPagination(this, gt.id);
      }
    };
  }
  tbody.appendChild(tr);
  const jvViewLink = tr.querySelector(".mt-jv-view-link");
  if (jvViewLink) {
    jvViewLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.openMoThauJVViewModal(tr._thanhVienLienDanh || [], tr._leadMemberName || ntName, ntCode, tr._leadMemberContractorId || "", tr._leadMemberViolationStatus || "");
    });
  }
  if (typeof this.unifyTableInputsHeight === "function") {
    this.unifyTableInputsHeight(document);
  }
  if (
    shouldRefreshSavedOpeningViolationCheck(bidData, ntCode)
  ) {
    refreshSavedOpeningViolationChecks(gt.id, [bidData]).then(() => {
      tr._violationStatus = bidData.violationStatus || VIOLATION_NOT_CHECKED;
      if (String(bidData.loaiNhaThau || "").trim() === "Liên danh") {
        const refreshedLead = (bidData.thanhVienLienDanh || []).find((member) => {
          const role = String(member?.vaiTro || "").toLocaleLowerCase("vi-VN");
          return role.includes("đứng") && role.includes("đầu")
            || normalizeContractorLookupCode(member?.maNhaThau || member?.maSoThue) === normalizeContractorLookupCode(ntCode);
        });
        tr._leadMemberViolationStatus = refreshedLead?.violationStatus || VIOLATION_NOT_CHECKED;
      }
      updateOpeningViolationPresentation(tr);
    }).catch((error) => {
      console.error("Stale bid-opening violation refresh failed:", error);
      tr._violationStatus = VIOLATION_LOOKUP_FAILED;
      updateOpeningViolationPresentation(tr);
    });
  }
}
async function performSaveThongTinMoThau() {
  const select = document.getElementById("mothau-goithau-select");
  if (!select) return;
  let gtId = select.value;
  if (!gtId) {
    await this.view.customAlert("Chưa chọn gói thầu", "Vui lòng chọn một gói thầu để lưu!", "alert-triangle", select);
    return;
  }
  const requestedPackage = this.model.state.goithau.find((g) => g.id === gtId);
  const gt = resolveLatestPackage(this.model, requestedPackage || gtId);
  if (!gt) return;
  gtId = gt.id;
  const is1G2T = gt.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const isDirectOrSpecial = isDirectOrSpecialPackage(gt);
  const isAllowedToSave = canSaveOpeningInfo(gt);
  if (!isAllowedToSave) {
    await this.view.customAlert(
      "Không thể lưu",
      `Không thể chỉnh sửa biên bản mở thầu của gói thầu này vì trạng thái hiện tại là "${gt.trangThai}" và giai đoạn tiếp theo đã hoàn tất.`,
      "x-circle"
    );
    return;
  }
  if (isDirectOrSpecial) {
    if (!gt.thoiGianMoThau) {
      gt.thoiGianMoThau = this.model.getCurrentDateTimeString();
    }
    if (!gt.thoiGianDongThau) {
      gt.thoiGianDongThau = gt.thoiGianMoThau;
    }
  } else {
    const inputOpTime = document.getElementById("op-thoigianmothau");
    if (inputOpTime && inputOpTime.value) {
      gt.thoiGianMoThau = this.model.convertDMYHMSToYMDHMS(inputOpTime.value);
    } else if (!gt.thoiGianMoThau) {
      gt.thoiGianMoThau = this.model.getCurrentDateTimeString();
    }
  }
  const openingTimeValidation = validateOpeningTime(gt, (value) => this.model.formatDateWithTime(value));
  if (!openingTimeValidation.valid) {
    const inputOpTime = document.getElementById("op-thoigianmothau");
    const errorEl = document.getElementById("op-thoigianmothau-error");
    if (errorEl) {
      errorEl.textContent = openingTimeValidation.message;
      setRuntimeStyle(errorEl, "display", "block");
      if (inputOpTime) {
        setRuntimeStyle(inputOpTime, "borderColor", "var(--danger)");
        const clearError = () => {
          setRuntimeStyle(errorEl, "display", "none");
          setRuntimeStyle(inputOpTime, "borderColor", "");
        };
        inputOpTime.addEventListener("input", clearError, { once: true });
        inputOpTime.addEventListener("change", clearError, { once: true });
      }
    }
    return;
  }
  const rows = document.querySelectorAll("#mothau-table-tbody tr");
  await enrichOpeningRowsWithPartnerInfo(rows, this.model);
  const openingRowsValidation = validateOpeningRows(rows);
  if (!openingRowsValidation.valid) {
    const message = openingRowsValidation.missingBidPriceInputs?.length
      ? "Vui lòng nhập Giá dự thầu lớn hơn 0 cho tất cả các dòng!"
      : "Vui lòng nhập đầy đủ Mã nhà thầu và Tên nhà thầu cho tất cả các dòng!";
    await this.view.customAlert("Thiếu dữ liệu", message, "alert-triangle", [
      ...openingRowsValidation.invalidInputs,
      ...(openingRowsValidation.missingBidPriceInputs || []),
    ]);
    return;
  }
  const jvRowsValidation = validateOpeningJointVentureMembers(rows);
  if (!jvRowsValidation.valid) {
    await this.view.customAlert("Trùng mã số thuế", "Các thành viên liên danh không được trùng mã số thuế hoặc mã nhà thầu. Vui lòng mở danh sách thành viên liên danh để kiểm tra lại!", "alert-triangle", jvRowsValidation.invalidInputs);
    return;
  }
  const changedContractors = [];
  const tempBids = collectOpeningBidsFromRows({
    rows,
    gtId,
    model: this.model,
    isDirectOrSpecial,
    changedContractors,
  });
  const participantValidation = validateOpeningParticipantScopes(tempBids, this.model.state.nhathau);
  if (!participantValidation.valid) {
    const lotLabel = participantValidation.lotScope === "__PACKAGE__"
      ? "gói thầu"
      : `phần lô ${participantValidation.bid?.maPhanLo || ""}`;
    await this.view.customAlert(
      "Nhà thầu tham dự bị trùng",
      `Một nhà thầu chỉ được xuất hiện một lần trong biên bản mở thầu của cùng ${lotLabel}, kể cả khi tham dự qua liên danh khác.`,
      "alert-triangle"
    );
    return;
  }
  const previousBids = this.model.state.thongtinmothau.filter(
    (bid) => String(bid.goiThauId) === String(gtId),
  );
  const nextBidIds = new Set(tempBids.map((bid) => String(bid.id)));
  const deletedBids = previousBids.filter((bid) => !nextBidIds.has(String(bid.id)));
  this.model.replaceTableState(
    "thongtinmothau",
    this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) !== String(gtId)),
  );
  this.model.state.thongtinmothau.push(...tempBids);
  gt.trangThai = "Đang chấm thầu";
  const stepKey = is1G2T ? "opening_tech" : "opening";
  if (this.view._editingState) {
    this.view._editingState[stepKey] = false;
  }
  stageLocalRecords(this.model, "thongtinmothau", tempBids);
  stageLocalRecords(this.model, "goithau", gt);
  const uniqueContractors = [...new Map(
    changedContractors.map((contractor) => [String(contractor.id), contractor]),
  ).values()];
  stageLocalRecords(this.model, "nhathau", uniqueContractors);
  if (deletedBids.length > 0) this.model.markDeleted("thongtinmothau", deletedBids);
  const openingChanges = {
    upserts: {
      thongtinmothau: tempBids,
      goithau: [gt],
      ...(uniqueContractors.length > 0 ? { nhathau: uniqueContractors } : {}),
    },
    deletions: deletedBids.length > 0 ? { thongtinmothau: deletedBids } : {},
  };
  const syncResult = await persistAndSync(
    this,
    ["thongtinmothau", "goithau", ...(uniqueContractors.length > 0 ? ["nhathau"] : [])],
    { changes: openingChanges },
  );
  if (!syncResult?.ok) {
    await this.view.customAlert(
      "Không thể lưu thông tin mở thầu",
      syncResult?.message || "Dữ liệu chưa được lưu. Vui lòng kiểm tra kết nối và thử lại.",
      "x-circle"
    );
    return;
  }
  await refreshSavedOpeningViolationChecks(gtId, tempBids);
  this.view.renderGoiThauTable();
  const successMsg = isDirectOrSpecial ? "Đã lưu thành công dữ liệu nhà thầu" : `Đã lưu toàn bộ thông tin mở thầu (E-HSDT / E-HSĐXKT) của gói thầu "${gt.tenGoiThau}" thành công! Trạng thái gói thầu đã được chuyển sang Đang chấm thầu.`;
  this.renderMoThauPanel();
  const detailPane = document.getElementById("tab-goithau-detail");
  if (detailPane && detailPane.classList.contains("active")) {
    const detailPackageId = selectPackageDetailTab(
      this.view,
      isDirectOrSpecial ? "result" : "eval_tech",
      gt,
      this.model
    );
    await this.view.showPackageDetails(detailPackageId);
  }
  await this.view.customAlert("Lưu thành công", successMsg, "check-circle");
}

export async function saveThongTinMoThau() {
  const saveButton = document.getElementById("btn-mothau-save");
  if (saveButton?.dataset.openingSaveBusy === "1") return;
  const originalLabel = saveButton?.textContent?.trim() || "Lưu thông tin mở thầu";
  if (saveButton) {
    saveButton.dataset.openingSaveBusy = "1";
    saveButton.disabled = true;
    saveButton.setAttribute("aria-busy", "true");
    saveButton.textContent = "Đang lưu...";
  }
  try {
    await performSaveThongTinMoThau.call(this);
  } catch (error) {
    console.error("Saving bid opening information failed:", error);
    await this.view.customAlert(
      "Không thể lưu thông tin mở thầu",
      "Ứng dụng gặp lỗi khi lưu dữ liệu. Vui lòng kiểm tra thông tin và thử lại.",
      "x-circle"
    );
  } finally {
    if (saveButton?.dataset.openingSaveBusy === "1") {
      delete saveButton.dataset.openingSaveBusy;
      saveButton.disabled = false;
      saveButton.removeAttribute("aria-busy");
      saveButton.textContent = originalLabel;
    }
  }
}
export async function saveKetQuaChiDinhThau(gtId) {
  const gt = this.model.state.goithau.find((g) => g.id === gtId);
  if (!gt) return;
  const snapshotGt = JSON.parse(JSON.stringify(gt));
  const snapshotBids = JSON.parse(JSON.stringify(
    this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId))
  ));
  const decNo = document.getElementById("award-decision-no")?.value.trim() || "";
  const decDateRaw = document.getElementById("award-decision-date")?.value || "";
  const decDate = this.model.convertDMYToYMD(decDateRaw);
  const soBctdVal = document.getElementById("award-so-bctd")?.value.trim() || "";
  const ngayBctdRaw = document.getElementById("award-ngay-bctd")?.value || "";
  const ngayBctdVal = this.model.convertDMYToYMD(ngayBctdRaw);
  const isDirectOrSpecial = isDirectOrSpecialPackage(gt);
  let danhGiaNangLucVal = "Không";
  let dateYcbgiRaw = "";
  let dateGbgiRaw = "";
  let dateBcdgRaw = "";
  let dateMttRaw = "";
  let dateTtRaw = "";
  let dateTkqRaw = "";
  if (isDirectOrSpecial) {
    const radChecked = document.querySelector('input[name="result-danh-gia-nang-luc"]:checked');
    if (radChecked) danhGiaNangLucVal = radChecked.value;
    dateYcbgiRaw = document.getElementById("date-yeu-cau-bao-gia")?.value || "";
    dateGbgiRaw = document.getElementById("date-gui-bao-gia")?.value || "";
    if (danhGiaNangLucVal === "Có") {
      dateBcdgRaw = document.getElementById("date-bao-cao-danh-gia")?.value || "";
    }
    dateMttRaw = document.getElementById("date-moi-thuong-thao")?.value || "";
    dateTtRaw = document.getElementById("date-thuong-thao")?.value || "";
    dateTkqRaw = document.getElementById("date-trinh-ket-qua")?.value || "";
  }
  let hasError = false;
  const errorInputs = [];
  const validateField = (elId, val) => {
    const el = document.getElementById(elId);
    if (!val && el) {
      hasError = true;
      errorInputs.push(el);
      const errorText = el.closest(".form-group")?.querySelector(".error-text")?.textContent || "";
      setFieldFeedback(el, { state: "invalid", message: errorText });
      const clear = () => {
        setFieldFeedback(el);
      };
      el.addEventListener("input", clear, { once: true });
      el.addEventListener("change", clear, { once: true });
    }
  };
  const requiredAwardValues = {
    "award-decision-no": decNo,
    "award-decision-date": decDateRaw,
    "award-so-bctd": soBctdVal,
    "award-ngay-bctd": ngayBctdRaw,
    "date-yeu-cau-bao-gia": dateYcbgiRaw,
    "date-gui-bao-gia": dateGbgiRaw,
    "date-bao-cao-danh-gia": dateBcdgRaw,
    "date-moi-thuong-thao": dateMttRaw,
    "date-thuong-thao": dateTtRaw,
    "date-trinh-ket-qua": dateTkqRaw
  };
  getAwardRequiredFieldIds({
    isDirectOrSpecial,
    danhGiaNangLucVal,
    hasField: (id) => Boolean(document.getElementById(id))
  }).forEach((fieldId) => validateField(fieldId, requiredAwardValues[fieldId]));
  if (hasError) {
    if (errorInputs[0]) {
      this.view.focusInvalidControl(errorInputs[0]);
    }
    return;
  }
  const tempBids = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) === String(gtId));
  if (tempBids.length === 0) {
    await this.view.customAlert("Thiếu dữ liệu", 'Vui lòng nhập và lưu danh sách Nhà thầu tham dự tại tab "Biên bản mở thầu" trước!', "alert-triangle");
    return;
  }
  const tbodyResult = document.getElementById("approve-bidders-tbody");
  const winnerRows = getWinnerRows(tbodyResult, { isDirectOrSpecial });
  try {
    if (!gt.thoiGianMoThau) {
      gt.thoiGianMoThau = this.model.getCurrentDateTimeString();
    }
    gt.trangThai = "Đang chấm thầu";
    applyAutoPassedEvaluation({ gt, bids: tempBids, model: this.model });
    applyResultRowsToBids(tbodyResult, this.model);
    applyAwardResultToPackage({ gt, bids: tempBids, winnerRows, tbodyResult, model: this.model });
    applyAwardMetadata({
      gt,
      isDirectOrSpecial,
      soBctdVal,
      ngayBctdVal,
      decDate,
      directDates: {
        danhGiaNangLucVal,
        dateYcbgi: this.model.convertDMYToYMD(dateYcbgiRaw),
        dateGbgi: this.model.convertDMYToYMD(dateGbgiRaw),
        dateBcdg: dateBcdgRaw ? this.model.convertDMYToYMD(dateBcdgRaw) : "",
        dateMtt: this.model.convertDMYToYMD(dateMttRaw),
        dateTt: this.model.convertDMYToYMD(dateTtRaw),
        dateTkq: this.model.convertDMYToYMD(dateTkqRaw)
      }
    });
    clearCompetitiveQuotationAppraisal(gt);
    gt.soQuyetDinhKetQua = decNo;
    gt.ngayQuyetDinhKetQua = decDate;
    gt.trangThai = "Đã có kết quả";
    await this.model.persistChanges("goithau", { upserts: [gt] }, { throwOnError: true });
    await this.model.persistChanges("thongtinmothau", { upserts: tempBids }, { throwOnError: true });
    this.model.commitLocalMutation("goithau", { records: [gt] });
    this.model.commitLocalMutation("thongtinmothau", { records: tempBids });
    this.view.renderGoiThauTable();
    const syncResult = await this.autoSync();
    if (!syncResult?.ok) return;
    await this.view.customAlert(
      "Chúc mừng",
      `Đã lưu và phê duyệt kết quả lựa chọn nhà thầu cho gói thầu "${gt.tenGoiThau}" thành công!`,
      "check-circle"
    );
    this.view._currentWorkflowTab = "result";
    this.view.showPackageDetails(gtId);
  } catch (err) {
    console.error("[saveKetQuaChiDinhThau] Background operation failed; rolling back...", err);
    const gtIndex = this.model.state.goithau.findIndex((g) => g.id === gtId);
    if (gtIndex !== -1) {
      this.model.state.goithau[gtIndex] = snapshotGt;
    }
    this.model.replaceTableState(
      "thongtinmothau",
      this.model.state.thongtinmothau.filter(
        (b) => String(b.goiThauId) !== String(gtId),
      ),
    );
    this.model.state.thongtinmothau.push(...snapshotBids);
    try {
      const snapshotBidIds = new Set(snapshotBids.map((bid) => String(bid.id)));
      const createdBidIds = tempBids
        .filter((bid) => !snapshotBidIds.has(String(bid.id)))
        .map((bid) => bid.id);
      await this.model.persistChanges(
        "goithau",
        { upserts: [snapshotGt] },
        { trackMutation: false, throwOnError: true },
      );
      await this.model.persistChanges(
        "thongtinmothau",
        { upserts: snapshotBids, deletions: createdBidIds },
        { trackMutation: false, throwOnError: true },
      );
    } catch (rollbackErr) {
      console.error("[saveKetQuaChiDinhThau] Rollback failed:", rollbackErr);
    }
    await this.view.customAlert(
      "Lỗi hệ thống",
      `Đã xảy ra lỗi trong quá trình xử lý ngầm và hệ thống đã tự động hoàn tác toàn bộ thay đổi.

Chi tiết lỗi: ${err.message || String(err)}

Vui lòng thử lại hoặc liên hệ hỗ trợ.`,
      "x-circle"
    );
  }
}
