import { getLotWinners } from "../shared/runtimeState.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeAttribute, escapeHtml } from "../shared/view_helpers.js";
import { beginWorkspaceRender } from "../shared/workspaceRenderCache.js";
import { setJvData } from "./jvDataStore.js";

const MODAL_ID = "modal-lot-winners";

function normalizeWinners(winners) {
  return Array.isArray(winners) ? winners.filter(Boolean) : [];
}

function formatWinnerPrice(formatCurrency, value) {
  const amount = Number(value || 0);
  return typeof formatCurrency === "function"
    ? formatCurrency(amount)
    : `${amount.toLocaleString("vi-VN")} đ`;
}

function buildWinnerNameAction(winner) {
  const contractorName = String(winner.tenNhaThau || "Chưa xác định");
  const contractorId = String(winner.nhaThauTrungThauId || "").trim();
  const isJointVenture = Boolean(winner.isJV && winner.jvKey);
  if (!contractorId && !isJointVenture) {
    return `<span>${escapeHtml(contractorName)}</span>`;
  }
  return `
    <button
      type="button"
      class="lot-winner-contractor-button"
      data-bf-action="${isJointVenture ? "show-jv" : "show-contractor-modal"}"
      data-id="${escapeAttribute(isJointVenture ? winner.jvKey : contractorId)}"
      data-close-before="${MODAL_ID}"
      aria-haspopup="dialog"
      aria-label="Xem thông tin nhà thầu ${escapeAttribute(contractorName)}"
    >
      <span>${escapeHtml(contractorName)}</span>
      ${isJointVenture ? '<span class="lot-winner-jv-badge">Liên danh</span>' : ""}
    </button>
  `;
}

export function buildLotWinnersModalHtml({ packageCode = "", packageName = "", winners = [], formatCurrency } = {}) {
  const normalizedWinners = normalizeWinners(winners);
  const totalAwardPrice = normalizedWinners.reduce(
    (total, winner) => total + Number(winner.giaTrungThau || 0),
    0,
  );
  const rows = normalizedWinners.map((winner) => `
    <tr>
      <td data-label="Mã phần lô"><strong>${escapeHtml(winner.maPhanLo || "--")}</strong></td>
      <td data-label="Tên phần lô">${escapeHtml(winner.tenPhanLo || "--")}</td>
      <td data-label="Nhà thầu trúng thầu">${buildWinnerNameAction(winner)}</td>
      <td data-label="Giá trúng thầu" class="text-right fw-bold">${escapeHtml(formatWinnerPrice(formatCurrency, winner.giaTrungThau))}</td>
    </tr>
  `).join("");

  return `
    <div class="modal-card lot-winners-modal-card" role="dialog" aria-modal="true" aria-labelledby="lot-winners-title">
      <div class="modal-header lot-winners-modal-header">
        <div>
          <h3 id="lot-winners-title">Nhà thầu trúng thầu theo phần lô</h3>
          <p class="text-muted lot-winners-package-title">
            ${packageCode ? `<strong>${escapeHtml(packageCode)}</strong>${packageName ? " · " : ""}` : ""}${escapeHtml(packageName)}
          </p>
        </div>
        <button type="button" class="modal-close" data-bf-action="close-modal" data-modal-id="${MODAL_ID}" aria-label="Đóng"></button>
      </div>
      <div class="modal-body lot-winners-modal-body">
        <div class="phanlo-table-wrap">
          <table class="phanlo-table lot-winners-table" data-mobile-layout="cards" data-no-sort="true">
            <thead>
              <tr>
                <th>Mã phần lô</th>
                <th>Tên phần lô</th>
                <th>Nhà thầu trúng thầu</th>
                <th class="text-right">Giá trúng thầu (VND)</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr data-table-state="empty"><td colspan="4" class="text-center text-muted">Chưa có thông tin nhà thầu trúng thầu theo phần lô.</td></tr>'}
            </tbody>
            ${normalizedWinners.length ? `
              <tfoot>
                <tr>
                  <td colspan="3" class="text-right"><strong>Tổng giá trúng thầu</strong></td>
                  <td class="text-right"><strong>${escapeHtml(formatWinnerPrice(formatCurrency, totalAwardPrice))}</strong></td>
                </tr>
              </tfoot>
            ` : ""}
          </table>
        </div>
      </div>
    </div>
  `;
}

export function showLotWinnersModal({ model, view } = {}, packageId) {
  const cacheOwner = "lot-winners-modal";
  beginWorkspaceRender(model, cacheOwner);
  const winners = normalizeWinners(getLotWinners(model, packageId));
  if (!winners.length) {
    view?.showToast?.(
      "Chưa có thông tin",
      "Không tìm thấy dữ liệu nhà thầu trúng thầu theo phần lô.",
      "warning",
    );
    return false;
  }

  const pkg = model?.state?.goithau?.find(
    (item) => String(item.id) === String(packageId),
  );
  let modal = document.getElementById(MODAL_ID);
  if (!modal) {
    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "modal-overlay";
    document.body.appendChild(modal);
  }
  const winnersForView = winners.map((winner, index) => {
    if (!winner.isJV || !winner.jvData) return winner;
    const jvKey = `lot-winner:${packageId}:${winner.maPhanLo || index}`;
    setJvData(model, jvKey, winner.jvData, { owner: cacheOwner });
    return { ...winner, jvKey };
  });
  modal.innerHTML = trustedHTML(buildLotWinnersModalHtml({
    packageCode: pkg?.maGoiThau || "",
    packageName: pkg?.tenGoiThau || "",
    winners: winnersForView,
    formatCurrency: (value) => model?.formatCurrency?.(value) || formatWinnerPrice(null, value),
  }));
  modal.dataset.packageId = String(packageId || "");
  view?.openModal?.(MODAL_ID);
  return true;
}
