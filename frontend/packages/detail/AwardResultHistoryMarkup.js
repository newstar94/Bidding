import { escapeHtml, safeAttr } from "../../shared/view_helpers.js";
import { isBidWithinEvaluationLotDetails } from "../lotEvaluationScope.js";

const TWO_ENVELOPE_METHOD = "Một giai đoạn hai túi hồ sơ";

function parseLots(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function buildOfficialResultHistoryMarkup(
  view,
  pkg,
  state,
  metadata = {},
  options = {},
) {
  if (!state?.history?.length) return "";
  const isEditable = options?.isEditable === true;
  const packageBids = (view?.model?.state?.thongtinmothau || []).filter(
    (bid) => String(bid.goiThauId) === String(pkg?.id),
  );
  const lots = parseLots(pkg?.phanLoList);
  const pendingLots = Array.isArray(state.pendingLots) ? state.pendingLots : [];

  return `<div class="official-result-history">
    ${state.history.map((batch) => {
      const isTwoEnvelope = pkg.phuongThucLuaChon === TWO_ENVELOPE_METHOD;
      const technicalBatch = isTwoEnvelope
        ? metadata.technical?.lotBatches?.[batch.batchId] || batch
        : batch;
      const financialBatch = isTwoEnvelope
        ? metadata.financial?.lotBatches?.[batch.batchId] || {}
        : {};
      const result = technicalBatch.result || financialBatch.result || batch.result || {};
      const scopedBids = packageBids.filter(
        (bid) => isBidWithinEvaluationLotDetails(bid, batch),
      );
      const rows = scopedBids.map((bid) => {
        const lot = lots.find(
          (item) => String(item.id || "") === String(bid.lotId || bid.lot_id || "")
            || String(item.maPhanLo || "") === String(bid.maPhanLo || ""),
        );
        const isWinner = lot?.nhaThauTrungThauId
          && String(lot.nhaThauTrungThauId) === String(bid.nhaThauId || bid.id || "");
        return `<tr><td>${escapeHtml(bid.maPhanLo || "--")}</td><td>${escapeHtml(bid.tenNhaThau || "--")}</td>
          <td><span class="badge ${isWinner ? "badge-success" : "badge-danger"}">${isWinner ? "Trúng thầu" : "Trượt thầu"}</span></td>
          <td>${escapeHtml(isWinner ? view.model.formatCurrency(lot?.giaTrungThau || 0) : bid.lyDoTruot || "--")}</td></tr>`;
      }).join("");
      return `<article class="evaluation-round-card official-result-round">
        <header class="evaluation-round-card-header"><div><span class="evaluation-round-index">Lần ${batch.sequenceNo}</span>
          <h4>Kết quả ${escapeHtml((batch.lotCodes || []).join(", ") || "các phần lô")}</h4></div>
          <div class="evaluation-round-card-actions">
            <span class="evaluation-round-status"><i data-lucide="badge-check"></i> Chính thức</span>
          </div></header>
        <div class="evaluation-round-fields">
          ${isTwoEnvelope ? `
          <div><span>BC đánh giá kỹ thuật</span><strong>${escapeHtml(technicalBatch.soBaoCao || "--")}</strong></div>
          <div><span>BCTĐ kỹ thuật</span><strong>${escapeHtml(technicalBatch.soBctdKt || "--")}</strong></div>
          <div><span>QĐ đạt kỹ thuật</span><strong>${escapeHtml(technicalBatch.soQdPheDuyetKt || "--")}</strong></div>
          <div><span>Mở E-HSĐXTC</span><strong>${escapeHtml(technicalBatch.financialOpening?.openingTime ? view.model.formatDateWithTime(technicalBatch.financialOpening.openingTime) : "--")}</strong></div>
          <div><span>BC đánh giá tài chính</span><strong>${escapeHtml(financialBatch.soBaoCao || "--")}</strong></div>` : `
          <div><span>Số báo cáo đánh giá</span><strong>${escapeHtml(batch.soBaoCao || "--")}</strong></div>`}
          <div><span>Số BCTĐ kết quả</span><strong>${escapeHtml(result.soBctdKetQua || "--")}</strong></div>
          <div><span>Ngày BCTĐ kết quả</span><strong>${escapeHtml(result.ngayBctdKetQua ? view.model.formatDate(result.ngayBctdKetQua) : "--")}</strong></div>
          <div><span>Số QĐ phê duyệt</span><strong>${escapeHtml(result.soQuyetDinhKetQua || "--")}</strong></div>
          <div><span>Ngày QĐ phê duyệt</span><strong>${escapeHtml(result.ngayQuyetDinhKetQua ? view.model.formatDate(result.ngayQuyetDinhKetQua) : "--")}</strong></div>
          <div><span>Phạm vi</span><strong>${escapeHtml((batch.lotCodes || []).join(", ") || "--")}</strong></div>
        </div>
        <div class="table-container package-table-frame evaluation-round-table"><table class="data-table"><thead><tr><th>Phần lô</th><th>Nhà thầu</th><th>Kết quả</th><th>Giá/Lý do</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="text-muted">Không có hồ sơ trong đợt.</td></tr>'}</tbody></table></div>
        ${isEditable ? `<div class="workflow-action-row evaluation-round-action-row">
          <button type="button" class="btn btn-primary action-strong evaluation-round-edit-button" data-edit-official-result-batch="${safeAttr(batch.batchId)}" aria-label="Chỉnh sửa kết quả Lần ${batch.sequenceNo}">
            <i data-lucide="edit-3"></i> Chỉnh sửa
          </button>
        </div>` : ""}
      </article>`;
    }).join("")}
    ${pendingLots.length ? `<div class="evaluation-round-continuation"><div><strong>Còn ${pendingLots.length} phần lô chưa có kết quả</strong><p>${escapeHtml(pendingLots.map((lot) => lot.code).join(", "))}. Hãy sang tab báo cáo đánh giá để tiếp tục.</p></div></div>` : ""}
  </div>`;
}
