import { renderEvaluationPanel } from "./EvaluationPanel.js";

export function renderTechnicalEvaluationPanel(container, pkg, labels) {
  renderEvaluationPanel(container, pkg, { ...labels, mode: "technical" });
}
