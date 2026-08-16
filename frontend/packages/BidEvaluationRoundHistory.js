import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";
import {
  getOfficialEvaluationLotState,
  isBidWithinEvaluationLotDetails,
} from "./lotEvaluationScope.js";
import { normalizeLowPriceAcceptance } from "./bidEvaluationLowPriceRules.js";

function formatRoundDate(model, value) {
  return value ? model.formatDate(value) : "--";
}

export function renderBidEvaluationRoundHistory({
  view,
  model,
  pkg,
  metadataBlock = {},
  twoEnvelopeMetadata = null,
  continueRequested = false,
  onContinue = () => {},
} = {}) {
  if (!view?.getActiveElement || !model?.state || !pkg) {
    throw new TypeError("Bid evaluation round history received an invalid context.");
  }
  const container = view.getActiveElement("danhgiahsdt-round-history");
  const currentRound = view.getActiveElement("danhgiahsdt-current-round");
  if (!container) return { showCurrentRound: true };
  const state = getOfficialEvaluationLotState(pkg, metadataBlock);
  if (state.history.length === 0) {
    container.innerHTML = trustedHTML("");
    container.classList.add("is-hidden");
    setRuntimeStyle(currentRound, "display", "block");
    return { ...state, showCurrentRound: true };
  }

  const packageBids = (model.state.thongtinmothau || []).filter(
    (bid) => String(bid.goiThauId) === String(pkg.id),
  );
  const cards = state.history.map((batch) => {
    const technicalBatch = twoEnvelopeMetadata?.technical?.lotBatches?.[batch.batchId] || batch;
    const financialBatch = twoEnvelopeMetadata?.financial?.lotBatches?.[batch.batchId] || {};
    const scopedBids = packageBids.filter(
      (bid) => isBidWithinEvaluationLotDetails(bid, batch),
    );
    const result = technicalBatch.result || financialBatch.result || batch.result || {};
    const reportFields = twoEnvelopeMetadata ? `
      <div><span>Số BC đánh giá kỹ thuật</span><strong>${escapeHtml(technicalBatch.soBaoCao || "--")}</strong></div>
      <div><span>Ngày BC đánh giá kỹ thuật</span><strong>${escapeHtml(formatRoundDate(model, technicalBatch.ngayBaoCao))}</strong></div>
      <div><span>Số BCTĐ kỹ thuật</span><strong>${escapeHtml(technicalBatch.soBctdKt || "--")}</strong></div>
      <div><span>Số QĐ đạt kỹ thuật</span><strong>${escapeHtml(technicalBatch.soQdPheDuyetKt || "--")}</strong></div>
      <div><span>Mở E-HSĐXTC</span><strong>${escapeHtml(technicalBatch.financialOpening?.openingTime ? model.formatDateWithTime(technicalBatch.financialOpening.openingTime) : "--")}</strong></div>
      <div><span>Số BC đánh giá tài chính</span><strong>${escapeHtml(financialBatch.soBaoCao || "--")}</strong></div>
      <div><span>Ngày BC đánh giá tài chính</span><strong>${escapeHtml(formatRoundDate(model, financialBatch.ngayBaoCao))}</strong></div>` : `
      <div><span>Số báo cáo đánh giá</span><strong>${escapeHtml(batch.soBaoCao || "--")}</strong></div>
      <div><span>Ngày báo cáo</span><strong>${escapeHtml(formatRoundDate(model, batch.ngayBaoCao))}</strong></div>`;
    const rows = scopedBids.map((bid) => `
      <tr>
        <td>${escapeHtml(bid.maPhanLo || "--")}</td>
        <td>${escapeHtml(bid.tenNhaThau || "--")}</td>
        <td>${escapeHtml(bid.danhGiaKetLuan || "--")}</td>
        <td>${escapeHtml(bid.giaXepHang ? model.formatVND(bid.giaXepHang) : "--")}</td>
        <td>${escapeHtml(bid.giaDeNghiTrungThau ? model.formatVND(bid.giaDeNghiTrungThau) : "--")}</td>
        <td>${normalizeLowPriceAcceptance(bid.chapThuanGiaDeNghiTrungThauDuoi50) === null
          ? "--"
          : normalizeLowPriceAcceptance(bid.chapThuanGiaDeNghiTrungThauDuoi50) ? "Chấp thuận" : "Không chấp thuận"}</td>
        <td>${escapeHtml(bid.danhGiaTaiChinh || "--")}</td>
      </tr>`).join("");
    return `
      <article class="evaluation-round-card">
        <header class="evaluation-round-card-header">
          <div><span class="evaluation-round-index">Lần ${batch.sequenceNo}</span><h4>${escapeHtml((batch.lotCodes || []).join(", ") || "Các phần lô trong đợt")}</h4></div>
          <span class="evaluation-round-status"><i data-lucide="badge-check"></i> Đã ra kết quả chính thức</span>
        </header>
        <div class="evaluation-round-fields">
          ${reportFields}
          <div><span>Số BCTĐ kết quả</span><strong>${escapeHtml(result.soBctdKetQua || "--")}</strong></div>
          <div><span>Ngày BCTĐ kết quả</span><strong>${escapeHtml(formatRoundDate(model, result.ngayBctdKetQua))}</strong></div>
          <div><span>Số QĐ phê duyệt</span><strong>${escapeHtml(result.soQuyetDinhKetQua || "--")}</strong></div>
          <div><span>Ngày QĐ phê duyệt</span><strong>${escapeHtml(formatRoundDate(model, result.ngayQuyetDinhKetQua))}</strong></div>
        </div>
        <div class="table-container package-table-frame evaluation-round-table">
          <table class="data-table" data-row-pagination="true" aria-label="Lịch sử vòng đánh giá"><thead><tr><th>Phần lô</th><th>Nhà thầu</th><th>Kết luận</th><th>Giá xếp hạng</th><th>Giá đề nghị trúng thầu</th><th>Xử lý giá dưới 50%</th><th>Xếp hạng tài chính</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="text-muted">Không có hồ sơ trong phạm vi đợt.</td></tr>'}</tbody></table>
        </div>
      </article>`;
  }).join("");
  const pendingCodes = state.pendingLots.map((lot) => lot.code).join(", ");
  const mustWaitForContinue = state.pendingLots.length > 0
    && !state.activeBatch
    && !continueRequested;
  const continuation = state.pendingLots.length > 0 && !state.activeBatch ? `
    <div class="evaluation-round-continuation" role="status">
      <div><strong>Còn ${state.pendingLots.length} phần lô chưa đánh giá</strong><p>${escapeHtml(pendingCodes)} chưa thuộc đợt chính thức nào.</p></div>
      <button type="button" class="btn btn-primary" id="btn-continue-lot-evaluation"><i data-lucide="arrow-right"></i> Tiếp tục đánh giá</button>
    </div>` : "";
  container.innerHTML = trustedHTML(cards + continuation);
  container.classList.remove("is-hidden");
  container.querySelector("#btn-continue-lot-evaluation")?.addEventListener("click", onContinue);
  setRuntimeStyle(currentRound, "display", mustWaitForContinue || state.isComplete ? "none" : "block");
  return { ...state, showCurrentRound: !mustWaitForContinue && !state.isComplete };
}
