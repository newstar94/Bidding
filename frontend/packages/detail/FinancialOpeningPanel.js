import { bindCurrencyElement, formatPartnerIdentityCode } from "../../app/domUtils.js";
import { trustedHTML } from "../../shared/trustedTypes.js";
import { beginWorkspaceRender } from "../../shared/workspaceRenderCache.js";
import { renderBidContractorLink } from "./BidderTable.js";
import { authFetchDownloadWithAlert, escapeHtml } from "../../shared/view_helpers.js";
import { savePackageFinancialOpening, validateFinancialOpeningTime } from "../packageFinancialOpening.js";
import {
  isBidWithinEvaluationLotDetails,
  resolveActiveSavedEvaluationScope,
} from "../lotEvaluationScope.js";
import { checkBidQualified } from "./PackageTabs.js";
import {
  resolveWorkflowActionMode,
  WORKFLOW_ACTION_MODE,
} from "../workflowActionState.js";
import {
  evaluationMethodDisplay,
  evaluationMethodUsesTechnicalScore,
} from "../evaluationMethodRules.js";
import {
  parseEvaluationMetadataForDisplay,
  serializeEvaluationMetadata,
} from "../evaluationMetadata.js";

const financialOpeningCacheOwner = (pkg) => `financial-opening:${pkg?.id || "unknown"}`;

export function renderFinancialOpeningTable({
  model,
  pkg,
  bids = [],
  isReadOnly = false,
  canEdit = false,
  hasTechnicalScore = false
} = {}) {
  const cacheOwner = financialOpeningCacheOwner(pkg);
  beginWorkspaceRender(model, cacheOwner);
  const hasLots = pkg?.phanLo === "Có";
  const isConsulting = pkg?.linhVuc === "Tư vấn";
  const rows = bids.map((bid) => {
    const bidPrice = model.formatVND(bid.giaDuThau) || "";
    const discount = String(bid.tyLeGiamGia || 0).replace(".", ",");
    const finalPrice = model.formatVND(bid.giaSauGiamGia) || "";
    const validity = bid.hieuLucHsdt || "";
    const identity = escapeHtml(formatPartnerIdentityCode(bid.maNhaThau || bid.maDinhDanh, "--"));
    const contractor = renderBidContractorLink(
      model,
      bid,
      `${pkg.id}_financial_${isReadOnly ? "readonly" : "edit"}_${bid.id}`,
      { owner: cacheOwner },
    );
    const lotCells = hasLots ? `<td>${escapeHtml(bid.maPhanLo || "--")}</td><td>${escapeHtml(bid.tenPhanLo || "--")}</td>` : "";
    const scoreCell = hasTechnicalScore ? `<td class="text-center">${escapeHtml(bid.danhGiaKyThuat || "--")}</td>` : "";
    if (isReadOnly) {
      const validityText = validity ? `${validity}${String(validity).includes("ngày") ? "" : " ngày"}` : "--";
      return `<tr>${lotCells}<td>${identity}</td><td>${contractor}</td>${scoreCell}<td><span class="bf-money-display">${escapeHtml(bidPrice || "--")}</span></td><td class="text-right">${escapeHtml(discount)}</td><td><span class="bf-money-display">${escapeHtml(finalPrice || "--")}</span></td>${isConsulting ? `<td>${escapeHtml(validityText)}</td>` : ""}</tr>`;
    }
    const validityValue = validity ? `${validity}${String(validity).includes("ngày") ? "" : " ngày"}` : "";
    return `<tr data-opening-bid-id="${escapeHtml(bid.id)}">${lotCells}<td>${identity}</td><td>${contractor}</td>${scoreCell}
      <td><input type="text" class="form-control op-gia-du-thau table-input-compact" value="${escapeHtml(bidPrice)}" placeholder="Nhập giá..."></td>
      <td><input type="text" class="form-control op-ty-le-giam table-input-compact text-right" value="${escapeHtml(discount)}" placeholder="0"></td>
      <td><input type="text" class="form-control op-gia-sau-giam table-input-compact readonly-soft" value="${escapeHtml(finalPrice)}" readonly></td>
      ${isConsulting ? `<td><input type="text" class="form-control op-hieu-luc-hsdt table-input-compact" value="${escapeHtml(validityValue)}" placeholder="Ví dụ: 90 ngày"></td>` : ""}
    </tr>`;
  }).join("");
  return `<p class="text-muted package-help-text">Nhập giá dự thầu, tỷ lệ giảm giá của các nhà thầu vượt qua bước đánh giá kỹ thuật.</p>
    <div class="table-container package-table-frame has-bottom-space">
      <table class="data-table table-full-width" id="opening-fin-table"><thead><tr>
        ${hasLots ? '<th class="col-number">Mã phần lô</th><th class="col-lot-name">Tên phần lô</th>' : ""}
        <th>Mã nhà thầu</th><th>Tên nhà thầu</th>${hasTechnicalScore ? '<th class="col-score text-center">Điểm kỹ thuật</th>' : ""}
        <th class="col-price">Giá dự thầu (VNĐ)</th><th class="col-index">Tỷ lệ %</th><th class="col-price">Giá sau giảm</th>
        ${isConsulting ? '<th class="col-validity">Hiệu lực E-HSĐXTC</th>' : ""}
      </tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="workflow-action-row">${isReadOnly
      ? canEdit ? '<button class="btn btn-primary workflow-primary-action" id="btn-edit-opening-fin"><i data-lucide="edit"></i> Chỉnh sửa</button>' : ""
      : '<button class="btn btn-primary workflow-primary-action" id="btn-save-opening-fin"><i data-lucide="save"></i> Lưu Biên bản mở E-HSĐXTC</button>'}
    </div>`;
}

export function bindFinancialOpeningRows(container, { parseVND, formatVND } = {}) {
  const rows = Array.from(container?.querySelectorAll?.("#opening-fin-table tbody tr") || []);
  rows.forEach((row) => {
    const priceInput = row.querySelector(".op-gia-du-thau");
    const discountInput = row.querySelector(".op-ty-le-giam");
    const finalPriceInput = row.querySelector(".op-gia-sau-giam");
    const recalculate = () => {
      const base = parseVND(priceInput?.value || "");
      const percent = Number.parseFloat(String(discountInput?.value || "0").replace(/,/g, ".")) || 0;
      if (finalPriceInput) finalPriceInput.value = formatVND(base * (1 - percent / 100)) || "";
    };
    const clearInvalid = (input) => {
      input?.classList?.remove("field-invalid");
      input?.removeAttribute?.("aria-invalid");
    };
    if (priceInput) {
      bindCurrencyElement(priceInput, formatVND);
      priceInput.addEventListener("input", () => {
        clearInvalid(priceInput);
        recalculate();
      });
    }
    discountInput?.addEventListener("input", () => {
      clearInvalid(discountInput);
      recalculate();
    });
    row.querySelector(".op-hieu-luc-hsdt")?.addEventListener("input", (event) => clearInvalid(event.currentTarget));
  });
  return rows;
}

function parseDiscount(value) {
  const normalized = String(value ?? "").trim().replace(/,/g, ".");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number.parseFloat(normalized);
}

function parseValidityDays(value) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(/^(\d+)\s*(?:ngày)?$/i);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

export function validateFinancialOpeningRows(rows, { parseVND, isConsulting = false } = {}) {
  const invalidInputs = [];
  const errors = [];
  const addError = (input, message) => {
    if (input && !invalidInputs.includes(input)) invalidInputs.push(input);
    errors.push(message);
  };

  (rows || []).forEach((row, index) => {
    const rowNumber = index + 1;
    const priceInput = row.querySelector?.(".op-gia-du-thau");
    const discountInput = row.querySelector?.(".op-ty-le-giam");
    const validityInput = row.querySelector?.(".op-hieu-luc-hsdt");
    const priceRaw = String(priceInput?.value ?? "").trim();
    const price = priceRaw ? Number(parseVND?.(priceRaw)) : Number.NaN;
    const discount = parseDiscount(discountInput?.value);

    if (!Number.isFinite(price) || price <= 0) {
      addError(priceInput, `Dòng ${rowNumber}: Giá dự thầu phải lớn hơn 0.`);
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      addError(discountInput, `Dòng ${rowNumber}: Tỷ lệ giảm giá phải từ 0 đến 100%.`);
    }
    if (isConsulting) {
      const validityDays = parseValidityDays(validityInput?.value);
      if (!Number.isInteger(validityDays) || validityDays <= 0) {
        addError(validityInput, `Dòng ${rowNumber}: Hiệu lực E-HSĐXTC phải là số ngày lớn hơn 0.`);
      }
    }
  });

  return { valid: errors.length === 0, invalidInputs, errors };
}

export function markFinancialOpeningInvalid(inputs = []) {
  inputs.forEach((input) => {
    input?.classList?.add("field-invalid");
    input?.setAttribute?.("aria-invalid", "true");
  });
}

export function collectFinancialOpeningRows(rows, { parseVND } = {}) {
  return (rows || []).map((row) => {
    const validityInput = row.querySelector(".op-hieu-luc-hsdt");
    const giaDuThau = parseVND(row.querySelector(".op-gia-du-thau")?.value || "");
    const tyLeGiamGia = Number.parseFloat(String(row.querySelector(".op-ty-le-giam")?.value || "0").replace(/,/g, ".")) || 0;
    return {
      id: row.getAttribute("data-opening-bid-id"),
      giaDuThau,
      tyLeGiamGia,
      giaSauGiamGia: giaDuThau * (1 - tyLeGiamGia / 100),
      hieuLucHsdt: validityInput ? Number.parseInt(validityInput.value, 10) || 0 : null
    };
  });
}

function parseOpeningMetadata(pkg) {
  return parseEvaluationMetadataForDisplay(pkg?.danhGiaHsdtMetadata).metadata;
}

function compareOpeningBids(left, right) {
  const lotComparison = String(left?.maPhanLo || "").localeCompare(
    String(right?.maPhanLo || ""),
    "vi",
    { numeric: true, sensitivity: "base" },
  );
  if (lotComparison) return lotComparison;
  return String(left?.maNhaThau || left?.maDinhDanh || "").localeCompare(
    String(right?.maNhaThau || right?.maDinhDanh || ""),
    "vi",
    { numeric: true, sensitivity: "base" },
  );
}

function hasTechnicalScore(pkg, bids) {
  return bids.some((bid) => {
    const normalized = String(bid?.danhGiaKyThuat || "").trim().replace(/,/g, ".");
    return normalized !== "" && Number.isFinite(Number.parseFloat(normalized));
  }) || evaluationMethodUsesTechnicalScore(pkg);
}

export function buildFinancialOpeningState({
  view,
  pkg,
  effectiveStatus = pkg?.trangThai || "",
} = {}) {
  const metadata = parseOpeningMetadata(pkg);
  const technicalScope = resolveActiveSavedEvaluationScope(pkg, metadata.technical || {});
  const qualifiedBids = (view?.model?.state?.thongtinmothau || [])
    .filter((bid) => String(bid?.goiThauId || "") === String(pkg?.id || ""))
    .filter((bid) => !technicalScope || isBidWithinEvaluationLotDetails(bid, technicalScope))
    .filter((bid) => checkBidQualified(bid, pkg))
    .sort(compareOpeningBids);
  const scopedOpening = technicalScope?.batch?.financialOpening || {};
  const financialScope = resolveActiveSavedEvaluationScope(pkg, metadata.financial || {});
  const isFinancialEvaluationSaved = Boolean(
    metadata.financial
    && (metadata.financial.saved || financialScope?.batch?.saved)
  );
  const isCompleted = Boolean(scopedOpening.saved)
    || qualifiedBids.some((bid) => Number(bid?.giaDuThau) > 0);
  const isEditing = Boolean(view?._editingState?.opening_fin);
  const isFinal = effectiveStatus === "Đã có kết quả" || effectiveStatus === "Hủy thầu";
  const actionMode = resolveWorkflowActionMode({
    isCompleted,
    isEditing,
    isNextStepSaved: isFinancialEvaluationSaved,
    isFinal,
  });
  const isReadOnly = actionMode !== WORKFLOW_ACTION_MODE.SAVE;

  return {
    pkg,
    metadata,
    technicalScope,
    scopedOpening,
    qualifiedBids,
    hasTechnicalScore: hasTechnicalScore(pkg, qualifiedBids),
    isCompleted,
    isFinancialEvaluationSaved,
    actionMode,
    isReadOnly,
    canEdit: actionMode === WORKFLOW_ACTION_MODE.EDIT,
  };
}

function renderFinancialOpeningFacts(view, state) {
  const { pkg, scopedOpening, isReadOnly } = state;
  const plan = view.model.getLatestPlan(pkg.keHoachId);
  const investor = plan
    ? view.model.state.chudautu.find((item) => item.id === plan.chuDauTuId)
    : null;
  const directOrSpecial = pkg.hinhThucLuaChon === "Chỉ định thầu rút gọn"
    || pkg.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
  const openingTime = scopedOpening.openingTime || pkg.thoiGianMoEhsdxtc || "";
  const financialOpeningControl = isReadOnly
    ? `<span class="text-dark fw-bold">${openingTime ? escapeHtml(view.model.formatDateWithTime(openingTime)) : "Chưa mở"}</span>`
    : `<input type="text" id="op-fin-thoigianmothau" class="form-control flatpickr-datetime bf-s-ab24ccb4e7" value="${openingTime ? escapeHtml(view.model.formatForDatetimeLocal(openingTime)) : ""}" placeholder="dd/MM/yyyy HH:mm">`;

  return `
    <div class="bf-s-8bd3eb473c">
      <div class="bf-s-5d398becec">Thông số Gói thầu</div>
      <div class="bf-s-13b5590e90">
        <div>• <strong class="bf-s-fcb5ddef65">Chủ đầu tư:</strong> <span class="text-dark fw-bold">${escapeHtml(investor?.tenChuDauTu || "Không rõ")}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Tên kế hoạch:</strong> <span class="text-dark fw-bold">${escapeHtml(plan?.tenKeHoach || "Không rõ")}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Lĩnh vực:</strong> ${escapeHtml(pkg.linhVuc || "Hàng hóa")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Phương thức LCNT:</strong> ${escapeHtml(pkg.phuongThucLuaChon || "Một giai đoạn một túi hồ sơ")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Phân lô:</strong> ${pkg.phanLo === "Có" ? "Có chia phần lô" : "Không chia phần lô"}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Giá gói thầu:</strong> <span class="text-dark fw-bold">${escapeHtml(view.model.formatCurrency(pkg.giaGoiThau))}</span></div>
        <div>• <strong class="bf-s-fcb5ddef65">Hình thức LCNT:</strong> ${escapeHtml(pkg.hinhThucLuaChon || "--")}</div>
        ${pkg.phuongPhapDanhGia ? `<div>• <strong class="bf-s-fcb5ddef65">Phương pháp đánh giá:</strong> ${escapeHtml(evaluationMethodDisplay(pkg))}</div>` : ""}
        <div>• <strong class="bf-s-fcb5ddef65">Loại hợp đồng:</strong> ${escapeHtml(pkg.loaiHopDong || "--")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Thời gian thực hiện:</strong> ${escapeHtml(pkg.thoiGianThucHien || "--")}</div>
        <div>• <strong class="bf-s-fcb5ddef65">Nguồn vốn:</strong> ${escapeHtml(pkg.nguonVon || "--")}</div>
        ${directOrSpecial ? "" : `
          <div>• <strong class="bf-s-fcb5ddef65">Thời gian đóng thầu:</strong> ${pkg.thoiGianDongThau ? escapeHtml(view.model.formatDateWithTime(pkg.thoiGianDongThau)) : "--"}</div>
          <div>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXKT:</strong> <span class="text-dark fw-bold">${pkg.thoiGianMoThau ? escapeHtml(view.model.formatDateWithTime(pkg.thoiGianMoThau)) : "--"}</span></div>
          <div class="bf-s-ca978d48b2"><span>• <strong class="bf-s-fcb5ddef65">Thời gian mở E-HSĐXTC:</strong></span>${financialOpeningControl}</div>
        `}
      </div>
      ${isReadOnly ? '<div class="package-lock-notice" role="status"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Biên bản mở E-HSĐXTC đã được khóa</div>' : ""}
    </div>`;
}

function stageScopedFinancialOpening(state, openingTime) {
  if (!state.technicalScope?.batch) return;
  state.technicalScope.batch.financialOpening = { saved: true, openingTime };
  state.pkg.danhGiaHsdtMetadata = serializeEvaluationMetadata(state.metadata);
}

function bindFinancialOpeningPanel(view, contentWrapper, state, appController) {
  if (!state.isReadOnly) {
    const rows = bindFinancialOpeningRows(contentWrapper, {
      parseVND: (value) => view.model.parseVND(value),
      formatVND: (value) => view.model.formatVND(value),
    });
    const importButton = contentWrapper.querySelector("#btn-opening-fin-import-excel");
    if (importButton) importButton.onclick = () => appController?.triggerExcelImport("opening_fin");

    const saveButton = contentWrapper.querySelector("#btn-save-opening-fin");
    if (saveButton) {
      saveButton.onclick = async () => {
        const timeInput = contentWrapper.querySelector("#op-fin-thoigianmothau");
        const openingTime = timeInput?.value
          ? view.model.convertDMYHMSToYMDHMS(timeInput.value)
          : "";
        timeInput?.classList.remove("field-invalid");
        timeInput?.removeAttribute("aria-invalid");
        timeInput?.addEventListener("input", () => {
          timeInput.classList.remove("field-invalid");
          timeInput.removeAttribute("aria-invalid");
        }, { once: true });

        const timeValidation = validateFinancialOpeningTime({
          required: Boolean(timeInput),
          rawValue: timeInput?.value || "",
          convertedValue: openingTime,
          technicalOpeningTime: state.pkg.thoiGianMoThau || "",
        });
        const rowValidation = validateFinancialOpeningRows(rows, {
          parseVND: (value) => view.model.parseVND(value),
          isConsulting: state.pkg.linhVuc === "Tư vấn",
        });
        const invalidInputs = [
          ...(!timeValidation.valid && timeInput ? [timeInput] : []),
          ...rowValidation.invalidInputs,
        ];
        if (!timeValidation.valid || !rowValidation.valid) {
          markFinancialOpeningInvalid(invalidInputs);
          const messages = [timeValidation.message, ...rowValidation.errors].filter(Boolean);
          await view.customAlert("Dữ liệu không hợp lệ", messages.join("\n"), "alert-triangle", invalidInputs[0]);
          view.focusInvalidControl(invalidInputs[0]);
          return;
        }

        stageScopedFinancialOpening(state, openingTime);
        await savePackageFinancialOpening(
          appController || view,
          state.pkg,
          collectFinancialOpeningRows(rows, { parseVND: (value) => view.model.parseVND(value) }),
          { openingTime },
        );
        if (view._editingState) view._editingState.opening_fin = false;
        await view.customAlert("Thành công", "Đã lưu Biên bản mở thầu E-HSĐXTC thành công!", "check-circle");
        view._currentWorkflowTab = "eval_fin";
        view.showPackageDetails(state.pkg.id);
      };
    }
  }

  const exportButton = contentWrapper.querySelector("#btn-opening-fin-export-excel");
  if (exportButton) {
    exportButton.onclick = () => {
      const safeCode = (state.pkg.maGoiThau || "GoiThau")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .trim()
        .substring(0, 30);
      void authFetchDownloadWithAlert(
        view,
        `/api/export-opening-fin-template?package_id=${encodeURIComponent(state.pkg.id)}&package_name=${encodeURIComponent(safeCode)}`,
        `Mau_Mo_Tai_Chinh_${safeCode}.xlsx`,
      );
    };
  }
  const editButton = contentWrapper.querySelector("#btn-edit-opening-fin");
  if (editButton) {
    editButton.onclick = () => {
      view._editingState = view._editingState || {};
      view._editingState.opening_fin = true;
      view.showPackageDetails(state.pkg.id);
    };
  }
}

export function renderFinancialOpeningPanel(view, {
  contentWrapper,
  pkg,
  effectiveStatus,
  appController,
} = {}) {
  beginWorkspaceRender(view?.model, financialOpeningCacheOwner(pkg));
  const state = buildFinancialOpeningState({ view, pkg, effectiveStatus });
  if (!state.qualifiedBids.length) {
    contentWrapper.innerHTML = trustedHTML(`
      <div class="bf-s-71ff99332d">
        <i data-lucide="lock" class="bf-s-5141e22887"></i>
        <h4 class="bf-s-01dd0d67e8">Chưa mở túi hồ sơ Đề xuất Tài chính</h4>
        <p class="bf-s-85ddf1c3bf">Vui lòng hoàn thành Đánh giá kỹ thuật để xác định danh sách nhà thầu đủ điều kiện mở túi HSĐXTC.</p>
      </div>`);
    return state;
  }

  contentWrapper.innerHTML = trustedHTML(`
    <div class="bf-s-175e7e1f51">
      <h4 class="bf-s-ff3bca23d8">Biên bản mở hồ sơ đề xuất tài chính (E-HSĐXTC)</h4>
      ${state.isReadOnly ? "" : '<div class="bf-s-9c40389b4a"><button class="btn-excel-action btn-download-excel-template-direct" data-type="opening_fin" id="btn-opening-fin-export-excel"><i data-lucide="download"></i> Tải Excel Mẫu</button><button class="btn-excel-action btn-import-excel-direct" data-type="opening_fin" id="btn-opening-fin-import-excel"><i data-lucide="upload"></i> Nhập từ Excel</button></div>'}
    </div>
    ${renderFinancialOpeningFacts(view, state)}
    ${renderFinancialOpeningTable({
      model: view.model,
      pkg,
      bids: state.qualifiedBids,
      isReadOnly: state.isReadOnly,
      canEdit: state.canEdit,
      hasTechnicalScore: state.hasTechnicalScore,
    })}`);
  view.initFlatpickr?.(contentWrapper);
  bindFinancialOpeningPanel(view, contentWrapper, state, appController);
  return state;
}
