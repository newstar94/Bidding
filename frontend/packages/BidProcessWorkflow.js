import { setRuntimeStyle } from "../shared/runtimeStyles.js";
﻿import { getAppController } from "../app/controllerRef.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { bindCurrencyElement, debounce } from "../app/domUtils.js";
import { setFieldFeedback } from "../app/formStateUtils.js";
import { executeAppCommand } from "../app/commandBus.js";
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
import { getPartnerLookupInput, lookupPartnerInfo } from "../partners/partnerTaxLookup.js";
import { getExactContractorVersion, resolveBidContractorName, resolveBidJointVentureMembers, resolveContractorVersion } from "../partners/contractorVersionBinding.js";
import { clearCompetitiveQuotationAppraisal } from "./packageAppraisal.js";
import {
  renderJointVentureModalBody,
  renderJointVentureModalFooter,
  renderJointVentureModalHeader
} from "./detail/JointVentureModal.js";
import {
  enrichOpeningRowsWithPartnerInfo,
  findContractorByCode,
  findDuplicateJvMemberCodes,
  getJointVentureSubMembers,
  mapPartnerLookupToContractor,
  normalizeContractorLookupCode,
  resolveLeadMemberName,
  resolveOpeningLeadContractor
} from "./openingContractorLookup.js";
export { mapPartnerLookupToContractor, resolveOpeningLeadContractor } from "./openingContractorLookup.js";

export async function moThauGoiThau(id) {
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  const thoiGianMoThauStr = await this.view.customPrompt(
    "Chọn thời gian mở thầu",
    `Chọn Thời gian mở thầu cho gói thầu "${gt.tenGoiThau}":`,
    "",
    "Chọn ngày và giờ...",
    true,
    // kích hoạt date/time picker
    (val) => {
      if (!val || !val.trim()) {
        return "Vui lòng chọn thời gian mở thầu!";
      }
      const cleanVal = val.trim();
      let d2, m2, y2, hh2 = 0, mm2 = 0;
      const formatMatch = cleanVal.match(/^(\d{2}):(\d{2})\s+ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i);
      if (formatMatch) {
        hh2 = parseInt(formatMatch[1], 10);
        mm2 = parseInt(formatMatch[2], 10);
        d2 = parseInt(formatMatch[3], 10);
        m2 = parseInt(formatMatch[4], 10);
        y2 = parseInt(formatMatch[5], 10);
      } else {
        const parts = cleanVal.split(" ");
        if (parts.length >= 2) {
          const dateParts = parts[0].split("/");
          const timeParts = parts[1].split(":");
          d2 = parseInt(dateParts[0], 10);
          m2 = parseInt(dateParts[1], 10);
          y2 = parseInt(dateParts[2], 10);
          hh2 = parseInt(timeParts[0] || 0, 10);
          mm2 = parseInt(timeParts[1] || 0, 10);
        }
      }
      if (isNaN(d2) || isNaN(m2) || isNaN(y2) || isNaN(hh2) || isNaN(mm2)) {
        return "Thời gian mở thầu không hợp lệ. Vui lòng chọn lại!";
      }
      if (gt.thoiGianDongThau) {
        const dongThauDate = new Date(gt.thoiGianDongThau);
        const moThauDate = new Date(y2, m2 - 1, d2, hh2, mm2);
        if (!isNaN(dongThauDate.getTime()) && !isNaN(moThauDate.getTime()) && moThauDate < dongThauDate) {
          return `Thời gian mở thầu phải bằng hoặc sau thời gian đóng thầu (${this.model.formatDateWithTime(gt.thoiGianDongThau)})!`;
        }
      }
      return null;
    }
  );
  if (thoiGianMoThauStr === null) {
    return;
  }
  const cleanStr = thoiGianMoThauStr.trim();
  if (!cleanStr) {
    await this.view.customAlert("Lỗi", "Vui lòng chọn thời gian mở thầu!", "x-circle");
    return;
  }
  let d, m, y, hh = 0, mm = 0;
  const newFormatMatch = cleanStr.match(/^(\d{2}):(\d{2})\s+ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  if (newFormatMatch) {
    hh = parseInt(newFormatMatch[1], 10);
    mm = parseInt(newFormatMatch[2], 10);
    d = parseInt(newFormatMatch[3], 10);
    m = parseInt(newFormatMatch[4], 10);
    y = parseInt(newFormatMatch[5], 10);
  } else {
    const parts = cleanStr.split(" ");
    if (parts.length >= 2) {
      const dateParts = parts[0].split("/");
      const timeParts = parts[1].split(":");
      d = parseInt(dateParts[0], 10);
      m = parseInt(dateParts[1], 10);
      y = parseInt(dateParts[2], 10);
      hh = parseInt(timeParts[0] || 0, 10);
      mm = parseInt(timeParts[1] || 0, 10);
    }
  }
  if (isNaN(d) || isNaN(m) || isNaN(y) || isNaN(hh) || isNaN(mm)) {
    await this.view.customAlert("Lỗi", "Thời gian mở thầu không hợp lệ. Vui lòng chọn lại!", "x-circle");
    return;
  }
  const ymdStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  gt.thoiGianMoThau = ymdStr;
  gt.trangThai = "Đã mở thầu";
  await this.model.persistData("goithau");
  this.view.renderGoiThauTable();
  const syncResult = await this.autoSync();
  if (!syncResult?.ok) return;
  await this.view.customAlert(
    "Thành công",
    `Đã tiến hành mở thầu thành công cho gói thầu "${gt.tenGoiThau}". Trạng thái hiện tại: Đã mở thầu. Hãy tiến hành điền thông tin mở thầu và lưu lại!`,
    "check-circle"
  );
  this.switchTab("goithau-detail", id);
}
export async function phatHanhHsmtGoiThau(id) {
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  if (!document.getElementById("modal-phathanh-hsmt")) {
    await this.ensureLazyModal?.("modal-phathanh-hsmt");
  }
  this.view.populatePhathanhHsmtForm(gt, this.model);
  this.view.openModal("modal-phathanh-hsmt");
}
export async function handlePhatHanhHsmtSubmit(e) {
  e.preventDefault();
  const form = document.getElementById("form-phathanh-hsmt");
  if (!this.view.validateForm(form)) return;
  const data = this.view.getPhathanhHsmtFormData(this.model);
  const { id, maGoiThauVal, hieuLucHsdtVal, giaTriDamBaoVal, soQuyetDinh, thoiGianDangTai, thoiGianDongThau, ngayQuyetDinh, soToTrinhHsmt, ngayTrinhHsmt, yeuCauThamDinhHsmt, soBaoCaoThamDinhHsmt, ngayBaoCaoThamDinhHsmt, phanLoRows } = data;
  const gt = this.model.state.goithau.find((g) => g.id === id);
  if (!gt) return;
  const isTuVan = gt.linhVuc === "Tư vấn";
  const isPhanLo = gt.phanLo === "Có";
  if (!maGoiThauVal) {
    await this.view.customAlert("Thiếu thông tin", "Mã gói thầu là bắt buộc khi chuyển sang trạng thái Đang mời thầu!", "alert-triangle", document.getElementById("phathanh-magoithau"));
    return;
  }
  if (hieuLucHsdtVal <= 0) {
    await this.view.customAlert("Thiếu thông tin", "Thời gian hiệu lực hồ sơ dự thầu phải lớn hơn 0!", "alert-triangle", document.getElementById("phathanh-hieuluchsdt"));
    return;
  }
  if (!isTuVan && !isPhanLo) {
    if (giaTriDamBaoVal <= 0) {
      await this.view.customAlert("Thiếu thông tin", "Giá trị bảo đảm dự thầu phải lớn hơn 0 (trừ gói tư vấn)!", "alert-triangle", document.getElementById("phathanh-giatribaomothau"));
      return;
    }
  }
  if (isPhanLo && !isTuVan) {
    let invalidInput = null;
    let exceedsInput = null;
    let exceedsMsg = "";
    for (const row of phanLoRows) {
      if (row.baoDamDuThau <= 0 && !invalidInput) {
        const tr = document.querySelector(`#phathanh-phanlo-baodam-tbody tr[data-id="${row.id}"]`);
        invalidInput = tr ? tr.querySelector(".phathanh-pl-baodam-input") : null;
      }
      if (row.giaTriPhanLo > 0 && row.baoDamDuThau > row.giaTriPhanLo && !exceedsInput) {
        const tr = document.querySelector(`#phathanh-phanlo-baodam-tbody tr[data-id="${row.id}"]`);
        exceedsInput = tr ? tr.querySelector(".phathanh-pl-baodam-input") : null;
        exceedsMsg = `Giá trị bảo đảm dự thầu (${this.model.formatVND(row.baoDamDuThau)}) không được lớn hơn giá trị phần lô (${this.model.formatVND(row.giaTriPhanLo)})!`;
      }
    }
    if (invalidInput || phanLoRows.length === 0) {
      await this.view.customAlert("Thiếu thông tin", "Gói thầu bắt buộc phải có Giá trị bảo đảm dự thầu lớn hơn 0 cho tất cả các phần lô (trừ gói tư vấn)!", "alert-triangle", invalidInput);
      return;
    }
    if (exceedsInput) {
      await this.view.customAlert("Dữ liệu không hợp lệ", exceedsMsg, "alert-triangle", exceedsInput);
      return;
    }
  }
  const confirmed = await this.view.customConfirm(
    "Xác nhận phát hành",
    `Bạn có chắc chắn muốn phát hành HSMT và chuyển gói thầu "${gt.tenGoiThau}" sang trạng thái "Đang mời thầu" không?`,
    "send"
  );
  if (confirmed) {
    gt.maGoiThau = maGoiThauVal;
    gt.soToTrinhHsmt = soToTrinhHsmt;
    gt.ngayTrinhHsmt = ngayTrinhHsmt ? this.model.convertDMYToYMD(ngayTrinhHsmt) : "";
    gt.soQuyetDinh = soQuyetDinh;
    gt.ngayQuyetDinh = ngayQuyetDinh ? this.model.convertDMYToYMD(ngayQuyetDinh) : "";
    gt.thoiGianDangTai = thoiGianDangTai ? this.model.convertDMYHMSToYMDHMS(thoiGianDangTai) : "";
    gt.thoiGianDongThau = thoiGianDongThau ? this.model.convertDMYHMSToYMDHMS(thoiGianDongThau) : "";
    gt.yeuCauThamDinhHsmt = yeuCauThamDinhHsmt;
    gt.soBaoCaoThamDinhHsmt = soBaoCaoThamDinhHsmt;
    gt.ngayBaoCaoThamDinhHsmt = ngayBaoCaoThamDinhHsmt ? this.model.convertDMYToYMD(ngayBaoCaoThamDinhHsmt) : "";
    clearCompetitiveQuotationAppraisal(gt);
    gt.thoiGianMoThau = "";
    gt.hieuLucHsdt = hieuLucHsdtVal;
    gt.hieuLucDamBaoDuThau = hieuLucHsdtVal + 30;
    if (isPhanLo && !isTuVan && gt.phanLoList) {
      phanLoRows.forEach((row) => {
        const pl = gt.phanLoList.find((p) => p.id === row.id);
        if (pl) {
          pl.maPhanLo = row.maPhanLo;
          pl.tenPhanLo = row.tenPhanLo;
          pl.giaTriPhanLo = row.giaTriPhanLo;
          pl.baoDamDuThau = row.baoDamDuThau;
          pl.thoiGianThucHien = row.thoiGianThucHien;
        }
      });
      gt.giaTriDamBaoDuThau = this.model.sumVND(gt.phanLoList.map((item) => item.baoDamDuThau));
    } else if (!isTuVan && !isPhanLo) {
      gt.giaTriDamBaoDuThau = giaTriDamBaoVal;
    } else {
      gt.giaTriDamBaoDuThau = 0;
    }
    gt.trangThai = "Đang mời thầu";
    await this.model.persistData("goithau");
    this.view.closeModal("modal-phathanh-hsmt");
    this.view.showPackageDetails(id);
    const syncResult = await this.autoSync();
    if (!syncResult?.ok) return;
    await this.view.customAlert("Thành công", "Đã phát hành HSMT và chuyển gói thầu sang trạng thái Đang mời thầu!", "check-circle");
  }
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
    if (g.trangThai !== "Đang mời thầu" && g.trangThai !== "Đã mở thầu" && g.trangThai !== "Đang chấm thầu" && g.trangThai !== "Đã có kết quả") return false;
    if (g.trangThai === "Đang mời thầu") {
      if (!g.thoiGianDongThau) return false;
      const dongThau = new Date(g.thoiGianDongThau);
      if (dongThau >= now) return false;
    }
    return true;
  });
  select.innerHTML = '<option value="">-- Chọn Gói thầu (Đang mời thầu / Đã mở thầu / Đang chấm thầu / Đã có kết quả) --</option>' + targetPackages.map((g) => `<option value="${escapeHtml(g.id)}" data-search="${escapeHtml(`${g.maGoiThau || ""} ${g.tenGoiThau || ""}`)}">${escapeHtml(g.tenGoiThau)} (${escapeHtml(g.maGoiThau || "Chưa có mã")})</option>`).join("");
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
    const isNextStepSaved = isNextEvaluationStepSaved(gt);
    const hasSavedOpeningData = this.model.state.thongtinmothau.some((b) => String(b.goiThauId) === String(gt.id));
    const isCompleted = gt.trangThai !== "Đang mời thầu" && gt.trangThai !== "Đã mở thầu" && isNextStepSaved || hasSavedOpeningData;
    const isEditingThisStep = this.view._editingState && this.view._editingState[stepKey];
    const lockedStatuses = ["Đã có kết quả", "Hủy thầu"];
    const isLocked = lockedStatuses.includes(gt.trangThai);
    const isReadOnly = isCompleted && !isEditingThisStep || isLocked;
    const isEditable = !isReadOnly;
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
    if (addBidBtn2) {
      setRuntimeStyle(addBidBtn2, "display", isEditable ? "" : "none");
      addBidBtn2.innerHTML = `<i data-lucide="plus"></i> ${isDirectOrSpecial ? "Thêm nhà thầu" : "Thêm Nhà thầu nộp hồ sơ"}`;
    }
    if (importExcelBtnTop) setRuntimeStyle(importExcelBtnTop, "display", isEditable ? "" : "none");
    if (downloadExcelBtnTop) setRuntimeStyle(downloadExcelBtnTop, "display", isEditable ? "" : "none");
    if (saveBtn2) {
      if (isReadOnly) {
        if (isNextStepSaved || isLocked) {
          setRuntimeStyle(saveBtn2, "display", "none");
        } else {
          setRuntimeStyle(saveBtn2, "display", "");
          saveBtn2.innerHTML = '<i data-lucide="edit"></i> Chỉnh sửa';
          saveBtn2.className = "btn btn-primary";
          saveBtn2.onclick = () => {
            this.view._editingState = this.view._editingState || {};
            this.view._editingState[stepKey] = true;
            this.renderMoThauPanel();
          };
        }
      } else {
        setRuntimeStyle(saveBtn2, "display", "");
        saveBtn2.innerHTML = `<i data-lucide="save"></i> ${isDirectOrSpecial ? "Lưu thông tin" : "Lưu thông tin mở thầu"}`;
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
                    <th class="bf-s-a01153c965">Mã nhà thầu</th>
                    <th class="bf-s-eb7671413b">Tên nhà thầu</th>
                    <th class="bf-s-ad8c93e5fe">Hiệu lực E-HSĐXKT</th>
                    <th class="bf-s-2811ee8f01">Thời gian thực hiện</th>
                    ${isEditable ? '<th class="bf-s-bcc505298c">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "1G2T_NO_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-2811ee8f01">Loại nhà thầu</th>
                    <th class="bf-s-fa210469db">Mã nhà thầu</th>
                    <th class="bf-s-4a13035285">Tên nhà thầu</th>
                    <th class="bf-s-2811ee8f01">Đảm bảo dự thầu</th>
                    <th class="bf-s-2811ee8f01">Hiệu lực đảm bảo</th>
                    <th class="bf-s-1e5172f548">Hiệu lực E-HSĐXKT</th>
                    ${isEditable ? '<th class="bf-s-bcc505298c">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "1G2T_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-ae54075f01">Mã phần lô</th>
                    <th class="bf-s-ae54075f01">Tên phần lô</th>
                    <th class="bf-s-ae54075f01">Loại nhà thầu</th>
                    <th class="bf-s-ad8c93e5fe">Mã nhà thầu</th>
                    <th class="bf-s-a01153c965">Tên nhà thầu</th>
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
                    <th class="bf-s-c83ebbe56b">Mã nhà thầu</th>
                    <th class="bf-s-a01153c965">Tên nhà thầu</th>
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
                    <th class="bf-s-8523765ec6">Mã phần lô</th>
                    <th class="bf-s-8523765ec6">Tên phần lô</th>
                    <th class="bf-s-8523765ec6">Loại nhà thầu</th>
                    <th class="bf-s-2811ee8f01">Mã nhà thầu</th>
                    <th class="bf-s-c264699ce5">Tên nhà thầu</th>
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
                    <th class="bf-s-ad8c93e5fe">Mã nhà thầu</th>
                    <th class="bf-s-4a13035285">Tên nhà thầu</th>
                    <th class="bf-s-ad8c93e5fe">Giá dự thầu</th>
                    <th class="bf-s-4a13035285">Thời gian thực hiện gói thầu</th>
                    ${isEditable ? '<th class="bf-s-bcc505298c">Thao tác</th>' : ""}
                </tr>
            `;
    } else if (caseType === "DIRECT_SPECIAL_WITH_LOT") {
      theadHtml = `
                <tr>
                    <th class="bf-s-ae54075f01">Mã phần lô</th>
                    <th class="bf-s-ae54075f01">Tên phần lô</th>
                    <th class="bf-s-ae54075f01">Loại nhà thầu</th>
                    <th class="bf-s-2811ee8f01">Mã nhà thầu</th>
                    <th class="bf-s-fa210469db">Tên nhà thầu</th>
                    <th class="bf-s-ae54075f01">Giá dự thầu</th>
                    <th class="bf-s-a01153c965">Thời gian thực hiện gói thầu</th>
                    ${isEditable ? '<th class="bf-s-59052b934c">Thao tác</th>' : ""}
                </tr>
            `;
    }
    thead.innerHTML = theadHtml;
    tbody.innerHTML = "";
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
      lucide.createIcons();
    };
  }
}
export function openMoThauJVManager(tr) {
  const leadCode = (tr.querySelector(".mt-ma-nha-thau") || tr.querySelector(".row-ma-nha-thau"))?.value.trim() || "";
  const controller = getAppController();
  const latestNhaThauListJV = controller?.model?.getLatestNhaThau?.() || [];
  const fallbackContractor = resolveOpeningLeadContractor(
    controller?.model,
    latestNhaThauListJV,
    leadCode,
    tr._leadMemberContractorId || tr.dataset.contractorVersionId
  );
  const rowMembers = Array.isArray(tr._thanhVienLienDanh) ? tr._thanhVienLienDanh : [];
  const fallbackMembers = Array.isArray(fallbackContractor?.thanhVienLienDanh) ? fallbackContractor.thanhVienLienDanh : [];
  const members = getJointVentureSubMembers(rowMembers.length > 0 ? rowMembers : fallbackMembers, leadCode);
  const modalId = "modal-mothau-jv-manager";
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();
  modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "modal-overlay active";
  setRuntimeStyle(modal, "zIndex", "2000");
  const card = document.createElement("div");
  card.className = "modal-card";
  setRuntimeStyle(card, "maxWidth", "600px");
  setRuntimeStyle(card, "width", "95%");
  setRuntimeStyle(card, "margin", "20px auto");
  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = `
        <h3>Thành viên liên danh</h3>
        <button class="modal-close" id="btn-close-mothau-jv">&times;</button>
    `;
  const body = document.createElement("div");
  body.className = "modal-body";
  setRuntimeStyle(body, "padding", "20px");
  const foundLeadNt = fallbackContractor;
  const currentLeadCode = normalizeContractorLookupCode(leadCode);
  const leadName = tr._leadMemberCode === currentLeadCode
    ? tr._leadMemberName || resolveLeadMemberName(foundLeadNt, leadCode)
    : resolveLeadMemberName(foundLeadNt, leadCode);
  const displayLeadCode = leadCode || "Chưa nhập";
  body.innerHTML = `
        <div class="bf-s-8df25cd500">
            <div class="bf-s-7f07b6bbca">Thành viên đứng đầu liên danh</div>
            <div class="bf-s-16fbb6e0cf">
                <div class="form-group bf-s-4bbf3df076">
                    <label class="bf-s-7a5db2128e">Mã/MST thành viên đứng đầu</label>
                    <input type="text" id="jv-input-lead-code" class="form-control bf-s-76939df48e" value="${escapeHtml(displayLeadCode)}" readonly>
                </div>
                <div class="form-group bf-s-4bbf3df076">
                    <label class="bf-s-7a5db2128e">Tên thành viên đứng đầu</label>
                    <input type="text" id="jv-input-lead-name" class="form-control bf-s-810c9fe5d1" required placeholder="Tên thành viên đứng đầu" value="${escapeHtml(leadName)}">
                </div>
            </div>
        </div>

        <div class="bf-s-48e4421941">
            <h4 class="bf-s-76334239c2">Danh sách Thành viên liên danh</h4>
            <button type="button" class="btn btn-primary btn-sm bf-s-186f022dc5" id="btn-add-mothau-jv-member">
                + Thêm thành viên
            </button>
        </div>

        <div id="mothau-jv-members-list" class="bf-s-fa71b8d74c">
            <!-- Member inputs dynamic list -->
        </div>
    `;
  const footer = document.createElement("div");
  footer.className = "modal-footer";
  footer.innerHTML = `
        <button type="button" class="btn btn-outline" id="btn-cancel-mothau-jv">Hủy</button>
        <button type="button" class="btn btn-primary" id="btn-save-mothau-jv">Xác nhận</button>
    `;
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  modal.appendChild(card);
  document.body.appendChild(modal);
  const listContainer = document.getElementById("mothau-jv-members-list");
  const leadNameInput = document.getElementById("jv-input-lead-name");
  const lookupInfoByTaxCode = async (code, inputToDim) => {
    const lookupInput = getPartnerLookupInput(code);
    if (!lookupInput) return null;
    try {
      if (inputToDim) setRuntimeStyle(inputToDim, "opacity", "0.7");
      const data = await lookupPartnerInfo({ ...lookupInput, partnerRole: "NT" });
      return data ? await mapPartnerLookupToContractor(code, data) : null;
    } catch (err) {
      console.error("Tax-code lookup during bid opening failed: ", err);
      return null;
    } finally {
      if (inputToDim) setRuntimeStyle(inputToDim, "opacity", "1");
    }
  };
  const fillLeadNameFromCode = async () => {
    if (!leadCode || !leadNameInput) return;
    const localContractor = resolveOpeningLeadContractor(
      controller?.model,
      latestNhaThauListJV,
      leadCode,
      tr._leadMemberContractorId || tr.dataset.contractorVersionId
    );
    const localName = resolveLeadMemberName(localContractor, leadCode);
    if (localName) {
      leadNameInput.value = localName;
      leadNameInput.dataset.autofilled = "1";
      tr._leadMemberName = localName;
      tr._leadMemberLookupData = {
        tenNhaThau: localName,
        maNhaThau: localContractor?.maNhaThau || leadCode,
        maSoThue: localContractor?.maSoThue || "",
        diaChi: localContractor?.diaChi || "",
        diaChiGoc: localContractor?.diaChiGoc || "",
        tenVietTat: localContractor?.tenVietTat || "",
        thanhVienNhaThauId: localContractor?.id || ""
      };
      tr._leadMemberContractorId = localContractor?.id || "";
      tr.dataset.contractorVersionId = localContractor?.id || "";
      tr._leadMemberCode = normalizeContractorLookupCode(leadCode);
      return;
    }
    const apiInfo = await lookupInfoByTaxCode(leadCode, leadNameInput);
    if (apiInfo?.tenNhaThau) {
      if (!leadNameInput.value.trim() || leadNameInput.dataset.autofilled !== "0") {
        leadNameInput.value = apiInfo.tenNhaThau;
      }
      tr._leadMemberName = apiInfo.tenNhaThau;
      tr._leadMemberLookupData = apiInfo;
      tr._leadMemberContractorId = "";
      tr.dataset.contractorVersionId = "";
      tr._leadMemberCode = normalizeContractorLookupCode(leadCode);
    }
  };
  const addMemberRow = (member = { tenNhaThau: "", maSoThue: "" }) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "mothau-jv-member-row";
    setRuntimeStyle(rowDiv, "display", "grid");
    setRuntimeStyle(rowDiv, "gridTemplateColumns", "1fr 1fr auto");
    setRuntimeStyle(rowDiv, "gap", "10px");
    setRuntimeStyle(rowDiv, "alignItems", "center");
    setRuntimeStyle(rowDiv, "padding", "8px");
    setRuntimeStyle(rowDiv, "border", "1px solid var(--border-color)");
    setRuntimeStyle(rowDiv, "borderRadius", "var(--radius-sm)");
    setRuntimeStyle(rowDiv, "background", "var(--bg-nested, rgba(0,0,0,0.02))");
    rowDiv.innerHTML = `
            <div class="form-group bf-s-4bbf3df076">
                <input type="text" class="jv-input-mst bf-s-810c9fe5d1" required placeholder="Mã số thuế / Mã nhà thầu" value="${escapeHtml(member.maNhaThau || member.maSoThue || "")}">
            </div>
            <div class="form-group bf-s-4bbf3df076">
                <input type="text" class="jv-input-ten bf-s-810c9fe5d1" required placeholder="Tên nhà thầu thành viên" value="${escapeHtml(member.tenNhaThau || "")}">
            </div>
            <button type="button" class="action-btn btn-delete btn-remove-jv-row bf-s-f499e07949"><i data-lucide="trash-2" class="bf-s-58050124fc"></i></button>
        `;
    rowDiv.querySelector(".btn-remove-jv-row").onclick = () => {
      rowDiv.remove();
    };
    const mstInput = rowDiv.querySelector(".jv-input-mst");
    const tenInput = rowDiv.querySelector(".jv-input-ten");
    rowDiv._lookupData = member;
    let lastResolvedMemberCode = normalizeContractorLookupCode(mstInput.value);
    const fillMemberNameFromCode = async (allowOnlineLookup = false) => {
      const code = mstInput.value.trim();
      const normalizedCode = normalizeContractorLookupCode(code);
      if (!normalizedCode) {
        tenInput.value = "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = {};
        lastResolvedMemberCode = "";
        return;
      }
      if (normalizedCode !== lastResolvedMemberCode) {
        tenInput.value = "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = {};
        lastResolvedMemberCode = normalizedCode;
      }
      const found = findContractorByCode(latestNhaThauListJV, code);
      if (found) {
        tenInput.value = found.tenNhaThau || "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = {
          ...found,
          maNhaThau: found.maNhaThau || code,
          maSoThue: found.maSoThue || "",
          tenNhaThau: found.tenNhaThau || ""
        };
        return;
      }
      if (allowOnlineLookup) {
        const apiInfo = await lookupInfoByTaxCode(code, mstInput);
        tenInput.value = apiInfo?.tenNhaThau || "";
        tenInput.dataset.autofilled = "1";
        rowDiv._lookupData = apiInfo || {};
      }
    };
    tenInput.addEventListener("input", () => {
      tenInput.dataset.autofilled = "0";
      const lookupInput = getPartnerLookupInput(mstInput.value.trim()) || {};
      rowDiv._lookupData = {
        ...rowDiv._lookupData || {},
        tenNhaThau: tenInput.value.trim(),
        maNhaThau: lookupInput.orgCode || rowDiv._lookupData?.maNhaThau || mstInput.value.trim(),
        maSoThue: lookupInput.taxCode || rowDiv._lookupData?.maSoThue || ""
      };
    });
    mstInput.addEventListener("input", () => fillMemberNameFromCode(false));
    mstInput.addEventListener("change", () => fillMemberNameFromCode(true));
    mstInput.addEventListener("blur", () => fillMemberNameFromCode(true));
    rowDiv._resolveLookup = () => fillMemberNameFromCode(true);
    listContainer.appendChild(rowDiv);
    fillMemberNameFromCode(false);
    lucide.createIcons({ root: rowDiv });
  };
  if (members.length > 0) {
    members.forEach((m) => addMemberRow(m));
  } else {
    addMemberRow();
  }
  fillLeadNameFromCode();
  document.getElementById("btn-add-mothau-jv-member").onclick = () => addMemberRow();
  const closeModal = () => modal.remove();
  document.getElementById("btn-close-mothau-jv").onclick = closeModal;
  document.getElementById("btn-cancel-mothau-jv").onclick = closeModal;
  document.getElementById("btn-save-mothau-jv").onclick = async () => {
    await fillLeadNameFromCode();
    await Promise.all(Array.from(listContainer.querySelectorAll(".mothau-jv-member-row")).map((row) => row._resolveLookup?.()));
    const leadNameInput2 = document.getElementById("jv-input-lead-name").value.trim();
    if (!leadNameInput2) {
      controller?.view?.customAlert?.("Thiếu thông tin", "Vui lòng nhập tên thành viên đứng đầu liên danh!", "alert-triangle", "#jv-input-lead-name");
      return;
    }
    const rows = listContainer.querySelectorAll(".mothau-jv-member-row");
    const updatedMembers = [];
    const invalidInputs = [];
    let valid = true;
    rows.forEach((r) => {
      const inputTen = r.querySelector(".jv-input-ten");
      const inputMst = r.querySelector(".jv-input-mst");
      const ten = inputTen?.value.trim() || "";
      const mst = inputMst?.value.trim() || "";
      if (ten && mst) {
        const lookupInput = getPartnerLookupInput(mst) || {};
        updatedMembers.push({
          ...r._lookupData || {},
          tenNhaThau: ten,
          maNhaThau: r._lookupData?.maNhaThau || lookupInput.orgCode || mst,
          maSoThue: r._lookupData?.maSoThue || lookupInput.taxCode || ""
        });
      } else if (ten || mst) {
        valid = false;
        if (!ten && inputTen) invalidInputs.push(inputTen);
        if (!mst && inputMst) invalidInputs.push(inputMst);
      }
    });
    if (!valid) {
      controller?.view?.customAlert?.("Thiếu thông tin", "Vui lòng điền đầy đủ cả Tên nhà thầu và Mã số thuế của Thành viên liên danh!", "alert-triangle", invalidInputs);
      return;
    }
    const duplicateInputs = findDuplicateJvMemberCodes({
      leadCode,
      leadInput: document.getElementById("jv-input-lead-code"),
      rows
    });
    if (duplicateInputs.length > 0) {
      duplicateInputs.forEach((input) => {
        setRuntimeStyle(input, "border", "1px solid var(--danger)");
        input.addEventListener("input", () => {
          setRuntimeStyle(input, "border", "");
        }, { once: true });
      });
      controller?.view?.customAlert?.("Trùng mã số thuế", "Các thành viên liên danh không được trùng mã số thuế hoặc mã nhà thầu. Vui lòng kiểm tra lại!", "alert-triangle", duplicateInputs);
      return;
    }
    tr._leadMemberName = leadNameInput2;
    tr._thanhVienLienDanh = updatedMembers;
    const labelSpan = tr.querySelector(".mt-jv-btn-text") || tr.querySelector(".row-jv-btn-text");
    if (labelSpan) {
      labelSpan.textContent = `Thành viên liên danh (${updatedMembers.length})`;
    }
    closeModal();
  };
  lucide.createIcons({ root: modal });
}
export function showNhaThauDetailsAndCloseJV(ntId) {
  const jvModal = document.getElementById("modal-mothau-jv-view");
  if (jvModal) jvModal.remove();
  executeAppCommand("showNhaThauDetails", ntId);
}
export function openMoThauJVViewModal(members, leadName, leadCode, leadContractorVersionId = "") {
  const modalId = "modal-mothau-jv-view";
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();
  modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "modal-overlay active";
  setRuntimeStyle(modal, "zIndex", "2000");
  const card = document.createElement("div");
  card.className = "modal-card";
  setRuntimeStyle(card, "maxWidth", "600px");
  setRuntimeStyle(card, "width", "95%");
  setRuntimeStyle(card, "margin", "20px auto");
  const header = document.createElement("div");
  header.className = "modal-header";
  header.innerHTML = renderJointVentureModalHeader();
  const body = document.createElement("div");
  body.className = "modal-body";
  setRuntimeStyle(body, "padding", "20px");
  const appController = getAppController();
  const matchedContractor = resolveContractorVersion(appController?.model, {
    contractorVersionId: leadContractorVersionId,
    code: leadCode
  });
  const visibleMembers = getJointVentureSubMembers(members || [], leadCode);
  const resolvedLeadName = matchedContractor?.tenNhaThau || resolveLeadMemberName(matchedContractor, leadCode) || leadName;
  const displayLeadName = escapeHtml(resolvedLeadName || "Chưa cập nhật");
  const displayLeadCode = escapeHtml(matchedContractor?.maNhaThau || matchedContractor?.maSoThue || leadCode || "Chưa cập nhật");
  const leadNtId = matchedContractor?.id || null;
  const leadIdAttr = escapeHtml(leadNtId || "");
  const leadCodeHtml = leadNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${leadIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${displayLeadCode}</a>` : displayLeadCode;
  const leadNameHtml = leadNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${leadIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${displayLeadName}</a>` : displayLeadName;
  let membersHtml = "";
  if (visibleMembers.length === 0) {
    membersHtml = `<div class="bf-s-7fa70bc597"><small>Không có Thành viên liên danh</small></div>`;
  } else {
    membersHtml = visibleMembers.map((m, idx) => {
      const memberContractor = resolveContractorVersion(appController?.model, m);
      const memberCode = escapeHtml(memberContractor?.maNhaThau || memberContractor?.maSoThue || m.maNhaThau || m.maSoThue || "--");
      const memberName = escapeHtml(memberContractor?.tenNhaThau || m.tenNhaThau || "--");
      const memberNtId = memberContractor?.id || null;
      const memberIdAttr = escapeHtml(memberNtId || "");
      const mCodeHtml = memberNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${memberIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${memberCode}</a>` : memberCode;
      const mNameHtml = memberNtId ? `<a href="#" data-bf-action="show-contractor-close-jv" data-id="${memberIdAttr}" class="text-blue fw-bold link-hover bf-s-b39a6b99e1">${memberName}</a>` : memberName;
      return `
                <div class="bf-s-a8d71b3a93">
                    <div>
                        <div class="bf-s-68d41663ac">Mã số thuế / Mã nhà thầu</div>
                        <div class="bf-s-f41e7182b7">${mCodeHtml}</div>
                    </div>
                    <div>
                        <div class="bf-s-68d41663ac">Tên thành viên ${idx + 2}</div>
                        <div class="bf-s-f41e7182b7">${mNameHtml}</div>
                    </div>
                </div>
            `;
    }).join("");
  }
  body.innerHTML = renderJointVentureModalBody({ leadCodeHtml, leadNameHtml, membersHtml });
  const footer = document.createElement("div");
  footer.className = "modal-footer";
  footer.innerHTML = renderJointVentureModalFooter();
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  modal.appendChild(card);
  document.body.appendChild(modal);
  const closeModal = () => modal.remove();
  document.getElementById("btn-close-mothau-jv-view").onclick = closeModal;
  document.getElementById("btn-ok-mothau-jv-view").onclick = closeModal;
}
export function addMoThauRow(caseType, gt, bidData = {}, readOnly = false) {
  const tbody = document.getElementById("mothau-table-tbody");
  if (!tbody) return;
  const tr = document.createElement("tr");
  tr.setAttribute("data-id", bidData.id || generateRecordId("thongtinmothau"));
  tr.dataset.contractorVersionId = bidData.nhaThauId || "";
  let ntCode = bidData.maNhaThau || "";
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
  const lotCodeDisplay = escapeHtml(bidData.maPhanLo || "--");
  const lotNameDisplay = escapeHtml(bidData.tenPhanLo || "--");
  const lotNameValue = escapeHtml(bidData.tenPhanLo || "");
  let cellHtml = "";
  const jvBtnCount = tr._thanhVienLienDanh.length;
  const jvDetailsHtml = readOnly ? ntType === "Liên danh" ? `<div class="bf-s-7dd018fd26"><a href="#" class="mt-jv-view-link bf-s-95a6b7be8c">👥 Liên danh ${jvBtnCount} thành viên</a></div>` : "" : `<div class="mt-jv-members-container" style="margin-top: 4px; display: ${ntType === "Liên danh" ? "block" : "none"};">
            <button type="button" class="btn btn-outline btn-xs mt-btn-manage-members bf-s-32804fa5c4">
                <i data-lucide="users" class="bf-s-38e6fd7439"></i>
                <span class="mt-jv-btn-text">Thành viên liên danh (${jvBtnCount})</span>
            </button>
        </div>`;
  if (caseType === "TU_VAN") {
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${contractorCodeDisplay}</span></td>
            <td><span class="mt-ten-nha-thau">${contractorNameDisplay}</span>${jvDetailsHtml}</td>
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
            <td class="bf-s-63dbf5319a"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G2T_NO_LOT") {
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${contractorCodeDisplay}</span></td>
            <td><span class="mt-ten-nha-thau">${contractorNameDisplay}</span>${jvDetailsHtml}</td>
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
            <td class="bf-s-63dbf5319a"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G2T_WITH_LOT") {
    let defaultLotBaoDam = "";
    if (bidData.maPhanLo) {
      const foundLot = lotList.find((l) => l.maPhanLo === bidData.maPhanLo);
      if (foundLot) defaultLotBaoDam = this.model.formatVND(foundLot.baoDamDuThau) || "";
    }
    cellHtml = readOnly ? `
            <td>${lotCodeDisplay}</td>
            <td>${lotNameDisplay}</td>
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${contractorCodeDisplay}</span></td>
            <td><span class="mt-ten-nha-thau">${contractorNameDisplay}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || defaultLotBaoDam || "--"}</td>
            <td>${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}</td>
            <td>${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${lotNameValue}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-dam-bao-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || defaultLotBaoDam}" required placeholder="Số tiền ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-dam-bao" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" placeholder="Hiệu lực ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdxt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiệu lực"></td>
            <td class="bf-s-63dbf5319a"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G1T_NO_LOT") {
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${contractorCodeDisplay}</span></td>
            <td><span class="mt-ten-nha-thau">${contractorNameDisplay}</span>${jvDetailsHtml}</td>
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
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd bf-s-d4486f7f3a" value="${this.model.formatVND(bidData.giaSauGiamGia) || ""}" readonly placeholder="..."></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiực lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || this.model.formatVND(gt.giaTriDamBaoDuThau) || ""}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay bf-s-8b424f074a" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" required></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "")}" required placeholder="Thực hiện"></td>
            <td class="bf-s-63dbf5319a"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "1G1T_WITH_LOT") {
    let defaultLotBaoDam = "";
    if (bidData.maPhanLo) {
      const foundLot = lotList.find((l) => l.maPhanLo === bidData.maPhanLo);
      if (foundLot) defaultLotBaoDam = this.model.formatVND(foundLot.baoDamDuThau) || "";
    }
    cellHtml = readOnly ? `
            <td>${lotCodeDisplay}</td>
            <td>${lotNameDisplay}</td>
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${contractorCodeDisplay}</span></td>
            <td><span class="mt-ten-nha-thau">${contractorNameDisplay}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || "--"}</td>
            <td class="bf-s-5f326564a5">${(bidData.tyLeGiamGia || 0).toString().replace(".", ",")}</td>
            <td>${this.model.formatVND(bidData.giaSauGiamGia) || "--"}</td>
            <td>${bidData.hieuLucHsdt || gt.hieuLucHsdt || 90 ? (bidData.hieuLucHsdt || gt.hieuLucHsdt || 90) + " ngày" : "--"}</td>
            <td>${this.model.formatVND(bidData.giaTriDamBao) || defaultLotBaoDam || "--"}</td>
            <td class="bf-s-5f326564a5">${bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120 ? (bidData.hieuLucBaoDamNgay || gt.hieuLucDamBaoDuThau || 120) + " ngày" : "--"}</td>
            <td>${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "--")}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${lotNameValue}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || ""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-ty-le-giam-gia bf-s-8b424f074a" value="${(bidData.tyLeGiamGia || 0).toString().replace(".", ",")}" required placeholder="Tỷ lệ %"></td>
            <td><input type="text" class="form-control mt-gia-sau-giam-gia mt-format-vnd bf-s-d4486f7f3a" value="${this.model.formatVND(bidData.giaSauGiamGia) || ""}" readonly placeholder="..."></td>
            <td><input type="text" class="form-control mt-hieu-luc-hsdt" value="${bidData.hieuLucHsdt ? bidData.hieuLucHsdt + " ngày" : gt.hieuLucHsdt ? gt.hieuLucHsdt + " ngày" : "90 ngày"}" required placeholder="Hiệu lực"></td>
            <td><input type="text" class="form-control mt-gia-tri-dam-bao mt-format-vnd" value="${this.model.formatVND(bidData.giaTriDamBao) || defaultLotBaoDam}" required placeholder="Giá trị ĐB"></td>
            <td><input type="text" class="form-control mt-hieu-luc-bao-dam-ngay bf-s-8b424f074a" value="${bidData.hieuLucBaoDamNgay ? bidData.hieuLucBaoDamNgay + " ngày" : gt.hieuLucDamBaoDuThau ? gt.hieuLucDamBaoDuThau + " ngày" : "120 ngày"}" required></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(bidData.thoiGianThucHien || gt.thoiGianThucHien || "")}" required placeholder="Thực hiện"></td>
            <td class="bf-s-63dbf5319a"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "DIRECT_SPECIAL_NO_LOT") {
    const defaultDurationPkg = bidData.thoiGianThucHien || gt.thoiGianThucHien || "";
    cellHtml = readOnly ? `
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${contractorCodeDisplay}</span></td>
            <td><span class="mt-ten-nha-thau">${contractorNameDisplay}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau || gt.giaGoiThau) || "--"}</td>
            <td>${escapeHtml(defaultDurationPkg)}</td>
        ` : `
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau || gt.giaGoiThau) || ""}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(defaultDurationPkg)}" required placeholder="Thời gian gói"></td>
            <td class="bf-s-63dbf5319a"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
  } else if (caseType === "DIRECT_SPECIAL_WITH_LOT") {
    const defaultDurationPkg = bidData.thoiGianThucHien || gt.thoiGianThucHien || "";
    let defaultLotPrice = "";
    if (bidData.maPhanLo) {
      const foundLot = lotList.find((l) => l.maPhanLo === bidData.maPhanLo);
      if (foundLot) defaultLotPrice = this.model.formatVND(foundLot.giaTriPhanLo) || "";
    }
    cellHtml = readOnly ? `
            <td>${lotCodeDisplay}</td>
            <td>${lotNameDisplay}</td>
            <td>${typeSelectHtml}</td>
            <td><span class="mt-ma-nha-thau">${contractorCodeDisplay}</span></td>
            <td><span class="mt-ten-nha-thau">${contractorNameDisplay}</span>${jvDetailsHtml}</td>
            <td>${this.model.formatVND(bidData.giaDuThau) || defaultLotPrice || "--"}</td>
            <td>${escapeHtml(defaultDurationPkg)}</td>
        ` : `
            <td>
                <select class="form-control mt-ma-phan-lo" required>
                    <option value="">-- Chọn Lot --</option>
                    ${lotOptions}
                </select>
            </td>
            <td><input type="text" class="form-control mt-ten-phan-lo" value="${lotNameValue}" readonly placeholder="Tên lot"></td>
            <td>${typeSelectHtml}</td>
            <td><input type="text" class="form-control mt-ma-nha-thau mt-ma-dinh-danh" value="${contractorCodeValue}" required placeholder="Mã nhà thầu"></td>
            <td>
                <input type="text" class="form-control mt-ten-nha-thau" value="${contractorNameValue}" required placeholder="Tên nhà thầu">
                ${jvDetailsHtml}
            </td>
            <td><input type="text" class="form-control mt-gia-du-thau mt-format-vnd" value="${this.model.formatVND(bidData.giaDuThau) || defaultLotPrice}" required placeholder="Giá dự thầu"></td>
            <td><input type="text" class="form-control mt-thoi-gian-thuc-hien" value="${escapeHtml(defaultDurationPkg)}" required placeholder="Thời gian gói"></td>
            <td class="bf-s-63dbf5319a"><button class="action-btn btn-delete mt-remove-row"><i data-lucide="trash-2"></i></button></td>
        `;
  }
  tr.innerHTML = cellHtml;
  const rowLotSelect = tr.querySelector(".mt-ma-phan-lo");
  if (rowLotSelect) {
    if (bidData.maPhanLo) rowLotSelect.value = bidData.maPhanLo;
    rowLotSelect.addEventListener("change", () => {
      const selectedOpt = rowLotSelect.options[rowLotSelect.selectedIndex];
      const nameInput = tr.querySelector(".mt-ten-phan-lo");
      if (nameInput) {
        nameInput.value = selectedOpt ? selectedOpt.getAttribute("data-name") || "" : "";
      }
      const selectedLotCode = rowLotSelect.value;
      const chosenLot = lotList.find((l) => l.maPhanLo === selectedLotCode);
      if (chosenLot) {
        const dbInput = tr.querySelector(".mt-dam-bao-du-thau");
        if (dbInput) dbInput.value = this.model.formatVND(chosenLot.baoDamDuThau) || "";
        const gtDbInput = tr.querySelector(".mt-gia-tri-dam-bao");
        if (gtDbInput) gtDbInput.value = this.model.formatVND(chosenLot.baoDamDuThau) || "";
        const giaInput = tr.querySelector(".mt-gia-du-thau");
        if (giaInput && !giaInput.value.trim()) {
          giaInput.value = this.model.formatVND(chosenLot.giaTriPhanLo) || "";
        }
      }
    });
  }
  const selectLoai = tr.querySelector(".mt-loai-nha-thau");
  const jvContainer = tr.querySelector(".mt-jv-members-container");
  if (selectLoai && jvContainer) {
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
    const runRemoteLookup = async (code) => {
      const lookupInput = getPartnerLookupInput(code);
      if (!lookupInput || !tr.isConnected || inputMa.value.trim() !== code) return;
      const requestId = ++lookupRequestId;
      try {
        setRuntimeStyle(inputMa, "opacity", "0.7");
        const data = await lookupPartnerInfo({ ...lookupInput, partnerRole: "NT" });
        if (requestId !== lookupRequestId || !tr.isConnected || inputMa.value.trim() !== code) return;
        if (data?.name) {
          const lookupData = await mapPartnerLookupToContractor(code, data);
          if (requestId !== lookupRequestId || !tr.isConnected || inputMa.value.trim() !== code) return;
          inputMa.value = data.org_code || code;
          tr._leadMemberLookupData = lookupData;
          tr._leadMemberContractorId = "";
          tr.dataset.contractorVersionId = "";
          tr._leadMemberCode = normalizeContractorLookupCode(inputMa.value);
          const names = resolveOpeningLookupNames(
            tr.querySelector(".mt-loai-nha-thau")?.value,
            inputTen.value,
            data.name,
            tr._leadMemberName
          );
          inputTen.value = names.bidName;
          tr._leadMemberName = names.leadMemberName;
        }
      } catch (err) {
        console.error("New-contractor tax-code lookup during bid opening failed: ", err);
      } finally {
        if (requestId === lookupRequestId) setRuntimeStyle(inputMa, "opacity", "1");
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
        tr._leadMemberName = "";
        tr._leadMemberLookupData = null;
        tr._leadMemberContractorId = "";
        tr.dataset.contractorVersionId = "";
        tr._leadMemberCode = normalizedCode;
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
        tr._leadMemberLookupData = matched;
        const names = resolveOpeningLookupNames(
          tr.querySelector(".mt-loai-nha-thau")?.value,
          inputTen.value,
          matched.tenNhaThau,
          tr._leadMemberName
        );
        inputTen.value = names.bidName;
        tr._leadMemberName = names.leadMemberName;
        scheduleRemoteLookup.cancel();
        return;
      }
      scheduleRemoteLookup(code);
    };
    inputMa.addEventListener("input", handleCodeChange);
    inputMa.addEventListener("blur", () => scheduleRemoteLookup.flush());
    inputMa.addEventListener("pointerleave", () => scheduleRemoteLookup.flush());
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
      const price = this.model.parseVND(inputGia2.value);
      const discountPercentStr = (inputTyLe2.value || "0").replace(/,/g, ".");
      const discountPercent = parseFloat(discountPercentStr) || 0;
      const finalPrice = price * (1 - discountPercent / 100);
      inputSauGiam.value = this.model.formatVND(finalPrice);
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
      }
    };
  }
  tbody.appendChild(tr);
  const jvViewLink = tr.querySelector(".mt-jv-view-link");
  if (jvViewLink) {
    jvViewLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.openMoThauJVViewModal(tr._thanhVienLienDanh || [], tr._leadMemberName || ntName, ntCode, tr._leadMemberContractorId || "");
    });
  }
  if (typeof this.unifyTableInputsHeight === "function") {
    this.unifyTableInputsHeight(document);
  }
}
export async function saveThongTinMoThau() {
  const select = document.getElementById("mothau-goithau-select");
  if (!select) return;
  const gtId = select.value;
  if (!gtId) {
    await this.view.customAlert("Chưa chọn gói thầu", "Vui lòng chọn một gói thầu để lưu!", "alert-triangle", select);
    return;
  }
  const gt = this.model.state.goithau.find((g) => g.id === gtId);
  if (!gt) return;
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
    await this.view.customAlert("Thiếu dữ liệu", "Vui lòng nhập đầy đủ Mã nhà thầu và Tên nhà thầu cho tất cả các dòng!", "alert-triangle", openingRowsValidation.invalidInputs);
    return;
  }
  const jvRowsValidation = validateOpeningJointVentureMembers(rows);
  if (!jvRowsValidation.valid) {
    await this.view.customAlert("Trùng mã số thuế", "Các thành viên liên danh không được trùng mã số thuế hoặc mã nhà thầu. Vui lòng mở danh sách thành viên liên danh để kiểm tra lại!", "alert-triangle", jvRowsValidation.invalidInputs);
    return;
  }
  const tempBids = collectOpeningBidsFromRows({
    rows,
    gtId,
    model: this.model,
    isDirectOrSpecial
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
  this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter((b) => String(b.goiThauId) !== String(gtId));
  this.model.state.thongtinmothau.push(...tempBids);
  await this.model.persistData("thongtinmothau");
  gt.trangThai = "Đang chấm thầu";
  await this.model.persistData("goithau");
  const stepKey = is1G2T ? "opening_tech" : "opening";
  if (this.view._editingState) {
    this.view._editingState[stepKey] = false;
  }
  this.view.renderGoiThauTable();
  const syncResult = await this.autoSync();
  if (!syncResult?.ok) return;
  const successMsg = isDirectOrSpecial ? "Đã lưu thành công dữ liệu nhà thầu" : `Đã lưu toàn bộ thông tin mở thầu (E-HSDT / E-HSĐXKT) của gói thầu "${gt.tenGoiThau}" thành công! Trạng thái gói thầu đã được chuyển sang Đang chấm thầu.`;
  await this.view.customAlert("Lưu thành công", successMsg, "check-circle");
  this.renderMoThauPanel();
  const detailPane = document.getElementById("tab-goithau-detail");
  if (detailPane && detailPane.classList.contains("active")) {
    this.view._currentWorkflowTab = isDirectOrSpecial ? "result" : "eval_tech";
    this.view.showPackageDetails(gtId);
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
    await this.model.persistData("goithau");
    applyAutoPassedEvaluation({ gt, bids: tempBids, model: this.model });
    await this.model.persistData("thongtinmothau");
    await this.model.persistData("goithau");
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
    await this.model.persistData("goithau");
    await this.model.persistData("thongtinmothau");
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
    this.model.state.thongtinmothau = this.model.state.thongtinmothau.filter(
      (b) => String(b.goiThauId) !== String(gtId)
    );
    this.model.state.thongtinmothau.push(...snapshotBids);
    try {
      await this.model.persistData("goithau");
      await this.model.persistData("thongtinmothau");
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
