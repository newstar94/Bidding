import { setRuntimeStyles } from "../shared/runtimeStyles.js";
import { trustedHTML } from "../shared/trustedTypes.js";
import { escapeHtml } from "../shared/view_helpers.js";
import { requiresTechnicalScoreInput } from "./evaluationMethodRules.js";
import {
  applyBidEvaluationPatches,
  collectBidEvaluationDraftPatches,
} from "./BidEvaluationDraftState.js";
import {
  deriveBidEvaluationProgress,
  getEvaluationProgressVisual,
} from "./BidEvaluationProgress.js";

export function buildEvaluationProgressMarkup(progress, {
  title = "Tiến độ đánh giá",
  statusText = "",
} = {}) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
  const breakdown = (progress?.stages || []).map(
    (stage) => `${escapeHtml(stage.label)} ${stage.completed}/${stage.applicable}`,
  ).join(" · ");
  const stateLabel = percent === 100
    ? "Đã hoàn thành 100%"
    : percent === 0 ? "Chưa bắt đầu, 0%" : `Đã xử lý ${percent}%`;
  return `
    <section class="evaluation-progress-compact" data-progress-state="${percent === 0 ? "empty" : percent === 100 ? "complete" : "in-progress"}" aria-label="${escapeHtml(title)}">
      <div class="evaluation-progress-heading">
        <span>${escapeHtml(title)}</span>
        <strong class="evaluation-progress-percent">${percent}%</strong>
      </div>
      <div class="evaluation-progress-track" role="progressbar" aria-label="${escapeHtml(title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${escapeHtml(stateLabel)}">
        <span class="evaluation-progress-fill" aria-hidden="true"></span>
      </div>
      <div class="evaluation-progress-breakdown">${breakdown || "Chưa có dữ liệu đánh giá"}</div>
      <div class="evaluation-progress-status" role="status" aria-live="polite">${escapeHtml(statusText)}</div>
    </section>`;
}

export function renderEvaluationProgressComponent(container, progress, options = {}) {
  if (!container) return null;
  container.innerHTML = trustedHTML(buildEvaluationProgressMarkup(progress, options));
  const visual = getEvaluationProgressVisual(progress?.percent);
  const fill = container.querySelector?.(".evaluation-progress-fill");
  if (fill) {
    setRuntimeStyles(fill, {
      width: `${visual.percent}%`,
      backgroundImage: visual.percent === 0
        ? "none"
        : `linear-gradient(90deg,hsl(${visual.startHue} 78% 44%),hsl(${visual.endHue} 68% 38%))`,
    });
  }
  return visual;
}

export function renderCurrentBidEvaluationProgress({
  controller,
  pkg,
  rows = [],
  bids = [],
  round = "technical",
  dirtyState = null,
  statusText = "",
  defaultEmptyBinaryResultsToPass = false,
} = {}) {
  const projection = structuredClone(bids || []);
  if (dirtyState) {
    applyBidEvaluationPatches(projection, collectBidEvaluationDraftPatches({
      rows,
      bids: projection,
      dirtyState,
      parseMoney: (value) => controller.model.parseVND(value),
    }));
  }
  const progress = deriveBidEvaluationProgress({
    bids: projection,
    round,
    requiresTechnicalScore: requiresTechnicalScoreInput(pkg),
    defaultEmptyBinaryResultsToPass,
  });
  renderEvaluationProgressComponent(
    controller.view.getActiveElement("danhgiahsdt-progress"),
    progress,
    {
      title: round === "financial" ? "Tiến độ hồ sơ tài chính" : "Tiến độ đánh giá",
      statusText,
    },
  );
  return progress;
}
