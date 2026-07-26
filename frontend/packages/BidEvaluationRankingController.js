import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { calculateRankings } from "../shared/BiddingCalculations.js";
import { parseVND } from "../shared/formatters.js";
import { updateRowConclusion } from "./bidEvaluationActions.js";

const DISABLEABLE_SELECTOR = ".mt-dg-hop-le, .mt-dg-nang-luc, .mt-dg-ky-thuat, .mt-lam-ro-hop-le, .mt-lam-ro-nang-luc, .mt-lam-ro-ky-thuat, .mt-lam-ro-tai-chinh, .mt-reason-fail-hople, .mt-reason-fail-nangluc, .mt-reason-fail-kythuat";
const UNLOCKABLE_SELECTOR = ".mt-dg-hop-le, .mt-lam-ro-hop-le, .mt-lam-ro-nang-luc, .mt-lam-ro-ky-thuat, .mt-lam-ro-tai-chinh, .mt-reason-fail-hople, .mt-reason-fail-nangluc, .mt-reason-fail-kythuat";

function controlValue(control, fallback = "") {
  return String(control?.value || control?.textContent || fallback || "").trim();
}

function isNumeric(value) {
  if (!value) return false;
  const normalized = String(value).trim().replace(/,/g, ".");
  return normalized !== "" && !Number.isNaN(Number(normalized)) && Number.isFinite(Number(normalized));
}

function setControlsDisabled(row, disabled) {
  const selector = disabled ? DISABLEABLE_SELECTOR : UNLOCKABLE_SELECTOR;
  row.querySelectorAll(selector).forEach((control) => {
    if (disabled) control.setAttribute("disabled", "true");
    else control.removeAttribute("disabled");
    setRuntimeStyle(control, "background", disabled ? "var(--neutral-soft)" : "");
    setRuntimeStyle(control, "cursor", disabled ? "not-allowed" : "");
  });
}

function toggleFailReasons(row, conclusion) {
  const validity = controlValue(row.querySelector(".mt-dg-hop-le"));
  const capacity = controlValue(row.querySelector(".mt-dg-nang-luc"));
  const technical = controlValue(row.querySelector(".mt-dg-ky-thuat"));
  const validityReason = row.querySelector(".mt-reason-fail-hople");
  if (validityReason) {
    setRuntimeStyle(validityReason, "display", validity === "Không đạt" ? "block" : "none");
    if (validity !== "Không đạt") validityReason.value = "";
  }
  const capacityReason = row.querySelector(".mt-reason-fail-nangluc");
  if (capacityReason) {
    setRuntimeStyle(capacityReason, "display", capacity === "Không đạt" ? "block" : "none");
    if (capacity !== "Không đạt") capacityReason.value = "";
  }
  const technicalReason = row.querySelector(".mt-reason-fail-kythuat");
  if (!technicalReason) return;
  const showTechnicalReason = technical.toLocaleLowerCase("vi-VN") === "không đạt"
    || (isNumeric(technical) && conclusion.startsWith("Không đạt"));
  setRuntimeStyle(technicalReason, "display", showTechnicalReason ? "block" : "none");
  if (!showTechnicalReason) technicalReason.value = "";
}

function collectRowBid({ row, bid, pkg, isTwoEnvelope, isReadOnly, sequence }) {
  const validityInput = row.querySelector(".mt-dg-hop-le");
  const capacityInput = row.querySelector(".mt-dg-nang-luc");
  const technicalInput = row.querySelector(".mt-dg-ky-thuat");
  const conclusionSelect = row.querySelector(".mt-dg-ketluan");
  const isSequential = !isTwoEnvelope && pkg.quyTrinhDanhGia === "quytrinh2";
  const forceDisabled = isSequential && (!sequence.previousAllFailed || sequence.foundPassedBidder);
  if (!isReadOnly) setControlsDisabled(row, forceDisabled);

  if (isSequential && sequence.foundPassedBidder) {
    updateRowConclusion(row, "Không đánh giá", true);
  } else {
    const currentConclusion = conclusionSelect?.value || bid.danhGiaKetLuan || null;
    const savedConclusion = isReadOnly
      ? bid.danhGiaKetLuan
      : forceDisabled
        ? "Chờ đánh giá"
        : currentConclusion;
    updateRowConclusion(row, savedConclusion, isReadOnly || forceDisabled);
  }

  const validity = controlValue(validityInput, bid.danhGiaHopLe);
  const capacity = controlValue(capacityInput, bid.danhGiaNangLuc);
  const technical = controlValue(technicalInput, bid.danhGiaKyThuat);
  const conclusionCell = row.querySelector(".mt-ketluan-cell");
  const conclusion = conclusionSelect
    ? conclusionSelect.value
    : controlValue(conclusionCell);
  toggleFailReasons(row, conclusion);

  if (isSequential) {
    if (conclusion === "Đạt" || conclusion.startsWith("Đạt")) {
      sequence.foundPassedBidder = true;
    }
    if (!conclusion.startsWith("Không đạt")) {
      sequence.previousAllFailed = false;
    }
  }

  const priceInput = row.querySelector(".mt-gia-du-thau");
  const discountInput = row.querySelector(".mt-ty-le-giam-gia");
  const price = priceInput ? parseVND(priceInput.value) ?? 0 : bid.giaDuThau || 0;
  const discount = discountInput
    ? Number.parseFloat(String(discountInput.value || "").replace(/,/g, ".")) || 0
    : bid.tyLeGiamGia || 0;
  return {
    ...bid,
    danhGiaHopLe: validity,
    danhGiaNangLuc: capacity,
    danhGiaKyThuat: technical,
    danhGiaKetLuan: conclusion,
    giaDuThau: price,
    tyLeGiamGia: discount,
    giaSauGiamGia: Number(price) * (1 - discount / 100),
  };
}

function renderRanking(row, bid, rankings, scores) {
  const rank = rankings[bid.id];
  const score = scores[bid.id];
  const financial = row.querySelector(".mt-dg-tai-chinh");
  if (financial) financial.value = rank ? `Xếp hạng ${rank}` : "";
  const rankCell = row.querySelector(".mt-dg-xep-hang");
  if (rankCell) {
    const conclusion = controlValue(row.querySelector(".mt-ketluan-cell"));
    const isFailed = conclusion.includes("Không đạt")
      || String(bid.danhGiaKetLuan || "").includes("Không đạt");
    rankCell.textContent = rank ? `Xếp hạng ${rank}` : isFailed ? "Không xếp hạng" : "--";
  }
  const scoreCell = row.querySelector(".mt-combined-score");
  if (scoreCell) {
    scoreCell.textContent = Number.isFinite(score) && score > 0 ? score.toFixed(2) : "--";
  }
  const badge = row.querySelector(".mt-ketluan-cell")?.querySelector(".badge");
  if (badge?.textContent.trim().startsWith("Đạt")) {
    badge.textContent = "Đạt";
    badge.className = "badge badge-success";
  }
}

export function createBidEvaluationRankingController({
  root,
  pkg,
  bids = [],
  isTwoEnvelope = false,
  isReadOnly = false,
} = {}) {
  if (!root?.querySelectorAll || !pkg || !Array.isArray(bids)) {
    throw new TypeError("Bid evaluation ranking controller received an invalid context.");
  }
  const bidsById = new Map(bids.map((bid) => [String(bid?.id || ""), bid]));
  const revision = Number(root.__bfBidEvaluationRankingRevision || 0) + 1;
  root.__bfBidEvaluationRankingRevision = revision;
  let disposed = false;
  let hasUpdated = false;
  let scheduled = false;
  let frameId = null;
  const update = () => {
    hasUpdated = true;
    const sequence = { foundPassedBidder: false, previousAllFailed: true };
    const entries = [];
    root.querySelectorAll("tr[data-bid-id]").forEach((row) => {
      const bid = bidsById.get(String(row.getAttribute("data-bid-id") || ""));
      if (!bid) return;
      entries.push({
        row,
        bid,
        currentBid: collectRowBid({
          row,
          bid,
          pkg,
          isTwoEnvelope,
          isReadOnly,
          sequence,
        }),
      });
    });
    const currentBids = entries.map((entry) => entry.currentBid);
    const { rankings, scores } = calculateRankings(pkg, currentBids);
    entries.forEach(({ row, bid }) => renderRanking(row, bid, rankings, scores));
    return { currentBids, rankings, scores };
  };
  return {
    update,
    schedule() {
      if (disposed) return null;
      if (!hasUpdated) return update();
      if (scheduled) return null;
      scheduled = true;
      const run = () => {
        scheduled = false;
        frameId = null;
        if (disposed || root.__bfBidEvaluationRankingRevision !== revision) return;
        update();
      };
      if (typeof globalThis.requestAnimationFrame === "function") {
        frameId = globalThis.requestAnimationFrame(run);
      } else {
        queueMicrotask(run);
      }
      return null;
    },
    dispose() {
      disposed = true;
      if (frameId !== null && typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(frameId);
      }
      scheduled = false;
      frameId = null;
    },
  };
}
