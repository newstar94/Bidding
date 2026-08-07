import { executeAppCommand } from "../app/commandBus.js";
import { bindCurrencyElement, formatPartnerIdentityCode } from "../app/domUtils.js";
import {
  getExactContractorVersion,
  resolveBidContractorName,
  resolveBidJointVentureMembers,
  resolveContractorVersion,
} from "../partners/contractorVersionBinding.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import { updateRowConclusion } from "./bidEvaluationActions.js";
import {
  isProposedAwardPriceBelowHalf,
  normalizeLowPriceAcceptance,
} from "./bidEvaluationLowPriceRules.js";
import {
  requiresTechnicalScoreInput,
  validateTechnicalScore,
} from "./evaluationMethodRules.js";
import { isViolationConfirmed } from "./openingContractorLookup.js";
import { setJvData } from "./jvDataStore.js";

const TECHNICAL_CASES = new Set(["TU_VAN", "1G2T_NO_LOT", "1G2T_WITH_LOT"]);
const FINANCIAL_CASES = new Set(["1G2T_TC_NO_LOT", "1G2T_TC_WITH_LOT"]);

function durationText(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.includes("ngày") ? raw : `${raw} ngày`;
}

export function resolveBidEvaluationRowReadOnly({ isReadOnly = false } = {}) {
  return Boolean(isReadOnly);
}

export function buildContractorDisplay({ pkg, bid, model }) {
  let contractorCode = bid.maNhaThau || bid.maDinhDanh || "--";
  const contractorName = resolveBidContractorName(model, bid) || "--";
  const exactContractor = getExactContractorVersion(model, bid.nhaThauId)
    || resolveContractorVersion(model, bid);
  if (exactContractor) contractorCode = exactContractor.maNhaThau || contractorCode;

  let html;
  const violationConfirmed = isViolationConfirmed(bid.violationStatus);
  const violationClass = violationConfirmed ? " bidder-name--violator" : "";
  if (bid.loaiNhaThau === "Liên danh") {
    const jvKey = `${pkg.id}_eval_bidder_${bid.id}`;
    setJvData(jvKey, {
      members: resolveBidJointVentureMembers(model, bid),
      leadName: contractorName,
      leadCode: contractorCode,
      leadContractorVersionId: bid.nhaThauId || "",
    });
    html = `<a href="#" class="mt-jv-view-link text-success fw-bold link-hover" data-jv-key="${escapeHtml(jvKey)}" title="Xem thành viên liên danh">👥 ${escapeHtml(contractorName)}</a>`;
  } else {
    const contractorId = exactContractor?.id || "";
    const colorClass = violationConfirmed ? "" : " text-blue";
    html = contractorId
      ? `<a href="#" data-bf-action="show-contractor" data-id="${escapeHtml(contractorId)}" class="fw-bold link-hover${colorClass}${violationClass}">${escapeHtml(contractorName)}</a>`
      : `<span class="fw-bold${violationClass}">${escapeHtml(contractorName)}</span>`;
  }
  return { contractorCode, html };
}

function buildIdentityCells({ pkg, bid, contractor }) {
  const lotCells = pkg.phanLo === "Có"
    ? `
      <td>${escapeHtml(bid.maPhanLo || "--")}</td>
      <td>${escapeHtml(bid.tenPhanLo || "--")}</td>
    `
    : "";
  return `${lotCells}
    <td>${escapeHtml(bid.loaiNhaThau || "Độc lập")}</td>
    <td>${escapeHtml(formatPartnerIdentityCode(contractor.contractorCode, "--"))}</td>
    <td>${contractor.html}</td>
  `;
}

function formatOptionalMoney(model, value) {
  return value === null || value === void 0 || value === ""
    ? ""
    : model.formatVND(value) || "";
}

function buildLowPriceDecision({ pkg, bid, proposedAwardPrice, rowReadOnly, disabled }) {
  const isWarning = isProposedAwardPriceBelowHalf(pkg, bid, proposedAwardPrice);
  const decision = normalizeLowPriceAcceptance(bid.chapThuanGiaDeNghiTrungThauDuoi50);
  const radioName = `low-price-acceptance-${String(bid.id || "bid")}`;
  const controlDisabled = rowReadOnly || Boolean(disabled);
  return {
    isWarning,
    html: `
      <div class="evaluation-low-price-decision" role="radiogroup" aria-label="Xử lý giá đề nghị trúng thầu dưới 50%"${isWarning ? "" : " hidden"}>
        <span class="evaluation-low-price-decision-title">Giá dưới 50%:</span>
        <label class="evaluation-low-price-option">
          <input type="radio" class="mt-low-price-acceptance" name="${safeAttr(radioName)}" value="true"${decision === true ? " checked" : ""}${controlDisabled ? " disabled" : ""}>
          <span>Chấp thuận</span>
        </label>
        <label class="evaluation-low-price-option">
          <input type="radio" class="mt-low-price-acceptance" name="${safeAttr(radioName)}" value="false"${decision === false ? " checked" : ""}${controlDisabled ? " disabled" : ""}>
          <span>Không chấp thuận</span>
        </label>
      </div>
    `,
  };
}

function buildEvaluationPriceCells({ pkg, bid, model, rowReadOnly, disabled = "" }) {
  const rankingPrice = formatOptionalMoney(model, bid.giaXepHang);
  const proposedAwardPrice = formatOptionalMoney(model, bid.giaDeNghiTrungThau);
  const lowPriceDecision = buildLowPriceDecision({
    pkg,
    bid,
    proposedAwardPrice: bid.giaDeNghiTrungThau,
    rowReadOnly,
    disabled,
  });
  const warningClass = lowPriceDecision.isWarning ? " is-low-price-warning" : "";
  if (rowReadOnly) {
    return `
      <td><span>${escapeHtml(rankingPrice || "--")}</span></td>
      <td>
        <span class="evaluation-proposed-award-price${warningClass}">${escapeHtml(proposedAwardPrice || "--")}</span>
        ${lowPriceDecision.html}
      </td>
    `;
  }
  return `
    <td><input type="text" class="form-control mt-gia-xep-hang" value="${escapeHtml(rankingPrice)}" placeholder="Nhập giá xếp hạng..."${disabled}></td>
    <td>
      <input type="text" class="form-control mt-gia-de-nghi-trung-thau${warningClass}" value="${escapeHtml(proposedAwardPrice)}" placeholder="Nhập giá đề nghị..."${disabled}>
      ${lowPriceDecision.html}
    </td>
  `;
}

function buildFinancialCells({ pkg, bid, model, presentation, rowReadOnly }) {
  const bidPrice = bid.giaDuThau ? model.formatVND(bid.giaDuThau) : "";
  const discount = bid.tyLeGiamGia !== void 0 ? model.formatVND(bid.tyLeGiamGia) : "0";
  const discountedPrice = bid.giaSauGiamGia ? model.formatVND(bid.giaSauGiamGia) : "";
  const bidValidity = bid.hieuLucHsdt || "";
  const clarification = bid.lamRoTaiChinh || "";
  const financialEvaluation = bid.danhGiaTaiChinh || "";
  const validityCell = presentation.isConsulting
    ? `<td><${rowReadOnly ? "span" : "input"}${rowReadOnly
      ? `>${escapeHtml(durationText(bidValidity, "--"))}</span>`
      : ` type="text" class="form-control mt-hieu-luc-hsdt bf-s-9eae6acf9f" value="${escapeHtml(durationText(bidValidity))}" readonly placeholder="Ví dụ: 90 ngày">`}</td>`
    : "";
  const combinedCells = presentation.showCombinedScore
    ? `
      <td><span>${escapeHtml(bid.danhGiaKyThuat || "--")}</span></td>
      <td><span class="mt-combined-score bf-s-c6fa01b3f1">--</span></td>
    `
    : "";

  if (rowReadOnly) {
    return `
      <td><span>${escapeHtml(bidPrice || "--")}</span></td>
      <td class="bf-s-5f326564a5"><span>${escapeHtml(discount)}</span></td>
      <td><span>${escapeHtml(discountedPrice || "--")}</span></td>
      ${buildEvaluationPriceCells({ pkg, bid, model, rowReadOnly })}
      ${validityCell}
      <td><span>${escapeHtml(clarification || "--")}</span></td>
      ${combinedCells}
      <td><span class="mt-dg-tai-chinh bf-s-6e8bcfac8d" aria-label="Xếp hạng tự động">${escapeHtml(financialEvaluation || "--")}</span></td>
    `;
  }
  return `
    <td><input type="text" class="form-control mt-gia-du-thau bf-s-9eae6acf9f" value="${escapeHtml(bidPrice)}" readonly placeholder="Ví dụ: 1.000.000.000"></td>
    <td><input type="text" class="form-control mt-ty-le-giam-gia bf-s-b42165990f" value="${escapeHtml(discount)}" readonly placeholder="0"></td>
    <td><input type="text" class="form-control mt-gia-sau-giam-gia bf-s-9eae6acf9f" value="${escapeHtml(discountedPrice)}" readonly placeholder="......"></td>
    ${buildEvaluationPriceCells({ pkg, bid, model, rowReadOnly })}
    ${validityCell}
    <td><input type="text" class="form-control mt-lam-ro-tai-chinh bf-s-bce22e1c53" value="${escapeHtml(clarification)}" placeholder="Nhập làm rõ tài chính..."></td>
    ${combinedCells}
    <td><span class="mt-dg-tai-chinh bf-s-6e8bcfac8d" aria-label="Xếp hạng tự động">${escapeHtml(financialEvaluation || "--")}</span></td>
  `;
}

function buildTechnicalFacts({ pkg, bid, model, presentation, rowReadOnly, forceDisabled = false }) {
  const technicalLayout = TECHNICAL_CASES.has(presentation.caseType);
  const bidValidity = durationText(bid.hieuLucHsdt, rowReadOnly ? "--" : "");
  const performanceTime = escapeHtml(bid.thoiGianThucHien || pkg.thoiGianThucHien || (rowReadOnly ? "--" : ""));
  const securityValidity = durationText(bid.hieuLucBaoDamNgay, rowReadOnly ? "--" : "");

  if (!technicalLayout) {
    if (rowReadOnly) {
      return `
        <td><span>${bid.giaDuThau ? escapeHtml(model.formatVND(bid.giaDuThau)) : "--"}</span></td>
        <td class="bf-s-5f326564a5"><span>${bid.tyLeGiamGia !== void 0 ? escapeHtml(model.formatVND(bid.tyLeGiamGia)) : "0"}</span></td>
        <td><span>${bid.giaSauGiamGia ? escapeHtml(model.formatVND(bid.giaSauGiamGia)) : "--"}</span></td>
        ${buildEvaluationPriceCells({ pkg, bid, model, rowReadOnly })}
        <td><span>${escapeHtml(bidValidity)}</span></td>
        <td><span>${bid.giaTriDamBao ? escapeHtml(model.formatVND(bid.giaTriDamBao)) : "--"}</span></td>
        <td><span>${escapeHtml(securityValidity)}</span></td>
        <td><span>${performanceTime}</span></td>
      `;
    }
    return `
      <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.giaDuThau ? escapeHtml(model.formatVND(bid.giaDuThau)) : ""}" readonly></td>
      <td><input type="text" class="form-control bf-s-b42165990f" value="${bid.tyLeGiamGia !== void 0 ? escapeHtml(model.formatVND(bid.tyLeGiamGia)) : "0"}" readonly></td>
      <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.giaSauGiamGia ? escapeHtml(model.formatVND(bid.giaSauGiamGia)) : ""}" readonly></td>
      ${buildEvaluationPriceCells({ pkg, bid, model, rowReadOnly, disabled: forceDisabled ? " disabled" : "" })}
      <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(bidValidity)}" readonly></td>
      <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${bid.giaTriDamBao ? escapeHtml(model.formatVND(bid.giaTriDamBao)) : ""}" readonly></td>
      <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(securityValidity)}" readonly></td>
      <td><input type="text" class="form-control bf-s-9eae6acf9f" value="${performanceTime}" readonly></td>
    `;
  }
  if (presentation.caseType === "TU_VAN") {
    return rowReadOnly
      ? `<td><span>${escapeHtml(bidValidity)}</span></td><td><span>${performanceTime}</span></td>`
      : `<td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(bidValidity)}" readonly></td><td><input type="text" class="form-control bf-s-9eae6acf9f" value="${performanceTime}" readonly></td>`;
  }
  const securityValue = bid.giaTriDamBao ? model.formatVND(bid.giaTriDamBao) : "";
  return rowReadOnly
    ? `<td><span>${securityValue ? escapeHtml(securityValue) : "--"}</span></td><td><span>${escapeHtml(securityValidity)}</span></td><td><span>${escapeHtml(bidValidity)}</span></td>`
    : `<td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(securityValue)}" readonly></td><td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(securityValidity)}" readonly></td><td><input type="text" class="form-control bf-s-9eae6acf9f" value="${escapeHtml(bidValidity)}" readonly></td>`;
}

function readOnlyEvaluationCells({ bid, presentation }) {
  const technicalLayout = TECHNICAL_CASES.has(presentation.caseType);
  return `
    <td>
      <span class="mt-dg-hop-le bf-s-6e8bcfac8d">${escapeHtml(bid.danhGiaHopLe || "--")}</span>
      ${bid.nguyenNhanKhongDatHopLe ? `<div class="bf-s-1e3e1388dc">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatHopLe)}</div>` : ""}
    </td>
    <td><span>${escapeHtml(bid.lamRoHopLe || "--")}</span></td>
    <td>
      <span class="mt-dg-nang-luc bf-s-6e8bcfac8d">${escapeHtml(bid.danhGiaNangLuc || "--")}</span>
      ${bid.nguyenNhanKhongDatNangLuc ? `<div class="bf-s-1e3e1388dc">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatNangLuc)}</div>` : ""}
    </td>
    <td><span>${escapeHtml(bid.lamRoNangLuc || "--")}</span></td>
    <td>
      <span class="mt-dg-ky-thuat bf-s-6e8bcfac8d">${escapeHtml(bid.danhGiaKyThuat || "--")}</span>
      ${bid.nguyenNhanKhongDatKyThuat ? `<div class="bf-s-1e3e1388dc">Lý do: ${escapeHtml(bid.nguyenNhanKhongDatKyThuat)}</div>` : ""}
    </td>
    <td><span>${escapeHtml(bid.lamRoKyThuat || "--")}</span></td>
    ${technicalLayout ? "" : `<td><span>${escapeHtml(bid.lamRoTaiChinh || "--")}</span></td>`}
    ${presentation.showCombinedScore ? '<td><span class="mt-combined-score bf-s-c6fa01b3f1">--</span></td>' : ""}
    <td class="mt-ketluan-cell bf-s-0c5104285b"></td>
    ${technicalLayout ? "" : `<td><span class="mt-dg-xep-hang bf-s-6e8bcfac8d">${escapeHtml(bid.danhGiaTaiChinh || "--")}</span></td>`}
  `;
}

function editableEvaluationCells({ pkg, bid, presentation, forceDisabled }) {
  const technicalLayout = TECHNICAL_CASES.has(presentation.caseType);
  const disabled = forceDisabled ? " disabled" : "";
  const waiting = forceDisabled ? "Chờ đánh giá hạng trên..." : "";
  const technicalScoreRequired = requiresTechnicalScoreInput(pkg);
  const technicalPlaceholder = waiting || (technicalScoreRequired
    ? "Nhập điểm kỹ thuật..."
    : "Điểm hoặc Đạt...");
  const technicalInputAttributes = technicalScoreRequired
    ? 'type="number" inputmode="decimal" min="0" step="any" required'
    : 'type="text"';
  return `
    <td>
      <select class="form-control mt-dg-hop-le"${disabled} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
        <option value="Đạt" ${bid.danhGiaHopLe === "Đạt" || !bid.danhGiaHopLe ? "selected" : ""}>Đạt</option>
        <option value="Không đạt" ${bid.danhGiaHopLe === "Không đạt" ? "selected" : ""}>Không đạt</option>
      </select>
      <input type="text" class="form-control mt-reason-fail-hople" value="${escapeHtml(bid.nguyenNhanKhongDatHopLe || "")}" placeholder="Lý do không đạt hợp lệ..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${bid.danhGiaHopLe === "Không đạt" ? "block" : "none"};"${disabled}>
    </td>
    <td><input type="text" class="form-control mt-lam-ro-hop-le"${disabled} value="${escapeHtml(bid.lamRoHopLe || "")}" placeholder="${waiting || "Nhập làm rõ hợp lệ..."}"></td>
    <td>
      <select class="form-control mt-dg-nang-luc"${disabled} style="padding: 4px 6px; font-size:0.8rem; font-weight:600; width: 100%;">
        <option value="Đạt" ${bid.danhGiaNangLuc === "Đạt" || !bid.danhGiaNangLuc ? "selected" : ""}>Đạt</option>
        <option value="Không đạt" ${bid.danhGiaNangLuc === "Không đạt" ? "selected" : ""}>Không đạt</option>
      </select>
      <input type="text" class="form-control mt-reason-fail-nangluc" value="${escapeHtml(bid.nguyenNhanKhongDatNangLuc || "")}" placeholder="Lý do không đạt năng lực..." style="margin-top: 4px; padding: 4px 6px; font-size: 0.75rem; width: 100%; display: ${bid.danhGiaNangLuc === "Không đạt" ? "block" : "none"};"${disabled}>
    </td>
    <td><input type="text" class="form-control mt-lam-ro-nang-luc"${disabled} value="${escapeHtml(bid.lamRoNangLuc || "")}" placeholder="${waiting || "Nhập làm rõ năng lực..."}"></td>
    <td>
      <input ${technicalInputAttributes} class="form-control mt-dg-ky-thuat"${disabled} value="${escapeHtml(bid.danhGiaKyThuat || "")}" placeholder="${technicalPlaceholder}" aria-label="${technicalScoreRequired ? "Điểm kỹ thuật" : "Đánh giá kỹ thuật"}">
      <input type="text" class="form-control mt-reason-fail-kythuat bf-s-32fe8a23fe" value="${escapeHtml(bid.nguyenNhanKhongDatKyThuat || "")}" placeholder="Lý do không đạt kỹ thuật..."${disabled}>
    </td>
    <td><input type="text" class="form-control mt-lam-ro-ky-thuat"${disabled} value="${escapeHtml(bid.lamRoKyThuat || "")}" placeholder="${waiting || "Nhập làm rõ kỹ thuật..."}"></td>
    ${technicalLayout ? "" : `<td><input type="text" class="form-control mt-lam-ro-tai-chinh"${disabled} value="${escapeHtml(bid.lamRoTaiChinh || "")}" placeholder="${waiting || "Nhập làm rõ tài chính..."}"></td>`}
    ${presentation.showCombinedScore ? '<td><span class="mt-combined-score bf-s-c6fa01b3f1">--</span></td>' : ""}
    <td class="mt-ketluan-cell bf-s-0c5104285b"></td>
    ${technicalLayout ? "" : `<td><span class="mt-dg-xep-hang bf-s-6e8bcfac8d">${escapeHtml(bid.danhGiaTaiChinh || "--")}</span></td>`}
  `;
}

function bindDurationInputs(row) {
  row.querySelectorAll(".mt-hieu-luc-hsdt, .mt-hieu-luc-bao-dam-ngay").forEach((input) => {
    input.addEventListener("focus", () => {
      const value = input.value.trim();
      if (!value) return;
      const number = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
      if (!Number.isNaN(number)) input.value = number;
    });
    input.addEventListener("blur", () => {
      const value = input.value.trim();
      if (!value) return;
      const number = Number.parseInt(value.replace(/[^0-9]/g, ""), 10);
      if (!Number.isNaN(number)) input.value = `${number} ngày`;
    });
  });
}

function bindFinancialInputs({ row, model, presentation, onRankingChange }) {
  if (!FINANCIAL_CASES.has(presentation.caseType)) return;
  const bidPrice = row.querySelector(".mt-gia-du-thau");
  const discount = row.querySelector(".mt-ty-le-giam-gia");
  const security = row.querySelector(".mt-gia-tri-dam-bao");
  const recalculate = () => {
    const baseValue = model.parseVND(bidPrice?.value || "");
    const discountValue = Number.parseFloat(String(discount?.value || "0").replace(/,/g, ".")) || 0;
    const discountedPrice = row.querySelector(".mt-gia-sau-giam-gia");
    if (discountedPrice) {
      discountedPrice.value = model.formatVND(baseValue * (1 - discountValue / 100)) || "";
    }
    onRankingChange(row);
  };
  if (bidPrice) {
    bindCurrencyElement(bidPrice, (value) => model.formatVND(value));
    bidPrice.addEventListener("input", recalculate);
  }
  if (discount) discount.addEventListener("input", recalculate);
  if (security) bindCurrencyElement(security, (value) => model.formatVND(value));
}

function updateLowPriceWarning({ row, pkg, bid, model }) {
  const proposedAwardPrice = row.querySelector(".mt-gia-de-nghi-trung-thau");
  const decision = row.querySelector(".evaluation-low-price-decision");
  if (!proposedAwardPrice || !decision) return;
  const parsedPrice = model.parseVND(proposedAwardPrice.value || "");
  const isWarning = isProposedAwardPriceBelowHalf(pkg, bid, parsedPrice);
  proposedAwardPrice.classList.toggle("is-low-price-warning", isWarning);
  decision.hidden = !isWarning;
  if (!isWarning) {
    decision.querySelectorAll(".mt-low-price-acceptance").forEach((radio) => {
      radio.checked = false;
    });
  }
}

function bindEvaluationPriceInputs({ row, pkg, bid, model, onRankingChange }) {
  const rankingPrice = row.querySelector(".mt-gia-xep-hang");
  const proposedAwardPrice = row.querySelector(".mt-gia-de-nghi-trung-thau");
  if (rankingPrice) {
    bindCurrencyElement(rankingPrice, (value) => model.formatVND(value));
    rankingPrice.addEventListener("input", () => onRankingChange(row));
  }
  if (proposedAwardPrice) {
    bindCurrencyElement(proposedAwardPrice, (value) => model.formatVND(value));
    proposedAwardPrice.addEventListener("input", () => {
      updateLowPriceWarning({ row, pkg, bid, model });
      onRankingChange(row);
    });
  }
  row.querySelectorAll(".mt-low-price-acceptance").forEach((radio) => {
    radio.addEventListener("change", () => onRankingChange(row));
  });
  updateLowPriceWarning({ row, pkg, bid, model });
}

function bindEvaluationInputs(row, onRankingChange) {
  const notifyRankingChange = (event) => onRankingChange(row, event);
  row.querySelectorAll(".mt-dg-hop-le, .mt-dg-nang-luc, .mt-dg-ky-thuat").forEach((input) => {
    input.addEventListener("input", notifyRankingChange);
    input.addEventListener("change", notifyRankingChange);
  });
  row.addEventListener("change", (event) => {
    if (event.target?.classList.contains("mt-dg-ketluan")) notifyRankingChange(event);
  });
}

function bindRequiredTechnicalScore(row, pkg) {
  if (!requiresTechnicalScoreInput(pkg)) return;
  const input = row.querySelector(".mt-dg-ky-thuat");
  if (!input) return;
  const updateValidity = () => {
    const validation = validateTechnicalScore(input.value, { required: true });
    if (typeof input.setCustomValidity === "function") {
      input.setCustomValidity(validation.valid ? "" : validation.message);
    }
  };
  input.addEventListener("input", updateValidity);
  input.addEventListener("change", updateValidity);
  updateValidity();
}

function bindJointVentureLink({ row, bid, model }) {
  const link = row.querySelector(".mt-jv-view-link");
  if (!link) return;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const members = resolveBidJointVentureMembers(model, bid);
    const subMembers = members.filter(
      (member) => member.vaiTro !== "Đứng đầu liên danh"
        && (member.maNhaThau || member.maSoThue) !== bid.maNhaThau,
    );
    const lead = members.find((member) => member.vaiTro === "Đứng đầu liên danh") || {
      tenNhaThau: resolveBidContractorName(model, bid),
      maNhaThau: bid.maNhaThau,
      maSoThue: "",
    };
    executeAppCommand(
      "openMoThauJVViewModal",
      subMembers,
      lead.tenNhaThau,
      lead.maNhaThau || lead.maSoThue,
      lead.thanhVienNhaThauId || "",
    );
  });
}

function createRowElement(root) {
  const ownerDocument = root.ownerDocument || globalThis.document;
  const row = ownerDocument?.createElement?.("tr");
  if (!row) throw new TypeError("Bid evaluation row renderer requires a DOM document.");
  return row;
}

function validateRowRendererContext({
  root,
  pkg,
  bids = [],
  model,
  presentation,
  onRankingChange = () => {},
} = {}) {
  if (!root?.appendChild || !pkg || !model || !presentation?.caseType || !Array.isArray(bids)) {
    throw new TypeError("Bid evaluation row renderer received an invalid context.");
  }
  if (typeof onRankingChange !== "function") {
    throw new TypeError("Bid evaluation row renderer requires a ranking callback.");
  }
}

function beginRowRender(root) {
  const revision = Number(root.__bfBidEvaluationRowRenderRevision || 0) + 1;
  root.__bfBidEvaluationRowRenderRevision = revision;
  root.innerHTML = trustedHTML("");
  return revision;
}

function renderEmptyRows(root, bids) {
  if (bids.length === 0) {
    root.innerHTML = trustedHTML('<tr><td colspan="15" class="bf-s-7fa1ce09fc"><small>Không tìm thấy danh sách nhà thầu mở thầu. Vui lòng nhập thông tin mở thầu trước.</small></td></tr>');
    return true;
  }
  return false;
}

function appendBidEvaluationRow({
  root,
  pkg,
  bid,
  model,
  presentation,
  isReadOnly,
  onRankingChange,
  sequence,
}) {
  const row = createRowElement(root);
  row.setAttribute("data-bid-id", bid.id);
  const rowReadOnly = resolveBidEvaluationRowReadOnly({
    isReadOnly,
  });
  const contractor = buildContractorDisplay({
    pkg,
    bid,
    model,
  });
  let cells = buildIdentityCells({ pkg, bid, contractor });
  if (presentation.isTwoEnvelope && presentation.currentTab === "financial") {
    cells += buildFinancialCells({ pkg, bid, model, presentation, rowReadOnly });
  } else {
    const forceDisabled = !presentation.isTwoEnvelope
      && pkg.quyTrinhDanhGia === "quytrinh2"
      && !sequence.previousAllFailed;
    cells += buildTechnicalFacts({ pkg, bid, model, presentation, rowReadOnly, forceDisabled });
    cells += rowReadOnly
      ? readOnlyEvaluationCells({ bid, presentation })
      : editableEvaluationCells({ pkg, bid, presentation, forceDisabled });
  }
  row.innerHTML = trustedHTML(cells);
  updateRowConclusion(row, bid.danhGiaKetLuan, rowReadOnly);

  if (!rowReadOnly && !presentation.isTwoEnvelope && pkg.quyTrinhDanhGia === "quytrinh2") {
    const conclusion = row.querySelector(".mt-ketluan-cell")?.textContent.trim() || "";
    if (!conclusion.startsWith("Không đạt")) sequence.previousAllFailed = false;
  }
  if (!rowReadOnly) {
    bindEvaluationInputs(row, onRankingChange);
    bindRequiredTechnicalScore(row, pkg);
    bindFinancialInputs({ row, model, presentation, onRankingChange });
    bindEvaluationPriceInputs({ row, pkg, bid, model, onRankingChange });
  }
  bindDurationInputs(row);
  bindJointVentureLink({ row, bid, model });
  root.appendChild(row);
  return row;
}

export function renderBidEvaluationRows(context = {}) {
  validateRowRendererContext(context);
  const {
    root,
    pkg,
    bids = [],
    model,
    presentation,
    isReadOnly = false,
    onRankingChange = () => {},
  } = context;
  beginRowRender(root);
  if (renderEmptyRows(root, bids)) return [];

  const rows = [];
  const sequence = { previousAllFailed: true };
  bids.forEach((bid) => {
    rows.push(appendBidEvaluationRow({
      root,
      pkg,
      bid,
      model,
      presentation,
      isReadOnly,
      onRankingChange,
      sequence,
    }));
  });
  onRankingChange();
  return rows;
}

export function renderBidEvaluationRowsBatched(context = {}, options = {}) {
  validateRowRendererContext(context);
  const {
    root,
    pkg,
    bids = [],
    model,
    presentation,
    isReadOnly = false,
    onRankingChange = () => {},
  } = context;
  const chunkSize = Math.max(1, Number(options.chunkSize) || 10);
  const scheduleFrame = typeof options.scheduleFrame === "function"
    ? options.scheduleFrame
    : (callback) => {
      if (typeof globalThis.requestAnimationFrame === "function") {
        return globalThis.requestAnimationFrame(callback);
      }
      return globalThis.setTimeout(callback, 0);
    };
  const revision = beginRowRender(root);
  if (renderEmptyRows(root, bids)) return Promise.resolve([]);

  const rows = [];
  const sequence = { previousAllFailed: true };
  let nextIndex = 0;
  return new Promise((resolve, reject) => {
    const renderChunk = () => {
      try {
        if (root.__bfBidEvaluationRowRenderRevision !== revision) {
          resolve([]);
          return;
        }
        const endIndex = Math.min(bids.length, nextIndex + chunkSize);
        const ownerDocument = root.ownerDocument || globalThis.document;
        const batchRoot = ownerDocument?.createDocumentFragment?.() || root;
        while (nextIndex < endIndex) {
          rows.push(appendBidEvaluationRow({
            root: batchRoot,
            pkg,
            bid: bids[nextIndex],
            model,
            presentation,
            isReadOnly,
            onRankingChange,
            sequence,
          }));
          nextIndex += 1;
        }
        if (batchRoot !== root) root.appendChild(batchRoot);
        if (nextIndex < bids.length) {
          scheduleFrame(renderChunk);
          return;
        }
        onRankingChange();
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    renderChunk();
  });
}
