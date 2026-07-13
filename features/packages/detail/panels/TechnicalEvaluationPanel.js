import { renderEvaluationPanel } from "../components/EvaluationPanel.js";

export function renderTechnicalEvaluationPanel(container, pkg, labels) {
  renderEvaluationPanel(container, pkg, { ...labels, mode: "technical" });
}
