import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";
import { renderBidderGoodsPanelMarkup } from "../BidderGoodsWorkflow.js";
import {
  isProposedAwardPriceBelowHalf,
  normalizeLowPriceAcceptance,
} from "../bidEvaluationLowPriceRules.js";
import {
  aggregateDetailedEvaluation,
  aggregateDetailedEvaluationAutomatic,
} from "../detailedEvaluationAggregation.js";
import { getEvaluationLotScopeDetails } from "../lotEvaluationScope.js";

const GROUP_LABELS = Object.freeze({
  validity: "Tính hợp lệ",
  capacity: "Năng lực và kinh nghiệm",
  technical: "Kỹ thuật",
  financial: "Tài chính",
  bidder_goods: "Danh mục hàng hóa dự thầu",
});

const LARGE_TABLE_ROW_CHUNK_SIZE = 25;

const ROUND_LABELS = Object.freeze({
  single: "Vòng đánh giá chung",
  technical: "Vòng kỹ thuật",
  financial: "Vòng tài chính",
});

const TECHNICAL_METHOD_LABELS = Object.freeze({
  pass_fail: "Kỹ thuật: Đạt/Không đạt",
  score: "Kỹ thuật: Chấm điểm",
});

function joinContextParts(parts) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(" — ");
}

function resolveLotContext(pkg, selectedBid, lotScope) {
  if (pkg?.phanLo !== "Có") return "Không phân lô";
  const details = getEvaluationLotScopeDetails(pkg, lotScope);
  if (details?.selectedLots?.length) {
    return details.selectedLots.map((lot) => joinContextParts([lot.code, lot.name])).join(", ");
  }
  const bidLot = joinContextParts([
    selectedBid?.maPhanLo || selectedBid?.ma_phan_lo,
    selectedBid?.tenPhanLo || selectedBid?.ten_phan_lo,
  ]);
  return bidLot || "Toàn bộ phần lô";
}

export function buildDetailedEvaluationContextItems({
  pkg = null,
  selectedBid = null,
  lotScope = null,
  roundType = "single",
  context = {},
  activeGroup = "validity",
  status = "Chưa đánh giá",
} = {}) {
  const technicalMethod = TECHNICAL_METHOD_LABELS[context?.technicalEvaluationMethod];
  return [
    {
      key: "package",
      label: "Gói thầu",
      value: joinContextParts([pkg?.maGoiThau, pkg?.tenGoiThau]) || "Chưa xác định",
    },
    { key: "lot", label: "Phần lô", value: resolveLotContext(pkg, selectedBid, lotScope) },
    {
      key: "contractor",
      label: "Nhà thầu/HSDT",
      value: String(selectedBid?.label || selectedBid?.tenNhaThau || "").trim()
        || "Chưa chọn hồ sơ dự thầu",
    },
    {
      key: "round",
      label: "Vòng",
      value: ROUND_LABELS[roundType] || String(roundType || "").trim() || "Chưa xác định",
    },
    {
      key: "group",
      label: "Nhóm",
      value: GROUP_LABELS[activeGroup] || String(activeGroup || "").trim() || "Chưa xác định",
    },
    {
      key: "method",
      label: "Phương pháp",
      value: technicalMethod
        || String(pkg?.phuongPhapDanhGia || pkg?.phuongThucLuaChon || "").trim()
        || "Chưa cấu hình",
    },
    { key: "status", label: "Trạng thái", value: String(status || "").trim() || "Chưa đánh giá" },
  ];
}

export function renderDetailedEvaluationContextStrip(items = []) {
  return `
    <aside class="detailed-evaluation-sticky-context" aria-label="Ngữ cảnh đánh giá đang hiển thị">
      <dl class="detailed-evaluation-context-list">
        ${items.map(({ key, label, value }) => `
          <div class="detailed-evaluation-context-item" data-context-key="${escapeHtml(key)}">
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>`).join("")}
      </dl>
    </aside>`;
}

export function renderDetailedEvaluationLowPriceSummary({ pkg, bid } = {}) {
  if (!isProposedAwardPriceBelowHalf(pkg, bid)) return "";
  const decision = normalizeLowPriceAcceptance(
    bid?.chapThuanGiaDeNghiTrungThauDuoi50,
  );
  const decisionLabel = decision === true
    ? "Chấp thuận"
    : decision === false ? "Không chấp thuận" : "Chưa quyết định";
  const statusClass = decision === true
    ? "badge-success"
    : decision === false ? "badge-danger" : "badge-warning";
  return `
    <div class="detailed-evaluation-metric detailed-evaluation-low-price-decision">
      <span class="detailed-evaluation-metric-label">Xử lý giá đề nghị trúng thầu dưới 50%</span>
      <strong class="badge ${statusClass}">${escapeHtml(decisionLabel)}</strong>
    </div>`;
}

function documentSection(context = {}, group) {
  const source = context.templateSource || "14A";
  const consulting = source === "14D";
  const sections = {
    validity: {
      number: consulting ? "Mẫu số 01" : "Mẫu số 01",
      title: "ĐÁNH GIÁ TÍNH HỢP LỆ",
      columns: ["STT", "Nội dung đánh giá trong E-HSMT", "Kết quả đánh giá tự động từ Hệ thống", "Kết quả của chuyên gia", "Điểm", "Nhận xét của chuyên gia (nếu có)"],
    },
    capacity: {
      number: "Mẫu số 02",
      title: "ĐÁNH GIÁ VỀ NĂNG LỰC VÀ KINH NGHIỆM",
      columns: ["STT", "Các tiêu chí năng lực và kinh nghiệm trong E-HSMT", "Thông tin trong E-HSDT", "Kết quả của chuyên gia", "Điểm", "Nhận xét của chuyên gia (nếu có)"],
    },
    technical: {
      number: consulting ? "Mẫu số 02" : "Mẫu số 03A/03B",
      title: "ĐÁNH GIÁ VỀ KỸ THUẬT",
      subtitle: consulting ? "(Sử dụng phương pháp chấm điểm)" : "(Theo phương pháp đánh giá trong E-HSMT)",
      columns: ["STT", "Nội dung đánh giá", "Mức điểm quy định trong E-HSMT", "Kết quả đánh giá của chuyên gia", "Điểm đánh giá", "Nhận xét của chuyên gia"],
    },
    financial: {
      number: consulting ? "Mẫu số 02/02B" : source === "14C" ? "Mẫu số 06A/06B/06C" : "Mẫu số 07A/07B",
      title: "TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ VỀ TÀI CHÍNH",
      columns: ["STT", "Nội dung", "Giá trị"],
    },
  };
  return sections[group] || sections.validity;
}

function resultOptions(selected) {
  return [
    ["pending", "Chưa đánh giá"],
    ["pass", "Đạt"],
    ["fail", "Không đạt"],
    ["not_applicable", "Không áp dụng"],
  ].map(([value, label]) => (
    `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
  )).join("");
}

function renderResultControl(criterion, row, disabled) {
  const attributes = disabled ? "disabled" : "";
  const label = escapeHtml(criterion.name || criterion.code || "Tiêu chí");
  if (criterion.resultType === "text") {
    return `<textarea class="form-control" data-detailed-field="nhanXet" aria-label="Kết quả ${label}" ${attributes}>${escapeHtml(row.nhanXet || "")}</textarea>`;
  }
  if (criterion.resultType === "number") {
    return `<input type="number" min="0" class="form-control" data-detailed-field="diem" aria-label="Giá trị ${label}" value="${escapeHtml(row.diem ?? "")}" ${attributes}>`;
  }
  const score = criterion.resultType === "score"
    ? `<input type="number" min="0" ${criterion.maxScore != null ? `max="${escapeHtml(criterion.maxScore)}"` : ""} class="form-control" data-detailed-field="diem" aria-label="Điểm ${label}" value="${escapeHtml(row.diem ?? "")}" ${attributes} placeholder="Điểm">`
    : "";
  return `<select class="form-control" data-detailed-field="ketQua" aria-label="Kết quả ${label}" ${attributes}>${resultOptions(row.ketQua || "pending")}</select>${score}`;
}

function renderBinaryChoice({ field, value, selected, label, disabled }) {
  return `
    <label class="detailed-evaluation-mark" title="${escapeHtml(label)}">
      <input type="checkbox"
        data-detailed-field="${field}"
        data-detailed-result-value="${value}"
        aria-label="${escapeHtml(label)}"
        ${selected === value ? "checked" : ""}
        ${disabled ? "disabled" : ""}>
      <span class="detailed-evaluation-mark-symbol" aria-hidden="true"></span>
    </label>`;
}

function renderDerivedBinaryMark({ field, value, selected, label }) {
  const marked = selected === value;
  return `<span class="detailed-evaluation-derived-mark ${marked ? "is-marked" : ""}"
    role="img"
    data-detailed-derived-field="${field}"
    data-detailed-derived-value="${value}"
    data-detailed-derived-label="${escapeHtml(label)}"
    aria-label="${escapeHtml(label)}: ${marked ? "có" : "không"}"
    title="Kết quả tự tính từ các tiêu chí con">${marked ? "x" : "-"}</span>`;
}

function conclusionBadge(status) {
  const label = status || "Chưa kết luận";
  const tone = status === "Đạt"
    ? "badge-success"
    : status === "Không đạt" ? "badge-danger" : "badge-warning";
  return `<span class="badge ${tone}" data-detailed-conclusion-badge>${escapeHtml(label)}</span>`;
}

export function renderDetailedEvaluationConclusionFooter({
  activeGroup = "validity",
  criteria = [],
  report = null,
} = {}) {
  if (activeGroup === "financial") return "";
  const binaryLayout = activeGroup === "validity" || activeGroup === "capacity";
  const expert = aggregateDetailedEvaluation({ report: report || {}, criteria, group: activeGroup });
  const expertStatus = expert.status
    || report?.extension?.groupResults?.[activeGroup]
    || "";
  if (binaryLayout) {
    const automaticStatus = aggregateDetailedEvaluationAutomatic({
      report: report || {},
      criteria,
      group: activeGroup,
    });
    const automaticResult = automaticStatus === "Đạt" ? "pass" : automaticStatus === "Không đạt" ? "fail" : "pending";
    const expertResult = expertStatus === "Đạt" ? "pass" : expertStatus === "Không đạt" ? "fail" : "pending";
    const leadingColumns = activeGroup === "capacity" ? 3 : 2;
    return `
      <tfoot>
        <tr class="detailed-evaluation-conclusion-row" data-detailed-conclusion-row>
          <th scope="row" colspan="${leadingColumns}">Kết luận</th>
          <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQuaTuDong", value: "pass", selected: automaticResult, label: "Kết luận tự động: Đạt" })}</td>
          <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQuaTuDong", value: "fail", selected: automaticResult, label: "Kết luận tự động: Không đạt" })}</td>
          <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQua", value: "pass", selected: expertResult, label: "Kết luận chuyên gia: Đạt" })}</td>
          <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQua", value: "fail", selected: expertResult, label: "Kết luận chuyên gia: Không đạt" })}</td>
          <td class="detailed-evaluation-conclusion-summary">${conclusionBadge(expertStatus)}</td>
        </tr>
      </tfoot>`;
  }
  const score = expert.score !== null
    ? `<span class="detailed-evaluation-conclusion-score">Tổng điểm: ${escapeHtml(expert.score)}</span>`
    : "";
  return `
    <tfoot>
      <tr class="detailed-evaluation-conclusion-row" data-detailed-conclusion-row>
        <th scope="row" colspan="2">Kết luận</th>
        <td colspan="4">
          <div class="detailed-evaluation-conclusion-value">${conclusionBadge(expertStatus)}${score}</div>
        </td>
      </tr>
    </tfoot>`;
}

function renderNotesCells(row, attributes) {
  return `
    <td>
      <div class="detailed-evaluation-field-stack">
        <textarea class="form-control" data-detailed-field="nhanXet" aria-label="Nhận xét đánh giá" ${attributes} placeholder="Nhận xét đánh giá">${escapeHtml(row.nhanXet || "")}</textarea>
      </div>
    </td>`;
}

function renderCriterionStt(criterion, index, disabled) {
  if (criterion.isCustom !== true) {
    return `<strong class="detailed-evaluation-stt">${escapeHtml(criterion.stt || index + 1)}</strong>`;
  }
  return `<input type="text" class="form-control detailed-evaluation-config-stt"
    data-detailed-config-field="stt"
    aria-label="Số thứ tự tiêu chí"
    value="${escapeHtml(criterion.stt || index + 1)}"
    ${disabled ? "disabled" : ""}>`;
}

function renderCriterionName(criterion, disabled = false, {
  showRequirement = true,
} = {}) {
  const required = criterion.source === "muasamcong" || criterion.required === false
    ? ""
    : ' <span class="required" aria-label="Bắt buộc">*</span>';
  if (criterion.isCustom === true) {
    return `
      <div class="detailed-evaluation-config-criterion">
        <textarea class="form-control" data-detailed-config-field="name"
          aria-label="Nội dung tiêu chí đánh giá" placeholder="Nhập nội dung tiêu chí đánh giá"
          ${disabled ? "disabled" : ""}>${escapeHtml(criterion.name || "")}</textarea>
        ${disabled ? "" : `<button type="button" class="btn btn-text detailed-evaluation-remove-criterion"
          data-detailed-remove-criterion="${escapeHtml(criterion.id)}"
          aria-label="Xóa tiêu chí" title="Xóa dòng"><i data-lucide="trash-2" aria-hidden="true"></i></button>`}
      </div>
      ${showRequirement ? `<textarea class="form-control detailed-evaluation-config-requirement"
        data-detailed-config-field="requirement" aria-label="Yêu cầu của tiêu chí"
        placeholder="Yêu cầu của tiêu chí (nếu có)" ${disabled ? "disabled" : ""}>${escapeHtml(criterion.requirement || "")}</textarea>` : ""}`;
  }
  return `
    <div>${escapeHtml(criterion.name || "")}${required}</div>
    ${criterion.requirement ? `<div class="detailed-evaluation-requirement"><strong>Yêu cầu:</strong> ${escapeHtml(criterion.requirement)}</div>` : ""}`;
}

function renderBinaryEvaluationRow({ criterion, row, index, activeGroup, disabled }) {
  const automaticResult = row?.extension?.ketQuaTuDong || row?.ketQuaTuDong || "pending";
  const expertResult = row.ketQua || "pending";
  const structural = criterion.isSection === true;
  const derived = criterion.hasChildren === true;
  const controlDisabled = disabled || structural;
  const attributes = disabled ? "disabled" : "";
  const systemCells = derived
    ? `
      <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQuaTuDong", value: "pass", selected: automaticResult, label: `Hệ thống tự tính đạt: ${criterion.name}` })}</td>
      <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQuaTuDong", value: "fail", selected: automaticResult, label: `Hệ thống tự tính không đạt: ${criterion.name}` })}</td>`
    : structural
    ? '<td class="detailed-evaluation-mark-cell">-</td><td class="detailed-evaluation-mark-cell">-</td>'
    : `
      <td class="detailed-evaluation-mark-cell">${renderBinaryChoice({ field: "ketQuaTuDong", value: "pass", selected: automaticResult, label: `Hệ thống đánh giá đạt: ${criterion.name}`, disabled: controlDisabled })}</td>
      <td class="detailed-evaluation-mark-cell">${renderBinaryChoice({ field: "ketQuaTuDong", value: "fail", selected: automaticResult, label: `Hệ thống đánh giá không đạt: ${criterion.name}`, disabled: controlDisabled })}</td>`;
  const expertCells = derived
    ? `
      <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQua", value: "pass", selected: expertResult, label: `Chuyên gia tự tính đạt: ${criterion.name}` })}</td>
      <td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({ field: "ketQua", value: "fail", selected: expertResult, label: `Chuyên gia tự tính không đạt: ${criterion.name}` })}</td>`
    : structural
    ? '<td class="detailed-evaluation-mark-cell"></td><td class="detailed-evaluation-mark-cell"></td>'
    : `
      <td class="detailed-evaluation-mark-cell">${renderBinaryChoice({ field: "ketQua", value: "pass", selected: expertResult, label: `Chuyên gia đánh giá đạt: ${criterion.name}`, disabled: controlDisabled })}</td>
      <td class="detailed-evaluation-mark-cell">${renderBinaryChoice({ field: "ketQua", value: "fail", selected: expertResult, label: `Chuyên gia đánh giá không đạt: ${criterion.name}`, disabled: controlDisabled })}</td>`;
  const bidderInformation = activeGroup === "capacity"
    ? `<td><textarea class="form-control" data-detailed-field="noiDungHsdt" aria-label="Nội dung HSDT cho ${escapeHtml(criterion.name || criterion.code || "tiêu chí")}" ${attributes}>${escapeHtml(row.noiDungHsdt || "")}</textarea></td>`
    : "";
  const notes = structural ? "<td></td>" : renderNotesCells(row, attributes);
  return `
    <tr class="${structural ? "detailed-evaluation-section-row" : ""} ${derived ? "detailed-evaluation-parent-row" : ""}" data-detailed-criterion-id="${escapeHtml(criterion.id)}">
      <td>${renderCriterionStt(criterion, index, disabled)}</td>
      <td class="text-wrap">${renderCriterionName(criterion, disabled)}</td>
      ${bidderInformation}
      ${systemCells}
      ${expertCells}
      ${notes}
    </tr>`;
}

export function renderTechnicalPassFailRow({ criterion, row, index, disabled }) {
  const selected = row.ketQua || "pending";
  const structural = criterion.isSection === true;
  const derived = criterion.hasChildren === true;
  const controlDisabled = disabled || structural;
  const resultCells = derived
    ? ["pass", "acceptable", "fail"].map((value) => (
      `<td class="detailed-evaluation-mark-cell">${renderDerivedBinaryMark({
        field: "ketQua",
        value,
        selected,
        label: `Chuyên gia tự tính ${value === "pass" ? "Đạt" : value === "acceptable" ? "Chấp nhận được" : "Không đạt"}: ${criterion.name}`,
      })}</td>`
    )).join("")
    : structural
      ? '<td class="detailed-evaluation-mark-cell"></td>'.repeat(3)
      : [
        ["pass", "Đạt"],
        ["acceptable", "Chấp nhận được"],
        ["fail", "Không đạt"],
      ].map(([value, label]) => (
        `<td class="detailed-evaluation-mark-cell">${renderBinaryChoice({
          field: "ketQua",
          value,
          selected,
          label: `${label}: ${criterion.name}`,
          disabled: controlDisabled,
        })}</td>`
      )).join("");
  return `
    <tr class="${structural ? "detailed-evaluation-section-row" : ""} ${derived ? "detailed-evaluation-parent-row" : ""}" data-detailed-criterion-id="${escapeHtml(criterion.id)}">
      <td>${renderCriterionStt(criterion, index, disabled)}</td>
      <td class="text-wrap">${renderCriterionName(criterion, disabled)}</td>
      ${resultCells}
      ${structural ? "<td></td>" : renderNotesCells(row, disabled ? "disabled" : "")}
    </tr>`;
}

function renderScoreLimitInput(criterion, field, label, disabled) {
  const value = criterion[field];
  return `<input type="number" min="0" step="any" inputmode="decimal" class="form-control detailed-evaluation-score-limit"
    data-detailed-config-field="${field}"
    aria-label="${escapeHtml(`${label}: ${criterion.name || criterion.code || "tiêu chí"}`)}"
    value="${escapeHtml(value ?? "")}" ${disabled ? "disabled" : ""} placeholder="0">`;
}

export function renderTechnicalScoreRow({ criterion, row, index, disabled }) {
  const attributes = disabled ? "disabled" : "";
  return `
    <tr data-detailed-criterion-id="${escapeHtml(criterion.id)}">
      <td>${renderCriterionStt(criterion, index, disabled)}</td>
      <td class="text-wrap">${renderCriterionName(criterion, disabled)}</td>
      <td>${renderScoreLimitInput(criterion, "maxScore", "Điểm tối đa", disabled)}</td>
      <td>${renderScoreLimitInput(criterion, "minScore", "Điểm tối thiểu", disabled)}</td>
      <td><input type="number" min="0" step="any" inputmode="decimal" ${criterion.maxScore != null ? `max="${escapeHtml(criterion.maxScore)}"` : ""}
        class="form-control detailed-evaluation-score-input" data-detailed-field="diem"
        aria-label="Điểm đánh giá: ${escapeHtml(criterion.name || criterion.code || "tiêu chí") }"
        value="${escapeHtml(row.diem ?? "")}" ${attributes} placeholder="Điểm"></td>
      ${renderNotesCells(row, attributes)}
    </tr>`;
}

export function renderTechnicalEvaluationHeader(method) {
  if (method === "pass_fail") {
    return `
      <thead>
        <tr class="detailed-evaluation-header-group">
          <th rowspan="2">STT</th>
          <th rowspan="2">Nội dung đánh giá</th>
          <th colspan="3">Kết quả đánh giá của chuyên gia</th>
          <th rowspan="2">Nhận xét của chuyên gia</th>
        </tr>
        <tr class="detailed-evaluation-header-subgroup">
          <th>Đạt</th><th>Chấp nhận được</th><th>Không đạt</th>
        </tr>
      </thead>`;
  }
  if (method === "score") {
    return `
      <thead>
        <tr class="detailed-evaluation-header-group">
          <th rowspan="2">STT</th>
          <th rowspan="2">Nội dung đánh giá</th>
          <th colspan="2">Mức điểm quy định trong E-HSMT</th>
          <th colspan="2">Kết quả đánh giá của chuyên gia</th>
        </tr>
        <tr class="detailed-evaluation-header-subgroup">
          <th>Điểm tối đa</th><th>Điểm tối thiểu</th><th>Điểm đánh giá</th><th>Nhận xét của chuyên gia</th>
        </tr>
      </thead>`;
  }
  return "";
}

export function renderTechnicalEvaluationMethodSelector({ method = "", readOnly = false } = {}) {
  if (method) return "";
  if (readOnly) {
    return '<div class="alert alert-warning" role="status">Chưa xác định phương pháp đánh giá kỹ thuật.</div>';
  }
  return `<fieldset class="detailed-technical-method-selector" aria-describedby="detailed-technical-method-help">
    <legend>Phương pháp đánh giá kỹ thuật</legend>
    <div class="detailed-technical-method-options">
      <label class="radio-option"><input type="radio" name="detailed-technical-evaluation-method" value="pass_fail" class="radio-option-input"> Đạt/Không đạt</label>
      <label class="radio-option"><input type="radio" name="detailed-technical-evaluation-method" value="score" class="radio-option-input"> Chấm điểm</label>
    </div>
    <p id="detailed-technical-method-help">Chọn phương pháp quy định trong E-HSMT. Lựa chọn sẽ áp dụng cho toàn bộ nhà thầu trong vòng đánh giá này.</p>
  </fieldset>`;
}

function scheduleNextFrame(callback) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

export function scheduleDetailedEvaluationRowBatches({
  rowHtml,
  startIndex = 0,
  chunkSize = 50,
  appendBatch,
  scheduleFrame = scheduleNextFrame,
  shouldContinue = () => true,
} = {}) {
  if (!Array.isArray(rowHtml) || typeof appendBatch !== "function") {
    throw new TypeError("Detailed evaluation row batching requires row HTML and an append adapter.");
  }
  const boundedChunkSize = Math.max(1, Number(chunkSize) || 50);
  let offset = Math.max(0, Number(startIndex) || 0);
  return new Promise((resolve) => {
    const appendNext = () => {
      if (!shouldContinue()) {
        resolve(false);
        return;
      }
      const batch = rowHtml.slice(offset, offset + boundedChunkSize);
      if (!batch.length) {
        resolve(true);
        return;
      }
      appendBatch(batch, offset);
      offset += batch.length;
      if (offset >= rowHtml.length) {
        resolve(true);
        return;
      }
      scheduleFrame(appendNext);
    };
    if (offset >= rowHtml.length) {
      resolve(true);
      return;
    }
    scheduleFrame(appendNext);
  });
}

export function renderDetailedEvaluationPanel(container, {
  pkg = null,
  bids = [],
  selectedBidId = "",
  lotScope = null,
  roundType = "single",
  context,
  activeGroup = "validity",
  criteria = [],
  report = null,
  progress = { completed: 0, total: 0 },
  readOnly = false,
  canReopen = false,
  warning = "",
  bidderGoodsState = null,
} = {}) {
  if (!container) return;
  const rows = new Map(
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  const selectedBid = bids.find((bid) => String(bid.id) === String(selectedBidId));
  const lowPriceDecisionSummary = renderDetailedEvaluationLowPriceSummary({
    pkg,
    bid: selectedBid,
  });
  const section = documentSection(context, activeGroup);
  const tabs = (context?.visibleGroups || []).map((group) => {
    const active = group === activeGroup;
    return `
      <button type="button" id="detailed-evaluation-tab-${group}" role="tab"
        aria-selected="${active ? "true" : "false"}"
        aria-controls="detailed-evaluation-tab-panel"
        tabindex="${active ? "0" : "-1"}"
        class="btn package-workflow-tab ${active ? "active" : ""}"
        data-no-icon
        data-detailed-evaluation-group="${group}">${GROUP_LABELS[group] || group}</button>
    `;
  }).join("");
  const binaryLayout = activeGroup === "validity" || activeGroup === "capacity";
  const financialLayout = activeGroup === "financial";
  const bidderGoodsLayout = activeGroup === "bidder_goods";
  const technicalMethod = context?.technicalEvaluationMethod || "";
  const technicalMethodRequired = activeGroup === "technical" && !technicalMethod;
  const technicalPassFailLayout = activeGroup === "technical" && technicalMethod === "pass_fail";
  const technicalScoreLayout = activeGroup === "technical" && technicalMethod === "score";
  const criterionRowHtml = criteria.map((criterion, index) => {
    const row = rows.get(String(criterion.id)) || {
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pending",
    };
    const disabled = readOnly || !(context?.editableGroups || []).includes(activeGroup);
    if (binaryLayout) {
      return renderBinaryEvaluationRow({
        criterion,
        row,
        index,
        activeGroup,
        disabled,
      });
    }
    if (technicalPassFailLayout) {
      return renderTechnicalPassFailRow({ criterion, row, index, disabled });
    }
    if (technicalScoreLayout) {
      return renderTechnicalScoreRow({ criterion, row, index, disabled });
    }
    if (financialLayout) {
      const attributes = disabled ? "disabled" : "";
      return `
        <tr data-detailed-criterion-id="${escapeHtml(criterion.id)}">
          <td>${renderCriterionStt(criterion, index, disabled)}</td>
          <td class="text-wrap">${renderCriterionName(criterion, disabled, { showRequirement: false })}</td>
          <td><textarea class="form-control detailed-evaluation-financial-value"
            data-detailed-field="noiDungHsdt"
            aria-label="Giá trị cho ${escapeHtml(criterion.name || criterion.code || "nội dung tài chính")}"
            placeholder="Nhập giá trị" ${attributes}>${escapeHtml(row.noiDungHsdt || "")}</textarea></td>
        </tr>`;
    }
    const attributes = disabled ? "disabled" : "";
    return `
      <tr data-detailed-criterion-id="${escapeHtml(criterion.id)}">
        <td>${renderCriterionStt(criterion, index, disabled)}</td>
        <td class="text-wrap">${renderCriterionName(criterion, disabled)}</td>
        <td><textarea class="form-control" data-detailed-field="noiDungHsdt" aria-label="Nội dung HSDT cho ${escapeHtml(criterion.name || criterion.code || "tiêu chí")}" ${attributes}>${escapeHtml(row.noiDungHsdt || "")}</textarea></td>
        <td><div class="detailed-evaluation-field-stack detailed-evaluation-result-stack">${renderResultControl(criterion, row, disabled)}</div></td>
        <td class="detailed-evaluation-score">${criterion.resultType === "score" ? `<span>Tối đa: ${escapeHtml(criterion.maxScore ?? "--")}</span>${criterion.minScore != null ? `<span>Tối thiểu: ${escapeHtml(criterion.minScore)}</span>` : ""}` : escapeHtml(row.diem ?? "--")}</td>
        ${renderNotesCells(row, attributes)}
      </tr>`;
  });
  const initialRowCount = criterionRowHtml.length > 100
    ? LARGE_TABLE_ROW_CHUNK_SIZE
    : criterionRowHtml.length;
  const criterionRows = criterionRowHtml.slice(0, initialRowCount).join("");
  const status = report?.trangThai === "completed"
    ? "Hoàn thành"
    : report ? "Bản nháp" : "Chưa đánh giá";
  const statusClass = report?.trangThai === "completed" ? "badge-success" : "badge-warning";
  const stickyContext = renderDetailedEvaluationContextStrip(
    buildDetailedEvaluationContextItems({
      pkg,
      selectedBid,
      lotScope,
      roundType,
      context,
      activeGroup,
      status,
    }),
  );
  const progressTotal = Math.max(Number(progress.total) || 0, 1);
  const progressCompleted = Math.min(Number(progress.completed) || 0, progressTotal);
  const selectedIndex = bids.findIndex((bid) => String(bid.id) === String(selectedBidId));
  const bidderNavigation = bids.length > 1 ? `
    <div class="detailed-evaluation-navigation" aria-label="Điều hướng hồ sơ dự thầu">
      <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-previous" ${selectedIndex <= 0 ? "disabled" : ""}>
        <i data-lucide="chevron-left" aria-hidden="true"></i> Nhà thầu trước
      </button>
      <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-next" ${selectedIndex < 0 || selectedIndex >= bids.length - 1 ? "disabled" : ""}>
        Nhà thầu tiếp theo <i data-lucide="chevron-right" aria-hidden="true"></i>
      </button>
    </div>
  ` : "";
  const actionButtons = bidderGoodsLayout || technicalMethodRequired ? "" : !selectedBid
    ? ""
    : readOnly
      ? report?.trangThai === "completed" && canReopen
        ? '<button type="button" class="btn btn-primary" id="btn-detailed-evaluation-reopen">Chỉnh sửa báo cáo chi tiết</button>'
        : ""
      : '<button type="button" class="btn btn-secondary" id="btn-detailed-evaluation-save-draft" data-no-icon>Lưu bản nháp</button><button type="button" class="btn btn-secondary" id="btn-detailed-evaluation-complete-group" data-no-icon>Hoàn thành tab</button><button type="button" class="btn btn-primary" id="btn-detailed-evaluation-complete-report" data-no-icon>Hoàn thành đánh giá nhà thầu</button>';
  const excelImportControl = !bidderGoodsLayout && selectedBid && !readOnly
    ? `<div class="detailed-evaluation-tab-actions">${technicalMethodRequired ? "" : '<button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-add-row"><i data-lucide="plus" aria-hidden="true"></i> Thêm dòng</button>'}<input type="file" id="detailed-evaluation-excel-input" accept=".xlsx,.xls" hidden><button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-import-excel"><i data-lucide="upload" aria-hidden="true"></i> Nhập từ Excel</button></div>`
    : "";
  const binaryColgroup = `
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      ${activeGroup === "capacity" ? '<col class="detailed-evaluation-col-content">' : ""}
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-comment">
    </colgroup>`;
  const standardColgroup = `
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      <col class="detailed-evaluation-col-content">
      <col class="detailed-evaluation-col-result">
      <col class="detailed-evaluation-col-score">
      <col class="detailed-evaluation-col-comment">
    </colgroup>`;
  const financialColgroup = `
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-financial-content">
      <col class="detailed-evaluation-col-financial-value">
    </colgroup>`;
  const technicalPassFailColgroup = `
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      <col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark"><col class="detailed-evaluation-col-mark">
      <col class="detailed-evaluation-col-comment">
    </colgroup>`;
  const technicalScoreColgroup = `
    <colgroup>
      <col class="detailed-evaluation-col-stt">
      <col class="detailed-evaluation-col-criterion">
      <col class="detailed-evaluation-col-score-max"><col class="detailed-evaluation-col-score-min">
      <col class="detailed-evaluation-col-score"><col class="detailed-evaluation-col-comment">
    </colgroup>`;
  const binaryHeader = `
    <thead>
      <tr class="detailed-evaluation-header-group">
        <th rowspan="2">${escapeHtml(section.columns[0])}</th>
        <th rowspan="2">${escapeHtml(section.columns[1])}</th>
        ${activeGroup === "capacity" ? `<th rowspan="2">${escapeHtml(section.columns[2])}</th>` : ""}
        <th colspan="2">Kết quả đánh giá tự động từ Hệ thống</th>
        <th colspan="2">Kết quả đánh giá của chuyên gia</th>
        <th rowspan="2">${escapeHtml(section.columns[5] || "Nhận xét của chuyên gia (nếu có)")}</th>
      </tr>
      <tr class="detailed-evaluation-header-subgroup">
        <th>Đạt</th><th>Không đạt</th><th>Đạt</th><th>Không đạt</th>
      </tr>
    </thead>`;
  const standardHeader = `
    <thead>
      <tr class="detailed-evaluation-header-group">
        <th rowspan="2">${escapeHtml(section.columns[0])}</th>
        <th rowspan="2">${escapeHtml(section.columns[1])}</th>
        <th rowspan="2">${escapeHtml(section.columns[2])}</th>
        <th colspan="2">${escapeHtml(section.columns[3])}</th>
        <th rowspan="2">${escapeHtml(section.columns[5] || "Nhận xét")}</th>
      </tr>
      <tr class="detailed-evaluation-header-subgroup">
        <th>Đạt / Không đạt</th><th>${escapeHtml(section.columns[4] || "Điểm")}</th>
      </tr>
    </thead>`;
  const financialHeader = `
    <thead>
      <tr class="detailed-evaluation-header-group">
        <th>${escapeHtml(section.columns[0])}</th>
        <th>${escapeHtml(section.columns[1])}</th>
        <th>${escapeHtml(section.columns[2])}</th>
      </tr>
    </thead>`;
  const technicalHeader = renderTechnicalEvaluationHeader(technicalMethod);
  const technicalMethodSelector = activeGroup === "technical"
    ? renderTechnicalEvaluationMethodSelector({ method: technicalMethod, readOnly })
    : "";
  const conclusionFooter = renderDetailedEvaluationConclusionFooter({
    activeGroup,
    criteria,
    report,
  });
  container.innerHTML = trustedHTML(`
    <section class="detailed-evaluation-panel" aria-label="Báo cáo đánh giá chi tiết">
      <div class="detailed-evaluation-topbar">
        <button type="button" class="btn btn-outline compact-action" id="btn-detailed-evaluation-back"><i data-lucide="arrow-left" aria-hidden="true"></i> Quay lại báo cáo tổng quát</button>
      </div>
      ${warning ? `<div class="alert alert-warning" role="status">${escapeHtml(warning)}</div>` : ""}
      <div class="detailed-evaluation-overview">
        <div class="form-group detailed-evaluation-bid-field">
          <label for="detailed-evaluation-bid-select">Nhà thầu/Hồ sơ dự thầu</label>
          <select id="detailed-evaluation-bid-select" class="form-control">
            ${bids.map((bid) => `<option value="${escapeHtml(bid.id)}" ${String(bid.id) === String(selectedBidId) ? "selected" : ""}>${escapeHtml(bid.label)}</option>`).join("")}
          </select>
        </div>
        <div class="detailed-evaluation-metric">
          <span class="detailed-evaluation-metric-label">Trạng thái</span>
          <strong id="detailed-evaluation-status" class="badge ${statusClass}">${status}</strong>
        </div>
        <div class="detailed-evaluation-metric">
          <span class="detailed-evaluation-metric-label">Tiến độ</span>
          <strong id="detailed-evaluation-progress">${progress.completed}/${progress.total} tiêu chí</strong>
          <progress class="detailed-evaluation-progress" max="${progressTotal}" value="${progressCompleted}" aria-label="Tiến độ đánh giá"></progress>
        </div>
        ${lowPriceDecisionSummary}
      </div>
      ${stickyContext}
      ${selectedBid ? bidderNavigation : '<div class="package-panel-empty">Chưa có hồ sơ dự thầu phù hợp.</div>'}
      <div class="detailed-evaluation-tabs-toolbar">
        <div class="detailed-evaluation-tabs" role="tablist" aria-label="Nhóm đánh giá">${tabs}</div>
        ${excelImportControl}
      </div>
      <div id="detailed-evaluation-tab-panel" class="detailed-evaluation-tab-panel" role="tabpanel" aria-labelledby="detailed-evaluation-tab-${escapeHtml(activeGroup)}">
        ${technicalMethodSelector}
        ${bidderGoodsLayout ? renderBidderGoodsPanelMarkup(bidderGoodsState || {}) : `
        ${technicalMethodRequired ? '<div class="package-panel-empty detailed-technical-method-empty">Chọn phương pháp đánh giá kỹ thuật hoặc nhập file Excel để tiếp tục.</div>' : `
        <div class="table-container package-table-frame has-bottom-space detailed-evaluation-table-frame">
        <table class="data-table detailed-evaluation-table ${binaryLayout ? `detailed-evaluation-table-binary detailed-evaluation-table-${activeGroup}` : financialLayout ? "detailed-evaluation-table-financial" : technicalPassFailLayout ? "detailed-evaluation-table-technical-pass-fail" : technicalScoreLayout ? "detailed-evaluation-table-technical-score" : ""}" data-no-sort="true" data-density="comfortable" data-row-pagination="true" aria-label="Báo cáo đánh giá chi tiết">
          ${binaryLayout ? binaryColgroup : financialLayout ? financialColgroup : technicalPassFailLayout ? technicalPassFailColgroup : technicalScoreLayout ? technicalScoreColgroup : standardColgroup}
          ${binaryLayout ? binaryHeader : financialLayout ? financialHeader : technicalPassFailLayout || technicalScoreLayout ? technicalHeader : standardHeader}
          <tbody id="detailed-evaluation-criteria-body">${criterionRows}</tbody>
          ${conclusionFooter}
        </table>
        </div>
        `}
        `}
      </div>
      ${actionButtons ? `<div class="workflow-action-row detailed-evaluation-actions with-divider">${actionButtons}</div>` : ""}
    </section>
  `);
  container._detailedEvaluationRowRenderRevision = (
    container._detailedEvaluationRowRenderRevision || 0
  ) + 1;
  const revision = container._detailedEvaluationRowRenderRevision;
  if (!bidderGoodsLayout && initialRowCount < criterionRowHtml.length && container.querySelector) {
    const tbody = container.querySelector("#detailed-evaluation-criteria-body");
    if (!tbody) return;
    tbody.setAttribute("aria-busy", "true");
    const controls = [
      "#btn-detailed-evaluation-save-draft",
      "#btn-detailed-evaluation-complete-group",
      "#btn-detailed-evaluation-complete-report",
      "#btn-detailed-evaluation-import-excel",
      "#btn-detailed-evaluation-add-row",
    ].map((selector) => container.querySelector(selector)).filter(Boolean);
    controls.forEach((control) => { control.disabled = true; });
    const ownerDocument = tbody.ownerDocument || document;
    container._detailedEvaluationRowsReady = scheduleDetailedEvaluationRowBatches({
      rowHtml: criterionRowHtml,
      startIndex: initialRowCount,
      chunkSize: LARGE_TABLE_ROW_CHUNK_SIZE,
      shouldContinue: () => container._detailedEvaluationRowRenderRevision === revision,
      appendBatch: (batch) => {
        const template = ownerDocument.createElement("template");
        template.innerHTML = trustedHTML(batch.join(""));
        tbody.appendChild(template.content);
      },
    }).finally(() => {
      if (container._detailedEvaluationRowRenderRevision !== revision) return;
      tbody.removeAttribute("aria-busy");
      controls.forEach((control) => { control.disabled = false; });
      container.dispatchEvent?.(new CustomEvent("detailed-evaluation-rows-ready"));
    });
  }
}
