import { renderEvaluationPanel } from "../components/EvaluationPanel.js";

export function renderFinancialEvaluationPanel(container, pkg, labels) {
  renderEvaluationPanel(container, pkg, { ...labels, mode: "financial" });
}
